import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAPSULE_RADIUS,
  CROUCH_HEIGHT,
  STAND_HEIGHT,
  depenetrateXZ,
  positionClear,
  sweepXZ,
  wallFromCapsule,
  wallFromOrientedRect,
  type CollisionWorld,
} from "../collision.js";
import {
  buildOutdoorCollisionParts,
  isLegacyDensityBarrierCollider,
  isLegacyPropCollider,
  isLegacyTraversalCollider,
  routeBlockerMatrix,
} from "../outdoorCollisionAdapter.js";
import { exteriorColliders, PROPS } from "../manifest.js";
import { TRAVERSAL_AFFORDANCES } from "../densityManifest.js";

const BOUNDS = { minX: -200, maxX: 200, minZ: -50, maxZ: 50 };

function worldFromParts(
  parts: ReturnType<typeof buildOutdoorCollisionParts>,
): CollisionWorld {
  return { blockers: parts.blockers, platforms: parts.platforms, bounds: BOUNDS };
}

test("yawed OBB and capsule footprints collide in local space, not broad AABBs", () => {
  const obb = wallFromOrientedRect(
    "yawed",
    0,
    0,
    2,
    0.1,
    Math.PI / 4,
    { topY: 1.2 },
  );
  const post = wallFromCapsule(
    "post",
    { x: 4, y: 0.1, z: 0 },
    { x: 4, y: 1.9, z: 0 },
    0.1,
  );
  const world: CollisionWorld = {
    blockers: [obb, post],
    platforms: [],
    bounds: BOUNDS,
  };
  assert.equal(
    positionClear(world, { x: 1.2, y: 0, z: 1.2 }, 0.05, STAND_HEIGHT),
    true,
    "point inside OBB broad AABB but outside the thin rotated board must stay clear",
  );
  assert.equal(
    positionClear(world, { x: 0.7, y: 0, z: -0.7 }, 0.05, STAND_HEIGHT),
    false,
  );
  assert.equal(
    positionClear(world, { x: 4.15, y: 0, z: 0 }, 0.1, STAND_HEIGHT),
    false,
  );
});

test("adapter applies actual visual fit and yaw without nominal-slot inflation", () => {
  const parts = buildOutdoorCollisionParts(exteriorColliders({}));
  const cart = parts.blockers.find(
    (blocker) => blocker.id === "prop:hand-cart:11:0:-4/bed",
  );
  assert.ok(cart);
  assert.equal(cart.footprint?.kind, "obb");
  if (cart.footprint?.kind !== "obb") return;
  assert.ok(Math.abs(cart.footprint.yaw - 0.9) < 1e-9);
  assert.ok(Math.abs(cart.footprint.halfX - 1.1) < 0.001);
  assert.ok(Math.abs(cart.footprint.halfZ - 0.844) < 0.001);
  assert.ok(
    cart.footprint.halfX * 2 < 2.4,
    "cart body must exclude visibly empty handle/wheel slot space",
  );
});

test("compound market shapes collide posts/counter while canopy stays open", () => {
  const parts = buildOutdoorCollisionParts(exteriorColliders({}));
  const stallId = "prop:market-stall:-50:0:-6.5";
  const stall = parts.blockers.filter((blocker) =>
    blocker.tags.has(`placement:${stallId}`),
  );
  assert.deepEqual(
    stall.map((blocker) => blocker.id.split("/").at(-1)).sort(),
    ["counter", "post-l", "post-r"],
  );
  const awningId = "prop:market-awning:-45.2:0:-6.8";
  const awning = parts.blockers.filter((blocker) =>
    blocker.tags.has(`placement:${awningId}`),
  );
  assert.equal(awning.length, 4);
  assert.ok(awning.every((blocker) => blocker.footprint?.kind === "capsule"));
  assert.ok(
    awning.every((blocker) => !blocker.id.includes("canopy")),
    "awning cloth must never become a blocking box",
  );
});

test("finite barriers and profile classifications preserve open ground", () => {
  const parts = buildOutdoorCollisionParts(exteriorColliders({}));
  const fence = parts.blockers.find((blocker) =>
    blocker.id.startsWith("north-service-wall-1/"),
  );
  assert.ok(fence);
  assert.ok(Number.isFinite(fence.topY));
  assert.ok(fence.topY <= 2.1 + 1e-3);
  assert.ok(parts.solidPlacementCount > 150);
  assert.ok(parts.nonePlacementCount >= 1);
  assert.ok(parts.profiledPlacementCount <= parts.placementCount);
});

test("enabled traversal owners are deduped while unsupported balance keeps support", () => {
  const parts = buildOutdoorCollisionParts(exteriorColliders({}));
  const enabledIds = new Set(
    TRAVERSAL_AFFORDANCES.filter((record) =>
      ["VAULT", "CLIMB_UP", "CLIMB_DOWN", "DUCK_UNDER"].includes(record.type),
    ).map((record) => record.placementId),
  );
  assert.ok(
    parts.blockers.every((blocker) =>
      [...enabledIds].every(
        (id) => !blocker.tags.has(`placement:${id}`),
      ),
    ),
  );
  assert.ok(
    parts.platforms.some((platform) =>
      platform.tags.has("placement:traversal-north-balance-west"),
    ),
  );
  assert.equal(parts.skippedTraversalPlacementCount, enabledIds.size);
});

test("legacy prop/traversal slots are identified for replacement", () => {
  const prop = PROPS.find((candidate) => candidate.glb === "market-stall")!;
  const tuple = [
    prop.pos[0],
    prop.pos[2],
    prop.collide![0] / 2,
    prop.collide![1] / 2,
  ] as [number, number, number, number];
  assert.equal(isLegacyPropCollider(tuple), true);
  assert.equal(isLegacyTraversalCollider(tuple), false);
  assert.equal(
    isLegacyDensityBarrierCollider([-19, -26.5, 99, 0.5]),
    true,
    "nominal invisible alley slab must be replaced by imported density panels",
  );
  assert.equal(
    isLegacyDensityBarrierCollider([-118, -12.25, 1, 7.75]),
    true,
    "nominal gate wing must be replaced by aligned imported gate-wing assets",
  );
});

test("route blocker lifecycle is atomic and open route immediately traverses", () => {
  const closedLegacy = exteriorColliders({});
  const closed = buildOutdoorCollisionParts(closedLegacy);
  const closedRoute = routeBlockerMatrix(closedLegacy, closed)[0]!;
  assert.deepEqual(
    {
      state: closedRoute.state,
      visible: closedRoute.visible,
      colliding: closedRoute.colliding,
      valid: closedRoute.valid,
    },
    { state: "LOCKED", visible: true, colliding: true, valid: true },
  );
  const closedWorld = worldFromParts(closed);
  for (const height of [STAND_HEIGHT, CROUCH_HEIGHT]) {
    const hit = sweepXZ(
      closedWorld,
      { x: -42, y: 0, z: 22.6 },
      { x: -39.8, z: 22.6 },
      CAPSULE_RADIUS,
      height,
    );
    assert.ok(hit.blockedX || hit.blockedZ, `closed gate bypassed at height ${height}`);
  }

  const openLegacy = exteriorColliders({ THOMAS_DOCK_ROUTE: "UNLOCKED" });
  const open = buildOutdoorCollisionParts(openLegacy);
  const openRoute = routeBlockerMatrix(openLegacy, open)[0]!;
  assert.deepEqual(
    {
      state: openRoute.state,
      visible: openRoute.visible,
      colliding: openRoute.colliding,
      valid: openRoute.valid,
    },
    { state: "UNLOCKED", visible: false, colliding: false, valid: true },
  );
  const pass = sweepXZ(
    worldFromParts(open),
    { x: -42, y: 0, z: 22.6 },
    { x: -37.2, z: 22.6 },
    CAPSULE_RADIUS,
    STAND_HEIGHT,
  );
  assert.equal(pass.blockedX || pass.blockedZ, false);
});

test("bounded depenetration escapes a newly registered prop or rolls back cleanly", () => {
  const world: CollisionWorld = {
    blockers: [
      wallFromOrientedRect("new-prop", 0, 0, 0.3, 0.3, 0, {
        topY: 1,
      }),
    ],
    platforms: [],
    bounds: BOUNDS,
  };
  const recovered = depenetrateXZ(
    world,
    { x: 0, y: 0, z: 0 },
    CAPSULE_RADIUS,
    STAND_HEIGHT,
  );
  assert.ok(recovered);
  assert.ok(
    positionClear(world, recovered!, CAPSULE_RADIUS, STAND_HEIGHT),
  );
  assert.ok(Math.hypot(recovered!.x, recovered!.z) <= 0.8 + 1e-6);
});
