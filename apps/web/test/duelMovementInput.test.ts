import { test } from "node:test";
import assert from "node:assert/strict";

// Rapid movement-bind input: latest-state sampling with a short-tap latch (item A).
//
// The rules these hold:
//   - continuous movement is LATEST STATE, sampled once per tick/poll from the held set;
//     an OS `keydown` auto-repeat never queues anything;
//   - a TAP whose down AND up both fall between two samples is still represented at least
//     once (the poll runs at ~11Hz, so a quick tap would otherwise be dropped entirely);
//   - a represented tap is cleared on the SAME signal that clears an edge — an accepted
//     receipt (PvP) or a tick that consumed the frame (boss) — and never replayed after;
//   - opposite keys resolve deterministically;
//   - blur / question / pointer-lock loss clear held movement so it cannot stick;
//   - edge actions (fire/dodge) remain exactly-once even while movement coalesces.

// ---- a window that records handlers, driven with plain event objects --------

interface FakeWindow {
  readonly win: {
    addEventListener: (type: string, handler: (e: unknown) => void) => void;
    removeEventListener: (type: string, handler: (e: unknown) => void) => void;
  };
  fire(type: string, event: Record<string, unknown>): void;
}

function fakeWindow(): FakeWindow {
  const handlers = new Map<string, ((e: unknown) => void)[]>();
  return {
    win: {
      addEventListener: (type, handler) => {
        const list = handlers.get(type) ?? [];
        list.push(handler);
        handlers.set(type, list);
      },
      removeEventListener: (type, handler) => {
        const list = handlers.get(type);
        if (list) handlers.set(type, list.filter((h) => h !== handler));
      },
    },
    fire: (type, event) => {
      for (const handler of [...(handlers.get(type) ?? [])]) handler(event);
    },
  };
}

const CANVAS = { tagName: "CANVAS" };

const { createDuelInput, EDGE_INTENT_MAX_AGE_MS } = await import("../src/duel/duelInput.js");

function keydown(w: FakeWindow, code: string, extra: Record<string, unknown> = {}): void {
  w.fire("keydown", { code, target: CANVAS, repeat: false, preventDefault() {}, ...extra });
}
function repeatDown(w: FakeWindow, code: string): void {
  w.fire("keydown", { code, target: CANVAS, repeat: true, preventDefault() {} });
}
function keyup(w: FakeWindow, code: string): void {
  w.fire("keyup", { code, target: CANVAS, preventDefault() {} });
}

/** A boss-mode controller wired to a fresh fake window, with an injected clock. */
function bossInput(clock: { ms: number }) {
  const w = fakeWindow();
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = w.win;
  const input = createDuelInput({ now: () => clock.ms });
  const detach = input.attach();
  (globalThis as { window?: unknown }).window = previous;
  return { input, w, detach };
}

// ---- a tap shorter than the sample interval survives -------------------------

test("a movement tap fully between two samples is represented exactly once", () => {
  const clock = { ms: 0 };
  const { input, w, detach } = bossInput(clock);

  // Down AND up before any sample: the poll never observes it as held.
  keydown(w, "KeyW");
  keyup(w, "KeyW");

  const first = input.sampleIntent();
  assert.ok(first.intent.moveZ > 0.9, "the tap is represented on the next sample");

  // Consumed by an accepted frame: it is not replayed on the following sample.
  input.acknowledge(first.receipt);
  assert.ok(Math.abs(input.sampleIntent().intent.moveZ) < 1e-9, "a consumed tap never replays");
  detach();
});

test("a tap rides refused polls and clears only once a frame is accepted", () => {
  const clock = { ms: 0 };
  const { input, w, detach } = bossInput(clock);

  keydown(w, "KeyW");
  keyup(w, "KeyW");

  // Two refused polls (no acknowledge): the tap must survive both.
  assert.ok(input.sampleIntent().intent.moveZ > 0.9, "carried on the first poll");
  const second = input.sampleIntent();
  assert.ok(second.intent.moveZ > 0.9, "still carried on a refused second poll");

  // Accepted (even with an empty edge receipt): the movement tap is consumed.
  input.acknowledge(second.receipt);
  assert.ok(Math.abs(input.sampleIntent().intent.moveZ) < 1e-9, "cleared on acceptance");
  detach();
});

test("an ack for an older sample cannot clear a tap made after it", () => {
  const clock = { ms: 0 };
  const { input, w, detach } = bossInput(clock);

  keydown(w, "KeyA"); // strafe left tap
  keyup(w, "KeyA");
  const older = input.sampleIntent();
  assert.ok(older.intent.moveX > 0.9, "left tap sampled");

  clock.ms = 20;
  keydown(w, "KeyD"); // a new strafe-right tap made AFTER the older sample
  keyup(w, "KeyD");

  // The older frame comes back accepted: it must clear only the left tap it carried.
  input.acknowledge(older.receipt);
  const next = input.sampleIntent();
  assert.ok(next.intent.moveX < -0.9, "the newer right tap survives an older ack");
  detach();
});

test("opposite movement taps in one interval cancel deterministically", () => {
  const clock = { ms: 0 };
  const { input, w, detach } = bossInput(clock);
  keydown(w, "KeyA");
  keyup(w, "KeyA");
  keydown(w, "KeyD");
  keyup(w, "KeyD");
  assert.ok(Math.abs(input.sampleIntent().intent.moveX) < 1e-9, "A and D in one interval cancel");
  detach();
});

// ---- held keys stay latest-state, and do not stick after release ------------

test("a held key is latest-state and leaves no overshoot when released", () => {
  const clock = { ms: 0 };
  const { input, w, detach } = bossInput(clock);

  keydown(w, "KeyW"); // held down, not released
  const s1 = input.sampleIntent();
  assert.ok(s1.intent.moveZ > 0.9);
  input.acknowledge(s1.receipt);
  assert.ok(input.sampleIntent().intent.moveZ > 0.9, "still moving while held");

  keyup(w, "KeyW");
  assert.ok(
    Math.abs(input.sampleIntent().intent.moveZ) < 1e-9,
    "movement stops the sample after release — no stuck overshoot",
  );
  detach();
});

// ---- thousands of events stay bounded, with no queue growth or stale replay --

test("thousands of repeats and taps produce a bounded latest state, no stale replay", () => {
  const clock = { ms: 0 };
  const { input, w, detach } = bossInput(clock);

  // Ten thousand OS auto-repeats of a held key: they must not accumulate anything.
  keydown(w, "KeyW");
  for (let i = 0; i < 10_000; i += 1) repeatDown(w, "KeyW");
  const held = input.sampleIntent();
  assert.ok(held.intent.moveZ > 0.9, "the held key still reads as one direction");
  input.acknowledge(held.receipt);
  keyup(w, "KeyW");

  // Thousands of alternating taps: each interval represents the latest state once and
  // nothing is banked. Sampling and acknowledging every tap drains cleanly to rest.
  for (let i = 0; i < 4_000; i += 1) {
    const code = i % 2 === 0 ? "KeyA" : "KeyD";
    clock.ms += 1;
    keydown(w, code);
    keyup(w, code);
    const s = input.sampleIntent();
    assert.ok(Math.abs(s.intent.moveX) > 0.9, "each tap is represented");
    input.acknowledge(s.receipt);
  }
  // After the storm, at rest, nothing lingers: no stale movement replays.
  assert.ok(Math.abs(input.sampleIntent().intent.moveX) < 1e-9, "state settled to rest");
  detach();
});

// ---- edges remain exactly-once while movement coalesces ---------------------

test("a movement storm never drops or duplicates an edge press", () => {
  const clock = { ms: 0 };
  const { input, w, detach } = bossInput(clock);

  // A dodge (Q) latched amid a flurry of movement taps.
  keydown(w, "KeyW");
  keyup(w, "KeyW");
  keydown(w, "KeyQ"); // dodge edge
  keyup(w, "KeyQ");
  keydown(w, "KeyD");
  keyup(w, "KeyD");

  const s = input.sampleIntent();
  assert.equal(s.intent.dodge, true, "the dodge rides out with the movement");
  assert.ok(s.receipt.length === 1, "one edge id, for the dodge");
  // Repeats of Q must not queue a second dodge.
  for (let i = 0; i < 200; i += 1) repeatDown(w, "KeyQ");
  input.acknowledge(s.receipt);
  assert.equal(input.pending().dodge, false, "the dodge is spent exactly once");
  assert.equal(input.sampleIntent().intent.dodge, false, "and never re-fires from repeats");
  detach();
});

// ---- boss consume discipline: a tick spends the tap, a tickless frame holds --

test("boss duel holds a movement tap across tickless frames until a tick consumes it", () => {
  const clock = { ms: 0 };
  const { input, w, detach } = bossInput(clock);

  keydown(w, "KeyW");
  keyup(w, "KeyW");

  assert.ok(input.peekIntent().moveZ > 0.9, "the tap is present");
  input.settle(0); // a frame that advanced no tick consumes nothing
  assert.ok(input.peekIntent().moveZ > 0.9, "a tickless frame must not eat the tap");
  input.settle(2); // a tick ran: the tap is spent
  assert.ok(Math.abs(input.peekIntent().moveZ) < 1e-9, "the tap is consumed once a tick runs");
  detach();
});

test("a never-consumed movement tap expires by age rather than replaying forever", () => {
  const clock = { ms: 0 };
  const { input, w, detach } = bossInput(clock);
  keydown(w, "KeyW");
  keyup(w, "KeyW");
  clock.ms = EDGE_INTENT_MAX_AGE_MS - 1;
  assert.ok(input.peekIntent().moveZ > 0.9, "still live just under the age");
  clock.ms = EDGE_INTENT_MAX_AGE_MS + 1;
  input.settle(0);
  assert.ok(Math.abs(input.peekIntent().moveZ) < 1e-9, "dropped once stale, not banked");
  detach();
});

// ---- lifecycle transitions clear held movement so it cannot stick -----------

test("a question and a lifecycle loss both clear held movement and its tap latch", () => {
  const clock = { ms: 0 };
  const { input, w, detach } = bossInput(clock);

  keydown(w, "KeyW"); // held
  keydown(w, "KeyA");
  keyup(w, "KeyA"); // and a pending tap
  assert.ok(Math.abs(input.sampleIntent().intent.moveZ) > 0.5);

  input.setEnabled(false); // a question opens
  assert.ok(Math.abs(input.sampleIntent().intent.moveZ) < 1e-9, "movement suspended");
  assert.ok(Math.abs(input.sampleIntent().intent.moveX) < 1e-9);

  input.setEnabled(true);
  // Nothing survived the suspension — the earlier held W is gone, not resumed.
  assert.ok(Math.abs(input.sampleIntent().intent.moveZ) < 1e-9, "held state did not resume");

  keydown(w, "KeyW");
  assert.ok(input.sampleIntent().intent.moveZ > 0.9);
  w.fire("blur", {});
  assert.ok(Math.abs(input.sampleIntent().intent.moveZ) < 1e-9, "blur clears held movement");
  detach();
});
