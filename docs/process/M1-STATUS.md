# M1 status — fixed, open, and what each gate can actually see

The single record of where M1 stands. Updated at every merge into `main`.

**Why this file exists.** Work ran in five parallel lanes across two days and roughly forty
merges. Three regressions reached the owner in one morning, all of them introduced by the
previous night's fixes, because nothing tracked state across the lanes. A green suite is not
a record of what works — several of the bugs below passed every gate while the game was
visibly broken.

**The discipline.** Before merging a lane: run the full gate *and* `PLAYTHROUGH_BASE=<url>
node scripts/check-playthrough.mjs`. After merging: update this file. A fix is not "done"
because a worker reported it — it is done when it is merged, gated, and recorded here.

---

## Fixed and merged

Each of these was reproduced, fixed, and verified in the running game rather than in a
replay harness.

**Traversal and physics**
- Authored climbs wrote position straight onto the body while the collision check excluded
  the climbed surface, so 16 of 44 transitions drove the capsule a full radius into the
  thing being climbed. The solver now owns position every substep. `c31c2b1`
- Climb, vault and climb-over anchors were placed *at* the wall face, but that distance is
  measured centre-to-face — so the spline aimed the capsule a radius inside the obstacle,
  held 0.34 m of divergence for ~25 ticks, then popped the body onto the ledge in one tick.
  Anchors are now inset by the capsule radius. `7d92531`, `2cf2105`
- The scaffold-to-gallery gap **soft-locked permanently**: the edge brake committed 0.75 m
  early, judged a walk-off the body would never take, and bled speed to zero on a jump that
  was always makeable. The brake now defers when the planner confirms a landing. `fd99dc5`
- The Shambles street was impassable: the barrel vault only committed on the exact z=-0.6
  axis while the street's own nodes sit at z=-0.4, so the vault was silently refused and
  climbing the canopies was the only way on. `c31c2b1`

**The route**
- M1 is one guided line. Spawn→elm went from 337 m to 164.5 m against 77.5 m straight
  (ratio 4.35 → 2.12), no backtracking. The tower vista, the ropewalk detour and the Town
  House loop are gone; all three spaces remain authored and reachable.
  `6d7319e`, `d3ff453`, `74c9424`
- Guidance was widening to three lines on any retry. Now pinned to one. `2f6486c`
- The mandatory stamp-scope beat moved off the ropewalk detour onto the roofline, re-cast as
  a printer's bill-sticker — the module's own central exemplar for that concept. `7d5ed19`
- Every climb, vault and leap now names its verb on the take-off; the plate no longer
  recedes while an action is armed. `942c8a9`

**Encounters**
- A resolved guard re-armed when a timed reprieve lapsed. Now a durable per-guard clear,
  lifted only when the player leaves sight range. The "glitchy running" was the same churn
  flipping the locomotion clip and vanished with it. `d587293`
- **Encounter soft-lock:** the trigger's proximity test ignored height, so the roof beat
  armed from the cobbles 8 m below. The speaker could never close, approach locked
  locomotion, and the mission clock drained to PAST DAWN. Triggers now require the beat's
  own surface, and any approach that cannot complete aborts after 16 s. `9f082e7`
- The speaker's approach flipped clips 13 times in 16 frames — his pose updates on 60 Hz
  ticks while clips are chosen from measured per-frame speed. The clip is now declared from
  the machine's state. `9f082e7`

**The duel**
- Grading had **never run** in play. The dev shortcut opened no session and no attempt, the
  verdict POST was refused, and the client paid a full magazine while reporting a slow
  grader. Every playtest before this was ungraded. `c1881b6`, `2482a37`
- The live harness rendered an empty void — a real attempt's world sits at mission
  coordinates while the harness drew an arena at the origin, 90 m away. `648f693`
- All Boston PvE boss fights now enter the shared arena; entering a duel is a transition
  into it. A test pins that every drawn cover prop *is* a blocker. `1798e23`
- The mission boss never took cover — the standalone descriptor opted into the tactics and
  the mission descriptor didn't. Measured 0 cover events before, 11 after. `2c567a8`
- One duel item was bare date recall; it now asks why the town is still free to argue. The
  false-negative gate was already failing at 3.4% over the real classifier, from stale
  hand-labels that credited half-answers. Now 0.0%. `c36c1db`

**World and performance**
- Old Brick drew a 3.6×5.8 m church inside a 16×14 m solid — ~90% of what you collided
  with was empty air. Re-keyed to a mesh that fills its mass: 6% → 73%. `e77ef51`
- The watch post was authored 3.4 m above the church's own roofline, so a guard stood on
  air. Now stands on a drawn belfry. `d166733`
- Movement lurches were **synchronous shader compilation** — a frame blocking 96–118 ms
  linking a material the first time it became visible, past an 83 ms window that discards
  ~10 simulation ticks. Compiled during the settle instead; spawn spikes 3 → 0.
  `1e47247`, `74c432e`
- Street draw calls 177 → 60 via instancing (pixel-identical); crowd geometry 1.7M → 0.44M
  triangles. `324f26c`, `3200cd0`
- The yard stage sat a metre under the duel's plane; hay catches landed on a heaped crown;
  the dock well was marked landable with nothing flat above 0.57 m. `922f2e5`

---

## Open

**Would affect play now**
- **Bare-wall climbs — the ladders are a facade. Do not count this as progress.** Nine are
  authored and drawn (`025ad65`) and the owner found them broken in one screenshot: a ladder
  standing in open air under a deck it never reaches, leaning on nothing, climbed *through*.
  Three defects, all structural:
  - `SceneryPlacement` has only `yaw` — **no pitch** — so a leaning ladder cannot lean.
    Every one is drawn bolt upright.
  - The draw uniformly scales one 1.90 m mesh to each rise (2.3–3.0 m), so rung spacing
    inflates 1.2–1.58× and corresponds to nothing a leg could step on. Height should come
    from more rungs, not bigger ones.
  - They carry no collision by design, so the body climbs the air beside a ghost. The
    reasoning (a solid at a climb foot would block the standing spot) was sound about the
    problem and wrong about the fix: the ladder should stand *beside and leaning over* the
    spot, not occupy it.
  - The asset may be the wrong object outright — described as "a braced leaning ladder,"
    renders as a splayed four-legged trestle.
  Refusal is still off. Asset, placement, lean, collision, animation and refusal are being
  redone as one task, because the owner is right that they only work together.
- **Animations do not match motion.** Vault: planted foot slides 6.8 m/s and pokes 11 cm
  into the obstacle, hands only graze the top. Climb-over: foot 13.5 cm through the wall,
  only 81% of the clip shown. Hang-drop: hand 30 cm inside the wall. Mantle: foot slides
  4 m/s while a *looping* clip plays. Step-up has no clip — it plays the run cycle.
  Landings show 44% (run) and 55% (received) before being cut off. Measured, unfixed.
  *Sequenced after the ladders, since climb paths are changing.*
- **"Cannot run"** — unexplained. Every in-lane mechanism ruled out by two systematic
  passes; the per-leg speed cap is disproven (it releases ~3 m *early*). Needs a location
  or a live capture from the owner.

**Measured, subtler**
- Nine traversal moments at a human threshold: three drops land 1.9–2.2 m on hard cobbles
  as a stride where a body would roll; a 5.2 m tower drop at the roll ceiling; a 3.4 m drop
  onto a 1.6 m beam; a 3.2 m hang-drop to hard ground; two 3.0 m roof-pitch climbs at the
  climb ceiling.
- One moment unverifiable: `D_SROOF_E→D2_ROOF_W` measures 9.78 m horizontally for a 3.8 m
  "drop" — either two roof edges nearly touching or a leap mislabelled. The hull cannot
  distinguish them.
- Rope capstan and cover coils sit 0.64–0.99 m below their cover line. No fit recovers a
  1.05 m capstan from a 0.25 m flat coil; needs a taller asset.
- Five catch targets have acceptance radii reaching past the thing meant to catch you:
  `LEAP_YARD_HAY` (59%), `CATCH_LANE_HAY` (75%), `LEAP_UPPER` (75%), `LEAP_CROWN` (84%),
  `CATCH_PRINTSHOP_HAY` (88%).
- Market stall cover is the *neighbouring awning*; the stall bodies are 0.45 m short.
  Needs a design decision on whether that arrangement is intended.

**Infrastructure and debt**
- Ground support is a point query, so a body can float off a roof edge (audit P4,
  deliberately deferred).
- The motion path is not bit-exact across browsers. 34 of 52 hashed transcendental calls are
  in the movement files (in flight); the other 18 are in the duel's combat and policy code.
  Replay and PvP hash positions to the last ulp with no tolerance.
- PvP still runs a different arena (12×12, 4 cover) from the duel's (11×11, 8 cover). Plan
  written: `docs/process/PvP-Arena-Unification-Plan.md`.
- Residual mid-route frame spikes trace to GPU rasterisation, not compilation — hardware and
  load, not code. Needs the owner's machine to settle magnitude.
- `MissionDuelBrief.world`/`.placement` are assembled but unused. The M1 yard's duel-cover
  props are now purely decorative, including the yard stage fixed on 28 Jul.
- 26 itemised affordance debt entries, gated so the list can shrink but never grow silently.

---

## Regressions, and what now prevents them

All three of 28 Jul's regressions were introduced by the previous night's fixes.

| Regression | Introduced by | Now prevented by |
|---|---|---|
| Duel harness rendered a void | the graded-attempt rewrite | `check-playthrough` duel-void census |
| Encounter soft-lock from a roof | relocating the beat to a roof | same-surface arming + 16 s abort |
| Boss ignored all cover | arena swap exposing a missing opt-in | parity assertions in `missionDuel.test.ts` |
| Ladders drawn floating, upright, ghosted | the ladder placement itself | *nothing yet — see Open* |

**A fourth failure, and it was mine.** The ladder work was merged on a worker's report of
"flush to the face and reaching each surface," supported by brightened screenshots — three of
which the worker itself described as too cramped to read. I merged anyway. The owner found
the defect in one frame. **A screenshot that does not plainly show the thing being claimed is
a failed check, not a caption to write around**, and a green gate beside an illegible capture
is worth nothing. Every asset or placement claim from here needs a frame where the contact
is visible at a brightness where geometry is legible.

**The pattern behind all three:** a dev, harness or standalone path was correct while the
real path it mirrored had drifted. The owner's entire boss-fight playtesting history ran
inside a harness that didn't grade, in the wrong arena, against a boss that ignored cover —
and nothing failed. A dev path that differs from the real path in a load-bearing way is
worse than no dev path, because it produces confident false results.

All fourteen dual-path surfaces were swept (`afe8717`). Eleven agree; two differ
legitimately and say so loudly (the scripted verdict harness, dev sessions). The two that
were load-bearing and unguarded are now pinned: the standalone-vs-mission boss profile
must match field-for-field in the same arena, and the server's transcribed module gate must
equal the authored deck in order. The harness's third hand-copy of that deck is deleted
rather than pinned. Still divergent and deliberately deferred: PvP runs its own arena
(`docs/process/PvP-Arena-Unification-Plan.md`).

---

## What each gate can and cannot see

Read this before concluding a green run means the game is correct.

| Gate | Sees | Blind to |
|---|---|---|
| `lint`, `typecheck`, `build`, ~2,712 tests | logic, types, contracts | anything about the rendered game |
| `verify:content` | authored content against its own contracts | geometry, rendering, feel |
| `assets:verify:collision` | a collision solid that isn't drawn (invisible walls) | whether a surface exists at an authored height |
| `assets:verify:placement` | route surfaces having their asset's shape | non-route geometry |
| `assets:verify:affordances` | real mesh geometry at each authored affordance | whether a human could make the move |
| `check-playthrough` | world renders, route advances, stops resolve, no hang, no hull penetration | climbing through *drawn* geometry, animation fidelity |
| `check-clip-fidelity` | hands/feet vs surfaces, plant slide, clip timing | not yet a gate — red by construction |

**The gap that cost the most:** every collision gate reads authored hulls. The mover has
never touched a GLB. So a body can be provably outside every hull while visibly inside a
building — which is why "0 of 44 transitions phase" was true and useless at the same time.
