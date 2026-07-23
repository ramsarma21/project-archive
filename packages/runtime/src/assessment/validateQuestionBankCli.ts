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
