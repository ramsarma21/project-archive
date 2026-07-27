import { test } from "node:test";
import assert from "node:assert/strict";

import { FIELD_DT } from "@pa/engine-world";
import { M1_EFFIGY_RUN, createWayfinder } from "@pa/mission-m1";
import { M1_MISSION_ID, m1Instance } from "../src/chapter/m1Mission.js";
import {
  createMissionRuntime,
  markRead,
  standingObjective,
  stepMissionRuntime,
} from "../src/mission/traversal.js";

// ---------------------------------------------------------------------------
// Who owns the standing mark's waypoint, wired end to end.
//
// The waypoint is drawn by two surfaces at two different rates: the HUD samples
// it a few times a second and `VisorRunMark` peeks it in the render loop. Both
// go through `markRead`. If reading advanced the waypoint, the two would drive
// it against each other from slightly different positions and the mark would
// walk the player in a loop — which is what the owner reported and what the
// wayfinder's commitment exists to prevent.
//
// The fix is architectural: the mission runtime's fixed step is the ONE caller
// that advances the waypoint (`advanceWayfinding`), and everything that draws it
// reads a pure peek. These pin that from the container's side; the pure-logic
// invariants live in @pa/mission-m1's wayfind.test.ts.
// ---------------------------------------------------------------------------

function runtimeFor(attemptOrdinal: number) {
  const instance = m1Instance({
    missionId: M1_MISSION_ID,
    attemptOrdinal,
    seed: 0xb057,
    Scenery: null,
  });
  return createMissionRuntime({ instance, seed: 0xb057 });
}

/** One fixed tick's worth of input, standing still. */
const STILL = {
  dtS: FIELD_DT,
  moveX: 0,
  moveZ: 0,
  sprintHeld: false,
  crouchHeld: false,
  jumpBuffered: false,
  reducedMotion: false,
  flowEnabled: true,
} as const;

const GOAL = M1_EFFIGY_RUN.postNode;

function vec(pos: readonly [number, number, number]) {
  return { x: pos[0], y: pos[1], z: pos[2] };
}

test("only the fixed step commits guidance; the surfaces that draw it only read", () => {
  const runtime = runtimeFor(2); // every line, so guidance is live from the spawn
  const objective = standingObjective(runtime)!.objective;
  const elm = objective.mark!.pos;

  // Before the runtime has stepped, nothing is committed, so every read — at any
  // rate, from any viewpoint — points at the objective itself and moves nothing.
  for (let read = 0; read < 50; read += 1) {
    assert.deepEqual(
      markRead(objective, runtime.motion.pos)!.pos,
      elm,
      "reading the mark must never commit a waypoint",
    );
  }

  // One fixed step is what advances it.
  stepMissionRuntime(runtime, STILL);
  const committed = markRead(objective, runtime.motion.pos)!.pos;
  assert.notDeepEqual(
    committed,
    elm,
    "a step from the spawn should hand the run a waypoint short of the elm",
  );

  // Now two consumers read it a hundred times each, from two different
  // viewpoints — the HUD from the player, the in-canvas mark from the camera —
  // and the committed waypoint never moves under them.
  const camera = {
    x: runtime.motion.pos.x + 3,
    y: runtime.motion.pos.y + 1.6,
    z: runtime.motion.pos.z - 3,
  };
  for (let read = 0; read < 100; read += 1) {
    assert.deepEqual(markRead(objective, runtime.motion.pos)!.pos, committed);
    assert.deepEqual(markRead(objective, camera)!.pos, committed);
  }
});

test("the HUD and the in-canvas mark read one waypoint, never two", () => {
  // The two surfaces pass different positions into `markRead` — the plate reads
  // from the player, the ring from the camera — and must still land on the same
  // place, because the waypoint is committed state and not a per-read solve.
  const runtime = runtimeFor(2);
  stepMissionRuntime(runtime, STILL);
  const objective = standingObjective(runtime)!.objective;
  const fromPlayer = markRead(objective, runtime.motion.pos)!;
  const fromCamera = markRead(objective, {
    x: runtime.motion.pos.x - 4,
    y: runtime.motion.pos.y + 2,
    z: runtime.motion.pos.z + 4,
  })!;
  assert.deepEqual(
    fromPlayer.pos,
    fromCamera.pos,
    "the plate in the corner and the ring in the street must name one place",
  );
});

test("the first attempt is guided down SAFE; a later attempt uses every line", () => {
  // The wiring, asserted against reference wayfinders built with the two line
  // policies directly. Attempt one must match SAFE-only guidance and a retry
  // must match all-lines guidance, both from the position the runtime settled
  // its first step on.
  const safe = createWayfinder(M1_EFFIGY_RUN, { guidanceLines: ["SAFE"] });
  const all = createWayfinder(M1_EFFIGY_RUN);

  const first = runtimeFor(1);
  const retry = runtimeFor(2);
  stepMissionRuntime(first, STILL);
  stepMissionRuntime(retry, STILL);

  const refSafe = safe.advanceWaypoint(first.motion.pos, GOAL);
  const refAll = all.advanceWaypoint(retry.motion.pos, GOAL);
  assert.ok(refSafe, "SAFE guidance offers a waypoint from the first-run spawn");
  assert.ok(refAll, "all-lines guidance offers a waypoint from the retry spawn");

  assert.deepEqual(
    markRead(standingObjective(first).objective, first.motion.pos)!.pos,
    vec(refSafe!.pos),
    "the first attempt's mark must follow the SAFE line only",
  );
  assert.deepEqual(
    markRead(standingObjective(retry).objective, retry.motion.pos)!.pos,
    vec(refAll!.pos),
    "a later attempt's mark may follow any authored line",
  );
});
