import { test } from "node:test";
import assert from "node:assert/strict";
import { resetVerdictReceiptSecretCache } from "@pa/grading";

// Verifying the duel verdict receipt where the verdict is spent.
//
// WHAT THIS FILE IS DEFENDING. The receipt was minted, returned in a header, and
// never checked by anything — a signature nobody verifies reads in a review as
// though the relay were protected. The commit path now asks the question, and the
// two properties that matter pull in opposite directions:
//
//   * A receipt that is PRESENT AND WRONG must refuse, under every setting. It
//     cannot be an accident.
//   * A receipt that is ABSENT must NOT refuse while enforcement is AUDIT. The web
//     client carries the header now, but a verdict the server never minted — the
//     1.5-second cap, an unreachable authority, the stand-in — has no receipt to
//     carry, and refusing those would cost a student their mission clear over an
//     infrastructure blip.
//
// The second is the one a well-meaning tightening would break, so it is asserted
// as loudly as the first.

await import("../src/config.js");
process.env.GRADING_RECEIPT_SECRET = "test-secret-for-commit-receipt-audit";
resetVerdictReceiptSecretCache();

const { mintVerdictReceipt, verifyVerdictReceipt, verdictReceiptSecret } = await import(
  "@pa/grading"
);
const {
  auditCommittedVerdicts,
  duelIdCandidates,
  readCommittedVerdicts,
  receiptEnforcement,
  receiptRefusal,
} = await import("../src/duels/commitReceipts.js");

const PROFILE = "11111111-1111-4111-8111-111111111111";
const MISSION = "PA.SEA01.CH02.BOSTON.MD01";
const ORDINAL = 2;
const DUEL_ID = `${MISSION}#duel@${ORDINAL}`;
const CANDIDATES = duelIdCandidates({ missionId: MISSION, attemptOrdinal: ORDINAL });

/**
 * The duel id the WEB CLIENT actually posts to. A PIN OF THE OTHER SIDE.
 *
 * Restated as a literal rather than derived, and that is not laziness: the id is
 * composed in `apps/web/src/chapter/m1Mission.ts` from `M1_EFFIGY_RUN.id`, which
 * lives in @pa/mission-m1, and @pa/api depends on neither. There is no import that
 * reaches it from here, so the only honest options are a literal that says what it
 * is or an assertion about nothing — and this file has already been the second one.
 *
 * Note what it is NOT: `duelIdCandidates` rebuilds `<missionId>#duel@<ordinal>`
 * from the attempt row, and the level id carries one segment more than the mission
 * id. The two have never matched, which is the whole reason every receipt counted
 * `unbound` over a loop this file kept reporting as green.
 */
const CLIENT_DUEL_ID = `PA.SEA01.CH02.BOSTON.MD01.EFFIGY_RUN.v1#duel@${ORDINAL}`;

/** @pa/grading's own check, bound to the server's key, as the route binds it. */
const verify: Parameters<typeof auditCommittedVerdicts>[0]["verify"] = (
  envelopeValue,
  binding,
  receipt,
) => verifyVerdictReceipt(envelopeValue, binding, receipt, verdictReceiptSecret());

function envelope(kind: "CORRECT" | "WRONG", itemId = "BOS.ITEM.A.v1") {
  return {
    kind,
    itemId,
    itemVersion: "r1-a",
    source: "CLASSIFIER" as const,
    responseRef: null,
  };
}

function committed(input: {
  round: number;
  kind?: "CORRECT" | "WRONG";
  receipt?: string;
  duelId?: string;
  side?: string;
}): Record<string, unknown> {
  return {
    type: "VERDICT_COMMITTED",
    round: input.round,
    side: input.side ?? "A",
    verdict: envelope(input.kind ?? "CORRECT"),
    ...(input.receipt === undefined ? {} : { receipt: input.receipt }),
    ...(input.duelId === undefined ? {} : { duelId: input.duelId }),
  };
}

function signed(round: number, kind: "CORRECT" | "WRONG" = "CORRECT"): string {
  return mintVerdictReceipt(
    envelope(kind),
    { profileId: PROFILE, attemptId: DUEL_ID, roundIndex: round },
    verdictReceiptSecret(),
  );
}

const audit = (events: readonly unknown[]) =>
  auditCommittedVerdicts({
    profileId: PROFILE,
    events,
    duelIdCandidates: CANDIDATES,
    verify,
  });

test("the id the client posts to is the LEVEL id, which no attempt row can rebuild", () => {
  // THE ASSERTION THIS REPLACES COMPARED `duelIdCandidates` TO ITS OWN OUTPUT, so
  // it held for as long as the function was self-consistent and said nothing at
  // all about the client. Meanwhile the client posted a longer id, no receipt ever
  // matched, and every verdict committed `unbound` under a green suite.
  //
  // The attempt row holds the mission id, and the level id extends it — so the
  // reconstruction is a strict prefix of what the client posts and equality is not
  // something a different ordinal or a rename could restore.
  assert.ok(CLIENT_DUEL_ID.startsWith(`${MISSION}.`));
  assert.ok(!CANDIDATES.includes(CLIENT_DUEL_ID));
});

test("a receipt for the id the client posts verifies only when the entry names it", () => {
  const receipt = mintVerdictReceipt(
    envelope("CORRECT"),
    { profileId: PROFILE, attemptId: CLIENT_DUEL_ID, roundIndex: 1 },
    verdictReceiptSecret(),
  );

  // What the client sends now. `attachVerdictReceipts` puts `duelId` and `receipt`
  // beside `verdict` — never inside it, because the envelope is the HMAC input —
  // and this is the entry shape that closes the loop.
  const named = audit([committed({ round: 1, receipt, duelId: CLIENT_DUEL_ID })]);
  assert.equal(named.claims, 1);
  assert.equal(named.verified, 1);
  assert.equal(named.unbound, 0);
  assert.deepEqual(named.invalidRounds, []);
  assert.equal(receiptRefusal(named, "REQUIRE"), null);

  // The same receipt on the entry shape that shipped before: no duel id, so the
  // reconstruction is all there is, and it rebuilds the mission id. This is the
  // loop that never worked, asserted rather than hidden.
  const inferred = audit([committed({ round: 1, receipt })]);
  assert.equal(inferred.verified, 0);
  assert.equal(inferred.unbound, 1);
  // Unbound and NOT invalid: the shim missing is not the student's doing.
  assert.deepEqual(inferred.invalidRounds, []);
  assert.equal(receiptRefusal(inferred, "AUDIT"), null);
});

test("a server-minted receipt still verifies against the reconstructed duel id", () => {
  // The fallback is KEPT deliberately. A client whose duel id happens to match the
  // reconstruction still verifies through it, and — more importantly — a client
  // whose id does not match counts `unbound` rather than being refused, so a
  // format change can never refuse every commit in the game.
  const result = audit([
    { type: "DUEL_STARTED", seed: 1, roundCeiling: 12, bankSize: 18 },
    committed({ round: 1, receipt: signed(1) }),
    committed({ round: 2, kind: "WRONG", receipt: signed(2, "WRONG") }),
    { type: "DUEL_RESOLVED", outcome: { winner: "A" } },
  ]);
  assert.equal(result.claims, 2);
  assert.equal(result.verified, 2);
  assert.equal(result.unsigned, 0);
  assert.equal(result.invalidRounds.length, 0);
  assert.equal(receiptRefusal(result, "REQUIRE"), null);
  assert.equal(receiptRefusal(result, "AUDIT"), null);
});

test("a flipped verdict fails its own receipt and is refused under both settings", () => {
  // The attack the receipt exists for: the server said WRONG, the client commits
  // CORRECT and keeps the signature it was given.
  const receipt = signed(4, "WRONG");
  const forged = {
    ...committed({ round: 4, kind: "CORRECT", receipt, duelId: DUEL_ID }),
  };
  const result = audit([forged]);
  assert.equal(result.verified, 0);
  assert.deepEqual(result.invalidRounds, [4]);
  assert.equal(receiptRefusal(result, "AUDIT"), "VERDICT_RECEIPT_INVALID");
  assert.equal(receiptRefusal(result, "REQUIRE"), "VERDICT_RECEIPT_INVALID");
});

test("a receipt lifted from another round does not verify at the round it is spent", () => {
  const result = audit([
    committed({ round: 6, receipt: signed(1), duelId: DUEL_ID }),
  ]);
  assert.deepEqual(result.invalidRounds, [6]);
});

test("a receipt minted for another student does not verify here", () => {
  const other = mintVerdictReceipt(
    envelope("CORRECT"),
    {
      profileId: "22222222-2222-4222-8222-222222222222",
      attemptId: DUEL_ID,
      roundIndex: 1,
    },
    verdictReceiptSecret(),
  );
  const result = audit([committed({ round: 1, receipt: other, duelId: DUEL_ID })]);
  assert.deepEqual(result.invalidRounds, [1]);
});

test("an unsigned verdict is counted and NOT refused while enforcement is AUDIT", () => {
  // NOT A STATE THE CLIENT CHANGE RETIRED. `duelGrading.ts` reads the header now,
  // but it honestly returns a null receipt for every verdict the server did not
  // mint — the 1.5-second cap, an unreachable authority, the stand-in — and those
  // rounds still commit unsigned. So this stays the shape of a legitimate round
  // graded by a fallback, and refusing it would take a student's mission clear
  // away for an infrastructure blip. This is the assertion that stops a later
  // tightening doing it by accident.
  const result = audit([committed({ round: 1 }), committed({ round: 2 })]);
  assert.equal(result.claims, 2);
  assert.equal(result.unsigned, 2);
  assert.equal(result.verified, 0);
  assert.equal(receiptRefusal(result, "AUDIT"), null);
  assert.equal(receiptRefusal(result, "REQUIRE"), "VERDICT_RECEIPT_MISSING");
});

test("a receipt that binds to no known duel is unbound rather than invalid", () => {
  // The candidate id is reconstructed from a format that lives in another package.
  // If that format changes, every receipt stops matching — and treating this as
  // tampering would refuse every commit in the game. So it counts separately and
  // only REQUIRE refuses it.
  const elsewhere = mintVerdictReceipt(
    envelope("CORRECT"),
    { profileId: PROFILE, attemptId: "SOME.OTHER.DUEL@1", roundIndex: 1 },
    verdictReceiptSecret(),
  );
  const result = audit([committed({ round: 1, receipt: elsewhere })]);
  assert.equal(result.unbound, 1);
  assert.deepEqual(result.invalidRounds, []);
  assert.equal(receiptRefusal(result, "AUDIT"), null);
  assert.equal(receiptRefusal(result, "REQUIRE"), "VERDICT_RECEIPT_MISSING");
});

test("an entry that names its own duel id is checked against that and nothing else", () => {
  const otherDuel = "PA.SEA01.CH02.BOSTON.MD01#duel@3";
  const receipt = mintVerdictReceipt(
    envelope("CORRECT"),
    { profileId: PROFILE, attemptId: otherDuel, roundIndex: 1 },
    verdictReceiptSecret(),
  );
  // Verifies for the duel it names…
  assert.equal(
    audit([committed({ round: 1, receipt, duelId: otherDuel })]).verified,
    1,
  );
  // …and naming a duel it was not minted for is tampering, not a shim miss.
  assert.deepEqual(
    audit([committed({ round: 1, receipt, duelId: DUEL_ID })]).invalidRounds,
    [1],
  );
});

test("the boss's side is not audited and an empty log is not a refusal", () => {
  // Side B owes no verdict: its magazine comes from an authored profile, so there
  // is no receipt that could exist for it and its presence must not read as an
  // unsigned player verdict.
  const result = audit([committed({ round: 1, side: "B" })]);
  assert.equal(result.claims, 0);
  assert.equal(result.unsigned, 0);
  assert.equal(receiptRefusal(result, "REQUIRE"), null);

  // A mission can be failed before its duel opens, and the web client currently
  // drops the whole log when the request guard refuses it, so a log with no
  // verdicts has to stay a legal commit even under REQUIRE.
  const empty = audit([{ type: "DUEL_RESOLVED", outcome: { winner: "B" } }]);
  assert.equal(empty.claims, 0);
  assert.equal(receiptRefusal(empty, "REQUIRE"), null);
});

test("an entry that is not shaped like a verdict is malformed, never verified", () => {
  // The envelope is HMAC input. A field of the wrong type would build a different
  // message and fail for a reason that looks like tampering, so it is named.
  const result = readCommittedVerdicts([
    { type: "VERDICT_COMMITTED", round: 1, side: "A", verdict: { kind: "MAYBE" } },
    { type: "VERDICT_COMMITTED", round: "one", side: "A", verdict: envelope("CORRECT") },
    { type: "VERDICT_COMMITTED", round: 2, side: "A", verdict: null },
  ]);
  assert.equal(result.claims.length, 0);
  assert.equal(result.malformed, 3);
  // Malformed cannot be authenticated, so REQUIRE refuses it and AUDIT does not.
  const full = audit([
    { type: "VERDICT_COMMITTED", round: 1, side: "A", verdict: { kind: "MAYBE" } },
  ]);
  assert.equal(full.malformed, 1);
  assert.equal(receiptRefusal(full, "AUDIT"), null);
  assert.equal(receiptRefusal(full, "REQUIRE"), "VERDICT_RECEIPT_MISSING");
});

test("with no verifier wired nothing authenticates, rather than everything passing", () => {
  const result = auditCommittedVerdicts({
    profileId: PROFILE,
    events: [committed({ round: 1, receipt: signed(1) })],
    duelIdCandidates: CANDIDATES,
    verify: () => false,
  });
  assert.equal(result.verified, 0);
  assert.equal(result.unbound, 1);
});

test("a deployment with no signing key refuses to start, rather than 500ing a round", async () => {
  // The failure this replaces: GRADING_RECEIPT_SECRET was injected nowhere, so a
  // deployed task passed every health check and then threw on a student's first
  // answer. Failing at construction means the ECS circuit breaker rolls the deploy
  // back instead.
  const { createDuelGrading } = await import("../src/duels/grading.js");
  const { resetVerdictReceiptSecretCache } = await import("@pa/grading");
  const savedReceipt = process.env.GRADING_RECEIPT_SECRET;
  const savedSession = process.env.SESSION_SECRET;
  const silent = {
    warn: () => undefined,
    info: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
  };
  try {
    delete process.env.GRADING_RECEIPT_SECRET;
    delete process.env.SESSION_SECRET;
    resetVerdictReceiptSecretCache();
    assert.throws(
      () => createDuelGrading(silent as never),
      // The message has to name the secret and where it comes from: whoever reads
      // it is looking at a task that will not start.
      /GRADING_RECEIPT_SECRET/,
    );
  } finally {
    if (savedReceipt === undefined) delete process.env.GRADING_RECEIPT_SECRET;
    else process.env.GRADING_RECEIPT_SECRET = savedReceipt;
    if (savedSession === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = savedSession;
    resetVerdictReceiptSecretCache();
  }
});

test("an unreadable enforcement setting is AUDIT, never the strict one", () => {
  const saved = process.env.DUEL_RECEIPT_ENFORCEMENT;
  try {
    delete process.env.DUEL_RECEIPT_ENFORCEMENT;
    assert.equal(receiptEnforcement(), "AUDIT");
    process.env.DUEL_RECEIPT_ENFORCEMENT = "yes please";
    assert.equal(receiptEnforcement(), "AUDIT");
    process.env.DUEL_RECEIPT_ENFORCEMENT = "require";
    assert.equal(receiptEnforcement(), "REQUIRE");
    process.env.DUEL_RECEIPT_ENFORCEMENT = " REQUIRE ";
    assert.equal(receiptEnforcement(), "REQUIRE");
  } finally {
    if (saved === undefined) delete process.env.DUEL_RECEIPT_ENFORCEMENT;
    else process.env.DUEL_RECEIPT_ENFORCEMENT = saved;
  }
});
