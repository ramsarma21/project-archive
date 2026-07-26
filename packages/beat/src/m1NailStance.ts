// M1's beat: nailing the handbill to the Liberty Tree.
//
// Fourteen hammer strokes into the bole beside the effigy, eight metres up,
// torches under it, a crowd that will not disperse below, and a constable
// working Orange Street directly beneath the tree. There is nothing to read and
// nothing to know — it is pure timing, and it is the mission's one
// mechanical-skill expression.
//
// WHY THIS SPOT MAKES THE MECHANIC WORK, and it is not an accident of authoring.
// `CONSTABLE_ORANGE` walks x from 86 to 63 at z ≈ 0, so his path passes about a
// third of a metre from the stance in plan — he goes directly under the player.
// `LIGHT_LIBERTY_CORNER` puts the whole corner at 0.85, and the authored note on
// it says so outright: the torches "are why the precision beat happens somewhere
// you can be seen". A botched stroke is therefore heard by somebody who is close
// enough to look up, in light bright enough to resolve a body. Noise brings the
// cone around; the light finishes the job. Neither half is this package's doing
// and both were already there.
//
// WHERE THIS FILE BELONGS EVENTUALLY. These coordinates mirror `PRECISION` in
// @pa/mission-m1's opposition.ts, and content belongs with its level. It lives
// here for now because the level package is owned by another workstream, and
// because a beat spec is the natural thing to hand back once the system it is
// written against exists. `m1NailStanceBeat` takes its geometry as arguments for
// exactly that reason: when mission-m1 adopts it, it passes its own numbers and
// there is no second source of truth to drift.

import {
  FIVE_TO_THE_BAR,
  FOUR_TO_THE_BAR,
  THREE_TO_THE_BAR,
  defineChart,
  evenly,
  weighted,
  type BeatChartSpec,
} from "./chart.js";
import {
  BAR_TICKS,
  DEFAULT_PASS_QUALITY,
  DEFAULT_TORN_QUALITY,
  HIT_WINDOW_TICKS,
} from "./tuning.js";
import { DRIVE_FASTENER } from "./verbs.js";
import { beatWorstCaseTicks, type BeatSpec } from "./spec.js";
import type { Vec3 } from "./engine.js";

/** Mirrors `PRECISION.stance` — the bough the player works from. */
export const M1_NAIL_STANCE: Vec3 = { x: 79.6, y: 8.3, z: 0.4 };
/** Mirrors `PRECISION.target` — the nail face on the west side of the bole. */
export const M1_NAIL_TARGET: Vec3 = { x: 80.15, y: 9.45, z: 0.55 };

/**
 * The objective this beat gates.
 *
 * The same id M1 already uses, so swapping the proximity predicate for
 * `beatObjective` changes what the objective MEANS without changing what the
 * save record, the HUD or the result screen call it.
 */
export const M1_POST_OBJECTIVE_ID = "post-the-handbill";

/**
 * M1's chart: fourteen strokes, thirteen of them judged, over three bars.
 *
 * WHY IT IS THIS LONG, because the previous chart was five judged strokes and
 * that is the number the design audit called vestigial. Five judged strokes once
 * per attempt is fifteen timed inputs across a mission's whole three-attempt
 * lifetime, and nobody gets better at something they do five times. Thirteen is
 * thirty-nine across the lifetime, and — more to the point — it is long enough
 * to be a PHRASE: an opening that teaches, a middle that settles, and an ending
 * that tests. Five strokes could only ever be a sample.
 *
 * WHY IT IS NOT LONGER. A competent run of M1 uses 167.9 of the 180-second
 * clock, so there is about twelve seconds unspent and a longer chart competes
 * directly with route content. Three bars costs 6.25 seconds worst case against
 * the 3.65 the five-stroke chart cost — 2.6 seconds of the twelve for 2.6x the
 * judged input. A fourth bar would buy five more strokes for another 1.6s, and
 * at that point the beat is eating a third of the level's remaining headroom to
 * repeat a lesson it has already taught.
 *
 * THE SHAPE, and every part of it is a decision:
 *
 *   The opening is a LONG — one full approach. The player strikes, one mark is
 *   born at the far end of the lane and travels the whole way, and they strike
 *   again when it arrives. That is the entire tutorial, and it teaches the
 *   travel SPEED rather than merely the target, which is what every mark after
 *   it depends on.
 *
 *   SET is three strokes to the bar and carries no spike at all. It is where the
 *   player finds the pulse, and nothing in it can punish somebody who has not
 *   found it yet.
 *
 *   DRIVE is four to the bar: the home rate, weighted toward the plain hammering
 *   figure so the chart sounds like work. At most one snap in the bar.
 *
 *   CORNER is five to the bar, which is as dense as the half-pulse grid allows,
 *   and every figure at that density carries exactly two spikes by arithmetic.
 *   The hardest thing in the chart is the last thing in it, the player has heard
 *   two bars of the pulse before it arrives, and they can see it coming in the
 *   preview before they ever commit.
 *
 * The chart is 336 ticks — 5.6 seconds — ON EVERY SEED. That is not a tidiness
 * point. The beat is spent inside a patrol gap the player has to judge, and a
 * commitment whose length is a dice roll is a commitment nobody can judge; a
 * fixed one is the precondition for the constable's window ever being a real
 * constraint.
 */
export const M1_HANDBILL_CHART: BeatChartSpec = defineChart({
  id: "BOS.MD01.BEAT.POST_HANDBILL.v2",
  barTicks: BAR_TICKS,
  openingCell: "LONG",
  spikeCell: "DOUBLE",
  phases: [
    {
      id: "SET",
      bars: 1,
      figures: evenly(THREE_TO_THE_BAR),
      note: "Finding the pulse. No spike can appear here.",
    },
    {
      id: "DRIVE",
      bars: 1,
      // The plain bar is the one the phase should mostly sound like; the five
      // snapped variants share the rest between them, so a DOUBLE is a thing
      // that happens rather than a thing that is expected.
      figures: weighted(FOUR_TO_THE_BAR, { PPPP: 5 }),
      note: "The work. The home rate, with at most one snap in the bar.",
    },
    {
      id: "CORNER",
      bars: 1,
      figures: evenly(FIVE_TO_THE_BAR),
      note: "The last corner, with him closer than he was. Two spikes, always.",
    },
  ],
});

export interface M1NailStanceOptions {
  /** Defaults to the authored bough position. */
  readonly stance?: Vec3;
  /** Defaults to the authored nail face. */
  readonly target?: Vec3;
}

/**
 * The authored beat, ready to mount.
 *
 * Facing is DERIVED from the stance and the target rather than authored a second
 * time. `PRECISION.facingYaw` is `atan2(0.55, 0.15)`, which is precisely
 * `atan2(target.x - stance.x, target.z - stance.z)` under this repo's yaw
 * convention — so restating it as a literal would be one more number that can
 * quietly disagree with the two it is computed from.
 */
export function m1NailStanceBeat(options: M1NailStanceOptions = {}): BeatSpec {
  const stance = options.stance ?? M1_NAIL_STANCE;
  const target = options.target ?? M1_NAIL_TARGET;
  return {
    id: "BOS.MD01.ACT.POST_HANDBILL.v1",
    verb: DRIVE_FASTENER,
    chart: M1_HANDBILL_CHART,
    stance,
    target,
    facingYaw: Math.atan2(target.x - stance.x, target.z - stance.z),
    // Sixty degrees. The player has to be looking at the tree, not holding a
    // heading: see the note on the field in spec.ts.
    facingToleranceRad: Math.PI / 3,
    // The bough deck is 4.8m across, so this is comfortably inside it and the
    // player is never nudged out of the beat by the idle sway of a landing.
    stanceRadiusM: 1.1,
    stanceHeightToleranceM: 1,
    thresholds: {
      // The mission slate's authored figure, kept.
      passQuality: DEFAULT_PASS_QUALITY,
      tornQuality: DEFAULT_TORN_QUALITY,
    },
    note:
      "Three bars of rising density into the bole beside the effigy, with the " +
      "constable coming up Orange Street underneath. Nothing to read; it is pure " +
      "timing, and every stroke that is not centred is a noise he can hear.",
  };
}

/**
 * Ticks of mission clock this beat costs, for the pacing report.
 *
 * Called a worst case because it assumes the player takes the final beat at the
 * outer edge of its window; the chart itself is the same length on every seed,
 * so this is a fixed reservation rather than a bound on a distribution. It is
 * 375 ticks — 6.25 seconds — and 366 of those are unavoidable.
 *
 * WHAT IT COSTS THE LEVEL. The five-stroke chart this replaced reserved 219
 * ticks (3.65s), so the beat now asks the mission clock for 2.6 seconds more
 * than it did. A competent run of M1 was measured at 167.9 seconds against a
 * 180-second clock, so that 2.6 comes out of about twelve seconds of headroom
 * and leaves nine and a half. It buys the chart 2.6x the judged input.
 *
 * It does NOT include the time the player spends in stance deciding when to
 * start. That is traversal they are choosing to spend watching a patrol, and
 * charging it to the beat would make the pacing budget claim the mechanic is
 * slower than it is.
 */
export const M1_BEAT_WORST_CASE_TICKS = beatWorstCaseTicks(m1NailStanceBeat());

/**
 * A costed second encounter, drawn but not placed.
 *
 * WHY THIS IS HERE AND WHAT IT IS NOT. Everything above makes M1's one beat as
 * much of a skill as one location can hold, and one location cannot hold enough:
 * a chart played once per attempt is a test, and what makes rhythm pleasurable
 * is returning to the same skill at rising difficulty. That needs a second place
 * in the level, which is not this package's to choose. So this is the SHAPE and
 * the PRICE of a second beat, ready for whoever picks the spot — no coordinates,
 * no verb, no opinion about which authored action should carry it.
 *
 * One bar at the home rate, behind the same full-approach opening: five judged
 * strokes over 144 ticks, which with the outer window and a hammer's
 * follow-through is 183 ticks — 3.05 seconds. That is LESS than the 3.65 the
 * old single beat reserved, for the same five judged strokes, and it would take
 * the mission from thirteen judged strokes an attempt to eighteen.
 *
 * The one-bar shape is also the floor. Anything shorter is not a smaller rhythm
 * test, it is a different mechanic: with the opening stroke unjudged, a
 * three-stroke chart offers two judged beats, and two is not enough to entrain
 * to a pulse — the player reads each mark cold, which is a reaction test, and
 * reaction tests do not reward the anticipation the tight windows are built for.
 */
export const M1_SECOND_BEAT_CHART: BeatChartSpec = defineChart({
  id: "BOS.MD01.BEAT.SECOND.v1",
  barTicks: BAR_TICKS,
  openingCell: "LONG",
  spikeCell: "DOUBLE",
  phases: [
    {
      id: "BURST",
      bars: 1,
      // The plain hammering bar is dropped, so the single bar always has teeth.
      // A one-bar chart has nowhere to put a spike later.
      figures: evenly(FOUR_TO_THE_BAR.filter((entry) => entry.cells.includes("DOUBLE"))),
      note: "One bar at the home rate, always with a snap in it.",
    },
  ],
});

/**
 * What the second beat would cost the clock, quoted against a hammer.
 *
 * The verb is a stand-in: whichever action the level gives this to supplies its
 * own fiction and its own loudness, and the only thing a verb contributes to the
 * price is its follow-through. Any plausible one is within a few ticks of this.
 */
export const M1_SECOND_BEAT_TICKS =
  M1_SECOND_BEAT_CHART.spanTicks + HIT_WINDOW_TICKS + DRIVE_FASTENER.settleTicks;
