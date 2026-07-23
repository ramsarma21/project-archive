# Act 1 Build Brief — engineering handoff

**You are implementing the Boston Act 1 engagement layer** (skill/compound-verb mechanics, a stealth + chase system, a reactive NPC/quest layer, and a checkpoint debrief) on top of an existing, working colonial-era 3D game (React Three Fiber + TypeScript, Vite monorepo). This brief tells you exactly what to read, what already exists, what to build, and in what order. **Read §1 (guardrails) and §2 (docs) before writing any code, then execute §5 starting at M0.**

---

## 0. TL;DR

1. Read the guardrails (§1) — breaking any of them fails review.
2. Skim the design docs (§2) — `Act-1-Production-Plan.md` (esp. Part D + Part E milestones) and `Act-1-World-Content.md` are your primary specs.
3. Learn the codebase map (§4).
4. Execute milestones in order (§5). **Start with M0** — a foundational refactor that unblocks everything. Do **not** start stealth features before M0 lands.
5. Follow conventions (§6), respect locked decisions + tuning defaults (§7), verify against §8.

---

## 1. Non-negotiable guardrails (invariants)

1. **Imported-visible-world law.** Every visible physical object/surface is an imported GLB or generated texture from the asset pipeline. Do **not** build visible buildings/props/ground/furniture from Three primitives. Procedural code is allowed **only** for invisible collision, triggers, navigation, vision cones, sky/fog/water/weather, particles, shaders, UI/HUD, and dev diagnostics. (See `.cursor/rules/imported-visible-world-assets.mdc`.)
2. **No-mocap law.** Gamified mechanics **animate the object/prop** and hold a **generic library clip** on the character. Do not author bespoke skinned per-beat performances. New baked clips only where explicitly listed.
3. **Learning invariants.** The 3 required macro concepts are **path-invariant** and live on the authored spine — never gate them behind skill/stealth/quests. Optional content (quests, threads, micro) is **always safe to skip**. **Interaction = tracking**: proximity/earshot never logs learning; only a deliberate tracked interaction does.
4. **Determinism.** No live RNG in mechanics. All outcomes are pure functions of authored data + player state + a per-attempt seed. (Enables the existing unit-test style.)
5. **Bounded consequences.** Stealth/heat/chase move suspicion, access, relationships — **never a hard dead-end** for required learning; a caught player is always rerouted.
6. **Don't regress.** Keep existing tests green (`apps/web/src/world/__tests__/*`) and don't break the working spine (the Day-1 runtime flow). Movement/collision behavior must be unchanged by refactors unless a task says otherwise.

---

## 2. Docs to read (authority chain — all at repo root)

| Doc | Read it for |
|---|---|
| `Gameplay-Design.md` | The design authority. §2 two-budget model, §6 compound-verb skill, §7 stealth, §8 reactive world, §11A Act 1 flow. |
| **`Act-1-Vertical-Slice.md`** | **THE CURRENT BUILD TARGET.** The bounded playable slice (intake→CP1) with one strong instance of each pillar, what already exists vs. the delta, and the 3 slice-first build increments. Start here. |
| **`Act-1-Production-Plan.md`** | **Primary systems spec.** Part A (activity catalog + build status), Part B (assets), Part C (animation), **Part D (stealth/chase math + foundational refactors)**, **Part E (milestones M0–M5)**. |
| **`Act-1-World-Content.md`** | **Primary content spec.** Exact placed content — every NPC/quest/challenge/knowledge/watcher with coords, assets, triggers, draft dialogue, states, hooks. Organized by zone. |
| `Day-1-v2.md` | The per-beat build script for the spine (animations, inputs, skills, cue IDs, mechanic promptIds). |
| `Boston-Quests-and-NPCs.md` | The NPC-interaction + quest system + cross-Act threads. **§2A living routes / fetch-and-ferry / owned routes** is load-bearing for how quests play. |
| `Act-1-Micro-Concepts.md` | The 14 micro concepts + which interaction logs each (feeds the debrief). |
| **`Boston-Mechanics-Spec.md`** | **The mechanics catalog** — Press, Search/writs, Contraband ferry, Boycott/homespun, Town-meeting, News-relay. Each with rules→cost→consequence→concept→anim→accessibility→build. "The historical constraint IS the game constraint." |
| **`Act-1-Environmental-Lore.md`** | **The "Found History" inspectable layer** — every look-at object by zone, tier (A spine-support / B micro / C ambient), concept, coords, draft inspect text. |
| **`Boston-Archive-Spec.md`** | **The Archive orchestrator** — its 7 roles (narrator, director, routes-reminder, decision-frame, reinforcer, mastery gate, hint engine) + the annoyance budget that rations them. |
| **`Boston-Learning-Ledger-Spec.md`** | **Contract extension** — additive `provenance` on exposures + `ConceptRegistry` (class/recurrence/SE) + engaged-set debrief sampling. Backward-compatible with `@pa/contracts`. |
| `Boston-Concept-Delivery-Map.md` | The creed + triple bind + delivery hierarchy + saturation law — *why* content is delivered the way it is. |
| **`Act-1-Activity-Expansion.md`** | **The "alive world" layer** — the interactive-occupant NPC tier (deterministic preset dialogue + state-gated options, no AI) + 5 learning-bearing activity families. **§0: these are TEMPLATES; build only the curated Act-1 subset**, not the whole library. |
| **`Act-1-Activity-Feel.md`** | **The look/feel/distinctiveness bible** — per-activity camera, tempo, input, signature sight+sound, flavor, and teaching-in-view; the distinctiveness levers + variety matrix (anti-sameness law) + shared presentation rules. |

When a task says "per Production Plan D.3", open that section — the formulas/constants are there.

---

## 3. Repo & commands

- **Monorepo.** The game app is **`apps/web`** (package `@pa/web`). Shared packages: `@pa/contracts`, `@pa/runtime`. There's also `apps/api`.
- Game code lives under **`apps/web/src/world/`** (3D + systems) and **`apps/web/src/presenter/`** (DOM HUD/overlays).
- Commands (run in `apps/web`):
  - `npm run dev` — Vite dev server.
  - `npm run typecheck` — `tsc --noEmit`.
  - `npm run test` — `node --import tsx --test src/world/__tests__/*.test.ts` (Node test runner + tsx).
  - `npm run build` — production build.
- Deps of note: `three` 0.185, `@react-three/fiber` 8, `@react-three/drei`, `zod`, `dexie`. `@react-three/rapier` is installed **but the player movement/collision is a custom deterministic semantic model — do NOT replace it with Rapier.** Reuse the semantic model for line-of-sight.

---

## 4. Codebase map (what exists / what you'll touch)

All paths under `apps/web/src/`.

### Player movement (`world/`)
- **`playerMotion.ts`** — motion state machine (`MotionPhase`), `stepMotion()`, `freeMoveSpeed()`. Constants: `WALK_SPEED 2.3`, `RUN_SPEED 4.6`, `CROUCH_SPEED 1.15`, `GRAVITY 10.8`. **Sprint = Shift, currently unlimited**, published as `PlayerApi.motion.sprinting`. → add stamina here.
- **`playerInput.ts`** — key/pointer capture, jump resolution. `RUN_JUMP_*` constants.
- **`Player.tsx`** — the R3F player: `useFrame` motion+camera, `PlayerApi` (position/facing/motion, `setInputLocked`, `requestAuthored`, `canReachInteraction`). **Builds the collision world privately here — you will extract it (M0).** Owns the third-person follow camera; `cameraOverride` currently gates both external camera **and** movement lock (split in M0). `clipForPhase()` maps motion phase → clip.

### Collision (`world/`)
- **`collision.ts`** — pure semantic AABB model: `CollisionWorld` = `blockers` (XZ rects + vertical spans), `platforms`, `bounds`; `sweepXZ()`, `supportBelow()`, etc. Not mesh/raycast. `CAPSULE_RADIUS 0.35`. → add `segmentClear(a,b)` LOS here.
- Data sources built in `World3D`/`Player`: `manifest.ts` `exteriorColliders()`, `doorAwareBuildingColliders()`, `traversalBlockerColliders()`.
- `outdoorCollisionAdapter.ts` + `collisionManifest.generated.ts` exist but are **not wired** — ignore for M0 (keep the legacy path).

### Traversal / parkour (`world/`)
- `traversalMarkers.ts` (marker table + roof zones; flavor markers: `CHURCH_BELL_ROPE`, `TOWN_PUMP_SPLASH`, `TAVERN_BENCH_SIT`), `traversalResolver.ts` (`selectPrompt`/`decideAction`), `traversalRegistration.ts`, `TraversalDirector.tsx` (captures **F**). Verbs `VAULT/CLIMB_UP/CLIMB_DOWN/DUCK_UNDER` execute; `BALANCE/JUMP_GAP/MANTLE` are disabled in `DENSITY_TRAVERSAL_TYPE_STATUS`.

### NPCs / actors (`world/`)
- `PopulationDirector.tsx` — ambient crowd; deterministic waypoint loops via `buildRoute()`/`sampleRoute()` (pure fn of `clock.elapsedTime`). **No AI/patrol/collision/perception.** `ROSTER`, archetype rigs (`dockhand/agitator/taxclerk/towncrier/goodwife`), cap `MAX_AMBIENT_RIGS 66`, cull 74m.
- `ActorDirector.tsx` — named-cast staging: `DirectedNpc`, `actorCueFor()`. Positions are private to components (→ M0 actor registry).
- `choreography.ts` — `STAGE_ANCHORS`, cues; `MechanicRigs.tsx` — object rigs on the `pa:mechanic-visual` event bus (kinds PRESS/EFFORT/SORT/PLACE, phases READY→ACTIVE→COMMIT→COMPLETE).
- `animationManifest.ts` — `PLAYER_CLIPS` (35), NPC 10-clip subset, `PLAYER_ACTION_CLIPS`. `jump`/`runJump` are queued (fall back to idle until the v6 bake).

### Camera (`world/`)
- `CameraDirector.tsx` (cinematic/authored), `FirstPersonCamera.tsx`, `FirstPersonDirector.tsx`. `World3D.tsx` arbitrates modes via booleans (`choreographyCameraActive`, `firstPersonActive`). → M0 camera split + a `ChaseDirector` camera owner.

### HUD / overlays (`presenter/` + `world/`)
- `presenter/Hud.tsx` — top DOM HUD (daylight meter = the `div`-width pattern to copy for a stamina bar). Gets `RuntimeView`, not per-frame world state.
- **`world/QuestMarkerHud.tsx` + `QuestMarkerDirector.tsx`** — **the pattern to copy**: an external store written by an R3F director, read by a DOM overlay via `useSyncExternalStore`, meaningful-change-gated. Build the stealth HUD store this way.
- `presenter/ArchiveOverlay.tsx` — full modal (Tab): relationship bars, notes, routes. → add Standing card + Threads-log tab here.

### Manifest & layout (`world/manifest.ts`)
- `BUILDINGS`, `PROPS`, `LOCATIONS` (interiors: `MERCER_PRESS`, `THOMAS_COUNTINGHOUSE`, `PIKE_OFFICE`, `CUSTOM_HOUSE`, + `CUSTOMS_POST`, `RIDER_POST`, `CLARKE_DOORWAY`, `LIBERTY_TREE_APPROACH`), `MARKER_ANCHORS` (incl. the rider-run corridors), `NPCS`, `AMBIENT`, `WORLD_BOUNDS {minX:-165,maxX:108,minZ:-30,maxZ:30}`. Coordinates for all Act-1 content are in `Act-1-World-Content.md`.

### Tests (`world/__tests__/`)
- `collisionMotion.test.ts`, `traversalResolver.test.ts`, `playerInput.test.ts` — copy this pure-unit style for new systems.

---

## 5. Build order (execute in sequence)

Each milestone is independently testable. **Full task detail + math + constants are in `Act-1-Production-Plan.md` Part D & E** — this is the execution index.

### M0 — Foundations (no player-visible feature; unblocks everything) — DO FIRST
Goal: expose the shared services the stealth/chase/reactive systems need, without changing current behavior.
1. **Shared collision/LOS service.** Extract the collision-world construction out of `Player.tsx` into a `World3D`-owned module (e.g. `world/gameplayWorld.ts`). Expose `sweepXZ` (unchanged) **and add `segmentClear(a: Vec3, b: Vec3): boolean`** in `collision.ts` (segment vs. XZ blocker rects, honoring vertical spans; not a mesh raycast). Pass the service to `Player` (behavior identical) and make it queryable by new directors.
   - *Acceptance:* `collisionMotion.test.ts` still passes; new `segmentClear` unit test (scripted blockers → expected clear/occluded) passes.
2. **Actor registry.** A `World3D`-owned registry where `DirectedNpc` and (future) watchers publish `{id, position, forwardVec, kind}` per frame; queryable by directors. Ambient crowd stays private. Watchers/pursuers will be **dedicated actors** (not ambient route sampling).
3. **Stealth store.** New `world/stealthStore.ts` mirroring `QuestMarkerHud`'s external-store pattern: `{stamina, suspicion, detectionState, heat, standing, chaseActive, nearestWatcherDir}` + a `useSyncExternalStore` hook + a DOM overlay component (empty/hidden for now).
4. **Camera-ownership split.** Refactor `Player.cameraOverride` into two concepts: `cameraControlledExternally` (skip the player's follow-camera write) and `inputLocked` (freeze movement). Update `World3D` arbitration. Precedence: choreography/first-person > chase > free-roam.
   - *Acceptance:* choreography still locks both camera + movement (no visible change); a temporary debug flag can hold the camera externally while movement stays live.
5. **Persistence slots.** Add `heat`, `standing`, and per-`thread` state to the runtime contract / `Play` (not local `World3D` state) so they survive interior transitions.

### M1 — Stamina + chase vertical slice (the "is it fun?" bet)
Stamina (gate Shift in `freeMoveSpeed()`, drain/regen per D.1) + `ChaseDirector` (pursuer motor, shake/caught, caught→chewed-out→released-outside-watch-house-later per D.7) + stamina HUD bar + one scripted pursuer using a **tinted `officer-rigged`**. **Bake `jump`/`runJump`** (asset pipeline; needed for chase hops). Tune constants by feel. See D.1, D.7.

### M2 — Watchers + suspicion + heat
`WatcherDirector` (posted + patrol, vision cones), the suspicion integrator + tells, heat state machine. Place the 4 watchers per `Act-1-World-Content.md` §9 (reuse the existing `officer` NPC at the −56 checkpoint). Wire the B8 watched street + B9 confrontation branch (comply/talk/run). See D.2–D.4, D.6.

### M3 — Standing + reactive world + threads
`StandingCard` (D.5) + `ReactiveNpcDirector` (mobile named cast ad-hoc, unnamed interactables, thread figures) + knowledge-interactable tagging + the engaged-micro tracker + Threads-log tab in `ArchiveOverlay`. Content = `Act-1-World-Content.md` §2–§8. Threads system = `Boston-Quests-and-NPCs.md`.

### M4 — Content & assets
Compound-verb extensions (press ink/register per `Day-1-v2.md` B2; haul; final pull B12). Assets per Production Plan B: watch-house landmark (reuse `bldg-townhouse-civic` + new `sign-watchhouse.png`), effigy placard + coin/paper textures, 1–2 roof boards; enable extra traversal verbs where CH-rooftop-run needs them. Commission the dedicated constable rig here (deferred from M1).

### M5 — Assessment
Engaged-micro → CP1 debrief overlay + STAAR-style item selection (deterministic). *Note: the authored STAAR question bank + final dialogue text are a separate content pass — see §8 gaps.*

---

## 6. Conventions

- **Mechanic visuals** ride the `pa:mechanic-visual` `window` event (`MechanicRigs.tsx`). Reuse this bus for new object animations; don't invent a parallel channel.
- **Live HUD gauges** use the `QuestMarkerHud` external-store + `useSyncExternalStore` pattern (write from an R3F director, read in DOM, meaningful-change-gated). Don't push per-frame state through React props.
- **New systems get pure unit tests** in `world/__tests__/` in the existing style (scripted inputs → expected outputs; no wall-clock, no RNG). Cover: `segmentClear`, the suspicion integrator, chase shake/caught, stamina drain/regen.
- **Animation:** reuse existing clips (`animationManifest.ts`); the only new baked clips for Act 1 are `jump`/`runJump`. Watchers reuse the NPC 10-clip subset — no new clips.
- **Coordinates & content** come from `Act-1-World-Content.md` (grounded in `manifest.ts`); don't hardcode ad-hoc positions.

---

## 7. Locked decisions & tuning defaults

**Decisions (do not re-litigate):**
- Watchers = **tinted `officer-rigged`** for M1–M2; dedicated `constable-rigged` at M4.
- Inspector's office = a **watch house** = reuse `bldg-townhouse-civic` + new `sign-watchhouse.png` (separate from the Custom House).
- **≤4 active watchers** + crowd at peak.
- Roof route = **minimal** (existing props + 1–2 bridge boards).
- Constants below are **defaults to tune in M1**, not locked.

**Initial tuning defaults (from Production Plan D — validate in M1):**
- Stamina: sprint −0.28/s, vault/climb −0.15 each, walk/idle +0.22/s; empty → jog cap `3.2 m/s`.
- Pursuer: `4.3 m/s` (vs. sprint `4.6`); +1 pursuer / +0.2 m/s at high heat.
- Cones: posted 35°/12m, patrol 28°/10m.
- Suspicion: `dS/dt = +K_up·v·heatMult·standingMult` in view, `−K_down` out; `K_up 0.6`, `K_down 0.5`; visibility `v = cone·distance·exposure·movement·cover`, LOS-gated. Tells at S≥0.35 / 0.7; challenge at S≥1.
- Heat: calm→noticed→watched→hunted; decays hunted→watched 45s, watched→noticed 60s, noticed→calm 90s (paused in-cone).
- Chase shake: break LOS + gap >8m held 4.5s, or reach a refuge. Caught: pursuer <1.2m while stamina=0, or cornered 2s.

---

## 8. Definition of done & known content gaps

**Per-milestone done =** feature works in `npm run dev`, `npm run typecheck` clean, existing + new tests pass (`npm run test`), no guardrail violated, behavior matches the referenced Production-Plan-D spec, content matches `Act-1-World-Content.md`.

**Not your job (separate content/authoring passes — flag if you need them):**
- Final **dialogue text** (the doc has concrete drafts; real text-slice authoring is separate).
- The authored **STAAR question bank** + TEKS sign-off (M5 consumes it; you build the selection/debrief UI, not the questions).
- Curriculum SME approval of TEKS tags.

**Start now:** M0, task 1 (the shared collision/LOS service + `segmentClear`). It's the long pole and unblocks the M1 chase slice.
