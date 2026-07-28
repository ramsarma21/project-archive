// Parkour feel tuning — the single place anybody tunes flow traversal.
//
// Every threshold the verb ladder, the chain controller and the leap-of-faith
// solver consult lives in PARKOUR_TUNING. No traversal file may hardcode a
// distance, height, duration or noise level of its own.
//
// The published movement envelope (MOVEMENT_CAPABILITIES) is DERIVED from the
// shared physics constants in playerMotion/collision rather than restated, so a
// change to gravity or jump velocity cannot silently desync level geometry from
// what the player can actually do. Level design does its traversability
// arithmetic against MOVEMENT_CAPABILITIES; if a number here moves, their
// budget moves with it.

import { CAPSULE_RADIUS, CROUCH_HEIGHT, STAND_HEIGHT } from "../collision.js";
import { FIELD_TICK_HZ } from "../fieldSimulation.js";
import {
  CROUCH_SPEED,
  DASH_DURATION_MS,
  GRAVITY,
  RUNNING_JUMP_VY,
  RUN_SPEED,
  STEP_DOWN,
  STEP_UP,
  WALK_SPEED,
  dashSpeed,
} from "../playerMotion.js";
import type { TraversalClassifierConfig } from "../traversalClassifier.js";

// ---- verb vocabulary -------------------------------------------------------

/**
 * Every base traversal verb. All of these are available at Level 0 to every
 * player: none is an unlockable ability, so no mission may be gated on one.
 *
 * Two of them — JUMP and DASH — are the only ones the player names. Everything
 * else is read off the geometry. That split is deliberate: a verb the geometry
 * can infer should never need a button, and a verb the geometry CANNOT infer
 * must have one, or the input is a guess. There is nothing ahead of a player on
 * open ground that tells the reader they wanted to leave the floor, and nothing
 * in the world that says they wanted to be two metres left of here right now.
 */
// Move set folded toward a small, always-correct vocabulary (owner: "a simple
// parkour type mission ... ONE ROUTE"). MANTLE folded into CLIMB_UP: the two
// already drove the SAME authored motion (a mantle is a CLIMB_UP with a mantle
// clip) and share an envelope band, so the merge removes a verb LABEL, not a
// behaviour, and CLIMB_UP now spans the old mantle band as well.
//
// CLIMB_OVER is deliberately KEPT distinct, not folded into VAULT: a climb-over
// crosses a thin obstacle in the 1.15-1.90m band, above VAULT's published
// envelope ceiling of 1.15m, so folding it would silently widen the vault
// contract level design budgets gaps against. Cutting a verb must not enlarge
// another's envelope; the two thin-crossing bands stay two verbs. DASH stays
// (the owner asked for it and a real clip is baked). See select.rankObstacle.
export type TraversalVerb =
  | "NONE"
  | "STEP_UP"
  | "SLIDE"
  | "VAULT"
  | "CLIMB_OVER"
  | "CLIMB_UP"
  | "JUMP"
  | "JUMP_GAP"
  | "DASH"
  | "HANG_DROP"
  | "RUN_OFF"
  | "LEAP_OF_FAITH"
  | "EDGE_BRAKE"
  | "BLOCKED";

/**
 * The two verbs the player names with a key. Geometry never asks for these, so
 * a route cannot author one and level tooling must not expect to find one.
 */
export const PLAYER_NAMED_VERBS: ReadonlySet<TraversalVerb> = new Set<TraversalVerb>([
  "JUMP",
  "DASH",
]);

/**
 * Verbs that mean the reader gave up. A route containing either is a route with
 * a defect in it.
 */
export const FAILURE_VERBS: ReadonlySet<TraversalVerb> = new Set<TraversalVerb>([
  "BLOCKED",
  "EDGE_BRAKE",
]);

/**
 * Every verb a level's geometry can actually ask for.
 *
 * This exists so level tooling can assert "the route exercises the whole
 * vocabulary" against a list that maintains itself. Enumerating the verb table
 * directly and subtracting known exceptions by hand works right up until the
 * vocabulary grows, at which point a level fails a test for not authoring a
 * verb that is not authorable.
 */
export const AUTHORABLE_VERBS: readonly TraversalVerb[] = [
  "STEP_UP",
  "SLIDE",
  "VAULT",
  "CLIMB_OVER",
  "CLIMB_UP",
  "JUMP_GAP",
  "HANG_DROP",
  "RUN_OFF",
  "LEAP_OF_FAITH",
];

/** Landing flavor resolved from the drop height actually fallen. */
export type LandingKind = "NONE" | "RUN" | "ROLL" | "HARD" | "RECEIVED";

// ---- tuning ----------------------------------------------------------------

export interface ParkourTuning {
  /** Minimum horizontal speed before the flow reader will commit any verb. */
  flowMinSpeedMps: number;
  /** Speed at or above which a verb reads as a full-commitment sprint verb. */
  sprintThresholdMps: number;
  /** How far ahead obstacles are read, along the travel direction. */
  obstacleProbeM: number;
  /** How far ahead the ground is read for ledges. */
  edgeProbeM: number;
  /** How far past a lip a landable far lip is searched for. */
  gapProbeM: number;
  /** Probe march granularity. Smaller is more accurate and more expensive. */
  probeStepM: number;
  /** Bisection passes used to refine a marched contact distance. */
  probeRefineSteps: number;

  /**
   * Lip the mover walks up on its own, so the ladder offers nothing for it.
   *
   * The reader and the integrator have to agree about this or the player gets
   * both answers: a 10cm kerb the body would have stepped over unnoticed was
   * also ranking a 750ms scripted vault, and the verb won because it is read
   * first. Below this height the geometry is not an obstacle, it is ground.
   */
  freeStepUpM: number;
  /** Lip absorbed at speed with no stop and no stance change. */
  stepUpMaxHeightM: number;
  /** Tallest obstacle crossed by a speed vault. */
  vaultMaxHeightM: number;
  /** Deepest obstacle crossed by a speed vault. */
  vaultMaxDepthM: number;
  /** Largest drop a vault may land into on the far side. */
  vaultMaxLandingDropM: number;
  /** Tallest ledge pulled onto without slowing to a climb. */
  mantleMaxHeightM: number;
  /** Tallest obstacle crossed by vaulting over a top too narrow to stand on. */
  climbOverMaxHeightM: number;
  /** Deepest such obstacle. */
  climbOverMaxDepthM: number;
  /** Tallest wall climbed. Above this the geometry is BLOCKED. */
  climbMaxHeightM: number;

  /** Minimum overhead clearance a slide needs (crouch capsule plus margin). */
  slideMinHeadroomM: number;
  /** A gap taller than this is walked through, not slid under. */
  slideMaxHeadroomM: number;
  /** Longest low span a single slide crosses. */
  slideMaxDepthM: number;
  /** Minimum entry speed for a slide. */
  slideMinSpeedMps: number;

  /** Minimum speed at which a gap is auto-jumped. */
  jumpGapMinSpeedMps: number;
  /** Ballistic solve margin: the predicted landing must clear the far lip by this. */
  jumpGapSafetyM: number;

  /**
   * Speed above which a named jump launches as a running jump rather than a
   * standing one. Below it the body has no momentum worth preserving and a
   * forward-carrying arc would read as a shove the player did not ask for.
   */
  jumpRunThresholdMps: number;
  /**
   * Lateral steering authority while airborne, in m/s^2.
   *
   * IT TURNS THE VELOCITY AND NEVER LENGTHENS IT. The horizontal speed is
   * restored to its pre-steer magnitude every step, so air control changes where
   * a jump goes and not how far it reaches. That is what keeps
   * `MOVEMENT_CAPABILITIES.maxFlatGapM` an honest number: level design budgets
   * against a range this channel cannot inflate, while the player still gets to
   * correct a takeoff they mistimed. Zero air control on a one-second arc is the
   * single most common "the game ignored me" complaint, and the cheapest to fix.
   */
  airControlMps2: number;

  /**
   * Directed ground burst. Distance and duration are NOT restated here — the
   * burst is opened with playerMotion's own `dashSpeed(RUN_SPEED)` and
   * `DASH_DURATION_MS`, the same call the duel's dodge makes, so a dash across a
   * rooftop and a dodge in the yard are one move with two names. See flow.ts.
   */
  /** Ticks after a burst ends before another may open. */
  dashCooldownTicks: number;

  /** Drop the player simply runs off and absorbs on the run. */
  runOffMaxDropM: number;
  /** Drop resolved with a roll. Above this the landing is hard. */
  rollMaxDropM: number;
  /** Tallest drop taken as a controlled facing-the-wall hang drop. */
  hangDropMaxDropM: number;
  /**
   * Above this drop the flow reader refuses to run off an edge and brakes
   * instead, unless the player deliberately jumps or a receiving target is in
   * range. Accidental roof falls are a feel defect, not a challenge.
   */
  edgeBrakeMinDropM: number;
  /** Distance from the lip at which the brake engages. */
  edgeBrakeDistanceM: number;
  /** Fraction of forward speed retained per tick while braking at a lip. */
  edgeBrakeRetainPerTick: number;
  /**
   * Distance from the lip at which the brake becomes a hard stop. Damping alone
   * converges to a slow creep rather than a stop, because grounded motion keeps
   * re-accelerating toward held input — so inside this distance the component of
   * velocity heading over the lip is removed outright. The lip behaves as a wall
   * the player can still turn away from, never as a slope they slide off.
   */
  edgeBrakeHoldM: number;

  /** Minimum drop before a leap of faith is offered at all. */
  leapMinDropM: number;
  /** Horizontal radius within which a receiving target accepts a landing. */
  leapTargetRadiusM: number;
  /** Widest angle off the travel direction a target may sit for an auto-offer. */
  leapMaxOffAxisRad: number;
  /** Extra horizontal launch speed added to the dive off the lip. */
  leapLaunchSpeedMps: number;
  /** Upward launch velocity of the dive; a swan dive is not a jump. */
  leapLaunchVyMps: number;

  /** Contact distance at which an obstacle verb commits. */
  commitDistanceM: number;
  /**
   * Floor for the edge commit distance. An edge verb fires on the last grounded
   * tick before the lip — one tick of travel, or this, whichever is larger — so
   * the takeoff point is as close to the lip as a fixed step allows. Committing
   * at a fixed larger distance would spend part of the jump's range on the run-up
   * and quietly shrink every gap level design is allowed to author.
   */
  edgeCommitMinM: number;
  /** Ticks after a verb completes during which the next verb counts as chained. */
  chainWindowTicks: number;
  /** Ticks after a verb completes before another verb may commit. */
  verbCooldownTicks: number;
  /**
   * Ticks a jump press stays live after it arrives.
   *
   * A press does not reach a tick that can act on it. It reaches whichever tick
   * happens to be next, and that tick is very often one the jump cannot be taken
   * on: still airborne with the ground a frame away, halfway through a vault,
   * inside the verb cooldown. Without a window those presses are simply gone,
   * and a movement verb that silently does nothing is indistinguishable from a
   * dropped key — which is exactly what "half the time shift jumps don't work"
   * describes.
   *
   * Matched to `FREE_INPUT_BUFFER_MS` in playerInput.ts, which is the tolerance
   * this repo already set for a player with ordinary reflexes on a trackpad. A
   * second verb is not a reason to set a second standard.
   */
  jumpBufferTicks: number;
  /** Fraction of pre-verb speed restored on exit while chaining. */
  chainExitSpeedFraction: number;
  /** Fraction restored on a cold (unchained) verb exit. */
  coldExitSpeedFraction: number;
  /** Chain length at which the flow readout reports a full chain. */
  chainFlowLength: number;

  /** Authored-action durations in milliseconds, per verb. */
  durationsMs: Readonly<Record<TraversalVerb, number>>;
  /** Duration multiplier when a verb is entered below sprintThresholdMps. */
  slowEntryDurationMultiplier: number;
  /** Vault loft, metres above the obstacle top at the arc midpoint. */
  vaultArcHeightM: number;
  /** Mantle loft. */
  mantleArcHeightM: number;
  /** How far past the near lip a mantle/step-up plants its feet. */
  topLandingInsetM: number;
  /** Clearance kept between a verb's exit point and the obstacle it crossed. */
  landingMarginM: number;

  /**
   * Fraction of the airborne horizontal speed that survives touchdown, per
   * landing flavor.
   *
   * THIS IS THE MOMENTUM SEAM FOR EVERY LANDING, not just for the two the reader
   * happened to have named. `stepBallistic` zeroes velocity on contact, which is
   * right for a body arriving on a surface and wrong for a run that is still
   * happening — so before this existed, any landing the reader had not tagged as
   * a jump or a run-off dumped the player to a standstill, and a fall the player
   * did not choose cost them their line as well as their seconds.
   *
   * The ladder is the whole teaching tool: a small drop costs nothing, a roll
   * costs a sliver, and a hard landing costs all of it. That differential is what
   * makes reading heights worth doing.
   */
  landingSpeedRetention: Readonly<Record<LandingKind, number>>;
  /** Noise [0,1] emitted by each verb, consumed by the stealth field. */
  verbNoise: Readonly<Record<TraversalVerb, number>>;
  /** Noise emitted by each landing flavor. */
  landingNoise: Readonly<Record<LandingKind, number>>;
  /** Metres of noise radius per unit of noise intensity. */
  noiseRadiusPerIntensityM: number;
}

export const PARKOUR_TUNING: ParkourTuning = {
  flowMinSpeedMps: 0.9,
  sprintThresholdMps: 3.2,
  obstacleProbeM: 2.2,
  edgeProbeM: 1.6,
  gapProbeM: 7,
  probeStepM: 0.16,
  probeRefineSteps: 7,

  freeStepUpM: STEP_UP,
  stepUpMaxHeightM: 0.5,
  vaultMaxHeightM: 1.15,
  vaultMaxDepthM: 1.2,
  vaultMaxLandingDropM: 1.2,
  mantleMaxHeightM: 1.9,
  climbOverMaxHeightM: 1.9,
  climbOverMaxDepthM: 0.9,
  climbMaxHeightM: 3.2,

  slideMinHeadroomM: 1,
  slideMaxHeadroomM: 1.45,
  slideMaxDepthM: 2.6,
  slideMinSpeedMps: 3.2,

  jumpGapMinSpeedMps: 3,
  jumpGapSafetyM: 0.25,

  jumpRunThresholdMps: 1.2,
  // ~0.36 m of lateral correction over a full-height jump's 0.96s airtime at
  // sprint speed. Enough to save a takeoff aimed a body-width wrong, far too
  // little to steer onto a ledge that was never in the arc.
  airControlMps2: 7,

  // 0.6s. Long enough that a dash is a decision rather than a second run speed,
  // short enough to use twice crossing one courtyard.
  dashCooldownTicks: 36,

  runOffMaxDropM: 2.2,
  rollMaxDropM: 5.5,
  hangDropMaxDropM: 3.2,
  edgeBrakeMinDropM: 5.5,
  edgeBrakeDistanceM: 0.75,
  edgeBrakeRetainPerTick: 0.82,
  edgeBrakeHoldM: 0.2,

  leapMinDropM: 6,
  leapTargetRadiusM: 1.6,
  leapMaxOffAxisRad: 0.7,
  leapLaunchSpeedMps: 1.4,
  leapLaunchVyMps: 1.1,

  commitDistanceM: 0.55,
  edgeCommitMinM: 0.05,
  // 1.5s. Obstacles three to four metres apart are ~0.8s apart at sprint speed,
  // so a shorter window drops the chain between two ordinary street obstacles and
  // the flow reward never actually pays out.
  chainWindowTicks: 90,
  verbCooldownTicks: 4,
  // 7 ticks, ~117ms: the jump's own input buffer, rounded down to a whole step.
  jumpBufferTicks: 7,
  chainExitSpeedFraction: 1,
  coldExitSpeedFraction: 0.82,
  chainFlowLength: 3,

  // A WINDOW HAS TO BE LONG ENOUGH TO HOST A BODY, and two of these were not.
  //
  // The animation pass measured what each performance needs to read as a human
  // at the 4.0x playback ceiling, and found the vault overrunning its window by
  // 2.0x and the mantle by 2.1x. At those ratios the clip is faded out partway
  // through the move: what the player saw of a vault was the body ducking and
  // then arriving on the far side without a leg ever leaving the ground, which
  // is the "interactions don't look smooth" complaint said precisely.
  //
  // The objection to lengthening them is the 180-second traversal budget, and
  // it does not survive being measured. Asking the shipped ladder what verb it
  // offers at every hold on the guaranteed line and adding up the windows: the
  // fast line spends 15.7s of its ~40s inside verbs and these two changes cost
  // it 4.1s, against 135 seconds of unspent clock. The long safe line spends
  // 31.3s of ~74s and pays 8.5s. There was never a pacing problem here; there
  // was an assumption that there might be.
  //
  // STEP_UP, SLIDE, CLIMB_OVER and CLIMB_UP are left alone: they overrun by 1.2x
  // or less, or not at all, and 520-900ms is already a long commit. The two
  // LANDING windows that also overrun are deliberately not touched — a landing
  // window is recovery the player feels as sluggishness rather than a slot for a
  // performance, so stretching it buys a nicer picture with a worse control
  // feel. Those two want a shorter re-baked take instead; see the handoff.
  durationsMs: {
    NONE: 0,
    STEP_UP: 200,
    SLIDE: 550,
    // 45 fixed steps. The `vault` take is ~3.0s of content and needs 4.0x.
    VAULT: 750,
    CLIMB_OVER: 520,
    CLIMB_UP: 900,
    // Ballistic and burst verbs are timed by the integrator, not authored.
    JUMP: 0,
    JUMP_GAP: 0,
    DASH: 0,
    HANG_DROP: 420,
    RUN_OFF: 0,
    LEAP_OF_FAITH: 0,
    EDGE_BRAKE: 0,
    BLOCKED: 0,
  },
  slowEntryDurationMultiplier: 1.35,
  vaultArcHeightM: 0.22,
  mantleArcHeightM: 0.1,
  topLandingInsetM: 0.5,
  landingMarginM: 0.45,

  landingSpeedRetention: {
    NONE: 0,
    RUN: 1,
    ROLL: 0.85,
    HARD: 0,
    // A dive ends in a hay cart. Coming to rest is the payoff, not a cost.
    RECEIVED: 0,
  },
  verbNoise: {
    NONE: 0,
    STEP_UP: 0.15,
    SLIDE: 0.45,
    VAULT: 0.3,
    CLIMB_OVER: 0.35,
    CLIMB_UP: 0.2,
    JUMP: 0.3,
    JUMP_GAP: 0.3,
    // Scuffed boots over three tenths of a second: quieter than a vault, louder
    // than a walk, and never the reason a player is heard.
    DASH: 0.22,
    HANG_DROP: 0.2,
    RUN_OFF: 0.1,
    LEAP_OF_FAITH: 0.25,
    EDGE_BRAKE: 0,
    BLOCKED: 0,
  },
  landingNoise: {
    NONE: 0,
    RUN: 0.2,
    ROLL: 0.5,
    HARD: 0.95,
    RECEIVED: 0.35,
  },
  noiseRadiusPerIntensityM: 14,
};

// ---- derived, published movement envelope ----------------------------------

// The functions below take an optional approach speed and launch velocity, both
// defaulting to the engine's own. The defaults ARE the Level 0 envelope and nothing
// about `MOVEMENT_CAPABILITIES` changes; the parameters exist so that a layer which
// legitimately raises one of them — an ability scaling the target velocity handed to
// the integrator, or the launch handed to `beginRunningJump` — can ask THIS function
// what the result is, instead of reimplementing the ballistics and drifting.
//
// That is the whole reason they are parameters rather than constants: there must be
// exactly one place that knows how far a body can jump.

/** Airtime of a jump launched from and landing at the same height. */
export function jumpAirtimeS(launchVy = RUNNING_JUMP_VY): number {
  return (2 * launchVy) / GRAVITY;
}

/** Airtime of a running jump at the engine's launch velocity. */
export const JUMP_AIRTIME_S = jumpAirtimeS();

/** Apex of a jump above the launch height. Goes as the square of the launch. */
export function jumpApexM(launchVy = RUNNING_JUMP_VY): number {
  return (launchVy * launchVy) / (2 * GRAVITY);
}

/** Apex of any jump above the launch height, at the engine's launch velocity. */
export const JUMP_APEX_M = jumpApexM();

/**
 * Airtime of a running jump that lands `dropM` below the launch height.
 * Solves 0 = vy*t - g*t^2/2 + dropM for positive t.
 */
export function jumpAirtimeForDrop(dropM: number, launchVy = RUNNING_JUMP_VY): number {
  const drop = Math.max(0, dropM);
  return (
    (launchVy + Math.sqrt(launchVy * launchVy + 2 * GRAVITY * drop)) / GRAVITY
  );
}

/**
 * How far behind the lip the auto-jump actually leaves the ground: one fixed
 * step of travel at the approach speed, plus the capsule radius. Real geometry has
 * to be budgeted against the real takeoff point, not an idealised one at the lip.
 *
 * Scales with speed, which matters: a faster approach covers more ground in the tick
 * before takeoff, so a boosted gap is not simply the base gap times the speed.
 */
export function jumpTakeoffSetbackM(speedMps = RUN_SPEED): number {
  return speedMps / FIELD_TICK_HZ + CAPSULE_RADIUS;
}

/** Takeoff setback at sprint speed. */
export const JUMP_TAKEOFF_SETBACK_M = jumpTakeoffSetbackM();

/**
 * Largest lip-to-lip gap clearable when the far lip sits `dropM` below the near
 * lip. Three deductions from the raw ballistic range: the takeoff setback behind the
 * near lip, and the capsule radius that must clear the far lip before the feet find
 * support.
 *
 * Defaults to sprint speed and the engine's launch velocity, which is the Level 0
 * guarantee level design budgets against.
 */
export function maxGapMetersForDrop(
  dropM: number,
  speedMps = RUN_SPEED,
  launchVy = RUNNING_JUMP_VY,
): number {
  return Math.max(
    0,
    speedMps * jumpAirtimeForDrop(dropM, launchVy) -
      jumpTakeoffSetbackM(speedMps) -
      CAPSULE_RADIUS,
  );
}

/**
 * Safety margin between what the engine can physically solve and what level
 * design is allowed to author, so a gap built exactly to budget always clears
 * even with imperfect approach speed.
 */
export const LEVEL_DESIGN_GAP_MARGIN_M = 0.35;

/** Largest gap level design may author at a given drop. */
export function levelDesignMaxGapM(dropM: number): number {
  return (
    Math.round((maxGapMetersForDrop(dropM) - LEVEL_DESIGN_GAP_MARGIN_M) * 10) /
    10
  );
}

/**
 * The movement envelope, in real numbers. This is the contract between this
 * system and level design: geometry authored inside these limits is guaranteed
 * traversable by every player at Level 0 with no ability unlocked.
 */
export const MOVEMENT_CAPABILITIES = {
  /** Body. */
  capsuleRadiusM: CAPSULE_RADIUS,
  standHeightM: STAND_HEIGHT,
  crouchHeightM: CROUCH_HEIGHT,

  /** Speeds. Sprint is the flow speed; there is no speed above it. */
  sprintSpeedMps: RUN_SPEED,
  walkSpeedMps: WALK_SPEED,
  crouchSpeedMps: CROUCH_SPEED,

  /** Jump. */
  gravityMps2: GRAVITY,
  jumpVelocityMps: RUNNING_JUMP_VY,
  jumpApexM: JUMP_APEX_M,
  jumpAirtimeS: JUMP_AIRTIME_S,

  /** Gaps, lip to lip. */
  jumpTakeoffSetbackM: JUMP_TAKEOFF_SETBACK_M,
  maxFlatGapM: maxGapMetersForDrop(0),
  levelDesignMaxFlatGapM: levelDesignMaxGapM(0),
  levelDesignMaxGapAt1mDropM: levelDesignMaxGapM(1),
  levelDesignMaxGapAt2mDropM: levelDesignMaxGapM(2),
  levelDesignMaxGapAt4mDropM: levelDesignMaxGapM(4),

  /** Verticals. */
  maxStepUpM: PARKOUR_TUNING.stepUpMaxHeightM,
  maxVaultHeightM: PARKOUR_TUNING.vaultMaxHeightM,
  maxVaultDepthM: PARKOUR_TUNING.vaultMaxDepthM,
  maxMantleHeightM: PARKOUR_TUNING.mantleMaxHeightM,
  maxClimbHeightM: PARKOUR_TUNING.climbMaxHeightM,
  /** Absorbed silently by grounded motion, no verb required. */
  freeStepDownM: STEP_DOWN,
  freeStepUpM: STEP_UP,

  /** Drops. Nothing here is lethal; a fall costs noise and seconds. */
  maxRunOffDropM: PARKOUR_TUNING.runOffMaxDropM,
  maxRollDropM: PARKOUR_TUNING.rollMaxDropM,
  maxHangDropM: PARKOUR_TUNING.hangDropMaxDropM,
  /** At or above this drop the reader brakes instead of running off. */
  edgeBrakeDropM: PARKOUR_TUNING.edgeBrakeMinDropM,

  /** Slide. */
  slideMinHeadroomM: PARKOUR_TUNING.slideMinHeadroomM,
  slideMaxDepthM: PARKOUR_TUNING.slideMaxDepthM,

  /** Leap of faith. */
  leapMinDropM: PARKOUR_TUNING.leapMinDropM,
  leapTargetRadiusM: PARKOUR_TUNING.leapTargetRadiusM,

  /** Minimum standable top area for a mantle: narrower tops become CLIMB_OVER. */
  minStandableTopDepthM: CAPSULE_RADIUS * 2 + 0.05,

  /** Simulation. */
  tickHz: FIELD_TICK_HZ,
} as const;

// ---- the burst, published but deliberately NOT in the envelope --------------
//
// A dash is a player capability and it is not an authoring allowance, so it is
// exported beside `MOVEMENT_CAPABILITIES` rather than inside it. The distinction
// is load-bearing. That object is the contract level design does its arithmetic
// against — a gap authored to `levelDesignMaxFlatGapM` must clear for a player
// who never presses anything but forward — and folding a burst into it would
// quietly license geometry that only a player who dashes can cross.
//
// The numbers are read off playerMotion rather than restated. The burst is opened
// with `dashSpeed(RUN_SPEED)` over `DASH_DURATION_MS`, which is the same call the
// duel's dodge makes with the same arguments, so this is a measurement of the
// shared burst and not a second tuning of it.

/** Fixed steps a burst actually runs for. The window closes on a tick boundary. */
const DASH_TICKS = Math.ceil((DASH_DURATION_MS / 1000) * FIELD_TICK_HZ);

export const DASH_ENVELOPE = {
  speedMps: dashSpeed(RUN_SPEED),
  durationMs: DASH_DURATION_MS,
  durationTicks: DASH_TICKS,
  /** Ground covered by a burst from a standing start. */
  reachM: (dashSpeed(RUN_SPEED) * DASH_TICKS) / FIELD_TICK_HZ,
  /** Ground a burst adds over simply sprinting for the same window. */
  gainOverSprintM:
    ((dashSpeed(RUN_SPEED) - RUN_SPEED) * DASH_TICKS) / FIELD_TICK_HZ,
  /**
   * Flat gap a player clears by jumping out of a burst.
   *
   * Larger than `levelDesignMaxFlatGapM`, and that is the intended shape of it: a
   * dash-jump is a shortcut a confident player finds, never a link the level is
   * allowed to require. Published so level design can see the ceiling it is NOT
   * authoring against.
   */
  jumpGapM: maxGapMetersForDrop(0, dashSpeed(RUN_SPEED)),
} as const;

/**
 * TraversalClassifierConfig built from the same tuning, so anything still using
 * the standalone classifier agrees with the flow reader instead of carrying a
 * second copy of the thresholds.
 */
export function parkourClassifierConfig(): TraversalClassifierConfig {
  return {
    sprintSpeed: RUN_SPEED,
    jumpVY: RUNNING_JUMP_VY,
    gravity: GRAVITY,
    capsuleRadius: CAPSULE_RADIUS,
    capsuleHeight: STAND_HEIGHT,
    takeoffMargin: 1.25,
    landingMargin: PARKOUR_TUNING.landingMarginM,
    clearanceMargin: 0.12,
    vaultMaxHeight: PARKOUR_TUNING.vaultMaxHeightM,
    vaultMaxDepth: PARKOUR_TUNING.vaultMaxDepthM,
    vaultMaxDistance: 2.5,
    climbMaxHeight: PARKOUR_TUNING.climbMaxHeightM,
  };
}
