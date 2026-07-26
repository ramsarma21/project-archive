// One fixed step of the whole stealth field.
//
// Composition, in the order the systems have to run:
//
//   1. thrown objects fly and land, producing noise where they actually landed;
//   2. crowd blending ramps, using last tick's contacts to decide whether a
//      watcher saw the player join the crowd;
//   3. each watcher's attention turns — toward a noise, toward a last-known
//      position — BEFORE anything is evaluated, so a diversion works by moving
//      the cone rather than by excusing the player from it;
//   4. visibility is resolved against those turned cones;
//   5. suspicion and alert states step;
//   6. a first sighting is intercepted by reflex time and HELD at the brink
//      instead of cashed in;
//   7. shouts propagate to the squad.
//
// This is the only stealth entry point a mission needs, and it runs inside the
// single fixed-step loop that advanceFieldClock drives. It owns no clock, reads
// no wall time, and draws randomness only from the shared seeded kernel.
//
// It deliberately does NOT move watchers. Patrol routes and pathing belong to the
// level and AI layers; this system consumes a pose per watcher per tick and hands
// back the facing those watchers should actually be using.

import { STAND_HEIGHT, type CollisionWorld, type Vec3 } from "../collision.js";
import {
  createWatcherAlert,
  propagateCalls,
  squadAlertState,
  squadSuspicion,
  stepWatcherAlert,
  stepWatcherAttention,
  type AlertCall,
  type AlertState,
  type AlertTransition,
  type WatcherAlert,
} from "./alert.js";
import {
  createCrowdBlendState,
  stepCrowdBlend,
  type CrowdBlendState,
  type CrowdCluster,
} from "./crowd.js";
import {
  createDiversionInventory,
  stepDiversions,
  throwDiversion,
  type DiversionActor,
  type DiversionInventory,
} from "./diversion.js";
import {
  createHuntState,
  stepHunt,
  watcherIsHunting,
  type HuntState,
} from "./hunt.js";
import {
  resolveInvokedAbility,
  type InvokedAbilityEffect,
} from "./invokedAbility.js";
import type { NoiseEvent } from "./noise.js";
import {
  detectionCause,
  stealthReadout,
  type SightingRecord,
  type StealthReadout,
} from "./readout.js";
import {
  createReflexState,
  stepReflex,
  type ReflexOutcome,
  type ReflexState,
} from "./reflex.js";
import {
  STEALTH_TUNING,
  type PlayerExposure,
  type StealthTuning,
} from "./tuning.js";
import {
  motionReadFor,
  visibility,
  type VisibilityResult,
} from "./vision.js";

/** A watcher's pose this tick. Movement is owned by the level/AI layer. */
export interface WatcherPose {
  id: string;
  position: Vec3;
  /** Patrol or post facing, before attention. */
  baseYaw: number;
  /** Body height; defaults to standing. Drives the eye landmark. */
  capsuleHeight?: number;
  halfAngleRad?: number;
  rangeM?: number;
  /** Colliders LOS should ignore, e.g. the guard box the watcher stands in. */
  ignore?: ReadonlySet<string>;
}

/**
 * What the movement layer reports about the player this tick. `capsuleHeight`
 * comes straight off MotionState — there is no separate stance flag, so what a
 * patrol resolves and what the collision capsule occupies cannot drift apart.
 */
export interface PlayerStealthRead {
  position: Vec3;
  capsuleHeight: number;
  speedMps: number;
  sprinting: boolean;
  /** True while an authored traversal verb is running: traversal is conspicuous. */
  traversing: boolean;
  /** Authored cover state at the player's position. */
  exposure: PlayerExposure;
  /** True while hard cover sits between the player and the nearest watcher. */
  covered: boolean;
  /** Authored light level, [0,1]. */
  lightLevel: number;
}

export interface StealthFieldState {
  watchers: WatcherAlert[];
  reflex: ReflexState;
  crowd: CrowdBlendState;
  diversions: DiversionInventory;
  /**
   * The squad's search of the place the player was last caught.
   *
   * This is what being seen costs outside the final court, and the reason there
   * is a cost at all. See hunt.ts.
   */
  hunt: HuntState;
  /** Contacts from the previous tick, used by the crowd pierce rule. */
  previousContacts: { id: string; distanceM: number }[];
  /** Peak suspicion last tick, so the readout can say whether it is rising. */
  previousSuspicion: number;
  /**
   * The last confirmed sighting and the reason for it, latched.
   *
   * Detection is a single tick. By the time a player has finished reacting to
   * being caught, the geometry that caught them has moved and the factors that
   * produced it are gone, so a HUD that only reads the live field can never
   * answer "what did I do wrong". Holding the answer is the difference between
   * a mistake the player learns from and one they merely suffer.
   */
  lastSighting: SightingRecord | null;
}

export function createStealthFieldState(
  watcherIds: readonly string[],
  tuning: StealthTuning = STEALTH_TUNING,
): StealthFieldState {
  return {
    watchers: watcherIds.map((id) => createWatcherAlert(id)),
    reflex: createReflexState(tuning),
    crowd: createCrowdBlendState(),
    diversions: createDiversionInventory(tuning),
    hunt: createHuntState(),
    previousContacts: [],
    previousSuspicion: 0,
    lastSighting: null,
  };
}

export interface StealthFieldInput {
  /** Fixed step. Always FIELD_DT. */
  dt: number;
  /** Monotonic fixed-step tick index from the shared clock. */
  tick: number;
  /** Per-attempt seed from the shared clock. */
  seed: number;
  watchers: readonly WatcherPose[];
  player: PlayerStealthRead;
  clusters: readonly CrowdCluster[];
  /**
   * Bodies other than the watchers that a thrown object can strike.
   *
   * Civilians, chiefly. Actors are deliberately absent from the CollisionWorld —
   * they must not occlude sightlines or block traversal — so passing them here is
   * the only way an object in flight can hit one, and without this field a
   * bottle went straight through a market crowd no matter what a mission wanted.
   * No level could have made its civilians solid; the capability did not exist.
   *
   * WHAT THIS IS AND IS NOT WORTH, measured rather than assumed: at the tuned
   * 14 m/s launch the solver picks the flatter of the two arcs, which still
   * clears head height for the first fifteen metres — an 18 m throw passes about
   * 3.15 m over somebody standing four metres away. So a screen of bodies blocks
   * a genuinely SHORT throw and nothing else. That is the better mechanic of the
   * two available: a good loft sails over the crowd, and a panicked toss at the
   * feet of the person in front of you hits them. It does mean "bodies block
   * throws" is a close-range rule, and the diversion's value at range comes from
   * where it lands rather than from what is in the way.
   */
  bodies?: readonly DiversionActor[];
  /** Noise produced elsewhere this tick, chiefly by the parkour layer. */
  noise: readonly NoiseEvent[];
  /** Reflex time off: reduced motion, or an accessibility opt-out. */
  reflexDisabled: boolean;
  /** Suspend all accrual: the mission has not started, or a cutscene owns time. */
  suspendAccrual: boolean;
  /**
   * Effects an INVOKED ability is applying this tick. Absent means none, and means
   * this function behaves exactly as it did before the field existed.
   *
   * Only `visibilityScale` is read here; concealment is true for precisely as long
   * as the window is open, so it is a per-tick input. `diversionAttentionScale` is
   * consumed at the throw instead — see `throwFieldDiversion`.
   *
   * This is NOT a difficulty term and stealth/invokedAbility.ts sets out why at
   * length: it is neutral until spent, bounded in time, and identical for two
   * players in identical geometry. The tuning table still carries no per-player key
   * and this does not add one.
   */
  invokedAbility?: InvokedAbilityEffect;
}

export type StealthEventType =
  | "reflexOpened"
  | "reflexEscaped"
  | "reflexConfirmed"
  | "detected"
  | "crowdBlended"
  | "crowdPierced"
  /** A thrown object hit a body instead of reaching where it was aimed. */
  | "throwStruckBody"
  | "huntOpened"
  | "huntBroken";

export interface StealthEvent {
  type: StealthEventType;
  watcherId?: string;
  clusterId?: string;
  /** The body a thrown object struck. */
  actorId?: string;
  /** Why a hunt ended: the player got clear, or it simply ran out. */
  reason?: string;
}

export interface StealthFieldResult {
  state: StealthFieldState;
  /** Facing each watcher should actually render and act with. */
  facings: { id: string; yaw: number }[];
  /** Per-watcher visibility, in watcher order. */
  visibility: { id: string; result: VisibilityResult }[];
  transitions: AlertTransition[];
  calls: AlertCall[];
  events: StealthEvent[];
  /** Noise heard this tick, including noise the field produced itself. */
  noise: NoiseEvent[];
  /**
   * Scale to apply to the NEXT render frame delta before advanceFieldClock.
   * 1 unless reflex time is open.
   */
  timeScale: number;
  reflexOutcome: ReflexOutcome;
  /** Loudest state in the squad. */
  squadState: AlertState;
  /** Peak suspicion, for the detection pip. */
  suspicion: number;
  /** True on the tick a sighting is confirmed and cannot be taken back. */
  detected: boolean;
  /**
   * The same tick, told from the player's point of view: who, where, why, and
   * which way it is trending. Everything a HUD should be reading.
   */
  readout: StealthReadout;
}

/** One fixed step of the stealth field. */
export function stepStealthField(
  world: CollisionWorld,
  stateIn: StealthFieldState,
  input: StealthFieldInput,
  tuning: StealthTuning = STEALTH_TUNING,
): StealthFieldResult {
  const events: StealthEvent[] = [];
  const transitions: AlertTransition[] = [];
  const calls: AlertCall[] = [];
  const invoked = resolveInvokedAbility(input.invokedAbility);

  // 1. Thrown objects. Every body in the scene is passed in as an actor so an
  // object can strike one — actors are absent from the CollisionWorld by design,
  // so this is the only way an object can hit anybody at all.
  //
  // The list is built only when something is actually in flight. `stepDiversions`
  // already no-ops on an empty inventory, and allocating an actor per watcher per
  // civilian sixty times a second for a bottle nobody threw is the kind of cost
  // that does not show up until a crowd is on screen.
  const thrown = stepDiversions(
    world,
    stateIn.diversions,
    input.dt,
    tuning,
    stateIn.diversions.live.length === 0
      ? EMPTY_ACTORS
      : [
          ...input.watchers.map((pose) => ({
            id: pose.id,
            pos: pose.position,
            capsuleHeight: pose.capsuleHeight ?? STAND_HEIGHT,
          })),
          ...(input.bodies ?? EMPTY_ACTORS),
        ],
  );
  const noise: NoiseEvent[] = [...input.noise, ...thrown.noise];
  for (const actorId of thrown.hitActorIds) {
    events.push({ type: "throwStruckBody", actorId });
  }

  // 2. Crowd blending, against last tick's contacts.
  const wasBlended = stateIn.crowd.strength >= 1;
  const crowd = stepCrowdBlend(
    stateIn.crowd,
    {
      playerPosition: input.player.position,
      speedMps: input.player.speedMps,
      clusters: input.clusters,
      watchersWithContact: stateIn.previousContacts,
    },
    tuning,
  );
  if (!wasBlended && crowd.strength >= 1) {
    events.push({ type: "crowdBlended", clusterId: crowd.clusterId ?? undefined });
  }
  if (crowd.pierced && !stateIn.crowd.pierced) {
    events.push({
      type: "crowdPierced",
      clusterId: crowd.clusterId ?? undefined,
      watcherId: crowd.piercedBy ?? undefined,
    });
  }

  const motion = motionReadFor({
    speedMps: input.player.speedMps,
    capsuleHeight: input.player.capsuleHeight,
    sprinting: input.player.sprinting,
    traversing: input.player.traversing,
  });

  const poseById = new Map(input.watchers.map((pose) => [pose.id, pose]));
  const positions = new Map<string, Vec3>(
    input.watchers.map((pose) => [pose.id, pose.position]),
  );

  const facings: { id: string; yaw: number }[] = [];
  const visibilities: { id: string; result: VisibilityResult }[] = [];
  const contacts: { id: string; distanceM: number }[] = [];
  let stepped: WatcherAlert[] = [];
  let firstHandSightingWatcherId: string | null = null;

  // 3-5. Attention, then visibility, then suspicion and state.
  for (const alertIn of stateIn.watchers) {
    const pose = poseById.get(alertIn.id);
    if (!pose) {
      stepped.push(alertIn);
      facings.push({ id: alertIn.id, yaw: alertIn.yaw });
      visibilities.push({ id: alertIn.id, result: NO_CONTACT });
      continue;
    }

    const attended = stepWatcherAttention(
      alertIn,
      {
        dt: input.dt,
        tick: input.tick,
        seed: input.seed,
        position: pose.position,
        baseYaw: pose.baseYaw,
        noise,
      },
      tuning,
    );
    facings.push({ id: attended.id, yaw: attended.yaw });

    const result = visibility(
      world,
      {
        position: pose.position,
        forwardX: Math.sin(attended.yaw),
        forwardZ: Math.cos(attended.yaw),
        capsuleHeight: pose.capsuleHeight,
        halfAngleRad: pose.halfAngleRad,
        rangeM: pose.rangeM,
        ignore: pose.ignore,
      },
      {
        position: input.player.position,
        capsuleHeight: input.player.capsuleHeight,
        exposure: input.player.exposure,
        motion,
        covered: input.player.covered,
        lightLevel: input.player.lightLevel,
        crowdBlend: crowd.strength,
        abilityVisibilityScale: invoked.visibilityScale,
      },
      tuning,
    );
    visibilities.push({ id: attended.id, result });
    if (result.visibility > tuning.minAccrualVisibility) {
      contacts.push({ id: attended.id, distanceM: result.distanceM });
    }

    // The pending watcher's certainty is frozen while its window is open.
    const held =
      stateIn.reflex.active && stateIn.reflex.pendingWatcherId === attended.id;
    // Last tick's hunt, because the hunt this tick may be opened by a sighting
    // that has not happened yet at this point in the step.
    const hunting =
      !input.suspendAccrual && watcherIsHunting(stateIn.hunt, pose.position);
    const alertStep = stepWatcherAlert(
      attended,
      {
        dt: input.dt,
        visibility: result.visibility,
        playerPosition: input.player.position,
        position: pose.position,
        noise,
        suspendAccrual: input.suspendAccrual || held,
        holdBelowAlerted: held,
        hunt: hunting
          ? {
              floor: tuning.huntSuspicionFloor,
              origin: stateIn.hunt.origin,
            }
          : null,
      },
      tuning,
    );

    const sighting = alertStep.transitions.find(
      (candidate) => candidate.to === "ALERTED" && candidate.cause === "SIGHT",
    );
    if (sighting && firstHandSightingWatcherId === null) {
      firstHandSightingWatcherId = sighting.watcherId;
    }
    transitions.push(...alertStep.transitions);
    if (alertStep.call) calls.push(alertStep.call);
    stepped.push(alertStep.alert);
  }

  // 6. Reflex time.
  //
  // "Hot" means somebody ELSE already knew something was wrong. The watcher doing
  // the sighting is necessarily INVESTIGATING on the tick before it confirms, so
  // counting it here would make a window impossible to ever open.
  const areaAlreadyHot = stateIn.watchers.some(
    (alert) =>
      alert.id !== firstHandSightingWatcherId &&
      (alert.state === "INVESTIGATING" || alert.state === "ALERTED"),
  );
  const pendingVisibility =
    visibilities.find(
      (entry) => entry.id === stateIn.reflex.pendingWatcherId,
    )?.result.visibility ?? 0;
  const reflexStep = stepReflex(
    stateIn.reflex,
    {
      tick: input.tick,
      firstHandSightingWatcherId,
      areaAlreadyHot,
      disabled: input.reflexDisabled,
      pendingVisibility,
    },
    tuning,
  );

  if (reflexStep.opened && firstHandSightingWatcherId) {
    // Hold the sighting at the brink: the watcher is certain enough to be about
    // to confirm, and is not allowed to confirm until the window resolves. The
    // ALERTED transition is withdrawn, not reported, so nothing downstream reacts
    // to a detection that has not happened yet.
    const index = transitions.findIndex(
      (candidate) =>
        candidate.watcherId === firstHandSightingWatcherId &&
        candidate.to === "ALERTED",
    );
    if (index >= 0) transitions.splice(index, 1);
    const callIndex = calls.findIndex(
      (candidate) => candidate.fromId === firstHandSightingWatcherId,
    );
    if (callIndex >= 0) calls.splice(callIndex, 1);
    stepped = stepped.map((alert) =>
      alert.id === firstHandSightingWatcherId
        ? {
            ...alert,
            state: "INVESTIGATING",
            stateTicks: 0,
            suspicion: tuning.thresholds.alerted,
            firstHand: true,
            called: false,
          }
        : alert,
    );
    events.push({
      type: "reflexOpened",
      watcherId: firstHandSightingWatcherId,
    });
  }

  const pendingId = stateIn.reflex.pendingWatcherId;
  if (reflexStep.outcome === "ESCAPED" || reflexStep.outcome === "EXPIRED") {
    stepped = stepped.map((alert) =>
      alert.id === pendingId
        ? {
            ...alert,
            state: "SEARCHING",
            stateTicks: 0,
            suspicion: Math.max(tuning.searchingFloor, tuning.thresholds.investigating),
            firstHand: false,
            called: false,
          }
        : alert,
    );
    if (pendingId) {
      transitions.push({
        watcherId: pendingId,
        from: "INVESTIGATING",
        to: "SEARCHING",
        cause: "LOSE_CONTACT",
      });
      events.push({ type: "reflexEscaped", watcherId: pendingId });
    }
  } else if (reflexStep.outcome === "CONFIRMED" && pendingId) {
    stepped = stepped.map((alert) =>
      alert.id === pendingId
        ? {
            ...alert,
            state: "ALERTED",
            stateTicks: 0,
            suspicion: 1,
            firstHand: true,
            called: false,
            callTicks: tuning.callDelayTicks,
          }
        : alert,
    );
    transitions.push({
      watcherId: pendingId,
      from: "INVESTIGATING",
      to: "ALERTED",
      cause: "SIGHT",
    });
    events.push({ type: "reflexConfirmed", watcherId: pendingId });
  }

  // 7. Shouts.
  const propagated = propagateCalls(stepped, positions, calls, tuning);
  transitions.push(...propagated.transitions);

  const sighting = transitions.find(
    (candidate) => candidate.to === "ALERTED" && candidate.cause === "SIGHT",
  );
  const detected = sighting !== undefined;
  if (sighting) {
    events.push({ type: "detected", watcherId: sighting.watcherId });
  }

  // Latch the sighting WITH the reason for it, read off the factors that were
  // live on the tick it happened. A tick later the player has moved and the
  // answer is gone.
  let lastSighting = stateIn.lastSighting;
  if (sighting) {
    const seenBy = visibilities.find((entry) => entry.id === sighting.watcherId);
    lastSighting = {
      watcherId: sighting.watcherId,
      tick: input.tick,
      cause: seenBy
        ? detectionCause(seenBy.result, motion, tuning)
        : "NO_CONTACT",
      distanceM: seenBy?.result.distanceM ?? Infinity,
    };
  }

  // The hunt, stepped last because it is a consequence of everything above it.
  // A confirmed sighting anchors it to where the player was standing when it
  // happened, which is the place the squad will search — not wherever the player
  // has got to by the time the search is under way.
  // A suspended tick does not burn the hunt's clock. `suspendAccrual` means a
  // cutscene or a UI surface owns time and nobody is watching anybody; letting
  // the search wind down behind a pause menu would make waiting a strategy.
  const huntStep = input.suspendAccrual
    ? { hunt: stateIn.hunt, opened: false, broke: "NONE" as const }
    : stepHunt(
        stateIn.hunt,
        {
          tick: input.tick,
          detected,
          sightingPosition: input.player.position,
          playerPosition: input.player.position,
          anyContact: contacts.length > 0,
        },
        tuning,
      );
  if (huntStep.opened) {
    events.push({
      type: "huntOpened",
      watcherId: sighting?.watcherId,
      reason: `${huntStep.hunt.detections} sighting(s) this run`,
    });
  }
  if (huntStep.broke !== "NONE") {
    events.push({ type: "huntBroken", reason: huntStep.broke });
  }

  const suspicion = squadSuspicion(propagated.alerts);
  const state: StealthFieldState = {
    watchers: propagated.alerts,
    reflex: reflexStep.reflex,
    crowd,
    diversions: thrown.inventory,
    hunt: huntStep.hunt,
    previousContacts: contacts,
    previousSuspicion: suspicion,
    lastSighting,
  };

  return {
    state,
    facings,
    visibility: visibilities,
    transitions,
    calls,
    events,
    noise,
    timeScale: reflexStep.timeScale,
    reflexOutcome: reflexStep.outcome,
    squadState: squadAlertState(propagated.alerts),
    suspicion,
    detected,
    readout: stealthReadout(
      {
        playerPosition: input.player.position,
        motion,
        watchers: propagated.alerts,
        poses: new Map(
          input.watchers.map((pose) => [
            pose.id,
            {
              position: pose.position,
              halfAngleRad: pose.halfAngleRad ?? tuning.coneHalfAngleRad,
              rangeM: pose.rangeM ?? tuning.coneRangeM,
            },
          ]),
        ),
        visibility: visibilities,
        crowd,
        clusters: input.clusters,
        playerSpeedMps: input.player.speedMps,
        reflex: reflexStep.reflex,
        hunt: huntStep.hunt,
        diversionCharges: thrown.inventory.charges,
        diversionsLive: thrown.inventory.live.length,
        // Last tick's peak, so a HUD arrow points at what just changed.
        previousSuspicion: stateIn.previousSuspicion,
        lastSighting,
      },
      tuning,
    ),
  };
}

/** Shared so a tick with nothing in flight allocates nothing. */
const EMPTY_ACTORS: readonly DiversionActor[] = [];

const NO_CONTACT: VisibilityResult = {
  visibility: 0,
  inCone: false,
  hasLineOfSight: false,
  distanceM: Infinity,
  coneFactor: 0,
  distanceFactor: 0,
  exposureFactor: 0,
  motionFactor: 0,
  coverFactor: 0,
  lightFactor: 0,
  crowdFactor: 0,
  abilityFactor: 0,
};

/**
 * Throw a diversion object, returning the updated field state.
 *
 * `invokedAbility` is read HERE rather than in `stepStealthField` because the
 * attention scale is captured at the throw and then carried by the object for its
 * whole life. An ability arms a throw; it does not follow the bottle around.
 */
export function throwFieldDiversion(
  world: CollisionWorld,
  state: StealthFieldState,
  origin: Vec3,
  aim: Vec3,
  tuning: StealthTuning = STEALTH_TUNING,
  invokedAbility?: InvokedAbilityEffect,
): { state: StealthFieldState; thrown: boolean } {
  const result = throwDiversion(
    world,
    state.diversions,
    origin,
    aim,
    tuning,
    resolveInvokedAbility(invokedAbility).diversionAttentionScale,
  );
  return {
    state: { ...state, diversions: result.inventory },
    thrown: result.object !== null,
  };
}

/**
 * Presentation projection for the HUD. Deliberately narrow: everything a player
 * needs to read the situation, and nothing that would let the HUD drive it.
 */
export interface StealthPresentation {
  suspicion: number;
  squadState: AlertState;
  reflexActive: boolean;
  reflexCharges: number;
  reflexProgress: number;
  crowdBlend: number;
  diversionCharges: number;
  /** Watchers currently resolving the player, for cone/chevron tells. */
  contactIds: string[];
  /**
   * Who, where, why, and which way it is going.
   *
   * Optional only so that a caller holding a literal of this type keeps
   * compiling; `stealthPresentation` always fills it. Everything above this line
   * is a number a HUD can draw, and none of it answers the question a player
   * actually asks when they are caught.
   */
  readout?: StealthReadout;
}

export function stealthPresentation(
  state: StealthFieldState,
  result: StealthFieldResult,
  tuning: StealthTuning = STEALTH_TUNING,
): StealthPresentation {
  return {
    suspicion: result.suspicion,
    squadState: result.squadState,
    reflexActive: state.reflex.active,
    reflexCharges: state.reflex.charges,
    reflexProgress: state.reflex.active
      ? 1 - state.reflex.remainingTicks / tuning.reflexWindowTicks
      : 0,
    crowdBlend: state.crowd.strength,
    diversionCharges: state.diversions.charges,
    contactIds: state.previousContacts.map((contact) => contact.id),
    readout: result.readout,
  };
}
