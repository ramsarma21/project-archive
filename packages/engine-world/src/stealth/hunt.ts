// The hunt: what being seen actually costs.
//
// THE PROBLEM THIS EXISTS FOR. Detection was legible and free. A watcher shouted,
// the squad escalated, and about ten seconds later everybody had forgotten: the
// search timed out, suspicion decayed to zero, and the player carried on down the
// exact line they had been caught on, having lost nothing. Outside the final
// court there was no authored failure and no systemic one either, so roughly
// three of the mission's five minutes had no stake in them at all. Readable
// stealth with no consequence is a light show.
//
// WHAT A CONSEQUENCE HAS TO BE HERE, and the two constraints are in tension:
//
//   * It must cost something real. Being seen at second forty has to hurt.
//   * It must never fail the run. The only authored fail point in the mission is
//     being held in the final court, and a movement mission that ends because a
//     guard glanced at you at 0:40 is a mission an eleven-year-old plays once.
//
// The resolution is that the cost is POSITION AND TIME rather than progress. Get
// seen and the ground you were seen on becomes hostile: every watcher within the
// hunt radius converges their attention on where you were, stops standing down,
// and keeps sweeping. Your route through that area is gone for as long as the
// hunt lasts. You have not lost the run; you have lost the line, and the seconds
// it takes to find another one.
//
// AND THE RULE THAT MAKES IT A CONSEQUENCE RATHER THAN A TIMER: hiding does not
// end a hunt. Leaving does. The hunt breaks when the player has been out of
// contact for a few seconds AND has put real distance between themselves and the
// place they were seen. Crouching behind the same barrel and waiting is exactly
// the behaviour a search is meant to defeat, so it does not work — the player is
// pushed off their position by the mechanic itself, which is the "costs position"
// the design asked for, expressed as something the player does rather than
// something done to them.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It does not touch the collision world.
// Closing a crossover route on detection would mean mutating geometry mid-run and
// invalidating the broad phase, and the level author stopped short of that on
// purpose. Nothing here needs it: a hunt makes a route unusable by making it
// watched, which is a stronger consequence than making it absent, because the
// player can see it happening, can understand why, and can beat it.
//
// It also does not scale the detection maths. Escalation changes what patrols DO
// — where they look, how long they stay interested — and never how well eyes
// work. There is no heat multiplier here and there must not be one; see the note
// at the top of tuning.ts for why that was cut and why it stays cut.

import type { Vec3 } from "../collision.js";
import { STEALTH_TUNING, type StealthTuning } from "./tuning.js";

export interface HuntState {
  active: boolean;
  /** Where the player was seen. The hunt is anchored to the place, not the player. */
  origin: Vec3;
  /** Watchers inside this radius of the origin are drawn into the hunt. */
  radiusM: number;
  /** How far the player must get from the origin before the hunt can break. */
  escapeDistanceM: number;
  /** Ticks before the hunt gives up on its own. A floor under the worst case. */
  ticksRemaining: number;
  /** Consecutive ticks with no watcher resolving the player. */
  clearTicks: number;
  /** Confirmed sightings this mission. Each one makes the next hunt harder. */
  detections: number;
  /** Tick the current hunt opened, for telemetry and replays. */
  openedAtTick: number;
}

export type HuntBreak = "NONE" | "ESCAPED" | "EXPIRED";

export interface HuntResult {
  hunt: HuntState;
  /** True on the tick a hunt opens or is renewed by a fresh sighting. */
  opened: boolean;
  /** How a hunt that closed this tick ended. */
  broke: HuntBreak;
}

export function createHuntState(): HuntState {
  return {
    active: false,
    origin: { x: 0, y: 0, z: 0 },
    radiusM: 0,
    escapeDistanceM: 0,
    ticksRemaining: 0,
    clearTicks: 0,
    detections: 0,
    openedAtTick: 0,
  };
}

export interface HuntStepInput {
  tick: number;
  /** A sighting was confirmed this tick. */
  detected: boolean;
  /** Where the player was when it happened. */
  sightingPosition: Vec3;
  /** Where the player is now. */
  playerPosition: Vec3;
  /** Any watcher is resolving the player above the accrual floor right now. */
  anyContact: boolean;
}

/** Distance from the player to the place they were last caught. */
export function huntDistanceM(hunt: HuntState, playerPosition: Vec3): number {
  return Math.hypot(
    playerPosition.x - hunt.origin.x,
    playerPosition.z - hunt.origin.z,
  );
}

/**
 * One fixed step of the hunt.
 *
 * A fresh sighting always re-anchors: the hunt moves to where the player just
 * was, and its clock restarts. So a player who is seen, runs twenty metres, and
 * is seen again has not made progress toward breaking anything — which is the
 * correct reading of what just happened to them.
 */
export function stepHunt(
  huntIn: HuntState,
  input: HuntStepInput,
  tuning: StealthTuning = STEALTH_TUNING,
): HuntResult {
  const hunt: HuntState = { ...huntIn, origin: { ...huntIn.origin } };
  let opened = false;
  let broke: HuntBreak = "NONE";

  if (input.detected) {
    // Each detection widens and lengthens the next hunt, up to a ceiling. The
    // ceiling matters: without one, a player having a bad run ends up in a
    // permanent level-wide hunt, which is a failure state by another name.
    hunt.detections = Math.min(
      hunt.detections + 1,
      tuning.huntEscalationSteps + 1,
    );
    const step = hunt.detections - 1;
    hunt.active = true;
    hunt.origin = { ...input.sightingPosition };
    hunt.radiusM = tuning.huntBaseRadiusM + step * tuning.huntRadiusPerDetectionM;
    hunt.escapeDistanceM =
      tuning.huntEscapeDistanceM + step * tuning.huntEscapePerDetectionM;
    hunt.ticksRemaining =
      tuning.huntBaseTicks + step * tuning.huntTicksPerDetection;
    hunt.clearTicks = 0;
    hunt.openedAtTick = input.tick;
    opened = true;
    return { hunt, opened, broke };
  }

  if (!hunt.active) return { hunt, opened, broke };

  hunt.clearTicks = input.anyContact ? 0 : hunt.clearTicks + 1;
  hunt.ticksRemaining = Math.max(0, hunt.ticksRemaining - 1);

  const away = huntDistanceM(hunt, input.playerPosition);
  if (hunt.clearTicks >= tuning.huntBreakTicks && away >= hunt.escapeDistanceM) {
    broke = "ESCAPED";
  } else if (hunt.ticksRemaining <= 0) {
    // The safety valve. A player who genuinely cannot get clear — cornered, or
    // simply eleven — is not held in a hunt forever. It is deliberately long
    // enough that running is the normal way out and waiting is the miserable one.
    broke = "EXPIRED";
  }

  if (broke !== "NONE") {
    hunt.active = false;
    hunt.ticksRemaining = 0;
    hunt.clearTicks = 0;
    // `detections` survives. The count is the mission's memory of how the run has
    // gone, and it is what makes a third mistake cost more than a first.
  }
  return { hunt, opened, broke };
}

/**
 * Is this watcher inside the hunt, and therefore not allowed to lose interest?
 *
 * Distance to the ORIGIN, not to the player. A hunt is a search of a place: a
 * guard on the far side of the level does not join in because the player ran
 * past him, and a guard standing where the player was seen stays involved even
 * after the player has gone.
 */
export function watcherIsHunting(
  hunt: HuntState,
  watcherPosition: Vec3,
): boolean {
  if (!hunt.active) return false;
  return (
    Math.hypot(
      watcherPosition.x - hunt.origin.x,
      watcherPosition.z - hunt.origin.z,
    ) <= hunt.radiusM
  );
}
