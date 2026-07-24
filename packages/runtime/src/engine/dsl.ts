import {
  type PresenterEvent,
  type InputRequest,
  type ChoiceOption,
  type MechanicParams,
  type MechanicRawResult,
  type FreeRoamTarget,
} from "@pa/contracts";
import type { Ctx, Sub } from "./ctx.js";

// Emit whatever is buffered and wait for a presenter event.
function* request(ctx: Ctx, req: InputRequest, cueId: string): Sub<PresenterEvent> {
  const present = ctx.buffer.map((directive) => (
    directive.cueId ? directive : { ...directive, cueId }
  ));
  ctx.buffer = [];
  const ev = yield { present, request: req, cueId };
  return ev;
}

export function* waitContinue(ctx: Ctx, label?: string, cueId?: string): Sub<void> {
  const req: InputRequest = label ? { kind: "CONTINUE", label } : { kind: "CONTINUE" };
  yield* request(ctx, req, cueId ?? ctx.chapter.content.cues.continueCue(label));
}

export function* waitAck(ctx: Ctx, text: string, cueId?: string): Sub<void> {
  yield* request(ctx, { kind: "ACK", text }, cueId ?? ctx.chapter.content.cues.ackCue());
}

// Final Day Record confirmation. The card renders while this request is
// active; CONTINUE commits mission completion.
export function* waitDayEnd(ctx: Ctx, cueId?: string): Sub<void> {
  const cue = cueId ?? ctx.chapter.content.cues.dayEndCue();
  while (true) {
    const ev = yield* request(ctx, { kind: "DAY_END" }, cue);
    if (ev.type === "CONTINUE") return;
  }
}

export function* choose(
  ctx: Ctx,
  promptId: string,
  frame: string,
  options: ChoiceOption[],
): Sub<string> {
  // Enforce the hard 2..3 choice cap (acknowledgment uses waitAck instead).
  if (options.length < 2 || options.length > 3) {
    throw new Error(`PRESENTER_PROTOCOL_ERROR: choice ${promptId} has ${options.length} options`);
  }
  while (true) {
    const ev = yield* request(ctx, { kind: "CHOICE", promptId, frame, options }, promptId);
    if (ev.type === "CHOICE_SELECTED" && ev.promptId === promptId) {
      const chosen = options.find((o) => o.choiceId === ev.choiceId && !o.disabled);
      if (chosen) return chosen.choiceId;
    }
    // ignore malformed / disabled selections and re-present
  }
}

export function* mechanic(
  ctx: Ctx,
  promptId: string,
  params: MechanicParams,
): Sub<MechanicRawResult> {
  while (true) {
    const ev = yield* request(ctx, { kind: "MECHANIC", promptId, params }, promptId);
    if (ev.type === "MECHANIC_RESULT" && ev.promptId === promptId) {
      return ev.result;
    }
  }
}

// Focus-read: commits only when the panel is actually opened (spec §23).
export function* focusRead(
  ctx: Ctx,
  objectId: string,
  title: string,
  teaser: string,
  cueId?: string,
): Sub<boolean> {
  const ev = yield* request(
    ctx,
    { kind: "FOCUS_READ", objectId, title, teaser },
    cueId ?? ctx.chapter.content.cues.readCue(objectId),
  );
  return ev.type === "FOCUS_READ_OPENED";
}

export function* breathe(
  ctx: Ctx,
  cueId: string,
  durationMs = 7000,
): Sub<void> {
  while (true) {
    const ev = yield* request(
      ctx,
      { kind: "BREATHER", durationMs, requestId: cueId },
      cueId,
    );
    if (ev.type === "BREATHER_COMPLETE") return;
  }
}

export function* freeRoam(
  ctx: Ctx,
  targets: FreeRoamTarget[],
  canProceed: boolean,
  cueId?: string,
): Sub<PresenterEvent> {
  cueId ??= ctx.chapter.content.cues.roamCue(targets.map((target) => target.targetId));
  let selectedTargetId = targets.length === 1 ? targets[0]?.targetId : undefined;
  // Keep the Today strip and the world markers describing the same state:
  // the one live selection is gold/SELECTED, the rest of the set stays ACTIVE.
  const syncObjectiveSelection = () => {
    for (const target of targets) {
      const status = ctx.world.objectives[target.targetId];
      if (status && status !== "COMPLETED" && status !== "MISSED" && status !== "FAILED") {
        ctx.world.objectives[target.targetId] =
          target.targetId === selectedTargetId ? "SELECTED" : "ACTIVE";
      }
    }
  };
  if (selectedTargetId) syncObjectiveSelection();
  while (true) {
    const ev = yield* request(
      ctx,
      { kind: "FREE_ROAM", targets, canProceed, selectedTargetId },
      cueId,
    );
    if (
      ev.type === "FREE_ROAM_SELECT" &&
      targets.some((target) => target.targetId === ev.targetId)
    ) {
      selectedTargetId = ev.targetId;
      syncObjectiveSelection();
      continue;
    }
    if (ev.type === "FREE_ROAM_GOTO") {
      const validTarget = targets.some((target) => target.targetId === ev.targetId);
      // Accept direct GOTO from legacy saves/text presenters. The 3D presenter
      // uses SELECT first whenever several destinations are available.
      if (validTarget && (!selectedTargetId || selectedTargetId === ev.targetId)) {
        return ev;
      }
      continue;
    }
    if (ev.type === "FREE_ROAM_IDLE") {
      if (canProceed) return ev;
      if (selectedTargetId) {
        const target = targets.find((candidate) => candidate.targetId === selectedTargetId);
        if (target) ctx.archive(`${target.label} is still marked in gold. Keep moving toward it.`);
      }
    }
  }
}
