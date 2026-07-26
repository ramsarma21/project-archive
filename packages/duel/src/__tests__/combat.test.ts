import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildArena,
  CHEST_COVER_HEIGHT,
  LOW_COVER_HEIGHT,
  openArena,
  type CoverSpec,
} from "../arena.js";
import {
  assistedAim,
  createCombatState,
  intent,
  IDLE_INTENT,
  loadMagazine,
  playerParams,
  solveInterceptDirection,
  stepCombat,
  type CombatIntent,
  type CombatParams,
  type CombatState,
} from "../combat.js";
import {
  DASH_DURATION_MS,
  DASH_SPEED_SCALE,
  FIELD_TICK_HZ,
  RUN_SPEED,
  WALK_SPEED,
  type CollisionWorld,
} from "../engine.js";
import type { DuelEvent } from "../events.js";
import type { BySide } from "../sides.js";
import {
  BULLETS_FOR_CORRECT,
  BULLET_SPEED_MPS,
  ENGAGEMENT_TICKS,
  HEADSHOT_IS_A_DISTINCT_OUTCOME,
  MAX_SPENDABLE_SHOTS_PER_ROUND,
  PLAYER_AIM_ASSIST,
  PLAYER_MAX_HEALTH,
  PLAYER_SHOT_DAMAGE,
} from "../tuning.js";

/** Hits needed to empty a full bar. Derived, so health can move without edits. */
const HITS_TO_KILL = Math.ceil(PLAYER_MAX_HEALTH / PLAYER_SHOT_DAMAGE);

const SEPARATION = 10;

function fixture(cover: readonly CoverSpec[] = [], ammoA = 3, ammoB = 0) {
  const arena =
    cover.length > 0
      ? buildArena({ arenaId: "TEST", halfExtentX: 14, halfExtentZ: 14, cover })
      : openArena();
  const params: CombatParams = { A: playerParams(), B: playerParams() };
  let state = createCombatState(params, {
    A: { pos: { x: 0, y: 0, z: -SEPARATION / 2 }, yaw: 0 },
    B: { pos: { x: 0, y: 0, z: SEPARATION / 2 }, yaw: Math.PI },
  });
  state = loadMagazine(state, "A", ammoA);
  state = loadMagazine(state, "B", ammoB);
  return { world: arena.world, params, state };
}

function run(
  world: CollisionWorld,
  start: CombatState,
  params: CombatParams,
  ticks: number,
  intentsFor: (tick: number, state: CombatState) => BySide<CombatIntent>,
): { state: CombatState; events: DuelEvent[] } {
  let state = start;
  const events: DuelEvent[] = [];
  for (let index = 0; index < ticks; index++) {
    const stepped = stepCombat(world, state, intentsFor(state.tick + 1, state), params, 1);
    state = stepped.state;
    events.push(...stepped.events);
  }
  return { state, events };
}

const AIM_AT_B = { aimX: 0, aimZ: 1 } as const;
const fireOnFirstTick = (tick: number): BySide<CombatIntent> => ({
  A: tick === 1 ? intent({ fire: true, ...AIM_AT_B }) : IDLE_INTENT,
  B: IDLE_INTENT,
});

test("a ball has travel time: the shot does not resolve on the tick it is fired", () => {
  const { world, state, params } = fixture();
  const { events } = run(world, state, params, 60, fireOnFirstTick);
  const fired = events.find((event) => event.type === "SHOT_FIRED");
  const hit = events.find((event) => event.type === "HIT_LANDED");
  assert.ok(fired && fired.type === "SHOT_FIRED");
  assert.ok(hit && hit.type === "HIT_LANDED");
  assert.equal(fired.tick, 1);

  // ~9.2m of effective flight at 22 m/s is ~25 ticks. Anything under ~15 would
  // mean the projectile is teleporting and dodging would be decorative.
  const expected = Math.round((SEPARATION / BULLET_SPEED_MPS) * FIELD_TICK_HZ);
  assert.ok(hit.tick > 15, `hit at tick ${hit.tick} is too fast to dodge`);
  assert.ok(
    Math.abs(hit.tick - expected) <= 5,
    `hit at tick ${hit.tick}, expected about ${expected}`,
  );
});

test("a hit costs health and ammo, and neither is ever created", () => {
  const { world, state, params } = fixture();
  const { state: after, events } = run(world, state, params, 60, fireOnFirstTick);
  assert.equal(after.fighters.A.ammo, 2, "one ball spent");
  assert.equal(after.fighters.B.health, PLAYER_MAX_HEALTH - PLAYER_SHOT_DAMAGE);
  assert.equal(after.fighters.A.hitsLanded, 1);
  assert.equal(after.fighters.B.hitsTaken, 1);
  assert.equal(events.filter((event) => event.type === "HIT_LANDED").length, 1);
});

test("firing is refused without ammo, and the rate of fire is enforced", () => {
  const empty = fixture([], 0);
  const dry = run(empty.world, empty.state, empty.params, 10, () => ({
    A: intent({ fire: true, ...AIM_AT_B }),
    B: IDLE_INTENT,
  }));
  assert.equal(dry.events.filter((event) => event.type === "SHOT_FIRED").length, 0);

  const loaded = fixture([], 3);
  const spray = run(loaded.world, loaded.state, loaded.params, 10, () => ({
    A: intent({ fire: true, ...AIM_AT_B }),
    B: IDLE_INTENT,
  }));
  assert.equal(
    spray.events.filter((event) => event.type === "SHOT_FIRED").length,
    1,
    "held fire cannot beat the fire interval",
  );
});

test("chest-high cover absorbs an aimed shot; the ball never reaches the body", () => {
  const { world, state, params } = fixture([
    { id: "COVER.WALL", x: 0, z: 0, halfX: 2, halfZ: 0.4, topY: CHEST_COVER_HEIGHT },
  ]);
  const { state: after, events } = run(world, state, params, 60, fireOnFirstTick);
  const absorbed = events.find((event) => event.type === "SHOT_ABSORBED_BY_COVER");
  assert.ok(absorbed && absorbed.type === "SHOT_ABSORBED_BY_COVER");
  assert.equal(absorbed.coverId, "COVER.WALL");
  assert.equal(events.some((event) => event.type === "HIT_LANDED"), false);
  assert.equal(after.fighters.B.health, PLAYER_MAX_HEALTH);
});

test("low cover does not protect a standing fighter", () => {
  const { world, state, params } = fixture([
    { id: "COVER.CRATE", x: 0, z: 0, halfX: 2, halfZ: 0.4, topY: LOW_COVER_HEIGHT },
  ]);
  const { events } = run(world, state, params, 60, fireOnFirstTick);
  assert.equal(events.some((event) => event.type === "HIT_LANDED"), true);
});

test("dropping into a crouch ducks a shot that was aimed at a standing chest", () => {
  const { world, state, params } = fixture();
  const { state: after, events } = run(world, state, params, 60, (tick) => ({
    A: tick === 1 ? intent({ fire: true, ...AIM_AT_B }) : IDLE_INTENT,
    // B crouches immediately after the shot leaves the muzzle.
    B: tick >= 2 ? intent({ crouch: true }) : IDLE_INTENT,
  }));
  assert.equal(after.fighters.B.motion.phase, "CROUCH");
  assert.equal(
    events.some((event) => event.type === "HIT_LANDED"),
    false,
    "an aimed ball passes over a fighter who drops",
  );
  assert.equal(after.fighters.B.health, PLAYER_MAX_HEALTH);
});

test("a dodge across the ball's path evades it positionally", () => {
  // The stronger of the two evasions, and the one the round is built on: the body
  // is simply not there any more. No immunity is involved, so nothing is "eaten" —
  // the ball flies past and expires.
  const { world, state, params } = fixture();
  const { state: after, events } = run(world, state, params, 90, (tick) => ({
    A: tick === 1 ? intent({ fire: true, ...AIM_AT_B }) : IDLE_INTENT,
    B: tick === 20 ? intent({ dodge: true, moveX: 1, moveZ: 0 }) : IDLE_INTENT,
  }));
  assert.equal(events.some((event) => event.type === "HIT_LANDED"), false);
  assert.equal(after.fighters.B.health, PLAYER_MAX_HEALTH);
  assert.ok(
    Math.abs(after.fighters.B.motion.pos.x) > 1.5,
    "the burst carried the body clear of the line",
  );
});

test("dodge i-frames eat a ball the body cannot get out of the way of", () => {
  // Dodging along the ball's axis rather than across it keeps the body in the line,
  // so this isolates the immunity window: the ball connects and is refused.
  const { world, state, params } = fixture();
  const { state: after, events } = run(world, state, params, 60, (tick) => ({
    A: tick === 1 ? intent({ fire: true, ...AIM_AT_B }) : IDLE_INTENT,
    B: tick === 22 ? intent({ dodge: true, moveX: 0, moveZ: -1 }) : IDLE_INTENT,
  }));
  const evaded = events.find((event) => event.type === "SHOT_EVADED");
  assert.ok(evaded && evaded.type === "SHOT_EVADED", "the ball reached the body");
  assert.equal(evaded.by, "DODGE_IFRAME");
  assert.equal(after.fighters.B.health, PLAYER_MAX_HEALTH);
  assert.equal(after.fighters.B.hitsTaken, 0);
});

test("a dodge is the engine's burst, not a duel-local motion", () => {
  const { world, state, params } = fixture();
  const { state: after } = run(world, state, params, 4, (tick) => ({
    A: tick === 1 ? intent({ dodge: true, moveX: 1, moveZ: 0 }) : IDLE_INTENT,
    B: IDLE_INTENT,
  }));
  const motion = after.fighters.A.motion;
  assert.equal(motion.phase, "DASH", "the shared phase, entered through beginDash");
  assert.ok(motion.dash, "and the engine's window, not a local one");
  assert.equal(motion.dash?.speed, RUN_SPEED * DASH_SPEED_SCALE);
  assert.equal(motion.dash?.durationMs, DASH_DURATION_MS);
});

test("an airborne dodge is refused by the engine, and costs no cooldown", () => {
  // The duel does not restate when a burst is legal; canDash owns that. If the
  // refusal were not observed here, a jumping player would burn the dodge for free.
  const { world, state, params } = fixture();
  const { state: after, events } = run(world, state, params, 12, (tick) => ({
    A: intent({ jump: tick === 1, dodge: tick >= 4, moveX: 1, moveZ: 0 }),
    B: IDLE_INTENT,
  }));
  assert.equal(events.some((event) => event.type === "DODGE_STARTED"), false);
  assert.equal(after.fighters.A.motion.phase !== "DASH", true);
  assert.equal(after.fighters.A.dodge.readyAtTick, 0, "no cooldown was spent");
});

test("a dodge displaces further than a sprint over the same window", () => {
  const { world, state, params } = fixture();
  const sprint = run(world, state, params, 20, () => ({
    A: intent({ moveX: 1, moveZ: 0, sprint: true }),
    B: IDLE_INTENT,
  }));
  const dodge = run(world, state, params, 20, (tick) => ({
    A: intent({ moveX: 1, moveZ: 0, dodge: tick === 1 }),
    B: IDLE_INTENT,
  }));
  assert.ok(
    dodge.state.fighters.A.motion.pos.x > sprint.state.fighters.A.motion.pos.x,
    "the burst must actually burst",
  );
});

test("movement is engine-world's: a fighter cannot walk through cover", () => {
  const { world, state, params } = fixture([
    { id: "COVER.WALL", x: 0, z: -2, halfX: 6, halfZ: 0.4, topY: 3 },
  ]);
  const walked = run(world, state, params, 120, () => ({
    A: intent({ moveX: 0, moveZ: 1, sprint: true }),
    B: IDLE_INTENT,
  }));
  assert.ok(
    walked.state.fighters.A.motion.pos.z < -2,
    "the shared sweep stops the body at the wall",
  );
});

test("a full bar takes exactly its hits to empty, and the knockout fires once", () => {
  const { world, state, params } = fixture([], HITS_TO_KILL);
  const { state: after, events } = run(world, state, params, 2000, () => ({
    A: intent({ fire: true, ...AIM_AT_B }),
    B: IDLE_INTENT,
  }));
  assert.equal(after.fighters.B.health, 0);
  assert.equal(events.filter((event) => event.type === "KNOCKOUT").length, 1);
  const knockout = events.find((event) => event.type === "KNOCKOUT");
  assert.ok(knockout && knockout.type === "KNOCKOUT" && knockout.downed === "B");
});

test("a downed fighter stops moving, stops shooting and stops being hit", () => {
  const { world, state, params } = fixture([], HITS_TO_KILL + 1, 3);
  const downing = run(world, state, params, 2000, () => ({
    A: intent({ fire: true, ...AIM_AT_B }),
    B: IDLE_INTENT,
  }));
  assert.equal(downing.state.fighters.B.health, 0);
  assert.equal(downing.state.fighters.B.hitsTaken, HITS_TO_KILL);

  const corpse = downing.state.fighters.B;
  const after = run(world, downing.state, params, 120, () => ({
    A: intent({ fire: true, ...AIM_AT_B }),
    B: intent({ moveX: 1, moveZ: 1, sprint: true, fire: true, aimX: 0, aimZ: -1 }),
  }));
  assert.deepEqual(
    after.state.fighters.B.motion.pos,
    corpse.motion.pos,
    "a downed fighter does not move",
  );
  assert.equal(after.state.fighters.B.shotsFired, corpse.shotsFired, "and does not shoot");
  assert.equal(
    after.state.fighters.B.hitsTaken,
    HITS_TO_KILL,
    "and takes no further hits",
  );
  assert.equal(
    after.events.filter((event) => event.type === "KNOCKOUT").length,
    0,
    "the knockout is announced once, not every tick",
  );
});

test("A ROUND CAN ACTUALLY DISCHARGE A CORRECT ANSWER'S MAGAZINE", () => {
  // Measured against the machine, not derived, because the derivation is what
  // would be wrong. If this number drops below BULLETS_FOR_CORRECT the surplus
  // expires unfired every round, 14 and 7 become the same round, and the link
  // between knowing history and winning fights is gone with no test to say so.
  const { world, state, params } = fixture([], 999);
  const { events } = run(world, state, params, ENGAGEMENT_TICKS, () => ({
    // Aimed away, so nobody dies and the window runs its full length.
    A: intent({ fire: true, aimX: 1, aimZ: 0 }),
    B: IDLE_INTENT,
  }));
  const fired = events.filter((event) => event.type === "SHOT_FIRED").length;
  assert.equal(
    fired,
    MAX_SPENDABLE_SHOTS_PER_ROUND,
    "the machine and the arithmetic must agree about the reload",
  );
  assert.ok(
    fired >= BULLETS_FOR_CORRECT,
    `a round fires ${fired} balls but a correct answer grants ${BULLETS_FOR_CORRECT}`,
  );
});

test("A HIT IS A HIT ANYWHERE ON THE BODY — there is no headshot", () => {
  // The decision is recorded in tuning.ts; this is the pin. The player never
  // chooses the height a ball arrives at, so a bonus for hitting high would be a
  // lottery, and a damage multiplier keyed on stance would put variance into the
  // one number the whole exchange model is computed from.
  assert.equal(HEADSHOT_IS_A_DISTINCT_OUTCOME, false);

  // A ball aimed at a standing chest and a ball aimed at a crouched one arrive at
  // very different fractions of the body. Both cost exactly the same.
  const damages: number[] = [];
  for (const crouched of [false, true]) {
    const { world, state, params } = fixture();
    const { events } = run(world, state, params, 120, (tick) => ({
      // Let the stance settle first, so the shot is aimed at the live body.
      A: tick === 30 ? intent({ fire: true, ...AIM_AT_B }) : IDLE_INTENT,
      B: crouched ? intent({ crouch: true }) : IDLE_INTENT,
    }));
    const hit = events.find((event) => event.type === "HIT_LANDED");
    assert.ok(hit && hit.type === "HIT_LANDED", `no hit against a ${crouched ? "crouched" : "standing"} body`);
    damages.push(hit.damage);
  }
  assert.equal(damages[0], damages[1], "stance must not change what a hit costs");
  assert.equal(damages[0], PLAYER_SHOT_DAMAGE);
});

test("THE AIM MODEL: the assist pays the hardware tax and not the skill", () => {
  // The whole design in one test, and the reason a full snap inside a bounded cone
  // is forgiving without being an auto-aim.
  const { state } = fixture();
  const shooter = state.fighters.A;
  const moving = (speed: number) => ({
    ...state.fighters.B,
    motion: { ...state.fighters.B.motion, vel: { x: speed, y: 0, z: 0 } },
  });
  const solutionFor = (target: typeof state.fighters.B) => {
    const solved = solveInterceptDirection(
      shooter.motion.pos,
      target.motion.pos,
      { x: target.motion.vel.x, z: target.motion.vel.z },
    );
    assert.ok(solved, "the target is catchable");
    return solved;
  };
  const same = (a: { x: number; z: number }, b: { x: number; z: number }) =>
    Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.z - b.z) < 1e-9;

  // A WALKING target: pointing straight at the body is inside the cone, so the
  // assist finishes the lead. This is the trackpad case, and it is fully covered.
  const walker = moving(WALK_SPEED);
  assert.ok(
    same(assistedAim(shooter, walker, 0, 1, PLAYER_AIM_ASSIST, true), solutionFor(walker)),
    "a body shot at a walking target is corrected onto the solution",
  );

  // A SPRINTING target: the lead needed is larger than the cone, so pointing at the
  // body misses and the player has to understand lead. THIS IS THE CEILING. If this
  // assertion ever flips, the assist has become an auto-aim.
  const sprinter = moving(RUN_SPEED);
  assert.ok(
    same(assistedAim(shooter, sprinter, 0, 1, PLAYER_AIM_ASSIST, true), { x: 0, z: 1 }),
    "a body shot at a sprinting target is left exactly where the player put it",
  );

  // …but a player who has led MOST of the way against that same sprinter is
  // finished off. Skill gets you inside the cone; the cone forgives the last degree.
  const solution = solutionFor(sprinter);
  const nearly = 0.05;
  const rough = {
    x: solution.x * Math.cos(nearly) - solution.z * Math.sin(nearly),
    z: solution.x * Math.sin(nearly) + solution.z * Math.cos(nearly),
  };
  assert.ok(
    same(assistedAim(shooter, sprinter, rough.x, rough.z, PLAYER_AIM_ASSIST, true), solution),
    "a nearly-right lead is snapped onto the solution",
  );

  // Pointed at the far side of the yard: untouched, always.
  const wild = assistedAim(shooter, sprinter, -1, 0, PLAYER_AIM_ASSIST, true);
  assert.ok(same(wild, { x: -1, z: 0 }), "no correction outside the cone");

  // And a fighter with no assist profile — every boss — is never corrected.
  assert.deepEqual(assistedAim(shooter, sprinter, 0, 1, null, true), { x: 0, z: 1 });
});

test("the assist needs sight of the target, so it cannot aim through a wall", () => {
  const { state } = fixture();
  const blind = assistedAim(
    state.fighters.A,
    state.fighters.B,
    0.2,
    1,
    PLAYER_AIM_ASSIST,
    false,
  );
  const length = Math.hypot(0.2, 1);
  assert.ok(Math.abs(blind.x - 0.2 / length) < 1e-9);
});

test("a dodge with no direction held backsteps instead of doing nothing", () => {
  // Pressing dodge and getting silence is the worst answer to a button press, and
  // the one a panicking player provokes most often.
  const { world, state, params } = fixture();
  const { state: after, events } = run(world, state, params, 20, (tick) => ({
    A: tick === 1 ? intent({ dodge: true, ...AIM_AT_B }) : IDLE_INTENT,
    B: IDLE_INTENT,
  }));
  assert.ok(events.some((event) => event.type === "DODGE_STARTED"));
  assert.ok(
    after.fighters.A.motion.pos.z < -SEPARATION / 2 - 1,
    "the burst carried the body away from where it was aiming",
  );
});

test("a shot with no fresh aim vector uses the last one rather than vanishing", () => {
  const { world, state, params } = fixture();
  const aimed = run(world, state, params, 5, (tick) => ({
    A: tick === 1 ? intent({ ...AIM_AT_B }) : IDLE_INTENT,
    B: IDLE_INTENT,
  }));
  // IDLE_INTENT carries aimX/aimZ of zero. The shot must still leave.
  const { events } = run(world, aimed.state, params, 60, () => ({
    A: intent({ fire: true }),
    B: IDLE_INTENT,
  }));
  assert.ok(events.some((event) => event.type === "SHOT_FIRED"), "the press was honoured");
});

test("the same inputs produce byte-identical state", () => {
  const first = fixture([], 3);
  const second = fixture([], 3);
  const plan = (tick: number): BySide<CombatIntent> => ({
    A: intent({
      moveX: Math.sin(tick / 7),
      moveZ: Math.cos(tick / 11),
      fire: tick % 40 === 0,
      dodge: tick % 97 === 0,
      ...AIM_AT_B,
    }),
    B: intent({ moveX: Math.cos(tick / 5), moveZ: 0.2, crouch: tick % 120 > 90 }),
  });
  const a = run(first.world, first.state, first.params, 300, plan);
  const b = run(second.world, second.state, second.params, 300, plan);
  assert.deepEqual(a.state, b.state);
  assert.deepEqual(a.events, b.events);
});
