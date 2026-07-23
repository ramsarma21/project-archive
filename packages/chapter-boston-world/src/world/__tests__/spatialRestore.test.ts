import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSpatialRestore } from "../spatialRestore.js";
import { EXPLORE_LOCATIONS, LOCATIONS } from "../manifest.js";
import { thresholdAnchorForLocation } from "../doorwayContract.js";

// Feel-audit-1 P0-11 regression: resume must restore the persisted presenter
// position when it matches the resumed context, with the interior-safety
// fallback, and never apply stale or out-of-bounds snapshots.

const street = LOCATIONS.BOSTON_STREET!;

test("exterior snapshot restores position and facing", () => {
  const decision = resolveSpatialRestore(
    { pos: [-140, 0, 4], yaw: 1.2, interiorId: null, locationId: "BOSTON_STREET" },
    street,
  );
  assert.ok(decision);
  assert.deepEqual(decision.pos, [-140, 0, 4]);
  assert.equal(decision.faceY, 1.2);
});

test("no snapshot -> authored anchor", () => {
  assert.equal(resolveSpatialRestore(null, street), null);
  assert.equal(resolveSpatialRestore(undefined, street), null);
});

test("location moved on since the snapshot -> authored anchor", () => {
  const decision = resolveSpatialRestore(
    { pos: [-140, 0, 4], yaw: 0, interiorId: null, locationId: "BOSTON_STREET" },
    LOCATIONS.LIBERTY_TREE_APPROACH!,
  );
  assert.equal(decision, null);
});

test("hero interiors keep their authored landing", () => {
  const decision = resolveSpatialRestore(
    { pos: [0, 0, 13.5], yaw: 0, interiorId: "MERCER_PRESS", locationId: "MERCER_PRESS" },
    LOCATIONS.MERCER_PRESS!,
  );
  assert.equal(decision, null);
});

test("explore-interior snapshot falls back to just outside its door", () => {
  const tavern = EXPLORE_LOCATIONS.EXPLORE_tavern!;
  const decision = resolveSpatialRestore(
    {
      pos: [999, 0, 999], // isolated interior slot coords: never used directly
      yaw: 0,
      interiorId: "EXPLORE_tavern",
      locationId: "BOSTON_STREET",
    },
    street,
  );
  assert.ok(decision);
  const outside = thresholdAnchorForLocation(tavern, "OUTSIDE");
  assert.deepEqual(decision.pos, [outside[0], 0, outside[2]]);
});

test("out-of-bounds or non-finite snapshots are rejected", () => {
  for (const pos of [
    [9999, 0, 0],
    [0, 0, -9999],
    [Number.NaN, 0, 0],
    [0, 40, 0],
  ] as [number, number, number][]) {
    assert.equal(
      resolveSpatialRestore(
        { pos, yaw: 0, interiorId: null, locationId: "BOSTON_STREET" },
        street,
      ),
      null,
      `pos ${String(pos)} must be rejected`,
    );
  }
});
