import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CAPSULE_RADIUS,
  STAND_HEIGHT,
  chestPosition,
  eyePosition,
  positionClear,
  segmentClear,
} from "@pa/engine-world/collision";
import { RUN_SPEED } from "@pa/engine-world/playerMotion";
import { arenaWorld } from "../runtime.js";

import { compileLevel } from "../compile.js";
import { M1_EFFIGY_RUN } from "../level/index.js";
import type { Vec3Tuple } from "../types.js";

const level = M1_EFFIGY_RUN;
const compiled = compileLevel(level);
const arena = level.arena;

// "The constable breaks line of sight every twenty seconds" is only interesting
// if the break is a property of the geometry. Each station is checked with the
// same segmentClear the game uses, from the boss's eye to the player's chest.

function sees(from: Vec3Tuple, to: Vec3Tuple): boolean {
  return segmentClear(
    compiled.world,
    eyePosition({
      pos: { x: from[0], y: from[1], z: from[2] },
      capsuleHeight: STAND_HEIGHT,
    }),
    chestPosition({
      pos: { x: to[0], y: to[1], z: to[2] },
      capsuleHeight: STAND_HEIGHT,
    }),
  );
}

function blockedFraction(from: Vec3Tuple): number {
  const blocked = arena.playerStations.filter(
    (station) => !sees(from, station),
  ).length;
  return blocked / arena.playerStations.length;
}

test("the arena is six rounds of twenty seconds", () => {
  assert.equal(arena.rounds, 6);
  assert.equal(arena.roundSeconds, 20);
  assert.equal(arena.breakStations.length, arena.rounds);
  assert.deepEqual(
    arena.breakStations.map((s) => s.round),
    [1, 2, 3, 4, 5, 6],
  );
});

test("every station, peek and fighting position is somewhere a body fits", () => {
  const points: Array<[string, Vec3Tuple]> = [
    ["playerSpawn", arena.playerSpawn],
    ["bossSpawn", arena.bossSpawn],
    ...arena.breakStations.flatMap(
      (s) =>
        [
          [`${s.id}.pos`, s.pos],
          [`${s.id}.peek`, s.peek],
        ] as Array<[string, Vec3Tuple]>,
    ),
    ...arena.playerStations.map(
      (p, i) => [`station${i}`, p] as [string, Vec3Tuple],
    ),
  ];
  for (const [label, point] of points) {
    assert.ok(
      positionClear(
        compiled.world,
        { x: point[0], y: point[1], z: point[2] },
        CAPSULE_RADIUS,
        STAND_HEIGHT,
      ),
      `${label} at ${point.join(", ")} is inside something`,
    );
    assert.ok(
      point[0] > arena.bounds.minX &&
        point[0] < arena.bounds.maxX &&
        point[2] > arena.bounds.minZ &&
        point[2] < arena.bounds.maxZ,
      `${label} is outside the yard`,
    );
  }
});

test("each break station really breaks sight from most of the yard", () => {
  for (const station of arena.breakStations) {
    const fraction = blockedFraction(station.pos);
    assert.ok(
      fraction >= 0.5,
      `round ${station.round}: only ${(fraction * 100).toFixed(0)}% of fighting positions lose sight of him there`,
    );
  }
});

test("no break is total, so the player can always find him by moving", () => {
  for (const station of arena.breakStations) {
    const fraction = blockedFraction(station.pos);
    assert.ok(
      fraction < 1,
      `round ${station.round} hides him from the entire yard, which is a wall and not cover`,
    );
  }
});

test("from every peek he can re-engage", () => {
  for (const station of arena.breakStations) {
    const visible = arena.playerStations.filter((p) =>
      sees(station.peek, p),
    ).length;
    assert.ok(
      visible >= arena.playerStations.length / 2,
      `round ${station.round}: leaning out of ${station.id} still shows him only ${visible} of ${arena.playerStations.length} positions`,
    );
  }
});

test("the cover named by each station is the cover doing the work", () => {
  for (const station of arena.breakStations) {
    assert.ok(station.behind.length > 0, `${station.id} names no cover`);
    for (const id of station.behind) {
      const mass = compiled.massById.get(id);
      assert.ok(mass, `${station.id} hides behind ${id}, which does not exist`);
      const distance = Math.hypot(
        station.pos[0] - (mass!.rect.minX + mass!.rect.maxX) / 2,
        station.pos[2] - (mass!.rect.minZ + mass!.rect.maxZ) / 2,
      );
      assert.ok(
        distance < 4,
        `${station.id} claims ${id} but stands ${distance.toFixed(1)}m from it`,
      );
    }
  }
});

test("he has to cross real ground between rounds, and can", () => {
  for (let i = 1; i < arena.breakStations.length; i++) {
    const a = arena.breakStations[i - 1]!.pos;
    const b = arena.breakStations[i]!.pos;
    const distance = Math.hypot(b[0] - a[0], b[2] - a[2]);
    assert.ok(
      distance >= 2.5,
      `rounds ${i} to ${i + 1} move him only ${distance.toFixed(1)}m, which reads as standing still`,
    );
    assert.ok(
      distance / RUN_SPEED < arena.roundSeconds,
      `rounds ${i} to ${i + 1} cannot be walked inside a round`,
    );
  }
});

test("the six rounds use most of the yard's cover, not one favourite piece", () => {
  const used = new Set(arena.breakStations.flatMap((s) => s.behind));
  assert.ok(
    used.size >= 4,
    `the fight only ever hides behind ${used.size} pieces; the yard should be worth walking around`,
  );
});

test("the yard is enclosed except at the gate", () => {
  const walls = [...compiled.massById.values()].filter((m) =>
    m.tags.includes("arena-wall"),
  );
  assert.ok(walls.length >= 4, "a courtyard needs four sides");
  for (const wall of walls) {
    assert.ok(wall.topY >= 3.0, `${wall.id} is low enough to vault out of`);
  }
});

// The arena the duel is actually handed is a filtered copy of the floor's
// world. If that filter drops a cover piece the six breaks stop being honest,
// so it is checked against the world the breaks were solved in.

test("the world handed to the duel is the yard the breaks were solved against", () => {
  const duelWorld = arenaWorld();
  for (const piece of arena.cover) {
    assert.ok(
      duelWorld.blockers.some((blocker) => blocker.id === piece.massId),
      `${piece.massId} is cover on the floor and missing from the duel's world`,
    );
  }
  for (const blocker of duelWorld.blockers) {
    assert.ok(
      blocker.minX >= arena.bounds.minX - 1 && blocker.maxX <= arena.bounds.maxX + 1,
      `${blocker.id} is outside the yard and should not have come with it`,
    );
  }
  assert.ok(
    duelWorld.blockers.length >= arena.cover.length + 4,
    "the cover and the four walls all survive the filter",
  );
});

test("each round boundary has somewhere to break to, reachable from the last peek", () => {
  // The claim the round structure rests on: at every boundary the boss can
  // leave the place he was shooting from and reach a place that breaks sight,
  // inside the twenty seconds the round gives him.
  for (let round = 1; round < arena.breakStations.length; round++) {
    const from = arena.breakStations[round - 1]!;
    const to = arena.breakStations[round]!;
    const travel = Math.hypot(to.pos[0] - from.peek[0], to.pos[2] - from.peek[2]);
    assert.ok(
      travel / RUN_SPEED < arena.roundSeconds,
      `round ${round} to ${round + 1}: ${travel.toFixed(1)}m from the peek is more than a round's walk`,
    );
    assert.ok(
      blockedFraction(to.pos) >= 0.5,
      `round ${round + 1} has nowhere that breaks sight`,
    );
  }
});

test("the player's own spawn can see him somewhere, and lose him somewhere", () => {
  const spawn = arena.playerSpawn;
  const visible = arena.breakStations.filter((s) => sees(s.peek, spawn)).length;
  const hidden = arena.breakStations.filter((s) => !sees(s.pos, spawn)).length;
  assert.ok(
    visible >= 3,
    `standing where the duel starts, only ${visible} of six peeks can engage the player`,
  );
  assert.ok(
    hidden >= 3,
    `standing where the duel starts, only ${hidden} of six breaks actually break`,
  );
});
