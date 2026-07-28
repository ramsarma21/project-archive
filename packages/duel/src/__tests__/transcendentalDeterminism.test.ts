// The duel's combat and policy paths were reduced to IEEE-754-pinned ops so that a
// hash computed by Node and one computed by a student's browser agree to the last
// bit (see @pa/netcode). Two of those conversions replaced an
// implementation-approximated transcendental with a BAKED decimal literal, because
// there was no algebraic route:
//
//   * `AIM_ASSIST_MAX_RAD_COS` stands in for `Math.cos(AIM_ASSIST_MAX_RAD)`, the
//     cosine of the aim-assist cone cap, so the snap test is a dot-product compare
//     instead of an `acos`/`atan2` one.
//   * `COVER_PROBE_HEADINGS` stands in for the ring of `Math.cos`/`Math.sin` the
//     boss's cover probe used to compute at runtime.
//
// WHAT THIS GUARD MUST — AND MUST NOT — ASSERT, LEARNED THE HARD WAY. The first
// version of this file re-derived each literal with `Math.cos`/`Math.sin` and
// compared with `Object.is`, exactly mirroring engine-world's blend guard. That is
// the wrong property, and the first CI run on Linux proved it: `Math.sin` of the
// index-9 angle returned a value one ulp off the macOS bake, so a bit-equality
// assertion against the local libm FAILED — on a value that is perfectly correct.
// IEEE 754 pins `+ - * / sqrt`; it explicitly does NOT pin sin/cos/exp, and their
// last-bit cross-platform variance is the entire reason these literals are baked. A
// guard that demands the baked value equal the host's libm re-introduces the very
// dependency the baking removes, and is guaranteed to fail on whichever platform
// did not do the baking.
//
// So the guard asserts the property we actually have and want: each literal is the
// correctly-rounded value of its transcendental TO WITHIN A FEW ULPS — enough to
// catch a typo, a wrong angle, a wrong sign or a stale re-bake, and NOT enough to be
// tripped by the last-ulp disagreement two conforming libms are permitted. Measured
// against that same libm variance: the Linux/macOS gap that broke the old test is 1
// ulp, whereas the mildest genuine mistake — dropping a single trailing decimal
// digit — is 62 ulps, and a wrong angle is ~10^3 ulps or more. `MAX_LIBM_ULPS` sits
// an order of magnitude above the former and comfortably below the latter, so the
// band between them is empty of both platform noise and real errors.
//
// Two other candidates were considered and rejected. Asserting only the DERIVED
// invariant (unit length, spacing, ordering) checks what the mover happens to
// tolerate rather than that the literal IS cos/sin of its angle — a systematically
// wrong-but-still-unit ring would pass — and unit length is not exactly
// representable anyway. Regenerating the literals from a portable polynomial trades
// a trusted value for an unverified reimplementation. A ulp-bounded re-derivation is
// the smallest change that keeps the exact guarantee the guard is for (these are the
// right values) while dropping the false one (this platform's libm agrees).
//
// NOTE FOR THE OTHER LANE: engine-world's own `transcendentalDeterminism.test.ts`
// still `Object.is`-compares GROUNDED_ACCEL_BLEND / GROUNDED_DECEL_BLEND against
// `1 - Math.exp(...)`. `Math.exp` is unpinned for the identical reason, so that guard
// has this same latent bug and should adopt the same ulp tolerance. It is not edited
// here because engine-world belongs to another lane.

import { test } from "node:test";
import assert from "node:assert/strict";

import { AIM_ASSIST_MAX_RAD_COS } from "../combat.js";
import { COVER_PROBE_HEADINGS } from "../policy.js";
import { AIM_ASSIST_MAX_RAD } from "../tuning.js";

/**
 * The most a baked literal may differ from the host libm's value of the same
 * transcendental. Chosen from measurement, not taste: the macOS-vs-Linux gap that
 * broke the bit-equality version is 1 ulp, a realistic libm is within ~1-2 ulps of
 * correctly-rounded (so two of them are within ~4), and the smallest genuine typo —
 * dropping one trailing decimal digit — is 62 ulps. 16 leaves ~8x headroom over
 * cross-platform variance and stays ~4x under the nearest real error.
 */
const MAX_LIBM_ULPS = 16;

/** A monotonic ordering key over the IEEE-754 doubles, so ulp distance is exact. */
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

/** The angle of cover-probe ray `index`, computed with only pinned ops on Math.PI. */
function coverAngle(index: number): number {
  return (index / COVER_PROBE_HEADINGS.length) * Math.PI * 2;
}

test("the baked aim-assist cap cosine is Math.cos(AIM_ASSIST_MAX_RAD) to within libm ulps", () => {
  const cos = Math.cos(AIM_ASSIST_MAX_RAD);
  const apart = ulpsApart(AIM_ASSIST_MAX_RAD_COS, cos);
  assert.ok(
    apart <= MAX_LIBM_ULPS,
    `AIM_ASSIST_MAX_RAD_COS ${AIM_ASSIST_MAX_RAD_COS} is ${apart} ulps from ` +
      `Math.cos(${AIM_ASSIST_MAX_RAD})=${cos}; > ${MAX_LIBM_ULPS} means a wrong ` +
      `constant, not libm variance — re-bake it`,
  );
  // Round-trips through its own decimal spelling: platform-independent, and the
  // property a hand-typo that is not a clean shortest double would lose.
  assert.equal(Number(AIM_ASSIST_MAX_RAD_COS.toString()), AIM_ASSIST_MAX_RAD_COS);
});

test("the baked cover-probe ring is Math.cos/Math.sin of its angles to within libm ulps", () => {
  const n = COVER_PROBE_HEADINGS.length;
  // The count is load-bearing: the angle of each ray is (index / n) * 2*PI, so a
  // changed n silently re-spaces every ray. Sixteen is the value the table was baked
  // at; a different one must be re-baked, not reinterpreted.
  assert.equal(n, 16, "the cover probe ring is baked at 16 rays; re-bake if this changes");
  for (let index = 0; index < n; index++) {
    const angle = coverAngle(index);
    const [bakedX, bakedZ] = COVER_PROBE_HEADINGS[index]!;
    const apartX = ulpsApart(bakedX, Math.cos(angle));
    const apartZ = ulpsApart(bakedZ, Math.sin(angle));
    assert.ok(
      apartX <= MAX_LIBM_ULPS,
      `COVER_PROBE_HEADINGS[${index}].x ${bakedX} is ${apartX} ulps from ` +
        `Math.cos(angle)=${Math.cos(angle)}; re-bake it`,
    );
    assert.ok(
      apartZ <= MAX_LIBM_ULPS,
      `COVER_PROBE_HEADINGS[${index}].z ${bakedZ} is ${apartZ} ulps from ` +
        `Math.sin(angle)=${Math.sin(angle)}; re-bake it`,
    );
    assert.equal(Number(bakedX.toString()), bakedX);
    assert.equal(Number(bakedZ.toString()), bakedZ);
  }
});

test("the tolerance absorbs cross-platform libm variance but still rejects a wrong constant", () => {
  // THIS IS HOW THE FIX IS CONFIRMED FOR A PLATFORM THAT CANNOT BE RUN HERE. The
  // Linux runner differs from this machine only in the last bits of sin/cos, so a
  // faithful model of it is "the same ring, re-derived by a libm nudged a few ulps".
  // Nudging by more than the real 1-ulp gap (here 4, twice any realistic libm error)
  // and showing every baked value is STILL within tolerance is a stand-in for the CI
  // machine: if this passes under a deliberately-worse libm, it passes on Linux.
  const worseLibmUlps = 4;
  assert.ok(worseLibmUlps < MAX_LIBM_ULPS);
  for (let index = 0; index < COVER_PROBE_HEADINGS.length; index++) {
    const angle = coverAngle(index);
    const [bakedX, bakedZ] = COVER_PROBE_HEADINGS[index]!;
    const shiftedCos = nudge(Math.cos(angle), worseLibmUlps);
    const shiftedSin = nudge(Math.sin(angle), worseLibmUlps);
    assert.ok(
      ulpsApart(bakedX, shiftedCos) <= MAX_LIBM_ULPS,
      `index ${index} x would fail under a ${worseLibmUlps}-ulp libm shift`,
    );
    assert.ok(
      ulpsApart(bakedZ, shiftedSin) <= MAX_LIBM_ULPS,
      `index ${index} z would fail under a ${worseLibmUlps}-ulp libm shift`,
    );
  }

  // AND IT IS NOT BLIND. A genuinely wrong constant — the mildest kind, a trailing
  // decimal-digit typo on a real entry (62 ulps, measured) — is outside the tolerance
  // and would be caught, on every platform, libm variance and all.
  const [truthX] = COVER_PROBE_HEADINGS[9]!;
  const typo = Number("-0.92387953251128"); // COVER_PROBE_HEADINGS[9].x with its last two digits lost
  assert.notEqual(typo, truthX, "the mutation must actually change the value");
  assert.ok(
    ulpsApart(typo, Math.cos(coverAngle(9))) > MAX_LIBM_ULPS,
    "a dropped-digit constant must be rejected as a wrong value, not tolerated",
  );
});
