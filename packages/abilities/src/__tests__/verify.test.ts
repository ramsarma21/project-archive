// The proofs the brief asked to be verified rather than asserted.

import assert from "node:assert/strict";
import test from "node:test";

import { BOSTON_ABILITIES } from "../boston.js";
import { BOSTON_CHAPTER_ID } from "../chapters.js";
import { BOSTON_MISSION_COUNT } from "../curve.js";
import { ABILITY_CHANNELS } from "../effects.js";
import { ENGINE_DEPENDENCIES } from "../engineDependencies.js";
import {
  BOSTON_AFFORDANCES,
  BOSTON_CAPSTONE,
  BOSTON_MISSIONS,
  missionById,
  missionByOrdinal,
  toMissionReward,
} from "../missions.js";
import { arrivalLevels } from "../trajectory.js";
import {
  verifyBostonProgression,
  verifyChannelDependencies,
  verifyCurveShape,
  verifyNoMissionRequiresAbility,
  verifyRankLadder,
  verifyUnlockSchedule,
} from "../verify.js";

test("every progression check passes", () => {
  const report = verifyBostonProgression();
  for (const check of report.checks) {
    assert.deepEqual(check.findings, [], `${check.checkId} reported findings`);
  }
  assert.equal(report.ok, true);
  assert.equal(report.checks.length, 5);
});

test("the individual checks are each clean", () => {
  for (const check of [
    verifyNoMissionRequiresAbility(),
    verifyUnlockSchedule(),
    verifyCurveShape(),
    verifyRankLadder(),
    verifyChannelDependencies(),
  ]) {
    assert.equal(check.ok, true, `${check.checkId}: ${check.findings.join("; ")}`);
  }
});

// ---------------------------------------------------------------------------
// no mission requires an ability
// ---------------------------------------------------------------------------

test("NO MISSION REQUIRES AN ABILITY — the slate says so on every row", () => {
  assert.equal(BOSTON_MISSIONS.length, BOSTON_MISSION_COUNT);
  for (const mission of BOSTON_MISSIONS) {
    assert.deepEqual(mission.requiredAbilityIds, []);
    assert.ok(
      mission.abilityFreeRoute.length > 20,
      `${mission.missionId} needs a real ability-free route, not a placeholder`,
    );
  }
  assert.deepEqual(BOSTON_CAPSTONE.requiredAbilityIds, []);
  assert.equal(BOSTON_CAPSTONE.baseXp, 0);
});

test("the requirement reading of §18 is unsatisfiable, which is why it is rejected", () => {
  // A player who exhausts three attempts advances anyway, so the Level anybody is
  // GUARANTEED to hold on arriving at any mission is 0. No positive threshold can
  // sit at or below that, so ANY ability requirement is a deadlock for this row,
  // at any threshold, under any curve. That is the whole argument.
  const guaranteed = arrivalLevels("SPECTATOR");
  for (const mission of BOSTON_MISSIONS) {
    assert.equal(guaranteed.get(mission.missionId), 0);
  }
  for (const ability of BOSTON_ABILITIES) {
    assert.ok(
      ability.unlockedAtLevel > 0,
      "every unlock is at a positive Level, so none could ever be guaranteed",
    );
  }
});

test("each affordance names a fallback and is featured where it claims to be", () => {
  for (const affordance of Object.values(BOSTON_AFFORDANCES)) {
    assert.ok(affordance.abilityFreeRoute.length > 20);
    assert.ok(affordance.functionalNeed.length > 20);
    const featured = missionById(affordance.firstFeaturedMissionId);
    assert.ok(featured, `${affordance.affordanceId} points at a missing mission`);
    assert.ok(featured.featuredAffordanceIds.includes(affordance.affordanceId));
    const introduced = missionById(affordance.introducedMissionId);
    assert.ok(introduced);
    assert.ok(introduced.introducesAffordanceIds.includes(affordance.affordanceId));
    // Introduced no later than featured.
    assert.ok(introduced.ordinal <= featured.ordinal);
  }
});

test("an ability can only scale the base kit, so it can never be the route", () => {
  for (const ability of BOSTON_ABILITIES) {
    const effect = ability.effectAt(0);
    for (const [name, value] of Object.entries(effect.world)) {
      if (typeof value === "number") {
        assert.ok(Number.isFinite(value) && value >= 0, `${ability.abilityId}.${name}`);
      }
    }
    // The only booleans are about what an observer learns, never about where the
    // player may go.
    assert.equal(typeof effect.world.carriedEvidenceConcealed, "boolean");
    assert.equal(typeof effect.duel.revealsOpponentThroughCover, "boolean");
  }
});

// ---------------------------------------------------------------------------
// the §18.6 procedure
// ---------------------------------------------------------------------------

test("§18.6 — the unlock schedule holds for the worst-paying player who finishes", () => {
  const arrivals = arrivalLevels("GRINDER");
  for (const affordance of Object.values(BOSTON_AFFORDANCES)) {
    const serving = BOSTON_ABILITIES.filter((ability) =>
      ability.affordanceIds.includes(affordance.affordanceId),
    );
    assert.ok(serving.length > 0);
    const earliest = serving.reduce((best, ability) =>
      ability.unlockedAtLevel < best.unlockedAtLevel ? ability : best,
    );
    const introLevel = arrivals.get(affordance.introducedMissionId);
    const featuredLevel = arrivals.get(affordance.firstFeaturedMissionId);
    assert.ok(introLevel !== undefined && featuredLevel !== undefined);
    assert.ok(
      earliest.unlockedAtLevel <= introLevel,
      `${affordance.affordanceId}: unlock ${earliest.unlockedAtLevel} > arrival ${introLevel} at its introduction`,
    );
    assert.ok(
      earliest.unlockedAtLevel <= featuredLevel,
      `${affordance.affordanceId}: unlock ${earliest.unlockedAtLevel} > arrival ${featuredLevel} where it is featured`,
    );
  }
});

test("§18.6 step 6 — there is exactly one XP payer, so no proof leans on training", () => {
  for (const mission of BOSTON_MISSIONS) assert.ok(mission.baseXp > 0);
  assert.equal(BOSTON_CAPSTONE.baseXp, 0);
});

// ---------------------------------------------------------------------------
// upstream honesty
// ---------------------------------------------------------------------------

test("every inert channel has a declared dependency with an owner", () => {
  const blocked = new Set(ENGINE_DEPENDENCIES.flatMap((d) => d.blocksChannels));
  const pending = ABILITY_CHANNELS.filter((c) => c.status === "PENDING");
  const live = ABILITY_CHANNELS.filter((c) => c.status === "LIVE");
  assert.ok(pending.length > 0, "if nothing is pending, the honesty check is stale");
  for (const channel of pending) assert.ok(blocked.has(channel.channel));
  for (const channel of live) assert.equal(blocked.has(channel.channel), false);
  for (const channel of ABILITY_CHANNELS) assert.ok(channel.consumers.length > 0);
});

test("all five duel channels are live, so every ability works in a duel today", () => {
  const duelChannels = ABILITY_CHANNELS.filter((channel) => channel.half === "duel");
  assert.equal(duelChannels.length, 5);
  for (const channel of duelChannels) assert.equal(channel.status, "LIVE");
});

test("the burst phase dependency is satisfied and nothing else claims to be", () => {
  const burst = ENGINE_DEPENDENCIES.find((d) => d.id === "BURST_PHASE");
  assert.ok(burst);
  assert.equal(burst.status, "LANDED");
  assert.deepEqual(burst.blocksChannels, []);
  for (const dependency of ENGINE_DEPENDENCIES) {
    assert.ok(dependency.expectedUpstream.length > 20);
    if (dependency.status === "LANDED") assert.deepEqual(dependency.blocksChannels, []);
    if (dependency.status === "REQUIRED") assert.ok(dependency.blocksChannels.length > 0);
  }
});

// ---------------------------------------------------------------------------
// the mission-reward seam
// ---------------------------------------------------------------------------

test("a mission reward completes only when the content ids actually exist", () => {
  const reward = toMissionReward("M1", {
    moduleId: "BOS.M1.MODULE.v1",
    conceptIds: ["BOS.CONCEPT.POSTWAR_REVENUE.v1"],
  });
  assert.equal(reward.missionId, "M1");
  assert.equal(reward.chapterId, BOSTON_CHAPTER_ID);
  assert.equal(reward.baseXp, 120);
  assert.throws(() => toMissionReward("M99", { moduleId: "x", conceptIds: ["y"] }));
  // The schema requires at least one concept, so an empty join fails loudly here
  // rather than at the first XP commit.
  assert.throws(() => toMissionReward("M1", { moduleId: "BOS.M1.MODULE.v1", conceptIds: [] }));
});

test("the slate is indexable both ways", () => {
  assert.equal(missionByOrdinal(1)?.missionId, "M1");
  assert.equal(missionByOrdinal(14)?.missionId, "M14");
  assert.equal(missionByOrdinal(15), undefined);
  assert.equal(missionById("M7")?.ordinal, 7);
  assert.equal(missionById("M99"), undefined);
});
