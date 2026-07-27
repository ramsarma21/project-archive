import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CAPSULE_RADIUS,
  platformCovers,
  supportBelow,
  type Platform,
} from "@pa/engine-world/collision";
import { WALK_SPEED, createGroundedState } from "@pa/engine-world/playerMotion";
import { FIELD_DT } from "@pa/engine-world/fieldSimulation";
import {
  createFlowState,
  stepFlow,
  type TraversalVerb,
} from "@pa/engine-world/parkour";

import { compileLevel } from "../compile.js";
import { M1_EFFIGY_RUN } from "../level/index.js";

// ---------------------------------------------------------------------------
// THE DIRECTED HATCH DROP, ACROSS LEGITIMATE APPROACH-STATE VARIATION.
//
// D2_ROOF_N -> D2_BEAM_MID is a directed RUN_OFF through the hatch onto the
// ropewalk tie beam: a 1.6m board four metres over an unlit floor. The authored
// 2.3 m/s cap gets the body to the lip at a sane pace, but the drop is
// ballistic — the takeoff SPEED, not the pace, decides where the capsule comes
// down, and a body that reaches the lip a hair fast (an encounter restarted it
// from rest a few metres back; the player entered the corridor a step wide)
// used to clip the board's south lip and slide off before it settled.
//
// This drives the REAL stepFlow controller through the drop with the directed
// gateway the runtime supplies (axis take-off->receiver, verb family
// RUN_OFF/HANG_DROP), from a grid of perturbed approach states, and requires
// EVERY accepted landing to put the WHOLE capsule inside the board's safe
// support inset and stay there — no clipped lip, no slide-off. The perturbations
// are exactly the ones an encounter's lock/restart and a human approach
// introduce: start from rest or already moving, a lateral/longitudinal offset,
// a small heading jitter, and the authored cap versus a full sprint entry.
// ---------------------------------------------------------------------------

const level = M1_EFFIGY_RUN;
const compiled = compileLevel(level);
const world = compiled.world;

const beam = world.platforms.find((p) => p.id === "ROPEWALK_TIE_BEAM");
if (!beam) throw new Error("the compiled M1 world has no ROPEWALK_TIE_BEAM");
const BEAM: Platform = beam;

const nodeById = new Map(level.nodes.map((n) => [n.id, n]));
const roofN = nodeById.get("D2_ROOF_N")!;
const beamMid = nodeById.get("D2_BEAM_MID")!;

// The directed gateway the wayfinder hands the runtime for this leg: the unit
// axis take-off -> receiver, and the verb family a completion may belong to.
const axisDx = beamMid.pos[0] - roofN.pos[0];
const axisDz = beamMid.pos[2] - roofN.pos[2];
const axisLen = Math.hypot(axisDx, axisDz);
const GUIDED_AXIS_X = axisDx / axisLen;
const GUIDED_AXIS_Z = axisDz / axisLen;
const GUIDED_VERBS: readonly TraversalVerb[] = ["RUN_OFF", "HANG_DROP"];

/** The whole capsule is on the beam at (x,z): centre inside the radius inset. */
function capsuleOnBeam(x: number, z: number): boolean {
  return platformCovers(BEAM, x, z, CAPSULE_RADIUS);
}

interface DropOutcome {
  landedOnBeam: boolean;
  landingInsideInset: boolean;
  landingPos: { x: number; z: number } | null;
  supportedTicks: number; // consecutive grounded ticks with the WHOLE capsule on the beam
  fellOffBeam: boolean;
  minY: number;
}

interface Approach {
  startSpeed: number; // m/s already carried at the start (0 = from rest)
  targetSpeed: number; // the pace the approach is driven at (leg cap or sprint)
  latOffsetM: number; // perpendicular to the axis (along the board)
  lonOffsetM: number; // along the axis (toward/away from the lip)
  headingJitterRad: number;
}

function driveDrop(a: Approach): DropOutcome {
  // Start north of the hatch lip on the roof deck (ROPEWALK_ROOF_N spans z
  // 17.0..19.8), with room to reach the takeoff at the driven pace and, from
  // rest, to re-accelerate the way the body does after an encounter lock.
  const backM = 1.0;
  // Perpendicular (lateral) unit, in XZ.
  const perpX = -GUIDED_AXIS_Z;
  const perpZ = GUIDED_AXIS_X;
  const startX =
    roofN.pos[0] - GUIDED_AXIS_X * backM - GUIDED_AXIS_X * a.lonOffsetM + perpX * a.latOffsetM;
  const startZ =
    roofN.pos[2] - GUIDED_AXIS_Z * backM - GUIDED_AXIS_Z * a.lonOffsetM + perpZ * a.latOffsetM;

  const baseYaw = Math.atan2(GUIDED_AXIS_X, GUIDED_AXIS_Z);
  let motion = createGroundedState(
    { x: startX, y: roofN.pos[1], z: startZ },
    baseYaw + a.headingJitterRad,
  );
  motion = {
    ...motion,
    vel: { x: GUIDED_AXIS_X * a.startSpeed, y: 0, z: GUIDED_AXIS_Z * a.startSpeed },
  };
  let flow = createFlowState();

  const out: DropOutcome = {
    landedOnBeam: false,
    landingInsideInset: false,
    landingPos: null,
    supportedTicks: 0,
    fellOffBeam: false,
    minY: motion.pos.y,
  };
  let leftGround = false;
  let landed = false;

  for (let tick = 0; tick < Math.round(5 / FIELD_DT); tick += 1) {
    // Steer at the receiver the way a player following the mark does.
    let aimX = beamMid.pos[0] - motion.pos.x;
    let aimZ = beamMid.pos[2] - motion.pos.z;
    const aimLen = Math.hypot(aimX, aimZ);
    if (aimLen > 1e-6) {
      aimX /= aimLen;
      aimZ /= aimLen;
    } else {
      aimX = GUIDED_AXIS_X;
      aimZ = GUIDED_AXIS_Z;
    }

    const result = stepFlow(world, motion, flow, {
      dt: FIELD_DT,
      targetVelX: aimX * a.targetSpeed,
      targetVelZ: aimZ * a.targetSpeed,
      sprintHeld: true,
      crouchHeld: false,
      jumpBuffered: false,
      flowEnabled: true,
      reducedMotion: false,
      receivingTargets: [],
      guidedAxisX: GUIDED_AXIS_X,
      guidedAxisZ: GUIDED_AXIS_Z,
      guidedVerbs: GUIDED_VERBS,
    });
    motion = result.motion;
    flow = result.flow;

    if (motion.grounded) out.minY = Math.min(out.minY, motion.pos.y);
    if (!motion.grounded) leftGround = true;

    const onBeamHeight =
      motion.grounded && Math.abs(motion.pos.y - beamMid.pos[1]) < 0.4;
    const support = onBeamHeight
      ? supportBelow(world, motion.pos.x, motion.pos.z, motion.pos.y + 0.05, 0.05)
      : null;
    const onBeamSurface = support?.id === "ROPEWALK_TIE_BEAM";

    if (!landed && leftGround && onBeamSurface) {
      landed = true;
      out.landedOnBeam = true;
      out.landingPos = { x: motion.pos.x, z: motion.pos.z };
      out.landingInsideInset = capsuleOnBeam(motion.pos.x, motion.pos.z);
    }

    if (landed) {
      if (onBeamSurface && capsuleOnBeam(motion.pos.x, motion.pos.z)) {
        out.supportedTicks += 1;
      } else if (!onBeamSurface && Math.abs(motion.pos.y - beamMid.pos[1]) > 0.5) {
        // Left the beam by dropping below it (a fall), not by walking its length.
        out.fellOffBeam = true;
        break;
      } else {
        // On the beam surface but the capsule is not fully inside the inset:
        // a clipped lip. Break the consecutive-support count.
        out.supportedTicks = 0;
      }
      if (out.supportedTicks >= 40) break;
    }
  }
  return out;
}

function label(a: Approach): string {
  return (
    `start=${a.startSpeed.toFixed(1)} pace=${a.targetSpeed.toFixed(1)} ` +
    `lat=${a.latOffsetM.toFixed(2)} lon=${a.lonOffsetM.toFixed(2)} ` +
    `yaw=${a.headingJitterRad.toFixed(2)}`
  );
}

function approaches(): Approach[] {
  const grid: Approach[] = [];
  // The authored leg cap (WALK_SPEED) is the fastest a body reaches this lip —
  // it is load-bearing and preserved, so a legitimate approach never exceeds it;
  // the encounter's lock/restart only varies the sub-cap pace and phase. So the
  // grid is the real envelope: from rest or already moving, at the cap or a shade
  // under it, offset a fifth of a metre either way, heading a touch off-axis. (A
  // full sprint into the hatch is exactly what the cap exists to prevent, and the
  // edge brake owns that lip; it is not a state this leg is ever entered in.)
  const paces = [WALK_SPEED, WALK_SPEED - 0.3];
  const starts = [0, WALK_SPEED];
  const lats = [-0.2, 0, 0.2];
  const lons = [-0.2, 0, 0.2];
  const yaws = [-0.15, 0, 0.15];
  for (const targetSpeed of paces) {
    for (const startSpeed of starts) {
      for (const latOffsetM of lats) {
        for (const lonOffsetM of lons) {
          for (const headingJitterRad of yaws) {
            grid.push({
              startSpeed,
              targetSpeed,
              latOffsetM,
              lonOffsetM,
              headingJitterRad,
            });
          }
        }
      }
    }
  }
  return grid;
}

test("the directed hatch drop lands the whole capsule inside the tie-beam inset", () => {
  const beamInsetHalf = (BEAM.maxZ - BEAM.minZ) / 2 - CAPSULE_RADIUS;
  assert.ok(beamInsetHalf > 0, "the tie beam is narrower than the capsule");

  const failures: string[] = [];
  for (const a of approaches()) {
    const o = driveDrop(a);
    if (!o.landedOnBeam) {
      failures.push(`${label(a)}: never landed on the beam (minY ${o.minY.toFixed(2)})`);
      continue;
    }
    if (!o.landingInsideInset) {
      failures.push(
        `${label(a)}: landed at z=${o.landingPos?.z.toFixed(3)} with the capsule clipping the lip`,
      );
      continue;
    }
    if (o.fellOffBeam) {
      failures.push(`${label(a)}: slid off the beam after landing`);
      continue;
    }
    if (o.supportedTicks < 30) {
      failures.push(
        `${label(a)}: held the beam only ${o.supportedTicks} ticks with the whole capsule on it`,
      );
    }
  }
  assert.deepEqual(
    failures,
    [],
    `directed hatch drops that did not land-and-hold the whole capsule on the tie beam:\n  ${failures.join("\n  ")}`,
  );
});
