// Which clip plays, and how fast. Nothing here decides anything about the fight.
//
// TWO INDIRECTIONS, ON PURPOSE.
//
//   1. NAMES. The duel asks for a ROLE ("the roll", "the aim idle") and this file
//      maps it to the clip baked on the rig. The rebake is expected to rename
//      `dodge` to `roll`, so that rename is one line in DUEL_CLIP_NAMES rather
//      than a search across the presentation layer.
//   2. SPEED. Authored Mixamo performances do not run at the speed the code
//      drives, so every clip is either stride-matched against
//      CLIP_AUTHORED_SPEED_MPS or fitted to the duration of the beat it has to
//      cover. Neither number is eyeballed: locomotion uses the engine's measured
//      cycle speeds, and one-shots are fitted to a tuning constant the core
//      already owns (a reload fits the resume countdown; a roll fits the dodge
//      window).
//
// The only genuinely by-eye numbers are the two visual beats the core has no
// constant for — how long a shot's recoil and a flinch should read — and they are
// named and isolated below.

import {
  CLIP_AUTHORED_MS,
  DASH_DURATION_MS,
  RUN_SPEED,
  WALK_SPEED,
  strideTimeScale,
} from "@pa/engine-world";
import { FACE_OFF_SECONDS, RESUME_COUNTDOWN_SECONDS } from "@pa/duel";

/**
 * What the duel needs a body to be doing. The vocabulary is the duel's, not the
 * rig's: `roll` is the dodge burst whatever the animator called the clip.
 */
export type DuelClipRole =
  | "standoff"
  | "draw"
  | "aim"
  | "aimWalk"
  | "aimRun"
  | "fire"
  | "reload"
  | "roll"
  | "hit"
  | "death"
  | "crouchIdle"
  | "crouchWalk";

/**
 * Role to clip baked on the production rig (`playerboy-rigged`, 2026-07-25 duel
 * rebake). A rig that does not carry a clip falls back through the engine's
 * `chooseAvailableClip`, which is how the boss rig — which has no duel bake yet —
 * still animates instead of freezing.
 */
export const DUEL_CLIP_NAMES: Readonly<Record<DuelClipRole, string>> = {
  standoff: "standoff",
  draw: "draw",
  // THE RESTING AIM IS `standoff`, NOT `idleAim`. Both are baked on both rigs, and
  // both point the barrel roughly downrange — but they are not equally good aims, and
  // the difference is measurable off the GLB (.affordwork/probe-clip-aim-dir.mjs
  // forward-kinematics the RightHand bone, whose +Y is the muzzle once the socket
  // seats it). Across its whole loop `standoff` holds the muzzle level and BOTH hands
  // on the stock: the hand's +Y up-component is 0.04–0.09 on the officer and about
  // -0.1 on the player, i.e. horizontal. `idleAim` rides the muzzle 25–28° ABOVE
  // level the entire loop (up-component ~0.47 on the officer, ~0.26 on the player)
  // and drops the support hand off the weapon — which on screen reads as the pistol
  // held up past the face, one-handed, exactly the frame the owner rejected twice.
  // `standoff` is the two-handed forward present the duel actually wants, so the
  // resting-aim role plays it. `idleAim` is left unused rather than deleted; removing
  // a baked clip is an asset-pipeline change, and this is a one-line selection fix
  // that both PvE (DuelActor) and PvP (ArenaActor) inherit through this table.
  aim: "standoff",
  aimWalk: "aimWalk",
  aimRun: "aimRun",
  fire: "fire",
  reload: "reload",
  // Expected to become "roll" in the next rebake. One line.
  roll: "dodge",
  hit: "hitReaction",
  death: "death",
  crouchIdle: "crouchIdle",
  crouchWalk: "crouchWalk",
};

/** Roles that play once and clamp on their last frame. */
export const DUEL_ONE_SHOT_ROLES: ReadonlySet<DuelClipRole> = new Set<DuelClipRole>([
  "draw",
  "fire",
  "reload",
  "roll",
  "hit",
  "death",
]);

/** Roles whose cadence is a stride and must be matched to ground speed. */
export const DUEL_LOCOMOTION_ROLES: ReadonlySet<DuelClipRole> = new Set<DuelClipRole>([
  "aimWalk",
  "aimRun",
  "crouchWalk",
]);

// ---- the beats a one-shot has to cover -------------------------------------

/**
 * The draw closes the face-off: the last seconds of the standoff, so the round
 * opens on two raised weapons rather than on a cut.
 */
export const DRAW_SECONDS = 2.5;
/** Recoil beat. Tuned by eye: the authored performance is a 2.7s full raise-and-settle. */
export const FIRE_RECOIL_SECONDS = 0.9;
/** Flinch beat. Tuned by eye; long enough to read as a hit, short enough to keep fighting. */
export const HIT_FLINCH_SECONDS = 0.7;

/**
 * How long each one-shot role is given. `reload` and `roll` are the two that are
 * not judgement calls: the reload IS the resume countdown the core counts, and the
 * roll IS the engine's burst, whose authored length is `DASH_DURATION_MS`. Neither
 * number is restated here, so if the burst is retuned the animation follows it.
 */
const ONE_SHOT_SECONDS: Readonly<Partial<Record<DuelClipRole, number>>> = {
  draw: DRAW_SECONDS,
  fire: FIRE_RECOIL_SECONDS,
  reload: RESUME_COUNTDOWN_SECONDS,
  roll: DASH_DURATION_MS / 1000,
  hit: HIT_FLINCH_SECONDS,
  // `death` is deliberately absent: a death is allowed to take as long as it was
  // authored to take.
};

/** Tick of the face-off at which the draw begins. */
export function drawStartsAtSecond(faceOffSeconds = FACE_OFF_SECONDS): number {
  return Math.max(0, faceOffSeconds - DRAW_SECONDS);
}

/** Speed above which the run cycle reads better than the walk cycle. */
export const AIM_RUN_THRESHOLD_MPS = (WALK_SPEED + RUN_SPEED) / 2;

/**
 * Mixer timeScale for a role.
 *
 * `authoredSeconds` is the clip's real length: CLIP_AUTHORED_MS when the engine
 * has measured it, otherwise the loaded AnimationClip's own duration, which the
 * caller passes in. Guessing is not an option in either branch.
 */
export function duelClipTimeScale(input: {
  role: DuelClipRole;
  authoredSeconds: number;
  speedMps?: number;
  /** True when the body is travelling roughly opposite to the way it faces. */
  backpedalling?: boolean;
}): number {
  if (DUEL_LOCOMOTION_ROLES.has(input.role)) {
    const stride = strideTimeScale(
      DUEL_CLIP_NAMES[input.role],
      Math.max(0, input.speedMps ?? 0),
    );
    // An aim set authored walking forwards has no strafe or reverse cycle. Played
    // backwards it reads as a genuine back-step instead of a moonwalk, which is
    // the cheapest honest fix available without a new bake.
    return input.backpedalling ? -stride : stride;
  }
  const target = ONE_SHOT_SECONDS[input.role];
  if (!target || target <= 0 || input.authoredSeconds <= 0) return 1;
  return input.authoredSeconds / target;
}

/** Authored length of a clip in seconds, preferring the engine's measurement. */
export function authoredSecondsFor(
  role: DuelClipRole,
  loadedDurationSeconds: number,
): number {
  const measured = CLIP_AUTHORED_MS[DUEL_CLIP_NAMES[role]];
  if (measured && measured > 0) return measured / 1000;
  return loadedDurationSeconds;
}
