import {
  AnimationClip,
  Quaternion,
  QuaternionKeyframeTrack,
} from "three";

// Levelling the duel's aim so the barrel is forward and BOTH hands are on the gun in
// every combat pose — not only the standing rest.
//
// THE PROBLEM, MEASURED. `standoff` is the one clip on both production rigs that holds
// the pistol level and two-handed (.affordwork/probe-clip-aim-dir.mjs: the RightHand
// +Y, which the socket makes the muzzle, sits at up-component ~0.05). `idleAim`,
// `aimWalk`, `aimRun` and `fire` were baked with the shooting arm riding up and the
// support hand drifting off the stock — 25–45° of muzzle rise on the officer — which
// on screen is a pistol waved above the face, one-handed. The resting aim is fixed by
// selecting `standoff` for it (see DUEL_CLIP_NAMES). The MOVING aim and the shot need
// the same forward two-handed arms without losing their strides or their recoil.
//
// THE FIX, AND WHY IT IS THIS ONE. The engine already corrects an over-open Mixamo
// arm the same way (`compactPlayerAirborneClips`): keep every authored keyframe and
// blend ONLY the arm rotation toward a known-good pose. Here the known-good pose is
// `standoff`'s arms, and the layers that get it are the aim-locomotion cycles (fully,
// so a strafing fighter aims forward with both hands while the legs keep striding
// from the original clip) and the fire recoil (partially, so the shot reads forward
// but still kicks). Nothing touches the legs, the spine, the socket or the aim
// vector; this is a corrective on the arm bones, which is the approach the owner
// asked for over fighting the clip with a static socket rotation.

/** Arm chain that carries the weapon and the support hand. Fingers (…Index1) excluded by the anchor. */
const ARM_TRACK = /(?:Left|Right)(?:Shoulder|Arm|ForeArm|Hand)\.quaternion$/;

/**
 * How far each clip's arms are pulled to the `standoff` aim.
 *   1  — the arms ARE the standoff aim (used for the aim-walk/run cycles).
 *   <1 — a blend that keeps some of the clip's own motion (used for the recoil).
 */
const AIM_LEVEL_BLEND: Readonly<Record<string, number>> = {
  aimWalk: 1,
  aimRun: 1,
  // The raw fire clip throws the muzzle up past the face (measured up-component ~0.6,
  // and torso-driven so a partial arm blend cannot fully level it), which is exactly
  // the look the owner rejected. Firing therefore holds the same forward two-handed
  // aim as the rest; the shot reads from the muzzle flash and the projectile, not
  // from swinging the barrel to the sky.
  fire: 1,
};

/**
 * Return the rig's clips with the aim-locomotion and fire arms levelled to the
 * `standoff` two-handed forward aim. Clips without an entry in `AIM_LEVEL_BLEND` are
 * returned untouched (same object), so `standoff`, `draw`, `reload`, `hit`, `death`
 * and every traversal clip are unchanged. Pure over the clip list.
 */
export function levelAimArms(clips: readonly AnimationClip[]): AnimationClip[] {
  const standoff = clips.find((clip) => clip.name === "standoff");
  if (!standoff) return [...clips];

  // The standoff arm pose, one rotation per arm-bone track, taken from its first
  // keyframe (the clip holds a steady forward aim, so any frame is representative).
  const target = new Map<string, Quaternion>();
  for (const track of standoff.tracks) {
    if (track instanceof QuaternionKeyframeTrack && ARM_TRACK.test(track.name)) {
      target.set(track.name, new Quaternion().fromArray(track.values, 0));
    }
  }
  if (target.size === 0) return [...clips];

  const scratch = new Quaternion();
  return clips.map((source) => {
    const blend = AIM_LEVEL_BLEND[source.name];
    if (!blend) return source;
    const clip = source.clone();
    for (const track of clip.tracks) {
      if (!(track instanceof QuaternionKeyframeTrack)) continue;
      const goal = target.get(track.name);
      if (!goal) continue;
      for (let index = 0; index < track.values.length; index += 4) {
        scratch.fromArray(track.values, index).slerp(goal, blend).toArray(track.values, index);
      }
    }
    return clip;
  });
}