# M1 remedial slice — the design of record

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
