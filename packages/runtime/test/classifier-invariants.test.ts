import assert from "node:assert/strict";
import { test } from "node:test";
import type { Flow } from "../src/engine/ctx.js";
import {
  CP1_BANK_REGISTRY,
  CP1_PRODUCTION_BANK,
  Ctx,
  Session,
} from "../src/index.js";
import { openResponsePackage } from "../src/assessment/openResponseRegistry.js";
import { resolveRubricObservation } from "../src/assessment/rubricResolver.js";

// Property invariant (spec item 9): a formative open-response classification can
// only ever add an openResponseCompletions record and advance the interaction
// ordinal by exactly one. It must never change progression, mastery/learner
// state, world clock, relationships, routes, heat, or standing, no matter what
// an untrusted classifier returns (including adversarial mutation payloads).

const PROMPT_ID = "BOS.ACT01.PROMPT.REVENUE_VS_MARKET";
const entry = openResponsePackage(PROMPT_ID)!;
const resolutionContext = {
  itemId: entry.item.itemId,
  itemVersion: entry.item.itemVersion,
  allowedEvidenceIds: new Set(
    entry.sourcePackets.flatMap((packet) =>
      packet.evidence.map((evidence) => evidence.evidenceId),
    ),
  ),
};

function* roam(_ctx: Ctx): Flow {
  yield {
    present: [],
    request: {
      kind: "FREE_ROAM",
      targets: [{ targetId: "STREET", label: "Street", marker: "GOLD" }],
      canProceed: false,
    },
    cueId: "TEST.INVARIANT.ROAM",
  };
}

// Prerequisites + spacing satisfied so the compare prompt is eligible to open.
function eligibleCtx(): Ctx {
  const ctx = new Ctx(new Uint8Array(16).fill(3), {
    mode: "QA_DRAFT",
    openResponseContentMode: "AUTHOR_DRAFT_QA",
    activeBankVersion: CP1_PRODUCTION_BANK.bankVersion,
    banks: CP1_BANK_REGISTRY,
  });
  ctx.field.reactiveCompletions.revenue = {
    interactionId: "revenue",
    sourceId: "KN-customhouse",
    outcomeId: "READ",
    interactionOrdinal: 1,
  };
  ctx.field.reactiveCompletions.sarah = {
    interactionId: "sarah",
    sourceId: "THR-sarah",
    outcomeId: "HELP",
    interactionOrdinal: 2,
  };
  ctx.field.engagedMicroIds.push("MICRO.SALUTARY_NEGLECT_END");
  ctx.world.currentInteractionOrdinal = 4;
  return ctx;
}

const LEVELS = ["STRONG", "PARTIAL", "MISSING", "PERFECT", "MASTERED"];
const CRITERIA = [
  "CONCEPT_ACCURACY",
  "SOURCE_COMPARISON",
  "RELEVANT_EVIDENCE",
  "CRIT.INJECTED",
];
const EVIDENCE = [
  "BOS.ACT01.SRC.REVENUE_PROCLAMATION.v1.EV.1",
  "BOS.ACT01.SRC.SARAH_MARKET.v1.EV.1",
  "EV.PROMPT_INJECTION",
];

// Deterministic pseudo-random so the property run is reproducible.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff);
}

function pick<T>(rnd: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length)]!;
}

function fuzzObservation(rnd: () => number): unknown {
  if (rnd() < 0.2) {
    return pick(rnd, [
      { status: "UNCLASSIFIED", reason: "PROVIDER" },
      { status: "UNCLASSIFIED", reason: "TIMEOUT" },
      { refusal: "cannot grade" },
      "{malformed",
      null,
      42,
    ]);
  }
  // A "CLASSIFIED"-looking object, often carrying adversarial mutation fields.
  return {
    schemaVersion: "0.1.0-draft",
    itemId: entry.item.itemId,
    itemVersion: entry.item.itemVersion,
    topicality: pick(rnd, ["ON_TOPIC", "OFF_TOPIC", "ABSTAINED"]),
    criteria: entry.rubric.criteria.map(() => ({
      criterionId: pick(rnd, CRITERIA),
      level: pick(rnd, LEVELS),
    })),
    citedEvidenceIds: [pick(rnd, EVIDENCE), pick(rnd, EVIDENCE)],
    technical: {
      confidence: pick(rnd, ["LOW", "MEDIUM", "HIGH"]),
    },
    // Adversarial mutation payloads that must be ignored:
    world: { clock: 999, locationId: "HACKED" },
    mastery: "MASTERED",
    learner: { exposures: 999 },
    progression: "ADVANCE",
    route: "UNLOCK_ALL",
    relationship: 100,
    heat: "CALM",
    standing: 999,
  };
}

// Snapshot of everything that must remain invariant across a submission.
function invariantSnapshot(ctx: Ctx) {
  const field = structuredClone(ctx.field) as unknown as Record<string, unknown>;
  delete field.openResponseCompletions; // the one allowed field mutation
  return {
    learner: JSON.stringify(ctx.learner),
    world: JSON.stringify({ ...ctx.world, currentInteractionOrdinal: 0 }),
    field: JSON.stringify(field),
  };
}

const FORBIDDEN_KEYS = [
  "world",
  "clock",
  "mastery",
  "learner",
  "progression",
  "route",
  "relationship",
  "heat",
  "standing",
];

test("classifier resolution never mutates progression/mastery/world/relationship/clock", () => {
  const rnd = lcg(0xc0ffee);
  for (let i = 0; i < 400; i += 1) {
    const ctx = eligibleCtx();
    const session = new Session(ctx, roam);
    session.advance({
      type: "FIELD_OPEN_RESPONSE_STARTED",
      eventId: `start-${i}`,
      interruptId: `interrupt-${i}`,
      promptId: PROMPT_ID,
    });

    const before = invariantSnapshot(ctx);
    const ordinalBefore = ctx.world.currentInteractionOrdinal;

    const resolution = resolveRubricObservation(
      entry.rubric,
      fuzzObservation(rnd),
      resolutionContext,
    );

    // The sanitized resolution must never leak gameplay-mutation vocabulary.
    const serialized = JSON.stringify(resolution);
    for (const key of FORBIDDEN_KEYS) {
      assert.equal(serialized.includes(`"${key}"`), false);
    }
    // It is always a well-formed FORMATIVE resolution bound to this rubric.
    assert.equal(resolution.purpose, "FORMATIVE");
    assert.equal(resolution.rubricId, entry.rubric.rubricId);

    session.advance({
      type: "FIELD_OPEN_RESPONSE_SUBMITTED",
      eventId: `submit-${i}`,
      interruptId: `interrupt-${i}`,
      promptId: PROMPT_ID,
      response: {
        responseId: `r-${i}`,
        attemptId: "attempt-invariant",
        promptId: PROMPT_ID,
        promptVersion: "v1",
        submittedAt: "2026-07-22T20:00:00.000Z",
        storage: "LOCAL_EPHEMERAL",
      },
      resolution,
    });

    const after = invariantSnapshot(ctx);
    // Nothing changed except the completion record and a single ordinal step.
    assert.equal(after.learner, before.learner, `learner mutated at #${i}`);
    assert.equal(after.world, before.world, `world mutated at #${i}`);
    assert.equal(after.field, before.field, `field mutated at #${i}`);
    assert.equal(ctx.world.currentInteractionOrdinal, ordinalBefore + 1);
    assert.equal(
      Object.keys(ctx.field.openResponseCompletions).length,
      1,
      `unexpected completion count at #${i}`,
    );
  }
});
