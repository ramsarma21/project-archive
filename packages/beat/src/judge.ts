// Judgement: what a stroke was worth, and which beat it belonged to.
//
// Everything here is integer tick arithmetic. There is no interpolation, no
// sub-tick estimate and no wall-clock reading, so two machines replaying the
// same press stream produce byte-identical judgements.

import {
  FLUSH_WINDOW_TICKS,
  GLANCING_WINDOW_TICKS,
  HIT_WINDOW_TICKS,
  MIN_STRIKE_QUALITY,
  STRAY_QUALITY_PENALTY,
  STRIKE_QUALITY,
  TRUE_WINDOW_TICKS,
} from "./tuning.js";
import type { BeatChart } from "./chart.js";

/**
 * What one stroke was.
 *
 * The first three are strokes that landed on a beat, graded by how close. SLIP
 * is a beat that came and went with no stroke at all. STRAY is a stroke that
 * landed on no beat — a swing at nothing, which is a different mistake and gets
 * a different consequence.
 */
export type BeatJudgement = "FLUSH" | "TRUE" | "GLANCING" | "SLIP" | "STRAY";

/** Judgements that came from the player actually connecting with a beat. */
export const CONNECTED_JUDGEMENTS: ReadonlySet<BeatJudgement> = new Set<BeatJudgement>([
  "FLUSH",
  "TRUE",
  "GLANCING",
]);

/**
 * Grade a signed tick offset from a beat. Negative is early, positive is late.
 * Returns null when the offset is outside every window.
 *
 * The ladder is walked inward-out and the tightest containing band wins, which
 * is only well defined because `assertWindowsNest` guarantees they nest.
 */
export function judgeOffset(offsetTicks: number): BeatJudgement | null {
  const distance = Math.abs(offsetTicks);
  if (distance <= FLUSH_WINDOW_TICKS) return "FLUSH";
  if (distance <= TRUE_WINDOW_TICKS) return "TRUE";
  if (distance <= GLANCING_WINDOW_TICKS) return "GLANCING";
  return null;
}

/** What a judgement is worth toward the average. */
export function qualityOf(judgement: BeatJudgement): number {
  switch (judgement) {
    case "FLUSH":
      return STRIKE_QUALITY.FLUSH;
    case "TRUE":
      return STRIKE_QUALITY.TRUE;
    case "GLANCING":
      return STRIKE_QUALITY.GLANCING;
    default:
      // A dropped beat is worth nothing, and a stray is not a beat at all: it is
      // accounted for as a penalty rather than as a term in the average, because
      // averaging it in would make a chart with more strays look shorter.
      return 0;
  }
}

/** One resolved stroke, or one beat that went by. */
export interface StrikeRecord {
  /** Index into the chart's offsets. -1 for a stray, which belongs to no beat. */
  readonly beatIndex: number;
  /** The tick this beat was due, absolute. -1 for a stray. */
  readonly dueTick: number;
  /** The tick the player struck, absolute. Null for a SLIP. */
  readonly struckTick: number | null;
  /** Signed ticks from the beat. Negative is early. Null for a SLIP. */
  readonly offsetTicks: number | null;
  readonly judgement: BeatJudgement;
  readonly quality: number;
}

/**
 * Which beat a press claims.
 *
 * THE OVERLAP RULE, and it is load-bearing. A DOUBLE puts two beats twelve ticks
 * apart while the outer window is nine ticks either side, so their windows
 * overlap by six ticks and a press in that overlap is genuinely ambiguous.
 * Taking the EARLIEST unresolved beat in range resolves it the way every rhythm
 * game does and the way a player expects: the first press of a pair takes the
 * first note. Anything else — nearest beat, say — would let a slightly-late
 * first press steal the second note and leave the first to slip, which reads as
 * the game inventing a mistake the player did not make.
 */
export function claimBeat(
  chart: BeatChart,
  startedTick: number,
  resolved: readonly boolean[],
  pressTick: number,
): number | null {
  for (let index = 1; index < chart.offsets.length; index++) {
    if (resolved[index]) continue;
    const due = startedTick + chart.offsets[index]!;
    if (Math.abs(pressTick - due) <= HIT_WINDOW_TICKS) return index;
  }
  return null;
}

/**
 * Beats whose window has closed unstruck as of `tick`.
 *
 * A beat slips the tick AFTER its window ends rather than on the last tick of
 * it, so a press on the final legal tick is always still a hit. Off-by-one here
 * would silently narrow every window by a frame.
 */
export function expiredBeats(
  chart: BeatChart,
  startedTick: number,
  resolved: readonly boolean[],
  tick: number,
): number[] {
  const out: number[] = [];
  for (let index = 1; index < chart.offsets.length; index++) {
    if (resolved[index]) continue;
    const due = startedTick + chart.offsets[index]!;
    if (tick > due + HIT_WINDOW_TICKS) out.push(index);
  }
  return out;
}

export interface BeatScore {
  /** Mean quality over the judged beats, less the stray penalty. [0,1]. */
  readonly quality: number;
  /** Mean before strays were charged. Reported so the two costs stay legible. */
  readonly strokeQuality: number;
  /** The worst single beat. The mission slate's "minimum phase quality". */
  readonly worstStrikeQuality: number;
  readonly flush: number;
  readonly trueStrikes: number;
  readonly glancing: number;
  readonly slips: number;
  readonly strays: number;
  /** Beats that carried a window. Strays are not counted here. */
  readonly judged: number;
}

export function scoreStrikes(
  records: readonly StrikeRecord[],
  judgedBeats: number,
): BeatScore {
  let total = 0;
  let flush = 0;
  let trueStrikes = 0;
  let glancing = 0;
  let slips = 0;
  let strays = 0;
  let worst = judgedBeats > 0 ? 1 : 0;

  for (const record of records) {
    if (record.judgement === "STRAY") {
      strays += 1;
      continue;
    }
    total += record.quality;
    if (record.quality < worst) worst = record.quality;
    if (record.judgement === "FLUSH") flush += 1;
    else if (record.judgement === "TRUE") trueStrikes += 1;
    else if (record.judgement === "GLANCING") glancing += 1;
    else slips += 1;
  }

  // Beats that have not happened yet count as nothing, so a score read mid-chart
  // is a live floor rather than an optimistic guess. The denominator is the whole
  // chart on purpose: a run abandoned three beats in has not scored 1.0.
  const strokeQuality = judgedBeats > 0 ? total / judgedBeats : 0;
  const quality = Math.max(0, strokeQuality - strays * STRAY_QUALITY_PENALTY);
  return {
    quality,
    strokeQuality,
    worstStrikeQuality: worst,
    flush,
    trueStrikes,
    glancing,
    slips,
    strays,
    judged: flush + trueStrikes + glancing + slips,
  };
}

/**
 * How the work reads when it is done.
 *
 * SILENT is the ceiling and it is defined by the noise rather than by the score:
 * every judged stroke FLUSH, no strays, and therefore — by the guarantee in
 * tuning.ts — not one sound the field could hear. That is the result only a
 * genuinely good player gets, and it is worth naming because it is the thing
 * they are practising toward.
 *
 * TORN is the mission slate's terminal precision failure. Everything between is
 * a sheet that went up, well or badly.
 */
export type BeatGrade = "SILENT" | "CLEAN" | "RAGGED" | "TORN";

export interface BeatGradeThresholds {
  /** Mean quality at or above which the work reads as properly done. */
  readonly passQuality: number;
  /** Below this the sheet tears and the attempt is spent. */
  readonly tornQuality: number;
}

export function gradeFor(
  score: BeatScore,
  thresholds: BeatGradeThresholds,
): BeatGrade {
  if (score.quality < thresholds.tornQuality) return "TORN";
  // Every tack has to be in. A dropped stroke is not a matter of degree: the
  // corner is loose whatever the average says, which is also exactly what the
  // authored "minimum phase quality" was asking for, since SLIP is the only
  // judgement below it.
  if (score.worstStrikeQuality < MIN_STRIKE_QUALITY) return "RAGGED";
  if (score.quality < thresholds.passQuality) return "RAGGED";
  if (score.flush === score.judged && score.strays === 0 && score.judged > 0) {
    return "SILENT";
  }
  return "CLEAN";
}

/** Did the sheet go up at all? The mission's objective reads this. */
export function gradePosted(grade: BeatGrade): boolean {
  return grade !== "TORN";
}
