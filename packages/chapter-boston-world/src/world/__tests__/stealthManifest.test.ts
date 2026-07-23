import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXTERIOR_CHASE_GRAPH,
  INSPECTOR_OFFICE,
  STEALTH_VOLUMES,
  interiorChaseGraph,
  pursuitPortalPolicy,
  volumesForSpace,
} from "../stealthManifest.js";

test("authored exterior route has street, alley, and corner candidates", () => {
  assert.ok(EXTERIOR_CHASE_GRAPH.waypoints.length >= 20);
  assert.ok(
    EXTERIOR_CHASE_GRAPH.waypoints.some((point) =>
      point.id.startsWith("NORTH_"),
    ),
  );
  assert.ok(
    EXTERIOR_CHASE_GRAPH.waypoints.some((point) =>
      point.id.startsWith("SOUTH_"),
    ),
  );
  for (const point of EXTERIOR_CHASE_GRAPH.waypoints) {
    assert.ok(point.links.length > 0, `${point.id} must connect`);
  }
});

test("semantic REFUGE and HIDE volumes are distinct and visibility-independent", () => {
  const exterior = volumesForSpace("EXTERIOR");
  assert.ok(exterior.some((volume) => volume.kind === "REFUGE"));
  assert.ok(exterior.some((volume) => volume.kind === "HIDE"));
  assert.ok(
    exterior.some(
      (volume) => volume.kind === "REFUGE" && volume.doorId !== undefined,
    ),
  );
  assert.ok(
    STEALTH_VOLUMES.every(
      (volume) =>
        Number.isFinite(volume.radius) &&
        volume.radius > 0 &&
        volume.center.length === 3,
    ),
  );
});

test("generic interiors transfer pursuit and get isolated-space routes", () => {
  assert.deepEqual(pursuitPortalPolicy("EXPLORE_rowN1"), {
    locationId: "EXPLORE_rowN1",
    mode: "TRANSFER",
    transferDelaySeconds: 1.4,
  });
  const graph = interiorChaseGraph({
    spaceId: "EXPLORE_rowN1",
    minX: 100,
    maxX: 110,
    minZ: 200,
    maxZ: 208,
    portal: [105, 0, 201],
  });
  assert.equal(graph.spaceId, "EXPLORE_rowN1");
  assert.equal(graph.waypoints[0]?.id, "PORTAL");
  assert.deepEqual(graph.waypoints[0]?.position, [105, 0, 201]);
  assert.equal(graph.waypoints.length, 5);
});

test("release anchor is data-only, validated, and distinct from Custom House", () => {
  assert.equal(INSPECTOR_OFFICE.locationId, "BOSTON_STREET");
  assert.equal(
    INSPECTOR_OFFICE.releaseAnchorId,
    "INSPECTOR_OFFICE_RELEASE",
  );
  // Watch house uses the north-row civic townhouse; Custom House is south at
  // z≈+14, so this north-side release cannot be mistaken for that doorway.
  assert.ok(INSPECTOR_OFFICE.releaseAnchor[2] < 0);
  assert.notEqual(INSPECTOR_OFFICE.buildingId, "customs");
});
