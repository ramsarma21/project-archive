// Composition with the real @pa/curriculum registry.
//
// The other suites run on a fixture chapter, which proves the package is
// data-driven. This one proves it actually lines up with the curriculum a Texas
// district reports in, and that it does not quietly invent a ninth way of writing
// a standard on the surface where that would be least recoverable.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASSESSMENT_BOSTON_CAPSTONE,
  CHAPTER_BOSTON,
  allRegisteredConceptIds,
  registryStandardsSource,
} from "../curriculum.js";
import { rollUpToStandards } from "../standards.js";
import { evidenceFromDurableRows } from "../source.js";
import { buildStudentChapterReport } from "../student.js";
import { PROFILE_A, attemptUuid, subject } from "./harness.js";

const CANONICAL_SE = /^\d{1,2}\.\d{1,2}\([A-Z]\)$/;
const BARE_SE = /^\d{1,2}\.\d{1,2}[A-Z]$/;

function sampleConceptIds(count: number): readonly string[] {
  return allRegisteredConceptIds().slice(0, count);
}

/**
 * Concepts spanning both description sources.
 *
 * Picked by property rather than by position: the registry's first entries all
 * hang off 8.4(A), which is the one standard whose official text we hold, so a
 * `slice(0, n)` sample would silently stop exercising the paraphrase path the
 * moment the registry is reordered.
 */
function conceptIdsSpanningDescriptionSources(): readonly string[] {
  const standards = registryStandardsSource();
  const bySource = new Map<string, string>();
  for (const conceptId of allRegisteredConceptIds()) {
    const concept = standards.concept(conceptId);
    const standard = concept ? standards.standard(concept.parentSe) : undefined;
    if (!standard || bySource.has(standard.descriptionSource)) continue;
    bySource.set(standard.descriptionSource, conceptId);
  }
  const picked = [...bySource.values()];
  assert.equal(picked.length, 2, "the registry should hold both kinds of text");
  return picked;
}

test("every registry concept resolves to a canonically spelled standard", () => {
  const standards = registryStandardsSource();
  let official = 0;
  let paraphrase = 0;

  for (const conceptId of allRegisteredConceptIds()) {
    const concept = standards.concept(conceptId);
    assert.ok(concept, `registry concept did not resolve: ${conceptId}`);
    const standard = standards.standard(concept.parentSe);
    assert.ok(standard, `concept ${conceptId} has an unregistered parent`);
    assert.match(standard.seCode, CANONICAL_SE);
    assert.match(standard.seCodeBare, BARE_SE);
    assert.ok(standard.reportingCategory >= 1 && standard.reportingCategory <= 4);
    if (standard.descriptionSource === "OFFICIAL_TEXT") official += 1;
    else paraphrase += 1;
  }

  assert.ok(official > 0, "at least one standard's own words are held");
  assert.ok(
    paraphrase > 0,
    "and most are our paraphrase, which the report says on every row",
  );
});

test("the report emits only the registry's own identifiers", () => {
  const conceptIds = sampleConceptIds(6);
  const registered = new Set(allRegisteredConceptIds());
  const report = buildStudentChapterReport({
    subject: subject(PROFILE_A, "Real Student"),
    evidence: evidenceFromDurableRows({
      profileId: PROFILE_A,
      chapterId: CHAPTER_BOSTON,
      assessmentId: ASSESSMENT_BOSTON_CAPSTONE,
      chapterConceptIds: conceptIds,
      attempts: [
        {
          attemptId: attemptUuid(1),
          attemptOrdinal: 1,
          scopedConceptIds: conceptIds.slice(0, 4),
          status: "SUBMITTED",
          scoreNumerator: 4,
          scoreDenominator: 8,
          startedAt: "2026-02-01T09:40:00.000Z",
          submittedAt: "2026-02-01T10:00:00.000Z",
        },
      ],
      mastery: conceptIds.slice(0, 4).map((conceptId, index) => ({
        conceptId,
        itemsServed: 2,
        itemsCorrect: index < 2 ? 2 : 0,
        firstAttemptServed: 2,
        firstAttemptCorrect: index < 2 ? 2 : 0,
        masteredAt: index < 2 ? "2026-02-01T10:00:00.000Z" : null,
      })),
    }),
    standards: registryStandardsSource(),
    generatedAt: "2026-03-01T00:00:00.000Z",
  });

  for (const row of report.byConcept) {
    assert.ok(
      registered.has(row.conceptId),
      `report emitted a concept id the registry does not hold: ${row.conceptId}`,
    );
    assert.notEqual(row.label, row.conceptId, "a label, not an identifier");
    assert.ok(row.standard, `no standard for ${row.conceptId}`);
    assert.match(row.standard?.seCode ?? "", CANONICAL_SE);
  }
  assert.deepEqual([...report.standards.unmappedConceptIds], []);
  assert.equal(report.evidence.masteredUnaided, 2);
  assert.equal(report.evidence.studentGaps, 2);
  assert.equal(
    report.evidence.coverageDebt,
    2,
    "the two concepts attempt 1 never scoped are our shortage, not their gap",
  );
});

test("a legacy identifier is reported as unmapped rather than guessed at", () => {
  // The old learner-concept spelling. @pa/curriculum can retag it through the
  // alias table, but reporting deliberately does not: canonicalisation belongs at
  // the content boundary, and a report that quietly resolved an unknown id would
  // hide a tagging bug behind a plausible standard.
  const rollup = rollUpToStandards(
    [{ conceptId: "BOS.MD01.CONCEPT.POSTWAR_REVENUE.v1", outcome: "NOT_YET_MASTERED" }],
    registryStandardsSource(),
  );
  assert.deepEqual(
    [...rollup.unmappedConceptIds],
    ["BOS.MD01.CONCEPT.POSTWAR_REVENUE.v1"],
  );
  assert.deepEqual([...rollup.rows], []);
});

test("a Boston chapter report is instructional-only, and says why", () => {
  const conceptIds = conceptIdsSpanningDescriptionSources();
  const report = buildStudentChapterReport({
    subject: subject(PROFILE_A),
    evidence: evidenceFromDurableRows({
      profileId: PROFILE_A,
      chapterId: CHAPTER_BOSTON,
      assessmentId: ASSESSMENT_BOSTON_CAPSTONE,
      chapterConceptIds: conceptIds,
      attempts: [
        {
          attemptId: attemptUuid(1),
          attemptOrdinal: 1,
          scopedConceptIds: conceptIds,
          status: "SUBMITTED",
          scoreNumerator: 6,
          scoreDenominator: 6,
          startedAt: "2026-02-01T09:40:00.000Z",
          submittedAt: "2026-02-01T10:00:00.000Z",
        },
      ],
      mastery: conceptIds.map((conceptId) => ({
        conceptId,
        itemsServed: 2,
        itemsCorrect: 2,
        firstAttemptServed: 2,
        firstAttemptCorrect: 2,
        masteredAt: "2026-02-01T10:00:00.000Z",
      })),
    }),
    standards: registryStandardsSource(),
    generatedAt: "2026-03-01T00:00:00.000Z",
  });

  assert.equal(report.currentStanding.percent, 100);
  assert.equal(
    report.claim.strength,
    "INSTRUCTIONAL_ONLY",
    "a perfect score still does not reach the summative tier today",
  );
  assert.ok(report.claim.qualifiers.includes("STANDARDS_TEXT_UNVERIFIED"));
  assert.ok(report.claim.qualifiers.includes("CONCEPT_MAPPING_NOT_SME_APPROVED"));
  assert.ok(report.claim.qualifiers.includes("DISCLOSURES_INCOMPLETE"));
});
