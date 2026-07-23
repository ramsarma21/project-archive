import {
  type LearnerState,
  type MasteryReport,
  type MasteryConceptRow,
  type MasteryStage,
  CONCEPT_TEKS,
  CONCEPT_META,
  MICRO_CONCEPT_IDS,
  type ConceptId,
  type Cp1CheckpointState,
  type MicroConceptId,
} from "@pa/contracts";

const MICRO_LABELS: Record<MicroConceptId, string> = {
  [MICRO_CONCEPT_IDS.SALUTARY_NEGLECT_END]: "The end of salutary neglect",
  [MICRO_CONCEPT_IDS.PORT_TOWN_BOSTON]: "Boston as a port town",
  [MICRO_CONCEPT_IDS.HARD_COIN_SCARCITY]: "Hard-coin scarcity",
  [MICRO_CONCEPT_IDS.PRINTERS_ROLE]: "Printers' role",
  [MICRO_CONCEPT_IDS.VICE_ADMIRALTY_COURTS]: "Vice-admiralty courts",
  [MICRO_CONCEPT_IDS.STAMP_WHAT_COUNTS]: "What the stamp covers",
  [MICRO_CONCEPT_IDS.ANDREW_OLIVER]: "Andrew Oliver",
  [MICRO_CONCEPT_IDS.LIBERTY_TREE]: "The Liberty Tree",
  [MICRO_CONCEPT_IDS.LOYAL_NINE]: "The Loyal Nine",
  [MICRO_CONCEPT_IDS.EFFIGY_PROTEST]: "Effigy protest",
  [MICRO_CONCEPT_IDS.NON_IMPORTATION]: "Non-importation",
  [MICRO_CONCEPT_IDS.NEWS_NETWORKS]: "News networks",
  [MICRO_CONCEPT_IDS.WRITS_OF_ASSISTANCE]: "Writs of assistance",
  [MICRO_CONCEPT_IDS.LOYALIST_VIEW]: "The Loyalist view",
};

// A concept gates day-completion only if it is MACRO_GATED. Unknown concepts
// default to gated (safe: never silently drop a required carrier); MICRO/PATTERN
// concepts are tracked and reported but never block the day.
function isGatedConcept(conceptId: string): boolean {
  const meta = CONCEPT_META[conceptId];
  return !meta || meta.class === "MACRO_GATED";
}

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

// A concept is "engaged" iff it has >=1 tracked exposure. The CP debrief samples
// MICRO concepts only from this set (Learning-Ledger-Spec §4 fairness
// rule: never test what the world didn't show this student). READY/demonstration
// gating stays for MACRO_GATED understanding only.
export function engagedConcepts(learner: LearnerState): ConceptId[] {
  return (Object.entries(learner) as [ConceptId, LearnerState[ConceptId]][])
    .filter(([, c]) => c.exposures.length > 0)
    .map(([id]) => id);
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
export function buildMasteryReport(
  learner: LearnerState,
  meta: ReportMeta,
  checkpoint?: Cp1CheckpointState,
  engagedMicroIds?: readonly MicroConceptId[],
): MasteryReport {
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
  // Completion is gated on the required (MACRO_GATED) carriers only. Micro/
  // pattern concepts enrich and are reported, but never block the day.
  const gatedConcepts = concepts.filter((r) => isGatedConcept(r.conceptId));
  const masteredCount = gatedConcepts.filter((r) => r.stage === "MASTERED").length;
  const requiredCount = gatedConcepts.length;
  const report: MasteryReport = {
    profileId: meta.profileId,
    packageId: meta.packageId,
    chapterId: meta.chapterId,
    generatedAt: meta.generatedAt,
    dayComplete: requiredCount > 0 && masteredCount === requiredCount,
    masteredCount,
    requiredCount,
    concepts,
    integrity: {
      variationRootSeedHex: meta.variationRootSeedHex,
      committedEventCount: meta.committedEventCount,
      deterministic: true,
      note: "Reproducible from the run seed and committed events; mastery is gated, not assumed.",
    },
  };
  if (engagedMicroIds && engagedMicroIds.length > 0) {
    report.engagedMicros = engagedMicroIds.map((microId) => ({
      microId,
      label: MICRO_LABELS[microId] ?? microId,
    }));
  }
  if (checkpoint) {
    report.checkpoint = {
      checkpointId: checkpoint.checkpointId,
      status: checkpoint.status,
      bankVersion: checkpoint.bankVersion,
      formId: checkpoint.selection?.formId ?? null,
      macroEvidence: checkpoint.macroOutcomes.map((outcome) => ({
        conceptId: outcome.conceptId,
        outcome: outcome.correct ? "SUPPORTED" : "REVISIT",
        hintsUsed: outcome.hintsUsed,
      })),
      enrichment: {
        included: checkpoint.enrichmentOutcomes.length > 0,
        responseCount: checkpoint.enrichmentOutcomes.length,
        correctCount: checkpoint.enrichmentOutcomes.filter((o) => o.correct).length,
      },
    };
  }
  return report;
}
