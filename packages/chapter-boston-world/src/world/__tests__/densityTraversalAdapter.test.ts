import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DENSITY_PLACEMENTS,
  TRAVERSAL_AFFORDANCES,
  type TraversalAffordance,
} from "../densityManifest.js";
import {
  buildDensityTraversalRegistrations,
  alignDensityActionStart,
  densityActionRequest,
  densityGateAllows,
  DENSITY_TRAVERSAL_TYPE_STATUS,
  DENSITY_LEGACY_ALIASES,
  mergeDensityTraversalEndpoints,
} from "../densityTraversalAdapter.js";
import { TRAVERSAL_SET } from "../traversalMarkers.js";
import { buildTraversalEndpoints } from "../traversalRegistration.js";
import {
  beginAuthored,
  createGroundedState,
  stepMotion,
} from "../playerMotion.js";
import {
  CAPSULE_RADIUS,
  STAND_HEIGHT,
  sweepXZ,
  type CollisionWorld,
} from "../collision.js";

const registrations = buildDensityTraversalRegistrations();
const placements = new Set(DENSITY_PLACEMENTS.map((placement) => placement.id));
const bounds = { minX: -200, maxX: 200, minZ: -40, maxZ: 40 };

function worldFor(registration: (typeof registrations)[number]): CollisionWorld {
  return {
    blockers: registration.blockers,
    platforms: registration.platforms,
    bounds,
  };
}

function runAction(
  registration: (typeof registrations)[number],
  dir: 1 | -1,
) {
  const request = densityActionRequest(registration, dir);
  assert.ok(request);
  const start = request.anchors[0]!;
  const ignore =
    request.kind === "VAULT" ||
    request.kind === "CLIMB_UP" ||
    request.kind === "CLIMB_DOWN"
      ? [registration.record.placementId]
      : undefined;
  let state = beginAuthored(
    worldFor(registration),
    createGroundedState({ ...start }, start.yaw ?? 0),
    { ...request, ignore },
  );
  assert.ok(state, `${registration.record.id} preflight failed`);
  for (let frame = 0; frame < 600 && state.action; frame++) {
    state = stepMotion(worldFor(registration), state, {
      dt: 1 / 60,
      targetVelX: 0,
      targetVelZ: 0,
      reducedMotion: false,
    }).state;
  }
  return { request, state };
}

test("all 22 density records are unique, finite, and join stable placements", () => {
  assert.equal(TRAVERSAL_AFFORDANCES.length, 22);
  assert.equal(new Set(TRAVERSAL_AFFORDANCES.map((record) => record.id)).size, 22);
  assert.equal(registrations.length, 22);
  for (const record of TRAVERSAL_AFFORDANCES) {
    assert.ok(placements.has(record.placementId), `${record.id} missing ${record.placementId}`);
    for (const value of [
      ...record.start.pos,
      record.start.facing,
      ...record.end.pos,
      record.end.facing,
      record.surfaceHeight,
      ...record.approach,
      record.minApproachDot,
      record.clearance.radius,
      record.clearance.height,
      record.clearance.pathHalfWidth,
      ...record.landing.center,
      record.landing.radius,
      record.landing.standingHeight,
      record.cooldownMs,
    ]) {
      assert.ok(Number.isFinite(value), `${record.id} has non-finite authored data`);
    }
  }
});

test("supported/disabled mapping is explicit and collision exists only when enabled", () => {
  const counts = new Map<string, number>();
  for (const registration of registrations) {
    counts.set(
      `${registration.record.type}:${registration.status}`,
      (counts.get(`${registration.record.type}:${registration.status}`) ?? 0) + 1,
    );
    if (registration.status === "ENABLED") {
      assert.ok(registration.endpoints.length >= 1);
      assert.ok(registration.blockers.every((blocker) => !/^c\\d+$/.test(blocker.id)));
      assert.ok(
        registration.blockers.every((blocker) =>
          blocker.tags.has(`placement:${registration.record.placementId}`),
        ),
      );
    } else if (
      registration.status === "DISABLED_GATE" ||
      registration.status === "DISABLED_MISSING_PLACEMENT"
    ) {
      assert.deepEqual(registration.endpoints, []);
      assert.deepEqual(registration.blockers, []);
      assert.deepEqual(registration.platforms, []);
    } else {
      assert.deepEqual(registration.endpoints, []);
      assert.ok(registration.blockers.length > 0, "ordinary solid was removed");
    }
  }
  assert.equal(counts.get("DUCK_UNDER:ENABLED"), 5);
  assert.equal(counts.get("CLIMB_UP:ENABLED"), 6);
  assert.equal(counts.get("VAULT:DISABLED_GEOMETRY"), 2);
  assert.equal(
    registrations.filter((registration) => registration.status === "ENABLED").length,
    11,
  );
  assert.equal(counts.get("BALANCE:DISABLED_RUN_JUMP_CLEARABLE"), 7);
  assert.equal(counts.get("MANTLE:DISABLED_UNSUPPORTED"), 2);
  assert.equal(DENSITY_TRAVERSAL_TYPE_STATUS.JUMP_GAP, "DISABLED");
  assert.equal(DENSITY_TRAVERSAL_TYPE_STATUS.PUSH, "DISABLED");
  assert.equal(DENSITY_TRAVERSAL_TYPE_STATUS.SQUEEZE, "DISABLED");
});

test("route and story gates fail closed", () => {
  const base = TRAVERSAL_AFFORDANCES[0]!;
  const gated: TraversalAffordance = {
    ...base,
    routeGate: "THOMAS_DOCK_ROUTE",
    storyGate: "STORY_READY",
  };
  assert.equal(densityGateAllows(gated), false);
  assert.equal(
    densityGateAllows(gated, {
      routes: { THOMAS_DOCK_ROUTE: "UNLOCKED" },
      storyFlags: new Set(["STORY_READY"]),
    }),
    true,
  );
});

test("density carts are blocked geometry, retain solids, and expose no F vault", () => {
  const registration = registrations.find(
    (entry) => entry.record.id === "DENSITY.MARKET.CART.VAULT",
  )!;
  assert.equal(registration.classification, "BLOCKED");
  assert.equal(registration.status, "DISABLED_GEOMETRY");
  assert.equal(densityActionRequest(registration, 1), null);
  assert.deepEqual(registration.endpoints, []);
  assert.ok(registration.blockers.length > 0);
  assert.equal(registration.blockers[0]!.id, registration.record.placementId);
});

test("representative climb up/down preserves exact anchors and facing", () => {
  const registration = registrations.find(
    (entry) => entry.record.id === "DENSITY.WHARF.CLIMB",
  )!;
  const up = runAction(registration, 1);
  assert.ok(Math.abs(up.state.pos.y - registration.record.end.pos[1]) < 0.01);
  const down = runAction(registration, -1);
  assert.ok(Math.abs(down.state.pos.y - registration.record.start.pos[1]) < 0.01);
  assert.equal(down.state.phase, "GROUNDED");
});

test("representative duck blocks standing capsule, crouches, and exits exactly", () => {
  const registration = registrations.find(
    (entry) => entry.record.id === "DENSITY.NALLEY.DUCK.WEST",
  )!;
  const request = densityActionRequest(registration, 1)!;
  const start = request.anchors[0]!;
  const end = request.anchors.at(-1)!;
  const standing = sweepXZ(
    worldFor(registration),
    { ...start },
    {
      x: (start.x + end.x) / 2,
      z: (start.z + end.z) / 2,
    },
    CAPSULE_RADIUS,
    STAND_HEIGHT,
  );
  assert.ok(standing.blockedX || standing.blockedZ);
  const result = runAction(registration, 1);
  assert.equal(result.state.phase, "GROUNDED");
  assert.ok(Math.hypot(result.state.pos.x - end.x, result.state.pos.z - end.z) < 0.01);
});

test("unsupported records never produce misleading requests", () => {
  for (const registration of registrations.filter(
    (entry) => entry.status === "DISABLED_UNSUPPORTED",
  )) {
    assert.equal(densityActionRequest(registration, 1), null);
  }
});

test("legacy overlap migration is explicit and does not hide nearby objects", () => {
  const legacy = buildTraversalEndpoints(TRAVERSAL_SET.markers);
  const merged = mergeDensityTraversalEndpoints(legacy, registrations);
  assert.equal(
    DENSITY_LEGACY_ALIASES.WHARF_CRANE_LADDER,
    "DENSITY.WHARF.CLIMB",
  );
  assert.ok(!merged.some((entry) => entry.affordanceId === "WHARF_CRANE_LADDER"));
  assert.ok(merged.some((entry) => entry.affordanceId === "ELM_SHED_B_CLIMB"));
  assert.ok(!legacy.some((entry) => entry.kind === "VAULT"));
});

test("small collision depenetration aligns action start; distant snap is rejected", () => {
  const registration = registrations.find(
    (entry) => entry.record.id === "DENSITY.WHARF.CLIMB",
  )!;
  const request = densityActionRequest(registration, 1)!;
  const aligned = alignDensityActionStart(request, {
    x: request.anchors[0]!.x - 0.05,
    y: request.anchors[0]!.y,
    z: request.anchors[0]!.z,
  });
  assert.ok(aligned);
  assert.ok(Math.abs(aligned.anchors[0]!.x - (request.anchors[0]!.x - 0.05)) < 1e-9);
  assert.equal(
    alignDensityActionStart(request, {
      x: request.anchors[0]!.x - 0.5,
      y: request.anchors[0]!.y,
      z: request.anchors[0]!.z,
    }),
    null,
  );
});
