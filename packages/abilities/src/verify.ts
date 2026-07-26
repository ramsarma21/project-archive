// The progression proofs, as code.
//
// Mission-Slate section 18.6 asks for a mechanical validation of any authored
// curve and calls a failure of it "a progression deadlock, not difficulty". This
// module is that validation, executable, plus the two things the brief asked to be
// verified rather than asserted: that no mission requires an ability, and that the
// Rank ladder Boston produces is not a single value.
//
// Everything returns findings instead of throwing, so a caller can render the whole
// report; verify.test.ts asserts every finding list is empty.

import { BOSTON_ABILITIES } from "./boston.js";
import {
  BOSTON_CHAPTER_XP_CEILING,
  BOSTON_MAX_ATTAINABLE_LEVEL,
  BOSTON_MISSION_COUNT,
  BOSTON_XP_CURVE,
  LEVEL_1_XP,
  levelThreshold,
  worstPayingClear,
} from "./curve.js";
import { ENGINE_DEPENDENCIES } from "./engineDependencies.js";
import { ABILITY_CHANNELS } from "./effects.js";
import { BOSTON_AFFORDANCES, BOSTON_CAPSTONE, BOSTON_MISSIONS } from "./missions.js";
import { arrivalLevels, walkChapter, archetype, attainableRanks } from "./trajectory.js";

export interface VerificationResult {
  readonly checkId: string;
  readonly title: string;
  readonly findings: readonly string[];
  readonly ok: boolean;
}

function result(
  checkId: string,
  title: string,
  findings: readonly string[],
): VerificationResult {
  return { checkId, title, findings, ok: findings.length === 0 };
}

// ---------------------------------------------------------------------------
// 1. no mission requires an ability
// ---------------------------------------------------------------------------

/**
 * The rule the whole design rests on, checked four ways.
 *
 * (a) Every mission's required-ability set is empty, and so is the capstone's.
 * (b) Every mission has a named ability-free route, and every affordance names the
 *     fallback for the mission it is featured in. An empty string here means
 *     somebody authored a mission around an ability and did not think about the
 *     player who does not have it.
 * (c) The SPECTATOR archetype — a player who fails all fourteen missions and
 *     advances anyway — reaches the capstone at Level 0 with an empty loadout.
 *     This is the row that makes the rule non-negotiable: because failure still
 *     advances, the Level a player is GUARANTEED to hold at any mission is 0, so
 *     no positive unlock threshold could ever satisfy a requirement.
 * (d) No ability grants a verb. Every channel is a multiplier on something the
 *     base kit already does, or a boolean about what an observer learns, so an
 *     ability can only ever make a route easier — it cannot be the route.
 */
export function verifyNoMissionRequiresAbility(): VerificationResult {
  const findings: string[] = [];

  for (const mission of BOSTON_MISSIONS) {
    if (mission.requiredAbilityIds.length > 0) {
      findings.push(
        `${mission.missionId} declares required abilities: ${mission.requiredAbilityIds.join(", ")}`,
      );
    }
    if (mission.abilityFreeRoute.trim().length === 0) {
      findings.push(`${mission.missionId} has no ability-free route`);
    }
  }
  if (BOSTON_CAPSTONE.requiredAbilityIds.length > 0) {
    findings.push("the capstone declares required abilities");
  }

  for (const affordance of Object.values(BOSTON_AFFORDANCES)) {
    if (affordance.abilityFreeRoute.trim().length === 0) {
      findings.push(`${affordance.affordanceId} has no ability-free route`);
    }
    const featured = BOSTON_MISSIONS.find(
      (mission) => mission.missionId === affordance.firstFeaturedMissionId,
    );
    if (!featured) {
      findings.push(
        `${affordance.affordanceId} is featured in unknown mission ${affordance.firstFeaturedMissionId}`,
      );
    } else if (!featured.featuredAffordanceIds.includes(affordance.affordanceId)) {
      findings.push(
        `${affordance.affordanceId} claims ${featured.missionId} features it, and that mission does not list it`,
      );
    }
  }

  const spectator = walkChapter(archetype("SPECTATOR"));
  if (spectator.finalLevel !== 0 || spectator.abilitiesUnlocked !== 0) {
    findings.push(
      `SPECTATOR should reach the capstone at Level 0 with no abilities, got Level ${spectator.finalLevel} with ${spectator.abilitiesUnlocked}`,
    );
  }
  if (spectator.steps.length !== BOSTON_MISSION_COUNT) {
    findings.push("SPECTATOR does not advance through all fourteen missions");
  }

  // (d) Structural: an ability may scale, never grant.
  for (const ability of BOSTON_ABILITIES) {
    const effect = ability.effectAt(0);
    const scales = [
      effect.duel.selfMoveSpeedScale,
      effect.duel.selfIncomingDamageScale,
      effect.duel.opponentMoveSpeedScale,
      effect.duel.opponentFireIntervalScale,
      effect.world.selfVisibilityScale,
      effect.world.selfJumpVelocityScale,
      effect.world.staggerRecoveryScale,
      effect.world.diversionAttentionScale,
    ];
    for (const scale of scales) {
      if (!Number.isFinite(scale) || scale < 0) {
        findings.push(`${ability.abilityId} has a non-finite or negative scale`);
      }
    }
    // Neutral outside the window: a Level 0 player's world and an expired
    // ability's world are the same world.
    const expired = ability.effectAt(ability.durationTicks);
    const neutral =
      expired.duel.selfMoveSpeedScale === 1 &&
      expired.duel.selfIncomingDamageScale === 1 &&
      expired.duel.opponentMoveSpeedScale === 1 &&
      expired.duel.opponentFireIntervalScale === 1 &&
      expired.duel.revealsOpponentThroughCover === false &&
      expired.world.selfVisibilityScale === 1 &&
      expired.world.selfJumpVelocityScale === 1 &&
      expired.world.staggerRecoveryScale === 1 &&
      expired.world.diversionAttentionScale === 1 &&
      expired.world.carriedEvidenceConcealed === false;
    if (!neutral) {
      findings.push(`${ability.abilityId} is not neutral once its window closes`);
    }
  }

  return result(
    "NO_MISSION_REQUIRES_ABILITY",
    "Every Boston mission is completable at Level 0 with an empty loadout",
    findings,
  );
}

// ---------------------------------------------------------------------------
// 2. the section 18.6 procedure
// ---------------------------------------------------------------------------

/**
 * Section 18.6, step by step, against the GRINDER archetype.
 *
 * The document says "cumulative mission-clear XP with zero training". There is no
 * training XP in the game at all — modules and assessments pay zero — so the
 * intended baseline is the worst-paying player who still progresses, which is the
 * grinder: every mission cleared, every one on the last attempt that pays.
 *
 *   1. cumulative mission-clear XP with no other source          -> the walk
 *   2. the minimum Level reached before every mission             -> arrivalLevels
 *   3. every ability required by that mission                     -> empty, always
 *   4. every required unlock threshold at or below that minimum   -> vacuous, and
 *                                                                    checked anyway
 *   5. each introduction mission occurs after the unlock threshold -> the real test
 *   6. training XP is never part of the proof                      -> one XP source
 */
export function verifyUnlockSchedule(): VerificationResult {
  const findings: string[] = [];
  const arrivals = arrivalLevels("GRINDER");

  // Step 6 first, because everything else depends on it: exactly one payer.
  const payers = BOSTON_MISSIONS.filter((mission) => mission.baseXp > 0).length;
  if (payers !== BOSTON_MISSION_COUNT) {
    findings.push(`expected all ${BOSTON_MISSION_COUNT} missions to pay, got ${payers}`);
  }
  if (BOSTON_CAPSTONE.baseXp !== 0) {
    findings.push("the capstone pays XP; it must pay zero");
  }

  // The check is per AFFORDANCE, against the EARLIEST ability that serves it.
  // The schedule needs the player to hold *an* answer to the functional need by
  // the mission that introduces it; a second, stronger answer unlocking twenty
  // Levels later is a reward, not a violation. `Out of Time` also conceals
  // carried evidence, and it would be wrong to hold Longcoat Hush's schedule
  // against it.
  for (const affordance of Object.values(BOSTON_AFFORDANCES)) {
    const serving = BOSTON_ABILITIES.filter((ability) =>
      ability.affordanceIds.includes(affordance.affordanceId),
    );
    if (serving.length === 0) {
      findings.push(`${affordance.affordanceId} has no ability serving it`);
      continue;
    }
    const earliest = serving.reduce((best, ability) =>
      ability.unlockedAtLevel < best.unlockedAtLevel ? ability : best,
    );

    // Step 5: held when the affordance is first offered.
    const introLevel = arrivals.get(affordance.introducedMissionId);
    if (introLevel === undefined) {
      findings.push(
        `${affordance.affordanceId} is introduced in unknown mission ${affordance.introducedMissionId}`,
      );
      continue;
    }
    if (earliest.unlockedAtLevel > introLevel) {
      findings.push(
        `${earliest.abilityId} unlocks at Level ${earliest.unlockedAtLevel} but the grinder arrives at ` +
          `${affordance.introducedMissionId} (${affordance.affordanceId}'s introduction) at Level ${introLevel}`,
      );
    }

    // Steps 3 and 4: still held at the mission built around it. Vacuous as a
    // deadlock check, since nothing is required — kept because a featured
    // mission the player meets empty-handed is wasted authoring either way.
    const featuredLevel = arrivals.get(affordance.firstFeaturedMissionId);
    if (featuredLevel !== undefined && earliest.unlockedAtLevel > featuredLevel) {
      findings.push(
        `${earliest.abilityId} unlocks at Level ${earliest.unlockedAtLevel} but the grinder arrives at ` +
          `${affordance.firstFeaturedMissionId} (where ${affordance.affordanceId} is featured) at Level ${featuredLevel}`,
      );
    }
  }

  return result(
    "UNLOCK_SCHEDULE",
    "Mission-Slate 18.6, validated against the worst-paying player who finishes",
    findings,
  );
}

// ---------------------------------------------------------------------------
// 3. the curve's own shape
// ---------------------------------------------------------------------------

export function verifyCurveShape(): VerificationResult {
  const findings: string[] = [];

  // Strictly increasing is enforced by XpCurveSchema; this catches the subtler
  // failure of a cost that stops rising.
  for (let level = 2; level <= BOSTON_XP_CURVE.levelThresholds.length; level += 1) {
    const cost = levelThreshold(level) - levelThreshold(level - 1);
    const previous = levelThreshold(level - 1) - levelThreshold(level - 2);
    if (level > 2 && cost <= previous) {
      findings.push(`Level ${level} costs no more than Level ${level - 1}`);
    }
  }

  // The anchor: Level 1 costs exactly the worst clear of the first mission, so
  // every player who clears anything is Level 1.
  if (LEVEL_1_XP !== worstPayingClear(1)) {
    findings.push("Level 1 is no longer anchored to the worst clear of M1");
  }

  // Steady progress: a first-attempt clear pays 2 or 3 Levels, every mission.
  const flawless = walkChapter(archetype("FLAWLESS"));
  for (const step of flawless.steps) {
    if (step.levelsGained < 2 || step.levelsGained > 3) {
      findings.push(
        `a first-attempt clear of ${step.missionId} pays ${step.levelsGained} Levels; the band is 2 to 3`,
      );
    }
  }

  // The grinder levels every single mission. This is the "a player who fails a
  // lot still unlocks something" requirement, stated as arithmetic.
  const grinder = walkChapter(archetype("GRINDER"));
  for (const step of grinder.steps) {
    if (step.levelsGained < 1) {
      findings.push(`the grinder gains no Level from ${step.missionId}`);
    }
  }

  // The curve must not run out inside the chapter, or the hub loses its "next
  // Level" caption at the top end.
  if (BOSTON_XP_CURVE.levelThresholds.length <= BOSTON_MAX_ATTAINABLE_LEVEL) {
    findings.push(
      `the curve authors ${BOSTON_XP_CURVE.levelThresholds.length} Levels and the chapter can reach ${BOSTON_MAX_ATTAINABLE_LEVEL}`,
    );
  }

  // Every award and both decayed shares must be exact, or two adjacent missions
  // pay the same on a retry.
  for (const mission of BOSTON_MISSIONS) {
    if (mission.baseXp % 3 !== 0) {
      findings.push(`${mission.missionId} pays ${mission.baseXp}, which is not divisible by 3`);
    }
  }

  if (flawless.finalXp !== BOSTON_CHAPTER_XP_CEILING) {
    findings.push("a flawless run does not reach the chapter XP ceiling");
  }

  return result("CURVE_SHAPE", "The curve is monotone, anchored and steady", findings);
}

// ---------------------------------------------------------------------------
// 4. the ladder
// ---------------------------------------------------------------------------

/**
 * Rank is the PvP matchmaking input and PvP unlocks only when Boston is complete,
 * so end-of-Boston Rank IS the opening ladder. If every archetype lands on one
 * Rank the ladder is broken before it ships.
 *
 * The bar is three or more distinct Ranks across the archetypes, and a top Rank of
 * at least 4, so the brackets are populated without being so fine that a class of
 * twenty-five cannot fill them.
 */
export function verifyRankLadder(): VerificationResult {
  const findings: string[] = [];
  const ranks = attainableRanks();
  if (ranks.length < 3) {
    findings.push(`Boston produces only ${ranks.length} distinct Rank(s): ${ranks.join(", ")}`);
  }
  const top = ranks[ranks.length - 1] ?? 1;
  if (top < 4) findings.push(`the highest Rank Boston can produce is ${top}`);

  const typical = walkChapter(archetype("TYPICAL")).finalRank;
  const strong = walkChapter(archetype("STRONG")).finalRank;
  const grinder = walkChapter(archetype("GRINDER")).finalRank;
  if (!(grinder < typical && typical <= strong)) {
    findings.push(
      `Rank does not separate skill: grinder ${grinder}, typical ${typical}, strong ${strong}`,
    );
  }
  return result("RANK_LADDER", "Boston produces a populated Rank ladder", findings);
}

// ---------------------------------------------------------------------------
// 5. every pending channel is declared
// ---------------------------------------------------------------------------

/** No channel may be inert without a written-down reason and an owner. */
export function verifyChannelDependencies(): VerificationResult {
  const findings: string[] = [];
  const declared = new Set(
    ENGINE_DEPENDENCIES.flatMap((dependency) => dependency.blocksChannels),
  );
  for (const channel of ABILITY_CHANNELS) {
    if (channel.status === "PENDING" && !declared.has(channel.channel)) {
      findings.push(`${channel.channel} is PENDING with no declared dependency behind it`);
    }
    if (channel.status === "LIVE" && declared.has(channel.channel)) {
      findings.push(`${channel.channel} is LIVE but still declared as blocked`);
    }
    if (channel.consumers.length === 0) {
      findings.push(`${channel.channel} names no consumer`);
    }
  }
  return result(
    "CHANNEL_DEPENDENCIES",
    "Every inert channel has a declared upstream dependency",
    findings,
  );
}

// ---------------------------------------------------------------------------
// the whole report
// ---------------------------------------------------------------------------

export function verifyBostonProgression(): {
  readonly ok: boolean;
  readonly checks: readonly VerificationResult[];
} {
  const checks = [
    verifyNoMissionRequiresAbility(),
    verifyUnlockSchedule(),
    verifyCurveShape(),
    verifyRankLadder(),
    verifyChannelDependencies(),
  ];
  return { ok: checks.every((check) => check.ok), checks };
}
