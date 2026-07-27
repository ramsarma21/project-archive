# Unwired Systems

A workspace-wide inventory of code that is **built, usually documented, often
unit-tested, and connected to nothing**. Every entry is a feature that was paid
for and is not being delivered, and every one of them is invisible from the
outside: the module around it looks finished, the tests pass, and `pnpm lint`,
`pnpm typecheck` and `pnpm test` are all green.

Ordered by what the owner loses when they sit down and play.

---

## Why this is a class and not a run of bad luck

Eleven instances were found independently before this sweep, each after it had
already cost somebody a debugging session: `PARKOUR_CLIP_FALLBACKS` read by
nothing, `standableAt` consumed by nothing, `depenetrateXZ` with no callers,
`flow.previewVerb` computed and discarded, `curiousHoldTicks` documented and
unread, `coveredAt` never bound, `readout.hunt` drawn by no surface, `hunt.ts`
implemented against watchers no alert state could reach, `onDetected` declared
and never implemented, twenty-six pipeline fixtures nothing executed, and two
curriculum exports that had drifted to values matching nothing.

Ten of those eleven are now closed. This document is what a deliberate sweep
found underneath them.

The shape has three recurring causes, and naming them is more useful than any
single fix:

1. **An optional seam with a default.** `coveredAt?`, `onDetected?`,
   `resourceActive?`, `readout?` — every one of them compiles, runs, and returns
   the "nothing is happening" answer when nobody binds it. TypeScript is
   *designed* not to complain about this, so the type system is structurally
   incapable of being the thing that catches it.
2. **A layer built ahead of its consumer.** The projection lands, the surface
   that was going to draw it is deferred, and the deferral is recorded in a
   comment rather than anywhere a build can see it.
3. **A deletion that left a stump.** The Boston chapter packages were removed;
   twenty-one engine modules that only it ever mounted were not.

---

## Method, and its limits

Three passes:

- **Static.** Every exported symbol in `apps/`, `packages/`, `infra/lib`,
  `scripts/` and `assets/pipeline/` was matched against every word occurrence in
  every other file, split by production versus test. This produces the raw dead
  exports. It has a high false-positive rate on its own — a constant referenced
  only inside its own file (`DODGE_IFRAME_SECONDS` feeding `DODGE_IFRAME_TICKS`)
  looks identical to a dead one, and roughly a third of the raw hits are that.
- **Struct fields.** For each port/tuning interface, every declared key was
  checked for a read outside the file that declares it. This is what found
  `MissionPresentation.liveDiversions`.
- **Call-path tracing from the real entry points** — `main.tsx`, `buildApp`,
  `stepMissionRuntime`, the duel tick, the Vite HTML inputs. This is where the
  expensive findings came from and it is not automatable; see the guard section.

**What the sweep cannot see.** A value that reaches a real surface which then
ignores one field of it; a system whose output is consumed but acted on by
nothing downstream (the `hunt.ts` case); a number that is read but read wrongly.
Those need a behavioural probe, not a grep, and the only reliable one this repo
has is the measurement that found `hunt.ts`: run the thing and check the number
moved.

---

## Tier 1 — the owner loses this in M1 today

### 1.1 The stealth readout's "why" — 11 of 12 fields discarded (FIXED in this pass)

- **What.** `packages/engine-world/src/stealth/readout.ts` (595 lines) computes a
  twelve-field `StealthReadout` on every fixed step: which watcher is driving
  suspicion, a ranked *cause* for why they can see you, a bearing to them,
  per-watcher cones and call-in windows, why a crowd blend is failing, and the
  hunt.
- **Supposed to do.** Its own header states the goal: "being caught and not
  knowing why" is the worst failure a stealth game can have, and `cause` is the
  answer — ranked by which single change the player could make right now would
  alone break the contact.
- **Was happening.** `MissionHud` read exactly one field, `readout.hunt`. The
  other eleven — including `cause`, the entire reason the module exists, and
  `DETECTION_CAUSE_LABEL`, the twelve authored second-person sentences that go
  with it — were computed sixty times a second and thrown away. The player saw a
  word, a bar and a distance, none of which says which of the eight things they
  are doing is the one getting them read.
- **Ever worked?** No. `cause` has never reached a screen.
- **Cost.** Done: a `causeNote` reader and one `<span>` in the exposure card,
  reusing existing CSS classes.
- **Still open in the same object.** `crowd.blocked` + `BLEND_BLOCKER_LABEL`
  (why a blend silently failed to take — "too few bodies", "he watched you walk
  in"), `watchers[].callInTicks` (the one window in the escalation ladder the
  player can still act inside), `threatBearingRad` (an off-screen chevron),
  `trend` (am I getting away with it), `lastSighting`. Each is a line or a
  glyph; none has a surface.

### 1.2 `MissionInstance.onDetected` — being read still costs nothing

- **What.** `apps/web/src/mission/levelPort.ts:347`, called at
  `traversal.ts:788` as `instance.onDetected?.(read, field)`.
- **Supposed to do.** Route cost. §4.11's position is that being seen anywhere
  but the final court costs *position, not the attempt* — the level closes the
  advantageous crossover, forces a lower line, pushes the player behind cover.
  That is the entire reason M1 authors three ways off the balcony and two ways
  across Dock Square.
- **Actually happening.** `apps/web/src/chapter/m1Mission.ts` binds `coveredAt`,
  `exposureAt`, `lightLevelAt`, `failWhen` and `civiliansAtTick`, and does not
  bind this. The `?.` swallows it. Being read outside the final court has no
  consequence beyond suspicion decaying again.
- **Ever worked?** No level has ever bound it.
- **Cost.** Small in the container, real in the level: M1 has to decide *what*
  closes. The cheapest honest version is a latch that removes one route edge
  from the wayfinder for the rest of the attempt, which the route graph already
  supports. Must be a function of tick and seed (the port says so) so a replay
  reproduces it. Half a day including the design call.

### 1.3 Thrown diversions are invisible, and so is aiming one

- **What.** `MissionPresentation.liveDiversions` (`traversal.ts:1100`) publishes
  every object in flight or at rest, every sample. `previewThrow`
  (`stealth/diversion.ts:432`) solves and returns the arc the throw would take.
- **Supposed to do.** The port comment is explicit: "Objects in flight or at
  rest. The level draws them; nothing procedural does."
- **Actually happening.** `MissionStage` mounts the player, the crowd, the
  watch, the sky and the level's scenery. Nothing reads `liveDiversions`.
  Nothing calls `previewThrow`. Pressing Q plays a 450 ms arm swing and
  decrements a counter; the bottle does not exist on screen, there is no aim
  line, and the throw goes to a hard-coded 8 m down the look vector.
  `MissionStage.tsx:97` admits the first half in a comment.
  `apps/web/test/missionCrowd.test.ts:197` asserts `liveDiversions.length === 1`
  — a passing test for a thing no player can see, which is the nastiest variant
  of this defect because it reads as health.
- **Ever worked?** No.
- **Cost.** Two halves. The renderer needs an imported GLB for a thrown object —
  there is none in `packages/mission-m1/src/assets.ts`, so this goes through the
  concept → Meshy → optimise → verify pipeline before a line of React is
  written. The aim preview needs no asset (a line or a ground ring is
  presentation, permitted by the imported-visible-world rule) and is perhaps two
  hours against `previewThrow`, which already returns exactly what it needs.

### 1.4 The stamina resource — sprinting has never tired anybody

- **What.** `packages/engine-world/src/stamina.ts`: `createStamina`,
  `stepStamina`, `acceptTraversalStamina`, `staminaSprintSpeed`,
  `clampStamina`, five tuning constants, four types, and
  `packages/engine-world/src/__tests__/stamina.test.ts` exercising all of it.
  The constants carry a dated feel-tuning note: "Feel-tuned 2026-07-22
  (playtest: 'he chases you too fast')".
- **Supposed to do.** A full sprint lasts about seven seconds and recovers at a
  jog, so a chase is won by managing bursts and breaking line of sight. Exhausted
  traversal still succeeds but takes 1.35× as long, so a required route can
  never dead-end.
- **Actually happening.** `stepStamina` and `acceptTraversalStamina` have no
  callers outside their test. `staminaSprintSpeed` is called once, from
  `freeMoveSpeed` in `playerInput.ts:219`, with
  `resourceActive: input.resourceActive ?? false` — and the mission's call site
  (`traversal.ts:650`) passes four fields, none of which is `resourceActive`,
  `stamina` or `staminaAssist`. The whole system evaluates to "off" through an
  optional field nobody sets. Nothing anywhere computes a stamina value to pass
  in.
- **Ever worked?** In the deleted Boston chapter's chase, plausibly. Not in the
  mission container, ever.
- **Cost.** Genuinely uncertain, and this is a *design* question first. The
  file's own first line says "Ordinary free roam never consults this system,
  preserving its unlimited Shift sprint contract" — so the intended trigger is a
  chase, and M1 now has one (`stepWatcherPursuit`). Deciding whether a hunt
  should switch stamina on is an owner call; the wiring afterwards is a
  `StaminaState` on `MissionRuntime`, one `stepStamina` per fixed step, and
  three extra fields on the `freeMoveSpeed` call. **Note: `playerInput.ts` and
  `playerMotion.ts` are currently owned by another agent — do not touch.**

### 1.5 `assets/pipeline` fixtures still unreachable from `pnpm test`

- **What.** `assets/pipeline/collision_lib.test.mjs` and `placement_lib.test.mjs`
  — 59 tests covering the placement and collision maths the whole level is built
  from. Verified passing.
- **Status.** Half-fixed. `.github/workflows/ci.yml:77` now runs
  `node --test 'assets/pipeline/*.test.mjs'`, so CI executes them. But
  `assets/pipeline` has no `package.json`, so `pnpm -r test` cannot reach it and
  `scripts/run-tests.mjs` neither runs them nor counts them as missing — the one
  failure mode that script was written to catch. A developer running `pnpm test`
  locally still gets a green tree that says nothing about these 59.
- **Cost.** Ten minutes. Either add a `package.json` with a `test` script (which
  makes `run-tests.mjs` discover and roll it up for free, and is the fix that
  matches the script's own model), or spawn the `node --test` glob alongside pnpm
  in `run-tests.mjs`. The first is better: it also makes the directory visible
  to `expectedPackages()`, so deleting the script later gets caught.

---

## Tier 2 — the owner loses this outside the mission floor

### 2.1 `retryOrderedModule` — the remediation loop, unbuilt into the session

- **What.** `apps/web/src/module/moduleOrder.ts`, 227 lines, five exported
  functions, a 36-line header explaining the invariants, and
  `apps/web/test/moduleOrder.test.ts` covering it. Referenced only by
  `apps/web/src/module/index.ts`'s `export *`.
- **Supposed to do.** On a retry, the three-minute learning deck re-orders so it
  opens on the concepts the last attempt got wrong. Same six cards, same cue
  set, same total duration; frames and syntheses pinned; a student who lost on
  representation reads representation first instead of reading four cards to
  reach it for the third time in one sitting.
- **Actually happening.** `useMissionSession` calls
  `moduleFor(missionId) ?? moduleForMission`, which returns the authored deck
  verbatim. A student who fails M1 three times reads the identical deck in the
  identical order three times. This is the educational core of the product and
  it is the only adaptive behaviour in the module phase.
- **Ever worked?** No.
- **Cost.** Small-to-medium and unusually well set up. The evidence already
  exists: `MissionResult.duel.rounds` carries `{conceptId, verdict}` per round,
  and `session.lastResult` holds it. The gap is a `ModuleKnowledgeLedger` that
  survives across attempts (the file explains why keying it by mission rather
  than reading `lastResult` matters — spiral concepts recur across chapters), and
  one call inside the session's module-open transition. Half a day, mostly in
  deciding where the ledger is persisted.

### 2.2 `registerGradingRoutes` — a whole API route table nothing mounts

- **What.** `apps/api/src/routes/grading.ts`, 259 lines. Serves
  `GET /v1/grading/items/:itemId`, `POST /v1/grading/answers` and
  `GET /v1/grading/health`, with CSRF, session ownership, answer retention, a
  `MultiReviewLog`, a low-confidence ledger, and — the part that matters — an
  optional `RoundItemAuthority` that refuses an answer submitted for an item
  that is not the one the round drew.
- **Actually happening.** `buildApp` registers progression, duels, pvp and
  reporting. It does not import this file. The client posts to
  `/v1/duels/:duelId/rounds/:round/verdict`, served by `routes/duels.ts`, which
  supersedes most of this — so the module is largely dead weight rather than a
  lost feature.
- **The part that is a real gap.** `routes/duels.ts` has no round-to-item
  binding. It grades whatever `itemId` the client sends, provided the bank knows
  it. A modified client can therefore shop the pool for the easiest question in
  every round. The code that closes that hole exists, is written, and is not
  mounted. `routes/duels.ts` documents its other deliberate omissions (no rate
  limit, and why) but not this one.
- **Ever worked?** The routes have never been reachable.
- **Cost.** Do not mount this file. Port the `RoundItemAuthority` check into
  `routes/duels.ts` and delete `routes/grading.ts`, or mark it clearly as
  superseded. The authority itself needs the mission container's seeded question
  selection to be readable server-side, which `duelQuestionsForAttempt` makes
  possible from the attempt seed. A day, and it is a cheating hole rather than a
  feature.

### 2.3 `SubmissionRateLimiter` — declared, never instantiated

- **What.** `apps/api/src/assessment/requestPolicy.ts:14`, a class with no
  `new` anywhere in the repo. Its sibling in the same file,
  `validAssessmentMutationRequest`, *is* used by both live route tables.
- **Note.** `routes/duels.ts:35-39` argues at length that a naive limiter is
  actively harmful here, because a 429 is treated by the client as unreachable
  and grants the full magazine — so a cheater could trip the limiter on purpose.
  That reasoning is sound and probably explains why nothing instantiates this.
  It is not recorded anywhere near the class itself, which is how the next
  person to find it will wire it up and make grading worse.
- **Cost.** Ten minutes: either delete it, or put the paragraph from
  `routes/duels.ts` on the class so the decision travels with the code.

---

## Tier 3 — whole subsystems that ship unreachable

These are deliberate and documented deferrals, not accidents. They belong here
anyway, because the deferral is invisible from the build and the sums are large.

### 3.1 PvP is not reachable from the shipped app

- **Size.** `packages/pvp` 2,346 lines, `apps/web/src/pvp` 4,322 lines,
  `apps/api/src/routes/pvp.ts` + `apps/api/src/pvp/*` 2,232 lines, eight live
  HTTP endpoints, and migration 007's durable `pvp_standing` table. Roughly
  8,900 lines plus a schema.
- **Actually happening.** `PvpScreen` is mounted by exactly one file,
  `apps/web/src/pvp/entry.tsx`, loaded by exactly one page,
  `apps/web/src/pvp/pvp.html`. `apps/web/vite.config.ts` declares no
  `build.rollupOptions.input`, so Vite builds `index.html` only. `main.tsx`
  mounts `App`, which routes Home → Hub; the Hub imports `MissionDeck` and
  never `PvpScreen`. In a production build the page does not exist. In dev it is
  reachable by typing the path.
- **Documented.** `apps/web/src/pvp/index.ts:23` — "The hub can mount
  `PvpScreen` whenever its owner is ready."
- **Cost to land.** Small: a hub entry point and the extra Vite input. The work
  is deciding where PvP sits in the hub, not building it.

### 3.2 `@pa/netcode` is imported by nothing

- **Size.** 4,338 lines of source plus eight test suites. Server session, host,
  loop and snapshot; client prediction, interpolation and reconciliation; a
  divergence detector; per-tick hashing; a simulated-link harness with latency
  profiles.
- **Actually happening.** No file outside `packages/netcode` contains the string
  `@pa/netcode`. It is the only one of the fourteen workspace packages with zero
  consumers. Live PvP uses HTTP polling with server-side interpolation
  (`apps/web/src/pvp/arenaFeed.ts`) instead.
- **Documented, precisely.** `arenaFeed.ts:17-21` names this as a seam: "`packages/netcode` measures zero reconciliation error out to 442 ms of round
  trip, and wiring it in is deliberately not this change... Handing it a
  predicted source later is a constructor swap." `usePvpSession.ts` says the
  same about the transport.
- **Assessment.** This is the healthiest entry in the document: the deferral is
  deliberate, the seam it will attach to is named in both files, and the package
  is fully tested against a simulated link. Its only real cost is that it sits
  behind 3.1 — a transport upgrade for a mode the player cannot open.

---

## Tier 4 — orphaned by the Boston chapter deletion

Twenty-one modules in `packages/engine-world/src`, **2,682 lines**, whose only
reference anywhere in the workspace is the package's own `index.ts` barrel:

`StealthHud.tsx`, `RunnerMap.tsx`, `QuestMarkerHud.tsx`, `chapterWorld.ts`,
`stealthStore.ts`, `chaseFieldGating.ts`, `consequenceReceipts.ts`,
`presentationTimeline.ts`, `presentationHandoff.ts`, `noticeArbiter.ts`,
`panelPlacement.ts`, `cameraOwnership.ts`, `actorRegistry.ts`,
`interactionRegistry.ts`, `interactionResolver.ts`, `questArrivalLatch.ts`,
`traversalResolver.ts`, `qaChaseContract.ts`, `qaEnvironment.ts`,
`mechanicBodyStaging.ts`, `stamina.ts`.

These are not lost features — the mission container replaced most of them with
its own equivalents (`MissionHud` for `StealthHud`, `VisorRunMark` for
`QuestMarkerHud`, the level port for `ChapterWorldDefinition`). They are dead
weight with three costs:

- `ARCHITECTURE.md` still describes `ChapterWorldDefinition` as "the typed seam
  between world content and the web shell". It is not; nothing implements it.
  The whole of §1 of that document describes a package layout
  (`chapter-boston`, `chapter-boston-world`) that no longer exists.
- `stamina.ts` is in this list *and* in Tier 1.4, which is exactly the ambiguity
  a stump creates: nobody can tell a deleted feature from a deferred one.
- `MissionStage.tsx:637` carries a `useEffect` that re-registers the player rig
  on mount, guarding against `@pa/chapter-boston-world` registering "from a
  stale list when it loads". That package cannot load. The workaround outlived
  the problem.

**Cost.** A day of deletion, and it needs an owner decision per module rather
than a blanket sweep — `noticeArbiter`, `cameraOwnership` and `actorRegistry`
are plausible things the next chapter wants. Correcting `ARCHITECTURE.md` is the
higher-value half and is independent.

---

## Tier 5 — smaller instances, same shape

| What | Where | State |
|---|---|---|
| `authoredLightAt`, `spilledLanternContribution` | `apps/web/src/chapter/m1LanternPlan.ts` | Documented as "the honesty check in one function" and "the number the test bounds". No caller and **no test** — `apps/web/test/missionLanterns.test.ts` uses `lightLevelAt` directly. The doc claims a guard that does not exist. |
| `resolveDashPress`, `traversalActionFor` | `packages/engine-world/src/playerInput.ts` | Press hygiene (stale-press expiry, no auto-repeat, UI-focus guard) with no callers. The container re-implements latching in `missionInput.ts`, correctly but separately. Two copies of one rule. |
| `M1_STABLE_MISSION_ID` | `packages/curriculum/src/missions.ts` | Still exported, still referenced only by its own test. |
| `packages/mission-m1/src/pacing.ts` | `PRECISION_BEAT_S`, `REFLEX_WINDOW_S`, `REFLEX_SCALE`, `OPENING_S`, `COMPETENT`, `AUTHORED_ACTION_MS`, `movingFraction` | The mission's pacing budget model. Nothing reads it; the numbers in the design docs are hand-carried. |
| `packages/mission-m1/src/envelope.ts` | `CHAIN_SWEET_SPOT_M`, `LINE_GAP_FRACTION`, `SLIDE_MIN/MAX_HEADROOM_M` | Authored movement envelope constants with no reader. `CHAIN_REACH_M` beside them is read by tests only. |
| `packages/mission-m1/src/cover.ts` | `COVER_SAMPLE_HEIGHT_FRACTIONS`, `COVER_SAMPLE_LATERAL_RADII`, `coverAt` | Superseded by `coverPredicate`, which *is* now bound. Leftovers. |
| `DIVERSION_RADIUS_M`, `DIVERSION_HEIGHT_M`, `DIVERSION_RELEASE_HEIGHT_M`, `DIVERSION_LIFETIME_TICKS` | `packages/engine-world/src/stealth/diversion.ts` | The physical dimensions of a thrown object, for a thrown object that is not drawn. Blocked on the same missing GLB as 1.3. |
| `MissionPresentation.recentEvents` | `apps/web/src/mission/traversal.ts:1091` | A 48-entry ring maintained every tick — `OBJECTIVE_MET`, `DETECTED`, `WATCH_MOVED`, `HARD_LANDING`, `FLOW_REACHED` — published to the HUD and read by no surface. It is the material for a run timeline on the result screen, and it is free. |
| `packages/contracts/src/progression.ts` | 22 Zod schemas | `CampaignProgressionSchema`, `ChapterProgressionSchema`, `MissionAttemptSchema`, `CodexCardStateSchema`, `PROGRESSION_ERRORS`, `MISSION_OUTCOMES`… declared, exported, and validated against nothing. About half have test references from `contractAlignment.test.ts`, which asserts the schemas agree with each other — a self-consistent contract nobody parses through. |
| `EMPTY_HUD_SNAPSHOT`, `createQuestMarkerHudStore`, `RunnerMapOverlay`, `CompassRibbon`, `PlaceholderPerson`, `ImportedTexturedProp` | `packages/engine-world` | Components and stores inside the Tier 4 orphans. |
| `parseEnvFile`, `resetM1BankCache`, `resetPvpPoolCache`, `newPkce`, `verifyGoogleIdentity`, `envFlag`, `readCommittedVerdicts`, `emptyProgressionContent` | api + grading | Test seams and helpers with no test or production caller. Individually trivial; collectively they are how the signal-to-noise of any future guard gets decided. |

---

## Ruled out — do not re-find these

Named so the next sweep does not spend a morning on them:

- **Constants consumed only inside their declaring file.** `DODGE_IFRAME_SECONDS`
  → `DODGE_IFRAME_TICKS`, `FIRE_INTERVAL_SECONDS`, `BULLET_LIFETIME_SECONDS`,
  `LINE_OF_SIGHT_BREAK_SECONDS`, `M1_HANDBILL_CHART`, `patrolPhaseIndex`,
  `duelVerdictBody`. Roughly a third of the raw static hits.
- **Default parameter values.** `M1_NAIL_STANCE` / `M1_NAIL_TARGET` are the
  fallbacks for `m1NailStanceBeat(options)`, which M1 calls with the level's own
  coordinates via `precisionBeatSpec()`. Working as designed.
- **`MISSION_NODES` / `MISSION_EDGES` / `DEFAULT_HUB_SLATE`.** Pre-built default
  instances; the Hub calls `missionNodesFor` / `missionEdgesFor` with live
  progression instead.
- **`M1_SECOND_BEAT_CHART` / `M1_SECOND_BEAT_TICKS`.** Explicitly "a costed
  second encounter, drawn but not placed" — a priced proposal, correctly parked.
- **The extra Vite HTML pages** (`duel.html`, `floor.html`, `visor.html`,
  `assetSheet.html`). Dev harnesses, correctly excluded from the build.
  `pvp.html` is the exception and is Tier 3.1.
- **Previously-reported items now closed.** `standableAt` (read by
  `surfaceOffset` in `mission-m1/src/runtime.ts`), `coveredAt` (bound at
  `m1Mission.ts:332`), `readout.hunt` (drawn by `huntNote`),
  `flow.previewVerb` (drives `offerFor`), `curiousHoldTicks` (read by
  `stealth/pursuit.ts`), `PARKOUR_CLIP_FALLBACKS`, `depenetrateXZ`,
  `attachVerdictReceipts`, watcher pursuit.

---

## Can a build guard stop this class permanently?

**Partly, and the honest split is about 70/30.**

### What a guard can catch, reliably

A `scripts/check-unwired.mjs` in the house style of `check-boundaries.mjs` could
enforce three rules:

**(a) No exported symbol with zero references anywhere.** The precise predicate
that removes most of the noise is *"no reference in any other file, **and** no
reference inside its own file other than its declaration"*. The second clause is
what distinguishes `DODGE_IFRAME_SECONDS` (feeds a sibling constant) from
`retryOrderedModule` (feeds nothing). Comments stripped first, exactly as both
existing scripts do. This rule alone would have caught `stepStamina`,
`retryOrderedModule`, `registerGradingRoutes`, `previewThrow`,
`PARKOUR_CLIP_FALLBACKS`, `depenetrateXZ`, `M1_STABLE_MISSION_ID`,
`SubmissionRateLimiter` and most of Tier 5 — nine of the eleven original
findings and the majority of this document.

**(b) No declared struct field that nothing reads.** Scoped to a named list of
port and tuning interfaces rather than every interface in the repo, because the
value is concentrated there: `MissionInstance`, `MissionPresentation`,
`StealthTuning`, `ParkourTuning`, `StealthReadout`, `DuelTuning`. Catches
`liveDiversions`, `recentEvents` and `curiousHoldTicks`. This is a fifty-line
check; a working prototype found all three during this sweep.

**(c) No optional port hook that no implementation binds.** For each optional
method on a listed port interface, require at least one object literal in the
repo that sets that key. Catches `onDetected` and would have caught `coveredAt`.
Narrow, cheap, and it targets the single most productive shape in the whole
class — the `?.` call site.

### What it cannot catch, and this is the expensive part

- **`hunt.ts`.** A search that was fully implemented, correctly called, and had
  its output handed to watcher positions that were a pure function of the clock.
  Every symbol referenced, every field read, every test green, and 0.000000 m of
  measured deviation after a confirmed sighting. No static rule sees this.
- **A projection consumed but ignored.** `readout.cause` was reached — the HUD
  read `view.stealth.readout` on the very next line — and simply not printed.
  Rule (b) would have to be field-precise *through* an optional chain to catch
  it, which is a type-aware analysis, not a grep.
- **A value read but read wrongly.** Out of scope for any of this.

The only instrument that finds these is the one that found `hunt.ts`: a
behavioural probe that runs the system and asserts the number moved. That is a
test-writing discipline, not a build guard — and the discipline generalises as
*pin the observable, not the parameter*, which `ARCHITECTURE.md` §6 already
states for a different reason.

### The false positives, and how the house already handles them

The raw static rule finds ~554 candidates today, which is unshippable as a
failure. But the repo has already solved this exact problem twice, and the
pattern is right there in `check-boundaries.mjs`: `MATH_RANDOM_ALLOWLIST` and
`WALL_CLOCK_ALLOWLIST` are `Map`s from path to *a written reason*, and every
accepted exception is **printed on every successful run** so the list cannot
grow quietly.

Applied here, that means seeding an allowlist with today's set and failing on
anything new. Four categories would need entries, and writing the reason is the
point — it is what converts "nobody got round to it" into a decision:

1. **A package's public API ahead of its consumer.** `@pa/netcode` in full,
   `PvpScreen`. One entry per package with the seam named.
2. **Test seams.** `resetM1BankCache`, `parseEnvFile`. Arguably these should
   just be non-exported or moved into the test.
3. **Priced proposals.** `M1_SECOND_BEAT_CHART`.
4. **The Tier 4 stumps** — which is the argument for deleting them first, so the
   allowlist starts at a few dozen entries rather than several hundred.

That ordering matters: **seed the allowlist after the Tier 4 deletion, not
before**, or the guard ships carrying two thousand lines of dead weight as
permanently-blessed exceptions and becomes a thing people add lines to.

### Recommendation

Feasible and worth doing, in this order:

1. Delete Tier 4 and correct `ARCHITECTURE.md` §1. Independent of everything
   else and it is what makes the rest tractable.
2. Ship rules (b) and (c) first. They are ~100 lines together, scoped to a named
   list of interfaces, and their false-positive rate is near zero because the
   scope is chosen rather than discovered. They target the highest-yield shape.
3. Ship rule (a) last, allowlist-seeded, with reasons printed on success.
4. Accept that the `hunt.ts` class is not preventable by lint, and treat "after
   wiring a system, measure that the number moved" as the standing rule — the
   same rule §6 of `ARCHITECTURE.md` already argues for from the refactoring
   side.
