// Who holds what, in which encounter.
//
// @pa/duel is explicit that it does not compute unlocks: "The shared layer hands
// the duel a resolved loadout: the abilities this player actually holds in this
// duel, already filtered by chapter scope and level." This module is that shared
// layer. Resolution happens here, once, for both encounters.
//
// ============================================================================
// TWO SCOPES, ONE RULE
// ============================================================================
//
//   PvE  is CHAPTER-SCOPED. Level resets at the chapter boundary, so the set
//        resets with it and is re-earned from Level 0 in the next chapter.
//   PvP  is PERMANENT. Every ability ever unlocked, in any chapter, stays in the
//        pool forever.
//
// Both then obey the same selection rule, and that matters more than it looks.
//
// ============================================================================
// WHY THERE IS A SLOT CAP AT ALL
// ============================================================================
//
// "Permanent in the PvP loadout" plus "chapter-scoped in PvE" plus five chapters
// is a pool of roughly forty abilities by the end of the game. One use each across
// six 20-second rounds would be forty single-use buttons in a two-minute fight:
// unreadable for the player, and a balance surface nobody can reason about.
//
// So the pool grows forever and the LOADOUT does not. Four slots:
//
//   * six rounds and four single-use abilities means you cannot cover every
//     round, so WHEN to spend one is a real decision;
//   * four is small enough that choosing from a growing pool is a real decision
//     too, which is the point of a pool that grows;
//   * it is one number, here, if playtest wants five.
//
// The cap applies in PvE as well as PvP, and that is the consistency rule doing
// its job: an ability behaves the same in both encounters, so the number of them
// you may carry should not change either. A Boston player only meets the cap at
// Level 11, five abilities in, by which point they have run the loop nine times.
//
// The default selection is deterministic — highest unlock Level first, then id —
// so the system is shippable before any loadout UI exists, and a replay of a
// duel with no explicit selection resolves the same loadout every time.

import type { GameAbility } from "./ability.js";
import { BOSTON_ABILITIES } from "./boston.js";
import {
  AbilityMilestoneSchema,
  unlockedAbilityMilestones,
  type AbilityMilestone,
} from "./contractsSurface.js";
import {
  ABILITY_CHAPTER_IDS,
  BOSTON_CHAPTER_ID,
  UnknownAbilityChapterError,
  resolveAbilityChapterId,
} from "./chapters.js";
import type { AbilityLoadout } from "./duelSurface.js";
import { toDuelLoadout } from "./ability.js";

/** How many abilities may be carried into one encounter, PvE or PvP. */
export const ABILITY_LOADOUT_SLOTS = 4;

// ---------------------------------------------------------------------------
// milestones, in the shape @pa/contracts stores
// ---------------------------------------------------------------------------

/**
 * The unlock schedule as `AbilityMilestone` rows, validated. This is what the
 * progression service persists and what `newlyUnlockedAbilityMilestones` reads to
 * decide what a Level gain just minted.
 */
export const BOSTON_ABILITY_MILESTONES: readonly AbilityMilestone[] =
  BOSTON_ABILITIES.map((ability) =>
    AbilityMilestoneSchema.parse({
      abilityId: ability.abilityId,
      chapterId: BOSTON_CHAPTER_ID,
      level: ability.unlockedAtLevel,
    }),
  );

// ---------------------------------------------------------------------------
// unlock queries
// ---------------------------------------------------------------------------

/** Abilities a Boston Level has unlocked, in unlock order. */
export function bostonAbilitiesAtLevel(level: number): readonly GameAbility[] {
  const reached = Number.isFinite(level) ? Math.max(0, Math.floor(level)) : 0;
  return BOSTON_ABILITIES.filter((ability) => ability.unlockedAtLevel <= reached);
}

/**
 * The same question answered through @pa/contracts' own filter, so the two
 * derivations cannot drift. Used by the tests to prove they agree.
 */
export function bostonMilestonesAtLevel(level: number): AbilityMilestone[] {
  return unlockedAbilityMilestones(
    BOSTON_ABILITY_MILESTONES,
    BOSTON_CHAPTER_ID,
    level,
  );
}

// ---------------------------------------------------------------------------
// selection
// ---------------------------------------------------------------------------

/**
 * Pick at most `ABILITY_LOADOUT_SLOTS` from a pool.
 *
 * With an explicit selection, pool order is preserved and unknown or unheld ids
 * are dropped rather than erroring: a stale selection from before a chapter reset
 * must degrade to a smaller loadout, never fail a deploy.
 *
 * With no selection, the newest abilities are taken first — highest unlock Level,
 * then id ascending for a stable tie — because the ability a player just earned is
 * the one they want to try.
 */
function selectSlots(
  pool: readonly GameAbility[],
  selectedAbilityIds?: readonly string[],
): readonly GameAbility[] {
  if (selectedAbilityIds && selectedAbilityIds.length > 0) {
    const wanted = new Set(selectedAbilityIds);
    return pool.filter((ability) => wanted.has(ability.abilityId)).slice(
      0,
      ABILITY_LOADOUT_SLOTS,
    );
  }
  return [...pool]
    .sort(
      (a, b) =>
        b.unlockedAtLevel - a.unlockedAtLevel ||
        (a.abilityId < b.abilityId ? -1 : a.abilityId > b.abilityId ? 1 : 0),
    )
    .slice(0, ABILITY_LOADOUT_SLOTS);
}

export interface ResolvedLoadout {
  /** Everything the player holds in this scope, before the slot cap. */
  readonly pool: readonly GameAbility[];
  /** What they carry into this encounter. */
  readonly carried: readonly GameAbility[];
  /** The same list widened to what @pa/duel consumes. */
  readonly duelLoadout: AbilityLoadout;
}

/**
 * PvE resolution: chapter-scoped, by Level.
 *
 * THROWS `UnknownAbilityChapterError` FOR A CHAPTER THIS PACKAGE DOES NOT AUTHOR,
 * rather than answering with an empty pool. It used to answer empty, and that was
 * the whole exposure of the `BOSTON`/`boston-1765` divergence: a Level 34 player
 * whose chapter id was spelled the way every other layer spells it would have
 * deployed with nothing, and an empty loadout is a legal state — a Level 0 player
 * has one — so nothing downstream could tell the two apart.
 *
 * The chapter id is canonicalised first, so a superseded spelling reaches
 * Boston's abilities instead of none of them. A caller holding an id it did not
 * author — one read out of a request or a stored profile — checks
 * `isAbilityChapterId` first rather than catching.
 */
export function resolveChapterLoadout(input: {
  chapterId: string;
  level: number;
  selectedAbilityIds?: readonly string[];
}): ResolvedLoadout {
  const chapter = resolveAbilityChapterId(input.chapterId);
  if (chapter === null) {
    throw new UnknownAbilityChapterError(input.chapterId, [...ABILITY_CHAPTER_IDS]);
  }
  // Still compared against Boston explicitly rather than assumed from a
  // successful resolve. `ABILITY_CHAPTER_IDS` holds one chapter today, so the two
  // are the same test — but the day a second is registered, assuming would hand
  // Boston's abilities to it, which is the other half of what this function is
  // for. A registered chapter with no set here resolves empty; an unregistered
  // one throws above.
  const pool =
    chapter === BOSTON_CHAPTER_ID ? bostonAbilitiesAtLevel(input.level) : [];
  const carried = selectSlots(pool, input.selectedAbilityIds);
  return { pool, carried, duelLoadout: toDuelLoadout(carried) };
}

/**
 * PvP resolution: the permanent pool, whatever chapter minted it.
 *
 * Takes ids rather than Levels because the permanent pool is stored as ids (see
 * `PvpAbilityUnlockSchema`) and because it spans chapters, so no single Level
 * describes it. Ids this package does not know are dropped — another chapter's
 * abilities resolve in that chapter's package, and this one refuses to guess.
 */
export function resolvePvpLoadout(input: {
  unlockedAbilityIds: readonly string[];
  selectedAbilityIds?: readonly string[];
}): ResolvedLoadout {
  const unlocked = new Set(input.unlockedAbilityIds);
  const pool = BOSTON_ABILITIES.filter((ability) => unlocked.has(ability.abilityId));
  const carried = selectSlots(pool, input.selectedAbilityIds);
  return { pool, carried, duelLoadout: toDuelLoadout(carried) };
}
