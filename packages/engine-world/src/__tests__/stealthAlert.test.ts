// Alert escalation and the systemic response.

import assert from "node:assert/strict";
import { test } from "node:test";

import { FIELD_DT } from "../fieldSimulation.js";
import {
  STEALTH_TUNING,
  createWatcherAlert,
  propagateCalls,
  squadAlertState,
  stepWatcherAlert,
  stepWatcherAttention,
  type AlertState,
  type NoiseEvent,
  type WatcherAlert,
} from "../stealth/index.js";
import { world } from "./parkourHarness.js";

const HERE = { x: 0, y: 0, z: 0 };
const PLAYER = { x: 0, y: 0, z: 6 };

function hold(
  alert: WatcherAlert,
  visibility: number,
  ticks: number,
  noise: readonly NoiseEvent[] = [],
): { alert: WatcherAlert; states: AlertState[]; calls: number } {
  let current = alert;
  const states: AlertState[] = [];
  let calls = 0;
  for (let tick = 0; tick < ticks; tick++) {
    const result = stepWatcherAlert(current, {
      dt: FIELD_DT,
      visibility,
      playerPosition: PLAYER,
      position: HERE,
      noise,
      suspendAccrual: false,
    });
    current = result.alert;
    for (const transition of result.transitions) states.push(transition.to);
    if (result.call) calls += 1;
  }
  return { alert: current, states, calls };
}

test("full visibility walks the whole ladder in order", () => {
  const { alert, states } = hold(createWatcherAlert("a"), 1, 120);
  assert.deepEqual(states, ["CURIOUS", "INVESTIGATING", "ALERTED"]);
  assert.equal(alert.state, "ALERTED");
  assert.equal(alert.firstHand, true);
});

test("full visibility takes about the tuned time to reach certainty", () => {
  let alert = createWatcherAlert("a");
  let ticks = 0;
  while (alert.state !== "ALERTED" && ticks < 600) {
    alert = stepWatcherAlert(alert, {
      dt: FIELD_DT,
      visibility: 1,
      playerPosition: PLAYER,
      position: HERE,
      noise: [],
      suspendAccrual: false,
    }).alert;
    ticks += 1;
  }
  const seconds = ticks * FIELD_DT;
  // 1/0.85 s at full visibility. Fast enough to be frightening in the open, slow
  // enough that a single frame of exposure is survivable.
  assert.ok(seconds > 1 && seconds < 1.5, `took ${seconds.toFixed(2)}s`);
});

test("a glimpse below the accrual floor never accumulates", () => {
  const { alert } = hold(
    createWatcherAlert("a"),
    STEALTH_TUNING.minAccrualVisibility - 0.01,
    600,
  );
  assert.equal(alert.suspicion, 0);
  assert.equal(alert.state, "UNAWARE");
});

test("suspicion holds briefly after contact breaks, then decays", () => {
  const seen = hold(createWatcherAlert("a"), 1, 40);
  const peak = seen.alert.suspicion;
  const heldBriefly = hold(seen.alert, 0, STEALTH_TUNING.decayHoldTicks - 1);
  assert.equal(
    heldBriefly.alert.suspicion,
    peak,
    "a flicker of cover must not reset suspicion",
  );
  const decayed = hold(seen.alert, 0, 60);
  assert.ok(decayed.alert.suspicion < peak, "sustained cover does decay it");
});

test("losing sight of a confirmed player produces a search, not amnesia", () => {
  const seen = hold(createWatcherAlert("a"), 1, 120);
  assert.equal(seen.alert.state, "ALERTED");
  const lost = hold(seen.alert, 0, 30);
  assert.equal(lost.alert.state, "SEARCHING");
  assert.ok(
    lost.alert.suspicion >= STEALTH_TUNING.searchingFloor,
    "a searching watcher does not forget he saw somebody",
  );
  assert.ok(lost.alert.lastKnown, "he remembers where");
});

test("a search times out and the watcher eventually stands down", () => {
  const seen = hold(createWatcherAlert("a"), 1, 120);
  const searched = hold(seen.alert, 0, STEALTH_TUNING.searchTicks + 120);
  assert.deepEqual(
    searched.states,
    ["SEARCHING", "CURIOUS", "UNAWARE"],
    "a search winds down one step at a time",
  );
  assert.equal(searched.alert.state, "UNAWARE");
  assert.equal(searched.alert.lastKnown, null, "and he forgets where");
});

test("unseen noise brings a watcher to look, but never to certainty", () => {
  const landing: NoiseEvent = {
    kind: "PLAYER_LANDING",
    x: 0,
    y: 0,
    z: 4,
    intensity: 0.95,
    radiusM: 13,
  };
  const step = hold(createWatcherAlert("a"), 0, 300, [landing]);
  assert.ok(step.alert.suspicion > 0, "a hard landing nearby is heard");
  assert.equal(
    step.alert.state,
    "INVESTIGATING",
    "noise sends a watcher to check, and keeps him checking",
  );
  // Only eyes confirm. A guard who never saw anybody may not detect the player or
  // call the squad in.
  assert.ok(
    step.alert.suspicion <= STEALTH_TUNING.noiseSuspicionCeiling + 1e-9,
    `noise reached ${step.alert.suspicion}`,
  );
  assert.equal(step.calls, 0, "he has nothing to shout about yet");
});

test("noise does not pull down certainty a sighting already earned", () => {
  const seen = hold(createWatcherAlert("a"), 1, 120);
  assert.equal(seen.alert.suspicion, 1);
  const withNoise = hold(seen.alert, 0, 5, [
    { kind: "PLAYER_MOVE", x: 0, y: 0, z: 2, intensity: 0.5, radiusM: 12 },
  ]);
  assert.equal(withNoise.alert.suspicion, 1);
  assert.equal(withNoise.alert.state, "ALERTED");
});

test("a diversion contributes nothing to the player's own suspicion", () => {
  const step = hold(createWatcherAlert("a"), 0, 120, [
    {
      kind: "DIVERSION_IMPACT",
      x: 8,
      y: 0,
      z: 0,
      intensity: 0.7,
      radiusM: 15,
    },
  ]);
  assert.equal(step.alert.suspicion, 0, "throwing a bottle must not incriminate you");
  assert.equal(step.alert.state, "UNAWARE");
});

test("noise outside its radius is silent, not faint", () => {
  const step = hold(createWatcherAlert("a"), 0, 120, [
    { kind: "PLAYER_MOVE", x: 0, y: 0, z: 40, intensity: 1, radiusM: 10 },
  ]);
  assert.equal(step.alert.suspicion, 0);
});

// ---- attention -------------------------------------------------------------

test("a diversion turns the cone toward it, over time and not instantly", () => {
  const noise: NoiseEvent[] = [
    { kind: "DIVERSION_IMPACT", x: 10, y: 0, z: 0, intensity: 0.7, radiusM: 20 },
  ];
  let alert = createWatcherAlert("a", 0);
  const first = stepWatcherAttention(alert, {
    dt: FIELD_DT,
    tick: 0,
    seed: 1,
    position: HERE,
    baseYaw: 0,
    noise,
  });
  assert.ok(first.attentionIsDiversion, "the watcher is interested");
  assert.ok(
    Math.abs(first.yaw) <= STEALTH_TUNING.attentionTurnRadPerSecond * FIELD_DT + 1e-9,
    "the turn is rate-limited, not snapped",
  );
  alert = first;
  for (let tick = 1; tick < 60; tick++) {
    alert = stepWatcherAttention(alert, {
      dt: FIELD_DT,
      tick,
      seed: 1,
      position: HERE,
      baseYaw: 0,
      noise,
    });
  }
  // The bottle is at +X, which is yaw = PI/2 in this engine's convention.
  assert.ok(
    Math.abs(alert.yaw - Math.PI / 2) < 0.05,
    `cone ended at ${alert.yaw}, expected to face the bottle`,
  );
});

test("attention on a diversion expires and the watcher resumes its post", () => {
  const noise: NoiseEvent[] = [
    { kind: "DIVERSION_IMPACT", x: 10, y: 0, z: 0, intensity: 0.7, radiusM: 20 },
  ];
  let alert = stepWatcherAttention(createWatcherAlert("a", 0), {
    dt: FIELD_DT,
    tick: 0,
    seed: 1,
    position: HERE,
    baseYaw: 0,
    noise,
  });
  for (let tick = 1; tick < STEALTH_TUNING.diversionHoldTicks + 5; tick++) {
    alert = stepWatcherAttention(alert, {
      dt: FIELD_DT,
      tick,
      seed: 1,
      position: HERE,
      baseYaw: 0,
      noise: [],
    });
  }
  assert.equal(alert.attentionIsDiversion, false);
  assert.equal(alert.attention, null);
});

test("eyes beat ears: seeing the player overrides a diversion", () => {
  const noise: NoiseEvent[] = [
    { kind: "DIVERSION_IMPACT", x: 10, y: 0, z: 0, intensity: 0.7, radiusM: 20 },
  ];
  const attended = stepWatcherAttention(createWatcherAlert("a", 0), {
    dt: FIELD_DT,
    tick: 0,
    seed: 1,
    position: HERE,
    baseYaw: 0,
    noise,
  });
  const seen = stepWatcherAlert(attended, {
    dt: FIELD_DT,
    visibility: 1,
    playerPosition: PLAYER,
    position: HERE,
    noise,
    suspendAccrual: false,
  });
  assert.equal(seen.alert.attentionIsDiversion, false);
  assert.deepEqual(seen.alert.lastKnown, PLAYER);
});

test("the search look-around is seeded, not random", () => {
  const searched = hold(hold(createWatcherAlert("a"), 1, 120).alert, 0, 30).alert;
  assert.equal(searched.state, "SEARCHING");
  const drift = (seed: number) =>
    stepWatcherAttention(searched, {
      dt: FIELD_DT,
      tick: 300,
      seed,
      position: HERE,
      baseYaw: 0,
      noise: [],
    }).searchYawOffset;
  assert.equal(drift(7), drift(7), "the same seed and tick give the same drift");
  assert.notEqual(drift(7), drift(8), "different seeds give different drift");
});

// ---- the systemic response -------------------------------------------------

test("a first-hand sighting shouts after a beat, once", () => {
  let alert = createWatcherAlert("a");
  let calls = 0;
  let alertedAtTick = -1;
  let calledAtTick = -1;
  for (let tick = 0; tick < 400; tick++) {
    const result = stepWatcherAlert(alert, {
      dt: FIELD_DT,
      visibility: 1,
      playerPosition: PLAYER,
      position: HERE,
      noise: [],
      suspendAccrual: false,
    });
    alert = result.alert;
    if (alertedAtTick < 0 && alert.state === "ALERTED") alertedAtTick = tick;
    if (result.call) {
      calls += 1;
      if (calledAtTick < 0) calledAtTick = tick;
    }
  }
  assert.equal(calls, 1, "one shout per sighting, not one per tick");
  // The shout takes a beat, which is the window a player has to break away
  // before the rest of the squad knows.
  assert.equal(calledAtTick - alertedAtTick, STEALTH_TUNING.callDelayTicks);
});

test("a shout pulls nearby watchers in, and they cannot shout in turn", () => {
  const caller = { ...hold(createWatcherAlert("a"), 1, 120).alert, called: false };
  const near = createWatcherAlert("near");
  const far = createWatcherAlert("far");
  const positions = new Map([
    ["a", HERE],
    ["near", { x: 0, y: 0, z: STEALTH_TUNING.callRadiusM - 2 }],
    ["far", { x: 0, y: 0, z: STEALTH_TUNING.callRadiusM + 10 }],
  ]);
  const { alerts, transitions } = propagateCalls(
    [caller, near, far],
    positions,
    [{ fromId: "a", x: PLAYER.x, y: PLAYER.y, z: PLAYER.z }],
  );
  const byId = new Map(alerts.map((alert) => [alert.id, alert]));
  assert.equal(byId.get("near")!.state, "INVESTIGATING");
  assert.equal(byId.get("far")!.state, "UNAWARE");
  assert.deepEqual(byId.get("near")!.lastKnown, PLAYER);
  assert.equal(
    byId.get("near")!.firstHand,
    false,
    "a called watcher did not see the player himself",
  );
  assert.equal(
    byId.get("near")!.called,
    true,
    "a called watcher is locked out of relaying, so the response cannot cascade",
  );
  assert.deepEqual(
    transitions.map((entry) => [entry.watcherId, entry.cause]),
    [["near", "CALL"]],
  );
});

test("a shout does not de-escalate a watcher who is already alerted", () => {
  const alerted = hold(createWatcherAlert("b"), 1, 120).alert;
  const { alerts } = propagateCalls(
    [alerted],
    new Map([["b", HERE]]),
    [{ fromId: "a", x: 0, y: 0, z: 1 }],
  );
  assert.equal(alerts[0]!.state, "ALERTED");
});

test("the squad state is the loudest watcher", () => {
  assert.equal(
    squadAlertState([
      createWatcherAlert("a"),
      { ...createWatcherAlert("b"), state: "SEARCHING" },
      { ...createWatcherAlert("c"), state: "ALERTED" },
    ]),
    "ALERTED",
  );
  assert.equal(squadAlertState([createWatcherAlert("a")]), "UNAWARE");
  assert.equal(squadAlertState([]), "UNAWARE");
});

test("stepping a watcher is pure: the input state is never mutated", () => {
  const before = createWatcherAlert("a");
  const snapshot = JSON.stringify(before);
  stepWatcherAlert(before, {
    dt: FIELD_DT,
    visibility: 1,
    playerPosition: PLAYER,
    position: HERE,
    noise: [],
    suspendAccrual: false,
  });
  assert.equal(JSON.stringify(before), snapshot);
  void world();
});
