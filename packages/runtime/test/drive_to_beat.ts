// Dev harness: drive a Day 1 session to a target mechanic beat and print the
// committedEvents JSON (for seeding the web app's IndexedDB save).
// Usage: node --import tsx test/drive_to_beat.ts <TARGET> [seedHex]
import { createDay1Session } from "../src/index.js";
import type { InputRequest, MechanicRawResult, PresenterEvent } from "@pa/contracts";

// This package compiles without Node type definitions; declare the two Node
// globals this dev-only harness touches.
declare const process: { argv: string[]; exit(code?: number): never };

interface DriveSpec {
  stopAt: string; // stop when a MECHANIC request's promptId includes this
  errandOrder: string[]; // FREE_ROAM select preference
  choiceOverrides: Record<string, string>; // promptId substring -> choiceId
  pressOverrides?: Record<string, number>; // promptId substring -> stopOffset
}

const BASE_CHOICES: Record<string, string> = {
  "ENTER_MERCER": "WALK_IN",
  "THOMAS_DELIVERY": "HELP",
  "RIDER_ROUTE_SELECT": "MAIN_FAST",
  "CLARKE_CHALLENGE": "CALM_CONCEAL",
  "RIDER_HANDOFF.v1": "QUICK",
  "CUSTOMS_STOP": "COMPLY",
  "EVENT_ONRAMP": "CLIMB",
};

const CORRECT_CHOICE_IDS = new Set([
  "CROWN_TAX", "STAMP_SYNC.CROWN_TAX",
  "NO_ELECTED_VOICE", "REP_SYNC.NO_ELECTED_VOICE",
  "WAR_DEBT", "POLICY_SYNC.WAR_DEBT",
  "TAXED_NO_VOICE", "CAUSE_PARLIAMENT", "EV_DEED", "REVENUE",
]);

const ERRANDS_DEFAULT = ["THOMAS_CIRCULAR", "PIKE_PROOF", "CUSTOMHOUSE_NOTICE", "RIDER_HANDBILLS"];

const SPECS: Record<string, DriveSpec> = {
  CATCH: { stopAt: "CATCH_SHEET", errandOrder: ERRANDS_DEFAULT, choiceOverrides: {} },
  PRESS1: { stopAt: "PRESS_PIKE_PROOF", errandOrder: ERRANDS_DEFAULT, choiceOverrides: {} },
  HAUL: { stopAt: "THOMAS_HAUL", errandOrder: ERRANDS_DEFAULT, choiceOverrides: {} },
  SORT: {
    stopAt: "PIKE_SORT",
    errandOrder: ["THOMAS_CIRCULAR", "PIKE_PROOF", "CUSTOMHOUSE_NOTICE", "RIDER_HANDBILLS"],
    choiceOverrides: {},
  },
  REPRINT: {
    stopAt: "PIKE_REPRINT",
    errandOrder: ["PIKE_PROOF", "THOMAS_CIRCULAR", "CUSTOMHOUSE_NOTICE", "RIDER_HANDBILLS"],
    choiceOverrides: { PIKE_SMUDGE: "REPRINT" },
    pressOverrides: { PRESS_PIKE_PROOF: 0.96 },
  },
  NOTICE: {
    stopAt: "POST_NOTICE",
    errandOrder: ["CUSTOMHOUSE_NOTICE", "THOMAS_CIRCULAR", "PIKE_PROOF", "RIDER_HANDBILLS"],
    choiceOverrides: {},
  },
  NOTICE_DONE: {
    // Runs PAST the tack so the world board shows the posted sheet: stop at
    // the next mechanic afterward is unreliable, so stop at a sentinel that
    // never matches and cap steps once the notice objective completes.
    stopAt: "__AFTER_NOTICE__",
    errandOrder: ["CUSTOMHOUSE_NOTICE", "THOMAS_CIRCULAR", "PIKE_PROOF", "RIDER_HANDBILLS"],
    choiceOverrides: {},
  },
  RIDER: {
    stopAt: "RIDER_QUICK_HANDOFF",
    errandOrder: ["RIDER_HANDBILLS", "THOMAS_CIRCULAR", "PIKE_PROOF", "CUSTOMHOUSE_NOTICE"],
    choiceOverrides: {},
  },
  CUSTOMS: {
    stopAt: "CUSTOMS_SLIP",
    errandOrder: ["RIDER_HANDBILLS", "THOMAS_CIRCULAR", "PIKE_PROOF", "CUSTOMHOUSE_NOTICE"],
    choiceOverrides: { CLARKE_CHALLENGE: "CURT", CUSTOMS_STOP: "SLIP" },
  },
  CLIMB: { stopAt: "EVENT_CLIMB", errandOrder: ERRANDS_DEFAULT, choiceOverrides: {} },
  CHANT: {
    stopAt: "EVENT_CHANT",
    errandOrder: ERRANDS_DEFAULT,
    choiceOverrides: { EVENT_ONRAMP: "CHANT" },
  },
  PUSH: {
    stopAt: "EVENT_PUSH",
    errandOrder: ERRANDS_DEFAULT,
    choiceOverrides: { EVENT_ONRAMP: "PUSH" },
  },
  FINAL: { stopAt: "FINAL_PRESS_PULL", errandOrder: ERRANDS_DEFAULT, choiceOverrides: {} },
};

function mechanicResult(
  req: Extract<InputRequest, { kind: "MECHANIC" }>,
  spec: DriveSpec,
): MechanicRawResult {
  const p = req.params;
  if (p.kind === "PRESS") {
    const override = Object.entries(spec.pressOverrides ?? {}).find(([key]) =>
      req.promptId.includes(key),
    );
    return { kind: "PRESS", stopOffset: override ? override[1] : 0.5 };
  }
  if (p.kind === "EFFORT") return { kind: "EFFORT", holdMs: 1200 };
  if (p.kind === "PLACE") return { kind: "PLACE", alignment: 0.5 };
  if (p.kind === "PRINT_JOB") {
    const override = Object.entries(spec.pressOverrides ?? {}).find(([key]) =>
      req.promptId.includes(key),
    );
    const pull = override
      ? Math.max(0, 1 - Math.abs(override[1] - 0.5) * 2)
      : 0.95;
    const quality = pull < 0.35 ? "SMUDGED" : pull >= 0.85 ? "CRISP" : "USABLE";
    return {
      kind: "PRINT_JOB",
      phases: { catch: 0.95, ink: 0.95, register: 0.95, pull, peel: 0.95 },
      quality,
      accessible: false,
    };
  }
  if (p.kind === "HAUL_JOB") {
    return { kind: "HAUL_JOB", phases: { load: 0.9, balance: 0.9, thread: 0.9 }, accessible: false };
  }
  if (p.kind === "POST_JOB") {
    return { kind: "POST_JOB", phases: { lineUp: 0.9, tackLeft: 0.9, tackRight: 0.9 }, accessible: false };
  }
  const needs = new Set(["deed", "writ", "newspaper"]);
  return {
    kind: "SORT",
    assignments: (p.sortItems ?? []).map((item) => ({
      itemId: item.itemId,
      bucketId: needs.has(item.itemId) ? "NEEDS_STAMP" : "DOES_NOT",
    })),
  };
}

function respond(req: InputRequest, spec: DriveSpec): PresenterEvent {
  switch (req.kind) {
    case "CONTINUE":
    case "DAY_END":
      return { type: "CONTINUE" };
    case "ACK":
      return { type: "ACK" };
    case "BREATHER":
      return { type: "BREATHER_COMPLETE" };
    case "FOCUS_READ":
      return { type: "FOCUS_READ_OPENED", objectId: req.objectId };
    case "FREE_ROAM": {
      if (req.selectedTargetId) {
        return { type: "FREE_ROAM_GOTO", targetId: req.selectedTargetId };
      }
      const preferred = spec.errandOrder
        .map((id) => req.targets.find((t) => t.targetId === id))
        .find(Boolean);
      const gold = req.targets.find((t) => t.marker === "GOLD");
      const pick = preferred ?? gold ?? req.targets[0];
      if (!pick) return { type: "FREE_ROAM_IDLE" };
      return { type: "FREE_ROAM_SELECT", targetId: pick.targetId };
    }
    case "MECHANIC":
      return { type: "MECHANIC_RESULT", promptId: req.promptId, result: mechanicResult(req, spec) };
    case "CHOICE": {
      const override = Object.entries({ ...BASE_CHOICES, ...spec.choiceOverrides }).find(
        ([key]) => req.promptId.includes(key),
      );
      const overrideId = override?.[1];
      const enabled = req.options.filter((o) => !o.disabled);
      const pick =
        (overrideId ? enabled.find((o) => o.choiceId === overrideId) : undefined) ??
        enabled.find((o) => CORRECT_CHOICE_IDS.has(o.choiceId)) ??
        enabled[0] ??
        req.options[0]!;
      return { type: "CHOICE_SELECTED", promptId: req.promptId, choiceId: pick.choiceId };
    }
    case "CHECKPOINT_DEBRIEF":
      throw new Error("drive target was not reached before CP1");
  }
}

const targetName = process.argv[2] ?? "";
const spec = SPECS[targetName];
if (spec === undefined) {
  console.error(`unknown target ${targetName}; options: ${Object.keys(SPECS).join(", ")}`);
  process.exit(1);
}
const seedHex = process.argv[3] ?? "71".repeat(32);
const session = createDay1Session({ variationRootSeedHex: seedHex });
let steps = 0;
let noticeDone = false;
while (!session.isDone && session.plan) {
  const req = session.plan.request;
  if (req.kind === "MECHANIC" && req.promptId.includes(spec.stopAt)) break;
  if (targetName === "NOTICE_DONE") {
    if (req.kind === "MECHANIC" && req.promptId.includes("POST_NOTICE")) noticeDone = true;
    // Stop at the first roam after the errand wrapped, still inside the hall.
    if (noticeDone && req.kind === "FREE_ROAM") break;
  }
  session.advance(respond(req, spec));
  steps += 1;
  if (steps > 4000) {
    console.error("step cap exceeded before reaching target");
    process.exit(1);
  }
}
if (!session.plan) {
  console.error("session finished without reaching target");
  process.exit(1);
}
const request = session.plan.request;
console.log(JSON.stringify({
  target: targetName,
  steps,
  request: request.kind === "MECHANIC"
    ? { kind: request.kind, promptId: request.promptId, params: request.params.kind }
    : { kind: request.kind },
  events: session.committedEvents,
}));
