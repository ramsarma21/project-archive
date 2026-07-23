import { createDay1Session, DAY1_CUES } from "../src/index.js";
import type { PresenterEvent } from "@pa/contracts";

const seed = "31".repeat(32);
const openingEvents: PresenterEvent[] = [
  { type: "CONTINUE" },
  { type: "FREE_ROAM_GOTO", targetId: "MERCER_PRESS" },
  { type: "CHOICE_SELECTED", promptId: "BOS.MD01.ACT.ENTER_MERCER.v1", choiceId: "WALK_IN" },
  {
    type: "MECHANIC_RESULT",
    promptId: "BOS.MD01.ACT.PRESS_PIKE_PROOF.v1",
    result: {
      kind: "PRINT_JOB",
      phases: { catch: 0.95, ink: 0.95, register: 0.95, pull: 0.95, peel: 0.95 },
      quality: "CRISP",
      accessible: false,
    },
  },
  { type: "FOCUS_READ_OPENED", objectId: "STAMP_PROOF_COMPARE" },
];

const expectedCues = [
  DAY1_CUES.ARCHIVE_INTAKE,
  DAY1_CUES.ARRIVE_BOSTON,
  DAY1_CUES.ENTER_MERCER,
  DAY1_CUES.PRESS_PIKE_PROOF,
  DAY1_CUES.STAMP_PROOF_COMPARE,
  DAY1_CUES.LEAVE_MERCER,
];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

{
  const session = createDay1Session({ variationRootSeedHex: seed });
  const openingPlan = session.plan;
  assert(openingPlan !== null, "opening plan missing");
  assert(openingPlan.cueId === expectedCues[0], "opening cue mismatch");
  assert(openingPlan.present.every((directive) => directive.cueId === expectedCues[0]), "opening directives lack cue");
  assert(openingPlan.present.every((directive) => Boolean(directive.locationId)), "opening directives lack locations");

  openingEvents.forEach((event, index) => {
    session.advance(event);
    const plan = session.plan;
    assert(plan !== null, `plan missing at opening boundary ${index + 1}`);
    assert(plan.cueId === expectedCues[index + 1], `cue mismatch at opening boundary ${index + 1}`);
    assert(
      plan.present.every((directive) => directive.cueId === expectedCues[index + 1]),
      `directives lack cue at opening boundary ${index + 1}`,
    );
    assert(
      plan.present.every((directive) => Boolean(directive.locationId)),
      `directives lack locations at opening boundary ${index + 1}`,
    );
  });
}

{
  const uninterrupted = createDay1Session({ variationRootSeedHex: seed });
  for (const event of openingEvents.slice(0, 3)) uninterrupted.advance(event);

  const resumed = createDay1Session({
    variationRootSeedHex: seed,
    priorEvents: openingEvents.slice(0, 3),
  });
  assert(resumed.plan?.cueId === uninterrupted.plan?.cueId, "resume changed choreography boundary");
  assert(
    JSON.stringify(resumed.plan?.present) === JSON.stringify(uninterrupted.plan?.present),
    "resume changed staged directives",
  );
}

{
  const session = createDay1Session({
    variationRootSeedHex: seed,
    priorEvents: openingEvents,
  });
  session.advance({ type: "FREE_ROAM_GOTO", targetId: "STREET" });
  assert(session.ctx.world.locationId === "BOSTON_STREET", "leaving Mercer snapped back to the interior");
  assert(session.plan?.request.kind === "FREE_ROAM", "street exit did not unlock physical errand travel");
}
