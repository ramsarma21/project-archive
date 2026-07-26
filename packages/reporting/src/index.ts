// ============================================================================
// @pa/reporting — the teacher- and district-facing mastery report.
//
// Headless and pure — no React, no database, no clock — so it runs under
// `node --test`, in the browser, and inside the API route without change. The
// route owns the SQL; this package owns every judgement.
//
// Read the README for the argued decisions. The four that shape everything:
//
//   - THE CAPSTONE IS THE ONLY ACADEMIC EVIDENCE. Mission performance measures
//     dexterity and is deliberately absent from every type here.
//   - TWO MEASURES, NEVER ONE. The first sitting is what the student knew
//     unaided; current standing is what they can demonstrate after retries. Each
//     carries its own label and basis so a number cannot be read as the other.
//   - A STUDENT GAP AND AN ITEM SHORTAGE ARE COUNTED IN DIFFERENT FIELDS, and no
//     field adds them.
//   - EVERYTHING IS KEYED BY PROFILE AND CHAPTER, using @pa/assessment's own key
//     function, and a duplicate key throws rather than overwriting.
// ============================================================================

// ---- the ports onto the two upstream packages ------------------------------
export {
  REPORTED_ATTEMPT_ORDINAL,
  chapterReportKey,
  type AttemptReportRow,
  type ChapterAssessmentReport,
  type ConceptReportRow,
  type ConceptReportStatus,
  type ProvenanceRollup,
} from "./assessment.js";

export {
  CHAPTER_BOSTON,
  CURRICULUM_CHAPTER_IDS,
  UnknownChapterError,
  allRegisteredConceptIds,
  compareStandardCodes,
  isCurriculumChapterId,
  registryChapterConceptIds,
  registryStandardsSource,
  staticStandardsSource,
  type ConceptDescriptor,
  type CurriculumChapterId,
  type StandardDescriptionSource,
  type StandardDescriptor,
  type StandardsSource,
} from "./curriculum.js";

// ---- the evidence vocabulary ----------------------------------------------
export {
  CURRENT_STANDING_BASIS,
  CURRENT_STANDING_LABEL,
  FIRST_SITTING_BASIS,
  FIRST_SITTING_LABEL,
  MEASURE_CURRENT,
  MEASURE_FIRST_SITTING,
  REPAIR_GAP_MATERIAL_POINTS,
  evidenceProfileIsPartition,
  evidenceStrength,
  outcomeFromEngineStatus,
  outcomeIsMastered,
  outcomeOwner,
  outcomeWasMeasured,
  percentOf,
  repairGap,
  summariseOutcomes,
  type ConceptOutcome,
  type CurrentStandingMeasure,
  type EvidenceProfile,
  type EvidenceStrength,
  type FirstSittingMeasure,
  type OutcomeOwner,
  type RepairGap,
  type RepairInterpretation,
} from "./evidence.js";

// ---- where the evidence comes from, and what it lost -----------------------
export {
  evidenceFromCapstoneReport,
  evidenceFromDurableRows,
  type AttemptFact,
  type CapstoneEvidence,
  type ConceptEvidenceFact,
  type DisclosureGap,
  type DurableAttemptRow,
  type DurableCapstoneRows,
  type DurableMasteryRow,
  type EvidenceFidelity,
  type FirstSittingFact,
} from "./source.js";

// ---- the per-student report ------------------------------------------------
export {
  MISSION_PERFORMANCE_IS_NOT_ACADEMIC_EVIDENCE,
  buildStudentChapterReport,
  studentSelfView,
  type AttemptTrailRow,
  type BuildStudentReportInput,
  type ConceptEvidenceRow,
  type ConceptStandardRef,
  type ReportSubject,
  type StudentChapterReport,
} from "./student.js";

// ---- the TEKS rollup -------------------------------------------------------
export {
  rollUpToStandards,
  type StandardCoverage,
  type StandardEvidenceRow,
  type StandardMasteryVerdict,
  type StandardRollupConcept,
  type StandardsRollup,
} from "./standards.js";

// ---- the roster, which is the primary artifact -----------------------------
export {
  ROSTER_COLUMNS,
  ROSTER_PRIMARY_NEEDS,
  buildRosterView,
  type BuildRosterInput,
  type ClassConceptNeed,
  type RosterColumnLegend,
  type RosterCoverage,
  type RosterFlag,
  type RosterNeedRef,
  type RosterRow,
  type RosterStatus,
  type RosterSummary,
  type RosterView,
} from "./roster.js";

// ---- authorisation ---------------------------------------------------------
export {
  MIN_AGGREGATE_COHORT,
  assertWithinScope,
  authoriseRoster,
  authoriseStudentReport,
  cohortIsReportable,
  type AccessAction,
  type AccessRefusal,
  type AuthoriseRosterInput,
  type AuthoriseStudentReportInput,
  type ReportAccessAudit,
  type ReportViewer,
  type RosterAccess,
  type StudentReportAccess,
} from "./authorisation.js";

// ---- the honest claim ------------------------------------------------------
export {
  buildReportClaim,
  mergeClaims,
  type ClaimInput,
  type ClaimQualifier,
  type ClaimStrength,
  type ReportClaim,
} from "./claim.js";

// ---- the district export ---------------------------------------------------
export {
  DISTRICT_EXPORT_SCHEMA,
  csvText,
  districtExport,
  districtExportJson,
  standardEvidenceCsv,
  studentSummaryCsv,
  type DistrictExportEnvelope,
  type DistrictExportInput,
  type DistrictExportStudent,
  type ExportFormat,
  type ExportIdentityMode,
  type ExportedDocument,
} from "./export.js";

// ---- the composed service the API route injects ----------------------------
export {
  reportingService,
  type ReportingService,
  type StudentEvidenceInput,
} from "./service.js";
