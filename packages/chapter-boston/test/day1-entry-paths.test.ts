import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExecutionPlan } from "@pa/contracts";
import { createDay1Session } from "../src/index.js";

// ---------------------------------------------------------------------------
// Feel-audit-1 P0-1 regression: the "Look through the window first." entry
// must deliver the COMPLETE Mercer arrival — interior scene swap, the Abigail
// meet, her entry line, and the catch line — attached to the press-job plan,
// and REPORT_TO_MERCER must stay incomplete (errands locked) until the proof
// comparison closes the arrival. The audited defect surfaced as the press job
// starting with no arrival beats; the runtime sequence below is the authority
// the presenter must render, pinned for every entry choice.
// ---------------------------------------------------------------------------

const seed = "77".repeat(32);

function sessionAtEntryChoice() {
  const session = createDay1Session({ variationRootSeedHex: seed });
  // CONTINUE past intake, then free-roam to the press door.
  session.advance({ type: "CONTINUE" });
  const roam = session.advance({ type: "FREE_ROAM_GOTO", targetId: "MERCER_PRESS" });
  const plan = roam.plan as ExecutionPlan;
  assert.equal(plan.request.kind, "CHOICE");
  assert.equal(
    plan.request.kind === "CHOICE" ? plan.request.promptId : "",
    "BOS.MD01.ACT.ENTER_MERCER.v1",
  );
  return session;
}

test("Mercer entry cards preview distinct approach stakes", () => {
  const session = sessionAtEntryChoice();
  const request = session.plan?.request;
  assert.equal(request?.kind, "CHOICE");
  if (request?.kind !== "CHOICE") return;
  assert.deepEqual(
    request.options.map((option) => [option.choiceId, option.tags]),
    [
      ["KNOCK", ["polite approach"]],
      ["WALK_IN", ["direct approach"]],
      ["LOOK_FIRST", ["observe first"]],
    ],
  );
});

for (const entry of ["LOOK_FIRST", "KNOCK", "WALK_IN"] as const) {
  test(`${entry} entry reaches the full Mercer arrival beats`, () => {
    const session = sessionAtEntryChoice();
    const result = session.advance({
      type: "CHOICE_SELECTED",
      promptId: "BOS.MD01.ACT.ENTER_MERCER.v1",
      choiceId: entry,
    });
    const plan = result.plan as ExecutionPlan;

    // The next request is the press job…
    assert.equal(plan.request.kind, "MECHANIC");
    assert.equal(plan.cueId, "BOS.MD01.ACT.PRESS_PIKE_PROOF.v1");

    // …and it CARRIES the arrival presentation: the interior scene and
    // Abigail's spoken greeting. A presenter that starts the job without
    // rendering these directives is skipping the arrival.
    const sceneSwap = plan.present.find(
      (d) => d.kind === "SCENE" && d.locationId === "MERCER_PRESS",
    );
    assert.ok(sceneSwap, "arrival must swap the scene to MERCER_PRESS");
    const abigailLines = plan.present.filter(
      (d) => d.kind === "DIALOGUE" && d.speaker === "ABIGAIL",
    );
    assert.ok(
      abigailLines.length >= (entry === "WALK_IN" ? 1 : 2),
      `Abigail's introduction dialogue must be present (got ${abigailLines.length})`,
    );

    // Abigail is met at the arrival…
    assert.ok(
      session.ctx.peopleMet.includes("Abigail Mercer"),
      "Abigail must be registered as met on arrival",
    );

    // …but REPORT_TO_MERCER stays open and no errand unlocks until the
    // arrival completes through the proof comparison.
    assert.equal(session.ctx.world.objectives.REPORT_TO_MERCER, "SELECTED");
    assert.notEqual(session.ctx.world.objectives.PIKE_PROOF, "ACTIVE");

    // Complete the press job + mandatory proof compare: the arrival closes.
    session.advance({
      type: "MECHANIC_RESULT",
      promptId: "BOS.MD01.ACT.PRESS_PIKE_PROOF.v1",
      result: {
        kind: "PRINT_JOB",
        phases: { catch: 0.9, ink: 0.9, register: 0.9, pull: 0.9, peel: 0.9 },
        quality: "CRISP",
        accessible: false,
      },
    });
    session.advance({ type: "FOCUS_READ_OPENED", objectId: "STAMP_PROOF_COMPARE" });
    assert.equal(session.ctx.world.objectives.REPORT_TO_MERCER, "COMPLETED");
    assert.equal(session.ctx.world.objectives.PIKE_PROOF, "ACTIVE");
    assert.equal(session.ctx.world.objectives.THOMAS_CIRCULAR, "ACTIVE");
    assert.equal(session.ctx.world.objectives.CUSTOMHOUSE_NOTICE, "ACTIVE");
    assert.equal(session.ctx.world.objectives.RIDER_HANDBILLS, "ACTIVE");
  });
}
