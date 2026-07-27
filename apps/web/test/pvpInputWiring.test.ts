import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Input WIRING, composed (Sol input audit, bugs 1 and 2).
//
// These are the two bugs that only show up once the pieces are assembled — a stable
// binder that a re-render must not swap, and a listener attachment that must live in an
// effect so a StrictMode-style mount/unmount/remount neither leaks a second listener set
// nor loses the only one. Both are exercised through real React rendering, with the DOM
// surface faked to exactly what the input path touches (there is no jsdom).

type Listener = (event: unknown) => void;
class FakeTarget {
  readonly listeners = new Map<string, Set<Listener>>();
  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string, event: unknown = {}): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function fakeDom(): {
  doc: FakeTarget & { pointerLockElement: unknown; hidden: boolean; exitPointerLock: () => void };
  canvas: FakeTarget & { ownerDocument: unknown; requestPointerLock?: () => void };
  win: FakeTarget;
} {
  const doc = Object.assign(new FakeTarget(), {
    pointerLockElement: null as unknown,
    hidden: false,
    exitPointerLock(): void {
      doc.pointerLockElement = null;
      doc.emit("pointerlockchange");
    },
  });
  const canvas = Object.assign(new FakeTarget(), { ownerDocument: doc });
  const win = new FakeTarget();
  return { doc, canvas, win };
}

const { usePvpSession } = await import("../src/pvp/usePvpSession.js");
const { createDuelInput } = await import("../src/duel/duelInput.js");
const { attachPvpLook, createPvpLookState, drainLook } = await import(
  "../src/pvp/pvpLook.js"
);
type Transport = Parameters<typeof usePvpSession>[0];
type LookController = import("../src/pvp/pvpLook.js").PvpLookController;

// ---------------------------------------------------------------------------
// Bug 1a: usePvpSession.bindInput has a STABLE identity across re-renders.
//
// The session object is rebuilt every render (every snapshot, every phase tick), so a
// binder created inline would change identity each time and re-run the canvas attach
// effect. Memoizing it on the (stable) input controller is the fix, and the observable
// property is a single unchanging reference across many re-renders.
// ---------------------------------------------------------------------------

/** An idle transport: unauthenticated, so the session sits in IDLE and the loop is quiet. */
function idleTransport(): Transport {
  const unreachable = { status: "UNREACHABLE" as const, detail: "idle" };
  return {
    identity: async () => ({
      status: "OK" as const,
      value: { authenticated: false, displayName: null, profileId: null, csrfToken: null },
    }),
    active: async () => unreachable,
    createLobby: async () => unreachable,
    readLobby: async () => unreachable,
    cancelLobby: async () => unreachable,
    joinLobby: async () => unreachable,
    readMatch: async () => unreachable,
    sendIntents: async () => unreachable,
    answer: async () => unreachable,
    forfeit: async () => unreachable,
    leaderboard: async () => unreachable,
  } as unknown as Transport;
}

test("usePvpSession.bindInput keeps one stable identity across re-renders", async () => {
  const previousWindow = (globalThis as { window?: unknown }).window;
  const { win } = fakeDom();
  (globalThis as { window?: unknown }).window = win;

  const binders: unknown[] = [];
  const transport = idleTransport();
  function Harness(_props: { tag: number }): null {
    const session = usePvpSession(transport);
    binders.push(session.bindInput);
    return null;
  }

  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Harness, { tag: 0 }));
  });
  for (const tag of [1, 2, 3, 4, 5]) {
    await act(async () => {
      renderer.update(React.createElement(Harness, { tag }));
    });
  }
  await act(async () => {
    renderer.unmount();
  });

  assert.ok(binders.length >= 6, `only ${binders.length} renders observed`);
  const first = binders[0];
  for (const b of binders) assert.equal(b, first, "bindInput identity changed across renders");
  (globalThis as { window?: unknown }).window = previousWindow;
});

// ---------------------------------------------------------------------------
// Bug 1b: with a stable binder, the canvas attach effect runs ONCE across many
// re-renders and held movement / a queued edge survive; swapping the binder (the
// pre-fix hazard) re-runs the effect, which detaches and reattaches and clears them.
//
// This uses ArenaStage's InputCapture effect shape verbatim — bind in an effect keyed on
// the binder — against the real input controller, so it is the exact path the fix guards.
// ---------------------------------------------------------------------------

test("a stable binder attaches once and preserves held input; swapping it clears everything", () => {
  const previousWindow = (globalThis as { window?: unknown }).window;
  const { canvas, win } = fakeDom();
  (globalThis as { window?: unknown }).window = win;

  const input = createDuelInput({ mode: "pvp" });
  let attachCount = 0;
  const stableBinder = (c: HTMLElement): (() => void) => {
    attachCount += 1;
    return input.attach(c);
  };

  function Binder(props: { binder: (c: HTMLElement) => () => void; tag: number }): null {
    React.useEffect(() => props.binder(canvas as unknown as HTMLElement), [props.binder]);
    return null;
  }

  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(Binder, { binder: stableBinder, tag: 0 }));
  });
  // Several re-renders with the SAME binder: the effect must not re-run.
  for (const tag of [1, 2, 3] as const) {
    act(() => {
      renderer.update(React.createElement(Binder, { binder: stableBinder, tag }));
    });
  }
  assert.equal(attachCount, 1, `stable binder attached ${attachCount} times`);
  assert.equal(win.count("keydown"), 1, "a second keydown listener set leaked");

  // The player holds a strafe and queues a dodge through the one listener set.
  win.emit("keydown", { code: "KeyW", target: { tagName: "CANVAS" }, repeat: false });
  win.emit("keydown", { code: "KeyQ", target: { tagName: "CANVAS" }, repeat: false });

  // More re-renders with the same binder: held movement and the queued edge survive.
  for (const tag of [4, 5] as const) {
    act(() => {
      renderer.update(React.createElement(Binder, { binder: stableBinder, tag }));
    });
  }
  assert.equal(attachCount, 1, "the stable binder never reattached");
  assert.ok(input.sampleIntent().intent.moveZ > 0.5, "held strafe survived the re-renders");
  assert.equal(input.pending().dodge, true, "the queued dodge survived the re-renders");

  // Now the hazard the memoization removes: a NEW binder identity re-runs the effect —
  // detach then reattach — and the reattach clears held movement and the whole queue.
  const swapped = (c: HTMLElement): (() => void) => {
    attachCount += 1;
    return input.attach(c);
  };
  act(() => {
    renderer.update(React.createElement(Binder, { binder: swapped, tag: 6 }));
  });
  assert.equal(attachCount, 2, "swapping the binder reattached");
  assert.ok(Math.abs(input.sampleIntent().intent.moveZ) < 1e-9, "reattach cleared held movement");
  assert.equal(input.pending().dodge, false, "reattach cleared the queued edge");

  act(() => {
    renderer.unmount();
  });
  (globalThis as { window?: unknown }).window = previousWindow;
});

// ---------------------------------------------------------------------------
// Bug 2: the look listeners are attached in an EFFECT, so a mount/unmount/remount
// (as React StrictMode drives) leaves exactly one listener set, duplicates no mouse
// delta, and releases an owned pointer lock on teardown.
//
// react-test-renderer does not itself double-invoke effects the way react-dom does under
// StrictMode, so the mount -> unmount -> remount sequence is driven explicitly here;
// wrapping in StrictMode documents the intent. The component below carries the SAME effect
// body as ArenaStage's LookCapture (attach in an effect, apply enabled, detach on
// cleanup) — the property under test is that the attachment is an effect, not a
// render-time useMemo that would leak or lose a listener set on remount.
// ---------------------------------------------------------------------------

function LookProbe(props: {
  state: ReturnType<typeof createPvpLookState>;
  canvas: HTMLElement;
  enabled: boolean;
}): null {
  const ref = React.useRef<LookController | null>(null);
  const enabledRef = React.useRef(props.enabled);
  enabledRef.current = props.enabled;
  React.useEffect(() => {
    const controller = attachPvpLook(props.state, props.canvas);
    controller.setEnabled(enabledRef.current);
    ref.current = controller;
    return () => {
      controller.detach();
      ref.current = null;
    };
  }, [props.canvas, props.state]);
  React.useEffect(() => {
    ref.current?.setEnabled(props.enabled);
  }, [props.enabled]);
  return null;
}

const LOOK_LISTENERS = {
  canvas: ["mousedown"],
  doc: ["mousemove", "mouseup", "pointerlockchange", "pointerlockerror", "visibilitychange"],
  win: ["blur", "pagehide"],
} as const;

test("look listeners live in an effect: one set per mount, clean remount, lock released", async () => {
  const previousWindow = (globalThis as { window?: unknown }).window;
  const { doc, canvas, win } = fakeDom();
  Object.assign(canvas, {
    requestPointerLock(): void {
      doc.pointerLockElement = canvas;
      doc.emit("pointerlockchange");
    },
  });
  (globalThis as { window?: unknown }).window = win;
  const state = createPvpLookState(0);

  const element = (): React.ReactElement =>
    React.createElement(
      React.StrictMode,
      null,
      React.createElement(LookProbe, {
        state,
        canvas: canvas as unknown as HTMLElement,
        enabled: true,
      }),
    );

  const assertOneSet = (where: string): void => {
    for (const type of LOOK_LISTENERS.canvas) {
      assert.equal(canvas.count(type), 1, `${where}: canvas ${type} count ${canvas.count(type)}`);
    }
    for (const type of LOOK_LISTENERS.doc) {
      assert.equal(doc.count(type), 1, `${where}: doc ${type} count ${doc.count(type)}`);
    }
    for (const type of LOOK_LISTENERS.win) {
      assert.equal(win.count(type), 1, `${where}: window ${type} count ${win.count(type)}`);
    }
  };

  // Mount: exactly one listener set.
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(element());
  });
  assertOneSet("mount");

  // Take the lock and prove a single move is collected once, not doubled.
  canvas.emit("mousedown", { button: 0, target: { tagName: "CANVAS" } });
  assert.equal(state.pointerLocked, true);
  state.pendingX = 0;
  doc.emit("mousemove", { movementX: 30, movementY: 0 });
  assert.equal(state.pendingX, 30, "a single move must be collected exactly once");
  drainLook(state);

  // Unmount: every listener removed, and the owned lock released.
  await act(async () => {
    renderer.unmount();
  });
  for (const type of LOOK_LISTENERS.canvas) assert.equal(canvas.count(type), 0, `unmount canvas ${type}`);
  for (const type of LOOK_LISTENERS.doc) assert.equal(doc.count(type), 0, `unmount doc ${type}`);
  for (const type of LOOK_LISTENERS.win) assert.equal(win.count(type), 0, `unmount win ${type}`);
  assert.equal(doc.pointerLockElement, null, "the owned pointer lock was released on teardown");

  // Remount: back to exactly one set, and a single move is still collected once — proof
  // there is no leaked listener from the previous mount doubling the delta.
  await act(async () => {
    renderer = TestRenderer.create(element());
  });
  assertOneSet("remount");
  canvas.emit("mousedown", { button: 0, target: { tagName: "CANVAS" } });
  state.pendingX = 0;
  doc.emit("mousemove", { movementX: 25, movementY: 0 });
  assert.equal(state.pendingX, 25, "after remount a move is collected once, not duplicated");

  await act(async () => {
    renderer.unmount();
  });
  (globalThis as { window?: unknown }).window = previousWindow;
});
