// Deterministic intent policies: the boss's behaviour, and a reference "skilled
// player" used to prove the tuning claims.
//
// A policy is a pure function of (read-only view, seed) producing one tick of
// intent. It never mutates state and never reads a clock, so a boss is a replay
// artefact rather than an AI: same seed, same tick, same decision, on every
// machine. All randomness comes from engine-world's `fieldRandom`.
//
// This module is also where the "same machine, different opponent source" claim
// is cashed. `bossIntent` and a network-relayed intent are interchangeable at the
// call site in machine.ts, because both are just a CombatIntent.

import {
  isDodging,
  intent,
  solveInterceptDirection,
  type CombatIntent,
  type CombatView,
  type FighterState,
  type Projectile,
} from "./combat.js";
import {
  eyeHeightForCapsule,
  eyePosition,
  positionClear,
  segmentClear,
  CAPSULE_RADIUS,
  STAND_HEIGHT,
  FIELD_TICK_HZ,
  fieldRandom,
} from "./engine.js";
import type { BossProfile } from "./boss.js";
import { BULLET_SPEED_MPS } from "./tuning.js";

// ---- ballistics ------------------------------------------------------------
//
// `solveInterceptDirection` used to live here. It moved to combat.ts when the aim
// assist started snapping to it, because it is now the PLAYER's aim target as much
// as the boss's, and two copies of the lead solution would be two answers to
// "where will he be".

export interface Threat {
  readonly projectile: Projectile;
  /** Ticks until closest approach. */
  readonly ticks: number;
  /** Perpendicular direction that clears the ball's path. */
  readonly evadeX: number;
  readonly evadeZ: number;
}

/** The soonest inbound ball that will actually connect, or null. */
export function nearestThreat(
  view: CombatView,
  radius = CAPSULE_RADIUS * 1.6,
): Threat | null {
  let best: Threat | null = null;
  for (const projectile of view.incoming) {
    const rx = view.self.motion.pos.x - projectile.x;
    const rz = view.self.motion.pos.z - projectile.z;
    const speedSq = projectile.vx * projectile.vx + projectile.vz * projectile.vz;
    if (speedSq < 1e-9) continue;
    const t = (rx * projectile.vx + rz * projectile.vz) / speedSq;
    if (t < 0) continue;
    const closestX = projectile.x + projectile.vx * t;
    const closestZ = projectile.z + projectile.vz * t;
    const missBy = Math.hypot(
      view.self.motion.pos.x - closestX,
      view.self.motion.pos.z - closestZ,
    );
    if (missBy > radius) continue;
    const ticks = Math.round(t * FIELD_TICK_HZ);
    if (best === null || ticks < best.ticks) {
      const length = Math.hypot(projectile.vx, projectile.vz);
      // Step across the ball's path, on the side that is already further away.
      const perpX = -projectile.vz / length;
      const perpZ = projectile.vx / length;
      const sign =
        (view.self.motion.pos.x - projectile.x) * perpX +
          (view.self.motion.pos.z - projectile.z) * perpZ >=
        0
          ? 1
          : -1;
      best = {
        projectile,
        ticks,
        evadeX: perpX * sign,
        evadeZ: perpZ * sign,
      };
    }
  }
  return best;
}

// ---- shared movement helpers ------------------------------------------------

function towards(from: FighterState, to: FighterState): { x: number; z: number } {
  const dx = to.motion.pos.x - from.motion.pos.x;
  const dz = to.motion.pos.z - from.motion.pos.z;
  const length = Math.hypot(dx, dz);
  return length > 1e-6 ? { x: dx / length, z: dz / length } : { x: 0, z: 1 };
}

const COVER_PROBE_DIRECTIONS = 16;
const COVER_PROBE_DISTANCE = 2.2;

/**
 * A direction that breaks line of sight, chosen by fixed-order probing rather
 * than pathfinding. Deterministic, allocation-light, and good enough for an
 * arena: the duel arena is a room, not a level.
 */
export function directionToCover(view: CombatView): { x: number; z: number } | null {
  const opponentEye = eyePosition(view.opponent.motion);
  for (let index = 0; index < COVER_PROBE_DIRECTIONS; index++) {
    const angle = (index / COVER_PROBE_DIRECTIONS) * Math.PI * 2;
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    const probe = {
      x: view.self.motion.pos.x + dirX * COVER_PROBE_DISTANCE,
      y: view.self.motion.pos.y,
      z: view.self.motion.pos.z + dirZ * COVER_PROBE_DISTANCE,
    };
    if (!positionClear(view.world, probe, CAPSULE_RADIUS, STAND_HEIGHT)) continue;
    const probeEye = {
      x: probe.x,
      y: probe.y + eyeHeightForCapsule(view.self.motion.capsuleHeight),
      z: probe.z,
    };
    if (!segmentClear(view.world, probeEye, opponentEye)) {
      return { x: dirX, z: dirZ };
    }
  }
  return null;
}

// ---- the reference skilled player ------------------------------------------

export interface OraclePolicyOptions {
  /** Preferred engagement distance. Closer shots are easier to land. */
  readonly preferredDistance: number;
  /** Dodge when a ball will connect within this many ticks. */
  readonly dodgeWithinTicks: number;
  /** Break line of sight while out of ammo instead of standing in the open. */
  readonly useCoverWhenEmpty: boolean;
}

export const DEFAULT_ORACLE_OPTIONS: OraclePolicyOptions = {
  preferredDistance: 9,
  dodgeWithinTicks: 22,
  useCoverWhenEmpty: true,
};

/**
 * The mechanically strong player, expressed as code: perfect intercept aim, fires
 * the instant it legally can, dodges what will hit it, and hides when empty.
 *
 * This is a tuning instrument, not an assist. Its only job is to answer the
 * question the brief insists on — "can a skilled player win on one bullet?" —
 * with a simulation instead of an opinion.
 */
export function oracleIntent(
  view: CombatView,
  options: OraclePolicyOptions = DEFAULT_ORACLE_OPTIONS,
): CombatIntent {
  const aim = solveInterceptDirection(
    view.self.motion.pos,
    view.opponent.motion.pos,
    { x: view.opponent.motion.vel.x, z: view.opponent.motion.vel.z },
  ) ?? towards(view.self, view.opponent);

  const threat = nearestThreat(view);
  const canDodge = view.tick >= view.self.dodge.readyAtTick && !isDodging(view.self);
  if (threat && threat.ticks <= options.dodgeWithinTicks && canDodge) {
    return intent({
      moveX: threat.evadeX,
      moveZ: threat.evadeZ,
      dodge: true,
      aimX: aim.x,
      aimZ: aim.z,
    });
  }

  const fire = view.hasLineOfSight && view.self.ammo > 0;
  if (view.self.ammo === 0 && options.useCoverWhenEmpty) {
    const cover = directionToCover(view);
    if (cover) {
      return intent({ moveX: cover.x, moveZ: cover.z, sprint: true, aimX: aim.x, aimZ: aim.z });
    }
  }

  // With ammo but no line of sight, close in. With both, hold the preferred
  // range and strafe so the opponent's own lead solution stays wrong.
  const toOpponent = towards(view.self, view.opponent);
  if (!view.hasLineOfSight) {
    return intent({
      moveX: toOpponent.x,
      moveZ: toOpponent.z,
      sprint: true,
      aimX: aim.x,
      aimZ: aim.z,
      fire: false,
    });
  }
  const rangeError = view.distance - options.preferredDistance;
  const strafeSign = Math.floor(view.tick / 45) % 2 === 0 ? 1 : -1;
  const strafeX = -toOpponent.z * strafeSign;
  const strafeZ = toOpponent.x * strafeSign;
  const approach = Math.max(-1, Math.min(1, rangeError / 4));
  const moveX = strafeX + toOpponent.x * approach;
  const moveZ = strafeZ + toOpponent.z * approach;
  return intent({
    moveX,
    moveZ,
    sprint: false,
    fire,
    aimX: aim.x,
    aimZ: aim.z,
  });
}

// ---- the boss ---------------------------------------------------------------

const SALT_AIM = 101;
const SALT_DODGE = 202;
const SALT_STRAFE = 303;

/**
 * The boss is the oracle with its skill dialled down by profile: aim jitter, a
 * partial lead solution, a reaction window it needs before it can dodge, and a
 * willingness to take that dodge at all. Every roll is seeded.
 */
export function bossIntent(
  profile: BossProfile,
  view: CombatView,
  seed: number,
): CombatIntent {
  const perfect =
    solveInterceptDirection(
      view.self.motion.pos,
      view.opponent.motion.pos,
      { x: view.opponent.motion.vel.x, z: view.opponent.motion.vel.z },
    ) ?? towards(view.self, view.opponent);
  const direct = towards(view.self, view.opponent);

  // Partial prediction: blend the honest intercept with a naive shot at where the
  // target currently stands, then add seeded jitter.
  const blendX = direct.x + (perfect.x - direct.x) * profile.leadFraction;
  const blendZ = direct.z + (perfect.z - direct.z) * profile.leadFraction;
  const blendLength = Math.hypot(blendX, blendZ) || 1;
  const jitter =
    (fieldRandom(seed, view.tick, SALT_AIM) * 2 - 1) * profile.aimErrorRad;
  const cos = Math.cos(jitter);
  const sin = Math.sin(jitter);
  const baseX = blendX / blendLength;
  const baseZ = blendZ / blendLength;
  const aimX = baseX * cos - baseZ * sin;
  const aimZ = baseX * sin + baseZ * cos;

  const threat = nearestThreat(view);
  const canDodge =
    view.tick >= view.self.dodge.readyAtTick && !isDodging(view.self);
  // The roll is keyed on the ball, not the tick, so `dodgeChance` is genuinely
  // "the fraction of shots this boss slips". Rolling per tick would compound into
  // near-certainty over a ball's flight and make high tiers unhittable.
  if (
    threat &&
    canDodge &&
    threat.ticks <= profile.dodgeReactionTicks &&
    fieldRandom(seed, threat.projectile.id, SALT_DODGE) < profile.dodgeChance
  ) {
    return intent({
      moveX: threat.evadeX,
      moveZ: threat.evadeZ,
      dodge: true,
      aimX,
      aimZ,
    });
  }

  const healthFraction = view.self.health / profile.maxHealth;
  const wantsCover =
    view.self.ammo === 0 || healthFraction < profile.coverSeekHealthFraction;
  if (wantsCover) {
    const cover = directionToCover(view);
    if (cover) {
      return intent({ moveX: cover.x, moveZ: cover.z, sprint: true, aimX, aimZ });
    }
  }

  if (!view.hasLineOfSight) {
    return intent({ moveX: direct.x, moveZ: direct.z, sprint: true, aimX, aimZ });
  }

  const phase = Math.floor(view.tick / profile.strafePeriodTicks);
  const flip = fieldRandom(seed, phase, SALT_STRAFE) < 0.5 ? 1 : -1;
  const strafeX = -direct.z * flip;
  const strafeZ = direct.x * flip;
  const closing = view.distance > 11 ? 0.6 : view.distance < 5 ? -0.6 : 0;
  return intent({
    moveX: strafeX + direct.x * closing,
    moveZ: strafeZ + direct.z * closing,
    fire: view.self.ammo > 0,
    aimX,
    aimZ,
  });
}
