// Test fixtures and a driver that sits the capstone.
//
// The driver exists because every interesting test is a sequence of whole
// attempts — sit, fail some concepts, retake the module, sit the narrowed retry —
// and writing that out inline would bury the assertion. `sit` runs one complete
// attempt through the real gate, the real selection, the real grading port and the
// real reducer, so a test that passes here passes against the actual composition
// rather than against a mock of it.
//
// The fixture chapter uses `TST.CONCEPT.*` ids, which satisfy the canonical
// concept-id pattern without colliding with the Boston registry. That is
// deliberate: it proves the engine is data-driven over any chapter, and
// `bostonRegistry.test.ts` separately proves it composes with the real one.

import {
  asCurriculumConceptId,
  assessmentGateDecision,
  buildItemBank,
  compileBlueprint,
  mintAssessmentVerdict,
  openAttempt,
  recordResponse,
  reduceAssessment,
  staticConceptSource,
  submitAttempt,
  type AssessableConcept,
  type AssessmentEvent,
  type AssessmentGateDecision,
  type AssessmentItemDescriptor,
  type ChapterAssessmentBlueprint,
  type ChapterAssessmentRecord,
  type ConceptSource,
  type CurriculumConceptId,
  type GradingAuthority,
  type GradingResult,
  type ItemBank,
  type ItemProbe,
  type ItemSubmission,
} from "../index.js";
import type { LearningModuleCompletion } from "../protocol.js";

export const CHAPTER = "CHAPTER.TEST";
export const ASSESSMENT_ID = "TST.CAPSTONE.v1";
export const MODULE_ID = "TST.MODULE.CAPSTONE.v1";
export const PROFILE_ID = "11111111-2222-4333-8444-555555555555";

/** Options on every fixture item. Four, so a wrong answer has somewhere to go. */
export const OPTION_IDS = ["A", "B", "C", "D"] as const;

export function conceptId(slug: string): CurriculumConceptId {
  return asCurriculumConceptId(`TST.CONCEPT.${slug}.v1`);
}

/**
 * A deterministic attempt id that is a real UUID.
 *
 * Contracts stores `attemptId` as `z.string().uuid()`, so a readable
 * `attempt-1` would pass the typecheck and then fail the INSERT.
 * `contractAlignment.test.ts` is what caught that, which is the point of it.
 */
export function attemptUuid(ordinal: number): string {
  return `00000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;
}

export function cardIdFor(slug: string): string {
  return `TST.CARD.${slug}.v1`;
}

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

export interface FixtureSpec {
  /** Concept slugs, in blueprint order. */
  readonly slugs: readonly string[];
  /** Eligible items per concept. A number applies to all; a map overrides. */
  readonly reserve: number | Readonly<Record<string, number>>;
  readonly itemsPerConcept?: number;
  readonly reserveTargetPerConcept?: number;
  /** Slugs whose FIRST item is open response instead of selected response. */
  readonly openResponseSlugs?: readonly string[];
  /**
   * How many of a concept's items are open response, counted from the first.
   * Overrides `openResponseSlugs` where both name a slug.
   */
  readonly openResponseCount?: number | Readonly<Record<string, number>>;
  /**
   * Open-response items required on every form. Defaults to 0 for fixtures, NOT
   * to the production `OPEN_RESPONSE_PER_FORM`: most tests here are about
   * mastery, retries and exhaustion, and forcing a prose item into every fixture
   * form would quietly make each of them a test of the quota as well.
   * `guessResistance.test.ts` exercises the real default.
   */
  readonly openResponsePerForm?: number;
  /**
   * Probe stances, assigned to a concept's items in order and cycled. Defaults to
   * none, which leaves every item UNSPECIFIED.
   */
  readonly probes?: readonly ItemProbe[];
  /** Slugs whose FIRST item carries released-TEA provenance. */
  readonly releasedTeaSlugs?: readonly string[];
  /** Slugs with no Codex card at all. Legal, and worth testing. */
  readonly cardlessSlugs?: readonly string[];
  /** Slugs whose items are all refused as unusable. */
  readonly unusableSlugs?: readonly string[];
}

export interface Fixture {
  readonly blueprint: ChapterAssessmentBlueprint;
  readonly concepts: ConceptSource;
  readonly bank: ItemBank;
  readonly authority: GradingAuthority;
  readonly conceptIds: readonly CurriculumConceptId[];
  /** The answer key, held OUTSIDE the item descriptors. See grading.ts. */
  readonly answerKey: ReadonlyMap<string, string>;
  /** Open-response verdicts by responseRef, standing in for the classifier. */
  readonly openVerdicts: Map<string, "CORRECT" | "INCORRECT">;
}

function reserveFor(spec: FixtureSpec, slug: string): number {
  if (typeof spec.reserve === "number") return spec.reserve;
  return spec.reserve[slug] ?? 0;
}

function openResponseCountFor(spec: FixtureSpec, slug: string): number {
  if (typeof spec.openResponseCount === "number") return spec.openResponseCount;
  if (spec.openResponseCount !== undefined) {
    const explicit = spec.openResponseCount[slug];
    if (explicit !== undefined) return explicit;
  }
  return spec.openResponseSlugs?.includes(slug) === true ? 1 : 0;
}

export function makeFixture(spec: FixtureSpec): Fixture {
  const concepts: AssessableConcept[] = spec.slugs.map((slug) => ({
    conceptId: conceptId(slug),
    label: `Concept ${slug}`,
    codexCardIds: spec.cardlessSlugs?.includes(slug) ? [] : [cardIdFor(slug)],
    tier: "MACRO" as const,
  }));

  const items: AssessmentItemDescriptor[] = [];
  const answerKey = new Map<string, string>();

  for (const slug of spec.slugs) {
    const count = reserveFor(spec, slug);
    for (let i = 0; i < count; i += 1) {
      const itemId = `TST.ITEM.${slug}.${String(i).padStart(2, "0")}`;
      const isOpen = i < openResponseCountFor(spec, slug);
      const isReleased = i === 0 && spec.releasedTeaSlugs?.includes(slug) === true;
      const correct = OPTION_IDS[i % OPTION_IDS.length] as string;
      answerKey.set(itemId, correct);
      items.push({
        itemId,
        itemVersion: "v1",
        conceptId: conceptId(slug),
        format: isOpen ? "OPEN_RESPONSE" : "SELECTED_RESPONSE",
        provenance: isReleased
          ? {
              kind: "RELEASED_TEA",
              publisher: "Texas Education Agency",
              administration: "2019 May",
              testForm: "STAAR Grade 8 Social Studies",
              itemNumberAsPublished: 10 + i,
              teksAsPublished: "8.4(A)",
              reportingCategory: 1,
              sourceUrl: "https://tea.texas.gov/example-form",
              keySourceUrl: "https://tea.texas.gov/example-key",
              strength: "RELEASED_FORM_ITEM",
            }
          : {
              kind: "AUTHORED_STAAR_STYLE",
              authoredIn: "packages/assessment/src/__tests__/harness.ts",
            },
        reviewStatus: isReleased ? "SME_APPROVED" : "DRAFT",
        ...(spec.probes && spec.probes.length > 0
          ? { probe: spec.probes[i % spec.probes.length] as ItemProbe }
          : {}),
        era: "1765",
        stem: isOpen ? null : `Question ${i} about ${slug}?`,
        ...(isOpen ? { prompt: `Explain ${slug}.` } : {}),
        options: isOpen
          ? []
          : OPTION_IDS.map((optionId) => ({
              optionId,
              text: `Option ${optionId} for ${slug} ${i}`,
            })),
        usableAsIs: spec.unusableSlugs?.includes(slug) !== true,
        optionPoolComplete: isOpen ? null : true,
      });
    }
  }

  const openVerdicts = new Map<string, "CORRECT" | "INCORRECT">();
  const conceptSource = staticConceptSource({ [CHAPTER]: concepts });

  return {
    blueprint: compileBlueprint({
      assessmentId: ASSESSMENT_ID,
      chapterId: CHAPTER,
      moduleId: MODULE_ID,
      concepts: conceptSource,
      ...(spec.itemsPerConcept !== undefined
        ? { itemsPerConcept: spec.itemsPerConcept }
        : {}),
      ...(spec.reserveTargetPerConcept !== undefined
        ? { reserveTargetPerConcept: spec.reserveTargetPerConcept }
        : {}),
      openResponsePerForm: spec.openResponsePerForm ?? 0,
    }),
    concepts: conceptSource,
    bank: buildItemBank(items),
    authority: fixtureGradingAuthority(answerKey, openVerdicts),
    conceptIds: concepts.map((concept) => concept.conceptId),
    answerKey,
    openVerdicts,
  };
}

/**
 * A stand-in for `packages/grading`.
 *
 * Selected response is graded from a key table; open response is graded from a
 * map keyed by `responseRef`, which is how the real service will work — it holds
 * the encrypted response and classifies it, and this engine only ever sees the
 * handle.
 */
export function fixtureGradingAuthority(
  answerKey: ReadonlyMap<string, string>,
  openVerdicts: ReadonlyMap<string, "CORRECT" | "INCORRECT">,
): GradingAuthority {
  return {
    async grade(submission: ItemSubmission): Promise<GradingResult> {
      if (submission.kind === "OPEN_RESPONSE") {
        const kind = openVerdicts.get(submission.responseRef);
        if (!kind) {
          return {
            ok: false,
            code: "GRADER_UNAVAILABLE",
            detail: submission.responseRef,
          };
        }
        return {
          ok: true,
          verdict: mintAssessmentVerdict({
            kind,
            itemId: submission.itemId,
            itemVersion: submission.itemVersion,
            source: "CLASSIFIER",
            responseRef: submission.responseRef,
          }),
        };
      }
      const expected = answerKey.get(submission.itemId);
      if (expected === undefined) {
        return { ok: false, code: "NO_KEY_FOR_ITEM", detail: submission.itemId };
      }
      return {
        ok: true,
        verdict: mintAssessmentVerdict({
          kind: submission.selectedOptionId === expected ? "CORRECT" : "INCORRECT",
          itemId: submission.itemId,
          itemVersion: submission.itemVersion,
          source: "ANSWER_KEY",
        }),
      };
    },
  };
}

/** An authority that is always down. For the ungraded-submission path. */
export function brokenGradingAuthority(): GradingAuthority {
  return {
    async grade(): Promise<GradingResult> {
      return { ok: false, code: "GRADER_UNAVAILABLE", detail: "fixture outage" };
    },
  };
}

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

export interface Session {
  readonly fixture: Fixture;
  events: AssessmentEvent[];
  moduleLedger: LearningModuleCompletion[];
  /** Deterministic clock. Every `at` in the log comes from here. */
  tick: number;
  chapterMissionsResolved: boolean;
}

export function newSession(
  fixture: Fixture,
  options: { chapterMissionsResolved?: boolean } = {},
): Session {
  return {
    fixture,
    events: [],
    moduleLedger: [],
    tick: 0,
    chapterMissionsResolved: options.chapterMissionsResolved ?? true,
  };
}

/** Deterministic ISO timestamps, one second apart. */
export function nextAt(session: Session): string {
  session.tick += 1;
  return new Date(Date.UTC(2026, 0, 1, 0, 0, session.tick)).toISOString();
}

export function currentRecord(session: Session): ChapterAssessmentRecord {
  return reduceAssessment(session.events, {
    blueprint: session.fixture.blueprint,
    concepts: session.fixture.concepts,
  });
}

export function decide(session: Session): AssessmentGateDecision {
  return assessmentGateDecision({
    record: currentRecord(session),
    blueprint: session.fixture.blueprint,
    bank: session.fixture.bank,
    moduleLedger: session.moduleLedger,
    chapterMissionsResolved: session.chapterMissionsResolved,
  });
}

/** Complete the module that arms one ordinal. The retry gate's other half. */
export function completeModule(
  session: Session,
  attemptOrdinal: number,
  conceptIds: readonly string[],
): void {
  session.moduleLedger = [
    ...session.moduleLedger,
    {
      profileId: PROFILE_ID,
      chapterId: CHAPTER,
      moduleId: MODULE_ID,
      gatesKind: "ASSESSMENT_ATTEMPT",
      gatesId: ASSESSMENT_ID,
      gatesOrdinal: attemptOrdinal,
      requiredSeconds: 180,
      observedSeconds: 175,
      conceptIds: [...conceptIds],
      completedAt: nextAt(session),
    },
  ];
}

export type AnswerChoice = "CORRECT" | "WRONG" | "SKIP";

export interface AnswerContext {
  readonly itemId: string;
  readonly conceptId: CurriculumConceptId;
  /** Index of the item within its concept's slice of the form. */
  readonly indexInConcept: number;
  readonly attemptOrdinal: number;
}

export type AnswerPolicy = (context: AnswerContext) => AnswerChoice;

/** Every item right. */
export const answerAll: AnswerPolicy = () => "CORRECT";

/** Every item wrong. */
export const answerNone: AnswerPolicy = () => "WRONG";

/** Right on the listed concept slugs, wrong on the rest. */
export function masterOnly(...slugs: readonly string[]): AnswerPolicy {
  const wanted = new Set(slugs.map((slug) => conceptId(slug) as string));
  return (context) => (wanted.has(context.conceptId) ? "CORRECT" : "WRONG");
}

export interface SitResult {
  readonly decision: AssessmentGateDecision;
  readonly attemptId: string | null;
  readonly attemptOrdinal: number | null;
  readonly servedItemIds: readonly string[];
  readonly record: ChapterAssessmentRecord;
}

/**
 * Sit one whole attempt: pass the gate, run the module if it is owed, open the
 * attempt, answer every item by policy, and submit.
 *
 * `autoModule` defaults to true so the ordinary case is one call. A test that is
 * specifically about the module gate sets it false and asserts on the RUN_MODULE
 * decision instead.
 */
export async function sit(
  session: Session,
  policy: AnswerPolicy,
  options: {
    autoModule?: boolean;
    /** Abandon instead of submitting, after answering. */
    abandon?: boolean;
    /** Override the grading authority for this attempt. */
    authority?: GradingAuthority;
    /** Stop after opening; do not answer or submit. */
    openOnly?: boolean;
  } = {},
): Promise<SitResult> {
  const { fixture } = session;
  let decision = decide(session);

  if (decision.kind === "RUN_MODULE" && options.autoModule !== false) {
    completeModule(session, decision.attemptOrdinal, decision.conceptIds);
    decision = decide(session);
  }
  if (decision.kind !== "OPEN_ATTEMPT") {
    return {
      decision,
      attemptId: null,
      attemptOrdinal: null,
      servedItemIds: [],
      record: currentRecord(session),
    };
  }

  const attemptId = attemptUuid(decision.attemptOrdinal);
  const opened = openAttempt({
    clearance: decision,
    blueprint: fixture.blueprint,
    bank: fixture.bank,
    record: currentRecord(session),
    profileId: PROFILE_ID,
    attemptId,
    at: nextAt(session),
  });
  session.events = [...session.events, ...opened.events];

  const servedItemIds = opened.selection.concepts.flatMap(
    (concept) => concept.itemIds,
  );
  if (options.openOnly) {
    return {
      decision,
      attemptId,
      attemptOrdinal: decision.attemptOrdinal,
      servedItemIds,
      record: currentRecord(session),
    };
  }

  const authority = options.authority ?? fixture.authority;
  for (const concept of opened.selection.concepts) {
    for (const [index, itemId] of concept.itemIds.entries()) {
      const choice = policy({
        itemId,
        conceptId: concept.conceptId,
        indexInConcept: index,
        attemptOrdinal: decision.attemptOrdinal,
      });
      if (choice === "SKIP") continue;

      const item = fixture.bank.item(itemId);
      if (!item) continue;
      const submission = buildSubmission(fixture, item, choice);
      const attempt = currentRecord(session).openAttempt;
      if (!attempt) continue;
      const result = await recordResponse({
        attempt,
        submission,
        authority,
        at: nextAt(session),
      });
      session.events = [...session.events, ...result.events];
    }
  }

  const attempt = currentRecord(session).openAttempt;
  if (attempt) {
    if (options.abandon) {
      session.events = [
        ...session.events,
        {
          type: "ATTEMPT_ABANDONED",
          attemptId: attempt.attemptId,
          reason: "WALKED_AWAY",
          at: nextAt(session),
        },
      ];
    } else {
      const submitted = submitAttempt({
        attempt,
        bank: fixture.bank,
        at: nextAt(session),
      });
      if (submitted.ok) {
        session.events = [...session.events, ...submitted.events];
      }
    }
  }

  return {
    decision,
    attemptId,
    attemptOrdinal: decision.attemptOrdinal,
    servedItemIds,
    record: currentRecord(session),
  };
}

/**
 * Turn a CORRECT/WRONG choice into a submission.
 *
 * For an open-response item this registers the intended verdict against a fresh
 * `responseRef` in the fixture's classifier map, which is the same shape as the
 * real flow: the text goes to the service, the service returns a handle, and the
 * engine grades by handle.
 */
function buildSubmission(
  fixture: Fixture,
  item: AssessmentItemDescriptor,
  choice: "CORRECT" | "WRONG",
): ItemSubmission {
  if (item.format === "OPEN_RESPONSE") {
    const responseRef = `resp-${item.itemId}-${fixture.openVerdicts.size}`;
    fixture.openVerdicts.set(responseRef, choice === "CORRECT" ? "CORRECT" : "INCORRECT");
    return {
      kind: "OPEN_RESPONSE",
      itemId: item.itemId,
      itemVersion: item.itemVersion,
      responseRef,
    };
  }
  const correct = fixture.answerKey.get(item.itemId);
  const wrong =
    item.options.find((option) => option.optionId !== correct)?.optionId ?? "Z";
  return {
    kind: "SELECTED_RESPONSE",
    itemId: item.itemId,
    itemVersion: item.itemVersion,
    selectedOptionId: choice === "CORRECT" ? (correct ?? "Z") : wrong,
  };
}

/** Items served for one concept across the whole log, in service order. */
export function servedFor(
  record: ChapterAssessmentRecord,
  slug: string,
): readonly string[] {
  const id = conceptId(slug) as string;
  return (
    record.servedLedger.find((entry) => entry.conceptId === id)?.servedItemIds ?? []
  );
}
