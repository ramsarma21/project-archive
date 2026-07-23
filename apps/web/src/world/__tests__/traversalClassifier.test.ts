import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyTraversalGeometry,
  resolveClimbApproach,
  resolveVaultApproach,
  DEFAULT_TRAVERSAL_CLASSIFIER_CONFIG,
  type GeometryWorld,
  type ObstacleObb,
  type TraversalProfile,
} from "../traversalClassifier.js";
import {
  wallFromRect,
  type CollisionWorld,
} from "../collision.js";
import {
  RUNNING_JUMP_VY,
  RUN_SPEED,
  simulateBallistic,
} from "../playerMotion.js";

const bounds = { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };

function profile(
  obstacle: Partial<ObstacleObb> = {},
  options: Partial<TraversalProfile> = {},
): TraversalProfile {
  return {
    obstacle: {
      id: "target",
      centerX: 0,
      centerZ: 0,
      halfX: 0.4,
      halfZ: 1,
      yaw: 0,
      height: 0.6,
      ...obstacle,
    },
    hasReachableTop: false,
    topY: obstacle.height ?? 0.6,
    standingHeadroom: 4,
    ...options,
  };
}

function world(blockers: ObstacleObb[] = []): GeometryWorld {
  return { bounds, blockers };
}

test("short/shallow geometry is Shift+Space clearable and has no F class", () => {
  const item = profile();
  assert.equal(
    classifyTraversalGeometry(item, world([item.obstacle])),
    "RUN_JUMP_CLEARABLE",
  );
  const collision: CollisionWorld = {
    blockers: [
      wallFromRect("target", 0, 0, item.obstacle.halfX, item.obstacle.halfZ, {
        topY: item.obstacle.height,
        landable: false,
      }),
    ],
    platforms: [],
    bounds,
  };
  const prediction = simulateBallistic(
    collision,
    { x: -2, y: 0, z: 0 },
    { x: RUN_SPEED, y: RUNNING_JUMP_VY, z: 0 },
    undefined,
  );
  assert.ok(prediction.valid && prediction.pos.x > item.obstacle.halfX);
});

test("too tall for run jump but inside vault envelope requires F vault", () => {
  const item = profile({
    halfX: 0.55,
    halfZ: 1.5,
    height: DEFAULT_TRAVERSAL_CLASSIFIER_CONFIG.vaultMaxHeight,
  });
  assert.equal(
    classifyTraversalGeometry(item, world([item.obstacle])),
    "VAULT_REQUIRED",
  );
});

test("reachable tall support climbs; unsupported tall solid blocks", () => {
  const climb = profile(
    { halfX: 0.5, halfZ: 0.7, height: 2.4 },
    {
      hasReachableTop: true,
      topY: 2.4,
      topLanding: [0, 0],
      standingHeadroom: 2,
    },
  );
  assert.equal(
    classifyTraversalGeometry(climb, world([climb.obstacle])),
    "CLIMB_REQUIRED",
  );
  assert.equal(
    classifyTraversalGeometry(
      { ...climb, hasReachableTop: false },
      world([climb.obstacle]),
    ),
    "BLOCKED",
  );
});

test("dynamic vault resolves all eight approach sectors without overshoot", () => {
  const item = profile({
    halfX: 0.55,
    halfZ: 0.55,
    height: DEFAULT_TRAVERSAL_CLASSIFIER_CONFIG.vaultMaxHeight,
  });
  const geometryWorld = world([item.obstacle]);
  for (let degrees = 0; degrees < 360; degrees += 45) {
    const angle = (degrees * Math.PI) / 180;
    const x = Math.cos(angle) * 2;
    const z = Math.sin(angle) * 2;
    const plan = resolveVaultApproach(item, x, z, geometryWorld);
    assert.ok(plan, `${degrees}° did not resolve`);
    assert.ok(
      plan.totalDistance <=
        DEFAULT_TRAVERSAL_CLASSIFIER_CONFIG.vaultMaxDistance,
    );
    const towardPlayer =
      plan.normalX * (x - item.obstacle.centerX) +
      plan.normalZ * (z - item.obstacle.centerZ);
    assert.ok(towardPlayer > 0, `${degrees}° selected the back face`);
  }
});

test("blocked landing suppresses one face while adjacent corner face remains", () => {
  const item = profile({
    halfX: 0.55,
    halfZ: 0.55,
    height: DEFAULT_TRAVERSAL_CLASSIFIER_CONFIG.vaultMaxHeight,
  });
  const westLandingBlocker: ObstacleObb = {
    id: "west-blocker",
    centerX: -1.5,
    centerZ: 0,
    halfX: 0.5,
    halfZ: 0.5,
    yaw: 0,
    height: 2,
  };
  const plan = resolveVaultApproach(
    item,
    2,
    1.8,
    world([item.obstacle, westLandingBlocker]),
  );
  assert.ok(plan);
  assert.notEqual(plan.face, "POS_X");
});

test("rotated long OBB chooses a safe shallow face", () => {
  const item = profile({
    halfX: 2.5,
    halfZ: 0.5,
    yaw: Math.PI / 4,
    height: DEFAULT_TRAVERSAL_CLASSIFIER_CONFIG.vaultMaxHeight,
  });
  assert.equal(
    classifyTraversalGeometry(item, world([item.obstacle])),
    "VAULT_REQUIRED",
  );
  const plan = resolveVaultApproach(item, 2, -2, world([item.obstacle]));
  assert.ok(plan);
  assert.ok(plan.crossingDepth <= 1.01);
});

test("out-of-bounds opposite landing blocks only affected sides", () => {
  const item = profile({
    centerX: 18.8,
    halfX: 0.5,
    halfZ: 0.5,
    height: DEFAULT_TRAVERSAL_CLASSIFIER_CONFIG.vaultMaxHeight,
  });
  const plan = resolveVaultApproach(item, 17, 0, world([item.obstacle]));
  assert.ok(plan);
  assert.notEqual(plan.face, "NEG_X");
});

test("freestanding climb resolves every approach; facade restriction blocks back", () => {
  const item = profile(
    { halfX: 0.6, halfZ: 0.6, height: 2.4 },
    {
      hasReachableTop: true,
      topY: 2.4,
      topLanding: [0, 0],
      standingHeadroom: 2,
    },
  );
  for (let degrees = 0; degrees < 360; degrees += 45) {
    const angle = (degrees * Math.PI) / 180;
    const plan = resolveClimbApproach(
      item,
      Math.cos(angle) * 2,
      Math.sin(angle) * 2,
      world([item.obstacle]),
    );
    assert.ok(plan, `${degrees}° freestanding climb did not resolve`);
  }
  const frontOnly = resolveClimbApproach(
    item,
    -2,
    0,
    world([item.obstacle]),
    ["POS_X"],
  );
  assert.equal(frontOnly, null);
  assert.equal(
    resolveClimbApproach(item, 2, 0, world([item.obstacle]), ["POS_X"])?.face,
    "POS_X",
  );
});
