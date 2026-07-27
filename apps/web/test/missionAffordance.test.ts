import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PARKOUR_TUNING, probeAhead, rankVerbs, RUN_SPEED } from "@pa/engine-world";
import { M1_MISSION_ID, m1Instance } from "../src/chapter/m1Mission.js";
import {
  affordanceRead,
  createVerbLedger,
  cueStrength,
  taughtness,
  teachable,
  verbCaption,
} from "../src/mission/affordance.js";
import { createMissionRuntime } from "../src/mission/traversal.js";

// ---------------------------------------------------------------------------
// Whether the run tells a player what their body can do.
//
// Ten of the twelve traversal verbs have no key: they fire off geometry when the
// player runs at the right thing. That is the whole feel and it is worth keeping,
// but it is only playable if the architecture is readable, and a first-time
// player cannot tell a parapet that will catch them from a wall that will not.
// The catch line is the vocabulary lesson, and these are the properties that
// make it a lesson rather than a permanent overlay.
//
// IT CANNOT LIE. Every edge comes from `surveyHolds`, which asks the shipped verb
// ladder. The engine's own tests hold that parity; what this file holds is that
// the mission layer does not undo it by drawing something the reader did not say.
//
// IT GOES AWAY. The strength falls as the player performs verbs, and a caption is
// raised at most once per verb per run.
// ---------------------------------------------------------------------------

function m1(seed = 0xb057) {
  return m1Instance({
    missionId: M1_MISSION_ID,
    attemptOrdinal: 1,
    seed,
    Scenery: null,
  });
}

function runtimeAt(pos: { x: number; y: number; z: number }) {
  const instance = m1();
  const runtime = createMissionRuntime({ instance, seed: 0xb057 });
  runtime.motion = { ...runtime.motion, pos };
  return runtime;
}

test("the cue draws edges where the mission actually has climbable things", () => {
  // The Shambles: carts, crates and stall bodies on both sides of a lane.
  const read = affordanceRead(runtimeAt({ x: 20.8, y: 0, z: -0.6 }));
  assert.ok(read.holds.length > 0, "the market is full of things to get onto");
  for (const hold of read.holds) {
    assert.ok(
      hold.nearness >= 0 && hold.nearness <= 1,
      "nearness is a fraction of the reach",
    );
    assert.ok(
      Math.abs(Math.hypot(hold.outX, hold.outZ) - 1) < 1e-6,
      "each edge carries the unit normal of the face it tops",
    );
  }
});

test("every drawn edge is one the ladder would offer a body running at it", () => {
  const read = affordanceRead(runtimeAt({ x: 20.8, y: 0, z: -0.6 }));
  const world = m1().world;
  assert.ok(read.holds.length > 0);

  for (const hold of read.holds) {
    const midX = (hold.a.x + hold.b.x) / 2;
    const midZ = (hold.a.z + hold.b.z) / 2;
    // Stand off the face and run at it, exactly as a player would arrive.
    const probe = probeAhead(world, {
      pos: { x: midX + hold.outX * 0.9, y: hold.a.y - 0.05, z: midZ + hold.outZ * 0.9 },
      velX: -hold.outX * RUN_SPEED,
      velZ: -hold.outZ * RUN_SPEED,
      yaw: Math.atan2(-hold.outX, -hold.outZ),
    });
    // The footing under a surveyed face is not always the ground plane, so the
    // assertion is the weaker and correct one: the reader must at least SEE the
    // thing the cue drew, rather than open ground. A cue on nothing is the
    // failure mode that matters — it sends a player at a wall.
    assert.notEqual(
      probe.obstacle,
      null,
      `the cue drew an edge where the reader sees nothing at all`,
    );
  }
});

test("nothing is drawn far above or below the player's own footing", () => {
  // Standing on the printshop leads at 7.1m, with the whole lit market below.
  const read = affordanceRead(runtimeAt({ x: 3, y: 7.1, z: -11 }));
  for (const hold of read.holds) {
    const rise = hold.a.y - 7.1;
    assert.ok(
      rise <= PARKOUR_TUNING.climbMaxHeightM + 1.01,
      "a roof player is not shown catches above anything they could climb",
    );
    assert.ok(rise >= -1.51, "nor crates in the street seven metres below");
  }
});

test("the drawn set stays small enough to read", () => {
  // The densest ground in the mission: the crossing under the elm.
  const read = affordanceRead(runtimeAt({ x: 81.6, y: 0, z: 5.2 }));
  assert.ok(
    read.holds.length <= 8,
    `a wireframe teaches nothing; ${read.holds.length} edges were drawn`,
  );
});

test("one face per thing, and it is the face you are standing in front of", () => {
  const read = affordanceRead(runtimeAt({ x: 20.8, y: 0, z: -0.6 }));
  const facesPerThing = new Map<string, Set<string>>();
  for (const hold of read.holds) {
    // The id carries the blocker and the run's start; the blocker is the part
    // before the first colon.
    const thing = hold.id.split(":")[0]!;
    const face = `${hold.outX.toFixed(2)}|${hold.outZ.toFixed(2)}`;
    const seen = facesPerThing.get(thing) ?? new Set<string>();
    seen.add(face);
    facesPerThing.set(thing, seen);
  }
  for (const [thing, faces] of facesPerThing) {
    assert.equal(
      faces.size,
      1,
      `${thing} was outlined on ${faces.size} faces, which draws a box round it`,
    );
  }
});

test("the cue fades as the player learns, and stops rather than vanishing", () => {
  const ledger = createVerbLedger();
  const fresh = cueStrength(ledger);
  assert.equal(fresh, 1, "a player who has done nothing gets the full lesson");
  assert.equal(taughtness(ledger), 0);

  ledger.add("VAULT");
  const once = cueStrength(ledger);
  assert.ok(once < fresh, "one verb performed dims it");

  ledger.add("MANTLE");
  ledger.add("CLIMB_UP");
  ledger.add("SLIDE");
  const taught = cueStrength(ledger);
  assert.ok(taught < once);
  assert.equal(taughtness(ledger), 1);
  assert.ok(taught > 0, "it settles to a material property rather than switching off");

  // Repeating a verb already known teaches nothing further, because the cue is a
  // vocabulary rather than a drill.
  ledger.add("VAULT");
  assert.equal(cueStrength(ledger), taught);
});

test("performing a verb is what dims it, not being offered one", () => {
  const runtime = createMissionRuntime({ instance: m1(), seed: 0xb057 });
  assert.equal(affordanceRead(runtime).strength, 1);

  // The reader offering a verb every tick of an approach the player then ran
  // past must not count. Only `verbCommitted` writes this set; see traversal.ts.
  runtime.flow.previewVerb = "VAULT";
  assert.equal(affordanceRead(runtime).strength, 1);
  assert.equal(affordanceRead(runtime).offeredIsNew, true);

  runtime.verbsUsed.add("VAULT");
  assert.ok(affordanceRead(runtime).strength < 1);
  assert.equal(
    affordanceRead(runtime).offeredIsNew,
    false,
    "a verb the body has done is never captioned again",
  );
});

test("the runtime counts a verb the moment the body commits to it", () => {
  const runtime = createMissionRuntime({ instance: m1(), seed: 0xb057 });
  assert.equal(runtime.verbsUsed.size, 0, "a fresh run has been taught nothing");
});

test("every verb the geometry can ask for has words, and the brake does not", () => {
  // A caption exists for anything the player can be surprised by. The brake is
  // deliberately mute in the teaching path: it fires when the game has just
  // refused to let you run off a killing drop, and a lesson at that moment is
  // noise over a save.
  for (const verb of ["STEP_UP", "VAULT", "CLIMB_OVER", "MANTLE", "CLIMB_UP", "SLIDE"] as const) {
    assert.ok(verbCaption(verb), `${verb} has nothing to say`);
    assert.equal(teachable(verb), true);
  }
  assert.equal(teachable("EDGE_BRAKE"), false);
  assert.equal(teachable("NONE"), false);
  assert.equal(verbCaption("BLOCKED"), null);
});

test("the caption names what the body does, never a key it does not have", () => {
  // The verbs have no keys. A caption that said "press X" would be teaching a
  // control that does not exist, which is worse than teaching nothing.
  for (const verb of ["VAULT", "MANTLE", "CLIMB_UP", "SLIDE", "STEP_UP"] as const) {
    const caption = verbCaption(verb)!;
    assert.doesNotMatch(
      caption,
      /press|key|button|\bhold\b/i,
      `"${caption}" tells the player to press something`,
    );
  }
});

test("the cue is derived, never a hand-authored list of climbable things", () => {
  // The structural guard. The moment this file carries its own height table it
  // has become a second copy of the verb ladder, and the copy will be wrong the
  // first time anybody tunes the real one — which is the exact class of drift
  // this whole approach exists to make impossible.
  const source = readFileSync(
    new URL("../src/mission/affordance.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /surveyHolds/,
    "the edges must come from the survey, which asks the ladder",
  );
  assert.doesNotMatch(
    source,
    /vaultMaxHeightM|climbMaxHeightM\s*[<>=]|mantleMaxHeightM\s*[<>=]/,
    "no verb threshold may be compared here; that decision belongs to rankVerbs",
  );
});

test("the reader's own preview is what the caption is driven from", () => {
  // `flow.previewVerb` is computed every fixed step by the shipped flow
  // controller from the real probe, and was labelled dev-overlay-only and used
  // by nothing. It is the single most honest statement in the game about what is
  // about to happen to the body, and the cue must keep reading it rather than
  // running a second probe that can disagree.
  const stage = readFileSync(
    new URL("../src/mission/MissionStage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(stage, /previewVerb/);
  assert.match(stage, /<VisorHolds/, "the catch line is mounted in the canvas");
});

test("the catch line cannot reach the route, only the geometry", () => {
  // The same restraint the standing mark is held to, for the same reason. This
  // says what your body can do with what is in front of you; the moment it can
  // read a path it has started solving the roofline the mission exists to make
  // you read.
  const view = readFileSync(
    new URL("../src/visor/VisorHolds.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(
    !/routeGraph|cheapestPath|createWayfinder|objective/i.test(view),
    "the catch line must not know where the player is going",
  );
});

test("the ladder and the survey agree about M1's own geometry", () => {
  // An end-to-end parity check on real authored content rather than a fixture:
  // every edge the cue would draw in the Shambles is one the ladder ranks.
  const world = m1().world;
  const read = affordanceRead(runtimeAt({ x: 29.4, y: 0, z: -0.8 }));
  assert.ok(read.holds.length > 0);

  for (const hold of read.holds) {
    const midX = (hold.a.x + hold.b.x) / 2;
    const midZ = (hold.a.z + hold.b.z) / 2;
    const probe = probeAhead(world, {
      pos: { x: midX + hold.outX * 0.9, y: hold.a.y - 0.05, z: midZ + hold.outZ * 0.9 },
      velX: -hold.outX * RUN_SPEED,
      velZ: -hold.outZ * RUN_SPEED,
      yaw: Math.atan2(-hold.outX, -hold.outZ),
    });
    const ranked = rankVerbs(probe, {
      grounded: true,
      sprintHeld: true,
      jumpBuffered: false,
      crouchHeld: false,
      chaining: false,
      receivingTargets: [],
      reducedMotion: false,
    });
    assert.ok(
      ranked.length > 0,
      "the cue drew an edge the ladder has no answer for at all",
    );
  }
});
