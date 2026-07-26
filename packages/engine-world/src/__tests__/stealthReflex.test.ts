// Reflex time: trigger conditions, the budget, and how a window resolves.

import assert from "node:assert/strict";
import { test } from "node:test";

import { STAND_HEIGHT } from "../collision.js";
import { FIELD_DT, FIELD_TICK_HZ, advanceFieldClock, createFieldClock } from "../fieldSimulation.js";
import {
  REFLEX_BUDGET,
  STEALTH_TUNING,
  createReflexState,
  createStealthFieldState,
  reflexProgress,
  reflexTriggerable,
  scaledFrameDt,
  stepReflex,
  stepStealthField,
  type PlayerStealthRead,
  type ReflexState,
  type WatcherPose,
} from "../stealth/index.js";
import { wall, world } from "./parkourHarness.js";

function trigger(overrides: Partial<Parameters<typeof stepReflex>[1]> = {}) {
  return {
    tick: 100,
    firstHandSightingWatcherId: "guard",
    areaAlreadyHot: false,
    disabled: false,
    pendingVisibility: 1,
    ...overrides,
  };
}

test("a first-hand sighting opens a window", () => {
  const result = stepReflex(createReflexState(), trigger());
  assert.equal(result.opened, true);
  assert.equal(result.reflex.active, true);
  assert.equal(result.timeScale, STEALTH_TUNING.reflexTimeScale);
  assert.equal(result.reflex.pendingWatcherId, "guard");
});

test("nothing else opens one", () => {
  const fresh = createReflexState();
  assert.equal(
    reflexTriggerable(fresh, trigger({ firstHandSightingWatcherId: null }))
      .reason,
    "no-first-hand-sighting",
  );
  assert.equal(
    reflexTriggerable(fresh, trigger({ disabled: true })).reason,
    "disabled",
  );
  assert.equal(
    reflexTriggerable(fresh, trigger({ areaAlreadyHot: true })).reason,
    "area-already-hot",
  );
  assert.equal(
    reflexTriggerable({ ...fresh, charges: 0 }, trigger()).reason,
    "no-charges",
  );
  assert.equal(
    reflexTriggerable({ ...fresh, readyAtTick: 500 }, trigger()).reason,
    "cooldown",
  );
  assert.equal(
    reflexTriggerable({ ...fresh, active: true }, trigger()).reason,
    "already-active",
  );
});

test("being spotted in an already-hot area is a consequence, not a reprieve", () => {
  const result = stepReflex(createReflexState(), trigger({ areaAlreadyHot: true }));
  assert.equal(result.opened, false);
  assert.equal(result.timeScale, 1);
});

test("breaking line of sight inside the window escapes the sighting", () => {
  let reflex: ReflexState = stepReflex(createReflexState(), trigger()).reflex;
  let outcome = "NONE";
  for (let tick = 0; tick < STEALTH_TUNING.reflexWindowTicks; tick++) {
    const result = stepReflex(
      reflex,
      trigger({ tick: 101 + tick, pendingVisibility: 0 }),
    );
    reflex = result.reflex;
    if (result.outcome !== "NONE") {
      outcome = result.outcome;
      break;
    }
  }
  assert.equal(outcome, "ESCAPED");
  assert.equal(reflex.active, false);
});

test("staying visible for the whole window confirms the sighting", () => {
  let reflex: ReflexState = stepReflex(createReflexState(), trigger()).reflex;
  let outcome = "NONE";
  for (let tick = 0; tick < STEALTH_TUNING.reflexWindowTicks + 5; tick++) {
    const result = stepReflex(
      reflex,
      trigger({ tick: 101 + tick, pendingVisibility: 1 }),
    );
    reflex = result.reflex;
    if (result.outcome !== "NONE") {
      outcome = result.outcome;
      break;
    }
  }
  assert.equal(outcome, "CONFIRMED");
});

// ---- the budget ------------------------------------------------------------

test("the budget is three charges, and they do not come back", () => {
  assert.equal(STEALTH_TUNING.reflexChargesPerMission, 3);
  let reflex = createReflexState();
  let tick = 0;
  for (let use = 0; use < 5; use++) {
    const opened = stepReflex(reflex, trigger({ tick }));
    if (!opened.opened) break;
    reflex = opened.reflex;
    // Escape immediately, then wait out the cooldown.
    for (let inner = 0; inner < STEALTH_TUNING.reflexEscapeTicks + 1; inner++) {
      tick += 1;
      reflex = stepReflex(reflex, trigger({ tick, pendingVisibility: 0 })).reflex;
    }
    tick += STEALTH_TUNING.reflexCooldownTicks + 1;
  }
  assert.equal(reflex.triggered, 3, "a fourth mistake is a real mistake");
  assert.equal(reflex.charges, 0);
});

test("a cooldown stops two guards chaining into one long escape", () => {
  let reflex = stepReflex(createReflexState(), trigger({ tick: 0 })).reflex;
  for (let inner = 1; inner <= STEALTH_TUNING.reflexEscapeTicks + 1; inner++) {
    reflex = stepReflex(
      reflex,
      trigger({ tick: inner, pendingVisibility: 0 }),
    ).reflex;
  }
  assert.equal(reflex.active, false);
  const immediate = stepReflex(
    reflex,
    trigger({ tick: reflex.readyAtTick - 1, firstHandSightingWatcherId: "other" }),
  );
  assert.equal(immediate.opened, false, "a second guard cannot re-open at once");
  const later = stepReflex(
    reflex,
    trigger({ tick: reflex.readyAtTick, firstHandSightingWatcherId: "other" }),
  );
  assert.equal(later.opened, true);
});

test("the published budget is what the reasoning claims", () => {
  // 1.6s of world time at a 0.35 scale is ~4.6s of real reaction time; three of
  // those is under 3% of a 180-second mission.
  assert.ok(Math.abs(REFLEX_BUDGET.windowWorldSeconds - 1.6) < 0.02);
  assert.ok(Math.abs(REFLEX_BUDGET.windowRealSeconds - 4.57) < 0.05);
  assert.equal(REFLEX_BUDGET.charges, 3);
  assert.ok(Math.abs(REFLEX_BUDGET.cooldownWorldSeconds - 12) < 0.02);
  assert.ok(Math.abs(REFLEX_BUDGET.totalWorldSeconds - 4.8) < 0.05);
  assert.ok(REFLEX_BUDGET.totalWorldSeconds / 180 < 0.03);
  assert.ok(Math.abs(REFLEX_BUDGET.totalRealSeconds - 13.7) < 0.2);
});

test("progress is readable so the player can see the chance draining", () => {
  const opened = stepReflex(createReflexState(), trigger()).reflex;
  assert.equal(reflexProgress(opened), 0);
  let reflex = opened;
  for (let tick = 0; tick < 48; tick++) {
    reflex = stepReflex(
      reflex,
      trigger({ tick: 101 + tick, pendingVisibility: 1 }),
    ).reflex;
  }
  const half = reflexProgress(reflex);
  assert.ok(half > 0.4 && half < 0.6, `progress was ${half}`);
});

// ---- determinism -----------------------------------------------------------

test("reflex time slows real time without touching the fixed step", () => {
  // The renderer scales its frame delta; the clock still advances in whole
  // FIELD_DT steps, so the tick sequence is unchanged by slow motion.
  const scale = STEALTH_TUNING.reflexTimeScale;
  assert.equal(scaledFrameDt(1 / 60, scale), (1 / 60) * scale);
  assert.equal(scaledFrameDt(1 / 60, 1), 1 / 60);
  assert.equal(scaledFrameDt(Number.NaN, scale), 0);

  // A second of real time at the reflex scale yields scale-many seconds of world
  // time, i.e. proportionally fewer ticks — and every tick is still FIELD_DT.
  let normal = createFieldClock(9);
  let slowed = createFieldClock(9);
  for (let frame = 0; frame < 60; frame++) {
    normal = advanceFieldClock(normal, 1 / 60).clock;
    slowed = advanceFieldClock(slowed, scaledFrameDt(1 / 60, scale)).clock;
  }
  assert.equal(normal.tick, FIELD_TICK_HZ);
  assert.ok(
    Math.abs(slowed.tick - FIELD_TICK_HZ * scale) <= 1,
    `slowed clock reached tick ${slowed.tick}, expected ~${FIELD_TICK_HZ * scale}`,
  );
  assert.equal(FIELD_DT, 1 / FIELD_TICK_HZ);
});

// ---- integration through the field ----------------------------------------

function player(z: number): PlayerStealthRead {
  return {
    position: { x: 0, y: 0, z },
    speedMps: 4.6,
    capsuleHeight: STAND_HEIGHT,
    sprinting: true,
    traversing: false,
    exposure: "EXPOSED",
    covered: false,
    lightLevel: 1,
  };
}

const guard: WatcherPose = {
  id: "guard",
  position: { x: 0, y: 0, z: 0 },
  baseYaw: 0,
};

test("the field holds a sighting at the brink, then resolves it", () => {
  // A wall the player can duck behind: sprinting in the open until spotted, then
  // gone. The sighting must not be cashed in until the window closes.
  const collision = world([wall("shed", 5, 0.6, 4)]);
  let state = createStealthFieldState(["guard"]);
  let opened = false;
  let escaped = false;
  let detected = false;
  for (let tick = 1; tick <= 400; tick++) {
    // Visible in the open until the window opens, then behind the shed.
    const read = opened ? player(9) : player(3);
    const result = stepStealthField(collision, state, {
      dt: FIELD_DT,
      tick,
      seed: 5,
      watchers: [guard],
      player: read,
      clusters: [],
      noise: [],
      reflexDisabled: false,
      suspendAccrual: false,
    });
    state = result.state;
    if (result.events.some((event) => event.type === "reflexOpened")) opened = true;
    if (result.events.some((event) => event.type === "reflexEscaped")) escaped = true;
    if (result.detected) detected = true;
    if (escaped) break;
  }
  assert.equal(opened, true, "the sighting should have opened a window");
  assert.equal(escaped, true, "breaking sight inside the window escapes it");
  assert.equal(detected, false, "a held sighting is never reported as a detection");
  const watcher = state.watchers[0]!;
  assert.equal(watcher.state, "SEARCHING", "the guard searches instead of chasing");
  assert.equal(watcher.called, false, "and never got to shout");
});

test("failing to break sight inside the window is a real detection", () => {
  let state = createStealthFieldState(["guard"]);
  let detected = false;
  let confirmed = false;
  for (let tick = 1; tick <= 400; tick++) {
    const result = stepStealthField(world(), state, {
      dt: FIELD_DT,
      tick,
      seed: 5,
      watchers: [guard],
      player: player(3),
      clusters: [],
      noise: [],
      reflexDisabled: false,
      suspendAccrual: false,
    });
    state = result.state;
    if (result.events.some((event) => event.type === "reflexConfirmed")) {
      confirmed = true;
    }
    if (result.detected) detected = true;
    if (detected) break;
  }
  assert.equal(confirmed, true);
  assert.equal(detected, true);
  assert.equal(state.watchers[0]!.state, "ALERTED");
});

test("a window opens even though the spotting guard was already investigating", () => {
  // The watcher doing the sighting is always INVESTIGATING on the tick before it
  // confirms. "Hot" has to mean somebody else already knew.
  let state = createStealthFieldState(["guard"]);
  let opened = false;
  for (let tick = 1; tick <= 200 && !opened; tick++) {
    const result = stepStealthField(world(), state, {
      dt: FIELD_DT,
      tick,
      seed: 5,
      watchers: [guard],
      player: player(3),
      clusters: [],
      noise: [],
      reflexDisabled: false,
      suspendAccrual: false,
    });
    state = result.state;
    opened = result.events.some((event) => event.type === "reflexOpened");
  }
  assert.equal(opened, true);
});

test("a second guard already investigating makes the area hot: no window", () => {
  let state = createStealthFieldState(["guard", "other"]);
  state = {
    ...state,
    watchers: state.watchers.map((alert) =>
      alert.id === "other"
        ? { ...alert, state: "INVESTIGATING", suspicion: 0.7 }
        : alert,
    ),
  };
  const other: WatcherPose = {
    id: "other",
    position: { x: 40, y: 0, z: 40 },
    baseYaw: 0,
  };
  let opened = false;
  let detected = false;
  for (let tick = 1; tick <= 200 && !detected; tick++) {
    const result = stepStealthField(world(), state, {
      dt: FIELD_DT,
      tick,
      seed: 5,
      watchers: [guard, other],
      player: player(3),
      clusters: [],
      // Noise across the square keeps the far watcher investigating without ever
      // letting it see the player, so the area stays hot for the whole run.
      noise: [
        {
          kind: "PLAYER_MOVE",
          x: 40,
          y: 0,
          z: 42,
          intensity: 0.8,
          radiusM: 12,
        },
      ],
      reflexDisabled: false,
      suspendAccrual: false,
    });
    state = result.state;
    if (result.events.some((event) => event.type === "reflexOpened")) opened = true;
    detected = result.detected;
  }
  assert.equal(opened, false, "a hot area does not grant a window");
  assert.equal(detected, true, "the sighting lands immediately instead");
});

test("with reflex disabled a sighting detects immediately", () => {
  let state = createStealthFieldState(["guard"]);
  let detected = false;
  for (let tick = 1; tick <= 400; tick++) {
    const result = stepStealthField(world(), state, {
      dt: FIELD_DT,
      tick,
      seed: 5,
      watchers: [guard],
      player: player(3),
      clusters: [],
      noise: [],
      reflexDisabled: true,
      suspendAccrual: false,
    });
    state = result.state;
    if (result.detected) {
      detected = true;
      break;
    }
  }
  assert.equal(detected, true);
  assert.equal(state.reflex.charges, STEALTH_TUNING.reflexChargesPerMission);
});
