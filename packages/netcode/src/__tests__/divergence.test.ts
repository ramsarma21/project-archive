// Turning a detection into a reproduction, which is the whole point of detecting.

import { test } from "node:test";
import assert from "node:assert/strict";
import { intent, referenceArena } from "@pa/duel";
import {
  buildDivergenceReport,
  createHistory,
  diffCombatStates,
  recordTick,
  replayDivergence,
  summariseDivergence,
} from "../index.js";
import { answerRound, createSim, run, runUntil, step } from "./harness.js";
import { SCHOOL_TYPICAL } from "../sim/profiles.js";

const arena = referenceArena();

test("the server reproduces its own history exactly, tick for tick", () => {
  // The most important determinism check in the package, and the one that has to
  // hold before any client complaint is worth reading: given the state it recorded
  // and the inputs it recorded, does the authority land on the state it recorded?
  //
  // If this ever fails, the server is non-deterministic and a ranked result is not
  // re-derivable by anybody — an auditor, a teacher, or us. Everything else here
  // assumes it, so it is checked rather than assumed.
  const sim = createSim(SCHOOL_TYPICAL, { seed: 8080 });
  runUntil(sim, (s) => s.host.authority.state.phase === "QUESTION_PENDING");
  answerRound(sim, { A: "CORRECT", B: "CORRECT" });
  runUntil(sim, (s) => s.host.authority.state.phase === "ENGAGEMENT_LIVE");
  sim.intent = {
    A: intent({ moveX: 0.5, moveZ: 0.85, sprint: true, fire: true, aimZ: 1 }),
    B: intent({ moveX: -0.9, moveZ: -0.3, dodge: true, fire: true, aimZ: -1 }),
  };
  run(sim, 5000);

  const history = sim.host.history;
  const tick = history.records[history.records.length - 1]!.tick;
  const report = buildDivergenceReport({
    kind: "SERVER_REPLAY_MISMATCH",
    matchId: sim.host.authority.identity.matchId,
    seed: sim.host.authority.identity.seed,
    side: null,
    tick,
    round: sim.host.authority.state.round,
    history,
    // A deliberately wrong claim, so the report is built; what is under test is the
    // replay, not the claim.
    reportedHash: "0000000000000000",
    params: sim.host.authority.state.params,
    observedAtMs: sim.nowMs,
  });
  assert.ok(report, "a report must be constructible from the retained history");
  assert.ok(report!.steps.length > 0);

  const replayed = replayDivergence(report!, {
    world: sim.host.authority.world,
    params: sim.host.authority.state.params,
  });
  assert.equal(
    replayed.firstChainMismatch,
    null,
    `the server did not reproduce its own tick ${replayed.firstChainMismatch}; ` +
      `the authority is non-deterministic, which is far worse than any client disagreeing`,
  );
  const truth = history.records[history.records.length - 1]!.stateHash;
  assert.equal(replayed.stateHash, truth, "the replay must land on the recorded state");
});

test("a report replays from its baseline through the exact recorded inputs", () => {
  // Same property, stated as the workflow it enables: attach a report to a bug, hand
  // it to `replayDivergence`, get the state back. No live match, no timing, no
  // network — a pure function of the report.
  const sim = createSim(SCHOOL_TYPICAL, { seed: 555 });
  runUntil(sim, (s) => s.host.authority.state.phase === "QUESTION_PENDING");
  answerRound(sim, { A: "WRONG", B: "CORRECT" });
  runUntil(sim, (s) => s.host.authority.state.phase === "ENGAGEMENT_LIVE");
  sim.intent = {
    A: intent({ moveX: 1, moveZ: 0.2, fire: true, aimZ: 1 }),
    B: intent({ moveX: -0.2, moveZ: -1, aimZ: -1 }),
  };
  run(sim, 3000);

  const history = sim.host.history;
  const tick = history.records[history.records.length - 1]!.tick;
  const report = buildDivergenceReport({
    kind: "CLIENT_SELF_MISMATCH",
    matchId: "M",
    seed: sim.host.authority.identity.seed,
    side: "A",
    tick,
    round: sim.host.authority.state.round,
    history,
    reportedHash: "deadbeefdeadbeef",
    params: sim.host.authority.state.params,
    observedAtMs: 0,
  })!;

  const replayed = replayDivergence(report, {
    world: sim.host.authority.world,
    params: sim.host.authority.state.params,
  });
  assert.equal(replayed.selfHash.A, report.expectedHash);
  assert.equal(replayed.reproducesReportedHash, false, "a bogus claim must not verify");
  assert.match(summariseDivergence(report), /CLIENT_SELF_MISMATCH/);
});

test("a real client divergence is reducible to a reproduction", () => {
  // The end-to-end workflow, on whatever the harness actually produces rather than on
  // a synthetic case. Any divergence the detector raises over a full match must come
  // with a baseline and an input log that re-derive the server's own answer.
  const sim = createSim(SCHOOL_TYPICAL, { seed: 2024, rounds: 3 });
  for (let round = 1; round <= 3 && sim.host.authority.phase === "LIVE"; round++) {
    runUntil(sim, (s) => s.host.authority.state.phase === "QUESTION_PENDING", 60_000);
    answerRound(sim, { A: "CORRECT", B: "WRONG" });
    runUntil(
      sim,
      (s) =>
        s.host.authority.state.phase === "ENGAGEMENT_LIVE" ||
        s.host.authority.phase !== "LIVE",
      20_000,
    );
    if (sim.host.authority.phase !== "LIVE") break;
    sim.intent = {
      A: intent({ moveX: 0.3, moveZ: 0.9, fire: true, aimZ: 1 }),
      B: intent({ moveX: -0.6, moveZ: -0.8, fire: true, aimZ: -1 }),
    };
    runUntil(sim, (s) => s.host.authority.state.phase !== "ENGAGEMENT_LIVE", 40_000);
  }

  for (const report of sim.divergences) {
    const replayed = replayDivergence(report, {
      world: sim.host.authority.world,
      params: sim.host.authority.state.params,
    });
    assert.equal(
      replayed.firstChainMismatch,
      null,
      `server replay diverged at tick ${replayed.firstChainMismatch}: ` +
        summariseDivergence(report),
    );
    // The report is enough to say WHAT differed, not merely that something did.
    const differences = diffCombatStates(report.baseline, replayed.state);
    assert.ok(
      Array.isArray(differences),
      "a report must be diffable against its own replay",
    );
  }
  console.log(
    `  [divergence] ${sim.divergences.length} client divergence(s) over 3 rounds, ` +
      `all reproducible from their reports`,
  );
});

test("a divergence outside the retained window is refused rather than faked", () => {
  // A client reporting on a tick from two rounds ago is either badly clocked or being
  // interesting. Returning null is the honest answer; inventing a baseline would put
  // a fabricated reproduction into an audit trail.
  const history = recordTick(createHistory(), {
    state: {
      tick: 1,
      fighters: {
        A: freshFighter("A"),
        B: freshFighter("B"),
      },
      projectiles: [],
      nextProjectileId: 1,
    },
    round: 1,
    intents: { A: intent({}), B: intent({}) },
    appliedSeq: { A: 0, B: 0 },
  });
  const report = buildDivergenceReport({
    kind: "CLIENT_SELF_MISMATCH",
    matchId: "M",
    seed: 1,
    side: "A",
    tick: 9_999,
    round: 1,
    history,
    reportedHash: "aaaaaaaaaaaaaaaa",
    params: { A: playerParamsFor(), B: playerParamsFor() },
    observedAtMs: 0,
  });
  assert.equal(report, null);
});

function freshFighter(side: "A" | "B") {
  const placement = arena.placement[side];
  return {
    side,
    motion: {
      phase: "GROUNDED" as const,
      pos: { ...placement.pos },
      vel: { x: 0, y: 0, z: 0 },
      yaw: placement.yaw,
      capsuleHeight: 1.8,
      grounded: true,
      airtimeMs: 0,
      action: null,
      dash: null,
      stagger: null,
    },
    health: 100,
    ammo: 0,
    dodge: { iframeUntilTick: 0, readyAtTick: 0 },
    fireReadyAtTick: 0,
    abilities: {},
    shotsFired: 0,
    hitsLanded: 0,
    hitsTaken: 0,
    aimX: 0,
    aimZ: 1,
  };
}

function playerParamsFor() {
  return {
    maxHealth: 100,
    shotDamage: 20,
    fireIntervalTicks: 33,
    loadout: [],
    moveSpeedScale: 1,
  };
}

test("the host records one divergence per genuine disagreement, and corrects it", () => {
  // The correction loop, end to end: a client claims a digest the server disagrees
  // with, the server logs a reproducible report and sends a hard rebase, and the
  // client comes back into agreement rather than being punished.
  const sim = createSim(SCHOOL_TYPICAL, { seed: 4747 });
  runUntil(sim, (s) => s.host.authority.state.phase === "QUESTION_PENDING");
  answerRound(sim, { A: "CORRECT", B: "CORRECT" });
  runUntil(sim, (s) => s.host.authority.state.phase === "ENGAGEMENT_LIVE");
  // A second of live play first: the combat tick is 0 the instant an engagement
  // opens, and a report about a tick the server has not simulated is correctly
  // refused rather than turned into a fabricated reproduction.
  run(sim, 1000);

  const before = sim.clients.A.stats.resyncsApplied;
  sim.clients.A = {
    ...sim.clients.A,
    outbox: [
      ...sim.clients.A.outbox,
      {
        type: "HASH_REPORT",
        tick: sim.host.authority.state.combat.tick,
        selfHash: "ffffffffffffffff",
        appliedSeq: sim.clients.A.baseline?.appliedSeq ?? 0,
      },
    ],
  };
  for (let i = 0; i < 400; i++) step(sim);

  assert.ok(sim.divergences.length >= 1, "a false claim must be recorded");
  assert.ok(
    sim.clients.A.stats.resyncsApplied > before,
    "and answered with an authoritative rebase",
  );
  // The claim changed nothing about the match: the instrument is not a lever.
  assert.equal(sim.host.authority.phase, "LIVE");
  assert.equal(sim.host.authority.forfeit, null);
});
