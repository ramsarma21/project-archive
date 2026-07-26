import assert from "node:assert/strict";
import test from "node:test";

import { AbilityMilestoneSchema, newlyUnlockedAbilityMilestones } from "../contractsSurface.js";
import {
  BOSTON_ABILITIES,
  FARSIGHT,
  KITE_STEP,
  LONG_STRIDE,
  OUT_OF_TIME,
  POWDER_DAMP,
  WARD_CHIME,
} from "../boston.js";
import { BOSTON_CHAPTER_ID, UnknownAbilityChapterError } from "../chapters.js";
import {
  ABILITY_LOADOUT_SLOTS,
  BOSTON_ABILITY_MILESTONES,
  bostonAbilitiesAtLevel,
  bostonMilestonesAtLevel,
  resolveChapterLoadout,
  resolvePvpLoadout,
} from "../loadout.js";

const ids = (abilities: readonly { abilityId: string }[]) =>
  abilities.map((ability) => ability.abilityId);

test("the milestones validate against the contracts schema", () => {
  assert.equal(BOSTON_ABILITY_MILESTONES.length, BOSTON_ABILITIES.length);
  for (const milestone of BOSTON_ABILITY_MILESTONES) {
    assert.doesNotThrow(() => AbilityMilestoneSchema.parse(milestone));
    assert.equal(milestone.chapterId, BOSTON_CHAPTER_ID);
    assert.ok(milestone.level >= 1, "the schema forbids a Level 0 milestone");
  }
});

test("unlock queries agree with the contracts filter", () => {
  for (let level = 0; level <= 40; level += 1) {
    assert.deepEqual(
      ids(bostonAbilitiesAtLevel(level)),
      bostonMilestonesAtLevel(level).map((milestone) => milestone.abilityId),
    );
  }
});

test("a Level 0 player holds nothing", () => {
  assert.deepEqual(bostonAbilitiesAtLevel(0), []);
  assert.deepEqual(bostonAbilitiesAtLevel(-5), []);
  assert.deepEqual(bostonAbilitiesAtLevel(2), []);
  assert.deepEqual(ids(bostonAbilitiesAtLevel(3)), [WARD_CHIME.abilityId]);
});

test("crossing a milestone mints exactly one unlock, through the contracts reducer", () => {
  const crossed = newlyUnlockedAbilityMilestones(
    BOSTON_ABILITY_MILESTONES,
    BOSTON_CHAPTER_ID,
    2,
    5,
  );
  assert.deepEqual(
    crossed.map((milestone) => milestone.abilityId),
    [WARD_CHIME.abilityId, KITE_STEP.abilityId],
  );
  // Another chapter's Level gain mints nothing from Boston's schedule.
  assert.deepEqual(
    newlyUnlockedAbilityMilestones(BOSTON_ABILITY_MILESTONES, "PHILADELPHIA", 0, 40),
    [],
  );
});

test("PvE is chapter-scoped: another chapter is refused rather than borrowing", () => {
  const boston = resolveChapterLoadout({ chapterId: BOSTON_CHAPTER_ID, level: 11 });
  assert.equal(boston.pool.length, 5);

  // This used to answer an empty loadout, and that is what made the
  // `BOSTON`/`boston-1765` divergence invisible: a Level 34 player spelled the
  // way the database spells them got the same answer as a Level 0 player, and no
  // caller could tell "this chapter's abilities live elsewhere" from "nobody
  // noticed the key was wrong". Registering Philadelphia in
  // `ABILITY_CHAPTER_IDS` is how that chapter says it holds none of Boston's.
  assert.throws(
    () => resolveChapterLoadout({ chapterId: "PHILADELPHIA", level: 34 }),
    (error: unknown) =>
      error instanceof UnknownAbilityChapterError &&
      error.input === "PHILADELPHIA" &&
      error.known.includes(BOSTON_CHAPTER_ID),
  );
});

test("the slot cap bounds what is carried, never what is held", () => {
  const full = resolveChapterLoadout({ chapterId: BOSTON_CHAPTER_ID, level: 34 });
  assert.equal(full.pool.length, 8, "the pool is everything unlocked");
  assert.equal(full.carried.length, ABILITY_LOADOUT_SLOTS);
  // The default takes the newest first: the ability just earned is the one a
  // player wants to try, and the order is deterministic so a replay resolves the
  // same loadout every time.
  assert.deepEqual(ids(full.carried), [
    OUT_OF_TIME.abilityId,
    FARSIGHT.abilityId,
    POWDER_DAMP.abilityId,
    LONG_STRIDE.abilityId,
  ]);
  assert.deepEqual(ids(full.carried), ids(resolveChapterLoadout({
    chapterId: BOSTON_CHAPTER_ID,
    level: 34,
  }).carried));
});

test("a Boston player only meets the cap once they hold five abilities", () => {
  for (let level = 0; level <= 10; level += 1) {
    const resolved = resolveChapterLoadout({ chapterId: BOSTON_CHAPTER_ID, level });
    assert.equal(
      resolved.carried.length,
      resolved.pool.length,
      `at Level ${level} everything held is carried`,
    );
  }
  const atFive = resolveChapterLoadout({ chapterId: BOSTON_CHAPTER_ID, level: 11 });
  assert.equal(atFive.pool.length, 5);
  assert.equal(atFive.carried.length, ABILITY_LOADOUT_SLOTS);
});

test("an explicit selection is honoured, capped, and ordered by the pool", () => {
  const resolved = resolveChapterLoadout({
    chapterId: BOSTON_CHAPTER_ID,
    level: 34,
    selectedAbilityIds: [
      OUT_OF_TIME.abilityId,
      WARD_CHIME.abilityId,
      KITE_STEP.abilityId,
    ],
  });
  // Pool order (ascending unlock Level) is preserved, not selection order.
  assert.deepEqual(ids(resolved.carried), [
    WARD_CHIME.abilityId,
    KITE_STEP.abilityId,
    OUT_OF_TIME.abilityId,
  ]);

  const overfull = resolveChapterLoadout({
    chapterId: BOSTON_CHAPTER_ID,
    level: 34,
    selectedAbilityIds: BOSTON_ABILITIES.map((ability) => ability.abilityId),
  });
  assert.equal(overfull.carried.length, ABILITY_LOADOUT_SLOTS);
});

test("a stale selection degrades to a smaller loadout instead of failing a deploy", () => {
  // Exactly what a chapter reset produces: ids the player no longer holds.
  const resolved = resolveChapterLoadout({
    chapterId: BOSTON_CHAPTER_ID,
    level: 5,
    selectedAbilityIds: [
      OUT_OF_TIME.abilityId,
      "BOS.ABILITY.NOT_REAL.v1",
      KITE_STEP.abilityId,
    ],
  });
  assert.deepEqual(ids(resolved.carried), [KITE_STEP.abilityId]);
});

test("PvP is permanent and driven by ids, because it spans chapters", () => {
  const resolved = resolvePvpLoadout({
    unlockedAbilityIds: [
      WARD_CHIME.abilityId,
      OUT_OF_TIME.abilityId,
      "PHL.ABILITY.SOMETHING.v1",
    ],
  });
  // A later chapter's ability resolves in that chapter's package, not here.
  assert.deepEqual(ids(resolved.pool), [WARD_CHIME.abilityId, OUT_OF_TIME.abilityId]);
  assert.equal(resolved.carried.length, 2);

  const none = resolvePvpLoadout({ unlockedAbilityIds: [] });
  assert.deepEqual(none.carried, []);
});

test("PvE and PvP obey the same cap, because an ability behaves the same in both", () => {
  const pve = resolveChapterLoadout({ chapterId: BOSTON_CHAPTER_ID, level: 34 });
  const pvp = resolvePvpLoadout({
    unlockedAbilityIds: BOSTON_ABILITIES.map((ability) => ability.abilityId),
  });
  assert.equal(pve.carried.length, pvp.carried.length);
  assert.deepEqual(ids(pve.carried), ids(pvp.carried));
});
