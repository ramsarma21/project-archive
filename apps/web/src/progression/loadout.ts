import type { ChapterAbilityUnlock, PvpAbilityUnlock } from "@pa/contracts";
import { readLoadout, writeLoadout } from "../db.js";
import type { ProgressionView } from "./projection.js";

// ---------------------------------------------------------------------------
// The equipped loadout.
//
// Two facts, stored in two different places, because they have two different
// threat models:
//
//   WHICH ABILITIES ARE UNLOCKED is a grant. It is worth something, so it is
//   server-authoritative — written by the progression service when a Level
//   milestone is crossed, chapter-scoped in `chapter_ability_unlocks` and
//   permanent in `pvp_ability_loadout`.
//
//   WHICH FOUR ARE CARRIED is a preference. It is worth nothing on its own, so
//   it lives on the device. A player who edits this row can only reorder or
//   narrow what they already hold: `resolveEquipped` intersects the stored
//   selection with the server's unlock set before returning it, so an id that
//   was never granted is dropped rather than honoured. There is no cheat in
//   choosing badly.
//
// That intersection is the whole security argument, and it is also what makes
// a stale selection harmless: a PvE selection carried across a chapter boundary
// names abilities the new chapter has not re-granted, and the correct behaviour
// is a smaller loadout, never a failed deploy.
// ---------------------------------------------------------------------------

/**
 * How many abilities may be carried into one encounter.
 *
 * The authority is `ABILITY_LOADOUT_SLOTS` in packages/abilities/src/loadout.ts,
 * which reasons about why four and not five. `@pa/web` does not depend on that
 * package yet, so this is a stated mirror rather than a silent second opinion;
 * it becomes a re-export the day the dependency is added.
 */
export const EQUIPPED_ABILITY_SLOTS = 4;

/** PvE is chapter-scoped and re-earned; PvP is permanent and spans chapters. */
export type LoadoutScope =
  | { readonly kind: "PVE"; readonly chapterId: string }
  | { readonly kind: "PVP" };

export function loadoutScopeKey(scope: LoadoutScope): string {
  return scope.kind === "PVE" ? `PVE:${scope.chapterId}` : "PVP";
}

/** An unlock row in either scope, reduced to what selection needs. */
interface UnlockedAbility {
  readonly abilityId: string;
  readonly level: number;
}

function chapterPool(
  rows: readonly ChapterAbilityUnlock[],
  chapterId: string,
): UnlockedAbility[] {
  return rows
    .filter((row) => row.chapterId === chapterId)
    .map((row) => ({ abilityId: row.abilityId, level: row.unlockedAtLevel }));
}

function pvpPool(rows: readonly PvpAbilityUnlock[]): UnlockedAbility[] {
  return rows.map((row) => ({
    abilityId: row.abilityId,
    level: row.firstUnlockedAtLevel,
  }));
}

/**
 * The default four, when the player has never chosen.
 *
 * Newest first — highest unlock Level, then id ascending for a stable tie —
 * because the ability somebody just earned is the one they want to try. The
 * ordering is total and derived only from server rows, so two devices showing
 * the same profile show the same default loadout.
 */
function defaultSelection(pool: readonly UnlockedAbility[]): string[] {
  return [...pool]
    .sort(
      (a, b) =>
        b.level - a.level ||
        (a.abilityId < b.abilityId ? -1 : a.abilityId > b.abilityId ? 1 : 0),
    )
    .slice(0, EQUIPPED_ABILITY_SLOTS)
    .map((ability) => ability.abilityId);
}

export interface ResolvedEquipped {
  /** Everything held in this scope, before the slot cap. */
  readonly pool: readonly string[];
  /** What is carried: at most four, every one of them actually unlocked. */
  readonly carried: readonly string[];
  /** True when the player has chosen; false when this is the default. */
  readonly chosen: boolean;
  /** Selected ids the server has not granted. Dropped, and reported. */
  readonly droppedIds: readonly string[];
}

/**
 * Intersect a stored selection with the unlock set.
 *
 * Pool order is preserved for an explicit selection so the four slots read the
 * same way every time, and unknown ids are dropped rather than raising: a
 * selection made in Boston and read in the next chapter must degrade to a
 * smaller loadout, never refuse the deploy.
 */
export function resolveEquipped(input: {
  pool: readonly UnlockedAbility[];
  selectedAbilityIds: readonly string[] | null;
}): ResolvedEquipped {
  const poolIds = input.pool.map((ability) => ability.abilityId);
  const held = new Set(poolIds);
  const selection = input.selectedAbilityIds ?? [];
  if (selection.length === 0) {
    return {
      pool: poolIds,
      carried: defaultSelection(input.pool),
      chosen: false,
      droppedIds: [],
    };
  }
  const wanted = new Set(selection);
  return {
    pool: poolIds,
    carried: poolIds.filter((id) => wanted.has(id)).slice(0, EQUIPPED_ABILITY_SLOTS),
    chosen: true,
    droppedIds: selection.filter((id) => !held.has(id)),
  };
}

/** The unlock pool for a scope, read from the server snapshot's projection. */
export function poolFor(
  view: ProgressionView,
  scope: LoadoutScope,
  snapshotRows: {
    readonly chapterAbilities: readonly ChapterAbilityUnlock[];
    readonly pvpAbilities: readonly PvpAbilityUnlock[];
  },
): UnlockedAbility[] {
  return scope.kind === "PVE"
    ? chapterPool(snapshotRows.chapterAbilities, scope.chapterId)
    : pvpPool(snapshotRows.pvpAbilities);
}

export async function readEquipped(
  profileId: string,
  scope: LoadoutScope,
): Promise<string[] | null> {
  const row = await readLoadout(profileId, loadoutScopeKey(scope));
  return row ? [...row.abilityIds] : null;
}

/**
 * Store a selection.
 *
 * Capped on write as well as on read. Two checks of the same rule, and the
 * write-side one is the cheap one: a UI bug that offers a fifth slot is caught
 * before it becomes a stored row that every later read has to defend against.
 */
export async function writeEquipped(input: {
  profileId: string;
  scope: LoadoutScope;
  abilityIds: readonly string[];
  at: string;
}): Promise<void> {
  await writeLoadout({
    profileId: input.profileId,
    scope: loadoutScopeKey(input.scope),
    abilityIds: [...input.abilityIds].slice(0, EQUIPPED_ABILITY_SLOTS),
    updatedAt: input.at,
  });
}
