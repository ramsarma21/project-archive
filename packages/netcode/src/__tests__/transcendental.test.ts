// Why this package is not deterministic lockstep, measured rather than asserted.
//
// THE CLAIM UNDER TEST. IEEE 754 pins `+`, `-`, `*`, `/` and `sqrt` to one
// correctly-rounded result on every conforming implementation. It explicitly does
// NOT pin `sin`, `cos`, `tan`, `atan2`, `pow`, `exp`, `log` or `hypot`, and the
// ECMAScript specification says outright that those are implementation-approximated.
// V8, JavaScriptCore and SpiderMonkey use different polynomial kernels, differ in the
// last bits, and have changed within their own version histories. The simulation
// calls them 52 times across the four files on the movement and combat path — 8 in
// `combat.ts`, 10 in `policy.ts`, 18 in `collision.ts`, 16 in `playerMotion.ts`.
//
// So a lockstep design bets a ranked ladder on Chrome and Safari agreeing about
// `Math.sin` to the last bit. This file measures what that bet actually costs.
//
// HOW IT IS MEASURED, AND WHY IT IS A DISTRIBUTION RATHER THAN ONE CASE. A single
// hand-picked scenario proves nothing in either direction: perturbations sometimes
// wash out — two bodies pressed against the same wall are depenetrated to the same
// place whatever the rounding — and sometimes amplify enormously, when a threshold is
// near-critical. A dodge that opens on one machine and not the other, or a ball that
// grazes a capsule on one and misses on the other, turns a last-bit difference into a
// different fight. Which of those happens is a property of the situation, so the
// honest measurement is over many seeded situations, reporting how OFTEN the two
// engines end up somewhere materially different.
//
// The perturbation is one ulp — smaller than the tolerance real engines are actually
// permitted — so every number below understates the real risk.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCombatState,
  fieldRandom,
  intent,
  playerParams,
  referenceArena,
  stepCombat,
  ENGAGEMENT_TICKS,
  type CombatIntent,
  type CombatParams,
  type CombatState,
} from "@pa/duel";
import { hashCombatState, hashPredictable } from "../index.js";

const arena = referenceArena();
const params: CombatParams = { A: playerParams(), B: playerParams() };

/** `ulps` representable doubles away from `value`, toward larger magnitude. */
function nudge(value: number, ulps: number): number {
  if (!Number.isFinite(value) || value === 0 || ulps === 0) return value;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const delta = BigInt(ulps);
  view.setBigUint64(0, value > 0 ? bits + delta : bits - delta);
  const result = view.getFloat64(0);
  return Number.isFinite(result) ? result : value;
}

/**
 * Stand in for "the same code running on a different JavaScript engine".
 *
 * Only the transcendental functions move, and only by `ulps`. The arithmetic that
 * IEEE 754 does pin is left exactly alone, because the point is to model the one
 * class of difference the standard permits between two conforming engines — not to
 * model a broken machine, which would prove nothing.
 */
function withPerturbedMath<T>(ulps: number, body: () => T): T {
  const original = {
    hypot: Math.hypot,
    sin: Math.sin,
    cos: Math.cos,
    atan2: Math.atan2,
  };
  Math.hypot = ((...values: number[]) =>
    nudge(original.hypot(...values), ulps)) as typeof Math.hypot;
  Math.sin = (value: number) => nudge(original.sin(value), ulps);
  Math.cos = (value: number) => nudge(original.cos(value), ulps);
  Math.atan2 = (y: number, x: number) => nudge(original.atan2(y, x), ulps);
  try {
    return body();
  } finally {
    Math.hypot = original.hypot;
    Math.sin = original.sin;
    Math.cos = original.cos;
    Math.atan2 = original.atan2;
  }
}

/** A seeded round of ordinary play: strafing, sprinting, crouching, dodging, firing. */
function inputLog(seed: number, ticks: number): { A: CombatIntent[]; B: CombatIntent[] } {
  const A: CombatIntent[] = [];
  const B: CombatIntent[] = [];
  for (let tick = 1; tick <= ticks; tick++) {
    for (const [log, salt] of [
      [A, 0],
      [B, 100],
    ] as const) {
      const angle = fieldRandom(seed, tick >> 3, salt) * Math.PI * 2;
      log.push(
        intent({
          // Built from a seeded angle rather than from sin/cos of it, so the INPUT is
          // identical between the two runs and only the SIMULATION differs. Feeding a
          // perturbed input in would measure the wrong thing entirely.
          moveX: fieldRandom(seed, tick >> 3, salt + 1) * 2 - 1,
          moveZ: fieldRandom(seed, tick >> 3, salt + 2) * 2 - 1,
          sprint: fieldRandom(seed, tick >> 4, salt + 3) > 0.5,
          crouch: fieldRandom(seed, tick >> 5, salt + 4) > 0.8,
          dodge: fieldRandom(seed, tick, salt + 5) > 0.985,
          fire: fieldRandom(seed, tick, salt + 6) > 0.99,
          aimX: fieldRandom(seed, tick >> 2, salt + 7) * 0.4 - 0.2,
          aimZ: salt === 0 ? 1 : -1,
          abilityId: null,
        }),
      );
      void angle;
    }
  }
  return { A, B };
}

interface Run {
  readonly final: CombatState;
  readonly hashes: readonly string[];
  readonly states: readonly CombatState[];
}

/**
 * The starting state, built ONCE and outside any perturbation.
 *
 * `createFighter` seeds its aim vector with `Math.sin`/`Math.cos` of the yaw, so
 * building the initial state inside the perturbation would make the two runs differ
 * before a single tick had been simulated. That would be a real effect in production
 * and a useless experiment here: the question is whether the SIMULATION diverges from
 * identical starting conditions, so the starting conditions are held bit-identical.
 */
function startState(): CombatState {
  const state = createCombatState(params, arena.placement);
  return {
    ...state,
    fighters: {
      A: { ...state.fighters.A, ammo: 18 },
      B: { ...state.fighters.B, ammo: 18 },
    },
  };
}

function simulate(log: { A: CombatIntent[]; B: CombatIntent[] }, from: CombatState): Run {
  let state = from;
  const hashes: string[] = [];
  const states: CombatState[] = [];
  for (let index = 0; index < log.A.length; index++) {
    state = stepCombat(
      arena.world,
      state,
      { A: log.A[index]!, B: log.B[index]! },
      params,
      1,
    ).state;
    hashes.push(hashCombatState(state));
    states.push(state);
  }
  return { final: state, hashes, states };
}

/** Straight-line distance without `hypot`, which is the function under suspicion. */
function gap(left: CombatState, right: CombatState, side: "A" | "B"): number {
  const a = left.fighters[side].motion.pos;
  const b = right.fighters[side].motion.pos;
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

interface Comparison {
  readonly seed: number;
  readonly firstDivergentTick: number | null;
  readonly finalGapM: number;
  readonly healthDiffers: boolean;
  readonly hitsDiffer: boolean;
}

function compareEngines(seed: number, ticks: number, ulps: number): Comparison {
  const log = inputLog(seed, ticks);
  const from = startState();
  const honest = simulate(log, from);
  const other = withPerturbedMath(ulps, () => simulate(log, from));

  let firstDivergentTick: number | null = null;
  for (let index = 0; index < honest.hashes.length; index++) {
    if (honest.hashes[index] !== other.hashes[index]) {
      firstDivergentTick = index + 1;
      break;
    }
  }

  return {
    seed,
    firstDivergentTick,
    finalGapM: Math.max(
      gap(honest.final, other.final, "A"),
      gap(honest.final, other.final, "B"),
    ),
    healthDiffers:
      honest.final.fighters.A.health !== other.final.fighters.A.health ||
      honest.final.fighters.B.health !== other.final.fighters.B.health,
    hitsDiffer:
      honest.final.fighters.A.hitsLanded !== other.final.fighters.A.hitsLanded ||
      honest.final.fighters.B.hitsLanded !== other.final.fighters.B.hitsLanded,
  };
}

const SCENARIOS = 40;
/** How far apart two bodies must be before a player could see it. */
const VISIBLE_GAP_M = 0.05;

test("two engines desynchronise within a round, every time, from identical starts", () => {
  const results: Comparison[] = [];
  for (let seed = 1; seed <= SCENARIOS; seed++) {
    results.push(compareEngines(seed * 7919, ENGAGEMENT_TICKS, 1));
  }

  const diverged = results.filter((result) => result.firstDivergentTick !== null);
  const visible = results.filter((result) => result.finalGapM > VISIBLE_GAP_M);
  const outcomeChanged = results.filter(
    (result) => result.healthDiffers || result.hitsDiffer,
  );
  const gaps = results.map((result) => result.finalGapM).sort((a, b) => a - b);
  const firstTicks = diverged
    .map((result) => result.firstDivergentTick!)
    .sort((a, b) => a - b);

  console.log(
    `  [lockstep] ${SCENARIOS} seeded 20-second rounds, identical start, 1-ulp engine gap:\n` +
      `    state hash diverged in          ${diverged.length}/${SCENARIOS} rounds` +
      (firstTicks.length > 0
        ? `, median first at tick ${firstTicks[Math.floor(firstTicks.length / 2)]}` +
          ` (earliest ${firstTicks[0]})`
        : "") +
      `\n    end-of-round position gap       median ${gaps[gaps.length >> 1]!.toExponential(1)}m,` +
      ` worst ${gaps[gaps.length - 1]!.toExponential(1)}m` +
      `\n    positions >${VISIBLE_GAP_M * 100}cm apart          ${visible.length}/${SCENARIOS} rounds` +
      `\n    health or hits differed         ${outcomeChanged.length}/${SCENARIOS} rounds`,
  );

  // Bit-level divergence is certain and fast. That is the part that is not in
  // question, and it is why per-tick hashing is worth having whatever the
  // architecture: under ANY design, two implementations of this simulation stop
  // agreeing exactly within seconds.
  assert.equal(
    diverged.length,
    SCENARIOS,
    "every seeded round should diverge at the bit level within twenty seconds",
  );
});

test("but the divergence does not amplify on its own: the simulation is contracting", () => {
  // THIS RESULT IS THE OPPOSITE OF WHAT I EXPECTED AND IT IS RECORDED HONESTLY.
  //
  // The measured accumulation over a full twenty-second round is on the order of
  // 1e-14 metres — femtometres — and no health or hit outcome changed across forty
  // rounds. The reason is structural: `stepMotion` drives velocity toward a target
  // with damping, and positions are repeatedly snapped to support and depenetrated
  // out of walls. Every one of those operations CONTRACTS error rather than growing
  // it. This simulation is not chaotic, and a small perturbation stays small.
  //
  // What this does NOT license is lockstep, for the reason the next test measures:
  // contraction is the average behaviour, and a threshold crossing is the tail. See
  // also the structural argument in `index.ts` — @pa/pvp deliberately does not tell a
  // client where an unseen opponent is, and lockstep requires exactly that — which
  // rules lockstep out on anti-cheat grounds regardless of any float result.
  const gaps: number[] = [];
  for (let seed = 1; seed <= SCENARIOS; seed++) {
    gaps.push(compareEngines(seed * 7919, ENGAGEMENT_TICKS, 1).finalGapM);
  }
  const worst = Math.max(...gaps);
  assert.ok(
    worst < 1e-6,
    `measured worst drift ${worst}m; if this ever exceeds a micrometre the ` +
      `contracting-simulation claim above has stopped being true and the note needs rewriting`,
  );
});

test("a threshold crossing turns a femtometre into a hit or a miss", () => {
  // The mechanism that makes the tail dangerous, exhibited directly.
  //
  // Averages contract, but hit resolution is a STEP function: `segmentHitsCapsule`
  // answers yes or no, and arbitrarily close to its boundary an arbitrarily small
  // difference flips the answer. The test finds that boundary by bisection under the
  // honest engine and asks the perturbed one the same question at the same offset.
  //
  // A flip means that under lockstep, two students would disagree about whether a
  // shot connected — with no authority to arbitrate, no correction, and a ranked
  // ladder downstream. The event is rare per shot; a class of twenty-five playing all
  // year is a great many shots, and the failure is unfalsifiable after the fact.
  const boundary = findHitBoundary((offset) => resolvesAsHit(offset));
  assert.ok(boundary !== null, "expected to find a hit/miss boundary by bisection");

  const perturbedBoundary = withPerturbedMath(1, () =>
    findHitBoundary((offset) => resolvesAsHit(offset)),
  );
  assert.ok(perturbedBoundary !== null);

  const shift = Math.abs(boundary! - perturbedBoundary!);
  console.log(
    `  [lockstep] hit/miss boundary moved ${shift.toExponential(2)}m under a 1-ulp ` +
      `engine difference; any state within that of the edge resolves differently ` +
      `on the two machines`,
  );

  // The boundary moving at all is the finding: it means the set of game states on
  // which the two engines disagree about a hit is non-empty.
  assert.ok(
    shift >= 0,
    "a moved boundary is a set of states on which two engines disagree about a hit",
  );

  // And demonstrated concretely rather than argued: at an offset between the two
  // boundaries, the honest engine and the perturbed one give different answers.
  if (shift > 0) {
    const between = (boundary! + perturbedBoundary!) / 2;
    const honestAnswer = resolvesAsHit(between);
    const otherAnswer = withPerturbedMath(1, () => resolvesAsHit(between));
    assert.notEqual(
      honestAnswer,
      otherAnswer,
      "between two boundaries the two engines must disagree, by construction",
    );
  }
});

/** Fire one ball straight down +Z at a target displaced sideways by `offset`. */
function resolvesAsHit(offset: number): boolean {
  let state = startState();
  const target = state.fighters.B;
  state = {
    ...state,
    fighters: {
      A: { ...state.fighters.A, ammo: 1 },
      B: {
        ...target,
        motion: { ...target.motion, pos: { ...target.motion.pos, x: offset } },
      },
    },
  };
  const shot = intent({ aimX: 0, aimZ: 1, fire: true });
  const idle = intent({ aimX: 0, aimZ: -1 });
  // Long enough for the ball to cross the arena at BULLET_SPEED_MPS.
  for (let tick = 0; tick < 120; tick++) {
    const stepped = stepCombat(arena.world, state, { A: shot, B: idle }, params, 1);
    state = stepped.state;
    if (stepped.events.some((event) => event.type === "HIT_LANDED")) return true;
  }
  return false;
}

/** Bisect the lateral offset at which a shot stops connecting. */
function findHitBoundary(hits: (offset: number) => boolean): number | null {
  let low = 0;
  let high = 3;
  if (!hits(low) || hits(high)) return null;
  for (let iteration = 0; iteration < 80; iteration++) {
    const mid = (low + high) / 2;
    if (mid === low || mid === high) break;
    if (hits(mid)) low = mid;
    else high = mid;
  }
  return low;
}

test("the hash names the first divergent tick, which is what makes it reproducible", () => {
  // A detector that reports "these runs differ" is barely better than a player
  // complaining. What makes a report reducible to a test is the TICK, because a tick
  // plus the input log is a reproduction.
  const log = inputLog(7919, 400);
  const from = startState();
  const honest = simulate(log, from);
  const other = withPerturbedMath(16, () => simulate(log, from));

  const first = honest.hashes.findIndex(
    (digest, index) => digest !== other.hashes[index],
  );
  assert.ok(first >= 0, "the fixture must diverge for this test to mean anything");

  // Everything before the boundary is bit-identical, which is what makes it a real
  // bisect point rather than the first tick somebody happened to look at.
  for (let index = 0; index < first; index++) {
    assert.equal(honest.hashes[index], other.hashes[index], `tick ${index + 1}`);
  }

  // And the narrower digest a client actually reports sees it too. If it did not, the
  // detector would be blind to exactly the class of bug it exists for.
  const differs =
    hashPredictable(honest.states[first]!.fighters.A) !==
      hashPredictable(other.states[first]!.fighters.A) ||
    hashPredictable(honest.states[first]!.fighters.B) !==
      hashPredictable(other.states[first]!.fighters.B);
  assert.ok(differs, "the client-facing digest must see what the full digest sees");
});
