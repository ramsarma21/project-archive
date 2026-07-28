# Ladder climb-through + refusal + "cannot run" — report (workflow/mission-world)

Branch `workflow/mission-world` (merged `main`, fast-forward). Servers on 5273
(mine); main's 5173/3001 untouched. Evidence = real client (floor.html harness)
+ window.__diag, driven by Playwright. Replay harness / shipped invariants NOT
used as evidence.

Lane: engine-world/{parkour/*,playerMotion,collision}.ts + mission-m1/level/
climbs.ts. NOT mine: geometry.ts, assets.ts, assets/** (mission-flow);
encounters/*, opposition.ts (mission-encounters); and shared infra
types.ts/authoring.ts/compile.ts/route.ts.

---

## 1. The climb-through mechanism (ladder + forced-through are ONE bug)

Real play, per-tick (mw-climb-angles.mjs: 6 authored climbs x 5 approach angles;
mw-tick.mjs; inspect-climbs-world.mjs on the compiled world):

- **The collision solver is CLEAN.** After last night's tangent-rise inset,
  spline-vs-solver divergence ~0 and low-ignore embed ~0 on EVERY authored climb,
  head-on and off-axis. The body is NOT inside the collision hull during a climb.
- **Almost every authored climb tops onto a PLATFORM (a thin plane), and most
  sit above EMPTY collision space** (`masses under centre: none` for the scaffold
  stages, clock ledge, cornice, tower plinth, elm crown; only a shorter blocker
  under the meeting-house and buttress). So the rise is a straight-up column with
  nothing solid in it — the solver is happy — while the VISIBLE building/scaffold/
  tree art occupies that column. The player watches his body rise straight up
  THROUGH the building. That is the "forced straight up and through."
- **Off-axis fails as a MISFIRE, not a deep embed.** The top-out landing is
  projected along the approach heading (`readOverhead`: `pointAt(origin,dirX,dirZ,
  inset)`), so an off-axis approach lands the top-out off the deck: measured
  E_RIDGE->E_LOUVRE rose +3.76m head-on but became a -3m HANG_DROP at +/-30deg;
  F_LOW->F_CROWN fell -6.4m into the street at 70deg. That is "from any other
  angle it goes through the ceiling."
- **"Forced" = the guided gateway.** traversal.ts hands the reader a gateway axis
  + allowedVerbs for a committed climb leg, so the probe is forced onto the
  authored axis and CLIMB_UP is driven — up the empty column, through the art.

So the ladder phasing and the roof-walk forced-through are the SAME mechanism:
**bare authored vertical ascents up collision-empty columns beneath visible art,
armed permissively and topped-out along the approach heading.** The second
report's site is the meeting-house roof-walk: D_MEETING_ROOF (76.5,8.2,9.0) on
HOLLIS_MEETING__ROOF (the shingled roof), climbing MEETING_RIDGE (y=11.2) with
the ridge monitor as the "plank wall" and ELLIOT_HOUSE clapboard ahead — matches
the screenshot exactly.

**This is precisely the class the owner's ladder rule removes:** a visible ladder
gives a defined OUTER FACE the body hugs, clear of the wall, so it is never inside
the building; and arming becomes "is there a ladder with a clear top," decidable
from the object.

## 2. Verdict on the ladder rule: it holds, and it eliminates the class

Making ladders the canonical climb affordance does NOT relocate the bug, it
removes it, because it changes the arming question from a swept-geometry judgement
(which produced last night's false positives) into an object query:

- **Arming** becomes: is a ladder aligned here, and does its top have standing
  clearance? Cheap, decidable, impossible to get subtly wrong the way a
  spline-residual test was. A ladder into a ceiling cannot arm — forced-through
  dies at the source.
- **The ascent** derives base/top/outward-face from the object, so the body rides
  the OUTER FACE (a radius out along the face normal) from ANY heading — the
  angle dependence is gone by construction, not patched per-approach.
- **Visual correctness** ("on the rungs, not levitating") follows from the rise
  line being the ladder's own outer face, offset a capsule radius so hands/feet
  read on the rungs and the body is never inside them.

Confirmed limitation, load-bearing for the spec: **the outer-face direction is
NOT derivable from the current authored climb volume.** The volumes are centered
under their destination (foot ~= platform centroid), so "which side" is ambiguous
(see spec-ladders.mjs: SCAFFOLD/CLOCK/CORNICE/TOWER all resolve to a centroid the
foot sits on). The face MUST come from the placed ladder object. This is exactly
why the placement spec is mandatory rather than optional.

## 3. What landed this pass (in-lane, gate green)

`packages/engine-world/src/collision.ts` (additive, pure, tested):
- `LadderSpec` — the self-describing affordance: base, topY, outward face (XZ),
  toSurface, width, rung spacing.
- `alignClimbToLadder(world, ladder)` — THE ARMING PREDICATE ("no ladder / no
  clear top / no known surface => no climb") and the ascent path: rise held a
  capsule radius OUT along the face normal (tangent to the rungs, from any
  heading), top-out stepped inward two radii onto the served surface, refused
  when the top-out has no standing clearance (the ceiling check that kills
  forced-through) or names no real surface.
- `surfaceRectById`, `surfaceInteriorDir` — read a surface off its footprint.
- Test `__tests__/ladderAlignment.test.ts` (5): arms on a clear top riding the
  outer face; path is heading-independent (pure fn, no probe input); refuses into
  a ceiling; refuses onto no surface; footprint reads.

I also tried a geometry-derived top-out in `readOverhead` to fix the off-axis
misfire without a ladder. It REGRESSED the full route: the shifted louvre-sill
landing broke the downstream leap-of-faith into the elm crown, so the SAFE run
stopped reaching the duel (apps/web missionElmContinuation). **Reverted** — a
movement change that breaks a shipped invariant is reverted, per standard.

## 4. What is staged (needs the geometry / infra lanes)

The behavioral rule ("no ladder, no climb" live in play) CANNOT land in my lane
alone without breaking the route/objective, because there are no ladders in the
world yet and refusing the current climbs makes the objective unreachable
(exactly the failure climbs.ts's own header warns about; ladderOffers/route/
wayfind/safeRun would go red). Sequencing required:

1. **mission-flow (geometry.ts + assets.ts):** place a ladder GLB per the spec
   below, aligned to each climb volume's base/top/face.
2. **infra (compile.ts + types.ts/authoring.ts):** forward a ladder record
   (face + width + rungGap) from the ClimbSpec into `world.ladders`/onto the
   ClimbVolume, so `alignClimbToLadder` can consume it. One field-forwarding
   change; I can supply the exact diff.
3. **my lane, then:** wire `alignClimbToLadder` into readOverhead/planVerb so the
   authored ascents rise up the ladder face and refuse without one; retire the
   inferred bare-face CLIMB_UP (mantle band) so a climb only ever comes off a
   ladder or a solid-face grip. Re-run fatal scan + full gate.

## 5. Placement spec (MANDATORY) — one ladder per route climb-up

Base = climb-volume foot. topY = served surface height. outwardFace = the
horizontal normal the ladder faces (toward the climber); values below are the
centroid->foot direction where the volume is off-centre, and marked AMBIGUOUS
where the foot sits on the centroid (there the lane must set the face from the
route's approach — noted per row). Ladder height ~= rise + 0.3m headrail.

| climb (foot node) | base (x,y,z) | onto [kind] topY | rise | outward face | note |
|---|---|---|---|---|---|
| C_SCAFF_FOOT->C_SCAFF_1 | 44.8,0,-6.4 | SCAFFOLD_D1 [plat] 2.9 | 2.9 | (0,-1) -Z | mason's scaffold S bay; a scaffold ladder reads perfectly |
| C_SCAFF_1->C_SCAFF_2 | 44.8,2.9,-6.4 | SCAFFOLD_D2 [plat] 5.6 | 2.7 | (0,-1) -Z | second stage, same bay; stack the ladder |
| C_GALLERY_EMID->C_CLOCK | 58.3,5.6,-4.0 | CLOCK_LEDGE [plat] 7.9 | 2.3 | (0,-1) -Z | under the clock ledge N edge |
| C_CLOCK->C_CORNICE_E | 58.3,7.9,0 | CORNICE_E [plat] 10.2 | 2.3 | (0,-1) -Z | deepest-set climb; ladder up the tower face |
| C_LEADS_TOWERFOOT->C_TOWER_PLINTH | 52.0,12.4,2.9 | TOWER_PLINTH [plat] 15.2 | 2.8 | (0,+1) +Z | on the leads; against the plinth |
| D2_OUTSIDE->E_BUTTRESS | 75.4,0,17.4 | HOLLIS_BUTTRESS [solid] 2.6 | 2.6 | (0,+1) +Z | SOLID buttress = a real face; grips/set-offs may suffice instead of a ladder |
| E_BUTTRESS->E_LEANTO | 75.4,2.6,16.2 | HOLLIS_LEANTO [plat] 5.2 | 2.6 | (-0.24,0.97) ~+Z | buttress top to lean-to roof |
| D_MEETING_ROOF->E_RIDGE | 76.5,8.2,9.0 | MEETING_RIDGE [plat] 11.2 | 3.0 | (-1,0) -X | THE ROOF-WALK SITE; ladder up the monitor's W face |
| E_GAMBREL_S->E_RIDGE_W | 78.0,8.2,10.2 | MEETING_RIDGE [plat] 11.2 | 3.0 | (-0.86,0.51) | same ridge from the S slope |
| E_RIDGE->E_LOUVRE | 79.5,11.2,8.6 | LOUVRE_SILL [plat] 14.0 | 2.8 | (-0.45,-0.89) | onto the louvre sill under the belfry |
| F_LOW->F_CROWN | 79.0,6.4,2.6 | BOUGH_CROWN [plat] 8.3 | 1.9 | (-0.74,0.67) | the LIBERTY ELM — a ladder makes no sense; see retire list |

Ambiguous faces to set from route approach: C_SCAFF (both), C_GALLERY_EMID,
C_CLOCK, C_LEADS_TOWERFOOT, D2_OUTSIDE — the foot sits under the destination
centroid, so the (0,±1) values above are the platform's nearest-edge direction
and should be confirmed against the authored approach in route.ts.

## 6. Climbs I'd RETIRE rather than bend the rule

- **F_LOW->F_CROWN (Liberty Elm):** a ladder up a tree crown is nonsense. Either
  (a) make the elm ascent a set of branch GRIPS/boughs (visible holds, same
  predicate: face + top clearance), or (b) retire the mid-crown climb and reach
  the crown by the authored bough-to-bough leaps only. Recommend (a).
- **D2_OUTSIDE->E_BUTTRESS:** onto a SOLID buttress with a real face — a masonry
  set-off / grips read better than a bolted ladder; keep as a grip-climb, not a
  ladder, under the same predicate.
- Everything else has a sensible ladder (scaffold, tower faces, roof monitor,
  lean-to, louvre) — keep, with the placements above.

## 7. Enforceable gate (proposal; machinery exists)

The repo has three blocking world gates and check-world-affordances.mjs that
loads GLB triangles. Add a fourth check (or extend affordances):
`check-world-ladders` — for every climb affordance (climb volume) on the guided
route, assert `alignClimbToLadder` resolves against a placed ladder GLB whose
base/top/face match the volume within tolerance, and whose top-out passes the
clearance check. Fails when a climb has no aligned ladder. The predicate is
already the tested `alignClimbToLadder`; the gate is a thin loader + loop over
world.ladders vs world.climbVolumes. (Lives under scripts/ + assets/pipeline,
which are not my lane — proposing; I can supply the check body.)

## 8. "Cannot run" — NOT reproduced by automated real play; ruled out

mw-cannot-run.mjs drove the guided route (aim at the wayfinder waypoint, hold
W+Shift, jump on preview, answer encounters) and flagged every sustained
grounded-and-held-forward stretch under run speed, attributing a cause from
runtime state. Result: the only slow stretches were POSITIONAL STALLS (body
wedged, moved <0.15m — the crude autopilot getting stuck on geometry), NOT speed
clamps. In those stretches: no authored leg cap active, no latched edge brake
(flow.brakeDirX null), no stuck crouch (capsule at stand height), no verb
cooldown. So none of the candidate clamps fired.

Ruled out (code + play):
- **EDGE_BRAKE latch never clears:** flow.ts now REVALIDATES the persisted hazard
  every tick (predictCommittedWalkOff + stillToward) and releases it when the
  intent turns away or the committed drop is no longer fatal. A latch that should
  not hold does not.
- **Stuck crouch / armed action / cooldown:** none observed holding speed down.

Most likely remaining mechanism to investigate next (OUT OF MY LANE): the
authored per-leg speed cap (`speedCapMps`, traversal.ts + the wayfinder) that
"only lowers" pace on a committed leg — if a leg fails to RETIRE, the cap
persists and the player "cannot run" until the next leg commits. That is a
wayfinder/traversal concern, not engine-world. I could not reproduce it with the
autopilot because it never reached those legs cleanly. Labeling this UNVERIFIED.

## Change set (this pass, on workflow/mission-world)
Tracked edits:
- packages/engine-world/src/collision.ts  (LadderSpec, alignClimbToLadder,
  surfaceRectById, surfaceInteriorDir)
- packages/engine-world/src/__tests__/ladderAlignment.test.ts  (new, 5 tests)
- packages/engine-world/src/parkour/probe.ts  (net-zero: top-out change added
  then reverted)
Untracked evidence (.affordwork/): mw-climb-angles.mjs (+out), mw-cannot-run.mjs
(+out), inspect-climbs-world.mjs, spec-ladders.mjs, mw-smoke.mjs, mw-tick.mjs,
this report.

Gate: lint OK, typecheck OK, build OK (no EPERM), test 2707 total / 0 failing
(baseline 2702 + 5 new), verify:content / assets:verify:{collision,placement,
affordances} OK, fatal-traversal fatal=0 before and after.
