import {
  type LearnerState,
  type MasteryReport,
  type MasteryConceptRow,
  type MasteryStage,
  CONCEPT_TEKS,
  type ConceptId,
} from "@pa/contracts";

function conceptName(conceptId: string): string {
  if (conceptId.includes("STAMP")) return "Stamp Act";
  if (conceptId.includes("REPRESENTATION")) return "Representation";
  return "Postwar revenue policy";
}

function stageOf(row: { understanding: string; demonstration: string; distinctOccasionCount: number }): MasteryStage {
  if (row.demonstration === "DEMONSTRATED") return "MASTERED";
  if (row.understanding === "UNDERSTOOD") return "UNDERSTOOD";
  if (row.distinctOccasionCount > 0) return "LEARNING";
  return "NOT_STARTED";
}

export interface ReportMeta {
  profileId: string;
  packageId: string;
  chapterId: string;
  variationRootSeedHex: string;
  committedEventCount: number;
  generatedAt: string;
}

// Derive a per-student mastery report from the (event-sourced) learner state.
// This is a read-only projection: it never mutates state and is reproducible
// from the same seed + committed events, which is what makes it auditable.
export function buildMasteryReport(learner: LearnerState, meta: ReportMeta): MasteryReport {
  const concepts: MasteryConceptRow[] = [];
  for (const [conceptId, c] of Object.entries(learner)) {
    const teks = CONCEPT_TEKS[conceptId as ConceptId];
    concepts.push({
      conceptId,
      conceptName: conceptName(conceptId),
      teksCode: teks?.code ?? "",
      teksClause: teks?.text ?? "",
      stage: stageOf(c),
      exposureCount: c.distinctOccasionCount,
      exposureTypes: [...c.exposureTypes],
      understandingPassed: c.understanding === "UNDERSTOOD",
      understandingAttempts: c.firstUnderstandingAttemptCount,
      demonstrated: c.demonstration === "DEMONSTRATED",
      misconceptions: [...c.misconceptionIds],
    });
  }
  const masteredCount = concepts.filter((r) => r.stage === "MASTERED").length;
  return {
    profileId: meta.profileId,
    packageId: meta.packageId,
    chapterId: meta.chapterId,
    generatedAt: meta.generatedAt,
    dayComplete: masteredCount === concepts.length && concepts.length > 0,
    masteredCount,
    requiredCount: concepts.length,
    concepts,
    integrity: {
      variationRootSeedHex: meta.variationRootSeedHex,
      committedEventCount: meta.committedEventCount,
      deterministic: true,
      note: "Reproducible from the run seed and committed events; mastery is gated, not assumed.",
    },
  };
}
