// The server's per-wake catch-up bound, driven hard enough that it actually fires,
// and pinned so it cannot be moved again by an edit aimed at something else.
//
// WHY THIS FILE EXISTS, AND WHY EVERY OTHER TEST IN THE PACKAGE MISSES IT. The host's
// `advanceTo` converts elapsed wall time into whole 60 Hz ticks and runs at most
// `config.maxCatchUpTicks` of them per wake, dropping the remainder (host.ts). But the
// two-client `harness.ts` advances the whole world one VIRTUAL MILLISECOND at a time
// (`step`), so on every wake at most one tick is due and the cap is unreachable. So
// `network.test.ts`, `prediction.test.ts` and `divergence.test.ts` all exercise the
// host thousands of times and NONE of them has ever run the branch that drops a tick.
// Moving the bound in either direction could not have broken any of them — the exact
// "green test that cannot fail on its subject" this repo keeps paying for.
//
// The fix is to stop stepping at 1 ms. Everything here drives `advanceTo` directly
// with COARSE, realistic frame deltas — healthy ~9.5 ms, heavy-load median ~39 ms,
// p90 ~70 ms, with occasional load spikes — so several ticks are genuinely due per
// wake and the bound is the thing under test.
//
// THE TWO BOUNDS, AND WHY THIS FILE NOW ENFORCES THE DIFFERENCE RATHER THAN MERELY
// MEASURING IT. The mission and the server used to read the SAME constant for
// structurally different jobs. In the mission, `advanceFieldClock` first CLAMPS the
// frame delta to `MAX_FRAME_DT_S` (0.25 s) and its bound is derived as
// `floor(MAX_FRAME_DT_S / FIELD_DT)` = 15, so there the cap is a no-op relative to the
// clamp: it guarantees no admitted frame ever drops a tick, and it is tuned for slow
// RENDER frames. The server's `advanceTo` has NO such clamp, so the cap is the only
// bound and answers a different question — how much combat may a stalled server
// fast-forward in one wake that no client rendered, before dropping is fairer than
// bursting. host.ts argues dropping IS the correct failure ("a duel that catches up in
// a burst is a duel where somebody was shot during a frame that never rendered").
//
// Sharing one symbol meant that raising the engine constant 5 -> 15 for the mission
// silently tripled the server's unrendered burst, 83 ms -> 250 ms, as a side effect
// nobody chose. The server now owns `SERVER_MAX_CATCHUP_TICKS`, back at 5, and the
// last test in this file fails if the two are ever re-coupled or if the server's bound
// is raised on its own. A comment would not have survived that edit; this does.

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
  SERVER_MAX_CATCHUP_TICKS,
  type MatchHost,
} from "../index.js";
// The MISSION's bound, imported from engine-world directly and ONLY so the tests below
// can contrast the two and assert they are not the same number. Production netcode no
// longer reads it — `enginePort.ts` deliberately stopped re-exporting it — and nothing
// outside this file should import it again.
import { MAX_CATCHUP_STEPS } from "@pa/engine-world/fieldSimulation";
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
 * One frame delta in ms, drawn from the measured real-play distribution, and built to
 * DISCRIMINATE between the two bounds. Every delta stays below 15 ticks (250 ms) so a
 * mission-sized bound never drops on this stream, while the spikes are deliberately
 * above 5 ticks (83 ms) so the server's bound does. A stream that lost either property
 * would stop testing the boundary, which is why both are asserted below rather than
 * trusted.
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

/**
 * A coarse delta that still fits INSIDE the server's bound: 20-75 ms, so a wake owes
 * between 1 and 5 ticks and never more than `SERVER_MAX_CATCHUP_TICKS`. Genuinely
 * batched — many ticks per wake, which is the whole point — but chosen so the shipped
 * production bound does not drop, because "batching does not change the result" and
 * "dropping changes the result" are two different claims and the determinism test
 * below needs to make them separately.
 */
function withinServerBoundDelta(next: () => number): number {
  // Worst case owed is floor((TICK_MS + 75) / TICK_MS) = 5, the bound exactly.
  return 20 + next() * 55;
}

/** The healthy stream, plus a sparse tail past 250 ms that drops at either bound. */
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

/**
 * A host wired the way production wires one: `hostConfig` with NO override, so the cap
 * is whatever the shipped default happens to be. Every other helper here passes an
 * explicit cap, which is right for comparing two bounds and useless for noticing that
 * the default moved — so the burst measurements below use THIS one.
 */
function hostAtShippedDefault(): MatchHost {
  const { authority } = liveAuthority();
  return createHost(authority, hostConfig(mint), 0);
}

// ---------------------------------------------------------------------------

test("at 1 ms granularity the cap is unreachable — which is why nothing tested it", () => {
  // The structural blind spot, stated as a passing assertion so it cannot be argued
  // away: driven the way `harness.ts` drives everything, no wake ever owes more than
  // one tick and nothing is ever dropped, whatever the bound is. Asserted at BOTH
  // bounds and at the shipped default, so "at ANY bound" is measured, not claimed.
  const oneMs = wakeTimes(Array(2000).fill(1));
  for (const [label, host] of [
    ["server", hostFrom(SERVER_MAX_CATCHUP_TICKS)],
    ["mission-sized", hostFrom(MAX_CATCHUP_STEPS)],
    ["shipped default", hostAtShippedDefault()],
  ] as const) {
    const fine = drive(host, oneMs);
    assert.equal(fine.maxBurst, 1, `${label}: a 1 ms step can never owe more than one tick`);
    assert.equal(
      fine.host.stats.ticksDropped,
      0,
      `${label}: so the drop branch is unreachable at this granularity, at ANY bound`,
    );
    assert.equal(fine.host.authority.phase, "LIVE");
  }

  // Realistic deltas owe many ticks per wake — the regime the cap actually governs and
  // the one production runs in. Measured on an UNBOUNDED host, because this is a claim
  // about the stream rather than about any cap: a bounded host would report its own cap
  // back and the assertion would be about nothing.
  const coarse = drive(hostFrom(Number.MAX_SAFE_INTEGER), wakeTimes(healthyStream(1, 400)));
  assert.ok(
    coarse.maxBurst > SERVER_MAX_CATCHUP_TICKS,
    `coarse deltas must owe more than the server bound to exercise it; owed ${coarse.maxBurst}`,
  );
});

test("what each bound costs on one stream: the mission's tracks wall clock, the server's drops", () => {
  // Both bounds and their common ground truth, on ONE stream so only the bound differs.
  // The uncapped host is the ground truth for "run every tick wall time owes"; the two
  // bounded ones are measured against it. This is the whole trade-off in one place:
  // tracking wall clock and refusing to fast-forward unseen combat are not compatible,
  // and the mission and the server pick opposite sides of it ON PURPOSE.
  const authority = liveAuthority().authority;
  const times = wakeTimes(healthyStream(20260729, 3000));

  const host = (cap: number) =>
    createHost(authority, hostConfig(mint, { maxCatchUpTicks: cap }), 0);

  const uncapped = drive(host(Number.MAX_SAFE_INTEGER), times);
  const atMission = drive(host(MAX_CATCHUP_STEPS), times);
  const atServer = drive(host(SERVER_MAX_CATCHUP_TICKS), times);

  for (const r of [uncapped, atMission, atServer]) {
    assert.equal(r.host.authority.phase, "LIVE", "the match must not resolve mid-stream");
  }

  // This stream is a real discriminator: some wake owes more than the server's bound
  // (so it must drop) but none owes more than the mission's (so it need not). If either
  // fails, the stream stopped testing the boundary — that is a broken test, not a
  // broken bound.
  assert.ok(
    uncapped.maxBurst > SERVER_MAX_CATCHUP_TICKS,
    `stream never owed more than ${SERVER_MAX_CATCHUP_TICKS} (owed ${uncapped.maxBurst})`,
  );
  assert.ok(
    uncapped.maxBurst <= MAX_CATCHUP_STEPS,
    `stream owed ${uncapped.maxBurst} > ${MAX_CATCHUP_STEPS}; use the stalled stream for that`,
  );

  // A bound sized to the mission's frame clamp is identical to running uncapped: not one
  // tick dropped, wall clock tracked exactly. That is the property the mission needs,
  // because for a renderer a dropped tick IS the slow-running defect.
  assert.equal(
    atMission.host.stats.ticksDropped,
    0,
    "a mission-sized bound must drop nothing on this stream",
  );
  assert.equal(
    atMission.host.stats.ticksRun,
    uncapped.host.stats.ticksRun,
    "and must run exactly the ticks an unbounded server would",
  );

  // The server's bound drops on the same stream, and that is the CHOSEN behaviour rather
  // than a defect: a server that fell behind wall clock has stretched the round a little,
  // whereas a server that caught up in a burst has resolved shots in a window neither
  // client rendered. host.ts picks the first. This assertion is also what keeps the pair
  // above honest — without it they cannot tell one bound from the other.
  assert.ok(
    atServer.host.stats.ticksDropped > 0,
    "the server bound must drop under this stream, or it is not bounding anything",
  );
  assert.ok(
    atServer.host.stats.ticksRun < uncapped.host.stats.ticksRun,
    "so a server at its own bound trades wall-clock tracking for never bursting",
  );

  console.log(
    `  [catch-up] over ${times.length} coarse wakes: uncapped ran ${uncapped.host.stats.ticksRun} ` +
      `ticks (peak owed ${uncapped.maxBurst}/wake); mission bound=${MAX_CATCHUP_STEPS} dropped ` +
      `${atMission.host.stats.ticksDropped}; server bound=${SERVER_MAX_CATCHUP_TICKS} dropped ` +
      `${atServer.host.stats.ticksDropped}`,
  );
});

test("recovery is bounded: a stall bursts at most the cap, never runs away", () => {
  // The other half of the bound. On a stream WITH multi-second stalls, EVERY bound must
  // drop — that is the point of a bound — and no single wake may ever run more than the
  // cap. This is also where the design tension is a measured fact rather than an
  // argument: at 15 a stalled server fast-forwards up to 250 ms of combat in one wake a
  // client never saw; at 5 it fast-forwards at most 83 ms and drops the rest.
  const times = wakeTimes(stalledStream(424242, 2000));

  const atMission = drive(hostFrom(MAX_CATCHUP_STEPS), times);
  const atServer = drive(hostFrom(SERVER_MAX_CATCHUP_TICKS), times);
  // Wired the way production wires it, so this measures what actually ships.
  const shipped = drive(hostAtShippedDefault(), times);

  assert.equal(
    atMission.maxBurst,
    MAX_CATCHUP_STEPS,
    "a stall past 250 ms must burst to exactly the cap, and no further",
  );
  assert.equal(
    atServer.maxBurst,
    SERVER_MAX_CATCHUP_TICKS,
    "the server bound must burst at most its own ticks per wake",
  );
  assert.ok(
    atMission.host.stats.ticksDropped > 0,
    "a multi-second stall must drop even at the mission-sized bound",
  );
  assert.ok(
    atServer.host.stats.ticksDropped > atMission.host.stats.ticksDropped,
    "the lower bound drops strictly more of the same stalls",
  );
  assert.equal(atMission.host.authority.phase, "LIVE");

  // THE RESTORATION, MEASURED. The shipped server must burst exactly what it burst
  // before the engine constant was raised — 5 ticks, 83 ms of combat no client rendered
  // — and strictly less than the mission-sized bound would. Measured on a real stalled
  // stream through `advanceTo`, not read off a constant.
  assert.equal(
    shipped.maxBurst,
    5,
    "the shipped server must fast-forward at most 5 ticks in one wake, as it did before " +
      "the mission's engine constant was raised",
  );
  assert.ok(
    shipped.maxBurst < atMission.maxBurst,
    `the shipped burst (${shipped.maxBurst}) must stay below the mission-sized bound ` +
      `(${atMission.maxBurst}); if these are equal the two bounds have been re-coupled`,
  );
  assert.ok(
    shipped.maxBurst * TICK_MS < 100,
    `unrendered combat per wake must stay under 100 ms; got ${shipped.maxBurst * TICK_MS}`,
  );

  console.log(
    `  [catch-up] worst single wake: shipped server ${shipped.maxBurst} ticks ` +
      `(${Math.round(shipped.maxBurst * TICK_MS)} ms of unrendered combat); a mission-sized ` +
      `bound would have run ${atMission.maxBurst} (${Math.round(atMission.maxBurst * TICK_MS)} ms)`,
  );
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

  const streamFrom = (seed: number, delta: (next: () => number) => number): number[] => {
    const next = rng(seed);
    const times: number[] = [];
    let now = t0;
    while (now < end) {
      now = Math.min(end, now + delta(next));
      times.push(now);
    }
    if (times[times.length - 1] !== end) times.push(end);
    return times;
  };

  // Coarse but inside the server's bound, and coarse enough to exceed it. `base` is the
  // shipped host, so the first is the equivalence claim at the bound that actually runs
  // in production and the second is what happens past it.
  const withinTimes = streamFrom(0xbada55, withinServerBoundDelta);
  const beyondTimes = streamFrom(0xbada55, healthyDelta);

  const fine = drive(base, fineTimes);
  const within = drive(base, withinTimes);

  // Neither may drop, or the equivalence would be trivially about lost ticks rather
  // than about batching.
  assert.equal(fine.host.stats.ticksDropped, 0);
  assert.equal(within.host.stats.ticksDropped, 0);
  // And the coarse stream must really be batching several ticks into one wake, or
  // "batching is irrelevant" is being proven about wakes that were never batched.
  assert.ok(
    within.maxBurst > 1 && within.maxBurst <= SERVER_MAX_CATCHUP_TICKS,
    `the within-bound stream must batch 2..${SERVER_MAX_CATCHUP_TICKS} ticks per wake; ` +
      `peaked at ${within.maxBurst}`,
  );
  // And combat genuinely advanced, so the hash is over real work.
  assert.ok(
    fine.host.authority.state.combat.tick > base.authority.state.combat.tick,
    "the span must actually simulate combat",
  );
  assert.notEqual(fine.host.history.chain, "0000000000000000");

  assert.equal(
    within.host.history.chain,
    fine.host.history.chain,
    "the tick-history hash must not depend on how wall time was divided into wakes",
  );
  assert.equal(
    within.host.authority.state.combat.tick,
    fine.host.authority.state.combat.tick,
    "and both must have simulated the same number of combat ticks",
  );
  assert.equal(within.host.stats.ticksRun, fine.host.stats.ticksRun);

  // The equivalence holds BECAUSE nothing was dropped. Drive a stream that DOES exceed
  // the shipped bound — it drops, runs fewer ticks, and lands on a different hash. This
  // is what makes the assertions above evidence and not a tautology.
  const beyondShipped = drive(base, beyondTimes);
  assert.ok(
    beyondShipped.host.stats.ticksDropped > 0,
    "the beyond-bound stream must trip the shipped bound for this contrast to mean anything",
  );
  assert.notEqual(
    beyondShipped.host.history.chain,
    fine.host.history.chain,
    "dropping ticks changes the outcome — determinism across wakes needs a no-drop bound",
  );

  // And the second control, which isolates the CAUSE: the very same beyond-bound wake
  // pattern, run at the mission-sized bound, drops nothing and lands back on the fine
  // hash. So the divergence above is caused by dropping and not by the batching — the
  // batching is provably irrelevant at any bound that admits it.
  const atMission: MatchHost = {
    ...base,
    config: { ...base.config, maxCatchUpTicks: MAX_CATCHUP_STEPS },
  };
  const beyondAtMission = drive(atMission, beyondTimes);
  assert.ok(
    beyondAtMission.maxBurst > SERVER_MAX_CATCHUP_TICKS,
    `the beyond-bound stream must owe more than the server bound; owed ${beyondAtMission.maxBurst}`,
  );
  assert.equal(beyondAtMission.host.stats.ticksDropped, 0);
  assert.equal(
    beyondAtMission.host.history.chain,
    fine.host.history.chain,
    "an admitted burst reaches the same hash as fine polling; only DROPPING changes it",
  );
});

test("the catch-up bound cannot outrun the tick-history window", () => {
  // A CONSTANT-RELATIONSHIP GUARD, labelled as such rather than dressed up as a
  // behavioural test — because there is no behaviour that could fail it without one
  // of these two numbers moving by two orders of magnitude, and pretending otherwise
  // would be the fake-green this file exists to reject.
  //
  // A single catch-up wake records at most `SERVER_MAX_CATCHUP_TICKS` (5) combat ticks.
  // The history ring is trimmed by TICK INDEX to `DEFAULT_HISTORY_WINDOW_TICKS` (1400),
  // decoupled from wall clock entirely, so no wake pattern — however bursty or however
  // stalled — can add more than that many records at once or shorten the retained
  // window. A catch-up burst is ~1/280th of the window; a divergence baseline recorded
  // just before one is nowhere near the eviction edge. The only way catch-up could walk
  // history off its end is if the per-wake bound approached a round's worth of ticks,
  // which this guard forbids.
  assert.ok(
    SERVER_MAX_CATCHUP_TICKS * 4 < DEFAULT_HISTORY_WINDOW_TICKS,
    `a catch-up burst (${SERVER_MAX_CATCHUP_TICKS}) must stay far inside the history window ` +
      `(${DEFAULT_HISTORY_WINDOW_TICKS}); if these approach each other, catch-up can evict ` +
      `the baseline a divergence needs`,
  );
  // Held against the mission's larger bound as well, so that if the two are ever
  // re-coupled the relationship still holds rather than silently becoming untested.
  assert.ok(
    MAX_CATCHUP_STEPS * 4 < DEFAULT_HISTORY_WINDOW_TICKS,
    `even a mission-sized burst (${MAX_CATCHUP_STEPS}) must stay far inside the history ` +
      `window (${DEFAULT_HISTORY_WINDOW_TICKS})`,
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

test("the server's bound is its own, and re-coupling it to the mission's fails here", () => {
  // THE REASON THIS FILE EXISTS. On 29 Jul the PvP server's tolerance for fast-forwarding
  // unrendered combat tripled — 83 ms to 250 ms — because a constant was retuned for the
  // MISSION and a second subsystem was reading the same symbol. Nothing caught it: no test
  // in this package could even reach the drop branch. This test is what catches it next
  // time. Five independent routes back to coupling, each closed, so that whichever one an
  // editor takes, a suite goes red and says why.

  // 1. The shipped default must be the SERVER's constant. Writing `maxCatchUpTicks:
  //    MAX_CATCHUP_STEPS` back into `hostConfig` fails right here.
  assert.equal(
    hostConfig(mint).maxCatchUpTicks,
    SERVER_MAX_CATCHUP_TICKS,
    "hostConfig must default the catch-up bound to the server's own constant; if this " +
      "fails, it has been re-pointed at some other subsystem's number",
  );

  // 2. The server's bound must not have been raised on its own either. Five ticks is 83 ms
  //    of combat a stalled server may resolve in a wake no client rendered. Moving that is
  //    a PvP FAIRNESS decision — make it deliberately, not to get another test green.
  assert.equal(
    SERVER_MAX_CATCHUP_TICKS,
    5,
    "the server's stall-recovery bound changed. It sets how much unrendered combat a " +
      "stalled server may resolve in one wake, which is a fairness decision about PvP; " +
      "host.ts argues dropping is fairer than bursting past it",
  );

  // 3. It must not be the mission's number. Should the mission's derived bound ever
  //    legitimately become 5, this fires — which is correct, not a nuisance: it forces
  //    somebody to re-confirm that the server still wants its own answer.
  assert.notEqual(
    SERVER_MAX_CATCHUP_TICKS,
    MAX_CATCHUP_STEPS,
    `the server bound (${SERVER_MAX_CATCHUP_TICKS}) is now the mission's ` +
      `(${MAX_CATCHUP_STEPS}). The mission derives its bound from a frame-delta clamp that ` +
      `\`advanceTo\` does not have, so the two answer different questions and must move ` +
      `independently`,
  );

  // 4. Structurally, the server must not READ the mission's constant at all, whatever it
  //    then does with it — that closes aliasing and indirection. Comments are stripped
  //    first, deliberately: both files discuss `MAX_CATCHUP_STEPS` in prose to explain why
  //    they do NOT use it, and a guard that forbade the explanation would get the
  //    explanation deleted instead of the coupling.
  const codeOnly = (path: string): string =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), path), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");

  for (const file of ["../server/host.ts", "../enginePort.ts"] as const) {
    assert.doesNotMatch(
      codeOnly(file),
      /MAX_CATCHUP_STEPS/,
      `${file} reads the mission's MAX_CATCHUP_STEPS in live code. The server owns ` +
        `SERVER_MAX_CATCHUP_TICKS precisely so that retuning the mission for slow render ` +
        `frames cannot move PvP fairness; binding them again restores the 29 Jul defect`,
    );
  }

  // 5. And behaviourally, so none of this rests on reading constants: the shipped host,
  //    driven through real stalls, must never fast-forward past its bound.
  const shipped = drive(hostAtShippedDefault(), wakeTimes(stalledStream(11, 800)));
  assert.ok(
    shipped.host.stats.ticksDropped > 0,
    "the stalled stream must actually make the shipped host drop, or this measures nothing",
  );
  assert.equal(
    shipped.maxBurst,
    SERVER_MAX_CATCHUP_TICKS,
    `the shipped host burst ${shipped.maxBurst} ticks in one wake against a bound of ` +
      `${SERVER_MAX_CATCHUP_TICKS}`,
  );
});
