// Bone sockets. There was no way to put anything in a character's hand anywhere
// in this repo before this file.
//
// The existing prop helper (`FittedGlb`) bottom-centres its payload, which is
// correct for a crate standing on a street and wrong for a held object: a pistol
// has to arrive in the palm at real scale, in the grip's own orientation, and then
// inherit every bone transform the clip drives.
//
// Three problems, and how each is solved:
//
//   1. WHICH BONE. The cast is Mixamo-derived but not uniformly named. The player
//      rig carries `mixamorig:RightHand`, which three's GLTFLoader sanitises to
//      `mixamorigRightHand`; the constable rig carries a bare `RightHand`. So the
//      name is resolved against the rig at runtime — candidates first, then a
//      pattern that refuses finger bones — instead of being asserted.
//   2. SCALE. Mixamo armatures are authored in centimetres and exported with a
//      0.01 root scale, and the loader then scales the whole rig again to hit a
//      target height. A child of the hand bone therefore inherits a world scale
//      around 0.006, which would render a 0.40m pistol at about 2mm. The socket
//      undoes exactly that, so its children live in metres.
//   3. ORIENTATION. Derived, not guessed. In the bind pose both rigs' hand bones
//      agree: local +Y runs wrist-to-knuckles, local +X is the thumb side, local
//      +Z is the palm normal. A gripped cylinder lies along the knuckle line
//      (local X), and the barrel continues the line of the forearm (local Y), which
//      fixes the mapping below. TRIM_EULER_DEG is the only by-eye part, and it is
//      small because the base mapping is right.

import { Euler, Matrix4, Quaternion, Vector3, type Object3D } from "three";

/** Real length of the flintlock asset along its own +X, in metres. */
export const PISTOL_LENGTH_M = 0.4;

/**
 * Names to try before falling back to a pattern. Ordered by how likely the rig is
 * to be one of ours.
 */
export const HAND_BONE_CANDIDATES: readonly string[] = [
  // GLTFLoader strips the colon from "mixamorig:RightHand".
  "mixamorigRightHand",
  "mixamorig:RightHand",
  "mixamorig_RightHand",
  "RightHand",
  "Right_Hand",
  "hand_r",
  "Bip01_R_Hand",
];

/** A hand, not a finger: `RightHandIndex2` must never win. */
const HAND_BONE_PATTERN = /(?:^|[:_.\s])(?:right|r)[_\s.]?hand$/i;
const FINGER_PATTERN = /(index|thumb|middle|ring|pinky|little)/i;

/**
 * The right-hand bone on this rig, or null when the rig has none. Pure over the
 * rig's node names so it is testable without a scene.
 */
export function resolveHandBoneName(
  names: readonly string[],
): string | null {
  for (const candidate of HAND_BONE_CANDIDATES) {
    if (names.includes(candidate)) return candidate;
  }
  const matched = names.find(
    (name) => HAND_BONE_PATTERN.test(name) && !FINGER_PATTERN.test(name),
  );
  return matched ?? null;
}

/** Find the bone object itself, by the name this rig actually uses. */
export function findHandBone(root: Object3D): Object3D | null {
  const names: string[] = [];
  root.traverse((node) => {
    if (node.name) names.push(node.name);
  });
  const name = resolveHandBoneName(names);
  return name ? root.getObjectByName(name) ?? null : null;
}

// ---- orientation -----------------------------------------------------------

/**
 * Where each of the pistol's own axes has to end up in hand-bone space.
 *
 * The asset's convention: +X is the muzzle, +Y is up out of the frame, and the
 * grip descends towards -Y. The hand bone's convention (measured off the bind
 * pose of both production rigs, and the same on each): +Y wrist-to-knuckles, +X
 * thumb side, +Z palm normal.
 */
export const GRIP_AXIS_MAP = {
  /** The barrel continues the line of the hand. */
  muzzle: new Vector3(0, 1, 0),
  /** Up the grip towards the frame is the thumb side; the butt hangs the other way. */
  gripUp: new Vector3(1, 0, 0),
  /** Right flank of the weapon faces away from the palm. */
  flank: new Vector3(0, 0, -1),
} as const;

/**
 * Small by-eye correction on top of the derived mapping.
 *
 * A real grip rakes back rather than sitting square to the barrel, and the wrist
 * carries the weapon canted slightly inboard. Both are rotations of a few degrees
 * and both were set by looking at renders, which is why they live here by
 * themselves instead of being folded into the derived basis above.
 */
export const TRIM_EULER_DEG: readonly [number, number, number] = [0, 0, -14];

/**
 * How far to slide the weapon up its own grip so the palm closes around the grip's
 * middle instead of its top.
 *
 * The asset's origin sits on the grip at its top: the butt is 0.123m below it, so
 * the middle of the grip — where a palm actually closes — is about 6cm down. The
 * weapon is therefore lifted by that much along its own +Y.
 */
export const PALM_DROP_M = 0.06;

/**
 * Final seating of the socket in the hand bone's own frame, in metres. Pushes the
 * weapon a little out of the wrist and towards the fingers so the grip sits in the
 * palm rather than inside it.
 */
export const SOCKET_OFFSET_M: readonly [number, number, number] = [0.012, 0.02, 0.006];

const scratchMatrix = new Matrix4();
const scratchEuler = new Euler();
const scratchTrim = new Quaternion();

/** The rotation that seats the weapon in the hand, derived basis plus trim. */
export function gripQuaternion(
  trimEulerDeg: readonly [number, number, number] = TRIM_EULER_DEG,
): Quaternion {
  scratchMatrix.makeBasis(
    GRIP_AXIS_MAP.muzzle,
    GRIP_AXIS_MAP.gripUp,
    GRIP_AXIS_MAP.flank,
  );
  const base = new Quaternion().setFromRotationMatrix(scratchMatrix);
  const toRad = Math.PI / 180;
  scratchEuler.set(
    trimEulerDeg[0] * toRad,
    trimEulerDeg[1] * toRad,
    trimEulerDeg[2] * toRad,
    "XYZ",
  );
  scratchTrim.setFromEuler(scratchEuler);
  return base.multiply(scratchTrim);
}

/**
 * Scale a socket needs so its children are in metres, given the world scale it
 * inherits from the bone. Returns 1 for a degenerate scale rather than dividing
 * by zero and losing the weapon to a NaN transform.
 */
export function socketInverseScale(boneWorldScale: number): number {
  if (!Number.isFinite(boneWorldScale) || Math.abs(boneWorldScale) < 1e-9) return 1;
  return 1 / boneWorldScale;
}
