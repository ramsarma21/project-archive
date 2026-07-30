import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import type { FastifyBaseLogger } from "fastify";
import { resetVerdictReceiptSecretCache, type VerdictEnvelope } from "@pa/grading";

// The boss duel's grading endpoint.
//
// WHAT THIS FILE IS DEFENDING. Before the route existed, every answer took the
// client's 1.5-second abort path and was granted the maximum magazine, so a blank
// box and a perfect answer were worth the same fourteen balls. Two properties keep
// that from coming back, and both are asserted here without a network:
//
//   * The response body is EXACTLY the five keys @pa/duel's `parseVerdictEnvelope`
//     accepts. That parser rejects an unknown field by name rather than ignoring
//     it, so a sixth key does not get dropped — it fails the verdict and sends the
//     round straight back down the grant-everything path it came from. A stray
//     `receipt` or `bullets` key would therefore be indistinguishable from having
//     no route at all.
//   * A verdict is bound to one profile, one duel and one round, and is worthless
//     anywhere else.
//
// Deliberately offline, for the same reason ./pvp-grading.test.ts is: the
// classifier's accuracy is @pa/grading's to measure and it is measured there
// against a labelled set, and a unit test that needs a model credential is a unit
// test that fails in CI. What belongs here is the wiring. The live path — a real
// correct answer and a real wrong one against the same item — is exercised by
// `pnpm --filter @pa/api duel:verify:live`.

// dotenv is loaded by ../src/config.js, which anything reaching the database
// imports transitively. Pull it in DELIBERATELY and first: cleared before it runs,
// the credentials below are simply put back by it, and this file quietly becomes a
// live test that costs money and grades differently on a machine with no .env.
await import("../src/config.js");

delete process.env.TRUEFOUNDRY_API_KEY;
delete process.env.TRUEFOUNDRY_BASE_URL;
delete process.env.TRUEFOUNDRY_GRADING_API_KEY;
delete process.env.TRUEFOUNDRY_GRADING_BASE_URL;
process.env.GRADING_RECEIPT_SECRET = "test-secret-for-duel-receipt-binding";
resetVerdictReceiptSecretCache();

const { createDuelGrading, DUEL_GRADING_BUDGET_MS } = await import(
  "../src/duels/grading.js"
);
const { duelVerdictBody, registerDuelRoutes } = await import("../src/routes/duels.js");
const { DUEL_ROUND_CEILING, parseDuelRound, parseDuelVerdictRequest } = await import(
  "../src/duels/request.js"
);

const silent = {
  warn: () => undefined,
  info: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
} as unknown as FastifyBaseLogger;

const grading = createDuelGrading(silent);

const ITEM_ID = "BOS.MD01.DUEL.REP.BOSTON_DOES_ELECT.v1";
const DUEL_ID = "M1.EFFIGY_RUN#duel@1";

const BINDING = {
  profileId: "profile-a",
  attemptId: DUEL_ID,
  roundIndex: 3,
};

/**
 * @pa/duel's `VERDICT_ENVELOPE_KEYS`, restated because @pa/api does not depend on
 * the duel simulation and must not start dragging an engine into an HTTP route to
 * check five strings. The conformance between that constant and this service's
 * envelope is asserted where both are importable, in
 * `packages/grading/src/__tests__/duelConformance.test.ts`; what is asserted here
 * is that the ROUTE emits it and nothing beside it.
 */
const ENVELOPE_KEYS = ["itemId", "itemVersion", "kind", "responseRef", "source"];

const body = (answer: string) => ({
  side: "A",
  itemId: ITEM_ID,
  itemVersion: "v1",
  conceptId: "BOS.CONCEPT.REPRESENTATION.v1",
  answer,
});

// ---- the wire body ---------------------------------------------------------

test("the response body is exactly the five keys the duel's parser accepts", () => {
  const envelope: VerdictEnvelope = {
    kind: "WRONG",
    itemId: ITEM_ID,
    itemVersion: "r1-deadbeefdeadbeef",
    source: "CLASSIFIER",
    responseRef: null,
  };
  assert.deepEqual(Object.keys(duelVerdictBody(envelope)).sort(), ENVELOPE_KEYS);
});

test("a field added to the envelope upstream cannot leak onto the wire", () => {
  // The projection names its keys rather than spreading, so a richer envelope —
  // provenance, a bullet count, a confidence score — cannot arrive here by
  // omission. This is the failure the client cannot tolerate: an unknown key does
  // not get ignored, it fails the whole verdict.
  const smuggled = {
    kind: "CORRECT",
    itemId: ITEM_ID,
    itemVersion: "r1-deadbeefdeadbeef",
    source: "CLASSIFIER",
    responseRef: null,
    bullets: 14,
    confidence: "HIGH",
  } as unknown as VerdictEnvelope;
  assert.deepEqual(Object.keys(duelVerdictBody(smuggled)).sort(), ENVELOPE_KEYS);
});

// ---- what a client may send ------------------------------------------------

test("the five authored request fields are accepted verbatim", () => {
  const parsed = parseDuelVerdictRequest(body("war debt"));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ok && parsed.value.answer, "war debt");
  assert.equal(parsed.ok && parsed.value.side, "A");
});

test("a client trying to grade itself is refused by name, not silently ignored", () => {
  for (const field of [
    "kind",
    "verdict",
    "bullets",
    "ammo",
    "score",
    "correct",
    "source",
    "receipt",
  ]) {
    const parsed = parseDuelVerdictRequest({ ...body("war debt"), [field]: "CORRECT" });
    assert.equal(parsed.ok, false, `${field} was accepted`);
    assert.equal(
      !parsed.ok && parsed.code,
      "VERDICT_NOT_ACCEPTED",
      `${field} should be countable as an attempt to self-grade`,
    );
  }
});

test("any sixth field is a rejection rather than something quietly dropped", () => {
  const parsed = parseDuelVerdictRequest({ ...body("war debt"), nickname: "x" });
  assert.equal(!parsed.ok && parsed.code, "UNKNOWN_FIELD");
});

test("an empty answer is graded, not refused", () => {
  // A 400 here would be the worst possible outcome: the client reads any non-2xx
  // as unreachable and grants the FULL magazine, so refusing a blank box would pay
  // a student for writing nothing. It has to reach the grader, which decides it
  // deterministically as WRONG.
  const parsed = parseDuelVerdictRequest(body(""));
  assert.equal(parsed.ok, true);
});

test("malformed submissions are named", () => {
  assert.equal(
    !parseDuelVerdictRequest("nope").ok &&
      (parseDuelVerdictRequest("nope") as { code: string }).code,
    "NOT_AN_OBJECT",
  );
  const missing = { ...body("x") } as Record<string, unknown>;
  delete missing.conceptId;
  assert.equal(!parseDuelVerdictRequest(missing).ok, true);
  assert.equal(
    (parseDuelVerdictRequest(missing) as { code: string }).code,
    "MISSING_FIELD",
  );
  assert.equal(
    (parseDuelVerdictRequest({ ...body("x"), side: "C" }) as { code: string }).code,
    "UNKNOWN_SIDE",
  );
  assert.equal(
    (parseDuelVerdictRequest({ ...body("x"), answer: 42 }) as { code: string }).code,
    "BAD_FIELD_TYPE",
  );
  assert.equal(
    (
      parseDuelVerdictRequest({ ...body("a".repeat(4_001)) }) as { code: string }
    ).code,
    "ANSWER_TOO_LONG",
  );
});

// ---- the round bound -------------------------------------------------------

test("a long duel keeps being graded all the way to the structural ceiling", () => {
  // The bug this asserts against is documented in @pa/grading's request.ts: a
  // copied `DUEL_ROUNDS = 6` refused every verdict from round seven on, so a duel
  // that went long stopped being able to grade at exactly the point it mattered.
  for (const round of [1, 6, 7, 12, DUEL_ROUND_CEILING]) {
    const parsed = parseDuelRound(String(round));
    assert.equal(parsed.ok, true, `round ${round} must be gradable`);
    assert.equal(parsed.ok && parsed.round, round);
  }
});

test("a round the machine cannot reach is refused", () => {
  for (const raw of [
    "0",
    String(DUEL_ROUND_CEILING + 1),
    "-1",
    "1.5",
    "abc",
    "",
    " 1",
    "01e2",
    undefined,
  ]) {
    assert.equal(parseDuelRound(raw).ok, false, `"${raw}" should not name a round`);
  }
});

// ---- grading and the receipt -----------------------------------------------

test("a blank answer is WRONG even with no classifier reachable", async () => {
  // The headline defect, as an assertion. Nothing about this depends on a model:
  // an empty box abstains, and the duel's rule for an abstention is WRONG, so the
  // student gets the wrong-answer magazine rather than the full one.
  const graded = await grading.grade({
    profileId: BINDING.profileId,
    duelId: DUEL_ID,
    roundIndex: 1,
    itemId: ITEM_ID,
    answer: "   ",
  });
  assert.equal(graded.envelope.kind, "WRONG");
  assert.equal(graded.envelope.source, "ABSTAINED");
  assert.equal(graded.provenance.path, "PRE_CHECK");
  assert.deepEqual(Object.keys(duelVerdictBody(graded.envelope)).sort(), ENVELOPE_KEYS);
});

test("an unreachable classifier grants the maximum and says so", async () => {
  const graded = await grading.grade({
    profileId: BINDING.profileId,
    duelId: DUEL_ID,
    roundIndex: 2,
    itemId: ITEM_ID,
    answer: "qqqq zzzz nothing to do with the question",
  });
  // CORRECT, but CORRECT because the design grants an infrastructure failure, and
  // labelled GRADING_TIMEOUT so the review log can find it. What it is NOT is a
  // local keyword match: text with no overlap at all would score WRONG under any
  // heuristic, and there is no heuristic.
  assert.equal(graded.envelope.kind, "CORRECT");
  assert.equal(graded.envelope.source, "GRADING_TIMEOUT");
  assert.equal(graded.provenance.fallbackReason, "NOT_CONFIGURED");
  assert.equal(graded.provenance.needsReview, true);
});

test("the server's deadline sits under the client's cap, so the grant is logged", () => {
  // The client aborts at 1.5s measured from before it fetches a CSRF token. A
  // server that also spent 1.5s would always lose the race, the browser would mint
  // its own timeout verdict, and the generous grant would go unrecorded — which is
  // the one thing that makes granting on timeout indefensible.
  assert.ok(
    DUEL_GRADING_BUDGET_MS < 1_500,
    `the budget is ${DUEL_GRADING_BUDGET_MS}ms against a 1500ms client cap`,
  );
  assert.equal(grading.health.budgetMs, DUEL_GRADING_BUDGET_MS);
});

test("the verdict carries the bank's item version, never the client's claim", async () => {
  const graded = await grading.grade({
    profileId: BINDING.profileId,
    duelId: DUEL_ID,
    roundIndex: 4,
    itemId: ITEM_ID,
    answer: "war debt",
  });
  assert.equal(graded.envelope.itemId, ITEM_ID);
  // A content hash derived at compile time, not the "v1" the client sends.
  assert.match(graded.envelope.itemVersion, /^r1-[0-9a-f]{16}$/);
});

test("a minted verdict verifies for the round it was minted for", async () => {
  const graded = await grading.grade({
    profileId: BINDING.profileId,
    duelId: DUEL_ID,
    roundIndex: BINDING.roundIndex,
    itemId: ITEM_ID,
    answer: "Britain left the war owing money and decided the colonies should pay.",
  });
  assert.equal(grading.verifyReceipt(graded.envelope, BINDING, graded.receipt), true);
});

test("a receipt does not survive a change of round, duel or player", async () => {
  const graded = await grading.grade({
    profileId: BINDING.profileId,
    duelId: DUEL_ID,
    roundIndex: BINDING.roundIndex,
    itemId: ITEM_ID,
    answer: "Parliament wanted revenue from the colonies after the war.",
  });
  assert.equal(
    grading.verifyReceipt(
      graded.envelope,
      { ...BINDING, roundIndex: BINDING.roundIndex + 1 },
      graded.receipt,
    ),
    false,
    "a round-three verdict must not verify at round four",
  );
  assert.equal(
    grading.verifyReceipt(
      graded.envelope,
      { ...BINDING, attemptId: "M1.EFFIGY_RUN#duel@2" },
      graded.receipt,
    ),
    false,
    "a receipt must not survive into the next attempt's duel",
  );
  assert.equal(
    grading.verifyReceipt(
      graded.envelope,
      { ...BINDING, profileId: "profile-b" },
      graded.receipt,
    ),
    false,
    "another student must not be able to spend this receipt",
  );
});

test("a flipped verdict fails verification", async () => {
  const graded = await grading.grade({
    profileId: BINDING.profileId,
    duelId: DUEL_ID,
    roundIndex: 5,
    itemId: ITEM_ID,
    answer: "no idea",
  });
  const flipped: VerdictEnvelope = {
    ...graded.envelope,
    kind: graded.envelope.kind === "CORRECT" ? "WRONG" : "CORRECT",
  };
  assert.equal(
    grading.verifyReceipt(flipped, { ...BINDING, roundIndex: 5 }, graded.receipt),
    false,
  );
});

test("an empty receipt never verifies", async () => {
  const graded = await grading.grade({
    profileId: BINDING.profileId,
    duelId: DUEL_ID,
    roundIndex: 6,
    itemId: ITEM_ID,
    answer: "war debt",
  });
  assert.equal(grading.verifyReceipt(graded.envelope, BINDING, ""), false);
});

test("an item outside the bank is a caller error, not a grade", () => {
  assert.equal(grading.bank.get("BOS.MD01.DUEL.NOT.A.REAL.ITEM.v1"), undefined);
  assert.equal(grading.health.items, 18);
});

// ---- the route is mounted where the client posts ---------------------------

test("the endpoint the duel client posts to exists and refuses an anonymous caller", async () => {
  const app = Fastify();
  await app.register(cookie);
  await registerDuelRoutes(app, { grading });
  try {
    const anonymous = await app.inject({
      method: "POST",
      // The exact path `duelVerdictEndpoint` in apps/web builds, percent-encoded
      // the same way. A 404 here is the original bug.
      url: `/v1/duels/${encodeURIComponent(DUEL_ID)}/rounds/3/verdict`,
      payload: body("war debt"),
    });
    assert.notEqual(
      anonymous.statusCode,
      404,
      "the route the duel client posts to is not registered",
    );
    assert.equal(anonymous.statusCode, 401);
    assert.equal(anonymous.json().error, "AUTH_REQUIRED");

    const health = await app.inject({ method: "GET", url: "/v1/duels/grading/health" });
    assert.equal(health.statusCode, 401);
  } finally {
    await app.close();
  }
});
