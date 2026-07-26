// The stealth field, as the player experiences it.
//
// Everything under stealth/ is correct. None of it is legible. `visibility()`
// returns eight multiplied factors and a number; `stepWatcherAlert` returns a
// state machine; reflex time returns a time scale. A player cannot see any of
// that, and the specific failure it produces is the worst one a stealth game
// can have: being caught and not knowing why. A player who cannot name the
// mistake cannot avoid repeating it, so the run stops being a skill and starts
// being weather.
//
// This module is the projection that fixes it, and it has exactly one rule: it
// READS. Nothing here decides anything. It cannot change a cone, hold a
// sighting, or move a watcher — it turns state that already exists into the
// three or four facts a person can act on inside half a second:
//
//   * who can see me, where are they, and how close is that to going wrong;
//   * WHY — which single thing I am doing is the thing that is getting me seen;
//   * is it getting better or worse right now;
//   * what is available to me: a blend, a throw, a window.
//
// The "why" is the load-bearing one and it is the reason this is arithmetic
// rather than a lookup. Visibility is a product of independent factors, so the
// honest answer to "why were you seen" is: the factor whose removal alone would
// have broken the contact, preferring the one the player most directly controls.
// That is computable, and it is the difference between a HUD that reports and a
// HUD that teaches.

import type { Vec3 } from "../collision.js";
import { FIELD_TICK_HZ } from "../fieldSimulation.js";
import type { AlertState, WatcherAlert } from "./alert.js";
import type { CrowdBlendState, CrowdCluster } from "./crowd.js";
import { huntDistanceM, type HuntState } from "./hunt.js";
import {
  STEALTH_TUNING,
  type PlayerMotionRead,
  type StealthTuning,
} from "./tuning.js";
import type { ReflexState } from "./reflex.js";
import { clamp01, type VisibilityResult } from "./vision.js";

// ---- why -------------------------------------------------------------------

/**
 * The one thing most responsible for a watcher resolving the player, or for
 * failing to. Machine-readable so a HUD can tint, point and sort on it; the
 * wording lives in DETECTION_CAUSE_LABEL so there is one copy of it.
 */
export type DetectionCause =
  | "NO_CONTACT"
  | "OUT_OF_RANGE"
  | "OUT_OF_CONE"
  | "SIGHT_BLOCKED"
  | "BLENDED"
  | "TRAVERSING"
  | "MOVING_FAST"
  | "IN_THE_OPEN"
  | "NO_COVER"
  | "IN_THE_LIGHT"
  | "IN_HIS_ARC"
  | "TOO_CLOSE";

/**
 * Second person, present tense, and never a system word.
 *
 * "Exposure factor 1.0" is a true sentence that teaches nothing. "You are out in
 * the open" is the same fact phrased as the thing to do about it, which is the
 * only phrasing that survives being read in half a second by an eleven-year-old
 * mid-sprint.
 */
export const DETECTION_CAUSE_LABEL: Readonly<Record<DetectionCause, string>> = {
  NO_CONTACT: "Nobody is looking at you",
  OUT_OF_RANGE: "Too far away to make you out",
  OUT_OF_CONE: "He is facing the wrong way",
  SIGHT_BLOCKED: "Something is between you",
  BLENDED: "You are just another body in the crowd",
  TRAVERSING: "Climbing where he can see you",
  MOVING_FAST: "You are moving too fast",
  IN_THE_OPEN: "You are out in the open",
  NO_COVER: "Nothing between you and him",
  IN_THE_LIGHT: "You are standing in the light",
  IN_HIS_ARC: "You are right in front of him",
  TOO_CLOSE: "He is too close to miss you",
};

/**
 * A factor the player can act on, and how much acting on it would buy.
 *
 * `best` is the value this factor takes when the player is doing the most they
 * can about it — crouched and still, fully concealed, behind hard cover, in the
 * dark. `1 - best / factor` is therefore the fraction of the current visibility
 * that fixing this ONE thing would remove, which is the only ranking that
 * answers the player's actual question instead of the simulation's.
 */
interface Lever {
  cause: DetectionCause;
  factor: number;
  best: number;
  /** How fast and how certainly the player can act on it. Higher wins. */
  priority: number;
}

/**
 * Priority, not magnitude, is the primary ranking, and the reason is the shape of
 * the numbers rather than a preference.
 *
 * Exposure spans 1.0 down to 0.15 and motion only 1.5 down to 0.32, so ranking by
 * "how much would this remove" hands the answer to exposure almost every time —
 * and exposure is an authored property of where the player is standing, which for
 * long stretches of a level is simply EXPOSED everywhere. "You are out in the
 * open" would then be the answer to nearly every death, which is a sentence that
 * teaches nothing because it is never not true.
 *
 * The player asks "what do I do RIGHT NOW", so the ranking answers with the
 * fastest lever that is not already pulled. Letting go of sprint is instantaneous
 * and always available; finding cover takes a second; the light is a choice made
 * a street ago.
 */
function leversFor(
  result: VisibilityResult,
  motion: PlayerMotionRead,
  tuning: StealthTuning,
): Lever[] {
  const conspicuous = motion === "SPRINT" || motion === "TRAVERSAL";
  return [
    {
      cause: motion === "TRAVERSAL" ? "TRAVERSING" : "MOVING_FAST",
      factor: result.motionFactor,
      best: tuning.motion.CROUCH_STILL,
      // A walk is not a mistake. It is still louder than a crouch, so it stays a
      // lever, but it is the last thing to tell somebody to change.
      priority: conspicuous ? 5 : 1,
    },
    {
      cause: "NO_COVER",
      factor: result.coverFactor,
      best: tuning.coverFactor,
      priority: 4,
    },
    {
      cause: "IN_THE_OPEN",
      factor: result.exposureFactor,
      best: tuning.exposure.CONCEALED,
      priority: 3,
    },
    {
      cause: "IN_THE_LIGHT",
      factor: result.lightFactor,
      best: tuning.darkFactor,
      priority: 2,
    },
  ];
}

/**
 * Why this watcher resolves this player, or why they do not.
 *
 * The hard breaks come first and in the order they are evaluated by
 * `visibility()` itself, so the answer is never a lever the player could not
 * have used: there is no point telling somebody to crouch when the guard is
 * facing away.
 *
 * Once contact is real, the ranking prefers a lever that alone would have broken
 * it — a sufficient fix — over one that would merely have helped, because "stop
 * sprinting and he loses you" is a different instruction from "sprinting is not
 * helping". Among sufficient fixes the most directly controllable wins: you can
 * stop running this tick, you cannot relight the street.
 */
export function detectionCause(
  result: VisibilityResult,
  motion: PlayerMotionRead,
  tuning: StealthTuning = STEALTH_TUNING,
): DetectionCause {
  if (!result.inCone) {
    return Number.isFinite(result.distanceM) &&
      result.distanceM > (tuning.coneRangeM ?? Infinity)
      ? "OUT_OF_RANGE"
      : "OUT_OF_CONE";
  }
  if (!result.hasLineOfSight) return "SIGHT_BLOCKED";
  if (result.crowdFactor <= 0.5) return "BLENDED";
  // In the cone, in the light, and still under the floor: nobody has you. Naming
  // which factor is doing the work would mean phrasing an accusation as
  // reassurance, and "you are out in the open" is a strange thing to be told
  // about a moment you are getting away with.
  if (result.visibility <= tuning.minAccrualVisibility) return "NO_CONTACT";

  const levers = leversFor(result, motion, tuning);
  let best: { lever: Lever; removable: number; sufficient: boolean } | null = null;
  for (const lever of levers) {
    if (lever.factor <= lever.best) continue;
    const removable = 1 - lever.best / lever.factor;
    // Sufficient: fixing this one thing alone would have broken the contact.
    // "Stop running and he loses you" is a different instruction from "running
    // is not helping", and it outranks any question of which lever is faster.
    const sufficient =
      result.visibility * (lever.best / lever.factor) <= tuning.minAccrualVisibility;
    if (
      !best ||
      (sufficient && !best.sufficient) ||
      (sufficient === best.sufficient &&
        (lever.priority > best.lever.priority ||
          (lever.priority === best.lever.priority &&
            removable > best.removable + 1e-9)))
    ) {
      best = { lever, removable, sufficient };
    }
  }
  if (best) return best.lever.cause;

  // Crouched, concealed, covered and in shadow, and still resolved. Nothing is
  // left to change but where the body is.
  return result.coneFactor >= result.distanceFactor ? "IN_HIS_ARC" : "TOO_CLOSE";
}

// ---- per-watcher -----------------------------------------------------------

/** One watcher, as a HUD draws it and as a player reads it. */
export interface WatcherReadout {
  id: string;
  /** Foot position. The cone is drawn from the shared body model above this. */
  position: Vec3;
  /** Effective facing after attention turning: the cone the player is judged by. */
  yaw: number;
  halfAngleRad: number;
  rangeM: number;
  state: AlertState;
  suspicion: number;
  /** This tick's resolved visibility, [0,1]. */
  visibility: number;
  distanceM: number;
  /** World bearing from the player to this watcher, for an off-screen chevron. */
  bearingRad: number;
  /** Resolving the player above the accrual floor right now. */
  contact: boolean;
  cause: DetectionCause;
  /**
   * Ticks until this watcher's shout pulls the squad in, or null.
   *
   * The shout delay is the one window in the whole escalation ladder that the
   * player can still act inside, and until this was published nothing on screen
   * could tell them it was open.
   */
  callInTicks: number | null;
}

// ---- crowd -----------------------------------------------------------------

/** Why the player is not disappearing into a crowd, when they are not. */
export type BlendBlocker =
  | "NONE"
  | "NO_CLUSTER"
  | "TOO_FAR"
  | "TOO_FEW_BODIES"
  | "TOO_FAST"
  | "WATCHED_IN";

export const BLEND_BLOCKER_LABEL: Readonly<Record<BlendBlocker, string>> = {
  NONE: "You are in the crowd",
  NO_CLUSTER: "No crowd near enough to use",
  TOO_FAR: "Get into the crowd",
  TOO_FEW_BODIES: "Not enough people there to hide in",
  TOO_FAST: "Slow to a walk and they will close around you",
  WATCHED_IN: "He watched you walk in",
};

export interface CrowdReadout {
  /** [0,1]. At 1 a cone does not resolve the player at all. */
  strength: number;
  clusterId: string | null;
  pierced: boolean;
  piercedBy: string | null;
  /** Nearest cluster with enough bodies to hide anybody, and how far it is. */
  nearestId: string | null;
  nearestDistanceM: number;
  blocked: BlendBlocker;
}

// ---- reflex ----------------------------------------------------------------

export interface ReflexReadout {
  active: boolean;
  /** Fraction of the window spent, [0,1]. */
  progress: number;
  /** Seconds of REAL time left to react. World ticks are not what a player feels. */
  remainingRealS: number;
  charges: number;
  /** The watcher whose sighting is being held. Break this one's line. */
  watcherId: string | null;
  bearingRad: number | null;
}

// ---- the hunt --------------------------------------------------------------

/** What is keeping the hunt open, which is the same thing as what to do next. */
export type HuntHold = "NONE" | "STILL_SEEN" | "TOO_CLOSE";

export const HUNT_HOLD_LABEL: Readonly<Record<HuntHold, string>> = {
  NONE: "They have lost you",
  STILL_SEEN: "They can still see you",
  TOO_CLOSE: "Get away from here",
};

export interface HuntReadout {
  active: boolean;
  /** Sightings this run. The hunt gets wider and longer with each one. */
  detections: number;
  /** Bearing from the player to the place they were caught: the way NOT to go. */
  originBearingRad: number | null;
  /** How far the player has got from it. */
  distanceM: number;
  /** How far they need to get. */
  escapeDistanceM: number;
  /**
   * Metres still to cover before the hunt can break, floored at zero.
   *
   * The one number that turns a consequence into an instruction. "You were seen"
   * is a notification; "eleven more metres" is something to do about it.
   */
  metresToClear: number;
  /** Seconds before the hunt gives up on its own, if the player never gets clear. */
  secondsRemaining: number;
  hold: HuntHold;
}

function huntReadout(
  hunt: HuntState,
  playerPosition: Vec3,
  anyContact: boolean,
  tuning: StealthTuning,
): HuntReadout {
  if (!hunt.active) {
    return {
      active: false,
      detections: hunt.detections,
      originBearingRad: null,
      distanceM: Infinity,
      escapeDistanceM: 0,
      metresToClear: 0,
      secondsRemaining: 0,
      hold: "NONE",
    };
  }
  const distanceM = huntDistanceM(hunt, playerPosition);
  return {
    active: true,
    detections: hunt.detections,
    originBearingRad: bearingTo(playerPosition, hunt.origin),
    distanceM,
    escapeDistanceM: hunt.escapeDistanceM,
    metresToClear: Math.max(0, hunt.escapeDistanceM - distanceM),
    secondsRemaining: hunt.ticksRemaining / FIELD_TICK_HZ,
    hold:
      anyContact || hunt.clearTicks < tuning.huntBreakTicks
        ? "STILL_SEEN"
        : distanceM < hunt.escapeDistanceM
          ? "TOO_CLOSE"
          : "NONE",
  };
}

// ---- the whole thing -------------------------------------------------------

/** A confirmed sighting, latched so the HUD can still explain it afterwards. */
export interface SightingRecord {
  watcherId: string;
  tick: number;
  cause: DetectionCause;
  distanceM: number;
}

export interface StealthReadout {
  squadState: AlertState;
  /**
   * Continuous escalation, [0,1], so a ring climbs instead of snapping between
   * five words. The discrete state is still published; this is what makes the
   * approach to a threshold visible before it is crossed.
   */
  escalation01: number;
  suspicion: number;
  /** Rising, steady or falling. The one bit that answers "am I getting away with it". */
  trend: -1 | 0 | 1;
  /** The watcher driving the current suspicion. */
  primaryWatcherId: string | null;
  /** Why that watcher can see the player, or why they cannot. */
  cause: DetectionCause;
  /** Bearing to the primary watcher, or null when nobody is resolving anybody. */
  threatBearingRad: number | null;
  watchers: WatcherReadout[];
  crowd: CrowdReadout;
  reflex: ReflexReadout;
  /** The search the player is currently inside, and how to get out of it. */
  hunt: HuntReadout;
  diversions: { charges: number; live: number };
  lastSighting: SightingRecord | null;
}

/**
 * How far along the ladder each state sits, before suspicion is folded in.
 *
 * SEARCHING is placed below INVESTIGATING on purpose: a watcher who has lost the
 * player is a better situation than one closing on a live contact, even though
 * the search is downstream of the sighting.
 */
const STATE_FLOOR: Readonly<Record<AlertState, number>> = {
  UNAWARE: 0,
  CURIOUS: 0.3,
  SEARCHING: 0.5,
  INVESTIGATING: 0.65,
  ALERTED: 1,
};

export function alertEscalation01(
  state: AlertState,
  suspicion: number,
): number {
  return clamp01(Math.max(STATE_FLOOR[state], suspicion));
}

export function bearingTo(from: Vec3, to: Vec3): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export interface ReadoutInput {
  playerPosition: Vec3;
  motion: PlayerMotionRead;
  watchers: readonly WatcherAlert[];
  /** Pose per watcher, in the same identity space. Missing poses are skipped. */
  poses: ReadonlyMap<
    string,
    { position: Vec3; halfAngleRad: number; rangeM: number }
  >;
  visibility: readonly { id: string; result: VisibilityResult }[];
  crowd: CrowdBlendState;
  clusters: readonly CrowdCluster[];
  playerSpeedMps: number;
  reflex: ReflexState;
  hunt: HuntState;
  diversionCharges: number;
  diversionsLive: number;
  /** Peak suspicion on the previous tick, for the trend. */
  previousSuspicion: number;
  lastSighting: SightingRecord | null;
}

/** Everything a player needs to read the situation. Derived; never authoritative. */
export function stealthReadout(
  input: ReadoutInput,
  tuning: StealthTuning = STEALTH_TUNING,
): StealthReadout {
  const byId = new Map(input.visibility.map((entry) => [entry.id, entry.result]));

  const watchers: WatcherReadout[] = [];
  let squadState: AlertState = "UNAWARE";
  let peak = 0;
  let primary: WatcherReadout | null = null;

  for (const alert of input.watchers) {
    const pose = input.poses.get(alert.id);
    if (!pose) continue;
    const result = byId.get(alert.id);
    const visibility = result?.visibility ?? 0;
    const readout: WatcherReadout = {
      id: alert.id,
      position: pose.position,
      yaw: alert.yaw,
      halfAngleRad: pose.halfAngleRad,
      rangeM: pose.rangeM,
      state: alert.state,
      suspicion: alert.suspicion,
      visibility,
      distanceM: result?.distanceM ?? Infinity,
      bearingRad: bearingTo(input.playerPosition, pose.position),
      contact: visibility > tuning.minAccrualVisibility,
      cause: result
        ? detectionCause(result, input.motion, tuning)
        : "NO_CONTACT",
      callInTicks:
        alert.state === "ALERTED" && alert.firstHand && !alert.called
          ? alert.callTicks
          : null,
    };
    watchers.push(readout);

    if (STATE_FLOOR[alert.state] > STATE_FLOOR[squadState]) {
      squadState = alert.state;
    }
    // The watcher the player should be worrying about: whoever is closest to
    // certainty, and among equals whoever can actually see them.
    if (
      !primary ||
      alert.suspicion > primary.suspicion + 1e-9 ||
      (Math.abs(alert.suspicion - primary.suspicion) <= 1e-9 &&
        visibility > primary.visibility)
    ) {
      primary = readout;
    }
    peak = Math.max(peak, alert.suspicion);
  }

  const delta = peak - input.previousSuspicion;
  const trend: -1 | 0 | 1 = delta > 1e-6 ? 1 : delta < -1e-6 ? -1 : 0;

  const reflexWatcher = input.reflex.pendingWatcherId
    ? watchers.find((entry) => entry.id === input.reflex.pendingWatcherId)
    : undefined;

  return {
    squadState,
    escalation01: alertEscalation01(squadState, peak),
    suspicion: peak,
    trend,
    primaryWatcherId: primary?.id ?? null,
    cause: primary?.cause ?? "NO_CONTACT",
    threatBearingRad: primary?.bearingRad ?? null,
    watchers,
    crowd: crowdReadout(input, tuning),
    reflex: {
      active: input.reflex.active,
      progress: input.reflex.active
        ? 1 - input.reflex.remainingTicks / tuning.reflexWindowTicks
        : 0,
      remainingRealS: input.reflex.active
        ? input.reflex.remainingTicks / FIELD_TICK_HZ / tuning.reflexTimeScale
        : 0,
      charges: input.reflex.charges,
      watcherId: input.reflex.pendingWatcherId,
      bearingRad: reflexWatcher?.bearingRad ?? null,
    },
    hunt: huntReadout(
      input.hunt,
      input.playerPosition,
      watchers.some((entry) => entry.contact),
      tuning,
    ),
    diversions: {
      charges: input.diversionCharges,
      live: input.diversionsLive,
    },
    lastSighting: input.lastSighting,
  };
}

/**
 * The crowd, and specifically why it is not working.
 *
 * A blend that silently fails to take is the least legible thing in the stealth
 * model: the player walked into a crowd of people and stayed visible, and the
 * three reasons that can happen — too few bodies, too much speed, and a guard
 * who watched them arrive — are indistinguishable from outside. Naming which one
 * is the whole difference between a mechanic and a superstition.
 */
function crowdReadout(input: ReadoutInput, tuning: StealthTuning): CrowdReadout {
  let nearestId: string | null = null;
  let nearestDistanceM = Infinity;
  let sparseWithin = false;
  for (const cluster of input.clusters) {
    const distance = Math.hypot(
      cluster.x - input.playerPosition.x,
      cluster.z - input.playerPosition.z,
    );
    if (cluster.density < tuning.crowdBlendMinDensity) {
      if (distance <= cluster.radiusM) sparseWithin = true;
      continue;
    }
    if (distance < nearestDistanceM) {
      nearestDistanceM = distance;
      nearestId = cluster.id;
    }
  }

  const inside =
    nearestId !== null &&
    nearestDistanceM <=
      (input.clusters.find((cluster) => cluster.id === nearestId)?.radiusM ?? 0);

  let blocked: BlendBlocker = "NONE";
  if (input.crowd.pierced) blocked = "WATCHED_IN";
  else if (input.crowd.strength >= 1) blocked = "NONE";
  else if (inside && input.playerSpeedMps > tuning.crowdBlendMaxSpeedMps) {
    blocked = "TOO_FAST";
  } else if (inside) blocked = "NONE";
  else if (sparseWithin) blocked = "TOO_FEW_BODIES";
  else if (nearestId !== null) blocked = "TOO_FAR";
  else blocked = "NO_CLUSTER";

  return {
    strength: input.crowd.strength,
    clusterId: input.crowd.clusterId,
    pierced: input.crowd.pierced,
    piercedBy: input.crowd.piercedBy,
    nearestId,
    nearestDistanceM: Number.isFinite(nearestDistanceM) ? nearestDistanceM : Infinity,
    blocked,
  };
}
