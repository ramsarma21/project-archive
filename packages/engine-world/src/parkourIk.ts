// Two-bone analytic IK for the four authored traversal verbs, so a hand lands on
// the hold it grips and a foot rests on the surface it stands on instead of
// hanging in air or driving through the wall.
//
// WHY THIS IS PRESENTATION-ONLY, AND THE PROOF OBLIGATION IT CARRIES.
// The solver owns the body's position: `playerMotion` assigns the capsule root
// from a smoothstep anchor path, and both the replay digest and the PvP hash are
// taken over that motion state (see netcode/hash.ts). This module NEVER touches
// the root and NEVER runs inside the simulation — it is called only by the
// renderer (RiggedCharacter) and by the fidelity harness, after the clip has
// posed the skeleton, to rotate ARM and LEG bones so their end-effectors reach a
// world target. It reads no motion state that is not already on screen and
// writes only bone quaternions on a cloned display rig. Nothing it produces is
// hashed, so its arithmetic is free to use `Math.acos`/`hypot` — the cheaper,
// unpinned path the determinism law permits for presentation. The test
// `parkourIk.test.ts` pins this: the module imports THREE and nothing from the
// sim, and a motion digest is bit-identical whether or not IK ran.
//
// THE CONTRACT WITH THE SOLVER. IK adjusts limbs, never the root or the hips.
// The upper arm / upper leg roots are left where the clip and the motion path
// put them; only the shoulder→hand and hip→foot two-bone chains rotate. If a
// target is beyond a limb's reach from its fixed root, the limb straightens
// toward it and stops — an honest miss the harness reports as a residual gap,
// never a root shove to close it.

import * as THREE from "three";
// Type-only: erased at build, so it creates NO runtime dependency and cannot be
// a path by which IK output reaches the sim or a hash. The presentation-only
// proof in parkourIk.test.ts checks exactly that — the sole RUNTIME import is three.
import type { Vec3Like } from "./actorRegistry.js";

const EPS = 1e-6;

/** Two-bone chains, tip-last. Legs carry the toe as a rigid fourth link. */
export const IK_ARM_CHAINS = {
  left: ["LeftArm", "LeftForeArm", "LeftHand"],
  right: ["RightArm", "RightForeArm", "RightHand"],
} as const;

export const IK_LEG_CHAINS = {
  left: ["LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase"],
  right: ["RightUpLeg", "RightLeg", "RightFoot", "RightToeBase"],
} as const;

/** Axis-aligned box in the same frame as the posed bones (root path removed). */
export interface IkBox {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

/** Find a rig bone by logical name, tolerating the mixamorig prefixes. */
export function findBone(root: THREE.Object3D, name: string): THREE.Bone | null {
  let found: THREE.Bone | null = null;
  root.traverse((o) => {
    if (found) return;
    if (
      o.name === name ||
      o.name === `mixamorig${name}` ||
      o.name === `mixamorig:${name}`
    ) {
      found = o as THREE.Bone;
    }
  });
  return found;
}

/** Nearest point on an AABB's surface to p. If p is inside, the nearest face. */
export function nearestSurfacePoint(p: Vec3Like, b: IkBox): Vec3Like {
  const inside =
    p.x >= b.min[0] && p.x <= b.max[0] &&
    p.y >= b.min[1] && p.y <= b.max[1] &&
    p.z >= b.min[2] && p.z <= b.max[2];
  if (!inside) {
    return {
      x: Math.min(Math.max(p.x, b.min[0]), b.max[0]),
      y: Math.min(Math.max(p.y, b.min[1]), b.max[1]),
      z: Math.min(Math.max(p.z, b.min[2]), b.max[2]),
    };
  }
  // Inside: push out along the axis with the smallest exit distance.
  const dxLo = p.x - b.min[0], dxHi = b.max[0] - p.x;
  const dyLo = p.y - b.min[1], dyHi = b.max[1] - p.y;
  const dzLo = p.z - b.min[2], dzHi = b.max[2] - p.z;
  const m = Math.min(dxLo, dxHi, dyLo, dyHi, dzLo, dzHi);
  const out = { x: p.x, y: p.y, z: p.z };
  if (m === dxLo) out.x = b.min[0];
  else if (m === dxHi) out.x = b.max[0];
  else if (m === dyLo) out.y = b.min[1];
  else if (m === dyHi) out.y = b.max[1];
  else if (m === dzLo) out.z = b.min[2];
  else out.z = b.max[2];
  return out;
}

function penetration(p: Vec3Like, b: IkBox): number {
  if (
    p.x < b.min[0] || p.x > b.max[0] ||
    p.y < b.min[1] || p.y > b.max[1] ||
    p.z < b.min[2] || p.z > b.max[2]
  ) {
    return 0;
  }
  return Math.min(
    p.x - b.min[0], b.max[0] - p.x,
    p.y - b.min[1], b.max[1] - p.y,
    p.z - b.min[2], b.max[2] - p.z,
  );
}

function distToBox(p: Vec3Like, b: IkBox): number {
  const dx = Math.max(b.min[0] - p.x, 0, p.x - b.max[0]);
  const dy = Math.max(b.min[1] - p.y, 0, p.y - b.max[1]);
  const dz = Math.max(b.min[2] - p.z, 0, p.z - b.max[2]);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export interface IkTargetOptions {
  /** Solids the limb must not enter; a penetrating limb is projected to a face. */
  boxes: readonly IkBox[];
  /** If true, a hand near a solid snaps onto it (this verb grips with hands). */
  gripHands: boolean;
  /** How near a hand must be to a hold before it snaps to it, in metres. */
  gripReachM: number;
  /** Skin left between a limb and a solid it is pushed off, in metres. */
  skinM: number;
  /** Body centre (hips) in the posed-bone frame. A penetrating limb exits toward
   * it — the side the body is on — rather than to the nearest face, which on a
   * thin wall can be the far side and unreachable. */
  bodyCenter?: Vec3Like;
  /** Optional per-foot world pin (plant anchor) in the posed-bone frame. */
  footPins?: readonly (Vec3Like | null)[];
}

/**
 * Push a penetrating point out through the box face on the BODY's side, moving
 * only the axis that separates the limb from the body and leaving the limb's
 * other two coordinates — its height and lateral offset — where the clip put
 * them. This is why a braced foot exits straight out the wall face it stands
 * against instead of being dragged up toward the hip: a ray aimed at the body
 * centre collapses the target onto the hip, which is inside the leg's own
 * minimum fold and cannot be reached. `skinM` leaves the limb just proud of the
 * face so it reads as touching, not sunk in.
 */
export function exitFaceToward(
  p: Vec3Like,
  b: IkBox,
  toward: Vec3Like,
  skinM: number,
): Vec3Like {
  const cx = (b.min[0] + b.max[0]) / 2;
  const cy = (b.min[1] + b.max[1]) / 2;
  const cz = (b.min[2] + b.max[2]) / 2;
  const dx = toward.x - cx, dy = toward.y - cy, dz = toward.z - cz;
  const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
  const out = { x: p.x, y: p.y, z: p.z };
  if (ax >= ay && ax >= az) out.x = dx >= 0 ? b.max[0] + skinM : b.min[0] - skinM;
  else if (ay >= ax && ay >= az) out.y = dy >= 0 ? b.max[1] + skinM : b.min[1] - skinM;
  else out.z = dz >= 0 ? b.max[2] + skinM : b.min[2] - skinM;
  return out;
}

/**
 * Exit a point from a solid SIDEWAYS — out the body-side VERTICAL face (x or z),
 * never up or down the face. This is the wall normal for a foot braced against a
 * wall, and it is the fix for the hang-drop: a foot penetrating geometry is
 * standing against a WALL, and a wall is escaped along its horizontal normal.
 * `exitFaceToward` chose the axis of largest |body − box centre|, which for a
 * wall-facing hang-drop (hips above the box's y-midpoint) is the VERTICAL axis —
 * so it pushed the foot UP the face and left the toe buried (measured 26.5 →
 * 27.7 cm, worse). Restricting the exit to the two horizontal axes and taking the
 * body-side face along the axis on which the body is most clearly to one side is
 * the wall normal, and it seats the foot on the face (measured below CLIP_THROUGH).
 * A degenerate case where the body sits over the box centre on both horizontal
 * axes falls back to the nearer face so the exit is still finite.
 */
export function exitWallToward(
  p: Vec3Like,
  b: IkBox,
  toward: Vec3Like,
  skinM: number,
): Vec3Like {
  const cx = (b.min[0] + b.max[0]) / 2;
  const cz = (b.min[2] + b.max[2]) / 2;
  const dx = toward.x - cx, dz = toward.z - cz;
  const out = { x: p.x, y: p.y, z: p.z };
  // Pick the horizontal axis on which the body is most clearly off-centre — the
  // one the wall's face lies across. Ties/degenerate (body over the centre) break
  // toward whichever face of that axis is nearer the point, so a foot never exits
  // through the far side of a wall it is only just inside.
  const pickZ = Math.abs(dz) >= Math.abs(dx);
  if (pickZ) {
    const towardMax = dz !== 0 ? dz > 0 : b.max[2] - p.z <= p.z - b.min[2];
    out.z = towardMax ? b.max[2] + skinM : b.min[2] - skinM;
  } else {
    const towardMax = dx !== 0 ? dx > 0 : b.max[0] - p.x <= p.x - b.min[0];
    out.x = towardMax ? b.max[0] + skinM : b.min[0] - skinM;
  }
  return out;
}

/**
 * Where a hand should be pulled to. Returns null when the clip already has it
 * clear of every solid and (for a grip) out of reach of any hold — leave it be.
 */
export function handTarget(
  hand: Vec3Like,
  opts: IkTargetOptions,
): Vec3Like | null {
  // Deepest penetration first: a hand inside a wall is projected to the face.
  let worstPen = 0;
  let worstBox: IkBox | null = null;
  for (const b of opts.boxes) {
    const pen = penetration(hand, b);
    if (pen > worstPen) {
      worstPen = pen;
      worstBox = b;
    }
  }
  if (worstBox) {
    // A hand exits by the shortest normal — a grip that has sunk into a lip pulls
    // straight back out of the face it clipped, not toward the hips (which for a
    // hand reaching UP would drag it down to the wall's foot).
    return outset(hand, nearestSurfacePoint(hand, worstBox), opts.skinM);
  }
  if (!opts.gripHands) return null;
  // Not penetrating: snap to the nearest hold within reach.
  let best = Infinity;
  let bestBox: IkBox | null = null;
  for (const b of opts.boxes) {
    const d = distToBox(hand, b);
    if (d < best) {
      best = d;
      bestBox = b;
    }
  }
  if (bestBox && best > EPS && best <= opts.gripReachM) {
    return nearestSurfacePoint(hand, bestBox);
  }
  return null;
}

/**
 * Where a foot should be pulled to: a pin (plant anchor) wins; otherwise a foot
 * inside a solid is projected out to its face. A clear, unpinned foot is null.
 */
export function footTarget(
  foot: Vec3Like,
  footPin: Vec3Like | null | undefined,
  opts: IkTargetOptions,
): Vec3Like | null {
  // A plant anchor wins — but an authored pin (or the clip's own foot) can sit
  // INSIDE the wall face it is braced against: the hang-drop anchor seats the
  // capsule CENTRE on the face, so the foot is ~a body-radius deep. Projecting the
  // penetrating point out of the wall BEFORE it becomes the IK target seats the
  // foot on the face. A foot escapes a wall SIDEWAYS (`exitWallToward`, the
  // horizontal wall normal), never up/down the face — see that function for why
  // the earlier vertical-axis exit left the toe buried. A pin/foot already clear
  // of every solid is used as-is; a clear unpinned foot is left to the clip.
  const anchor = footPin ?? foot;
  let worstPen = 0;
  let worstBox: IkBox | null = null;
  for (const b of opts.boxes) {
    const pen = penetration(anchor, b);
    if (pen > worstPen) {
      worstPen = pen;
      worstBox = b;
    }
  }
  if (worstBox) {
    return opts.bodyCenter
      ? exitWallToward(anchor, worstBox, opts.bodyCenter, opts.skinM)
      : outset(anchor, nearestSurfacePoint(anchor, worstBox), opts.skinM);
  }
  return footPin ?? null;
}

/** Push a boundary `surface` point a hair OUTWARD, away from the interior point
 * `from` that was projected to it, so the limb reads as on the face, not sunk a
 * skin's depth into it. Falls back to the surface point when the two coincide. */
function outset(from: Vec3Like, surface: Vec3Like, skinM: number): Vec3Like {
  const dx = surface.x - from.x;
  const dy = surface.y - from.y;
  const dz = surface.z - from.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < EPS) return { x: surface.x, y: surface.y, z: surface.z };
  const k = skinM / len;
  return {
    x: surface.x + dx * k,
    y: surface.y + dy * k,
    z: surface.z + dz * k,
  };
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _at = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _wq = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _rot = new THREE.Quaternion();

function angleBetween(u: THREE.Vector3, v: THREE.Vector3): number {
  const lu = u.length();
  const lv = v.length();
  if (lu < EPS || lv < EPS) return 0;
  let c = u.dot(v) / (lu * lv);
  if (c > 1) c = 1;
  else if (c < -1) c = -1;
  return Math.acos(c);
}

/** Apply a world-space rotation `q` to a bone's current world orientation. */
function rotateBoneWorld(bone: THREE.Bone, q: THREE.Quaternion): void {
  bone.getWorldQuaternion(_wq);
  const parent = bone.parent;
  if (parent) parent.getWorldQuaternion(_pq);
  else _pq.identity();
  // newLocal = parentWorld^-1 * (q * currentWorld)
  const newWorld = q.clone().multiply(_wq);
  bone.quaternion.copy(_pq.invert().multiply(newWorld));
  bone.updateMatrixWorld(true);
}

/**
 * Rotate the two-bone chain a→b→(end) so `end` reaches `target`, keeping the
 * bend in the plane the clip already put it in (or `poleHint` if the clip is
 * straight). Bone `end` is the tip whose world position is driven; for a leg it
 * is the toe carried rigidly past the ankle. Root `a` is never translated.
 */
export function solveTwoBoneIk(
  a: THREE.Bone,
  b: THREE.Bone,
  end: THREE.Object3D,
  target: Vec3Like,
  poleHint?: Vec3Like,
): boolean {
  a.getWorldPosition(_a);
  b.getWorldPosition(_b);
  end.getWorldPosition(_c);
  _t.set(target.x, target.y, target.z);

  const lab = _a.distanceTo(_b);
  const lbc = _b.distanceTo(_c);
  if (lab < EPS || lbc < EPS) return false;
  const maxReach = lab + lbc - EPS;
  const minReach = Math.abs(lab - lbc) + EPS;
  let lat = _a.distanceTo(_t);
  // A target closer to the limb root than the chain can FOLD is not reachable —
  // forcing it swings the whole limb to the annulus boundary and flings the tip
  // somewhere absurd (a braced foot thrown shoulder-high). Refuse it and leave
  // the clip pose: an honest miss the harness reports, not a contortion. Too-far
  // is fine — the limb simply straightens toward the target.
  if (lat < minReach) return false;
  if (lat > maxReach) lat = maxReach;

  // Desired interior angle at the mid for the (clamped) reach lat.
  const cosB = (lab * lab + lbc * lbc - lat * lat) / (2 * lab * lbc);
  const angB1 = Math.acos(Math.min(1, Math.max(-1, cosB)));

  // The elbow-rotation sign that increases the interior angle is not knowable a
  // priori from the cross-product orientation, and a straight or near-straight
  // clip pose has no bend plane at all. Rather than reason the sign out, iterate
  // a couple of bend+swing passes: each sets the reach toward lat and aims the
  // tip, and any first-pass sign error is corrected on the next. Three passes
  // drives a reachable target to well under a centimetre.
  const swingAxis = new THREE.Vector3();
  for (let pass = 0; pass < 4; pass++) {
    a.getWorldPosition(_a);
    b.getWorldPosition(_b);
    end.getWorldPosition(_c);
    _ac.copy(_c).sub(_a);
    _ab.copy(_b).sub(_a);
    _at.copy(_t).sub(_a);

    // Bend axis: the current a-b-c plane; fall back to the pole when straight.
    _axis.copy(_ac).cross(_ab);
    if (_axis.lengthSq() < EPS) {
      if (poleHint) _pole.set(poleHint.x, poleHint.y, poleHint.z).sub(_a);
      else _pole.set(0, 0, 1);
      _axis.copy(_at).cross(_pole);
      if (_axis.lengthSq() < EPS) _axis.set(1, 0, 0);
    }
    _axis.normalize();

    // 1) Bend the mid toward the target interior angle. Try one sign; if it took
    // the reach further from lat, undo and take the other.
    const angB0 = angleBetween(_a.clone().sub(_b), _c.clone().sub(_b));
    const before = _a.distanceTo(_c);
    _rot.setFromAxisAngle(_axis, angB1 - angB0);
    rotateBoneWorld(b, _rot);
    end.getWorldPosition(_c);
    if (Math.abs(_a.distanceTo(_c) - lat) > Math.abs(before - lat) + EPS) {
      _rot.setFromAxisAngle(_axis, -2 * (angB1 - angB0));
      rotateBoneWorld(b, _rot);
      end.getWorldPosition(_c);
    }

    // 2) Swing the root so the tip lands on the a->target ray.
    _ac.copy(_c).sub(_a);
    _at.copy(_t).sub(_a);
    swingAxis.copy(_ac).cross(_at);
    if (swingAxis.lengthSq() > EPS) {
      swingAxis.normalize();
      _rot.setFromAxisAngle(swingAxis, angleBetween(_ac, _at));
      rotateBoneWorld(a, _rot);
    }
  }
  return true;
}

/** Resolved arm/leg chains for a rig, tip-last, plus the hips reference. */
export interface ParkourLimbs {
  arms: [THREE.Bone[], THREE.Bone[]]; // [Arm, ForeArm, Hand]
  legs: [THREE.Bone[], THREE.Bone[]]; // [UpLeg, Leg, Foot, ToeBase]
  hips: THREE.Bone | null;
}

/** Find every bone the parkour IK drives once, so the render loop needn't walk
 * the skeleton each frame. Returns null if the rig is not the two-arm/two-leg
 * humanoid the IK assumes (any other cast member is simply left un-adjusted). */
export function resolveParkourLimbs(root: THREE.Object3D): ParkourLimbs | null {
  const chain = (names: readonly string[]) =>
    names.map((n) => findBone(root, n)).filter((b): b is THREE.Bone => b !== null);
  const la = chain(IK_ARM_CHAINS.left);
  const ra = chain(IK_ARM_CHAINS.right);
  const ll = chain(IK_LEG_CHAINS.left);
  const rl = chain(IK_LEG_CHAINS.right);
  if (la.length < 3 || ra.length < 3 || ll.length < 4 || rl.length < 4) return null;
  return { arms: [la, ra], legs: [ll, rl], hips: findBone(root, "Hips") };
}

const _limbTmp = new THREE.Vector3();

/**
 * Apply the parkour IK to a posed rig, in whatever frame the bones report their
 * world positions in (the harness poses at the origin; the renderer poses in the
 * placed group — the solve is frame-agnostic). `opts.boxes` and `opts.footPins`
 * are expressed in that same frame. Hands and feet are solved with the
 * do-no-harm guard, so an unreachable placement is left as the clip pose.
 */
export function applyParkourIkToRig(
  limbs: ParkourLimbs,
  opts: IkTargetOptions,
): void {
  let bodyCenter = opts.bodyCenter;
  if (!bodyCenter && limbs.hips) {
    limbs.hips.getWorldPosition(_limbTmp);
    bodyCenter = { x: _limbTmp.x, y: _limbTmp.y, z: _limbTmp.z };
  }
  const withBody: IkTargetOptions = { ...opts, bodyCenter };
  limbs.arms.forEach((arm) => {
    const shoulder = arm[0], elbow = arm[1], hand = arm[2];
    if (!shoulder || !elbow || !hand) return;
    hand.getWorldPosition(_limbTmp);
    const target = handTarget({ x: _limbTmp.x, y: _limbTmp.y, z: _limbTmp.z }, withBody);
    if (target) solveTwoBoneIkGuarded(shoulder, elbow, hand, target);
  });
  limbs.legs.forEach((leg, k) => {
    const hip = leg[0], knee = leg[1], toe = leg[3];
    if (!hip || !knee || !toe) return;
    toe.getWorldPosition(_limbTmp);
    const pin = opts.footPins?.[k] ?? null;
    const target = footTarget({ x: _limbTmp.x, y: _limbTmp.y, z: _limbTmp.z }, pin, withBody);
    if (target) solveTwoBoneIkGuarded(hip, knee, toe, target);
  });
}

const _check = new THREE.Vector3();

const _before = new THREE.Vector3();

/**
 * Two-bone solve that DOES NO HARM. A real fix nudges a limb a hand-span or two
 * to plant it on the surface it belongs on; a degenerate configuration (the
 * analytic solve can swing the whole limb to the reach boundary) throws the tip
 * a metre or more. This saves the chain, solves, and keeps the result only if
 * the tip moved no further than `maxCorrectionM`; otherwise it restores the clip
 * pose. That is how a foot the anchor path has buried in a wall — a placement
 * consequence the leg cannot resolve from a fixed hip — is left honest rather
 * than contorted. Returns whether the adjustment was kept.
 */
export function solveTwoBoneIkGuarded(
  a: THREE.Bone,
  b: THREE.Bone,
  end: THREE.Object3D,
  target: Vec3Like,
  maxCorrectionM = 0.4,
  poleHint?: Vec3Like,
): boolean {
  end.getWorldPosition(_before);
  const qa = a.quaternion.clone();
  const qb = b.quaternion.clone();
  const acted = solveTwoBoneIk(a, b, end, target, poleHint);
  if (!acted) return false;
  end.getWorldPosition(_check);
  if (_check.distanceTo(_before) <= maxCorrectionM) return true;
  a.quaternion.copy(qa);
  b.quaternion.copy(qb);
  a.updateMatrixWorld(true);
  return false;
}
