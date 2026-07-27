import { test } from "node:test";
import assert from "node:assert/strict";

import { previewThrow, wallFromRect, type CollisionWorld } from "@pa/engine-world";
import {
  createMissionRuntime,
  missionThrowCue,
  previewMissionThrow,
  stepMissionRuntime,
  stepMissionThrowAim,
  throwMissionDiversion,
  throwRefusalMessage,
  THROW_REFUSAL_TICKS,
  type MissionInputFrame,
  type MissionRuntime,
} from "../src/mission/traversal.js";
import {
  attachMissionInput,
  createMissionInputState,
  MISSION_BINDINGS,
} from "../src/mission/missionInput.js";
import { testCivilian, testInstance, testWorld, tickObjective } from "./missionHarness.js";

// ---------------------------------------------------------------------------
// The throw: aim, release, refusal — all as runtime behaviour.
//
// Everything here drives the actual controller and reads the actual state; there
// is no source-string check. The throw is aim-and-release, the preview runs the
// same simulation and the same bodies the live object will, the release consumes
// the exact target that was previewed, a throw that never left the hand stays on
// screen for a fixed window, and nothing is aimed or spent while a UI surface
// owns input.
//
// The thrown OBJECT is still not drawn — it has no imported GLB and a primitive
// stand-in is forbidden — so `liveDiversions` rendering stays a named asset gap.
// ---------------------------------------------------------------------------

const IDLE: MissionInputFrame = {
  dtS: 1 / 60,
  moveX: 0,
  moveZ: 0,
  sprintHeld: false,
  crouchHeld: false,
  jumpBuffered: false,
  reducedMotion: false,
  flowEnabled: true,
};

/** A corridor with a far wall to aim past, so a clean throw has somewhere to land. */
function throwWorld(): CollisionWorld {
  const base = testWorld();
  return { ...base, blockers: [wallFromRect("far-wall", 0, 14, 6, 0.4)] };
}

function throwRuntime(
  civilians: ReturnType<typeof testCivilian>[] = [],
): MissionRuntime {
  return createMissionRuntime({
    instance: testInstance({
      world: throwWorld(),
      objectives: [tickObjective("never", Number.MAX_SAFE_INTEGER)],
      civilians,
    }),
    seed: 0x51de,
  });
}

function runFor(runtime: MissionRuntime, ticks: number): void {
  for (let step = 0; step < ticks; step += 1) stepMissionRuntime(runtime, IDLE);
}

const AIM = { x: 0, y: 0, z: 13 };

// ---- the preview: real trajectory, real bodies, no cost -------------------

test("the preview solves the real trajectory and spends no charge", () => {
  const runtime = throwRuntime();
  const charges = runtime.stealth.diversions.charges;
  assert.ok(charges > 0, "the run starts with something to throw");

  const preview = previewMissionThrow(runtime, AIM);
  assert.equal(preview.ok, true, "a clear line down the corridor is throwable");
  assert.ok(preview.restsAt, "an accepted throw comes to rest somewhere");
  assert.ok(preview.radiusM > 0, "the landing carries an audible radius to draw");
  assert.ok(preview.samples.length >= 2, "the arc is drawn from real trajectory samples");
  const last = preview.samples[preview.samples.length - 1]!;
  assert.ok(
    Math.abs(last.z - preview.restsAt!.z) < 1e-9,
    "the last sample is where the object rests",
  );

  previewMissionThrow(runtime, AIM);
  assert.equal(
    runtime.stealth.diversions.charges,
    charges,
    "previewing a throw must not spend a charge",
  );
});

test("the preview runs the crowd's bodies, exactly as the live throw does", () => {
  // A screen of bodies across a short throw. The live throw strikes one (that is
  // pinned in missionCrowd.test.ts); the preview must run the same bodies, so the
  // solved flight differs from the same throw with the corridor empty. A preview
  // that ignored the crowd would return an identical result and this would fail.
  const AIM_SHORT = { x: 0, y: 0, z: 6 };
  const screen = [
    testCivilian("civ-1", 0, 4),
    testCivilian("civ-2", -1.1, 4.6),
    testCivilian("civ-3", 1.2, 4.4),
  ];
  // The runtime's body list fills on its first step — the same list the live
  // throw collides against — so step once before aiming, exactly as a player
  // would be aiming mid-run rather than on frame zero.
  const clearRuntime = throwRuntime();
  const screenedRuntime = throwRuntime(screen);
  runFor(clearRuntime, 1);
  runFor(screenedRuntime, 1);
  const clear = previewMissionThrow(clearRuntime, AIM_SHORT);
  const blocked = previewMissionThrow(screenedRuntime, AIM_SHORT);

  assert.ok(clear.ok && clear.restsAt, "the empty corridor throw settles");
  const identical =
    blocked.restsAt !== null &&
    clear.restsAt !== null &&
    Math.abs(blocked.restsAt.x - clear.restsAt.x) < 1e-6 &&
    Math.abs(blocked.restsAt.z - clear.restsAt.z) < 1e-6;
  assert.ok(
    !identical,
    "a civilian in the line changed nothing, so the preview is not running the bodies",
  );
});

test("the displayed samples are the live object's own path, tick for tick", () => {
  const runtime = throwRuntime();
  const preview = previewMissionThrow(runtime, AIM);
  assert.ok(preview.ok && preview.samples.length >= 2);

  assert.equal(throwMissionDiversion(runtime, AIM), true);
  const object = () => runtime.stealth.diversions.live[0]!;
  assert.ok(object(), "the thrown object is tracked");
  assert.ok(
    Math.abs(object().pos.z - preview.samples[0]!.z) < 1e-9,
    "the first sample is the object's release point",
  );

  // Step the field and match each tick to the sample the display drew from. The
  // preview is the same `stepDiversion` against the same (empty) actor set, so
  // the two agree to the float.
  const compareTicks = Math.min(preview.samples.length - 1, 30);
  for (let tick = 1; tick <= compareTicks; tick += 1) {
    stepMissionRuntime(runtime, IDLE);
    const sample = preview.samples[tick]!;
    const live = object().pos;
    assert.ok(
      Math.abs(live.x - sample.x) < 1e-6 &&
        Math.abs(live.y - sample.y) < 1e-6 &&
        Math.abs(live.z - sample.z) < 1e-6,
      `tick ${tick}: live (${live.x.toFixed(3)},${live.z.toFixed(3)}) vs sample (${sample.x.toFixed(3)},${sample.z.toFixed(3)})`,
    );
  }
});

// ---- release: one shot, the latched target, held refusal ------------------

test("release throws exactly once, at the latched target, and spends one charge", () => {
  const runtime = throwRuntime();
  const charges = runtime.stealth.diversions.charges;
  const input = { throwAiming: true, throwReleased: false };

  stepMissionThrowAim(runtime, input, AIM, { uiOwnsInput: false });
  assert.equal(runtime.stealth.diversions.charges, charges, "aiming spends nothing");

  input.throwAiming = false;
  input.throwReleased = true; // the keyup
  stepMissionThrowAim(runtime, input, AIM, { uiOwnsInput: false });
  assert.equal(runtime.stealth.diversions.charges, charges - 1, "release spends one");
  assert.equal(input.throwReleased, false, "the release latch is consumed");

  stepMissionThrowAim(
    runtime,
    { throwAiming: false, throwReleased: false },
    AIM,
    { uiOwnsInput: false },
  );
  assert.equal(
    runtime.stealth.diversions.charges,
    charges - 1,
    "one release is one throw, not a throw a frame",
  );
  assert.equal(runtime.stealth.diversions.live.length, 1, "exactly one object in flight");
});

test("release consumes the latched target, not the aim at release time", () => {
  const runtime = throwRuntime();
  const near = { x: 0, y: 0, z: 5 };
  const input = { throwAiming: true, throwReleased: false };

  // Aim at the far wall — that is what is latched and previewed.
  stepMissionThrowAim(runtime, input, AIM, { uiOwnsInput: false });
  // The look swings to a near point on the same frame the key comes up. The
  // release must ignore this and throw the target the player was shown.
  input.throwAiming = false;
  input.throwReleased = true;
  stepMissionThrowAim(runtime, input, near, { uiOwnsInput: false });

  const object = runtime.stealth.diversions.live[0];
  assert.ok(object, "a throw was issued");
  runFor(runtime, 180);
  assert.ok(
    runtime.stealth.diversions.live[0]!.pos.z > 9,
    "the object flew to the latched far target, not the near aim at release",
  );
});

test("a refused release stays visible for a deterministic window, then clears", () => {
  const runtime = throwRuntime();
  for (let charge = runtime.stealth.diversions.charges; charge > 0; charge -= 1) {
    assert.equal(throwMissionDiversion(runtime, AIM), true);
  }
  assert.equal(runtime.stealth.diversions.charges, 0, "the hand is empty");

  const input = { throwAiming: true, throwReleased: false };
  stepMissionThrowAim(runtime, input, AIM, { uiOwnsInput: false });
  const aiming = missionThrowCue(runtime);
  assert.ok(aiming && !aiming.ok && aiming.refusal === "NO_CHARGES", "aiming shows the refusal");

  input.throwAiming = false;
  input.throwReleased = true;
  const releasedAt = runtime.ticks;
  stepMissionThrowAim(runtime, input, AIM, { uiOwnsInput: false });

  const held = missionThrowCue(runtime);
  assert.ok(held && !held.ok, "the refusal survives the key coming up");
  assert.equal(
    throwRefusalMessage(held!.refusal),
    "Nothing left to throw",
    "and says why, in a line the player can read",
  );

  runtime.ticks = releasedAt + THROW_REFUSAL_TICKS - 1;
  assert.ok(missionThrowCue(runtime), "still on screen inside the window");
  runtime.ticks = releasedAt + THROW_REFUSAL_TICKS;
  assert.equal(missionThrowCue(runtime), null, "gone once the window elapses");
});

test("when a UI surface owns input, aiming and release drop and no charge is spent", () => {
  const runtime = throwRuntime();
  const charges = runtime.stealth.diversions.charges;
  const input = { throwAiming: true, throwReleased: false };

  // Aim, then a modal opens on the very frame the key comes up.
  stepMissionThrowAim(runtime, input, AIM, { uiOwnsInput: false });
  input.throwAiming = false;
  input.throwReleased = true;
  stepMissionThrowAim(runtime, input, AIM, { uiOwnsInput: true });

  assert.equal(runtime.stealth.diversions.charges, charges, "no charge is spent under a modal");
  assert.equal(input.throwAiming, false, "aiming is cleared");
  assert.equal(input.throwReleased, false, "the pending release is dropped, not banked");
  assert.equal(missionThrowCue(runtime), null, "and nothing is drawn");
});

test("refusal messages cover every refusal and leave an accepted throw silent", () => {
  assert.equal(throwRefusalMessage("NONE"), null);
  for (const refusal of ["NO_CHARGES", "OUT_OF_RANGE", "NO_ROOM_TO_THROW"] as const) {
    const message = throwRefusalMessage(refusal);
    assert.ok(message !== null && message.length > 0, `${refusal} must give the player a line`);
  }
});

// ---- the input model: hold, release, and losing input ---------------------

interface FakeTarget {
  addEventListener(type: string, handler: (event: unknown) => void): void;
  removeEventListener(type: string, handler: (event: unknown) => void): void;
  fire(type: string, event: Record<string, unknown>): void;
}

function fakeTarget(): FakeTarget {
  const handlers = new Map<string, Set<(event: unknown) => void>>();
  return {
    addEventListener(type, handler) {
      (handlers.get(type) ?? handlers.set(type, new Set()).get(type)!).add(handler);
    },
    removeEventListener(type, handler) {
      handlers.get(type)?.delete(handler);
    },
    fire(type, event) {
      for (const handler of handlers.get(type) ?? []) {
        handler({
          preventDefault() {},
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          repeat: false,
          target: null,
          ...event,
        });
      }
    },
  };
}

const THROW_CODE = MISSION_BINDINGS.throw.codes[0]!;

test("the throw is held to aim and thrown on release", () => {
  const state = createMissionInputState();
  const target = fakeTarget();
  const detach = attachMissionInput(state, target as unknown as Window);

  assert.equal(state.throwAiming, false);
  assert.equal(state.throwReleased, false);

  target.fire("keydown", { code: THROW_CODE });
  assert.equal(state.throwAiming, true, "holding the key opens the aim");
  assert.equal(state.throwReleased, false, "and does not throw on its own");

  target.fire("keydown", { code: THROW_CODE, repeat: true });
  assert.equal(state.throwReleased, false, "a key repeat is not a release");

  target.fire("keyup", { code: THROW_CODE });
  assert.equal(state.throwAiming, false, "releasing ends the aim");
  assert.equal(state.throwReleased, true, "and is what throws");

  detach();
});

test("a throw key pressed in a text field opens no aim", () => {
  const state = createMissionInputState();
  const target = fakeTarget();
  const detach = attachMissionInput(state, target as unknown as Window);

  target.fire("keydown", { code: THROW_CODE, target: { tagName: "INPUT" } });
  assert.equal(state.throwAiming, false, "typing the key into a control is not aiming");

  detach();
});

test("losing the window mid-aim drops the aim and banks no release", () => {
  const state = createMissionInputState();
  const target = fakeTarget();
  const detach = attachMissionInput(state, target as unknown as Window);

  target.fire("keydown", { code: THROW_CODE });
  assert.equal(state.throwAiming, true);

  target.fire("blur", {});
  assert.equal(state.throwAiming, false, "a blur ends the aim");
  assert.equal(state.throwReleased, false, "and cannot leave a release latched to fire later");

  detach();
});

test("a keyup that lands in a text field while aiming clears the aim without firing", () => {
  const state = createMissionInputState();
  const target = fakeTarget();
  const detach = attachMissionInput(state, target as unknown as Window);

  target.fire("keydown", { code: THROW_CODE });
  assert.equal(state.throwAiming, true);

  // Focus transferred into a field between press and release; the keyup lands on
  // the control. It must not throw, and must not leave the aim stuck on.
  target.fire("keyup", { code: THROW_CODE, target: { tagName: "INPUT" } });
  assert.equal(state.throwAiming, false, "the aim is cleared");
  assert.equal(state.throwReleased, false, "and no release is banked to fire");

  detach();
});

// ---- watcher interception parity ------------------------------------------

test("the preview runs the watchers too, so a constable in the line intercepts it", () => {
  // A screen of watchers across a short throw. The live object collides against
  // watchers as well as civilians, so the preview must run them both — the same
  // ids, poses and heights the field hands `stepDiversion`. A preview that ran
  // only the civilians would show a clear lane straight through a constable.
  const AIM_SHORT = { x: 0, y: 0, z: 6 };
  const poses = [
    { id: "w1", position: { x: 0, y: 0, z: 4 }, baseYaw: 0, capsuleHeight: 1.55 },
    { id: "w2", position: { x: -1.1, y: 0, z: 4.6 }, baseYaw: 0, capsuleHeight: 1.55 },
    { id: "w3", position: { x: 1.2, y: 0, z: 4.4 }, baseYaw: 0, capsuleHeight: 1.55 },
  ];
  const watched = createMissionRuntime({
    instance: testInstance({
      world: throwWorld(),
      objectives: [tickObjective("never", Number.MAX_SAFE_INTEGER)],
      watcherIds: ["w1", "w2", "w3"],
      watcherPosesAtTick: () => poses,
    }),
    seed: 0x51de,
  });
  const clear = throwRuntime();
  // One step so the runtime holds the watcher poses the field was given.
  runFor(watched, 1);
  runFor(clear, 1);

  const withWatchers = previewMissionThrow(watched, AIM_SHORT);
  const without = previewMissionThrow(clear, AIM_SHORT);
  assert.ok(without.ok && without.restsAt, "the empty corridor throw settles");
  const identical =
    withWatchers.restsAt !== null &&
    without.restsAt !== null &&
    Math.abs(withWatchers.restsAt.x - without.restsAt.x) < 1e-6 &&
    Math.abs(withWatchers.restsAt.z - without.restsAt.z) < 1e-6;
  assert.ok(
    !identical,
    "a watcher in the line changed nothing, so the preview is not running the watchers",
  );

  // And parity with the live throw: the object the field flies against the same
  // watchers follows the previewed path, tick for tick.
  assert.equal(throwMissionDiversion(watched, AIM_SHORT), true);
  const object = () => watched.stealth.diversions.live[0]!;
  const compareTicks = Math.min(withWatchers.samples.length - 1, 20);
  for (let tick = 1; tick <= compareTicks; tick += 1) {
    stepMissionRuntime(watched, IDLE);
    const sample = withWatchers.samples[tick]!;
    const live = object().pos;
    assert.ok(
      Math.abs(live.x - sample.x) < 1e-6 &&
        Math.abs(live.y - sample.y) < 1e-6 &&
        Math.abs(live.z - sample.z) < 1e-6,
      `tick ${tick}: live vs preview diverged with watchers in the line`,
    );
  }
});

// ---- the latched launch state ---------------------------------------------

test("release throws from the latched origin even after moving half a metre", () => {
  const runtime = throwRuntime();
  const input = { throwAiming: true, throwReleased: false };

  // Aim from the spawn; the whole launch state — origin and target — is latched.
  stepMissionThrowAim(runtime, input, AIM, { uiOwnsInput: false });
  const latched = runtime.throwLatched!;
  assert.ok(latched, "aiming latches the launch state");

  // The player keeps moving and is half a metre away when the key comes up.
  runtime.motion = {
    ...runtime.motion,
    pos: { x: latched.origin.x + 0.5, y: latched.origin.y, z: latched.origin.z },
  };
  // That the move actually changes the launch is the premise of the test.
  const fromMoved = previewMissionThrow(runtime, AIM);
  assert.ok(
    Math.abs(fromMoved.samples[0]!.x - latched.preview.samples[0]!.x) > 0.1,
    "the 0.5m move changes where a fresh throw would launch, so latching matters",
  );

  input.throwAiming = false;
  input.throwReleased = true;
  stepMissionThrowAim(runtime, input, AIM, { uiOwnsInput: false });

  const object = () => runtime.stealth.diversions.live[0]!;
  assert.ok(object(), "a throw was issued");
  // Zero origin mismatch: the object launches from the latched origin, matching
  // the latched preview's first sample — not the moved position.
  assert.ok(
    Math.abs(object().pos.x - latched.preview.samples[0]!.x) < 1e-9 &&
      Math.abs(object().pos.z - latched.preview.samples[0]!.z) < 1e-9,
    "the throw launched from the moved position, not the latched origin",
  );
  // Zero trajectory mismatch: it flies the latched preview's path tick for tick.
  const compareTicks = Math.min(latched.preview.samples.length - 1, 20);
  for (let tick = 1; tick <= compareTicks; tick += 1) {
    stepMissionRuntime(runtime, IDLE);
    const sample = latched.preview.samples[tick]!;
    const live = object().pos;
    assert.ok(
      Math.abs(live.x - sample.x) < 1e-9 &&
        Math.abs(live.y - sample.y) < 1e-9 &&
        Math.abs(live.z - sample.z) < 1e-9,
      `tick ${tick}: the live throw diverged from the latched preview`,
    );
  }
});

// ---- the sample bound ------------------------------------------------------

test("previewThrow bounds its sample count independent of dt", () => {
  const runtime = throwRuntime();
  const world = runtime.instance.world;
  const inventory = runtime.stealth.diversions;
  const origin = runtime.motion.pos;

  for (const dt of [1 / 60, 1 / 240, 1 / 1000]) {
    const preview = previewThrow(world, inventory, origin, AIM, dt);
    assert.ok(preview.ok, `dt=${dt}: a clear throw is accepted`);
    assert.ok(preview.samples.length >= 2, `dt=${dt}: at least an origin and a rest`);
    // The cap holds at every rate: a finer dt cannot allocate more points, which
    // is what stops a theoretical millions at 1000Hz or below.
    assert.ok(
      preview.samples.length <= 256,
      `dt=${dt}: ${preview.samples.length} samples exceeds the 256 cap`,
    );
    // Endpoints preserved: the last sample is the rest point.
    if (preview.restsAt) {
      const last = preview.samples[preview.samples.length - 1]!;
      assert.ok(
        Math.abs(last.x - preview.restsAt.x) < 1e-9 &&
          Math.abs(last.z - preview.restsAt.z) < 1e-9,
        `dt=${dt}: the last sample is not the rest point`,
      );
    }
  }

  // Deterministic: the same dt yields the same count.
  const a = previewThrow(world, inventory, origin, AIM, 1 / 1000);
  const b = previewThrow(world, inventory, origin, AIM, 1 / 1000);
  assert.equal(a.samples.length, b.samples.length, "the cap is deterministic for a dt");
});
