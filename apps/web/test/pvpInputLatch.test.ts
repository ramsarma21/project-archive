import { test } from "node:test";
import assert from "node:assert/strict";

// Edge acknowledgements by receipt and age (item 4).
//
// A PvP edge press crosses HTTP, so "did a tick consume it" is the wrong question —
// the frame can be REFUSED (stale seq / tick outside the window) or never arrive at
// all, and in both the press must survive and ride the next poll. The model: each
// press is an {id, timestamp}; `sampleIntent` returns the intent AND a receipt of the
// ids it carried; the transport calls `acknowledge` with that receipt ONLY when the
// authority accepted the frame. A refusal or a drop clears nothing; a press older
// than EDGE_INTENT_MAX_AGE_MS expires; a question cancels the queue outright.

const windowHandlers = new Map<string, ((e: unknown) => void)[]>();
const targetHandlers = new Map<string, ((e: unknown) => void)[]>();
function record(map: Map<string, ((e: unknown) => void)[]>) {
  return (type: string, handler: (e: unknown) => void): void => {
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

const { createDuelInput, EDGE_INTENT_MAX_AGE_MS } = await import(
  "../src/duel/duelInput.js"
);

function clickBoss(): void {
  for (const handler of targetHandlers.get("mousedown") ?? []) handler({ button: 0 });
}

// ---- the acknowledgement rules ---------------------------------------------

test("an accepted receipt clears only its own ids; a refusal preserves them", () => {
  windowHandlers.clear();
  targetHandlers.clear();
  let nowMs = 0;
  const input = createDuelInput({ target: pointerTarget as unknown as HTMLElement, now: () => nowMs });
  input.attach();

  clickBoss();
  const first = input.sampleIntent();
  assert.equal(first.intent.fire, true);
  assert.ok(first.receipt.length >= 1);

  // Refused: acknowledge is NOT called, so the press survives and re-samples true.
  assert.equal(input.pending().fire, true);
  assert.equal(input.sampleIntent().intent.fire, true, "a refused frame keeps the press");

  // Accepted: clearing exactly the sampled receipt spends it, once.
  input.acknowledge(first.receipt);
  assert.equal(input.pending().fire, false, "an accepted frame clears the press");
  assert.equal(input.sampleIntent().intent.fire, false);
});

test("an old acknowledgement can never clear a newer in-flight press", () => {
  windowHandlers.clear();
  targetHandlers.clear();
  let nowMs = 0;
  const input = createDuelInput({ target: pointerTarget as unknown as HTMLElement, now: () => nowMs });
  input.attach();

  clickBoss();
  const a = input.sampleIntent(); // press A sampled, receipt rA
  nowMs = 50;
  clickBoss(); // press B made while A is in flight
  // A's response comes back accepted, LATE, carrying only rA.
  input.acknowledge(a.receipt);
  assert.equal(input.pending().fire, true, "B must survive an ack that predates it");
  const b = input.sampleIntent();
  assert.equal(b.intent.fire, true);
  input.acknowledge(b.receipt);
  assert.equal(input.pending().fire, false, "and B clears on its own ack");
});

test("an unacknowledged press expires after EDGE_INTENT_MAX_AGE_MS, and not before", () => {
  windowHandlers.clear();
  targetHandlers.clear();
  let nowMs = 0;
  const input = createDuelInput({ target: pointerTarget as unknown as HTMLElement, now: () => nowMs });
  input.attach();

  clickBoss();
  nowMs = EDGE_INTENT_MAX_AGE_MS - 1;
  assert.equal(input.sampleIntent().intent.fire, true, "still live just under the age");
  nowMs = EDGE_INTENT_MAX_AGE_MS + 1;
  assert.equal(input.sampleIntent().intent.fire, false, "dropped once it is stale");
  assert.equal(input.pending().fire, false);
});

test("a question or lifecycle transition cancels the whole queue at once", () => {
  windowHandlers.clear();
  targetHandlers.clear();
  const input = createDuelInput({ target: pointerTarget as unknown as HTMLElement });
  input.attach();

  clickBoss();
  assert.equal(input.pending().fire, true);
  input.setEnabled(false); // a question opens
  assert.equal(input.pending().fire, false, "the question drops the press outright");

  input.setEnabled(true);
  clickBoss();
  input.cancel(); // a match change / lifecycle loss
  assert.equal(input.pending().fire, false);
});

test("boss duel clears an edge only when a tick actually consumes it", () => {
  windowHandlers.clear();
  targetHandlers.clear();
  let nowMs = 0;
  const input = createDuelInput({ target: pointerTarget as unknown as HTMLElement, now: () => nowMs });
  input.attach();

  clickBoss();
  assert.equal(input.peekIntent().fire, true);
  input.settle(0); // no tick ran: nothing consumed
  assert.equal(input.pending().fire, true, "a tickless frame must not eat the click");
  input.settle(3); // ticks ran: the sampled press is spent
  assert.equal(input.pending().fire, false);
});

test("a boolean frame carries one fire; two rapid fires become two distinct accepted frames", () => {
  windowHandlers.clear();
  targetHandlers.clear();
  let nowMs = 0;
  const input = createDuelInput({ target: pointerTarget as unknown as HTMLElement, now: () => nowMs });
  input.attach();

  // Two clicks land back to back, before any poll — both are queued.
  clickBoss();
  clickBoss();
  assert.equal(input.pending().fire, true);

  // The intent is a boolean, so one frame represents ONE fire: the receipt names exactly
  // the single queue head, never both presses.
  const f1 = input.sampleIntent();
  assert.equal(f1.intent.fire, true);
  assert.equal(f1.receipt.length, 1, "a boolean fire carries exactly one edge id");

  // Accepting that frame clears only its own head; the second rapid fire survives.
  input.acknowledge(f1.receipt);
  assert.equal(input.pending().fire, true, "the second rapid fire was not collapsed away");

  // And it becomes its own, DISTINCT accepted frame — two presses, two server edges.
  const f2 = input.sampleIntent();
  assert.equal(f2.intent.fire, true);
  assert.equal(f2.receipt.length, 1);
  assert.notDeepEqual(f2.receipt, f1.receipt, "two rapid fires are two frames, never one collapsed");
  input.acknowledge(f2.receipt);
  assert.equal(input.pending().fire, false, "both delivered, exactly once each — no duplicate");
});

// ---- the poll-cadence delivery matrix --------------------------------------

const TICK_HZ = 60;
const MS_PER_TICK = 1000 / TICK_HZ;
const MAX_LEAD = 8;
const MAX_LAG = 12;

interface Rate {
  readonly label: string;
  readonly pollMs: number;
  readonly latencyMs: number;
  readonly jitterMs: number;
  readonly lossRate: number;
}

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** One run of the real poll loop against a modelled authority, using sample/ack. */
function simulate(
  rate: Rate,
  seed: number,
): { pressed: number; delivered: number; duplicated: number; dropped: number } {
  windowHandlers.clear();
  targetHandlers.clear();
  let nowMs = 0;
  const input = createDuelInput({ target: pointerTarget as unknown as HTMLElement, now: () => nowMs });
  input.attach();

  let serverTick = 0;
  let serverAdvancedAt = 0;
  let lastSeq = 0;
  let seq = 0;
  let knownTick = 0;
  let knownAt = 0;
  let rttMs = 0;
  const RTT_SMOOTHING = 0.3;

  const pressEveryMs = 430;
  const presses = 10;
  let nextPressAt = pressEveryMs;
  let pressesMade = 0;
  const random = rng(seed);

  // Outstanding presses, FIFO. A press is DELIVERED when an accepted frame actually
  // carries a fire — the boolean the server would register — not merely because a
  // receipt id rode along. Counting the server edge rather than the receipt length is
  // the point of the audit: a boolean frame is worth exactly one fire, so an accepted
  // fire consumes exactly one outstanding press. A press still outstanding at the end
  // was DROPPED; a fire accepted with none outstanding behind it is a DUPLICATE.
  const outstanding: number[] = [];
  let delivered = 0;
  let duplicated = 0;

  const horizon = pressEveryMs * (presses + 6);
  while (nowMs < horizon) {
    while (nextPressAt <= nowMs && pressesMade < presses) {
      clickBoss();
      pressesMade += 1;
      outstanding.push(pressesMade);
      nextPressAt += pressEveryMs;
    }

    const aheadMs = nowMs - knownAt + rttMs;
    const stampedTick = knownTick + Math.round((aheadMs / 1000) * TICK_HZ);
    seq += 1;
    const sampled = input.sampleIntent();
    const frame = { seq, tick: Math.max(0, stampedTick), fire: sampled.intent.fire };

    const trip = Math.max(1, rate.latencyMs + (random() * 2 - 1) * rate.jitterMs);
    const sentAt = nowMs;
    if (random() < rate.lossRate) {
      nowMs = sentAt + trip + rate.pollMs; // dropped in flight: no ack, press preserved
      continue;
    }

    const arriveAt = nowMs + trip / 2;
    const advanced = Math.floor((arriveAt - serverAdvancedAt) / MS_PER_TICK);
    serverTick += advanced;
    serverAdvancedAt += advanced * MS_PER_TICK;

    const accepted =
      frame.seq > lastSeq &&
      frame.tick <= serverTick + MAX_LEAD &&
      frame.tick >= serverTick - MAX_LAG;
    if (accepted) {
      lastSeq = frame.seq;
      if (frame.fire) {
        // One accepted boolean fire is one server edge, and clears one queue head.
        if (outstanding.length > 0) {
          outstanding.shift();
          delivered += 1;
        } else {
          duplicated += 1; // an accepted fire with no outstanding press behind it
        }
      }
      input.acknowledge(sampled.receipt); // accepted: clear exactly the head it carried
    }
    // refused: no acknowledge, the press rides the next poll

    nowMs = arriveAt + trip / 2;
    knownTick = serverTick;
    knownAt = nowMs;
    const sampleRtt = nowMs - sentAt;
    rttMs = rttMs === 0 ? sampleRtt : rttMs * (1 - RTT_SMOOTHING) + sampleRtt * RTT_SMOOTHING;
    nowMs += rate.pollMs;
  }

  return { pressed: pressesMade, delivered, duplicated, dropped: outstanding.length };
}

test("every click is delivered exactly once at every poll cadence, RTT, jitter and loss", () => {
  const rates: Rate[] = [
    { label: "30ms poll, 4ms LAN", pollMs: 30, latencyMs: 4, jitterMs: 2, lossRate: 0 },
    { label: "90ms poll, 120ms wifi + jitter", pollMs: 90, latencyMs: 120, jitterMs: 90, lossRate: 0.05 },
    { label: "90ms poll, 260ms wifi + jitter + loss", pollMs: 90, latencyMs: 260, jitterMs: 140, lossRate: 0.08 },
    { label: "250ms poll, 60ms degraded", pollMs: 250, latencyMs: 60, jitterMs: 40, lossRate: 0.03 },
  ];
  const report: string[] = [];
  for (const rate of rates) {
    for (const seed of [1, 7, 4242]) {
      const r = simulate(rate, seed);
      report.push(
        `${rate.label.padEnd(38)} seed ${seed}: ${r.delivered}/${r.pressed}, dup ${r.duplicated}, dropped ${r.dropped}`,
      );
      assert.equal(r.dropped, 0, `${rate.label} seed ${seed}: ${r.dropped} presses dropped`);
      assert.equal(r.duplicated, 0, `${rate.label} seed ${seed}: ${r.duplicated} duplicate deliveries`);
      assert.equal(r.delivered, r.pressed, `${rate.label} seed ${seed}: delivered ${r.delivered}/${r.pressed}`);
    }
  }
  console.log(`\n  edge delivery\n    ${report.join("\n    ")}\n`);
});
