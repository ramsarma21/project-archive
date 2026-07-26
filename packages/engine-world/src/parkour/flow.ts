// The chain controller: one fixed step of flow traversal.
//
// This is the only thing that turns a verb ladder into a *feel*. Three jobs:
//
//   1. Read, choose, commit. Every tick it probes ahead, ranks verbs, and fires
//      the best one when the player reaches its commit distance. There is no
//      traversal button and no prompt — sprint into geometry and the geometry
//      answers. The old contextual-F resolver stays available for object-bound
//      interactions; it is no longer how you cross a crate.
//
//   2. Preserve momentum across the seam. playerMotion's authored actions end
//      with zero velocity, which is correct for a deliberate one-off climb and
//      fatal for a chain: every verb would dump the player to a standstill and
//      three minutes of traversal would feel like three minutes of obstacles.
//      On completion this controller restores the exit speed along the exit
//      facing, so a vault-mantle-slide reads as one continuous move.
//
//      Flow does NOT raise the speed cap. The reward for chaining is not losing
//      speed, not gaining superhuman speed — which also keeps a single honest
//      number for level design's jump arithmetic.
//
//   3. Report. Everything a renderer, an animation layer or the stealth field
//      needs comes out as state and events: current clip, chain length, landing
//      flavor, and the noise each verb and landing made.
//
// It runs on the shared fixed clock. One call per tick emitted by
// advanceFieldClock, dt always FIELD_DT. No wall-clock reads, no second loop,
// no randomness.

import {
  CAPSULE_RADIUS,
  STAND_HEIGHT,
  type CollisionWorld,
  type Vec3,
  canStand,
  isCrouched,
  supportBelow,
} from "../collision.js";
import {
  AIRBORNE_PHASES,
  AUTHORED_PHASES,
  DASH_DURATION_MS,
  RUN_SPEED,
  beginAuthored,
  beginDash,
  beginRunningJump,
  beginStandingJump,
  canDash,
  cancelDash,
  dashSpeed,
  isDashing,
  type MotionState,
  stepMotion,
} from "../playerMotion.js";
import type { NoiseEvent } from "../stealth/noise.js";
import { LANDING_CLIP, VERB_CLIP } from "./clips.js";
import {
  leapCaptured,
  leapRestPosition,
  type ReceivingTarget,
} from "./leapOfFaith.js";
import { probeAhead, type ParkourProbe } from "./probe.js";
import {
  selectVerb,
  type SelectContext,
  type VerbChoice,
} from "./select.js";
import {
  PARKOUR_TUNING,
  type LandingKind,
  type ParkourTuning,
  type TraversalVerb,
} from "./tuning.js";

/** Everything downstream layers read. Purely derived; never authoritative. */
export interface FlowState {
  /** Verb currently executing, or NONE. */
  verb: TraversalVerb;
  /** Consecutive verbs completed inside the chain window. */
  chain: number;
  /** Ticks of chain window remaining. Zero means the chain is cold. */
  chainWindowTicks: number;
  /** True once `chain` reaches the tuning's flow length. */
  inFlow: boolean;
  /** Ticks until another verb may commit. */
  cooldownTicks: number;
  /** Ticks until another burst may open. Zero means dash is ready. */
  dashCooldownTicks: number;
  /** Speed restored when the running verb completes. */
  exitSpeedMps: number;
  /** Highest foot height reached since leaving the ground, for drop accounting. */
  fallFromY: number;
  /** Landing resolved on the most recent touchdown. */
  landing: LandingKind;
  /** Drop height of that landing. */
  landingDropM: number;
  /** Ticks left of the landing recovery, during which the landing clip plays. */
  landingTicks: number;
  /** Dive in progress, if any. */
  leapTargetId: string | null;
  /**
   * Direction over an unsurvivable lip, latched by the edge brake. While set,
   * input and momentum heading that way are suppressed before motion steps.
   * Damping alone cannot hold a lip: grounded motion re-accelerates toward held
   * input every tick, so the player creeps off at a walking pace.
   */
  brakeDirX: number | null;
  brakeDirZ: number;
  /** Clip the animation layer should be playing this tick. */
  clip: string;
  /** True when `clip` should play once and clamp. */
  clipOnce: boolean;
  /** Last verb the reader offered but did not commit. Dev overlay only. */
  previewVerb: TraversalVerb;
  /** Why that preview was chosen. Dev overlay only. */
  previewReason: string;
}

export type FlowEventType =
  | "verbCommitted"
  | "verbCompleted"
  | "verbCancelled"
  | "landed"
  | "leapCommitted"
  | "leapReceived"
  | "edgeBraked"
  | "blocked"
  | "dashStarted"
  | "dashEnded"
  /** A dash was asked for and refused. Carries the reason, so a HUD can say why. */
  | "dashRefused";

export interface FlowEvent {
  type: FlowEventType;
  verb: TraversalVerb;
  /** Chain length after this event. */
  chain: number;
  /** Drop height, for landing events. */
  dropM?: number;
  landing?: LandingKind;
  reason?: string;
}

export interface FlowInput {
  /** Fixed step. Always FIELD_DT; accepted explicitly so tests can be honest. */
  dt: number;
  /** World-space desired horizontal velocity, already scaled to target speed. */
  targetVelX: number;
  targetVelZ: number;
  sprintHeld: boolean;
  crouchHeld: boolean;
  /** A jump press is buffered this tick. */
  jumpBuffered: boolean;
  /**
   * A dash press is buffered this tick.
   *
   * Optional so a caller that has not bound the key yet keeps compiling and
   * keeps behaving exactly as it did. It is not optional to the player: see
   * TRAVERSAL_BINDINGS in playerInput.ts for the key this is supposed to be on.
   */
  dashBuffered?: boolean;
  /** Flow reading is off (cutscene, duel, UI focus). Motion still steps. */
  flowEnabled: boolean;
  reducedMotion: boolean;
  receivingTargets: readonly ReceivingTarget[];
}

export interface FlowResult {
  motion: MotionState;
  flow: FlowState;
  events: FlowEvent[];
  noise: NoiseEvent[];
  /** The read taken this tick. Exposed for dev overlays and tests. */
  probe: ParkourProbe | null;
}

export function createFlowState(): FlowState {
  return {
    verb: "NONE",
    chain: 0,
    chainWindowTicks: 0,
    inFlow: false,
    cooldownTicks: 0,
    dashCooldownTicks: 0,
    exitSpeedMps: 0,
    fallFromY: 0,
    landing: "NONE",
    landingDropM: 0,
    landingTicks: 0,
    leapTargetId: null,
    brakeDirX: null,
    brakeDirZ: 0,
    clip: "idle",
    clipOnce: false,
    previewVerb: "NONE",
    previewReason: "",
  };
}

function landingFor(dropM: number, tuning: ParkourTuning): LandingKind {
  if (dropM <= tuning.runOffMaxDropM) return "RUN";
  if (dropM <= tuning.rollMaxDropM) return "ROLL";
  return "HARD";
}

const LANDING_RECOVERY_TICKS: Readonly<Record<LandingKind, number>> = {
  NONE: 0,
  RUN: 9,
  ROLL: 24,
  HARD: 48,
  RECEIVED: 30,
};

function noiseAt(
  pos: Vec3,
  intensity: number,
  kind: NoiseEvent["kind"],
  tuning: ParkourTuning,
): NoiseEvent {
  return {
    kind,
    x: pos.x,
    y: pos.y,
    z: pos.z,
    intensity,
    radiusM: intensity * tuning.noiseRadiusPerIntensityM,
  };
}

function locomotionClip(
  motion: MotionState,
  input: FlowInput,
  tuning: ParkourTuning,
): string {
  const speed = Math.hypot(motion.vel.x, motion.vel.z);
  if (AIRBORNE_PHASES.has(motion.phase)) {
    return motion.phase === "STANDING_JUMP" ? "jump" : "runJump";
  }
  if (motion.phase === "DASH") return VERB_CLIP.DASH;
  if (motion.phase === "CROUCH") {
    return speed < 0.16 ? "crouchIdle" : "crouchWalk";
  }
  if (speed < 0.16) return "idle";
  return input.sprintHeld && speed >= tuning.sprintThresholdMps ? "run" : "walk";
}

/**
 * Clip for the verb currently running. Only the named jump needs deriving: it is
 * one verb with two silhouettes, and which one is playing is a fact about the
 * motion phase rather than a second entry in the verb table.
 */
function verbClip(motion: MotionState, verb: TraversalVerb): string {
  if (verb === "JUMP" && motion.phase === "RUNNING_JUMP") {
    return VERB_CLIP.JUMP_GAP;
  }
  return VERB_CLIP[verb];
}

/**
 * Lateral steering while airborne.
 *
 * The nudge is applied to the velocity and then the horizontal SPEED IS PUT BACK
 * exactly as it was, so this rotates the arc and cannot lengthen it. That
 * property is the reason this is safe to add at all: `maxFlatGapM` and every
 * budget derived from it stay true for a player holding a direction in mid-air,
 * and a gap authored to the published limit is neither easier nor harder to
 * clear because somebody leaned on the stick.
 *
 * A launch with no horizontal speed has no direction to turn and is left alone,
 * which also stops a standing jump from being steered into a running one.
 */
function steerAirborne(
  motion: MotionState,
  targetVelX: number,
  targetVelZ: number,
  dt: number,
  tuning: ParkourTuning,
): MotionState {
  const speed = Math.hypot(motion.vel.x, motion.vel.z);
  if (speed < 1e-4) return motion;
  const targetLength = Math.hypot(targetVelX, targetVelZ);
  if (targetLength < 1e-6) return motion;
  const steer = tuning.airControlMps2 * dt;
  const nudgedX = motion.vel.x + (targetVelX / targetLength) * steer;
  const nudgedZ = motion.vel.z + (targetVelZ / targetLength) * steer;
  const nudgedLength = Math.hypot(nudgedX, nudgedZ);
  if (nudgedLength < 1e-6) return motion;
  return {
    ...motion,
    vel: {
      x: (nudgedX / nudgedLength) * speed,
      y: motion.vel.y,
      z: (nudgedZ / nudgedLength) * speed,
    },
  };
}

/**
 * Restore horizontal speed along the exit facing after an authored verb. This is
 * the momentum seam: without it every verb is a full stop.
 */
function restoreExitSpeed(motion: MotionState, speed: number): MotionState {
  if (speed <= 0) return motion;
  return {
    ...motion,
    vel: {
      x: Math.sin(motion.yaw) * speed,
      y: 0,
      z: Math.cos(motion.yaw) * speed,
    },
  };
}

/** One fixed step of flow traversal. */
export function stepFlow(
  world: CollisionWorld,
  motionIn: MotionState,
  flowIn: FlowState,
  input: FlowInput,
  tuning: ParkourTuning = PARKOUR_TUNING,
): FlowResult {
  const events: FlowEvent[] = [];
  const noise: NoiseEvent[] = [];
  let motion = motionIn;
  let flow: FlowState = { ...flowIn };
  let probe: ParkourProbe | null = null;

  // Timers first, so a verb that completes this tick starts its chain window at
  // its full length rather than one tick short.
  if (flow.chainWindowTicks > 0) flow.chainWindowTicks -= 1;
  if (flow.cooldownTicks > 0) flow.cooldownTicks -= 1;
  if (flow.dashCooldownTicks > 0) flow.dashCooldownTicks -= 1;
  if (flow.landingTicks > 0) flow.landingTicks -= 1;
  if (flow.chainWindowTicks === 0 && flow.chain > 0) {
    flow.chain = 0;
    flow.inFlow = false;
  }

  const wasAuthored = motion.action !== null && AUTHORED_PHASES.has(motion.phase);
  const wasAirborne = AIRBORNE_PHASES.has(motion.phase);
  const previousY = motion.pos.y;

  // ---- dive capture ------------------------------------------------------
  // Checked before motion so a fast descent cannot pass through the accepting
  // surface between two fixed steps.
  if (flow.verb === "LEAP_OF_FAITH" && flow.leapTargetId) {
    const target = input.receivingTargets.find(
      (candidate) => candidate.id === flow.leapTargetId,
    );
    if (target) {
      const stepped = stepMotion(world, motion, {
        dt: input.dt,
        targetVelX: 0,
        targetVelZ: 0,
        reducedMotion: input.reducedMotion,
      });
      if (leapCaptured(stepped.state.pos, previousY, target, tuning)) {
        const rest = leapRestPosition(target);
        motion = {
          ...stepped.state,
          phase: "GROUNDED",
          pos: rest,
          vel: { x: 0, y: 0, z: 0 },
          grounded: true,
          airtimeMs: 0,
          capsuleHeight: STAND_HEIGHT,
          action: null,
        };
        flow.verb = "NONE";
        flow.leapTargetId = null;
        flow.landing = "RECEIVED";
        flow.landingDropM = flow.fallFromY - rest.y;
        flow.landingTicks = LANDING_RECOVERY_TICKS.RECEIVED;
        flow.chain += 1;
        flow.chainWindowTicks = tuning.chainWindowTicks;
        flow.inFlow = flow.chain >= tuning.chainFlowLength;
        flow.clip = LANDING_CLIP.RECEIVED;
        flow.clipOnce = true;
        events.push({
          type: "leapReceived",
          verb: "LEAP_OF_FAITH",
          chain: flow.chain,
          dropM: flow.landingDropM,
          landing: "RECEIVED",
        });
        noise.push(
          noiseAt(rest, tuning.landingNoise.RECEIVED, "PLAYER_LANDING", tuning),
        );
        return { motion, flow, events, noise, probe };
      }
      motion = stepped.state;
      if (stepped.events.includes("landed")) {
        // Missed the target. A missed dive is loud and slow, never fatal.
        const dropM = Math.max(0, flow.fallFromY - motion.pos.y);
        const landing = landingFor(dropM, tuning);
        flow.verb = "NONE";
        flow.leapTargetId = null;
        flow.landing = landing;
        flow.landingDropM = dropM;
        flow.landingTicks = LANDING_RECOVERY_TICKS[landing];
        flow.chain = 0;
        flow.chainWindowTicks = 0;
        flow.inFlow = false;
        flow.clip = LANDING_CLIP[landing];
        flow.clipOnce = true;
        events.push({
          type: "landed",
          verb: "LEAP_OF_FAITH",
          chain: 0,
          dropM,
          landing,
          reason: "dive missed the receiving target",
        });
        noise.push(
          noiseAt(
            motion.pos,
            tuning.landingNoise[landing],
            "PLAYER_LANDING",
            tuning,
          ),
        );
        return { motion, flow, events, noise, probe };
      }
      flow.clip = VERB_CLIP.LEAP_OF_FAITH;
      flow.clipOnce = false;
      return { motion, flow, events, noise, probe };
    }
    flow.leapTargetId = null;
    flow.verb = "NONE";
  }

  // ---- the burst ---------------------------------------------------------
  //
  // Opened here rather than through the verb ladder, because a dash is not a
  // reading of the geometry: it is available on any grounded tick, including
  // in the middle of open ground where the ladder has nothing to say. It also
  // has to be openable while a verb is NOT running, which is exactly the state
  // the ladder does not describe.
  //
  // The burst itself is playerMotion's, opened with the same `dashSpeed(RUN_SPEED)`
  // over the same `DASH_DURATION_MS` that the duel's dodge uses. Nothing about
  // the shared constant is touched or re-tuned here — a rooftop dash and a duel
  // dodge are one move, which is the property the engine already promises and
  // this is the first caller on the traversal side to actually take it up.
  if (input.dashBuffered && input.flowEnabled) {
    const dashed = openDash(motion, flow, input, tuning);
    motion = dashed.motion;
    flow = dashed.flow;
    events.push(...dashed.events);
    noise.push(...dashed.noise);
  }

  // ---- advance motion ----------------------------------------------------
  // A latched edge brake suppresses input and momentum heading over the lip
  // BEFORE motion integrates, which is the only ordering that actually holds a
  // ledge. Turning away and running along the edge stays untouched.
  let targetVelX = input.targetVelX;
  let targetVelZ = input.targetVelZ;
  if (
    flow.brakeDirX !== null &&
    motion.grounded &&
    !AUTHORED_PHASES.has(motion.phase) &&
    !AIRBORNE_PHASES.has(motion.phase) &&
    !input.jumpBuffered
  ) {
    const dirX = flow.brakeDirX;
    const dirZ = flow.brakeDirZ;
    const alongTarget = targetVelX * dirX + targetVelZ * dirZ;
    if (alongTarget > 0) {
      targetVelX -= dirX * alongTarget;
      targetVelZ -= dirZ * alongTarget;
    }
    const alongVel = motion.vel.x * dirX + motion.vel.z * dirZ;
    if (alongVel > 0) {
      motion = {
        ...motion,
        vel: {
          x: motion.vel.x - dirX * alongVel,
          y: motion.vel.y,
          z: motion.vel.z - dirZ * alongVel,
        },
      };
    }
  }

  if (input.flowEnabled && wasAirborne) {
    motion = steerAirborne(motion, targetVelX, targetVelZ, input.dt, tuning);
  }

  // The horizontal velocity carried INTO this step. When the step ends in a
  // touchdown this is what the landing gets to keep a fraction of, and it has to
  // be read before `stepBallistic` zeroes it.
  const entrySpeedMps = Math.hypot(motion.vel.x, motion.vel.z);
  const entryDirX =
    entrySpeedMps > 1e-6 ? motion.vel.x / entrySpeedMps : Math.sin(motion.yaw);
  const entryDirZ =
    entrySpeedMps > 1e-6 ? motion.vel.z / entrySpeedMps : Math.cos(motion.yaw);

  const stepped = stepMotion(world, motion, {
    dt: input.dt,
    targetVelX,
    targetVelZ,
    reducedMotion: input.reducedMotion,
  });
  motion = stepped.state;

  // A burst that ended — spent, or interrupted by a ledge — hands the tick back
  // to ordinary locomotion and starts its cooldown. It keeps a chain warm
  // without lengthening it: a dash is how you reach the next obstacle in time,
  // not an obstacle of its own.
  if (stepped.events.includes("dashEnded")) {
    flow.dashCooldownTicks = tuning.dashCooldownTicks;
    if (flow.verb === "DASH") {
      flow.verb = "NONE";
      if (flow.chain > 0) flow.chainWindowTicks = tuning.chainWindowTicks;
    }
    events.push({ type: "dashEnded", verb: "DASH", chain: flow.chain });
  }

  if (!motion.grounded && motion.pos.y > flow.fallFromY) {
    flow.fallFromY = motion.pos.y;
  }
  if (motion.grounded && !wasAirborne && !wasAuthored) {
    flow.fallFromY = motion.pos.y;
  }

  if (wasAuthored && stepped.events.includes("actionComplete")) {
    const completed = flow.verb;
    motion = restoreExitSpeed(motion, flow.exitSpeedMps);
    flow.chain += 1;
    flow.chainWindowTicks = tuning.chainWindowTicks;
    flow.inFlow = flow.chain >= tuning.chainFlowLength;
    flow.cooldownTicks = tuning.verbCooldownTicks;
    flow.verb = "NONE";
    flow.fallFromY = motion.pos.y;
    events.push({ type: "verbCompleted", verb: completed, chain: flow.chain });
  } else if (wasAuthored && stepped.events.includes("actionCancelled")) {
    const cancelled = flow.verb;
    flow.verb = "NONE";
    flow.chain = 0;
    flow.chainWindowTicks = 0;
    flow.inFlow = false;
    flow.cooldownTicks = tuning.verbCooldownTicks;
    events.push({ type: "verbCancelled", verb: cancelled, chain: 0 });
  }

  if (stepped.events.includes("landed")) {
    const dropM = Math.max(0, flow.fallFromY - motion.pos.y);
    const landing = landingFor(dropM, tuning);
    flow.landing = landing;
    flow.landingDropM = dropM;
    flow.landingTicks = LANDING_RECOVERY_TICKS[landing];
    flow.fallFromY = motion.pos.y;
    const airVerb = flow.verb;

    // Momentum through the touchdown, for EVERY landing rather than only the
    // two the reader had named. `stepBallistic` arrives at zero velocity, so
    // without this a fall nobody chose — knocked off a ledge, a mistimed
    // takeoff, a drop the reader never labelled — reads as the game confiscating
    // the run. The retention ladder is where the cost of a bad landing lives.
    const carried = entrySpeedMps * tuning.landingSpeedRetention[landing];
    if (carried > 0) {
      motion = {
        ...motion,
        vel: { x: entryDirX * carried, y: 0, z: entryDirZ * carried },
      };
    }

    if (airVerb === "JUMP" || airVerb === "JUMP_GAP" || airVerb === "RUN_OFF") {
      flow.chain += 1;
      flow.chainWindowTicks = tuning.chainWindowTicks;
      flow.inFlow = flow.chain >= tuning.chainFlowLength;
    }
    if (landing === "HARD") {
      flow.chain = 0;
      flow.chainWindowTicks = 0;
      flow.inFlow = false;
    }
    flow.verb = "NONE";
    events.push({
      type: "landed",
      verb: airVerb,
      chain: flow.chain,
      dropM,
      landing,
    });
    if (tuning.landingNoise[landing] > 0) {
      noise.push(
        noiseAt(
          motion.pos,
          tuning.landingNoise[landing],
          "PLAYER_LANDING",
          tuning,
        ),
      );
    }
  }

  // ---- read and commit ---------------------------------------------------
  const busy =
    motion.action !== null ||
    AUTHORED_PHASES.has(motion.phase) ||
    AIRBORNE_PHASES.has(motion.phase);

  if (!input.flowEnabled || busy || !motion.grounded) {
    flow.previewVerb = "NONE";
    flow.previewReason = busy ? "busy" : "flow disabled";
    flow.clip = flow.landingTicks > 0
      ? LANDING_CLIP[flow.landing]
      : flow.verb !== "NONE"
        ? verbClip(motion, flow.verb)
        : locomotionClip(motion, input, tuning);
    flow.clipOnce = flow.landingTicks > 0 || flow.verb !== "NONE";
    return { motion, flow, events, noise, probe };
  }

  // The brake is re-latched from this tick's read, never held over stale geometry.
  flow.brakeDirX = null;
  flow.brakeDirZ = 0;

  const ctx: SelectContext = {
    grounded: motion.grounded,
    sprintHeld: input.sprintHeld,
    jumpBuffered: input.jumpBuffered,
    crouchHeld: input.crouchHeld,
    chaining: flow.chainWindowTicks > 0,
    receivingTargets: input.receivingTargets,
    reducedMotion: input.reducedMotion,
  };

  probe = probeAhead(
    world,
    {
      pos: motion.pos,
      velX: motion.vel.x,
      velZ: motion.vel.z,
      yaw: motion.yaw,
    },
    tuning,
  );
  const choice = selectVerb(world, probe, ctx, motion.pos, tuning);
  flow.previewVerb = choice?.verb ?? "NONE";
  flow.previewReason = choice?.reason ?? "";

  if (choice && flow.cooldownTicks === 0) {
    const committed = commitVerb(world, motion, flow, choice, probe, tuning);
    if (committed) {
      motion = committed.motion;
      flow = committed.flow;
      events.push(...committed.events);
      noise.push(...committed.noise);
    }
  }

  flow.clip =
    flow.verb !== "NONE"
      ? verbClip(motion, flow.verb)
      : flow.landingTicks > 0
        ? LANDING_CLIP[flow.landing]
        : locomotionClip(motion, input, tuning);
  flow.clipOnce = flow.verb !== "NONE" || flow.landingTicks > 0;

  return { motion, flow, events, noise, probe };
}

/**
 * Open a directed burst, or say why not.
 *
 * A refusal is reported rather than swallowed. A movement verb that silently
 * does nothing is indistinguishable from a dropped key press, and a player who
 * cannot tell those apart stops trusting the input — which is the same failure
 * as not having the verb at all, arrived at more slowly.
 */
function openDash(
  motionIn: MotionState,
  flowIn: FlowState,
  input: FlowInput,
  tuning: ParkourTuning,
): {
  motion: MotionState;
  flow: FlowState;
  events: FlowEvent[];
  noise: NoiseEvent[];
} {
  const flow: FlowState = { ...flowIn };
  const refuse = (reason: string) => ({
    motion: motionIn,
    flow: flowIn,
    events: [{ type: "dashRefused" as const, verb: "DASH" as const, chain: flowIn.chain, reason }],
    noise: [],
  });

  if (flow.dashCooldownTicks > 0) return refuse("cooling down");
  if (!canDash(motionIn)) {
    return refuse(
      AIRBORNE_PHASES.has(motionIn.phase)
        ? "airborne"
        : motionIn.action !== null
          ? "mid-verb"
          : "already bursting",
    );
  }

  // Steering wins over facing: the burst goes where the player is pushing, and
  // only falls back to the body's heading when they are pushing nowhere.
  const inputLength = Math.hypot(input.targetVelX, input.targetVelZ);
  const dirX =
    inputLength > 1e-6 ? input.targetVelX / inputLength : Math.sin(motionIn.yaw);
  const dirZ =
    inputLength > 1e-6 ? input.targetVelZ / inputLength : Math.cos(motionIn.yaw);

  // A latched brake means the reader has already decided this direction ends in
  // a drop nobody survives well. A burst would beat the brake outright —
  // `stepDash` substitutes its own target velocity, so the damping that holds a
  // walking player never gets to run — and "dash off the roof by accident" is
  // not a skill expression.
  if (flow.brakeDirX !== null && dirX * flow.brakeDirX + dirZ * flow.brakeDirZ > 0) {
    return refuse("nothing to land on that way");
  }

  const motion = beginDash(
    motionIn,
    dirX,
    dirZ,
    dashSpeed(RUN_SPEED),
    DASH_DURATION_MS,
  );
  if (motion === motionIn) return refuse("refused by motion");

  flow.verb = "DASH";
  if (flow.chain > 0) flow.chainWindowTicks = tuning.chainWindowTicks;
  return {
    motion,
    flow,
    events: [{ type: "dashStarted", verb: "DASH", chain: flow.chain }],
    noise:
      tuning.verbNoise.DASH > 0
        ? [noiseAt(motion.pos, tuning.verbNoise.DASH, "PLAYER_MOVE", tuning)]
        : [],
  };
}

function commitVerb(
  world: CollisionWorld,
  motionIn: MotionState,
  flowIn: FlowState,
  choice: VerbChoice,
  probe: ParkourProbe,
  tuning: ParkourTuning,
): {
  motion: MotionState;
  flow: FlowState;
  events: FlowEvent[];
  noise: NoiseEvent[];
} | null {
  if (choice.contactDistanceM > choice.commitDistanceM) return null;
  const events: FlowEvent[] = [];
  const noise: NoiseEvent[] = [];
  let motion = motionIn;
  const flow: FlowState = { ...flowIn };
  if (choice.verb !== "EDGE_BRAKE") {
    flow.brakeDirX = null;
    flow.brakeDirZ = 0;
  }

  if (choice.verb === "BLOCKED") {
    events.push({
      type: "blocked",
      verb: "BLOCKED",
      chain: flow.chain,
      reason: choice.reason,
    });
    flow.chain = 0;
    flow.chainWindowTicks = 0;
    flow.inFlow = false;
    return { motion, flow, events, noise };
  }

  if (choice.verb === "EDGE_BRAKE") {
    // A burst outranks damping — `stepDash` hands the integrator its own target
    // velocity every tick — so the brake has to close the window rather than
    // fight it. Closing it here also means the player keeps whatever speed the
    // burst had produced, and is then braked on that speed like anyone else.
    if (isDashing(motion)) {
      motion = cancelDash(motion);
      flow.dashCooldownTicks = tuning.dashCooldownTicks;
      if (flow.verb === "DASH") flow.verb = "NONE";
      events.push({ type: "dashEnded", verb: "DASH", chain: flow.chain });
    }
    let velX = motion.vel.x * tuning.edgeBrakeRetainPerTick;
    let velZ = motion.vel.z * tuning.edgeBrakeRetainPerTick;
    if (choice.contactDistanceM <= tuning.edgeBrakeHoldM) {
      // Remove only the component heading over the lip, and latch the direction so
      // next tick's input cannot re-accelerate into it.
      const along = velX * probe.dirX + velZ * probe.dirZ;
      if (along > 0) {
        velX -= probe.dirX * along;
        velZ -= probe.dirZ * along;
      }
      flow.brakeDirX = probe.dirX;
      flow.brakeDirZ = probe.dirZ;
    }
    motion = { ...motion, vel: { x: velX, y: motion.vel.y, z: velZ } };
    events.push({
      type: "edgeBraked",
      verb: "EDGE_BRAKE",
      chain: flow.chain,
      reason: choice.reason,
    });
    return { motion, flow, events, noise };
  }

  if (choice.verb === "RUN_OFF") {
    // Nothing to commit: grounded motion already walks off the lip into
    // FALLING. Recording the verb is what lets the landing keep the chain.
    flow.verb = "RUN_OFF";
    flow.exitSpeedMps = choice.exitSpeedMps;
    flow.fallFromY = motion.pos.y;
    return { motion, flow, events, noise };
  }

  if (choice.motion.kind === "LAUNCH") {
    const launch = choice.motion;
    motion =
      launch.launch === "DIVE"
        ? {
            ...beginStandingJump(motion),
            vel: { x: launch.velX, y: launch.velY, z: launch.velZ },
            yaw: Math.atan2(launch.velX, launch.velZ),
          }
        : launch.launch === "STAND"
          ? beginStandingJump(motion)
          : beginRunningJump({
              ...motion,
              vel: { x: launch.velX, y: 0, z: launch.velZ },
            });
    flow.verb = choice.verb;
    flow.exitSpeedMps = choice.exitSpeedMps;
    flow.fallFromY = motion.pos.y;
    flow.leapTargetId =
      choice.verb === "LEAP_OF_FAITH" ? choice.leap?.target.id ?? null : null;
    events.push({
      type: choice.verb === "LEAP_OF_FAITH" ? "leapCommitted" : "verbCommitted",
      verb: choice.verb,
      chain: flow.chain,
      reason: choice.reason,
    });
    if (choice.noise > 0) {
      noise.push(noiseAt(motion.pos, choice.noise, "PLAYER_MOVE", tuning));
    }
    return { motion, flow, events, noise };
  }

  if (choice.motion.kind !== "AUTHORED") return null;

  const begun = beginAuthored(world, motion, {
    kind: choice.motion.authored,
    anchors: choice.motion.anchors,
    durationMs: choice.motion.durationMs,
    ignore: choice.motion.ignore,
    arcHeight: choice.motion.arcHeight,
  });
  if (!begun) return null;

  motion = begun;
  flow.verb = choice.verb;
  flow.exitSpeedMps = choice.exitSpeedMps;
  events.push({
    type: "verbCommitted",
    verb: choice.verb,
    chain: flow.chain,
    reason: choice.reason,
  });
  if (choice.noise > 0) {
    noise.push(noiseAt(motion.pos, choice.noise, "PLAYER_MOVE", tuning));
  }
  return { motion, flow, events, noise };
}

/**
 * Presentation projection: exactly what the render and animation layers need,
 * and nothing that would let them drive simulation.
 */
export interface FlowPresentation {
  clip: string;
  clipOnce: boolean;
  /** Chain length, for a flow meter or a camera FOV nudge. */
  chain: number;
  inFlow: boolean;
  /**
   * How much of the chain window is left, [0,1].
   *
   * The chain reward is "you did not lose speed", which is a reward the player
   * cannot see happening. This is the number a meter drains, so the thing the
   * controller is quietly doing for them becomes a thing they are watching.
   */
  chainWindow01: number;
  /** Current verb, for camera behaviour (a dive wants a different camera). */
  verb: TraversalVerb;
  landing: LandingKind;
  /** Foot position and facing. Motion remains the sole owner of the transform. */
  pos: Vec3;
  yaw: number;
  speedMps: number;
  /** Live capsule height. Feed this straight to the stealth field and to aiming. */
  capsuleHeight: number;
  crouched: boolean;
  airborne: boolean;
  /** A burst is open this tick. */
  dashing: boolean;
  /** The burst is off cooldown and the body could take one. */
  dashReady: boolean;
  /** Cooldown recharge, [0,1]. 1 is ready. For a pip that fills. */
  dashCharge01: number;
}

export function flowPresentation(
  motion: MotionState,
  flow: FlowState,
  tuning: ParkourTuning = PARKOUR_TUNING,
): FlowPresentation {
  return {
    clip: flow.clip,
    clipOnce: flow.clipOnce,
    chain: flow.chain,
    inFlow: flow.inFlow,
    chainWindow01:
      tuning.chainWindowTicks <= 0
        ? 0
        : flow.chainWindowTicks / tuning.chainWindowTicks,
    verb: flow.verb,
    landing: flow.landingTicks > 0 ? flow.landing : "NONE",
    pos: motion.pos,
    yaw: motion.yaw,
    speedMps: Math.hypot(motion.vel.x, motion.vel.z),
    capsuleHeight: motion.capsuleHeight,
    crouched: isCrouched(motion.capsuleHeight),
    airborne: AIRBORNE_PHASES.has(motion.phase),
    dashing: isDashing(motion),
    dashReady: flow.dashCooldownTicks === 0 && canDash(motion),
    dashCharge01:
      tuning.dashCooldownTicks <= 0
        ? 1
        : 1 - flow.dashCooldownTicks / tuning.dashCooldownTicks,
  };
}

/**
 * Is the player standing on something that can hold them? Exposed for the
 * mission layer's respawn/recovery logic, which must never need to reimplement a
 * support query.
 */
export function groundedSupport(
  world: CollisionWorld,
  pos: Vec3,
): { y: number; id: string } | null {
  const support = supportBelow(world, pos.x, pos.z, pos.y);
  if (!support) return null;
  if (!canStand(world, pos.x, pos.z, CAPSULE_RADIUS, support.y)) return null;
  return support;
}
