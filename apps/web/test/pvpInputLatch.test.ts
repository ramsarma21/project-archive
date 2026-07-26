import { test } from "node:test";
import assert from "node:assert/strict";

// Does a click survive the trip to the authority?
//
// The duel view lost presses to TICKLESS FRAMES: at 120Hz roughly every other
// frame advances no simulation tick, and a latch cleared once per frame is a coin
// flip. PvP inherits that and adds a second, harder loss mode, because its intents
// cross HTTP rather than a local clock:
//
//   REFUSED FRAMES. The authority accepts a frame only if its sequence advances
//   and its tick sits inside [serverTick - 12, serverTick + 8]. A client stamps
//   that tick by extrapolating from the last snapshot it holds — and that snapshot
//   was sampled BEFORE the response travelled back, so the estimate lags by about
//   the round trip. At 60Hz, 200ms of latency is twelve ticks, which is exactly the
//   lag bound. Past it, frames are refused, and read-and-clear throws the press
//   away without it ever having reached the reducer.
//
// So the two paths are measured here against the same press schedule, at several
// poll rates and several latencies, using the real acceptance arithmetic.

// ---- a window for the controller to attach to ------------------------------

type Handler = (event: unknown) => void;
const windowHandlers = new Map<string, Handler[]>();
const targetHandlers = new Map<string, Handler[]>();

function record(map: Map<string, Handler[]>) {
  return (type: string, handler: Handler): void => {
    const existing = map.get(type);
    if (existing) existing.push(handler);
    else map.set(type, [handler]);
  };
}

(globalThis as Record<string, unknown>).window = {
  addEventListener: record(windowHandlers),
  removeEventListener: () => undefined,
};

const pointerTarget = {
  addEventListener: record(targetHandlers),
  removeEventListener: () => undefined,
};

const { createDuelInput, LATCH_BUFFER_FRAMES } = await import(
  "../src/duel/duelInput.js"
);

function click(): void {
  for (const handler of targetHandlers.get("mousedown") ?? []) {
    handler({ button: 0 });
  }
}

// ---- the authority's own acceptance rules ----------------------------------

const TICK_HZ = 60;
const MS_PER_TICK = 1000 / TICK_HZ;
const MAX_LEAD = 8;
const MAX_LAG = 12;

interface SimOptions {
  readonly pollMs: number;
  readonly latencyMs: number;
  /** Peak swing either side of the latency. Wifi is not a constant. */
  readonly jitterMs: number;
  /** Fraction of requests that never come back at all. */
  readonly lossRate: number;
  readonly mode: "take" | "peek";
  /** Wall-clock rhythm of a player clicking. Deliberately not a poll multiple. */
  readonly pressEveryMs: number;
  readonly presses: number;
  /** Off reproduces the bug the round-trip term fixes. Defaults on. */
  readonly compensateRtt?: boolean;
}

/** Seeded, so a scenario reports the same number on every machine and every run. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

interface SimResult {
  readonly pressed: number;
  readonly delivered: number;
  readonly refused: number;
  readonly ticklessPolls: number;
  readonly lost: number;
}

/**
 * One run of the real poll loop against a modelled authority.
 *
 * The client half mirrors `usePvpSession`: stamp a frame by extrapolating from the
 * last snapshot, send it, then either clear the latch immediately (`take`) or
 * report what the authority did (`peek`).
 */
function simulate(options: SimOptions): SimResult {
  windowHandlers.clear();
  targetHandlers.clear();
  const input = createDuelInput({ target: pointerTarget as unknown as HTMLElement });
  input.attach();

  let now = 0;
  let serverTick = 0;
  let serverAdvancedAt = 0;
  let lastSeq = 0;
  let seq = 0;

  // What the client believes, when it learned it, and how long the trip takes.
  // The round-trip term is the whole reason a frame stamped for "now" is refused:
  // the snapshot was sampled before it travelled back, and the frame has to travel
  // out again. `usePvpSession` measures and smooths exactly this.
  let knownTick = 0;
  let knownAt = 0;
  let rttMs = 0;
  const RTT_SMOOTHING = 0.3;

  let nextPressAt = options.pressEveryMs;
  let pressesMade = 0;
  // The press currently waiting to be delivered, if any.
  let pendingPress: number | null = null;
  const deliveredPresses = new Set<number>();
  let refused = 0;
  let ticklessPolls = 0;
  let lost = 0;
  // Seeded from the scenario, not from the mode, so both paths meet the identical
  // sequence of jitter and dropped requests.
  const random = rng(options.pollMs * 7919 + Math.round(options.latencyMs) * 104729);

  const horizon = options.pressEveryMs * (options.presses + 4);
  while (now < horizon) {
    // A press lands between polls, exactly as a human click does.
    while (nextPressAt <= now && pressesMade < options.presses) {
      click();
      pressesMade += 1;
      pendingPress = pressesMade;
      nextPressAt += options.pressEveryMs;
    }

    const aheadMs =
      now - knownAt + (options.compensateRtt === false ? 0 : rttMs);
    const stampedTick = knownTick + Math.round((aheadMs / 1000) * TICK_HZ);
    seq += 1;
    const intent = options.mode === "take" ? input.takeIntent() : input.peekIntent();
    const frame = { seq, tick: Math.max(0, stampedTick), fire: intent.fire };

    const trip = Math.max(
      1,
      options.latencyMs + (random() * 2 - 1) * options.jitterMs,
    );
    const sentAt = now;

    // A request that never arrives. The click was already thrown away under
    // read-and-clear; under peek/settle it is still latched and rides the retry.
    if (random() < options.lossRate) {
      lost += 1;
      now = sentAt + trip;
      if (options.mode === "peek") input.settle(0);
      now += options.pollMs;
      continue;
    }

    // The request travels, and the authority pumps to the moment it arrives.
    const arriveAt = now + trip / 2;
    const advanced = Math.floor((arriveAt - serverAdvancedAt) / MS_PER_TICK);
    serverTick += advanced;
    serverAdvancedAt += advanced * MS_PER_TICK;
    if (advanced === 0) ticklessPolls += 1;

    const accepted =
      frame.seq > lastSeq &&
      frame.tick <= serverTick + MAX_LEAD &&
      frame.tick >= serverTick - MAX_LAG;
    if (accepted) {
      lastSeq = frame.seq;
      if (frame.fire && pendingPress !== null) {
        deliveredPresses.add(pendingPress);
        pendingPress = null;
      }
    } else {
      refused += 1;
    }

    // The response comes back and the client re-bases its clock on it.
    now = arriveAt + trip / 2;
    knownTick = serverTick;
    knownAt = now;
    const sample = now - sentAt;
    rttMs = rttMs === 0 ? sample : rttMs * (1 - RTT_SMOOTHING) + sample * RTT_SMOOTHING;

    if (options.mode === "peek") input.settle(accepted ? advanced : 0);

    now += options.pollMs;
  }

  return {
    pressed: pressesMade,
    delivered: deliveredPresses.size,
    refused,
    ticklessPolls,
    lost,
  };
}

// ---- the measurements -------------------------------------------------------

const RATES = [
  { label: "30ms poll, 4ms LAN", pollMs: 30, latencyMs: 4, jitterMs: 2, lossRate: 0 },
  { label: "90ms poll, 12ms LAN (shipped)", pollMs: 90, latencyMs: 12, jitterMs: 8, lossRate: 0 },
  { label: "90ms poll, 120ms wifi + jitter", pollMs: 90, latencyMs: 120, jitterMs: 90, lossRate: 0.04 },
  { label: "90ms poll, 220ms wifi + jitter", pollMs: 90, latencyMs: 220, jitterMs: 140, lossRate: 0.06 },
  { label: "250ms poll, 60ms degraded", pollMs: 250, latencyMs: 60, jitterMs: 40, lossRate: 0.02 },
];

test("peek/settle delivers every click at every rate measured", () => {
  const report: string[] = [];
  let takeLostSomewhere = false;
  for (const rate of RATES) {
    const shared = { pressEveryMs: 430, presses: 10 } as const;
    const take = simulate({ ...rate, ...shared, mode: "take" });
    const peek = simulate({ ...rate, ...shared, mode: "peek" });
    report.push(
      `${rate.label.padEnd(31)} take ${take.delivered}/${take.pressed}   peek ${peek.delivered}/${peek.pressed}   (refused ${peek.refused}, dropped ${peek.lost}, tickless ${peek.ticklessPolls})`,
    );
    if (take.delivered < take.pressed) takeLostSomewhere = true;
    assert.equal(
      peek.delivered,
      peek.pressed,
      `${rate.label}: peek/settle dropped ${peek.pressed - peek.delivered} of ${peek.pressed} clicks`,
    );
    assert.ok(
      peek.delivered >= take.delivered,
      `${rate.label}: peek/settle must never deliver fewer than read-and-clear`,
    );
  }
  console.log(`\n  input delivery\n    ${report.join("\n    ")}\n`);
  // If read-and-clear never lost a press anywhere in this matrix the matrix is
  // not exercising the failure, and the comparison above proves nothing.
  assert.ok(
    takeLostSomewhere,
    "the scenarios must include conditions under which read-and-clear actually drops a press",
  );
});

test("without the round-trip term a slow connection refuses every frame", () => {
  // The bug the compensation exists for, kept reproducible. Stamping a frame for
  // "now" is short by a full round trip, and twelve ticks of lag is 200ms at 60Hz,
  // so past that the authority refuses everything and the player cannot move or
  // shoot at all. It presents as dead controls, not as a network problem — which
  // is why it is worth a test rather than a comment.
  const scenario = {
    pollMs: 90,
    latencyMs: 260,
    jitterMs: 0,
    lossRate: 0,
    pressEveryMs: 430,
    presses: 10,
    mode: "peek",
  } as const;

  const naive = simulate({ ...scenario, compensateRtt: false });
  assert.equal(naive.delivered, 0, "the bug should reproduce: nothing gets through");
  assert.ok(naive.refused > 10, `every frame should be refused, got ${naive.refused}`);

  const fixed = simulate({ ...scenario, compensateRtt: true });
  assert.equal(fixed.refused, 0);
  assert.equal(fixed.delivered, fixed.pressed);
  console.log(
    `\n  260ms round trip: naive ${naive.delivered}/${naive.pressed} delivered (${naive.refused} frames refused), compensated ${fixed.delivered}/${fixed.pressed} (${fixed.refused} refused)\n`,
  );
});

test("a press refused by the authority is retried rather than eaten", () => {
  // The transport-specific loss mode, isolated: the frame never reaches the
  // reducer, so the tick count the snapshot shows is irrelevant and the press has
  // to survive. This is the case a local-clock client cannot have.
  windowHandlers.clear();
  targetHandlers.clear();
  const input = createDuelInput({ target: pointerTarget as unknown as HTMLElement });
  input.attach();

  click();
  assert.equal(input.peekIntent().fire, true);

  // Refused: report zero however far the world moved.
  input.settle(0);
  assert.equal(input.pending().fire, true, "a refused frame must not eat the click");
  assert.equal(input.peekIntent().fire, true);

  // Accepted, and ticks ran: now it is spent.
  input.settle(3);
  assert.equal(input.pending().fire, false);
  assert.equal(input.peekIntent().fire, false);
});

test("a latched press is bounded and cannot be banked across a pause", () => {
  windowHandlers.clear();
  targetHandlers.clear();
  const input = createDuelInput({ target: pointerTarget as unknown as HTMLElement });
  input.attach();

  click();
  for (let i = 0; i < LATCH_BUFFER_FRAMES; i++) input.settle(0);
  assert.equal(
    input.pending().fire,
    false,
    "an unconsumed press must expire rather than fire seconds later",
  );

  // And the question phase drops it outright, which is the path PvP actually uses
  // when a round opens: no shot may be banked while a player is reading.
  click();
  assert.equal(input.pending().fire, true);
  input.setEnabled(false);
  assert.equal(input.pending().fire, false);
});

test("read-and-clear is what the deprecated alias still does", () => {
  // Kept honest: the alias is unchanged behaviour, so anything still calling it
  // loses the press on a frame that bought no tick. This is the regression guard
  // against somebody reintroducing it.
  windowHandlers.clear();
  targetHandlers.clear();
  const input = createDuelInput({ target: pointerTarget as unknown as HTMLElement });
  input.attach();

  click();
  assert.equal(input.takeIntent().fire, true);
  assert.equal(input.pending().fire, false, "takeIntent clears unconditionally");
});
