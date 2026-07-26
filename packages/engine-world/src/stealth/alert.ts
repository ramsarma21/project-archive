// Alert escalation and the systemic response.
//
// A watcher is not a boolean. It notices, it looks, it walks over to check, it
// searches where it last saw you, it shouts and pulls its neighbours in, and it
// stands down. That ladder is what makes being nearly-seen interesting, and it is
// what makes a diversion or a crowd worth using.
//
//   UNAWARE -> CURIOUS -> INVESTIGATING -> ALERTED
//                  ^            |             |
//                  +-- SEARCHING <------------+
//
// Escalation is systemic: a first-hand sighting produces a shout after a beat,
// and every watcher inside the shout radius escalates to INVESTIGATING with the
// caller's last-known position. Called watchers cannot themselves call, so the
// response is bounded and cannot cascade across a whole level from one contact.
//
// Nothing here scales with anything about the player. The only randomness is the
// search drift, drawn from the shared seeded kernel.

import type { Vec3 } from "../collision.js";
import { fieldRandom, projectFieldSeed } from "../fieldSimulation.js";
import { invokedAbilityScale } from "./invokedAbility.js";
import {
  noiseAudibility,
  noiseImplicatesPlayer,
  type NoiseEvent,
} from "./noise.js";
import { STEALTH_TUNING, type StealthTuning } from "./tuning.js";
import { clamp01, shortestAngleDelta, turnTowardYaw, yawToward } from "./vision.js";

export type AlertState =
  | "UNAWARE"
  | "CURIOUS"
  | "INVESTIGATING"
  | "SEARCHING"
  | "ALERTED";

export type AlertCause =
  | "SIGHT"
  | "NOISE"
  | "CALL"
  | "LOSE_CONTACT"
  | "SEARCH_TIMEOUT"
  | "STAND_DOWN";

export interface AlertTransition {
  watcherId: string;
  from: AlertState;
  to: AlertState;
  cause: AlertCause;
}

export interface WatcherAlert {
  id: string;
  state: AlertState;
  /** [0,1]. Crosses 1 exactly when the watcher is certain. */
  suspicion: number;
  /** Ticks spent in the current state. */
  stateTicks: number;
  /** Consecutive ticks with no visual contact. */
  noContactTicks: number;
  /** Where the player was last seen. Drives investigate and search. */
  lastKnown: Vec3 | null;
  /** Where this watcher is looking or heading. */
  attention: Vec3 | null;
  /** True when `attention` came from a diversion rather than a sighting. */
  attentionIsDiversion: boolean;
  /** Ticks the current diversion attention survives. */
  attentionTicks: number;
  /** Effective facing after attention turning. */
  yaw: number;
  /** True when this watcher reached ALERTED through its own eyes. */
  firstHand: boolean;
  /** Ticks until the shout goes out. */
  callTicks: number;
  /** One shout per sighting. */
  called: boolean;
  /** Search look-around offset, in radians off the base facing. */
  searchYawOffset: number;
  /**
   * False until the first attention step has adopted the watcher's post facing.
   *
   * A fresh alert has no way to know which way its watcher is meant to be
   * looking — poses arrive per tick and the constructor takes ids — so without
   * this every watcher in the level starts facing north and spends the first
   * second of the mission visibly slewing to its post. The turn rate is there so
   * a diversion cannot snap a cone; it was never meant to animate a spawn.
   */
  yawInitialised: boolean;
}

export interface AlertCall {
  fromId: string;
  /** The position being called out. */
  x: number;
  y: number;
  z: number;
}

export function createWatcherAlert(id: string, yaw = 0): WatcherAlert {
  return {
    id,
    state: "UNAWARE",
    suspicion: 0,
    stateTicks: 0,
    noContactTicks: 0,
    lastKnown: null,
    attention: null,
    attentionIsDiversion: false,
    attentionTicks: 0,
    yaw,
    firstHand: false,
    callTicks: 0,
    called: false,
    searchYawOffset: 0,
    yawInitialised: false,
  };
}

/** Ticks between search look-around redraws. */
const SEARCH_DRIFT_PERIOD_TICKS = 42;
/** Widest search look-around offset. */
const SEARCH_DRIFT_RAD = 1.1;

export interface AttentionInput {
  dt: number;
  tick: number;
  seed: number;
  /** Watcher foot position this tick. Patrol movement is owned elsewhere. */
  position: Vec3;
  /** Patrol/post facing this tick, before any attention override. */
  baseYaw: number;
  /** Noise audible this tick. */
  noise: readonly NoiseEvent[];
}

/**
 * Update where a watcher is looking, before visibility is evaluated.
 *
 * Order matters and it is the whole trick of the diversion: the cone must have
 * already turned by the time visibility is computed, so a thrown object works by
 * physically moving the sightline rather than by setting a flag that excuses the
 * player from being seen.
 */
export function stepWatcherAttention(
  alert: WatcherAlert,
  input: AttentionInput,
  tuning: StealthTuning = STEALTH_TUNING,
): WatcherAlert {
  const next: WatcherAlert = { ...alert };

  if (next.attentionTicks > 0) next.attentionTicks -= 1;
  if (next.attentionTicks === 0 && next.attentionIsDiversion) {
    next.attention = null;
    next.attentionIsDiversion = false;
  }

  // Loudest audible diversion wins. A sighting-driven attention is never
  // overridden by a noise: eyes beat ears.
  //
  // SEARCHING is included, and that inclusion is what makes a thrown object
  // worth carrying. A searching watcher has, by definition, lost the player —
  // he is sweeping a place they are no longer — so a bottle landing forty feet
  // away is exactly the thing that should move him. Excluding him meant the
  // throw was inert in the one situation a player most wants it: the seconds
  // after a reflex-time escape, when a guard is combing the spot you just left
  // and the alternative to distracting him is holding still and hoping.
  //
  // ALERTED and INVESTIGATING are still deaf to it. Those two have a live
  // contact, and a diversion that could pull a guard off somebody he can
  // currently see would not be a trick, it would be an off switch.
  if (
    !next.lastKnown ||
    next.state === "UNAWARE" ||
    next.state === "CURIOUS" ||
    next.state === "SEARCHING"
  ) {
    let loudest: { noise: NoiseEvent; audibility: number } | null = null;
    for (const noise of input.noise) {
      if (noiseImplicatesPlayer(noise.kind)) continue;
      const audibility = noiseAudibility(noise, input.position.x, input.position.z);
      if (audibility < tuning.minAudibleNoise) continue;
      if (!loudest || audibility > loudest.audibility) {
        loudest = { noise, audibility };
      }
    }
    if (loudest) {
      next.attention = {
        x: loudest.noise.x,
        y: loudest.noise.y,
        z: loudest.noise.z,
      };
      next.attentionIsDiversion = true;
      // The hold is the authored one, scaled by whatever the noise itself carries.
      // A watcher does not know an ability exists; it knows this noise held its
      // interest longer, which is the only thing it needs to know.
      next.attentionTicks = Math.round(
        tuning.diversionHoldTicks *
          invokedAbilityScale(loudest.noise.attentionHoldScale ?? 1),
      );
    }
  }

  if (next.state === "SEARCHING") {
    const salt = projectFieldSeed([next.id]);
    const bucket = Math.floor(input.tick / SEARCH_DRIFT_PERIOD_TICKS);
    const draw = fieldRandom(input.seed, bucket, salt);
    next.searchYawOffset = (draw * 2 - 1) * SEARCH_DRIFT_RAD;
  } else {
    next.searchYawOffset = 0;
  }

  // A searching watcher looks where he last saw somebody, unless something just
  // made a noise somewhere else — then he looks there, which is the whole of the
  // diversion. The look-around drift rides on top of whichever it is.
  const searchFocus =
    next.attentionIsDiversion && next.attentionTicks > 0
      ? next.attention
      : next.lastKnown;
  const focus =
    next.state === "ALERTED" || next.state === "INVESTIGATING"
      ? next.lastKnown
      : next.state === "SEARCHING"
        ? searchFocus
        : next.attention;

  let targetYaw = input.baseYaw;
  if (focus) {
    targetYaw = yawToward(input.position, focus) + next.searchYawOffset;
  } else if (next.attention) {
    targetYaw = yawToward(input.position, next.attention);
  }
  // Adopt the post facing outright on the first step, and ONLY the post facing.
  // Snapping to anything the watcher has been drawn to would delete the rule
  // that a cone never jumps to a diversion; a watcher who happens to hear a
  // bottle on the very tick he spawns simply turns for it at the normal rate.
  if (!next.yawInitialised) {
    next.yawInitialised = true;
    if (!focus && !next.attention) {
      next.yaw = targetYaw;
      return next;
    }
  }
  next.yaw = turnTowardYaw(next.yaw, targetYaw, input.dt, tuning);
  return next;
}

export interface AlertStepInput {
  dt: number;
  /** Visibility computed with the attention-turned facing. */
  visibility: number;
  /** Player foot position, recorded as last-known on contact. */
  playerPosition: Vec3;
  /** Watcher foot position, for noise audibility. */
  position: Vec3;
  /** Noise audible this tick. */
  noise: readonly NoiseEvent[];
  /** Suspend accrual without freezing the watcher: used before a mission is live. */
  suspendAccrual: boolean;
  /**
   * Hold this watcher below ALERTED however certain it is. Reflex time uses this
   * to keep a sighting at the brink for the length of its window. Suspending
   * accrual alone is not enough: suspicion is already at the threshold, so the
   * state machine would confirm on the very next tick and the window would be
   * bypassed entirely.
   */
  holdBelowAlerted?: boolean;
  /**
   * This watcher is inside an open hunt.
   *
   * Two effects and no third. Suspicion cannot decay below `floor`, and a search
   * does not time out — so the area the player was seen in stays awake until the
   * hunt itself breaks, instead of quietly forgetting after nine seconds. The
   * watcher also adopts `origin` as somewhere to look if it has nothing better.
   *
   * NOTHING HERE TOUCHES ACCRUAL. A hunting watcher does not see faster, further
   * or through anything; it simply stays interested and keeps looking in the
   * right place. That is the whole of the distinction between the systemic
   * escalation this game keeps and the difficulty multiplier it deleted.
   */
  hunt?: { floor: number; origin: Vec3 } | null;
}

export interface AlertStepResult {
  alert: WatcherAlert;
  transitions: AlertTransition[];
  /** Emitted on the tick the shout goes out. */
  call: AlertCall | null;
}

function transition(
  alert: WatcherAlert,
  to: AlertState,
  cause: AlertCause,
  transitions: AlertTransition[],
  tuning: StealthTuning,
): void {
  if (alert.state === to) return;
  transitions.push({ watcherId: alert.id, from: alert.state, to, cause });
  alert.state = to;
  alert.stateTicks = 0;
  if (to === "ALERTED") {
    alert.callTicks = tuning.callDelayTicks;
  }
  if (to === "UNAWARE") {
    alert.lastKnown = null;
    alert.firstHand = false;
    alert.called = false;
  }
}

/**
 * One fixed step of a single watcher's suspicion and state.
 *
 * Suspicion rises from sight, and from noise the player made that the watcher
 * could hear. It decays only after a hold, so one frame of a passing cart is not
 * a reset. While searching it floors above zero, so ducking behind a crate for a
 * second does not make a guard forget he saw somebody.
 */
export function stepWatcherAlert(
  alertIn: WatcherAlert,
  input: AlertStepInput,
  tuning: StealthTuning = STEALTH_TUNING,
): AlertStepResult {
  const alert: WatcherAlert = { ...alertIn };
  const transitions: AlertTransition[] = [];
  alert.stateTicks += 1;

  const seeing = input.visibility > tuning.minAccrualVisibility;
  if (seeing) {
    alert.lastKnown = { ...input.playerPosition };
    alert.attentionIsDiversion = false;
    alert.attentionTicks = 0;
  }

  // Noise the player made is a second accrual channel: an unseen hard landing is
  // heard even when the cone never touched the player. The loudest audible event
  // this tick wins; noise does not stack.
  let noiseAccrual = 0;
  let noiseSource: Vec3 | null = null;
  for (const noise of input.noise) {
    if (!noiseImplicatesPlayer(noise.kind)) continue;
    const audibility = noiseAudibility(noise, input.position.x, input.position.z);
    if (audibility < tuning.minAudibleNoise) continue;
    const impulse = tuning.noiseSuspicionImpulse[noise.kind] * audibility;
    if (impulse > noiseAccrual) {
      noiseAccrual = impulse;
      noiseSource = { x: noise.x, y: noise.y, z: noise.z };
    }
  }

  // Audible noise counts as contact. Without this a watcher drawn in by repeated
  // noise is immediately downgraded to a search for "losing" a contact he never
  // had visually, and noise-driven investigation never actually happens.
  alert.noContactTicks = seeing || noiseAccrual > 0 ? 0 : alert.noContactTicks + 1;

  if (!input.suspendAccrual) {
    if (seeing) {
      const legible =
        (input.visibility - tuning.minAccrualVisibility) /
        (1 - tuning.minAccrualVisibility);
      alert.suspicion = clamp01(
        alert.suspicion + tuning.accrualPerSecond * legible * input.dt,
      );
    } else if (noiseAccrual > 0) {
      // The ceiling caps what noise can BUILD; it never pulls down certainty a
      // sighting already earned.
      const raised = clamp01(alert.suspicion + noiseAccrual);
      alert.suspicion =
        alert.suspicion >= tuning.noiseSuspicionCeiling
          ? alert.suspicion
          : Math.min(tuning.noiseSuspicionCeiling, raised);
      if (noiseSource && !alert.lastKnown) alert.lastKnown = noiseSource;
      if (noiseSource) {
        alert.attention = noiseSource;
        alert.attentionIsDiversion = false;
      }
    } else if (alert.noContactTicks > tuning.decayHoldTicks) {
      const floor = alert.state === "SEARCHING" ? tuning.searchingFloor : 0;
      alert.suspicion = Math.max(
        floor,
        alert.suspicion - tuning.decayPerSecond * input.dt,
      );
    }
  }

  // A hunting watcher does not calm down and does not stare at nothing. The
  // floor is applied after decay so it survives a quiet tick, and the origin is
  // adopted only when the watcher has no better idea of its own.
  if (input.hunt) {
    alert.suspicion = Math.max(alert.suspicion, input.hunt.floor);
    if (!alert.lastKnown) alert.lastKnown = { ...input.hunt.origin };
  }

  const { curious, investigating, alerted } = tuning.thresholds;
  switch (alert.state) {
    case "UNAWARE":
      if (alert.suspicion >= curious) {
        transition(
          alert,
          "CURIOUS",
          seeing ? "SIGHT" : "NOISE",
          transitions,
          tuning,
        );
      }
      break;
    case "CURIOUS":
      if (alert.suspicion >= investigating) {
        transition(
          alert,
          "INVESTIGATING",
          seeing ? "SIGHT" : "NOISE",
          transitions,
          tuning,
        );
      } else if (alert.suspicion < tuning.standDownSuspicion) {
        transition(alert, "UNAWARE", "STAND_DOWN", transitions, tuning);
      }
      break;
    case "INVESTIGATING":
      if (input.holdBelowAlerted) break;
      if (alert.suspicion >= alerted) {
        alert.firstHand = seeing;
        transition(
          alert,
          "ALERTED",
          seeing ? "SIGHT" : "NOISE",
          transitions,
          tuning,
        );
      } else if (alert.noContactTicks >= tuning.loseContactTicks) {
        transition(alert, "SEARCHING", "LOSE_CONTACT", transitions, tuning);
      } else if (alert.suspicion < curious) {
        transition(alert, "CURIOUS", "STAND_DOWN", transitions, tuning);
      }
      break;
    case "ALERTED":
      if (alert.noContactTicks >= tuning.loseContactTicks) {
        transition(alert, "SEARCHING", "LOSE_CONTACT", transitions, tuning);
      }
      break;
    case "SEARCHING":
      if (input.holdBelowAlerted) break;
      if (alert.suspicion >= alerted && seeing) {
        alert.firstHand = true;
        transition(alert, "ALERTED", "SIGHT", transitions, tuning);
      } else if (seeing && alert.suspicion >= investigating) {
        transition(alert, "INVESTIGATING", "SIGHT", transitions, tuning);
      } else if (!input.hunt && alert.stateTicks >= tuning.searchTicks) {
        // The search winds down on its own only when the squad is not hunting.
        // Timing out under an open hunt is what used to make being seen free.
        alert.suspicion = Math.min(alert.suspicion, curious);
        transition(alert, "CURIOUS", "SEARCH_TIMEOUT", transitions, tuning);
      }
      break;
  }

  // The shout. Only a first-hand sighting produces one, and only once. The timer
  // does not tick on the transition tick itself, so the delay between going
  // ALERTED and shouting is exactly callDelayTicks — that gap is the window a
  // player has to break away before the rest of the squad is told.
  let call: AlertCall | null = null;
  if (alert.state === "ALERTED" && alert.firstHand && !alert.called) {
    if (alert.callTicks > 0 && alert.stateTicks > 0) alert.callTicks -= 1;
    if (alert.callTicks === 0) {
      const point = alert.lastKnown ?? input.playerPosition;
      call = { fromId: alert.id, x: point.x, y: point.y, z: point.z };
      alert.called = true;
    }
  }

  return { alert, transitions, call };
}

/**
 * Apply shouts to the rest of the squad. A called watcher escalates to
 * INVESTIGATING with the caller's position as its last-known, and is marked
 * second-hand so it cannot shout in turn.
 */
export function propagateCalls(
  alerts: readonly WatcherAlert[],
  positions: ReadonlyMap<string, Vec3>,
  calls: readonly AlertCall[],
  tuning: StealthTuning = STEALTH_TUNING,
): { alerts: WatcherAlert[]; transitions: AlertTransition[] } {
  if (calls.length === 0) {
    return { alerts: [...alerts], transitions: [] };
  }
  const transitions: AlertTransition[] = [];
  const next = alerts.map((alert) => {
    if (alert.state === "ALERTED" || alert.state === "INVESTIGATING") {
      return alert;
    }
    const position = positions.get(alert.id);
    if (!position) return alert;
    let nearest: AlertCall | null = null;
    let nearestDistance = Infinity;
    for (const call of calls) {
      if (call.fromId === alert.id) continue;
      const distance = Math.hypot(call.x - position.x, call.z - position.z);
      if (distance > tuning.callRadiusM) continue;
      if (distance < nearestDistance) {
        nearest = call;
        nearestDistance = distance;
      }
    }
    if (!nearest) return alert;
    const escalated: WatcherAlert = {
      ...alert,
      lastKnown: { x: nearest.x, y: nearest.y, z: nearest.z },
      attention: { x: nearest.x, y: nearest.y, z: nearest.z },
      attentionIsDiversion: false,
      attentionTicks: 0,
      suspicion: Math.max(alert.suspicion, tuning.thresholds.investigating),
      firstHand: false,
      called: true,
      noContactTicks: 0,
    };
    transitions.push({
      watcherId: alert.id,
      from: alert.state,
      to: "INVESTIGATING",
      cause: "CALL",
    });
    escalated.state = "INVESTIGATING";
    escalated.stateTicks = 0;
    return escalated;
  });
  return { alerts: next, transitions };
}

/** The loudest state in a squad, for HUD and mission-outcome decisions. */
export function squadAlertState(alerts: readonly WatcherAlert[]): AlertState {
  const order: AlertState[] = [
    "UNAWARE",
    "CURIOUS",
    "SEARCHING",
    "INVESTIGATING",
    "ALERTED",
  ];
  let worst = 0;
  for (const alert of alerts) {
    worst = Math.max(worst, order.indexOf(alert.state));
  }
  return order[worst]!;
}

/** Highest suspicion in a squad, for the detection pip. */
export function squadSuspicion(alerts: readonly WatcherAlert[]): number {
  let peak = 0;
  for (const alert of alerts) peak = Math.max(peak, alert.suspicion);
  return peak;
}

/** Angular error between a watcher's facing and the player, for HUD chevrons. */
export function facingErrorToPlayer(
  alert: WatcherAlert,
  position: Vec3,
  playerPosition: Vec3,
): number {
  return Math.abs(
    shortestAngleDelta(alert.yaw, yawToward(position, playerPosition)),
  );
}
