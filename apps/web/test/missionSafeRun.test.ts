import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FIELD_DT,
  RUN_SPEED,
  createGroundedState,
  groundedSupport,
} from "@pa/engine-world";
import {
  CAPSULE_RADIUS,
  STAND_HEIGHT,
  positionClear,
  type CollisionWorld,
  type Vec3,
} from "@pa/engine-world/collision";
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
// The SAFE line, driven through the real runtime with LINK-AWARE input.
//
// The controller is a player, not a metronome: it steers at the committed mark,
// holds sprint, and presses Space ONLY when the flow reader is previewing a
// ballistic leap (a JUMP/dive the route takes across a gap). It never hops on a
// fixed cadence — that periodic Space used to paper over the crate->canopy
// frontier, which this pass repaired at the route level. VAULTs, and the climbs
// the guidance asks for (an upward waypoint), are automatic; the only thing the
// player supplies is consent to leap the canopy gaps.
//
// It assumes the perspective stops are answered (see traversalEncounters); the
// reachable trace stops at the Dock Square goods vault, well past nothing that
// this seam colours. Production encounter behaviour is untouched.
// ---------------------------------------------------------------------------

const STALL_EPSILON_M = 0.002;
/** 1.5s at 60Hz: longer than any authored vault or climb. */
const MAX_STALL_TICKS = 90;
const KERB_MAX_HEIGHT_M = 0.5;
/** The gaol barrels' x band on the street line, where the SAFE vault happens. */
const GAOL_X = [20.5, 24] as const;

function firstAttemptRuntime(): MissionRuntime {
  const instance = m1Instance({
    missionId: M1_MISSION_ID,
    attemptOrdinal: 1, // SAFE-only guidance, the first-run case
    seed: 0xb057,
    Scenery: null,
  });
  const runtime = createMissionRuntime({ instance, seed: 0xb057 });
  resolveEncountersForTraversal(runtime);
  return runtime;
}

function kerbIds(world: CollisionWorld): Set<string> {
  const ids = new Set<string>();
  for (const blocker of world.blockers) {
    if (
      blocker.landable &&
      Number.isFinite(blocker.topY) &&
      blocker.topY - blocker.baseY <= KERB_MAX_HEIGHT_M
    ) {
      ids.add(blocker.id);
    }
  }
  return ids;
}

interface LinkAwareResult {
  reached: boolean;
  reachedTick: number;
  maxStallTicks: number;
  penetrated: boolean;
  penetrationAt: Vec3 | null;
  fatal: string | null;
  gaolVaulted: boolean;
  gaolFellBackToMantle: boolean;
  climbedCanopyWithoutSpace: boolean;
  supportsSeen: Set<string>;
  spacePresses: number;
  /** Distinct VAULT commits while over the Dock goods barrels. */
  dockVaultCommits: number;
  /** A VAULT completed with the body landing at/near B2_GOODS_OUT. */
  dockVaultCompleted: boolean;
  /** The mark reached B2_EXIT BEFORE that vault completed — the old early-advance. */
  dockMarkAdvancedEarly: boolean;
  /** The body wedged in the ARCADE_PIER_N footprint (the old off-axis stall). */
  wedgedAtPier: boolean;
}

const DOCK_X = [41.3, 43.6] as const;

function driveLinkAware(
  hz: number,
  reachedAt: (p: Vec3, runtime: MissionRuntime) => boolean,
  maxSeconds = 40,
  startNode?: string,
): LinkAwareResult {
  const runtime = firstAttemptRuntime();
  const world = runtime.instance.world;
  const kerbs = kerbIds(world);
  const dtS = 1 / hz;
  const frames = Math.round(maxSeconds * hz);
  const goodsOut = M1_EFFIGY_RUN.nodes.find((n) => n.id === "B2_GOODS_OUT")!.pos;
  const b2Exit = M1_EFFIGY_RUN.nodes.find((n) => n.id === "B2_EXIT")!.pos;
  // Optional checkpoint: drop the body at a node (used to reach an OFF-LINE space
  // like Dock Square, which the guided line no longer threads, and drive the
  // recovery mark from there). Faces the goods-vault approach.
  if (startNode) {
    const s = M1_EFFIGY_RUN.nodes.find((n) => n.id === startNode)!.pos;
    const toward = M1_EFFIGY_RUN.nodes.find((n) => n.id === "B2_GOODS_IN")!.pos;
    runtime.motion = createGroundedState(
      { x: s[0], y: s[1], z: s[2] },
      Math.atan2(toward[0] - s[0], toward[2] - s[2]),
    );
  }

  let pendingJump = false;
  let jumpCooldown = 0;
  let stallTicks = 0;
  let prev: Vec3 = { ...runtime.motion.pos };
  let prevVerb = runtime.flow.verb;
  const result: LinkAwareResult = {
    reached: false,
    reachedTick: -1,
    maxStallTicks: 0,
    penetrated: false,
    penetrationAt: null,
    fatal: null,
    gaolVaulted: false,
    gaolFellBackToMantle: false,
    climbedCanopyWithoutSpace: false,
    supportsSeen: new Set<string>(),
    spacePresses: 0,
    dockVaultCommits: 0,
    dockVaultCompleted: false,
    dockMarkAdvancedEarly: false,
    wedgedAtPier: false,
  };

  for (let f = 0; f < frames; f += 1) {
    let moveX = 0;
    let moveZ = 1;
    const standing = standingObjective(runtime);
    if (standing) {
      const mark = markRead(standing.objective, runtime.motion.pos);
      if (mark) {
        const dx = mark.pos.x - runtime.motion.pos.x;
        const dz = mark.pos.z - runtime.motion.pos.z;
        const len = Math.hypot(dx, dz);
        if (len > 1e-4) {
          moveX = dx / len;
          moveZ = dz / len;
        }
      }
    }
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
      dtS,
      moveX,
      moveZ,
      sprintHeld: true,
      crouchHeld: false,
      jumpBuffered: pendingJump,
      reducedMotion: false,
      flowEnabled: true,
    };
    const step = stepMissionRuntime(runtime, frame);
    if (step.jumpConsumed) {
      pendingJump = false;
      result.spacePresses += 1;
    }

    const p = runtime.motion.pos;
    const support = groundedSupport(world, p)?.id ?? null;
    if (support) result.supportsSeen.add(support);

    if (p.x >= GAOL_X[0] && p.x <= GAOL_X[1] && p.z < 0) {
      if (runtime.flow.verb === "VAULT") result.gaolVaulted = true;
      if (runtime.flow.verb === "CLIMB_UP") result.gaolFellBackToMantle = true;
    }
    // The SAFE way onto the canopies: a CLIMB_UP committed onto stall 2's awning
    // that this tick was NOT authorised by a buffered jump — the reader took it on
    // its own because the waypoint (the awning south edge) is genuinely upward.
    if (
      runtime.flow.verb === "CLIMB_UP" &&
      !pendingJump &&
      groundedSupport(world, p)?.id === "STALL_2__CANOPY"
    ) {
      result.climbedCanopyWithoutSpace = true;
    }

    // ---- the Dock Square goods VAULT (the gateway under test) ----
    const overDock = p.x >= DOCK_X[0] && p.x <= DOCK_X[1] && p.z > 5 && p.z < 8;
    // A rising edge into VAULT while over the barrels is one clean commit; the old
    // off-axis failure flickered VAULT/BLOCKED and never committed.
    if (overDock && runtime.flow.verb === "VAULT" && prevVerb !== "VAULT") {
      result.dockVaultCommits += 1;
    }
    // The vault has completed when the body is grounded at/past the landing node.
    if (
      runtime.motion.grounded &&
      result.dockVaultCommits > 0 &&
      Math.hypot(p.x - goodsOut[0], p.z - goodsOut[2]) < 1.2
    ) {
      result.dockVaultCompleted = true;
    }
    // Before the vault completes, the committed mark must NOT already be at B2_EXIT
    // (the early-advance the gateway exists to prevent). Only judged while the body
    // is still short of the landing.
    if (!result.dockVaultCompleted && p.x < goodsOut[0] + 0.2) {
      const standingNow = standingObjective(runtime);
      const markNow = standingNow
        ? markRead(standingNow.objective, runtime.motion.pos)
        : null;
      if (
        markNow &&
        Math.hypot(markNow.pos.x - b2Exit[0], markNow.pos.z - b2Exit[2]) < 0.6
      ) {
        result.dockMarkAdvancedEarly = true;
      }
    }
    // Wedged in the ARCADE_PIER_N footprint (x[41.6,42.2] z[5.0,6.0]) — the old
    // stall was the body driven into the pier off the vault axis.
    if (
      p.x > 41.4 &&
      p.x < 42.3 &&
      p.z > 4.9 &&
      p.z < 6.1 &&
      runtime.motion.grounded &&
      runtime.motion.action === null &&
      Math.hypot(p.x - prev.x, p.z - prev.z) < STALL_EPSILON_M
    ) {
      result.wedgedAtPier = true;
    }
    prevVerb = runtime.flow.verb;

    if (runtime.outcome?.kind === "FAILED") {
      result.fatal =
        (runtime.outcome as { failure?: { code?: string } }).failure?.code ?? "FAILED";
      break;
    }

    if (runtime.motion.grounded && runtime.motion.action === null && step.steps > 0) {
      if (!positionClear(world, p, CAPSULE_RADIUS, STAND_HEIGHT, kerbs)) {
        result.penetrated = true;
        result.penetrationAt = { ...p };
        break;
      }
    }

    const movedThisFrame = Math.hypot(p.x - prev.x, p.z - prev.z);
    if (step.steps > 0) {
      if (movedThisFrame < STALL_EPSILON_M) stallTicks += step.steps;
      else stallTicks = 0;
    }
    prev = { ...p };

    if (reachedAt(p, runtime)) {
      result.reached = true;
      result.reachedTick = runtime.ticks;
      break;
    }
    if (stallTicks > result.maxStallTicks) result.maxStallTicks = stallTicks;
  }
  return result;
}

/** Landed on stall 2's canopy — the SAFE way up off the crate foot. */
function onCanopy(_p: Vec3, runtime: MissionRuntime): boolean {
  return (
    runtime.motion.grounded &&
    groundedSupport(runtime.instance.world, runtime.motion.pos)?.id ===
      "STALL_2__CANOPY"
  );
}

/** Reached the canopy chain past stall 2 — the leaps continued. */
function pastCanopy2(_p: Vec3, runtime: MissionRuntime): boolean {
  const id = groundedSupport(runtime.instance.world, runtime.motion.pos)?.id;
  return (
    runtime.motion.grounded &&
    (id === "STALL_3__CANOPY" || id === "STALL_4__CANOPY")
  );
}

test("link-aware SAFE input vaults the gaol barrels, then climbs onto the canopy with no Space", () => {
  // Two repairs, on the real runtime. The gaol barrels VAULT (never falls back to
  // a MANTLE), and the crate->canopy frontier is gone: the SAFE line now climbs
  // the crate foot onto stall 2's south-edge awning as an automatic CLIMB_UP,
  // because that waypoint is genuinely upward — no unprompted Space window.
  const run = driveLinkAware(60, onCanopy, 40);
  assert.equal(run.fatal, null, `the run failed before the canopy: ${run.fatal}`);
  assert.equal(
    run.penetrated,
    false,
    `the body overlapped a blocker at ${JSON.stringify(run.penetrationAt)}`,
  );
  assert.ok(run.gaolVaulted, "the gaol barrels were not vaulted on the SAFE street line");
  assert.equal(
    run.gaolFellBackToMantle,
    false,
    "the gaol vault silently fell back to a MANTLE",
  );
  assert.ok(
    run.reached,
    "the link-aware SAFE line never reached stall 2's canopy — the awning climb is not control-executable",
  );
  assert.ok(
    run.climbedCanopyWithoutSpace,
    "the body did not climb onto the canopy on its own — the awning waypoint was not read as upward",
  );
  assert.ok(
    run.maxStallTicks <= MAX_STALL_TICKS,
    `the run stalled ${(run.maxStallTicks / 60).toFixed(1)}s before the canopy under movement input`,
  );
});

test("the repaired SAFE line continues the canopy chain past stall 2 without periodic Space", () => {
  // The whole point of the route repair: once on the awning the body runs to the
  // canopy centre and takes the authored canopy leaps, reaching stall 3/4. The
  // only Space presses are consent to those ballistic leaps — none for the crate
  // climb, and never on a cadence.
  const run = driveLinkAware(60, pastCanopy2, 45);
  assert.equal(run.fatal, null, `the run failed on the canopy chain: ${run.fatal}`);
  assert.equal(run.penetrated, false, "the body clipped geometry on the canopy chain");
  assert.ok(
    run.reached,
    "the canopy chain did not continue past stall 2 on the repaired SAFE line",
  );
  assert.ok(
    run.supportsSeen.has("STALL_2__CANOPY"),
    "the body never stood on stall 2's canopy — it did not take the awning climb",
  );
  // A generous ceiling: the two-to-three canopy leaps to reach stall 3/4, and
  // nothing like the per-2s cadence the old harness leaned on.
  assert.ok(
    run.spacePresses <= 4,
    `the run pressed Space ${run.spacePresses} times — that is a cadence, not per-leap consent`,
  );
});

/** Grounded past B2_EXIT — the run cleared the goods vault and moved on. */
function pastB2Exit(_p: Vec3, runtime: MissionRuntime): boolean {
  const p = runtime.motion.pos;
  // B2_EXIT is (44.6, 0, 4.4); past it the SAFE line runs on to C_LANE_S_W.
  return runtime.motion.grounded && p.x > 44.6 && p.z < 4.4;
}

test("the Dock Square goods VAULT commits once on the IN->OUT axis, then the mark advances past B2_EXIT", () => {
  // The directed-gateway repair, on the real runtime. Dock Square is now OFF the
  // guided line (the line goes straight from the Shambles to the Town House), but
  // it stays authored and reachable, and a player who deviates south into the
  // square must still get a clean crossing out of it. So this checkpoints the
  // body at the square's north-east corner and drives the RECOVERY mark, which
  // leads out through the goods vault: B2_GOODS_IN -> B2_GOODS_OUT is a SAFE VAULT
  // over DOCK_BARRELS, ~2.4m apart — inside the 4m lead. The bug this guards
  // against: the mark skipping to B2_EXIT so the body chased that intent ~15
  // degrees off the vault axis, probed ARCADE_PIER_N and wedged. The gateway
  // holds the take-off then the receiver until the vault completes, and hands the
  // reader the authored axis so it probes IN->OUT and commits the VAULT there.
  const run = driveLinkAware(60, pastB2Exit, 55, "B2_SQUARE_NE");
  assert.equal(run.fatal, null, `the run failed before clearing the goods vault: ${run.fatal}`);
  assert.equal(
    run.penetrated,
    false,
    `the body overlapped a blocker at ${JSON.stringify(run.penetrationAt)}`,
  );
  assert.equal(
    run.dockMarkAdvancedEarly,
    false,
    "the mark advanced to B2_EXIT before the vault completed — the gateway did not hold",
  );
  assert.equal(
    run.wedgedAtPier,
    false,
    "the body wedged in the ARCADE_PIER_N footprint — the read went off the vault axis",
  );
  assert.equal(
    run.dockVaultCommits,
    1,
    `the goods VAULT committed ${run.dockVaultCommits} times over the barrels, not once`,
  );
  assert.ok(run.dockVaultCompleted, "the goods VAULT never completed at B2_GOODS_OUT");
  assert.ok(
    run.reached,
    "the run never advanced past B2_EXIT after the vault — the gateway did not release",
  );
  assert.ok(
    run.maxStallTicks <= MAX_STALL_TICKS,
    `the run stalled ${(run.maxStallTicks / 60).toFixed(1)}s reaching past the goods vault`,
  );
});

// ---------------------------------------------------------------------------
// The Town House clock ledge -> cornice climb, on the real runtime.
//
// C_GALLERY_EMID -> C_CLOCK climbs straight up onto the clock ledge; the ascent
// tops out at the ledge's NORTH LIP, ~3.9m from the mid-deck C_CLOCK node. The
// gateway used to release only on node proximity, so it never released here: the
// mark stayed pinned to the take-off, the C_CLOCK -> C_CORNICE_E climb above never
// armed, and a link-aware run sat on the ledge with the verb NONE for hundreds of
// ticks. The deck-landing release un-sticks it. The clock climb then commits as an
// upward-guidance CLIMB — the same automatic ascent as the scaffold stagings and
// the tower plinth (see missionSafeRoute's SAFE cornice→tower run, which takes
// the identical straight-up tower climbs with no Space) — and the body runs on up
// the Town House spiral. The controller is the SAME link-aware player: it steers
// at the committed mark, holds sprint, and presses Space only for a previewed
// ballistic leap. No ascent-Space, no cadence.
// ---------------------------------------------------------------------------

const CLOCK_LEDGE_SURFACE = "CLOCK_LEDGE";
const CORNICE_E_SURFACE = "CORNICE_E";

interface ClockRun {
  reachedLedge: boolean;
  corniceClimbCommits: number;
  reachedCornice: boolean;
  maxStallTicks: number;
  clockStallTicks: number;
  fatal: string | null;
  penetrated: boolean;
  penetrationAt: Vec3 | null;
}

/** Drive the link-aware SAFE player up the Town House to the cornice. */
function driveToCornice(maxSeconds: number): ClockRun {
  const runtime = firstAttemptRuntime();
  const world = runtime.instance.world;
  const kerbs = kerbIds(world);
  const dtS = 1 / 60;
  const frames = Math.round(maxSeconds * 60);

  let pendingJump = false;
  let jumpCooldown = 0;
  let stallTicks = 0;
  let clockStall = 0;
  let prev: Vec3 = { ...runtime.motion.pos };
  let prevVerb = runtime.flow.verb;
  const result: ClockRun = {
    reachedLedge: false,
    corniceClimbCommits: 0,
    reachedCornice: false,
    maxStallTicks: 0,
    clockStallTicks: 0,
    fatal: null,
    penetrated: false,
    penetrationAt: null,
  };

  for (let f = 0; f < frames; f += 1) {
    let moveX = 0;
    let moveZ = 1;
    const standing = standingObjective(runtime);
    if (standing) {
      const mark = markRead(standing.objective, runtime.motion.pos);
      if (mark) {
        const dx = mark.pos.x - runtime.motion.pos.x;
        const dz = mark.pos.z - runtime.motion.pos.z;
        const len = Math.hypot(dx, dz);
        if (len > 1e-4) {
          moveX = dx / len;
          moveZ = dz / len;
        }
      }
    }
    // Link-aware: Space ONLY for a previewed ballistic leap the route takes across
    // a gap, never for an ascent and never on a cadence.
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
      dtS,
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

    const p = runtime.motion.pos;
    const support = groundedSupport(world, p)?.id ?? null;
    if (support === CLOCK_LEDGE_SURFACE) result.reachedLedge = true;
    // The C_CLOCK -> C_CORNICE_E commit: a CLIMB_UP begun while standing on the
    // clock ledge. The prior climb onto the ledge begins on the gallery, not here,
    // so the surface filter isolates the one climb under test.
    if (
      runtime.flow.verb === "CLIMB_UP" &&
      prevVerb !== "CLIMB_UP" &&
      support === CLOCK_LEDGE_SURFACE
    ) {
      result.corniceClimbCommits += 1;
    }
    // Arrived on the cornice deck (or run on along it) above the ledge.
    if (support === CORNICE_E_SURFACE && p.y > 9.8) result.reachedCornice = true;
    prevVerb = runtime.flow.verb;

    if (runtime.outcome?.kind === "FAILED") {
      result.fatal =
        (runtime.outcome as { failure?: { code?: string } }).failure?.code ?? "FAILED";
      break;
    }

    if (runtime.motion.grounded && runtime.motion.action === null && step.steps > 0) {
      if (!positionClear(world, p, CAPSULE_RADIUS, STAND_HEIGHT, kerbs)) {
        result.penetrated = true;
        result.penetrationAt = { ...p };
        break;
      }
    }

    const movedThisFrame = Math.hypot(p.x - prev.x, p.z - prev.z);
    if (step.steps > 0) {
      if (movedThisFrame < STALL_EPSILON_M) stallTicks += step.steps;
      else stallTicks = 0;
      // Stall specifically while on the clock ledge — the old jammed frontier.
      if (support === CLOCK_LEDGE_SURFACE && movedThisFrame < STALL_EPSILON_M) {
        clockStall += step.steps;
      } else if (support !== CLOCK_LEDGE_SURFACE) {
        clockStall = 0;
      }
    }
    prev = { ...p };
    if (stallTicks > result.maxStallTicks) result.maxStallTicks = stallTicks;
    if (clockStall > result.clockStallTicks) result.clockStallTicks = clockStall;

    if (result.reachedCornice) break;
  }
  return result;
}

test("the link-aware SAFE run un-sticks the clock ledge and commits one climb onto the cornice", () => {
  const run = driveToCornice(60);
  assert.equal(run.fatal, null, `the run failed before the cornice: ${run.fatal}`);
  assert.equal(
    run.penetrated,
    false,
    `the body overlapped a blocker at ${JSON.stringify(run.penetrationAt)}`,
  );
  assert.ok(run.reachedLedge, "the link-aware SAFE line never reached the clock ledge");
  // The jam was a stall on the ledge with the verb NONE for hundreds of ticks.
  assert.ok(
    run.clockStallTicks <= MAX_STALL_TICKS,
    `the body stalled ${(run.clockStallTicks / 60).toFixed(1)}s on the clock ledge — the gateway did not release`,
  );
  assert.equal(
    run.corniceClimbCommits,
    1,
    `the C_CLOCK→C_CORNICE_E climb committed ${run.corniceClimbCommits} times, not once`,
  );
  assert.ok(
    run.reachedCornice,
    "the body never arrived on the cornice above the clock ledge — the climb did not complete",
  );
  assert.ok(
    run.maxStallTicks <= MAX_STALL_TICKS,
    `the run stalled ${(run.maxStallTicks / 60).toFixed(1)}s reaching the cornice`,
  );
});

// ---------------------------------------------------------------------------
// The meeting-house crossing: the one-way SAFE drop off the south-row roof, on
// the real runtime.
//
// The guided line no longer dives south into the ropewalk shed. D_SROOF_E ->
// D_MEETING_W is a SAFE CHAIN_DROP off the south-row roof (y=12.4) onto the west
// strip of the Hollis meeting-house leads (HOLLIS_MEETING__ROOF, y=8.2), a ~1.6m
// lip-to-lip gap and a 4.2m drop; from there the body carries on east under the
// ridge monitor to D_MEETING_ROOF and up the steeple. The regression this guards
// is the same one the old ropewalk drop guarded: the distance anchor must not
// stay stranded up on the south row behind the take-off and offer D_SROOF_E — a
// backward, upward point — the moment the landing is banked, edge-braking the
// body against the lip trying to climb back up the drop it just took. The anchor
// advances to the meeting-roof landing the body actually reached, so the mark
// leads on east toward the steeple. (The ropewalk drop D_SROOF_E -> D2_ROOF_W is
// still authored as an off-line alternate; its own recovery is covered in
// wayfind.test.)
// ---------------------------------------------------------------------------

const MEETING_ROOF = "HOLLIS_MEETING__ROOF";

interface DropRun {
  reachedRoof: boolean;
  dropsOntoRoof: number;
  advancedEast: boolean;
  markWentBackward: boolean;
  markLeadHeightMax: number;
  maxStallTicks: number;
  fatal: string | null;
  penetrated: boolean;
  penetrationAt: Vec3 | null;
}

/** Drive the link-aware SAFE player off the south-row roof through the drop. */
function driveTheMeetingDrop(maxSeconds: number): DropRun {
  const runtime = firstAttemptRuntime();
  const world = runtime.instance.world;
  const kerbs = kerbIds(world);
  const dtS = 1 / 60;
  const frames = Math.round(maxSeconds * 60);
  const node = (id: string) => M1_EFFIGY_RUN.nodes.find((n) => n.id === id)!.pos;
  const sroofE = node("D_SROOF_E");
  // Checkpoint on the south-row roof a little before the drop lip, facing the
  // take-off — a test checkpoint, using the shipped grounded-state builder.
  const start = node("D_VAULT_OUT_1");
  runtime.motion = createGroundedState(
    { x: start[0], y: start[1], z: start[2] },
    Math.atan2(sroofE[0] - start[0], sroofE[2] - start[2]),
  );

  let pendingJump = false;
  let jumpCooldown = 0;
  let stallTicks = 0;
  let prev: Vec3 = { ...runtime.motion.pos };
  let wasGrounded = true;
  // The apex height reached since the body last left the ground, so a landing that
  // fell from the south-row leads is told apart from a micro-hop along the roof.
  let airborneApexY = runtime.motion.pos.y;
  const result: DropRun = {
    reachedRoof: false,
    dropsOntoRoof: 0,
    advancedEast: false,
    markWentBackward: false,
    markLeadHeightMax: -Infinity,
    maxStallTicks: 0,
    fatal: null,
    penetrated: false,
    penetrationAt: null,
  };
  const objective = standingObjective(runtime)!.objective;

  for (let f = 0; f < frames; f += 1) {
    let moveX = 0;
    let moveZ = 1;
    const mark = markRead(objective, runtime.motion.pos);
    if (mark) {
      const dx = mark.pos.x - runtime.motion.pos.x;
      const dz = mark.pos.z - runtime.motion.pos.z;
      const len = Math.hypot(dx, dz);
      if (len > 1e-4) {
        moveX = dx / len;
        moveZ = dz / len;
      }
    }
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

    const step = stepMissionRuntime(runtime, {
      dtS,
      moveX,
      moveZ,
      sprintHeld: true,
      crouchHeld: false,
      jumpBuffered: pendingJump,
      reducedMotion: false,
      flowEnabled: true,
    });
    if (step.jumpConsumed) pendingJump = false;

    const p = runtime.motion.pos;
    const support = groundedSupport(world, p)?.id ?? null;
    const stood = runtime.motion.grounded ? support : null;
    if (stood === MEETING_ROOF) result.reachedRoof = true;
    if (!runtime.motion.grounded) airborneApexY = Math.max(airborneApexY, p.y);
    // One clean drop: a landing on the meeting-house roof that FELL FROM THE LEADS
    // (the apex was up on the south-row roof), told apart from micro-hops along the
    // roof. More than one would be the body dropping, being sent back up the
    // take-off, and dropping again — the oscillation a stale-anchor mark causes.
    if (
      !wasGrounded &&
      runtime.motion.grounded &&
      support === MEETING_ROOF &&
      airborneApexY > 11
    ) {
      result.dropsOntoRoof += 1;
    }
    if (runtime.motion.grounded) airborneApexY = p.y;
    // The steeple is east on the meeting-house roof; standing at x>76 on that deck
    // (D_MEETING_ROOF, the foot of the ridge climb) is the body advancing toward
    // the leap rather than being sent backward.
    if (stood === MEETING_ROOF && p.x > 76) result.advancedEast = true;
    wasGrounded = runtime.motion.grounded;

    // Once the body is down on the meeting-house roof, the mark must never lead a
    // point back up on the south-row leads (the impossible climb) nor sit on the take-off.
    if (result.reachedRoof) {
      const m = markRead(objective, runtime.motion.pos);
      if (m) {
        result.markLeadHeightMax = Math.max(result.markLeadHeightMax, m.pos.y);
        const backUp =
          m.pos.y > 11 ||
          Math.hypot(m.pos.x - sroofE[0], m.pos.y - sroofE[1], m.pos.z - sroofE[2]) < 1.5;
        if (backUp) result.markWentBackward = true;
      }
    }

    if (runtime.outcome?.kind === "FAILED") {
      result.fatal =
        (runtime.outcome as { failure?: { code?: string } }).failure?.code ?? "FAILED";
      break;
    }
    if (runtime.motion.grounded && runtime.motion.action === null && step.steps > 0) {
      if (!positionClear(world, p, CAPSULE_RADIUS, STAND_HEIGHT, kerbs)) {
        result.penetrated = true;
        result.penetrationAt = { ...p };
        break;
      }
    }
    const movedThisFrame = Math.hypot(p.x - prev.x, p.z - prev.z);
    if (step.steps > 0) {
      if (movedThisFrame < STALL_EPSILON_M) stallTicks += step.steps;
      else stallTicks = 0;
    }
    prev = { ...p };
    if (stallTicks > result.maxStallTicks) result.maxStallTicks = stallTicks;
    // Done once the body has crossed the meeting roof to the foot of the ridge
    // climb: the drop and the forward lead are proven, and stopping here keeps the
    // count clear of the leap of faith further on (whose own dive is covered in
    // missionElmContinuation, not here).
    if (result.advancedEast) break;
  }
  return result;
}

test("the SAFE meeting-house drop lands once on the roof and leads on toward the steeple, never back up the drop", () => {
  const run = driveTheMeetingDrop(30);
  assert.equal(run.fatal, null, `the run failed on or after the drop: ${run.fatal}`);
  assert.equal(
    run.penetrated,
    false,
    `the body overlapped a blocker at ${JSON.stringify(run.penetrationAt)}`,
  );
  assert.ok(run.reachedRoof, "the SAFE line never landed on the meeting-house roof off the drop");
  assert.equal(
    run.dropsOntoRoof,
    1,
    `the body dropped onto the meeting-house roof ${run.dropsOntoRoof} times, not once`,
  );
  assert.equal(
    run.markWentBackward,
    false,
    `after landing, the mark led back up toward the take-off (max lead height ${run.markLeadHeightMax.toFixed(1)}m) — the impossible climb`,
  );
  assert.ok(
    run.advancedEast,
    "the body never advanced east across the meeting-house roof toward the steeple after the drop — the mark did not lead forward",
  );
  assert.ok(
    run.maxStallTicks <= MAX_STALL_TICKS,
    `the run stalled ${(run.maxStallTicks / 60).toFixed(1)}s at or after the meeting-house drop`,
  );
});

// ---------------------------------------------------------------------------
// The tie-beam drop through the hatch, entered AT FULL SPRINT, on the real
// runtime.
//
// D2_ROOF_N -> D2_BEAM_MID is a SAFE CHAIN_DROP through the roof hatch onto the
// 1.6m tie beam, 3.4m down and authored at 2.3 m/s. The jam this locks out: a
// Shift-held body reaching the hatch still at ~4.6 m/s had the flow reader
// auto-commit a JUMP_GAP that launched it UP and over the plank, overshooting
// onto the unlit floor a whole storey below where guidance could not progress.
//
// The directed drop gateway now owns the lip: its authored 2.3 m/s caps the
// whole approach so the sprinting body has decelerated before the hatch, and the
// only verb family it lets commit is the controlled descent — so the body steps
// off (a RUN_OFF), lands ON the beam, and the mark leads on west along it. The
// body is driven with W+Shift held the entire time and NEVER presses jump: the
// cap and the gateway alone have to land it.
// ---------------------------------------------------------------------------

const ROPEWALK_TIE_BEAM = "ROPEWALK_TIE_BEAM";

interface BeamDropRun {
  landedOnBeam: boolean;
  landedBeamX: number;
  touchedFloor: boolean;
  jumped: boolean;
  takeoffSpeed: number | null;
  maxAirY: number;
  beamDescents: number;
  progressedWest: boolean;
  maxStallTicks: number;
  fatal: string | null;
  penetrated: boolean;
  penetrationAt: Vec3 | null;
}

/**
 * Drive the SAFE player across the last stretch of ropewalk roof and through the
 * hatch, entering the leg carrying a full sprint. Never presses jump.
 */
function driveTheTieBeamDrop(maxSeconds: number): BeamDropRun {
  const runtime = firstAttemptRuntime();
  const world = runtime.instance.world;
  const kerbs = kerbIds(world);
  const dtS = 1 / 60;
  const frames = Math.round(maxSeconds * 60);
  const node = (id: string) => M1_EFFIGY_RUN.nodes.find((n) => n.id === id)!.pos;
  const vent = node("D2_VENT_OUT_1");
  const roofN = node("D2_ROOF_N");
  // A checkpoint on the ropewalk roof just west of the hatch, moving east toward
  // the lip at a FULL SPRINT — the body a normal W+Shift run arrives with, not an
  // artificially pre-slowed one. Uses the shipped grounded-state builder, then
  // sets the entry velocity to sprint along the approach.
  runtime.motion = createGroundedState(
    { x: vent[0], y: vent[1], z: vent[2] },
    Math.atan2(roofN[0] - vent[0], roofN[2] - vent[2]),
  );
  const dirX = roofN[0] - vent[0];
  const dirZ = roofN[2] - vent[2];
  const dirLen = Math.hypot(dirX, dirZ) || 1;
  runtime.motion = {
    ...runtime.motion,
    vel: { x: (dirX / dirLen) * RUN_SPEED, y: 0, z: (dirZ / dirLen) * RUN_SPEED },
  };

  let stallTicks = 0;
  let prev: Vec3 = { ...runtime.motion.pos };
  let wasGrounded = true;
  let lastGroundedSpeed = RUN_SPEED;
  const result: BeamDropRun = {
    landedOnBeam: false,
    landedBeamX: Infinity,
    touchedFloor: false,
    jumped: false,
    takeoffSpeed: null,
    maxAirY: -Infinity,
    beamDescents: 0,
    progressedWest: false,
    maxStallTicks: 0,
    fatal: null,
    penetrated: false,
    penetrationAt: null,
  };
  const objective = standingObjective(runtime)!.objective;

  for (let f = 0; f < frames; f += 1) {
    let moveX = 0;
    let moveZ = 1;
    const mark = markRead(objective, runtime.motion.pos);
    if (mark) {
      const dx = mark.pos.x - runtime.motion.pos.x;
      const dz = mark.pos.z - runtime.motion.pos.z;
      const len = Math.hypot(dx, dz);
      if (len > 1e-4) {
        moveX = dx / len;
        moveZ = dz / len;
      }
    }
    const step = stepMissionRuntime(runtime, {
      dtS,
      moveX,
      moveZ,
      sprintHeld: true, // Shift held THE WHOLE TIME — the cap and gateway must land it.
      crouchHeld: false,
      jumpBuffered: false, // NEVER press jump: no jump impulse is allowed to help.
      reducedMotion: false,
      flowEnabled: true,
    });

    const p = runtime.motion.pos;
    const support = groundedSupport(world, p)?.id ?? null;
    const grounded = runtime.motion.grounded;
    const speed = Math.hypot(runtime.motion.vel.x, runtime.motion.vel.z);
    if (grounded) lastGroundedSpeed = speed;

    // The takeoff: the last grounded speed as the body leaves the roof lip over
    // the hatch (x past the vent, before it is on the beam). This is the number
    // the authored 2.3 m/s cap has to have already brought down from the sprint.
    if (
      wasGrounded &&
      !grounded &&
      result.takeoffSpeed === null &&
      p.x > vent[0] &&
      !result.landedOnBeam
    ) {
      result.takeoffSpeed = lastGroundedSpeed;
    }
    if (!grounded) result.maxAirY = Math.max(result.maxAirY, p.y);
    // A JUMP or JUMP_GAP committed at the hatch is exactly the overshoot the
    // gateway exists to forbid; so is any upward launch off the lip.
    if (runtime.flow.verb === "JUMP" || runtime.flow.verb === "JUMP_GAP") {
      result.jumped = true;
    }

    if (grounded && support === ROPEWALK_TIE_BEAM) {
      if (!result.landedOnBeam) {
        result.landedOnBeam = true;
        result.landedBeamX = p.x;
        result.beamDescents += 1;
      }
      if (p.x < result.landedBeamX - 1.0) result.progressedWest = true;
    }
    // The unlit floor is GROUND at y≈0, a whole storey below the beam: reaching
    // it is the botched-drop overshoot, and guidance cannot progress from there.
    if (grounded && support === "GROUND" && p.y < 3) result.touchedFloor = true;

    if (runtime.outcome?.kind === "FAILED") {
      result.fatal =
        (runtime.outcome as { failure?: { code?: string } }).failure?.code ?? "FAILED";
      break;
    }
    if (grounded && runtime.motion.action === null && step.steps > 0) {
      if (!positionClear(world, p, CAPSULE_RADIUS, STAND_HEIGHT, kerbs)) {
        result.penetrated = true;
        result.penetrationAt = { ...p };
        break;
      }
    }
    const movedThisFrame = Math.hypot(p.x - prev.x, p.z - prev.z);
    if (step.steps > 0) {
      if (movedThisFrame < STALL_EPSILON_M) stallTicks += step.steps;
      else stallTicks = 0;
    }
    prev = { ...p };
    wasGrounded = grounded;
    if (stallTicks > result.maxStallTicks) result.maxStallTicks = stallTicks;
    // Done once the body has landed the beam and walked a stride west on it.
    if (result.progressedWest) break;
  }
  return result;
}

test("a full-sprint entry to the ropewalk hatch decelerates, steps onto the tie beam, and never jumps to the floor", () => {
  const run = driveTheTieBeamDrop(20);
  assert.equal(run.fatal, null, `the run failed on the tie-beam drop: ${run.fatal}`);
  assert.equal(
    run.penetrated,
    false,
    `the body overlapped a blocker at ${JSON.stringify(run.penetrationAt)}`,
  );
  // The authored 2.3 m/s is a safety constraint: a sprint entry is braked to it
  // before the lip, not left to sail off at 4.6.
  assert.ok(
    run.takeoffSpeed !== null,
    "the body never left the roof lip over the hatch",
  );
  assert.ok(
    run.takeoffSpeed! <= 2.6,
    `the body took off at ${run.takeoffSpeed!.toFixed(2)} m/s — the 2.3 cap did not decelerate the sprint before the hatch`,
  );
  // A controlled chain drop, not a launch: no JUMP/JUMP_GAP, no upward impulse.
  assert.equal(run.jumped, false, "the reader committed a JUMP/JUMP_GAP at the hatch");
  assert.ok(
    run.maxAirY <= roofN().y + 0.2,
    `the body rose to y=${run.maxAirY.toFixed(2)} off the lip — a launch, not a step-off`,
  );
  // It lands ON the beam, exactly once, and never on the floor below.
  assert.ok(run.landedOnBeam, "the body never landed supported on the tie beam");
  assert.equal(run.touchedFloor, false, "the body fell through to the unlit floor");
  assert.equal(
    run.beamDescents,
    1,
    `the body settled on the beam ${run.beamDescents} times, not once`,
  );
  // And the mark leads it on west along the beam route, no stall.
  assert.ok(
    run.progressedWest,
    "the body landed the beam but the mark did not lead it on west along it",
  );
  assert.ok(
    run.maxStallTicks <= MAX_STALL_TICKS,
    `the run stalled ${(run.maxStallTicks / 60).toFixed(1)}s reaching/holding the beam`,
  );
});

/** The hatch take-off node's height, for the launch check above. */
function roofN(): { y: number } {
  const n = M1_EFFIGY_RUN.nodes.find((node) => node.id === "D2_ROOF_N")!;
  return { y: n.pos[1] };
}

// ---------------------------------------------------------------------------
// The hemp descent and the rope-capstan VAULT, on the real runtime.
//
// West along the tie beam the SAFE line runs off into the raw hemp — a chain of
// CHAIN_DROPs, D2_BEAM_W -> D2_BALES_HIGH -> D2_BALES_LOW -> D2_FLOOR_W — and at
// the foot of the stacks the tarring floor begins with a VAULT over the rope
// capstan (D2_VAULT_IN -> D2_VAULT_OUT). Two coupled defects lived here:
//
//   1. The rope capstan's top (1.05m) is a hair below the low hemp bale's top
//      (1.1m), so as the body ran off the bale's south edge the edge reader
//      SKIPPED the safe floor a metre straight down and read the capstan a stride
//      beyond as the far side of a gap — auto-committing a JUMP_GAP that launched
//      the body up and ONTO the capstan, where it oscillated between the bale and
//      the coil and never settled on the authored floor receiver. A gap jump
//      crosses a void; a safe descent onto an obstacle beyond is not one.
//
//   2. The capstan is bypassable — open floor a stride north of it — so the
//      distance anchor's near-band reached the vault's FAR side (D2_VAULT_OUT)
//      across a short straight span and advanced onto it, retiring the vault
//      take-off and arming the slide beyond. The vault was skipped and walked
//      around. A short transition into an action-critical vault must preserve its
//      take-off, not retire it because a global lead radius can straddle it.
//
// Driven with W+Shift held the entire time and NEVER pressing jump: the reader
// must land the body on the floor and take the capstan vault on its own.
// ---------------------------------------------------------------------------

const HEMP_BALES_LOW = "HEMP_BALES_LOW";
const ROPE_CAPSTAN = "ROPE_CAPSTAN";

interface HempRun {
  reachedLowBale: boolean;
  floorLandings: number;
  landedFloorPastBaleX: number;
  jumpedOffHemp: boolean;
  capstanLandings: number;
  baleCapstanFlips: number;
  vaultCommits: number;
  clearedCapstanVault: boolean;
  maxStallTicks: number;
  fatal: string | null;
  penetrated: boolean;
  penetrationAt: Vec3 | null;
}

/**
 * Drive the SAFE player west along the tie beam, down the hemp, and across the
 * tarring floor's capstan vault. Enters the beam's west end at a full sprint and
 * never presses jump — the reader and the guidance alone have to land the descent
 * and take the vault.
 */
function driveTheHempDescent(maxSeconds: number): HempRun {
  const runtime = firstAttemptRuntime();
  const world = runtime.instance.world;
  const kerbs = kerbIds(world);
  const dtS = 1 / 60;
  const frames = Math.round(maxSeconds * 60);
  const node = (id: string) => M1_EFFIGY_RUN.nodes.find((n) => n.id === id)!.pos;
  const beamW = node("D2_BEAM_W");
  const balesHigh = node("D2_BALES_HIGH");
  const vaultOut = node("D2_VAULT_OUT");
  // A checkpoint on the tie beam's west end, facing the hemp, carrying a full
  // sprint down the run-off — the body a normal W+Shift run arrives with.
  runtime.motion = createGroundedState(
    { x: beamW[0], y: beamW[1], z: beamW[2] },
    Math.atan2(balesHigh[0] - beamW[0], balesHigh[2] - beamW[2]),
  );

  let pendingJump = false;
  let jumpCooldown = 0;
  let stallTicks = 0;
  let prev: Vec3 = { ...runtime.motion.pos };
  let prevVerb = runtime.flow.verb;
  let prevSupport: string | null = null;
  const result: HempRun = {
    reachedLowBale: false,
    floorLandings: 0,
    landedFloorPastBaleX: Infinity,
    jumpedOffHemp: false,
    capstanLandings: 0,
    baleCapstanFlips: 0,
    vaultCommits: 0,
    clearedCapstanVault: false,
    maxStallTicks: 0,
    fatal: null,
    penetrated: false,
    penetrationAt: null,
  };
  const objective = standingObjective(runtime)!.objective;
  let wasGrounded = true;

  for (let f = 0; f < frames; f += 1) {
    let moveX = 0;
    let moveZ = 1;
    const mark = markRead(objective, runtime.motion.pos);
    if (mark) {
      const dx = mark.pos.x - runtime.motion.pos.x;
      const dz = mark.pos.z - runtime.motion.pos.z;
      const len = Math.hypot(dx, dz);
      if (len > 1e-4) {
        moveX = dx / len;
        moveZ = dz / len;
      }
    }
    // Link-aware: Space ONLY for a previewed ballistic leap, never on a cadence.
    // The hemp descent must land and vault without any of these firing.
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

    const step = stepMissionRuntime(runtime, {
      dtS,
      moveX,
      moveZ,
      sprintHeld: true,
      crouchHeld: false,
      jumpBuffered: pendingJump,
      reducedMotion: false,
      flowEnabled: true,
    });
    if (step.jumpConsumed) pendingJump = false;

    const p = runtime.motion.pos;
    const grounded = runtime.motion.grounded;
    const support = groundedSupport(world, p)?.id ?? null;
    const stood = grounded ? support : null;

    if (stood === HEMP_BALES_LOW) result.reachedLowBale = true;
    // A JUMP/JUMP_GAP off the hemp is the old launch onto the capstan.
    if (
      (runtime.flow.verb === "JUMP" || runtime.flow.verb === "JUMP_GAP") &&
      p.x < 62 &&
      p.y < 3.3
    ) {
      result.jumpedOffHemp = true;
    }
    // Grounded touchdown transitions, told apart by the surface landed on.
    if (grounded && !wasGrounded) {
      if (support === "GROUND" && p.z > 20 && p.x < 61) {
        result.floorLandings += 1;
        result.landedFloorPastBaleX = Math.min(result.landedFloorPastBaleX, p.x);
      }
      if (support === ROPE_CAPSTAN) result.capstanLandings += 1;
    }
    // Oscillation: the support flipping between the low bale and the capstan is
    // the exact old thrash the reader used to produce.
    if (
      stood !== null &&
      stood !== prevSupport &&
      ((stood === HEMP_BALES_LOW && prevSupport === ROPE_CAPSTAN) ||
        (stood === ROPE_CAPSTAN && prevSupport === HEMP_BALES_LOW))
    ) {
      result.baleCapstanFlips += 1;
    }
    if (stood !== null) prevSupport = stood;

    // The capstan VAULT: a rising edge into VAULT while on the tarring floor.
    if (runtime.flow.verb === "VAULT" && prevVerb !== "VAULT" && p.z < 20.6) {
      result.vaultCommits += 1;
    }
    // Cleared it: grounded at/past D2_VAULT_OUT on the floor.
    if (grounded && support === "GROUND" && p.x >= vaultOut[0] - 0.5 && p.z < 20) {
      result.clearedCapstanVault = true;
    }
    prevVerb = runtime.flow.verb;
    wasGrounded = grounded;

    if (runtime.outcome?.kind === "FAILED") {
      result.fatal =
        (runtime.outcome as { failure?: { code?: string } }).failure?.code ?? "FAILED";
      break;
    }
    if (grounded && runtime.motion.action === null && step.steps > 0) {
      if (!positionClear(world, p, CAPSULE_RADIUS, STAND_HEIGHT, kerbs)) {
        result.penetrated = true;
        result.penetrationAt = { ...p };
        break;
      }
    }
    const movedThisFrame = Math.hypot(p.x - prev.x, p.z - prev.z);
    if (step.steps > 0) {
      if (movedThisFrame < STALL_EPSILON_M) stallTicks += step.steps;
      else stallTicks = 0;
    }
    prev = { ...p };
    if (stallTicks > result.maxStallTicks) result.maxStallTicks = stallTicks;
    if (result.clearedCapstanVault) break;
  }
  return result;
}

test("the SAFE hemp descent lands on the floor once and vaults the capstan, never launching onto it", () => {
  const run = driveTheHempDescent(30);
  assert.equal(run.fatal, null, `the run failed on the hemp descent: ${run.fatal}`);
  assert.equal(
    run.penetrated,
    false,
    `the body overlapped a blocker at ${JSON.stringify(run.penetrationAt)}`,
  );
  assert.ok(run.reachedLowBale, "the descent never reached the low hemp bale");
  // The old hijack: a JUMP_GAP off the bale that launched the body onto the coil.
  assert.equal(
    run.jumpedOffHemp,
    false,
    "the reader launched a JUMP/JUMP_GAP off the hemp — the coplanar capstan read as a gap",
  );
  assert.equal(
    run.capstanLandings,
    0,
    `the body dropped onto the rope capstan ${run.capstanLandings} times off the descent — the launch overshoot`,
  );
  // The oscillation the frontier reported: support thrashing bale<->capstan.
  assert.equal(
    run.baleCapstanFlips,
    0,
    `the body oscillated ${run.baleCapstanFlips} times between the low bale and the capstan`,
  );
  // A controlled descent settles on the authored floor receiver, exactly once.
  assert.ok(
    run.floorLandings >= 1,
    "the descent never settled supported on the tarring floor",
  );
  // Then the capstan VAULT is taken on the authored axis, once, and cleared —
  // not walked around by the anchor skipping the take-off.
  assert.equal(
    run.vaultCommits,
    1,
    `the capstan VAULT committed ${run.vaultCommits} times, not once (0 = the anchor skipped the take-off and walked around it)`,
  );
  assert.ok(
    run.clearedCapstanVault,
    "the body never cleared the capstan vault to D2_VAULT_OUT — the vault was skipped",
  );
  assert.ok(
    run.maxStallTicks <= MAX_STALL_TICKS,
    `the run stalled ${(run.maxStallTicks / 60).toFixed(1)}s on the hemp descent / capstan`,
  );
});
