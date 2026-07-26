# @pa/duel

The headless core of the boss duel. No rendering, no React, no `three` — pure
simulation and state, so it runs under `node --test`, inside the browser, and
inside the PvP server authority without change.

The same machine serves player-versus-boss and player-versus-player. The only
difference is one field:

```ts
type OpponentSource =
  | { kind: "BOSS"; profile: BossProfile }   // side B is driven by bossIntent
  | { kind: "REMOTE"; handle: string };      // side B is a person who also answers
```

## There is one physics core, and none of it is here

This package holds no integrator, no geometry, no body model, no clock and no RNG.
All of it belongs to `@pa/engine-world` and is consumed through
[`src/engine.ts`](src/engine.ts), the only file here that names that dependency:

- the round clock is `advanceFieldClock` at `FIELD_TICK_HZ`;
- every displacement goes through `stepMotion`, including a dodge — which IS the
  engine's shared `DASH` burst, the same burst as a parkour dash, so the two cannot
  drift apart;
- speed selection is `freeMoveSpeed`, so sprint/walk/crouch mean the same thing in
  a duel as in a mission, and stance is `isCrouched` on the live capsule;
- cover and line of sight are `segmentOccluderIds` / `segmentClear` against the
  mission's `CollisionWorld`; a ball against a body is `segmentHitsCapsule`;
- a body is the engine's capsule plus its `eyePosition` / `chestPosition`
  landmarks, so a crouched silhouette is the same silhouette to a patrol's vision
  cone and to an incoming ball;
- randomness is `fieldRandom`, seeded per attempt through `projectFieldSeed`.

`scripts/check-boundaries.mjs` enforces this repo-wide: exactly one definition of
each core, no package re-declaring an engine tuning value, and no `Math.random` in
gameplay code.

What this package owns is combat, which exists nowhere else in the repo: the round
state machine, the bullet economy, projectile travel and hit resolution, damage and
health, the *combat meaning* of a dodge (immunity and cooldown, never the motion),
boss behaviour and difficulty scaling, and line-of-sight break scheduling.

## Upstream capabilities: all landed

Four things were needed from `engine-world` that it did not expose. All four have
landed, `src/engineGaps.ts` has been deleted rather than grown, and the duel now
consumes each one directly.

| # | Capability | Now |
|---|---|---|
| 1 | Headless subpath exports | `./fieldSimulation`, `./collision`, `./playerMotion`, `./playerInput` — the simulation core imports without the React/three barrel |
| 2 | A dash/burst motion phase | `beginDash` / `isDashing` / `cancelDash` and a real `DASH` phase, shared with the parkour dash. `DASH_SPEED_SCALE` is the engine's; the duel keeps only the immunity window and cooldown |
| 3 | A public actor hit query | `segmentHitsCapsule`, which resolves the vertical band across the whole segment rather than by an endpoint, so it is correct for anything arcing. `firstActorHit` is there for nearest-actor resolution |
| 4 | Body landmark heights | `eyePosition` / `chestPosition` / `isCrouched` in `collision.ts` — deliberately there rather than in `playerMotion.ts`, because that file already owned three of the five body numbers |

## The integrity rules

All three are structural, not validated.

**A duel verdict is binary.** Correct grants 3, wrong grants 1, and there is no
third state and no flag to add one. A half-right answer worth as much as a right
one breaks the knowledge-to-resources premise, and rounding down would only
relocate the unfairness, so the rubric author draws the line explicitly. A rubric
may keep richer internal labels for teacher reporting; `parseVerdictEnvelope`
refuses them at the boundary with a `NON_BINARY_VERDICT` rejection.

**Bullets are derived, never supplied.** `bulletsForVerdict` is the whole
knowledge-to-power conversion. No command in the reducer has a field that could
carry a bullet count, and the wire boundary rejects unknown keys rather than
ignoring them, so a client cannot smuggle one through a field the duel happens not
to read. A boss's magazine is the one non-verdict source, it is authored content,
and `roundAmmoSources` refuses it for any side that owes a verdict.

**The verdict is the committed event.** `mintVerdict` has no parameter for answer
text; a verdict carries a binary plus an opaque reference to the encrypted
server-side record. `duelCommitLog` persists only the verdicts, the derived
grants, and the terminal result.

## A duel has no round count

It runs until one side's health reaches zero, in PvE and PvP alike. The round
survives as the loop — a question, then ~20 seconds of play — but the number of
them is open. `DUEL_ROUND_CEILING` is a termination backstop so the loop provably
halts, not a length; reaching it means neither fighter could finish, and the
healthier one takes it.

Two consequences shape everything else in this package. The bank can be outlasted,
so `questions.ts` recycles items and discloses the repeat rather than hiding it,
following the assessment engine's precedent. And the winnability guarantee can no
longer be a shot budget.

## The three tuning decisions

**Unspent bullets expire at the round boundary** (`BULLET_CARRY_POLICY`, the single
named parameter for the whole rule). Carrying only rewards the player who was
already granted more, so it compounds the knowledge advantage instead of merely
granting it — and with the round count unbounded it compounds without limit. Capped
carry is implemented and tested so playtest can flip one constant.

**A correct answer's magazine has to be firable.** 14 balls a round is only worth
double 7 if a round can discharge 14. `MAX_SPENDABLE_SHOTS_PER_ROUND` is derived
from the round length and the reload, `assertGrantIsSpendable` refuses to let the
package load if the grant exceeds it, and `combat.test.ts` measures the number
against the real machine. At a 1.0s reload a round fires 20, so the grant has six
balls of slack. This guard exists because the failure it prevents is silent: every
test would still pass while knowledge quietly stopped buying anything.

**Winnability is an exchange rate, not a budget.** `projectExchange` compares
`boss health / player damage per round` against `player health / boss damage per
round`, and `assertBossWinnableOnWrongAnswers` refuses a profile whose margin falls
below `REQUIRED_WRONG_PATH_MARGIN` before any duel can start. Measured against the
reference player in `winnability.test.ts`: wrong answers win at every tier in
6.0–7.0 rounds, correct answers win in 3.8–4.4, and head to head the player who
knows the history wins every seed.

**Knowledge has to buy a fight, not the end of one, and that is a floor as well as a
direction.** Boss health used to run 250 + 35 a tier, and a test pinned a 1.5x spread
across the tiers to prove health was a real difficulty lever. Both were true and
together they capped the *bottom* of the curve: tier 5's health is bounded above by
the winnability gate, so a 1.5x spread bounds tier 1's at two thirds of that — a boss
that fell in 2.6 rounds to a student who knew the history, against 4.5 rounds and an
89% win for one who knew none of it. Knowledge decided no outcome and shortened the
climax, which is the reward for learning being less game. Health is now flat at 450:
duration is a constant of the format at about four rounds, and what a higher tier buys
is lethality inside those rounds. Four is a ceiling rather than a preference —
correct-path rounds are `roundsForBossToWin / (ratio x margin)`, so a six-round
correct-answer fight would need a wrong-answer margin at or below 1.0, which is a
lockout.

**The boss has to be able to win too, and asking only the first question hid a
defect for a day.** Every winnability measurement drives the player, so a boss too
weak to kill anybody satisfied all of them; a tier 1 boss shipped that needed the
full 24-round backstop, 585 seconds, to put down a player who did nothing at all.
Under a fixed six rounds that was survivable — a boss who could not win merely lost
on schedule — but with health-based termination it is a fight that cannot end. The
`CAN THE BOSS WIN?` table in `sweep.mts` and the test of the same name measure the
boss against a passive player; every tier now finishes, in 3.5 to 9.5 rounds.
`projectExchange` cannot see this, because `REFERENCE_BOSS_ACCURACY` is flat across
the tiers and an aim cone nobody can be hit by is exactly what a flat number cannot
express.

## Settled decisions worth not relitigating

- **A question opens every round, not every other one.** Proposed and rejected. The
  case for alternating was real — typing is ~47% of a duel's wall clock and the
  longest unbroken stretch of play is 20 seconds at any round count, and asking on
  rounds 1, 3, 5 would have made those ~30% and ~41 seconds. It loses on the
  mechanism: asking every round is what keeps each round's bullets earned by *that*
  round's question, and under alternating half of every fight runs on ammunition
  earned by an answer given a minute earlier. Two questions deciding a four-round
  fight is also a weaker claim about knowledge than four questions deciding it. The
  47% is a true measurement of a deliberate choice — the question is untimed so that
  a student reasons with evidence instead of racing a clock. See `structure.ts`.
- **Four rounds is the ceiling for a correct-answer fight, and six is arithmetically
  impossible.** `correct rounds <= roundsForBossToWin / (ratio × margin)`, with the
  ratio at 2 and the margin floored at 1.15. Boss health cannot buy past it — health
  cancels out of the ceiling, and so does the wrong-answer grant — and the two escapes
  are both spoken for: a weaker boss
  still has to finish a passive player inside the termination bound, and a bigger
  player bar still has to keep a hit at about a tenth of it for the HUD. Six rounds
  implies a wrong-answer margin near 0.9, which is a lockout. `correctPathRoundCeiling`
  and `marginImpliedByCorrectPathRounds` compute it; `boss.test.ts` asserts it.
- **Winning on points clears the mission.** Missions are optional-outcome fun and
  the chapter assessment is the mandatory learning spine, so a mission need not be
  a knowledge gate as well; mechanical skill is allowed to carry a
  clumsy-but-improving player forward. See `MISSION_CLEAR_REQUIRES_KNOCKOUT`.
- **There is no headshot.** A hit is a hit anywhere on the capsule. The player never
  chooses the height a ball arrives at — elevation is solved by the simulation — so
  a bonus for hitting high would be a lottery rather than a skill, and a multiplier
  keyed on stance would put variance into the one number the exchange model is
  computed from. See `HEADSHOT_IS_A_DISTINCT_OUTCOME`.
- **Aim assist snaps to the intercept inside a bounded cone, and the ball never
  lies.** The correction is applied to the aim before the shot exists, so the tracer
  the opponent reads is the path the ball takes. It is a fighter parameter rather
  than a global because a boss must not have it. See the aim model block in
  `tuning.ts`.
- **Abilities are plumbed and unauthored.** The owner has not settled the set, so
  every shipped loadout is empty; the seam is complete so that adding one later
  changes nothing in this package. See the header of `abilities.ts` for the list an
  author has to work through.
- **One use per ability per duel, in both modes.** A rule of the duel, not a
  property of an ability, so `ABILITY_USES_PER_DUEL` is a constant and the
  descriptor has no field an ability could raise.
- **A true PvP draw changes no standing and is logged for review** rather than
  triggering a sudden-death mode built for an edge case. See `standingEffect`.
- **The boss does not answer a question.** Its magazine is authored, which keeps
  "bullets derive from a committed verdict" literally true for every human side.
- **`BULLET_SPEED_MPS` is deliberately unrealistic** and owner-approved: at a real
  flintlock's velocity the ball crosses the arena faster than a human reacts and
  dodging becomes decorative.

## Resolved: the HUD no longer pins the bullet ratio

`apps/web/test/duelPresentation.test.ts` used to assert that a correct answer is
*exactly two rows* of a wrong one, which required `BULLETS_FOR_CORRECT` to be exactly
twice `BULLETS_FOR_WRONG` — a magazine layout constraining game balance, which is the
wrong way round. It held the wrong-answer floor at 7, and 7 made the wrong-answer round
two-thirds empty: 47% dead air at tier 1 and a ball in hand only 34% of the round,
because 7 balls at a 1.0s reload fill 35% of a 20-ball round against the correct
answer's 70%. The second-order punishment for answering wrong was not more rounds but
emptier ones, which is the worst version of the mode to hand a struggling student.

That assertion is gone. The HUD derives a row width from whatever the economy is, and the
test asserts that the magazine reads (countable rows, no orphan row below half, a correct
grant visibly taller) instead of asserting a ratio, plus a sweep proving every plausible
grant pair up to the spendable ceiling lays out.

**The floor is 7 again, and that is a decision about who gets to accept the cost.** The
economy went to 9 once the layout stopped pinning it, and the measurements were good: dead
air on the wrong-answer path falls from 47% to 31% at tier 1, time holding a ball rises
from 34% to 44%, and the path shortens from 6.1 rounds to 5.1. It is back at 7 until the
owner has played the boss fight themselves. Note that the ratio is 2 again as a
*coincidence* of the two decisions rather than as a constraint — do not let the HUD test
re-pin it just because the arithmetic currently happens to line up.

**The wrong-answer margin does not move between the two, and the cancellation is exact.**
The boss's `magazinePerRound` *is* `BULLETS_FOR_WRONG`, so the grant divides both
`roundsForBossToWin` and `roundsForPlayerToWin` and drops out of the ratio:
`margin = playerHealth × playerRate / (bossRate × bossHealth)`. The gate reports
1.68 / 1.61 / 1.54 / 1.48 / 1.42 across tiers 1–5 at either grant, to four decimals,
with `playerHitsOfSlack` likewise identical; `correctPathRoundCeiling` is invariant for
the same reason. `assertGrantIsSpendable` is indifferent because it bounds the correct
grant, which never moved.

**The cost that is not free, and the reason 7 is back:** that same identity means a boss
at 9 throws 9 balls a round instead of 7, which is 29% more boss damage on *every* path
including the correct one, where the player gets no compensating grant. Against a fallible
student over 64 seeds at tier 5, knowing every answer falls from 56/64 wins to 46/64.
Every guard the design owns still passes and the knowledge gap does not narrow, but a
difficulty increase arriving as a side effect of a pacing fix is the owner's call to make
at the controller. The lever that would separate the two — giving the boss its own
authored magazine — breaks the cancellation and three other invariants; see
`KNOWLEDGE_ADVANTAGE_RATIO` in `tuning.ts`.

## Layout

```
src/engine.ts      the single import surface onto @pa/engine-world
src/tuning.ts      every tuning number, named, with both decisions argued
src/verdict.ts     verdict minting and the wire boundary
src/bullets.ts     the bullet economy reducer
src/abilities.ts   the narrow interface the shared ability system must satisfy
src/combat.ts      the fixed-step gunfight
src/policy.ts      the boss, and a reference skilled player for tuning
src/boss.ts        boss profiles by tier and the winnability invariant
src/machine.ts     the round state machine
src/events.ts      the event vocabulary and the committed subset
src/arena.ts       arenas composed from engine-world's collision builders
```

## Running

```bash
pnpm --filter @pa/duel test        # 91 tests, ~9s (the tuning sweeps are most of it)
pnpm --filter @pa/duel typecheck
pnpm lint                          # the repo-wide one-core guard
```
