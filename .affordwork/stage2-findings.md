# Stage 2 (solver owns all three climb axes): measured, and what it needs

Measure-first, as before. The headline: **after Stage 1 the flow-path transitions
are already vertically sound, so the arc-loft is not a defect to fix; and the one
substantive Stage-2 runtime change (fail-to-arm) is not sound in a single pass
because a correct version must check the real per-tick solved path, not the
authoring spline. Both findings are backed by numbers from the running game.**

## The vertical is already sound after Stage 1 (numbers)

`.affordwork/measure-loft.mjs` records, per authored tick in the running game,
how far the solved foot rides above the surface under it (`window.__diag`
`liftM`). Real client, real input, `bare=1`:

    F_VAULT   ticks 46: lift rises 0->1.31m over GROUND on approach, drops to a
              0.21m PLATEAU while the feet are over the BARREL TOP (8 ticks),
              then back over ground and down. i.e. the body arcs up to barrel
              height, clears the barrel top by ~0.21m, and descends. maxDiv 0.063m.
    D2_VENT   same shape, 0.21m clearance over the vent top. maxDiv 0.050m.
    GATE      CLIMB_OVER: lofts to 1.82m to clear a ~1.8m partition. maxDiv 0.000m.
    BUTTRESS  CLIMB_UP control: lift rises 0->2.60m up the bare face (support far
              below, legitimately), then 0 once on top. Exactly as a face climb
              should read.

The vault does NOT loft grossly over its obstacle — it clears the top by ~0.2m,
which is correct clearance, and rides ground otherwise. There is no vertical
penetration and no gross over-loft to remove. So re-authoring the arc to "conform
to the obstacle" (ride the top at 0 clearance) would fix a non-problem and REGRESS
the natural clearance — the measurement says leave the arc alone. This corrects
the arc-loft hypothesis with numbers, the same way the slowdown microbenchmark
corrected the pin-and-pop-causes-slowdown hypothesis.

## Fail-to-arm: correct idea, not sound in one pass — staged

Bullet 2 ("a transition whose solved path cannot stay outside the collider should
fail to arm") was implemented: a per-sample check in `authoredTrajectoryClear`
that depenetrates each spline sample and refuses the move if the SOLVED position
still embeds a solid beyond the contact skin. It is a genuine 3D non-penetration
check (`capsuleEmbeddedIn` is span-aware) and it correctly refuses a synthetic
buried-destination climb.

But wiring it in **broke real route invariants** (`route.test`: "no route from
roof to duel using only SAFE links"; `traversability.test`: "every authored link
is performed by the shipped physics"). The reason is instructive and it is why
the change was REVERTED rather than shipped:

- The verifier runs the real `probe -> planVerb -> beginAuthored` path, so the
  anchors ARE the Stage-1-inset ones — and my own real-play drivers show every one
  of those transitions committing with **maxEmbed = 0 at every runtime tick**.
- Yet the arm-time check refused several of them. The check samples the SPLINE at
  authoring resolution (`max(24, durationMs/30)` points) and depenetrates each in
  isolation; a spline sample BETWEEN two runtime ticks, on a curved barrel
  OBB/capsule footprint, can land the depenetration with a residual above the
  1cm skin even though every actual runtime tick is clean. So the refusals were
  **false positives** — the authoring spline sample is not the body's real
  trajectory, and depenetrating it is not the same computation the runtime does.

A sound "fail to arm" therefore has to evaluate the REAL per-tick solved path —
i.e. run the action forward through `stepAuthored` at the fixed step and check the
tick positions — or the true coupled 3D solve below. Both are larger than one
pass, and doing the authoring-spline shortcut is exactly the kind of "true in the
harness, wrong in play" instrument this whole effort exists to avoid. Reverted;
staged as part of the coupled solver.

## What Stage 2 (the coupled 3D solver) actually is, and what it needs

The genuine version of "the solver owns Y": couple the vertical to the XZ solve
so the foot only rises as the body makes real horizontal progress along the
surface, run the whole thing as a per-tick collide-and-slide against the surface
(not a spline write + XZ depenetrate), and warp the animation onto the solved
transform. This needs a 3D swept-capsule-vs-world primitive the engine does not
have today (`sweepXZ` is horizontal only; vertical is separate support/ceiling
queries). Building that touches `collision.ts` broadly and risks the whole 2,699
baseline, so it is a deliberate multi-pass effort, and — critically — the
measurement does not justify the risk right now: after Stage 1 the flow-path
transitions are clean in XZ (0.00m divergence on climbs, <=0.125m on vaults) and
sound in Y (~0.2m clearance, 0 penetration). The remaining visible wrongness is
the hull != mesh gap, which the coupled solver does not fix either — that is
stages 3-5 (measured surfaces), sequenced with boss-fight and the asset lane.

Recommendation: build the coupled solver WITH the measured-surface work (stage 3+),
not before it, because a solver that constrains the body to a hull surface that
disagrees with the mesh is still constraining it to the wrong place. Until then,
Stage 1's surface-aligned anchors are the correct floor and the transitions are
measurably clean against the hull.

## The slowdown driver (follow-up 2 leftover): one command for the owner

`.affordwork/owner-frame-trace.mjs` — starts the app if needed, plays a route in
the owner's REAL Chrome with hardware acceleration (NOT SwiftShader), reads
`window.__diag.frames`, and prints the dropped-step count, effective time scale,
and a verdict. Run on the machine where the slows are felt:

    node .affordwork/owner-frame-trace.mjs                # headed, real GPU
    node .affordwork/owner-frame-trace.mjs http://localhost:5273 60 --headless

What it already shows here, on the accelerated (headless=new + GPU raster) path
rather than SwiftShader: the route renders at p50 ~20ms / p95 ~33ms with ZERO
steady dropped steps — but OCCASIONAL frame spikes (2 of ~950 frames, max 211ms)
exceed the 83ms catch-up window and discard ~10 sim ticks. That intermittency is
the "random" in "random slows": not a steady cost (the sim is 0.04ms/tick and the
GPU frame is ~20ms), but sporadic render/asset/GC hitches over the five-step
window. The verdict distinguishes in-window gameplay drops (the real number) from
the cumulative load-time drops (which it deliberately excludes), and points the
owner at Chrome's performance panel for the spike frames, which are GPU/draw cost.
