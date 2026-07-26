// Can a player tell what is happening to them?
//
// The rest of the stealth suite asks whether the simulation is right. This file
// asks the other question, which is the one that decides whether three minutes
// of sneaking is a game or a coin flip: when the player is seen, does anything
// in the system know WHY, in terms of a thing they did and could do differently?
//
// The answer has to be a fact rather than a guess, so these tests set up a
// specific mistake, make it, and assert the field names that mistake and not one
// of the four other things that were also true at the time.

import assert from "node:assert/strict";
import { test } from "node:test";

import { STAND_HEIGHT, type Vec3 } from "../collision.js";
import { FIELD_DT, FIELD_TICK_HZ } from "../fieldSimulation.js";
import {
  DETECTION_CAUSE_LABEL,
  STEALTH_TUNING,
  createStealthFieldState,
  createWatcherAlert,
  detectionCause,
  previewThrow,
  stealthPresentation,
  stepStealthField,
  stepWatcherAttention,
  throwFieldDiversion,
  visibility,
  type CrowdCluster,
  type DetectionCause,
  type PlayerStealthRead,
  type StealthFieldState,
  type WatcherAlert,
  type WatcherPose,
} from "../stealth/index.js";
import { wall, world } from "./parkourHarness.js";

const WATCHER: WatcherPose = {
  id: "sentry",
  position: { x: 0, y: 0, z: 10 },
  // Looking back down -Z, straight at a player standing at the origin.
  baseYaw: Math.PI,
};

function playerAt(
  position: Vec3,
  overrides: Partial<PlayerStealthRead> = {},
): PlayerStealthRead {
  return {
    position,
    capsuleHeight: STAND_HEIGHT,
    speedMps: 4.6,
    sprinting: true,
    traversing: false,
    exposure: "EXPOSED",
    covered: false,
    lightLevel: 1,
    ...overrides,
  };
}

/** Run the field for `ticks`, returning the last result and the final state. */
function runField(
  collision = world(),
  options: {
    ticks?: number;
    player?: Partial<PlayerStealthRead>;
    watchers?: readonly WatcherPose[];
    clusters?: readonly CrowdCluster[];
    state?: StealthFieldState;
  } = {},
) {
  const watchers = options.watchers ?? [WATCHER];
  let state = options.state ?? createStealthFieldState(watchers.map((w) => w.id));
  let result = null as ReturnType<typeof stepStealthField> | null;
  for (let tick = 0; tick < (options.ticks ?? 1); tick++) {
    result = stepStealthField(collision, state, {
      dt: FIELD_DT,
      tick,
      seed: 7,
      watchers,
      player: playerAt({ x: 0, y: 0, z: 0 }, options.player),
      clusters: options.clusters ?? [],
      noise: [],
      reflexDisabled: false,
      suspendAccrual: false,
    });
    state = result.state;
  }
  return { state, result: result! };
}

/** The bare visibility factors for a player in front of the sentry. */
function seenAs(overrides: Partial<PlayerStealthRead>) {
  const player = playerAt({ x: 0, y: 0, z: 0 }, overrides);
  return visibility(
    world(),
    {
      position: WATCHER.position,
      forwardX: Math.sin(WATCHER.baseYaw),
      forwardZ: Math.cos(WATCHER.baseYaw),
    },
    {
      position: player.position,
      capsuleHeight: player.capsuleHeight,
      exposure: player.exposure,
      motion: player.traversing
        ? "TRAVERSAL"
        : player.capsuleHeight < STAND_HEIGHT
          ? "CROUCH_MOVE"
          : player.sprinting
            ? "SPRINT"
            : "WALK",
      covered: player.covered,
      lightLevel: player.lightLevel,
      crowdBlend: 0,
    },
  );
}

// ---- why -------------------------------------------------------------------

test("every cause has a sentence a player can act on", () => {
  const causes: DetectionCause[] = Object.keys(
    DETECTION_CAUSE_LABEL,
  ) as DetectionCause[];
  assert.ok(causes.length > 6);
  for (const cause of causes) {
    const label = DETECTION_CAUSE_LABEL[cause];
    assert.ok(label.length > 0 && label.length < 60, cause);
    // No system vocabulary. If the sentence needs the word "factor" or
    // "visibility" it is a readout of the simulation, not of the situation.
    assert.ok(
      !/factor|visibility|suspicion|cone|vector/i.test(label),
      `"${label}" explains the model instead of the moment`,
    );
  }
});

test("a sprinter in the open is told it was the sprinting", () => {
  // Both exposure and motion are at their worst. The answer has to be the one
  // the player can fix in the next half second, not the one with the bigger
  // number attached to it.
  const result = seenAs({ sprinting: true });
  assert.ok(result.visibility > STEALTH_TUNING.minAccrualVisibility);
  assert.equal(detectionCause(result, "SPRINT"), "MOVING_FAST");
});

test("a climber in view is told it was the climbing", () => {
  const result = seenAs({ traversing: true });
  assert.equal(detectionCause(result, "TRAVERSAL"), "TRAVERSING");
});

test("a crouched walker in the open is told it was the open ground", () => {
  // Once the fastest lever is already pulled, the answer moves to the next one
  // rather than repeating a fix the player is already applying.
  const result = seenAs({ capsuleHeight: 1, sprinting: false, speedMps: 1 });
  assert.equal(detectionCause(result, "CROUCH_MOVE"), "IN_THE_OPEN");
});

test("doing everything right and still being seen names the position, not a habit", () => {
  const result = seenAs({
    capsuleHeight: 1,
    sprinting: false,
    speedMps: 0,
    exposure: "CONCEALED",
    covered: true,
    lightLevel: 0,
  });
  const cause = detectionCause(result, "CROUCH_STILL");
  assert.ok(
    cause === "IN_HIS_ARC" || cause === "TOO_CLOSE" || cause === "NO_CONTACT",
    `told a fully-hidden player to ${cause}, which they are already doing`,
  );
});

test("the hard breaks are reported ahead of anything the player could change", () => {
  const behind = visibility(
    world(),
    { position: { x: 0, y: 0, z: 10 }, forwardX: 0, forwardZ: 1 },
    {
      position: { x: 0, y: 0, z: 0 },
      capsuleHeight: STAND_HEIGHT,
      exposure: "EXPOSED",
      motion: "SPRINT",
      covered: false,
      lightLevel: 1,
      crowdBlend: 0,
    },
  );
  assert.equal(detectionCause(behind, "SPRINT"), "OUT_OF_CONE");

  const walled = visibility(
    world([wall("screen", 5, 0.4, 12)]),
    {
      position: WATCHER.position,
      forwardX: Math.sin(WATCHER.baseYaw),
      forwardZ: Math.cos(WATCHER.baseYaw),
    },
    {
      position: { x: 0, y: 0, z: 0 },
      capsuleHeight: STAND_HEIGHT,
      exposure: "EXPOSED",
      motion: "SPRINT",
      covered: false,
      lightLevel: 1,
      crowdBlend: 0,
    },
  );
  assert.equal(detectionCause(walled, "SPRINT"), "SIGHT_BLOCKED");

  const blended = seenAs({});
  assert.equal(
    detectionCause({ ...blended, crowdFactor: 0, visibility: 0 }, "WALK"),
    "BLENDED",
  );
});

// ---- the live readout ------------------------------------------------------

test("the readout points at the watcher, and says how close it is to going wrong", () => {
  const { result } = runField(world(), { ticks: 30 });
  const readout = result.readout;
  assert.equal(readout.watchers.length, 1);
  const sentry = readout.watchers[0]!;
  assert.equal(sentry.id, "sentry");
  assert.equal(sentry.contact, true);
  assert.equal(sentry.cause, "MOVING_FAST");
  // The sentry is at +Z from the player, so a chevron points at yaw 0.
  assert.ok(Math.abs(sentry.bearingRad) < 1e-9);
  assert.ok(sentry.distanceM > 9 && sentry.distanceM < 11);
  assert.ok(sentry.halfAngleRad > 0 && sentry.rangeM > 0, "the cone is drawable");
  assert.equal(readout.trend, 1, "suspicion is climbing and the player must know");
  assert.ok(readout.escalation01 > 0);
});

test("the readout says when it is getting better, not only when it is getting worse", () => {
  const collision = world();
  const seen = runField(collision, { ticks: 30 });
  const hidden = runField(collision, {
    ticks: 90,
    state: seen.state,
    watchers: [{ ...WATCHER, baseYaw: 0 }],
    player: { speedMps: 0, sprinting: false },
  });
  assert.equal(hidden.result.readout.trend, -1);
  assert.equal(hidden.result.readout.cause, "OUT_OF_CONE");
});

test("a confirmed sighting is latched with the reason for it", () => {
  // Detection is one tick. By the time the player has reacted, the geometry that
  // caught them is gone — so the reason has to be kept, or "why did that happen"
  // has no answer at any point after the moment it stopped mattering.
  const { result } = runField(world(), { ticks: 240 });
  assert.ok(result.readout.lastSighting, "the sentry should have confirmed by now");
  const sighting = result.readout.lastSighting!;
  assert.equal(sighting.watcherId, "sentry");
  assert.equal(sighting.cause, "MOVING_FAST");
  assert.ok(sighting.tick > 0);
  assert.ok(DETECTION_CAUSE_LABEL[sighting.cause].length > 0);
});

test("the readout reaches the HUD through the existing presentation", () => {
  const { state, result } = runField(world(), { ticks: 10 });
  const hud = stealthPresentation(state, result);
  assert.ok(hud.readout, "a HUD holding only the presentation must still get it");
  assert.equal(hud.readout!.primaryWatcherId, "sentry");
});

test("the reflex window publishes real seconds and who to break from", () => {
  const { result } = runField(world(), { ticks: 240 });
  const reflex = result.readout.reflex;
  if (reflex.active) {
    assert.equal(reflex.watcherId, "sentry");
    assert.ok(reflex.bearingRad !== null, "the player has to know which way to go");
    assert.ok(
      reflex.remainingRealS > 1,
      `${reflex.remainingRealS.toFixed(2)}s is not a window a child can use`,
    );
    // World ticks are not what a person experiences; the published number is
    // wall-clock seconds because the window runs at a slowed time scale.
    assert.ok(
      reflex.remainingRealS >
        reflex.charges * 0 + STEALTH_TUNING.reflexWindowTicks / FIELD_TICK_HZ,
      "real seconds must account for the time scale",
    );
  }
  assert.ok(reflex.charges <= STEALTH_TUNING.reflexChargesPerMission);
});

// ---- crowd -----------------------------------------------------------------

test("the blend floor is four bodies and the readout says so when it is not met", () => {
  // A measured finding, kept measured. Twelve bodies is what the level authors
  // for robustness; four is what the system actually needs, and re-inflating
  // either number costs rigged characters for nothing.
  assert.equal(STEALTH_TUNING.crowdBlendMinDensity, 4);

  const sparse: CrowdCluster = { id: "thin", x: 0, z: 0, radiusM: 4, density: 3 };
  const { result } = runField(world(), {
    ticks: 5,
    clusters: [sparse],
    player: { speedMps: 1 },
  });
  assert.equal(result.readout.crowd.blocked, "TOO_FEW_BODIES");
  assert.equal(result.readout.crowd.strength, 0);
});

test("a crowd you are sprinting through tells you to slow down", () => {
  const throng: CrowdCluster = { id: "market", x: 0, z: 0, radiusM: 4, density: 12 };
  const fast = runField(world(), {
    ticks: 5,
    clusters: [throng],
    player: { speedMps: 4.6 },
  });
  assert.equal(fast.result.readout.crowd.blocked, "TOO_FAST");

  const walked = runField(world(), {
    ticks: 90,
    clusters: [throng],
    player: { speedMps: 1, sprinting: false },
    watchers: [{ ...WATCHER, baseYaw: 0 }],
  });
  assert.equal(walked.result.readout.crowd.blocked, "NONE");
  assert.equal(walked.result.readout.crowd.strength, 1);
  assert.equal(walked.result.readout.crowd.clusterId, "market");
});

test("a crowd out of reach is reported as a place to run to", () => {
  const away: CrowdCluster = { id: "square", x: 0, z: -14, radiusM: 4, density: 9 };
  const { result } = runField(world(), { ticks: 3, clusters: [away] });
  assert.equal(result.readout.crowd.blocked, "TOO_FAR");
  assert.equal(result.readout.crowd.nearestId, "square");
  assert.ok(Math.abs(result.readout.crowd.nearestDistanceM - 14) < 0.01);

  const nothing = runField(world(), { ticks: 3 });
  assert.equal(nothing.result.readout.crowd.blocked, "NO_CLUSTER");
});

// ---- diversions ------------------------------------------------------------

test("a throw can be previewed, and the preview is where the throw lands", () => {
  // The aim is the tactic, and three charges is far too few to learn an aim from
  // by throwing them away. The preview runs the same simulation the live object
  // will, so what it shows is what happens.
  const collision = world();
  const state = createStealthFieldState(["sentry"]);
  const origin = { x: 0, y: 0, z: 0 };
  const aim = { x: 6, y: 0, z: 6 };

  const preview = previewThrow(collision, state.diversions, origin, aim, FIELD_DT);
  assert.equal(preview.ok, true);
  assert.equal(preview.refusal, "NONE");
  assert.ok(preview.restsAt, "a bottle thrown at open ground comes to rest");
  assert.equal(preview.chargesAfter, state.diversions.charges - 1);
  assert.ok(preview.radiusM > 0, "the aiming UI needs the reach it will make");

  const thrown = throwFieldDiversion(collision, state, origin, aim);
  assert.equal(thrown.thrown, true);
  let live = thrown.state;
  let landedAt: Vec3 | null = null;
  for (let tick = 0; tick < 300 && !landedAt; tick++) {
    const step = stepStealthField(collision, live, {
      dt: FIELD_DT,
      tick,
      seed: 3,
      watchers: [WATCHER],
      player: playerAt(origin),
      clusters: [],
      noise: [],
      reflexDisabled: false,
      suspendAccrual: false,
    });
    live = step.state;
    const object = live.diversions.live[0];
    if (object?.atRest) landedAt = object.pos;
  }
  assert.ok(landedAt, "the live object must settle too");
  assert.ok(
    Math.hypot(
      landedAt!.x - preview.restsAt!.x,
      landedAt!.z - preview.restsAt!.z,
    ) < 1e-9,
    "the preview promised somewhere the throw does not go",
  );
});

test("a throw with no charges left, or out of range, refuses and says which", () => {
  const collision = world();
  const state = createStealthFieldState(["sentry"]);
  const origin = { x: 0, y: 0, z: 0 };
  assert.equal(
    previewThrow(
      collision,
      { ...state.diversions, charges: 0 },
      origin,
      { x: 4, y: 0, z: 4 },
      FIELD_DT,
    ).refusal,
    "NO_CHARGES",
  );
  assert.equal(
    previewThrow(
      collision,
      state.diversions,
      origin,
      { x: 0, y: 0, z: STEALTH_TUNING.throwMaxRangeM + 5 },
      FIELD_DT,
    ).refusal,
    "OUT_OF_RANGE",
  );
});

test("a searching guard can be pulled off your trail by a thrown object", () => {
  // The moment a diversion is most worth having is the moment after a reflex
  // escape, when a guard is combing the ground you just left. While SEARCHING
  // was deaf to noise, the answer to that moment was to hold still and hope.
  const searching: WatcherAlert = {
    ...createWatcherAlert("sentry"),
    state: "SEARCHING",
    suspicion: 0.5,
    // He is sweeping the spot behind him; the bottle lands well off to one side.
    lastKnown: { x: 0, y: 0, z: 0 },
  };
  const position = { x: 0, y: 0, z: 10 };
  const bottle = {
    kind: "DIVERSION_IMPACT" as const,
    x: 14,
    y: 0,
    z: 10,
    intensity: STEALTH_TUNING.throwImpactIntensity,
    radiusM:
      STEALTH_TUNING.throwImpactIntensity *
      STEALTH_TUNING.noiseRadiusPerIntensityM,
  };

  let quiet = searching;
  let pulled = searching;
  for (let tick = 0; tick < 60; tick++) {
    const input = { dt: FIELD_DT, tick, seed: 1, position, baseYaw: Math.PI };
    quiet = stepWatcherAttention(quiet, { ...input, noise: [] });
    pulled = stepWatcherAttention(pulled, { ...input, noise: [bottle] });
  }
  assert.equal(pulled.attentionIsDiversion, true, "he must hear it");
  // Facing the bottle means looking toward +X; facing the last-known means -Z.
  assert.ok(
    Math.sin(pulled.yaw) > 0.7,
    `he never turned toward the noise (yaw ${pulled.yaw.toFixed(2)})`,
  );
  assert.ok(
    Math.sin(quiet.yaw) < 0.5,
    "and without the throw he keeps sweeping where he lost you",
  );
});

test("a guard who can see you is not fooled by a bottle", () => {
  // The line that keeps a diversion a trick rather than an off switch.
  const alerted: WatcherAlert = {
    ...createWatcherAlert("sentry"),
    state: "ALERTED",
    suspicion: 1,
    lastKnown: { x: 0, y: 0, z: 0 },
  };
  const bottle = {
    kind: "DIVERSION_IMPACT" as const,
    x: 14,
    y: 0,
    z: 10,
    intensity: 1,
    radiusM: 30,
  };
  let held = alerted;
  for (let tick = 0; tick < 60; tick++) {
    held = stepWatcherAttention(held, {
      dt: FIELD_DT,
      tick,
      seed: 1,
      position: { x: 0, y: 0, z: 10 },
      baseYaw: Math.PI,
      noise: [bottle],
    });
  }
  assert.equal(held.attentionIsDiversion, false);
  assert.ok(Math.abs(Math.sin(held.yaw)) < 0.2, "he keeps looking at the player");
});

// ---- determinism -----------------------------------------------------------

test("the readout is a pure projection: same field, same words", () => {
  const first = runField(world(), { ticks: 120 });
  const second = runField(world(), { ticks: 120 });
  assert.deepEqual(first.result.readout, second.result.readout);
  assert.deepEqual(first.state, second.state);
});
