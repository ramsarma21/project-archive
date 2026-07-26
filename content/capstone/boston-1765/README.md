# `content/capstone/boston-1765` — the chapter capstone item pool

The capstone is the chapter's one gate: all-or-nothing at 100% per concept, zero XP, no effect on
Rank, and the only thing that makes a Codex card PvP-legal. This directory holds its items.

**Scope tonight is Mission 1's three concepts and nothing else.** Missions 2 through 14 are deferred,
so the other twenty-nine Boston concepts stay unassessable by choice rather than by accident — the
gate is lenient for them, the report names them, and none of them declares a Codex card, so nothing
is lost by waiting.

```
AUTHORING.md                              read this before authoring another concept's pool
blueprint.json                            the plan, the spec conformance, and where I diverged
released-item-map.json                    which released TEA items are served, and which are not
items/selected-response.json              7 authored items, 4 options each, no key
items/open-response.json                  9 authored items with binary rubrics
answer-key.json                           the keys, deliberately in their own file
eval/open-response-answers.labeled.json   27 labelled answers, none copied from a rubric
verify.mjs                                every number below is this script's output
```

```
$ node content/capstone/boston-1765/verify.mjs
```

---

## 1. Coverage

Eighteen items. Every concept **READY**: six items each, three fresh forms, nothing recycles until a
fourth attempt.

| Concept | Items | Released | Authored | Open response | Fresh forms | Status | Findings |
|---|---:|---:|---:|---:|---:|---|---|
| `POSTWAR_REVENUE` | 6 | 1 | 5 | 3 | 3 | READY | — |
| `STAMP_SCOPE` | 6 | 0 | 6 | 3 | 3 | READY | `NO_RELEASED_TEA_ITEM` |
| `REPRESENTATION` | 6 | 1 | 5 | 3 | 3 | READY | — |
| **Pool** | **18** | **2** | **16** | **9** | | | |

That is the specific thing the engine reports as broken today, fixed for these three: a concept whose
pool is smaller than one form is `UNASSESSABLE`, the gate skips it and **no card mints**. All nine of
Boston's declared Codex cards hang off these three concepts, so this pool is the whole of what stands
between a student and a PvP-legal Codex.

## 2. Real versus authored, per concept

Two of eighteen items are real released TEA items. That is a low number and it is the true one.

**`POSTWAR_REVENUE` — one real item.** `STAAR.2018MAY.G8SS.05`, from the May 2018 released form:
three acts in a timeline, and the primary reason Parliament passed them. In window at 1764–1767 and
a clean fit for the concept.

> **One risk, and it should be looked at before tomorrow.** TEA's keyed option is *"To recover the
> cost of defending the colonies"* — the exact clause Mission-Slate §4.9 records the M1 module as
> deliberately not teaching, and the same clause the curriculum registry already flags against a
> retired owner item. I included it because the item **discriminates** on cost-recovery rather than
> on defence: its other three options are Britain *spending* rather than Britain *recouping*, so a
> student holding the module's proposition has exactly one option to reach for. The defence clause is
> in the wording of the answer, not in the work of choosing it. Three ways out, in the order I would
> take them: leave it and accept a small residual risk on a recognition item; add six words to the
> module's postwar card, which reopens a clause §4.9 closed; or drop it, which costs the concept its
> only released item.

**`REPRESENTATION` — one real item.** `STAAR.2019MAY.G8SS.24`, May 2019: a 1765 resolution on
taxation by persons the people chose, and why it was adopted. Dated inside the mission's own year and
the cleanest fit between a released item and an M1 concept in the whole capture. No reservations.

**`STAMP_SCOPE` — none, and none exists.** TEA has published no item asking what the Stamp Act taxed.
`content/staar` establishes this directly across all 296 published Grade 8 Social Studies items: of
six released 8.4(A) items none asks it, and the only published statement of the proposition anywhere
is a rubric bullet in the 2023 constructed-response scoring guide — *"All colonists had to pay taxes
on documents and paper."* All six items are authored, and each cites that bullet as the published
source of the proposition it tests. `NO_RELEASED_TEA_ITEM` will stand on this concept until TEA
publishes one.

### The best released item on this standard cannot be served

`STAAR.2023.G8SS.07` is the only released constructed response on 8.4(A), with an official TEA rubric
and twelve scored student exemplars. It is **not in the pool**, and the reason matters more than the
item does.

Its prompt is *"Select TWO of the following issues"* over four issues. **The student chooses which
concepts to write about.** There is no honest value for `conceptId`: a student who writes about the
Proclamation and the Stamp Act has produced no evidence about postwar revenue, and mastery here is
all-or-nothing per concept, so tagging it to one would deny a card to a student who answered it well.

A two-point item designed to *sample* a standard cannot be served by a gate designed to *certify* a
concept. It is doing more work as a template than it could have done as an item: every authored prose
item carries `modelledOnItemId: "STAAR.2023.G8SS.07"`, and its twelve scored exemplars are where the
binary line comes from.

Also excluded: the mercantilism multiselect (image TEA never published as text), and the two
Intolerable Acts items — both usable, both in window, both waiting for whoever authors M11.

**Of 53 items captured with full provenance, two are servable here.** The rest fail on concept scope,
on the 1765–1775 era window, or on an unpublished image. A capture of fifty-three is not a bank of
fifty-three, and the gap is the authored sixteen.

## 3. Authoring to the spec

The specification arrived while I was reading: `select.ts` now reads `item.probe` and
`blueprint.openResponsePerForm`. Authored to it.

| Spec | Met by |
|---|---|
| 2 items per concept per form | Two a form, three forms |
| Reserve 6, `FRESH_FORM_TARGET` 3 | Exactly six per concept; nothing recycles inside three attempts |
| `OPEN_RESPONSE_PER_FORM = 1` | Three prose items per concept — one per form |
| `probe` distinct within a form | Each concept uses each of the six stances exactly once |
| Provenance per item | Two mapped by reference, sixteen authored and saying so |
| No key in a descriptor | Keys only in `answer-key.json`; `verify.mjs` fails on a key-shaped field in an item file |
| Era inside 1765–1775 | Every item 1765 or 1763–1765, re-checked with the registry's own parse |

**The six probes are the anti-paraphrase mechanism, and they are better than the rule I was going to
write.** `ITEM_PROBES` names six stances and the reserve is six items, so one item per probe means
`probesDistinct` is true for *every* pair the shuffle can draw rather than true on average. Two items
on a form are then guaranteed to ask by different routes. `verify.mjs` also runs a lexical-overlap
check between every pair of stems in a concept and fails above 60%, which catches the case where two
different stances end up phrased the same way.

The pairing this produces is the one the shrinking retry needs. `STAMP.RECALL` asks which category is
taxed; `STAMP.BOUNDARY` asks which of four items is *not*, with three papers and one barrel of nails.
A student running "paper is taxed" passes the first and fails the second, and that is a real,
diagnosable state rather than noise.

### Four places I diverged, or would ask for something

**1. The open-response floor is three per concept, and nothing says so.** `OPEN_RESPONSE_PER_FORM = 1`
reads as one prose item per form. Composed with `FRESH_FORM_TARGET = 3` and a quota drawn fresh-first,
it is a floor of **three**: attempt 1 spends one, and attempts 2 and 3 each need one the student has
not seen. An author reading `= 1` will write one, and the concept will hit its third attempt with no
fresh prose. Worth a sentence beside the constant.

**2. Three still does not guarantee three fresh guess-resistant forms.** Phase 2 fills from the whole
reserve and can draw a second prose item, spending what the next form's quota needs. No composition
an author can choose fixes it. A one-line change would: once the quota is met, rank selected-response
ahead of open-response in Phase 2. It costs no determinism — it is another stable partition of an
already-shuffled order, exactly like the probe preference directly above it.

**3. Two prose items on one form is possible** and roughly a third of shuffles produce it. Not wrong,
but a hard sitting for a thirteen-year-old, and the same Phase 2 preference removes it.

**4. A released item is `SME_APPROVED` on arrival.** True of its content, not of its fit — see the
2018 item above. The status is about who wrote it; alignment is a separate judgement and this
directory is where it got made.

## 4. Rubrics at a higher stake

Same binary discipline as the duel bank, same calibration against the twelve TEA-scored responses in
`content/staar/eval`, and the whole of `BOS.MD01.GRADING_POLICY.v1` inherited rather than restated.
Three amendments, because the stakes moved.

**Why they moved.** A duel round is worth seven extra balls. This is worth the concept — and mastery is
all-or-nothing across the two items on a form, so a single false negative denies the concept, the
chapter unlock, and every card hanging off it. With two items a form, the chance of losing a concept
is roughly **twice** the per-item false-negative rate: a grader wrong one time in twenty on prose
loses about one concept in ten to a student who knew it.

1. **Wider accept lists**, and where a duel rubric and a capstone rubric disagree about the same
   wording, the capstone's reading wins here. The asymmetry that made the duel generous is larger
   here by the amount the stakes are larger.
2. **No grant-on-timeout exists on this surface** — `packages/assessment` has no `GRADING_TIMEOUT`
   source, because a timeout would hand out mastery and a permanent card for a response nobody
   graded. Nothing in these rubrics may lean on a generous fallback, which is another reason the
   accept lists carry the weight.
3. **Every item carries `falseNegativeRisk`.** On a HIGH item a WRONG verdict should reach the review
   log even when the classifier is confident, because it is the verdict a human review of attempt 1
   is most likely to overturn. Three items are HIGH: `POSTWAR.APPLICATION`, `STAMP.APPLICATION` and
   `REP.APPLICATION` — the counterfactual year, the two-sided classification, and the one that asks
   why the colonists *accepted* their own assembly's taxes.

What did **not** move: a restatement of the prompt, a bare choice on a two-way question the prompt
asked a reason for, generic affect, and naming without explaining are wrong here exactly as in the
duel. A capstone that credited "the British were unfair" would certify nothing.

**The one place I widened past the duel's own line.** `STAMP.APPLICATION` asks the student to decide
two cases and give the reason. Two correct decisions with no reason earns it. The outcome space is
four rather than two, so it is not a coin flip; two correct classifications are real evidence; and on
the surface where a false negative costs a chapter unlock, demanding prose on top of a correct
two-sided classification is the wrong risk to take.

## 5. Things fixed, and things left

**Fixed during the pass:** the first draft keyed six of seven authored items to option A, because an
author writes the correct option first. A student who notices that passes the selected-response half
of the pool without the history. Options were permuted, the key file rewritten with them, and
`verify.mjs` now fails if any letter takes more than half the keys.

**Left, and owned elsewhere:**

| | Owner |
|---|---|
| ~~The 2018 released item's defence-clause key.~~ **Settled: keep the item, teach the clause.** The module's postwar card gained "with an army still to pay for in America" and paid for it by tightening the sentence below — same 79 words, deck unchanged at 180.9 seconds. | done |
| Phase 2 preferring selected-response once the prose quota is met. | assessment |
| A sentence beside `OPEN_RESPONSE_PER_FORM` recording that the per-concept floor is three. Wording is written out ready to paste in `AUTHORING.md`. | assessment |
| The nine prose items here are shared into the PvP pool. The guard — PvP may draw a capstone item only for a concept already assessed — is satisfied by the unlock order today and should be a predicate rather than an accident. | duel / PvP |
| SME review. Everything authored here is `DRAFT`; the two released items are TEA's own. | curriculum SME |
| Hashes and a compiled artifact. | content compiler |
| The other twenty-nine Boston concepts, when their missions are built. | later passes |
