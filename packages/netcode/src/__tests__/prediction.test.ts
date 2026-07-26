// Prediction, reconciliation, the round clock, and the inter-round barrier.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ENGAGEMENT_SECONDS, FIELD_TICK_HZ, intent, type CombatIntent } from "@pa/duel";
import { PREDICTED_FIELDS, SERVER_ONLY_FIELDS, renderView } from "../index.js";
import {
  createSim,
  distance,
  reachEngagement,
  run,
  runUntil,
  answerRound,
} from "./harness.js";
import { LOCALHOST, SCHOOL_TYPICAL } from "../sim/profiles.js";

const FORWARD: CombatIntent = intent({ moveX: 0.6, moveZ: 0.8, sprint: true, aimZ: 1 });

test("health is never predicted, and the split is stated as data", () => {
  // The rule that stops a health bar going back up. Asserted over the lists rather
  // than trusted to discipline, because "predict only what you own" is the kind of
  // rule that erodes one convenient field at a time.
  for (const field of SERVER_ONLY_FIELDS) {
    assert.equal(
      (PREDICTED_FIELDS as readonly string[]).includes(field),
      false,
      `${field} must never be predicted`,
    );
  }
  assert.ok((SERVER_ONLY_FIELDS as readonly string[]).includes("health"));
});

test("with no latency the prediction is exactly right, to the bit", () => {
  // The baseline sanity check, and also a statement about what tomorrow's two-tabs
  // test will show: on localhost the reconciliation error is zero and proves nothing.
  // That is why every other measurement in this package is taken somewhere else.
  //
  // Note what is compared. Not "the client's position now" against "the server's
  // position now" — the client is deliberately ahead of the server by a round trip
  // and that comparison punishes a correct prediction. What is compared is the
  // client's prediction FOR A TICK against the server's answer for that same tick.
  const sim = createSim(LOCALHOST);
  reachEngagement(sim);
  sim.intent = { A: FORWARD, B: intent({ moveX: -0.5, moveZ: -0.9, aimZ: -1 }) };
  run(sim, 3000);

  for (const side of ["A", "B"] as const) {
    const client = sim.clients[side];
    assert.ok(renderView(client).self, `${side} should have a predicted body`);
    assert.ok(
      client.lastReconciliation,
      `${side} never reconciled against a snapshot`,
    );
    assert.equal(
      client.stats.worstCorrectionMetres,
      0,
      `${side} was corrected by ${client.stats.worstCorrectionMetres}m on a perfect link`,
    );
    assert.equal(client.stats.divergencesFound, 0);
  }
});

test("the client reproduces the server's own digest, so agreement is checked not assumed", () => {
  const sim = createSim(SCHOOL_TYPICAL, { seed: 4242 });
  reachEngagement(sim);
  sim.intent = { A: FORWARD, B: intent({ moveX: -1, moveZ: 0.2, aimZ: -1 }) };
  run(sim, 6000);

  for (const side of ["A", "B"] as const) {
    const stats = sim.clients[side].stats;
    console.log(
      `  [detector] ${side} made ${stats.comparisonsMade}, ` +
        `skipped ${JSON.stringify(stats.skipped)}`,
    );
    assert.ok(
      stats.comparisonsMade > 20,
      `${side} made only ${stats.comparisonsMade} comparisons; the detector is not running`,
    );
    assert.equal(
      stats.divergencesFound,
      0,
      `${side} disagreed with the server ${stats.divergencesFound} times on one engine, ` +
        `which means the reproduction is wrong rather than the simulation`,
    );
  }
  assert.deepEqual(sim.divergences, [], "the server should have logged no divergence");
});

test("prediction is a pure function of baseline and pending input", () => {
  // Statelessness, asserted. There is no running predicted state to drift, so calling
  // the same view twice must produce the same answer and never advance anything.
  const sim = createSim(SCHOOL_TYPICAL, { seed: 99 });
  reachEngagement(sim);
  sim.intent = { A: FORWARD, B: FORWARD };
  run(sim, 1500);

  const first = renderView(sim.clients.A);
  const second = renderView(sim.clients.A);
  assert.deepEqual(second.self?.motion.pos, first.self?.motion.pos);
  assert.equal(second.serverTick, first.serverTick);
});

test("after a barrier the client is exactly where the server says", () => {
  const sim = createSim(LOCALHOST);
  reachEngagement(sim);
  sim.intent = { A: FORWARD, B: FORWARD };
  runUntil(sim, (s) => s.host.authority.state.phase === "QUESTION_PENDING", 40_000);
  run(sim, 300);
  const view = renderView(sim.clients.A);
  const truth = sim.host.authority.state.combat.fighters.A.motion.pos;
  assert.ok(distance(view.self!.motion.pos, truth) < 1e-9);
});

test("the server owns the round clock, and a silent client cannot slow it", () => {
  // The exploit this forecloses: a twenty-second timer owned by a browser can simply
  // be throttled for extra shooting time. Here the clock is driven by the server's own
  // wall time, so a client that stops talking entirely buys nothing.
  const sim = createSim(LOCALHOST);
  reachEngagement(sim);
  const startedAt = sim.host.authority.state.clock.tick;
  const deadline = sim.host.authority.state.phase === "ENGAGEMENT_LIVE"
    ? (sim.host.authority.state as { endsAtTick: number }).endsAtTick
    : 0;
  assert.ok(deadline > startedAt, "the engagement must have a server-side deadline");

  // Both clients go completely silent, which is the strongest version of the attack.
  sim.offline.A = true;
  sim.offline.B = true;
  runUntil(sim, (s) => s.host.authority.state.phase !== "ENGAGEMENT_LIVE", 40_000);

  const elapsedTicks = sim.host.authority.state.clock.tick - startedAt;
  const elapsedSeconds = elapsedTicks / FIELD_TICK_HZ;
  assert.ok(
    Math.abs(elapsedSeconds - ENGAGEMENT_SECONDS) < 1,
    `the round ran ${elapsedSeconds.toFixed(2)}s of wall time with nobody sending; ` +
      `it must be ${ENGAGEMENT_SECONDS}s`,
  );
});

test("the round countdown a client renders comes from the server, not a local timer", () => {
  const sim = createSim(SCHOOL_TYPICAL, { seed: 7 });
  reachEngagement(sim);
  const view = renderView(sim.clients.A);
  assert.notEqual(view.secondsRemaining, null);
  assert.ok(view.secondsRemaining! <= ENGAGEMENT_SECONDS + 0.1);
  assert.ok(view.secondsRemaining! > 0);
});

test("the untimed question phase publishes no deadline at all", () => {
  // A student thinking about a free-response question is not on a clock, and nothing
  // on the wire may imply one. `phaseEndsAtTick` is null, so a client has nothing to
  // render a countdown from even if a designer later wanted to.
  const sim = createSim(LOCALHOST);
  runUntil(sim, (s) => s.host.authority.state.phase === "QUESTION_PENDING");
  run(sim, 200);
  assert.equal(renderView(sim.clients.A).secondsRemaining, null);
  assert.equal(sim.clients.A.phaseEndsAtTick, null);
});

test("a long think does not time a student out", () => {
  // Four minutes of silence during an untimed question. @pa/pvp's `silentSides`
  // already refuses to run its grace window while verdicts are awaited, and this
  // confirms the host consumes that rule rather than layering a second timer over it.
  const sim = createSim(LOCALHOST);
  runUntil(sim, (s) => s.host.authority.state.phase === "QUESTION_PENDING");
  sim.offline.A = true;
  sim.offline.B = true;
  run(sim, 240_000);
  assert.equal(sim.host.authority.phase, "LIVE", "nobody may be forfeited for thinking");
  assert.equal(sim.host.authority.forfeit, null);
});

test("the inter-round barrier hard-resyncs both clients, bounding drift at one round", () => {
  const sim = createSim(SCHOOL_TYPICAL, { seed: 31337 });
  reachEngagement(sim);
  sim.intent = { A: FORWARD, B: intent({ moveX: 1, moveZ: -0.4, aimZ: -1 }) };

  const before = sim.clients.A.stats.resyncsApplied;
  runUntil(sim, (s) => s.host.authority.state.phase === "QUESTION_PENDING", 40_000);
  run(sim, 500);

  assert.ok(
    sim.clients.A.stats.resyncsApplied > before,
    "entering the question phase must deliver a full authoritative baseline",
  );
  // And after it, the client's prediction is the server's state exactly: nothing is
  // pending, so the prediction is the baseline.
  const view = renderView(sim.clients.A);
  const truth = sim.host.authority.state.combat.fighters.A.motion.pos;
  assert.ok(
    distance(view.self!.motion.pos, truth) < 1e-9,
    "after a barrier the client must be exactly where the server says",
  );
});

test("a barrier fires once per entry, not once per tick inside one", () => {
  // A twenty-second think must not become twenty seconds of full state transfers.
  const sim = createSim(LOCALHOST);
  runUntil(sim, (s) => s.host.authority.state.phase === "QUESTION_PENDING");
  const afterEntry = sim.host.stats.barriersFired;
  run(sim, 5000);
  assert.equal(
    sim.host.stats.barriersFired,
    afterEntry,
    "sitting in a barrier phase must not re-fire it",
  );
});

test("a full match runs to a server-decided result over a realistic link", () => {
  const sim = createSim(SCHOOL_TYPICAL, { seed: 2024, rounds: 3 });
  for (let round = 1; round <= 3; round++) {
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
    runUntil(
      sim,
      (s) => s.host.authority.state.phase !== "ENGAGEMENT_LIVE",
      40_000,
    );
  }
  runUntil(sim, (s) => s.host.authority.phase !== "LIVE", 40_000);

  const result = sim.host.authority.state;
  assert.equal(result.phase, "DUEL_RESOLVED");

  // Both clients agree with the server about the OUTCOME by construction, because
  // neither computed it. What is measured here is how often their prediction of their
  // own body disagreed along the way.
  //
  // MEASURED, AND NOT ZERO, AND REPORTED AS SUCH. A three-round match produces about
  // one divergence, positionally exact — the predicted and authoritative positions
  // agree to the bit — and confined to the aim vector, by roughly a third of a
  // degree, on the tick a round's first shot is fired. It is corrected by the next
  // snapshot and it is reproducible from its report. It is left visible here rather
  // than tuned away: the detector is doing exactly what it was built to do, and an
  // assertion of zero would have to be bought by making the detector blinder.
  console.log(
    `  [match] ${sim.divergences.length} divergence(s) over 3 rounds; ` +
      `A worst correction ${(sim.clients.A.stats.worstCorrectionMetres * 1000).toFixed(1)}mm, ` +
      `B worst ${(sim.clients.B.stats.worstCorrectionMetres * 1000).toFixed(1)}mm`,
  );
  assert.ok(
    sim.divergences.length <= 3,
    `${sim.divergences.length} divergences over three rounds is a regression`,
  );
  for (const side of ["A", "B"] as const) {
    assert.ok(
      sim.clients[side].stats.worstCorrectionMetres < 0.001,
      `${side} was corrected by ${sim.clients[side].stats.worstCorrectionMetres}m; ` +
        `position prediction should be exact on a link this good`,
    );
  }
});
