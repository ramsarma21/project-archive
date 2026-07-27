import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  HOLOGRAM_EMISSIVE_CEILING,
  HOLOGRAM_EMISSIVE_INTENSITY,
  HOLOGRAM_FLICKER_MIN,
  HOLOGRAM_LIGHT_INTENSITY_CEILING,
  HOLOGRAM_OPACITY_FLOOR,
  buildHologramLights,
  holographize,
  hologramFlicker,
  holographizeMaterial,
  measureRig,
} from "../src/module/presenterHologram.js";

// The regression that pins the owner's face requirement. The presenter reads as
// a hologram, but the imported FACE must remain readable: the base albedo map is
// kept, the material is controlled (non-additive, opacity above a floor,
// restrained emissive) rather than a blown-out cyan silhouette. Asserted on the
// real produced material, structurally — no brittle source strings, no
// screenshot. These would all fail against the previous cyan-field material.

function sourceMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xd8b89a });
  // A stand-in for the imported facial albedo. Identity is what must survive.
  material.map = new THREE.Texture();
  material.map.name = "presenter-albedo";
  return material;
}

test("the hologram keeps the imported base albedo map — the face is not overpainted", () => {
  const src = sourceMaterial();
  const holo = holographizeMaterial(src, { reducedMotion: false });
  assert.ok(holo.map, "the base colour map is retained");
  assert.equal(holo.map, src.map, "it is the SAME imported albedo, not a replacement");
  assert.equal(holo.map?.name, "presenter-albedo");
});

test("the hologram material is controlled, not a blown-out additive silhouette", () => {
  const holo = holographizeMaterial(sourceMaterial(), { reducedMotion: false });
  // Non-additive: additive blending is what turns a lit face into a cyan glow.
  assert.equal(holo.blending, THREE.NormalBlending);
  assert.notEqual(holo.blending, THREE.AdditiveBlending);
  // Opacity stays above the floor so the face is never washed to see-through.
  assert.ok(holo.transparent, "transparent for the projection look");
  assert.ok(
    holo.opacity >= HOLOGRAM_OPACITY_FLOOR,
    `opacity ${holo.opacity} must be >= floor ${HOLOGRAM_OPACITY_FLOOR}`,
  );
  // Emissive is restrained: a low cyan glow, never a wash that erases texture.
  assert.ok(
    holo.emissiveIntensity <= HOLOGRAM_EMISSIVE_CEILING,
    `emissiveIntensity ${holo.emissiveIntensity} must be <= ceiling ${HOLOGRAM_EMISSIVE_CEILING}`,
  );
  // Depth writes so the figure is solid rather than an x-ray of its far side.
  assert.equal(holo.depthWrite, true);
  // Tone-mapped so renderer exposure cannot blow it out.
  assert.notEqual(holo.toneMapped, false);
});

test("holographize returns exactly one material pass per source, and it is disposable", () => {
  // One readable pass, not stacked opaque/additive clones.
  const mesh = new THREE.Mesh(
    new THREE.BufferGeometry(),
    sourceMaterial(),
  );
  const group = new THREE.Group();
  group.add(mesh);
  const owned = holographize(group, { reducedMotion: true });
  assert.equal(owned.size, 1, "one material clone owned per source material");
  const applied = mesh.material as THREE.MeshStandardMaterial;
  assert.ok(owned.has(applied), "the applied material is the one that gets disposed");
  assert.ok(applied.map, "the applied material still carries the albedo");
});

test("the emissive is kept low so it never washes the face, staying under the ceiling", () => {
  // FACIAL READABILITY is the primary constraint. Emissive lifts the whole
  // surface uniformly toward cyan (ignoring the albedo), so it desaturates the
  // face — it must stay small (the glow lives at the silhouette and in the room,
  // not on the face interior), yet remain positive so she still self-lifts in
  // shadow rather than going dead flat.
  assert.ok(
    HOLOGRAM_EMISSIVE_INTENSITY > 0,
    `emissive ${HOLOGRAM_EMISSIVE_INTENSITY} should stay positive for a faint inner lift`,
  );
  assert.ok(
    HOLOGRAM_EMISSIVE_INTENSITY <= 0.15,
    `emissive ${HOLOGRAM_EMISSIVE_INTENSITY} must stay low so the face is not washed cyan`,
  );
  assert.ok(
    HOLOGRAM_EMISSIVE_INTENSITY <= HOLOGRAM_EMISSIVE_CEILING,
    `emissive ${HOLOGRAM_EMISSIVE_INTENSITY} must stay <= ceiling ${HOLOGRAM_EMISSIVE_CEILING}`,
  );
  const holo = holographizeMaterial(sourceMaterial(), { reducedMotion: false });
  assert.equal(holo.emissiveIntensity, HOLOGRAM_EMISSIVE_INTENSITY);
});

test("the cyan light rig is bounded, cyan, and identical under reduced motion", () => {
  const full = buildHologramLights(false);
  const reduced = buildHologramLights(true);
  assert.ok(full.length >= 2, "there is a real multi-source cyan rig, not one flat light");
  // Reduced motion calms flicker, it must NOT dim the light spill.
  assert.deepEqual(reduced, full, "reduced motion preserves the light rig exactly");
  for (const light of full) {
    assert.ok(light.intensity > 0, `${light.key} emits light`);
    assert.ok(
      light.intensity <= HOLOGRAM_LIGHT_INTENSITY_CEILING,
      `${light.key} intensity ${light.intensity} must be <= ceiling ${HOLOGRAM_LIGHT_INTENSITY_CEILING}`,
    );
    assert.ok(light.distance > 0, `${light.key} is a local, falloff-limited source`);
    // Cyan-ish: the blue channel dominates the red channel, never a warm light.
    const r = (light.color >> 16) & 0xff;
    const b = light.color & 0xff;
    assert.ok(b > r, `${light.key} color 0x${light.color.toString(16)} must be cyan (blue > red)`);
  }
});

test("the flicker is frozen under reduced motion and only ever dims otherwise", () => {
  // Reduced motion: pinned to 1 so the glow is preserved with no animated strobe.
  for (const t of [0, 0.5, 1.25, 9.9, 40]) {
    assert.equal(hologramFlicker(t, true), 1, `reduced flicker at ${t}s is pinned to 1`);
  }
  // Motion allowed: a gentle breakup that stays within [MIN, 1] and never brightens.
  for (let t = 0; t < 20; t += 0.037) {
    const f = hologramFlicker(t, false);
    assert.ok(f <= 1, `flicker ${f} must never brighten past steady state`);
    assert.ok(f >= HOLOGRAM_FLICKER_MIN, `flicker ${f} must stay >= floor ${HOLOGRAM_FLICKER_MIN}`);
  }
});

test("measureRig uses the skinned mesh's own bounds so the fit is not gigantic", () => {
  // A minimal BOUND skinned mesh whose geometry spans ~1.7 units, as the real
  // rig is (skin attributes + a bound skeleton). The old naive setFromObject
  // under-read skinned bounds and scaled the rig huge until the camera sat
  // inside it; the skinned-aware measure reads the true ~1.7 height.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 0, 1.7, 0, 0.4, 0.9, 0], 3),
  );
  geometry.setAttribute(
    "skinIndex",
    new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4),
  );
  geometry.setAttribute(
    "skinWeight",
    new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
  );
  const skinned = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  const bone = new THREE.Bone();
  skinned.add(bone);
  skinned.bind(new THREE.Skeleton([bone]));
  const group = new THREE.Group();
  group.add(skinned);
  const size = new THREE.Vector3();
  measureRig(group).getSize(size);
  assert.ok(size.y > 1.4 && size.y < 2.0, `measured height ${size.y} should be ~1.7`);
});
