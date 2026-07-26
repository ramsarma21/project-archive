// PvP is not a second implementation. Every test in this file exercises the same
// reducer the boss duel uses, with `opponent.kind` set to REMOTE.

import { test } from "node:test";
import assert from "node:assert/strict";
import { referenceArena } from "../arena.js";
import { bossProfileForTier } from "../boss.js";
import { IDLE_INTENT, intent } from "../combat.js";
import { FIELD_DT } from "../engine.js";
import {
  duelNeedsStandingReview,
  standingEffect,
  type DuelEvent,
} from "../events.js";
import {
  answeringSides,
  createDuel,
  currentAmmo,
  duelMode,
  reduceDuel,
  roundAmmoSources,
  type DuelState,
  type OpponentSource,
} from "../machine.js";
import { BULLETS_FOR_CORRECT, BULLETS_FOR_WRONG } from "../tuning.js";
import { DUEL_SIDES } from "../sides.js";
import { questionSet, runDuel, verdictFor } from "./harness.js";
import type { VerdictKind } from "../verdict.js";

const arena = referenceArena();
const REMOTE: OpponentSource = { kind: "REMOTE", handle: "handle_kestrel" };

function start(opponent: OpponentSource = REMOTE) {
  return createDuel({
    duelId: "PVP.TEST",
    seed: 777,
    world: arena.world,
    opponent,
    questions: questionSet(),
    placement: arena.placement,
  });
}

function toQuestion(from: DuelState): DuelState {
  let state = from;
  for (let index = 0; index < 5000; index++) {
    if (state.phase === "QUESTION_PENDING") return state;
    const result = reduceDuel(state, { kind: "ADVANCE", frameDtS: FIELD_DT });
    if (!result.ok) throw new Error(result.rejection.code);
    state = result.state;
  }
  throw new Error("never reached a question");
}

test("the opponent source is the only thing that distinguishes PvP from a boss duel", () => {
  assert.deepEqual(answeringSides(REMOTE), DUEL_SIDES);
  assert.deepEqual(answeringSides({ kind: "BOSS", profile: bossProfileForTier(1) }), ["A"]);
  assert.equal(duelMode(REMOTE), "PVP");
  assert.equal(duelMode({ kind: "BOSS", profile: bossProfileForTier(1) }), "BOSS");
});

test("both players owe a verdict, and play resumes only once both have landed", () => {
  const question = toQuestion(start().state);
  if (question.phase !== "QUESTION_PENDING") throw new Error("expected a question");
  assert.deepEqual(question.awaiting, ["A", "B"]);

  const first = reduceDuel(question, {
    kind: "COMMIT_VERDICT",
    side: "A",
    verdict: verdictFor("CORRECT", question.item, "A", 1),
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.state.phase, "QUESTION_PENDING", "still waiting on the opponent");
  if (first.state.phase !== "QUESTION_PENDING") return;
  assert.deepEqual(first.state.awaiting, ["B"]);
  // Answering is untimed for both: waiting costs no duel time.
  const waited = reduceDuel(first.state, { kind: "ADVANCE", frameDtS: 45 });
  assert.equal(waited.ok, true);
  if (waited.ok) assert.equal(waited.state.clock.tick, first.state.clock.tick);

  const second = reduceDuel(first.state, {
    kind: "COMMIT_VERDICT",
    side: "B",
    verdict: verdictFor("WRONG", question.item, "B", 1),
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.state.phase, "VERDICT_COMMITTED");
});

test("the symmetric bullet table is the same reducer applied to both sides", () => {
  const rows: ReadonlyArray<readonly [VerdictKind, VerdictKind, number, number]> = [
    ["WRONG", "WRONG", BULLETS_FOR_WRONG, BULLETS_FOR_WRONG],
    ["CORRECT", "CORRECT", BULLETS_FOR_CORRECT, BULLETS_FOR_CORRECT],
    ["CORRECT", "WRONG", BULLETS_FOR_CORRECT, BULLETS_FOR_WRONG],
    ["WRONG", "CORRECT", BULLETS_FOR_WRONG, BULLETS_FOR_CORRECT],
  ];
  for (const [verdictA, verdictB, expectedA, expectedB] of rows) {
    const question = toQuestion(start().state);
    if (question.phase !== "QUESTION_PENDING") throw new Error("expected a question");
    let state: DuelState = question;
    for (const [side, kind] of [["A", verdictA], ["B", verdictB]] as const) {
      const result = reduceDuel(state, {
        kind: "COMMIT_VERDICT",
        side,
        verdict: verdictFor(kind, question.item, side, 1),
      });
      if (!result.ok) throw new Error(result.rejection.code);
      state = result.state;
    }
    assert.equal(state.phase, "VERDICT_COMMITTED");
    if (state.phase !== "VERDICT_COMMITTED") return;
    assert.deepEqual(roundAmmoSources(state.config, state.verdicts), {
      A: { kind: "VERDICT", verdict: verdictA },
      B: { kind: "VERDICT", verdict: verdictB },
    });
    const granted = reduceDuel(state, { kind: "ADVANCE", frameDtS: FIELD_DT });
    if (!granted.ok) throw new Error("grant failed");
    assert.deepEqual(currentAmmo(granted.state), { A: expectedA, B: expectedB });
  }
});

test("no side may receive an authored magazine in PvP", () => {
  const question = toQuestion(start().state);
  if (question.phase !== "QUESTION_PENDING") throw new Error("expected a question");
  // A verdict for only one side cannot produce a legal source pair, which is the
  // structural reason a PvP player can never be handed bullets.
  assert.throws(
    () =>
      roundAmmoSources(question.config, [
        { side: "A", verdict: verdictFor("CORRECT", question.item, "A", 1) },
      ]),
    /no committed verdict for answering side B/,
  );
});

test("a PvP duel runs end to end on the same machine and terminates", () => {
  const result = runDuel({
    opponent: REMOTE,
    verdicts: (side) => (side === "A" ? "CORRECT" : "WRONG"),
    roundCeiling: 3,
  });
  assert.equal(result.state.phase, "DUEL_RESOLVED");
  assert.ok(["KNOCKOUT", "ROUNDS_EXHAUSTED"].includes(result.outcome.reason));
  const verdicts = result.log.filter((event) => event.type === "VERDICT_COMMITTED");
  assert.equal(verdicts.length, 6, "two verdicts a round for three rounds");
  const grants = result.log.filter((event) => event.type === "BULLETS_GRANTED");
  assert.equal(grants.length, 6);
  for (const grant of grants) {
    if (grant.type !== "BULLETS_GRANTED") continue;
    assert.equal(grant.grant.source, "VERDICT", "never authored in PvP");
  }
});

test("the opponent's answer never reaches the player's client", () => {
  // The commit log is the only thing that leaves the authority, and it carries a
  // binary plus an opaque reference. There is no path for prose.
  const result = runDuel({ opponent: REMOTE, verdicts: () => "CORRECT", roundCeiling: 1 });
  const json = JSON.stringify(result.log.filter(isCommitted));
  assert.equal(json.includes("responseText"), false);
  assert.equal(json.includes("answer"), false);
  assert.ok(json.includes("CORRECT"), "the binary is what travels");
});

test("a true draw changes no standing and is logged for review", () => {
  const drawn = {
    winner: null,
    reason: "ROUNDS_EXHAUSTED" as const,
    healthA: 100,
    healthB: 100,
    tiebreak: "DRAWN" as const,
  };
  assert.equal(standingEffect(drawn), "NO_CHANGE_LOGGED_FOR_REVIEW");
  assert.equal(duelNeedsStandingReview(drawn), true);
  const decided = { ...drawn, winner: "A" as const, tiebreak: "HEALTH" as const };
  assert.equal(standingEffect(decided), "WINNER_TAKES");
  assert.equal(duelNeedsStandingReview(decided), false);
});

function isCommitted(event: DuelEvent): boolean {
  return (
    event.type === "VERDICT_COMMITTED" ||
    event.type === "BULLETS_GRANTED" ||
    event.type === "DUEL_RESOLVED"
  );
}

test("a remote opponent's intents come from the transport, not from a policy", () => {
  const idleRun = runDuel({
    opponent: REMOTE,
    verdicts: () => "CORRECT",
    roundCeiling: 2,
    intents: () => IDLE_INTENT,
  });
  assert.equal(idleRun.state.combat.fighters.B.shotsFired, 0, "an idle opponent does nothing");

  const activeRun = runDuel({
    opponent: REMOTE,
    verdicts: () => "CORRECT",
    roundCeiling: 2,
    intents: (side, view) =>
      side === "B"
        ? intent({
            fire: true,
            aimX: view.opponent.motion.pos.x - view.self.motion.pos.x,
            aimZ: view.opponent.motion.pos.z - view.self.motion.pos.z,
          })
        : IDLE_INTENT,
  });
  assert.ok(activeRun.state.combat.fighters.B.shotsFired > 0);
});

test("a mirror match is decided, never left ambiguous", () => {
  const result = runDuel({ opponent: REMOTE, verdicts: () => "CORRECT" });
  assert.ok(
    result.outcome.winner !== undefined,
    "an outcome always names a winner or an explicit draw",
  );
  if (result.outcome.winner === null) {
    assert.equal(result.outcome.tiebreak, "DRAWN");
  } else {
    assert.ok(["NONE", "HEALTH", "HITS_LANDED"].includes(result.outcome.tiebreak));
  }
});
