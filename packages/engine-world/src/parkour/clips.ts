// The animation contract for flow traversal and the stealth verbs.
//
// This module names clips and nothing else: it holds no THREE import and never
// touches the mixer. Motion owns displacement (every clip is root-neutral); the
// animation layer only plays out the visible pose for the verb this system has
// already committed. That split is why a missing clip degrades to a fallback
// instead of breaking traversal.
//
// The art agent meets this list. `registerCharacterClips(glbKey, spec)` in
// characterAnimation.ts is where the rig declares it; PARKOUR_CLIP_CONTRACT is
// shaped to be passed straight into that call's `expected`.

import type { HangStage } from "../playerMotion.js";
import type { LandingKind, TraversalVerb } from "./tuning.js";

export interface ClipRequest {
  /** Clip name expected on the rig. */
  name: string;
  /** Clip played when the rig does not carry `name` yet. */
  fallback: string;
  /** Plays once and clamps; motion has already committed the displacement. */
  once: boolean;
  /** Target authored length. Motion drives timing, so this is a bake target. */
  targetMs: number;
  /** What the clip must read as. */
  note: string;
}

/** Clips already baked on the player rig and reused unchanged. */
export const EXISTING_PLAYER_CLIPS = [
  "idle",
  "walk",
  "run",
  "jump",
  "runJump",
  "vault",
  "climbUp",
  "climbDown",
] as const;

/**
 * New clips this system needs. Order is priority order: the top of the list is
 * what breaks the feel most visibly if it is missing.
 */
export const PARKOUR_CLIP_REQUESTS: readonly ClipRequest[] = [
  {
    name: "mantle",
    fallback: "climbUp",
    once: true,
    targetMs: 450,
    note: "Fast one-hand pull onto a 1.15-1.90m ledge, exits standing and still moving forward. The single most-played new clip; climbUp is too slow and too planted to fake it.",
  },
  {
    name: "slide",
    fallback: "run",
    once: true,
    targetMs: 550,
    note: "Feet-first slide under a low span from a sprint, rising back to a run on exit. Contact with the ground throughout.",
  },
  {
    name: "stepUp",
    fallback: "run",
    once: true,
    targetMs: 200,
    note: "Curb/lip absorb at speed: a single planted stride up onto a surface under 0.5m. Must not read as a stop.",
  },
  {
    name: "dropRoll",
    fallback: "runJump",
    once: true,
    targetMs: 600,
    note: "Shoulder roll out of a 2.2-5.5m drop, exiting into a run.",
  },
  {
    name: "landRun",
    fallback: "run",
    once: true,
    targetMs: 250,
    note: "Short absorb on landing from a jump or a drop under 2.2m, keeping stride. Upper-body-weighted so it can blend over run.",
  },
  {
    name: "leapOfFaith",
    fallback: "runJump",
    once: false,
    targetMs: 1200,
    note: "Loopable swan dive: arms out, back arched, held for the whole descent. The commitment read — it must look irreversible.",
  },
  {
    name: "leapOfFaithLand",
    fallback: "dropRoll",
    once: true,
    targetMs: 800,
    note: "Emerging from the receiving target (hay cart, awning): sit up, swing out, stand. The payoff read.",
  },
  {
    name: "climbOver",
    fallback: "vault",
    once: true,
    targetMs: 520,
    note: "Crossing a chest-to-head-height wall too narrow to stand on: hands on top, hips over, drop the far side.",
  },
  {
    name: "hangDrop",
    fallback: "climbDown",
    once: true,
    targetMs: 420,
    note: "Facing the wall, lower over the lip and release. Used for controlled 2.2-3.2m descents.",
  },
  {
    name: "jumpToHang",
    fallback: "jump",
    once: true,
    targetMs: 450,
    note: "Leap and catch a lip overhead: reach up, both hands take the edge, the body settles onto the grip. The upward mirror of hangDrop. Its window is the catch stage of a JUMP_HANG (playerMotion.HANG_CATCH_MS), not the whole verb.",
  },
  {
    name: "hangIdle",
    fallback: "climbUp",
    once: false,
    targetMs: 300,
    note: "Looping held hang, hands at a known edge. The occupied hold beat of a JUMP_HANG. Cyclic like leapOfFaith — it must never be fitted to a window, only repeated for as long as the hold lasts.",
  },
  {
    name: "landHard",
    fallback: "dropRoll",
    once: true,
    targetMs: 900,
    note: "Heavy landing above 5.5m: knees, hands down, slow recovery. Loud and costly, never fatal.",
  },
  {
    name: "dash",
    fallback: "run",
    once: true,
    targetMs: 320,
    note: "Explosive directed push off one foot, low and forward, recovering into a run. Must read as a decision rather than a faster stride, because it is the only movement verb with a cooldown and the player has to be able to see it fire.",
  },
  {
    name: "throwLight",
    fallback: "idle",
    once: true,
    targetMs: 450,
    note: "Underhand toss of a small object. Upper-body only so it can play additively over walk/run/crouch — the player never stops to throw.",
  },
  {
    name: "crouchIdle",
    fallback: "idle",
    once: false,
    targetMs: 2000,
    note: "Looping low crouch. The stealth stance baseline.",
  },
  {
    name: "crouchWalk",
    fallback: "walk",
    once: false,
    targetMs: 1200,
    note: "Looping crouched movement at 1.15 m/s.",
  },
  {
    name: "blendWalk",
    fallback: "walk",
    once: false,
    targetMs: 1300,
    note: "Unremarkable civilian walk with no runner's urgency, played while crowd-blended. Reads as belonging.",
  },
];

/** Clip name selected for a committed verb. */
export const VERB_CLIP: Readonly<Record<TraversalVerb, string>> = {
  NONE: "run",
  STEP_UP: "stepUp",
  SLIDE: "slide",
  VAULT: "vault",
  CLIMB_OVER: "climbOver",
  // A CLIMB_UP defaults to the one-shot `mantle` — the fast one-hand pull onto a
  // 0.5-1.9m ledge that is by far the common case, and the clip this verb was
  // always meant to carry ("a mantle is a fast CLIMB_UP with a mantle clip",
  // select.ts). The taller ascent (the >1.9m climb band, ladders) is a looping
  // rung-climb, so flow.verbClip / select.planVerb override it back to `climbUp`
  // by the rise — one verb, two silhouettes, the same shape as JUMP/JUMP_GAP.
  // Baked one-shot `mantle` was orphaned before this: CLIMB_UP played the cyclic
  // `climbUp` even over a bare mantle-band ledge, which read as a looping ladder
  // clip on a one-shot move and slid a planted foot at ~4 m/s (check-clip-fidelity).
  CLIMB_UP: "mantle",
  // The clip a jump-hang OPENS on. It is three clips over its window, not one —
  // see HANG_STAGE_CLIP — and the flow controller reads the stage off the motion
  // exactly as it reads JUMP's silhouette off the motion phase. This entry is the
  // one at t=0, so a caller that only knows the verb still gets the right frame.
  JUMP_HANG: "jumpToHang",
  // A named jump from a standstill is the `jump` clip; the flow controller
  // overrides to `runJump` once the body is carrying speed into the arc.
  JUMP: "jump",
  JUMP_GAP: "runJump",
  DASH: "dash",
  HANG_DROP: "hangDrop",
  RUN_OFF: "run",
  LEAP_OF_FAITH: "leapOfFaith",
  EDGE_BRAKE: "run",
  BLOCKED: "idle",
};

/**
 * The three clips a jump-hang plays, by stage.
 *
 * THE PULL-UP IS `mantle`, NOT `freehangClimb`, AND THAT IS A MEASUREMENT RATHER
 * THAN A PREFERENCE. `freehangClimb` is baked on the rig and reads beautifully in
 * isolation, but it carries its ENTIRE 2.13m ascent as hips translation — it is a
 * root-motion clip. Played over a capsule that is also rising, the drawn body
 * separates from the capsule by up to 2.5m and then snaps back when the action
 * ends: the same defect `leapOfFaith` had while it was frozen 2.39m downrange,
 * fixed there by re-baking root-neutral. Removing the translation does not
 * rescue it either — the arm rotations were authored around a moving root, so a
 * flattened take barely lifts the body (measured: local feet 0.254 -> 0.377 over
 * the whole clip) and leaves a 0.2m float at the seam.
 *
 * `mantle` is what this engine's contract asks for and already has: root-neutral
 * (hips constant), opening with the feet on the ground and the hands reaching a
 * lip, ending standing with the feet back at the root — a 4cm seam into
 * locomotion. It is the shipped "pull onto a ledge, exit standing" performance.
 * `freehangClimb` stays on the rig, unplayed, until it is re-baked in place; that
 * is animation work, not engine work, and check-clip-fidelity reports it as an
 * orphan so it cannot be quietly forgotten.
 */
export const HANG_STAGE_CLIP: Readonly<Record<HangStage, string>> = {
  CATCH: "jumpToHang",
  HOLD: "hangIdle",
  PULL: "mantle",
};

/**
 * Verb clips that must LOOP rather than play once.
 *
 * A held attitude is not a beat: it covers however long the body is in the state,
 * so the mixer has to repeat it rather than clamp on its last frame. `hangIdle`
 * is the occupied hang and `leapOfFaith` the held descent, and both are already
 * cyclic in the rig manifest — this is the same fact stated where the flow
 * controller can read it without importing the animation layer.
 */
export const LOOPED_VERB_CLIPS: ReadonlySet<string> = new Set([
  "leapOfFaith",
  "hangIdle",
]);

/** Clip name selected for a resolved landing. */
export const LANDING_CLIP: Readonly<Record<LandingKind, string>> = {
  NONE: "run",
  RUN: "landRun",
  ROLL: "dropRoll",
  HARD: "landHard",
  RECEIVED: "leapOfFaithLand",
};

/**
 * Every clip name this system will ask for, existing and new. Feed this to
 * `registerCharacterClips(glbKey, { fallback: "idle", expected: [...] })` so an
 * unbaked clip warns once at load instead of surfacing as a silent T-pose.
 */
export const PARKOUR_CLIP_CONTRACT: readonly string[] = [
  ...EXISTING_PLAYER_CLIPS,
  ...PARKOUR_CLIP_REQUESTS.map((request) => request.name),
];

/** Clips that must play once and clamp rather than loop. */
export const PARKOUR_ONCE_CLIPS: ReadonlySet<string> = new Set(
  PARKOUR_CLIP_REQUESTS.filter((request) => request.once).map(
    (request) => request.name,
  ),
);

/** Fallback map, so the animation layer can resolve a missing clip locally. */
export const PARKOUR_CLIP_FALLBACKS: Readonly<Record<string, string>> =
  Object.fromEntries(
    PARKOUR_CLIP_REQUESTS.map((request) => [request.name, request.fallback]),
  );

/**
 * Authored screen time per clip, so the mixer can be told how fast to play a
 * Mixamo performance without a second copy of the number.
 *
 * Projected from the same requests rather than restated: `targetMs` is already
 * the answer to "how long should this read for", and the boundary check exists
 * precisely to stop a tuning constant acquiring a duplicate that drifts.
 */
export const PARKOUR_CLIP_TARGET_MS: Readonly<Record<string, number>> =
  Object.fromEntries(
    PARKOUR_CLIP_REQUESTS.map((request) => [request.name, request.targetMs]),
  );
