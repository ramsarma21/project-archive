// Hardware-independent per-tick SIM cost of the real M1 mission.
//
// The Playwright frame trace is render-bound under headless SwiftShader and
// cannot speak to frame cost on a GPU machine. But the SIMULATION is pure JS on
// the CPU, and its per-tick cost is what would starve the fixed step and drop
// steps (= slow motion) on ANY machine, GPU or not. So this drives the real
// m1Instance (Scenery=null, so no three.js) through stepMissionRuntime at a
// fixed 1/60 dt — one fixed tick per frame, never a dropped step — and times
// each tick. If the p95 tick is a small fraction of the 16.67ms 60Hz budget, the
// sim is not the thing starving the loop and any residual slow motion on real
// hardware is render/GPU-bound (which headless cannot measure); if it is large,
// the sim is a per-tick cost that would hit the owner regardless of GPU.
//
//   node --import tsx .affordwork/sim-cost.mjs [seconds] [seed]
import { performance } from "node:perf_hooks";
import { m1Instance, M1_MISSION_ID } from "../apps/web/src/chapter/m1Mission.js";
import {
  createMissionRuntime,
  stepMissionRuntime,
} from "../apps/web/src/mission/traversal.js";

const SECONDS = Number(process.argv[2]) || 180;
const SEED = Number(process.argv[3]) || 0xb057;
const FRAMES = Math.round(SECONDS * 60);

const instance = m1Instance({
  missionId: M1_MISSION_ID,
  attemptOrdinal: 1,
  seed: SEED,
  Scenery: null,
});
const runtime = createMissionRuntime({ instance, seed: SEED });

// A body actually doing something every tick: sprint forward, drifting the
// heading a little so it does not just wedge on the first wall and idle (an idle
// body understates the flow probe's cost). Never a UI surface, so flow runs.
const dt = 1 / 60;
const samples = new Float64Array(FRAMES);
let maxTick = 0;
let maxAt = -1;

// Warm up JIT (100 ticks) so the histogram is steady-state, not first-call.
for (let i = 0; i < 100; i++) {
  stepMissionRuntime(runtime, { dtS: dt, moveX: 0, moveZ: 1, sprintHeld: true, crouchHeld: false, jumpBuffered: false, reducedMotion: false, flowEnabled: true });
  if (runtime.outcome) break;
}

for (let i = 0; i < FRAMES; i++) {
  const ang = i * 0.02;
  const moveX = Math.sin(ang) * 0.4;
  const moveZ = Math.cos(ang) * 0.4 + 0.9;
  const jump = i % 90 === 0;
  const t0 = performance.now();
  const step = stepMissionRuntime(runtime, {
    dtS: dt,
    moveX,
    moveZ,
    sprintHeld: true,
    crouchHeld: false,
    jumpBuffered: jump,
    reducedMotion: false,
    flowEnabled: true,
  });
  const ms = performance.now() - t0;
  samples[i] = ms;
  if (ms > maxTick) { maxTick = ms; maxAt = i; }
  if (runtime.outcome) {
    console.log(`(outcome ${runtime.outcome.kind} at frame ${i}; continuing timing on a settled runtime)`);
  }
}

const sorted = Array.from(samples.subarray(0, FRAMES)).sort((a, b) => a - b);
const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const sum = sorted.reduce((a, b) => a + b, 0);
const budget = 1000 / 60;
console.log(`\nSIM per-tick cost over ${FRAMES} fixed ticks (${SECONDS}s of mission), one tick/frame:`);
console.log(`  mean ${(sum / FRAMES).toFixed(3)}ms  p50 ${pct(0.5).toFixed(3)}ms  p95 ${pct(0.95).toFixed(3)}ms  p99 ${pct(0.99).toFixed(3)}ms  max ${maxTick.toFixed(3)}ms (frame ${maxAt})`);
console.log(`  60Hz budget is ${budget.toFixed(2)}ms/tick; MAX_CATCHUP_STEPS=5 means a frame has 5x that (${(budget * 5).toFixed(1)}ms) before it drops.`);
console.log(`  p95 is ${((pct(0.95) / budget) * 100).toFixed(1)}% of one tick's budget; ticks over budget: ${sorted.filter((x) => x > budget).length}/${FRAMES}`);
console.log(`  final pos: ${JSON.stringify(runtime.motion.pos)} tick ${runtime.ticks} dropped ${runtime.droppedSteps}`);
