// The gauntlet: every check a candidate item must clear before it ships.
//
// ORDER IS DELIBERATE. The free deterministic checks run first; if any of them
// ERRORs, the item is already rejected and the model call is not spent. The model
// discriminator runs only when a model is supplied AND the static half is clean.
//
// "CHECKS BEFORE GENERATION" is the standing rule: this module, and its test suite
// feeding it deliberately trivial, overlapping and AI-tell-laden items, exist and
// pass before any generator is built. A generator without this gauntlet is worse
// than the hand-authoring it replaces, because the failure is silent and at scale.

import { checkAiTells, corpusStyle, type CorpusStyle } from "./aiTells.js";
import { checkStatic } from "./staticChecks.js";
import { discriminate } from "./discriminator.js";
import type { PipelineModel } from "./model.js";
import { summarise, type CandidateItem, type CardRef, type Finding, type GauntletReport } from "./types.js";

export interface GauntletInput {
  readonly candidate: CandidateItem;
  /** Every askable card to check binding and overlap against. */
  readonly cards: readonly CardRef[];
  /** The hand-authored question corpus, for the AI-tell style comparison. */
  readonly corpus?: readonly string[];
  /** Supply to run the model discriminator. Omit for the static-only gauntlet. */
  readonly model?: PipelineModel;
}

/** The free, deterministic gauntlet. No model, safe to call from anywhere. */
export function runStaticGauntlet(input: GauntletInput): readonly Finding[] {
  const style: CorpusStyle | undefined = input.corpus
    ? corpusStyle(input.corpus)
    : undefined;
  return [
    ...checkStatic(input.candidate, input.cards),
    ...checkAiTells(input.candidate, style),
  ];
}

/**
 * The full gauntlet. Runs the static checks always; runs the model discriminator
 * only when a model is supplied and the static half raised no ERROR (a candidate
 * that already fails statically is not worth a model call). `modelChecksRan` records
 * whether the discriminator actually contributed a judgement.
 */
export async function runGauntlet(input: GauntletInput): Promise<GauntletReport> {
  const findings: Finding[] = [...runStaticGauntlet(input)];
  const staticFailed = findings.some((f) => f.severity === "ERROR");
  let modelChecksRan = false;
  if (input.model && !staticFailed) {
    const discriminatorFindings = await discriminate(
      input.candidate,
      input.cards,
      input.model,
    );
    findings.push(...discriminatorFindings);
    modelChecksRan = !discriminatorFindings.some((f) => f.code === "MODEL_UNAVAILABLE");
  }
  const itemId = `${input.candidate.poolId}:${input.candidate.id}`;
  return summarise(findings, modelChecksRan, itemId);
}
