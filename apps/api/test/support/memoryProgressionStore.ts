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
import { serialisedForm } from "../../src/progression/store.js";
import type {
  ConceptMasteryDisclosure,
  ProgressionStore,
  ProgressionTx,
} from "../../src/progression/store.js";

// In-memory store. The service holds all the derivation logic, so a plain map
// is enough to exercise every authority rule without PostgreSQL.
//
// SHARED TEST INFRA. It models the Postgres store field for field — the
// per-profile advisory lock, the chapter/profile-scoped reads, the first-write-wins
// upserts, and the `serialisedForm` projection — so a test drives the real
// derivation logic against a faithful stand-in. It is multi-profile safe (snapshot
// filters by profile), which is what the dev-reset scoping tests rely on.
export class MemoryStore implements ProgressionStore {
  campaigns = new Map<string, CampaignProgression>();
  chapters = new Map<string, ChapterProgression>();
  missions = new Map<string, MissionProgress>();
  missionAttempts = new Map<string, MissionAttempt>();
  modules = new Map<string, LearningModuleCompletion>();
  mastery = new Map<string, ConceptMastery>();
  /**
   * The evidence-quality columns migration 008 added, which are deliberately not
   * on `ConceptMastery`: they are educator-facing and nothing on a student's
   * screen has a use for them.
   */
  masteryDisclosure = new Map<string, ConceptMasteryDisclosure>();
  /** `chapter_assessment_responses.verdict_needs_review`, per response. */
  responseReview = new Map<string, boolean>();
  codex = new Map<string, CodexCardState>();
  chapterAbilities = new Map<string, ChapterAbilityUnlock>();
  pvpAbilities = new Map<string, PvpAbilityUnlock>();
  assessmentAttempts = new Map<string, ChapterAssessmentAttempt>();
  assessmentResponses = new Map<string, ChapterAssessmentResponse>();
  /** The duel's commit log, per attempt. Written by the terminal write only. */
  commitLogs = new Map<string, readonly unknown[]>();
  exposures: {
    chapterId: string;
    assessmentId: string;
    conceptId: string;
    itemId: string;
  }[] = [];
  ledger: ProgressionLedgerEntry[] = [];

  private tx(profileId: string): ProgressionTx {
    const clone = <T>(value: T | undefined): T | null =>
      value === undefined ? null : structuredClone(value);
    return {
      campaign: async () => clone(this.campaigns.get(profileId)),
      chapter: async (chapterId) => clone(this.chapters.get(`${profileId}:${chapterId}`)),
      // Every mission/module/concept key includes the chapter: mission ids are
      // chapter-local slugs, so chapter two mints its own M1.
      mission: async (chapterId, missionId) =>
        clone(this.missions.get(`${profileId}:${chapterId}:${missionId}`)),
      liveMissionAttempt: async (chapterId, missionId) =>
        clone(
          [...this.missionAttempts.values()].find(
            (attempt) =>
              attempt.profileId === profileId &&
              attempt.chapterId === chapterId &&
              attempt.missionId === missionId &&
              attempt.status === "IN_PROGRESS",
          ),
        ),
      liveMissionAttemptForProfile: async () =>
        clone(
          [...this.missionAttempts.values()].find(
            (attempt) =>
              attempt.profileId === profileId && attempt.status === "IN_PROGRESS",
          ),
        ),
      missionAttempt: async (attemptId) => {
        const attempt = this.missionAttempts.get(attemptId);
        // Scoped to the profile, exactly as the Postgres store's `where id=$1 and
        // profile_id=$2`: a foreign id resolves to nothing.
        return attempt && attempt.profileId === profileId ? clone(attempt) : null;
      },
      moduleCompletion: async (chapterId, gatesKind, gatesId, gatesOrdinal) =>
        clone(
          this.modules.get(
            `${profileId}:${chapterId}:${gatesKind}:${gatesId}:${gatesOrdinal}`,
          ),
        ),
      conceptMastery: async (chapterId) =>
        [...this.mastery.values()].filter(
          (row) => row.profileId === profileId && row.chapterId === chapterId,
        ),
      codexCard: async (cardId) => clone(this.codex.get(`${profileId}:${cardId}`)),
      assessmentAttempt: async (attemptId) => clone(this.assessmentAttempts.get(attemptId)),
      liveAssessmentAttempt: async (chapterId, assessmentId) =>
        clone(
          [...this.assessmentAttempts.values()].find(
            (attempt) =>
              attempt.profileId === profileId &&
              attempt.chapterId === chapterId &&
              attempt.assessmentId === assessmentId &&
              attempt.status === "IN_PROGRESS",
          ),
        ),
      assessmentAttemptCount: async (chapterId, assessmentId) =>
        [...this.assessmentAttempts.values()].filter(
          (attempt) =>
            attempt.profileId === profileId &&
            attempt.chapterId === chapterId &&
            attempt.assessmentId === assessmentId,
        ).length,
      assessmentResponses: async (attemptId) =>
        [...this.assessmentResponses.values()].filter(
          (response) => response.attemptId === attemptId,
        ),
      servedItemIds: async (chapterId, assessmentId, conceptId) =>
        this.exposures
          .filter(
            (entry) =>
              entry.chapterId === chapterId &&
              entry.assessmentId === assessmentId &&
              entry.conceptId === conceptId,
          )
          .map((entry) => entry.itemId),

      putCampaign: async (campaign) => {
        this.campaigns.set(profileId, structuredClone(campaign));
      },
      putChapter: async (chapter) => {
        this.chapters.set(`${profileId}:${chapter.chapterId}`, structuredClone(chapter));
      },
      putMission: async (mission) => {
        this.missions.set(
          `${profileId}:${mission.chapterId}:${mission.missionId}`,
          structuredClone(mission),
        );
      },
      putModuleCompletion: async (completion) => {
        this.modules.set(
          `${profileId}:${completion.chapterId}:${completion.gatesKind}:${completion.gatesId}:${completion.gatesOrdinal}`,
          structuredClone(completion),
        );
      },
      insertMissionAttempt: async (attempt) => {
        if (this.missionAttempts.has(attempt.attemptId)) throw new Error("duplicate attempt");
        this.missionAttempts.set(attempt.attemptId, structuredClone(attempt));
      },
      putMissionAttempt: async (attempt, committedEvents) => {
        this.missionAttempts.set(attempt.attemptId, structuredClone(attempt));
        this.commitLogs.set(attempt.attemptId, structuredClone(committedEvents));
      },
      // Delete every attempt row for one mission of this profile, returning the
      // count. Mirrors the Postgres store's scoped `delete`; the module gate in
      // `this.modules` is deliberately left untouched.
      deleteMissionAttempts: async (chapterId, missionId) => {
        let deleted = 0;
        for (const [id, attempt] of this.missionAttempts) {
          if (
            attempt.profileId === profileId &&
            attempt.chapterId === chapterId &&
            attempt.missionId === missionId
          ) {
            this.missionAttempts.delete(id);
            this.commitLogs.delete(id);
            deleted += 1;
          }
        }
        return deleted;
      },
      putConceptMastery: async (row, disclosure) => {
        const key = `${profileId}:${row.chapterId}:${row.conceptId}`;
        const previous = this.mastery.get(key);
        this.mastery.set(key, {
          ...structuredClone(row),
          masteredAt: previous?.masteredAt ?? row.masteredAt,
        });
        // First write wins, exactly as the Postgres store's `coalesce` does: the
        // attempt that achieved mastery and the freshness of ITS form are facts
        // about one moment and a later retry must not restate them.
        const held = this.masteryDisclosure.get(key);
        this.masteryDisclosure.set(key, {
          masteredOnAttempt:
            held?.masteredOnAttempt ?? disclosure.masteredOnAttempt,
          masteredWithRecycledItems:
            held?.masteredWithRecycledItems ??
            disclosure.masteredWithRecycledItems,
        });
      },
      learnCodexCard: async (card) => {
        const key = `${profileId}:${card.cardId}`;
        if (this.codex.has(key)) return;
        this.codex.set(key, {
          ...structuredClone(card),
          pvpLegalAt: null,
          updatedAt: card.learnedAt,
        });
      },
      markCodexCardsPvpLegal: async ({ conceptId, at }) => {
        const minted: string[] = [];
        for (const [key, card] of this.codex) {
          if (!key.startsWith(`${profileId}:`)) continue;
          if (card.conceptId !== conceptId || card.pvpLegalAt) continue;
          this.codex.set(key, { ...card, pvpLegalAt: at, updatedAt: at });
          minted.push(card.cardId);
        }
        return minted;
      },
      unlockChapterAbility: async (unlock) => {
        this.chapterAbilities.set(
          `${profileId}:${unlock.chapterId}:${unlock.abilityId}`,
          structuredClone(unlock),
        );
      },
      unlockPvpAbility: async (unlock) => {
        const key = `${profileId}:${unlock.abilityId}`;
        if (this.pvpAbilities.has(key)) return;
        this.pvpAbilities.set(key, structuredClone(unlock));
      },
      insertAssessmentAttempt: async (attempt, formDisclosure) => {
        // Stored through the same projection the Postgres store uses, so the two
        // cannot answer `formConceptFreshness` differently.
        this.assessmentAttempts.set(attempt.attemptId, {
          ...structuredClone(attempt),
          form: serialisedForm(
            attempt.form,
            formDisclosure,
          ) as ChapterAssessmentAttempt["form"],
        });
      },
      putAssessmentAttempt: async (attempt) => {
        const held = this.assessmentAttempts.get(attempt.attemptId);
        this.assessmentAttempts.set(attempt.attemptId, {
          ...structuredClone(attempt),
          // The terminal write does not rewrite the served form.
          form: held?.form ?? structuredClone(attempt.form),
        });
      },
      putAssessmentResponse: async (response, review) => {
        this.assessmentResponses.set(
          `${response.attemptId}:${response.itemId}`,
          structuredClone(response),
        );
        this.responseReview.set(
          `${response.attemptId}:${response.itemId}`,
          review.verdictNeedsReview,
        );
      },
      recordItemExposures: async ({ chapterId, assessmentId, conceptId, itemIds }) => {
        for (const itemId of itemIds) {
          this.exposures.push({ chapterId, assessmentId, conceptId, itemId });
        }
      },
      appendLedger: async (entries) => {
        this.ledger.push(...structuredClone(entries as ProgressionLedgerEntry[]));
      },
    };
  }

  /** Per-profile serialization, modelling the Postgres advisory lock. */
  private locks = new Map<string, Promise<unknown>>();

  async transact<T>(profileId: string, fn: (tx: ProgressionTx) => Promise<T>): Promise<T> {
    const prior = this.locks.get(profileId) ?? Promise.resolve();
    const run = prior.then(() => fn(this.tx(profileId)));
    // Keep the chain alive through failures so one rejected transaction does not
    // wedge the profile; the returned promise still settles for its own caller.
    this.locks.set(
      profileId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  async snapshot(profileId: string): Promise<ProgressionSnapshot | null> {
    const campaign = this.campaigns.get(profileId);
    if (!campaign) return null;
    const activeChapter = this.chapters.get(`${profileId}:${campaign.activeChapterId}`);
    if (!activeChapter) return null;
    return {
      campaign,
      activeChapter,
      derived: {
        rank: campaign.rank,
        cumulativeLevels: campaign.cumulativeLevels,
        levelsToNextRank: 1,
        level: activeChapter.level,
        xp: activeChapter.xp,
        xpToNextLevel: null,
      },
      missions: [...this.missions.values()].filter(
        (mission) => mission.profileId === profileId,
      ),
      openAttempt:
        [...this.missionAttempts.values()].find(
          (attempt) =>
            attempt.profileId === profileId && attempt.status === "IN_PROGRESS",
        ) ?? null,
      codex: [...this.codex.values()],
      chapterAbilities: [...this.chapterAbilities.values()],
      pvpAbilities: [...this.pvpAbilities.values()],
      conceptMastery: [...this.mastery.values()],
    };
  }
}
