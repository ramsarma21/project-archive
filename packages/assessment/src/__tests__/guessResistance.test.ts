// Guess resistance, and the item form the fresh-item rule depends on.
//
// Two properties the engine now enforces rather than hopes for, both of them
// consequences of decisions taken elsewhere in this package:
//
//   1. Mastery is 100% of two items with no partial credit, and retries are
//      unlimited. Two four-option multiple-choice items give a blind guesser 1/16
//      per attempt, and unlimited independent rolls converge on 1. So every form
//      must carry an open-response item, because prose cannot be guessed.
//   2. Selection treats a concept's reserve as interchangeable and draws fresh
//      ids on a retry. That is only a real retry if the items are different
//      QUESTIONS and not one question reworded, which an id cannot detect. So
//      the two items on a form must take different routes to the concept.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FRESH_FORM_TARGET,
  ITEM_PROBES,
  OPEN_RESPONSE_PER_FORM,
  RESERVE_TARGET_PER_CONCEPT,
  blueprintReadiness,
  compileBlueprint,
  deriveFormSeedHex,
  selectForm,
  type ItemProbe,
} from "../index.js";
import {
  answerAll,
  conceptId,
  makeFixture,
  newSession,
  sit,
} from "./harness.js";

const SIX_PROBES: readonly ItemProbe[] = [
  "RECALL",
  "BOUNDARY",
  "ORDERING",
  "CORRECTION",
  "DISCRIMINATION",
  "APPLICATION",
];

// ---------------------------------------------------------------------------
// The arithmetic that makes the quota a requirement
// ---------------------------------------------------------------------------

test("two four-option items at 100% is a 1/16 guess, which unlimited retries converge on", () => {
  const perAttempt = (1 / 4) ** 2;
  assert.equal(perAttempt, 0.0625);

  // The engine deliberately allows unlimited attempts, and each draws fresh
  // items, so the rolls are independent. This is why one prose item per form is a
  // requirement rather than a preference.
  const within = (attempts: number) => 1 - (1 - perAttempt) ** attempts;
  assert.ok(within(3) > 0.17);
  assert.ok(within(20) > 0.72);
  assert.equal(OPEN_RESPONSE_PER_FORM, 1);
});

test("the reserve target is sized for three forms of the quota", () => {
  assert.equal(FRESH_FORM_TARGET, 3);
  assert.equal(RESERVE_TARGET_PER_CONCEPT, 6);
  assert.equal(
    OPEN_RESPONSE_PER_FORM * FRESH_FORM_TARGET,
    3,
    "three prose items per concept: one for each fresh form",
  );
});

// ---------------------------------------------------------------------------
// The quota, enforced in selection
// ---------------------------------------------------------------------------

test("every form carries its open-response item when the reserve holds three", async () => {
  const fixture = makeFixture({
    slugs: ["ALPHA"],
    reserve: 6,
    openResponseCount: 3,
    openResponsePerForm: 1,
  });
  const session = newSession(fixture);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await sit(session, () => "WRONG");
    const form = result.record.attempts[attempt - 1]?.form[0];
    assert.equal(
      form?.openResponseItemIds.length,
      1,
      `attempt ${attempt} must contain a prose item`,
    );
    assert.equal(form?.itemIds.length, 2);
  }
});

test("the quota is drawn first, so a thin prose reserve is not wasted", () => {
  // Three prose items and three multiple-choice. If selection drew by shuffle
  // alone it would sometimes spend two prose items on one form and leave a later
  // form with none.
  const fixture = makeFixture({
    slugs: ["ALPHA"],
    reserve: 6,
    openResponseCount: 3,
    openResponsePerForm: 1,
  });
  for (const attemptOrdinal of [1, 2, 3, 4, 5]) {
    const selection = selectForm({
      blueprint: fixture.blueprint,
      bank: fixture.bank,
      scopedConceptIds: fixture.conceptIds,
      ledger: [],
      seedHex: deriveFormSeedHex(["quota", attemptOrdinal]),
    });
    const concept = selection.concepts[0];
    assert.equal(
      concept?.openResponseItemIds.length,
      1,
      "exactly the quota, never two, whatever the shuffle produced",
    );
    assert.equal(concept?.guessResistant, true);
  }
});

test("a concept with no prose item is served anyway and reported as guessable", async () => {
  const fixture = makeFixture({
    slugs: ["PROSE", "RECOGNITION_ONLY"],
    reserve: 6,
    openResponseCount: { PROSE: 3, RECOGNITION_ONLY: 0 },
    openResponsePerForm: 1,
  });
  const selection = selectForm({
    blueprint: fixture.blueprint,
    bank: fixture.bank,
    scopedConceptIds: fixture.conceptIds,
    ledger: [],
    seedHex: deriveFormSeedHex(["gap", 1]),
  });

  const byConcept = new Map(
    selection.concepts.map((concept) => [concept.conceptId, concept]),
  );
  assert.equal(byConcept.get(conceptId("PROSE"))?.guessResistant, true);
  assert.equal(
    byConcept.get(conceptId("RECOGNITION_ONLY"))?.guessResistant,
    false,
  );
  assert.deepEqual(
    [...selection.guessableConceptIds],
    [conceptId("RECOGNITION_ONLY")],
    "reported, not refused — the same asymmetry as an exhausted reserve",
  );
  assert.equal(
    byConcept.get(conceptId("RECOGNITION_ONLY"))?.itemIds.length,
    2,
    "the student is still asked; the content gap is ours to fix",
  );
});

test("the committed log says which items were prose, without consulting the bank", async () => {
  const fixture = makeFixture({
    slugs: ["ALPHA"],
    reserve: 6,
    openResponseCount: 3,
    openResponsePerForm: 1,
  });
  const session = newSession(fixture);
  await sit(session, answerAll);

  const opened = session.events.find((event) => event.type === "ATTEMPT_OPENED");
  assert.ok(opened && opened.type === "ATTEMPT_OPENED");
  const form = opened.form[0];
  assert.equal(form?.openResponseItemIds.length, 1);
  assert.ok(
    form?.itemIds.includes(form.openResponseItemIds[0]!),
    "the prose ids are a subset of the served ids",
  );
});

test("readiness predicts how many forms will be guessable", () => {
  const fixture = makeFixture({
    slugs: ["FULL", "THIN_PROSE", "NO_PROSE"],
    reserve: 6,
    openResponseCount: { FULL: 3, THIN_PROSE: 1, NO_PROSE: 0 },
    openResponsePerForm: 1,
  });
  const byConcept = new Map(
    blueprintReadiness(fixture.blueprint, fixture.bank).byConcept.map((entry) => [
      entry.conceptId,
      entry,
    ]),
  );

  const full = byConcept.get(conceptId("FULL"));
  assert.equal(full?.freshFormsAvailable, 3);
  assert.equal(full?.guessResistantFormsAvailable, 3);
  assert.equal(full?.findings.includes("OPEN_RESPONSE_BELOW_FORM_QUOTA"), false);

  const thin = byConcept.get(conceptId("THIN_PROSE"));
  assert.equal(thin?.freshFormsAvailable, 3);
  assert.equal(
    thin?.guessResistantFormsAvailable,
    1,
    "three forms buildable, one of them unguessable",
  );
  assert.equal(thin?.findings.includes("OPEN_RESPONSE_BELOW_FORM_QUOTA"), true);

  const none = byConcept.get(conceptId("NO_PROSE"));
  assert.equal(none?.guessResistantFormsAvailable, 0);
  assert.equal(none?.findings.includes("NO_OPEN_RESPONSE_ITEM"), true);
});

// ---------------------------------------------------------------------------
// Probe distinctness
// ---------------------------------------------------------------------------

test("there are six probe stances, one per item in a full reserve", () => {
  assert.equal(ITEM_PROBES.length, 6);
  assert.equal(ITEM_PROBES.length, RESERVE_TARGET_PER_CONCEPT);
  assert.equal(new Set(ITEM_PROBES).size, 6);
});

test("a form's two items take different routes to the concept", async () => {
  const fixture = makeFixture({
    slugs: ["ALPHA"],
    reserve: 6,
    probes: SIX_PROBES,
  });
  const session = newSession(fixture);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await sit(session, () => "WRONG");
    const selection = result.record.attempts[attempt - 1];
    const itemIds = selection?.form[0]?.itemIds ?? [];
    const probes = itemIds.map(
      (itemId) => fixture.bank.item(itemId)?.probe ?? "UNSPECIFIED",
    );
    assert.equal(
      new Set(probes).size,
      2,
      `attempt ${attempt} asked the same question twice: ${probes.join(", ")}`,
    );
  }
});

test("three forms over a six-probe reserve cover all six stances", () => {
  const fixture = makeFixture({
    slugs: ["ALPHA"],
    reserve: 6,
    probes: SIX_PROBES,
  });
  let ledger = fixture.bank.items.length > 0 ? [] : [];
  const seen = new Set<ItemProbe>();
  let served: string[] = [];

  for (let attemptOrdinal = 1; attemptOrdinal <= 3; attemptOrdinal += 1) {
    const selection = selectForm({
      blueprint: fixture.blueprint,
      bank: fixture.bank,
      scopedConceptIds: fixture.conceptIds,
      ledger,
      seedHex: deriveFormSeedHex(["probes", attemptOrdinal]),
    });
    const concept = selection.concepts[0]!;
    assert.equal(concept.probesDistinct, true);
    for (const itemId of concept.itemIds) {
      seen.add(fixture.bank.item(itemId)?.probe ?? "UNSPECIFIED");
    }
    served = [...served, ...concept.itemIds];
    ledger = [{ conceptId: conceptId("ALPHA"), servedItemIds: served }];
  }

  assert.equal(seen.size, 6, "every stance is used exactly once across three forms");
  assert.equal(seen.has("UNSPECIFIED"), false);
});

test("untagged items report probesDistinct false rather than pretending", () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const selection = selectForm({
    blueprint: fixture.blueprint,
    bank: fixture.bank,
    scopedConceptIds: fixture.conceptIds,
    ledger: [],
    seedHex: deriveFormSeedHex(["untagged", 1]),
  });
  assert.equal(selection.concepts[0]?.probesDistinct, false);
  assert.equal(
    blueprintReadiness(fixture.blueprint, fixture.bank).byConcept[0]?.findings.includes(
      "UNTAGGED_PROBE",
    ),
    true,
  );
});

test("a duplicated stance in the reserve is reported as a content defect", () => {
  const fixture = makeFixture({
    slugs: ["ALPHA"],
    reserve: 6,
    // Only three distinct stances across six items: each appears twice.
    probes: ["RECALL", "BOUNDARY", "ORDERING"],
  });
  const entry = blueprintReadiness(fixture.blueprint, fixture.bank).byConcept[0];
  assert.equal(entry?.findings.includes("DUPLICATE_PROBE"), true);
  assert.equal(entry?.probesCovered.length, 3);
});

test("probe preference never costs determinism", () => {
  const fixture = makeFixture({
    slugs: ["ALPHA", "BETA"],
    reserve: 6,
    probes: SIX_PROBES,
    openResponseCount: 3,
    openResponsePerForm: 1,
  });
  const input = {
    blueprint: fixture.blueprint,
    bank: fixture.bank,
    scopedConceptIds: fixture.conceptIds,
    ledger: [],
    seedHex: deriveFormSeedHex(["determinism", 1]),
  };
  assert.deepEqual(selectForm(input), selectForm(input));
});

test("the quota and the probe rule hold together on a full-spec concept", () => {
  const fixture = makeFixture({
    slugs: ["ALPHA"],
    reserve: 6,
    probes: SIX_PROBES,
    openResponseCount: 3,
    openResponsePerForm: 1,
  });
  const readiness = blueprintReadiness(fixture.blueprint, fixture.bank).byConcept[0];

  assert.equal(readiness?.status, "READY");
  assert.equal(readiness?.freshFormsAvailable, 3);
  assert.equal(readiness?.guessResistantFormsAvailable, 3);
  assert.equal(readiness?.probesCovered.length, 6);
  assert.deepEqual(
    [...(readiness?.findings ?? [])],
    ["NO_RELEASED_TEA_ITEM"],
    "the only thing left to want is a released TEA item",
  );
});

test("the production blueprint default demands a prose item on every form", () => {
  const blueprint = compileBlueprint({
    assessmentId: "X",
    chapterId: "C",
    moduleId: "M",
    concepts: {
      assessableConcepts: () => [
        {
          conceptId: conceptId("ALPHA"),
          label: "Alpha",
          codexCardIds: [],
          tier: "MACRO" as const,
        },
      ],
      concept: () => undefined,
    },
  });
  assert.equal(blueprint.openResponsePerForm, OPEN_RESPONSE_PER_FORM);
  assert.equal(blueprint.openResponsePerForm, 1);
});
