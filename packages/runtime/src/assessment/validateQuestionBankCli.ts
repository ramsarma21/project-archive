import {
  CP1_REQUIRED_MACROS,
  isCp1ScopedItem,
  isProductionApprovedStatus,
} from "@pa/contracts";
import {
  CP1_DEVELOPMENT_FIXTURE_BANK,
  CP1_PRODUCTION_BANK,
} from "./questionBank.js";
import { validateQuestionBank } from "./validateQuestionBank.js";

declare const process: {
  argv: string[];
  exitCode?: number;
};

const production = validateQuestionBank(CP1_PRODUCTION_BANK, {
  production: true,
});
const development = validateQuestionBank(CP1_DEVELOPMENT_FIXTURE_BANK, {
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
      isCp1ScopedItem(item) &&
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
