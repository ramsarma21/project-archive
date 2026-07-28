// Every tuning number the precision beat has, in one file, in ticks.
//
// THERE ARE NO MILLISECONDS IN THIS PACKAGE. Windows, gaps, approach and span
// are integer counts of the engine's fixed step, and the millisecond figures in
// the comments are conversions for a human reader, never a second source of
// truth. That is not fastidiousness: the netcode agent's replay and the PvP
// authority both re-run a simulation from a tick index, and a window expressed
// in wall time is a window that resolves differently on two machines.
//
// ONE DIFFICULTY. Nothing here is scaled by a player, an attempt, a level or a
// mode. The skill expression is entirely in how tight FLUSH is, and the same
// FLUSH is offered to everybody.

import { FIELD_TICK_HZ } from "./engine.js";

const ticks = (seconds: number): number => Math.round(seconds * FIELD_TICK_HZ);

// ---- the judgement windows -------------------------------------------------
//
// Half-widths, in ticks, either side of a beat's tick. They nest: a press inside
// FLUSH is also inside TRUE, and the tightest containing band wins.
//
// THIS LADDER IS THE ENTIRE SKILL CEILING OF THE MECHANIC, so it is worth being
// explicit about what each rung is for.
//
// GLANCING is the "did you swing at roughly the right moment" band. At a sixth
// of a second it is wide enough that a thirteen-year-old on a school Chromebook
// connects with every stroke on their first attempt, which is the floor the
// design requires: the beat must never be the reason a player cannot finish a
// mission they otherwise played well.
//
// FLUSH is the ceiling, and it is deliberately brutal — two ticks is thirty-three
// milliseconds, about osu!'s OD8 hit-300. It is reachable because rhythm
// precision is ANTICIPATORY rather than reactive: the player is not responding
// to the mark arriving, they are predicting it, and prediction has no 200ms
// human reaction floor. That is the whole reason a rhythm window can be tighter
// than any reflex test would be allowed to be.
//
// TRUE sits between them so the ladder has a middle. Without it the feedback is
// binary — perfect or sloppy — and a player improving from 140ms to 90ms would
// see no evidence that they were getting better, which is the fastest way to
// stop somebody practising.

/** Dead centre. Thirty-three milliseconds. The ceiling. */
export const FLUSH_WINDOW_TICKS = 2;
/** Eighty-three milliseconds. A good stroke. */
export const TRUE_WINDOW_TICKS = 5;
/** A hundred and fifty milliseconds. Connected, but the head skidded. */
export const GLANCING_WINDOW_TICKS = 9;

/**
 * The outermost band. A press further than this from every unresolved beat is
 * not a bad strike, it is a strike at nothing — see `STRAY` in judge.ts.
 */
export const HIT_WINDOW_TICKS = GLANCING_WINDOW_TICKS;

// ---- the pulse grid --------------------------------------------------------
//
// Charts are built on a grid rather than from free intervals, because a rhythm
// with no underlying pulse is a reaction test with extra steps: the player has
// nothing to entrain to, so every beat is read cold and the tight windows become
// a lottery. A grid means a player who has heard two strokes can predict the
// third, which is what makes practice pay.
//
// 24 ticks is 400ms, or 150bpm. That is a hammering cadence a person can
// actually produce with their arm, which matters when the fiction is a hammer.

/** One pulse of the grid. */
export const PULSE_TICKS = 24;
/** Half a pulse. The tightest interval any chart may author. */
export const HALF_PULSE_TICKS = PULSE_TICKS / 2;

/**
 * One bar: four pulses, 1.6 seconds, a 4/4 bar at 150bpm.
 *
 * THIS IS THE UNIT A CHART IS BUILT AND BUDGETED IN, and it does two jobs that
 * a free run of intervals cannot.
 *
 * It gives the player a downbeat. Every bar of a chart is filled by a figure
 * whose intervals sum to exactly this, so there is a stroke on the bar line
 * every 1.6 seconds no matter what the seed drew. That is the thing a player
 * entrains to: the interior of a bar can be dense, dotted or spiked and the
 * downbeat still arrives when they expect it, which is what makes a hard bar
 * readable rather than a scramble.
 *
 * It makes a chart's length exact. A chart is a whole number of bars plus its
 * opening interval, so `spanTicks` is the same on every seed and the pacing
 * budget charges what the beat actually costs instead of a worst case it almost
 * never reaches. That matters more than bookkeeping: the beat is played in a
 * patrol gap the player has to judge, and a commitment whose length varies by
 * two seconds depending on the draw is a commitment nobody can judge.
 */
export const BAR_TICKS = PULSE_TICKS * 4;

/**
 * How long before its tick a beat becomes visible and readable.
 *
 * 0.8s is the read. It is long enough to see a mark travel and predict where it
 * lands, and short enough that a DOUBLE's two marks are both in flight at once
 * and therefore visibly a pair rather than a surprise.
 *
 * It is also the denominator of `approach01` in the presentation, which is what
 * a renderer converts into a position on a lane. Changing it changes how fast
 * marks travel and nothing else about the mechanic: the windows are absolute
 * tick counts, so a longer approach makes the target band look narrower without
 * making it narrower.
 */
export const APPROACH_TICKS = ticks(0.8);

// ---- what a judgement is worth ---------------------------------------------
//
// A GLANCING stroke is worth exactly `MIN_STRIKE_QUALITY`, and that is the
// arithmetic that makes the authored "minimum phase quality 0.5" from the
// mission slate mean something physical: every judgement except a dropped one
// clears the bar, so "no strike below the minimum" and "no tack was missed" are
// the same sentence.

export const STRIKE_QUALITY = {
  FLUSH: 1,
  TRUE: 0.8,
  GLANCING: 0.5,
  /** The window closed with no stroke. The tack is not in. */
  SLIP: 0,
} as const;

/** The floor a strike must clear for the work to count as properly done. */
export const MIN_STRIKE_QUALITY = STRIKE_QUALITY.GLANCING;

/**
 * Quality removed per stray blow.
 *
 * Deliberately modest, because the stray's real punishment is not this number —
 * it is the noise. A player who mashes is not docked into failure, they are
 * heard, and being heard under a torchlit elm with a constable coming up the
 * street costs them the mission in a way a score cannot. This exists only so
 * that mashing cannot be strictly better than not mashing on the sheet itself.
 */
export const STRAY_QUALITY_PENALTY = 0.12;

// ---- noise: the coupling ---------------------------------------------------
//
// THIS TABLE IS THE POINT OF THE WHOLE PACKAGE, so it gets the long comment.
//
// A rhythm minigame that subtracts points for a missed beat could be lifted out
// of this game and dropped into any other one. What makes this beat belong to a
// stealth mission is that the cost of imprecision is paid in the stealth field's
// own currency: a mistimed hammer stroke is LOUD, and loud is a thing the world
// already knows how to react to. Nothing new had to be invented for it — these
// are ordinary `PLAYER_MOVE` noise events, exactly like a vault or a landing,
// and the field treats them exactly the same way.
//
// The consequences, spelled out, because they were designed rather than
// discovered:
//
//   * `noiseImplicatesPlayer("PLAYER_MOVE")` is true, so this noise points a
//     watcher AT the player's stance rather than away from it. It is the
//     opposite of a thrown bottle, and it should be: you made it, standing where
//     you are standing, with a hammer.
//   * The stealth field's `noiseSuspicionCeiling` means noise alone can never
//     complete a detection. A botched beat cannot get the player caught by
//     itself; it brings a watcher over, turns his cone onto the tree, and hands
//     the rest of the job to his eyes. That is the correct severity: a mistake
//     that changes the situation, not a mistake that ends the run.
//   * Loudness scales with how far off the stroke was, continuously. There is no
//     cliff between "fine" and "heard", which is what makes getting a little bit
//     better worth something on every attempt rather than only at a threshold.
//
// THE NUMBERS ARE CHOSEN AGAINST THE FIELD'S OWN CONSTANTS, not by feel.
// Audibility is `intensity * (1 - distance/radius)` and a noise below
// `STEALTH_TUNING.minAudibleNoise` is ignored outright, so:
//
//   FLUSH is below that floor AT ZERO DISTANCE. A dead-centre stroke is not
//   quiet, it is INAUDIBLE — provably, to a watcher standing in the tree with
//   you. That is the reward for the ceiling and it is a guarantee rather than a
//   tuning, which is why `assertFlushIsInaudible` refuses to let the package
//   load if a later edit breaks it.
//
//   TRUE carries about 1.7m. In M1 that means it is heard only by a watcher who
//   is very nearly underneath the elm, so good-but-not-perfect play is safe
//   most of the time and occasionally is not — which is exactly the pressure
//   that makes WHEN you start the beat a real decision.
//
//   STRAY carries about 8.7m and lands roughly six tenths of a suspicion bar on
//   anybody directly below. One is a warning. Two is an investigation.
//
// NOTHING IN THIS TABLE IS SCALED BY CHART LENGTH, and that is deliberate even
// though the chart is now thirteen judged strokes rather than five. The price of
// one mistake should not depend on how many chances the player was given to make
// it; what a longer chart changes is the number of chances, which is the honest
// cost of a longer commitment and the reason choosing a patrol gap is worth
// doing. The two ends hold at any length: a centred stroke is inaudible however
// many of them there are, and the field's own `noiseSuspicionCeiling` still caps
// what noise alone can build, so a chart mashed from end to end brings a watcher
// over and cannot finish the job.
//
// One thing does follow from the chart's shape rather than from this table. The
// field only starts forgiving a noise after `decayHoldTicks` of quiet, so the
// loose gaps of an opening bar let an early mistake bleed off and the closing
// bar — where nothing is longer than a pulse — lets nothing bleed off at all.
// The chart is at its most expensive exactly where it is hardest, which is the
// right way round and cost nothing to arrange.

export const STRIKE_NOISE = {
  /** Below the field's audibility floor at any distance. Genuinely silent. */
  FLUSH: 0.04,
  TRUE: 0.12,
  GLANCING: 0.3,
  /** A tack left half-driven; the sheet slips and the head rings off the bark. */
  SLIP: 0.45,
  /** A full-force swing at nothing. The loudest thing this verb can produce. */
  STRAY: 0.62,
} as const;

// ---- outcome grades --------------------------------------------------------

/**
 * Average quality needed for the work to read as properly done.
 *
 * 0.70 is the mission slate's authored figure and it is kept. What it buys is a
 * mix rather than a count: a fifth of the chart centred, two fifths good and two
 * fifths skidded averages 0.72 and clears, at any chart length. That is a real
 * first-attempt result for somebody paying attention, which is the floor the
 * design wants. A player who connects with everything but centres nothing
 * averages 0.50 and does not.
 *
 * The mark means MORE on a long chart than it did on a short one. Over five
 * strokes a single lucky FLUSH moved the average by 0.10, so the pass mark was
 * partly a measurement of the seed; over thirteen it moves it by 0.04, and what
 * clears the bar is the player.
 */
export const DEFAULT_PASS_QUALITY = 0.7;

/**
 * Below this the work is not merely poor, it has failed: the sheet tears and
 * §4.11's terminal precision failure applies.
 *
 * The gap between this and the pass mark is the RAGGED band, and it exists so
 * that a bad beat costs the player the quality of their result and their cover
 * rather than three minutes of traversal. A single dropped stroke should not
 * discard a clean run up the roofline; four dropped strokes should.
 */
export const DEFAULT_TORN_QUALITY = 0.4;

// ---- the reaction test -----------------------------------------------------
//
// M1's beat is a STORY MOMENT, not a skill check: the player is nailing a
// handbill to the Liberty Tree in the dark with the watch out, and it should
// feel like a tense, quick act of defiance that a first-time player passes
// comfortably. The old anticipatory-timing chart (±33ms FLUSH windows) lived on
// in `chart.ts` as the briefing's own description of the work, but the thing the
// player actually does is now a REACTION test: flares come up on a holographic
// panel one at a time, and the player clicks the lit one before it fades.
//
// Every number here is deliberately generous. Reaction — noticing a thing and
// acting on it — has a ~250ms human floor, so a window has to be MUCH wider than
// a rhythm window to be fair, and these are wider still. Nothing here is scaled
// by a player, an attempt or a mode: one difficulty, offered to everybody, and
// it is the bottom of the curve because this is mission one.

/** Panel cells a flare can appear on. Six is a comfortable 3x2 cluster. */
export const REACTION_CELL_COUNT = 6;

/** Flares to strike over the whole act. Enough to feel like hammering, not a test. */
export const REACTION_TARGET_COUNT = 6;

/**
 * How long a flare stays hittable, in ticks. 84 is 1.4 seconds — more than five
 * times a trained reaction and a comfortable margin over an inattentive one, so
 * a player who is looking at the panel connects every time and one who glances
 * away still usually does. This is the "hit window" the mechanic is judged on,
 * and it is wide by design: success comes from noticing, never from timing.
 */
export const REACTION_WINDOW_TICKS = 84;

/** Dark gap after a flare resolves before the next appears. 0.3s to let the eye reset. */
export const REACTION_GAP_TICKS = 18;

/**
 * Seeded variation on the gap, in ticks, so the rhythm is not a metronome the
 * player can play with their eyes shut — the flare has to be genuinely reacted
 * to. Drawn from `fieldRandom`, so it is replay-stable like everything else.
 */
export const REACTION_GAP_JITTER_TICKS = 12;

/** Lead-in before the first flare, so the panel is read before it is played. 0.5s. */
export const REACTION_LEAD_TICKS = 30;

// ---- load-time guards ------------------------------------------------------

/**
 * Refuses a window ladder that does not nest.
 *
 * `judgeOffset` walks the bands outward and returns the first one that contains
 * the offset, so an unsorted ladder would silently make a rung unreachable —
 * FLUSH wider than TRUE means no press is ever judged TRUE, every readout still
 * renders, and every test that only checks "a centred press is FLUSH" passes.
 * That is the shape of failure this package is most likely to acquire by
 * accident, so it fails at import instead.
 */
export function assertWindowsNest(): void {
  if (
    !(
      FLUSH_WINDOW_TICKS > 0 &&
      FLUSH_WINDOW_TICKS < TRUE_WINDOW_TICKS &&
      TRUE_WINDOW_TICKS < GLANCING_WINDOW_TICKS
    )
  ) {
    throw new Error(
      `the judgement windows must nest strictly: FLUSH ${FLUSH_WINDOW_TICKS} < ` +
        `TRUE ${TRUE_WINDOW_TICKS} < GLANCING ${GLANCING_WINDOW_TICKS}. As written, ` +
        `at least one grade can never be awarded and nothing would report that.`,
    );
  }
}

/**
 * Refuses a FLUSH loudness the stealth field could hear.
 *
 * The ceiling of this mechanic is "a perfect beat makes no sound at all", and
 * the whole of that promise rests on one inequality against a constant that
 * lives in another package. If somebody raises `STRIKE_NOISE.FLUSH`, or the
 * field lowers `minAudibleNoise`, perfect play silently starts costing the
 * player attention and the reward for the hardest thing in the mission
 * evaporates without a single test failing. So it is checked at import.
 */
export function assertFlushIsInaudible(minAudibleNoise: number): void {
  if (STRIKE_NOISE.FLUSH >= minAudibleNoise) {
    throw new Error(
      `a FLUSH strike is authored at ${STRIKE_NOISE.FLUSH} loudness and the stealth ` +
        `field ignores noise below ${minAudibleNoise}, so a perfect stroke would now ` +
        `be audible at close range. The ceiling of this mechanic is that it is not. ` +
        `Lower STRIKE_NOISE.FLUSH below the field's minAudibleNoise.`,
    );
  }
}
