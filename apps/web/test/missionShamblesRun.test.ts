import { test } from "node:test";
import assert from "node:assert/strict";

import { FIELD_DT } from "@pa/engine-world";
import { M1_MISSION_ID, m1Instance } from "../src/chapter/m1Mission.js";
import {
  createMissionRuntime,
  markRead,
  standingObjective,
  stepMissionRuntime,
  type MissionInputFrame,
  type MissionRuntime,
} from "../src/mission/traversal.js";
import { resolveEncountersForTraversal } from "./traversalEncounters.js";

// ---------------------------------------------------------------------------
// The Shambles is control-executable, end to end, on the real runtime.
//
// A headless run on the first (SAFE-only) attempt reached (30.65, 0, 1.4) in the
// Shambles and sat there for thirty seconds: the committed mark was B_STALL_GAP,
// three metres due east through a solid stall, and steering W+Shift at it walked
// the body into the stall front. The advertised SAFE route from the crate foot
// climbs the crates, leaps the canopies and drops to the street — it does not
// cross the stall — so the guidance was not something the controls could follow.
//
// This drives the ACTUAL runtime — m1Instance, createMissionRuntime,
// stepMissionRuntime, the shipped flow reader — with a LINK-AWARE controller:
// steer toward the committed waypoint, sprint, and press Space only when the
// reader previews a ballistic leap. It never hops on a fixed cadence — that
// periodic Space was papering over the one place the SAFE Shambles line is not
// yet control-executable (the crate->canopy leap), and this harness exists to
// find such places, not jump past them. It is a graph-verifier-vs-controls
// guard: the route graph can say a line goes and the body still be unable to
// walk it, and only running the body catches that.
//
// It is not a claim the whole mission is playable. On link-aware input the SAFE
// line is control-executable from the printshop leads, down the descent, past
// the vaulted gaol barrels, up the guided climb onto stall 2's south-edge awning
// (the route repair that replaced the unprompted crate->canopy leap) and along
// the canopy chain down into Dock Square. It meets its next blocker at the Dock
// Square goods vault; see missionSafeRun's NEXT BLOCKER diagnostic. This test
// asserts control-executability through the Shambles into the square.
// ---------------------------------------------------------------------------

/** No authored action moves the body less than this per tick; below it is a stall. */
const STALL_EPSILON_M = 0.002;

/** 1.5s at 60Hz: longer than any authored vault/climb, so a real stuck reads. */
const MAX_STALL_TICKS = 90;

/** Generous time; link-aware input reaches the crate frontier well inside this. */
const RUN_TICKS = 30 * 60;

function firstAttemptRuntime(): MissionRuntime {
  const instance = m1Instance({
    missionId: M1_MISSION_ID,
    attemptOrdinal: 1, // SAFE-only guidance, the first-run case the trace hit
    seed: 0xb057,
    Scenery: null,
  });
  const runtime = createMissionRuntime({ instance, seed: 0xb057 });
  // Traversal-only: assume the perspective stops are answered, so a headless run
  // with no overlay is not locked at the first trigger. See the helper.
  resolveEncountersForTraversal(runtime);
  return runtime;
}

/** World-space intent toward the committed waypoint, or straight on if none. */
function steerToward(runtime: MissionRuntime): { moveX: number; moveZ: number } {
  const standing = standingObjective(runtime);
  if (!standing) return { moveX: 0, moveZ: 1 };
  const mark = markRead(standing.objective, runtime.motion.pos);
  if (!mark) return { moveX: 0, moveZ: 1 };
  const dx = mark.pos.x - runtime.motion.pos.x;
  const dz = mark.pos.z - runtime.motion.pos.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return { moveX: 0, moveZ: 1 };
  return { moveX: dx / len, moveZ: dz / len };
}

test("a first run steers the SAFE mark clean through the Shambles to the Town House approach", () => {
  const runtime = firstAttemptRuntime();

  let reachedSquareTick = -1;
  let maxStallBeforeSquare = 0;
  let stall = 0;
  let pendingJump = false;
  let jumpCooldown = 0;
  let prev = { x: runtime.motion.pos.x, z: runtime.motion.pos.z };

  for (let tick = 0; tick < RUN_TICKS; tick += 1) {
    const { moveX, moveZ } = steerToward(runtime);
    // Link-aware consent: Space only when the reader previews a ballistic leap,
    // never on a cadence.
    const preview = runtime.flow.previewVerb;
    const leap =
      preview === "JUMP" ||
      preview === "JUMP_GAP" ||
      preview === "LEAP_OF_FAITH" ||
      preview === "DASH_JUMP";
    if (runtime.motion.grounded && leap && jumpCooldown === 0) {
      pendingJump = true;
      jumpCooldown = 12;
    }
    if (jumpCooldown > 0) jumpCooldown -= 1;

    const frame: MissionInputFrame = {
      dtS: FIELD_DT,
      moveX,
      moveZ,
      sprintHeld: true,
      crouchHeld: false,
      jumpBuffered: pendingJump,
      reducedMotion: false,
      flowEnabled: true,
    };
    const step = stepMissionRuntime(runtime, frame);
    if (step.jumpConsumed) pendingJump = false;

    assert.notEqual(
      runtime.outcome?.kind,
      "FAILED",
      `the run failed in the Shambles: ${runtime.outcome?.kind}`,
    );

    const moved = Math.hypot(
      runtime.motion.pos.x - prev.x,
      runtime.motion.pos.z - prev.z,
    );
    stall = moved < STALL_EPSILON_M ? stall + 1 : 0;
    prev = { x: runtime.motion.pos.x, z: runtime.motion.pos.z };

    // To the Town House approach: east of the Shambles into the square's
    // north-west corner (C_SQUARE_N / the scaffold foot at x~43-45, z~-3..-6.4).
    // The guided line reaches it by climbing the awning, running the canopy
    // chain, dropping to the street and heading straight for the building — not
    // by cutting through a stall or looping south into Dock Square.
    const atApproach =
      runtime.motion.pos.x >= 42.5 &&
      runtime.motion.pos.x <= 46 &&
      runtime.motion.pos.z <= -1.0;
    if (reachedSquareTick < 0) {
      if (atApproach) reachedSquareTick = tick;
      else maxStallBeforeSquare = Math.max(maxStallBeforeSquare, stall);
    } else {
      break; // the Shambles is cleared; the Town House climb is downstream
    }
  }

  assert.ok(
    reachedSquareTick >= 0,
    "steering the SAFE mark never cleared the Shambles to the Town House approach — " +
      "the advertised route is not control-executable",
  );
  assert.ok(
    maxStallBeforeSquare < MAX_STALL_TICKS,
    `the run stalled for ${(maxStallBeforeSquare / 60).toFixed(1)}s in the ` +
      "Shambles under continuous movement input, which is the blocker wearing a " +
      "different coat",
  );
});
