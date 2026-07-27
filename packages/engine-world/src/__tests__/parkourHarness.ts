// Shared fixtures for the parkour and stealth suites. Not a test file: the
// package test glob only picks up *.test.ts.

import {
  RUN_SPEED,
  createGroundedState,
  type MotionState,
} from "../playerMotion.js";
import {
  platformFromRect,
  wallFromRect,
  type Blocker,
  type ClimbVolume,
  type CollisionWorld,
  type Platform,
} from "../collision.js";
import { createFlowState, type FlowInput, type FlowState } from "../parkour/flow.js";
import { probeAhead, type ParkourProbe } from "../parkour/probe.js";
import type { SelectContext } from "../parkour/select.js";

export const ARENA_BOUNDS = { minX: -60, maxX: 60, minZ: -60, maxZ: 60 };

export function world(
  blockers: Blocker[] = [],
  platforms: Platform[] = [],
  climbVolumes: ClimbVolume[] = [],
): CollisionWorld {
  return { blockers, platforms, bounds: { ...ARENA_BOUNDS }, climbVolumes };
}

/** An authored vertical ascent: stand in here, and going up onto `onto` is legal. */
export function ascent(
  onto: string,
  minZ: number,
  maxZ: number,
  standY: number,
  width = 12,
): ClimbVolume {
  return {
    id: `ascent-${onto}`,
    toSurface: onto,
    minX: -width / 2,
    maxX: width / 2,
    minZ,
    maxZ,
    minY: standY - 0.4,
    maxY: standY + 0.4,
  };
}

/** A solid box with a landable top, the common traversal obstacle. */
export function box(
  id: string,
  z: number,
  height: number,
  depth: number,
  options: { width?: number; x?: number; baseY?: number } = {},
): Blocker {
  return wallFromRect(
    id,
    options.x ?? 0,
    z,
    (options.width ?? 6) / 2,
    depth / 2,
    { topY: height, baseY: options.baseY ?? 0, landable: true },
  );
}

/** An overhead span with clear air beneath it: an awning, a cart bed, a beam. */
export function overhead(
  id: string,
  z: number,
  baseY: number,
  topY: number,
  depth: number,
  width = 6,
): Blocker {
  return wallFromRect(id, 0, z, width / 2, depth / 2, {
    baseY,
    topY,
    landable: true,
  });
}

/** A full-height wall. `x` offsets it off the player's line. */
export function wall(
  id: string,
  z: number,
  depth = 1,
  width = 6,
  x = 0,
): Blocker {
  return wallFromRect(id, x, z, width / 2, depth / 2, {});
}

export function roof(
  id: string,
  minZ: number,
  maxZ: number,
  y: number,
  width = 12,
): Platform {
  return platformFromRect(id, -width / 2, width / 2, minZ, maxZ, y, ["roof"]);
}

/** Player standing at (x, y, z) travelling toward +Z at `speed`. */
export function runningNorth(
  z: number,
  speed = RUN_SPEED,
  y = 0,
  x = 0,
): MotionState {
  const state = createGroundedState({ x, y, z }, 0);
  return { ...state, vel: { x: 0, y: 0, z: speed } };
}

export function probeFor(
  collision: CollisionWorld,
  motion: MotionState,
): ParkourProbe {
  return probeAhead(collision, {
    pos: motion.pos,
    velX: motion.vel.x,
    velZ: motion.vel.z,
    yaw: motion.yaw,
  });
}

export function selectContext(
  overrides: Partial<SelectContext> = {},
): SelectContext {
  return {
    grounded: true,
    sprintHeld: true,
    jumpBuffered: false,
    crouchHeld: false,
    chaining: false,
    receivingTargets: [],
    reducedMotion: false,
    ...overrides,
  };
}

export function flowInput(overrides: Partial<FlowInput> = {}): FlowInput {
  return {
    dt: 1 / 60,
    targetVelX: 0,
    targetVelZ: RUN_SPEED,
    sprintHeld: true,
    crouchHeld: false,
    jumpBuffered: false,
    flowEnabled: true,
    reducedMotion: false,
    receivingTargets: [],
    ...overrides,
  };
}

export function freshFlow(): FlowState {
  return createFlowState();
}
