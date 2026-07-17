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
function* request(ctx: Ctx, req: InputRequest): Sub<PresenterEvent> {
  const present = ctx.buffer;
  ctx.buffer = [];
  const ev = yield { present, request: req };
  return ev;
}

export function* waitContinue(ctx: Ctx, label?: string): Sub<void> {
  const req: InputRequest = label ? { kind: "CONTINUE", label } : { kind: "CONTINUE" };
  yield* request(ctx, req);
}

export function* waitAck(ctx: Ctx, text: string): Sub<void> {
  yield* request(ctx, { kind: "ACK", text });
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
    const ev = yield* request(ctx, { kind: "CHOICE", promptId, frame, options });
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
    const ev = yield* request(ctx, { kind: "MECHANIC", promptId, params });
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
): Sub<boolean> {
  const ev = yield* request(ctx, { kind: "FOCUS_READ", objectId, title, teaser });
  return ev.type === "FOCUS_READ_OPENED";
}

export function* freeRoam(
  ctx: Ctx,
  targets: FreeRoamTarget[],
  canProceed: boolean,
): Sub<PresenterEvent> {
  const ev = yield* request(ctx, { kind: "FREE_ROAM", targets, canProceed });
  return ev;
}
