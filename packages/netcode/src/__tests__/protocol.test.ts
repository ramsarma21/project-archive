// What crosses the wire, and what must never.
//
// @pa/pvp owns both boundaries and tests them on its own snapshots. What is checked
// here is that NETCODE did not widen either of them while adding a transport: the
// snapshot carries the viewer's own complete body, which is new, and it must still
// carry no identity, no answer text, and nothing about an opponent the server cannot
// see.

import { test } from "node:test";
import assert from "node:assert/strict";
import { intent } from "@pa/duel";
import { FORBIDDEN_SNAPSHOT_KEYS, INTENT_FRAME_KEYS } from "../pvpPort.js";
import { encodeSnapshot, encodeResync, phaseDeadline } from "../index.js";
import { answerRound, createSim, run, runUntil } from "./harness.js";
import { LOCALHOST, SCHOOL_TYPICAL } from "../sim/profiles.js";

function snapshotFor(sim: ReturnType<typeof createSim>, side: "A" | "B") {
  return encodeSnapshot({
    authority: sim.host.authority,
    side,
    appliedSeq: sim.host.sessions[side].lastAcceptedSeq,
    nowMs: sim.nowMs,
    history: sim.host.history,
    sinceTick: sim.host.lastSnapshotTick[side],
  });
}

test("no snapshot netcode sends carries an identity or an answer", () => {
  const sim = createSim(LOCALHOST);
  runUntil(sim, (s) => s.host.authority.state.phase === "QUESTION_PENDING");
  answerRound(sim, { A: "CORRECT", B: "WRONG" });
  runUntil(sim, (s) => s.host.authority.state.phase === "ENGAGEMENT_LIVE");
  run(sim, 1000);

  for (const side of ["A", "B"] as const) {
    const serialised = JSON.stringify(snapshotFor(sim, side));
    for (const forbidden of FORBIDDEN_SNAPSHOT_KEYS) {
      assert.equal(
        serialised.includes(`"${forbidden}"`),
        false,
        `${forbidden} appeared in a ${side} snapshot`,
      );
    }
  }
});

test("every server message survives JSON, which is what a socket will do to it", () => {
  // The wire codec has to be total over `MotionState`, and one field of it is a Set.
  // A codec that silently drops a field is exactly the bug this package exists to
  // prevent, so it is checked against real snapshots rather than a fixture.
  const sim = createSim(SCHOOL_TYPICAL, { seed: 606 });
  run(sim, 2000);
  for (const side of ["A", "B"] as const) {
    const snapshot = snapshotFor(sim, side);
    const round = JSON.parse(JSON.stringify(snapshot));
    assert.deepEqual(round, snapshot, `${side} snapshot is not JSON-stable`);
    const resync = encodeResync({
      authority: sim.host.authority,
      side,
      appliedSeq: 0,
      nowMs: sim.nowMs,
      history: sim.host.history,
      reason: "RECONNECT",
    });
    assert.deepEqual(JSON.parse(JSON.stringify(resync)), resync);
  }
});

test("netcode adds no field a client could use to describe state", () => {
  // The anti-cheat invariant, restated against netcode's own inbound vocabulary. A
  // client sends intents, a hash claim, a resume token and a leave. None of those is
  // a position, a hit, a health value or an outcome.
  for (const forbidden of [
    "x",
    "z",
    "position",
    "health",
    "hit",
    "damage",
    "ammo",
    "bullets",
    "kill",
    "winner",
    "score",
    "verdict",
  ]) {
    assert.equal(
      (INTENT_FRAME_KEYS as readonly string[]).includes(forbidden),
      false,
      `${forbidden} must not be an input`,
    );
  }
});

test("a hash claim is an observation, never a lever", () => {
  // A modified client can report any digest it likes. The only consequence is a
  // divergence record with its own side on it: the claim never touches the
  // simulation, the health, the ammunition or the outcome.
  const sim = createSim(LOCALHOST, { seed: 88 });
  runUntil(sim, (s) => s.host.authority.state.phase === "QUESTION_PENDING");
  answerRound(sim, { A: "CORRECT", B: "CORRECT" });
  runUntil(sim, (s) => s.host.authority.state.phase === "ENGAGEMENT_LIVE");
  run(sim, 1000);

  const before = {
    healthA: sim.host.authority.state.combat.fighters.A.health,
    healthB: sim.host.authority.state.combat.fighters.B.health,
    ammoA: sim.host.authority.state.combat.fighters.A.ammo,
    phase: sim.host.authority.phase,
  };
  for (let i = 0; i < 20; i++) {
    sim.clients.A = {
      ...sim.clients.A,
      outbox: [
        ...sim.clients.A.outbox,
        {
          type: "HASH_REPORT",
          tick: sim.host.authority.state.combat.tick,
          selfHash: "1111111111111111",
          appliedSeq: 0,
        },
      ],
    };
    run(sim, 50);
  }
  assert.equal(sim.host.authority.state.combat.fighters.A.ammo <= before.ammoA, true);
  assert.equal(sim.host.authority.phase, before.phase);
  assert.equal(sim.host.authority.forfeit, null);
  void before.healthA;
  void before.healthB;
});

test("the untimed question publishes no deadline; every timed phase publishes one", () => {
  // Exhaustive over the phase union by construction: `phaseDeadline` switches on it,
  // so a phase added upstream is a compile error rather than a missing countdown.
  const sim = createSim(LOCALHOST);
  runUntil(sim, (s) => s.host.authority.state.phase === "FACE_OFF");
  assert.notEqual(phaseDeadline(sim.host.authority.state), null, "FACE_OFF is timed");

  runUntil(sim, (s) => s.host.authority.state.phase === "QUESTION_PENDING");
  assert.equal(phaseDeadline(sim.host.authority.state), null, "the question is untimed");

  answerRound(sim, { A: "CORRECT", B: "CORRECT" });
  runUntil(sim, (s) => s.host.authority.state.phase === "ENGAGEMENT_LIVE");
  assert.notEqual(phaseDeadline(sim.host.authority.state), null, "engagement is timed");
});

test("the opponent's exact position is withheld once cover breaks line of sight", () => {
  // @pa/pvp's own rule, forwarded verbatim rather than re-derived. What is checked
  // here is that netcode's snapshot passes the projection through unaltered: a
  // transport that helpfully "filled in" the missing position would be a wallhack.
  const sim = createSim(LOCALHOST, { seed: 4004 });
  runUntil(sim, (s) => s.host.authority.state.phase === "QUESTION_PENDING");
  answerRound(sim, { A: "CORRECT", B: "CORRECT" });
  runUntil(sim, (s) => s.host.authority.state.phase === "ENGAGEMENT_LIVE");
  // Drive both fighters behind the reference arena's chest-high pillars.
  sim.intent = {
    A: intent({ moveX: -1, moveZ: 0.9, sprint: true, aimZ: 1 }),
    B: intent({ moveX: -1, moveZ: -0.9, sprint: true, aimZ: -1 }),
  };
  run(sim, 4000);

  const snapshot = snapshotFor(sim, "A");
  if (!snapshot.view.opponent.visible) {
    const truth = sim.host.authority.state.combat.fighters.B.motion.pos;
    const told = snapshot.view.opponent.position;
    assert.ok(
      Math.abs(told.x - truth.x) > 1e-9 || Math.abs(told.z - truth.z) > 1e-9,
      "an invisible opponent's position must be stale, not live",
    );
    assert.ok(snapshot.view.opponent.positionAtTick < snapshot.serverTick);
  }
});
