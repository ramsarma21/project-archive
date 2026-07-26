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
  STAND_HEIGHT,
  type CollisionWorld,
  type Vec3,
  landingValid,
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
  /** Sprint is held. Speed-gated verbs require it. */
  sprintHeld: boolean;
  /** Jump is buffered this tick. Overrides the edge brake. */
  jumpBuffered: boolean;
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

  // The safety brake is exempt from the flow speed floor. Braking removes the
  // speed that would otherwise satisfy the floor, so a speed-gated brake latches
  // for one tick, unlatches because the player is now slow, and lets held input
  // re-accelerate — the player creeps off a fatal ledge at walking pace.
  const brakeable =
    !ctx.jumpBuffered &&
    probe.obstacle === null &&
    probe.edge !== null &&
    probe.edge.contactDistanceM <= tuning.edgeBrakeDistanceM &&
    (!Number.isFinite(probe.edge.dropM) ||
      probe.edge.dropM > tuning.edgeBrakeMinDropM) &&
    probe.edge.gapM === null;

  // Below the flow floor there is no geometry read worth acting on, but a player
  // standing still who presses jump must still jump. The brake outranks it: a
  // buffered jump at an unsurvivable lip is handled by `brakeable` already
  // refusing to latch, so reaching here with a brake means the player did not
  // ask to leave the roof.
  if (probe.speedMps < tuning.flowMinSpeedMps) {
    if (brakeable) return ["EDGE_BRAKE"];
    return ctx.jumpBuffered ? ["JUMP"] : [];
  }
  const sprinting =
    ctx.sprintHeld && probe.speedMps >= tuning.sprintThresholdMps;
  const ranked: TraversalVerb[] = [];
  const obstacle = probe.obstacle;
  const edge = probe.edge;

  // An obstacle inside the probe window and nearer than any ledge owns the tick.
  const obstacleFirst =
    obstacle !== null &&
    (edge === null || obstacle.faceDistanceM <= edge.contactDistanceM);

  if (obstacleFirst && obstacle) {
    const { heightM, depthM, lowSpan, topStandable, farSide } = obstacle;

    // Duck under before climbing over: a low span is never scaled.
    if (
      lowSpan &&
      lowSpan.headroomM >= tuning.slideMinHeadroomM &&
      lowSpan.headroomM <= tuning.slideMaxHeadroomM &&
      lowSpan.depthM <= tuning.slideMaxDepthM &&
      (sprinting || ctx.crouchHeld) &&
      probe.speedMps >= (ctx.crouchHeld ? tuning.flowMinSpeedMps : tuning.slideMinSpeedMps)
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
      farSide.standable
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

    // Geometry the reader understands always beats the button: the player does
    // not press jump to vault a crate, and being asked to would undo the whole
    // point of reading. A jump is only offered here when the obstacle has no
    // answer at all, so pressing it at a wall is a hop rather than nothing.
    if (ranked.length === 0 && ctx.jumpBuffered) ranked.push("JUMP");
    if (ranked.length === 0) ranked.push("BLOCKED");
    return ranked;
  }

  if (edge) {
    // A dive is offered before anything else, because the drop that makes it
    // possible would otherwise read as a wall the player must not walk off.
    if (!ctx.reducedMotion && ctx.receivingTargets.length > 0) {
      ranked.push("LEAP_OF_FAITH");
    }

    if (
      edge.gapM !== null &&
      edge.far !== null &&
      probe.speedMps >= tuning.jumpGapMinSpeedMps
    ) {
      ranked.push("JUMP_GAP");
    }

    // Above the auto-solved gap and below simply walking off: a player who
    // presses jump at a lip meant to leave the ground, and running off it
    // instead is the game overruling them at the one moment they were explicit.
    if (ctx.jumpBuffered) ranked.push("JUMP");

    if (Number.isFinite(edge.dropM)) {
      if (edge.dropM <= tuning.runOffMaxDropM) ranked.push("RUN_OFF");
      else if (edge.dropM <= tuning.hangDropMaxDropM) ranked.push("HANG_DROP");
      else if (edge.dropM <= tuning.rollMaxDropM) ranked.push("RUN_OFF");
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
          reason: `hang drop ${edge.dropM.toFixed(2)}m`,
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
