# Architecture

How Project Archive is built, where the source of truth lives, and — when something
breaks — which module owns the symptom. This is the map you read first.

For product vision and design intent see [`docs/design/`](docs/design/); for build-state
specs see [`docs/engine/`](docs/engine/); for the worked chapter see
[`docs/chapters/boston-1765/`](docs/chapters/boston-1765/).

---

## 1. System overview

### Dependency direction (strict, one-way; wave4 world split)

```
@pa/contracts  →  @pa/runtime       →  @pa/chapter-boston       →  apps/api
      \───────→  @pa/engine-world  →  @pa/chapter-boston-world  →  apps/web
                                      ↑
                              @pa/chapter-boston
```

- **`packages/contracts`** — PROTOCOL ONLY: events, plans, saves, field/
  assessment state machinery, RuntimeView shapes, Zod schemas, and generic
  branded id types (`ConceptId`, `ThreadId`, `MicroConceptId`,
  `OptionalActivityId`). Zero `BOS.` literals, zero chapter vocabularies —
  enforced by `scripts/check-boundaries.mjs`.
- **`packages/runtime`** — the chapter-agnostic learning engine: run context +
  session driver + flow DSL (`engine/`), the `ChapterDefinition` injection
  seam + chapter registry (`engine/chapter.ts`), the learner model
  (`learner.ts`), the field reducer/assertions parameterized by a chapter
  `FieldVocabulary` (`fieldState.ts`), the assessment engine (gate ladder,
  debrief selection, bank validation, rubric resolution in `assessment/`),
  seeding (`seed.ts`), the world clock (`world.ts`), and mastery reporting
  (`report.ts`). It imports NOTHING from any content package — a synthetic-
  chapter test (`test/engine-chapter.test.ts`) and the boundary lint keep it
  that way. No DOM, no Three.js, no network.
- **`packages/chapter-boston`** — the Boston 1765 content package: the Day-1
  flow/text/tables/mechanics/reactive content, CP1 checkpoint flow + question
  banks, the open-response content registry + provenance, all Boston id
  constants and tuning, and the assembled `BOSTON_1765_CHAPTER`
  `ChapterDefinition` (plus the `createDay1Session` one-liner). "Make
  Philadelphia" = write a sibling package like this one; the engine does not
  change. Layout note: it lives under `packages/*` (rather than
  `content/chapters/*`) so the existing pnpm workspace glob, raw-TS exports,
  and package-graph direction (chapter → engine → contracts) all apply with
  zero build config.
- **`packages/engine-world`** — the chapter-agnostic browser world engine:
  deterministic collision/LOS and locomotion kernels, actor/interaction
  registries, camera ownership, traversal resolution, field timing, HUD stores,
  imported-asset/interior structure loaders, and presentation arbitration. Its
  public `ChapterWorldDefinition` is the typed seam between world content and
  the web shell. It has zero Boston ids, literals, or chapter imports.
- **`packages/chapter-boston-world`** — Boston's browser world content and
  composition: exterior/interior manifests, density, atmosphere, routes,
  choreography, document art, set-piece directors, and the assembled
  `BOSTON_1765_WORLD`. It depends on `@pa/engine-world` and
  `@pa/chapter-boston`; neither dependency points back.
- **`apps/web`** — the React + React-Three-Fiber presenter. Renders runtime state
  through public package surfaces. It owns pages, persistence, styles, public
  `/world/...` and `/audio/...` assets, and QA bootstraps. Its
  `src/chapterRegistration.ts` pairs `BOSTON_1765_CHAPTER` with
  `BOSTON_1765_WORLD`; the worker remains runtime-only.
- **`apps/api`** — Fastify service for Google login, save persistence
  (event-sourced records in Postgres), and open-response grading
  (`src/grading/`). Server-side replay validation goes through the chapter
  registry (`src/chapters.ts`) keyed by `save.chapterId`; an unregistered
  chapter is a clean 400. It stores and replays events; it does not simulate
  the game.

Nothing downstream leaks upward: the engine cannot import chapter content,
the runtime cannot import from the web app, and contracts import nothing.

### Deterministic, event-sourced runtime

The authoritative save is **the seed plus the ordered list of committed
`PresenterEvent`s** ([`packages/contracts/src/save.ts`](packages/contracts/src/save.ts)).
World state, learner state, and the transcript are all **deterministic
projections** of that event log. Given the same package, seed, flow version, and
event order, every run reproduces exactly — this is what makes QA replays and the
uniqueness contract possible.

- Seeding is HMAC-derived, never `Math.random`
  ([`packages/runtime/src/seed.ts`](packages/runtime/src/seed.ts)): `attempt_seed =
  leftmost16(HMAC-SHA256(root, "PA.RUN.SEED.v1|<chapter>|<attempt>"))`; the field
  simulation and every "random-feeling" draw derive from labels off that seed in a
  fixed replay order.
- All stealth/chase/suspicion/heat math is a pure function of authored patrols +
  player state + attempt seed. No live RNG anywhere on the required path.

### The two loops

1. **Runtime loop (authoritative, deterministic).** The flow DSL
   ([`packages/runtime/src/engine/`](packages/runtime/src/engine/): `dsl.ts`,
   `driver.ts`, `ctx.ts`) advances the authored beat graph by consuming committed
   `PresenterEvent`s and reducing them into state. This loop has no wall clock and
   no RNG; it is the source of every gate, credit, and assessment decision.
2. **Presenter loop (real-time, projective).** The web app's
   requestAnimationFrame loop renders the current runtime projection into the 3D
   world, runs cameras/animation/lighting off a deterministic activity clock, and
   converts player input and mechanic results into events fed back to the runtime
   loop. It may interpolate and ease for feel, but it never mutates simulation
   truth.

At the design level this maps onto the **two-budget gameplay loop**: a
*free-clock* loop (movement, parkour, flavor — costs no day-time) wrapped around an
*activity-budget* loop (the learning beats: run → skill → dialogue/paper →
Sync/demonstration → breather). See
[`docs/design/Gameplay-Design.md`](docs/design/Gameplay-Design.md).

---

## 2. Source of truth (do not guess — read these)

| Domain | Authoritative source |
|---|---|
| **Exterior world** (bounds, buildings, props, anchors, colliders) | [`packages/chapter-boston-world/src/world/manifest.ts`](packages/chapter-boston-world/src/world/manifest.ts) |
| **Interiors** (36 isolated scene slots, dimensions, hotspots, entry zones) | [`packages/chapter-boston-world/src/world/interiorManifest.ts`](packages/chapter-boston-world/src/world/interiorManifest.ts) |
| **Behavior fixture** (the canonical Boston Day 1 acceptance flow) | [`docs/chapters/boston-1765/Day-1.md`](docs/chapters/boston-1765/Day-1.md) |
| **Per-beat build script** (animation/input/skill/code hooks) | [`docs/chapters/boston-1765/Day-1-Build-Script.md`](docs/chapters/boston-1765/Day-1-Build-Script.md) |
| **World look/layout/atmosphere law** | [`docs/design/World-Design-Bible.md`](docs/design/World-Design-Bible.md) |
| **Contracts / state shapes** | [`packages/contracts/src/`](packages/contracts/src/) |
| **Content package** (sources, prompts, rubrics, feedback, allowlists) | [`content/boston/act1/`](content/boston/act1/) |

`manifest.ts` and `interiorManifest.ts` are machine-readable and win over any prose.
When a doc and the code disagree about coordinates or IDs, the code governs and the
doc is corrected. When gameplay wording conflicts with the fixture, `Day-1.md`
governs.

---

## 3. Symptom → owning module (bug-finding table)

Start at the symptom; open the listed owner(s) first.

| Symptom | Owning module(s) |
|---|---|
| **Collision / out-of-bounds / walking through things** | engine kernel [`packages/engine-world/src/collision.ts`](packages/engine-world/src/collision.ts), Boston assembly [`packages/chapter-boston-world/src/world/gameplayWorld.ts`](packages/chapter-boston-world/src/world/gameplayWorld.ts), and [`manifest.ts`](packages/chapter-boston-world/src/world/manifest.ts) |
| **Doors / interior transitions / ping-pong** | [`packages/chapter-boston-world/src/world/DoorDirector.tsx`](packages/chapter-boston-world/src/world/DoorDirector.tsx), [`EntryDirector.tsx`](packages/chapter-boston-world/src/world/EntryDirector.tsx), [`doorwayContract.ts`](packages/chapter-boston-world/src/world/doorwayContract.ts), [`interiorManifest.ts`](packages/chapter-boston-world/src/world/interiorManifest.ts) |
| **Camera stuck / input locked / mouse-look wrong** | engine policy [`packages/engine-world/src/cameraOwnership.ts`](packages/engine-world/src/cameraOwnership.ts), Boston renderer [`packages/chapter-boston-world/src/world/CameraDirector.tsx`](packages/chapter-boston-world/src/world/CameraDirector.tsx), [`FirstPersonCamera.tsx`](packages/chapter-boston-world/src/world/FirstPersonCamera.tsx), [`Player.tsx`](packages/chapter-boston-world/src/world/Player.tsx) |
| **Quest markers wrong / missing / misplaced** | engine HUD [`packages/engine-world/src/QuestMarkerHud.tsx`](packages/engine-world/src/QuestMarkerHud.tsx), Boston resolver/director [`packages/chapter-boston-world/src/world/QuestMarkerDirector.tsx`](packages/chapter-boston-world/src/world/QuestMarkerDirector.tsx) and [`questMarkerResolver.ts`](packages/chapter-boston-world/src/world/questMarkerResolver.ts) |
| **Concept credit not given / learning gate won't open** | [`packages/runtime/src/learner.ts`](packages/runtime/src/learner.ts), [`packages/runtime/src/engine/ctx.ts`](packages/runtime/src/engine/ctx.ts) |
| **Micro / Standing / heat / threads state wrong** | [`packages/contracts/src/field.ts`](packages/contracts/src/field.ts), [`packages/runtime/src/fieldState.ts`](packages/runtime/src/fieldState.ts), [`packages/chapter-boston/src/day1/reactive.ts`](packages/chapter-boston/src/day1/reactive.ts) — **not** `learner.ts` (that owns the macro lifecycle only) |
| **CP1 / debrief assessment selection** | [`packages/runtime/src/assessment/gate.ts`](packages/runtime/src/assessment/gate.ts), [`packages/runtime/src/assessment/selectDebrief.ts`](packages/runtime/src/assessment/selectDebrief.ts), [`packages/chapter-boston/src/checkpoints/cp1Bank.ts`](packages/chapter-boston/src/checkpoints/cp1Bank.ts); the `VITE_CP1_ALLOW_DRAFT_BANK` flag in [`apps/web/src/pages/Play.tsx`](apps/web/src/pages/Play.tsx) selects the draft vs. production bank |
| **Open-response grading / rubric resolution** | [`apps/api/src/grading/`](apps/api/src/grading/), [`packages/chapter-boston/src/openResponse.ts`](packages/chapter-boston/src/openResponse.ts), [`packages/runtime/src/assessment/rubricResolver.ts`](packages/runtime/src/assessment/rubricResolver.ts) |
| **Stealth / watchers / chase** | Boston directors/model under [`packages/chapter-boston-world/src/world/`](packages/chapter-boston-world/src/world/), with generic gating/store/field kernels under [`packages/engine-world/src/`](packages/engine-world/src/) |
| **Missing / black / wrong assets** | asset pipeline verify + sync in [`assets/pipeline/`](assets/pipeline/) and the **Imported Visible World** rule ([`.cursor/rules/imported-visible-world-assets.mdc`](.cursor/rules/imported-visible-world-assets.mdc)) — production never renders a primitive fallback |
| **Save / replay determinism / drift** | [`packages/contracts/src/save.ts`](packages/contracts/src/save.ts), [`packages/runtime/src/seed.ts`](packages/runtime/src/seed.ts) |

---

## 4. Determinism & seeding contract

- The **only** authoritative state is `{package, variationRootSeedHex, flowVersion,
  committedEvents[]}` ([`save.ts`](packages/contracts/src/save.ts)). Replaying that
  log reproduces world, learner, and transcript byte-for-byte.
- Randomness is **derived, ordered, and labelled** ([`seed.ts`](packages/runtime/src/seed.ts)):
  `deriveAttemptSeed` → `draw(seed, label)` → `deriveFieldSeedHex`. Same labels in
  the same order ⇒ same values. Never introduce `Math.random`, `Date.now`, or a
  wall clock into runtime decisions.
- The presenter's activity clock and eased lighting are *cosmetic*; the runtime
  clock (`spentUnits / fixedEventBoundary`) is the deterministic one.
- Stealth, suspicion, heat, spot-checks, and chase outcomes are pure functions of
  authored patrols + player state + attempt seed (tested in the `collisionLos`,
  `chaseModel`, `chaseFieldGating` suites under
  [`packages/engine-world/src/__tests__/`](packages/engine-world/src/__tests__/)
  and [`packages/chapter-boston-world/src/world/__tests__/`](packages/chapter-boston-world/src/world/__tests__/)).
- The content artifact ([`packages/chapter-boston/src/generated/act1OpenResponseContent.generated.ts`](packages/chapter-boston/src/generated/act1OpenResponseContent.generated.ts))
  is **generated, hash-validated, and never hand-edited** — regenerate from
  `content/boston/act1/` via `pnpm --filter @pa/chapter-boston content:compile`.

---

## 5. Known intentional limits (by design — not bugs)

These are approved, non-blocking limits documented in the M4 integration handoff
([`docs/archive/2026-07/M4-INTEGRATION-HANDOFF.md`](docs/archive/2026-07/M4-INTEGRATION-HANDOFF.md)).
Do not "fix" them without revisiting that decision.

- **`street-dog` is static.** It may bark/react via text and audio but never
  locomotes — the approved pipeline has no quadruped animation path.
- **The town crier is subtitle-only.** It uses the `argu1` clip plus attributed
  subtitles; no human shout audio is fabricated (the available audio key lacks
  `sound_generation`).
- **Gull flavor is cry + attributed text**, with no procedural bird body; a visible
  flock waits for an imported bird asset.
- **`BALANCE`, `MANTLE`, and `JUMP_GAP` traversal types are disabled** in
  `DENSITY_TRAVERSAL_TYPE_STATUS` and expose no misleading interaction prompt. The
  minimal roof network is exactly two imported support boards reached with the
  existing Shift+Space ballistics.
- **Assessment applies no Standing bonus or ding** — Archive Syncs and checkpoint
  debriefs never move the player's Standing (see
  [`docs/engine/Learning-Ledger-Spec.md`](docs/engine/Learning-Ledger-Spec.md)).

---

## 6. Refactor invariants: pin the observable, and distrust a matched number

Two rules, learned the hard way on the same day, both about consolidating a system
that something else was already tuned against. They generalise, and this project
will keep hitting them as packages merge into shared cores.

**Pin the observable, not the parameter.** A test that pinned
`DASH_SPEED_SCALE === 2.6` passed happily while the dodge distance it existed to
protect went from 2.22 m to 3.99 m, because the burst changed from accelerating
into its speed to setting velocity outright. The parameter was stable; the thing
anyone cares about nearly doubled. The pin now asserts the measured burst distance
and treats the scale as secondary
([`sharedPrimitives.test.ts`](packages/engine-world/src/__tests__/sharedPrimitives.test.ts)).
Ask what a reader of the constant actually believes about the game, and assert
that.

**Matching an observable does not guarantee matching behaviour, because the
*profile* by which the quantity is reached is itself a balance change.** Setting
`DASH_SPEED_SCALE` to 1.45 restored 2.22 m exactly — and the duel still shifted,
because the same distance is now covered front-loaded rather than back-loaded. A
burst that clears a body's width in 8 ticks instead of 13 turns a dodge that used
to arrive too late into one that always works, which silently promoted the boss's
evasion from "sometimes escapes" to "always escapes" and cost the wrong-answer path
two wins in eight. The correction was to re-derive the dependent dial from measured
behaviour (`dodgeChance` in
[`boss.ts`](packages/duel/src/boss.ts)), not to trust the matched number.

Practical consequences:

- After consolidating a system, **re-measure the behaviour that depended on it**,
  even when every shared quantity is provably identical. Cheap simulation sweeps
  beat argument; see `winnability.test.ts` in `packages/duel`.
- **Distinguish a repair from a decision.** Restoring a value a refactor moved by
  accident needs no owner call; changing it on purpose does. Say which one a commit
  is doing.
- **A dial that cannot be shown to move an outcome is not a difficulty dial.**
  `dodgeReactionTicks` swept from 4 to 30 ticks changes a win rate by at most one
  run in eight; it is documented as a trigger so nobody reaches for it expecting
  authority.
- **Beware a curve where two steps land on the same tier.** The tier 5 boss took a
  magazine step at the same time its damage peaked — 112 potential damage a round
  against tier 4's 72 — and that, not the refactor, was what killed a
  perfect-playing reference player in half its one-bullet runs.

### Corollary: some things a shared dial cannot buy

A prepared player currently faces no real risk from the tier 5 boss — three bullets
a round wins every run by knockout. That is recorded as accepted, because the
obvious fix does not exist:

The two knowledge paths **share every dial**. On the wrong-answer path the player
has exactly six shots for the whole duel, and `BOSS_HEALTH_CEILING` therefore caps
boss health at five times player damage. So every point of health added to threaten
a well-supplied player walks the one-bullet path back toward the state that was just
repaired, and every point of offence added does the same by killing the unprepared
player outright. **You cannot buy risk for a prepared player without selling
winnability for an unprepared one, because it is one set of numbers.**

The conclusion is that texture at the top of the difficulty curve needs a
**mechanic, not a number**: a phase change, an ability, a positional demand —
something structural that threatens a player who has ammunition to spare without
adding raw volume. That is a design decision for the late-chapter bosses. M1 ships
at tier 1, where the numbers are good, so nothing is blocked. Anyone tempted to
crank tier 5 health should read this paragraph first.
