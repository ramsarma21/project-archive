import type { PresenterEvent } from "@pa/contracts";
import { createDay1Session } from "../src/index.js";
import { scorePrintJob } from "../src/content/day1/mechanics.js";

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function deepEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

{
  equal(
    scorePrintJob({ catch: 0.9, ink: 0.88, register: 0.92, pull: 0.86, peel: 0.9 }).quality,
    "CRISP",
    "crisp threshold",
  );
  equal(
    scorePrintJob({ catch: 0.75, ink: 0.7, register: 0.8, pull: 0.72, peel: 0.76 }).quality,
    "USABLE",
    "usable threshold",
  );
  equal(
    scorePrintJob({ catch: 0.9, ink: 0.2, register: 0.9, pull: 0.9, peel: 0.9 }).quality,
    "SMUDGED",
    "smudged threshold",
  );
}

{
  const seed = "81".repeat(32);
  const opening: PresenterEvent[] = [
    { type: "CONTINUE" },
    { type: "FREE_ROAM_GOTO", targetId: "MERCER_PRESS" },
    {
      type: "CHOICE_SELECTED",
      promptId: "BOS.MD01.ACT.ENTER_MERCER.v1",
      choiceId: "WALK_IN",
    },
  ];
  const session = createDay1Session({ variationRootSeedHex: seed });
  for (const event of opening) session.advance(event);
  equal(session.plan?.request.kind, "MECHANIC", "compound request kind");
  equal(
    session.plan?.request.kind === "MECHANIC"
      ? session.plan.request.params.kind
      : null,
    "PRINT_JOB",
    "compound mechanic kind",
  );
  const printEvent: PresenterEvent = {
    type: "MECHANIC_RESULT",
    promptId: "BOS.MD01.ACT.PRESS_PIKE_PROOF.v1",
    result: {
      kind: "PRINT_JOB",
      phases: { catch: 0.1, ink: 0.2, register: 0.3, pull: 0.1, peel: 0.2 },
      quality: "SMUDGED",
      accessible: true,
    },
  };
  session.advance(printEvent);
  const stored =
    session.ctx.world.printJobs["BOS.MD01.ACT.PRESS_PIKE_PROOF.v1"];
  equal(stored?.quality, "USABLE", "accessible quality floor");
  deepEqual(stored?.phases, {
    catch: 0.7,
    ink: 0.7,
    register: 0.7,
    pull: 0.7,
    peel: 0.7,
  }, "accessible phase floor");
  equal(session.ctx.world.jobObjects.PIKE_PROOF?.condition, "USABLE", "proof condition");

  const resumed = createDay1Session({
    variationRootSeedHex: seed,
    priorEvents: [...opening, printEvent],
  });
  deepEqual(
    resumed.ctx.world.printJobs["BOS.MD01.ACT.PRESS_PIKE_PROOF.v1"],
    stored,
    "replay print state",
  );
}
