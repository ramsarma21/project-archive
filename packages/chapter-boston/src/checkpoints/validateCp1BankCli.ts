import { isCheckpointScopedItem, isProductionApprovedStatus } from "@pa/contracts";
import { validateQuestionBank, type CheckpointSpec } from "@pa/runtime";
import { MICRO_CONCEPT_IDS } from "../fieldIds.js";
import {
  CP1_DEVELOPMENT_FIXTURE_BANK,
  CP1_PRODUCTION_BANK,
} from "./cp1Bank.js";
import {
  CP1_CHECKPOINT_ID,
  CP1_FORM_ID_PREFIX,
  CP1_REQUIRED_MACROS,
} from "./cp1Ids.js";

declare const process: {
  argv: string[];
  exitCode?: number;
};

const CP1_SPEC: CheckpointSpec = {
  checkpointId: CP1_CHECKPOINT_ID,
  requiredMacroConceptIds: CP1_REQUIRED_MACROS,
  microConceptIds: Object.values(MICRO_CONCEPT_IDS),
  formIdPrefix: CP1_FORM_ID_PREFIX,
};

const production = validateQuestionBank(CP1_PRODUCTION_BANK, CP1_SPEC, {
  production: true,
});
const development = validateQuestionBank(CP1_DEVELOPMENT_FIXTURE_BANK, CP1_SPEC, {
  production: false,
});

// Per-macro production eligibility: does the production bank hold a CP1-scoped,
// production-approved item for each required macro? Surfaces which of the three
// fixed CP1 macros are covered and which still block the production gate.
const macroEligibility = CP1_REQUIRED_MACROS.map((conceptId) => {
  const candidates = CP1_PRODUCTION_BANK.items.filter(
    (item) =>
      item.tier === "MACRO" &&
      item.conceptId === conceptId &&
      isCheckpointScopedItem(item, CP1_CHECKPOINT_ID) &&
      isProductionApprovedStatus(item.approvalStatus),
  );
  return {
    macro: conceptId,
    productionEligible: candidates.length > 0,
    itemIds: candidates.map((item) => item.itemId),
  };
});

console.log(
  JSON.stringify(
    {
      engineeringFixtureGate: {
        bank: `${CP1_DEVELOPMENT_FIXTURE_BANK.bankId}@${CP1_DEVELOPMENT_FIXTURE_BANK.bankVersion}`,
        valid: development.valid,
        errors: development.errors,
      },
      productionContentGate: {
        bank: `${CP1_PRODUCTION_BANK.bankId}@${CP1_PRODUCTION_BANK.bankVersion}`,
        selectable: production.valid,
        errors: production.errors,
        missingContent: production.missingContent,
        macroEligibility,
      },
    },
    null,
    2,
  ),
);

if (!development.valid) process.exitCode = 1;
if (process.argv.includes("--require-production") && !production.valid) {
  process.exitCode = 2;
}
