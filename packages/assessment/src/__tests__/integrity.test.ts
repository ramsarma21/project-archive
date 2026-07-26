import assert from "node:assert/strict";
import { test } from "node:test";

import {
  VERDICT_ENVELOPE_KEYS,
  keyOnlyGradingAuthority,
  parseVerdictEnvelope,
  recordResponse,
  submitAttempt,
  verdictEnvelope,
  mintAssessmentVerdict,
  mintUnansweredVerdict,
} from "../index.js";
import {
  answerAll,
  brokenGradingAuthority,
  conceptId,
  makeFixture,
  newSession,
  sit,
} from "./harness.js";

// ---------------------------------------------------------------------------
// No answer key can exist in this package
// ---------------------------------------------------------------------------

test("an item descriptor carries no answer key of any kind", () => {
  const fixture = makeFixture({
    slugs: ["ALPHA"],
    reserve: 2,
    releasedTeaSlugs: ["ALPHA"],
  });

  for (const item of fixture.bank.items) {
    const json = JSON.stringify(item);
    for (const leak of [
      "correctOptionId",
      "correctOptionIds",
      "correctAnswer",
      "isCorrect",
      "rationale",
      "rubric",
      "answerKey",
    ]) {
      assert.equal(
        json.includes(leak),
        false,
        `${leak} must not exist on an item a client can be handed`,
      );
    }
    for (const option of item.options) {
      assert.deepEqual(Object.keys(option).sort(), ["optionId", "text"]);
    }
  }
});

test("there is no difficulty field, so per-student scaling is not available", () => {
  // One difficulty for everyone, no easy mode. The retired `AssessmentItem` in
  // contracts carries a `difficulty`, and a blueprint that could read it would
  // eventually be asked to soften a form for a struggling student — which would
  // make the reported measure incomparable between two students in one class.
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const surfaces = [
    JSON.stringify(fixture.bank.items),
    JSON.stringify(fixture.blueprint),
  ].join("");
  for (const knob of ["difficulty", "tier", "scaling", "easyMode", "adaptive"]) {
    assert.equal(
      surfaces.includes(knob),
      false,
      `${knob} must not exist on an item or a blueprint`,
    );
  }
});

test("every student on one blueprint gets the same shape of form", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA", "BETA"], reserve: 6 });
  const strong = newSession(fixture);
  const weak = newSession(fixture);
  const strongResult = await sit(strong, answerAll);
  const weakResult = await sit(weak, () => "WRONG");

  const shape = (record: typeof strongResult.record) =>
    record.attempts[0]?.form.map((entry) => ({
      conceptId: entry.conceptId,
      items: entry.itemIds.length,
    }));
  assert.deepEqual(shape(strongResult.record), shape(weakResult.record));
});

test("a released-item capture's key is dropped when it becomes a descriptor", async () => {
  const { fromReleasedItemCapture } = await import("../items.js");
  const descriptor = fromReleasedItemCapture(
    {
      itemId: "STAAR.2019.G8SS.12",
      itemVersion: "v1",
      provenance: {
        administration: "2019 May",
        testForm: "STAAR Grade 8 Social Studies",
        itemNumberAsPublished: 12,
        teksAsPublished: "8.4(A)",
        reportingCategory: 1,
        sourceUrl: "https://tea.texas.gov/form",
        keySourceUrl: "https://tea.texas.gov/key",
      },
      era: "1765",
      stimulus: { text: "Excerpt text", imageDependent: false },
      stem: "Which statement best explains the excerpt?",
      options: [
        { optionId: "A", text: "First" },
        { optionId: "B", text: "Second" },
      ],
      optionPoolComplete: true,
      // A capture may legitimately carry these. The adapter must not copy them.
      ...({ correctOptionId: "B", correctAnswerFromOfficialKey: "B" } as object),
    },
    conceptId("ALPHA"),
  );

  assert.equal(JSON.stringify(descriptor).includes("correctOptionId"), false);
  assert.equal(descriptor.provenance.kind, "RELEASED_TEA");
  assert.equal(
    descriptor.stem,
    "Excerpt text\n\nWhich statement best explains the excerpt?",
    "stimulus and stem are composed, both verbatim",
  );
});

test("an image-dependent released item is unusable however the capture flagged it", async () => {
  const { fromReleasedItemCapture, itemEligibility } = await import("../items.js");
  const descriptor = fromReleasedItemCapture(
    {
      itemId: "STAAR.2019.G8SS.13",
      itemVersion: "v1",
      provenance: {
        administration: "2019 May",
        testForm: "STAAR Grade 8 Social Studies",
        itemNumberAsPublished: 13,
        teksAsPublished: "8.10(A)",
        reportingCategory: 2,
        sourceUrl: "https://tea.texas.gov/form",
        keySourceUrl: "https://tea.texas.gov/key",
      },
      stem: "Which region is shown on the map?",
      stimulus: { text: null, imageDependent: true },
      options: [
        { optionId: "A", text: "First" },
        { optionId: "B", text: "Second" },
      ],
      usableAsIs: true,
    },
    conceptId("ALPHA"),
  );

  assert.equal(descriptor.usableAsIs, false);
  assert.deepEqual(
    [...itemEligibility(descriptor).refusals],
    ["NOT_USABLE_AS_IS"],
  );
});

// ---------------------------------------------------------------------------
// The wire boundary
// ---------------------------------------------------------------------------

test("a verdict envelope rejects every unknown field by name", () => {
  const valid = {
    kind: "CORRECT",
    itemId: "TST.ITEM.ALPHA.00",
    itemVersion: "v1",
    source: "ANSWER_KEY",
  };
  assert.equal(parseVerdictEnvelope(valid).ok, true);

  for (const smuggled of [
    "correct",
    "score",
    "mastered",
    "pvpLegal",
    "answerText",
    "bullets",
  ]) {
    const result = parseVerdictEnvelope({ ...valid, [smuggled]: true });
    assert.equal(result.ok, false, `${smuggled} must be rejected, not ignored`);
    assert.equal(result.ok === false && result.code, "UNKNOWN_FIELD");
    assert.equal(result.ok === false && result.detail, smuggled);
  }
});

test("a three-valued rubric label is refused by name at the boundary", () => {
  const result = parseVerdictEnvelope({
    kind: "PARTIAL",
    itemId: "TST.ITEM.ALPHA.00",
    itemVersion: "v1",
    source: "CLASSIFIER",
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "NON_BINARY_VERDICT");
});

test("an UNANSWERED verdict that claims to be correct is refused", () => {
  const result = parseVerdictEnvelope({
    kind: "CORRECT",
    itemId: "TST.ITEM.ALPHA.00",
    itemVersion: "v1",
    source: "UNANSWERED",
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "KIND_CONTRADICTS_SOURCE");
});

test("minting fixes the kind for sources that have no choice about it", () => {
  const forged = mintAssessmentVerdict({
    kind: "CORRECT",
    itemId: "TST.ITEM.ALPHA.00",
    itemVersion: "v1",
    source: "UNANSWERED",
  });
  assert.equal(forged.kind, "INCORRECT", "a blank is wrong whatever is passed");
  assert.equal(mintUnansweredVerdict("x", "v1").kind, "INCORRECT");
});

test("the envelope round-trips and carries exactly the declared keys", () => {
  const verdict = mintAssessmentVerdict({
    kind: "CORRECT",
    itemId: "TST.ITEM.ALPHA.00",
    itemVersion: "v1",
    source: "CLASSIFIER",
    responseRef: "resp-1",
    needsReview: true,
  });
  const envelope = verdictEnvelope(verdict);
  assert.deepEqual(
    Object.keys(envelope).sort(),
    [...VERDICT_ENVELOPE_KEYS].sort(),
  );

  const parsed = parseVerdictEnvelope(envelope);
  assert.equal(parsed.ok, true);
  assert.deepEqual(
    parsed.ok ? verdictEnvelope(parsed.verdict) : null,
    envelope,
  );
});

test("a non-object, a missing field and a bad type are each named separately", () => {
  assert.equal(
    parseVerdictEnvelope("CORRECT").ok === false &&
      parseVerdictEnvelope("CORRECT").code,
    "NOT_AN_OBJECT",
  );
  const missing = parseVerdictEnvelope({
    kind: "CORRECT",
    itemId: "x",
    source: "ANSWER_KEY",
  });
  assert.equal(missing.ok === false && missing.code, "MISSING_FIELD");
  const badType = parseVerdictEnvelope({
    kind: "CORRECT",
    itemId: "x",
    itemVersion: "v1",
    source: "ANSWER_KEY",
    responseRef: 7,
  });
  assert.equal(badType.ok === false && badType.code, "BAD_FIELD_TYPE");
});

// ---------------------------------------------------------------------------
// Grading cannot be bypassed
// ---------------------------------------------------------------------------

test("the stand-in authority refuses to grade prose at all", async () => {
  const authority = keyOnlyGradingAuthority(new Map([["item-1", "A"]]));
  const result = await authority.grade({
    kind: "OPEN_RESPONSE",
    itemId: "item-1",
    itemVersion: "v1",
    responseRef: "resp-1",
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "NO_KEY_FOR_ITEM");
});

test("an item that is not on the form cannot be answered", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  const opened = await sit(session, answerAll, { openOnly: true });
  const attempt = opened.record.openAttempt;
  assert.ok(attempt);

  const result = await recordResponse({
    attempt,
    submission: {
      kind: "SELECTED_RESPONSE",
      itemId: "TST.ITEM.ALPHA.99",
      itemVersion: "v1",
      selectedOptionId: "A",
    },
    authority: fixture.authority,
    at: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "ITEM_NOT_ON_FORM");
  assert.equal(result.events.length, 0, "and nothing is written down");
});

test("when the grader is down the answer is kept and the form will not submit", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  const opened = await sit(session, answerAll, {
    authority: brokenGradingAuthority(),
    openOnly: false,
  });

  // Responses were recorded; verdicts were not.
  const responses = session.events.filter(
    (event) => event.type === "RESPONSE_RECORDED",
  );
  const verdicts = session.events.filter(
    (event) => event.type === "VERDICT_COMMITTED",
  );
  assert.equal(responses.length, 2, "the student answered, and that is a fact");
  assert.equal(verdicts.length, 0, "nothing was graded");

  const attempt = opened.record.openAttempt;
  assert.ok(attempt, "the attempt stays open rather than submitting a guess");
  const submitted = submitAttempt({
    attempt,
    bank: fixture.bank,
    at: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(submitted.ok, false);
  assert.equal(submitted.ok === false && submitted.code, "UNGRADED_RESPONSES");
  assert.equal(submitted.ok === false && submitted.itemIds.length, 2);
});

test("a capstone timeout never grants credit, unlike a duel round", () => {
  // The duel has GRADING_TIMEOUT and grants the maximum on it. The capstone
  // deliberately has no such source, because a timeout here would hand out
  // mastery, a chapter unlock and a PvP-legal card for an ungraded response.
  const result = parseVerdictEnvelope({
    kind: "CORRECT",
    itemId: "TST.ITEM.ALPHA.00",
    itemVersion: "v1",
    source: "GRADING_TIMEOUT",
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "UNKNOWN_SOURCE");
});

test("changing an answer discards the verdict on the old one", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  const opened = await sit(session, answerAll, { openOnly: true });
  const attempt = opened.record.openAttempt;
  assert.ok(attempt);
  const itemId = attempt.form[0]?.itemIds[0];
  assert.ok(itemId);

  const right = await recordResponse({
    attempt,
    submission: {
      kind: "SELECTED_RESPONSE",
      itemId,
      itemVersion: "v1",
      selectedOptionId: fixture.answerKey.get(itemId) ?? "A",
    },
    authority: fixture.authority,
    at: "2026-01-01T00:00:01.000Z",
  });
  assert.equal(right.ok, true);
  session.events = [...session.events, ...right.events];

  // Re-answer with a plain RESPONSE_RECORDED and no new verdict, which is what a
  // client that answered and then lost the grader would produce.
  session.events = [
    ...session.events,
    {
      type: "RESPONSE_RECORDED",
      attemptId: attempt.attemptId,
      itemId,
      conceptId: conceptId("ALPHA"),
      selectedOptionId: "D",
      responseRef: null,
      at: "2026-01-01T00:00:02.000Z",
    },
  ];

  const after = (await import("../reduce.js")).reduceAssessment(session.events, {
    blueprint: fixture.blueprint,
    concepts: fixture.concepts,
  });
  const response = after.openAttempt?.responses.find(
    (entry) => entry.itemId === itemId,
  );
  assert.equal(response?.selectedOptionId, "D");
  assert.equal(
    response?.verdict,
    null,
    "a student cannot answer correctly, revise, and keep the credit",
  );
});
