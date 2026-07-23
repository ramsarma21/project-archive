import type { InputRequest, PresenterEvent } from "@pa/contracts";
import { createDay1Session, OUTCOME_WEIGHTS } from "../src/index.js";

const seed = "55".repeat(32);

assert(
  !("B8_MAIN_FAST" in OUTCOME_WEIGHTS) &&
    !("B9_SLIP" in OUTCOME_WEIGHTS),
  "legacy B8/B9 weighted authority must not exist",
);

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message = "values differ"): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function choiceFor(request: Extract<InputRequest, { kind: "CHOICE" }>): string {
  const authored: Record<string, string> = {
    "BOS.MD01.ACT.ENTER_MERCER.v1": "WALK_IN",
    "BOS.MD01.ACT.THOMAS_DELIVERY.v1": "HELP",
    "BOS.MD01.ACT.RIDER_ROUTE_SELECT.v1": "MAIN_FAST",
    "BOS.MD01.ACT.CLARKE_CHALLENGE.v1": "CALM_CONCEAL",
    "BOS.MD01.ACT.CUSTOMS_STOP.v1": "TALK",
    "BOS.MD01.ACT.RIDER_HANDOFF.v1": "QUICK",
    "BOS.MD01.ACT.EVENT_ONRAMP.v1": "CLIMB",
    "BOS.MD01.ACT.CUSTOMHOUSE_POLICY_DEMO.v1": "REVENUE",
    "BOS.MD01.ACT.HEADLINE_SELECT.v1": "TAXED_NO_VOICE",
    "BOS.MD01.ACT.HEADLINE_CAUSE_LINE.v1": "CAUSE_PARLIAMENT",
    "BOS.MD01.ACT.HEADLINE_EVIDENCE_PIN.v1": "EV_DEED",
  };
  return authored[request.promptId] ??
    request.options.find((option) =>
      option.choiceId === "STAMP_SYNC.CROWN_TAX" ||
      option.choiceId === "REP_SYNC.NO_ELECTED_VOICE" ||
      option.choiceId === "POLICY_SYNC.WAR_DEBT"
    )?.choiceId ??
    request.options.find((option) => !option.disabled)!.choiceId;
}

function mechanicEvent(
  request: Extract<InputRequest, { kind: "MECHANIC" }>,
): PresenterEvent {
  const { kind } = request.params;
  if (kind === "PRESS") {
    return {
      type: "MECHANIC_RESULT",
      promptId: request.promptId,
      result: { kind, stopOffset: 0.5 },
    };
  }
  if (kind === "EFFORT") {
    return {
      type: "MECHANIC_RESULT",
      promptId: request.promptId,
      result: { kind, holdMs: 1200 },
    };
  }
  if (kind === "PLACE") {
    return {
      type: "MECHANIC_RESULT",
      promptId: request.promptId,
      result: { kind, alignment: 0.5 },
    };
  }
  if (kind === "PRINT_JOB") {
    return {
      type: "MECHANIC_RESULT",
      promptId: request.promptId,
      result: {
        kind,
        phases: { catch: 0.95, ink: 0.95, register: 0.95, pull: 0.95, peel: 0.95 },
        quality: "CRISP",
        accessible: false,
      },
    };
  }
  if (kind === "HAUL_JOB") {
    return { type: "MECHANIC_RESULT", promptId: request.promptId, result: { kind, phases: { load: 0.9, balance: 0.9, thread: 0.9 }, accessible: false } };
  }
  if (kind === "POST_JOB") {
    return { type: "MECHANIC_RESULT", promptId: request.promptId, result: { kind, phases: { lineUp: 0.9, tackLeft: 0.9, tackRight: 0.9 }, accessible: false } };
  }
  return {
    type: "MECHANIC_RESULT",
    promptId: request.promptId,
    result: {
      kind,
      assignments: (request.params.sortItems ?? []).map((item) => ({
        itemId: item.itemId,
        bucketId: ["deed", "writ", "newspaper"].includes(item.itemId)
          ? "NEEDS_STAMP"
          : "DOES_NOT",
      })),
    },
  };
}

{
  const session = createDay1Session({
    variationRootSeedHex: seed,
    assessmentMode: "QA_DRAFT",
  });
  const preferredStops = [
    "THOMAS_CIRCULAR",
    "PIKE_PROOF",
    "CUSTOMHOUSE_NOTICE",
    "RIDER_HANDBILLS",
  ];
  let sawCollapsedSelection = false;
  let sawMainStreetLeg = false;
  // Street-level ending order (design1 feature 3): final pull -> town-board
  // beat -> CP1 debrief -> Day Record card LAST.
  const endingOrder: string[] = [];
  const markEnding = (label: string) => {
    if (endingOrder.at(-1) !== label) endingOrder.push(label);
  };

  for (let step = 0; !session.isDone && step < 500; step += 1) {
    const plan = session.plan;
    assert(plan, "active run must have a plan");
    const request = plan.request;
    let event: PresenterEvent;

    switch (request.kind) {
      case "CONTINUE":
        event = { type: "CONTINUE" };
        break;
      case "DAY_END":
        markEnding("DAY_END");
        event = { type: "CONTINUE" };
        break;
      case "ACK":
        event = { type: "ACK" };
        break;
      case "BREATHER":
        event = { type: "BREATHER_COMPLETE" };
        break;
      case "FOCUS_READ":
        event = { type: "FOCUS_READ_OPENED", objectId: request.objectId };
        break;
      case "CHOICE":
        event = {
          type: "CHOICE_SELECTED",
          promptId: request.promptId,
          choiceId: choiceFor(request),
        };
        break;
      case "MECHANIC":
        if (request.promptId.includes("FINAL_PRESS_PULL")) {
          markEnding("FINAL_PULL");
        }
        if (request.promptId.includes("POST_HEADLINE_BOARD")) {
          markEnding("BOARD_BEAT");
        }
        event = mechanicEvent(request);
        break;
      case "FREE_ROAM": {
        if (request.targets.some((target) => target.targetId === "CLARKE_ROUTE")) {
          sawMainStreetLeg = true;
        }
        if (!request.selectedTargetId) {
          const targetId =
            preferredStops.find((id) =>
              request.targets.some((target) => target.targetId === id)
            ) ?? request.targets[0]?.targetId;
          assert(targetId, "free roam must expose a target");
          event = { type: "FREE_ROAM_SELECT", targetId };
          session.advance(event);
          const selectedPlan = session.plan;
          assert(selectedPlan?.request.kind === "FREE_ROAM");
          equal(selectedPlan.request.selectedTargetId, targetId);
          sawCollapsedSelection ||= request.targets.length > 1;
          continue;
        }
        event = {
          type: "FREE_ROAM_GOTO",
          targetId: request.selectedTargetId,
        };
        break;
      }
      case "CHECKPOINT_DEBRIEF": {
        markEnding("CP1");
        const formId =
          request.state.selection?.formId ??
          request.proposedSelection?.formId ??
          "";
        if (request.phase === "FORM_SELECTION" && request.proposedSelection) {
          event = { type: "DEBRIEF_FORM_SELECTED", checkpointId: request.checkpointId, selection: request.proposedSelection };
        } else if (request.phase === "QUESTION" && request.item) {
          event = { type: "DEBRIEF_ANSWERED", checkpointId: request.checkpointId, formId, itemId: request.item.itemId, optionId: request.item.correctOptionId };
        } else if (request.phase === "REVIEW" && !request.readyToCommit) {
          event = { type: "DEBRIEF_CONTINUED", checkpointId: request.checkpointId, formId };
        } else if (request.phase === "REVIEW") {
          event = { type: "DEBRIEF_COMMITTED", eventId: `${formId}.COMMIT.TEST`, checkpointId: request.checkpointId, formId, bankVersion: request.state.bankVersion ?? "" };
        } else if (request.phase === "TRANSITION") {
          event = { type: "ACT_TRANSITIONED", eventId: `${formId}.TRANSITION.TEST`, checkpointId: request.checkpointId, formId, targetChapterId: request.state.nextInsertion!.chapterId };
        } else {
          throw new Error("CP1 content bank unavailable");
        }
        break;
      }
    }
    session.advance(event);
  }

  equal(session.isDone, true, "Day 1 must reach its authored close");
  equal(sawCollapsedSelection, true, "multi-stop routing must select before arrival");
  equal(sawMainStreetLeg, true, "route choice must create a playable street leg");
  for (const objective of [
    "THOMAS_CIRCULAR",
    "PIKE_PROOF",
    "CUSTOMHOUSE_NOTICE",
    "RIDER_HANDBILLS",
    "RETURN_TO_PRESS",
    "SET_HEADLINE",
    "POST_THE_PAGE",
  ]) {
    equal(session.ctx.world.objectives[objective], "COMPLETED");
  }
  // The verdict ordering: the ending is street-first, forms-last.
  equal(
    endingOrder.join(" -> "),
    "FINAL_PULL -> BOARD_BEAT -> CP1 -> DAY_END",
    "street-level ending order",
  );
}
