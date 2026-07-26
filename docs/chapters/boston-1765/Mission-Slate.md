# Boston 1765 — Mission Slate and M1 Build Specification

**Status:** authoritative mission-authoring specification as of 25 July 2026, rewritten for the restructured game.

This document has two purposes:

1. preserve the fourteen-mission Boston slate in the repository; and
2. define M1 at implementation-ready resolution.

The original slate existed only in a design transcript. Its historical situations, names, scenario shapes, and phase structures are preserved here. Decisions recorded in this document supersede contradictory material in `docs/design/`, which is now stale — see the banner at the top of `docs/design/Game-Concept-The-System.md`.

---

## 1. Governing design laws

### 1.1 Mission form

- A mission is a **five-minute instanced sequence**, launched from the Archive Hub: **3:00 of mission, then a 2:00 boss duel.**
- Missions are **solo**. There are no companion NPCs.
- The existing open Boston district remains parked and untouched. Mission arenas may reuse its imported assets and spatial ideas, but they do not turn the district into the mission-select flow.
- The three-minute mission composes exactly two mechanical primitives:
  1. free traversal, parkour, and stealth; and
  2. osu-style precision interaction.
- A mission may re-dress those primitives, but it may not add a third mechanical family to the three-minute segment. The duel is the third family and it is fixed.
- **The three-minute mission contains zero knowledge checks.** There are no NPC dialogue checks, no in-mission questions, and no reading required while moving. It is pure uninterrupted gameplay.
- The activity is historically relevant to the mission's concepts, but it is expressed **physically, not conversationally**. What you handle, where you go, and what you avoid carry the history; nobody quizzes you about it mid-run.
- Reference feel: **Metal Gear Solid V plus osu.** Sneaking under and hiding under things, with osu-style timing for the activities. The osu difficulty stays low enough to play on a trackpad.
- Mission traversal is a continuous connected arena with multiple viable lines. Phase destinations name regions of one floor, not a sequence of `freeRoam` waypoints.
- Every mission is completable with **zero abilities**. Abilities make a first-try clear easier and are more fun to use; none is ever required.
- Every run varies through deterministic seeded selection from authored pools. Runtime selects authored content; it never generates historical claims, questions, routes, or answers.

### 1.2 Where the knowledge went, and why the pacing problem is solved

The previous design fought a budget war: knowledge beats had to be squeezed into pauses that already existed for mechanical reasons, `breathe` was policed so it could not manufacture a stop, and every mission's spec had to prove its talking seconds sat in a valley.

That whole apparatus is deleted, because **all knowledge assessment now happens in the boss duel.** The three-minute mission has no talking budget to allocate, no valley placement law to satisfy, and no pause hygiene to audit — it has zero seconds of stationary questioning by construction.

Record this as the reason: **the pacing problem is solved structurally, not by budgeting seconds.** Any future proposal to reintroduce an in-mission question is reintroducing the problem, not solving a content gap.

### 1.3 The boss duel

Every mission ends in one, and it is a **gun duel**. Guns are a deliberate, settled owner decision; this document records them so they are not re-litigated.

- The duel **opens with an animated face-off**.
- It runs **six rounds of 20 seconds** each.
- **Before each round the game pauses and asks a free-response question** on the mission's concepts.
- **A wrong answer grants 1 bullet. A correct answer grants 3.** This bullet economy is the core mechanic: knowledge converts directly into a resource, and a mechanically strong player can still win on one bullet.
- Normal movement and dodging apply throughout the 20 seconds. **Any ability unlocked in the current chapter may be used.**
- **The boss conveniently breaks line of sight every 20 seconds** to justify the round boundary. In this era the honest fiction is a reload: a flintlock takes about that long to bring back into service, so the round clock and the weapon agree.
- **Harder missions have more powerful bosses** with more capable move sets. That is the only difficulty axis the slate has.
- Heavy writing in the duel is acceptable, because the preceding three minutes are pure play. This is the one place in the mission where reading volume is not a pacing cost.

Two tuning questions are genuinely open and must be settled during the M1 build, not guessed at in authoring:

- whether unspent bullets carry between rounds; and
- the boss hit and health model that keeps a one-bullet round winnable without making a three-bullet round trivial.

### 1.4 One difficulty

There is **no Easy mode**. One difficulty for everyone.

Deleted outright: the two-mode Normal/Easy model, the automatic Easy retry, the five difficulty bands, mission levels, the player-minus-mission delta, hidden per-player easing, and the mechanical-axis half of two-axis failure diagnosis.

What remains:

- **The input bar is authored once**, low enough for a trackpad, and never moves. There are no modes to move it between.
- **Failure diagnosis is single-axis.** A mission attempt either clears or it does not. There is no inference about which axis failed, because the mission no longer measures knowledge — the duel does, per question, per concept, which is a finer signal than the old two-axis machinery ever produced.
- **Difficulty scales through the boss.** Later missions get more capable bosses; the three-minute floors get denser routes and tighter patrols, authored at one setting.

### 1.5 Learning modules, attempts, and XP decay

**Learning modules are always exactly 3 minutes.** The former 90-second briefing does not exist anywhere; every reference to it is replaced. A module is required before the first attempt on a mission, and required again before each retry. **A module pays zero XP, always.**

**XP has exactly one payer: completing a mission.** Modules pay nothing. The chapter capstone pays nothing. This was decided twice and firmly; it is not to be softened.

Attempts are finite and the payout decays:

- **Attempt 1**, after the module: maximal XP.
- **Retry 1**, after redoing the module: two-thirds XP.
- **Retry 2**, after redoing the module again: one-third XP.
- After two retries the mission is **failed**. The player advances to the next mission and earns zero XP from it.

There are **no further replays**. Attempts are spent permanently. What is done is done.

Catch-up happens on later missions, not on this one: each mission carries its own fresh XP schedule, so a player who improves earns full XP going forward. Getting better is rewarded; early failure has a permanent cost.

### 1.6 Progression, Rank, and abilities

- A player starts at the hub at **Level 0, 0 XP, Rank 1**.
- **Ranks are integers.** The E-through-S lettering is cut entirely.
- **Every ten Levels advances one Rank.**
- **The chapter capstone does not affect Rank.** It is purely a content gate that unlocks the next chapter. Nothing in the chapter gates anything else.
- **Abilities unlock at Level milestones.**
- Abilities are **chapter-scoped in PvE** and reset each chapter. Every ability ever unlocked is **permanently added to the PvP loadout**.
- **Magic and fantastical abilities are explicitly allowed**, justified by the time-traveler fiction. The earlier historically-grounded-only constraint on the player's own kit is deleted. The boundary is narrow and firm: **the world, the events, the documents, and every historical claim stay accurate.** The runner's abilities are the licensed exception, because the runner is the one thing in the scene that does not belong to 1765.
- **No mission may require an ability.** Every mission is completable with base movement and the precision verb alone.

No XP curve exists in the repository. This document therefore records ordering constraints, not invented XP values.

### 1.7 Grading architecture

The duel's free-response questions are graded by **classification against an authored rubric, never by generation.**

- **A large question bank is pre-authored**, and each item carries the question, the acceptable answers, the rubric, and the associated Codex cards.
- **The model's only job is comparing a player answer against an authored rubric.** That is classification, not generation, so a small fast model suffices.
- **Commit the verdict as the event; never the raw text.** The runtime is event-sourced and replays committed events, so raw model output would break determinism. The codebase already commits rubric labels rather than prose — see `DeterministicResolution` and the rubric label set in `packages/contracts/src/openResponse.ts` — and the duel follows that pattern.
- **Hard timeout:** if grading exceeds roughly 1.5 seconds, grant 3 bullets and log for review. Never stall a fight; never punish a player for infrastructure.
- **Cache verdicts** keyed on question plus normalized answer. Because the bank is finite and answers cluster, most requests hit cache at scale, driving latency and cost toward zero.
- **A human-labeled evaluation set is required before shipping**, specifically including correct-but-unusually-worded answers. False negatives are the toxic direction, because in PvP they cost a match; false positives merely hand out a bullet.

**The Codex is the index of what a player can be asked.** Facing a question whose cards you do not hold means you likely miss it, take one bullet, and go learn it. That preserves the pull loop without cards ever being played literally as a deck.

### 1.8 The chapter capstone

**There is one assessment per chapter, and it comes at the end of it.** The five per-mission-set assessments are deleted. A chapter has fourteen missions, fourteen modules, fourteen duels, and exactly one capstone, which sits after M14 and gates entry to the next chapter.

- The capstone is **purely a content gate** that unlocks the next chapter. **It has no effect on Rank**, and it is not a rank-up.
- It covers **all of the chapter's concepts** — roughly twenty for Boston — at **two items per concept** on a form.
- It is built on **real released TEA items where they exist**, authored items to depth where they do not, and **open-ended items graded by the same classifier the duel uses**. Real released items are the accountability evidence a district needs; the gap list in `content/staar/boston-coverage.json` records which of Boston's twenty-three standards have one and which need authoring.
- It stays **deterministic** in the sense that matters: the committed event is the verdict, never raw learner text, exactly as in the duel.
- It requires **100% per concept** to mint PvP-legal Codex cards.
- **The shrinking retry stays.** On retry the form narrows to only the concepts still unmastered, drawing **fresh items** from a reserve of roughly six per concept, and the mandatory 3-minute module is the retry gate — narrowed to those same concepts.
- **First-attempt score is the reported measure**, since the loop repeats until mastery and final scores would otherwise be identical for everyone.
- **It pays no XP.**
- PvP unlocks when the Boston chapter is complete.

Two consequences of collapsing five gates into one, recorded so nobody rediscovers them in playtest:

1. **The learning loop is now a chapter long.** Under the old model a student who had not mastered the Stamp Act met that fact after four missions. Now they meet it after fourteen. The compensating surface is the duel: it asks six free-response questions per attempt, per concept, and a student who cannot answer them is already being told. Any per-concept remediation signal has to come from duel verdicts rather than from an assessment that no longer exists mid-chapter.
2. **The capstone is the only place cards become PvP-legal**, so a player who never reaches it holds a Codex that is entirely single-player. That is intended, and it is what makes the capstone worth sitting.

### 1.9 The load-bearing consequence

> **Missions are optional-outcome fun; the modules and the capstone are the mandatory learning spine.**

A player who cannot clear missions still does every module, still reaches the capstone, still must reach 100% per concept, and is still routed back through the module until they do. **Learning is guaranteed by that loop entirely independently of mission success.** Note where the weight sits now that there is one capstone rather than five: fourteen mandatory modules do the teaching throughout the chapter, and the capstone is the one place mastery is finally required.

This is precisely why removing Easy mode is safe, and why the action can be genuinely hard without endangering the educational claim. No mission's win condition is on the curriculum's critical path. Every builder tuning a mission should read that as permission: make it hard, make it good, and stop worrying that a hard mission fails a child.

### 1.10 Accepted trade-off, recorded as a decision

**A diligent but mechanically weak player masters all the content and still stays at Rank 1**, because XP comes only from mission clears. The owner considered paying XP for the capstone and explicitly rejected it, reasoning that players should improve rather than be compensated.

This is a deliberate decision with its cost stated, not an oversight. If it proves too harsh in playtest, the lever is on the mission side — gentler early missions — never on the XP side.

### 1.11 PvP

- **1v1 duels using the same format as boss fights.** That makes the boss fights PvP onboarding: by the time PvP unlocks, a player has run the format fourteen times.
- **Cosmetic loadout:** a skin from any chapter completed, and a historically accurate weapon from any era. Purely cosmetic, zero gameplay effect.
- **20-second rounds.** Question, then shoot.
- **Symmetric and zero-sum:** both wrong means both get 1 bullet, both right means both get 3, otherwise 3 versus 1.
- **Any unlocked ability may be used, once per duel.**
- **Rank-based matchmaking.** Because Rank derives from Level and Level derives from mission XP, mechanically weaker players naturally settle at lower Ranks and meet each other. Skill-based matching emerges without computing a skill rating.
- **Answering is untimed.** Players may take as long as they want; once both answers are graded, a 3-second countdown resumes play. The owner accepts the waiting because these are friend matches.
- **Open distinction:** live works for friend-arranged duels, but a ranked ladder needs either async matching against stored answers or a population large enough to find a same-rank opponent online, which a class of 25 will not have.

---

## 2. Known content and implementation gaps

### 2.1 Concept-vocabulary mismatch

The rescued slate is written in chapter-level TEKS student expectations such as `8.21(A)`, `8.15(A)`, and `8.11(A)`. Current Boston code implements a different vocabulary:

- three required macros:
  - `BOS.MD01.CONCEPT.POSTWAR_REVENUE.v1`
  - `BOS.MD01.CONCEPT.STAMP_SCOPE.v1`
  - `BOS.MD01.CONCEPT.REPRESENTATION.v1`
- fourteen optional `MICRO.*` enrichment concepts; and
- canonical macro TEKS attachment only to `8.4(A)`.

M1 is deliberately rebuilt around the three implemented macros. The chapter-level concept assignments for eleven later missions have no corresponding runtime concept IDs, exposure ledgers, learning repair, or production item depth. That mismatch is unresolved and blocks those missions from implementation even where their physical scenario is otherwise buildable. It now blocks two authoring lines rather than one: the capstone item bank and the duel question bank.

`packages/curriculum` is the canonical registry that repairs this, and content authored after it exists should be tagged against it rather than against any of the older vocabularies. `content/m1` is the worked example.

### 2.2 Capstone item gap

The retired CP1 checkpoint bank is the only production assessment content that exists. It holds:

- one production item for `RCC.DEBT_POLICY_INTRO`;
- one production item for `RCC.STAMP_INTERNAL_INTRO`;
- one production item for `RCC.REPRESENTATION_CAUSE`; and
- zero production micro items.

CP1 as a *surface* is gone with the five per-mission-set assessments; its three items survive as seeds for the one capstone. Three items is far below both scales the capstone needs:

- **two items per concept on a form**, across roughly twenty Boston concepts — about forty items for a single first-attempt form; and
- **a reserve of roughly six items per concept** so a shrinking retry can draw fresh items without a student meeting one twice. That is on the order of **120 items for Boston**.

QA fixture items do not close the production gap. `content/staar` establishes which of Boston's twenty-three standards have a real released TEA item behind them and which need in-house authoring — twelve of twenty-three need authoring as the only way to cover what the chapter teaches — and it also records an unresolved licensing question that has to be answered before released item text ships.

**One permanent fact about the corpus, recorded so it is not re-searched.** TEA has never published an item asking what the Stamp Act taxed. Of six released `8.4(A)` items, none asks about the Act's scope over printed and legal paper — M1's own `STAMP_SCOPE` concept — and the only published statement of that proposition anywhere in TEA's material is a rubric bullet in the 2023 constructed-response scoring guide: “All colonists had to pay taxes on documents and paper.” Every item on that concept is therefore authored, and the concept carries `NO_RELEASED_TEA_ITEM` permanently rather than pending. Separately, the only released constructed response on `8.4(A)` cannot be served by a per-concept mastery gate at all: its prompt lets the student choose which two of four issues to write about, so no single concept can own it. Both findings, and the authoring checklist they belong to, are in `content/capstone/boston-1765/AUTHORING.md`.

### 2.2a Duel question bank does not exist

The capstone bank above gates the next chapter. It is not the duel bank, and neither substitutes for the other.

The duel needs free-response items carrying question text, acceptable answers, a rubric, and the associated Codex cards. Six are consumed per attempt, and a retry must not repeat, so a mission needs materially more than six per concept set. Nothing of this shape exists in production content today; the closest existing surface is the open-response prompt and rubric contract in `packages/contracts/src/openResponse.ts`, which supplies the schema pattern but none of the items.

M1 is the exception and the template. Its eighteen items — six per implemented concept, enough to cover three non-repeating attempts — were drafted in §4.9 and are now authored as production content in `content/m1/duel-items.json`, with binary rubrics, a grading policy, nine Codex card definitions, and a labelled answer set for the classifier. The other thirteen missions have none, and eleven of them cannot have any until the concept-vocabulary mismatch in §2.1 is resolved.

#### PvP needs an order of magnitude more than PvE does

Read this before planning duel content, because the PvE number is the wrong number to plan against.

Six items per concept is sized for PvE, where three attempts bound how many questions a player ever sees. **PvP has no such bound.** A duel now runs until one side's health reaches zero, so the round count is open and the question pool is a resource the match consumes at a rate no author controls; the hard anti-hang ceiling is twenty-four rounds, which is twenty-four questions in a single match.

Two further multipliers apply. Items are spent per *pair*, not per player: PvP asks both sides the same item and computes freshness on the union of their ledgers, because two independent draws would hand the veteran items they have seen and the newcomer fresh ones, and the resulting ammunition difference would read as knowledge when it is really tenure. And a repeated question is worth the full correct-answer grant to whoever remembers it, so recycling converts the match from a knowledge contest into a memory one.

The arithmetic: for a pool of *n*, if two players have each been served *k* items, the count still fresh to both is `n × (1 − k/n)²`. At M1's thirty-four that is about thirteen after two matches each, six after three, two after four.

**Plan on the order of sixty to a hundred items per concept set to sustain a session of PvP without repeats.** M1 reaches its total only by composing its eighteen PvE items with seven PvP-only items and borrowing the capstone's nine prose items — enough to make one maximal match safe and an evening survivable, which is not the same as making PvP work.

The requirement partly dissolves as the chapter fills in. PvP is short of items because it is seeded with one mission's concepts; fourteen missions' worth is a pool that does not run out. That is a reason to prefer breadth over depth once M1's design is settled — a fourth item on every concept is worth more to PvP than a seventh on three of them.

### 2.3 Path corrections

Older references point to paths that do not exist in the current repository:

- Day-1 content is in `packages/chapter-boston/src/day1/`, not `packages/runtime/src/content/day1/`.
- The Boston 3D world is in `packages/chapter-boston-world/src/world/`, not `apps/web/src/world/`.

### 2.4 Stale hub model

`apps/web/src/pages/hub/hubState.ts` still implements:

- `RankLetter` and `RANK_LADDER` as an E-through-S ladder, rendered as a lettered ladder in `StatusPanel.tsx`;
- `DIFFICULTY_BANDS` — `BENEATH`, `WITHIN`, `MATCHED`, `PERILOUS`, `BEYOND` — and `difficultyFor`;
- player-level-minus-mission-level deltas; and
- `MissionNode.level` as a mission difficulty scalar.

All of it is obsolete. Rank is an integer derived as one step per ten Levels, so the lettering and the ladder rendering both come out. There is one difficulty, so the bands, `difficultyFor`, the delta, and `MissionNode.level` all come out with no replacement. `PLACEHOLDER_HUB_STATE` starts a player at Level 4 and Rank E; a new player is Level 0, 0 XP, Rank 1.

The `Deploy` button in `apps/web/src/pages/hub/AssessmentPanel.tsx` has no `onClick`. The hub is still a presentation-only placeholder.

### 2.5 The duel does not exist

There is no duel system of any kind: no face-off staging, no round clock, no bullet economy, no per-round question pause, no line-of-sight break scheduler, no boss move sets, and no PvP transport. This is simultaneously the largest new build item in the slate and the highest-value one, because the identical system serves PvE bosses and PvP.

---

## 3. Slate at a glance

Every mission is 3:00 of play plus a 2:00 six-round duel. Every mission's concepts are carried entirely by its duel questions. The affordance column names what a mission is *built to show off*, never what it demands: no mission requires an ability.

| Mission | Date | Concept assignment | Scenario shape | Featured affordance | Duel opponent |
|---|---|---|---|---|---|
| M1 — Nailed to the Post | 14 Aug 1765 | Three implemented `BOS.MD01` macros | Handbill Run | None | The constable at the post |
| M2 — Landed Weight | 1765 | `8.11(A)` + `8.12(A)` | Smuggle the Crate | None | The customs collector |
| M3 — The Comptroller's Books | 26 Aug 1765 | Open; original `8.4(A)` subject moved to M1 | Steal the Stamp Shipment | None | The agitator at the fire |
| M4 — Set It Before Morning | Oct–Nov 1765 | `8.14(A)` + `8.15(E)` | Clandestine Press | None | The raiding officer |
| M5 — A Journal of the Times | Winter 1768–69 | `8.23(B)` + `8.21(B)` | Clandestine Press | Attention relocation, introduced | The ropewalk soldier |
| M6 — A Short Narrative | 5–15 Mar 1770 | `8.23(B)` + `8.4(B)` | Smuggle the Crate | Isolated-height access, introduced | The customs officer at the gangway |
| M7 — Counsel for the Defense | Oct–Dec 1770 | `8.20(A)` + `8.19(C)` | Steal the Stamp Shipment | Attention relocation, featured | The crowd leader on the steps |
| M8 — The Circular | Winter 1772–73 | `8.10(C)` + `8.3(A)` | Handbill Run | Isolated-height access, featured; concealment introduced | The gate officer |
| M9 — Twenty Days | 28 Nov–16 Dec 1773 | `8.20(B)` + `8.19(A)` | Smuggle the Crate, inverted | Concealment featured; contact recovery introduced | The customs officer at the landing |
| M10 — Griffin's Wharf | 16 Dec 1773 | `8.20(B)` + `8.12(C)` | Steal the Stamp Shipment | Contact recovery, featured | The Company's agent |
| M11 — The Port Is Shut | Jun–Sep 1774 | `8.4(A)` + `8.1(A)` | Smuggle the Crate | Concealment recurs; unsupported-gap traversal introduced | The Neck checkpoint soldier |
| M12 — The Group | 1774–75 | `8.23(E)` + `8.4(B)` | Clandestine Press | Concealment, featured | The billeting search officer |
| M13 — The Alarm | 18–19 Apr 1775 | `8.4(C)` + `8.10(A)` | Handbill Run at its limit | Unsupported-gap traversal, featured | The regulars' officer on the Green |
| M14 — The Lines | Apr–Jul 1775 | `8.4(C)` + `8.22(A)` | Steal the Stamp Shipment | Isolated-height access and concealment recur | The wharf guard |

### 3.1 Grouping, and the one gate

The fourteen missions fall into four era groups, `4 / 3 / 3 / 4`:

- Group 1, M1–M4: Stamp Act, 1765
- Group 2, M5–M7: occupation and Massacre, 1768–1770
- Group 3, M8–M10: committees and Tea, 1772–1773
- Group 4, M11–M14: Coercive Acts and war, 1774–1775

**These groups gate nothing.** They are how the chapter's history divides, and they are useful for scheduling art, for reading the slate, and for deciding which mission to build next. They are not assessment boundaries and no assessment sits at any of their edges.

**There is one gate in the chapter and it is at the end of it.** After M14, the chapter capstone (§1.8) covers all of Boston's concepts at two items each, requires 100% per concept, mints PvP-legal Codex cards, pays no XP, has no effect on Rank, and unlocks the next chapter. Nothing else in the chapter is gated: a player advances from M4 to M5 by having spent M4's attempts, cleared or failed, exactly as they advance from M1 to M2.

The five per-mission-set assessments this document used to describe are deleted. If a future proposal wants a mid-chapter gate, it is proposing to add one, not restoring one.

### 3.2 Slate-wide pacing and route law

The M2–M14 phase descriptions below are dramatic regions, not instructions to stop at a marker. Every builder must apply three rules:

1. **Never put a question in the three minutes.** There are no in-mission knowledge checks of any kind. Where the preserved prose below describes a "valley check," the historical proposition it carried has moved into that mission's duel bank, and the physical decision it wrapped — which berth, which route, which door — survives only if it can be made by moving, without stopping and without dialogue.
2. **Build continuous routes; never waypoint hops.** Traversal between hook, phase regions, and the face-off remains one connected playable floor with multiple lines wherever the historical space permits. A phase boundary may alter pressure or objective state without teleporting the player or reducing movement to `freeRoam(ctx, [oneTarget], ...)`.
3. **Hold the 3:00 / 2:00 shape.** A mission that cannot fit its physical action into three minutes must cut action, not borrow from the duel; a duel is always six rounds of twenty seconds.

Rule 2 applies even where the preserved prose says "reach," "go to," or lists successive handoffs. Those are spatial goals inside a floor. They are not permission to implement a corridor of gold markers.

**Where each shape's duel lives:**

- **Handbill Run:** the post is set and the man who was going to paper over it is standing there.
- **Smuggle the Crate:** the load is grounded and the officer who has been chasing it all mission has finally caught up.
- **Steal the Stamp Shipment:** the crew has scattered and the one antagonist who followed you out is waiting.
- **Clandestine Press:** the last pull is off the platen and the raid has arrived at the door.

---

## 4. M1 — Nailed to the Post

### 4.1 Mission identity

- **Stable mission ID:** `PA.SEA01.CH02.BOSTON.MD01.v1`
- **Date:** 14 August 1765, daylight
- **Scenario shape:** Handbill Run
- **Target runtime:** 3:00 mission clock, then a 2:00 duel clock; roughly 6:40 of wall clock at the §4.5 paper targets, all of it outside the mandatory 3-minute module
- **Mission level/difficulty scalar:** none
- **Duel opponent:** the constable at the post
- **Attempts:** three, all at the same difficulty
- **XP across attempts:** full, then two-thirds, then one-third, then zero forever
- **Ability requirement:** none

The name and Handbill Run shape still fit. The mission's physical objective is to carry one freshly printed answer through a legible tutorial route and post it beside an official Stamp notice at the public pump. The handbill's argument connects all three implemented concepts:

1. Britain seeks colonial revenue after the French and Indian War.
2. The Stamp Act taxes printed and legal paper.
3. Colonists object because they elect no representatives to Parliament.

The original six-post route is cut. M1 has one destination, one continuous traversal floor, one `POST_JOB`, **zero in-mission knowledge checks**, and six duel questions drawn from the pools in §4.9 — two per concept. Its job is to make movement itself enjoyable before later missions add required affordances, and to put every historical proposition where it belongs: in the fight.

### 4.2 Required concepts and aliases

- `BOS.MD01.CONCEPT.POSTWAR_REVENUE.v1`
  - assessment alias: `RCC.DEBT_POLICY_INTRO`
- `BOS.MD01.CONCEPT.STAMP_SCOPE.v1`
  - assessment alias: `RCC.STAMP_INTERNAL_INTRO`
- `BOS.MD01.CONCEPT.REPRESENTATION.v1`
  - assessment alias: `RCC.REPRESENTATION_CAUSE`

### 4.3 M1 mechanical boundary

M1 uses only:

- ordinary run;
- ordinary vault;
- ordinary climb;
- ordinary drop;
- one precision interaction using `POST_JOB`; and
- the duel: ordinary movement, dodging, and free-response answering.

It does not require or preview:

- any in-mission dialogue check, question, or reading-while-moving;
- a diversion;
- a roof-only route;
- crowd blending;
- concealment;
- a chase;
- a guard-grab escape;
- a special jump;
- an ability; or
- any alternative locomotion mode.

### 4.4 Continuous dungeon floor

M1 is one connected space from Mercer's threshold to the public post. It is not a chain of destination markers.

The same compact block is layered vertically:

- **street level:** fastest and most exposed, using carts as moving sightline breaks;
- **cart and stall tops:** a middle line built from short vaults and drops;
- **low roof line:** the longest line, reached by an ordinary scaffold climb and left by an ordinary drop; and
- **back court:** a lower protected loop that reconnects all three lines before the public post.

The geometry supports three viable lines from the first ten seconds:

1. **Street line:** shortest distance, highest watcher exposure, fewest traversal actions.
2. **Market-top line:** repeated vault/drop rhythm, medium distance, intermittent cover.
3. **Low-roof line:** climb and roof flow, longest distance, least direct exposure.

Lines cross, split, and rejoin inside the same arena. A player may change line at authored crossover points without selecting a route in UI. Every vertical transition is solvable with base run, vault, climb, or drop. No line requires an ability.

Patrols change which line is attractive; they do not normally stop progress. Before the final court, being read costs position:

- the currently advantageous crossover closes;
- a high-line player must drop to the lower court;
- a street-line player is pushed behind the next cart; and
- the player loses elevation and several seconds, not the attempt.

Only the final exposed court before the post is an authored detection fail point. If confrontation fills there before `POST_JOB` begins, the constable reaches the board first and the attempt ends.

### 4.5 Pacing calculation

M1 runs two clocks: a **180-second mission clock** and a **120-second duel clock**. Together they are the 3:00 + 2:00 shape §1.1 fixes, and they sum to the advertised 5:00.

#### Mission clock — 180 seconds

- authored hook handoff, no question: **10 seconds**
- continuous traversal: **150 seconds**
- active `POST_JOB`: **20 seconds**

Playing time is `150 + 20 = 170` seconds of 180, or **94.4%**. Reading time is **zero**. The remaining 10 seconds are a non-interactive handoff, not a question. Nothing in the three minutes stops for text, and that is a structural law from §1.1 rather than a budget this document has to defend.

Inside the mission clock no marker, camera cue, patrol tell, route crossover, or phase transition may lock movement or require a full stop. The `POST_JOB` beat is the one stationary interval, and it is active precision play rather than reading.

#### Duel clock — 120 seconds

Six rounds of 20 seconds is exactly 120 seconds of engagement. **That is a fight clock, not a wall clock.** §1.3 pauses the game before each round to ask its question, so the paused seconds sit outside the 120 and the duel's wall clock is necessarily longer than 2:00.

Paper target for one question pause:

- question presented and read: **4 seconds**
- answer composed and submitted: **6 seconds**
- verdict returned and bullets granted: **2 seconds**, hard-capped by §1.7's 1.5-second grading timeout
- resume countdown: **3 seconds**

That is **15 seconds** per pause, so `6 × 15 = 90` seconds of pause across the duel. Adding a 10-second animated face-off, the duel's wall clock is `10 + 90 + 120 = 220` seconds, or **3:40**.

#### Whole attempt

| Bucket | Mission | Duel | Total |
|---|---:|---:|---:|
| Play — in control, moving | 170 s | 120 s | **290 s** |
| Read and answer — stationary, text on screen | 0 s | 90 s | **90 s** |
| Authored staging — non-interactive | 10 s | 10 s | **20 s** |
| Wall clock | 180 s | 220 s | **400 s** |

Whole-attempt ratio: play is `290 / 400` = **72.5%**, reading and answering is `90 / 400` = **22.5%**, staging is `20 / 400` = **5.0%**.

Per segment, the split is the entire point of the restructure:

- the mission is `170 / 180` = **94.4%** play against **0%** reading; and
- the duel is `120 / 220` = **54.5%** play, `90 / 220` = **40.9%** reading and answering, and `10 / 220` = **4.5%** staging.

**The duel is not 100% action and must not be described as such.** It runs roughly four seconds of fighting for every three of answering. That is the intended shape, not a defect: §1.3 accepts heavy writing in the duel precisely because the preceding three minutes are pure play.

Two consequences, recorded so nobody rediscovers them in playtest:

1. **An attempt reads longer than five minutes.** 400 seconds is 6:40. The 5:00 in §1.1 is the sum of the two clocks, and the clocks stop while a player answers. Either these paper targets hold and a first attempt occupies about seven minutes, or the pause has to shrink — and it cannot shrink by rule, because §1.11 makes answering untimed.
2. **Reading seconds went up, not down.** The old 3:45 model spent 36 seconds on three multiple-choice checks; this one spends 90 on six free-response questions. The restructure did not reduce reading. It moved all of it out of the moving parts, which is exactly what §1.2 claims and all that it claims.

These are presentation targets, not answer timers. Instrument actual medians in playtest, particularly the compose-and-submit figure: it is a typed answer from an eighth-grader on a school Chromebook and is the number here most likely to be wrong.

### 4.6 DSL and replay consequence

The authored flow uses the existing generator helpers with their real signatures:

- `waitContinue(ctx, label?, cueId?)`
- `waitAck(ctx, text, cueId?)`
- `choose(ctx, promptId, frame, options)`
- `mechanic(ctx, promptId, params)`
- `focusRead(ctx, objectId, title, teaser, cueId?)`
- `breathe(ctx, cueId, durationMs?)`
- `freeRoam(ctx, targets, canProceed, cueId?)`

M1 deliberately does not call `focusRead`, `breathe`, or `choose` during the mission. `choose` in particular has no caller: it is the multiple-choice primitive, and M1 has no in-mission checks and no multiple-choice duel questions. The official notice and response handbill are presented through scene copy and the 3-minute module. `waitAck` is reserved for terminal failure notices.

None of these helpers can author the duel. Its per-round question is free-response and its verdict is a rubric label, so the duel needs the open-response administration surface in `packages/contracts/src/openResponse.ts` rather than the dialogue DSL.

`freeRoam` cannot author the M1 floor. Its protocol describes destination selection and arrival; repeated calls with one target would recreate the waypoint corridor this revision removes.

#### Ownership decision

Continuous movement belongs to the world layer. The flow layer needs a minimal awaitable **traversal-gate request** for a connected mission region; it does not need a new movement mechanic.

- `TraversalDirector.tsx` already resolves nearby authored vault, climb, drop, duck, and jump affordances and submits motion to `Player`.
- `packages/engine-world/src/traversalResolver.ts` already provides deterministic nearest-affordance selection, alignment, input buffering, hysteresis, and cooldown policy.
- `gameplayWorld.ts` already provides platforms, collision sweeps, blocker queries, and line of sight across exterior or interior gameplay spaces.

What is missing is mission orchestration:

- an awaitable traversal-region request distinct from `FREE_ROAM`;
- a terminal-volume success event;
- an authored fail-boundary event;
- durable route-cost events when detection closes a line or forces a lower position; and
- mission arena data binding geometry, traversal affordances, patrol arrangement, cover, and terminal volumes to the attempt seed.

This requirement does not prescribe the request's final TypeScript shape. It requires only that the flow can suspend at a semantic traversal gate while the world owns continuous movement.

#### Deterministic replay constraint

Runtime determinism comes from replaying committed events, not recording every frame of player motion. M1 must therefore commit semantic boundaries only:

- first traversal region reached its forced-cover state;
- a route-position penalty occurred, if it changes the rest of the attempt;
- final court reached;
- authored detection fail occurred;
- traversal gate completed;
- each duel round's rubric verdict and resulting bullet count, never the player's raw text; or
- the duel's terminal result.

Vaults, climbs, drops, exact path, and moment-to-moment transforms remain world presentation and are not event-log entries. The attempt seed must recreate the same geometry and patrol arrangement. A committed route penalty must recreate the same closed crossover/lower-position state on replay.

The existing presenter spatial snapshot can restore a position for mid-gate resume, but position alone is insufficient if a route has closed or a patrol consequence has committed. Those semantic changes require durable events. Replaying a completed gate must advance the generator directly to the next authored pause without simulating the original run.

The only mechanic call is:

`mechanic(ctx, "BOS.MD01.ACT.POST_HANDBILL.v1", { kind: "POST_JOB", prompt: "Line up the answer beneath the Crown notice, then set both tacks." })`

`POST_JOB` already carries the semantic phases `lineUp`, `tackLeft`, and `tackRight`.

### 4.7 Mandatory 3-minute learning module

The module sits outside the timed mission attempt and pays no XP, ever. It is required before the first attempt and required again before each of the two retries. The same module runs every time; only the chapter capstone's retry path narrows to unmastered concepts.

Three minutes is the fixed module length everywhere, and three concepts consume it: roughly forty seconds each, framed by an identity card, a synthesis card, and the mission frame.

| Target time | Content | DSL boundary | Stable cue |
|---|---|---|---|
| 0:00–0:15 | Identity: Boston, 14 August 1765; cover is a runner for Mercer's Press. | `waitContinue(ctx, "Open the brief", cueId)` | `BOS.MD01.CUE.BRIEF_IDENTITY.v1` |
| 0:15–0:50 | Postwar revenue: the war with France ended in 1763, Britain carries the debt, and Parliament turns to the colonies to defray it. | `waitContinue(ctx, "Trace the cause", cueId)` | `BOS.MD01.CUE.BRIEF_POSTWAR.v1` |
| 0:50–1:30 | Stamp scope: printed and legal paper requires the paid stamp from 1 November. Ordinary goods are not the target, which is what makes a printer's shop the point of impact. | `waitContinue(ctx, "Compare the papers", cueId)` | `BOS.MD01.CUE.BRIEF_STAMP.v1` |
| 1:30–2:10 | Representation: Boston elects its own local assembly but elects no member of Parliament, so a tax laid by Parliament is laid by a body the town did not choose. | `waitContinue(ctx, "Name the missing voice", cueId)` | `BOS.MD01.CUE.BRIEF_REPRESENTATION.v1` |
| 2:10–2:40 | How the three connect, with the source excerpt: debt produces revenue policy, revenue policy produces the stamp, and the stamp lands on a town with no voice in it. | `focusRead(ctx, "M01_STAMP_ACT_EXCERPT", ...)` | `BOS.MD01.CUE.BRIEF_SYNTHESIS.v1` |
| 2:40–3:00 | Mission frame and insertion: carry the printed answer to the public post before the constable replaces the board. Attempt seed locks here. | `waitContinue(ctx, "Enter Boston", cueId)` | `BOS.MD01.CUE.BRIEF_INSERT.v1` |

The times are presentation targets, not forced reading cutoffs. The player advances each card. The content package stores authored alternatives for wording and source excerpt, but all variants express the same propositions.

This module is the sole source for the duel. All eighteen items in §4.9 are answerable from these six cards alone, verified item by item; the two rubric constraints that verification produced are recorded at the end of §4.9. Any future item that needs a proposition not on this table is a defect in the item or a gap in this module, and one of the two has to change.

### 4.8 Second-by-second beat sheets

Two beat sheets, one per clock. The mission clock runs 3:00 and never stops for text. The duel clock runs 120 seconds of engagement and stops between rounds while the question is answered.

#### Mission, hook — 0:00–0:10

| Time | Beat | Flow/world mapping | Stable ID | Failure |
|---|---|---|---|---|
| 0:00–0:10 | Abigail presses the wet sheet into the runner's hands and names the job: “Pump post. Before the Crown's man papers over it.” Custody of the handbill is established. Nothing is asked; the player is not quizzed and does not choose. | Buffer `SCENE`; no `choose` call. | `BOS.MD01.CUE.HANDOFF.v1` | None. |
| 0:10 | Control returns on her last line rather than after it, so the three minutes open on movement instead of a fade. The endpoint is visible across the layered floor from the threshold. | Start the traversal-gate request for region A; the world layer owns movement from here. | `BOS.MD01.CUE.TRAVERSAL_FLOOR_OPEN.v1` | None. The player picks a line immediately. |

#### Mission, phase 1 — establish flow, 0:10–1:20

| Time | Beat | Flow/world mapping | Stable ID | Failure |
|---|---|---|---|---|
| 0:10–1:05 | Continuous run through the street, cart/stall, roof, and court lines. Crossovers let the player change elevation without touching UI. Patrol sweeps make different lines attractive under different seeds. | World-owned traversal region A stays active. Flow awaits the forced-cover semantic event, not intermediate arrivals. | `BOS.MD01.CUE.TRAVERSAL_FLOOR_OPEN.v1` | Falls and early detection cost height and position. They do not end the attempt. |
| 1:05–1:20 | All lines converge behind the customs cart while a patrol and a loaded wagon occupy the only exit. The player holds cover and times the crossing. **Control is never taken** — this is a stealth-timing beat, not a scripted stop, and it exists for pressure rather than to manufacture a pause for dialogue. | On the committed forced-cover event, hand region B's opening condition to the world layer. | `BOS.MD01.CUE.FORCED_COVER.v1` | Breaking cover early costs position, not the attempt. |

#### Mission, phase 2 — route under pressure, 1:20–2:40

| Time | Beat | Flow/world mapping | Stable ID | Failure |
|---|---|---|---|---|
| 1:20–2:30 | The wagon clears and every line opens into the second half of the same floor. The patrol's longer loop creates moving preference rather than a red light: street is fast, stalls preserve rhythm, roof preserves position. Crossovers remain available throughout. | Resume the traversal-gate request for region B. Flow awaits the final-court or authored-fail event. | `BOS.MD01.CUE.TRAVERSAL_FLOOR_PRESSURE.v1` | Being read before the final court forces a lower line or closes a crossover. |
| 2:30–2:40 | Routes converge into the final court. The player is still moving through the last vault or drop to the post. Suspicion reaching confrontation here is the one authored detection fail. | World commits the final-court success or fail event. | `BOS.MD01.CUE.FINAL_COURT.v1` | Success arms `POST_JOB`; failure lets the constable reach the board first. |

#### Mission, climax — the post, 2:40–3:00

| Time | Beat | Flow/world mapping | Stable ID | Failure |
|---|---|---|---|---|
| 2:40–3:00 | **The only precision beat.** Place the response directly below the official notice: line up, tack left, tack right. Detection is already resolved, so the player is never asked to split attention between the pattern and a patrol. | `mechanic(ctx, "BOS.MD01.ACT.POST_HANDBILL.v1", { kind: "POST_JOB", prompt: "Line up the answer beneath the Crown notice, then set both tacks." })` | `BOS.MD01.ACT.POST_HANDBILL.v1` | A terminally illegible or torn result ends the attempt (§4.11). |

The mission clock ends here. The sheet is up, the constable arrives to find it already nailed, and the duel begins.

#### Duel, face-off — 10 seconds of wall clock, before the duel clock starts

| Beat | Staging | Stable ID |
|---|---|---|
| The constable reaches the board, sees the handbill, and turns. Authored two-shot: both men, the posted sheet between them, weapons drawn but not yet raised. Non-interactive. | `CameraDirector.tsx` boss two-shot; `ChoreographyDirector.tsx` owns cue readiness. | `BOS.MD01.CUE.DUEL_FACEOFF.v1` |

#### Duel, the repeating round cycle

Six identical rounds. Each one runs this cycle, and only step 5 spends duel clock.

| Step | What happens | Clock | Notes |
|---|---|---|---|
| 1 | **Question.** The duel clock stops. One free-response item is drawn from this round's concept pool (§4.9) under the attempt seed. | paused | Untimed by §1.11. The 4-second read and 6-second compose figures in §4.5 are medians to instrument, never cutoffs. |
| 2 | **Verdict.** The answer is classified against the item's authored rubric. | paused | Hard 1.5-second cap per §1.7. On timeout, grant 3 bullets and log for review. |
| 3 | **Bullet grant.** Correct grants **3**; wrong grants **1**. | paused | The verdict label and bullet count commit as the event. The raw text never does. |
| 4 | **Resume countdown.** Three seconds. | paused | Matches the PvP countdown in §1.11 so the two formats feel identical. |
| 5 | **Engagement window.** 20 seconds. Ordinary movement and dodging are live. The player spends the bullets granted in step 3. | **20 s** | M1 is the one duel with no abilities available at all: a first-mission player is Level 0 and has unlocked none. M1 is therefore the format's clean base case. |
| 6 | **Line-of-sight break.** At 20 seconds the constable breaks line of sight to reload. A flintlock takes about that long to bring back into service, so the round clock and the weapon agree. | boundary | Ends the round. Cycle repeats until six rounds are spent or one man is down. |

#### Duel, round schedule

Two rounds per concept, interleaved so no concept is asked twice in a row. The concept order is authored and fixed; **which item each round draws is seeded**, so three attempts see eighteen different questions.

| Round | Duel clock | Concept | Pool |
|---|---|---|---|
| 1 | 0:00–0:20 | postwar revenue | `BOS.MD01.POOL.DUEL_POSTWAR.v1` |
| 2 | 0:20–0:40 | Stamp scope | `BOS.MD01.POOL.DUEL_STAMP_SCOPE.v1` |
| 3 | 0:40–1:00 | representation | `BOS.MD01.POOL.DUEL_REPRESENTATION.v1` |
| 4 | 1:00–1:20 | postwar revenue | `BOS.MD01.POOL.DUEL_POSTWAR.v1` |
| 5 | 1:20–1:40 | Stamp scope | `BOS.MD01.POOL.DUEL_STAMP_SCOPE.v1` |
| 6 | 1:40–2:00 | representation | `BOS.MD01.POOL.DUEL_REPRESENTATION.v1` |

Two tuning questions from §1.3 land squarely on this cycle and must be settled during the M1 build rather than guessed at in authoring: whether unspent bullets carry between rounds, and the boss hit and health model that keeps a one-bullet round winnable without making a three-bullet round trivial. A third has surfaced in authoring and is recorded in §4.9: how a partial rubric verdict maps onto a binary bullet grant.

### 4.9 Duel question bank

This is M1's authored content and the vertical slice's `duel-question-bank` deliverable. It is **not** the chapter capstone's item bank — §2.2 owns that one, and neither substitutes for the other.

**Superseded by production content.** The eighteen items below were drafted here and are now authored at production quality in `content/m1/duel-items.json`, where each carries a **binary** rubric — the three-valued projection in this section's *Rubric shape* subsection is retired, along with its open question about rounding `PARTIAL` up. Read this section for the design intent and that file for what the classifier actually runs against.

The three retired multiple-choice pools are not lost. Every historical proposition they carried survives below as free-response items; only the answer format changed, from picking one of three to saying it.

**Depth.** Six questions per attempt across three attempts with no repeats means **eighteen authored items, six per concept.** All eighteen are authored below at final quality; nothing here is a stub. A retry draws the items the earlier attempts did not consume, so the pool is exhausted exactly at the third attempt and no player ever sees an item twice.

**Module coverage.** Every item is answerable from the 3-minute module in §4.7 alone. That was checked item by item against the module's six cards while authoring, and the two constraints it produced are recorded at the end of this section.

Launch minimum:

- six duel items per concept, eighteen in total;
- three authored patrol arrangements;
- three `POST_JOB` patterns, sharing the same semantic phases; and
- no generated historical wording. Runtime selects authored items; it never writes one.

#### Codex cards these items map to

The Codex card namespace does not exist in the repository. These IDs follow this document's convention and are authored placeholders for the card lifecycle listed in §4.15 to adopt or remap.

| Card | Proposition | Module card |
|---|---|---|
| `BOS.MD01.CARD.WAR_DEBT.v1` | The war with France ended in 1763 and left Britain carrying the debt. | 0:15–0:50 |
| `BOS.MD01.CARD.COLONIAL_REVENUE.v1` | Parliament turns to the colonies to defray that debt. | 0:15–0:50 |
| `BOS.MD01.CARD.STAMP_PAPER_SCOPE.v1` | The Act taxes printed and legal paper; ordinary goods are not the target. | 0:50–1:30 |
| `BOS.MD01.CARD.STAMP_DATE.v1` | The stamp must be paid from 1 November. | 0:50–1:30 |
| `BOS.MD01.CARD.PRINTER_IMPACT.v1` | A printer's shop is the point of impact because its whole trade is printed paper. | 0:50–1:30 |
| `BOS.MD01.CARD.NO_MEMBER_IN_PARLIAMENT.v1` | Boston elects its own assembly but elects no member of Parliament. | 1:30–2:10 |
| `BOS.MD01.CARD.CONSENT_GROUND.v1` | A tax laid by Parliament is laid by a body the town did not choose. | 1:30–2:10 |
| `BOS.MD01.CARD.DEBT_TO_STAMP_CHAIN.v1` | Debt produces revenue policy, revenue policy produces the stamp, and the stamp lands on a town with no voice in it. | 2:10–2:40 |

#### Rubric shape and the bullet projection

Each item carries one rubric criterion graded on the `STRONG` / `PARTIAL` / `MISSING` levels already defined in `packages/contracts/src/openResponse.ts`, resolving to the existing labels `EVIDENCE_CONNECTED`, `PARTIAL_CONNECTION`, and `NEEDS_SOURCE_REVISIT`. Nothing new is required in contracts to express these items.

The bullet grant is binary, so a three-valued label has to project onto two outcomes:

| Label | Bullets | Reasoning |
|---|---:|---|
| `EVIDENCE_CONNECTED` | 3 | Correct. |
| `PARTIAL_CONNECTION` | 3 | §1.7 makes false negatives the toxic direction and a false positive merely a handed-out bullet, so partial credit rounds up. |
| `NEEDS_SOURCE_REVISIT` | 1 | Wrong, or right about something the question did not ask. |
| `UNCLASSIFIED` | 3 | The §1.7 timeout rule: never stall a fight, never punish a player for infrastructure. Log for review. |

**Open tuning question.** Rounding `PARTIAL_CONNECTION` up to 3 follows from §1.7's stated asymmetry, but it is an authoring inference rather than an owner decision, and it makes a half-right answer worth exactly as much as a right one. Settle it during the M1 build alongside the two duel questions in §1.3. It is the difference between a forgiving duel and a sharp one.

#### Pool A — postwar revenue

- **Pool ID:** `BOS.MD01.POOL.DUEL_POSTWAR.v1`
- **Concept:** `BOS.MD01.CONCEPT.POSTWAR_REVENUE.v1`
- **Authored depth:** six of six

**A1 — `BOS.MD01.DUEL.POSTWAR.WHY_NOW.v1`**

- **Question:** “Why is Parliament reaching into Boston for money now?”
- **Accept:** Britain came out of the war with France carrying debt, and Parliament is looking to the colonies to help pay it down.
- **Also accept:** “they're broke from the war”; “the war cost too much and now they want us to cover it”; “French and Indian War debt.”
- **Reject:** the Stamp Act as its own cause, which is circular; colonial assemblies asking for it; smuggling or trade enforcement as the motive.
- **Rubric:** `CRIT.WAR_DEBT_TO_COLONIES` — STRONG names war debt and the colonies as the intended payer; PARTIAL names war debt alone; MISSING names neither.
- **Cards:** `BOS.MD01.CARD.WAR_DEBT.v1`, `BOS.MD01.CARD.COLONIAL_REVENUE.v1`

**A2 — `BOS.MD01.DUEL.POSTWAR.WHAT_IT_LEFT.v1`**

- **Question:** “The war with France ended in 1763. What financial problem did it leave Britain with?”
- **Accept:** a large war debt it still had to pay off.
- **Also accept:** “they owed a pile of money”; “debt”; “they were in the red from the fighting.”
- **Reject:** answers naming territory, prestige, or new colonies; answers naming the Stamp Act.
- **Rubric:** `CRIT.WAR_DEBT` — STRONG names debt or money owed; PARTIAL names cost or expense without an outstanding obligation; MISSING names a non-financial problem.
- **Cards:** `BOS.MD01.CARD.WAR_DEBT.v1`

**A3 — `BOS.MD01.DUEL.POSTWAR.WHO_PAYS.v1`**

- **Question:** “Britain is carrying a war debt. Where does Parliament turn for the money?”
- **Accept:** to the colonies.
- **Also accept:** “to us”; “America”; “the colonies over here”; “Boston and the rest of them.”
- **Reject:** British taxpayers at home; the King's own purse; borrowing from another state.
- **Rubric:** `CRIT.COLONIES_AS_PAYER` — STRONG names the colonies or America; PARTIAL gestures at “overseas” or “the empire” without naming them; MISSING names a payer inside Britain.
- **Cards:** `BOS.MD01.CARD.COLONIAL_REVENUE.v1`

**A4 — `BOS.MD01.DUEL.POSTWAR.WHICH_CAME_FIRST.v1`**

- **Question:** “Which came first, the debt or the tax? Say which, and what that ordering tells you.”
- **Accept:** the debt came first; the tax is Parliament's response to it, not the other way round.
- **Also accept:** “debt, then tax”; “they were already in debt, so they made the tax.”
- **Reject:** the tax first; the two arising together; the debt caused by the tax.
- **Rubric:** `CRIT.CAUSAL_ORDER` — STRONG puts debt before tax and names the tax as the response; PARTIAL puts debt before tax with no causal statement; MISSING reverses or conflates them.
- **Cards:** `BOS.MD01.CARD.DEBT_TO_STAMP_CHAIN.v1`, `BOS.MD01.CARD.WAR_DEBT.v1`

**A5 — `BOS.MD01.DUEL.POSTWAR.CAME_FROM_NOWHERE.v1`**

- **Question:** “A printer tells you the Stamp Act came out of nowhere. Start at 1763 and show him it did not.”
- **Accept:** the war with France ended in 1763 and left Britain in debt; Parliament needed revenue and decided the colonies should supply some of it; the stamp is how it collects.
- **Also accept:** any chain connecting the war's end to the debt to a tax on the colonies, in any wording.
- **Reject:** chains that skip the debt; chains that begin at colonial protest; answers that only assert the Act was unfair.
- **Rubric:** `CRIT.CHAIN_FROM_1763` — STRONG links the war's end, the debt, and colonial taxation; PARTIAL links two of the three; MISSING links none.
- **Cards:** `BOS.MD01.CARD.WAR_DEBT.v1`, `BOS.MD01.CARD.COLONIAL_REVENUE.v1`, `BOS.MD01.CARD.DEBT_TO_STAMP_CHAIN.v1`

**A6 — `BOS.MD01.DUEL.POSTWAR.DEBT_TO_TAX.v1`**

- **Question:** “Why does a debt in London turn into a tax in Boston? Give me the connection in one line.”
- **Accept:** Britain needs revenue against the debt, Parliament decides the colonies should provide part of it, so the debt becomes a tax laid here.
- **Also accept:** “they owe money, so they're taxing us to get it”; “our taxes pay their war bill.”
- **Reject:** answers about trade regulation, smuggling, or punishing Boston specifically.
- **Rubric:** `CRIT.DEBT_BECOMES_TAX` — STRONG carries debt, the need for revenue, and colonial taxation; PARTIAL carries debt and taxation without the revenue step; MISSING supplies a different motive.
- **Cards:** `BOS.MD01.CARD.COLONIAL_REVENUE.v1`, `BOS.MD01.CARD.DEBT_TO_STAMP_CHAIN.v1`

#### Pool B — Stamp scope

- **Pool ID:** `BOS.MD01.POOL.DUEL_STAMP_SCOPE.v1`
- **Concept:** `BOS.MD01.CONCEPT.STAMP_SCOPE.v1`
- **Authored depth:** six of six

**B1 — `BOS.MD01.DUEL.STAMP.DEED_OR_CLOTH.v1`**

- **Question:** “A court deed and a bolt of cloth are on the table. Which needs the Crown's paid stamp, and why?”
- **Accept:** the deed, because the Act taxes printed and legal paper; ordinary goods like cloth are not its target.
- **Also accept:** “the deed — cloth isn't paper”; “the legal one, that's what's taxed.”
- **Reject:** the cloth; both; the deed with no reason given.
- **Rubric:** `CRIT.PAPER_NOT_GOODS` — STRONG picks the deed and gives either the legal-paper reason or the goods-excluded reason; PARTIAL picks the deed with a vague reason; MISSING picks the cloth or both.
- **Cards:** `BOS.MD01.CARD.STAMP_PAPER_SCOPE.v1`

**B2 — `BOS.MD01.DUEL.STAMP.FROM_WHEN.v1`**

- **Question:** “From what date must the stamp be paid?”
- **Accept:** 1 November.
- **Also accept:** “November first”; “the first of November”; with or without the year.
- **Reject:** any other date; “immediately”; “it already is.”
- **Rubric:** `CRIT.STAMP_DATE` — STRONG gives 1 November; PARTIAL gives November without the day; MISSING gives another date or none.
- **Cards:** `BOS.MD01.CARD.STAMP_DATE.v1`

**B3 — `BOS.MD01.DUEL.STAMP.WHY_A_PRINTER.v1`**

- **Question:** “Why does this Act land hardest on a printer's shop, of all places?”
- **Accept:** because the Act taxes printed paper and a printer's entire trade is printed paper.
- **Also accept:** “everything they make is the thing being taxed”; “paper is their whole business.”
- **Reject:** answers about printers being political; about the shop's location; about the constable.
- **Rubric:** `CRIT.PRINTER_IMPACT` — STRONG connects the taxed category to the printer's product; PARTIAL says printers are hit without saying why; MISSING supplies an unrelated reason.
- **Cards:** `BOS.MD01.CARD.PRINTER_IMPACT.v1`, `BOS.MD01.CARD.STAMP_PAPER_SCOPE.v1`

**B4 — `BOS.MD01.DUEL.STAMP.CORRECT_THE_APPRENTICE.v1`**

- **Question:** “The apprentice says the Act taxes everything Boston buys. Correct him.”
- **Accept:** it does not; it taxes printed and legal paper, and ordinary goods are not its target.
- **Also accept:** “no, just paper things”; “only printed and legal documents, not regular goods.”
- **Reject:** agreeing with him; narrowing only to newspapers; widening to all imports.
- **Rubric:** `CRIT.SCOPE_NARROWED` — STRONG narrows to printed and legal paper or explicitly excludes ordinary goods; PARTIAL says “not everything” without naming the real category; MISSING agrees or restates the error.
- **Cards:** `BOS.MD01.CARD.STAMP_PAPER_SCOPE.v1`

**B5 — `BOS.MD01.DUEL.STAMP.NAME_TWO.v1`**

- **Question:** “Name two things that would need the stamp.”
- **Accept:** any two items that are printed matter or legal instruments — a printed handbill, a newspaper, a deed, a licence, a court paper.
- **Also accept:** any pair the player instantiates correctly from the two taught categories, in any wording.
- **Reject:** ordinary goods; private handwritten items; one answer repeated twice.
- **Rubric:** `CRIT.TWO_IN_CATEGORY` — STRONG gives two items that both fall inside printed or legal paper; PARTIAL gives one valid item; MISSING gives none.
- **Cards:** `BOS.MD01.CARD.STAMP_PAPER_SCOPE.v1`
- **Authoring note:** the module teaches the two categories and names no exemplars, so this rubric must credit any category-correct instantiation rather than matching an authored list of nouns.

**B6 — `BOS.MD01.DUEL.STAMP.PRIVATE_LETTER.v1`**

- **Question:** “Is a private handwritten letter caught by the Act? Say why or why not.”
- **Accept:** no — it is neither printed nor a legal paper, so it falls outside what the Act targets.
- **Also accept:** “no, nobody printed it and it isn't official”; “no, that's personal, not legal or printed.”
- **Reject:** yes; a bare “no” with no reason, which is a coin flip on a two-way question.
- **Rubric:** `CRIT.OUTSIDE_SCOPE` — STRONG answers no and gives the printed-or-legal reason; PARTIAL answers no with a reason that only gestures at “personal”; MISSING answers yes or gives no reason.
- **Cards:** `BOS.MD01.CARD.STAMP_PAPER_SCOPE.v1`

#### Pool C — representation

- **Pool ID:** `BOS.MD01.POOL.DUEL_REPRESENTATION.v1`
- **Concept:** `BOS.MD01.CONCEPT.REPRESENTATION.v1`
- **Authored depth:** six of six

**C1 — `BOS.MD01.DUEL.REP.WHAT_RIGHT.v1`**

- **Question:** “You nailed that sheet to my board. What right does it claim I denied you?”
- **Accept:** the right not to be taxed except by a body the town elected — and Boston elects no member of Parliament.
- **Also accept:** “we've got nobody in Parliament, so it can't tax us”; “no taxation without representation.”
- **Reject:** that every tax is illegal; that Boston owes obedience to no government; that the tax is simply too high.
- **Rubric:** `CRIT.ELECTED_CONSENT` — STRONG grounds the claim in the absence of elected representation in Parliament; PARTIAL objects on some other lawful ground; MISSING objects to taxation as such or to the amount.
- **Cards:** `BOS.MD01.CARD.NO_MEMBER_IN_PARLIAMENT.v1`, `BOS.MD01.CARD.CONSENT_GROUND.v1`

**C2 — `BOS.MD01.DUEL.REP.BOSTON_DOES_ELECT.v1`**

- **Question:** “Boston does elect something. What, and why doesn't that settle it?”
- **Accept:** Boston elects its own local assembly, but it elects no member of Parliament, and Parliament is the body laying this tax.
- **Also accept:** “we vote for our own town assembly, not for Parliament.”
- **Reject:** that Boston elects nothing at all; that Boston does have members in Parliament.
- **Rubric:** `CRIT.ASSEMBLY_NOT_PARLIAMENT` — STRONG names the local assembly and the absence from Parliament; PARTIAL names one of the two; MISSING names neither or reverses them.
- **Cards:** `BOS.MD01.CARD.NO_MEMBER_IN_PARLIAMENT.v1`

**C3 — `BOS.MD01.DUEL.REP.NOT_THE_MONEY.v1`**

- **Question:** “Is the objection that the tax costs too much, or something else?”
- **Accept:** something else — the objection is to who laid it. Parliament is a body Boston did not choose.
- **Also accept:** “it isn't the price, it's who decided”; “we'd say the same if it were a penny.”
- **Reject:** cost-based answers; answers about affordability or hard times.
- **Rubric:** `CRIT.AUTHORITY_NOT_COST` — STRONG moves the ground from cost to who holds the authority; PARTIAL says “something else” without naming the authority; MISSING argues cost.
- **Cards:** `BOS.MD01.CARD.CONSENT_GROUND.v1`

**C4 — `BOS.MD01.DUEL.REP.FINISH_THE_CLAIM.v1`**

- **Question:** “Finish the claim for me: a tax should only be laid by —”
- **Accept:** a body the taxed people have elected; their own chosen representatives.
- **Also accept:** “people we voted for”; “our own assembly”; “someone we picked.”
- **Reject:** “the King”; “nobody”; “Parliament”; “the town's richest men.”
- **Rubric:** `CRIT.CONSENT_PRINCIPLE` — STRONG names an elected or chosen body; PARTIAL names a local body without the elected idea; MISSING names an unelected authority or rejects taxation entirely.
- **Cards:** `BOS.MD01.CARD.CONSENT_GROUND.v1`, `BOS.MD01.CARD.NO_MEMBER_IN_PARLIAMENT.v1`

**C5 — `BOS.MD01.DUEL.REP.SPEAKS_FOR_ALL.v1`**

- **Question:** “A member of Parliament says he speaks for every British subject, Boston included. Answer him.”
- **Accept:** Boston elected none of them, so none of them sits there by Boston's choice; the tax is still laid by a body the town did not choose.
- **Also accept:** “we never voted for him”; “he can say it, but nobody here picked him.”
- **Reject:** conceding the point; answers about distance or travel time; answers that all taxes are void.
- **Rubric:** `CRIT.NOT_CHOSEN_BY_US` — STRONG rests on Boston having elected no member; PARTIAL disputes the claim without the elected grounding; MISSING concedes or changes the subject.
- **Cards:** `BOS.MD01.CARD.NO_MEMBER_IN_PARLIAMENT.v1`, `BOS.MD01.CARD.CONSENT_GROUND.v1`

**C6 — `BOS.MD01.DUEL.REP.LAWFUL_BUT_UNJUST.v1`**

- **Question:** “Parliament passed the Act by a lawful vote. Why does Boston still call it unjust?”
- **Accept:** because the vote was taken in a body Boston did not elect; lawful passage in Parliament is not this town's consent.
- **Also accept:** “legal for them, but nobody there speaks for us”; “a vote we had no part in isn't our agreement.”
- **Reject:** denying Parliament's authority over anything at all; arguing the amount; claiming the vote was rigged.
- **Rubric:** `CRIT.LAWFUL_VS_CONSENTED` — STRONG separates lawful passage from consent by the taxed town's own representatives; PARTIAL asserts injustice with a consent-flavoured but unspecific reason; MISSING denies the vote or argues cost.
- **Cards:** `BOS.MD01.CARD.CONSENT_GROUND.v1`, `BOS.MD01.CARD.NO_MEMBER_IN_PARLIAMENT.v1`

#### Module-coverage verification

Every item above was checked against the six cards in §4.7. **No item requires a proposition the module does not teach.** The check produced two rubric-design constraints and one deliberate narrowing.

1. **B5 asks for exemplars the module never names.** The module teaches two categories, printed paper and legal paper, and gives no examples of either. B5 is therefore an application item, and its rubric must credit any category-correct instantiation rather than matching an authored list of nouns. A fixed list would fail a student who correctly answered “a licence.”
2. **A1 must treat several names as one war.** The module says “the war with France”; §4.1 of this document says “the French and Indian War”; a student may write either, or “the Seven Years' War.” The rubric treats all three as the same war. This is precisely the correct-but-unusually-worded case §1.7 requires the evaluation set to cover.
3. **One clause was deliberately dropped and must not be reinstated silently.** The retired multiple-choice K1 credited “the war with France left Britain in debt **and paying to defend new territory**.” The module teaches the debt and says nothing about the cost of defending new territory, so no item above depends on that clause. Either add it to the module's postwar card or leave it out of the bank, but do not grade on content that is taught nowhere.

### 4.10 Knowledge measurement and Codex events

**There is no knowledge predicate.** The three-minute mission contains no knowledge checks, so M1 has no knowledge-failure state and nothing on the floor is scored for understanding.

All knowledge measurement happens in the duel. Its six questions are free-response, graded by classification against an authored rubric, and each verdict does exactly one thing: it sets that round's bullet count at **3 for correct, 1 for wrong**. A verdict gates nothing, schedules nothing, and mints nothing.

There is therefore **no separate knowledge axis that can fail a mission**. Losing the duel is losing the duel. Knowledge expresses itself as being materially weaker in the fight — a player who misses every question fights all six rounds on one bullet — and that is the entire point of the bullet economy.

**The two-axis failure diagnosis collapses entirely.** Recorded explicitly because it is referenced elsewhere in the repo: there is no mechanical axis, no knowledge axis, no per-axis classification, and no knowledge no-signal case. An attempt clears or it does not.

M1 does not contain a synthesis check or applied demonstration. Synthesis belongs in the 3-minute module or the chapter capstone, where it can be given enough time without interrupting mission flow. Those surfaces own the exposure contract's applied demonstration.

**The mission mints no Codex cards.** Cards are minted at **100% per concept on the chapter capstone** (§1.8), which is the chapter's one gate and sits after M14. Duel performance is evidence of understanding, not a card-granting event, and no duel result makes a card PvP-legal.

### 4.11 Failure and retry behavior

An attempt is lost on the floor or lost in the duel. There is no third axis and no knowledge-failure state.

#### Detection

- Before the final court, suspicion costs route position: close a crossover, force a lower line, or push the player behind the next cover object.
- Those route costs are committed only when they alter the remainder of the attempt.
- Suspicion reaching confrontation in the final court lets the constable close the board route.
- Only that authored fail point ends the attempt on the floor.
- There is no chase and no requirement to escape a grab.
- Terminal request:
  - `waitAck(ctx, "The constable has closed the route to the post.", "BOS.MD01.CUE.FAIL_DETECTED.v1")`
- The attempt is spent. Nothing is classified as a knowledge outcome, because the mission measures none.

#### Precision failure

- `POST_JOB` returns phase scores for `lineUp`, `tackLeft`, and `tackRight`.
- If the configured pass predicate is missed, the sheet tears or hangs illegibly.
- Terminal request:
  - `waitAck(ctx, "The sheet tears loose before the town can read it.", "BOS.MD01.CUE.FAIL_POST_JOB.v1")`
- The attempt is spent on the same terms as a detection fail.

#### Duel loss

- Completing the post arms the duel, and the duel is where the attempt is finally won or lost.
- Six rounds of twenty seconds. Each round's rubric verdict sets that round's bullet count at 3 or 1 and does nothing else.
- Losing the duel ends the attempt. It is not reclassified as a knowledge failure — a player who answered all six correctly and still lost simply lost the fight.
- §4.8 stages the face-off and the round cycle and §4.9 authors the questions, but the system that runs them does not exist and its terminal copy is unwritten. See §2.5.

#### Retry

- A retry is the same mission at the same difficulty. Nothing is eased: same input bar, same patrol dials, same authored patterns, same duel bar.
- The 3-minute module is mandatory again before each retry and pays no XP.
- Duel questions are reselected from the same pools under the same rubrics; a retry never repeats an item an earlier attempt consumed. §4.9's eighteen items cover exactly three attempts and are exhausted by the third.
- The only thing that changes between attempts is the payout: full XP, then two-thirds, then one-third.
- **The third failure is terminal.** M1 is failed permanently, the player advances to the next mission, and M1 pays zero XP forever. There are no further replays.

#### Clear

- Physical route complete.
- `POST_JOB` pass predicate met.
- Duel won.
- The clear pays that attempt's scheduled XP: full on the first attempt, two-thirds on the first retry, one-third on the second.
- The result screen reports the duel's per-question verdicts and the concepts they touched. It does not claim demonstration, does not mint Codex cards, and does not show a competitive result or mechanical rating.

### 4.12 Mission tuning

There is one difficulty. Every player meets the same dials on every attempt, and the only thing that changes across the three attempts is the XP paid.

These are M1 starting values, not chapter-wide constants. Values copied from existing watcher code are marked **existing baseline**. Everything else is **provisional** and requires device playtesting.

| Dial | Value | Status |
|---|---:|---|
| Patrol count | 1 | Fixed for readability |
| Patrol half-angle | 28° | Existing baseline, `stealthManifest.ts` |
| Patrol range | 10 m | Existing baseline, `WATCH-patrol` |
| Patrol speed | 1.05 m/s | Existing baseline, `WATCH-patrol` |
| Suspicion accrual at full visibility | 0.60/s | Existing baseline, `watcherDetection.ts` |
| Suspicion decay | 0.55/s | Existing baseline |
| Final-court alert-to-fail clock | 3.0 s | New mission dial; provisional |
| Early detection cost | Lose one line or elevation advantage | Provisional |
| Post pattern speed and density | 1.00× authored pattern | Authored once, low enough for a trackpad |
| Hit-window width | Authored constant | Identical on every attempt; absolute milliseconds do not exist yet |
| `POST_JOB` average normalized quality threshold | 0.70 | Provisional |
| `POST_JOB` minimum phase quality | 0.50 | Provisional |
| Duel question correctness | Authored rubric | Locked; never eased |

Unknowns that require playtesting:

- absolute hit-window milliseconds;
- exact POST_JOB note count and cadence;
- input timeout per line-up/tack phase;
- minimum readable warning time for the patrol cone;
- whether 3.0/5.0 seconds is enough escalation separation on a school Chromebook;
- whether the proposed phase-score predicate produces the intended first-attempt clear rate; and
- the target clear rate. It must be selected after observing real eighth-grade players, not inferred from adult developers.

### 4.13 Fixed and variable content

Fixed every run:

- historical date and causal claims;
- the three concept IDs;
- route start and public-post endpoint;
- one connected four-layer arena;
- at least three viable base-verb lines;
- base-verb-only solution;
- zero in-mission knowledge checks;
- one `POST_JOB`;
- six duel rounds, two per concept, in the authored concept order;
- three attempts at one authored difficulty;
- boss confrontation purpose; and
- the XP decay schedule across those attempts.

Seeded from authored pools:

- one of at least three patrol start phases/arrangements;
- authored obstacle-state variation that preserves all three route families;
- which two of a concept's six authored items its two rounds draw, never repeating across the three attempts;
- one of at least three authored `POST_JOB` patterns;
- ambient lines; and
- non-semantic camera micro-variation.

The seed may vary presentation and route reading. It may not vary historical truth, required concepts, authored rubrics, the duel's concept order, or the existence of a legal base-verb path.

### 4.14 Existing 3D systems reused

M1 reuses:

- `packages/chapter-boston-world/src/world/TraversalDirector.tsx`
  - contextual authored traversal actions inside one live region;
- `packages/engine-world/src/traversalResolver.ts`
  - deterministic affordance selection, approach validation, hysteresis, and input buffering;
- `packages/chapter-boston-world/src/world/WatcherDirector.tsx`
  - one readable patrol, sight cone, and suspicion integration;
- `packages/chapter-boston-world/src/world/InteractionDirector.tsx`
  - unified contextual interaction surface;
- `packages/chapter-boston-world/src/world/InteriorDirector.tsx`
  - only the opening Mercer threshold staging, not an explorable mission phase;
- `packages/chapter-boston-world/src/world/MechanicRigs.tsx`
  - first-person/world staging for `POST_JOB`;
- `packages/chapter-boston-world/src/world/QuestMarkerDirector.tsx`
  - the single public-post endpoint only; no intermediate route markers;
- `packages/chapter-boston-world/src/world/CameraDirector.tsx`
  - threshold handoff, traversal framing, post framing, and boss two-shot;
- `packages/chapter-boston-world/src/world/ChoreographyDirector.tsx`
  - stable cue execution and readiness;
- `packages/chapter-boston-world/src/world/gameplayWorld.ts`
  - collision, sweep tests, and line of sight.

`packages/chapter-boston-world/src/world/ChaseDirector.tsx` is intentionally not active in M1. Early detection costs route position; only final-court detection terminates the attempt. A chase would teach an additional pressure grammar and make a special escape affordance tempting, both contrary to M1's purpose.

### 4.15 M1 work that does not exist yet

Infrastructure:

- mission definition/registry;
- instanced mission container;
- mission-specific world/arena selection;
- hub-to-mission launch route;
- a result return path to the Hub;
- an `onClick`/deployment handler for `AssessmentPanel.tsx`;
- attempt-count state, including the permanent-failure terminal after the second retry;
- XP-decay accounting for the full / two-thirds / one-third schedule;
- minimal traversal-gate request and committed terminal/fail events;
- durable route-position penalties for deterministic replay;
- watcher and mechanic configuration at the one authored difficulty;
- seeded prompt, patrol, obstacle, and precision-pattern selection;
- mission-clear XP awards;
- XP curve, Level thresholds, and Level-driven ability unlocks;
- demonstrated-understanding-to-Codex card lifecycle; and
- per-concept capstone mastery and PvP-legal state.

Content:

- an instanced route assembled from imported Boston assets;
- official Stamp notice texture;
- response-handbill texture;
- at least three POST_JOB patterns;
- one connected, vertically layered arena with seeded obstacle/patrol states;
- authored precision timing data at the one authored difficulty; and
- capstone item depth for the chapter's concepts.

Done since this section was written: the 3-minute module, the eighteen duel items with binary rubrics, and the nine M1 Codex card definitions are authored in `content/m1`. They still need hashing through the content compiler and an SME review pass.

---

## 5. M2 — Landed Weight

- **Date:** 1765, working daylight port
- **Concepts:** `8.11(A)` geography shapes economic activity; `8.12(A)` regional economic differences
- **Scenario shape:** Smuggle the Crate
- **Signature verb:** making cargo disappear into the ordinary
- **Target:** approximately 3:35
- **Beyond-base requirement:** none

**Continuous-route treatment:** brig deck, boardwalk, hoist loft, warehouse apron, and gate are elevations and regions of one cargo floor. The berth, hoist, and gate are not separate arrival requests.

This is the only smuggle scenario in which the opponent is a manifest rather than a soldier. The cask is not inherently contraband; it is dutiable and unentered. The officer's power is paperwork.

**Hook, 0:00–0:15.** Start on the brig's deck as the collector's boat comes alongside. The cask is already moving. The goal—get it into the warehouse record before the collector reaches the apron—is legible immediately.

**Phase 1, 0:15–1:15.** Carry the cask down the pier and along the boardwalk. Heavy-haul state constrains speed and forces the exposed route, but ordinary walking, vault-compatible thresholds, and a visible rest point keep this inside the base grammar. The first valley check occurs with the cask on a bollard: choose the berth from the harbor chart. The deep outer berth is fast but exposed; the shallow flats lose the tide; the north-side wharf under warehouse eaves fits Boston's working geography.

**Phase 2, 1:15–2:45.** Precision dominates: work the warehouse hoist without a thud, then stop the crane brake. Valley check two chooses which cargo should leave on the same tide—dried cod, barrel staves, or English broadcloth. Valley check three selects the truthful manifest: molasses from a British island, from a Dutch island, or omitted. Traversal connects the hoist, loft, and gate; it does not become a second mission.

**Boss, 2:45–3:35.** The collector conducts a spot-check at the wharf gate. The mechanical peak is a steady carry across the gangplank-narrow boardwalk through ordinary traffic. At the valley after the cask is grounded, he asks what Boston has to trade if not this. The correct answer names the port's actual economy. He marks the ledger and steps aside.

**Reuse:** wharf apron, crane, hoist, scale, barrels, crate mound, gangplank, bollards, brig, sloop, `SJ-dock-haul`, dockhand, officer, and Thomas assets. New content is a harbor-chart texture and manifest set.

The concept IDs do not exist in runtime. Physical prototyping may proceed, but authored learning behavior cannot ship until the vocabulary mismatch is resolved.

---

## 6. M3 — The Comptroller's Books

- **Date:** night of 26 August 1765
- **Original concepts:** `8.4(A)` Stamp Act/no representation/postwar policy; `8.15(C)` colonial grievances
- **Current concept assignment:** open
- **Scenario shape:** Steal the Stamp Shipment
- **Signature verb:** the coordinated job—taking an office's proof before the crowd destroys it
- **Target:** approximately 3:40
- **Beyond-base requirement:** none

**Continuous-route treatment:** roof, loading scuttle, records rooms, counter, and crowd escape form one connected heist floor. Crew cues alter pressure inside it; they do not advance the player between waypoints.

M1 now owns the implemented postwar-revenue, Stamp-scope, and representation content that originally made M3 the carrier for `8.4(A)`. M3 may retain `8.15(C)` as one concept, but its second concept—or a full replacement pair—has not been selected. This document does not invent one. The mission is content-blocked until curriculum allocation is repaired.

The historical carrier remains strong. On 26 August 1765 a Boston crowd broke into the vice-admiralty court and the Comptroller of Customs' house and destroyed records. The Loyal Nine and movement leadership disavowed the attack. The player's fictional role is to preserve evidence from their own side's fire.

**Hook, 0:00–0:15.** Begin on the Custom House roof with crowd noise already rising. Pike holds a shutter and a sexton prepares the bell.

**Phase 1, 0:15–1:05.** Base roof traversal reaches a loading scuttle on the crew's authored cue. A fixed ladder and adjacent crate stack ensure no special vertical tool is needed. The original valley check selected the collector's counting room, seizure store, or vice-admiralty clerk's pen; its final concept owner is pending.

**Phase 2, 1:05–2:55.** The chapter's densest Act-1 precision cluster: cut the records-press seal, stop the counter-gate lock, and force the pigeonhole rack on crew cues. Valley material distinguishes a blank writ of assistance, vice-admiralty docket, ordinary wharfage receipts, and stamped-paper requisition. The original war-debt check has moved to M1 and must be replaced only after concept allocation is settled.

**Boss, 2:55–3:40.** Escape through a building filling with people before the shutter closes. An agitator demands the satchel for the fire. The decisive dialogue asks what the records are for. One answer preserves both evidence and crowd legitimacy; a poor answer allows the papers to burn while history still proceeds.

**Reuse:** Custom House exterior/interior, pigeonholes, sealing desk, seizure shelf, paper satchel, scaffold climb, bell rope, Pike, agitator, officer, and scripted choreography. New work is a roof scuttle, document textures, seal pattern, and crew-cue scheduler.

---

## 7. M4 — Set It Before Morning

- **Date:** October–November 1765
- **Concepts:** `8.14(A)` free enterprise; `8.15(E)` Locke and Montesquieu
- **Scenario shape:** Clandestine Press
- **Signature verb:** choosing the words that go on the record
- **Target:** approximately 3:40
- **Beyond-base requirement:** none

**Continuous-route treatment:** packet entry, press floor, stair, and roof escape are one loaded space. The press is the arena's pressure center, not a separate scene reached through waypoint traversal.

The mission prints two imported documents: the Stamp Act Congress's Declaration of Rights and Grievances and New York merchants' non-importation agreement. Boston printers reprinting other colonies' resolves is the historical action.

**Hook, 0:00–0:15.** A runner drops the New York packet through the shutter. The compositor has fled and the raid is already closing.

**Phase 1, 0:15–1:05.** A short base-traversal approach leads directly to the press. Precision uses composition and inking patterns. During the forme-soak valley, choose the front sheet: Declaration of Rights, merchants' agreement, or anonymous threat. The choice teaches what organized free enterprise can do without making a shopping mechanic.

**Phase 2, 1:05–2:35.** Pattern density rises as the door pressure increases. Valley check two chooses the line that finishes the consent argument: consent of the governed, the King's grace, or town custom. Valley check three chooses what goes into the fire: subscriber list, set forme, or proof. The names create prosecutable evidence; the argument can be reset.

**Boss, 2:35–3:40.** Complete the last pull, take the wet sheets, and escape by a deliberately built base route: fixed work ladder, adjacent roof boards, ordinary run/vault/climb/drop. No roof-only ability is allowed or needed. The officer below asks whose authority the sheet rests on. The correct answer names the political principle rather than a threat.

**Reuse:** common press, type cases, composition station, ink balls, drying rack, Mercer interior, ladder, roof boards, Abigail, Ned, officer, and constable assets. New work is document textures, a shutter-forcing cue, and precision patterns.

M4 closes early Act 1 with no ability requirement. Its physical layout must preserve that law even if later missions introduce more expressive traversal.

---

## 8. M5 — A Journal of the Times

- **Date:** winter 1768–69
- **Concepts:** `8.23(B)` urbanization causes conflict; `8.21(B)` free speech and press
- **Scenario shape:** Clandestine Press
- **Signature verb:** keeping the record
- **Target:** approximately 3:35
- **Beyond-base requirement:** none required
- **Introduces, low stakes:** a way to pull a watchman's attention to a chosen spot

**Continuous-route treatment:** tavern roof, Mercer approach/interior threshold, packet exit, and ropewalk edge are compressed into one occupied-town block. A sentry loop and packet deadline shape line choice throughout.

This press is producing a running record of soldiers' conduct for packet circulation to New York and London. The enemy is not a raid but the first-light sailing deadline and a billeted soldier above the shop.

**Hook, 0:00–0:15.** A sentry challenges movement outside the shop door. The immediate goal is to reach the press with the week's testimony.

**Phase 1, 0:15–1:10.** Traverse from tavern roof to Mercer under curfew using base routes. A safe optional branch introduces the attention-relocation affordance: move a harmless environmental sound to a chosen empty corner so the sentry looks away. Failure to use it costs only a slower base route; the mission never requires it. The valley check selects which incident leads the sheet: soldier undercutting a ropemaker for work, bayonet at a boy, or billeting in a widow's room. The structural wage conflict is the target.

**Phase 2, 1:10–2:50.** Press patterns rise while footsteps move overhead. A miss produces audible pressure but does not create a new mechanic. Valley check two chooses deposition with name/date over rumor or verse. Valley check three chooses the New York packet over local suppression points.

**Boss, 2:50–3:35.** Carry the sheet through the ropewalk as a fight begins. Traversal uses bracing lanes and base movement; no contact-recovery ability is yet required. The ropemaker and soldier demand competing versions. The decisive check chooses the account both men's own words support.

**Reuse:** ropewalk shell and rig, Mercer press set, roofs, townsman/goodwife/dockhand population, and existing `LORE-ropewalk`. New chapter spend begins here: redcoat rig, sentry box, occupation dressing, and crowd-surge staging.

---

## 9. M6 — A Short Narrative

- **Date:** 5–15 March 1770
- **Concepts:** `8.23(B)` urbanization causes conflict; `8.4(B)` individuals—Crispus Attucks and John Adams
- **Scenario shape:** Smuggle the Crate
- **Signature verb:** moving the town's testimony past the men it accuses
- **Target:** approximately 3:45
- **Beyond-base requirement:** none required
- **Reintroduces optionally:** attention relocation
- **Introduces, low stakes:** a way to reach an isolated second-storey opening when no adjacent base climb exists

**Continuous-route treatment:** Town House collection, watched street, wharf apron, and gangway are one recomposed route. Collecting the packet changes the carried state; it does not begin a new waypoint leg.

The “crate” is the packet of ninety-six sworn depositions from *A Short Narrative of the Horrid Massacre*. It must reach the London packet before Captain Preston's account.

**Hook, 0:00–0:15.** The Massacre occurs as an authored, distant set-piece while the runner pulls a boy out of the front rank. The violence is not interactive and carries no gore.

**Phase 1, 0:15–1:15.** Base traversal crosses a town under watch to collect the packet at the Town House. The first valley check selects how Attucks is named and why his identity matters to the town's account. An optional upper service-window shortcut introduces isolated-height access in a safe context. The base stairs remain available, so this mission does not require the affordance.

**Phase 2, 1:15–2:55.** Run to the wharf past two sentries, then pass the packet up the ship's side with a steady precision sequence. Attention relocation may create a cleaner route but is optional. Valley check two distinguishes “mob” propaganda from the actual dockworkers, ropemakers, apprentices, and sailors present. Valley check three asks why John Adams agreed to defend the soldiers.

**Boss, 2:55–3:45.** Cross the wet gangway with the packet while a customs officer works the papers. After grounding the packet, choose the single deposition credible enough to make the officer step aside.

**Reuse:** King Street/Town House, Custom House, civic interior, wharf, gangplank, brig, paper satchel, officer, redcoat, and crowd systems. New work includes Crispus Attucks representation, March weather, aftermath dressing, and Massacre staging. Crispus Attucks's depiction requires historical review before art.

---

## 10. M7 — Counsel for the Defense

- **Date:** October–December 1770
- **Concepts:** `8.20(A)` civic virtue; `8.19(C)` responsible citizenship and juries
- **Scenario shape:** Steal the Stamp Shipment, re-dressed as a coordinated escort
- **Signature verb:** getting the other side into court
- **Target:** approximately 3:35
- **Beyond-base requirement:** a way to pull a watchman's or crowd leader's attention to a chosen spot
- **Introduces, low stakes:** isolated-height access recurs as an optional shutter route

**Continuous-route treatment:** guardhouse, alley, cellar, church edge, and Town House steps are alternate layers through one courtward floor. The witness remains physically present through the whole route.

Nothing is stolen. The “cargo” is a young redcoat witness who must reach the Town House court through a crowd that wants a conviction.

**Hook, 0:00–0:15.** The crowd is already outside the guardhouse. Adams's clerk names the court door as the objective.

**Phase 1, 0:15–1:10.** Move guardhouse to alley on the sexton's cue. The required attention-relocation affordance moves a watcher to a harmless authored spot long enough for the witness to cross. The route cannot be completed by waiting forever; this is the first demand after M5's low-stakes introduction. The valley check chooses a route based on who controls it and why a citizen's route must end in a courtroom.

**Phase 2, 1:10–2:40.** Traverse through and around the thickening crowd. Precision times a cellar hatch and works a shutter latch. A second-storey shutter offers a safe optional repeat of isolated-height access before M8 demands it. Valley checks explain why the town's own lawyer took the case and what testimony a lawful defense actually needs.

**Boss, 2:40–3:35.** On the Town House steps, a compact stationary dialogue confrontation uses the same choose primitive as other NPC checks; it does not introduce a separate combat system. The decisive answer protects the jury's role without asserting the soldiers' guilt or innocence. The player wins by keeping a trial possible.

**Reuse:** civic building/interior, churchyard, steps, door kit, bell rope, agitator, goodwife, officer, and redcoat. New work includes John Adams representation, courtroom dressing, and authored evidence presentation.

---

## 11. M8 — The Circular

- **Date:** winter 1772–73
- **Concepts:** `8.10(C)` waterways and communication; `8.3(A)` representative government
- **Scenario shape:** Handbill Run
- **Signature verb:** route mastery under a closing clock—the network made physical
- **Target:** approximately 3:35
- **Beyond-base requirement:** a way to reach an isolated second-storey opening when no adjacent base climb exists
- **Introduces, low stakes:** a way to keep the incriminating face of carried evidence unreadable while moving

**Continuous-route treatment:** the sloop, rider, carter, gate walk, and gate are arranged along one tide-to-gate circuit with crossovers. Handoffs are interactions inside the run, not separate destination selections.

The “posts” are other towns' committees. Four handoffs must leave by water, rider, and road before the tide and gate close.

**Hook, 0:00–0:15.** Samuel Adams presses the Boston pamphlet into the runner's hands as the committee breaks.

**Phase 1, 0:15–1:10.** Reach the gate walk. The ordinary ladder has been pulled up; isolated-height access, introduced optionally in M6 and rehearsed in M7, is now required to reach the service opening. The valley check matches carrier to destination—Marblehead, Worcester, Newport—and teaches why Boston's harbor makes it a communication hub.

**Phase 2, 1:10–2:45.** Complete handoffs to a coasting sloop, east-gate rider, and Roxbury market carter. Valley check two chooses what the packet asks towns to do: call their own town meetings and reply, not send men or money. Valley check three distinguishes publishing from organizing. An optional first-use lane lets the player keep the packet's printed face unreadable while crossing an ordinary checkpoint. Failure only creates a longer route; concealment is not required until M9.

**Boss, 2:45–3:35.** Traverse roof to gate walk to carter as the gate closes. After the movement peak, the officer asks what a town meeting may lawfully do. The correct answer frames the packet as a town petition to its own assembly.

**Reuse:** town gate, rider post, hand cart, hay cart, market awning, sloop, work ladder, rain state, rider, and crier. New work includes Samuel Adams representation, committee-letter textures, and the gate-walk route.

---

## 12. M9 — Twenty Days

- **Date:** 28 November–16 December 1773
- **Concepts:** `8.20(B)` civil disobedience; `8.19(A)` unalienable and natural rights
- **Scenario shape:** Smuggle the Crate, inverted
- **Signature verb:** keeping something from moving
- **Target:** approximately 3:40
- **Beyond-base requirement:** a way to keep the incriminating face of carried evidence unreadable while moving
- **Introduces, low stakes:** a way to recover movement after non-lethal body contact without ending the run

**Continuous-route treatment:** wharf apron, connected ship decks, owner's edge, and customs approach form one patrol circuit. The player keeps moving while guarding the non-landing state.

This is the slate's acknowledged shape stretch. The objective is to prevent tea from being landed. The player joins the nightly guard on Griffin's Wharf and carries ship's papers between the owner, guard, and customs edge.

**Hook, 0:00–0:15.** The tally post reads day nineteen. The customs deadline is visible and nearly expired.

**Phase 1, 0:15–1:10.** Traverse wharf and ship decks while watching for the customs boat. The first valley check asks what the guard is preventing: not theft or sailors leaving, but the legal landing of tea. The carried-evidence concealment affordance is required to move the ship's papers through the watched apron.

**Phase 2, 1:10–2:55.** Seal the owner's affidavit and re-lash a hatch loosened by a customs man. Valley checks choose the lawful clearance route and the property/consent claim behind the guard. A low-stakes gangway bump introduces contact recovery: failure drops the player to a safe lower deck and costs time, but does not fail the mission.

**Boss, 2:55–3:40.** Customs attempts three landings. Base traversal places the runner at each gangway before contact. The final dialogue identifies the lawful ground for refusing tonight. The action stops short of violence.

**Reuse:** Griffin's Wharf, brig, sloop, gangplank, rails, bollards, crates, torches, night/rain, officer, dockhand, and agitator. New work includes tea chests, tally post, and ship-paper textures.

The inversion remains a production risk. If playtesting reads as passive waiting rather than active route control, preserve the historical job but reconsider its scenario-shape label.

---

## 13. M10 — Griffin's Wharf

- **Date:** night of 16 December 1773
- **Concepts:** `8.20(B)` civil disobedience; `8.12(C)` causes and effects of regional economic differences
- **Scenario shape:** Steal the Stamp Shipment
- **Signature verb:** the coordinated job performed in front of witnesses
- **Target on paper:** approximately 3:40
- **Known timing problem:** the slate itself says this mission wants five minutes
- **Beyond-base requirement:** a way to recover movement after non-lethal body contact without ending the run

**Continuous-route treatment:** Old South exit, wharf approach, gangways, and ship decks must read as one accelerating public action. If the street distance cannot fit, bridge it with authored choreography rather than a sequence of travel targets.

The crew job operates at public scale: a hundred participants, thousands watching, and a strict rule that only tea is damaged.

**Hook, 0:00–0:15.** Old South opens and the meeting empties into the street. The playable column transit must be no more than twenty seconds or omitted into choreography.

**Phase 1, 0:15–1:05.** Traverse to the wharf and board on crew cues. Contact recovery is required when the dense column compresses at the gangway; without it, ordinary incidental contact would end too many runs. The first valley check identifies what may leave the ship: tea only.

**Phase 2, 1:05–2:55.** Precision breaks hoops, tips a chest without taking the player overboard, and cuts lashings. Valley checks compare New York, Philadelphia, and Charleston responses and identify the monopoly/duty as the protest's target.

**Boss, 2:55–3:40 nominal.** Complete the last ship under a tide clock. The officer asks who bears the loss and to whom. The correct economic answer distinguishes protest against the East India Company monopoly and Crown revenue from theft from a neighbor.

The mission's authored content does not honestly fit four minutes if it includes a playable march, three ships, four checks, and a boss. Production must choose one:

- compress the meeting exit and transit into a twenty-second authored bridge and keep a 3:50 mission; or
- explicitly authorize M10 as the slate's one approximately five-minute exception.

Do not silently cut knowledge beats or speed unreadable dialogue to force the timer.

**Reuse:** Old South, Griffin's Wharf, both ships, crates, barrels, torches, crowd, agitator, dockhand, and officer. New work includes tea chests, hoop patterns, and historically reviewed disguise dressing. The “Mohawk” disguise must be reviewed before art and must not become caricature.

---

## 14. M11 — The Port Is Shut

- **Date:** June–September 1774
- **Concepts:** `8.4(A)` Intolerable Acts and mercantilism; `8.1(A)` eras, causes, and effects
- **Scenario shape:** Smuggle the Crate
- **Signature verb:** moving what the law has forbidden to move
- **Target:** approximately 3:35
- **Beyond-base requirement:** carried-evidence concealment recurs
- **Introduces, low stakes:** a way to cross a horizontal gap that has no adjacent support or lower base route

**Continuous-route treatment:** dead wharf, relief approach, cart cover, sentry line, and Neck gate are one blockade corridor with parallel lines. The loss of old routes is spatial pressure, not a menu transition.

The harbor is closed by law. Routes learned in Act 1 are visibly gone. Relief livestock and fish arrive overland to a town that can no longer feed itself by sea.

**Hook, 0:00–0:15.** Show the Port Act notice and a chained wharf gate that earlier missions treated as open.

**Phase 1, 0:15–1:10.** Traverse the dead wharf toward the Neck road. The first valley check distinguishes the Port Act from the Massachusetts Government, Administration of Justice, and Quartering Acts.

**Phase 2, 1:10–2:45.** Carry relief through the sentry line under a cart tarpaulin. Concealment of the relief papers is required and recurs from M9. Precision steadies the load and works the gate bar. Valley checks identify the Crown-controlled trade channel and order the causal chain from destroyed tea to port closure to colonial response and Congress.

An optional marsh detour introduces unsupported-gap traversal. It reaches a bonus source but is never required; a base ground route remains. The gap is wide enough that run/vault/climb/drop alone cannot solve that optional lane.

**Boss, 2:45–3:35.** Cross the Neck checkpoint with the cart while a soldier inspects it. The decisive answer explains what the closure intended and the unity it produced instead.

**Reuse:** dead-dressed wharf, town gate, fence gate, carts, crates, officer, redcoat, and dockhand. New work includes Port Act notice, blockade dressing, chained gate, and sentry line.

---

## 15. M12 — The Group

- **Date:** 1774–75
- **Concepts:** `8.23(E)` contributions of women; `8.4(B)` individuals—Mercy Otis Warren and Abigail Adams
- **Scenario shape:** Clandestine Press
- **Signature verb:** printing something that cannot be traced back
- **Target:** approximately 3:35
- **Beyond-base requirement:** a way to keep the incriminating face of carried evidence unreadable while moving

**Continuous-route treatment:** market-basket handoff, watched approach, press floor, drying area, and search escape occupy one shop block. Carried-document state persists continuously.

Mercy Otis Warren's anonymous satire arrives in a market basket. Attribution would be ruinous. The same run must move one of Abigail Adams's 1774–75 siege letters; “Remember the Ladies” is too late for this chapter.

**Hook, 0:00–0:15.** The manuscript arrives in Sarah's basket while a billeted soldier watches the street.

**Phase 1, 0:15–1:05.** Carry it to the press. Concealment is required because the manuscript's face, not the basket itself, is the evidence. The first valley check chooses what is removed before setting: the author's name, not the recognizable targets or dedication.

**Phase 2, 1:05–2:45.** Print at Act-4 density with a precision constraint of uniform setting rather than raw speed. Valley check two selects the account of spinning meetings and tea agreements. Valley check three selects how Abigail's letter travels. Concealment recurs in a different material context, justifying the affordance as a general tool rather than a tea-specific gimmick.

**Boss, 2:45–3:35.** A billeting search reaches the shop. Break the forme into pied type and clear wet sheets while the officer works the front room. The final dialogue protects the author without offering a lie the shop cannot sustain.

**Reuse:** Mercer press assets, spinning wheel, textile cluster, drying racks, paper satchel, goodwife, Abigail, redcoat, officer, and Sarah. New work includes Mercy Otis Warren and Abigail Adams representation, document textures, and a pied-type pattern.

Phillis Wheatley remains valley/Codex content, not a substituted gating beat.

---

## 16. M13 — The Alarm

- **Date:** night of 18–19 April 1775
- **Concepts:** `8.4(C)` Lexington and Concord; `8.10(A)` locating places and regions
- **Scenario shape:** Handbill Run at its limit
- **Signature verb:** route mastery under a closing clock
- **Target:** approximately 3:55
- **Beyond-base requirement:** a way to cross a horizontal gap with no adjacent support or lower base route
- **Recurring requirement:** recovery from non-lethal body contact

**Continuous-route treatment:** Charlestown edge, road forks, walls, ditch, farmyard, houses, and Lexington Green form one forward-driving country corridor. Town names mark route decisions inside it, not teleport destinations.

There are no handbills and no quota: one message moves through houses, bells, and roads. The shape is reduced to its core—route under a clock. No horse is playable; mounted travel would be a fourth locomotion system.

**Hook, 0:00–0:15.** Two lanterns in a steeple and a boat under the guns. The horse is handed off immediately because the road is picketed.

**Phase 1, 0:15–1:10.** Clear Charlestown and the Neck patrols. The first valley check chooses water, Neck road, or marsh based on the regulars' actual route.

**Phase 2, 1:10–3:00.** Traverse the country corridor, waking houses and a bell ahead of the column. Unsupported-gap traversal, introduced optionally in M11, is now required at the washed-out ditch where there is no lower path. Valley checks choose the next town in the alarm network and identify the Concord stores/arrest purpose.

**Boss, 3:00–3:55.** Reach Lexington Green at first light. Contact recovery recurs while moving through the militia line; it preserves motion without turning the scene into a fight. After the traversal peak, the captain asks what the militia is lawfully doing. The volley is authored and non-interactive. The final prompt asks why both sides disputed who fired first.

**Reuse:** country-route state hooks, rowboat, town gate, townsman militia treatments, redcoat rig, and dawn palette. New work is the chapter's largest asset line: stone and split-rail walls, milestone, farmhouse, barn, meetinghouse facade, rural trees, militia staging, and the complete Lexington/Concord corridor.

If this corridor is cut, `8.10(A)` loses its only natural carrier and the unsupported-gap affordance loses its first required mission.

---

## 17. M14 — The Lines

- **Date:** April–July 1775
- **Concepts:** `8.4(C)` Lexington and Concord and their result; `8.22(A)` leadership
- **Scenario shape:** Steal the Stamp Shipment
- **Signature verb:** the coordinated job from inside a closed town
- **Target:** approximately 3:40
- **Beyond-base requirements:** isolated-height access and carried-evidence concealment recur

**Continuous-route treatment:** occupied roofs, count positions, ferry ways, boat crossing, wharf pile, and return checkpoint form one out-and-back infiltration floor. Crew cues and the water crossing change movement pressure without fragmenting the route.

Boston is besieged and the runner is inside it. The job is to carry the town's count—regulars, batteries, working wharves—to Cambridge and return with a written order.

**Hook, 0:00–0:15.** Survivors of the North Bridge and road fight enter over the Neck. The immediate objective is a roof count.

**Phase 1, 0:15–1:10.** Traverse occupied roofs and count positions. Isolated-height access recurs at an upper warehouse opening with no adjacent stack. The valley check chooses what the count must include and frames Washington's information problem.

**Phase 2, 1:10–2:55.** Execute crew cues: boatman, bell, boom chain, mooring. Concealment is required for the written count and return order. Valley checks choose the result of 19 April that leads the report and the restrained order to carry back. The bell diversion is authored crew choreography, not a newly required player affordance.

**Boss, 2:55–3:40.** Row under battery lanterns, climb the wharf pile, and pass the guard by matching the Crown account he already believes. The final open prompt traces the chain from a 1765 paper tax to a 1775 siege.

**Reuse:** occupied Boston dressing, roof network, rowboat, wharf piles, ships, officer, redcoat, and corridor edge. New work includes George Washington representation, siege dressing, and North Bridge staging.

M14 deliberately recombines previously required affordances rather than introducing a final new one. The finale tests fluency with the chapter's accumulated movement vocabulary, and its duel holds the same authored question bar as every other mission.

---

## 18. Functional affordance schedule

These are functional requirements, not ability names and not control schemes. The eventual ability design must be derived from the union of these needs.

No mission in early Act 1 requires an ability. M1–M4 are fully completable with base run, vault, climb, drop, precision interaction, and dialogue.

Every eventual ability must modify one of the three existing primitives or the state carried through it. None may become a standalone fourth minigame or locomotion family.

Because no XP curve exists, the constraints below are ordinal. “M1–M6 floor,” for example, means the cumulative guaranteed XP from clearing M1 through M6 with zero training. It does not imply a numeric threshold.

### 18.1 Pull attention to a chosen spot

- **Functional need:** cause one watcher or crowd leader to look toward a harmless authored location long enough for a person or object to cross elsewhere.
- **Introduced:** M5, optional and low stakes. Ignoring it leaves a slower base route.
- **Rehearsed:** M6, optional near the wharf.
- **First required:** M7, to move the witness through the guarded crossing.
- **Recurrence:** authored crew diversions later use similar world reactions, but M14's bell remains choreography rather than a player requirement.
- **XP constraint:** the unlock must be available no later than the guaranteed M1–M6 mission-only XP floor for entry to M7. To guarantee the M5 introduction, the final curve should place it at or below the M1–M4 floor.

### 18.2 Reach an isolated upper opening

- **Functional need:** reach a second-storey opening when no adjacent stack, ladder, or base climb line exists.
- **Introduced:** M6, optional service-window shortcut with stairs as fallback.
- **Rehearsed:** M7, optional shutter route.
- **First required:** M8, where the gate-walk service opening is the only live path.
- **Recurrence:** M14's occupied warehouse opening; potentially M13 rural structures if the corridor layout supports it.
- **XP constraint:** threshold at or below the guaranteed M1–M7 mission-only floor for M8. To guarantee the M6 introduction, target at or below the M1–M5 floor.

### 18.3 Keep carried evidence unreadable

- **Functional need:** move a document or marked object while preventing observers from reading its incriminating face.
- **Introduced:** M8, optional packet crossing with a longer unconcealed fallback.
- **First required:** M9, for ship's papers on the watched apron.
- **Recurrence:** M11 relief papers, M12 manuscript/letters, and M14 military count/order.
- **XP constraint:** threshold at or below the guaranteed M1–M8 mission-only floor for M9. To guarantee the M8 introduction, that same M1–M7 entry floor should be the tuning target.

### 18.4 Recover movement after body contact

- **Functional need:** recover from a non-lethal grab, shoulder check, or crowd collision without ending the run or introducing combat.
- **Introduced:** M9, low-stakes gangway bump with a safe-deck fallback.
- **First required:** M10, where public crowd density makes incidental contact unavoidable.
- **Recurrence:** M13 militia-line passage.
- **XP constraint:** threshold at or below the guaranteed M1–M9 mission-only floor for M10. To guarantee the M9 introduction, target at or below the M1–M8 floor.

### 18.5 Cross an unsupported horizontal gap

- **Functional need:** cross a horizontal break that has no adjacent support, no lower path, and no legal solution using ordinary run/vault/climb/drop.
- **Introduced:** M11, optional marsh-detour source lane.
- **First required:** M13, at the washed-out country-road ditch.
- **Recurrence:** M14 may reuse it on the wharf/roof route. Its mechanical input is authored once and is identical on every attempt.
- **XP constraint:** threshold at or below the guaranteed M1–M12 mission-only XP floor for M13. To guarantee the M11 introduction, target at or below the M1–M10 floor.

### 18.6 Curve validation rule

When an XP curve is authored, validate it mechanically:

1. calculate cumulative mission-clear XP with zero training;
2. calculate the minimum Level reached before every mission;
3. list every ability required by that mission;
4. assert every required unlock threshold is at or below that minimum;
5. separately assert each introduction mission occurs after the unlock's zero-training threshold; and
6. treat training XP only as earlier access, never as part of the proof.

Any failure of those assertions is a progression deadlock, not difficulty.

---

## 19. Slate-wide variation contract

Every mission must provide authored pools for:

- knowledge prompt variants;
- answer-order variants;
- precision patterns drawn from one authored set per beat;
- patrol/obstacle arrangements where the scenario uses detection;
- non-semantic ambient lines; and
- bounded camera/choreography variants.

Fixed across variants:

- historical event order;
- required concepts;
- correct historical propositions;
- number and phase placement of knowledge checks;
- three same-difficulty attempts and their XP decay schedule;
- XP payout for a given attempt;
- legal route existence; and
- terminal outcomes.

Seeded variation between runs is preserved and is the only variation there is. The seed may select a different member of an authored pattern family from one run to the next; it may not select an easier member, widen an input window, or select an easier question. There is one authored pattern set per beat and one input bar.

---

## 20. Build-order recommendation

1. **M1 — Nailed to the Post:** proves the mission container, three primitives, continuous traversal-gate orchestration, the six-round duel and its bullet economy, seeded knowledge pools, three same-difficulty attempts on the decaying XP schedule, result return, and separation of understanding evidence from later card-granting demonstration. The duel is the highest-value item in that list, because the same system serves PvP.
2. **M4 — Set It Before Morning:** proves the reusable press phase while early Act 1 still uses no abilities.
3. **M2 — Landed Weight:** proves carried-object traversal and hoist precision without ability dependencies.
4. **M3 — The Comptroller's Books:** only after its concept assignment is repaired and the crew-cue scheduler exists.

M1 is not ready to build merely because its concepts exist. The mission infrastructure, authored item depth, the entire duel system and its free-response bank, attempt-count and XP-decay accounting, XP/Level/ability curve, Codex lifecycle, and hub launch/return flow remain absent.
