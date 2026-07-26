# M1 — The Effigy Run

Boston, 14 August 1765. Overnight the Loyal Nine hung an effigy of Andrew
Oliver, the newly appointed stamp distributor, in the great elm at the corner of
Essex and Orange Streets, with a jackboot and a devil beside it. The sheriff was
ordered to cut it down and did not dare. You are Edes & Gill's runner, carrying
unstamped handbills, and you have three minutes to get one onto the tree before
the constable reaches the board.

The spine is the real high street of the peninsula — Cornhill becoming
Marlborough becoming Newbury becoming Orange — compressed roughly fifteen to one
into eighty-eight metres. The buildings, their order along the road and their
relative heights are real. The distances between them are not, and that
compression is the only liberty taken with the geography.

## The seven sections, and the verb each is built around

| | Section | Verb | What it is |
|---|---|---|---|
| A | Off the leads | chained drop | Open on a roof. The tutorial is the descent, and the speed you carry off the lip picks which tier catches you |
| B | The shambles | vault + slide | Three heights threaded through 0.9m slots between stalls |
| B2 | Dock Square | blend + light | Street level, among people. Nothing above the square goes anywhere, so the choice is the throng or the dark arcade |
| C | The Town House | climb + reflex | A building standing in the middle of the road. Round it by the south lane or across the open square, then spiral it twice to the tower |
| D | The Orange Street roofline | leap | Everything from here is downhill; crossing the street costs 5.3m of height |
| D2 | Through the ropewalk | slide + climb-over | An interior. Tie beam in the dark, then slides and partitions, and no sky |
| E | The leap of faith | sustained climb, then dive | Six holds up the meeting house's south face, then off the steeple into the crown of the elm |
| F | Nailed to the tree | precision | Six hammer strokes, eight metres up, beside the effigy |
| G | The rope-walk yard | — | Twelve by thirteen metres of walled yard; six honest line-of-sight breaks |

## How this package is organised

```
src/envelope.ts       re-exports MOVEMENT_CAPABILITIES plus this level's own
                      authoring policies. No movement number is restated here.
src/types.ts          the authoring format. M1 is content; this is the schema.
src/authoring.ts      structure(), prop(), deck(), soffit(), rampStrips()
src/level/            the authored content: geometry, route, opposition, arena
src/compile.ts        level data -> engine-world CollisionWorld
src/traversal.ts      verification by running the shipped systems
src/routeGraph.ts     connectivity and time cost
src/stealth.ts        patrol poses and audibility against the stealth field
src/pacing.ts         the budget, computed from the verified route
src/assets.ts         every art key, with the dimensions the collision assumes
```

Run `pnpm --filter @pa/mission-m1 level:report` for the full per-link audit.

## The rules the geometry obeys

**One collision representation.** Everything compiles to `Blocker` and
`Platform` from `@pa/engine-world/collision`. Every query in this package —
traversability, sight lines, cover, the duel's breaks — runs against the same
`CollisionWorld` the player moves through.

**The jetty rule.** Every roof deck oversails the mass beneath it by at least a
capsule radius. A deck flush with its own wall embeds the player the instant a
fall takes the foot below the wall top. It is also how the city was built.

**The crossing grammar.** Alleys are 4.0m, which is a 2.6m roof gap and a free
leap either way. The street is 6.4m, which is 5.0m and only crossable downhill
or by plank. Squares have no crossing at all: go down and come up. Three widths,
three answers, learnable in the first thirty seconds.

**The height vocabulary.** Every walkable surface snaps to a band in
`envelope.ts BAND`, so altitude is readable at a glance and the legal moves
between bands are a small set.

## Reconciliation against the shipped envelope

The level was first authored against derivations of the raw physics constants,
before `packages/engine-world/src/parkour` existed. What changed when the real
envelope landed:

| | Assumed | Shipped | Consequence |
|---|---|---|---|
| Flat gap budget | 3.24m (own derivation) | 3.30m | No change needed; the widest authored flat gap is 2.8m |
| Takeoff setback | 0.30m guess | 0.427m derived | Now imported, not estimated |
| Step up | 0.06m (`SUPPORT_SNAP_UP`) | 0.50m (`STEP_UP` verb) | Ramp strips went from 31 to 6; curbs cost nothing |
| Mantle | disabled, banned from safe lines | 1.90m, top ≥ 0.75m | Available to everyone at Level 0 |
| Run off an edge | unbounded | brake above 5.5m | The 6.4m drop out of the elm was a dead stop; it is now two hang drops through a stall awning |
| Leap of faith | any big drop into a catch | drop ≥ 6.0m into a declared 1.6m target | The 1.8m "leap" off Elliot's gambrel was reclassified a jump; the yard dive gained a fodder wain to land in |
| Narrow ledges | unchecked | tops under 0.75m are not standable | Two steeple rings widened |
| Noise | not modelled | landings 0.2/0.5/0.95, radius × 14 | Became the main lever pricing the fast lines |

## The three-minute budget, for two different players

Computed by `pacing.ts` from the verified route, not asserted:

```
A_LEADS      budget  22s   safe  8.0s   24m
B_SHAMBLES   budget  26s   safe 11.4s   46m
B2_THRONG    budget  32s   safe 17.4s   44m
C_ASCENT     budget  40s   safe 24.5s   86m
D_ROOFLINE   budget  12s   safe  4.5s   25m
D2_ROPEWALK  budget  30s   safe 15.8s   55m
E_LEAP       budget  18s   safe  7.0s   19m
F_TREE       budget  18s   safe  7.1s   20m
TOTAL        budget 198s   safe 104.7s 322m

optimal line   59.4s   every shortcut, full sprint, no mistakes
competent     167.9s   the same route, costed with shipped constants
mission clock 180.0s   -> 12.1s still owed, or 93% of the clock
```

The competent figure is at its target. **The optimal line is not**: 59.4s is a third
of the clock, and it is the largest remaining gap between what this mission claims
and what it is. It is not a density problem — decision density measures 7.8 per ten
seconds and the longest decision-free stretch is under five — it is that the fast
lines skip whole sections. The two that matter are `D_SROOF_E -> D_MEETING_ROOF`,
which goes over the ropewalk and abandons twenty-two nodes, the only `SLIDE` and the
mission's best flow chain; and the north-roof line, which reaches the elm without
the meeting house's south face. Either price them or close them, but not both of
them and the clock.

The competent figure is not a fudge factor. It is the safe spine with the
parkour system's own `coldExitSpeedFraction` applied to running, its
`slowEntryDurationMultiplier` applied to authored verbs, three reflex windows of
held world time at `reflexWindowTicks / FIELD_TICK_HZ` each, and a per-section
reroute allowance declared on `SectionSpec.rerouteBudgetS`. A test asserts that
every section containing a patrol has one, because being read has to cost
something.

## The crowd floor

Measured in `crowd.test.ts`, not read off the source, because the count is a
rendering cost and the answer decides whether the feature ships.

**The mechanical floor is four bodies, and it is a cliff.** `density` appears in
exactly one line of the stealth field — the gate in `clusterContaining`. Three
bodies hide nobody at all; four produce a complete break; a hundred produce
exactly the same complete break. Blend strength is `insideTicks / enterTicks`
and nothing else, and radius does not affect it either.

So the count buys nothing above four, and the level authors twelve —
`CROWD_CIVILIANS` in `opposition.ts`, one number in one place — purely as
headroom so an art cut for frame time cannot silently switch the verb off.

What must NOT shrink is `radiusM`. It is the distance over which the blend
holds, it costs nothing to render, and entering a *different* cluster resets the
0.7s ramp — so two small crowds are strictly worse than one large one. That is
why Dock Square is authored as a single 6.4m cluster rather than a chain of
knots, and there is a test for it.

## Hard cover, and the two numbers it turns on

`visibility` owns `coverFactor` (0.3). What a level owns is where there is
something to press against, and the honest measure of that is not "is a blocker
nearby" but: over a whole patrol cycle, restricted to the ticks a node is visible
at all, does `covered` fire and what does it take off the read.

Measured that way, cover used to fire at **no** node in the mission where the
player was visible. Everything either screened nothing or screened the chest ray
too — and a blocked chest ray is already worth zero, so cover was reporting a
break the field had already found. Two authored numbers fix it, and both are
bounded on both sides rather than chosen:

**1.55m for the screens on the Town House balcony and the scaffold staging.** The
tower watch is eight metres above them, so his sightline comes down at 47 degrees
and a screen has to be tall relative to that — which is why the shipped 1.15m
balustrade does nothing, and why `crouching behind the rail does not work` is a
test rather than a comment. At 1.55m, standing behind the masons' stock is worth
0.15 of a read against 0.51 in the open. At 1.90m the standing case goes to zero
too and cover stops being a state *between* exposed and hidden.

**1.10m for the tar barrels in the ropewalk.** The night man stands on the floor
rather than above it, so here height separates the two stances instead of deleting
them both: the crouched chest is behind 1.10m and the standing chest is not.
`D2_OVER_OUT` is read for 79% of his cycle — the largest single exposure in the
mission — and goes 0.244 -> 0.073 standing, or to a complete break crouched. At
0.95m nothing fires; at 1.25m the standing read goes to zero as well.

Two consequences worth knowing. Cover is a *static* property against a POSTED
watcher, because only his facing sweeps and the geometry between you does not — so
it comes and goes for patrols and never for sentries. And a screen can be too
strong: full width, the scaffold boards also stood in the tower's line down to the
lower staging and took that rung's exposure from 24% of his cycle to nothing, so
they stop 0.7m short of the standard.

## What is verified, and how

`src/__tests__` runs the shipped systems rather than re-deriving them:

- every ballistic link through `simulateBallistic`
- every dive through `solveLeapOfFaith`, including which target the solver picks
- every affordance through `beginAuthored`
- every gap against `levelDesignMaxGapM(drop)`
- every cone against `visibility`
- every noise event against `noiseAudibility`
- every duel break against `segmentClear`

`envelope.test.ts` exists to make hand-copied numbers impossible: it recomputes
the published budget from `RUN_SPEED`, `GRAVITY` and `RUNNING_JUMP_VY` and fails
if `MOVEMENT_CAPABILITIES` has drifted from them.

## What the art agent owes this level

Four keys, listed with dimensions and rationale in `src/assets.ts`. The one that
matters is `bldg-townhouse-1713`: a balcony at 5.6m with a pedimented centre bay
whose soffit sits at 7.30m, a clock ledge at 8.4m, a cornice walk at 10.2m, leads
at 12.4m and a tower gallery at 17.6m. Seven route nodes stand on those ledges.
`bldg-townhouse-civic.glb` is the nearest existing thing and has none of them, so
it is not a substitute.

**A declared `sizeM` is not decoration.** `drawBox` takes an object's plan centre
from the union of its solids and its SIZE from that field, and a contain-fit then
shrinks the mesh by the smallest of three ratios. The steeple shipped declared at
4m across against a mesh whose louvre course reaches 3.7m from the draw axis: the
fit came out at 0.54 and every authored ring drew 8.91m below its collision, so
the ledge the six-hold climb arrives on had no stone under it. A box narrower than
the rings it carries cannot be fixed by any mesh, because the mesh is what is being
shrunk. Both remaining hull declarations have been re-derived from the geometry
rather than eyeballed.

**The steeple's climb geometry has changed and the mesh has not.**
`assets/pipeline/verify_m1_steeple.mjs` currently fails, and every failure says the
same thing: the shipped GLB has its stone at the old ring heights. It needs
`export -> build -> verify` to regenerate from the numbers now in `assets.ts` and
`geometry.ts` — one broad gallery, a 1.2m lantern with a 2.8m cornice on it at
18.2m, the weathervane balcony at 20.6m and a spire to 22.2m.

## Assumptions still to be checked in play

- The mission clock treats reflex time at world-time cost, not wall-clock.
- Blend strength is authored per volume; the crowd density needed to reach it
  has not been tested against a real crowd renderer.
- The precision beat is the only non-locomotive interval, at 17.5s. If it wants
  to be shorter the level gets further from its clock, not closer.
