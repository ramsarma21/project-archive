import { test } from "node:test";
import assert from "node:assert/strict";
import type { PerspectiveEncounter } from "@pa/mission-m1";
import {
  cinematicActive,
  cinematicEase,
  encounterActorDirective,
  encounterConversationShot,
  isReprieveVerdict,
  speakingGesture,
  type CinePose,
} from "../src/mission/encounterCinematic.js";
import {
  createMissionRuntime,
  encounterCinematicRead,
  stepMissionRuntime,
  type MissionInputFrame,
  type MissionRuntime,
} from "../src/mission/traversal.js";
import type { MissionInstance } from "../src/mission/levelPort.js";
import { testInstance, tickObjective } from "./missionHarness.js";

// The CINEMATIC layer is presentation over the deterministic encounter machine.
// These prove the pieces the stage relies on — the active-stop read, the camera
// blend gate/ease, the two-shot geometry, the actor performance directives, the
// speaking gesture — and prove that none of it can move a verdict.

const FRAME: MissionInputFrame = {
  dtS: 1 / 60,
  moveX: 0,
  moveZ: 0,
  sprintHeld: false,
  crouchHeld: false,
  jumpBuffered: false,
  dashBuffered: false,
  hitCellBuffered: null,
  reducedMotion: false,
  flowEnabled: true,
};

function encounter(
  id: PerspectiveEncounter["id"],
  watcherId: string,
  secondaryWatcherId: string | null,
  standoff: [number, number, number],
  secondaryStandoff: [number, number, number] | null,
): PerspectiveEncounter {
  return {
    id,
    order: id === "SHAMBLES_STOP" ? 0 : 1,
    poolId: `POOL.${id}`,
    conceptId: `CONCEPT.${id}`,
    speaker: {
      role: `Speaker ${id}`,
      watcherId,
      secondaryWatcherId,
      affiliation: "Test",
      loyalty: "Test loyalty.",
      priorities: ["One", "Two"],
      situationalHint: "A hint.",
    },
    trigger: {
      at: [0, 0, 0],
      radiusM: 6,
      speakerStandoff: standoff,
      secondaryStandoff,
      requiresGroundedApproach: id === "SHAMBLES_STOP",
    },
    reprieveWorldSeconds: 10,
    variants: [{ variantId: "V", itemId: `ITEM.${id}`, itemVersion: "v1", prompt: "Why?" }],
  };
}

function instanceWithSpeakerAndSecondary(): MissionInstance {
  const def = encounter(
    "SHAMBLES_STOP",
    "WATCH_A",
    "SENTRY_B",
    [0.6, 0, 0.6],
    [1.2, 0, -0.6],
  );
  const base = testInstance({
    // Never met, so the participation gate never resolves the run to the duel:
    // that lets the stop run all the way to RELEASED for the read to observe.
    objectives: [tickObjective("obj", Number.MAX_SAFE_INTEGER)],
    watcherIds: ["WATCH_A", "SENTRY_B"],
    watcherPosesAtTick: () => [
      { id: "WATCH_A", position: { x: 0.6, y: 0, z: 0.6 }, baseYaw: 0, capsuleHeight: 1.55 },
      { id: "SENTRY_B", position: { x: 1.2, y: 0, z: -0.6 }, baseYaw: 0, capsuleHeight: 1.55 },
    ],
  });
  return { ...base, encounters: [{ def, variant: def.variants[0]! }] };
}

function until(runtime: MissionRuntime, cond: () => boolean, budget = 2000): void {
  let n = 0;
  while (!cond() && n < budget) {
    stepMissionRuntime(runtime, FRAME);
    n += 1;
  }
  if (!cond()) throw new Error("timed out");
}

test("encounterCinematicRead is null with no stop and sequences the active stop", () => {
  const plain = createMissionRuntime({ instance: testInstance({}), seed: 1 });
  stepMissionRuntime(plain, FRAME);
  assert.equal(encounterCinematicRead(plain), null, "no encounters, no cinematic");

  const runtime = createMissionRuntime({ instance: instanceWithSpeakerAndSecondary(), seed: 7 });
  // Arms into APPROACH and the read exposes the phase and the actor ids.
  until(runtime, () => encounterCinematicRead(runtime)?.phase === "APPROACH");
  let read = encounterCinematicRead(runtime)!;
  assert.equal(read.encounterId, "SHAMBLES_STOP");
  assert.equal(read.speakerId, "WATCH_A");
  assert.equal(read.secondaryId, "SENTRY_B");
  assert.equal(read.verdictKind, null);

  until(runtime, () => encounterCinematicRead(runtime)?.phase === "QUESTION");
  runtime.encounterSubmit = "SHAMBLES_STOP";
  stepMissionRuntime(runtime, FRAME);
  assert.equal(encounterCinematicRead(runtime)?.phase, "SUBMITTING");

  runtime.encounterVerdictInbox.set("SHAMBLES_STOP", "CORRECT");
  stepMissionRuntime(runtime, FRAME);
  read = encounterCinematicRead(runtime)!;
  assert.equal(read.phase, "RESOLVED");
  assert.equal(read.verdictKind, "CORRECT", "the server verdict shows through, unaltered");

  // Once it RELEASES the cinematic read goes away and the camera eases back.
  runtime.encounterDismiss = "SHAMBLES_STOP";
  until(runtime, () => encounterCinematicRead(runtime) === null);
});

test("cinematicActive gates the camera to the four in-scene phases", () => {
  assert.equal(cinematicActive("DORMANT"), false);
  assert.equal(cinematicActive("APPROACH"), true);
  assert.equal(cinematicActive("QUESTION"), true);
  assert.equal(cinematicActive("SUBMITTING"), true);
  assert.equal(cinematicActive("RESOLVED"), true);
  assert.equal(cinematicActive("RELEASED"), false);
});

test("cinematicEase is a bounded per-frame lerp and reduced motion settles faster", () => {
  const normal = cinematicEase(false, 1 / 60);
  const reduced = cinematicEase(true, 1 / 60);
  assert.ok(normal > 0 && normal < 1, "an ease amount is a fraction");
  assert.ok(reduced > normal, "reduced motion eases harder, so it settles faster");
  // Weight converges to 1 while active and never overshoots.
  let w = 0;
  for (let i = 0; i < 240; i += 1) w += (1 - w) * cinematicEase(false, 1 / 60);
  assert.ok(w > 0.98 && w <= 1, `weight converged to ~1, got ${w}`);
});

test("the conversation shot is an over-the-shoulder from behind the player, aimed at the speaker", () => {
  const player: CinePose = { x: 0, y: 0, z: 0, yaw: 0 };
  const speaker: CinePose = { x: 0, y: 0, z: 2, yaw: Math.PI };
  const shot = encounterConversationShot({
    player,
    speaker,
    secondary: null,
    reducedMotion: false,
  });
  // Target sits between the two on the z axis, biased toward the speaker.
  assert.ok(shot.target.z > 1 && shot.target.z < 2, "target biased toward speaker");
  assert.ok(Math.abs(shot.target.x) < 0.01, "target on the conversation line");
  // Camera is BEHIND the player (negative z, opposite the speaker) at head
  // height — down the open lane, not out in the flanking stalls.
  assert.ok(shot.position.z < -2, "camera sits behind the player");
  assert.ok(Math.abs(shot.position.x) < 1.5, "only a small lateral offset, not a side shot");
  assert.ok(shot.position.y > 1.4 && shot.position.y < 1.9, "camera at head height");

  // Reduced motion sits farther back (more static framing).
  const reduced = encounterConversationShot({
    player,
    speaker,
    secondary: null,
    reducedMotion: true,
  });
  assert.ok(
    reduced.position.z < shot.position.z,
    "reduced motion frames from farther back",
  );
});

test("the shot is anchored to the actors' feet, so an elevated stop is not buried below", () => {
  // The relocated ROPEWALK_STOP happens on the Hollis Meeting leads at y≈8.2.
  // With absolute heights the camera sat at y≈1.5 — ~6.7m under the player,
  // inside the meeting-house solid, so the player answered a speaker they could
  // not see. The shot must frame from head/chest height ABOVE that roof.
  const roofY = 8.2;
  const player: CinePose = { x: 74.3, y: roofY, z: 9, yaw: 0 };
  const speaker: CinePose = { x: 74.9, y: roofY, z: 11, yaw: Math.PI };
  const shot = encounterConversationShot({
    player,
    speaker,
    secondary: null,
    reducedMotion: false,
  });
  // Camera sits a head above the roof, not down at absolute street height.
  assert.ok(
    shot.position.y > roofY + 1.3 && shot.position.y < roofY + 2.0,
    `camera at head height above the roof, got ${shot.position.y}`,
  );
  // The look target is up on the roof too, not aimed ~7m below the conversation.
  assert.ok(
    shot.target.y > roofY + 0.8 && shot.target.y < roofY + 1.8,
    `target at chest height above the roof, got ${shot.target.y}`,
  );

  // And a ground-level stop (y=0) is unchanged: heights collapse to the old
  // absolute values, so the market shot is exactly as it was.
  const ground = encounterConversationShot({
    player: { x: 0, y: 0, z: 0, yaw: 0 },
    speaker: { x: 0, y: 0, z: 2, yaw: Math.PI },
    secondary: null,
    reducedMotion: false,
  });
  assert.ok(ground.position.y > 1.4 && ground.position.y < 1.7, "ground camera unchanged");
  assert.ok(ground.target.y > 1.2 && ground.target.y < 1.5, "ground target unchanged");
});

test("the shot chooses the side away from the secondary so both officers stay in frame", () => {
  const player: CinePose = { x: 0, y: 0, z: 0, yaw: 0 };
  const speaker: CinePose = { x: 0, y: 0, z: 2, yaw: Math.PI };
  // Secondary on the +x side; the camera's small lateral offset goes -x.
  const shot = encounterConversationShot({
    player,
    speaker,
    secondary: { x: 2, y: 0, z: 1, yaw: 0 },
    reducedMotion: false,
  });
  assert.ok(shot.position.x < 0, "camera offset to the side opposite the secondary");
});

test("actor directives: speak on the question, draw on a wrong verdict, calm on a reprieve", () => {
  const speakQ = encounterActorDirective({
    phase: "QUESTION",
    verdictKind: null,
    role: "SPEAKER",
  });
  assert.deepEqual(speakQ, { clip: "idle", loopOnce: false, gesture: true, strideMps: 0 });

  const secondaryQ = encounterActorDirective({
    phase: "QUESTION",
    verdictKind: null,
    role: "SECONDARY",
  });
  assert.equal(secondaryQ.gesture, false, "only the speaker gestures");
  assert.equal(secondaryQ.clip, "idle");

  const wrong = encounterActorDirective({
    phase: "RESOLVED",
    verdictKind: "WRONG",
    role: "SPEAKER",
  });
  assert.deepEqual(wrong, { clip: "draw", loopOnce: true, gesture: false, strideMps: null });

  for (const kind of ["CORRECT", "GRANTED"] as const) {
    const reprieve = encounterActorDirective({
      phase: "RESOLVED",
      verdictKind: kind,
      role: "SPEAKER",
    });
    assert.deepEqual(reprieve, {
      clip: "idle",
      loopOnce: false,
      gesture: false,
      strideMps: 0,
    });
  }

  // Approach DECLARES the walk from the machine's known state rather than leaving
  // it to the renderer's aliased per-frame measurement (the "glitch run"): a
  // moving actor walks, strided at the true approach speed; an arrived one stands.
  const walkingUp = encounterActorDirective({
    phase: "APPROACH",
    verdictKind: null,
    role: "SPEAKER",
    moving: true,
  });
  assert.equal(walkingUp.clip, "walk");
  assert.ok(
    walkingUp.strideMps != null && walkingUp.strideMps > 0,
    "the approach walk is strided at a real ground speed",
  );
  const arrivedHold = encounterActorDirective({
    phase: "APPROACH",
    verdictKind: null,
    role: "SPEAKER",
    moving: false,
  });
  assert.deepEqual(arrivedHold, {
    clip: "idle",
    loopOnce: false,
    gesture: false,
    strideMps: 0,
  });
});

test("isReprieveVerdict treats CORRECT and GRANTED as reprieve, WRONG as pursuit", () => {
  assert.equal(isReprieveVerdict("CORRECT"), true);
  assert.equal(isReprieveVerdict("GRANTED"), true);
  assert.equal(isReprieveVerdict("WRONG"), false);
  assert.equal(isReprieveVerdict(null), false);
});

test("the speaking gesture is small and honest, and is silent under reduced motion", () => {
  assert.deepEqual(speakingGesture(1.2, true), { bobY: 0, nod: 0 });
  let maxNod = 0;
  let maxBob = 0;
  for (let t = 0; t < 4; t += 0.05) {
    const g = speakingGesture(t, false);
    maxNod = Math.max(maxNod, Math.abs(g.nod));
    maxBob = Math.max(maxBob, Math.abs(g.bobY));
  }
  assert.ok(maxNod > 0.001, "there is a visible nod");
  assert.ok(maxNod < 0.1, "the nod is restrained (< ~6 degrees)");
  assert.ok(maxBob < 0.03, "the bob is a couple of centimetres at most");
});
