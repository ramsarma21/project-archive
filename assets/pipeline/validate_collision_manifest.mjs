// Validator for the collision-metadata foundation.
//
// Re-measures the deployed GLB set + re-reads the authored sidecars (via the
// shared assemble() in collision_lib.mjs — the SAME assembly the build tool
// uses) and enforces the collision authoring contract. Hard ERRORS fail the
// run (exit 1); WARNINGS are tolerated so the tool can run green while road /
// density / interior / door assets are still changing under active workers.
//
// Hard error categories (per the task spec):
//   - missing-substantial-profile : a building/prop/ship has no usable profile
//   - unknown-asset-key           : a sidecar points at a non-existent GLB
//   - beyond-measured-bounds      : a collider pokes >10cm past the fitted
//                                   visual bounds without a documented margin
//   - invalid-dimensions          : bad half-extents / radius / polygon / id
//   - duplicate-id                : two colliders in one sidecar share an id
//   - unsupported-shape           : shape outside the box/capsule/support/
//                                   hazard/none vocabulary
//   - missing-support-link        : a support/hazard has no obstacle/contract link
//   - accidental-default-slot     : a visible building carries a full nominal-
//                                   slot collider (an invisible barrier)
//   - none-without-reason         : a `none` profile with no documented reason
//   - invalid-category / invalid-sidecar / unreadable-glb
//
// Run: node assets/pipeline/validate_collision_manifest.mjs [--strict]
globalThis.self = globalThis;
import { assemble } from "./collision_lib.mjs";

const strict = process.argv.includes("--strict");
const model = await assemble();
const s = model.summary;

const errors = model.issues.filter((i) => i.severity === "error");
const warnings = model.issues.filter((i) => i.severity === "warning");

console.log("collision-metadata validation");
console.log(`  assets scanned:   ${s.scanned} (${s.withGlb} with GLB)`);
console.log(`  profiled:         ${s.profiled}`);
console.log(`  explicit none:    ${s.explicitNone}`);
console.log(`  pending contract: ${s.pending}`);
console.log(`  referenced,no fix:${s.unprofiledReferenced}`);
console.log("");

const groupBy = (list) => {
  const g = {};
  for (const i of list) (g[i.category] ??= []).push(i);
  return g;
};

if (warnings.length) {
  console.log(`WARNINGS (${warnings.length}) — tolerated during migration:`);
  for (const [cat, list] of Object.entries(groupBy(warnings)).sort()) {
    console.log(`  [${cat}] x${list.length}`);
    for (const i of list) console.log(`     ~ ${i.assetKey}: ${i.message}`);
  }
  console.log("");
}

if (errors.length) {
  console.log(`ERRORS (${errors.length}):`);
  for (const [cat, list] of Object.entries(groupBy(errors)).sort()) {
    console.log(`  [${cat}] x${list.length}`);
    for (const i of list) console.log(`     x ${i.assetKey}: ${i.message}`);
  }
  console.log("");
  console.log(`FAIL: ${errors.length} error(s).`);
  process.exit(1);
}

if (strict && warnings.length) {
  console.log(`FAIL (--strict): ${warnings.length} warning(s) treated as errors.`);
  process.exit(1);
}

console.log("OK: no collision-metadata errors.");
