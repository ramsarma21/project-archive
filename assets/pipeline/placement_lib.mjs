// The placement math the M1 verifiers measure with, in one place and pure.
//
// Why this file exists at all
// --------------------------
// `verify_roofline_kit.mjs` and `verify_m1_placements.mjs` both reproduce how the
// renderer fits a GLB into a box and where that box ends up in the world. They
// used to reproduce it TWICE, once each, and the two copies disagreed: one
// applied `yaw` to the mesh and not to the box, the other applied it to the box
// and not to the mesh. Both then reported a confident number. A measuring
// instrument with two implementations of its own scale is not one instrument.
//
// So the arithmetic lives here, once, and it is pure: no three.js, no web
// sources, no file system. That is what lets `placement_lib.test.mjs` state the
// invariants as fixtures instead of as prose in a comment.
//
// The two facts everything here turns on
// --------------------------------------
// 1. THE FIT IS IN LOCAL SPACE. `M1Scenery` draws every placement as
//
//      <group position={pos} rotation={[0, yaw, 0]}>  <FittedGlb size={size} />
//
//    so `size` is a box in the object's OWN frame and the mesh is scaled against
//    it axis for axis with no regard to yaw. Transposing the mesh for a yawed
//    placement — which one verifier did — measures a fit the renderer never
//    performs.
//
// 2. THE FOOTPRINT IS NOT. Once fitted, the box is turned by `yaw` into the
//    world, so its world footprint is an oriented rectangle, not `size[0]` by
//    `size[2]`. `compile.ts` does exactly the same thing on the collision side —
//    a mass with a yaw compiles to an `obb` footprint with the rect's own half
//    extents — so yaw turns the art and the collision together, and anything
//    comparing the two has to turn both.
//
// A module run is where the difference bites. `moduleRunPlacements` emits a tile
// as `size: [tileLength, height, tileDepth]` — its own length first — and then
// `yaw: Math.PI / 2` puts that length along the run. Read `size[0]` as a world X
// extent and every module laid along Z is measured against its own cross-section.
//
// Run the fixtures: node --test assets/pipeline/placement_lib.test.mjs

// ---------------------------------------------------------------------------
// fits — exactly what packages/engine-world/src/ImportedAssets.tsx does
// ---------------------------------------------------------------------------

/** `FittedGlb` without `fill`: one scale, the smallest ratio, so nothing crops. */
export function containFitScale(natural, size) {
  return Math.min(
    size[0] / (natural[0] || 1),
    size[1] / (natural[1] || 1),
    size[2] / (natural[2] || 1),
  );
}

/** `FittedGlb` with `fill`: per-axis, because the caller already cut the box. */
export function fillScale(natural, size) {
  return [
    size[0] / (natural[0] || 1),
    size[1] / (natural[1] || 1),
    size[2] / (natural[2] || 1),
  ];
}

/**
 * `ImportedStructure`'s quarter turn.
 *
 * A shell is authored to a proportion rather than to an orientation, so it turns
 * itself to put its long horizontal axis along the room's long horizontal axis.
 * This matters to a verifier even though it does not change the box: the turn
 * decides which mesh axis is stretched by which ratio, and for
 * `int-partition-board-a` — a 1.90 x 1.90 x 0.23 board wall drawn into a
 * 0.50 x 1.60 x 4.40 slot — the difference is between a 4.4m board partition and
 * a 4.4m-THICK slab with the same bounding box. Rays cast through the second one
 * measure a building that is not on screen.
 */
export function shellQuarterTurn(natural, size, rotateShell) {
  if (rotateShell !== undefined) return rotateShell;
  return natural[0] >= natural[2] !== size[0] >= size[2];
}

/** Per-axis scale and inner Y rotation for a shell, turn included. */
export function shellFit(natural, size, rotateShell) {
  const turn = shellQuarterTurn(natural, size, rotateShell);
  const targetX = turn ? size[2] : size[0];
  const targetZ = turn ? size[0] : size[2];
  return {
    turn,
    scale: [
      targetX / Math.max(natural[0], 0.001),
      size[1] / Math.max(natural[1], 0.001),
      targetZ / Math.max(natural[2], 0.001),
    ],
    innerYaw: turn ? -Math.PI / 2 : 0,
  };
}

// ---------------------------------------------------------------------------
// footprints
// ---------------------------------------------------------------------------

/** Yaw about +Y, right-handed, matching three.js and `collision_lib.rotateY`. */
export function rotateXZ(x, z, yaw) {
  if (yaw === 0) return [x, z];
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x * c + z * s, -x * s + z * c];
}

/** The four world corners of an oriented rectangle, counter-clockwise in XZ. */
export function orientedCorners({ cx, cz, halfX, halfZ, yaw = 0 }) {
  return [
    [-halfX, -halfZ],
    [halfX, -halfZ],
    [halfX, halfZ],
    [-halfX, halfZ],
  ].map(([x, z]) => {
    const [rx, rz] = rotateXZ(x, z, yaw);
    return [cx + rx, cz + rz];
  });
}

/**
 * The world footprint of the box a placement is drawn into.
 *
 * `pos` is the bottom CENTRE of the box and `size` is in the object's own frame,
 * so this is the local rectangle turned by `yaw` — the same rectangle
 * `M1Scenery`'s outer group puts on screen.
 */
export function placementFootprint(placement) {
  return orientedCorners({
    cx: placement.pos[0],
    cz: placement.pos[2],
    halfX: placement.size[0] / 2,
    halfZ: placement.size[2] / 2,
    yaw: placement.yaw ?? 0,
  });
}

/**
 * How finely a round footprint is polygonised.
 *
 * `compile.ts` gives a `round` mass a capsule footprint of zero length, which is
 * a circle. 256 sides understate its area by 0.005%, which is four orders of
 * magnitude below the 0.5% any threshold here cares about, and it keeps every
 * footprint in this file one kind of thing.
 */
const ROUND_SIDES = 256;

/**
 * The world footprint of a collision part, as `compile.ts` compiles it.
 *
 * Three cases and all three are the level's, not this file's invention:
 *   round   -> a capsule of zero length at the rect centre: a circle.
 *   yaw     -> an `obb` with the RECT's own half extents, turned about its
 *              centre. The rect of a yawed mass is therefore a local footprint
 *              at a world position, which is exactly how `drawBox` reads it too.
 *   neither -> the rect.
 */
export function partFootprint(part) {
  const cx = (part.rect.minX + part.rect.maxX) / 2;
  const cz = (part.rect.minZ + part.rect.maxZ) / 2;
  if (part.round) {
    const r = part.round.radius;
    return Array.from({ length: ROUND_SIDES }, (_unused, i) => {
      const a = (i / ROUND_SIDES) * Math.PI * 2;
      return [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
    });
  }
  return orientedCorners({
    cx,
    cz,
    halfX: (part.rect.maxX - part.rect.minX) / 2,
    halfZ: (part.rect.maxZ - part.rect.minZ) / 2,
    yaw: part.yaw ?? 0,
  });
}

// ---------------------------------------------------------------------------
// convex polygon overlap
// ---------------------------------------------------------------------------

/** Signed area; positive for counter-clockwise in a right-handed XZ read. */
export function signedArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, z0] = points[i];
    const [x1, z1] = points[(i + 1) % points.length];
    sum += x0 * z1 - x1 * z0;
  }
  return sum / 2;
}

export const polygonArea = (points) => Math.abs(signedArea(points));

/**
 * Sutherland–Hodgman: clip a convex subject by a convex window.
 *
 * Exact, unlike the sampled grids elsewhere in these tools, which is what lets a
 * box that fits its part exactly read 100.0% rather than 99.6% and lets the
 * 99.5% gate mean what it says.
 */
export function clipConvex(subject, window) {
  const wind = Math.sign(signedArea(window)) || 1;
  let output = subject;
  for (let i = 0; i < window.length && output.length; i++) {
    const [ax, az] = window[i];
    const [bx, bz] = window[(i + 1) % window.length];
    // Inside is to the left of a->b for a counter-clockwise window.
    const side = ([px, pz]) => wind * ((bx - ax) * (pz - az) - (bz - az) * (px - ax));
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const current = input[j];
      const previous = input[(j + input.length - 1) % input.length];
      const sc = side(current);
      const sp = side(previous);
      if (sc >= 0) {
        if (sp < 0) output.push(lerpTo(previous, current, sp, sc));
        output.push(current);
      } else if (sp >= 0) {
        output.push(lerpTo(previous, current, sp, sc));
      }
    }
  }
  return output;
}

function lerpTo(from, to, sFrom, sTo) {
  const t = sFrom / (sFrom - sTo);
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
}

export function intersectionArea(a, b) {
  return polygonArea(clipConvex(a, b));
}

/**
 * How much of `part` the boxes drawn for it cover, as a fraction of the part.
 *
 * Summed and then clamped, which is right for the shape of the input rather than
 * merely convenient: a module run divides its blocker into tiles that meet
 * without overlapping, and every collision id belongs to exactly one cluster and
 * so to exactly one run. Two overlapping boxes over one part would double-count,
 * and the clamp is what stops that reading as more than complete coverage.
 */
export function coveredFraction(partCorners, boxes) {
  const area = polygonArea(partCorners);
  if (area <= 0) return 1;
  let covered = 0;
  for (const box of boxes) covered += intersectionArea(partCorners, box);
  return Math.min(1, covered / area);
}

/** Monotone chain hull, so a tiled run can be asked about as one envelope. */
export function convexHull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) {
        out.pop();
      }
      out.push(p);
    }
    return out;
  };
  const lower = half(sorted);
  const upper = half([...sorted].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * How far the part reaches past the envelope of the boxes drawn for it.
 *
 * Per-face overrun against the convex hull of every box, which is the same
 * number the old axis-aligned `maxX - box.maxX` produced for a single square box
 * and a far more honest one for a run: taken per TILE, a wall's second module
 * reported the whole first half of the wall as an overrun, so the ropewalk tie
 * beam was reported as reaching 14.55m past a box it is 40% outside of. Nothing
 * gates on this — the covered fraction does — but it is the number in the
 * failure message, and an agent moving geometry reads the message.
 */
export function reachBeyond(partCorners, boxes) {
  if (!boxes.length) return Infinity;
  const hull = convexHull(boxes.flat());
  if (hull.length < 3) return Infinity;
  const wind = Math.sign(signedArea(hull)) || 1;
  let worst = 0;
  for (const [px, pz] of partCorners) {
    let out = -Infinity;
    for (let i = 0; i < hull.length; i++) {
      const [ax, az] = hull[i];
      const [bx, bz] = hull[(i + 1) % hull.length];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const inside = (wind * ((bx - ax) * (pz - az) - (bz - az) * (px - ax))) / len;
      out = Math.max(out, -inside);
    }
    worst = Math.max(worst, out);
  }
  return Math.max(0, worst);
}

// ---------------------------------------------------------------------------
// policy — the two rules the placement verifier's own author had to fix
// ---------------------------------------------------------------------------

/**
 * The height a part's support is probed at.
 *
 * Where the route stands ON a mass, the surface that matters is its TOP. Probing
 * its base asks whether a hay wain rests on the ground, which is not in doubt,
 * and it passed a raised deck whose collision was three metres above anything
 * drawn. Where a mass is merely raised and carries nobody, its base is the
 * question. A deck is a surface and has only the one height.
 */
export function supportPlane(part, onRoute) {
  if (part.kind === "DECK") return part.baseY;
  return onRoute ? part.topY : part.baseY;
}

/**
 * May this draw count as the support under `partId` at `plane`?
 *
 * No, when the draw IS that part and its own base stands at the plane being
 * asked about. A chimney is not what holds a chimney up, and letting it count
 * passed both of the floating ones. A sibling in the same cluster still counts —
 * the steeple's gallery really does carry its own lantern — so this is about one
 * object's own base, not about the cluster.
 */
export function supportsFrom(placement, partId, plane, epsilon = 0.01) {
  return !(placement.parts.includes(partId) && Math.abs(placement.pos[1] - plane) < epsilon);
}
