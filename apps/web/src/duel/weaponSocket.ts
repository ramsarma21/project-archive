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

import { Euler, Group, Matrix4, Quaternion, Vector3, type Object3D } from "three";

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

// DERIVED, NOT GUESSED — and the derivation starts from the asset's TRUE axes,
// measured off the GLB's own POSITION data (.affordwork/inspect-flintlock-muzzle.mjs
// slabs the mesh along X and reports each slab's cross-section):
//
//   * The barrel is the long X axis. The MUZZLE is the -X end — a thin ~27mm bore
//     ring — and the breech, lock and grip block are at +X. This is the whole fix:
//     an earlier revision asserted +X was the muzzle, which seated the gun with the
//     barrel pointing back at the shooter (the "gun is backward" defect). The bore
//     ring is unambiguous in the mesh; the barrel points -X.
//   * The grip descends toward -Y; the top of the frame is +Y.
//   * Z is the thin flank.
//
// The hand bone's convention (measured off the bind pose of both production rigs,
// and the same on each): local +Y runs wrist-to-knuckles and lines up with the aim
// in an aim pose, +X is the thumb side (up when aiming), +Z is the palm normal.
//
// The seating rotation is therefore the one rotation that carries each of the gun's
// own axes onto the hand axis it belongs on: the MUZZLE onto the aim, the top of the
// frame onto the thumb side (so the grip hangs down into the palm, never inverted),
// and the flank onto the palm normal. It is built as that basis-to-basis map below,
// so the GLB-axis -> bone-axis correspondence is stated once and explicitly rather
// than as an opaque quaternion.

/**
 * The flintlock's own axes, in its local space. Right-handed triad
 * (muzzle x top = flank), so the derived map is a rotation and never a reflection.
 */
export const ASSET_MUZZLE_AXIS = new Vector3(-1, 0, 0);
export const ASSET_TOP_AXIS = new Vector3(0, 1, 0);
/** -Z completes the right-handed triad; the physical right flank is +Z. */
export const ASSET_FLANK_AXIS = new Vector3(0, 0, -1);

/**
 * The hand bone's axes in an aim pose. Same right-handed triad
 * (aim x thumb = the third), for the same reason.
 */
export const BONE_AIM_AXIS = new Vector3(0, 1, 0);
export const BONE_THUMB_AXIS = new Vector3(1, 0, 0);
export const BONE_THIRD_AXIS = new Vector3(0, 0, -1);

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
 * The grip point in the asset's own space, in metres: where a hand actually closes
 * around the stock. MEASURED off the GLB's POSITION data
 * (.affordwork/probe-flintlock-grip.mjs), not guessed.
 *
 * This is the fix for the "gun is not in the hand" defect. The flintlock's model
 * ORIGIN is not on the grip at all — it sits near the breech end of the barrel, at
 * asset X≈0 — while the grip block runs out toward +X and descends in -Y. An earlier
 * revision seated the weapon by that origin (sliding it only a few centimetres in
 * +Y), which left the hand closing on empty space beside the barrel and the whole
 * gun floating ~0.29m off the palm. Seating by the grip point instead is what puts
 * the stock in the fingers.
 *
 *   grip column   X ≈ 0.287  (out toward the butt/lock end)
 *   grip middle   Y ≈ -0.087 (the frame underside is ~-0.052, the butt ~-0.123)
 *   centred       Z ≈ 0
 */
export const GRIP_POINT_M: readonly [number, number, number] = [0.287, -0.087, 0];

/**
 * A small slide along the grip, in metres, on top of the measured grip point. Zero
 * seats the palm at the grip's measured middle; positive slides the hand toward the
 * butt, negative toward the frame. It is a by-eye fine-tune, which is why it is a
 * knob rather than being folded into GRIP_POINT_M.
 */
export const PALM_DROP_M = 0;

/**
 * The weapon's local position inside the hold group: the negated grip point, so the
 * grip lands at the hold origin (the hand), with the palm-drop slide applied along
 * the grip's own +Y axis. The hold group carries the seating rotation, so this
 * translation is expressed in the asset's own axes and never rotates the barrel.
 */
export function weaponLocalOffset(
  palmDrop: number = PALM_DROP_M,
): [number, number, number] {
  return [-GRIP_POINT_M[0], -GRIP_POINT_M[1] + palmDrop, -GRIP_POINT_M[2]];
}

/**
 * Final seating of the socket in the hand bone's own frame, in metres. A small push
 * out of the wrist and towards the fingers so the grip sits in the palm rather than
 * inside the joint.
 */
export const SOCKET_OFFSET_M: readonly [number, number, number] = [0.012, 0.02, 0.006];

const scratchEuler = new Euler();
const scratchTrim = new Quaternion();

/**
 * The basis-to-basis rotation carrying the gun's own axes onto the hand's, computed
 * once. `assetBasis` has the gun's axes as its columns and `boneBasis` the hand's,
 * so `boneBasis * assetBasis⁻¹` is the rotation `R` with `R·muzzle = aim`,
 * `R·top = thumb`, `R·flank = palm`. Both triads are right-handed, so `R` is a
 * proper rotation.
 */
const SEATING_BASIS = (() => {
  const assetBasis = new Matrix4().makeBasis(
    ASSET_MUZZLE_AXIS,
    ASSET_TOP_AXIS,
    ASSET_FLANK_AXIS,
  );
  const boneBasis = new Matrix4().makeBasis(
    BONE_AIM_AXIS,
    BONE_THUMB_AXIS,
    BONE_THIRD_AXIS,
  );
  return boneBasis.multiply(assetBasis.invert());
})();

/** The rotation that seats the weapon in the hand, derived basis plus trim. */
export function gripQuaternion(
  trimEulerDeg: readonly [number, number, number] = TRIM_EULER_DEG,
): Quaternion {
  const base = new Quaternion().setFromRotationMatrix(SEATING_BASIS);
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

// ---- the mount -------------------------------------------------------------

/**
 * How a weapon is placed in the hand: the fine bone-frame offset, the by-eye trim
 * on the seating rotation, and the palm-drop slide along the grip. Structurally the
 * same shape `DuelActor` exposes as `GripTuning`, so an actor can pass its tuning
 * straight through.
 */
export interface GripPlacement {
  readonly offset: readonly [number, number, number];
  readonly trimEulerDeg: readonly [number, number, number];
  readonly palmDrop: number;
}

/** The seating both fighters get unless an actor overrides part of it. */
export const DEFAULT_GRIP_PLACEMENT: GripPlacement = {
  offset: SOCKET_OFFSET_M,
  trimEulerDeg: TRIM_EULER_DEG,
  palmDrop: PALM_DROP_M,
};

/**
 * Build the socket that seats `weapon` in `bone`, and return it ready to be added to
 * the bone. THE ONE PLACE the hand mount is assembled, so PvE `DuelActor` and PvP
 * `ArenaActor` cannot drift apart.
 *
 * The transform chain, outermost first:
 *
 *   bone → socket (undoes the bone's inherited world scale, so children are metres)
 *        → hold   (the bone-frame offset, and the seating rotation that carries the
 *                   asset's muzzle onto the aim)
 *        → weapon (translated by `weaponLocalOffset` so its measured GRIP POINT — not
 *                   its arbitrary model origin — lands at the hold origin, i.e. the
 *                   hand)
 *
 * `bone.getWorldScale` reads the bone's current world matrix, so the caller must
 * have run `updateMatrixWorld` on the rig first (both actors do).
 */
export function seatWeaponInHand(params: {
  readonly bone: Object3D;
  readonly weapon: Object3D;
  readonly grip?: GripPlacement;
  readonly name?: string;
}): Group {
  const grip = params.grip ?? DEFAULT_GRIP_PLACEMENT;
  const boneScale = params.bone.getWorldScale(new Vector3()).x;

  const socket = new Group();
  if (params.name) socket.name = params.name;
  // Undo the bone's inherited scale so everything below is in metres, whatever units
  // the rig happens to be authored in this week.
  socket.scale.setScalar(socketInverseScale(boneScale));

  const hold = new Group();
  hold.name = "weapon.hold";
  hold.position.set(grip.offset[0], grip.offset[1], grip.offset[2]);
  hold.quaternion.copy(gripQuaternion(grip.trimEulerDeg));

  const [wx, wy, wz] = weaponLocalOffset(grip.palmDrop);
  params.weapon.position.set(wx, wy, wz);

  hold.add(params.weapon);
  socket.add(hold);
  return socket;
}
