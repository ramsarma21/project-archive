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

1. **Lesson** — teaches all four. Its checks are also the **baseline measurement**: they must
   record per-concept correctness, which today they do not (only a count of acknowledged
   checks persists). Without this the demo cannot show improvement, so it is demo-critical,
   not a remediation nicety. Distractor pools already vary options between runs (`86d6e1d`).
2. **Mission** — depth where being in the place is the point. Both existing encounters are
   currently pointed at the two *least*-missed concepts and will be retargeted. The world is
   malleable; the concepts are not.
3. **Boss fight** — the main assessment surface. Card half deterministic, prose half graded,
   asked in the two-causes-with-reasons shape of concept 4.
4. **Capstone** — after the mission and fight, to close the loop and write mastery.

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
