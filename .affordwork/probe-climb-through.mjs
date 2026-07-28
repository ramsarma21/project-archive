// ARCHITECTURE PROBE: do authored transitions drive the capsule THROUGH the
// surface they are climbing?
//
// The production non-penetration invariant (`motionPenetration`) excludes
// `action.ignore` for the whole authored move, so it is structurally blind to
// the body entering the very hull it is climbing. This probe measures what the
// invariant refuses to look at: for each authored CLIMB / MANTLE / VAULT /
// CLIMB_OVER link on the real route, it drives the REAL stepFlow controller into
// the move and reports the deepest the capsule ever sinks into ANY solid blocker
// with NO ignore set at all — i.e. the phasing a player actually sees.

// Run from the repo root:  node --import tsx .affordwork/probe-climb-through.mjs
// Relative source imports so it needs no workspace package resolution.
import { compileLevel } from "../packages/mission-m1/src/compile.ts";
import { M1_EFFIGY_RUN } from "../packages/mission-m1/src/level/index.ts";
import {
  createGroundedState,
  RUN_SPEED,
} from "../packages/engine-world/src/playerMotion.ts";
import {
  CAPSULE_RADIUS,
  capsuleEmbeddedIn,
} from "../packages/engine-world/src/collision.ts";
import {
  createFlowState,
  stepFlow,
} from "../packages/engine-world/src/parkour/index.ts";
import { FIELD_DT } from "../packages/engine-world/src/fieldSimulation.ts";

const level = M1_EFFIGY_RUN;
const { world } = compileLevel(level);
const nodeById = new Map(level.nodes.map((n) => [n.id, n]));

const EMPTY = new Set();

// Deepest the capsule sinks into any solid, ignoring nothing.
function worstEmbed(pos, height) {
  const embeds = capsuleEmbeddedIn(world, pos, CAPSULE_RADIUS, height, EMPTY);
  let worst = null;
  for (const e of embeds) if (!worst || e.depthM > worst.depthM) worst = e;
  return worst;
}

// Authored transitions that place the body along an anchored path.
const TRANSITION = new Set(["CLIMB", "MANTLE", "VAULT"]);

const results = [];
for (const link of level.links) {
  if (!TRANSITION.has(link.kind)) continue;
  const from = nodeById.get(link.from);
  const to = nodeById.get(link.to);
  if (!from || !to) continue;

  const dx = to.pos[0] - from.pos[0];
  const dz = to.pos[2] - from.pos[2];
  let planar = Math.hypot(dx, dz);
  // Pure-vertical ascents (climb volumes / overhead read) share x,z; steer along
  // +x by default so the reader has a heading to plant the landing inset along.
  let axX = planar > 1e-3 ? dx / planar : 1;
  let axZ = planar > 1e-3 ? dz / planar : 0;

  // Start a little back from the foot node so the body runs INTO the face for a
  // face climb; a vertical ascent stands in its own volume and this is a no-op.
  const back = planar > 1e-3 ? 0.8 : 0;
  const start = {
    x: from.pos[0] - axX * back,
    y: from.pos[1],
    z: from.pos[2] - axZ * back,
  };

  let motion = createGroundedState(start, Math.atan2(axX, axZ));
  let flow = createFlowState();

  let committed = false;
  let committedVerb = null;
  let worst = null; // { depthM, id, y, duringAction, ignored }
  let reachedTop = false;

  for (let tick = 0; tick < Math.round(4 / FIELD_DT); tick++) {
    const res = stepFlow(world, motion, flow, {
      dt: FIELD_DT,
      targetVelX: axX * RUN_SPEED,
      targetVelZ: axZ * RUN_SPEED,
      sprintHeld: true,
      crouchHeld: false,
      jumpBuffered: false,
      dashBuffered: false,
      flowEnabled: true,
      reducedMotion: false,
      receivingTargets: [],
      inferredAscentAllowed: true,
      guidedAxisX: axX,
      guidedAxisZ: axZ,
    });
    motion = res.motion;
    flow = res.flow;
    for (const e of res.events) {
      if (e.type === "verbCommitted") {
        committed = true;
        committedVerb = e.verb;
      }
    }

    const e = worstEmbed(motion.pos, motion.capsuleHeight);
    if (e) {
      const duringAction = motion.action !== null;
      const ignored = duringAction && motion.action.ignore.has(e.id);
      if (!worst || e.depthM > worst.depthM) {
        worst = {
          depthM: e.depthM,
          id: e.id,
          y: +motion.pos.y.toFixed(2),
          x: +motion.pos.x.toFixed(2),
          z: +motion.pos.z.toFixed(2),
          duringAction,
          ignored,
          phase: motion.phase,
        };
      }
    }

    // Reached the authored top?
    if (
      motion.grounded &&
      Math.abs(motion.pos.y - to.pos[1]) < 0.4 &&
      Math.hypot(motion.pos.x - to.pos[0], motion.pos.z - to.pos[2]) < 1.2
    ) {
      reachedTop = true;
      break;
    }
  }

  results.push({
    id: link.id,
    line: link.line,
    kind: link.kind,
    verb: link.verb,
    from: link.from,
    to: link.to,
    ignore: link.ignore ?? [],
    committed,
    committedVerb,
    reachedTop,
    worst,
  });
}

// Sort by worst penetration depth, deepest first.
results.sort((a, b) => (b.worst?.depthM ?? 0) - (a.worst?.depthM ?? 0));

let phasing = 0;
console.log(`authored transitions replayed: ${results.length}\n`);
console.log("worst true capsule penetration during each authored transition:");
for (const r of results) {
  const w = r.worst;
  const flag = w && w.depthM > 0.05 ? " <== PHASES" : "";
  if (w && w.depthM > 0.05) phasing += 1;
  console.log(
    `  ${r.id.padEnd(34)} ${r.line.padEnd(6)} ${(r.kind).padEnd(6)} ` +
      `${r.committed ? `commit:${r.committedVerb}`.padEnd(18) : "NOT COMMITTED".padEnd(18)} ` +
      (w
        ? `worst ${w.depthM.toFixed(3)}m in ${w.id}${w.ignored ? "(IGNORED)" : ""} @y=${w.y} ${w.duringAction ? "authored" : w.phase}`
        : "clean") +
      flag,
  );
}
console.log(
  `\n${phasing} of ${results.length} authored transitions drive the capsule >5cm into a solid.`,
);
