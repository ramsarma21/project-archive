import crypto from "node:crypto";
import {
  ASSESSMENT_ITEMS_PER_CONCEPT,
  LEARNING_MODULE_SECONDS,
  PROGRESSION_MODEL_VERSION,
  STARTING_RANK,
  applyMissionOutcome,
  attemptXpFraction,
  isCodexCardLearned,
  isModuleGateSatisfied,
  levelsToNextRank,
  moduleDeckCovered,
  nextAttemptOrdinal,
  selectFreshItems,
  startChapter,
  summarizeAssessmentForm,
  unmasteredConceptIds,
  xpToNextLevel,
  type AbandonChapterAssessmentRequest,
  type AnswerAssessmentItemRequest,
  type CampaignProgression,
  type ChapterAssessmentAttempt,
  type ChapterProgression,
  type CommitMissionOutcomeRequest,
  type CompleteLearningModuleRequest,
  type GradedAssessmentResponse,
  type LearningModuleCompletion,
  type MissionAttempt,
  type MissionProgress,
  type OpenChapterAssessmentRequest,
  type OpenMissionAttemptRequest,
  type ProgressionDerived,
  type ProgressionError,
  type ProgressionLedgerEntry,
  type ProgressionSnapshot,
} from "@pa/contracts";
import { bytesToHex, deriveAttemptSeed } from "@pa/runtime";
import {
  noOpenResponseVerdicts,
  type OpenResponseGrade,
  type OpenResponseVerdicts,
  type ProgressionContent,
} from "./content.js";
import { formConceptFreshness } from "./store.js";
import type {
  FormConceptDisclosure,
  ProgressionStore,
  ProgressionTx,
} from "./store.js";

// ============================================================================
// Server-authoritative progression.
//
// The client's entire writable vocabulary is: "the module ran this long",
// "open an attempt on this mission", "the run ended, cleared or failed",
// "I picked this option". Everything else — the attempt ordinal, the XP
// fraction, the award, Level, cumulative Levels, Rank, ability unlocks, item
// selection, whether an answer was correct, whether the assessment passed, and
// which Codex cards become PvP-legal — is derived here from committed state
// and authored content, inside a per-profile locked transaction.
// ============================================================================

export type ServiceFailure =
  | { error: ProgressionError }
  | { error: "PACKAGE_MISSING" }
  | { error: "BAD_REQUEST" };

export type ServiceResult<T> = { ok: true; value: T } | ({ ok: false } & ServiceFailure);

function fail(error: ServiceFailure["error"]): { ok: false; error: ServiceFailure["error"] } {
  return { ok: false, error };
}

export interface CommitMissionOutcomeResult {
  attempt: MissionAttempt;
  mission: MissionProgress;
  campaign: CampaignProgression;
  chapter: ChapterProgression;
  awardedXp: number;
  levelsGained: number;
  ranksGained: number;
  unlockedAbilityIds: string[];
  derived: ProgressionDerived;
}

export interface SubmitAssessmentResult {
  attempt: ChapterAssessmentAttempt;
  passed: boolean;
  scoreNumerator: number;
  scoreDenominator: number;
  masteredConceptIds: string[];
  unmasteredConceptIds: string[];
  newlyPvpLegalCardIds: string[];
  /** Always zero. The assessment never pays XP and never moves Rank. */
  awardedXp: 0;
}

export class ProgressionService {
  constructor(
    private readonly store: ProgressionStore,
    private readonly content: ProgressionContent,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = () => crypto.randomUUID(),
    private readonly openResponseVerdicts: OpenResponseVerdicts = noOpenResponseVerdicts(),
  ) {}

  private at(): string {
    return this.now().toISOString();
  }

  private derived(
    campaign: CampaignProgression,
    chapter: ChapterProgression,
  ): ProgressionDerived {
    const curve = this.content.xpCurve(chapter.chapterId);
    return {
      rank: campaign.rank,
      cumulativeLevels: campaign.cumulativeLevels,
      levelsToNextRank: levelsToNextRank(campaign.cumulativeLevels),
      level: chapter.level,
      xp: chapter.xp,
      xpToNextLevel: curve ? xpToNextLevel(curve, chapter.xp) : null,
    };
  }

  /**
   * A new profile starts Level 0, 0 XP, Rank 1 in the first chapter. Created
   * lazily on first read so a profile never needs a progression row minted at
   * signup, and never starts anywhere else.
   */
  private async ensureCampaign(
    tx: ProgressionTx,
    profileId: string,
  ): Promise<{ campaign: CampaignProgression; chapter: ChapterProgression }> {
    const at = this.at();
    let campaign = await tx.campaign();
    if (!campaign) {
      campaign = {
        profileId,
        modelVersion: PROGRESSION_MODEL_VERSION,
        rank: STARTING_RANK,
        cumulativeLevels: 0,
        activeChapterId: this.content.initialChapterId(),
        revision: 0,
        createdAt: at,
        updatedAt: at,
      };
      await tx.putCampaign(campaign);
    }
    let chapter = await tx.chapter(campaign.activeChapterId);
    if (!chapter) {
      const started = startChapter({
        campaign,
        chapterId: campaign.activeChapterId,
        at,
      });
      await tx.putCampaign(started.campaign);
      await tx.putChapter(started.chapter);
      await tx.appendLedger(started.ledger);
      campaign = started.campaign;
      chapter = started.chapter;
    }
    return { campaign, chapter };
  }

  private async missionRow(
    tx: ProgressionTx,
    profileId: string,
    chapterId: string,
    missionId: string,
  ): Promise<MissionProgress> {
    const existing = await tx.mission(chapterId, missionId);
    if (existing) return existing;
    const at = this.at();
    const created: MissionProgress = {
      profileId,
      chapterId,
      missionId,
      attemptsUsed: 0,
      outcome: "UNSTARTED",
      awardedXp: 0,
      clearedOnAttempt: null,
      clearedAt: null,
      failedAt: null,
      updatedAt: at,
    };
    await tx.putMission(created);
    return created;
  }

  /** The full read projection, bootstrapping a brand-new runner if needed. */
  async snapshot(profileId: string): Promise<ProgressionSnapshot> {
    await this.store.transact(profileId, async (tx) => {
      await this.ensureCampaign(tx, profileId);
    });
    const snapshot = await this.store.snapshot(profileId);
    if (!snapshot) throw new Error("PROGRESSION_SNAPSHOT_MISSING");
    return {
      ...snapshot,
      derived: this.derived(snapshot.campaign, snapshot.activeChapter),
    };
  }

  /**
   * The mandatory module. Two things are server-decided: whether the run
   * actually covered the authored deck, and which attempt the completion gates
   * — read from attempts already resolved, so one run can never arm two
   * attempts. Elapsed time is recorded, never enforced.
   */
  async completeLearningModule(
    profileId: string,
    request: CompleteLearningModuleRequest,
  ): Promise<ServiceResult<LearningModuleCompletion>> {
    const deck = this.content.moduleDeckCueIds(request.moduleId);
    if (deck && !moduleDeckCovered(deck, request.acknowledgedCueIds)) {
      return fail("MODULE_REQUIRED");
    }
    return this.store.transact(profileId, async (tx) => {
      const { chapter } = await this.ensureCampaign(tx, profileId);
      if (chapter.chapterId !== request.chapterId || chapter.status !== "ACTIVE") {
        return fail("CHAPTER_NOT_ACTIVE");
      }
      const at = this.at();
      let gatesOrdinal: number;
      let conceptIds: readonly string[];
      if (request.gatesKind === "MISSION_ATTEMPT") {
        const reward = this.content.missionReward(chapter.chapterId, request.gatesId);
        if (!reward || reward.moduleId !== request.moduleId) return fail("PACKAGE_MISSING");
        const mission = await this.missionRow(
          tx,
          profileId,
          chapter.chapterId,
          request.gatesId,
        );
        const ordinal = nextAttemptOrdinal(mission);
        if (ordinal === null) return fail("MISSION_SPENT");
        gatesOrdinal = ordinal;
        conceptIds = reward.conceptIds;
      } else {
        const assessmentId = this.content.assessmentId(chapter.chapterId);
        if (!assessmentId || assessmentId !== request.gatesId) return fail("PACKAGE_MISSING");
        if (this.content.assessmentModuleId(chapter.chapterId) !== request.moduleId) {
          return fail("PACKAGE_MISSING");
        }
        gatesOrdinal =
          (await tx.assessmentAttemptCount(chapter.chapterId, assessmentId)) + 1;
        // A retry's module narrows to the concepts still owed mastery.
        const mastery = new Map(
          (await tx.conceptMastery(chapter.chapterId)).map((row) => [row.conceptId, row]),
        );
        conceptIds = unmasteredConceptIds(
          this.content.chapterConceptIds(chapter.chapterId),
          mastery,
        );
      }

      const completion: LearningModuleCompletion = {
        profileId,
        chapterId: chapter.chapterId,
        moduleId: request.moduleId,
        gatesKind: request.gatesKind,
        gatesId: request.gatesId,
        gatesOrdinal,
        requiredSeconds: LEARNING_MODULE_SECONDS,
        observedSeconds: request.observedSeconds,
        conceptIds: [...conceptIds],
        completedAt: at,
      };
      await tx.putModuleCompletion(completion);

      // A module teaches cards: learned in single-player, NOT PvP-legal. Only
      // 100% concept mastery on the capstone mints PvP legality.
      const ledger: ProgressionLedgerEntry[] = [
        {
          kind: "MODULE_COMPLETED",
          chapterId: chapter.chapterId,
          missionId: request.gatesKind === "MISSION_ATTEMPT" ? request.gatesId : null,
          attemptId: null,
          detail: {
            moduleId: request.moduleId,
            gatesOrdinal,
            acknowledgedCues: request.acknowledgedCueIds.length,
            observedSeconds: request.observedSeconds,
            deckVerified: deck !== null,
          },
        },
      ];
      for (const cardId of this.content.codexCardsForModule(request.moduleId)) {
        const existing = await tx.codexCard(cardId);
        if (existing && isCodexCardLearned(existing)) continue;
        const conceptId = this.content.conceptForCard(cardId);
        if (!conceptId) continue;
        await tx.learnCodexCard({
          profileId,
          cardId,
          conceptId,
          learnedChapterId: chapter.chapterId,
          learnedAt: at,
        });
        ledger.push({
          kind: "CODEX_CARD_LEARNED",
          chapterId: chapter.chapterId,
          missionId: null,
          attemptId: null,
          detail: { cardId, conceptId },
        });
      }
      await tx.appendLedger(ledger);
      return { ok: true as const, value: completion };
    });
  }

  /**
   * Open a mission attempt. The ordinal is assigned here from attempts already
   * resolved — the request cannot carry one — and the XP fraction is stamped on
   * the row at open time, so the payout is fixed before the run is played.
   */
  async openMissionAttempt(
    profileId: string,
    request: OpenMissionAttemptRequest,
    variationRootSeedHex: string,
  ): Promise<ServiceResult<MissionAttempt>> {
    return this.store.transact(profileId, async (tx) => {
      const { chapter } = await this.ensureCampaign(tx, profileId);
      if (chapter.chapterId !== request.chapterId || chapter.status !== "ACTIVE") {
        return fail("CHAPTER_NOT_ACTIVE");
      }
      const reward = this.content.missionReward(chapter.chapterId, request.missionId);
      if (!reward) return fail("PACKAGE_MISSING");
      if (await tx.liveMissionAttempt(chapter.chapterId, request.missionId)) {
        return fail("ATTEMPT_ALREADY_OPEN");
      }
      const mission = await this.missionRow(
        tx,
        profileId,
        chapter.chapterId,
        request.missionId,
      );
      const attemptOrdinal = nextAttemptOrdinal(mission);
      if (attemptOrdinal === null) return fail("MISSION_SPENT");

      // The module gates attempt 1 and every retry alike.
      const completion = await tx.moduleCompletion(
        chapter.chapterId,
        "MISSION_ATTEMPT",
        request.missionId,
        attemptOrdinal,
      );
      if (!completion || !isModuleGateSatisfied({ completion, attemptOrdinal })) {
        return fail("MODULE_REQUIRED");
      }

      const at = this.at();
      const attempt: MissionAttempt = {
        attemptId: this.newId(),
        profileId,
        chapterId: chapter.chapterId,
        missionId: request.missionId,
        attemptOrdinal,
        // The ordinal AND the mission are bound into the seed, so a retry
        // cannot replay attempt one's variation.
        attemptSeedHex: bytesToHex(
          deriveAttemptSeed(
            variationRootSeedHex,
            `${chapter.chapterId}|${request.missionId}`,
            attemptOrdinal,
          ),
        ),
        moduleId: reward.moduleId,
        moduleCompletedAt: completion.completedAt,
        status: "IN_PROGRESS",
        xpFraction: attemptXpFraction(attemptOrdinal),
        awardedXp: 0,
        revision: 0,
        startedAt: at,
        completedAt: null,
        updatedAt: at,
      };
      await tx.insertMissionAttempt(attempt);
      await tx.putMission({
        ...mission,
        outcome: mission.outcome === "UNSTARTED" ? "IN_PROGRESS" : mission.outcome,
        updatedAt: at,
      });
      await tx.appendLedger([
        {
          kind: "MISSION_ATTEMPT_OPENED",
          chapterId: chapter.chapterId,
          missionId: request.missionId,
          attemptId: attempt.attemptId,
          detail: {
            attemptOrdinal,
            numerator: attempt.xpFraction.numerator,
            denominator: attempt.xpFraction.denominator,
          },
        },
      ]);
      return { ok: true as const, value: attempt };
    });
  }

  /**
   * Commit the attempt's terminal outcome. The request carries CLEARED or
   * FAILED and the run's committed events; the award, Level, cumulative
   * Levels, Rank, and ability unlocks are all derived from the stored ordinal
   * and the authored base award.
   */
  async commitMissionOutcome(
    profileId: string,
    request: CommitMissionOutcomeRequest,
  ): Promise<ServiceResult<CommitMissionOutcomeResult>> {
    return this.store.transact(profileId, async (tx) => {
      const attempt = await tx.missionAttempt(request.attemptId);
      if (!attempt || attempt.profileId !== profileId) return fail("ATTEMPT_NOT_FOUND");
      if (attempt.status !== "IN_PROGRESS") return fail("ATTEMPT_CLOSED");
      if (attempt.revision !== request.baseRevision) return fail("PROGRESSION_CONFLICT");

      const { campaign, chapter } = await this.ensureCampaign(tx, profileId);
      const reward = this.content.missionReward(attempt.chapterId, attempt.missionId);
      const curve = this.content.xpCurve(attempt.chapterId);
      if (!reward || !curve) return fail("PACKAGE_MISSING");
      const mission = await this.missionRow(
        tx,
        profileId,
        attempt.chapterId,
        attempt.missionId,
      );

      const at = this.at();
      const applied = applyMissionOutcome({
        campaign,
        chapter,
        mission,
        commit: {
          missionId: attempt.missionId,
          chapterId: attempt.chapterId,
          // From the stored row, never from the request.
          attemptOrdinal: attempt.attemptOrdinal,
          outcome: request.outcome,
          baseXp: reward.baseXp,
          at,
        },
        curve,
        abilityMilestones: this.content.abilityMilestones(attempt.chapterId),
      });
      if (!applied.ok) return fail(applied.reason);
      const delta = applied.value;

      const closed: MissionAttempt = {
        ...attempt,
        status: request.outcome === "CLEARED" ? "CLEARED" : "FAILED",
        awardedXp: delta.awardedXp,
        revision: attempt.revision + 1,
        completedAt: at,
        updatedAt: at,
      };
      // The commit log rides along with the terminal write. It is stored, never
      // read for a derivation: every number in `delta` above came from the stored
      // ordinal and the authored award, and none of them can be moved by anything
      // in here.
      await tx.putMissionAttempt(closed, request.committedEvents);
      await tx.putMission(delta.mission);
      await tx.putChapter(delta.chapter);
      await tx.putCampaign(delta.campaign);
      for (const ability of delta.unlockedAbilities) {
        // Chapter-scoped in single-player…
        await tx.unlockChapterAbility({
          profileId,
          chapterId: ability.chapterId,
          abilityId: ability.abilityId,
          unlockedAtLevel: ability.level,
          unlockedAt: at,
        });
        // …and permanent in the PvP loadout.
        await tx.unlockPvpAbility({
          profileId,
          abilityId: ability.abilityId,
          firstUnlockedChapterId: ability.chapterId,
          firstUnlockedAtLevel: ability.level,
          firstUnlockedAt: at,
        });
      }
      await tx.appendLedger(
        delta.ledger.map((entry) => ({ ...entry, attemptId: attempt.attemptId })),
      );

      return {
        ok: true as const,
        value: {
          attempt: closed,
          mission: delta.mission,
          campaign: delta.campaign,
          chapter: delta.chapter,
          awardedXp: delta.awardedXp,
          levelsGained: delta.levelsGained,
          ranksGained: delta.ranksGained,
          unlockedAbilityIds: delta.unlockedAbilities.map((a) => a.abilityId),
          derived: this.derived(delta.campaign, delta.chapter),
        },
      };
    });
  }

  /**
   * Open a capstone attempt. Attempt 1 covers every chapter concept and is the
   * reported measure. A retry narrows to the concepts still owed mastery, is
   * gated on the module, and draws items the profile has never been served.
   */
  async openChapterAssessment(
    profileId: string,
    request: OpenChapterAssessmentRequest,
  ): Promise<ServiceResult<ChapterAssessmentAttempt>> {
    return this.store.transact(profileId, async (tx) => {
      const { chapter } = await this.ensureCampaign(tx, profileId);
      if (chapter.chapterId !== request.chapterId || chapter.status !== "ACTIVE") {
        return fail("CHAPTER_NOT_ACTIVE");
      }
      const assessmentId = this.content.assessmentId(chapter.chapterId);
      const conceptIds = this.content.chapterConceptIds(chapter.chapterId);
      if (!assessmentId || assessmentId !== request.assessmentId || conceptIds.length === 0) {
        return fail("PACKAGE_MISSING");
      }
      if (await tx.liveAssessmentAttempt(chapter.chapterId, assessmentId)) {
        return fail("ATTEMPT_ALREADY_OPEN");
      }
      const attemptOrdinal =
        (await tx.assessmentAttemptCount(chapter.chapterId, assessmentId)) + 1;
      const mastery = new Map(
        (await tx.conceptMastery(chapter.chapterId)).map((row) => [row.conceptId, row]),
      );
      const scoped =
        attemptOrdinal === 1 ? [...conceptIds] : unmasteredConceptIds(conceptIds, mastery);
      if (scoped.length === 0) return fail("ASSESSMENT_LOCKED");
      if (attemptOrdinal > 1) {
        const completion = await tx.moduleCompletion(
          chapter.chapterId,
          "ASSESSMENT_ATTEMPT",
          assessmentId,
          attemptOrdinal,
        );
        if (!isModuleGateSatisfied({ completion, attemptOrdinal })) {
          return fail("MODULE_REQUIRED");
        }
      }

      const at = this.at();
      const attemptId = this.newId();
      const form: { conceptId: string; itemIds: string[] }[] = [];
      // What the form recorded about itself, beyond which items it drew. Written
      // into the attempt row's `form` jsonb beside each concept's item list; it
      // is the difference between an educator report that can say "mastered on
      // unseen questions" and one that has to say "not recorded".
      const formDisclosure: FormConceptDisclosure[] = [];
      for (const conceptId of scoped) {
        const selection = selectFreshItems({
          reserveItemIds: this.content.itemReserve(assessmentId, conceptId),
          servedItemIds: await tx.servedItemIds(
            chapter.chapterId,
            assessmentId,
            conceptId,
          ),
          count: ASSESSMENT_ITEMS_PER_CONCEPT,
        });
        if (selection.exhausted) return fail("ASSESSMENT_ITEMS_EXHAUSTED");
        form.push({ conceptId, itemIds: selection.itemIds });
        formDisclosure.push({
          conceptId,
          // FRESH is a recorded fact, not an assumption: the line above refuses
          // the whole open rather than serving an item this profile has already
          // seen, so nothing this server writes can be a recycled form. When that
          // policy changes — @pa/assessment's own selector recycles rather than
          // refusing — this is the value that has to change with it.
          freshness: "FRESH",
          openResponseItemIds: selection.itemIds.filter(
            (itemId) => this.content.itemFormat(itemId) === "OPEN_RESPONSE",
          ),
        });
      }

      const attempt: ChapterAssessmentAttempt = {
        attemptId,
        profileId,
        chapterId: chapter.chapterId,
        assessmentId,
        attemptOrdinal,
        scopedConceptIds: scoped,
        form,
        status: "IN_PROGRESS",
        passed: null,
        scoreNumerator: null,
        scoreDenominator: null,
        // First-attempt score is the reported measure; retries are not.
        isReportedMeasure: attemptOrdinal === 1,
        startedAt: at,
        submittedAt: null,
        updatedAt: at,
      };
      await tx.insertAssessmentAttempt(attempt, formDisclosure);
      for (const entry of form) {
        await tx.recordItemExposures({
          chapterId: chapter.chapterId,
          assessmentId,
          attemptId,
          attemptOrdinal,
          conceptId: entry.conceptId,
          itemIds: entry.itemIds,
          at,
        });
      }
      await tx.appendLedger([
        {
          kind: "ASSESSMENT_ATTEMPT_OPENED",
          chapterId: chapter.chapterId,
          missionId: null,
          attemptId,
          detail: { assessmentId, attemptOrdinal, concepts: scoped.length },
        },
      ]);
      return { ok: true as const, value: attempt };
    });
  }

  /**
   * Record one answer. The verdict is minted here in both arms — from the
   * answer key for a selected response, from the grading service for an open
   * response — and a null answer is stored as a genuine blank, which is wrong
   * but is still the durable record of having been asked.
   */
  async answerAssessmentItem(
    profileId: string,
    request: AnswerAssessmentItemRequest,
  ): Promise<ServiceResult<{ answered: number; served: number }>> {
    // Reading the graded verdict is I/O, so it happens before the lock is taken.
    let openVerdict: OpenResponseGrade | null = null;
    if (request.itemFormat === "OPEN_RESPONSE" && request.responseRef !== null) {
      openVerdict = await this.openResponseVerdicts.verdict({
        profileId,
        itemId: request.itemId,
        responseRef: request.responseRef,
      });
      if (openVerdict === null) return fail("VERDICT_UNAVAILABLE");
    }
    return this.store.transact(profileId, async (tx) => {
      const attempt = await tx.assessmentAttempt(request.attemptId);
      if (!attempt || attempt.profileId !== profileId) return fail("ATTEMPT_NOT_FOUND");
      if (attempt.status !== "IN_PROGRESS") return fail("ATTEMPT_CLOSED");
      const entry = attempt.form.find((row) => row.itemIds.includes(request.itemId));
      if (!entry) return fail("BAD_REQUEST");
      // The format is the item's, not the client's claim about it.
      const itemFormat = this.content.itemFormat(request.itemId);
      if (!itemFormat) return fail("PACKAGE_MISSING");
      if (itemFormat !== request.itemFormat) return fail("BAD_REQUEST");

      const at = this.at();
      const selectedOptionId =
        request.itemFormat === "SELECTED_RESPONSE" ? request.selectedOptionId : null;
      const responseRef =
        request.itemFormat === "OPEN_RESPONSE" ? request.responseRef : null;
      await tx.putAssessmentResponse(
        {
          attemptId: attempt.attemptId,
          itemId: request.itemId,
          conceptId: entry.conceptId,
          itemFormat,
          selectedOptionId,
          responseRef,
          correct:
            selectedOptionId !== null
              ? this.content.isCorrectOption(request.itemId, selectedOptionId)
              : (openVerdict?.correct ?? false),
          answeredAt: at,
        },
        {
          // A selected response is graded against the server's own answer key
          // and a blank is a blank, so neither can want a human. Only the
          // classifier raises this flag, and false here is recorded rather than
          // assumed.
          verdictNeedsReview: openVerdict?.needsReview ?? false,
        },
      );
      const responses = await tx.assessmentResponses(attempt.attemptId);
      return {
        ok: true as const,
        value: {
          answered: responses.length,
          served: attempt.form.reduce((sum, row) => sum + row.itemIds.length, 0),
        },
      };
    });
  }

  /**
   * Grade and close the form: 100% per concept or the concept is not mastered.
   * Passing gates the next chapter and mints PvP-legal Codex cards. It pays no
   * XP and does not touch Level or Rank — nothing in this method writes either.
   */
  async submitChapterAssessment(
    profileId: string,
    attemptId: string,
  ): Promise<ServiceResult<SubmitAssessmentResult>> {
    return this.store.transact(profileId, async (tx) => {
      const attempt = await tx.assessmentAttempt(attemptId);
      if (!attempt || attempt.profileId !== profileId) return fail("ATTEMPT_NOT_FOUND");
      if (attempt.status !== "IN_PROGRESS") return fail("ATTEMPT_CLOSED");
      const chapter = await tx.chapter(attempt.chapterId);
      if (!chapter) return fail("CHAPTER_NOT_ACTIVE");

      const stored = await tx.assessmentResponses(attemptId);
      const graded: GradedAssessmentResponse[] = stored.map((response) => ({
        itemId: response.itemId,
        conceptId: response.conceptId,
        correct: response.correct,
      }));
      const summary = summarizeAssessmentForm(attempt.form, graded);
      const at = this.at();
      const ledger: ProgressionLedgerEntry[] = [];
      const masteryRows = new Map(
        (await tx.conceptMastery(attempt.chapterId)).map((row) => [row.conceptId, row]),
      );
      const newlyPvpLegalCardIds: string[] = [];

      for (const result of summary.byConcept) {
        const previous = masteryRows.get(result.conceptId);
        const firstPass = attempt.isReportedMeasure;
        const alreadyMastered = Boolean(previous?.masteredAt);
        // Which attempt achieved mastery, and how strong that form's evidence
        // was. Written only on the write that first records mastery; the store
        // preserves the earlier values on every later one, exactly as it does for
        // mastered_at. A concept that is not mastered carries nulls, because
        // there is no mastering form to describe.
        const newlyMastered = result.mastered && !alreadyMastered;
        const recorded = newlyMastered
          ? formConceptFreshness(attempt.form, result.conceptId)
          : null;
        await tx.putConceptMastery(
          {
            profileId,
            chapterId: attempt.chapterId,
            conceptId: result.conceptId,
            itemsServed: (previous?.itemsServed ?? 0) + result.served,
            itemsCorrect: (previous?.itemsCorrect ?? 0) + result.correct,
            // The reported measure is written once, on attempt 1, and never
            // overwritten by a retry that later reaches mastery.
            firstAttemptServed: firstPass
              ? result.served
              : (previous?.firstAttemptServed ?? 0),
            firstAttemptCorrect: firstPass
              ? result.correct
              : (previous?.firstAttemptCorrect ?? 0),
            masteredAt: alreadyMastered
              ? previous!.masteredAt
              : result.mastered
                ? at
                : null,
            updatedAt: at,
          },
          {
            masteredOnAttempt: newlyMastered ? attempt.attemptOrdinal : null,
            // null when the form did not record its own freshness — an attempt
            // opened before migration 008. NOT false: false asserts that mastery
            // was shown on questions the student had never seen, and asserting it
            // from a field we never wrote is the one fabrication @pa/reporting
            // exists to refuse.
            masteredWithRecycledItems:
              recorded === null ? null : recorded !== "FRESH",
          },
        );
        if (result.mastered && !alreadyMastered) {
          ledger.push({
            kind: "CONCEPT_MASTERED",
            chapterId: attempt.chapterId,
            missionId: null,
            attemptId,
            detail: { conceptId: result.conceptId, attemptOrdinal: attempt.attemptOrdinal },
          });
          // 100% mastery is the only thing that makes a card PvP-legal.
          const minted = await tx.markCodexCardsPvpLegal({
            conceptId: result.conceptId,
            attemptId,
            at,
          });
          for (const cardId of minted) {
            newlyPvpLegalCardIds.push(cardId);
            ledger.push({
              kind: "CODEX_CARD_PVP_LEGAL",
              chapterId: attempt.chapterId,
              missionId: null,
              attemptId,
              detail: { cardId, conceptId: result.conceptId },
            });
          }
        }
      }

      const chapterConcepts = this.content.chapterConceptIds(attempt.chapterId);
      const masteredAll =
        chapterConcepts.length > 0 &&
        chapterConcepts.every(
          (conceptId) =>
            summary.masteredConceptIds.includes(conceptId) ||
            Boolean(masteryRows.get(conceptId)?.masteredAt),
        );

      const closed: ChapterAssessmentAttempt = {
        ...attempt,
        status: "SUBMITTED",
        passed: summary.passed,
        scoreNumerator: summary.scoreNumerator,
        scoreDenominator: summary.scoreDenominator || null,
        submittedAt: at,
        updatedAt: at,
      };
      await tx.putAssessmentAttempt(closed);
      if (masteredAll) {
        // Passing gates the next chapter. It does not touch Level or Rank.
        await tx.putChapter({
          ...chapter,
          assessmentPassedAt: chapter.assessmentPassedAt ?? at,
          updatedAt: at,
        });
      }
      ledger.push({
        kind: "ASSESSMENT_SUBMITTED",
        chapterId: attempt.chapterId,
        missionId: null,
        attemptId,
        detail: {
          attemptOrdinal: attempt.attemptOrdinal,
          passed: summary.passed,
          scoreNumerator: summary.scoreNumerator,
          scoreDenominator: summary.scoreDenominator,
          isReportedMeasure: attempt.isReportedMeasure,
          awardedXp: 0,
        },
      });
      await tx.appendLedger(ledger);

      return {
        ok: true as const,
        value: {
          attempt: closed,
          passed: summary.passed,
          scoreNumerator: summary.scoreNumerator,
          scoreDenominator: summary.scoreDenominator,
          masteredConceptIds: summary.masteredConceptIds,
          unmasteredConceptIds: summary.unmasteredConceptIds,
          newlyPvpLegalCardIds,
          awardedXp: 0,
        },
      };
    });
  }

  /**
   * Walk out of an attempt. It ends with no score and its items stay spent, so
   * the retry still draws fresh ones.
   *
   * Note what does NOT happen: abandoning attempt 1 does not hand the reported
   * measure to attempt 2. The measure is projected over ordinal 1 alone
   * (`reportedFirstAttemptMeasure`), and an abandoned ordinal 1 simply reports
   * no score. That is the whole reason this status exists rather than closing
   * the attempt as submitted with a null score.
   */
  async abandonChapterAssessment(
    profileId: string,
    request: AbandonChapterAssessmentRequest,
  ): Promise<ServiceResult<ChapterAssessmentAttempt>> {
    return this.store.transact(profileId, async (tx) => {
      const attempt = await tx.assessmentAttempt(request.attemptId);
      if (!attempt || attempt.profileId !== profileId) return fail("ATTEMPT_NOT_FOUND");
      if (attempt.status !== "IN_PROGRESS") return fail("ATTEMPT_CLOSED");
      const at = this.at();
      const abandoned: ChapterAssessmentAttempt = {
        ...attempt,
        status: "ABANDONED",
        passed: false,
        scoreNumerator: null,
        scoreDenominator: null,
        submittedAt: null,
        updatedAt: at,
      };
      await tx.putAssessmentAttempt(abandoned);
      await tx.appendLedger([
        {
          kind: "ASSESSMENT_ATTEMPT_ABANDONED",
          chapterId: attempt.chapterId,
          missionId: null,
          attemptId: attempt.attemptId,
          detail: {
            assessmentId: attempt.assessmentId,
            attemptOrdinal: attempt.attemptOrdinal,
            reason: request.reason,
            isReportedMeasure: attempt.isReportedMeasure,
          },
        },
      ]);
      return { ok: true as const, value: abandoned };
    });
  }

  /**
   * Begin the next chapter: Level and XP reset to zero and PvE abilities are
   * re-earned, while Rank, cumulative Levels, the Codex, concept mastery, and
   * the permanent PvP loadout carry. Gated on the capstone having passed.
   */
  async advanceChapter(
    profileId: string,
    nextChapterId: string,
  ): Promise<ServiceResult<{ campaign: CampaignProgression; chapter: ChapterProgression }>> {
    return this.store.transact(profileId, async (tx) => {
      const { campaign, chapter } = await this.ensureCampaign(tx, profileId);
      if (chapter.chapterId === nextChapterId) return fail("BAD_REQUEST");
      if (!chapter.assessmentPassedAt) return fail("ASSESSMENT_LOCKED");
      const at = this.at();
      await tx.putChapter({
        ...chapter,
        status: "COMPLETE",
        completedAt: chapter.completedAt ?? at,
        updatedAt: at,
      });
      const existing = await tx.chapter(nextChapterId);
      if (existing) return fail("PROGRESSION_CONFLICT");
      const started = startChapter({ campaign, chapterId: nextChapterId, at });
      await tx.putCampaign(started.campaign);
      await tx.putChapter(started.chapter);
      await tx.appendLedger([
        {
          kind: "CHAPTER_COMPLETED",
          chapterId: chapter.chapterId,
          missionId: null,
          attemptId: null,
          detail: { level: chapter.level, xp: chapter.xp },
        },
        ...started.ledger,
      ]);
      return {
        ok: true as const,
        value: { campaign: started.campaign, chapter: started.chapter },
      };
    });
  }
}
