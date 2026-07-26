import {
  MAX_MISSION_ATTEMPTS,
  STARTING_RANK,
  isCodexCardLearned,
  isCodexCardPvpLegal,
  isConceptMastered,
  isMissionPermanentlySpent,
  isMissionTerminal,
  levelsToNextRank,
  monotonicRank,
  nextAttemptOrdinal,
  remainingMissionAttempts,
  type ConceptMastery,
  type MissionAttempt,
  type MissionOutcome,
  type ProgressionSnapshot,
} from "@pa/contracts";

// ---------------------------------------------------------------------------
// The read model.
//
// One projection of the server's snapshot into the shape the hub, the mission
// gate and the loadout all read. It exists so there is exactly one answer to
// "how many attempts are left on M3" rather than one per surface, and so that
// every one of those answers is computed by @pa/contracts rather than restated
// here — the server runs the same functions when it writes the rows, and a
// second copy of the arithmetic in the client is a divergence waiting to be
// exploited.
//
// Nothing in this file decides anything. It reads committed server state and
// arranges it. The only judgement it makes is Rank, and it makes that one
// through `monotonicRank` for the reason below.
// ---------------------------------------------------------------------------

/** What the hub knows about one mission, all of it from the server. */
export interface MissionStanding {
  readonly missionId: string;
  /** Resolved attempts. A live run is not counted until it ends. */
  readonly attemptsUsed: number;
  readonly outcome: MissionOutcome;
  readonly attemptsRemaining: number;
  /** The ordinal the server would assign next, or null once spent. */
  readonly nextAttemptOrdinal: number | null;
  /** Cleared, or all three attempts burned. Pays zero forever either way. */
  readonly spent: boolean;
  /** Resolved: the player advances past it, cleared or not. */
  readonly resolved: boolean;
  readonly awardedXp: number;
}

/**
 * The Codex in its two states, never collapsed.
 *
 * `learned` is single-player possession. `pvpLegal` is the subset minted by
 * 100% mastery of the card's concept on the chapter capstone. A card can be
 * learned and not PvP-legal; nothing is PvP-legal without being learned.
 */
export interface CodexStanding {
  readonly learnedCardIds: readonly string[];
  readonly pvpLegalCardIds: readonly string[];
}

/** Ability unlocks in their two scopes: this chapter's, and forever. */
export interface AbilityStanding {
  /** Re-earned from Level 0 when a chapter begins. */
  readonly chapterUnlockedIds: readonly string[];
  /** Every ability ever unlocked, in any chapter. Never shrinks. */
  readonly pvpUnlockedIds: readonly string[];
}

export interface ProgressionView {
  readonly profileId: string;
  readonly chapterId: string;
  /** Chapter-scoped. Both reset to zero at a chapter boundary. */
  readonly level: number;
  readonly xp: number;
  readonly xpToNextLevel: number | null;
  /** Every Level earned in every chapter. */
  readonly cumulativeLevels: number;
  /** Monotonic and server-stored. See `monotonicRank` below. */
  readonly rank: number;
  readonly levelsToNextRank: number;
  readonly missions: ReadonlyMap<string, MissionStanding>;
  /** Missions the player may advance past. Feeds the chapter route. */
  readonly resolvedMissionIds: ReadonlySet<string>;
  /** A run the server still has open. Non-null means an attempt is unfinished. */
  readonly openAttempt: MissionAttempt | null;
  readonly codex: CodexStanding;
  readonly abilities: AbilityStanding;
  /**
   * Mastery keyed by chapter and then by concept.
   *
   * Two levels rather than one on purpose. `mastery_reports` was keyed on the
   * profile alone, so the second chapter's report overwrote the first and a
   * year's evidence became one chapter's. Nothing in this client is allowed to
   * hold a per-concept figure that cannot say which chapter produced it.
   */
  readonly masteryByChapter: ReadonlyMap<string, ReadonlyMap<string, ConceptMastery>>;
  /** The capstone has been passed and the next chapter is open. */
  readonly assessmentPassed: boolean;
}

/** The state a profile with no server row is in: Level 0, 0 XP, Rank 1. */
export function newRunnerView(chapterId: string, profileId = ""): ProgressionView {
  return {
    profileId,
    chapterId,
    level: 0,
    xp: 0,
    xpToNextLevel: null,
    cumulativeLevels: 0,
    rank: STARTING_RANK,
    levelsToNextRank: levelsToNextRank(0),
    missions: new Map(),
    resolvedMissionIds: new Set(),
    openAttempt: null,
    codex: { learnedCardIds: [], pvpLegalCardIds: [] },
    abilities: { chapterUnlockedIds: [], pvpUnlockedIds: [] },
    masteryByChapter: new Map(),
    assessmentPassed: false,
  };
}

export function missionStanding(
  missionId: string,
  row: { attemptsUsed: number; outcome: MissionOutcome; awardedXp: number } | undefined,
): MissionStanding {
  const counters = row ?? { attemptsUsed: 0, outcome: "UNSTARTED" as const, awardedXp: 0 };
  return {
    missionId,
    attemptsUsed: counters.attemptsUsed,
    outcome: counters.outcome,
    attemptsRemaining: remainingMissionAttempts(counters),
    nextAttemptOrdinal: nextAttemptOrdinal(counters),
    spent: isMissionPermanentlySpent(counters),
    resolved: isMissionTerminal(counters),
    awardedXp: counters.awardedXp,
  };
}

/**
 * Project a server snapshot.
 *
 * Rank is taken through `monotonicRank(stored, cumulativeLevels)` rather than
 * from either input alone. The stored value is already monotonic — the API
 * writes it that way and a database trigger refuses a decrease — so this is
 * belt and braces, and it is worth having: the failure it prevents is a
 * player reloading the page and watching their Rank fall, which on a
 * Rank-bracketed ladder is not a cosmetic bug but a change of opponent.
 */
export function projectProgression(snapshot: ProgressionSnapshot): ProgressionView {
  const chapterId = snapshot.activeChapter.chapterId;
  const cumulativeLevels = snapshot.campaign.cumulativeLevels;
  const rank = monotonicRank(snapshot.campaign.rank, cumulativeLevels);

  const missions = new Map<string, MissionStanding>();
  const resolvedMissionIds = new Set<string>();
  for (const row of snapshot.missions) {
    const standing = missionStanding(row.missionId, row);
    missions.set(row.missionId, standing);
    if (standing.resolved) resolvedMissionIds.add(row.missionId);
  }

  const masteryByChapter = new Map<string, Map<string, ConceptMastery>>();
  for (const row of snapshot.conceptMastery) {
    const forChapter = masteryByChapter.get(row.chapterId) ?? new Map();
    forChapter.set(row.conceptId, row);
    masteryByChapter.set(row.chapterId, forChapter);
  }

  return {
    profileId: snapshot.campaign.profileId,
    chapterId,
    level: snapshot.derived.level,
    xp: snapshot.derived.xp,
    xpToNextLevel: snapshot.derived.xpToNextLevel,
    cumulativeLevels,
    rank,
    levelsToNextRank: levelsToNextRank(cumulativeLevels),
    missions,
    resolvedMissionIds,
    openAttempt: snapshot.openAttempt,
    codex: {
      learnedCardIds: snapshot.codex.filter(isCodexCardLearned).map((c) => c.cardId),
      pvpLegalCardIds: snapshot.codex.filter(isCodexCardPvpLegal).map((c) => c.cardId),
    },
    abilities: {
      chapterUnlockedIds: snapshot.chapterAbilities
        .filter((row) => row.chapterId === chapterId)
        .map((row) => row.abilityId),
      pvpUnlockedIds: snapshot.pvpAbilities.map((row) => row.abilityId),
    },
    masteryByChapter,
    assessmentPassed: snapshot.activeChapter.assessmentPassedAt !== null,
  };
}

/** One mission's standing, defaulting to untouched. */
export function standingFor(view: ProgressionView, missionId: string): MissionStanding {
  return view.missions.get(missionId) ?? missionStanding(missionId, undefined);
}

/**
 * Concepts this chapter has driven to 100% mastery.
 *
 * Read per chapter rather than across all of them, because the same concept can
 * be assessed again in a later chapter and "mastered in Boston" is not the same
 * claim as "mastered".
 */
export function masteredConceptIds(
  view: ProgressionView,
  chapterId: string,
): string[] {
  const forChapter = view.masteryByChapter.get(chapterId);
  if (!forChapter) return [];
  return [...forChapter.values()]
    .filter((row) => isConceptMastered(row))
    .map((row) => row.conceptId);
}

/**
 * Every attempt the chapter's played missions have spent.
 *
 * The figure the "no unlimited replays" rule is really about, and the one that
 * used to live only in a browser: if this number can be reset, the rule does
 * not exist.
 */
export function attemptsSpent(view: ProgressionView): number {
  let total = 0;
  for (const standing of view.missions.values()) total += standing.attemptsUsed;
  return total;
}

export { MAX_MISSION_ATTEMPTS };
