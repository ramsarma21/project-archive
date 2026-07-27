import { test } from "node:test";
import assert from "node:assert/strict";
import { RUN_SPEED, WALK_SPEED } from "@pa/engine-world";
import { createSnapshotFeed } from "../src/pvp/arenaFeed.js";
import type { MatchSnapshot } from "../src/pvp/protocol.js";
import {
  VISUAL_ROLE_DWELL_S,
  createVisualStabilizer,
  selectActorVisual,
  stabilizeActorVisual,
  type ActorVisualInput,
} from "../src/duel/actorVisual.js";

// Opponent presentation smoothness (item B): yaw is interpolated between bracketing
// authoritative snapshots the same as position, and the animation state is stabilized
// so it does not flicker from raw per-snapshot velocity. Neither changes authority:
// every drawn position/yaw is a snapshot value or a point between two of them.

// ---- pointer-lock loss clears held movement (item A/4) ----------------------

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
}

const { createDuelInput } = await import("../src/duel/duelInput.js");

test("losing the pointer lock clears held movement but keeps a queued edge", () => {
  const doc = Object.assign(new FakeTarget(), { pointerLockElement: null as unknown, hidden: false });
  const canvas = Object.assign(new FakeTarget(), { ownerDocument: doc });
  const win = new FakeTarget();
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = win;
  const input = createDuelInput({ mode: "pvp" });
  const detach = input.attach(canvas as unknown as HTMLElement);
  (globalThis as { window?: unknown }).window = previous;

  doc.pointerLockElement = canvas;
  win.emit("keydown", { code: "KeyW", target: { tagName: "CANVAS" }, repeat: false, preventDefault() {} });
  canvas.emit("mousedown", { button: 2, target: { tagName: "CANVAS" } }); // a dodge edge
  assert.ok(input.sampleIntent().intent.moveZ > 0.9, "moving while locked");
  assert.equal(input.pending().dodge, true);

  // The lock drops (Esc / alt-tab): the movement keyup will land off the game, so held
  // must be cleared here or the fighter walks on its own.
  doc.pointerLockElement = null;
  doc.emit("pointerlockchange", {});
  assert.ok(
    Math.abs(input.sampleIntent().intent.moveZ) < 1e-9,
    "held movement is cleared on pointer-lock loss",
  );
  // The queued dodge is NOT swallowed by an incidental lock blip.
  assert.equal(input.pending().dodge, true, "a queued edge survives a lock blip");

  (globalThis as { window?: unknown }).window = win;
  detach();
  (globalThis as { window?: unknown }).window = previous;
});

// ---- opponent yaw is interpolated between bracketing visible snapshots -------

function snapshot(over: {
  tick: number;
  opponentAimYaw?: number;
  opponentX?: number;
  visible?: boolean;
  positionAtTick?: number;
}): MatchSnapshot {
  return {
    matchId: "pvp_TEST",
    tick: over.tick,
    phase: "ENGAGEMENT_LIVE",
    round: 1,
    self: {
      side: "A",
      position: { x: 0, y: 0, z: -6 },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: 0,
      capsuleHeight: 1.55,
      health: 200,
      ammo: 3,
      dashing: false,
      invulnerableUntilTick: 0,
      dodgeReadyAtTick: 0,
      abilityUsesRemaining: {},
    },
    opponent: {
      side: "B",
      handle: "QuietLantern-1234",
      rank: 1,
      position: { x: over.opponentX ?? 0, y: 0, z: 6 },
      velocity: { x: 0, z: 0 },
      aimYaw: over.opponentAimYaw ?? 0,
      dashing: false,
      capsuleHeight: 1.55,
      health: 200,
      ammo: 3,
      visible: over.visible ?? true,
      positionAtTick: over.positionAtTick ?? over.tick,
      answering: false,
    },
    projectiles: [],
    resumeCountdownSeconds: null,
  };
}

const FRAME_MS = 1000 / 60;

test("opponent yaw glides between two authoritative aim yaws, never snapping per tick", () => {
  const feed = createSnapshotFeed();
  // Facing swings from 0 to ~1.2 rad across three ticks; the presentation must show
  // intermediate facings, not a discrete step at each tick boundary.
  const arrivals = [
    { atMs: 0, snap: snapshot({ tick: 60, opponentAimYaw: 0 }) },
    { atMs: 90, snap: snapshot({ tick: 66, opponentAimYaw: 0.6 }) },
    { atMs: 180, snap: snapshot({ tick: 72, opponentAimYaw: 1.2 }) },
    { atMs: 270, snap: snapshot({ tick: 78, opponentAimYaw: 1.2 }) },
  ];
  let next = 0;
  const yawsInFirstBracket: number[] = [];
  for (let now = 0; now <= 900; now += FRAME_MS) {
    while (next < arrivals.length && arrivals[next]!.atMs <= now) {
      feed.observe(arrivals[next]!.snap, arrivals[next]!.atMs);
      next += 1;
    }
    const s = feed.sample(now);
    if (!s || s.opponent.kind !== "IN_SIGHT") continue;
    if (s.tick > 60 && s.tick < 66) yawsInFirstBracket.push(s.opponent.pose.yaw);
  }
  assert.ok(yawsInFirstBracket.length > 0, "presentation passed through the first bracket");
  // Values strictly between 0 and 0.6 prove interpolation rather than a snap to an end.
  assert.ok(
    yawsInFirstBracket.some((y) => y > 0.05 && y < 0.55),
    `expected intermediate yaws, saw ${yawsInFirstBracket.map((y) => y.toFixed(2)).join(",")}`,
  );
  // And it is monotonic across the bracket — a smooth turn, no wobble.
  for (let i = 1; i < yawsInFirstBracket.length; i += 1) {
    assert.ok(yawsInFirstBracket[i]! >= yawsInFirstBracket[i - 1]! - 1e-9, "yaw turns smoothly");
  }
});

test("a remembered (out-of-sight) opponent facing is held, never interpolated across the edge", () => {
  const feed = createSnapshotFeed();
  // The server freezes facing WITH the position when the sight line breaks, so every
  // invisible snapshot carries the last visible yaw (0.2). The presentation must hold it
  // constant: yaw interpolation is gated on BOTH ends being visible, so crossing into an
  // invisible newer end never ramps the facing.
  const arrivals = [
    { atMs: 0, snap: snapshot({ tick: 60, opponentAimYaw: 0.2, visible: true }) },
    { atMs: 90, snap: snapshot({ tick: 66, opponentAimYaw: 0.2, visible: false, positionAtTick: 60 }) },
    { atMs: 180, snap: snapshot({ tick: 72, opponentAimYaw: 0.2, visible: false, positionAtTick: 60 }) },
    { atMs: 270, snap: snapshot({ tick: 78, opponentAimYaw: 0.2, visible: false, positionAtTick: 60 }) },
  ];
  let next = 0;
  let sawLastSeen = false;
  for (let now = 0; now <= 900; now += FRAME_MS) {
    while (next < arrivals.length && arrivals[next]!.atMs <= now) {
      feed.observe(arrivals[next]!.snap, arrivals[next]!.atMs);
      next += 1;
    }
    const s = feed.sample(now);
    if (!s) continue;
    // Across the whole run — the visible tick-60 window AND every remembered frame — the
    // facing never deviates from the frozen 0.2. Any ramp toward an invisible end shows here.
    assert.ok(Math.abs(s.opponent.pose.yaw - 0.2) < 1e-9, `facing ramped to ${s.opponent.pose.yaw}`);
    if (s.opponent.kind === "LAST_SEEN") sawLastSeen = true;
  }
  assert.ok(sawLastSeen, "presentation reached the remembered (out-of-sight) frames");
});

// ---- the animation stabilizer suppresses per-snapshot flicker ---------------

function visualInput(over: Partial<ActorVisualInput> = {}): ActorVisualInput {
  return {
    phase: "ENGAGEMENT_LIVE",
    faceOffElapsedS: 0,
    tick: 600,
    downed: false,
    crouched: false,
    speedMps: 0,
    travelOffFacing: 0,
    dashing: false,
    lastFireTick: -1,
    lastHitTick: -1,
    ...over,
  };
}

test("raw per-snapshot velocity flickers the role; the stabilizer holds it steady", () => {
  const threshold = (WALK_SPEED + RUN_SPEED) / 2;

  // The unstabilized selector flips role on every frame that straddles the threshold.
  let rawFlips = 0;
  let rawPrev: string | null = null;
  for (let f = 0; f < 60; f += 1) {
    const speed = f % 2 === 0 ? threshold + 0.6 : threshold - 0.6;
    const role = selectActorVisual(visualInput({ speedMps: speed })).role;
    if (rawPrev !== null && role !== rawPrev) rawFlips += 1;
    rawPrev = role;
  }
  assert.ok(rawFlips > 20, `raw selection should flicker, saw ${rawFlips} flips`);

  // The stabilizer, fed the same jitter at 60Hz, smooths the speed and debounces the
  // role: it settles and barely changes.
  const state = createVisualStabilizer();
  let flips = 0;
  let prev: string | null = null;
  for (let f = 0; f < 60; f += 1) {
    const speed = f % 2 === 0 ? threshold + 0.6 : threshold - 0.6;
    const role = stabilizeActorVisual(state, visualInput({ speedMps: speed }), 1 / 60).role;
    if (prev !== null && role !== prev) flips += 1;
    prev = role;
  }
  assert.ok(flips <= 2, `the stabilizer should not flicker, saw ${flips} flips`);
});

test("the stabilizer still commits a sustained gait change, just not instantly", () => {
  const state = createVisualStabilizer();
  // Prime at rest.
  assert.equal(stabilizeActorVisual(state, visualInput({ speedMps: 0 }), 1 / 60).role, "aim");
  // Hold a real run for well past the dwell + smoothing: it must reach aimRun.
  let role = "aim";
  for (let t = 0; t < 0.6 * 60; t += 1) {
    role = stabilizeActorVisual(state, visualInput({ speedMps: RUN_SPEED }), 1 / 60).role;
  }
  assert.equal(role, "aimRun", "a sustained run commits to the run cycle");
});

test("event roles read on the frame they happen, never debounced", () => {
  const state = createVisualStabilizer();
  // Settle into a run first.
  for (let t = 0; t < 0.6 * 60; t += 1) {
    stabilizeActorVisual(state, visualInput({ speedMps: RUN_SPEED }), 1 / 60);
  }
  // A hit lands this frame: it must show immediately, not after a dwell.
  const hit = stabilizeActorVisual(
    state,
    visualInput({ speedMps: RUN_SPEED, lastHitTick: 600, tick: 600 }),
    1 / 60,
  );
  assert.equal(hit.role, "hit", "a hit reads on its own frame");
  // A dash likewise.
  const dash = stabilizeActorVisual(
    state,
    visualInput({ speedMps: RUN_SPEED, dashing: true }),
    1 / 60,
  );
  assert.equal(dash.role, "roll", "a roll reads on its own frame");
});

test("the debounce window is short enough to be imperceptible", () => {
  // A guard on the tuning: a dwell longer than ~a sixth of a second would read as input
  // lag on a legitimate gait change, which is the opposite failure.
  assert.ok(VISUAL_ROLE_DWELL_S > 0 && VISUAL_ROLE_DWELL_S <= 1 / 6, `dwell ${VISUAL_ROLE_DWELL_S}s`);
});
