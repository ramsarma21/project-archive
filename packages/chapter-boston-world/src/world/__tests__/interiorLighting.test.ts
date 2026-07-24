import test from "node:test";
import assert from "node:assert/strict";
import { interiorLightingProfile } from "../InteriorDirector.js";
import {
  INTERIOR_IDS,
  interiorDef,
} from "../interiorManifest.js";

test("all 36 interiors retain a measurable readability floor", () => {
  assert.equal(INTERIOR_IDS.length, 36);
  for (const id of INTERIOR_IDS) {
    const def = interiorDef(id);
    assert.ok(def, `missing ${id}`);
    const profile = interiorLightingProfile(def.archetype);
    assert.ok(profile.ambient >= 0.44, `${id} ambient ${profile.ambient}`);
    assert.ok(
      profile.hemisphere >= 0.35,
      `${id} hemisphere ${profile.hemisphere}`,
    );
    assert.ok(profile.roomFill >= 0.75, `${id} room fill ${profile.roomFill}`);
    assert.ok(
      profile.entranceFill >= 0.75,
      `${id} entrance fill ${profile.entranceFill}`,
    );
    assert.ok(profile.exposure >= 1.02, `${id} exposure ${profile.exposure}`);
  }
});

test("archetypes keep distinct light balance instead of a flat wash", () => {
  const church = interiorLightingProfile("MEETINGHOUSE");
  const warehouse = interiorLightingProfile("WAREHOUSE");
  const home = interiorLightingProfile("LABORER_HOME");
  const tavern = interiorLightingProfile("TAVERN");
  assert.notDeepEqual(church, warehouse);
  assert.notDeepEqual(warehouse, home);
  assert.notDeepEqual(home, tavern);
  assert.ok(church.window > tavern.window);
  assert.ok(warehouse.roomFill > home.roomFill);
  assert.ok(tavern.practical > home.practical);
});
