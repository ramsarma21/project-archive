// The ship gate as a command.
//
//   pnpm --filter @pa/grading grading:eval
//   pnpm --filter @pa/grading grading:eval --model gemini-group/gemini-3.5-flash-lite
//   pnpm --filter @pa/grading grading:eval --category UNUSUAL_PHRASING
//
// Exits non-zero when the gate fails, so it can sit in front of a release without
// anybody having to read the output. It calls a real model against real credentials
// and is therefore not part of `pnpm test`; the offline suite checks the harness,
// the labelling and the set's integrity, and this checks the grader.

import { loadRepoEnv } from "../env.js";
import { m1GradingPolicy, m1ItemBank } from "../items/m1.js";
import { DEFAULT_JUDGING_POLICY } from "../prompt.js";
import {
  TrueFoundryClassifierProvider,
  gradingModel,
  providerConfigured,
} from "../provider.js";
import { buildEvalSet, formatEvalReport, runEval } from "./harness.js";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  loadRepoEnv();
  if (!providerConfigured()) {
    console.error(
      "no grading credential: set TRUEFOUNDRY_GRADING_API_KEY (or TRUEFOUNDRY_API_KEY outside production) and TRUEFOUNDRY_BASE_URL",
    );
    process.exit(2);
  }
  const model = flag("model") ?? gradingModel();
  const bank = m1ItemBank();
  const category = flag("category");
  const all = buildEvalSet(bank);
  const cases =
    category === undefined
      ? all
      : all.filter((testCase) => testCase.category === category);
  if (cases.length === 0) {
    console.error(`no cases matched --category ${category}`);
    process.exit(2);
  }

  // The calibrated judging rules travel with the content bank; the built-in policy
  // is only a fallback for a bank that has none.
  const authored = m1GradingPolicy();
  const policy = {
    governingQuestion: DEFAULT_JUDGING_POLICY.governingQuestion,
    alwaysIgnore: authored.alwaysIgnore,
    neverSufficient: authored.neverSufficient,
  };

  console.error(
    `grading eval: ${cases.length} cases over ${bank.size} items against ${model}`,
  );
  console.error(`policy: ${authored.policyId}`);
  const report = await runEval({
    bank,
    provider: new TrueFoundryClassifierProvider(model),
    model,
    cases,
    policy,
    concurrency: Number(flag("concurrency") ?? 6),
    ...(flag("timeout") === undefined ? {} : { timeoutMs: Number(flag("timeout")) }),
    onProgress: (done, total) => {
      if (done % 20 === 0 || done === total) {
        process.stderr.write(`\r  ${done}/${total}   `);
      }
    },
  });
  process.stderr.write("\n\n");
  console.log(formatEvalReport(report));
  if (flag("json") !== undefined) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(flag("json") as string, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.exit(report.gate.pass ? 0 : 1);
}

void main();
