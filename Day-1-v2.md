# Boston Act 1 — Build Script (Day 1 v2)

**Status: build-ready implementation script for Boston Act 1 (Stamp Act, 14 Aug 1765).**

This is the *coding* script: every beat states exactly what is shown, what the player does, **how it is animated**, what the **input** is, what **skill** it tests, what **state** it moves, and which **existing code** it hooks. It supersedes the prose beat sheet in `Day-1.md` §6 for implementation.

**Authority chain (unchanged):**
- `Day-1.md` — behavioral & curriculum fixture of record. Carriers, tracked payload (12 tracked + 3 Syncs), reroutes, and the fallback pool are **unchanged**. This doc never alters *whether* learning lands, only *how it plays*.
- `Gameplay-Design.md` — the gameplay/engagement design (two-budget model, six pillars, stealth, Standing, the Act/checkpoint structure). See esp. §7 (stealth), §8 (reactive world), §11A (segment map).
- `Interaction-Spec.md` — UX micro-rules (markers, glyphs, tracked-read grammar, camera, time model, feedback).
- `World-Design-Bible.md` + `apps/web/src/world/manifest.ts` — layout, coordinates, assets.

**Legend for every beat block:**

- **Cue / id** — the runtime cue or mechanic `promptId` (existing where known; `NEW:` where to be built).
- **Seg · Camera · Where** — segment number; camera (`1st` hands / `3rd` body / `overlay` / `cinematic`); zone or manifest anchor.
- **Shown** — what's on screen.
- **Action** — the player verb.
- **Animation** — explicit, obeying the **no-mocap law** (Production §1/§3: *confirm the action by animating the OBJECT; the character holds a generic library pose*). Sub-fields: `Object:` prop motion · `Body:` clip from the library · `FP:` first-person hands/prop · `New:` clips/tweens still to build · `Props:` GLBs.
- **Input** — keys / pattern / timing.
- **Skill** — `Effort` (unfailable) or `Graded` (composite score); floor (always-passes) + ceiling (mastery).
- **Stealth** — watcher/suspicion/heat/Standing/chase hooks (if any).
- **Outcome → state** — results and the state deltas they commit.
- **Learning** — carrier / exposure / Sync / demonstration / micro (tracked or ambient).
- **Access** — the accessibility-equivalent (FR-10).
- **Code** — files/systems to touch.

---

## 0. Global systems reference (read once)

### 0.1 Animation clip library (`animationManifest.ts` · `PLAYER_CLIPS`)

Available now (retargeted per character): `idle, walk, run, leftTurn, rightTurn, reach, search, carry, carryWalk, handoff, crouchIdle, crouchWalk, crouchLeft, crouchRight, crouchToStand, climbUp, climbDown, vault, work1, work2, cheer1, cheer2, talk, talk2, talk3, talk4, argu1, argue2, circleWalk1, circleWalk2`.

Queued with the `playerboy-v5-native` GLB (resolve to idle until it lands): `jump, runJump, knock, doorOpenInward, doorOpenOutward`. **`jump`/`runJump` are load-bearing for the chase (§ Segment 3 escape) — prioritize baking them.**

`PLAYER_ACTION_CLIPS` (play-once/clamp; physics owns displacement): `jump, runJump, vault, climbUp, climbDown, knock, doorOpenInward, doorOpenOutward`.

**No-mocap law (HARD):** a mechanic animates the **object/prop** and drives the **body with an existing library clip** (or a generic hold). Do **not** author bespoke skinned performances per beat. New *baked* clips are only requested where no reuse reads acceptably (listed under `New:` and collected in §0.6).

### 0.2 Mechanic-visual event protocol (`MechanicRigs.tsx`)

Mechanic controls dispatch `window` event `pa:mechanic-visual` with `{ kind, progress, active, phase }`:
- `kind`: `PRESS | EFFORT | SORT | PLACE` (+ `NEW: CHASE, STEALTH, STANDING` for this doc).
- `phase`: `READY → ACTIVE → COMMIT → COMPLETE`.
- World rigs read it and animate props; `Player.tsx` reads it for the body pose. **Reuse this bus for every new mechanic** so runtime/event semantics stay untouched.

Existing mechanic prompt ids: `PRESS_PIKE_PROOF`, `PIKE_REPRINT`, `FINAL_PRESS_PULL`, `THOMAS_HAUL`, `RIDER_QUICK_HANDOFF`, `RIDER_GAP_HANDOFF`, `EVENT_CLIMB/PUSH/CHANT`, `POST_NOTICE`, `CUSTOMS_SLIP`; sort bus `pa:sort-assign` (buckets `NEEDS_STAMP` / other). Cue ids incl. `DAY1_CUES.CATCH_SHEET`.

### 0.3 Compound-verb scoring (Gameplay-Design §6)

A **graded** activity = a chain of 2-4 micro-skill stages → one **composite** result. Each stage returns `0..1`; composite maps to bands: **crisp** (≥0.85 avg, no stage <0.6) · **usable** (default floor) · **smudged** (a stage <0.35). Floor guarantees ≥0.70 success/useful-partial (FR-3). Composite moves **relationship + object condition only, never the carrier** (learning is skill-independent).

### 0.4 Stealth state (Gameplay-Design §7)

- **Suspicion** (per active watcher, `0..1`): deterministic fn of cone-centrality · distance · concealment · movement · heat · Standing. Fills → challenge. Decays out of LOS. Diegetic tell as it rises.
- **Concealment** (contraband): `exposed | wrapped | hidden`.
- **Heat** (global band): `calm → noticed → watched → hunted`. Acute; decays.
- **Standing** (player card, band): social camouflage; built by unnamed-crowd interactions; modifies suspicion baseline + spot-check rate.
- **All deterministic** from authored patrols + player state + attempt seed. No live RNG.

### 0.5 Stamina (Gameplay-Design §7.6) — chase/effort sequences only

`0..1` bar, visible only during a chase or the timed rider dash. Sprint drains (~`0.28/s`), vault/climb costs a chunk (~`0.15`), walk/stop regen (~`0.22/s`). Empty → forced jog + fumbled (slow) vaults. **Never present in free-roam** — exploration stays relaxed.

### 0.6 New systems/clips to build (collected)

- **`NEW: WatcherDirector`** — posted + patrol watchers, vision cones, suspicion accrual, challenge trigger. Reuses NPC rigs (`officer-rigged`, `taxclerk-rigged`, constable re-tint) with `walk/idle/talk` clips; cone is a diagnostic/gameplay volume (invisible-procedural is allowed — Bible §12A). Act-1-first, reused Acts 2-4.
- **`NEW: ChaseDirector` + stamina** — pursuer path-follow (uses `run`/`walk`), stamina model, shake condition, the caught → "chewed-out" scene + reposition-outside-office + clock-advance.
- **`NEW: StandingCard`** — player reputation stat + accrual from unnamed interactions + suspicion modifier; renders as a player-facing People-style card.
- **`NEW: ReactiveNpcDirector`** — mobile named cast ad-hoc interactions (multi-input status) + unnamed interactable crowd + posters/objects micro logging.
- **Compound press** — extend `ProceduralPress` to 3 staged sub-mechanics (ink/register/pull) before the existing slam.
- **Baked clips to prioritize:** `jump`, `runJump` (chase). Optional nice-to-have: a `winded` idle variant (else reuse `idle`), a `shove` (else reuse the `EVENT_PUSH` staging + `reach`).

---

## Segment 0 — CP0 intake (Archive)

### B0 · intake & temporal insertion
- **Seg 0 · Camera:** overlay → `3rd` on materialize · **Where:** Archive UI → Mercer's exterior anchor.
- **Shown:** identity/mission window (Boston, 14 Aug 1765; cover = Mercer's runner), context record with a **real period article** enlarged in the holo, assignment ("Report to Abigail Mercer"), then dissolve into the street.
- **Action:** watch intake (≤25s), then move toward the shop (gold marker on Mercer's).
- **Animation:** `Object:` Archive holo UI + article plane. `Body:` `idle` in the holo, then `walk`/`run` on insertion. `New:` none.
- **Input:** advance intake (confirm); WASD/stick to walk.
- **Learning:** **①-exp1** `RCC.DEBT_POLICY_INTRO` (directed-scene type) commits during intake.
- **Access:** captions + reading-pace on the article; no time pressure.
- **Code:** existing intake overlay; `EntryDirector`/gold marker to Mercer's.

---

## Segment 1 — Mercer's Press

### B1 · entering the shop
- **Seg 1 · Camera:** `3rd` approach → threshold transition · **Where:** Mercer's door (interior `MERCER_PRESS`).
- **Shown:** door, press thumping inside.
- **Action:** choose how you enter (≤3): **knock / walk in / glance in the window**. Free (sets Abigail's first line only).
- **Animation:** `Object:` door swing (`DoorDirector`, `doorDelayMs` per choice). `Body:` KNOCK→`GESTURE`(talk2)+`knock` clip; WALK_IN→`walk`; LOOK_FIRST→`READ`(search). `New:` `knock` (queued v5). `Props:` `colonial-door.glb`.
- **Input:** pick option → `EntryDirector` plays the authored approach.
- **Learning:** — (framing).
- **Code:** `choiceAnimations.ts` (`choiceAnimationFor`), `EntryDirector`, `DoorDirector`.

### B2 · run a print job (COMPOUND-VERB — replaces the single pull)
- **Seg 1 · Camera:** `1st` · **Where:** press rig (`STAGE_ANCHORS.MERCER_PRESS_RIG`).
- **Shown:** Abigail mid-run ("You the new runner? Good, catch."), then the press. This is **Pike's proof** — the high-stakes job.
- **Action:** a 3-stage chain, then the existing slam:
  1. **Catch the sheet** — Abigail tosses a sheet, you catch it (existing `CATCH_SHEET`).
  2. **Ink the forme** — daub the ink balls across the type in an even rhythm.
  3. **Register the sheet** — lay it on the points, line it up.
  4. **Pull the bar** — the existing oscillate-accelerate timing needle → slam.
  5. **Peel & read** — lift the sheet; composite result shown.
- **Animation:**
  - `Object:` **(2)** ink-ball daub sweep across the forme (new prop motion on the press rig); **(3)** sheet plane slides/rotates onto the bed to a target register; **(4/5)** existing `ProceduralPress` lever sweep → platen slam → sheet glides out (`MechanicRigs.ProceduralPress`).
  - `Body:` `PRESS`(work1) held throughout; `CATCH`(reach) on the catch; hands stay on the rig (no-mocap).
  - `FP:` first-person hands on ink balls (2), on sheet corners (3), on the bar (4), peeling (5) — `FirstPersonDirector` prop overlays.
  - `New:` ink-daub + register prop tweens on the press rig (object-space; no new skinned clip). Reuse `reach`/`work1` for the body.
- **Input:** **(2)** rhythmic L↔R strokes (press-and-drag on beat) — even coverage scored; **(3)** drag sheet to align, release in tolerance; **(4)** commit in the green sweet-spot as the needle accelerates.
- **Skill:** **Graded**, composite of ink-evenness · register-accuracy · pull-timing (§0.3). Floor = "usable" via any completion; ceiling = "crisp".
- **Outcome → state:** proof condition `crisp | usable | smudged`. **Carries downstream:** crisp → Pike +Respect / Abigail notes care; smudged → problem at Pike (B6) + Abigail supervisory. No reprint at the shop — the smudge goes in the bag as-is.
- **Learning:** none gated by skill. (Stamp carrier is B3.)
- **Access:** simple confirm per stage → "usable" + identical learning.
- **Code:** extend `ProceduralPress` (add ink/register sub-phases on the `pa:mechanic-visual` bus, `kind:"PRESS"`); `CatchSheetToss`; `FirstPersonDirector`.

### B3 · compare the proofs (STAMP carrier)
- **Seg 1 · Camera:** `1st` · **Where:** the bench.
- **Shown:** the stamped legal proof beside the unchanged plain form, stamp corner vs. no-stamp corner (obvious in half a second).
- **Action:** **Read/compare** (free probe, tracked).
- **Animation:** `Object:` two document planes on the bench (`documentTextures`: `PIKE_PROOF_STAMPED` / `PIKE_PROOF_PLAIN`). `Body:` `READ`(search). `FP:` hands hold/tilt the sheets.
- **Input:** focus-inspect (in-range → interact → 1st person → read).
- **Learning:** **②-exp1** — `RCC.STAMP_INTERNAL_INTRO` **commits/banks here** (never lost by a failed Pike delivery). Field tag: "Stamp Act: internal tax on printed/legal paper, in force 1 Nov 1765."
- **Access:** captions, reading pace.
- **Code:** `FocusReadStaging`, `documentTextures.ts`.

### B4 · the assignment & free-roam exit
- **Seg 1 · Camera:** `3rd` (Abigail) / `1st` (load bag) · **Where:** shop.
- **Shown:** Abigail loads the bag — **four errands** (Thomas circular, Pike proof, rider handbills @ evening bell, Custom House notice + subscription). "Four stops. Rider goes at the bell. Street's already ugly." A shop visitor/Abigail seeds one **side-job hook**.
- **Action:** free-roam the shop (examine press/shelves/drying line — reactive flavor + seeded micro), then **step out the door when ready** (self-driven, no menu). Idle too long → Archive nudge.
- **Animation:** `Object:` interactable shop props (drying-line sheets, type case). `Body:` `walk`/`idle`; `READ` on examines. `New:` none.
- **Learning:** — (agency). Ambient wall bill ("NO TAXATION WITHOUT REPRESENTATION") = untracked support.
- **Reactive:** shop objects = **Knowledge** interactables (micro: the printer's trade, hard coin vs paper).
- **Code:** self-driven exit (no choice node); `ReactiveNpcDirector`/knowledge-interactable pass; idle-nudge = Archive.

---

## Segment 2 — into the street

### B4.5 · town notice-board (STAMP exp2, tracked)
- **Seg 2 · Camera:** `3rd` → `1st` focus-read · **Where:** notice board (~`[6,4.6]`).
- **Shown:** an official posted Stamp Act notice with an interaction glyph.
- **Action:** **Read** (tracked) the schedule of duties "to be in force the First of November," or keep moving.
- **Animation:** `Object:` poster plane. `Body:` `READ`(search). `FP:` none needed (board read).
- **Input:** focus-inspect.
- **Learning:** **②-exp2** (article type).
- **Code:** `FocusReadStaging`.

### Street opens · pick-one-focus + living world
- **Seg 2 · Camera:** `3rd` · **Where:** street spine.
- **Shown:** morning Boston — light crowd, first watchers (calm), zone audio. Four errands appear as **blue pings + strip lines**; pick one → gold, others hide (Interaction-Spec §1.2).
- **Action:** pick a run; explore; eavesdrop; meet mobile named cast; build Standing via unnamed chats.
- **Stealth:** **Standing** begins accruing from unnamed interactions; watchers introduced gently (low suspicion at morning).
- **Reactive:** ambient chatter (untracked, attributed subtitles); unnamed interactables build Standing; named cast may be out here.
- **Code:** pick-one-focus marker system; `PopulationDirector`; `WatcherDirector` (calm profile); `StandingCard`; `ReactiveNpcDirector`; `ambientAudio.ts`.

---

## Segment 3 — the four runs (order-free)

> After the **first** completed run, **B5.5** posts. Danger scales with the clock (Gameplay-Design §4A.2). Runs are pick-one-focus; the rider carries the bell/timed glyph.

### B5.5 · first-stop broadside (REPRESENTATION exp1, tracked)
- **Camera:** `3rd` → `1st` · **Where:** the exit wall of whichever stop you finished first (paste still wet — it wasn't there on the way in).
- **Action:** **Read** the broadside ("no taxation without representation"), or skip.
- **Animation:** `Object:` broadside plane (fresh-paste shader/decal). `Body:` `READ`(search). `FP:` optional.
- **Learning:** **③-exp1** (article). Also a diegetic time cue.
- **Code:** `FocusReadStaging`; posts once per run at the completed stop's exit anchor.

### RUN A — Thomas's circular (Heavy-haul)
#### B5 · Thomas Bell
- **Camera:** `3rd` talk / `1st` haul / `1st` read · **Where:** counting-house (`THOMAS_COUNTINGHOUSE`), or catch him mobile at market.
- **Shown:** Thomas pulling cloth before the street turns; port-duty notice on the wall. "It's not the shilling. It's the not being asked."
- **Action (≤3):** **help move & cover the cloth** (`costs time · earns a favor · opens the dock route`) / **beg off** (`saves time · no favor`) / **ask** "you think it comes to real trouble?" (free).
- **Animation (help = COMPOUND haul):** `Object:` bolt staging at the cloth stack → carried → snaps to counter (`HaulBoltStaging` + `CarriedClothBolt`). `Body:` `carry`/`carryWalk`. `FP:` none (gross-motor = 3rd). Chain: **load → balance → thread out the door** (3 effort beats).
- **Input:** rhythmic press-and-hold + drag, repeated (effort).
- **Skill:** **Effort** (unfailable); the favor is earned by the *choice*, not performance.
- **Outcome → state:** delivers `OBJ.THOMAS_CIRCULAR`; sets Thomas band; help → **Obligation** → dock route unlock. Time spent may tip the escalation curve.
- **Learning:** **③-exp2** (convo, in Thomas's lines while you haul); optional non-importation field tag.
- **Side-job hook:** "run this note to the tavern about the boycott meeting" (optional, non-carrier).
- **Access:** confirm-to-complete haul.
- **Code:** `THOMAS_HAUL` mechanic; `MechanicRigs.HaulBoltStaging`; dock-route state (already in runtime).

### RUN B — Pike's proof (Standard + skill payoff)
#### B6 · Pike, court clerk
- **Camera:** `3rd` talk / `1st` handoff · **Where:** `PIKE_OFFICE`.
- **Shown:** cramped office; Pike practical, harried. Two lines carry two exposures: **②-exp3** ("a tax on the very paper the law's written on") + **①-exp2** ("London had a war to pay for. Guess who they sent the bill to.").
- **Action:** **hand off** the proof, then a consequential-social choice about the **smudged proof** (if B2 smudged): **own it + offer reprint** (`costs time`, full loop → overshoots Respect) / **own it, let it stand** (recovers to baseline) / **brush it off** (`loses respect`). If B2 was crisp: quick warm handoff + optional probe.
- **Animation:** `Object:` proof plane passes to Pike. `Body:` player `HANDOFF`(handoff); Pike `CATCH`→`idle` (his hands stay low, `PIKE_MOTIONS`). `FP:` proof in hand on the pass. Reprint = travel loop back to press (`PIKE_REPRINT` = the B2 press mechanic again).
- **Input:** 1st-person handoff (press-to-pass); dialogue choice.
- **Skill:** the *proof quality from B2* lands here (Respect cascade); the choice handles the consequence.
- **Outcome → state:** `OBJ.PIKE_LEGAL_PROOF` delivered/missed/damaged; Pike **Respect** band (state-relative). Pike's People card unlocks here.
- **Learning:** **②-exp3 + ①-exp2**. **② completes → Sync 1** (Stamp understanding) right after handoff.
- **Access:** confirm handoff; captions.
- **Code:** existing handoff; `PIKE_REPRINT`; Sync 1 via Archive.

#### B6.5 · sort the papers (STAMP demonstration)
- **Camera:** `1st` · **Where:** Pike's desk. **Fires right after Sync 1 passes.**
- **Shown:** Pike shoves a stack: "Come November these all need the stamp, or they're worthless. Sort me the ones that'll need it."
- **Action:** **sort/flag** — drag each item (deed, court writ, printed newspaper, **personal letter**, **wooden tool**) into **needs-stamp / doesn't**.
- **Animation:** `Object:` fanned document/item planes slide to the chosen pile (`SortFanSlide`, bus `pa:sort-assign`, buckets `NEEDS_STAMP`/other). `Body:` `work2`/`READ` hold. `FP:` hands drag items.
- **Input:** drag-assign each item.
- **Skill:** **Graded-for-learning-demo** but **forced-correct-in-place**: a miss holds the scene, Pike nudges directionally ("Would the Crown fuss over what a man writes his sister? Think which is printed, or made official."), you must fix it to leave.
- **Outcome → state:** ② flips to **Demonstrated** (diegetic; no Notes flicker).
- **Learning:** ②'s day-of demonstration. Reroutes to B12 evidence pick only if ② wasn't Understood by here.
- **Access:** keyboard drag / cycle-and-confirm.
- **Code:** `SortFanSlide`, `useSortAssignments`, `documentTextures`.

### RUN C — Rider's handbills (Timed + STEALTH + chase)  ← signature run
#### B7 · Clarke, Loyalist shopkeeper + conceal
- **Camera:** `3rd` talk / `1st` conceal · **Where:** Clarke's doorway on the main road to the rider (or catch him mobile). Adjacency triggers his challenge from either side of the street; only the dock route avoids him.
- **Shown:** Clarke, tense. Bark → "Hold a moment. What's that you're carrying?"
- **Action (≤3):** **calm cover + wrap the bundle** ("overruns for the rider") → gamified conceal / **get curt** (`risky · reads as threat` → informer path) / **hear him out** (free, Loyalist perspective).
- **Animation (conceal = COMPOUND fold):** `Object:` plain wrap folds over the handbills, 2 tuck motions; **bill face legible while folding** (the tracked read). `Body:` `work1` hold. `FP:` hands fold the paper. `New:` fold prop tween (object-space).
- **Input:** drag/hold to fold, 2 tucks (effort).
- **Skill:** **Effort** (unfailable).
- **Stealth:** sets concealment `wrapped`; curt → Clarke may inform → **heat up**, arms caught-path. Clarke's read feeds Standing/Political-read.
- **Outcome → state:** `OBJ.CARRIER_HANDBILLS` concealment = wrapped; Clarke band.
- **Learning:** conceal branch = **③-exp3** (article/object, the up-close read). **③ completes → Sync 2** (representation understanding) on leaving Clarke's zone.
- **Access:** confirm-to-fold; captions.
- **Code:** conceal mechanic (`pa:mechanic-visual`, `kind:"EFFORT"`); `FirstPersonDirector`; concealment state; Sync 2.

#### B8 · the watched street (STEALTH traversal)
- **Camera:** `3rd` · **Where:** square filling toward the elm; watchers/constable working the crowd edge, checking bags.
- **Shown:** vision cones' diegetic tells; patrol paths; crowd as cover.
- **Action:** cross the watched zone. Choose route: **cross fast past watchers** (`saves time · risky`) / **back lanes** (`costs time · safe`) / **dock route** (`saves time · safe`, if Thomas favor). Use crowd-blend, cover, timing, concealment, and **Standing** to keep suspicion low.
- **Animation:** `Object:` watcher cones (procedural gameplay volumes). `Body:` `walk`/`run`/`crouchWalk`; `vault`/`climbUp` on traversal markers. `New:` — (reuses traversal clips).
- **Input:** movement + traversal-marker interacts; pace control (walk vs sprint).
- **Skill:** reading cones + timing gaps (skill, telegraphed).
- **Stealth:** suspicion accrues per §0.4; full → **B9** challenge. High heat/low Standing = harsher.
- **Learning:** how resistance moved through a watched town (passive).
- **Code:** `NEW: WatcherDirector`; `TraversalDirector`; `PopulationDirector` (crowd cover); `StandingCard`.

#### B9 · challenged → comply / talk / RUN (bounded, chase-eligible)
- **Camera:** `3rd` (chase) / `1st` (bag inspect) · **Where:** wherever suspicion filled.
- **Trigger:** suspicion filled, or Clarke informed, or high heat.
- **Shown:** officer/constable blocks you: "Hold. What's in the bag?"
- **Action (≤3):** **comply** (open bag — wrapped likely passes on a seeded draw; exposed → confiscated) / **talk your way out** (social draw, harder if Clarke informed) / **RUN** (`risky · draws attention` → escape sequence).
- **Animation (bag inspect):** `Object:` bag opens, contents shown. `Body:` `idle`/`READ`. `FP:` hands open the bag.
- **Learning:** field tag "writs of assistance: general search warrants…"; nuance (handbills aren't contraband yet). Never a dead-end.
- **Code:** `NEW` challenge node; bag-inspect (reuse focus grammar); routes to escape.

##### The escape sequence + stamina (NEW — Gameplay-Design §7.6)
- **Camera:** `3rd` · **Where:** the town as chase playground.
- **Goal:** **shake the pursuer** — break LOS + hold a gap ~4-6s, OR reach a refuge (thick crowd / enough alley corners / slam an interior door).
- **Action:** sprint, vault, duck, cut alleys, break to roofs; manage stamina.
- **Animation:** `Object:` slammed doors (`DoorDirector`), vaulted props. `Body:` `run` (sprint), `vault`, `climbUp/Down`, `crouchWalk`, `jump`/`runJump` (roof/puddle hops — **bake these**), `idle`/`winded` when catching breath. `New:` `jump`/`runJump` (queued — prioritize); optional `winded` idle (else reuse `idle`).
- **Input:** movement + sprint (hold, drains stamina) + traversal-marker interacts (each vault costs stamina).
- **Skill:** **stamina pacing** (§0.5) — burst to open a gap, spend a vault to cut a corner, break LOS, regen. Can't hold-sprint to win.
- **Stealth/pursuer:** authored speed a hair below fresh sprint; delayed by obstacles behind you; lost around corners/crowds; higher heat = faster/more pursuers. Deterministic (sim + inputs + seed).
- **Outcome → state:**
  - **Shake (success):** keep goods + errand; heat → **hunted**; face known (carryover). Reuse `CUSTOMS_SLIP` staging.
  - **Caught (stamina gone + gap closed / dead-end):** short **chewed-out scene** (inspector), contraband **confiscated** if carried, then **released outside the inspector's office, day visibly later** (clock jumps → escalation advances, a window may be blown), heat up. Never a dead-end; learning reroutes.
- **Access:** assist mode — slower/auto stamina, slower pursuer, or a confirm-to-resolve with the same bounded outcome; full keyboard path.
- **Code:** `NEW: ChaseDirector` + stamina HUD + pursuer AI; caught-scene transition + reposition + clock advance (reuse the interior-threshold + freshly-posted-broadside patterns).

#### B10 · the rider handoff (Timed)
- **Camera:** `3rd` approach / `1st` handoff · **Where:** rider post at the town edge (`STAGE_ANCHORS.RIDER_ACTOR`). Reachable until the **evening bell**.
- **Action:** **hand off** — **quick/open** (press-to-shove; `risky` if watchers near) OR **wait for a gap** (time a passer's crossing; safe, costs a beat).
- **Animation:** `Object:` bundle travels player→rider, snaps into grip (`MechanicRigs.RiderBundle`). `Body:` `HANDOFF`. `FP:` bundle in hand. Timed dash to reach the bell may use stamina.
- **Input:** `RIDER_QUICK_HANDOFF` (press-to-shove) or `RIDER_GAP_HANDOFF` (time the gap).
- **Skill:** **Effort**; quick = risky visibility draw, gap = safe.
- **Outcome → state:** `OBJ.CARRIER_HANDBILLS` delivered/missed/lost → §7 reroute; network's read on the runner (carryover). Miss the bell → missed → reroute.
- **Learning:** ideas/organized resistance spread via informal news networks (precursor to committees of correspondence).
- **Access:** confirm handoff.
- **Code:** `RIDER_QUICK_HANDOFF`/`RIDER_GAP_HANDOFF`; `RiderBundle`.

### RUN D — Custom House notice (Chokepoint + STEALTH)
#### B7.5 · the Custom House
- **Camera:** `3rd` enter / `1st` read + post · **Where:** interior `CUSTOM_HOUSE` (the most-watched zone; posted watchers + spot-checks; a bad spot-check is **chase-eligible** via B9).
- **Shown:** hall, counters, Crown's arms, public posting board; a harried clerk barks ambiently.
- **Action:** (1) **read** the Crown revenue proclamation (tracked); (2) **post** Abigail's notice — line it up + press-hold to tack (2 nail taps); when ① is Understood, place it **under the correct column** ("By order of Parliament, to raise revenue" vs distractors).
- **Animation:** `Object:` proclamation plane (read); notice plane lines up → tacks with 2 tacks (`MechanicRigs.PostedNotice`, `POST_NOTICE`). `Body:` `READ`(search) then `reach`/`work1`. `FP:` hands line up + tap tacks.
- **Input:** focus-read; then line-up drag + press-hold (2 taps); if demo, choose column.
- **Skill:** **Effort** post; the column pick is the demonstration (forced-correct-in-place).
- **Stealth:** chokepoint — suspicion pressure; spot-check possible; Standing helps.
- **Outcome → state:** notice posted (under a heading) / missed → reroute; subscription collected (flavor).
- **Learning:** **①-exp3** (proclamation, article) → **① completes → Sync 3**; posting under the right cause = **① demonstration** (reroutes to B12 cause-line if ① not yet Understood).
- **Access:** confirm tack; keyboard column pick; captions.
- **Code:** `FocusReadStaging`; `POST_NOTICE`; `PostedNotice`; `WatcherDirector` (posted profile).

---

## Segment 4 — dusk & the fixed event

### B10.4 · step into the gathering crowd (free-roam)
- **Camera:** `3rd` → `1st` (board read, if taken) · **Where:** crowd forming toward the square (time-locked, not errand-locked).
- **Shown:** distant chant, people drifting one way, light gone amber; a high-visibility board (③ reroute chance if short).
- **Action:** free-roam breather (~7s) → Archive warm steer ("The crowd's gathering, let's go check it out") + gold marker on the square. Optional board read.
- **Animation:** `Body:` `walk`; crowd `walk`/`argu1`/`argue2`. 
- **Learning:** optional **③** board (article) if a deficit remains; else ambient.
- **Code:** breather timer; Archive steer + gold marker; crowd surge (`PopulationDirector`).

### B10.5 · Archive synthesis / catch-all
- **Camera:** overlay · **Trigger:** errands done / dusk nears.
- **Shown:** short synthesis ("Cost, the paper, the war to pay for it. But something's got them angrier than a fee. Hold that.") — or a late-completing concept's **catch-all Sync** fires here.
- **Learning:** synthesis (no new Sync in the representative run); safety-net Sync if a threshold completed late.
- **Code:** Archive; Director Sync scheduling (≥2-interaction spacing).

### B11 · the fixed event (one cinematic, three on-ramps)
- **Camera:** `3rd` approach → **cinematic** observe · **Where:** elm pocket (dusk forced; bonfire light).
- **Shown:** organized protest — effigy paraded/burned, "To Fort Hill!", crowd obeys (raise→surge, point→turn).
- **Action:** one of three **state-gated on-ramps**, each keeping gameplay, all funneling to the same cinematic:
  - **Watch → climb:** state-gated climb (crates/ladder exist only now) → gold observe zone → "Observe the march." `EVENT_CLIMB` (+ `ClimbPerch`). Body: `climbUp` → `idle`.
  - **Push through → crowd-nav + unfailable dodge:** shoulder through; mid-push a thrown object → slow-mo **press to dodge** (unfailable). `EVENT_PUSH`. Body: `walk`/`run` + a lean/`vault`-ish dodge.
  - **Chant → hold-to-chant:** hold a key; chant anim; camera pans to the men at front. `EVENT_CHANT`. Body: `cheer1`/`cheer2` or `argu1`.
- **Animation:** `Object:` effigy, bonfire, crowd staging (baked). `Body:` per on-ramp above. **In-engine directed beat, not pre-rendered** (Production §7). `New:` none critical (reuse crowd/char clips).
- **Learning:** `RCC.ORGANIZED_RESISTANCE_EVENT` commits on the cinematic (any route). Field tag: "Liberty Tree…".
- **Access:** reduced-intensity recap (contract-bound); traversal skill never gates it.
- **Code:** `EventDirector`; `EVENT_CLIMB/PUSH/CHANT` (`MECHANIC_STAGE_OFFSETS`); `CameraDirector` detach.

---

## Segment 5 — return & headline

### B11.5 · Abigail's evidence desk (deficit-only)
- **Camera:** `3rd` return / `1st` source tray · **Where:** Mercer's, on return, before B12.
- **Shown:** Abigail's consequence-specific return line. **Normal run:** collapses to that line → B12. **Shortfall run:** B12 stays locked while the minimum authored source-desk actions become gold one at a time (handle/read the retained war-debt article, compare a stamped form, handle the town-instruction excerpt; Abigail adds a short conversation line).
- **Animation:** `Object:` source tray items. `Body:` `READ`. `FP:` hands on sources.
- **Learning:** closes exact concept deficits to 3 occasions / ≥2 types (fallback pool). Post-Sync re-exposure reserve lives here.
- **Code:** Event Manager audit; `FocusReadStaging`; conditional gold markers.

### B12 · set the headline (REPRESENTATION carrier + synthesis)
- **Camera:** `1st` / UI · **Where:** night, Mercer's. Abigail frames each step in character.
- **Day-completion Trust realization** fires here (Abigail reads the whole day's reliability → Trust delta + card).
- **Action:** **construct** — (1) headline (3 max: "MOB WRECKS STAMP OFFICE" miss / "BOSTON WON'T PAY THE TAX" partial / **"TAXED WITHOUT A VOICE"** target); (2) **cause line** (① — "By order of Parliament, to raise revenue after the war"); (3) **evidence pin** (② — the court **deed** vs Thomas's letter vs a wooden ruler); then **ink & pull** the final proof (compound press again, `FINAL_PRESS_PULL`, effort-driven variant).
- **Animation:** `Object:` movable type set into the stick; then `ProceduralPress` final pull (`PRESS_OUTPUT_FINAL` texture). `Body:` `work1`/`work2`; `PRESS`. `FP:` hands set type + pull.
- **Input:** pick headline → cause → evidence (each forced-correct-in-place on a miss, directional nudge from Abigail, never the answer); then hold-to-pull.
- **Skill:** the final pull is a compound-verb job (relationship/craft flavor only).
- **Learning:** ③ demonstration on the headline; ①/② re-exercised as synthesis (or catch-all demo if not done earlier). `RCC.REPRESENTATION_CAUSE` commits on `HEADLINE_CAUSE_COMPLETE` or `…CORRECTION_COMPLETE`.
- **Validity gate:** representation appears only if it cleared Learning + Sync 2.
- **Access:** keyboard construct; captions; simple-confirm pull.
- **Code:** headline construct UI; `FINAL_PRESS_PULL`; correction flow.

### B13 · day close → CP1
- **Camera:** `3rd` → overlay bloom · **Where:** Mercer's settles; headline drying on the line; invisible autosave.
- **Shown:** Abigail's end-of-day read; **warmth-gated branch** if enough Warmth banked (seeds Day 2 access — currently closed on the localhost fixture). Then the Archive full-screen **day-filed** card (headline artifact, concepts moved to Notes, relationship/route read) → Continue.
- **Carryover:** Abigail bands (Trust/Respect/Warmth); Thomas **Obligation**; **Clarke marked / heat / Standing**; handbill outcome (network trust).
- **Code:** Abigail close; Archive day-end overlay; commit.

---

## Segment 6 — CP1 (Archive re-insertion → 1770)

### CP1 · checkpoint debrief + re-insertion
- **Camera:** overlay (full-screen Archive) · **Where:** between Acts.
- **Shown:** atomic commit → **field debrief**: a few authored, TEKS-tagged **STAAR-style questions** on Act 1's macro (the three) + the **micro-concepts the student actually engaged** (curated set — enrichment, never pass/fail). No prior-Act retrieval yet (first checkpoint). Then re-insertion: the handler advances the clock to 1770, the world re-dresses (soldiers arrive), and Act 2 begins.
- **Learning:** formal assessment surface (Gameplay-Design §4). Route-independent formal record; not an official score.
- **Code:** `NEW` checkpoint/debrief overlay; STAAR bank selector (deterministic); carryover into Act 2.

---

## Appendix — reactive layer & side-jobs (run under Segment 3)

### Mobile named cast (the five — multi-input status)
Abigail, Thomas, Pike, Clarke, the rider are **out and about** and interactable ad hoc between scripted beats. Each ad-hoc touch: a `talk`-clip exchange, a small **micro** + a **relationship** nudge (status takes multiple inputs/day). Their standing **helps/hurts the day** and feeds stealth: tip a patrol, lend cover, vouch (bleed heat), or inform/refuse/raise suspicion. `Code: ReactiveNpcDirector` + mobile waypoints + `talk` clips.

### Unnamed crowd + posters/objects → Standing + micro
A curated subset of the crowd and world objects is interactable: exposition + optional **micro** (deliberate interact = tracking), and unnamed interactions **build Standing** (§0.4). Ambient (non-interactable) NPCs = attributed chatter only. `Code: ReactiveNpcDirector`, `StandingCard`, knowledge-interactable pass; `PopulationDirector`.

### Side-jobs (3-4, optional, non-carrier)
- **Tavern note** (from Thomas): deliver to the tavern keeper — micro (boycott organizing); warmth/relationship.
- **Dockhand haul**: get a barrel up the ramp before the tide — heavy-haul mini-game (effort); Standing.
- **Roof-kid**: shoo a goodwife's boy off a roof — pure traversal fun; Standing.
- **Town crier**: take up the cry for a stretch — flavor + spreads news (micro); Standing.
All: discoverable via interaction glyph, safe to skip, obey the two-budget law, never a required carrier. `Code: ReactiveNpcDirector` quest-giver subset.

### Flavor interactables
Bell rope, town pump, gulls, dog, tavern bench (existing `TRAVERSAL_SET` `INTERACT_FLAVOR` markers) — pure play; some seed micro in the air; double as **misdirection** tools during stealth (§7.7). `Code: TraversalDirector` flavor markers.
