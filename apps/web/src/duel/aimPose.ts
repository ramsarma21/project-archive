import {
  AnimationClip,
  Quaternion,
  QuaternionKeyframeTrack,
} from "three";

// Making the flintlock read as HELD in every combat pose, with the shooting arm
// aimed level and the support arm settled instead of grabbing at empty air.
//
// THE PROBLEM, MEASURED (and re-confirmed in real play, .affordwork/observe-boss).
// The pistol is seated correctly in the RIGHT hand by the weapon socket. The trouble
// is the SUPPORT (left) arm: the aim clips on both production rigs were baked as a
// two-handed LONG-GUN present, so the left hand reaches forward to a forestock a
// short flintlock does not have. On screen the off-hand floats forward and below the
// barrel with a visible gap — worst on the officer, whose left hand hangs open in
// mid-air — which is exactly the "hands glitched off the weapon / holds with one
// hand" the owner reported (clip 0:49, 0:52, 2:01, 2:07). Two earlier attempts to
// force BOTH hands onto the gun by copying `standoff`'s arms did not fix it, because
// `standoff` is itself that same long-gun pose: copying it just spread the defect to
// the moving clips.
//
// THE FIX. Correct the two arms SEPARATELY, keeping every authored keyframe and
// blending only the arm rotations (the approach the engine already uses for
// `compactPlayerAirborneClips`):
//
//   * RIGHT (shooting) arm  -> the `standoff` pose, so the barrel stays level and
//     forward in the aim-locomotion cycles and the shot (the muzzle rise that made
//     `fire`/`idleAim` read as a pistol waved over the face is removed).
//   * LEFT (support) arm    -> the relaxed `idle` pose, so it settles naturally at
//     the side rather than reaching for a stock that is not there. The result is a
//     clean, period-accurate one-handed duelling hold with NO floating hand.
//
// Nothing touches the legs, the spine, the socket or the aim vector.
//
// THE HONEST LIMIT, for whoever owns the cast next. This is the best a code-only
// corrective can do with the clips that exist: it makes the hold read as a deliberate
// one-handed aim. A genuinely TWO-HANDED pistol present — support hand cupped under
// the firing hand — needs a purpose-baked pistol-aim clip (the current ones are
// long-gun aims), or an off-hand IK target driven onto the weapon each frame. Either
// is an asset/rig change out of this file's scope; if a two-handed look is wanted,
// bake `standoff`/`aimWalk`/`aimRun`/`fire` with the left hand on the pistol and this
// left-arm relax can be dropped.

/** The shooting arm: leveled to the standoff aim so the barrel points forward. */
const RIGHT_ARM_TRACK = /Right(?:Shoulder|Arm|ForeArm|Hand)\.quaternion$/;
/** The support arm: settled to the relaxed idle pose so it stops grabbing at air. */
const LEFT_ARM_TRACK = /Left(?:Shoulder|Arm|ForeArm|Hand)\.quaternion$/;

/**
 * Clips whose SHOOTING (right) arm is pulled to the `standoff` level aim. `standoff`
 * is not listed — it is the source pose, so leveling it to itself is a no-op — but
 * its support arm is still relaxed below (see LEFT_RELAX_CLIPS).
 */
const RIGHT_LEVEL_BLEND: Readonly<Record<string, number>> = {
  aimWalk: 1,
  aimRun: 1,
  // The raw fire clip throws the muzzle up past the face (measured up-component ~0.6,
  // torso-driven so a partial arm blend cannot fully level it). Firing therefore holds
  // the same forward aim as the rest; the shot reads from the muzzle flash and the
  // projectile, not from swinging the barrel to the sky.
  fire: 1,
};

/**
 * Clips whose SUPPORT (left) arm is settled to the relaxed `idle` pose. `standoff` is
 * included because the resting-aim role plays it directly, so the floating support
 * hand has to be fixed there too, not only in the moving clips.
 */
const LEFT_RELAX_CLIPS: ReadonlySet<string> = new Set([
  "standoff",
  "aimWalk",
  "aimRun",
  "fire",
]);

function armPose(clip: AnimationClip, match: RegExp): Map<string, Quaternion> {
  const pose = new Map<string, Quaternion>();
  for (const track of clip.tracks) {
    if (track instanceof QuaternionKeyframeTrack && match.test(track.name)) {
      // A steady held pose, so the first keyframe is representative.
      pose.set(track.name, new Quaternion().fromArray(track.values, 0));
    }
  }
  return pose;
}

/**
 * Return the rig's clips with the aim-family SHOOTING arm leveled to `standoff` and
 * the SUPPORT arm settled to `idle`. Clips outside those sets (`draw`, `reload`,
 * `hit`, `death`, `dodge`, and every traversal clip) are returned untouched (same
 * object). Pure over the clip list; safe when a rig lacks `standoff` or `idle`.
 */
export function levelAimArms(clips: readonly AnimationClip[]): AnimationClip[] {
  const standoff = clips.find((clip) => clip.name === "standoff");
  const idle = clips.find((clip) => clip.name === "idle");
  const rightTarget = standoff ? armPose(standoff, RIGHT_ARM_TRACK) : new Map();
  const leftTarget = idle ? armPose(idle, LEFT_ARM_TRACK) : new Map();
  if (rightTarget.size === 0 && leftTarget.size === 0) return [...clips];

  const scratch = new Quaternion();
  return clips.map((source) => {
    const rightBlend = RIGHT_LEVEL_BLEND[source.name];
    const relaxLeft = LEFT_RELAX_CLIPS.has(source.name) && leftTarget.size > 0;
    const levelRight = rightBlend !== undefined && rightTarget.size > 0;
    if (!relaxLeft && !levelRight) return source;

    const clip = source.clone();
    for (const track of clip.tracks) {
      if (!(track instanceof QuaternionKeyframeTrack)) continue;
      let goal: Quaternion | undefined;
      let blend = 1;
      if (levelRight && RIGHT_ARM_TRACK.test(track.name)) {
        goal = rightTarget.get(track.name);
        blend = rightBlend;
      } else if (relaxLeft && LEFT_ARM_TRACK.test(track.name)) {
        goal = leftTarget.get(track.name);
        blend = 1;
      }
      if (!goal) continue;
      for (let index = 0; index < track.values.length; index += 4) {
        scratch.fromArray(track.values, index).slerp(goal, blend).toArray(track.values, index);
      }
    }
    return clip;
  });
}
