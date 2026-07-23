// Dev harness: drive a Day 1 session to the first errand-select FREE_ROAM
// (right after leaving Mercer's) and print committedEvents JSON for seeding
// the web app's IndexedDB save. Companion to drive_to_beat.ts.
// Usage: node --import tsx test/gen_roam_events.ts [seedHex]
import { createDay1Session } from "../src/index.js";
import type { InputRequest, MechanicRawResult, PresenterEvent } from "@pa/contracts";

declare const process: { argv: string[]; exit(code?: number): never };

function mech(req: Extract<InputRequest, { kind: "MECHANIC" }>): MechanicRawResult {
  const p = req.params;
  if (p.kind === "PRESS") return { kind: "PRESS", stopOffset: 0.5 };
  if (p.kind === "EFFORT") return { kind: "EFFORT", holdMs: 1200 };
  if (p.kind === "PLACE") return { kind: "PLACE", alignment: 0.5 };
  if (p.kind === "PRINT_JOB") return { kind: "PRINT_JOB", phases: { catch: 0.95, ink: 0.95, register: 0.95, pull: 0.95, peel: 0.95 }, quality: "CRISP", accessible: false };
  if (p.kind === "HAUL_JOB") return { kind: "HAUL_JOB", phases: { load: 0.9, balance: 0.9, thread: 0.9 }, accessible: false };
  if (p.kind === "POST_JOB") return { kind: "POST_JOB", phases: { lineUp: 0.9, tackLeft: 0.9, tackRight: 0.9 }, accessible: false };
  const needs = new Set(["deed", "writ", "newspaper"]);
  return {
    kind: "SORT",
    assignments: (p.sortItems ?? []).map((i) => ({
      itemId: i.itemId,
      bucketId: needs.has(i.itemId) ? "NEEDS_STAMP" : "DOES_NOT",
    })),
  };
}

const seedHex = process.argv[2] ?? "71".repeat(32);
const session = createDay1Session({ variationRootSeedHex: seedHex });
let steps = 0;
while (!session.isDone && session.plan) {
  const req = session.plan.request;
  if (
    req.kind === "FREE_ROAM" &&
    !req.selectedTargetId &&
    req.targets.some((t) => t.targetId === "THOMAS_CIRCULAR")
  ) break;
  let ev: PresenterEvent;
  switch (req.kind) {
    case "CONTINUE":
    case "DAY_END":
      ev = { type: "CONTINUE" };
      break;
    case "ACK":
      ev = { type: "ACK" };
      break;
    case "BREATHER":
      ev = { type: "BREATHER_COMPLETE" };
      break;
    case "FOCUS_READ":
      ev = { type: "FOCUS_READ_OPENED", objectId: req.objectId };
      break;
    case "FREE_ROAM":
      ev = { type: "FREE_ROAM_GOTO", targetId: req.selectedTargetId ?? req.targets[0]!.targetId };
      break;
    case "MECHANIC":
      ev = { type: "MECHANIC_RESULT", promptId: req.promptId, result: mech(req) };
      break;
    case "CHOICE": {
      const pick =
        req.options.find((o) => o.choiceId === "WALK_IN" && !o.disabled) ??
        req.options.find((o) => !o.disabled) ??
        req.options[0]!;
      ev = { type: "CHOICE_SELECTED", promptId: req.promptId, choiceId: pick.choiceId };
      break;
    }
    case "CHECKPOINT_DEBRIEF":
      throw new Error("errand roam was not reached before CP1");
  }
  session.advance(ev);
  steps += 1;
  if (steps > 500) {
    console.error("step cap exceeded before reaching the errand roam");
    process.exit(1);
  }
}
console.log(JSON.stringify({ steps, kind: session.plan?.request.kind, events: session.committedEvents }));
