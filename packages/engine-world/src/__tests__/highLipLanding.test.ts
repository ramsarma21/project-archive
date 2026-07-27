// High-lip landing prediction regressions.
//
// The edge read answers one question: if the player keeps doing what they are
// doing, does the body walk off this lip into a killing fall? The honest answer
// is not a heuristic and not a range of guessed speeds — it is the ONE exact
// trajectory the production integrator produces from the body's current velocity,
// the raw target the player is holding, the acceleration blend, the coyote grace
// it has left, the fixed step, and the real swept collision and support. A walk
// that settles onto a near shelf, a run that clears the shelf onto the street
// beyond, a fast arc that just reaches a far roof across a gap a slower body drops
// into — each is predicted as itself, because the predictor IS the integrator.
//
// The brake's stability across the tick where it removes the very velocity it
// read is NOT the read's job: the flow controller persists the confirmed hazard,
// so a momentarily survivable read once braked does not erase it.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  platformFromRect,
  supportBelow,
  type CollisionWorld,
} from "../collision.js";
import {
  DASH_DURATION_MS,
  RUN_SPEED,
  WALK_SPEED,
  beginDash,
  createGroundedState,
  dashSpeed,
} from "../playerMotion.js";
import { FIELD_DT } from "../fieldSimulation.js";
import { createFlowState, stepFlow, type FlowInput } from "../parkour/flow.js";
import { probeAhead } from "../parkour/probe.js";
import { rankVerbs } from "../parkour/select.js";
import { PARKOUR_TUNING } from "../parkour/tuning.js";

const BOUNDS = { minX: -60, maxX: 60, minZ: -60, maxZ: 60 };

function world(platforms: CollisionWorld["platforms"]): CollisionWorld {
  return { blockers: [], platforms, bounds: BOUNDS };
}

function sprintCtx(overrides: Record<string, unknown> = {}) {
  return {
    grounded: true,
    sprintHeld: true,
    jumpBuffered: false,
    crouchHeld: false,
    chaining: false,
    receivingTargets: [],
    reducedMotion: false,
    pushing: true,
    ...overrides,
  } as const;
}

function probeNorth(w: CollisionWorld, z: number, speed: number) {
  return probeAhead(w, {
    pos: { x: 0, y: 8, z },
    velX: 0,
    velZ: speed,
    yaw: 0,
    intentX: 0,
    intentZ: speed,
  });
}

/**
 * Drive stepFlow north from (0, y, z), holding the parkour key. `dash` fires a
 * REAL dash press on the first tick — an actual burst through production flow,
 * not a target-speed proxy — so a dash regression exercises the same phase and
 * window the game does. Each leave-to-touch fall is measured on its own, so a
 * chain of survivable descents is never summed into a phantom fatal one.
 */
function driveNorth(
  w: CollisionWorld,
  start: { x: number; y: number; z: number },
  speed: number,
  ticks: number,
  opts: { dash?: boolean } = {},
) {
  let motion = createGroundedState(start, 0);
  let flow = createFlowState();
  let worstFall = 0;
  let leftFrom: number | null = null;
  for (let tick = 0; tick < ticks; tick++) {
    const input: FlowInput = {
      dt: FIELD_DT,
      targetVelX: 0,
      targetVelZ: speed,
      sprintHeld: true,
      crouchHeld: false,
      jumpBuffered: false,
      dashBuffered: opts.dash === true && tick === 0,
      flowEnabled: true,
      reducedMotion: false,
      receivingTargets: [],
    };
    const wasGrounded = motion.grounded;
    const wasY = motion.pos.y;
    const result = stepFlow(w, motion, flow, input);
    const touchedDown =
      (!wasGrounded && motion.grounded) ||
      result.events.some((ev) => ev.type === "landed" || ev.type === "verbCompleted");
    motion = result.motion;
    flow = result.flow;
    if (wasGrounded && !motion.grounded) leftFrom = wasY;
    if (touchedDown && leftFrom !== null) {
      worstFall = Math.max(worstFall, leftFrom - motion.pos.y);
      leftFrom = null;
    }
  }
  const support = supportBelow(w, motion.pos.x, motion.pos.z, motion.pos.y + 0.05, 0.05);
  return { motion, worstFall, endSurface: support?.id ?? null };
}

// ROOF at y=8 with a narrow shelf 2.4m below it, set out beyond the lip. A
// walking body drops onto the shelf; a sprint sails over it to the street 8m
// down, because it is barely falling by the time it passes the shelf's far edge.
function shelfWorld(): CollisionWorld {
  const roof = platformFromRect("ROOF", -3, 3, -6, 0, 8);
  const shelf = platformFromRect("SHELF", -3, 3, 1.6, 3.3, 5.6);
  return world([roof, shelf]);
}

// ROOF at y=8, a gap, then FAR at y=5 starting ~3m out. A 4.6 m/s run-off clears
// the gap and lands on FAR (a 3m drop, survivable); a walk falls short into the
// gap and hits the street. The faster body is the SAFER one here — the exact
// opposite of the shelf — which is why nothing but the one true trajectory can
// answer either.
function farWorld(): CollisionWorld {
  const roof = platformFromRect("ROOF", -3, 3, -6, 0, 8);
  const far = platformFromRect("FAR", -3, 3, 3.0, 12, 5);
  return world([roof, far]);
}

test("a sprint overshoots the near shelf onto a fatal fall, and is read fatal", () => {
  const w = shelfWorld();
  const probe = probeNorth(w, -1, RUN_SPEED);
  assert.ok(probe.edge, "there is a lip ahead");
  assert.ok(
    probe.edge!.dropM > PARKOUR_TUNING.rollMaxDropM,
    `sprint read ${probe.edge!.dropM.toFixed(2)}m; the honest fall past the shelf is ~8m`,
  );
  const ranked = rankVerbs(probe, sprintCtx(), PARKOUR_TUNING);
  assert.ok(ranked.includes("EDGE_BRAKE"), `ranked ${ranked.join(",")}`);
  assert.ok(!ranked.includes("RUN_OFF"), "a fatal fall must never rank as a run-off");
});

test("a walk settles onto the near shelf, and is read survivable", () => {
  const w = shelfWorld();
  const probe = probeNorth(w, -1, WALK_SPEED);
  assert.ok(probe.edge, "there is a lip ahead of the walker too");
  assert.ok(
    probe.edge!.dropM < PARKOUR_TUNING.rollMaxDropM,
    `a walk should settle onto the shelf, got ${probe.edge!.dropM.toFixed(2)}m`,
  );
});

test("exact 4.6 m/s lands on FAR across a 4m gap and is NOT braked", () => {
  // The regression the range read got wrong: a body genuinely committed to 4.6
  // clears the gap and lands on FAR, so it must be read survivable and run off,
  // not braked because some slower speed it is not travelling would have fallen
  // short.
  const w = farWorld();
  const probe = probeNorth(w, -1, RUN_SPEED);
  assert.ok(probe.edge, "there is a lip ahead");
  assert.ok(
    probe.edge!.dropM <= PARKOUR_TUNING.rollMaxDropM,
    `4.6 lands on FAR (~3m); read ${probe.edge!.dropM.toFixed(2)}m must be survivable`,
  );
  const ranked = rankVerbs(probe, sprintCtx(), PARKOUR_TUNING);
  assert.ok(
    !ranked.includes("EDGE_BRAKE"),
    `a survivable run-off must not brake: ranked ${ranked.join(",")}`,
  );

  // And driven for real, the body crosses the gap onto FAR — it is not braked
  // back on the roof — and takes no fall past the roll ceiling doing so. (It then
  // keeps running across FAR, so the test asserts it reached FAR and progressed,
  // not that it came to rest on it.)
  const run = driveNorth(w, { x: 0, y: 8, z: -3 }, RUN_SPEED, Math.round(2 / FIELD_DT));
  assert.ok(
    run.motion.pos.z > 3,
    `the body was braked on the roof (z=${run.motion.pos.z.toFixed(2)}) instead of reaching FAR`,
  );
  assert.ok(
    run.worstFall <= PARKOUR_TUNING.rollMaxDropM + 1e-6,
    `4.6 run fell ${run.worstFall.toFixed(2)}m reaching FAR`,
  );
});

test("the confirmed hazard holds: a body braked at a purely fatal lip does not creep off", () => {
  // Braking removes the very velocity the read was based on, and a naive re-derivation
  // from the stopped body could read a safe creep and unlatch. The hazard is recomputed
  // instead from a committed mover accelerating toward the lip, so a drop the geometry
  // really has stays fatal however slow the body is: a player sprinting into an 8m
  // roof lip for four seconds is held on the roof, never creeping over.
  //
  // (A slowed body IS released when the world actually offers a safe landing — a shelf
  // it can now step onto — which is a different, correct behaviour proved elsewhere;
  // this test isolates the anti-creep guarantee on a lip with nothing survivable below.)
  const w = world([platformFromRect("ROOF", -3, 3, -6, 0, 8)]);
  const held = driveNorth(w, { x: 0, y: 8, z: -3 }, RUN_SPEED, Math.round(4 / FIELD_DT));
  assert.ok(
    Math.abs(held.motion.pos.y - 8) < 0.1,
    `the body left the roof (y=${held.motion.pos.y.toFixed(2)}) instead of being held`,
  );
  assert.ok(
    held.worstFall <= PARKOUR_TUNING.rollMaxDropM + 1e-6,
    `held body fell ${held.worstFall.toFixed(2)}m`,
  );
});

// ROOF at y=8 over a WIDE shelf 2.4m below. A run lands squarely on the shelf; a
// real dash overshoots its far edge and comes down on the street 8m below. The
// shelf is wide enough that only the dash's extra reach clears it, so a read that
// used a generic target speed would call the dash safe.
function dashOvershootWorld(): CollisionWorld {
  const roof = platformFromRect("ROOF", -3, 3, -6, 0, 8);
  const shelf = platformFromRect("SHELF", -3, 3, 1.6, 4.5, 5.6);
  return world([roof, shelf]);
}

test("a real dash off a lip a run would clear safely is predicted fatal and braked", () => {
  const w = dashOvershootWorld();
  const at = { x: 0, y: 8, z: -1 };

  // A grounded RUN read lands on the wide shelf — survivable. This is the read a
  // generic target speed would trust.
  const runMotion = { ...createGroundedState(at, 0), vel: { x: 0, y: 0, z: RUN_SPEED } };
  const runProbe = probeAhead(w, {
    pos: at,
    velX: 0,
    velZ: RUN_SPEED,
    yaw: 0,
    intentX: 0,
    intentZ: RUN_SPEED,
    motion: runMotion,
  });
  assert.ok(
    runProbe.edge && runProbe.edge.dropM < PARKOUR_TUNING.rollMaxDropM,
    `a run should land on the shelf (~2.4m); got ${runProbe.edge?.dropM.toFixed(2)}`,
  );

  // The SAME spot with a REAL open dash: the production dash overshoots the shelf
  // to the street, and the predictor — deep-cloning and falling the live dash
  // state, not a rebuilt grounded body — reads that ~8m fall and brakes.
  const dashMotion = beginDash(
    createGroundedState(at, 0),
    0,
    1,
    dashSpeed(RUN_SPEED),
    DASH_DURATION_MS,
  );
  assert.equal(dashMotion.phase, "DASH", "the dash must actually open");
  const dashProbe = probeAhead(w, {
    pos: at,
    velX: dashMotion.vel.x,
    velZ: dashMotion.vel.z,
    yaw: 0,
    intentX: 0,
    intentZ: RUN_SPEED,
    motion: dashMotion,
  });
  assert.ok(
    dashProbe.edge && dashProbe.edge.dropM > PARKOUR_TUNING.rollMaxDropM,
    `the dash overshoots to a fatal fall; read ${dashProbe.edge?.dropM.toFixed(2)} must be fatal`,
  );
  assert.ok(
    rankVerbs(dashProbe, sprintCtx(), PARKOUR_TUNING).includes("EDGE_BRAKE"),
    "the dash read must rank the brake",
  );

  // And driven for real — an actual dash press through production flow — the body
  // does not fall past the roll ceiling: the brake catches the dash.
  const run = driveNorth(w, { x: 0, y: 8, z: -3 }, RUN_SPEED, Math.round(6 / FIELD_DT), {
    dash: true,
  });
  assert.ok(
    run.worstFall <= PARKOUR_TUNING.rollMaxDropM + 1e-6,
    `the real dash fell ${run.worstFall.toFixed(2)}m; the brake should have caught it`,
  );
});

test("a hazard whose geometry is replaced with a safe drop releases the brake promptly", () => {
  // The body sprints into a fatal lip and is held. Then the world changes so that
  // the SAME lip now leads to a survivable drop — a wide deck fills the gap
  // beneath it. The hazard carries identity and is recomputed against the current
  // world each tick, so it does not cling to a fatal reading the geometry no
  // longer supports: the brake releases at once and the body comes down onto the
  // new deck instead of standing frozen on the roof.
  const fatal: CollisionWorld = world([platformFromRect("ROOF", -3, 3, -6, 0, 8)]);
  const safe: CollisionWorld = world([
    platformFromRect("ROOF", -3, 3, -6, 0, 8),
    platformFromRect("CATCH", -3, 3, 0.3, 20, 5),
  ]);
  let motion = createGroundedState({ x: 0, y: 8, z: -2 }, 0);
  let flow = createFlowState();
  const input: FlowInput = {
    dt: FIELD_DT,
    targetVelX: 0,
    targetVelZ: RUN_SPEED,
    sprintHeld: true,
    crouchHeld: false,
    jumpBuffered: false,
    flowEnabled: true,
    reducedMotion: false,
    receivingTargets: [],
  };
  // Sprint into the fatal lip until the brake has confirmed and is holding.
  for (let tick = 0; tick < 90; tick++) {
    const r = stepFlow(fatal, motion, flow, input);
    motion = r.motion;
    flow = r.flow;
  }
  assert.ok(flow.brakeDirX !== null, "the body should be held by a confirmed hazard");
  assert.ok(Math.abs(motion.pos.y - 8) < 0.1, "held on the roof, not fallen");

  // Swap in the world where the drop is now survivable and keep driving. The
  // brake must let go quickly — well before the four seconds the old sticky
  // persistence would have clung for.
  let releasedTick: number | null = null;
  for (let tick = 0; tick < 90; tick++) {
    const r = stepFlow(safe, motion, flow, input);
    motion = r.motion;
    flow = r.flow;
    if (releasedTick === null && flow.brakeDirX === null) releasedTick = tick;
  }
  assert.ok(
    releasedTick !== null && releasedTick < 5,
    `brake released on tick ${releasedTick ?? "never"}; a recomputed hazard should let go at once`,
  );
  const support = supportBelow(safe, motion.pos.x, motion.pos.z, motion.pos.y + 0.05, 0.05);
  assert.equal(support?.id, "CATCH", `the body should come down onto CATCH, not stay frozen (on ${support?.id})`);
});

test("a stale hazard does not refuse a dash; a live one still does", () => {
  // A dash is opened before the verb ladder and consults the persisted hazard to
  // refuse "nothing to land on that way". If that hazard is revalidated only
  // AFTER the dash is processed, a hazard the world has since made safe would
  // wrongly eat a perfectly good dash on the tick it went stale. The hazard is
  // recomputed at the top of the tick, so a dash sees the CURRENT geometry.
  const fatal: CollisionWorld = world([platformFromRect("ROOF", -3, 3, -6, 0, 8)]);
  const safe: CollisionWorld = world([
    platformFromRect("ROOF", -3, 3, -6, 0, 8),
    platformFromRect("CATCH", -3, 3, 0.3, 20, 5),
  ]);
  const base: FlowInput = {
    dt: FIELD_DT,
    targetVelX: 0,
    targetVelZ: RUN_SPEED,
    sprintHeld: true,
    crouchHeld: false,
    jumpBuffered: false,
    dashBuffered: false,
    flowEnabled: true,
    reducedMotion: false,
    receivingTargets: [],
  };

  // Confirm and hold a fatal hazard by sprinting into the lip.
  function confirmHeld() {
    let motion = createGroundedState({ x: 0, y: 8, z: -2 }, 0);
    let flow = createFlowState();
    for (let tick = 0; tick < 90; tick++) {
      const r = stepFlow(fatal, motion, flow, base);
      motion = r.motion;
      flow = r.flow;
    }
    assert.ok(flow.brakeDirX !== null, "a hazard should be confirmed and holding");
    return { motion, flow };
  }

  // The world is swapped safe on the SAME tick the dash is pressed. The stale
  // hazard is released at the top of the tick, so the dash is NOT refused.
  {
    const { motion, flow } = confirmHeld();
    const r = stepFlow(safe, motion, flow, { ...base, dashBuffered: true });
    const refused = r.events.find(
      (e) => e.type === "dashRefused" && e.reason === "nothing to land on that way",
    );
    assert.equal(refused, undefined, "a stale hazard must not refuse the dash");
    assert.ok(
      r.events.some((e) => e.type === "dashStarted"),
      "the dash should open now the drop is safe",
    );
  }

  // Control: with the fatal geometry unchanged, the live hazard still refuses a
  // dash pointed over the lip.
  {
    const { motion, flow } = confirmHeld();
    const r = stepFlow(fatal, motion, flow, { ...base, dashBuffered: true });
    assert.ok(
      r.events.some(
        (e) => e.type === "dashRefused" && e.reason === "nothing to land on that way",
      ),
      "a live fatal hazard must still refuse a dash over the lip",
    );
    assert.ok(
      !r.events.some((e) => e.type === "dashStarted"),
      "no dash should open into a live fatal drop",
    );
  }
});

test("driven for real at sprint and with a real dash, the body does not fall past the roll ceiling", () => {
  for (const dash of [false, true]) {
    const run = driveNorth(shelfWorld(), { x: 0, y: 8, z: -3 }, RUN_SPEED, Math.round(6 / FIELD_DT), {
      dash,
    });
    assert.ok(
      run.worstFall <= PARKOUR_TUNING.rollMaxDropM + 1e-6,
      `${dash ? "dash" : "run"} fell ${run.worstFall.toFixed(2)}m; the brake should have held it`,
    );
  }
});
