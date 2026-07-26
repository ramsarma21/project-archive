import {
  LEVELS_PER_RANK,
  MAX_MISSION_ATTEMPTS,
  MISSION_ATTEMPT_XP_FRACTIONS,
  STARTING_RANK,
  ZERO_XP,
  type AbilityMilestone,
  type AssessmentFormConcept,
  type CampaignProgression,
  type ChapterAssessmentAttempt,
  type ChapterAssessmentResponse,
  type ChapterProgression,
  type CodexCardState,
  type ConceptMastery,
  type MissionProgress,
  type ProgressionError,
  type ProgressionLedgerEntry,
  type XpCurve,
  type XpFraction,
} from "./progression.js";

// ============================================================================
// Pure progression arithmetic. No I/O, no clock, no randomness: every value
// the server writes is derived here, so the derivation can be unit-tested
// independently of the database and of the routes that call it.
// ============================================================================

function safeNonNegativeInt(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

// ---------------------------------------------------------------------------
// Rank
// ---------------------------------------------------------------------------

/**
 * Rank = 1 + floor(cumulative Levels / 10). Chapter-scoped Level resets, but
 * cumulative Levels do not, so the remainder toward the next Rank carries
 * across a chapter boundary.
 */
export function rankFromCumulativeLevels(cumulativeLevels: number): number {
  return (
    STARTING_RANK + Math.floor(safeNonNegativeInt(cumulativeLevels) / LEVELS_PER_RANK)
  );
}

/**
 * Rank is monotonic. It is stored, not recomputed on read, so no later change
 * to a curve or to a chapter's Levels can demote a player: the stored Rank
 * wins whenever the formula would go backwards.
 */
export function monotonicRank(previousRank: number, cumulativeLevels: number): number {
  const floor = Math.max(STARTING_RANK, Math.floor(previousRank));
  return Math.max(floor, rankFromCumulativeLevels(cumulativeLevels));
}

/** Levels still owed for the next Rank. Never 0, so a caption always reads. */
export function levelsToNextRank(cumulativeLevels: number): number {
  return LEVELS_PER_RANK - (safeNonNegativeInt(cumulativeLevels) % LEVELS_PER_RANK);
}

/** Cumulative Levels implied by one chapter row; the campaign total must match. */
export function cumulativeLevelsForChapter(
  chapter: Pick<ChapterProgression, "level" | "levelsAtChapterStart">,
): number {
  return (
    safeNonNegativeInt(chapter.levelsAtChapterStart) + safeNonNegativeInt(chapter.level)
  );
}

// ---------------------------------------------------------------------------
// XP curve
// ---------------------------------------------------------------------------

/** Level reached by a chapter XP total. Level 0 until the first threshold. */
export function levelForXp(curve: XpCurve, xp: number): number {
  const total = safeNonNegativeInt(xp);
  let level = 0;
  for (const threshold of curve.levelThresholds) {
    if (total < threshold) break;
    level += 1;
  }
  return level;
}

/** XP still owed for the next Level, or null at the top of the curve. */
export function xpToNextLevel(curve: XpCurve, xp: number): number | null {
  const total = safeNonNegativeInt(xp);
  const next = curve.levelThresholds[levelForXp(curve, total)];
  return next === undefined ? null : next - total;
}

// ---------------------------------------------------------------------------
// Attempts and XP decay
// ---------------------------------------------------------------------------

const ZERO_FRACTION: XpFraction = { numerator: 0, denominator: 1 };

/**
 * The exact XP fraction for an attempt ordinal: 3/3, then 2/3, then 1/3.
 * Beyond the third attempt, and for any ordinal outside 1..3, zero.
 */
export function attemptXpFraction(attemptOrdinal: number): XpFraction {
  if (!Number.isInteger(attemptOrdinal)) return ZERO_FRACTION;
  return MISSION_ATTEMPT_XP_FRACTIONS[attemptOrdinal - 1] ?? ZERO_FRACTION;
}

/** The same decay as a float, for display only. Awards use integer math. */
export function attemptXpMultiplier(attemptOrdinal: number): number {
  const fraction = attemptXpFraction(attemptOrdinal);
  return fraction.numerator / fraction.denominator;
}

/**
 * XP for one committed attempt. Only a clear pays, and the award floors so a
 * two-thirds share of a non-divisible base can never round upward into a
 * larger payout than the attempt before it.
 */
export function missionXpAward(input: {
  baseXp: number;
  attemptOrdinal: number;
  outcome: "CLEARED" | "FAILED";
}): number {
  if (input.outcome !== "CLEARED") return ZERO_XP;
  const base = safeNonNegativeInt(input.baseXp);
  const { numerator, denominator } = attemptXpFraction(input.attemptOrdinal);
  return Math.floor((base * numerator) / denominator);
}

type MissionAttemptCounters = Pick<MissionProgress, "attemptsUsed" | "outcome">;

/** CLEARED or FAILED_PERMANENT: the mission's story is over either way. */
export function isMissionTerminal(mission: MissionAttemptCounters): boolean {
  return mission.outcome === "CLEARED" || mission.outcome === "FAILED_PERMANENT";
}

/**
 * True when the mission can never be attempted again and will never pay XP
 * again: it was cleared, it was permanently failed, or all three attempts are
 * resolved. `attemptsUsed` counts resolved attempts, so a live run does not
 * make its own mission look spent.
 */
export function isMissionPermanentlySpent(mission: MissionAttemptCounters): boolean {
  return (
    isMissionTerminal(mission) ||
    safeNonNegativeInt(mission.attemptsUsed) >= MAX_MISSION_ATTEMPTS
  );
}

/** Attempts left. Zero once the mission is spent. */
export function remainingMissionAttempts(mission: MissionAttemptCounters): number {
  if (isMissionTerminal(mission)) return 0;
  return Math.max(
    0,
    MAX_MISSION_ATTEMPTS - safeNonNegativeInt(mission.attemptsUsed),
  );
}

/**
 * The ordinal the server would assign next, or null when the mission is spent.
 * The client never supplies this; that is what keeps the XP fraction honest.
 */
export function nextAttemptOrdinal(mission: MissionAttemptCounters): number | null {
  if (isMissionPermanentlySpent(mission)) return null;
  return safeNonNegativeInt(mission.attemptsUsed) + 1;
}

/**
 * A permanently failed mission still lets the player move on: advancement is
 * gated on the mission being resolved, never on it being cleared.
 */
export function canAdvancePastMission(mission: MissionAttemptCounters): boolean {
  return isMissionTerminal(mission);
}

/**
 * The module gate: a completion scoped to exactly the attempt about to open. A
 * retry therefore needs its own module run, because it finds no completion for
 * its own ordinal. Elapsed time is deliberately not a condition — the deck is
 * the requirement, and it is checked where the completion is minted.
 */
export function isModuleGateSatisfied(input: {
  completion: { gatesOrdinal: number } | null;
  attemptOrdinal: number;
}): boolean {
  return input.completion?.gatesOrdinal === input.attemptOrdinal;
}

/**
 * Whether a module run covered its authored deck. Order-independent: going back
 * to re-read a card must not cost the student the cards already read.
 */
export function moduleDeckCovered(
  deckCueIds: readonly string[],
  acknowledgedCueIds: readonly string[],
): boolean {
  const acknowledged = new Set(acknowledgedCueIds);
  return deckCueIds.every((cueId) => acknowledged.has(cueId));
}

// ---------------------------------------------------------------------------
// Abilities
// ---------------------------------------------------------------------------

/** Milestones this chapter has already granted at a given Level. */
export function unlockedAbilityMilestones(
  milestones: readonly AbilityMilestone[],
  chapterId: string,
  level: number,
): AbilityMilestone[] {
  const reached = safeNonNegativeInt(level);
  return milestones.filter(
    (milestone) => milestone.chapterId === chapterId && milestone.level <= reached,
  );
}

/** Milestones crossed by a Level gain, in ascending Level order. */
export function newlyUnlockedAbilityMilestones(
  milestones: readonly AbilityMilestone[],
  chapterId: string,
  fromLevel: number,
  toLevel: number,
): AbilityMilestone[] {
  const from = safeNonNegativeInt(fromLevel);
  const to = safeNonNegativeInt(toLevel);
  return milestones
    .filter(
      (milestone) =>
        milestone.chapterId === chapterId &&
        milestone.level > from &&
        milestone.level <= to,
    )
    .sort((a, b) => a.level - b.level);
}

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

/** Learned in single-player and usable there. Says nothing about PvP. */
export function isCodexCardLearned(card: Pick<CodexCardState, "learnedAt">): boolean {
  return typeof card.learnedAt === "string" && card.learnedAt.length > 0;
}

/** PvP-legal only at 100% mastery of the card's concept on the assessment. */
export function isCodexCardPvpLegal(
  card: Pick<CodexCardState, "pvpLegalAt">,
): boolean {
  return typeof card.pvpLegalAt === "string" && card.pvpLegalAt.length > 0;
}

// ---------------------------------------------------------------------------
// Assessment mastery
// ---------------------------------------------------------------------------

export function isConceptMastered(
  record: Pick<ConceptMastery, "masteredAt"> | undefined,
): boolean {
  return Boolean(record && record.masteredAt);
}

/** Concepts still owed mastery. A retry narrows to exactly this set. */
export function unmasteredConceptIds(
  chapterConceptIds: readonly string[],
  mastery: ReadonlyMap<string, Pick<ConceptMastery, "masteredAt">>,
): string[] {
  return chapterConceptIds.filter((conceptId) => !isConceptMastered(mastery.get(conceptId)));
}

/**
 * Items for one concept that this profile has never been served. A shrinking
 * retry must draw fresh items, so selection subtracts the per-concept ledger
 * from the authored reserve and reports exhaustion rather than repeating.
 */
export function selectFreshItems(input: {
  reserveItemIds: readonly string[];
  servedItemIds: readonly string[];
  count: number;
}): { itemIds: string[]; exhausted: boolean } {
  const served = new Set(input.servedItemIds);
  const fresh: string[] = [];
  for (const itemId of input.reserveItemIds) {
    if (served.has(itemId)) continue;
    fresh.push(itemId);
    if (fresh.length === input.count) break;
  }
  return { itemIds: fresh, exhausted: fresh.length < input.count };
}

/** The one attempt whose score is ever reported. */
export const REPORTED_FIRST_ATTEMPT_ORDINAL = 1;

export function isReportedFirstAttempt(
  attempt: Pick<ChapterAssessmentAttempt, "attemptOrdinal">,
): boolean {
  return attempt.attemptOrdinal === REPORTED_FIRST_ATTEMPT_ORDINAL;
}

/** A blank answer: no option chosen and no open response submitted. */
export function isBlankAssessmentResponse(
  response: Pick<ChapterAssessmentResponse, "selectedOptionId" | "responseRef">,
): boolean {
  return response.selectedOptionId === null && response.responseRef === null;
}

export interface ReportedFirstAttemptMeasure<T> {
  attempt: T;
  /**
   * Null when attempt 1 was abandoned or is still open. There is then no
   * reported score — and, deliberately, no later attempt inherits the title.
   */
  score: { numerator: number; denominator: number } | null;
}

/**
 * The reported measure, projected over attempt ordinal 1 alone.
 *
 * This is the only place the rule lives, and it is a projection rather than a
 * stored field precisely so a retry cannot be promoted into it. A student who
 * walks out of a weak first attempt keeps that first attempt as their reported
 * measure — with no score, because an abandoned attempt produced none — instead
 * of having the second attempt become the number on the report.
 */
export function reportedFirstAttemptMeasure<
  T extends Pick<
    ChapterAssessmentAttempt,
    "attemptOrdinal" | "status" | "scoreNumerator" | "scoreDenominator"
  >,
>(attempts: readonly T[]): ReportedFirstAttemptMeasure<T> | null {
  const first = attempts.find(isReportedFirstAttempt);
  if (!first) return null;
  if (
    first.status !== "SUBMITTED" ||
    first.scoreNumerator === null ||
    first.scoreDenominator === null
  ) {
    return { attempt: first, score: null };
  }
  return {
    attempt: first,
    score: {
      numerator: first.scoreNumerator,
      denominator: first.scoreDenominator,
    },
  };
}

export interface GradedAssessmentResponse {
  itemId: string;
  conceptId: string;
  correct: boolean;
}

export interface AssessmentConceptResult {
  conceptId: string;
  served: number;
  answered: number;
  correct: number;
  mastered: boolean;
}

export interface AssessmentFormSummary {
  byConcept: AssessmentConceptResult[];
  masteredConceptIds: string[];
  unmasteredConceptIds: string[];
  passed: boolean;
  scoreNumerator: number;
  scoreDenominator: number;
}

/**
 * Grade one submitted form. Mastery is 100% per concept with no partial
 * credit, and an unanswered item counts against the concept, so skipping is
 * never cheaper than answering. Passing requires every scoped concept.
 */
export function summarizeAssessmentForm(
  form: readonly AssessmentFormConcept[],
  responses: readonly GradedAssessmentResponse[],
): AssessmentFormSummary {
  const byItem = new Map(responses.map((response) => [response.itemId, response]));
  const byConcept: AssessmentConceptResult[] = form.map((entry) => {
    let answered = 0;
    let correct = 0;
    for (const itemId of entry.itemIds) {
      const response = byItem.get(itemId);
      if (!response) continue;
      answered += 1;
      if (response.correct) correct += 1;
    }
    return {
      conceptId: entry.conceptId,
      served: entry.itemIds.length,
      answered,
      correct,
      mastered: entry.itemIds.length > 0 && correct === entry.itemIds.length,
    };
  });
  return {
    byConcept,
    masteredConceptIds: byConcept.filter((c) => c.mastered).map((c) => c.conceptId),
    unmasteredConceptIds: byConcept.filter((c) => !c.mastered).map((c) => c.conceptId),
    passed: byConcept.length > 0 && byConcept.every((c) => c.mastered),
    scoreNumerator: byConcept.reduce((sum, c) => sum + c.correct, 0),
    scoreDenominator: byConcept.reduce((sum, c) => sum + c.served, 0),
  };
}

// ---------------------------------------------------------------------------
// The reducers
// ---------------------------------------------------------------------------

export interface MissionOutcomeCommit {
  missionId: string;
  chapterId: string;
  attemptOrdinal: number;
  outcome: "CLEARED" | "FAILED";
  /** Authored base award for the mission. Modules and assessments pass zero. */
  baseXp: number;
  at: string;
}

export interface ProgressionDelta {
  awardedXp: number;
  xpFraction: XpFraction;
  campaign: CampaignProgression;
  chapter: ChapterProgression;
  mission: MissionProgress;
  levelsGained: number;
  ranksGained: number;
  unlockedAbilities: AbilityMilestone[];
  ledger: ProgressionLedgerEntry[];
}

export type ProgressionResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: ProgressionError };

/**
 * The single derivation of everything a mission clear changes: XP, chapter
 * Level, cumulative Levels, Rank, ability unlocks, and the mission's terminal
 * state. Callers pass committed facts only — the ordinal the server assigned,
 * the mission's authored base award, and whether the run cleared.
 */
export function applyMissionOutcome(input: {
  campaign: CampaignProgression;
  chapter: ChapterProgression;
  mission: MissionProgress;
  commit: MissionOutcomeCommit;
  curve: XpCurve;
  abilityMilestones: readonly AbilityMilestone[];
}): ProgressionResult<ProgressionDelta> {
  const { campaign, chapter, mission, commit, curve } = input;
  if (chapter.chapterId !== commit.chapterId || chapter.status !== "ACTIVE") {
    return { ok: false, reason: "CHAPTER_NOT_ACTIVE" };
  }
  if (isMissionPermanentlySpent(mission)) {
    return { ok: false, reason: "MISSION_SPENT" };
  }
  if (commit.attemptOrdinal !== nextAttemptOrdinal(mission)) {
    return { ok: false, reason: "PROGRESSION_CONFLICT" };
  }

  const xpFraction = attemptXpFraction(commit.attemptOrdinal);
  const awardedXp = missionXpAward({
    baseXp: commit.baseXp,
    attemptOrdinal: commit.attemptOrdinal,
    outcome: commit.outcome,
  });

  const attemptsUsed = mission.attemptsUsed + 1;
  const cleared = commit.outcome === "CLEARED";
  const exhausted = attemptsUsed >= MAX_MISSION_ATTEMPTS;
  const nextMission: MissionProgress = {
    ...mission,
    attemptsUsed,
    outcome: cleared
      ? "CLEARED"
      : exhausted
        ? "FAILED_PERMANENT"
        : "IN_PROGRESS",
    awardedXp: mission.awardedXp + awardedXp,
    clearedOnAttempt: cleared ? commit.attemptOrdinal : mission.clearedOnAttempt,
    clearedAt: cleared ? commit.at : mission.clearedAt,
    failedAt: !cleared && exhausted ? commit.at : mission.failedAt,
    updatedAt: commit.at,
  };

  const xp = chapter.xp + awardedXp;
  const level = levelForXp(curve, xp);
  const levelsGained = Math.max(0, level - chapter.level);
  const cumulativeLevels = campaign.cumulativeLevels + levelsGained;
  const rank = monotonicRank(campaign.rank, cumulativeLevels);
  const unlockedAbilities = newlyUnlockedAbilityMilestones(
    input.abilityMilestones,
    chapter.chapterId,
    chapter.level,
    level,
  );

  const ledger: ProgressionLedgerEntry[] = [];
  const base = {
    chapterId: chapter.chapterId,
    missionId: commit.missionId,
    attemptId: null,
  };
  if (awardedXp > 0) {
    ledger.push({
      ...base,
      kind: "MISSION_XP_AWARDED",
      detail: {
        attemptOrdinal: commit.attemptOrdinal,
        baseXp: safeNonNegativeInt(commit.baseXp),
        numerator: xpFraction.numerator,
        denominator: xpFraction.denominator,
        awardedXp,
      },
    });
  }
  if (levelsGained > 0) {
    ledger.push({
      ...base,
      kind: "LEVEL_GAINED",
      detail: { from: chapter.level, to: level },
    });
  }
  if (rank > campaign.rank) {
    ledger.push({
      ...base,
      kind: "RANK_GAINED",
      detail: { from: campaign.rank, to: rank, cumulativeLevels },
    });
  }
  for (const ability of unlockedAbilities) {
    ledger.push({
      ...base,
      kind: "ABILITY_UNLOCKED",
      detail: { abilityId: ability.abilityId, level: ability.level },
    });
  }
  if (nextMission.outcome === "FAILED_PERMANENT") {
    ledger.push({
      ...base,
      kind: "MISSION_FAILED_PERMANENT",
      detail: { attemptsUsed },
    });
  }

  return {
    ok: true,
    value: {
      awardedXp,
      xpFraction,
      campaign: {
        ...campaign,
        rank,
        cumulativeLevels,
        revision: campaign.revision + 1,
        updatedAt: commit.at,
      },
      chapter: { ...chapter, level, xp, updatedAt: commit.at },
      mission: nextMission,
      levelsGained,
      ranksGained: rank - campaign.rank,
      unlockedAbilities,
      ledger,
    },
  };
}

/**
 * Begin a chapter. Level and XP reset to zero and PvE abilities are re-earned,
 * while Rank, cumulative Levels, the Codex, concept mastery, and the permanent
 * PvP loadout all carry. `levelsAtChapterStart` records the carry-in so the
 * partial progress toward the next Rank stays visible at the boundary.
 */
export function startChapter(input: {
  campaign: CampaignProgression;
  chapterId: string;
  at: string;
}): { campaign: CampaignProgression; chapter: ChapterProgression; ledger: ProgressionLedgerEntry[] } {
  const { campaign, chapterId, at } = input;
  return {
    campaign: {
      ...campaign,
      activeChapterId: chapterId,
      revision: campaign.revision + 1,
      updatedAt: at,
    },
    chapter: {
      profileId: campaign.profileId,
      chapterId,
      level: 0,
      xp: 0,
      levelsAtChapterStart: campaign.cumulativeLevels,
      status: "ACTIVE",
      assessmentPassedAt: null,
      startedAt: at,
      completedAt: null,
      updatedAt: at,
    },
    ledger: [
      {
        kind: "CHAPTER_STARTED",
        chapterId,
        missionId: null,
        attemptId: null,
        detail: {
          levelsAtChapterStart: campaign.cumulativeLevels,
          rank: campaign.rank,
        },
      },
    ],
  };
}
