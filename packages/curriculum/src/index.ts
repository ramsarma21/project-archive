// ============================================================================
// @pa/curriculum — the canonical curriculum registry.
//
// One spelling for a student expectation, one id for an instructional concept,
// one table that maps every legacy identifier onto them, and a validator that
// refuses the rest.
//
// Read src/README.md equivalents in the package README for the layering.
// ============================================================================

// ---- SE codes: the branded primary key and the normalizer -------------------
export {
  CANONICAL_SE_PATTERN,
  CLAUSE_TOKEN_PATTERN,
  DEFAULT_GRADE,
  asSeCode,
  compareSeCodes,
  formatBareLetter,
  formatClauseQualified,
  formatGradeOmitted,
  isSeCode,
  makeSeCode,
  normalizeClauseToken,
  normalizeSeCode,
  parseSeReference,
  seCodeParts,
  type SeCode,
  type SeCodeParts,
  type SeReference,
} from "./seCode.js";

// ---- Chapter identity ------------------------------------------------------
export {
  CHAPTER_BOSTON,
  CURRICULUM_CHAPTER_IDS,
  UnknownChapterError,
  asCurriculumChapterId,
  isCurriculumChapterId,
  resolveChapterId,
  type CurriculumChapterId,
} from "./chapters.js";

// ---- Mission identity ------------------------------------------------------
export {
  CURRICULUM_MISSION_IDS,
  MISSION_M1,
  MISSION_M2,
  MISSION_M3,
  MISSION_M4,
  MISSION_M5,
  MISSION_M6,
  MISSION_M7,
  MISSION_M8,
  MISSION_M9,
  MISSION_M10,
  MISSION_M11,
  MISSION_M12,
  MISSION_M13,
  MISSION_M14,
  UnknownMissionError,
  asCurriculumMissionId,
  isCurriculumMissionId,
  resolveMissionId,
  type CurriculumMissionId,
} from "./missionIds.js";

// ---- Chapter assessment identity -------------------------------------------
export {
  ASSESSMENT_BOSTON_CAPSTONE,
  CURRICULUM_ASSESSMENT_IDS,
  UnknownAssessmentError,
  asCurriculumAssessmentId,
  isCurriculumAssessmentId,
  resolveAssessmentId,
  type CurriculumAssessmentId,
} from "./assessments.js";

// ---- Registry shapes -------------------------------------------------------
export {
  CONCEPT_ID_PATTERN,
  REPORTING_CATEGORY_NAMES,
  asCurriculumConceptId,
  isCurriculumConceptId,
  type AliasForm,
  type AliasTarget,
  type ChapterTier,
  type ConceptAlias,
  type ConceptOwner,
  type ConceptReviewStatus,
  type ConceptSurface,
  type ConceptTier,
  type CurriculumConceptId,
  type DesignationStatus,
  type InstructionalConcept,
  type ItemConceptEvidence,
  type ItemConceptMapping,
  type ItemEvidenceWeight,
  type ItemMappingStatus,
  type MissionSlot,
  type ParentSeStatus,
  type Recurrence,
  type ReportingCategory,
  type SeClause,
  type SeProvenance,
  type StandardType,
  type StudentExpectation,
  type TextStatus,
  type UnresolvedDisposition,
} from "./types.js";

// ---- Student expectations ---------------------------------------------------
export {
  ALL_STUDENT_EXPECTATIONS,
  BOSTON_ERA_WINDOW,
  OTHER_CHAPTER_HINTS,
  STUDENT_EXPECTATIONS,
  getStudentExpectation,
  isTargetSe,
} from "./seRegistry.js";

// ---- Instructional concepts ------------------------------------------------
export {
  ALL_CONCEPTS,
  CONCEPTS,
  bostonConceptId,
  conceptsForMission,
  conceptsForSe,
  getConcept,
} from "./conceptRegistry.js";

// ---- Aliases ---------------------------------------------------------------
export {
  ALIASES,
  ALIAS_INDEX,
  aliasesForConcept,
  aliasesForSe,
  lookupAlias,
  unresolvedAliases,
} from "./aliases.js";

// ---- Resolution ------------------------------------------------------------
export {
  CurriculumReferenceError,
  macroConceptForClause,
  requireConcept,
  requireSe,
  resolveConcept,
  resolveSe,
  retag,
  type ConceptResolution,
  type ConceptResolutionFailure,
  type ConceptResolutionPath,
  type SeResolution,
} from "./resolve.js";

// ---- Items -----------------------------------------------------------------
export {
  ITEM_INDEX,
  ITEM_MAPPINGS,
  conceptItemDepth,
  conceptsForItem,
  eraOverlapsWindow,
  itemsForConcept,
  parseEraRange,
  type ConceptItemDepth,
  type EraRange,
} from "./items.js";

// ---- Missions --------------------------------------------------------------
export {
  ALL_MISSIONS,
  M1_STABLE_MISSION_ID,
  MISSIONS,
  getMission,
} from "./missions.js";

// ---- Recorded source defects ------------------------------------------------
export {
  DEFECTS_BY_OWNER,
  SOURCE_DEFECTS,
  defectsForSe,
  type DefectKind,
  type DefectOwner,
  type SourceDefect,
} from "./sourceDefects.js";

// ---- Validation ------------------------------------------------------------
export {
  missionReadiness,
  validateCurriculum,
  type Finding,
  type FindingCode,
  type MissionReadiness,
  type Severity,
  type ValidationOptions,
  type ValidationReport,
  type ValidationSummary,
} from "./validate.js";
