import { MICRO_CONCEPT_IDS } from "../src/fieldIds.js";
import {
  correctOptionExplanation,
  isCheckpointScopedItem,
  type AssessmentItem,
  type AssessmentQuestionBank,
  type MicroConceptId,
} from "@pa/contracts";
import {
  resolveSelectedItems,
  selectDebrief,
  validateQuestionBank,
} from "@pa/runtime";
import {
  BOSTON_1765_CHAPTER,
  CP1_CHECKPOINT_ID,
  CP1_DEVELOPMENT_FIXTURE_BANK,
  CP1_PRODUCTION_BANK,
  CP1_REQUIRED_MACROS,
} from "../src/index.js";

const CP1_SPEC = BOSTON_1765_CHAPTER.assessment.checkpoint;
const isCp1ScopedItem = (item: AssessmentItem) =>
  isCheckpointScopedItem(item, CP1_CHECKPOINT_ID);

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function deepEqual(actual: unknown, expected: unknown, message = "values differ"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

function seed(value: number): Uint8Array {
  return Uint8Array.from({ length: 16 }, (_, index) => (value + index) & 0xff);
}

{
  const routes = ["MAIN_FAST", "BACK_LANES", "DOCK_ROUTE"];
  for (let value = 0; value < 64; value += 1) {
    for (const _route of routes) {
      const result = selectDebrief({
        checkpoint: CP1_SPEC,
        attemptSeed: seed(value),
        bank: CP1_DEVELOPMENT_FIXTURE_BANK,
        engagedMicroIds: [],
        allowDraft: true,
      });
      deepEqual(
        result.items
          .filter((item) => item.tier === "MACRO")
          .map((item) => item.conceptId),
        [...CP1_REQUIRED_MACROS],
      );
    }
  }
}

{
  const engaged = [
    MICRO_CONCEPT_IDS.PRINTERS_ROLE,
    MICRO_CONCEPT_IDS.NEWS_NETWORKS,
    MICRO_CONCEPT_IDS.LOYALIST_VIEW,
  ] as MicroConceptId[];
  for (let value = 0; value < 96; value += 1) {
    const result = selectDebrief({
      checkpoint: CP1_SPEC,
      attemptSeed: seed(value),
      bank: CP1_DEVELOPMENT_FIXTURE_BANK,
      engagedMicroIds: engaged,
      allowDraft: true,
      maxEnrichment: 2,
    });
    const micros = result.items.filter((item) => item.tier === "MICRO");
    assert(micros.length <= 2);
    assert(micros.every((item) => engaged.includes(item.conceptId as MicroConceptId)));
  }
  const empty = selectDebrief({
    checkpoint: CP1_SPEC,
    attemptSeed: seed(7),
    bank: CP1_DEVELOPMENT_FIXTURE_BANK,
    engagedMicroIds: [],
    allowDraft: true,
  });
  deepEqual(empty.selection.microItemIds, []);
}

{
  const input = {
    checkpoint: CP1_SPEC,
    attemptSeed: seed(42),
    bank: CP1_DEVELOPMENT_FIXTURE_BANK,
    engagedMicroIds: Object.values(MICRO_CONCEPT_IDS),
    allowDraft: true,
  } as const;
  deepEqual(selectDebrief(input), selectDebrief(input));
}

{
  let threw = false;
  try {
    selectDebrief({
        checkpoint: CP1_SPEC,
        attemptSeed: seed(1),
        bank: CP1_DEVELOPMENT_FIXTURE_BANK,
        engagedMicroIds: [],
        allowDraft: false,
      });
  } catch (error) {
    threw = error instanceof Error && /ASSESSMENT_BANK_INVALID/.test(error.message);
  }
  assert(threw, "production must reject draft fixtures");
  // The production bank now carries the owner-provided items. Two of the three
  // CP1 macros are production-eligible (DEBT_POLICY via Q5, REPRESENTATION via
  // Q24); STAMP_INTERNAL still has no owner item, so production CP1 stays
  // BLOCKED on that one macro. The report must surface exactly that.
  const report = validateQuestionBank(CP1_PRODUCTION_BANK, CP1_SPEC, {
    production: true,
  });
  assert(report.valid === false, "production stays blocked on the missing macro");
  assert(
    report.missingContent.some((line) => line.includes("RCC.STAMP_INTERNAL_INTRO")),
    "STAMP_INTERNAL_INTRO must be surfaced as missing",
  );
  assert(
    !report.missingContent.some((line) => line.includes("RCC.DEBT_POLICY_INTRO")),
    "DEBT_POLICY is now covered by an owner item",
  );
  assert(
    !report.missingContent.some((line) => line.includes("RCC.REPRESENTATION_CAUSE")),
    "REPRESENTATION is now covered by an owner item",
  );
  // Exactly the STAMP macro blocks the gate.
  assert(
    report.errors.some((line) => line.includes("RCC.STAMP_INTERNAL_INTRO")),
    "the missing STAMP macro is the hard error keeping the gate blocked",
  );
}

// ---------------------------------------------------------------------------
// Era scoping: CP1 must select ONLY 1765-scope items. Build an "expanded"
// bank = the dev fixtures (all three macros + micros) + every owner item
// (the two 1765 macros AND the post-1765 items) + a synthetic post-1765 item
// whose concept id aliases a CP1 macro but whose actScope excludes CP1. CP1
// selection must always cover the three macros and never select a post-1765
// item (even the aliasing one) nor an unengaged micro.
// ---------------------------------------------------------------------------
{
  const aliasingFutureItem: AssessmentItem = {
    itemId: "TEST.FUTURE.ALIAS.REPRESENTATION",
    itemVersion: "v1",
    tier: "MACRO",
    // Deliberately aliases a CP1 macro concept to prove era filtering excludes
    // it independently of the concept filter.
    conceptId: CP1_REQUIRED_MACROS[2],
    teksTags: ["TEKS.PENDING_SME_REVIEW"],
    era: "1791",
    actScope: ["BOS.POST_CP1"],
    approvalStatus: "OWNER_PROVIDED",
    difficulty: "ON_LEVEL",
    stem: "Post-1765 aliasing guard item.",
    options: [
      { optionId: "A", text: "right" },
      { optionId: "B", text: "wrong" },
    ],
    correctOptionId: "A",
  };
  const expanded: AssessmentQuestionBank = {
    bankId: "TEST.EXPANDED",
    bankVersion: "test.expanded.1",
    approvalStatus: "OWNER_PROVIDED",
    items: [
      ...CP1_DEVELOPMENT_FIXTURE_BANK.items,
      ...CP1_PRODUCTION_BANK.items,
      aliasingFutureItem,
    ],
  };
  const post1765Ids = new Set(
    expanded.items.filter((item) => !isCp1ScopedItem(item)).map((i) => i.itemId),
  );
  assert(post1765Ids.has("TEST.FUTURE.ALIAS.REPRESENTATION"));
  assert(post1765Ids.has("BANK.BOSTON.USER.Q39.v1"));
  for (let value = 0; value < 96; value += 1) {
    const result = selectDebrief({
      checkpoint: CP1_SPEC,
      attemptSeed: seed(value),
      bank: expanded,
      engagedMicroIds: [],
      allowDraft: true,
    });
    // Always exactly the three CP1 macros, in the fixed order.
    deepEqual(
      result.items
        .filter((item) => item.tier === "MACRO")
        .map((item) => item.conceptId),
      [...CP1_REQUIRED_MACROS],
    );
    // No post-1765 item is ever selected, and no unengaged micro.
    for (const item of result.items) {
      assert(
        !post1765Ids.has(item.itemId),
        `post-1765 item leaked into CP1 selection: ${item.itemId}`,
      );
      assert(isCp1ScopedItem(item), `non-CP1-scoped item selected: ${item.itemId}`);
    }
    assert(
      result.items.every((item) => item.tier === "MACRO"),
      "no micros when none engaged",
    );
  }
}

// ---------------------------------------------------------------------------
// Rationale round-trip: per-option rationales survive selection + resolution,
// and the correct option's rationale is retrievable as the explanation. Uses a
// minimal bank with the two owner CP1 macros + the dev STAMP macro so a full
// CP1 form resolves.
// ---------------------------------------------------------------------------
{
  const devStamp = CP1_DEVELOPMENT_FIXTURE_BANK.items.find(
    (item) => item.tier === "MACRO" && item.conceptId === CP1_REQUIRED_MACROS[1],
  );
  assert(devStamp, "dev fixture must supply a STAMP macro");
  const q5 = CP1_PRODUCTION_BANK.items.find(
    (item) => item.itemId === "BANK.BOSTON.USER.Q05.v1",
  );
  const q24 = CP1_PRODUCTION_BANK.items.find(
    (item) => item.itemId === "BANK.BOSTON.USER.Q24.v1",
  );
  assert(q5 && q24, "owner CP1 macros present");
  const bank: AssessmentQuestionBank = {
    bankId: "TEST.RATIONALE",
    bankVersion: "test.rationale.1",
    approvalStatus: "OWNER_PROVIDED",
    items: [q5!, q24!, devStamp!],
  };
  const { selection, items } = selectDebrief({
    checkpoint: CP1_SPEC,
    attemptSeed: seed(3),
    bank,
    engagedMicroIds: [],
    allowDraft: true,
  });
  const selectedQ5 = items.find((item) => item.itemId === "BANK.BOSTON.USER.Q05.v1");
  assert(selectedQ5, "Q5 selected as DEBT_POLICY macro");
  assert(
    selectedQ5!.options.every((option) => typeof option.rationale === "string"),
    "every option keeps its rationale through selection",
  );
  assert(selectedQ5!.provenance === "user-supplied 2026-07-23");
  assert(selectedQ5!.era === "1764-1767");
  assert(selectedQ5!.actScope?.includes(CP1_CHECKPOINT_ID));
  assert(
    correctOptionExplanation(selectedQ5!) ===
      "these acts taxed colonial goods to help pay expenses from the French and Indian War and continued protection of British claims in America.",
    "correct-option rationale doubles as the explanation",
  );
  // resolveSelectedItems round-trips the same rationales back from itemIds.
  const resolved = resolveSelectedItems(bank, CP1_SPEC, selection, true);
  const resolvedQ24 = resolved.find(
    (item) => item.itemId === "BANK.BOSTON.USER.Q24.v1",
  );
  assert(resolvedQ24, "Q24 resolves from the committed selection");
  assert(
    correctOptionExplanation(resolvedQ24!) ===
      "colonists believed as Englishmen they had the right to political representation; they could not elect members of Parliament; the resolutions expressed opposition to taxation without representation.",
    "rationale survives the itemId round-trip",
  );
}
