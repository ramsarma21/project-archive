import {
  type AssessmentItem,
  type CheckpointDebriefRequest,
  type CheckpointGateState,
  type CheckpointPresenterEvent,
  type ConceptId,
  type PresenterEvent,
} from "@pa/contracts";
import {
  computeGateState,
  resolveSelectedItems,
  selectDebrief,
  validateQuestionBank,
  type Ctx,
  type Sub,
} from "@pa/runtime";
import { CP1_CHECKPOINT_ID } from "./cp1Ids.js";

const NEXT_CHAPTER_ID = "PA.SEA01.CH02.BOSTON.1770.PENDING.v1";

// CP1 assessment concept ids -> learner ConceptIds (for the penalty curve's
// spaced re-test flag). SINGLE SOURCE: the chapter definition's gate maps.
function macroLearnerConcept(
  ctx: Ctx,
  assessmentConceptId: string,
): ConceptId | null {
  return (
    ctx.chapter.assessment.gateMaps.assessmentToLearner[assessmentConceptId] ??
    null
  );
}

function* requestCheckpoint(
  ctx: Ctx,
  request: CheckpointDebriefRequest,
  cueId: string,
): Sub<PresenterEvent> {
  const present = ctx.buffer.map((directive) =>
    directive.cueId ? directive : { ...directive, cueId },
  );
  ctx.buffer = [];
  return yield { present, request, cueId };
}

function eventForCheckpoint(
  event: PresenterEvent,
): CheckpointPresenterEvent {
  if (
    !("checkpointId" in event) ||
    event.checkpointId !== CP1_CHECKPOINT_ID
  ) {
    throw new Error("DEBRIEF_EVENT_INVALID: wrong checkpoint context");
  }
  return event as CheckpointPresenterEvent;
}

function sameSelection(
  left: { bankId: string; bankVersion: string; formId: string; itemIds: string[] },
  right: { bankId: string; bankVersion: string; formId: string; itemIds: string[] },
): boolean {
  return (
    left.bankId === right.bankId &&
    left.bankVersion === right.bankVersion &&
    left.formId === right.formId &&
    left.itemIds.length === right.itemIds.length &&
    left.itemIds.every((itemId, index) => itemId === right.itemIds[index])
  );
}

function carryover(ctx: Ctx) {
  return {
    relationships: { ...ctx.world.relationships },
    heatBand: ctx.field.heat.band,
    recognized: ctx.field.identity.recognized,
    clarkeMarked: ctx.field.identity.clarkeMarked,
    standingBand: ctx.field.standing.band,
    threads: structuredClone(ctx.field.threads) as Record<string, unknown>,
    routes: { ...ctx.world.routes },
    custody: Object.fromEntries(
      Object.entries(ctx.world.jobObjects).map(([id, value]) => [
        id,
        value.custody,
      ]),
    ),
    learner: structuredClone(ctx.learner) as Record<string, unknown>,
    microEngagements: Object.values(ctx.field.microEngagements)
      .sort((a, b) => a.interactionOrdinal - b.interactionOrdinal)
      .map((record) => structuredClone(record)),
    sourceProvenance: Object.values(ctx.field.sourceEngagements)
      .sort((a, b) => a.interactionOrdinal - b.interactionOrdinal)
      .map((record) => structuredClone(record)),
    formativeEvidence: Object.values(ctx.field.openResponseCompletions)
      .sort((a, b) => a.interactionOrdinal - b.interactionOrdinal)
      .map((record) => ({
        response: structuredClone(record.response),
        artifact: structuredClone(record.artifact),
        resolution: structuredClone(record.resolution),
      })),
    checkpointId: CP1_CHECKPOINT_ID,
    checkpointVersion: ctx.checkpoint.bankVersion ?? "UNKNOWN",
  };
}

export function* cp1CheckpointFlow(ctx: Ctx): Sub<void> {
  ctx.world.controlState = "CHECKPOINT";
  const activeBank = ctx.assessment.banks.get(ctx.assessment.activeBankVersion);
  if (!activeBank) {
    throw new Error(
      `ASSESSMENT_BANK_INVALID: unknown active version ${ctx.assessment.activeBankVersion}`,
    );
  }
  const production = ctx.assessment.mode === "PRODUCTION";
  const checkpointSpec = ctx.chapter.assessment.checkpoint;
  const validation = validateQuestionBank(activeBank, checkpointSpec, {
    production,
  });
  if (!validation.valid) {
    ctx.archive(
      "CP1 is staged, but approved assessment content has not been installed.",
    );
    yield* requestCheckpoint(
      ctx,
      {
        kind: "CHECKPOINT_DEBRIEF",
        checkpointId: CP1_CHECKPOINT_ID,
        phase: "CONTENT_BLOCKED",
        state: structuredClone(ctx.checkpoint),
        contentIssues: [...validation.errors, ...validation.missingContent],
      },
      "BOS.ACT01.CP1.CONTENT_BLOCKED.v1",
    );
    throw new Error(
      "ASSESSMENT_CONTENT_BLOCKED: production CP1 bank is not approved",
    );
  }

  const allowDraft = ctx.assessment.mode === "QA_DRAFT";
  const proposed = selectDebrief({
    attemptSeed: ctx.attemptSeed,
    bank: activeBank,
    checkpoint: checkpointSpec,
    engagedMicroIds: ctx.field.engagedMicroIds,
    allowDraft,
    maxEnrichment: 2,
  });
  let selectedItems: AssessmentItem[] | null = null;
  while (!selectedItems) {
    const raw = yield* requestCheckpoint(
      ctx,
      {
        kind: "CHECKPOINT_DEBRIEF",
        checkpointId: CP1_CHECKPOINT_ID,
        phase: "FORM_SELECTION",
        state: structuredClone(ctx.checkpoint),
        proposedSelection: proposed.selection,
      },
      "BOS.ACT01.CP1.FORM_SELECTION.v1",
    );
    const event = eventForCheckpoint(raw);
    if (event.type !== "DEBRIEF_FORM_SELECTED") {
      throw new Error("DEBRIEF_EVENT_INVALID: form selection required");
    }
    const selectedBank = ctx.assessment.banks.get(event.selection.bankVersion);
    if (!selectedBank) {
      throw new Error(
        `DEBRIEF_EVENT_INVALID: historical bank ${event.selection.bankVersion} unavailable`,
      );
    }
    const expected = selectDebrief({
      attemptSeed: ctx.attemptSeed,
      bank: selectedBank,
      checkpoint: checkpointSpec,
      engagedMicroIds: ctx.field.engagedMicroIds,
      allowDraft,
      maxEnrichment: 2,
    });
    if (!sameSelection(event.selection, expected.selection)) {
      throw new Error(
        "DEBRIEF_EVENT_INVALID: selected form is not the deterministic authored form",
      );
    }
    selectedItems = resolveSelectedItems(
      selectedBank,
      checkpointSpec,
      event.selection,
      allowDraft,
    );
    ctx.checkpoint.selection = structuredClone(event.selection);
    ctx.checkpoint.bankVersion = event.selection.bankVersion;
    ctx.checkpoint.status = "FORM_SELECTED";
  }

  for (let index = 0; index < selectedItems.length; index += 1) {
    const item = selectedItems[index]!;
    ctx.checkpoint.status = "IN_PROGRESS";
    ctx.checkpoint.currentItemIndex = index;

    // The mastery gate (R6/R7): re-present the item after each wrong answer
    // with an escalating hint ladder. The student is never hard-failed; every
    // wrong attempt adds friction and eventually eliminates distractors, so
    // the item always resolves. `hintsUsed` = wrong attempts consumed.
    const wrongOptionIds: string[] = [];
    let gate: CheckpointGateState | undefined;
    let finalOptionId: string | null = null;
    while (finalOptionId === null) {
      const raw = yield* requestCheckpoint(
        ctx,
        {
          kind: "CHECKPOINT_DEBRIEF",
          checkpointId: CP1_CHECKPOINT_ID,
          phase: "QUESTION",
          state: structuredClone(ctx.checkpoint),
          item,
          gate,
        },
        gate
          ? `BOS.ACT01.CP1.ITEM.${item.itemId}.GATE${gate.attempt}.v1`
          : `BOS.ACT01.CP1.ITEM.${item.itemId}.v1`,
      );
      const event = eventForCheckpoint(raw);
      if (
        event.type !== "DEBRIEF_ANSWERED" ||
        event.formId !== ctx.checkpoint.selection?.formId ||
        event.itemId !== item.itemId ||
        !item.options.some((option) => option.optionId === event.optionId)
      ) {
        throw new Error("DEBRIEF_EVENT_INVALID: malformed or out-of-order answer");
      }
      if (gate?.disabledOptionIds.includes(event.optionId)) {
        throw new Error("DEBRIEF_EVENT_INVALID: eliminated option selected");
      }
      if (event.optionId === item.correctOptionId) {
        finalOptionId = event.optionId;
        break;
      }
      // Wrong answer: extend the ladder. Every wrong pick counts as an
      // attempt (friction repeats); the option set shrinks from attempt 3 on.
      wrongOptionIds.push(event.optionId);
      gate = computeGateState(
        ctx.learner,
        item,
        wrongOptionIds,
        ctx.chapter.assessment.gateMaps,
        ctx.field,
      );
    }

    const hintsUsed = wrongOptionIds.length;
    const response = {
      itemId: item.itemId,
      optionId: finalOptionId,
      tier: item.tier,
      conceptId: item.conceptId,
      hintsUsed,
    } as const;
    ctx.checkpoint.responses.push(response);
    // Penalty curve (locked): clean = correct; 1 hint = correct, no bonus;
    // >= 2 hints = passes but recorded as REVISIT (spaced re-test next CP).
    const correct = hintsUsed === 0;
    if (item.tier === "MACRO") {
      ctx.checkpoint.macroOutcomes.push({
        itemId: item.itemId,
        conceptId: item.conceptId as typeof ctx.checkpoint.macroOutcomes[number]["conceptId"],
        correct: hintsUsed <= 1,
        hintsUsed,
      });
      if (hintsUsed >= 2) {
        const learnerConcept = macroLearnerConcept(ctx, item.conceptId);
        if (learnerConcept) {
          const state = ctx.learner[learnerConcept];
          if (state && !state.pendingReexposure) {
            state.priorDayReassessment = "DUE";
          }
        }
      }
    } else {
      ctx.checkpoint.enrichmentOutcomes.push({
        itemId: item.itemId,
        conceptId: item.conceptId as typeof ctx.checkpoint.enrichmentOutcomes[number]["conceptId"],
        correct,
        hintsUsed,
      });
    }
    ctx.checkpoint.currentItemIndex = index + 1;
  }

  const selection = ctx.checkpoint.selection!;
  let raw = yield* requestCheckpoint(
    ctx,
    {
      kind: "CHECKPOINT_DEBRIEF",
      checkpointId: CP1_CHECKPOINT_ID,
      phase: "REVIEW",
      state: structuredClone(ctx.checkpoint),
      readyToCommit: false,
    },
    "BOS.ACT01.CP1.REVIEW.v1",
  );
  let event = eventForCheckpoint(raw);
  if (
    event.type !== "DEBRIEF_CONTINUED" ||
    event.formId !== selection.formId
  ) {
    throw new Error("DEBRIEF_EVENT_INVALID: review continuation required");
  }

  raw = yield* requestCheckpoint(
    ctx,
    {
      kind: "CHECKPOINT_DEBRIEF",
      checkpointId: CP1_CHECKPOINT_ID,
      phase: "REVIEW",
      state: structuredClone(ctx.checkpoint),
      readyToCommit: true,
    },
    "BOS.ACT01.CP1.COMMIT.v1",
  );
  event = eventForCheckpoint(raw);
  if (
    event.type !== "DEBRIEF_COMMITTED" ||
    !event.eventId.trim() ||
    event.formId !== selection.formId ||
    event.bankVersion !== selection.bankVersion
  ) {
    throw new Error("DEBRIEF_EVENT_INVALID: checkpoint commit mismatch");
  }
  ctx.checkpoint.status = "COMMITTED";
  ctx.checkpoint.committedEventId = event.eventId;
  // Optional player-authored one-liner from the compressed street debrief
  // ("annotate the full record"). Never assessed; trimmed and bounded.
  ctx.checkpoint.annotation =
    event.type === "DEBRIEF_COMMITTED" && event.annotation?.trim()
      ? event.annotation.trim().slice(0, 160)
      : null;
  ctx.checkpoint.carryover = carryover(ctx);
  ctx.checkpoint.nextInsertion = {
    chapterId: NEXT_CHAPTER_ID,
    status: "PENDING_CONTENT",
    label: "Act 1 complete · next insertion pending",
  };

  ctx.world.controlState = "ACT_TRANSITION";
  raw = yield* requestCheckpoint(
    ctx,
    {
      kind: "CHECKPOINT_DEBRIEF",
      checkpointId: CP1_CHECKPOINT_ID,
      phase: "TRANSITION",
      state: structuredClone(ctx.checkpoint),
    },
    "BOS.ACT01.CP1.TRANSITION.v1",
  );
  event = eventForCheckpoint(raw);
  if (
    event.type !== "ACT_TRANSITIONED" ||
    !event.eventId.trim() ||
    event.formId !== selection.formId ||
    event.targetChapterId !== NEXT_CHAPTER_ID
  ) {
    throw new Error("DEBRIEF_EVENT_INVALID: Act transition mismatch");
  }
  ctx.checkpoint.status = "TRANSITIONED";
  ctx.checkpoint.transitionEventId = event.eventId;
  ctx.world.locationId = "ARCHIVE_REINSERTION_PENDING";
}
