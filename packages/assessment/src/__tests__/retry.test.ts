import assert from "node:assert/strict";
import { test } from "node:test";

import { chapterUnlockDecision, findModuleCompletion } from "../index.js";
import {
  ASSESSMENT_ID,
  answerAll,
  answerNone,
  cardIdFor,
  completeModule,
  conceptId,
  decide,
  makeFixture,
  masterOnly,
  newSession,
  servedFor,
  sit,
} from "./harness.js";

// ---------------------------------------------------------------------------
// The scope shrinks
// ---------------------------------------------------------------------------

test("a retry scopes only the concepts not yet mastered", async () => {
  const fixture = makeFixture({
    slugs: ["ALPHA", "BETA", "GAMMA", "DELTA"],
    reserve: 6,
  });
  const session = newSession(fixture);
  await sit(session, masterOnly("ALPHA", "GAMMA"));

  const retry = await sit(session, answerNone);
  assert.equal(retry.attemptOrdinal, 2);
  assert.deepEqual(
    retry.decision.kind === "OPEN_ATTEMPT"
      ? [...retry.decision.scopedConceptIds]
      : [],
    [conceptId("BETA"), conceptId("DELTA")],
    "the two mastered concepts are not re-asked",
  );

  const second = retry.record.attempts[1];
  assert.equal(second?.form.length, 2);
  assert.equal(
    second?.form.every((entry) => entry.itemIds.length === 2),
    true,
    "still two items per concept; only the concept count shrinks",
  );
});

test("the awkward case: a retry that narrows to a single concept", async () => {
  const fixture = makeFixture({
    slugs: ["ALPHA", "BETA", "GAMMA"],
    reserve: 6,
  });
  const session = newSession(fixture);
  await sit(session, masterOnly("ALPHA", "BETA"));

  const retry = await sit(session, answerAll);
  assert.deepEqual(
    retry.decision.kind === "OPEN_ATTEMPT"
      ? [...retry.decision.scopedConceptIds]
      : [],
    [conceptId("GAMMA")],
  );

  const second = retry.record.attempts[1];
  assert.equal(second?.form.length, 1, "a one-concept form is a legal form");
  assert.equal(second?.summary?.scoreDenominator, 2);
  assert.equal(second?.summary?.passed, true);

  // The single-concept retry closes the chapter.
  assert.equal(retry.record.passed, true);
  assert.equal(
    chapterUnlockDecision(retry.record, fixture.blueprint).kind,
    "UNLOCKED",
  );
  assert.deepEqual(
    retry.record.pvpLegalCards.map((card) => card.cardId).sort(),
    [cardIdFor("ALPHA"), cardIdFor("BETA"), cardIdFor("GAMMA")].sort(),
  );
});

test("mastery survives a retry that does not scope the concept", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA", "BETA"], reserve: 6 });
  const session = newSession(fixture);
  await sit(session, masterOnly("ALPHA"));
  const retry = await sit(session, answerNone);

  const alpha = retry.record.mastery.get(conceptId("ALPHA"));
  assert.equal(alpha?.mastered, true, "mastery is not lost by being left alone");
  assert.equal(alpha?.masteredOnAttempt, 1);
  assert.equal(alpha?.attemptsScoped, 1, "and it was only ever asked once");
});

test("a concept mastered on a retry records the attempt it was repaired on", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA", "BETA"], reserve: 6 });
  const session = newSession(fixture);
  await sit(session, masterOnly("ALPHA"));
  const retry = await sit(session, answerAll);

  const beta = retry.record.mastery.get(conceptId("BETA"));
  assert.equal(beta?.mastered, true);
  assert.equal(beta?.masteredOnAttempt, 2);
  assert.equal(beta?.attemptsScoped, 2);
  assert.equal(beta?.cumulativeServed, 4, "two items on each of two attempts");
  assert.equal(beta?.cumulativeCorrect, 2);
});

// ---------------------------------------------------------------------------
// Fresh items
// ---------------------------------------------------------------------------

test("a retry draws fresh items rather than the same ones", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  const first = await sit(session, answerNone);
  const second = await sit(session, answerNone);

  const overlap = first.servedItemIds.filter((itemId) =>
    second.servedItemIds.includes(itemId),
  );
  assert.deepEqual(overlap, [], "no item repeats while the reserve holds fresh ones");
  assert.equal(second.record.attempts[1]?.form[0]?.freshness, "FRESH");
});

test("a six-item reserve carries three attempts with no repeat", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  await sit(session, answerNone);
  await sit(session, answerNone);
  const third = await sit(session, answerNone);

  const served = servedFor(third.record, "ALPHA");
  assert.equal(served.length, 6, "six distinct items across three attempts");
  assert.equal(new Set(served).size, 6);
  for (const attempt of third.record.attempts) {
    assert.equal(attempt.form[0]?.freshness, "FRESH");
    assert.equal(attempt.hadRecycledItems, false);
  }
});

test("an abandoned attempt still spends its items", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  const abandoned = await sit(session, answerNone, { abandon: true });
  assert.equal(abandoned.record.attempts[0]?.status, "ABANDONED");

  const next = await sit(session, answerNone);
  const overlap = abandoned.servedItemIds.filter((itemId) =>
    next.servedItemIds.includes(itemId),
  );
  assert.deepEqual(
    overlap,
    [],
    "walking away must not hand the same form back with the answers known",
  );
});

test("an abandoned first attempt does not promote the second into the reported slot", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  await sit(session, answerAll, { abandon: true });
  const second = await sit(session, answerAll);

  assert.equal(second.attemptOrdinal, 2);
  assert.equal(
    second.record.reportedScore,
    null,
    "the reported measure is ordinal 1, so walking out of it cannot be shopped for",
  );
  assert.equal(second.record.passed, true, "but mastery and the gate still work");
});

// ---------------------------------------------------------------------------
// The module is the gate on every attempt
// ---------------------------------------------------------------------------

test("the first attempt is gated on the module", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);

  const decision = decide(session);
  assert.equal(decision.kind, "RUN_MODULE");
  assert.equal(decision.kind === "RUN_MODULE" && decision.attemptOrdinal, 1);

  const blocked = await sit(session, answerAll, { autoModule: false });
  assert.equal(blocked.attemptId, null, "no module, no attempt");
  assert.equal(session.events.length, 0);
});

test("every retry needs its own module run", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA", "BETA"], reserve: 6 });
  const session = newSession(fixture);
  await sit(session, masterOnly("ALPHA"));

  // Attempt 1's completion is on the ledger and does not arm attempt 2.
  assert.ok(findModuleCompletion(session.moduleLedger, ASSESSMENT_ID, 1));
  assert.equal(findModuleCompletion(session.moduleLedger, ASSESSMENT_ID, 2), undefined);

  const decision = decide(session);
  assert.equal(decision.kind, "RUN_MODULE");
  assert.equal(decision.kind === "RUN_MODULE" && decision.attemptOrdinal, 2);

  const blocked = await sit(session, answerAll, { autoModule: false });
  assert.equal(blocked.attemptId, null);
});

test("the retry module narrows to the same concepts the retry form will ask", async () => {
  const fixture = makeFixture({
    slugs: ["ALPHA", "BETA", "GAMMA"],
    reserve: 6,
  });
  const session = newSession(fixture);
  await sit(session, masterOnly("ALPHA"));

  const decision = decide(session);
  assert.equal(decision.kind, "RUN_MODULE");
  const moduleConcepts =
    decision.kind === "RUN_MODULE" ? [...decision.conceptIds] : [];
  assert.deepEqual(moduleConcepts, [conceptId("BETA"), conceptId("GAMMA")]);

  completeModule(session, 2, moduleConcepts);
  const cleared = decide(session);
  assert.equal(cleared.kind, "OPEN_ATTEMPT");
  assert.deepEqual(
    cleared.kind === "OPEN_ATTEMPT" ? [...cleared.scopedConceptIds] : [],
    moduleConcepts,
    "the three minutes teach exactly what is about to be asked",
  );
});

test("a module completion for the wrong ordinal does not arm an attempt", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  completeModule(session, 7, [conceptId("ALPHA")]);

  const decision = decide(session);
  assert.equal(decision.kind, "RUN_MODULE");
  assert.equal(decision.kind === "RUN_MODULE" && decision.attemptOrdinal, 1);
});

test("once passed, the gate stops offering attempts", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  await sit(session, answerAll);

  const decision = decide(session);
  assert.equal(decision.kind, "ALREADY_PASSED");
  const again = await sit(session, answerNone);
  assert.equal(again.attemptId, null, "a passed capstone cannot be re-sat");
});

test("an open attempt must be finished before another can be opened", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  await sit(session, answerAll, { openOnly: true });

  const decision = decide(session);
  assert.equal(decision.kind, "RESUME_ATTEMPT");
  assert.equal(
    decision.kind === "RESUME_ATTEMPT" && decision.attempt.attemptOrdinal,
    1,
  );
});

test("the capstone is blocked until the chapter's missions are resolved", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture, { chapterMissionsResolved: false });

  const decision = decide(session);
  assert.equal(decision.kind, "BLOCKED");
  assert.equal(decision.kind === "BLOCKED" && decision.reason, "CHAPTER_INCOMPLETE");
});
