import { test } from "node:test";
import assert from "node:assert/strict";

// Canvas input ownership (item 3), exercised with real bubbling events whose target is
// the canvas, a HUD button, or a form control.
//
// The rules: the canvas exclusively owns gameplay pointer input; a HUD/form target
// never emits fire, dodge or a movement key; the first unlocked primary click CAPTURES
// (never fires); a locked primary fires; an unlocked fallback distinguishes a short
// click (fire) from a drag (look); right click dodges and suppresses the context menu
// only on the canvas; held movement and every edge clear on blur/visibility/pagehide/
// disable/detach/question.

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

const { createDuelInput } = await import("../src/duel/duelInput.js");

interface Harness {
  input: ReturnType<typeof createDuelInput>;
  canvas: FakeTarget & { ownerDocument: unknown };
  doc: FakeTarget & { pointerLockElement: unknown };
  win: FakeTarget;
  now: { ms: number };
  detach: () => void;
}

function harness(): Harness {
  const doc = Object.assign(new FakeTarget(), { pointerLockElement: null as unknown, hidden: false });
  const canvas = Object.assign(new FakeTarget(), { ownerDocument: doc });
  const win = new FakeTarget();
  const now = { ms: 0 };
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = win;
  const input = createDuelInput({ mode: "pvp", now: () => now.ms });
  const detachFn = input.attach(canvas as unknown as HTMLElement);
  (globalThis as { window?: unknown }).window = previous;
  return {
    input,
    canvas: canvas as Harness["canvas"],
    doc: doc as Harness["doc"],
    win,
    now,
    detach: () => {
      (globalThis as { window?: unknown }).window = win;
      detachFn();
      (globalThis as { window?: unknown }).window = previous;
    },
  };
}

const CANVAS_TARGET = { tagName: "CANVAS" };
const BUTTON_TARGET = { tagName: "BUTTON" };
const TEXTAREA_TARGET = { tagName: "TEXTAREA" };

test("the first unlocked primary click captures and NEVER fires; a locked one fires", () => {
  const h = harness();
  h.canvas.emit("mousedown", { button: 0, target: CANVAS_TARGET });
  assert.equal(h.input.pending().fire, false, "the capture click must not fire");

  // Now the browser has granted the lock: a primary click fires.
  h.doc.pointerLockElement = h.canvas;
  h.canvas.emit("mousedown", { button: 0, target: CANVAS_TARGET });
  assert.equal(h.input.pending().fire, true, "a locked primary fires");
  h.detach();
});

test("an unlocked fallback fires a short click but not a drag", () => {
  const h = harness();
  // Lock refused, so we stay unlocked. First click establishes the fallback capture.
  h.canvas.emit("mousedown", { button: 0, target: CANVAS_TARGET });
  assert.equal(h.input.pending().fire, false);

  // A short, still press fires.
  h.canvas.emit("mousedown", { button: 0, target: CANVAS_TARGET });
  h.doc.emit("mouseup", { button: 0 });
  assert.equal(h.input.pending().fire, true, "a short click in the fallback fires");
  h.input.cancel();

  // A press that travels is a drag-look, not a fire.
  h.canvas.emit("mousedown", { button: 0, target: CANVAS_TARGET });
  h.doc.emit("mousemove", { movementX: 40, movementY: 0 });
  h.doc.emit("mouseup", { button: 0 });
  assert.equal(h.input.pending().fire, false, "a drag must not fire");
  h.detach();
});

test("right click dodges and the context menu is suppressed on the canvas", () => {
  const h = harness();
  h.canvas.emit("mousedown", { button: 2, target: CANVAS_TARGET });
  assert.equal(h.input.pending().dodge, true, "right click dodges");
  let prevented = false;
  h.canvas.emit("contextmenu", { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true, "the context menu is suppressed on the canvas");
  h.detach();
});

test("a HUD button or a form control never emits fire, dodge, or a movement key", () => {
  const h = harness();
  h.doc.pointerLockElement = h.canvas; // even locked, a control target is not gameplay
  h.canvas.emit("mousedown", { button: 0, target: BUTTON_TARGET });
  h.canvas.emit("mousedown", { button: 2, target: BUTTON_TARGET });
  assert.equal(h.input.pending().fire, false, "a button never fires");
  assert.equal(h.input.pending().dodge, false, "a button never dodges");

  // A movement key typed into a textarea must not move the fighter.
  h.win.emit("keydown", { code: "KeyW", target: TEXTAREA_TARGET, repeat: false });
  assert.ok(Math.abs(h.input.sampleIntent().intent.moveZ) < 1e-9, "WASD in a form does not move");
  // The same key on the canvas/body does move.
  h.win.emit("keydown", { code: "KeyW", target: CANVAS_TARGET, repeat: false });
  assert.ok(h.input.sampleIntent().intent.moveZ > 0, "WASD on the canvas moves");
  h.detach();
});

test("held movement and every edge clear on blur, visibility loss, pagehide and detach", () => {
  for (const event of ["blur", "pagehide"] as const) {
    const h = harness();
    h.doc.pointerLockElement = h.canvas;
    h.win.emit("keydown", { code: "KeyW", target: CANVAS_TARGET, repeat: false });
    h.canvas.emit("mousedown", { button: 0, target: CANVAS_TARGET });
    assert.equal(h.input.pending().fire, true);
    h.win.emit(event, {});
    assert.equal(h.input.pending().fire, false, `${event} clears the edge`);
    assert.ok(Math.abs(h.input.sampleIntent().intent.moveZ) < 1e-9, `${event} clears held movement`);
    h.detach();
  }

  const hv = harness();
  hv.doc.pointerLockElement = hv.canvas;
  hv.canvas.emit("mousedown", { button: 0, target: CANVAS_TARGET });
  assert.equal(hv.input.pending().fire, true);
  hv.doc.hidden = true;
  hv.doc.emit("visibilitychange", {});
  assert.equal(hv.input.pending().fire, false, "a hidden tab clears the edge");
  hv.detach();
});

test("detach removes every listener it added", () => {
  const h = harness();
  h.detach();
  assert.equal(h.canvas.count("mousedown"), 0);
  assert.equal(h.canvas.count("contextmenu"), 0);
  for (const type of ["mousemove", "mouseup", "pointerlockchange", "visibilitychange"]) {
    assert.equal(h.doc.count(type), 0, `document still has a ${type} listener`);
  }
  for (const type of ["keydown", "keyup", "blur", "pagehide"]) {
    assert.equal(h.win.count(type), 0, `window still has a ${type} listener`);
  }
});
