# Physics & Collision Audit — M1 traversal core

**Scope:** `packages/engine-world/src` (collision, motion, parkour), `packages/mission-m1/src/compile.ts`, `packages/netcode`.
**Method:** code read plus headless measurement against the shipped modules and the real compiled M1 level. Probe scripts under `/tmp/audit/`; none of them are in the repo and no source file was modified.
**Tree:** every measurement below was taken against `HEAD 9f9a4d0` plus the working tree as it stood at 17:48–17:56 on 26 Jul. `collision.ts`, `playerMotion.ts`, `probe.ts`, `flow.ts` and `select.ts` were byte-identical at the start and end of the audit, so the numbers and the line references describe one consistent tree.
**Machine load:** the browser probe ran at load 10.97 on 10 cores and reported median frame time 8.2 ms / p95 9.3 ms, so rendering was not the bottleneck during that run. The headless probes are pure arithmetic and load-insensitive; their wall times (0.3–8 s) are noted only to show they are cheap to re-run as a gate.

---

## Lead: the single structural change, and whether the deck/blocker split is the central defect

**You are about two-thirds right.** The deck/blocker split is where the damage shows up, but the split itself is not the defect and unifying the two primitives would not fix what you are feeling. One-way support surfaces are a normal, correct thing to have: Source has `func_illusionary` and player-clip brushes, Unity has the platform effector, Unreal has one-way blocking volumes. Having a "deck" that supports you from above and does not stop you from the side is a legitimate authoring tool, and M1 leans on it heavily and reasonably — 56 decks against 98 solid masses.

The actual defect is narrower and more fixable than a representation merge:

> **The verb reader answers "what geometry is near me" and never answers "can a body actually get there from here". The mover answers reachability correctly and completely; the reader never asks it.**

Three of the four probe readers in `parkour/probe.ts` find candidate geometry with `supportBelow`, which is a **zero-radius point query with no occlusion test of any kind**. `readRaisedSurface` (`probe.ts:376`) marches rays that cannot see walls. `readOverhead` (`probe.ts:534`) does not march at all — it looks straight up a single vertical column at the player's own x/z and, if it finds a deck between head height and 3.2 m, reports it as an obstacle at `faceDistanceM: 0` (`probe.ts:584`), i.e. "you are touching it". Meanwhile the mover (`sweepXZ`, `collision.ts:1050`) is a genuinely correct swept-capsule solve that I could not defeat at any speed.

So the system has one honest physics core and one reader that is allowed to promise things the core would never permit. When the reader was too shy, authored links offered nothing. When it was loosened, it started offering climbs into the middle of floors. Both symptoms are the same missing question.

**The one change that fixes the most:** make every candidate the reader returns pass a swept reachability test against the same `sweepXZ`/`headClearance` the mover uses, before it is ever ranked. That is a contained change inside `probe.ts` — no new collision representation, no data migration, no re-authoring. It is roughly a day, and it is item **P0** below.

The deck/blocker split does need work, but it is item **P2**, it is a smaller job than you fear (it is not a multi-day representation merge — it is adding platforms to two existing query functions), and doing it *without* P0 would make things worse, not better.

One clean piece of good news up front: **there is no tunnelling anywhere in this engine, at any speed.** I tried to break it and could not. Details in Q1/Q2.

---

## Answers to the seven questions

### Q1. Is movement swept or discrete?

**Swept, and correctly so.** `sweepXZ` (`collision.ts:1050–1131`) advances the capsule from `from` to `to`, finds the earliest contact time across all candidate blockers, moves to that point, applies a 1e-5 outward skin, projects the remaining motion onto the contact plane, and repeats up to `SWEEP_MAX_CONTACTS = 4` times (`collision.ts:905`). Contact time is found by `firstIntrusionTime` (`collision.ts:982`): a spatial march at `SWEEP_SAMPLE_DISTANCE = CAPSULE_RADIUS * 0.25 = 0.0875 m`, then 18 rounds of binary refinement (`collision.ts:903–904`). This is a sampled sweep rather than an analytic one, but it is a real sweep and it stops at first contact.

Both grounded motion (`playerMotion.ts:878`) and ballistic motion (`playerMotion.ts:945`) go through it. There is no collider bypass.

Vertical motion is not swept in the same way, but it is not discrete either: the fall path looks up `supportBelow` **before** applying the step and lands if the new foot position would pass it (`playerMotion.ts:963–970`). Because `supportBelow` returns the *highest* surface at or below the current feet, a fast fall lands on the first surface it would have crossed rather than skipping to a lower one. That is correct.

**Where the body is placed rather than swept:** authored traversal only. `stepAuthored` writes `pos` directly from a piecewise-linear anchor sample (`playerMotion.ts:1051–1060`). See Q4.

### Q2. Is there continuous collision detection? What is the tunnelling threshold?

**There is no CCD in the textbook sense, and it turns out not to need any.** The swept march cannot skip a blocker because the intrusion predicate tests the blocker's footprint **expanded by the capsule radius** (`intrudesXZ`, `collision.ts:786`). Any blocker, however thin, presents at least `thickness + 2 × 0.35 m = 0.7 m` of expanded cross-section along the direction of travel, which is eight times the 0.0875 m march step.

Measured (`/tmp/audit/probe1.ts`, test C): walls of 0.5 / 0.2 / 0.1 / 0.05 / 0.02 m thickness, at `RUN_SPEED` 4.6, dash speed 6.67, and 20 / 60 / 200 m/s. **Zero tunnelling in every combination.** Pushed harder with a single 100 m sweep in one call against a 2 cm wall:

```
single sweep 0 -> 100m through a 2cm wall at x=3: ended x=2.6400 hits=["wall"]
```

2.64 = 3.00 − 0.01 (half thickness) − 0.35 (radius). Exact.

**Practical tunnelling threshold: none for solid geometry.** The only way to pass through something is if it is a `platform`, which is not solid to begin with by design.

Do not spend effort here. This part is better than most shipped browser games.

### Q3. Is there depenetration?

**No. None at all, anywhere in the step.** `depenetrateXZ` exists (`collision.ts:861–889`) and **has zero callers** — I grepped `engine-world`, `mission-m1` and `netcode`; the only occurrences are its own definition and its own internal `positionClear` calls.

Measured (`/tmp/audit/probe1.ts`, test D) with the capsule started dead centre inside a 2×2 m blocker:

```
start embedded at centre. positionClear=false
after 1s of NO input:      pos=(0.000, 0.000, 0.000) clear=false
after 2s of RUNNING out:   pos=(8.386, 0.000, 0.000) clear=true
depenetrateXZ() would have solved it: null  -- but nothing calls it.
```

An embedded body stays embedded indefinitely. It escapes only if the player happens to push outward, which works because `firstIntrusionTime` returns `0` for an already-inside body only when the motion has an inward component (`collision.ts:992–996`) — an escape hatch, not depenetration.

Two-blocker overlap has no handling at all. `blockerContactNormal` (`collision.ts:908`) picks the nearest face of one blocker; with two overlapping there is no combined resolution and the chosen normal can flip between frames as the body moves, which is exactly the signature of "you glitch on objects".

What a commercial controller does: after integration, collect all overlapping colliders, compute each minimum-translation vector, and resolve iteratively (usually 3–4 passes) with the largest penetration first. Unreal's `ResolvePenetration`, Unity's `ComputePenetration` + `Physics.ComputePenetration` loop, Source's `UTIL_TraceEntity` unstick. All of them run **every frame**, not only on recovery. The ring search in `depenetrateXZ` is the wrong shape for this — it searches outward in 5 cm steps up to 0.8 m and returned `null` for a body 1.35 m from freedom. It should be replaced by MTV resolution, not merely called.

### Q4. Are traversal verbs teleports?

**Yes, with real validation bolted on — which is better than a bare teleport and materially worse than travelling a path.**

`stepAuthored` (`playerMotion.ts:996`) samples a smoothstep-eased piecewise-linear path along the authored anchors and **assigns the position directly** (`playerMotion.ts:1054`). The per-frame `sweepXZ` and `headClearance` at `playerMotion.ts:1003–1026` are used only as a *veto* — their result cancels the action but never corrects the position. The body does not slide along a wall mid-vault; it either completes the scripted path or is snapped back to a validated endpoint by `cancelAction` (`playerMotion.ts:681`).

Validation at commit is genuinely present in `beginAuthored` (`playerMotion.ts:606`):

- the destination must be a legal standing pose — `landingValid` at line 625;
- the whole swept path is checked at ≥24 samples — `authoredTrajectoryClear` at line 643 / 1110;
- and as of today's work, the path must not cross a deck plane — `crossesPlatform` at line 1148 / 1162.

Per verb:

| Verb | Motion kind | Destination validated | Path checked | Genuinely travels a collided path |
|---|---|---|---|---|
| STEP_UP, MANTLE, CLIMB_UP | authored `CLIMB_UP` | yes | yes (veto only) | no |
| VAULT, CLIMB_OVER | authored `VAULT` | yes | yes (veto only) | no |
| SLIDE | authored `DUCK_UNDER` | yes | yes, and deliberately with an empty ignore set (`select.ts:503`) | no |
| HANG_DROP | authored `CLIMB_DOWN` | yes | yes (veto only) | no |
| RUN_OFF | passive | n/a | n/a | **yes** — ordinary grounded motion walks off the lip |
| JUMP, JUMP_GAP | ballistic launch | JUMP_GAP pre-simulates (`select.ts:541`) | n/a | **yes** — full swept ballistic arc |
| LEAP_OF_FAITH | ballistic launch | receiving target | n/a | **yes** |
| DASH | velocity burst | n/a | n/a | **yes** — `stepDash` hands a substituted target velocity to `stepGrounded` (`playerMotion.ts:826`) |

The design comment at `playerMotion.ts:200` is accurate and worth preserving: dash and stagger are deliberately *not* authored phases, so they collide and slide like walking. That is the right instinct, and the authored verbs are the exception to it.

**The hole is the ignore set.** `planVerb` passes `ignore: [obstacle.id]` for every climb and vault (`select.ts:456`, `select.ts:484`). Everything in `ignore` is non-solid to `sweepXZ`, `headClearance` and `crossesPlatform` for the whole duration. For a vault over the crate you are vaulting, that is correct and necessary. For a climb onto a **deck**, it means the destination floor is switched off, and the body rises through it — see Q5 and P1.

### Q5. The two-world problem — every representation and every consumer

There are exactly three collision representations, produced by `compileLevel` (`mission-m1/src/compile.ts:85`):

| Representation | Built from | Shape | Vertical extent | Solid? |
|---|---|---|---|---|
| `Blocker` | `MassSpec` (`compile.ts:18`) | AABB, OBB or capsule footprint | `[baseY, topY]` | yes — swept against |
| `Platform` | `DeckSpec` + ramp strips (`compile.ts:63`) | rect or polygon | a single `y`, zero thickness | **no** — support only |
| implicit ground | hardcoded | infinite | `y = 0` | support only |

Consumers, and which representations each one sees:

| Consumer | Blockers | Platforms | Ground |
|---|---|---|---|
| `sweepXZ` — the mover (`collision.ts:1050`) | **yes** | **no** | no |
| `positionClear` / `blockerIdsAt` (`collision.ts:823, 833`) | **yes** | **no** | no |
| `headClearance` (`collision.ts:1202`) | **yes** | **no** | no |
| `segmentOccluderIds` — LOS, cover, duel sightlines (`collision.ts:669`) | **yes** | **no** | no |
| `supportBelow` (`collision.ts:1143`) | landable tops only | **yes** | **yes** |
| `platformUnderFoot` (`collision.ts:1180`) | no | **yes** | no |
| `landingValid` / `canStand` (`collision.ts:1235, 1251`) | via both of the above | via `supportBelow` | yes |
| `crossesPlatform` (`playerMotion.ts:1162`) | no | **yes** | no |
| `readObstacle` (`probe.ts:193`) | **yes**, radius 0 | **no** | no |
| `readRaisedSurface` (`probe.ts:376`) | landable tops | **yes** | yes |
| `readOverhead` (`probe.ts:534`) | landable tops | **yes** | yes |
| `readEdge` (`probe.ts:598`) | landable tops | **yes** | yes |

**Where consumers disagree about what is solid — the three that matter:**

**(a) `headClearance` does not see platforms, so a deck has no underside.** You can stand with your head through a scaffold staging and `canStand` returns true. This is what makes the climb-from-underneath possible: there is nothing overhead to stop the rise.

**(b) `readRaisedSurface` and `readOverhead` have no occlusion test.** `raisedAt` (`probe.ts:391`) is `supportBelow` at a point, full stop. A full-height mass is invisible to it, because `supportBelow` skips non-landable and infinite-top blockers (`collision.ts:1166`). So a deck behind a solid mass is a legal candidate as far as the reader is concerned. In M1 today this is partly masked — `wallFromRect` makes finite-top masses landable by default, and the census found **zero** `topY = Infinity` blockers in the level, so most masses do stop the raised march. But the protection is incidental, not designed: it depends on every occluding mass happening to be landable with a finite top and happening to be the *first* raised thing along the ray.

**(c) A deck between 7 cm and any height is a complete ghost to walking.** Grounded motion absorbs `SUPPORT_SNAP_UP = 0.06 m` (`collision.ts:92`) and nothing more, and `sweepXZ` never sees platforms. Measured (`/tmp/audit/probe2.ts`, test A2b), running at a deck with the raw integrator:

```
deck y=0.05: at x=5 the feet are at y=0.050 (stepped up at x=2.05)
deck y=0.06: at x=5 the feet are at y=0.060 (stepped up at x=2.05)
deck y=0.07: at x=5 the feet are at y=0.000 (NEVER ROSE - walked under/through)
deck y=0.25: at x=5 the feet are at y=0.000 (NEVER ROSE - walked under/through)
deck y=1.00: at x=5 the feet are at y=0.000 (NEVER ROSE - walked under/through)
```

The verb ladder rescues this in practice — with the full `stepFlow` controller a 0.1–0.5 m deck fires `STEP_UP` and the player does get on top (`/tmp/audit/probe4.ts`, test 6). But that is a scripted 200 ms verb doing a job that a 6 cm tolerance should be doing, and it only works when the deck is deep enough to be `topStandable`.

**Is this the central defect? Partly.** The split is what lets (a) and (c) exist, but (b) — the missing reachability test — is what turns them into the behaviour you are seeing, and (b) would still be wrong even in a single unified world.

**How much of M1 is exposed.** Census of the real compiled level (`/tmp/audit/probe3.ts`):

```
blockers (solid masses): 98        platforms (decks): 56
full-height walls (topY=inf): 0    finite landable masses: 44
landable mass heights:  0.06-0.50m: 2    0.50-1.15m: 18    1.15-1.90m: 16    1.90-3.20m: 8
decks where a player standing underneath is offered a climb THROUGH them: 16 / 56
approx exposed floor area: 211 m^2 of 2791 m^2
```

The worst are total: `SCAFFOLD_D1` 22/22 sampled square metres, `CLOCK_LEDGE` 9/9, `TREE_AWNING` 9/9 — from anywhere underneath them, holding a direction climbs you up through the boards.

### Q6. Determinism

**Better than I expected at the top level, with one specific real risk.**

The fixed clock is correct. `advanceFieldClock` (`fieldSimulation.ts:61`) accumulates the frame delta and emits whole 1/60 steps, so 30 / 60 / 144 Hz visit the same tick sequence. Every production call site passes `FIELD_DT` and nothing else: `flow.ts:382`, `flow.ts:530`, and `duel/src/combat.ts:624`. I grepped for every `stepMotion` / `stepFlow` caller outside tests and there are no others.

`stepMotion` itself *is* frame-rate dependent if you hand it a variable `dt`, because position is integrated as `pos += v_end × dt` after an exponential velocity blend. Measured over 2 s of full-throttle running on flat ground (`/tmp/audit/probe1.ts`, test E):

```
144Hz: 8.3640 m    120Hz: 8.3672 m    60Hz: 8.3859 m    30Hz: 8.4225 m
20Hz:  8.4580 m    15Hz:  6.1582 m
```

The 15 Hz figure is `MAX_DT = 0.05` (`playerMotion.ts:46`) clamping and the simulation running in slow motion. **This is latent, not live** — nothing in production passes a variable dt. It is a landmine in a public API, worth a comment or an assertion, not a refactor.

**The real risk is transcendental functions on a bit-exactly-hashed path.** `netcode/hash.ts` is explicit and correct that it must detect a one-ulp divergence (`hash.ts:17–20`) and hashes float bit patterns with no quantisation (`hash.ts:80–86`). But `stepGrounded` computes velocity with `Math.exp` (`playerMotion.ts:868`) and facing with `Math.atan2` (`playerMotion.ts:888`), and `sweepXZ`/`slideVelocityXZ`/`intrudesXZ` use `Math.hypot`, `Math.sin`, `Math.cos`. ECMA-262 leaves `exp`, `sin`, `cos`, `atan2`, `pow` and `hypot` **implementation-approximated**. V8, JavaScriptCore and SpiderMonkey are not required to agree and in practice do not always agree in the last ulp. The server is Node/V8; a client could be Safari/JSC. That is a per-tick hash mismatch waiting to happen, and the divergence detector is built precisely to notice it — so it will fire as a mystery rather than as a bug.

`Math.sqrt` is exactly specified by IEEE 754 and is safe. The fix is mechanical: `Math.sqrt(x*x + z*z)` for `hypot`, and a fixed-tick rational blend factor instead of `1 - exp(-k·dt)` (which is a constant at fixed dt anyway, so it can be precomputed). Facing is presentational and could be excluded from the hash instead.

Two smaller determinism notes:

- `broadPhaseCandidates` returns a **shared mutable scratch array** (`collision.ts:240`). No current consumer holds it across a second query, so nothing is broken today, but it is one careless call away from silent corruption. Worth a defensive copy or a comment.
- The browser probe reported **`dropped fixed steps so far: 20`**. `MAX_CATCHUP_STEPS = 5` (`fieldSimulation.ts:19`) discards excess steps rather than queueing them (`fieldSimulation.ts:88–89`). Simulation time is being silently thrown away during hitches — 20 steps is a third of a second of world that did not happen. For the mission that is a feel bug; for the duel the server will not have dropped the same steps.

### Q7. Input timing

**The input path is one of the better-built parts of this codebase, and today's fall-through work closed the main hole.**

- Presses are edge-triggered, auto-repeat is dropped, and modified chords are ignored (`missionInput.ts:179–193`).
- A latch survives frames that advanced no fixed steps and is cleared only when a tick actually consumed it (`MissionStage.tsx:215`, `traversal.ts:815–821`). That is the correct design and many shipped games get it wrong.
- There is a jump buffer: `jumpBufferTicks: 7` ≈ 117 ms (`tuning.ts:346`), re-armed on each press (`flow.ts:363`).
- There is coyote time: `COYOTE_MS = 100` (`playerMotion.ts:39`), applied in `stepGrounded` (`playerMotion.ts:913`).

**Could a verb consume the input and then fail its own test?** It could until today. `rankVerbs` only offers `JUMP` when nothing else ranked (`select.ts:282`), and the controller used to fire one candidate or nothing. The comment block at `flow.ts:679–703` documents the measured failure — MANTLE previewed, MANTLE refused, forever, in M1's alley — and the loop at `flow.ts:708–735` now falls through to the next rung when `beginAuthored` refuses, with an unconditional jump guarantee at `flow.ts:749–761`. I believe that is correct and I could not construct a case that defeats it.

**What remains, and what it feels like:**

1. **A press during an authored verb is lost after 117 ms.** The controller returns early while busy (`flow.ts:636`) and the buffer decrements. `CLIMB_UP` is 900 ms and `MANTLE` 933 ms (`tuning.ts` durations). A player pressing jump a quarter of a second before a climb ends gets nothing. 117 ms is short — Fortnite-class shooters use 150–250 ms, and Assassin's Creed queues far longer.

2. **"Shift jumps don't work" is mostly the design working as specified.** In the mission the jump goes through `planVerb("JUMP")`, which needs only `speedMps >= 1.2` for a running jump (`select.ts:573`); Shift is not consulted. If there is an obstacle ahead that ranks a verb, the verb wins and you vault instead of jumping — deliberately (`select.ts:279–282`). To the player that is indistinguishable from a dropped press. Note this is *not* `resolveFreeJump` in `playerInput.ts`, which does require Shift; that function is used by the duel (`duel/src/engine.ts:126`), not by mission traversal.

3. **"Jumps are delayed" is very likely the verb windows, not the input.** 2.4 authored verbs fire per minute of ordinary running and 3.4 % of running time is spent with no player control (`/tmp/audit/probe5.ts`), in 200–933 ms blocks. Plus the dropped fixed steps above.

---

## The measured picture, in one table

| Measurement | Result | Probe |
|---|---|---|
| Tunnelling, 0.02–0.5 m walls at 4.6–200 m/s | none, at any speed | probe1 C |
| Depenetration | absent; `depenetrateXZ` has zero callers | probe1 D |
| Ground probe width | a single point; 0.35 m overhang tolerated, 0.35 m of contact lost | probe1 B |
| Step-up absorbed by the integrator | 0.06 m; even a 3 cm blocker stops a run dead | probe1 A |
| Step-up with the full ladder | works, via a 200–750 ms scripted verb | probe4 5 |
| Decks climbable from directly underneath | 16 of 56 (~211 m² of floor) | probe3 2 |
| Authored obstacle links that offer a verb | 27 of 46; **19 still offer nothing** | probe3 3 |
| Authored verbs whose capsule is cut by a deck plane | 54 of 118 (46 %) | probe6 |
| ...of those, rising >0.35 m *inside* the boards | 23 of 118 (20 %), worst 1.10 m inside a stall canopy | probe7 |
| Verbs committed per minute of running | 2.4; 3.4 % of playtime with no player control | probe5 8 |
| Frame-rate independence of `stepMotion` | dt-dependent, but every production caller passes `FIELD_DT` | probe1 E |
| Dropped fixed steps, live, under load 11 | 20 | `probe_m1_controls.mjs` |

The 20 % figure is the one I would put in front of the owner for report (3). Sample of what it looks like:

```
MANTLE      came up 1.10m INSIDE STALL_3__CANOPY
CLIMB_UP    came up 0.41m INSIDE SCAFFOLD_D1
CLIMB_UP    came up 1.00m INSIDE HOLLIS_LEANTO
```

---

## Prioritised plan

Ordered by owner-visible improvement per unit of risk.

### P0 — Reachability test on every probe candidate
**Fixes:** "climbs and vaults you through everything", most of "you glitch on objects".
**What is wrong:** `readRaisedSurface` (`probe.ts:376`) and `readOverhead` (`probe.ts:534`) find surfaces with zero-radius `supportBelow` and never test whether a body can reach them. `readOverhead` in particular reports `faceDistanceM: 0` for anything in the vertical column between head height and 3.2 m.
**Evidence:** probe1 G — from a standstill under a bare deck at 1.7–3.1 m, holding any direction, `MANTLE`/`CLIMB_UP` commits and the body rises through the plane. probe3 §2 — 16 of 56 real M1 decks are exposed.
**Fix:** before a candidate is returned, require (a) `sweepXZ` from the player's position to the candidate's lip at the player's current foot height to arrive without contact, and (b) the vertical column from the feet to `topY` at the lip to be clear of blocker spans. Both use functions that already exist. Add a hard distance bound to `readOverhead` so it can only fire against something the player is genuinely beneath.
**Cost:** ~1 day including tests.
**Risk:** medium-high, and it is the *same* risk that produced the current swing. Tightening the reader will re-silence authored links unless it is gated. **Gate it on probe3 §3** (`27 offered / 19 silent` today) — that number must go up, not down. Do not ship this without running that survey before and after.

### P1 — Climbs must come up at the lip, never through the middle of a floor
**Fixes:** the remaining, most visible half of "literally THROUGH objects".
**What is wrong:** `planVerb` builds `[start, lip@topY, topLanding]` where the lip is `faceDistanceM` ahead (`select.ts:451`). For `readOverhead`, `faceDistanceM` is 0, so the lip is directly overhead and the rise happens inside the deck footprint. `ignore: [obstacle.id]` (`select.ts:456`) then disables the very floor being climbed, so `crossesPlatform` cannot object.
**Evidence:** probe7 — 23 of 118 verbs rise more than a capsule radius inside the boards, worst 1.10 m in.
**Fix:** plant the lip anchor at the nearest point on the destination deck's *boundary*, not at the player's column, and require the player to be within reach of that boundary. Where M1 genuinely needs a straight vertical ascent (the Town House CLIMB links share x and z — noted in the comment at `probe.ts:514–533`), that is a **level-authoring** answer, not a physics one: author an explicit ladder or climb volume there so the reader is not guessing.
**Cost:** ~1 day of code, plus level work for the vertical-ascent links.
**Risk:** medium. Directly touches the guaranteed ascent. Same gate as P0.

### P2 — Give the integrator a real step offset
**Fixes:** "random areas you can't walk into", and a large share of the "it automatically vaults you over everything" feel.
**What is wrong:** the integrator absorbs 6 cm (`collision.ts:92`) and `sweepXZ` stops the capsule 0.35 m short of any blocker regardless of height, so the snap can never engage on a blocker. Every piece of ground relief between 7 cm and 50 cm becomes either a wall or a scripted verb.
**Evidence:** probe1 A — a 3 cm blocker stops a full-speed run dead. probe4 5 — the ladder rescues it, with a 750 ms VAULT for a 10 cm kerb 30 cm deep.
**Commercial baseline:** Unreal `MaxStepHeight` 45 cm, Source 18 units ≈ 45 cm, Unity `CharacterController.stepOffset` 0.3 m. All of them do this in the mover, silently, with no animation.
**Fix:** in `stepGrounded`, when the sweep is blocked, retry the same sweep with the capsule's foot raised by the step offset; if it clears and there is head room and a support within the offset at the destination, accept and snap up. Raise `SUPPORT_SNAP_UP` to match.
**Cost:** 1–2 days.
**Risk:** medium. Changes what `STEP_UP` and `VAULT` fire on, and interacts with `STEP_DOWN` (0.35) and the published gap budgets. But it removes work from the ladder rather than adding it, which is the right direction. **In M1 today only 2 masses are under 0.5 m** (`PUMP_KERB` and `LAYING_STAGE`, both 0.34 m), so the immediate level-facing win is smaller than the feel win — be honest with yourself that this is a "make it feel like a real game" change more than a "fix M1" change. It will matter much more as street furniture lands.

### P3 — Depenetration every step
**Fixes:** "you glitch on objects", stuck-in-geometry after door/route changes.
**What is wrong:** nothing depenetrates; see Q3.
**Fix:** after the sweep in `stepGrounded` and `stepBallistic`, gather overlapping blockers via `blockerIdsAt`, compute each minimum-translation vector from `blockerContactNormal` plus penetration depth, and apply 3–4 resolution passes largest-first. Keep `depenetrateXZ`'s ring search only as the last-resort recovery it was written to be.
**Cost:** ~half a day plus tests.
**Risk:** low. There is nothing there now, so there is no established behaviour to break — but write the two-overlapping-blockers test first, because that is the case that makes naive implementations oscillate.

### P4 — Widen the ground probe from a point to the capsule
**Fixes:** falling off ledges you were standing on; floating off the edge of roofs.
**What is wrong:** `supportBelow` tests blockers with `intrudesXZ(b, x, z, 0)` (`collision.ts:1167`) and platforms with a bare `pointInRect` (`collision.ts:1170`). Both are zero-radius.
**Evidence:** probe1 B — supported until the *centre* leaves the deck, so 0.35 m of the body hangs over nothing and then 0.35 m of contact is lost at the moment of the fall.
**Fix:** probe at the centre plus four points at the capsule radius and take the highest valid support, or inflate the platform/blocker test by the radius for support purposes only. Note the deliberate negative margin in `platformCovers` (`collision.ts:448–464`) exists for mantles and must not be disturbed.
**Cost:** ~half a day.
**Risk:** low-medium. Makes the player "stickier" at edges, which is what commercial games do, but it will change `readEdge` and the edge brake, so re-check the rooftop route.

### P5 — Determinism hardening for the duel
**Fixes:** a class of cross-browser desync that has probably not been seen yet because everyone is testing in Chrome.
**Fix:** replace `Math.hypot` with `Math.sqrt(x*x + z*z)` and the `1 - Math.exp(-k·dt)` blend with a precomputed fixed-tick constant on the shared motion path (`playerMotion.ts:868`, `collision.ts` sweep helpers). Either make facing exact or exclude `yaw` from `hashPredictable`. Add an assertion that `stepMotion` is only ever called with `FIELD_DT`.
**Cost:** ~1 day.
**Risk:** low, but it will change every trajectory in the last few ulps, so any golden-value tests will need rebaselining. Do it in one commit.

### P6 — Stop silently discarding simulation time
**Fixes:** "the physics isn't consistent" under load.
**What is wrong:** `advanceFieldClock` drops steps beyond `MAX_CATCHUP_STEPS = 5` (`fieldSimulation.ts:88`). Live measurement showed 20 dropped in one short probe run.
**Fix:** surface `droppedSteps` (already tracked at `traversal.ts:809`) in the dev HUD so it stops being invisible, and consider raising the bound — 5 steps is 83 ms, which a single GC pause exceeds.
**Cost:** an hour.
**Risk:** very low. Raising the bound trades a longer hitch for lost time; measure before choosing.

### P7 — Lengthen the jump buffer, and hold a press across an authored verb
**Fixes:** the residue of "jumps are delayed".
**Fix:** raise `jumpBufferTicks` from 7 (117 ms) toward 12–15 (200–250 ms), and do not decrement the buffer while `busy` in `stepFlow` (`flow.ts:636`) so a press made during the tail of a climb fires on the first free tick.
**Cost:** an hour plus playtesting.
**Risk:** low, but it is a feel number — change it, play it, keep or revert. Do this one last, after P0–P2, because those change how often the player is in a verb at all.

---

## What is genuinely out of reach in a browser, and what is simply missing

**Out of reach, or not worth it, for R3F on a laptop:**

- Per-triangle collision against the actual GLB meshes at M1's density. The AABB / OBB / capsule proxy set is the right engineering call and I would not change it.
- Continuous collision against *moving* geometry (a swinging crane, a moving cart). Doable but a real project, and nothing in M1 needs it.
- Rigid-body dynamics — ragdolls, pushable props, physical debris. A JS physics engine at 60 Hz alongside R3F rendering on a school Chromebook is not a fight worth picking.
- Bit-exact cross-browser floating point in the general case. You can get the *motion path* exact (P5); you cannot get every library you might later add exact.

**Simply missing, and standard everywhere:**

- Step offset (P2). Every character controller has one.
- Per-frame depenetration (P3). Every character controller has one.
- A ground probe wider than a point (P4). Every character controller has one.
- A reachability test between "what geometry is near" and "what verb to offer" (P0/P1). Every context-sensitive traversal system has one — it is the whole content of Assassin's Creed's ledge-detection pass.

None of these four is expensive. Together they are the difference the owner is describing when they say Assassin's Creed and Fortnite feel real.

## What is already right, and should not be touched

Worth saying plainly, because the temptation after a list like the above is to rewrite things that work:

- The swept solve in `sweepXZ` is correct, is not defeatable at any speed I tried, and handles AABB, OBB and capsule footprints through one shared intrusion predicate.
- The fixed-step clock, and the discipline that every production caller passes `FIELD_DT`, is right.
- The input latch — edge-triggered, surviving frames with no ticks, cleared only on consumption — is right.
- The decision that dash and stagger are velocity substitutions into the ordinary integrator rather than authored phases is right, and is why a rooftop dash and a duel dodge behave identically.
- The ladder fall-through and jump guarantee added today (`flow.ts:704–766`) are right and fix a real measured stall.
- The duel is not exposed to the deck/blocker problem at all: its arena is blockers plus a single floor platform at `y = 0` (`duel/src/arena.ts:66–77`), and it does not use the parkour ladder. Scope P0/P1/P2 to the mission with confidence.

## Reproducing the measurements

The probe scripts are at `/tmp/audit/probe1.ts` … `probe7.ts` with an ESM `package.json` beside them. Run from the repo root so workspace resolution works:

```bash
node --import tsx/esm /tmp/audit/probe3.ts    # M1 census + the authored-link ladder survey
node --import tsx/esm /tmp/audit/probe7.ts    # how far inside decks the body rises
```

`probe3` and `probe7` are the two to keep as gates for P0 and P1. They take under 5 s each and they answer the two questions that the previous round of work got wrong in opposite directions: *does the ladder offer the authored route*, and *does it offer anything illegal*. Any change to `probe.ts` or `select.ts` should move the first number up without moving the second.
