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
  CONTACT_EPS,
  STAND_HEIGHT,
  type CollisionWorld,
  type Platform,
  type Vec3,
  canStand,
  isCrouched,
  supportBelow,
} from "../collision.js";
import {
  AIRBORNE_PHASES,
  AUTHORED_PHASES,
  DASH_DURATION_MS,
  DECEL,
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
  simulateWalkOff,
  stepMotion,
} from "../playerMotion.js";
import type { NoiseEvent } from "../stealth/noise.js";
import { LANDING_CLIP, VERB_CLIP } from "./clips.js";
import {
  leapCaptured,
  leapRestPosition,
  type ReceivingTarget,
} from "./leapOfFaith.js";
import { predictCommittedWalkOff, probeAhead, type ParkourProbe } from "./probe.js";
import {
  gapLeapReachable,
  planVerb,
  rankVerbs,
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
  /**
   * Ticks a jump press is still live for. See `PARKOUR_TUNING.jumpBufferTicks`.
   *
   * The press arrives on whichever tick the frame happens to deliver it to, and
   * that tick is very often one the jump cannot be taken on. Holding it for a
   * few steps is the difference between a jump that fires late and a jump that
   * never fires at all, and only one of those is a thing a player can learn.
   */
  jumpBufferTicks: number;
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
   * Direction over a CONFIRMED unsurvivable lip. Set when the exact walk-off
   * prediction resolved to a fatal drop with no safe verb, and PERSISTED across
   * ticks: braking removes the very velocity the prediction read, so a read taken
   * after the brake fires would honestly report a survivable creep and, trusted
   * alone, would erase the hazard it just confirmed. So the hazard is held until
   * the player steers off it or the lip is genuinely gone — not until the brake
   * has hidden its own evidence. While set, the pre-motion brake refuses to
   * accelerate over the lip and removes the over-lip velocity when the body could
   * not otherwise stop in time.
   */
  brakeDirX: number | null;
  brakeDirZ: number;
  /**
   * Distance from the body to the confirmed lip, refreshed each tick the hazard
   * holds. The pre-motion brake sizes its stopping distance against this.
   */
  brakeLipDistM: number;
  /**
   * The IDENTITY of the confirmed hazard: what the fatal fall lands on (a surface
   * id, or null for the void) and how far it drops. This is what lets the hazard
   * tell braking apart from geometry change. Braking makes the LIVE read look
   * survivable, but the same lip still leads to the same landing, so the hazard —
   * recomputed each tick at the committed speed against the CURRENT world — is
   * held. When the world changes so that the committed mover no longer falls
   * fatally (a deck fills the gap, the lip is gone, the drop shrinks), the
   * recompute comes back safe and the brake releases at once. Identity is also
   * why turning to a different lip does not silently inherit the old one's hold.
   */
  brakeLandingId: string | null;
  brakeDropM: number;
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

/**
 * How closely the player's intent must point along a directed gateway's axis for
 * the guided read/commit to engage — the cosine of the angle between them. 0.5 is
 * a 60° cone: wide enough that a normal approach at the vault counts, tight enough
 * that a body turning away (pushing back off the axis) is left to the honest read.
 */
const GUIDED_INTENT_DOT = 0.5;

// ---- directed drop onto a narrow authored receiver -------------------------
//
// A directed descent gateway (the ropewalk tie beam) authorises a RUN_OFF or a
// HANG_DROP onto a board only a little wider than the body. The authored pace
// caps the approach, but a walk-off is ballistic: the takeoff SPEED decides
// where the capsule comes down, and a body that reaches the lip a touch fast —
// because an encounter restarted it from rest a few metres back, or any other
// legitimate approach-state variation — clips the board's far lip and slides off
// as the drop-in momentum carries its centre across the narrow axis.
//
// These constants tie a TRAJECTORY-AWARE takeoff cap and a landing settle to
// narrow directed receivers only. Neither widens collision, teleports, freezes,
// nor names a node: the receiver is found by simulating the walk-off, and the
// safe target is the board's own capsule-radius inset.

/** A reference walk-off speed slow enough to land on the near half of any board the descent reaches, used to identify the receiver deck. */
const DIRECTED_DROP_REF_SPEED_MPS = 1.4;
/** Along-approach-axis board extent at or below which the inset is load-bearing (a board a sprint overshoots), so the cap engages. Wider receivers need no aim. */
const NARROW_RECEIVER_SPAN_M = 2.2;
/** Bisection steps resolving the centre-landing speed. 6 => ~0.015 m/s. */
const DIRECTED_DROP_SOLVE_STEPS = 6;
/** Sim horizon for the aim: the deepest directed drop the roll ceiling allows is ~1.1s of fall. */
const DIRECTED_DROP_SIM_MS = 1400;

/**
 * Is a lip actually within reach ahead along the axis? A cheap support probe so
 * the expensive walk-off aim runs only in the last strides into a drop, not on
 * every flat grounded tick a directed-descent gateway happens to be held.
 */
function lipAhead(
  world: CollisionWorld,
  motion: MotionState,
  axisX: number,
  axisZ: number,
  alongSpeed: number,
): boolean {
  const lookM = 0.5 + Math.max(0, alongSpeed) * 0.2;
  const px = motion.pos.x + axisX * lookM;
  const pz = motion.pos.z + axisZ * lookM;
  const ahead = supportBelow(world, px, pz, motion.pos.y + 0.05, 0.05);
  return !ahead || ahead.y < motion.pos.y - 0.35;
}

/** The narrow rectangular board a directed drop lands on, if the descent along the axis comes down on one. */
function directedReceiverBoard(
  world: CollisionWorld,
  motion: MotionState,
  axisX: number,
  axisZ: number,
  dt: number,
  tuning: ParkourTuning,
): Platform | null {
  const ref = simulateWalkOff(
    world,
    motion,
    axisX * DIRECTED_DROP_REF_SPEED_MPS,
    axisZ * DIRECTED_DROP_REF_SPEED_MPS,
    { dt, maxMs: DIRECTED_DROP_SIM_MS, maxFallM: tuning.rollMaxDropM + 0.5 },
  );
  if (!ref.landed || !ref.landingId) return null;
  const board = world.platforms.find((p) => p.id === ref.landingId);
  if (!board || board.polygon) return null;
  const spanAlong =
    Math.abs(axisX) * (board.maxX - board.minX) +
    Math.abs(axisZ) * (board.maxZ - board.minZ);
  return spanAlong <= NARROW_RECEIVER_SPAN_M ? board : null;
}

/**
 * The largest along-axis takeoff speed whose predicted capsule landing sits at
 * (or just north of) the receiver board's cross-axis CENTRE — the most robust
 * single aim, leaving the whole capsule inside the board's safe support inset.
 * Returns null when the current cap already lands centre-or-nearer (no brake
 * wanted) or when there is no narrow receiver ahead.
 *
 * Landing projection is monotone in takeoff speed, so a bisection between the
 * slow reference speed and the current cap converges. `simulateWalkOff` IS the
 * production integrator, so the predicted landing is the one the body will take.
 */
function directedDropTakeoffCap(
  world: CollisionWorld,
  motion: MotionState,
  axisX: number,
  axisZ: number,
  alongCap: number,
  dt: number,
  tuning: ParkourTuning,
): number | null {
  if (alongCap <= DIRECTED_DROP_REF_SPEED_MPS) return null;
  if (!lipAhead(world, motion, axisX, axisZ, alongCap)) return null;
  const board = directedReceiverBoard(world, motion, axisX, axisZ, dt, tuning);
  if (!board) return null;

  const centreProj =
    ((board.minX + board.maxX) / 2) * axisX +
    ((board.minZ + board.maxZ) / 2) * axisZ;

  // Predicted landing projection along the axis for a candidate speed, or null
  // when the body overshoots off the board entirely at that speed.
  const landingProjAt = (v: number): number | null => {
    const w = simulateWalkOff(world, motion, axisX * v, axisZ * v, {
      dt,
      maxMs: DIRECTED_DROP_SIM_MS,
      maxFallM: tuning.rollMaxDropM + 0.5,
    });
    if (!w.landed || w.landingId !== board.id) return null;
    return w.landingPos.x * axisX + w.landingPos.z * axisZ;
  };

  // At the current cap the landing is at or north of centre already: the body is
  // slow enough, aim nothing (a slow entry lands on the near half, still safe).
  const projAtCap = landingProjAt(alongCap);
  if (projAtCap !== null && projAtCap <= centreProj) return null;

  // Bisect for the speed that lands at the board centre. `lo` always lands on the
  // board north of centre; `hi` lands south of centre or off the board (too fast).
  let lo = DIRECTED_DROP_REF_SPEED_MPS;
  let hi = alongCap;
  for (let i = 0; i < DIRECTED_DROP_SOLVE_STEPS; i += 1) {
    const mid = (lo + hi) * 0.5;
    const proj = landingProjAt(mid);
    if (proj === null || proj > centreProj) hi = mid;
    else lo = mid;
  }
  return Math.min(alongCap, lo);
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
  /**
   * Whether an INFERRED upward ascent — a MANTLE or CLIMB_UP the reader commits
   * off geometry alone, without a buffered jump — may fire.
   *
   * Optional and TRUE by default, so a caller that has not wired it keeps the
   * behaviour it had: Shift alone climbs whatever standable face is in front of
   * the body. A caller that knows the player's committed route can set it false
   * when the guidance is a same-height or lower run past an incidental climb
   * face, so a held sprint is not read as parkour consent up a wrong-axis roof.
   * It gates ONLY those two upward commits — the affordance still previews, a
   * buffered Space still commits, and VAULT, CLIMB_OVER, STEP_UP, the edge brake,
   * every downward verb and any climb the guidance actually asks for (an upward
   * waypoint) are untouched. See traversal.ts for the derivation.
   */
  inferredAscentAllowed?: boolean;
  /**
   * A DIRECTED ACTION GATEWAY the committed route has selected: the authored axis
   * (unit XZ, take-off -> receiver) and the verb family that gateway allows. When
   * set AND the player's intent agrees with the axis, the reader probes ALONG the
   * axis (so a vault reads its authored IN->OUT obstacle, not a live slide a few
   * degrees off it) and only the allowed verb family may COMMIT — the body cannot
   * be hijacked onto a different traversal at the gateway.
   *
   * This never forces anything: intent must point at the axis, the verb still
   * runs the full planVerb/commitVerb/preflight, jump and speed consent and the
   * high-ascent gate all still apply, and the preview stays the honest best read.
   * Optional; an unwired caller behaves exactly as before. See wayfind.ts.
   */
  guidedAxisX?: number;
  guidedAxisZ?: number;
  guidedVerbs?: readonly TraversalVerb[];
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
    jumpBufferTicks: 0,
    exitSpeedMps: 0,
    fallFromY: 0,
    landing: "NONE",
    landingDropM: 0,
    landingTicks: 0,
    leapTargetId: null,
    brakeDirX: null,
    brakeDirZ: 0,
    brakeLipDistM: 0,
    brakeLandingId: null,
    brakeDropM: 0,
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

/**
 * How long each landing occupies the body, in fixed steps.
 *
 * Exported because it is also the length of the LANDING CLIP'S WINDOW, and the
 * animation layer has to scale the clip to it. Mixamo's landing performances
 * run 1.4-2.0 seconds; the recovery they are covering is 150-800ms. Played
 * unscaled, only the first tenth to quarter of the clip is ever seen — and the
 * opening of a landing performance is the arms coming out to catch balance, so
 * what the player actually sees is a hand flail that is then cut off mid-gesture
 * and blended back to a run. See `LANDING_CLIP` and the timeScale that reads
 * this, which together make "the clip lasts exactly as long as the landing" a
 * property of the numbers rather than something two files have to agree on.
 */
export const LANDING_RECOVERY_TICKS: Readonly<Record<LandingKind, number>> = {
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
  if (flow.jumpBufferTicks > 0) flow.jumpBufferTicks -= 1;
  // A press arriving this tick re-arms the window. It is latched into flow state
  // rather than consumed here because the tick that receives a press is usually
  // not a tick that can act on it: the body is still a frame off the ground, or
  // mid-vault, or inside the verb cooldown. See `jumpBufferTicks`.
  if (input.jumpBuffered) flow.jumpBufferTicks = tuning.jumpBufferTicks;
  const jumpWanted = flow.jumpBufferTicks > 0;
  if (flow.chainWindowTicks === 0 && flow.chain > 0) {
    flow.chain = 0;
    flow.inFlow = false;
  }

  const wasAuthored = motion.action !== null && AUTHORED_PHASES.has(motion.phase);
  const wasAirborne = AIRBORNE_PHASES.has(motion.phase);
  const previousY = motion.pos.y;

  // A DIRECTED DESCENT the route holds until the body performs it: a RUN_OFF (or
  // HANG_DROP) onto a narrow authored receiver. Only the ropewalk tie-beam
  // gateway authorises this family, so this signal is exactly "a controlled drop
  // onto a board a sprint overshoots" — the case the takeoff aim and landing
  // settle below are tied to, and nothing else. Requires the player to actually
  // be pushing along the authored axis, like every other guided read.
  const guidedAxisX = input.guidedAxisX;
  const guidedAxisZ = input.guidedAxisZ;
  const directedDescent =
    input.flowEnabled &&
    guidedAxisX !== undefined &&
    guidedAxisZ !== undefined &&
    (input.guidedVerbs?.includes("RUN_OFF") ?? false);
  const intentMagRaw = Math.hypot(input.targetVelX, input.targetVelZ);
  const descentIntentAgrees =
    directedDescent &&
    intentMagRaw > 1e-3 &&
    (input.targetVelX * guidedAxisX! + input.targetVelZ * guidedAxisZ!) /
        intentMagRaw >=
      GUIDED_INTENT_DOT;

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

  // ---- revalidate the persisted hazard before anything consults it -------
  //
  // A hazard is a fact about the geometry, and the geometry it was confirmed
  // against may be gone: a deck can fill the drop in, a route swap can move the
  // lip, the player can turn away. Nothing this tick — not the burst about to
  // open, not the brake, not the verb ladder — may be refused or held by a
  // hazard that is no longer real, so the hazard is recomputed HERE, before any
  // of them read it, from a committed mover against the current world. It
  // survives only if that committed mover still falls fatally the way it is
  // pointed; otherwise it is released now, and a dash or a verb this tick sees a
  // clear road. The identity (landing id, drop) is refreshed while it holds.
  if (flow.brakeDirX !== null) {
    const intentMag = Math.hypot(input.targetVelX, input.targetVelZ);
    const stillToward =
      intentMag > 1e-3 &&
      input.targetVelX * flow.brakeDirX + input.targetVelZ * flow.brakeDirZ > 0;
    let stale = !stillToward;
    if (!stale) {
      const committed = predictCommittedWalkOff(
        world,
        motion,
        input.targetVelX,
        input.targetVelZ,
        tuning,
      );
      if (Number.isFinite(committed.dropM) && committed.dropM <= tuning.edgeBrakeMinDropM) {
        stale = true;
      } else {
        flow.brakeLandingId = committed.landingId;
        flow.brakeDropM = committed.dropM;
      }
    }
    if (stale) {
      flow.brakeDirX = null;
      flow.brakeDirZ = 0;
      flow.brakeLipDistM = 0;
      flow.brakeLandingId = null;
      flow.brakeDropM = 0;
    }
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
  // A confirmed edge hazard brakes BEFORE motion integrates, which is the only
  // ordering that actually holds a ledge, and it brakes on STOPPING DISTANCE
  // rather than waiting for the body to be a hand's breadth from the lip. The
  // held target can never point over the lip (the refusal), and the over-lip
  // velocity is removed outright the moment the body could no longer stop before
  // the lip at the deceleration it will actually achieve. Turning away and
  // running along the edge stays untouched.
  let targetVelX = input.targetVelX;
  let targetVelZ = input.targetVelZ;
  if (
    flow.brakeDirX !== null &&
    motion.grounded &&
    !AUTHORED_PHASES.has(motion.phase) &&
    !AIRBORNE_PHASES.has(motion.phase) &&
    !jumpWanted
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
      const stoppingDistM = (alongVel * alongVel) / (2 * DECEL);
      const roomM = flow.brakeLipDistM - tuning.edgeBrakeHoldM;
      if (stoppingDistM >= roomM) {
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
  }

  // ---- aim a directed drop onto the middle of its narrow receiver ---------
  // Before the body walks off the lip, hold its along-axis takeoff speed to one
  // whose PREDICTED capsule landing sits on the CENTRE of the receiving board,
  // not merely somewhere on it. This is the trajectory-aware half of the fix:
  // the authored approach cap gets a body to the lip at a sane pace, but a
  // walk-off is ballistic — the takeoff SPEED decides where the capsule comes
  // down, and an arc a hair too fast comes down on the far lip and rolls off, a
  // hair too slow on the near one. So the honest control is to check where the
  // walk-off actually lands and shave the takeoff until it lands square. Only
  // ever LOWERS the speed, only bites in the last strides into a narrow
  // receiver, and preserves the full-approach deceleration that brought the body
  // here; a body already slow enough is left alone. The edge brake still owns any
  // lip whose walk-off has no safe landing at all — this only aims one that does.
  if (
    directedDescent &&
    descentIntentAgrees &&
    motion.grounded &&
    !wasAuthored &&
    !wasAirborne &&
    !jumpWanted &&
    flow.brakeDirX === null
  ) {
    const gAxisLen = Math.hypot(guidedAxisX!, guidedAxisZ!);
    if (gAxisLen > 1e-6) {
      const ax = guidedAxisX! / gAxisLen;
      const az = guidedAxisZ! / gAxisLen;
      const alongTarget = targetVelX * ax + targetVelZ * az;
      if (alongTarget > DIRECTED_DROP_REF_SPEED_MPS) {
        const vSafe = directedDropTakeoffCap(
          world,
          motion,
          ax,
          az,
          alongTarget,
          input.dt,
          tuning,
        );
        if (vSafe !== null && vSafe < alongTarget) {
          // Trim the excess along-axis speed from both the target and the live
          // velocity, so the body settles to the aimed pace before the lip
          // rather than carrying a fast entry into the arc. Cross-axis motion
          // (a step along the board) and the descent itself are untouched.
          const cutT = alongTarget - vSafe;
          targetVelX -= ax * cutT;
          targetVelZ -= az * cutT;
          const alongVel = motion.vel.x * ax + motion.vel.z * az;
          if (alongVel > vSafe) {
            const cutV = alongVel - vSafe;
            motion = {
              ...motion,
              vel: {
                x: motion.vel.x - ax * cutV,
                y: motion.vel.y,
                z: motion.vel.z - az * cutV,
              },
            };
          }
        }
      }
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
      let carriedX = entryDirX * carried;
      let carriedZ = entryDirZ * carried;
      // A directed drop that has just landed on its narrow receiver: the momentum
      // that carried the body ACROSS the board's narrow axis is drop-in, not
      // travel — the route runs along the board, not across it — and left intact
      // it walks a landing that is inside the safe inset out over the near lip
      // before the body settles. Damp only that cross-axis (approach-axis)
      // component, keeping any along-board step. A small generic settle tied to
      // narrow directed receivers: no teleport, no freeze, no snap to centre.
      if (directedDescent && guidedAxisX !== undefined && guidedAxisZ !== undefined) {
        const axisLen = Math.hypot(guidedAxisX, guidedAxisZ);
        const support = supportBelow(
          world,
          motion.pos.x,
          motion.pos.z,
          motion.pos.y + CONTACT_EPS,
        );
        const board = support
          ? world.platforms.find((p) => p.id === support.id)
          : undefined;
        if (axisLen > 1e-6 && board && !board.polygon) {
          const ax = guidedAxisX / axisLen;
          const az = guidedAxisZ / axisLen;
          const spanAlong =
            Math.abs(ax) * (board.maxX - board.minX) +
            Math.abs(az) * (board.maxZ - board.minZ);
          if (spanAlong <= NARROW_RECEIVER_SPAN_M) {
            const along = carriedX * ax + carriedZ * az;
            carriedX -= ax * along;
            carriedZ -= az * along;
          }
        }
      }
      motion = {
        ...motion,
        vel: { x: carriedX, y: 0, z: carriedZ },
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

  const pushing = Math.hypot(targetVelX, targetVelZ) > 1e-3;
  const ctx: SelectContext = {
    grounded: motion.grounded,
    sprintHeld: input.sprintHeld,
    jumpBuffered: jumpWanted,
    crouchHeld: input.crouchHeld,
    chaining: flow.chainWindowTicks > 0,
    receivingTargets: input.receivingTargets,
    reducedMotion: input.reducedMotion,
    pushing,
  };

  // A directed gateway steers the READ onto its authored axis, but only when the
  // player is actually pushing along it. Intent away from the axis leaves the
  // reader honest — the guidance cannot drag a body onto a vault it is turning
  // away from. Measured on the RAW input (what the player asked for), not the
  // brake-reduced local.
  const guidedAxis =
    input.guidedAxisX !== undefined && input.guidedAxisZ !== undefined
      ? { x: input.guidedAxisX, z: input.guidedAxisZ }
      : null;
  const intentMag = Math.hypot(input.targetVelX, input.targetVelZ);
  const intentAgrees =
    guidedAxis !== null &&
    intentMag > 1e-3 &&
    (input.targetVelX / intentMag) * guidedAxis.x +
      (input.targetVelZ / intentMag) * guidedAxis.z >=
      GUIDED_INTENT_DOT;
  const guidedCommit =
    intentAgrees && (input.guidedVerbs?.length ?? 0) > 0
      ? input.guidedVerbs!
      : null;

  probe = probeAhead(
    world,
    {
      pos: motion.pos,
      velX: motion.vel.x,
      velZ: motion.vel.z,
      yaw: motion.yaw,
      dirOverrideX: intentAgrees ? guidedAxis!.x : undefined,
      dirOverrideZ: intentAgrees ? guidedAxis!.z : undefined,
      // The exact walk-off prediction fells THIS body: the complete live state —
      // an open dash, a mid-action phase and its ticks, the coyote already spent,
      // the velocities and yaw — deep-cloned and stepped forward, not a fresh
      // GROUNDED body rebuilt from scalars. The target it accelerates toward is
      // the RAW input, not the brake-reduced local, so the prediction reflects
      // what the player is actually asking the body to do.
      intentX: input.targetVelX,
      intentZ: input.targetVelZ,
      airtimeMs: motion.airtimeMs,
      capsuleHeight: motion.capsuleHeight,
      motion,
    },
    tuning,
  );

  // ---- keep the held hazard's lip distance current -----------------------
  // Release and recompute happen at the TOP of the tick, before anything reads
  // the hazard (see the revalidation block), and confirmation happens at the
  // EDGE_BRAKE commit. All that is left here is to keep the distance to the lip
  // fresh for a hazard that persisted through a braked tick, so the pre-motion
  // stopping-distance brake stays sized correctly as the body settles.
  if (flow.brakeDirX !== null && probe.edge !== null) {
    flow.brakeLipDistM = probe.edge.contactDistanceM;
  }

  // ---- walk the ladder to the end -----------------------------------------
  //
  // SELECTION AND COMMITMENT ARE ONE LOOP, and they were two. `selectVerb`
  // returned the best candidate whose PLAN validated, and the controller then
  // either fired that one candidate or did nothing at all for the tick. Two
  // failure modes came out of the gap between "plans" and "can actually run
  // right now", and both of them are the player asking for something and the
  // game answering with silence:
  //
  //   * A candidate that is not yet at its commit distance ended the tick. A
  //     mantle read two metres out is the correct read and the wrong action,
  //     and it took the whole tick with it — including any buffered jump.
  //
  //   * A candidate whose plan validated but which `beginAuthored` then REFUSED
  //     also ended the tick, and went on ending every tick after it, because the
  //     next read produced the same refusing candidate. `planVerb` checks the
  //     endpoint; `beginAuthored` additionally sweeps the whole trajectory, and
  //     in a street built out of adjacent boxes those two disagree constantly.
  //     Measured against M1's alley crates it is a permanent stop: MANTLE
  //     previewed, MANTLE refused, forever, with the only way out of the alley
  //     one and a half metres above the player's head.
  //
  // So every ranked candidate gets its turn, and the first one that the physics
  // actually accepts is the one that runs. The preview reported to a dev overlay
  // is still the best READ, which is the honest thing for it to show.
  const ranked = rankVerbs(probe, ctx, tuning);
  let previewed: VerbChoice | null = null;
  let acted = false;

  // Shift is a sprint, not parkour consent. When the committed guidance is a
  // same-height/lower run, an inferred upward MANTLE or CLIMB_UP onto an
  // incidental face is refused unless the player explicitly buffers Space — the
  // read that used to walk a sprinting body up a 2.2m east face off its route and
  // onto the wrong axis of the Town House roof. Default true, so an unwired
  // caller is unchanged. A MANTLE onto an obstacle only became safe to gate once
  // the gaol-barrels VAULT stopped silently falling back to it (see the GAOL
  // repair): the SAFE street line now vaults its obstacle, it does not mantle it.
  const inferredAscentAllowed = input.inferredAscentAllowed ?? true;

  for (const verb of ranked) {
    const plan = planVerb(world, probe, ctx, verb, motion.pos, tuning);
    if (!plan) continue;
    if (!previewed) previewed = plan;
    // A directed gateway with the player pushing along its axis: only the
    // gateway's own verb family may COMMIT, so the body cannot be hijacked onto a
    // different traversal at the action. Preview is already recorded above, so it
    // stays truthful; the edge brake is exempt because refusing to fall is a
    // safety, not a hijack, and must never be filtered out.
    if (guidedCommit && verb !== "EDGE_BRAKE" && !guidedCommit.includes(verb)) {
      continue;
    }
    // An inferred upward ascent the route did not ask for: preview it (done
    // above) but do not commit it without a buffered jump. Only the commit is
    // gated — the ladder falls through to whatever is ranked below (a same-height
    // run past the face, the VAULT that clears the obstacle, or the edge brake if
    // the read is a fall). MANTLE and CLIMB_UP are the two inferred UPWARD verbs;
    // VAULT and CLIMB_OVER cross an obstacle rather than mount a deck and stay
    // automatic, and a buffered Space commits either gated verb outright.
    if (!inferredAscentAllowed && !jumpWanted && verb === "CLIMB_UP") {
      continue;
    }
    // THE COOLDOWN IS FOR VERBS, AND THE BRAKE IS NOT ONE. It exists so a chain
    // does not fire twice off one read; the brake fires nothing, it refuses. And
    // the ticks right after a verb are exactly when a refusal is most needed,
    // because a verb ENDS by handing the body its exit speed back. Measured on
    // the Town House: a hang drop off the roof plants the body on the south
    // cornice fifteen centimetres from the far lip, restores 2.3 m/s pointing at
    // it, and the brake — ranked, planned, ready — sat out three ticks of
    // cooldown while the body covered eleven of those fifteen centimetres. It
    // then stopped a body whose centre was already over the edge, and the point
    // under the feet was no longer deck.
    // THE COOLDOWN IS FOR VERBS THAT KEEP A CHAIN MOVING, NOT FOR THE ANSWERS AT A
    // LIP. The brake refuses rather than fires; a hang drop and a leap of faith are
    // the controlled descents the ladder deliberately ranks ABOVE the brake as the
    // safe way off a lip whose walk-off is fatal. All three are needed in exactly
    // the ticks right after a verb ends — a verb ends by restoring the body's exit
    // speed toward whatever is ahead. Suppressing the descents through the cooldown
    // while leaving the brake exempt let EDGE_BRAKE confirm a hazard the descent
    // answers, and the persisted hazard then killed the approach — a silent
    // soft-lock. It is the whole F-section descent out of the Liberty Elm: the
    // crown overhangs the low bough, the low bough overhangs the stall awning, and
    // each tier lands into the cooldown of the last, so a chain of hang drops down
    // a fatal-walk-off face never got past the first rim. Exempting the descents
    // keeps the climb/drop chain whole; each is still gated by its own read (a
    // reachable straight-down for the hang drop, sprint + an in-cone receiving
    // target for the dive), so nothing fires off a cooldown that the geometry and
    // intent did not already ask for.
    if (
      flow.cooldownTicks > 0 &&
      verb !== "EDGE_BRAKE" &&
      verb !== "LEAP_OF_FAITH" &&
      verb !== "HANG_DROP"
    ) {
      continue;
    }
    // A LIP THE BODY WILL LEAP FROM IS NOT ONE TO BRAKE AT. The walk-off read
    // reports this flat gap as a fatal fall — a body that strolls off has no
    // launch and drops into the void — so the ladder ranks EDGE_BRAKE. But a
    // sprinting body auto-jumps it, and `gapLeapReachable` confirms, with the same
    // exact ballistic solve and landing checks the real JUMP_GAP commit uses, that
    // the body will reach the lip fast enough to clear onto the far surface. When
    // it will, the brake stands aside so JUMP_GAP (ranked above it) can own the lip
    // once the body arrives at takeoff speed — the fix for the Town House
    // scaffold->gallery soft-lock, and only there: a genuine kill lip with no
    // landable leap still returns false here and still brakes.
    if (verb === "EDGE_BRAKE" && gapLeapReachable(world, probe, ctx, motion.pos, tuning)) {
      continue;
    }
    // Not there yet is not the same as cannot. A dive read at half a metre from
    // a twelve-metre lip is the right verb waiting for the right tick, and
    // letting the rung below it act in the meantime is how a swan dive turns
    // into the edge brake that was ranked underneath it. The ladder stops here
    // and tries again next tick, one step closer.
    if (plan.contactDistanceM > plan.commitDistanceM) break;
    const committed = commitVerb(world, motion, flow, plan, probe, tuning);
    // The physics refused it — `beginAuthored` sweeps a trajectory `planVerb`
    // never saw. THIS is the rung to fall through, and falling through is the
    // whole repair: a refusal used to end the tick and then end every tick
    // after it, because the next read produced the same refusing candidate.
    if (!committed) continue;
    motion = committed.motion;
    flow = committed.flow;
    events.push(...committed.events);
    noise.push(...committed.noise);
    // BLOCKED is a report that the geometry has no answer, not an action. It
    // must not stand between the player and their own jump.
    if (plan.verb !== "BLOCKED") {
      acted = true;
      break;
    }
  }

  // ---- the jump always does something -------------------------------------
  //
  // If the ladder did not act and the player has a live jump press, they leave
  // the ground. That is the whole guarantee, and it is deliberately stated as a
  // property of the controller rather than as another rung: a rung can be
  // outranked by a candidate that then turns out not to be able to run, which
  // is how the guarantee was lost in the first place.
  //
  // Note what this does NOT do. A verb that actually commits still wins — press
  // jump at a vaultable crate and you vault it, because that is the read the
  // whole system exists to make. What can no longer happen is pressing jump and
  // getting neither.
  if (!acted && jumpWanted && motion.grounded) {
    const jump = planVerb(world, probe, ctx, "JUMP", motion.pos, tuning);
    const committed = jump
      ? commitVerb(world, motion, flow, jump, probe, tuning)
      : null;
    if (committed) {
      motion = committed.motion;
      flow = committed.flow;
      events.push(...committed.events);
      noise.push(...committed.noise);
      acted = true;
    }
  }

  // A press is spent by whatever the tick did with it. Holding it past a verb
  // that committed would fire a second launch off the top of the thing the
  // player just climbed, which is not what the press meant.
  if (acted) flow.jumpBufferTicks = 0;

  // THE PREVIEW IS WHAT THE GEOMETRY OFFERS, NOT WHAT THE PLAYER IS CURRENTLY
  // ENTITLED TO. Commitment needs the parkour key held; the read does not, and
  // must not, because the affordance layer draws its catch bands and its
  // first-time captions off this. A player who has not learned about the key is
  // exactly the player who needs to be told there is something here to catch —
  // and gating the preview on the key would show them nothing, which is the
  // shape of every "the game is broken" report on this mission so far.
  const shown =
    previewed ??
    (ctx.sprintHeld
      ? null
      : firstPlan(world, probe, { ...ctx, sprintHeld: true }, motion.pos, tuning));
  flow.previewVerb = shown?.verb ?? "NONE";
  flow.previewReason = shown?.reason ?? "";

  flow.clip =
    flow.verb !== "NONE"
      ? verbClip(motion, flow.verb)
      : flow.landingTicks > 0
        ? LANDING_CLIP[flow.landing]
        : locomotionClip(motion, input, tuning);
  flow.clipOnce = flow.verb !== "NONE" || flow.landingTicks > 0;

  return { motion, flow, events, noise, probe };
}

/** The best candidate that plans against this world, or null. Read only. */
function firstPlan(
  world: CollisionWorld,
  probe: ParkourProbe,
  ctx: SelectContext,
  start: Vec3,
  tuning: ParkourTuning,
): VerbChoice | null {
  for (const verb of rankVerbs(probe, ctx, tuning)) {
    const plan = planVerb(world, probe, ctx, verb, start, tuning);
    if (plan) return plan;
  }
  return null;
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
  // A deliberate leave — an authored move or a launch — clears the hazard: the
  // player chose to go. A passive outcome (a run-off the brake has already
  // neutralised, a block, the brake itself) leaves it alone, so the persisted
  // hazard is not wiped by the harmless RUN_OFF that ranks once braking has made
  // the read look survivable.
  if (choice.motion.kind === "AUTHORED" || choice.motion.kind === "LAUNCH") {
    flow.brakeDirX = null;
    flow.brakeDirZ = 0;
    flow.brakeLandingId = null;
    flow.brakeDropM = 0;
    flow.brakeLipDistM = 0;
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
    // velocity every tick — so the brake cancels it, and the body is then braked
    // on whatever speed the burst produced like anyone else.
    if (isDashing(motion)) {
      motion = cancelDash(motion);
      flow.dashCooldownTicks = tuning.dashCooldownTicks;
      if (flow.verb === "DASH") flow.verb = "NONE";
      events.push({ type: "dashEnded", verb: "DASH", chain: flow.chain });
    }
    // CONFIRM the hazard, and only here — reaching this commit means the ladder
    // ranked EDGE_BRAKE above every descent, so there is genuinely nothing safe to
    // do at this lip. The body still carries the speed that proved the drop fatal,
    // so the live read's identity IS the hazard's identity. The velocity is not
    // touched; the stopping-distance brake ran before this tick's displacement and
    // runs again next tick from the persisted hazard.
    flow.brakeDirX = probe.dirX;
    flow.brakeDirZ = probe.dirZ;
    flow.brakeLipDistM = probe.edge?.contactDistanceM ?? choice.contactDistanceM;
    flow.brakeLandingId = probe.edge?.landingId ?? null;
    flow.brakeDropM = probe.edge?.dropM ?? Infinity;
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
