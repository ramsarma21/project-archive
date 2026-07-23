import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  normalizeInteriorMaterials,
  clampInteriorNormalScale,
  interiorRoughnessBand,
  surfaceKindForStructure,
  INTERIOR_NORMAL_SCALE_MIN,
  INTERIOR_NORMAL_SCALE_MAX,
} from "../interiorMaterials.js";
import { INTERIORS } from "../interiorManifest.js";
import { chooseInteriorFloorGrid } from "../InteriorStructure.js";

test("material normalization clones + clamps without mutating shared source", () => {
  const source = new THREE.MeshStandardMaterial({
    roughness: 0.08,
    metalness: 0.9,
  });
  source.side = THREE.DoubleSide;
  source.normalMap = new THREE.Texture();
  source.normalScale = new THREE.Vector2(2.5, 2.5);
  source.emissive = new THREE.Color(1, 1, 1);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), source);
  const group = new THREE.Group();
  group.add(mesh);

  const owned = normalizeInteriorMaterials(group, { kind: "plaster", doubleSided: false });

  // Source material is untouched (shared cache safety).
  assert.equal(source.roughness, 0.08);
  assert.equal(source.metalness, 0.9);
  assert.equal(source.side, THREE.DoubleSide);

  // The mesh now wears a distinct cloned material within the contract band.
  const applied = mesh.material as THREE.MeshStandardMaterial;
  assert.notEqual(applied, source);
  assert.ok(owned.has(applied));
  const [rmin, rmax] = interiorRoughnessBand("plaster");
  assert.ok(applied.roughness >= rmin && applied.roughness <= rmax);
  assert.equal(applied.metalness, 0);
  assert.equal(applied.side, THREE.FrontSide);
  assert.ok(
    applied.normalScale.x >= INTERIOR_NORMAL_SCALE_MIN &&
      applied.normalScale.x <= INTERIOR_NORMAL_SCALE_MAX,
  );
  assert.equal(applied.normalMap!.colorSpace, THREE.NoColorSpace);
  assert.equal(applied.emissive.getHex(), 0x000000);
});

test("thin partitions stay double-sided; thick structures are front-side", () => {
  const thick = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial(),
  );
  normalizeInteriorMaterials(thick, { kind: "wood", doubleSided: false });
  assert.equal((thick.material as THREE.Material).side, THREE.FrontSide);

  const thin = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial(),
  );
  normalizeInteriorMaterials(thin, { kind: "thin-partition", doubleSided: true });
  assert.equal((thin.material as THREE.Material).side, THREE.DoubleSide);
});

test("normal scale clamp respects the 0.25–0.4 band", () => {
  assert.equal(clampInteriorNormalScale(5), INTERIOR_NORMAL_SCALE_MAX);
  assert.equal(clampInteriorNormalScale(0), INTERIOR_NORMAL_SCALE_MIN);
  assert.equal(clampInteriorNormalScale(0.3), 0.3);
});

test("surface kind inference from structural key", () => {
  assert.equal(surfaceKindForStructure("int-partition-board-a"), "thin-partition");
  assert.equal(surfaceKindForStructure("int-floor-brick-work-a"), "brick");
  assert.equal(surfaceKindForStructure("int-floor-wide-pine-a"), "wood");
  assert.equal(surfaceKindForStructure("int-shell-shopfront-a"), "plaster");
});

test("every interior obeys the shell + camera + fog contract", () => {
  for (const def of Object.values(INTERIORS)) {
    // Shell yaw metadata is explicit and finite.
    assert.ok(Number.isFinite(def.shellYaw), `${def.id} shellYaw`);
    assert.ok(
      def.shellContract === "legacy" || def.shellContract === "canonical",
      `${def.id} shellContract`,
    );
    // Camera: inset 0.75–0.9; common boom 2.8–3.0, wider only for large halls.
    assert.ok(def.camera.inset >= 0.75 && def.camera.inset <= 0.95, `${def.id} inset`);
    const wideHall = def.archetype === "MEETINGHOUSE" || def.archetype === "WAREHOUSE";
    assert.ok(def.camera.maxBoom >= 2.8, `${def.id} boom min`);
    assert.ok(def.camera.maxBoom <= (wideHall ? 4.3 : 3.0), `${def.id} boom cap`);
    // Fog: only large halls fog; and never a universal near=12.
    if (def.lighting.fogEnabled) {
      assert.ok(def.dimensions[2] >= 20, `${def.id} only large halls fog`);
      assert.ok(def.lighting.fogNear >= def.dimensions[2] * 1.24, `${def.id} fogNear`);
      assert.ok(def.lighting.fogFar >= def.dimensions[2] * 2.9, `${def.id} fogFar`);
    }
  }
});

test("canonical floor tiles never exceed 1.15x horizontal fitting", () => {
  for (const def of Object.values(INTERIORS)) {
    const grid = chooseInteriorFloorGrid(def.dimensions[0], def.dimensions[2]);
    assert.ok(
      grid.horizontalAnisotropy <= 1.15 + 1e-6,
      `${def.id} tile anisotropy ${grid.horizontalAnisotropy}`,
    );
    assert.ok(grid.columns * grid.rows <= 40, `${def.id} tile count`);
    assert.ok(grid.cellWidth <= 7 && grid.cellDepth <= 7, `${def.id} tile size`);
  }
});
