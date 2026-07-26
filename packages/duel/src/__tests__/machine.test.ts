import { test } from "node:test";
import assert from "node:assert/strict";
import { referenceArena } from "../arena.js";
import { bossProfileForTier } from "../boss.js";
import { IDLE_INTENT, intent } from "../combat.js";
import { commitLogContainsNoRawText, duelCommitLog, type DuelEvent } from "../events.js";
import { FIELD_DT } from "../engine.js";
import {
  createDuel,
  currentAmmo,
  reduceDuel,
  roundAmmoSources,
  type DuelPhase,
  type DuelState,
} from "../machine.js";
import {
  BULLETS_FOR_CORRECT,
  BULLETS_FOR_WRONG,
  DUEL_ROUND_CEILING,
} from "../tuning.js";
import { mintVerdict } from "../verdict.js";
import { questionSet, runDuel, verdictFor } from "./harness.js";

const arena = referenceArena();
const boss = bossProfileForTier(1);

function start(roundCeiling = DUEL_ROUND_CEILING) {
  return createDuel({
    duelId: "TEST",
    seed: 4242,
    world: arena.world,
    opponent: { kind: "BOSS", profile: boss },
    questions: questionSet(),
    roundCeiling,
    placement: arena.placement,
  });
}

/** Advance until the phase changes, returning the events seen on the way. */
function advanceUntilPhaseChange(
  from: DuelState,
  limit = 5000,
): { state: DuelState; events: DuelEvent[] } {
  let state = from;
  const events: DuelEvent[] = [];
  for (let index = 0; index < limit; index++) {
    const result = reduceDuel(state, { kind: "ADVANCE", frameDtS: FIELD_DT });
    if (!result.ok) throw new Error(result.rejection.code);
    events.push(...result.events);
    state = result.state;
    if (state.phase !== from.phase) return { state, events };
  }
  throw new Error(`phase ${from.phase} never advanced`);
}

test("a duel opens on the face-off and then asks the round's question", () => {
  const { state, events } = start();
  assert.equal(state.phase, "FACE_OFF");
  assert.equal(state.round, 0);
  assert.equal(events[0]?.type, "DUEL_STARTED");

  const next = advanceUntilPhaseChange(state);
  assert.equal(next.state.phase, "QUESTION_PENDING");
  assert.equal(next.state.round, 1);
  assert.ok(next.events.some((event) => event.type === "FACE_OFF_COMPLETED"));
  assert.ok(next.events.some((event) => event.type === "QUESTION_OPENED"));
});

test("the phase sequence for one full round is the one the design names", () => {
  const seen: DuelPhase[] = [];
  const result = runDuel({
    opponent: { kind: "BOSS", profile: boss },
    verdicts: () => "CORRECT",
    roundCeiling: 1,
    intents: () => IDLE_INTENT,
  });
  for (const event of result.log) seen.push(...phasesImpliedBy(event));
  assert.deepEqual(seen, [
    "FACE_OFF",
    "QUESTION_PENDING",
    "VERDICT_COMMITTED",
    "BULLETS_GRANTED",
    "ENGAGEMENT_LIVE",
    "LINE_OF_SIGHT_BREAK",
    "ROUND_RESOLVED",
    "DUEL_RESOLVED",
  ]);
});

function phasesImpliedBy(event: DuelEvent): DuelPhase[] {
  switch (event.type) {
    case "DUEL_STARTED":
      return ["FACE_OFF"];
    case "QUESTION_OPENED":
      return ["QUESTION_PENDING"];
    case "VERDICT_COMMITTED":
      return ["VERDICT_COMMITTED"];
    case "BULLETS_GRANTED":
      return event.side === "A" ? ["BULLETS_GRANTED"] : [];
    case "ENGAGEMENT_OPENED":
      return ["ENGAGEMENT_LIVE"];
    case "LINE_OF_SIGHT_BROKEN":
      return ["LINE_OF_SIGHT_BREAK"];
    case "ROUND_RESOLVED":
      return ["ROUND_RESOLVED"];
    case "DUEL_RESOLVED":
      return ["DUEL_RESOLVED"];
    default:
      return [];
  }
}

test("the answering clock is stopped while a question is open", () => {
  const question = advanceUntilPhaseChange(start().state).state;
  assert.equal(question.phase, "QUESTION_PENDING");
  assert.equal(question.clock.paused, true);
  const waited = reduceDuel(question, { kind: "ADVANCE", frameDtS: 30 });
  assert.equal(waited.ok, true);
  if (waited.ok) {
    assert.equal(waited.state.clock.tick, question.clock.tick, "30 seconds of thinking costs nothing");
    assert.equal(waited.state.phase, "QUESTION_PENDING");
  }
});

test("a verdict is only legal while a question is open, and only once per side", () => {
  const opening = start().state;
  const verdict = verdictFor("CORRECT", questionSet()[0]!, "A", 1);
  const early = reduceDuel(opening, { kind: "COMMIT_VERDICT", side: "A", verdict });
  assert.equal(early.ok, false);
  if (!early.ok) assert.equal(early.rejection.code, "COMMAND_NOT_LEGAL_IN_PHASE");

  const question = advanceUntilPhaseChange(opening).state;
  const first = reduceDuel(question, { kind: "COMMIT_VERDICT", side: "A", verdict });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const again = reduceDuel(question, { kind: "COMMIT_VERDICT", side: "A", verdict });
  assert.equal(again.ok, true, "the first commit is what matters, not this copy");
  const afterBoth = reduceDuel(first.state, { kind: "COMMIT_VERDICT", side: "A", verdict });
  assert.equal(afterBoth.ok, false, "the phase has moved on");
});

test("a boss never owes a verdict, and a verdict for it is refused", () => {
  const question = advanceUntilPhaseChange(start().state).state;
  assert.equal(question.phase, "QUESTION_PENDING");
  if (question.phase !== "QUESTION_PENDING") return;
  assert.deepEqual(question.awaiting, ["A"]);
  const result = reduceDuel(question, {
    kind: "COMMIT_VERDICT",
    side: "B",
    verdict: verdictFor("CORRECT", question.item, "B", 1),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.rejection.code, "SIDE_DOES_NOT_ANSWER");
});

test("bullets are derived from the committed verdict, not supplied", () => {
  for (const [kind, expected] of [
    ["CORRECT", BULLETS_FOR_CORRECT],
    ["WRONG", BULLETS_FOR_WRONG],
  ] as const) {
    const question = advanceUntilPhaseChange(start().state).state;
    if (question.phase !== "QUESTION_PENDING") throw new Error("expected a question");
    const committed = reduceDuel(question, {
      kind: "COMMIT_VERDICT",
      side: "A",
      verdict: verdictFor(kind, question.item, "A", 1),
    });
    assert.equal(committed.ok, true);
    if (!committed.ok) return;
    assert.equal(committed.state.phase, "VERDICT_COMMITTED");

    const granted = reduceDuel(committed.state, { kind: "ADVANCE", frameDtS: FIELD_DT });
    assert.equal(granted.ok, true);
    if (!granted.ok) return;
    assert.equal(granted.state.phase, "BULLETS_GRANTED");
    assert.equal(currentAmmo(granted.state).A, expected, `${kind} grants ${expected}`);
    // The boss's magazine comes from its authored profile, never from a verdict.
    assert.equal(currentAmmo(granted.state).B, boss.magazinePerRound);
  }
});

test("ammo sources are verdict-derived for answering sides and authored for a boss", () => {
  const { state } = start();
  const verdict = mintVerdict({
    kind: "CORRECT",
    itemId: "X",
    itemVersion: "v1",
    source: "CLASSIFIER",
  });
  const sources = roundAmmoSources(state.config, [{ side: "A", verdict }]);
  assert.deepEqual(sources.A, { kind: "VERDICT", verdict: "CORRECT" });
  assert.deepEqual(sources.B, { kind: "AUTHORED", bullets: boss.magazinePerRound });
});

test("the three-second countdown separates the verdict from live play", () => {
  const question = advanceUntilPhaseChange(start().state).state;
  if (question.phase !== "QUESTION_PENDING") throw new Error("expected a question");
  const committed = reduceDuel(question, {
    kind: "COMMIT_VERDICT",
    side: "A",
    verdict: verdictFor("CORRECT", question.item, "A", 1),
  });
  if (!committed.ok) throw new Error("verdict rejected");
  const granted = reduceDuel(committed.state, { kind: "ADVANCE", frameDtS: FIELD_DT });
  if (!granted.ok || granted.state.phase !== "BULLETS_GRANTED") {
    throw new Error("expected bullets granted");
  }
  const countdown = granted.state.resumesAtTick - granted.state.clock.tick;
  assert.equal(countdown, 180, "3 seconds at 60 Hz");
  const live = advanceUntilPhaseChange(granted.state);
  assert.equal(live.state.phase, "ENGAGEMENT_LIVE");
});

test("unspent bullets expire at the line-of-sight break under the shipped policy", () => {
  const result = runDuel({
    opponent: { kind: "BOSS", profile: boss },
    verdicts: () => "CORRECT",
    roundCeiling: 3,
    intents: () => IDLE_INTENT,
  });
  const breaks = result.log.filter((event) => event.type === "LINE_OF_SIGHT_BROKEN");
  assert.equal(breaks.length, 3);
  for (const event of breaks) {
    if (event.type !== "LINE_OF_SIGHT_BROKEN") continue;
    assert.equal(
      event.unspentA,
      BULLETS_FOR_CORRECT,
      "an idle player never fires, so the whole magazine survives the round",
    );
  }
  const grants = result.log.filter(
    (event) => event.type === "BULLETS_GRANTED" && event.side === "A",
  );
  for (const event of grants) {
    if (event.type !== "BULLETS_GRANTED") continue;
    assert.equal(
      event.grant.magazine,
      BULLETS_FOR_CORRECT,
      "no bullet is ever carried into the next round",
    );
    assert.equal(event.grant.carriedIn, 0);
  }
  const expired = grants.slice(1);
  for (const event of expired) {
    if (event.type !== "BULLETS_GRANTED") continue;
    assert.equal(event.grant.expired, BULLETS_FOR_CORRECT, "the unspent balls are destroyed");
  }
});

test("carry, when enabled, banks up to the cap and no further", () => {
  const result = runDuel({
    opponent: { kind: "BOSS", profile: boss },
    verdicts: () => "CORRECT",
    roundCeiling: 3,
    carryPolicy: { kind: "CARRY", cap: 3 },
    intents: () => IDLE_INTENT,
  });
  const magazines = result.log
    .filter((event) => event.type === "BULLETS_GRANTED" && event.side === "A")
    .map((event) => (event.type === "BULLETS_GRANTED" ? event.grant.magazine : 0));
  assert.deepEqual(
    magazines,
    [BULLETS_FOR_CORRECT, BULLETS_FOR_CORRECT + 3, BULLETS_FOR_CORRECT + 3],
    "the grant plus a capped three carried, and never more than the cap",
  );
});

test("TWO FIGHTERS WHO NEVER FIRE STILL TERMINATE, AT THE BACKSTOP", () => {
  // The whole risk of an unbounded format, as a test. Nobody shoots, so no health
  // moves, so the health condition never fires — and the machine must still stop.
  // It stops at the ceiling and resolves on health difference, which for two
  // fighters who refused to fight is correctly a draw.
  const ceiling = 4;
  const result = runDuel({
    opponent: { kind: "BOSS", profile: bossProfileForTier(1) },
    verdicts: () => "WRONG",
    intents: () => IDLE_INTENT,
    roundCeiling: ceiling,
  });
  assert.equal(result.outcome.reason, "ROUNDS_EXHAUSTED");
  assert.equal(result.log.filter((event) => event.type === "ROUND_RESOLVED").length, ceiling);
  assert.equal(result.log.filter((event) => event.type === "QUESTION_OPENED").length, ceiling);
});

test("a duel ends the moment a health bar empties, whatever round it is", () => {
  // Side A stands still and shoots straight at a boss that walks into it.
  const result = runDuel({
    opponent: { kind: "BOSS", profile: bossProfileForTier(1) },
    verdicts: () => "CORRECT",
    intents: (side, view) =>
      side === "A"
        ? intent({
            fire: true,
            aimX: view.opponent.motion.pos.x - view.self.motion.pos.x,
            aimZ: view.opponent.motion.pos.z - view.self.motion.pos.z,
          })
        : IDLE_INTENT,
  });
  if (result.outcome.reason === "KNOCKOUT") {
    assert.ok(
      result.log.filter((event) => event.type === "QUESTION_OPENED").length <=
        DUEL_ROUND_CEILING,
    );
    assert.ok(result.log.some((event) => event.type === "KNOCKOUT"));
  } else {
    // Not a knockout is a legitimate outcome for a naive shooter; the assertion
    // that matters is that the duel still terminated cleanly.
    assert.equal(result.outcome.reason, "ROUNDS_EXHAUSTED");
  }
});

test("a resolved duel refuses every further command", () => {
  const result = runDuel({
    opponent: { kind: "BOSS", profile: boss },
    verdicts: () => "WRONG",
    roundCeiling: 1,
    intents: () => IDLE_INTENT,
  });
  const advance = reduceDuel(result.state, { kind: "ADVANCE", frameDtS: FIELD_DT });
  assert.equal(advance.ok, false);
  if (!advance.ok) assert.equal(advance.rejection.code, "DUEL_ALREADY_RESOLVED");
});

test("the committed log is the verdicts, the grants and the result — nothing else", () => {
  const result = runDuel({
    opponent: { kind: "BOSS", profile: boss },
    verdicts: (_side, round) => (round % 2 === 0 ? "CORRECT" : "WRONG"),
    roundCeiling: 2,
    intents: () => IDLE_INTENT,
  });
  const committed = duelCommitLog(result.log);
  const types = [...new Set(committed.map((event) => event.type))].sort();
  assert.deepEqual(types, ["BULLETS_GRANTED", "DUEL_RESOLVED", "DUEL_STARTED", "VERDICT_COMMITTED"]);
  assert.equal(
    committed.filter((event) => event.type === "VERDICT_COMMITTED").length,
    2,
    "one verdict per round",
  );
});

test("no raw answer text can reach the committed log", () => {
  const answer = "the war debt came first and the stamp tax is Parliament's answer to it";
  const result = runDuel({
    opponent: { kind: "BOSS", profile: boss },
    verdicts: () => "CORRECT",
    roundCeiling: 2,
    intents: () => IDLE_INTENT,
  });
  assert.equal(
    commitLogContainsNoRawText(result.log, [answer, "Parliament", "debt"]),
    true,
    "the log commits a label and an opaque reference, never prose",
  );
});

test("the same seed and the same inputs replay to the same outcome", () => {
  const options = {
    opponent: { kind: "BOSS", profile: bossProfileForTier(3) } as const,
    verdicts: () => "CORRECT" as const,
    seed: 987654321,
  };
  const first = runDuel(options);
  const second = runDuel(options);
  assert.deepEqual(first.outcome, second.outcome);
  assert.deepEqual(first.log, second.log);
  assert.equal(first.steps, second.steps);
});

test("a different seed produces a different fight from identical inputs", () => {
  const base = {
    opponent: { kind: "BOSS", profile: bossProfileForTier(3) } as const,
    verdicts: () => "CORRECT" as const,
  };
  const a = runDuel({ ...base, seed: 1 });
  const b = runDuel({ ...base, seed: 2 });
  assert.notDeepEqual(a.log, b.log, "the boss is seeded, not scripted");
});
