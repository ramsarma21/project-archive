// Do the engine's projections actually satisfy the stored schemas.
//
// The type system already checks the SHAPE, because persistence.ts is typed
// against contracts' own row types. What it cannot check is the runtime
// constraints inside the zod schemas: `.strict()` rejecting an extra key,
// `z.string().uuid()` on an attempt id, `IsoDate` demanding an offset,
// `scoreDenominator` being positive rather than merely non-negative, and the
// `min(1)` on a form's item list. Those are exactly the constraints that fail on
// an INSERT rather than in a build, so they are worth a test.
//
// Every schema is looked up by name at runtime rather than imported statically.
// @pa/contracts is owned by another work item and is moving; a renamed export
// should make this test say so clearly and skip, not take the whole suite down
// with a module-resolution error.

import assert from "node:assert/strict";
import { test } from "node:test";

import * as contracts from "@pa/contracts";
import {
  attemptRows,
  conceptLedgerRows,
  conceptMasteryRows,
  reduceAssessment,
  responseRows,
} from "../index.js";
import {
  answerAll,
  answerNone,
  makeFixture,
  masterOnly,
  newSession,
  sit,
} from "./harness.js";

const AT = "2026-02-02T00:00:00.000Z";

interface ParseLike {
  safeParse(value: unknown): { success: boolean; error?: unknown };
}

function schema(name: string): ParseLike | null {
  const candidate = (contracts as unknown as Record<string, unknown>)[name];
  if (
    candidate &&
    typeof candidate === "object" &&
    typeof (candidate as ParseLike).safeParse === "function"
  ) {
    return candidate as ParseLike;
  }
  return null;
}

function assertValid(schemaName: string, rows: readonly unknown[]): void {
  const parser = schema(schemaName);
  if (!parser) {
    // Reported rather than silently passing: a missing schema means the contract
    // moved and this alignment needs re-checking by hand.
    assert.fail(
      `@pa/contracts no longer exports ${schemaName}; reconcile persistence.ts`,
    );
  }
  assert.ok(rows.length > 0, `${schemaName}: nothing to validate`);
  for (const row of rows) {
    const result = parser.safeParse(row);
    assert.equal(
      result.success,
      true,
      `${schemaName} rejected a projected row: ${JSON.stringify(
        result.error,
      )}\nrow: ${JSON.stringify(row)}`,
    );
  }
}

/** A student who fails, retries, and finishes: every row type gets populated. */
async function fullHistory() {
  const fixture = makeFixture({
    slugs: ["ALPHA", "BETA", "GAMMA", "GAP"],
    reserve: { ALPHA: 6, BETA: 6, GAMMA: 6, GAP: 1 },
    releasedTeaSlugs: ["ALPHA"],
    openResponseSlugs: ["BETA"],
  });
  const session = newSession(fixture);
  await sit(session, masterOnly("ALPHA"));
  await sit(session, answerNone);
  await sit(session, answerAll);
  return {
    fixture,
    record: reduceAssessment(session.events, {
      blueprint: fixture.blueprint,
      concepts: fixture.concepts,
    }),
  };
}

test("projected concept-mastery rows satisfy ConceptMasterySchema", async () => {
  const { record } = await fullHistory();
  const rows = conceptMasteryRows(record, AT);
  assertValid("ConceptMasterySchema", rows);
  assert.equal(rows.length, 4, "including the concept nobody could ask");
});

test("projected attempt rows satisfy ChapterAssessmentAttemptSchema", async () => {
  const { record } = await fullHistory();
  assertValid("ChapterAssessmentAttemptSchema", attemptRows(record, AT));
});

test("projected response rows satisfy ChapterAssessmentResponseSchema", async () => {
  const { record } = await fullHistory();
  assertValid("ChapterAssessmentResponseSchema", responseRows(record));
});

test("projected ledger rows satisfy AssessmentConceptLedgerSchema", async () => {
  const { record } = await fullHistory();
  assertValid("AssessmentConceptLedgerSchema", conceptLedgerRows(record));
});

test("derived progression-ledger rows satisfy ProgressionLedgerEntrySchema", async () => {
  const { record } = await fullHistory();
  assertValid("ProgressionLedgerEntrySchema", record.ledger);
});

test("the derived ledger awards no XP and moves no Rank", async () => {
  const { record } = await fullHistory();
  const kinds = new Set(record.ledger.map((row) => row.kind));

  for (const forbidden of ["MISSION_XP_AWARDED", "LEVEL_GAINED", "RANK_GAINED"]) {
    assert.equal(
      kinds.has(forbidden as never),
      false,
      `the capstone is a content gate; ${forbidden} must never come from it`,
    );
  }
  assert.ok(kinds.has("ASSESSMENT_ATTEMPT_OPENED"));
  assert.ok(kinds.has("ASSESSMENT_SUBMITTED"));
  assert.ok(kinds.has("CONCEPT_MASTERED"));
  assert.ok(kinds.has("CODEX_CARD_PVP_LEGAL"));
  assert.ok(kinds.has("CHAPTER_COMPLETED"));
});

test("the engine agrees with the contract's own constants", () => {
  assert.equal(contracts.ASSESSMENT_ITEMS_PER_CONCEPT, 2);
  assert.equal(contracts.ZERO_XP, 0);

  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  assert.equal(
    fixture.blueprint.itemsPerConcept,
    contracts.ASSESSMENT_ITEMS_PER_CONCEPT,
    "the blueprint default is the contract's number, not a second copy of it",
  );
});

test("the mastery rule is the contract's, not a second implementation", () => {
  // If this engine ever grew its own 100%-per-concept pass, the API route and a
  // replay could disagree about whether a student passed. Assert the shared
  // helper still behaves as the engine assumes.
  const summary = contracts.summarizeAssessmentForm(
    [
      { conceptId: "c1", itemIds: ["i1", "i2"] },
      { conceptId: "c2", itemIds: ["i3", "i4"] },
    ],
    [
      { itemId: "i1", conceptId: "c1", correct: true },
      { itemId: "i2", conceptId: "c1", correct: true },
      { itemId: "i3", conceptId: "c2", correct: true },
      // i4 unanswered.
    ],
  );
  assert.equal(summary.passed, false, "an unanswered item denies mastery");
  assert.deepEqual(summary.masteredConceptIds, ["c1"]);
  assert.equal(summary.scoreNumerator, 3);
  assert.equal(summary.scoreDenominator, 4);
});

test("the fresh-item rule is the contract's too", () => {
  const fresh = contracts.selectFreshItems({
    reserveItemIds: ["a", "b", "c", "d"],
    servedItemIds: ["a", "c"],
    count: 2,
  });
  assert.deepEqual(fresh.itemIds, ["b", "d"]);
  assert.equal(fresh.exhausted, false);

  const short = contracts.selectFreshItems({
    reserveItemIds: ["a", "b"],
    servedItemIds: ["a", "b"],
    count: 2,
  });
  assert.deepEqual(short.itemIds, []);
  assert.equal(
    short.exhausted,
    true,
    "exhaustion is reported here and answered by recycling in select.ts",
  );
});
