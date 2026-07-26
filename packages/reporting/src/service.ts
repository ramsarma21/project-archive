// The composed surface the API route injects.
//
// Everything above this file is pure and takes no database. This one composes it
// into the four calls a route actually makes, and it is the seam where the
// scope check is enforced on the DATA rather than on the request: `roster` and
// `export` both run `assertWithinScope` over the records they were handed, so a
// query that returned one row too many throws here instead of rendering.
//
// The route owns the SQL because the route owns the database; this package owns
// every judgement. That division is the same one @pa/assessment draws, and it is
// what stops a route arriving at a different answer than a replay would.

import {
  assertWithinScope,
  authoriseRoster,
  authoriseStudentReport,
  type AuthoriseRosterInput,
  type AuthoriseStudentReportInput,
  type RosterAccess,
  type StudentReportAccess,
} from "./authorisation.js";
import {
  registryChapterConceptIds,
  registryStandardsSource,
  type StandardsSource,
} from "./curriculum.js";
import {
  districtExport,
  type ExportFormat,
  type ExportIdentityMode,
  type ExportedDocument,
} from "./export.js";
import { buildRosterView, type RosterView } from "./roster.js";
import { evidenceFromDurableRows, type DurableCapstoneRows } from "./source.js";
import {
  buildStudentChapterReport,
  studentSelfView,
  type ReportSubject,
  type StudentChapterReport,
} from "./student.js";

export interface StudentEvidenceInput {
  readonly subject: ReportSubject;
  readonly rows: DurableCapstoneRows;
}

export interface ReportingService {
  /**
   * The chapter's concept list, read from the curriculum registry.
   *
   * The route needs it before it can build `DurableCapstoneRows`, and it must not
   * derive it from the student's own rows: a concept nobody could ask has no row,
   * and it is the one the report most needs to name.
   *
   * THROWS `UnknownChapterError` for a chapter the registry does not hold. The
   * route reads its chapter id out of a URL, so it should check
   * `isCurriculumChapterId` and answer 404 rather than catch this — but a throw
   * is the right default either way, because the alternative answer is an empty
   * concept list, and an empty concept list renders as a roster on which nobody
   * owes anything.
   */
  chapterConceptIds(chapterId: string): readonly string[];
  authoriseStudentReport(input: AuthoriseStudentReportInput): StudentReportAccess;
  authoriseRoster(input: AuthoriseRosterInput): RosterAccess;
  studentReport(input: {
    readonly student: StudentEvidenceInput;
    readonly view: "SELF" | "EDUCATOR";
    readonly generatedAt: string;
  }): StudentChapterReport;
  roster(input: {
    readonly chapterId: string;
    readonly students: readonly StudentEvidenceInput[];
    readonly authorisedProfileIds: readonly string[];
    readonly generatedAt: string;
  }): RosterView;
  export(input: {
    readonly chapterId: string;
    readonly students: readonly StudentEvidenceInput[];
    readonly authorisedProfileIds: readonly string[];
    readonly format: ExportFormat;
    readonly identityMode: ExportIdentityMode;
    readonly generatedAt: string;
  }): ExportedDocument;
}

export function reportingService(
  options: {
    readonly standards?: StandardsSource;
    /**
     * Override the registry lookup. For a fixture chapter only.
     *
     * NOT a place to translate a chapter key. `apps/api/src/app.ts` used to pass
     * one that rewrote the runtime id into the registry's old authoring spelling,
     * which was a symptom fix for the registry disagreeing with the database; the
     * registry keys Boston `boston-1765` like everything else now, and that
     * translation has been deleted. `reportingService()` takes no override.
     */
    readonly chapterConcepts?: (chapterId: string) => readonly string[];
  } = {},
): ReportingService {
  const standards = options.standards ?? registryStandardsSource();
  const chapterConcepts = options.chapterConcepts ?? registryChapterConceptIds;

  const build = (
    student: StudentEvidenceInput,
    generatedAt: string,
  ): StudentChapterReport =>
    buildStudentChapterReport({
      subject: student.subject,
      evidence: evidenceFromDurableRows(student.rows),
      standards,
      generatedAt,
    });

  return {
    chapterConceptIds: chapterConcepts,
    authoriseStudentReport,
    authoriseRoster,

    studentReport: ({ student, view, generatedAt }) => {
      const report = build(student, generatedAt);
      return view === "SELF" ? studentSelfView(report) : report;
    },

    roster: ({ chapterId, students, authorisedProfileIds, generatedAt }) => {
      assertWithinScope(
        students.map((student) => student.subject.profileId),
        authorisedProfileIds,
      );
      return buildRosterView({
        chapterId,
        reports: students.map((student) => build(student, generatedAt)),
        generatedAt,
      });
    },

    export: ({
      chapterId,
      students,
      authorisedProfileIds,
      format,
      identityMode,
      generatedAt,
    }) => {
      assertWithinScope(
        students.map((student) => student.subject.profileId),
        authorisedProfileIds,
      );
      const reports = students.map((student) => build(student, generatedAt));
      return districtExport({
        chapterId,
        reports,
        roster: buildRosterView({ chapterId, reports, generatedAt }),
        identityMode,
        format,
        generatedAt,
      });
    },
  };
}
