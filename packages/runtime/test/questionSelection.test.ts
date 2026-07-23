import {
  CP1_REQUIRED_MACROS,
  MICRO_CONCEPT_IDS,
  type MicroConceptId,
} from "@pa/contracts";
import {
  CP1_DEVELOPMENT_FIXTURE_BANK,
  CP1_PRODUCTION_BANK,
  selectDebrief,
  validateQuestionBank,
} from "../src/index.js";

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
    attemptSeed: seed(7),
    bank: CP1_DEVELOPMENT_FIXTURE_BANK,
    engagedMicroIds: [],
    allowDraft: true,
  });
  deepEqual(empty.selection.microItemIds, []);
}

{
  const input = {
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
        attemptSeed: seed(1),
        bank: CP1_DEVELOPMENT_FIXTURE_BANK,
        engagedMicroIds: [],
        allowDraft: false,
      });
  } catch (error) {
    threw = error instanceof Error && /ASSESSMENT_BANK_INVALID/.test(error.message);
  }
  assert(threw, "production must reject draft fixtures");
  const report = validateQuestionBank(CP1_PRODUCTION_BANK, {
    production: true,
  });
  assert(report.valid === false);
  assert(
    CP1_REQUIRED_MACROS.every((conceptId) =>
      report.missingContent.some((line) => line.includes(conceptId)),
    ),
  );
}
