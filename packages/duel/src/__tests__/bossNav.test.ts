// The boss's navigation competence, checked by deterministic simulation.
//
// These are the guards for the two symptoms the owner reported — the enemy getting
// stuck on walls, and glitching when the player hides and crouches behind cover —
// and for the invariants the fix must not break: no penetration, and no thrash.
// Everything is against the authoritative simulation (the shared integrator and the
// real collision queries), seeded, so a failure is reproducible.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bossFighterParams,
  bossProfileForTier,
} from "../boss.js";
import {
  advanceBossEngagement,
  createBossAiMemory,
  type BossAiMemory,
} from "../bossAi.js";
import { bossCoverPoints, isCoverReachable, nearestBossCover } from "../cover.js";
import {
  combatView,
  createCombatState,
  hasLineOfSight,
  IDLE_INTENT,
  loadMagazine,
  playerParams,
  stepCombat,
  type CombatParams,
  type CombatState,
} from "../combat.js";
import { buildArena, CHEST_COVER_HEIGHT } from "../arena.js";
import {
  blockerIdsAt,
  CAPSULE_RADIUS,
  CROUCH_HEIGHT,
  STAND_HEIGHT,
  fieldRandom,
  platformFromRect,
  wallFromRect,
  type Blocker,
  type CollisionWorld,
  type Vec3,
} from "../engine.js";
import { intent, type CombatIntent } from "../combat.js";

const SEED = 20260727;

function worldOf(blockers: Blocker[], half = 12): CollisionWorld {
  return {
    blockers,
    platforms: [platformFromRect("FLOOR", -half, half, -half, half, 0, ["FLOOR"])],
    bounds: { minX: -half, maxX: half, minZ: -half, maxZ: half },
  };
}

const M1_PROFILE = bossProfileForTier(1, "BOSS.NAV.TEST", {
  ammoPolicy: "SYMMETRIC_COMPLEMENT",
  takesCoverBeforeQuestion: true,
});

function bossVsPlayer(
  world: CollisionWorld,
  boss: Vec3,
  player: Vec3,
): { params: CombatParams; state: CombatState } {
  const params: CombatParams = {
    A: playerParams(),
    B: bossFighterParams(M1_PROFILE),
  };
  let state = createCombatState(params, {
    A: { pos: player, yaw: 0 },
    B: { pos: boss, yaw: Math.PI },
  });
  state = loadMagazine(state, "B", 14);
  return { params, state };
}

/**
 * Drive side B with the boss AI and side A with a fixed intent, reporting the
 * navigation quality: how close the boss got, whether it ever regained the line,
 * the longest run of no-progress-while-trying-to-move (a grind), and any tick the
 * body penetrated a collider.
 */
function driveBoss(
  world: CollisionWorld,
  init: { params: CombatParams; state: CombatState },
  playerIntent: (tick: number) => CombatIntent,
  ticks: number,
): {
  finalDistance: number;
  regainedLos: boolean;
  maxStallStreak: number;
  penetrationTicks: number;
  outOfBoundsTicks: number;
  path: Vec3[];
} {
  let { state } = init;
  let mem: BossAiMemory = createBossAiMemory();
  let stall = 0;
  let maxStall = 0;
  let regainedLos = false;
  let penetration = 0;
  let outOfBounds = 0;
  const path: Vec3[] = [];
  for (let i = 0; i < ticks; i++) {
    const view = combatView(world, state, "B");
    const driven = advanceBossEngagement(M1_PROFILE, view, SEED, mem);
    mem = driven.memory;
    const before = { ...state.fighters.B.motion.pos };
    const stepped = stepCombat(
      world,
      state,
      { A: playerIntent(state.tick), B: driven.intent },
      init.params,
      1,
    );
    state = stepped.state;
    const after = state.fighters.B.motion.pos;
    path.push({ ...after });

    const delta = Math.hypot(after.x - before.x, after.z - before.z);
    const want = Math.hypot(driven.intent.moveX, driven.intent.moveZ);
    if (want > 0.3 && delta < 0.02) stall += 1;
    else stall = 0;
    maxStall = Math.max(maxStall, stall);

    if (hasLineOfSight(world, state.fighters.A, state.fighters.B)) regainedLos = true;
    // Penetration = intruding deeper than the sweep's resting skin. A body leaning
    // on a wall reads as touching at full radius, so shrink it a little; anything
    // that trips this is a genuine overlap.
    if (
      blockerIdsAt(world, after, CAPSULE_RADIUS - 0.03, STAND_HEIGHT * 0.5).length > 0
    ) {
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
  }
  const b = state.fighters.B.motion.pos;
  const a = state.fighters.A.motion.pos;
  return {
    finalDistance: Math.hypot(a.x - b.x, a.z - b.z),
    regainedLos,
    maxStallStreak: maxStall,
    penetrationTicks: penetration,
    outOfBoundsTicks: outOfBounds,
    path,
  };
}

// ---- symptom A: getting stuck on walls -------------------------------------

test("the boss re-plans around a barrier instead of grinding into it", () => {
  // A full-height barrier sits squarely between the boss and the player, so the
  // straight line the raw policy wants to walk is blocked and the sightline is
  // broken. The boss must route around the ends rather than press into the face —
  // the multi-second wall grind the diagnosis found.
  const barrier = wallFromRect("BARRIER", 0, 0, 3, 0.4, { topY: Infinity });
  const world = worldOf([barrier]);
  const result = driveBoss(
    world,
    bossVsPlayer(world, { x: 0, y: 0, z: 8 }, { x: 0, y: 0, z: -8 }),
    () => IDLE_INTENT,
    360,
  );
  assert.equal(result.penetrationTicks, 0, "the boss penetrated the barrier");
  assert.ok(
    result.regainedLos,
    "the boss never got around the barrier to re-open its line of sight",
  );
  assert.ok(
    result.finalDistance < 11,
    `the boss closed to only ${result.finalDistance.toFixed(1)}m — it did not get around`,
  );
  assert.ok(
    result.maxStallStreak <= 30,
    `the boss ground with no progress for ${result.maxStallStreak} ticks — that is sticking`,
  );
});

test("boss navigation is deterministic — identical seed, identical path", () => {
  const barrier = wallFromRect("BARRIER", 0, 0, 3, 0.4, { topY: Infinity });
  const world = worldOf([barrier]);
  const a = driveBoss(world, bossVsPlayer(world, { x: 0, y: 0, z: 8 }, { x: 0, y: 0, z: -8 }), () => IDLE_INTENT, 200);
  const b = driveBoss(world, bossVsPlayer(world, { x: 0, y: 0, z: 8 }, { x: 0, y: 0, z: -8 }), () => IDLE_INTENT, 200);
  assert.deepEqual(a.path, b.path, "the same seed produced a different path");
});

test("the boss wall-slides along an obstacle it meets at an angle", () => {
  // With a clear line, the boss holds range and strafes; drive it beside a long
  // wall so its strafe presses into the wall at a shallow angle. The shared
  // integrator must slide it ALONG the wall — lateral progress, never a dead stop,
  // never a penetration.
  const wall = wallFromRect("WALL", 4, 0, 0.4, 6, { topY: Infinity });
  const world = worldOf([wall]);
  // Boss just west of the wall, player to the south so "hold range and strafe"
  // runs the boss up and down the wall face.
  const result = driveBoss(
    world,
    bossVsPlayer(world, { x: 3.2, y: 0, z: 4 }, { x: 3.2, y: 0, z: -6 }),
    () => IDLE_INTENT,
    180,
  );
  assert.equal(result.penetrationTicks, 0, "the boss slid INTO the wall");
  // It covered real ground along the wall rather than freezing against it.
  const travelledZ = Math.max(...result.path.map((p) => p.z)) - Math.min(...result.path.map((p) => p.z));
  assert.ok(
    travelledZ > 1.5 || result.path.some((p) => Math.hypot(p.x - 3.2, p.z - 4) > 1.5),
    "the boss made no progress along the wall — it stuck",
  );
});

// ---- cover reachability and occupancy --------------------------------------

test("a cover point behind an unreachable wall is rejected", () => {
  // One chest-high cover, and a full-height wall sealing the boss off from the far
  // side of it. The point is standable and it occludes — but the boss cannot walk
  // there, so it must not be offered when reachability is required.
  const cover = buildArena({
    arenaId: "REACH",
    halfExtentX: 12,
    halfExtentZ: 12,
    cover: [{ id: "COVER.WALL", x: 0, z: 0, halfX: 2, halfZ: 0.5, topY: CHEST_COVER_HEIGHT }],
  });
  // Seal the boss (south) off from the cover's far (north) side with a long wall.
  const seal = wallFromRect("SEAL", 0, 3.5, 11.5, 0.4, { topY: Infinity });
  const world: CollisionWorld = {
    ...cover.world,
    blockers: [...cover.world.blockers, seal],
  };
  const boss = { x: 0, y: 0, z: 9 };
  const player = { x: 0, y: 0, z: -9 };
  // Without reachability filtering the point is valid cover and is offered.
  assert.ok(
    bossCoverPoints(world, boss, player).length >= 1,
    "the cover point should be valid cover on its own merits",
  );
  // With it, the sealed-off point is rejected.
  assert.equal(
    nearestBossCover(world, boss, player, STAND_HEIGHT, { reachableFrom: boss }),
    null,
    "an unreachable cover point was still offered to the boss",
  );
});

test("a cover point the player is standing on is rejected as occupied", () => {
  const cover = buildArena({
    arenaId: "OCCUPIED",
    halfExtentX: 12,
    halfExtentZ: 12,
    cover: [{ id: "COVER.WALL", x: 0, z: 0, halfX: 2, halfZ: 0.5, topY: CHEST_COVER_HEIGHT }],
  });
  const boss = { x: 0, y: 0, z: 8 };
  const player = { x: 0, y: 0, z: -8 };
  const point = bossCoverPoints(cover.world, boss, player)[0];
  assert.ok(point, "expected a cover point to exist");
  // A player standing exactly on that point makes it unusable.
  const occupied = [{ x: point!.x, z: point!.z, radius: CAPSULE_RADIUS }];
  assert.equal(
    nearestBossCover(cover.world, boss, player, STAND_HEIGHT, { blocked: occupied }),
    null,
    "a cover point the player occupies was still offered",
  );
  // And it is offered again once the player steps off it.
  assert.ok(
    nearestBossCover(cover.world, boss, player, STAND_HEIGHT, {
      blocked: [{ x: 5, z: 5, radius: CAPSULE_RADIUS }],
    }),
    "a free cover point should still be offered",
  );
});

test("isCoverReachable sees a straight walk but not a walled-off one", () => {
  const cover = buildArena({
    arenaId: "REACH2",
    halfExtentX: 12,
    halfExtentZ: 12,
    cover: [{ id: "COVER.WALL", x: 0, z: 0, halfX: 2, halfZ: 0.5, topY: CHEST_COVER_HEIGHT }],
  });
  const point = bossCoverPoints(cover.world, { x: 0, y: 0, z: 8 }, { x: 0, y: 0, z: -8 })[0]!;
  assert.equal(isCoverReachable(cover.world, { x: 0, y: 0, z: 8 }, point), true);
  const seal = wallFromRect("SEAL", 0, 3.5, 11.5, 0.4, { topY: Infinity });
  const walled: CollisionWorld = { ...cover.world, blockers: [...cover.world.blockers, seal] };
  assert.equal(isCoverReachable(walled, { x: 0, y: 0, z: 9 }, point), false);
});

// ---- symptom B: crouch/hide LOS flapping -----------------------------------

test("a player flickering crouch behind cover does not flap the boss's state", () => {
  // A chest-high wall between the two. A STANDING player is visible over it; a
  // CROUCHED one is occluded. Toggling the player's stance every tick therefore
  // flaps the RAW line of sight — the exact input that made the boss oscillate.
  // The debounced line the boss actually acts on must stay steady.
  const arena = buildArena({
    arenaId: "FLAP",
    halfExtentX: 12,
    halfExtentZ: 12,
    cover: [{ id: "COVER.WALL", x: 0, z: 0, halfX: 2.5, halfZ: 0.5, topY: CHEST_COVER_HEIGHT }],
  });
  const { params } = bossVsPlayer(arena.world, { x: 0, y: 0, z: 4 }, { x: 0, y: 0, z: -4 });
  let state = createCombatState(params, {
    A: { pos: { x: 0, y: 0, z: -4 }, yaw: 0 },
    B: { pos: { x: 0, y: 0, z: 4 }, yaw: Math.PI },
  });
  state = loadMagazine(state, "B", 14);
  let mem = createBossAiMemory();

  let rawFlaps = 0;
  let heldFlaps = 0;
  let prevRaw: boolean | null = null;
  let prevHeld: boolean | null = null;
  const TICKS = 120;
  for (let i = 0; i < TICKS; i++) {
    // Toggle the player's stance every tick without moving anyone, so geometry is
    // constant and only the crouch drives the sightline.
    const crouched = i % 2 === 0;
    const height = crouched ? CROUCH_HEIGHT : STAND_HEIGHT;
    state = {
      ...state,
      fighters: {
        ...state.fighters,
        A: {
          ...state.fighters.A,
          motion: { ...state.fighters.A.motion, capsuleHeight: height },
        },
      },
    };
    const view = combatView(arena.world, state, "B");
    const raw = view.hasLineOfSight;
    const driven = advanceBossEngagement(M1_PROFILE, view, SEED, mem);
    mem = driven.memory;
    const held = mem.losHeld;

    if (prevRaw !== null && raw !== prevRaw) rawFlaps += 1;
    if (prevHeld !== null && held !== prevHeld) heldFlaps += 1;
    prevRaw = raw;
    prevHeld = held;
  }
  // The raw line really is flapping — this is a live reproduction, not a strawman.
  assert.ok(rawFlaps > 40, `the raw line of sight only flapped ${rawFlaps} times; the setup is wrong`);
  // The boss's believed line barely moves: hysteresis absorbs the per-tick chatter.
  assert.ok(
    heldFlaps <= 2,
    `the boss's debounced line of sight flapped ${heldFlaps} times — the state is still oscillating`,
  );
});

// ---- the no-penetration invariant over a long seeded run -------------------

test("over a long randomized-but-seeded run the boss never penetrates world colliders", () => {
  // The shipped-style yard: chest-high pillars and low crates. A pseudo-random but
  // seeded player drags the boss all over it — into corners, behind cover, across
  // the pillars — for thousands of ticks. The boss's capsule must never end a tick
  // inside a collider and never leave the arena.
  const arena = buildArena({
    arenaId: "NOPEN",
    halfExtentX: 11,
    halfExtentZ: 11,
    cover: [
      { id: "COVER.PILLAR_W", x: -3.5, z: 0, halfX: 0.9, halfZ: 1.6, topY: CHEST_COVER_HEIGHT },
      { id: "COVER.PILLAR_E", x: 3.5, z: 0, halfX: 0.9, halfZ: 1.6, topY: CHEST_COVER_HEIGHT },
      { id: "COVER.CRATE_N", x: 0, z: 5, halfX: 1.4, halfZ: 0.7, topY: 0.7 },
      { id: "COVER.CRATE_S", x: 0, z: -5, halfX: 1.4, halfZ: 0.7, topY: 0.7 },
    ],
  });
  const { params, state: init } = bossVsPlayer(arena.world, { x: 0, y: 0, z: 8 }, { x: 0, y: 0, z: -8 });
  let state = init;
  let mem = createBossAiMemory();
  let penetration = 0;
  let outOfBounds = 0;
  // A seeded roaming player: pick a new heading periodically, sometimes crouch.
  const playerIntent = (tick: number): CombatIntent => {
    const phase = Math.floor(tick / 40);
    const angle = fieldRandom(SEED, phase, 7) * Math.PI * 2;
    const crouch = fieldRandom(SEED, phase, 9) < 0.4;
    return intent({ moveX: Math.cos(angle), moveZ: Math.sin(angle), sprint: true, crouch });
  };
  const TICKS = 4000;
  for (let i = 0; i < TICKS; i++) {
    const view = combatView(arena.world, state, "B");
    const driven = advanceBossEngagement(M1_PROFILE, view, SEED, mem);
    mem = driven.memory;
    const stepped = stepCombat(
      arena.world,
      state,
      { A: playerIntent(i), B: driven.intent },
      params,
      1,
    );
    state = stepped.state;
    const p = state.fighters.B.motion.pos;
    if (blockerIdsAt(arena.world, p, CAPSULE_RADIUS - 0.03, STAND_HEIGHT * 0.5).length > 0) {
      penetration += 1;
    }
    if (
      p.x < arena.world.bounds.minX - 1e-6 ||
      p.x > arena.world.bounds.maxX + 1e-6 ||
      p.z < arena.world.bounds.minZ - 1e-6 ||
      p.z > arena.world.bounds.maxZ + 1e-6
    ) {
      outOfBounds += 1;
    }
  }
  assert.equal(penetration, 0, `the boss penetrated a collider on ${penetration} ticks`);
  assert.equal(outOfBounds, 0, `the boss left the arena on ${outOfBounds} ticks`);
});
