// The fixed-step blends in playerMotion are BAKED decimal literals rather than
// `1 - Math.exp(...)` computed at load, because a numeric literal parses to the
// same double on every conforming engine while `Math.exp` does not. That trade is
// only sound if the literal actually equals the expression it stands in for — so
// this re-derives it and fails if ACCEL, DECEL, FIELD_DT or a literal drifts.
//
// WHY THIS IS NOT AN Object.is COMPARISON, LEARNED FROM THE SIBLING FILE. This guard
// used to assert `Object.is(GROUNDED_ACCEL_BLEND, 1 - Math.exp(...))`. That is the
// wrong property: IEEE 754 pins `+ - * / sqrt` but explicitly NOT `exp`, and its
// last-bit variance across libms is the entire reason the blend is baked. The duel's
// twin of this guard — `packages/duel/.../transcendentalDeterminism.test.ts`, which
// baked `cos`/`sin` — asserted the same bit-equality against `Math.sin` and FAILED on
// the first Linux CI run, on a value that was perfectly correct, because Linux's
// `Math.sin` returned one ulp off the macOS bake. A guard that demands the baked
// value equal the host libm re-introduces the dependency the baking removes and must
// fail on whichever platform did not bake. This one passed that first Linux run only
// by luck — that libm's `exp` of these particular arguments happened to match — with
// no guarantee on the next runner or toolchain bump.
//
// So it asserts the property we actually have: each literal is `1 - exp(arg)` to
// within the ulps a conforming libm's `exp` may legitimately vary by — enough to
// catch a wrong rate, a stale re-bake, or a transcription error, and not enough to be
// tripped by a last-bit `exp` disagreement.
//
// WHY THE THRESHOLD IS NOT THE 16 THE sin/cos SIBLING USES — exp's error propagates
// differently and it was MEASURED, not assumed. The blend is `1 - exp(arg)` with
// `exp ~= 0.87-0.91` but the RESULT ~= 0.086-0.13, so the subtraction lands in a
// binade with a smaller ulp and AMPLIFIES exp's error: measured, one exp-ulp becomes
// 8 blend-ulps for the ACCEL blend and 4 for DECEL. The sin/cos ring had no such
// step, so its 16-ulp budget does not transfer. Here the budget is expressed where it
// is meaningful — in ulps of `exp` itself — and converted to a per-blend tolerance
// through the measured amplification. `EXP_ULP_BUDGET = 4` is generous: the observed
// Linux/macOS gap on these arguments was 0 ulps, a modern libm's `exp` is within ~1
// ulp of correctly-rounded (so two of them within ~2), and 4 leaves 2-4x headroom.
// Amplified, that is a 32-ulp tolerance on the ACCEL blend and 16 on DECEL — still far
// below any meaningful error: a dropped-two-digits typo on ACCEL is 59 ulps, a changed
// 12th significant digit is hundreds, and a stale rate is thousands. The band the
// budget forgoes (differences under a few exp-ulps) is, by construction, smaller than
// the variance `exp` itself carries across platforms — inconsequential to a guarantee
// that is about the baked LITERAL being bit-identical everywhere, which it is.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ACCEL,
  DECEL,
  GROUNDED_ACCEL_BLEND,
  GROUNDED_DECEL_BLEND,
  assertFieldDt,
  createGroundedState,
  stepMotion,
} from "../playerMotion.js";
import { FIELD_DT } from "../fieldSimulation.js";
import type { CollisionWorld } from "../collision.js";

const OPEN: CollisionWorld = {
  blockers: [],
  platforms: [],
  bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
};

/**
 * Ulps of `exp` a conforming libm may disagree by, before amplification. The
 * observed Linux/macOS gap on these arguments is 0; a modern libm's `exp` is within
 * ~1 ulp of correctly-rounded; 4 gives 2-4x headroom over any realistic disagreement.
 */
const EXP_ULP_BUDGET = 4;
/** The realistic (not budgeted) cross-libm gap, used by the self-test below. */
const REALISTIC_EXP_ULPS = 2;

/** A monotonic ordering key over the doubles, so ulp distance is exact. */
function orderKey(bits: bigint): bigint {
  return bits & 0x8000000000000000n
    ? 0xffffffffffffffffn - bits
    : bits + 0x8000000000000000n;
}

/** Representable doubles between `a` and `b`. 0 when identical, exact for finites. */
function ulpsApart(a: number, b: number): number {
  if (Object.is(a, b)) return 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  const view = new DataView(new ArrayBuffer(16));
  view.setFloat64(0, a);
  view.setFloat64(8, b);
  const ka = orderKey(view.getBigUint64(0));
  const kb = orderKey(view.getBigUint64(8));
  return Number(ka > kb ? ka - kb : kb - ka);
}

/** Move `value` `ulps` representable doubles toward larger magnitude. */
function nudge(value: number, ulps: number): number {
  if (!Number.isFinite(value) || value === 0 || ulps === 0) return value;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  view.setBigUint64(0, value > 0 ? bits + BigInt(ulps) : bits - BigInt(ulps));
  const result = view.getFloat64(0);
  return Number.isFinite(result) ? result : value;
}

/**
 * The blend tolerance in ulps, MEASURED not assumed: how far `1 - exp` moves when
 * `exp` itself moves by `EXP_ULP_BUDGET` ulps. This is the `1 - exp` amplification
 * (~8x for ACCEL, ~4x for DECEL) applied to the exp budget, per constant, from this
 * host's own `exp` — so the tolerance tracks each blend's real error propagation.
 */
function blendUlpTolerance(expValue: number): number {
  return Math.max(
    ulpsApart(1 - expValue, 1 - nudge(expValue, EXP_ULP_BUDGET)),
    ulpsApart(1 - expValue, 1 - nudge(expValue, -EXP_ULP_BUDGET)),
  );
}

const BLENDS = [
  { name: "GROUNDED_ACCEL_BLEND", rate: ACCEL, baked: GROUNDED_ACCEL_BLEND },
  { name: "GROUNDED_DECEL_BLEND", rate: DECEL, baked: GROUNDED_DECEL_BLEND },
] as const;

test("the baked grounded blends are 1 - exp(-rate * FIELD_DT * 0.6) to within exp libm ulps", () => {
  assert.equal(FIELD_DT, 1 / 60);
  for (const { name, rate, baked } of BLENDS) {
    const arg = -rate * FIELD_DT * 0.6;
    const exp = Math.exp(arg);
    const blend = 1 - exp;
    const tolerance = blendUlpTolerance(exp);
    const apart = ulpsApart(baked, blend);
    assert.ok(
      apart <= tolerance,
      `${name} ${baked} is ${apart} ulps from 1 - Math.exp(${arg})=${blend}; ` +
        `> ${tolerance} means a wrong constant, not libm variance — re-bake it`,
    );
    // Round-trips through its own decimal spelling: platform-independent, and the
    // property a hand-typo that is not a clean shortest double would lose.
    assert.equal(Number(baked.toString()), baked);
  }
});

test("the blend tolerance absorbs cross-platform exp variance but rejects a wrong constant", () => {
  // THE CROSS-PLATFORM CLAIM MADE VERIFIABLE FROM ONE PLATFORM. A different runner
  // differs only in the last bits of `exp`, so a faithful model of it is "the same
  // blend, re-derived from an `exp` nudged a few ulps". Showing the baked literal
  // stays inside tolerance under that nudge is a stand-in for the CI machine.
  assert.ok(REALISTIC_EXP_ULPS < EXP_ULP_BUDGET, "the budget must exceed the modelled real gap");
  for (const { name, rate, baked } of BLENDS) {
    const arg = -rate * FIELD_DT * 0.6;
    const exp = Math.exp(arg);
    const tolerance = blendUlpTolerance(exp);

    // A realistic (worse-than-observed) libm: exp off by REALISTIC_EXP_ULPS. The
    // baked literal must still pass, and with margin — the realistic gap uses less
    // than the full budget, so a genuinely different libm is not near the edge.
    const shiftedUp = 1 - nudge(exp, REALISTIC_EXP_ULPS);
    const shiftedDown = 1 - nudge(exp, -REALISTIC_EXP_ULPS);
    assert.ok(
      ulpsApart(baked, shiftedUp) <= tolerance && ulpsApart(baked, shiftedDown) <= tolerance,
      `${name} would fail under a realistic ${REALISTIC_EXP_ULPS}-ulp exp gap`,
    );
    assert.ok(
      Math.max(ulpsApart(1 - exp, shiftedUp), ulpsApart(1 - exp, shiftedDown)) < tolerance,
      `${name}: a realistic exp gap should sit inside the budget with margin`,
    );

    // AND IT IS NOT BLIND. The canonical wrong constant is a stale re-bake: someone
    // changes the rate and forgets to re-derive the literal. That is thousands of
    // ulps off and must be caught, libm variance and all.
    const staleRate = 1 - Math.exp(-(rate + 1) * FIELD_DT * 0.6);
    assert.ok(
      ulpsApart(staleRate, 1 - exp) > tolerance,
      `${name}: a blend baked from the wrong rate must be rejected`,
    );
  }
});

test("assertFieldDt accepts FIELD_DT and rejects anything else", () => {
  assert.doesNotThrow(() => assertFieldDt(FIELD_DT));
  assert.doesNotThrow(() => assertFieldDt(1 / 60));
  for (const bad of [1 / 30, 1 / 120, 0.016, 0, 0.05, Number.NaN]) {
    assert.throws(() => assertFieldDt(bad), /FIELD_DT/);
  }
});

test("stepMotion refuses a non-fixed step so a wrong blend can never be integrated", () => {
  const state = createGroundedState({ x: 0, y: 0, z: 0 }, 0);
  const input = { targetVelX: 1, targetVelZ: 0, reducedMotion: false };
  assert.doesNotThrow(() =>
    stepMotion(OPEN, state, { ...input, dt: FIELD_DT }),
  );
  assert.throws(
    () => stepMotion(OPEN, state, { ...input, dt: 1 / 30 }),
    /FIELD_DT/,
  );
});
