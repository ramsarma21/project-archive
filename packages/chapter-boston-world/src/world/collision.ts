// Semantic collision + support model for player locomotion physics
// (World-Built-State §locomotion). Pure, deterministic, and THREE-free so
// it runs under `node --test` and inside the render loop without allocation
// churn. All positions are plain {x,y,z}; the caller bridges to THREE.
//
// The world is described as:
//   - blockers: axis-aligned XZ boxes with a solid vertical span [baseY, topY].
//     Buildings/barriers are full-height walls (topY = Infinity). Authored
//     low obstacles (vault crates, benches) are solid only up to their height
//     and expose their top as a landable support surface.
//   - platforms: thin support rects at a fixed y (authored roofs/scaffolds).
//   - the implicit ground plane at y = 0.
//
// A player is a vertical capsule: a foot point at footY, a head at
// footY + height, and a horizontal radius. Horizontal sweeps and support
// queries are height-aware so a jump collides with a wall it passes through
// but clears a crate it arcs over, and standing on a roof does not collide
// with the building footprint beneath the feet.

export type Vec3 = { x: number; y: number; z: number };

// Fixed integration substep: physics never advances more than this per step,
// so landings/apex are frame-rate independent and reproducible in tests.
export const PHYSICS_SUBSTEP = 1 / 120;

// Capsule dimensions (Day-1 spec): standing ~1.55m, crouched ~0.98m, radius
// 0.35m. Kept here so collision and motion agree on the same body.
export const CAPSULE_RADIUS = 0.35;
export const STAND_HEIGHT = 1.55;
export const CROUCH_HEIGHT = 0.98;

// Vertical tolerances.
export const CONTACT_EPS = 0.01; // "on the surface" band (<=1cm support snap)
export const SUPPORT_SNAP_UP = 0.06; // step-up tolerance onto a near-flush ledge
const HEIGHT_EPS = 1e-4;

export interface Blocker {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  baseY: number;
  topY: number; // Infinity for a full-height wall
  // Solid boxes with a finite topY also act as a landable surface at topY.
  landable: boolean;
  tags: ReadonlySet<string>;
  // Exact horizontal footprint. min/max remain as a broad phase and for
  // diagnostics; collision tests use this local-space shape when present.
  footprint?:
    | {
        kind: "obb";
        cx: number;
        cz: number;
        halfX: number;
        halfZ: number;
        yaw: number;
      }
    | {
        kind: "capsule";
        ax: number;
        az: number;
        bx: number;
        bz: number;
        radius: number;
      };
}

export interface Platform {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y: number;
  tags: ReadonlySet<string>;
  polygon?: ReadonlyArray<readonly [number, number]>;
}

export interface CollisionWorld {
  blockers: Blocker[];
  platforms: Platform[];
  // Outer world clamp (walkable bounds); horizontal sweeps clamp to it.
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

// ---- deterministic semantic broad phase -----------------------------------
// A uniform XZ grid indexes conservative blocker AABBs only. Query results are
// restored to authored blocker order before exact AABB/OBB/capsule tests, so
// first-hit behavior, stable IDs, ignore sets, and all narrow-phase semantics
// remain byte-for-byte deterministic.
const BROAD_PHASE_CELL_SIZE = 12;
// OBB narrow phase expands each local axis by the player radius. Rotating that
// expanded square back to world space can grow either broad axis by sqrt(2).
const BROAD_PHASE_RADIUS_FACTOR = Math.SQRT2;

interface BroadPhaseIndex {
  blockers: Blocker[];
  blockerCount: number;
  cells: Map<string, number[]>;
  marks: Uint32Array;
  stamp: number;
  scratch: number[];
}

interface BroadPhaseBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY?: number;
  maxY?: number;
}

const broadPhaseByWorld = new WeakMap<CollisionWorld, BroadPhaseIndex>();

function broadPhaseCell(value: number): number {
  return Math.floor(value / BROAD_PHASE_CELL_SIZE);
}

function broadPhaseKey(x: number, z: number): string {
  return `${x}:${z}`;
}

function buildBroadPhase(world: CollisionWorld): BroadPhaseIndex {
  const cells = new Map<string, number[]>();
  world.blockers.forEach((blocker, blockerIndex) => {
    const minCellX = broadPhaseCell(blocker.minX);
    const maxCellX = broadPhaseCell(blocker.maxX);
    const minCellZ = broadPhaseCell(blocker.minZ);
    const maxCellZ = broadPhaseCell(blocker.maxZ);
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
        const key = broadPhaseKey(cellX, cellZ);
        const entries = cells.get(key);
        if (entries) entries.push(blockerIndex);
        else cells.set(key, [blockerIndex]);
      }
    }
  });
  return {
    blockers: world.blockers,
    blockerCount: world.blockers.length,
    cells,
    marks: new Uint32Array(world.blockers.length),
    stamp: 0,
    scratch: [],
  };
}

function broadPhaseIndex(world: CollisionWorld): BroadPhaseIndex {
  let index = broadPhaseByWorld.get(world);
  // GameplayWorld replaces collision arrays atomically for door, route, and
  // traversal lifecycle changes. Rebuild automatically for either a new array
  // or a changed count; explicit invalidation covers intentional in-place edits.
  if (
    !index ||
    index.blockers !== world.blockers ||
    index.blockerCount !== world.blockers.length
  ) {
    index = buildBroadPhase(world);
    broadPhaseByWorld.set(world, index);
  }
  return index;
}

export function invalidateCollisionBroadPhase(world: CollisionWorld): void {
  broadPhaseByWorld.delete(world);
}

function broadPhaseCandidates(
  world: CollisionWorld,
  bounds: BroadPhaseBounds,
): readonly number[] {
  const index = broadPhaseIndex(world);
  index.stamp = (index.stamp + 1) >>> 0;
  if (index.stamp === 0) {
    index.marks.fill(0);
    index.stamp = 1;
  }
  const stamp = index.stamp;
  const result = index.scratch;
  result.length = 0;
  const minCellX = broadPhaseCell(bounds.minX);
  const maxCellX = broadPhaseCell(bounds.maxX);
  const minCellZ = broadPhaseCell(bounds.minZ);
  const maxCellZ = broadPhaseCell(bounds.maxZ);
  for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
      const entries = index.cells.get(broadPhaseKey(cellX, cellZ));
      if (!entries) continue;
      for (const blockerIndex of entries) {
        if (index.marks[blockerIndex] === stamp) continue;
        index.marks[blockerIndex] = stamp;
        const blocker = world.blockers[blockerIndex]!;
        if (
          blocker.maxX < bounds.minX ||
          blocker.minX > bounds.maxX ||
          blocker.maxZ < bounds.minZ ||
          blocker.minZ > bounds.maxZ
        ) {
          continue;
        }
        if (
          bounds.minY !== undefined &&
          bounds.maxY !== undefined &&
          !spanOverlaps(bounds.minY, bounds.maxY, blocker.baseY, blocker.topY)
        ) {
          continue;
        }
        result.push(blockerIndex);
      }
    }
  }
  result.sort((a, b) => a - b);
  return result;
}

export function collisionBroadPhaseCandidateCount(
  world: CollisionWorld,
  bounds: BroadPhaseBounds,
): number {
  return broadPhaseCandidates(world, bounds).length;
}

export function collisionBroadPhaseCandidateIds(
  world: CollisionWorld,
  bounds: BroadPhaseBounds,
): string[] {
  return broadPhaseCandidates(world, bounds).map(
    (blockerIndex) => world.blockers[blockerIndex]!.id,
  );
}

// ---- builders --------------------------------------------------------------

export function wallFromRect(
  id: string,
  cx: number,
  cz: number,
  halfX: number,
  halfZ: number,
  opts: { topY?: number; baseY?: number; landable?: boolean; tags?: Iterable<string> } = {},
): Blocker {
  const topY = opts.topY ?? Infinity;
  return {
    id,
    minX: cx - halfX,
    maxX: cx + halfX,
    minZ: cz - halfZ,
    maxZ: cz + halfZ,
    baseY: opts.baseY ?? 0,
    topY,
    landable: opts.landable ?? Number.isFinite(topY),
    tags: new Set(opts.tags ?? []),
  };
}

export function wallFromOrientedRect(
  id: string,
  cx: number,
  cz: number,
  halfX: number,
  halfZ: number,
  yaw: number,
  opts: { topY?: number; baseY?: number; landable?: boolean; tags?: Iterable<string> } = {},
): Blocker {
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const broadX = halfX * c + halfZ * s;
  const broadZ = halfX * s + halfZ * c;
  return {
    ...wallFromRect(id, cx, cz, broadX, broadZ, opts),
    footprint: { kind: "obb", cx, cz, halfX, halfZ, yaw },
  };
}

export function wallFromCapsule(
  id: string,
  a: Vec3,
  b: Vec3,
  radius: number,
  opts: { topY?: number; baseY?: number; landable?: boolean; tags?: Iterable<string> } = {},
): Blocker {
  const minX = Math.min(a.x, b.x) - radius;
  const maxX = Math.max(a.x, b.x) + radius;
  const minZ = Math.min(a.z, b.z) - radius;
  const maxZ = Math.max(a.z, b.z) + radius;
  return {
    id,
    minX,
    maxX,
    minZ,
    maxZ,
    baseY: opts.baseY ?? Math.min(a.y, b.y) - radius,
    topY: opts.topY ?? Math.max(a.y, b.y) + radius,
    landable: opts.landable ?? false,
    tags: new Set(opts.tags ?? []),
    footprint: {
      kind: "capsule",
      ax: a.x,
      az: a.z,
      bx: b.x,
      bz: b.z,
      radius,
    },
  };
}

export function platformFromRect(
  id: string,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  y: number,
  tags: Iterable<string> = [],
): Platform {
  return { id, minX, maxX, minZ, maxZ, y, tags: new Set(tags) };
}

export function platformFromPolygon(
  id: string,
  polygon: ReadonlyArray<readonly [number, number]>,
  y: number,
  tags: Iterable<string> = [],
): Platform {
  if (polygon.length < 3) {
    throw new Error(`platform ${id} requires at least three points`);
  }
  const xs = polygon.map((point) => point[0]);
  const zs = polygon.map((point) => point[1]);
  return {
    id,
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
    y,
    tags: new Set(tags),
    polygon: polygon.map(([x, z]) => [x, z] as const),
  };
}

// ---- geometry helpers ------------------------------------------------------

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

// Does a vertical capsule span [footY, headY] intersect a solid box's span?
function spanOverlaps(footY: number, headY: number, baseY: number, topY: number): boolean {
  return headY > baseY + HEIGHT_EPS && footY < topY - HEIGHT_EPS;
}

// ---- zero-radius line of sight ---------------------------------------------

// LOS is a mathematical, zero-radius segment. Blocker footprints and vertical
// spans are closed: touching a face/edge/corner, including at either query
// endpoint, is occluded. Callers that intentionally begin/end on an owning
// collider must pass that collider id in `ignore`. Platforms are support-only
// and never occlude. No player-capsule radius or tolerance is added.
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

export function segmentOccluderIds(
  world: CollisionWorld,
  a: Vec3,
  b: Vec3,
  ignore?: ReadonlySet<string>,
): string[] {
  const ids: string[] = [];
  const candidates = broadPhaseCandidates(world, {
    minX: Math.min(a.x, b.x),
    maxX: Math.max(a.x, b.x),
    minZ: Math.min(a.z, b.z),
    maxZ: Math.max(a.z, b.z),
  });
  for (const blockerIndex of candidates) {
    const blocker = world.blockers[blockerIndex]!;
    if (ignore?.has(blocker.id)) continue;
    const vertical = segmentSpanInterval(a.y, b.y, blocker.baseY, blocker.topY);
    if (!vertical) continue;
    if (segmentIntersectsFootprint(blocker, a, b, vertical[0], vertical[1])) {
      ids.push(blocker.id);
    }
  }
  return ids;
}

export function segmentClear(
  world: CollisionWorld,
  a: Vec3,
  b: Vec3,
  ignore?: ReadonlySet<string>,
): boolean {
  return segmentOccluderIds(world, a, b, ignore).length === 0;
}

// Would a capsule footprint at (x,z) intrude into this blocker's XZ box,
// expanded by the capsule radius?
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

export function positionClear(
  world: CollisionWorld,
  pos: Vec3,
  radius: number,
  height: number,
  ignore?: ReadonlySet<string>,
): boolean {
  return blockerIdsAt(world, pos, radius, height, ignore).length === 0;
}

export function blockerIdsAt(
  world: CollisionWorld,
  pos: Vec3,
  radius: number,
  height: number,
  ignore?: ReadonlySet<string>,
): string[] {
  const ids: string[] = [];
  const broadRadius = radius * BROAD_PHASE_RADIUS_FACTOR;
  const candidates = broadPhaseCandidates(world, {
    minX: pos.x - broadRadius,
    maxX: pos.x + broadRadius,
    minZ: pos.z - broadRadius,
    maxZ: pos.z + broadRadius,
    minY: pos.y,
    maxY: pos.y + height,
  });
  for (const blockerIndex of candidates) {
    const blocker = world.blockers[blockerIndex]!;
    if (ignore?.has(blocker.id)) continue;
    if (intrudesXZ(blocker, pos.x, pos.z, radius)) ids.push(blocker.id);
  }
  return ids;
}

// Bounded deterministic recovery for a position that became embedded after a
// route/collision registration change. Search nearest rings first; callers may
// roll back to their last-safe point if no local solution exists.
export function depenetrateXZ(
  world: CollisionWorld,
  pos: Vec3,
  radius: number,
  height: number,
  maxDistance = 0.8,
): Vec3 | null {
  if (positionClear(world, pos, radius, height)) return { ...pos };
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
      ) continue;
      if (positionClear(world, candidate, radius, height)) return candidate;
    }
  }
  return null;
}

// ---- horizontal sweep ------------------------------------------------------

export interface SweepResult {
  x: number;
  z: number;
  blockedX: boolean;
  blockedZ: boolean;
  hitIds: string[];
}

// Axis-separated slide from `from` to the desired `to`, resolving against any
// blocker whose solid vertical span overlaps the capsule [footY, footY+height].
// Blockers listed in `ignore` are skipped (used so a vault ignores only the
// obstacle it is clearing). Motion stays deterministic: X is resolved first,
// then Z against the already-resolved X.
export function sweepXZ(
  world: CollisionWorld,
  from: Vec3,
  to: { x: number; z: number },
  radius: number,
  height: number,
  ignore?: ReadonlySet<string>,
): SweepResult {
  const footY = from.y;
  const headY = footY + height;
  const clampedX = Math.min(Math.max(to.x, world.bounds.minX), world.bounds.maxX);
  const clampedZ = Math.min(Math.max(to.z, world.bounds.minZ), world.bounds.maxZ);
  const broadRadius = radius * BROAD_PHASE_RADIUS_FACTOR;
  const active = broadPhaseCandidates(world, {
    minX: Math.min(from.x, clampedX) - broadRadius,
    maxX: Math.max(from.x, clampedX) + broadRadius,
    minZ: Math.min(from.z, clampedZ) - broadRadius,
    maxZ: Math.max(from.z, clampedZ) + broadRadius,
    minY: footY,
    maxY: headY,
  });
  const hitIds: string[] = [];

  let blockedX = false;
  let nextX = clampedX;
  for (const blockerIndex of active) {
    const b = world.blockers[blockerIndex]!;
    if (ignore?.has(b.id)) continue;
    if (intrudesXZ(b, clampedX, from.z, radius)) {
      blockedX = true;
      hitIds.push(b.id);
      nextX = from.x;
      break;
    }
  }

  let blockedZ = false;
  let nextZ = clampedZ;
  for (const blockerIndex of active) {
    const b = world.blockers[blockerIndex]!;
    if (ignore?.has(b.id)) continue;
    if (intrudesXZ(b, nextX, clampedZ, radius)) {
      blockedZ = true;
      hitIds.push(b.id);
      nextZ = from.z;
      break;
    }
  }

  return { x: nextX, z: nextZ, blockedX, blockedZ, hitIds };
}

// ---- support queries -------------------------------------------------------

export interface Support {
  y: number;
  id: string;
}

// Highest support surface at (x,z) whose top is at or below footY + snapUp.
// Considers the ground plane (y=0), landable blocker tops, and platforms.
// Returns null when nothing (including the ground) is within reach below.
export function supportBelow(
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
  // Ground plane.
  consider(0, "GROUND");
  const candidates = broadPhaseCandidates(world, {
    minX: x,
    maxX: x,
    minZ: z,
    maxZ: z,
  });
  for (const blockerIndex of candidates) {
    const b = world.blockers[blockerIndex]!;
    if (!b.landable || !Number.isFinite(b.topY)) continue;
    if (intrudesXZ(b, x, z, 0)) consider(b.topY, b.id);
  }
  for (const p of world.platforms) {
    const inside = p.polygon
      ? pointInPolygon(x, z, p.polygon)
      : pointInRect(x, z, p.minX, p.maxX, p.minZ, p.maxZ);
    if (inside) consider(p.y, p.id);
  }
  return best;
}

// The platform the feet currently rest on (within its rect and within
// CONTACT_EPS of its surface), if any. Used to drive on-roof clamping.
export function platformUnderFoot(
  world: CollisionWorld,
  x: number,
  z: number,
  footY: number,
): Platform | null {
  let best: Platform | null = null;
  for (const p of world.platforms) {
    const inside = p.polygon
      ? pointInPolygon(x, z, p.polygon)
      : pointInRect(x, z, p.minX, p.maxX, p.minZ, p.maxZ);
    if (!inside) continue;
    if (Math.abs(footY - p.y) > 0.5) continue;
    if (!best || p.y > best.y) best = p;
  }
  return best;
}

// Vertical clearance above the feet at (x,z): distance from footY up to the
// lowest solid box that starts above the feet. Infinity when nothing is above.
// Used for full-height stand checks (never stand without clearance) and duck
// validation.
export function headClearance(
  world: CollisionWorld,
  x: number,
  z: number,
  radius: number,
  footY: number,
  ignore?: ReadonlySet<string>,
): number {
  let clearance = Infinity;
  const broadRadius = radius * BROAD_PHASE_RADIUS_FACTOR;
  const candidates = broadPhaseCandidates(world, {
    minX: x - broadRadius,
    maxX: x + broadRadius,
    minZ: z - broadRadius,
    maxZ: z + broadRadius,
  });
  for (const blockerIndex of candidates) {
    const b = world.blockers[blockerIndex]!;
    if (ignore && ignore.has(b.id)) continue;
    if (!intrudesXZ(b, x, z, radius)) continue;
    if (b.baseY <= footY + HEIGHT_EPS) {
      // A box we are already inside/beneath its base: if it is a full wall
      // spanning the feet, there is no vertical clearance here.
      if (b.topY > footY + HEIGHT_EPS) return 0;
      continue;
    }
    clearance = Math.min(clearance, b.baseY - footY);
  }
  return clearance;
}

// A landing at (x,z, landY) is valid when a support surface sits within
// CONTACT_EPS of landY and a standing capsule of `height` fits above it.
export function landingValid(
  world: CollisionWorld,
  x: number,
  z: number,
  radius: number,
  landY: number,
  height: number,
  ignore?: ReadonlySet<string>,
): boolean {
  const support = supportBelow(world, x, z, landY + CONTACT_EPS, CONTACT_EPS + 0.02);
  if (!support) return false;
  if (Math.abs(support.y - landY) > CONTACT_EPS + 0.05) return false;
  return headClearance(world, x, z, radius, support.y, ignore) >= height - 0.05;
}

// Standing room: is there full standing clearance at (x,z) with feet at footY?
export function canStand(
  world: CollisionWorld,
  x: number,
  z: number,
  radius: number,
  footY: number,
): boolean {
  return headClearance(world, x, z, radius, footY) >= STAND_HEIGHT - 0.05;
}
