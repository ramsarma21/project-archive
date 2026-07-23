import { test } from "node:test";
import assert from "node:assert/strict";
import {
  platformFromRect,
  segmentClear,
  segmentOccluderIds,
  wallFromCapsule,
  wallFromOrientedRect,
  wallFromRect,
  type CollisionWorld,
} from "../collision.js";

const BOUNDS = { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };

function world(
  blockers: CollisionWorld["blockers"],
  platforms: CollisionWorld["platforms"] = [],
): CollisionWorld {
  return { blockers, platforms, bounds: BOUNDS };
}

test("LOS is clear in open space and platforms never occlude", () => {
  const queryWorld = world(
    [],
    [platformFromRect("roof", -2, 2, -2, 2, 1)],
  );
  assert.equal(
    segmentClear(
      queryWorld,
      { x: -3, y: 1, z: 0 },
      { x: 3, y: 1, z: 0 },
    ),
    true,
  );
});

test("full wall blocks continuously, including edge and endpoint contact", () => {
  const queryWorld = world([wallFromRect("wall", 0, 0, 0.5, 2)]);
  assert.equal(
    segmentClear(
      queryWorld,
      { x: -2, y: 1, z: 0 },
      { x: 2, y: 1, z: 0 },
    ),
    false,
  );
  assert.equal(
    segmentClear(
      queryWorld,
      { x: -2, y: 1, z: 2 },
      { x: 2, y: 1, z: 2 },
    ),
    false,
    "closed footprint edges occlude",
  );
  assert.equal(
    segmentClear(
      queryWorld,
      { x: -2, y: 1, z: 0 },
      { x: -0.5, y: 1, z: 0 },
    ),
    false,
    "an endpoint on the blocker face occludes",
  );
});

test("finite-height blockers honor the LOS vertical span", () => {
  const queryWorld = world([
    wallFromRect("crate", 0, 0, 0.5, 0.5, {
      baseY: 0,
      topY: 0.8,
    }),
    wallFromRect("beam", 3, 0, 0.5, 0.5, {
      baseY: 1.5,
      topY: 2,
    }),
  ]);
  assert.equal(
    segmentClear(
      queryWorld,
      { x: -2, y: 1.2, z: 0 },
      { x: 2, y: 1.2, z: 0 },
    ),
    true,
    "a chest-height segment clears a low obstacle",
  );
  assert.equal(
    segmentClear(
      queryWorld,
      { x: -2, y: 0.4, z: 0 },
      { x: 2, y: 0.4, z: 0 },
    ),
    false,
  );
  assert.equal(
    segmentClear(
      queryWorld,
      { x: 1, y: 1, z: 0 },
      { x: 5, y: 2.5, z: 0 },
    ),
    false,
    "a sloped segment is blocked only where horizontal and vertical intervals overlap",
  );
  assert.equal(
    segmentClear(
      queryWorld,
      { x: 1, y: 0.2, z: 0 },
      { x: 5, y: 1.4, z: 0 },
    ),
    true,
  );
});

test("yawed OBB LOS uses its exact footprint, not the broad AABB", () => {
  const board = wallFromOrientedRect(
    "board",
    0,
    0,
    2,
    0.1,
    Math.PI / 4,
    { topY: 2 },
  );
  const queryWorld = world([board]);
  assert.equal(
    segmentClear(
      queryWorld,
      { x: 1.2, y: 1, z: 1.2 },
      { x: 1.4, y: 1, z: 1.4 },
    ),
    true,
    "segment lies inside the broad AABB but outside the rotated board",
  );
  assert.equal(
    segmentClear(
      queryWorld,
      { x: -1, y: 1, z: 1 },
      { x: 1, y: 1, z: -1 },
    ),
    false,
  );
});

test("capsule-post LOS uses the exact capsule radius without query inflation", () => {
  const post = wallFromCapsule(
    "post",
    { x: 0, y: 0.1, z: 0 },
    { x: 0, y: 1.9, z: 0 },
    0.1,
  );
  const queryWorld = world([post]);
  assert.equal(
    segmentClear(
      queryWorld,
      { x: -1, y: 1, z: 0.1 },
      { x: 1, y: 1, z: 0.1 },
    ),
    false,
    "touching the capsule boundary occludes",
  );
  assert.equal(
    segmentClear(
      queryWorld,
      { x: -1, y: 1, z: 0.1001 },
      { x: 1, y: 1, z: 0.1001 },
    ),
    true,
    "LOS is not inflated by the player capsule radius",
  );
});

test("ignore sets remove only the named source collider", () => {
  const queryWorld = world([
    wallFromRect("near", -1, 0, 0.2, 1),
    wallFromRect("far", 1, 0, 0.2, 1),
  ]);
  const a = { x: -2, y: 1, z: 0 };
  const b = { x: 2, y: 1, z: 0 };
  assert.deepEqual(segmentOccluderIds(queryWorld, a, b), ["near", "far"]);
  assert.deepEqual(
    segmentOccluderIds(queryWorld, a, b, new Set(["near"])),
    ["far"],
  );
  assert.equal(
    segmentClear(queryWorld, a, b, new Set(["near", "far"])),
    true,
  );
});
