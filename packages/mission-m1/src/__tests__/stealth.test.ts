import { test } from "node:test";
import assert from "node:assert/strict";

import { segmentClear } from "@pa/engine-world/collision";

import { compileLevel } from "../compile.js";
import { M1_EFFIGY_RUN } from "../level/index.js";
import {
  landingNoiseEvent,
  peakAudibility,
  peakVisibility,
  verbNoiseEvent,
} from "../stealth.js";

const level = M1_EFFIGY_RUN;
const compiled = compileLevel(level);
const nodeById = new Map(level.nodes.map((n) => [n.id, n]));
const patrolById = new Map(level.patrols.map((p) => [p.id, p]));

function nodePos(id: string): [number, number, number] {
  const node = nodeById.get(id);
  assert.ok(node, `unknown node ${id}`);
  return node!.pos;
}

// A cone is only worth authoring if it denies something specific. These assert
// what each one is for by sampling the line it is supposed to deny across a
// whole patrol cycle, using the shipped `visibility`.

test("the market watch actually sees the street line", () => {
  const watch = patrolById.get("WATCH_SHAMBLES")!;
  const exposed = ["B_VAULT_IN", "B_VAULT_OUT", "B_STREET_MID"];
  for (const id of exposed) {
    const peak = peakVisibility(compiled.world, watch, nodePos(id));
    assert.ok(
      peak > 0.15,
      `${id} is meant to be exposed to the watch but peaks at ${peak.toFixed(2)}`,
    );
  }
});

test("blending in the crowd beats the same ground at a sprint", () => {
  const watch = patrolById.get("WATCH_SHAMBLES")!;
  const spot = nodePos("B_STREET_MID");
  const sprinting = peakVisibility(compiled.world, watch, spot, {
    sprinting: true,
  });
  const blended = peakVisibility(compiled.world, watch, spot, {
    sprinting: false,
    crowdBlend: 0.85,
    covered: true,
  });
  assert.ok(
    blended < sprinting * 0.5,
    `blending should more than halve exposure: ${blended.toFixed(2)} vs ${sprinting.toFixed(2)}`,
  );
});

test("the Old Brick watch owns the balcony, and the pediment is the answer", () => {
  const watch = patrolById.get("WATCH_OLD_BRICK")!;
  const exposedPeak = Math.max(
    peakVisibility(compiled.world, watch, nodePos("C_GALLERY_W")),
    peakVisibility(compiled.world, watch, nodePos("C_GALLERY_E")),
  );
  assert.ok(
    exposedPeak > 0.2,
    `the balcony is supposed to get you read; it peaks at ${exposedPeak.toFixed(2)}`,
  );
  const hooded = peakVisibility(compiled.world, watch, nodePos("C_GALLERY_HOOD"));
  assert.equal(
    hooded,
    0,
    "the centre bay is the one spot on the balcony the tower cannot see into",
  );
});

test("crouching behind the rail does not work, because he is above you", () => {
  // The honest consequence of putting the watch eight metres up: a low
  // balustrade is no cover at all, which is why the escape is the pediment.
  const watch = patrolById.get("WATCH_OLD_BRICK")!;
  const standing = peakVisibility(compiled.world, watch, nodePos("C_GALLERY_W"));
  const crouched = peakVisibility(compiled.world, watch, nodePos("C_GALLERY_W"), {
    crouched: true,
  });
  assert.ok(standing > 0 && crouched > 0, "both stances are seen from above");
});

test("the east face is out of sight, but the corner on the way to it is not", () => {
  const watch = patrolById.get("WATCH_OLD_BRICK")!;
  const corner = peakVisibility(compiled.world, watch, nodePos("C_GALLERY_CORNER"));
  const east = peakVisibility(compiled.world, watch, nodePos("C_GALLERY_EMID"));
  assert.ok(
    corner > 0,
    "the corner is still inside his sweep, so running for it costs you exposure",
  );
  assert.equal(
    east,
    0,
    "once the building is between you and the tower the sight line is gone",
  );
});

// Noise is what makes the fast line a decision rather than a shorter path.

test("the eight-second dive is loud enough to reach the market watch", () => {
  const watch = patrolById.get("WATCH_SHAMBLES")!;
  const dive = landingNoiseEvent(nodePos("A_HAY"), 4.9);
  assert.ok(dive.intensity >= 0.5, "a 4.9m fall is a roll landing, not a step");
  const heard = peakAudibility(watch, dive);
  assert.ok(
    heard > 0.05,
    `the roll landing should carry to the watch; peak audibility ${heard.toFixed(3)}`,
  );
});

test("the alley descent is quiet enough that the same watch never hears it", () => {
  const watch = patrolById.get("WATCH_SHAMBLES")!;
  const quiet = [
    landingNoiseEvent(nodePos("A_PLANK"), 1.75),
    landingNoiseEvent(nodePos("A_LEANTO"), 1.5),
    landingNoiseEvent(nodePos("A_ALLEY_CRATES"), 1.95),
    landingNoiseEvent(nodePos("A_ALLEY_FLOOR"), 1.9),
  ];
  for (const noise of quiet) {
    assert.ok(
      peakAudibility(watch, noise) === 0,
      "every rung of the alley chain is a run-off landing and out of earshot",
    );
  }
});

test("crossing the street on the roofs is audible; staying south is not", () => {
  const constable = patrolById.get("CONSTABLE_ORANGE")!;
  const crossing = landingNoiseEvent(nodePos("D_NROOF_W"), 5.3);
  const heardCrossing = peakAudibility(constable, crossing);
  assert.ok(
    heardCrossing > 0.05,
    `the 5.3m roll onto the north roofs should reach him; got ${heardCrossing.toFixed(3)}`,
  );

  const vault = verbNoiseEvent(nodePos("D_VAULT_OUT_0"), "VAULT");
  const heardVault = peakAudibility(constable, vault);
  assert.ok(
    heardVault < heardCrossing,
    "the chimney vaults on the south roofs are the quieter half of the choice",
  );
});

test("the diversions each pull a different cone, and reach it", () => {
  for (const diversion of level.diversions) {
    assert.ok(diversion.pullsPatrols.length > 0);
    for (const patrolId of diversion.pullsPatrols) {
      const patrol = patrolById.get(patrolId);
      assert.ok(patrol, `${diversion.id} pulls unknown patrol ${patrolId}`);
      const heard = peakAudibility(patrol!, {
        kind: "DIVERSION_IMPACT",
        x: diversion.landsAt[0],
        y: diversion.landsAt[1],
        z: diversion.landsAt[2],
        intensity: 0.8,
        radiusM: diversion.noiseRadiusM,
      });
      assert.ok(
        heard > 0.05,
        `${diversion.id} never gets loud enough at ${patrolId} (peak ${heard.toFixed(3)})`,
      );
    }
  }
  const pulled = level.diversions.flatMap((d) => d.pullsPatrols);
  assert.equal(
    new Set(pulled).size,
    pulled.length,
    "each throw redirects a different watcher, so they are three tools and not one",
  );
});

test("the tower vista sees the objective, which is how the route reads", () => {
  const vista = nodePos("C_TOWER_GALLERY");
  const effigy = compiled.massById.get("EFFIGY_OLIVER")!;
  const target = {
    x: (effigy.rect.minX + effigy.rect.maxX) / 2,
    y: (effigy.baseY + effigy.topY) / 2,
    z: (effigy.rect.minZ + effigy.rect.maxZ) / 2,
  };
  assert.ok(
    segmentClear(
      compiled.world,
      { x: vista[0], y: vista[1] + 1.62, z: vista[2] },
      target,
      new Set(["EFFIGY_OLIVER"]),
    ),
    "from the top of the Town House the effigy must be in clear sight; it is the only navigation the mission gets",
  );
});
