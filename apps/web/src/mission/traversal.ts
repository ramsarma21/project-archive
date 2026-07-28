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
  createPursuitState,
  createStealthFieldState,
  flowPresentation,
  freeMoveSpeed,
  groundedSupport,
  isCrouched,
  projectFieldSeed,
  scaledFrameDt,
  stealthPresentation,
  stepFlow,
  motionPenetration,
  stepStealthField,
  stepWatcherPursuit,
  throwFieldDiversion,
  previewThrow,
  STAND_HEIGHT,
  STEALTH_TUNING,
  toggleFreeCrouch,
  NO_SUPPRESSION,
  posesWithoutSuppressed,
  suppressWatchers,
  suppressionTicks,
  investigateWatchers,
  calmWatchers,
  type CrowdCluster,
  type DiversionActor,
  type DiversionObject,
  type PerceptionSuppression,
  type ThrowPreview,
  type ThrowRefusal,
  type FieldClock,
  type FlowPresentation,
  type FlowState,
  type MotionState,
  type PlayerStealthRead,
  type PursuitEvent,
  type StealthFieldState,
  type StealthPresentation,
  type TraversalVerb,
  type Vec3,
  type WatcherPose,
  type WatcherPursuit,
} from "@pa/engine-world";
import {
  createEncounterInstance,
  encounterClientView,
  encounterResolved,
  stepEncounter,
  type EncounterClientView,
  type EncounterInstance,
  type EncounterPhase,
  type EncounterResolution,
  type EncounterVerdictKind,
} from "@pa/mission-m1";
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
  MissionObjective,
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

/**
 * Dev/test builds only. Vite defines `import.meta.env.DEV`; a bare test process
 * (node --test) has no such object, so the access is guarded and defaults off
 * — the fuzzer asserts the same invariant directly, so nothing is lost there.
 */
function penetrationChecksEnabled(): boolean {
  try {
    return Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
}

const PENETRATION_CHECKS = penetrationChecksEnabled();
/** One report per offending collider, so a wedged body does not flood the log. */
const reportedPenetrations = new Set<string>();

/**
 * The always-on non-penetration invariant, asserted every fixed tick in dev.
 *
 * `motionPenetration` is the single shared predicate (see playerMotion.ts): it
 * returns the solid blockers the capsule ended the tick inside and any deck
 * cutting its torso, with the solver's own legitimate ignores excluded. A
 * violation is the "glitch through objects" defect, so it is logged with the
 * collider, the exact position and the verb that produced it.
 */
function assertNonPenetration(
  world: MissionInstance["world"],
  motion: MotionState,
  verb: TraversalVerb,
  tick: number,
): void {
  if (!PENETRATION_CHECKS) return;
  const { embeds, deckId } = motionPenetration(world, motion);
  if (embeds.length === 0 && deckId === null) return;
  const at = `(${motion.pos.x.toFixed(2)}, ${motion.pos.y.toFixed(2)}, ${motion.pos.z.toFixed(2)})`;
  for (const embed of embeds) {
    const key = `embed:${embed.id}`;
    if (reportedPenetrations.has(key)) continue;
    reportedPenetrations.add(key);
    console.error(
      `[mission] non-penetration violated: capsule ${embed.depthM.toFixed(3)}m inside ` +
        `solid ${embed.id} at ${at}, verb=${verb}, phase=${motion.phase}, tick=${tick}`,
    );
  }
  if (deckId !== null) {
    const key = `deck:${deckId}`;
    if (!reportedPenetrations.has(key)) {
      reportedPenetrations.add(key);
      console.error(
        `[mission] non-penetration violated: deck ${deckId} through the torso at ` +
          `${at}, verb=${verb}, phase=${motion.phase}, tick=${tick}`,
      );
    }
  }
}

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
    | "BEAT_RESOLVED"
    /** A watcher left his post and started walking. */
    | "WATCH_MOVED"
    /** A perspective encounter reached a verdict. */
    | "ENCOUNTER_RESOLVED"
    /** A talked-down guard's durable clear lifted (player left his vicinity). */
    | "ENCOUNTER_CLEAR_LIFTED";
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

/** Shared so a suspended tick, which steps nobody, allocates nothing. */
const NO_PURSUIT_EVENTS: readonly PursuitEvent[] = [];

/**
 * How far above the feet the committed waypoint must sit for the reader to treat
 * an incidental climb face as guidance-sanctioned ascent it may take off Shift
 * alone. Below this, the guidance is a same-height or lower run and an inferred
 * MANTLE/CLIMB_UP needs an explicit Space. It sits above minor deck undulation
 * and a same-deck run (the cornice marker C_CORNICE_S is the same height as the
 * body, ~0m) yet below every ascent the guidance actually asks for — the crate
 * top to the first canopy is 0.65m, the ground to the crate 1.9m, the tower and
 * scaffold climbs metres. A kerb is a STEP_UP, which is never gated regardless.
 */
const ASCENT_GUIDANCE_MIN_M = 0.4;

// ---------------------------------------------------------------------------
// Perspective encounters, in the runtime.
//
// The encounter machines live on the runtime like the pursuit state does — one
// per authored stop, fresh per attempt — and are stepped inside the same fixed
// step. That is what makes the runtime the single source of truth: the same
// machine positions become the field's watcher poses, the rendered watcher
// poses, and the overlay's projection, so the constable the player is talking to
// is the constable whose cone can see them and the body on screen, all at once.
// ---------------------------------------------------------------------------

/** The overlay's live read of the active encounter. Client-safe only. */
export interface ActiveEncounterView {
  readonly encounterId: string;
  readonly phase: EncounterPhase;
  /** Prompt, speaker, loyalty, priorities, hint. Never a rubric. */
  readonly view: EncounterClientView;
  /** Set once the verdict is in; drives the result copy. */
  readonly verdictKind: EncounterVerdictKind | null;
  /** Reprieve window, seconds, for the correct-answer consequence copy. */
  readonly reprieveWorldSeconds: number;
}

/** One resolved stop, for the HUD and the result. Never carries an answer. */
export interface EncounterSummary {
  readonly encounterId: string;
  readonly itemId: string;
  readonly verdictKind: EncounterVerdictKind;
  /** True when the answer bought a reprieve (correct/granted), false on wrong. */
  readonly reprieve: boolean;
}

export interface MissionRuntime {
  readonly instance: MissionInstance;
  readonly seed: number;
  clock: FieldClock;
  motion: MotionState;
  /**
   * The pose at the END of the previous fixed step.
   *
   * The simulation runs at a fixed 60Hz and the render does not, so the two
   * disagree about where "now" is by up to a whole step. Drawing the latest
   * tick's position on every frame means a 144Hz display shows the same
   * position for two or three frames and then jumps two steps' worth, which is
   * judder the player reads as the movement being loose. Keeping the previous
   * pose lets the renderer interpolate; see `missionRenderPose`.
   *
   * Held as a reference to the previous MotionState's `pos`, which is safe
   * because motion states are replaced rather than mutated, and costs no
   * allocation per tick.
   */
  prevPos: Vec3;
  prevYaw: number;
  flow: FlowState;
  stealth: StealthFieldState;
  /**
   * The watchers' legs: where each of them has actually walked to.
   *
   * Separate from `stealth`, and it has to be. The stealth field owns what a
   * watcher KNOWS and refuses on purpose to own where he is standing — patrol
   * routes belong to the level — so this is the layer between the two, and its
   * absence is why being seen used to change nothing about the world. See
   * stealth/pursuit.ts.
   */
  pursuit: WatcherPursuit[];
  /**
   * The poses the field was actually given this tick, after pursuit displaced
   * them. The renderer draws exactly these, so the constable on screen is the
   * constable the simulation resolved sight lines from and not a second opinion.
   */
  watcherPoses: readonly WatcherPose[];
  /**
   * Which way each watcher is looking, straight off the field.
   *
   * The cone's yaw, not the body's travel direction: a man walking north with
   * his head turned east is looking east, and the eye is the thing the player is
   * playing against. Drawing the body on the travel yaw while the cone pointed
   * somewhere else would be a tell that lies.
   */
  watcherFacings: readonly { id: string; yaw: number }[];
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
   * Tick the throw performance stops playing, or 0.
   *
   * A throw was previously invisible from the player's side: the object leaves,
   * the field hears it land and a constable turns, but the body that threw it
   * never moved and the object itself has no GLB to draw. Pressing Q therefore
   * looked exactly like pressing an unbound key, which is what the owner
   * reported. This is the window the arm swing occupies, and it is the one
   * confirmation the verb can currently give.
   */
  throwHeldUntilTick: number;
  /**
   * The complete launch state latched on the last aiming frame — ORIGIN and
   * target — so a release throws from exactly what the player was shown, not from
   * a position they may have walked half a metre past by the time the key came
   * up. Null when not aiming.
   */
  throwLatched: { origin: Vec3; aim: Vec3; preview: ThrowPreview } | null;
  /** The live aim cue while aiming, or null. Read by the canvas, written by the step. */
  throwAim: MissionThrowAim | null;
  /**
   * A release-time refusal, held visible for a deterministic window so a throw
   * that never left the hand does not vanish in the frame the key came up.
   */
  throwRefusal: { cue: MissionThrowAim; untilTick: number } | null;
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
  /**
   * Distinct traversal verbs the body has actually performed this run.
   *
   * The affordance cue fades against this, so it is a record of what the player
   * has been TAUGHT rather than of what they have been offered. Counted from
   * `verbCommitted` for exactly that reason: running past a vault you never took
   * teaches nothing, and a cue that dimmed for it would be dimming on the
   * player's behalf. See mission/affordance.ts.
   */
  verbsUsed: Set<TraversalVerb>;
  /**
   * A traversal that FINISHED on the current fixed step — an authored climb or
   * vault completing, a landing, a received dive — or null on a tick nothing
   * finished. Captured inside the step and read once by `advanceWayfinding`, so
   * the guidance can credit the completion to a directed route link and rejoin
   * the route at the proven node rather than guessing from position alone.
   */
  completion: { verb: TraversalVerb; landingId: string | null } | null;

  // ---- perspective encounters ----
  /** One machine per authored stop, fresh for this attempt. */
  encounters: EncounterInstance[];
  /** Watcher-scoped perception reprieves. Applied to the field's watcher input. */
  suppression: PerceptionSuppression;
  /**
   * The guards a RESOLVED (correct/granted) stop has durably talked down.
   *
   * This is the state the old timed-only reprieve was missing, and its absence is
   * the whole of the "answer the guard, then a few seconds later the bar climbs
   * and he chases again" report. `suppression` is a countdown: it buys a bounded
   * window, and the tick it lapses a guard who is still standing in the player's
   * cone re-acquires and re-arms pursuit — punishing a player for having answered
   * correctly and then not sprinted off. A talked-down guard is DURABLE state, not
   * a countdown: he stays out of the field's input for as long as the player is in
   * his vicinity, and only returns to ordinary perception once the player has
   * genuinely LEFT (past `CLEAR_EXIT_RADIUS_M`, comfortably beyond his sight
   * range) — which is what makes "he can chase again later" a fresh approach the
   * player walks back into rather than an automatic re-detection of a man who
   * never moved. Scoped strictly to the ids the stop involved; everyone else, and
   * a WRONG answer's pursuit, is untouched. Deterministic and replay-stable: it is
   * a pure function of the fixed-tick player and watcher positions.
   */
  encounterClears: Set<string>;
  /** The encounter the overlay should submit this frame, or null. Overlay-written. */
  encounterSubmit: string | null;
  /** The encounter the overlay dismissed this frame, or null. Overlay-written. */
  encounterDismiss: string | null;
  /** Verdicts the overlay has fetched, awaiting the step that consumes them. */
  encounterVerdictInbox: Map<string, EncounterVerdictKind>;
  /** The live overlay projection, or null when no stop is active. */
  encounterView: ActiveEncounterView | null;
  /** True while a stop locks locomotion (APPROACH/QUESTION/SUBMITTING). */
  encounterLocked: boolean;
  /** True while a stop owns input and gameplay time is frozen. */
  encounterOwnsInput: boolean;
  /**
   * The encounter-notice meter, 0..1. NOT a cosmetic random: it is a pure
   * function of the live encounter phase, eased per tick. It shoots up the moment
   * a stop arms (the "you were spotted" surge right after the drop), holds while
   * the question is up, and eases back down once the stop releases. The HUD draws
   * it on the same suspicion meter (taking the max with the field's own value),
   * so the bar the player already reads is what surges — bound to real encounter
   * state, never a fake value the simulation does not act on.
   */
  encounterNotice01: number;
  /**
   * True once the cinematic conversation shot has eased in far enough AND the
   * speaker is at conversational separation — i.e. the moment the question is
   * allowed to become answerable. Written by the chase camera (the only place
   * that knows the blend weight) and read by the overlay so the answer dock can
   * never enable while the officer is far or the shot is still forming. Presentation
   * only; the deterministic machine never reads it.
   */
  encounterShotReady: boolean;
  /** Resolved-stop summaries, by encounter id. For the HUD and the result. */
  encounterSummaries: Map<string, EncounterSummary>;
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
   * The panel cell the player struck since the last step, or null. Consumed by
   * the first tick.
   *
   * EDGE TRIGGERED, and this is where that is owned. A held key or an unreleased
   * pointer delivered every fixed step reads to the beat as a run of strays, so
   * the container carries the struck cell to exactly one tick and clears it.
   */
  readonly hitCellBuffered?: number | null;
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
  /** True when a buffered panel strike was handed to the beat this frame. */
  readonly hitConsumed: boolean;
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
    prevPos: instance.spawn.pos,
    prevYaw: instance.spawn.yaw,
    flow: createFlowState(),
    stealth,
    pursuit: createPursuitState(instance.watcherIds),
    // The authored poses at tick 0, so a surface that samples before the first
    // step draws the watchers on their marks rather than nowhere.
    watcherPoses: instance.watcherPosesAtTick(0, input.seed),
    watcherFacings: [],
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
    throwHeldUntilTick: 0,
    throwLatched: null,
    throwAim: null,
    throwRefusal: null,
    stealthView: {
      ...CALM_STEALTH_VIEW,
      reflexCharges: stealth.reflex.charges,
      diversionCharges: stealth.diversions.charges,
    },
    outcome: null,
    recentEvents: [],
    droppedSteps: 0,
    verbsUsed: new Set<TraversalVerb>(),
    completion: null,
    // Fresh machines per attempt, so nothing a prior run resolved can leak in.
    encounters: (instance.encounters ?? []).map((mount) =>
      createEncounterInstance(mount.def, mount.variant),
    ),
    suppression: NO_SUPPRESSION,
    encounterClears: new Set<string>(),
    encounterSubmit: null,
    encounterDismiss: null,
    encounterVerdictInbox: new Map(),
    encounterView: null,
    encounterLocked: false,
    encounterOwnsInput: false,
    encounterNotice01: 0,
    encounterShotReady: false,
    encounterSummaries: new Map(),
  };
}

/**
 * The notice meter's target for a phase, and how fast it eases there per tick.
 *
 * The surge is deliberately quick (a hard rise the tick a stop arms) and the
 * decay gentle (it lingers a moment after the stop releases). Bound to the
 * machine's phase, so it is a read of real encounter state rather than a value
 * the HUD invents.
 */
const NOTICE_RISE_PER_TICK = 0.09;
const NOTICE_FALL_PER_TICK = 0.03;

/**
 * How far the player must get from a talked-down guard before that guard's
 * durable clear lifts and he returns to ordinary perception.
 *
 * Set comfortably beyond the watchers' sight range (`STEALTH_TUNING.coneRangeM`
 * is 16m) so a clear only ever lifts once the guard genuinely cannot see the
 * player — the lift can therefore never itself be the thing that re-detects him.
 * This is the spatial boundary of the encounter: inside it the answered guard
 * stays talked down no matter how long the player lingers; step outside it and
 * the encounter is over, and a later approach is a fresh one he may react to.
 */
const CLEAR_EXIT_RADIUS_M = STEALTH_TUNING.coneRangeM + 2;

function noticeTargetFor(phase: EncounterPhase | null): number {
  switch (phase) {
    case "APPROACH":
    case "QUESTION":
    case "SUBMITTING":
      return 1;
    case "RESOLVED":
      return 0.5;
    default:
      return 0;
  }
}

/**
 * Ease the encounter-notice meter toward its phase target. Pure ramp on the
 * fixed clock, so it is deterministic and replay-stable. Reduced motion does not
 * change the value (a meter is state, not motion); the HUD chooses whether to
 * flash it.
 */
function stepEncounterNotice(runtime: MissionRuntime, phase: EncounterPhase | null): void {
  const target = noticeTargetFor(phase);
  const current = runtime.encounterNotice01;
  if (Math.abs(target - current) < 1e-4) {
    runtime.encounterNotice01 = target;
    return;
  }
  const rate = target > current ? NOTICE_RISE_PER_TICK : NOTICE_FALL_PER_TICK;
  const next = current + Math.sign(target - current) * rate;
  runtime.encounterNotice01 =
    target > current ? Math.min(target, next) : Math.max(target, next);
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
    // Against the poses the pursuit produced for THIS tick, which is why this
    // is read after `stepWatcherPursuit` and not before it.
    covered: instance.coveredAt?.(read, runtime.watcherPoses) ?? false,
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
  origin: Vec3 = runtime.motion.pos,
): boolean {
  if (runtime.outcome) return false;
  const result = throwFieldDiversion(
    runtime.instance.world,
    runtime.stealth,
    origin,
    aim,
  );
  runtime.stealth = result.state;
  // Only a throw that actually left the hand gets a performance. A refusal —
  // out of charges, out of range, released into geometry — must look different
  // from a throw, or the player learns nothing from the difference.
  if (result.thrown) {
    runtime.throwHeldUntilTick = runtime.ticks + THROW_CLIP_TICKS;
  }
  return result.thrown;
}

/**
 * Where THIS throw would land, resolved without spending a charge. Read-only.
 *
 * The aiming half of the verb. `previewThrow` runs the same `stepDiversion` the
 * live object will, on a copy AND against the SAME actors, so the arc, the
 * landing ring and the trajectory samples the canvas draws are where the object
 * actually comes to rest — short of a wall, or stopped at a body — and the
 * `refusal` is why a throw from here would be declined. Nothing is written to
 * the runtime and no charge is spent; it is safe to call every aiming frame.
 *
 * PARITY WITH THE LIVE THROW is the whole point, and it has to be the WHOLE actor
 * set. `stepStealthField` hands `stepDiversion` the watchers AND the civilians —
 * built exactly as below, watcher poses mapped to bodies and the crowd appended —
 * so the preview builds the identical list, same ids, same poses, same heights.
 * A preview that ran only the civilians would promise a clear lane straight
 * through a constable the live throw then hit.
 */
export function previewMissionThrow(
  runtime: MissionRuntime,
  aim: Vec3,
  origin: Vec3 = runtime.motion.pos,
): ThrowPreview {
  const actors: DiversionActor[] = [
    ...runtime.watcherPoses.map((pose) => ({
      id: pose.id,
      pos: pose.position,
      capsuleHeight: pose.capsuleHeight ?? STAND_HEIGHT,
    })),
    ...runtime.civilians,
  ];
  return previewThrow(
    runtime.instance.world,
    runtime.stealth.diversions,
    origin,
    aim,
    FIELD_DT,
    STEALTH_TUNING,
    actors,
  );
}

/** The aim cue the canvas draws: a trajectory, a landing, and a refusal reason. */
export interface MissionThrowAim {
  readonly from: Vec3;
  readonly aim: Vec3;
  readonly ok: boolean;
  readonly restsAt: Vec3 | null;
  readonly radiusM: number;
  readonly refusal: ThrowRefusal;
  /** The object's position each simulated tick — the arc the canvas draws. */
  readonly samples: readonly Vec3[];
}

/**
 * Fixed ticks a release-time refusal stays on screen. ~0.75s at 60Hz, and it is
 * deterministic on purpose: a refusal that flickered for the one frame between
 * keyup and the aim clearing is one the player never reads.
 */
export const THROW_REFUSAL_TICKS = 45;

function throwAimCue(
  origin: Vec3,
  aim: Vec3,
  preview: ThrowPreview,
): MissionThrowAim {
  return {
    from: { ...origin },
    aim: { ...aim },
    ok: preview.ok,
    restsAt: preview.restsAt ? { ...preview.restsAt } : null,
    radiusM: preview.radiusM,
    refusal: preview.refusal,
    samples: preview.samples,
  };
}

/**
 * The one place the throw's aim state is advanced. Sole owner, in the fixed step.
 *
 * Three behaviours, and each is a fix the audit asked for:
 *
 *   * WHEN UI OWNS INPUT — an abandon modal, focus in an editable control, a
 *     blurred window — aiming and any pending release are dropped and NO charge
 *     is spent. A throw begun before the modal opened cannot fire when it
 *     closes.
 *   * WHILE AIMING, the preview is solved (against the crowd's own bodies) and
 *     the aim is LATCHED, so a release consumes exactly the target the player
 *     was shown rather than one recomputed after the cue cleared.
 *   * ON RELEASE, the latched target is thrown; a refusal is held visible for
 *     `THROW_REFUSAL_TICKS` so it does not vanish in the frame the key came up.
 *
 * `input` is mutated: `throwReleased` is consumed here, and both flags are
 * cleared when UI owns input.
 */
export function stepMissionThrowAim(
  runtime: MissionRuntime,
  input: { throwAiming: boolean; throwReleased: boolean },
  aim: Vec3,
  options: { uiOwnsInput: boolean },
): void {
  if (options.uiOwnsInput) {
    input.throwAiming = false;
    input.throwReleased = false;
    runtime.throwLatched = null;
    runtime.throwAim = null;
    runtime.throwRefusal = null;
    return;
  }

  if (input.throwAiming) {
    // Latch the WHOLE launch state — origin and target — from this frame, and
    // preview from that same origin, so the displayed arc and a later release
    // are the identical throw even if the player is still moving.
    const origin = { ...runtime.motion.pos };
    const preview = previewMissionThrow(runtime, aim, origin);
    runtime.throwLatched = { origin, aim: { ...aim }, preview };
    runtime.throwAim = throwAimCue(origin, aim, preview);
    return;
  }

  runtime.throwAim = null;

  if (input.throwReleased) {
    input.throwReleased = false;
    const latched = runtime.throwLatched;
    runtime.throwLatched = null;
    if (latched) {
      // The LATCHED origin AND target, never a recompute from where the player
      // has since moved to.
      const thrown = throwMissionDiversion(runtime, latched.aim, latched.origin);
      if (thrown) {
        runtime.throwRefusal = null;
      } else {
        // Re-solve only to read WHY it was refused, at the same latched launch
        // state, so the held cue names the reason without moving the throw.
        const reason = previewMissionThrow(runtime, latched.aim, latched.origin);
        runtime.throwRefusal = {
          cue: throwAimCue(latched.origin, latched.aim, reason),
          untilTick: runtime.ticks + THROW_REFUSAL_TICKS,
        };
      }
    }
    return;
  }

  // Not aiming and not releasing: drop a latch left by a blur mid-aim.
  runtime.throwLatched = null;
}

/**
 * The aim cue to draw right now: the live aim while aiming, else a release-time
 * refusal still inside its window, else nothing. A pure read for the canvas.
 */
export function missionThrowCue(runtime: MissionRuntime): MissionThrowAim | null {
  if (runtime.throwAim) return runtime.throwAim;
  const refusal = runtime.throwRefusal;
  if (refusal && runtime.ticks < refusal.untilTick) return refusal.cue;
  return null;
}

/**
 * Why a throw was declined, as a line a player can read, or null when it would
 * be accepted. The one player-facing surface for a refused throw.
 */
export function throwRefusalMessage(refusal: ThrowRefusal): string | null {
  switch (refusal) {
    case "NO_CHARGES":
      return "Nothing left to throw";
    case "OUT_OF_RANGE":
      return "Too far — aim closer";
    case "NO_ROOM_TO_THROW":
      return "No room to throw from here";
    case "NONE":
      return null;
  }
}

/**
 * Fixed steps the throw performance occupies: the 450ms `throwLight` was
 * authored for. Exported so the mixer's timeScale is computed against the same
 * window rather than a second copy of it.
 */
export const THROW_CLIP_TICKS = 27;

/** Is the throw performance playing this tick? */
export function missionThrowing(runtime: MissionRuntime): boolean {
  return runtime.ticks < runtime.throwHeldUntilTick;
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
  hitCell: number | null,
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
    hitCell,
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

/** An actor pose the encounter machine is overriding this tick. */
interface EncounterActorOverride {
  readonly id: string;
  readonly pos: Vec3;
  readonly yaw: number;
}

const NO_OVERRIDES: readonly EncounterActorOverride[] = [];

/** What the encounter step decided for this tick, for the rest of the step. */
interface EncounterStepAggregate {
  readonly locked: boolean;
  readonly ownsInput: boolean;
  readonly overrides: readonly EncounterActorOverride[];
}

/**
 * Apply a resolved stop's consequence to the live systems.
 *
 * The suppression ledger and the alert states are the two the encounter must
 * touch, and it touches them ONLY through named APIs: `suppressWatchers` +
 * `calmWatchers` for a reprieve, `investigateWatchers` for a pursuit. No private
 * field of the field state is mutated here.
 */
function applyEncounterResolution(
  runtime: MissionRuntime,
  resolution: EncounterResolution,
): void {
  runtime.encounterSummaries.set(resolution.encounterId, {
    encounterId: resolution.encounterId,
    itemId: resolution.itemId,
    verdictKind: resolution.verdictKind,
    reprieve: resolution.suppress !== null,
  });
  note(
    runtime,
    "ENCOUNTER_RESOLVED",
    `${resolution.encounterId}:${resolution.verdictKind}`,
  );
  if (resolution.suppress) {
    // The bounded ledger reprieve is retained as the immediate, telemetry-legible
    // grace window (the HUD-readable "you have a moment" the reprieve seconds
    // promise), but it is NO LONGER the thing that keeps a guard off the player.
    runtime.suppression = suppressWatchers(
      runtime.suppression,
      resolution.suppress.ids,
      runtime.clock.tick,
      resolution.suppress.durationTicks,
    );
    // The durable clear is. These guards are talked down: they leave any contact,
    // head back to patrol, and stay out of the field's input until the player has
    // left their vicinity — so the ledger lapsing under a player who never moved
    // can no longer re-arm the pursuit that answering was supposed to end.
    for (const id of resolution.suppress.ids) runtime.encounterClears.add(id);
    runtime.stealth = {
      ...runtime.stealth,
      watchers: calmWatchers(runtime.stealth.watchers, resolution.suppress.ids),
    };
  }
  if (resolution.pursue) {
    // A wrong answer is a real, escapable threat and must NOT be durably cleared:
    // if any of these guards were talked down by an earlier stop, that clear is
    // spent the moment they are provoked again.
    for (const id of resolution.pursue.ids) runtime.encounterClears.delete(id);
    runtime.stealth = {
      ...runtime.stealth,
      watchers: investigateWatchers(
        runtime.stealth.watchers,
        resolution.pursue.ids,
        resolution.pursue.toward,
      ),
    };
  }
}

/**
 * Lift the durable clear on any talked-down guard the player has walked away
 * from, measured against the guard's LIVE pose (post-pursuit, post-override).
 *
 * The boundary is `CLEAR_EXIT_RADIUS_M`, set beyond sight range, so a lift can
 * never be the thing that re-detects a guard: by the time he leaves the set the
 * player is already out of his cone. Monotonic per guard — a clear that lifts
 * stays lifted — so there is no boundary flicker, and a later, genuinely fresh
 * approach is handled by ordinary perception rather than by this reprieve.
 */
function pruneEncounterClears(runtime: MissionRuntime): void {
  if (runtime.encounterClears.size === 0) return;
  const player = runtime.motion.pos;
  const poseById = new Map(runtime.watcherPoses.map((p) => [p.id, p.position]));
  for (const id of [...runtime.encounterClears]) {
    const pos = poseById.get(id);
    // A guard with no live pose this tick (not authored on the level anymore)
    // has nothing to be cleared FROM; drop him rather than pinning a dead id.
    if (!pos) {
      runtime.encounterClears.delete(id);
      continue;
    }
    if (Math.hypot(player.x - pos.x, player.z - pos.z) > CLEAR_EXIT_RADIUS_M) {
      runtime.encounterClears.delete(id);
      note(runtime, "ENCOUNTER_CLEAR_LIFTED", id);
    }
  }
}

/**
 * The watcher poses the stealth field should read this tick: the live poses
 * minus the bounded ledger's suppressed ids AND minus the durably cleared ids.
 *
 * Two reprieve mechanisms compose here without either reaching into the field's
 * private state: `posesWithoutSuppressed` drops the timed ledger, and the durable
 * `encounterClears` set drops the answered guards for as long as they remain
 * talked down. Returns the ledger result by reference when nothing is cleared.
 */
function fieldWatchers(runtime: MissionRuntime, tick: number): readonly WatcherPose[] {
  const suppressed = posesWithoutSuppressed(
    runtime.watcherPoses,
    runtime.suppression,
    tick,
  );
  if (runtime.encounterClears.size === 0) return suppressed;
  return suppressed.filter((pose) => !runtime.encounterClears.has(pose.id));
}

/**
 * Step every encounter machine one fixed tick, from the settled player pose.
 *
 * Returns what the rest of the step needs: whether locomotion is locked, whether
 * an overlay owns input (which freezes pursuit and detection), and the actor
 * poses the machines are overriding. It also writes the live overlay projection
 * and consumes the one-shot control the overlay set. Stepped BEFORE motion so a
 * lock can zero this tick's movement, using last tick's poses to seed an
 * approach — the same one-tick lag the pursuit runs on.
 */
function stepEncounters(runtime: MissionRuntime): EncounterStepAggregate {
  if (runtime.encounters.length === 0) {
    runtime.encounterLocked = false;
    runtime.encounterOwnsInput = false;
    runtime.encounterView = null;
    return { locked: false, ownsInput: false, overrides: NO_OVERRIDES };
  }
  const world = runtime.instance.world;
  const tick = runtime.clock.tick;
  const player = { pos: runtime.motion.pos, grounded: runtime.motion.grounded };
  let locked = false;
  let ownsInput = false;
  let view: ActiveEncounterView | null = null;
  const overrides: EncounterActorOverride[] = [];

  // The machine seeds an approach from the actor's real sim pose, so hand it the
  // watcher positions in its own shape. The cone facing is the body's start yaw.
  const facingById = new Map(runtime.watcherFacings.map((f) => [f.id, f.yaw]));
  const actorPoses = runtime.watcherPoses.map((pose) => ({
    id: pose.id,
    pos: pose.position,
    yaw: facingById.get(pose.id) ?? pose.baseYaw,
  }));

  for (const enc of runtime.encounters) {
    const id = enc.def.id;
    const result = stepEncounter(enc, {
      world,
      tick,
      player,
      actorPoses,
      dt: FIELD_DT,
      submit: runtime.encounterSubmit === id,
      verdict: runtime.encounterVerdictInbox.get(id) ?? null,
      dismiss: runtime.encounterDismiss === id,
    });
    if (result.locksLocomotion) locked = true;
    if (result.ownsInput) ownsInput = true;
    for (const pose of result.actorPoses) {
      overrides.push({ id: pose.id, pos: pose.pos, yaw: pose.yaw });
    }
    if (result.resolution) {
      applyEncounterResolution(runtime, result.resolution);
      // The verdict has been taken into RESOLVED; it must not be re-applied.
      runtime.encounterVerdictInbox.delete(id);
    }
    if (
      result.phase === "APPROACH" ||
      result.phase === "QUESTION" ||
      result.phase === "SUBMITTING" ||
      result.phase === "RESOLVED"
    ) {
      view = {
        encounterId: id,
        phase: result.phase,
        view: encounterClientView(enc.def, enc.variant),
        verdictKind: enc.verdictKind,
        reprieveWorldSeconds: enc.def.reprieveWorldSeconds,
      };
    }
  }

  // The submit and dismiss are one-shot edges: cleared every tick whether or not
  // an encounter took them, so a held key or a slow frame cannot fire twice.
  runtime.encounterSubmit = null;
  runtime.encounterDismiss = null;
  runtime.encounterLocked = locked;
  runtime.encounterOwnsInput = ownsInput;
  runtime.encounterView = view;
  // Ease the notice meter toward the controlling phase's target. Bound to real
  // encounter state, so the "you were spotted" surge is the stop arming, not a
  // cosmetic value the world does not act on.
  stepEncounterNotice(runtime, view?.phase ?? null);
  return { locked, ownsInput, overrides };
}

/** Whether every authored encounter has reached a verdict. The traversal gate. */
function encountersParticipated(runtime: MissionRuntime): boolean {
  return runtime.encounters.every((enc) => encounterResolved(enc));
}

/**
 * The active stop, for the CINEMATIC layer to frame — or null when no stop is
 * running. Pure read of the single source of truth.
 *
 * It carries only what the presentation needs and cannot influence a verdict:
 * the phase, the (server-authoritative) verdict once it lands, and the ids of
 * the speaker and any secondary so the stage can look up their live poses in
 * `watcherPoses`. The camera and the actor performance are procedural
 * presentation on top of the deterministic machine; this is the seam between
 * the two. Returns the first controlling machine — there is only ever one stop
 * active at a time on the M1 route.
 */
export interface EncounterCinematicRead {
  readonly encounterId: string;
  readonly phase: EncounterPhase;
  readonly verdictKind: EncounterVerdictKind | null;
  readonly speakerId: string;
  readonly secondaryId: string | null;
  /**
   * Live capsule-to-capsule separation of the speaker from the player, metres.
   * The authoritative distance the shot-readiness gate and the QA telemetry read;
   * the machine has already refused to open the question above ~2.2m, so this is
   * the number that proves it.
   */
  readonly speakerSeparationM: number;
}

export function encounterCinematicRead(
  runtime: MissionRuntime,
): EncounterCinematicRead | null {
  for (const enc of runtime.encounters) {
    if (
      enc.phase === "APPROACH" ||
      enc.phase === "QUESTION" ||
      enc.phase === "SUBMITTING" ||
      enc.phase === "RESOLVED"
    ) {
      const speakerPose = runtime.watcherPoses.find(
        (w) => w.id === enc.def.speaker.watcherId,
      );
      const separation = speakerPose
        ? Math.hypot(
            speakerPose.position.x - runtime.motion.pos.x,
            speakerPose.position.z - runtime.motion.pos.z,
          )
        : Number.POSITIVE_INFINITY;
      return {
        encounterId: enc.def.id,
        phase: enc.phase,
        verdictKind: enc.verdictKind,
        speakerId: enc.def.speaker.watcherId,
        secondaryId: enc.def.speaker.secondaryWatcherId,
        speakerSeparationM: separation,
      };
    }
  }
  return null;
}

/**
 * Overlay the encounter machines' actor poses onto a watcher-pose list.
 *
 * One source of truth: the field, the renderer and the overlay all read the
 * result of this, so the constable talking to the player stands, looks and
 * detects from exactly where the machine put him.
 */
function applyOverrides(
  poses: readonly WatcherPose[],
  overrides: readonly EncounterActorOverride[],
): readonly WatcherPose[] {
  if (overrides.length === 0) return poses;
  const byId = new Map(overrides.map((o) => [o.id, o]));
  return poses.map((pose) => {
    const o = byId.get(pose.id);
    return o ? { ...pose, position: o.pos } : pose;
  });
}

/**
 * Merge the field's per-watcher facing with the encounter overrides' yaws.
 *
 * Upsert rather than map, because an overridden actor may have been dropped from
 * the field's input this tick (suppressed, or the whole field frozen), so his id
 * need not be present in `facings` — and he still has to face the player.
 */
function mergeFacings(
  facings: readonly { id: string; yaw: number }[],
  overrides: readonly EncounterActorOverride[],
): { id: string; yaw: number }[] {
  if (overrides.length === 0) return [...facings];
  const yawById = new Map(overrides.map((o) => [o.id, o.yaw]));
  const out = facings.map((f) =>
    yawById.has(f.id) ? { id: f.id, yaw: yawById.get(f.id)! } : f,
  );
  const present = new Set(out.map((f) => f.id));
  for (const o of overrides) {
    if (!present.has(o.id)) out.push({ id: o.id, yaw: o.yaw });
  }
  return out;
}

/** One fixed step. Pure with respect to the clock: dt is always FIELD_DT. */
function stepOnce(
  runtime: MissionRuntime,
  frame: MissionInputFrame,
  latched: { jump: boolean; dash: boolean; hitCell: number | null },
): void {
  const { instance } = runtime;
  const world = instance.world;
  const tick = runtime.clock.tick;

  // The pose this step starts from, kept so the renderer can interpolate across
  // the gap between fixed steps and render frames. Recorded per step rather
  // than per frame because a long frame runs several steps, and the renderer
  // needs the one immediately before the last — not the one before the batch.
  runtime.prevPos = runtime.motion.pos;
  runtime.prevYaw = runtime.motion.yaw;

  // Perspective encounters step first, from last tick's settled pose, so a lock
  // this tick can zero movement and a freeze can suspend pursuit and detection.
  // Skipped entirely while an external surface (the abandon modal) owns time.
  const enc: EncounterStepAggregate = frame.flowEnabled
    ? stepEncounters(runtime)
    : {
        locked: runtime.encounterLocked,
        ownsInput: runtime.encounterOwnsInput,
        overrides: NO_OVERRIDES,
      };
  // While a stop holds the player, one-shot presses are dropped rather than
  // buffered, so nothing fires on release. The overlay clears the browser-side
  // latches too; this is the belt inside the sim.
  if (enc.locked) {
    latched.jump = false;
    latched.dash = false;
    latched.hitCell = null;
  }
  const frozen = enc.ownsInput;

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
  // A locked player does not move: the encounter has hold of them and only the
  // scripted actor approach continues. Motion still integrates (gravity, settle)
  // so a locked player standing is not frozen mid-fall.
  const moving = !enc.locked && Math.hypot(frame.moveX, frame.moveZ) > 1e-3;
  let speed = freeMoveSpeed({
    shiftHeld: frame.sprintHeld && !enc.locked,
    moving,
    crouched,
    actionActive,
  });
  const guidanceMark = standingObjective(runtime)?.objective.mark ?? null;
  // The active SAFE leg's authored pace caps free movement, even with Shift held.
  // The ropewalk tie beam is 1.6m wide and authored at 2.3 m/s; a sprint entry
  // off the hatch overshoots it into the dark, and telling the player only after
  // the reader has already braked them at the lip is not landing the beam. The
  // cap is authored per-leg — most legs have none and run at full pace — and the
  // wayfinder exposes it for the committed leg. Never raised, only lowered.
  const legCap = guidanceMark?.speedCapMps?.(runtime.motion.pos) ?? null;
  if (legCap !== null && !actionActive) speed = Math.min(speed, legCap);
  const length = moving ? Math.hypot(frame.moveX, frame.moveZ) : 1;
  const targetVelX = moving ? (frame.moveX / length) * speed : 0;
  const targetVelZ = moving ? (frame.moveZ / length) * speed : 0;

  // Whether the reader may climb an incidental face off Shift alone. It may when
  // the committed guidance points UP — the active waypoint sits meaningfully
  // above the feet, as at the Shambles crates or the Town House safe tower — and
  // must not when guidance is a same-height/lower run past a climb face, which is
  // the Town House cornice: the marker calls for the same-height C_CORNICE_S and
  // a held sprint used to be read as consent to climb the 2.2m east face off its
  // route. Measured height against the committed waypoint, no node ids; a
  // buffered Space still climbs, and with no waypoint the reader keeps its
  // default. See flow.ts `inferredAscentAllowed`.
  const guidanceWaypoint = guidanceMark?.waypoint?.(runtime.motion.pos) ?? null;
  const inferredAscentAllowed = guidanceWaypoint
    ? guidanceWaypoint.pos.y - runtime.motion.pos.y > ASCENT_GUIDANCE_MIN_M
    : true;

  // The committed guidance may be holding a directed action gateway — a vault,
  // climb or leap it will not retire until the body performs it. When it is, hand
  // the reader the authored axis and the verb family so it probes the action's
  // own line (not a live slide a few degrees off it) and can only commit that
  // family. flow.ts still requires the player to be pushing along the axis, and
  // still runs the full plan/commit/preflight — this steers the read, it does not
  // force the action. A lock suppresses it, like every other committed verb.
  const gatewaySignal =
    frame.flowEnabled && !enc.locked ? (guidanceMark?.gateway?.() ?? null) : null;

  const flowResult = stepFlow(world, runtime.motion, runtime.flow, {
    dt: FIELD_DT,
    targetVelX,
    targetVelZ,
    sprintHeld: frame.sprintHeld && !enc.locked,
    crouchHeld: frame.crouchHeld,
    jumpBuffered: latched.jump,
    dashBuffered: latched.dash,
    // A lock stops the flow reader committing verbs, the same way an external
    // pause does; the body still integrates.
    flowEnabled: frame.flowEnabled && !enc.locked,
    reducedMotion: frame.reducedMotion,
    receivingTargets: instance.receivingTargets,
    inferredAscentAllowed,
    guidedAxisX: gatewaySignal?.axisX,
    guidedAxisZ: gatewaySignal?.axisZ,
    guidedVerbs: gatewaySignal?.allowedVerbs,
  });
  runtime.motion = flowResult.motion;
  runtime.flow = flowResult.flow;

  // ALWAYS-ON NON-PENETRATION INVARIANT (dev/test only). Every tick, assert the
  // player capsule did not end inside a solid collider or with a deck plane
  // through its torso — and if it did, report the offending collider, position
  // and verb. This is the check the traversal fuzzer gates on, so a regression
  // that slips past the seeded harness still announces itself the instant it
  // happens in a real session. Throttled to one line per collider so a wedged
  // body does not flood the console, and stripped from production builds.
  assertNonPenetration(world, runtime.motion, runtime.flow.verb, runtime.ticks);

  // A traversal that finished this tick, captured once for the guidance to credit
  // to a directed link. The landing surface is what the feet are on now.
  runtime.completion = null;
  for (const event of flowResult.events) {
    if (event.type === "landed" && event.landing === "HARD") {
      note(runtime, "HARD_LANDING", `${event.dropM?.toFixed(1) ?? "?"}m`);
    }
    // The body did the thing, so the player has now seen what the thing is. A
    // Set rather than a count: the cue teaches a vocabulary, and vaulting the
    // same crate six times is one word learned, not six.
    if (event.type === "verbCommitted") runtime.verbsUsed.add(event.verb);
    if (
      event.type === "verbCompleted" ||
      event.type === "landed" ||
      event.type === "leapReceived"
    ) {
      runtime.completion = {
        verb: event.verb,
        landingId: groundedSupport(world, runtime.motion.pos)?.id ?? null,
      };
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

  const beatNoise = stepBeatForTick(runtime, read, latched.hitCell);

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

  // The watchers' legs, stepped BEFORE the field and against LAST tick's alert
  // states. This is the call that was missing: the field resolves cones from
  // poses, so the poses have to exist first, and the level's
  // `watcherPosesAtTick` is a pure function of the clock that no amount of
  // escalation could ever reach. Handing the field `pursuit.poses` rather than
  // the authored anchors is the whole of the wiring — pass the anchors and every
  // watcher goes back to being unable to take a step. See stealth/pursuit.ts.
  //
  // Suspended ticks step nobody, for the same reason they do not burn the hunt's
  // clock: a UI surface owns time, and a constable who walks across the square
  // behind a pause menu is a constable the player never saw coming.
  // A frozen tick — an open question owns time — steps no watcher's legs, the
  // same rule the external pause follows: a constable who closed on the player
  // while they were reading a question is a constable they never saw coming.
  const anchors = instance.watcherPosesAtTick(tick, runtime.seed);
  const pursuit =
    frame.flowEnabled && !frozen
      ? stepWatcherPursuit(world, runtime.pursuit, {
          dt: FIELD_DT,
          anchors,
          alerts: runtime.stealth.watchers,
        })
      : { states: runtime.pursuit, poses: runtime.watcherPoses, events: NO_PURSUIT_EVENTS };
  // The encounter machines own their actors' poses while a stop runs. Overlaying
  // here is what makes the runtime one source of truth: the field below, the
  // renderer, and the overlay all read these exact poses, and the pursuit state
  // is kept in step so releasing an actor does not snap him back.
  runtime.pursuit = pursuit.states;
  runtime.watcherPoses = applyOverrides(
    pursuit.poses.length > 0 ? pursuit.poses : anchors,
    enc.overrides,
  );
  if (enc.overrides.length > 0) {
    const overrideById = new Map(enc.overrides.map((o) => [o.id, o]));
    runtime.pursuit = runtime.pursuit.map((state) => {
      const o = overrideById.get(state.id);
      return o ? { ...state, position: { ...o.pos }, yaw: o.yaw } : state;
    });
  }
  for (const event of pursuit.events) {
    if (event.type === "leftPost") note(runtime, "WATCH_MOVED", event.watcherId);
  }

  // Lift the durable clear on any talked-down guard the player has now walked
  // clear of, then drop everyone still cleared (and everyone in the bounded
  // ledger) from the field's input. This is the fix for the re-arming bar: while
  // a cleared guard stays in this set his cone accrues nothing no matter how long
  // the player lingers, so an answered stop cannot silently reopen into a chase.
  pruneEncounterClears(runtime);

  const fieldResult = stepStealthField(world, runtime.stealth, {
    dt: FIELD_DT,
    tick,
    seed: runtime.seed,
    // Suppressed watchers are dropped from the field's input, so their cones
    // accrue nothing — while they stay in `runtime.watcherPoses` and are drawn
    // the whole time. Scoped by id; the bounded ledger (`suppression`) is the
    // immediate grace window and the durable `encounterClears` set is what keeps
    // an ANSWERED guard talked down until the player leaves. See
    // stealth/suppression.ts and `pruneEncounterClears`.
    watchers: fieldWatchers(runtime, tick),
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
    // A frozen question suspends accrual and the hunt, so detection cannot climb
    // and the search clock does not run while the player is reading.
    suspendAccrual: !frame.flowEnabled || frozen,
  });
  runtime.stealth = fieldResult.state;
  // The overridden actors face the player (the machine's yaw), not the cone's,
  // while a stop runs; every other watcher keeps the field's facing. Upserted so
  // an actor dropped from the field input (suppressed, or frozen tick) still
  // gets the machine's facing.
  runtime.watcherFacings = mergeFacings(fieldResult.facings, enc.overrides);
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

  // The participation gate. The route cannot resolve to the duel until every
  // authored encounter has reached a verdict — a WRONG one counts, so a model
  // outage or a bad answer cannot soft-lock the run, but a player cannot skip a
  // stop by running past it either. With no encounters this is vacuously true
  // and traversal is unchanged.
  if (requiredObjectivesMet(runtime) && encountersParticipated(runtime)) {
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
      hitConsumed: false,
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
  // the panel strike it is a stray for every step but the one that landed.
  const latched: { jump: boolean; dash: boolean; hitCell: number | null } = {
    jump: frame.jumpBuffered,
    dash: frame.dashBuffered ?? false,
    hitCell: frame.hitCellBuffered ?? null,
  };
  const consumed = { jump: false, dash: false, hit: false };
  for (let tick = advanced.firstTick; tick <= advanced.lastTick; tick += 1) {
    // The clock's tick is the authority the field systems read, so it is set
    // per step rather than left at the end of the frame's run of steps.
    runtime.clock = { ...runtime.clock, tick };
    stepOnce(runtime, frame, latched);
    // The one place the standing objective's waypoint is advanced. Driven from
    // the authoritative post-step position, once per fixed tick, so the guidance
    // is a pure function of the ticks the run played and no drawing surface can
    // move it. See `advanceWayfinding` and levelPort's mark `advance`/`waypoint`.
    advanceWayfinding(runtime);
    for (const action of ["jump", "dash"] as const) {
      if (!latched[action]) continue;
      latched[action] = false;
      consumed[action] = true;
    }
    if (latched.hitCell !== null) {
      latched.hitCell = null;
      consumed.hit = true;
    }
    if (runtime.outcome) break;
  }

  return {
    steps: advanced.steps,
    outcome: runtime.outcome,
    jumpConsumed: consumed.jump,
    dashConsumed: consumed.dash,
    hitConsumed: consumed.hit,
  };
}

/**
 * Anything further than this in one fixed step is a teleport, not motion.
 *
 * The fastest thing the body does is a burst at `dashSpeed(RUN_SPEED)`, about
 * 6.7 m/s, which is 0.11 m per step; a running jump is slower still. So a metre
 * in one step can only be an authored action snapping to a validated endpoint
 * or a dive being received, and smearing the render across one of those would
 * draw the player passing through the geometry the snap existed to avoid.
 */
const TELEPORT_M = 1;

/**
 * Where to DRAW the player this frame.
 *
 * Between the last completed fixed step and the next one, the clock is holding
 * unspent time in its accumulator. That fraction is exactly how far past the
 * last tick the current frame is, so it is exactly the blend between the two
 * poses the simulation actually produced. Nothing here is fed back into the
 * simulation — the simulation's position remains the tick's, and this is a
 * presentation value the renderer alone reads.
 */
export function missionRenderPose(runtime: MissionRuntime): {
  x: number;
  y: number;
  z: number;
  yaw: number;
} {
  const { motion, prevPos, prevYaw } = runtime;
  const alpha = Math.min(1, Math.max(0, runtime.clock.accumulatorS / FIELD_DT));
  const dx = motion.pos.x - prevPos.x;
  const dy = motion.pos.y - prevPos.y;
  const dz = motion.pos.z - prevPos.z;
  if (Math.hypot(dx, dy, dz) > TELEPORT_M) {
    return { x: motion.pos.x, y: motion.pos.y, z: motion.pos.z, yaw: motion.yaw };
  }
  let dYaw = motion.yaw - prevYaw;
  while (dYaw > Math.PI) dYaw -= Math.PI * 2;
  while (dYaw < -Math.PI) dYaw += Math.PI * 2;
  return {
    x: prevPos.x + dx * alpha,
    y: prevPos.y + dy * alpha,
    z: prevPos.z + dz * alpha,
    yaw: prevYaw + dYaw * alpha,
  };
}

export interface MissionObjectiveReadout {
  readonly id: string;
  readonly label: string;
  readonly required: boolean;
  readonly met: boolean;
}

/**
 * The one objective the run is on, and how far off it is.
 *
 * There is exactly one of these at a time and it is derived rather than
 * authored: the first required objective the run has not latched. A mission is
 * a sequence of required steps and a player mid-run can hold one of them in
 * their head, so the surfaces that report to them are given one — the list of
 * six the HUD used to print is a thing to read, and nobody reads at a sprint.
 *
 * Optional objectives are counted here and never named. They are challenges,
 * not instructions, and a player who is being told four extra things to do has
 * not been told the one thing they have to.
 */
export interface MissionStandingRead {
  readonly id: string;
  readonly label: string;
  /** 1-based place in the required sequence. */
  readonly step: number;
  readonly steps: number;
  /** The required step after this one, so the run has a shape and not just a next. */
  readonly thenLabel: string | null;
  /** Where it is, for an objective that is a place. Null for a condition. */
  readonly mark: MissionMarkRead | null;
  readonly optionalMet: number;
  readonly optionalTotal: number;
}

export interface MissionMarkRead {
  readonly pos: Vec3;
  readonly title: string;
  readonly detail: string | null;
  /** Metres still to travel: along the route where the level can walk it. */
  readonly rangeM: number;
  /** False when the range is the straight line because the route could not answer. */
  readonly viaRoute: boolean;
  /** How far the objective sits above the player's feet. Negative is below. */
  readonly riseM: number;
  /**
   * The authored pace of the current committed leg when it is capped below a
   * run, else null. The HUD reads it to post a walk cue before the roof lip.
   */
  readonly speedCapMps: number | null;
}

/**
 * The first required objective still unmet, or null once they all are.
 *
 * Read by the HUD's sample and by the mark inside the canvas, so the plate in
 * the street and the line in the corner cannot name two different things — a
 * marker pointing at the yard while the HUD still asks for the handbill is
 * worse than either surface alone.
 */
export function standingObjective(runtime: MissionRuntime): {
  readonly objective: MissionObjective;
  readonly step: number;
  readonly steps: number;
  readonly next: MissionObjective | null;
} | null {
  const required = runtime.instance.objectives.filter(
    (objective) => objective.required,
  );
  const met = new Set(runtime.satisfied);
  const index = required.findIndex((objective) => !met.has(objective.id));
  if (index < 0) return null;
  return {
    objective: required[index]!,
    step: index + 1,
    steps: required.length,
    next: required[index + 1] ?? null,
  };
}

/**
 * The mark's live read against a position, or null when there is nothing to
 * point at.
 *
 * THE NAME AND THE DISTANCE ARE THE OBJECTIVE'S; THE PLACE IS THE NEXT ONE ON
 * THE WAY. When the level can walk its own route it says where to head for
 * next, and that — not the objective's own coordinate — is what the ring lands
 * on and the arrow points at. The plate still reads "The Liberty Elm, 94 m",
 * because that is what the player is doing; it just no longer aims them through
 * a building on the strength of a straight line.
 *
 * The rise follows the place for the same reason. "Three metres up" about the
 * scaffold in front of you is a thing you can act on; "nine metres up" about a
 * tree you cannot see is trivia.
 */
/**
 * Advance the standing objective's waypoint one step. THE SOLE MUTATION OWNER
 * of wayfinding guidance.
 *
 * Called once per fixed tick by `stepMissionRuntime`, from the authoritative
 * post-integration position, and by nothing else in production. Every surface
 * that draws the mark — the HUD's periodic sample and the in-canvas
 * `VisorRunMark` — reads it back through `markRead`, which peeks and never
 * advances, so two consumers rendering at two different rates cannot each drive
 * the waypoint and walk it in a loop. A standing objective that is a condition
 * rather than a place carries no `advance` hook, and this does nothing.
 *
 * Exported so a test can advance guidance deterministically at a chosen
 * position without integrating a physics step.
 */
export function advanceWayfinding(runtime: MissionRuntime): void {
  const mark = standingObjective(runtime)?.objective.mark;
  if (!mark?.advance) return;
  const pos = runtime.motion.pos;
  mark.advance({
    pos,
    grounded: runtime.motion.grounded,
    supportId: runtime.motion.grounded
      ? groundedSupport(runtime.instance.world, pos)?.id ?? null
      : null,
    verb: runtime.flow.verb,
    completed: runtime.completion,
  });
}

export function markRead(
  objective: MissionObjective,
  from: Vec3,
): MissionMarkRead | null {
  const mark = objective.mark;
  if (!mark) return null;
  const walked = mark.rangeM?.(from) ?? null;
  const waypoint = mark.waypoint?.(from) ?? null;
  const pos = waypoint?.pos ?? mark.pos;
  return {
    pos,
    title: mark.title,
    detail: waypoint ? `by way of ${waypoint.via}` : (mark.detail ?? null),
    rangeM:
      walked?.metres ?? Math.hypot(mark.pos.x - from.x, mark.pos.z - from.z),
    viaRoute: walked?.viaRoute ?? false,
    riseM: pos.y - from.y,
    speedCapMps: mark.speedCapMps?.(from) ?? null,
  };
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
  /**
   * The one thing to be doing now, or null once every required step is done.
   *
   * Null is a real state and not an error: the run has cleared and the
   * container is about to resolve it, and a HUD that kept asking for the
   * handbill in that window would be asking for something already up.
   */
  readonly standing: MissionStandingRead | null;
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
  /**
   * The active perspective encounter, or null. The overlay reads the live
   * `runtime.encounterView` directly for responsiveness; this is the throttled
   * HUD copy. Client-safe: prompt and speaker only, never a rubric.
   */
  readonly encounter: ActiveEncounterView | null;
  /**
   * The encounter-notice meter, 0..1, driven by the live stop phase. The HUD
   * draws the max of this and the field's own suspicion, so the exposure bar
   * surges the instant a stop arms after the drop. Real state, not cosmetic.
   */
  readonly encounterNotice01: number;
  /** Resolved-stop summaries, for the HUD. Verdict kind only, never an answer. */
  readonly encounterSummaries: readonly EncounterSummary[];
}

export function missionPresentation(runtime: MissionRuntime): MissionPresentation {
  const met = new Set(runtime.satisfied);
  const mount = runtime.instance.beat;
  const optional = runtime.instance.objectives.filter(
    (objective) => !objective.required,
  );
  const standing = standingObjective(runtime);
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
    standing: standing
      ? {
          id: standing.objective.id,
          label: standing.objective.label,
          step: standing.step,
          steps: standing.steps,
          thenLabel: standing.next?.label ?? null,
          mark: markRead(standing.objective, runtime.motion.pos),
          optionalMet: optional.filter((objective) => met.has(objective.id))
            .length,
          optionalTotal: optional.length,
        }
      : null,
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
    encounter: runtime.encounterView,
    encounterNotice01: runtime.encounterNotice01,
    encounterSummaries: [...runtime.encounterSummaries.values()],
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
  runtime.verbsUsed.clear();
  // Encounter machines, the suppression ledger, the summaries and any pending
  // overlay control are all attempt-scoped, so a disposed runtime holding them
  // is the slow leak this function exists to prevent. The next attempt builds
  // fresh machines and an empty ledger in `createMissionRuntime`.
  runtime.encounters.length = 0;
  runtime.suppression = NO_SUPPRESSION;
  runtime.encounterClears.clear();
  runtime.encounterVerdictInbox.clear();
  runtime.encounterSummaries.clear();
  runtime.encounterView = null;
  runtime.encounterSubmit = null;
  runtime.encounterDismiss = null;
  // The beat run is deliberately left alone. It is bounded — one chart and at
  // most a stroke per beat — so it is not the kind of thing this function is
  // for, and clearing it would make a disposed runtime one that silently has no
  // beat. The next attempt builds its own runtime and derives its own chart.
}
