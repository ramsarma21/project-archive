// The ammo-aware tactical boss (M1's officer), checked by deterministic simulation.
//
// This is the guard for the owner's requirement — "make the boss hide behind cover
// and duck when he is out of bullets, and play like a proper AI boss fight" — and
// for the fairness rules it must not break: no firing on an empty magazine, no
// shooting through cover, no wall grinding, no state thrash, no infinite idle while
// a tactical action is available, and a duel that still terminates and stays
// winnable on both the correct and the wrong answer paths.
//
// Every assertion is against the authoritative simulation: the same collision
// world, the same movement integrator and the same line-of-sight/cover queries the
// live duel uses. Nothing trusts a UI claim.

import { test } from "node:test";
import assert from "node:assert/strict";

import { bossFighterParams, bossProfileForTier, M1_BOSS_TACTICS } from "../boss.js";
import {
  advanceBossEngagement,
  bossTacticalState,
  createBossAiMemory,
  STALL_WINDOW_TICKS,
  type BossAiMemory,
  type BossTacticalState,
} from "../bossAi.js";
import { buildArena, CHEST_COVER_HEIGHT, referenceArena } from "../arena.js";
import {
  combatView,
  createCombatState,
  intent,
  IDLE_INTENT,
  isExposedToShot,
  loadMagazine,
  playerParams,
  stepCombat,
  type CombatIntent,
  type CombatParams,
  type CombatState,
} from "../combat.js";
import {
  createDuel,
  reduceDuel,
  type DuelState,
} from "../machine.js";
import { oracleIntent } from "../policy.js";
import { DUEL_ROUND_CEILING } from "../structure.js";
import {
  blockerIdsAt,
  CAPSULE_RADIUS,
  CROUCH_HEIGHT,
  FIELD_DT,
  fieldRandom,
  platformFromRect,
  STAND_HEIGHT,
  type Blocker,
  type CollisionWorld,
  type Vec3,
} from "../engine.js";
import type { DuelSide } from "../sides.js";
import { questionSet, verdictFor } from "./harness.js";
import type { VerdictKind } from "../verdict.js";

const SEED = 20260727;

/** The shipped M1 officer: symmetric-complement ammo, takes cover, tactical brain. */
const M1_TACTICAL = bossProfileForTier(1, "BOSS.M1.TACTICAL", {
  ammoPolicy: "SYMMETRIC_COMPLEMENT",
  takesCoverBeforeQuestion: true,
  tactical: M1_BOSS_TACTICS,
});

const CROUCH_THRESHOLD = (STAND_HEIGHT + CROUCH_HEIGHT) / 2;

function worldOf(blockers: Blocker[], half = 12): CollisionWorld {
  return {
    blockers,
    platforms: [platformFromRect("FLOOR", -half, half, -half, half, 0, ["FLOOR"])],
    bounds: { minX: -half, maxX: half, minZ: -half, maxZ: half },
  };
}

function bossVsPlayer(
  world: CollisionWorld,
  boss: Vec3,
  player: Vec3,
  bossAmmo: number,
): { params: CombatParams; state: CombatState } {
  const params: CombatParams = { A: playerParams(), B: bossFighterParams(M1_TACTICAL) };
  let state = createCombatState(params, {
    A: { pos: player, yaw: 0 },
    B: { pos: boss, yaw: Math.PI },
  });
  state = loadMagazine(state, "B", bossAmmo);
  return { params, state };
}

interface DriveResult {
  finalDistance: number;
  penetrationTicks: number;
  outOfBoundsTicks: number;
  maxStallStreak: number;
  firedWhileEmpty: number;
  firedWithoutLos: number;
  /**
   * Empty ticks in which the player could actually have hit the boss.
   *
   * ON THE BALL'S LANE, NOT THE EYE LINE, and the two genuinely differ: every piece of
   * cover in the shipped yard is 1.30 m or taller while an aimed ball flies at a
   * standing chest, 1.12 m, so a standing boss's eyes clear the crate and its chest
   * does not. Measuring exposure with `hasLineOfSight` would score four of the yard's
   * six cover points as exposed while no ball could reach the body.
   */
  exposedTicks: number;
  crouchedTicks: number;
  emptyTicks: number;
  maxIdleWhileEmptyExposed: number;
  coverIdChanges: number;
  states: Set<BossTacticalState>;
  path: Vec3[];
  finalState: CombatState;
}

/**
 * Drive side B with the tactical boss AI and side A with a supplied intent,
 * recording every property the assertions below need. Ammo can be topped up mid-run
 * to model a reload.
 */
function driveBoss(
  world: CollisionWorld,
  init: { params: CombatParams; state: CombatState },
  playerIntent: (tick: number, state: CombatState) => CombatIntent,
  ticks: number,
  reload?: { atTick: number; ammo: number },
): DriveResult {
  let { state } = init;
  let mem: BossAiMemory = createBossAiMemory();
  let stall = 0;
  let maxStall = 0;
  let penetration = 0;
  let outOfBounds = 0;
  let firedWhileEmpty = 0;
  let firedWithoutLos = 0;
  let exposed = 0;
  let crouched = 0;
  let empty = 0;
  let idleExposed = 0;
  let maxIdleExposed = 0;
  let coverIdChanges = 0;
  let lastCoverId: string | null = null;
  const states = new Set<BossTacticalState>();
  const path: Vec3[] = [];

  for (let i = 0; i < ticks; i++) {
    if (reload && state.tick === reload.atTick) {
      state = loadMagazine(state, "B", reload.ammo);
    }
    const view = combatView(world, state, "B");
    const ammoBefore = state.fighters.B.ammo;
    const losBefore = view.hasLineOfSight;
    const driven = advanceBossEngagement(M1_TACTICAL, view, SEED, mem);
    mem = driven.memory;
    states.add(bossTacticalState(mem));

    if (mem.committedCover?.coverId !== lastCoverId) {
      if (lastCoverId !== null && mem.committedCover) coverIdChanges += 1;
      lastCoverId = mem.committedCover?.coverId ?? null;
    }

    // No shooting through cover, and no firing on an empty magazine: both are
    // decided by the intent the AI produced, before the engine even runs.
    if (driven.intent.fire) {
      if (ammoBefore <= 0) firedWhileEmpty += 1;
      if (!losBefore) firedWithoutLos += 1;
    }

    const before = { ...state.fighters.B.motion.pos };
    const stepped = stepCombat(
      world,
      state,
      { A: playerIntent(state.tick, state), B: driven.intent },
      init.params,
      1,
    );
    state = stepped.state;
    const after = state.fighters.B.motion.pos;
    path.push({ ...after });

    const moved = Math.hypot(after.x - before.x, after.z - before.z);
    const wants = Math.hypot(driven.intent.moveX, driven.intent.moveZ);
    if (wants > 0.3 && moved < 0.02) stall += 1;
    else stall = 0;
    maxStall = Math.max(maxStall, stall);

    if (blockerIdsAt(world, after, CAPSULE_RADIUS - 0.03, STAND_HEIGHT * 0.5).length > 0) {
      penetration += 1;
    }
    if (
      after.x < world.bounds.minX - 1e-6 ||
      after.x > world.bounds.maxX + 1e-6 ||
      after.z < world.bounds.minZ - 1e-6 ||
      after.z > world.bounds.maxZ + 1e-6
    ) {
      outOfBounds += 1;
    }

    const shootableNow = isExposedToShot(world, state.fighters.A, state.fighters.B);
    const crouchNow = state.fighters.B.motion.capsuleHeight < CROUCH_THRESHOLD;
    if (bossTacticalState(mem) === "EMPTY") {
      empty += 1;
      if (shootableNow) exposed += 1;
      if (crouchNow) crouched += 1;
      // The reload beat, measured: consecutive ticks the boss stood in the open,
      // shootable, and made no move. That is the OPPORTUNITY now rather than the
      // failure, so what the assertions bound is its LENGTH — an unbounded one is a
      // boss that has stopped working, and a zero-length one is no beat at all.
      const planted =
        wants <= 0.05 && !driven.intent.dodge && !driven.intent.crouch && shootableNow;
      if (planted) idleExposed += 1;
      else idleExposed = 0;
      maxIdleExposed = Math.max(maxIdleExposed, idleExposed);
    } else {
      idleExposed = 0;
    }
  }

  const b = state.fighters.B.motion.pos;
  const a = state.fighters.A.motion.pos;
  return {
    finalDistance: Math.hypot(a.x - b.x, a.z - b.z),
    penetrationTicks: penetration,
    outOfBoundsTicks: outOfBounds,
    maxStallStreak: maxStall,
    firedWhileEmpty,
    firedWithoutLos,
    exposedTicks: exposed,
    crouchedTicks: crouched,
    emptyTicks: empty,
    maxIdleWhileEmptyExposed: maxIdleExposed,
    coverIdChanges,
    states,
    path,
    finalState: state,
  };
}

// ---- the state machine ------------------------------------------------------

test("the tactical state tracks ammo through armed, low and empty", () => {
  const arena = referenceArena();
  const player = { x: 0, y: 0, z: -7 };
  const boss = { x: 0, y: 0, z: 7 };

  const stateFor = (ammo: number): BossTacticalState => {
    let { state } = bossVsPlayer(arena.world, boss, player, ammo);
    let mem = createBossAiMemory();
    // Settle past the reaction-delay debounce.
    for (let i = 0; i < 30; i++) {
      const view = combatView(arena.world, state, "B");
      // Freeze the world so only ammo drives the state.
      const driven = advanceBossEngagement(M1_TACTICAL, view, SEED, mem);
      mem = driven.memory;
    }
    return bossTacticalState(mem);
  };

  assert.equal(stateFor(7), "ARMED", "a full magazine is armed");
  assert.equal(stateFor(M1_BOSS_TACTICS.lowAmmoThreshold), "LOW", "a few rounds is low");
  assert.equal(stateFor(0), "EMPTY", "no rounds is empty");
});

test("the state transition is debounced, not instantaneous", () => {
  // Dropping to empty must take a bounded number of ticks to be believed — the boss
  // does not react on the exact frame the magazine runs dry.
  const arena = referenceArena();
  let { state } = bossVsPlayer(arena.world, { x: 0, y: 0, z: 7 }, { x: 0, y: 0, z: -7 }, 5);
  let mem = createBossAiMemory();
  // Prime as ARMED.
  for (let i = 0; i < 20; i++) {
    mem = advanceBossEngagement(M1_TACTICAL, combatView(arena.world, state, "B"), SEED, mem).memory;
  }
  assert.equal(bossTacticalState(mem), "ARMED");
  // Now empty the magazine and watch the first tick still read ARMED.
  state = loadMagazine(state, "B", 0);
  const first = advanceBossEngagement(M1_TACTICAL, combatView(arena.world, state, "B"), SEED, mem);
  assert.equal(
    bossTacticalState(first.memory),
    "ARMED",
    "the boss believed it was empty on the very first tick — that is an instant reaction",
  );
});

test("an empty boss never intends to fire, over a long run", () => {
  const arena = referenceArena();
  const result = driveBoss(
    arena.world,
    bossVsPlayer(arena.world, { x: 0, y: 0, z: 7 }, { x: 0, y: 0, z: -7 }, 0),
    () => IDLE_INTENT,
    600,
  );
  assert.equal(result.firedWhileEmpty, 0, "the boss tried to fire on an empty magazine");
  assert.ok(result.states.has("EMPTY"), "the boss never entered the empty state");
});

test("the boss never intends a shot through cover (fire implies a real line)", () => {
  const arena = referenceArena();
  const result = driveBoss(
    arena.world,
    bossVsPlayer(arena.world, { x: 0, y: 0, z: 7 }, { x: 0, y: 0, z: -7 }, 3),
    (tick) => intent({ crouch: tick % 20 < 10 }),
    600,
  );
  assert.equal(
    result.firedWithoutLos,
    0,
    "the boss intended to fire with no line of sight — a shot into cover",
  );
});

// ---- empty: break cover, reload in the open, resume -------------------------
//
// THESE TWO TESTS USED TO ASSERT THE OPPOSITE, AND THE REVERSAL IS THE POINT.
//
// They read "out of ammo the boss reaches cover, breaks the line of sight and
// crouches" and "an empty boss holds cover instead of repeatedly exposing itself",
// and they were right about the code and wrong about the game. Hiding while empty was
// built to the owner's first request and he then played the consequence: a boss behind
// cover is a boss the PLAYER cannot hit either, so the correct-answer path — the one
// where the symmetric complement leaves the boss only 7 balls and it therefore spends
// most of a round empty — ran 10.8 rounds against the wrong path's 7.9 and reached the
// 24-round anti-hang backstop on 7 of 32 seeds. The duel's own card said he steps out
// to reload; he never did, and the card was deleted rather than the behaviour fixed.
//
// So the invariant is inverted, not deleted, and the shape is deliberately a BOUND
// rather than a prohibition. "Never stand exposed and idle" is unsatisfiable for a
// boss whose whole job here is to stand exposed and reload; "stand exposed and idle
// for no longer than one reload beat" is the same fairness rule stated so that it can
// still fail.

test("out of ammo the boss breaks cover and reloads where it can be shot", () => {
  // One chest-high wall between the two. An empty boss must NOT settle behind it: it
  // has to come out to where a ball could actually reach it, and stand while it does.
  const arena = buildArena({
    arenaId: "EMPTY.BREAK",
    halfExtentX: 12,
    halfExtentZ: 12,
    cover: [{ id: "COVER.WALL", x: 0, z: 0, halfX: 2, halfZ: 0.5, topY: CHEST_COVER_HEIGHT }],
  });
  const result = driveBoss(
    arena.world,
    bossVsPlayer(arena.world, { x: 0, y: 0, z: 7 }, { x: 0, y: 0, z: -7 }, 0),
    () => IDLE_INTENT,
    360,
  );
  assert.equal(result.penetrationTicks, 0, "the boss penetrated cover getting there");
  // Hittable for most of the empty window, measured on the lane a ball actually
  // flies rather than on the eye line — see `isExposedToShot`.
  assert.ok(
    result.exposedTicks > result.emptyTicks * 0.6,
    `the boss was shootable in only ${result.exposedTicks}/${result.emptyTicks} empty ` +
      "ticks. An empty boss that cannot be shot is the defect this state was rebuilt for",
  );
  // And it does it standing. Crouching is what makes chest-high cover occlude, so a
  // boss that drops while empty is hiding again by another name.
  assert.ok(
    result.crouchedTicks < result.emptyTicks * 0.1,
    `the boss crouched for ${result.crouchedTicks}/${result.emptyTicks} empty ticks`,
  );
});

test("the exposed reload is a bounded beat, not a boss that stopped working", () => {
  const arena = buildArena({
    arenaId: "EMPTY.BEAT",
    halfExtentX: 12,
    halfExtentZ: 12,
    cover: [{ id: "COVER.WALL", x: 0, z: 0, halfX: 2, halfZ: 0.5, topY: CHEST_COVER_HEIGHT }],
  });
  const result = driveBoss(
    arena.world,
    bossVsPlayer(arena.world, { x: 0, y: 0, z: 7 }, { x: 0, y: 0, z: -7 }, 0),
    () => IDLE_INTENT,
    360,
  );
  // The fairness rule the old prohibition was really about: a bounded stand, then
  // movement. The bound is the profile's own beat plus the state debounce, so it
  // tracks a retune of `reloadExposureTicks` instead of being a magic number.
  const bound = M1_BOSS_TACTICS.reloadExposureTicks + M1_BOSS_TACTICS.reactionDelayTicks;
  assert.ok(
    result.maxIdleWhileEmptyExposed <= bound,
    `the boss stood exposed and still for ${result.maxIdleWhileEmptyExposed} ticks ` +
      `against a reload beat of ${bound}. Past the beat it is not reloading, it is stuck`,
  );
  // And the stand really is a stand — the beat has to actually happen, or this test
  // would pass just as well against a boss that never stops moving.
  assert.ok(
    result.maxIdleWhileEmptyExposed >= M1_BOSS_TACTICS.reloadExposureTicks * 0.5,
    `the longest planted stretch was ${result.maxIdleWhileEmptyExposed} ticks, so no ` +
      "readable reload beat is being played at all",
  );
});

test("the press beat outlasts the steering's stall window", () => {
  // A COUPLING, NOT A PREFERENCE, and it cost two failing patterns to find.
  //
  // `steer` only re-routes around a wall once the body has wanted to move and gone
  // nowhere for `STALL_WINDOW_TICKS`, and the reload beat resets the progress anchor
  // every cycle. So a press beat shorter than that window can never reach the detour:
  // the boss grinds into the crate between it and the player for the whole beat,
  // resets, and grinds again. Measured at a 0.5s press, that was 36 consecutive ticks
  // of pushing into geometry, repeatedly.
  assert.ok(
    M1_BOSS_TACTICS.reloadPressTicks > STALL_WINDOW_TICKS,
    `a ${M1_BOSS_TACTICS.reloadPressTicks}-tick press cannot reach a detour that needs ` +
      `${STALL_WINDOW_TICKS} ticks of stall to trigger`,
  );
});

test("an empty boss rises and fights again the instant it is re-armed", () => {
  const arena = buildArena({
    arenaId: "EMPTY.RESUME",
    halfExtentX: 12,
    halfExtentZ: 12,
    cover: [{ id: "COVER.WALL", x: 0, z: 0, halfX: 2, halfZ: 0.5, topY: CHEST_COVER_HEIGHT }],
  });
  // Empty for the first 200 ticks (it hides), then a reload arms it with a full
  // magazine and it must come back out and shoot.
  const init = bossVsPlayer(arena.world, { x: 0, y: 0, z: 7 }, { x: 0, y: 0, z: -7 }, 0);
  let state = init.state;
  let mem = createBossAiMemory();
  let firedAfterReload = 0;
  let stoodAfterReload = false;
  for (let i = 0; i < 500; i++) {
    if (state.tick === 200) state = loadMagazine(state, "B", 14);
    const view = combatView(arena.world, state, "B");
    const driven = advanceBossEngagement(M1_TACTICAL, view, SEED, mem);
    mem = driven.memory;
    const stepped = stepCombat(arena.world, state, { A: IDLE_INTENT, B: driven.intent }, init.params, 1);
    state = stepped.state;
    if (state.tick > 205) {
      if (state.fighters.B.motion.capsuleHeight >= CROUCH_THRESHOLD) stoodAfterReload = true;
      firedAfterReload += stepped.events.filter(
        (e) => e.type === "SHOT_FIRED" && e.side === "B",
      ).length;
    }
  }
  assert.ok(stoodAfterReload, "the boss stayed crouched (never rose) after being re-armed");
  assert.ok(firedAfterReload > 0, "the boss did not resume firing after the reload");
});

// ---- long seeded runs against varied player patterns ------------------------

const AGGRESSION = (world: CollisionWorld) => (_tick: number, state: CombatState): CombatIntent => {
  const b = state.fighters.B.motion.pos;
  const a = state.fighters.A.motion.pos;
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  return intent({ moveX: dx / len, moveZ: dz / len, sprint: true, fire: true, aimX: dx / len, aimZ: dz / len });
};

const HIDING = (_tick: number, state: CombatState): CombatIntent => {
  // Crouch and drift slowly, occasionally popping up: exercises the LOS flap the
  // hysteresis has to absorb.
  const crouch = Math.floor(state.tick / 8) % 2 === 0;
  return intent({ moveX: 0.2, moveZ: 0, crouch });
};

const FLANKING = (_tick: number, state: CombatState): CombatIntent => {
  const b = state.fighters.B.motion.pos;
  const a = state.fighters.A.motion.pos;
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const toX = dx / len, toZ = dz / len;
  const sign = Math.floor(state.tick / 40) % 2 === 0 ? 1 : -1;
  const close = len > 5 ? 0.7 : 0;
  return intent({
    moveX: -toZ * sign + toX * close,
    moveZ: toX * sign + toZ * close,
    sprint: true,
    fire: true,
    aimX: toX,
    aimZ: toZ,
  });
};

const ROAM = (_tick: number, state: CombatState): CombatIntent => {
  const phase = Math.floor(state.tick / 40);
  const angle = fieldRandom(SEED, phase, 7) * Math.PI * 2;
  const crouch = fieldRandom(SEED, phase, 9) < 0.4;
  return intent({ moveX: Math.cos(angle), moveZ: Math.sin(angle), sprint: true, crouch });
};

function shippedYard(): CollisionWorld {
  return buildArena({
    arenaId: "YARD",
    halfExtentX: 11,
    halfExtentZ: 11,
    cover: [
      { id: "COVER.PILLAR_W", x: -3.5, z: 0, halfX: 0.9, halfZ: 1.6, topY: CHEST_COVER_HEIGHT },
      { id: "COVER.PILLAR_E", x: 3.5, z: 0, halfX: 0.9, halfZ: 1.6, topY: CHEST_COVER_HEIGHT },
      { id: "COVER.CRATE_N", x: 0, z: 5, halfX: 1.4, halfZ: 0.7, topY: 0.7 },
      { id: "COVER.CRATE_S", x: 0, z: -5, halfX: 1.4, halfZ: 0.7, topY: 0.7 },
    ],
  }).world;
}

const PATTERNS: Record<string, (world: CollisionWorld) => (tick: number, state: CombatState) => CombatIntent> = {
  "open aggression": (w) => AGGRESSION(w),
  "hiding/crouching": () => HIDING,
  flanking: () => FLANKING,
  roaming: () => ROAM,
};

for (const [name, make] of Object.entries(PATTERNS)) {
  test(`empty boss vs ${name}: no penetration, no wall grind, no thrash, no idle, no fire-through-cover`, () => {
    const world = shippedYard();
    const result = driveBoss(
      world,
      bossVsPlayer(world, { x: 0, y: 0, z: 8 }, { x: 0, y: 0, z: -8 }, 0),
      make(world),
      2000,
    );
    assert.equal(result.penetrationTicks, 0, "boss penetrated a collider");
    assert.equal(result.outOfBoundsTicks, 0, "boss left the arena");
    assert.equal(result.firedWhileEmpty, 0, "boss fired while empty");
    assert.equal(result.firedWithoutLos, 0, "boss intended a shot through cover");
    assert.ok(
      result.maxStallStreak <= 30,
      `boss ground with no progress for ${result.maxStallStreak} ticks`,
    );
    // The reload beat is bounded, whatever the player does. The bound is one beat
    // plus the state debounce, so a player who charges, hides or flanks cannot turn
    // the exposed reload into a boss standing still for the rest of the round —
    // which, before the strafe-at-striking-distance branch, is exactly what an
    // aggressive player produced: 1044 consecutive ticks.
    const beat =
      M1_BOSS_TACTICS.reloadExposureTicks + M1_BOSS_TACTICS.reactionDelayTicks;
    assert.ok(
      result.maxIdleWhileEmptyExposed <= beat,
      `boss stood exposed and still for ${result.maxIdleWhileEmptyExposed} ticks ` +
        `against a reload beat of ${beat}`,
    );
    // And it really does come out. A boss that stayed screened would satisfy every
    // assertion above it — that is precisely how the hiding boss passed this suite.
    assert.ok(
      result.exposedTicks > result.emptyTicks * 0.5,
      `boss was shootable in only ${result.exposedTicks}/${result.emptyTicks} empty ticks`,
    );
  });
}

test("a full-magazine tactical boss still fights in the open, exactly as armed", () => {
  // The ARMED case must be the ordinary engagement — the tactical layer only adds
  // behaviour at low and empty ammo. Drive it with a full magazine and a still
  // player and confirm it holds a fighting posture and keeps shooting.
  const world = shippedYard();
  let { state, params } = bossVsPlayer(world, { x: 0, y: 0, z: 6 }, { x: 0, y: 0, z: -6 }, 14);
  let mem = createBossAiMemory();
  let fired = 0;
  for (let i = 0; i < 400; i++) {
    const view = combatView(world, state, "B");
    const driven = advanceBossEngagement(M1_TACTICAL, view, SEED, mem);
    mem = driven.memory;
    const stepped = stepCombat(world, state, { A: IDLE_INTENT, B: driven.intent }, params, 1);
    state = stepped.state;
    fired += stepped.events.filter((e) => e.type === "SHOT_FIRED" && e.side === "B").length;
  }
  assert.ok(mem.tacticalHeld === "ARMED" || mem.tacticalHeld === "LOW", "armed boss changed posture with a full magazine");
  // The tier-1 officer reloads slowly (~1.6s between shots), so ~5 shots in 400
  // ticks is a full open-field cadence — the point is that it keeps trading, not
  // that it dumps a magazine.
  assert.ok(fired >= 3, `an armed boss fired only ${fired} shots at a still player`);
});

// ---- determinism ------------------------------------------------------------

test("the tactical boss is deterministic — identical seed, identical path", () => {
  const world = shippedYard();
  const run = () =>
    driveBoss(world, bossVsPlayer(world, { x: 0, y: 0, z: 8 }, { x: 0, y: 0, z: -8 }, 0), FLANKING, 800).path;
  assert.deepEqual(run(), run(), "the same seed produced a different path");
});

// ---- winnability / balance of the shipped tactical boss ---------------------

interface DuelMeasure {
  winsA: number;
  runs: number;
  meanRounds: number;
  maxRounds: number;
  meanPlayerHealth: number;
  firedWhileEmpty: number;
}

function measureDuels(kind: VerdictKind, seeds: readonly number[]): DuelMeasure {
  let winsA = 0;
  let totalRounds = 0;
  let maxRounds = 0;
  let totalHealth = 0;
  let firedWhileEmpty = 0;
  const arena = referenceArena();
  for (const seed of seeds) {
    const created = createDuel({
      duelId: "BAL",
      seed,
      world: arena.world,
      opponent: { kind: "BOSS", profile: M1_TACTICAL },
      questions: questionSet(),
      placement: arena.placement,
      roundCeiling: DUEL_ROUND_CEILING,
    });
    let state: DuelState = created.state;
    let steps = 0;
    while (state.phase !== "DUEL_RESOLVED" && steps < 300_000) {
      steps += 1;
      if (state.phase === "QUESTION_PENDING") {
        state = reduceDuel(state, {
          kind: "COMMIT_VERDICT",
          side: "A",
          verdict: verdictFor(kind, state.item, "A", state.round),
        }).state;
        continue;
      }
      const intents: Partial<Record<DuelSide, CombatIntent>> = {};
      if (state.phase === "ENGAGEMENT_LIVE" || state.phase === "LINE_OF_SIGHT_BREAK") {
        intents.A = oracleIntent(combatView(arena.world, state.combat, "A"));
      }
      const ammoBefore = state.combat.fighters.B.ammo;
      const result = reduceDuel(state, { kind: "ADVANCE", frameDtS: FIELD_DT, intents });
      for (const e of result.events) {
        if (e.type === "SHOT_FIRED" && e.side === "B" && ammoBefore <= 0) firedWhileEmpty += 1;
      }
      state = result.state;
    }
    assert.equal(state.phase, "DUEL_RESOLVED", `seed ${seed} on ${kind} never resolved`);
    if (state.phase === "DUEL_RESOLVED") {
      if (state.outcome.winner === "A") winsA += 1;
      totalHealth += state.outcome.healthA;
      totalRounds += state.round;
      maxRounds = Math.max(maxRounds, state.round);
    }
  }
  return {
    winsA,
    runs: seeds.length,
    meanRounds: totalRounds / seeds.length,
    maxRounds,
    meanPlayerHealth: totalHealth / seeds.length,
    firedWhileEmpty,
  };
}

const BALANCE_SEEDS = [1, 7, 19, 33, 101, 512, 4242, 90210] as const;

test("M1 tactical boss: both answer paths are winnable and terminate", () => {
  const correct = measureDuels("CORRECT", BALANCE_SEEDS);
  const wrong = measureDuels("WRONG", BALANCE_SEEDS);
  // A skilled (reference) player beats the shipped boss on both paths.
  assert.ok(
    correct.winsA >= BALANCE_SEEDS.length,
    `correct path won ${correct.winsA}/${correct.runs}`,
  );
  assert.ok(
    wrong.winsA > BALANCE_SEEDS.length / 2,
    `wrong path won only ${wrong.winsA}/${wrong.runs} — it must stay winnable`,
  );
  // The backstop is not load-bearing: even the harder path finishes well short of it.
  assert.ok(
    correct.maxRounds < DUEL_ROUND_CEILING,
    `correct path reached ${correct.maxRounds} rounds`,
  );
  assert.ok(
    wrong.maxRounds < DUEL_ROUND_CEILING,
    `wrong path reached ${wrong.maxRounds} rounds`,
  );
  // The boss never fired an empty magazine in a full live duel.
  assert.equal(correct.firedWhileEmpty + wrong.firedWhileEmpty, 0, "the boss fired while empty in a live duel");
});

test("M1 tactical boss: the wrong-answer path is materially more dangerous", () => {
  const correct = measureDuels("CORRECT", BALANCE_SEEDS);
  const wrong = measureDuels("WRONG", BALANCE_SEEDS);
  // Answering wrong arms the boss with 14 and the player with 7, so the player must
  // finish on materially less health than on the correct path.
  assert.ok(
    wrong.meanPlayerHealth < correct.meanPlayerHealth - 20,
    `wrong path leaves ${wrong.meanPlayerHealth.toFixed(0)} health vs ${correct.meanPlayerHealth.toFixed(0)} ` +
      "on the correct path — the wrong answer is supposed to hurt",
  );
});
