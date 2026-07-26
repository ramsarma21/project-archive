// The numbers reported to the owner, pinned.
//
// Rank is the PvP matchmaking input, so "a typical player finishes Boston at Rank
// 3 and a strong player at Rank 4" is a load-bearing claim rather than colour. If
// a retune moves it, this file fails and the claim gets restated instead of
// quietly becoming false.

import assert from "node:assert/strict";
import test from "node:test";

import { LEVELS_PER_RANK, STARTING_RANK, rankFromCumulativeLevels } from "../contractsSurface.js";
import { BOSTON_CHAPTER_XP_CEILING, BOSTON_MISSION_COUNT } from "../curve.js";
import {
  BOSTON_ABILITIES,
  KITE_STEP,
  LONGCOAT_HUSH,
  LONG_STRIDE,
  OUT_OF_TIME,
  POWDER_DAMP,
  WARD_CHIME,
  HOLD_FAST,
} from "../boston.js";
import {
  BOSTON_ARCHETYPES,
  archetype,
  arrivalLevels,
  attainableRanks,
  rankReport,
  walkAllArchetypes,
  walkChapter,
} from "../trajectory.js";

const walked = walkAllArchetypes();
const of = (id: string) => {
  const trajectory = walked.get(id);
  assert.ok(trajectory, `missing archetype ${id}`);
  return trajectory;
};

test("THE REPORTED TABLE: end-of-Boston XP, Level, Rank and kit", () => {
  assert.deepEqual(
    rankReport().map((row) => [row.archetypeId, row.finalXp, row.finalLevel, row.finalRank, row.abilitiesUnlocked]),
    [
      ["FLAWLESS", 3045, 34, 4, 8],
      ["STRONG", 2655, 31, 4, 8],
      ["TYPICAL", 2465, 29, 3, 8],
      ["STRUGGLING", 1235, 18, 2, 6],
      ["GRINDER", 1015, 16, 2, 6],
      ["SPECTATOR", 0, 0, 1, 0],
    ],
  );
});

test("the ladder has three populated brackets plus a floor for non-participants", () => {
  assert.deepEqual(attainableRanks(), [1, 2, 3, 4]);
  // Rank 1 means "cleared almost nothing"; the play population lands in 2-4.
  assert.equal(of("SPECTATOR").finalRank, STARTING_RANK);
  assert.ok(of("GRINDER").finalRank < of("TYPICAL").finalRank);
  assert.ok(of("TYPICAL").finalRank <= of("STRONG").finalRank);
});

test("one chapter is worth roughly three Ranks, and Boston cannot exceed Rank 4", () => {
  const ceiling = of("FLAWLESS");
  assert.equal(ceiling.finalXp, BOSTON_CHAPTER_XP_CEILING);
  assert.equal(ceiling.finalRank, rankFromCumulativeLevels(ceiling.finalLevel));
  assert.equal(Math.floor(ceiling.finalLevel / LEVELS_PER_RANK), 3);
  // A fifth Rank would need 40 Levels and the chapter's whole XP pool buys 34.
  assert.ok(ceiling.finalLevel < 4 * LEVELS_PER_RANK);
});

test("a first-attempt clear always pays 2 or 3 Levels, at M1 and at M14 alike", () => {
  const gains = of("FLAWLESS").steps.map((step) => step.levelsGained);
  assert.deepEqual(gains, [2, 3, 3, 2, 2, 3, 2, 3, 2, 2, 3, 2, 2, 3]);
  assert.equal(gains.length, BOSTON_MISSION_COUNT);
  assert.equal(Math.min(...gains), 2);
  assert.equal(Math.max(...gains), 3);
});

test("the worst-paying player who finishes still levels on every single mission", () => {
  const grinder = of("GRINDER");
  for (const step of grinder.steps) {
    assert.ok(
      step.levelsGained >= 1,
      `${step.missionId} paid the grinder no Level at all`,
    );
  }
  assert.deepEqual(
    grinder.steps.map((step) => step.levelsGained),
    [1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 2],
  );
});

test("nobody plays for an hour with nothing to show", () => {
  // Roughly eight minutes an attempt, so an hour is three to five missions. The
  // first ability has to land inside that even for a player who is failing.
  for (const row of BOSTON_ARCHETYPES) {
    if (row.archetypeId === "SPECTATOR") continue;
    const first = walkChapter(row).steps.find(
      (step) => step.abilityIdsAfter.length > 0,
    );
    assert.ok(first, `${row.archetypeId} never unlocks anything`);
    assert.ok(
      first.ordinal <= 3,
      `${row.archetypeId} waits until M${first.ordinal} for a first ability`,
    );
  }
});

test("a player who clears nothing is Level 0 with an empty kit at the capstone", () => {
  const spectator = of("SPECTATOR");
  assert.equal(spectator.finalXp, 0);
  assert.equal(spectator.finalLevel, 0);
  assert.deepEqual(spectator.abilityIds, []);
  assert.equal(spectator.steps.length, BOSTON_MISSION_COUNT, "failure still advances");
});

test("the grinder's arrival Levels are what the unlock schedule was derived from", () => {
  // These five numbers ARE the front half of the ability schedule. If they move,
  // the unlock Levels have to move with them.
  const arrivals = arrivalLevels("GRINDER");
  assert.equal(arrivals.get("M5"), 4);
  assert.equal(arrivals.get("M6"), 5);
  assert.equal(arrivals.get("M8"), 7);
  assert.equal(arrivals.get("M9"), 8);
  assert.equal(arrivals.get("M11"), 11);

  assert.equal(WARD_CHIME.unlockedAtLevel, 3);
  assert.equal(KITE_STEP.unlockedAtLevel, 5);
  assert.equal(LONGCOAT_HUSH.unlockedAtLevel, 7);
  assert.equal(HOLD_FAST.unlockedAtLevel, 8);
  assert.equal(LONG_STRIDE.unlockedAtLevel, 11);
  for (const ability of [WARD_CHIME, KITE_STEP, LONGCOAT_HUSH, HOLD_FAST, LONG_STRIDE]) {
    const affordance = ability.affordanceIds[0];
    assert.ok(affordance, `${ability.abilityId} serves no affordance`);
  }
});

test("the median finisher earns the whole Boston kit, and earns it before the end", () => {
  const typical = walkChapter(archetype("TYPICAL"));
  assert.equal(typical.abilitiesUnlocked, BOSTON_ABILITIES.length);
  const last = typical.steps.find(
    (step) => step.abilityIdsAfter.length === BOSTON_ABILITIES.length,
  );
  assert.ok(last, "the median finisher never completes the kit");
  assert.ok(
    last.ordinal <= 13,
    "the last unlock should land with a mission or two left to use it",
  );
  assert.equal(last.missionId, "M12");
});

test("a struggling player still ends with three quarters of the kit", () => {
  const struggling = of("STRUGGLING");
  assert.equal(struggling.abilitiesUnlocked, 6);
  assert.ok(struggling.abilityIds.includes(POWDER_DAMP.abilityId));
  assert.equal(struggling.abilityIds.includes(OUT_OF_TIME.abilityId), false);
});

test("Boston is chapter one, so cumulative Levels are the chapter's Levels", () => {
  for (const row of BOSTON_ARCHETYPES) {
    const trajectory = walkChapter(row);
    assert.equal(trajectory.cumulativeLevels, trajectory.finalLevel);
    assert.equal(
      trajectory.finalRank,
      rankFromCumulativeLevels(trajectory.cumulativeLevels),
    );
  }
});

test("an unknown archetype is an error, not a silent empty walk", () => {
  assert.throws(() => archetype("NOPE"));
});
