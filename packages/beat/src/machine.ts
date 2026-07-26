// The run: one fixed step of a precision beat.
//
// Drives on the container's tick and nothing else. No wall clock, no timer, no
// internal loop — the mission's fixed-step scheduler calls `stepBeat` once per
// tick with the tick index, exactly as it calls `stepFlow` and
// `stepStealthField`, and the beat resolves on an integer tick that both
// machines agree on.
//
// THE FIRST STROKE STARTS THE CHART, AND IT IS NOT JUDGED. This is the single
// most important decision in the package and it does four jobs at once.
//
//   It removes the tutorial. There is no count-in to explain, no metronome to
//   read and no lead-in the player has to sit through. They swing when they are
//   ready, one mark appears and travels toward the line, and they swing again
//   when it arrives. The mechanic has taught itself in one interval, using the
//   authored opening cell, before anything with a window has happened.
//
//   It makes "when do I start" a real decision instead of a cutscene. The beat
//   sits at a fixed spot inside a live stealth field with patrols still walking.
//   Because the player arms it, they are choosing a patrol gap to spend, and the
//   chart's span is known to them before they commit. That is the choice that
//   turns a rhythm burst into a stealth beat.
//
//   It makes the free stroke free. The opening stroke cannot be mistimed, so it
//   cannot be charged for: it is emitted at FLUSH loudness, which the field
//   cannot hear. The player hears their own hammer; the constable does not.
//
//   It keeps the ceiling honest. Fourteen strokes with thirteen of them judged
//   is a harsher test than fourteen judged strokes would be: the free one is
//   spent before the chart starts, so there is nothing in the average that was
//   given away.

import type { NoiseEvent } from "./engine.js";
import { deriveChart, type BeatChart } from "./chart.js";
import {
  claimBeat,
  expiredBeats,
  gradeFor,
  gradePosted,
  judgeOffset,
  qualityOf,
  scoreStrikes,
  type BeatGrade,
  type BeatJudgement,
  type BeatScore,
  type StrikeRecord,
} from "./judge.js";
import { strikeIntensity, strikeNoiseEvent } from "./noise.js";
import { noiseOrigin, type BeatSpec } from "./spec.js";
import { HIT_WINDOW_TICKS } from "./tuning.js";

/**
 * The loudness the opening stroke is emitted at.
 *
 * FLUSH, because there was nothing to mistime. Charging the player for a stroke
 * that carried no window would be charging them for a mistake they could not
 * have made, and it would put a floor under SILENT that a perfect player could
 * never get below.
 */
const OPENING_STROKE_JUDGEMENT: BeatJudgement = "FLUSH";

export type BeatPhase =
  /** In position, hammer up, nothing timed. Waiting for the player to start. */
  | "STANCE"
  /** The chart is live. */
  | "STRIKING"
  /** Every beat is behind us; the follow-through is playing. */
  | "SETTLING"
  | "RESOLVED"
  /** The player left the stance, or the container tore the beat down. */
  | "ABANDONED";

export interface BeatRun {
  readonly spec: BeatSpec;
  readonly chart: BeatChart;
  readonly phase: BeatPhase;
  /** Tick of the opening stroke. Null until the player starts. */
  readonly startedTick: number | null;
  /** Tick the run will end on, known from the moment it starts. */
  readonly resolveAtTick: number | null;
  /** Per beat index: has this beat been struck or slipped? Index 0 is the opener. */
  readonly resolved: readonly boolean[];
  /** Strokes and slips, in the order they happened. */
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
  /** Did the work get done? False for TORN and for an abandoned run. */
  readonly posted: boolean;
  readonly score: BeatScore;
  readonly strikes: readonly StrikeRecord[];
  /** Loudest single noise the run produced. The one number stealth cares about. */
  readonly loudestIntensity: number;
  /** Ticks from the opening stroke to the resolve. Zero if never started. */
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
  /** Which beat, for struck and slipped. */
  readonly beatIndex?: number;
  readonly judgement?: BeatJudgement;
  /** Signed ticks from the beat. Negative is early. */
  readonly offsetTicks?: number;
  readonly grade?: BeatGrade;
}

export interface BeatInput {
  /** The container's fixed-step tick index. */
  readonly tick: number;
  /**
   * A stroke was pressed on this tick.
   *
   * EDGE TRIGGERED, and the container owns that. A held key delivered as `true`
   * every tick would read as sixty strokes a second, which the judge would
   * correctly score as fifty-nine strays and one hit. See mount.ts.
   */
  readonly strike: boolean;
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
  const chart = deriveChart(spec.chart, seed);
  return {
    spec,
    chart,
    phase: "STANCE",
    startedTick: null,
    resolveAtTick: null,
    resolved: chart.offsets.map(() => false),
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
  const score = scoreStrikes(run.records, run.chart.judgedBeats);
  const grade = gradeFor(score, run.spec.thresholds);
  const outcome: BeatOutcome = {
    specId: run.spec.id,
    chartSpecId: run.chart.specId,
    seed: run.chart.seed,
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
  // Walking out of the stance mid-chart abandons the run rather than tearing the
  // sheet. The work simply is not done: the player can come back and start
  // again, against the same chart, having already spent whatever noise they
  // made. Re-derivation from the attempt seed is what makes that safe — see
  // chart.ts on why a re-entry must not re-roll.
  //
  // Only MID-CHART, though. Once every beat is resolved the tacks are in, and
  // the settle is a follow-through animation rather than work still being done —
  // so a player who turns to leave on the last stroke keeps the result they
  // earned. Losing a finished beat to a keypress during its own flourish is the
  // kind of thing nobody would ever guess was a rule.
  if (input.abandon || (!input.inStance && run.phase === "STRIKING")) {
    const ended = finish(run, input.tick, true);
    events.push({ type: "abandoned", grade: ended.outcome.grade });
    return { run: ended.run, events, noise, outcome: ended.outcome };
  }

  // ---- the opening stroke --------------------------------------------------
  if (run.phase === "STANCE") {
    if (!input.inStance || !input.strike) {
      return { run, events, noise, outcome: null };
    }
    const resolved = [...run.resolved];
    resolved[0] = true;
    run = {
      ...run,
      phase: "STRIKING",
      startedTick: input.tick,
      // Known at the moment of arming, so the presentation can draw the whole
      // commitment the player just made. Every beat has necessarily been struck
      // or slipped by span + the outer window; the settle is the follow-through.
      resolveAtTick:
        input.tick + run.chart.spanTicks + HIT_WINDOW_TICKS + verb.settleTicks,
      resolved,
    };
    emit(OPENING_STROKE_JUDGEMENT);
    events.push({ type: "armed", beatIndex: 0 });
    return { run, events, noise, outcome: null };
  }

  const startedTick = run.startedTick!;

  // ---- beats that came and went -------------------------------------------
  //
  // Expiry is settled before the press, which is safe rather than merely
  // convenient: a beat only expires once the current tick is strictly past its
  // outer window, so nothing a press at this tick could still legally claim is
  // ever taken away from it first.
  const expired = expiredBeats(run.chart, startedTick, run.resolved, input.tick);
  if (expired.length > 0) {
    const resolved = [...run.resolved];
    const records = [...run.records];
    for (const index of expired) {
      resolved[index] = true;
      records.push({
        beatIndex: index,
        dueTick: startedTick + run.chart.offsets[index]!,
        struckTick: null,
        offsetTicks: null,
        judgement: "SLIP",
        quality: qualityOf("SLIP"),
      });
      events.push({ type: "slipped", beatIndex: index, judgement: "SLIP" });
    }
    run = { ...run, resolved, records };
    for (const _ of expired) emit("SLIP");
  }

  // ---- the stroke ----------------------------------------------------------
  if (input.strike) {
    const index = claimBeat(run.chart, startedTick, run.resolved, input.tick);
    if (index === null) {
      // A swing at nothing. It consumes no beat — stealing the next one would
      // punish a single slip twice — and its whole cost is the noise plus a
      // modest dent in the average, which is what stops mashing being free.
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
      events.push({ type: "strayed", judgement: "STRAY" });
    } else {
      const dueTick = startedTick + run.chart.offsets[index]!;
      const offsetTicks = input.tick - dueTick;
      const judgement = judgeOffset(offsetTicks)!;
      const resolved = [...run.resolved];
      resolved[index] = true;
      run = {
        ...run,
        resolved,
        records: [
          ...run.records,
          {
            beatIndex: index,
            dueTick,
            struckTick: input.tick,
            offsetTicks,
            judgement,
            quality: qualityOf(judgement),
          },
        ],
      };
      emit(judgement);
      events.push({ type: "struck", beatIndex: index, judgement, offsetTicks });
    }
  }

  // ---- the follow-through --------------------------------------------------
  const allSettled = run.resolved.every((done) => done);
  if (allSettled && run.phase === "STRIKING") {
    // Precision is paid back in tempo as well as in silence: a player who takes
    // every beat early finishes sooner than the backstop, which is a small,
    // felt reward for being ahead of the chart rather than behind it.
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
