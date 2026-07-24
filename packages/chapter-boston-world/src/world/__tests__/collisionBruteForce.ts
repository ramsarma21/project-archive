// TEST-ONLY brute-force collision oracle.
//
// collisionBroadPhase.test.ts checks the indexed broad-phase queries in
// ../collision.ts against these unindexed implementations, which iterate every
// blocker/platform. The narrow-phase geometry here is a verbatim copy of the
// production narrow phase (kept private in collision.ts); if the production
// geometry changes, the parity suite fails and this oracle must be updated to
// match. Never import this module from production code.

import {
  CAPSULE_RADIUS,
  SUPPORT_SNAP_UP,
  type Blocker,
  type CollisionWorld,
  type Support,
  type SweepResult,
  type Vec3,
} from "../collision.js";

const HEIGHT_EPS = 1e-4;

function pointInRect(
  x: number,
  z: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  margin = 0,
): boolean {
  return x >= minX - margin && x <= maxX + margin && z >= minZ - margin && z <= maxZ + margin;
}

function pointInPolygon(
  x: number,
  z: number,
  polygon: ReadonlyArray<readonly [number, number]>,
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]!;
    const [xj, zj] = polygon[j]!;
    if (
      zi > z !== zj > z &&
      x < ((xj - xi) * (z - zi)) / (zj - zi || Number.EPSILON) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function spanOverlaps(footY: number, headY: number, baseY: number, topY: number): boolean {
  return headY > baseY + HEIGHT_EPS && footY < topY - HEIGHT_EPS;
}

function segmentSpanInterval(
  start: number,
  end: number,
  min: number,
  max: number,
): readonly [number, number] | null {
  const delta = end - start;
  if (delta === 0) {
    return start >= min && start <= max ? [0, 1] : null;
  }
  const first = (min - start) / delta;
  const second = (max - start) / delta;
  const enter = Math.max(0, Math.min(first, second));
  const exit = Math.min(1, Math.max(first, second));
  return enter <= exit ? [enter, exit] : null;
}

function segmentIntersectsRect(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): boolean {
  const xInterval = segmentSpanInterval(ax, bx, minX, maxX);
  if (!xInterval) return false;
  const zInterval = segmentSpanInterval(az, bz, minZ, maxZ);
  if (!zInterval) return false;
  return Math.max(xInterval[0], zInterval[0]) <= Math.min(xInterval[1], zInterval[1]);
}

function pointSegmentDistanceSq(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSq));
  const nearestX = ax + dx * t;
  const nearestZ = az + dz * t;
  const offsetX = px - nearestX;
  const offsetZ = pz - nearestZ;
  return offsetX * offsetX + offsetZ * offsetZ;
}

function cross2d(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
): number {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
}

function pointOnSegment2d(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): boolean {
  return (
    cross2d(ax, az, bx, bz, px, pz) === 0 &&
    px >= Math.min(ax, bx) &&
    px <= Math.max(ax, bx) &&
    pz >= Math.min(az, bz) &&
    pz <= Math.max(az, bz)
  );
}

function segmentsIntersect2d(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): boolean {
  const abC = cross2d(ax, az, bx, bz, cx, cz);
  const abD = cross2d(ax, az, bx, bz, dx, dz);
  const cdA = cross2d(cx, cz, dx, dz, ax, az);
  const cdB = cross2d(cx, cz, dx, dz, bx, bz);
  if (
    ((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
    ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))
  ) {
    return true;
  }
  return (
    (abC === 0 && pointOnSegment2d(cx, cz, ax, az, bx, bz)) ||
    (abD === 0 && pointOnSegment2d(dx, dz, ax, az, bx, bz)) ||
    (cdA === 0 && pointOnSegment2d(ax, az, cx, cz, dx, dz)) ||
    (cdB === 0 && pointOnSegment2d(bx, bz, cx, cz, dx, dz))
  );
}

function segmentIntersectsCapsule(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
  radius: number,
): boolean {
  if (segmentsIntersect2d(ax, az, bx, bz, cx, cz, dx, dz)) return true;
  const distanceSq = Math.min(
    pointSegmentDistanceSq(ax, az, cx, cz, dx, dz),
    pointSegmentDistanceSq(bx, bz, cx, cz, dx, dz),
    pointSegmentDistanceSq(cx, cz, ax, az, bx, bz),
    pointSegmentDistanceSq(dx, dz, ax, az, bx, bz),
  );
  return distanceSq <= radius * radius;
}

function segmentIntersectsFootprint(
  blocker: Blocker,
  a: Vec3,
  b: Vec3,
  fromT: number,
  toT: number,
): boolean {
  const startX = a.x + (b.x - a.x) * fromT;
  const startZ = a.z + (b.z - a.z) * fromT;
  const endX = a.x + (b.x - a.x) * toT;
  const endZ = a.z + (b.z - a.z) * toT;
  const footprint = blocker.footprint;
  if (!footprint) {
    return segmentIntersectsRect(
      startX,
      startZ,
      endX,
      endZ,
      blocker.minX,
      blocker.maxX,
      blocker.minZ,
      blocker.maxZ,
    );
  }
  if (footprint.kind === "obb") {
    const c = Math.cos(footprint.yaw);
    const s = Math.sin(footprint.yaw);
    const toLocal = (x: number, z: number) => {
      const dx = x - footprint.cx;
      const dz = z - footprint.cz;
      return { x: dx * c - dz * s, z: dx * s + dz * c };
    };
    const localStart = toLocal(startX, startZ);
    const localEnd = toLocal(endX, endZ);
    return segmentIntersectsRect(
      localStart.x,
      localStart.z,
      localEnd.x,
      localEnd.z,
      -footprint.halfX,
      footprint.halfX,
      -footprint.halfZ,
      footprint.halfZ,
    );
  }
  return segmentIntersectsCapsule(
    startX,
    startZ,
    endX,
    endZ,
    footprint.ax,
    footprint.az,
    footprint.bx,
    footprint.bz,
    footprint.radius,
  );
}

function intrudesXZ(b: Blocker, x: number, z: number, radius: number): boolean {
  if (!b.footprint) {
    return pointInRect(x, z, b.minX, b.maxX, b.minZ, b.maxZ, radius);
  }
  if (b.footprint.kind === "obb") {
    const dx = x - b.footprint.cx;
    const dz = z - b.footprint.cz;
    const c = Math.cos(b.footprint.yaw);
    const s = Math.sin(b.footprint.yaw);
    // Inverse of Three's Y rotation used by the placement adapter:
    // worldX = localX*c + localZ*s; worldZ = -localX*s + localZ*c.
    const localX = dx * c - dz * s;
    const localZ = dx * s + dz * c;
    return (
      Math.abs(localX) <= b.footprint.halfX + radius &&
      Math.abs(localZ) <= b.footprint.halfZ + radius
    );
  }
  const shape = b.footprint;
  const abX = shape.bx - shape.ax;
  const abZ = shape.bz - shape.az;
  const lenSq = abX * abX + abZ * abZ;
  const t =
    lenSq > 1e-12
      ? Math.max(
          0,
          Math.min(
            1,
            ((x - shape.ax) * abX + (z - shape.az) * abZ) / lenSq,
          ),
        )
      : 0;
  const nearestX = shape.ax + abX * t;
  const nearestZ = shape.az + abZ * t;
  return Math.hypot(x - nearestX, z - nearestZ) <= shape.radius + radius;
}

const SWEEP_SAMPLE_DISTANCE = CAPSULE_RADIUS * 0.25;
const SWEEP_BINARY_STEPS = 18;
const SWEEP_MAX_CONTACTS = 4;
const SWEEP_SKIN = 1e-5;

function blockerContactNormal(
  blocker: Blocker,
  x: number,
  z: number,
  radius: number,
): readonly [number, number] {
  const footprint = blocker.footprint;
  if (footprint?.kind === "capsule") {
    const abX = footprint.bx - footprint.ax;
    const abZ = footprint.bz - footprint.az;
    const lengthSq = abX * abX + abZ * abZ;
    const t =
      lengthSq > 1e-12
        ? Math.max(
            0,
            Math.min(
              1,
              ((x - footprint.ax) * abX + (z - footprint.az) * abZ) /
                lengthSq,
            ),
          )
        : 0;
    const nearestX = footprint.ax + abX * t;
    const nearestZ = footprint.az + abZ * t;
    const dx = x - nearestX;
    const dz = z - nearestZ;
    const length = Math.hypot(dx, dz);
    if (length > 1e-9) return [dx / length, dz / length];
    const segmentLength = Math.hypot(abX, abZ);
    return segmentLength > 1e-9
      ? [-abZ / segmentLength, abX / segmentLength]
      : [1, 0];
  }

  let localX = x;
  let localZ = z;
  let halfX = (blocker.maxX - blocker.minX) / 2;
  let halfZ = (blocker.maxZ - blocker.minZ) / 2;
  let centerX = (blocker.minX + blocker.maxX) / 2;
  let centerZ = (blocker.minZ + blocker.maxZ) / 2;
  let yaw = 0;
  if (footprint?.kind === "obb") {
    centerX = footprint.cx;
    centerZ = footprint.cz;
    halfX = footprint.halfX;
    halfZ = footprint.halfZ;
    yaw = footprint.yaw;
    const dx = x - centerX;
    const dz = z - centerZ;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    localX = dx * c - dz * s;
    localZ = dx * s + dz * c;
    centerX = 0;
    centerZ = 0;
  }
  const dx = localX - centerX;
  const dz = localZ - centerZ;
  const expandedX = halfX + radius;
  const expandedZ = halfZ + radius;
  const distanceX = expandedX - Math.abs(dx);
  const distanceZ = expandedZ - Math.abs(dz);
  let nx = 0;
  let nz = 0;
  if (distanceX <= distanceZ) nx = dx < 0 ? -1 : 1;
  else nz = dz < 0 ? -1 : 1;
  if (footprint?.kind === "obb") {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return [nx * c + nz * s, -nx * s + nz * c];
  }
  return [nx, nz];
}

function firstIntrusionTime(
  blocker: Blocker,
  x: number,
  z: number,
  dx: number,
  dz: number,
  radius: number,
): number | null {
  const distance = Math.hypot(dx, dz);
  if (distance <= 1e-12) return null;
  if (intrudesXZ(blocker, x, z, radius)) {
    const [nx, nz] = blockerContactNormal(blocker, x, z, radius);
    return dx * nx + dz * nz < -1e-10 ? 0 : null;
  }
  const samples = Math.max(1, Math.ceil(distance / SWEEP_SAMPLE_DISTANCE));
  let clearT = 0;
  for (let sample = 1; sample <= samples; sample++) {
    const t = sample / samples;
    if (!intrudesXZ(blocker, x + dx * t, z + dz * t, radius)) {
      clearT = t;
      continue;
    }
    let low = clearT;
    let high = t;
    for (let step = 0; step < SWEEP_BINARY_STEPS; step++) {
      const mid = (low + high) * 0.5;
      if (intrudesXZ(blocker, x + dx * mid, z + dz * mid, radius)) {
        high = mid;
      } else {
        low = mid;
      }
    }
    return low;
  }
  return null;
}

function slideVelocityXZ(
  velocity: { x: number; z: number },
  normals: ReadonlyArray<readonly [number, number]>,
): { x: number; z: number } {
  let x = velocity.x;
  let z = velocity.z;
  for (const [nx, nz] of normals) {
    const inward = x * nx + z * nz;
    if (inward < 0) {
      x -= nx * inward;
      z -= nz * inward;
    }
  }
  return {
    x: Math.abs(x) < 1e-10 ? 0 : x,
    z: Math.abs(z) < 1e-10 ? 0 : z,
  };
}

// ---- the brute-force oracle sextet ------------------------------------------

export function bruteForceSegmentOccluderIds(
  world: CollisionWorld,
  a: Vec3,
  b: Vec3,
  ignore?: ReadonlySet<string>,
): string[] {
  const ids: string[] = [];
  for (const blocker of world.blockers) {
    if (ignore?.has(blocker.id)) continue;
    const vertical = segmentSpanInterval(a.y, b.y, blocker.baseY, blocker.topY);
    if (!vertical) continue;
    if (segmentIntersectsFootprint(blocker, a, b, vertical[0], vertical[1])) {
      ids.push(blocker.id);
    }
  }
  return ids;
}

export function bruteForceBlockerIdsAt(
  world: CollisionWorld,
  pos: Vec3,
  radius: number,
  height: number,
  ignore?: ReadonlySet<string>,
): string[] {
  return world.blockers
    .filter(
      (blocker) =>
        !ignore?.has(blocker.id) &&
        spanOverlaps(pos.y, pos.y + height, blocker.baseY, blocker.topY) &&
        intrudesXZ(blocker, pos.x, pos.z, radius),
    )
    .map((blocker) => blocker.id);
}

export function bruteForceSweepXZ(
  world: CollisionWorld,
  from: Vec3,
  to: { x: number; z: number },
  radius: number,
  height: number,
  ignore?: ReadonlySet<string>,
): SweepResult {
  const footY = from.y;
  const headY = footY + height;
  const active = world.blockers.filter(
    (blocker) =>
      !ignore?.has(blocker.id) &&
      spanOverlaps(footY, headY, blocker.baseY, blocker.topY),
  );
  const clampedX = Math.min(Math.max(to.x, world.bounds.minX), world.bounds.maxX);
  const clampedZ = Math.min(Math.max(to.z, world.bounds.minZ), world.bounds.maxZ);
  const hitIds: string[] = [];
  const hitNormals: Array<readonly [number, number]> = [];
  let x = from.x;
  let z = from.z;
  let dx = clampedX - from.x;
  let dz = clampedZ - from.z;

  for (let contact = 0; contact < SWEEP_MAX_CONTACTS; contact++) {
    if (Math.hypot(dx, dz) <= 1e-10) break;
    let bestT = 1;
    let best: Blocker | null = null;
    for (const blocker of active) {
      const t = firstIntrusionTime(blocker, x, z, dx, dz, radius);
      if (t !== null && t < bestT - 1e-12) {
        bestT = t;
        best = blocker;
      }
    }
    if (!best) {
      x += dx;
      z += dz;
      dx = 0;
      dz = 0;
      break;
    }
    x += dx * bestT;
    z += dz * bestT;
    const normal = blockerContactNormal(best, x, z, radius);
    if (!hitIds.includes(best.id)) hitIds.push(best.id);
    hitNormals.push(normal);
    x += normal[0] * SWEEP_SKIN;
    z += normal[1] * SWEEP_SKIN;
    const remaining = 1 - bestT;
    const slid = slideVelocityXZ(
      { x: dx * remaining, z: dz * remaining },
      hitNormals,
    );
    dx = slid.x;
    dz = slid.z;
  }

  x = Math.min(Math.max(x, world.bounds.minX), world.bounds.maxX);
  z = Math.min(Math.max(z, world.bounds.minZ), world.bounds.maxZ);
  const blockedX =
    clampedX !== to.x || hitNormals.some(([nx]) => Math.abs(nx) > 1e-8);
  const blockedZ =
    clampedZ !== to.z || hitNormals.some(([, nz]) => Math.abs(nz) > 1e-8);
  return { x, z, blockedX, blockedZ, hitIds, hitNormals };
}

export function bruteForceSupportBelow(
  world: CollisionWorld,
  x: number,
  z: number,
  footY: number,
  snapUp = SUPPORT_SNAP_UP,
): Support | null {
  const ceil = footY + snapUp;
  let best: Support | null = null;
  const consider = (y: number, id: string) => {
    if (y > ceil + HEIGHT_EPS) return;
    if (!best || y > best.y) best = { y, id };
  };
  consider(0, "GROUND");
  for (const blocker of world.blockers) {
    if (!blocker.landable || !Number.isFinite(blocker.topY)) continue;
    if (intrudesXZ(blocker, x, z, 0)) consider(blocker.topY, blocker.id);
  }
  for (const platform of world.platforms) {
    const inside = platform.polygon
      ? pointInPolygon(x, z, platform.polygon)
      : pointInRect(
          x,
          z,
          platform.minX,
          platform.maxX,
          platform.minZ,
          platform.maxZ,
        );
    if (inside) consider(platform.y, platform.id);
  }
  return best;
}

export function bruteForceHeadClearance(
  world: CollisionWorld,
  x: number,
  z: number,
  radius: number,
  footY: number,
  ignore?: ReadonlySet<string>,
): number {
  let clearance = Infinity;
  for (const blocker of world.blockers) {
    if (ignore?.has(blocker.id)) continue;
    if (!intrudesXZ(blocker, x, z, radius)) continue;
    if (blocker.baseY <= footY + HEIGHT_EPS) {
      if (blocker.topY > footY + HEIGHT_EPS) return 0;
      continue;
    }
    clearance = Math.min(clearance, blocker.baseY - footY);
  }
  return clearance;
}

export function bruteForceDepenetrateXZ(
  world: CollisionWorld,
  pos: Vec3,
  radius: number,
  height: number,
  maxDistance = 0.8,
): Vec3 | null {
  const clear = (candidate: Vec3) =>
    bruteForceBlockerIdsAt(world, candidate, radius, height).length === 0;
  if (clear(pos)) return { ...pos };
  const step = 0.05;
  const directions = 24;
  for (let distance = step; distance <= maxDistance + 1e-6; distance += step) {
    for (let index = 0; index < directions; index++) {
      const angle = (index / directions) * Math.PI * 2;
      const candidate = {
        x: pos.x + Math.cos(angle) * distance,
        y: pos.y,
        z: pos.z + Math.sin(angle) * distance,
      };
      if (
        candidate.x < world.bounds.minX ||
        candidate.x > world.bounds.maxX ||
        candidate.z < world.bounds.minZ ||
        candidate.z > world.bounds.maxZ
      ) {
        continue;
      }
      if (clear(candidate)) return candidate;
    }
  }
  return null;
}
