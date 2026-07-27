// The verb ladder: geometry in, verb out.
//
// This is the heart of the Assassin's Creed feel. The player holds sprint and
// steers; they never name a verb. Every tick the reader ranks what the geometry
// ahead is asking for and the chain controller commits the first candidate that
// the physics can actually execute.
//
// Two stages, deliberately separated so the interesting half is trivially
// testable:
//
//   rankVerbs()  — pure thresholds over the probe numbers. No world, no
//                  allocation of anchors, no validation. This is the ladder.
//   planVerb()   — turns one candidate into an anchor chain or a launch
//                  velocity and validates it against the collision world.
//
// selectVerb() walks the ranked list and returns the first plan that validates,
// so a mantle whose top turns out to be occupied degrades to a climb-over rather
// than stopping the player dead.
//
// Verb-to-motion mapping: playerMotion owns four authored kinds (VAULT,
// CLIMB_UP, CLIMB_DOWN, DUCK_UNDER) and one ballistic launch. The richer verb
// vocabulary lives here and maps onto those, so there is exactly one motion
// implementation and one physics core for the whole game. A mantle is a fast
// CLIMB_UP with a mantle clip; a slide is a DUCK_UNDER with a slide clip.

import {
  CAPSULE_RADIUS,
  CONTACT_EPS,
  STAND_HEIGHT,
  type CollisionWorld,
  type Vec3,
  landingValid,
  supportBelow,
} from "../collision.js";
import { FIELD_DT } from "../fieldSimulation.js";
import {
  RUNNING_JUMP_VY,
  simulateBallistic,
  type AuthoredAction,
  type AuthoredAnchor,
} from "../playerMotion.js";
import { VERB_CLIP } from "./clips.js";
import {
  solveLeapOfFaith,
  type LeapSolution,
  type ReceivingTarget,
} from "./leapOfFaith.js";
import type { ParkourProbe } from "./probe.js";
import { PARKOUR_TUNING, type ParkourTuning, type TraversalVerb } from "./tuning.js";

/** How a committed verb is handed to the motion layer. */
export type VerbMotion =
  | {
      kind: "AUTHORED";
      authored: AuthoredAction["kind"];
      anchors: AuthoredAnchor[];
      durationMs: number;
      arcHeight: number;
      ignore: string[];
    }
  | {
      kind: "LAUNCH";
      velX: number;
      velY: number;
      velZ: number;
      /**
       * Which of playerMotion's two launches opens the arc. RUN preserves the
       * horizontal velocity, STAND does not, and DIVE sets both outright and
       * faces the body along the throw. Naming it here rather than inferring it
       * from the speed keeps one decision in one place.
       */
      launch: "RUN" | "STAND" | "DIVE";
    }
  | { kind: "PASSIVE" };

export interface VerbChoice {
  verb: TraversalVerb;
  /** Clip the animation layer should play for this verb. */
  clip: string;
  motion: VerbMotion;
  /** Distance from the geometry at which this verb should fire. */
  commitDistanceM: number;
  /** Current distance from the geometry that triggered it. */
  contactDistanceM: number;
  /** Horizontal speed restored when the verb finishes. */
  exitSpeedMps: number;
  /** Noise this verb emits, fed to the stealth field. */
  noise: number;
  /** Why this verb, for tests and dev overlays. */
  reason: string;
  /** Present only for LEAP_OF_FAITH. */
  leap?: LeapSolution;
}

export interface SelectContext {
  grounded: boolean;
  /**
   * Sprint is held — which is also the parkour key, and that is one decision
   * rather than two.
   *
   * THE WORLD ONLY CATCHES YOU WHILE YOU ARE ASKING IT TO. Every verb the
   * geometry infers — the vault, the climb, the mantle, the slide, the dive —
   * requires this, and nothing else does. It is the Assassin's Creed contract
   * and it is here because the alternative was tried and does not work: read
   * off geometry alone, the ladder pulls a player up the first ledge they run
   * past, and "it automatically climbs and vaults you through everything" is
   * what that feels like from the outside. There is no geometric rule that
   * separates a staging you meant to climb from a clock ledge you meant to run
   * past, because the difference is not in the geometry. It is intent, and
   * intent has to be said out loud.
   *
   * Deliberately NOT gated on it: the edge brake, which is a safety and must
   * hold a walking player at a lethal lip; walking off a small ledge, which is
   * not a grab; and the named jump, which is the player being explicit by
   * another means.
   */
  sprintHeld: boolean;
  /** Jump is buffered this tick. Overrides the edge brake. */
  jumpBuffered: boolean;
  /**
   * The player is holding a direction into whatever is ahead of them.
   *
   * This is what makes the flow speed floor survivable. The floor exists so a
   * player loitering next to a crate is not yanked over it, and it was doing
   * that job by proxy: it asked whether the body was moving, on the assumption
   * that a body which wants to cross something is a body in motion. Walking into
   * a wall falsifies the assumption exactly when it matters — the contact takes
   * the speed away, the read stops, and a two-metre ledge with a landing on top
   * of it becomes permanently unclimbable to anyone who arrived at a walk.
   * Asking about the input instead keeps the intent test and drops the accident.
   *
   * Optional so an existing caller keeps its behaviour: absent reads as false,
   * which is the old rule.
   */
  pushing?: boolean;
  /** Crouch is held. Biases a low span toward a slide. */
  crouchHeld: boolean;
  /** Chaining, so exit speed is fully restored rather than bled. */
  chaining: boolean;
  /** Authored dive targets in the current arena. */
  receivingTargets: readonly ReceivingTarget[];
  /** OS reduced-motion: authored verbs resolve instantly, dives are not offered. */
  reducedMotion: boolean;
}

// ---- stage 1: the ladder ---------------------------------------------------

/**
 * The obstacle half of the ladder, best first.
 *
 * Factored out because it is wanted twice: once by a player running at
 * something, and once by a player standing against it. The thresholds are the
 * same in both cases and there must be exactly one copy of them, or the answer
 * to "can I get over this" depends on how fast I happened to arrive.
 */
function rankObstacle(
  obstacle: NonNullable<ParkourProbe["obstacle"]>,
  tuning: ParkourTuning,
  slideAllowed: boolean,
  ranked: TraversalVerb[],
): void {
  const { heightM, depthM, lowSpan, topStandable, farSide } = obstacle;

  // Duck under before climbing over: a low span is never scaled.
  if (
    slideAllowed &&
    lowSpan &&
    lowSpan.headroomM >= tuning.slideMinHeadroomM &&
    lowSpan.headroomM <= tuning.slideMaxHeadroomM &&
    lowSpan.depthM <= tuning.slideMaxDepthM
  ) {
    ranked.push("SLIDE");
  }

  if (heightM > 0 && heightM <= tuning.stepUpMaxHeightM && topStandable) {
    ranked.push("STEP_UP");
  }

  if (
    heightM > 0 &&
    heightM <= tuning.vaultMaxHeightM &&
    depthM <= tuning.vaultMaxDepthM &&
    farSide !== null &&
    farSide.standable &&
    farSide.dropM <= tuning.vaultMaxLandingDropM
  ) {
    ranked.push("VAULT");
  }

  if (
    heightM > tuning.stepUpMaxHeightM &&
    heightM <= tuning.mantleMaxHeightM &&
    topStandable
  ) {
    ranked.push("MANTLE");
  }

  if (
    heightM > tuning.vaultMaxHeightM &&
    heightM <= tuning.climbOverMaxHeightM &&
    !topStandable &&
    depthM <= tuning.climbOverMaxDepthM &&
    farSide !== null &&
    farSide.standable &&
    // A climb-over is a vault over a thin obstacle, and like a vault its far side
    // may not drop into a fall: crossing a partition to a standable surface a
    // body's height below is a climb-over; crossing it onto a five-metre drop is
    // the reader pitching the player off a roof. Capped at the vault's own
    // landing-drop ceiling so the two members of the family agree.
    farSide.dropM <= tuning.vaultMaxLandingDropM
  ) {
    ranked.push("CLIMB_OVER");
  }

  if (
    heightM > tuning.mantleMaxHeightM &&
    heightM <= tuning.climbMaxHeightM &&
    topStandable
  ) {
    ranked.push("CLIMB_UP");
  }
}

/**
 * Every verb the geometry could support, best first. Pure arithmetic over the
 * probe — no world access, no validation. Ordering encodes the feel priority:
 * keep momentum, stay low, only stop when nothing else is possible.
 */
export function rankVerbs(
  probe: ParkourProbe,
  ctx: SelectContext,
  tuning: ParkourTuning = PARKOUR_TUNING,
): TraversalVerb[] {
  if (!ctx.grounded) return [];

  // GROUND, NOT AN OBSTACLE.
  //
  // The mover walks up anything this low on its own, so the reader must not see
  // it at all — and discarding it here rather than declining to rank it is the
  // whole point. An unranked obstacle still owns the tick and falls through to
  // BLOCKED, which is worse than the scripted vault it replaced: a 10cm kerb
  // would read as a wall and brake the player at it. Gone entirely, the kerb
  // stops suppressing the edge read behind it, stops outranking the drop beyond
  // it, and the body simply steps over it without being told.
  //
  // A low span is exempt: its height is the top of a beam the player ducks
  // under, which has nothing to do with what the feet can climb.
  const obstacle =
    probe.obstacle !== null &&
    probe.obstacle.lowSpan === null &&
    probe.obstacle.heightM <= tuning.freeStepUpM
      ? null
      : probe.obstacle;

  const edge = probe.edge;

  // An obstacle inside the probe window and nearer than any ledge owns the tick.
  const obstacleFirst =
    obstacle !== null &&
    (edge === null || obstacle.faceDistanceM <= edge.contactDistanceM);

  // The safety brake is exempt from the flow speed floor. Braking removes the
  // speed that would otherwise satisfy the floor, so a speed-gated brake latches
  // for one tick, unlatches because the player is now slow, and lets held input
  // re-accelerate — the player creeps off a fatal ledge at walking pace.
  //
  // THE EXEMPTION HAS TO ASK THE SAME QUESTION THE MOVING PATH ASKS, and it was
  // asking two narrower ones. Both reopened the hole it exists to close, by the
  // same route: brake, speed falls under the floor, the standing branch declines
  // to brake, the latch is dropped, held input walks the body a centimetre and a
  // half, repeat ten times a second until the roof runs out.
  //
  //   * It required NO OBSTACLE AT ALL in the read, which is a much larger claim
  //     than "something else owns this tick" — on a rooftop the player's own
  //     building is usually somewhere in the read. Whether an obstacle beats a
  //     ledge is a question about which is nearer and it already has an answer.
  //     Measured on the Town House scaffold: braked twenty-two times over two
  //     seconds and still went over the east lip, 5.60m onto the cobbles.
  //
  //   * It required NO GAP within reach. A gap is a reason to prefer a jump over
  //     a brake, and the moving path expresses that by ranking JUMP_GAP above
  //     it — which is the right way round, because ranking is a preference and
  //     this was a veto. Below the flow floor there is no gap jump to prefer:
  //     JUMP_GAP wants 3 m/s and this branch is under 0.9. Measured on the sugar
  //     house: a far lip 3.84m away, unjumpable from a standstill, and a 12.40m
  //     drop the player walked into anyway. A player who genuinely means to
  //     cross from a standstill presses jump, and a buffered jump already turns
  //     the brake off on the line above.
  const brakeable =
    !ctx.jumpBuffered &&
    !obstacleFirst &&
    edge !== null &&
    edge.contactDistanceM <= tuning.edgeBrakeDistanceM &&
    (!Number.isFinite(edge.dropM) || edge.dropM > tuning.edgeBrakeMinDropM);

  // Below the flow floor there is no momentum read worth acting on, but two
  // things still are. A player standing still who presses jump must still jump.
  // And a player LEANING ON SOMETHING must still be able to get over it.
  //
  // That second case is the one the floor got wrong, and it got it wrong in the
  // worst possible direction: pushing into a wall is what removes the speed the
  // floor is testing for, so the read switched off at the exact moment the
  // player was asking for it, and stayed off for as long as they kept asking.
  // The way out was to reverse and run at it again, which nothing on screen says
  // and no player infers. Only the verbs that need no run-up are offered here —
  // a slide and a gap jump are momentum, and standing still is not a way to have
  // any.
  //
  // The brake outranks all of it: a buffered jump at an unsurvivable lip is
  // handled by `brakeable` already refusing to latch, so reaching here with a
  // brake means the player did not ask to leave the roof.
  if (probe.speedMps < tuning.flowMinSpeedMps) {
    // A SOLVABLE DIVE OUTRANKS THE BRAKE AT A LETHAL LIP, at any speed.
    //
    // The moving branch already ranks LEAP_OF_FAITH above EDGE_BRAKE so a body
    // sprinting off a killing lip toward a receiving target dives rather than
    // braking. This is the same rule for a body under the flow floor, and it has
    // to be, because the brake is what stops the body ever reaching the floor: at
    // a dive-only lip — the steeple gallery into the Liberty Elm, where the crown
    // target sits over a fatal street drop and the climb up the louvre tops the
    // body out a stride from the rim, already decelerating — the body drops under
    // the floor a stride short of the lip, this branch confirms EDGE_BRAKE, and
    // the persisted hazard then kills every scrap of the approach speed the moving
    // branch needs. A silent soft-lock at the objective's own doorstep. A dive's
    // launch is SOLVED, not carried, so it needs no run-up; offering it here (auto,
    // when the player is sprinting toward the target) above the brake means the
    // brake is never confirmed at a lip a dive answers, and the body dives the
    // moment it is within the leap's commit distance. planVerb's solveLeapOfFaith
    // still rejects a target out of the offer cone, too shallow to read as a dive,
    // or too far to reach — so a lethal lip with no dive answer still brakes exactly
    // as before. LEAP_OF_FAITH is cooldown-exempt in flow.ts for the same reason
    // the brake is, so the climb->dive chain survives the verb the climb just ran.
    const diveReady =
      ctx.sprintHeld &&
      ctx.pushing &&
      !ctx.reducedMotion &&
      edge !== null &&
      ctx.receivingTargets.length > 0;
    if (brakeable && !diveReady) return ["EDGE_BRAKE"];
    const standing: TraversalVerb[] = [];
    if (diveReady) standing.push("LEAP_OF_FAITH");
    if (brakeable) standing.push("EDGE_BRAKE");
    if (
      ctx.pushing &&
      ctx.sprintHeld &&
      obstacle !== null &&
      obstacle.contactDistanceM <= tuning.commitDistanceM
    ) {
      // The duck is allowed from a standstill for the same reason the climb is,
      // and it is the same street furniture: M1's hoist frame has 1.2m of
      // headroom, so a standing capsule is stopped dead by it and a crouched one
      // walks through. Requiring a sprint or a held crouch key to cross it means
      // a player who simply walked up to it is held against a beam with no
      // verb, no prompt and no reason to guess that a key they have never
      // needed is the answer. Measured: fifteen seconds of holding forward at
      // (24.0, 0, -0.4) with nothing happening at all.
      rankObstacle(obstacle, tuning, true, standing);
    }
    if (ctx.jumpBuffered) standing.push("JUMP");
    return standing;
  }
  const sprinting =
    ctx.sprintHeld && probe.speedMps >= tuning.sprintThresholdMps;
  const ranked: TraversalVerb[] = [];

  if (obstacleFirst && obstacle) {
    const slideAllowed =
      (sprinting || ctx.crouchHeld) &&
      probe.speedMps >=
        (ctx.crouchHeld ? tuning.flowMinSpeedMps : tuning.slideMinSpeedMps);
    // Held key or nothing. See `SelectContext.sprintHeld`: a verb read off the
    // geometry is the world reaching out and taking hold of the player, and it
    // may only do that while they are asking. A crouched player at a low span
    // is the one exception, because a duck is something you are already doing.
    if (ctx.sprintHeld || ctx.crouchHeld) {
      rankObstacle(obstacle, tuning, slideAllowed, ranked);
    }

    // Geometry the reader understands always beats the button: the player does
    // not press jump to vault a crate, and being asked to would undo the whole
    // point of reading. A jump is only offered here when the obstacle has no
    // answer at all, so pressing it at a wall is a hop rather than nothing.
    if (ranked.length > 0) return ranked;

    // NO VERB FOR THIS OBSTACLE IS NOT A REASON TO IGNORE A DROP. `BLOCKED` says
    // the geometry has no answer, and returning it here used to end the tick,
    // which quietly made "cannot climb that" outrank "there is a lethal lip in
    // front of you". Under the upper bough of the Liberty Elm the two are the
    // same tick: a player without the parkour key is offered nothing for the
    // bough overhead, and the crown they are standing on ends three strides
    // ahead, eight metres three above the street. So when the obstacle has
    // nothing, the ledge gets its say before the report does.
    if (edge === null) {
      if (ctx.jumpBuffered) ranked.push("JUMP");
      ranked.push("BLOCKED");
      return ranked;
    }
    // Otherwise fall through to the edge ladder below.
  }

  if (edge) {
    // A dive is offered before anything else, because the drop that makes it
    // possible would otherwise read as a wall the player must not walk off.
    // Held key, like every other inferred verb, and this is the one where it
    // matters most: an unasked-for swan dive off a steeple is the "it grabbed
    // me" complaint at its largest possible scale. A player who is not asking
    // gets the edge brake instead, which is the correct thing to give them.
    if (ctx.sprintHeld && !ctx.reducedMotion && ctx.receivingTargets.length > 0) {
      ranked.push("LEAP_OF_FAITH");
    }

    // A GAP JUMP CROSSES A VOID, NOT A SAFE DESCENT ONTO AN OBSTACLE BEYOND IT.
    //
    // `readEdge`'s gap finder walks PAST any surface below foot level to find the
    // next one back near foot height, so a lip with a gentle safe drop straight
    // down and a coplanar obstacle a stride beyond reads as "a gap to that
    // obstacle" — the floor between them is skipped as a void it is not. Ranked
    // above the run-off, the reader then launches the body up and over the
    // surface it should simply have dropped to, landing it on the obstacle.
    //
    // Measured at the ropewalk hemp: the low bale top is 1.1m over the floor
    // (a run-off) and the rope capstan a stride south stands at 1.05m, so a
    // directed CHAIN_DROP onto the floor was hijacked into a JUMP_GAP that flung
    // the body onto the capstan and oscillated there, never settling on the
    // authored floor receiver. When the lip affords a safe descent straight down
    // and the far target sits no lower than that descent, the target is an
    // obstacle to mount and not a gap to cross — so descend, do not launch. A
    // real gap (a canopy leap over the street, the published gap course) has a
    // drop below deeper than a run-off and is untouched; a buffered Space still
    // jumps outright on the rung below.
    const safeDescentBelow =
      edge.below !== null &&
      Number.isFinite(edge.verticalDropM) &&
      edge.verticalDropM <= tuning.runOffMaxDropM;
    const gapTargetNotBelowDescent =
      edge.far !== null && edge.far.dropM <= edge.verticalDropM;
    if (
      edge.gapM !== null &&
      edge.far !== null &&
      probe.speedMps >= tuning.jumpGapMinSpeedMps &&
      !(safeDescentBelow && gapTargetNotBelowDescent)
    ) {
      ranked.push("JUMP_GAP");
    }

    // Above the auto-solved gap and below simply walking off: a player who
    // presses jump at a lip meant to leave the ground, and running off it
    // instead is the game overruling them at the one moment they were explicit.
    if (ctx.jumpBuffered) ranked.push("JUMP");

    // WALKING OFF AND CLIMBING DOWN ARE DIFFERENT QUESTIONS ABOUT THE SAME LIP,
    // and they get different numbers because a body that lowers itself over an
    // edge does not travel and a body that strolls off it does. `dropM` is what
    // the stroll costs; `verticalDropM` is what is directly underneath.
    //
    // The order matters. A hang drop onto a narrow ledge is offered FIRST, so a
    // roofline the level descends by pentice and awning still descends that way
    // — the shed at the market is the case, 2.50m down onto the shambles pentice
    // and 5.60m to the cobbles if you simply keep walking. If the ledge turns
    // out to be too narrow for a standing body `beginAuthored` refuses and the
    // ladder falls through to the brake, which is the right order of preference:
    // climb down if you can, refuse to leave if you cannot.
    //
    // A hang drop is offered in two cases, and the second is the one the Liberty
    // Elm crown needs. The classic case is a straight-down ledge deeper than a
    // run-off but within reach (2.2–3.2m). The second is a straight-down ledge
    // that is SHALLOWER than a run-off yet whose run-off is unsafe: the crown
    // overhangs the low bough on every side, so a body that runs off its edge
    // sails past the metre of exposed bough beneath and falls to the street,
    // while a body that lowers itself straight down lands on the bough it can see
    // under its feet. When `dropM` (the stroll) is unsurvivable but
    // `verticalDropM` (the lower) is fine, lowering is the answer, not braking.
    const hangReachable =
      Number.isFinite(edge.verticalDropM) &&
      edge.verticalDropM <= tuning.hangDropMaxDropM;
    const runOffSafe =
      Number.isFinite(edge.dropM) && edge.dropM <= tuning.rollMaxDropM;
    if (hangReachable && (edge.verticalDropM > tuning.runOffMaxDropM || !runOffSafe)) {
      ranked.push("HANG_DROP");
    }

    if (Number.isFinite(edge.dropM) && edge.dropM <= tuning.rollMaxDropM) {
      ranked.push("RUN_OFF");
    }

    // Nothing safe ahead: brake rather than run off a killing drop. A buffered
    // jump is the player overriding this deliberately.
    if (
      !ctx.jumpBuffered &&
      (!Number.isFinite(edge.dropM) || edge.dropM > tuning.edgeBrakeMinDropM)
    ) {
      ranked.push("EDGE_BRAKE");
    }
    return ranked;
  }

  // Open ground with nothing to read. This is where most of a three-minute run
  // is spent, and it is where a jump button has to work or the game feels dead.
  if (ctx.jumpBuffered) ranked.push("JUMP");
  return ranked;
}

/** The single best verb the geometry is asking for, or NONE. */
export function classifyVerb(
  probe: ParkourProbe,
  ctx: SelectContext,
  tuning: ParkourTuning = PARKOUR_TUNING,
): TraversalVerb {
  return rankVerbs(probe, ctx, tuning)[0] ?? "NONE";
}

// ---- stage 2: planning -----------------------------------------------------

/**
 * Commit distance for a verb taken at a lip. An edge verb fires on the last
 * grounded tick before the lip so the takeoff point is as close to the lip as the
 * fixed step allows, which is what makes the published gap budget achievable.
 */
export function edgeCommitDistanceM(
  probe: ParkourProbe,
  tuning: ParkourTuning = PARKOUR_TUNING,
): number {
  return Math.max(tuning.edgeCommitMinM, probe.speedMps * FIELD_DT);
}

function durationFor(
  verb: TraversalVerb,
  probe: ParkourProbe,
  tuning: ParkourTuning,
): number {
  const base = tuning.durationsMs[verb];
  return probe.speedMps < tuning.sprintThresholdMps
    ? Math.round(base * tuning.slowEntryDurationMultiplier)
    : base;
}

function exitSpeedFor(
  probe: ParkourProbe,
  ctx: SelectContext,
  tuning: ParkourTuning,
): number {
  const fraction = ctx.chaining
    ? tuning.chainExitSpeedFraction
    : tuning.coldExitSpeedFraction;
  return probe.speedMps * fraction;
}

function anchor(point: Vec3, yaw?: number): AuthoredAnchor {
  return yaw === undefined
    ? { x: point.x, y: point.y, z: point.z }
    : { x: point.x, y: point.y, z: point.z, yaw };
}

function ahead(
  origin: Vec3,
  probe: ParkourProbe,
  distance: number,
  y: number,
): Vec3 {
  return {
    x: origin.x + probe.dirX * distance,
    y,
    z: origin.z + probe.dirZ * distance,
  };
}

/**
 * Build and validate one candidate. Returns null when the geometry cannot
 * actually support it, which is how the ladder degrades instead of failing.
 *
 * Every authored chain sets an explicit yaw on its final anchor. Without it,
 * playerMotion derives the exit facing from the anchor chain, and for a CLIMB_UP
 * that derivation points back the way the player came — correct for a deliberate
 * climb, wrong for a mantle the player is meant to run out of.
 */
export function planVerb(
  world: CollisionWorld,
  probe: ParkourProbe,
  ctx: SelectContext,
  verb: TraversalVerb,
  start: Vec3,
  tuning: ParkourTuning = PARKOUR_TUNING,
): VerbChoice | null {
  const travelYaw = Math.atan2(probe.dirX, probe.dirZ);
  const clip = VERB_CLIP[verb];
  const noise = tuning.verbNoise[verb];
  const exitSpeedMps = exitSpeedFor(probe, ctx, tuning);
  const obstacle = probe.obstacle;
  const edge = probe.edge;

  const authored = (
    authoredKind: AuthoredAction["kind"],
    anchors: AuthoredAnchor[],
    options: {
      ignore: string[];
      arcHeight?: number;
      contactDistanceM: number;
      commitDistanceM: number;
      reason: string;
    },
  ): VerbChoice => ({
    verb,
    clip,
    motion: {
      kind: "AUTHORED",
      authored: authoredKind,
      anchors,
      durationMs: durationFor(verb, probe, tuning),
      arcHeight: options.arcHeight ?? 0,
      ignore: options.ignore,
    },
    commitDistanceM: options.commitDistanceM,
    contactDistanceM: options.contactDistanceM,
    exitSpeedMps,
    noise,
    reason: options.reason,
  });

  switch (verb) {
    case "STEP_UP":
    case "MANTLE":
    case "CLIMB_UP": {
      if (!obstacle?.topLanding) return null;
      const lip = ahead(start, probe, obstacle.faceDistanceM, obstacle.topY);
      return authored(
        "CLIMB_UP",
        [
          anchor(start),
          anchor(lip),
          anchor(obstacle.topLanding, travelYaw),
        ],
        {
          ignore: [obstacle.id],
          arcHeight: verb === "MANTLE" ? tuning.mantleArcHeightM : 0,
          contactDistanceM: obstacle.contactDistanceM,
          commitDistanceM: tuning.commitDistanceM,
          reason: `${verb.toLowerCase()} onto ${obstacle.heightM.toFixed(2)}m top`,
        },
      );
    }

    case "VAULT":
    case "CLIMB_OVER": {
      if (!obstacle?.farSide) return null;
      const top = Number.isFinite(obstacle.topY)
        ? obstacle.topY
        : start.y + tuning.vaultMaxHeightM;
      const nearTop = ahead(start, probe, obstacle.faceDistanceM, top);
      const farTop = ahead(
        start,
        probe,
        obstacle.faceDistanceM + obstacle.depthM,
        top,
      );
      return authored(
        "VAULT",
        [
          anchor(start),
          anchor(nearTop),
          anchor(farTop),
          anchor(obstacle.farSide.point, travelYaw),
        ],
        {
          ignore: [obstacle.id],
          arcHeight: tuning.vaultArcHeightM,
          contactDistanceM: obstacle.contactDistanceM,
          commitDistanceM: tuning.commitDistanceM,
          reason: `${verb.toLowerCase()} ${obstacle.heightM.toFixed(2)}m/${obstacle.depthM.toFixed(2)}m`,
        },
      );
    }

    case "SLIDE": {
      if (!obstacle?.lowSpan || !obstacle.farSide) return null;
      // The slide is NOT given the low span in its ignore set: letting
      // playerMotion validate the crouched capsule against the real underside is
      // the check that stops a slide into a span that is genuinely too low.
      return authored(
        "DUCK_UNDER",
        [anchor(start), anchor(obstacle.farSide.point, travelYaw)],
        {
          ignore: [],
          contactDistanceM: obstacle.contactDistanceM,
          commitDistanceM: tuning.commitDistanceM,
          reason: `slide under ${obstacle.lowSpan.headroomM.toFixed(2)}m headroom`,
        },
      );
    }

    case "HANG_DROP": {
      if (!edge?.below) return null;
      const hang = ahead(
        start,
        probe,
        edge.contactDistanceM + CAPSULE_RADIUS,
        Math.max(edge.below.y, start.y - 1),
      );
      return authored(
        "CLIMB_DOWN",
        [anchor(start), anchor(hang), anchor(edge.below, travelYaw)],
        {
          ignore: [],
          contactDistanceM: edge.contactDistanceM,
          commitDistanceM: edgeCommitDistanceM(probe, tuning),
          reason: `hang drop ${edge.verticalDropM.toFixed(2)}m`,
        },
      );
    }

    case "JUMP_GAP": {
      if (!edge?.far || edge.gapM === null) return null;
      const velX = probe.dirX * probe.speedMps;
      const velZ = probe.dirZ * probe.speedMps;
      const prediction = simulateBallistic(
        world,
        start,
        { x: velX, y: RUNNING_JUMP_VY, z: velZ },
        undefined,
      );
      if (!prediction.landed || !prediction.valid) return null;
      const along = (point: Vec3) =>
        (point.x - start.x) * probe.dirX + (point.z - start.z) * probe.dirZ;
      const farLipAlong = along(edge.far.point) - CAPSULE_RADIUS;
      if (along(prediction.pos) < farLipAlong + tuning.jumpGapSafetyM) {
        return null;
      }
      // THE FIRST LANDING MUST BE THE SURFACE THE GAP JUMP WAS FOR, AND SURVIVABLE.
      // A ballistic solve that "lands" is not enough: an arc can clear the far lip
      // and come down on something lower and further than the surface the reader
      // selected, which is a fall the player never chose. So the predicted first
      // landing has to be the intended far surface at its height, and the drop to
      // it inside the run-off/roll envelope.
      const farSurface = supportBelow(
        world,
        edge.far.point.x,
        edge.far.point.z,
        edge.far.point.y + CONTACT_EPS,
      );
      if (!farSurface || prediction.landingId !== farSurface.id) return null;
      if (Math.abs(prediction.pos.y - edge.far.point.y) > 0.12) return null;
      if (start.y - prediction.pos.y > tuning.rollMaxDropM) return null;
      return {
        verb,
        clip,
        motion: { kind: "LAUNCH", velX, velY: RUNNING_JUMP_VY, velZ, launch: "RUN" },
        commitDistanceM: edgeCommitDistanceM(probe, tuning),
        contactDistanceM: edge.contactDistanceM,
        exitSpeedMps,
        noise,
        reason: `jump ${edge.gapM.toFixed(2)}m gap`,
      };
    }

    case "JUMP": {
      // The named jump. It solves nothing and validates nothing, because the
      // player already decided: the arc is swept against the world by the same
      // ballistic integrator every other launch uses, and where it lands is
      // where it lands. Refusing it because the landing looks bad would be the
      // edge brake wearing a different hat, and the brake has already stood
      // aside for exactly this input.
      const running = probe.speedMps >= tuning.jumpRunThresholdMps;
      return {
        verb,
        clip: running ? VERB_CLIP.JUMP_GAP : clip,
        motion: {
          kind: "LAUNCH",
          velX: running ? probe.dirX * probe.speedMps : 0,
          velY: RUNNING_JUMP_VY,
          velZ: running ? probe.dirZ * probe.speedMps : 0,
          launch: running ? "RUN" : "STAND",
        },
        commitDistanceM: tuning.commitDistanceM,
        contactDistanceM: 0,
        exitSpeedMps: running ? probe.speedMps : 0,
        noise,
        reason: running
          ? `running jump at ${probe.speedMps.toFixed(2)}m/s`
          : "standing jump",
      };
    }

    case "LEAP_OF_FAITH": {
      if (!edge) return null;
      const solution = solveLeapOfFaith(
        edge.lip,
        probe.dirX,
        probe.dirZ,
        ctx.receivingTargets,
        tuning,
      );
      if (!solution) return null;
      return {
        verb,
        clip,
        motion: {
          kind: "LAUNCH",
          velX: solution.velX,
          velY: solution.velY,
          velZ: solution.velZ,
          launch: "DIVE",
        },
        commitDistanceM: edgeCommitDistanceM(probe, tuning),
        contactDistanceM: edge.contactDistanceM,
        exitSpeedMps: 0,
        noise,
        reason: `dive ${solution.dropM.toFixed(1)}m into ${solution.target.id}`,
        leap: solution,
      };
    }

    case "RUN_OFF": {
      if (!edge) return null;
      return {
        verb,
        clip,
        motion: { kind: "PASSIVE" },
        commitDistanceM: edgeCommitDistanceM(probe, tuning),
        contactDistanceM: edge.contactDistanceM,
        exitSpeedMps: probe.speedMps,
        noise,
        reason: `run off ${edge.dropM.toFixed(2)}m`,
      };
    }

    case "EDGE_BRAKE": {
      if (!edge) return null;
      if (edge.contactDistanceM > tuning.edgeBrakeDistanceM) return null;
      return {
        verb,
        clip,
        motion: { kind: "PASSIVE" },
        commitDistanceM: tuning.edgeBrakeDistanceM,
        contactDistanceM: edge.contactDistanceM,
        exitSpeedMps: 0,
        noise,
        reason: "unsurvivable drop ahead",
      };
    }

    case "BLOCKED":
      return {
        verb,
        clip,
        motion: { kind: "PASSIVE" },
        commitDistanceM: tuning.commitDistanceM,
        contactDistanceM: obstacle?.contactDistanceM ?? 0,
        exitSpeedMps: 0,
        noise,
        reason: obstacle
          ? `no verb for ${Number.isFinite(obstacle.heightM) ? `${obstacle.heightM.toFixed(2)}m` : "full-height"} obstacle`
          : "blocked",
      };

    default:
      return null;
  }
}

/**
 * The verb to run, with its plan. Walks the ranked ladder and returns the first
 * candidate whose plan validates against the world.
 */
export function selectVerb(
  world: CollisionWorld,
  probe: ParkourProbe,
  ctx: SelectContext,
  start: Vec3,
  tuning: ParkourTuning = PARKOUR_TUNING,
): VerbChoice | null {
  for (const verb of rankVerbs(probe, ctx, tuning)) {
    const plan = planVerb(world, probe, ctx, verb, start, tuning);
    if (plan) return plan;
  }
  return null;
}

/**
 * Would an authored plan's destination actually accept the body? planVerb builds
 * the chain; playerMotion.beginAuthored re-validates it before committing. This
 * is exposed so tests can assert a plan's endpoint independently of the motion
 * step.
 */
export function planEndpointValid(
  world: CollisionWorld,
  choice: VerbChoice,
): boolean {
  if (choice.motion.kind !== "AUTHORED") return true;
  const anchors = choice.motion.anchors;
  const end = anchors[anchors.length - 1]!;
  return landingValid(
    world,
    end.x,
    end.z,
    CAPSULE_RADIUS,
    end.y,
    STAND_HEIGHT,
    new Set(choice.motion.ignore),
  );
}
