import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARRIVAL_DWELL_MS,
  SELECT_CONFIRM_MS,
  DISTANCE_SCALE_BASE_M,
  HERO_SCALE_MAX,
  SEAL_SCALE_MAX,
  arrivalReady,
  distanceScale,
  farLabel,
  markerState,
  pickActiveTargetId,
  planarDistance,
  projectedEdge,
  type SafeArea,
} from "../questMarkerResolver.js";

const SAFE: SafeArea = { left: 0.08, right: 0.08, top: 0.1, bottom: 0.16 };

test("planarDistance ignores Y (planar XZ only)", () => {
  assert.equal(planarDistance(0, 0, 3, 4), 5);
});

test("distanceScale: 1x within base, sqrt growth beyond, clamped per part", () => {
  assert.equal(distanceScale(0, "HERO"), 1);
  assert.equal(distanceScale(DISTANCE_SCALE_BASE_M, "HERO"), 1);
  // 4x base -> sqrt(4)=2, clamped to hero max 1.6
  assert.equal(distanceScale(DISTANCE_SCALE_BASE_M * 4, "HERO"), HERO_SCALE_MAX);
  // seal is clamped tighter
  assert.equal(distanceScale(DISTANCE_SCALE_BASE_M * 4, "SEAL"), SEAL_SCALE_MAX);
  // mid-range grows but stays under the cap
  const mid = distanceScale(DISTANCE_SCALE_BASE_M * 1.44, "HERO"); // sqrt(1.44)=1.2
  assert.ok(Math.abs(mid - 1.2) < 1e-9);
});

test("pickActiveTargetId: selection wins; else sole forced gold; else none", () => {
  const many = [
    { targetId: "A", forcedGold: false },
    { targetId: "B", forcedGold: false },
    { targetId: "C", forcedGold: false },
  ];
  assert.equal(pickActiveTargetId(many, null), null, "four available -> none active");
  assert.equal(pickActiveTargetId(many, "B"), "B", "selection wins");
  // stale selection not in the target set is ignored
  assert.equal(pickActiveTargetId(many, "Z"), null);
  const oneGold = [
    { targetId: "A", forcedGold: false },
    { targetId: "B", forcedGold: true },
  ];
  assert.equal(pickActiveTargetId(oneGold, null), "B", "sole forced gold is active");
  const twoGold = [
    { targetId: "A", forcedGold: true },
    { targetId: "B", forcedGold: true },
  ];
  assert.equal(pickActiveTargetId(twoGold, null), null, "no single gold -> none");
});

test("markerState transitions across thresholds", () => {
  const base = { eligible: true, active: true, nearM: 6, arrivalM: 1.35 };
  assert.equal(markerState({ ...base, eligible: false, distanceM: 3 }), "HIDDEN");
  assert.equal(
    markerState({ ...base, active: false, distanceM: 30 }),
    "AVAILABLE",
    "unselected is always AVAILABLE regardless of distance",
  );
  assert.equal(markerState({ ...base, distanceM: 20 }), "ACTIVE");
  assert.equal(markerState({ ...base, distanceM: 5 }), "NEARBY");
  assert.equal(markerState({ ...base, distanceM: 1.0 }), "ARRIVING");
  // boundary: exactly at arrival radius is ARRIVING, exactly at near is NEARBY
  assert.equal(markerState({ ...base, distanceM: 1.35 }), "ARRIVING");
  assert.equal(markerState({ ...base, distanceM: 6 }), "NEARBY");
});

test("arrivalReady requires dwell AND confirmation window", () => {
  assert.equal(
    arrivalReady({ insideArrival: false, dwellMs: 9999, msSinceSelection: 9999 }),
    false,
    "outside radius never arrives",
  );
  assert.equal(
    arrivalReady({ insideArrival: true, dwellMs: ARRIVAL_DWELL_MS - 1, msSinceSelection: 9999 }),
    false,
    "too little dwell",
  );
  assert.equal(
    arrivalReady({ insideArrival: true, dwellMs: 9999, msSinceSelection: SELECT_CONFIRM_MS - 1 }),
    false,
    "selection not yet confirmed (walk-in select)",
  );
  assert.equal(
    arrivalReady({ insideArrival: true, dwellMs: ARRIVAL_DWELL_MS, msSinceSelection: SELECT_CONFIRM_MS }),
    true,
  );
});

test("farLabel formats rounded whole metres", () => {
  assert.equal(farLabel("Mercer's Press", 34.4), "Mercer's Press \u00b7 34m");
  assert.equal(farLabel("X", -3), "X \u00b7 0m");
});

test("projectedEdge: on-screen reports true and passes through position", () => {
  const r = projectedEdge({ ndcX: 0, ndcY: 0, behindCamera: false, safe: SAFE });
  assert.equal(r.onScreen, true);
  assert.ok(Math.abs(r.x - 0.5) < 1e-9 && Math.abs(r.y - 0.5) < 1e-9);
});

test("projectedEdge: off-screen right clamps x to the safe right edge", () => {
  const r = projectedEdge({ ndcX: 2, ndcY: 0, behindCamera: false, safe: SAFE });
  assert.equal(r.onScreen, false);
  assert.ok(Math.abs(r.x - (1 - SAFE.right)) < 1e-9, "clamped to safe right");
  assert.ok(Math.abs(r.y - 0.5) < 1e-9, "stays vertically centered");
  assert.ok(Math.abs(r.angleRad - 0) < 1e-9, "points right");
});

test("projectedEdge: off-screen top clamps y to the safe top edge", () => {
  // ndcY positive is up -> screen top -> sy < 0.5
  const r = projectedEdge({ ndcX: 0, ndcY: 2, behindCamera: false, safe: SAFE });
  assert.equal(r.onScreen, false);
  assert.ok(Math.abs(r.y - SAFE.top) < 1e-9);
});

test("projectedEdge: behind-camera is never on-screen and flips direction", () => {
  // A point that projects to screen-center NDC but is behind the camera must
  // be treated as off-screen; flipping keeps the wedge leading correctly.
  const behind = projectedEdge({ ndcX: 0.5, ndcY: 0, behindCamera: true, safe: SAFE });
  assert.equal(behind.onScreen, false);
  // flipped nx = -0.5 -> sx < 0.5 -> wedge points left
  assert.ok(behind.x <= 0.5);
});
