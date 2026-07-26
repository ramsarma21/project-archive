# @pa/assessment

The chapter capstone: the mandatory learning gate a student must pass to unlock
the next chapter.

Headless and pure — no React, no `three`, no rendering — so it runs under
`node --test`, in the browser, and inside the API route without change.

## Why this package is the important one

A mission gives three attempts and then advances the player regardless. That is
deliberate, and it is only defensible because this exists. Missions are
optional-outcome fun; the capstone is the mandatory learning spine. It is what
guarantees learning independent of whether a student is any good at the action
game, and it is what the educational claim rests on.

Everything below follows from that. If this gate is ever softened, the mission
design becomes indefensible along with it.

## The design

| | |
|---|---|
| Scope | **One capstone per chapter**, covering every assessable concept in it. Not one per mission — the claim is that the student holds the chapter, not that they held each piece on the day it was taught. |
| Size | **Two items per concept**, from a **six-item reserve**. Deliberately compact; a larger form was rejected. |
| Bar | **100% per concept.** No partial credit. Two items with no partial credit is a stricter bar than eight at 75%, and one a student can actually clear in a sitting. |
| Reward | **Zero XP, no Rank effect.** A purely content gate. XP comes only from mission clears. |
| Retry | Narrows to the unmastered concepts, draws **fresh** items, and the learning module must be retaken **every** time. Unlimited. |
| Measure | The **first attempt's** score is what a teacher is told. Retries repair mastery, not the reported number. |
| Difficulty | **One form shape for everyone.** No easy mode, no adaptive scaling — there is no `difficulty` field anywhere in this package to read. |
| Guessing | Every form carries **one open-response item**, because unlimited retries over pure multiple choice means guessing eventually wins. See below. |
| Replay | Fully event-sourced and exactly replayable. Unlike a mission, which commits only its outcome. |

Content authors: [`ITEM-SPEC.md`](ITEM-SPEC.md) is the derived specification —
192 items for Boston, what mix, and what makes two items on one concept genuinely
different questions.

## The 100% rule, and what it mints

Mastery is all-or-nothing per concept: every item served for a concept in one
attempt must be correct. An unanswered item counts against the concept, so
skipping the two items on a shaky concept is never cheaper than attempting them.

100% is also the **only** thing that makes a Codex card PvP-legal. A card holds
two independent states, never one boolean:

- `learnedAt` — held in single-player, from the mission's module. A student can
  win a boss duel on a card they half-understand.
- `pvpLegalAt` — minted only by complete mastery of the card's concept here.

The strict version is right because PvP is where a card is leverage against
another student and the resulting standing is public. A card earned by getting
*most* of a concept right converts a partial understanding into a competitive
advantage that the opponent cannot see. Single-player failure costs a student
nothing but their own progress; this does not.

`cards.ts` promotes existing cards and never creates one. A card that was never
learned is refused rather than invented, because `learnedAt` is a claim about a
module the student actually ran.

## The shrinking retry, and the item-exhaustion answer

A retry scopes only the concepts not yet mastered and draws items the student has
never seen. Narrowing makes it a repair rather than a re-sit of demonstrated
material; freshness stops the second attempt from measuring recall of the first
attempt's answers.

The reserve is six per concept — three attempts at two items. A student on a
fourth attempt at one stubborn concept has exhausted it, and there are only three
possible responses:

1. **Refuse the retry.** Rejected. It converts a learning gate into a permanent
   wall. The whole design rests on the assessment being the route forward that is
   always open, and a student who cannot try again is a student the product has
   given up on — over a content shortage that is ours, not theirs. Hence
   `ASSESSMENT_ATTEMPTS_ARE_UNLIMITED`.
2. **Serve fewer items.** Rejected. It silently weakens the 100% rule exactly
   where it is being leaned on hardest. One item at 100% is a coin flip dressed
   as mastery.
3. **Repeat an item, and record that you did.** Chosen. The repeat is drawn
   **oldest-served first**, which puts the maximum distance between the two
   exposures, and it is disclosed at three levels: `ConceptFreshness` on the
   form (`FRESH` / `PARTIAL_RECYCLE` / `FULL_RECYCLE`),
   `masteredWithRecycledItems` on the mastery record, and
   `hadRecycledItems` on the teacher-facing attempt row.

Recycling cannot fix a concept whose entire eligible pool is smaller than one
form — two items, today, for nearly all of Boston. Such a concept is
**`UNASSESSABLE`**, and it gets the split answer:

- **The chapter gate is lenient.** It does not block. Failing a student over a
  content shortage of ours would be indefensible, and undetectable from their
  side since they would never see the question they were held to.
  `UnlockDecision.contentGaps` names every one, so a report says so rather than
  implying the chapter was covered.
- **Card minting is strict.** No card. The student advances; they do not acquire
  competitive standing on evidence nobody collected.

A chapter where *nothing* is assessable is `BLOCKED` with
`NO_ASSESSABLE_CONTENT`, before the student is sent through a module, rather than
being silently passed.

## Unlimited retries force one open-response item per form

These two decisions are coupled, and the coupling is arithmetic rather than
preference.

Mastery is 100% of two items with no partial credit. Two four-option
multiple-choice items give a student who knows nothing a **1 in 16** chance of
mastering the concept outright — so across Boston's 32 concepts, blind guessing
falsely masters **two concepts on the first sitting**, and each one mints a
permanent PvP-legal Codex card. Because retries are unlimited and each draws fresh
items, the rolls are independent: 17.6% per concept within three attempts, 47.6%
within ten, 72.5% within twenty. On an all-multiple-choice capstone, **guessing is
a winning strategy given patience.**

So `OPEN_RESPONSE_PER_FORM` is 1 and selection enforces it: the prose item is drawn
**first**, and phase two refuses to spend a second one, because the reserve holds
exactly three and each is a later form's guess-resistance. A concept short of prose
is still served and reported as `guessable` — the same lenient-but-disclosed
treatment an exhausted reserve gets.

The same reasoning is why item **form** is tracked. Selection treats a concept's
reserve as interchangeable and draws fresh *ids* on a retry, and an id cannot
detect that item 4 is item 1 with the nouns swapped. Each item carries an
`ItemProbe` — `RECALL`, `BOUNDARY`, `ORDERING`, `CORRECTION`, `DISCRIMINATION`,
`APPLICATION`, the six stances the M1 duel pools already use — and a form pairs two
different ones, so all six are used exactly once across three forms.

## How the first-attempt score stays separate from repaired mastery

Not by a field written once and defended against later writes. The reported
measure is a **projection over attempt ordinal 1 only** — `firstAttempt` reads
exclusively the events of the attempt whose ordinal is 1, and `reportedScore`
reads exclusively that attempt's summary. A retry carries ordinal 2 or higher, so
it cannot contribute: not because it is forbidden, but because the projection
never looks at it. Meanwhile `mastered` is sticky across attempts, because that is
what gates the chapter.

Both numbers exist at once and mean different things:

```
reportedScore  18/40   what the student held when they first sat it
masteryNow     20/20   what they can demonstrate after repairing it
```

A teacher needs the *gap* between them more than either number alone — it is the
gap that says whether the missions taught the chapter. `ConceptReportRow.status`
carries the distinction down to the concept: `MASTERED_FIRST_ATTEMPT` versus
`MASTERED_AFTER_RETRY`.

Two exceptions, both deliberate:

- **A human review of attempt 1 does move the reported score.** The first-attempt
  score is protected from retries repairing it, not from a mis-grade being fixed;
  the grading eval set is explicitly stocked with correct-but-unusually-worded
  answers, so some verdicts will be wrong. `reportedScore` carries both the
  revised number and `asSubmitted*`, plus `revisedByReview`, so the change is
  visible rather than silent. A correction is an append, never an edit — both
  verdicts stay in the log.
- **An abandoned first attempt does not promote the second into the reported
  slot.** The ordinal is the definition. Otherwise the reported measure becomes
  something a student can shop for by walking out of a bad form.

**Keyed by chapter, not by profile.** The mastery reporting this replaces was
keyed by profile alone, so a second chapter's assessment overwrote the first
chapter's record and a year of evidence became whatever happened most recently.
Every projection carries `chapterId`, `reportKey` composes profile **and**
chapter, and `teacherReportSet` throws on a duplicate key rather than taking the
last write.

## The integrity rules, which are structural rather than checked

**This package cannot grade.** `AssessmentItemDescriptor` has no
`correctOptionId`, no `isCorrect` on an option, and no rubric. Not an omission —
there is no key anywhere in these types, so there is no code path here that could
decide correctness and no bundle built from this package can leak one. Selected
response and open response therefore take the same route: the authority answers
both, from a key table and from a classifier respectively.

**Nothing accepts a verdict.** `recordResponse` takes a `GradingAuthority` and a
submission. There is no parameter, optional or otherwise, through which a caller
could supply correctness.

**The log holds no score, no mastery flag and no pass flag.** The six event types
can only say what was served, what was answered, how the authority graded it, and
when it ended. Score, per-concept mastery, the 100% rule, card minting and the
chapter unlock are all derived by `reduce.ts`. There is no field a forged or
replayed log could use to assert mastery — a tamperer would have to forge
verdicts, and a verdict has an authority behind it and no client constructor.

**A capstone timeout never grants credit.** The duel grants the maximum on a slow
classifier, because a player must not be punished for infrastructure inside a
20-second round. There is deliberately no `GRADING_TIMEOUT` source here: a
timeout would hand out mastery, a chapter unlock, and a PvP-legal card for a
response nobody graded. The attempt stays open instead, and `submitAttempt`
refuses with `UNGRADED_RESPONSES`.

**Raw prose never enters the log.** An open-response submission carries a
`responseRef` — an opaque handle on the encrypted server-side record — and there
is no field that could hold text. `logContainsNoRawText` lets a test assert that
against real gameplay rather than against the claim.

**Provenance is per item, never a blanket statement.** "Built on released STAAR
items" is something a district will act on, and it is false the moment one item in
the form was authored in-house. Provenance is a required discriminated union, a
`RELEASED_TEA` item cannot be constructed without the fields that make the claim
checkable — administration, TEA's own form title, the item number as published,
the URL the text came from and the **separate** URL the key came from — and
`formProvenanceRollup` counts it for the reported form so nobody summarises it by
hand.

## Dependencies, and the two interfaces that were assumed

Three workspace dependencies, each confined to a single file so that a change
upstream breaks exactly one file here.

| Dependency | Surface file | Status |
|---|---|---|
| `@pa/curriculum` | `curriculum.ts` | Landed. Consumed as-is. |
| `@pa/contracts` | `protocol.ts` | Landed. Both earlier reconciliation notes are now fixed upstream. |
| `@pa/engine-world` | `determinism.ts` | Landed. `fieldRandom` / `projectFieldSeed` from the headless `fieldSimulation` subpath. |
| `@pa/grading` | `gradingAdapter.ts` | Landed. Reconciled, with **one policy defect** — see below. |

### Curriculum: consumed, not reinvented

This package invents **no concept vocabulary**. The repository already holds at
least eight ways of writing the same curriculum, and a ninth invented on the
accountability surface would be the worst of the set: a mastery report keyed by a
private identifier is one nobody can reconcile against the state's standards.

`CurriculumConceptId` is the only concept key here, it is branded, and the two
places a foreign identifier can enter — authored blueprints and authored item
banks — go through `resolveConceptRef`, which retags through the registry's alias
table. A student expectation is refused as too coarse: `8.4(A)` names six
independent causes of the Revolution and a student can hold four of them.

The blueprint's concept list is **read** from the registry, never authored. A
hand-written list would drift the moment a concept was added, and the failure mode
is silent — a chapter that stops assessing a standard nobody noticed it dropped.

Nothing had to be assumed. The port is:

```ts
interface ConceptSource {
  assessableConcepts(chapterId: string): readonly AssessableConcept[];
  concept(conceptId: CurriculumConceptId): AssessableConcept | undefined;
}
// AssessableConcept = { conceptId, label, codexCardIds, tier }
```

All four fields come straight off `InstructionalConcept`. `registryConceptSource()`
is the real implementation; `staticConceptSource()` exists so a test can build a
four-concept fixture chapter and so a later chapter can register without this
package changing.

### Grading: reconciled, with one policy defect

`@pa/grading` exists and is a good duel grader. Authored rubrics with an explicit
`needs` line so the author draws the binary rather than the model guessing it, a
content-hash rubric version so a stale verdict is structurally unreachable, a
verdict cache keyed on the normalised answer, held-out eval examples that are
never prompted, and an HMAC receipt so a modified client cannot flip a verdict on
its way through. All of that is reused as-is.

`gradingAdapter.ts` is the translation, and the vocabularies map cleanly except in
one place:

| grading | assessment | why |
|---|---|---|
| `CLASSIFIER` | `CLASSIFIER` | same thing |
| `ABSTAINED` | `UNANSWERED` | same thing, different word; both wrong |
| `GRADING_TIMEOUT` | **refused** | the policy split below |
| `OPPONENT_AUTHORITY` | **refused** | PvP relay; meaningless on a capstone |

**The defect: the timeout policy is not selectable.** `GradingService.grade`
returns `finish("CORRECT", "GRADING_TIMEOUT", …)` on all five infrastructure
failure paths — `TIMEOUT`, `PROVIDER_ERROR`, `MALFORMED_OUTPUT`, `CIRCUIT_OPEN`,
`NOT_CONFIGURED` — and no parameter in `GradingServiceOptions` or `GradeRequest`
can ask for anything else. For a duel that is right: a player must not stand still
in a gunfight waiting on an API, and a student cannot cause an outage on demand.
On a capstone the identical behaviour hands out concept mastery, a chapter unlock
and a permanent PvP-legal card for a response nobody graded — and there is no
clock here to protect the student from, so the generosity buys nothing.

The adapter therefore **refuses a generous grant** rather than consuming one: a
verdict carrying a `fallbackReason` becomes `GRADER_UNAVAILABLE`, the engine
records the response with no verdict, and `submitAttempt` refuses with
`UNGRADED_RESPONSES` until the item is graded for real. Doing it on this side
makes the correct behaviour true today without waiting on another package, and it
stays correct afterwards. When grading grows a policy parameter, this file loses
one branch and nothing else.

**Low confidence: the same shape of question, answered the same way.** Grading now
implements the duel ruling — grant up to two per profile per session window, then
withhold and flag. That must not reach the capstone, for three independent
reasons: a rate limit bounds the *rate* of an exploit whose *effect* is permanent;
there is no clock, so the generosity buys nothing; and the counter is per-session
mutable state, so a verdict would depend on something the committed log cannot
reproduce. Grading already ships the seam — inject `NoGrantLowConfidenceLedger`
and the classifier's reading stands, flagged for a human. The goal the ruling
chases is met better here by `VERDICT_OVERRIDDEN`, where a person reads the answer.

**Two smaller mismatches, both grading's to fix:**

1. **No selected-response path.** `grade` takes `answer: string` and routes
   everything to the classifier. Most of a capstone form is multiple choice, and
   the key cannot live in this package, so `keyOnlyGradingAuthority` is still the
   stand-in for that half.
2. **`GradeRequest.roundIndex` is duel geometry**, and `parseGradeAnswerRequest`
   range-checks it to 0..5, so grading's own HTTP boundary would reject a
   64-item capstone form outright. `GradedVerdictSource` stops at that seam rather
   than smuggling an item ordinal through a field named for something else. The
   receipt binding has the same problem — `(profileId, attemptId, roundIndex)`
   wants to be `(profileId, attemptId, position)`.

**One requirement this places on the API route.** Deferring a grade only works if
the answer survives to be graded later, so `AnswerRetention.retain()` must run
*before* grading is called and its `responseRef` is what makes the retry possible.
A duel can treat retention as optional because a timeout resolves the round
immediately; an assessment cannot.

`@pa/grading` is imported only by `gradingReconciliation.test.ts`, which drives a
real `GradingService` through the adapter. `gradingAdapter.ts` mirrors the verdict
shape structurally instead, because grading is a server module — `node:crypto`,
`fetch`, `process.env` — and this package runs in a browser too. It is also, as of
writing, **not typechecking**: its barrel re-exports `M1_POOLS` from
`./items/m1.js`, which does not export it, so `pnpm -r typecheck` is red on that
one line. Reported, not worked around.

### `@pa/contracts`: both notes fixed upstream

`contractAlignment.test.ts` validates every projected row against the real zod
schemas, and it found two gaps that the contracts owner has since closed:

1. **`ChapterAssessmentResponse` modelled selected response only.** It now carries
   `itemFormat`, a nullable `selectedOptionId` and a nullable `responseRef`, and
   cross-validates them. The namespaced sentinels this package used in the interim
   are gone rather than kept for compatibility.
2. **`ChapterAssessmentAttempt.status` had no abandoned state.** It does now, so an
   abandoned attempt keeps its own status instead of projecting as submitted with a
   null score, and there is an `ASSESSMENT_ATTEMPT_ABANDONED` ledger kind.

Contracts also grew `reportedFirstAttemptMeasure`, which implements the same rule
this engine derives: an abandoned or still-open first attempt yields no reported
score and does not promote attempt 2 into the slot.

## Layout

```
src/protocol.ts       the single import surface onto @pa/contracts
src/curriculum.ts     the single import surface onto @pa/curriculum, plus ConceptSource
src/grading.ts        the grading port and the verdict wire boundary
src/gradingAdapter.ts the reconciliation with @pa/grading, and the policy split
src/determinism.ts    the seed derivation and the one shuffle (the only randomness)
src/items.ts        item descriptors, per-item provenance, the bank, the STAAR adapter
src/blueprint.ts    the chapter blueprint and the content readiness report
src/select.ts       form selection, the shrinking retry, the recycling policy
src/events.ts       the event vocabulary — every event is committed
src/reduce.ts       the pure fold: log in, record out, everything derived
src/session.ts      the three operations that append to the log
src/gate.ts         the chapter unlock gate and the module retake gate
src/cards.ts        PvP-legal card promotion
src/report.ts       the teacher-facing report
src/persistence.ts  projections onto the durable rows in @pa/contracts
```

## Running

```bash
pnpm --filter @pa/assessment test        # 142 tests
pnpm --filter @pa/assessment typecheck
```

Test coverage of the paths that are easy to get wrong:

| File | What it pins down |
|---|---|
| `mastery.test.ts` | The 100% rule, a student who masters some concepts and not others, and the card-minting boundary at exactly 100% |
| `retry.test.ts` | Scope narrowing, a retry that shrinks to a single concept, fresh items, the module gate per ordinal, abandonment |
| `exhaustion.test.ts` | Recycling and its labels, oldest-served-first, unassessable concepts, the lenient gate with strict card minting, readiness findings |
| `reporting.test.ts` | First-attempt score versus repaired mastery, chapter keying, provenance of the reported form, human review |
| `determinism.test.ts` | Replay equality, seed stability, the committed seed reproducing the exact form, no score in the log, no prose in the log |
| `integrity.test.ts` | No answer key can exist, the wire boundary's refusals, grading outage handling, no difficulty knob |
| `bostonRegistry.test.ts` | Composition with the real curriculum registry, legacy retagging, and the honest state of the bank today |
| `contractAlignment.test.ts` | Every projected row against the real zod schemas, and that no ledger row awards XP or Rank |
| `gradingReconciliation.test.ts` | A **real** `GradingService` driven through the adapter: every fallback path refused, real classifications accepted, and both low-confidence policies contrasted |
| `guessResistance.test.ts` | The open-response quota drawn first and never overspent, probe distinctness on every form, and the readiness findings that predict both |
