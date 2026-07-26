// The single import surface onto @pa/assessment. No other file here names that
// dependency, so if the capstone engine moves, exactly one file breaks.
//
// THIS PACKAGE DOES NOT RE-DERIVE ANYTHING THE ENGINE ALREADY DECIDED. Whether a
// concept is mastered, which attempt is the reported measure, whether a form
// recycled items, and whether the chapter unlocks are all answers @pa/assessment
// produces from the event log. Reporting reads them, groups them for a reader,
// and adds nothing. A report that computed mastery a second way would eventually
// disagree with the gate, and the gate is the one a student experiences.
//
// The one thing reporting does add is a VOCABULARY SPLIT the engine deliberately
// left as a single enum: `ConceptReportStatus` puts NOT_MASTERED and
// NOT_ASSESSED_CONTENT_GAP in the same field, which is correct for an engine and
// wrong for a teacher. See evidence.ts.

export { REPORTED_ATTEMPT_ORDINAL, chapterReportKey } from "@pa/assessment";

export type {
  AttemptReportRow,
  ChapterAssessmentReport,
  ConceptReportRow,
  ConceptReportStatus,
  ConceptScore,
  MasteryNow,
  ProvenanceRollup,
  ReportedScore,
  UnlockDecision,
} from "@pa/assessment";
