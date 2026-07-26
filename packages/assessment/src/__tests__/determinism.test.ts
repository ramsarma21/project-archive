import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deriveFormSeedHex,
  isFormSeedHex,
  logContainsNoRawText,
  reduceAssessment,
  seededShuffle,
  selectForm,
  serialiseLog,
} from "../index.js";
import {
  answerAll,
  answerNone,
  conceptId,
  makeFixture,
  masterOnly,
  newSession,
  sit,
} from "./harness.js";

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

test("folding the same log twice produces the identical record", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA", "BETA", "GAMMA"], reserve: 6 });
  const session = newSession(fixture);
  await sit(session, masterOnly("ALPHA"));
  await sit(session, masterOnly("BETA"));
  await sit(session, answerAll);

  const context = { blueprint: fixture.blueprint, concepts: fixture.concepts };
  const first = reduceAssessment(session.events, context);
  const second = reduceAssessment(session.events, context);

  // Maps do not deep-equal usefully, so compare the serialisable projection.
  assert.deepEqual(
    JSON.parse(JSON.stringify({ ...first, mastery: [...first.mastery] })),
    JSON.parse(JSON.stringify({ ...second, mastery: [...second.mastery] })),
  );
  assert.equal(first.passed, true);
  assert.equal(first.attempts.length, 3);
});

test("a partial replay is the record as it stood at that point", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA", "BETA"], reserve: 6 });
  const session = newSession(fixture);
  await sit(session, masterOnly("ALPHA"));
  const afterFirst = session.events.length;
  await sit(session, answerAll);

  const context = { blueprint: fixture.blueprint, concepts: fixture.concepts };
  const partial = reduceAssessment(session.events.slice(0, afterFirst), context);
  assert.equal(partial.passed, false);
  assert.equal(partial.attempts.length, 1);
  assert.equal(partial.mastery.get(conceptId("BETA"))?.mastered, false);

  const full = reduceAssessment(session.events, context);
  assert.equal(full.passed, true);
  assert.equal(
    full.reportedScore?.numerator,
    partial.reportedScore?.numerator,
    "the reported measure is unchanged by the retry that followed it",
  );
});

// ---------------------------------------------------------------------------
// The seed
// ---------------------------------------------------------------------------

test("a form seed is stable, 32 lowercase hex characters, and ordinal-dependent", () => {
  const first = deriveFormSeedHex(["TST.CAPSTONE.v1", "profile-1", 1]);
  const again = deriveFormSeedHex(["TST.CAPSTONE.v1", "profile-1", 1]);
  const retry = deriveFormSeedHex(["TST.CAPSTONE.v1", "profile-1", 2]);
  const other = deriveFormSeedHex(["TST.CAPSTONE.v1", "profile-2", 1]);

  assert.equal(first, again, "same input, same seed, forever");
  assert.ok(isFormSeedHex(first));
  assert.notEqual(first, retry, "a retry must not re-derive attempt 1's seed");
  assert.notEqual(first, other, "two students do not get the same form");
});

test("selection is a pure function of the seed, the reserve and the ledger", () => {
  const fixture = makeFixture({ slugs: ["ALPHA", "BETA"], reserve: 6 });
  const input = {
    blueprint: fixture.blueprint,
    bank: fixture.bank,
    scopedConceptIds: fixture.conceptIds,
    ledger: [],
    seedHex: deriveFormSeedHex(["fixed", 1]),
  };
  assert.deepEqual(selectForm(input), selectForm(input));

  const different = selectForm({ ...input, seedHex: deriveFormSeedHex(["fixed", 2]) });
  assert.notDeepEqual(
    different.concepts.map((concept) => [...concept.itemIds]),
    input.ledger.length === 0
      ? selectForm(input).concepts.map((concept) => [...concept.itemIds])
      : [],
  );
});

test("the committed seed reproduces the exact form the student sat", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA", "BETA"], reserve: 6 });
  const session = newSession(fixture);
  const result = await sit(session, answerNone);

  const opened = session.events.find((event) => event.type === "ATTEMPT_OPENED");
  assert.ok(opened && opened.type === "ATTEMPT_OPENED");

  const replayed = selectForm({
    blueprint: fixture.blueprint,
    bank: fixture.bank,
    scopedConceptIds: opened.scopedConceptIds,
    ledger: [],
    seedHex: opened.seedHex,
  });
  assert.deepEqual(
    replayed.concepts.map((concept) => [...concept.itemIds]),
    opened.form.map((entry) => [...entry.itemIds]),
  );
  assert.deepEqual(
    replayed.concepts.flatMap((concept) => [...concept.itemIds]),
    [...result.servedItemIds],
  );
});

test("a per-concept substream keeps one concept's reserve from moving another's", () => {
  const seed = deriveFormSeedHex(["stream", 1]);
  const shared = makeFixture({ slugs: ["ALPHA", "BETA"], reserve: 6 });
  const extended = makeFixture({
    slugs: ["ALPHA", "BETA"],
    reserve: { ALPHA: 9, BETA: 6 },
  });

  const before = selectForm({
    blueprint: shared.blueprint,
    bank: shared.bank,
    scopedConceptIds: shared.conceptIds,
    ledger: [],
    seedHex: seed,
  });
  const after = selectForm({
    blueprint: extended.blueprint,
    bank: extended.bank,
    scopedConceptIds: extended.conceptIds,
    ledger: [],
    seedHex: seed,
  });

  const betaBefore = before.concepts.find(
    (concept) => concept.conceptId === conceptId("BETA"),
  );
  const betaAfter = after.concepts.find(
    (concept) => concept.conceptId === conceptId("BETA"),
  );
  assert.deepEqual(
    [...(betaAfter?.itemIds ?? [])],
    [...(betaBefore?.itemIds ?? [])],
    "adding three items to ALPHA must not change what BETA serves",
  );
});

test("seededShuffle is deterministic, order-changing, and non-destructive", () => {
  const input = ["a", "b", "c", "d", "e", "f", "g", "h"];
  assert.deepEqual(seededShuffle(input, 12345), seededShuffle(input, 12345));
  assert.notDeepEqual(seededShuffle(input, 12345), seededShuffle(input, 54321));
  assert.deepEqual([...seededShuffle(input, 999)].sort(), [...input].sort());
  assert.deepEqual(input, ["a", "b", "c", "d", "e", "f", "g", "h"]);
});

// ---------------------------------------------------------------------------
// What the log does and does not contain
// ---------------------------------------------------------------------------

test("every event is committed: serialising the log filters nothing", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  await sit(session, answerAll);

  assert.equal(
    serialiseLog(session.events).length,
    session.events.length,
    "unlike the duel, the capstone has no transient tier",
  );
});

test("the log carries no score, pass flag or mastery flag anywhere", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA", "BETA"], reserve: 6 });
  const session = newSession(fixture);
  await sit(session, masterOnly("ALPHA"));
  await sit(session, answerAll);

  const json = JSON.stringify(serialiseLog(session.events));
  for (const forbidden of [
    "scoreNumerator",
    "scoreDenominator",
    "passed",
    "mastered",
    "masteredAt",
    "pvpLegal",
    "xp",
    "rank",
  ]) {
    assert.equal(
      json.includes(forbidden),
      false,
      `${forbidden} must be derived, so no event may assert it`,
    );
  }
});

test("open-response text never reaches the log; only the opaque handle does", async () => {
  const fixture = makeFixture({
    slugs: ["ALPHA"],
    reserve: 6,
    openResponseSlugs: ["ALPHA"],
  });
  const session = newSession(fixture);
  await sit(session, answerAll);

  // The prose a student would actually have typed, fed through the same path.
  const prose = [
    "Parliament taxed the colonies because the war left Britain in debt",
    "we elect no member of Parliament so it cannot consent for us",
  ];
  assert.equal(logContainsNoRawText(session.events, prose), true);

  const json = JSON.stringify(serialiseLog(session.events));
  assert.ok(json.includes("resp-"), "the handle is committed");
  assert.equal(json.includes("Parliament"), false, "the text is not");
});

test("the reducer needs no clock and no randomness, so a replay is bit-identical", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA", "BETA"], reserve: 6 });
  const session = newSession(fixture);
  await sit(session, answerAll);

  const context = { blueprint: fixture.blueprint, concepts: fixture.concepts };
  const now = Date.now;
  const random = Math.random;
  // Any use of either inside the fold is a determinism bug, so make them throw.
  Date.now = () => {
    throw new Error("the reducer must not read the clock");
  };
  Math.random = () => {
    throw new Error("the reducer must not use randomness");
  };
  try {
    const record = reduceAssessment(session.events, context);
    assert.equal(record.passed, true);
  } finally {
    Date.now = now;
    Math.random = random;
  }
});
