# Architecture

How Project Archive is built, where the source of truth lives, and — when something
breaks — which module owns the symptom. This is the map you read first.

For product vision and design intent see [`docs/design/`](docs/design/); for build-state
specs see [`docs/engine/`](docs/engine/); for the worked chapter see
[`docs/chapters/boston-1765/`](docs/chapters/boston-1765/).

---

## 1. System overview

### Dependency direction (strict, one-way)

```
@pa/contracts  →  @pa/runtime  →  apps/web  (presenter)
                             \→  apps/api  (persistence / grading)
```

- **`packages/contracts`** — pure types, IDs, constants, Zod schemas, and the
  wire protocol. Depends on nothing internal. The vocabulary every other package
  speaks (`state.ts`, `field.ts`, `save.ts`, `assessment.ts`, `protocol.ts`,
  `teks.ts`, `ids.ts`, `constants.ts`, `openResponse.ts`, `choreography.ts`,
  `api.ts`).
- **`packages/runtime`** — the headless, deterministic game brain: authored flow
  (`engine/`), content (`content/`), the learner model (`learner.ts`), the field
  simulation (`fieldState.ts`), assessment selection (`assessment/`), seeding
  (`seed.ts`), and mastery reporting (`report.ts`). No DOM, no Three.js, no
  network. Runs identically in Node tests and in the browser.
- **`apps/web`** — the React + React-Three-Fiber presenter. Renders runtime state
  into the 3D world (`src/world/`), owns input, cameras, directors, and HUD. It
  never invents game truth; it projects it and feeds player actions back as
  events. A typed text presenter is the WebGL-unavailable fallback.
- **`apps/api`** — Fastify service for Google login, save persistence
  (event-sourced records in Postgres), and open-response grading
  (`src/grading/`). It stores and replays events; it does not simulate the game.

Nothing downstream leaks upward: the runtime cannot import from the web app, and
contracts cannot import from the runtime.

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
| **Exterior world** (bounds, buildings, props, anchors, colliders) | [`apps/web/src/world/manifest.ts`](apps/web/src/world/manifest.ts) |
| **Interiors** (36 isolated scene slots, dimensions, hotspots, entry zones) | [`apps/web/src/world/interiorManifest.ts`](apps/web/src/world/interiorManifest.ts) |
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
| **Collision / out-of-bounds / walking through things** | [`apps/web/src/world/collision.ts`](apps/web/src/world/collision.ts), [`apps/web/src/world/gameplayWorld.ts`](apps/web/src/world/gameplayWorld.ts), the rect colliders + `WORLD_BOUNDS` in [`manifest.ts`](apps/web/src/world/manifest.ts) |
| **Doors / interior transitions / ping-pong** | [`apps/web/src/world/DoorDirector.tsx`](apps/web/src/world/DoorDirector.tsx), [`apps/web/src/world/EntryDirector.tsx`](apps/web/src/world/EntryDirector.tsx), [`apps/web/src/world/doorwayContract.ts`](apps/web/src/world/doorwayContract.ts), [`apps/web/src/world/interiorManifest.ts`](apps/web/src/world/interiorManifest.ts) |
| **Camera stuck / input locked / mouse-look wrong** | [`apps/web/src/world/cameraOwnership.ts`](apps/web/src/world/cameraOwnership.ts), [`apps/web/src/world/CameraDirector.tsx`](apps/web/src/world/CameraDirector.tsx), [`apps/web/src/world/FirstPersonCamera.tsx`](apps/web/src/world/FirstPersonCamera.tsx), [`apps/web/src/world/Player.tsx`](apps/web/src/world/Player.tsx) |
| **Quest markers wrong / missing / misplaced** | [`apps/web/src/world/QuestMarkerDirector.tsx`](apps/web/src/world/QuestMarkerDirector.tsx), [`apps/web/src/world/QuestMarkerHud.tsx`](apps/web/src/world/QuestMarkerHud.tsx), [`apps/web/src/world/questMarkerResolver.ts`](apps/web/src/world/questMarkerResolver.ts) |
| **Concept credit not given / learning gate won't open** | [`packages/runtime/src/learner.ts`](packages/runtime/src/learner.ts), [`packages/runtime/src/engine/ctx.ts`](packages/runtime/src/engine/ctx.ts) |
| **Micro / Standing / heat / threads state wrong** | [`packages/contracts/src/field.ts`](packages/contracts/src/field.ts), [`packages/runtime/src/fieldState.ts`](packages/runtime/src/fieldState.ts), [`packages/runtime/src/content/day1/reactive.ts`](packages/runtime/src/content/day1/reactive.ts) — **not** `learner.ts` (that owns the macro lifecycle only) |
| **CP1 / debrief assessment selection** | [`packages/runtime/src/assessment/gate.ts`](packages/runtime/src/assessment/gate.ts), [`packages/runtime/src/assessment/selectDebrief.ts`](packages/runtime/src/assessment/selectDebrief.ts), [`packages/runtime/src/assessment/questionBank.ts`](packages/runtime/src/assessment/questionBank.ts); the `VITE_CP1_ALLOW_DRAFT_BANK` flag in [`apps/web/src/pages/Play.tsx`](apps/web/src/pages/Play.tsx) selects the draft vs. production bank |
| **Open-response grading / rubric resolution** | [`apps/api/src/grading/`](apps/api/src/grading/), [`packages/runtime/src/assessment/openResponseRegistry.ts`](packages/runtime/src/assessment/openResponseRegistry.ts), [`packages/runtime/src/assessment/rubricResolver.ts`](packages/runtime/src/assessment/rubricResolver.ts) |
| **Stealth / watchers / chase** | [`apps/web/src/world/WatcherDirector.tsx`](apps/web/src/world/WatcherDirector.tsx), [`apps/web/src/world/ChaseDirector.tsx`](apps/web/src/world/ChaseDirector.tsx), [`apps/web/src/world/chaseModel.ts`](apps/web/src/world/chaseModel.ts), [`apps/web/src/world/chaseFieldGating.ts`](apps/web/src/world/chaseFieldGating.ts) |
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
  [`apps/web/src/world/__tests__/`](apps/web/src/world/__tests__/)).
- The content artifact ([`packages/runtime/src/content/generated/act1OpenResponseContent.generated.ts`](packages/runtime/src/content/generated/act1OpenResponseContent.generated.ts))
  is **generated, hash-validated, and never hand-edited** — regenerate from
  `content/boston/act1/` via `pnpm --filter @pa/runtime content:compile`.

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
