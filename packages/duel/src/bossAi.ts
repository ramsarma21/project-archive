// The boss's cross-tick navigation memory, and the deterministic movement
// competence layered on top of the per-tick `bossIntent` decision.
//
// WHY THIS EXISTS. `bossIntent` (policy.ts) is a pure, memoryless function: it
// looks at one tick and decides where to aim, whether to fire, and roughly which
// way to move. That is the right shape for aiming and firing, and the wrong shape
// for MOVING, because good movement needs memory:
//
//   - Wall sticking (symptom A). The raw decision drives a direction straight at
//     the opponent or at cover with no idea a wall is in the way. The shared
//     integrator slides the body along contacts, but a body pushing squarely into
//     a corner slides nowhere, and with nothing watching for that it grinds there
//     for seconds. Detecting "I have wanted to move for a while and gone nowhere"
//     and re-planning a detour is inherently stateful.
//
//   - Crouch/hide flapping (symptom B). The raw decision branches on the live
//     per-tick line of sight, which a player bobbing crouch behind chest-high
//     cover toggles several times a second. That flaps the boss's fire flag and
//     its whole movement branch. Debouncing a signal is, again, memory.
//
// So this module owns exactly the parts of the boss's behaviour that need to
// remember the last few ticks: a debounced line of sight, a stall detector with a
// committed detour, and a committed cover point with hysteresis. Everything else —
// the aim solution, the lead, the jitter, the dodge, the firing invariant — stays
// in `bossIntent`, and this calls it. It adds NO combat abilities; it only makes
// the movement competent and readable.
//
// Pure and seeded, like the rest of the duel: `advanceBossEngagement` and
// `advanceBossCover` are functions of (view, seed, memory) and return the next
// memory, so a boss remains a replay artefact — same seed, same tick, same path,
// on every machine.

import {
  IDLE_INTENT,
  intent,
  isDodging,
  isExposedToShot,
  type CombatIntent,
  type CombatView,
} from "./combat.js";
import {
  CAPSULE_RADIUS,
  fieldRandom,
  sweepXZ,
  type CollisionWorld,
  type Vec3,
} from "./engine.js";
import {
  bossIntent,
  coverApproachIntent,
  directionToBreakCover,
  directionToOpenLane,
  nearestThreat,
} from "./policy.js";
import {
  isBossInCoverAt,
  isCoverReachable,
  nearestBossCover,
  type CoverPoint,
} from "./cover.js";
import type { BossProfile, BossTacticalProfile } from "./boss.js";

// ---- tuning ----------------------------------------------------------------

/**
 * How many consecutive ticks the raw line of sight must hold a NEW value before
 * the boss believes it. ~0.13s at 60Hz: long enough that a player flickering
 * crouch behind cover (which toggles LOS every few ticks) cannot move the boss's
 * decision, short enough that a real break or re-acquisition is acted on promptly.
 */
const LOS_DEBOUNCE_TICKS = 8;

/** How far ahead the steering probes for a wall. */
const STEER_PROBE_M = 0.6;
/** Fraction of the probe that must be clear to call the straight path "open". */
const STEER_CLEAR_FRACTION = 0.66;
/** Progress the boss must make within the window or it counts as stalled. */
const STALL_PROGRESS_M = 0.3;
/**
 * The window over which that progress is measured. ~0.33s at 60Hz: long enough that
 * ordinary strafing (which the shared integrator already slides along a wall
 * without help) never trips it, short enough that a real wedge while traversing is
 * escaped in a third of a second rather than the multi-second grind the diagnosis
 * found. It only ever gates the traverse case (`reroute`), so it does not touch the
 * measured engaged-combat behaviour.
 */
export const STALL_WINDOW_TICKS = 20;
/** How many directions the escape scan considers. Every 30 degrees. */
const AVOID_SCAN_DIRECTIONS = 12;
/** Bonus for a scan direction that continues the current detour: anti-dither. */
const AVOID_CONTINUITY_BONUS = 0.35;

const SALT_AVOID = 909;
/** A dodge roll salt for the empty state, distinct from the engagement dodge. */
const SALT_DODGE_EMPTY = 717;
/** The strafe-direction salt for an empty boss circling at striking distance. */
const SALT_PRESS_STRAFE = 431;

// ---- ammo-aware tactical state ---------------------------------------------

/**
 * The boss's combat posture, derived from its ammo and debounced so it does not
 * flip on the exact tick a threshold is crossed. Exposed on the memory (and via
 * `bossTacticalState`) so the renderer/QA can read what the boss believes it is
 * doing without a second source of truth.
 */
export type BossTacticalState = "ARMED" | "LOW" | "EMPTY";

function rawTacticalState(
  ammo: number,
  tactical: BossTacticalProfile,
): BossTacticalState {
  if (ammo <= 0) return "EMPTY";
  if (ammo <= tactical.lowAmmoThreshold) return "LOW";
  return "ARMED";
}

// ---- memory ----------------------------------------------------------------

export interface BossAiMemory {
  /**
   * The believed line of sight, after debounce. `null` until the first
   * observation, at which point it snaps to the raw value — so a fresh stateless
   * decision (and the first tick of an engagement) reacts immediately and only
   * SUBSEQUENT flips are debounced. This is what keeps the firing invariant: a
   * boss with a clear shot fires on tick one, and only a genuinely sustained break
   * stops it.
   */
  readonly losHeld: boolean | null;
  /** The most recent raw value, and how many consecutive ticks it has held. */
  readonly losCandidate: boolean | null;
  readonly losStreak: number;

  /** Where progress was last measured from, and when. anchorTick < 0 == unset. */
  readonly anchorX: number;
  readonly anchorZ: number;
  readonly anchorTick: number;
  /**
   * The detour direction currently being followed to get around an obstacle, or
   * (0,0) when not detouring. Kept between ticks so the boss commits to a way
   * around rather than dithering, and biased toward on the next scan for the same
   * reason.
   */
  readonly avoidDirX: number;
  readonly avoidDirZ: number;

  /** The cover point the boss is committed to reaching, or null. */
  readonly committedCover: CoverPoint | null;

  // ---- ammo-aware tactical layer (only used when `profile.tactical` is set) --
  /**
   * The believed posture after debounce. `null` until the first observation, at
   * which point it snaps to the raw value so the very first tick reacts, and only
   * subsequent flips are held for `reactionDelayTicks`.
   */
  readonly tacticalHeld: BossTacticalState | null;
  readonly tacticalCandidate: BossTacticalState | null;
  readonly tacticalStreak: number;
  /**
   * When the current low-ammo peek cycle was anchored, so peek/tuck timing is a
   * deterministic function of the tick. -1 until the boss actually reaches cover.
   */
  readonly peekAnchorTick: number;
  /**
   * When the current empty-ammo reload cycle was anchored, so the reload/press beats
   * are a deterministic function of the tick. -1 while the boss is still breaking
   * cover — the beat cannot start until a ball could actually reach it.
   */
  readonly reloadAnchorTick: number;
}

export function createBossAiMemory(): BossAiMemory {
  return {
    losHeld: null,
    losCandidate: null,
    losStreak: 0,
    anchorX: 0,
    anchorZ: 0,
    anchorTick: -1,
    avoidDirX: 0,
    avoidDirZ: 0,
    committedCover: null,
    tacticalHeld: null,
    tacticalCandidate: null,
    tacticalStreak: 0,
    peekAnchorTick: -1,
    reloadAnchorTick: -1,
  };
}

/** The boss's current believed posture, for the renderer/QA. */
export function bossTacticalState(memory: BossAiMemory): BossTacticalState {
  return memory.tacticalHeld ?? "ARMED";
}

// ---- tactical-state debounce -----------------------------------------------

/**
 * The same shape as the line-of-sight debounce: adopt the first observation
 * outright, then require `reactionDelayTicks` consecutive ticks of a NEW value
 * before believing it. Ammo only falls within a round, so this is a bounded delay
 * before the boss reacts to running low or dry — never an aim-bot's instant switch.
 */
function debounceTacticalState(
  memory: BossAiMemory,
  raw: BossTacticalState,
  reactionDelayTicks: number,
): { memory: BossAiMemory; state: BossTacticalState } {
  if (memory.tacticalHeld === null) {
    return {
      memory: {
        ...memory,
        tacticalHeld: raw,
        tacticalCandidate: raw,
        tacticalStreak: 1,
      },
      state: raw,
    };
  }
  const streak = raw === memory.tacticalCandidate ? memory.tacticalStreak + 1 : 1;
  let held = memory.tacticalHeld;
  if (raw !== held && streak >= Math.max(1, reactionDelayTicks)) held = raw;
  return {
    memory: {
      ...memory,
      tacticalHeld: held,
      tacticalCandidate: raw,
      tacticalStreak: streak,
    },
    state: held,
  };
}

// ---- line-of-sight debounce ------------------------------------------------

function debounceLineOfSight(
  memory: BossAiMemory,
  raw: boolean,
): { memory: BossAiMemory; los: boolean } {
  // First observation: adopt the raw value outright.
  if (memory.losHeld === null) {
    return {
      memory: { ...memory, losHeld: raw, losCandidate: raw, losStreak: 1 },
      los: raw,
    };
  }
  const streak = raw === memory.losCandidate ? memory.losStreak + 1 : 1;
  let held = memory.losHeld;
  if (raw !== held && streak >= LOS_DEBOUNCE_TICKS) held = raw;
  return {
    memory: { ...memory, losHeld: held, losCandidate: raw, losStreak: streak },
    los: held,
  };
}

// ---- collision-aware steering ----------------------------------------------

function rotate(x: number, z: number, angle: number): { x: number; z: number } {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: x * c - z * s, z: x * s + z * c };
}

/** How far a swept capsule actually travels toward (dirX,dirZ) before a wall. */
function clearance(
  world: CollisionWorld,
  pos: Vec3,
  capsuleHeight: number,
  dirX: number,
  dirZ: number,
): number {
  const swept = sweepXZ(
    world,
    pos,
    { x: pos.x + dirX * STEER_PROBE_M, z: pos.z + dirZ * STEER_PROBE_M },
    CAPSULE_RADIUS,
    capsuleHeight,
  );
  return Math.hypot(swept.x - pos.x, swept.z - pos.z);
}

function resetAnchor(memory: BossAiMemory, pos: Vec3, tick: number): BossAiMemory {
  return { ...memory, anchorX: pos.x, anchorZ: pos.z, anchorTick: tick };
}

/**
 * Turn a desired movement direction into one that actually makes progress.
 *
 * DELIBERATELY A NO-OP UNTIL THE BODY IS ACTUALLY STUCK. The shared integrator
 * already slides a body along a wall it meets at an angle, and that slide is the
 * behaviour every tuning number was measured against — so for a glancing contact
 * this returns the desired direction UNCHANGED and lets the engine do exactly what
 * it always did. It takes over only when the body has wanted to move but gone
 * nowhere for `STALL_WINDOW_TICKS` (the grind the diagnosis found lasting seconds).
 *
 * When it does take over it scans directions around the body and heads the one
 * that is both clear and as close to the goal as possible — which is a proper local
 * detour: it wall-follows past a flat obstacle, and it BACKS OUT of a corner rather
 * than oscillating between two walls (the failure a simple left/right rule has).
 * The chosen detour is remembered and given a small bonus next tick so the boss
 * commits to a way around instead of dithering, and it is dropped the instant the
 * straight path is clear so the boss returns to its intended movement immediately.
 * Deterministic: the only non-geometric input is a seeded tiebreak between two
 * equally good escape directions.
 */
function steer(
  view: CombatView,
  desiredX: number,
  desiredZ: number,
  seed: number,
  memoryIn: BossAiMemory,
  /**
   * Whether a stall here is a NAVIGATION failure worth re-routing around. True
   * while the boss is trying to get somewhere — closing a broken line, or walking
   * to cover — where a wedge is the visible "stuck on a wall" the player reported.
   * False while the boss is holding its ground and trading shots with a clear line:
   * standing in place there is fighting, not stuck, and the integrator's own slide
   * already keeps a strafe moving along a pillar. Keeping the detour out of that
   * case is also what keeps the boss no HARDER than before — its measured combat
   * positioning while engaged is untouched.
   */
  reroute: boolean,
): { moveX: number; moveZ: number; memory: BossAiMemory } {
  const pos = view.self.motion.pos;
  const height = view.self.motion.capsuleHeight;
  const world = view.world;
  const tick = view.tick;

  const desiredLen = Math.hypot(desiredX, desiredZ);
  if (desiredLen < 1e-6) {
    // No intent to move: clear the stall tracking so a later genuine push starts
    // from a fresh window rather than an ancient anchor.
    return {
      moveX: 0,
      moveZ: 0,
      memory: { ...resetAnchor(memoryIn, pos, tick), avoidDirX: 0, avoidDirZ: 0 },
    };
  }
  const dirX = desiredX / desiredLen;
  const dirZ = desiredZ / desiredLen;

  let memory = memoryIn;
  if (memory.anchorTick < 0) memory = resetAnchor(memory, pos, tick);
  const movedSinceAnchor = Math.hypot(pos.x - memory.anchorX, pos.z - memory.anchorZ);
  if (movedSinceAnchor >= STALL_PROGRESS_M) memory = resetAnchor(memory, pos, tick);
  const stalledLong =
    tick - memory.anchorTick >= STALL_WINDOW_TICKS &&
    movedSinceAnchor < STALL_PROGRESS_M;
  const detouring = memory.avoidDirX !== 0 || memory.avoidDirZ !== 0;

  const straightClear =
    clearance(world, pos, height, dirX, dirZ) >= STEER_PROBE_M * STEER_CLEAR_FRACTION;

  // A detour with a clear path ahead ends immediately — resume the intended line.
  // And an ordinary, unstuck tick hands the desired direction straight through so
  // the integrator's own wall-slide does exactly what it did before this layer.
  if ((detouring && straightClear) || (!detouring && !stalledLong)) {
    return {
      moveX: dirX,
      moveZ: dirZ,
      memory: { ...memory, avoidDirX: 0, avoidDirZ: 0 },
    };
  }

  // Stalled while NOT trying to traverse — the boss has a firing stance and is just
  // being asked to shove into a wall to shave the range. Do not grind against it,
  // and do not seek a better spot either (that would make the boss a stronger
  // fighter than it was measured to be): hold position and keep shooting until the
  // desired line opens. A stationary boss is if anything easier to hit, so this can
  // only preserve or ease the difficulty, never raise it.
  if (!reroute) {
    return {
      moveX: straightClear ? dirX : 0,
      moveZ: straightClear ? dirZ : 0,
      memory: { ...memory, avoidDirX: 0, avoidDirZ: 0 },
    };
  }

  // Already committed to a way around, and that way is still open: keep following
  // it. This is what carries the boss all the way to the END of a long obstacle
  // instead of dithering near the middle — re-optimising toward the (blocked) goal
  // every tick is exactly what makes a body oscillate at a wall's face.
  if (detouring) {
    const committedClear =
      clearance(world, pos, height, memory.avoidDirX, memory.avoidDirZ) >=
      STEER_PROBE_M * STEER_CLEAR_FRACTION;
    if (committedClear) {
      return { moveX: memory.avoidDirX, moveZ: memory.avoidDirZ, memory };
    }
  }

  // Stuck, and either newly so or the committed detour has run into something: scan
  // for the best way around. Score each candidate on how far it is clear and how
  // well it points at the goal, with a continuity bonus for staying on the current
  // detour so the choice does not chatter.
  let best: { x: number; z: number; score: number } | null = null;
  for (let index = 0; index < AVOID_SCAN_DIRECTIONS; index++) {
    const angle = (index / AVOID_SCAN_DIRECTIONS) * Math.PI * 2;
    const cand = rotate(dirX, dirZ, angle);
    const clear = clearance(world, pos, height, cand.x, cand.z);
    const clearFrac = Math.min(1, clear / (STEER_PROBE_M * STEER_CLEAR_FRACTION));
    const forwardDot = cand.x * dirX + cand.z * dirZ;
    const continuity =
      detouring && cand.x * memory.avoidDirX + cand.z * memory.avoidDirZ > 0.9
        ? AVOID_CONTINUITY_BONUS
        : 0;
    // Clearance dominates (a blocked direction is useless), then facing the goal,
    // then the continuity tiebreak; a tiny seeded jitter breaks perfect ties
    // deterministically so a head-on wall does not depend on scan order.
    const jitter =
      fieldRandom(seed, index, SALT_AVOID + Math.floor(pos.x * 4 + pos.z * 4)) * 1e-3;
    const score = clearFrac * 2 + forwardDot + continuity + jitter;
    if (!best || score > best.score) best = { x: cand.x, z: cand.z, score };
  }
  if (!best) {
    return { moveX: dirX, moveZ: dirZ, memory };
  }
  // Newly detouring: reset the progress anchor so the escape gets its own window.
  if (!detouring) memory = resetAnchor(memory, pos, tick);
  memory = { ...memory, avoidDirX: best.x, avoidDirZ: best.z };
  return { moveX: best.x, moveZ: best.z, memory };
}

// ---- the engagement driver -------------------------------------------------

/**
 * One tick of the boss during a live engagement.
 *
 * For a profile with no `tactical` layer this is exactly what it always was — the
 * `bossIntent` decision on a debounced line of sight, with collision-aware,
 * stall-resistant movement — so every shipped tier's measured behaviour is
 * byte-identical. A tactical profile (M1) branches into the ammo-aware state
 * machine below, whose ARMED case is this same path.
 */
export function advanceBossEngagement(
  profile: BossProfile,
  view: CombatView,
  seed: number,
  memoryIn: BossAiMemory,
): { intent: CombatIntent; memory: BossAiMemory } {
  const debounced = debounceLineOfSight(memoryIn, view.hasLineOfSight);
  if (profile.tactical) {
    return advanceBossTactical(profile, profile.tactical, view, seed, debounced.memory, debounced.los);
  }
  return engageArmed(profile, view, seed, debounced.memory, debounced.los);
}

/**
 * The ARMED engagement: aim/fire/dodge from `bossIntent` on the debounced line,
 * with collision-aware steering. Factored out so the tactical machine's ARMED case
 * is provably the same behaviour as a non-tactical boss.
 */
function engageArmed(
  profile: BossProfile,
  view: CombatView,
  seed: number,
  memory: BossAiMemory,
  los: boolean,
): { intent: CombatIntent; memory: BossAiMemory } {
  const base = bossIntent(profile, view, seed, los);

  // A dodge is a committed evasive burst handled by the engine; do not steer it,
  // and reset the stall window so the post-dash position is a fresh anchor.
  if (base.dodge) {
    return {
      intent: base,
      memory: resetAnchor(memory, view.self.motion.pos, view.tick),
    };
  }

  // Re-route only when the boss is actually trying to traverse — no steady line to
  // the player, so it is repositioning rather than holding a firing stance. That is
  // where a wall wedge is the visible "stuck" bug; a stall while it has a clear
  // line is it standing and fighting, which the integrator's slide already handles.
  const steered = steer(view, base.moveX, base.moveZ, seed, memory, !los);
  return {
    intent: { ...base, moveX: steered.moveX, moveZ: steered.moveZ },
    memory: steered.memory,
  };
}

// ---- the ammo-aware tactical machine ---------------------------------------

function aimAtOpponent(view: CombatView): { x: number; z: number } {
  const dx = view.opponent.motion.pos.x - view.self.motion.pos.x;
  const dz = view.opponent.motion.pos.z - view.self.motion.pos.z;
  const length = Math.hypot(dx, dz);
  return length > 1e-6 ? { x: dx / length, z: dz / length } : { x: 0, z: 1 };
}

/**
 * One tick of a tactical boss: pick a posture from the (debounced) ammo state and
 * drive the matching behaviour. ARMED is the ordinary engagement; LOW fights from
 * cover on a finite peek cycle; EMPTY breaks cover and reloads in the open.
 *
 * Each state clears the OTHER's cycle anchor on the way in, so a posture change
 * always starts its beats fresh rather than resuming a cycle from two states ago.
 */
function advanceBossTactical(
  profile: BossProfile,
  tactical: BossTacticalProfile,
  view: CombatView,
  seed: number,
  memoryIn: BossAiMemory,
  los: boolean,
): { intent: CombatIntent; memory: BossAiMemory } {
  const raw = rawTacticalState(view.self.ammo, tactical);
  const debounced = debounceTacticalState(memoryIn, raw, tactical.reactionDelayTicks);
  const memory = debounced.memory;

  switch (debounced.state) {
    case "ARMED":
      // Leaving both cycles behind: a fresh magazine fights in the open again.
      return engageArmed(
        profile,
        view,
        seed,
        { ...memory, peekAnchorTick: -1, reloadAnchorTick: -1 },
        los,
      );
    case "LOW":
      return engageLowAmmo(
        profile,
        tactical,
        view,
        seed,
        { ...memory, reloadAnchorTick: -1 },
        los,
      );
    case "EMPTY":
      return engageEmpty(
        profile,
        tactical,
        view,
        seed,
        { ...memory, peekAnchorTick: -1 },
      );
  }
}

/**
 * A bounded evasive dodge against the soonest ball that will connect, on the same
 * seeded per-ball roll the armed boss uses. Returns null when there is nothing to
 * dodge or the roll declines — the caller then falls through to its cover logic.
 */
function tacticalDodge(
  profile: BossProfile,
  view: CombatView,
  seed: number,
  memory: BossAiMemory,
  salt: number,
): { intent: CombatIntent; memory: BossAiMemory } | null {
  const threat = nearestThreat(view);
  const canDodge = view.tick >= view.self.dodge.readyAtTick && !isDodging(view.self);
  if (
    !threat ||
    !canDodge ||
    threat.ticks > profile.dodgeReactionTicks ||
    fieldRandom(seed, threat.projectile.id, salt) >= profile.dodgeChance
  ) {
    return null;
  }
  const aim = aimAtOpponent(view);
  return {
    intent: intent({
      moveX: threat.evadeX,
      moveZ: threat.evadeZ,
      dodge: true,
      aimX: aim.x,
      aimZ: aim.z,
    }),
    memory: resetAnchor(memory, view.self.motion.pos, view.tick),
  };
}

/**
 * LOW ammo: fire deliberately from cover rather than dumping the last rounds in the
 * open. The boss commits to a cover point, walks to it, then runs a finite cycle —
 * tucked (crouched, occluded, holding fire) for `peekCooldownTicks`, then exposed
 * (standing, firing on the real line) for `peekAimTicks`, with a short aim-
 * acquisition delay after clearing cover so it never snaps a shot the instant it
 * rises. Firing itself is gated by `bossIntent`'s raw-line `fire` flag, which the
 * crouch/stand cover mechanic already turns on and off honestly.
 */
function engageLowAmmo(
  profile: BossProfile,
  tactical: BossTacticalProfile,
  view: CombatView,
  seed: number,
  memoryIn: BossAiMemory,
  los: boolean,
): { intent: CombatIntent; memory: BossAiMemory } {
  const base = bossIntent(profile, view, seed, los);
  if (base.dodge) {
    return {
      intent: base,
      memory: resetAnchor(memoryIn, view.self.motion.pos, view.tick),
    };
  }

  const memory = commitCover(view, memoryIn);
  const target = memory.committedCover;
  if (!target) {
    // No cover to peek from: fight where it stands, deliberately (no worse than the
    // armed boss, and it still honours the raw-line fire flag).
    const steered = steer(view, base.moveX, base.moveZ, seed, memory, !los);
    return {
      intent: { ...base, moveX: steered.moveX, moveZ: steered.moveZ },
      memory: steered.memory,
    };
  }

  const approach = coverApproachIntent(view, target);
  const travelling = Math.hypot(approach.moveX, approach.moveZ) > 1e-6;
  if (travelling) {
    // Still walking into cover. Keep the peek cycle unanchored until arrival, take
    // an opportunistic shot if the raw line happens to be open on the way.
    const steered = steer(view, approach.moveX, approach.moveZ, seed, memory, true);
    return {
      intent: intent({
        moveX: steered.moveX,
        moveZ: steered.moveZ,
        sprint: true,
        fire: base.fire,
        aimX: base.aimX,
        aimZ: base.aimZ,
      }),
      memory: { ...steered.memory, peekAnchorTick: -1 },
    };
  }

  // Arrived: anchor the cycle on the first held tick, then peek/tuck deterministically.
  let anchored = memory;
  if (anchored.peekAnchorTick < 0) {
    anchored = { ...anchored, peekAnchorTick: view.tick };
  }
  anchored = resetAnchor(anchored, view.self.motion.pos, view.tick);

  const period = Math.max(1, tactical.peekAimTicks + tactical.peekCooldownTicks);
  const cyclePos = (view.tick - anchored.peekAnchorTick) % period;
  const tucked = cyclePos < tactical.peekCooldownTicks;
  if (tucked) {
    // Down behind cover: the crouched sightline is blocked, so no shot is possible
    // and none is attempted.
    return {
      intent: intent({ crouch: true, aimX: base.aimX, aimZ: base.aimZ }),
      memory: anchored,
    };
  }
  // Peeking: stand to reopen the line, but only fire once the acquisition delay has
  // passed — a readable rise-then-shoot rather than an instant snap.
  const peekElapsed = cyclePos - tactical.peekCooldownTicks;
  const acquired = peekElapsed >= tactical.reactionDelayTicks;
  return {
    intent: intent({
      crouch: false,
      fire: base.fire && acquired,
      aimX: base.aimX,
      aimZ: base.aimZ,
    }),
    memory: anchored,
  };
}

/**
 * EMPTY: break cover and reload where the player can answer.
 *
 * It never fires — there is nothing to fire, and no reload here produces a ball
 * either: a round's magazine is earned by that round's question and nothing else
 * grants one (see `openNextRoundOrResolve`). So this state is not about getting the
 * boss shooting again. It is about what an out-of-powder officer is doing while he
 * waits, and the answer is now the one the duel's own deleted card asserted: he
 * comes out from behind the crate and works the ramrod in the open.
 *
 * Two beats, cycling, both of them exposed:
 *
 *   RELOAD  once a ball could reach it, plant, stand, face the player and work the
 *           reload for `reloadExposureTicks`. COMMITTED: no crouch, no dodge. That
 *           commitment is the opportunity, and it is the whole point of the state.
 *   PRESS   otherwise — screened, or between beats — come out and close, along a
 *           heading that keeps the shot open (`pressOpponent`). Dodging is allowed
 *           here: crossing open ground is not the reload, and the armed boss dodges
 *           there too.
 *
 * WHY THE GATE IS `isExposedToShot` AND NOT LINE OF SIGHT. Every piece of cover in
 * the shipped yard is 1.30 m or taller and an aimed ball flies at a standing chest,
 * 1.12 m. So standing up behind a crate is not leaving cover: the boss's eyes clear
 * the top — the eye line reports an open shot — while every ball still lands in the
 * timber. Gating on sight would have produced a boss that stood up, looked hittable,
 * and was not.
 */
function engageEmpty(
  profile: BossProfile,
  tactical: BossTacticalProfile,
  view: CombatView,
  seed: number,
  memoryIn: BossAiMemory,
): { intent: CombatIntent; memory: BossAiMemory } {
  const aim = aimAtOpponent(view);
  // Can the PLAYER hit the boss, on the lane a ball actually flies.
  const exposed = isExposedToShot(view.world, view.opponent, view.self);

  if (exposed) {
    // Anchor the cycle on the tick the lane opened, so the beats are a deterministic
    // function of the tick exactly as the low-ammo peek's are.
    const memory =
      memoryIn.reloadAnchorTick < 0
        ? { ...memoryIn, reloadAnchorTick: view.tick }
        : memoryIn;
    const period = Math.max(
      1,
      tactical.reloadExposureTicks + tactical.reloadPressTicks,
    );
    const cyclePos = (view.tick - memory.reloadAnchorTick) % period;
    if (cyclePos < tactical.reloadExposureTicks) {
      return {
        intent: intent({ crouch: false, aimX: aim.x, aimZ: aim.z }),
        memory: resetAnchor(memory, view.self.motion.pos, view.tick),
      };
    }
    return pressOpponent(profile, tactical, view, seed, memory, aim);
  }

  // Screened by something, so no beat is running: clear the anchor and come out.
  return pressOpponent(
    profile,
    tactical,
    view,
    seed,
    { ...memoryIn, reloadAnchorTick: -1 },
    aim,
  );
}

/**
 * Come out, stay out, and close — one movement policy for both halves of the empty
 * state, because they turned out to want the same thing. Never crouches and never
 * fires: an empty boss on the move is still an empty boss in the open.
 *
 * IT CLOSES ALONG A HEADING THAT KEEPS THE SHOT OPEN rather than straight at the
 * player, and that is not a refinement — it is a defect fix. Walking directly at the
 * player from beside a crate walks the boss straight back behind it, so the first
 * version of this oscillated in and out of the screen it had just left instead of
 * pressing, and never came far enough out to be worth shooting at.
 * `directionToOpenLane` picks the probed heading that faces the player most directly
 * among those that leave the ball's lane clear, so breaking cover and closing are the
 * same move. When nothing probed clears the lane — screened behind cover wider than
 * the probe, which is where a straight approach grinds into the wall for half the
 * empty window — `directionToBreakCover` heads laterally out of that cover's shadow
 * instead; only with no flank to either side does the boss fall through to closing.
 *
 * IT CIRCLES RATHER THAN HOLDING ONCE INSIDE `pressDistanceM`, and the difference is
 * not cosmetic either. Holding there was the first shape of this and it froze the boss
 * outright: a player who charges keeps the distance under the threshold permanently,
 * so "do not advance further" became "stand still for the rest of the round" —
 * measured at 1044 consecutive ticks against an aggressive player, which is the
 * infinite-idle failure this state was rebuilt to remove rather than to relocate.
 */
function pressOpponent(
  profile: BossProfile,
  tactical: BossTacticalProfile,
  view: CombatView,
  seed: number,
  memory: BossAiMemory,
  aim: { x: number; z: number },
): { intent: CombatIntent; memory: BossAiMemory } {
  const dodged = tacticalDodge(profile, view, seed, memory, SALT_DODGE_EMPTY);
  if (dodged) return dodged;

  let desired: { x: number; z: number };
  if (view.distance <= tactical.pressDistanceM) {
    // Already at striking distance: circle instead of walking through them. Seeded
    // off the strafe period exactly as the armed boss's strafe is, so the direction
    // is a deterministic function of the tick rather than a live coin flip.
    const phase = Math.floor(view.tick / profile.strafePeriodTicks);
    const flip = fieldRandom(seed, phase, SALT_PRESS_STRAFE) < 0.5 ? 1 : -1;
    desired = { x: -aim.z * flip, z: aim.x * flip };
  } else {
    // A near step that already clears the lane if one exists; else break laterally
    // out of the screening cover's shadow (the far-approach case a 2.2 m probe
    // cannot see); else, with nothing to flank around, close straight in.
    desired =
      directionToOpenLane(view) ?? directionToBreakCover(view, seed) ?? aim;
  }

  const steered = steer(view, desired.x, desired.z, seed, memory, true);
  return {
    intent: intent({
      moveX: steered.moveX,
      moveZ: steered.moveZ,
      sprint: true,
      crouch: false,
      aimX: aim.x,
      aimZ: aim.z,
    }),
    memory: steered.memory,
  };
}

// ---- the cover-approach driver ---------------------------------------------

function coverStillValid(
  world: CollisionWorld,
  point: CoverPoint,
  view: CombatView,
): boolean {
  const player = view.opponent.motion.pos;
  const playerHeight = view.opponent.motion.capsuleHeight;
  const bossHeight = view.self.motion.capsuleHeight;
  return (
    isBossInCoverAt(world, point, player, playerHeight) &&
    isCoverReachable(world, view.self.motion.pos, point, bossHeight)
  );
}

/**
 * Choose the cover point to head for, with hysteresis: keep the committed point as
 * long as it is still valid cover and still reachable, and only reselect when it
 * is not. That is what stops the per-tick thrash the diagnosis flagged — recomputing
 * "nearest cover" every tick lets it flip between two near-equal points as the
 * player drifts, which reads as the boss juddering between destinations.
 */
export function commitCover(
  view: CombatView,
  memoryIn: BossAiMemory,
): BossAiMemory {
  const world = view.world;
  if (memoryIn.committedCover && coverStillValid(world, memoryIn.committedCover, view)) {
    return memoryIn;
  }
  const boss = view.self.motion.pos;
  const player = view.opponent.motion.pos;
  const playerHeight = view.opponent.motion.capsuleHeight;
  const bossHeight = view.self.motion.capsuleHeight;
  const options = {
    reachableFrom: boss,
    capsuleHeight: bossHeight,
    blocked: [{ x: player.x, z: player.z, radius: CAPSULE_RADIUS }],
  };
  const chosen =
    nearestBossCover(world, boss, player, playerHeight, options) ??
    // Nothing reachable/unoccupied: fall back to any valid cover so the boss still
    // tries rather than freezing — the machine's bounded window guarantees the
    // break still terminates even if it cannot get there.
    nearestBossCover(world, boss, player, playerHeight);
  return { ...memoryIn, committedCover: chosen };
}

/**
 * One tick of the between-round retreat: pick/keep a committed cover point and
 * walk to it with the same collision-aware steering the engagement uses.
 */
export function advanceBossCover(
  view: CombatView,
  seed: number,
  memoryIn: BossAiMemory,
): { intent: CombatIntent; memory: BossAiMemory; coverTarget: CoverPoint | null } {
  const memory = commitCover(view, memoryIn);
  const target = memory.committedCover;
  if (!target) {
    return { intent: IDLE_INTENT, memory, coverTarget: null };
  }

  const base = coverApproachIntent(view, target);
  // On arrival `coverApproachIntent` returns a crouch-and-hold with no movement;
  // pass that through untouched so the boss settles into the stance that occludes.
  const wantsMove = Math.hypot(base.moveX, base.moveZ);
  if (wantsMove < 1e-6) {
    return {
      intent: base,
      memory: resetAnchor(memory, view.self.motion.pos, view.tick),
      coverTarget: target,
    };
  }

  // Walking to cover is pure traversal, so a wedge on the way there is always a
  // navigation failure worth re-routing around.
  const steered = steer(view, base.moveX, base.moveZ, seed, memory, true);
  return {
    intent: { ...base, moveX: steered.moveX, moveZ: steered.moveZ },
    memory: steered.memory,
    coverTarget: target,
  };
}
