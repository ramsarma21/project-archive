import assert from "node:assert/strict";
import { test } from "node:test";
import type { Flow } from "../src/engine/ctx.js";
import {
  CP1_BANK_REGISTRY,
  CP1_PRODUCTION_BANK,
  Ctx,
  Session,
} from "../src/index.js";
import {
  authoredFallbackForPrompt,
  openResponsePackage,
} from "../src/assessment/openResponseRegistry.js";
import {
  resolutionMatchesPackage,
  resolveRubricObservation,
} from "../src/assessment/rubricResolver.js";

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

test("resolver accepts only package allowlists", () => {
  const accepted = resolveRubricObservation(entry.rubric, {
    schemaVersion: "0.1.0-draft",
    itemId: entry.item.itemId,
    itemVersion: entry.item.itemVersion,
    topicality: "ON_TOPIC",
    criteria: entry.rubric.criteria.map((criterion) => ({
      criterionId: criterion.criterionId,
      level: "STRONG",
    })),
    citedEvidenceIds: [
      "BOS.ACT01.SRC.REVENUE_PROCLAMATION.v1.EV.1",
      "BOS.ACT01.SRC.SARAH_MARKET.v1.EV.1",
    ],
    technical: { confidence: "HIGH" },
  }, resolutionContext);
  assert.equal(accepted.status, "FORMATIVE_CLASSIFIED");
  assert.equal(accepted.outcome, "STRONG_RESPONSE");
  assert.deepEqual(accepted.feedbackIds, ["BOS.ACT01.FB.COMPARE.STRONG"]);
  assert.equal(resolutionMatchesPackage(entry.rubric, accepted), true);

  for (const observation of [
    {
      schemaVersion: "0.1.0-draft",
      itemId: entry.item.itemId,
      itemVersion: entry.item.itemVersion,
      topicality: "ON_TOPIC",
      criteria: [{ criterionId: "CONCEPT_ACCURACY", level: "PERFECT" }],
      citedEvidenceIds: [],
      technical: { confidence: "HIGH" },
    },
    {
      schemaVersion: "0.1.0-draft",
      itemId: entry.item.itemId,
      itemVersion: entry.item.itemVersion,
      topicality: "ON_TOPIC",
      criteria: [{ criterionId: "CRIT.UNKNOWN", level: "STRONG" }],
      citedEvidenceIds: [],
      technical: { confidence: "HIGH" },
    },
    {
      schemaVersion: "0.1.0-draft",
      itemId: entry.item.itemId,
      itemVersion: entry.item.itemVersion,
      topicality: "ON_TOPIC",
      criteria: entry.rubric.criteria.map((criterion) => ({
        criterionId: criterion.criterionId,
        level: "STRONG",
      })),
      citedEvidenceIds: ["EV.PROMPT_INJECTION_ACCEPTED"],
      technical: { confidence: "HIGH" },
    },
    {
      schemaVersion: "0.1.0-draft",
      itemId: entry.item.itemId,
      itemVersion: entry.item.itemVersion,
      topicality: "ON_TOPIC",
      criteria: entry.rubric.criteria.map((criterion) => ({
        criterionId: criterion.criterionId,
        level: "STRONG",
      })),
      citedEvidenceIds: [],
      technical: { confidence: "LOW" },
    },
    { refusal: "I cannot grade this" },
    "{malformed",
  ]) {
    assert.deepEqual(
      resolveRubricObservation(entry.rubric, observation, resolutionContext),
      authoredFallbackForPrompt(PROMPT_ID),
    );
  }
});

test("canonical resolver derives the complete authored outcome set and legacy mappings", () => {
  const canonical = (
    topicality: "ON_TOPIC" | "OFF_TOPIC" | "ABSTAINED",
    level: "STRONG" | "PARTIAL" | "MISSING",
    confidence: "LOW" | "MEDIUM" | "HIGH" = "HIGH",
  ) => ({
    schemaVersion: "0.1.0-draft",
    itemId: entry.item.itemId,
    itemVersion: entry.item.itemVersion,
    topicality,
    criteria: entry.rubric.criteria.map((criterion) => ({
      criterionId: criterion.criterionId,
      level,
    })),
    citedEvidenceIds: [],
    technical: { confidence },
  });
  for (const [observation, outcome, feedbackId] of [
    [
      canonical("ON_TOPIC", "STRONG"),
      "STRONG_RESPONSE",
      "BOS.ACT01.FB.COMPARE.STRONG",
    ],
    [
      canonical("ON_TOPIC", "PARTIAL"),
      "PARTIAL_RESPONSE",
      "BOS.ACT01.FB.COMPARE.PARTIAL",
    ],
    [
      canonical("ON_TOPIC", "MISSING"),
      "NEEDS_SOURCE_REVISIT",
      "BOS.ACT01.FB.COMPARE.MISSING",
    ],
    [
      canonical("OFF_TOPIC", "MISSING", "LOW"),
      "OFF_TOPIC",
      "BOS.ACT01.FB.GENERIC.OFF_TOPIC",
    ],
    [
      canonical("ABSTAINED", "MISSING"),
      "ABSTAINED",
      "BOS.ACT01.FB.COMPARE.MISSING",
    ],
    [
      canonical("ON_TOPIC", "STRONG", "LOW"),
      "UNCLASSIFIED",
      "BOS.ACT01.FB.GENERIC.UNCLASSIFIED",
    ],
  ] as const) {
    const resolution = resolveRubricObservation(
      entry.rubric,
      observation,
      resolutionContext,
    );
    assert.equal(resolution.outcome, outcome);
    assert.deepEqual(resolution.feedbackIds, [feedbackId]);
  }
  assert.equal(
    resolveRubricObservation(entry.rubric, {
      status: "CLASSIFIED",
      label: "EVIDENCE_CONNECTED",
      criterionIds: entry.rubric.criteria.map(
        (criterion) => criterion.criterionId,
      ),
      evidenceIds: [],
      confidence: 0.9,
    }).outcome,
    "STRONG_RESPONSE",
  );
  assert.equal(
    resolutionMatchesPackage(entry.rubric, {
      purpose: "FORMATIVE",
      status: "FORMATIVE_CLASSIFIED",
      label: "EVIDENCE_CONNECTED",
      criterionIds: ["CRIT.COMPARES_SOURCE_CLAIMS"],
      evidenceIds: ["EV.REVENUE_PURPOSE"],
      feedbackIds: ["FB.COMPARE.CONNECTED.v1"],
      rubricId: "BOS.ACT01.RUBRIC.COMPARE_ECONOMIC_EVIDENCE.v1",
      rubricVersion: "1.0.0",
    }),
    true,
  );
});

test("classifier output has no gameplay mutation vocabulary", () => {
  for (let index = 0; index < 300; index += 1) {
    const malicious = {
      schemaVersion: "0.1.0-draft",
      itemId: entry.item.itemId,
      itemVersion: entry.item.itemVersion,
      topicality: "ON_TOPIC",
      criteria: [{ criterionId: `CRIT.${index}`, level: "STRONG" }],
      citedEvidenceIds: [`EV.${index}`],
      technical: { confidence: "HIGH" },
      world: { clock: 999 },
      mastery: "MASTERED",
      route: "UNLOCK_ALL",
      relationship: 100,
    };
    const resolution = resolveRubricObservation(
      entry.rubric,
      malicious,
      resolutionContext,
    );
    const serialized = JSON.stringify(resolution);
    for (const forbidden of [
      "world",
      "clock",
      "mastery",
      "route",
      "relationship",
      "learner",
      "progression",
    ]) {
      assert.equal(serialized.includes(forbidden), false);
    }
  }
});

function* roam(_ctx: Ctx): Flow {
  yield {
    present: [],
    request: {
      kind: "FREE_ROAM",
      targets: [{ targetId: "STREET", label: "Street", marker: "GOLD" }],
      canProceed: false,
    },
    cueId: "TEST.OPEN.ROAM",
  };
}

function eligibleCtx(): Ctx {
  const ctx = new Ctx(new Uint8Array(16).fill(5), {
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

test("open response suspends exact roam and cannot close before submission", () => {
  const ctx = eligibleCtx();
  const session = new Session(ctx, roam);
  const original = structuredClone(session.plan);
  session.advance({
    type: "FIELD_OPEN_RESPONSE_STARTED",
    eventId: "open-start",
    interruptId: "open-interrupt",
    promptId: PROMPT_ID,
  });
  assert.equal(session.plan?.fieldInterrupt?.kind, "OPEN_RESPONSE");
  assert.throws(
    () =>
      session.advance({
        type: "FIELD_INTERRUPT_RESOLVED",
        eventId: "open-early-close",
        interruptId: "open-interrupt",
        outcome: "CLOSED",
      }),
    /submission is required/,
  );

  const resolution = authoredFallbackForPrompt(PROMPT_ID);
  session.advance({
    type: "FIELD_OPEN_RESPONSE_SUBMITTED",
    eventId: "open-submit",
    interruptId: "open-interrupt",
    promptId: PROMPT_ID,
    response: {
      responseId: "local-response-1",
      attemptId: "attempt-1",
      promptId: PROMPT_ID,
      promptVersion: "v1",
      submittedAt: "2026-07-22T20:00:00.000Z",
      storage: "LOCAL_EPHEMERAL",
    },
    resolution,
  });
  session.advance({
    type: "FIELD_INTERRUPT_RESOLVED",
    eventId: "open-close",
    interruptId: "open-interrupt",
    outcome: "AUTHORED_FALLBACK",
  });
  assert.deepEqual(session.plan, original);
  assert.equal(ctx.world.currentInteractionOrdinal, 5);
  assert.equal(ctx.field.openResponseCompletions[PROMPT_ID]?.resolution.status, "AUTHORED_FALLBACK");
});

test("stable named-NPC outcomes resolve effects from the runtime registry", () => {
  const ctx = new Ctx(new Uint8Array(16).fill(7));
  const session = new Session(ctx, roam);
  session.advance({
    type: "FIELD_INTERRUPT_STARTED",
    eventId: "npc-start",
    interruptId: "npc-interrupt",
    interruptKind: "REACTIVE_EXCHANGE",
    sourceId: "NPC-thomas",
  });
  session.advance({
    type: "FIELD_REACTIVE_OUTCOME_SELECTED",
    eventId: "npc-outcome",
    interruptId: "npc-interrupt",
    interactionId: "NPC-thomas:1",
    sourceId: "NPC-thomas",
    outcomeId: "TRADE",
  });
  assert.equal(
    ctx.field.engagedMicroIds.includes("MICRO.NON_IMPORTATION"),
    true,
  );
  assert.equal(ctx.world.relationships.THOMAS_OBLIGATION, 3);
  const invalid = new Session(new Ctx(new Uint8Array(16).fill(8)), roam);
  invalid.advance({
    type: "FIELD_INTERRUPT_STARTED",
    eventId: "bad-start",
    interruptId: "bad-interrupt",
    interruptKind: "REACTIVE_EXCHANGE",
    sourceId: "NPC-thomas",
  });
  assert.throws(
    () =>
      invalid.advance({
        type: "FIELD_REACTIVE_OUTCOME_SELECTED",
        eventId: "bad-outcome",
        interruptId: "bad-interrupt",
        interactionId: "NPC-thomas:1",
        sourceId: "NPC-thomas",
        outcomeId: "HACK_WORLD",
      }),
    /unregistered reactive outcome/,
  );
});

