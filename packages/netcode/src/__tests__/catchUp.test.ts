// The server's per-wake catch-up bound, driven hard enough that it actually fires.
//
// WHY THIS FILE EXISTS, AND WHY EVERY OTHER TEST IN THE PACKAGE MISSES IT. The host's
// `advanceTo` converts elapsed wall time into whole 60 Hz ticks and runs at most
// `config.maxCatchUpTicks` of them per wake, dropping the remainder (host.ts). That
// bound defaults to engine-world's `MAX_CATCHUP_STEPS`, which was just raised 5 -> 15.
// But the two-client `harness.ts` advances the whole world one VIRTUAL MILLISECOND at
// a time (`step`), so on every wake the accumulator owes at most one tick and the cap
// is unreachable. So `network.test.ts`, `prediction.test.ts` and `divergence.test.ts`
// all exercise the host thousands of times and NONE of them has ever run the branch
// that drops a tick. Raising the constant could not have broken any of them, and
// lowering it back would not break them either — the exact "green test that cannot
// fail on its subject" this repo keeps paying for.
//
// The fix is to stop stepping at 1 ms. Everything here drives `advanceTo` directly
// with COARSE, realistic frame deltas — healthy ~9.5 ms, heavy-load median ~39 ms,
// p90 ~70 ms, with occasional load spikes — so the accumulator genuinely owes several
// ticks per wake and the bound is the thing under test.
//
// A DESIGN NOTE THAT THESE TESTS MEASURE BUT DO NOT ENFORCE. The mission and the
// server read the SAME constant for structurally different jobs. In the mission,
// `advanceFieldClock` first CLAMPS the frame delta to `MAX_FRAME_DT_S` (0.25 s) and 15
// is derived as `floor(MAX_FRAME_DT_S / FIELD_DT)`, so the catch-up cap is a no-op
// relative to the clamp — it exists to guarantee no admitted frame ever drops a tick.
// The server's `advanceTo` has NO such clamp: the cap is the only bound, and it is a
// direct answer to "how much combat may a stalled server fast-forward in one wake
// before dropping is fairer than bursting." host.ts argues dropping IS the correct
// failure ("a duel that catches up in a burst is a duel where somebody was shot during
// a frame that never rendered"). Those two jobs do not obviously want the same number;
// see the burst-size test below and the lane report. This file does not change the
// constant — it makes the difference visible.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIELD_TICK_HZ, type DuelSide } from "@pa/duel";
import {
  advanceTo,
  createHost,
  hostConfig,
  DEFAULT_HISTORY_WINDOW_TICKS,
  type MatchHost,
} from "../index.js";
import { MAX_CATCHUP_STEPS } from "../enginePort.js";
import { createSim, liveAuthority, reachEngagement } from "./harness.js";
import { LOCALHOST } from "../sim/profiles.js";

const TICK_MS = 1000 / FIELD_TICK_HZ;
const mint = (side: DuelSide): string => `resume-${side}`;

// ---- a seeded, realistic frame-delta stream -------------------------------

/** splitmix32-style PRNG so the whole stream is reproducible from one seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One frame delta in ms, drawn from the measured real-play distribution. Kept
 * BELOW 15 ticks (250 ms) so a healthy/heavy stream never trips the new bound; the
 * spikes are deliberately above 5 ticks (83 ms) so they DO trip the old one.
 */
function healthyDelta(next: () => number): number {
  const r = next();
  if (r < 0.55) return 8 + next() * 4; // healthy ~9.5 ms  (owes 0-1 ticks)
  if (r < 0.9) return 25 + next() * 55; // heavy load 25-80 ms (median ~39, p90 ~70)
  if (r < 0.98) return 90 + next() * 70; // load spike 90-160 ms (owes 6-10: > 5, <= 15)
  return 170 + next() * 40; // heavy spike 170-210 ms (owes 11-13: still <= 15)
}

/** deltas -> absolute wake times, which is what `advanceTo` consumes. */
function wakeTimes(deltas: readonly number[], from = 0): number[] {
  const times: number[] = [];
  let now = from;
  for (const d of deltas) {
    now += d;
    times.push(now);
  }
  return times;
}

function healthyStream(seed: number, count: number): number[] {
  const next = rng(seed);
  const deltas: number[] = [];
  for (let i = 0; i < count; i++) deltas.push(healthyDelta(next));
  return deltas;
}

/** The healthy stream, plus a sparse tail past 250 ms that drops even at 15. */
function stalledStream(seed: number, count: number): number[] {
  const next = rng(seed);
  const deltas: number[] = [];
  for (let i = 0; i < count; i++) {
    if (next() < 0.05) deltas.push(300 + next() * 400); // 300-700 ms stall (owes 19-43)
    else deltas.push(healthyDelta(next));
  }
  return deltas;
}

// ---- driving a host --------------------------------------------------------

interface DriveResult {
  readonly host: MatchHost;
  /** The largest number of ticks any single wake ran — the burst the cap bounds. */
  readonly maxBurst: number;
}

function drive(host: MatchHost, times: readonly number[]): DriveResult {
  let current = host;
  let maxBurst = 0;
  for (const t of times) {
    const before = current.stats.ticksRun;
    current = advanceTo(current, t);
    maxBurst = Math.max(maxBurst, current.stats.ticksRun - before);
  }
  return { host: current, maxBurst };
}

function hostFrom(cap: number): MatchHost {
  const { authority } = liveAuthority();
  return createHost(authority, hostConfig(mint, { maxCatchUpTicks: cap }), 0);
}

// ---------------------------------------------------------------------------

test("at 1 ms granularity the cap is unreachable — which is why nothing tested it", () => {
  // The structural blind spot, stated as a passing assertion so it cannot be argued
  // away: driven the way `harness.ts` drives everything, no wake ever owes more than
  // one tick and nothing is ever dropped, whatever the bound is.
  const fine = drive(hostFrom(MAX_CATCHUP_STEPS), wakeTimes(Array(2000).fill(1)));
  assert.equal(fine.maxBurst, 1, "a 1 ms step can never owe more than one tick");
  assert.equal(
    fine.host.stats.ticksDropped,
    0,
    "so the drop branch is unreachable at this granularity, at ANY bound",
  );
  assert.equal(fine.host.authority.phase, "LIVE");

  // The same host, driven with realistic deltas, owes many ticks per wake — the
  // regime the cap actually governs and the one production runs in.
  const coarse = drive(hostFrom(MAX_CATCHUP_STEPS), wakeTimes(healthyStream(1, 400)));
  assert.ok(
    coarse.maxBurst > 5,
    `coarse deltas must owe more than one tick to exercise the cap; owed ${coarse.maxBurst}`,
  );
  void TICK_MS;
});

test("the new bound tracks wall-clock time where the old bound dropped ticks", () => {
  // The positive claim and its negative control, on ONE stream so only the bound
  // differs. The uncapped host is the ground truth for "run every tick wall time is
  // owed"; the bounded ones are measured against it.
  const authority = liveAuthority().authority;
  const times = wakeTimes(healthyStream(20260729, 3000));

  const host = (cap: number) =>
    createHost(authority, hostConfig(mint, { maxCatchUpTicks: cap }), 0);

  const uncapped = drive(host(Number.MAX_SAFE_INTEGER), times);
  const atNew = drive(host(MAX_CATCHUP_STEPS), times);
  const atOld = drive(host(5), times);

  for (const r of [uncapped, atNew, atOld]) {
    assert.equal(r.host.authority.phase, "LIVE", "the match must not resolve mid-stream");
  }

  // This stream is a real discriminator: some wake owes more than 5 ticks (so 5 must
  // drop) but none owes more than 15 (so 15 need not). If this ever fails the stream
  // stopped testing the boundary, not the code.
  assert.ok(uncapped.maxBurst > 5, `stream never owed more than 5 (owed ${uncapped.maxBurst})`);
  assert.ok(
    uncapped.maxBurst <= MAX_CATCHUP_STEPS,
    `stream owed ${uncapped.maxBurst} > ${MAX_CATCHUP_STEPS}; use the stalled stream for that`,
  );

  // The new bound: identical to running uncapped. Not one tick dropped, wall clock
  // tracked exactly. Pinned to the constant, so lowering it back to 5 fails here.
  assert.equal(atNew.host.stats.ticksDropped, 0, "the new bound must drop nothing on this stream");
  assert.equal(
    atNew.host.stats.ticksRun,
    uncapped.host.stats.ticksRun,
    "and must run exactly the ticks an unbounded server would",
  );

  // The negative control: the SAME stream at the old bound of 5 loses ticks. Without
  // this the test above cannot tell the fixed code from the broken code.
  assert.ok(atOld.host.stats.ticksDropped > 0, "the old bound of 5 must drop under this stream");
  assert.ok(
    atOld.host.stats.ticksRun < uncapped.host.stats.ticksRun,
    "so a server at 5 falls behind wall clock — the slow-motion the raise fixed",
  );

  console.log(
    `  [catch-up] over ${times.length} coarse wakes: uncapped ran ${uncapped.host.stats.ticksRun} ` +
      `ticks (peak owed ${uncapped.maxBurst}/wake); bound=${MAX_CATCHUP_STEPS} dropped ` +
      `${atNew.host.stats.ticksDropped}; bound=5 dropped ${atOld.host.stats.ticksDropped}`,
  );
});

test("recovery is bounded: a stall bursts at most the cap, never runs away", () => {
  // The other half of the bound. On a stream WITH multi-second stalls, even the new
  // bound must drop — that is the point of a bound — and no single wake may ever run
  // more than the cap. This is also where the design tension is a measured fact: at
  // 15 a stalled server fast-forwards up to 15 ticks (250 ms) of combat in one wake a
  // client never saw; at 5 it fast-forwards at most 5 (83 ms) and drops the rest.
  const times = wakeTimes(stalledStream(424242, 2000));

  const atNew = drive(hostFrom(MAX_CATCHUP_STEPS), times);
  const atOld = drive(hostFrom(5), times);

  assert.equal(
    atNew.maxBurst,
    MAX_CATCHUP_STEPS,
    "a stall past 250 ms must burst to exactly the cap, and no further",
  );
  assert.equal(atOld.maxBurst, 5, "the old bound burst at most 5 ticks (83 ms) per wake");
  assert.ok(atNew.host.stats.ticksDropped > 0, "a multi-second stall must drop even at 15");
  assert.ok(
    atOld.host.stats.ticksDropped > atNew.host.stats.ticksDropped,
    "the lower bound drops strictly more of the same stalls",
  );
  assert.equal(atNew.host.authority.phase, "LIVE");
});

test("dividing the same wall-clock into different wakes produces the identical hash", () => {
  // The determinism property the symbolic tests only gestured at: the server's per-
  // tick result is a function of the ticks that ran and the inputs applied, and NOT
  // of how wall time was batched into wakes. Two hosts forked from one live
  // engagement, driven over the same span with no new input — one at 4 ms polling
  // (production), one in coarse bursts — must land on the same tick history hash.
  const sim = createSim(LOCALHOST, { seed: 90909 });
  reachEngagement(sim);
  const base = sim.host; // an immutable value; both forks start from it
  const t0 = sim.nowMs;
  const end = t0 + 3000;
  assert.equal(base.authority.state.phase, "ENGAGEMENT_LIVE", "must fork from live combat");

  const fineTimes: number[] = [];
  for (let t = t0 + 4; t < end; t += 4) fineTimes.push(t);
  fineTimes.push(end);

  const coarseTimes: number[] = [];
  {
    const next = rng(0xbada55);
    let now = t0;
    while (now < end) {
      now = Math.min(end, now + healthyDelta(next));
      coarseTimes.push(now);
    }
    if (coarseTimes[coarseTimes.length - 1] !== end) coarseTimes.push(end);
  }

  const fine = drive(base, fineTimes);
  const coarse = drive(base, coarseTimes);

  // Neither may drop, or the equivalence would be trivially about lost ticks rather
  // than about batching.
  assert.equal(fine.host.stats.ticksDropped, 0);
  assert.equal(coarse.host.stats.ticksDropped, 0);
  // And combat genuinely advanced, so the hash is over real work.
  assert.ok(
    fine.host.authority.state.combat.tick > base.authority.state.combat.tick,
    "the span must actually simulate combat",
  );
  assert.notEqual(fine.host.history.chain, "0000000000000000");

  assert.equal(
    coarse.host.history.chain,
    fine.host.history.chain,
    "the tick-history hash must not depend on how wall time was divided into wakes",
  );
  assert.equal(
    coarse.host.authority.state.combat.tick,
    fine.host.authority.state.combat.tick,
    "and both must have simulated the same number of combat ticks",
  );
  assert.equal(coarse.host.stats.ticksRun, fine.host.stats.ticksRun);

  // The equivalence holds BECAUSE nothing was dropped. Drive the same coarse pattern
  // at the old bound of 5 — it drops, runs fewer ticks, and lands on a different
  // hash. This is what makes the assertion above evidence and not a tautology.
  const base5: MatchHost = { ...base, config: { ...base.config, maxCatchUpTicks: 5 } };
  const coarse5 = drive(base5, coarseTimes);
  assert.ok(
    coarse5.host.stats.ticksDropped > 0,
    "the coarse stream must trip the old bound for this contrast to mean anything",
  );
  assert.notEqual(
    coarse5.host.history.chain,
    fine.host.history.chain,
    "dropping ticks changes the outcome — determinism across wakes needs the no-drop bound",
  );
});

test("the catch-up bound cannot outrun the tick-history window", () => {
  // A CONSTANT-RELATIONSHIP GUARD, labelled as such rather than dressed up as a
  // behavioural test — because there is no behaviour that could fail it without one
  // of these two numbers moving by two orders of magnitude, and pretending otherwise
  // would be the fake-green this file exists to reject.
  //
  // A single catch-up wake records at most `MAX_CATCHUP_STEPS` (15) combat ticks. The
  // history ring is trimmed by TICK INDEX to `DEFAULT_HISTORY_WINDOW_TICKS` (1400),
  // decoupled from wall clock entirely, so no wake pattern — however bursty or however
  // stalled — can add more than 15 records at once or shorten the retained window. A
  // catch-up burst is ~1/93rd of the window; a divergence baseline recorded just
  // before one is nowhere near the eviction edge. The only way catch-up could walk
  // history off its end is if the per-wake bound approached a round's worth of ticks,
  // which this guard forbids.
  assert.ok(
    MAX_CATCHUP_STEPS * 4 < DEFAULT_HISTORY_WINDOW_TICKS,
    `a catch-up burst (${MAX_CATCHUP_STEPS}) must stay far inside the history window ` +
      `(${DEFAULT_HISTORY_WINDOW_TICKS}); if these approach each other, catch-up can evict ` +
      `the baseline a divergence needs`,
  );
});

test("client prediction never reads the catch-up bound, so raising it adds no rubber-band", () => {
  // The "no new rubber-band in PvP" claim, as a test rather than an argument. The
  // rubber-band a player feels is the reconciliation correction, and its size is set
  // by how far a client's prediction can be from the server's truth for a given tick.
  // Prediction replays a client's own unacknowledged inputs (an RTT-bounded window)
  // onto the last confirmed baseline; it takes no catch-up parameter and reads no
  // server-side stall bound. So the correction is a function of RTT and input timing,
  // never of `MAX_CATCHUP_STEPS`.
  //
  // The MECHANISM is checkable directly: the client path must not reference the
  // constant. (Its value-invariance — that the per-tick state a client reconciles
  // against is identical however the server batched its wakes — is exactly the
  // determinism proven by the test above, and follows from it.)
  const here = dirname(fileURLToPath(import.meta.url));
  const clientFiles = ["prediction.ts", "client.ts", "interpolation.ts"];
  for (const file of clientFiles) {
    const source = readFileSync(join(here, "../client", file), "utf8");
    assert.doesNotMatch(
      source,
      /MAX_CATCHUP|maxCatchUp/,
      `client/${file} references the server catch-up bound; prediction must stay ` +
        `RTT-bounded and independent of it, or raising the bound could grow corrections`,
    );
  }
});
