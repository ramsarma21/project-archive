import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockerIdsAt,
  collisionBroadPhaseCandidateCount,
  depenetrateXZ,
  headClearance,
  invalidateCollisionBroadPhase,
  segmentOccluderIds,
  supportBelow,
  sweepXZ,
  wallFromOrientedRect,
  type CollisionWorld,
} from "../collision.js";
import {
  bruteForceBlockerIdsAt,
  bruteForceDepenetrateXZ,
  bruteForceHeadClearance,
  bruteForceSegmentOccluderIds,
  bruteForceSupportBelow,
  bruteForceSweepXZ,
} from "./collisionBruteForce.js";
import { buildExteriorGameplayCollision } from "../gameplayWorld.js";
import {
  doorAwareBuildingColliders,
  type DoorTargetId,
} from "../doorwayContract.js";
import { buildInteriorCollisionWorld } from "../interiorCollision.js";
import { INTERIOR_IDS, interiorDef } from "../interiorManifest.js";
import { exteriorColliders } from "../manifest.js";
import { traversalBlockerColliders } from "../traversalMarkers.js";

function liveExterior(
  routes: Record<string, string> = {},
  openDoorTarget: DoorTargetId | null = null,
): CollisionWorld {
  return buildExteriorGameplayCollision({
    colliders: [
      ...exteriorColliders(
        routes,
        doorAwareBuildingColliders(openDoorTarget),
      ),
      ...traversalBlockerColliders(),
    ],
  });
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBetween(random: () => number, min: number, max: number): number {
  return min + (max - min) * random();
}

function parityQueries(
  world: CollisionWorld,
  seed: number,
  queryCount: number,
): void {
  const random = mulberry32(seed);
  for (let index = 0; index < queryCount; index++) {
    const from = {
      x: randomBetween(random, world.bounds.minX, world.bounds.maxX),
      y: randomBetween(random, 0, 4),
      z: randomBetween(random, world.bounds.minZ, world.bounds.maxZ),
    };
    const to = {
      x: from.x + randomBetween(random, -5, 5),
      z: from.z + randomBetween(random, -5, 5),
    };
    const radius = randomBetween(random, 0.05, 0.55);
    const height = random() < 0.35 ? 0.98 : 1.55;
    const ignored =
      world.blockers.length > 0 && random() < 0.2
        ? new Set([
            world.blockers[
              Math.floor(random() * world.blockers.length)
            ]!.id,
          ])
        : undefined;

    assert.deepEqual(
      sweepXZ(world, from, to, radius, height, ignored),
      bruteForceSweepXZ(world, from, to, radius, height, ignored),
      `sweep parity query ${index} ${JSON.stringify({ from, to, radius, height, ignored: ignored ? [...ignored] : [] })}`,
    );
    assert.deepEqual(
      blockerIdsAt(world, from, radius, height, ignored),
      bruteForceBlockerIdsAt(world, from, radius, height, ignored),
      `point parity query ${index}`,
    );

    const rayEnd = {
      x: from.x + randomBetween(random, -35, 35),
      y: randomBetween(random, 0, 6),
      z: from.z + randomBetween(random, -35, 35),
    };
    assert.deepEqual(
      segmentOccluderIds(world, from, rayEnd, ignored),
      bruteForceSegmentOccluderIds(world, from, rayEnd, ignored),
      `LOS parity query ${index}`,
    );
    assert.deepEqual(
      supportBelow(world, from.x, from.z, from.y),
      bruteForceSupportBelow(world, from.x, from.z, from.y),
      `support parity query ${index}`,
    );
    assert.equal(
      headClearance(world, from.x, from.z, radius, from.y, ignored),
      bruteForceHeadClearance(
        world,
        from.x,
        from.z,
        radius,
        from.y,
        ignored,
      ),
      `clearance parity query ${index}`,
    );
    if (index % 40 === 0) {
      assert.deepEqual(
        depenetrateXZ(world, from, radius, height, 0.35),
        bruteForceDepenetrateXZ(world, from, radius, height, 0.35),
        `depenetration parity query ${index}`,
      );
    }
  }
}

test("indexed broad phase matches brute force across exterior lifecycle states", () => {
  const worlds = [
    liveExterior(),
    liveExterior({ THOMAS_DOCK_ROUTE: "UNLOCKED" }),
    liveExterior({}, "MERCER_PRESS"),
    liveExterior({}, "CUSTOM_HOUSE"),
  ];
  worlds.forEach((world, index) => parityQueries(world, 1765 + index, 1250));
});

test("indexed broad phase matches brute force in every isolated interior", () => {
  INTERIOR_IDS.forEach((id, index) => {
    const def = interiorDef(id);
    assert.ok(def, `missing interior ${id}`);
    parityQueries(buildInteriorCollisionWorld(def), 9000 + index, 100);
  });
});

test("rotated corners, ignores, and in-place lifecycle invalidation remain exact", () => {
  const world: CollisionWorld = {
    blockers: [
      wallFromOrientedRect("ROTATED", 0, 0, 3, 0.35, Math.PI / 4, {
        topY: 2,
      }),
    ],
    platforms: [],
    bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
  };
  parityQueries(world, 42, 1000);

  world.blockers.push(
    wallFromOrientedRect("DYNAMIC_DOOR", 8, 0, 0.7, 0.12, Math.PI / 3, {
      topY: 2.2,
    }),
  );
  invalidateCollisionBroadPhase(world);
  parityQueries(world, 43, 1000);
});

test("representative exterior queries reduce candidate count materially", () => {
  const world = liveExterior();
  const views = [
    [-6, 1.5],
    [75, 0],
    [-137, 2],
  ] as const;
  for (const [x, z] of views) {
    const candidates = collisionBroadPhaseCandidateCount(world, {
      minX: x - 5,
      maxX: x + 5,
      minZ: z - 5,
      maxZ: z + 5,
      minY: 0,
      maxY: 1.55,
    });
    assert.ok(
      candidates < world.blockers.length * 0.25,
      `${x},${z}: ${candidates}/${world.blockers.length} candidates`,
    );
  }
});
