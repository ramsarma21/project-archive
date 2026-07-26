import test from "node:test";
import assert from "node:assert/strict";
import { ALL_CONCEPTS, CONCEPTS, conceptsForSe } from "../conceptRegistry.js";
import { MISSION_M3 } from "../missionIds.js";
import { ALL_MISSIONS } from "../missions.js";
import { asSeCode } from "../seCode.js";
import { ALL_STUDENT_EXPECTATIONS, STUDENT_EXPECTATIONS } from "../seRegistry.js";
import { SOURCE_DEFECTS } from "../sourceDefects.js";

// ---------------------------------------------------------------------------
// The coverage map states its own totals. If this registry disagrees with them,
// one of the two is wrong, and it is cheaper to find out here.
// ---------------------------------------------------------------------------

test("the seed matches the coverage map's stated totals", () => {
  assert.equal(ALL_STUDENT_EXPECTATIONS.length, 23, "23 of 85 target standards");

  const readiness = ALL_STUDENT_EXPECTATIONS.filter(
    (se) => se.standardType === "READINESS",
  );
  assert.equal(readiness.length, 10, "the coverage map counts 10 Readiness SEs");

  const once = ALL_STUDENT_EXPECTATIONS.filter((se) => se.recurrence === "ONCE");
  assert.deepEqual(
    once.map((se) => se.code).sort(),
    ["8.20(B)", "8.23(B)", "8.4(A)", "8.4(B)", "8.4(C)"],
    "the coverage map names exactly these 5 as Boston-only",
  );

  const tierA = ALL_STUDENT_EXPECTATIONS.filter(
    (se) => se.chapterTier === "A_MUST_OWN",
  );
  assert.equal(tierA.length, 11, "Tier A must-own is 11 standards");
  assert.equal(ALL_STUDENT_EXPECTATIONS.length - tierA.length, 12, "Tier B is 12");
});

test("reporting-category totals match the coverage summary table", () => {
  const perCategory = new Map<number, number>();
  for (const se of ALL_STUDENT_EXPECTATIONS) {
    perCategory.set(
      se.reportingCategory,
      (perCategory.get(se.reportingCategory) ?? 0) + 1,
    );
  }
  assert.deepEqual(
    [...perCategory.entries()].sort((a, b) => a[0] - b[0]),
    [
      [1, 5],
      [2, 5],
      [3, 10],
      [4, 3],
    ],
  );
});

// ---------------------------------------------------------------------------
// Text honesty. This is the check that stops a fabricated standard reaching a
// teacher-facing report.
// ---------------------------------------------------------------------------

test("only 8.4(A) claims the standard's own words, and it cites them", () => {
  const verbatim = ALL_STUDENT_EXPECTATIONS.filter(
    (se) => se.textStatus === "VERBATIM_CITED",
  );
  assert.deepEqual(verbatim.map((se) => se.code), ["8.4(A)"]);
  const se = verbatim[0]!;
  assert.ok(se.officialText, "verbatim text present");
  assert.match(se.provenance.textSource ?? "", /113\.20/);
  assert.equal(se.provenance.adoption, "2022");
});

test("no unverified standard carries text that could be mistaken for official", () => {
  for (const se of ALL_STUDENT_EXPECTATIONS) {
    if (se.textStatus === "UNVERIFIED_MISSING") {
      assert.equal(se.officialText, null, `${se.code} must not hold text`);
      assert.equal(se.provenance.textSource, null, `${se.code} must not cite text`);
      assert.ok(se.workingDescription.length > 20, `${se.code} needs a paraphrase`);
    }
  }
});

test("every clause claiming verbatim text is a substring of the official text", () => {
  for (const se of ALL_STUDENT_EXPECTATIONS) {
    for (const clause of se.clauses) {
      if (clause.textStatus !== "VERBATIM_CITED") continue;
      assert.ok(
        se.officialText?.includes(clause.text),
        `${se.code}:${clause.clauseId} quotes text absent from the standard`,
      );
    }
  }
});

test("8.4(A) carries all six causes, which is why one SE cannot be the unit", () => {
  const se = STUDENT_EXPECTATIONS.get(asSeCode("8.4(A)"))!;
  assert.deepEqual(
    se.clauses.map((c) => c.clauseId).sort(),
    [
      "INTOLERABLE_ACTS",
      "MERCANTILISM",
      "NO_REPRESENTATION",
      "POSTWAR_POLICY",
      "PROCLAMATION_1763",
      "STAMP_ACT",
    ],
  );
  const macros = conceptsForSe(se.code).filter((c) => c.tier === "MACRO");
  assert.equal(macros.length, 6, "one macro concept per named cause");
  assert.deepEqual(
    macros.map((c) => c.parentClauseId).sort(),
    se.clauses.map((c) => c.clauseId).sort(),
    "each cause is separately assessable",
  );
});

// ---------------------------------------------------------------------------
// Concept registry structure.
// ---------------------------------------------------------------------------

test("every concept has a definition long enough to assess against", () => {
  for (const concept of ALL_CONCEPTS) {
    assert.ok(
      concept.definition.length > 60,
      `${concept.conceptId} definition is too thin to author an item from`,
    );
    assert.ok(concept.sourceRefs.length > 0, `${concept.conceptId} needs a source`);
  }
});

test("every concept's parent standard is in the registry", () => {
  for (const concept of ALL_CONCEPTS) {
    assert.ok(
      STUDENT_EXPECTATIONS.has(concept.parentSe),
      `${concept.conceptId} is orphaned from ${concept.parentSe}`,
    );
    for (const secondary of concept.secondarySeCodes) {
      assert.ok(
        STUDENT_EXPECTATIONS.has(secondary),
        `${concept.conceptId} points at unknown ${secondary}`,
      );
    }
  }
});

test("every target standard has at least one concept beneath it", () => {
  const bare = ALL_STUDENT_EXPECTATIONS.filter(
    (se) => conceptsForSe(se.code).length === 0,
  );
  assert.deepEqual(bare.map((se) => se.code), []);
});

test("a retagged parent always preserves the source's original tag", () => {
  const retagged = ALL_CONCEPTS.filter(
    (c) => c.parentSeStatus === "PROPOSED_RETAG",
  );
  assert.ok(retagged.length > 0, "the seed does contain retags");
  for (const concept of retagged) {
    assert.ok(
      concept.sourceDraftTags.length > 0,
      `${concept.conceptId} moved without recording what it moved from`,
    );
  }
});

test("nothing in the seed claims SME approval", () => {
  const approved = ALL_CONCEPTS.filter((c) => c.reviewStatus === "SME_APPROVED");
  assert.deepEqual(
    approved.map((c) => c.conceptId),
    [],
    "no curriculum SME has reviewed any of this",
  );
});

test("micros are enrichment and never sit on the assessment spine", () => {
  const micros = ALL_CONCEPTS.filter((c) => c.tier === "MICRO");
  assert.equal(micros.length, 14, "the curated fourteen");
  for (const micro of micros) {
    assert.equal(micro.assessable, false, `${micro.conceptId} must not gate`);
  }
});

// ---------------------------------------------------------------------------
// Missions.
// ---------------------------------------------------------------------------

test("the slate is fourteen missions split 4/3/3/4", () => {
  assert.equal(ALL_MISSIONS.length, 14);
  const perSet = new Map<number, number>();
  for (const mission of ALL_MISSIONS) {
    perSet.set(mission.set, (perSet.get(mission.set) ?? 0) + 1);
  }
  assert.deepEqual(
    [...perSet.entries()].sort((a, b) => a[0] - b[0]),
    [
      [1, 4],
      [2, 3],
      [3, 3],
      [4, 4],
    ],
  );
});

test("M3 stays open because the slate declines to invent an assignment", () => {
  const m3 = ALL_MISSIONS.find((m) => m.missionId === MISSION_M3)!;
  assert.equal(m3.assignmentStatus, "OPEN");
  assert.deepEqual(m3.assignedSeCodes, []);
});

test("every concept owned by a mission belongs to a standard that mission teaches", () => {
  for (const concept of ALL_CONCEPTS) {
    const missionId = concept.owner.missionId;
    if (missionId === null) continue;
    const mission = ALL_MISSIONS.find((m) => m.missionId === missionId);
    assert.ok(mission, `${concept.conceptId} names unknown mission ${missionId}`);
    assert.ok(
      mission.assignedSeCodes.includes(concept.parentSe),
      `${concept.conceptId} is owned by ${missionId}, which does not teach ${concept.parentSe}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Recorded defects.
// ---------------------------------------------------------------------------

test("recorded defects reference real standards and have a named owner", () => {
  assert.ok(SOURCE_DEFECTS.length > 0);
  const ids = new Set<string>();
  for (const defect of SOURCE_DEFECTS) {
    assert.ok(!ids.has(defect.id), `duplicate defect id ${defect.id}`);
    ids.add(defect.id);
    assert.ok(defect.summary.length > 40, `${defect.id} summary too thin`);
    assert.ok(defect.registryDisposition.length > 40, `${defect.id} needs a disposition`);
    for (const code of defect.seCodes) {
      assert.ok(
        STUDENT_EXPECTATIONS.has(code),
        `${defect.id} references unregistered ${code}`,
      );
    }
  }
});

test("concept ids carry no mission segment, which is what broke the old scheme", () => {
  for (const conceptId of CONCEPTS.keys()) {
    assert.doesNotMatch(
      conceptId,
      /\.MD\d+\./,
      `${conceptId} nails a possibly-spiralling concept to one mission day`,
    );
  }
});
