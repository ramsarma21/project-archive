import { chooseAvailableClip } from "@pa/engine-world";
import { DUEL_CLIP_NAMES } from "./duelClips.js";

// Which clip the hero portrait poses to, and by how much the gaze is lifted.
//
// The portrait wants the SAME two-handed forward present the duel resting-aim uses —
// `DUEL_CLIP_NAMES.aim`, which the pose worker pointed at the `standoff` bake (both
// hands on the stock, muzzle level). See the long note in duelClips.ts for why that
// clip and not `idleAim`. Selecting through the same table means the portrait inherits
// the pose worker's corrections automatically and can never drift from what the fighter
// actually holds.
//
// The one thing the combat pose does NOT give a portrait is a face: the standoff head
// is pitched down the sights at a target that, in a portrait, is off-camera and low. So
// the portrait lifts the gaze toward the viewer with a small, fixed correction on the
// neck and head bones (applied in the render, tested here only for its magnitude bounds
// so a future tweak cannot silently crane the head off the neck).

/**
 * The clip name to pose the portrait to, resolved through the shared role table with
 * the engine's own fallback, or null if the rig carries nothing at all.
 */
export function portraitClipName(
  glbKey: string,
  availableNames: readonly string[],
): string | null {
  return (
    chooseAvailableClip(glbKey, DUEL_CLIP_NAMES.aim, availableNames) ??
    availableNames[0] ??
    null
  );
}

/** Fraction of the clip's loop to sample: a settled point, not the first frame. */
export const PORTRAIT_SAMPLE_FRACTION = 0.5;
/** Cap on how far into the loop the sample can land, so a long clip is not over-run. */
export const PORTRAIT_SAMPLE_MAX_SECONDS = 0.6;

/**
 * Gaze-lift applied to the portrait so the face reads toward the viewer despite the
 * standoff's downward aim. Split across the neck and head so the correction curves
 * naturally rather than snapping the skull. Radians of pitch-up; bounded well under a
 * quarter-turn so it can only ever lift a gaze, never invert a neck.
 */
export const PORTRAIT_NECK_LIFT_RAD = 0.26;
export const PORTRAIT_HEAD_LIFT_RAD = 0.58;

export function portraitSampleSeconds(clipDurationSeconds: number): number {
  if (!(clipDurationSeconds > 0)) return 0;
  return Math.min(PORTRAIT_SAMPLE_MAX_SECONDS, clipDurationSeconds * PORTRAIT_SAMPLE_FRACTION);
}
