# M1 Fun Audit — "The Effigy Run" against its reference games

Design analysis only. No source was changed. Every number below is measured
against the shipped code on the date of writing, not read off a comment.

**Method.** `packages/mission-m1/src/report.ts` for link verification and node
placement; the shipped `verifyLink` durations (derived from `simulateBallistic`,
`beginAuthored` and `solveLeapOfFaith`) for all timing; `visibility` from
`@pa/engine-world/stealth` sampled over 45-second patrol cycles at 10 Hz for
exposure; `coverAgainst` for hard cover; `solveThrow`/`previewThrow` for the
throw; `runDuel` over eight seeds against `bossProfileForTier(1)` for the duel;
`deriveChart` over 400 seeds for the beat.

---

## 0. The measurement I could not make, and why the caveat understates it

The brief says the SAFE route graph is broken. It is worse than that: **no line
reaches the objective.** With verification required, `cheapestPath` returns null
for SAFE, for SAFE+FAST and for ALL.

```
SAFE       reaches  40/137 nodes    post=false  arena=false
SAFE+FAST  reaches  48/137 nodes    post=false  arena=false
ALL        reaches  49/137 nodes    post=false  arena=false
```

Reachability dies at Dock Square. Sections C, D, D2, E, F and G are at 0/26,
0/12, 0/22, 0/12, 0/7 and 0/3 nodes reached. Section 1 of the prioritised list
gives the cause and the repair, which is small.

**What I did instead.** I waived verification, dropped the three links that point
at nodes which do not exist, and walked the resulting authored spine with the
verifier's own per-link durations. Every link on that spine has a measured
duration from the shipped physics. Four of them currently fail on a body-fit
check rather than on timing, so their durations are still trustworthy. Where a
number depends on geometry that does not exist, I say so rather than inventing
it.

Two consequences for what follows:

- I can state traversal time, chain flow, exposure, decision density and the
  duel with confidence.
- I cannot state anything about the SAFE line through the ropewalk, because
  `D2_FLOOR_E` and `D2_STAGE_E` are referenced by three links and defined
  nowhere. That is three links and one section of the mission I have no route
  for. I have not guessed their positions.

---

## 1. Hypothesis 1 — the osu pillar is vestigial. **Confirmed, and worse than stated.**

Measured:

| Quantity | Value |
|---|---|
| Precision beats in the mission | 1 |
| Judged strokes per beat | 5 (6 strikes, the first is un-judged) |
| Chart span, 400 seeds | 1.60 s – 3.00 s, mean 2.26 s |
| Worst-case cost to the clock | 3.65 s |
| Share of the 180 s clock | 2.0 % |
| Share of the measured optimal run (65.1 s) | 5.6 % |
| **Judged presses in the mission's entire three-attempt lifetime** | **15** |

Fifteen timed inputs, ever. osu's pleasure is a skill you return to, and there is
nothing here to return to: a player cannot get better at a thing they do five
times and then never again. The mechanic itself is excellent — `FLUSH` is two
ticks (33 ms, about OD8 hit-300), `TRUE` is 83 ms, `GLANCING` is 150 ms, the
ladder nests, and a FLUSH stroke is provably inaudible to the stealth field. The
ceiling is real. There is simply almost no surface to climb it on.

A second measurement makes it thinner still. The beat's authored tension is "when
do you start it, with the constable coming up Orange Street underneath."
`CONSTABLE_ORANGE` walks 23.1 m out and back at 1.55 m/s, a 29.8-second cycle,
and `F_POST` is visible to him for **18 % of it — about 5.3 seconds.** So the
player has a 24-second blind window in which to place a 2.3-second chart. The
window is eight times the beat. "Choose your moment" is not currently a
constraint; it is a formality.

### What would fix it, and what each costs the pacing budget

The mission has room. Optimal traversal is 53.7 s and the clock is 180 s
(section 3), so beats are close to free in clock terms.

1. **Lengthen the existing chart to 10–12 strikes.** Cost: +1.6 to +2.4 s worst
   case. Buys 9–11 judged strokes instead of 5, doubling the sample the player
   learns from. Cheapest possible change: one number in `M1_HANDBILL_CHART`.
   Do this first regardless of the rest.
2. **Put a beat on an action that already exists.** Three candidates that need no
   new geometry, only a beat mount:
   - `A_SHEETS` — pulling the sheets off the drying rack. Currently a
     free pass-through with a 3.0 s opening cost already reserved. A 3-strike
     chart fits inside that reservation at zero net cost, and it teaches the verb
     eight seconds into the mission instead of at 2:50.
   - `B_DUCK → B_STREET_MID` — the slide under the hoist frame. 0.55 s of
     authored action; a 2-strike chart is +0.4 s.
   - `E_GALLERY → F_CROWN` — the leap of faith. A 1-strike "release on the beat"
     is +0.15 s and makes the signature move a skill check rather than a
     cutscene.
   Total for all three: **≈ +1 s** against 115 s of unspent clock.
3. **Narrow the constable's blind window at the post** so the 24-second gap
   becomes 6–8 seconds. Add a second walker crossing `x≈80` on a shorter cycle,
   or shorten `CONSTABLE_ORANGE`'s waypoint span. This costs no clock at all and
   turns the existing beat from formality into pressure. Highest ratio of the
   three.

**What to cut:** nothing here. The beat is under-used, not mis-built.

---

## 2. Hypothesis 2 — the duel breaks its own rhythm. **Refuted as stated. A different, real problem is underneath it.**

The premise is that rounds run three to nine, so the climax stops eight times for
typing. Measured against M1's actual boss (`bossProfileForTier(1)`), eight seeds:

| Player model | All answers | Rounds (mean) | Range | Live engagement |
|---|---|---|---|---|
| Reference (near-perfect) | WRONG | 4.5 | 3–7 | 72.9 s |
| Reference | CORRECT | 2.6 | 2–5 | 39.8 s |
| **Sloppy (models a student)** | **WRONG** | **3.5** | **3–5** | 54.3 s |
| **Sloppy** | **CORRECT** | **2.1** | **2–3** | 28.9 s |
| Passive (never fires) | either | 9.5 | 6–13 | 175.8 s |
| PvP mirror, A correct vs B wrong | — | 3.0 | 3–3 | 41.4 s |

**A real M1 duel is two to four rounds, not eight.** The nine-round case exists
only for a player who never pulls the trigger, and that player also loses 0/8.
So the "climax that stops eight times" is not what ships.

Two things the premise pointed at are nonetheless true.

**The ratio is stop-heavy even at three rounds.** Assuming 20 seconds for a
thirteen-year-old to type a free-response history answer:

```
sloppy / all WRONG    total 150 s   play 36 %   typing 47 %   longest unbroken play 20 s
sloppy / all CORRECT  total  91 s   play 32 %   typing 47 %   longest unbroken play 20 s
```

Typing is roughly half the duel at every round count, because it scales with
rounds exactly as play does. And **the longest unbroken stretch of play is 20
seconds, always** — that is structural, not a consequence of round count. A boss
fight whose longest continuous action is 20 seconds is not a boss fight by the
standard of any of the reference games. Add the 3-second resume countdown and the
1.5-second line-of-sight break and each round is 24.5 s of wall clock around 20 s
of play, before a word is typed.

**The knowledgeable player is punished with a shorter climax.** This is the
finding I did not expect. A student who knows the answers gets a **2.1-round**
duel: 29 seconds of shooting, two questions, done in about 90 seconds including
typing. The 2:1 economy is so decisive against a tier-1 boss that knowing the
history deletes the fight. Meanwhile the student who answers wrong gets more
rounds — so **more typing and more return fire.** The format currently punishes
weakness twice and rewards knowledge by removing the reward.

### Fixes that keep knowledge decisive

Ranked by fun-per-work. None of these touches the round loop, which is sound.

1. **Raise M1's boss to tier 2 or 3, or raise `BOSS_BASE_HEALTH` for tier 1
   only.** Tier 1 currently falls in 2.1 rounds to a student who knows the
   answers. Target 4 rounds on correct and 6 on wrong. This is one number and it
   is the whole of the problem for M1. `winnability.test.ts` already measures
   the consequence.
2. **Ask the question once, not every round.** The strongest structural change
   available and it costs one branch in `openNextRoundOrResolve`: ask on rounds
   1, 3, 5 — so a correct answer buys the magazine for *two* rounds. Halves the
   typing without halving the knowledge coupling, and gives a 40-second unbroken
   play window, which is the number that decides whether the fight reads as a
   fight. The fiction survives: he reloads every 20 s, he only talks every other
   time.
3. **Bank the answer before the duel, spend it during.** Ask all questions in the
   face-off (which is already 10 s of dead time), then the fight never stops.
   Biggest fun win, biggest work, and it weakens the "each round is a new
   question" fiction. Worth costing.
4. **Do not shorten the engagement window to compensate.** `DODGE_COOLDOWN_SECONDS`
   is 2.0 s and `FIRE_INTERVAL_SECONDS` is 1.0 s; a 20-second round is already
   only 10 dodge windows and 20 shots. Shorter rounds would make the aim ceiling
   unreachable.

**What to cut:** the 3-second `RESUME_COUNTDOWN_SECONDS` in PvE. It exists so PvP
can resynchronise two clients. In a boss duel it is 3 seconds of nothing per
round — 10 s across a typical fight — immediately after the player has already
been sitting still typing.

---

## 3. Hypothesis 3 — density matters more than duration. **Half right, and it inverts.**

### Decision density is fine. Duration is not.

Walking the authored spine and classifying every node by whether the player has
real agency there — a line to pick, a patrol gap to time, a tool to spend, a
stance that changes the read:

```
spine 53.7 s, 50 nodes, 41 with a real decision
strict decisions per 10 s: 7.8
  line   15   (>=1 alternative exit that is not backtracking)
  timing 27   (worst patrol's duty cycle between 10 % and 90 %, so waiting changes something)
  tool    5   (a diversion is throwable from here)
  stance 34   (crouch changes the read by >0.2, or hard cover is reachable)
```

**Longest stretch with no decision in it: 4.8 seconds** (`D_SROOF_DIVE` →
`E_ELLIOT_LIP`, the roof crossing to Elliot's gambrel), then 4.0 s
(`B2_SQUARE_NE` → `C_SQUARE_W`). There is no dead thirty seconds. The fear in the
hypothesis is refuted: at 7.8 decisions per 10 seconds this route is dense.

The duration measurement is the problem.

| | Optimal | Competent |
|---|---|---|
| Cheapest route (skips the ropewalk) | **65.1 s** | 110.8 s |
| Longest route (through the ropewalk) | 77.7 s | **127.4 s** |
| Mission clock | 180 s | 180 s |

"Competent" uses the shipped `coldExitSpeedFraction` (0.82) on grounded links,
`slowEntryDurationMultiplier` (1.35) on verbs, all three reflex windows, and the
**entire 32 s authored reroute allowance**. That is a generous model, and it
still finishes with 52.6 seconds unspent on the longest route and 69.2 s unspent
on the shortest. Section budgets sum to 198 s; measured section times are 4.7 s
to 15.5 s against budgets of 12 s to 40 s:

```
A_LEADS      budget  22s   spine   6.6s
B_SHAMBLES   budget  26s   spine   4.7s
B2_THRONG    budget  32s   spine  15.5s
C_ASCENT     budget  40s   spine  13.1s
D_ROOFLINE   budget  12s   spine   5.5s
D2_ROPEWALK  budget  30s   spine   0.0s   (the cheapest route does not enter it)
E_LEAP       budget  18s   spine   1.9s
F_TREE       budget  18s   spine   4.9s
```

**The three-minute mission is a one-minute mission.** An optimising player runs
it in 65 seconds — 36 % of the clock. That is the single largest gap between what
M1 claims and what it is, and it is not a density problem.

### Where the real dead zone is: flow, not decisions

The decision measure missed something the flow measure catches. Counting
consecutive traversal verbs inside the engine's 1.5-second chain window:

```
cheapest spine:  chains of 4, 3, 3, 1, 6   (verb links 17 of 50)
chain breaks:
  21.39 s of running before C_SCAFF_FOOT->C_SCAFF_1   <-- this one
   3.59 s before C_GALLERY_EMID->C_CLOCK
   2.18 s before D_SROOF_DIVE->D_NROOF_W
   1.62 s before D_NROOF_E->E_ELLIOT_ROOF
grounded time: 24.9 s at sprint, 14.0 s at or below the 3.2 m/s sprint threshold (36 %)
```

**There is a 21.4-second stretch of the mission with no traversal verb in it at
all** — from `B_STREET_MID` through the stall gap, all of Dock Square, and across
the square to the foot of the scaffold. Fourteen of those seconds are authored at
2.3 m/s, half of sprint, because the blend requires walking. Dock Square's own
stated intent is "the section where height is not the answer," so the absence is
deliberate — but it lands 40 % of the way into a 65-second run, and it is a third
of the whole mission spent walking in a straight line at half speed with nothing
to jump over.

Dock Square is *dense in stealth decisions and empty of movement.* Both things
are true and the second one is what a player feels.

### Specific repairs to the dead stretch, cheapest first

- **Put one traversal verb inside the throng crossing.** A `DUCK_UNDER` at
  x ≈ 34, z ≈ 16 (a stall's tie-beam over the crowd lane, `soffit` underside at
  1.2 m, exactly the `PASSAGE_HOIST` pattern already shipped 8 metres away) costs
  +0.55 s and breaks the 21.4 s into 9 s + 12 s. One `soffit` and one link.
- **Put a second verb on the exit line.** `B2_SQUARE_NE` → `B2_EXIT` currently
  runs 4.7 m of open ground at 2.3 m/s. A vault-height barrel group at
  x ≈ 42.6, z ≈ 6.5 (top 1.10 m, depth 1.10 m — inside the vault envelope on
  every face, same numbers as `GAOL_BARRELS`) makes the exit a `VAULT` and gives
  the arcade route something to contrast with.
- **Raise the crossing.** `B2_STALL_TOP` exists and is authored as a trap
  ("the one thing you can climb in this section, and it makes you the most
  visible object in the square"). It works as a trap, but it means the section's
  only verticality is a mistake. Give the throng line a low crossing — cart tops
  at `BAND.CART`, 0.95 m — so the player can be *in* the crowd and moving over
  things. Three `hand-cart` props on the crowd lane at x ≈ 30, 34, 38, z ≈ 13,
  spaced 4 m so the chain window covers them.

---

## 4. Do the tools combine, or merely coexist?

**Crouch × light × crowd × motion: yes, genuinely.** These multiply in
`visibility` and the measured effect is large. Crouching reduces peak visibility
by **0.45 to 0.58** at every exposed node on the spine. Blending requires staying
under 2.4 m/s, so crowd and speed trade against each other. `darkFactor` is 0.45,
not zero, so the arcade "only halves you." This part of the design works and the
numbers are the right size.

**Hard cover: coexists.** Cover is reachable at 24 of the 50 spine nodes, but it
is **not reachable at the nodes where the player is most exposed for longest** —
which is the reflex-time balcony, the one set piece cover was presumably added
for:

| Node | Peak visibility | Duty cycle | Hard cover reachable |
|---|---|---|---|
| `C_GALLERY_W` | 1.00 | **47 %** | no |
| `C_GALLERY_E` | 1.00 | 40 % | yes |
| `C_GALLERY_CORNER` | 1.00 | 26 % | no |
| `C_SCAFF_FOOT` / `_1` / `_2` | 1.00 | 20 % each | no |
| `C_GALLERY_HOOD` | 0.00 | 0 % | yes (and redundant) |

Two problems fall out of that table. The hood already returns zero visibility, so
`covered` contributes nothing there — a blocked sightline is worth zero already.
And the four nodes where a player would most want to press themselves against
something have nothing within `COVER_REACH_M` (2.2 m). So the reflex beat's only
answers remain "reach the hood" and "reach the corner," which is what they were
before hard cover existed. Cover is currently doing its work in the Shambles
street line (`B_VAULT_IN` through `B_GAP_N`), where the player is sprinting past
in 3.5 seconds and does not need it.

Also: cover reads **identically standing and crouched at 22 of the 24 nodes where
it is available**, so cover and stance do not compose into distinct states even
though the predicate samples the live capsule height. The two ought to give four
outcomes and give two.

*Fix:* put a cover mass within 2.2 m of `C_GALLERY_W` and `C_SCAFF_1`/`_2` — a
scaffold materials stack at x ≈ 45.5, z ≈ −7.0, top 1.55 m would screen the west
balcony and the staging both, is historically ordinary, and makes the reflex beat
a three-way choice (hood, corner, or press in place) instead of two.

**Throw: does not combine, and one authored anchor is broken.** The brief's
premise is right about the physics and wrong about M1. The engine's own numbers:

- `throwSpeedMps` 14, `throwMaxRangeM` 18, release at 1.35 m, and `solveThrow`
  picks the *flatter* root. An 18 m throw at the same height passes ≈ 3.3 m above
  the ground four metres out; aimed at ground level it passes ≈ 2.8 m. Either
  way it clears a 1.55 m standing body comfortably. So loft-versus-range is a
  real learnable interaction — **in the engine.**
- **M1 never authors a throw long enough to use it.** The longest authored throw
  is 12.82 m. Three of the twelve authored throw positions are absurd:
  `DIVERT_SHUTTERS` from `B_CRATES_A` is a **1.17 m** throw at −68.5° (you are
  dropping it at your feet), and `DIVERT_BELL_ROPE` from `C_SCAFF_1` is 2.72 m at
  −53.5°.
- The only anchor with `bodiesInLine` is `DIVERT_ARCADE_WALL`, and it is broken
  in both directions. From `B2_WELL` the range is **18.38 m, past the 18 m
  ceiling** — `solveThrow` returns null and the throw is never offered. From
  `B2_THRONG_W` the arc passes 1.69 m, 2.03 m and 1.95 m over the three authored
  bodies, so they never screen anything; and the engine's own `previewThrow`
  reports the object coming to rest at `[39.5, 0, 16.1]` — **5.9 m short of the
  authored `landsAt`**, blocked by `ARCADE_PIER_3`, with or without the bodies
  present.

*Fix, in order:* move `landsAt` for `DIVERT_ARCADE_WALL` to a point that is
actually reachable and not behind a pier (anywhere on the open square side of
x = 41.6 — e.g. `[40.8, 0, 17.4]`, 8.3 m from `B2_THRONG_W`, clear line); delete
the two sub-3 m throw positions; and author one long throw with a real body
screen, which the Shambles crowd at `[32.0, 0, 0.0]` r = 5.0 already supplies —
a 15–17 m throw from `B_STREET_W` past that crowd to the far end of the market
is the lesson the verb was built for and it does not exist.

**Reflex time: under-used.** Three charges × 1.60 s world = **13.7 real seconds**
of slow motion per mission, against exactly **one** authored reflex beat
(`REFLEX_BEAT`, the Old Brick tower watch at the gallery). Two charges are spare.
The measured exposure table above shows where the second and third belong:
`C_SCAFF_1`/`_2` at 20 % duty on the way up, and `F_POST` — the beat stance
itself, where the constable resolves you for 5.3 s of a 29.8 s cycle.

---

## 5. Does the flow claim hold on the authored route?

Mostly, and the exception is the one already named.

- Longest chain on the cheapest route: **6 verbs.** Four of its five chains reach
  `chainFlowLength` (3), so the flow readout pays out.
- Longest chain **through the ropewalk: 22 verbs.** That is the best flow
  sequence in the mission by a wide margin: two roof vaults, the hatch drop, the
  beam, three bale run-offs, a vault, the only `SLIDE`, a `CLIMB_OVER`, a
  `STEP_UP`, and then six stacked climbs up the meeting-house south face.
- Section A's descent is authored exactly as claimed: four chain drops of 0.90,
  1.80, 2.20 and 2.20 m, every rung inside the 2.2 m `runOffMaxDropM` ceiling, so
  the player never hangs and never brakes. `A_EAVE_SE → A_HAY` is the 4.9 m roll
  alternative at `speedMps: 4.6`. This is the best-taught eight seconds in the
  mission.
- Section D's chimney vaults are 0.17 s and 0.70 s apart, both inside the 1.50 s
  chain window. The claim holds there.

**Where it does not hold:** the 21.4 s verb-free stretch in section 3, and the
exit from the tree. `F_LOW → F_AWNING → F_GROUND` are two `HANG_DROP`s at 0.42 s
each — a hang drop is by definition the controlled, facing-the-wall descent,
which is the opposite of flow, and it is the last thing the player does before
the duel. The authored note says the awning exists so "the reader brakes at the
lip" does not happen; it succeeds at that, but it substitutes two hangs for one
brake. A 3.2 m and a 3.2 m drop are both inside `rollMaxDropM` (5.5 m), so these
could be run-offs onto the awning and then a roll to the ground, which would keep
the momentum into the yard.

---

## 6. Is failure interesting?

**Yes — this is the strongest system in the mission, and it is MGSV-grade.** The
argument in `hunt.ts` is sound and the numbers back it.

```
escape distance      16 m  (+4 m per repeat, ceiling 3 steps -> 28 m)
break requires       3.0 s of no contact AND the distance
expiry               22 s  (+8 s per repeat)
hunt radius          18 m
suspicion floor      0.62  (investigating, never alerted -- a hunt cannot run the fail clock)
```

Three measurements make it more than a penalty:

1. **Hiding provably does not work and leaving does.** The break needs both
   conditions. Crouching behind the barrel you were seen at satisfies the clear
   ticks and never satisfies the distance.
2. **16 m is 3.5 seconds of open sprinting — 5 % of the optimal run — but 5 of
   the 9 sections are shorter than 16 m along x:**

   ```
   A_LEADS      12.4 m   <-- shorter than the escape distance
   C_ASCENT     15.9 m   <--
   E_LEAP        5.6 m   <--
   F_TREE        4.6 m   <--
   G_YARD        2.0 m   <--
   ```

   So being seen on the Town House or in the elm cannot be escaped *inside the
   place you were seen*. You have to abandon the section. That is exactly "you
   have not lost the run, you have lost the line," and it is expressed as
   geometry rather than as a rule.
3. **The expiry is a real cost, not a shrug.** 22 s against a 65 s optimal run is
   **34 % of the mission** if you cannot get clear and have to wait it out. And a
   third detection asks for 28 m of separation in a 114 m level.

One weakness: `B_SHAMBLES` is 31.6 m long, so a hunt there can be broken without
leaving the section, which makes the market the one place where being caught is
merely a jog. And `huntBaseRadiusM` 18 m means a hunt covers 32 % of the level's
length — in F_TREE, a hunt reaches the yard gate.

**Nothing to fix here beyond one thing:** the hunt is the mission's best
recovery mechanic and the player is never told it exists. There is no authored
place where a first-time player is *supposed* to be seen. MGSV teaches the reflex
beat and the alert state in its first five minutes. M1 has the systems and no
tutorial for them. An authored, near-unavoidable sighting in the Shambles — the
one section where escape is cheap — would teach the whole grammar in eight
seconds at almost no clock cost, and the market watch's cone already covers the
street line at 100 % peak and 9–22 % duty, which is the right shape for it.

---

## 7. Does the dawn clock add urgency or anxiety?

**Neither, currently — a competent player never sees it fire.** This is a
measurement problem, not a design problem; the mechanic is well built.

`dawnLift01` with `liftAtDawn` 0.55 and `nightCurveExponent` 1.8, against the
measured run times:

```
optimal, cheapest route     finishes at  65 s -> lift 0.088, 91 % of the dark still worth something
competent, through D2       finishes at 127 s -> lift 0.295, 70 % still worth something

t= 45 s  lift 0.045   shadowHold 0.95
t= 90 s  lift 0.158   shadowHold 0.84
t=135 s  lift 0.328   shadowHold 0.67
t=180 s  lift 0.550   shadowHold 0.45
t=200 s  lift 0.800   shadowHold 0.20
t=240 s  lift 1.000   shadowHold 0.00
```

And `dawnDispersal01` returns **0 until `elapsedS > budgetS`** — the crowd does
not begin to thin until the full 180 s is spent. So the two mechanics that carry
the pressure are: a light lift of 0.09 (which is inside the noise of the sky
palette's own front-loaded colour ramp), and a crowd dispersal that never starts.

The design of the escalation is right. Taking away the tools rather than failing
the attempt is the correct answer and the shape is correct — `shadowHold01` is
exactly `1 - lift01`, so the HUD's readout cannot lie, and `crowdKept` derives its
floor from `crowdBlendMinDensity` so a dispersed crowd provably hides nobody.
When it does fire it will read as **pressure, not punishment**, for one specific
reason: it is continuous and legible, the player keeps using the same dark
corners and can feel them stop working, and the constable arrives on his own
patrol either way. Nothing is taken away at a threshold the player cannot see
coming.

The problem is that `budgetS` is 180 and the mission is 65–127 seconds long.

*Fix, cheapest first:*

1. **Set the dawn budget to the mission's measured length, not its nominal one.**
   If `budgetS` were ~95 s, a competent 110 s run would finish at lift ≈ 0.60 and
   dispersal ≈ 0.6 — the mechanic would be live in every normal attempt and the
   overrun would be a real overrun. One number, and it is the highest-value
   change in this section by a wide margin.
2. **Lower `nightCurveExponent` from 1.8 toward 1.2.** At 1.8 the first half of
   the budget moves the light by 0.16 of 0.55, so most of the run has no visible
   clock. Flattening it makes the sky a clock the player reads from the first
   thirty seconds.
3. **Start dispersal before the budget is spent, not after.** Beginning at 70 %
   of budget over a 40-second span means a player finishing on time watches the
   square empty behind them, which is the emotional beat the module is for.

Do these *after* the level is long enough (section 3). Turning up the clock on a
65-second mission would just mean the light never matters for a different reason.

---

## 8. Prioritised list, by fun-per-unit-of-work

Levels: **L** = level authoring, **E** = engine/systems, **A** = art.

### P0 — blockers. Hours of work, and nothing else can be judged until they land.

| # | Kind | Item |
|---|---|---|
| 1 | L | **Four clearance misses in the Dock Square colonnade make 88 of 137 nodes unreachable.** |

This is the whole of section 0. The failures are between **2 cm and 13 cm**:

```
B2_ARCADE_CASKS->B2_ARCADE_N   at (44.73, 8.93)   ARCADE_CRATES_N   short by 0.020 m
B2_THRONG_E->B2_ARCADE_S       at (41.82, 17.49)  ARCADE_PIER_4     short by 0.040 m
B2_SQUARE_NE->B2_EXIT          at (41.38, 8.63)   ARCADE_PIER_1     short by 0.130 m
B2_THRONG_S->B2_ARCADE_S       at (41.33, 19.13)  ARCADE_PIER_4     corner case: dx 0.270, dz 0.330,
                                                                    both under the 0.35 radius, so the
                                                                    axis-separated test blocks a diagonal
                                                                    that a circle would clear at 0.426 m
```

The colonnade is a wall of piers at x = 41.6–42.2 with gaps at z = 9.6–11.4,
12.4–15.0, 16.0–17.8 and 18.8–20.8. Every authored crossing is aimed at a pier
rather than a gap. Grid-searching the region for clear standing positions gives
one-waypoint repairs with near-zero detour:

```
B2_SQUARE_NE    -> [41.2, 0,  8.3] -> B2_EXIT          +0.06 m  (+0.01 s at sprint)
B2_THRONG_S     -> [41.7, 0, 19.2] -> B2_ARCADE_S      +0.00 m
B2_THRONG_E     -> [41.2, 0, 19.2] -> B2_ARCADE_S      +0.84 m
B2_ARCADE_CASKS -> [44.8, 0,  7.4] -> B2_ARCADE_N      +0.50 m
```

| # | Kind | Item |
|---|---|---|
| 2 | L | **Three SAFE links point at nodes that do not exist:** `D2_FLOOR_E` (twice) and `D2_STAGE_E`. The SAFE line cannot cross the ropewalk floor. Either author the two nodes or delete the three links and re-author the bale descent. |
| 3 | L | **`D2_BEAM_E -> D2_BALES_HIGH` lands on `GROUND`, not the bales.** The gap is 4.56 m against a 3.76 m SAFE budget. Move `HEMP_BALES_HIGH` ~1 m toward the beam, or move the node. This is the quiet descent — the whole point of the section's loud-or-quiet choice. |
| 4 | L | **`D2_FLOOR_MID` is orphaned** — no inbound link, no outbound link. Its own note advertises "the loud way down: 5.2 m of drop... four metres from the man with the lantern," and `D2_BEAM_E`'s note advertises the same choice. The choice does not exist. Add `D2_BEAM_E -> D2_FLOOR_MID` (DROP, FAST) and an exit. |
| 5 | L | **`B_SHED_W` has no outbound link.** Either link it or cut it. |

### P1 — the fun. Ordered by ratio.

| # | Kind | Item | Why it ranks here |
|---|---|---|---|
| 6 | L | **Break the 21.4-second verb-free stretch.** One `soffit` for a `DUCK_UNDER` at x ≈ 34, z ≈ 16; one vault-height barrel group at x ≈ 42.6, z ≈ 6.5; three cart tops on the crowd lane at x ≈ 30, 34, 38, z ≈ 13. | Two props and four links against the biggest single hole in the flow claim. Nothing else on this list is this cheap for this much. |
| 7 | E | **Raise M1's boss tier, or tier 1's health.** Target 4 rounds correct / 6 wrong instead of 2.1 / 3.5. | One number. Currently knowing the history *deletes* the climax. |
| 8 | L | **Set `budgetS` for the dawn clock to the measured run length (~95 s), and lower `nightCurveExponent` to ~1.2.** | Two numbers. Turns a well-built mechanic from invisible to live in every attempt. Do it after #10. |
| 9 | L | **Lengthen the beat chart to 10–12 strikes and put 3-strike beats on `A_SHEETS`, `B_DUCK`, and the leap.** Narrow the constable's blind window at `F_POST` from 24 s to 6–8 s. | ≈ +3 s of clock for 3× the timed input and the first real pressure on the beat. The osu pillar becomes a pillar. |
| 10 | L | **Spend the unused clock.** 52.6 s unspent on the longest competent route, 69.2 s on the shortest. Section budgets sum to 198 s and measured sections run 4.7–15.5 s. | The largest gap between claim and reality. Also the most work. Everything else on this list is cheaper, which is why it is not #1. |
| 11 | L | **Decide the ropewalk.** The cheapest route skips D2 entirely to save 12.5 s optimal / 16.6 s competent, abandoning 22 nodes, the only `SLIDE`, the only interior, and the mission's best flow sequence (a 22-verb chain). Either close the `D_SROOF_E -> D_MEETING_ROOF` bypass or make D2 pay for itself. | Free content already built, currently unreachable by an optimising player. Highest ratio of anything in #10's category. |
| 12 | L | **Author a taught sighting in the Shambles.** The hunt is the best system in the mission and nothing teaches it. `WATCH_SHAMBLES` already covers the street line at 100 % peak / 9–22 % duty, and B_SHAMBLES is the one section long enough (31.6 m) that escape is cheap. | Near-zero clock cost, teaches the whole failure grammar in eight seconds. |
| 13 | L | **Put a cover mass within `COVER_REACH_M` (2.2 m) of `C_GALLERY_W` and the scaffold staging** — a materials stack at x ≈ 45.5, z ≈ −7.0, top 1.55 m. | Makes hard cover combine with the reflex beat instead of coexisting beside it. One prop. |
| 14 | L | **Author the second and third reflex beats.** Two of three charges are spare; 13.7 real seconds of slow motion exist and one beat uses 4.6 of them. Candidates measured above: `C_SCAFF_1`/`_2` (20 % duty) and `F_POST` (18 % duty during the beat). | Systems already shipped; only authoring is missing. |
| 15 | L | **Fix the throw anchors.** Move `DIVERT_ARCADE_WALL`'s `landsAt` off the far side of `ARCADE_PIER_3` (e.g. `[40.8, 0, 17.4]`); delete the 1.17 m and 2.72 m throw positions; author one 15–17 m throw from `B_STREET_W` past the `CROWD_SHAMBLES` cluster. | The verb's whole skill expression — loft versus range against a body screen — is currently unreachable in M1. |

### P2 — engine and systems.

| # | Kind | Item |
|---|---|---|
| 16 | E | **Ask the question every other round instead of every round.** One branch in `openNextRoundOrResolve`. Halves the typing, doubles the longest unbroken play from 20 s to 40 s, keeps knowledge decisive. The highest-value structural change to the duel; ranked below #7 only because #7 is a single number. |
| 17 | E | **Drop `RESUME_COUNTDOWN_SECONDS` in PvE.** 3 s per round of nothing, immediately after the player was already sitting still. Keep it for PvP, where it resynchronises clients. |
| 18 | E | **Add a level lint for capsule clearance.** Item #1 is a class of bug, not an instance: four sub-13 cm misses took out two-thirds of the mission and the route test reports it only as "body does not fit at t=0.67." A lint that walks every authored link and reports the nearest blocker and the deficit in centimetres would have caught all four in one pass. |
| 19 | E | **Start `dawnDispersal01` before the budget is spent** (70 % of budget over a 40 s span) so a player who finishes on time sees the square empty behind them. |
| 20 | E | **Consider whether the diagonal corner case in `positionClear` is intended.** `ARCADE_PIER_4` blocks a point 0.426 m from its nearest corner against a 0.35 m radius, because the test separates axes. Either document it as the contract level design budgets against, or round the corners. |

### P3 — art.

| # | Kind | Item |
|---|---|---|
| 21 | A | Assets for #6 and #13: one tie-beam soffit over a market lane, one scaffold materials stack. Both are re-dressings of shipped assets (`duck-beam-frame`, `crate-stack`), so this is a manifest entry rather than a Meshy run. |
| 22 | A | Whatever #10 asks for once its scope is decided. Do not start before then. |

### What I would cut

- **The 32-second reroute allowance as a pacing device.** It is the only thing
  standing between "the mission is 65 seconds long" and "the mission fills its
  budget," and it is a fudge factor with a section field. Delete it and let
  `shortfallS` say the true number.
- **The 198-second section budget sum.** It exceeds the 180 s clock and no
  section is within 2× of its own budget. Re-derive budgets from measured times
  once #10 lands, or drop the field.
- **`RESUME_COUNTDOWN_SECONDS` in PvE** (see #17).
- **The two sub-3-metre diversion throw positions** (`DIVERT_SHUTTERS` from
  `B_CRATES_A` at 1.17 m, `DIVERT_BELL_ROPE` from `C_SCAFF_1` at 2.72 m). They
  offer the player a throw that is a drop.
- **`B_SHED_W`** unless it is given an exit.
- **Either the ropewalk or its bypass** — but not both (see #11). A 22-node
  section that the optimal route ignores is 22 nodes of maintenance for zero
  players.
- **`DUEL_ROUNDS = 6` as a name.** It is documented as descriptive, but M1's
  actual boss produces 2.1–4.5. Anything that reads it as "about how long a duel
  is" will be wrong for the first duel any student ever plays.

---

## Appendix — the claims in the brief, checked

| Claim | Verdict |
|---|---|
| "The precision beat measures 3.65 seconds inside a 180-second run, once." | Confirmed. 3.65 s worst case, 2.26 s mean chart, 5 judged strokes, 15 in the mission's lifetime. |
| "A fight runs three to nine rounds, each opening with an untimed question." | Untimed: confirmed (`QUESTION_PENDING` pauses the field clock; `ADVANCE` is a no-op). Three to nine: **refuted** at M1's tier — 2.1–3.5 rounds for a realistic player, 2–5 range. Nine happens only to a player who never fires, who also loses 0/8. |
| "A climax that stops eight times for typing." | Refuted as a count; **confirmed as a ratio.** 47 % of duel wall clock is typing at 20 s/answer, and the longest unbroken play is 20 s at any round count. |
| "A dead thirty seconds mid-run matters more than anything cosmetic." | Agreed, and there is no thirty-second decision-dead stretch — the worst is 4.8 s. But there is a **21.4-second verb-free stretch**, 14 s of it below sprint speed. |
| "At the tuned throw speed an 18 m throw passes 3.15 m over someone four metres away." | Confirmed in the engine (≈3.3 m for a same-height throw, ≈2.8 m aimed at the ground; both clear a 1.55 m body). **Unexercised in M1** — longest authored throw is 12.82 m and the only anchor with bodies in the line is out of range from one node and lands 5.9 m short from the other. |
| "A player never dropping below 3.77 m/s of a 4.60 sprint across three street-spaced obstacles." | Holds where the authored route has verbs: section A chains 4, section D's chimneys are 0.17 s and 0.70 s apart inside a 1.50 s window, and the ropewalk chains 22. Does not apply across the 21.4 s of Dock Square, which contains no verbs and is walked at 2.3 m/s. |
| "The hunt breaks only once you have broken contact and put sixteen metres between you and that place — so hiding fails and leaving works." | Confirmed, and it is MGSV-grade rather than a penalty: five of nine sections are shorter than 16 m, so being seen forces you out of the place entirely, and a wait-it-out expiry costs 34 % of the optimal run. |
| "`dawn.ts` lifts the light and disperses the crowd as the budget runs out, so overrunning strips concealment rather than failing you." | Correct as designed, and it reads as **pressure rather than punishment** — continuous, legible, no hidden threshold. But at the measured run length it never fires: lift 0.088 at 65 s, 0.295 at 127 s, and dispersal is exactly 0 until 180 s is spent. |
