// Patrol poses and audibility, evaluated against the shipped stealth field.
//
// Nothing here decides whether the player is seen — `visibility` in
// @pa/engine-world/stealth does. This module only walks the authored patrol
// routes on the fixed clock and asks that question at every tick, so a claim
// like "this cone denies the street line" is a measurement over a whole patrol
// cycle rather than a note in a comment.

import {
  CROUCH_HEIGHT,
  STAND_HEIGHT,
  type CollisionWorld,
  type Vec3,
} from "@pa/engine-world/collision";
import { FIELD_TICK_HZ } from "@pa/engine-world/fieldSimulation";
import {
  noiseAudibility,
  visibility,
  type NoiseEvent,
  type PlayerSighting,
  type WatcherEye,
} from "@pa/engine-world/stealth";
import { PARKOUR_TUNING } from "@pa/engine-world/parkour";
import type { PatrolSpec, Vec3Tuple } from "./types.js";

export interface PatrolPose {
  position: Vec3;
  forwardX: number;
  forwardZ: number;
  yaw: number;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Triangle-wave head sweep, so a posted watcher scans instead of staring. */
function scanOffset(spec: PatrolSpec, seconds: number): number {
  const amplitude = toRad(spec.scanAmplitudeDeg);
  if (amplitude <= 0) return 0;
  const rate = toRad(spec.scanRateDegPerSec);
  const period = (4 * amplitude) / rate;
  const phase = ((seconds % period) + period) % period;
  const quarter = period / 4;
  if (phase < quarter) return (phase / quarter) * amplitude;
  if (phase < quarter * 3) {
    return amplitude - ((phase - quarter) / (quarter * 2)) * amplitude * 2;
  }
  return -amplitude + ((phase - quarter * 3) / quarter) * amplitude;
}

/** Where a patrol is, and which way it is looking, at a given tick. */
export function patrolPoseAt(
  spec: PatrolSpec,
  tick: number,
  phaseIndex = 0,
): PatrolPose {
  const seconds =
    tick / FIELD_TICK_HZ + (spec.phaseOffsetsS[phaseIndex] ?? 0);

  if (spec.kind === "POSTED") {
    const point = spec.waypoints[0]!;
    const yaw = spec.baseYaw + scanOffset(spec, seconds);
    return {
      position: { x: point[0], y: point[1], z: point[2] },
      forwardX: Math.sin(yaw),
      forwardZ: Math.cos(yaw),
      yaw,
    };
  }

  // Out and back along the authored waypoints.
  const legs: Array<{ from: Vec3Tuple; to: Vec3Tuple; length: number }> = [];
  const push = (from: Vec3Tuple, to: Vec3Tuple) =>
    legs.push({
      from,
      to,
      length: Math.hypot(to[0] - from[0], to[2] - from[2]),
    });
  for (let i = 0; i < spec.waypoints.length - 1; i++) {
    push(spec.waypoints[i]!, spec.waypoints[i + 1]!);
  }
  for (let i = spec.waypoints.length - 1; i > 0; i--) {
    push(spec.waypoints[i]!, spec.waypoints[i - 1]!);
  }
  const total = legs.reduce((sum, leg) => sum + leg.length, 0);
  let progress = ((seconds * spec.speedMps) % total + total) % total;
  let leg = legs[0]!;
  for (const candidate of legs) {
    if (progress <= candidate.length) {
      leg = candidate;
      break;
    }
    progress -= candidate.length;
  }
  const t = leg.length > 0 ? progress / leg.length : 0;
  const position = {
    x: leg.from[0] + (leg.to[0] - leg.from[0]) * t,
    y: leg.from[1] + (leg.to[1] - leg.from[1]) * t,
    z: leg.from[2] + (leg.to[2] - leg.from[2]) * t,
  };
  const travelYaw = Math.atan2(leg.to[0] - leg.from[0], leg.to[2] - leg.from[2]);
  const yaw = travelYaw + scanOffset(spec, seconds);
  return {
    position,
    forwardX: Math.sin(yaw),
    forwardZ: Math.cos(yaw),
    yaw,
  };
}

export function watcherEyeAt(
  spec: PatrolSpec,
  tick: number,
  phaseIndex = 0,
): WatcherEye {
  const pose = patrolPoseAt(spec, tick, phaseIndex);
  return {
    position: pose.position,
    forwardX: pose.forwardX,
    forwardZ: pose.forwardZ,
    capsuleHeight: STAND_HEIGHT,
    halfAngleRad: toRad(spec.coneHalfAngleDeg),
    rangeM: spec.rangeM,
    ignore: new Set(spec.perchIgnore),
  };
}

export interface SightingOptions {
  crouched?: boolean;
  sprinting?: boolean;
  covered?: boolean;
  crowdBlend?: number;
  lightLevel?: number;
}

export function sightingAt(
  pos: Vec3Tuple,
  options: SightingOptions = {},
): PlayerSighting {
  const crouched = options.crouched ?? false;
  return {
    position: { x: pos[0], y: pos[1], z: pos[2] },
    // The sight target comes off the live capsule height, not a stance flag, so
    // the silhouette a watcher resolves is the one the body actually occupies.
    capsuleHeight: crouched ? CROUCH_HEIGHT : STAND_HEIGHT,
    exposure: options.covered ? "PARTIAL" : "EXPOSED",
    motion: crouched
      ? "CROUCH_MOVE"
      : options.sprinting === false
        ? "WALK"
        : "SPRINT",
    covered: options.covered ?? false,
    lightLevel: options.lightLevel ?? 1,
    crowdBlend: options.crowdBlend ?? 0,
  };
}

/** Peak visibility of a point to a patrol across one full cycle. */
export function peakVisibility(
  world: CollisionWorld,
  spec: PatrolSpec,
  pos: Vec3Tuple,
  options: SightingOptions = {},
  ticks = 60 * 60,
  step = 5,
): number {
  const player = sightingAt(pos, options);
  let peak = 0;
  for (let tick = 0; tick < ticks; tick += step) {
    const result = visibility(world, watcherEyeAt(spec, tick), player);
    if (result.visibility > peak) peak = result.visibility;
  }
  return peak;
}

/** Loudest this noise ever gets to a patrol across one full cycle. */
export function peakAudibility(
  spec: PatrolSpec,
  noise: NoiseEvent,
  ticks = 60 * 60,
  step = 5,
): number {
  let peak = 0;
  for (let tick = 0; tick < ticks; tick += step) {
    const pose = patrolPoseAt(spec, tick);
    const heard = noiseAudibility(noise, pose.position.x, pose.position.z);
    if (heard > peak) peak = heard;
  }
  return peak;
}

/** A landing of this height, at this place, as the stealth field sees it. */
export function landingNoiseEvent(at: Vec3Tuple, dropM: number): NoiseEvent {
  const kind =
    dropM <= PARKOUR_TUNING.runOffMaxDropM
      ? "RUN"
      : dropM <= PARKOUR_TUNING.rollMaxDropM
        ? "ROLL"
        : "HARD";
  const intensity = PARKOUR_TUNING.landingNoise[kind];
  return {
    kind: "PLAYER_LANDING",
    x: at[0],
    y: at[1],
    z: at[2],
    intensity,
    radiusM: intensity * PARKOUR_TUNING.noiseRadiusPerIntensityM,
  };
}

/** A traversal verb, at this place, as the stealth field sees it. */
export function verbNoiseEvent(
  at: Vec3Tuple,
  verb: keyof typeof PARKOUR_TUNING.verbNoise,
): NoiseEvent {
  const intensity = PARKOUR_TUNING.verbNoise[verb];
  return {
    kind: "PLAYER_MOVE",
    x: at[0],
    y: at[1],
    z: at[2],
    intensity,
    radiusM: intensity * PARKOUR_TUNING.noiseRadiusPerIntensityM,
  };
}
