// The watchers' legs.
//
// THE PROBLEM THIS EXISTS FOR. Everything upstream of this file worked. Cones
// were evaluated against the player sixty times a second, suspicion accrued,
// the ladder in alert.ts climbed UNAWARE -> CURIOUS -> INVESTIGATING ->
// ALERTED, a shout propagated twenty-two metres and pulled the squad in, and
// hunt.ts opened a search of the ground the player was caught on and held every
// watcher inside it awake. Then nothing happened, because a watcher's POSITION
// came from `watcherPosesAtTick(tick, seed)` — a pure function of the clock —
// and no part of the escalation could reach it. Measured over ten seconds after
// a confirmed sighting, with two men ALERTED and three more SEARCHING, the
// largest deviation of any watcher from the route he walks when the level is
// empty was 0.000000 metres. The man who saw you and shouted was still standing
// on his mark, shouting, forever.
//
// That is the whole of what the player was reporting. Detection was real and
// consequence-free in the most literal way available: the world knew, and the
// world did not move. Every mechanic hanging off detection — the vision cones,
// reflex time, crowd blending, the thrown bottle, light and shadow, hard cover
// — is an answer to a threat that closes on you, and none of them mean anything
// against a threat that cannot take a step.
//
// WHAT THIS ADDS, and it is deliberately only this: legs. The decision about
// whether a watcher is interested belongs to alert.ts and has belonged there all
// along; this file does not re-decide it, does not touch suspicion, and does not
// scale detection by anything. It reads the state alert.ts published last tick
// and answers the one question nobody was answering — given that this man is
// curious, or investigating, or searching, where is he standing now?
//
// FOUR RULES BOUND IT, and each one is a bound on the AI rather than on the
// player:
//
//   * A LEASH. A watcher never gets further than `leashM` from the post or the
//     patrol route he is authored on. Past it he turns round. This is what stops
//     one sighting in the Shambles from unravelling the whole level's opposition
//     into a conga line behind the player, and it is what makes "get away from
//     them" a thing a player can actually do and see working.
//   * A STEP. A watcher will not pursue over ground that is more than a step
//     above or below him. The watch on the Old Brick tower is eight metres up a
//     building; the correct behaviour for him is to stay there and shout, and
//     this is the rule that produces that without anybody authoring it. It also
//     means no watcher ever walks off a roof, which is the failure mode that
//     would need collision code this file has no business owning.
//   * A HOLD. `curiousHoldTicks` has been sitting in the tuning table since
//     detection shipped, documented as "ticks a watcher holds its post looking
//     before walking to investigate", read by nothing. It is read here. A
//     curious watcher looks first and walks second, which is the beat that makes
//     a near-miss survivable.
//   * A SWEEP, not a wander. When a watcher arrives at where he last saw you and
//     you are not there, he walks a fixed four-point box around the spot. Fixed
//     because this simulation is deterministic: the pattern is a table indexed by
//     a leg counter, there is no draw in this file, and two runs of the same seed
//     put the same man in the same place on the same tick.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It does not catch anybody. There is no
// grab, no capture radius and no fail condition here, because the mission has
// exactly one authored fail point and it is the final court — see the argument
// at the top of hunt.ts, which this file is the missing half of rather than a
// revision to. The cost of being seen is still position and seconds. The change
// is that the position is now taken from the player by men walking onto it,
// which is what the design said all along and what the level could not express.

import {
  CAPSULE_RADIUS,
  STAND_HEIGHT,
  sweepXZ,
  supportBelow,
  type CollisionWorld,
  type Vec3,
} from "../collision.js";
import type { WatcherAlert } from "./alert.js";
import type { WatcherPose } from "./field.js";
import { STEALTH_TUNING, type StealthTuning } from "./tuning.js";
import { yawToward } from "./vision.js";

/**
 * How the watchers move. Separate from `STEALTH_TUNING` because none of it is a
 * detection value: nothing in this table changes what an eye can resolve, only
 * where the eye is standing. Keeping the two apart is the same line hunt.ts
 * draws — escalation changes what patrols DO and never how well they see.
 */
export interface PursuitTuning {
  /** Closing speed on a live contact. A jog: quicker than the player walks. */
  advanceMps: number;
  /** Speed while sweeping a place the player has already left. */
  sweepMps: number;
  /** Speed back to the post once interest is gone. */
  returnMps: number;
  /**
   * How far a watcher may get from his authored post or patrol route.
   *
   * The single most important number here. It is what makes the pursuit a local
   * event the player can leave rather than a global one they cannot, and it is
   * why a hunt costs a route instead of costing the run.
   */
  leashM: number;
  /** Within this of the goal, he is there. */
  arriveM: number;
  /** Within this of his post, he is back on it and the patrol resumes. */
  postSnapM: number;
  /**
   * Greatest height change a watcher will take in one step to follow somebody.
   *
   * A kerb, a low stair, the camber of a street. Not a scaffold, not a roof, and
   * not the drop off a tower gallery.
   */
  maxStepM: number;
  /**
   * Greatest height difference between a watcher and the place he is being asked
   * to walk to before he simply refuses and watches instead.
   *
   * This is the rule that keeps the Old Brick tower watch on his tower when he
   * sees somebody on the square eight metres below him.
   */
  maxPursueRiseM: number;
  /** How far off the last-known position each leg of the sweep box stands. */
  sweepRadiusM: number;
  /** Ticks per leg of the sweep, so a leg that cannot be reached still ends. */
  sweepLegTicks: number;
  /** How fast a moving watcher's body turns to face where he is going. */
  turnRadPerSecond: number;
}

export const PURSUIT_TUNING: PursuitTuning = {
  // Faster than the mission's walk and slower than its sprint. A player who runs
  // gets away; a player who dithers does not. That ordering is the mechanic.
  advanceMps: 3.1,
  sweepMps: 1.4,
  returnMps: 2.2,
  // Comfortably inside the 18m hunt radius, so the men a hunt holds awake are
  // roughly the men who can reach the ground it is searching.
  leashM: 14,
  arriveM: 1.6,
  postSnapM: 0.45,
  maxStepM: 0.55,
  maxPursueRiseM: 1.6,
  sweepRadiusM: 3.2,
  sweepLegTicks: 96,
  turnRadPerSecond: 4.5,
};

export type PursuitPhase =
  /** On the authored route or post. The only phase that costs nothing to step. */
  | "POST"
  /** Curious, looking, not yet walking. `curiousHoldTicks` is running down. */
  | "HOLD"
  /** Closing on a last-known position. */
  | "ADVANCE"
  /** Walking the box around a place the player has already left. */
  | "SWEEP"
  /** Interest gone, or the leash reached. Heading back. */
  | "RETURN";

export interface WatcherPursuit {
  id: string;
  phase: PursuitPhase;
  /**
   * Where this watcher is actually standing.
   *
   * Null before the first step, which is how a watcher adopts his authored pose
   * on the tick he first appears rather than sliding to it from the origin.
   */
  position: Vec3 | null;
  /** Body facing. The stealth field turns the CONE; this turns the man. */
  yaw: number;
  /** Where he is walking to, in world space. Null when he is not. */
  goal: Vec3 | null;
  /** Ticks of `curiousHoldTicks` still to run before a curious watcher moves. */
  holdTicks: number;
  /** Ticks spent on the current leg of a sweep. */
  legTicks: number;
  /** Which leg of the sweep box. Deterministic; see SWEEP_LEGS. */
  leg: number;
  /** Fixed steps spent away from the authored post. Telemetry and tests. */
  offPostTicks: number;
}

export type PursuitEventType =
  /** A watcher left his post to go and look. */
  | "leftPost"
  /** A watcher reached the place he was walking to. */
  | "arrived"
  /** A watcher hit his leash and turned round. */
  | "leashed"
  /** A watcher is back on his authored route. */
  | "resumed";

export interface PursuitEvent {
  type: PursuitEventType;
  watcherId: string;
}

export interface PursuitResult {
  states: WatcherPursuit[];
  /**
   * The poses to hand `stepStealthField`.
   *
   * The authored pose with the watcher's real position and travel facing
   * substituted in. Everything else — cone half-angle, range, the colliders his
   * line of sight ignores — is the level's and is passed straight through.
   */
  poses: WatcherPose[];
  events: PursuitEvent[];
}

export interface PursuitStepInput {
  dt: number;
  /**
   * Where each watcher WOULD be this tick if nothing had happened: the level
   * walking its authored routes on the clock. A posted watcher's anchor never
   * moves; a patrol's does, which is what a returning watcher walks back to.
   */
  anchors: readonly WatcherPose[];
  /**
   * Last tick's alert states, straight off `StealthFieldState.watchers`.
   *
   * Last tick's on purpose, and it is not a compromise. The field resolves
   * visibility from a pose, so the pose has to exist before the field runs; a
   * watcher who acted on the same tick's alert would be reacting to a sighting
   * that has not been computed yet. One fixed step of reaction lag is 16ms and
   * is the correct causal order.
   */
  alerts: readonly WatcherAlert[];
}

export function createPursuitState(
  watcherIds: readonly string[],
): WatcherPursuit[] {
  return watcherIds.map((id) => ({
    id,
    phase: "POST" as const,
    position: null,
    yaw: 0,
    goal: null,
    holdTicks: 0,
    legTicks: 0,
    leg: 0,
    offPostTicks: 0,
  }));
}

/**
 * The sweep box, in metres off the last-known position.
 *
 * A table rather than a draw. `check-boundaries.mjs` forbids `Math.random` and
 * it would be wrong here anyway: a search a player can learn to read is a
 * mechanic, and a search that is different every run is weather.
 */
const SWEEP_LEGS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

function distanceXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function turnToward(from: number, to: number, dt: number, rate: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const step = rate * dt;
  if (Math.abs(delta) <= step) return to;
  return from + Math.sign(delta) * step;
}

/**
 * The place this watcher currently cares about, or null.
 *
 * Read entirely off alert.ts's published state. A CURIOUS watcher will follow a
 * noise, which is what makes a thrown bottle pull a body and not merely a cone;
 * an INVESTIGATING or ALERTED one goes to where he last saw somebody, because a
 * diversion must not be able to walk a man off a live contact — the same rule
 * `stepWatcherAttention` already applies to his eyes.
 */
function interestOf(alert: WatcherAlert): Vec3 | null {
  switch (alert.state) {
    case "ALERTED":
    case "INVESTIGATING":
      return alert.lastKnown;
    case "SEARCHING":
      return alert.attentionIsDiversion && alert.attentionTicks > 0
        ? alert.attention
        : alert.lastKnown;
    case "CURIOUS":
      return alert.attention ?? alert.lastKnown;
    default:
      return null;
  }
}

/**
 * Pull a goal back inside the watcher's leash.
 *
 * Clamped rather than refused, so a watcher whose contact is running out of his
 * area still walks to the edge of it and searches there, which is both the
 * right behaviour and the one that reads as a man giving up ground reluctantly.
 */
function leashed(goal: Vec3, home: Vec3, leashM: number): Vec3 {
  const away = distanceXZ(goal, home);
  if (away <= leashM) return goal;
  const scale = leashM / away;
  return {
    x: home.x + (goal.x - home.x) * scale,
    y: goal.y,
    z: home.z + (goal.z - home.z) * scale,
  };
}

/**
 * Walk one fixed step toward a point, through the collision world.
 *
 * `sweepXZ` is the engine's one swept-capsule slide — the same call the player's
 * own motion makes — so a watcher is stopped by the same stalls, walls and carts
 * the player is, and rounds a corner rather than grinding into it. The foot
 * height then comes off `supportBelow`, and a step that would change it by more
 * than `maxStepM` is refused outright: that refusal is the whole of why nobody
 * walks off a gallery, and it needs no new collision code to hold.
 */
function walk(
  world: CollisionWorld,
  from: Vec3,
  toward: Vec3,
  speedMps: number,
  dt: number,
  capsuleHeight: number,
  ignore: ReadonlySet<string> | undefined,
  tuning: PursuitTuning,
): Vec3 {
  const dx = toward.x - from.x;
  const dz = toward.z - from.z;
  const away = Math.hypot(dx, dz);
  if (away < 1e-6) return from;
  const travel = Math.min(away, speedMps * dt);
  const swept = sweepXZ(
    world,
    from,
    { x: from.x + (dx / away) * travel, z: from.z + (dz / away) * travel },
    CAPSULE_RADIUS,
    capsuleHeight,
    ignore,
  );
  const support = supportBelow(
    world,
    swept.x,
    swept.z,
    from.y + tuning.maxStepM,
    tuning.maxStepM,
  );
  if (!support || Math.abs(support.y - from.y) > tuning.maxStepM) return from;
  return { x: swept.x, y: support.y, z: swept.z };
}

/**
 * One fixed step of every watcher's legs.
 *
 * Runs BEFORE `stepStealthField` in the mission tick, and the poses it returns
 * are the poses the field must be given. Handing the field the authored anchors
 * instead would put every cone back on its mark and make this file decorative,
 * which is the exact failure it was written to end.
 */
export function stepWatcherPursuit(
  world: CollisionWorld,
  statesIn: readonly WatcherPursuit[],
  input: PursuitStepInput,
  tuning: PursuitTuning = PURSUIT_TUNING,
  stealth: StealthTuning = STEALTH_TUNING,
): PursuitResult {
  const events: PursuitEvent[] = [];
  const anchorById = new Map(input.anchors.map((pose) => [pose.id, pose]));
  const alertById = new Map(input.alerts.map((alert) => [alert.id, alert]));
  const states: WatcherPursuit[] = [];
  const poses: WatcherPose[] = [];

  for (const stateIn of statesIn) {
    const anchor = anchorById.get(stateIn.id);
    if (!anchor) {
      states.push(stateIn);
      continue;
    }
    const state: WatcherPursuit = { ...stateIn };
    const home = anchor.position;
    const capsuleHeight = anchor.capsuleHeight ?? STAND_HEIGHT;

    // First sight of this watcher: he is where the level says he is, facing
    // where the level says he faces. Sliding to it would animate a spawn.
    if (!state.position) {
      state.position = { ...home };
      state.yaw = anchor.baseYaw;
    }

    const alert = alertById.get(state.id);
    const interest = alert ? interestOf(alert) : null;
    // HOLD counts as "still on post": a curious watcher who is looking has not
    // left yet, and reporting that he had would make the one event a caption
    // can hang off fire on the wrong beat.
    const wasSettled = state.phase === "POST" || state.phase === "HOLD";

    // A place he cannot get to is a place he does not walk to. He is not
    // paralysed by it — the field still turns his cone and he still shouts —
    // he simply stays where he can do his job from.
    const reachable =
      interest !== null &&
      Math.abs(interest.y - state.position.y) <= tuning.maxPursueRiseM;

    let goal: Vec3 | null = null;
    if (interest && reachable) {
      goal = leashed(interest, home, tuning.leashM);
      if (goal !== interest && state.phase !== "RETURN") {
        events.push({ type: "leashed", watcherId: state.id });
      }
    }

    if (!goal) {
      // Nothing to look at, or nothing he can walk to. Go home.
      state.goal = null;
      state.holdTicks = 0;
      state.leg = 0;
      state.legTicks = 0;
      state.phase = distanceXZ(state.position, home) <= tuning.postSnapM
        ? "POST"
        : "RETURN";
    } else {
      state.goal = goal;
      if (alert!.state === "CURIOUS") {
        // The hold. He looks before he walks, for exactly as long as the tuning
        // table has said he should since the day it was written.
        if (state.phase === "POST" || state.phase === "RETURN") {
          state.phase = "HOLD";
          state.holdTicks = stealth.curiousHoldTicks;
        }
        if (state.phase === "HOLD") {
          state.holdTicks = Math.max(0, state.holdTicks - 1);
          if (state.holdTicks === 0) state.phase = "ADVANCE";
        }
      } else if (state.phase === "POST" || state.phase === "RETURN" || state.phase === "HOLD") {
        // Seen, or shouted at. No hold: he is already moving.
        state.phase = "ADVANCE";
        state.holdTicks = 0;
      }

      if (state.phase === "ADVANCE" && distanceXZ(state.position, goal) <= tuning.arriveM) {
        events.push({ type: "arrived", watcherId: state.id });
        state.phase = "SWEEP";
        state.leg = 0;
        state.legTicks = 0;
      }
      // A fresh sighting while sweeping is a new place to be, not a new leg.
      if (state.phase === "SWEEP" && distanceXZ(state.position, goal) > tuning.arriveM + tuning.sweepRadiusM) {
        state.phase = "ADVANCE";
      }
    }

    // ---- move -------------------------------------------------------------
    // POST is the common case and costs nothing: no sweep, no support query, no
    // allocation. Seven watchers standing still must not be a per-tick bill.
    let target: Vec3 | null = null;
    let speed = 0;
    if (state.phase === "ADVANCE" && state.goal) {
      target = state.goal;
      speed = tuning.advanceMps;
    } else if (state.phase === "SWEEP" && state.goal) {
      state.legTicks += 1;
      const [ox, oz] = SWEEP_LEGS[state.leg % SWEEP_LEGS.length]!;
      // Leashed like the goal it surrounds. A box drawn around a point already
      // at the edge of the area would put its far corner outside, and a leash
      // that the search itself steps over is not a leash.
      target = leashed(
        {
          x: state.goal.x + ox * tuning.sweepRadiusM,
          y: state.goal.y,
          z: state.goal.z + oz * tuning.sweepRadiusM,
        },
        home,
        tuning.leashM,
      );
      speed = tuning.sweepMps;
      if (
        state.legTicks >= tuning.sweepLegTicks ||
        distanceXZ(state.position, target) <= tuning.arriveM * 0.6
      ) {
        state.leg = (state.leg + 1) % SWEEP_LEGS.length;
        state.legTicks = 0;
      }
    } else if (state.phase === "RETURN") {
      target = home;
      speed = tuning.returnMps;
    } else {
      // POST. Ride the authored route exactly, so a patrol that was never
      // disturbed is bit-for-bit the patrol the level authored and every
      // measurement made against it still holds.
      state.position = { ...home };
      state.yaw = anchor.baseYaw;
    }

    if (target && speed > 0) {
      const moved = walk(
        world,
        state.position,
        target,
        speed,
        input.dt,
        capsuleHeight,
        anchor.ignore,
        tuning,
      );
      if (distanceXZ(moved, state.position) > 1e-6) {
        state.yaw = turnToward(
          state.yaw,
          yawToward(state.position, moved),
          input.dt,
          tuning.turnRadPerSecond,
        );
      }
      state.position = moved;
      state.offPostTicks += 1;
      if (state.phase === "RETURN" && distanceXZ(moved, home) <= tuning.postSnapM) {
        state.phase = "POST";
        state.position = { ...home };
        state.yaw = anchor.baseYaw;
        state.offPostTicks = 0;
        events.push({ type: "resumed", watcherId: state.id });
      }
    }

    if (wasSettled && (state.phase === "ADVANCE" || state.phase === "SWEEP")) {
      events.push({ type: "leftPost", watcherId: state.id });
    }

    states.push(state);
    poses.push({
      ...anchor,
      position: state.position,
      // His body's facing is his base facing. The field turns the cone off this
      // toward whatever has his attention, so a man walking to a noise is
      // looking at the noise and a man walking home is looking where he is
      // going — both of which fall out rather than being written twice.
      baseYaw: state.phase === "POST" ? anchor.baseYaw : state.yaw,
    });
  }

  return { states, poses, events };
}

/** Is anybody actually coming? The one bit a HUD needs from this whole file. */
export function anyWatcherPursuing(states: readonly WatcherPursuit[]): boolean {
  return states.some(
    (state) => state.phase === "ADVANCE" || state.phase === "SWEEP",
  );
}
