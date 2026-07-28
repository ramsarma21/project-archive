// The duel's combat and policy paths were reduced to IEEE-754-pinned ops so that a
// hash computed by Node and one computed by a student's browser agree to the last
// bit (see @pa/netcode). Two of those conversions replaced an
// implementation-approximated transcendental with a BAKED decimal literal rather
// than an algebraic reformulation, because there was no algebraic route:
//
//   * `AIM_ASSIST_MAX_RAD_COS` stands in for `Math.cos(AIM_ASSIST_MAX_RAD)`, the
//     cosine of the aim-assist cone cap, so the snap test is a dot-product compare
//     instead of an `acos`/`atan2` one.
//   * `COVER_PROBE_HEADINGS` stands in for the ring of `Math.cos`/`Math.sin` the
//     boss's cover probe used to compute at runtime.
//
// A baked literal is only sound if it equals the expression it replaces, so this
// re-derives both in the authoring engine (Node, where every golden runs) and fails
// the instant a literal, AIM_ASSIST_MAX_RAD or the probe count drifts out of
// agreement. It mirrors engine-world's `transcendentalDeterminism.test.ts` exactly.

import { test } from "node:test";
import assert from "node:assert/strict";

import { AIM_ASSIST_MAX_RAD_COS } from "../combat.js";
import { COVER_PROBE_HEADINGS } from "../policy.js";
import { AIM_ASSIST_MAX_RAD } from "../tuning.js";

test("the baked aim-assist cap cosine equals Math.cos(AIM_ASSIST_MAX_RAD), bit for bit", () => {
  const cos = Math.cos(AIM_ASSIST_MAX_RAD);
  assert.ok(
    Object.is(AIM_ASSIST_MAX_RAD_COS, cos),
    `AIM_ASSIST_MAX_RAD_COS ${AIM_ASSIST_MAX_RAD_COS} !== ${cos}; re-bake it`,
  );
  // Round-trips through its own decimal spelling, which is the property a hand-typo
  // would silently lose and the one that makes the literal engine-independent.
  assert.equal(Number(AIM_ASSIST_MAX_RAD_COS.toString()), AIM_ASSIST_MAX_RAD_COS);
});

test("the baked cover-probe ring equals Math.cos/Math.sin of its angles, bit for bit", () => {
  const n = COVER_PROBE_HEADINGS.length;
  // The count is load-bearing: the angle of each ray is (index / n) * 2*PI, so a
  // changed n silently re-spaces every ray. Sixteen is the value the table was baked
  // at; a different one must be re-baked, not reinterpreted.
  assert.equal(n, 16, "the cover probe ring is baked at 16 rays; re-bake if this changes");
  for (let index = 0; index < n; index++) {
    const angle = (index / n) * Math.PI * 2;
    const [bakedX, bakedZ] = COVER_PROBE_HEADINGS[index]!;
    assert.ok(
      Object.is(bakedX, Math.cos(angle)),
      `COVER_PROBE_HEADINGS[${index}].x ${bakedX} !== ${Math.cos(angle)}; re-bake it`,
    );
    assert.ok(
      Object.is(bakedZ, Math.sin(angle)),
      `COVER_PROBE_HEADINGS[${index}].z ${bakedZ} !== ${Math.sin(angle)}; re-bake it`,
    );
    assert.equal(Number(bakedX.toString()), bakedX);
    assert.equal(Number(bakedZ.toString()), bakedZ);
  }
});
