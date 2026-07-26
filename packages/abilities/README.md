# @pa/abilities

The XP and Level curve, and the one ability system that hangs off it. Headless: no
rendering, no React, no `three` — pure data and arithmetic, so it runs under
`node --test`, in the browser, and inside the PvP server authority.

The two halves are one package because they are one design decision. Ability
unlocks are defined at Level milestones, so the curve decides *when a player can
do something new*; authoring them apart would mean authoring the same decision
twice.

## What this package does not contain

- **No ability interface.** `@pa/duel` defines `AbilityDescriptor`,
  `AbilityModifiers`, `AbilityInvocationContext` and `DuelAbility`. This package
  conforms to them through [`src/duelSurface.ts`](src/duelSurface.ts), which is the
  only file that names the dependency.
- **No progression arithmetic.** `@pa/contracts` owns the `XpCurve` shape,
  `levelForXp`, the attempt decay and `rankFromCumulativeLevels`. Consumed through
  [`src/contractsSurface.ts`](src/contractsSurface.ts). Nothing is reimplemented;
  `curve.test.ts` asserts that every derivation here returns exactly what the
  contracts function returns.
- **No physics.** `@pa/engine-world` owns the one 60 Hz clock, the one collision
  representation and the one motion integrator. Every movement effect is a *scale
  on the target velocity handed to `stepMotion`*, never a displacement.
  [`src/engineDependencies.ts`](src/engineDependencies.ts) records what each channel
  needed upstream, and every one of those is a parameter added to a function the
  engine already had — never a system this package owns a second copy of.

## The curve

| | |
|---|---|
| Start | Level 0, 0 XP, Rank 1 |
| Mission award | `base(n) = 120 + 15(n-1)` — M1 pays 120, M14 pays 315 |
| Attempt decay | full, two-thirds, one-third, then the mission is spent and pays nothing |
| Chapter XP ceiling | 3045 — modules, assessments and the capstone all pay zero |
| Level cost | `cost(L) = 40 + 3(L-1)`, so `T(L) = 40L + 3L(L-1)/2` |
| Level 1 | 40 XP, which *is* the worst possible clear of M1 |
| Boston's Level ceiling | 34 |
| Rank | `1 + floor(cumulative Levels / 10)`, so one chapter ≈ three Ranks |

Two properties are load-bearing and both are asserted rather than claimed:

- **Every first-attempt clear pays 2 or 3 Levels**, at M1 and at M14 alike. The
  award ramp and the cost ramp have matched slopes, so progress never spikes and
  never stalls.
- **The worst-paying player who still finishes gains a Level on every single
  mission.** Level 1 costs exactly what a third-attempt clear of M1 pays, so
  nobody who succeeds even once is left at Level 0.

## Where a player lands at the end of Boston

Computed in [`src/trajectory.ts`](src/trajectory.ts) and pinned by
`trajectory.test.ts`.

| Archetype | XP | Level | Rank | Abilities |
|---|---|---|---|---|
| Flawless — every mission first try | 3045 | 34 | **4** | 8 of 8 |
| Strong — one retry on the last four | 2655 | 31 | **4** | 8 of 8 |
| Typical — nine firsts, four seconds, one third | 2465 | 29 | **3** | 8 of 8 |
| Struggling — three missions failed outright | 1235 | 18 | **2** | 6 of 8 |
| Grinder — finishes everything, always last attempt | 1015 | 16 | **2** | 6 of 8 |
| Spectator — clears nothing | 0 | 0 | **1** | 0 of 8 |

PvP unlocks only when Boston is complete, so this *is* the opening ladder: Ranks
2, 3 and 4 hold the playing population and Rank 1 means "cleared almost nothing".
Three populated brackets is deliberate — a curve paying fifty Levels a chapter
would produce six brackets holding two students each.

## The ability set

Chapter-scoped in single-player, permanent in the PvP pool, **one use per ability
per encounter** — the mission constant is derived from `ABILITY_USES_PER_DUEL`, not
chosen beside it.

| Level | Ability | Window | Does |
|---|---|---|---|
| 3 | Ward Chime | 4.0s | A thrown object pulls 2.5x harder and holds attention 2.5x longer; in a duel the boss checks the wrong angle |
| 5 | Kite Step | 5.0s | 1.45x jump launch (2.1x apex, 1.25m → 2.63m) and 1.2x ground speed |
| 7 | Longcoat Hush | 8.0s | Half visibility, and carried evidence is unreadable; 0.75x incoming damage |
| 8 | Hold Fast | 3.0s | Quarter-time recovery from body contact; 0.35x incoming damage |
| 11 | Long Stride | 1.6s | 1.7x target velocity — which is 1.7x run, 1.7x gap, and a 1.7x duel dodge |
| 15 | Powder Damp | 3.0s | Opponent fires at 2.2x the interval and moves at 0.8x |
| 21 | Farsight | 6.0s | See the opponent, or a watcher, through cover. Refuses itself when you already can |
| 27 | Out of Time | 3.0s | Nothing in 1765 can see you. Zero incoming damage |

The first five unlock Levels are **derived, not chosen**: they are the Levels the
grinder archetype actually holds on arriving at M5, M6, M8, M9 and M11, which are
the missions the slate introduces the five functional affordances at. The last
three are combat-shaped, because damage, rate of fire and perception are the half
of `AbilityModifiers` no mission affordance touches.

## How one ability behaves identically in a mission and in a duel

Not by two implementations agreeing. By there being one.

```ts
interface AbilityEffect {
  duel:  AbilityModifiers;       // @pa/duel's own type, embedded not mirrored
  world: WorldAbilityModifiers;  // only what a duel cannot express
}
```

- `modifiersAt(t)` returns `effectAt(t).duel` **by reference**. There is no
  adapter to lose a field and no translation to drift. If `@pa/duel` adds a
  channel, this package stops compiling.
- A mission runs `@pa/duel`'s own `createAbilityLedger`, `invokeAbility`,
  `expireAbilityEffects` and `activeModifiers` — see
  [`src/missionSession.ts`](src/missionSession.ts). `duelConformance.test.ts`
  drives a mission session and a duel session through 1200 identical ticks and
  asserts the ledgers and modifiers are deeply equal at every one.
- `canInvoke` is the same predicate over the same context shape, built field for
  field the way `combat.ts` builds it. `grounded` is read off `MotionState.grounded`
  exactly as the duel reads it — deliberately *not* `canDash`, because `beginDash`
  applies `canDash` itself in both contexts and the engine stays the one authority
  on burst legality.
- `Long Stride` is the demonstration: one number in the duel's own
  `selfMoveSpeedScale`. The duel already multiplies its target velocity by it and
  already opens its dodge with `dashSpeed(RUN_SPEED * speedScale)`; a mission
  multiplies the target velocity it hands the flow layer. Nobody wrote a duel
  version.

## The world channels, and what reads them

Every channel below is driven end to end in `liveChannels.test.ts`: a real ability,
resolved into a loadout, invoked through the duel's ledger, measured against the same
run with nothing invoked. None of those tests inspects a record.

| Channel | Consumer | Proof |
|---|---|---|
| `selfVisibilityScale` | `StealthFieldInput.invokedAbility` → `visibility()` | Out of Time takes a confirmed sighting to zero suspicion; Longcoat Hush halves it without erasing it |
| `diversionAttentionScale` | captured onto the object by `throwFieldDiversion`; hold scaled from the `NoiseEvent` | Ward Chime turns a guard fifteen metres from the landing point, who cannot hear an ordinary throw |
| `selfJumpVelocityScale` | `beginStandingJump` / `beginRunningJump` launch scale | Kite Step raises a measured apex by 1.38 m through `stepMotion` |
| `staggerRecoveryScale` | `resolveContact` in `contact.ts` | Hold Fast cuts a 900 ms grab to 225 ms and leaves the noise untouched |
| `carriedEvidenceConcealed` | **still pending, and correctly so** | A document with a readable face is mission content, not physics. The seam exists and is empty. |

The stagger is the one that needed an argument rather than a parameter. A non-lethal
*takedown* was refused as a base verb, because once a guard can be deleted every
avoidance verb becomes a slower answer to a solved problem. A stagger is the opposite
kind of object — a penalty the player suffers, not a capability they wield — and four
properties keep it that way: the noise is not on the ability's channel, the recovery
floor is 0.2 rather than 0, avoidance strictly dominates recovery at every scale, and
`ContactResolution` has no output channel to the body that made contact. All four are
asserted in `contact.test.ts`.

## No mission requires an ability

Verified in [`src/verify.ts`](src/verify.ts), four ways:

1. Every row of the slate declares an empty `requiredAbilityIds` and a named
   ability-free route, and so does the capstone.
2. Every affordance names the fallback the slate itself authored — the stairs, the
   long unconcealed crossing, the safe-deck line, the marsh detour.
3. The **Spectator** archetype reaches the capstone at Level 0 with an empty
   loadout, because failing a mission advances you anyway.
4. Structurally: every channel is a multiplier on something the base kit already
   does, or a boolean about what an observer *learns*. No ability grants a verb,
   and `assertAbilityCannotGrantVerbs` stops that compiling.

Point 3 is why the rule is not a preference. Because failure advances the player,
the Level anybody is *guaranteed* to hold at any mission is 0, so no positive
unlock threshold could satisfy a requirement under any curve. Mission-Slate §18's
"first required" wording is therefore unsatisfiable and §1.6 wins; §18.6's
validation procedure is still run, against the grinder rather than against a
guarantee that does not exist.

## Layout

| File | |
|---|---|
| `curve.ts` | The XP curve and mission awards, with the reasoning for every number |
| `missions.ts` | The slate as progression data, plus §18's affordance schedule and each fallback |
| `effects.ts` | `AbilityEffect`, composition, and the channel registry with consumer status |
| `ability.ts` | `GameAbility extends DuelAbility`, `defineAbility`, the mission context builder |
| `boston.ts` | The eight authored abilities |
| `loadout.ts` | PvE chapter scope, PvP permanence, the four-slot cap |
| `missionSession.ts` | Running abilities in a mission on the duel's own runtime |
| `reach.ts` | What the numbers mean in metres, asked of the engine's own envelope |
| `trajectory.ts` | Archetypes, and every reported Level and Rank |
| `verify.ts` | The progression proofs, as code |
| `engineDependencies.ts` | What is still needed from `@pa/engine-world`, declared not forked |

## Commands

```sh
node --import tsx --test src/__tests__/*.test.ts   # 81 tests
../../node_modules/.bin/tsc --noEmit                # typecheck
```
