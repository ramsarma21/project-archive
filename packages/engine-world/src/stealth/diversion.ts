// Thrown diversion: a real object on a real arc.
//
// A stone or a bottle, thrown, that lands somewhere and makes a noise there. It
// is not an attention flag that teleports to a target — it flies, it can hit a
// wall short of where you aimed, it bounces, and the noise happens wherever it
// actually ended up. That matters because the entire tactic is aiming: throwing
// short is a mistake the player can make and learn from, and a diversion that
// cannot miss is not a skill.
//
// It runs on the same physics as the player: the same GRAVITY, the same fixed
// PHYSICS_SUBSTEP, the same collision module, the same fixed clock. There is no
// second integrator here — only a smaller body, because a bottle is not a
// person-sized capsule.
//
// The noise it makes redirects attention (see alert.stepWatcherAttention) and
// contributes nothing to the player's own suspicion, so a well-thrown bottle pulls
// a cone off your line instead of pointing it at you.

import {
  CAPSULE_RADIUS,
  CONTACT_EPS,
  PHYSICS_SUBSTEP,
  type BodyPose,
  type CollisionWorld,
  type Vec3,
  firstActorHit,
  positionClear,
  supportBelow,
  sweepXZ,
} from "../collision.js";
import { GRAVITY } from "../playerMotion.js";
import { invokedAbilityScale } from "./invokedAbility.js";
import type { NoiseEvent } from "./noise.js";
import { STEALTH_TUNING, type StealthTuning } from "./tuning.js";

/** Radius of a thrown object. A bottle, not a body. */
export const DIVERSION_RADIUS_M = 0.08;
/** Height of a thrown object's collision span. */
export const DIVERSION_HEIGHT_M = 0.16;
/** Height above the feet a throw leaves the hand. */
export const DIVERSION_RELEASE_HEIGHT_M = 1.35;

export interface DiversionObject {
  id: string;
  pos: Vec3;
  vel: Vec3;
  /** Impacts so far. */
  bounces: number;
  /** True once the object has stopped moving. */
  atRest: boolean;
  /** Ticks the object has existed, for cleanup. */
  ageTicks: number;
  /**
   * How strongly this object commands attention, from an ability that was active
   * when it was thrown. 1 is an ordinary throw.
   *
   * CAPTURED AT THE THROW AND CARRIED FOR LIFE, rather than read per tick. The
   * ability arms the throw; the object it armed keeps its pull even after the
   * window closes, which is the whole point — a chime that fell silent the moment
   * its window expired would be worse than the bottle it improved. It also makes
   * the object's behaviour a function of its own state, so a replay reproduces it
   * without needing to know what was invoked twelve seconds ago.
   */
  attentionScale: number;
}

export interface ThrowSolution {
  /** Launch position, at release height. */
  from: Vec3;
  /** Launch velocity. */
  vel: Vec3;
  /** Expected flight time in seconds, ignoring obstacles. */
  flightS: number;
  /** Horizontal distance to the aim point. */
  distanceM: number;
}

/**
 * Solve a throw from `origin` to `aim` at the tuned throw speed.
 *
 * Two launch angles reach any reachable point; the flatter one is chosen because
 * a flat throw arrives sooner and reads as a deliberate toss rather than a lob.
 * Returns null when the point is out of range, which is how the UI knows not to
 * offer the throw.
 */
export function solveThrow(
  origin: Vec3,
  aim: Vec3,
  tuning: StealthTuning = STEALTH_TUNING,
): ThrowSolution | null {
  const from: Vec3 = {
    x: origin.x,
    y: origin.y + DIVERSION_RELEASE_HEIGHT_M,
    z: origin.z,
  };
  const dx = aim.x - from.x;
  const dz = aim.z - from.z;
  const distanceM = Math.hypot(dx, dz);
  if (distanceM < 1e-6 || distanceM > tuning.throwMaxRangeM) return null;

  const dy = aim.y - from.y;
  const speed = tuning.throwSpeedMps;
  const speedSq = speed * speed;
  // Standard ballistic angle solution:
  //   discriminant = v^4 - g*(g*d^2 + 2*dy*v^2)
  const discriminant =
    speedSq * speedSq - GRAVITY * (GRAVITY * distanceM * distanceM + 2 * dy * speedSq);
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const flatAngle = Math.atan((speedSq - root) / (GRAVITY * distanceM));

  const horizontal = speed * Math.cos(flatAngle);
  if (horizontal <= 1e-6) return null;
  return {
    from,
    vel: {
      x: (dx / distanceM) * horizontal,
      y: speed * Math.sin(flatAngle),
      z: (dz / distanceM) * horizontal,
    },
    flightS: distanceM / horizontal,
    distanceM,
  };
}

export function createDiversion(
  id: string,
  solution: ThrowSolution,
  attentionScale = 1,
): DiversionObject {
  return {
    id,
    pos: { ...solution.from },
    vel: { ...solution.vel },
    bounces: 0,
    atRest: false,
    ageTicks: 0,
    attentionScale: invokedAbilityScale(attentionScale),
  };
}

/**
 * A body a thrown object can hit. Actors are not in the CollisionWorld — they must
 * not occlude sightlines or block traversal — so they are passed in and tested with
 * the shared segment-vs-capsule query.
 */
export interface DiversionActor extends BodyPose {
  id: string;
}

export interface DiversionStepResult {
  object: DiversionObject;
  /** Noise produced this tick, at the point of impact or of settling. */
  noise: NoiseEvent[];
  /** True on the tick the object comes to rest. */
  settled: boolean;
  /** The actor struck this tick, if any. */
  hitActorId: string | null;
}

/**
 * Noise from a thrown object, with the ability's attention scale applied.
 *
 * THE SCALE MULTIPLIES THE REACH AND THE HOLD, NOT THE SOURCE LOUDNESS. `intensity`
 * is documented as [0,1] and the base impact is already 0.7, so scaling it would hit
 * the ceiling at 1.43x and silently cap an ability authored at 2.5x — a number that
 * looks like it works and does not, which is the worst kind. Scaling `radiusM`
 * instead delivers the intent exactly: the chime carries further, so it is audible
 * where the bottle was not, and because audibility is `intensity * (1 - d/r)` it is
 * also LOUDER at any given distance, which is how it wins the "loudest audible noise"
 * contest in `stepWatcherAttention` without breaking the range contract.
 */
function noiseAt(
  pos: Vec3,
  intensity: number,
  kind: NoiseEvent["kind"],
  tuning: StealthTuning,
  attentionScale = 1,
): NoiseEvent {
  const scale = invokedAbilityScale(attentionScale);
  return {
    kind,
    x: pos.x,
    y: pos.y,
    z: pos.z,
    intensity,
    radiusM: intensity * tuning.noiseRadiusPerIntensityM * scale,
    attentionHoldScale: scale,
  };
}

/**
 * One fixed step of a thrown object, integrated on the shared substep so a throw
 * lands on exactly the same tick on every machine and in every replay.
 */
export function stepDiversion(
  world: CollisionWorld,
  objectIn: DiversionObject,
  dt: number,
  tuning: StealthTuning = STEALTH_TUNING,
  actors: readonly DiversionActor[] = [],
): DiversionStepResult {
  const object: DiversionObject = {
    ...objectIn,
    pos: { ...objectIn.pos },
    vel: { ...objectIn.vel },
    ageTicks: objectIn.ageTicks + 1,
  };
  const noise: NoiseEvent[] = [];
  if (object.atRest) {
    return { object, noise, settled: false, hitActorId: null };
  }

  let remaining = dt;
  let settled = false;
  let hitActorId: string | null = null;
  while (remaining > 1e-9 && !settled) {
    const h = Math.min(PHYSICS_SUBSTEP, remaining);
    remaining -= h;
    object.vel.y -= GRAVITY * h;

    // A body in the way stops the object where the body is, not where the aim
    // point was. The segment is the object's actual swept path this substep, so an
    // arcing throw can pass over a crouching guard and catch a standing one.
    if (actors.length > 0) {
      const swept: Vec3 = {
        x: object.pos.x + object.vel.x * h,
        y: object.pos.y + object.vel.y * h,
        z: object.pos.z + object.vel.z * h,
      };
      const struck = firstActorHit(
        object.pos,
        swept,
        actors,
        CAPSULE_RADIUS + DIVERSION_RADIUS_M,
      );
      if (struck) {
        const t = struck.hit.t;
        object.pos = {
          x: object.pos.x + (swept.x - object.pos.x) * t,
          y: object.pos.y + (swept.y - object.pos.y) * t,
          z: object.pos.z + (swept.z - object.pos.z) * t,
        };
        object.vel = { x: 0, y: 0, z: 0 };
        object.bounces += 1;
        object.atRest = true;
        settled = true;
        hitActorId = struck.actor.id;
        noise.push(
          noiseAt(
            object.pos,
            tuning.throwImpactIntensity,
            "DIVERSION_IMPACT",
            tuning,
            object.attentionScale,
          ),
        );
        break;
      }
    }

    const sweep = sweepXZ(
      world,
      object.pos,
      { x: object.pos.x + object.vel.x * h, z: object.pos.z + object.vel.z * h },
      DIVERSION_RADIUS_M,
      DIVERSION_HEIGHT_M,
    );
    if (sweep.hitNormals.length > 0) {
      // Wall impact: reflect off the first contact normal and lose energy.
      const [nx, nz] = sweep.hitNormals[0]!;
      const inward = object.vel.x * nx + object.vel.z * nz;
      object.vel.x = (object.vel.x - 2 * nx * inward) * tuning.throwRestitution;
      object.vel.z = (object.vel.z - 2 * nz * inward) * tuning.throwRestitution;
      object.bounces += 1;
      object.pos.x = sweep.x;
      object.pos.z = sweep.z;
      noise.push(
        noiseAt(
          object.pos,
          object.bounces === 1
            ? tuning.throwImpactIntensity
            : tuning.throwRestIntensity,
          "DIVERSION_IMPACT",
          tuning,
          object.attentionScale,
        ),
      );
    } else {
      object.pos.x = sweep.x;
      object.pos.z = sweep.z;
    }

    const nextY = object.pos.y + object.vel.y * h;
    if (object.vel.y <= 0) {
      const support = supportBelow(
        world,
        object.pos.x,
        object.pos.z,
        object.pos.y,
        CONTACT_EPS,
      );
      if (support && nextY <= support.y + CONTACT_EPS) {
        object.pos.y = support.y;
        object.bounces += 1;
        noise.push(
          noiseAt(
            object.pos,
            object.bounces === 1
              ? tuning.throwImpactIntensity
              : tuning.throwRestIntensity,
            "DIVERSION_IMPACT",
            tuning,
            object.attentionScale,
          ),
        );
        object.vel.y = -object.vel.y * tuning.throwRestitution;
        object.vel.x *= tuning.throwRestitution;
        object.vel.z *= tuning.throwRestitution;
        if (
          object.bounces > tuning.throwMaxBounces ||
          Math.hypot(object.vel.x, object.vel.y, object.vel.z) <
            tuning.throwRestSpeedMps
        ) {
          object.vel = { x: 0, y: 0, z: 0 };
          object.atRest = true;
          settled = true;
          noise.push(
            noiseAt(
              object.pos,
              tuning.throwRestIntensity,
              "DIVERSION_REST",
              tuning,
              object.attentionScale,
            ),
          );
        }
      } else {
        object.pos.y = nextY;
      }
    } else {
      object.pos.y = nextY;
    }

    if (object.pos.y < -50) {
      object.atRest = true;
      settled = true;
    }
  }

  return { object, noise, settled, hitActorId };
}

export interface DiversionInventory {
  /** Objects left to throw this mission. */
  charges: number;
  /** Objects currently in flight or at rest in the world. */
  live: DiversionObject[];
  /** Monotonic counter for stable ids. */
  thrown: number;
}

export function createDiversionInventory(
  tuning: StealthTuning = STEALTH_TUNING,
): DiversionInventory {
  return { charges: tuning.diversionChargesPerMission, live: [], thrown: 0 };
}

/**
 * Throw one object, if a charge is left and the aim point is solvable and not
 * inside geometry. Returns the same inventory when the throw is refused, so a
 * caller can treat a refusal as a no-op.
 *
 * `attentionScale` is the invoked ability's, read once here and then owned by the
 * object. Omitting it is the Level 0 throw.
 */
export function throwDiversion(
  world: CollisionWorld,
  inventory: DiversionInventory,
  origin: Vec3,
  aim: Vec3,
  tuning: StealthTuning = STEALTH_TUNING,
  attentionScale = 1,
): { inventory: DiversionInventory; object: DiversionObject | null } {
  if (inventory.charges <= 0) return { inventory, object: null };
  const solution = solveThrow(origin, aim, tuning);
  if (!solution) return { inventory, object: null };
  if (
    !positionClear(
      world,
      solution.from,
      DIVERSION_RADIUS_M,
      DIVERSION_HEIGHT_M,
    )
  ) {
    return { inventory, object: null };
  }
  const thrown = inventory.thrown + 1;
  const object = createDiversion(`diversion-${thrown}`, solution, attentionScale);
  return {
    inventory: {
      charges: inventory.charges - 1,
      live: [...inventory.live, object],
      thrown,
    },
    object,
  };
}

// ---- aiming ----------------------------------------------------------------

/** Why a throw is not on offer. */
export type ThrowRefusal =
  | "NONE"
  | "NO_CHARGES"
  | "OUT_OF_RANGE"
  | "NO_ROOM_TO_THROW";

export interface ThrowPreview {
  /** The throw would be accepted right now. */
  ok: boolean;
  refusal: ThrowRefusal;
  /** Where the object would actually come to rest. Null when it never settles. */
  restsAt: Vec3 | null;
  /** Ticks from release to the first impact. */
  impactTicks: number;
  /** Audible radius of the landing, so the aiming UI can draw the reach. */
  radiusM: number;
  /** Charges that would be left afterwards. */
  chargesAfter: number;
  /**
   * The object's position at each simulated tick, release point first.
   *
   * The ACTUAL trajectory, not a curve fit to the endpoints: the aiming UI draws
   * a line through these, so the arc bends around the same wall and stops at the
   * same body the live throw will, because it is the same `stepDiversion`. Empty
   * on a refusal, where there is no flight to draw.
   */
  samples: readonly Vec3[];
}

/**
 * Wall-clock spacing between kept trajectory samples. At 60Hz this is one per
 * tick — so the drawn arc and a live 60Hz throw coincide exactly — and at higher
 * integration rates the flight is thinned to roughly the same count, because the
 * number of points a person needs to read an arc is a function of its DURATION,
 * not of how finely the physics was stepped.
 */
const PREVIEW_SAMPLE_INTERVAL_S = 1 / 60;

/**
 * Hard ceiling on trajectory points, independent of dt. The stride already
 * bounds a settling throw to about four seconds' worth; this is the guard that
 * makes the bound total rather than "usually", so no dt — 60, 240, 1000Hz or
 * finer — can allocate the millions of points a naive per-tick record would.
 */
const PREVIEW_MAX_SAMPLES = 256;

/**
 * Where this throw would land, resolved by running the throw.
 *
 * The aim is the whole tactic — an object that cannot miss is a button, not a
 * skill — but a tactic the player cannot see the result of before committing is
 * a lottery, and three charges is far too few to learn a lottery from. This
 * closes that gap without softening the aiming: the preview is the SAME
 * `stepDiversion` the live object runs, on a copy, so what it shows is what will
 * happen, including hitting a wall short of where the player pointed.
 *
 * Deterministic and side-effect free: no state is written, no charge is spent,
 * and the simulation it runs draws no randomness.
 */
export function previewThrow(
  world: CollisionWorld,
  inventory: DiversionInventory,
  origin: Vec3,
  aim: Vec3,
  dt: number,
  tuning: StealthTuning = STEALTH_TUNING,
  actors: readonly DiversionActor[] = [],
): ThrowPreview {
  const empty: ThrowPreview = {
    ok: false,
    refusal: "NONE",
    restsAt: null,
    impactTicks: 0,
    radiusM: 0,
    chargesAfter: inventory.charges,
    samples: [],
  };
  if (inventory.charges <= 0) return { ...empty, refusal: "NO_CHARGES" };
  const solution = solveThrow(origin, aim, tuning);
  if (!solution) return { ...empty, refusal: "OUT_OF_RANGE" };
  if (
    !positionClear(world, solution.from, DIVERSION_RADIUS_M, DIVERSION_HEIGHT_M)
  ) {
    return { ...empty, refusal: "NO_ROOM_TO_THROW" };
  }

  let object = createDiversion("preview", solution);
  // The trajectory the aiming UI draws through, bounded by the flight's DURATION
  // rather than the tick rate. A sample every `stride` ticks — one per tick at
  // 60Hz, so the display and the live 60Hz throw are identical point for point,
  // and thinned at higher rates — keeps the count near flight-seconds ×60
  // whether the caller integrates at 60, 240 or 1000Hz, instead of the millions
  // a fine dt would otherwise allocate. The origin, the impact tick and the rest
  // point are always kept, so the collision and settle shape survive the thinning.
  const stride = Math.max(1, Math.round(PREVIEW_SAMPLE_INTERVAL_S / dt));
  const samples: Vec3[] = [{ ...object.pos }];
  let lastSampledTick = 0;
  const sampleAt = (tick: number, pos: Vec3): void => {
    if (tick === lastSampledTick || samples.length >= PREVIEW_MAX_SAMPLES) return;
    samples.push({ ...pos });
    lastSampledTick = tick;
  };
  let impactTicks = 0;
  // A thrown bottle settles in well under a second of flight plus a bounce or
  // two; the bound is a guard against a pathological world, not a budget.
  const limit = Math.ceil(4 * (1 / Math.max(dt, 1e-6)));
  const radiusM = tuning.throwImpactIntensity * tuning.noiseRadiusPerIntensityM;
  for (let tick = 0; tick < limit; tick++) {
    const step = stepDiversion(world, object, dt, tuning, actors);
    object = step.object;
    const here = tick + 1;
    if (impactTicks === 0 && step.noise.length > 0) impactTicks = here;
    if (object.atRest) {
      sampleAt(here, object.pos); // always end on the rest point
      return {
        ok: true,
        refusal: "NONE",
        restsAt: { ...object.pos },
        impactTicks: impactTicks || here,
        radiusM,
        chargesAfter: inventory.charges - 1,
        samples,
      };
    }
    if (impactTicks === here || here % stride === 0) sampleAt(here, object.pos);
  }
  sampleAt(limit, object.pos); // a non-settling flight still ends on its last point
  return {
    ok: true,
    refusal: "NONE",
    restsAt: null,
    impactTicks,
    radiusM,
    chargesAfter: inventory.charges - 1,
    samples,
  };
}

/** Ticks an at-rest object is kept before it stops being simulated. */
export const DIVERSION_LIFETIME_TICKS = 60 * 20;

/** Step every live object and collect their noise. */
export function stepDiversions(
  world: CollisionWorld,
  inventory: DiversionInventory,
  dt: number,
  tuning: StealthTuning = STEALTH_TUNING,
  actors: readonly DiversionActor[] = [],
): {
  inventory: DiversionInventory;
  noise: NoiseEvent[];
  hitActorIds: string[];
} {
  if (inventory.live.length === 0) {
    return { inventory, noise: [], hitActorIds: [] };
  }
  const noise: NoiseEvent[] = [];
  const hitActorIds: string[] = [];
  const live: DiversionObject[] = [];
  for (const object of inventory.live) {
    const result = stepDiversion(world, object, dt, tuning, actors);
    noise.push(...result.noise);
    if (result.hitActorId) hitActorIds.push(result.hitActorId);
    if (result.object.ageTicks < DIVERSION_LIFETIME_TICKS) {
      live.push(result.object);
    }
  }
  return { inventory: { ...inventory, live }, noise, hitActorIds };
}
