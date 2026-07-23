import { test } from "node:test";
import assert from "node:assert/strict";
import {
  wallFromOrientedRect,
  wallFromRect,
  type CollisionWorld,
} from "../collision.js";
import {
  EXTERIOR_GAMEPLAY_SPACE,
  buildExteriorGameplayCollision,
  buildGameplayWorld,
  interiorGameplaySpace,
} from "../gameplayWorld.js";
import {
  buildOutdoorCollisionParts,
  isLegacyDensityBarrierCollider,
  isLegacyPropCollider,
  isLegacyTraversalCollider,
} from "../outdoorCollisionAdapter.js";
import { buildDensityTraversalRegistrations } from "../densityTraversalAdapter.js";
import {
  doorAwareBuildingColliders,
  doorwayForTarget,
} from "../doorwayContract.js";
import { buildInteriorCollisionWorld } from "../interiorCollision.js";
import {
  INTERIOR_IDS,
  interiorDef,
} from "../interiorManifest.js";
import { exteriorColliders } from "../manifest.js";
import {
  TRAVERSAL_SET,
  traversalBlockerColliders,
} from "../traversalMarkers.js";

function liveExteriorColliders(
  routes: Record<string, string> = {},
  openDoorTarget: string | null = null,
) {
  return [
    ...exteriorColliders(
      routes,
      doorAwareBuildingColliders(openDoorTarget),
    ),
    ...traversalBlockerColliders(),
  ];
}

test("exterior builder preserves every current adapter source id in order", () => {
  const colliders = liveExteriorColliders();
  const outdoor = buildOutdoorCollisionParts(colliders);
  const densityTraversal = buildDensityTraversalRegistrations();
  const built = buildExteriorGameplayCollision({ colliders });

  const expectedBlockerIds = [
    ...colliders
      .filter(
        (collider) =>
          !isLegacyPropCollider(collider) &&
          !isLegacyDensityBarrierCollider(collider) &&
          !isLegacyTraversalCollider(collider),
      )
      .map(
        ([x, z, halfX, halfZ]) =>
          `legacy:${x}:${z}:${halfX}:${halfZ}`,
      ),
    ...outdoor.blockers.map((blocker) => blocker.id),
    ...densityTraversal.flatMap((registration) =>
      registration.blockers.map((blocker) => blocker.id),
    ),
  ];
  const expectedPlatformIds = [
    ...TRAVERSAL_SET.roofZones.map((zone) => zone.id),
    ...outdoor.platforms.map((platform) => platform.id),
    ...densityTraversal.flatMap((registration) =>
      registration.platforms.map((platform) => platform.id),
    ),
  ];
  assert.deepEqual(
    built.blockers.map((blocker) => blocker.id),
    expectedBlockerIds,
  );
  assert.deepEqual(
    built.platforms.map((platform) => platform.id),
    expectedPlatformIds,
  );
});

test("closed and open semantic door fixtures produce matching LOS", () => {
  const doorway = doorwayForTarget("MERCER_PRESS");
  assert.ok(doorway);
  const exterior = {
    x: doorway!.leafCenter[0] + doorway!.outwardNormal[0],
    y: 1,
    z: doorway!.leafCenter[2] + doorway!.outwardNormal[2],
  };
  const interior = {
    x: doorway!.leafCenter[0] - doorway!.outwardNormal[0],
    y: 1,
    z: doorway!.leafCenter[2] - doorway!.outwardNormal[2],
  };
  const closed = buildGameplayWorld({
    exterior: {
      colliders: liveExteriorColliders({}, null),
      includeDensity: false,
    },
    activeSpace: EXTERIOR_GAMEPLAY_SPACE,
  });
  const opened = buildGameplayWorld({
    exterior: {
      colliders: liveExteriorColliders({}, "MERCER_PRESS"),
      includeDensity: false,
    },
    activeSpace: EXTERIOR_GAMEPLAY_SPACE,
  });
  assert.equal(closed.segmentClear(exterior, interior), false);
  assert.equal(opened.segmentClear(exterior, interior), true);
});

test("route unlock removes both measured blocker id and LOS occlusion", () => {
  const closed = buildGameplayWorld({
    exterior: {
      colliders: liveExteriorColliders(),
      includeDensity: false,
    },
    activeSpace: EXTERIOR_GAMEPLAY_SPACE,
  });
  const opened = buildGameplayWorld({
    exterior: {
      colliders: liveExteriorColliders({
        THOMAS_DOCK_ROUTE: "UNLOCKED",
      }),
      includeDensity: false,
    },
    activeSpace: EXTERIOR_GAMEPLAY_SPACE,
  });
  const routePrefix = "prop:fence-gate:-40:0:22.6/";
  assert.ok(closed.blockerIds.some((id) => id.startsWith(routePrefix)));
  assert.ok(!opened.blockerIds.some((id) => id.startsWith(routePrefix)));
  const a = { x: -42, y: 1, z: 22.6 };
  const b = { x: -37.2, y: 1, z: 22.6 };
  assert.equal(closed.segmentClear(a, b), false);
  assert.equal(opened.segmentClear(a, b), true);
});

test("density toggle atomically includes measured and traversal density collision", () => {
  const colliders = liveExteriorColliders();
  const enabled = buildExteriorGameplayCollision({
    colliders,
    includeDensity: true,
  });
  const disabled = buildExteriorGameplayCollision({
    colliders,
    includeDensity: false,
  });
  const densityOwned = (item: { tags: ReadonlySet<string> }) =>
    item.tags.has("density");
  assert.ok(enabled.blockers.some(densityOwned));
  assert.ok(enabled.platforms.some(densityOwned));
  assert.ok(!disabled.blockers.some(densityOwned));
  assert.ok(!disabled.platforms.some(densityOwned));
  assert.ok(enabled.blockers.length > disabled.blockers.length);
  assert.ok(enabled.platforms.length > disabled.platforms.length);
});

test("active isolated interior selects wall and furniture ids, then swaps cleanly", () => {
  const exterior: CollisionWorld = {
    blockers: [wallFromRect("exterior-wall", 0, 0, 0.2, 2)],
    platforms: [],
    bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
  };
  const roomA: CollisionWorld = {
    blockers: [
      wallFromRect("ROOM_A:wall-left", -2, 0, 0.1, 3, {
        topY: 3,
        tags: ["interior", "wall"],
      }),
      wallFromOrientedRect(
        "ROOM_A:prop:table",
        0,
        0,
        0.8,
        0.4,
        Math.PI / 5,
        {
          topY: 1,
          tags: ["interior", "furniture"],
        },
      ),
    ],
    platforms: [],
    bounds: { minX: -3, maxX: 3, minZ: -3, maxZ: 3 },
  };
  const roomB: CollisionWorld = {
    blockers: [wallFromRect("ROOM_B:wall-back", 0, 2, 3, 0.1, { topY: 3 })],
    platforms: [],
    bounds: { minX: -3, maxX: 3, minZ: -3, maxZ: 3 },
  };
  const interiors = { ROOM_A: roomA, ROOM_B: roomB };
  const roomAService = buildGameplayWorld({
    exterior,
    activeSpace: interiorGameplaySpace("ROOM_A"),
    interiors,
  });
  assert.equal(roomAService.collision, roomA);
  assert.deepEqual(roomAService.blockerIds, [
    "ROOM_A:wall-left",
    "ROOM_A:prop:table",
  ]);
  assert.deepEqual(
    roomAService.segmentOccluderIds(
      { x: -2.5, y: 0.5, z: 0 },
      { x: 1.5, y: 0.5, z: 0 },
    ),
    ["ROOM_A:wall-left", "ROOM_A:prop:table"],
  );

  const roomBService = buildGameplayWorld({
    exterior,
    activeSpace: interiorGameplaySpace("ROOM_B"),
    interiors,
  });
  assert.equal(roomBService.collision, roomB);
  assert.deepEqual(roomBService.blockerIds, ["ROOM_B:wall-back"]);
  assert.equal(
    roomBService.segmentClear(
      { x: -2.5, y: 0.5, z: 0 },
      { x: 1.5, y: 0.5, z: 0 },
    ),
    true,
  );
});

test("all 36 authored isolated interior worlds bind without remapping ids", () => {
  const exterior: CollisionWorld = {
    blockers: [],
    platforms: [],
    bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
  };
  const interiors = new Map(
    INTERIOR_IDS.map((id) => {
      const def = interiorDef(id);
      assert.ok(def);
      return [id, buildInteriorCollisionWorld(def!)] as const;
    }),
  );
  assert.equal(interiors.size, 36);
  for (const id of INTERIOR_IDS) {
    const selected = buildGameplayWorld({
      exterior,
      activeSpace: interiorGameplaySpace(id),
      interiors,
    });
    assert.equal(selected.collision, interiors.get(id));
    assert.ok(selected.blockerIds.length >= 6);
    assert.ok(
      selected.blockerIds.every((blockerId) => blockerId.startsWith(`${id}:`)),
      `${id} source ids were remapped`,
    );
  }
});

test("missing interior collision fails closed instead of using exterior", () => {
  const exterior: CollisionWorld = {
    blockers: [],
    platforms: [],
    bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
  };
  assert.throws(
    () =>
      buildGameplayWorld({
        exterior,
        activeSpace: interiorGameplaySpace("MISSING"),
        interiors: {},
      }),
    /missing collision world for interior MISSING/,
  );
});
