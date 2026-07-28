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
  type Platform,
  sweepXZ,
  slideVelocityXZ,
  supportBelow,
  headClearance,
  canStand,
  landingValid,
  resolveOverlapXZ,
  capsuleEmbeddedIn,
  rideOutOfEmbed,
  lowStepIds,
  supportAhead,
  deckThroughBody,
  sweptCapsuleCrossesPlatform,
  platformCeilingAt,
  PHYSICS_SUBSTEP,
  CAPSULE_RADIUS,
  STAND_HEIGHT,
  CROUCH_HEIGHT,
  CONTACT_EPS,
  SUPPORT_SNAP_UP,
  type CapsulePenetration,
} from "./collision.js";
import { FIELD_DT } from "./fieldSimulation.js";

// ---- tuning constants ------------------------------------------------------

export const GRAVITY = 10.8; // m/s^2 (apex ~1.2m for the standing jump)
export const STANDING_JUMP_VY = 5.2; // -> apex vy^2/2g = 1.25m
export const RUNNING_JUMP_VY = 5.2;
export const RUN_JUMP_MIN_SPEED = 1.2; // forward speed that arms the running jump
export const RUN_JUMP_FORWARD_DOT = 0.6; // body-forward alignment for running jump
export const MAX_STANDING_DRIFT = 0.05; // <5cm horizontal drift budget
export const COYOTE_MS = 100; // grace after walking off a ledge
export const STEP_DOWN = 0.35; // max ledge stepped down without falling
/**
 * Max lip walked up without a verb, and deliberately the same as STEP_DOWN.
 *
 * A body that can drop off a 35cm kerb without breaking stride and cannot get
 * back onto it is telling the player something untrue about itself, and the
 * asymmetry is the kind that gets learned as "the physics isn't consistent".
 * The number is also inside the range every shipped controller uses — Unity
 * 0.30, Unreal and Source 0.45 — and safely under `stepUpMaxHeightM` (0.50), so
 * the STEP_UP verb still owns the band a player can see themselves climbing.
 *
 * Honest about the size of the win: M1 has exactly two masses under half a
 * metre, both 0.34m, so this changes almost nothing about whether the mission
 * can be finished. It changes how it feels to run down a street, and it will
 * matter much more as street furniture lands.
 */
export const STEP_UP = 0.35;
/**
 * Horizontal speed below which a grounded body embedded in a sliver is treated
 * as genuinely WEDGED and held on the landable mass its footprint overlaps,
 * rather than dropped back into the embed. A wedged body is stationary (the
 * walls kill its velocity); anything moving faster is walking or falling off a
 * mass edge under its own power and must be left to do so. Small on purpose:
 * well below a walk, so only a body that truly cannot move is held.
 */
export const WEDGE_HOLD_MAX_SPEED = 0.5;
export const WALK_SPEED = 2.3;
export const RUN_SPEED = 4.6;
export const CROUCH_SPEED = 1.15;
export const ACCEL = 9;
/**
 * Deceleration when the player asks for no movement (or the brake has removed
 * their over-lip target). Exported because the edge brake sizes its stopping
 * distance against the deceleration the body will actually achieve — the two
 * must be the same number or the brake mis-times the stop.
 */
export const DECEL = 14;
const MAX_DT = 0.05;

// ---- determinism: precomputed fixed-step blends ----------------------------
//
// The grounded velocity blend is `1 - exp(-rate * dt * 0.6)`. `Math.exp` is
// implementation-approximated — IEEE 754 pins +,-,*,/ and sqrt, and explicitly
// does NOT pin exp — so V8, JavaScriptCore and SpiderMonkey can each return a
// different last bit, and a one-ulp difference on the hashed motion path is a
// real Node-vs-Safari desync (see @pa/netcode/transcendental.test.ts).
//
// Every production caller advances at exactly FIELD_DT (asserted in `stepMotion`
// / `stepFlow` via `assertFieldDt`), so the two blends collapse to two constants.
// They are BAKED as decimal literals rather than computed at module load, which
// is what makes them engine-independent: ECMAScript requires a numeric literal
// to parse to the nearest representable double (correctly rounded), so every
// conforming engine reads the identical bit pattern — whereas computing
// `Math.exp` at load would reintroduce exactly the cross-engine spread we are
// removing. Each literal equals the double `1 - Math.exp(-rate * FIELD_DT * 0.6)`
// produced by the authoring engine, so replacing the call is a no-op on that
// engine (no golden shift) and a determinism fix everywhere else.
// `transcendentalDeterminism.test.ts` re-derives both and fails if they drift.
export const GROUNDED_ACCEL_BLEND = 0.08606881472877181; // 1 - exp(-ACCEL * FIELD_DT * 0.6)
export const GROUNDED_DECEL_BLEND = 0.13064176460119414; // 1 - exp(-DECEL * FIELD_DT * 0.6)

/**
 * The fixed-step invariant, in one guard: `stepMotion` and `stepFlow` may only
 * ever advance by `FIELD_DT`. It is what lets the precomputed blends above stand
 * in for `1 - exp(-rate * dt * 0.6)` — at any other `dt` those constants would be
 * silently wrong, so a wrong `dt` is failed loudly here rather than integrated.
 */
export function assertFieldDt(dt: number): void {
  if (dt !== FIELD_DT) {
    throw new Error(
      `stepMotion/stepFlow require the fixed field step FIELD_DT (${FIELD_DT}); ` +
        `got ${dt}. The precomputed accel/decel blends are only valid at FIELD_DT.`,
    );
  }
}

/**
 * The speed a grounded body accelerating toward `targetSpeed` reaches after
 * travelling `distanceM` in a straight line from `currentSpeed`, integrated with
 * the SAME per-tick blend `stepGrounded` uses (`ACCEL`, `dt`, the 0.6 factor).
 *
 * This is a forward PROJECTION, not a heuristic: a body running an open lane to a
 * lip has exactly this speed when it gets there, because the acceleration model is
 * deterministic and the lane is unobstructed. It exists so the flow reader can ask
 * "how fast will I be when I reach the takeoff" before deciding whether a lip with
 * a jumpable gap beyond it is a leap to make or a fall to brake — the same honest
 * "what will the body actually do" question `simulateWalkOff` answers for a fall,
 * without paying a full swept simulation for a straight grounded run.
 *
 * Overshoot cannot happen: the blend only ever approaches `targetSpeed`, so the
 * result is bounded by it. A non-positive target or distance returns the current
 * speed unchanged.
 */
export function projectGroundSpeed(
  currentSpeed: number,
  targetSpeed: number,
  distanceM: number,
  dt: number,
): number {
  if (!(distanceM > 0) || !(targetSpeed > 0) || dt <= 0) return currentSpeed;
  // Same `1 - exp(-ACCEL * dt * 0.6)` grounded-accel blend `stepGrounded` uses,
  // and this projection must match it tick-for-tick. Precomputed at FIELD_DT (the
  // only dt production passes here) so the projection is bit-identical across
  // engines to the integrator it forecasts.
  assertFieldDt(dt);
  const blend = GROUNDED_ACCEL_BLEND;
  let v = currentSpeed;
  let x = 0;
  // Bounded: distance/(slowest advancing speed) ticks, capped so a near-stalled
  // start cannot spin. 512 ticks is > 8s of travel at 60Hz, far past any lane.
  for (let i = 0; i < 512 && x < distanceM; i += 1) {
    v += (targetSpeed - v) * blend;
    x += v * dt;
  }
  return v;
}

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

/**
 * A fully independent deep copy of a motion state — every nested object, the
 * action's anchor array and its ignore set included.
 *
 * EXPLICIT, NOT `structuredClone`, on purpose. This clone is on the prediction
 * hot path and must run on every browser the game targets and be trivially
 * auditable for what it copies; hand-copying every field also documents the
 * complete shape of a motion state in one place. The whole point of the copy is
 * mutation isolation: the walk-off prediction steps this forward, and nothing it
 * does may reach back and disturb the live body it was cloned from.
 */
export function cloneMotionState(state: MotionState): MotionState {
  return {
    phase: state.phase,
    pos: { x: state.pos.x, y: state.pos.y, z: state.pos.z },
    vel: { x: state.vel.x, y: state.vel.y, z: state.vel.z },
    yaw: state.yaw,
    capsuleHeight: state.capsuleHeight,
    grounded: state.grounded,
    airtimeMs: state.airtimeMs,
    action: state.action ? cloneAuthoredAction(state.action) : null,
    dash: state.dash ? { ...state.dash } : null,
    stagger: state.stagger ? { ...state.stagger } : null,
  };
}

function cloneAuthoredAction(action: AuthoredAction): AuthoredAction {
  return {
    kind: action.kind,
    anchors: action.anchors.map((anchor) =>
      anchor.yaw === undefined
        ? { x: anchor.x, y: anchor.y, z: anchor.z }
        : { x: anchor.x, y: anchor.y, z: anchor.z, yaw: anchor.yaw },
    ),
    durationMs: action.durationMs,
    elapsedMs: action.elapsedMs,
    ignore: new Set(action.ignore),
    arcHeight: action.arcHeight,
    faceObstacle: action.faceObstacle,
    startPos: { x: action.startPos.x, y: action.startPos.y, z: action.startPos.z },
    startYaw: action.startYaw,
    endPos: { x: action.endPos.x, y: action.endPos.y, z: action.endPos.z },
    endYaw: action.endYaw,
  };
}

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

// ---- non-penetration invariant ---------------------------------------------

export interface MotionPenetration {
  /** Solid blockers the capsule ended the tick embedded in, beyond skin. */
  embeds: CapsulePenetration[];
  /** A deck plane cutting the torso at the body's centre, or null. */
  deckId: string | null;
}

/**
 * The non-penetration invariant for a live body, in one call.
 *
 * Returns the solid blockers the capsule is embedded in and any deck plane
 * cutting its torso, with the solver's OWN legitimate ignores already excluded:
 * the low kerbs the grounded step walks through, and the obstacle an authored
 * verb is mid-crossing. Empty embeds and a null deck mean the body ended the
 * tick clear of every solid — the property the whole motion system is supposed
 * to hold at any speed, any frame delta, through any verb.
 *
 * This is the single check the dev/test runtime asserts every tick and the
 * traversal fuzzer gates on, so the assertion in the browser and the evidence
 * in the harness are literally the same predicate rather than two that drift.
 */
export function motionPenetration(
  world: CollisionWorld,
  motion: MotionState,
): MotionPenetration {
  // The low kerbs the grounded solver legitimately steps through. These are the
  // ONLY solids an embed is allowed to report against.
  const lowIgnore = new Set<string>();
  const low = lowStepIds(
    world,
    motion.pos.x,
    motion.pos.z,
    CAPSULE_RADIUS,
    motion.pos.y,
    STEP_UP,
  );
  if (low) for (const id of low) lowIgnore.add(id);
  // THE SIDE OF A CLIMBED SURFACE IS NOT EXEMPT ANY MORE. This invariant used to
  // exclude `action.ignore` — the very surface an authored climb/vault is
  // crossing — from the solid-embed test, which is exactly why it could never see
  // the body rise a radius inside the wall it was climbing: the one collider that
  // mattered was switched off. Now that `stepAuthored` holds the capsule outside
  // that surface (see there), the embed test consults the FULL solid world, so a
  // climb-through becomes a violation the always-on assertion and the fuzzer both
  // catch. A landable top does not read as an embed (its span is below the feet
  // once topped out), so a legitimate mantle is still clean.
  const embeds = capsuleEmbeddedIn(
    world,
    motion.pos,
    CAPSULE_RADIUS,
    motion.capsuleHeight,
    lowIgnore,
  );
  // The deck-plane test keeps the authored exclusion: topping out onto a deck, or
  // stepping off one, legitimately passes the head/feet through that ONE deck's
  // plane, and those two surfaces are named in `action.ignore`. Every other deck
  // the path meets is still a floor it may not pierce.
  const deckIgnore = new Set(lowIgnore);
  if (motion.action) for (const id of motion.action.ignore) deckIgnore.add(id);
  const deck = deckThroughBody(
    world,
    motion.pos.x,
    motion.pos.z,
    motion.pos.y,
    motion.capsuleHeight,
  );
  const deckId = deck && !deckIgnore.has(deck.id) ? deck.id : null;
  return { embeds, deckId };
}

// ---- airborne deck-side collision ------------------------------------------

/**
 * How far the centre (x,z) is INSIDE a deck's footprint: the least distance to
 * any edge when inside (positive), or how far outside when clear (<= 0). Uses
 * the deck's bounding rect, which is exact for the rect decks M1 authors and a
 * safe conservative bound for a polygon one.
 */
function deckInteriorDepth(
  deck: { minX: number; maxX: number; minZ: number; maxZ: number },
  x: number,
  z: number,
): number {
  return Math.min(x - deck.minX, deck.maxX - x, z - deck.minZ, deck.maxZ - z);
}

/**
 * The deck a horizontal step (x0,z0)->(x1,z1) at foot `footY` carried the CENTRE
 * INTO — the one-way deck-edge the ballistic sweep is otherwise blind to (see the
 * call sites in stepGrounded / stepBallistic / simulateBallistic) — or null.
 *
 * A deck is a floor from above and open from below, but its SIDE is solid: a body
 * must not push its torso through the edge of a roof/canopy. This returns a deck
 * only when the move takes the centre to a state where a non-ignored deck plane
 * is strictly through the torso AND the body is entering or going DEEPER into that
 * deck than it already was. A body ESCAPING a deck it is already inside (moving to
 * a shallower depth) returns null, so a body that became airborne right at a deck
 * edge is never wedged against it. Leaving a deck (foot at the plane, centre
 * carried past the lip) and landing from above (foot over the plane) both return
 * null — neither is a torso cut with the plane above the foot.
 *
 * The caller decides what to do with it: a GROUNDED body exempts a deck within a
 * step of the foot (it climbs onto a stair/ledge), and an AIRBORNE body exempts a
 * deck its feet can still rise to (a leap ONTO a ledge legitimately clips its
 * edge on the way up). See the call sites.
 */
function deckSideBlocker(
  world: CollisionWorld,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  footY: number,
  height: number,
  ignore: ReadonlySet<string> | undefined,
): Platform | null {
  const after = deckThroughBody(world, x1, z1, footY, height);
  if (!after || ignore?.has(after.id)) return null;
  const before = deckThroughBody(world, x0, z0, footY, height);
  const depthBefore =
    before && before.id === after.id ? deckInteriorDepth(before, x0, z0) : -Infinity;
  return deckInteriorDepth(after, x1, z1) > depthBefore ? after : null;
}

// ---- vector helpers --------------------------------------------------------

function horizSpeed(v: Vec3): number {
  // sqrt(x*x + z*z), not Math.hypot: hypot is implementation-defined in the last
  // bits, this form uses only IEEE-754-pinned ops so it is identical on every engine.
  return Math.sqrt(v.x * v.x + v.z * v.z);
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
  const length = Math.sqrt(dirX * dirX + dirZ * dirZ);
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
  const length = Math.sqrt(input.dirX * input.dirX + input.dirZ * input.dirZ);
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

  // The surfaces the move LEAVES and LANDS ON are not ones it crosses. Topping
  // out onto a deck passes the head through that deck's plane, and leaving a deck
  // downward passes the feet through the deck just left — both are standing on /
  // stepping off, not piercing a floor. So the start and destination surfaces are
  // added to the ignore set the swept deck-crossing test consults; every OTHER
  // deck the path meets, on the way up, across, or down, is still a wall. The
  // verb ladder already ignores these in play; this makes a bare `beginAuthored`
  // agree with it.
  const destSurface = supportBelow(world, end.x, end.z, end.y + CONTACT_EPS);
  if (destSurface && destSurface.id !== "GROUND") ignore.add(destSurface.id);
  const startSurface = supportBelow(world, start.x, start.z, start.y + CONTACT_EPS);
  if (startSurface && startSurface.id !== "GROUND") ignore.add(startSurface.id);

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
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
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
  // The fixed-step invariant, guarded at the one gate every motion path flows
  // through: the precomputed blends in `stepGrounded` are only valid at FIELD_DT.
  assertFieldDt(input.dt);
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
  const targetSpeed = Math.sqrt(target.x * target.x + target.z * target.z);
  // `1 - exp(-rate * dt * 0.6)` precomputed at FIELD_DT (asserted in stepMotion),
  // so the blend is a shared literal instead of an implementation-defined exp.
  const blend = targetSpeed > 0.001 ? GROUNDED_ACCEL_BLEND : GROUNDED_DECEL_BLEND;
  vel.x += (target.x - vel.x) * blend;
  vel.z += (target.z - vel.z) * blend;
  vel.y = 0;

  const pos = { ...state.pos };
  const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  let yaw = state.yaw;

  // A lip low enough to walk up is not a wall to a body on its feet, and the
  // same set has to be invisible to the sweep and to depenetration or the body
  // is stopped by what it is standing on. See lowStepIds.
  const lowSteps = lowStepIds(
    world,
    pos.x,
    pos.z,
    CAPSULE_RADIUS,
    pos.y,
    STEP_UP,
  );

  if (speed > 0.02) {
    const to = { x: pos.x + vel.x * dt, z: pos.z + vel.z * dt };
    const sweep = sweepXZ(world, pos, to, CAPSULE_RADIUS, state.capsuleHeight, lowSteps);
    if (sweep.hitNormals.length > 0) {
      const slid = slideVelocityXZ(vel, sweep.hitNormals);
      vel.x = slid.x;
      vel.z = slid.z;
    }
    if (sweep.blockedX && sweep.hitNormals.length === 0) vel.x = 0;
    if (sweep.blockedZ && sweep.hitNormals.length === 0) vel.z = 0;
    pos.x = sweep.x;
    pos.z = sweep.z;
    // A DECK IS SOLID FROM THE SIDE to a grounded body too. `sweepXZ` sees only
    // blockers, so a body on a raised surface (a canopy, a crate top) could walk
    // its head through the edge of a HIGHER deck abutting it — and then step off
    // into the air already grazing it. The one-way-deck-side rule from the
    // ballistic step applies unchanged; it can fire only when the feet are high
    // enough for a deck plane to lie in the torso, and every M1 deck is at 2.55m
    // or more, so ground-level travel under a pentice or awning is never touched.
    const groundedSideDeck = deckSideBlocker(
      world,
      state.pos.x,
      state.pos.z,
      pos.x,
      pos.z,
      pos.y,
      state.capsuleHeight,
      undefined,
    );
    // A deck within a step of the foot is one the body climbs ONTO, not through:
    // the support snap owns it (a ramp strip, a flush ledge). Only a deck higher
    // than a step is an edge a grounded torso must not walk through.
    if (groundedSideDeck && groundedSideDeck.y - pos.y > STEP_UP + CONTACT_EPS) {
      pos.x = state.pos.x;
      pos.z = state.pos.z;
      vel.x = 0;
      vel.z = 0;
    }
    const desired = Math.atan2(vel.x, vel.z);
    yaw += shortestAngle(yaw, desired) * (1 - Math.exp(-(6 + speed * 1.6) * dt));
  }

  // Push out of anything the body is standing inside, whether or not it moved.
  // The sweep keeps a body from entering a blocker and has nothing to say about
  // one that is already in — a door that closed on the player, a route swap, a
  // verb whose world changed underneath it. Unconditional because standing
  // still is exactly when a body has no other way out. See resolveOverlapXZ.
  const freed = resolveOverlapXZ(world, pos, CAPSULE_RADIUS, state.capsuleHeight, lowSteps);
  pos.x = freed.x;
  pos.z = freed.z;

  // Support: snap onto the surface under the feet, or drop off a ledge. A
  // small step-down is absorbed; anything lower is a ledge and the player
  // falls (after the coyote grace).
  //
  // `rideOutOfEmbed` guards the one case the point support gets wrong: a body
  // standing ON a landable mass in a sliver too narrow for it (its feet on the
  // cart top, its centre out over the floor of the slot) reads as unsupported
  // and would fall straight back into the embed it was just lifted out of.
  //
  // It is applied to the grounded support ONLY while the body is nearly
  // stationary. A body genuinely WEDGED in a sliver cannot move — the walls kill
  // its velocity — so holding it there is right; but a body walking or falling
  // OFF a mass edge (a RUN_OFF down the hemp stacks, a step off a ledge) is
  // moving, and holding it would cancel the drop. The `stepBallistic` descent
  // uses a different, geometric gate (the foot must descend onto the top from
  // strictly above), so a body that FELL into the sliver still lands on the mass;
  // this only stops the grounded snap from re-lifting a moving body afterwards.
  const baseSupport = supportAhead(world, pos.x, pos.z, vel.x, vel.z, CAPSULE_RADIUS, pos.y, STEP_UP);
  // The ACTUAL distance travelled this tick, after the sweep and depenetration —
  // not the requested velocity. A wedged body asks to move (into the wall) but
  // the sweep zeros that, so its real displacement is ~0; a body walking off a
  // mass edge actually moves. Gating on the realised motion is what tells the
  // two apart.
  const movedX = pos.x - state.pos.x;
  const movedZ = pos.z - state.pos.z;
  const movedThisTick = Math.sqrt(movedX * movedX + movedZ * movedZ);
  const support =
    movedThisTick < WEDGE_HOLD_MAX_SPEED * dt
      ? rideOutOfEmbed(world, pos.x, pos.z, baseSupport, CAPSULE_RADIUS, state.capsuleHeight, lowSteps)
      : baseSupport;
  const rise = support ? support.y - pos.y : 0;
  // Anything above the old flush-ledge tolerance is a genuine step, and a step
  // has to fit: rising into a soffit or through an awning is not a step, it is
  // the body being pushed somewhere it cannot be.
  const stepFits =
    !support ||
    rise <= SUPPORT_SNAP_UP ||
    (headClearance(world, pos.x, pos.z, CAPSULE_RADIUS, support.y) >=
      state.capsuleHeight - 0.05 &&
      !deckThroughBody(world, pos.x, pos.z, support.y, state.capsuleHeight));
  if (
    support &&
    stepFits &&
    support.y >= pos.y - STEP_DOWN &&
    support.y <= pos.y + STEP_UP
  ) {
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
    const x0 = pos.x;
    const z0 = pos.z;
    const to = { x: pos.x + vel.x * h, z: pos.z + vel.z * h };
    const sweep = sweepXZ(world, pos, to, CAPSULE_RADIUS, state.capsuleHeight, ignore);
    const slid = slideVelocityXZ(vel, sweep.hitNormals);
    vel.x = slid.x;
    vel.z = slid.z;
    pos.x = sweep.x;
    pos.z = sweep.z;

    // A DECK IS SOLID FROM THE SIDE TOO. The horizontal sweep sees only blockers,
    // so an airborne body could drive its CENTRE in under a deck it does not fit
    // beneath — head above the boards, feet below — carrying its torso through the
    // deck's edge between ticks. That is the residual one-way-deck graze: rare,
    // and invisible to `platformCeilingAt` (which guards a RISING head) and to the
    // support test (which catches a foot landing from ABOVE). `deckThroughBody` is
    // the same centre test the non-penetration invariant asserts, so refusing the
    // horizontal step that first creates a torso cut closes the graze with the
    // exact predicate the harness measures. The body stops against the deck's edge
    // and slides down it on the following substeps, its fall unaffected.
    //
    // Deliberately narrow, so nothing legitimate is caught: it fires only when the
    // move went from clear to cut at the SAME foot height (an horizontal crossing,
    // not the vertical descent), which excludes a body LEAVING a deck (its foot at
    // the plane, its centre carried out past the lip — centre outside the boards,
    // no cut) and a body LANDING from above (its foot over the plane, the plane
    // below the foot, no cut). A body genuinely dropping PAST a lip keeps its
    // centre beyond the boards and is likewise never cut.
    const sideDeck = deckSideBlocker(
      world,
      x0,
      z0,
      pos.x,
      pos.z,
      pos.y,
      state.capsuleHeight,
      ignore,
    );
    if (sideDeck) {
      // Block only when the feet CANNOT reach the deck plane. A leap ONTO a
      // higher ledge legitimately clips the edge while rising to land on top — its
      // peak foot clears the plane — and must be let through; a graze into a
      // roof/canopy side never will, so it is stopped at the edge and slides down
      // it. This is the physical "will your feet make it onto the roof" test, and
      // it is what tells a mantling leap from a torso driven through the fascia.
      const peakFoot = pos.y + (vel.y > 0 ? (vel.y * vel.y) / (2 * GRAVITY) : 0);
      if (peakFoot < sideDeck.y - CONTACT_EPS) {
        pos.x = x0;
        pos.z = z0;
        vel.x = 0;
        vel.z = 0;
      }
    }

    if (vel.y > 0) {
      const clearance = headClearance(world, pos.x, pos.z, CAPSULE_RADIUS, pos.y, ignore);
      const headroom = clearance - state.capsuleHeight;
      const rise = vel.y * h;
      // A DECK IS A CEILING FROM BELOW. `headClearance` sees only blockers, so a
      // rising arc would pass its head straight up through a scaffold staging or
      // an awning — the "platform planes are crossable by ballistic paths" hole.
      // The whole crown is checked against the expanded deck footprint, so a jump
      // under a deck stops at the boards instead of teleporting the body on top.
      const ceiling = platformCeilingAt(
        world,
        pos.x,
        pos.z,
        CAPSULE_RADIUS,
        pos.y,
        state.capsuleHeight,
        ignore,
      );
      const deckHeadroom =
        ceiling === Infinity
          ? Infinity
          : Math.max(0, ceiling - (pos.y + state.capsuleHeight));
      const limit = Math.min(headroom, deckHeadroom);
      if (rise > limit) {
        pos.y += Math.max(0, limit);
        vel.y = 0;
      } else {
        pos.y += rise;
      }
    } else {
      // Land on the surface the foot reaches. `rideOutOfEmbed` returns the honest
      // support UNLESS that leaves the capsule embedded in the sliver beside a
      // landable mass, in which case it returns that mass's top — so a body
      // falling into the gap between a cart/crate top and the wall behind it
      // rests ON the mass the instant its foot crosses that top, BEFORE the
      // per-tick horizontal depenetration can wedge the straight-dropping body
      // deeper against the wall.
      const honest = supportBelow(world, pos.x, pos.z, pos.y, CONTACT_EPS);
      const rest = rideOutOfEmbed(world, pos.x, pos.z, honest, CAPSULE_RADIUS, state.capsuleHeight, ignore);
      // A RIDE (rest above the honest floor) is taken only when the foot is
      // STRICTLY ABOVE that top this substep — i.e. it is coming down through the
      // top from higher, a genuine fall into the sliver. An authored drop starts
      // on a ledge with its foot AT the mass top and carries off it, so its foot
      // is never strictly above the top it is leaving; catching it there would
      // cancel the drop. That single test — did the foot descend through this top
      // — separates the two with no speed heuristic and leaves every authored
      // drop on its intended arc.
      const isRide = !!honest && !!rest && rest.y > honest.y + CONTACT_EPS;
      const target = isRide && !(pos.y > rest!.y + CONTACT_EPS) ? honest : rest;
      const newFoot = pos.y + vel.y * h;
      if (target && newFoot <= target.y + CONTACT_EPS) {
        pos.y = target.y; // <=1cm support snap, or rest on the mass a slot dropped it onto
        landed = true;
      } else {
        pos.y = newFoot;
      }
    }
  }

  // Once at the end of the step rather than per substep: a body in flight is
  // being placed by the sweep too, and the same argument applies, but there is
  // no reason to pay four passes eight times a frame for a case that is rare in
  // the air. The action's ignore set is honoured — a vault deliberately treats
  // the thing it is crossing as air, and depenetration must not argue with it.
  const freed = resolveOverlapXZ(world, pos, CAPSULE_RADIUS, state.capsuleHeight, ignore);
  pos.x = freed.x;
  pos.z = freed.z;

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
    // The step must also not carry the feet through a deck. `sweepXZ` and
    // `headClearance` are both blind to platforms, so without this a move whose
    // world grew a deck under it mid-flight would drive the body straight
    // through the boards rather than cancelling. See sweptCapsuleCrossesPlatform.
    const crossedDeck = crossesPlatform(
      world,
      state.pos,
      sample,
      state.capsuleHeight,
      action.ignore,
    );
    if (
      sweep.blockedX ||
      sweep.blockedZ ||
      clearance < state.capsuleHeight - 0.05 ||
      crossedDeck
    ) {
      return cancelAction(world, state);
    }
  }

  // REDUCED MOTION STILL OBEYS THE WORLD. A reduced-motion action skips the
  // per-tick sweep above and snaps to its endpoint in one step, so the only
  // thing standing between it and a teleport through changed geometry is this
  // re-validation of the whole authored path and its destination. In an
  // unchanged world it re-passes exactly the check `beginAuthored` already made;
  // when a deck, door or route swap has arrived under the move it cancels to the
  // nearest validated endpoint instead of completing through the obstruction.
  if (reducedMotion && t >= 1) {
    if (
      !authoredTrajectoryClear(world, action, state.capsuleHeight) ||
      !landingValid(
        world,
        action.endPos.x,
        action.endPos.z,
        CAPSULE_RADIUS,
        action.endPos.y,
        state.capsuleHeight,
        action.ignore,
      )
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

  // THE SOLVER OWNS FINAL POSITION, EVEN DURING AN AUTHORED TRANSITION.
  //
  // The anchored path is a PROPOSAL, not the final position. Until this call the
  // interpolator wrote `sample` straight onto the body — a setPosition-style
  // teleport along the spline — and because the surface being climbed is in
  // `action.ignore` for the per-tick veto above, the spline was free to plant the
  // capsule CENTRE on the obstacle's near face, i.e. a full radius inside the
  // wall, for the whole rise. That is the "climbing through things" defect: the
  // move validates because the one surface it would hit is switched off.
  //
  // Every kinematic controller resolves this the same way (PhysX CCT move() vs
  // setPosition(); Avian move_and_slide's pre/post depenetration): the collision
  // solver decides where the body actually ends the substep. So the proposed
  // sample is pushed out of every solid it would enter — the climbed surface
  // INCLUDED; only the low kerbs the grounded solver already steps through are
  // excluded — which holds the capsule on the OUTSIDE of the face it is climbing
  // and lets it move over the lip only once its feet clear the top (a landable
  // top's solid span no longer overlaps the capsule at foot height, so topping
  // out is never pushed back). This is climbing from the outside, by the same
  // MTV depenetration the free mover uses, rather than a spline through the wall.
  // No ignore set at all. A grounded body may step THROUGH a low landable top
  // (that is `lowStepIds`, the step offset), but an authored climb is topping OUT
  // over exactly such a top, and near the crest the crate/cart top is within a
  // step of the rising foot — so exempting low steps here is what let the mantle
  // keep its capsule a radius inside the crate for the last of the rise. The
  // authored solver pushes out of every solid: the near face while the feet are
  // below the top (climb from outside), and nothing once the feet reach the top,
  // because a landable top's solid span no longer overlaps the capsule there.
  const freed = resolveOverlapXZ(
    world,
    { x: sample.x, y: sample.y, z: sample.z },
    CAPSULE_RADIUS,
    state.capsuleHeight,
  );
  return {
    state: {
      ...state,
      pos: { x: freed.x, y: sample.y, z: freed.z },
      yaw: sample.yaw,
      grounded: false,
      action: { ...action, elapsedMs },
    },
    events: [],
  };
}

/**
 * The raw interpolated spline sample an authored action WANTS to be at for a
 * normalised progress `t`, BEFORE the solver depenetrates it. Exposed read-only
 * so instrumentation can measure how far the collision solver has to move the
 * body off the authored spline each tick — the "solver fighting the animation"
 * divergence — without re-deriving the easing. Pure; changes nothing.
 */
export function sampleAuthoredPath(
  action: AuthoredAction,
  t: number,
): { x: number; y: number; z: number; yaw: number } {
  return samplePath(action, t);
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
    const segX = b.x - a.x;
    const segY = b.y - a.y;
    const segZ = b.z - a.z;
    const len = Math.max(1e-3, Math.sqrt(segX * segX + segY * segY + segZ * segZ));
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
    // AND IT MUST NOT GO THROUGH A FLOOR. Every check above this line asks
    // about blockers, because a blocker is the only thing with a solid span to
    // sweep against — but half the surfaces in this game are platforms, which
    // have no span at all and are therefore invisible to a sweep. Support
    // queries catch a body descending onto one, so they behave like floors in
    // every situation except the one an authored move creates: a climb or a
    // vault that walks its capsule along an anchored path can rise straight
    // through a deck, and the player watches themselves pass through a solid
    // staging. The surfaces the move is FOR are in `ignore`; everything else is
    // a floor and a floor is not something a body goes through.
    if (crossesPlatform(world, previous, sample, capsuleHeight, action.ignore)) {
      return false;
    }
    previous = { x: sample.x, y: sample.y, z: sample.z };
  }
  return true;
}

/**
 * Does the segment from `from` to `to` pass through the plane of a platform,
 * inside that platform's footprint? A thin wrapper over the engine's one shared
 * swept-capsule/platform-plane test, so authored preflight, authored runtime,
 * reduced-motion completion and the ballistic ceiling all agree about which deck
 * a body may not pass through.
 */
function crossesPlatform(
  world: CollisionWorld,
  from: Vec3,
  to: { x: number; y: number; z: number },
  capsuleHeight: number,
  ignore: ReadonlySet<string>,
): boolean {
  return (
    sweptCapsuleCrossesPlatform(
      world,
      from,
      { x: to.x, y: to.y, z: to.z },
      CAPSULE_RADIUS,
      capsuleHeight,
      ignore,
    ) !== null
  );
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
    const x0 = pos.x;
    const z0 = pos.z;
    const to = { x: pos.x + v.x * h, z: pos.z + v.z * h };
    const sweep = sweepXZ(world, pos, to, CAPSULE_RADIUS, STAND_HEIGHT, ignore);
    const slid = slideVelocityXZ(v, sweep.hitNormals);
    v.x = slid.x;
    v.z = slid.z;
    pos.x = sweep.x;
    pos.z = sweep.z;
    // The same deck-as-side wall the live ballistic step enforces, so a preflight
    // arc predicts exactly the landing the body will take (see stepBallistic).
    const sideDeck = deckSideBlocker(world, x0, z0, pos.x, pos.z, pos.y, STAND_HEIGHT, ignore);
    if (sideDeck) {
      const peakFoot = pos.y + (v.y > 0 ? (v.y * v.y) / (2 * GRAVITY) : 0);
      if (peakFoot < sideDeck.y - CONTACT_EPS) {
        pos.x = x0;
        pos.z = z0;
        v.x = 0;
        v.z = 0;
      }
    }
    if (v.y > 0) {
      const headroom = headClearance(world, pos.x, pos.z, CAPSULE_RADIUS, pos.y, ignore) - STAND_HEIGHT;
      const rise = v.y * h;
      // The same deck-as-ceiling the live ballistic step enforces, so a
      // preflight arc predicts exactly the landing the body will take.
      const ceiling = platformCeilingAt(
        world,
        pos.x,
        pos.z,
        CAPSULE_RADIUS,
        pos.y,
        STAND_HEIGHT,
        ignore,
      );
      const deckHeadroom =
        ceiling === Infinity
          ? Infinity
          : Math.max(0, ceiling - (pos.y + STAND_HEIGHT));
      const limit = Math.min(headroom, deckHeadroom);
      if (rise > limit) {
        pos.y += Math.max(0, limit);
        v.y = 0;
      } else {
        pos.y += rise;
      }
    } else {
      // Matches the live ballistic descent exactly (see stepBallistic): rest on
      // the honest support, or ride onto the mass a sliver dropped the body onto
      // only when the foot is STRICTLY ABOVE that top this substep (it descended
      // through it), which leaves an authored drop — foot starting at the top it
      // leaves — on its intended arc.
      const honest = supportBelow(world, pos.x, pos.z, pos.y, CONTACT_EPS);
      const rest = rideOutOfEmbed(world, pos.x, pos.z, honest, CAPSULE_RADIUS, STAND_HEIGHT, ignore);
      const isRide = !!honest && !!rest && rest.y > honest.y + CONTACT_EPS;
      const target = isRide && !(pos.y > rest!.y + CONTACT_EPS) ? honest : rest;
      const newFoot = pos.y + v.y * h;
      if (target && newFoot <= target.y + CONTACT_EPS) {
        pos.y = target.y;
        const valid = landingValid(world, pos.x, pos.z, CAPSULE_RADIUS, target.y, STAND_HEIGHT, ignore);
        return { landed: true, valid, pos, landingId: target.id };
      }
      pos.y = newFoot;
    }
    if (pos.y < -50) break; // fell into the void
  }
  return { landed: false, valid: false, pos, landingId: null };
}

export interface WalkOffPrediction {
  /** True when the trajectory left the ground and came down again. */
  fell: boolean;
  /** Depth of the FIRST fall the body takes, or 0 if it never leaves the ground. */
  dropM: number;
  /** True when that fall ended on a support within the simulated window. */
  landed: boolean;
  /** The surface the first fall landed on, when it landed. */
  landingId: string | null;
  /**
   * Where the body came down (foot centre). Present whether or not it landed on a
   * support — a directed-drop controller reads this to check the predicted capsule
   * footprint against a narrow receiver's safe inset before committing the fall.
   */
  landingPos: Vec3;
}

/**
 * The ONE exact trajectory a body takes if the player keeps doing what they are
 * doing — run through the production integrator itself.
 *
 * This is the honest answer to "will this walk off a lip into a killing fall",
 * and it is honest precisely because it is not a heuristic or a range of guesses
 * but `stepMotion` fed forward: the body's actual current velocity, the raw
 * target it is being pushed toward, the real acceleration blend, the coyote grace
 * REMAINING (carried in `state.airtimeMs`, not a fresh window), the fixed step,
 * and the same swept collision and support the frame loop uses. Whatever the live
 * body would do, this does, one to one — a walk that settles onto a near shelf, a
 * run that clears it and comes down on the street beyond, a fast arc that just
 * reaches a far roof across a gap a slower body drops into. There is nothing to
 * reconcile with production because it IS production.
 *
 * It returns the depth of the FIRST leave-the-ground to touch-the-ground fall.
 * A body that never leaves the ground (walks along, or the target steers it away
 * from the lip) fell nothing. The window is bounded: past the brake ceiling the
 * verb is EDGE_BRAKE whatever is below, so there is no reason to fall the body to
 * the floor of the void.
 */
export function simulateWalkOff(
  world: CollisionWorld,
  state: MotionState,
  targetVelX: number,
  targetVelZ: number,
  opts: { dt?: number; maxMs?: number; maxFallM?: number } = {},
): WalkOffPrediction {
  const dt = opts.dt ?? 1 / 60;
  const maxMs = opts.maxMs ?? 2500;
  const maxFallM = opts.maxFallM ?? Infinity;
  let s = state;
  let elapsed = 0;
  let leftFromY: number | null = null;
  while (elapsed < maxMs) {
    const wasGrounded = s.grounded;
    const wasY = s.pos.y;
    const result = stepMotion(world, s, {
      dt,
      targetVelX,
      targetVelZ,
      reducedMotion: false,
    });
    s = result.state;
    elapsed += dt * 1000;
    if (wasGrounded && !s.grounded) leftFromY = wasY;
    if (leftFromY !== null) {
      const fallenSoFar = leftFromY - s.pos.y;
      if (!s.grounded && fallenSoFar > maxFallM) {
        return {
          fell: true,
          dropM: fallenSoFar,
          landed: false,
          landingId: null,
          landingPos: { ...s.pos },
        };
      }
      if (!wasGrounded && s.grounded) {
        const support = supportBelow(world, s.pos.x, s.pos.z, s.pos.y, CONTACT_EPS);
        return {
          fell: true,
          dropM: leftFromY - s.pos.y,
          landed: true,
          landingId: support?.id ?? null,
          landingPos: { ...s.pos },
        };
      }
    }
    if (s.pos.y < -50) break;
  }
  return {
    fell: leftFromY !== null,
    dropM: leftFromY !== null ? leftFromY - s.pos.y : 0,
    landed: false,
    landingId: null,
    landingPos: { ...s.pos },
  };
}
