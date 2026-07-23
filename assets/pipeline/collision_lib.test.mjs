// Unit tests for the collision-metadata math (fit / bounds / hash / transform).
// Pure and web-source-free, so they run under `node --test` without touching
// any active runtime file.
//
// Run: node --test assets/pipeline/collision_lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sha256,
  fitScale,
  fittedSize,
  rawToFitLocal,
  rotateY,
  localToWorld,
  colliderAabb,
  fittedLocalBounds,
  extractArray,
  collectIssues,
} from "./collision_lib.mjs";

const approx = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const approxArr = (a, b, eps = 1e-6) => a.forEach((v, i) => approx(v, b[i], eps));

test("sha256 is stable + content-addressed", () => {
  assert.equal(sha256(Buffer.from("abc")), sha256(Buffer.from("abc")));
  assert.notEqual(sha256(Buffer.from("abc")), sha256(Buffer.from("abd")));
  assert.equal(sha256(Buffer.from("")).length, 64);
});

test("fitScale picks the min per-axis ratio (mirrors FittedGlb)", () => {
  // ropewalk: raw ~[0.99,0.91,1.9] into slot [22,7,8] -> z-constrained.
  const s = fitScale([0.99, 0.91, 1.9], [22, 7, 8]);
  approx(s, 8 / 1.9, 1e-9);
  const fit = fittedSize([0.99, 0.91, 1.9], s);
  approx(fit[0], 4.1684, 1e-3); // the audited ~4.17 wide
  approx(fit[2], 8, 1e-9);
});

test("fitScale falls back to raw scale with no target", () => {
  approx(fitScale([2, 2, 2], null, 1.6), 1.6);
  approx(fitScale([2, 2, 2], null), 1);
});

test("rawToFitLocal centers XZ and grounds Y", () => {
  const rawCenter = [5, 1, -3];
  const rawMin = [4, 0, -4];
  // raw center maps to (0, s*(cy-miny), 0)
  approxArr(rawToFitLocal([5, 1, -3], rawCenter, rawMin, 2), [0, 2 * (1 - 0), 0]);
  // a raw corner scales + recenters
  approxArr(rawToFitLocal([4, 0, -4], rawCenter, rawMin, 2), [-2, 0, -2]);
});

test("rotateY matches right-handed yaw", () => {
  approxArr(rotateY([1, 0, 0], Math.PI / 2), [0, 0, -1]);
  approxArr(rotateY([0, 5, 0], 1.234), [0, 5, 0]); // y preserved
  approxArr(rotateY([2, 0, 0], Math.PI), [-2, 0, 0]);
});

test("localToWorld = rotate about Y then translate", () => {
  const w = localToWorld([1, 0, 0], [10, 0, 20], Math.PI / 2);
  approxArr(w, [10, 0, 19]);
});

test("localToWorld round-trips through the inverse yaw", () => {
  const pos = [7, 0, -4];
  const yaw = 0.9;
  const local = [1.3, 2.1, -0.7];
  const world = localToWorld(local, pos, yaw);
  // undo translate, then rotate back by -yaw
  const back = rotateY([world[0] - pos[0], world[1] - pos[1], world[2] - pos[2]], -yaw);
  approxArr(back, local, 1e-9);
});

test("colliderAabb: axis-aligned box", () => {
  const box = colliderAabb({ shape: "box", center: [0, 1, 0], half: [2, 1, 0.5] });
  assert.deepEqual(box, { minX: -2, maxX: 2, minY: 0, maxY: 2, minZ: -0.5, maxZ: 0.5 });
});

test("colliderAabb: yawed box grows its footprint conservatively", () => {
  const box = colliderAabb({ shape: "box", center: [0, 0.5, 0], half: [1, 0.5, 0.2], yaw: Math.PI / 2 });
  approx(box.maxX, 0.2);
  approx(box.maxZ, 1);
});

test("colliderAabb: capsule expands by radius", () => {
  const cap = colliderAabb({ shape: "capsule", a: [0, 0.5, 0], b: [0, 1.5, 0], radius: 0.3 });
  assert.deepEqual(cap, { minX: -0.3, maxX: 0.3, minY: 0.2, maxY: 1.8, minZ: -0.3, maxZ: 0.3 });
});

test("colliderAabb: support polygon + y", () => {
  const sup = colliderAabb({ shape: "support", polygon: [[-1, -0.5], [1, -0.5], [1, 0.5], [-1, 0.5]], y: 0.2 });
  assert.deepEqual(sup, { minX: -1, maxX: 1, minY: 0.2, maxY: 0.2, minZ: -0.5, maxZ: 0.5 });
});

test("fittedLocalBounds is centered XZ + grounded", () => {
  const fb = fittedLocalBounds([4, 3, 2], 1);
  assert.deepEqual(
    { minX: fb.minX, maxX: fb.maxX, minY: fb.minY, maxY: fb.maxY, minZ: fb.minZ, maxZ: fb.maxZ },
    { minX: -2, maxX: 2, minY: 0, maxY: 3, minZ: -1, maxZ: 1 },
  );
  assert.deepEqual(fb.fittedSize, [4, 3, 2]);
});

test("extractArray reads a TS array literal past its type annotation", () => {
  const src = `export const BUILDINGS: BuildingDef[] = [\n  { id: "a", size: [1, 2, 3], rotY: Math.PI },\n];\n`;
  const arr = extractArray(src, "BUILDINGS");
  assert.equal(arr.length, 1);
  assert.equal(arr[0].id, "a");
  assert.deepEqual(arr[0].size, [1, 2, 3]);
  approx(arr[0].rotY, Math.PI);
});

test("extractArray handles nested brackets", () => {
  const src = `export const PROPS: PropDef[] = [\n  { glb: "x", pos: [[1,2],[3,4]], collide: [2.4, 1.6] },\n];`;
  const arr = extractArray(src, "PROPS");
  assert.deepEqual(arr[0].pos, [[1, 2], [3, 4]]);
  assert.deepEqual(arr[0].collide, [2.4, 1.6]);
});

// ---- validation rule-set (negative cases) ----------------------------------

function runIssues(asset) {
  const issues = [];
  collectIssues({ [asset.assetKey]: asset }, (severity, category, assetKey, message) =>
    issues.push({ severity, category, assetKey, message }),
  );
  return issues;
}
const cats = (issues, sev) => issues.filter((i) => i.severity === sev).map((i) => i.category);

const baseFitted = { minX: -2, maxX: 2, minY: 0, maxY: 3, minZ: -1, maxZ: 1 };
function asset(over = {}) {
  return {
    assetKey: "t",
    fileExists: true,
    hasSidecar: true,
    referencedInManifest: true,
    category: "prop",
    profile: "solid",
    note: "n",
    pendingDoorContract: false,
    pendingInteriorPlacement: false,
    colliders: [],
    usage: { buildings: [], props: [{ collide: [1, 1], fit: { targetSize: [2.6, 2.6, 2.6], scale: 1 } }], gates: [] },
    derived: { fittedBounds: { ...baseFitted }, fittedFootprint: [4, 2] },
    ...over,
  };
}

test("error: unknown asset key (sidecar with no GLB)", () => {
  const i = runIssues(asset({ fileExists: false }));
  assert.ok(cats(i, "error").includes("unknown-asset-key"));
});

test("error: missing substantial profile (no colliders/none/pending)", () => {
  const i = runIssues(asset({ colliders: [], profile: "solid" }));
  assert.ok(cats(i, "error").includes("missing-substantial-profile"));
});

test("error: none profile without a reason", () => {
  const i = runIssues(asset({ profile: "none", note: null }));
  assert.ok(cats(i, "error").includes("none-without-reason"));
});

test("error: duplicate collider id", () => {
  const i = runIssues(asset({
    colliders: [
      { id: "b", shape: "box", center: [0, 1, 0], half: [1, 1, 0.5] },
      { id: "b", shape: "box", center: [0, 1, 0], half: [1, 1, 0.5] },
    ],
  }));
  assert.ok(cats(i, "error").includes("duplicate-id"));
});

test("error: unsupported shape", () => {
  const i = runIssues(asset({ colliders: [{ id: "x", shape: "sphere", center: [0, 0, 0] }] }));
  assert.ok(cats(i, "error").includes("unsupported-shape"));
});

test("error: invalid dimensions (zero half-extent)", () => {
  const i = runIssues(asset({ colliders: [{ id: "x", shape: "box", center: [0, 0, 0], half: [0, 1, 1] }] }));
  assert.ok(cats(i, "error").includes("invalid-dimensions"));
});

test("error: collider beyond measured bounds without marginReason", () => {
  const i = runIssues(asset({ colliders: [{ id: "x", shape: "box", center: [0, 1, 0], half: [3, 1, 0.5] }] }));
  assert.ok(cats(i, "error").includes("beyond-measured-bounds"));
});

test("no error when overrun carries a marginReason", () => {
  const i = runIssues(asset({ colliders: [{ id: "x", shape: "box", center: [0, 1, 0], half: [3, 1, 0.5], marginReason: "documented" }] }));
  assert.ok(!cats(i, "error").includes("beyond-measured-bounds"));
});

test("error: support collider missing a link", () => {
  const i = runIssues(asset({
    colliders: [{ id: "d", shape: "support", polygon: [[-1, -0.5], [1, -0.5], [1, 0.5]], y: 0.2, tags: ["support"] }],
  }));
  assert.ok(cats(i, "error").includes("missing-support-link"));
});

test("support link to a world anchor is accepted", () => {
  const i = runIssues(asset({
    colliders: [{ id: "d", shape: "support", polygon: [[-1, -0.5], [1, -0.5], [1, 0.5]], y: 0.2, link: "world:deck", tags: ["support"] }],
  }));
  assert.ok(!cats(i, "error").includes("missing-support-link"));
});

test("error: accidental default-slot collider on a visible building", () => {
  const i = runIssues(asset({
    category: "building",
    usage: { buildings: [{ id: "ropewalk", slot: [22, 8, 8] }], props: [], gates: [] },
    derived: { fittedBounds: { minX: -2.1, maxX: 2.1, minY: 0, maxY: 4, minZ: -4, maxZ: 4 }, fittedFootprint: [4.17, 8] },
    colliders: [{ id: "body", shape: "box", center: [0, 4, 0], half: [11, 4, 4] }],
  }));
  const e = cats(i, "error");
  assert.ok(e.includes("accidental-default-slot") || e.includes("beyond-measured-bounds"));
});

test("warning (not error): non-substantial current asset without a sidecar", () => {
  const i = runIssues({
    assetKey: "road", fileExists: true, hasSidecar: false, referencedInManifest: true,
    category: null, colliders: [], usage: { buildings: [], props: [{ collide: null, fit: { targetSize: null, scale: 1 } }], gates: [] },
    derived: {},
  });
  assert.equal(cats(i, "error").length, 0);
  assert.ok(cats(i, "warning").includes("missing-profile"));
});
