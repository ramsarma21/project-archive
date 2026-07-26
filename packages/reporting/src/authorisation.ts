// Who may see what. Stated, not assumed.
//
// These are minors' academic records. The failure modes are not abstract: a
// thirteen-year-old seeing a classmate's mastery row is a disclosure the school
// has to report, and an educator account reaching a student they do not teach is
// the same disclosure at scale. So the model is written down here as code rather
// than living as a `requireOwner` call the next route forgets to make.
//
// ============================================================================
// THE MODEL, IN SEVEN RULES
//
// 1. AUTHENTICATION IS NECESSARY AND NEVER SUFFICIENT. A valid session says which
//    account is calling. It says nothing about which records that account may
//    read, and every function here takes the session's identity as an INPUT to a
//    decision rather than as the decision.
//
// 2. A STUDENT SEES EXACTLY THEIR OWN RECORD. Not a roster, not a class average,
//    not a rank, not a distribution their own score sits inside. A class median
//    over four students is a re-identification vector, and there is no product
//    reason a student needs one. `ReportViewer` of kind STUDENT can only ever
//    produce an ALLOWED decision whose subject is their own profile id.
//
// 3. AN EDUCATOR SEES EXACTLY THE PROFILES THEY HOLD AN EXPLICIT GRANT FOR. Not
//    every profile in the tenant, not every profile in a chapter, and not every
//    profile because they hold a role. `educator_profile_access` already models
//    this as one row per (educator, student) pair, and ADMIN is deliberately not
//    a wildcard over it — an administrator with no grant reads nothing, which is
//    the correct default for a role that exists to configure a system rather than
//    to read children's records.
//
// 4. THE ROSTER IS DERIVED FROM THE GRANT SET; THE REQUEST NEVER NAMES THE
//    STUDENTS. This is the load-bearing one. A roster endpoint that accepted a
//    list of profile ids would be an enumeration oracle: a caller could probe ids
//    and learn from the response which ones exist and which ones they are close
//    to. `EDUCATOR` cannot be constructed without `grantedProfileIds`, and
//    `authoriseRoster` returns that set rather than filtering a supplied one, so
//    there is no parameter through which a client could widen the scope.
//
// 5. REFUSALS ARE UNIFORM. "That student is not yours" and "that student does not
//    exist" are the same answer, `NOT_AUTHORISED`, with the same status code.
//    Distinguishing them is a membership oracle over profile ids, and profile ids
//    appear in URLs.
//
// 6. EVERY READ OF SOMEBODY ELSE'S RECORD IS AUDITABLE. Each decision carries a
//    `ReportAccessAudit` the caller persists — including refusals, because a
//    refused read is the one worth alerting on. A student reading their own
//    record is not audited by default; logging every child's own page turn is
//    surveillance rather than accountability.
//
// 7. NO STUDENT-AUTHORED CONTENT CROSSES A BOUNDARY, BECAUSE NONE OF IT IS HERE.
//    Nothing in this package's types can hold prose a student wrote: the capstone
//    engine keeps open responses behind an opaque `responseRef`, and reporting
//    carries item ids, option-free counts, and statuses. So even a roster shown on
//    a projector cannot leak one student's writing to another. The prose path has
//    its own encryption, retention and audit trail in `open_responses`, and this
//    package deliberately does not touch it.
//
// ============================================================================

/** The suppression floor for aggregates that leave the teacher's own roster. */
export const MIN_AGGREGATE_COHORT = 5;

export type ReportViewer =
  | { readonly kind: "ANONYMOUS" }
  | {
      readonly kind: "STUDENT";
      readonly accountId: string;
      readonly profileId: string;
    }
  | {
      readonly kind: "EDUCATOR";
      readonly accountId: string;
      /**
       * The profiles this educator holds an explicit access grant for. Required,
       * so an educator viewer meaning "everyone" is not expressible.
       */
      readonly grantedProfileIds: readonly string[];
    };

export type AccessRefusal =
  /** No session, or an expired one. */
  | "AUTHENTICATION_REQUIRED"
  /** Not yours, or not there. Deliberately the same answer. */
  | "NOT_AUTHORISED";

export type AccessAction =
  | "STUDENT_REPORT_READ"
  | "ROSTER_READ"
  | "DISTRICT_EXPORT";

export interface ReportAccessAudit {
  readonly at: string;
  readonly action: AccessAction;
  readonly actorAccountId: string | null;
  readonly actorKind: ReportViewer["kind"];
  readonly subjectProfileIds: readonly string[];
  readonly outcome: "ALLOWED" | "REFUSED";
  readonly refusal: AccessRefusal | null;
  /** False for a student reading their own record; see rule 6. */
  readonly persist: boolean;
}

export type StudentReportAccess =
  | {
      readonly kind: "ALLOWED";
      /** SELF gets the narrowed projection; see `studentSelfView`. */
      readonly view: "SELF" | "EDUCATOR";
      readonly subjectProfileId: string;
      readonly audit: ReportAccessAudit;
    }
  | {
      readonly kind: "REFUSED";
      readonly reason: AccessRefusal;
      readonly audit: ReportAccessAudit;
    };

export type RosterAccess =
  | {
      readonly kind: "ALLOWED";
      /** The roster. Derived from the grant set, never from the request. */
      readonly profileIds: readonly string[];
      readonly audit: ReportAccessAudit;
    }
  | {
      readonly kind: "REFUSED";
      readonly reason: AccessRefusal;
      readonly audit: ReportAccessAudit;
    };

function audit(input: {
  action: AccessAction;
  viewer: ReportViewer;
  subjectProfileIds: readonly string[];
  outcome: "ALLOWED" | "REFUSED";
  refusal: AccessRefusal | null;
  persist: boolean;
  at: string;
}): ReportAccessAudit {
  return {
    at: input.at,
    action: input.action,
    actorAccountId:
      input.viewer.kind === "ANONYMOUS" ? null : input.viewer.accountId,
    actorKind: input.viewer.kind,
    subjectProfileIds: [...input.subjectProfileIds],
    outcome: input.outcome,
    refusal: input.refusal,
    persist: input.persist,
  };
}

export interface AuthoriseStudentReportInput {
  readonly viewer: ReportViewer;
  readonly subjectProfileId: string;
  readonly at: string;
}

export function authoriseStudentReport(
  input: AuthoriseStudentReportInput,
): StudentReportAccess {
  const { viewer, subjectProfileId, at } = input;
  const base = {
    action: "STUDENT_REPORT_READ" as const,
    viewer,
    subjectProfileIds: [subjectProfileId],
    at,
  };

  if (viewer.kind === "ANONYMOUS") {
    return {
      kind: "REFUSED",
      reason: "AUTHENTICATION_REQUIRED",
      audit: audit({
        ...base,
        outcome: "REFUSED",
        refusal: "AUTHENTICATION_REQUIRED",
        persist: true,
      }),
    };
  }

  if (viewer.kind === "STUDENT") {
    // A student's only reachable subject is themselves. There is no branch here
    // that could widen with a role, a flag, or a section.
    if (viewer.profileId !== subjectProfileId) {
      return {
        kind: "REFUSED",
        reason: "NOT_AUTHORISED",
        audit: audit({
          ...base,
          outcome: "REFUSED",
          refusal: "NOT_AUTHORISED",
          persist: true,
        }),
      };
    }
    return {
      kind: "ALLOWED",
      view: "SELF",
      subjectProfileId,
      audit: audit({
        ...base,
        outcome: "ALLOWED",
        refusal: null,
        persist: false,
      }),
    };
  }

  if (!viewer.grantedProfileIds.includes(subjectProfileId)) {
    return {
      kind: "REFUSED",
      reason: "NOT_AUTHORISED",
      audit: audit({
        ...base,
        outcome: "REFUSED",
        refusal: "NOT_AUTHORISED",
        persist: true,
      }),
    };
  }
  return {
    kind: "ALLOWED",
    view: "EDUCATOR",
    subjectProfileId,
    audit: audit({ ...base, outcome: "ALLOWED", refusal: null, persist: true }),
  };
}

export interface AuthoriseRosterInput {
  readonly viewer: ReportViewer;
  readonly action?: AccessAction;
  readonly at: string;
}

/**
 * The roster a viewer may see.
 *
 * Takes no candidate list. An educator with an empty grant set is ALLOWED an
 * empty roster rather than refused — they are a legitimate educator who has not
 * been assigned students, and refusing them would be indistinguishable from
 * refusing an impostor.
 */
export function authoriseRoster(input: AuthoriseRosterInput): RosterAccess {
  const { viewer, at } = input;
  const action = input.action ?? "ROSTER_READ";

  if (viewer.kind === "ANONYMOUS") {
    return {
      kind: "REFUSED",
      reason: "AUTHENTICATION_REQUIRED",
      audit: audit({
        action,
        viewer,
        subjectProfileIds: [],
        outcome: "REFUSED",
        refusal: "AUTHENTICATION_REQUIRED",
        persist: true,
        at,
      }),
    };
  }
  if (viewer.kind === "STUDENT") {
    // Rule 2. A student has no roster, not even one of size one — a page shaped
    // like a class list is a page that will grow a class list.
    return {
      kind: "REFUSED",
      reason: "NOT_AUTHORISED",
      audit: audit({
        action,
        viewer,
        subjectProfileIds: [],
        outcome: "REFUSED",
        refusal: "NOT_AUTHORISED",
        persist: true,
        at,
      }),
    };
  }
  return {
    kind: "ALLOWED",
    profileIds: [...viewer.grantedProfileIds],
    audit: audit({
      action,
      viewer,
      subjectProfileIds: viewer.grantedProfileIds,
      outcome: "ALLOWED",
      refusal: null,
      persist: true,
      at,
    }),
  };
}

/**
 * Refuse to assemble a page from records outside the authorised set.
 *
 * A second check after the first, on the data rather than on the request, and it
 * throws rather than filtering. A record that reached this point unauthorised did
 * so because a query was wrong, and quietly dropping it would leave the bug in
 * place until the day the filter is the thing that is wrong.
 */
export function assertWithinScope(
  profileIds: readonly string[],
  authorised: readonly string[],
): void {
  const allowed = new Set(authorised);
  for (const profileId of profileIds) {
    if (!allowed.has(profileId)) {
      throw new Error(
        "report set contains a profile outside the authorised roster",
      );
    }
  }
}

/** Whether an aggregate over this many students may leave the roster context. */
export function cohortIsReportable(students: number): boolean {
  return students >= MIN_AGGREGATE_COHORT;
}
