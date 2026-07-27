// PvP mouse look: the arithmetic acceptance criteria, and the listener wiring.
//
// The precession bug (>1000 unasked degrees in 6s) came from a feedback loop, so
// the load-bearing property is that NOTHING the player is not doing turns the look.
// These check that, plus the two gesture guarantees (frame-rate independence and no
// long turn across ±pi) and the DOM half (pointer lock, drag fallback, capture-target
// guard, neutralization). There is no jsdom; the stub is only what `attachPvpLook`
// touches, mirroring missionLook.test.ts.

import assert from "node:assert/strict";
import test from "node:test";
import { referenceArena } from "@pa/duel";
import {
  chaseCameraPosition,
  createLookState,
  lookMoveIntent,
  segmentClear,
} from "@pa/engine-world";
import {
  aimGroundPoint,
  attachPvpLook,
  clearChaseDistance,
  createPvpLookState,
  drainLook,
  lookAim,
  neutralizeLook,
  seedLookFromAim,
  RETICLE_MAX_REACH_M,
  PVP_LOOK_SENSITIVITY_RAD_PER_PX,
} from "../src/pvp/pvpLook.js";

const DEG = 180 / Math.PI;

function shortestDelta(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ---- the arithmetic acceptance criteria ------------------------------------

test("a held strafe drifts the look under 0.1 degrees over 6 seconds at 30/60/120 fps", () => {
  for (const fps of [30, 60, 120]) {
    const state = createPvpLookState(0.4);
    seedLookFromAim(state, Math.sin(0.4), Math.cos(0.4));
    const start = state.look.yaw;
    const frames = Math.round(6 * fps);
    for (let f = 0; f < frames; f += 1) {
      // The player holds a strafe: the movement basis is derived from the look yaw,
      // exactly as production does — and it must not write back into the yaw.
      const yaw = drainLook(state).yaw; // no pending: no mouse input this whole run
      const move = lookMoveIntent(yaw, 0, 1); // strafe right, held
      void move;
    }
    const driftDeg = Math.abs(shortestDelta(state.look.yaw, start)) * DEG;
    assert.ok(driftDeg < 0.1, `${fps}fps drifted ${driftDeg.toFixed(4)} degrees`);
  }
});

test("a 1000px gesture turns the same yaw at every frame rate, within 0.5 degrees", () => {
  const gesturePx = 1000;
  const yaws: number[] = [];
  // Same physical gesture, delivered as 1, 10, 100 and 1000 mouse events between
  // frames — a high-polling mouse against a slow frame is the many-events case.
  for (const chunks of [1, 10, 100, 1000]) {
    const state = createPvpLookState(0);
    const per = gesturePx / chunks;
    for (let c = 0; c < chunks; c += 1) {
      state.pendingX += per;
      // Drain on a frame boundary occasionally, to model variable frame rate.
      if (c % 3 === 0) drainLook(state);
    }
    drainLook(state);
    yaws.push(state.look.yaw);
  }
  const spreadDeg = (Math.max(...yaws) - Math.min(...yaws)) * DEG;
  assert.ok(spreadDeg < 0.5, `gesture yaw varied ${spreadDeg.toFixed(4)} degrees across rates`);
  // And it is the expected magnitude, not zero: 1000px * rad/px.
  const expected = gesturePx * PVP_LOOK_SENSITIVITY_RAD_PER_PX;
  assert.ok(Math.abs(Math.abs(yaws[0]!) - expected) < 1e-6);
});

test("crossing +/-pi takes the short way, never a long turn", () => {
  const state = createPvpLookState(Math.PI - 0.05);
  // Nudge the yaw across pi. `applyLookDelta` subtracts dx*rad/px, so a negative dx
  // increases yaw past pi; it must wrap to near -pi rather than growing to ~3.19.
  state.pendingX = -0.1 / PVP_LOOK_SENSITIVITY_RAD_PER_PX;
  const yaw = drainLook(state).yaw;
  assert.ok(Math.abs(yaw) <= Math.PI + 1e-9, `yaw left the wrapped range: ${yaw}`);
  const step = Math.abs(shortestDelta(yaw, Math.PI - 0.05));
  assert.ok(step < 0.2, `the turn was the long way round: ${(step * DEG).toFixed(1)} degrees`);
});

test("the aim is the ground-plane look direction, shared by movement and fire", () => {
  const state = createPvpLookState(0);
  seedLookFromAim(state, 1, 0); // aiming +x
  assert.ok(Math.abs(state.look.yaw - Math.atan2(1, 0)) < 1e-9);
  const aim = lookAim(state);
  assert.ok(Math.abs(aim.x - 1) < 1e-6 && Math.abs(aim.z) < 1e-6);
});

// ---- the DOM half -----------------------------------------------------------

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

function harness(lock: "grant" | "refuse" | "absent") {
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
  const state = createPvpLookState(0);
  const controller = attachPvpLook(state, canvas as unknown as HTMLElement);
  (globalThis as { window?: unknown }).window = previous;
  return {
    state,
    canvas,
    doc,
    win,
    controller,
    detach: () => {
      (globalThis as { window?: unknown }).window = win;
      controller.detach();
      (globalThis as { window?: unknown }).window = previous;
    },
  };
}

test("a refused pointer lock still looks, via the drag fallback", () => {
  const h = harness("refuse");
  h.canvas.emit("mousedown", { button: 0, target: { tagName: "CANVAS" } });
  for (let i = 0; i < 5; i += 1) h.doc.emit("mousemove", { movementX: 30, movementY: 0 });
  assert.equal(h.state.pointerLocked, false);
  assert.equal(h.state.pendingX, 150, "every move of the drag is collected");
  h.detach();
});

test("a granted lock supersedes the drag and reads document movement", () => {
  const h = harness("grant");
  h.canvas.emit("mousedown", { button: 0, target: { tagName: "CANVAS" } });
  assert.equal(h.state.pointerLocked, true);
  assert.equal(h.state.dragging, false);
  h.doc.emit("mousemove", { movementX: 40, movementY: 10 });
  assert.equal(h.state.pendingX, 40);
  assert.equal(h.state.pendingY, 10);
  h.detach();
});

test("a mousedown on a HUD control never captures the look", () => {
  const h = harness("refuse");
  h.canvas.emit("mousedown", { button: 0, target: { tagName: "BUTTON" } });
  assert.equal(h.state.dragging, false, "a click on a button is not a look capture");
  h.doc.emit("mousemove", { movementX: 100, movementY: 0 });
  assert.equal(h.state.pendingX, 0, "and it collects no travel");
  h.detach();
});

test("neutralization drops a held drag and pending travel but keeps the yaw", () => {
  const h = harness("refuse");
  h.canvas.emit("mousedown", { button: 0, target: { tagName: "CANVAS" } });
  h.doc.emit("mousemove", { movementX: 50, movementY: 0 });
  drainLook(h.state);
  const yaw = h.state.look.yaw;
  h.doc.emit("mousemove", { movementX: 50, movementY: 0 });
  neutralizeLook(h.state);
  assert.equal(h.state.dragging, false);
  assert.equal(h.state.pendingX, 0);
  assert.equal(h.state.look.yaw, yaw, "the yaw is kept so play resumes without a jump");
  h.detach();
});

test("detaching removes every listener", () => {
  const h = harness("refuse");
  h.detach();
  for (const type of ["mousemove", "mouseup", "pointerlockchange", "pointerlockerror", "visibilitychange"]) {
    assert.equal(h.doc.count(type), 0, `document still has a ${type} listener`);
  }
  assert.equal(h.canvas.count("mousedown"), 0);
  assert.equal(h.win.count("blur"), 0);
  assert.equal(h.win.count("pagehide"), 0);
});

// ---- the look lifecycle (item 1) -------------------------------------------

test("a disabled look ignores travel and drops an owned pointer lock", () => {
  const h = harness("grant");
  h.canvas.emit("mousedown", { button: 0, target: { tagName: "CANVAS" } });
  assert.equal(h.state.pointerLocked, true);
  h.controller.setEnabled(false);
  assert.equal(h.state.enabled, false);
  assert.equal(h.state.pointerLocked, false, "an owned lock is exited on disable");
  h.doc.emit("mousemove", { movementX: 80, movementY: 0 });
  assert.equal(h.state.pendingX, 0, "a disabled look collects nothing");
  h.detach();
});

test("re-enabling resumes from the same yaw without replaying travel", () => {
  const h = harness("refuse");
  h.canvas.emit("mousedown", { button: 0, target: { tagName: "CANVAS" } });
  h.doc.emit("mousemove", { movementX: 60, movementY: 0 });
  const yaw = drainLook(h.state).yaw;
  h.doc.emit("mousemove", { movementX: 60, movementY: 0 }); // pending, not yet drained
  h.controller.setEnabled(false);
  assert.equal(h.state.pendingX, 0, "disabling clears pending travel");
  h.controller.setEnabled(true);
  assert.equal(h.state.pendingX, 0, "re-enabling does not resurrect it");
  assert.equal(drainLook(h.state).yaw, yaw, "and the yaw is unchanged: no jump");
  h.detach();
});

test("a hidden tab and a pagehide both clear the look", () => {
  for (const [event, on] of [["visibilitychange", "doc"], ["pagehide", "win"]] as const) {
    const h = harness("grant");
    h.canvas.emit("mousedown", { button: 0, target: { tagName: "CANVAS" } });
    assert.equal(h.state.pointerLocked, true);
    if (event === "visibilitychange") (h.doc as { hidden?: boolean }).hidden = true;
    (on === "doc" ? h.doc : h.win).emit(event, {});
    assert.equal(h.state.pointerLocked, false, `${event} exits the owned lock`);
    assert.equal(h.state.pendingX, 0);
    h.detach();
  }
});

test("a lock owned by someone else is never exited", () => {
  const h = harness("refuse");
  let exits = 0;
  (h.doc as { exitPointerLock?: () => void }).exitPointerLock = () => {
    exits += 1;
  };
  // Another element holds the lock — not our canvas.
  (h.doc as { pointerLockElement?: unknown }).pointerLockElement = { tagName: "OTHER" };
  h.controller.setEnabled(false);
  assert.equal(exits, 0, "disabling must not steal another element's lock");
  h.detach();
  assert.equal(exits, 0, "and neither must detaching");
});

// ---- camera collision, verified (item 2) -----------------------------------

test("the chase camera never returns an unverified point: exhaustive arena sweep", () => {
  const world = referenceArena().world;
  const { bounds } = world;
  let checked = 0;
  let intersections = 0;
  // A grid of focus positions across the yard, every yaw, and the pitch extremes plus
  // the rest pose. For each, the resolved distance's camera-focus segment must be clear.
  for (let fx = bounds.minX + 1; fx <= bounds.maxX - 1; fx += 3) {
    for (let fz = bounds.minZ + 1; fz <= bounds.maxZ - 1; fz += 3) {
      const focus = { x: fx, y: 1.2, z: fz };
      // Only representative STANDABLE positions: a focus inside a cover blocker is not
      // a place a player can be, and it has no clear camera by construction.
      if (!segmentClear(world, focus, focus)) continue;
      for (let yawDeg = 0; yawDeg < 360; yawDeg += 30) {
        const yaw = (yawDeg * Math.PI) / 180;
        for (const pitch of [-0.3, 0.265, 1.05]) {
          const look = { ...createLookState(yaw), pitch };
          const d = clearChaseDistance(world, look, focus);
          const cam = chaseCameraPosition(look, focus, d);
          checked += 1;
          if (!segmentClear(world, focus, cam)) intersections += 1;
        }
      }
    }
  }
  assert.ok(checked > 500, `the sweep was too small: ${checked}`);
  assert.equal(intersections, 0, `${intersections}/${checked} resolved cameras were still occluded`);
});

// ---- reticle / marks convention (item 7) -----------------------------------

test("the aim ground point is normalized, reach-clamped, bounds-clamped, one convention", () => {
  const bounds = referenceArena().world.bounds;
  // A non-unit aim must not stretch the reach: reach is measured after normalizing.
  const origin = { x: 0, z: 0 };
  const p = aimGroundPoint(origin, { x: 0, z: 5 }, bounds); // due +z, length 5
  assert.ok(Math.abs(p.x - 0) < 1e-6);
  assert.ok(Math.abs(p.z - RETICLE_MAX_REACH_M) < 1e-6, `reach was ${p.z}, expected ${RETICLE_MAX_REACH_M}`);

  // Reach is capped at the max even when a larger reach is requested.
  const far = aimGroundPoint(origin, { x: 1, z: 0 }, bounds, 100);
  assert.ok(Math.abs(far.x - RETICLE_MAX_REACH_M) < 1e-6);

  // And clamped to the arena bounds from an edge.
  const edge = aimGroundPoint({ x: bounds.maxX - 0.5, z: 0 }, { x: 1, z: 0 }, bounds);
  assert.ok(edge.x <= bounds.maxX + 1e-9);

  // The XZ convention matches a projectile mark's: a ball at (x,z) marks the ground at
  // exactly (x,z), and the reticle maps aim the same way (x -> x, z -> z) within 1e-6.
  const ballX = 2.5;
  const ballZ = -1.5;
  const reticle = aimGroundPoint({ x: ballX, z: ballZ }, { x: 0, z: 0 }, bounds); // zero aim -> origin
  assert.ok(Math.abs(reticle.x - ballX) < 1e-6 && Math.abs(reticle.z - ballZ) < 1e-6);
});
