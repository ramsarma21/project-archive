// M1's item bank, read from authored content.
//
// This file used to hold eighteen items transliterated by hand from Mission-Slate
// §4.9's draft. It does not any more. `content/m1/duel-items.json` is the
// production bank, its rubric lines are calibrated against TEA-scored student
// responses, and it supersedes the transliteration — see ./port.ts for the
// field-by-field mapping and for what the calibration data changed.
//
// The content is read from the repository rather than duplicated here, so an edit
// by the content pass lands without anybody re-transliterating it. The drift test
// in ../__tests__/contentBank.test.ts fails if the file stops satisfying what this
// service needs, which is the same guarantee a generated artifact gives without a
// second copy of the bank to keep in step.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compilePool, ItemBank, type AuthoredPool } from "../rubric.js";
import { toAuthoredPools, type ContentBank } from "./port.js";

/** `packages/grading/src/items` → repo root. */
function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
}

export const M1_DUEL_BANK_PATH = "content/m1/duel-items.json";
export const M1_LABELLED_ANSWERS_PATH = "content/m1/eval/duel-answers.labeled.json";

export function readContentFile<T>(relativePath: string): T {
  return JSON.parse(
    readFileSync(resolve(repoRoot(), relativePath), "utf8"),
  ) as T;
}

let cachedBank: ContentBank | null = null;

export function m1ContentBank(): ContentBank {
  cachedBank ??= readContentFile<ContentBank>(M1_DUEL_BANK_PATH);
  return cachedBank;
}

export function m1AuthoredPools(): readonly AuthoredPool[] {
  return toAuthoredPools(m1ContentBank());
}

let cachedItemBank: ItemBank | null = null;

/** The compiled M1 bank: three pools, six items each, eighteen items. */
export function m1ItemBank(): ItemBank {
  cachedItemBank ??= new ItemBank(m1AuthoredPools().map(compilePool));
  return cachedItemBank;
}

/**
 * The authored grading policy, as the classifier prompt's judging rules. The
 * content states them once for all eighteen items, which is right: they are the
 * calibration, not per-item authoring, and duplicating them per item would let
 * them drift apart.
 */
export function m1GradingPolicy(): {
  readonly policyId: string;
  readonly alwaysIgnore: readonly string[];
  readonly neverSufficient: readonly string[];
} {
  const policy = m1ContentBank().gradingPolicy;
  return {
    policyId: policy.policyId,
    alwaysIgnore: policy.alwaysIgnore,
    neverSufficient: policy.neverSufficient,
  };
}

/** Test hook. Nothing in the server calls this. */
export function resetM1BankCache(): void {
  cachedBank = null;
  cachedItemBank = null;
}
