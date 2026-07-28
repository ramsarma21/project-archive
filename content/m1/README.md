# `content/m1` — the teaching and assessment content for Mission 1

Mission 1 is *Nailed to the Post*: Boston, 14 August 1765, carry a printed answer to the public pump
and nail it beside the Crown's Stamp notice. Three minutes of parkour and stealth, then a two-minute
pistol duel with the constable, and **every knowledge check in the game happens in that duel.**

This directory is the content that makes M1 teachable and gradeable: the mandatory three-minute
module, the eighteen free-response duel items with binary rubrics, the nine Codex cards those items
draw on, and a labelled answer set to test the grader with. Everything here is data. No code in this
directory ships; `verify.mjs` is a checker, not a runtime.

```
module.json                        the six-card module, plus its reading-rate arithmetic
duel-items.json                    18 items, 3 pools, the grading policy, and the PvP pool
BANK-EXHAUSTION-PROPOSAL.md        what a duel should do when the questions run out — proposal only
codex-cards.json                   9 card definitions — the namespace, consumed not minted
concepts.json                      where every identifier came from
eval/duel-answers.labeled.json     75 labelled answers, none of them copied from a rubric
schema/*.json                      three JSON Schemas
verify.mjs                         every number below is this script's output
```

```
$ node content/m1/verify.mjs
```

---

## 1. How to consume it

**The module.** `module.json`'s `module` property is byte-for-byte a `LearningModuleDefinition` as
declared in `apps/web/src/module/moduleFormat.ts`. `JSON.parse(file).module` casts cleanly, and
`verify.mjs` fails on any key that type does not declare, so an extra field cannot drift in. The
authoring evidence — reading rates, the window re-cut, the deliberate exclusions — sits outside
`module` where the player never sees it. If a bare file is easier to load, deleting the envelope is a
one-line change.

The module player was built concurrently at `apps/web/src/module/**` and its `m1Module.ts` holds a
faithful transcription of Mission-Slate §4.7's summary table. **This deck supersedes it**, and the
handover is listed in `concepts.json` under `followUps`. Two differences matter: the stamp card now
names exemplars the duel needs, and the card windows are re-cut against measured reading time.

**The duel items.** `itemId` and `itemVersion` are the fields `CommittedVerdict` in
`packages/duel/src/verdict.ts` already carries. `rubricId`, `question` and `referenceAnswer` line up
with `packages/contracts/src/openResponse.ts`. Nothing in this directory carries a bullet count, in
any field, and `verify.mjs` fails if one appears — the reducer derives the count from the verdict
alone, from the constants in `@pa/duel`'s tuning (14 for correct, 7 for wrong, at the time of
writing).

**The grader's prompt** is `gradingPolicy` plus one item. That is the whole specification: the policy
holds everything general (what to ignore, what is never sufficient, the decision procedure), and the
item holds `requiredCore`, `line`, and the two example sets. Nothing else about the mission, the
module, or the chapter needs to be in the context window.

### There is a second M1 bank, and this one should replace it

`packages/grading` was built during this pass and it already holds eighteen M1 items — §4.9's draft
transliterated into its own `AuthoredItem` format, with the binary line expressed as a per-item
`needs` count over an `ideas` list. **That package owns the format, the classifier prompt, the cache,
the verdict projection and the review log, and nothing here touches it.** Its architecture is good and
its `needs` mechanism is a reasonable way to express a line.

What it holds is the draft: the questions are §4.9's one-liners, the reference answers are the draft's
short *Accept* clauses, and the held-out examples are the draft's *Also accept* items, two or three
per item. This bank re-authors all eighteen — questions in the constable's voice that set up their own
answers, full reference answers, a stated `line` per item saying where the boundary is and why, and 75
held-out labelled answers. Same item ids, same pools, same Codex cards, so **the port is a replacement
rather than a merge.** `duel-items.json`'s `portTo` block has the field-by-field mapping.

Three places the two banks differ on substance, all recorded there:

| Item | This bank | That bank | Status |
|---|---|---|---|
| `FROM_WHEN` | the question no longer asks for the date | month with no day is **wrong** | **Resolved by rewrite — see below.** The item was retired as date recall and now asks why the duty has not yet taken effect, so the month-versus-day question no longer arises. |
| `CORRECT_THE_APPRENTICE` | an incomplete enumeration that holds the boundary is correct | a bare "just newspapers" is wrong | Narrower than it looks; both fail a bare "just newspapers" |
| `NOT_THE_MONEY` | bare "something else" is wrong, and the question now demands the ground | a note records that `needs: 1` lets it pass and says the fix belongs in the question | Agreement — that note names the fix and this is the fix |

Reading that package also corrected this one. An earlier draft of the decision procedure here ended
"if you are still undecided, return CORRECT." `packages/grading/src/service.ts` points out that
granting generously on *low classifier confidence* is an exploit with a discoverable input — write
something deliberately confusing, collect the full grant, every round — in a way that granting on an
infrastructure
timeout is not, because a student cannot cause an outage on demand. That is right. The generosity
belongs in how the rubrics are worded, which is where it now lives, and step 7 grades the answer as
read and flags it for review.

---

## 2. The module, and the arithmetic

Six cards, 180 seconds, zero XP, mandatory before the first attempt and before both retries.

**The rate.** Hasbrouck and Tindal's 2017 oral reading fluency norms put the grade-8 spring 50th
percentile at 151 words correct per minute. Silent reading of unfamiliar informational prose on a
screen runs at or a little below oral fluency at this age, so **140 wpm is the planning rate**, with
120 and 160 bracketing it. The 1765 statute excerpt is counted at **70 wpm** — half rate — because a
24-word clause of eighteenth-century legal syntax is not a 24-word sentence of ours, and pretending
otherwise is how a three-minute module becomes a four-minute one.

| Card | Words | Source | Reads in | Window | Slack |
|---|---:|---:|---:|---:|---:|
| Identity | 28 | — | 12.0 s | 12 s | 0.0 |
| Postwar revenue | 79 | — | 33.9 s | 34 s | +0.1 |
| Stamp scope | 88 | — | 37.7 s | 38 s | +0.3 |
| Representation | 117 | — | 50.1 s | 50 s | −0.1 |
| How the three connect | 32 | 21 | 31.7 s | 31 s | −0.7 |
| Mission frame | 36 | — | 15.4 s | 15 s | −0.4 |
| **Deck** | **380** | **21** | **180.9 s** | **180 s** | **−0.9** |

`380 / 140 × 60 = 162.9 s` of modern prose, plus `21 / 70 × 60 = 18.0 s` of statute, is **180.9
seconds against a 180-second budget** — four tenths of one percent over. Across the reader band:

| Reader | Prose | Source | Whole deck |
|---|---:|---:|---:|
| Slower, 120 wpm | 190 s | 21 s | **211 s** — 3:31 |
| Planning, 140 wpm | 163 s | 18 s | **181 s** — 3:01 |
| Strong, 160 wpm | 143 s | 16 s | **158 s** — 2:38 |

A slower reader runs about thirty seconds over. That is correct rather than tolerated: the format
cannot express a minimum dwell and the player advances every card themselves, so three minutes is a
presentation target and the pacing rail reports against it without ever commanding. The number that
must not be wrong is the median, and the median is 3:01.

### The windows were re-cut

§4.7 sized its six windows before the cards had prose in them.

| | Identity | Postwar | Stamp | Representation | Synthesis | Frame |
|---|---:|---:|---:|---:|---:|---:|
| §4.7 | 15 | 35 | 40 | 40 | 30 | 20 |
| Authored | 12 | 34 | 38 | **50** | 31 | 15 |

The representation card needs fifty seconds and not forty. It carries three propositions, the consent
principle stated positively, and the reply to Parliament's speaks-for-everyone claim, and **six of the
eighteen duel items draw on it.** The ten seconds come from the two frame cards and the stamp card,
which came in under. The total is still exactly 180 and no window is now shorter than its card's
measured reading time.

### The deck

> **Identity** · *Boston, 14 August 1765. You run printed sheets through this town for Mercer's Press
> and nobody looks twice. Today one sheet matters. Read it before you carry it.*
>
> **Postwar revenue** · *Britain's war with France ended in 1763. Britain won it, and came out of it
> owing more money than it had ever owed before. Parliament looked across the Atlantic and decided the
> colonies should pay a share of that debt. That decision is why a tax is suddenly reaching into
> Boston. Keep the order straight, because the order is the whole argument. The debt came first. The
> tax is Parliament's answer to the debt, not the other way round.*
>
> **Stamp scope** · *The tax has a shape, and the shape is the thing to learn. From 1 November,
> printed paper and legal paper must carry a stamp that somebody has paid for. Inside it: newspapers,
> handbills, deeds, court papers, licences, even playing cards. Outside it: a bolt of cloth, a barrel
> of nails, a letter you wrote out by hand yourself. Ordinary goods are not the target. Which is why
> the shop you run for is where this lands hardest. A printer's entire trade is the one thing being
> taxed.*
>
> **Representation** · *Boston does elect people — its own town meeting, its own representatives in
> the Massachusetts assembly. Those men could tax this town tomorrow. Boston elects nobody in
> Parliament. Not one member. And Parliament is what laid this tax. The claim underneath your sheet is
> this: a tax may be laid only by a body the taxed people chose. So the complaint is not the price —
> the town would say the same if the stamp cost a farthing. The complaint is who laid it. London
> answers that Parliament speaks for every subject, voted for or not. Boston's reply is short: we
> chose none of you. A lawful vote by men we never picked is still not consent.*
>
> **How the three connect** · *Three facts, one chain: a war left a debt, the debt produced a policy
> of raising money in America, and the policy produced the stamp. Parliament wrote that much into the
> Act.*
>
> > …it is just and necessary, that provision be made for raising a further revenue… in America,
> > towards defraying the said expences…
> > — *The Stamp Act*, 22 March 1765 · 5 George III c. 12, §I
>
> **Mission frame** · *Nail your sheet beside the Crown's notice at the public pump, before the
> constable papers over the board. He will be standing there when you finish, and he will ask you what
> you think you know.*

### What makes it not a textbook

The brief is that the module does not have to be fun, because the mission is — but it has to be more
engaging than a textbook, and it is allowed to carry real load. Five decisions do that work.

**It is addressed to somebody with a job.** Second person throughout, and the reader is a runner
carrying a sheet, not a student receiving a unit. The first card gives them the job in eight words.

**Every abstraction is spent immediately on something physical.** The deed and the bolt of cloth. The
barrel of nails. The letter in a woman's own hand. Three pence against a farthing. A cooper's barrel
that needs no stamp beside a printer's sheet that does. A thirteen-year-old can hold a boundary they
can see the edges of; "printed and legal instruments" is a phrase to be forgotten by the time they
reach the pump.

**The load is deliberate and it is concentrated in three sentences.** *The debt came first.* *Ordinary
goods are not the target.* *A lawful vote by men we never picked is still not consent.* Those are the
three hard ideas in the chapter and the module points at them rather than smoothing them. Two of them
are stated as instructions to the reader — "keep the order straight," "the shape is the thing to
learn" — which is a study cue, not decoration.

**The last line is the stakes, and it is literally true.** The constable is standing at the board and
he will ask six questions. The module does not promise a quiz; it names the man who is about to give
one.

**The primary source is a payoff rather than an ornament.** A student who has just been told the debt
came first then reads Parliament calling it *just and necessary* to raise a revenue in America, in
Parliament's own words, and the two halves meet. That is a STAAR skill being exercised, and it costs
eighteen seconds.

### What was left out on purpose

The module is **1:1 with the duel**: it teaches every proposition the eighteen items ask for and
nothing else. Four cuts were tempting enough to record.

| Cut | Why |
|---|---|
| Andrew Oliver, his effigy, the Liberty Tree, the Loyal Nine | The hardest cut here. This module is dated the exact day of the Oliver effigy and the story is better than anything on these six cards. No duel item asks for it, all four are MICRO enrichment in the concept registry, and each costs eight to ten seconds. It belongs in the reactive world or the Codex. |
| Stamp duties payable in scarce hard coin | Real, and TEA's own 2023 rubric credits it. No item asks for it. |
| The cost of defending newly won territory | §4.9's own third verification note records that the retired multiple-choice K1 graded this while the module taught it nowhere. It stays out and no item rests on it. |
| The Proclamation of 1763 | A named clause of 8.4(A), and M1 does not own it. |

---

## 3. The eighteen items, and where the line is

Six rounds an attempt, two per concept, three attempts, no repeats. Eighteen items are consumed
exactly and no player ever sees one twice.

| Pool | Concept | Items |
|---|---|---|
| `BOS.MD01.POOL.DUEL_POSTWAR.v1` | `BOS.CONCEPT.POSTWAR_REVENUE.v1` | `WHY_NOW`, `WHAT_IT_LEFT`, `WHO_PAYS`, `WHICH_CAME_FIRST`, `CAME_FROM_NOWHERE`, `DEBT_TO_TAX` |
| `BOS.MD01.POOL.DUEL_STAMP_SCOPE.v1` | `BOS.CONCEPT.STAMP_SCOPE.v1` | `DEED_OR_CLOTH`, `FROM_WHEN`, `WHY_A_PRINTER`, `CORRECT_THE_APPRENTICE`, `NAME_TWO`, `PRIVATE_LETTER` |
| `BOS.MD01.POOL.DUEL_REPRESENTATION.v1` | `BOS.CONCEPT.REPRESENTATION.v1` | `WHAT_RIGHT`, `BOSTON_DOES_ELECT`, `NOT_THE_MONEY`, `FINISH_THE_CLAIM`, `SPEAKS_FOR_ALL`, `LAWFUL_BUT_UNJUST` |

Every question is in the constable's voice, because he is the one asking and because a question with a
person behind it reads as an argument rather than a worksheet. The duel is untimed at the question and
the surrounding three minutes are pure action, so these are allowed to be long, and several are.

### The line

The verdict is binary. Correct grants fourteen balls, wrong grants seven, and there is nothing
between them. Partial credit was deliberately removed, which pushes the entire judgement onto the
author: the rubric has to say where correct stops, in terms a classifier with no other context can
apply.

The economy moved from 3-and-1 to 14-and-7 after these rubrics were written, and it changes what a
grading error costs rather than how the line is drawn. The ratio fell from 3:1 to 2:1, so one verdict
no longer decides a round. But the round count is now open, so a rubric that is reliably too strict
on one phrasing punishes it every round of a twenty-round match instead of once in six. The
generosity below is calibrated for the systematic error, not the isolated one.

**The line, in one sentence: does the answer contain the substantive proposition in any words at all,
or does it contain only the question's own words, a label, or a feeling?**

That formulation is not invented. It is read off `content/staar/eval/scr-8.4A-2023-scored-student-responses.json`
— twelve real Texas eighth-grade responses to a real released STAAR constructed response on 8.4(A),
the exact standard all three M1 concepts sit under, each carrying a trained TEA scorer's mark and
written reason. Four rules come straight from it:

1. **Naming without explaining is wrong.** A response that correctly named two of the four issues and
   explained neither scored zero.
2. **Vague affect is wrong however well written.** TEA's best-spelled, longest, most fluent exemplar
   in the set scored zero; its whole content was that the British "was just using the people and
   wasn't being fair to them."
3. **The core in a student's own rough words is right.** *"stamp act put texes on paper and other
   stuff which made the poeple mad"* — eleven words, two misspellings, no capitals — earned credit,
   because "taxes on paper" is the substance.
4. **Incidental slips are not the disqualifier.** TEA credited a response that wrote *Proclamation of
   1863*, a hundred-year error, and gave full marks to one that blamed "The British Monarchy" for
   Parliament's Act.

On top of those, the policy in `duel-items.json` makes the asymmetry explicit and mechanical. Spelling,
grammar, capitalisation, length, register, fragments and arrow chains are ignored before judging.
Extra material — correct, incorrect, or abuse aimed at the constable — costs nothing, because the
grader answers one question and not several. Self-contradiction is not coverage. **And when the rubric
genuinely does not decide a case, the answer is CORRECT.** A false positive hands out seven balls
nobody earned. A false negative halves the ammunition of a student who knew the material, and that
student stops believing the game is fair.

### The eight calls I had to make, and how they went

Eight items had a genuine boundary case where §4.9's three-valued rubric had said `PARTIAL` and the
binary verdict cannot. Each is recorded in the item's `line` field. Six went to the student.

| Item | The case | Call | Why |
|---|---|---|---|
| `WHAT_IT_LEFT` | "the war cost more than they had, so they made the colonies chip in" — cost wording, not the noun *debt* | **CORRECT** | The item is a two-part core (the money problem **and** Parliament's colonial fix). Cost wording earns the money half — failing it over the noun *debt* would be grading vocabulary — but a money-only answer with no fix is now **wrong**, matching the shipped rubric and the labelled set. |
| `WHICH_CAME_FIRST` | "the debt" with no causal sentence after it | **CORRECT** | The ordering *is* the causal claim. The question's second half asks the same thing twice, and demanding a second sentence from a kid typing under fire is the false-negative trap in miniature. |
| `FROM_WHEN` | "it hasnt started yet" with no date named | **CORRECT** | The rewritten item asks why the fight is still live tonight, not for the date. Locating the duty in the future is the whole idea, so the exact date is not required; a bare date with no claim attached is now **wrong**, because it answers a different question. |
| `CORRECT_THE_APPRENTICE` | "no, only newspapers" — right boundary, short list | **CORRECT** | The student separated paper from goods, which is the concept. Only the enumeration is incomplete. |
| `NAME_TWO` | "paper and legal documents" — the two categories rather than two instances | **CORRECT** | Answering at category level is the more general answer, not a worse one. |
| `PRIVATE_LETTER` | "no, it's private" without the printed-or-legal reason | **CORRECT** | *Private* is the module's own framing of that exact example. |
| `WHO_PAYS` | "everyone in the empire" | **WRONG** | It does not name the colonies and does not distinguish the new policy from the old one, under which Britain paid. This is the call most likely to be argued with. |
| `BOSTON_DOES_ELECT` | naming the local body without the missing-from-Parliament half | **WRONG** | The contrast *is* the concept, and the question asks for the second half out loud: "why doesn't that settle it?" One of only two items in the bank that require two elements. |

Two structural anti-coin-flip decisions sit alongside those. `DEED_OR_CLOTH` and `PRIVATE_LETTER` are
two-way questions where a bare pick is a fifty-fifty guess, so a bare pick is WRONG — and in both
cases **the question says so in the constable's own words** ("what makes it the one?", "a bare yes or
no earns you nothing"). A rubric that punishes a student for something the question did not ask for is
a badly written question, not a strict rubric.

### The wrong-but-plausible answers I chose to reject

These are the ones a real thirteen-year-old writes, that sound like history, and that are still wrong.
Each is named in its item's `rejectExamples` with the reason, so the classifier rejects it by rule
rather than by taste.

**Motive substitutions, in the postwar pool.** *"They wanted to control us and show who was in
charge"* is the single most common wrong answer to `WHY_NOW`, and it is a power motive where the
concept is a revenue motive. *"The King was greedy"* has money in it but no war and no debt, which is
TEA's vague-motive failure exactly. *"To stop smuggling"* is real history and the wrong statute.
*"Because Boston kept causing trouble"* is a student reasoning correctly about 1774 in 1765.

**Circularity.** *"Because of the Stamp Act"* offered as the reason Parliament wants money — the
effect standing in as its own cause. Its mirror image, *"the tax put them in debt,"* is the reversal
`WHICH_CAME_FIRST` exists to catch.

**Boundary substitutions, in the stamp pool.** *"Only things imported from Britain"* is the wrong
boundary a student who has met the Sugar Act reaches for first. *"Only tea"* is the wrong Act by eight
years. *"Yes, because it's paper"* on the private letter is the over-generalisation the item is built
to catch — a student who learned "paper is taxed" and not the boundary. *"No, because nobody would
find out"* is an enforcement dodge dressed as scope.

**Politics for scope.** *"Printers are troublemakers who write against the King"* on `WHY_A_PRINTER`.
Genuinely appealing, historically not silly, and it answers a different question — the concept is what
the Act taxes, not who resists it.

**Distance for consent, in the representation pool.** This is the sharpest rejection in the bank.
*"He's never even been to Boston"* and *"London is three thousand miles away"* dispute Parliament's
speaks-for-everyone claim without touching consent, and they are the argument Boston's case does
**not** make — the town would reject an unelected member who lived on Milk Street. I expect this one
to be challenged, and I would defend it: crediting distance would credit a student who has the
grievance and not the principle.

**Anachronism.** *"The right to break away and be our own country"* on `WHAT_RIGHT`. It is 1765;
independence is eleven years off, and the sheet on the board claims a right *within* the empire.

**Over-claim.** *"Parliament has no authority over the colonies at all"* on `LAWFUL_BUT_UNJUST`, which
§4.9 already rejected and which is a real distinction: Boston in 1765 disputed the taxing power, not
the whole legislative one.

**Circular authority.** *"The government"* and *"whoever has the lawful authority"* completing
`FINISH_THE_CLAIM`. Which body holds the authority is the entire dispute, so an answer that names
"the authority" has restated the question.

### The PvP pool, and the exploit that sized it

PvP opens seeded with M1's concepts, so these items were re-read with an adversarial player in mind
rather than an honest one. `duel-items.json` → `pvpHardening` has the whole finding; the short
version is that **one memorised sentence per concept satisfies most of that concept's pool**, because
six questions about one proposition all bottom out in the same place. Checked against every rubric
rather than assumed: the postwar sentence passes 6 of 6, the representation sentence 5 of 6, the
stamp-scope sentence only 3 of 6.

Stamp scope resists because five of its six items make the player **decide** something about a
specific object. Four PvP-only items in that shape are authored for the two exposed pools, outside
the PvE rotation — §4.9 sized that rotation to exhaust in exactly three attempts, and `verify.mjs`
asserts it stays eighteen.

**The pool is 34**, mostly composed rather than authored: 18 PvE items, 7 PvP-only, and the 9 capstone
open-response items, which are already prose, already graded under a policy that inherits this one,
and already answerable from the same module. `duel-items.json` → `pvpPool` specifies the composition,
the three-tier draw, the disclosure rule, and the PvP symmetry rule. Two things in it are worth
knowing without opening the file:

**The guard on the borrowed nine.** `PVP.GUARD.CAPSTONE_ALREADY_MASTERED.v1` — *PvP may draw a
capstone item only for a concept this profile has already mastered.* One null check on
`ConceptMastery.masteredAt`, no new state. Without it a duel can serve a gate item before the gate is
sat, and the capstone's first-attempt score ends up measuring recall of a duel. Mastery rather than
merely having sat the concept, because the shrinking retry draws fresh items for concepts still
unmastered. The rule is stated word for word in both files that need it and `verify.mjs` fails if the
two copies diverge.

**The invariant, in both states.** 34 items against a hard round ceiling of 24 means **no single
match can ever repeat a question** — and 25 against 24 means the same holds under the guard, for a
player who has mastered nothing. The first version of this pool cleared the ceiling only in the
headline number: 31 unguarded but 22 guarded, which made the invariant false for exactly the players
in a build that opens PvP before the capstone. Three more PvP-only items closed it. `verify.mjs`
reads `DUEL_ROUND_CEILING` out of `@pa/duel` and fails on either state, so raising the ceiling breaks
the build rather than quietly repeating questions in play.

The guarded margin is one item, on a constant owned by another package, guarding a pool that reaches
34 only by borrowing the capstone's prose under a predicate. `BANK-EXHAUSTION-PROPOSAL.md` is what
should happen when one of those three moves.

**What happens at the bottom.** Across matches it goes quickly, and the symmetry rule — both sides
get the same item, freshness computed on the union of both ledgers — makes it go quicker, which is
the correct trade. If two players have each been served *k* items, the count fresh to both is
`n × (1 − k/n)²`: at thirty-four, about thirteen after two matches each, six after three, two after
four. The pool makes one long match safe and an evening survivable. It does not make PvP work.

### Items not answerable from the module

**None.** All eighteen check out, and three of them only because the module changed to make them
check out. `verify.mjs` asserts the mechanical half of this — every `answerableFrom` cue exists in the
deck, and every Codex card an item cites is sourced by a card the deck teaches — and the judgement
half is here:

1. **`NAME_TWO` was broken and is fixed at the source.** §4.9 flagged it: the module taught two
   categories and named no exemplars, so a student was asked to instantiate a category from nothing.
   The stamp card now names six examples inside the line and three outside it. The rubric still
   credits instantiations the module never named — an almanac, a will, a marriage licence — because
   the item measures the boundary and not recall of a list.
2. **`FINISH_THE_CLAIM` asked a student to invert a negative.** §4.7's card stated only that the tax
   was laid by a body Boston did not choose; the item asks the student to complete *"a tax may
   lawfully be laid only by —"*. The card now states the principle positively, once, because
   inverting a negative under fire is a harder and different task from recalling a claim.
3. **`SPEAKS_FOR_ALL` and `LAWFUL_BUT_UNJUST` rested on a proposition taught nowhere.** Both answer
   Parliament's claim to speak for every subject whether elected by them or not, and no card in §4.7
   raised that claim. These were the only two items in the bank a diligent student could have missed
   honestly. The representation card now carries both the claim and the reply, and the proposition is
   minted as a ninth Codex card.

§4.7 says that when an item needs a proposition the module does not teach, one of the two has to
change. In all three cases the module changed, because in all three cases the item was asking for
something a student of this chapter should be able to say.

---

## 4. Concept identifiers, and where they came from

Nothing here mints a concept id. `packages/curriculum` is the canonical registry and this content is
tagged against it:

| Used | Label | Parent | Legacy aliases |
|---|---|---|---|
| `BOS.CONCEPT.POSTWAR_REVENUE.v1` | Postwar revenue policy | 8.4(A) · `POSTWAR_POLICY` | `BOS.MD01.CONCEPT.POSTWAR_REVENUE.v1`, `RCC.DEBT_POLICY_INTRO` |
| `BOS.CONCEPT.STAMP_SCOPE.v1` | Stamp Act scope | 8.4(A) · `STAMP_ACT` | `BOS.MD01.CONCEPT.STAMP_SCOPE.v1`, `RCC.STAMP_INTERNAL_INTRO` |
| `BOS.CONCEPT.REPRESENTATION.v1` | Representation and consent | 8.4(A) · `NO_REPRESENTATION` | `BOS.MD01.CONCEPT.REPRESENTATION.v1`, `RCC.REPRESENTATION_CAUSE` |

Every pool and every Codex card carries the canonical id and the legacy learner id, so a consumer that
has not adopted the registry yet still resolves. The `RCC.*` spellings are in the registry's alias
table already.

### The Codex namespace: consumed, not minted

The pattern is `BOS.MD01.CARD.<SLUG>.v<N>`, and **I did not invent it.** Two surfaces built
concurrently already spell M1's cards that way — `codexCardIds` in the concept registry, and
`codexCardIds` on the module deck — and both took the spelling from §4.9. Given a repository with
eight incompatible curriculum vocabularies, the useful contribution is not a ninth scheme. It is the
thing neither of those files has: what each card actually says.

Nine cards. Eight are §4.9's, re-authored as propositions rather than one-line labels.

| Card | Concept | Asked by |
|---|---|---|
| `WAR_DEBT` | postwar revenue | 4 items |
| `COLONIAL_REVENUE` | postwar revenue | 4 items |
| `DEBT_TO_STAMP_CHAIN` | postwar revenue | 3 items |
| `STAMP_PAPER_SCOPE` | stamp scope | 5 items |
| `STAMP_DATE` | stamp scope | 1 item |
| `PRINTER_IMPACT` | stamp scope | 1 item |
| `NO_MEMBER_IN_PARLIAMENT` | representation | 4 items |
| `CONSENT_GROUND` | representation | 5 items |
| **`LAWFUL_NOT_CONSENTED`** | representation | 2 items — **new** |

One structural note recorded rather than acted on: the `MD01` segment is a known wart. The registry
deliberately dropped the mission segment from *concept* ids because a spiral concept cannot belong to
mission day one, and `CONSENT_GROUND` recurs under 8.15(E) and 8.19(A) later in Boston. `BOS.CARD.*`
is the right end state; renaming is a three-file change and a rename that lands in one of three files
is worse than the wart.

Card definitions carry no state. `learnedAt` and `pvpLegalAt` already exist as `CodexCardState` in
`packages/contracts/src/progression.ts`, and per §4.10 **this mission mints nothing** — cards become
PvP-legal only at 100% per concept on the chapter capstone.

---

## 5. The eval set

`eval/duel-answers.labeled.json` holds 75 labelled answers across all eighteen items: 39 correct, 36
wrong, at least three per item. **Every one is deliberately absent from the rubric it tests**, and
`verify.mjs` fails if one is copied in. A grader that passes by reproducing its own answer key has
been tested on nothing.

Report false negatives separately from false positives, never as one accuracy number. **Zero false
negatives on the CORRECT rows is the shipping condition;** false positives on the WRONG rows are a
tuning target rather than a blocker. That follows from the bullet economy: a wrongly granted bullet
costs a boss two hit points, and a wrongly denied one costs a student their belief that answering
correctly matters.

Seventy-five author-written rows are a smoke test, not a certification, and they contain no real
student writing. The only way to close that gap is playtest transcripts. The twelve TEA-scored
responses in `content/staar/eval` are the nearest thing to real data the repository holds and are
worth running as a second set once the grader speaks 8.4(A) at all.

---

## 6. What is unresolved, and who owns it

| | Owner |
|---|---|
| Port these eighteen items over the transliterated bank in `packages/grading/src/items/m1.ts`, per `duel-items.json`'s `portTo` mapping, and settle the `FROM_WHEN` conflict. | grading |
| Retag `packages/grading`'s three pools from the legacy `BOS.MD01.CONCEPT.*` ids to the canonical `BOS.CONCEPT.*` ids. The alias table resolves either, so this is housekeeping rather than a blocker. | grading |
| Append `BOS.MD01.CARD.LAWFUL_NOT_CONSENTED.v1` to the registry's `REPRESENTATION.cards`. | `packages/curriculum` |
| Swap `apps/web/src/module/m1Module.ts`'s transcribed deck for this authored one. | module player |
| §4.7's window table still prints 15/35/40/40/30/20; §4.9's rubrics are still three-valued with an open question about rounding `PARTIAL` up. Both are superseded by this directory. **This pass was scoped to §1.8 and §3 and deliberately did not touch §4.** | whoever next edits §4 |
| Hashes and a compiled artifact. The `m1-content` work item wants these run through a generalised content compiler; the JSON is authored to be hashed, and nothing here has been. | content compiler |
| SME review. Everything is `AUTHOR_DRAFT`. No entry claims curriculum sign-off, and the concept registry's own M1 entries are `OWNER_PROVIDED` rather than `SME_APPROVED`. | curriculum SME |
| A historical review pass on the module's six stamp exemplars. Newspapers, handbills, deeds, court papers, licences and playing cards are all inside the Act as passed; a reviewer should confirm the wording is fair to an eighth grader without being loose. | historical review |
| The compose-and-submit median. §4.5's paper target is six seconds per answer, and these items are longer than the ones that estimate was made against. It is the number in the whole pacing model most likely to be wrong, and only playtest settles it. | playtest |
