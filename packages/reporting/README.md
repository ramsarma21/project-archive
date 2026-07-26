# @pa/reporting

The teacher- and district-facing mastery report over the chapter capstone.

Headless and pure — no React, no database, no clock — so it runs under
`node --test`, in the browser, and inside the API route without change. The route
owns the SQL; this package owns every judgement.

## What this replaces, and why none of it survived

The mastery reporting that existed described a game that has been deleted.
`MasteryReport` in `@pa/contracts` still carries `exposureCount`,
`exposureTypes`, `understandingSync`, `understandingPassed` and a four-stage
`NOT_STARTED / LEARNING / UNDERSTOOD / MASTERED` ladder — an exposure-and-sync
lifecycle from the old presenter runtime. None of those things happen any more.
Mastery is now all-or-nothing at 100% per concept on one capstone, so a "stage"
between learning and mastered is not a state the system can be in.

Two structural faults came with it, and both are fixed here:

- **It was keyed by profile alone**, so a second chapter's assessment overwrote
  the first and a year of evidence became whatever happened most recently.
  Migration 005 re-keyed the table; this package re-keys the artifact, using
  `@pa/assessment`'s own `chapterReportKey` rather than a second key format, and
  `buildRosterView` throws on a duplicate key exactly as `teacherReportSet` does.
- **There was no educator endpoint at all.** The data had no way out of the
  system. A district evaluates the product on this surface, and it did not exist.

## The four decisions everything else follows from

### 1. The capstone is the only academic evidence

There is no field anywhere in this package for XP, Level, Rank, mission clears,
mission attempts, duel wins or PvP standing. That is a design decision, not a gap.

A mission is three minutes of parkour and a gunfight, it can be failed three times
and the student advances anyway, and how well someone does at it measures reaction
time and controller familiarity. A teacher shown "Level 7, Rank 2" beside a TEKS
standard will read it as achievement — that is what a number in a report means —
and would then be reteaching on the basis of hand-eye coordination. The capstone is
the assessment of record *precisely because* the mission is optional-outcome, and
reporting the optional half as though it were the mandatory half would invert the
whole design.

`reportingExcludesMissionPerformance` in the test suite asserts this against the
serialised payload rather than against this paragraph.

### 2. Two measures, never one, and neither can be mistaken for the other

| | |
|---|---|
| `firstSitting` | What the student held **unaided**, on attempt 1. The academic measure. Retries never move it. |
| `currentStanding` | What they can demonstrate **now**, after any number of retries, each gated on retaking the module. This opens the next chapter and mints PvP-legal cards. |

`@pa/assessment` already keeps these apart as two fields with distinct names. Two
fields is not enough for a report, because a number pulled into a table cell, a
chart or a CSV column loses its field name. So every measure here carries its own
identity:

- a `measure` discriminant (`FIRST_SITTING_UNAIDED` / `CURRENT_AFTER_SUPPORT`),
- a `label` and a `basis` sentence travelling with the number,
- no type in this package with a bare `score` or `percent` at its root,
- and CSV headers spelled `first_sitting_percent_unaided` and
  `current_mastery_percent_after_retries`, which are deliberately ugly because a
  column header is the last place a number's meaning survives a warehouse import.

The **gap between them** is a first-class field. `RepairGap.interpretation` reads
`TAUGHT_BY_THE_CHAPTER` when the student mostly had it first time and
`TAUGHT_BY_THE_RETRY` when they did not — which is a signal about the content as
much as about the student, and it is the thing a teacher can act on that neither
number gives them alone.

### 3. A student gap and an item shortage are different facts with different owners

This is the error the brief called the most damaging one available, and it is also
the likelier one, because a concept whose eligible pool is smaller than one form is
`UNASSESSABLE` — currently most of Boston.

`@pa/assessment` distinguishes `NOT_MASTERED` from `NOT_ASSESSED_CONTENT_GAP`, but
as two values of one enum. That is right for an engine and wrong for a reader: any
UI that groups by "not mastered", and any count called "concepts outstanding",
merges them back together silently. So reporting splits them structurally:

```
ConceptOutcome                 owner     counted in
MASTERED_UNAIDED               NOBODY    masteredUnaided
MASTERED_AFTER_SUPPORT         NOBODY    masteredAfterSupport
NOT_YET_MASTERED               STUDENT   studentGaps      <- the reteach list
NOT_MEASURED_ITEM_SHORTAGE     PRODUCT   coverageDebt     <- our content backlog
NOT_MEASURED_NOT_SAT           STUDENT   notYetSat
```

`outcomeOwner` puts the owner on every row. `EvidenceProfile` counts them into
separate fields, and **there is deliberately no field that adds `studentGaps` and
`coverageDebt`**, because the sum is not a quantity anybody should be shown. The
roster gives them separate columns with separate names. `evidenceProfileIsPartition`
asserts the buckets partition rather than overlap.

At standard level the same rule appears as: **`MET` requires full coverage, not
just full mastery.** A student who mastered the three concepts under 8.4(A) that we
could ask, while the other three had no item pool, reports as
`INSUFFICIENT_EVIDENCE` — not `MET`, and not `NOT_MET` either. We did not find out.

### 4. Everything is keyed by profile *and* chapter

`reportKey` is `@pa/assessment`'s `chapterReportKey(profileId, chapterId)` —
consumed, not reimplemented, so there is one composite key in the system rather
than two that have to be kept in agreement. `buildRosterView` throws on a duplicate
key and on a report from another chapter, rather than taking the last write.

## The roster, and why it is scannable

The roster is the primary artifact. The per-student report is what a teacher opens
*after* the roster tells them which student to open.

A teacher with thirty students and five minutes needs "who, and on what". Four
decisions serve that:

1. **Triage order, not alphabetical.** Rows sort by status, then by most concepts
   outstanding, then by the weaker first sitting, then by name. Alphabetical is the
   default everywhere and it is wrong here: it scatters the six students who need
   attention through thirty rows, so all thirty have to be read. Sorted by need, the
   answer is the top of the page and the rest is confirmation. Fully deterministic.
2. **`conceptsNeededByClass` collapses thirty rows into about three actions.**
   Eleven students missing "no taxation without representation" is one reteach, not
   eleven interventions. It is computed first and is the first thing on the page.
3. **At most three concepts named per row, ordered by class frequency.** Capping is
   obvious; the ordering is the part that matters, because it makes the whole-class
   action and the individual rows line up — the concept at the top of the class list
   sits at the left of most rows.
4. **Flags are a bounded enum of eight, never prose.** A free-text note column is a
   column that is unreadable within a month.

Labels live in `ROSTER_COLUMNS` — the header — so cells can hold bare numbers
without losing their meaning, which is how a real table stays narrow enough to scan.

## Authorisation

Stated as code in `authorisation.ts` rather than left to whichever route remembers
to check. These are minors' academic records; the full argument is in the file
header. The seven rules:

1. **Authentication is necessary and never sufficient.** A session says who is
   calling, not what they may read.
2. **A student sees exactly their own record** — no roster, no class average, no
   distribution their own score sits inside. A median over four students
   re-identifies them.
3. **An educator sees exactly the profiles they hold an explicit grant for.**
   `educator_profile_access` already models this per (educator, student) pair, and
   `ADMIN` is deliberately not a wildcard over it.
4. **The roster is derived from the grant set; the request never names the
   students.** `ReportViewer` of kind `EDUCATOR` cannot be constructed without
   `grantedProfileIds`, and `authoriseRoster` returns that set rather than filtering
   a supplied one — so there is no parameter through which a client could widen the
   scope, and no enumeration oracle over profile ids.
5. **Refusals are uniform.** "Not yours" and "does not exist" are both
   `NOT_AUTHORISED` with the same status code.
6. **Every read of somebody else's record is auditable**, refusals included. A
   student reading their own record is not, because logging a child's own page turn
   is surveillance rather than accountability.
7. **No student-authored content crosses a boundary, because none of it is here.**
   Nothing in these types can hold prose: the capstone engine keeps open responses
   behind an opaque `responseRef`, and this package carries item ids, counts and
   statuses. The prose path keeps its own encryption, retention and audit trail in
   `open_responses`.

`assertWithinScope` re-checks on the data rather than the request before a roster or
an export is assembled, and throws rather than filtering — a record that got that
far unauthorised means a query is wrong, and quietly dropping it leaves the bug in.

`MIN_AGGREGATE_COHORT` is 5 and applies **only to aggregates leaving the teacher's
own roster**. Per-student rows in a district export are never suppressed; the
district is responsible for those students. A class statistic over four of them is
what re-identifies an individual.

## The export

| Form | Shape | Consumer |
|---|---|---|
| `studentSummaryCsv` | one row per student | gradebook / dashboard import |
| `standardEvidenceCsv` | one row per student × concept, with the TEKS columns | assessment warehouse |
| `districtExportJson` | everything, versioned, with the claim block | the human who reads it when the CSV raises a question |

Long format rather than one column per standard, because the concept is the assessed
unit and a wide sheet has to collapse several concepts into one standard cell — the
exact roll-up that has to stay honest. A warehouse can pivot this; it cannot un-pivot
the other one.

Identity is **pseudonymous by default**: the district's own student reference when
the roster provisioned one, an opaque profile id otherwise, never a name or an
email. `NAMED` exists because a district that has not provisioned references has to
join on something, but it is an explicit argument, it is audited, and it appears as a
claim qualifier on the payload. This package never invents an identifier, because one
we minted is one their SIS cannot join on.

`csvText` quotes per RFC 4180 and neutralises spreadsheet formula injection — a cell
beginning `=`, `+`, `-`, `@` or a tab is executed on open by Excel and Sheets, and
this file writes registry content into a document a district opens by double-clicking.

## The claim, attached to the data

A report that is accurate row by row can still mislead as an artifact, and the way it
happens is omission: a district reads `82%` beside `8.4(A) Readiness` and files it as
an assessment result. Nothing in the rows is false.

So `ReportClaim` travels on every student report, every roster and every export, with
machine-readable `qualifiers` a UI can render as badges. `ClaimStrength` has three
values and the top one is `LOCAL_SUMMATIVE_WITH_CAVEATS`. There is deliberately no
value for state-aligned, predictive, or grade-of-record, because two properties put a
permanent ceiling below all three:

- **the administration is unproctored** — nothing establishes the work is the
  student's own;
- **retries are unlimited by design** — correct for a learning gate, and
  disqualifying for a measure of a population.

Both are right for a learning product and both are fatal for accountability. The
honest response is to say so in the payload, not to add a stronger enum value when a
district asks for one.

## Evidence fidelity, and what the database cannot currently answer

`evidenceFromCapstoneReport` takes `@pa/assessment`'s own report — built from the
event log — and loses nothing.

`evidenceFromDurableRows` rebuilds from `chapter_assessment_attempts` and
`concept_mastery`, because **the capstone event log is not durably stored today**:
there is no events table, and the attempt row's `form` column is written without
`freshness` or `openResponseItemIds`. Three disclosures genuinely cannot be
recovered, and every one of them comes back as `null`, never `false`:

| Lost | Why `null` and not `false` |
|---|---|
| `masteredWithRecycledItems` | `false` is a claim — that mastery was shown on unseen questions. Making it from a column we never wrote fabricates a strengthening of the exact disclosure this field exists to weaken. |
| items awaiting grading review | An empty list would read as "all verdicts settled". |
| reported-form provenance | An absent rollup is not "no released items". |

What the projections *can* answer exactly is the distinction that matters most.
Mastery is 100% of the items served in one attempt, so
`first_attempt_correct === first_attempt_served > 0` is unaided mastery with no
inference. And attempt 1 scopes every concept the bank could ask, so a chapter
concept absent from attempt 1's scope was absent because we could not ask it — which
is how item shortage stays separable from a student gap even on the degraded path.

Every rebuilt report carries `fidelity: "REBUILT_FROM_PROJECTIONS"`, the named
`disclosureGaps`, and a `DISCLOSURES_INCOMPLETE` claim qualifier. The schema request
that removes all of this is in the handoff notes.

## Handoff: what another owner has to add

This package and `apps/api/src/routes/reporting.ts` are self-contained. Four things
outside them are needed, and none was touched here because another agent owns each.

### 1. The dependency (`apps/api/package.json`, one line)

```json
"@pa/reporting": "workspace:*",
```

Until it lands, the route takes its service as a parameter through a locally
declared `ReportingPort`. Once it lands, that interface can be deleted and replaced
by `import type { ReportingService } from "@pa/reporting"`.

### 2. The registration (`apps/api/src/app.ts`, two lines)

```ts
import { registerReportingRoutes } from "./routes/reporting.js";
import { reportingService } from "@pa/reporting";

await registerReportingRoutes(app, reportingService());
```

`reportingService()` satisfies `ReportingPort` structurally, so the assignability
check happens at that call — which is the right place for it.

### 3. Schema

**Required, and the report is degraded without it.**

```sql
create table if not exists report_access_audit (
  id bigserial primary key,
  actor_account_id uuid references accounts(id) on delete set null,
  actor_kind text not null check (actor_kind in ('STUDENT','EDUCATOR','ANONYMOUS')),
  action text not null check (action in
    ('STUDENT_REPORT_READ','ROSTER_READ','DISTRICT_EXPORT')),
  subject_profile_ids jsonb not null,
  outcome text not null check (outcome in ('ALLOWED','REFUSED')),
  refusal text,
  created_at timestamptz not null default now()
);
create index if not exists report_access_audit_actor_idx
  on report_access_audit(actor_account_id, created_at desc);
```

Without it, reads of a minor's record by another account are written to the
application log and nowhere else. The route detects the missing table once and
warns rather than failing the request.

**Required to lift the report off the degraded path.** The capstone event log is
not persisted, so three disclosures the engine produces are lost. Either persist
the log (`@pa/assessment` already serialises it, and it is the accountability
surface the architecture calls event-sourced), or add the three columns:

```sql
-- What the attempt row's `form` jsonb drops today. Both are already on
-- FormConceptRecord; persisting them is a projection change, not a model change.
--   form[].freshness              FRESH | PARTIAL_RECYCLE | FULL_RECYCLE
--   form[].openResponseItemIds    which served items were prose

alter table concept_mastery
  add column if not exists mastered_on_attempt integer,
  add column if not exists mastered_with_recycled_items boolean;

alter table chapter_assessment_responses
  add column if not exists verdict_needs_review boolean not null default false;
```

**Wanted, for the export to be ingestible without a manual join.**

```sql
alter table profiles
  add column if not exists district_student_ref text;
create unique index if not exists profiles_district_ref_idx
  on profiles(district_student_ref) where district_student_ref is not null;
```

The export falls back to the opaque profile id, which is safe but forces the
district to build a crosswalk by hand. This package never invents a reference,
because one we minted is one their SIS cannot join on.

**Wanted, for rosters larger than one teacher's whole grant set.** There is no
section model, so an educator's roster is every profile they hold a grant for. The
route refuses above two hundred rather than truncating. Class sections
(`class_sections`, `section_enrollments`) would narrow it, and `RosterView` already
has the shape to carry one.

### 4. Retiring the dead report

`MasteryReport` in `@pa/contracts/src/teks.ts`, `buildMasteryReport` in
`@pa/runtime`, the `mastery_reports` table, and `GET /v1/profiles/:profileId/mastery`
in `app.ts` all describe the deleted exposure-and-sync design. They are replaced by
this package and should retire with the old game rather than sit beside it — two
mastery endpoints returning different models is how the wrong one gets integrated.

## Layout

```
src/assessment.ts     the single import surface onto @pa/assessment
src/curriculum.ts     the single import surface onto @pa/curriculum, plus StandardsSource
src/evidence.ts       the two distinctions: gap vs shortage, first sitting vs now
src/source.ts         the two adapters, and what the degraded one lost
src/standards.ts      the TEKS rollup, where MET requires full coverage
src/student.ts        the per-student report and the student self-view
src/roster.ts         the roster: triage order, class needs, bounded flags
src/authorisation.ts  the seven rules
src/claim.ts          what the data supports, and what it does not
src/export.ts         the district export, CSV and JSON
src/service.ts        the composed surface the API route injects
```

## Running

```bash
pnpm --filter @pa/reporting test
pnpm --filter @pa/reporting typecheck
```

89 tests.

| Test file | What it pins down |
|---|---|
| `evidence.test.ts` | The two measures stay separate under retries and review; the buckets partition; a shortage is never a student gap; no mission field reaches the payload |
| `source.test.ts` | The degraded rebuild recovers unaided mastery and item shortage exactly, and reports every disclosure it lost as null |
| `standards.test.ts` | `MET` requires full coverage; partial coverage is never `NOT_MET`; secondary standards are listed and not counted |
| `roster.test.ts` | Triage order, class-need ordering, the two gap columns never merging, duplicate and cross-chapter keys throwing |
| `authorisation.test.ts` | Every rule above, including the enumeration-oracle and cross-student paths |
| `export.test.ts` | Column naming, formula-injection guarding, pseudonymity, small-cohort suppression, and that no prose or answer key can appear |
| `service.test.ts` | The composed calls the API route makes, and the scope check throwing on an unauthorised record |
| `port.test.ts` | The method names and row shapes `apps/api/src/routes/reporting.ts` depends on |
| `bostonRegistry.test.ts` | Composition with the real curriculum registry, canonical spellings only, and a legacy id reported as unmapped rather than guessed |
