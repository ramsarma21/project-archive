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

// Any single frame delta above this is treated as a stall (backgrounded tab,
// breakpoint, GC pause) and clamped before entering the accumulator, so a
// multi-second gap cannot inject a huge burst of ticks. This is the real
// spiral-of-death guard: it bounds the *time* one frame may inject.
export const MAX_FRAME_DT_S = 0.25;

// Bounded catch-up: the most fixed steps one frame may run before the remainder
// is discarded. This bounds the *step count*; `MAX_FRAME_DT_S` already bounds the
// injected time, so the two must be sized in agreement, and here they are.
//
// WHY THIS IS DERIVED FROM THE FRAME CLAMP, AND NOT 5. The old value was 5 — an
// 83 ms window — which sat BELOW the frame clamp (0.25 s). So any render frame
// heavier than 83 ms had its excess sim ticks DISCARDED rather than run: sim time
// thrown away, which the sim advances *through* as slow motion. Late in a run,
// with the whole street and the crowd drawn, a shader-link stall or a GC pause of
// 40-120 ms lands above 83 ms routinely (MissionStage's shader-warm note and
// docs/design/Physics-Audit.md both measure it), so the body animated at the
// right rate per tick while wall-clock progress crawled — the owner's "the
// running is like slow running." That is a frame-rate symptom, not a locomotion
// one, which is why no locomotion mechanism was ever found for it.
//
// Sizing the catch-up to the number of steps the frame clamp itself admits means
// no frame the clamp lets through ever discards a tick: the clamp is the only
// thing that drops time, and only for a genuine multi-second stall. A clamped
// frame is worth exactly `floor(MAX_FRAME_DT_S / FIELD_DT)` steps, and the most a
// single admitted frame can ever want (its own steps plus the sub-step the
// accumulator carries in) rounds down to that same count — so this covers every
// admitted frame. Fixed steps are cheap analytic work — THREE-free, no render, no
// wall-clock read — so running fifteen of them costs nothing next to the frame
// that was already slow; there is no spiral of death here that the frame clamp
// does not already prevent. It also WIDENS the fps range over which fixed-step
// equivalence holds (identical ticks at 30/60/120 and now down to 4 fps), which
// is strictly better for the hashed replay/PvP paths.
export const MAX_CATCHUP_STEPS = Math.floor(MAX_FRAME_DT_S / FIELD_DT);

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
