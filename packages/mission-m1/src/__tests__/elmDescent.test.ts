// Regression guard for the owner's report at the Liberty Elm:
//   "on that building next to the tree when u jump u literally fall all the way
//    into the ground and some interaction comes. why is the floor not solid?"
//
// The investigation (.affordwork/probe-elm-fallthrough.mjs, sweep-elm-jumps.mjs,
// and the real-client repro repro-elm.mjs) established three facts this test
// locks so a future collision/level/encounter change that reintroduces the
// report fails HERE rather than in the owner's hands:
//
//   1. The collision floor under the elm is a solid plane at y=0 with no gap and
//      no pocket. Support is found at every (x,z) across the elm base. (The
//      "floor is not solid" hypothesis — a coverage gap or an awning pocket — is
//      false: `supportBelow` always includes the ground plane, so a body arriving
//      from above always finds it.)
//   2. A running jump off ANY authored bough stance comes to rest ON the ground
//      (or a valid surface): grounded, feet on a real support, torso not cut by a
//      deck, and NEVER below the ground plane. The body does not pass through the
//      world. (What a jump off a bough IS is a 6.4-11.2 m plummet with no landing
//      consequence — that "make it read as real" fix is a fall/edge-brake change
//      in @pa/engine-world, reported separately, not made here.)
//   3. The relocated roofline encounter (ROPEWALK_STOP, on the Hollis Meeting
//      leads at y=8.2) does NOT arm from the elm base or from any elm bough — the
//      same-surface height band + XZ radius keep it on its own storey — while it
//      DOES arm on the meeting-house roof. So the "interaction" the owner met at
//      the elm base is not this beat arming off its surface.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CAPSULE_RADIUS,
  capsuleEmbeddedIn,
  deckThroughBody,
  supportBelow,
  type Vec3,
} from "@pa/engine-world/collision";
import {
  beginRunningJump,
  createGroundedState,
  stepMotion,
  RUN_SPEED,
} from "@pa/engine-world/playerMotion";
import { FIELD_TICK_HZ } from "@pa/engine-world/fieldSimulation";
import { compileLevel } from "../compile.js";
import { M1_EFFIGY_RUN } from "../level/index.js";
import { M1_ENCOUNTERS, encounterById } from "../encounters/bank.js";
import { selectEncounterVariant } from "../encounters/select.js";
import { createEncounterInstance, stepEncounter } from "../encounters/machine.js";

const { world } = compileLevel(M1_EFFIGY_RUN);
const DT = 1 / FIELD_TICK_HZ;
const SEED = "0123456789abcdef0123456789abcdef";

// 1 -----------------------------------------------------------------------
// The floor under the elm is solid: support exists at every sampled point of
// the base, at ground level (nothing floats a body above y=0 there and nothing
// leaves a hole for one to fall into).
test("the elm-base floor presents solid support everywhere (no gap, no pocket)", () => {
  const missing: string[] = [];
  for (let x = 75; x <= 87; x += 1) {
    for (let z = -6; z <= 6; z += 1) {
      // A body arriving at the surface: foot just above 0, generous snap.
      const support = supportBelow(world, x, z, 0.05, 0.1);
      if (!support) missing.push(`(${x},${z})`);
      else assert.ok(support.y >= -0.05 && support.y <= 1.2, `support at (${x},${z}) is y=${support.y}`);
    }
  }
  assert.deepEqual(missing, [], `elm-base points with NO support (fall-through holes): ${missing.join(" ")}`);
});

// 2 -----------------------------------------------------------------------
// A jump off any authored bough ends ON the ground, not in it.
//
// Authored bough stances only — a point ON the solid trunk footprint is not a
// place a body can stand (the sweep stops it at the bole), so it is excluded.
const BOUGH_STANCES: Array<{ label: string; pos: Vec3 }> = [
  { label: "crown F_POST", pos: { x: 79.6, y: 8.3, z: 0.4 } },
  { label: "crown F_CROWN", pos: { x: 79.6, y: 8.3, z: 1.9 } },
  { label: "crown F_CROWN_E", pos: { x: 82.6, y: 8.3, z: 2.6 } },
  { label: "low bough F_POST_STEP", pos: { x: 79.6, y: 6.4, z: 3.8 } },
  { label: "low bough W", pos: { x: 78.0, y: 6.4, z: 0.0 } },
  { label: "low bough E", pos: { x: 84.0, y: 6.4, z: 0.0 } },
  { label: "upper bough", pos: { x: 82.0, y: 11.2, z: 2.6 } },
  { label: "awning F_AWNING", pos: { x: 77.0, y: 3.2, z: 2.8 } },
];
const DIRS: Array<[number, number, string]> = [
  [1, 0, "E"], [-1, 0, "W"], [0, 1, "N"], [0, -1, "S"],
];

for (const stance of BOUGH_STANCES) {
  for (const [dx, dz, dname] of DIRS) {
    test(`jump off ${stance.label} (${dname}) rests on the ground, not in it`, () => {
      let state = createGroundedState({ ...stance.pos }, Math.atan2(dx, dz));
      state = stepMotion(world, state, {
        dt: DT, targetVelX: 0, targetVelZ: 0, reducedMotion: false,
      }).state;
      state = beginRunningJump({
        ...state,
        vel: { x: dx * RUN_SPEED, y: 0, z: dz * RUN_SPEED },
      });
      let landed = false;
      let minY = state.pos.y;
      for (let t = 0; t < 1500; t += 1) {
        state = stepMotion(world, state, {
          dt: DT, targetVelX: dx * RUN_SPEED, targetVelZ: dz * RUN_SPEED, reducedMotion: false,
        }).state;
        minY = Math.min(minY, state.pos.y);
        if (state.grounded && t > 3) { landed = true; break; }
      }

      assert.ok(landed, `${stance.label} ${dname}: never came to rest within the window`);
      // THE INVARIANT: the body comes to rest ON the ground, not IN it.
      //   - it is grounded (the fall resolved to a stand, not an endless drop);
      //   - it never dipped below the ground plane on the way down or at rest
      //     (no tunnelling through the floor);
      assert.ok(state.grounded, `${stance.label} ${dname}: never became grounded`);
      assert.ok(
        minY >= -0.05,
        `${stance.label} ${dname}: fell BELOW the ground (minY=${minY.toFixed(3)}) — passed through the floor`,
      );
      //   - its feet rest on a real support surface and are not sunk below it;
      const rest = supportBelow(world, state.pos.x, state.pos.z, state.pos.y + 0.05, 0.1);
      assert.ok(rest, `${stance.label} ${dname}: came to rest over nothing at (${state.pos.x.toFixed(1)},${state.pos.z.toFixed(1)})`);
      assert.ok(
        state.pos.y >= rest!.y - 0.06,
        `${stance.label} ${dname}: rests at y=${state.pos.y.toFixed(3)} SUNK below its support "${rest!.id}" at ${rest!.y.toFixed(3)}`,
      );
      //   - and no deck plane cuts the torso where it stands (not lodged inside
      //     the awning or another surface).
      const deck = deckThroughBody(world, state.pos.x, state.pos.z, state.pos.y, state.capsuleHeight);
      assert.equal(deck, null, `${stance.label} ${dname}: a deck (${deck?.id}) cuts the torso at rest — the body is inside a surface`);
      // And the body is not embedded in a solid mass beyond a resting-contact skin.
      const embeds = capsuleEmbeddedIn(world, state.pos, CAPSULE_RADIUS, state.capsuleHeight);
      const deep = embeds.filter((e) => e.depthM > 0.2);
      assert.deepEqual(
        deep.map((e) => `${e.id}:${e.depthM.toFixed(2)}`),
        [],
        `${stance.label} ${dname}: body embedded in solid at rest`,
      );
    });
  }
}

// 3 -----------------------------------------------------------------------
// The roofline encounter cannot arm from the elm base or the boughs. This is
// the same-surface guarantee the owner's second complaint turns on: a beat
// authored on the meeting-house leads must not fire down at the tree.
function armPhaseAt(encounterId: "SHAMBLES_STOP" | "ROPEWALK_STOP", pos: Vec3): string {
  const def = encounterById(encounterId);
  const inst = createEncounterInstance(def, selectEncounterVariant(def, SEED, def.order));
  stepEncounter(inst, {
    world,
    tick: 0,
    player: { pos, grounded: true },
    actorPoses: [],
    dt: DT,
    submit: false,
    verdict: null,
    dismiss: false,
  });
  return inst.phase;
}

const OFF_SURFACE_POSITIONS: Array<{ label: string; pos: Vec3 }> = [
  { label: "elm-base earth NW", pos: { x: 77, y: 0, z: 3 } },
  { label: "elm-base earth mid", pos: { x: 80, y: 0, z: 2 } },
  { label: "elm-base earth E", pos: { x: 84, y: 0, z: 3 } },
  { label: "low bough (y=6.4)", pos: { x: 79.6, y: 6.4, z: 3.8 } },
  { label: "crown (y=8.3)", pos: { x: 79.6, y: 8.3, z: 0.4 } },
];

test("no route encounter arms from the elm base or the boughs", () => {
  for (const { label, pos } of OFF_SURFACE_POSITIONS) {
    for (const enc of M1_ENCOUNTERS) {
      const phase = armPhaseAt(enc.id, pos);
      assert.equal(
        phase,
        "DORMANT",
        `${enc.id} armed (${phase}) from ${label} at ${JSON.stringify(pos)} — an encounter fired off its own surface`,
      );
    }
  }
});

test("ROPEWALK_STOP still arms on the meeting-house roof (on its own surface)", () => {
  const trigger = encounterById("ROPEWALK_STOP").trigger.at;
  const phase = armPhaseAt("ROPEWALK_STOP", { x: trigger[0], y: trigger[1], z: trigger[2] });
  assert.notEqual(phase, "DORMANT", "ROPEWALK_STOP did not arm on its own authored roof surface");
});
