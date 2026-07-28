// Which pieces of the world the body can actually get onto, asked of the reader
// that decides it.
//
// THE WHOLE POINT IS THAT NOTHING HERE KNOWS A THRESHOLD. A survey that
// re-derived "climbable means under 3.2m" would be a second copy of the verb
// ladder, and the copy would be wrong the first time anybody tuned
// `climbMaxHeightM` — which is exactly the class of defect that costs this
// project the most time. So the question is put to `probeAhead` and `rankVerbs`
// themselves: stand a body at the foot of a face, point it at the face, run it
// at sprint speed, and record whichever verb the shipped ladder hands back.
//
// If a verb comes back, the geometry is traversable, because the thing that
// answered is the thing that will fire. If the tuning moves, this moves with it,
// and no test has to notice.
//
// WHY IT IS AFFORDABLE. The world is static: blockers do not move during a run,
// so a face's answer is a constant. The survey is therefore computed once per
// region and cached against the world, and a player crossing the level pays a
// few milliseconds per new cell rather than anything per frame.
//
// WHAT IT DELIBERATELY DOES NOT ANSWER. Not "where should I go" — this has no
// idea where the objective is and no access to the route graph. Only "what can
// this body do with that". Those are different questions and conflating them is
// how an affordance cue becomes a breadcrumb trail.

import {
  CAPSULE_RADIUS,
  STAND_HEIGHT,
  type Blocker,
  type CollisionWorld,
  type Vec3,
  supportBelow,
} from "../collision.js";
import { RUN_SPEED } from "../playerMotion.js";
import { probeAhead } from "./probe.js";
import { rankVerbs, type SelectContext } from "./select.js";
import { PARKOUR_TUNING, type ParkourTuning, type TraversalVerb } from "./tuning.js";

/**
 * The verbs worth showing a player.
 *
 * Every one of these is a thing the body does TO a piece of geometry, so each
 * has an edge to draw it on. The edge verbs — RUN_OFF, HANG_DROP, JUMP_GAP — are
 * absent on purpose: they fire at a lip the player is already standing on, and a
 * highlight on the ground under your own feet teaches nothing. What a player
 * cannot see is whether the thing IN FRONT of them will take their weight.
 */
export const HOLD_VERBS: ReadonlySet<TraversalVerb> = new Set<TraversalVerb>([
  "STEP_UP",
  "VAULT",
  "CLIMB_OVER",
  "CLIMB_UP",
  "SLIDE",
]);

/** One piece of geometry the body can get onto, over or under. */
export interface AffordanceHold {
  /** The blocker the reader named. Stable, so a cue can be keyed on it. */
  readonly id: string;
  /** What the ladder offers a body running at this face. */
  readonly verb: TraversalVerb;
  /** The catchable edge, along the top of the face. */
  readonly a: Vec3;
  readonly b: Vec3;
  /** Height of that edge above the footing a body approaches it from. */
  readonly riseM: number;
  /** Outward horizontal normal of the face: the way a body faces to use it. */
  readonly outX: number;
  readonly outZ: number;
}

/**
 * Where a body has to stand for the reader to see the face at all.
 *
 * Far enough out that the capsule is not already inside the blocker — the probe
 * excludes anything the body is standing in, and a survey point pressed against
 * a crate would exclude the crate and report open ground.
 */
const APPROACH_M = CAPSULE_RADIUS + 0.55;

/**
 * How far above the top of the thing the footing search starts.
 *
 * A body approaching a 1.1m crate stands on whatever is under the crate's foot,
 * not on the crate. Searching down from just over the top finds a raised
 * approach — a roof deck, a cart bed — without finding the crate itself, which
 * is excluded by starting the search outside its footprint.
 */
const FOOTING_PROBE_RISE_M = 0.4;

/** Faces longer than this are sampled more than once along their length. */
const SAMPLE_SPAN_M = 3;
/** Never more samples than this on one face, however long it is. */
const MAX_SAMPLES = 4;

/** The context the survey asks in: a committed sprint, nothing else held. */
function surveyContext(): SelectContext {
  return {
    grounded: true,
    // Sprint, because sprint is the full envelope. The survey answers "can this
    // body do this at all", and a cue that appeared and vanished with the
    // player's current speed would teach that the wall changes rather than that
    // the approach does.
    sprintHeld: true,
    jumpBuffered: false,
    // Crouch is not held, so a low span reports SLIDE only where a sprint alone
    // would take it — the same thing the player will get by running at it.
    crouchHeld: false,
    chaining: false,
    receivingTargets: [],
    reducedMotion: false,
  };
}

/** The four top edges of a blocker's footprint, each with its outward normal. */
interface Face {
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
  readonly outX: number;
  readonly outZ: number;
}

function facesOf(blocker: Blocker): Face[] {
  const print = blocker.footprint;
  if (print && print.kind === "obb") {
    const cos = Math.cos(print.yaw);
    const sin = Math.sin(print.yaw);
    // Local corners, counter-clockwise, rotated into world space.
    const corner = (sx: number, sz: number) => ({
      x: print.cx + sx * print.halfX * cos + sz * print.halfZ * sin,
      z: print.cz - sx * print.halfX * sin + sz * print.halfZ * cos,
    });
    const p0 = corner(-1, -1);
    const p1 = corner(1, -1);
    const p2 = corner(1, 1);
    const p3 = corner(-1, 1);
    const ring = [p0, p1, p2, p3];
    const faces: Face[] = [];
    for (let index = 0; index < 4; index += 1) {
      const a = ring[index]!;
      const b = ring[(index + 1) % 4]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz) || 1;
      // Outward is the edge turned ninety degrees away from the centre.
      let outX = dz / length;
      let outZ = -dx / length;
      const midX = (a.x + b.x) / 2;
      const midZ = (a.z + b.z) / 2;
      if ((midX - print.cx) * outX + (midZ - print.cz) * outZ < 0) {
        outX = -outX;
        outZ = -outZ;
      }
      faces.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, outX, outZ });
    }
    return faces;
  }

  const { minX, maxX, minZ, maxZ } = blocker;
  return [
    { ax: minX, az: minZ, bx: maxX, bz: minZ, outX: 0, outZ: -1 },
    { ax: maxX, az: minZ, bx: maxX, bz: maxZ, outX: 1, outZ: 0 },
    { ax: maxX, az: maxZ, bx: minX, bz: maxZ, outX: 0, outZ: 1 },
    { ax: minX, az: maxZ, bx: minX, bz: minZ, outX: -1, outZ: 0 },
  ];
}

/**
 * Ask the shipped ladder what a body running at this face is offered.
 *
 * Returns the verb and the footing it was asked from, or null when the ladder
 * offers nothing worth drawing — which includes BLOCKED, and includes a face
 * whose answer turns out to be about a different blocker standing in the way.
 */
function askFace(
  world: CollisionWorld,
  blocker: Blocker,
  face: Face,
  atX: number,
  atZ: number,
  tuning: ParkourTuning,
): { verb: TraversalVerb; footY: number } | null {
  const fromX = atX + face.outX * APPROACH_M;
  const fromZ = atZ + face.outZ * APPROACH_M;
  const footing = supportBelow(
    world,
    fromX,
    fromZ,
    blocker.topY + FOOTING_PROBE_RISE_M,
  );
  if (!footing) return null;
  // Above the top already: this is somewhere to walk off, not something to get
  // onto, and the edge verbs own that case.
  if (footing.y >= blocker.topY - 0.05) return null;

  const pos: Vec3 = { x: fromX, y: footing.y, z: fromZ };
  const probe = probeAhead(
    world,
    {
      pos,
      velX: -face.outX * RUN_SPEED,
      velZ: -face.outZ * RUN_SPEED,
      yaw: Math.atan2(-face.outX, -face.outZ),
    },
    tuning,
  );
  // The reader has to be talking about THIS blocker. A crate tucked behind a
  // cart would otherwise inherit the cart's answer and light up an edge the
  // player cannot reach.
  if (probe.obstacle?.id !== blocker.id) return null;

  for (const verb of rankVerbs(probe, surveyContext(), tuning)) {
    if (HOLD_VERBS.has(verb)) return { verb, footY: footing.y };
  }
  return null;
}

/**
 * Every hold on one blocker.
 *
 * A face is sampled along its length rather than only at its midpoint, because
 * a ten-metre wall of crates is not one answer: the end by the steps is a step
 * up and the middle is a wall. Adjacent samples agreeing is the common case and
 * they are merged back into one edge.
 */
function holdsOn(
  world: CollisionWorld,
  blocker: Blocker,
  tuning: ParkourTuning,
): AffordanceHold[] {
  if (!Number.isFinite(blocker.topY)) return [];
  if (!blocker.landable) return [];

  const holds: AffordanceHold[] = [];
  for (const face of facesOf(blocker)) {
    const length = Math.hypot(face.bx - face.ax, face.bz - face.az);
    if (length < 0.2) continue;
    const samples = Math.max(
      1,
      Math.min(MAX_SAMPLES, Math.round(length / SAMPLE_SPAN_M)),
    );

    // Walk the face, opening a run when the answer starts and closing it when
    // the answer changes. One run becomes one drawn edge.
    let runVerb: TraversalVerb | null = null;
    let runFrom = 0;
    let runRise = 0;

    const close = (toFraction: number) => {
      if (!runVerb) return;
      const a: Vec3 = {
        x: face.ax + (face.bx - face.ax) * runFrom,
        y: blocker.topY,
        z: face.az + (face.bz - face.az) * runFrom,
      };
      const b: Vec3 = {
        x: face.ax + (face.bx - face.ax) * toFraction,
        y: blocker.topY,
        z: face.az + (face.bz - face.az) * toFraction,
      };
      holds.push({
        id: blocker.id,
        verb: runVerb,
        a,
        b,
        riseM: runRise,
        outX: face.outX,
        outZ: face.outZ,
      });
      runVerb = null;
    };

    for (let index = 0; index < samples; index += 1) {
      const lo = index / samples;
      const hi = (index + 1) / samples;
      const mid = (lo + hi) / 2;
      const answer = askFace(
        world,
        blocker,
        face,
        face.ax + (face.bx - face.ax) * mid,
        face.az + (face.bz - face.az) * mid,
        tuning,
      );
      if (!answer) {
        close(lo);
        continue;
      }
      if (runVerb !== answer.verb) {
        close(lo);
        runVerb = answer.verb;
        runFrom = lo;
        runRise = blocker.topY - answer.footY;
      }
    }
    close(1);
  }
  return holds;
}

// ---- the cache -------------------------------------------------------------
//
// Keyed on the world object and invalidated the way collision.ts invalidates its
// own broad phase: on the identity and the length of the blocker array. A level
// that swapped its geometry mid-run would get a fresh survey; nothing in this
// game does that, and the check costs one comparison.

const CELL_M = 16;

interface Survey {
  blockers: Blocker[];
  count: number;
  cells: Map<string, AffordanceHold[]>;
}

const surveyByWorld = new WeakMap<CollisionWorld, Survey>();

function surveyFor(world: CollisionWorld): Survey {
  const held = surveyByWorld.get(world);
  if (
    held &&
    held.blockers === world.blockers &&
    held.count === world.blockers.length
  ) {
    return held;
  }
  const fresh: Survey = {
    blockers: world.blockers,
    count: world.blockers.length,
    cells: new Map(),
  };
  surveyByWorld.set(world, fresh);
  return fresh;
}

function cellKey(cx: number, cz: number): string {
  return `${cx}:${cz}`;
}

/**
 * The holds in one cell, computed on first ask and kept.
 *
 * A blocker is surveyed by the cell its CENTRE falls in, so a thing straddling a
 * boundary is answered once rather than twice. Callers gather the cells around
 * themselves, which is why the gather radius below is padded.
 */
function cellHolds(
  world: CollisionWorld,
  survey: Survey,
  cx: number,
  cz: number,
  tuning: ParkourTuning,
): AffordanceHold[] {
  const key = cellKey(cx, cz);
  const cached = survey.cells.get(key);
  if (cached) return cached;

  const holds: AffordanceHold[] = [];
  for (const blocker of world.blockers) {
    const midX = (blocker.minX + blocker.maxX) / 2;
    const midZ = (blocker.minZ + blocker.maxZ) / 2;
    if (Math.floor(midX / CELL_M) !== cx) continue;
    if (Math.floor(midZ / CELL_M) !== cz) continue;
    holds.push(...holdsOn(world, blocker, tuning));
  }
  survey.cells.set(key, holds);
  return holds;
}

/**
 * Every hold within `radiusM` of a point, nearest first.
 *
 * The distance is measured to the nearest point of the edge rather than to its
 * middle, so a long parapet counts as near when any of it is.
 */
export function surveyHolds(
  world: CollisionWorld,
  at: Vec3,
  radiusM: number,
  tuning: ParkourTuning = PARKOUR_TUNING,
): AffordanceHold[] {
  const survey = surveyFor(world);
  // Padded by a cell, because a blocker is filed by its centre and may reach a
  // long way out of the cell it is filed in.
  const reach = radiusM + CELL_M;
  const minCX = Math.floor((at.x - reach) / CELL_M);
  const maxCX = Math.floor((at.x + reach) / CELL_M);
  const minCZ = Math.floor((at.z - reach) / CELL_M);
  const maxCZ = Math.floor((at.z + reach) / CELL_M);

  const out: { hold: AffordanceHold; distanceM: number }[] = [];
  for (let cx = minCX; cx <= maxCX; cx += 1) {
    for (let cz = minCZ; cz <= maxCZ; cz += 1) {
      for (const hold of cellHolds(world, survey, cx, cz, tuning)) {
        const distanceM = distanceToEdge(at, hold);
        if (distanceM <= radiusM) out.push({ hold, distanceM });
      }
    }
  }
  out.sort((left, right) => left.distanceM - right.distanceM);
  return out.map((entry) => entry.hold);
}

/** Distance from a point to a hold's edge, in three dimensions. */
export function distanceToEdge(at: Vec3, hold: AffordanceHold): number {
  const dx = hold.b.x - hold.a.x;
  const dz = hold.b.z - hold.a.z;
  const lengthSq = dx * dx + dz * dz;
  const t =
    lengthSq < 1e-9
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((at.x - hold.a.x) * dx + (at.z - hold.a.z) * dz) / lengthSq,
          ),
        );
  return Math.hypot(
    hold.a.x + dx * t - at.x,
    hold.a.y - at.y,
    hold.a.z + dz * t - at.z,
  );
}

/**
 * How the survey is doing, for a dev overlay and for the tests that assert the
 * cache is a cache. Never read by anything that draws.
 */
export function surveyStats(world: CollisionWorld): {
  cells: number;
  holds: number;
} {
  const survey = surveyByWorld.get(world);
  if (!survey) return { cells: 0, holds: 0 };
  let holds = 0;
  for (const list of survey.cells.values()) holds += list.length;
  return { cells: survey.cells.size, holds };
}

/**
 * The tallest thing this body can get onto, in metres, as the ladder has it.
 *
 * Published so a teaching surface can state the envelope without restating the
 * tuning — the visor's "what your body does" panel says a number, and this is
 * where the number comes from.
 */
export function reachSummary(tuning: ParkourTuning = PARKOUR_TUNING): {
  readonly stepUpM: number;
  readonly vaultM: number;
  readonly mantleM: number;
  readonly climbM: number;
  readonly standHeightM: number;
} {
  return {
    stepUpM: tuning.stepUpMaxHeightM,
    vaultM: tuning.vaultMaxHeightM,
    mantleM: tuning.mantleMaxHeightM,
    climbM: tuning.climbMaxHeightM,
    standHeightM: STAND_HEIGHT,
  };
}
