import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The visible-asset law: the System presenter is ALWAYS the imported GLB. A
// missing or loading model renders nothing and emits a QA error — never a
// primitive, an NPC, a silhouette or the flat reference image. This is a
// source-level guard (the R3F/WebGL component cannot be mounted in a headless
// node runner), which is the appropriate place to pin an "it must never do X"
// invariant about a rendering path.

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "src", "module", "SystemPresenter.tsx"), "utf8");
const holoSrc = readFileSync(join(here, "..", "src", "module", "presenterHologram.ts"), "utf8");

test("the presenter never substitutes a primitive or existing person rig", () => {
  // No primitive geometry as a body: the presenter is a loaded GLB only.
  for (const primitive of [
    "capsuleGeometry",
    "sphereGeometry",
    "boxGeometry",
    "PlaceholderPerson",
  ]) {
    assert.doesNotMatch(src, new RegExp(primitive), `presenter must not use ${primitive}`);
  }
});

test("a failed presenter load renders nothing and reports a QA error", () => {
  // The GlbBoundary fallback is the missing-state component, not a body.
  assert.match(src, /fallback=\{<PresenterMissing\s*\/>\}/);
  // PresenterMissing returns null (renders nothing) and reports the QA error.
  assert.match(src, /function PresenterMissing\(\)\s*\{[\s\S]*reportPresenterMissing\(\)[\s\S]*return null/);
  // The QA message names the failure as a hard QA failure on the imported asset.
  assert.match(src, /PRESENTER_MISSING_QA_MESSAGE\s*=\s*/);
  assert.match(src, /hard QA failure on the imported asset/);
});

test("the Suspense loading fallback is also nothing, not a placeholder body", () => {
  assert.match(src, /<Suspense fallback=\{null\}>/);
});

test("reduced motion is threaded to the presenter shader rather than hiding it", () => {
  // The presenter stays visible under reduced motion; only flicker/drift stop.
  assert.match(holoSrc, /uReduced/);
  assert.match(src, /reducedMotion/);
});

// The owner's gaze/eye-contact requirement. The camera gaze must be layered on
// top of the animation, not fought with it: the mixer writes the skeleton, then
// the head/neck offset is applied. These pin the ordering and the no-fake-mouth
// rule at the source, since the R3F frame loop cannot run headless here.

test("gaze is applied AFTER the animation mixer so the clip cannot overwrite it", () => {
  // Within the frame loop, mixer.update must appear before the bone offset is
  // multiplied in. A regression that reorders these silently loses the gaze.
  const frame = src.match(/useFrame\(\([^)]*\)\s*=>\s*\{[\s\S]*?\n  \}\);/);
  assert.ok(frame, "the presenter has a frame loop");
  const body = frame![0];
  const mixerAt = body.indexOf("mixerRef.current?.update");
  const gazeAt = body.indexOf(".quaternion.multiply(");
  assert.ok(mixerAt >= 0, "the mixer updates in the frame loop");
  assert.ok(gazeAt >= 0, "the gaze offset is applied in the frame loop");
  assert.ok(mixerAt < gazeAt, "the mixer must update before the gaze offset is applied");
});

test("the head and neck are the gaze joints, tracked from the real rig names", () => {
  assert.match(src, /getObjectByName\("Head"\)/);
  assert.match(src, /getObjectByName\("neck"\)/);
});

test("the presenter drives the real jawOpen morph, not an invented mouth", () => {
  // The facial pass added exactly one honest control (the jawOpen morph target)
  // to the mesh, so the renderer DOES write morphTargetInfluences — but only via
  // the shared JAW_OPEN_MORPH name, never by inventing a jaw/teeth/tongue bone
  // the asset does not carry.
  assert.match(src, /morphTargetInfluences/);
  assert.match(src, /JAW_OPEN_MORPH/);
  assert.doesNotMatch(src, /getObjectByName\(["'](jaw|Jaw|teeth|tongue)/);
  // Speech stays bounded: the capped jaw morph plus the sub-degree head accent.
  assert.match(src, /JAW_OPEN_MAX/);
  assert.match(src, /SPEECH_HEAD_PITCH_MAX/);
});

test("the jaw morph is written AFTER the animation mixer updates", () => {
  // Clips carry no morph channels, but the write must still follow the mixer so
  // the ordering contract (skeleton first, face after) is never inverted.
  const frame = src.match(/useFrame\(\([^)]*\)\s*=>\s*\{[\s\S]*?\n  \}\);/);
  assert.ok(frame, "the presenter has a frame loop");
  const body = frame![0];
  const mixerAt = body.indexOf("mixerRef.current?.update");
  const morphAt = body.indexOf("morphTargetInfluences!");
  assert.ok(mixerAt >= 0 && morphAt >= 0, "both the mixer and the morph write exist");
  assert.ok(mixerAt < morphAt, "the mixer must update before the jaw morph is written");
});
