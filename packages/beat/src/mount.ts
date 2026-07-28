// Mounting a beat: the contract with whoever owns the tick loop.
//
// This package owns no loop, no input device and no objective. The mission
// container owns all three, and this file is the shape of the seam between them
// — written here, in the package that has the opinions, rather than discovered
// by whoever wires it up.
//
// The types below are structural subsets of the container's own. `BeatStanceRead`
// is a subset of `MissionPlayerRead`, and `BeatGatedObjective` is exactly the
// shape of `MissionObjective`, so a level can hand one of these straight to its
// objective list without an adapter and without this package importing the app.

import { inFacingArc, type BeatSpec } from "./spec.js";
import type { BeatOutcome } from "./machine.js";

/**
 * What this package needs to know about the player.
 *
 * A structural subset of the container's `MissionPlayerRead`, so the container's
 * own read satisfies it with no conversion.
 */
export interface BeatStanceRead {
  readonly pos: { readonly x: number; readonly y: number; readonly z: number };
  readonly yaw: number;
}

/** Is the player standing where the work is, facing it? */
export function inBeatStance(spec: BeatSpec, read: BeatStanceRead): boolean {
  const flat = Math.hypot(read.pos.x - spec.stance.x, read.pos.z - spec.stance.z);
  if (flat > spec.stanceRadiusM) return false;
  if (Math.abs(read.pos.y - spec.stance.y) > spec.stanceHeightToleranceM) return false;
  return inFacingArc(spec, read.yaw);
}

/**
 * Exactly the shape of the container's `MissionObjective`.
 *
 * Declared structurally rather than imported because this package must stay
 * importable from plain Node — the same reason @pa/duel declares its own port
 * types — and because a simulation package depending on the web app would invert
 * the dependency the whole layering exists to enforce.
 */
export interface BeatGatedObjective {
  readonly id: string;
  readonly label: string;
  readonly required: boolean;
  satisfiedBy(read: BeatStanceRead): boolean;
}

/**
 * An objective that is met by DOING the work, not by arriving where the work is.
 *
 * This is the one-line difference between the mission M1 ships today and the
 * mission it is supposed to ship. Right now `satisfiedBy` is a proximity test:
 * reach the bough and the handbill is considered nailed up. Swapping in this
 * factory makes the same objective read "you are at the tree AND the sheet
 * actually went up", and the sheet going up is the beat's outcome.
 *
 * `posted` is a getter rather than a value because the objective is evaluated
 * every fixed step while the outcome arrives once, mid-run. The container holds
 * the run; this reads it.
 */
export function beatObjective(options: {
  readonly id: string;
  readonly label: string;
  readonly required?: boolean;
  readonly spec: BeatSpec;
  posted(): boolean;
}): BeatGatedObjective {
  return {
    id: options.id,
    label: options.label,
    required: options.required ?? true,
    satisfiedBy: (read) => options.posted() && inBeatStance(options.spec, read),
  };
}

/**
 * Was this outcome the mission slate's terminal precision failure?
 *
 * §4.11: a terminally illegible or torn result ends the attempt on the same
 * terms as a detection fail. An abandoned run is NOT that — the player simply
 * has not done the work yet and may come back — so the two are distinguished
 * here rather than left to each caller to remember.
 */
export function isTerminalPrecisionFailure(outcome: BeatOutcome): boolean {
  return !outcome.abandoned && outcome.grade === "TORN";
}

/**
 * Everything the container and the level have to do, as sentences.
 *
 * Shipped as data so it can be printed by a level report and diffed when it
 * changes, rather than living only in a README that nobody re-reads. Each line
 * names the file that owns the work.
 */
export const BEAT_MOUNT_CONTRACT: readonly string[] = [
  // --- input ---
  "playerInput: let the player strike the lit cell with a pointer click OR one " +
    "key, and deliver the struck cell EDGE TRIGGERED — one cell to exactly one " +
    "tick. A held key or unreleased pointer delivered every tick reads as a run " +
    "of strays.",
  "the container's input frame: carry the struck cell to exactly one tick. When a " +
    "frame spans several fixed steps, attribute it to the first of them, the same " +
    "way jumpBuffered is already consumed.",

  // --- the tick loop ---
  "the mission runtime: hold one BeatRun per attempt, created from the attempt " +
    "seed, and call stepBeat once per fixed step with the clock's tick.",
  "the mission runtime: concatenate the step's noise into the array already handed " +
    "to stepStealthField alongside the parkour and thrown-object noise. This is the " +
    "whole integration of the design's central idea and it is one array spread.",
  "the mission runtime: keep the stealth field stepping while the beat runs. A beat " +
    "with detection suspended is a minigame; a beat inside a live field is a " +
    "stealth mechanic.",
  "the mission runtime: report the player as STILL to the field while in stance — " +
    "traversing must be false, since no traversal verb is running — so standing " +
    "quietly to work is correctly the least visible thing the player can be doing.",

  // --- the level ---
  "the level: derive the schedule ONCE per attempt from the attempt seed. " +
    "Re-deriving on re-entry is required and safe because deriveSchedule is pure; " +
    "re-SEEDING on re-entry would let a player leave and return until they drew an " +
    "easy one.",
  "the level: replace the post objective's proximity predicate with beatObjective, " +
    "so the sheet going up is what satisfies it rather than arriving at the bough.",
  "the level: treat isTerminalPrecisionFailure as an authored fail in failWhen, with " +
    "the mission's own copy and cue id. An abandoned run is not a failure.",

  // --- presentation ---
  "the stage: draw the panel from cells and activeCell — one lit flare on a big, " +
    "comfortable target — using the project's holographic language. The panel is " +
    "UI, so it is procedural by exception, not a modelled world object.",
  "the stage: draw the live flare's remaining window from activeRemaining01 as an " +
    "aid, never as a gate: the flare is hittable for its whole window, so a " +
    "reduced-motion renderer may drop the ring and the beat stays passable.",
  "the stage: flash the last result from lastResult so a hit, a miss and a stray " +
    "read differently, and keep the click working with keyboard as well as pointer.",
  "the HUD: show struck of total so the player can see the act completing, and say " +
    "whether anything has been heard.",

  // --- budget ---
  "pacing: charge beatWorstCaseTicks to the mission clock. It is the reaction " +
    "schedule's widest span, so it is a fixed reservation rather than a tail the " +
    "budget almost never pays.",
];
