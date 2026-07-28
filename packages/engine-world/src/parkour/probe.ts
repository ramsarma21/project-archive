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
  climbAffordanceAt,
  climbVolumeAt,
  headClearance,
  landingValid,
  supportBelow,
} from "../collision.js";
import {
  STEP_DOWN,
  cloneMotionState,
  simulateWalkOff,
  type MotionState,
} from "../playerMotion.js";
import { FIELD_DT } from "../fieldSimulation.js";
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
  /**
   * How far a body that keeps walking off this lip actually falls.
   *
   * NOT the drop straight down past the lip — see `verticalDropM` for that. A
   * body that leaves a ledge carries its speed, and the surface it can see over
   * the edge is very often not the surface it comes down on. Measured at the
   * crown of the Liberty Elm: a bough eight metres three above the street
   * overhangs the bough below it by one metre twenty, the ground straight down
   * past the lip is therefore one metre ninety away, and a walking body needs
   * one metre thirty-six of run before it has fallen that far — so it clears the
   * lower bough by a hand's breadth and hits the street. Reporting 1.90 there
   * ranks it a stroll; the honest number is 8.30 and nobody strolls off that.
   */
  dropM: number;
  /**
   * The surface the walk-off's first landing settles on, or null for the void.
   * The confirmed edge hazard carries this as part of its identity, so it can
   * tell "braking made the read look safe" (same lip, same landing below) from
   * "the geometry changed and it is now genuinely safe" (a new surface, a
   * different id) and release promptly in the second case.
   */
  landingId: string | null;
  /**
   * Drop straight down just past the lip, and the surface reached by it.
   *
   * This is the hang drop's number, and it is deliberately a different question
   * from `dropM`: a body that lowers itself over an edge does not travel, so a
   * ledge too narrow to catch a walking body is still somewhere it can climb
   * down onto. The market shed reads 5.60 walking off and 2.50 hanging down onto
   * the shambles pentice, and both are true.
   */
  verticalDropM: number;
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
  /**
   * Where the player is PUSHING, when they are pushing anywhere.
   *
   * Velocity is the honest travel direction right up until the body is held
   * against something, at which point it is zero and says nothing — and a body
   * held against something is precisely when the read matters most. The heading
   * is not a substitute: `stepGrounded` only turns the body while it is moving,
   * so a player who has come to a stop at a wall and then turned to face a
   * different part of it is still read along the direction they arrived from.
   *
   * Optional, so a caller that has no notion of intent keeps its old behaviour.
   */
  intentX?: number;
  intentZ?: number;
  /**
   * Coyote grace already spent, carried straight from `MotionState.airtimeMs`.
   *
   * The exact walk-off prediction fells the body through the production
   * integrator, and the grace it has LEFT before a fall begins is part of the
   * body's state, not a fresh full window: a body already a few ticks past the
   * lip has less of it, and assuming a fresh window would predict a longer, safer
   * glide than the body actually gets. Optional, defaults to none spent.
   */
  airtimeMs?: number;
  /** Live capsule height, so the prediction falls the same body. Defaults to standing. */
  capsuleHeight?: number;
  /**
   * The COMPLETE live motion state, for the walk-off prediction to fall exactly
   * the body that exists right now.
   *
   * A prediction that rebuilds a fresh GROUNDED body from a handful of scalars
   * gets the common case right and the dangerous cases wrong: it loses the open
   * dash, the mid-action phase and its ticks, the stagger, the coyote already
   * spent. A body mid-dash toward a lip is travelling at dash speed and will fall
   * where a dash falls — a generic target speed reads that as a safe walk-off and
   * the body hits the street eight metres down. So when the caller has the real
   * state it hands it whole; `predictWalkOff` deep-clones it and runs the
   * production integrator forward from it, dash and all. The scalar fields above
   * remain the fallback for callers (the affordance survey) that have no live
   * body, only a hypothetical stance.
   */
  motion?: MotionState;
  /**
   * A ROUTE-AUTHORED travel direction to read ALONG, overriding the direction
   * derived from velocity/intent/yaw. Set only by a caller that has a committed
   * directed gateway AND has already checked the player's intent agrees with it
   * (see flow.ts): the reader then probes the authored axis — the vault IN->OUT
   * line — rather than a live slide a few degrees off it that finds the wrong
   * obstacle. Speed, motion and position stay REAL; only the direction is steered.
   * A unit XZ vector; both components required or it is ignored.
   */
  dirOverrideX?: number;
  dirOverrideZ?: number;
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
  const intent = Math.hypot(input.intentX ?? 0, input.intentZ ?? 0);
  if (intent > 1e-6) {
    return {
      dirX: (input.intentX ?? 0) / intent,
      dirZ: (input.intentZ ?? 0) / intent,
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
      canStand(world, candidate.x, candidate.z, CAPSULE_RADIUS, topY, ignore) &&
      landingValid(
        world,
        candidate.x,
        candidate.z,
        CAPSULE_RADIUS,
        topY,
        STAND_HEIGHT,
        new Set([hitId, ...(ignore ?? [])]),
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
        canStand(world, point.x, point.z, CAPSULE_RADIUS, farSurface.y, ignore) &&
        landingValid(
          world,
          point.x,
          point.z,
          CAPSULE_RADIUS,
          farSurface.y,
          STAND_HEIGHT,
          new Set([hitId, ...(ignore ?? [])]),
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

// ---- raised-surface read ---------------------------------------------------

/**
 * A LEDGE IS NOT ALWAYS A BOX, AND THIS IS THE READ THAT WAS MISSING.
 *
 * `readObstacle` marches point samples at foot height and asks which solid
 * BLOCKERS they are inside. That answers the question perfectly for a crate, a
 * cart or a wall, and it answers it not at all for the other half of the world:
 * a `deck` compiles to a `platform`, a platform is a support surface with no
 * solid span, and no point sample at foot height is ever inside one. So a
 * scaffold staging two metres nine above the street was invisible to the verb
 * ladder — the player walked up to it, the reader found nothing ahead, and
 * nothing was offered.
 *
 * That is not a corner case in this level. It is the entire guaranteed ascent
 * of the Town House, the gallery and cornice chain, the meeting-house ridge and
 * every bough of the Liberty Elm — which is to say, it is the objective and the
 * only sanctioned way to reach it. The route tests never caught it because they
 * ask `beginAuthored` whether the body COULD perform each link if commanded, and
 * it could; during play nothing commands anything, and the ladder decides.
 *
 * So: march the same rays, and instead of asking what is solid here, ask what
 * you could stand on here that is higher than your feet. Anything within the
 * climb ceiling is a ledge, and the result is dressed as an `ObstacleRead` so
 * the ladder above needs to learn nothing at all.
 */
function readRaisedSurface(
  world: CollisionWorld,
  origin: Vec3,
  dirX: number,
  dirZ: number,
  ignore: ReadonlySet<string> | undefined,
  tuning: ParkourTuning,
): ObstacleRead | null {
  const step = tuning.probeStepM;
  const reach = tuning.climbMaxHeightM;
  // Grounded motion absorbs six centimetres of rise and no more, so anything
  // above that genuinely needs a verb — including a kerb, which is why a kerb
  // authored as a deck used to be an invisible wall.
  const raisedBy = 0.08;

  const raisedAt = (distance: number): { y: number; id: string } | null => {
    const point = pointAt(origin, dirX, dirZ, distance);
    const support = supportBelow(world, point.x, point.z, origin.y + reach, 0);
    if (!support) return null;
    if (support.y <= origin.y + raisedBy) return null;
    if (ignore?.has(support.id)) return null;
    return support;
  };

  // A surface already over the player's own head is something they are standing
  // UNDER, not a ledge in front of them. Without this, walking about beneath a
  // scaffold would offer a climb onto its middle from anywhere underneath it.
  const overhead = raisedAt(0);

  let clearDistance = 0;
  let hit: { y: number; id: string } | null = null;
  let hitDistance = -1;
  for (
    let distance = step;
    distance <= tuning.obstacleProbeM + 1e-9;
    distance += step
  ) {
    const raised = raisedAt(distance);
    if (!raised || (overhead && raised.id === overhead.id)) {
      clearDistance = distance;
      continue;
    }
    hit = raised;
    hitDistance = distance;
    break;
  }
  if (!hit) return null;

  const hitId = hit.id;
  // REFUSAL. A climb-volume ascent onto this surface may arm only where a visible
  // means — a ladder or an honest grip — validates at this foot. Everywhere else
  // (an ordinary ledge with a lip the body pulls onto) is untouched, so this
  // refuses walking up a bare authored face without pulling any normal parkour.
  if (
    climbVolumeAt(world, origin.x, origin.y, origin.z, hitId) !== null &&
    climbAffordanceAt(world, origin.x, origin.y, origin.z, hitId) === null
  ) {
    return null;
  }
  const topY = hit.y;
  let low = clearDistance;
  let high = hitDistance;
  for (let pass = 0; pass < tuning.probeRefineSteps; pass++) {
    const mid = (low + high) * 0.5;
    const raised = raisedAt(mid);
    if (raised && raised.id === hitId) high = mid;
    else low = mid;
  }
  const faceDistanceM = high;

  // How far the surface runs on, along the travel direction.
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
    const raised = raisedAt(distance);
    if (!raised || raised.id !== hitId || Math.abs(raised.y - topY) > 0.06) break;
    farFace = distance;
  }
  const depthM = Math.max(0, farFace - faceDistanceM);

  const inset = Math.min(tuning.topLandingInsetM, Math.max(0.12, depthM * 0.5));
  const candidate = pointAt(origin, dirX, dirZ, faceDistanceM + inset, topY);
  const topStandable =
    depthM >= CAPSULE_RADIUS * 2 + 0.05 &&
    canStand(world, candidate.x, candidate.z, CAPSULE_RADIUS, topY, ignore) &&
    landingValid(
      world,
      candidate.x,
      candidate.z,
      CAPSULE_RADIUS,
      topY,
      STAND_HEIGHT,
          new Set([hitId, ...(ignore ?? [])]),
    );

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
        canStand(world, point.x, point.z, CAPSULE_RADIUS, farSurface.y, ignore) &&
        landingValid(
          world,
          point.x,
          point.z,
          CAPSULE_RADIUS,
          farSurface.y,
          STAND_HEIGHT,
          new Set([hitId, ...(ignore ?? [])]),
        ),
    };
  }

  return {
    id: hitId,
    contactDistanceM: Math.max(0, faceDistanceM - CAPSULE_RADIUS),
    faceDistanceM,
    face: pointAt(origin, dirX, dirZ, faceDistanceM),
    heightM: topY - origin.y,
    topY,
    depthM,
    topStandable,
    topLanding: topStandable ? candidate : null,
    farSide,
    // A support surface has no underside to duck beneath. `headClearance` only
    // considers blockers, so anything overhead here is already reported by the
    // blocker read; inventing a span from a platform would double-count it.
    lowSpan: null,
  };
}

/**
 * The surface OVER the player's head, when there is no edge in front of them.
 *
 * The read above finds a ledge by walking forward until the ground steps up,
 * which is the whole answer for a staging you approach across open street. It
 * is no answer at all for the second staging of the same scaffold: two decks
 * with the same footprint, one 2.7m above the other, and from anywhere on the
 * lower one the upper one is directly overhead with no edge to walk at. M1's
 * guaranteed ascent of the Town House is exactly that shape, and so are the
 * clock ledge, the cornice and three tiers of the Liberty Elm — the objective
 * itself. Authored as CLIMB links whose two nodes share an x and a z, which is
 * a vertical reach and not a direction.
 *
 * So this is the last rung: nothing ahead, something above, and a player holding
 * a direction. It is deliberately narrow. It only looks above HEAD height, so it
 * can never compete with a mantle onto something in front; it only fires when
 * the forward read found nothing at all; and the landing it plants has to accept
 * a standing body like any other, which is what keeps it from pulling anybody
 * through a roof.
 */
/**
 * How far under a floor's lip a body can still reach it.
 *
 * A person pulls onto a floor by getting a hand over its edge, so the honest
 * number is about the length of an arm. It was measured both ways today: at
 * zero — no bound at all — sixteen of M1's fifty-six decks could be entered
 * from anywhere underneath, and twenty-three of a hundred and eighteen verbs
 * rose through the middle of the boards. At half a metre that fell to nine, but
 * it also silenced the Town House scaffold, the clock ledge, the cornice, the
 * meeting-house ridge and a tier of the Liberty Elm, and a mission you cannot
 * finish is worse than a reader that is too generous, so the bound came back
 * out.
 *
 * What made it shippable is that those links no longer depend on it. They are
 * pure vertical ascents whose standing point is metres inside its own deck —
 * the clock is 3.5m in and the cornice 5.7m — and no reading of "you are at a
 * lip" was ever going to find them, because they are not at one. They are
 * authored now, as climb volumes, and a body standing in one skips this bound
 * entirely. So the bound only has to answer the case inference can answer, and
 * it can be set to what an arm actually reaches.
 */
const OVERHEAD_REACH_M = 0.5;

function readOverhead(
  world: CollisionWorld,
  origin: Vec3,
  dirX: number,
  dirZ: number,
  ignore: ReadonlySet<string> | undefined,
  tuning: ParkourTuning,
): ObstacleRead | null {
  const above = supportBelow(
    world,
    origin.x,
    origin.z,
    origin.y + tuning.climbMaxHeightM,
    0,
  );
  if (!above) return null;
  if (ignore?.has(above.id)) return null;
  // Above the crown of the head, or it is something in front rather than over.
  if (above.y <= origin.y + STAND_HEIGHT + 0.05) return null;

  // REFUSAL. A pure vertical ascent authored as a climb volume may arm only where
  // a ladder or grip validates. This is the "no ladder, no climb" the owner asked
  // for, at the one read that offers the deep-set climbs (clock, cornice) which
  // have no lip to infer and are therefore ALWAYS climb-volume authorised.
  if (
    climbVolumeAt(world, origin.x, origin.y, origin.z, above.id) !== null &&
    climbAffordanceAt(world, origin.x, origin.y, origin.z, above.id) === null
  ) {
    return null;
  }

  const topY = above.y;
  const step = tuning.probeStepM;

  // YOU HAVE TO BE AT ITS EDGE, NOT UNDER ITS MIDDLE — UNLESS THE LEVEL SAYS
  // OTHERWISE.
  //
  // Without this the reader answers "is there a deck anywhere in the column
  // between my head and 3.2m", which is true from every square metre beneath a
  // scaffold, a canopy or a bough — and holding a direction anywhere under one
  // pulled the body up through the boards. Measured across M1: sixteen of
  // fifty-six decks were enterable from underneath, three of them from anywhere
  // below at all.
  //
  // A body pulls onto a floor by getting a hand over its lip, so the test is
  // how far the surface extends BEHIND the player: at the lip it stops within
  // arm's reach, and under the middle it does not. Marching backwards rather
  // than forwards is the whole of the distinction, and it is the same
  // distinction a person makes by eye.
  //
  // The exemption is the other half. A genuine vertical ascent has no lip to
  // stand at, so it is authored as a climb volume instead of inferred, and a
  // body standing in one has already been told it may go up. See ClimbVolume.
  const authorised =
    climbVolumeAt(world, origin.x, origin.y, origin.z, above.id) !== null;
  if (!authorised) {
    let behind = 0;
    for (
      let distance = step;
      distance <= OVERHEAD_REACH_M + step;
      distance += step
    ) {
      const point = pointAt(origin, -dirX, -dirZ, distance);
      const surface = supportBelow(world, point.x, point.z, topY, 0);
      if (!surface || surface.id !== above.id || Math.abs(surface.y - topY) > 0.06) {
        break;
      }
      behind = distance;
    }
    if (behind > OVERHEAD_REACH_M) return null;
  }

  let runsFor = 0;
  for (let distance = step; distance <= tuning.obstacleProbeM + 1e-9; distance += step) {
    const point = pointAt(origin, dirX, dirZ, distance);
    const surface = supportBelow(world, point.x, point.z, topY, 0);
    if (!surface || surface.id !== above.id || Math.abs(surface.y - topY) > 0.06) {
      break;
    }
    runsFor = distance;
  }

  const inset = Math.min(tuning.topLandingInsetM, Math.max(0.12, runsFor * 0.5));
  const candidate = pointAt(origin, dirX, dirZ, inset, topY);
  const topStandable =
    canStand(world, candidate.x, candidate.z, CAPSULE_RADIUS, topY, ignore) &&
    landingValid(
      world,
      candidate.x,
      candidate.z,
      CAPSULE_RADIUS,
      topY,
      STAND_HEIGHT,
      new Set([above.id, ...(ignore ?? [])]),
    );
  if (!topStandable) return null;

  return {
    id: above.id,
    contactDistanceM: 0,
    faceDistanceM: 0,
    face: { x: origin.x, y: origin.y, z: origin.z },
    heightM: topY - origin.y,
    topY,
    depthM: Math.max(runsFor, CAPSULE_RADIUS * 2 + 0.05),
    topStandable: true,
    topLanding: candidate,
    farSide: null,
    lowSpan: null,
  };
}

// ---- edge read -------------------------------------------------------------

/**
 * How far the body actually comes down if the player keeps doing what they are
 * doing — the ONE exact trajectory, not a range of guesses.
 *
 * THE OLD READ WAS A HEURISTIC AND HEURISTICS ARE HOW A BODY FALLS OFF A ROOF THE
 * READER BELIEVED WAS SAFE. A fixed walk under-read the sprinter who overshot the
 * near catch; a sampled range over-read the runner who would have landed squarely
 * on a wide roof but was braked because a slower sample fell into a gap. There is
 * no speed to pick and no range to sample, because there is exactly one thing the
 * body will do: accelerate from its current velocity toward the raw target the
 * player is holding, spend the coyote grace it has left, and fall under the same
 * integrator, collision and support the frame loop runs. `simulateWalkOff` IS
 * that integrator fed forward, so this is production, not a model of it.
 *
 * A body whose committed trajectory never leaves the ground — walking along, or
 * a target that steers away from the lip — has no fall to report and returns 0.
 * The brake's own stability across the tick where it removes the very velocity it
 * was reading is NOT this function's job: it is handled by persisting the
 * confirmed hazard in the flow controller, so a momentarily honest "safe" read
 * once braked does not erase the fatal hazard that was confirmed a tick earlier.
 */
function predictWalkOff(
  world: CollisionWorld,
  input: ProbeInput,
  dirX: number,
  dirZ: number,
  tuning: ParkourTuning,
): { dropM: number; landingId: string | null; fell: boolean } {
  const intentX = input.intentX ?? 0;
  const intentZ = input.intentZ ?? 0;
  const intentMag = Math.hypot(intentX, intentZ);
  const speedMps = Math.hypot(input.velX, input.velZ);
  // The raw target the player is pushing, falling back to the travel direction at
  // the live speed when there is no intent to read.
  const targetVelX = intentMag > 1e-6 ? intentX : dirX * speedMps;
  const targetVelZ = intentMag > 1e-6 ? intentZ : dirZ * speedMps;
  // The real body when the caller has it (dash, stagger, action, coyote and all);
  // a hypothetical standing body only when it does not.
  const state = input.motion
    ? cloneMotionState(input.motion)
    : ({
        phase: "GROUNDED",
        pos: { ...input.pos },
        vel: { x: input.velX, y: 0, z: input.velZ },
        yaw: input.yaw,
        capsuleHeight: input.capsuleHeight ?? STAND_HEIGHT,
        grounded: true,
        airtimeMs: input.airtimeMs ?? 0,
        action: null,
        dash: null,
        stagger: null,
      } satisfies MotionState);
  const prediction = simulateWalkOff(world, state, targetVelX, targetVelZ, {
    dt: FIELD_DT,
    // Past the brake ceiling the verb is EDGE_BRAKE whatever is below, so there
    // is no reason to fall the body to the floor of the void.
    maxFallM: tuning.edgeBrakeMinDropM + 1,
  });
  return {
    dropM: prediction.dropM,
    landingId: prediction.landingId,
    fell: prediction.fell,
  };
}

/**
 * The walk-off a body would take if it committed to `intent` at the committed
 * speed (the larger of its live speed and the speed it is asking for), run
 * through the production integrator. This is the STABLE hazard signal: unlike the
 * live prediction it does not collapse to a safe creep when the brake removes the
 * body's velocity — the player is still committed to the lip — yet it recomputes
 * against the CURRENT geometry every tick, so it releases the moment the drop
 * beyond the lip stops being fatal. Exposed for the flow controller's hazard.
 */
export function predictCommittedWalkOff(
  world: CollisionWorld,
  motion: MotionState,
  intentX: number,
  intentZ: number,
  tuning: ParkourTuning,
): { dropM: number; landingId: string | null; fell: boolean } {
  const intentMag = Math.hypot(intentX, intentZ);
  if (intentMag < 1e-6) return { dropM: 0, landingId: null, fell: false };
  const state = cloneMotionState(motion);
  // A committed grounded mover in the asked-for direction. Braking has already
  // dropped any dash and left the body grounded, so this is the honest "if they
  // keep pushing" body, not the momentarily-stopped one the live read sees.
  state.phase = state.phase === "CROUCH" ? "CROUCH" : "GROUNDED";
  state.grounded = true;
  state.action = null;
  state.dash = null;
  state.stagger = null;
  // Keep the body's LIVE horizontal velocity and let the integrator accelerate it
  // toward the intent — do NOT teleport it to full sprint speed. Assuming a full
  // sprint made this mover clear a gap the real, slower body drops into: a lip
  // with a fatal gap and a reachable-only-at-speed roof beyond it read as safe,
  // and the brake released the moment it engaged, sliding a short-run-up body over
  // the edge. Stability against the brake erasing its own evidence does not need
  // the overshoot: a body accelerating from a standstill toward the lip still
  // falls into a drop the geometry really has, so a genuinely fatal hazard stays
  // confirmed; only a drop the world has actually made survivable releases it.
  state.vel = { x: motion.vel.x, y: 0, z: motion.vel.z };
  const prediction = simulateWalkOff(world, state, intentX, intentZ, {
    dt: FIELD_DT,
    maxFallM: tuning.edgeBrakeMinDropM + 1,
  });
  return {
    dropM: prediction.dropM,
    landingId: prediction.landingId,
    fell: prediction.fell,
  };
}

function readEdge(
  world: CollisionWorld,
  input: ProbeInput,
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

  // Straight down, just past the lip: what a hang drop reaches.
  const belowPoint = pointAt(origin, dirX, dirZ, high + CAPSULE_RADIUS);
  const belowSurface = surfaceAt(world, belowPoint);
  const below: Vec3 | null = belowSurface
    ? { x: belowPoint.x, y: belowSurface.y, z: belowPoint.z }
    : null;
  const verticalDropM = belowSurface ? origin.y - belowSurface.y : Infinity;

  // And where the body actually comes down if it keeps walking: the one exact
  // trajectory the player's current state and input produce.
  const walkOff = predictWalkOff(world, input, dirX, dirZ, tuning);
  const dropM = walkOff.dropM;

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
    landingId: walkOff.landingId,
    verticalDropM,
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

// The ids of every ladder-tagged solid, cached per blocker array (rebuilt when
// the array is replaced, the same invalidation rule the broad phase uses). The
// reader ignores these so a ladder is never read as a wall to vault or be
// blocked by; the solver does not, so the body still cannot walk through one.
const ladderIdsByBlockers = new WeakMap<object, ReadonlySet<string>>();
function ladderBlockerIds(world: CollisionWorld): ReadonlySet<string> {
  const cached = ladderIdsByBlockers.get(world.blockers);
  if (cached) return cached;
  const ids = new Set<string>();
  for (const blocker of world.blockers) {
    if (blocker.tags.has("ladder")) ids.add(blocker.id);
  }
  ladderIdsByBlockers.set(world.blockers, ids);
  return ids;
}

export function probeAhead(
  world: CollisionWorld,
  input: ProbeInput,
  tuning: ParkourTuning = PARKOUR_TUNING,
  ignore?: ReadonlySet<string>,
): ParkourProbe {
  const travel = travelDirection(input);
  // A route-authored direction steers the READ (obstacle, surface, edge) so a
  // directed gateway probes the authored axis; the SPEED stays the body's real
  // speed and `motion` still fells the real body in the walk-off prediction.
  const hasOverride =
    input.dirOverrideX !== undefined && input.dirOverrideZ !== undefined;
  const dirX = hasOverride ? input.dirOverrideX! : travel.dirX;
  const dirZ = hasOverride ? input.dirOverrideZ! : travel.dirZ;
  const speedMps = travel.speedMps;
  const selfIds = selfIntrusionIds(world, input.pos);
  // A LADDER is climbed, not vaulted or blocked: the reader must see THROUGH the
  // ladder solid to the surface behind it, or a solid ladder standing in front of
  // its own climb reads as a wall and the climb is never offered. The MOVER still
  // collides with the ladder (this ignore is the reader's, not the solver's), so
  // walking into it is still stopped — the owner's "no phasing" — while the climb
  // it fronts is still read and gated by `climbAffordanceAt`.
  const ladderIds = ladderBlockerIds(world);
  const effectiveIgnore =
    selfIds.length === 0 && !ignore && ladderIds.size === 0
      ? undefined
      : new Set<string>([...(ignore ?? []), ...selfIds, ...ladderIds]);
  const solid = readObstacle(
    world,
    input.pos,
    dirX,
    dirZ,
    effectiveIgnore,
    tuning,
  );
  // Whichever is nearer owns the read. A wall two metres past the edge of a
  // staging does not change what happens at the staging, and a staging behind a
  // wall is not reachable through it.
  const raised = readRaisedSurface(
    world,
    input.pos,
    dirX,
    dirZ,
    effectiveIgnore,
    tuning,
  );
  // Whichever is nearer owns the read — with one exception, and it is the one
  // that hides the top of the Town House and the steeple balcony. A tower is a
  // solid mass with a walkable ledge partway up it: the mass is nearer, has no
  // standable top and no far side, so it reads as a wall and the ledge two
  // hundred millimetres behind it is never considered. A blocker that offers a
  // body nowhere to go is not a better answer than a surface that does.
  const solidOffersNothing =
    solid !== null && !solid.topStandable && !(solid.farSide?.standable ?? false);
  // Set only when the overhead read produced something, and it is only ever
  // called where a non-null result is the one that wins.
  let fromOverhead = false;
  const overhead = () => {
    const read = readOverhead(world, input.pos, dirX, dirZ, effectiveIgnore, tuning);
    if (read) fromOverhead = true;
    return read;
  };
  const obstacle =
    solid === null
      ? (raised ?? overhead())
      : raised !== null &&
          (raised.faceDistanceM < solid.faceDistanceM || solidOffersNothing)
        ? raised
        : solidOffersNothing
          ? (overhead() ?? solid)
          : solid;
  // A ledge is only interesting when it comes before the obstacle: a wall two
  // metres past the lip does not change what happens at the lip.
  //
  // A SURFACE OVER YOUR HEAD IS NOT BETWEEN YOU AND THE GROUND AHEAD. The
  // overhead read reports `faceDistanceM: 0` because a vertical reach has no
  // distance to travel, and feeding that in as a ledge limit switched the ground
  // read off entirely — a body walking out from under the upper bough of the elm
  // was offered a climb it could not take without the key, and the eight-metre
  // lip three strides in front of it was never read at all. It walked off.
  const edge = readEdge(
    world,
    input,
    input.pos,
    dirX,
    dirZ,
    effectiveIgnore,
    tuning,
    obstacle === null || fromOverhead ? null : obstacle.faceDistanceM,
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
