// Stealth feel tuning — the single place anybody tunes detection and alert.
//
// ONE DIFFICULTY. Every value here applies identically to every player, in every
// mission, at every Level. There is no per-player multiplier, no danger tier, no
// skill band and no Standing term. The design's flex rule is that the world's
// reaction bends and the player's requirement does not; detection is on the
// requirement side of that line, so it does not bend.
//
// Explicitly NOT carried forward from the previous detection code:
//   * STANDING_FACTORS — a per-player social-camouflage multiplier (0.7x to 1.4x)
//     that made the same geometry detect two players at different rates. Standing
//     is cut from the design and the multiplier is cut with it.
//   * HEAT_FACTORS — a global 0.8x to 1.6x multiplier on the accrual rate. Heat
//     as a *systemic* response is kept (see alert.ts: escalation, call-ins,
//     searches), but it no longer scales the detection maths. Escalation now
//     changes what patrols DO, not how fast eyes work.
//   * checkpointChallenges' standing/concealment pass — a social gate on a
//     scripted customs stop, which belongs to a chapter's authored content and
//     not to the movement core.
//   * its absolute eye and chest heights (1.62m / 1.05m / 0.62m). Detection now
//     reads the shared body model's landmarks off the live capsule height, so a
//     crouched silhouette is the same silhouette to a patrol's cone, to an aimed
//     shot and to the collision capsule. The old 1.62m eye also sat above the top
//     of a 1.55m capsule, which put a watcher's sightline over walls that should
//     have blocked it.

import { FIELD_TICK_HZ } from "../fieldSimulation.js";
import type { NoiseKind } from "./noise.js";

/** How exposed the player's body is, from stance and cover. */
export type PlayerExposure = "EXPOSED" | "PARTIAL" | "CONCEALED";

/** What the player is doing, as a watcher would read it. */
export type PlayerMotionRead =
  | "STILL"
  | "CROUCH_STILL"
  | "CROUCH_MOVE"
  | "WALK"
  | "SPRINT"
  | "TRAVERSAL";

function ticks(seconds: number): number {
  return Math.round(seconds * FIELD_TICK_HZ);
}

export interface StealthTuning {
  // ---- vision ----
  /** Default cone half-angle. Watcher definitions may narrow or widen it. */
  coneHalfAngleRad: number;
  /** Default sight range. */
  coneRangeM: number;
  /**
   * Fraction of the sight range within which distance costs nothing. A linear
   * falloff from the eye makes a guard staring at somebody six metres away only
   * 60% as sensitive as one at arm's length, which reads as blindness. Inside this
   * band the guard sees perfectly well; beyond it, sensitivity feathers to nothing
   * at maximum range.
   */
  coneNearRangeFraction: number;
  /** Visibility below which nothing accrues at all: a glimpse is not a sighting. */
  minAccrualVisibility: number;
  /** Multiplier applied per exposure state. */
  exposure: Readonly<Record<PlayerExposure, number>>;
  /** Multiplier applied per motion read. */
  motion: Readonly<Record<PlayerMotionRead, number>>;
  /** Multiplier while the player's capsule is behind hard cover. */
  coverFactor: number;
  /** Multiplier at full darkness. Interpolated by the authored light level. */
  darkFactor: number;

  // ---- suspicion ----
  /** Suspicion gained per second at visibility 1. */
  accrualPerSecond: number;
  /** Suspicion lost per second with no contact. */
  decayPerSecond: number;
  /** Ticks of no-contact before decay starts, so a flicker of cover is not a reset. */
  decayHoldTicks: number;
  /** Suspicion thresholds for each alert state. */
  thresholds: {
    curious: number;
    investigating: number;
    alerted: number;
  };
  /**
   * Hysteresis: a watcher only returns to UNAWARE below this, well under the
   * curious threshold, so a suspicion hovering at the edge does not flicker the
   * state (and the tell) on and off.
   */
  standDownSuspicion: number;
  /** Floor suspicion decays to while a watcher is still searching. */
  searchingFloor: number;

  // ---- alert behaviour ----
  /** Ticks a watcher holds its post looking before walking to investigate. */
  curiousHoldTicks: number;
  /** Ticks a watcher spends searching a last-known position before standing down. */
  searchTicks: number;
  /** Ticks of zero visibility before a watcher loses contact. */
  loseContactTicks: number;
  /** Ticks between a first-hand sighting and the shout that pulls others in. */
  callDelayTicks: number;
  /** Radius within which a shout is heard. */
  callRadiusM: number;
  /** How fast a watcher's facing swings toward an attention target. */
  attentionTurnRadPerSecond: number;
  /**
   * Suspicion added per unit of audibility, per noise EVENT, by kind.
   *
   * An impulse, not a rate. A landing or an impact happens on exactly one tick,
   * so integrating it as suspicion-per-second makes the loudest thing in the game
   * worth three thousandths of a suspicion bar and no player would ever notice
   * that noise exists. Callers must therefore deliver each noise event on exactly
   * one tick; both the parkour layer and the thrown-object simulation do.
   */
  noiseSuspicionImpulse: Readonly<Record<NoiseKind, number>>;
  /** Audibility below which a noise is ignored entirely. */
  minAudibleNoise: number;
  /**
   * Ceiling on suspicion built from noise alone. A guard who hears a thump comes
   * to look, and can be brought right to the brink by repeated noise, but only
   * eyes produce certainty. Without this ceiling a player could be fully detected,
   * and the squad called in, by a watcher who never saw anybody.
   */
  noiseSuspicionCeiling: number;

  // ---- reflex time ----
  /**
   * Simulation rate while reflex time is open. The renderer scales its frame
   * delta by this before handing it to advanceFieldClock, so the fixed step and
   * the tick sequence are untouched — only the number of real seconds per tick
   * changes. There is no second clock.
   */
  reflexTimeScale: number;
  /** Length of the window in WORLD ticks. Real seconds = ticks / hz / timeScale. */
  reflexWindowTicks: number;
  /** Uses per mission. Not refunded, not regenerated. */
  reflexChargesPerMission: number;
  /** World ticks between one window closing and another being allowed. */
  reflexCooldownTicks: number;
  /** Ticks of unbroken zero-visibility that close the window early as a success. */
  reflexEscapeTicks: number;

  // ---- the hunt ----
  //
  // What a confirmed sighting costs. Position and seconds, never the run: see
  // hunt.ts for the argument, and note that nothing in this block scales
  // detection. A hunt changes where patrols look and how long they keep looking,
  // which is the systemic half of escalation that survived the cut of
  // HEAT_FACTORS.
  /** Watchers within this of the sighting are drawn into the search. */
  huntBaseRadiusM: number;
  /** How much wider each further detection makes it. */
  huntRadiusPerDetectionM: number;
  /** How far from the sighting the player must get before a hunt can break. */
  huntEscapeDistanceM: number;
  /** How much further each further detection asks for. */
  huntEscapePerDetectionM: number;
  /** Ticks a hunt runs before giving up on its own. */
  huntBaseTicks: number;
  /** How much longer each further detection makes it. */
  huntTicksPerDetection: number;
  /** Ticks of unbroken no-contact required before distance can break a hunt. */
  huntBreakTicks: number;
  /** Detections after which the hunt stops getting worse. */
  huntEscalationSteps: number;
  /**
   * Suspicion a hunting watcher is held at.
   *
   * At the investigating threshold, so a watcher inside the hunt walks the search
   * ladder up to SEARCHING and stays there — awake, sweeping, and one glimpse
   * away from certainty — without ever being ALERTED on its own. That distinction
   * is load-bearing: `alertedTicks` is a mission's fail clock, and a hunt must
   * never be able to run it.
   */
  huntSuspicionFloor: number;

  // ---- crowd blending ----
  /** Ticks of continuous presence in a cluster before the blend is complete. */
  crowdBlendEnterTicks: number;
  /** Ticks after leaving a cluster before the blend is fully gone. */
  crowdBlendExitTicks: number;
  /** Speed above which the player parts the crowd instead of joining it. */
  crowdBlendMaxSpeedMps: number;
  /** Minimum civilian count for a cluster to hide anybody. */
  crowdBlendMinDensity: number;
  /**
   * A watcher this close with unbroken sight through the whole blend-in watched
   * the player walk in, and is not fooled.
   */
  crowdBlendPierceM: number;

  // ---- thrown diversion ----
  /**
   * Launch speed of a thrown object. This and throwMaxRangeM are coupled: the
   * ballistic solver refuses anything the speed cannot physically reach, so a
   * declared range longer than v^2/g plus the release height is a range the player
   * is never actually offered. Keep them in step (there is a test).
   */
  throwSpeedMps: number;
  /** Furthest a throw is offered. Beyond the watcher sight range on purpose. */
  throwMaxRangeM: number;
  /** Fraction of speed retained through a bounce. */
  throwRestitution: number;
  /** Bounces after which the object is at rest regardless of speed. */
  throwMaxBounces: number;
  /** Speed below which a bouncing object is at rest. */
  throwRestSpeedMps: number;
  /** Loudness of the first impact. */
  throwImpactIntensity: number;
  /** Loudness of the object settling. */
  throwRestIntensity: number;
  /** Metres of noise radius per unit intensity. */
  noiseRadiusPerIntensityM: number;
  /** Ticks a watcher stays interested in a diversion point. */
  diversionHoldTicks: number;
  /** Objects a player carries per mission. */
  diversionChargesPerMission: number;
}

export const STEALTH_TUNING: StealthTuning = {
  coneHalfAngleRad: (55 * Math.PI) / 180,
  coneRangeM: 16,
  coneNearRangeFraction: 0.4,
  minAccrualVisibility: 0.1,
  exposure: {
    EXPOSED: 1,
    PARTIAL: 0.55,
    CONCEALED: 0.15,
  },
  motion: {
    STILL: 0.5,
    CROUCH_STILL: 0.32,
    CROUCH_MOVE: 0.55,
    WALK: 0.85,
    SPRINT: 1.3,
    TRAVERSAL: 1.5,
  },
  coverFactor: 0.3,
  darkFactor: 0.45,

  accrualPerSecond: 0.85,
  decayPerSecond: 0.55,
  decayHoldTicks: ticks(0.6),
  thresholds: {
    curious: 0.3,
    investigating: 0.62,
    alerted: 1,
  },
  standDownSuspicion: 0.18,
  searchingFloor: 0.35,

  curiousHoldTicks: ticks(1.2),
  searchTicks: ticks(9),
  loseContactTicks: ticks(0.5),
  callDelayTicks: ticks(0.7),
  callRadiusM: 22,
  attentionTurnRadPerSecond: 3.2,
  noiseSuspicionImpulse: {
    PLAYER_MOVE: 1,
    PLAYER_LANDING: 1,
    // A thrown object redirects attention and never implicates the player. This
    // being zero is the difference between a diversion and a confession.
    DIVERSION_IMPACT: 0,
    DIVERSION_REST: 0,
    ENVIRONMENT: 0,
  },
  minAudibleNoise: 0.05,
  noiseSuspicionCeiling: 0.85,

  reflexTimeScale: 0.35,
  reflexWindowTicks: ticks(1.6),
  reflexChargesPerMission: 3,
  reflexCooldownTicks: ticks(12),
  reflexEscapeTicks: ticks(0.2),

  // A little under the 22m shout radius, so the squad a shout pulls in is
  // roughly the squad that then keeps searching.
  huntBaseRadiusM: 18,
  huntRadiusPerDetectionM: 6,
  // ~3.5 seconds of open sprinting, which in practice is fifteen to twenty
  // seconds of getting there without being seen again. Enough to be a real cost
  // against a three-minute budget; nowhere near enough to be a punishment.
  huntEscapeDistanceM: 16,
  huntEscapePerDetectionM: 4,
  huntBaseTicks: ticks(22),
  huntTicksPerDetection: ticks(8),
  huntBreakTicks: ticks(3),
  huntEscalationSteps: 3,
  huntSuspicionFloor: 0.62,

  crowdBlendEnterTicks: ticks(0.7),
  crowdBlendExitTicks: ticks(0.4),
  crowdBlendMaxSpeedMps: 2.4,
  crowdBlendMinDensity: 4,
  crowdBlendPierceM: 6,

  throwSpeedMps: 14,
  throwMaxRangeM: 18,
  throwRestitution: 0.35,
  throwMaxBounces: 2,
  throwRestSpeedMps: 1.2,
  throwImpactIntensity: 0.7,
  throwRestIntensity: 0.25,
  noiseRadiusPerIntensityM: 22,
  diversionHoldTicks: ticks(4),
  diversionChargesPerMission: 3,
};

/**
 * Reflex time, in real seconds the player actually gets to react. Derived so the
 * budget can be asserted rather than asserted-about.
 */
export const REFLEX_BUDGET = {
  windowWorldSeconds: STEALTH_TUNING.reflexWindowTicks / FIELD_TICK_HZ,
  windowRealSeconds:
    STEALTH_TUNING.reflexWindowTicks /
    FIELD_TICK_HZ /
    STEALTH_TUNING.reflexTimeScale,
  charges: STEALTH_TUNING.reflexChargesPerMission,
  cooldownWorldSeconds: STEALTH_TUNING.reflexCooldownTicks / FIELD_TICK_HZ,
  get totalWorldSeconds(): number {
    return this.windowWorldSeconds * this.charges;
  },
  get totalRealSeconds(): number {
    return this.windowRealSeconds * this.charges;
  },
} as const;

/**
 * Scale a render frame delta for the sim clock. This is the ONLY mechanism by
 * which reflex time slows the game: the fixed step, the tick indices and the
 * seeded kernel are all untouched, so a replay of the same tick sequence
 * reproduces bit-for-bit whether or not reflex time fired.
 */
export function scaledFrameDt(frameDtS: number, timeScale: number): number {
  if (!Number.isFinite(frameDtS) || frameDtS <= 0) return 0;
  return frameDtS * Math.max(0, Math.min(1, timeScale));
}
