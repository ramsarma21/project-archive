import { test } from "node:test";
import assert from "node:assert/strict";

import { CAPSULE_RADIUS, canStand, supportBelow } from "@pa/engine-world/collision";
import { RUN_SPEED, WALK_SPEED, createGroundedState } from "@pa/engine-world/playerMotion";
import { FIELD_DT } from "@pa/engine-world/fieldSimulation";
import { createFlowState, stepFlow } from "@pa/engine-world/parkour";
import type { CollisionWorld } from "@pa/engine-world/collision";

import { climbVolume } from "../authoring.js";
import { compileLevel } from "../compile.js";
import { M1_EFFIGY_RUN } from "../level/index.js";

// ---------------------------------------------------------------------------
// THE ASCENT HALF OF routeFlow.test.ts, AND THE GATE THE OVERHEAD-REFUSAL CLASS
// HAS BEEN WALKING THROUGH ALL WEEK.
//
// A climb in this level can be authored perfectly, verify against the collision
// hulls, satisfy the affordance gate on real mesh, and still never be OFFERED to
// a player. `readRaisedSurface` skips any surface carrying the same id as the
// one over the player's own feet — so a standing spot inside the footprint of
// the deck it is climbing onto is silently unclimbable — and a `climbVolume`
// with no ladder or grip at that foot REFUSES the ascent outright. Both fail at
// authoring time and surface only as a climb that does nothing.
//
// Nothing caught either. `traversability.test.ts` asks `beginAuthored` whether
// the move COULD run if commanded, and it could; during play nothing commands
// anything and the verb ladder decides. `ladderOffers.test.ts` asks what the
// geometry offers from one heading. `routeFlow.test.ts` drives the real
// controller but only DOWNWARD. The mission's climax sat unreachable through an
// entire rebuild inside that gap.
//
// So this drives real `stepFlow` UP every authored ascent a player takes by
// holding the parkour key, from the approach a body arrives across, and requires
// the body to end up standing at the destination's height on a surface that is
// actually the destination. It is the same shape as the descent test and it
// fails the same way: by name, with what the body ended on instead.
//
// A STATIC PREDICATE WAS TRIED FIRST AND REJECTED. Sweeping for "source node
// inside the target deck's rect" matches twelve authored links, of which at
// most two are defects: seven are served by a ladder or grip through the
// `readOverhead` fallback, and three stand exactly on the rect boundary, which
// is a body at the lip and correct authoring. A check that cries wolf ten times
// in twelve is a check that gets muted. Driving the body answers the question
// the predicate was a proxy for.
// ---------------------------------------------------------------------------

const level = M1_EFFIGY_RUN;
const compiled = compileLevel(level);
const world = compiled.world;
const nodeById = new Map(level.nodes.map((n) => [n.id, n]));

/** Ascents a body takes by holding the parkour key, not by a named jump. */
const READER_DRIVEN = new Set(["CLIMB"]);

interface Ascent {
  id: string;
  line: string;
  fromId: string;
  toId: string;
  toSurface: string;
  toPos: readonly [number, number, number];
  riseM: number;
  dirX: number;
  dirZ: number;
  startX: number;
  startY: number;
  startZ: number;
}

function ascents(world: CollisionWorld, lines: ReadonlySet<string>): Ascent[] {
  const out: Ascent[] = [];
  for (const link of level.links) {
    if (!lines.has(link.line)) continue;
    if (!READER_DRIVEN.has(link.kind)) continue;
    const from = nodeById.get(link.from);
    const to = nodeById.get(link.to);
    if (!from || !to) continue;
    const rise = to.pos[1] - from.pos[1];
    if (rise <= 0.35) continue; // not an ascent

    // A pure vertical reach has no planar direction of its own; the player still
    // has to be facing somewhere, and the authored pair is the honest guess.
    const dx = to.pos[0] - from.pos[0];
    const dz = to.pos[2] - from.pos[2];
    const planar = Math.hypot(dx, dz);
    const dirX = planar > 1e-6 ? dx / planar : 0;
    const dirZ = planar > 1e-6 ? dz / planar : 1;

    // Stand the body back from the climb foot on ground it arrives across, so
    // the read happens on approach the way it does in play. Shrinks until the
    // spot is standable at the foot's own height, exactly as the descent test's
    // back-off does.
    let back = 1.2;
    let startX = from.pos[0] - dirX * back;
    let startZ = from.pos[2] - dirZ * back;
    while (back > 0) {
      const support = supportBelow(world, startX, startZ, from.pos[1] + 0.05, 0.05);
      if (
        support &&
        Math.abs(support.y - from.pos[1]) < 0.05 &&
        canStand(world, startX, startZ, CAPSULE_RADIUS, from.pos[1])
      ) {
        break;
      }
      back -= 0.2;
      startX = from.pos[0] - dirX * back;
      startZ = from.pos[2] - dirZ * back;
    }

    out.push({
      id: link.id,
      line: link.line,
      fromId: link.from,
      toId: link.to,
      toSurface: to.surface,
      toPos: to.pos,
      riseM: rise,
      dirX,
      dirZ,
      startX,
      startY: from.pos[1],
      startZ,
    });
  }
  return out;
}

interface Outcome {
  reached: boolean;
  climbed: boolean;
  endSurface: string | null;
  endY: number;
}

/**
 * A climb counts as arrived when the body is standing at the destination's
 * height on something that carries it there.
 *
 * Judged on HEIGHT plus a surface that reaches it, not on the destination's
 * id alone: several ascents legitimately top out on the mass whose roof deck
 * the node names — the Town House leads are the block's own top at 12.40, and
 * arriving on `TOWNHOUSE` at 12.40 is arriving on the leads. Requiring the id
 * would fail a climb that works, which is the failure mode that gets a gate
 * muted.
 */
function arrived(
  world: CollisionWorld,
  x: number,
  z: number,
  y: number,
  toPos: readonly [number, number, number],
): boolean {
  if (Math.abs(y - toPos[1]) > 0.6) return false;
  const support = supportBelow(world, x, z, y + 0.05, 0.05);
  return support !== null && Math.abs(support.y - toPos[1]) < 0.6;
}

function drive(world: CollisionWorld, ascent: Ascent, speed: number): Outcome {
  let motion = createGroundedState(
    { x: ascent.startX, y: ascent.startY, z: ascent.startZ },
    Math.atan2(ascent.dirX, ascent.dirZ),
  );
  let flow = createFlowState();
  let climbed = false;
  let endSurface: string | null = null;
  for (let tick = 0; tick < Math.round(8 / FIELD_DT); tick++) {
    // Steer at the destination the way a player following the mark does. For a
    // pure vertical reach the aim collapses to the authored heading, which is
    // the direction the level says the body faces to make the climb.
    let aimX = ascent.toPos[0] - motion.pos.x;
    let aimZ = ascent.toPos[2] - motion.pos.z;
    const aimLen = Math.hypot(aimX, aimZ);
    if (aimLen > 0.35) {
      aimX /= aimLen;
      aimZ /= aimLen;
    } else {
      aimX = ascent.dirX;
      aimZ = ascent.dirZ;
    }
    const result = stepFlow(world, motion, flow, {
      dt: FIELD_DT,
      targetVelX: aimX * speed,
      targetVelZ: aimZ * speed,
      sprintHeld: true,
      crouchHeld: false,
      jumpBuffered: false,
      flowEnabled: true,
      reducedMotion: false,
      receivingTargets: [],
    });
    motion = result.motion;
    flow = result.flow;
    if (result.flow.verb === "CLIMB_UP" || result.flow.verb === "STEP_UP") climbed = true;
    if (motion.grounded) {
      const support = supportBelow(world, motion.pos.x, motion.pos.z, motion.pos.y + 0.05, 0.05);
      endSurface = support?.id ?? null;
      if (arrived(world, motion.pos.x, motion.pos.z, motion.pos.y, ascent.toPos)) {
        return { reached: true, climbed, endSurface, endY: motion.pos.y };
      }
    }
  }
  return { reached: false, climbed, endSurface, endY: motion.pos.y };
}

/** Reached at either a cautious walk-in or a committed sprint. */
function reaches(world: CollisionWorld, ascent: Ascent): Outcome {
  const walk = drive(world, ascent, WALK_SPEED);
  if (walk.reached) return walk;
  return drive(world, ascent, RUN_SPEED);
}

test("the level authors reader-driven ascents to check", () => {
  const safe = ascents(world, new Set(["SAFE"]));
  assert.ok(
    safe.length >= 10,
    `expected the whole SAFE ascent chain; found ${safe.length}`,
  );
});

test("driving real stepFlow up every SAFE ascent lands the body on the authored surface", () => {
  // No allowlist, for the same reason the descent test has none. A climb that
  // cannot be driven is a climb the player cannot make, whatever the hull says.
  const failures: string[] = [];
  for (const ascent of ascents(world, new Set(["SAFE"]))) {
    const outcome = reaches(world, ascent);
    if (!outcome.reached) {
      failures.push(
        `${ascent.id} (${ascent.fromId}->${ascent.toId}, ${ascent.riseM.toFixed(2)}m onto ` +
          `${ascent.toSurface}): ended on ${outcome.endSurface ?? "nothing"} at y=${outcome.endY.toFixed(2)}` +
          `, wanted y=${ascent.toPos[1].toFixed(2)}${outcome.climbed ? "" : " — no CLIMB_UP was ever offered"}`,
      );
    }
  }
  assert.deepEqual(
    failures,
    [],
    `SAFE ascents that real stepFlow cannot drive a body up:\n  ${failures.join("\n  ")}`,
  );
});

test("the instrument fails when a climb goes silently dead", () => {
  // A GATE THAT CANNOT FAIL IS NOT EVIDENCE. This mutates the level the exact
  // way the class does in the wild — it puts a climb volume over a served
  // surface with no ladder and no grip at that foot, which is the refusal at
  // probe.ts, and which every static check in the repo passes — and requires
  // the driver above to notice.
  const victim = ascents(world, new Set(["SAFE"])).find(
    (a) => a.fromId === "F_LOW" && a.toId === "F_CROWN",
  );
  assert.ok(victim, "the elm ascent is the case this instrument was built for");

  const before = reaches(world, victim!);
  assert.ok(
    before.reached,
    `the elm ascent must be drivable before it is broken (ended on ${before.endSurface} at y=${before.endY.toFixed(2)})`,
  );

  const sabotaged = compileLevel({
    ...level,
    climbs: [
      ...level.climbs,
      climbVolume({
        section: "F_TREE",
        serves: `${victim!.fromId}->${victim!.toId}`,
        onto: victim!.toSurface,
        at: [victim!.startX, victim!.startY, victim!.startZ],
        halfX: 2,
        halfZ: 2,
      }),
    ],
  });
  assert.ok(
    (sabotaged.world.climbVolumes ?? []).some((v) => v.toSurface === victim!.toSurface),
    "the sabotage must reach the compiled world, or this proves nothing",
  );

  const after = reaches(sabotaged.world, ascents(sabotaged.world, new Set(["SAFE"])).find(
    (a) => a.fromId === "F_LOW" && a.toId === "F_CROWN",
  )!);
  assert.equal(
    after.reached,
    false,
    "a climb volume with no ladder and no grip at the foot must kill the ascent, and this driver must see it",
  );
});
