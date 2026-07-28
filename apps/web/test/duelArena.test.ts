// THE COVER YOU SEE IS THE COVER THAT STOPS A BALL — proven for the shared arena.
//
// The owner's decision moves every Boston boss fight and PvP into the one arena
// arenaSpec.ts builds (`yardArena()`), and entering the duel from the mission is now
// a transition into it (see missionBrief.ts). The invariant arenaSpec.ts states in
// capitals has to survive that move: the crate a player hides behind must be the
// exact rectangle the core tests a shot against, with no second set of numbers that
// can drift.
//
// This file is that proof. It does not trust the comment in arenaSpec.ts — it takes
// the cover the renderer draws (`fittedCover()`, exactly what ArenaView's `Cover`
// maps over) and the blockers the core simulates (`yardArena().world.blockers`,
// built by @pa/duel's `buildArena` from `yardArenaSpec()`), and checks that for
// every piece of cover they are the same rectangle at the same place and the same
// height. If the two can ever diverge, that is the picture-versus-physics defect the
// project spent two days eliminating, and it would be worse in the duel because
// cover decides the fight.

import assert from "node:assert/strict";
import test from "node:test";

import {
  YARD_COVER,
  fittedCover,
  yardArena,
  yardArenaSpec,
} from "../src/duel/arenaSpec.js";

const EPS = 1e-9;

/** The AABB a `wallFromRect` blocker occupies, as a centre and half-extents. */
function blockerBox(blocker: {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}) {
  return {
    cx: (blocker.minX + blocker.maxX) / 2,
    cz: (blocker.minZ + blocker.maxZ) / 2,
    halfX: (blocker.maxX - blocker.minX) / 2,
    halfZ: (blocker.maxZ - blocker.minZ) / 2,
  };
}

test("every drawn cover prop is exactly one arena blocker", () => {
  const drawn = fittedCover(); // what ArenaView's <Cover> renders, prop by prop
  const arena = yardArena();
  const blockers = new Map(arena.world.blockers.map((b) => [b.id, b]));

  // Same set of ids, no more and no less: a blocker with no prop is cover that
  // stops a ball you cannot see, and a prop with no blocker is cover you can see
  // that stops nothing. Both are the defect this asserts against.
  assert.equal(
    blockers.size,
    drawn.length,
    "one blocker per drawn cover prop, and no orphan of either kind",
  );

  for (const prop of drawn) {
    const blocker = blockers.get(prop.id);
    assert.ok(blocker, `drawn cover ${prop.id} has a blocker`);

    const box = blockerBox(blocker);
    // The prop is drawn at (x, z) with footprint half-extents (halfX, halfZ) — the
    // very numbers `fitPropToHeight` gave the renderer. The blocker must be that
    // exact rectangle.
    assert.ok(Math.abs(box.cx - prop.x) < EPS, `${prop.id} blocker centred in x`);
    assert.ok(Math.abs(box.cz - prop.z) < EPS, `${prop.id} blocker centred in z`);
    assert.ok(
      Math.abs(box.halfX - prop.halfX) < EPS,
      `${prop.id} blocker half-width is the prop's footprint`,
    );
    assert.ok(
      Math.abs(box.halfZ - prop.halfZ) < EPS,
      `${prop.id} blocker half-depth is the prop's footprint`,
    );
    // The prop is drawn `heightM` tall and the blocker stops a shot up to `topY`:
    // the same number, so a glance at how tall the cover is tells the player
    // whether it stops an aimed shot.
    assert.ok(
      Math.abs(blocker.topY - prop.heightM) < EPS,
      `${prop.id} blocker top is the prop's drawn height`,
    );
    assert.ok(blocker.tags.has("DUEL_COVER"), `${prop.id} is tagged cover`);
  }
});

test("cover is only yawed by half-turns, so the AABB is the silhouette", () => {
  // The blocker is an axis-aligned box; the drawn prop is turned by `yaw`. Those two
  // footprints are identical only when the turn is a multiple of a half-turn — a
  // quarter-turn would swap the box's width and depth and the drawn crate would jut
  // past the rectangle that blocks. Every cover placement must therefore be yawed by
  // a multiple of PI. (Dressing may be turned freely: it has no blocker and lives
  // outside the bounds the core clamps the player to.)
  for (const cover of YARD_COVER) {
    const halfTurns = cover.yaw / Math.PI;
    assert.ok(
      Math.abs(halfTurns - Math.round(halfTurns)) < EPS,
      `${cover.id} is yawed by a multiple of PI (${cover.yaw}), so its AABB is its silhouette`,
    );
  }
});

test("the spec the core builds from is the spec the renderer measures", () => {
  // `yardArenaSpec()` is the single hand-off from the drawn yard to the core: each
  // `CoverSpec` is one `fittedCover()` entry, narrowed. Assert the mapping is exactly
  // that, so the day someone adds a prop to `YARD_COVER` it appears in the core's
  // spec too, rather than the two lists being maintained apart.
  const spec = yardArenaSpec();
  const drawn = fittedCover();
  assert.equal(spec.cover.length, drawn.length);

  for (const prop of drawn) {
    const cover = spec.cover.find((c) => c.id === prop.id);
    assert.ok(cover, `${prop.id} is in the arena spec`);
    assert.equal(cover.x, prop.x);
    assert.equal(cover.z, prop.z);
    assert.equal(cover.halfX, prop.halfX);
    assert.equal(cover.halfZ, prop.halfZ);
    assert.equal(cover.topY, prop.heightM);
  }
});
