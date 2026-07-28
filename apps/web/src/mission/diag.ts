// Dev-only movement instrumentation for the running mission.
//
// This exists to satisfy one demand: EVERY claim about the physics must rest on
// the running app under real input, not the replay harness or the existing
// invariants (which reported 0/44 climb-throughs while the owner phased). So the
// running client keeps its own black box — three rings, filled inside the real
// fixed step and the real render loop, and read back by a Playwright driver
// through `window.__diag`.
//
//   frames   — per RENDER frame: wall delta, time spent in stepMissionRuntime
//              (sim cost, isolated from GPU cost), fixed steps run, fixed steps
//              DROPPED by the catch-up bound, and the resulting time scale. This
//              is the honest read on the "random slowdowns": a dropped step is
//              sim time discarded, i.e. slow motion, and separating sim cost from
//              frame cost says whether the cause is the solver or the renderer.
//
//   embeds   — per fixed TICK on which the capsule ended inside a solid hull,
//              measured with NO ignore set at all (stricter than the shipped
//              invariant, which excludes the low kerbs the grounded solver steps
//              through). Unthrottled and positioned, so a climb-through in real
//              play is caught with its collider, depth, tick and verb — the thing
//              the throttled one-line dev assertion could hide.
//
//   authored — per fixed TICK of an authored transition (climb/vault/duck): the
//              raw spline sample the animation WANTS, the solver position the
//              body actually took, and the distance between them. That distance
//              is the solver fighting the animation made numeric — the mechanism
//              behind both the stutter and, when it is large every tick, the cost.
//
// Everything here is gated on the dev build and is pure telemetry: it reads the
// same state the sim already produced and never feeds anything back. Stripped
// from production by the `DIAG_ENABLED` guard, exactly like the non-penetration
// assertion it sits beside.

import {
  CAPSULE_RADIUS,
  capsuleEmbeddedIn,
  lowStepIds,
  sampleAuthoredPath,
  STEP_UP,
  type CollisionWorld,
  type MotionState,
} from "@pa/engine-world";

function diagEnabled(): boolean {
  try {
    return Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
}

export const DIAG_ENABLED = diagEnabled();

export interface FrameSample {
  tick: number;
  /** Wall-clock frame delta handed to the sim, in ms. */
  deltaMs: number;
  /** Time spent inside stepMissionRuntime this frame, in ms — the sim cost. */
  simMs: number;
  /** Fixed steps actually executed this frame. */
  steps: number;
  /** Cumulative fixed steps discarded by the catch-up bound. */
  droppedTotal: number;
  /** Fixed steps discarded THIS frame (delta of droppedTotal). */
  droppedThisFrame: number;
  /** Reflex time scale applied to the NEXT frame's delta. 1 is real time. */
  timeScale: number;
  /** Horizontal speed at the end of the frame, m/s. */
  speed: number;
  verb: string;
  phase: string;
}

export interface EmbedSample {
  tick: number;
  verb: string;
  phase: string;
  pos: { x: number; y: number; z: number };
  /** Strictest read: solid hulls the capsule is inside with NO ignore at all. */
  strict: { id: string; depthM: number }[];
  /** The shipped invariant's read (low kerbs excluded), for comparison. */
  invariant: { id: string; depthM: number }[];
  deckId: string | null;
}

export interface AuthoredSample {
  tick: number;
  verb: string;
  phase: string;
  t: number;
  /** The raw spline point the animation wants this tick. */
  sample: { x: number; y: number; z: number };
  /** Where the collision solver actually left the body. */
  solved: { x: number; y: number; z: number };
  /** Horizontal distance the solver moved the body off the spline, m. */
  divergenceM: number;
  /** Deepest hull the solved position is inside (no ignore), or null. */
  deepestEmbedM: number;
  deepestEmbedId: string | null;
}

interface DiagRings {
  frames: FrameSample[];
  embeds: EmbedSample[];
  authored: AuthoredSample[];
  reset(): void;
}

const FRAME_CAP = 20000;
const EMBED_CAP = 4000;
const AUTHORED_CAP = 20000;

function makeRings(): DiagRings {
  return {
    frames: [],
    embeds: [],
    authored: [],
    reset() {
      this.frames.length = 0;
      this.embeds.length = 0;
      this.authored.length = 0;
    },
  };
}

/** The shared rings, exposed on window for a Playwright driver to read. */
export function diagRings(): DiagRings | null {
  if (!DIAG_ENABLED) return null;
  const holder = globalThis as unknown as { __diag?: DiagRings };
  if (!holder.__diag) holder.__diag = makeRings();
  return holder.__diag;
}

function push<T>(ring: T[], sample: T, cap: number): void {
  ring.push(sample);
  if (ring.length > cap) ring.shift();
}

export function pushFrame(sample: FrameSample): void {
  const rings = diagRings();
  if (rings) push(rings.frames, sample, FRAME_CAP);
}

/**
 * Record the non-penetration state of a settled fixed tick, both the strict
 * (no-ignore) read and the shipped invariant's. Called every tick in dev; only
 * a genuine embed or deck cut is stored, so a clean run leaves the ring empty.
 */
export function recordTick(
  world: CollisionWorld,
  motion: MotionState,
  verb: string,
  tick: number,
  invariant: { embeds: { id: string; depthM: number }[]; deckId: string | null },
): void {
  const rings = diagRings();
  if (!rings) return;
  const strict = capsuleEmbeddedIn(
    world,
    motion.pos,
    CAPSULE_RADIUS,
    motion.capsuleHeight,
  ).map((e) => ({ id: e.id, depthM: e.depthM }));
  if (strict.length === 0 && invariant.embeds.length === 0 && invariant.deckId === null) {
    // Nothing inside anything — but still record an authored sample below.
  } else {
    push(
      rings.embeds,
      {
        tick,
        verb,
        phase: motion.phase,
        pos: { ...motion.pos },
        strict,
        invariant: invariant.embeds,
        deckId: invariant.deckId,
      },
      EMBED_CAP,
    );
  }

  // Authored transition: measure the solver-vs-spline divergence.
  const action = motion.action;
  if (action) {
    const t = Math.min(1, action.elapsedMs / action.durationMs);
    const sample = sampleAuthoredPath(action, t);
    const divergenceM = Math.hypot(sample.x - motion.pos.x, sample.z - motion.pos.z);
    // Deepest hull the solved body is inside, ignoring only the low kerbs the
    // grounded solver legitimately steps through — the same set the invariant
    // exempts, so a climb that keeps the body inside its OWN climbed surface
    // still shows here (that surface is not a low kerb).
    const lowIgnore = new Set<string>();
    const low = lowStepIds(world, motion.pos.x, motion.pos.z, CAPSULE_RADIUS, motion.pos.y, STEP_UP);
    if (low) for (const id of low) lowIgnore.add(id);
    const embeds = capsuleEmbeddedIn(
      world,
      motion.pos,
      CAPSULE_RADIUS,
      motion.capsuleHeight,
      lowIgnore,
    );
    let deepestEmbedM = 0;
    let deepestEmbedId: string | null = null;
    for (const e of embeds) {
      if (e.depthM > deepestEmbedM) {
        deepestEmbedM = e.depthM;
        deepestEmbedId = e.id;
      }
    }
    push(
      rings.authored,
      {
        tick,
        verb,
        phase: motion.phase,
        t,
        sample: { x: sample.x, y: sample.y, z: sample.z },
        solved: { ...motion.pos },
        divergenceM,
        deepestEmbedM,
        deepestEmbedId,
      },
      AUTHORED_CAP,
    );
  }
}
