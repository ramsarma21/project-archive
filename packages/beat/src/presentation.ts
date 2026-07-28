// Presentation projection: exactly what the holographic panel needs, and nothing
// that would let it drive the simulation.
//
// The read is "a flare is up on this cell — click it". That is the oldest read
// in games and needs no tutorial: a lit thing, a click. The renderer is handed a
// list of cells, which one is live, and how much of its window is left (for a
// countdown ring), plus the running tally and the last result to flash. It is
// handed no way to advance the run: the machine owns the tick, and clicks reach
// it as input, not through this projection.

import { gradeFor, scoreStrikes, type BeatGrade } from "./judge.js";
import { STEALTH_TUNING } from "./engine.js";
import type { BeatPhase, BeatRun } from "./machine.js";

/** The last thing that happened to a flare, for a brief on-panel flash. */
export type BeatResult = "HIT" | "MISS" | "STRAY";

/** One panel cell's live state. */
export interface BeatCellView {
  readonly cell: number;
  /** A flare is up on this cell right now and is the thing to click. */
  readonly active: boolean;
  /**
   * How much of the live flare's window remains, 1 at appearance to 0 at the
   * edge of the window. Zero for every cell that is not live. A renderer draws it
   * as a shrinking ring; a reduced-motion renderer may ignore it — the flare is
   * hittable for its whole window regardless, so the ring is an aid, not a gate.
   */
  readonly remaining01: number;
}

export interface BeatPresentation {
  readonly phase: BeatPhase;
  readonly verbId: string;
  readonly clip: string;
  readonly clipOnce: boolean;
  /** Cells on the panel, in order. */
  readonly cells: readonly BeatCellView[];
  /** The lit cell to strike, or null when the panel is between flares. */
  readonly activeCell: number | null;
  /** The live flare's remaining window, 1..0, or 0 when nothing is up. */
  readonly activeRemaining01: number;
  /** Flares struck so far. */
  readonly struck: number;
  /** Flares neither struck nor faded yet. */
  readonly remaining: number;
  /** Total flares in the act. */
  readonly total: number;
  /** Running quality, counting unplayed flares as zero. A floor, not a guess. */
  readonly quality01: number;
  /** The grade the run would end on right now. */
  readonly grade: BeatGrade;
  /** The last flare's result, for a flash. Null before anything happens. */
  readonly lastResult: BeatResult | null;
  /** Ticks until the run ends. Null while still in stance. */
  readonly remainingTicks: number | null;
  /** Loudest noise made so far, [0,1]. */
  readonly loudestIntensity: number;
  /** True once this run has made a noise the stealth field can hear at all. */
  readonly heard: boolean;
}

function clipFor(
  run: BeatRun,
  lastResult: BeatResult | null,
): { clip: string; once: boolean } {
  const clips = run.spec.verb.clips;
  if (run.phase === "STANCE") return { clip: clips.stance, once: false };
  if (run.phase === "RESOLVED" || run.phase === "ABANDONED") {
    return { clip: clips.finish, once: true };
  }
  if (lastResult === "STRAY") return { clip: clips.stray, once: true };
  if (lastResult === "HIT") return { clip: clips.strike, once: true };
  return { clip: clips.stance, once: false };
}

function resultOf(judgement: string): BeatResult {
  if (judgement === "STRAY") return "STRAY";
  if (judgement === "SLIP") return "MISS";
  return "HIT";
}

export function beatPresentation(run: BeatRun, tick: number): BeatPresentation {
  const spec = run.spec.reaction;
  const started = run.startedTick;
  const window = spec.windowTicks;

  let activeCell: number | null = null;
  let activeRemaining01 = 0;
  if (started !== null && (run.phase === "ACTIVE" || run.phase === "SETTLING")) {
    const offset = tick - started;
    for (const target of run.schedule.targets) {
      if (run.resolved[target.index]) continue;
      if (offset >= target.spawnTick && offset <= target.expireTick) {
        activeCell = target.cell;
        activeRemaining01 =
          window > 0
            ? Math.max(0, Math.min(1, (target.expireTick - offset) / window))
            : 0;
        break;
      }
    }
  }

  const cells: BeatCellView[] = [];
  for (let cell = 0; cell < spec.cellCount; cell++) {
    const active = cell === activeCell;
    cells.push({ cell, active, remaining01: active ? activeRemaining01 : 0 });
  }

  const last = run.records[run.records.length - 1] ?? null;
  const score = scoreStrikes(run.records, run.schedule.targets.length);
  const grade = run.outcome?.grade ?? gradeFor(score, run.spec.thresholds);
  const struck = score.flush + score.trueStrikes + score.glancing;
  const resolvedCount = run.resolved.filter((done) => done).length;
  const lastResult = last ? resultOf(last.judgement) : null;
  const { clip, once } = clipFor(run, lastResult);

  return {
    phase: run.phase,
    verbId: run.spec.verb.id,
    clip,
    clipOnce: once,
    cells,
    activeCell,
    activeRemaining01,
    struck,
    remaining: run.schedule.targets.length - resolvedCount,
    total: run.schedule.targets.length,
    quality01: score.quality,
    grade,
    lastResult,
    remainingTicks:
      run.resolveAtTick === null ? null : Math.max(0, run.resolveAtTick - tick),
    loudestIntensity: run.loudestIntensity,
    heard: run.loudestIntensity >= STEALTH_TUNING.minAudibleNoise,
  };
}
