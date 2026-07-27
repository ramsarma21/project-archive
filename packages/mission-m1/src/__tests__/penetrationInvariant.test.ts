// The non-penetration invariant, gated over long seeded sessions of the REAL
// compiled M1 world driven through the production flow controller.
//
// This is the permanent regression gate for the "glitch through objects" class:
// a body must never END a fixed tick standing inside a solid collider or with a
// deck plane through its torso, at any speed, through any verb. The fuzzer walks
// thousands of seeded ticks from many start points across the whole level —
// sprinting into geometry, jumping, dashing, crouching — and asserts the shared
// `motionPenetration` predicate stays clean for every GROUNDED tick.
//
// The authored sub-body slivers in front of the GAOL and SUGAR_HOUSE (the
// Shambles carts and the alley crates) USED to be an explicit allow-list here,
// because they were gaps narrower than the 0.70m capsule a body could be pushed
// into. Those props are now set flush to the wall behind them (geometry.ts), so
// there is no gap to push into and the allow-list is gone: EVERY grounded solid
// embed is now a fault. The flush geometry and the swept airborne deck-edge guard
// are both regressed directly below.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CAPSULE_RADIUS,
  STAND_HEIGHT,
  RUN_SPEED,
  WALK_SPEED,
  GRAVITY,
  createGroundedState,
  createFlowState,
  stepFlow,
  motionPenetration,
  positionClear,
  supportBelow,
  deckThroughBody,
  FIELD_DT,
} from "@pa/engine-world";
import { compileLevel } from "../compile.js";
import { M1_EFFIGY_RUN } from "../level/index.js";

const { world } = compileLevel(M1_EFFIGY_RUN);
const B = world.bounds;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return ((z ^ (z >>> 15)) >>> 0) / 4294967296;
  };
}

interface Violation {
  seed: number;
  tick: number;
  verb: string;
  ids: string[];
  pos: { x: number; y: number; z: number };
}

// Deck strips of the yard-stage ramp are overlapping thin stair treads: a body
// standing on one tread necessarily has the next tread's plane beside its chest,
// which reads as a deck cut although the tread is a solid stair the body is ON,
// not a roof/canopy edge it is passing through. This is a pre-existing modelling
// artifact of representing a staircase as overlapping decks and is not a
// player-visible clip; the deck-edge guard (which targets canopies and roofs)
// deliberately does not touch it. It is excluded from the deck-graze gate below.
const RAMP_DECK = /^YARD_STAGE_RAMP__S\d+$/;

function fuzzSession(seed: number, ticks: number, out: Violation[], deckOut: Violation[]): void {
  const rand = rng(seed);
  let start: { x: number; y: number; z: number } | null = null;
  for (let tries = 0; tries < 40 && !start; tries++) {
    const x = B.minX + rand() * (B.maxX - B.minX);
    const z = B.minZ + rand() * (B.maxZ - B.minZ);
    for (const probeY of [0.05, 1.0, 1.9, 3.2, 6, 9]) {
      const sup = supportBelow(world, x, z, probeY + 0.05, 0.1);
      if (sup) {
        const pos = { x, y: sup.y, z };
        if (
          positionClear(world, pos, CAPSULE_RADIUS, STAND_HEIGHT) &&
          motionPenetration(world, createGroundedState(pos, 0)).deckId === null
        ) {
          start = pos;
          break;
        }
      }
    }
  }
  if (!start) return;

  let motion = createGroundedState(start, rand() * Math.PI * 2);
  let flow = createFlowState();
  let dir = rand() * Math.PI * 2;
  let sprint = true;
  let crouch = false;

  for (let tick = 0; tick < ticks; tick++) {
    if (tick % Math.floor(4 + rand() * 20) === 0) {
      dir = rand() * Math.PI * 2;
      sprint = rand() < 0.7;
      crouch = rand() < 0.15;
    }
    const speed = crouch ? WALK_SPEED : RUN_SPEED;
    const res = stepFlow(world, motion, flow, {
      dt: FIELD_DT,
      targetVelX: Math.sin(dir) * speed,
      targetVelZ: Math.cos(dir) * speed,
      sprintHeld: sprint,
      crouchHeld: crouch,
      jumpBuffered: rand() < 0.06,
      dashBuffered: rand() < 0.04,
      flowEnabled: true,
      reducedMotion: false,
      receivingTargets: [],
    });
    motion = res.motion;
    flow = res.flow;
    if (motion.pos.y < -20) return; // fell into the void

    // The gated invariant: a GROUNDED body must never end a tick embedded in a
    // SOLID collider. No allow-list — the authored slivers are closed.
    if (motion.grounded) {
      const { embeds } = motionPenetration(world, motion);
      if (embeds.length > 0) {
        out.push({
          seed,
          tick,
          verb: motion.action ? motion.action.kind : motion.phase,
          ids: embeds.map((e) => `${e.id}:${e.depthM.toFixed(2)}m`),
          pos: {
            x: +motion.pos.x.toFixed(2),
            y: +motion.pos.y.toFixed(2),
            z: +motion.pos.z.toFixed(2),
          },
        });
      }
    }

    // The airborne one-way deck-edge graze gate: an airborne torso must never end
    // a tick cut by a canopy/roof/pentice/plank deck it CANNOT land on (its peak
    // foot cannot reach the plane). A leap ONTO a higher ledge legitimately clips
    // the edge on the way up — its feet will clear the plane — and is not a fault.
    if (!motion.grounded) {
      const deck = deckThroughBody(
        world,
        motion.pos.x,
        motion.pos.z,
        motion.pos.y,
        motion.capsuleHeight,
      );
      if (deck && !RAMP_DECK.test(deck.id)) {
        const ignore = motion.action?.ignore;
        if (!ignore?.has(deck.id)) {
          const peakFoot =
            motion.pos.y +
            (motion.vel.y > 0 ? (motion.vel.y * motion.vel.y) / (2 * GRAVITY) : 0);
          if (peakFoot < deck.y - 0.01) {
            deckOut.push({
              seed,
              tick,
              verb: motion.action ? motion.action.kind : motion.phase,
              ids: [deck.id],
              pos: {
                x: +motion.pos.x.toFixed(2),
                y: +motion.pos.y.toFixed(2),
                z: +motion.pos.z.toFixed(2),
              },
            });
          }
        }
      }
    }
  }
}

test("no grounded tick ends inside a solid collider, anywhere, with no allow-list", () => {
  const violations: Violation[] = [];
  const deckGrazes: Violation[] = [];
  // 500 sessions x 500 ticks ~= a quarter-million grounded checks over the whole
  // level, from many start points, sprinting/jumping/dashing/crouching into
  // geometry. Cheap (pure arithmetic) and deterministic, so it is a real gate.
  for (let seed = 1; seed <= 500; seed++) fuzzSession(seed, 500, violations, deckGrazes);
  assert.equal(
    violations.length,
    0,
    `grounded solid-collider non-penetration violated ${violations.length} time(s); first few:\n` +
      violations
        .slice(0, 8)
        .map((v) => `  seed ${v.seed} tick ${v.tick} ${v.verb} @${JSON.stringify(v.pos)} in ${v.ids.join(",")}`)
        .join("\n"),
  );
});

test("no airborne tick grazes a canopy/roof deck edge it cannot land on", () => {
  const violations: Violation[] = [];
  const deckGrazes: Violation[] = [];
  for (let seed = 1; seed <= 500; seed++) fuzzSession(seed, 500, violations, deckGrazes);
  assert.equal(
    deckGrazes.length,
    0,
    `airborne one-way deck-edge graze on a non-ramp deck ${deckGrazes.length} time(s); first few:\n` +
      deckGrazes
        .slice(0, 8)
        .map((v) => `  seed ${v.seed} tick ${v.tick} ${v.verb} @${JSON.stringify(v.pos)} in ${v.ids.join(",")}`)
        .join("\n"),
  );
});

test("a controlled fall into the cart/wall corner lands on the cart, never inside it", () => {
  // CART_3 (topY 0.95) is now flush to the SUGAR_HOUSE south wall. A capsule
  // coming straight down at its back corner must come to rest ON the cart top,
  // never grounded inside it or the wall.
  let motion = createGroundedState({ x: 37.65, y: 6, z: -2.85 }, 0);
  let flow = createFlowState();
  for (let tick = 0; tick < 240; tick++) {
    const res = stepFlow(world, motion, flow, {
      dt: FIELD_DT,
      targetVelX: 0,
      targetVelZ: 0,
      sprintHeld: false,
      crouchHeld: false,
      jumpBuffered: false,
      flowEnabled: true,
      reducedMotion: false,
      receivingTargets: [],
    });
    motion = res.motion;
    flow = res.flow;
  }
  assert.equal(motion.grounded, true, "the body should have come to rest");
  const { embeds, deckId } = motionPenetration(world, motion);
  assert.ok(
    embeds.length === 0 && deckId === null,
    `body rested embedded in ${embeds.map((e) => e.id).join(",")}${deckId ? ` / deck ${deckId}` : ""} at y=${motion.pos.y.toFixed(2)}`,
  );
  assert.ok(
    motion.pos.y > 0.5,
    `body should rest on the cart top (~0.95m), not on the ground in the corner (y=${motion.pos.y.toFixed(2)})`,
  );
});

test("every corrected prop is flush to the GAOL/SUGAR_HOUSE wall behind it — no sub-capsule gap", () => {
  const byId = new Map(world.blockers.map((b) => [b.id, b]));
  const gaol = byId.get("GAOL")!;
  const sugar = byId.get("SUGAR_HOUSE")!;
  // [prop, wall face it backs onto, axis] — the gap between the two must be <= 0.
  const seams: Array<[string, number, "eastToWallW" | "northToWallS"]> = [
    ["ALLEY_CRATES", gaol.minX, "eastToWallW"], // east face -> GAOL west wall (x=17)
    ["ALLEY_OVERSHOOT_CRATES", gaol.minX, "eastToWallW"],
    ["CART_0", gaol.maxZ, "northToWallS"], // north face -> GAOL south wall (z=-3.2)
    ["CART_1", gaol.maxZ, "northToWallS"],
    ["CART_3", sugar.maxZ, "northToWallS"], // north face -> SUGAR_HOUSE south wall
    ["SHAMBLES_CRATES_B", sugar.maxZ, "northToWallS"],
  ];
  for (const [id, wallFace, axis] of seams) {
    const p = byId.get(id)!;
    const gap =
      axis === "eastToWallW" ? wallFace - p.maxX : p.minZ - wallFace;
    assert.ok(
      gap <= 1e-6,
      `${id} leaves a ${gap.toFixed(3)}m gap to its wall — a sub-capsule sliver a body would clip`,
    );
  }
});

test("sprinting into each corrected seam neither embeds nor wedges", () => {
  // For each seam, start a grounded body a stride in front of the wall the prop
  // now backs onto and sprint straight into it. The body must stop cleanly
  // (embed-free) and must actually travel — a wedge would leave it pinned in
  // place, which is the failure mode the sliver produced before the fix.
  const probes: Array<{ name: string; start: { x: number; y: number; z: number }; dir: { x: number; z: number } }> = [
    // Alley crates now fill wall-to-wall; sprint north into them from the alley.
    { name: "ALLEY", start: { x: 15.0, y: 0, z: -3.6 }, dir: { x: 0, z: -1 } },
    // Shambles lane: sprint north into CART_0 / CART_1 (now flush to the gaol).
    { name: "CART_0", start: { x: 20.8, y: 0, z: -0.6 }, dir: { x: 0, z: -1 } },
    // East of PASSAGE_HOIST (the duck beam, x 24.4-26.9), which a standing body
    // must crouch under and which is not what this seam probe is about.
    { name: "CART_1", start: { x: 27.4, y: 0, z: -0.6 }, dir: { x: 0, z: -1 } },
    // Sugar house frontage: sprint north into CART_3 / SHAMBLES_CRATES_B.
    { name: "CART_3", start: { x: 37.6, y: 0, z: -0.6 }, dir: { x: 0, z: -1 } },
    { name: "CRATES_B", start: { x: 39.2, y: 0, z: -0.6 }, dir: { x: 0, z: -1 } },
  ];
  for (const probe of probes) {
    let motion = createGroundedState(probe.start, Math.atan2(probe.dir.x, probe.dir.z));
    let flow = createFlowState();
    let moved = 0;
    for (let tick = 0; tick < 150; tick++) {
      const before = { x: motion.pos.x, z: motion.pos.z };
      const res = stepFlow(world, motion, flow, {
        dt: FIELD_DT,
        targetVelX: probe.dir.x * RUN_SPEED,
        targetVelZ: probe.dir.z * RUN_SPEED,
        sprintHeld: true,
        crouchHeld: false,
        jumpBuffered: false,
        dashBuffered: false,
        flowEnabled: true,
        reducedMotion: false,
        receivingTargets: [],
      });
      motion = res.motion;
      flow = res.flow;
      moved += Math.hypot(motion.pos.x - before.x, motion.pos.z - before.z);
      if (motion.grounded) {
        const { embeds } = motionPenetration(world, motion);
        assert.equal(
          embeds.length,
          0,
          `${probe.name}: body embedded in ${embeds.map((e) => e.id).join(",")} at tick ${tick}`,
        );
      }
    }
    assert.ok(moved > 0.5, `${probe.name}: body appears wedged (moved only ${moved.toFixed(2)}m)`);
  }
});
