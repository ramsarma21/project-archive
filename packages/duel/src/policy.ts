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
import type { CoverPoint } from "./cover.js";
import { BULLET_SPEED_MPS } from "./tuning.js";

// ---- determinism helpers ---------------------------------------------------
//
// A policy is "a replay artefact rather than an AI: same seed, same tick, same
// decision, on every machine" (see the header). That contract is only as strong as
// the maths under it, so every planar length a decision turns on is computed with
// `Math.sqrt(x*x + z*z)` rather than `Math.hypot`. IEEE 754 pins +, -, *, / and
// sqrt to one correctly-rounded result on every engine and explicitly does NOT pin
// hypot, so the naive-looking form is the engine-independent one, exactly as in
// engine-world's `horizSpeed` and @pa/duel's combat path.

function planarLength(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}

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
    const missBy = planarLength(
      view.self.motion.pos.x - closestX,
      view.self.motion.pos.z - closestZ,
    );
    if (missBy > radius) continue;
    const ticks = Math.round(t * FIELD_TICK_HZ);
    if (best === null || ticks < best.ticks) {
      const length = planarLength(projectile.vx, projectile.vz);
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
  const length = planarLength(dx, dz);
  return length > 1e-6 ? { x: dx / length, z: dz / length } : { x: 0, z: 1 };
}

/**
 * The fixed set of equally-spaced probe headings `directionToCover` fans out, with
 * cos/sin BAKED as literals.
 *
 * The headings depend only on the loop index and the count, never on runtime state,
 * so each cos/sin is a compile-time constant — and the boss's chosen cover heading
 * becomes a movement intent whose resulting position is hashed and part of the
 * "same decision on every machine" contract. `Math.cos`/`Math.sin` are
 * implementation-approximated, so computing the ring at load would let two engines
 * probe in fractionally different directions and, at a threshold, choose different
 * cover. Each pair equals `[Math.cos(a), Math.sin(a)]` for `a = (i / 16) * 2*PI` on
 * the authoring engine, so the table is a no-op there and engine-exact everywhere;
 * `bossNav.test.ts` re-derives it and fails on drift. Exported only so that guard
 * can compare each entry against `[Math.cos(a), Math.sin(a)]`.
 */
export const COVER_PROBE_HEADINGS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0.9238795325112867, 0.3826834323650898],
  [0.7071067811865476, 0.7071067811865475],
  [0.38268343236508984, 0.9238795325112867],
  [6.123233995736766e-17, 1],
  [-0.3826834323650897, 0.9238795325112867],
  [-0.7071067811865475, 0.7071067811865476],
  [-0.9238795325112867, 0.3826834323650899],
  [-1, 1.2246467991473532e-16],
  [-0.9238795325112868, -0.3826834323650896],
  [-0.7071067811865477, -0.7071067811865475],
  [-0.38268343236509034, -0.9238795325112865],
  [-1.8369701987210297e-16, -1],
  [0.38268343236509, -0.9238795325112866],
  [0.7071067811865474, -0.7071067811865477],
  [0.9238795325112865, -0.3826834323650904],
];
const COVER_PROBE_DISTANCE = 2.2;

/**
 * A direction that breaks line of sight, chosen by fixed-order probing rather
 * than pathfinding. Deterministic, allocation-light, and good enough for an
 * arena: the duel arena is a room, not a level.
 */
export function directionToCover(view: CombatView): { x: number; z: number } | null {
  const opponentEye = eyePosition(view.opponent.motion);
  for (const [dirX, dirZ] of COVER_PROBE_HEADINGS) {
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

// ---- the boss breaking off to cover -----------------------------------------

/** Close enough to a cover point that crouching there breaks the sightline. */
export const COVER_ARRIVE_RADIUS_M = 0.4;

/**
 * One tick of "get behind that crate and get down", for the between-round break.
 *
 * It is not `bossIntent` with the fire filed off: the boss is deliberately
 * DISENGAGING to reload out of sight, so it never fires here, and it crouches the
 * moment it arrives because the crouch is what actually occludes the sightline
 * (see cover.ts). It keeps facing the player so the retreat reads as a fighting
 * withdrawal and the exit lean is already aimed the right way. Pure and
 * deterministic: the only inputs are the view and the chosen point.
 */
export function coverApproachIntent(
  view: CombatView,
  target: CoverPoint,
): CombatIntent {
  const face = towards(view.self, view.opponent);
  const dx = target.x - view.self.motion.pos.x;
  const dz = target.z - view.self.motion.pos.z;
  const distance = planarLength(dx, dz);
  if (distance <= COVER_ARRIVE_RADIUS_M) {
    // Arrived: drop into cover and hold. No fire — this is the reload break.
    return intent({ moveX: 0, moveZ: 0, crouch: true, aimX: face.x, aimZ: face.z });
  }
  return intent({
    moveX: dx / distance,
    moveZ: dz / distance,
    sprint: true,
    aimX: face.x,
    aimZ: face.z,
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
  /**
   * The line-of-sight value the boss's MOVEMENT decision should use, when the
   * caller has a debounced one. Defaults to the raw per-tick `view.hasLineOfSight`,
   * so a stateless call is identical to before; `bossAi.ts` passes a
   * hysteresis-filtered value so a player bobbing crouch behind cover cannot flap
   * the boss's movement branch (charge-vs-strafe) every tick — the visible-jitter
   * half of the LOS-flap symptom.
   *
   * IT DELIBERATELY DOES NOT MOVE THE FIRING DECISION. `canShoot` below stays on
   * the RAW line of sight, so the boss still never feeds a wall a ball and still
   * fires the instant the true line is open. That keeps shot outcomes — and so the
   * measured winnability — byte-identical to before; only the boss's PATH is
   * steadied.
   */
  losForMovement?: boolean,
): CombatIntent {
  const moveLos = losForMovement ?? view.hasLineOfSight;
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
  const blendLength = planarLength(blendX, blendZ) || 1;
  const jitter =
    (fieldRandom(seed, view.tick, SALT_AIM) * 2 - 1) * profile.aimErrorRad;
  // THIS sin/cos IS LEFT UNCONVERTED, AND DELIBERATELY. It rotates the boss's aim by
  // a seeded error angle, and unlike the fixed cover ring above there is nothing to
  // bake: `jitter` is a fresh runtime value every tick, so its sin/cos genuinely
  // cannot be reduced to pinned ops. The output is load-bearing — it sets the boss's
  // aimX/aimZ, hence its shot heading and the hits it lands — but converting it is
  // not possible without changing the aim-error MODEL (e.g. a lateral offset instead
  // of a rotation), which is a behaviour change, not a determinism fix. It is also
  // the one policy transcendental with no cross-engine consequence in any shipped
  // path: the boss is authoritative-only, a predicting client never runs `bossIntent`
  // (it seats the opponent from the server snapshot and re-derives only its own
  // body), and a divergence replay steps the RECORDED intents rather than recomputing
  // them. So this is precisely the case the header's contract tolerates for the same
  // reason the motion work tolerated yaw's atan2: unpinned, but never the input to a
  // second engine's hash.
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
  //
  // A dodge is the ONE branch that legitimately drops fire while the boss still
  // holds ammo, and it is bounded twice over — the engine refuses fire mid-dodge
  // anyway (FIRE_WHILE_DODGING is false), and the burst plus its cooldown put a
  // finite, seeded ceiling on how long it lasts. Every other branch below keeps
  // firing whenever it can.
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

  // THE FIRING INVARIANT. With ammo in the pistol, a clear line to the target and
  // a live target, the boss fires THIS TICK — and this flag is carried onto every
  // movement branch below, defensive ones included. So the boss never stands with a
  // loaded pistol and an open shot, which is exactly the "randomly stops shooting"
  // the symmetric-complement boss is forbidden to do. The only states in which it
  // does not fire are ones where firing would be a lie or a waste: out of ammo (it
  // has spent its awarded magazine and truthfully awaits the next round's grant),
  // no line of sight (the ball would only feed a wall), or mid-dodge (handled
  // above, and bounded). It never idles indefinitely while alive, in combat, with
  // ammo and a target — the cadence is `fireIntervalTicks`, enforced in
  // `resolveFiring`, so "bounded cadence" is the engine's, not a second clock here.
  // The firing gate is the RAW line of sight, always: fire ends up equivalent to
  // "ammo, a true clear line, and not mid-dodge" in every branch below, exactly as
  // it was before movement gained hysteresis.
  const canShoot = view.self.ammo > 0 && view.hasLineOfSight;

  const healthFraction = view.self.health / profile.maxHealth;
  const wantsCover =
    view.self.ammo === 0 || healthFraction < profile.coverSeekHealthFraction;
  if (wantsCover) {
    const cover = directionToCover(view);
    if (cover) {
      // Cover discipline is DEFENSIVE MOVEMENT, not a firing halt: a wounded boss
      // backs toward cover while still trading shots whenever the line is open. It
      // stops firing only once cover actually breaks the line (`canShoot` is false
      // without LOS) or the magazine is empty, both of which are honest reasons.
      return intent({ moveX: cover.x, moveZ: cover.z, sprint: true, fire: canShoot, aimX, aimZ });
    }
  }

  if (!moveLos) {
    // No (steady) line: close the distance to reopen it rather than stand in the
    // open. `fire: canShoot` is carried so that if the RAW line is momentarily open
    // during the approach the boss still takes the shot — firing tracks the true
    // line, only the movement branch is debounced.
    return intent({ moveX: direct.x, moveZ: direct.z, sprint: true, fire: canShoot, aimX, aimZ });
  }

  const phase = Math.floor(view.tick / profile.strafePeriodTicks);
  const flip = fieldRandom(seed, phase, SALT_STRAFE) < 0.5 ? 1 : -1;
  const strafeX = -direct.z * flip;
  const strafeZ = direct.x * flip;
  const closing = view.distance > 11 ? 0.6 : view.distance < 5 ? -0.6 : 0;
  return intent({
    moveX: strafeX + direct.x * closing,
    moveZ: strafeZ + direct.z * closing,
    fire: canShoot,
    aimX,
    aimZ,
  });
}
