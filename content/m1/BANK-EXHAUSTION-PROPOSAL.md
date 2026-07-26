# Proposal: what a duel does when the question bank runs out

**Status: proposal only. Deliberately not implemented.** The duel agent owns the bank-exhaustion
policy under open-ended rounds and is designing one concurrently; this is written down precisely so
the owner can reconcile two proposals rather than discover two behaviours. Nothing in
`packages/duel` was touched.

Written from the content side, so it takes the pool as the scarce thing and asks what the match
should do when it is gone.

---

## The problem, in one paragraph

A duel now runs until one side's health reaches zero. The round survives as the loop — a question,
then about twenty seconds of play — but the count is open, so the question pool is a resource the
match consumes at a rate no author controls. M1's PvP pool is thirty-four items against a hard round
ceiling of twenty-four — twenty-five once the capstone guard withholds the borrowed prose — which
means **no single match can exhaust it today**. That is an invariant holding by one item in the state
every player starts in, on a ceiling that lives in another package's tuning file, over a pool that
reaches its total by borrowing the capstone's prose under a predicate. It will not hold forever, and when it
stops holding the failure is silent: the duel serves a question the player answered eleven minutes
ago and calls the resulting fourteen balls knowledge.

## The proposal

**Cap the questions, not the rounds.** Rounds stay unbounded, health still ends the match, and the
question phase stops when the pool is spent.

### 1. When it triggers

**The pool is spent for a match when every eligible item has already been asked in that same match.**

Not "no fresh item for this profile" — that arrives far too early and would silence the questions in
a player's second session. A question a student last met three matches ago is still a question; a
question they answered four rounds ago is not.

In PvP, eligibility is computed on the union of both sides' ledgers, as the draw policy already
requires, and a capstone item is eligible only under
`PVP.GUARD.CAPSTONE_ALREADY_MASTERED.v1`. So the two sides always spend the pool together and neither
can be asked something the other is not.

Under the current invariant this trigger never fires. That is the point: it should be a defined
behaviour that is unreachable, rather than an undefined behaviour that becomes reachable the next
time a tuning constant moves.

### 2. What happens after it fires

| | |
|---|---|
| **Questions** | Stop. No question phase, no pause, no grading call. |
| **Rounds** | Continue exactly as before — the engagement window, the line-of-sight break, the health model, all unchanged. |
| **The grant** | Every subsequent round grants `BULLETS_FOR_WRONG` — **7** at the current tuning — to each side. |
| **The match** | Ends the way it already ends: on health, or on the round ceiling resolving by health difference. |

**Why 7 and not 14.** Fourteen is what knowledge buys. Once the pool is spent there is no knowledge
being demonstrated, and handing out the correct-answer grant for answering nothing would make a long
match the cheapest way to farm ammunition. Seven is the floor the economy already defines as
winnable — the tuning notes say plainly that seven can win a round — so the match degrades into a
pure gunfight at a rate the design has already accepted as fair. It is the honest number: it is what
a player gets for not demonstrating knowledge, which is exactly the situation.

**Why not zero.** A round with no ammunition is not a round; it is a countdown while one player
shoots.

**Why not carry the last verdict forward.** It would freeze an advantage earned once and compound it
for the rest of the match, which is the same corruption as the memorised-sentence exploit arriving by
a different door.

**Why symmetric.** Both sides get the same grant for the same reason they get the same question: an
asymmetry here would read as knowledge and be tenure. In PvE the boss's magazine is authored rather
than earned, so nothing changes on its side.

### 3. What the player is told

Once, at the transition, and not again: *the constable has run out of questions.* One line, one
round, then silence.

Not per round, because a repeated notice reads as an error. Not never, because the player is about to
notice that their ammunition stopped varying and should be told why rather than left to conclude the
grader broke.

### 4. What is committed

A `QUESTIONS_EXHAUSTED` marker on the round where it happens, and a flag on every round after it.

Two reasons, both of them the same reasons the assessment engine discloses a recycled item rather
than hiding it. A replay has to reproduce the match, and a match whose second half granted a flat 7
is not reproducible from verdicts that were never minted. And a reviewer — or a ladder — has to be
able to tell a match decided by knowledge from a match decided by shooting. **A PvP ladder that
silently mixes the two is reporting one number for two different games.**

### 5. What it does not do

- **It does not bound the match.** Health does. This bounds only the content the match consumes.
- **It does not reduce the authoring requirement.** Sixty to a hundred items on these three concepts
  is still what PvP wants. This bounds the damage when the pool falls short of that, which it does
  today by a factor of three.
- **It does not replace the invariant.** Keeping the pool larger than `DUEL_ROUND_CEILING` is still
  the first line, and `content/m1/verify.mjs` still fails if it stops holding. This is what happens
  when the first line is breached, not permission to breach it.

## Alternatives considered

**Lower `DUEL_ROUND_CEILING` to the pool size.** Cheapest of all, and wrong: it makes a content number
into a match-length number, so every item authored would lengthen the maximum duel and every item
retired would shorten it. The ceiling is an anti-hang backstop and should not become a design lever.

**Generate a question.** Refused by the whole architecture. Mission-Slate §1.7 is explicit that the
model only classifies and never writes a question, and a generated question on a PvP ladder is a
generated historical claim in a graded competitive context.

**Refuse the round.** The assessment engine rejected the equivalent — refusing a retry — because it
converts a shortage that is ours into a wall that is theirs. The same argument holds here and more
cheaply, since a duel can simply carry on.

**Recycle within the match with disclosure.** This is tier 3 of the existing draw policy and it stays
specified. The objection is that a question answered four rounds ago grants fourteen balls for
recalling four rounds of short-term memory, which is not the thing the economy is meant to price. It
is the better behaviour at low round counts and the worse one at high; if the owner prefers a single
mechanism, prefer this proposal, because the case where they differ is exactly the long match this
exists for.

## The arithmetic, for reconciliation

| | |
|---|---|
| PvP pool | **34** — 18 PvE items, 7 PvP-only, 9 capstone prose |
| Under the capstone guard, before a player has mastered anything | **25** |
| Hard round ceiling | **24** |
| Maximum questions one match can consume | 24, and 24 < 25 ≤ 34, so **the trigger is unreachable in both states** |
| Typical match | about 6 rounds |
| Grant once spent | **7** per side per round |

**This proposal is now purely defensive, and that is a change from the version first written.** At the
time it was drafted the guarded pool was 22 against a ceiling of 24, so a maximal match by a player
who had not yet sat the capstone could genuinely spend the pool — the trigger was live for exactly
the players in tomorrow's build. Three more PvP-only items took the guarded pool to 25 and closed it.

So there is no situation today in which this fires. It is worth implementing anyway, for the reason
the invariant is worth checking at all: it holds by **one item** in the guarded state, on a ceiling
that lives in another package's tuning file, guarding a pool that only reached 34 by borrowing the
capstone's prose under a predicate. Every one of those three can move without anyone thinking about
this document. When one of them does, the choice is between a defined degrade and an emergent one.

One residual, contingent rather than live. If the selector rotates concepts evenly — which the PvE
schedule did, and which is the natural generalisation of an open round count — a 24-round match asks
8 questions per concept, and the guarded per-concept depths are postwar 9, representation 9, stamp
scope 7. Stamp scope would repeat once. Nothing in `packages/duel` schedules concepts today, so this
is a property of a selector that has not been written; one more stamp-scope item closes it, and
`content/m1/verify.mjs` warns while it stands.
