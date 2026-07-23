# Boston Act 1 — Activity Expansion (a world alive with things to do)

**Status: the spec that fills the town with active, learning-bearing things to do** — both a new **interactive-NPC tier** that populates the explorable interiors and streets, and **five activity families** those NPCs hand out. Goal: GTA×Elden-Ring density — *wherever you go, someone has something for you to do, and doing it teaches you* — using **only deterministic preset content and reused assets** (no AI NPCs, no new character commissions; FR-8).

**Companions:** cast taxonomy = `Quests-and-NPCs.md` §6 (extended here); mechanics = `Mechanics-Spec.md`; lore = `Environmental-Lore.md`; content manifest = `World-Content.md`; interiors = `World-Design-Bible.md` §4 (all buildings enterable); grammar = `Interaction-Spec.md`.

**Design creed applied:** every activity below is Learning + Game-state + Fun (the triple bind). None is a macro carrier (skippable); each logs a **micro** on a tracked completion and moves Standing/flags.

---

## 0. These are TEMPLATES — curate and spread (do not cram into Act 1)

**The activity families, the occupant model, the mechanics, the lore tiers, and the feel-levers (`Activity-Feel.md`) are a reusable *template library* — the palette for the whole game, not an Act-1 checklist.** Each Act/Chapter/Season draws a **curated subset** that fits its era and its concepts. This is the same discipline as the "curated dozen micros per Act" law (`Gameplay-Design.md` §3): **quality and fit over volume.**

**Curation rules:**
- **Concept-fit first:** deploy a template *where its concept is being taught* — e.g., a *quartering* search-variant in Act 2 (soldiers), a *tea-dumping* mechanic in Act 3, a *port-closure route-loss* in Act 4, a *plantation-labor* work-job in the Virginia chapter. Don't place a template just because it exists.
- **Freshness budget:** each Act should introduce **1-2 new template applications** and **evolve** returning ones via World Turns (the ropewalk in an occupied 1770 feels different), so no Act is a rerun.
- **Novelty spacing:** across a single play-session, rotate the feel-levers (camera/tempo/input) so signature moments don't bunch up — the anti-sameness law (`Activity-Feel.md` §0) applies *within* an Act's curated set.
- **Franchise reuse:** the library is a Season-level asset. Philadelphia, Virginia, Frontier, and Civil-War chapters reskin the same templates with new concepts and props — huge production ROI (`Curriculum-World-Map.md`).

### Act 1 curated set (the tight, high-quality slice we actually build)

Not all ~80 instances — a deliberate subset sized to a ~25-40 min Act:

| Layer | Act 1 uses | Held back as templates for later |
|---|---|---|
| Mechanics | all 6 (Press, Search/writs, Ferry, Boycott, Rally, Relay) — all fit 1765 | quartering-search (A2), tea-dump (A3), port-loss (A4) variants |
| Trades work (A) | **2-3 signature**: ropewalk + dock-haul (+ optionally fish-flakes) | chandlery, bakery → dressed into later Acts/chapters |
| Signature drive (B) | **1 flagship** (non-importation, early form) | Daughters-of-Liberty spinning bees (A2), later boycotts |
| Postering (C) | **yes** (Liberty bills / "no consent") | propaganda-engraving posting (A2 Massacre) |
| Investigation/assembly (E) | **E2 Loyal-Nine** (marquee, Aug-14) + **E1 broadside** (if M5 room) | bigger committee-of-correspondence assembly (A3) |
| Sorts (F) | **Pike stamp-sort** (spine) + **1** optional (customs *or* ledger) | the other sort → later |
| Occupants | curated per zone (§4 density map) — quality lines, not every doorway | expand roster across Acts as the town re-dresses |

**Net Act-1 doing:** the 6 mechanics + a curated ~8-10 activity instances + threads/side-jobs/challenges + the texture layers — rich and full, but **not** the entire library. The rest is inventory for the years and places ahead.

---

## 1. The interactive-occupant model (deterministic, no AI)

**What it is:** most buildings are enterable and most street corners are peopled — so populate them with **occupants**: archetype-rig NPCs with a small **authored dialogue table** and, usually, **a task to give**. They are the delivery vehicle for the activity families in §3.

**The dialogue table (per occupant):**
- **Opening line** — 1 authored line, optionally swapped by 1-2 state conditions (e.g., Standing tier, time-of-day, boycott flag).
- **≤3 options**, each gated by world state (shown/hidden/reskinned — never generated):
  1. a **task/activity offer** (one of §3, or an existing side-job),
  2. an **info line** (logs a micro on finish),
  3. a **flavor / decline**.
- **Outcomes** are deterministic: give task → unlock; finish → micro log + Standing + a per-giver `met/helped/taskDone` flag.

**What state gates options (examples):** `standingTier`, `heat`, `boycottStanding`, thread flags (`ned.met`), whether the task is available/done, `dayPhase`. Gating is table-driven data, resolved at runtime — identical to the existing interaction grammar.

**Cast tier (extends `Quests-and-NPCs.md` §6):**

| | Named (5) | Thread figures (≤3) | **Occupants (many) — NEW** | Unnamed crowd |
|---|---|---|---|---|
| Rig | bespoke | re-tinted archetype | **re-tinted archetype** | archetype |
| Relationship model | 4-axis + political-read | 1 lite scalar + flags | **quest flags only** | none |
| Dialogue | authored, deep | authored, per-Act | **authored preset + ≤3 state-gated options** | none / barks |
| Gives | spine + arc | thread steps | **tasks/activities + micro** | Standing only |
| Cost | high (paid) | low | **~free (rig reuse + text)** | ~free |

**Why it stays cheap & safe:** occupants reuse the archetype rigs already in `animationManifest.ts` (`townsman`, `goodwife`, `dockhand`, `agitator`, `taxclerk`, `towncrier`, `officer`) with tint/scale/prop variation; all lines are authored text-slice content; no runtime generation; no 4-axis bookkeeping for the kid to track. The named five remain the only *relationships*; occupants are *people with things to do*.

**Density target:** **every authored-interior building has ≥1 occupant with something to do**, and each outdoor zone has ≥2 street occupants. A player who wanders into any shop finds an interaction, not an empty room.

---

## 2. Delivery rule (so it never becomes dialogue spam)

Occupant dialogue is **goal-first**: the opening line points at a *doing* (a task, a sort, a delivery), not a lecture. Micro is taught **through completing the task**, with at most one info line. This honors the "no dialogue spam" principle (`Gameplay-Design`): talk is the *wrapper* on an activity, not the activity itself.

---

## 3. The five activity families

Each: **verb/do · concept · where (grounded) · cost · consequence · micro · anim (no-mocap) · accessibility**. All reuse deployed assets/clips.

### A. Occupational work at the trades (compound work-jobs)
- **Do:** short compound work verbs at a trade, given by that trade's occupant — 2-3 held/timed stages with a clean-work grade (the Press pattern, generalized).
- **Concept:** `PORT_TOWN_BOSTON` + the trades; the **trade slump** is *felt* (half-empty racks, idle stations = the duties biting). Supports ①/economics.
- **Instances (all assets placed):**
  | Job | Occupant | Where | Stages |
  |---|---|---|---|
  | Lay cordage | ropemaker (`townsman`) | ropewalk [−103] | walk-the-line → twist → coil |
  | Dip candles | chandler (`goodwife`) | chandlery [−85] | wick → dip → rack |
  | Load the oven | baker (`townsman`) | baker shop (`sign-baker-sheaf`) | knead → peel-in → draw-out |
  | Turn the flakes | fisherwife (`goodwife`) | fish-flakes [−122] | turn → salt → stack |
  | Haul cargo | dockhand (`dockhand`) | apron [−134] | *(existing SJ-dock-haul)* |
- **Cost:** clock (activity-budget); clean work → Standing. **Consequence:** occupant warmth + a local rumor/route hint; repeated work reads you as a familiar face (social camouflage for stealth).
- **Micro:** `PORT_TOWN_BOSTON` (+ trade flavor). **Anim:** `work1/work2/carry` + object motion; no new clips. **Accessibility:** hold-to-complete, generous window.

### B. The non-importation signature drive (persuasion loop)
- **Do:** carry the merchants' **agreement** (item) to shopkeeper occupants across interiors; present it → each responds **by their situation** (signs / refuses / hesitates). Optionally cite **evidence you've seen** (a `LORE-*` you inspected — ties to provenance) to sway a hesitator. Progress = *X of N signed*.
- **Concept:** `NON_IMPORTATION` + **collective action** + **points of view** (economic position drives politics) + economic pressure. Supports ① and the free-markets/oppression patterns.
- **Where:** movement occupant or Thomas gives it (counting-house [−70]); targets are shopkeeper occupants in the row buildings + Sarah's stall + a Loyalist-leaning shop.
- **Reactions (authored, state-gated):** Thomas signs readily; the widow Sarah signs *at cost* (human toll); a Loyalist shopkeeper refuses ("I trade with whom I please"); a fence-sitter signs **only** if `boycottStanding` is high or you cite evidence.
- **Cost:** clock; **Consequence:** each signature raises `boycottStanding` → crowd warmth, Thomas/Sarah payoff flags into Act 2. **Micro:** `NON_IMPORTATION`, `LOYALIST_VIEW`. **Anim:** `talk`/`handoff` + the sheet object. **Accessibility:** pure choice, no execution skill.
- **Decision-frame (Archive R4):** *"(Every name makes the next merchant braver — or a target.)"*

### C. Postering / counter-postering (the free-press verb)
- **Do:** take **printed Liberty bills** (output of the Press mechanic — links §Press) and **post** them at marked spots (interior notice boards + street posts), or **chalk "no consent"** over a royal proclamation (`LORE-noconsent` seed). Watch/Loyalist occupants **react**: seen while posting at high `heat` → a watcher tears it down or marks you; a Loyalist occupant **counter-posts** a King's notice.
- **Concept:** **free press (21B)** + **propaganda** + the **divided town**. Supports ③.
- **Where:** given by Abigail (Mercer's) or the agitator; post spots along the central street (reuse crier call-spots x −8/6/24) + interior boards in the tavern, counting-house, Custom House vestibule.
- **Cost:** `heat` risk while posting (a public political act); **Consequence:** posting raises town sentiment (a `libertyPosting` flag → crowd lines, more Patriot barks); getting caught → heat↑, a torn poster. Deterministic. **Micro:** `NEWS_NETWORKS`, `PRINTERS_ROLE`; free-press pattern. **Anim:** reuse **`PostedNotice`** rig (`POSTED_NOTICE` cue, `MechanicRigs.tsx`) + `work1`. **Accessibility:** the post itself is a simple timed press; a low-heat window is always available.
- **Decision-frame:** *"(A posted bill is a printer's musket — and the watch knows it.)"*

### E. Investigation / assembly projects (day-spanning)
- **E1 — Assemble the broadside:** across the day, gather **3 source fragments** from occupants/lore (a paper *price* from the market, a *quote* overheard/authored from a bystander, the *proclamation text* from the notice board) → bring to Mercer's → **set + pull** them into a printed broadside (links the Press mechanic) → it becomes the **handbill the rider carries** (links the News relay). A project that threads three systems into one arc.
  - **Concept:** **primary-source analysis (8.29)** + how propaganda/news is *made* from sources; `PRINTERS_ROLE`, `NEWS_NETWORKS`. **Consequence:** a finished broadside boosts `libertyPosting` + rider trust; a partial one still prints (bounded).
- **E2 — Piece together the Loyal Nine:** optional investigation — talk info-figure occupants + read tagged objects to **identify who's organizing** the Aug-14 action (discovery, not handed to you).
  - **Concept:** **organized resistance is planned, not a random mob**; `LOYAL_NINE`, `EFFIGY_PROTEST`. **Consequence:** completing it unlocks the agitator dare / meeting early; it *reframes* the fixed event B11 as staged.
- **Anim:** `talk`/`work` + the Press for E1. **Accessibility:** fragments are collectible in any order; the Archive **Notes** tab tracks progress (soft, no waypoint).

### F. Classify / sort puzzles (quick skill beats)
- **Do:** short right/wrong **classification** beats (the Pike stamp-sort model), graded deterministically.
- **Instances:**
  | Sort | Occupant | Teaches | Micro |
  |---|---|---|---|
  | Stamp: needs-a-stamp vs not | Pike | the tax boundary | `STAMP_WHAT_COUNTS` *(exists, B6.5)* |
  | Customs: dutiable vs contraband vs free | customs officer [−56] | enforcement + what's taxed | `WRITS_OF_ASSISTANCE`-adjacent |
  | Ledger: imported vs local goods | Thomas | the boycott's economics | `NON_IMPORTATION` |
- **Cost:** clock; clean sort → Standing/warmth with the giver. **Consequence:** a botched customs sort → the officer is warier (heat texture). **Anim:** the existing sort-fan/slide rig (`SortFanSlide`, `MechanicRigs.tsx`). **Accessibility:** untimed; wrong placements just nudge back, never fail out.

---

## 4. Where it all lives (world-density map)

Proof the town is *packed*. Occupant = O, activity family in brackets.

| Zone | Occupants + activities |
|---|---|
| **Z1 Wharf** | O ropemaker [A], O fisherwife [A], O dockhand [A/haul], O ship's-mate (info) · postering spot (warehouse board) [C] |
| **Z3 West/market** | O chandler [A], O baker [A], O Sarah [B target/thread], O Loyalist shopkeeper [B refuse], O fence-sitter shopkeeper [B], Thomas [B giver/F ledger] · sig-drive route |
| **Z4 Central** | O Ned [thread], O tavern keeper (info+[C] board), O agitator [E2/C giver], O gossiping goodwife [B], Abigail [C giver] · 3 postering spots · broadside assembly [E1] at Mercer's |
| **Z5 Civic/east** | O Pike [F stamp], O customs officer [F customs/search], O sexton at churchyard (info) · Custom House vestibule board [C] |
| **Z6 Liberty pocket** | O agitator [E2 payoff], effigy assembly (event) · elm postering |

**Result:** every enterable interior on the main street has an occupant with a task; every zone has ≥2; the five families spread across all six zones so no area is a dead walk.

---

## 5. Build hooks & milestones

- **`ReactiveNpcDirector`** (Production Plan A.5, M3) gains the **occupant** category: home/street anchor, the authored dialogue table (data), option-gating resolver, `taskDone` flags, micro logging. Reuses the named-cast ad-hoc plumbing.
- **Activity families** map to existing rigs: work-jobs → `HaulBoltStaging`/effort; postering → `PostedNotice`; sorts → `SortFanSlide`; assembly → `ProceduralPress`. **No new clips; no new characters.**
- **Milestone fit:**
  - **M3 (reactive world + Standing):** occupant tier + families A, B, F (talk/task/sort — cheapest, highest density).
  - **M4 (stealth):** family C postering heat reactions (needs watchers).
  - **M5 (polish):** family E day-spanning projects + the Loyal-Nine investigation.
- **Content:** all occupant lines + reactions are **localhost text-slice** authoring (deterministic, SME-checkable). This is the bulk of the work — and it's text, not pipeline.

## 6. Cut / deferred
- **Coin economy — cut** (nothing to spend on in 1765 Boston; a currency with no sink is hollow). Hard-coin scarcity stays taught via the `LORE-coinpaper` inspectable + the stamp-must-be-paid-in-specie framing, not a wallet.

## 7. Open items
1. Confirm the **occupant count** target per interior (default: ≥1 authored-interior, ≥2 per outdoor zone).
2. Confirm **family E** (day-spanning assembly) scope for Act 1 vs. deferring E2 to M5.
3. Author the **occupant dialogue tables** (text slice) — the main content lift.
