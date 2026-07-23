import type { InputRequest, PresenterEvent } from "@pa/contracts";
import { createDay1Session } from "../src/index.js";

// A deliberately slow day: every read opened, Thomas helped, the proof pulled
// badly and fully reprinted. The rider is saved for last so the activity clock
// exhausts before he is ever attempted. This exercises the dusk contract:
// closure interrupt, missed-errand consequences, and no optional work after
// the boundary.

const seed = "77".repeat(32);

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message = "values differ"): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

const CHOICES: Record<string, string> = {
  "BOS.MD01.ACT.ENTER_MERCER.v1": "WALK_IN",
  "BOS.MD01.ACT.THOMAS_DELIVERY.v1": "HELP",
  "BOS.MD01.ACT.PIKE_SMUDGE.v1": "REPRINT",
  "BOS.MD01.ACT.CUSTOMHOUSE_POLICY_DEMO.v1": "REVENUE",
  "BOS.MD01.ACT.EVENT_ONRAMP.v1": "CLIMB",
  "BOS.MD01.ACT.HEADLINE_SELECT.v1": "TAXED_NO_VOICE",
  "BOS.MD01.ACT.HEADLINE_CAUSE_LINE.v1": "CAUSE_PARLIAMENT",
  "BOS.MD01.ACT.HEADLINE_EVIDENCE_PIN.v1": "EV_DEED",
};

function respond(request: InputRequest): PresenterEvent {
  switch (request.kind) {
    case "CONTINUE":
    case "DAY_END":
      return { type: "CONTINUE" };
    case "CHECKPOINT_DEBRIEF": {
      const formId =
        request.state.selection?.formId ??
        request.proposedSelection?.formId ??
        "";
      if (request.phase === "FORM_SELECTION" && request.proposedSelection) {
        return { type: "DEBRIEF_FORM_SELECTED", checkpointId: request.checkpointId, selection: request.proposedSelection };
      }
      if (request.phase === "QUESTION" && request.item) {
        return { type: "DEBRIEF_ANSWERED", checkpointId: request.checkpointId, formId, itemId: request.item.itemId, optionId: request.item.correctOptionId };
      }
      if (request.phase === "REVIEW" && !request.readyToCommit) {
        return { type: "DEBRIEF_CONTINUED", checkpointId: request.checkpointId, formId };
      }
      if (request.phase === "REVIEW") {
        return { type: "DEBRIEF_COMMITTED", eventId: `${formId}.COMMIT.TEST`, checkpointId: request.checkpointId, formId, bankVersion: request.state.bankVersion ?? "" };
      }
      if (request.phase === "TRANSITION") {
        return { type: "ACT_TRANSITIONED", eventId: `${formId}.TRANSITION.TEST`, checkpointId: request.checkpointId, formId, targetChapterId: request.state.nextInsertion!.chapterId };
      }
      throw new Error("CP1 content bank unavailable");
    }
    case "ACK":
      return { type: "ACK" };
    case "BREATHER":
      return { type: "BREATHER_COMPLETE" };
    case "FOCUS_READ":
      return { type: "FOCUS_READ_OPENED", objectId: request.objectId };
    case "FREE_ROAM": {
      if (!request.selectedTargetId) {
        const preferred = ["THOMAS_CIRCULAR", "PIKE_PROOF", "CUSTOMHOUSE_NOTICE", "RIDER_HANDBILLS"]
          .find((id) => request.targets.some((target) => target.targetId === id));
        const targetId = preferred ?? request.targets[0]!.targetId;
        return { type: "FREE_ROAM_SELECT", targetId };
      }
      return { type: "FREE_ROAM_GOTO", targetId: request.selectedTargetId };
    }
    case "CHOICE": {
      const authored = CHOICES[request.promptId];
      const fallback = request.options.find((option) =>
        option.choiceId === "STAMP_SYNC.CROWN_TAX" ||
        option.choiceId === "REP_SYNC.NO_ELECTED_VOICE" ||
        option.choiceId === "POLICY_SYNC.WAR_DEBT"
      )?.choiceId ?? request.options.find((option) => !option.disabled)!.choiceId;
      return { type: "CHOICE_SELECTED", promptId: request.promptId, choiceId: authored ?? fallback };
    }
    case "MECHANIC": {
      const { kind } = request.params;
      if (kind === "PRESS") {
        // First pull is deliberately spoiled to force the physical reprint
        // loop; the reprint itself is pulled clean.
        const spoiled = request.promptId === "BOS.MD01.ACT.PRESS_PIKE_PROOF.v1";
        return {
          type: "MECHANIC_RESULT",
          promptId: request.promptId,
          result: { kind, stopOffset: spoiled ? 0.96 : 0.5 },
        };
      }
      if (kind === "EFFORT") {
        return { type: "MECHANIC_RESULT", promptId: request.promptId, result: { kind, holdMs: 1400 } };
      }
      if (kind === "PLACE") {
        return { type: "MECHANIC_RESULT", promptId: request.promptId, result: { kind, alignment: 0.5 } };
      }
      if (kind === "PRINT_JOB") {
        const spoiled = request.promptId === "BOS.MD01.ACT.PRESS_PIKE_PROOF.v1";
        const pull = spoiled ? 0.08 : 0.95;
        return {
          type: "MECHANIC_RESULT",
          promptId: request.promptId,
          result: {
            kind,
            phases: { catch: 0.95, ink: 0.95, register: 0.95, pull, peel: 0.95 },
            quality: spoiled ? "SMUDGED" : "CRISP",
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
            bucketId: ["deed", "writ", "newspaper"].includes(item.itemId) ? "NEEDS_STAMP" : "DOES_NOT",
          })),
        },
      };
    }
  }
}

{
  const session = createDay1Session({
    variationRootSeedHex: seed,
    assessmentMode: "QA_DRAFT",
  });
  let sawClosureAck = false;
  let fixedEventSeen = false;
  let boundaryUnitsAtClosure = -1;

  for (let step = 0; !session.isDone && step < 600; step += 1) {
    const plan = session.plan;
    assert(plan, "active run must always expose a plan");
    const request = plan.request;
    const boundaryReached =
      session.ctx.world.clock.spentUnits >= session.ctx.world.clock.fixedEventBoundary;
    const eventDone = session.ctx.world.fixedEvent === "COMPLETE";

    if (request.kind === "ACK") {
      sawClosureAck = true;
      boundaryUnitsAtClosure = session.ctx.world.clock.spentUnits;
    }
    if (session.ctx.world.fixedEvent === "ACTIVE") fixedEventSeen = true;

    // Dusk contract: after the boundary and before the fixed event completes,
    // the runtime may not offer optional reads or ambient breathers.
    if (boundaryReached && !eventDone) {
      assert(request.kind !== "BREATHER", "no breather may be offered after the boundary");
      if (request.kind === "FOCUS_READ") {
        throw new Error(`optional read ${request.objectId} offered after the boundary`);
      }
    }

    session.advance(respond(request));
  }

  equal(session.isDone, true, "slow day must still reach the authored close");
  equal(sawClosureAck, true, "dusk with pending errands must require the closure acknowledgment");
  equal(fixedEventSeen, true, "the August 14 event must fire");
  assert(boundaryUnitsAtClosure >= 24, "closure must occur at or after the fixed boundary");
  equal(session.ctx.world.objectives.RIDER_HANDBILLS, "MISSED", "unattempted rider must resolve missed");
  equal(session.ctx.world.relationships.RIDER_TRUST, 20, "missed rider must cost trust");
  equal(
    session.ctx.world.pendingContingentEffects.length,
    0,
    "dusk closure must expire unrealized contingent effects",
  );
  equal(session.ctx.world.objectives.SET_HEADLINE, "COMPLETED");
}
