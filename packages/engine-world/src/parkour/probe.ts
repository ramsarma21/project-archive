// Geometry reading for flow traversal.
//
// The probe answers one question every tick: what is in front of the player, in
// enough detail that a verb can be chosen without the player naming it. It is a
// pure read of the same CollisionWorld the player is standing in — the same
// footprints, the same support queries, the same intrusion predicate — so the
// verb the reader picks is the verb the physics will actually be able to run.
//
// Nothing here mutates. Nothing here is random. Two identical worlds and two
// identical player states always produce the identical probe.

import {
  CAPSULE_RADIUS,
  STAND_HEIGHT,
  type Blocker,
  type CollisionWorld,
  type Vec3,
  blockerIdsAt,
  canStand,
  headClearance,
  landingValid,
  supportBelow,
} from "../collision.js";
import { STEP_DOWN } from "../playerMotion.js";
import { PARKOUR_TUNING, type ParkourTuning } from "./tuning.js";

/** The low span over a passable gap: an awning, a cart bed, a broken fence. */
export interface LowSpanRead {
  /** Clear height between the feet and the underside of the span. */
  headroomM: number;
  /** Length of the low span along the travel direction. */
  depthM: number;
}

/** A solid obstacle directly ahead. */
export interface ObstacleRead {
  id: string;
  /** Distance from the capsule surface to the near face. Zero when touching. */
  contactDistanceM: number;
  /** Distance from the capsule centre to the near face. */
  faceDistanceM: number;
  /** Near-face contact point at foot height. */
  face: Vec3;
  /** Height of the top above the player's feet. Infinity for a full wall. */
  heightM: number;
  /** World y of the top. Infinity for a full wall. */
  topY: number;
  /** Depth of the footprint along the travel direction. */
  depthM: number;
  /** True when a standing capsule fits on top at the planted landing point. */
  topStandable: boolean;
  /** Where a mantle or step-up plants its feet on top. */
  topLanding: Vec3 | null;
  /** The surface on the far side, however far below. */
  farSide: { point: Vec3; dropM: number; standable: boolean } | null;
  /** Present when the obstacle is overhead rather than underfoot. */
  lowSpan: LowSpanRead | null;
}

/** A ledge ahead: the ground stops or steps down further than a stride. */
export interface EdgeRead {
  /** Distance from the capsule surface to the lip. */
  contactDistanceM: number;
  /** The lip point, at the player's foot height. */
  lip: Vec3;
  /** Straight-down drop from just past the lip. */
  dropM: number;
  /** Landing point straight down from just past the lip. */
  below: Vec3 | null;
  /** Lip-to-lip gap to the nearest far surface within a stride of foot height. */
  gapM: number | null;
  /** The far lip landing point, when one is in range. */
  far: { point: Vec3; dropM: number } | null;
}

export interface ParkourProbe {
  /** Unit travel direction the read was taken along. */
  dirX: number;
  dirZ: number;
  /** Horizontal speed at the time of the read. */
  speedMps: number;
  /** Foot height at the time of the read. */
  footY: number;
  obstacle: ObstacleRead | null;
  edge: EdgeRead | null;
}

export interface ProbeInput {
  pos: Vec3;
  /** Horizontal velocity. Used as the travel direction when moving. */
  velX: number;
  velZ: number;
  /** Body heading, used as the travel direction when nearly still. */
  yaw: number;
}

// ---- blocker lookup --------------------------------------------------------
// blockerIdsAt returns ids; the read needs spans and footprints. Cache an
// id -> blocker map per world, rebuilt when the blocker array is replaced (the
// same invalidation rule collision.ts uses for its broad phase).

interface BlockerLookup {
  blockers: Blocker[];
  count: number;
  byId: Map<string, Blocker>;
}

const lookupByWorld = new WeakMap<CollisionWorld, BlockerLookup>();

function blockerById(world: CollisionWorld, id: string): Blocker | null {
  let lookup = lookupByWorld.get(world);
  if (
    !lookup ||
    lookup.blockers !== world.blockers ||
    lookup.count !== world.blockers.length
  ) {
    lookup = {
      blockers: world.blockers,
      count: world.blockers.length,
      byId: new Map(world.blockers.map((blocker) => [blocker.id, blocker])),
    };
    lookupByWorld.set(world, lookup);
  }
  return lookup.byId.get(id) ?? null;
}

// ---- helpers ---------------------------------------------------------------

export function travelDirection(input: ProbeInput): {
  dirX: number;
  dirZ: number;
  speedMps: number;
} {
  const speedMps = Math.hypot(input.velX, input.velZ);
  if (speedMps > 0.35) {
    return {
      dirX: input.velX / speedMps,
      dirZ: input.velZ / speedMps,
      speedMps,
    };
  }
  return { dirX: Math.sin(input.yaw), dirZ: Math.cos(input.yaw), speedMps };
}

function pointAt(
  origin: Vec3,
  dirX: number,
  dirZ: number,
  distance: number,
  y = origin.y,
): Vec3 {
  return { x: origin.x + dirX * distance, y, z: origin.z + dirZ * distance };
}

/** Point-sample the footprints at foot height: is anything solid here? */
function solidIdsAt(
  world: CollisionWorld,
  point: Vec3,
  ignore: ReadonlySet<string> | undefined,
): string[] {
  return blockerIdsAt(world, point, 0, STAND_HEIGHT, ignore);
}

/** Surface at or just below `point.y`, including the implicit ground plane. */
function surfaceAt(world: CollisionWorld, point: Vec3, snapUp = 0.06) {
  return supportBelow(world, point.x, point.z, point.y, snapUp);
}

// ---- obstacle read ---------------------------------------------------------

function readObstacle(
  world: CollisionWorld,
  origin: Vec3,
  dirX: number,
  dirZ: number,
  ignore: ReadonlySet<string> | undefined,
  tuning: ParkourTuning,
): ObstacleRead | null {
  const maxDistance = tuning.obstacleProbeM;
  const step = tuning.probeStepM;

  let hitId: string | null = null;
  let clearDistance = 0;
  let hitDistance = -1;
  for (let distance = step; distance <= maxDistance + 1e-9; distance += step) {
    const ids = solidIdsAt(
      world,
      pointAt(origin, dirX, dirZ, distance),
      ignore,
    );
    if (ids.length === 0) {
      clearDistance = distance;
      continue;
    }
    hitId = ids[0]!;
    hitDistance = distance;
    break;
  }
  if (hitId === null) return null;

  // Refine the near face to the first point-intrusion distance.
  let low = clearDistance;
  let high = hitDistance;
  for (let pass = 0; pass < tuning.probeRefineSteps; pass++) {
    const mid = (low + high) * 0.5;
    const ids = solidIdsAt(world, pointAt(origin, dirX, dirZ, mid), ignore);
    if (ids.includes(hitId)) high = mid;
    else low = mid;
  }
  const faceDistanceM = high;

  // March through the same blocker to find its far face.
  const depthLimit = Math.max(
    tuning.vaultMaxDepthM,
    tuning.climbOverMaxDepthM,
    tuning.slideMaxDepthM,
  );
  let farFace = faceDistanceM;
  for (
    let distance = faceDistanceM + step;
    distance <= faceDistanceM + depthLimit + step * 2;
    distance += step
  ) {
    const ids = solidIdsAt(world, pointAt(origin, dirX, dirZ, distance), ignore);
    if (!ids.includes(hitId)) break;
    farFace = distance;
  }
  const depthM = Math.max(0, farFace - faceDistanceM);

  const blocker = blockerById(world, hitId);
  const topY = blocker && Number.isFinite(blocker.topY) ? blocker.topY : Infinity;
  const heightM = Number.isFinite(topY) ? topY - origin.y : Infinity;
  const face = pointAt(origin, dirX, dirZ, faceDistanceM);

  // Overhead span: clearance under the blocker measured just past its near
  // face. headClearance returns 0 when the blocker's span reaches the feet, so a
  // ground-based crate reads as solid and only a true overhead span reads low.
  const underPoint = pointAt(origin, dirX, dirZ, faceDistanceM + step);
  const headroomM = headClearance(
    world,
    underPoint.x,
    underPoint.z,
    CAPSULE_RADIUS,
    origin.y,
  );
  const lowSpan: LowSpanRead | null =
    headroomM > tuning.slideMinHeadroomM && headroomM < STAND_HEIGHT
      ? { headroomM, depthM }
      : null;

  // Standing room on top, planted a short way in from the near lip.
  let topStandable = false;
  let topLanding: Vec3 | null = null;
  if (Number.isFinite(topY)) {
    const inset = Math.min(
      tuning.topLandingInsetM,
      Math.max(0.12, depthM * 0.5),
    );
    const candidate = pointAt(
      origin,
      dirX,
      dirZ,
      faceDistanceM + inset,
      topY,
    );
    const wideEnough = depthM >= CAPSULE_RADIUS * 2 + 0.05;
    if (
      wideEnough &&
      canStand(world, candidate.x, candidate.z, CAPSULE_RADIUS, topY) &&
      landingValid(
        world,
        candidate.x,
        candidate.z,
        CAPSULE_RADIUS,
        topY,
        STAND_HEIGHT,
        new Set([hitId]),
      )
    ) {
      topStandable = true;
      topLanding = candidate;
    }
  }

  // The far side, wherever it is.
  let farSide: ObstacleRead["farSide"] = null;
  const farPoint = pointAt(
    origin,
    dirX,
    dirZ,
    farFace + CAPSULE_RADIUS + tuning.landingMarginM,
  );
  const farSurface = surfaceAt(world, farPoint);
  if (farSurface) {
    const point: Vec3 = { x: farPoint.x, y: farSurface.y, z: farPoint.z };
    farSide = {
      point,
      dropM: origin.y - farSurface.y,
      standable:
        canStand(world, point.x, point.z, CAPSULE_RADIUS, farSurface.y) &&
        landingValid(
          world,
          point.x,
          point.z,
          CAPSULE_RADIUS,
          farSurface.y,
          STAND_HEIGHT,
          new Set([hitId]),
        ),
    };
  }

  return {
    id: hitId,
    contactDistanceM: Math.max(0, faceDistanceM - CAPSULE_RADIUS),
    faceDistanceM,
    face,
    heightM,
    topY,
    depthM,
    topStandable,
    topLanding,
    farSide,
    lowSpan,
  };
}

// ---- edge read -------------------------------------------------------------

function readEdge(
  world: CollisionWorld,
  origin: Vec3,
  dirX: number,
  dirZ: number,
  ignore: ReadonlySet<string> | undefined,
  tuning: ParkourTuning,
  obstacleFaceDistanceM: number | null,
): EdgeRead | null {
  const step = tuning.probeStepM;
  const limit =
    obstacleFaceDistanceM === null
      ? tuning.edgeProbeM
      : Math.min(tuning.edgeProbeM, obstacleFaceDistanceM);
  if (limit <= step) return null;

  const dropsAway = (distance: number): boolean => {
    const point = pointAt(origin, dirX, dirZ, distance);
    const surface = surfaceAt(world, point);
    return !surface || surface.y < origin.y - STEP_DOWN;
  };

  let clearDistance = 0;
  let lipDistance = -1;
  for (let distance = step; distance <= limit + 1e-9; distance += step) {
    if (!dropsAway(distance)) {
      clearDistance = distance;
      continue;
    }
    lipDistance = distance;
    break;
  }
  if (lipDistance < 0) return null;

  let low = clearDistance;
  let high = lipDistance;
  for (let pass = 0; pass < tuning.probeRefineSteps; pass++) {
    const mid = (low + high) * 0.5;
    if (dropsAway(mid)) high = mid;
    else low = mid;
  }
  const lip = pointAt(origin, dirX, dirZ, low);

  // Straight down, just past the lip.
  const belowPoint = pointAt(origin, dirX, dirZ, high + CAPSULE_RADIUS);
  const belowSurface = surfaceAt(world, belowPoint);
  const below: Vec3 | null = belowSurface
    ? { x: belowPoint.x, y: belowSurface.y, z: belowPoint.z }
    : null;
  const dropM = belowSurface ? origin.y - belowSurface.y : Infinity;

  // The nearest far lip back at (roughly) foot height, for a gap jump.
  let gapM: number | null = null;
  let far: EdgeRead["far"] = null;
  for (
    let distance = high + step;
    distance <= high + tuning.gapProbeM + 1e-9;
    distance += step
  ) {
    const point = pointAt(origin, dirX, dirZ, distance);
    const surface = surfaceAt(world, point);
    if (!surface || surface.y < origin.y - STEP_DOWN) continue;
    if (
      !canStand(world, point.x, point.z, CAPSULE_RADIUS, surface.y) ||
      solidIdsAt(world, { ...point, y: surface.y }, ignore).length > 0
    ) {
      continue;
    }
    const landing = pointAt(
      origin,
      dirX,
      dirZ,
      distance + CAPSULE_RADIUS,
      surface.y,
    );
    const landingSurface = surfaceAt(world, {
      ...landing,
      y: surface.y + 0.06,
    });
    if (!landingSurface || Math.abs(landingSurface.y - surface.y) > 0.06) {
      continue;
    }
    gapM = distance - low;
    far = {
      point: { x: landing.x, y: surface.y, z: landing.z },
      dropM: origin.y - surface.y,
    };
    break;
  }

  return {
    contactDistanceM: Math.max(0, low - CAPSULE_RADIUS),
    lip,
    dropM,
    below,
    gapM,
    far,
  };
}

// ---- public read -----------------------------------------------------------

/**
 * Blockers the player's own body is already inside. A building standing at
 * y=[0,∞) with an authored roof platform on top is the load-bearing case: from up
 * on the roof, the building's own footprint spans the player's capsule at every
 * sample ahead, and without this exclusion every rooftop would read as a wall
 * directly in front of the player and no rooftop route would be traversable.
 *
 * The self-test uses a reduced radius so that merely touching a wall does not
 * count as being inside it — a wall the player is pressed against must still read
 * as an obstacle.
 */
const SELF_INTRUSION_RADIUS_FACTOR = 0.5;

export function selfIntrusionIds(
  world: CollisionWorld,
  pos: Vec3,
): string[] {
  return blockerIdsAt(
    world,
    pos,
    CAPSULE_RADIUS * SELF_INTRUSION_RADIUS_FACTOR,
    STAND_HEIGHT,
  );
}

export function probeAhead(
  world: CollisionWorld,
  input: ProbeInput,
  tuning: ParkourTuning = PARKOUR_TUNING,
  ignore?: ReadonlySet<string>,
): ParkourProbe {
  const { dirX, dirZ, speedMps } = travelDirection(input);
  const selfIds = selfIntrusionIds(world, input.pos);
  const effectiveIgnore =
    selfIds.length === 0 && !ignore
      ? undefined
      : new Set<string>([...(ignore ?? []), ...selfIds]);
  const obstacle = readObstacle(
    world,
    input.pos,
    dirX,
    dirZ,
    effectiveIgnore,
    tuning,
  );
  // A ledge is only interesting when it comes before the obstacle: a wall two
  // metres past the lip does not change what happens at the lip.
  const edge = readEdge(
    world,
    input.pos,
    dirX,
    dirZ,
    effectiveIgnore,
    tuning,
    obstacle ? obstacle.faceDistanceM : null,
  );
  return {
    dirX,
    dirZ,
    speedMps,
    footY: input.pos.y,
    obstacle,
    edge,
  };
}
