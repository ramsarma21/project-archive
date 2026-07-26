# Authoring a concept's capstone pool

Read this before writing items for a new concept. It is the checklist this directory was built
against, and it exists because two of its rules are things an author gets wrong by reading the code
correctly.

---

## The two that catch people

### 1. A concept needs THREE open-response items, not one

`packages/assessment` exports `OPEN_RESPONSE_PER_FORM = 1`. An author who reads that writes one prose
item per concept and moves on. **That is wrong, and it fails silently on the third attempt.**

The constant is a floor per *form*, and the reserve is sized for three *forms*:

```
OPEN_RESPONSE_PER_FORM  ×  FRESH_FORM_TARGET  =  1 × 3  =  3 prose items per concept
```

Selection draws the prose quota **fresh-first**. Attempt 1 spends one, attempt 2 needs one the
student has not seen, attempt 3 needs another. A concept with two prose items reaches its third
attempt with none left and recycles one to hold the quota; a concept with one recycles from attempt
two onward. Neither blocks anything, which is exactly the problem — the form still reports
`guessResistant: true` and the failure shows up only as a `PARTIAL_RECYCLE` nobody was looking for.

`verify.mjs` fails on a concept with fewer than three, with the arithmetic in the message, so this
cannot be got wrong twice in this directory.

> **Suggested wording for `packages/assessment/src/blueprint.ts`, beside the constant.** This
> directory cannot edit that file; the sentence is written out so it can be pasted.
>
> ```
> * ONE PER FORM IS THREE PER CONCEPT. The quota is drawn fresh-first across
> * FRESH_FORM_TARGET attempts, so a concept needs OPEN_RESPONSE_PER_FORM ×
> * FRESH_FORM_TARGET prose items in its reserve — three, today. A concept
> * authored with one satisfies this constant on the first form and recycles
> * a prose item on every form after it.
> ```

**One caveat the floor does not fix.** Phase 2 of `selectForm` fills the rest of the form from the
whole reserve and can draw a *second* prose item, spending what the next form's quota needs. No
composition an author can choose prevents it. A one-line change would: once the quota is met, rank
selected-response ahead of open-response in Phase 2. It costs no determinism, being another stable
partition of an already-shuffled order, exactly like the probe preference above it.

### 2. Use each of the six probes exactly once

`ITEM_PROBES` names six stances and the reserve is six items. One item per probe is not a style
preference — it is what makes `probesDistinct` true for **every** pair the shuffle can draw rather
than true on average, and `probesDistinct` is the engine's way of saying that the two items on a form
are not one question asked twice.

| Probe | What it asks for | Format used here |
|---|---|---|
| `RECALL` | The proposition, stated directly | selected response |
| `BOUNDARY` | A case just inside or outside the concept's edge | selected response |
| `ORDERING` | Which came first, or which caused which | selected response |
| `CORRECTION` | A wrong statement to repair | open response |
| `DISCRIMINATION` | Rules out the plausible-but-wrong reading | open response |
| `APPLICATION` | The proposition in a situation the module never showed | open response |

The format column is this directory's choice, not a rule: the recognition-shaped stances took the
selected-response slots and the reasoning-shaped ones took the prose slots, which happens to give
every form one of each and satisfies the prose floor exactly. A released item's probe is whatever
that item actually is — `STAAR.2019MAY.G8SS.24` is a `DISCRIMINATION` item in selected-response form,
and the authored `RECALL` item took its place among the three.

---

## The rest of the checklist

- **Six items per concept.** `RESERVE_TARGET_PER_CONCEPT`. Fewer than two is `UNASSESSABLE` — the
  gate skips the concept and **no Codex card mints**. Two to five is `THIN` and a retry recycles.
- **At least one released TEA item, if one exists.** `NO_RELEASED_TEA_ITEM` is a real finding a
  district will read. Map it by reference through `released-item-map.json`; do not copy TEA text or
  keys into this repository, and read `content/staar` §4 on licensing before assuming you may.
- **Two items must be different questions, not one reworded.** The probes enforce the stance;
  `verify.mjs` also runs a lexical-overlap check between every pair of stems in a concept and fails
  above 60%. A retry that draws a paraphrase measures memory, and the 100% rule stops meaning
  anything.
- **Era inside the chapter window.** Boston is 1765–1775. An item whose era names only years outside
  it is refused however well its concept fits. An untagged era passes.
- **No key in an item file.** Keys go in `answer-key.json` and nowhere else. `verify.mjs` fails on a
  key-shaped field in an item file, because `packages/assessment` cannot grade by design and the
  cheapest way to break that is an author adding a helpful field.
- **Balance the key letters.** The first draft here keyed six of seven items to A, because an author
  writes the correct option first. `verify.mjs` fails if any letter takes more than half.
- **One defensible answer per selected-response item.** No best-answer items. A 100%-per-concept gate
  has no room for an item a careful student can lose on judgement.
- **Rubrics carry `requiredCore`, `line`, three accept examples, three reject examples, and a
  `falseNegativeRisk`.** The line is the author's job: the verdict is binary and the system will not
  guess where correct stops.
- **Three labelled eval answers per prose item, none of them copied from the rubric.** A grader that
  passes by reproducing its own answer key has been tested on nothing.

---

## If the items will also feed PvP, six per concept is not the number

Six is the capstone's reserve target and it is sized for three attempts. **PvP is unbounded and needs
an order of magnitude more.**

A duel runs until one side's health reaches zero, so the round count is open, and the hard anti-hang
ceiling is twenty-four rounds — twenty-four questions in one match. Items are spent per *pair* rather
than per player, because PvP asks both sides the same item and computes freshness on the union of
their ledgers; anything else hands the veteran items they have seen and the newcomer fresh ones, and
the ammunition difference reads as knowledge when it is tenure.

For a pool of *n*, if two players have each been served *k* items, the count fresh to both is
`n × (1 − k/n)²`. At M1's thirty-four that is about thirteen after two matches each, six after three,
two after four.

**Plan on sixty to a hundred items per concept set for PvP.** M1 reaches its total only by composing
eighteen PvE duel items with seven PvP-only ones and borrowing these nine capstone prose items, under
the guard below. That makes one maximal match safe and an evening survivable; it does not make PvP
work.

It partly dissolves on its own. The shortage exists because PvP is seeded with one mission's concepts,
and fourteen missions' worth is a pool that does not run out — which is a reason to prefer breadth
over depth once a mission's design is settled. A fourth item on every concept is worth more to PvP
than a seventh on three of them.

**The guard, if you share capstone items into a duel pool.**
`PVP.GUARD.CAPSTONE_ALREADY_MASTERED.v1`: *PvP may draw a capstone item only for a concept this
profile has already mastered.* It reads `ConceptMastery.masteredAt` and nothing else. Without it a
duel can serve a gate item before the gate is sat, and the capstone's first-attempt score — the number
a teacher is told — ends up measuring recall of a duel. Mastery rather than merely having sat the
concept, because the shrinking retry draws fresh items for concepts still unmastered, so a concept a
student failed still has a reserve to protect. The full statement is in
`content/m1/duel-items.json` → `pvpPool.capstoneSharingGuard`.

## Standing facts about the released corpus

Recorded so nobody re-runs the search. Sourced from `content/staar`, which indexes all 296 Grade 8
Social Studies items TEA has published across seven administrations.

**TEA has never published an item asking what the Stamp Act taxed.** This is a permanent property of
the corpus, not a gap awaiting a better search. Of six released 8.4(A) items, none asks about the
Act's scope over printed and legal paper — which is Mission 1's actual concept. The only published
statement of the proposition anywhere in TEA's material is a rubric bullet in the 2023
constructed-response scoring guide: *"All colonists had to pay taxes on documents and paper."*
`BOS.CONCEPT.STAMP_SCOPE.v1` therefore carries `NO_RELEASED_TEA_ITEM` permanently, all six of its
items are authored, and each cites that bullet as the published source of what it tests. Searched:
all four pre-redesign released forms, the 2023 sampler, all three redesign-era answer-key appendices,
and every constructed-response scoring guide.

**The only released constructed response on 8.4(A) cannot be served by a per-concept gate.**
`STAAR.2023.G8SS.07` has an official TEA rubric and twelve scored student exemplars, and its prompt
is *"Select TWO of the following issues"* over four. The **student** chooses which concepts to write
about, so there is no honest `conceptId` and tagging it to one would deny a card to a student who
answered it well. Use it as a template — every prose item here carries
`modelledOnItemId: "STAAR.2023.G8SS.07"` — and calibrate binary lines against its twelve exemplars in
`content/staar/eval`. Do not serve it.

**Twelve of Boston's twenty-three standards need in-house authoring as the only way to cover what the
chapter teaches**, including 8.4(B), 8.4(C) on Lexington and Concord, 8.10(A), 8.11(A) on the port,
8.15(E), 8.19(C), 8.21(A), 8.21(B), 8.22(A), 8.23(B) and 8.23(E). `content/staar/boston-coverage.json`
is the machine-readable list. Expect `NO_RELEASED_TEA_ITEM` on most later concepts and do not treat
it as a sourcing failure.

**Of 53 items captured with full provenance, two are servable for M1.** The rest fail on concept
scope, on the era window, or on an image TEA never published as text. A capture of fifty-three is not
a bank of fifty-three.
