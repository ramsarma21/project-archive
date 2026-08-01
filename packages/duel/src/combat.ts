// The deterministic fixed-step gunfight.
//
// What this module owns, because none of it exists anywhere in the repo:
// projectiles with travel time, hit resolution, damage, health, the dodge window,
// and the combat meaning of cover.
//
// What it does NOT own, and must never grow: movement. Every displacement in
// this file goes through engine-world's `stepMotion`, at engine-world's
// FIELD_DT, using engine-world's speed selection (`freeMoveSpeed`) and jump
// policy (`resolveFreeJump`). Cover and line of sight are queries against the
// mission's CollisionWorld via `segmentOccluderIds` / `segmentClear`. A dodge is
// a scaled target velocity handed to the same integrator that runs a vault, so a
// dash ability cannot behave differently here than it does in a mission.
//
// One tick, in this order, always:
//   1. retire finished ability effects
//   2. resolve ability invocations
//   3. resolve dodge starts
//   4. locomotion (A then B) through stepMotion
//   5. resolve firing and spawn projectiles
//   6. advance projectiles; cover first, then actors
//   7. cull expired projectiles
//
// Movement resolves before projectiles advance, so a dodge that lands this tick
// genuinely evades a ball that would otherwise have connected. Firing resolves
// after movement, so a shot leaves from where the body actually ended up.

import {
  FIELD_DT,
  beginDash,
  beginRunningJump,
  beginStandingJump,
  cancelDash,
  chestPosition,
  createGroundedState,
  dashSpeed,
  eyePosition,
  freeMoveSpeed,
  isCrouched,
  isDashing,
  segmentHitsCapsule,
  segmentOccluderIds,
  segmentClear,
  stepMotion,
  toggleFreeCrouch,
  RUN_SPEED,
  type CollisionWorld,
  type MotionState,
  type Vec3,
} from "./engine.js";
import {
  activeModifiers,
  createAbilityLedger,
  expireAbilityEffects,
  invokeAbility,
  type AbilityLedger,
  type AbilityLoadout,
  type AbilityModifiers,
} from "./abilities.js";
import type { DuelEvent } from "./events.js";
import { otherSide, type BySide, type DuelSide } from "./sides.js";
import {
  AIM_ASSIST_MAX_RAD,
  BULLET_LIFETIME_TICKS,
  BULLET_SPEED_MPS,
  DODGE_COOLDOWN_TICKS,
  DODGE_IFRAME_TICKS,
  FIRE_WHILE_DODGING,
  MAX_BULLET_HEIGHT_M,
  MIN_BULLET_HEIGHT_M,
  MUZZLE_OFFSET_M,
  PLAYER_AIM_ASSIST,
  PLAYER_MAX_HEALTH,
  PLAYER_SHOT_DAMAGE,
  FIRE_INTERVAL_TICKS,
  type AimAssistProfile,
} from "./tuning.js";

// ---- determinism helpers ---------------------------------------------------
//
// Every planar length below feeds the hashed simulation state — a target
// velocity, an aim heading, a dodge direction, a spawned ball — and the whole
// point of @pa/netcode's digest is comparing a hash computed by Node against one
// computed by a student's browser. So none of them may go through `Math.hypot`,
// which IEEE 754 and the ECMAScript spec leave implementation-approximated: V8,
// JavaScriptCore and SpiderMonkey can each return a different last bit for it. This
// form uses only the ops the standard DOES pin (+, -, *, /, sqrt), so it is
// bit-identical on every engine. It mirrors engine-world's `horizSpeed` in
// playerMotion.ts exactly, for exactly the same reason.

function planarLength(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}

// cos(AIM_ASSIST_MAX_RAD), BAKED as a decimal literal for the reason engine-world
// bakes its accel/decel blends. `Math.cos` is implementation-approximated, so
// computing it at load would reintroduce the cross-engine spread this change
// removes; a numeric literal, by contrast, is required by ECMAScript to parse to
// the nearest double on every conforming engine. This equals
// `Math.cos(AIM_ASSIST_MAX_RAD)` on the authoring engine, so it is a no-op there
// (no golden shift) and a determinism fix everywhere else. `combat.test.ts`
// re-derives it and fails if AIM_ASSIST_MAX_RAD ever drifts away from it. Exported
// only so that guard can compare it against `Math.cos(AIM_ASSIST_MAX_RAD)`, exactly
// as engine-world exports GROUNDED_ACCEL_BLEND for its own re-derivation test.
export const AIM_ASSIST_MAX_RAD_COS = 0.9780309147241483;

/**
 * The baked cosine of an aim-assist cone cap. Only PLAYER_AIM_ASSIST ships, so only
 * its cap is baked; any other cap has no exact cosine here and is failed loudly
 * rather than silently reaching for `Math.cos` on the hashed firing path.
 */
function aimAssistMaxCos(assist: AimAssistProfile): number {
  if (assist.maxRadians === AIM_ASSIST_MAX_RAD) return AIM_ASSIST_MAX_RAD_COS;
  throw new Error(
    `aim-assist cap ${assist.maxRadians} rad has no baked cosine; add one beside ` +
      `AIM_ASSIST_MAX_RAD_COS so the snap test stays engine-exact rather than calling Math.cos.`,
  );
}

// ---- intents ---------------------------------------------------------------

/**
 * One tick of will. Deliberately shaped like the engine's input policy rather
 * than like a duel: `sprint` is Shift, `crouch` is C, `jump` is Space, and they
 * mean in a duel exactly what they mean in a mission.
 */
export interface CombatIntent {
  readonly moveX: number;
  readonly moveZ: number;
  readonly sprint: boolean;
  readonly crouch: boolean;
  readonly jump: boolean;
  readonly dodge: boolean;
  readonly fire: boolean;
  readonly aimX: number;
  readonly aimZ: number;
  readonly abilityId: string | null;
}

export const IDLE_INTENT: CombatIntent = {
  moveX: 0,
  moveZ: 0,
  sprint: false,
  crouch: false,
  jump: false,
  dodge: false,
  fire: false,
  aimX: 0,
  aimZ: 0,
  abilityId: null,
};

export function intent(overrides: Partial<CombatIntent>): CombatIntent {
  return { ...IDLE_INTENT, ...overrides };
}

// ---- state -----------------------------------------------------------------

/**
 * The COMBAT meaning of a dodge, and nothing else.
 *
 * The motion is the engine's `DASH` phase: its direction, speed, duration and
 * every metre of displacement live on `MotionState.dash`, so `isDashing(motion)`
 * answers "is a dodge open". What remains here is what only a gunfight cares
 * about — how long the roll grants immunity, and when the next one is allowed.
 */
export interface DodgeWindow {
  /** Tick immunity ends. Shorter than the burst, so the roll outlasts the frames. */
  readonly iframeUntilTick: number;
  readonly readyAtTick: number;
}

export const IDLE_DODGE: DodgeWindow = {
  iframeUntilTick: 0,
  readyAtTick: 0,
};

export interface FighterState {
  readonly side: DuelSide;
  /** Owned by engine-world. The duel reads it and hands it back to stepMotion. */
  readonly motion: MotionState;
  readonly health: number;
  readonly ammo: number;
  readonly dodge: DodgeWindow;
  readonly fireReadyAtTick: number;
  readonly abilities: AbilityLedger;
  readonly shotsFired: number;
  readonly hitsLanded: number;
  readonly hitsTaken: number;
  readonly aimX: number;
  readonly aimZ: number;
}

export interface Projectile {
  readonly id: number;
  readonly shooter: DuelSide;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
  readonly damage: number;
  readonly expiresAtTick: number;
}

export interface CombatState {
  readonly tick: number;
  readonly fighters: BySide<FighterState>;
  readonly projectiles: readonly Projectile[];
  readonly nextProjectileId: number;
}

export interface FighterParams {
  readonly maxHealth: number;
  readonly shotDamage: number;
  readonly fireIntervalTicks: number;
  /**
   * THE ABILITY SEAM. Empty in everything that ships today, by instruction: the
   * owner has not settled the ability set, so no behaviour is authored here.
   *
   * The plumbing is complete and deliberately left intact, which is the whole point
   * — see the header of abilities.ts for what an author has to do, which is
   * "nothing in this file".
   */
  readonly loadout: AbilityLoadout;
  /** Mobility scaling. 1 for a player; a boss profile may differ. */
  readonly moveSpeedScale: number;
  /**
   * Aim correction for this fighter, or null for none. Null on a boss: its
   * accuracy is authored as `aimErrorRad` and an assist would snap the jitter away.
   */
  readonly aimAssist: AimAssistProfile | null;
}

export type CombatParams = BySide<FighterParams>;

export const PLAYER_PARAMS: FighterParams = {
  maxHealth: PLAYER_MAX_HEALTH,
  shotDamage: PLAYER_SHOT_DAMAGE,
  fireIntervalTicks: FIRE_INTERVAL_TICKS,
  loadout: [],
  moveSpeedScale: 1,
  aimAssist: PLAYER_AIM_ASSIST,
};

export function playerParams(loadout: AbilityLoadout = []): FighterParams {
  return { ...PLAYER_PARAMS, loadout };
}

export function createFighter(
  side: DuelSide,
  params: FighterParams,
  pos: Vec3,
  yaw: number,
): FighterState {
  return {
    side,
    motion: createGroundedState(pos, yaw),
    health: params.maxHealth,
    ammo: 0,
    dodge: IDLE_DODGE,
    fireReadyAtTick: 0,
    abilities: createAbilityLedger(params.loadout),
    shotsFired: 0,
    hitsLanded: 0,
    hitsTaken: 0,
    // The initial aim heading is seeded from the placement yaw with sin/cos, which
    // ARE implementation-approximated — and it is left that way ON PURPOSE, by the
    // same test the motion work applied: does this call ever execute on the
    // cross-engine hashed path? It does not. `createFighter` runs once, on the
    // authority, at match start; the resulting aimX/aimZ are serialised into the
    // baseline snapshot the server sends every client, and a predicting client
    // seeds its own body from that baseline and never re-derives it (see
    // @pa/netcode's `predict`). A replay likewise starts from the recorded baseline.
    // So the seed is computed exactly once, by one engine, and transmitted — never
    // recomputed by a second engine for comparison. Baking it would demand a literal
    // per placement yaw for no determinism gain, and @pa/netcode's own perturbation
    // sweep deliberately builds the start state outside its perturbation for this
    // exact reason. Once a shot is fired or an aim input arrives, aimX/aimZ are
    // overwritten by the sqrt-normalised heading in `stepFighterMotion` / firing,
    // which IS engine-exact.
    aimX: Math.sin(yaw),
    aimZ: Math.cos(yaw),
  };
}

export function createCombatState(
  params: CombatParams,
  placement: BySide<{ pos: Vec3; yaw: number }>,
): CombatState {
  return {
    tick: 0,
    fighters: {
      A: createFighter("A", params.A, placement.A.pos, placement.A.yaw),
      B: createFighter("B", params.B, placement.B.pos, placement.B.yaw),
    },
    projectiles: [],
    nextProjectileId: 1,
  };
}

// ---- aiming ----------------------------------------------------------------

/**
 * Direction that intercepts a mover, or null when the ball cannot catch them.
 *
 * Lives in combat rather than in policy because it is now load-bearing for the
 * PLAYER as well as for the boss: it is the target the aim assist snaps to. One
 * solver, so a human's assisted shot and a boss's lead solution cannot disagree
 * about where a running man will be.
 */
export function solveInterceptDirection(
  from: { x: number; z: number },
  target: { x: number; z: number },
  targetVel: { x: number; z: number },
  bulletSpeed = BULLET_SPEED_MPS,
): { x: number; z: number } | null {
  const rx = target.x - from.x;
  const rz = target.z - from.z;
  const a =
    targetVel.x * targetVel.x + targetVel.z * targetVel.z - bulletSpeed * bulletSpeed;
  const b = 2 * (rx * targetVel.x + rz * targetVel.z);
  const c = rx * rx + rz * rz;

  let t: number | null = null;
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) > 1e-9) t = -c / b;
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      const t1 = (-b + root) / (2 * a);
      const t2 = (-b - root) / (2 * a);
      const positives = [t1, t2].filter((value) => value > 1e-6);
      if (positives.length > 0) t = Math.min(...positives);
    }
  }
  if (t === null || !Number.isFinite(t)) {
    const length = planarLength(rx, rz);
    return length > 1e-6 ? { x: rx / length, z: rz / length } : null;
  }
  const aimX = rx + targetVel.x * t;
  const aimZ = rz + targetVel.z * t;
  const length = planarLength(aimX, aimZ);
  return length > 1e-6 ? { x: aimX / length, z: aimZ / length } : null;
}

/**
 * The aim model, applied. See the AIM MODEL block in tuning.ts for the reasoning.
 *
 * Inside a cone around the true intercept solution the aim snaps to it; outside,
 * the aim is returned untouched. The correction is applied to the DIRECTION before
 * the ball exists, never to the ball, so the tracer the opponent reads and the path
 * the ball takes are the same line.
 *
 * Deterministic and allocation-light: one solve, one dot product, no clock, no RNG.
 */
export function assistedAim(
  shooter: FighterState,
  target: FighterState,
  desiredX: number,
  desiredZ: number,
  assist: AimAssistProfile | null,
  canTarget: boolean,
): { x: number; z: number } {
  const length = planarLength(desiredX, desiredZ);
  const desired =
    length > 1e-6 ? { x: desiredX / length, z: desiredZ / length } : { x: 0, z: 0 };
  if (!assist || !canTarget || isDowned(target) || length <= 1e-6) return desired;

  const solution = solveInterceptDirection(
    shooter.motion.pos,
    target.motion.pos,
    { x: target.motion.vel.x, z: target.motion.vel.z },
  );
  if (!solution) return desired;

  const distance = planarLength(
    target.motion.pos.x - shooter.motion.pos.x,
    target.motion.pos.z - shooter.motion.pos.z,
  );
  // The snap test is "is the desired heading inside the tolerance cone around the
  // intercept solution", where the tolerance is the smaller of a fixed cap and the
  // angle the lateral forgiveness subtends at this range:
  //
  //   snap  iff  angle(desired, solution) <= min(maxRadians, atan2(lateral, dist))
  //
  // This decision is LOAD-BEARING and on the hashed path: its output becomes the
  // shot's heading, which sets aimX/aimZ and the spawned ball's velocity, and a
  // predicting client runs exactly this for its own shots (see @pa/netcode's
  // `hashPredictable`). Written with `atan2` and `acos` — both
  // implementation-approximated — the snap flips between engines near the cone edge,
  // which is a ball that connects on the server and misses in the browser. So the
  // whole comparison is moved into cosine space, where it uses only IEEE-pinned ops
  // and one baked constant. Since cos is monotonically decreasing on [0, pi] and
  // every angle here lies in [0, pi/2], the angle inequality is exactly a
  // dot-product one:
  //
  //   acos(dot) <= min(maxRadians, atan2(lat, dist))
  //     <=> dot >= cos(min(maxRadians, atan2(lat, dist)))
  //     <=> dot >= max(cos(maxRadians), cos(atan2(lat, dist)))
  //
  // and cos(atan2(lat, dist)) is exactly dist / sqrt(lat*lat + dist*dist) — the
  // adjacent over the hypotenuse of that right triangle — which is pure sqrt and
  // divide, no transcendental. cos(maxRadians) is the one term with no algebraic
  // route, so it is baked (`aimAssistMaxCos`). The clamp on `dot` is kept: rounding
  // can carry a unit-vector dot a hair past 1, and the comparison must not be fed a
  // value it could never legitimately reach.
  const dist = Math.max(distance, 1e-3);
  const cosLateral =
    dist / Math.sqrt(assist.lateralMetres * assist.lateralMetres + dist * dist);
  const cosTolerance = Math.max(aimAssistMaxCos(assist), cosLateral);
  const dot = Math.max(-1, Math.min(1, desired.x * solution.x + desired.z * solution.z));
  return dot >= cosTolerance ? solution : desired;
}

// ---- queries ---------------------------------------------------------------

/** Is a dodge open? The engine's burst window is the single source of truth. */
export function isDodging(fighter: FighterState): boolean {
  return isDashing(fighter.motion);
}

export function isInvulnerable(fighter: FighterState, tick: number): boolean {
  return tick < fighter.dodge.iframeUntilTick;
}

export function isDowned(fighter: FighterState): boolean {
  return fighter.health <= 0;
}

/** Eye-to-eye line of sight, as a query against the mission's collision world. */
export function hasLineOfSight(
  world: CollisionWorld,
  from: FighterState,
  to: FighterState,
): boolean {
  return segmentClear(world, eyePosition(from.motion), eyePosition(to.motion));
}

/**
 * The height an aimed ball flies at: the target's chest, clamped out of the floor
 * and out of the sky.
 *
 * ONE definition, deliberately. `resolveFiring` spawns the ball at this height and
 * `isExposedToShot` below asks whether a lane at this height is clear, so a second
 * expression of it would be a predicate that quietly disagrees with the ballistics
 * it claims to describe.
 */
export function aimHeightFor(target: MotionState): number {
  return Math.min(
    MAX_BULLET_HEIGHT_M,
    Math.max(MIN_BULLET_HEIGHT_M, chestPosition(target).y),
  );
}

/**
 * Can a ball fired by `shooter` actually reach `target`, or does the world eat it?
 *
 * NOT `hasLineOfSight`, AND THE DIFFERENCE IS LOAD-BEARING RATHER THAN PEDANTIC.
 * Sight is eye to eye. A ball flies FLAT at the target's chest (`aimHeightFor`),
 * which is lower — 1.12 m standing against a 1.43 m eye. Behind the rope-walk
 * yard's cover, every piece of which is 1.30 m or taller, a STANDING fighter's eyes
 * clear the top while its chest does not, so the eye line reports an open shot at a
 * body no ball can touch: measured true at four of the yard's six valid cover
 * points, in both stances.
 *
 * That gap is why standing up is not a way out of cover and why the boss's exposed
 * reload is gated on this rather than on sight — anything asking "is this fighter
 * hittable" has to ask on the ball's lane.
 */
export function isExposedToShot(
  world: CollisionWorld,
  shooter: FighterState,
  target: FighterState,
): boolean {
  const y = aimHeightFor(target.motion);
  return segmentClear(
    world,
    { x: shooter.motion.pos.x, y, z: shooter.motion.pos.z },
    { x: target.motion.pos.x, y, z: target.motion.pos.z },
  );
}

export function distanceBetween(a: FighterState, b: FighterState): number {
  return planarLength(a.motion.pos.x - b.motion.pos.x, a.motion.pos.z - b.motion.pos.z);
}

/** Read-only view handed to an opponent policy. Policies never see raw state. */
export interface CombatView {
  readonly tick: number;
  readonly self: FighterState;
  readonly opponent: FighterState;
  readonly hasLineOfSight: boolean;
  readonly distance: number;
  readonly incoming: readonly Projectile[];
  readonly world: CollisionWorld;
}

export function combatView(
  world: CollisionWorld,
  state: CombatState,
  side: DuelSide,
): CombatView {
  const self = state.fighters[side];
  const opponent = state.fighters[otherSide(side)];
  return {
    tick: state.tick,
    self,
    opponent,
    hasLineOfSight: hasLineOfSight(world, self, opponent),
    distance: distanceBetween(self, opponent),
    incoming: state.projectiles.filter((p) => p.shooter !== side),
    world,
  };
}

// ---- the step --------------------------------------------------------------

export interface CombatStepResult {
  readonly state: CombatState;
  readonly events: readonly DuelEvent[];
}

export function stepCombat(
  world: CollisionWorld,
  state: CombatState,
  intents: BySide<CombatIntent>,
  params: CombatParams,
  round: number,
): CombatStepResult {
  const tick = state.tick + 1;
  const events: DuelEvent[] = [];

  // 1 + 2. Ability effects retire, then invocations resolve, so a one-tick
  // ability cannot be refreshed by re-pressing on the same tick it expires.
  let fighters = state.fighters;
  fighters = {
    A: resolveAbilities(world, fighters, "A", intents.A, params.A, tick, round, events),
    B: resolveAbilities(world, fighters, "B", intents.B, params.B, tick, round, events),
  };
  const modifiers: BySide<AbilityModifiers> = {
    A: activeModifiers(params.A.loadout, fighters.A.abilities, tick),
    B: activeModifiers(params.B.loadout, fighters.B.abilities, tick),
  };

  // 3 + 4. Dodge windows open, then everyone moves through stepMotion.
  fighters = {
    A: stepFighterMotion(world, fighters.A, intents.A, params.A, modifiers, tick, events),
    B: stepFighterMotion(world, fighters.B, intents.B, params.B, modifiers, tick, events),
  };

  // 5. Firing.
  let projectiles = [...state.projectiles];
  let nextProjectileId = state.nextProjectileId;
  for (const side of ["A", "B"] as const) {
    const shooter = fighters[side];
    const target = fighters[otherSide(side)];
    // `revealsOpponentThroughCover` is the perception channel of the ability
    // contract, and this is the only thing in combat that reads it: it lifts the
    // assist's sight requirement, which is targeting, never occlusion — the wall
    // still stops the ball. Inert until an ability sets it, which nothing does yet.
    const canTarget =
      hasLineOfSight(world, shooter, target) ||
      modifiers[side].revealsOpponentThroughCover;
    const shot = resolveFiring(
      shooter,
      target,
      intents[side],
      params[side],
      modifiers[otherSide(side)],
      tick,
      nextProjectileId,
      canTarget,
    );
    if (!shot) continue;
    projectiles.push(shot.projectile);
    fighters = { ...fighters, [side]: shot.shooter } as BySide<FighterState>;
    nextProjectileId += 1;
    events.push({
      type: "SHOT_FIRED",
      round,
      tick,
      side,
      projectileId: shot.projectile.id,
      ammoRemaining: shot.shooter.ammo,
    });
  }

  // 6 + 7. Projectiles travel, resolve, and expire.
  const resolved = advanceProjectiles(
    world,
    projectiles,
    fighters,
    modifiers,
    tick,
    events,
  );
  fighters = resolved.fighters;
  projectiles = resolved.projectiles;

  for (const side of ["A", "B"] as const) {
    if (isDowned(fighters[side]) && !isDowned(state.fighters[side])) {
      events.push({ type: "KNOCKOUT", tick, downed: side });
    }
  }

  return {
    state: { tick, fighters, projectiles, nextProjectileId },
    events,
  };
}

function resolveAbilities(
  world: CollisionWorld,
  fighters: BySide<FighterState>,
  side: DuelSide,
  fighterIntent: CombatIntent,
  params: FighterParams,
  tick: number,
  round: number,
  events: DuelEvent[],
): FighterState {
  const fighter = fighters[side];
  const opponent = fighters[otherSide(side)];
  let ledger = expireAbilityEffects(params.loadout, fighter.abilities, tick);
  const abilityId = fighterIntent.abilityId;
  if (abilityId !== null) {
    const outcome = invokeAbility(params.loadout, ledger, abilityId, {
      round,
      tick,
      selfHealth: fighter.health,
      selfHealthFraction: fighter.health / params.maxHealth,
      ammoRemaining: fighter.ammo,
      hasLineOfSightToOpponent: hasLineOfSight(world, fighter, opponent),
      grounded: fighter.motion.grounded,
    });
    if (outcome.ok) {
      ledger = outcome.ledger;
      events.push({
        type: "ABILITY_INVOKED",
        tick,
        side,
        abilityId,
        usesRemaining: ledger[abilityId]?.usesRemaining ?? 0,
      });
    } else {
      events.push({
        type: "ABILITY_REFUSED",
        tick,
        side,
        abilityId,
        reason: outcome.reason,
      });
    }
  }
  return ledger === fighter.abilities ? fighter : { ...fighter, abilities: ledger };
}

function stepFighterMotion(
  world: CollisionWorld,
  fighter: FighterState,
  fighterIntent: CombatIntent,
  params: FighterParams,
  modifiers: BySide<AbilityModifiers>,
  tick: number,
  events: DuelEvent[],
): FighterState {
  if (isDowned(fighter)) return fighter;

  const self = modifiers[fighter.side];
  const opponent = modifiers[otherSide(fighter.side)];
  let dodge = fighter.dodge;
  let motion = fighter.motion;

  // Crouch is the engine's toggle, so a refused stand (no head clearance) is
  // refused here for the same reason it is refused in a mission. Stance comes from
  // the live capsule rather than the phase name, because a burst out of a crouch
  // is still crouched.
  if (fighterIntent.crouch !== isCrouched(motion.capsuleHeight) && !isDashing(motion)) {
    motion = toggleFreeCrouch(world, motion).state;
  }

  const speedScale =
    params.moveSpeedScale * self.selfMoveSpeedScale * opponent.opponentMoveSpeedScale;

  // A dodge opens the engine's burst. Whether it is legal at all is `canDash`'s
  // call inside beginDash — grounded, not mid-action, not already bursting — so the
  // duel does not restate movement rules; it only adds the two combat clocks, and
  // only if the burst actually opened.
  const wantsDodge =
    fighterIntent.dodge && tick >= dodge.readyAtTick && !isDashing(motion);
  if (wantsDodge) {
    // A dodge with no direction held used to do nothing at all, silently — the
    // worst possible response to a button press, and the one a panicking player
    // makes most. It backsteps instead, away from where they are aiming, which is
    // both the genre convention and the only guess that is ever right by default.
    const moveLength = planarLength(fighterIntent.moveX, fighterIntent.moveZ);
    const dirX = moveLength > 1e-6 ? fighterIntent.moveX : -fighter.aimX;
    const dirZ = moveLength > 1e-6 ? fighterIntent.moveZ : -fighter.aimZ;
    const burst = beginDash(
      motion,
      dirX,
      dirZ,
      dashSpeed(RUN_SPEED * speedScale),
    );
    if (isDashing(burst)) {
      motion = burst;
      dodge = {
        iframeUntilTick: tick + DODGE_IFRAME_TICKS,
        readyAtTick: tick + DODGE_COOLDOWN_TICKS,
      };
      events.push({
        type: "DODGE_STARTED",
        tick,
        side: fighter.side,
        dirX: burst.dash?.dirX ?? 0,
        dirZ: burst.dash?.dirZ ?? 0,
      });
    }
  }

  // Computed unconditionally: stepMotion substitutes the burst velocity while a
  // dash is open, so there is no branch here and no second notion of "how fast am
  // I going".
  const moveLength = planarLength(fighterIntent.moveX, fighterIntent.moveZ);
  const speed =
    freeMoveSpeed({
      shiftHeld: fighterIntent.sprint,
      moving: moveLength > 1e-6,
      crouched: isCrouched(motion.capsuleHeight),
      actionActive: false,
    }) * speedScale;
  const target =
    moveLength > 1e-6
      ? {
          x: (fighterIntent.moveX / moveLength) * speed,
          z: (fighterIntent.moveZ / moveLength) * speed,
        }
      : { x: 0, z: 0 };

  if (fighterIntent.jump && motion.grounded && !isDashing(motion)) {
    const speed = planarLength(motion.vel.x, motion.vel.z);
    motion =
      fighterIntent.sprint && speed >= 1.2
        ? beginRunningJump(motion)
        : beginStandingJump(motion);
  }

  const stepped = stepMotion(world, motion, {
    dt: FIELD_DT,
    targetVelX: target.x,
    targetVelZ: target.z,
    reducedMotion: false,
  });

  const aimLength = planarLength(fighterIntent.aimX, fighterIntent.aimZ);
  return {
    ...fighter,
    motion: stepped.state,
    dodge,
    aimX: aimLength > 1e-6 ? fighterIntent.aimX / aimLength : fighter.aimX,
    aimZ: aimLength > 1e-6 ? fighterIntent.aimZ / aimLength : fighter.aimZ,
  };
}

function resolveFiring(
  shooter: FighterState,
  target: FighterState,
  fighterIntent: CombatIntent,
  params: FighterParams,
  opponentModifiers: AbilityModifiers,
  tick: number,
  projectileId: number,
  canTarget: boolean,
): { projectile: Projectile; shooter: FighterState } | null {
  if (!fighterIntent.fire) return null;
  if (isDowned(shooter) || shooter.ammo <= 0) return null;
  if (tick < shooter.fireReadyAtTick) return null;
  if (!FIRE_WHILE_DODGING && isDodging(shooter)) return null;

  // An empty aim vector means "the client had nothing new to say", not "shoot at
  // the floor". Falling back to the last committed facing keeps a press from being
  // silently eaten on the one frame the pointer has not moved yet — the previous
  // behaviour swallowed the shot AND the client's fire latch with it.
  const requestedLength = planarLength(fighterIntent.aimX, fighterIntent.aimZ);
  const requestedX = requestedLength > 1e-6 ? fighterIntent.aimX : shooter.aimX;
  const requestedZ = requestedLength > 1e-6 ? fighterIntent.aimZ : shooter.aimZ;
  const aimed = assistedAim(
    shooter,
    target,
    requestedX,
    requestedZ,
    params.aimAssist,
    canTarget,
  );
  if (planarLength(aimed.x, aimed.z) <= 1e-6) return null;
  const dirX = aimed.x;
  const dirZ = aimed.z;

  // An aimed shot travels flat at the height of the body it was aimed at, which
  // is what makes crouching meaningful in both directions: a ball aimed at a
  // standing chest sails over a fighter who drops, and a ball aimed low is eaten
  // by the cover the shooter is trying to shoot past.
  const aimHeight = aimHeightFor(target.motion);
  const muzzle = chestPosition(shooter.motion);
  const interval = Math.max(
    1,
    Math.round(params.fireIntervalTicks * opponentModifiers.opponentFireIntervalScale),
  );

  return {
    projectile: {
      id: projectileId,
      shooter: shooter.side,
      x: muzzle.x + dirX * MUZZLE_OFFSET_M,
      y: aimHeight,
      z: muzzle.z + dirZ * MUZZLE_OFFSET_M,
      vx: dirX * BULLET_SPEED_MPS,
      vz: dirZ * BULLET_SPEED_MPS,
      damage: params.shotDamage,
      expiresAtTick: tick + BULLET_LIFETIME_TICKS,
    },
    shooter: {
      ...shooter,
      ammo: shooter.ammo - 1,
      shotsFired: shooter.shotsFired + 1,
      fireReadyAtTick: tick + interval,
      aimX: dirX,
      aimZ: dirZ,
    },
  };
}

function advanceProjectiles(
  world: CollisionWorld,
  projectiles: readonly Projectile[],
  fightersIn: BySide<FighterState>,
  modifiers: BySide<AbilityModifiers>,
  tick: number,
  events: DuelEvent[],
): { projectiles: Projectile[]; fighters: BySide<FighterState> } {
  let fighters = fightersIn;
  const survivors: Projectile[] = [];

  for (const projectile of projectiles) {
    const from: Vec3 = { x: projectile.x, y: projectile.y, z: projectile.z };
    const to: Vec3 = {
      x: projectile.x + projectile.vx * FIELD_DT,
      y: projectile.y,
      z: projectile.z + projectile.vz * FIELD_DT,
    };

    const targetSide = otherSide(projectile.shooter);
    const target = fighters[targetSide];
    // MotionState satisfies the engine's BodyPose, so the ball is tested against
    // the same capsule the world collides with — including its live height, which
    // is what makes ducking under an aimed shot work.
    const hit = isDowned(target)
      ? null
      : segmentHitsCapsule(
          from,
          to,
          target.motion.pos,
          target.motion.capsuleHeight,
        );

    // Cover is checked against the sub-segment up to the hit point, so a fighter
    // standing just behind a wall is protected while one standing just in front
    // of it is not.
    const impact: Vec3 = hit
      ? {
          x: from.x + (to.x - from.x) * hit.t,
          y: from.y,
          z: from.z + (to.z - from.z) * hit.t,
        }
      : to;
    const occluders = segmentOccluderIds(world, from, impact);
    if (occluders.length > 0) {
      events.push({
        type: "SHOT_ABSORBED_BY_COVER",
        tick,
        projectileId: projectile.id,
        coverId: occluders[0]!,
      });
      continue;
    }

    if (hit) {
      const targetModifiers = modifiers[targetSide];
      if (
        isInvulnerable(target, tick) ||
        targetModifiers.selfIncomingDamageScale <= 0
      ) {
        events.push({
          type: "SHOT_EVADED",
          tick,
          projectileId: projectile.id,
          side: targetSide,
          by: isInvulnerable(target, tick) ? "DODGE_IFRAME" : "ABILITY",
        });
        continue;
      }
      const damage = Math.max(
        0,
        Math.round(projectile.damage * targetModifiers.selfIncomingDamageScale),
      );
      const health = Math.max(0, target.health - damage);
      const shooterSide = projectile.shooter;
      const shooter = fighters[shooterSide];
      fighters = {
        ...fighters,
        [targetSide]: { ...target, health, hitsTaken: target.hitsTaken + 1 },
        [shooterSide]: { ...shooter, hitsLanded: shooter.hitsLanded + 1 },
      } as BySide<FighterState>;
      events.push({
        type: "HIT_LANDED",
        tick,
        projectileId: projectile.id,
        shooter: shooterSide,
        target: targetSide,
        damage,
        targetHealthAfter: health,
      });
      continue;
    }

    const outOfBounds =
      to.x < world.bounds.minX ||
      to.x > world.bounds.maxX ||
      to.z < world.bounds.minZ ||
      to.z > world.bounds.maxZ;
    if (tick >= projectile.expiresAtTick || outOfBounds) {
      events.push({ type: "SHOT_EXPIRED", tick, projectileId: projectile.id });
      continue;
    }
    survivors.push({ ...projectile, x: to.x, z: to.z });
  }

  return { projectiles: survivors, fighters };
}

// ---- round boundaries ------------------------------------------------------

/** Load a side's magazine. The only writer of `ammo` outside firing. */
export function loadMagazine(
  state: CombatState,
  side: DuelSide,
  magazine: number,
): CombatState {
  const fighter = state.fighters[side];
  return {
    ...state,
    fighters: {
      ...state.fighters,
      [side]: { ...fighter, ammo: Math.max(0, Math.trunc(magazine)) },
    } as BySide<FighterState>,
  };
}

/**
 * Clear the field at a round boundary: balls in flight are gone, an open burst is
 * cancelled through the engine, and immunity closes. Health, position, ability
 * ledgers AND unspent ammo persist — unspent ammo deliberately survives to here
 * because the carry policy is applied when the next round's bullets are granted,
 * and applying it twice would silently destroy carried bullets.
 */
export function clearFieldForBoundary(state: CombatState): CombatState {
  const reset = (fighter: FighterState): FighterState => ({
    ...fighter,
    motion: cancelDash(fighter.motion),
    dodge: { ...IDLE_DODGE, readyAtTick: fighter.dodge.readyAtTick },
    fireReadyAtTick: 0,
  });
  return {
    ...state,
    fighters: { A: reset(state.fighters.A), B: reset(state.fighters.B) },
    projectiles: [],
  };
}

