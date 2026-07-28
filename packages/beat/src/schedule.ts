// The reaction schedule: which cell lights up, and when.
//
// This is the beat's ACTUAL mechanic, as opposed to `chart.ts`, which survives
// as the briefing's rhythmic description of the same act. A schedule is a short
// sequence of flares — one panel cell lit at a time — and it is a PURE FUNCTION
// of (spec, seed), drawn only from the engine's seeded kernel. That buys the
// three properties the rest of the game already depends on:
//
//   * an attempt replays — the netcode agent re-runs the same tick stream and
//     the same flares come up in the same places, so a recorded beat reproduces;
//   * a retry differs — the container reseeds per attempt, so the second run is
//     not a memorisation of the first; and
//   * a re-entry does NOT differ — stepping off the bough and back on re-derives
//     the identical schedule from the same attempt seed, so nothing can be
//     fished for by leaving and returning.
//
// WHY REACTION AND NOT TIMING. The player is thirteen, on whatever they have to
// hand, nailing a handbill up in the dark. What that moment wants is "see it,
// hit it" — noticing and clicking — not the sub-frame anticipation a rhythm
// window demands. So a flare is up for a wide window (see `REACTION_WINDOW_TICKS`)
// and the only thing being asked is that the player is watching. There is no
// early/late, no precision band, and no way to be "just barely off": a click on
// the lit cell inside its window is a hit, full stop.

import { fieldRandom, projectFieldSeed } from "./engine.js";

/** What a level authors for the reaction test. */
export interface BeatReactionSpec {
  /** Panel cells a flare can occupy. */
  readonly cellCount: number;
  /** Flares over the whole act. */
  readonly targetCount: number;
  /** Ticks a flare stays hittable. The reaction window. */
  readonly windowTicks: number;
  /** Base dark gap between a flare resolving and the next appearing. */
  readonly gapTicks: number;
  /** Seeded variation added to the gap, in ticks. */
  readonly gapJitterTicks: number;
  /** Ticks before the first flare, so the panel is read before it is played. */
  readonly leadTicks: number;
}

/** One flare in the schedule. Ticks are offsets from the tick the run armed. */
export interface ReactionTarget {
  readonly index: number;
  /** The panel cell this flare lights, 0..cellCount-1. */
  readonly cell: number;
  /** Offset from `startedTick` at which the flare appears. */
  readonly spawnTick: number;
  /** Offset from `startedTick` after which it has faded (a miss if unstruck). */
  readonly expireTick: number;
}

export interface ReactionSchedule {
  readonly targets: readonly ReactionTarget[];
  /** Offset of the last flare's expiry: the span the follow-through is added to. */
  readonly spanTicks: number;
}

/**
 * Pick a cell from a [0,1) roll, never repeating the previous one.
 *
 * Repeating a cell reads as "did it move or not", which is a worse question than
 * "where did it go", so the draw is over the OTHER cells — a uniform choice among
 * `cellCount - 1`. Deterministic for a given roll and previous cell.
 */
function pickCell(roll: number, cellCount: number, previous: number): number {
  if (cellCount <= 1) return 0;
  if (previous < 0) return Math.min(cellCount - 1, Math.floor(roll * cellCount));
  const among = cellCount - 1;
  let pick = Math.min(among - 1, Math.floor(roll * among));
  if (pick >= previous) pick += 1;
  return pick;
}

/**
 * Draw the reaction schedule for one attempt. Pure, total, seeded.
 *
 * The cell is drawn from `fieldRandom(seed, index, cellSalt)` and the gap jitter
 * from `fieldRandom(seed, index, gapSalt)`, so both the WHERE and the WHEN vary
 * with the seed and neither uses a wall clock or `Math.random`. Flares never
 * overlap: each one's window has fully closed before the next appears, so there
 * is exactly one lit cell at any moment and "click the lit one" is unambiguous.
 */
export function deriveSchedule(spec: BeatReactionSpec, seed: number): ReactionSchedule {
  const cellSalt = projectFieldSeed(["beat.reaction.cell"]) & 0xffff;
  const gapSalt = projectFieldSeed(["beat.reaction.gap"]) & 0xffff;
  const targets: ReactionTarget[] = [];
  let cursor = spec.leadTicks;
  let previous = -1;
  for (let index = 0; index < spec.targetCount; index++) {
    const cell = pickCell(fieldRandom(seed, index, cellSalt), spec.cellCount, previous);
    const spawnTick = cursor;
    const expireTick = spawnTick + spec.windowTicks;
    targets.push({ index, cell, spawnTick, expireTick });
    const jitter =
      spec.gapJitterTicks > 0
        ? Math.floor(fieldRandom(seed, index, gapSalt) * (spec.gapJitterTicks + 1))
        : 0;
    cursor = expireTick + spec.gapTicks + jitter;
    previous = cell;
  }
  const spanTicks = targets.length > 0 ? targets[targets.length - 1]!.expireTick : 0;
  return { targets, spanTicks };
}

/**
 * The most ticks a schedule can span, independent of the seed.
 *
 * Used to reserve the beat's cost against the mission clock. Every gap is taken
 * at its widest jitter, so this is a true ceiling rather than a typical run.
 */
export function reactionWorstCaseSpan(spec: BeatReactionSpec): number {
  if (spec.targetCount <= 0) return 0;
  const perGap = spec.gapTicks + spec.gapJitterTicks;
  return (
    spec.leadTicks +
    spec.targetCount * spec.windowTicks +
    (spec.targetCount - 1) * perGap
  );
}

/** Everything wrong with an authored reaction spec, as sentences. */
export function reactionSpecDefects(spec: BeatReactionSpec): string[] {
  const defects: string[] = [];
  if (!(spec.cellCount >= 2)) {
    defects.push(
      `the panel has ${spec.cellCount} cells; a reaction test needs at least two so a ` +
        "flare can move somewhere",
    );
  }
  if (!(spec.targetCount >= 1)) {
    defects.push(`the schedule has ${spec.targetCount} flares, so there is nothing to strike`);
  }
  if (!(spec.windowTicks > 0)) {
    defects.push("the flare window is not positive, so nothing is ever hittable");
  }
  if (spec.gapTicks < 0 || spec.gapJitterTicks < 0 || spec.leadTicks < 0) {
    defects.push("a gap, jitter or lead is negative");
  }
  return defects;
}
