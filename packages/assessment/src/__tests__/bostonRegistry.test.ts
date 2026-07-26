// Integration with the real curriculum registry.
//
// Everything else in this suite runs against a `TST.CONCEPT.*` fixture chapter,
// which proves the engine is data-driven. This file proves it composes with the
// actual Boston registry — that the concept list is read rather than authored,
// that legacy identifiers retag rather than being accepted, and that the honest
// answer today is "the bank is nearly empty", reported rather than crashed on.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ALL_CONCEPTS,
  ASSESSMENT_BOSTON_CAPSTONE,
  BOSTON_ERA_WINDOW,
  CHAPTER_BOSTON,
  bostonConceptId,
} from "@pa/curriculum";
import {
  UnknownChapterError,
  blueprintReadiness,
  buildItemBank,
  compileBlueprint,
  fromReleasedItemCapture,
  registryConceptSource,
  resolveConceptRef,
  staticConceptSource,
  type AssessmentItemDescriptor,
} from "../index.js";

// The capstone id comes from the registry rather than being restated, for the
// same reason `chapterId` does: @pa/abilities named this assessment
// `BOSTON.CAPSTONE` while the authored content said `BOS.CAPSTONE.v1`, and a
// fixture that writes its own copy is a fixture that cannot notice.
const BOSTON_BLUEPRINT = {
  assessmentId: ASSESSMENT_BOSTON_CAPSTONE,
  chapterId: CHAPTER_BOSTON,
  moduleId: "BOS.MODULE.CAPSTONE.v1",
  eraWindow: BOSTON_ERA_WINDOW,
};

test("the Boston blueprint reads its concepts from the registry", () => {
  const blueprint = compileBlueprint(BOSTON_BLUEPRINT);

  const expected = ALL_CONCEPTS.filter(
    (concept) =>
      concept.owner.chapterId === CHAPTER_BOSTON &&
      concept.assessable &&
      concept.tier === "MACRO",
  );
  assert.equal(blueprint.conceptIds.length, expected.length);
  assert.ok(blueprint.conceptIds.length > 20, "the chapter is roughly 30 concepts");
  assert.deepEqual(
    [...blueprint.conceptIds],
    expected.map((concept) => concept.conceptId),
    "order is the registry's, which is grouped by parent standard",
  );
});

test("enrichment micros are not on the capstone", () => {
  const blueprint = compileBlueprint(BOSTON_BLUEPRINT);
  const micros = ALL_CONCEPTS.filter(
    (concept) =>
      concept.owner.chapterId === CHAPTER_BOSTON && concept.tier === "MICRO",
  );
  assert.ok(micros.length > 0, "Boston has micros to exclude");
  for (const micro of micros) {
    assert.equal(
      blueprint.conceptIds.includes(micro.conceptId),
      false,
      `${micro.conceptId} is reactive-world enrichment and cannot gate a chapter`,
    );
  }
});

test("two items per concept, and a six-item reserve target, are the defaults", () => {
  const blueprint = compileBlueprint(BOSTON_BLUEPRINT);
  assert.equal(blueprint.itemsPerConcept, 2);
  assert.equal(blueprint.reserveTargetPerConcept, 6);
});

test("a chapter the registry does not know has no capstone, and says so", () => {
  // A WRONG KEY AND AN EMPTY CHAPTER ARE DIFFERENT FAULTS AND REPORT DIFFERENTLY.
  // They were the same answer once — an empty concept list — which is how a
  // caller keyed `boston-1765` read a registry keyed `BOSTON` for as long as it
  // did without anything failing.
  assert.throws(
    () =>
      compileBlueprint({
        assessmentId: "NONE.CAPSTONE.v1",
        chapterId: "CHAPTER.DOES_NOT_EXIST",
        moduleId: "NONE.MODULE.v1",
      }),
    (error: unknown) =>
      error instanceof UnknownChapterError && error.known.includes(CHAPTER_BOSTON),
  );
  assert.throws(
    () =>
      compileBlueprint({
        assessmentId: "NONE.CAPSTONE.v1",
        chapterId: "CHAPTER.IS_KNOWN_BUT_EMPTY",
        moduleId: "NONE.MODULE.v1",
        concepts: staticConceptSource({ "CHAPTER.IS_KNOWN_BUT_EMPTY": [] }),
      }),
    /no assessable concepts/,
  );
});

test("the registry answers to the runtime chapter key, which is what the client sends", () => {
  // The whole defect in one assertion: this lookup used to be keyed on an
  // authoring spelling, so the id the API and every database row carry returned
  // nothing at all.
  const concepts = registryConceptSource().assessableConcepts(CHAPTER_BOSTON);
  assert.equal(CHAPTER_BOSTON, "boston-1765");
  assert.ok(concepts.length > 20);
  assert.throws(
    () => registryConceptSource().assessableConcepts("CHAPTER.DOES_NOT_EXIST"),
    UnknownChapterError,
  );
});

// ---------------------------------------------------------------------------
// The concept vocabulary
// ---------------------------------------------------------------------------

test("legacy identifiers retag through the registry instead of being accepted", () => {
  for (const [legacy, slug] of [
    ["RCC.DEBT_POLICY_INTRO", "POSTWAR_REVENUE"],
    ["8.4(A):STAMP_ACT", "STAMP_SCOPE"],
    ["BOS.MD01.CONCEPT.REPRESENTATION.v1", "REPRESENTATION"],
  ] as const) {
    const resolved = resolveConceptRef(legacy);
    assert.equal(resolved.ok, true, `${legacy} should retag`);
    assert.equal(
      resolved.ok && resolved.conceptId,
      bostonConceptId(slug),
      `${legacy} must land on the canonical id, not a ninth spelling`,
    );
  }
});

test("a student expectation is refused as too coarse to keep mastery against", () => {
  // 8.4(A) names six independent causes of the Revolution. A student can hold
  // four and miss two, so it cannot be the unit a mastery record is kept for.
  const resolved = resolveConceptRef("8.4(A)");
  assert.equal(resolved.ok, false);
  assert.equal(
    resolved.ok === false && resolved.failure,
    "RESOLVES_TO_SE_NOT_CONCEPT",
  );
});

test("a strand, a placeholder and an invented id are each refused", () => {
  for (const reference of ["8.29", "TEKS.PENDING_SME_REVIEW", "RCC.MADE_UP"]) {
    assert.equal(
      resolveConceptRef(reference).ok,
      false,
      `${reference} must not become a concept`,
    );
  }
});

test("a well-formed but unregistered concept id is refused", () => {
  const resolved = resolveConceptRef("BOS.CONCEPT.NOT_REAL.v1");
  assert.equal(resolved.ok, false);
  assert.equal(resolved.ok === false && resolved.failure, "UNKNOWN_IDENTIFIER");
});

// ---------------------------------------------------------------------------
// Where the content actually stands
// ---------------------------------------------------------------------------

test("with an empty bank every Boston concept is unassessable, and nothing crashes", () => {
  const blueprint = compileBlueprint(BOSTON_BLUEPRINT);
  const readiness = blueprintReadiness(blueprint, buildItemBank([]));

  assert.equal(readiness.formBuildable, false);
  assert.equal(
    readiness.unassessableConceptIds.length,
    blueprint.conceptIds.length,
  );
  for (const entry of readiness.byConcept) {
    assert.equal(entry.status, "UNASSESSABLE");
    assert.equal(entry.findings.includes("NO_ITEMS_AT_ALL"), true);
    assert.equal(entry.findings.includes("NO_RELEASED_TEA_ITEM"), true);
  }
  assert.equal(readiness.provenance.total, 0);
});

test("one released TEA item plus one authored item makes a concept assessable", () => {
  const conceptId = bostonConceptId("STAMP_SCOPE");
  const released = fromReleasedItemCapture(
    {
      itemId: "STAAR.2019.G8SS.07",
      itemVersion: "v1",
      provenance: {
        administration: "2019 May",
        testForm: "STAAR Grade 8 Social Studies",
        itemNumberAsPublished: 7,
        teksAsPublished: "8.4(A)",
        reportingCategory: 1,
        sourceUrl: "https://tea.texas.gov/form",
        keySourceUrl: "https://tea.texas.gov/key",
      },
      era: "1765",
      stem: "Which item required a stamp under the Stamp Act of 1765?",
      stimulus: { text: null, imageDependent: false },
      options: [
        { optionId: "A", text: "A newspaper" },
        { optionId: "B", text: "A bolt of cloth" },
        { optionId: "C", text: "A barrel of fish" },
        { optionId: "D", text: "A private letter" },
      ],
      optionPoolComplete: true,
    },
    conceptId,
  );
  const authored: AssessmentItemDescriptor = {
    itemId: "BOS.CAPSTONE.STAMP.AUTHORED.01",
    itemVersion: "v1",
    conceptId,
    format: "OPEN_RESPONSE",
    provenance: {
      kind: "AUTHORED_STAAR_STYLE",
      authoredIn: "docs/chapters/boston-1765/Mission-Slate.md 4.9",
      modelledOnItemId: "STAAR.2019.G8SS.07",
    },
    reviewStatus: "OWNER_PROVIDED",
    era: "1765",
    stem: null,
    prompt: "A printer says the Act taxes his whole trade. Explain why.",
    options: [],
    usableAsIs: true,
    optionPoolComplete: null,
  };

  const blueprint = compileBlueprint(BOSTON_BLUEPRINT);
  const readiness = blueprintReadiness(
    blueprint,
    buildItemBank([released, authored], { eraWindow: BOSTON_ERA_WINDOW }),
  );
  const entry = readiness.byConcept.find((row) => row.conceptId === conceptId);

  assert.equal(entry?.status, "THIN", "one form is buildable; a retry will recycle");
  assert.equal(entry?.eligibleItems, 2);
  assert.equal(entry?.releasedTeaItems, 1);
  assert.equal(entry?.authoredItems, 1);
  assert.equal(entry?.openResponseItems, 1);
  assert.deepEqual(
    [...(entry?.findings ?? [])],
    [
      "RESERVE_BELOW_TARGET",
      // One prose item covers one form's quota, not three.
      "OPEN_RESPONSE_BELOW_FORM_QUOTA",
      "UNTAGGED_PROBE",
    ],
  );
  assert.equal(
    entry?.guessResistantFormsAvailable,
    1,
    "the one prose item is what makes exactly one form unguessable",
  );
  assert.equal(readiness.formBuildable, false, "the other concepts are still empty");
});

test("an item outside Boston's era window is refused however well its concept fits", () => {
  const conceptId = bostonConceptId("GRIEVANCE_TO_RIGHT");
  // The quartering item in the existing bank: concept in scope, era 1789-1791.
  const item: AssessmentItemDescriptor = {
    itemId: "BANK.BOSTON.USER.Q22.v1",
    itemVersion: "v1",
    conceptId,
    format: "SELECTED_RESPONSE",
    provenance: {
      kind: "AUTHORED_STAAR_STYLE",
      authoredIn: "packages/chapter-boston/src/cp1Bank.ts",
    },
    reviewStatus: "OWNER_PROVIDED",
    era: "1789-1791",
    stem: "Which amendment answered the quartering grievance?",
    options: [
      { optionId: "A", text: "First" },
      { optionId: "B", text: "Third" },
    ],
    usableAsIs: true,
    optionPoolComplete: true,
  };

  const bank = buildItemBank([item], { eraWindow: BOSTON_ERA_WINDOW });
  assert.equal(bank.eligibleForConcept(conceptId).length, 0);
  assert.deepEqual(
    [...(bank.refused[0]?.refusals ?? [])],
    ["ERA_OUTSIDE_WINDOW"],
  );
});

test("the registry source answers the three questions the engine asks", () => {
  const source = registryConceptSource();
  const concepts = source.assessableConcepts(CHAPTER_BOSTON);
  assert.ok(concepts.length > 0);

  const postwar = source.concept(bostonConceptId("POSTWAR_REVENUE"));
  assert.equal(postwar?.label, "Postwar revenue policy");
  assert.equal(postwar?.tier, "MACRO");
  assert.deepEqual(
    [...(postwar?.codexCardIds ?? [])],
    [
      "BOS.MD01.CARD.WAR_DEBT.v1",
      "BOS.MD01.CARD.COLONIAL_REVENUE.v1",
      "BOS.MD01.CARD.DEBT_TO_STAMP_CHAIN.v1",
    ],
    "100% on this concept makes all three of its cards PvP-legal",
  );
  assert.equal(source.concept(bostonConceptId("NOT_A_CONCEPT")), undefined);
});
