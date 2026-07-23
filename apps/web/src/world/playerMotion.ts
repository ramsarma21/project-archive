// Player locomotion state + physics (Day-1-3D-World-Spec §locomotion). Pure,
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

export type MotionPhase =
  | "GROUNDED"
  | "CROUCH"
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

export interface MotionState {
  phase: MotionPhase;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  capsuleHeight: number;
  grounded: boolean;
  airtimeMs: number;
  action: AuthoredAction | null;
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
  | "jumpStarted";

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
export function beginStandingJump(state: MotionState): MotionState {
  return {
    ...state,
    phase: "STANDING_JUMP",
    capsuleHeight: STAND_HEIGHT,
    grounded: false,
    airtimeMs: 0,
    vel: { x: 0, y: STANDING_JUMP_VY, z: 0 },
    action: null,
  };
}

// Running jump: preserves the launch horizontal velocity into an honest arc.
// No teleport, no collider bypass, minimal air steering (none applied here).
export function beginRunningJump(state: MotionState): MotionState {
  return {
    ...state,
    phase: "RUNNING_JUMP",
    capsuleHeight: STAND_HEIGHT,
    grounded: false,
    airtimeMs: 0,
    vel: { x: state.vel.x, y: RUNNING_JUMP_VY, z: state.vel.z },
    action: null,
  };
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
  return stepGrounded(world, state, dt, input);
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
    if (sweep.blockedX) vel.x *= 0.4;
    if (sweep.blockedZ) vel.z *= 0.4;
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
    if (sweep.blockedX) vel.x = 0;
    if (sweep.blockedZ) vel.z = 0;
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
    if (sweep.blockedX) v.x = 0;
    if (sweep.blockedZ) v.z = 0;
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
