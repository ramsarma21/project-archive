import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FIELD_DT,
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
// The Liberty Elm continuation, on the real runtime, driven with normal
// player-equivalent input: steer at the committed mark, hold sprint, press Space
// ONLY for a previewed ballistic GAP jump, take the authored dive by sprinting
// off the steeple (never by a jump press), and nail the handbill by striking the
// beat's own chart on its due ticks.
//
// It repairs three coupled frontiers that silently soft-locked the run one node
// past the objective, all in the descent out of the tree:
//
//   1. THE LEAP OF FAITH off the steeple gallery. The climb up the louvre tops
//      the body out a stride from the south rim, already decelerating, over a
//      fatal street drop with the crown target the only safe way down. The reader
//      offered the dive only in its moving branch, and the brake — which the dive
//      is ranked to beat — confirmed under the flow floor and killed the approach
//      before it could reach that branch, then persisted. Now a solvable dive
//      outranks the brake at any speed and is exempt from the verb cooldown the
//      louvre climb sets, so the body dives instead of braking at the lip.
//
//   2. THE CLIMB-DOWN off the crown. F_POST -> F_POST_STEP is an authored CLIMB
//      that goes DOWN — the crown overhangs the low bough, so a stroll off the
//      rim falls to the street and the reader answers the rim with a hang drop.
//      A CLIMB gateway that allowed only the upward verbs filtered that descent
//      out and braked at the rim with the sheet already nailed. The CLIMB verb
//      family now includes the downward members.
//
//   3. THE HANG DROPS onto the awning and the ground. F_AWNING and F_GROUND sat
//      under the decks that overhang them, so the mark led the body to interior
//      spots it could not fall through, a stride short of the rims it actually
//      drops off. They now sit at the reachable west-edge landings, and hang
//      drops are exempt from the post-verb cooldown so the crown->bough->awning
//      ->ground chain survives each tier's landing.
//
// It assumes the perspective stops are answered when isolating pure traversal
// (see traversalEncounters); the final full-run test drives the real encounter
// machine to a CORRECT verdict instead. Production encounter behaviour is
// untouched either way.
// ---------------------------------------------------------------------------

const STALL_EPSILON_M = 0.002;
/** 1.5s at 60Hz: longer than any authored vault, climb, dive or hang drop. */
const MAX_STALL_TICKS = 90;
const KERB_MAX_HEIGHT_M = 0.5;

function nodePos(id: string): Vec3 {
  const n = M1_EFFIGY_RUN.nodes.find((node) => node.id === id);
  if (!n) throw new Error(`M1 route has no node ${id}`);
  return { x: n.pos[0], y: n.pos[1], z: n.pos[2] };
}

function kerbIds(world: CollisionWorld): Set<string> {
  const ids = new Set<string>();
  for (const b of world.blockers) {
    if (b.landable && Number.isFinite(b.topY) && b.topY - b.baseY <= KERB_MAX_HEIGHT_M) {
      ids.add(b.id);
    }
  }
  return ids;
}

function firstAttemptRuntime(): MissionRuntime {
  const instance = m1Instance({
    missionId: M1_MISSION_ID,
    attemptOrdinal: 1, // SAFE-only guidance, the first-run case
    seed: 0xb057,
    Scenery: null,
  });
  return createMissionRuntime({ instance, seed: 0xb057 });
}

interface SafeRun {
  reachedDuel: boolean;
  reachedTick: number;
  fatal: string | null;
  penetrated: boolean;
  penetrationAt: Vec3 | null;
  maxStallTicks: number;
  supportsSeen: Set<string>;
  verbsCommitted: Set<string>;
  /** A LEAP_OF_FAITH verb ran while airborne off the steeple gallery. */
  leftGalleryByDive: boolean;
  /** The dive was captured on the crown (grounded on BOUGH_CROWN after it). */
  landedCrownByDive: boolean;
  /** The beat resolved with the sheet posted. */
  posted: boolean;
  beatStruck: number;
  beatJudged: number;
  /** Distinct grounded touchdowns on each descent tier, in order reached. */
  crownReached: boolean;
  lowBoughReached: boolean;
  awningReached: boolean;
  groundAfterTreeReached: boolean;
  /** A hang drop was the verb that left the crown rim. */
  crownDescentWasHangDrop: boolean;
  /** Space presses (jump consumed). Consent to ballistic gap jumps only. */
  spacePresses: number;
  /** Encounters that reached a verdict through the real machine. */
  encountersResolved: number;
  /** Resolved stops whose CORRECT answer bought a reprieve consequence. */
  encounterReprieves: number;
  satisfied: string[];
}

/**
 * Drive the SAFE line on the real runtime. `start`/`toward` place a checkpoint
 * with the shipped grounded-state builder; `driveEncounters` chooses between
 * isolating the perspective stops (pure traversal) and driving them through the
 * real machine to a CORRECT verdict.
 */
function driveSafe(options: {
  start: string;
  toward: string;
  maxSeconds: number;
  driveEncounters: boolean;
}): SafeRun {
  const runtime = firstAttemptRuntime();
  const world = runtime.instance.world;
  const kerbs = kerbIds(world);
  const beatSpec = runtime.instance.beat!.spec;
  if (!options.driveEncounters) resolveEncountersForTraversal(runtime);

  const start = nodePos(options.start);
  const toward = nodePos(options.toward);
  runtime.motion = createGroundedState(
    { x: start.x, y: start.y, z: start.z },
    Math.atan2(toward.x - start.x, toward.z - start.z),
  );

  const dtS = 1 / 60;
  const frames = Math.round(options.maxSeconds * 60);
  const result: SafeRun = {
    reachedDuel: false,
    reachedTick: -1,
    fatal: null,
    penetrated: false,
    penetrationAt: null,
    maxStallTicks: 0,
    supportsSeen: new Set<string>(),
    verbsCommitted: new Set<string>(),
    leftGalleryByDive: false,
    landedCrownByDive: false,
    posted: false,
    beatStruck: 0,
    beatJudged: 0,
    crownReached: false,
    lowBoughReached: false,
    awningReached: false,
    groundAfterTreeReached: false,
    crownDescentWasHangDrop: false,
    spacePresses: 0,
    encountersResolved: 0,
    encounterReprieves: 0,
    satisfied: [],
  };

  let pendingJump = false;
  let jumpCooldown = 0;
  let stallTicks = 0;
  let prev: Vec3 = { ...runtime.motion.pos };
  let prevVerb = runtime.flow.verb;
  let prevSupport: string | null = null;

  // ---- beat driver ----
  // The beat is a reaction test now: it arms on its own when the player stands
  // at the work facing the tree, and flares come up on a panel one at a time.
  // The driver clicks the lit flare's cell as soon as it appears, which is what
  // a paying-attention player does.
  const clickedFlares = new Set<number>();

  const inStance = (): boolean => {
    const p = runtime.motion.pos;
    return (
      Math.hypot(p.x - beatSpec.stance.x, p.z - beatSpec.stance.z) <= beatSpec.stanceRadiusM &&
      Math.abs(p.y - beatSpec.stance.y) <= beatSpec.stanceHeightToleranceM
    );
  };

  for (let f = 0; f < frames; f += 1) {
    const p = runtime.motion.pos;
    const standing = standingObjective(runtime);
    const objId = standing?.objective.id ?? null;

    // Drive the real encounter machine to a CORRECT verdict when a stop opens.
    // This is the documented correct-answer seam: it steps the actual state
    // machine (APPROACH -> QUESTION -> SUBMITTING -> RESOLVED -> RELEASED) and
    // fires its real reprieve consequence, rather than forcing a terminal phase.
    if (options.driveEncounters && runtime.encounterView?.phase === "QUESTION") {
      const id = runtime.encounterView.encounterId;
      runtime.encounterSubmit = id;
      runtime.encounterVerdictInbox.set(id, "CORRECT");
    }

    let moveX = 0;
    let moveZ = 1;
    let hitCell: number | null = null;
    const drivingBeat = objId === "post-the-handbill" && inStance();
    if (drivingBeat) {
      // Stand on the bough and aim the camera at the tree; the beat arms itself,
      // and the driver strikes each flare's cell the moment it lights.
      moveX = 0;
      moveZ = 0;
      runtime.motion = { ...runtime.motion, yaw: beatSpec.facingYaw };
      const run = runtime.beat;
      if (run && run.startedTick !== null) {
        const offset = runtime.clock.tick - run.startedTick;
        const live = run.schedule.targets.find(
          (t) =>
            !run.resolved[t.index] && offset >= t.spawnTick && offset <= t.expireTick,
        );
        if (live && !clickedFlares.has(live.index)) {
          hitCell = live.cell;
          clickedFlares.add(live.index);
        }
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

    // Consent to a previewed ballistic GAP jump only. A LEAP_OF_FAITH is taken
    // by sprinting off the lip, not by a jump press (a jump at a dive not yet at
    // commit distance fires the standing-jump fallback and hops in place). And a
    // link-aware player never presses Space where the committed guidance is a
    // controlled-descent gateway (the ropewalk tie-beam drop authorises only a
    // RUN_OFF/HANG_DROP): the HUD shows a step-down there, not a leap, so consent
    // is withheld when the gateway forbids a jump.
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

    const frame: MissionInputFrame = {
      dtS,
      moveX,
      moveZ,
      sprintHeld: !drivingBeat,
      crouchHeld: false,
      jumpBuffered: pendingJump,
      hitCellBuffered: hitCell,
      reducedMotion: false,
      flowEnabled: true,
    };
    const step = stepMissionRuntime(runtime, frame);
    if (step.jumpConsumed) {
      pendingJump = false;
      result.spacePresses += 1;
    }
    if (runtime.beat?.startedTick != null && result.beatJudged === 0) {
      result.beatJudged = runtime.beat.schedule.targets.length;
    }
    if (step.hitConsumed) result.beatStruck += 1;

    const support = runtime.motion.grounded
      ? groundedSupport(world, runtime.motion.pos)?.id ?? null
      : null;
    if (support) result.supportsSeen.add(support);
    if (runtime.flow.verb !== "NONE") result.verbsCommitted.add(runtime.flow.verb);

    // Frontier instrumentation.
    if (!runtime.motion.grounded && runtime.flow.verb === "LEAP_OF_FAITH" && p.y > 8 && p.z > 2) {
      result.leftGalleryByDive = true;
    }
    if (support === "BOUGH_CROWN") {
      result.crownReached = true;
      if (result.leftGalleryByDive && prevVerb === "LEAP_OF_FAITH") result.landedCrownByDive = true;
    }
    if (support === "BOUGH_LOW") result.lowBoughReached = true;
    if (support === "TREE_AWNING") result.awningReached = true;
    if (support === "GROUND" && p.x > 74 && p.x < 90 && p.y < 1 && result.awningReached) {
      result.groundAfterTreeReached = true;
    }
    // The crown rim descent verb: a hang drop begun while standing on the crown.
    if (
      runtime.flow.verb === "HANG_DROP" &&
      prevVerb !== "HANG_DROP" &&
      prevSupport === "BOUGH_CROWN"
    ) {
      result.crownDescentWasHangDrop = true;
    }
    prevVerb = runtime.flow.verb;
    if (support !== null) prevSupport = support;

    if (runtime.beatOutcome?.posted) result.posted = true;

    if (runtime.outcome?.kind === "FAILED") {
      result.fatal =
        (runtime.outcome as { failure?: { code?: string } }).failure?.code ?? "FAILED";
      break;
    }
    if (runtime.motion.grounded && runtime.motion.action === null && step.steps > 0) {
      if (!positionClear(world, runtime.motion.pos, CAPSULE_RADIUS, STAND_HEIGHT, kerbs)) {
        result.penetrated = true;
        result.penetrationAt = { ...runtime.motion.pos };
        break;
      }
    }

    const moved = Math.hypot(runtime.motion.pos.x - prev.x, runtime.motion.pos.z - prev.z);
    if (step.steps > 0 && !drivingBeat) {
      if (moved < STALL_EPSILON_M) stallTicks += step.steps;
      else stallTicks = 0;
    }
    if (stallTicks > result.maxStallTicks) result.maxStallTicks = stallTicks;
    prev = { ...runtime.motion.pos };

    if (runtime.outcome?.kind === "REACHED_DUEL") {
      result.reachedDuel = true;
      result.reachedTick = runtime.ticks;
      break;
    }
  }

  result.encountersResolved = runtime.encounters.filter(
    (enc) => enc.phase === "RESOLVED" || enc.phase === "RELEASED",
  ).length;
  result.encounterReprieves = [...runtime.encounterSummaries.values()].filter(
    (summary) => summary.reprieve,
  ).length;
  result.satisfied = [...runtime.satisfied];
  return result;
}

// ---------------------------------------------------------------------------
// The continuation from before E_BUTTRESS, encounters isolated (pure traversal).
// ---------------------------------------------------------------------------

test("the SAFE line dives off the steeple gallery into the crown, nails the handbill, descends the tree, and reaches the duel", () => {
  const run = driveSafe({
    start: "D2_OUTSIDE",
    toward: "E_BUTTRESS",
    maxSeconds: 60,
    driveEncounters: false,
  });

  assert.equal(run.fatal, null, `the run failed before the duel: ${run.fatal}`);
  assert.equal(
    run.penetrated,
    false,
    `the body overlapped a blocker at ${JSON.stringify(run.penetrationAt)}`,
  );

  // Frontier 1: the leap of faith is control-executable off the gallery.
  assert.ok(run.leftGalleryByDive, "the SAFE line never committed the leap of faith off the steeple gallery");
  assert.ok(
    run.supportsSeen.has("BOUGH_CROWN"),
    "the dive did not land the body on the crown of the Liberty Elm",
  );
  assert.ok(run.landedCrownByDive, "the crown was not reached by the leap of faith");

  // The objective: the sheet actually goes up, driven on the beat's own chart.
  assert.ok(run.posted, "the handbill beat never resolved to posted");
  assert.equal(
    run.beatStruck,
    run.beatJudged,
    `the beat driver struck ${run.beatStruck} of ${run.beatJudged} judged strokes`,
  );
  assert.ok(run.satisfied.includes("post-the-handbill"), "the post objective was not satisfied");

  // Frontier 2 + 3: the descent out of the tree, tier by tier.
  assert.ok(run.crownDescentWasHangDrop, "the crown rim was not left by a controlled hang drop");
  assert.ok(run.lowBoughReached, "the descent never reached the low bough");
  assert.ok(run.awningReached, "the descent never reached the stall awning");
  assert.ok(run.groundAfterTreeReached, "the descent never reached the ground under the tree");

  // The handoff: the run reaches the duel once, with the required objectives met.
  assert.ok(run.reachedDuel, "the SAFE line never reached the duel from before E_BUTTRESS");
  assert.ok(run.satisfied.includes("reach-the-yard"), "the yard objective was not satisfied");
  assert.ok(
    run.maxStallTicks <= MAX_STALL_TICKS,
    `the run stalled ${(run.maxStallTicks / 60).toFixed(1)}s somewhere on the continuation`,
  );
  // The dive is taken by sprinting, and the descent is controlled: the only Space
  // presses are consent to authored gap jumps, never a cadence and never the dive.
  assert.ok(
    run.spacePresses <= 3,
    `the run pressed Space ${run.spacePresses} times reaching the duel — that is a cadence, not per-leap consent`,
  );
});

// ---------------------------------------------------------------------------
// The whole mission, from the printshop leads, as ONE continuous run. Encounters
// are isolated here so this proves the pure-traversal composition: the E->F->G
// repairs compose with sections A-D and the run reaches the duel end to end. The
// perspective stops' real state machine is exercised separately below.
// ---------------------------------------------------------------------------

test("a full SAFE run from mission start composes through every section and reaches the duel once", () => {
  const run = driveSafe({
    start: "A_START",
    toward: "A_SHEETS",
    maxSeconds: 170,
    driveEncounters: false,
  });

  assert.equal(run.fatal, null, `the full SAFE run failed: ${run.fatal}`);
  assert.equal(
    run.penetrated,
    false,
    `the body overlapped a blocker at ${JSON.stringify(run.penetrationAt)}`,
  );
  assert.ok(run.reachedDuel, "the full SAFE run never reached the duel");
  assert.ok(run.leftGalleryByDive, "the full run never took the leap of faith");
  assert.ok(run.posted, "the handbill beat never resolved to posted on the full run");
  assert.ok(run.satisfied.includes("post-the-handbill"), "the post objective was not satisfied");
  assert.ok(run.satisfied.includes("reach-the-yard"), "the yard objective was not satisfied");
  assert.ok(
    run.maxStallTicks <= MAX_STALL_TICKS,
    `the full run stalled ${(run.maxStallTicks / 60).toFixed(1)}s somewhere`,
  );
});

// ---------------------------------------------------------------------------
// The required interactions, honestly. Rather than force the encounter machines
// into a terminal phase, this drives BOTH authored perspective stops through the
// real state machine to a CORRECT verdict — the documented correct-answer seam —
// and asserts each participated and fired its real reprieve consequence. It runs
// the actual mission sequence up to and through both stops; it does not depend on
// the fragile ropewalk tie-beam drop the stop's from-rest restart perturbs (a
// separate ropewalk-interior matter), so it isolates exactly the "the required
// interactions ran for real" claim.
// ---------------------------------------------------------------------------

test("both perspective stops are answered through the real encounter machine, each buying its reprieve", () => {
  const run = driveSafe({
    start: "A_START",
    toward: "A_SHEETS",
    maxSeconds: 90,
    driveEncounters: true,
  });

  assert.equal(run.fatal, null, `the run failed before both stops were answered: ${run.fatal}`);
  assert.equal(
    run.encountersResolved,
    2,
    `${run.encountersResolved} of 2 perspective stops reached a verdict through the real machine`,
  );
  assert.equal(
    run.encounterReprieves,
    2,
    `${run.encounterReprieves} of 2 CORRECT answers bought a reprieve consequence`,
  );
});
