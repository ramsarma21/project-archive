// Run the gauntlet over a candidate file.
//
//   pnpm --filter @pa/grading grading:pipeline
//   pnpm --filter @pa/grading grading:pipeline --file content/m1/pipeline/candidates.example.json
//   pnpm --filter @pa/grading grading:pipeline --model            # also run the discriminator
//
// The static gauntlet always runs and needs no credential. Passing --model runs the
// overlap discriminator against the same TrueFoundry gateway the grader uses, one
// call per item; without a credential (or when the shared key is over budget) that
// half reports MODEL_UNAVAILABLE and the item is not cleared for ship, rather than
// passing unverified. Exits non-zero if any candidate has an ERROR.

import { loadRepoEnv } from "../env.js";
import { readContentFile, M1_DUEL_BANK_PATH } from "../items/m1.js";
import { providerConfigured } from "../provider.js";
import { runGauntlet } from "./gauntlet.js";
import { TrueFoundryPipelineModel } from "./model.js";
import type { CandidateItem, CardRef } from "./types.js";

const M1_CODEX_PATH = "content/m1/codex-cards.json";

interface CodexFile {
  readonly cards: readonly { cardId: string; conceptId: string; proposition: string; title?: string }[];
}
interface DuelBankFile {
  readonly items: readonly { question: string }[];
  readonly pvpHardening?: { items?: readonly { question: string }[] };
}
interface CandidateFile {
  readonly candidates: readonly CandidateItem[];
}

function flag(name: string): string | undefined | true {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const next = process.argv[index + 1];
  return next && !next.startsWith("--") ? next : true;
}

async function main(): Promise<void> {
  loadRepoEnv();
  const file = (flag("file") as string) ?? "content/m1/pipeline/candidates.example.json";
  const candidateFile = readContentFile<CandidateFile>(file);

  const codex = readContentFile<CodexFile>(M1_CODEX_PATH);
  const cards: CardRef[] = codex.cards.map((c) => ({
    cardId: c.cardId,
    conceptId: c.conceptId,
    proposition: c.proposition,
    ...(c.title === undefined ? {} : { title: c.title }),
  }));

  const bank = readContentFile<DuelBankFile>(M1_DUEL_BANK_PATH);
  const corpus = [
    ...bank.items.map((i) => i.question),
    ...(bank.pvpHardening?.items ?? []).map((i) => i.question),
  ];

  const wantModel = flag("model") !== undefined;
  const model =
    wantModel && providerConfigured() ? new TrueFoundryPipelineModel() : undefined;
  if (wantModel && !model) {
    console.error("warning: --model requested but no grading credential is resolvable; the discriminator will not run.\n");
  }

  console.error(
    `gauntlet: ${candidateFile.candidates.length} candidate(s) against ${cards.length} cards, ` +
      `corpus of ${corpus.length} authored questions${model ? ", with the model discriminator" : " (static only)"}\n`,
  );

  let anyError = false;
  for (const candidate of candidateFile.candidates) {
    const report = await runGauntlet({ candidate, cards, corpus, ...(model ? { model } : {}) });
    const errors = report.findings.filter((f) => f.severity === "ERROR");
    const warns = report.findings.filter((f) => f.severity === "WARN");
    const mark = report.passed ? "PASS" : "FAIL";
    console.log(`${mark}  ${report.itemId}${report.modelChecksRan ? "" : model ? "  (discriminator did not run)" : ""}`);
    for (const f of errors) console.log(`    ✗ [${f.check}/${f.code}] ${f.detail}`);
    for (const f of warns) console.log(`    · [${f.check}/${f.code}] ${f.detail}`);
    if (!report.passed) anyError = true;
    console.log("");
  }

  process.exit(anyError ? 1 : 0);
}

void main();
