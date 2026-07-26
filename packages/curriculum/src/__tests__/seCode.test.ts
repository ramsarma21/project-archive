import test from "node:test";
import assert from "node:assert/strict";
import {
  asSeCode,
  compareSeCodes,
  formatBareLetter,
  formatClauseQualified,
  formatGradeOmitted,
  isSeCode,
  normalizeClauseToken,
  normalizeSeCode,
  parseSeReference,
  seCodeParts,
} from "../seCode.js";

// Every spelling of the same standard that the repository has actually produced.
const EIGHT_WAY_DRIFT: [string, string | null][] = [
  ["8.4(A)", "8.4(A)"],
  ["8.4A", "8.4(A)"],
  ["8.4(A):POSTWAR_POLICY", "8.4(A)"],
  ["(4)(A)", "8.4(A)"],
  ["(4)(A)\u00b7Stamp Act", "8.4(A)"],
  ["  8.4(A)  ", "8.4(A)"],
  // Strand-only and multi-letter forms are NOT standards and must not coerce.
  ["8.12", null],
  ["(15)(A/E)", null],
];

test("every observed spelling of one standard normalizes or is refused", () => {
  for (const [input, expected] of EIGHT_WAY_DRIFT) {
    assert.equal(
      normalizeSeCode(input),
      expected,
      `normalizing ${JSON.stringify(input)}`,
    );
  }
});

test("a strand is not a student expectation", () => {
  const ref = parseSeReference("8.29");
  assert.equal(ref.kind, "STRAND_ONLY");
  if (ref.kind === "STRAND_ONLY") {
    assert.equal(ref.grade, 8);
    assert.equal(ref.strand, 29);
  }
  // The important half: it never silently becomes 8.29(A).
  assert.equal(normalizeSeCode("8.29"), null);
});

test("a multi-letter token expands to a set rather than picking one", () => {
  const ref = parseSeReference("(15)(A/E)");
  assert.equal(ref.kind, "SE_SET");
  if (ref.kind === "SE_SET") {
    assert.deepEqual(ref.codes, ["8.15(A)", "8.15(E)"]);
    assert.equal(ref.gradeInferred, true);
  }
});

test("an omitted grade is recorded as inferred, not assumed silently", () => {
  const withGrade = parseSeReference("8.4(A)");
  const withoutGrade = parseSeReference("(4)(A)");
  assert.equal(withGrade.kind, "SE");
  assert.equal(withoutGrade.kind, "SE");
  if (withGrade.kind === "SE" && withoutGrade.kind === "SE") {
    assert.equal(withGrade.code, withoutGrade.code);
    assert.equal(withGrade.gradeInferred, false);
    assert.equal(withoutGrade.gradeInferred, true);
  }
});

test("clause suffixes survive both separators the repository uses", () => {
  const colon = parseSeReference("8.4(A):POSTWAR_POLICY");
  const middot = parseSeReference("(4)(A)\u00b7Proclamation 1763");
  assert.equal(colon.kind, "SE");
  assert.equal(middot.kind, "SE");
  if (colon.kind === "SE") assert.equal(colon.clauseId, "POSTWAR_POLICY");
  if (middot.kind === "SE") {
    assert.equal(middot.clauseId, "PROCLAMATION_1763");
    assert.equal(middot.clauseRaw, "Proclamation 1763");
  }
});

test("garbage is refused with a reason instead of throwing", () => {
  for (const input of ["", "   ", "TEKS.PENDING_SME_REVIEW", "RCC.DEBT_POLICY_INTRO", "8..4(A)"]) {
    const ref = parseSeReference(input);
    assert.equal(ref.kind, "INVALID", `expected ${JSON.stringify(input)} to be invalid`);
  }
});

test("the branded type refuses a non-canonical string at the boundary", () => {
  assert.equal(isSeCode("8.4(A)"), true);
  assert.equal(isSeCode("8.4A"), false);
  assert.equal(isSeCode("(4)(A)"), false);
  assert.throws(() => asSeCode("8.4A"), /not a canonical SE code/);
  assert.throws(() => asSeCode("8.4(a)"), /not a canonical SE code/);
});

test("formatters round-trip back to canonical", () => {
  for (const code of ["8.4(A)", "8.10(C)", "8.23(E)"].map(asSeCode)) {
    assert.equal(normalizeSeCode(formatBareLetter(code)), code);
    assert.equal(normalizeSeCode(formatGradeOmitted(code)), code);
    assert.equal(
      normalizeSeCode(formatClauseQualified(code, "SOME_CLAUSE")),
      code,
    );
  }
});

test("codes sort numerically, so 8.4 precedes 8.10", () => {
  const sorted = ["8.10(A)", "8.4(A)", "8.4(B)", "8.1(A)"]
    .map(asSeCode)
    .sort(compareSeCodes);
  assert.deepEqual(sorted, ["8.1(A)", "8.4(A)", "8.4(B)", "8.10(A)"]);
});

test("clause tokens normalize prose without inventing structure", () => {
  assert.equal(normalizeClauseToken("Stamp Act"), "STAMP_ACT");
  assert.equal(normalizeClauseToken("Intolerable/Coercive Acts"), "INTOLERABLE_COERCIVE_ACTS");
  assert.equal(normalizeClauseToken("  "), null);
  assert.equal(normalizeClauseToken("1763"), null, "a token must start with a letter");
});

test("parts decompose canonical codes", () => {
  assert.deepEqual(seCodeParts(asSeCode("8.23(E)")), {
    grade: 8,
    strand: 23,
    letter: "E",
  });
});
