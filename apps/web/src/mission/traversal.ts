import {
  beatPresentation,
  createBeatRun,
  inBeatStance,
  stepBeat,
  type BeatOutcome,
  type BeatPresentation,
  type BeatRun,
} from "@pa/beat";
import {
  FIELD_DT,
  type NoiseEvent,
  advanceFieldClock,
  createFieldClock,
  createFlowState,
  createGroundedState,
  createStealthFieldState,
  flowPresentation,
  freeMoveSpeed,
  isCrouched,
  projectFieldSeed,
  scaledFrameDt,
  stealthPresentation,
  stepFlow,
  stepStealthField,
  throwFieldDiversion,
  toggleFreeCrouch,
  type CrowdCluster,
  type DiversionObject,
  type FieldClock,
  type FlowPresentation,
  type FlowState,
  type MotionState,
  type PlayerStealthRead,
  type StealthFieldState,
  type StealthPresentation,
  type Vec3,
} from "@pa/engine-world";
import {
  dawnLightLevel,
  dawnRead,
  disperseAtDawn,
  type DawnRead,
} from "./dawn.js";
import type {
  MissionCivilian,
  MissionFieldRead,
  MissionInstance,
  MissionPlayerRead,
} from "./levelPort.js";
import type {
  MissionTraversalObservation,
  MissionTraversalOutcome,
} from "./result.js";

// ---------------------------------------------------------------------------
// The traversal runtime: three minutes of continuous parkour and stealth.
//
// One clock and one RNG, both @pa/engine-world's. This module creates a
// FieldClock from the attempt seed and advances it with the render frame delta;
// it reads no wall time, owns no interval, and every random draw the stealth
// field makes comes from the shared seeded kernel keyed on that clock's tick.
// The duel later runs on a seed projected from the same attempt seed, so the
// floor and the fight are one lineage rather than two.
//
// Dawn is that same clock, said out loud. The mission is the last three minutes
// of the night, so `runtime.dawn` is derived from the tick count and the level's
// own declared budget, and it is the ONE value the sky, the HUD and the stealth
// field's light term all read. See dawn.ts for why the clock takes tools away
// instead of ending the attempt; what happens here is only the two applications
// of it — the authored light is lifted toward daylight before the field reads it,
// and the crowds walk home out of the one list of civilian bodies.
//
// Zero knowledge checks by construction. There is nothing in this file that can
// present a question, and nothing that can stop the player to read. §1.2 of the
// slate makes that a structural law rather than a budget, and the way it is held
// structurally is that the mission runtime has no question surface at all.
//
// Civilians are physical. One list of bodies per tick feeds the thrown diversion,
// the crowd's density and the renderer, so a throw can be blocked by a person and
// the crowd cannot hide the player behind someone who is not drawn. Both of those
// are load-bearing and both fail silently if the list is empty; `crowdClustersFor`
// is why the density is counted here rather than authored, and the bodies reach
// the throw physics through the field's own `bodies` input.
//
// The precision beat runs INSIDE this loop, on the same tick, and its noise is
// concatenated into the array already handed to `stepStealthField`. That one
// spread is the whole integration of @pa/beat's central idea: a mistimed hammer
// stroke is an ordinary PLAYER_MOVE noise, so the field needed to learn nothing
// and a botched stroke turns a constable's attention onto the tree the player is
// standing in. The field is never suspended while the beat runs — a beat with
// detection paused is a rhythm minigame, and a beat inside a live field is a
// stealth mechanic.
//
// Mutable on purpose. This steps sixty times a second and a persistent
// structure per tick would allocate ten thousand objects a run, so the runtime is
// an object the caller holds behind a ref and this function mutates in place.
// Nothing here is React state; the discrete facts live in session.ts.
// ---------------------------------------------------------------------------

/** A semantic boundary worth reporting. Not a tick log: see the cap below. */
export interface MissionRuntimeEvent {
  readonly tick: number;
  readonly kind:
    | "OBJECTIVE_MET"
    | "DETECTED"
    | "REFLEX_OPENED"
    | "REFLEX_ESCAPED"
    | "HARD_LANDING"
    | "FLOW_REACHED"
    | "THROW_STRUCK_BODY"
    | "BEAT_RESOLVED";
  readonly detail: string;
}

/**
 * Recent events only.
 *
 * A three-minute run is 10,800 fixed steps. Keeping every event would grow an
 * array without bound across an attempt and across a session of attempts, which
 * is the same class of defect as leaking a scene — so this is a ring, and the
 * counters below are what survive into the result.
 */
const EVENT_RING = 48;

/** Shared so a mission with no crowd keeps a stable identity across ticks. */
const NO_CIVILIANS: readonly MissionCivilian[] = [];

/** Shared so a tick with no beat, or no stroke, allocates nothing. */
const NO_BEAT_NOISE: readonly NoiseEvent[] = [];

export interface MissionRuntime {
  readonly instance: MissionInstance;
  readonly seed: number;
  clock: FieldClock;
  motion: MotionState;
  flow: FlowState;
  stealth: StealthFieldState;
  /** Fixed steps executed. The mission clock, counted in ticks and never in ms. */
  ticks: number;
  /** Objective ids met, latched, in the order they were met. */
  satisfied: string[];
  /** Confirmed sightings. Reported; detection is not a fail axis of its own. */
  detections: number;
  /** Consecutive ticks the squad has been ALERTED. An authored fail clock. */
  alertedTicks: number;
  /** Scale for the NEXT frame delta. Reflex time, and the only time dilation. */
  timeScale: number;
  /**
   * The precision beat, or null for a level that authored none.
   *
   * One run per attempt, and its chart is derived once from the attempt seed. A
   * player who steps off the bough mid-chart abandons the run and gets a fresh
   * one on re-entry — derived from the SAME seed, so it is the same chart. That
   * is deliberate: re-seeding on re-entry would let a player leave and come back
   * until they drew an easy one, which would delete the skill expression.
   * `deriveChart` is pure, so re-deriving costs nothing and cannot drift.
   */
  beat: BeatRun | null;
  /** Seed the run and every re-entry are derived from. Fixed for the attempt. */
  readonly beatSeed: number;
  /** Set the tick the beat resolves or is abandoned. Read by the level. */
  beatOutcome: BeatOutcome | null;
  /** The beat's projection, refreshed by the step that produced it. */
  beatView: BeatPresentation | null;
  /**
   * How far into dawn this tick is, from the ticks and the level's budget.
   *
   * Refreshed by the step that produced it and read by everything downstream, so
   * the sky the player is looking at, the number on the HUD and the light term
   * the stealth field used are the same fact rather than three approximations.
   */
  dawn: DawnRead;
  /** This tick's civilian bodies, after dawn. The one list; see MissionCivilian. */
  civilians: readonly MissionCivilian[];
  /** The level's list this tick, before dawn sent anybody home. Memo key only. */
  dispersedFrom: readonly MissionCivilian[] | null;
  /** Which departure the memoised list is at. See `civiliansForTick`. */
  dispersedAt: number;
  /** Clusters with density counted from `civilians`. Never authored. */
  crowdClusters: readonly CrowdCluster[];
  /** Identity of the list `crowdClusters` was counted from, to skip recounting. */
  countedFrom: readonly MissionCivilian[] | null;
  /** Throws that struck a body instead of reaching their aim point. */
  throwsStruckBody: number;
  /**
   * The HUD's projection, refreshed by the step that produced it.
   *
   * Held rather than derived on read because `stealthPresentation` needs the
   * step's result and the runtime is not going to retain a whole
   * StealthFieldResult per tick just so a HUD can ask later.
   */
  stealthView: StealthPresentation;
  outcome: MissionTraversalOutcome | null;
  recentEvents: MissionRuntimeEvent[];
  /** Fixed steps the catch-up bound discarded. Surfaced rather than absorbed. */
  droppedSteps: number;
}

export interface MissionInputFrame {
  /** Render frame delta in seconds, unscaled. Reflex time is applied here. */
  readonly dtS: number;
  /** World-space movement intent. Magnitude is ignored; direction is not. */
  readonly moveX: number;
  readonly moveZ: number;
  readonly sprintHeld: boolean;
  readonly crouchHeld: boolean;
  /** A jump press latched since the last step. Consumed by the first tick. */
  readonly jumpBuffered: boolean;
  /**
   * A dash press latched since the last step. Consumed by the first tick.
   *
   * Optional so a caller that has not bound the key keeps compiling — which is
   * exactly how the burst went a whole build with no caller — but the container
   * binds it, from `TRAVERSAL_BINDINGS`, and every caller in this app passes it.
   */
  readonly dashBuffered?: boolean;
  /**
   * A strike press latched since the last step. Consumed by the first tick.
   *
   * EDGE TRIGGERED, and this is where that is owned. A held key delivered as
   * true every fixed step reads to the judge as sixty strokes a second, which it
   * would correctly score as fifty-nine strays.
   */
  readonly strikeBuffered?: boolean;
  readonly reducedMotion: boolean;
  /**
   * False while a UI surface owns input. Motion still integrates so the player
   * does not freeze mid-air, but the flow reader stops committing verbs and the
   * stealth field stops accruing — a paused player is not being watched.
   */
  readonly flowEnabled: boolean;
}

export interface MissionRuntimeStep {
  readonly steps: number;
  readonly outcome: MissionTraversalOutcome | null;
  /** True when a buffered jump was handed to the simulation this frame. */
  readonly jumpConsumed: boolean;
  /** True when a buffered dash was handed to the simulation this frame. */
  readonly dashConsumed: boolean;
  /** True when a buffered strike was handed to the beat this frame. */
  readonly strikeConsumed: boolean;
}

const CALM_STEALTH_VIEW: StealthPresentation = {
  suspicion: 0,
  squadState: "UNAWARE",
  reflexActive: false,
  reflexCharges: 0,
  reflexProgress: 0,
  crowdBlend: 0,
  diversionCharges: 0,
  contactIds: [],
};

export function createMissionRuntime(input: {
  instance: MissionInstance;
  seed: number;
}): MissionRuntime {
  const { instance } = input;
  const stealth = createStealthFieldState(instance.watcherIds);
  // Projected off the attempt seed rather than taken raw, so the chart draws
  // from its own stream instead of sharing the field's, and so two levels that
  // authored a beat on the same attempt seed do not draw the same rhythm.
  const beatSeed = instance.beat
    ? projectFieldSeed([input.seed, "beat", instance.beat.spec.id])
    : 0;
  return {
    instance,
    seed: input.seed,
    clock: createFieldClock(input.seed),
    motion: createGroundedState(instance.spawn.pos, instance.spawn.yaw),
    flow: createFlowState(),
    stealth,
    ticks: 0,
    satisfied: [],
    detections: 0,
    alertedTicks: 0,
    timeScale: 1,
    beat: instance.beat ? createBeatRun(instance.beat.spec, beatSeed) : null,
    beatSeed,
    beatOutcome: null,
    beatView: null,
    dawn: dawnRead(0, instance.traversalBudgetS),
    civilians: [],
    dispersedFrom: null,
    dispersedAt: -1,
    crowdClusters: [],
    countedFrom: null,
    throwsStruckBody: 0,
    stealthView: {
      ...CALM_STEALTH_VIEW,
      reflexCharges: stealth.reflex.charges,
      diversionCharges: stealth.diversions.charges,
    },
    outcome: null,
    recentEvents: [],
    droppedSteps: 0,
  };
}

function note(
  runtime: MissionRuntime,
  kind: MissionRuntimeEvent["kind"],
  detail: string,
): void {
  runtime.recentEvents.push({ tick: runtime.clock.tick, kind, detail });
  if (runtime.recentEvents.length > EVENT_RING) runtime.recentEvents.shift();
}

function playerRead(runtime: MissionRuntime): MissionPlayerRead {
  const { motion, flow } = runtime;
  return {
    pos: motion.pos,
    yaw: motion.yaw,
    speedMps: Math.hypot(motion.vel.x, motion.vel.z),
    capsuleHeight: motion.capsuleHeight,
    crouched: isCrouched(motion.capsuleHeight),
    grounded: motion.grounded,
    verb: flow.verb,
    tick: runtime.clock.tick,
    elapsedS: runtime.ticks * FIELD_DT,
  };
}

function stealthRead(
  runtime: MissionRuntime,
  read: MissionPlayerRead,
  traversing: boolean,
  sprinting: boolean,
): PlayerStealthRead {
  const { instance } = runtime;
  return {
    position: read.pos,
    capsuleHeight: read.capsuleHeight,
    speedMps: read.speedMps,
    sprinting,
    traversing,
    exposure: instance.exposureAt?.(read) ?? "EXPOSED",
    covered: instance.coveredAt?.(read) ?? false,
    // The level says where it is dark; dawn says how much that is still worth.
    // Applied here rather than inside the level so the mission clock stays the
    // container's business and a level author never has to remember to age their
    // own lighting — and so a level that authored no light at all is already at
    // full daylight and is left alone.
    lightLevel: dawnLightLevel(
      instance.lightLevelAt?.(read) ?? 1,
      runtime.dawn.lift01,
    ),
  };
}

/**
 * Required objectives all met. The clear condition for the floor.
 *
 * A level with no required objective can never satisfy this. "Every required
 * objective is met" is vacuously true over an empty set, and a level author who
 * forgot to declare the terminal volume would otherwise clear the floor on tick
 * one and be paid for it. `missionInstanceDefects` refuses such a level before it
 * is entered; this is the second belt, so the runtime is safe on its own terms.
 */
function requiredObjectivesMet(runtime: MissionRuntime): boolean {
  const required = runtime.instance.objectives.filter(
    (objective) => objective.required,
  );
  if (required.length === 0) return false;
  const met = new Set(runtime.satisfied);
  return required.every((objective) => met.has(objective.id));
}

/**
 * Crowd clusters with their density COUNTED from the bodies standing in them.
 *
 * This is the whole defence against the worst version of the crowd bug. The
 * engine's `CrowdCluster` carries a density that `clusterContaining` compares
 * against `crowdBlendMinDensity`; if a level authored that number, it could say
 * forty-two while the renderer drew twelve, and the player would be hidden behind
 * people who are not there. It looks correct and plays wrong, and no test that
 * does not know both numbers would catch it.
 *
 * So the number is not authored. It is counted, geometrically, from the same array
 * the renderer instances and the throw physics collides with — which also means a
 * crowd that walks apart loses its cover rather than claiming bodies that have
 * left. `MissionCrowdCluster` has no density field for anyone to set.
 */
function crowdClustersFor(
  runtime: MissionRuntime,
  civilians: readonly MissionCivilian[],
): readonly CrowdCluster[] {
  if (runtime.countedFrom === civilians) return runtime.crowdClusters;
  runtime.crowdClusters = runtime.instance.crowdClusters.map((cluster) => {
    let density = 0;
    for (const civilian of civilians) {
      const dx = civilian.pos.x - cluster.x;
      const dz = civilian.pos.z - cluster.z;
      if (Math.hypot(dx, dz) <= cluster.radiusM) density += 1;
    }
    return {
      id: cluster.id,
      x: cluster.x,
      z: cluster.z,
      radiusM: cluster.radiusM,
      density,
    };
  });
  runtime.countedFrom = civilians;
  return runtime.crowdClusters;
}

/**
 * This tick's bodies: the level's crowd, minus whoever dawn has sent home.
 *
 * Memoised on two keys, and both matter. The source array's identity is how a
 * stationary crowd stays the same array — the density count and the stage's cast
 * both skip work on an unchanged list — and the departure index is how the filter
 * itself is skipped between departures.
 *
 * The index is `floor(dispersal × bodies)`, which is a strictly finer granularity
 * than any single cluster's: a cluster of n loses at most n bodies, so its kept
 * count cannot change without this index changing first. That makes the memo
 * exact rather than approximately fresh.
 */
function civiliansForTick(
  runtime: MissionRuntime,
  source: readonly MissionCivilian[],
): readonly MissionCivilian[] {
  const departure = Math.floor(runtime.dawn.dispersal01 * source.length);
  if (runtime.dispersedFrom === source && runtime.dispersedAt === departure) {
    return runtime.civilians;
  }
  runtime.dispersedFrom = source;
  runtime.dispersedAt = departure;
  return disperseAtDawn(source, runtime.dawn.dispersal01, runtime.seed);
}

/**
 * Throws a diversion at an aim point. Returns false when the throw is refused —
 * no charges left, out of range, or released inside geometry.
 *
 * The whole inventory lives in the stealth field: the charges, the throw counter
 * AND the objects in flight. It used to be split, with the container holding the
 * live objects and stepping them itself, because the field built its actor list
 * from watchers alone and a civilian was therefore transparent to a bottle. That
 * gap is closed — `StealthFieldInput.bodies` is concatenated into the actor list
 * — so the shim is gone and the field owns the object from release to rest.
 */
export function throwMissionDiversion(
  runtime: MissionRuntime,
  aim: Vec3,
): boolean {
  if (runtime.outcome) return false;
  const result = throwFieldDiversion(
    runtime.instance.world,
    runtime.stealth,
    runtime.motion.pos,
    aim,
  );
  runtime.stealth = result.state;
  return result.thrown;
}

/**
 * One fixed step of the precision beat, if the level authored one.
 *
 * Returns the noise it made this tick, which the caller concatenates into the
 * array already going to `stepStealthField`. Stepped AFTER motion so the stance
 * test reads where the player actually is on this tick, and BEFORE the field so
 * the stroke is heard on the tick it was made — the field's noise term is an
 * impulse, not a rate, so an event delivered a tick late is an event a watcher
 * reacts to a tick late and one delivered twice is twice the suspicion.
 */
function stepBeatForTick(
  runtime: MissionRuntime,
  read: MissionPlayerRead,
  strike: boolean,
) {
  const mount = runtime.instance.beat;
  const run = runtime.beat;
  if (!mount || !run) return NO_BEAT_NOISE;

  const inStance = inBeatStance(mount.spec, read);

  // An abandoned run is not a failure and not an ending: the player stepped off
  // the bough with work still to do. Coming back re-arms it against the SAME
  // chart, because the seed is the attempt's and `deriveChart` is pure. A
  // resolved run is left alone — the sheet is up, or it is torn, and neither is
  // something to have another go at.
  if (run.phase === "ABANDONED" && inStance) {
    runtime.beat = createBeatRun(mount.spec, runtime.beatSeed);
    return NO_BEAT_NOISE;
  }

  const stepped = stepBeat(run, {
    tick: runtime.clock.tick,
    strike,
    inStance,
  });
  runtime.beat = stepped.run;
  runtime.beatView = beatPresentation(stepped.run, runtime.clock.tick);

  if (stepped.outcome && !runtime.beatOutcome) {
    runtime.beatOutcome = stepped.outcome;
    mount.onResolved?.(stepped.outcome);
    note(
      runtime,
      "BEAT_RESOLVED",
      `${stepped.outcome.grade}${stepped.outcome.abandoned ? " (left)" : ""}`,
    );
  }
  // An abandoned run leaves no outcome behind: the player has not done the work
  // yet, so nothing may be latched that would stop them coming back to it.
  if (stepped.outcome?.abandoned) runtime.beatOutcome = null;

  return stepped.noise;
}

/** One fixed step. Pure with respect to the clock: dt is always FIELD_DT. */
function stepOnce(
  runtime: MissionRuntime,
  frame: MissionInputFrame,
  latched: { jump: boolean; dash: boolean; strike: boolean },
): void {
  const { instance } = runtime;
  const world = instance.world;
  const tick = runtime.clock.tick;

  // Held crouch, resolved into the motion stance before anything reads it.
  // `stepFlow` consults `crouchHeld` only to decide whether a slide is wanted; the
  // capsule belongs to playerMotion, and standing back up is refused under low
  // headroom rather than clipping through it — so a player holding C under an
  // awning stays down until they are clear of it.
  if (frame.crouchHeld !== (runtime.motion.phase === "CROUCH")) {
    runtime.motion = toggleFreeCrouch(world, runtime.motion).state;
  }

  const crouched = isCrouched(runtime.motion.capsuleHeight);
  const actionActive = runtime.motion.action !== null;
  const moving = Math.hypot(frame.moveX, frame.moveZ) > 1e-3;
  const speed = freeMoveSpeed({
    shiftHeld: frame.sprintHeld,
    moving,
    crouched,
    actionActive,
  });
  const length = moving ? Math.hypot(frame.moveX, frame.moveZ) : 1;
  const targetVelX = moving ? (frame.moveX / length) * speed : 0;
  const targetVelZ = moving ? (frame.moveZ / length) * speed : 0;

  const flowResult = stepFlow(world, runtime.motion, runtime.flow, {
    dt: FIELD_DT,
    targetVelX,
    targetVelZ,
    sprintHeld: frame.sprintHeld,
    crouchHeld: frame.crouchHeld,
    jumpBuffered: latched.jump,
    dashBuffered: latched.dash,
    flowEnabled: frame.flowEnabled,
    reducedMotion: frame.reducedMotion,
    receivingTargets: instance.receivingTargets,
  });
  runtime.motion = flowResult.motion;
  runtime.flow = flowResult.flow;

  for (const event of flowResult.events) {
    if (event.type === "landed" && event.landing === "HARD") {
      note(runtime, "HARD_LANDING", `${event.dropM?.toFixed(1) ?? "?"}m`);
    }
  }
  if (runtime.flow.inFlow && runtime.flow.chain === 3) {
    note(runtime, "FLOW_REACHED", `chain ${runtime.flow.chain}`);
  }

  const read = playerRead(runtime);
  // Standing on the bough to work is the least visible thing the player can be
  // doing, and it is so for free: no traversal verb is running while they are in
  // the stance, so `traversing` is already false and the field reads them as
  // still. Nothing here has to say so.
  const traversing = runtime.flow.verb !== "NONE";

  const beatNoise = stepBeatForTick(runtime, read, latched.strike);

  // The one list of bodies, resolved once and handed to all three consumers. The
  // shared empty constant matters: a fresh `[]` per tick would defeat the identity
  // check that stops the density count from re-running on an unchanged crowd.
  //
  // Dawn takes bodies OUT of this list rather than discounting them anywhere
  // downstream, which is the only honest way to thin a crowd: the field's density,
  // the throw's obstacles and the bodies on screen stay the same set of people, so
  // a player who can see the square emptying is seeing their cover leave.
  runtime.civilians = civiliansForTick(
    runtime,
    instance.civiliansAtTick?.(tick, runtime.seed) ?? NO_CIVILIANS,
  );

  const fieldResult = stepStealthField(world, runtime.stealth, {
    dt: FIELD_DT,
    tick,
    seed: runtime.seed,
    watchers: instance.watcherPosesAtTick(tick, runtime.seed),
    player: stealthRead(runtime, read, traversing, frame.sprintHeld),
    clusters: crowdClustersFor(runtime, runtime.civilians),
    // Civilians are absent from the CollisionWorld by design — they must not
    // occlude a sight line or block a run — so this is the only way a thrown
    // object can strike one. A throw that cannot be blocked by a person is a
    // throw that cannot miss, and a diversion that cannot miss is a button.
    bodies: runtime.civilians,
    // The load-bearing spread. A mistimed stroke is heard, by the same code path
    // that hears a hard landing, and it points the hearer at the tree.
    noise: [...flowResult.noise, ...beatNoise],
    reflexDisabled: frame.reducedMotion,
    suspendAccrual: !frame.flowEnabled,
  });
  runtime.stealth = fieldResult.state;
  // The one time dilation in the game, and it is applied to the NEXT frame's
  // delta rather than to this tick: a fixed step is always FIELD_DT.
  runtime.timeScale = fieldResult.timeScale;
  runtime.stealthView = stealthPresentation(fieldResult.state, fieldResult);

  for (const event of fieldResult.events) {
    if (event.type === "reflexOpened") {
      note(runtime, "REFLEX_OPENED", event.watcherId ?? "");
    } else if (event.type === "reflexEscaped") {
      note(runtime, "REFLEX_ESCAPED", event.watcherId ?? "");
    } else if (event.type === "throwStruckBody") {
      runtime.throwsStruckBody += 1;
      note(runtime, "THROW_STRUCK_BODY", event.actorId ?? "");
    }
  }
  if (fieldResult.detected) {
    runtime.detections += 1;
    note(runtime, "DETECTED", fieldResult.squadState);
  }
  runtime.alertedTicks =
    fieldResult.squadState === "ALERTED" ? runtime.alertedTicks + 1 : 0;

  const field: MissionFieldRead = {
    suspicion: fieldResult.suspicion,
    squadState: fieldResult.squadState,
    detected: fieldResult.detected,
    alertedTicks: runtime.alertedTicks,
    contactIds: fieldResult.state.previousContacts.map((contact) => contact.id),
  };

  // Route costs. The level closes a crossover or pushes the player down a line;
  // §4.11 makes that the price of being read before the final court. Whatever it
  // changes must be a function of the tick, so a replay reproduces it.
  if (fieldResult.detected) instance.onDetected?.(read, field);

  runtime.ticks += 1;
  // `runtime.dawn` always describes `runtime.ticks`, which is why it is advanced
  // here rather than at the top of the step: the light this step's stealth read
  // used was the light at the moment the step began, and anything sampling
  // between steps — the HUD, the sky — asks about now.
  runtime.dawn = dawnRead(runtime.ticks * FIELD_DT, instance.traversalBudgetS);

  for (const objective of instance.objectives) {
    if (runtime.satisfied.includes(objective.id)) continue;
    if (!objective.satisfiedBy(read)) continue;
    runtime.satisfied.push(objective.id);
    note(runtime, "OBJECTIVE_MET", objective.id);
  }

  const failure = instance.failWhen?.(read, field) ?? null;
  if (failure) {
    runtime.outcome = { kind: "FAILED", failure, ...missionObservation(runtime) };
    return;
  }

  if (requiredObjectivesMet(runtime)) {
    runtime.outcome = { kind: "REACHED_DUEL", ...missionObservation(runtime) };
    return;
  }

  const timeout = instance.traversalTimeoutS;
  if (timeout !== null && runtime.ticks * FIELD_DT >= timeout) {
    runtime.outcome = {
      kind: "FAILED",
      failure: {
        code: "TRAVERSAL_TIMEOUT",
        cueId: null,
        headline: "The window closed.",
        detail: `The route was not finished inside its ${timeout} seconds.`,
      },
      ...missionObservation(runtime),
    };
  }
}

/**
 * What the run measured about itself.
 *
 * Read from a resolved run to build its outcome, and read from an unresolved one
 * when the player walks out — a quit attempt's seconds are still evidence about how
 * long a mission takes, and the pacing question this feeds does not care why the
 * run ended.
 */
export function missionObservation(
  runtime: MissionRuntime,
): MissionTraversalObservation {
  return {
    simulatedS: runtime.ticks * FIELD_DT,
    droppedSteps: runtime.droppedSteps,
    objectiveIds: [...runtime.satisfied],
    detections: runtime.detections,
    throwsStruckBody: runtime.throwsStruckBody,
  };
}

/**
 * Advances the run by one render frame.
 *
 * Fixed-step equivalence holds: a 1/30, 1/60 or 1/120 frame delta over the same
 * elapsed time visits the same integer ticks, so the run is identical at any
 * frame rate. Once an outcome is set this is a no-op, so a caller that has not
 * yet noticed the run ended cannot step past its own terminal state.
 */
export function stepMissionRuntime(
  runtime: MissionRuntime,
  frame: MissionInputFrame,
): MissionRuntimeStep {
  if (runtime.outcome) {
    return {
      steps: 0,
      outcome: runtime.outcome,
      jumpConsumed: false,
      dashConsumed: false,
      strikeConsumed: false,
    };
  }

  const advanced = advanceFieldClock(
    runtime.clock,
    scaledFrameDt(frame.dtS, runtime.timeScale),
  );
  runtime.clock = advanced.clock;
  runtime.droppedSteps += advanced.dropped;

  // Every press is carried to exactly ONE tick — the first of the frame — and
  // cleared. A frame can span several fixed steps, and a press delivered to all
  // of them is a press repeated: for the jump that is a double launch, and for
  // the strike it is a stray for every step but the one that landed.
  const latched = {
    jump: frame.jumpBuffered,
    dash: frame.dashBuffered ?? false,
    strike: frame.strikeBuffered ?? false,
  };
  const consumed = { jump: false, dash: false, strike: false };
  for (let tick = advanced.firstTick; tick <= advanced.lastTick; tick += 1) {
    // The clock's tick is the authority the field systems read, so it is set
    // per step rather than left at the end of the frame's run of steps.
    runtime.clock = { ...runtime.clock, tick };
    stepOnce(runtime, frame, latched);
    for (const action of ["jump", "dash", "strike"] as const) {
      if (!latched[action]) continue;
      latched[action] = false;
      consumed[action] = true;
    }
    if (runtime.outcome) break;
  }

  return {
    steps: advanced.steps,
    outcome: runtime.outcome,
    jumpConsumed: consumed.jump,
    dashConsumed: consumed.dash,
    strikeConsumed: consumed.strike,
  };
}

export interface MissionObjectiveReadout {
  readonly id: string;
  readonly label: string;
  readonly required: boolean;
  readonly met: boolean;
}

/** Everything the stage and the HUD read. Nothing that would let them drive it. */
export interface MissionPresentation {
  readonly flow: FlowPresentation;
  readonly stealth: StealthPresentation;
  readonly elapsedS: number;
  readonly budgetS: number;
  /**
   * The mission clock as dawn: seconds of night left, how far the light has
   * come, and how far the crowds have gone home. The same value the stealth
   * field's light term was computed from on the tick this was sampled, so the
   * HUD cannot advertise cover the simulation is not granting.
   */
  readonly dawn: DawnRead;
  readonly tick: number;
  readonly timeScale: number;
  readonly detections: number;
  readonly objectives: readonly MissionObjectiveReadout[];
  readonly recentEvents: readonly MissionRuntimeEvent[];
  /**
   * The bodies to draw, and the identical array the field counted its crowd
   * density from. The stage instances exactly this; see `missionCrowdParity`.
   */
  readonly civilians: readonly MissionCivilian[];
  /** Clusters with counted density, so a dev overlay can show both numbers. */
  readonly crowdClusters: readonly CrowdCluster[];
  /** Objects in flight or at rest. The level draws them; nothing procedural does. */
  readonly liveDiversions: readonly DiversionObject[];
  readonly throwsStruckBody: number;
  /**
   * The beat's read, or null when the level authored none.
   *
   * Present from the first tick, so the marks are laid out on the work surface
   * while the player is still deciding when to start. `phase` says whether that
   * decision is still open.
   */
  readonly beat: BeatPresentation | null;
  /** True while the player is standing where the work is, facing it. */
  readonly inBeatStance: boolean;
}

export function missionPresentation(runtime: MissionRuntime): MissionPresentation {
  const met = new Set(runtime.satisfied);
  const mount = runtime.instance.beat;
  return {
    flow: flowPresentation(runtime.motion, runtime.flow),
    stealth: runtime.stealthView,
    elapsedS: runtime.ticks * FIELD_DT,
    budgetS: runtime.instance.traversalBudgetS,
    dawn: runtime.dawn,
    tick: runtime.clock.tick,
    timeScale: runtime.timeScale,
    detections: runtime.detections,
    objectives: runtime.instance.objectives.map((objective) => ({
      id: objective.id,
      label: objective.label,
      required: objective.required,
      met: met.has(objective.id),
    })),
    recentEvents: runtime.recentEvents,
    civilians: runtime.civilians,
    crowdClusters: runtime.crowdClusters,
    liveDiversions: runtime.stealth.diversions.live,
    throwsStruckBody: runtime.throwsStruckBody,
    beat:
      runtime.beatView ??
      (runtime.beat ? beatPresentation(runtime.beat, runtime.clock.tick) : null),
    inBeatStance: mount
      ? inBeatStance(mount.spec, {
          pos: runtime.motion.pos,
          yaw: runtime.motion.yaw,
        })
      : false,
  };
}

/**
 * Whether the crowd the field believes in is the crowd that exists.
 *
 * Returns one sentence per cluster whose counted density disagrees with the bodies
 * standing inside it. It should be impossible to fail — density is counted, not
 * authored — and that is exactly why it is worth asserting: the invariant is one
 * refactor away from becoming a convention, and a crowd that hides the player
 * behind bodies that are not drawn looks correct and plays wrong.
 */
export function missionCrowdParity(runtime: MissionRuntime): string[] {
  const complaints: string[] = [];
  for (const cluster of runtime.crowdClusters) {
    let present = 0;
    for (const civilian of runtime.civilians) {
      const dx = civilian.pos.x - cluster.x;
      const dz = civilian.pos.z - cluster.z;
      if (Math.hypot(dx, dz) <= cluster.radiusM) present += 1;
    }
    if (present !== cluster.density) {
      complaints.push(
        `${cluster.id} tells the field ${cluster.density} bodies and has ${present}`,
      );
    }
  }
  return complaints;
}

/**
 * Releases what the runtime accumulated.
 *
 * The instance is disposed of separately, by the session's DISPOSE_INSTANCE
 * effect — a runtime does not own the level it ran. What it does own is the event
 * ring and the latched objective list, and a retained runtime holding those is
 * the difference between a garbage-collected attempt and a slow leak across a
 * session of them.
 */
export function disposeMissionRuntime(runtime: MissionRuntime): void {
  runtime.recentEvents.length = 0;
  runtime.satisfied.length = 0;
  // The beat run is deliberately left alone. It is bounded — one chart and at
  // most a stroke per beat — so it is not the kind of thing this function is
  // for, and clearing it would make a disposed runtime one that silently has no
  // beat. The next attempt builds its own runtime and derives its own chart.
}
