// The run: one fixed step of a reaction beat.
//
// Drives on the container's tick and nothing else. No wall clock, no timer, no
// internal loop — the mission's fixed-step scheduler calls `stepBeat` once per
// tick with the tick index, exactly as it calls `stepFlow` and
// `stepStealthField`, and the beat resolves on an integer tick both machines
// agree on.
//
// THE ACT, IN ONE SENTENCE. The player stands on the bough facing the tree, and
// flares come up on a holographic panel one at a time; they click the lit one
// before it fades. A click on the lit cell is a HIT and makes no sound the watch
// can hear. A flare left to fade is a MISS, and a miss is loud — a fumbled tack
// rings off the bark. A click on a dark cell while a flare is up somewhere else
// is a STRAY, louder still. Clicking during the dark gap between flares does
// nothing at all: this is a reaction test, and punishing a player for a twitchy
// finger between prompts is not the thing being taught.
//
// WHY IT ARMS ON ITS OWN. The old timing beat made the player press to start,
// because "when do I begin" was a real decision against a patrol. A reaction
// test has no such read — the flares dictate the tempo — so the run arms the
// moment the player is in the stance, gives them a short lead to find the panel,
// and begins. Stepping off the bough mid-run abandons it, exactly as before, and
// coming back re-derives the identical schedule from the attempt seed.

import type { NoiseEvent } from "./engine.js";
import {
  gradeFor,
  gradePosted,
  qualityOf,
  scoreStrikes,
  type BeatGrade,
  type BeatJudgement,
  type BeatScore,
  type StrikeRecord,
} from "./judge.js";
import { strikeIntensity, strikeNoiseEvent } from "./noise.js";
import { deriveSchedule, type ReactionSchedule, type ReactionTarget } from "./schedule.js";
import { noiseOrigin, type BeatSpec } from "./spec.js";

export type BeatPhase =
  /** In position, panel up, no flare struck yet. Arms as soon as the player is here. */
  | "STANCE"
  /** Flares are coming. */
  | "ACTIVE"
  /** Every flare is behind us; the follow-through is playing. */
  | "SETTLING"
  | "RESOLVED"
  /** The player left the stance, or the container tore the beat down. */
  | "ABANDONED";

export interface BeatRun {
  readonly spec: BeatSpec;
  readonly schedule: ReactionSchedule;
  /** The attempt seed the schedule was drawn from. */
  readonly seed: number;
  readonly phase: BeatPhase;
  /** Tick the run armed on. Null until the player reaches the stance. */
  readonly startedTick: number | null;
  /** Tick the run will end on, known from the moment it arms. */
  readonly resolveAtTick: number | null;
  /** Per flare index: has this flare been struck or faded? */
  readonly resolved: readonly boolean[];
  /** Hits, misses and strays, in the order they happened. */
  readonly records: readonly StrikeRecord[];
  /** Loudest single noise this run has produced so far, [0,1]. */
  readonly loudestIntensity: number;
  readonly outcome: BeatOutcome | null;
}

export interface BeatOutcome {
  readonly specId: string;
  readonly chartSpecId: string;
  readonly seed: number;
  readonly grade: BeatGrade;
  /** Did the sheet go up? False for TORN and for an abandoned run. */
  readonly posted: boolean;
  readonly score: BeatScore;
  readonly strikes: readonly StrikeRecord[];
  /** Loudest single noise the run produced. The one number stealth cares about. */
  readonly loudestIntensity: number;
  /** Ticks from arming to the resolve. Zero if never started. */
  readonly elapsedTicks: number;
  readonly abandoned: boolean;
}

export type BeatEventType =
  | "armed"
  | "struck"
  | "slipped"
  | "strayed"
  | "resolved"
  | "abandoned";

export interface BeatEvent {
  readonly type: BeatEventType;
  /** Which flare, for struck and slipped. */
  readonly beatIndex?: number;
  /** The panel cell involved, for struck, slipped and strayed. */
  readonly cell?: number;
  readonly judgement?: BeatJudgement;
  readonly grade?: BeatGrade;
}

export interface BeatInput {
  /** The container's fixed-step tick index. */
  readonly tick: number;
  /**
   * The panel cell the player struck this tick, or null for no input.
   *
   * EDGE TRIGGERED, and the container owns that: a held key or an unreleased
   * pointer must deliver a cell to exactly ONE tick, or a single click reads as
   * a run of strays. For the keyboard the container resolves the lit cell and
   * passes it here; for the pointer it passes the cell the player clicked.
   */
  readonly hitCell: number | null;
  /** The player is still in the stance and facing the work. */
  readonly inStance: boolean;
  /** The container is ending the beat: a fail, a teardown, a phase change. */
  readonly abandon?: boolean;
}

export interface BeatStepResult {
  readonly run: BeatRun;
  readonly events: readonly BeatEvent[];
  /**
   * Noise produced this tick, for the mission to hand straight to
   * `stepStealthField`. Each event is emitted on exactly one tick, which the
   * field's impulse model requires.
   */
  readonly noise: readonly NoiseEvent[];
  /** Set on the tick the run ends, and on every tick after. */
  readonly outcome: BeatOutcome | null;
}

export function createBeatRun(spec: BeatSpec, seed: number): BeatRun {
  const schedule = deriveSchedule(spec.reaction, seed);
  return {
    spec,
    schedule,
    seed: seed >>> 0,
    phase: "STANCE",
    startedTick: null,
    resolveAtTick: null,
    resolved: schedule.targets.map(() => false),
    records: [],
    loudestIntensity: 0,
    outcome: null,
  };
}

function finish(
  run: BeatRun,
  tick: number,
  abandoned: boolean,
): { run: BeatRun; outcome: BeatOutcome } {
  const score = scoreStrikes(run.records, run.schedule.targets.length);
  const grade = gradeFor(score, run.spec.thresholds);
  const outcome: BeatOutcome = {
    specId: run.spec.id,
    chartSpecId: run.spec.chart.id,
    seed: run.seed,
    grade,
    posted: !abandoned && gradePosted(grade),
    score,
    strikes: run.records,
    loudestIntensity: run.loudestIntensity,
    elapsedTicks: run.startedTick === null ? 0 : Math.max(0, tick - run.startedTick),
    abandoned,
  };
  return {
    run: { ...run, phase: abandoned ? "ABANDONED" : "RESOLVED", outcome },
    outcome,
  };
}

/** The flare live on this offset tick, if any: spawned, not yet faded, unstruck. */
function liveTargetAt(
  run: BeatRun,
  offset: number,
): ReactionTarget | null {
  for (const target of run.schedule.targets) {
    if (run.resolved[target.index]) continue;
    if (offset >= target.spawnTick && offset <= target.expireTick) return target;
  }
  return null;
}

/** One fixed step. Idempotent once the run has ended. */
export function stepBeat(runIn: BeatRun, input: BeatInput): BeatStepResult {
  if (runIn.phase === "RESOLVED" || runIn.phase === "ABANDONED") {
    return { run: runIn, events: [], noise: [], outcome: runIn.outcome };
  }

  const events: BeatEvent[] = [];
  const noise: NoiseEvent[] = [];
  const origin = noiseOrigin(runIn.spec);
  const verb = runIn.spec.verb;
  let run = runIn;

  const emit = (judgement: BeatJudgement): void => {
    const event = strikeNoiseEvent(judgement, verb, origin);
    noise.push(event);
    const intensity = strikeIntensity(judgement, verb);
    if (intensity > run.loudestIntensity) {
      run = { ...run, loudestIntensity: intensity };
    }
  };

  // ---- leaving, by choice or by force -------------------------------------
  //
  // Walking out of the stance mid-run abandons it rather than tearing the sheet:
  // the work simply is not done, and the player can come back to the same
  // schedule. Only MID-RUN, though — once every flare is resolved the tacks are
  // in, and the settle is a follow-through rather than work still being done, so
  // a player who turns away on the last flare keeps what they earned.
  if (input.abandon || (!input.inStance && run.phase === "ACTIVE")) {
    const ended = finish(run, input.tick, true);
    events.push({ type: "abandoned", grade: ended.outcome.grade });
    return { run: ended.run, events, noise, outcome: ended.outcome };
  }

  // ---- arming --------------------------------------------------------------
  //
  // A reaction test has no "when do I start" read, so it arms the moment the
  // player is in the stance and the flares dictate the tempo from there. No
  // noise: nothing has been struck yet.
  if (run.phase === "STANCE") {
    if (!input.inStance) return { run, events, noise, outcome: null };
    run = {
      ...run,
      phase: "ACTIVE",
      startedTick: input.tick,
      resolveAtTick: input.tick + run.schedule.spanTicks + verb.settleTicks,
    };
    events.push({ type: "armed" });
    // Fall through so a hit delivered on the very tick the run arms still lands
    // (harmless in practice: the first flare is a lead behind this).
  }

  const startedTick = run.startedTick!;
  const offset = input.tick - startedTick;

  // ---- flares that came and went ------------------------------------------
  //
  // A flare fades — a miss — the tick AFTER its window closes, so a click on the
  // last legal tick is always still a hit. Settled before the click, which is
  // safe: nothing a click at this tick could still legally strike is taken away
  // from it first.
  const faded: ReactionTarget[] = [];
  for (const target of run.schedule.targets) {
    if (run.resolved[target.index]) continue;
    if (offset > target.expireTick) faded.push(target);
  }
  if (faded.length > 0) {
    const resolved = [...run.resolved];
    const records = [...run.records];
    for (const target of faded) {
      resolved[target.index] = true;
      records.push({
        beatIndex: target.index,
        dueTick: startedTick + target.spawnTick,
        struckTick: null,
        offsetTicks: null,
        judgement: "SLIP",
        quality: qualityOf("SLIP"),
      });
      events.push({ type: "slipped", beatIndex: target.index, cell: target.cell });
    }
    run = { ...run, resolved, records };
    for (const _ of faded) emit("SLIP");
  }

  // ---- the strike ----------------------------------------------------------
  if (input.hitCell !== null) {
    const live = liveTargetAt(run, offset);
    if (live === null) {
      // A click during the dark gap, or after everything is resolved. Nothing to
      // strike and nothing to punish: a reaction test is about the flares, not
      // about holding still between them.
    } else if (input.hitCell === live.cell) {
      const resolved = [...run.resolved];
      resolved[live.index] = true;
      run = {
        ...run,
        resolved,
        records: [
          ...run.records,
          {
            beatIndex: live.index,
            dueTick: startedTick + live.spawnTick,
            struckTick: input.tick,
            offsetTicks: offset - live.spawnTick,
            judgement: "FLUSH",
            quality: qualityOf("FLUSH"),
          },
        ],
      };
      emit("FLUSH");
      events.push({
        type: "struck",
        beatIndex: live.index,
        cell: live.cell,
        judgement: "FLUSH",
      });
    } else {
      // Struck the wrong cell while a flare was up elsewhere. It does not
      // consume the live flare — that would punish one fumble twice — and its
      // whole cost is the noise plus a modest dent in the average.
      run = {
        ...run,
        records: [
          ...run.records,
          {
            beatIndex: -1,
            dueTick: -1,
            struckTick: input.tick,
            offsetTicks: null,
            judgement: "STRAY",
            quality: 0,
          },
        ],
      };
      emit("STRAY");
      events.push({ type: "strayed", cell: input.hitCell, judgement: "STRAY" });
    }
  }

  // ---- the follow-through --------------------------------------------------
  const allResolved = run.resolved.every((done) => done);
  if (allResolved && run.phase === "ACTIVE") {
    run = {
      ...run,
      phase: "SETTLING",
      resolveAtTick: Math.min(
        run.resolveAtTick ?? Number.POSITIVE_INFINITY,
        input.tick + verb.settleTicks,
      ),
    };
  }

  if (run.resolveAtTick !== null && input.tick >= run.resolveAtTick) {
    const ended = finish(run, input.tick, false);
    events.push({ type: "resolved", grade: ended.outcome.grade });
    return { run: ended.run, events, noise, outcome: ended.outcome };
  }

  return { run, events, noise, outcome: null };
}
