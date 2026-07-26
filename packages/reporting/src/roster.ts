// The roster: thirty students, five minutes, one screen.
//
// THIS IS THE PRIMARY ARTIFACT AND IT IS A DIFFERENT THING FROM AN AUDIT TRAIL.
// The per-student report (student.ts) answers "what happened with this child";
// the roster answers "which children do I open, and what do I teach tomorrow".
// A teacher with a free period between classes will read this one and nothing
// else, so every decision below is about what survives a five-second scan.
//
// FOUR DECISIONS MAKE IT SCANNABLE.
//
// 1. TRIAGE ORDER, NOT ALPHABETICAL ORDER. Rows sort by who needs help, most
//    outstanding concepts first. Alphabetical is the default everywhere and it is
//    the wrong default here: it distributes the six students who need attention
//    evenly through thirty rows, so the teacher has to read all thirty. Sorted by
//    need, the answer is the top of the list and the rest is confirmation. The
//    order is fully deterministic — status, then need, then the weaker first
//    sitting, then name — so the same class produces the same page twice.
//
// 2. THE CLASS-LEVEL NEED LIST COLLAPSES THIRTY ROWS INTO THREE ACTIONS.
//    `conceptsNeededByClass` counts how many students still owe each concept.
//    Eleven students missing "no taxation without representation" is one
//    reteach, not eleven interventions, and that is the single most useful thing
//    this page can say. It is computed before the rows and is the FIRST thing a
//    reader should see.
//
// 3. EACH ROW NAMES AT MOST THREE CONCEPTS, ORDERED BY CLASS FREQUENCY. A cell
//    with twelve concept names in it is a cell nobody reads. Capping at three is
//    obvious; ordering those three by how many classmates share them is the part
//    that matters, because it makes the whole-class action and the individual
//    rows line up — the concept at the top of the class list is the concept at
//    the left of most rows.
//
// 4. FLAGS ARE A BOUNDED ENUM, NEVER PROSE. Eight possible flags, each an icon.
//    A free-text note column is a column that becomes unreadable in a month.
//
// AND ONE DECISION ABOUT WHAT THE ROSTER REFUSES TO DO.
//
// `conceptsOutstanding` counts ONLY concepts the student was asked about and did
// not master. Concepts we could not ask are in a separate column,
// `coverageDebtConcepts`, and there is no column that adds the two. A single
// "concepts outstanding: 9" that quietly bundled four item shortages into five
// real gaps would send a teacher to reteach material the student may already
// know, and would hide our own content debt inside a statement about a child.
// The two numbers have different owners and they never share a cell.

import { mergeClaims, type ReportClaim } from "./claim.js";
import {
  CURRENT_STANDING_BASIS,
  CURRENT_STANDING_LABEL,
  FIRST_SITTING_BASIS,
  FIRST_SITTING_LABEL,
  percentOf,
} from "./evidence.js";
import type { StudentChapterReport } from "./student.js";

/** Concepts named inline on a row before the rest become a count. */
export const ROSTER_PRIMARY_NEEDS = 3;

/**
 * NEEDS_HELP     — has sat, and still owes concepts. The reason this page exists.
 * NOT_STARTED    — no submitted attempt. They owe you the sitting, not the work.
 * IN_PROGRESS    — an attempt is open right now.
 * REPAIRED       — everything mastered, but it took retries. Worth knowing.
 * SECURE         — everything mastered on the first sitting.
 * NOT_MEASURABLE — the chapter has no assessable concept for this student. OUR
 *                  failure, surfaced as a status so it cannot read as theirs.
 */
export type RosterStatus =
  | "NEEDS_HELP"
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "REPAIRED"
  | "SECURE"
  | "NOT_MEASURABLE";

const STATUS_ORDER: Readonly<Record<RosterStatus, number>> = {
  NEEDS_HELP: 0,
  NOT_STARTED: 1,
  IN_PROGRESS: 2,
  REPAIRED: 3,
  SECURE: 4,
  NOT_MEASURABLE: 5,
};

/** Eight icons, and no ninth without a conversation. */
export type RosterFlag =
  | "NEVER_SAT"
  | "ATTEMPT_OPEN"
  /** Mastery demonstrated on a repeated item. Weaker evidence. */
  | "RECYCLED_EVIDENCE"
  /** Whether items were recycled is not recorded for this student. */
  | "EVIDENCE_DISCLOSURE_INCOMPLETE"
  | "AWAITING_GRADING_REVIEW"
  | "SCORE_REVISED_BY_REVIEW"
  /** Some chapter concepts could not be asked. Their score is over a subset. */
  | "PARTIAL_CHAPTER_COVERAGE"
  /** They hold it now, but did not hold it first time. The retry did the teaching. */
  | "REPAIRED_NOT_TAUGHT";

export interface RosterNeedRef {
  readonly conceptId: string;
  readonly label: string;
  readonly seCodeBare: string | null;
}

export interface RosterRow {
  readonly profileId: string;
  readonly reportKey: string;
  /** Null when the caller withheld it. A roster the teacher owns carries it. */
  readonly displayName: string | null;
  readonly status: RosterStatus;
  /** Attempt 1 only. See `columns.firstSittingPercent` for what it means. */
  readonly firstSittingPercent: number | null;
  readonly currentMasteryPercent: number;
  /** Asked and not mastered. The student's work list, and nothing else. */
  readonly conceptsOutstanding: number;
  readonly primaryNeeds: readonly RosterNeedRef[];
  readonly additionalNeedCount: number;
  /** Never asked, item shortage. Our backlog. A separate column, always. */
  readonly coverageDebtConcepts: number;
  readonly attemptsUsed: number;
  readonly flags: readonly RosterFlag[];
}

export interface ClassConceptNeed {
  readonly conceptId: string;
  readonly label: string;
  readonly seCode: string | null;
  readonly seCodeBare: string | null;
  readonly studentsOutstanding: number;
  readonly shareOfClassPercent: number;
  readonly profileIds: readonly string[];
}

export interface RosterSummary {
  readonly students: number;
  readonly needsHelp: number;
  readonly notStarted: number;
  readonly inProgress: number;
  readonly repaired: number;
  readonly secure: number;
  readonly notMeasurable: number;
  readonly studentsWithFirstSitting: number;
  /** Median rather than mean: one student who never sat should not move it. */
  readonly medianFirstSittingPercent: number | null;
}

export interface RosterCoverage {
  readonly conceptsInChapter: number;
  /** Concepts at least one student could not be asked. Our backlog, class-wide. */
  readonly conceptsWithCoverageDebt: number;
  readonly coverageDebtConceptIds: readonly string[];
  /**
   * False when any student's score is over a subset of the chapter. When false,
   * no percentage on this page is a chapter percentage.
   */
  readonly scoresCoverWholeChapter: boolean;
}

/** The column legend. Labels live in the header so cells can hold bare numbers. */
export interface RosterColumnLegend {
  readonly firstSittingPercent: { readonly label: string; readonly basis: string };
  readonly currentMasteryPercent: { readonly label: string; readonly basis: string };
  readonly conceptsOutstanding: { readonly label: string; readonly basis: string };
  readonly coverageDebtConcepts: { readonly label: string; readonly basis: string };
}

export const ROSTER_COLUMNS: RosterColumnLegend = {
  firstSittingPercent: {
    label: FIRST_SITTING_LABEL,
    basis: FIRST_SITTING_BASIS,
  },
  currentMasteryPercent: {
    label: CURRENT_STANDING_LABEL,
    basis: CURRENT_STANDING_BASIS,
  },
  conceptsOutstanding: {
    label: "Concepts still owed",
    basis:
      "Concepts this student was asked about and has not yet demonstrated. " +
      "Concepts we could not ask are counted separately and are never included " +
      "here.",
  },
  coverageDebtConcepts: {
    label: "Concepts we could not ask",
    basis:
      "Concepts whose item pool is too small to build one form. The student was " +
      "never asked, so this is our content backlog and not a gap in their " +
      "learning. It is never scored against them.",
  },
};

export interface RosterView {
  readonly chapterId: string;
  readonly generatedAt: string;
  /** Read this first: the whole-class teaching action. */
  readonly conceptsNeededByClass: readonly ClassConceptNeed[];
  readonly summary: RosterSummary;
  readonly coverage: RosterCoverage;
  readonly columns: RosterColumnLegend;
  /** Triage order. Deterministic. */
  readonly rows: readonly RosterRow[];
  readonly claim: ReportClaim;
}

export interface BuildRosterInput {
  readonly chapterId: string;
  readonly reports: readonly StudentChapterReport[];
  readonly generatedAt: string;
}

function statusOf(report: StudentChapterReport): RosterStatus {
  if (report.currentStanding.conceptsRequired === 0) return "NOT_MEASURABLE";
  if (report.attempts.some((attempt) => attempt.status === "IN_PROGRESS")) {
    return "IN_PROGRESS";
  }
  if (!report.attempts.some((attempt) => attempt.status === "SUBMITTED")) {
    return "NOT_STARTED";
  }
  if (report.currentStanding.outstandingConceptIds.length > 0) return "NEEDS_HELP";
  return report.currentStanding.repairedConceptIds.length > 0
    ? "REPAIRED"
    : "SECURE";
}

function flagsOf(report: StudentChapterReport, status: RosterStatus): RosterFlag[] {
  const flags: RosterFlag[] = [];
  if (status === "NOT_STARTED") flags.push("NEVER_SAT");
  if (status === "IN_PROGRESS") flags.push("ATTEMPT_OPEN");
  if (report.byConcept.some((row) => row.evidenceStrength === "RECYCLED_ITEMS")) {
    flags.push("RECYCLED_EVIDENCE");
  }
  if (report.byConcept.some((row) => row.evidenceStrength === "NOT_RECORDED")) {
    flags.push("EVIDENCE_DISCLOSURE_INCOMPLETE");
  }
  if (report.itemsAwaitingGradingReview.length > 0) {
    flags.push("AWAITING_GRADING_REVIEW");
  }
  if (report.firstSitting?.revisedByReview) flags.push("SCORE_REVISED_BY_REVIEW");
  if (report.evidence.coverageDebt > 0) flags.push("PARTIAL_CHAPTER_COVERAGE");
  if (report.repair.interpretation === "TAUGHT_BY_THE_RETRY") {
    flags.push("REPAIRED_NOT_TAUGHT");
  }
  return flags;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return Math.round(
    (((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2),
  );
}

export function buildRosterView(input: BuildRosterInput): RosterView {
  const { chapterId, reports, generatedAt } = input;

  // The same refusal @pa/assessment's `teacherReportSet` makes, for the same
  // reason: a duplicate key means two records claim to be the same student's
  // record for the same chapter, and silently keeping one is how evidence
  // disappears. A roster spanning two chapters is the same bug wearing a hat.
  const seen = new Set<string>();
  for (const report of reports) {
    if (report.chapterId !== chapterId) {
      throw new Error(
        `roster is for ${chapterId} but a report is for ${report.chapterId}`,
      );
    }
    if (seen.has(report.reportKey)) {
      throw new Error(
        `two reports for the same profile and chapter: ${report.reportKey}`,
      );
    }
    seen.add(report.reportKey);
  }

  // The class-level need list, computed first because the rows order their own
  // needs by it.
  const needs = new Map<
    string,
    { label: string; seCode: string | null; seCodeBare: string | null; profileIds: string[] }
  >();
  for (const report of reports) {
    for (const row of report.byConcept) {
      if (row.outcome !== "NOT_YET_MASTERED") continue;
      const entry = needs.get(row.conceptId) ?? {
        label: row.label,
        seCode: row.standard?.seCode ?? null,
        seCodeBare: row.standard?.seCodeBare ?? null,
        profileIds: [],
      };
      entry.profileIds.push(report.profileId);
      needs.set(row.conceptId, entry);
    }
  }

  const conceptsNeededByClass: ClassConceptNeed[] = [...needs.entries()]
    .map(([conceptId, entry]) => ({
      conceptId,
      label: entry.label,
      seCode: entry.seCode,
      seCodeBare: entry.seCodeBare,
      studentsOutstanding: entry.profileIds.length,
      shareOfClassPercent: percentOf(entry.profileIds.length, reports.length),
      profileIds: entry.profileIds,
    }))
    .sort(
      (left, right) =>
        right.studentsOutstanding - left.studentsOutstanding ||
        left.conceptId.localeCompare(right.conceptId),
    );

  const needRank = new Map(
    conceptsNeededByClass.map((need, index) => [need.conceptId, index]),
  );

  const rows: RosterRow[] = reports.map((report) => {
    const status = statusOf(report);
    const outstanding = report.byConcept
      .filter((row) => row.outcome === "NOT_YET_MASTERED")
      .sort(
        (left, right) =>
          (needRank.get(left.conceptId) ?? Number.MAX_SAFE_INTEGER) -
          (needRank.get(right.conceptId) ?? Number.MAX_SAFE_INTEGER),
      );
    return {
      profileId: report.profileId,
      reportKey: report.reportKey,
      displayName: report.subject.displayName,
      status,
      firstSittingPercent: report.firstSitting?.percent ?? null,
      currentMasteryPercent: report.currentStanding.percent,
      conceptsOutstanding: report.evidence.studentGaps,
      primaryNeeds: outstanding.slice(0, ROSTER_PRIMARY_NEEDS).map((row) => ({
        conceptId: row.conceptId,
        label: row.label,
        seCodeBare: row.standard?.seCodeBare ?? null,
      })),
      additionalNeedCount: Math.max(0, outstanding.length - ROSTER_PRIMARY_NEEDS),
      coverageDebtConcepts: report.evidence.coverageDebt,
      attemptsUsed: report.currentStanding.attemptsUsed,
      flags: flagsOf(report, status),
    };
  });

  rows.sort(
    (left, right) =>
      STATUS_ORDER[left.status] - STATUS_ORDER[right.status] ||
      right.conceptsOutstanding - left.conceptsOutstanding ||
      (left.firstSittingPercent ?? 101) - (right.firstSittingPercent ?? 101) ||
      (left.displayName ?? "").localeCompare(right.displayName ?? "") ||
      left.profileId.localeCompare(right.profileId),
  );

  const coverageDebtConceptIds = [
    ...new Set(reports.flatMap((report) => [...report.coverageDebtConceptIds])),
  ].sort();
  const conceptsInChapter = Math.max(
    0,
    ...reports.map((report) => report.evidence.conceptsInChapter),
  );
  const firstSittings = rows
    .map((row) => row.firstSittingPercent)
    .filter((percent): percent is number => percent !== null);

  const countStatus = (status: RosterStatus): number =>
    rows.filter((row) => row.status === status).length;

  return {
    chapterId,
    generatedAt,
    conceptsNeededByClass,
    summary: {
      students: rows.length,
      needsHelp: countStatus("NEEDS_HELP"),
      notStarted: countStatus("NOT_STARTED"),
      inProgress: countStatus("IN_PROGRESS"),
      repaired: countStatus("REPAIRED"),
      secure: countStatus("SECURE"),
      notMeasurable: countStatus("NOT_MEASURABLE"),
      studentsWithFirstSitting: firstSittings.length,
      medianFirstSittingPercent: median(firstSittings),
    },
    coverage: {
      conceptsInChapter,
      conceptsWithCoverageDebt: coverageDebtConceptIds.length,
      coverageDebtConceptIds,
      scoresCoverWholeChapter: coverageDebtConceptIds.length === 0,
    },
    columns: ROSTER_COLUMNS,
    rows,
    claim: mergeClaims(reports.map((report) => report.claim)),
  };
}
