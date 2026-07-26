// Measured behaviour on a bad network, which is the only measurement that counts.
//
// THE TRAP THIS FILE EXISTS TO AVOID. Tomorrow's test is two accounts in two tabs on
// one laptop. Zero latency, one clock, one CPU, one JavaScript engine. Every bug this
// package is about is invisible there and the result will feel perfect. The real
// deployment is thirty laptops behind one access point.
//
// So every number below is quoted at LOCALHOST *and* at the school profiles, and the
// LOCALHOST column is included specifically so the comparison is impossible to miss.
//
// WHAT IS BEING MEASURED. The reconciliation error: the distance between where a
// client had already drawn its own body for a tick and where the server later says
// that tick actually was. That is what a player experiences as a snap. It is NOT
// "client position now versus server position now" — a correct prediction is a round
// trip ahead of the server, so that number punishes a healthy client and would send
// you optimising the wrong thing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { intent } from "@pa/duel";
import {
  createSim,
  measure,
  reachEngagement,
  reportLine,
  run,
  type Measurement,
} from "./harness.js";
import {
  LOCALHOST,
  SCHOOL_AWFUL,
  SCHOOL_CONGESTED,
  SCHOOL_GOOD,
  SCHOOL_TYPICAL,
  mismatchedPair,
} from "../sim/profiles.js";
import { meanLatencyMs } from "../index.js";
import type { LinkProfile } from "../index.js";

/** Ten seconds of two players actually fighting, on one seeded link. */
function fight(profile: LinkProfile, seed: number): ReturnType<typeof createSim> {
  const sim = createSim(profile, { seed });
  reachEngagement(sim);
  // Deliberately busy: strafing, sprinting, crouching and firing, changing every
  // second, so the prediction is under continuous correction rather than coasting.
  const patterns = [
    intent({ moveX: 0.7, moveZ: 0.7, sprint: true, fire: true, aimZ: 1 }),
    intent({ moveX: -0.9, moveZ: 0.4, dodge: true, aimZ: 1 }),
    intent({ moveX: 0.2, moveZ: -1, crouch: true, fire: true, aimZ: 1 }),
    intent({ moveX: -0.5, moveZ: -0.85, sprint: true, aimZ: 1 }),
  ];
  const mirrored = patterns.map((p) => ({
    ...p,
    moveX: -p.moveX,
    moveZ: -p.moveZ,
    aimZ: -1,
  }));
  for (let second = 0; second < 10; second++) {
    sim.intent = {
      A: patterns[second % patterns.length]!,
      B: mirrored[(second + 2) % mirrored.length]!,
    };
    run(sim, 1000);
  }
  return sim;
}

const results: Measurement[] = [];

function measureProfile(profile: LinkProfile, seed = 31): void {
  const sim = fight(profile, seed);
  for (const side of ["A", "B"] as const) {
    const measurement = measure(sim, side, profile.name);
    results.push(measurement);
    console.log(
      `  ${reportLine(measurement)}  rtt~${Math.round(
        meanLatencyMs(sim.up[side]) + meanLatencyMs(sim.down[side]),
      )}ms`,
    );
  }
}

test("localhost: the environment tomorrow's test runs in, and it proves nothing", () => {
  measureProfile(LOCALHOST);
  const a = results.find((r) => r.profile === "LOCALHOST" && r.side === "A")!;
  assert.equal(a.worstErrorMm, 0, "a perfect link must reconcile perfectly");
  assert.ok(a.samples > 50, "the measurement must have data behind it");

  // KNOWN, MEASURED, AND NOT YET EXPLAINED — recorded rather than tuned away.
  //
  // About one comparison in two hundred disagrees on the AIM VECTOR by roughly a
  // third of a degree, while the position agrees to the bit. It appears at the same
  // rate on localhost as on a congested link, so it is not a network effect; the
  // server reproduces its own history exactly (see divergence.test.ts), so it is not
  // server non-determinism; and it is corrected by the next snapshot. What it costs a
  // player is nothing observable — aim only sets the direction of a shot the server
  // has already spawned. It is bounded here rather than asserted to zero, because
  // asserting zero would mean removing aim from the compared digest, which is exactly
  // the kind of convenient blindness this package exists to prevent.
  assert.ok(
    a.divergencesFound <= 2,
    `${a.divergencesFound} divergences in ${a.comparisonsMade} comparisons on a ` +
      `perfect link is a regression, not the known aim discrepancy`,
  );
});

test("a quiet classroom link stays exact", () => {
  measureProfile(SCHOOL_GOOD);
  const rows = results.filter((r) => r.profile === "SCHOOL_GOOD");
  for (const row of rows) {
    assert.ok(
      row.p95ErrorMm <= 1,
      `${row.side} p95 correction ${row.p95ErrorMm}mm on a good link`,
    );
  }
});

test("a normal classroom period stays smooth", () => {
  measureProfile(SCHOOL_TYPICAL);
  const rows = results.filter((r) => r.profile === "SCHOOL_TYPICAL");
  for (const row of rows) {
    // A centimetre is well under the width of a capsule and far under what a player
    // could see at this camera distance.
    assert.ok(
      row.p95ErrorMm <= 10,
      `${row.side} p95 correction ${row.p95ErrorMm}mm; worst ${row.worstErrorMm}mm`,
    );
    assert.ok(
      row.meanOpponentLagMs < 200,
      `${row.side} renders the opponent ${row.meanOpponentLagMs}ms in the past`,
    );
  }
});

test("congestion degrades the opponent's smoothness, not the player's own body", () => {
  // The asymmetry that makes this architecture worth its cost. The local player is
  // predicted, so their own movement stays exact however bad the link gets; the
  // opponent is interpolated further into the past, which is a readability cost
  // rather than a control cost. Latency should feel like "they are hard to read",
  // never like "my own character is fighting me".
  measureProfile(SCHOOL_CONGESTED);
  const rows = results.filter((r) => r.profile === "SCHOOL_CONGESTED");
  for (const row of rows) {
    assert.ok(
      row.p95ErrorMm <= 50,
      `${row.side} p95 correction ${row.p95ErrorMm}mm under congestion`,
    );
  }
  const typical = results.find((r) => r.profile === "SCHOOL_TYPICAL" && r.side === "A")!;
  const congested = rows.find((r) => r.side === "A")!;
  assert.ok(
    congested.meanOpponentLagMs >= typical.meanOpponentLagMs,
    "the interpolation delay must grow with jitter, which is the trade being made",
  );
});

test("the worst link degrades rather than collapsing", () => {
  // 120 ms one way, 110 ms of jitter, 10% loss, and a 400 ms spike on one packet in
  // eight. The bar here is not "good"; it is that the match stays playable, the
  // detector stays honest, and nothing runs away.
  measureProfile(SCHOOL_AWFUL);
  const rows = results.filter((r) => r.profile === "SCHOOL_AWFUL");
  for (const row of rows) {
    assert.ok(row.samples > 20, `${row.side} produced almost no snapshots`);
    assert.ok(
      row.worstErrorMm < 2000,
      `${row.side} worst correction ${row.worstErrorMm}mm is a teleport, not a correction`,
    );
  }
});

test("a mismatched pair does not let the better link bully the worse", () => {
  // One student near the access point, one at the far wall. Both are predicted
  // locally, so neither one's own body is affected by the other's link; what differs
  // is how stale each sees the other.
  const pair = mismatchedPair();
  const sim = createSim(pair.A, { profiles: pair, seed: 77 });
  reachEngagement(sim);
  sim.intent = {
    A: intent({ moveX: 0.7, moveZ: 0.7, sprint: true, aimZ: 1 }),
    B: intent({ moveX: -0.7, moveZ: -0.7, sprint: true, aimZ: -1 }),
  };
  run(sim, 8000);

  const good = measure(sim, "A", "MISMATCH_GOOD");
  const bad = measure(sim, "B", "MISMATCH_CONGESTED");
  console.log(`  ${reportLine(good)}`);
  console.log(`  ${reportLine(bad)}`);
  for (const row of [good, bad]) {
    assert.ok(
      row.p95ErrorMm <= 50,
      `${row.profile} p95 correction ${row.p95ErrorMm}mm`,
    );
  }
});

test("redundant intent windows are what make loss survivable", () => {
  // The counterfactual, because "it works with redundancy" only means something next
  // to "here is what happens without it". Same seed, same link, same inputs; the only
  // difference is whether a datagram carries a window of frames or just the newest.
  const withWindow = createSim(SCHOOL_CONGESTED, { seed: 909, redundancy: 4 });
  const withoutWindow = createSim(SCHOOL_CONGESTED, { seed: 909, redundancy: 1 });
  for (const sim of [withWindow, withoutWindow]) {
    reachEngagement(sim);
    sim.intent = {
      A: intent({ moveX: 0.7, moveZ: 0.7, sprint: true, fire: true, aimZ: 1 }),
      B: intent({ moveX: -0.7, moveZ: -0.7, aimZ: -1 }),
    };
    run(sim, 6000);
  }

  const kept = withWindow.host.sessions.A.framesAccepted;
  const lost = withoutWindow.host.sessions.A.framesAccepted;
  console.log(
    `  [redundancy] frames the server accepted from A over 6s at 5% loss: ` +
      `${kept} with a 4-frame window, ${lost} with none`,
  );
  assert.ok(
    kept >= lost,
    "a redundant window must never accept fewer inputs than no window",
  );
});

test("the measurement table", () => {
  // Printed as one block at the end so the report can quote it directly.
  console.log("\n  === reconciliation error by link profile ===");
  for (const row of results) console.log(`  ${reportLine(row)}`);
  console.log("");
  assert.ok(results.length >= 10, "every profile should have been measured");
});
