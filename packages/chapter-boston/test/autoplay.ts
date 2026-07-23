import { createDay1Session } from "../src/index.js";
import { CONCEPTS } from "../src/ids.js";
import type { PresenterEvent, InputRequest, MechanicRawResult } from "@pa/contracts";

declare const process: { argv: string[] };

// A scripted responder that drives the runtime headlessly (no React/DOM).
// `mode` controls whether Sync answers are correct (happy) or wrong (miss path).
type Mode = "happy" | "missSyncs";

const CORRECT_CHOICE_IDS = new Set([
  "CROWN_TAX", "STAMP_SYNC.CROWN_TAX",
  "NO_ELECTED_VOICE", "REP_SYNC.NO_ELECTED_VOICE",
  "WAR_DEBT", "POLICY_SYNC.WAR_DEBT",
  "TAXED_NO_VOICE", "CAUSE_PARLIAMENT", "EV_DEED", "REVENUE",
]);
const WRONG_SYNC_IDS = new Set(["STAMP_SYNC.SHOP_CHARGE", "REP_SYNC.ALL_TAXES", "POLICY_SYNC.PUNISH_MOB"]);

function respond(req: InputRequest, mode: Mode, missedFirst: Set<string>): PresenterEvent {
  switch (req.kind) {
    case "CONTINUE":
      return { type: "CONTINUE" };
    case "ACK":
      return { type: "ACK" };
    case "FOCUS_READ":
      return { type: "FOCUS_READ_OPENED", objectId: req.objectId };
    case "BREATHER":
      return { type: "BREATHER_COMPLETE" };
    case "FREE_ROAM": {
      const gold = req.targets.find((t) => t.marker === "GOLD") ?? req.targets[0];
      return { type: "FREE_ROAM_GOTO", targetId: gold!.targetId };
    }
    case "DAY_END":
      return { type: "CONTINUE" };
    case "CHECKPOINT_DEBRIEF": {
      const formId =
        req.state.selection?.formId ?? req.proposedSelection?.formId ?? "";
      if (req.phase === "FORM_SELECTION" && req.proposedSelection) {
        return {
          type: "DEBRIEF_FORM_SELECTED",
          checkpointId: req.checkpointId,
          selection: req.proposedSelection,
        };
      }
      if (req.phase === "QUESTION" && req.item) {
        return {
          type: "DEBRIEF_ANSWERED",
          checkpointId: req.checkpointId,
          formId,
          itemId: req.item.itemId,
          optionId: req.item.correctOptionId,
        };
      }
      if (req.phase === "REVIEW" && !req.readyToCommit) {
        return { type: "DEBRIEF_CONTINUED", checkpointId: req.checkpointId, formId };
      }
      if (req.phase === "REVIEW") {
        return {
          type: "DEBRIEF_COMMITTED",
          eventId: `${formId}.COMMIT.TEST`,
          checkpointId: req.checkpointId,
          formId,
          bankVersion: req.state.bankVersion ?? "",
          // Exercises the optional never-scored annotation line end to end.
          annotation: "Set it in type and let the street read it.",
        };
      }
      if (req.phase === "TRANSITION") {
        return {
          type: "ACT_TRANSITIONED",
          eventId: `${formId}.TRANSITION.TEST`,
          checkpointId: req.checkpointId,
          formId,
          targetChapterId: req.state.nextInsertion!.chapterId,
        };
      }
      throw new Error("CP1 content bank unavailable");
    }
    case "MECHANIC":
      return { type: "MECHANIC_RESULT", promptId: req.promptId, result: mechanicResult(req) };
    case "CHOICE": {
      const isSync = req.promptId.includes("SYNC") && !req.promptId.includes("RETRY");
      if (isSync && mode === "missSyncs" && !missedFirst.has(req.promptId.split(":")[0]!)) {
        const wrong = req.options.find((o) => WRONG_SYNC_IDS.has(o.choiceId) && !o.disabled);
        if (wrong) {
          missedFirst.add(req.promptId.split(":")[0]!);
          return { type: "CHOICE_SELECTED", promptId: req.promptId, choiceId: wrong.choiceId };
        }
      }
      const correct = req.options.find((o) => CORRECT_CHOICE_IDS.has(o.choiceId) && !o.disabled);
      const pick = correct ?? req.options.find((o) => !o.disabled) ?? req.options[0]!;
      return { type: "CHOICE_SELECTED", promptId: req.promptId, choiceId: pick.choiceId };
    }
  }
}

function mechanicResult(req: Extract<InputRequest, { kind: "MECHANIC" }>): MechanicRawResult {
  const p = req.params;
  if (p.kind === "PRESS") return { kind: "PRESS", stopOffset: 0.5 };
  if (p.kind === "EFFORT") return { kind: "EFFORT", holdMs: 1500 };
  if (p.kind === "PLACE") return { kind: "PLACE", alignment: 0.5 };
  if (p.kind === "PRINT_JOB") {
    return {
      kind: "PRINT_JOB",
      phases: { catch: 0.95, ink: 0.95, register: 0.95, pull: 0.95, peel: 0.95 },
      quality: "CRISP",
      accessible: false,
    };
  }
  if (p.kind === "HAUL_JOB") {
    return {
      kind: "HAUL_JOB",
      phases: { load: 0.9, balance: 0.9, thread: 0.9 },
      accessible: false,
    };
  }
  if (p.kind === "POST_JOB") {
    return {
      kind: "POST_JOB",
      phases: { lineUp: 0.9, tackLeft: 0.9, tackRight: 0.9 },
      accessible: false,
    };
  }
  // SORT: correct assignment
  const needs = ["deed", "writ", "newspaper"];
  return {
    kind: "SORT",
    assignments: (p.sortItems ?? []).map((i) => ({
      itemId: i.itemId,
      bucketId: needs.includes(i.itemId) ? "NEEDS_STAMP" : "DOES_NOT",
    })),
  };
}

export function autoplay(seedHex: string, mode: Mode): {
  events: PresenterEvent[];
  steps: number;
  done: boolean;
  learner: ReturnType<typeof summarizeLearner>;
} {
  const session = createDay1Session({
    variationRootSeedHex: seedHex,
    assessmentMode: "QA_DRAFT",
  });
  const missedFirst = new Set<string>();
  let steps = 0;
  while (!session.isDone && session.plan) {
    const ev = respond(session.plan.request, mode, missedFirst);
    session.advance(ev);
    steps += 1;
    if (steps > 5000) throw new Error("exceeded step cap (possible deadlock)");
  }
  return {
    events: session.committedEvents,
    steps,
    done: session.isDone,
    learner: summarizeLearner(session),
  };
}

function summarizeLearner(session: ReturnType<typeof createDay1Session>) {
  const l = session.ctx.learner;
  const out: Record<string, { understanding: string; demonstration: string; occ: number; types: number }> = {};
  for (const [k, v] of Object.entries(l)) {
    const name = k.includes("STAMP") ? "STAMP" : k.includes("REPRESENTATION") ? "REP" : "POLICY";
    out[name] = {
      understanding: v.understanding,
      demonstration: v.demonstration,
      occ: v.distinctOccasionCount,
      types: v.exposureTypes.length,
    };
  }
  return out;
}

// Run directly: `node --import tsx test/autoplay.ts`
if (process.argv[1]?.endsWith("/autoplay.ts")) {
  const seedA = "11".repeat(32);
  const seedB = "22".repeat(32);
  for (const [label, seed, mode] of [
    ["A/happy", seedA, "happy"],
    ["B/happy", seedB, "happy"],
    ["A/missSyncs", seedA, "missSyncs"],
  ] as const) {
    const r = autoplay(seed, mode);
    const gate = Object.values(r.learner).every((c) => c.understanding === "UNDERSTOOD" && c.demonstration === "DEMONSTRATED");
    console.log(`\n[${label}] steps=${r.steps} done=${r.done} events=${r.events.length} gateSatisfied=${gate}`);
    console.log("  learner:", JSON.stringify(r.learner));
  }
  console.log("\nCONCEPTS:", Object.values(CONCEPTS).join(", "));
}
