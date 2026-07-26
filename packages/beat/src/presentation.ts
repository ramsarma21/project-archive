// Presentation projection: exactly what a renderer and a HUD need, and nothing
// that would let them drive the simulation.
//
// THE READ, AND WHY IT TEACHES ITSELF.
//
// This package draws nothing. What it publishes is a single number per pending
// beat — `approach01`, which travels from 0 to exactly 1.0 on the beat's tick —
// and the judgement windows expressed in that same normalised space. A renderer
// turns that into ONE convergence: a mark that slides toward a fixed line, and a
// line that does not move.
//
// That shape is chosen against a specific requirement. The player is thirteen and
// has never played osu, so the first encounter has to teach itself without a
// tutorial and without iconography anybody has to be told the meaning of. A
// shrinking ring, a filling arc and a sweeping needle all need one sentence of
// explanation before they mean anything. Two things touching does not: it is the
// oldest read in games, it is pre-verbal, and it is the same read as catching a
// ball. There is exactly one moment when the mark is ON the line, and everybody
// can see it coming.
//
// The `preview` array carries the same idea one step earlier. Before the player
// commits, the whole chart is available as fractions of its own span, so the
// marks can be laid out on the surface at their real spacing — which means the
// DOUBLE is visible as two marks close together before a single stroke is made.
// The player is never surprised by the hard part; they are shown it and asked
// whether now is the moment. `downbeats` divides that layout into bars, because
// a dozen marks in a row read as a queue and the same dozen in three groups read
// as a rhythm that gets harder.
//
// `lastOffsetTicks` is the other half of learning. A player who is told only
// "glancing" cannot improve, because the useful information is not how badly
// they missed but WHICH WAY. Every rhythm game that people get good at reports
// early and late separately, and it is the cheapest thing here to get right.

import {
  APPROACH_TICKS,
  FLUSH_WINDOW_TICKS,
  GLANCING_WINDOW_TICKS,
  HIT_WINDOW_TICKS,
  TRUE_WINDOW_TICKS,
} from "./tuning.js";
import { gradeFor, scoreStrikes, type BeatGrade, type BeatJudgement } from "./judge.js";
import { STEALTH_TUNING } from "./engine.js";
import type { BeatPhase, BeatRun } from "./machine.js";

export interface BeatMarkView {
  readonly index: number;
  /** Absolute tick this beat is due. */
  readonly dueTick: number;
  /**
   * 0 when the mark first becomes readable, exactly 1 on its tick, above 1 once
   * it is late. The whole read is "strike when this reaches 1".
   */
  readonly approach01: number;
  /** Signed ticks until due. Negative once the beat is late. */
  readonly ticksAway: number;
  readonly resolved: boolean;
  readonly judgement: BeatJudgement | null;
}

/** Window half-widths as fractions of the approach, for drawing the target. */
export interface BeatBands {
  readonly flush01: number;
  readonly true01: number;
  readonly glancing01: number;
}

export const BEAT_BANDS: BeatBands = {
  flush01: FLUSH_WINDOW_TICKS / APPROACH_TICKS,
  true01: TRUE_WINDOW_TICKS / APPROACH_TICKS,
  glancing01: GLANCING_WINDOW_TICKS / APPROACH_TICKS,
};

export interface BeatPresentation {
  readonly phase: BeatPhase;
  readonly verbId: string;
  readonly clip: string;
  readonly clipOnce: boolean;
  /** Marks currently readable, soonest first. Empty in stance. */
  readonly marks: readonly BeatMarkView[];
  /**
   * Every beat as a fraction of the chart's span, available in stance. Lays the
   * whole rhythm out in space before the player commits to it.
   */
  readonly preview: readonly number[];
  /**
   * The bar lines, in the same normalised space as `preview`.
   *
   * A thirteen-mark preview with nothing between the marks is a queue, and a
   * queue is not a rhythm anybody can read. Drawn as bar lines it is three
   * groups of visibly rising density, which is the thing the player is being
   * asked to judge a patrol gap against.
   */
  readonly downbeats: readonly number[];
  readonly spanTicks: number;
  /** Ticks until the run ends. Null while still in stance. */
  readonly remainingTicks: number | null;
  readonly bands: BeatBands;
  readonly struck: number;
  readonly remaining: number;
  /** Running quality, counting unplayed beats as zero. A floor, not a guess. */
  readonly quality01: number;
  /** The grade the run would end on right now. */
  readonly grade: BeatGrade;
  readonly lastJudgement: BeatJudgement | null;
  /** Signed ticks of the last stroke. Negative is early. Null for a stray. */
  readonly lastOffsetTicks: number | null;
  /** Loudest noise made so far, [0,1]. */
  readonly loudestIntensity: number;
  /** True once this run has made a noise the stealth field can hear at all. */
  readonly heard: boolean;
}

function clipFor(run: BeatRun, lastJudgement: BeatJudgement | null): {
  clip: string;
  once: boolean;
} {
  const clips = run.spec.verb.clips;
  if (run.phase === "STANCE") return { clip: clips.stance, once: false };
  if (run.phase === "RESOLVED" || run.phase === "ABANDONED") {
    return { clip: clips.finish, once: true };
  }
  if (lastJudgement === "STRAY") return { clip: clips.stray, once: true };
  if (lastJudgement !== null) return { clip: clips.strike, once: true };
  return { clip: clips.stance, once: false };
}

export function beatPresentation(run: BeatRun, tick: number): BeatPresentation {
  const chart = run.chart;
  const started = run.startedTick;
  const last = run.records[run.records.length - 1] ?? null;

  const marks: BeatMarkView[] = [];
  if (started !== null) {
    for (let index = 1; index < chart.offsets.length; index++) {
      const dueTick = started + chart.offsets[index]!;
      const ticksAway = dueTick - tick;
      // Readable from one approach out until its window has closed. A resolved
      // mark stays in the list for the tick it resolved on so a renderer can pop
      // it, then leaves.
      if (ticksAway > APPROACH_TICKS) continue;
      if (ticksAway < -HIT_WINDOW_TICKS) continue;
      const record = run.records.find((entry) => entry.beatIndex === index) ?? null;
      marks.push({
        index,
        dueTick,
        approach01: 1 - ticksAway / APPROACH_TICKS,
        ticksAway,
        resolved: run.resolved[index] === true,
        judgement: record?.judgement ?? null,
      });
    }
  }

  const score = scoreStrikes(run.records, chart.judgedBeats);
  const grade = run.outcome?.grade ?? gradeFor(score, run.spec.thresholds);
  const { clip, once } = clipFor(run, last?.judgement ?? null);

  return {
    phase: run.phase,
    verbId: run.spec.verb.id,
    clip,
    clipOnce: once,
    marks,
    preview:
      chart.spanTicks > 0
        ? chart.offsets.map((offset) => offset / chart.spanTicks)
        : chart.offsets.map(() => 0),
    downbeats:
      chart.spanTicks > 0
        ? chart.downbeats.map((offset) => offset / chart.spanTicks)
        : chart.downbeats.map(() => 0),
    spanTicks: chart.spanTicks,
    remainingTicks:
      run.resolveAtTick === null ? null : Math.max(0, run.resolveAtTick - tick),
    bands: BEAT_BANDS,
    struck: score.flush + score.trueStrikes + score.glancing,
    remaining: chart.judgedBeats - score.judged,
    quality01: score.quality,
    grade,
    lastJudgement: last?.judgement ?? null,
    lastOffsetTicks: last?.offsetTicks ?? null,
    loudestIntensity: run.loudestIntensity,
    heard: run.loudestIntensity >= STEALTH_TUNING.minAudibleNoise,
  };
}
