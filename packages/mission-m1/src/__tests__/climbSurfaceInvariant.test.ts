// THE SWEPT CLIMB-SURFACE INVARIANT.
//
// The non-penetration gate that already exists (`penetrationInvariant.test.ts`)
// asserts `motionPenetration`, which — until the split-authority fix — excluded
// `action.ignore` for the whole of an authored move. That exclusion is exactly
// what let a climb/vault drive the capsule a full radius INTO the surface it was
// climbing: the one collider that mattered was switched off for the check, at
// every substep and at both endpoints. An endpoint-only or ignore-scoped
// assertion is the gap that shipped the defect; this test is neither.
//
// It drives the REAL flow controller into every authored CLIMB / MANTLE / VAULT
// on the route and, on EVERY substep of the transition, measures the capsule
// against the FULL solid world with NO ignore set at all — the phasing a player
// actually sees. Before the fix (stepAuthored wrote the interpolated sample
// straight onto the body), 16 of these drove the capsule ~0.32-0.35m into the
// climbed mass. After it (the solver depenetrates the sample every substep, so
// climbing happens on the outside surface), none do.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CAPSULE_RADIUS,
  capsuleEmbeddedIn,
  createGroundedState,
  createFlowState,
  stepFlow,
  RUN_SPEED,
  FIELD_DT,
} from "@pa/engine-world";
import { compileLevel } from "../compile.js";
import { M1_EFFIGY_RUN } from "../level/index.js";

const level = M1_EFFIGY_RUN;
const { world } = compileLevel(level);
const nodeById = new Map(level.nodes.map((n) => [n.id, n]));

/** Authored transitions whose position is driven along an anchored path. */
const AUTHORED_TRANSITION = new Set(["CLIMB", "MANTLE", "VAULT"]);

// A grounded body resting against a wall leaves a sub-skin contact a hair over
// CONTACT_EPS; the defect this guards is a capsule a RADIUS inside a solid. 5cm
// is well clear of the former and an order of magnitude under the latter.
const PHASE_LIMIT_M = 0.05;

interface Phase {
  linkId: string;
  depthM: number;
  id: string;
  y: number;
}

function drive(linkId: string, fromId: string, toId: string): Phase | null {
  const from = nodeById.get(fromId);
  const to = nodeById.get(toId);
  if (!from || !to) return null;
  const dx = to.pos[0] - from.pos[0];
  const dz = to.pos[2] - from.pos[2];
  const planar = Math.hypot(dx, dz);
  const axX = planar > 1e-3 ? dx / planar : 1;
  const axZ = planar > 1e-3 ? dz / planar : 0;
  const back = planar > 1e-3 ? 0.8 : 0;
  let motion = createGroundedState(
    { x: from.pos[0] - axX * back, y: from.pos[1], z: from.pos[2] - axZ * back },
    Math.atan2(axX, axZ),
  );
  let flow = createFlowState();
  let worst: Phase | null = null;

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

    // Only while an authored transition is actually running: this test is about
    // the anchored-path mover, not grounded/ballistic motion (those have their
    // own gates). Measured with an EMPTY ignore — the climbed surface included.
    if (motion.action !== null) {
      const embeds = capsuleEmbeddedIn(
        world,
        motion.pos,
        CAPSULE_RADIUS,
        motion.capsuleHeight,
        new Set(),
      );
      for (const e of embeds) {
        if (e.depthM > (worst?.depthM ?? 0)) {
          worst = { linkId, depthM: e.depthM, id: e.id, y: +motion.pos.y.toFixed(2) };
        }
      }
    }

    if (
      motion.grounded &&
      Math.abs(motion.pos.y - to.pos[1]) < 0.4 &&
      Math.hypot(motion.pos.x - to.pos[0], motion.pos.z - to.pos[2]) < 1.2
    ) {
      break;
    }
  }
  return worst;
}

test("no authored climb/vault drives the capsule into the surface it is crossing", () => {
  const offenders: string[] = [];
  let replayed = 0;
  for (const link of level.links) {
    if (!AUTHORED_TRANSITION.has(link.kind)) continue;
    replayed += 1;
    const worst = drive(link.id, link.from, link.to);
    if (worst && worst.depthM > PHASE_LIMIT_M) {
      offenders.push(
        `${link.id} (${link.from}->${link.to}): capsule ${worst.depthM.toFixed(3)}m ` +
          `inside ${worst.id} at y=${worst.y}`,
      );
    }
  }
  assert.ok(replayed >= 20, `expected many authored transitions; found ${replayed}`);
  assert.deepEqual(
    offenders,
    [],
    `authored transitions that phase the capsule into the surface they cross:\n  ${offenders.join("\n  ")}`,
  );
});
