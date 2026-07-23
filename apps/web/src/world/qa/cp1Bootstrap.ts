import type {
  InputRequest,
  MechanicRawResult,
  PresenterEvent,
} from "@pa/contracts";

// ---------------------------------------------------------------------------
// QA-ONLY CP1 fast-forward (Day-1 CONTENT).
//
// Drives the runtime from a fresh boot to a requested CHECKPOINT_DEBRIEF
// phase by synthesizing "good" presenter events for every request kind,
// including a hardcoded Day-1 answer table (correct choice/sort ids). This is
// QA tooling content — it must track the authored Day-1 chapter and is never
// imported by production flow (Play only consults it behind
// QA_RUNTIME_ENABLED + VITE_CP1_ALLOW_DRAFT_BANK).
// ---------------------------------------------------------------------------

export function qaCheckpointTargetReached(
  request: Extract<InputRequest, { kind: "CHECKPOINT_DEBRIEF" }>,
  target: string,
): boolean {
  if (target === "question") return request.phase === "QUESTION";
  if (target === "review") {
    return request.phase === "REVIEW" && !request.readyToCommit;
  }
  if (target === "commit") {
    return request.phase === "REVIEW" && Boolean(request.readyToCommit);
  }
  if (target === "transition") return request.phase === "TRANSITION";
  return request.phase === "FORM_SELECTION";
}

export function qaCheckpointBootstrapEvent(request: InputRequest): PresenterEvent {
  switch (request.kind) {
    case "CONTINUE":
    case "DAY_END":
      return { type: "CONTINUE" };
    case "ACK":
      return { type: "ACK" };
    case "BREATHER":
      return { type: "BREATHER_COMPLETE" };
    case "FOCUS_READ":
      return { type: "FOCUS_READ_OPENED", objectId: request.objectId };
    case "FREE_ROAM":
      return {
        type: "FREE_ROAM_GOTO",
        targetId: request.selectedTargetId ?? request.targets[0]!.targetId,
      };
    case "CHOICE": {
      // Hardcoded Day-1 answer table: the "correct" choice ids for every
      // authored prompt the fast-forward can encounter. QA-only content.
      const correctIds = new Set([
        "WALK_IN",
        "HELP",
        "MAIN_FAST",
        "CALM_CONCEAL",
        "QUICK",
        "CLIMB",
        "REVENUE",
        "TAXED_NO_VOICE",
        "CAUSE_PARLIAMENT",
        "EV_DEED",
        "STAMP_SYNC.CROWN_TAX",
        "REP_SYNC.NO_ELECTED_VOICE",
        "POLICY_SYNC.WAR_DEBT",
      ]);
      const option =
        request.options.find(
          (candidate) =>
            correctIds.has(candidate.choiceId) && !candidate.disabled,
        ) ?? request.options.find((candidate) => !candidate.disabled)!;
      return {
        type: "CHOICE_SELECTED",
        promptId: request.promptId,
        choiceId: option.choiceId,
      };
    }
    case "MECHANIC":
      return {
        type: "MECHANIC_RESULT",
        promptId: request.promptId,
        result: qaMechanicResult(request),
      };
    case "CHECKPOINT_DEBRIEF": {
      const formId =
        request.state.selection?.formId ??
        request.proposedSelection?.formId ??
        "";
      if (request.phase === "FORM_SELECTION" && request.proposedSelection) {
        return {
          type: "DEBRIEF_FORM_SELECTED",
          checkpointId: request.checkpointId,
          selection: request.proposedSelection,
        };
      }
      if (request.phase === "QUESTION" && request.item) {
        return {
          type: "DEBRIEF_ANSWERED",
          checkpointId: request.checkpointId,
          formId,
          itemId: request.item.itemId,
          optionId: request.item.correctOptionId,
        };
      }
      if (request.phase === "REVIEW" && !request.readyToCommit) {
        return {
          type: "DEBRIEF_CONTINUED",
          checkpointId: request.checkpointId,
          formId,
        };
      }
      if (request.phase === "REVIEW") {
        return {
          type: "DEBRIEF_COMMITTED",
          eventId: `${formId}.COMMIT.QA`,
          checkpointId: request.checkpointId,
          formId,
          bankVersion: request.state.bankVersion ?? "",
        };
      }
      if (request.phase === "TRANSITION") {
        return {
          type: "ACT_TRANSITIONED",
          eventId: `${formId}.TRANSITION.QA`,
          checkpointId: request.checkpointId,
          formId,
          targetChapterId: request.state.nextInsertion!.chapterId,
        };
      }
      throw new Error("QA CP1 bootstrap reached the production content gate");
    }
  }
}

function qaMechanicResult(
  request: Extract<InputRequest, { kind: "MECHANIC" }>,
): MechanicRawResult {
  const { kind } = request.params;
  if (kind === "PRESS") return { kind, stopOffset: 0.5 };
  if (kind === "EFFORT") return { kind, holdMs: 1500 };
  if (kind === "PLACE") return { kind, alignment: 0.5 };
  if (kind === "PRINT_JOB") {
    return {
      kind,
      phases: {
        catch: 0.95,
        ink: 0.95,
        register: 0.95,
        pull: 0.95,
        peel: 0.95,
      },
      quality: "CRISP",
      accessible: true,
    };
  }
  if (kind === "HAUL_JOB") {
    return {
      kind,
      phases: { load: 0.9, balance: 0.9, thread: 0.9 },
      accessible: true,
    };
  }
  if (kind === "POST_JOB") {
    return {
      kind,
      phases: { lineUp: 0.9, tackLeft: 0.9, tackRight: 0.9 },
      accessible: true,
    };
  }
  return {
    kind,
    assignments: (request.params.sortItems ?? []).map((item) => ({
      itemId: item.itemId,
      bucketId: ["deed", "writ", "newspaper"].includes(item.itemId)
        ? "NEEDS_STAMP"
        : "DOES_NOT",
    })),
  };
}
