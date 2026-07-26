// Leap of faith: a committed high dive into a receiving target.
//
// Two things have to read clearly, and they are separate problems. The
// COMMITMENT is a solved ballistic launch off the lip aimed at the target — once
// it starts there is no air control and no cancel, which is what makes it feel
// like a decision instead of a fall. The LANDING is an explicit capture volume:
// the dive resolves against the target's acceptance radius, not against
// whatever collider happens to be underneath, so "I hit the cart" is never
// ambiguous.
//
// The dive is not an ability. Any player can take any authored target from
// Level 0; the only requirement is a drop tall enough to read as a dive.

import type { Vec3 } from "../collision.js";
import { FIELD_TICK_HZ } from "../fieldSimulation.js";
import { GRAVITY, RUN_SPEED } from "../playerMotion.js";
import { PARKOUR_TUNING, type ParkourTuning } from "./tuning.js";

/**
 * A volume authored by level design that accepts a dive: a hay cart, a stretched
 * awning, a laundry canopy, deep water. Level design owns placement; this system
 * owns whether a dive into one is solvable.
 */
export interface ReceivingTarget {
  id: string;
  /** Centre of the accepting surface. */
  x: number;
  y: number;
  z: number;
  /** Horizontal acceptance radius. Defaults to tuning.leapTargetRadiusM. */
  radiusM?: number;
  /** Presentation hint, e.g. "hayCart" | "awning" | "canopy" | "water". */
  kind?: string;
}

export interface LeapSolution {
  target: ReceivingTarget;
  /** Vertical distance from the lip to the target surface. */
  dropM: number;
  /** Horizontal distance from the lip to the target centre. */
  distanceM: number;
  /** Angle between the player's travel direction and the target. */
  offAxisRad: number;
  /** Launch velocity. Committed once and never steered. */
  velX: number;
  velY: number;
  velZ: number;
  /** Expected descent, in fixed ticks, for presentation timing. */
  flightTicks: number;
}

function normalizedAngleBetween(
  dirX: number,
  dirZ: number,
  toX: number,
  toZ: number,
): number {
  const length = Math.hypot(toX, toZ);
  if (length < 1e-9) return 0;
  const dot = (dirX * toX + dirZ * toZ) / length;
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

/** Flight time of a dive launched with `vy` upward that falls `dropM`. */
export function leapFlightSeconds(
  dropM: number,
  tuning: ParkourTuning = PARKOUR_TUNING,
): number {
  const vy = tuning.leapLaunchVyMps;
  return (vy + Math.sqrt(vy * vy + 2 * GRAVITY * Math.max(0, dropM))) / GRAVITY;
}

/**
 * The best solvable dive from this lip, or null. Targets are rejected for being
 * too shallow to read as a dive, too far off the travel direction to be what the
 * player meant, or too far to reach at sprint speed. Ties break on the nearest
 * target, then on id, so the choice is stable.
 */
export function solveLeapOfFaith(
  lip: Vec3,
  dirX: number,
  dirZ: number,
  targets: readonly ReceivingTarget[],
  tuning: ParkourTuning = PARKOUR_TUNING,
): LeapSolution | null {
  let best: LeapSolution | null = null;
  for (const target of targets) {
    const dropM = lip.y - target.y;
    if (dropM < tuning.leapMinDropM) continue;
    const toX = target.x - lip.x;
    const toZ = target.z - lip.z;
    const distanceM = Math.hypot(toX, toZ);
    const offAxisRad = normalizedAngleBetween(dirX, dirZ, toX, toZ);
    if (offAxisRad > tuning.leapMaxOffAxisRad) continue;

    const flightS = leapFlightSeconds(dropM, tuning);
    const requiredSpeed = distanceM / flightS;
    if (requiredSpeed > RUN_SPEED + tuning.leapLaunchSpeedMps) continue;

    // Aim at the target rather than straight along travel: the dive is allowed
    // to correct inside the offer cone, and that correction is what makes the
    // landing unambiguous.
    const aimX = distanceM > 1e-6 ? toX / distanceM : dirX;
    const aimZ = distanceM > 1e-6 ? toZ / distanceM : dirZ;
    const solution: LeapSolution = {
      target,
      dropM,
      distanceM,
      offAxisRad,
      velX: aimX * requiredSpeed,
      velY: tuning.leapLaunchVyMps,
      velZ: aimZ * requiredSpeed,
      flightTicks: Math.max(1, Math.round(flightS * FIELD_TICK_HZ)),
    };
    if (
      !best ||
      solution.distanceM < best.distanceM - 1e-6 ||
      (Math.abs(solution.distanceM - best.distanceM) <= 1e-6 &&
        solution.target.id < best.target.id)
    ) {
      best = solution;
    }
  }
  return best;
}

/** Vertical band inside which a descending diver is captured by a target. */
export const LEAP_CAPTURE_BAND_M = 0.8;

/**
 * Has a descending diver entered the target volume? Capture is horizontal
 * radius plus a vertical band around the surface, so a fast descent cannot
 * tunnel past the accepting surface between two fixed steps.
 */
export function leapCaptured(
  pos: Vec3,
  previousY: number,
  target: ReceivingTarget,
  tuning: ParkourTuning = PARKOUR_TUNING,
): boolean {
  const radius = target.radiusM ?? tuning.leapTargetRadiusM;
  if (Math.hypot(pos.x - target.x, pos.z - target.z) > radius) return false;
  const upper = Math.max(previousY, pos.y);
  const lower = Math.min(previousY, pos.y);
  return (
    lower <= target.y + LEAP_CAPTURE_BAND_M &&
    upper >= target.y - LEAP_CAPTURE_BAND_M
  );
}

/** Where the diver comes to rest inside the target. */
export function leapRestPosition(target: ReceivingTarget): Vec3 {
  return { x: target.x, y: target.y, z: target.z };
}
