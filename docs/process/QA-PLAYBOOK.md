# QA Playbook

Every verification suite and harness in the repo, with the exact command to run it
and what "green" means. Run these before claiming any change is done. Commands are
from the repo root unless noted.

The overarching gate for anything player-visible: **zero game errors, zero page
errors, zero failed HTTP asset requests, and zero WebGL errors** — plus, for
rendered scenes, the non-black pixel rule (below).

---

## 1. Workspace typechecks

```sh
pnpm typecheck            # -r across all workspaces (contracts, runtime, web, api, infra)
```

Per-package: `pnpm --filter @pa/contracts typecheck`, `@pa/runtime`, `@pa/web`,
`@pa/api`. Green = `tsc --noEmit` clean everywhere.

## 2. Runtime tests (deterministic game brain)

```sh
pnpm --filter @pa/runtime test          # node --import tsx --test test/*.test.ts
```

Covers the flow/gate/field/assessment logic: `cp1-gate`, `cp1-runtime`,
`field-core`, `field-learning`, `m3-field`, `gameplay-flow`, `choreography`,
`compound-mechanics`, `open-response`, `classifier-invariants`, `questionSelection`,
`dusk-boundary`, and the content artifact test. Also:

```sh
pnpm --filter @pa/runtime assessment:validate   # question-bank validator CLI
```

## 3. Web tests (world logic + collision/stealth/chase)

```sh
pnpm --filter @pa/web test              # node --import tsx --test src/world/__tests__/*.test.ts
```

Includes `collisionBroadPhase`, `collisionLos`, `collisionMotion`,
`cameraOwnership`, `chaseModel`, `chaseFieldGating`, `doorwayContract`,
`actorRegistry`, `actorRoutes`, `densityTraversalAdapter`, etc. These are the
determinism guards for movement/LOS/suspicion/chase math (no wall clock, no RNG).

## 4. Content validators

```sh
pnpm --filter @pa/runtime content:compile     # regenerate the generated artifact from content/boston/act1/
pnpm --filter @pa/runtime content:validate     # package validator + generated-hash check
```

`content:validate` runs `content/boston/act1/validate/validate-content.mjs`
(schema, allowlist, fiction-rule/no-em-dash checks) and the
`act1-content-artifact` test (the generated `*.generated.ts` hashes must match the
source package). Never hand-edit the generated artifact — regenerate it.

## 5. Browser QA harnesses (`assets/pipeline/qa_*.mjs`)

These drive a **running dev server** through dev-only QA hooks with Playwright and
validate rendered pixels. They never touch production UI or mutate save state.

Setup (both the installed Playwright and system Chrome are used):

```sh
# 1) start a dev server on the port the harness expects (see each harness header)
cd apps/web && node_modules/.bin/vite --port 5173
#    slice / CP1-draft harnesses need the draft bank:
cd apps/web && VITE_CP1_ALLOW_DRAFT_BANK=true node_modules/.bin/vite --port 5183

# 2) run a harness (from repo root)
PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-browsers \
  node --import tsx assets/pipeline/qa_m4_browser.mjs
```

Harnesses and their default URLs / report dirs:

| Harness | Default URL | Report dir |
|---|---|---|
| `qa_slice_browser.mjs` (vertical slice: CP1 gate, alive world, caught-chase) | `:5183` | `test-results/…` |
| `qa_m1_chase_browser.mjs` (stamina + chase) | `:5173` | `test-results/m1-*` |
| `qa_m2_watchers_browser.mjs` (watchers + suspicion + heat) | `:5173` | `test-results/m2-browser-qa` |
| `qa_m3_browser.mjs` (Standing + reactive world) | `:5183` | `test-results/m3-*` |
| `qa_m4_browser.mjs` (compound print, watch-house/roof/dog, B11 event) | `:5190` | `test-results/m4-browser-qa` |
| `qa_m5_browser.mjs` (micro tracking + CP1 debrief; runs vs. a preview build) | `:4177` | `test-results/m5-browser-qa` |
| `qa_interiors_browser.mjs` (36-interior tour, day/drizzle/dusk) | `:5173` | `assets/build/interior-browser-qa` |
| `qa_doors_browser.mjs` (doorway contract, closed/half/full, day/dusk) | `:5173` | `assets/build/door-browser-qa` |
| `qa_cognitive_learning_browser.mjs` | `:5183` | `test-results/…` |
| `qa_density_traversal.mjs`, `qa_locomotion.mjs`, `qa_mechanics_ui.mjs`, `qa_inspect_card.mjs`, `qa_mercer_repro.mjs` | see header | `test-results/…` |

Override URL/output with the per-harness env vars (e.g. `M4_QA_URL`, `M4_QA_OUT`,
`M2_QA_URL`, `M3_QA_URL`, `INTERIOR_QA_URL`, `DOOR_QA_URL`).

### GPU / ANGLE configuration

Harnesses launch Chrome with WebGL forced on:

- **Headless (CI-style):** `--use-angle=swiftshader --enable-unsafe-swiftshader`
- **Headed (local, e.g. `M4_QA_HEADED=1`):** `--use-angle=metal` (macOS Metal)
- Always: `--enable-webgl --ignore-gpu-blocklist --disable-dev-shm-usage`

### The non-black rule

Every captured scene screenshot must clear the luminance guard, otherwise the
harness throws "rendered black":

```
luminance.meanLuma >= 5  &&  luminance.nonBlackRatio >= 0.1
```

Reports (screenshots + a `report.json` with luminance, draw-call, and triangle
metrics) are written under `test-results/<suite>/` (or `assets/build/*-qa/` for the
interior/door tours). The `report.json` records zero game/page/HTTP-asset/network
failures.

## 6. Accessibility matrix

The rendered harnesses also validate the assist/accessibility paths: run them in
their alternate modes (e.g. `M4_QA_HIGH_CONTRAST=1`, reduced-motion URLs, and the
keyboard-only `KEYBOARD_MOUSE` scenario variants). Every stealth run and chase has
a preapproved assist equivalent (slower cones/pursuer, louder tells, auto-managed
stamina, or confirm-to-resolve with the same bounded outcome; full keyboard path).
Reduced-motion door/interior timings are exercised by the interiors and doors
tours.

## 7. Live grading benchmark (env-gated — NEVER in normal CI)

```sh
RUN_LIVE_GRADING_BENCHMARK=true \
TRUEFOUNDRY_GRADING_BENCHMARK_MODELS='comma,separated,discovered-models' \
pnpm --filter @pa/api grading:benchmark:live
```

Calls the live gateway; requires model discovery; emits only fixture IDs and
aggregate metrics (never student text, prompts, or credentials). See
[`../engine/Grading-Benchmark.md`](../engine/Grading-Benchmark.md). A content-probe
variant: `pnpm --filter @pa/api grading:probe:live`.

## 8. API tests

```sh
pnpm --filter @pa/api test              # auth, grading, assessment-memory, migration-shape (in-memory)
```

### Postgres suite (Docker)

```sh
pnpm db:up                              # docker compose up -d (Postgres)
pnpm db:migrate                         # apply migrations
pnpm --filter @pa/api test:postgres     # test/persistence.test.ts against real Postgres
```

## 9. Production build

```sh
pnpm build                              # packages typecheck/build
pnpm --filter @pa/web build             # vite production build of the presenter
```

---

## Definition of "green" for a change

1. `pnpm typecheck` clean.
2. Runtime + web + api test suites pass.
3. Content validator + generated-hash check pass (if content touched).
4. Relevant browser harness(es) pass with zero game/page/HTTP/WebGL errors and the
   non-black rule satisfied.
5. `pnpm --filter @pa/web build` succeeds.
6. Postgres suite passes when persistence is touched.
