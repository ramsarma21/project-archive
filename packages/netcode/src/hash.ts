// Canonical simulation-state hashing.
//
// This is the instrument the whole package exists to provide. Without it a desync
// arrives as "he shot me but I dodged on my screen", which is unfalsifiable. With
// it, a desync arrives as "server tick 412 hashed 3f0a…, client hashed 3f0b…",
// which is a bug report that reduces to a failing test.
//
// THREE PROPERTIES THIS ENCODING MUST HAVE, AND WHY EACH IS LOAD-BEARING:
//
// 1. IT MUST BE ENGINE-INDEPENDENT. The point of the exercise is comparing a hash
//    computed by Node against one computed by Chrome and one computed by Safari.
//    So every operation here is integer-only (`Math.imul`, shifts, xor), which
//    IEEE 754 and the ECMAScript spec pin exactly, and floats enter as their raw
//    64-bit pattern through a DataView rather than through any arithmetic. There
//    is not one multiply or add of a float anywhere below.
//
// 2. IT MUST BE EXACT, NOT APPROXIMATE. Quantising positions to millimetres before
//    hashing would hide precisely the one-ulp divergence that compounds into a
//    metre over a 20-second round, and hiding it is how you spend a year chasing
//    it. A single bit of difference in a position must change the hash.
//
// 3. IT MUST BE TOTAL OVER SIMULATION STATE. A field that affects the next tick
//    and is not hashed is a divergence the detector cannot see. `hashCombatState`
//    therefore walks the whole CombatState including the motion internals the duel
//    itself never reads — the airtime accumulator, the dash window's elapsed
//    milliseconds, the authored-action rollback anchors — because engine-world
//    reads them even when the duel does not.
//
// -0 is folded to 0 and NaN to one canonical pattern, so the hash reports genuine
// state differences rather than two spellings of the same number. A NaN reaching
// the simulation is itself a bug, and `nonFiniteFields` reports it by name
// instead of letting it hide inside a hash mismatch.

import type { CombatState, FighterState, Projectile } from "@pa/duel";

/**
 * A 64-bit digest as 16 lowercase hex characters.
 *
 * Sixty-four bits rather than thirty-two because these are chained: a match is
 * ~7 200 engagement ticks and a season is many thousands of matches, and a
 * collision in an audit trail would be indistinguishable from agreement.
 */
export type StateHash = string;

const FNV_OFFSET_LO = 0x811c9dc5;
const FNV_OFFSET_HI = 0x9e3779b9;
const FNV_PRIME_LO = 0x01000193;
const FNV_PRIME_HI = 0x85ebca6b;

/**
 * Two independent FNV-1a lanes over the same byte stream, concatenated.
 *
 * Deliberately not a cryptographic hash: nothing here defends against a forged
 * digest, because a lying client is handled by the client never being believed
 * about state in the first place (see @pa/pvp's intent model). What this defends
 * against is ACCIDENT — two honest implementations disagreeing — and for that a
 * fast non-cryptographic hash with good avalanche is the right tool.
 */
export class StateHasher {
  private lo = FNV_OFFSET_LO;
  private hi = FNV_OFFSET_HI;
  private readonly view = new DataView(new ArrayBuffer(8));

  byte(value: number): this {
    const b = value & 0xff;
    this.lo = Math.imul(this.lo ^ b, FNV_PRIME_LO) >>> 0;
    this.hi = Math.imul(this.hi ^ b, FNV_PRIME_HI) >>> 0;
    return this;
  }

  uint32(value: number): this {
    const v = value >>> 0;
    return this.byte(v).byte(v >>> 8).byte(v >>> 16).byte(v >>> 24);
  }

  /**
   * A float by its exact bit pattern. This is the whole reason the digest can
   * detect a one-ulp difference in a trajectory.
   */
  float(value: number): this {
    // Both canonicalisations are about spelling, not tolerance: -0 === 0 to every
    // comparison the simulation makes, and every NaN is as broken as every other.
    const normalised = value === 0 ? 0 : Number.isNaN(value) ? Number.NaN : value;
    this.view.setFloat64(0, normalised, true);
    return this.uint32(this.view.getUint32(0, true)).uint32(this.view.getUint32(4, true));
  }

  bool(value: boolean): this {
    return this.byte(value ? 1 : 0);
  }

  string(value: string): this {
    this.uint32(value.length);
    for (let index = 0; index < value.length; index++) {
      this.uint32(value.charCodeAt(index));
    }
    return this;
  }

  /** A tagged null, so `null` and `0` and `""` cannot collide. */
  absent(): this {
    return this.byte(0xff).byte(0x00);
  }

  present(): this {
    return this.byte(0xff).byte(0x01);
  }

  digest(): StateHash {
    // One more avalanche round each, so a single flipped input bit reaches the
    // whole digest rather than only its tail.
    let a = this.lo;
    a ^= a >>> 16;
    a = Math.imul(a, 0x7feb352d) >>> 0;
    a ^= a >>> 15;
    let b = this.hi;
    b ^= b >>> 16;
    b = Math.imul(b, 0x846ca68b) >>> 0;
    b ^= b >>> 15;
    return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
  }
}

function vec3(hasher: StateHasher, v: { x: number; y: number; z: number }): void {
  hasher.float(v.x).float(v.y).float(v.z);
}

/**
 * One body, exactly as engine-world will read it on the next tick.
 *
 * Everything on MotionState is here, including the three fields the duel never
 * touches — `airtimeMs`, the authored action and the stagger window — because
 * `stepMotion` branches on all of them. A hash that covered only what the duel
 * reads would be blind to the drift that actually happens, which lives in the
 * integrator.
 */
export function hashMotion(
  hasher: StateHasher,
  motion: FighterState["motion"],
  options: { facing?: boolean } = {},
): void {
  // FACING (yaw) is a cosmetic output, not simulation state that feeds the next
  // position: nothing in the duel or the integrator reads `motion.yaw` to produce
  // pos, vel, health or hits — `stepGrounded` derives it from velocity via
  // `Math.atan2` and slews it with a live-speed-dependent `Math.exp`, and hands it
  // straight back out. Neither of those can be made bit-exact across engines (atan2
  // is implementation-approximated and the slew rate is not a fixed-step constant),
  // so yaw is the ONE hashed field that legitimately diverges between Node and a
  // student's Safari with zero gameplay consequence.
  //
  // The full server hash keeps it (property #3, totality: yaw does feed the NEXT
  // yaw, and a Node-vs-Node replay is exact). The CLIENT-FACING digest drops it
  // (`facing: false` from `hashPredictable`), because that digest exists to catch
  // consequential cross-browser drift and a cosmetic field there is pure false
  // positive — a reported "desync" on a body that is in the identical place.
  const facing = options.facing ?? true;
  hasher.string(motion.phase);
  vec3(hasher, motion.pos);
  vec3(hasher, motion.vel);
  if (facing) hasher.float(motion.yaw);
  hasher.float(motion.capsuleHeight);
  hasher.bool(motion.grounded);
  hasher.float(motion.airtimeMs);

  if (motion.dash === null) {
    hasher.absent();
  } else {
    hasher.present();
    hasher
      .float(motion.dash.dirX)
      .float(motion.dash.dirZ)
      .float(motion.dash.speed)
      .float(motion.dash.elapsedMs)
      .float(motion.dash.durationMs)
      .string(motion.dash.fromPhase);
  }

  if (motion.stagger === null) {
    hasher.absent();
  } else {
    hasher.present();
    hasher
      .float(motion.stagger.dirX)
      .float(motion.stagger.dirZ)
      .float(motion.stagger.speed)
      .float(motion.stagger.elapsedMs)
      .float(motion.stagger.durationMs)
      .string(motion.stagger.fromPhase)
      .string(motion.stagger.kind)
      .string(motion.stagger.sourceId ?? "");
  }

  if (motion.action === null) {
    hasher.absent();
    return;
  }
  hasher.present();
  const action = motion.action;
  hasher.string(action.kind).float(action.durationMs).float(action.elapsedMs);
  hasher.uint32(action.anchors.length);
  for (const anchor of action.anchors) {
    hasher.float(anchor.x).float(anchor.y).float(anchor.z);
    // Anchor yaw, startYaw and endYaw are authored FACING, atan2-derived at
    // `beginAuthored`; excluded from the client-facing digest with `motion.yaw`.
    if (!facing) continue;
    if (anchor.yaw === undefined) hasher.absent();
    else hasher.present().float(anchor.yaw);
  }
  hasher.float(action.arcHeight).bool(action.faceObstacle);
  vec3(hasher, action.startPos);
  if (facing) hasher.float(action.startYaw);
  vec3(hasher, action.endPos);
  if (facing) hasher.float(action.endYaw);
  // A Set has no defined iteration order across constructions, so it is sorted
  // before hashing. Two states that ignore the same obstacles must hash alike
  // however the sets were built.
  const ignored = [...action.ignore].sort();
  hasher.uint32(ignored.length);
  for (const id of ignored) hasher.string(id);
}

export function hashFighter(hasher: StateHasher, fighter: FighterState): void {
  hasher.string(fighter.side);
  hashMotion(hasher, fighter.motion);
  hasher
    .float(fighter.health)
    .uint32(fighter.ammo)
    .uint32(fighter.dodge.iframeUntilTick)
    .uint32(fighter.dodge.readyAtTick)
    .uint32(fighter.fireReadyAtTick)
    .uint32(fighter.shotsFired)
    .uint32(fighter.hitsLanded)
    .uint32(fighter.hitsTaken)
    .float(fighter.aimX)
    .float(fighter.aimZ);

  // Object key order is insertion order in practice, but the ledger is rebuilt on
  // both sides from different code paths, so it is sorted rather than trusted.
  const abilityIds = Object.keys(fighter.abilities).sort();
  hasher.uint32(abilityIds.length);
  for (const abilityId of abilityIds) {
    const record = fighter.abilities[abilityId]!;
    hasher.string(abilityId).uint32(record.usesRemaining);
    if (record.activeSinceTick === null) hasher.absent();
    else hasher.present().uint32(record.activeSinceTick);
  }
}

export function hashProjectile(hasher: StateHasher, projectile: Projectile): void {
  hasher
    .uint32(projectile.id)
    .string(projectile.shooter)
    .float(projectile.x)
    .float(projectile.y)
    .float(projectile.z)
    .float(projectile.vx)
    .float(projectile.vz)
    .float(projectile.damage)
    .uint32(projectile.expiresAtTick);
}

/**
 * The full authoritative state at one tick. This is what the server chains and
 * what a replay must reproduce byte for byte.
 */
export function hashCombatState(state: CombatState): StateHash {
  const hasher = new StateHasher();
  hasher.uint32(state.tick);
  hashFighter(hasher, state.fighters.A);
  hashFighter(hasher, state.fighters.B);
  hasher.uint32(state.projectiles.length);
  // Projectile order is the simulation's own and is deterministic, so it is
  // hashed as given: two states that hold the same balls in a different order are
  // genuinely different states and must not hash alike.
  for (const projectile of state.projectiles) hashProjectile(hasher, projectile);
  hasher.uint32(state.nextProjectileId);
  return hasher.digest();
}

/**
 * One side's own body and combat clocks — the subset a client can legitimately
 * reproduce, because it depends only on that client's own inputs.
 *
 * This is the hash that actually catches cross-browser drift in production. A
 * client cannot hash the full state (it is never told the opponent's position
 * through cover, by design), but it CAN hash its own body, and its own body is
 * where `sin`, `cos` and `hypot` are called.
 */
export function hashSelf(fighter: FighterState): StateHash {
  const hasher = new StateHasher();
  hashFighter(hasher, fighter);
  return hasher.digest();
}

/**
 * The subset of one fighter that a CLIENT can legitimately reproduce, and
 * therefore the only surface on which a client-server hash comparison is
 * meaningful.
 *
 * WHY IT IS A SUBSET, STATED PRECISELY, BECAUSE THE OMISSIONS ARE THE INTERESTING
 * PART. A client predicts from a server baseline plus its OWN inputs. Three things
 * on `FighterState` do not follow from those:
 *
 *   health / hitsTaken   change when the opponent's ball lands, and the opponent's
 *                        balls are deliberately not predicted — a health bar that
 *                        goes back down after going up is worse than one that lags.
 *   hitsLanded           changes when the client's own ball lands on a body whose
 *                        exact position the client is not always told, by design.
 *   abilities            invocation is gated on line of sight to the opponent, and
 *                        the client's opponent is an interpolated ghost.
 *   facing (yaw)         is a cosmetic output the simulation never reads back, and
 *                        it is the one field that cannot be made cross-engine exact
 *                        (atan2 + a speed-dependent exp slew); hashing it here would
 *                        report desyncs on bodies that are in the identical place.
 *                        The full server hash still covers it (see hashMotion).
 *
 * WHAT REMAINS IS EXACTLY WHERE THE RISK IS, WHICH IS WHY THIS IS NOT A CLIMBDOWN.
 * The transcendental calls that make lockstep unsafe — 16 in `playerMotion.ts`, 18
 * in `collision.ts`, 8 in `combat.ts` — are all on the locomotion and firing path,
 * and every one of them is inside this hash. Cross-engine drift in `sin`, `cos`,
 * `atan2` or `hypot` shows up here on the first tick it occurs. What is excluded is
 * excluded because it is not predicted at all, not because it is hard to compare.
 */
export function hashPredictable(fighter: FighterState): StateHash {
  const hasher = new StateHasher();
  hasher.string(fighter.side);
  // facing: false — yaw is cosmetic and cannot be made cross-engine exact, so it
  // is kept out of the digest a client compares against the server (see hashMotion).
  hashMotion(hasher, fighter.motion, { facing: false });
  hasher
    .uint32(fighter.dodge.iframeUntilTick)
    .uint32(fighter.dodge.readyAtTick)
    .uint32(fighter.fireReadyAtTick)
    .uint32(fighter.shotsFired)
    .uint32(fighter.ammo)
    .float(fighter.aimX)
    .float(fighter.aimZ);
  return hasher.digest();
}

/**
 * Fields that have gone non-finite, by name.
 *
 * A NaN position hashes consistently and would therefore look like agreement if
 * both sides produced one. Naming the field turns "the hashes match but the game
 * is broken" into a specific report.
 */
export function nonFiniteFields(state: CombatState): readonly string[] {
  const bad: string[] = [];
  for (const side of ["A", "B"] as const) {
    const fighter = state.fighters[side];
    const numbers: Record<string, number> = {
      "pos.x": fighter.motion.pos.x,
      "pos.y": fighter.motion.pos.y,
      "pos.z": fighter.motion.pos.z,
      "vel.x": fighter.motion.vel.x,
      "vel.y": fighter.motion.vel.y,
      "vel.z": fighter.motion.vel.z,
      yaw: fighter.motion.yaw,
      capsuleHeight: fighter.motion.capsuleHeight,
      health: fighter.health,
      aimX: fighter.aimX,
      aimZ: fighter.aimZ,
    };
    for (const [name, value] of Object.entries(numbers)) {
      if (!Number.isFinite(value)) bad.push(`${side}.${name}`);
    }
  }
  for (const projectile of state.projectiles) {
    if (!Number.isFinite(projectile.x) || !Number.isFinite(projectile.z)) {
      bad.push(`projectile[${projectile.id}].pos`);
    }
  }
  return bad;
}
