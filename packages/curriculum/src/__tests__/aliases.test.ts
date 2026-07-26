import test from "node:test";
import assert from "node:assert/strict";
import { ALIASES, ALIAS_INDEX, lookupAlias, unresolvedAliases } from "../aliases.js";
import { ALL_CONCEPTS, CONCEPTS } from "../conceptRegistry.js";
import {
  CurriculumReferenceError,
  requireConcept,
  resolveConcept,
  resolveSe,
  retag,
} from "../resolve.js";
import type { SeCode } from "../seCode.js";
import { STUDENT_EXPECTATIONS } from "../seRegistry.js";
import type { CurriculumConceptId } from "../types.js";

// ---------------------------------------------------------------------------
// The whole point: every identifier the repository already contains resolves,
// or is refused with a reason.
// ---------------------------------------------------------------------------

/** Every identifier form observed in the repository, one example each. */
const OBSERVED_FORMS: [string, string][] = [
  ["8.4(A):POSTWAR_POLICY", "BOS.CONCEPT.POSTWAR_REVENUE.v1"],
  ["POSTWAR_POLICY", "BOS.CONCEPT.POSTWAR_REVENUE.v1"],
  ["BOS.MD01.CONCEPT.POSTWAR_REVENUE.v1", "BOS.CONCEPT.POSTWAR_REVENUE.v1"],
  ["RCC.DEBT_POLICY_INTRO", "BOS.CONCEPT.POSTWAR_REVENUE.v1"],
  ["(4)(A)\u00b7postwar revenue", "BOS.CONCEPT.POSTWAR_REVENUE.v1"],
  ["MICRO.WRITS_OF_ASSISTANCE", "BOS.CONCEPT.WRITS_OF_ASSISTANCE.v1"],
  ["RCL.BOSTON_TEA_PARTY", "BOS.CONCEPT.DISCIPLINED_CIVIL_DISOBEDIENCE.v1"],
  ["BOSTON_TEA_PARTY", "BOS.CONCEPT.DISCIPLINED_CIVIL_DISOBEDIENCE.v1"],
  ["BOS.CONCEPT.STAMP_SCOPE.v1", "BOS.CONCEPT.STAMP_SCOPE.v1"],
];

test("every observed identifier form resolves to the right concept", () => {
  for (const [input, expected] of OBSERVED_FORMS) {
    const result = resolveConcept(input);
    assert.ok(result.ok, `${input} did not resolve`);
    assert.equal(result.concept.conceptId, expected, `resolving ${input}`);
  }
});

test("all three runtime learner ids and all three RCC ids resolve", () => {
  const legacy = [
    "BOS.MD01.CONCEPT.POSTWAR_REVENUE.v1",
    "BOS.MD01.CONCEPT.STAMP_SCOPE.v1",
    "BOS.MD01.CONCEPT.REPRESENTATION.v1",
    "RCC.DEBT_POLICY_INTRO",
    "RCC.STAMP_INTERNAL_INTRO",
    "RCC.REPRESENTATION_CAUSE",
  ];
  const results = retag(legacy);
  assert.deepEqual(
    results.filter((r) => r.conceptId === null),
    [],
    "no M1 identifier may fail to retag",
  );
});

test("all fourteen MICRO ids resolve to their concepts", () => {
  const micros = ALL_CONCEPTS.filter((c) => c.tier === "MICRO");
  assert.equal(micros.length, 14);
  for (const micro of micros) {
    const slug = micro.conceptId.split(".")[2]!;
    const result = resolveConcept(`MICRO.${slug}`);
    assert.ok(result.ok, `MICRO.${slug} did not resolve`);
    assert.equal(result.concept.conceptId, micro.conceptId);
  }
});

// ---------------------------------------------------------------------------
// Refusals. Each of these was silently accepted when the id type was `string`.
// ---------------------------------------------------------------------------

test("a strand tag is refused rather than coerced to an expectation", () => {
  const result = resolveConcept("8.29");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure, "ALIAS_UNRESOLVED");
    assert.equal(result.disposition, "NOT_AN_SE_CODE");
    assert.match(result.detail, /skills strand/);
  }
});

test("the review placeholder is refused", () => {
  const result = resolveConcept("TEKS.PENDING_SME_REVIEW");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.disposition, "REVIEW_PLACEHOLDER");
});

test("an out-of-chapter concept is refused with a chapter suggestion", () => {
  const result = resolveConcept("RCL.VALLEY_FORGE_WINTER");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.disposition, "OUT_OF_CHAPTER_SCOPE");
    assert.equal(result.alias?.target.kind, "UNRESOLVED");
    if (result.alias?.target.kind === "UNRESOLVED") {
      assert.equal(result.alias.target.suggestedChapter, "WAR_CHAPTER");
    }
  }
});

test("a bare standard is refused as a concept but offers its candidates", () => {
  const result = resolveConcept("8.4(A)");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure, "RESOLVES_TO_SE_NOT_CONCEPT");
    assert.ok(
      (result.candidates ?? []).length >= 6,
      "the caller is told which concepts it could have meant",
    );
  }
});

test("a two-standard token is refused rather than resolving to the first", () => {
  const result = resolveConcept("(15)(A/E)");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure, "RESOLVES_TO_SE_SET");
});

test("an unknown identifier is refused", () => {
  for (const input of ["RCC.MADE_UP", "BOS.CONCEPT.NOT_REAL.v1", "8.77(Z)", "???"]) {
    const result = resolveConcept(input);
    assert.equal(result.ok, false, `${input} should not resolve`);
  }
});

test("requireConcept throws with the offending input attached", () => {
  assert.throws(
    () => requireConcept("8.29"),
    (error: unknown) => {
      assert.ok(error instanceof CurriculumReferenceError);
      assert.equal(error.input, "8.29");
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Table integrity.
// ---------------------------------------------------------------------------

test("no alias appears twice", () => {
  assert.equal(
    ALIAS_INDEX.size,
    ALIASES.length,
    "a duplicate alias would silently lose one mapping",
  );
});

test("no alias collides with a canonical key", () => {
  for (const alias of ALIASES) {
    assert.ok(
      !STUDENT_EXPECTATIONS.has(alias.alias as SeCode),
      `${alias.alias} is both an alias and a canonical standard code`,
    );
    assert.ok(
      !CONCEPTS.has(alias.alias as CurriculumConceptId),
      `${alias.alias} is both an alias and a canonical concept id`,
    );
  }
});

test("every alias records where it is used, so retagging has a work list", () => {
  for (const alias of ALIASES) {
    assert.ok(alias.usedBy.length > 0, `${alias.alias} has no usage record`);
  }
});

test("every deliberately unmapped alias states why", () => {
  const unresolved = unresolvedAliases();
  assert.ok(unresolved.length > 0);
  for (const alias of unresolved) {
    assert.equal(alias.target.kind, "UNRESOLVED");
    if (alias.target.kind === "UNRESOLVED") {
      assert.ok(
        alias.target.detail.trim().length > 30,
        `${alias.alias} is unmapped without a usable explanation; a bare year ` +
          "does not tell a reader why the identifier cannot be used",
      );
    }
  }
});

test("lookup tolerates surrounding whitespace only", () => {
  assert.ok(lookupAlias("  RCC.DEBT_POLICY_INTRO  "));
  assert.equal(lookupAlias("rcc.debt_policy_intro"), undefined);
});

// ---------------------------------------------------------------------------
// SE resolution.
// ---------------------------------------------------------------------------

test("a concept id resolves upward to its standard and clause", () => {
  const result = resolveSe("BOS.CONCEPT.STAMP_SCOPE.v1");
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.se.code, "8.4(A)");
    assert.equal(result.clauseId, "STAMP_ACT");
  }
});

test("a legacy assessment id resolves upward to its standard", () => {
  const result = resolveSe("RCC.REPRESENTATION_CAUSE");
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.se.code, "8.4(A)");
    assert.equal(result.clauseId, "NO_REPRESENTATION");
  }
});

test("a standard outside the target set is refused", () => {
  const result = resolveSe("8.27(A)");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.detail, /not one of Boston's target standards/);
});
