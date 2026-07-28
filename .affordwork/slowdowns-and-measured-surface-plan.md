# Follow-ups 2 and 3: the slowdowns, and the measured-surface plan

## 2. The residual slowdowns are render-bound, not the simulation — with numbers

Two measurements, one hardware-independent and defensible, one render-bound and
labelled as such.

### Per-tick SIM cost (hardware-independent, defensible)

`.affordwork/sim-cost.mjs` drives the REAL `m1Instance` (Scenery=null, so no
three.js) through `stepMissionRuntime` at a fixed 1/60 dt — one fixed tick per
frame, never a dropped step — and times each tick with `performance.now()` in a
plain node script (not sim source, so no boundary rule is touched). This is the
cost that would starve the fixed step and drop steps on ANY machine, GPU or not.

    180s of mission, 10,800 fixed ticks, one tick/frame:
      mean 0.039ms  p50 0.019ms  p95 0.116ms  p99 0.306ms  max 4.591ms
      60Hz budget 16.67ms/tick; p95 is 0.7% of it; ticks over budget: 0/10,800

The simulation — flow probe, 7 watcher vision cones, crowd, pursuit, encounters,
the depenetration solver — costs about a fiftieth of one tick's budget at p95.
It is nowhere near starving the loop. The one-off 4.59ms max (a GC or the civilian
list rebuild) is still a quarter of a single tick's budget and a twentieth of the
five-step catch-up window.

**This settles the escalation's hypothesis directly: the solver fighting the
animation is NOT a slowdown cause.** Even the pre-fix version, fighting a full
radius every climb tick, ran the whole sim in 0.7% of the budget. The pin-and-pop
was a visual/feel defect, not frame starvation. I will not tie the two symptoms
to one cause, because the measurement says they are not.

### The slow-motion MECHANISM, confirmed (render-bound, headless caveat)

`window.__diag.frames` on a real route run with scenery on, headless SwiftShader:

    16 frames captured; frame ms p50=4638, max=9819; 12/16 frames dropped 10 ticks each

Frame deltas of 4.6-9.8 SECONDS are SwiftShader rendering the GLB city on the CPU
— not a number any GPU machine produces. But it demonstrates the mechanism end to
end: when a frame exceeds the five-step window (83ms), `advanceFieldClock` runs 5
ticks and DISCARDS the rest (`accumulator -= rawSteps * FIELD_DT`, the full
rawSteps, not the 5 it ran) — dropped time is not banked, so sim time advances
slower than wall time. That IS the reported slow motion, and it is a pure function
of frame cost exceeding the window.

### Conclusion and the instrument that would finish it

The residual slowdown, if it survives, is render/GPU frame cost pushing frames
past the 83ms window — the two optimisations that landed (draw calls 177→60,
triangles 1.7M→0.44M) target exactly that. Whether they brought the owner's
frames under the window is a **GPU measurement I cannot make here**: headless
SwiftShader is CPU rendering and always over the window regardless of the
optimisations, so it can neither confirm nor deny the fix.

The instrument that answers it already exists — it is the `window.__diag` frame
trace I built (deltaMs, droppedThisFrame, timeScale). It needs to run on
**representative GPU hardware**: real Chrome with hardware acceleration on the
owner's machine, or a GPU-backed headless (`--use-gl=egl` on a box with a GPU,
not SwiftShader). Read `window.__diag.frames` after a route run; if
`droppedThisFrame` is ~0 and `deltaMs` p95 is under ~16-33ms, the slow motion is
gone. I am stopping here rather than guessing, per the brief.

One thing worth the owner's eye that is NOT hardware-dependent: `timeScale<1` in
the trace is reflex-time dilation (a deliberate slow-mo), which is real and by
design. If a "random slow" ever coincides with `timeScale<1`, that is the reflex
window firing, not a bug — the trace tells them apart.

---

# 3. The measured-surface architecture, as a plan to sequence

Established finding: the mover is correct AGAINST THE HULL and blind to the mesh.
Every destination it climbs to is a hand-typed hull coordinate (`blocker.topY`,
`topLanding`, the `climbs.ts` `at:` literals); where the hull differs from the
GLB the body climbs to the wrong place, and no collision instrument can see it.
`assets:verify:collision` already quantifies the gap (OLD_BRICK: a 3.65×5.85m
church inside a 16×14m solid block, ~90% empty). Correct climbing means measuring
the ledge from the mesh and constraining the body to THAT surface. This is that
migration, staged so each stage is shippable and gated.

Ownership note: stages 1-2 below are in this lane (`packages/engine-world`,
`apps/web/src/mission/{diag,MissionStage,traversal}`). Stages 3-5 span
`assets/**`, the pipeline, `climbs.ts`, `geometry.ts`, `route*.ts` — **other
lanes; I will not edit them.** They are written as a sequence for the owner to
assign. The `mission-encounters` sibling filling contain-fit hulls to their
meshes is the near-term partial fix for the same gap on the assets they cover;
this plan is the systemic version.

## The seed already in the repo

`scripts/check-world-affordances.mjs` (on main) loads GLB triangles and ray-casts
surfaces. That is the whole measuring primitive. The plan is to promote it from a
one-off verifier into either a build-time baker or a runtime mesh layer.

## Stage 0 — instrumentation (DONE, this lane)

`window.__diag` records solver-vs-spline divergence and strict hull embeds per
tick; the drivers reproduce any climb in the running game. This is the acceptance
harness for every stage below: a stage is done when the measured surface and the
solved body agree in real play, not when a test says so.

## Stage 1 — align the spline to the solved hull surface (DONE, this lane)

The CLIMB_UP/VAULT/CLIMB_OVER anchor inset. Removes the pin-and-pop by making the
authored spline the capsule-centre path the solver already holds. It does NOT
measure the mesh — it makes the body climb the HULL cleanly. It is the correct
floor to build the mesh work on: once the hull surface is honoured smoothly,
swapping the hull surface for a measured mesh surface is a data change, not a
solver change.

## Stage 2 — solver owns all three axes of a climb (this lane, NOT yet done)

Today `stepAuthored` writes `sample.y` straight from the spline and only
depenetrates XZ. Make the vertical solver-owned too: the feet rise constrained to
the surface (never above the measured top, never through an underside), and the
animation is warped onto the solved transform rather than the transform following
the animation. Module: `packages/engine-world/src/playerMotion.ts`
(`stepAuthored`), plus a surface-normal query in `collision.ts`. Cost: moderate;
risk: the 44-transition invariant and every parkour test. Gate on `window.__diag`
divergence AND the existing `climbSurfaceInvariant`. This is the last stage that
needs no mesh — it makes the mover ready to be handed a measured surface.

## Stage 3 — measure the ledge from the mesh (BUILD TIME, assets/pipeline lane)

Promote `check-world-affordances.mjs` into a pipeline pass that, for every
authored climb/landable, ray-casts the GLB and emits the measured top surface
(height + a small polygon or plane) into the compiled level data alongside the
hull. Build-time, not runtime, because ray-casting GLB triangles per frame is not
affordable and the mesh does not move. Output: a `measuredSurfaces` table keyed by
collider id, shipped in the compiled `CollisionWorld`. Owner: assets/pipeline +
`geometry.ts` (where the compiled world is assembled). Gate: a new
`assets:verify:surfaces` that fails when a climb's authored top and its measured
mesh top disagree beyond a tolerance — which is the OLD_BRICK class of defect
turned into a blocking check instead of a loud note.

## Stage 4 — the probe/reader consult the measured surface (this lane once fed)

`probe.ts` (`readObstacle`/`readRaisedSurface`/`readOverhead`) and `planVerb`
read `topY`/`topLanding` from the measured surface when one exists for the
collider, falling back to the hull top when it does not (so an un-measured
collider behaves exactly as today). This is in `packages/engine-world` — my lane —
but it is INERT until stage 3 feeds it data, so it can be written and tested
against synthetic measured surfaces now and wired later. Gate: `window.__diag`
shows the body climbing to the measured mesh top, not the hull top, in real play.

## Stage 5 — retire the hand-typed destinations (climbs.ts lane, LAST)

Once every climb has a measured surface, the `climbs.ts` `at:` literals and the
route's typed climb tops become the fallback-only path and can be expressed as
"climb onto <collider>" referencing the measured surface, not a coordinate. Owner:
boss-fight (`climbs.ts`, `route*.ts`). This is last because it is the step that
cannot be reversed without re-authoring, and it should only happen once stages 3-4
prove the measured surface is trustworthy for every climb.

## Migration for the existing authored climbs

Each authored climb keeps working through the fallback at every stage: no
measured surface → use the hull top (today's behaviour, now smooth after stage 1).
A climb migrates the moment stage 3 emits its measured surface and stage 4 reads
it; the `assets:verify:surfaces` gate (stage 3) is what says a given climb is safe
to migrate. So the rollout is per-collider and monotonic — a smaller set of
climbs that are genuinely mesh-correct, exactly the owner's stated preference,
with the rest cleanly on the hull fallback until measured.

## Where it must be gated

- Stage 1-2: `window.__diag` divergence ≈ 0 in real play + `climbSurfaceInvariant`
  + full test suite (2,699).
- Stage 3: `assets:verify:surfaces` (new) blocks when authored top ≠ measured top.
- Stage 4-5: `window.__diag` shows the body on the MEASURED top in real play, and
  the affordance-vs-mesh red list (`check-world-affordances.mjs`) goes to zero for
  migrated colliders.
