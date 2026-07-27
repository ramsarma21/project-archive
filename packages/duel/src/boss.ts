// The boss model, and the arithmetic guard that keeps the design honest.
//
// "Harder missions have more powerful bosses" is the slate's only difficulty
// axis, so this file is where mission difficulty actually lives. The important
// structural point is WHICH dials tier moves:
//
//   offence   shotDamage, fireIntervalTicks, magazinePerRound
//   accuracy  aimErrorRad, leadFraction
//   evasion   dodgeChance, dodgeReactionTicks, moveSpeedScale, cover discipline
//   health    how long the duel runs — AND IT IS NO LONGER A TIER DIAL AT ALL
//
// Health moved from last to first when the round count became unbounded, and then
// out of the list entirely. Under the six-round format it was the one dial that
// could make the wrong-answer path arithmetically impossible, so it was capped hard;
// with no budget to exhaust it became duration and nothing else, and therefore the
// cleanest lever there was. It is now FLAT across the tiers, because duration turned
// out to be a constant of the format rather than a difficulty axis: a duel should be
// about four rounds whatever tier it is, and what a higher tier buys is lethality
// inside those rounds. tuning.ts has the arithmetic, including why a rising health
// curve is what kept M1's boss falling in two rounds.
//
// The guard changed with it. `assertBossWinnableOnWrongAnswers` no longer asks
// whether six shots can kill — it compares damage RATES, because that is what
// decides a fight that runs until somebody drops.
//
// AND IT ONLY GUARDS ONE DIRECTION, WHICH IS WORTH KNOWING BEFORE YOU TRUST IT. The
// guard refuses a boss too STRONG for a wrong-answer player. Nothing here refuses a
// boss too WEAK, and under health-based termination that is the more dangerous of
// the two: a boss the player cannot lose to is also a boss the player may be unable
// to finish, and the result is not an easy duel but an unending one. A tier 1 boss
// shipped needing the whole 24-round backstop to put down a player who did nothing
// at all, with this file's arithmetic reporting a comfortable margin throughout,
// because a margin says only who wins the race and never whether either runner can
// reach the line. The instrument for that is `winnability.test.ts`'s "EVERY BOSS CAN
// WIN" and the passive-player table in `sweep.mts`. Run them when you touch a curve.
//
// THERE IS A THIRD DIRECTION AND IT ALSO SHIPPED BROKEN: a boss the player kills too
// FAST. Nothing here can refuse one, because the guard only ever reads the
// wrong-answer path, and a boss that dies in two rounds satisfies it luxuriously — it
// is a large margin, which is what the gate is looking for. The consequence was M1:
// knowing the history bought a shorter fight and no better outcome. That direction is
// guarded in `boss.test.ts` ("KNOWING THE ANSWERS BUYS A BOSS FIGHT") rather than
// here, because a floor under the CORRECT path is a design target and this function is
// the owner's non-negotiable; the two should not be able to fail as one assertion.

import type { FighterParams } from "./combat.js";
import { FIELD_TICK_HZ } from "./engine.js";
import {
  BOSS_BASE_HEALTH,
  BOSS_HEALTH_PER_TIER,
  BULLETS_FOR_CORRECT,
  BULLETS_FOR_WRONG,
  FIRE_INTERVAL_TICKS,
  KNOWLEDGE_ADVANTAGE_RATIO,
  PLAYER_MAX_HEALTH,
  PLAYER_SHOT_DAMAGE,
  REFERENCE_BOSS_ACCURACY,
  REFERENCE_PLAYER_ACCURACY,
  REQUIRED_WRONG_PATH_MARGIN,
} from "./tuning.js";

export type BossTier = 1 | 2 | 3 | 4 | 5;

export const BOSS_TIERS: readonly BossTier[] = [1, 2, 3, 4, 5];

/**
 * How a boss's per-round magazine is sourced. This is the "future-boss extension
 * point" for ammo: a boss never answers a history question, so its magazine is
 * always AUTHORED, but there is more than one authored rule.
 *
 * AUTHORED_FLAT — a fixed `magazinePerRound` every round, independent of the
 *   player's answer. The legacy rule, and the one the exchange model in this file
 *   and the per-tier tuning in tuning.ts are built on: it is why the wrong-answer
 *   margin cancels (the boss's magazine IS `BULLETS_FOR_WRONG`). Kept as the
 *   default so every shipped tier's winnability stays exactly as measured.
 *
 * SYMMETRIC_COMPLEMENT — M1's boss. The boss earns the MIRROR of the player's
 *   award off the same graded round (`complementaryBossBullets`): a correct answer
 *   arms the boss with `BULLETS_FOR_WRONG`, a wrong answer arms it with
 *   `BULLETS_FOR_CORRECT`. A wrong answer therefore genuinely arms the enemy. This
 *   changes the wrong-answer balance — the boss brings a full 14 on the wrong path
 *   — so it is opt-in per boss rather than the tier default, and its winnability is
 *   proven by simulation (winnability.test.ts) rather than by the flat exchange
 *   model, exactly as this file's header says the model is only a coarse gate.
 */
export type BossAmmoPolicy = "AUTHORED_FLAT" | "SYMMETRIC_COMPLEMENT";

export const BOSS_AMMO_POLICIES: readonly BossAmmoPolicy[] = [
  "AUTHORED_FLAT",
  "SYMMETRIC_COMPLEMENT",
];

/**
 * The ammo-aware TACTICAL layer, opt-in per boss and OFF for every shipped tier.
 *
 * WHY THIS IS A PROFILE FIELD AND NOT A GLOBAL. The per-tier winnability tuning in
 * `winnability.test.ts` is measured against the memoryless `bossIntent` behaviour,
 * where an empty boss simply sprints toward a probe direction and stays roughly
 * exposed. Making an out-of-ammo boss genuinely disappear behind imported cover
 * changes how much damage the player lands each round, which is a difficulty change
 * — so it is authored per boss (M1 opts in via `M1_BOSS_TACTICS`) and left null
 * everywhere else, and `advanceBossEngagement` is byte-identical to before when it
 * is null. A later, harder mission raises these numbers on its OWN profile without
 * touching M1.
 *
 * The three states this drives, and what each is for:
 *
 *   ARMED  (ammo > lowAmmoThreshold) — unchanged: strafe, hold range, close/back,
 *          dodge, and fire on the raw line of sight, with the existing wall
 *          avoidance and line-of-sight hysteresis.
 *   LOW    (0 < ammo <= lowAmmoThreshold) — fight from cover on a finite
 *          peek->aim->shot->return cycle rather than dumping the last rounds in the
 *          open. Firing is gated by the real crouch/stand cover mechanic: tucked
 *          behind chest-high cover the sightline is blocked and the boss holds fire;
 *          standing to peek reopens it and it takes a shot.
 *   EMPTY  (ammo === 0) — retreat to a reachable, line-of-sight-blocking imported
 *          cover point, crouch behind it and hold, dodging an incoming ball if one
 *          is imminent and relocating (deterministically, once) only when the player
 *          closes inside `pressDistanceM` or the point stops occluding.
 */
export interface BossTacticalProfile {
  /**
   * At or below this many balls (but above zero) the boss switches from open
   * trading to peek-from-cover fire. Kept small so most of an armed round is still
   * fought in the open; it only governs the last rounds of a magazine.
   */
  readonly lowAmmoThreshold: number;
  /**
   * Bounded reaction delay, in ticks, before a newly-detected ammo state is acted
   * on, AND the aim-acquisition delay after peeking before the boss will fire. This
   * is what stops the boss reacting on the exact frame the state changes or firing
   * the instant it clears cover — it is not an aim-bot.
   */
  readonly reactionDelayTicks: number;
  /** Ticks the boss stays exposed to take a shot, per peek. Finite and readable. */
  readonly peekAimTicks: number;
  /** Ticks the boss stays tucked (crouched, occluded) between peeks. */
  readonly peekCooldownTicks: number;
  /**
   * If the player closes inside this distance (metres) while the boss is holding
   * empty cover, the boss relocates to a different valid cover or performs one
   * bounded evasive dodge, rather than sitting still to be walked down.
   */
  readonly pressDistanceM: number;
  /**
   * Minimum ticks between forced relocations, so a player pressing continuously
   * gets one deterministic response rather than a jittering boss.
   */
  readonly relocateGuardTicks: number;
}

/**
 * M1's officer tactics — the numbers the owner can tune to make the King's officer
 * feel like a boss fight without touching any other mission. Expressed in seconds
 * against the field tick so a reader sees the intent, not a tick count.
 *
 * These are deliberately fair for a Level-0, ability-less first-mission player:
 * the boss only peeks in the last few rounds of a magazine, holds a full-second
 * peek window (long enough to be shot back at), and needs a fifth of a second to
 * acquire after clearing cover. Later tiers can shorten every one of these on their
 * own tactical profile.
 */
export const M1_BOSS_TACTICS: BossTacticalProfile = {
  lowAmmoThreshold: 3,
  // A fifth of a second: enough that the boss never snaps a shot on the frame it
  // rises, short enough that the peek still lands its rounds.
  reactionDelayTicks: Math.round(FIELD_TICK_HZ * 0.15),
  // The peek window is long relative to the tuck, so the low-ammo boss is fighting
  // from cover rather than cowering: it spends most of the cycle exposed and firing
  // and only dips behind cover briefly to reset. Being in cover makes it HARDER to
  // trade with, not less dangerous.
  peekAimTicks: Math.round(FIELD_TICK_HZ * 1.2),
  peekCooldownTicks: Math.round(FIELD_TICK_HZ * 0.4),
  pressDistanceM: 4.5,
  relocateGuardTicks: Math.round(FIELD_TICK_HZ * 0.8),
};

export interface BossProfile {
  readonly bossId: string;
  readonly tier: BossTier;
  readonly maxHealth: number;
  readonly shotDamage: number;
  readonly fireIntervalTicks: number;
  /**
   * The boss's magazine per round. Authored content, not earned: a boss does not
   * answer a history question. `roundAmmoSources` in machine.ts refuses to read
   * this for any side that owes a verdict, which is what keeps the one-verdict
   * rule intact while still letting the boss shoot.
   */
  readonly magazinePerRound: number;
  /**
   * How `magazinePerRound` is spent at runtime. See `BossAmmoPolicy`. For an
   * AUTHORED_FLAT boss the runtime magazine IS `magazinePerRound`; for a
   * SYMMETRIC_COMPLEMENT boss `magazinePerRound` is only the winnability
   * projection baseline and the runtime magazine is the complement of the
   * player's award. `roundAmmoSources` in machine.ts is the one reader.
   */
  readonly ammoPolicy: BossAmmoPolicy;
  /**
   * Whether the boss physically retreats behind arena cover and crouches before
   * each question opens, rather than passively waiting out a fixed break. When
   * true, `LINE_OF_SIGHT_BREAK` drives the boss into a real, LOS-blocking cover
   * position (machine.ts / cover.ts) and the question overlay is gated on that
   * position being reached. Off by default so the per-tier winnability tuning,
   * which is measured against the passive break, is untouched; M1's boss opts in.
   */
  readonly takesCoverBeforeQuestion: boolean;
  /**
   * The ammo-aware tactical layer, or null for the legacy memoryless engagement.
   * Null on every shipped tier so their measured winnability is untouched; M1's
   * officer sets `M1_BOSS_TACTICS`. See `BossTacticalProfile` and `bossAi.ts`.
   */
  readonly tactical: BossTacticalProfile | null;
  /** Maximum aim deviation, radians. Seeded per shot, never live-random. */
  readonly aimErrorRad: number;
  /** 0 shoots where you are, 1 shoots where you will be. */
  readonly leadFraction: number;
  /**
   * How close an inbound ball must be before the boss reacts to it, in ticks.
   *
   * A TRIGGER, NOT A DIFFICULTY DIAL — measured, not assumed. Sweeping it from 4 to
   * 30 ticks moves the tier 5 one-bullet win rate by at most one run in eight and
   * player accuracy by about two points. Two things flatten it: the threat detector
   * fires on balls predicted to pass within 0.56 m while a hit needs 0.35 m, so most
   * detected threats are already marginal, and the engine's burst clears that
   * difference almost immediately. Reach for `dodgeChance` instead.
   */
  readonly dodgeReactionTicks: number;
  /** The fraction of inbound balls it slips. One seeded roll per ball. */
  readonly dodgeChance: number;
  readonly moveSpeedScale: number;
  /** Below this fraction of health it prefers cover over trading shots. */
  readonly coverSeekHealthFraction: number;
  /** How long it holds a strafe direction before reversing. */
  readonly strafePeriodTicks: number;
}

// Per-tier curves. Every one of these is a first-pass number meant to be moved
// in playtest; the constraint is the invariant below, not any single value.
//
// THE OFFENCE CURVE IS DELIBERATELY SHALLOW, AND IT DID NOT USED TO BE. Damage ran
// 12 to 28 and the magazine 7 to 14, so raw output rose 4.7x across the tiers while
// health rose only 1.6x. The consequence was a 7.5x swing in the wrong-answer
// margin — 9.26 at tier 1 against 1.24 at tier 5 — which is another way of writing
// "tier 1 is not a fight and tier 5 is a coin flip". Three things pushed it flat.
//
// The arithmetic. Rounds-for-the-boss-to-win is player health over
// magazine x accuracy x damage, and the margin is that over rounds-for-the-player.
// So every unit of rise in offence has to be paid for out of the margin's total
// travel — and now that health is flat at 450 and duration is a format constant,
// DAMAGE IS THE ONLY THING SPENDING THAT TRAVEL. It is the whole of the reason the
// margin narrows with tier at all: 1.68 at tier 1 against 1.42 at tier 5 is exactly
// the 22-to-26 damage curve and nothing else. That leaves the curve less room than
// before, not more, because the margin now starts lower.
//
// The hits-of-slack floor. See `playerHitsOfSlack` below: a margin is a ratio of
// rounds, but what decides whether a good player survives a bad round is a count of
// clean hits, and halving the player's health halved that count at every margin.
// Steepening damage at the top spends the last of it, and the top tiers are where
// there is none to spend — 2.3 hits at tier 5 against 3.7 at tier 1, down from 3.0
// and 6.1 when the duel was half as long. That fall is not a regression to fix: health
// at the kill is `1 - 1/margin` of the bar, so a longer fight is a closer one by
// construction, and the surplus that was spent is the same surplus that made the
// wrong-answer path unloseable.
//
// And the part the arithmetic cannot see at all: the tier curve was never really in
// the offence numbers. It is in `aimErrorRad`. Measured against the reference
// dodging player the boss's hit rate runs 5% at the loose end of the cone and 12%
// at the tight end; against a passive one, 17% and 57%. That is a bigger multiplier
// than damage and magazine put together, and it is invisible to `projectExchange`,
// which credits every tier with the same accuracy. A shallow offence curve and a
// real aim curve is what the difficulty always actually was; the numbers now say so
// out loud, and the aim curve is tuned rather than left at a spread nobody measured.
const BASE_SHOT_DAMAGE = 21;
const SHOT_DAMAGE_PER_TIER = 1;
// A ±0.24 rad cone is ±2.2 m of lateral scatter at the engagement range against a
// 0.7 m-wide body: that is not a weaker fighter, it is a fighter who is not aiming,
// and it is most of why the tier 1 boss could not finish a duel.
//
// THE TIGHT END EASED FROM 0.03 A TIER TO 0.025 WHEN THE DUEL GOT LONGER, AND THAT
// IS A CONSEQUENCE RATHER THAN A SECOND OPINION ABOUT DIFFICULTY. What a boss
// delivers over a duel is its damage RATE times the duration, and boss health going
// flat at 450 raised the wrong-answer path from 4.5–6.9 rounds to 6.1–7.0. Left
// alone, the top of the curve simply collected 40% more damage on the way through:
// at tier 5 a mechanically strong player answering every question wrong went from
// winning 8 runs of 8 to losing 2, which is the design's one non-negotiable starting
// to give. Widening the cone at the top from 0.04 rad to 0.06 hands that back — 8/8
// again, on 37% health — and 0.06 rad is still about 0.55 m of scatter against a
// 0.7 m body, so tier 5 remains a fighter who hits what he aims at.
//
// The rule this leaves behind: a duel's length and the top of the aim curve are one
// tuning decision. Lengthen the fight and this number has to ease, or the wrong
// answer stops being a handicap and becomes a lockout at the top tiers.
const BASE_AIM_ERROR_RAD = 0.16;
const AIM_ERROR_PER_TIER = 0.025;
// Likewise the lead: at 0.3 the boss mostly shoots where a strafing player WAS,
// which against anyone who keeps moving is a guaranteed miss regardless of damage.
const BASE_LEAD_FRACTION = 0.45;
const LEAD_PER_TIER = 0.1375;
const BASE_DODGE_REACTION_TICKS = 30; // half a second of warning needed
const DODGE_REACTION_PER_TIER = 5;
// One seeded roll per inbound ball, so this really is the fraction of shots a
// boss slips. It is capped low on purpose: evasion is a direct multiplier on the
// player's effective accuracy, and effective accuracy is the denominator of
// `roundsForPlayerToWin`, so this dial moves the wrong-answer margin faster than
// anything else on the profile.
//
// The range is DELIBERATELY NARROW, and it narrowed once already. When the engine's
// burst began setting velocity outright instead of accelerating into it, a taken
// dodge stopped ever failing: measured against a tier 5 boss, player accuracy is
// 49% when it never dodges and 2% when it always does, and it now escapes
// positionally every time rather than sometimes needing immunity frames. So the
// same nominal spread buys far more effective evasion than it used to, and the
// spread had to shrink to compensate. This is the authoritative evasion dial;
// dodgeReactionTicks below is only the trigger.
const BASE_DODGE_CHANCE = 0.09;
const DODGE_CHANCE_PER_TIER = 0.01;
const BASE_MOVE_SPEED_SCALE = 0.82;
const MOVE_SPEED_PER_TIER = 0.045;
const BASE_FIRE_INTERVAL_SCALE = 1.6;
const FIRE_INTERVAL_SCALE_PER_TIER = -0.14;

/**
 * Per-boss opt-ins layered over the tier curve. Both default off/flat so every
 * shipped tier keeps exactly the tuning `winnability.test.ts` measured; M1's
 * officer sets both. These are the "future-boss extension points" — a later boss
 * chooses its ammo rule and whether it takes cover without touching the curve.
 */
export interface BossProfileOverrides {
  readonly ammoPolicy?: BossAmmoPolicy;
  readonly takesCoverBeforeQuestion?: boolean;
  readonly tactical?: BossTacticalProfile | null;
}

export function bossProfileForTier(
  tier: BossTier,
  bossId = `BOSS.TIER_${tier}`,
  overrides: BossProfileOverrides = {},
): BossProfile {
  const step = tier - 1;
  return {
    bossId,
    tier,
    ammoPolicy: overrides.ammoPolicy ?? "AUTHORED_FLAT",
    takesCoverBeforeQuestion: overrides.takesCoverBeforeQuestion ?? false,
    tactical: overrides.tactical ?? null,
    maxHealth: BOSS_BASE_HEALTH + BOSS_HEALTH_PER_TIER * step,
    shotDamage: BASE_SHOT_DAMAGE + SHOT_DAMAGE_PER_TIER * tier,
    fireIntervalTicks: Math.max(
      6,
      Math.round(
        FIRE_INTERVAL_TICKS *
          (BASE_FIRE_INTERVAL_SCALE + FIRE_INTERVAL_SCALE_PER_TIER * step),
      ),
    ),
    // THE WRONG-ANSWER GRANT, AT EVERY TIER, AND THE TIER CURVE IS NOT IN HERE.
    //
    // It used to run 7 to 14 — "the tier 1 boss shoots like a player who knew
    // nothing and the tier 5 boss shoots like a player who knew everything" — which
    // reads well and is the wrong shape twice over.
    //
    // It breaks the readout. Hits-to-fall is rounds-for-the-boss-to-win times the
    // magazine, so a magazine that doubles across the tiers makes the player's bar
    // open at MORE hits against a harder boss unless damage falls to compensate,
    // and damage must rise. The two constraints are only compatible with a magazine
    // that is flat, which is what the arithmetic in the block above says as well.
    //
    // And it undercuts the economy it was decorating. The boss's magazine is
    // authored precisely because a boss does not answer a history question; handing
    // the top tier the correct-answer grant for free means the thing a student earns
    // by knowing the material is the thing the opponent gets for nothing. A boss
    // shoots like a player who knew nothing, always. What a higher tier buys is a
    // harder ball, a tighter cone, a better lead, and a longer life.
    //
    // THIS LINE MAKES THE WRONG-ANSWER GRANT A DIFFICULTY DIAL AS WELL AS AN ECONOMY
    // ONE, AND BOTH DIRECTIONS OF THAT ARE LOAD-BEARING. It is why the wrong-answer
    // margin is completely insensitive to BULLETS_FOR_WRONG — the grant divides both
    // sides of the ratio and cancels — and equally why trying the grant at 9 handed
    // every boss 29% more damage a round, which the CORRECT path pays for without a
    // compensating grant. That cost is what sent the floor back to 7. Read
    // KNOWLEDGE_ADVANTAGE_RATIO before touching either number, and do not decouple
    // this without reading it either.
    magazinePerRound: BULLETS_FOR_WRONG,
    aimErrorRad: Math.max(0.02, BASE_AIM_ERROR_RAD - AIM_ERROR_PER_TIER * step),
    leadFraction: Math.min(1, BASE_LEAD_FRACTION + LEAD_PER_TIER * step),
    dodgeReactionTicks: Math.max(
      6,
      BASE_DODGE_REACTION_TICKS - DODGE_REACTION_PER_TIER * step,
    ),
    dodgeChance: Math.min(0.9, BASE_DODGE_CHANCE + DODGE_CHANCE_PER_TIER * step),
    moveSpeedScale: BASE_MOVE_SPEED_SCALE + MOVE_SPEED_PER_TIER * step,
    coverSeekHealthFraction: 0.35 + 0.05 * step,
    strafePeriodTicks: Math.max(20, Math.round(FIELD_TICK_HZ * (1.4 - 0.12 * step))),
  };
}

export function bossFighterParams(profile: BossProfile): FighterParams {
  return {
    maxHealth: profile.maxHealth,
    shotDamage: profile.shotDamage,
    fireIntervalTicks: profile.fireIntervalTicks,
    loadout: [],
    moveSpeedScale: profile.moveSpeedScale,
    // No assist, deliberately. A boss's accuracy IS `aimErrorRad`; snapping it to
    // the intercept solution would delete the entire difficulty curve in one line.
    aimAssist: null,
  };
}

// ---- the winnability invariant ----------------------------------------------
//
// A duel now ends when a health bar empties, so winnability is a race and the
// invariant is a comparison of two rates. Everything here is a PROJECTION: it takes
// the measured reference accuracies as inputs and answers "who gets there first".
// It is deliberately cheap and deliberately approximate — the authority on whether
// a tier is winnable is `winnability.test.ts`, which simulates whole duels. This
// exists so a profile that is obviously unwinnable cannot reach a live duel at all,
// and so the intent is stated somewhere a reader can check it without running a
// four-second sweep.

export interface ExchangeProjection {
  /** Balls the player is granted each round on the path being projected. */
  readonly playerBullets: number;
  readonly playerDamagePerRound: number;
  readonly bossDamagePerRound: number;
  /** Rounds for the player to empty the boss. */
  readonly roundsForPlayerToWin: number;
  /** Rounds for the boss to empty the player. */
  readonly roundsForBossToWin: number;
  /**
   * How much sooner the player gets there. Above 1 the player wins, below 1 the
   * boss does, and the distance from 1 is the size of the edge.
   */
  readonly margin: number;
  /**
   * THE MARGIN IN THE CURRENCY A PLAYER ACTUALLY EXPERIENCES: how many more clean
   * hits they could take and still land the kill.
   *
   * The margin is a ratio of ROUNDS, and a ratio is silent about the size of the
   * thing it is a ratio of. Halving the player's health halves the number of hits
   * a given margin is worth while leaving the margin itself untouched, so a profile
   * can pass the winnability gate unchanged and start knocking players out anyway.
   * That is not hypothetical — it is what happened when health went from 400 to
   * 200 for the sake of the HUD's countdown, and it is why this is on the
   * projection rather than in a comment.
   *
   * Roughly two hits is the shape of the top tier now, and three at the bottom:
   * enough that a good player who makes one mistake still wins, few enough that two
   * mistakes cost the duel. It was three and six while the duel ran half as long,
   * and the fall is arithmetic rather than drift — this quantity is
   * `hitsToFall - health x bossAccuracy / (playerAccuracy x playerShotDamage)`, so
   * every round of extra duration is paid for out of it.
   */
  readonly playerHitsOfSlack: number;
}

export function projectExchange(
  profile: BossProfile,
  bullets: number,
  playerHealth = PLAYER_MAX_HEALTH,
  playerShotDamage = PLAYER_SHOT_DAMAGE,
  playerAccuracy = REFERENCE_PLAYER_ACCURACY,
  bossAccuracy = REFERENCE_BOSS_ACCURACY,
): ExchangeProjection {
  const playerDamagePerRound = bullets * playerAccuracy * playerShotDamage;
  const bossDamagePerRound =
    profile.magazinePerRound * bossAccuracy * profile.shotDamage;
  const roundsForPlayerToWin = profile.maxHealth / Math.max(1e-9, playerDamagePerRound);
  const roundsForBossToWin = playerHealth / Math.max(1e-9, bossDamagePerRound);
  const healthAtTheKill = playerHealth - roundsForPlayerToWin * bossDamagePerRound;
  return {
    playerBullets: bullets,
    playerDamagePerRound,
    bossDamagePerRound,
    roundsForPlayerToWin,
    roundsForBossToWin,
    margin: roundsForBossToWin / roundsForPlayerToWin,
    playerHitsOfSlack: healthAtTheKill / Math.max(1e-9, profile.shotDamage),
  };
}

/**
 * THE LONGEST CORRECT-ANSWER FIGHT THIS PROFILE COULD EVER HAVE, in rounds.
 *
 * Recorded as a function rather than a comment because it is the constraint anybody
 * reaching for "make the boss fight longer" will run into, and it took a full pass of
 * modelling to find. Read it before raising BOSS_BASE_HEALTH.
 *
 * The derivation is three lines of the exchange model rearranged:
 *
 *   correct rounds  =  wrong rounds / ratio                    (more balls)
 *   wrong rounds   <=  roundsForBossToWin / margin             (the winnability gate)
 *   correct rounds <=  roundsForBossToWin / (ratio x margin)
 *
 * THE PART THAT SURPRISES PEOPLE: THIS NUMBER DOES NOT DEPEND ON BOSS HEALTH. Health
 * cancels out — it sets where in the range a fight actually lands, and the ceiling is
 * fixed by the boss's OFFENCE against the player's bar. So health cannot buy a longer
 * fight past this line; past it, every extra point of health is spent moving the
 * wrong-answer margin below REQUIRED_WRONG_PATH_MARGIN, which `createDuel` refuses.
 *
 * At the shipped tiers it runs 4.7 rounds at tier 1 down to 4.0 at tier 5, and the
 * shipped profiles sit at 3.2 projected (3.9 measured, since a round is an integer and
 * the last one is partial). FOUR IS THEREFORE A CEILING AND NOT A PREFERENCE, and six
 * is arithmetically impossible: six rounds needs `roundsForBossToWin / (6 x ratio)` as a
 * margin, which is 0.9 at the most generous tier — a boss the wrong-answer player loses
 * to, which is the one thing the design forbids outright.
 *
 * BULLETS_FOR_WRONG CANCELS OUT OF THIS ENTIRELY, which is not obvious and is the first
 * thing anyone retuning the floor will want to know: it divides `roundsForBossToWin` (the
 * boss's magazine is the wrong-answer grant) and it divides the ratio, so moving the floor
 * between 7 and 9 moved this ceiling by nothing at all. See KNOWLEDGE_ADVANTAGE_RATIO in
 * tuning.ts for the reduction and for the cost that does NOT cancel.
 *
 * The only ways to raise it are to weaken the boss's offence or enlarge the player's
 * bar, and both are spoken for: `roundsForBossToWin` is also how long the boss needs
 * to finish a passive player, which `winnability.test.ts` bounds at 12 rounds so a duel
 * cannot fail to end, and the player's bar is sized so a hit is about a tenth of it for
 * the HUD's countdown. Every direction out of this box is already load-bearing.
 */
export function correctPathRoundCeiling(
  profile: BossProfile,
  playerHealth = PLAYER_MAX_HEALTH,
): number {
  const projection = projectExchange(profile, BULLETS_FOR_WRONG, playerHealth);
  return (
    projection.roundsForBossToWin /
    (KNOWLEDGE_ADVANTAGE_RATIO * REQUIRED_WRONG_PATH_MARGIN)
  );
}

/**
 * The wrong-answer margin a correct-answer fight of `rounds` would imply. Below
 * REQUIRED_WRONG_PATH_MARGIN the profile cannot ship, and below 1.0 the wrong-answer
 * player simply loses. The inverse of `correctPathRoundCeiling`, and the honest reply
 * to "what would it cost to make this a six-round fight?".
 */
export function marginImpliedByCorrectPathRounds(
  profile: BossProfile,
  rounds: number,
  playerHealth = PLAYER_MAX_HEALTH,
): number {
  const projection = projectExchange(profile, BULLETS_FOR_WRONG, playerHealth);
  return projection.roundsForBossToWin / (KNOWLEDGE_ADVANTAGE_RATIO * Math.max(1e-9, rounds));
}

/** What answering correctly is worth, in rounds saved. */
export function knowledgeAdvantage(profile: BossProfile): {
  readonly wrongPathRounds: number;
  readonly correctPathRounds: number;
  readonly roundsSaved: number;
} {
  const wrong = projectExchange(profile, BULLETS_FOR_WRONG);
  const correct = projectExchange(profile, BULLETS_FOR_CORRECT);
  return {
    wrongPathRounds: wrong.roundsForPlayerToWin,
    correctPathRounds: correct.roundsForPlayerToWin,
    roundsSaved: wrong.roundsForPlayerToWin - correct.roundsForPlayerToWin,
  };
}

/**
 * The design's one non-negotiable constraint, restated for an unbounded fight: a
 * mechanically strong player who answered every question wrong must still win.
 * Called by `createDuel`, so a profile that out-paces the player cannot reach a
 * live duel.
 */
export function assertBossWinnableOnWrongAnswers(
  profile: BossProfile,
  playerHealth = PLAYER_MAX_HEALTH,
  playerShotDamage = PLAYER_SHOT_DAMAGE,
): void {
  const projection = projectExchange(
    profile,
    BULLETS_FOR_WRONG,
    playerHealth,
    playerShotDamage,
  );
  if (projection.margin < REQUIRED_WRONG_PATH_MARGIN) {
    throw new Error(
      `boss ${profile.bossId} empties a ${playerHealth}-health player in ` +
        `${projection.roundsForBossToWin.toFixed(1)} rounds while a wrong-answer ` +
        `player needs ${projection.roundsForPlayerToWin.toFixed(1)} to empty its ` +
        `${profile.maxHealth}. That is a margin of ${projection.margin.toFixed(2)} ` +
        `against a required ${REQUIRED_WRONG_PATH_MARGIN}, or ` +
        `${projection.playerHitsOfSlack.toFixed(1)} clean hits of slack. Answering ` +
        `wrong is a handicap, never a lockout: cut this boss's health, magazine or ` +
        `damage.`,
    );
  }
}

export function validateBossProfile(profile: BossProfile): readonly string[] {
  const problems: string[] = [];
  if (profile.maxHealth <= 0) problems.push("maxHealth must be positive");
  if (profile.shotDamage <= 0) problems.push("shotDamage must be positive");
  if (profile.magazinePerRound < 1) problems.push("magazinePerRound must be >= 1");
  if (profile.fireIntervalTicks < 1) problems.push("fireIntervalTicks must be >= 1");
  if (profile.leadFraction < 0 || profile.leadFraction > 1) {
    problems.push("leadFraction must be within 0..1");
  }
  if (profile.dodgeChance < 0 || profile.dodgeChance > 1) {
    problems.push("dodgeChance must be within 0..1");
  }
  if (profile.aimErrorRad < 0) problems.push("aimErrorRad must be >= 0");
  if (!BOSS_AMMO_POLICIES.includes(profile.ammoPolicy)) {
    problems.push(`ammoPolicy must be one of ${BOSS_AMMO_POLICIES.join(", ")}`);
  }
  const projection = projectExchange(profile, BULLETS_FOR_WRONG);
  if (projection.margin < REQUIRED_WRONG_PATH_MARGIN) {
    problems.push(
      `wrong-answer margin ${projection.margin.toFixed(2)} is below the required ` +
        `${REQUIRED_WRONG_PATH_MARGIN}`,
    );
  }
  return problems;
}
