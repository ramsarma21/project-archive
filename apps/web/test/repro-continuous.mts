// Honest continuous-run reproduction of the M1 tie-beam drop failure.
//
// Drives the real mission runtime from A_START with the LIVE encounter machine,
// answering both perspective stops CORRECT, and instruments the directed hatch
// drop D2_ROOF_N -> D2_BEAM_MID: pre-hatch pose/velocity/heading, gateway phase,
// leg speed cap, predicted capsule landing footprint vs the beam's safe inset,
// actual capsule support, and grounded-tick survival on the beam.
//
//   node --import tsx .affordwork/repro-m1-continuous.mts
import {
  createGroundedState,
  groundedSupport,
} from "@pa/engine-world";
import { supportBelow, CAPSULE_RADIUS } from "@pa/engine-world/collision";
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

type V3 = { x: number; y: number; z: number };

function nodePos(id: string): V3 {
  const n = M1_EFFIGY_RUN.nodes.find((node) => node.id === id);
  if (!n) throw new Error(`no node ${id}`);
  return { x: n.pos[0], y: n.pos[1], z: n.pos[2] };
}

// The tie beam authored rect (ropewalk.ts): x 59.6..79.0, z 20.5..22.1, y 5.2.
const BEAM = { minX: 59.6, maxX: 79.0, minZ: 20.5, maxZ: 22.1, y: 5.2 };
const SAFE_INSET_MIN_Z = BEAM.minZ + CAPSULE_RADIUS; // 20.85
const SAFE_INSET_MAX_Z = BEAM.maxZ - CAPSULE_RADIUS; // 21.75

function firstAttemptRuntime(): MissionRuntime {
  const instance = m1Instance({
    missionId: M1_MISSION_ID,
    attemptOrdinal: 1,
    seed: 0xb057,
    Scenery: null,
  });
  return createMissionRuntime({ instance, seed: 0xb057 });
}

function run() {
  const runtime = firstAttemptRuntime();
  const world = runtime.instance.world;

  const start = nodePos("A_START");
  const toward = nodePos("A_SHEETS");
  runtime.motion = createGroundedState(
    { x: start.x, y: start.y, z: start.z },
    Math.atan2(toward.x - start.x, toward.z - start.z),
  );

  const beatSpec = runtime.instance.beat!.spec;
  const dtS = 1 / 60;
  const frames = Math.round(150 * 60);

  let pendingJump = false;
  let jumpCooldown = 0;
  let beatStarted = false;
  let dueTicks: number[] = [];
  let dueIdx = 0;

  const encPhaseSeen = new Map<string, string>();
  let preHatch: any = null;
  let beamLanding: any = null;
  let beamGroundedTicks = 0;
  let beamLeft = false;
  let leftBeamAt: any = null;
  let sawHatchDropAir = false;
  let minSupportZWhileOnBeam = Infinity;
  let maxSupportZWhileOnBeam = -Infinity;

  const inStance = (): boolean => {
    const p = runtime.motion.pos;
    return (
      Math.hypot(p.x - beatSpec.stance.x, p.z - beatSpec.stance.z) <=
        beatSpec.stanceRadiusM &&
      Math.abs(p.y - beatSpec.stance.y) <= beatSpec.stanceHeightToleranceM
    );
  };

  for (let f = 0; f < frames; f += 1) {
    const p = runtime.motion.pos;
    const standing = standingObjective(runtime);
    const objId = standing?.objective.id ?? null;

    // report encounter phase transitions
    if (runtime.encounterView) {
      const id = runtime.encounterView.encounterId;
      const ph = runtime.encounterView.phase;
      if (encPhaseSeen.get(id) !== ph) {
        encPhaseSeen.set(id, ph);
        console.log(
          `t=${runtime.clock.tick} enc ${id} -> ${ph} @ (${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}) v=${Math.hypot(runtime.motion.vel.x, runtime.motion.vel.z).toFixed(2)} grounded=${runtime.motion.grounded}`,
        );
      }
    }
    // answer the open question CORRECT
    if (runtime.encounterView?.phase === "QUESTION") {
      const id = runtime.encounterView.encounterId;
      runtime.encounterSubmit = id;
      runtime.encounterVerdictInbox.set(id, "CORRECT");
    }

    let moveX = 0;
    let moveZ = 1;
    let doStrike = false;
    const drivingBeat = objId === "post-the-handbill" && inStance();
    if (drivingBeat) {
      moveX = 0;
      moveZ = 0;
      runtime.motion = { ...runtime.motion, yaw: beatSpec.facingYaw };
      if (!beatStarted) doStrike = true;
      else {
        const nextTick = runtime.clock.tick + 1;
        if (dueIdx < dueTicks.length && nextTick >= dueTicks[dueIdx]!) doStrike = true;
      }
    } else if (standing) {
      const mark = markRead(standing.objective, p);
      if (mark) {
        const dx = mark.pos.x - p.x;
        const dz = mark.pos.z - p.z;
        const len = Math.hypot(dx, dz);
        if (len > 1e-4) {
          moveX = dx / len;
          moveZ = dz / len;
        }
      }
    }

    const gatewayVerbs = standing?.objective.mark?.gateway?.()?.allowedVerbs ?? null;
    const gatewayForbidsJump =
      gatewayVerbs !== null &&
      !gatewayVerbs.includes("JUMP") &&
      !gatewayVerbs.includes("JUMP_GAP");
    const preview = runtime.flow.previewVerb;
    const leap = preview === "JUMP" || preview === "JUMP_GAP" || preview === "DASH_JUMP";
    if (runtime.motion.grounded && leap && jumpCooldown === 0 && !drivingBeat && !gatewayForbidsJump) {
      pendingJump = true;
      jumpCooldown = 12;
    }
    if (jumpCooldown > 0) jumpCooldown -= 1;

    // Capture pre-hatch state: last grounded tick on the ROPEWALK_ROOF_N lip
    // while the tie-beam gateway is held, just before leaving the roof.
    const gw = standing?.objective.mark?.gateway?.() ?? null;
    if (
      runtime.motion.grounded &&
      p.y > 8.0 &&
      p.x > 74.5 &&
      gw &&
      gw.allowedVerbs &&
      !gw.allowedVerbs.includes("JUMP")
    ) {
      preHatch = {
        tick: runtime.clock.tick,
        pos: { x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3) },
        vel: {
          x: +runtime.motion.vel.x.toFixed(3),
          z: +runtime.motion.vel.z.toFixed(3),
          speed: +Math.hypot(runtime.motion.vel.x, runtime.motion.vel.z).toFixed(3),
        },
        yaw: +runtime.motion.yaw.toFixed(3),
        gatewayVerbs: gw.allowedVerbs,
        axis: gw.axisX !== undefined ? { x: +gw.axisX.toFixed(2), z: +gw.axisZ!.toFixed(2) } : null,
        legCap: standing?.objective.mark?.speedCapMps?.(p) ?? null,
        previewVerb: runtime.flow.previewVerb,
      };
    }

    const frame: MissionInputFrame = {
      dtS,
      moveX,
      moveZ,
      sprintHeld: !drivingBeat,
      crouchHeld: false,
      jumpBuffered: pendingJump,
      strikeBuffered: doStrike,
      reducedMotion: false,
      flowEnabled: true,
    };
    const step = stepMissionRuntime(runtime, frame);
    if (step.jumpConsumed) pendingJump = false;
    if (step.strikeConsumed && !beatStarted && runtime.beat?.startedTick != null) {
      beatStarted = true;
      dueTicks = runtime.beat.chart.offsets.slice(1).map((o) => runtime.beat!.startedTick! + o);
    } else if (step.strikeConsumed && beatStarted) {
      dueIdx += 1;
    }

    const np = runtime.motion.pos;
    const onBeam =
      runtime.motion.grounded &&
      np.y > 4.6 &&
      np.y < 5.9 &&
      np.x >= BEAM.minX - 0.5 &&
      np.x <= BEAM.maxX + 0.5;

    // detect the hatch drop: airborne between roof and beam near x~76
    if (!runtime.motion.grounded && np.y > 5.0 && np.y < 8.7 && np.x > 74.5 && !beamLanding) {
      sawHatchDropAir = true;
    }

    if (sawHatchDropAir && onBeam && !beamLanding) {
      const support = supportBelow(world, np.x, np.z, np.y + 0.1);
      beamLanding = {
        tick: runtime.clock.tick,
        pos: { x: +np.x.toFixed(3), y: +np.y.toFixed(3), z: +np.z.toFixed(3) },
        vel: {
          x: +runtime.motion.vel.x.toFixed(3),
          z: +runtime.motion.vel.z.toFixed(3),
          speed: +Math.hypot(runtime.motion.vel.x, runtime.motion.vel.z).toFixed(3),
        },
        support: support?.id ?? null,
        capsuleSouthEdge: +(np.z + CAPSULE_RADIUS).toFixed(3),
        capsuleNorthEdge: +(np.z - CAPSULE_RADIUS).toFixed(3),
        insideSafeInset: np.z >= SAFE_INSET_MIN_Z && np.z <= SAFE_INSET_MAX_Z,
        verb: runtime.flow.verb,
        landing: runtime.flow.landing,
      };
      console.log("\nBEAM LANDING:", JSON.stringify(beamLanding));
    }

    if (beamLanding && !beamLeft) {
      if (onBeam && runtime.motion.grounded) {
        beamGroundedTicks += 1;
        const support = groundedSupport(world, np);
        if (support?.id === "ROPEWALK_TIE_BEAM") {
          minSupportZWhileOnBeam = Math.min(minSupportZWhileOnBeam, np.z);
          maxSupportZWhileOnBeam = Math.max(maxSupportZWhileOnBeam, np.z);
        }
      }
      // left the beam: fell below y=4.5 (dropped to floor) not via authored west descent at x<64
      if (np.y < 4.4 && np.x > 62) {
        beamLeft = true;
        leftBeamAt = { tick: runtime.clock.tick, pos: { x: +np.x.toFixed(2), y: +np.y.toFixed(2), z: +np.z.toFixed(2) }, groundedTicksOnBeam: beamGroundedTicks };
        console.log("LEFT BEAM (fell):", JSON.stringify(leftBeamAt));
      }
    }

    if (runtime.outcome?.kind === "FAILED") {
      console.log(`\nFAILED @ t=${runtime.clock.tick} pos=(${np.x.toFixed(2)},${np.y.toFixed(2)},${np.z.toFixed(2)})`, (runtime.outcome as any).failure?.code);
      break;
    }
    if (runtime.outcome?.kind === "REACHED_DUEL") {
      console.log(`\nREACHED_DUEL @ t=${runtime.clock.tick}`);
      break;
    }
  }

  console.log("\n==== SUMMARY ====");
  console.log("pre-hatch state:", JSON.stringify(preHatch));
  console.log("beam landing:", JSON.stringify(beamLanding));
  console.log("safe inset z-range on beam: [", SAFE_INSET_MIN_Z, ",", SAFE_INSET_MAX_Z, "]");
  console.log("grounded ticks held on beam after landing:", beamGroundedTicks);
  console.log("beam support-z min/max while grounded on beam:", minSupportZWhileOnBeam, maxSupportZWhileOnBeam);
  console.log("fell off beam:", beamLeft, leftBeamAt ? JSON.stringify(leftBeamAt) : "");
  console.log("outcome:", runtime.outcome?.kind ?? "none");
  console.log("encounters resolved:", runtime.encounters.filter((e) => e.phase === "RESOLVED" || e.phase === "RELEASED").length);
}

run();
