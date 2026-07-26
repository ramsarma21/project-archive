// Player locomotion state + physics (World-Built-State §locomotion). Pure,
// deterministic and THREE-free: the Player component is the sole owner of the
// visible transform, and it drives every frame through `stepMotion`. The old
// 2D circle-vs-AABB mover, the `position.y > 0.45` collider bypass, and the
// TraversalDirector's per-frame position tween are all replaced by this.
//
// The motion model is a discriminated state machine. Free locomotion is
// grounded velocity + support snapping; free jumps are true ballistic arcs
// swept against every obstacle; authored affordances (vault/climb/duck) run a
// deterministic, root-neutral path bound to their authored anchors. MANTLE is
// present in the type but permanently disabled until a dedicated clip lands —
// it never falls back to another animation.

import {
  type CollisionWorld,
  type Vec3,
  sweepXZ,
  slideVelocityXZ,
  supportBelow,
  headClearance,
  canStand,
  landingValid,
  PHYSICS_SUBSTEP,
  CAPSULE_RADIUS,
  STAND_HEIGHT,
  CROUCH_HEIGHT,
  CONTACT_EPS,
} from "./collision.js";

// ---- tuning constants ------------------------------------------------------

export const GRAVITY = 10.8; // m/s^2 (apex ~1.2m for the standing jump)
export const STANDING_JUMP_VY = 5.2; // -> apex vy^2/2g = 1.25m
export const RUNNING_JUMP_VY = 5.2;
export const RUN_JUMP_MIN_SPEED = 1.2; // forward speed that arms the running jump
export const RUN_JUMP_FORWARD_DOT = 0.6; // body-forward alignment for running jump
export const MAX_STANDING_DRIFT = 0.05; // <5cm horizontal drift budget
export const COYOTE_MS = 100; // grace after walking off a ledge
export const STEP_DOWN = 0.35; // max ledge stepped down without falling
export const WALK_SPEED = 2.3;
export const RUN_SPEED = 4.6;
export const CROUCH_SPEED = 1.15;
const ACCEL = 9;
const DECEL = 14;
const MAX_DT = 0.05;

// ---- burst tuning ----------------------------------------------------------
//
// One burst, shared by every system that needs a short directed surge: the duel's
// dodge, a parkour dash, and any future movement ability (a grapple pull is the
// same physical act with a different direction source). Because they are all the
// same phase driving the same integrator, a dash across a rooftop and a dodge in a
// duel move identically.

/**
 * Multiple of the caller's base speed a burst travels at.
 *
 * THE TUNED QUANTITY IS THE DISTANCE, NOT THIS NUMBER. A burst from a standing
 * start covers ~2.22 m, which is what the duel's dodge, its boss evasion curves and
 * its whole winnability table were measured against.
 *
 * This was 2.6 when the burst accelerated into its speed from a scaled target
 * velocity. Setting the velocity outright instead is a real improvement in feel —
 * see `beginDash` — but at an unchanged scale it stretched the same burst to 3.99 m,
 * which in a compact courtyard is a large fraction of the arena. 1.45 keeps the
 * snappier onset and restores the tuned distance exactly. If a longer burst turns
 * out to be better, change it deliberately against fresh numbers.
 */
export const DASH_SPEED_SCALE = 1.45;
/** Authored length of a burst. */
export const DASH_DURATION_MS = 320;

/** Burst speed for a base locomotion speed. The multiply lives in the engine. */
export function dashSpeed(baseSpeed: number, scale = DASH_SPEED_SCALE): number {
  return baseSpeed * scale;
}

// ---- launch scaling --------------------------------------------------------
//
// A jump's launch velocity may be scaled by the caller. That is the whole of the
// mechanism: `beginStandingJump(state, 1.45)` sets a higher vy and the SAME
// ballistic integrator produces the arc, so a boosted jump still sweeps against
// every obstacle, still clips its head on an overhang and still lands only on
// validated support. It is an impulse to velocity, never a write to position.
//
// THE FLOOR IS 1, DELIBERATELY. This channel may only ever ADD height.
//
// A launch scale below 1 would be a per-player movement penalty, and a per-player
// movement penalty is a difficulty band wearing different clothes — the same thing
// stealth/tuning.ts deleted STANDING_FACTORS and HEAT_FACTORS to be rid of. Refusing
// the whole lower half of the range in the engine means no caller can express one,
// however well-intentioned. If a carried-load system ever genuinely needs a
// penalty, it should widen this clamp on purpose, with its own reasoning next to it,
// rather than inherit the ability channel's licence by accident.
//
// The ceiling is 2, which is a 4x apex: 1.25 m becomes 5.0 m. Above the engine's
// own 3.2 m climb limit the geometry stops being something level design can reason
// about, so 2 is the point past which a number is a bug rather than a decision.

export const MIN_JUMP_LAUNCH_SCALE = 1;
export const MAX_JUMP_LAUNCH_SCALE = 2;

/** Clamp a launch scale into the legal band. Non-finite input is neutral. */
export function jumpLaunchScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_JUMP_LAUNCH_SCALE;
  return Math.min(MAX_JUMP_LAUNCH_SCALE, Math.max(MIN_JUMP_LAUNCH_SCALE, scale));
}

// ---- contact tuning --------------------------------------------------------
//
// A non-lethal grab, shoulder check or crowd collision. The player loses control
// for a short window and is pushed off their line; they never lose the run, and
// nothing here touches the body that made contact.
//
// THIS IS A PENALTY THE PLAYER SUFFERS, NOT A CAPABILITY THE PLAYER WIELDS, and
// that distinction is the reason it is safe to build when a non-lethal takedown was
// refused. A takedown deletes a guard, and once a guard can be deleted the
// diversion, the crowd blend and the reflex window are all slower answers to a
// solved problem. A stagger deletes nothing: it is the cost of having been touched,
// so AVOIDING contact strictly dominates recovering from it, at every recovery
// scale, forever. See contact.ts, which is the only way to open one.

/** How a body made contact. Drives the window, the push and the noise. */
export type ContactKind = "GRAB" | "SHOULDER" | "CROWD";

/** Authored recovery window per contact kind, before any ability scaling. */
export const CONTACT_STAGGER_MS: Readonly<Record<ContactKind, number>> = {
  GRAB: 900,
  SHOULDER: 520,
  CROWD: 380,
};

/** Push speed away from the contact, in m/s. Decays across the window. */
export const CONTACT_PUSH_MPS: Readonly<Record<ContactKind, number>> = {
  GRAB: 1.2,
  SHOULDER: 2,
  CROWD: 1,
};

/**
 * Shortest a recovery may ever be, as a fraction of its authored window.
 *
 * THE FLOOR IS NOT ZERO, AND THAT IS THE SCARCITY GUARANTEE. At zero the stagger
 * would be a no-op and walking into a guard would become a legal route — which is
 * the rejected takedown arriving through the back door. At 0.2 the best ability in
 * the game still leaves a fifth of the window, and leaves the noise untouched, so
 * being grabbed is always worse than not being grabbed.
 */
export const MIN_STAGGER_RECOVERY_SCALE = 0.2;
/** A recovery may be shortened, never lengthened: 1 is the authored window. */
export const MAX_STAGGER_RECOVERY_SCALE = 1;

/** Clamp a recovery scale into the legal band. Non-finite input is neutral. */
export function staggerRecoveryScale(scale: number): number {
  if (!Number.isFinite(scale)) return MAX_STAGGER_RECOVERY_SCALE;
  return Math.min(
    MAX_STAGGER_RECOVERY_SCALE,
    Math.max(MIN_STAGGER_RECOVERY_SCALE, scale),
  );
}

export type MotionPhase =
  | "GROUNDED"
  | "CROUCH"
  | "DASH"
  | "STAGGER"
  | "STANDING_JUMP"
  | "RUNNING_JUMP"
  | "FALLING"
  | "VAULT"
  | "CLIMB_UP"
  | "CLIMB_DOWN"
  | "DUCK_UNDER"
  | "MANTLE"; // permanently disabled; never entered

export const AIRBORNE_PHASES: ReadonlySet<MotionPhase> = new Set<MotionPhase>([
  "STANDING_JUMP",
  "RUNNING_JUMP",
  "FALLING",
]);
export const AUTHORED_PHASES: ReadonlySet<MotionPhase> = new Set<MotionPhase>([
  "VAULT",
  "CLIMB_UP",
  "CLIMB_DOWN",
  "DUCK_UNDER",
]);
/**
 * Velocity-driven bursts. Deliberately NOT an authored phase: an authored action
 * follows a fixed anchored trajectory, while a burst is ordinary grounded motion
 * with the target velocity scaled up, and therefore still collides, slides along
 * walls, snaps to support and falls off ledges exactly like running does.
 *
 * STAGGER is a burst for exactly the same reason and by exactly the same mechanism:
 * a shove is a substituted target velocity handed to `stepGrounded`. One of them is
 * the player's idea and the other is not, which is a difference of authorship rather
 * than of physics. Both being in this set also means `canDash` refuses during a
 * stagger — you cannot burst out of having been grabbed.
 */
export const BURST_PHASES: ReadonlySet<MotionPhase> = new Set<MotionPhase>([
  "DASH",
  "STAGGER",
]);

export interface AuthoredAnchor {
  x: number;
  y: number;
  z: number;
  yaw?: number;
}

export interface AuthoredAction {
  kind: "VAULT" | "CLIMB_UP" | "CLIMB_DOWN" | "DUCK_UNDER";
  anchors: AuthoredAnchor[];
  durationMs: number;
  elapsedMs: number;
  ignore: ReadonlySet<string>; // obstacle(s) ignored during the clearance
  arcHeight: number; // extra loft for vault (non-ballistic, obstacle-bound)
  // Climb-down faces the obstacle throughout then restores outward facing;
  // the outward normal is derived from the anchors (obstacle -> actor).
  faceObstacle: boolean;
  // rollback endpoints (validated at begin): start and end are the only two
  // places a cancelled/invalidated action may snap to — never a midpoint.
  startPos: Vec3;
  startYaw: number;
  endPos: Vec3;
  endYaw: number;
}

/**
 * An open burst. Exposed on MotionState so layers above can observe the window
 * without owning it: the duel hangs immunity frames and its use ledger on these
 * ticks, and a renderer hangs a trail or a camera kick on them. The window is
 * motion's; the meanings are the caller's.
 */
export interface DashWindow {
  /** Unit XZ direction, fixed at the start. A burst is a commitment. */
  dirX: number;
  dirZ: number;
  /** Burst speed in m/s. Handed to the integrator as a target velocity. */
  speed: number;
  elapsedMs: number;
  durationMs: number;
  /** Stance to restore on exit, so a burst from a crouch ends crouched. */
  fromPhase: "GROUNDED" | "CROUCH";
}

/**
 * An open stagger. Same shape as `DashWindow` on purpose — it is the same kind of
 * thing, a bounded window during which the target velocity is substituted — with two
 * additions that exist only so a caller can attribute the contact for noise and
 * presentation.
 *
 * NOTE WHAT IS ABSENT, AND KEEP IT ABSENT: there is no field here describing the
 * body that made contact beyond an opaque id, and nothing anywhere returns a state
 * for it. A stagger is a thing that happens TO the player. See
 * `assertContactCannotAffectTheOtherBody` in contact.ts.
 */
export interface StaggerWindow {
  /** Unit XZ push direction, away from the contact. Fixed at the start. */
  dirX: number;
  dirZ: number;
  /** Push speed in m/s at the start; decays linearly across the window. */
  speed: number;
  elapsedMs: number;
  durationMs: number;
  /** Stance to restore on exit. */
  fromPhase: "GROUNDED" | "CROUCH";
  kind: ContactKind;
  /** Opaque id of the body that made contact, for noise attribution and tells. */
  sourceId: string | null;
}

export interface MotionState {
  phase: MotionPhase;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  capsuleHeight: number;
  grounded: boolean;
  airtimeMs: number;
  action: AuthoredAction | null;
  dash: DashWindow | null;
  stagger: StaggerWindow | null;
}

export interface MotionInput {
  dt: number;
  // Desired world-space horizontal velocity this frame (camera-relative,
  // already scaled to the target speed). Ignored while airborne/authored.
  targetVelX: number;
  targetVelZ: number;
  reducedMotion: boolean;
}

export type MotionEventType =
  | "landed"
  | "actionComplete"
  | "actionCancelled"
  | "jumpStarted"
  | "dashStarted"
  | "dashEnded"
  | "staggerStarted"
  | "staggerEnded";

export interface MotionResult {
  state: MotionState;
  events: MotionEventType[];
}

// ---- constructors ----------------------------------------------------------

export function createGroundedState(pos: Vec3, yaw: number): MotionState {
  return {
    phase: "GROUNDED",
    pos: { ...pos },
    vel: { x: 0, y: 0, z: 0 },
    yaw,
    capsuleHeight: STAND_HEIGHT,
    grounded: true,
    airtimeMs: 0,
    action: null,
    dash: null,
    stagger: null,
  };
}

// ---- vector helpers --------------------------------------------------------

function horizSpeed(v: Vec3): number {
  return Math.hypot(v.x, v.z);
}

function shortestAngle(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ---- jump initiation -------------------------------------------------------

// Standing jump: primarily vertical, negligible horizontal drift. Only allowed
// from a grounded/crouch state.
//
// `launchScale` multiplies the vertical launch only, and only upward (see
// `jumpLaunchScale`). Horizontal reach is deliberately untouched: distance is the
// move-speed channel's business, which keeps "jump higher" and "travel further" two
// separate decisions instead of one number that quietly does both.
export function beginStandingJump(
  state: MotionState,
  launchScale = MIN_JUMP_LAUNCH_SCALE,
): MotionState {
  return {
    ...state,
    phase: "STANDING_JUMP",
    capsuleHeight: STAND_HEIGHT,
    grounded: false,
    airtimeMs: 0,
    vel: { x: 0, y: STANDING_JUMP_VY * jumpLaunchScale(launchScale), z: 0 },
    action: null,
    dash: null,
    stagger: null,
  };
}

// Running jump: preserves the launch horizontal velocity into an honest arc.
// No teleport, no collider bypass, minimal air steering (none applied here).
export function beginRunningJump(
  state: MotionState,
  launchScale = MIN_JUMP_LAUNCH_SCALE,
): MotionState {
  return {
    ...state,
    phase: "RUNNING_JUMP",
    capsuleHeight: STAND_HEIGHT,
    grounded: false,
    airtimeMs: 0,
    vel: {
      x: state.vel.x,
      y: RUNNING_JUMP_VY * jumpLaunchScale(launchScale),
      z: state.vel.z,
    },
    action: null,
    dash: null,
    stagger: null,
  };
}

// ---- burst initiation ------------------------------------------------------

/** Can a burst start from this state? A burst is grounded and not mid-action. */
export function canDash(state: MotionState): boolean {
  return (
    state.grounded &&
    state.action === null &&
    !AIRBORNE_PHASES.has(state.phase) &&
    !AUTHORED_PHASES.has(state.phase) &&
    !BURST_PHASES.has(state.phase)
  );
}

/**
 * Open a burst in a direction. This is the shared dodge/dash/pull.
 *
 * THE BURST IS A SCALE ON THE TARGET VELOCITY HANDED TO THE EXISTING INTEGRATOR,
 * NEVER A DISPLACEMENT. `stepDash` below hands the burst velocity to the same
 * `stepGrounded` that walking uses, so acceleration, swept collision, wall slide,
 * support snapping, ledge fall and bounds clamping are all unchanged and
 * unduplicated. That is exactly why a dodge in a duel and a dash across a rooftop
 * behave identically — it is not two implementations that agree, it is one.
 *
 * The initial velocity is set outright rather than accelerated into, matching
 * `beginRunningJump`: a burst that ramps up over a fifth of a second does not read
 * as a burst. That is an impulse to velocity, not a write to position.
 *
 * Returns the state unchanged when a burst is not currently legal, so a caller may
 * treat it as a no-op; use `canDash` when the refusal needs to be observed. Not
 * available airborne: an air dash is an ability decision, and adding an untested
 * airborne branch here would be speculation.
 */
export function beginDash(
  state: MotionState,
  dirX: number,
  dirZ: number,
  speed: number,
  durationMs: number = DASH_DURATION_MS,
): MotionState {
  const length = Math.hypot(dirX, dirZ);
  if (length < 1e-6 || speed <= 0 || !canDash(state)) return state;
  const unitX = dirX / length;
  const unitZ = dirZ / length;
  return {
    ...state,
    phase: "DASH",
    vel: { x: unitX * speed, y: 0, z: unitZ * speed },
    action: null,
    stagger: null,
    dash: {
      dirX: unitX,
      dirZ: unitZ,
      speed,
      elapsedMs: 0,
      durationMs: Math.max(1000 / 60, durationMs),
      fromPhase: state.phase === "CROUCH" ? "CROUCH" : "GROUNDED",
    },
  };
}

/** Is a burst open? */
export function isDashing(state: MotionState): boolean {
  return state.phase === "DASH" && state.dash !== null;
}

/** Milliseconds left in the open burst, or 0. */
export function dashRemainingMs(state: MotionState): number {
  if (!state.dash) return 0;
  return Math.max(0, state.dash.durationMs - state.dash.elapsedMs);
}

/** Progress through the open burst, 0..1. For i-frame windows and presentation. */
export function dashProgress(state: MotionState): number {
  if (!state.dash || state.dash.durationMs <= 0) return 0;
  return Math.min(1, state.dash.elapsedMs / state.dash.durationMs);
}

/** End a burst early, keeping whatever velocity the integrator has produced. */
export function cancelDash(state: MotionState): MotionState {
  if (!isDashing(state)) return state;
  return {
    ...state,
    phase: state.dash!.fromPhase,
    capsuleHeight:
      state.dash!.fromPhase === "CROUCH" ? CROUCH_HEIGHT : state.capsuleHeight,
    dash: null,
  };
}

// ---- stagger initiation ----------------------------------------------------

/**
 * Can a stagger open from this state?
 *
 * Grounded, not mid-authored-action, not already staggered — the same conditions a
 * burst needs, with one deliberate difference: a stagger MAY interrupt an open
 * DASH. Contact has to land on a player who is bursting, or the burst becomes a
 * contact immunity and "dash through the crowd" turns the whole contact model off.
 * Combined with `canDash` refusing during a stagger, the burst neither prevents
 * contact nor escapes it.
 *
 * Airborne contact is not modelled. A body cannot shoulder-check somebody who is
 * mid-vault, and level design puts crowds on the ground.
 */
export function canStagger(state: MotionState): boolean {
  return (
    state.grounded &&
    state.action === null &&
    !AIRBORNE_PHASES.has(state.phase) &&
    !AUTHORED_PHASES.has(state.phase) &&
    state.stagger === null
  );
}

/**
 * Open a recovery window after non-lethal body contact.
 *
 * Prefer `resolveContact` in contact.ts, which is the only path that also emits the
 * noise. This is exposed because the phase belongs to motion, in the same way
 * `beginDash` is exposed and the duel wraps it with combat meaning.
 *
 * THE PUSH IS A SUBSTITUTED TARGET VELOCITY, exactly as a burst is. `stepStagger`
 * hands a decaying push to the same `stepGrounded` walking uses, so a staggering
 * player still collides, still slides along walls, still snaps to support and still
 * falls off a ledge they were shoved over. No second integrator, no position write.
 *
 * `recoveryScale` shortens the window and may only ever shorten it (see
 * `staggerRecoveryScale`): it is clamped to a floor above zero, so no ability can
 * make being grabbed free.
 *
 * Returns the state unchanged when a stagger is not legal; use `canStagger` when the
 * refusal needs to be observed.
 */
export function beginStagger(
  state: MotionState,
  input: {
    kind: ContactKind;
    /** Direction the push travels, away from the contact. Need not be unit. */
    dirX: number;
    dirZ: number;
    sourceId?: string | null;
    recoveryScale?: number;
  },
): MotionState {
  if (!canStagger(state)) return state;
  const length = Math.hypot(input.dirX, input.dirZ);
  // A contact with no direction still costs the window; it just does not push.
  const unitX = length < 1e-6 ? 0 : input.dirX / length;
  const unitZ = length < 1e-6 ? 0 : input.dirZ / length;
  const scale = staggerRecoveryScale(input.recoveryScale ?? MAX_STAGGER_RECOVERY_SCALE);
  const fromPhase = state.phase === "CROUCH" ? "CROUCH" : "GROUNDED";
  const speed = CONTACT_PUSH_MPS[input.kind];
  return {
    ...state,
    phase: "STAGGER",
    vel: { x: unitX * speed, y: 0, z: unitZ * speed },
    action: null,
    dash: null,
    stagger: {
      dirX: unitX,
      dirZ: unitZ,
      speed,
      elapsedMs: 0,
      durationMs: Math.max(1000 / 60, CONTACT_STAGGER_MS[input.kind] * scale),
      fromPhase,
      kind: input.kind,
      sourceId: input.sourceId ?? null,
    },
  };
}

/** Is a recovery window open? */
export function isStaggered(state: MotionState): boolean {
  return state.phase === "STAGGER" && state.stagger !== null;
}

/** Milliseconds left in the open recovery, or 0. */
export function staggerRemainingMs(state: MotionState): number {
  if (!state.stagger) return 0;
  return Math.max(0, state.stagger.durationMs - state.stagger.elapsedMs);
}

/** Progress through the open recovery, 0..1. For HUD and presentation. */
export function staggerProgress(state: MotionState): number {
  if (!state.stagger || state.stagger.durationMs <= 0) return 0;
  return Math.min(1, state.stagger.elapsedMs / state.stagger.durationMs);
}

// Free C crouch is independent of authored DUCK_UNDER. C toggles this state;
// standing is refused until a full-height capsule fits at the current feet.
export function toggleFreeCrouch(
  world: CollisionWorld,
  state: MotionState,
): { state: MotionState; changed: boolean } {
  if (!state.grounded || state.action || AIRBORNE_PHASES.has(state.phase)) {
    return { state, changed: false };
  }
  if (state.phase === "CROUCH") {
    if (!canStand(world, state.pos.x, state.pos.z, CAPSULE_RADIUS, state.pos.y)) {
      return { state, changed: false };
    }
    return {
      state: { ...state, phase: "GROUNDED", capsuleHeight: STAND_HEIGHT },
      changed: true,
    };
  }
  if (state.phase !== "GROUNDED") return { state, changed: false };
  return {
    state: { ...state, phase: "CROUCH", capsuleHeight: CROUCH_HEIGHT },
    changed: true,
  };
}

// Begin an authored affordance. Anchors already carry world y; displacement is
// owned entirely by these anchors (the clip is root-neutral). Returns null if
// the endpoints do not validate (invalid preflight does nothing).
export function beginAuthored(
  world: CollisionWorld,
  state: MotionState,
  spec: {
    kind: AuthoredAction["kind"];
    anchors: AuthoredAnchor[];
    durationMs: number;
    ignore?: Iterable<string>;
    arcHeight?: number;
  },
): MotionState | null {
  const anchors = spec.anchors;
  if (anchors.length < 2) return null;
  const start = anchors[0]!;
  const end = anchors[anchors.length - 1]!;
  const ignore = new Set(spec.ignore ?? []);
  const capsule = spec.kind === "DUCK_UNDER" ? CROUCH_HEIGHT : STAND_HEIGHT;

  // Preflight: the destination must accept a body of the relevant height.
  const endValid = landingValid(world, end.x, end.z, CAPSULE_RADIUS, end.y, capsule, ignore);
  if (!endValid) return null;

  const normal = outwardNormal(start, end, spec.kind);
  const faceObstacle = spec.kind === "CLIMB_DOWN";
  const action: AuthoredAction = {
    kind: spec.kind,
    anchors: anchors.map((a) => ({ ...a })),
    durationMs: Math.max(60, spec.durationMs),
    elapsedMs: 0,
    ignore,
    arcHeight: spec.arcHeight ?? 0,
    faceObstacle,
    startPos: { x: start.x, y: start.y, z: start.z },
    startYaw: start.yaw ?? state.yaw,
    endPos: { x: end.x, y: end.y, z: end.z },
    endYaw: end.yaw ?? Math.atan2(normal.x, normal.z),
  };
  if (!authoredTrajectoryClear(world, action, capsule)) return null;
  return {
    ...state,
    phase: spec.kind,
    capsuleHeight: capsule,
    grounded: false,
    airtimeMs: 0,
    vel: { x: 0, y: 0, z: 0 },
    yaw: faceObstacle ? Math.atan2(-normal.x, -normal.z) : state.yaw,
    action,
    dash: null,
    stagger: null,
  };
}

// Outward normal (obstacle -> actor) in XZ, derived from the anchor chain.
function outwardNormal(a: AuthoredAnchor, b: AuthoredAnchor, kind: AuthoredAction["kind"]): { x: number; z: number } {
  // For climb-up the actor starts outside (a) and ends on the obstacle (b), so
  // outward = a - b. For climb-down it is reversed (ends outside), outward =
  // b - a. Vault/duck cross through, use travel direction as a fallback.
  let dx: number;
  let dz: number;
  if (kind === "CLIMB_UP") {
    dx = a.x - b.x;
    dz = a.z - b.z;
  } else if (kind === "CLIMB_DOWN") {
    dx = b.x - a.x;
    dz = b.z - a.z;
  } else {
    dx = b.x - a.x;
    dz = b.z - a.z;
  }
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, z: dz / len };
}

// Cancel an in-flight action, snapping to the nearest VALIDATED endpoint
// (start or end), never a midpoint. Zeros velocity and returns grounded.
export function cancelAction(world: CollisionWorld, state: MotionState): MotionResult {
  const action = state.action;
  if (!action) return { state, events: [] };
  const candidates = [
    { pos: action.endPos, yaw: action.endYaw },
    { pos: action.startPos, yaw: action.startYaw },
  ].filter((c) =>
    landingValid(world, c.pos.x, c.pos.z, CAPSULE_RADIUS, c.pos.y, STAND_HEIGHT, action.ignore) ||
    // start endpoints on the ground are always safe to return to
    Math.abs(c.pos.y) < CONTACT_EPS,
  );
  const here = state.pos;
  const nearest =
    candidates.sort(
      (p, q) =>
        (p.pos.x - here.x) ** 2 + (p.pos.z - here.z) ** 2 - ((q.pos.x - here.x) ** 2 + (q.pos.z - here.z) ** 2),
    )[0] ?? { pos: action.startPos, yaw: action.startYaw };
  return {
    state: {
      ...state,
      phase: "GROUNDED",
      pos: { ...nearest.pos },
      yaw: nearest.yaw,
      vel: { x: 0, y: 0, z: 0 },
      capsuleHeight: STAND_HEIGHT,
      grounded: true,
      airtimeMs: 0,
      action: null,
      dash: null,
      stagger: null,
    },
    events: ["actionCancelled"],
  };
}

// ---- per-frame step --------------------------------------------------------

export function stepMotion(world: CollisionWorld, state: MotionState, input: MotionInput): MotionResult {
  const dt = Math.min(input.dt, MAX_DT);
  if (state.action && AUTHORED_PHASES.has(state.phase)) {
    return stepAuthored(world, state, dt, input.reducedMotion);
  }
  if (AIRBORNE_PHASES.has(state.phase)) {
    return stepBallistic(world, state, dt);
  }
  if (state.stagger && state.phase === "STAGGER") {
    return stepStagger(world, state, dt, input);
  }
  if (state.dash && state.phase === "DASH") {
    return stepDash(world, state, dt, input);
  }
  return stepGrounded(world, state, dt, input);
}

/**
 * One step of an open recovery window.
 *
 * Structurally identical to `stepDash`, and that is the point: it replaces the
 * target velocity and counts the window down, and every metre of displacement is
 * produced by `stepGrounded`. The two differences are both about authorship rather
 * than physics:
 *
 *   1. THE PLAYER'S INPUT IS DISCARDED. That is what "recovery" means — you are not
 *      steering. It is also the entire cost of the window, and it is why the
 *      shortest legal recovery still costs something.
 *   2. The push DECAYS across the window, so control returns gradually instead of
 *      snapping back. `stepGrounded` blends toward the target, so a decaying target
 *      reads as regaining your feet.
 */
function stepStagger(
  world: CollisionWorld,
  state: MotionState,
  dt: number,
  input: MotionInput,
): MotionResult {
  const stagger = state.stagger!;
  const elapsedMs = input.reducedMotion
    ? stagger.durationMs
    : stagger.elapsedMs + dt * 1000;

  const remaining =
    stagger.durationMs <= 0
      ? 0
      : Math.max(0, 1 - stagger.elapsedMs / stagger.durationMs);
  const pushSpeed = stagger.speed * remaining;

  const result = stepGrounded(world, state, dt, {
    ...input,
    targetVelX: stagger.dirX * pushSpeed,
    targetVelZ: stagger.dirZ * pushSpeed,
  });
  const events = [...result.events];

  // Shoved off a ledge is a fall, exactly as running off one is.
  if (AIRBORNE_PHASES.has(result.state.phase) || !result.state.grounded) {
    events.push("staggerEnded");
    return { state: { ...result.state, stagger: null }, events };
  }

  if (elapsedMs >= stagger.durationMs) {
    events.push("staggerEnded");
    return {
      state: {
        ...result.state,
        phase: stagger.fromPhase,
        capsuleHeight:
          stagger.fromPhase === "CROUCH"
            ? CROUCH_HEIGHT
            : result.state.capsuleHeight,
        stagger: null,
      },
      events,
    };
  }

  return {
    state: {
      ...result.state,
      phase: "STAGGER",
      stagger: { ...stagger, elapsedMs },
    },
    events,
  };
}

/**
 * One step of an open burst.
 *
 * The only thing this function does that grounded motion does not is REPLACE THE
 * TARGET VELOCITY and count down the window. Every metre of displacement is
 * produced by `stepGrounded`, which is the same call ordinary walking makes.
 * There is no second integrator here and no path by which one could be added
 * without deleting this comment.
 */
function stepDash(
  world: CollisionWorld,
  state: MotionState,
  dt: number,
  input: MotionInput,
): MotionResult {
  const dash = state.dash!;
  const elapsedMs = input.reducedMotion
    ? dash.durationMs
    : dash.elapsedMs + dt * 1000;

  const result = stepGrounded(world, state, dt, {
    ...input,
    targetVelX: dash.dirX * dash.speed,
    targetVelZ: dash.dirZ * dash.speed,
  });
  const events = [...result.events];

  // A burst off a ledge is a fall, exactly as running off one is. Grounded motion
  // has already made that decision; the window just closes with it.
  if (AIRBORNE_PHASES.has(result.state.phase) || !result.state.grounded) {
    events.push("dashEnded");
    return { state: { ...result.state, dash: null }, events };
  }

  if (elapsedMs >= dash.durationMs) {
    events.push("dashEnded");
    return {
      state: {
        ...result.state,
        phase: dash.fromPhase,
        capsuleHeight:
          dash.fromPhase === "CROUCH" ? CROUCH_HEIGHT : result.state.capsuleHeight,
        dash: null,
      },
      events,
    };
  }

  // Velocity survives the exit rather than being zeroed, so a burst flows into a
  // run instead of ending in a stop the player did not ask for.
  return {
    state: { ...result.state, phase: "DASH", dash: { ...dash, elapsedMs } },
    events,
  };
}

function stepGrounded(world: CollisionWorld, state: MotionState, dt: number, input: MotionInput): MotionResult {
  const events: MotionEventType[] = [];
  const vel = { ...state.vel };
  const target = { x: input.targetVelX, z: input.targetVelZ };
  const targetSpeed = Math.hypot(target.x, target.z);
  const rate = targetSpeed > 0.001 ? ACCEL : DECEL;
  const blend = 1 - Math.exp(-rate * dt * 0.6);
  vel.x += (target.x - vel.x) * blend;
  vel.z += (target.z - vel.z) * blend;
  vel.y = 0;

  const pos = { ...state.pos };
  const speed = Math.hypot(vel.x, vel.z);
  let yaw = state.yaw;
  if (speed > 0.02) {
    const to = { x: pos.x + vel.x * dt, z: pos.z + vel.z * dt };
    const sweep = sweepXZ(world, pos, to, CAPSULE_RADIUS, state.capsuleHeight);
    if (sweep.hitNormals.length > 0) {
      const slid = slideVelocityXZ(vel, sweep.hitNormals);
      vel.x = slid.x;
      vel.z = slid.z;
    }
    if (sweep.blockedX && sweep.hitNormals.length === 0) vel.x = 0;
    if (sweep.blockedZ && sweep.hitNormals.length === 0) vel.z = 0;
    pos.x = sweep.x;
    pos.z = sweep.z;
    const desired = Math.atan2(vel.x, vel.z);
    yaw += shortestAngle(yaw, desired) * (1 - Math.exp(-(6 + speed * 1.6) * dt));
  }

  // Support: snap onto the surface under the feet, or drop off a ledge. A
  // small step-down is absorbed; anything lower is a ledge and the player
  // falls (after the coyote grace).
  const support = supportBelow(world, pos.x, pos.z, pos.y);
  if (support && support.y >= pos.y - STEP_DOWN && support.y <= pos.y + 0.06) {
    pos.y = support.y;
    return {
      state: {
        ...state,
        pos,
        vel,
        yaw,
        grounded: true,
        airtimeMs: 0,
        capsuleHeight: state.phase === "CROUCH" ? CROUCH_HEIGHT : state.capsuleHeight,
      },
      events,
    };
  }
  // Walked off a ledge: coyote grace, then fall with the current velocity.
  const airtimeMs = state.airtimeMs + dt * 1000;
  if (airtimeMs < COYOTE_MS) {
    return { state: { ...state, pos, vel, yaw, grounded: true, airtimeMs }, events };
  }
  return {
    state: {
      ...state,
      phase: "FALLING",
      pos,
      vel: { x: vel.x, y: 0, z: vel.z },
      yaw,
      grounded: false,
      airtimeMs,
      capsuleHeight: STAND_HEIGHT,
    },
    events,
  };
}

function stepBallistic(world: CollisionWorld, state: MotionState, dt: number): MotionResult {
  const events: MotionEventType[] = [];
  const pos = { ...state.pos };
  const vel = { ...state.vel };
  const ignore = state.action?.ignore;
  let remaining = dt;
  let landed = false;
  while (remaining > 1e-6 && !landed) {
    const h = Math.min(PHYSICS_SUBSTEP, remaining);
    remaining -= h;
    vel.y -= GRAVITY * h;

    // Horizontal sweep against every obstacle (no collider bypass).
    const to = { x: pos.x + vel.x * h, z: pos.z + vel.z * h };
    const sweep = sweepXZ(world, pos, to, CAPSULE_RADIUS, state.capsuleHeight, ignore);
    const slid = slideVelocityXZ(vel, sweep.hitNormals);
    vel.x = slid.x;
    vel.z = slid.z;
    pos.x = sweep.x;
    pos.z = sweep.z;

    if (vel.y > 0) {
      const clearance = headClearance(world, pos.x, pos.z, CAPSULE_RADIUS, pos.y, ignore);
      const headroom = clearance - state.capsuleHeight;
      const rise = vel.y * h;
      if (rise > headroom) {
        pos.y += Math.max(0, headroom);
        vel.y = 0;
      } else {
        pos.y += rise;
      }
    } else {
      const support = supportBelow(world, pos.x, pos.z, pos.y, CONTACT_EPS);
      const newFoot = pos.y + vel.y * h;
      if (support && newFoot <= support.y + CONTACT_EPS) {
        pos.y = support.y; // <=1cm support snap
        landed = true;
      } else {
        pos.y = newFoot;
      }
    }
  }

  if (landed) {
    events.push("landed");
    return {
      state: {
        ...state,
        phase: "GROUNDED",
        pos,
        vel: { x: 0, y: 0, z: 0 },
        grounded: true,
        airtimeMs: 0,
        capsuleHeight: STAND_HEIGHT,
        action: null,
      },
      events,
    };
  }
  return {
    state: { ...state, pos, vel, airtimeMs: state.airtimeMs + dt * 1000 },
    events,
  };
}

function stepAuthored(world: CollisionWorld, state: MotionState, dt: number, reducedMotion: boolean): MotionResult {
  const action = state.action!;
  const elapsedMs = reducedMotion ? action.durationMs : action.elapsedMs + dt * 1000;
  const t = Math.min(1, elapsedMs / action.durationMs);
  const sample = samplePath(action, t);

  if (!reducedMotion && t < 1) {
    const sweep = sweepXZ(
      world,
      state.pos,
      { x: sample.x, z: sample.z },
      CAPSULE_RADIUS,
      state.capsuleHeight,
      action.ignore,
    );
    const clearance = headClearance(
      world,
      sample.x,
      sample.z,
      CAPSULE_RADIUS,
      sample.y,
      action.ignore,
    );
    if (
      sweep.blockedX ||
      sweep.blockedZ ||
      clearance < state.capsuleHeight - 0.05
    ) {
      return cancelAction(world, state);
    }
  }

  if (t >= 1) {
    // Land on the validated endpoint only.
    const capsule = canStand(world, action.endPos.x, action.endPos.z, CAPSULE_RADIUS, action.endPos.y)
      ? STAND_HEIGHT
      : action.kind === "DUCK_UNDER"
        ? CROUCH_HEIGHT
        : STAND_HEIGHT;
    return {
      state: {
        ...state,
        phase: capsule === CROUCH_HEIGHT ? "CROUCH" : "GROUNDED",
        pos: { ...action.endPos },
        yaw: action.endYaw,
        vel: { x: 0, y: 0, z: 0 },
        grounded: true,
        airtimeMs: 0,
        capsuleHeight: capsule,
        action: null,
      },
      events: ["actionComplete"],
    };
  }

  return {
    state: {
      ...state,
      pos: { x: sample.x, y: sample.y, z: sample.z },
      yaw: sample.yaw,
      grounded: false,
      action: { ...action, elapsedMs },
    },
    events: [],
  };
}

// Deterministic piecewise-linear sample along the anchor chain, with an
// authored vault loft. Root-neutral: the clip adds no displacement of its own.
function samplePath(action: AuthoredAction, t: number): { x: number; y: number; z: number; yaw: number } {
  const eased = t * t * (3 - 2 * t);
  const anchors = action.anchors;
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i]!;
    const b = anchors[i + 1]!;
    const len = Math.max(1e-3, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
    lengths.push(len);
    total += len;
  }
  let dist = eased * total;
  let seg = 0;
  while (seg < lengths.length - 1 && dist > lengths[seg]!) {
    dist -= lengths[seg]!;
    seg += 1;
  }
  const a = anchors[seg]!;
  const b = anchors[seg + 1]!;
  const k = Math.min(1, Math.max(0, dist / lengths[seg]!));
  const x = a.x + (b.x - a.x) * k;
  let y = a.y + (b.y - a.y) * k;
  const z = a.z + (b.z - a.z) * k;
  if (action.kind === "VAULT" && action.arcHeight > 0) {
    y += Math.sin(eased * Math.PI) * action.arcHeight;
  }

  let yaw: number;
  const normal = outwardNormal(anchors[0]!, anchors[anchors.length - 1]!, action.kind);
  if (action.faceObstacle) {
    // Face the obstacle throughout, restoring outward travel facing at exit.
    const faceIn = Math.atan2(-normal.x, -normal.z);
    const faceOut = Math.atan2(normal.x, normal.z);
    yaw = t > 0.9 ? faceOut : faceIn;
  } else if (b.yaw !== undefined && k > 0.9) {
    yaw = b.yaw;
  } else {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    yaw = Math.abs(dx) + Math.abs(dz) > 1e-4 ? Math.atan2(dx, dz) : (a.yaw ?? action.startYaw);
  }
  return { x, y, z, yaw };
}

function authoredTrajectoryClear(
  world: CollisionWorld,
  action: AuthoredAction,
  capsuleHeight: number,
): boolean {
  let previous = { ...action.startPos };
  const samples = Math.max(24, Math.ceil(action.durationMs / 30));
  for (let i = 1; i <= samples; i++) {
    const sample = samplePath(action, i / samples);
    const sweep = sweepXZ(
      world,
      previous,
      { x: sample.x, z: sample.z },
      CAPSULE_RADIUS,
      capsuleHeight,
      action.ignore,
    );
    if (sweep.blockedX || sweep.blockedZ) return false;
    if (
      headClearance(
        world,
        sample.x,
        sample.z,
        CAPSULE_RADIUS,
        sample.y,
        action.ignore,
      ) < capsuleHeight - 0.05
    ) return false;
    previous = { x: sample.x, y: sample.y, z: sample.z };
  }
  return true;
}

// ---- preflight simulation --------------------------------------------------

export interface BallisticPrediction {
  landed: boolean;
  valid: boolean; // landed on a support with full standing clearance
  pos: Vec3;
  landingId: string | null;
}

// Non-mutating forward simulation of a ballistic arc, used to validate a
// running-jump gap landing before committing (JUMP_GAP). Returns the predicted
// landing and whether it is solvable.
export function simulateBallistic(
  world: CollisionWorld,
  start: Vec3,
  vel: Vec3,
  ignore: ReadonlySet<string> | undefined,
  maxMs = 3000,
): BallisticPrediction {
  const pos = { ...start };
  const v = { ...vel };
  let elapsed = 0;
  while (elapsed < maxMs) {
    const h = PHYSICS_SUBSTEP;
    elapsed += h * 1000;
    v.y -= GRAVITY * h;
    const to = { x: pos.x + v.x * h, z: pos.z + v.z * h };
    const sweep = sweepXZ(world, pos, to, CAPSULE_RADIUS, STAND_HEIGHT, ignore);
    const slid = slideVelocityXZ(v, sweep.hitNormals);
    v.x = slid.x;
    v.z = slid.z;
    pos.x = sweep.x;
    pos.z = sweep.z;
    if (v.y > 0) {
      const headroom = headClearance(world, pos.x, pos.z, CAPSULE_RADIUS, pos.y, ignore) - STAND_HEIGHT;
      if (v.y * h > headroom) {
        pos.y += Math.max(0, headroom);
        v.y = 0;
      } else {
        pos.y += v.y * h;
      }
    } else {
      const support = supportBelow(world, pos.x, pos.z, pos.y, CONTACT_EPS);
      const newFoot = pos.y + v.y * h;
      if (support && newFoot <= support.y + CONTACT_EPS) {
        pos.y = support.y;
        const valid = landingValid(world, pos.x, pos.z, CAPSULE_RADIUS, support.y, STAND_HEIGHT, ignore);
        return { landed: true, valid, pos, landingId: support.id };
      }
      pos.y = newFoot;
    }
    if (pos.y < -50) break; // fell into the void
  }
  return { landed: false, valid: false, pos, landingId: null };
}
