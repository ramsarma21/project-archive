// The DOM half of mouse look.
//
// @pa/engine-world's playerLook tests cover what a look IS — that travel turns
// it, that pitch clamps, that a held strafe cannot precess it. None of that can
// catch the bug the owner actually hit, because the failure was not in the
// arithmetic: every delta was correct and none of them were ever delivered.
//
// The listener wiring is the part with states in it, so it is the part worth a
// test. Specifically: a REFUSED POINTER LOCK MUST NOT END THE DRAG. The drag is
// the fallback for a refused lock, and `pointerlockerror` was wired straight to
// the same handler as `mouseup` — so the fallback was torn down a few hundred
// microseconds after being set up, in exactly the case it exists to cover. The
// symptom is a held button and a camera that moves once and then stops, which
// is indistinguishable from mouse look not being implemented.
//
// There is no jsdom here, and adding one for six event types would be a heavier
// dependency than the thing under test. The stub below is only what
// `attachMissionLook` actually touches.

import assert from "node:assert/strict";
import test from "node:test";

import {
  attachMissionLook,
  createMissionLookState,
  drainLook,
} from "../src/mission/missionLook.js";

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

interface Harness {
  canvas: FakeTarget & {
    ownerDocument: unknown;
    requestPointerLock?: () => Promise<void> | void;
  };
  doc: FakeTarget & { pointerLockElement: unknown; exitPointerLock?: () => void };
  win: FakeTarget;
  detach: () => void;
}

/**
 * @param lock how the browser answers `requestPointerLock`: grant it, refuse it
 *   with the error event a real Chrome fires, or have no such API at all.
 */
function harness(lock: "grant" | "refuse" | "absent"): {
  state: ReturnType<typeof createMissionLookState>;
  parts: Harness;
} {
  const doc = Object.assign(new FakeTarget(), {
    pointerLockElement: null as unknown,
    exitPointerLock: () => {
      doc.pointerLockElement = null;
      doc.emit("pointerlockchange");
    },
  });
  const canvas = Object.assign(new FakeTarget(), { ownerDocument: doc });
  const win = new FakeTarget();

  if (lock !== "absent") {
    Object.assign(canvas, {
      requestPointerLock: () => {
        if (lock === "grant") {
          doc.pointerLockElement = canvas;
          doc.emit("pointerlockchange");
        } else {
          doc.emit("pointerlockerror");
        }
      },
    });
  }

  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = win;
  const state = createMissionLookState(0);
  const unbind = attachMissionLook(
    state,
    canvas as unknown as HTMLElement,
  );
  (globalThis as { window?: unknown }).window = previous;

  return {
    state,
    parts: {
      canvas: canvas as Harness["canvas"],
      doc: doc as Harness["doc"],
      win,
      detach: () => {
        (globalThis as { window?: unknown }).window = win;
        unbind();
        (globalThis as { window?: unknown }).window = previous;
      },
    },
  };
}

function dragRight(parts: Harness, moves: number, pixelsEach: number): void {
  parts.canvas.emit("mousedown", { button: 0 });
  for (let step = 0; step < moves; step += 1) {
    parts.doc.emit("mousemove", { movementX: pixelsEach, movementY: 0 });
  }
}

test("a refused pointer lock leaves the drag fallback working", () => {
  const { state, parts } = harness("refuse");
  dragRight(parts, 5, 30);

  assert.equal(
    state.pointerLocked,
    false,
    "the lock was refused, so nothing should think it is held",
  );
  assert.equal(
    state.pendingX,
    150,
    "every move of the drag must be collected; the regression collected only the first",
  );

  const look = drainLook(state);
  assert.ok(look.yaw !== 0, "and the drained travel must actually turn the look");
  parts.detach();
});

test("a granted pointer lock takes over from the drag", () => {
  const { state, parts } = harness("grant");
  parts.canvas.emit("mousedown", { button: 0 });

  assert.equal(state.pointerLocked, true);
  assert.equal(state.dragging, false, "a granted lock supersedes the drag");

  parts.doc.emit("mousemove", { movementX: 40, movementY: 10 });
  assert.equal(state.pendingX, 40);
  assert.equal(state.pendingY, 10);
  parts.detach();
});

test("a browser with no pointer lock at all still looks", () => {
  const { state, parts } = harness("absent");
  dragRight(parts, 3, 25);
  assert.equal(state.pendingX, 75);
  parts.detach();
});

test("the drag ends on mouseup and on losing the window, and only then", () => {
  const { state, parts } = harness("refuse");
  dragRight(parts, 2, 20);
  assert.equal(state.dragging, true);
  parts.doc.emit("mouseup", {});
  assert.equal(state.dragging, false);
  parts.doc.emit("mousemove", { movementX: 100, movementY: 0 });
  assert.equal(state.pendingX, 40, "a released button must stop collecting travel");

  dragRight(parts, 1, 10);
  assert.equal(state.dragging, true);
  parts.win.emit("blur");
  assert.equal(state.dragging, false, "losing the window must not leave the camera captured");
  parts.detach();
});

test("a warped pointer cannot fling the camera", () => {
  const { state, parts } = harness("refuse");
  parts.canvas.emit("mousedown", { button: 0 });
  parts.doc.emit("mousemove", { movementX: 99999, movementY: -99999 });
  assert.ok(Math.abs(state.pendingX) <= 260);
  assert.ok(Math.abs(state.pendingY) <= 260);

  parts.doc.emit("mousemove", { movementX: Number.NaN, movementY: undefined });
  assert.ok(Number.isFinite(state.pendingX), "a non-finite delta must not poison the look");
  parts.detach();
});

test("detaching removes every listener it added", () => {
  const { parts } = harness("refuse");
  parts.detach();
  for (const type of ["mousemove", "mouseup", "pointerlockchange", "pointerlockerror"]) {
    assert.equal(parts.doc.count(type), 0, `document still has a ${type} listener`);
  }
  assert.equal(parts.canvas.count("mousedown"), 0);
  assert.equal(parts.win.count("blur"), 0);
});
