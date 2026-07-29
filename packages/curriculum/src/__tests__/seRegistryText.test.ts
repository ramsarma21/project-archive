import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ALL_STUDENT_EXPECTATIONS } from "../seRegistry.js";

// ---------------------------------------------------------------------------
// The registry's `officialText` strings are inline literals, and the document
// they were taken from is deliberately not vendored (TEA licensing). That leaves
// exactly one way for them to go wrong: somebody edits a literal, or edits the
// transcription, and the two stop agreeing. Nothing else in the repository would
// notice, because both sides would still look like plausible standards text.
//
// So this compares them, character for character, in both directions. It is the
// only check that can catch a hand-edited standards quotation, which is the
// failure that would put invented wording in front of a teacher.
// ---------------------------------------------------------------------------

interface CoverageStandard {
  studentExpectation: string;
  teaStatementVerbatim: string;
  teaDesignation: string;
  reportingCategory: number;
}

const COVERAGE_PATH = new URL(
  "../../../../content/staar/boston-coverage.json",
  import.meta.url,
);

function loadCoverage(): CoverageStandard[] {
  // An unreadable or malformed source is a hard failure, never a skip: a skipped
  // comparison reads exactly like a passing one.
  const raw = readFileSync(COVERAGE_PATH, "utf8");
  const parsed = JSON.parse(raw) as { standards?: CoverageStandard[] };
  assert.ok(
    Array.isArray(parsed.standards) && parsed.standards.length > 0,
    "boston-coverage.json holds no standards array",
  );
  return parsed.standards;
}

test("the transcription and the registry cover exactly the same standards", () => {
  const coverage = loadCoverage();
  const inCoverage = coverage.map((s) => s.studentExpectation).sort();
  const inRegistry = ALL_STUDENT_EXPECTATIONS.map((se) => se.code as string).sort();
  assert.deepEqual(inRegistry, inCoverage);
});

test("every officialText is byte-identical to the TEA transcription", () => {
  const coverage = loadCoverage();
  const byCode = new Map(coverage.map((s) => [s.studentExpectation, s]));
  let compared = 0;
  for (const se of ALL_STUDENT_EXPECTATIONS) {
    const source = byCode.get(se.code as string);
    assert.ok(source, `${se.code} is absent from the transcription`);
    assert.equal(
      se.officialText,
      source.teaStatementVerbatim,
      `${se.code}: officialText has drifted from content/staar/boston-coverage.json`,
    );
    compared += 1;
  }
  assert.equal(
    compared,
    ALL_STUDENT_EXPECTATIONS.length,
    "every row must be compared, or the check is weaker than it looks",
  );
});

test("designations agree with the transcription too", () => {
  const coverage = loadCoverage();
  const byCode = new Map(coverage.map((s) => [s.studentExpectation, s]));
  for (const se of ALL_STUDENT_EXPECTATIONS) {
    const source = byCode.get(se.code as string)!;
    assert.equal(
      se.standardType,
      source.teaDesignation.toUpperCase(),
      `${se.code}: readiness/supporting disagrees with TEA`,
    );
    assert.equal(
      se.reportingCategory,
      source.reportingCategory,
      `${se.code}: reporting category disagrees with TEA`,
    );
  }
});

test("every clause quotes words the standard's own text actually uses", () => {
  let clausesChecked = 0;
  for (const se of ALL_STUDENT_EXPECTATIONS) {
    for (const clause of se.clauses) {
      if (clause.textStatus !== "VERBATIM_CITED") continue;
      assert.ok(
        se.officialText?.includes(clause.text),
        `${se.code}:${clause.clauseId} quotes "${clause.text}", absent from the standard`,
      );
      clausesChecked += 1;
    }
  }
  // 8.4(A)'s six causes plus 8.4(B)'s fourteen individuals. A drop here means a
  // clause list was silently emptied.
  assert.ok(clausesChecked >= 20, `only ${clausesChecked} clauses checked`);
});

test("8.4(B) declares all fourteen individuals TEA names", () => {
  const se = ALL_STUDENT_EXPECTATIONS.find((s) => (s.code as string) === "8.4(B)")!;
  const names = se.clauses.map((c) => c.text);
  assert.deepEqual(names, [
    "Abigail Adams",
    "John Adams",
    "Wentworth Cheswell",
    "Samuel Adams",
    "Mercy Otis Warren",
    "James Armistead",
    "Benjamin Franklin",
    "Crispus Attucks",
    "King George III",
    "Patrick Henry",
    "Thomas Jefferson",
    "the Marquis de Lafayette",
    "Thomas Paine",
    "George Washington",
  ]);
  // Order is TEA's, and the clause ids are prefixed so the bare forms the alias
  // table generates cannot collide with free-text item-lineage tags of the same
  // spelling. See the comment on the clause list.
  for (const clause of se.clauses) {
    assert.match(clause.clauseId, /^IND_/, `${clause.clauseId} lost its prefix`);
  }
});
