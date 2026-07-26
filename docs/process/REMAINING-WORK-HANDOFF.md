# Remaining-Work Handoff Pack

This document lets any implementation worker finish the Boston-chapter polish program without reconstructing context. Each ticket is self-contained: read this header, then the ticket, then execute.

### Division of labor (default posture: ~99% Opus codes)

- **Claude Opus 4.8 writes essentially all code.** Every ticket below is implemented by Opus unless it is a proven Tier-3 task (see below).
- **GPT-5.6 Sol orchestrates only — it does not write code.** Sol's job is: triage each request's difficulty, reproduce/diagnose root cause when a bug is non-obvious, and hand Opus a precise, self-contained implementation brief (files, root cause, fix shape, gates). Sol then reviews Opus's result against the gate and bar.
- **Tier map (from the always-on subagent-router rule):**
  - Tier 1 — clear scope: Opus goes end-to-end, no Sol.
  - Tier 2 — non-obvious cause: Sol diagnoses + writes the brief, **Opus codes the fix.** This is the default for anything tricky.
  - Tier 3 — genuinely complex/cross-cutting where diagnosis and implementation can't be cleanly separated: Sol may implement. **Expected to be rare; none of Tickets B-G are pre-classified Tier 3.** Only escalate a ticket to "Sol codes" if an Opus attempt + a Sol diagnosis brief have both failed to land it.

So for every ticket the owner is Opus. Where a ticket previously said "GPT-5.6 Sol," read that as "Sol orchestrates/diagnoses; Opus implements."

---

## 0. Where things stand

- Repo: pnpm monorepo. Layout after the refactor:
  - `@pa/contracts` — protocol only (events, plans, saves, field/assessment state, RuntimeView). No `BOS.` literals.
  - `@pa/runtime` — deterministic event-sourced engine, chapter-agnostic, consumes a `ChapterDefinition`.
  - `@pa/engine-world` — generic React-Three world engine (collision/LOS, playerMotion/input, cameraOwnership, actor/interaction registries, chase/watcher/field kernels, quest markers, doorway/portal system, presentation arbitration, Sky/Weather/Water/Audio frameworks, InteriorDirector framework, QA hooks).
  - `@pa/chapter-boston` — Boston runtime content (day1 flow/text/tables/learning/mechanics/reactive/choreography, cp1, provenance, question banks incl. owner STAAR items, open-response content, Boston IDs/constants, `createDay1Session`, `BOSTON_1765_CHAPTER`).
  - `@pa/chapter-boston-world` — Boston world content (manifests/density/interiors/stealth/marker data, choreography data, document textures, set-piece directors, palettes, `BOSTON_1765_WORLD`).
  - `apps/web` — app shell, pages, Play wiring, single chapter registration point, `public/` assets, styles, QA bootstraps.
  - `apps/api` — Fastify + Postgres: auth, event-sourced save/replay via chapter registry, encrypted open-response grading (TrueFoundry `aws-bedrock/us.amazon.nova-micro-v1-0`, server-side only, production disabled without dedicated secret).
- Baseline pre-refactor tag: commit `5ddd390`. Program has since completed: docs consolidation, Wave 0 hygiene, monolith decomposition (Wave 1), exchange-engine unification (Wave 2), runtime/contracts chapter split (Wave 3), web engine/content split (Wave 4), Fix Wave 1 (all 11 P0s), Fix Wave 2 (all 22 P1s + interaction/readability/lighting pass), owner STAAR bank ingestion (production CP1 unblocked, 3 macros), Design Batch 1, and Design Batch 2 features.
- Authority docs: `ARCHITECTURE.md` (symptom -> owning-module bug map), `docs/process/CHAPTER-AUTHORING.md`, `docs/process/QA-PLAYBOOK.md`, `test-results/feel-audit-1/report.md` (46-defect audit), `test-results/feel-audit-1/fun-verdict.md` (8th-grader design bar).
- Frozen play preview for the user: isolated static copy of the latest green build served on `http://127.0.0.1:4177/`. Never kill/modify that process during work; refresh it only via the preview procedure (Ticket F) after a green wave.

## 1. Global invariants (every ticket must hold these)

1. Imported-visible-world law: every visible physical object/surface is an imported GLB/generated texture via the pipeline. No production primitive geometry. Invisible colliders/triggers, shaders, UI/DOM overlays are allowed.
2. Determinism: no live RNG in gameplay/assessment; seeded kernels only. The Wave-3 replay-parity fixtures must stay byte-identical; if a change legitimately alters the event sequence, bump `DAY1_FLOW_VERSION` (chapter constant) and record new fixtures deliberately.
3. Event-sourced saves: raw open-response text never enters `committedEvents`/saves/mastery/telemetry/logs. LLM classification is formative-only and never gates progression or mutates learner/world state.
4. Required macro learning is path-invariant and ungated; optional content (Threads, side jobs, challenges, micros, reflections) never blocks the spine and always has a continuation on failure.
5. Interaction: one glyph / one F action at a time via the interaction registry; no stacked prompts, orphan tags, or through-wall prompts; <=3 choices.
6. Accessibility parity for every interaction: keyboard, touch, high contrast, reduced motion, captions; OS `prefers-reduced-motion` respected. No pre-game calibration screen (settings live in pause).
7. Boundary lint must stay at zero findings: `@pa/engine-world`/`@pa/runtime`/`@pa/contracts` never import chapter/content or `BOS.` literals.
8. Behavior-preserving refactors preserve hook/effect/timer ordering.

## 2. Standard gate (run before every commit; a ticket is done only when green)

From repo root unless noted:
- Typecheck all packages (per `QA-PLAYBOOK.md`).
- Unit/integration: runtime, chapter-boston, engine-world, chapter-boston-world, web, api (+ Postgres suite when DB touched; start Docker if needed).
- Content + CP1/bank validators.
- Determinism replay-parity test (chapter-boston).
- Production build (`CI=true pnpm --filter @pa/web build`).
- `node scripts/check-boundaries.mjs` (zero findings).
- Browser QA for the affected systems using the proven ANGLE/Metal Playwright config with non-black luminance validation; screenshots must be READ, not just captured. Evidence under `test-results/<ticket>/`.
- `test-results/` is gitignored — stage commits BY PATH, never `git add -A`.

## 3. Judgment bar (the point of the whole program)

Every player-facing change is judged as a demanding 13-14-year-old playing voluntarily and a skeptical VC watching a demo — see `fun-verdict.md`. "Tests pass" is necessary, not sufficient. A screenshot with a floating object, orphan UI tag, unreadable text, dark interior, or confusing flow is a defect, not a nit.

---

## Ticket A — Close Design Batch 2 (IN PROGRESS; a GPT-5.6 Sol worker is mid-flight — the one temporary exception; do not restart)

Status: an active GPT-5.6 worker is resolving the single-continuous fresh-profile browser journey stall at initial spatial arrival. All five features (press mastery, stake tags/receipts, Ned wager, typeset reflection, runner map/compass) plus safe P2s are implemented and committed through `cb2b1b9`. Do not start Wave 5 until this continuous E2E gate is green (fresh profile -> Archive intake -> Mercer arrival -> B2 -> errands -> optional/typeset -> confrontation/chase -> effigy -> crier ending -> production CP1 -> Act complete, exercising all five features in one run). If that worker returns blocked, the fix belongs to whoever owns arrival/marker/portal telemetry; do not weaken the harness.

---

## Ticket B — Wave 5: deferred seams + QA consolidation (Opus codes; Sol diagnoses only if a seam swap misbehaves)

Goal: retire the last legacy paths and make regressions trivial to reproduce. Behavior-preserving except where a fix is a stated improvement.

Scope (re-derive exact files; audit line numbers are stale):
1. Legacy collision tuples -> tagged colliders. Replace `LegacyCollider [cx,cz,hx,hz]` float-equality identity (`tupleMatches`/`isLegacy*` in the outdoor collision adapter) and route/door-state-by-tuple-presence with tagged colliders (blocker tags `route:`/`placement:` already exist). Camera-boom occlusion and route/door gating read tags. Riskiest move — gate with `qa_m1` chase + `qa_doors` + collision suites, and the determinism replay.
2. Remove the old co-located `RoomDef`/`EXPLORE_LOCATIONS` interior path once doorway/threshold inputs are folded into `InteriorDef`/building data. Delete `EXPLORE_SPECIALS` room rects after doorwayContract consumes the new source.
3. Flow `world.attention.*` writes -> field events; then delete `syncLegacyFieldCompatibility` and the legacy heat/identity bridge. Preserve replay.
4. QA harness consolidation: single `qa/` dir + shared launcher (ANGLE/Metal flags, dev-server boot, output dir, Playwright from devDependencies not `/tmp`), `pnpm qa:browser [--suite <name>]`. Fix hardcoded `/tmp/pw-check` and machine-specific Chrome paths.
5. Primitive-geometry replacements flagged by the audit (CrowdBoard/StreetReadPost/CivicBillPost/carry-crate and any remaining `world/content/day1ReadStaging` primitives) via imported assets (asset factory can be an Opus sub-ticket); until imported assets land, render `null` rather than a primitive.

Gate: standard gate + full browser matrix (slice, m1, m2, m3, m4, interiors, doors, cognitive). Commit per seam.

---

## Ticket C — Asset factory sub-tickets for Ticket B.5 and P2 texture refinements (Opus 4.8)

For each missing imported visual (crowd board, street read post, civic bill post, carried crate, and any cobblestone/horizon/GLOOM texture refinement from the Fix-Wave-2 P2 list): run the pipeline (Gemini concept -> visual/historical QA -> Meshy -> Blender optimize -> verify/manifest -> sync), then hand the key to the Ticket B worker for placement. Use `/Applications/Blender.app/Contents/MacOS/Blender` and network permission. No procedural fallbacks. Deliver keys + manifest + integration notes; do not wire placement yourself if Ticket B is mid-flight on the same files.

---

## Ticket D — Chapter reproducibility proof (Opus codes)

Prove "make Philadelphia = content only." A synthetic-chapter unit test already runs the engine with zero Boston imports (added in Wave 3). Extend it to a minimal END-TO-END fixture chapter (a few rooms, 1-2 NPCs, 1 mechanic, a 3-macro CP with dummy owner-style items) registered through `ChapterDefinition` + the world registration point, booting in the web app with ZERO edits to `@pa/engine-world`/`@pa/runtime`/`@pa/contracts`. Acceptance: the fixture boots, is playable to its checkpoint in a browser smoke, and a boundary-lint/import check proves no engine package changed. This is a permanent guard, not a shipped city. Do NOT build a real second chapter.

---

## Ticket E — Polish loops (Opus codes every fix; Sol only triages the defect list + diagnoses non-obvious repros)

Repeat until convergence:
1. Full fresh-profile player-POV playthrough + free-roam sampling (wharf, both alleys, 4-6 interiors incl. church/tavern/warehouse, traversal, markers, day/dusk/drizzle), judged against `fun-verdict.md`. Produce a ranked P0/P1/P2 list with repro + screenshots (mirror the `feel-audit-1` format) under `test-results/feel-audit-N/`.
2. Fix all P0s, then all P1s (root cause, regression tests, browser-verified per repro). Isolated fixes may be delegated to Opus with a precise repro ticket.
3. Re-play. Loop ends only when a full playthrough finds zero P0/P1 and every system earns a positive voluntary-play verdict; remaining P2s must be deliberate, documented choices.
Also fold in any user-submitted screenshots/bugs against the live preview with repro priority.

---

## Ticket F — Refresh the frozen play preview (any worker, after a green wave)

1. `CI=true pnpm --filter @pa/web build`
2. `hash=$(git rev-parse --short HEAD); rm -rf /tmp/project-archive-preview-$hash && mkdir -p /tmp/project-archive-preview-$hash && cp -R apps/web/dist /tmp/project-archive-preview-$hash/dist`
3. Kill the old listener on 4177 (needs full permission), then serve: `apps/web/node_modules/.bin/vite preview /tmp/project-archive-preview-$hash --host 127.0.0.1 --port 4177`
4. Verify `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4177/` returns 200. Tell the user the exact URL and that it is frozen at the new commit.
Notes: `pnpm --filter @pa/web preview` triggers a deps-status auto-install that hangs headless — invoke the vite binary by absolute path on the copied dist instead. If workspace deps look stale, `CI=true pnpm install` first.

---

## Ticket G — Final regression, performance, program report (Opus codes/writes; Sol only diagnoses a perf regression if root cause is unclear)

Only after Tickets A-E are green:
1. Full regression: every package suite, Postgres, determinism replay, validators, production build, boundary lint, and the complete browser matrix incl. one continuous fresh-profile Day-1 run and a 36-interior tour.
2. Performance pass on the Chromebook-class profile: capture draw calls / visible triangles / FPS / frame-time at central town, market, wharf, east gate, and the effigy event; confirm no regression vs the Fix-Wave targets and interiors stay light. Fix any regression at root cause.
3. Program report vs baseline `5ddd390`: LOC/dead-code removed, package/dependency graph, test counts, feel-audit P0/P1 burn-down to zero, per-system voluntary-play verdicts, remaining documented P2s, and the reproducibility proof result. Save to `docs/process/PROGRAM-REPORT.md`.

---

## Routing summary (Opus does ~99% of the coding)

- **Opus 4.8 — writes all code:** Wave 5 seams (B), asset factory sub-tickets (C), reproducibility proof (D), every polish-loop fix (E), preview refreshes (F), final regression/perf/report (G), documentation.
- **GPT-5.6 Sol — orchestrates, does not code:** difficulty triage, root-cause diagnosis on non-obvious bugs, and authoring the precise Opus brief; then reviewing Opus output against the gate/bar. The only current exception is the in-flight Ticket A worker, which finishes as-is.
- **Escalate a ticket to "Sol codes" only** if an Opus attempt plus a Sol diagnosis brief have both failed to land the fix (true Tier 3). Expected to be rare.
- Every worker: obey Section 1 invariants, pass Section 2 gate, judge by Section 3 bar, commit by path with clear messages, leave the 4177 preview process alone.
