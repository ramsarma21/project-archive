import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stepThresholdPlacement,
  type PendingThresholdPlacement,
  type ThresholdStepInput,
} from "../portals/thresholdPlacement.js";
import { LOCATIONS } from "../manifest.js";
import { thresholdAnchorForLocation } from "../doorwayContract.js";
import { interiorLanding } from "../interiorManifest.js";

const STREET = LOCATIONS.BOSTON_STREET!;
const MERCER = LOCATIONS.MERCER_PRESS!;
const PIKE = LOCATIONS.PIKE_OFFICE!;

function input(overrides: Partial<ThresholdStepInput>): ThresholdStepInput {
  return {
    pending: null,
    spawned: true,
    visualInteriorId: null,
    runtimeLoc: STREET,
    qaInteriorOverride: false,
    restoreSpatial: null,
    ...overrides,
  };
}

test("initial exterior spawn teleports to the authored anchor", () => {
  const step = stepThresholdPlacement(input({ spawned: false }));
  assert.deepEqual(step, {
    pending: null,
    spawned: true,
    action: "TELEPORT",
    position: STREET.anchor,
    faceY: STREET.faceY,
  });
});

test("initial exterior spawn honors a matching spatial restore snapshot", () => {
  const step = stepThresholdPlacement(
    input({
      spawned: false,
      restoreSpatial: {
        pos: [-20, 0, 3],
        yaw: 1.25,
        interiorId: null,
        locationId: STREET.id,
      },
    }),
  );
  assert.deepEqual(step, {
    pending: null,
    spawned: true,
    action: "TELEPORT",
    position: [-20, 0, 3],
    faceY: 1.25,
  });
});

test("a restore snapshot from a different location falls back to the anchor", () => {
  const step = stepThresholdPlacement(
    input({
      spawned: false,
      restoreSpatial: {
        pos: [-20, 0, 3],
        yaw: 1.25,
        interiorId: null,
        locationId: "CUSTOMS_POST",
      },
    }),
  );
  assert.deepEqual(step, {
    pending: null,
    spawned: true,
    action: "TELEPORT",
    position: STREET.anchor,
    faceY: STREET.faceY,
  });
});

test("initial interior spawn swaps the interior and arms an ENTER placement", () => {
  const step = stepThresholdPlacement(
    input({ spawned: false, runtimeLoc: MERCER }),
  );
  assert.deepEqual(step, {
    pending: { kind: "ENTER", locationId: MERCER.id },
    spawned: true,
    action: "SWAP_INTERIOR",
    interiorId: MERCER.id,
  });
});

test("an armed ENTER fires only once the interior swap has committed", () => {
  const pending: PendingThresholdPlacement = {
    kind: "ENTER",
    locationId: MERCER.id,
  };
  // Swap committed: teleport to the interior landing under the NEW regime.
  const fired = stepThresholdPlacement(
    input({ pending, runtimeLoc: MERCER, visualInteriorId: MERCER.id }),
  );
  assert.deepEqual(fired, {
    pending: null,
    spawned: true,
    action: "TELEPORT",
    position: interiorLanding(MERCER.id),
    faceY: 0,
  });
});

test("runtime interior change while showing another interior re-arms ENTER", () => {
  const step = stepThresholdPlacement(
    input({ runtimeLoc: PIKE, visualInteriorId: MERCER.id }),
  );
  assert.deepEqual(step, {
    pending: { kind: "ENTER", locationId: PIKE.id },
    spawned: true,
    action: "SWAP_INTERIOR",
    interiorId: PIKE.id,
  });
});

test("leaving a runtime interior arms an EXIT to just outside its door", () => {
  const step = stepThresholdPlacement(
    input({ runtimeLoc: STREET, visualInteriorId: MERCER.id }),
  );
  assert.deepEqual(step, {
    pending: {
      kind: "EXIT",
      anchor: thresholdAnchorForLocation(MERCER, "OUTSIDE"),
      faceY: Math.PI + MERCER.faceY,
    },
    spawned: true,
    action: "SWAP_INTERIOR",
    interiorId: null,
  });
});

test("an armed EXIT fires only once the interior has cleared", () => {
  const pending: PendingThresholdPlacement = {
    kind: "EXIT",
    anchor: [1, 0, 7],
    faceY: Math.PI,
  };
  // Still showing the interior: the EXIT is stale-cleared and, with the
  // runtime already exterior, the step re-arms a fresh EXIT for the room.
  const waiting = stepThresholdPlacement(
    input({ pending, visualInteriorId: MERCER.id }),
  );
  assert.equal(waiting.action, "SWAP_INTERIOR");
  // Swap committed: teleport to the carried anchor.
  const fired = stepThresholdPlacement(input({ pending }));
  assert.deepEqual(fired, {
    pending: null,
    spawned: true,
    action: "TELEPORT",
    position: [1, 0, 7],
    faceY: Math.PI,
  });
});

test("a stale ENTER is dropped and the normal logic runs in the same step", () => {
  const pending: PendingThresholdPlacement = {
    kind: "ENTER",
    locationId: MERCER.id,
  };
  // World moved on: runtime is exterior again and no interior is showing.
  const step = stepThresholdPlacement(input({ pending }));
  assert.deepEqual(step, { pending: null, spawned: true, action: "NONE" });
});

test("explore interiors are never evicted by runtime location changes", () => {
  // EXPLORE_* ids are not in LOCATIONS: the machine must not arm an EXIT.
  const step = stepThresholdPlacement(
    input({ visualInteriorId: "EXPLORE_tavern" }),
  );
  assert.deepEqual(step, { pending: null, spawned: true, action: "NONE" });
});

test("a QA interior override blocks the exterior eviction", () => {
  const step = stepThresholdPlacement(
    input({ visualInteriorId: MERCER.id, qaInteriorOverride: true }),
  );
  assert.deepEqual(step, { pending: null, spawned: true, action: "NONE" });
});

test("steady exterior state is a no-op", () => {
  const step = stepThresholdPlacement(input({}));
  assert.deepEqual(step, { pending: null, spawned: true, action: "NONE" });
});

test("steady interior state (visual matches runtime) is a no-op", () => {
  const step = stepThresholdPlacement(
    input({ runtimeLoc: MERCER, visualInteriorId: MERCER.id }),
  );
  assert.deepEqual(step, { pending: null, spawned: true, action: "NONE" });
});
