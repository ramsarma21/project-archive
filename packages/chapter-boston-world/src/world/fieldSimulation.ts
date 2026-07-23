// Deterministic fixed-step "field" clock for the stealth/chase field systems
// (watcher scans, suspicion integration, chase steering, heat decay). Per
// Production Plan D.9 / Build-Brief M0: every field outcome is a pure function
// of authored data + player state + a per-attempt seed, independent of render
// FPS. This module owns the fixed-step accumulator and the seeded kernel; it
// contains NO wall-clock reads (no performance.now(), no R3F clock). The render
// layer measures a frame delta and hands it in; the sim only sees fixed steps.
//
// Fixed-step equivalence: driving the accumulator with a 1/30, 1/60, or 1/120
// frame delta over the same elapsed wall time visits the SAME sequence of
// integer ticks, so 30/60/120 FPS produce identical simulation.

export const FIELD_TICK_HZ = 60;
export const FIELD_DT = 1 / FIELD_TICK_HZ; // seconds per fixed step

// Bounded catch-up: never simulate more than this many fixed steps in one
// frame. Prevents the "spiral of death" when a frame is very long (a hitch, or
// a backgrounded tab resuming) — excess steps are dropped, not queued.
export const MAX_CATCHUP_STEPS = 5;

// Any single frame delta above this is treated as a stall (backgrounded tab,
// breakpoint, GC pause) and clamped before entering the accumulator, so a
// multi-second gap cannot inject a huge burst of ticks.
export const MAX_FRAME_DT_S = 0.25;

export interface FieldClock {
  seed: number; // authored/projected per-attempt seed (32-bit)
  tick: number; // monotonic integer step index (starts at 0)
  accumulatorS: number; // unspent time carried to the next frame
  paused: boolean;
}

export interface FieldAdvanceOptions {
  maxCatchUpSteps?: number;
  maxFrameDtS?: number;
}

export interface FieldAdvanceResult {
  clock: FieldClock;
  steps: number; // fixed steps the caller should execute this frame
  firstTick: number; // tick index of the first step to execute
  lastTick: number; // tick index of the last step (== clock.tick after)
  dropped: number; // steps discarded by the catch-up bound
}

export function createFieldClock(seed: number): FieldClock {
  return { seed: seed >>> 0, tick: 0, accumulatorS: 0, paused: false };
}

export function pauseFieldClock(clock: FieldClock): FieldClock {
  return clock.paused ? clock : { ...clock, paused: true };
}

export function resumeFieldClock(clock: FieldClock): FieldClock {
  return clock.paused ? { ...clock, paused: false } : clock;
}

// Pure: given the render frame delta (seconds), return how many fixed steps to
// run this frame and the advanced clock. When paused/backgrounded, no steps run
// and the accumulator is frozen (time does not bank up while paused).
export function advanceFieldClock(
  clock: FieldClock,
  frameDtS: number,
  options: FieldAdvanceOptions = {},
): FieldAdvanceResult {
  const maxSteps = options.maxCatchUpSteps ?? MAX_CATCHUP_STEPS;
  const maxFrameDt = options.maxFrameDtS ?? MAX_FRAME_DT_S;

  if (clock.paused) {
    return {
      clock,
      steps: 0,
      firstTick: clock.tick + 1,
      lastTick: clock.tick,
      dropped: 0,
    };
  }

  // Clamp NaN/negative/huge deltas out before they hit the accumulator.
  const dt = Number.isFinite(frameDtS)
    ? Math.max(0, Math.min(frameDtS, maxFrameDt))
    : 0;

  let accumulator = clock.accumulatorS + dt;
  const rawSteps = Math.floor(accumulator / FIELD_DT);
  accumulator -= rawSteps * FIELD_DT;

  const steps = Math.min(rawSteps, maxSteps);
  const dropped = rawSteps - steps;
  const firstTick = clock.tick + 1;
  const tick = clock.tick + steps;

  return {
    clock: { ...clock, tick, accumulatorS: accumulator },
    steps,
    firstTick,
    lastTick: tick,
    dropped,
  };
}

// Seeded deterministic kernel value in [0,1) for (seed, tick, salt). Field
// systems that need a "random-looking" but fully reproducible choice (which way
// a scan drifts, a spot-check draw) sample this instead of Math.random(). Same
// inputs → same output on every machine, every replay. splitmix32-style finalize.
export function fieldRandom(seed: number, tick: number, salt = 0): number {
  let x = (seed ^ 0x9e3779b9) >>> 0;
  x = (x + Math.imul(tick | 0, 0x85ebca6b)) >>> 0;
  x = (x ^ Math.imul((salt | 0) + 1, 0xc2b2ae35)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// Project a runtime-supplied seed source (attempt id, day, beat, watcher id …)
// into a single stable 32-bit integer for createFieldClock(). String parts are
// folded with an FNV-1a-style hash so authored ids seed reproducibly.
export function projectFieldSeed(parts: ReadonlyArray<number | string>): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = typeof part === "number" ? String(part) : part;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    // separator so ["ab","c"] and ["a","bc"] differ
    h ^= 0x2f;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
