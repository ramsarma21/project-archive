# Climb architecture: is spline + depenetration capable of correct climbing?

Evidence is from the RUNNING client (worktree dev server on :5273, `bare=1` so
collision is identical and the GPU is out of the way), driven by real input via
Playwright, with a black box recorded inside the real fixed step
(`apps/web/src/mission/diag.ts`, `window.__diag`). Not the replay harness and not
the shipped invariants — those reported 0/44 while the owner phased.

Drivers: `.affordwork/drive-climbs.mjs` (drops the body at each authored climb
foot and holds W+Shift), `.affordwork/drive-diag.mjs` (plays the route).

## How the mover actually works (from the code)

- The flow controller (`stepFlow`) probes the world each tick (`probeAhead`),
  ranks verbs (`select.ts rankVerbs`), and commits one by building an anchor
  chain (`select.ts planVerb`). For a CLIMB_UP the chain is
  `[start, lip@face, topLanding@inset]`, where every coordinate is **measured
  from the COLLISION HULL** — `blocker.topY`, `supportBelow`, `canStand`. No
  three.js, no mesh, ever.
- `stepAuthored` (playerMotion.ts) samples that spline each tick and — since a
  prior fix — treats the sample as a *proposal*: it writes `sample.y` straight
  onto the body but runs `resolveOverlapXZ` (MTV depenetration, no ignore set) on
  the XZ against the full solid world. So the horizontal is solver-corrected; the
  vertical is pure spline.

## Q1. Is per-substep depenetration of an authored spline capable of correct climbing?

**No — it is a patch on the wrong model, and the running game shows the seams.**

Two classes of authored ascent, measured live:

- **Onto a PLATFORM deck** (scaffold stagings, clock ledge, cornice, tower
  plinth, meeting ridge): a deck has no solid vertical span, so nothing
  depenetrates. Divergence 0.000m, embed 0.000m, tops out clean. The model
  "works" here only because there is nothing for it to fight.

- **Onto a SOLID mass** (Hollis buttress `D2_OUTSIDE->E_BUTTRESS`, Shambles
  crates `B_CRATES_FOOT->B_CRATES_A`): the spline aims the capsule CENTRE at the
  face (`lip@faceDistanceM`), i.e. a full radius INSIDE the solid. Per-tick
  depenetration holds it out. Captured, buttress climb, BEFORE:

  ```
  t61..t86  rise from y=1.08 to y=2.57, solved.z PINNED at 17.15 (face+skin)
            while sample.z is pulled inward 17.15 -> 16.81  (divergence 0 -> 0.344m)
  t86 -> t87  feet reach topY=2.60; the span stops overlapping; the body POPS
            solved.z 17.15 -> 16.78 in ONE tick (0.37m) onto the ledge.
  ```

  That is a **25-tick pin at a full capsule radius, then a single-tick pop** onto
  the ledge. The animation clip is keyed to the spline (the wrong place, a radius
  inside the wall); the body is held by the solver (the right place, against the
  hull); the two disagree by a radius for the whole climb and reconcile with a
  jerk. This IS the "climb pops / sticks / isn't right" the owner reports, and it
  is structural: depenetrating a spline that aims at the wrong coordinate cannot
  produce a smooth climb, because the correction is discovered only after the
  animation has already committed to being somewhere solid.

**And it is worse than the numbers show, because the numbers are against the
HULL.** The mover never measures the mesh. `scripts/check-world-affordances.mjs`
(on main) already proved hull != mesh across M1 (37/108 affordances have no mesh
under them). Where the visible building mesh differs from the authored hull, the
solver faithfully holds the body against the HULL face — which is inside, or
outside, the wall the player is looking at. No collision-based instrument can see
this, because the hull is self-consistent: my strict, no-ignore embed check
recorded **0 hull embeds** on every authored climb, yet the owner watches himself
pass through solid buildings. The phasing the owner sees is defined against the
mesh, and the mover has no knowledge of the mesh at all.

## Q2. The correct architecture, concretely for this codebase

Mature systems (PhysX CCT `move()`, Avian `move_and_slide`, AC handhold IK,
Overgrowth/Brink cast-to-ledge) all **find the surface first, then constrain the
body to it**. Here that means, in order of load-bearing-ness:

1. **Measure the ledge from real geometry, not type it by hand.** The ascent
   destination (`topY`, `topLanding`, and the climbs.ts literals) must come from
   ray-casting the GLB mesh, not from authored hull tops. The capability now
   exists in-repo (`check-world-affordances.mjs` loads GLB triangles and
   ray-casts). Moved into the asset pipeline it bakes a measured ledge surface
   into the collision data at build time; moved into the runtime it becomes a
   mesh-collision layer the probe queries. **This is out of my lane** (assets/**,
   the pipeline, and climbs.ts/geometry.ts which siblings own) and is the change
   that actually ends "climb through solid building."

2. **Let the solver own the whole climb path, not just XZ.** `stepAuthored`
   should constrain the body TO the measured surface for the entire motion —
   rise tangent to the face, translate onto the top only once the feet clear —
   with all three axes solver-owned, and the spline demoted to an animation
   reference warped onto the solved result (root-warping / IK). Today the vertical
   is pure spline and the horizontal is corrected after the fact; that ordering is
   the fight. This is in my lane (playerMotion.ts) and is the natural stage two.

3. **Author intent, not coordinates.** climbs.ts should reference a measured
   ledge ("climb onto LEDGE_X") rather than typing an `at:[x,y,z]`. Boss-fight
   owns those files right now, so this must be sequenced with them.

## Q3. Where the authored-coordinate model gives way

At the destination. `blocker.topY` / `topLanding` / the `climbs.ts` `at:` literals
are the load-bearing lie: they assert a surface exists at a hand-typed hull
coordinate that the mesh does not honour. Replacing them with a geometry-measured
surface is the change everything else hangs off, and it spans assets/**, the
pipeline, and climbs.ts/geometry.ts — outside this lane. **Owner: this needs
sequencing with boss-fight (climbs.ts) and the asset pipeline.**

## What I changed (stage one, in-lane, measured)

`packages/engine-world/src/parkour/select.ts` — CLIMB_UP/STEP_UP rise anchor
inset from `faceDistanceM` to `faceDistanceM - CAPSULE_RADIUS`, so the spline is
the capsule-CENTRE path the solver would already hold the body on (tangent to the
face) instead of a path a radius inside the solid. The body rises with nothing to
depenetrate and moves onto the landing only once the feet are at the top.

Real-play result (same driver, same seeds), solver-vs-spline divergence:

```
                              BEFORE      AFTER
  D2_OUTSIDE->E_BUTTRESS      0.344m  ->  0.000m   (same ledge, z=15.95)
  B_CRATES_FOOT->B_CRATES_A   0.339m  ->  0.000m   (same ledge, z=-2.85)
  all platform-deck ascents   0.000m  ->  0.000m   (unchanged, still clean)
```

The 25-tick pin and the single-tick pop are gone; the final landing positions are
unchanged. This is the animation aligned to the solver's surface for solid-mass
climbs — as far as the surface-constrained rebuild can be taken WITHOUT measuring
the mesh, which is the out-of-lane remainder above.

## What this does NOT fix (stated plainly)

- The hull != mesh phasing ("through solid buildings"). Needs Q3 (mesh
  measurement), out of lane. I did not reproduce a HULL embed in real play; the
  phasing is mesh-defined, which is exactly why the shipped hull invariant reads
  0/44.
- VAULT/CLIMB_OVER onto solid masses likely have the same face-planted-anchor
  issue in smaller form (feet loft above the top sooner). Candidate for the same
  inset; left until measured in a full route run.
