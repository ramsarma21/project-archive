import type {
  CampaignProgression,
  ChapterAbilityUnlock,
  ChapterAssessmentAttempt,
  ChapterAssessmentResponse,
  ChapterProgression,
  CodexCardState,
  ConceptMastery,
  LearningModuleCompletion,
  MissionAttempt,
  MissionProgress,
  ProgressionLedgerEntry,
  ProgressionSnapshot,
  PvpAbilityUnlock,
} from "@pa/contracts";

/**
 * Reads and writes inside one serialized progression transaction. The store
 * takes a per-profile row lock before handing this out, so a service method
 * can read state, derive the next state, and write it without a second writer
 * interleaving — which is what stops two concurrent "open attempt" calls from
 * both claiming attempt 1 and its full XP.
 */
/**
 * Every lookup below that names a mission, a module gate, a concept or an
 * assessment is scoped by chapter. Mission ids are chapter-local slugs (M1..M14,
 * and the next chapter mints its own M1) and a concept can be assessed again in
 * a later chapter, so a chapter-blind read would answer with another chapter's
 * row.
 */
/**
 * How good the evidence behind one mastered concept is.
 *
 * A SECOND PARAMETER RATHER THAN FIELDS ON `ConceptMastery`, because that type is
 * `@pa/contracts`' and is read by the web client's projection; these two values
 * are educator-facing evidence quality and nothing on the student's screen has a
 * use for them. Required rather than optional for the same reason
 * `putMissionAttempt` takes its commit log as a parameter: a disclosure that can
 * be omitted is a disclosure that will be.
 *
 * NULL MEANS NOT RECORDED AND IS NEVER TO BE COERCED TO false. `false` on
 * `masteredWithRecycledItems` is a claim — that the student demonstrated the
 * concept on questions they had never seen — and @pa/reporting reports the
 * absence rather than fabricating a strengthening of the exact disclosure the
 * field exists to weaken.
 */
export interface ConceptMasteryDisclosure {
  /** The attempt ordinal whose form reached 100%, or null when not mastered. */
  readonly masteredOnAttempt: number | null;
  /** Whether the mastering form repeated an already-served item. */
  readonly masteredWithRecycledItems: boolean | null;
}

/** What a served form recorded about one concept, beyond which items it drew. */
export interface FormConceptDisclosure {
  readonly conceptId: string;
  /**
   * FRESH when every served item was one this profile had never seen. The
   * server's own selection refuses to recycle — `selectFreshItems` reporting
   * exhaustion fails the open with ASSESSMENT_ITEMS_EXHAUSTED — so FRESH is a
   * recorded fact here rather than an assumption, and the day recycling is
   * introduced this is where it becomes visible.
   */
  readonly freshness: "FRESH" | "PARTIAL_RECYCLE" | "FULL_RECYCLE";
  /**
   * Which served items were prose. Committed rather than looked up, because an
   * item's format is part of what the student was asked, and "was this form
   * passable by guessing" is a question a district can reasonably ask of the
   * record alone.
   */
  readonly openResponseItemIds: readonly string[];
}

/** Whether one recorded answer's verdict wants a human. The grader's flag. */
export interface ResponseReviewFlag {
  readonly verdictNeedsReview: boolean;
}

/**
 * The `form` as it is STORED: the contract's shape plus the two disclosure fields
 * @pa/reporting needs and `ChapterAssessmentAttempt` has no room for.
 *
 * Additive by design, and shared by both store implementations so the in-memory
 * one cannot answer `formConceptFreshness` differently from the real one. A read
 * casts the stored value straight back to the contract's narrower type, so the
 * extra fields ride along at runtime and are invisible to every consumer that
 * does not go looking for them.
 */
export function serialisedForm(
  form: ChapterAssessmentAttempt["form"],
  disclosure: readonly FormConceptDisclosure[],
): readonly Record<string, unknown>[] {
  const byConcept = new Map(disclosure.map((entry) => [entry.conceptId, entry]));
  return form.map((entry) => {
    const extra = byConcept.get(entry.conceptId);
    return {
      conceptId: entry.conceptId,
      itemIds: [...entry.itemIds],
      // Absent rather than guessed when the caller had nothing to say, so a
      // reader can still tell "fresh" from "not recorded".
      ...(extra
        ? {
            freshness: extra.freshness,
            openResponseItemIds: [...extra.openResponseItemIds],
          }
        : {}),
    };
  });
}

/**
 * The recorded freshness of one concept's slice of a stored form.
 *
 * Reads the stored value rather than assuming FRESH, so the answer stays right
 * both for rows written before migration 008 — null, meaning not recorded — and
 * for the day the selection starts recycling.
 */
export function formConceptFreshness(
  form: ChapterAssessmentAttempt["form"],
  conceptId: string,
): FormConceptDisclosure["freshness"] | null {
  for (const entry of form as readonly Record<string, unknown>[]) {
    if (entry.conceptId !== conceptId) continue;
    const freshness = entry.freshness;
    return freshness === "FRESH" ||
      freshness === "PARTIAL_RECYCLE" ||
      freshness === "FULL_RECYCLE"
      ? freshness
      : null;
  }
  return null;
}

export interface ProgressionTx {
  campaign(): Promise<CampaignProgression | null>;
  chapter(chapterId: string): Promise<ChapterProgression | null>;
  mission(chapterId: string, missionId: string): Promise<MissionProgress | null>;
  liveMissionAttempt(
    chapterId: string,
    missionId: string,
  ): Promise<MissionAttempt | null>;
  /**
   * The profile's ONE open mission attempt, whatever chapter or mission it is on.
   *
   * There is exactly one live attempt per profile, not one per mission: a reload
   * must not be able to open a second run just because it is on a different
   * route. Read inside the per-profile advisory-locked transaction, so two opens
   * racing on two mission ids still converge on a single open attempt.
   */
  liveMissionAttemptForProfile(): Promise<MissionAttempt | null>;
  missionAttempt(attemptId: string): Promise<MissionAttempt | null>;
  moduleCompletion(
    chapterId: string,
    gatesKind: LearningModuleCompletion["gatesKind"],
    gatesId: string,
    gatesOrdinal: number,
  ): Promise<LearningModuleCompletion | null>;
  conceptMastery(chapterId: string): Promise<ConceptMastery[]>;
  codexCard(cardId: string): Promise<CodexCardState | null>;
  assessmentAttempt(attemptId: string): Promise<ChapterAssessmentAttempt | null>;
  liveAssessmentAttempt(
    chapterId: string,
    assessmentId: string,
  ): Promise<ChapterAssessmentAttempt | null>;
  assessmentAttemptCount(chapterId: string, assessmentId: string): Promise<number>;
  assessmentResponses(attemptId: string): Promise<ChapterAssessmentResponse[]>;
  servedItemIds(
    chapterId: string,
    assessmentId: string,
    conceptId: string,
  ): Promise<string[]>;

  putCampaign(campaign: CampaignProgression): Promise<void>;
  putChapter(chapter: ChapterProgression): Promise<void>;
  putMission(mission: MissionProgress): Promise<void>;
  putModuleCompletion(completion: LearningModuleCompletion): Promise<void>;
  insertMissionAttempt(attempt: MissionAttempt): Promise<void>;
  /**
   * Rewrite an attempt row, together with the duel's serialised commit log.
   *
   * THE LOG IS A REQUIRED ARGUMENT, and that is the fix rather than an accident
   * of taste. The insert wrote `'[]'::jsonb` and nothing ever updated it, so a
   * client that carried its verdicts all the way to the commit had them accepted
   * by the request guard and then silently discarded — a failure that presents as
   * success, and one deterministic replay depends on. A separate `putCommitLog`
   * would be the same bug with a longer name; a parameter of the terminal write
   * cannot be forgotten.
   *
   * It is TELEMETRY. Nothing is derived from it — not the outcome, not the award,
   * and above all not a bullet count — which is precisely why @pa/contracts
   * exempts this one field's CONTENTS from the server-authoritative guard while
   * still refusing a `verdict` key beside it. It carries no answer text either:
   * @pa/duel's `mintVerdict` has no parameter for one.
   */
  putMissionAttempt(
    attempt: MissionAttempt,
    committedEvents: readonly unknown[],
  ): Promise<void>;
  /**
   * Delete every attempt row for one mission of this profile, and return how many
   * were removed.
   *
   * DEV-RESET SUPPORT, AND DELIBERATELY NARROW. It frees the attempt ordinals
   * (1..3) so a fresh attempt one can be opened again, and it is paired with a
   * `mission_progress` reset by the service. It touches ONLY `mission_attempts`:
   * `learning_module_completions` is a separate table and is never deleted here,
   * because the boss duel refuses to grade unless the attempt it is bound to has a
   * satisfied module gate — so wiping the gate would lock the player out of the
   * very run a reset exists to let them replay.
   */
  deleteMissionAttempts(chapterId: string, missionId: string): Promise<number>;
  putConceptMastery(
    mastery: ConceptMastery,
    disclosure: ConceptMasteryDisclosure,
  ): Promise<void>;
  /** Learned in single-player. Never touches PvP legality. */
  learnCodexCard(card: Omit<CodexCardState, "pvpLegalAt" | "updatedAt">): Promise<void>;
  /** Mints PvP legality for already-learned cards of a mastered concept. */
  markCodexCardsPvpLegal(input: {
    conceptId: string;
    attemptId: string;
    at: string;
  }): Promise<string[]>;
  unlockChapterAbility(unlock: ChapterAbilityUnlock): Promise<void>;
  unlockPvpAbility(unlock: PvpAbilityUnlock): Promise<void>;
  insertAssessmentAttempt(
    attempt: ChapterAssessmentAttempt,
    formDisclosure: readonly FormConceptDisclosure[],
  ): Promise<void>;
  putAssessmentAttempt(attempt: ChapterAssessmentAttempt): Promise<void>;
  putAssessmentResponse(
    response: ChapterAssessmentResponse,
    review: ResponseReviewFlag,
  ): Promise<void>;
  recordItemExposures(input: {
    chapterId: string;
    assessmentId: string;
    attemptId: string;
    attemptOrdinal: number;
    conceptId: string;
    itemIds: readonly string[];
    at: string;
  }): Promise<void>;
  appendLedger(entries: readonly ProgressionLedgerEntry[]): Promise<void>;
}

export interface ProgressionStore {
  /** Runs `fn` under a per-profile lock. Rolls back on any thrown error. */
  transact<T>(profileId: string, fn: (tx: ProgressionTx) => Promise<T>): Promise<T>;
  snapshot(profileId: string): Promise<ProgressionSnapshot | null>;
}
