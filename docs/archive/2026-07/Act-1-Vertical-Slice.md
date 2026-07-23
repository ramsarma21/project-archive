# Boston Act 1 — Vertical Slice (the thing we actually build first)

**Status: the bounded, playable target that proves the whole game before we scale it.** One continuous Act-1 run — **intake → roam → do → learn → prove (CP1)** — that demonstrates every pillar of "an alive 1765 Boston where everything teaches" with **one strong instance of each system**, at shippable quality, deterministic, on the Chromebook budget. It is deliberately *not* the full curated Act (let alone the template library); it is the smallest slice that makes the pitch undeniable.

**Authority chain:** this doc = *what's in the slice + build order*. Systems/formulas = `Act-1-Production-Plan.md` (M0-M5). Content = `World-Content.md`, `Activity-Expansion.md`, `Environmental-Lore.md`, `Mechanics-Spec.md`, `Archive-Spec.md`, `Learning-Ledger-Spec.md`. Handoff = `Act-1-BUILD-BRIEF.md`.

---

## 1. The thesis (what the slice must prove)

A player can, in one ~20-30 min run:
1. **Roam** the open town freely (GTA-ish) with a legible spine to follow.
2. **Do** the designated job + main-quest spine (guaranteed macros) **and** a taste of the optional alive world (one of each new pillar).
3. **Learn** by *seeing* (Found History) and *doing* (mechanics) — not by being lectured.
4. **Prove** it at CP1: the Archive mastery gate assesses the 3 macros + engaged micros, with memory-cued hints drawn from what *this* player saw.
5. Feel **consequence**: one skill-and-stakes encounter (stealth/search) whose outcome moves heat/Standing and the day.

If those five land and *feel good*, the design is validated and everything else is curation + authoring.

---

## 2. What already exists (build ON, do not rebuild)

Verified in the codebase (`apps/web/src`):
- **Runtime loop:** worker `RuntimeClient`, presentation directives, deterministic advance/snapshot, save/resume (`Play.tsx`, `runtimeClient.ts`).
- **Requests:** `FREE_ROAM` (movement + gold markers), `CHOICE`, `MECHANIC`, `FOCUS_READ`, `BREATHER`, `DAY_END` — with first-use primers.
- **World:** the full 1765 town (`manifest.ts`), player motion/collision, traversal markers, camera arbitration, interiors.
- **Mechanics:** the Press (`ProceduralPress`) + sort rig (`SortFanSlide`) + carry/haul rigs + `PostedNotice` (`MechanicRigs.tsx`).
- **Learning:** macro ledger + demonstration + `MasteryPanel` + the **Day-1 macro spine already ships** (3 macros delivered & assessed); `DAY_END`/debrief card.
- **Archive:** `ArchiveOverlay` (TODAY/PEOPLE/THREADS/NOTES/ROUTES) + `StandingCard`.
- **Stealth foundations (M0 + M1 in progress):** `stealthStore`/`StealthHud`, `fieldSimulation` clock, `actorRegistry`, `cameraOwnership`, `ConfrontationPanel`, field events, chase QA hooks.

**Implication:** the spine loop and the assessment loop are essentially working. The slice's job is to (a) finish the **stealth/consequence vertical**, (b) stand up the **alive-world tier** (occupants + one activity + Found History provenance), and (c) upgrade the **Archive to the full orchestrator** (frame/bridge/gate/hints).

---

## 3. Slice content — ONE strong instance of each pillar

| Pillar | Slice instance | Concept it carries | Status |
|---|---|---|---|
| **Spine — job + main quest** | runner for Mercer's: the Press job + the curated runs + the dusk effigy event | ①②③ macros (guaranteed) | mostly exists; keep |
| **Activity family** | **the ropewalk trades job** (new, signature feel) | `PORT_TOWN_BOSTON` | new (family A template) |
| **Interactive occupant** | **the ropemaker** (gives the ropewalk job, deterministic table) + **Ned** (Thread A opener) | `PRINTERS_ROLE` | new (`ReactiveNpcDirector`) |
| **Found History** | **4 inspectables**: notice board (stamp schedule), non-importation notice, type case, coin/paper | `SALUTARY_NEGLECT_END`, `STAMP_WHAT_COUNTS`, `NON_IMPORTATION`, `HARD_COIN_SCARCITY` | wire via `FOCUS_READ` + provenance |
| **Living route (fetch-gauntlet)** | **the tavern-note side-job**: back-alley route, avoid Clarke, duck/vault | `NON_IMPORTATION`, `LOYAL_NINE` | new; unlocks 1 owned route |
| **Stealth + consequence** | **the customs search/writs**: comply *or* evade → chase → escape → chewed-out → reappear later outside the office; moves heat/Standing | `WRITS_OF_ASSISTANCE` | finish M1/M2/M4 vertical |
| **Archive orchestrator** | intake (R1) + 1 decision-frame (R4, at the search) + 1 bridge (R5, after) + **CP1 gate** (R6) w/ escalating friction + **memory-cued hints** (R7) | assessment of ①②③ + engaged micros | upgrade existing Archive |
| **Ledger** | `provenance` on exposures + engaged-micro set → **fair CP1 sampling** | — | additive contract change |

**Cast in the slice:** the 5 named (exist) + **2 new occupants** (ropemaker, Ned as Thread-A) + the existing watchers. No more.

---

## 4. Explicitly OUT of the slice (deferred, already specced)

The other 4 mechanics (Boycott/Rally/Relay beyond what the spine needs), the other 4 trades jobs, postering/investigation/sort *variety*, the full occupant roster, Threads B/C, Acts 2-4, the **full** STAAR bank (the slice uses a **small authored placeholder set** — 1-2 items/macro + 1/engaged-micro), audio/vfx polish beyond the signature SFX. All are templates/inventory for after the slice validates.

---

## 5. Build order — slice-first increments (each independently playable)

Reordered from the M-milestones so we always have something end-to-end to feel.

**Increment 1 — prove the learning loop (roam → see/do → prove).** *(leans M3 + Archive + ledger)*
- Wire the **4 Found-History inspectables** (`FOCUS_READ` + `provenance`).
- Stand up **one activity** (ropewalk job) via the occupant + an existing effort/haul rig.
- Upgrade **CP1 debrief → the mastery gate** (escalating friction + at least generic hints) over the 3 macros + engaged micros; add `provenance`/engaged-set to the ledger.
- **Playable proof:** run the spine, see + do a few things, get assessed fairly at CP1.

**Increment 2 — prove the alive world.** *(M3 reactive tier)*
- `ReactiveNpcDirector` **occupant tier** (deterministic dialogue table + state-gated options + micro log + Standing).
- **Ned** Thread-A opener + the **ropemaker** occupant; the **tavern-note living-route** side-job (back-alley gauntlet, avoid Clarke, one **owned route** unlock + Archive R3 reminder).
- Archive **decision-frame (R4)** + **bridge (R5)**; **memory-cued hints (R7)** reading real provenance.
- **Playable proof:** the town has people with tasks; a fetch is a gauntlet; choices are framed and remembered.

**Increment 3 — prove skill + consequence.** *(M1/M2/M4 stealth vertical)*
- Finish **stamina + chase camera** (M1), **watcher/suspicion HUD** (M2), the **search→comply/evade→chase→escape→confrontation→reappear** flow (M4) with heat/Standing outcomes.
- **Playable proof:** the search is tense, evading takes skill, getting caught costs you and visibly advances the day.

---

## 6. Definition of done (slice acceptance)

- **Playable start → CP1** with no dev tools, on the Chromebook perf budget (≤4 watchers + crowd, within rig/cull caps).
- **All 3 macros** are delivered on the spine **and** assessed at CP1; the gate always passes but brute-forcing is throttled.
- **≥1 live instance of every pillar** in §3, each hitting the triple bind (teaches + moves state + fun) and reading as a **distinct moment** (`Activity-Feel.md`).
- **Fairness:** CP1 samples only engaged micros; hints only cue moments the player actually saw (provenance).
- **Deterministic:** identical seed → identical run; `npm run typecheck` + `npm run test` green; no regression in the existing Day-1 flow.
- **Kid-safe:** never stranded (Archive R2 rescue), never a hard dead-end, no reflex wall (accessibility equivalents present).

---

## 7. Open items
1. ~~Confirm the **activity instance** for the slice~~ — **BUILT: ropewalk** (2026-07-22).
2. ~~Confirm slice uses a **placeholder authored STAAR mini-set**~~ — **CONFIRMED**: dev fixture bank (3 macro + 14 micro DRAFT items) drives CP1 in `QA_DRAFT`; production stays content-gated until the SME bank lands (user to supply real items).
3. ~~Confirm **Increment order**~~ — moot; all three increments landed together.

---

## 8. Build status (2026-07-22 — slice systems COMPLETE, verified)

Everything below is implemented, typechecked, unit-tested (10 runtime + 202 web suites green), production-built, and browser-QA'd end-to-end (`assets/pipeline/qa_slice_browser.mjs`, 13 validated screenshots in `test-results/slice-visual-qa/`):

- **Ledger**: `ExposureRecord.provenance` on every tracked exposure (authored recall labels); `CONCEPT_META` classification; engaged-micro set; Tier-A Found-History inspects bridge to macro exposures (`LORE_MACRO_SUPPORT` in `tables.ts` → `Ctx.applyFieldEvent`).
- **CP1 mastery gate** (R6/R7, locked constants): memory-cue → explicit → elimination ladder with enforced dwell/pause, guaranteed passage, hint counts recorded, ≥2 hints → REVISIT + spaced re-test flag; presenter (`CheckpointDebrief.tsx`) renders the ladder with countdown + struck distractors; mastery panel shows engaged micros + per-item hints.
- **Stealth vertical closed**: `PLAIN_WRAP` no longer reads as contraband (COMPLIED_CLEAR reachable); customs checkpoints challenge EXPOSED goods even at CALM (concealment = the earned pass); caught chase → Standing −2 + clock +2 + reposition + **chewed-out constable beat** at the Watch House (`ReleaseSceneDirector`); lose-the-watch settles on comply/talk too.
- **Alive world**: **ropewalk trades job** (`SJ-ropewalk`, 3 staged verbs down the long hall → `PORT_TOWN_BOSTON` + Standing); Ned's 3-beat Thread-A arc (opener → covered-errand ask → settled); tavern-note completion unlocks the **owned route** `NORTH_ALLEY_ROUTE` (new `ReactiveCompletionEffects.routes`) with Archive **R3 approach reminders** (`RouteReminderDirector` + DOM toast); **R4 decision-frames** at Clarke/route-select/on-ramp + confrontation panel; **R5 writs bridge** after searches; +10 Found-History inspectables from the lore catalog (Tier-A/B/C mix on existing props).
- **Guardrails**: reactive exchanges withheld during BREATHER (runtime rejects non-FREE_ROAM interrupts); all interactions priority-arbitrated as before.

**Still content-gated (by design):** the real SME STAAR bank (production CP1 stays blocked until installed); dialogue copy pass (user-owned); Mixamo nice-to-haves (scolded idle, rope-laying walk) — current clips (`argu1`/`carry`/`work1/2`) read fine.
