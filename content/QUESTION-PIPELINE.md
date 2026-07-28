# The question pipeline — architecture, the gauntlet, and what generation costs

**Status: the gauntlet is built and proven; generation is deliberately not built in this
pass.** Precedent: `content/m1/BANK-EXHAUSTION-PROPOSAL.md` — a written design the owner can
argue with before code commits to it. This document records the owner's chosen architecture,
the one recommendation he asked me to make (how the runtime prose check stays generous), what
the verification gauntlet checks and what it catches, and the volume the design makes
achievable.

The code is `packages/grading/src/pipeline/` (`pnpm --filter @pa/grading grading:pipeline`),
proven by `packages/grading/src/__tests__/pipeline.test.ts` and `pipelineCoverage.test.ts`.

---

## 1. Why a pipeline at all

Missions get replayed and PvP gets ground, and a player must not see a repeat. The bank is
**34 items against a 24-round ceiling, holding by one item** (`BANK-EXHAUSTION-PROPOSAL.md`).
Hand-authoring a bigger bank at this quality bar is a multi-day job per few dozen items, and
`M1-STATUS.md` records that the real bottleneck was never question *text* — it is the
**rubric/label authoring and the by-hand verification** that makes an item trustworthy. The
discriminator test that found the one card pair separating "only by luck" was run **by hand**.
So the pipeline's job is not to write prose faster. It is to **mechanise the verification**,
because that is the expensive, error-prone half, and it is what makes volume safe rather than
merely fast.

**The failure to design around:** a generator that can produce a thousand items and verify
none is *worse* than the hand-authoring it replaces, because the failure is silent and at
scale — the same shape as "3.4% false negatives while reporting healthy." Hence: checks
before generation.

---

## 2. The architecture — the owner's, 28 Jul

> "offline generation with defined card + prose answers and just having to check
> deterministically if cards are right and do a short prose comparison on runtime is the best i
> think"

- **Offline**: generate the question, its **1–2 bound Codex cards**, and a **reference prose
  answer**. Everything verified before it ships.
- **Runtime, card half**: check the played evidence hand against the bound cards.
  **Deterministic, exact, no model.** (This largely exists — the PvP authority already grades
  the placed hand against the item's relevant set.)
- **Runtime, prose half**: a **short comparison** against the reference, deliberately smaller
  than today's full-rubric judgement.

**Why offline, not play-time generation** (the trade-off, settled):

| Force | Play-time generation | Offline generation + verified bank |
|---|---|---|
| Determinism | A live model in the question path is non-reproducible; this repo hashes sim state to the last ulp for replay/PvP. **Disqualifying.** | The item is a fixed record; replay reproduces exactly. |
| Latency / failure | Adds a second network dependency and a mid-match failure mode on top of the 1.5 s grading cap. | No generation on the hot path at all. |
| Verification | The expensive checks (overlap, AI-tells) **cannot** run inside a duel, so a play-time item ships unverified — the silent-at-scale failure. | Every check runs once, offline, before ship. |
| Freshness | Only needed if the bank cannot supply it — and it can (see §6). | Achieved by **volume**, which offline generation delivers. |

Freshness is a **volume** problem, not a **timing** problem, so it does not force play-time
generation. That is the whole reason the conservative answer is also the correct one here.

---

## 3. The recommendation he asked for: how the prose half stays generous

**The risk, precisely.** Today's rubric generalises: `NAME_TWO` credits *"an almanac and a
marriage licence"* — wordings the module never named — because it asks whether the answer
falls inside the taxed category. A **single reference answer, compared literally, is a
false-negative machine**: it rejects the almanac answer because the string differs. False
negatives are gated at **0.00%** because telling a student who understood the concept that
they were wrong is the worst outcome a teaching game has, and it is the failure that sat
silently at 3.4% on stale labels.

**Recommendation: a two-tier comparison whose basis is the compact required core, not the
reference string.** The four candidates in the brief are not alternatives — each is good at a
different job, and the recommendation uses all four:

- **Tier 1 — deterministic fast-ACCEPT** (candidate #1, several reference phrasings +
  candidate #4, escalation). If the answer strongly matches one of the offline-generated
  accept phrasings, grant immediately: no model, replayable, zero latency. **This tier can
  only ever accept** — a miss escalates — so it is *structurally incapable of a false
  negative*. It exists to make the common case free and deterministic, which the hashed-replay
  world wants.
- **Tier 2 — model COMPARISON on escalation** (candidate #2, required elements + candidate #3,
  comparison framing). "Does this answer carry the required core, given this reference?" —
  reporting core-element presence, exactly as the shipped grader already does at FN 0.00%. A
  *comparison against a reference* is a genuinely easier task for a model than open rubric
  judgement, at the same token cost, so it is a reliability **gain**, not a regression, and it
  is where generosity lives: paraphrase, example, fragment all pass because the core is stated
  as **meaning**, not words.

So "compare against a reference" is honoured — but the comparison **basis is the reference's
required elements**, the thing that already generalises, not its wording. That is how the
prose half shrinks from a full rubric to a comparison **without** re-opening the
false-negative hole. Generating several reference phrasings offline (feeding Tier 1) and the
compact required core (feeding Tier 2) is the concrete offline output the generator must
produce alongside the question and the binding.

The in-lane parts of this are built and tested: `deterministicProseAccept` (Tier 1, proven to
accept a phrasing and to *escalate rather than reject* a differently-worded correct answer)
and the required-core representation the candidate carries. Tier 2 is the existing classifier
call, unchanged.

---

## 4. Grade the two halves independently — and what it buys

Because the card half is deterministic, the two halves are now known **independently**, which
today's single verdict cannot express. `combineHalves(cardHalf, proseHalf)` folds them:

| Cards | Prose | Wire verdict | Teaching signal |
|---|---|---|---|
| right | right | CORRECT | `MASTERED` |
| right | weak | WRONG | `EVIDENCE_RIGHT_REASONING_WEAK` |
| wrong | right | WRONG | `REASONING_RIGHT_EVIDENCE_WRONG` |
| wrong | wrong | WRONG | `MISSED` |

The **wire verdict stays binary** (the duel rejects a non-binary verdict by name), so the
signal rides the feedback channel, not the verdict. CORRECT requires **both** halves — the
mechanic's premise is that a right answer is evidence *plus* the reasoning that rests on it,
and crediting one without the other teaches the half the student was missing.

**This is the wrong-answer feedback the owner asked for, done right.** "Your evidence was
right, your reasoning missed" is a far more useful thing to tell a student than "wrong," and it
falls out of the architecture for free. The competitive-leak constraint from that brief still
governs *where* it is shown: in PvP both sides draw from a **shared** pool on the union of both
ledgers, so revealing *why* mid-match, or the reference answer, hands the opponent an edge on an
item they may also face. The safe channel is the **misconception class only** (`TOO_FEW`,
`EVIDENCE_RIGHT_REASONING_WEAK`, …) returned to the answering side — which is exactly what the
PvP wire's `AnswerAck.evidence` field already carries and `evidenceShortfallHint` already
renders. Extending it to carry the prose-half signal is a small change; the reference answer
and any accept phrasing are shown **after the match / in the Codex only**, never mid-fight.
(That wiring crosses into `packages/pvp` and `apps/api`, which this lane does not own, so it is
a handoff, not built here.)

---

## 5. The gauntlet — checks before generation

Every candidate clears these before it ships. Free deterministic checks run first; the one
model check runs only if they pass (a statically-broken item is not worth a model call).

| Check | Owner requirement | Catches | Cost |
|---|---|---|---|
| **binding** + concept agreement | "tied to 1–2 evidence cards" | 0 or >2 cards, unknown card, card on the wrong concept | free |
| **reasoning-not-recall** | "critical thinking, not trivia" | a date-stem question with a bare-year answer and no decision (the exact shape the owner had rewritten once) | free |
| **AI-tells (lexical)** | "no AI tells" | em/en dashes, curly quotes, markdown, the LLM lexicon (`delve`, `tapestry`, "plays a crucial role"…), assistant-turn artifacts | free |
| **AI-tells (style)** | "no AI tells" | a question >3σ off the authored corpus on sentence/overall length (WARN) | free |
| **label coverage** | gates must not cover a shrinking fraction | fewer than 3 accept or 3 reject held-out labels; a label in both lists | free |
| **overlap discriminator** | "no overlap, deterministically" | a non-bound card that *also* defensibly answers; a bound card that does *not* | **1 model call/item** |

**"No AI tells" — what is cheap and reliable vs noisy** (the brief asked for this ranking):

- **Banned-construction lexical check — cheap and reliable, and the primary gate.** The tells
  are a finite known set, and the ERROR list contains *only* constructions that never occur in
  a Boston constable's spoken question. **Proven not to over-reject**: the whole 25-item
  authored corpus passes the ERROR gate in the test suite (and building it *found* one
  over-broad rule — a bare `i cannot` flagged the authored line "what I cannot follow" — which
  is exactly what testing against the reference corpus is for).
- **Style-similarity vs the corpus — cheap but noisy.** A legitimately short or long question
  is an outlier without being machine-written, so it is a **WARN**, never a block.
- **Adversarial "does this read as machine-written?" model pass — expensive and least
  reliable** (a model is a poor detector of its own register). **Not built as a gate.**

**"No overlap" — the discriminator, and its cost.** For a new item, every non-bound card must
be provably not-a-defensible-answer. That is a judgement of meaning, so it needs a model: one
structured call per item, the whole card set in one prompt, a boolean per card. At M1's ~9
cards that is a few hundred tokens in and a handful out — **well under a cent and about a
second, paid once, offline**. It scales with *authored items*, not with *plays*, so it is
affordable at any volume a human would review. This is the check the hand process did pairwise
and the thing that makes generation safe rather than merely fast.

**Proven, in this pass** (`pipeline.test.ts`, and a live run):

- A well-formed candidate raises no ERROR.
- A **bare-recall** item (date stem + bare-year answer, no decision) → `RECALL_NOT_REASONING`.
- An **AI-tell-laden** question (em dash + `delve`) → `EM_EN_DASH` + `LLM_LEXICON`; curly
  quotes and markdown likewise.
- An **overlapping / mis-bound** item → `OVERLAP` / `BINDING_NOT_DEFENSIBLE`. Proven both with
  a fake model (deterministic) and **live against the gateway**: a stamp item bound to the
  paper-scope card but actually asking about the *date* was caught with both codes; the two
  ship-quality candidates cleared the live discriminator with no overlap — including the
  `LAWFUL_NOT_CONSENTED` item, whose card the earlier hand-check found separated from
  `CONSENT_GROUND` "only by luck."
- Binding to an unknown or wrong-concept card, and thin labels, are rejected.

---

## 6. Labels versus gate coverage — the anti-erosion answer

**A generated item has no hand-written labels, and the gates measure against labels.** The
honest options:

1. Generation produces **candidate labels** (accept/reject phrasings) that a human reviews
   before the item ships. Reviewed labels become eval cases automatically — the harness already
   turns every item's held-out `accept`/`reject` into cases, so the eval set grows *with* the
   bank. **This is the recommendation.**
2. Ship items whose only labels are model-written and never reviewed — a model grading a
   model's own labels. **Circular; rejected.**

The mechanical guard, so this cannot erode silently: **an item cannot pass the gauntlet
without the label floors** (≥3 accept, ≥3 reject), and a test asserts the eval set covers
**100% of the bank** — no item ships unmeasured (`pipelineCoverage.test.ts`). Bank size and
eval coverage now move together by construction. This directly answers "do not let the gates
come to cover a shrinking fraction."

A generated item still needs an **FN/FP measurement** before it ships, because a live model
decides its runtime grade. That measurement is the existing `grading:eval:gate` run over the
newly-grown label set; FN must stay 0.00% and the FP exception list ships empty. Generation
does not remove that step — it *feeds* it.

---

## 7. The volume it makes achievable

The freshness arithmetic is already worked out in `duel-items.json → whatALongMatchActuallyDoes`.
Under the **PvP symmetry rule** (both sides asked the same item; freshness on the union of both
ledgers), if two players have each seen *k* of *n* items, the expected count fresh to both is
`n·(1 − k/n)²`. At today's **n = 34** a fair fresh draw is effectively gone by the **fifth**
match between the same pair. A single maximal match consumes 24.

So the target for "different questions every time":

- **A few hundred items per chapter** — call it **200–400** on these three concepts — makes a
  fair fresh draw survive dozens of matches between the same pair, not five. At n = 300, two
  players are still >90% fresh after five matches each and cross into staleness only after
  ~15–20. That is the difference between "an evening survivable" and "grindable."
- **Cross-chapter draw**, once later missions exist, is the real long-run answer: fourteen
  chapters at a few hundred each is a pool that does not run out, and it dissolves the problem
  that PvP is seeded from one mission's concepts.

Neither number is reachable by hand at this quality bar, and neither needs play-time
generation. **The bank is now a first-class tuning constraint, and the gauntlet is what lets
it be filled safely.** This pass deliberately generates **two** items end-to-end, not two
hundred: the bank's problem is quality, and thirty unverified items is a liability, not an
asset.

---

## 8. What I would build first, if only one piece

**The gauntlet's overlap discriminator plus the label-coverage gate** — the checks, not the
generator. The owner is explicit and correct that checks come first: a generator without them
multiplies the ambiguity that made cards unanswerable, silently and at scale. The discriminator
is specifically the check that was done by hand and found the one lucky pair, and the coverage
gate is what stops the eval from quietly measuring an ever-smaller slice. With those two in
place, generation is a scaffold that produces a candidate and runs it through a gauntlet that
can reject it; without them, generation is a liability. Both are built and proven here.

---

## 9. Status and handoffs

- **Built and proven:** the full static gauntlet, the model discriminator (fake-tested and
  live-tested), the deterministic prose fast-accept, `combineHalves`, the anti-erosion
  coverage gate, two candidate items end-to-end, and the CLI.
- **Deliberately not built:** the generator itself (a scaffold prompting a model for question +
  binding + reference + labels, then running the gauntlet). It is safe to build now that the
  gauntlet exists; it is a follow-up, not this pass.
- **Handoff (out of lane):** wiring the two-half independent verdict and the prose-half feedback
  signal into the runtime lives in `packages/pvp` / `apps/api`. The in-lane pieces
  (`combineHalves`, the signal vocabulary, the client `evidenceShortfallHint`) are ready for it.
- **Honest limit:** the shared TrueFoundry key is budget-capped and intermittently returns 429
  on every model, so the live discriminator and the eval gate run only when budget is
  available — the same posture the nightly `grading-eval` workflow already documents. The
  discriminator is wired and unit-proven regardless, and reports `MODEL_UNAVAILABLE` (never a
  silent pass) when the model cannot be reached.
