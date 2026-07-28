import type pg from "pg";
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
import { pool } from "../db.js";
import { serialisedForm } from "./store.js";
import type { ProgressionStore, ProgressionTx } from "./store.js";

type Row = Record<string, unknown>;

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function isoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}

function toCampaign(row: Row): CampaignProgression {
  return {
    profileId: row.profile_id as string,
    modelVersion: row.model_version as number,
    rank: row.rank as number,
    cumulativeLevels: row.cumulative_levels as number,
    activeChapterId: row.active_chapter_id as string,
    revision: row.revision as number,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function toChapter(row: Row): ChapterProgression {
  return {
    profileId: row.profile_id as string,
    chapterId: row.chapter_id as string,
    level: row.level as number,
    xp: row.xp as number,
    levelsAtChapterStart: row.levels_at_chapter_start as number,
    status: row.status as ChapterProgression["status"],
    assessmentPassedAt: isoOrNull(row.assessment_passed_at),
    startedAt: iso(row.started_at),
    completedAt: isoOrNull(row.completed_at),
    updatedAt: iso(row.updated_at),
  };
}

function toMission(row: Row): MissionProgress {
  return {
    profileId: row.profile_id as string,
    chapterId: row.chapter_id as string,
    missionId: row.mission_id as string,
    attemptsUsed: row.attempts_used as number,
    outcome: row.outcome as MissionProgress["outcome"],
    awardedXp: row.awarded_xp as number,
    clearedOnAttempt: (row.cleared_on_attempt as number | null) ?? null,
    clearedAt: isoOrNull(row.cleared_at),
    failedAt: isoOrNull(row.failed_at),
    updatedAt: iso(row.updated_at),
  };
}

function toAttempt(row: Row): MissionAttempt {
  return {
    attemptId: row.id as string,
    profileId: row.profile_id as string,
    chapterId: row.chapter_id as string,
    missionId: row.mission_id as string,
    attemptOrdinal: row.attempt_ordinal as number,
    attemptSeedHex: row.attempt_seed_hex as string,
    moduleId: row.module_id as string,
    moduleCompletedAt: iso(row.module_completed_at),
    status: row.status as MissionAttempt["status"],
    xpFraction: {
      numerator: row.xp_numerator as number,
      denominator: row.xp_denominator as number,
    },
    awardedXp: row.awarded_xp as number,
    revision: row.revision as number,
    startedAt: iso(row.started_at),
    completedAt: isoOrNull(row.completed_at),
    updatedAt: iso(row.updated_at),
  };
}

function toModuleCompletion(row: Row): LearningModuleCompletion {
  return {
    profileId: row.profile_id as string,
    chapterId: row.chapter_id as string,
    moduleId: row.module_id as string,
    gatesKind: row.gates_kind as LearningModuleCompletion["gatesKind"],
    gatesId: row.gates_id as string,
    gatesOrdinal: row.gates_ordinal as number,
    requiredSeconds: row.required_seconds as number,
    observedSeconds: row.observed_seconds as number,
    conceptIds: (row.concept_ids as string[]) ?? [],
    completedAt: iso(row.completed_at),
  };
}

function toCodexCard(row: Row): CodexCardState {
  return {
    profileId: row.profile_id as string,
    cardId: row.card_id as string,
    conceptId: row.concept_id as string,
    learnedChapterId: row.learned_chapter_id as string,
    learnedAt: iso(row.learned_at),
    pvpLegalAt: isoOrNull(row.pvp_legal_at),
    updatedAt: iso(row.updated_at),
  };
}

function toConceptMastery(row: Row): ConceptMastery {
  return {
    profileId: row.profile_id as string,
    chapterId: row.chapter_id as string,
    conceptId: row.concept_id as string,
    itemsServed: row.items_served as number,
    itemsCorrect: row.items_correct as number,
    firstAttemptServed: row.first_attempt_served as number,
    firstAttemptCorrect: row.first_attempt_correct as number,
    masteredAt: isoOrNull(row.mastered_at),
    updatedAt: iso(row.updated_at),
  };
}

function toAssessmentAttempt(row: Row): ChapterAssessmentAttempt {
  return {
    attemptId: row.id as string,
    profileId: row.profile_id as string,
    chapterId: row.chapter_id as string,
    assessmentId: row.assessment_id as string,
    attemptOrdinal: row.attempt_ordinal as number,
    scopedConceptIds: row.scoped_concept_ids as string[],
    form: row.form as ChapterAssessmentAttempt["form"],
    status: row.status as ChapterAssessmentAttempt["status"],
    passed: (row.passed as boolean | null) ?? null,
    scoreNumerator: (row.score_numerator as number | null) ?? null,
    scoreDenominator: (row.score_denominator as number | null) ?? null,
    isReportedMeasure: row.is_reported_measure as boolean,
    startedAt: iso(row.started_at),
    submittedAt: isoOrNull(row.submitted_at),
    updatedAt: iso(row.updated_at),
  };
}

function toAssessmentResponse(row: Row): ChapterAssessmentResponse {
  return {
    attemptId: row.attempt_id as string,
    itemId: row.item_id as string,
    conceptId: row.concept_id as string,
    itemFormat: row.item_format as ChapterAssessmentResponse["itemFormat"],
    // Null is a genuine blank, not a missing value to paper over.
    selectedOptionId: (row.selected_option_id as string | null) ?? null,
    responseRef: (row.response_ref as string | null) ?? null,
    correct: row.correct as boolean,
    answeredAt: iso(row.answered_at),
  };
}

function tx(client: pg.PoolClient, profileId: string): ProgressionTx {
  const one = async <T>(
    sql: string,
    params: unknown[],
    map: (row: Row) => T,
  ): Promise<T | null> => {
    const result = await client.query(sql, params as never[]);
    const row = result.rows[0] as Row | undefined;
    return row ? map(row) : null;
  };
  const many = async <T>(
    sql: string,
    params: unknown[],
    map: (row: Row) => T,
  ): Promise<T[]> => {
    const result = await client.query(sql, params as never[]);
    return (result.rows as Row[]).map(map);
  };

  return {
    campaign: () =>
      one(
        "select * from campaign_progression where profile_id=$1",
        [profileId],
        toCampaign,
      ),
    chapter: (chapterId) =>
      one(
        "select * from chapter_progression where profile_id=$1 and chapter_id=$2",
        [profileId, chapterId],
        toChapter,
      ),
    mission: (chapterId, missionId) =>
      one(
        `select * from mission_progress
         where profile_id=$1 and chapter_id=$2 and mission_id=$3`,
        [profileId, chapterId, missionId],
        toMission,
      ),
    liveMissionAttempt: (chapterId, missionId) =>
      one(
        `select * from mission_attempts
         where profile_id=$1 and chapter_id=$2 and mission_id=$3
           and status='IN_PROGRESS'`,
        [profileId, chapterId, missionId],
        toAttempt,
      ),
    liveMissionAttemptForProfile: () =>
      one(
        `select * from mission_attempts
         where profile_id=$1 and status='IN_PROGRESS'
         order by started_at asc limit 1`,
        [profileId],
        toAttempt,
      ),
    missionAttempt: (attemptId) =>
      one(
        "select * from mission_attempts where id=$1 and profile_id=$2",
        [attemptId, profileId],
        toAttempt,
      ),
    moduleCompletion: (chapterId, gatesKind, gatesId, gatesOrdinal) =>
      one(
        `select * from learning_module_completions
         where profile_id=$1 and chapter_id=$2 and gates_kind=$3
           and gates_id=$4 and gates_ordinal=$5`,
        [profileId, chapterId, gatesKind, gatesId, gatesOrdinal],
        toModuleCompletion,
      ),
    conceptMastery: (chapterId) =>
      many(
        "select * from concept_mastery where profile_id=$1 and chapter_id=$2",
        [profileId, chapterId],
        toConceptMastery,
      ),
    codexCard: (cardId) =>
      one(
        "select * from codex_cards where profile_id=$1 and card_id=$2",
        [profileId, cardId],
        toCodexCard,
      ),
    assessmentAttempt: (attemptId) =>
      one(
        "select * from chapter_assessment_attempts where id=$1 and profile_id=$2",
        [attemptId, profileId],
        toAssessmentAttempt,
      ),
    liveAssessmentAttempt: (chapterId, assessmentId) =>
      one(
        `select * from chapter_assessment_attempts
         where profile_id=$1 and chapter_id=$2 and assessment_id=$3
           and status='IN_PROGRESS'`,
        [profileId, chapterId, assessmentId],
        toAssessmentAttempt,
      ),
    // Abandoned attempts count: they spent their items and their ordinal.
    assessmentAttemptCount: async (chapterId, assessmentId) => {
      const result = await client.query(
        `select count(*)::int as count from chapter_assessment_attempts
         where profile_id=$1 and chapter_id=$2 and assessment_id=$3`,
        [profileId, chapterId, assessmentId] as never[],
      );
      return ((result.rows[0] as Row | undefined)?.count as number) ?? 0;
    },
    assessmentResponses: (attemptId) =>
      many(
        `select r.* from chapter_assessment_responses r
         join chapter_assessment_attempts a on a.id = r.attempt_id
         where r.attempt_id=$1 and a.profile_id=$2`,
        [attemptId, profileId],
        toAssessmentResponse,
      ),
    servedItemIds: async (chapterId, assessmentId, conceptId) => {
      const result = await client.query(
        `select item_id from assessment_item_exposures
         where profile_id=$1 and chapter_id=$2 and assessment_id=$3 and concept_id=$4`,
        [profileId, chapterId, assessmentId, conceptId] as never[],
      );
      return (result.rows as Row[]).map((row) => row.item_id as string);
    },

    putCampaign: async (campaign) => {
      await client.query(
        `insert into campaign_progression(
           profile_id, model_version, rank, cumulative_levels, active_chapter_id,
           revision, created_at, updated_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (profile_id) do update set
           model_version=excluded.model_version,
           rank=excluded.rank,
           cumulative_levels=excluded.cumulative_levels,
           active_chapter_id=excluded.active_chapter_id,
           revision=excluded.revision,
           updated_at=excluded.updated_at`,
        [
          campaign.profileId,
          campaign.modelVersion,
          campaign.rank,
          campaign.cumulativeLevels,
          campaign.activeChapterId,
          campaign.revision,
          campaign.createdAt,
          campaign.updatedAt,
        ] as never[],
      );
    },
    putChapter: async (chapter) => {
      await client.query(
        `insert into chapter_progression(
           profile_id, chapter_id, level, xp, levels_at_chapter_start, status,
           assessment_passed_at, started_at, completed_at, updated_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (profile_id, chapter_id) do update set
           level=excluded.level,
           xp=excluded.xp,
           levels_at_chapter_start=excluded.levels_at_chapter_start,
           status=excluded.status,
           assessment_passed_at=excluded.assessment_passed_at,
           completed_at=excluded.completed_at,
           updated_at=excluded.updated_at`,
        [
          chapter.profileId,
          chapter.chapterId,
          chapter.level,
          chapter.xp,
          chapter.levelsAtChapterStart,
          chapter.status,
          chapter.assessmentPassedAt,
          chapter.startedAt,
          chapter.completedAt,
          chapter.updatedAt,
        ] as never[],
      );
    },
    putMission: async (mission) => {
      await client.query(
        `insert into mission_progress(
           profile_id, chapter_id, mission_id, attempts_used, outcome, awarded_xp,
           cleared_on_attempt, cleared_at, failed_at, updated_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (profile_id, chapter_id, mission_id) do update set
           attempts_used=excluded.attempts_used,
           outcome=excluded.outcome,
           awarded_xp=excluded.awarded_xp,
           cleared_on_attempt=excluded.cleared_on_attempt,
           cleared_at=excluded.cleared_at,
           failed_at=excluded.failed_at,
           updated_at=excluded.updated_at`,
        [
          mission.profileId,
          mission.chapterId,
          mission.missionId,
          mission.attemptsUsed,
          mission.outcome,
          mission.awardedXp,
          mission.clearedOnAttempt,
          mission.clearedAt,
          mission.failedAt,
          mission.updatedAt,
        ] as never[],
      );
    },
    putModuleCompletion: async (completion) => {
      await client.query(
        `insert into learning_module_completions(
           profile_id, chapter_id, module_id, gates_kind, gates_id, gates_ordinal,
           required_seconds, observed_seconds, concept_ids, completed_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
         on conflict (profile_id, chapter_id, gates_kind, gates_id, gates_ordinal)
         do update set
           module_id=excluded.module_id,
           required_seconds=excluded.required_seconds,
           observed_seconds=excluded.observed_seconds,
           concept_ids=excluded.concept_ids,
           completed_at=excluded.completed_at`,
        [
          completion.profileId,
          completion.chapterId,
          completion.moduleId,
          completion.gatesKind,
          completion.gatesId,
          completion.gatesOrdinal,
          completion.requiredSeconds,
          completion.observedSeconds,
          JSON.stringify(completion.conceptIds),
          completion.completedAt,
        ] as never[],
      );
    },
    insertMissionAttempt: async (attempt) => {
      await client.query(
        `insert into mission_attempts(
           id, profile_id, chapter_id, mission_id, attempt_ordinal, attempt_seed_hex,
           module_id, module_completed_at, status, xp_numerator, xp_denominator,
           awarded_xp, committed_events, revision, started_at, completed_at, updated_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'[]'::jsonb,$13,$14,$15,$16)`,
        [
          attempt.attemptId,
          attempt.profileId,
          attempt.chapterId,
          attempt.missionId,
          attempt.attemptOrdinal,
          attempt.attemptSeedHex,
          attempt.moduleId,
          attempt.moduleCompletedAt,
          attempt.status,
          attempt.xpFraction.numerator,
          attempt.xpFraction.denominator,
          attempt.awardedXp,
          attempt.revision,
          attempt.startedAt,
          attempt.completedAt,
          attempt.updatedAt,
        ] as never[],
      );
    },
    putMissionAttempt: async (attempt, committedEvents) => {
      await client.query(
        `update mission_attempts set
           status=$3, awarded_xp=$4, revision=$5, committed_events=$6::jsonb,
           completed_at=$7, updated_at=$8
         where id=$1 and profile_id=$2`,
        [
          attempt.attemptId,
          attempt.profileId,
          attempt.status,
          attempt.awardedXp,
          attempt.revision,
          JSON.stringify(committedEvents),
          attempt.completedAt,
          attempt.updatedAt,
        ] as never[],
      );
    },
    deleteMissionAttempts: async (chapterId, missionId) => {
      // Scoped to this profile, this chapter and this mission — never a blanket
      // wipe. `learning_module_completions` is untouched by design (see the store
      // interface): the module gate must survive so a fresh attempt can grade.
      const result = await client.query(
        `delete from mission_attempts
         where profile_id=$1 and chapter_id=$2 and mission_id=$3`,
        [profileId, chapterId, missionId] as never[],
      );
      return result.rowCount ?? 0;
    },
    putConceptMastery: async (mastery, disclosure) => {
      await client.query(
        `insert into concept_mastery(
           profile_id, concept_id, chapter_id, items_served, items_correct,
           first_attempt_served, first_attempt_correct, mastered_at,
           mastered_on_attempt, mastered_with_recycled_items, updated_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         on conflict (profile_id, chapter_id, concept_id) do update set
           items_served=excluded.items_served,
           items_correct=excluded.items_correct,
           first_attempt_served=excluded.first_attempt_served,
           first_attempt_correct=excluded.first_attempt_correct,
           mastered_at=coalesce(concept_mastery.mastered_at, excluded.mastered_at),
           -- First write wins, exactly as mastered_at does above. The attempt
           -- that achieved mastery and the freshness of ITS form are facts about
           -- one moment; a later retry must not restate them.
           mastered_on_attempt=coalesce(
             concept_mastery.mastered_on_attempt, excluded.mastered_on_attempt
           ),
           mastered_with_recycled_items=coalesce(
             concept_mastery.mastered_with_recycled_items,
             excluded.mastered_with_recycled_items
           ),
           updated_at=excluded.updated_at`,
        [
          mastery.profileId,
          mastery.conceptId,
          mastery.chapterId,
          mastery.itemsServed,
          mastery.itemsCorrect,
          mastery.firstAttemptServed,
          mastery.firstAttemptCorrect,
          mastery.masteredAt,
          disclosure.masteredOnAttempt,
          disclosure.masteredWithRecycledItems,
          mastery.updatedAt,
        ] as never[],
      );
    },
    learnCodexCard: async (card) => {
      // Learning never grants PvP legality; pvp_legal_at is left untouched.
      await client.query(
        `insert into codex_cards(
           profile_id, card_id, concept_id, learned_chapter_id, learned_at, updated_at
         ) values ($1,$2,$3,$4,$5,$5)
         on conflict (profile_id, card_id) do nothing`,
        [
          card.profileId,
          card.cardId,
          card.conceptId,
          card.learnedChapterId,
          card.learnedAt,
        ] as never[],
      );
    },
    markCodexCardsPvpLegal: async ({ conceptId, attemptId, at }) => {
      const result = await client.query(
        `update codex_cards set pvp_legal_at=$3, pvp_legal_attempt_id=$4, updated_at=$3
         where profile_id=$1 and concept_id=$2 and pvp_legal_at is null
         returning card_id`,
        [profileId, conceptId, at, attemptId] as never[],
      );
      return (result.rows as Row[]).map((row) => row.card_id as string);
    },
    unlockChapterAbility: async (unlock: ChapterAbilityUnlock) => {
      await client.query(
        `insert into chapter_ability_unlocks(
           profile_id, chapter_id, ability_id, unlocked_at_level, unlocked_at
         ) values ($1,$2,$3,$4,$5)
         on conflict (profile_id, chapter_id, ability_id) do nothing`,
        [
          unlock.profileId,
          unlock.chapterId,
          unlock.abilityId,
          unlock.unlockedAtLevel,
          unlock.unlockedAt,
        ] as never[],
      );
    },
    unlockPvpAbility: async (unlock: PvpAbilityUnlock) => {
      // Permanent and first-write-wins: a later chapter never rewrites the
      // chapter or Level that first granted the ability.
      await client.query(
        `insert into pvp_ability_loadout(
           profile_id, ability_id, first_unlocked_chapter_id,
           first_unlocked_at_level, first_unlocked_at
         ) values ($1,$2,$3,$4,$5)
         on conflict (profile_id, ability_id) do nothing`,
        [
          unlock.profileId,
          unlock.abilityId,
          unlock.firstUnlockedChapterId,
          unlock.firstUnlockedAtLevel,
          unlock.firstUnlockedAt,
        ] as never[],
      );
    },
    insertAssessmentAttempt: async (attempt, formDisclosure) => {
      await client.query(
        `insert into chapter_assessment_attempts(
           id, profile_id, chapter_id, assessment_id, attempt_ordinal,
           scoped_concept_ids, form, status, is_reported_measure, started_at, updated_at
         ) values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11)`,
        [
          attempt.attemptId,
          attempt.profileId,
          attempt.chapterId,
          attempt.assessmentId,
          attempt.attemptOrdinal,
          JSON.stringify(attempt.scopedConceptIds),
          JSON.stringify(serialisedForm(attempt.form, formDisclosure)),
          attempt.status,
          attempt.isReportedMeasure,
          attempt.startedAt,
          attempt.updatedAt,
        ] as never[],
      );
    },
    putAssessmentAttempt: async (attempt) => {
      await client.query(
        `update chapter_assessment_attempts set
           status=$3, passed=$4, score_numerator=$5, score_denominator=$6,
           submitted_at=$7, updated_at=$8
         where id=$1 and profile_id=$2`,
        [
          attempt.attemptId,
          attempt.profileId,
          attempt.status,
          attempt.passed,
          attempt.scoreNumerator,
          attempt.scoreDenominator,
          attempt.submittedAt,
          attempt.updatedAt,
        ] as never[],
      );
    },
    putAssessmentResponse: async (response, review) => {
      await client.query(
        `insert into chapter_assessment_responses(
           attempt_id, item_id, concept_id, item_format, selected_option_id,
           response_ref, correct, verdict_needs_review, answered_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (attempt_id, item_id) do update set
           item_format=excluded.item_format,
           selected_option_id=excluded.selected_option_id,
           response_ref=excluded.response_ref,
           correct=excluded.correct,
           verdict_needs_review=excluded.verdict_needs_review,
           answered_at=excluded.answered_at`,
        [
          response.attemptId,
          response.itemId,
          response.conceptId,
          response.itemFormat,
          response.selectedOptionId,
          response.responseRef,
          response.correct,
          review.verdictNeedsReview,
          response.answeredAt,
        ] as never[],
      );
    },
    recordItemExposures: async ({
      chapterId,
      assessmentId,
      attemptId,
      attemptOrdinal,
      conceptId,
      itemIds,
      at,
    }) => {
      for (const itemId of itemIds) {
        await client.query(
          `insert into assessment_item_exposures(
             profile_id, chapter_id, assessment_id, concept_id, item_id, attempt_id,
             attempt_ordinal, served_at
           ) values ($1,$2,$3,$4,$5,$6,$7,$8)
           on conflict (profile_id, chapter_id, assessment_id, item_id) do nothing`,
          [
            profileId,
            chapterId,
            assessmentId,
            conceptId,
            itemId,
            attemptId,
            attemptOrdinal,
            at,
          ] as never[],
        );
      }
    },
    appendLedger: async (entries: readonly ProgressionLedgerEntry[]) => {
      for (const entry of entries) {
        await client.query(
          `insert into progression_ledger(
             profile_id, chapter_id, kind, mission_id, attempt_id, detail
           ) values ($1,$2,$3,$4,$5,$6::jsonb)`,
          [
            profileId,
            entry.chapterId,
            entry.kind,
            entry.missionId,
            entry.attemptId,
            JSON.stringify(entry.detail),
          ] as never[],
        );
      }
    },
  };
}

export function postgresProgressionStore(): ProgressionStore {
  return {
    async transact<T>(
      profileId: string,
      fn: (transaction: ProgressionTx) => Promise<T>,
    ): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("begin");
        // One writer per profile for the whole transaction. Without this, two
        // concurrent opens could both read "no attempts used" and both claim
        // attempt 1 at full XP.
        await client.query("select pg_advisory_xact_lock(hashtext($1))", [
          `progression:${profileId}`,
        ] as never[]);
        const value = await fn(tx(client, profileId));
        await client.query("commit");
        return value;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async snapshot(profileId: string): Promise<ProgressionSnapshot | null> {
      const client = await pool.connect();
      try {
        const reader = tx(client, profileId);
        const campaign = await reader.campaign();
        if (!campaign) return null;
        const activeChapter = await reader.chapter(campaign.activeChapterId);
        if (!activeChapter) return null;
        const missions = await client.query(
          "select * from mission_progress where profile_id=$1 order by mission_id",
          [profileId] as never[],
        );
        const openAttempt = await client.query(
          `select * from mission_attempts
           where profile_id=$1 and status='IN_PROGRESS'
           order by started_at desc limit 1`,
          [profileId] as never[],
        );
        const codex = await client.query(
          "select * from codex_cards where profile_id=$1 order by card_id",
          [profileId] as never[],
        );
        const chapterAbilities = await client.query(
          `select * from chapter_ability_unlocks
           where profile_id=$1 and chapter_id=$2 order by unlocked_at_level, ability_id`,
          [profileId, campaign.activeChapterId] as never[],
        );
        const pvpAbilities = await client.query(
          "select * from pvp_ability_loadout where profile_id=$1 order by ability_id",
          [profileId] as never[],
        );
        const openRow = openAttempt.rows[0] as Row | undefined;
        return {
          campaign,
          activeChapter,
          // Replaced by the service, which owns the authored curve.
          derived: {
            rank: campaign.rank,
            cumulativeLevels: campaign.cumulativeLevels,
            levelsToNextRank: 1,
            level: activeChapter.level,
            xp: activeChapter.xp,
            xpToNextLevel: null,
          },
          missions: (missions.rows as Row[]).map(toMission),
          openAttempt: openRow ? toAttempt(openRow) : null,
          codex: (codex.rows as Row[]).map(toCodexCard),
          chapterAbilities: (chapterAbilities.rows as Row[]).map((row) => ({
            profileId: row.profile_id as string,
            chapterId: row.chapter_id as string,
            abilityId: row.ability_id as string,
            unlockedAtLevel: row.unlocked_at_level as number,
            unlockedAt: iso(row.unlocked_at),
          })),
          pvpAbilities: (pvpAbilities.rows as Row[]).map((row) => ({
            profileId: row.profile_id as string,
            abilityId: row.ability_id as string,
            firstUnlockedChapterId: row.first_unlocked_chapter_id as string,
            firstUnlockedAtLevel: row.first_unlocked_at_level as number,
            firstUnlockedAt: iso(row.first_unlocked_at),
          })),
          conceptMastery: await reader.conceptMastery(campaign.activeChapterId),
        };
      } finally {
        client.release();
      }
    },
  };
}
