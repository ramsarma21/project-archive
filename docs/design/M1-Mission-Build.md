# M1 Mission Build — readiness audit + staged plan for the Covenant signature run

Design of record for the mission fiction: `docs/design/M1-Remedial-Slice.md` (canonical loop =
the Solemn League and Covenant signature run, owner 30 Jul). This document is the **build-side**
companion: what exists, what is measured to be broken, what is genuinely new, and the order to
build it in. It replaces guesswork with numbers wherever it could.

**Provenance.** Read-only audit on branch `workflow/mission-audit`, worktree off `main` at
`49890ad` (verified). No code, content, asset, route or level file was edited. Claims are
grounded in the shipped checkers and the shipped route graph, run from this worktree; each
section says which instrument produced it and labels confidence. Where a load-bearing claim in
the brief or in `M1-Remedial-Slice.md` is contradicted by measurement, it is corrected here and
flagged — see **§7 Corrections**.

**The one thing to read if you read nothing else.** The owner's headline requirement — *"the
entire world must be traversable without touching the ground"* — is **not met today, and not
close.** Measured over the shipped route graph, there is **no** continuous rooftop/canopy/climb
path from the mission start to the elm, on any line: the elevated network fragments into three
islands joined only through the street. This is the single largest build item and it is a
level-authoring job, not a tuning pass.

---

## §0 The world today vs. the mission being built

The deployed mission is still `M1_EFFIGY_RUN` (1765 Stamp-Act effigy hanging):
`packages/mission-m1/src/level/index.ts` → `M1_EFFIGY_RUN`, run by
`apps/web/src/chapter/m1Mission.ts` (`title: "Nailed to the Post"`, concepts
`POSTWAR_REVENUE`/`STAMP_SCOPE`/`REPRESENTATION`). The lesson/hub already read 1774; the mission
internals do not. The Covenant run **reuses the same geometry, route and cast, re-themed** — it
is not a rebuild. The route sections (A leads → B Shambles → C Town House → D roofline → E
steeple → F elm → G yard) map directly onto the Covenant spine (start → market traders →
merchant's house → meeting-house → Liberty Elm → yard duel).

---

## §1 No-ground traversability audit — THE headline

**Verdict: FAIL. The world is not continuously traversable without touching the ground, on any
line.** Confidence: **high** — measured directly from the shipped authored graph, not eyeballed.

**Method.** Loaded `M1_EFFIGY_RUN` and ran `cheapestPath` / a directed BFS over `level.links`
(`packages/mission-m1/src/routeGraph.ts`, the same graph `wayfind.ts` uses). A node "touches the
ground" iff its authored `surface === "GROUND"` (the authoring convention; every street/square
node carries it, every roof/canopy/ledge names a deck or mass). Re-run from this worktree:
`node --import tsx <scratch>` over the level — numbers below are its output.

### 1a. What the numbers say

| Measure | Result |
|---|---|
| Route nodes standing on `GROUND` | **67 of 166 (40%)** |
| SAFE guided line START→POST (`A_START`→`F_POST`) | 51 nodes, 164.2 m, **11 ground-contact nodes** |
| SAFE guided line POST→ARENA (`F_POST`→`G_SPAWN`) | 12 nodes, 29.2 m, **8 ground-contact nodes** |
| A continuous **no-ground** path START→POST exists? (SAFE, and all lines) | **NO** |
| A continuous **no-ground** path POST→ARENA exists? (all lines) | **NO** |
| Aerial entries into the yard (link → a non-ground `G_YARD` node) | **none authored** |

The elevated network is **three disconnected islands**, each dead-ending into a forced descent:

1. **Island A — the printshop roof** (start). No-ground BFS from `A_START` reaches only ~11
   A-section roof/alley nodes, then every exit is a drop-chain to the street. Forced-descent
   frontier: `A_ALLEY_CRATES → A_ALLEY_FLOOR(GROUND)` and `A_HAY → A_STREET(GROUND)`.
2. **Island B–C–D–E–F — the long spine.** Once up the Town House scaffold, the path
   `C_SCAFF_1 → C_GALLERY_* → C_CLOCK → C_CORNICE → C_LEADS → D_GANTRY → D_SROOF_* → D_MEETING →
   E_RIDGE → E_LOUVRE → E_GALLERY → F_CROWN` is continuously elevated (≥2.9 m) all the way from
   the gallery into the elm crown. **This half already satisfies the requirement.**
3. **Island F — the elm boughs.** From `F_POST` the no-ground BFS reaches only
   `F_CROWN, F_POST_STEP, F_CROWN_E, F_LOW, F_AWNING`, then `F_AWNING → F_GROUND(GROUND)`.

### 1b. The forced-ground gaps, with node ids and what closes each

| Gap | Where the elevated net breaks (node ids) | Why it's forced | What would close it |
|---|---|---|---|
| **G1 — Start → Shambles tiers** (A→B) | Printshop roof exits only via `A_ALLEY_CRATES→A_ALLEY_FLOOR` and `A_HAY→A_STREET`. The Shambles mid-line (`STALL_*__CANOPY`, y 2.55) and high-line (`MARKET_SHED__ROOF`, y 5.6) are re-entered **only from ground feet**: `B_CRATES_FOOT(GND)→B_CANOPY_2_S` (CLIMB) and `B_PENTICE_FOOT(GND)→B_PENTICE` (CLIMB). | The printshop roof (y 7.1) has no authored link to any Shambles elevated node; both roof exits are drop-chains. | A new **elevated crossover** printshop-roof → market-shed-roof (a prop bridge — see §3, `gangplank`/`roof-plank-gantry`/`roof-walk-board-long`/`balance-plank` already exist as imported GLBs), **plus** an on-ramp onto the mid/high line that does not start on a `GROUND` node. |
| **G2 — Shambles tiers → Town House** (B→C) | Canopy/shed tier ends ~x 36–40 (y 2.55–5.6); ascent resumes at `C_SCAFF_FOOT(GND, x44.8)→C_SCAFF_1` (CLIMB). Guided line comes down through `B_STREET_E, B_EXIT, C_SQUARE_N, C_SCAFF_FOOT`. | No authored link bridges the market roofs to any elevated Town House entry (scaffold staging y2.9 / gallery y5.6); the scaffold is only mounted from its ground foot. | An elevated crossing over Dock Square (~5 m) from the east market shed to the scaffold staging or gallery — again a plank/gantry bridge or a new market-shed→scaffold gangway deck. |
| **G3 — Elm → Yard** (F→G) | `F_AWNING(y3.2)→F_GROUND(0)`, then the crowd-blend `F_STALL_BACK→…→F_CROWD_E→G_GATE→G_SPAWN`, all ground. No aerial yard entry exists. | The climax is authored as a ground crossing. | **Owner decision, likely leave grounded.** The `G_HAY` cover node (y2.2) carries a `LEAP_YARD_HAY` receiving-target tag but **no link uses it** — an elm-upper-bough→yard-hay dive could be authored if a no-ground climax is wanted. But per `M1-Remedial-Slice.md`, F→G is the *deliberate exposure* (post in the open → alarm → chased on the ground → cornered), so this gap is probably intended and should stay. |

### 1c. Reading of the requirement, and the one tension to resolve with the owner

The mission's own loop is "travel the high line, **pick a moment, drop to a contact, climb
back**" — so touching the ground *at a contact* is intended. The honest reading of "traversable
without touching the ground" is therefore: **the connective network between stops must offer a
continuous elevated path**, so that every ground contact is a *choice* (a drop to a contact or
the scripted climax), never *forced* by a hole in the roofline. Under that reading, **G1 and G2
are the real defects** (they force the ground with no elevated alternative), and **G3 is the
intended climax**. Recommend the owner confirm that framing before G1/G2 are scoped, because it
changes whether "the whole world" includes the final chase.

### 1d. Gate blindness (record this)

**No gate tests the no-ground property.** `traversability.test.ts` verifies every link is
physically performable, gaps are within budget, drops don't edge-brake, etc. — but nothing
asserts a continuous elevated path exists, so G1/G2 could regress silently. If no-ground becomes
a requirement, it needs its own gate (a graph check like the one run for this audit, cheaply
addable beside `traversability.test.ts`).

---

## §2 Parkour animation inventory

The engine's traversal vocabulary and its clip contract are authoritative in
`packages/engine-world/src/parkour/tuning.ts` (`AUTHORABLE_VERBS`, `PLAYER_NAMED_VERBS`) and
`parkour/clips.ts` (`VERB_CLIP`, `LANDING_CLIP`, `PARKOUR_CLIP_REQUESTS`). Per-verb fidelity
below is **measured** by `scripts/check-clip-fidelity.mjs` run from this worktree against
`playerboy-rigged.glb` with live IK (the renderer's own path). Confidence: **high** for the
measured rows.

### 2a. Per-verb status (measured)

| Verb | Clip | Status (check-clip-fidelity) | Detail |
|---|---|---|---|
| RUN / RUN_OFF | `run` | OK (locomotion) | Baseline locomotion; ballistic/passive, contact N/A. |
| STEP_UP | `stepUp`→ falls back to `run` | **FLAGGED — no dedicated clip** | Plays the `run` locomotion substitute (stride-matched, not verb-fitted). `stepUp` is unbaked. |
| SLIDE | `slide` | **OK** | 100% shown (2.78×); 7 planted samples, peak 2.09 m/s (within tolerance). |
| VAULT | `vault` | **OK** | 100% shown (4.0×); hands 0.04 m to top; **0 planted-foot slide, 0 clip-through.** |
| CLIMB_OVER | `climbOver` | **OK** | 100% shown (3.95× at 650 ms window); hands on top; no clip-through. |
| CLIMB_UP (mantle band) | `mantle` | **FLAGGED — minor** | Overruns the 900 ms window by 1.04× at the 4× cap → 97% shown; foot slide 0.25 m/s. Cosmetic. |
| CLIMB_UP (tall / ladder band) | `climbUp` (looping) | **NOT covered by this gate; known defect** | The fidelity gate tests a 1.9 m mantle, not a multi-rung ladder ascent. Ladder climb is a separate open defect: generic looping clip, planted foot sliding ~4.07 m/s, no tie to rungs, **and ladders carry no collision** (M1-STATUS Open). |
| HANG_DROP | `hangDrop` | **SEVERE** | 100% shown, but **the foot enters the wall by up to 26.5 cm.** The worst offender. |
| JUMP / JUMP_GAP | `jump` / `runJump` | Baked, not contact-gradable | Ballistic (integrator-timed); no authored window/surface, so plant-slide is N/A. Visual quality unmeasured here. |
| DASH | `dash` | Baked, not contact-gradable | Real one-shot clip baked (owner-requested); ballistic, contact N/A. |
| LEAP_OF_FAITH | `leapOfFaith` | Baked, not contact-gradable | Loopable swan dive; ballistic. Note a second bake `leapOfFaithDive` exists **baked but unplayed** (no verb/landing selects it — orphan). |
| Landings: LAND_RUN / LAND_ROLL / LAND_HARD / LAND_RECEIVED | `landRun`/`dropRoll`/`landHard`/`leapOfFaithLand` | **ALL FLAGGED — timing** | Clips overrun their recovery windows: 44% / 67% / 89% / 55% shown respectively. The clips are too long for the windows; they need shorter re-bakes (tuning comment says landing windows must not be widened — they are control-feel, not performance slots). |

### 2b. The jump-hang / freehangClimb claims — corrected

- **`freehangClimb` / `JUMP_HANG` are NOT on `main`.** A workspace grep finds them only in
  `assets/pipeline/mixamo_pull.mjs` (the puller). The on-`main` clip contract has no `JUMP_HANG`
  verb and no `freehangClimb` clip; `CLIMB_UP` resolves to `mantle` (short) or `climbUp`
  (tall/ladder). So "freehangClimb carries its ascent as root translation" and "the jump-hang
  clips were flagged unvalidated" describe the **paused `workflow/mission-world` branch**
  (`ab007f2`, `07eb7d2` — the jump-hang clip vocabulary the M1-STATUS ledger lists as post-demo
  polish, "do not merge without browser capture"), not the deployed mission. Confidence: **high**
  (grep + the ledger).
- Practically: if the Covenant run wants a jump-hang / freehang traversal verb (plausible for the
  new elevated crossovers in G1/G2), that work lives on `mission-world` and is unvalidated —
  treat it as new baking, not a reuse.

### 2c. What needs baking / fixing for "proper animations for all parkour"

Ranked by how visible the defect is:
1. **HANG_DROP** — fix the 26.5 cm foot-through-wall (SEVERE). Used on every controlled 2.2–3.2 m
   descent, i.e. constantly on a drop-to-contact mission.
2. **STEP_UP** — bake the missing `stepUp` clip (currently the run cycle).
3. **Ladder CLIMB_UP** — the looping-clip foot-slide + no-collision ladder defect (couples with
   the ladder rework already flagged open in M1-STATUS).
4. **The four landings** — shorter re-bakes so ≥90% plays inside the window.
5. **CLIMB_UP mantle** — trim ~3% (minor).
6. **JUMP / DASH / LEAP_OF_FAITH visual pass** — baked but not fidelity-gradable; needs an eyes-on
   capture, not a number.

Owner: VAULT and CLIMB_OVER are **already fixed** (measured OK) — the M1-STATUS "Open →
Animations do not match motion" list is partly stale on those two (see §7).

Lane: all of this is `mission-world` (`packages/engine-world/**`, `scripts/check-clip-fidelity.mjs`,
ladder assets/pipeline).

---

## §3 Contact population + asset gap

Confidence: **high** on the inventories (direct `ls` + the structures manifest); **medium** on
what each contact beat ends up needing, because that is a design call not yet made.

### 3a. Rigged cast — fully reusable (16 rigs present)

`apps/web/public/world/characters/`: `abigail`, `agitator`, `clarke`, `constable`, `dockhand`,
`goodwife`, `officer`, `pike`, `playerboy`, `rider`, `system-presenter`, `taxclerk`, `thomas`,
`towncrier`, `townsman`, `townswoman` (all `-rigged.glb`).

Every named Covenant contact already has a rig: **Thomas** (merchant), **Pike** (clerk),
**Clarke** (informer), **Abigail** (print-shop, hands over the Covenant), **Rider** (courier
network), plus **officer/constable** for the duel and patrols, **playerboy** for the courier, and
market/crowd bodies (`goodwife`, `townsman`, `townswoman`, `towncrier`, `agitator`, `dockhand`,
`taxclerk`). **No new contact rig is strictly required.** The one plausible new/re-dress is a
**billeted regular ("redcoat")** for the merchant's parlour — `officer`/`constable` are the
closest existing rigs and can be re-dressed; a dedicated regular is optional polish, not a
blocker.

### 3b. Interiors — the merchant's house shell ALREADY EXISTS (key correction)

The brief calls the "merchant's-house interior with billeted soldiers" the known new asset. **The
interior shell is not new.** `apps/web/public/world/structures/structures-manifest.json` ships 8
QA-passed four-wall+ceiling interior shells, including:

- **`int-shell-domestic-wide-b`** (18×3.8×14 m) — archetypes literally list **"merchant residence
  room"**. This is the merchant's house.
- `int-shell-domestic-narrow-a`, `int-shell-shopfront-a`, `int-shell-workroom-a`,
  `int-shell-warehouse-a`, `int-shell-civic-a`, **`int-shell-meetinghouse-hero`** (for the Hollis
  meeting-house stop if an interior is wanted), `int-shell-ropewalk-a`.
- Plus 2 partitions with doorways (`int-partition-board-a`, `int-partition-plaster-a`) and 3 floor
  tiles (`int-floor-wide-pine-a/b`, `int-floor-brick-work-a`).

The renderer `packages/engine-world/src/InteriorStructure.tsx` **works and is live** — it is used
by `apps/web/src/pages/hub/HubRoom.tsx`. **But nothing places an interior in the mission:** the
manifest's integration points at `packages/chapter-boston-world/*` (`InteriorDirector.tsx`,
`interiorManifest.ts`), which is the **deleted** Boston-chapter package (Unwired-Systems Tier 4).
So the *new work for the merchant interior is placement + dressing, not hero-asset generation*.

### 3c. Interior dressing + posting props — mostly reusable

From `apps/web/public/world/props/` (201 props). Reusable for the beats:

- **Merchant parlour dressing:** `bed-fourpost`, `table-chairs-set`, `hearth-mantel`,
  `storage-chest`, `clerk-desk`, `bookshelf-ledgers`, `candle-sconce`, `int-pantry-cupboard-stocked`,
  `tavern-table-set`. A domestic interior can be dressed entirely from stock.
- **The Shambles market:** `market-stall`, `market-awning`, `hand-cart`, `hay-cart`,
  `hay-wain-loaded`, `crate-stack`/`-mound`, `barrel-group`, `infill-service-shed`. Fully propped.
- **The Covenant posting / courier:** `notice-board`, `paper-satchel` (the courier's satchel),
  `coin-paper-set`, `int-paper-surface-flat`, `printshop-hanging-sign`.

### 3d. The genuinely new assets (pipeline: Gemini → Meshy → Blender → verify)

1. **Billeting military dressing.** The military prop set is **thin**: only `flintlock-pistol`
   and `colonial-door-kit`. No stacked muskets, bedrolls, packs, drum, or regimental kit to read
   "soldiers are quartered here." A small billeting prop set is the real new-asset ask for the
   merchant stop (not the room itself).
2. **No-ground crossover bridges (maybe zero new assets).** G1/G2 (§1) want prop bridges; the
   candidates **already exist**: `gangplank`, `roof-plank-gantry`, `roof-walk-board`/`-long`,
   `balance-plank`, `wharf-boardwalk-plank`. If those read correctly spanning the printshop→shed
   and shed→scaffold gaps, **no new asset is needed** — only placement + authored links + a clip
   pass. Verify by placement, not assumption.
3. **(Optional) a dedicated billeted-regular rig** if re-dressing officer/constable reads wrong.
4. **(Optional) the thrown-diversion object** — Unwired-Systems 1.3 notes there is no imported GLB
   for a thrown object; if the Covenant run wants throwable diversions, that GLB is genuinely new.

Do **not** build any of these in this pass; they are listed for the pipeline. Confidence
**medium** on the billeting-dressing scope (depends on how much the parlour must "read soldiers").

---

## §4 The stealth / patrol system — honest state (major correction to the brief)

Confidence: **high** on wired-vs-orphan (traced by grep to call sites + the mission tests);
**medium** on the effort estimates.

### 4a. The brief names the wrong files

`M1-Remedial-Slice.md` says `stealthStore.ts`, `stealth/alert.ts`, `StealthHud.tsx`,
`consequenceReceipts.ts` "exist unwired and are what patrols need." Measurement splits that claim
in two:

- **`stealthStore.ts`, `StealthHud.tsx`, `consequenceReceipts.ts`, `chapterWorld.ts`,
  `chaseFieldGating.ts` are Tier-4 orphans** (Unwired-Systems §4): their only references are the
  package barrel + their own tests. They are the **deleted Boston chapter's** HUD/store, which the
  mission container **already replaced** with its own equivalents (`MissionHud`, the level port).
  `consequenceReceipt()` is referenced only by its own test; `StealthHud`/`stealthStore` are not
  imported anywhere in `apps/web/src/mission/**`. **Reviving these four would rebuild a parallel
  HUD the mission already has** — it is almost certainly the wrong move.
- **`stealth/alert.ts` is not unwired at all.** It is one file in a substantial, tested
  `packages/engine-world/src/stealth/` subsystem — `alert.ts` (UNAWARE→CURIOUS→INVESTIGATING→
  SEARCHING→ALERTED escalation, shouts, call-propagation, hunts, diversions), plus `vision.ts`,
  `pursuit.ts`, `readout.ts`, `crowd.ts`, `noise.ts`, `suppression.ts`, `reflex.ts`, `field.ts` —
  each with tests.

### 4b. What is actually wired into M1 today

Traced in `apps/web/src/mission/traversal.ts` (the mission field step) and `m1Mission.ts`:

- **Patrols exist and are simulated.** `M1_EFFIGY_RUN.patrols` are cast as bodies
  (`watcherCast`), posed per tick (`watcherPosesAtTick`), and `stepWatcherPursuit(...)` runs every
  mission tick (`traversal.ts:1618`). `coveredAt`/`exposureAt`/`lightLevelAt` are bound in
  `m1Mission.ts`; `MissionHud` reads the stealth `readout` (its `cause` field was wired in the
  Unwired sweep). Covered by `apps/web/test/missionPursuit.test.ts`.
- **The "talk your way past a guard" mechanic already exists** — this is the biggest hidden asset.
  `packages/mission-m1/src/encounters/bank.ts` + `machine.ts` are two **perspective encounters**
  (`SHAMBLES_STOP`, `ROPEWALK_STOP`): a watcher stops the player and asks them to argue a case
  *that watcher* would credit; answered by the same responsive-dialogue surface, graded
  server-side (`@pa/grading` encounter bank), reprieve-on-correct (guards return to patrol),
  deterministic variants per seed, two-voices compliant, drift-tested. **This is exactly the
  owner's "caught → talk your way out" system, and it costs no new system** — as the owner
  predicted. It is real and wired.

### 4c. The genuine gaps (what reviving/wiring actually takes)

These are the Tier-1 unbound seams, not the orphan HUD:

1. **`onDetected` is unbound → being seen mid-route costs nothing.** `traversal.ts:1716` calls
   `instance.onDetected?.(read, field)` when the field reports `detected`, but `m1Mission.ts`
   binds no handler, so the `?.` swallows it. This is the seam the design's *"if you get caught on
   the ground you talk the guards out of it"* and *"accumulating-names heat"* hang off. Today the
   two encounters are **location-triggered scripted stops**, not **detection-triggered**. Wiring a
   detection-triggered talk-your-way-out = bind `onDetected` to arm an encounter (or a heat
   increment) as a deterministic function of tick+seed. **Real work, ~½–1 day + the design call**;
   the encounter machine it would trigger already exists.
2. **The encounters are on the retired concepts.** `SHAMBLES_STOP`/`ROPEWALK_STOP` still test
   `POSTWAR_REVENUE`/`STAMP_SCOPE` (M1-STATUS Open #1: tested-but-not-taught). Retargeting them to
   the 1774 slate (`INTOLERABLE_ACTS`/`REPRESENTATION`/`MERCANTILISM`) is part of the atomic
   content migration, and it spans **two lanes** (client prompts in `mission-cinematic`'s
   `encounters/**`; the reference answers/rubric in `boss-fight`'s `@pa/grading`).
3. **Stamina never tires anybody** (Unwired 1.4). The chase (`stepWatcherPursuit`) exists but
   `stepStamina`/`acceptTraversalStamina` have no callers on the mission path — a chase never
   costs stamina. If "escalating heat / a real chase" matters, this is a `StaminaState` on the
   runtime + a `stepStamina` per tick + 3 fields on the `freeMoveSpeed` call. Design call first.
4. **Thrown diversions are invisible** (Unwired 1.3): `previewThrow` and `liveDiversions` exist
   but nothing draws them and there is no thrown-object GLB. Optional for the Covenant run.
5. **Readout fields with no surface** (Unwired 1.1): `crowd.blocked`, `callInTicks`,
   `threatBearingRad`, `trend`, `lastSighting` are computed and unshown — each a line/glyph if the
   HUD wants richer "why were you seen" feedback.

**Net:** the stealth *simulation* (patrols/alert/vision/pursuit/crowd/noise) and the *talk-your-way-past*
mechanic are **already wired and tested** — the design's premise that patrols "need" the orphan
files is wrong. The real engineering lift is the **consequence layer**: bind `onDetected`, decide
the heat/accumulating-names model, retarget the encounters to the new slate, and (optionally)
turn on stamina. That is meaningfully smaller than "revive an unwired stealth system," and it is
the honest scope.

---

## §5 Staged build plan

Sequenced so the **patrol-evasion loop is provable early with 2–3 stops** before all four are
built (the owner's demo-scoping). Each stage names the lane(s) and the gate that proves it.

### Stage 0 — Retheme the mission spine (unblocks everything; atomic)
- Rewrite `m1Mission.ts` from the Effigy Run to the Covenant run: title, briefing, concept ids,
  objective labels (post the Covenant, not nail the handbill). **Moves together with**
  `apps/web/test/missionAttempt.test.ts:319`, which pins `title === "Nailed to the Post"` — the
  test and the retheme are one change or the tree goes red (M1-STATUS flag).
- Retarget the two encounters to the 1774 slate. **Two lanes, must sequence:** client prompts in
  `mission-cinematic` (`packages/mission-m1/src/encounters/**`), rubric/answers in `boss-fight`
  (`packages/grading`), and the drift test `apps/api/test/encounter-authority.test.ts` pins them
  equal. Lane: `mission-cinematic` owns `m1Mission.ts` + `encounters/**`; `boss-fight` owns
  `content/**` + `@pa/grading`. Gate: `verify:content`, `verify:units`, encounter-authority test.

### Stage 1 — Prove the evasion loop with 2 stops (the demo milestone)
- **Scope to the Shambles trader + one drop-and-return**, reusing the existing `SHAMBLES_STOP`
  encounter re-themed, plus the existing patrol/pursuit sim and the existing "talk-your-way-past"
  mechanic. No new geometry yet — prove the loop (high line → drop → talk/collect → climb back)
  on the ground the game already has.
- **Bind `onDetected`** (Stage-3 dependency, but a minimal version here) so being caught triggers
  a talk-your-way-out rather than nothing. Deterministic on tick+seed.
- Gate: `check-playthrough` (route advances, stops resolve, no soft-lock) + a new no-ground graph
  check if the owner wants G-gaps tracked from the start.
- **This is the demo-scoped early milestone**: patrol evasion + drop-to-contact + talk-your-way-out,
  2 stops, before the full four are built or the world is made fully no-ground.

### Stage 2 — Close the no-ground gaps G1 & G2 (the headline requirement)
- Level-authoring in `level-data` (`route.ts`, `geometry.ts`, `climbs.ts`): add the elevated
  crossovers so start→elm is continuously elevated. Try the existing bridge props first
  (`gangplank`/`roof-plank-gantry`/`roof-walk-board-long`/`balance-plank`) — likely **no new
  asset**. Author the links; verify every new link with `traversability.test.ts` +
  `assets:verify:affordances` + `check-playthrough`; add a no-ground graph gate.
- Parallel `mission-world` clip work (§2c): fix HANG_DROP (SEVERE), bake STEP_UP, ladder climb +
  collision, shorten the four landing clips. "Proper animations for all parkour" is a gate on this
  stage. **Sequence the clip fixes with the geometry** — the M1-STATUS note "climb paths are
  changing, sequence animations after ladders" applies.
- Confirm with the owner whether G3 (elm→yard climax) stays grounded (recommended) or gets the
  `LEAP_YARD_HAY` aerial dive authored.

### Stage 3 — The consequence layer (the real stealth engineering)
- Bind `onDetected` fully: detection-triggered talk-your-way-out + the accumulating-names heat
  model (each capture makes patrols know your face — pays off the boss's *"I'd know that face in
  any dark"*). Decide heat persistence + whether it scales duel difficulty. Deterministic on
  tick+seed (replay-safe). Optionally turn on stamina for the chase.
- Lane: `mission-cinematic` (`m1Mission.ts` binds the handler) + `mission-encounters`/`mission-world`
  as the mechanism lands. Gate: a behavioural test that the heat number *moves* (Unwired's rule:
  pin the observable, not the parameter).

### Stage 4 — Build out the remaining stops
- The **merchant's-house interior** (billeted soldiers): place `int-shell-domestic-wide-b` +
  partitions + dressing via the (to-be-rebuilt) mission interior placement; dress the billeting
  with the new military prop set (§3d.1); populate with re-dressed officer/constable/townsman.
  This is the one stop with genuinely new asset + new placement wiring.
- The **meeting-house** endorsement beat (reuse `ROPEWALK_STOP`'s relocated roof stop, or place
  `int-shell-meetinghouse-hero`), **Clarke** the informer, and vary the approaches (upper window,
  courtyard drop) so it is not four identical drop-and-return loops.

### Stage 5 — The climax
- Elm posting (the precision `F_POST` beat already exists) → alarm → chase east under max heat →
  officer corners at the yard → duel (`yardArena`, the duel already ships and greets *"You again"*).
  Mostly reuse; the new part is the heat-driven chase pressure from Stage 3.

### What must move together (do not split)
- `m1Mission.ts` retheme ⇄ `missionAttempt.test.ts` (title pin).
- Encounter prompts (`mission-cinematic`) ⇄ encounter rubric (`boss-fight`/`@pa/grading`) ⇄
  `encounter-authority.test.ts` drift test.
- The 1774 concept ids are one atomic content migration across module/duel/codex/capstone/mission
  (M1-STATUS "M1 content set is ATOMIC"). The lesson/hub half already merged; the mission half
  (encounters' concepts) is the remainder.
- Clip fixes ⇄ ladder/route geometry changes (`mission-world` ⇄ `level-data`).

### Lane ownership cheat-sheet (from `.cursor/lane-ownership.json`)
`level-data` → `route.ts`, `geometry.ts`, `climbs.ts`, `ropewalk.ts`. `mission-cinematic` →
`m1Mission.ts`, `encounters/**`, `opposition.ts`. `mission-world` → `packages/engine-world/**`,
ladder assets, `check-clip-fidelity.mjs`, `check-world-affordances.mjs`. `boss-fight` →
`content/**`, `@pa/grading`, `@pa/curriculum`. `api-hunt` → `apps/api/**`. Contested (need a
grant): `MissionRun/MissionHud/traversal.ts/devEntry`. Several build items cross lanes — sequence
via the orchestrator, don't `git add -A`.

---

## §6 Confidence & how to reproduce

| Claim | Instrument | Confidence |
|---|---|---|
| No continuous no-ground path start→elm→yard; 67/166 ground nodes; gap frontier node ids | shipped route graph (`routeGraph.ts`) via a read-only BFS/`cheapestPath` | **high** |
| Per-verb clip status (HANG_DROP severe, STEP_UP missing, VAULT/CLIMB_OVER OK, landings overrun) | `scripts/check-clip-fidelity.mjs` on `playerboy-rigged.glb` w/ live IK | **high** |
| freehang/jump-hang not on main | workspace grep (only `assets/pipeline/mixamo_pull.mjs`) | **high** |
| Merchant interior shell exists (`int-shell-domestic-wide-b`); renderer live in hub, unplaced in mission | `structures-manifest.json` + grep (`InteriorStructure` in `HubRoom.tsx` only) | **high** |
| Stealth sim + talk-your-way-past wired; orphan HUD files; `onDetected` unbound | grep to call sites (`traversal.ts:1618/1716`), `bank.ts`, Unwired-Systems §1/§4 | **high** (wiring) |
| Effort estimates in §4c/§5 | reasoning from the code, not measured | **medium** |
| G1/G2 closable with existing bridge props | prop inventory exists; not placement-verified | **medium** — verify by placement |

Reproduce the headline: from a worktree with deps installed,
`node --import tsx <graph script over M1_EFFIGY_RUN using routeGraph.cheapestPath / a no-ground BFS>`;
and `node --import tsx scripts/check-clip-fidelity.mjs`. (The audit's scratch graph script was
removed; the queries are one-liners over `M1_EFFIGY_RUN.links` and `surface === "GROUND"`.)

---

## §7 Corrections to the brief / design doc (say what changed and why)

1. **"The whole world is traversable without touching the ground" — FALSE today, measured.** Not
   a near-miss: post is unreachable from start with no ground node on *any* line; the elevated
   network is three islands. (§1)
2. **The stealth files the brief says to "revive" are the wrong ones.** `stealthStore.ts`,
   `StealthHud.tsx`, `consequenceReceipts.ts` are deleted-chapter orphans the mission already
   replaced; the live stealth substrate + the talk-your-way-past mechanic are already wired. The
   real gap is the unbound consequence layer (`onDetected`, heat, encounter retargeting). (§4)
3. **The merchant's-house interior is not a new hero asset.** `int-shell-domestic-wide-b` ("merchant
   residence room") exists and is QA-passed; the renderer is live in the hub. The new work is
   placement wiring + billeting dressing (thin military prop set), not generating the room. (§3)
4. **VAULT and CLIMB_OVER are already fixed.** `check-clip-fidelity` measures both OK (0
   plant-slide, 100% shown); the M1-STATUS "Open → Animations do not match motion" list is stale
   on those two. HANG_DROP (26.5 cm through-wall) and the missing STEP_UP clip and the landings
   remain real. (§2)
5. **`freehangClimb` / jump-hang are not on `main`** — they are the paused `mission-world` branch;
   don't cite them as deployed defects or reuse them as baked clips. (§2b)
6. **No gate protects the no-ground property** — if it becomes a requirement, it needs its own
   graph check beside `traversability.test.ts`, or G1/G2 will regress silently. (§1d)
