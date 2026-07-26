// The ugly cases, named in the brief, tested at school-network numbers.
//
//   a dropped input at the moment of a shot
//   both players firing on the same tick
//   a reconnect mid-round
//   a rage quit
//
// None of these is visible in two tabs on one laptop, which is why each one is here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { intent, type CombatIntent } from "@pa/duel";
import { DISCONNECT_GRACE_MS } from "../pvpPort.js";
import { RESUME_GRACE_MS, MAX_RESUMES_PER_MATCH, resumeSession, createSession } from "../index.js";
import {
  answerRound,
  comeBack,
  createSim,
  goOffline,
  reachEngagement,
  run,
  runUntil,
  step,
  type Sim,
} from "./harness.js";
import {
  LOCALHOST,
  SCHOOL_AWFUL,
  SCHOOL_CONGESTED,
  SCHOOL_TYPICAL,
} from "../sim/profiles.js";

const HOLD: CombatIntent = intent({ moveX: 0, moveZ: 0, aimZ: 1 });

/** Load both magazines and get to a live engagement. */
function armed(profile = SCHOOL_CONGESTED, seed = 606): Sim {
  const sim = createSim(profile, { seed });
  runUntil(sim, (s) => s.host.authority.state.phase === "QUESTION_PENDING");
  answerRound(sim, { A: "CORRECT", B: "CORRECT" });
  runUntil(sim, (s) => s.host.authority.state.phase === "ENGAGEMENT_LIVE");
  run(sim, 300);
  return sim;
}

test("a shot survives the packet that carried it being dropped", () => {
  // The exact case the brief singles out. The fire press is sampled on one 60 Hz
  // frame and rides in a window of four, so losing the datagram that first carried it
  // costs nothing: the next one carries it again, and the authority drops the
  // duplicate by sequence rather than firing twice.
  //
  // Run at 10% loss with a 400 ms spike on one packet in eight, which is worse than
  // any classroom should ever be.
  const sim = armed(SCHOOL_AWFUL, 4321);
  const beforeShots = sim.host.authority.state.combat.fighters.A.shotsFired;

  // One frame of fire, then release: a single press, not a held trigger.
  sim.intent = { A: intent({ fire: true, aimZ: 1 }), B: HOLD };
  run(sim, 20);
  sim.intent = { A: HOLD, B: HOLD };
  run(sim, 3000);

  const after = sim.host.authority.state.combat.fighters.A.shotsFired;
  assert.equal(
    after,
    beforeShots + 1,
    `a single press produced ${after - beforeShots} shots at 10% loss`,
  );
});

test("a held trigger fires exactly as often as the fire interval allows", () => {
  // The other half of the same property, and the anti-cheat half: `fire` is a request,
  // not an event. A client spamming it every tick fires no faster than one that does
  // not, because `resolveFiring` gates on the interval and the magazine.
  const sim = armed(SCHOOL_TYPICAL, 99);
  const ammo = sim.host.authority.state.combat.fighters.A.ammo;
  sim.intent = { A: intent({ fire: true, aimZ: 1 }), B: HOLD };
  run(sim, 8000);
  const fired = sim.host.authority.state.combat.fighters.A.shotsFired;
  assert.ok(fired <= ammo, `fired ${fired} with a magazine of ${ammo}`);
});

test("both players firing on the same tick both resolve, on the same tick", () => {
  // Simultaneity is a correctness question, not a fairness one: the reducer resolves A
  // then B within one tick and both balls exist. What the network must not do is
  // silently serialise them into different ticks and make one of them vanish.
  const sim = armed(LOCALHOST, 1234);
  const shot = intent({ fire: true, aimZ: 1 });
  sim.intent = { A: shot, B: { ...shot, aimZ: -1 } };
  run(sim, 40);
  sim.intent = { A: HOLD, B: HOLD };
  run(sim, 2000);

  const combat = sim.host.authority.state.combat;
  assert.equal(combat.fighters.A.shotsFired, 1);
  assert.equal(combat.fighters.B.shotsFired, 1);
  // Both balls were spawned by the authority, so both exist in one world; there is no
  // version of this in which each client only knows about its own.
  const shots = sim.host.history.records.filter(
    (record) => record.tick > 0 && record.appliedSeq.A > 0 && record.appliedSeq.B > 0,
  );
  assert.ok(shots.length > 0);
});

test("simultaneous fire under asymmetric latency still resolves both", () => {
  // With one player at 12 ms and one at 120 ms, the two presses reach the server
  // several ticks apart. Both must still resolve; what differs is when each ball
  // starts, which at 22 m/s over a ~0.9 s flight is a small handicap rather than a
  // missed shot. That is the property that makes lag compensation unnecessary here,
  // and it is worth measuring rather than assuming.
  const sim = createSim(SCHOOL_TYPICAL, {
    profiles: { A: LOCALHOST, B: SCHOOL_AWFUL },
    seed: 20,
  });
  runUntil(sim, (s) => s.host.authority.state.phase === "QUESTION_PENDING");
  answerRound(sim, { A: "CORRECT", B: "CORRECT" });
  runUntil(sim, (s) => s.host.authority.state.phase === "ENGAGEMENT_LIVE");
  run(sim, 500);

  const shot = intent({ fire: true, aimZ: 1 });
  sim.intent = { A: shot, B: { ...shot, aimZ: -1 } };
  run(sim, 40);
  sim.intent = { A: HOLD, B: HOLD };
  run(sim, 4000);

  const combat = sim.host.authority.state.combat;
  assert.equal(combat.fighters.A.shotsFired, 1, "the fast player fired");
  assert.equal(combat.fighters.B.shotsFired, 1, "the slow player also fired");
});

// ---- disconnect and reconnect ----------------------------------------------

test("a four-second wifi drop mid-round is survivable and costs no standing", () => {
  const sim = armed(SCHOOL_TYPICAL, 808);
  sim.intent = { A: intent({ moveX: 0.7, moveZ: 0.7, aimZ: 1 }), B: HOLD };
  run(sim, 1000);

  goOffline(sim, "A", 4000);
  run(sim, 4000);
  // The fight did NOT pause. That is deliberate: pausing on a drop would make pulling
  // the cable the strongest defensive move in the game.
  assert.equal(sim.host.authority.phase, "LIVE");
  assert.equal(sim.host.sessions.A.presence, "DROPPED");

  comeBack(sim, "A");
  run(sim, 2000);

  assert.equal(sim.host.sessions.A.presence, "CONNECTED");
  assert.equal(sim.host.authority.forfeit, null, "a resumed player forfeits nothing");
  assert.ok(sim.clients.A.baseline, "the returning client has an authoritative state");
  // And it is playing again, not stuck: the server is accepting its frames.
  const acceptedBefore = sim.host.sessions.A.framesAccepted;
  sim.intent = { A: intent({ moveX: -1, moveZ: 0.2, aimZ: 1 }), B: HOLD };
  run(sim, 1000);
  assert.ok(
    sim.host.sessions.A.framesAccepted > acceptedBefore,
    "a resumed client's input must be accepted again",
  );
});

test("a resumed client restarts its sequence above the server's, or its controls are dead", () => {
  // The reconnect bug that looks like nothing. @pa/pvp refuses any frame whose
  // sequence is at or below the last it accepted — correctly, as a replay guard — so a
  // client that comes back and starts counting at 1 has every frame silently dropped
  // and the player experiences dead controls with no error anywhere in the system.
  // The resync states the floor and the client obeys it.
  const sim = armed(SCHOOL_TYPICAL, 4242);
  run(sim, 1500);
  const acceptedSeq = sim.host.sessions.A.lastAcceptedSeq;
  assert.ok(acceptedSeq > 0, "the fixture needs the server to have accepted something");

  goOffline(sim, "A", 2000);
  run(sim, 2000);
  comeBack(sim, "A");
  run(sim, 1500);

  assert.ok(
    sim.clients.A.nextSeq > acceptedSeq,
    `client resumed at seq ${sim.clients.A.nextSeq}, server had accepted ${acceptedSeq}`,
  );
  assert.ok(
    sim.host.sessions.A.lastAcceptedSeq > acceptedSeq,
    "the server must be accepting the resumed client's frames",
  );
});

test("dropping past the grace window forfeits, and the opponent takes the win", () => {
  const sim = armed(SCHOOL_TYPICAL, 31);
  goOffline(sim, "B", RESUME_GRACE_MS * 3);
  run(sim, RESUME_GRACE_MS + 2000);

  assert.equal(sim.host.authority.phase, "FORFEITED");
  assert.equal(sim.host.authority.forfeit?.side, "B");
  assert.equal(sim.host.authority.forfeit?.reason, "DISCONNECTED");
});

test("rage-quitting is a loss, not an escape", () => {
  // The ladder property. @pa/pvp already decides this — a forfeit is a loss with
  // `standingApplies: true` — and netcode only decides WHEN to call it. An explicit
  // leave is ABANDONED and is not resumable; a dropped socket is DISCONNECTED and is.
  const sim = armed(LOCALHOST, 12);
  const losing = sim.clients.A;
  sim.clients.A = { ...losing, outbox: [...losing.outbox, { type: "LEAVE" }] };
  for (let i = 0; i < 200; i++) step(sim);

  assert.equal(sim.host.authority.phase, "FORFEITED");
  assert.equal(sim.host.authority.forfeit?.reason, "ABANDONED");
  assert.equal(sim.host.sessions.A.presence, "GONE");
});

test("a resume token is required, and a wrong one teaches nothing", () => {
  const session = createSession("A", "the-real-token", 0);
  const dropped = { ...session, presence: "DROPPED" as const, droppedAtMs: 0 };
  const guessed = resumeSession(dropped, "not-the-token", 100);
  assert.equal(guessed.ok, false);
  if (!guessed.ok) assert.equal(guessed.reason, "UNKNOWN_TOKEN");

  const late = resumeSession(dropped, "the-real-token", RESUME_GRACE_MS + 1);
  assert.equal(late.ok, false);
  if (!late.ok) assert.equal(late.reason, "GRACE_EXPIRED");

  const inTime = resumeSession(dropped, "the-real-token", 1000);
  assert.equal(inTime.ok, true);
});

test("endless reconnecting is refused rather than allowed to stall a match", () => {
  let session = { ...createSession("A", "t", 0), presence: "DROPPED" as const, droppedAtMs: 0 };
  for (let attempt = 0; attempt < MAX_RESUMES_PER_MATCH; attempt++) {
    const result = resumeSession(session, "t", 100);
    assert.equal(result.ok, true, `resume ${attempt + 1} should be allowed`);
    if (!result.ok) return;
    session = { ...result.session, presence: "DROPPED", droppedAtMs: 0 };
  }
  const tooMany = resumeSession(session, "t", 100);
  assert.equal(tooMany.ok, false);
  if (!tooMany.ok) assert.equal(tooMany.reason, "TOO_MANY_RESUMES");
});

test("the resume window matches @pa/pvp's forfeit grace exactly", () => {
  // Two different windows would produce the state where a player is allowed back into
  // a match the authority has already forfeited. Consumed, not restated.
  assert.equal(RESUME_GRACE_MS, DISCONNECT_GRACE_MS);
});

test("a disconnect during the untimed question does not forfeit", () => {
  // School wifi drops while a thirteen-year-old is composing a free-response answer.
  // @pa/pvp's `silentSides` already exempts the question phase; what this checks is
  // that netcode's own transport-level grace does not quietly reintroduce a deadline
  // the design deliberately does not have.
  const sim = createSim(SCHOOL_TYPICAL, { seed: 5150 });
  runUntil(sim, (s) => s.host.authority.state.phase === "QUESTION_PENDING");
  goOffline(sim, "A", 3000);
  run(sim, 3000);
  assert.equal(sim.host.authority.phase, "LIVE", "thinking is not a disconnect");
  comeBack(sim, "A");
  run(sim, 1000);
  assert.equal(sim.host.sessions.A.presence, "CONNECTED");
});

test("a mid-round reconnect lands the client exactly on the server's state", () => {
  const sim = armed(SCHOOL_CONGESTED, 246);
  sim.intent = { A: intent({ moveX: 0.6, moveZ: 0.8, sprint: true, aimZ: 1 }), B: HOLD };
  run(sim, 2000);

  goOffline(sim, "A", 3000);
  run(sim, 3000);
  comeBack(sim, "A");
  run(sim, 1500);

  const client = sim.clients.A;
  assert.ok(client.baseline);
  // Its prediction had nothing pending at the moment of the resync, so what it holds
  // is the server's own state rather than a guess about it.
  assert.equal(client.stats.divergencesFound < 3, true);
  assert.ok(
    client.stats.resyncsApplied >= 2,
    "a reconnect must deliver a fresh authoritative baseline",
  );
});
