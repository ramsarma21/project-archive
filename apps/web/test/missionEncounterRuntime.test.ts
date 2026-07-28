import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIELD_TICK_HZ,
  NO_SUPPRESSION,
  isPerceptionSuppressed,
} from "@pa/engine-world";
import type { PerspectiveEncounter } from "@pa/mission-m1";
import {
  createMissionRuntime,
  disposeMissionRuntime,
  stepMissionRuntime,
  type MissionInputFrame,
  type MissionRuntime,
} from "../src/mission/traversal.js";
import type { MissionInstance } from "../src/mission/levelPort.js";
import { testInstance, tickObjective } from "./missionHarness.js";

// The runtime integration of perspective encounters, driven through the REAL
// createMissionRuntime/stepMissionRuntime — no fake components. It proves the
// participation gate, the freeze, the scoped consequences, and teardown reset.

const FRAME: MissionInputFrame = {
  dtS: 1 / 60,
  moveX: 0,
  moveZ: 0,
  sprintHeld: false,
  crouchHeld: false,
  jumpBuffered: false,
  dashBuffered: false,
  strikeBuffered: false,
  reducedMotion: false,
  flowEnabled: true,
};

/** A stop that arms at spawn, with its speaker already at the standoff. */
function encounter(
  id: PerspectiveEncounter["id"],
  watcherId: string,
  standoff: [number, number, number],
  reprieveWorldSeconds: number,
  itemId: string,
): PerspectiveEncounter {
  return {
    id,
    order: id === "SHAMBLES_STOP" ? 0 : 1,
    poolId: `POOL.${id}`,
    conceptId: `CONCEPT.${id}`,
    speaker: {
      role: `Speaker ${id}`,
      watcherId,
      secondaryWatcherId: null,
      affiliation: "Test",
      loyalty: "Test loyalty.",
      priorities: ["One", "Two"],
      situationalHint: "A hint.",
    },
    trigger: {
      at: [0, 0, 0],
      radiusM: 6,
      speakerStandoff: standoff,
      secondaryStandoff: null,
      requiresGroundedApproach: id === "SHAMBLES_STOP",
    },
    reprieveWorldSeconds,
    variants: [{ variantId: "V", itemId, itemVersion: "v1", prompt: "Why?" }],
  };
}

function instanceWithEncounters(): MissionInstance {
  const A = encounter("SHAMBLES_STOP", "WATCH_A", [0.6, 0, 0.6], 10, "ITEM.A");
  const B = encounter("ROPEWALK_STOP", "WATCH_B", [0.6, 0, -0.6], 12, "ITEM.B");
  const base = testInstance({
    // A single required objective met from the first tick, so the ONLY thing
    // standing between the run and REACHED_DUEL is encounter participation.
    objectives: [tickObjective("obj", 0)],
    watcherIds: ["WATCH_A", "WATCH_B"],
    watcherPosesAtTick: () => [
      { id: "WATCH_A", position: { x: 0.6, y: 0, z: 0.6 }, baseYaw: 0, capsuleHeight: 1.55 },
      { id: "WATCH_B", position: { x: 0.6, y: 0, z: -0.6 }, baseYaw: 0, capsuleHeight: 1.55 },
    ],
  });
  return { ...base, encounters: [{ def: A, variant: A.variants[0]! }, { def: B, variant: B.variants[0]! }] };
}

function until(
  runtime: MissionRuntime,
  cond: () => boolean,
  budget = 2000,
): void {
  let n = 0;
  while (!cond() && n < budget) {
    stepMissionRuntime(runtime, FRAME);
    n += 1;
  }
  if (!cond()) throw new Error("timed out");
}

test("traversal cannot reach the duel until both encounters have verdicts; a wrong one still completes", () => {
  const runtime = createMissionRuntime({ instance: instanceWithEncounters(), seed: 0x1234 });

  // Both stops arm and open. The route cannot resolve to the duel even though the
  // required objective is already met.
  until(runtime, () => runtime.encounters[0]!.phase === "QUESTION");
  assert.equal(runtime.encounterLocked, true, "an open question locks the player");
  assert.equal(runtime.encounterOwnsInput, true, "and owns input / freezes time");
  assert.equal(runtime.outcome, null, "the gate holds while an encounter is unresolved");

  // Answer the first stop CORRECT.
  runtime.encounterSubmit = "SHAMBLES_STOP";
  stepMissionRuntime(runtime, FRAME);
  assert.equal(runtime.encounters[0]!.phase, "SUBMITTING");
  runtime.encounterVerdictInbox.set("SHAMBLES_STOP", "CORRECT");
  stepMissionRuntime(runtime, FRAME);
  assert.equal(runtime.encounters[0]!.phase, "RESOLVED");
  const reprieveTick = runtime.clock.tick;

  // A correct answer buys a scoped, bounded LEDGER reprieve — exactly WATCH_A,
  // for exactly its window, and nobody else — as the immediate grace beat.
  assert.equal(isPerceptionSuppressed(runtime.suppression, "WATCH_A", reprieveTick + 100), true);
  assert.equal(isPerceptionSuppressed(runtime.suppression, "WATCH_B", reprieveTick + 100), false);
  assert.equal(
    isPerceptionSuppressed(runtime.suppression, "WATCH_A", reprieveTick + 10 * FIELD_TICK_HZ - 1),
    true,
    "ledger still holds one tick before its expiry",
  );
  // ...but the LEDGER lapsing is no longer what re-detects a talked-down guard.
  // A resolved-correct stop DURABLY clears its guards: WATCH_A stays cleared past
  // the ledger's expiry, and WATCH_B (unanswered) was never cleared. This is the
  // state whose absence caused the "answer him, wait, and he chases again" report.
  assert.equal(runtime.encounterClears.has("WATCH_A"), true, "the answered guard is durably cleared");
  assert.equal(runtime.encounterClears.has("WATCH_B"), false, "an unanswered guard is not cleared");

  // The route still cannot resolve: the second stop is unanswered.
  assert.equal(runtime.outcome, null);

  // Answer the second stop WRONG.
  runtime.encounterSubmit = "ROPEWALK_STOP";
  stepMissionRuntime(runtime, FRAME);
  assert.equal(runtime.encounters[1]!.phase, "SUBMITTING");
  runtime.encounterVerdictInbox.set("ROPEWALK_STOP", "WRONG");
  stepMissionRuntime(runtime, FRAME);

  // The wrong answer put WATCH_B into an active pursuit toward the confrontation.
  const wb = runtime.stealth.watchers.find((w) => w.id === "WATCH_B")!;
  assert.equal(wb.state, "INVESTIGATING");
  assert.ok(wb.lastKnown);
  assert.ok(Math.hypot(wb.lastKnown!.x, wb.lastKnown!.z) < 1.5, "toward the confrontation point");

  // Both stops have now reached a verdict — one wrong — so the route completes.
  const summaries = new Map(runtime.encounterSummaries);
  assert.equal(summaries.get("SHAMBLES_STOP")!.verdictKind, "CORRECT");
  assert.equal(summaries.get("SHAMBLES_STOP")!.reprieve, true);
  assert.equal(summaries.get("ROPEWALK_STOP")!.verdictKind, "WRONG");
  assert.equal(summaries.get("ROPEWALK_STOP")!.reprieve, false);
  assert.equal(runtime.outcome?.kind, "REACHED_DUEL", "a wrong verdict still completes the gate");
});

// The regression the owner reported, driven end to end: "even after u answer the
// guards, a few seconds later the bar goes back up and they start glitchy running
// after you again." A correct answer must DURABLY clear those guards — not for a
// countdown, but for as long as the player is still in their vicinity — so that
// standing in plain sight after resolving does not silently re-arm the pursuit.
//
// This test FAILS on the old timed-only reprieve: the ledger lapsed at
// `reprieveWorldSeconds`, and a guard whose cone still covered the motionless
// player re-accrued suspicion, climbed the alert ladder, and re-entered pursuit.
test("a resolved guard does not re-acquire a player who stays in plain sight after the reprieve window", () => {
  const REPRIEVE_S = 2;
  // The guard is posted two metres in front of the player, facing him: his cone
  // squarely covers the spawn, so on the old code he would re-detect the instant
  // the ledger lapsed. atan2(dx, dz) toward the origin from +z is exactly PI.
  const SEER = encounter("SHAMBLES_STOP", "WATCH_SEER", [0, 0, 2.2], REPRIEVE_S, "ITEM.A");
  const base = testInstance({
    objectives: [tickObjective("obj", Number.MAX_SAFE_INTEGER)],
    spawn: { pos: { x: 0, y: 0, z: 0 }, yaw: 0 },
    watcherIds: ["WATCH_SEER"],
    watcherPosesAtTick: () => [
      { id: "WATCH_SEER", position: { x: 0, y: 0, z: 2.2 }, baseYaw: Math.PI, capsuleHeight: 1.55 },
    ],
  });
  const instance: MissionInstance = {
    ...base,
    encounters: [{ def: SEER, variant: SEER.variants[0]! }],
  };
  const runtime = createMissionRuntime({ instance, seed: 0xa11ce });

  // Arm, open, answer CORRECT.
  until(runtime, () => runtime.encounters[0]!.phase === "QUESTION");
  runtime.encounterSubmit = "SHAMBLES_STOP";
  stepMissionRuntime(runtime, FRAME);
  runtime.encounterVerdictInbox.set("SHAMBLES_STOP", "CORRECT");
  until(runtime, () => runtime.encounters[0]!.phase === "RELEASED");
  const detectionsAtRelease = runtime.detections;
  assert.equal(runtime.encounterClears.has("WATCH_SEER"), true, "the answered guard is cleared on release");

  // Stand in plain sight for well past the reprieve window — the exact thing the
  // owner did when the bar climbed and the guard chased again.
  for (let frame = 0; frame < Math.round((REPRIEVE_S + 6) * 60); frame += 1) {
    stepMissionRuntime(runtime, FRAME);
  }

  const seer = runtime.stealth.watchers.find((w) => w.id === "WATCH_SEER")!;
  assert.equal(seer.state, "UNAWARE", "a talked-down guard staring at a still player stays calm");
  assert.equal(seer.suspicion, 0, "his suspicion never re-accrues while he is cleared");
  const seerPursuit = runtime.pursuit.find((p) => p.id === "WATCH_SEER")!;
  assert.ok(
    seerPursuit.phase === "POST" || seerPursuit.phase === "RETURN",
    `the pursuit never re-arms; phase is ${seerPursuit.phase}`,
  );
  assert.equal(
    runtime.detections,
    detectionsAtRelease,
    "no new detection is registered after the stop was resolved",
  );
  assert.equal(runtime.encounterClears.has("WATCH_SEER"), true, "and he stays cleared while the player lingers");

  // Leave his vicinity: the clear lifts, so a genuinely fresh approach later is
  // handled by ordinary perception rather than by this reprieve.
  runtime.motion.pos = { x: 0, y: 0, z: -40 };
  stepMissionRuntime(runtime, FRAME);
  assert.equal(runtime.encounterClears.has("WATCH_SEER"), false, "the clear lifts once the player has left");
  assert.ok(
    runtime.recentEvents.some((e) => e.kind === "ENCOUNTER_CLEAR_LIFTED"),
    "and the lift is telemetry-legible",
  );
});

test("teardown resets machines, suppression, summaries and overlay state", () => {
  const instance = instanceWithEncounters();
  const runtime = createMissionRuntime({ instance, seed: 0x99 });
  until(runtime, () => runtime.encounters[0]!.phase === "QUESTION");
  runtime.encounterSubmit = "SHAMBLES_STOP";
  stepMissionRuntime(runtime, FRAME);
  runtime.encounterVerdictInbox.set("SHAMBLES_STOP", "CORRECT");
  stepMissionRuntime(runtime, FRAME);
  assert.ok(runtime.encounterSummaries.size > 0);
  assert.notEqual(runtime.suppression, NO_SUPPRESSION);
  assert.ok(runtime.encounterClears.size > 0, "a correct answer left a durable clear");

  disposeMissionRuntime(runtime);
  assert.equal(runtime.encounters.length, 0);
  assert.equal(runtime.suppression, NO_SUPPRESSION);
  assert.equal(runtime.encounterClears.size, 0, "and teardown clears it");
  assert.equal(runtime.encounterSummaries.size, 0);
  assert.equal(runtime.encounterView, null);
  assert.equal(runtime.encounterVerdictInbox.size, 0);

  // A fresh attempt from the same instance builds clean machines and no reprieve.
  const next = createMissionRuntime({ instance, seed: 0x99 });
  assert.equal(next.encounters.length, 2);
  assert.equal(next.suppression, NO_SUPPRESSION);
  assert.equal(next.encounterView, null);
});
