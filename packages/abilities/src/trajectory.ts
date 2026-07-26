// What the curve actually does to a player.
//
// A curve is only as good as the trajectories it produces, and Rank is the PvP
// matchmaking input, so "what Rank does a real student finish Boston at" has to be
// a computed answer rather than an estimate in a design document. This module
// computes it. Every number reported about the curve comes from here, and
// trajectory.test.ts pins the ones that were reported to the owner.
//
// An archetype is just an attempt plan: for each of the fourteen missions, which
// attempt the player cleared on, or 0 for a mission they exhausted and failed.
// Everything else — XP, Level, cumulative Levels, Rank, unlocks — is derived by
// @pa/contracts' own functions, never by arithmetic invented here.

import { bostonAbilitiesAtLevel } from "./loadout.js";
import {
  MAX_MISSION_ATTEMPTS,
  STARTING_RANK,
  rankFromCumulativeLevels,
} from "./contractsSurface.js";
import {
  BOSTON_MISSION_COUNT,
  levelFor,
  missionAward,
  xpOwedForNextLevel,
} from "./curve.js";
import { BOSTON_MISSIONS } from "./missions.js";

/**
 * Attempt each mission was cleared on, in slate order. 1, 2 or 3 for a clear;
 * 0 for a mission that burned all three attempts and paid nothing.
 */
export type AttemptPlan = readonly number[];

export interface PlayerArchetype {
  readonly archetypeId: string;
  readonly label: string;
  readonly note: string;
  readonly plan: AttemptPlan;
}

function plan(fill: number): number[] {
  return Array.from({ length: BOSTON_MISSION_COUNT }, () => fill);
}

/** Cleared on attempt `attempt` from mission `from` onward (1-based, inclusive). */
function from(base: number[], fromOrdinal: number, attempt: number): number[] {
  const next = [...base];
  for (let ordinal = fromOrdinal; ordinal <= BOSTON_MISSION_COUNT; ordinal += 1) {
    next[ordinal - 1] = attempt;
  }
  return next;
}

/**
 * The six archetypes the curve is judged against.
 *
 * GRINDER is the load-bearing one. It is the worst-paying player who still
 * finishes everything — every mission cleared, every one of them on the last
 * attempt that pays — and it is the floor the ability schedule is derived from,
 * because it is the weakest player the design refuses to abandon.
 *
 * SPECTATOR is the other end and exists to make one thing undeniable: a player can
 * legitimately arrive at the capstone at Level 0 with an empty loadout, because
 * failing a mission advances you anyway. Any mission requiring an ability is a
 * deadlock for this row.
 */
export const BOSTON_ARCHETYPES: readonly PlayerArchetype[] = [
  {
    archetypeId: "FLAWLESS",
    label: "Flawless",
    note: "Clears all fourteen on the first attempt. The chapter's XP ceiling.",
    plan: plan(1),
  },
  {
    archetypeId: "STRONG",
    label: "Strong",
    note: "First-attempt clears through M10, then needs one retry on each of the last four.",
    plan: from(plan(1), 11, 2),
  },
  {
    archetypeId: "TYPICAL",
    label: "Typical",
    note: "Clears most on the first or second attempt: nine firsts, four seconds, one third.",
    plan: [1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3],
  },
  {
    archetypeId: "STRUGGLING",
    label: "Struggling",
    note: "Three firsts, four seconds, four thirds, and three missions failed outright.",
    plan: [1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 0, 0, 0],
  },
  {
    archetypeId: "GRINDER",
    label: "Grinder",
    note: "Finishes every mission but always on the last paying attempt. The floor the unlock schedule is derived from.",
    plan: plan(MAX_MISSION_ATTEMPTS),
  },
  {
    archetypeId: "SPECTATOR",
    label: "Spectator",
    note: "Fails every mission. Still does every module, still reaches the capstone, still must reach 100%.",
    plan: plan(0),
  },
];

// ---------------------------------------------------------------------------
// the walk
// ---------------------------------------------------------------------------

export interface TrajectoryStep {
  readonly missionId: string;
  readonly ordinal: number;
  /** Level held on ARRIVING at this mission, before it pays. */
  readonly levelOnArrival: number;
  /** Chapter XP held on arriving. */
  readonly xpOnArrival: number;
  readonly attemptCleared: number;
  readonly awardedXp: number;
  readonly xpAfter: number;
  readonly levelAfter: number;
  readonly levelsGained: number;
  /** Ability ids held after this mission pays. */
  readonly abilityIdsAfter: readonly string[];
}

export interface Trajectory {
  readonly archetypeId: string;
  readonly steps: readonly TrajectoryStep[];
  readonly finalXp: number;
  readonly finalLevel: number;
  /** Boston is chapter one, so cumulative Levels equal the chapter's Levels. */
  readonly cumulativeLevels: number;
  readonly finalRank: number;
  readonly xpToNextLevel: number | null;
  readonly abilityIds: readonly string[];
  readonly abilitiesUnlocked: number;
}

/**
 * Walk a plan through the chapter.
 *
 * Boston is chapter one, so the player enters at Level 0 with 0 cumulative Levels
 * and Rank 1, and the chapter's Levels ARE the cumulative Levels. A later chapter
 * would carry a non-zero `levelsAtChapterStart`; the reducer that does that lives
 * in @pa/contracts and this function deliberately does not duplicate it.
 */
export function walkChapter(archetype: PlayerArchetype): Trajectory {
  const steps: TrajectoryStep[] = [];
  let xp = 0;
  let level = 0;

  for (const mission of BOSTON_MISSIONS) {
    const attemptCleared = archetype.plan[mission.ordinal - 1] ?? 0;
    const awardedXp =
      attemptCleared >= 1 ? missionAward(mission.ordinal, attemptCleared) : 0;
    const xpAfter = xp + awardedXp;
    const levelAfter = levelFor(xpAfter);
    steps.push({
      missionId: mission.missionId,
      ordinal: mission.ordinal,
      levelOnArrival: level,
      xpOnArrival: xp,
      attemptCleared,
      awardedXp,
      xpAfter,
      levelAfter,
      levelsGained: levelAfter - level,
      abilityIdsAfter: bostonAbilitiesAtLevel(levelAfter).map((a) => a.abilityId),
    });
    xp = xpAfter;
    level = levelAfter;
  }

  const abilityIds = bostonAbilitiesAtLevel(level).map((a) => a.abilityId);
  return {
    archetypeId: archetype.archetypeId,
    steps,
    finalXp: xp,
    finalLevel: level,
    cumulativeLevels: level,
    finalRank: rankFromCumulativeLevels(level),
    xpToNextLevel: xpOwedForNextLevel(xp),
    abilityIds,
    abilitiesUnlocked: abilityIds.length,
  };
}

/** Every archetype walked, keyed by id. */
export function walkAllArchetypes(): Map<string, Trajectory> {
  return new Map(
    BOSTON_ARCHETYPES.map((archetype) => [
      archetype.archetypeId,
      walkChapter(archetype),
    ]),
  );
}

export function archetype(archetypeId: string): PlayerArchetype {
  const found = BOSTON_ARCHETYPES.find((row) => row.archetypeId === archetypeId);
  if (!found) throw new Error(`unknown archetype: ${archetypeId}`);
  return found;
}

/**
 * Level held on ARRIVING at each mission, keyed by mission id. This is the number
 * the unlock schedule is validated against: an unlock at or below the arrival Level
 * is an unlock the player holds when they first meet the thing it is for.
 */
export function arrivalLevels(archetypeId: string): Map<string, number> {
  return new Map(
    walkChapter(archetype(archetypeId)).steps.map((step) => [
      step.missionId,
      step.levelOnArrival,
    ]),
  );
}

// ---------------------------------------------------------------------------
// the reported summary
// ---------------------------------------------------------------------------

export interface RankReport {
  readonly archetypeId: string;
  readonly label: string;
  readonly finalXp: number;
  readonly finalLevel: number;
  readonly finalRank: number;
  readonly abilitiesUnlocked: number;
  /** Smallest and largest Levels gained by any single mission that paid. */
  readonly levelsPerPayingMission: { readonly min: number; readonly max: number };
}

/** The table reported to the owner. Pinned by trajectory.test.ts. */
export function rankReport(): readonly RankReport[] {
  return BOSTON_ARCHETYPES.map((row) => {
    const walked = walkChapter(row);
    const paying = walked.steps.filter((step) => step.awardedXp > 0);
    const gains = paying.map((step) => step.levelsGained);
    return {
      archetypeId: row.archetypeId,
      label: row.label,
      finalXp: walked.finalXp,
      finalLevel: walked.finalLevel,
      finalRank: walked.finalRank,
      abilitiesUnlocked: walked.abilitiesUnlocked,
      levelsPerPayingMission: {
        min: gains.length > 0 ? Math.min(...gains) : 0,
        max: gains.length > 0 ? Math.max(...gains) : 0,
      },
    };
  });
}

/**
 * The Ranks Boston can actually produce, low to high. If this ever collapses to a
 * single value the ladder is broken before it ships, which is the failure mode the
 * brief called out; `verify.ts` asserts against it.
 */
export function attainableRanks(): readonly number[] {
  const ranks = new Set<number>([STARTING_RANK]);
  for (const row of BOSTON_ARCHETYPES) ranks.add(walkChapter(row).finalRank);
  return [...ranks].sort((a, b) => a - b);
}
