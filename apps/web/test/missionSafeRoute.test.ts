import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FIELD_DT,
  FIELD_TICK_HZ,
  createGroundedState,
  groundedSupport,
} from "@pa/engine-world";
import { M1_EFFIGY_RUN } from "@pa/mission-m1";
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
// The SAFE route's two silent soft-locks, on the real runtime.
//
//  * The ropewalk tie beam: the SAFE leg authors 2.3 m/s and the board is 1.6m
//    wide, so a sprint entry overshoots it into the dark. The mark now exposes
//    the authored pace and the runtime caps free movement to it while the leg is
//    live, so a Shift-held body still lands the beam.
//  * The final court: the confrontation fail was an x-only band that ran the
//    whole width of the level, so an alert on the ropewalk beam at z≈21 read as
//    "in front of the post". It now requires containment in the elm's corner.
// ---------------------------------------------------------------------------

const nodeById = new Map(M1_EFFIGY_RUN.nodes.map((n) => [n.id, n]));
function nodePos(id: string) {
  const n = nodeById.get(id)!;
  return { x: n.pos[0], y: n.pos[1], z: n.pos[2] };
}

function firstAttempt(): MissionRuntime {
  const instance = m1Instance({
    missionId: M1_MISSION_ID,
    attemptOrdinal: 1,
    seed: 0xb057,
    Scenery: null,
  });
  const runtime = createMissionRuntime({ instance, seed: 0xb057 });
  resolveEncountersForTraversal(runtime);
  return runtime;
}

const STILL: MissionInputFrame = {
  dtS: FIELD_DT,
  moveX: 0,
  moveZ: 0,
  sprintHeld: false,
  crouchHeld: false,
  jumpBuffered: false,
  reducedMotion: false,
  flowEnabled: true,
};

test("Shift held on the SAFE beam approach is walk-capped and lands the tie beam", () => {
  const runtime = firstAttempt();
  const world = runtime.instance.world;
  // Drop the body onto the ropewalk roof at the hatch lip, facing the beam. This
  // is a checkpoint for the test — real spawn is the printshop leads — and uses
  // the shipped grounded-state builder, not a hand-forged pose.
  const lip = nodePos("D2_ROOF_N");
  const beam = nodePos("D2_BEAM_MID");
  runtime.motion = createGroundedState(
    { x: lip.x, y: lip.y, z: lip.z },
    Math.atan2(beam.x - lip.x, beam.z - lip.z),
  );

  const objective = standingObjective(runtime)!.objective;
  // Before the lip, the mark exposes the SAFE walk cap — the HUD's SAFE·WALK cue.
  const cueBefore = markRead(objective, runtime.motion.pos)?.speedCapMps ?? null;
  assert.equal(cueBefore, 2.3, `no walk cue at the lip; speedCapMps=${cueBefore}`);

  let onBeam = false;
  let maxSpeedOnApproach = 0;
  let landedX = Infinity;
  let progressedWest = false;
  for (let tick = 0; tick < 60 * 8; tick += 1) {
    const mark = markRead(objective, runtime.motion.pos);
    let moveX = 0;
    let moveZ = 1;
    if (mark) {
      const dx = mark.pos.x - runtime.motion.pos.x;
      const dz = mark.pos.z - runtime.motion.pos.z;
      const len = Math.hypot(dx, dz);
      if (len > 1e-4) {
        moveX = dx / len;
        moveZ = dz / len;
      }
    }
    stepMissionRuntime(runtime, {
      ...STILL,
      moveX,
      moveZ,
      sprintHeld: true, // Shift held THE WHOLE TIME — the cap must land it anyway.
    });
    const p = runtime.motion.pos;
    const support = groundedSupport(world, p)?.id ?? null;
    const xz = Math.hypot(runtime.motion.vel.x, runtime.motion.vel.z);
    if (!onBeam && support === "ROPEWALK_TIE_BEAM") {
      onBeam = true;
      landedX = p.x;
    }
    if (!onBeam) maxSpeedOnApproach = Math.max(maxSpeedOnApproach, xz);
    // After landing, walking the beam should carry the body WEST toward D2_BEAM_W.
    if (onBeam && p.x < landedX - 1.0 && support === "ROPEWALK_TIE_BEAM") {
      progressedWest = true;
    }
    if (runtime.outcome) break;
  }

  assert.equal(runtime.outcome, null, "the run fell/failed on the beam approach");
  assert.ok(
    maxSpeedOnApproach <= 2.6,
    `the body reached ${maxSpeedOnApproach.toFixed(2)} m/s toward the beam despite the 2.3 cap`,
  );
  assert.ok(onBeam, "the Shift-held body never landed supported on the tie beam");
  assert.ok(
    progressedWest,
    "the body landed the beam but did not walk it west toward the hemp",
  );
});

test("an alert on the ropewalk beam is not a final-court failure; one under the elm is", () => {
  const instance = m1Instance({
    missionId: M1_MISSION_ID,
    attemptOrdinal: 1,
    seed: 0xb057,
    Scenery: null,
  });
  const alerted = {
    suspicion: 1,
    squadState: "ALERTED" as const,
    detected: false,
    alertedTicks: 10 * FIELD_TICK_HZ, // well past the 3s clock
    contactIds: [],
  };
  const read = (x: number, y: number, z: number) => ({
    pos: { x, y, z },
    yaw: 0,
    speedMps: 0,
    capsuleHeight: 1.8,
    crouched: false,
    grounded: true,
    verb: "NONE" as const,
    tick: 100,
    elapsedS: 1,
  });

  // On the ropewalk tie beam (x≈76, z≈21.3): x is in the old band but z is far
  // north of the elm's corner. This must NOT be the final-court failure.
  const onBeam = instance.failWhen!(read(76.1, 5.2, 21.3), alerted);
  assert.equal(
    onBeam,
    null,
    `an alert on the ropewalk beam wrongly failed as ${onBeam?.code}`,
  );

  // Held under the elm, in the corner, past the alert clock: this IS the failure.
  const underElm = instance.failWhen!(read(80, 0, 0), alerted);
  assert.equal(
    underElm?.code,
    "FINAL_COURT_CONFRONTATION",
    "an alert held under the elm did not close the route to the post",
  );
});

function corniceRun(useSpace: boolean) {
  const runtime = firstAttempt(); // attempt 1 → SAFE-only guidance
  // Checkpoint on the Town House cornice, having come up the clock ledge. The
  // SAFE marker from here calls for the same-height C_CORNICE_S to the west; a
  // 2.2m FAST CLIMB_UP up the east face onto the leads sits off to the side.
  runtime.motion = createGroundedState({ x: 58.3, y: 10.2, z: 0.0 }, 0);
  const objective = standingObjective(runtime)!.objective;
  let reachedCorniceS = false;
  let reachedTowerGallery = false;
  let reachedLeadsE = false;
  let climbedEastFaceEarly = false;
  for (let tick = 0; tick < 60 * 14; tick += 1) {
    const mark = markRead(objective, runtime.motion.pos);
    let moveX = 0;
    let moveZ = 1;
    if (mark) {
      const dx = mark.pos.x - runtime.motion.pos.x;
      const dz = mark.pos.z - runtime.motion.pos.z;
      const len = Math.hypot(dx, dz);
      if (len > 1e-4) {
        moveX = dx / len;
        moveZ = dz / len;
      }
    }
    const p = runtime.motion.pos;
    // The only difference between the two runs: a Space press held while the body
    // is on the cornice by the east face. Never a rhythmic mash.
    const space = useSpace && p.y < 11 && p.z > 3.5 && p.x > 56;
    stepMissionRuntime(runtime, {
      ...STILL,
      moveX,
      moveZ,
      sprintHeld: true,
      jumpBuffered: space,
    });
    const q = runtime.motion.pos;
    // Climbing the east face means reaching leads height at the SE corner before
    // ever walking west to C_CORNICE_S — the off-route ascent the fix refuses.
    if (!reachedCorniceS && q.y > 11.2 && q.x > 55.5) climbedEastFaceEarly = true;
    if (Math.hypot(q.x - 52, q.z - 6.3) < 2.2 && Math.abs(q.y - 10.2) < 0.7) {
      reachedCorniceS = true;
    }
    if (Math.hypot(q.x - 52, q.z - 1.6) < 2.5 && q.y > 16.5) reachedTowerGallery = true;
    if (reachedTowerGallery && Math.hypot(q.x - 57.6, q.z - 4.2) < 2.5 && q.y < 13) {
      reachedLeadsE = true;
    }
    if (runtime.outcome) break;
  }
  return { reachedCorniceS, reachedTowerGallery, reachedLeadsE, climbedEastFaceEarly };
}

test("first-attempt SAFE marker with Shift and no Space runs the cornice to the tower, not up the east face", () => {
  const r = corniceRun(false);
  assert.ok(
    !r.climbedEastFaceEarly,
    "a held sprint climbed the FAST east face onto the leads without a Space press",
  );
  assert.ok(r.reachedCorniceS, "the body did not run the SAFE cornice to C_CORNICE_S");
  assert.ok(
    r.reachedTowerGallery,
    "the body did not take the SAFE ascent C_CORNICE_S → C_LEADS_S → tower gallery",
  );
  assert.ok(
    r.reachedLeadsE,
    "the body did not come down the tower to rejoin the leads at C_LEADS_E",
  );
});

test("Space at the east face still commits the FAST climb", () => {
  const r = corniceRun(true);
  assert.ok(
    r.climbedEastFaceEarly,
    "a buffered Space at the east face did not commit the FAST climb onto the leads",
  );
});

test("fixed input gives equal state at equal ticks at 30, 60 and 120 Hz", () => {
  // Section F: the run is a fixed-timestep simulation. Fixed production-style
  // input visits the same integer ticks and produces the same state at each of
  // them, whatever the render rate — the render-rate divergence a continuously
  // renormalising waypoint bot showed was the bot, not the sim.
  const HELD: MissionInputFrame = {
    ...STILL,
    moveX: 0,
    moveZ: 1,
    sprintHeld: true,
  };
  const seconds = 3;
  const runAt = (hz: number) => {
    const runtime = firstAttempt();
    const dtS = 1 / hz;
    for (let f = 0; f < Math.round(seconds * hz); f += 1) {
      stepMissionRuntime(runtime, { ...HELD, dtS });
    }
    return runtime;
  };
  const a = runAt(30);
  const b = runAt(60);
  const c = runAt(120);
  assert.equal(a.ticks, seconds * FIELD_TICK_HZ);
  assert.equal(b.ticks, a.ticks, "60Hz visited a different tick count");
  assert.equal(c.ticks, a.ticks, "120Hz visited a different tick count");
  assert.deepEqual(b.motion.pos, a.motion.pos, "60Hz diverged from 30Hz");
  assert.deepEqual(c.motion.pos, a.motion.pos, "120Hz diverged from 30Hz");
  assert.deepEqual(b.motion.vel, a.motion.vel, "60Hz velocity diverged");
  assert.deepEqual(c.motion.vel, a.motion.vel, "120Hz velocity diverged");
});
