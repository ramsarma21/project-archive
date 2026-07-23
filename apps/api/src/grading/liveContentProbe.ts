import "../config.js";
import {
  CanonicalClassifierObservationSchema,
} from "@pa/contracts";
import {
  openResponsePackages,
  resolveRubricObservation,
} from "@pa/runtime";
import { TrueFoundryGradingProvider } from "./openAiCompatible.js";

if (process.env.RUN_LIVE_GRADING_PROBE !== "true") {
  throw new Error(
    "Set RUN_LIVE_GRADING_PROBE=true; live provider probes never run in normal CI",
  );
}

const packages = openResponsePackages({ allowAuthorDraft: true });
const fixtures: Record<string, string> = {
  COMPARE_SOURCES:
    "The Crown notice says revenue will help answer war debt. Sarah shows what the notice leaves out: a thin market stall and lost trade in Boston.",
  APPLY_CONCEPT:
    "Non-importation works when merchants give up British goods together, so British sellers press Parliament. The shopkeeper risks short-term customers to make shared pressure stronger.",
  HISTORICAL_PERSPECTIVE:
    "Clarke would call the effigy dangerous mob action because he values lawful order. That is his Loyalist view, not my own judgment of the protest.",
  STRATEGY_JUSTIFICATION:
    "I would send several riders with copies. It costs coordination, but the rider network shows that one delayed route should not stop urgent news reaching other towns.",
  CAUSAL_SYNTHESIS:
    "The no-consent broadside named the grievance, protesters made Oliver the public target through the effigy, and the pressure led him to resign as stamp distributor.",
};

const provider = new TrueFoundryGradingProvider();
const results = [];
for (const operation of [
  "COMPARE_SOURCES",
  "APPLY_CONCEPT",
  "HISTORICAL_PERSPECTIVE",
  "STRATEGY_JUSTIFICATION",
  "CAUSAL_SYNTHESIS",
] as const) {
  const content = packages.find(
    (entry) => entry.prompt.operation === operation,
  );
  if (!content) throw new Error(`No authored item for ${operation}`);
  const allowedEvidenceIds = content.sourcePackets.flatMap((packet) =>
    packet.evidence.map((entry) => entry.evidenceId),
  );
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const raw = await provider.classify(
      {
        responseText: fixtures[operation]!,
        prompt: content.prompt,
        rubric: content.rubric,
        sourceTexts: content.sourceTexts,
        itemId: content.item.itemId,
        itemVersion: content.item.itemVersion,
        allowedEvidenceIds,
        requestHash: `live-probe-${operation.toLowerCase()}`,
      },
      controller.signal,
    );
    const parsed = CanonicalClassifierObservationSchema.safeParse(raw);
    const resolution = resolveRubricObservation(
      content.rubric,
      raw,
      {
        itemId: content.item.itemId,
        itemVersion: content.item.itemVersion,
        allowedEvidenceIds: new Set(allowedEvidenceIds),
      },
    );
    results.push({
      operation,
      itemId: content.item.itemId,
      schemaValid: parsed.success,
      topicality: parsed.success ? parsed.data.topicality : "INVALID",
      criterionLevels: parsed.success
        ? parsed.data.criteria.map((entry) => entry.level)
        : [],
      technicalConfidence: parsed.success
        ? parsed.data.technical.confidence
        : "INVALID",
      outcome: resolution.outcome,
      feedbackId: resolution.feedbackIds[0],
      latencyMs: Math.round(performance.now() - started),
    });
  } finally {
    clearTimeout(timeout);
  }
}

process.stdout.write(
  `${JSON.stringify(
    {
      model: process.env.TRUEFOUNDRY_GRADING_MODEL,
      contentStatus: "AUTHOR_DRAFT",
      rawTextPrinted: false,
      results,
    },
    null,
    2,
  )}\n`,
);

