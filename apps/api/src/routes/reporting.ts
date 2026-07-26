// The educator surface. Until now the mastery data had no way out of the system.
//
// THREE READS, AND NOTHING ELSE. Reporting is read-only by construction: there is
// no route here that writes a score, an override, or a grant, because every one of
// those belongs to a system that already owns it (grading owns verdicts,
// progression owns mastery, and roster provisioning owns access). A reporting
// endpoint that could write is a second path to the numbers it reports.
//
//   GET /v1/profiles/:profileId/reporting/chapters/:chapterId
//   GET /v1/educator/reporting/chapters/:chapterId/roster
//   GET /v1/educator/reporting/chapters/:chapterId/export
//
// THE ROUTE OWNS THE SQL; @pa/reporting OWNS EVERY JUDGEMENT. Nothing below
// decides whether a concept is mastered, whether a gap is the student's or ours,
// or who may read what. It reads rows, hands them over, and serialises what comes
// back. That is the same division @pa/assessment draws with the progression store,
// and it is what stops a route arriving at a different answer than a replay would.
//
// WHY THE SERVICE IS STILL INJECTED NOW THAT THE DEPENDENCY EXISTS.
// `apps/api/package.json` declares `@pa/reporting`, so this file could import the
// service type directly — and deliberately does not. The narrow port keeps the
// route testable without the package and keeps the assignability check at the one
// wiring line in `app.ts`, which is where a drift between the SQL this file writes
// and the shapes that package reads should surface. `reportingService()` satisfies
// `ReportingPort` structurally.
//
// THESE ROUTES WERE UNMOUNTED UNTIL `report_access_audit` EXISTED, and that was
// not caution for its own sake. Two of the three endpoints serve a minor's
// academic record to somebody who is not that minor. Mounting them before the
// table would have opened a read path over children's grades whose only trace was
// an application log line — unqueryable, unretained, and gone with the log group.
// Migration 008 creates the table; this file now REFUSES an authorised read it
// cannot audit rather than serving it unrecorded. See `recordAudit`.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
// The one thing this file imports from @pa/reporting rather than taking through
// the port. It is a predicate over an identifier, not a judgement about a
// student: there is no report model in it to drift from, and nothing a test
// would want to substitute — a fixture chapter that the registry does not hold
// is exactly the 404 below. `chapterConceptIds` stays on the port because it
// answers with content.
import { isCurriculumChapterId } from "@pa/reporting";
import { getSessionUser } from "../auth.js";
import { query } from "../db.js";

const SESSION_COOKIE = "pa_session";
const STABLE_ID = /^[A-Za-z0-9._:-]{1,160}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * One page of students. A roster larger than this is a query, not a class, and
 * it is REFUSED rather than truncated: a teacher shown the first two hundred of
 * three hundred students has a page that is silently wrong about who needs help,
 * which is worse than a page that says it cannot be drawn.
 */
const MAX_ROSTER = 200;

// ---------------------------------------------------------------------------
// The port onto @pa/reporting
//
// The row shapes are the route's own, because the route wrote the SELECT that
// produces them. The payloads come back as `unknown` on purpose: this file
// serialises them and has no business knowing their shape, so the report model
// can grow without touching the API.
// ---------------------------------------------------------------------------

export interface ReportSubjectInput {
  readonly profileId: string;
  readonly displayName: string | null;
  readonly districtStudentRef: string | null;
}

export interface AttemptRowInput {
  readonly attemptId: string;
  readonly attemptOrdinal: number;
  readonly scopedConceptIds: readonly string[];
  readonly status: "IN_PROGRESS" | "SUBMITTED" | "ABANDONED";
  readonly scoreNumerator: number | null;
  readonly scoreDenominator: number | null;
  readonly startedAt: string;
  readonly submittedAt: string | null;
}

export interface MasteryRowInput {
  readonly conceptId: string;
  readonly itemsServed: number;
  readonly itemsCorrect: number;
  readonly firstAttemptServed: number;
  readonly firstAttemptCorrect: number;
  readonly masteredAt: string | null;
}

export interface StudentRowsInput {
  readonly subject: ReportSubjectInput;
  readonly rows: {
    readonly profileId: string;
    readonly chapterId: string;
    readonly assessmentId: string;
    readonly chapterConceptIds: readonly string[];
    readonly attempts: readonly AttemptRowInput[];
    readonly mastery: readonly MasteryRowInput[];
  };
}

export interface AccessAuditRecord {
  readonly at: string;
  readonly action: string;
  readonly actorAccountId: string | null;
  readonly actorKind: string;
  readonly subjectProfileIds: readonly string[];
  readonly outcome: "ALLOWED" | "REFUSED";
  readonly refusal: string | null;
  readonly persist: boolean;
}

export type ViewerInput =
  | { readonly kind: "ANONYMOUS" }
  | { readonly kind: "STUDENT"; readonly accountId: string; readonly profileId: string }
  | {
      readonly kind: "EDUCATOR";
      readonly accountId: string;
      readonly grantedProfileIds: readonly string[];
    };

export interface ReportingPort {
  chapterConceptIds(chapterId: string): readonly string[];
  authoriseStudentReport(input: {
    readonly viewer: ViewerInput;
    readonly subjectProfileId: string;
    readonly at: string;
  }):
    | {
        readonly kind: "ALLOWED";
        readonly view: "SELF" | "EDUCATOR";
        readonly subjectProfileId: string;
        readonly audit: AccessAuditRecord;
      }
    | {
        readonly kind: "REFUSED";
        readonly reason: "AUTHENTICATION_REQUIRED" | "NOT_AUTHORISED";
        readonly audit: AccessAuditRecord;
      };
  authoriseRoster(input: {
    readonly viewer: ViewerInput;
    readonly action?: "ROSTER_READ" | "DISTRICT_EXPORT";
    readonly at: string;
  }):
    | {
        readonly kind: "ALLOWED";
        readonly profileIds: readonly string[];
        readonly audit: AccessAuditRecord;
      }
    | {
        readonly kind: "REFUSED";
        readonly reason: "AUTHENTICATION_REQUIRED" | "NOT_AUTHORISED";
        readonly audit: AccessAuditRecord;
      };
  studentReport(input: {
    readonly student: StudentRowsInput;
    readonly view: "SELF" | "EDUCATOR";
    readonly generatedAt: string;
  }): unknown;
  roster(input: {
    readonly chapterId: string;
    readonly students: readonly StudentRowsInput[];
    readonly authorisedProfileIds: readonly string[];
    readonly generatedAt: string;
  }): unknown;
  export(input: {
    readonly chapterId: string;
    readonly students: readonly StudentRowsInput[];
    readonly authorisedProfileIds: readonly string[];
    readonly format: "JSON" | "STUDENT_SUMMARY_CSV" | "STANDARD_EVIDENCE_CSV";
    readonly identityMode: "PSEUDONYMOUS" | "NAMED";
    readonly generatedAt: string;
  }): {
    readonly filename: string;
    readonly contentType: string;
    readonly body: string;
  };
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Resolve the caller into a viewer the reporting model can reason about.
 *
 * The educator's roster is READ FROM THE GRANT TABLE, never from the request.
 * An endpoint that accepted a profile list would be an enumeration oracle over
 * profile ids, and profile ids appear in URLs. A role alone grants nothing —
 * ADMIN included — because `educator_profile_access` is the grant and a role is
 * only permission to hold one.
 */
async function resolveViewer(request: FastifyRequest): Promise<ViewerInput> {
  const user = await getSessionUser(request.cookies[SESSION_COOKIE]);
  if (!user) return { kind: "ANONYMOUS" };

  const grants = await query<{ profile_id: string }>(
    `select access.profile_id
       from account_roles roles
       join educator_profile_access access
         on access.educator_account_id = roles.account_id
      where roles.account_id = $1
        and roles.role in ('EDUCATOR', 'ADMIN')
      order by access.profile_id
      limit $2`,
    // One more than the ceiling, so an over-large roster is detectable rather
    // than arriving already truncated.
    [user.accountId, MAX_ROSTER + 1],
  );
  if (grants.rowCount) {
    return {
      kind: "EDUCATOR",
      accountId: user.accountId,
      grantedProfileIds: grants.rows.map((row) => row.profile_id),
    };
  }
  return {
    kind: "STUDENT",
    accountId: user.accountId,
    profileId: user.profileId,
  };
}

/**
 * Persist an access audit. Returns false when it could not be written.
 *
 * THE CALLER MUST NOT SERVE A RECORD ON false. `report_access_audit` (migration
 * 008) is the only reason these routes are mounted at all, so an authorised read
 * of somebody else's record that cannot be audited is REFUSED rather than served
 * unrecorded. That is the whole trade: a teacher occasionally seeing a 503 during
 * a database problem, against a class's grades being read with no record of it.
 *
 * A REFUSED decision is different and is allowed through: the caller is about to
 * receive 401 or 403 either way, so failing the request would turn an audit
 * outage into a slightly different error message and nothing else. The lost
 * signal is logged at error level, because a refused read is the one worth
 * alerting on.
 *
 * `persist` is false for exactly one case — a student reading their own record —
 * and logging every child's own page turn would be surveillance rather than
 * accountability. See @pa/reporting's authorisation.ts, rule 6.
 */
async function recordAudit(
  request: FastifyRequest,
  audit: AccessAuditRecord,
): Promise<boolean> {
  if (!audit.persist) return true;
  try {
    await query(
      `insert into report_access_audit(
         actor_account_id, actor_kind, action, subject_profile_ids, outcome, refusal
       ) values ($1,$2,$3,$4::jsonb,$5,$6)`,
      [
        audit.actorAccountId,
        audit.actorKind,
        audit.action,
        JSON.stringify(audit.subjectProfileIds),
        audit.outcome,
        audit.refusal,
      ],
    );
    return true;
  } catch (cause) {
    request.log.error(
      { cause, reportAccess: audit },
      "report_access_audit could not be written",
    );
    return false;
  }
}

/**
 * The refusal for an authorised read whose audit row could not be written.
 *
 * 503 rather than 500: nothing about the request was wrong, and the same request
 * will work once the database will accept the audit row.
 */
function unaudited(reply: FastifyReply): FastifyReply {
  return reply.code(503).send({
    error: "AUDIT_UNAVAILABLE",
    message:
      "this report was not served because the access could not be recorded",
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

interface AttemptDbRow {
  profile_id: string;
  id: string;
  assessment_id: string;
  attempt_ordinal: number;
  scoped_concept_ids: string[] | null;
  status: "IN_PROGRESS" | "SUBMITTED" | "ABANDONED";
  score_numerator: number | null;
  score_denominator: number | null;
  started_at: string | Date;
  submitted_at: string | Date | null;
}

interface MasteryDbRow {
  profile_id: string;
  concept_id: string;
  items_served: number;
  items_correct: number;
  first_attempt_served: number;
  first_attempt_correct: number;
  mastered_at: string | Date | null;
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function isoOrNull(value: string | Date | null): string | null {
  return value === null ? null : iso(value);
}

function groupBy<T extends { profile_id: string }>(
  rows: readonly T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.profile_id) ?? [];
    bucket.push(row);
    grouped.set(row.profile_id, bucket);
  }
  return grouped;
}

/**
 * Assemble one chapter's capstone rows for a set of students.
 *
 * Three queries regardless of roster size, because a roster of thirty students
 * rendered with a query per student is a page nobody opens twice.
 *
 * A student with no attempts still gets an entry, built from the registry's
 * concept list. Omitting them would quietly turn "has not sat the capstone" into
 * "is not in this class", and the first row of the triage order is exactly the
 * student who has not started.
 *
 * CALL `unknownChapter` FIRST. `chapterConceptIds` throws for a chapter the
 * registry does not hold, so an unchecked id out of a URL reaches here and
 * becomes a 500.
 */
async function readStudents(
  profileIds: readonly string[],
  chapterId: string,
  reporting: ReportingPort,
): Promise<StudentRowsInput[]> {
  if (profileIds.length === 0) return [];
  const chapterConceptIds = reporting.chapterConceptIds(chapterId);

  const [profiles, attempts, mastery] = await Promise.all([
    query<{ id: string; display_name: string }>(
      "select id, display_name from profiles where id = any($1::uuid[]) order by display_name, id",
      [profileIds],
    ),
    query<AttemptDbRow>(
      `select profile_id, id, assessment_id, attempt_ordinal, scoped_concept_ids,
              status, score_numerator, score_denominator, started_at, submitted_at
         from chapter_assessment_attempts
        where profile_id = any($1::uuid[]) and chapter_id = $2
        order by profile_id, attempt_ordinal`,
      [profileIds, chapterId],
    ),
    query<MasteryDbRow>(
      `select profile_id, concept_id, items_served, items_correct,
              first_attempt_served, first_attempt_correct, mastered_at
         from concept_mastery
        where profile_id = any($1::uuid[]) and chapter_id = $2`,
      [profileIds, chapterId],
    ),
  ]);

  const attemptsByProfile = groupBy(attempts.rows);
  const masteryByProfile = groupBy(mastery.rows);

  return profiles.rows.map((profile) => {
    const studentAttempts = attemptsByProfile.get(profile.id) ?? [];
    return {
      subject: {
        profileId: profile.id,
        displayName: profile.display_name,
        // No column holds a district identifier yet; see the schema request.
        // Null rather than a stand-in, so an export falls back to the opaque
        // profile id instead of shipping something a district cannot join on.
        districtStudentRef: null,
      },
      rows: {
        profileId: profile.id,
        chapterId,
        assessmentId: studentAttempts[0]?.assessment_id ?? "",
        chapterConceptIds,
        attempts: studentAttempts.map((row) => ({
          attemptId: row.id,
          attemptOrdinal: row.attempt_ordinal,
          scopedConceptIds: row.scoped_concept_ids ?? [],
          status: row.status,
          scoreNumerator: row.score_numerator,
          scoreDenominator: row.score_denominator,
          startedAt: iso(row.started_at),
          submittedAt: isoOrNull(row.submitted_at),
        })),
        mastery: (masteryByProfile.get(profile.id) ?? []).map((row) => ({
          conceptId: row.concept_id,
          itemsServed: row.items_served,
          itemsCorrect: row.items_correct,
          firstAttemptServed: row.first_attempt_served,
          firstAttemptCorrect: row.first_attempt_correct,
          masteredAt: isoOrNull(row.mastered_at),
        })),
      },
    };
  });
}

/**
 * Refuse a chapter id the curriculum registry does not hold.
 *
 * THE SHAPE REGEX IS NOT A CHECK THAT THE CHAPTER EXISTS, and the difference
 * used to cost nothing: a chapter-keyed lookup answered an unknown key with an
 * empty list, so a typo in a URL rendered a roster on which thirty students owed
 * nothing. That silence is now a throw, which is the right default — but a route
 * whose id came out of a URL must not let it become a 500 for what is an ordinary
 * client mistake. So the id is checked here and answered 404.
 *
 * 404 rather than 400: the id is well formed, it just names no chapter. A
 * SUPERSEDED spelling is refused too, because no database row carries one — a
 * request naming it is asking for a chapter nobody is in.
 *
 * Checked before the viewer is resolved, alongside the shape guard, because it
 * discloses nothing: the chapter list is public and ships in the client bundle.
 * Nothing about a student's record is reachable from the answer.
 */
function unknownChapter(reply: FastifyReply, chapterId: string): FastifyReply | null {
  if (isCurriculumChapterId(chapterId)) return null;
  return reply.code(404).send({
    error: "CHAPTER_NOT_FOUND",
    message: `no chapter is registered under ${JSON.stringify(chapterId)}`,
  });
}

function rosterTooLarge(
  reply: FastifyReply,
  profileIds: readonly string[],
): FastifyReply | null {
  if (profileIds.length <= MAX_ROSTER) return null;
  return reply.code(413).send({
    error: "ROSTER_TOO_LARGE",
    message: `this account holds access to more than ${MAX_ROSTER} students; ` +
      "narrow it to a class section before requesting a roster",
  });
}

function refuse(
  reply: FastifyReply,
  reason: "AUTHENTICATION_REQUIRED" | "NOT_AUTHORISED",
): FastifyReply {
  // 403 for both halves of NOT_AUTHORISED. "Not yours" and "does not exist" are
  // deliberately the same answer, so a caller cannot probe profile ids.
  return reply
    .code(reason === "AUTHENTICATION_REQUIRED" ? 401 : 403)
    .send({ error: reason });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function registerReportingRoutes(
  app: FastifyInstance,
  reporting: ReportingPort,
): Promise<void> {
  // -- one student, for that student or for an educator who holds a grant -----
  app.get<{ Params: { profileId: string; chapterId: string } }>(
    "/v1/profiles/:profileId/reporting/chapters/:chapterId",
    async (request, reply) => {
      const { profileId, chapterId } = request.params;
      if (!UUID.test(profileId) || !STABLE_ID.test(chapterId)) {
        return reply.code(400).send({ error: "BAD_REQUEST" });
      }
      const unknown = unknownChapter(reply, chapterId);
      if (unknown) return unknown;
      const at = new Date().toISOString();
      const access = reporting.authoriseStudentReport({
        viewer: await resolveViewer(request),
        subjectProfileId: profileId,
        at,
      });
      const audited = await recordAudit(request, access.audit);
      if (access.kind === "REFUSED") return refuse(reply, access.reason);
      if (!audited) return unaudited(reply);

      const students = await readStudents([profileId], chapterId, reporting);
      const student = students[0];
      // An authorised subject with no profile row is not a 404 worth
      // distinguishing: it is the same information as "not yours".
      if (!student) return refuse(reply, "NOT_AUTHORISED");

      return {
        report: reporting.studentReport({
          student,
          view: access.view,
          generatedAt: at,
        }),
      };
    },
  );

  // -- the roster: the primary teacher surface --------------------------------
  app.get<{ Params: { chapterId: string } }>(
    "/v1/educator/reporting/chapters/:chapterId/roster",
    async (request, reply) => {
      const { chapterId } = request.params;
      if (!STABLE_ID.test(chapterId)) {
        return reply.code(400).send({ error: "BAD_REQUEST" });
      }
      const unknown = unknownChapter(reply, chapterId);
      if (unknown) return unknown;
      const at = new Date().toISOString();
      const access = reporting.authoriseRoster({
        viewer: await resolveViewer(request),
        at,
      });
      const audited = await recordAudit(request, access.audit);
      if (access.kind === "REFUSED") return refuse(reply, access.reason);
      if (!audited) return unaudited(reply);
      const oversized = rosterTooLarge(reply, access.profileIds);
      if (oversized) return oversized;

      const students = await readStudents(access.profileIds, chapterId, reporting);
      return {
        roster: reporting.roster({
          chapterId,
          students,
          authorisedProfileIds: access.profileIds,
          generatedAt: at,
        }),
      };
    },
  );

  // -- the district export ----------------------------------------------------
  app.get<{
    Params: { chapterId: string };
    Querystring: { format?: string; identity?: string };
  }>(
    "/v1/educator/reporting/chapters/:chapterId/export",
    async (request, reply) => {
      const { chapterId } = request.params;
      if (!STABLE_ID.test(chapterId)) {
        return reply.code(400).send({ error: "BAD_REQUEST" });
      }
      const unknown = unknownChapter(reply, chapterId);
      if (unknown) return unknown;
      const format =
        request.query.format === "json"
          ? "JSON"
          : request.query.format === "standards"
            ? "STANDARD_EVIDENCE_CSV"
            : request.query.format === undefined ||
                request.query.format === "students"
              ? "STUDENT_SUMMARY_CSV"
              : null;
      if (format === null) return reply.code(400).send({ error: "BAD_REQUEST" });
      // Pseudonymous unless the caller asks otherwise, and asking is recorded.
      const identityMode =
        request.query.identity === "named" ? "NAMED" : "PSEUDONYMOUS";

      const at = new Date().toISOString();
      const access = reporting.authoriseRoster({
        viewer: await resolveViewer(request),
        action: "DISTRICT_EXPORT",
        at,
      });
      const audited = await recordAudit(request, access.audit);
      if (access.kind === "REFUSED") return refuse(reply, access.reason);
      if (!audited) return unaudited(reply);
      const oversized = rosterTooLarge(reply, access.profileIds);
      if (oversized) return oversized;

      const students = await readStudents(access.profileIds, chapterId, reporting);
      const document = reporting.export({
        chapterId,
        students,
        authorisedProfileIds: access.profileIds,
        format,
        identityMode,
        generatedAt: at,
      });

      reply.header("content-type", document.contentType);
      reply.header(
        "content-disposition",
        `attachment; filename="${document.filename}"`,
      );
      // A student record is never a cacheable public document.
      reply.header("cache-control", "no-store");
      return reply.send(document.body);
    },
  );
}
