# M1 remedial slice — the design of record

> ## ⚠ CONTENT DECISIONS RESET — 29 Jul, owner
>
> *"forget anything weve decided about game and conent before this, we are at a fresh blank
> slate now in designing the mission"*
>
> **Void — do not author against these.** The four-concept slate; coercion-of-Boston as the
> physical spine; the June 1774 Port Act premise; the Solemn League and Covenant signature run;
> the four stops and their table; the signature-checklist objective; the casting proposals; and
> the duel/capstone mechanics chosen on 29 Jul (round floor, arm/starve ammo, capstone inclusion,
> baseline-in-the-lesson). All of it is preserved below as history, not as instruction.
>
> **Still true, because it is evidence or inventory rather than a decision:** the measured TEA
> item-analysis data and everything derived from *it*; the technical inventory of what exists and
> what is missing; the bible reconciliation (the Day-1 ↔ Mission-Slate conflict, the authored
> cast and their rigs, the two-voices rule, the annoyance budget, the stale cross-references).
>
> **Still true as product intent:** one lesson, one mission, one boss fight, one capstone, aimed
> at the most-missed concepts, and able to *show* measured improvement.
>
> Design the mission fresh. Consult the sections below only for facts, never for choices.

---

## The mission, designed fresh (PROVISIONAL — 29 Jul)

Owner's constraints: start from the **concept**; keep the existing world and cast but assume any
new beat, prop or interior can be built; teach **all** the concepts through checkpoints and
cutscenes, while the **overarching task across the whole mission is the single most-missed
topic** — the Port Act.

### The design bar

Not "a mission about the Port Act" but **gameplay only solvable by understanding it.** The
measured misconception is not that students fail to know the harbour closed; it is that 41–43%
read the closure as ordinary governance rather than as a punishment aimed at a whole town,
guilty and innocent together. So the mechanic must test one thing: **can the player predict the
blast radius?**

### The core loop

**Move relief supplies into a town whose harbour is shut, with less than everyone needs.**
Historically real — other colonies sent rice, grain and sheep to Boston during the closure.

The Act shapes both halves:

- **The route.** The wharf is dead and the water is closed, so relief comes overland and every
  yard of it crosses an occupied town. The closure is a traversal fact, not a caption.
- **The destinations.** This is where the concept bites. A player who believes this punished the
  tea-dumpers looks for the guilty and the political. A player who understands collective
  punishment finds the ropemaker with no ships to rig, the fishmonger who never touched politics,
  the carter with nothing to cart.

**Scarcity is the mechanic, not a restriction.** With enough relief for everyone there is no
judgment to make and nothing is tested.

### The checkpoints carry the other concepts, through the cast authored for them

| Checkpoint | Concept | Why this character |
|---|---|---|
| **Thomas** the merchant | The blast radius, *and* non-importation as resistance | Authored for boycott and trade; ruined by a closure he had no part in, and choosing not to import regardless |
| **Pike** the clerk | Consent — Parliament legislated with no colonial voice | Authored for stamped and legal papers; he knows what the Act actually says |
| **Clarke** the Loyalist | That the question was genuinely contested | Authored as informer; he thinks the town brought it on itself |
| **The ropewalk** | The closure's reach into ordinary work | Idle ropemakers because no ship needs rigging |

Per the annoyance budget and two-voices rule: each NPC argues their own position in their own
1765 words, and the handler adds **at most one clipped line** naming the vocabulary afterwards.

### The gameplay: the occupation IS the parkour (owner, 29 Jul)

An earlier draft of this design was four conversations connected by walking. The correction:
**put patrols on the street and make the ground "floor is lava."**

The route already has three parallel tiers through the Shambles — `street-line`, `mid-line` (the
stall canopies at `BAND.STALL_ROOF`), and `high-line` (the market shed roofs) — with authored
`crossover` points, then the roofline, the meeting-house ridge, the Liberty Elm's climb routes,
and the yard. `stealthStore.ts`, `stealth/alert.ts`, `StealthHud.tsx` and `consequenceReceipts.ts`
exist unwired and are what patrols need.

**This is not decoration bolted onto the lesson. The coercion concept IS the traversal.** What an
occupation feels like is being unable to use your own streets. The player learns it through their
legs before anyone says a word.

**The ground is dangerous and necessary, not instantly fatal.** Contacts are people and people
are at ground level, so the loop is: travel the high line, pick a moment, drop, do your business,
climb back. Descending is the risk. Vary the approaches so it is not four identical drop-and-return
loops — one contact at an upper window reached from the roof, one on the ropewalk structure, one
in a courtyard you must drop into.

**Escalating stakes.** The pledge accumulates names. Caught with one signature is a bad night;
caught with five exposes everyone who trusted you — the same collective punishment the mission
teaches, now aimed at the player. Being caught must not hard-fail (finishing is never blocked);
it costs the names.

**The climax inverts the whole mission.** A pledge nobody sees binds nobody, so the player must
climb the Liberty Elm and post it **in the open** — the one deliberate exposure after a mission
spent avoiding it. The alarm goes up, they run east under maximum heat, and the officer corners
them at the yard, which is where `yardArena()` already is. The route already runs Elm (F) → Yard
(G) in that order, so the geography supports it unchanged.

**A free gift:** `BOSS_CHALLENGE_BEATS` already opens with *"Hold there. You again — I'd know that
face in any dark,"* written assuming the player had slipped this officer twice. A patrol-evasion
mission delivers exactly that premise, so the existing lines land better than when they were
written.

**Runtime ratio:** mostly movement and evasion. Each conversation is a handful of lines —
punctuation, not substance.

### M1's content set is ATOMIC — rescoping is a migration, not a lesson edit (measured 29 Jul)

The single most important implementation fact found so far, and the reason the 1774 files were not
authored when the Archive interface was built.

`content/m1/verify.mjs` hard-couples `module.json`'s concept and cue ids to `concepts.json`,
`duel-items.json`, `codex-cards.json` and the capstone, and `apps/api/src/progression/content.ts`
mirrors the same ids with its own tests. So **changing the lesson's concepts alone turns
`verify:content` and `verify:units` red.**

That coupling is *good* architecture — it is what stops the lesson teaching one thing while the duel
tests another, which is the exact defect the unit-coverage gate exists to prevent. But it means:

> **Moving M1 to the 1774 slate is ONE atomic migration across the module deck, the duel bank, the
> codex cards, the capstone and the API content pack.** It spans the `module-lesson`, `boss-fight`
> and `api-hunt` lanes. Doing only the lesson half is not a smaller version of it; it is a red tree.

Do not brief "author the four files" as an isolated task again. Either commission the coordinated
pass or prototype the content outside the gates.

### The lesson baseline is blocked by an anti-cheat invariant, not a gap (measured 29 Jul)

Module checks are **client-graded** (the server only re-derives which checks are *required*). The
`concept_retrieval` ledger that records per-concept correctness is **server-minted and restricted to
`DUEL`/`ENCOUNTER` sources**, keyed to `duel_id`/`round_index`/`item_id`, on the stated principle that
"nothing a client sends can assert what it learned." `CompleteLearningModuleRequest`'s `clientSafe`
guard **rejects a `correct` key by design**.

So a lesson pre-measure needs one of:
1. **A separate, explicitly client-attested baseline** — never mixed with the trusted ledger.
   **← owner's default, taken 29 Jul.**
2. Moving module-check grading server-side, with the answer key in `apps/api`.

Either is a real design call. What must not happen is quietly widening the ledger to accept
client-asserted correctness, which would compromise the one trustworthy assessment record.

### Historical documents acquired (29 Jul, branch `workflow/m1-sources` @ `ebec302`)

Manifest at `content/m1/historical-sources.json`; images in `apps/web/public/historical/m1/`. All
rights verified, none fabricated.

- **File 1 (collective punishment) — STRONG.** The Boston Committee of Correspondence's port-closure
  circular states the thesis nearly verbatim: the wharves *"ravished from the rightful Owners… in
  Revenge to the Patriotism of some, whom probably this Clause was inserted to punish."* LoC, PD.
- **File 4 (non-importation) — STRONG.** The **Solemn League and Covenant**, June 1774 — which *is*
  the object the player carries. Printed by **Edes and Gill**, which is the press the existing boss
  cutscene already names (*"Edes and Gill's ink on your hands"*), written for the old 1765 premise.
  The fiction and the history align without anyone engineering it. Caveat: PD-by-age rather than an
  affirmative institutional statement, and only 572×1460.
- **Files 2 and 3 — GAPS.** No readable, cleanly-licensed period document for the Acts' scope or for
  consent. The good candidates are paywalled (Gale/ECCO) or request-only (MHS holds the Suffolk
  Resolves and a second circular). Options: send permission requests, or run those two files on the
  presenter with a supporting period image instead of a readable primary source. **File 2 is the one
  that teaches what saves the player from patrols, so it should not stay thin.**
- **Retire** the Wolfe painting and the 1766 repeal satire from the four files; **keep and retarget**
  the Stamp Act text (as the distinct *earlier* moment for the chronology point) and Revere's
  *Landing of Troops* (occupation atmosphere).
- **Content flag:** the *Able Doctor / bitter draught* cartoon names the Port Bill but includes the
  standard bare-breasted allegorical America. **Owner's default: use *Bostonians in Distress*
  instead** — same themes, no nudity — for a grade-8 product.

### Cutscene media pipeline (owner, 29 Jul)

Mixamo is out as the animation source. The owner's call, after considering real-time 3D: **generate
the cutscenes as video and play them as MP4s.** No rigs, no retargeting, no animation authoring, no
Blender round-trip. The hologram-projection framing is dropped as a rendering style; the Archive
showing you records during transport is the same fiction either way.

**The generated footage is CLEAN, REALISTIC period video — NOT hologram-filtered (owner, 30 Jul).**
An earlier proposal was to composite every clip under IRIS's hologram treatment (tint/scanlines/grain)
as a house style and slop-concealer. **Rejected:** it makes clips hard to read, hard to prompt for,
and less immersive. Show "history as it was" — realistic, period-accurate footage — and lean on a
strong prompt + the historical-QA gate for quality instead. Fiction: the Archive shows you a
reconstruction that looks like *being there*, and IRIS narrates over it. **The hologram look is
reserved for IRIS herself and the Archive UI (the room, chrome, case files) — never applied to the
reconstructed footage.** Do not re-introduce a scanline/tint filter over cutscene video.

**Render style: the game's own 3D-asset look, NOT photoreal (owner, 30 Jul).** "History as it was"
governs *content and staging* (accurate period detail, real events); the *render style* is stylized
3D matching our Meshy/GLB characters and world — a real-time game-cinematic look, not live-action
footage. This improves cohesion with the game AND cuts slop, because stylized 3D absorbs AI
artifacts that photoreal human faces turn into uncanny-valley tells. Two levers: (1) prompt anchors
— "stylized 3D rendered cinematic, real-time game-engine look, clean 3D character models, PBR, soft
GI, not photoreal," excluding "photograph/live-action/documentary/hyperreal skin"; (2) the reliable
one — image-to-video anchored on frames rendered from our OWN GLB characters/world (or the model's
character-reference/elements feature), so it matches our exact art style and locks character
identity across shots. A reference frame beats any text description of "3D".

Anti-slop then rests on: text-to-video with a strong, specific, period-accurate prompt in the game's
render style; an explicit no-baked-text clause (documents are real stills IRIS raises; subtitles are
our own UI overlay, never rendered into the frame); short cut shots; and the historical-QA +
`PROJECT_RECONSTRUCTION` provenance gates. Real curriculum figures may appear only where they genuinely fit, with an optional
context/dossier card, never forced (e.g. Samuel Adams with the Committee of Correspondence circular).

**BLOCKER — no video-gen tool in this environment.** There is no text-to-video API or key here (only
image gen + the Gemini/Meshy asset pipeline), so producing an MP4 needs the owner to provide access
to a service (Veo 3.1 or Kling 3.0 Omni recommended — both do native voiced lip-sync from a prompt)
or to generate the clip and hand over the file. The `ModuleVideo` playback slot already accepts a
real MP4; drop-in is one line in the file's scene.

**Three media, split by what each is good at:**

| Media | Carries | Why |
|---|---|---|
| **Generated MP4** | Action, people, places | The expensive half, now cheap |
| **Real image stills** (existing `ModuleVisual`) | Documents, maps, anything with text | Every model renders text as gibberish, and the lesson needs a period document readable for a line or two. `ModuleVisual` already carries `src`, caption, attribution, date, rights and a classification the validator will not leave blank |
| **Live 3D** (`SystemPresenter`) | The handler herself | She is a persistent character who also appears in-mission; she must not flicker between media |

**Tool:** **Kling 3.0 Omni** — up to six cuts per generation so one lesson beat is one job,
multi-character element referencing so each character stays themselves across shots, and native
synchronised audio, which deletes the TTS and lip-sync problem rather than solving it. Roughly
$0.17/sec, so a 60s lesson pass is ~$10. Seedance 2.0 is the alternative and is reported stronger
with multiple references. Note the leading *engine-native* tool, Kuaishou's Cutscene Agent, is
Unreal 5.6 only and does not apply to this stack.

**Style match — render the references from our own rigs.** A 5–10s reference clip beats a single
still for consistency. So render `thomas-rigged`, `pike-rigged` etc. turning and speaking in our own
engine and feed *those* as the character references; the generated video then inherits our character
designs and palette instead of inventing strangers. The bar is "not completely out of place", not 1:1.

**Two gates this must not skip:**
1. **Historical QA.** These models hallucinate period detail — wrong uniforms, wrong architecture,
   anachronistic objects. The project's law is that the world, events, documents and every
   historical claim stay accurate, and the asset pipeline already has a visual/historical QA step.
   Generated video goes through it.
2. **Provenance.** Generated video is a `PROJECT_RECONSTRUCTION` and must be classified as one. A
   student must never be able to file a generated clip as primary evidence.

**The only new plumbing:** a video variant alongside the existing image `ModuleVisual`. The
director already branches on whether a beat carries a visual, and `OVER_SHOULDER` → `VISUAL_FOCUS`
already handles "the visual dominates" — a video is a simpler occupant of that slot than an acted
3D scene would have been.

### Getting caught is a second teaching surface, not a fail state (owner, 29 Jul)

*"if you get caught on the ground, you have to talk the guards out of it understanding what they
want to hear historically, similar back and forth with hologram girl — so u cant really fail."*

The ground is floor-is-lava **in theory**, not in punishment. Caught, the player talks their way
out using the **same responsive-dialogue + handler-scaffolding mechanic** as the contacts, so this
costs no new system. **Failure becomes content** — which is the product's own remedial thesis
applied to its failure state.

**What the guard exchanges teach, and why they are not filler:**
- **The actual scope of the Coercive Acts.** The port was closed and assembly banned, but a
  print-shop runner carrying paper on a street was not itself a crime. The cover identity is a
  *legal* argument, so knowing precisely what was prohibited is what protects the player. This is
  a real incentive to understand the Acts exactly rather than as "the British were harsh."
- **The occupation from the soldier's side** — underpaid men billeted in a town that resented
  them, some taking civilian work to survive. Talking past one means engaging with what *he*
  believes he is doing there, which teaches the contested-question concept from the other
  direction.

**The cost, with no failure:** heat, and being remembered. Each capture makes the patrols know the
player's face better, which pays off `BOSS_CHALLENGE_BEATS`' existing *"You again — I'd know that
face in any dark"* — get caught often and the officer greets someone he has genuinely been chasing
all night. It can also scale duel difficulty, so sloppiness earns a harder fight rather than a
game over.

**It also produces assessment signal.** Whether the player talked their way out by understanding
what was prohibited, or the handler had to carry them, is per-concept data — so even the failure
state feeds the remediation record.

### Persuasion responds; it never refuses (owner, 29 Jul)

Contacts **answer from their own situation** rather than rejecting a wrong approach. A refusal
teaches nothing; a merchant saying *"my ledger's fine, boy — it's the harbour that's shut"* is
itself the lesson. Two or three exchanges, and the player adjusts.

If the player is clearly not landing it, **the handler drops one steering line** — remediation in
the moment rather than after the fact, and within the annoyance budget.

### Provisional calls (owner skipped the question; reverse freely)

- **Mechanic:** scarce relief distribution, not the licence/exemption puzzle. The exemption route
  teaches the Act's fine print; the distribution tests its *nature*, which is the measured error.
- **Consequence:** the people you skipped remain in the world, visibly worse, and Clarke reporting
  where the relief went costs you something. Without a reaction this degrades into a fetch quest
  with a quiz attached, which is the one failure mode to design against.
- **Failability:** finishing is never blocked. A wrong distribution is recorded as *not
  understood* and gets re-taught — remediation, not a wall.

### Open

- Whether the relief is a single carry or several trips, which decides the mission's rhythm.
- What "delivered wrong" looks like concretely enough to author and to grade.
- Whether Abigail and the Rider have roles here or sit this mission out.

---

One lesson, one mission, one boss fight, one capstone. The product is **remediation of
measured misconceptions**, not a survey of the Revolution. The world and its assets are
cheap to retarget; the learning design is the expensive part, so the concepts lead and the
world follows.

Owner's framing, 29 Jul: *"whats truly important is the learning, we can tailor the world
and mission around it. the ground important hting is that this is a remedial lesson +
mission + boss fight + capstone for most missed concepts."*

---

## The organising principle

**Teach against the distractor, not the topic.** TEA publishes per-option response rates,
so for each concept we know the specific wrong answer students actually choose. A beat that
does not surface and refute a named misconception is decoration.

Every authored unit — lesson check, encounter, duel item, capstone item — carries the
misconception it targets. If it cannot name one, it does not ship.

## Evidence basis

`content/staar/item-performance.json` (committed `d762a63`) holds TEA *Statewide Item
Analysis Summary Reports*: 200 multiple-choice items plus 8 partial-credit items across
five administrations (2018, 2019, 2021, 2022, 2023), each with per-option response
percentages, the official key, and the SE tested. 338k–415k students per administration.

These are **measured statewide rates, not proxies**. Baseline for comparison: across the
173 joined 2018–2022 items the mean is 57.3% correct, median 58%. 8.4(A) averages 46.2%.

Prior research in this repo assumed Texas published no per-item performance data. It does.
`content/staar/README.md` still implies metadata is the ceiling — that claim is wrong and
should be corrected when someone owns that file.

## The slate — four assessed concepts, chosen by miss rate

| # | Concept | Measured | The misconception to refute |
|---|---|---|---|
| 1 | **Consent to tax** — who may lawfully levy | 41% correct (2019 #24) | 38% answered a 1765 consent document with *Tea Party punishment*. Also: that the objection was the cost, not the authority. |
| 2 | **Coercion of Boston** — the punitive response, port closure, quartering | 41% / 43% correct (2021 #38, 2022 #4) | That Parliament's response was ordinary governance rather than punishment aimed at one town. |
| 3 | **Forms of resistance** — petition, congress, non-importation | 28% / 37% chose wrong forms | 28%: the First Continental Congress *declared war*. 37%: the colonies *taxed British imports* — a power they did not have. Boycott is confused with counter-taxation. |
| 4 | **Escalation** — cause into effect, with reasons | **18% full credit, 58% scored zero** (2023 constructed response) | Not a fact error. Students cannot chain an act to a response and say why. Highest zero-credit rate of any partial-credit item on that form. |

**War debt and revenue is taught as context, not assessed.** At 60% correct (2018 #5) it is
the easiest 8.4(A) item measured and the only one above the statewide mean, yet it currently
owns a third of the duel bank. It remains as the causal root that concepts 1 and 4 need —
Britain owes money, therefore it taxes — but it stops consuming assessment budget.

**Stamp scope is dropped as an assessed concept.** No released multiple-choice item tests
it; its only support was a rubric bullet. It survives only as narrative material if the
mission wants it.

Concept 4 is a *format* as much as a concept: it should shape how the boss fight and capstone
ask about 1–3, not only stand alone.

## The loop

All four surfaces carry the same four concepts. Nothing gets a surface to itself.

### 1. Lesson — cinematic, and the pre-measure

Built already, needs a script rather than engineering: `SystemPresenter.tsx` (rigged presenter),
`moduleShots.ts`, `moduleTimeline.ts`, `moduleVoiceover.ts`, `moduleLipSync.ts`,
`presenterGaze.ts`, `presenterHologram.ts`.

It does three jobs, and the third is easy to forget:

1. **Teach all four concepts** as cinematic beats, each one refuting a named distractor.
2. **Ask baseline questions** — the pre-measure the capstone is later compared against.
3. **Brief the mission in world** — what the occupation is and what the player is about to do,
   so they arrive oriented instead of being taught cold mid-level.

### 2. Mission — one physical spine, with stops that re-task you

The spine is **coercion of Boston**, chosen because it is tied-weakest *and* the only concept
that is physically traversable: a shut harbour, a house full of billeted soldiers, an assembly
that is now illegal. "Who may lawfully levy a tax" has nothing to walk through, so it belongs
to the presenter.

Shape: an opening objective, then **stop → cutscene → NEW objective**, repeating, then the yard
and the boss challenge. The objective surface exists (`MissionHud.tsx`, `traversal.ts`,
`levelPort.ts`) as does guidance (`packages/mission-m1/src/wayfind.ts`).

**The narrative spine:** June 1774. The Port Act has shut the harbour, troops are quartered, and
town meetings are outlawed. The player is a courier for the Committee of Correspondence carrying
the **Solemn League and Covenant** — the real non-importation pledge Boston circulated that
month — and must get it signed and posted. The player therefore *performs* a form of resistance
rather than reading about one, which is the concept a third of students get wrong.

The gamified objective is legible: **a checklist of marks to collect, then post the thing.** The
lesson hands the player that checklist, which is what its briefing job is for.

### The rule that keeps the stops honest

**The errand is why you are there; the concept is why it is hard.** A stop that exists so a
cutscene can fire is the popup problem in a more expensive costume. Every location below is
required to *complete the errand*, and the concept is the obstacle standing in the way.

| Stop | Why the errand needs it | The concept as obstacle | Refutes |
|---|---|---|---|
| **The Shambles** (market, `B_SHAMBLES`) | A pledge not to sell British goods is worthless without the marks of the men who sell them | The traders are already ruined by the port closure — the fishmonger who never touched the tea wants to know why he starves beside those who did. Collective punishment, argued by someone with standing | The 41–43% who read the coercive acts as ordinary governance |
| **A merchant's house** (needs an interior) | You need his mark | There are soldiers billeted in his parlour, so you cannot simply knock. Quartering is the *condition* of a signature, not a separate lesson | That quartering was billeting-as-usual |
| **Hollis Meeting house** (`HOLLIS_MEETING__ROOF`, where `ROPEWALK_STOP` now sits) | The Covenant needs the Committee's endorsement to carry weight | There is no meeting — assembly is illegal. With no body to endorse it collectively, the objective *rewrites itself*: collect marks one at a time | The 28% "declared war" and the 37% "colonies taxed imports" |
| **The Liberty Elm** (`LIBERTY_ELM_TRUNK`, F zone) | A pledge nobody can see binds nobody; the Elm is where Boston posts things | Posting it in the open under occupation is what brings the officer down on you | — |

**This gives the boss fight a cause rather than a location.** The duel is the consequence of the
player's last action, not a gate they wandered into. The officer's challenge is also where
*consent* enters directly — Parliament may lay what it likes, and the player has spent a mission
learning why that is contested.

**Escalation needs no beat of its own.** It is the order the player walked: the port shut, no
lawful remedy left, so this is what remains, and defiance brings the reckoning. That is why the
mission can teach the 58%-zero skill without lecturing about it.

**Every stop must satisfy one test:** the new objective has to be impossible, or done wrong,
without having understood the cutscene. If a player can skip it and still finish by ordinary
navigation, it is a popup wearing a cutscene's costume — and the popups were removed for exactly
that reason.

**Consequence for the level:** the current level is `M1_EFFIGY_RUN`, an effigy hanging, which is
a 1765 Stamp Act protest with no place in a 1774 Port Act premise. Retiring it also retires the
finicky clicker minigame the owner complained about.

**Possibly revivable rather than built:** `stealthStore.ts`, `stealth/alert.ts`,
`StealthHud.tsx` and `consequenceReceipts.ts` all exist with tests and are currently unwired. An
occupied town with patrols is what they are for. Their existence is confirmed; their quality is
not.

### 3. Boss fight

The main assessment surface. Card half deterministic, prose half graded, asked in the
two-causes-with-reasons shape. The round floor guarantees every concept is asked.

### 4. Capstone — the post-measure

Closes the loop and writes `concept_mastery`, which is the only thing the teacher report reads.

## Parallel forms — load-bearing, and easy to botch

The lesson baseline and the capstone must be **parallel forms**: the same concepts at matched
difficulty, drawn from **different items**. Identical items measure memorisation of four
questions; non-comparable items make growth uncomputable. The whole "we improve knowledge"
claim rests on this one property, so it belongs in the authoring rules and in a gate, not in
someone's memory.

## Reconciliation with the design bible (read this before authoring)

This document was written without the pre-existing design bible and then reconciled against it.
Three things matter more than the rest.

### This is a THIRD mission container, deliberately

The repo already holds two incompatible models, and `docs/design/Gameplay-Design.md` (~L449–453)
records the conflict as unresolved:

- **`docs/chapters/boston-1765/Day-1.md`** — an open ~25–30 minute Mission Day: four order-free
  errands, a day clock, People/Notes/Routes panels, in-world Syncs between errands.
- **`docs/chapters/boston-1765/Mission-Slate.md`** (25 Jul, declares itself authoritative) — a
  five-minute instanced sequence, 3:00 traversal + 2:00 duel, and explicitly **"zero knowledge
  checks … nothing in the three minutes stops for text."**

**The slice in this document contradicts both** — it keeps Mission-Slate's module→duel→capstone
loop but reintroduces Day-1-style in-mission teaching stops that Mission-Slate forbids, with no
time budget. That is an accepted owner decision, not an oversight, but it must be stated rather
than merged quietly. **When authoring the demo, this document wins.** Do not naively merge
Day-1's errand structure or Mission-Slate's 3:00/zero-checks rules into it.

Also stale and not to be followed: `Mission-Slate.md` §2.5 "the duel does not exist" (the duel
ships), `PRODUCT-REQUIREMENTS.md` §7's mid-day Sync loop, and `Game-Concept-The-System.md`
(superseded by its own banner).

### Use the authored cast — it exists, with rigs

Five characters are authored *and* have rigs in `apps/web/public/world/characters/`, which makes
the earlier suggestion of casting the King's officer as a lesson lecturer both unnecessary and
wrong (he would breach the two-voices rule the moment he spoke in meta terms).

| Character | Rig | Authored for | Role in this slice |
|---|---|---|---|
| **Abigail Mercer** | `abigail-rigged` | Chapter anchor, print-shop owner, gives errands | Prints the Covenant and hands over the errand |
| **Thomas** | `thomas-rigged` | Merchant; boycott/economics; opens the dock route | The merchant whose mark you need — non-importation *is* his concept |
| **Pike** | `pike-rigged` | Clerk; stamped/legal papers | What the Acts actually say; the legality of assembly |
| **Clarke** | `clarke-rigged` | Loyalist informer; stealth heat | Why posting publicly gets you caught; the quartered-house pressure |
| **Rider** | `rider-rigged` | Timed courier; network trust | The courier network the Covenant travels |

The learning module's presenter stays `system-presenter-rigged` (`SystemPresenter.tsx`,
`content/m1/module.json`). The duel opponent is the constable/officer. Do not cross those.

### Adopt the established vocabulary rather than inventing parallel terms

The bible has a full assessment lifecycle: a **tracked read** (a deliberate interact, never
proximity), an **Archive Sync** (the understanding gate, after ≥3 exposures), **Understood** and
a **Notes** entry, a **demonstration** (applied in-world, not a second quiz), and **filing**
("before we file, what actually changed here?"). The capstone reports the **first-attempt**
score, with fresh items on retry.

Our **baseline / parallel forms** is genuinely *new architecture*, not a relabel of Syncs — the
bible has no lesson pre-test. That is fine, but the growth claim needs its own machinery and
should be named in the bible's register where it overlaps.

Two established rules are non-negotiable and our stop design must obey them:
1. **Two voices.** NPCs know nothing of the Archive, the AR overlay, filing, or time travel.
   Only the handler speaks in meta/assessment terms.
2. **The annoyance budget.** The Archive is not the teaching instrument — prefer the world to
   teach, keep spacing between Syncs, and use the **implicit→explicit bridge**: the mechanic
   teaches the feeling, then one clipped handler line names the label. So at each stop the NPC
   argues their own ruin in their own words, and the handler adds at most one line of vocabulary.
   A handler-narrated concept lecture violates the design's own law.

### One chronology consequence

`Concept-Delivery-Map.md` places coercion and the Port Act in **A4 (1774–75)**, while M1 as
authored is the 1765 Stamp Act handbill run. A 1774 spine therefore relocates M1 in the chapter's
own timeline. The owner has ruled that acceptable ("Boston is Boston"), but the Act-level
delivery map no longer maps onto M1 and should not be followed for it.

## Authoring versus building

**Authoring only — the system already works.** The lesson cutscene script and shot list; the
boss-challenge lines (`BOSS_CHALLENGE_BEATS` is a plain `{phase, line, holdS}` array with
staging, a hard cap and a skip already proven); the stop cutscene lines and questions; the duel
and capstone item banks.

**Needs building.**
- Per-concept persistence for lesson checks. Today only a count of acknowledged checks
  survives, so there is no baseline to improve from. This is the demo's foundation.
- An encounter resolution that sets a **world objective**. The graded encounter machine
  (`packages/mission-m1/src/encounters`) currently branches into reprieve or pursuit; it needs
  to be able to re-task the player.
- The capstone guard removal, plus parallel-form item authoring.
- The duel round floor, wired to the authored `roundSchedule`.
- The boss ammo policy (wrong arms it, correct starves it) with the empty-boss cover fix it
  depends on.

## Decisions taken (owner, 29 Jul)

- **Coverage is guaranteed, not probabilistic.** The duel gets a round floor so every concept
  is asked before the fight can end. `content/m1/duel-items.json` already carries a
  `roundSchedule` of 6 — one concept pool per round — and it is **already consumed, but only by
  PvP**: `packages/pvp/src/questionPool.ts` reads it to build a per-round concept mapping. The
  boss duel ignores it and draws concept-blind, which is the actual defect. So the floor is
  mostly wiring: have the duel honour the same authored schedule, and the floor is its length.
  A prior audit called this schedule nonexistent; it exists, and one surface already reads it.
  Sharing it also stops the boss fight and the two-tab PvP demo drifting apart on which concept
  is asked when.
- **Wrong answers arm the boss; correct answers starve it.** Replaces the mirrored-ammo
  `SYMMETRIC_COMPLEMENT` behaviour, under which answering correctly made the fight *longer*
  (11.5 rounds vs 5.8) because the boss camped in cover.
- **The capstone ships in the demo.**
- **The lesson supplies the baseline** via per-concept check results.
- **Chronological fiction is not a constraint.** Boston across the period is in scope; the
  mission is not pinned to 14 August 1765.
- **Anything built may change**, including the mission premise and the encounters.
- **The mission has no time budget.** `Mission-Slate.md`'s "3:00 of mission, then a 2:00 boss
  duel" no longer binds: this is a demo and nobody will finish the mission in front of an
  audience, so the mission takes as long as it needs. Four stops with acted cutscenes are fine.
- **The boss fight must stay short.** Target the round floor at exactly the concept count (4)
  rather than padding it, which lands a full-coverage fight at roughly 4–6 rounds. Note this is
  *shorter* than today's correct-answer path (11.5 rounds), because the ammo change and the
  brevity goal pull the same way: starving the boss when the player answers correctly makes
  competence fast. Answer well, win quickly.

## Known interactions — do not implement these blind

- **Starving the boss will manufacture the dead air the owner filmed.** An out-of-ammo boss
  hides in cover: EMPTY occupied 27% of live combat on the correct-answer path. Rewarding
  correctness by starving it produces *more* standing-around unless it is paired with an
  empty boss doing something visible — breaking cover to reload in the open. Work toward this
  exists on the frozen `workflow/mission-encounters` WIP, which currently hangs its test suite.
- **A round floor needs a real mechanism.** If the floor is five rounds and the boss dies in
  three, there is nothing left to fight. Tune health so a competent player needs roughly the
  concept count in rounds; do not make the boss unkillable until the quiz finishes.
- **Both changes alter difficulty and are guarded by `winnability.test.ts`** ("every boss can
  win"; wrong-answer margin ≥1.15). Re-validate rather than assuming either is free.
- **Enabling the capstone is a guard removal, not an authoring marathon.**
  `bostonProgressionContent()` in `apps/api/src/progression/content.ts` returns
  `chapterConceptIds: () => []` and `assessmentId: () => null`, so every capstone mutation
  answers `PACKAGE_MISSING`. Its own comment explains why: covering M1's concepts would let a
  student pass on "a seventh of Boston" and open chapter two. **Under M1-only scope that
  premise is gone** — M1's concepts *are* the chapter. Removing the guard also makes mastery
  writes and PvP card legality work.
- **Verify whether a chapter two exists in the registry** before enabling capstone completion.
  `advanceChapter` marks the current chapter complete and creates the next; if a next chapter
  exists, `assessmentPassed()` reads the new one and would revoke PvP cards.

## What existing content survives

Measured on `main` at `4c16caf`: three concepts (`BOS.CONCEPT.POSTWAR_REVENUE.v1`,
`BOS.CONCEPT.REPRESENTATION.v1`, `BOS.CONCEPT.STAMP_SCOPE.v1`), 9 codex cards, 18 duel items
in 3 pools, and a capstone blueprint authored for exactly those three.

Only **representation** maps forward, becoming concept 1. Its cards are the strongest asset we
have — `CONSENT_GROUND` ("the objection is to who laid it, not to what it costs") states the
correct answer of the hardest measured item almost verbatim. Revenue demotes to context;
stamp scope drops. So roughly a third of the authored content carries over and the rest is
re-authored. That is the cost of pointing at the evidence, and it was accepted knowingly.

Known content defect to carry forward: `CONSENT_GROUND` and `LAWFUL_NOT_CONSENTED` are a
confusable pair (a principle and its rebuttal); the discriminator belongs in the question stem.

## Open

- Per-concept lesson check persistence — the baseline depends on it.
- Capstone item bank for the new slate.
- Teacher report reads `concept_mastery` only; the capstone shipping is what makes the
  retrieval ledger's evidence visible at all.
