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
