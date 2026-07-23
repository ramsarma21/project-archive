import { CONCEPT_PRIORITY, type ConceptId } from "@pa/contracts";
import type { Ctx, Sub } from "../../engine/ctx.js";
import { choose } from "../../engine/dsl.js";
import {
  commitExposure,
  canPresentInitialSync,
  canPresentRetrySync,
  applyInitialSync,
  applyRetrySync,
  unlockDemonstration,
} from "../../learner.js";
import { SYNC_PROMPTS, RETRY_EXPOSURES, type ExposureDef } from "./tables.js";

// Commit a tracked exposure (no yield). Ambient content must never call this.
export function exposure(ctx: Ctx, def: ExposureDef): void {
  commitExposure(
    ctx.learner,
    def.concept,
    def.exposureId,
    def.type,
    ctx.world.currentInteractionOrdinal,
    def.provenance,
  );
}

// Present a concept's initial Sync. Correct -> Understood + Notes once.
// Wrong -> no Notes, no negative label, set re-exposure obligation.
export function* runInitialSync(ctx: Ctx, concept: ConceptId): Sub<void> {
  const p = SYNC_PROMPTS[concept];
  ctx.dialogue("ARCHIVE", p.frame);
  const options = p.choices.map((c) => ({ choiceId: c.choiceId, label: c.label, tags: [] as string[] }));
  const before = ctx.world.clock.spentUnits < ctx.world.clock.fixedEventBoundary;
  const choiceId = yield* choose(ctx, `${p.initialActionId}:${ctx.nextTxId()}`, p.frame, options);
  if (before) ctx.spendTime(1);
  const picked = p.choices.find((c) => c.choiceId === choiceId)!;
  const txId = ctx.nextTxId();
  const res = applyInitialSync(ctx.learner, concept, picked.correct, txId, RETRY_EXPOSURES[concept].exposureId);
  if (res.understood) {
    if (res.notesAdded) ctx.addNotes(p.notes);
    unlockDemonstration(ctx.learner, concept);
  }
  ctx.resetSyncSpacing();
}

// Present the retry Sync after a re-exposure + spacing. On a second miss, run a
// bounded in-place correction (nudge + disable distractor) and finish Understood.
export function* runRetrySync(ctx: Ctx, concept: ConceptId): Sub<void> {
  const p = SYNC_PROMPTS[concept];
  const disabled = new Set<string>();
  let steps = 0;
  while (true) {
    ctx.dialogue("ARCHIVE", p.frame);
    const options = p.choices.map((c) => ({
      choiceId: c.choiceId,
      label: c.label,
      tags: [] as string[],
      disabled: disabled.has(c.choiceId),
    }));
    const choiceId = yield* choose(ctx, `${p.retryActionId}:${ctx.nextTxId()}`, p.frame, options);
    const picked = p.choices.find((c) => c.choiceId === choiceId)!;
    if (picked.correct) break;
    steps += 1;
    if (picked.nudge) ctx.dialogue("ARCHIVE", picked.nudge);
    disabled.add(picked.choiceId);
    if (steps >= 2) {
      // eliminate all remaining distractors; only the target remains selectable
      p.choices.filter((c) => !c.correct).forEach((c) => disabled.add(c.choiceId));
    }
  }
  const txId = ctx.nextTxId();
  const res = applyRetrySync(ctx.learner, concept, txId);
  if (res.notesAdded) ctx.addNotes(p.notes);
  unlockDemonstration(ctx.learner, concept);
  ctx.resetSyncSpacing();
}

// Run any due initial Syncs (priority order, spacing-gated). anyLock defers.
export function* maybeRunSyncs(ctx: Ctx, anyLock: boolean): Sub<void> {
  for (const concept of CONCEPT_PRIORITY) {
    if (
      canPresentInitialSync(
        ctx.learner,
        concept,
        ctx.interactionsSinceLastSync,
        anyLock,
        ctx.chapter.content.minimumInteractionsBetweenSyncs,
      )
    ) {
      yield* runInitialSync(ctx, concept);
    }
  }
}

// Present a re-exposure obligation's retry source, then the retry Sync.
export function* runReexposureAndRetry(ctx: Ctx, concept: ConceptId): Sub<void> {
  const c = ctx.learner[concept];
  if (c.understanding !== "REEXPOSURE_REQUIRED" || !c.pendingReexposure) return;
  const retry = RETRY_EXPOSURES[concept];
  // commit the reserved retry exposure
  ctx.narrate(`You take another look at the source.`);
  exposure(ctx, retry);
  ctx.countSpacing();
  // manufacture spacing so the retry can present
  if (c.pendingReexposure) c.pendingReexposure.spacingInteractionsSince = 2;
  if (
    canPresentRetrySync(
      ctx.learner,
      concept,
      ctx.chapter.content.minimumInteractionsBetweenSyncs,
    )
  ) {
    yield* runRetrySync(ctx, concept);
  }
}
