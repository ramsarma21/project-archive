import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  INTERIORS,
  INTERIOR_IDS,
  interiorDoorFacade,
  interiorExitSensor,
  interiorLanding,
  validateInteriorManifest,
} from "../interiorManifest.js";
import { buildInteriorCollisionWorld, validateInteriorCollision } from "../interiorCollision.js";
import { CAPSULE_RADIUS, STAND_HEIGHT, positionClear } from "../collision.js";
import { doorwayForBuilding } from "../doorwayContract.js";
import { ALL_INTERIOR_LOCATIONS } from "../manifest.js";

test("all 36 enterable locations map exactly once to isolated stable slots", () => {
  assert.equal(INTERIOR_IDS.length, 36);
  assert.equal(new Set(INTERIOR_IDS).size, 36);
  assert.equal(Object.keys(INTERIORS).length, 36);
  assert.equal(new Set(Object.values(INTERIORS).map((def) => def.slot)).size, 36);
  for (const def of Object.values(INTERIORS)) {
    assert.ok(def.origin[0] >= 640 && def.origin[2] >= 640, `${def.id} isolated`);
  }
  const currentlyEnterable = Object.values(ALL_INTERIOR_LOCATIONS)
    .filter((location) => location.interior)
    .map((location) => location.id)
    .sort();
  assert.deepEqual([...INTERIOR_IDS].sort(), currentlyEnterable);
});

test("hero and special dimensions match the rebuild contract", () => {
  const expected: Record<string, [number, number, number]> = {
    MERCER_PRESS: [22, 4.2, 16],
    THOMAS_COUNTINGHOUSE: [24, 4.2, 16],
    PIKE_OFFICE: [20, 3.8, 15],
    CUSTOM_HOUSE: [26, 4.8, 18],
    EXPLORE_tavern: [22, 4, 17],
    EXPLORE_church: [28, 8.5, 38],
    EXPLORE_warehouseHero: [30, 5.5, 22],
    EXPLORE_warehouseN2: [24, 4.8, 18],
    EXPLORE_warehouseN3: [28, 5.2, 20],
    EXPLORE_ropewalk: [34, 4.2, 12],
    EXPLORE_warehouseS: [26, 4.8, 18],
    EXPLORE_townhouse: [24, 5, 18],
    EXPLORE_rowN5: [18, 3.8, 14],
    EXPLORE_rowS10: [18, 3.8, 14],
  };
  for (const [id, dimensions] of Object.entries(expected)) {
    assert.deepEqual(INTERIORS[id]?.dimensions, dimensions, id);
  }
});

test("manifest, density, hotspot, and authored collision validations pass", () => {
  const errors = [
    ...validateInteriorManifest(),
    ...Object.values(INTERIORS).flatMap(validateInteriorCollision),
  ];
  assert.deepEqual(errors, []);
});

test("interior portal lanes are independent but preserve exterior doorway owner", () => {
  for (const def of Object.values(INTERIORS)) {
    const exterior = doorwayForBuilding(def.buildingId);
    assert.ok(exterior, `${def.id} has exterior doorway contract`);
    const facade = interiorDoorFacade(def.id);
    const landing = interiorLanding(def.id);
    const sensor = interiorExitSensor(def.id);
    assert.equal(facade[0], def.origin[0]);
    assert.ok(landing[2] > facade[2], `${def.id} landing inside`);
    assert.ok(sensor[2] > facade[2], `${def.id} exit sensor inside`);
    const world = buildInteriorCollisionWorld(def);
    assert.ok(
      positionClear(
        world,
        { x: landing[0], y: landing[1], z: landing[2] },
        CAPSULE_RADIUS,
        STAND_HEIGHT,
      ),
      `${def.id} landing is collision-safe`,
    );
    assert.ok(
      positionClear(
        world,
        { x: sensor[0], y: sensor[1], z: sensor[2] },
        CAPSULE_RADIUS,
        STAND_HEIGHT,
      ),
      `${def.id} exit sensor is collision-safe`,
    );
    assert.ok(
      Math.hypot(
        facade[0] - exterior!.facadePoint[0],
        facade[2] - exterior!.facadePoint[2],
      ) > 500,
      `${def.id} is not co-located with exterior`,
    );
  }
});

test("visible interior definitions reference imported geometry only", () => {
  for (const def of Object.values(INTERIORS)) {
    assert.match(def.shellGlb, /^int-shell-/);
    assert.match(def.floorGlb, /^int-floor-/);
    for (const placement of [...def.partitions, ...def.props]) {
      assert.ok(placement.glb.length > 0, `${def.id}:${placement.id}`);
    }
  }
});

test("every referenced structural and furnishing GLB is deployed", () => {
  const root = resolve(process.cwd().endsWith("apps/web") ? "../.." : ".");
  for (const def of Object.values(INTERIORS)) {
    for (const key of [def.shellGlb, def.floorGlb]) {
      assert.ok(
        existsSync(resolve(root, `apps/web/public/world/structures/${key}.glb`)),
        `missing structure ${key}`,
      );
    }
    for (const placement of [...def.partitions, ...def.props]) {
      const folder = placement.glb.startsWith("int-partition-")
        ? "structures"
        : "props";
      assert.ok(
        existsSync(resolve(root, `apps/web/public/world/${folder}/${placement.glb}.glb`)),
        `missing prop ${placement.glb}`,
      );
    }
  }
});

