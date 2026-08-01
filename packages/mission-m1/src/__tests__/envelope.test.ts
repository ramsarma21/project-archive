import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MOVEMENT_CAPABILITIES,
  PARKOUR_TUNING,
  levelDesignMaxGapM,
} from "@pa/engine-world/parkour";
import { GRAVITY, RUNNING_JUMP_VY, RUN_SPEED } from "@pa/engine-world/playerMotion";
import { CAPSULE_RADIUS } from "@pa/engine-world/collision";

import {
  BAND,
  CHAIN_REACH_M,
  RAMP_STEP_RISE_M,
  gapBudgetM,
  landingKindForDrop,
  resolveDrop,
} from "../envelope.js";

// This file exists to make hand-copied numbers impossible. If the parkour
// system retunes, or gravity moves, these fail here before any geometry test
// gets a chance to pass for the wrong reason.

test("the level's gap budget is the published one, not a local copy", () => {
  for (const drop of [0, 1, 2, 3, 4, 6, 7.5, 8.2, 11.2]) {
    assert.equal(
      gapBudgetM(drop, "FAST"),
      levelDesignMaxGapM(drop),
      `FAST spends the whole published budget at a ${drop}m drop`,
    );
    assert.ok(
      gapBudgetM(drop, "SAFE") < levelDesignMaxGapM(drop),
      "SAFE deliberately spends less than the full budget",
    );
  }
});

test("the published budget is derived from the physics constants", () => {
  // Recomputed here from the raw constants rather than asserted as a literal:
  // if RUN_SPEED, GRAVITY or RUNNING_JUMP_VY moved and tuning.ts did not follow,
  // this is where it surfaces.
  const airtime = (2 * RUNNING_JUMP_VY) / GRAVITY;
  const rawRange = RUN_SPEED * airtime;
  const setback = MOVEMENT_CAPABILITIES.jumpTakeoffSetbackM;
  assert.ok(
    Math.abs(MOVEMENT_CAPABILITIES.maxFlatGapM - (rawRange - setback - CAPSULE_RADIUS)) < 1e-9,
    "the flat gap ceiling is the ballistic range less the setback and the body radius",
  );
  assert.ok(
    MOVEMENT_CAPABILITIES.levelDesignMaxFlatGapM <
      MOVEMENT_CAPABILITIES.maxFlatGapM,
    "the authoring budget always sits inside the physical limit",
  );
});

test("the takeoff setback is one fixed step plus a body, not a guess", () => {
  assert.ok(
    Math.abs(
      MOVEMENT_CAPABILITIES.jumpTakeoffSetbackM -
        (RUN_SPEED / MOVEMENT_CAPABILITIES.tickHz + CAPSULE_RADIUS),
    ) < 1e-9,
  );
});

test("the drop ladder has no ambiguous band between rolling and diving", () => {
  assert.equal(
    MOVEMENT_CAPABILITIES.maxRollDropM,
    MOVEMENT_CAPABILITIES.edgeBrakeDropM,
    "the roll ceiling and the brake floor are the same number",
  );
  assert.ok(
    MOVEMENT_CAPABILITIES.leapMinDropM >= MOVEMENT_CAPABILITIES.maxRollDropM,
    "the dive floor sits at or above the roll ceiling",
  );
  assert.equal(resolveDrop(MOVEMENT_CAPABILITIES.maxRunOffDropM), "RUN_OFF");
  assert.equal(resolveDrop(MOVEMENT_CAPABILITIES.maxRollDropM), "ROLL");
  assert.equal(resolveDrop(MOVEMENT_CAPABILITIES.maxRollDropM + 0.01), "EDGE_BRAKE");
  assert.equal(landingKindForDrop(MOVEMENT_CAPABILITIES.maxRollDropM + 0.01), "HARD");
});

test("a ramp strip stays inside the STEP_UP verb", () => {
  assert.ok(
    RAMP_STEP_RISE_M < MOVEMENT_CAPABILITIES.maxStepUpM,
    "a strip taller than STEP_UP would stop the player on a staircase",
  );
  assert.ok(RAMP_STEP_RISE_M > 0);
});

test("the height vocabulary lands on legal transitions", () => {
  // Every band the route actually steps between has to be reachable by one
  // shipped verb; this catches a band edited to a value nothing can cross.
  const legal = (rise: number): boolean =>
    rise <= MOVEMENT_CAPABILITIES.maxClimbHeightM + 1e-9;
  const pairs: Array<[keyof typeof BAND, keyof typeof BAND]> = [
    ["STREET", "CART"],
    ["CART", "STACK"],
    ["STACK", "STALL_ROOF"],
    ["STREET", "SCAFFOLD_1"],
    ["SCAFFOLD_1", "GALLERY"],
    ["GALLERY", "CLOCK_LEDGE"],
    ["CLOCK_LEDGE", "CORNICE"],
    ["CORNICE", "LEADS"],
    ["LEADS", "TOWER_PLINTH"],
    ["TOWER_PLINTH", "TOWER_GALLERY"],
    ["MEETING_EAVE", "MEETING_RIDGE"],
    ["MEETING_RIDGE", "STEEPLE_LEDGE_N"],
    ["STEEPLE_LEDGE_N", "STEEPLE_GALLERY"],
    ["STEEPLE_CROCKETS", "STEEPLE_VANE"],
    ["BOUGH_LOW", "BOUGH_CROWN"],
    ["BOUGH_CROWN", "BOUGH_UPPER"],
  ];
  for (const [from, to] of pairs) {
    const rise = BAND[to] - BAND[from];
    assert.ok(
      legal(rise),
      `${from} -> ${to} is ${rise.toFixed(2)}m, past the ${MOVEMENT_CAPABILITIES.maxClimbHeightM}m climb ceiling`,
    );
  }
});

test("the chain window reaches further than the spacing the level clusters at", () => {
  assert.ok(
    CHAIN_REACH_M > 3.5,
    `a ${PARKOUR_TUNING.chainWindowTicks}-tick window reaches ${CHAIN_REACH_M.toFixed(1)}m at sprint`,
  );
});
