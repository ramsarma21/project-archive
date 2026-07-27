// What a body is visibly doing, derived from the core's state.
//
// Pure, and deliberately so: every input is either a field of the state the reducer
// returned or a tick recorded off an event it emitted, and the output is a clip role
// plus the numbers needed to time it. Nothing here can change the fight, and the
// same function serves the boss, the local player and a remote PvP opponent because
// its input is a `FighterState` rather than "the player".

import { FIELD_TICK_HZ } from "@pa/duel";
import type { DuelPhase } from "@pa/duel";
import {
  AIM_RUN_THRESHOLD_MPS,
  DUEL_ONE_SHOT_ROLES,
  FIRE_RECOIL_SECONDS,
  HIT_FLINCH_SECONDS,
  drawStartsAtSecond,
  type DuelClipRole,
} from "./duelClips.js";

const MOVING_MPS = 0.25;
/** Beyond this angle between travel and facing, the body is stepping backwards. */
const BACKPEDAL_RAD = 2.0;

const FIRE_RECOIL_TICKS = Math.round(FIRE_RECOIL_SECONDS * FIELD_TICK_HZ);
const HIT_FLINCH_TICKS = Math.round(HIT_FLINCH_SECONDS * FIELD_TICK_HZ);

export interface ActorVisualInput {
  readonly phase: DuelPhase;
  /** Seconds spent in the face-off so far, which is what triggers the draw. */
  readonly faceOffElapsedS: number;
  readonly tick: number;
  readonly downed: boolean;
  readonly crouched: boolean;
  readonly speedMps: number;
  readonly travelOffFacing: number;
  /**
   * Whether the engine's burst is open, from `isDodging(fighter)`. The duel no
   * longer owns dodge displacement at all — the window lives on
   * `MotionState.dash` — so the roll animation asks the engine, not a duel field.
   */
  readonly dashing: boolean;
  readonly lastFireTick: number;
  readonly lastHitTick: number;
}

export interface ActorVisual {
  readonly role: DuelClipRole;
  readonly loopOnce: boolean;
  readonly speedMps: number;
  readonly backpedalling: boolean;
}

/**
 * Priority order, and why it is this order:
 *
 *   death   — terminal; nothing outranks being down.
 *   flinch  — a landed hit must always read, or damage becomes invisible.
 *   roll    — the core refuses to fire mid-dodge, so the roll cannot mask a shot.
 *   recoil  — the shot that was actually taken.
 *   reload  — only during BULLETS_GRANTED, whose length IS the reload's length.
 *   stance  — crouch is a real mechanic here: a ball aimed at a standing chest
 *             passes over a fighter who drops, so the drop has to be visible.
 *   travel  — stride-matched locomotion.
 *   aim     — the resting state of a duel.
 */
export function selectActorVisual(input: ActorVisualInput): ActorVisual {
  const moving = input.speedMps > MOVING_MPS;
  const backpedalling = moving && input.travelOffFacing > BACKPEDAL_RAD;
  const visual = (role: DuelClipRole, loopOnce: boolean): ActorVisual => ({
    role,
    loopOnce,
    speedMps: input.speedMps,
    backpedalling,
  });

  if (input.downed) return visual("death", true);

  if (input.phase === "FACE_OFF") {
    return input.faceOffElapsedS < drawStartsAtSecond()
      ? visual("standoff", false)
      : visual("draw", true);
  }

  if (withinTicks(input.tick, input.lastHitTick, HIT_FLINCH_TICKS)) {
    return visual("hit", true);
  }
  if (input.dashing) return visual("roll", true);
  if (withinTicks(input.tick, input.lastFireTick, FIRE_RECOIL_TICKS)) {
    return visual("fire", true);
  }
  if (input.phase === "BULLETS_GRANTED") return visual("reload", true);

  if (input.crouched) {
    return moving ? visual("crouchWalk", false) : visual("crouchIdle", false);
  }
  if (moving) {
    return input.speedMps > AIM_RUN_THRESHOLD_MPS
      ? visual("aimRun", false)
      : visual("aimWalk", false);
  }
  return visual("aim", false);
}

function withinTicks(tick: number, since: number, window: number): boolean {
  return since >= 0 && tick - since < window && tick >= since;
}

// ---- animation-state stabilization -----------------------------------------
//
// `selectActorVisual` is a PURE snapshot: given a speed and a stance it names a role.
// Fed raw per-frame numbers that is exactly right for the truth of the state, and
// exactly wrong for what the body should LOOK like, because two adjacent frames whose
// speed straddles a threshold pick different roles and the mixer crossfades every one.
// For a remote opponent the speed is a discrete per-snapshot velocity that steps ~20
// times a second, and for a boss it can dither around the walk/run line — either way
// the body flickers between aim, aimWalk and aimRun even while it slides smoothly.
//
// The stabilizer is the small amount of PRESENTATION STATE that fixes this without
// touching what is drawn WHERE (position and yaw are still the authoritative,
// interpolated transform). It does two things: it smooths the speed the animation
// reads, so the walk/run choice and the playback rate follow real motion rather than
// raw velocity; and it debounces role changes AMONG the steady locomotion/stance
// states with a short dwell, so a momentary threshold cross does not commit. Event
// roles — a shot, a hit, a roll, a death, the draw — are never debounced: they must
// read on the frame they happen.

/** Roles chosen from continuous speed/stance, and therefore able to flicker. */
const STEADY_ROLES: ReadonlySet<DuelClipRole> = new Set<DuelClipRole>([
  "aim",
  "aimWalk",
  "aimRun",
  "crouchIdle",
  "crouchWalk",
]);

/** Time constant for the speed the animation reads, seconds. Short: a fifth of a stride. */
export const VISUAL_SPEED_SMOOTH_TAU_S = 0.09;
/** How long a new steady-state role must persist before it commits, seconds. */
export const VISUAL_ROLE_DWELL_S = 0.12;

export interface VisualStabilizer {
  smoothedSpeed: number;
  role: DuelClipRole | null;
  candidate: DuelClipRole | null;
  candidateForS: number;
  primed: boolean;
}

export function createVisualStabilizer(): VisualStabilizer {
  return { smoothedSpeed: 0, role: null, candidate: null, candidateForS: 0, primed: false };
}

/**
 * Stabilize a body's visual across frames: smooth the animation-read speed and debounce
 * steady-state role churn. Mutates `state` and returns the role to draw this frame. The
 * returned `speedMps` is the SMOOTHED value the mixer should time itself against, so a
 * stride does not stutter when the raw velocity steps.
 */
export function stabilizeActorVisual(
  state: VisualStabilizer,
  input: ActorVisualInput,
  dtS: number,
): ActorVisual {
  const dt = Math.max(0, dtS);
  if (!state.primed) {
    state.smoothedSpeed = input.speedMps;
  } else {
    const k = dt > 0 ? Math.min(1, dt / VISUAL_SPEED_SMOOTH_TAU_S) : 0;
    state.smoothedSpeed += (input.speedMps - state.smoothedSpeed) * k;
  }

  const candidate = selectActorVisual({ ...input, speedMps: state.smoothedSpeed });

  // Debounce only when moving BETWEEN two steady states; an event role, or leaving one
  // for locomotion, commits immediately.
  const debounce =
    state.primed &&
    state.role !== null &&
    STEADY_ROLES.has(state.role) &&
    STEADY_ROLES.has(candidate.role);

  if (!state.primed || !debounce || candidate.role === state.role) {
    state.role = candidate.role;
    state.candidate = null;
    state.candidateForS = 0;
    state.primed = true;
  } else if (state.candidate === candidate.role) {
    state.candidateForS += dt;
    if (state.candidateForS >= VISUAL_ROLE_DWELL_S) {
      state.role = candidate.role;
      state.candidate = null;
      state.candidateForS = 0;
    }
  } else {
    state.candidate = candidate.role;
    state.candidateForS = 0;
  }

  // Non-null after the block: the first-ever call takes the `!state.primed` branch,
  // which always commits a role; the fallback keeps the type honest regardless.
  const role = state.role ?? candidate.role;
  return {
    role,
    loopOnce: DUEL_ONE_SHOT_ROLES.has(role),
    speedMps: state.smoothedSpeed,
    backpedalling: candidate.backpedalling,
  };
}
