import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createFieldClock,
  advanceFieldClock,
  pauseFieldClock,
  resumeFieldClock,
  fieldRandom,
  projectFieldSeed,
  FIELD_TICK_HZ,
  FIELD_DT,
  MAX_CATCHUP_STEPS,
  MAX_FRAME_DT_S,
} from "../fieldSimulation.js";

// Drive the clock for `seconds` of wall time at a fixed render fps, collecting
// every tick index the sim would execute.
function runAtFps(seed: number, fps: number, seconds: number): number[] {
  let clock = createFieldClock(seed);
  const dt = 1 / fps;
  const frames = Math.round(seconds * fps);
  const ticks: number[] = [];
  for (let i = 0; i < frames; i++) {
    const r = advanceFieldClock(clock, dt);
    clock = r.clock;
    for (let t = r.firstTick; t <= r.lastTick; t++) ticks.push(t);
  }
  return ticks;
}

test("30/60/120 FPS visit an identical tick sequence over the same wall time", () => {
  const at30 = runAtFps(1234, 30, 2);
  const at60 = runAtFps(1234, 60, 2);
  const at120 = runAtFps(1234, 120, 2);
  // ~2s at 60Hz -> 120 fixed steps, contiguous 1..120, identical for all fps.
  assert.equal(at60.length, FIELD_TICK_HZ * 2);
  assert.deepEqual(at30, at60);
  assert.deepEqual(at120, at60);
  assert.equal(at60[0], 1);
  assert.equal(at60[at60.length - 1], FIELD_TICK_HZ * 2);
});

test("a single 1/60 frame yields exactly one step; 1/120 yields a step every other frame", () => {
  let clock = createFieldClock(0);
  const r1 = advanceFieldClock(clock, 1 / 60);
  assert.equal(r1.steps, 1);
  assert.equal(r1.dropped, 0);

  clock = createFieldClock(0);
  const a = advanceFieldClock(clock, 1 / 120);
  assert.equal(a.steps, 0, "half a step banks, does not fire yet");
  const b = advanceFieldClock(a.clock, 1 / 120);
  assert.equal(b.steps, 1, "the second half completes one step");
});

test("accumulator carries fractional time deterministically", () => {
  let clock = createFieldClock(0);
  let total = 0;
  // 101 frames of an awkward 1/50s delta -> 2.02s wall -> floor(121.2) = 121
  // steps. 121.2 sits well clear of an integer boundary so it is robust to
  // float accumulation while still exercising fractional carry every frame.
  for (let i = 0; i < 101; i++) {
    const r = advanceFieldClock(clock, 1 / 50);
    clock = r.clock;
    total += r.steps;
  }
  assert.equal(total, 121);
  assert.equal(clock.tick, 121);
  assert.ok(clock.accumulatorS >= 0 && clock.accumulatorS < FIELD_DT);
});

test("a frame the clamp admits discards NO ticks; the cap only guards beyond the clamp", () => {
  // A 1-second hitch is clamped to MAX_FRAME_DT_S (0.25s) BEFORE the accumulator,
  // = 15 pending steps. The catch-up cap covers the clamp, so all 15 run and none
  // are discarded. This is the slow-running fix: sim time an admitted frame is
  // owed is never thrown away.
  const clamped = Math.floor(MAX_FRAME_DT_S / FIELD_DT);
  const r = advanceFieldClock(createFieldClock(0), 1.0);
  assert.equal(r.steps, clamped, "every step the clamped frame is owed runs");
  assert.equal(r.dropped, 0, "no admitted frame discards a tick");
  assert.equal(r.clock.tick, clamped);
  assert.ok(clamped <= MAX_CATCHUP_STEPS, "the cap covers the frame clamp");

  // The cap still exists and still guards: raising the frame-clamp option past
  // the cap (a caller that permits a longer burst) is the only way to drop, and
  // then the remainder is discarded, not queued.
  const uncapped = advanceFieldClock(createFieldClock(0), 10, {
    maxFrameDtS: 10,
  });
  assert.equal(uncapped.steps, MAX_CATCHUP_STEPS);
  assert.ok(uncapped.dropped > 0, "beyond the clamp the cap discards the rest");
});

test("a sustained slow renderer keeps real-time pace (the slow-running fix)", () => {
  // 8 fps = 125 ms frames, well past the old 83 ms five-step window. Over 3 wall
  // seconds the sim owes 180 ticks (3s * 60 Hz).
  const FPS = 8;
  const SECONDS = 3;
  const owed = SECONDS * FIELD_TICK_HZ;

  // The OLD behaviour, reproduced by pinning the cap back to 5: each 125 ms frame
  // wants ~7.5 steps, runs 5, discards the rest — the sim advances in slow motion.
  let old = createFieldClock(0);
  let oldDropped = 0;
  for (let i = 0; i < FPS * SECONDS; i++) {
    const r = advanceFieldClock(old, 1 / FPS, { maxCatchUpSteps: 5 });
    old = r.clock;
    oldDropped += r.dropped;
  }
  // Each 125 ms frame is owed ~7.5 steps but the old cap runs at most 5, so the
  // sim tops out at 5 * frames = 120 of the 180 owed and discards the rest.
  assert.ok(old.tick <= FPS * SECONDS * 5, `old cap ran slow: ${old.tick} of ${owed} ticks`);
  assert.ok(old.tick < owed, "old cap fell behind wall time");
  assert.ok(oldDropped >= owed - old.tick, `old cap discarded the shortfall: ${oldDropped}`);

  // The NEW default keeps pace: every owed tick runs, nothing is discarded.
  let now = createFieldClock(0);
  let nowDropped = 0;
  for (let i = 0; i < FPS * SECONDS; i++) {
    const r = advanceFieldClock(now, 1 / FPS);
    now = r.clock;
    nowDropped += r.dropped;
  }
  assert.equal(now.tick, owed, "the sim advances one tick per owed tick");
  assert.equal(nowDropped, 0, "no sim time is discarded under a slow renderer");
});

test("pause freezes ticks and does not bank time; resume continues", () => {
  let clock = createFieldClock(0);
  clock = advanceFieldClock(clock, 1 / 60).clock; // tick 1
  clock = pauseFieldClock(clock);
  const paused = advanceFieldClock(clock, 5.0);
  assert.equal(paused.steps, 0);
  assert.equal(paused.clock.tick, 1, "no ticks accrue while paused");
  assert.equal(paused.clock.accumulatorS, clock.accumulatorS, "time does not bank while paused");
  const resumed = advanceFieldClock(resumeFieldClock(paused.clock), 1 / 60);
  assert.equal(resumed.steps, 1);
  assert.equal(resumed.clock.tick, 2);
});

test("non-finite / negative frame deltas are ignored, huge deltas clamp", () => {
  const clock = createFieldClock(0);
  assert.equal(advanceFieldClock(clock, Number.NaN).steps, 0);
  assert.equal(advanceFieldClock(clock, -1).steps, 0);
  assert.equal(advanceFieldClock(clock, Infinity).steps, 0);
  const big = advanceFieldClock(clock, 60);
  // A 60s gap is clamped to MAX_FRAME_DT_S before it reaches the accumulator, so
  // it yields the clamp's worth of steps (not the whole gap) and discards nothing.
  assert.equal(big.steps, Math.floor(MAX_FRAME_DT_S / FIELD_DT), "a 60s gap cannot flood the sim");
  assert.equal(big.dropped, 0);
});

test("fieldRandom is deterministic, in [0,1), and varies by tick/salt/seed", () => {
  assert.equal(fieldRandom(42, 10, 0), fieldRandom(42, 10, 0));
  const v = fieldRandom(42, 10, 0);
  assert.ok(v >= 0 && v < 1);
  assert.notEqual(fieldRandom(42, 10, 0), fieldRandom(42, 11, 0));
  assert.notEqual(fieldRandom(42, 10, 0), fieldRandom(42, 10, 1));
  assert.notEqual(fieldRandom(42, 10, 0), fieldRandom(43, 10, 0));
  // Rough uniformity sanity: mean of a decent sample near 0.5.
  let sum = 0;
  const n = 4000;
  for (let i = 0; i < n; i++) sum += fieldRandom(7, i, 0);
  const mean = sum / n;
  assert.ok(Math.abs(mean - 0.5) < 0.05, `mean ${mean}`);
});

test("projectFieldSeed is stable, 32-bit, and order/boundary sensitive", () => {
  const s = projectFieldSeed(["RIDER_HANDBILLS", 3, "attempt-1"]);
  assert.equal(s, projectFieldSeed(["RIDER_HANDBILLS", 3, "attempt-1"]));
  assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xffffffff);
  assert.notEqual(
    projectFieldSeed(["ab", "c"]),
    projectFieldSeed(["a", "bc"]),
    "part boundaries must matter",
  );
  assert.notEqual(
    projectFieldSeed(["RIDER_HANDBILLS", 3]),
    projectFieldSeed(["RIDER_HANDBILLS", 4]),
  );
});
