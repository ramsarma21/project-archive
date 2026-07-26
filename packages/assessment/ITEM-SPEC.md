# Boston capstone item specification

For the content author. This is what `@pa/assessment` needs in order to stop
running in its degraded path, and every number in it is derived from the engine's
behaviour rather than chosen for tidiness.

You have written the eighteen M1 duel items and calibrated rubrics against
TEA-scored student responses. **This spec is largely a description of what you
already did in Mission-Slate §4.9, applied to thirty-two concepts instead of
three.** Where a rule below looks arbitrary, the M1 pools are the worked example.

---

## 1. The quantities

| | |
|---|---|
| Assessable concepts in Boston | **32** (registry MACRO concepts; the 14 micros are excluded and need nothing) |
| Items served per concept per form | **2** |
| Items on one form | **64** |
| Reserve per concept | **6** |
| **Total items to author** | **192** |
| Of which open response | **3 per concept — 96 total** |
| Of which selected response | **3 per concept — 96 total** |
| Released TEA items | **at least 1 per concept — 32 minimum**, counted toward the 96 selected-response |

Six per concept is three complete forms. That is the retry budget: a student gets
a first attempt and two shrinking retries before the engine has to start repeating
items, and a repeat is served but disclosed as weaker evidence.

Authoring order, if 192 has to be staged: **the first three items of every concept
before the fourth item of any concept.** One complete form across all 32 concepts
is worth more than a perfect reserve on ten of them, because a concept with fewer
than two eligible items is dropped from the form entirely and its Codex card can
never be minted.

The concept list is `blueprintReadiness()`'s output, not a document — run
`compileBlueprint` against `@pa/curriculum` and it will name all 32 with their
current item depth.

---

## 2. The mix, and why one prose item per form is not negotiable

**Every concept needs 3 open-response items, one for each form.**

This is arithmetic, not taste. Mastery is 100% of two items with no partial
credit. Two four-option multiple-choice items give a student who knows nothing a
**1 in 16** chance of mastering the concept outright — so across 32 concepts,
blind guessing falsely masters **two concepts on the first sitting**, and each one
mints a permanent PvP-legal Codex card.

It compounds, because the engine deliberately allows **unlimited retries** and
each draws fresh items. The rolls are independent:

| Attempts | Chance of falsely mastering a given concept by guessing |
|---|---|
| 1 | 6.3% |
| 3 | 17.6% |
| 10 | 47.6% |
| 20 | 72.5% |

On an all-multiple-choice capstone, guessing is a winning strategy given patience,
and the educational claim rests on this one form. One prose item per form closes
it, because prose cannot be guessed. The engine now enforces the quota in
selection: it draws the open-response item **first**, and refuses to spend two on
one form, so a thin prose reserve is not wasted.

A concept with fewer than three prose items still works — it is served and
reported as `guessable`, the same lenient-but-disclosed treatment an exhausted
reserve gets — but a concept below the quota is a concept whose mastery is partly
luck.

**The three selected-response items should include the released TEA item.** A
released item is a real multiple-choice question with a real published key, which
is exactly what the district-accountability claim needs, and it is the least
useful format to author from scratch.

---

## 3. Item form: the six probes

This is the part the fresh-item rule depends on, and it is the answer to "two
items for the same concept must be genuinely different questions rather than the
same question reworded."

The engine treats a concept's six items as interchangeable and draws fresh **ids**
on a retry. An id cannot detect that item 4 is item 1 with the nouns swapped. If
the reserve contains reworded twins, a retry measures whether the student
remembers their previous answer, not whether they learned anything — which
quietly destroys the entire point of the shrinking retry.

So each of a concept's six items takes a **different route to the same
proposition**. Tag each item with its `probe`:

| Probe | What it asks | M1 exemplar |
|---|---|---|
| `RECALL` | States the proposition directly. | `POSTWAR.WHY_NOW`, `REP.WHAT_RIGHT` |
| `BOUNDARY` | A case just inside or outside the concept's edge. | `STAMP.DEED_OR_CLOTH`, `STAMP.PRIVATE_LETTER` |
| `ORDERING` | Which came first, or which caused which. | `POSTWAR.WHICH_CAME_FIRST`, `POSTWAR.DEBT_TO_TAX` |
| `CORRECTION` | A wrong statement the student has to repair. | `STAMP.CORRECT_THE_APPRENTICE`, `POSTWAR.CAME_FROM_NOWHERE` |
| `DISCRIMINATION` | Rules out the plausible-but-wrong reading. | `REP.NOT_THE_MONEY`, `REP.BOSTON_DOES_ELECT` |
| `APPLICATION` | Applies it to a situation the module never showed. | `STAMP.WHY_A_PRINTER`, `REP.LAWFUL_BUT_UNJUST` |

**One item per probe per concept.** Six probes, six items, and the engine pairs
two different probes on every form — so all six are used exactly once across three
forms. `blueprintReadiness()` reports `DUPLICATE_PROBE` when two items share a
stance and `UNTAGGED_PROBE` when one is missing the tag.

The probe is about the *question's stance*, not its difficulty. All six are the
same bar: one difficulty for everyone, no easy mode.

**Which probes should be the prose ones?** `APPLICATION`, `CORRECTION` and
`DISCRIMINATION` are the natural three — each asks the student to produce a
reason rather than recognise one, and they are the three that read worst as
multiple choice because the distractors give the reasoning away. That leaves
`RECALL`, `BOUNDARY` and `ORDERING` as selected response, and `RECALL` or
`BOUNDARY` is usually where a released TEA item fits.

---

## 4. What each item needs

### Every item

- **Concept id**: canonical, from `@pa/curriculum` — `BOS.CONCEPT.STAMP_SCOPE.v1`.
  Legacy tags (`RCC.*`, `8.4(A):STAMP_ACT`, `BOS.MD01.CONCEPT.*`) retag through
  the alias table, so writing one is not an error, but the canonical id is
  preferred. A bare student expectation like `8.4(A)` is **refused** — it names six
  independent causes and is too coarse to keep a mastery record against.
- **Probe**: one of the six above.
- **Era**: `"1765"`, `"1764-1767"`. Boston's window is 1765–1775 and an item
  outside it is refused however well its concept fits.
- **Provenance**: per item, never a blanket claim. Either released TEA (see below)
  or authored, with where it was authored.

### A released TEA item

Every field is copied from a TEA document and none is inferred. The capture format
in `content/staar/` already has all of them; `fromReleasedItemCapture()` lifts a
capture straight into the bank. Required: administration, TEA's own form title,
the item number **as TEA published it**, the TEKS label as published, reporting
category, the URL the item text came from, and the **separate** URL the key came
from. An item whose key was decided by reading the options and picking the
best-looking one is not a released item.

Two things the adapter deliberately drops: `correctOptionId` and each option's
`rationale`. The answer key does not live in this package — see §5.

Image-dependent items are automatically unusable. If TEA did not publish the map
as text, the item cannot be served.

### An authored selected-response item

Four options. Distractors should be wrong for a *reason a student would hold*,
not obviously wrong — a 1-in-4 item where two options are absurd is a 1-in-2 item,
and the guessing arithmetic in §2 gets worse accordingly.

### An open-response item

Author it in `@pa/grading`'s rubric format, which is a near-transliteration of
what you already wrote in §4.9:

- `ask` — the question, verbatim.
- `correct` — the reference answer in your own prose.
- `ideas` — the load-bearing propositions, phrased as ideas rather than as words
  to match.
- `needs` — how many of them a correct answer must carry. **You draw this line;
  the system will not guess it.** `"all"` is the default.
- `sameThing` — wording clusters, so "the French and Indian War" and "the war with
  France" are not two different answers.
- `wrongIfSays` — classes of wrong answer, described.
- `accept` / `reject` — verbatim student-voice answers, held out of the prompt and
  used as the eval set.

The capstone reuses grading's bank wholesale. One difference from the duel worth
knowing: **there is no time pressure here**, so a capstone prompt can ask for a
sentence where a duel prompt asks for a phrase. Keep them separate items rather
than reusing the duel's eighteen verbatim — a student has already seen those.

---

## 5. Two things not to put in an item

**No answer key.** The item descriptor this package holds has no
`correctOptionId`, no `isCorrect` on an option, no rubric. That is structural, not
an oversight: it is what makes it impossible for this package to grade, and
impossible for a key to reach a client bundle. Keys live with the grading
authority. Author them; just author them on that side of the boundary.

**No difficulty field, no per-student scaling.** There is nothing in the blueprint
or the item to read one from.

---

## 6. How to check your work

```bash
pnpm --filter @pa/assessment test
```

`blueprintReadiness(blueprint, bank)` is the work list. Per concept it reports:

| Finding | Meaning |
|---|---|
| `NO_ITEMS_AT_ALL` | Nothing authored. |
| `INSUFFICIENT_FOR_ONE_FORM` | Fewer than 2 eligible — the concept is dropped from the form and mints no card. Fix first. |
| `RESERVE_BELOW_TARGET` | Fewer than 6 — a third attempt will repeat items. |
| `OPEN_RESPONSE_BELOW_FORM_QUOTA` | Fewer than 3 prose items — at least one form is guessable. |
| `NO_OPEN_RESPONSE_ITEM` | No prose at all; every form guessable. |
| `NO_RELEASED_TEA_ITEM` | No TEA item; the accountability claim is weaker for this concept. |
| `DUPLICATE_PROBE` | Two items share a stance — likely a reworded twin. |
| `UNTAGGED_PROBE` | An item has no probe, so distinctness cannot be checked. |
| `ALL_ITEMS_REFUSED` | Items exist but all failed eligibility (era, image-dependent, incomplete option pool). |

A concept is **done** when it reports `status: "READY"`,
`guessResistantFormsAvailable: 3`, `probesCovered.length: 6`, and no finding other
than — at worst — `NO_RELEASED_TEA_ITEM`.

---

## 7. Summary

Per concept, six items:

| # | Format | Probe | Notes |
|---|---|---|---|
| 1 | Selected response | `RECALL` | The released TEA item fits here or at 2 |
| 2 | Selected response | `BOUNDARY` | |
| 3 | Selected response | `ORDERING` | |
| 4 | Open response | `APPLICATION` | Rubric with `ideas` + `needs` |
| 5 | Open response | `CORRECTION` | |
| 6 | Open response | `DISCRIMINATION` | |

Times 32 concepts: **192 items, 96 of them prose, at least 32 of them released TEA.**
