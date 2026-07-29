# CI and Browser Checks

What runs automatically, what does not yet, and how to run the browser harnesses
on a machine that has never run them. For the full list of suites and what
"green" means for each, see [`QA-PLAYBOOK.md`](./QA-PLAYBOOK.md); this file
covers only the harness around them.

---

## 1. CI

`.github/workflows/ci.yml`, on every pull request and every push to `main`.

| Job | Blocking | What it covers |
|---|---|---|
| `verify` | yes | boundary lint, content verification, `pnpm typecheck`, `pnpm test`, the three asset mesh-vs-authoring guards, packages build, web production build |
| `api-postgres` | yes | `@pa/api` persistence suite against a real `postgres:17-alpine` |
| `playthrough` | yes | opens the real client with Playwright against a running stack (Postgres + API + web) and plays the mission: world renders, route advances, every encounter arms **and** resolves, no penetration, yard reached, a climb refuses without a ladder and arms with one, the Liberty Elm crown is reached by climbing and its beat arms, duel loads a graded world and the grader runs on the real path |
| `lockfile` | **advisory** | `pnpm install --frozen-lockfile` |
| `api-image` | **advisory** | Dockerfile lint plus a real build of `apps/api/Dockerfile` |

A separate **nightly** workflow, `.github/workflows/grading-eval.yml`, runs the
*live-model* half of the classifier ship gate on a schedule (not per-PR). It is
described in [§1a](#1a-the-nightly-grading-eval-live-model) below.

CI pins **Node 24**, matching the API's production base image, rather than
tracking whatever is newest locally.

`verify` runs its steps with `if: ${{ !cancelled() }}`, so one failure does not
hide the rest — a red run reports everything that is broken in a single pass.

**Concurrency — do not cancel `main` runs.** The workflow's `concurrency` cancels
a superseded run **only for pull requests** (`cancel-in-progress:
${{ github.event_name == 'pull_request' }}`). It must stay that way. When it was
`cancel-in-progress: true` for every ref, pushing to `main` after each merge
cancelled the still-running CI for the previous merge, so during a burst of quick
merges **no run ever completed** and `main` carried no green evidence — the
played-mission gate never finished once. Cancelling a superseded run is right on a
PR branch (only the newest commit matters) and wrong on `main` (every merged commit
is a record that must be validated to completion). With cancellation off for
pushes, consecutive `main` pushes **queue** and each runs to the end.

### Content verification

`pnpm verify:content` runs the two content checkers — `content/m1/verify.mjs`
(under `tsx`, because it resolves `DUEL_ROUND_CEILING`, `LEARNING_MODULE_SECONDS`,
`CONCEPT_ID_PATTERN` and the module interfaces from their owning source rather
than scraping literals) and `content/capstone/boston-1765/verify.mjs` (plain
Node). They assert the invariants a build otherwise never catches: module length
and pacing, concept-id canonicality, stray keys against the player's interfaces,
the PvP pool composition against the round ceiling, and the capstone readiness
gate. Both read only local files — this content directory, `content/staar`, and
package source — so they need no build, no database, no network, and no
credentials. The step is placed near the front of `verify` so a broken invariant
fails in about a second rather than after the test suite.

### Migration checksums

Nothing in CI edits or re-checksums migrations. Two existing suites cover them,
and both self-adapt when a migration is added:

- `apps/api/test/migration-shape.test.ts` (in `verify`) re-hashes every
  `.sql` file in `apps/api/src/migrations` against `checksums.json` and fails if
  a migration was rewritten or is missing from the file. No database needed.
- The persistence suite (in `api-postgres`) applies every migration to a real
  Postgres twice and asserts each is applied exactly once, so a non-idempotent
  migration fails there.

### 1a. The nightly grading eval (live model)

`.github/workflows/grading-eval.yml` runs the classifier ship gate against a
**real model**, on a schedule, so it no longer depends on someone remembering to
type `pnpm grading:eval`. That gate previously sat at 3.4% false negatives for
weeks while appearing healthy, precisely because it ran only on demand and on
stale hand-labels. The offline structural half
(`packages/grading/src/__tests__/eval.test.ts`) still runs on **every PR** inside
`verify`'s `pnpm test` step — it guards the labels, the set's shape and the
harness arithmetic without a model call. This workflow is the other half.

It runs `pnpm grading:eval:gate` (defined in the root `package.json`, so the CI
run and a human's local run cannot drift), which is `grading:eval` with:

- **`--repeats 3`** — grade each case three times and take the majority, so a
  single temperature-zero per-case flip cannot decide the gate. Cost is linear:
  ~9–10 min at repeats=3 against ~3.3 min single.
- **`--concurrency 3`** — low, to stay off the gateway's rate limit.
- **`--timeout 20000`** — ~20 s per case. **The 1.5 s production cap is a *play*
  cap, not a *measurement* cap.** A player never stands still in a duel waiting on
  an API, so grading gets 1.5 s and then grants; a measurement has no such
  constraint, and adopting the play cap would measure timeouts instead of the
  model. This distinction is the reason the two numbers differ.

**The one secret the owner must add.** Add a repository secret under *Settings →
Secrets and variables → Actions → New repository secret*:

| Secret | Required | Value |
|---|---|---|
| `TRUEFOUNDRY_API_KEY` | **yes** | The TrueFoundry gateway key — the **same shared key the app uses** (the one already in `.env`). |
| `TRUEFOUNDRY_BASE_URL` | optional | Only if the gateway differs from the default `https://tfy.promptlens.trilogy.com/v1`. |

**One key, not two — the trade-off, recorded honestly.** This job originally
required a *dedicated* `TRUEFOUNDRY_GRADING_API_KEY` with its own quota. The
reasoning was contention: one measurement run had **299 of 313** calls fall back
while the owner was playing on the same key, and a run that mostly falls back
measures nothing. The owner's decision is to use **one key for everything**, and
it is sound because this job runs at **03:00 local (08:00 UTC)**, when he is not
playing — so the contention window essentially closes. What remains true, and is
the honest cost of one key: a **heavy nightly and a daytime manual run *can* still
contend**, and if they do, fallbacks rise. That is not a silent failure: the
harness **excludes fallbacks from the rates and fails the gate** when fewer than
90% of cases were actually classified (see "Timing sensitivity" below). So the
worst case of key contention is a **loud red run that says "this run does not
measure the grader,"** never a green run that quietly lied. That is the acceptable
failure mode, which is why one key is fine here.

The workflow feeds the shared key under its own name; `packages/grading/src/provider.ts`
reads `TRUEFOUNDRY_GRADING_API_KEY` first and falls back to `TRUEFOUNDRY_API_KEY`
when `NODE_ENV` is not `production` (unset in this job), so the shared key is what
grades. Production duel grading still uses its own Secrets-Manager credential — the
shared-key fallback is a dev/CI convenience the code gates on `NODE_ENV`.

**How the job behaves without the secret: it fails loudly, it does not skip.** A
skipped nightly is indistinguishable from a passing one on a dashboard, which is
the entire failure mode being removed. The first step checks the secret and, if it
is empty, emits a `::error::` naming exactly what to add and where, and exits
non-zero — a red run, never a green skip.

**Why nightly, not pre-release.** Recommended and built as nightly (with a
`workflow_dispatch` for an on-demand pre-release spot check). Nightly buys the one
thing no offline test and no pre-release-only run reliably gives: it catches drift
in the **model itself**. The provider is a hosted gateway model that can change
under us with no diff on our side; only a dated series of live runs surfaces that.
The dated report (below) makes each run a point on a trend. Pre-release is cheaper
and blocks at the moment that matters, but this repo has no release process or
tags to hang a "pre-release" trigger on, so a pre-release-only gate would be
decoration on a process that does not exist — and it would never see provider
drift between releases. The per-PR offline test already blocks label/shape/arith
regressions, which is the cheap thing pre-release would otherwise catch.

**What a failure actually signals to a human** — three signals, ordered by how
well they survive nobody watching:

1. **A committed dated report.** Every run, pass or fail, writes
   `docs/process/grading-eval/YYYY-MM-DD.json` (plus `latest.json`) and commits it
   with `[skip ci]`. The git history *is* the trend; a **gap in the dates** is
   proof the nightly stopped, which a green dashboard would otherwise hide. This is
   the signal that survives nobody watching, and it is why the report is committed
   rather than only uploaded.
2. **An issue.** On a gate failure the job opens (or comments on a rolling) GitHub
   issue labelled `grading-eval`, with the gate reasons and the run URL, using the
   auto-provided `GITHUB_TOKEN` — no extra secret. A nightly that fails at 3 a.m.
   and pings nobody is decoration.
3. **A red run + artifact.** The job exits non-zero and uploads the report as an
   artifact, matching the `playthrough` precedent. Artifacts expire, so this is the
   backstop, not the trend.

The committed-report signal depends on the Actions bot being allowed to push to
the branch (`contents: write`, and no branch protection blocking it). If a push is
blocked the job warns rather than failing, and the issue + red run + artifact still
fire — so a blocked push degrades the trend but never masks a real failure.

**Timing sensitivity.** The `playthrough` gate's driven stages used to be
wall-clock-sensitive (a slow renderer under-progressed the sim inside a fixed
second budget); that is fixed — they now budget in SIM TICKS (see "The played-mission
gate" below). This job is simpler still: it has **no real-time simulation stage**.
Each case is an independent
model call bounded by its own ~20 s deadline, so there is no accumulating timing
drift. Two couplings remain, both handled: (a) the **job wall-clock** — a slow,
noisy runner plus a serialising gateway can stretch the ~10 min run, so
`timeout-minutes` is a generous **30** rather than a tight cap that would red-flag
an honest slow night; and (b) **per-case fallbacks** — a degraded gateway makes
cases fall back, but the harness **excludes** fallbacks from the rates and **fails
the gate** when fewer than 90% of cases were actually classified. So a gateway
outage is a loud fail ("this run does not measure the grader"), never a false pass.

**Unverified from here — read this before trusting a green workflow file.**
Nothing in this environment can confirm that this workflow actually runs in a real
GitHub Actions runner, because `gh` is unauthenticated locally: the YAML has not
been executed, the secret does not exist yet, and no run has been observed. A
committed, well-formed workflow file is **not** evidence of a working nightly. The
`playthrough` gate is already blocking on this same unverified basis (see §8 of
`M1-DONE.md`). The honest confirmation is the first real run — or, tellingly, the
first missing date in `docs/process/grading-eval/`. Until then, treat this as
wired-but-unconfirmed.

### 1b. The merge gate (`scripts/merge-gate.mjs`)

The tool that removes the orchestrator's discretion (`M1-DONE.md` §8). One command
runs **every** blocking gate and exits non-zero the moment one fails, so a merge
can be made conditional on it instead of on a judgement call:

```sh
pnpm gate                 # or: node scripts/merge-gate.mjs
pnpm gate:static          # static gates only, no playthrough
node scripts/merge-gate.mjs --playthrough-only   # just the played-mission gate
node scripts/merge-gate.mjs --all                 # force the playthrough
node scripts/merge-gate.mjs --playthrough-base http://127.0.0.1:5273  # reuse a stack
```

It covers `lint`, `typecheck`, `test`, `build`, `verify:content`, the three
`assets:verify:*` (with the affordance debt list held-or-shrunk), and
`check-playthrough`.

**Where the enforcement can honestly live.** A git hook is the obvious idea and the
wrong one: `git merge` **fast-forwards run no hook at all** (the orchestrator's lane
merges routinely are fast-forwards), `pre-merge-commit` fires only for a true merge
commit and is skipped by `--no-verify`, and hooks do not travel through a clone. A
hook that fires on some merges but not others feels like protection and is not. So
**local enforcement can only ever be a convention plus a loud, single tool** — this
is that tool. The **only** place discretion is genuinely removed is **CI as a
required status check** once `main` is pushed and branch protection is on; the
`verify`, `api-postgres` and `playthrough` jobs already run this same set.
`--install-hooks` adds a best-effort `pre-push` hook, honestly labelled bypassable —
note that in a worktree it writes to the **shared** git common dir, so it affects
the main checkout and every worktree at once.

**Runtime, and what it justifiably skips.** The static gates run in **parallel**
(~200 s wall on a dev box, `test`-bound; ~260 s if run serially), each gate's output
buffered and replayed only on failure. The playthrough is **~118 s** (a provisioned
throwaway stack plus the ~115 s check) and runs **after** the static gates
deliberately — its long free-run ROUTE stage is wall-clock-sensitive and would stall
on a CPU-saturated host, so it must not overlap them. The playthrough is **skipped,
justifiably, when the change cannot affect play**: a change confined to docs, CI,
`scripts/`, `assets/pipeline/`, published assets under `apps/web/public/`, or test
files cannot alter the route/refusal/beat/duel verdicts (those read authored hulls
and nodes an asset swap does not touch), and asset integrity is already covered more
precisely by `assets:verify:*` + the lint texture/scale checks. Anything touching
app/package source, `content/`, `apps/api/src` or dependency config runs it. The
scope is decided from `git diff <base>...HEAD` (base defaults to `main`); `--all`
forces it, `--no-playthrough` skips it.

**The playthrough stack.** With no `--playthrough-base`, the tool provisions its own
isolated stack — a throwaway `postgres:17-alpine` container on port **55433** (its
own, so it never touches the owner's dev DB on 55432), migrations applied, the API on
**3099** and the web dev server on **5399** with `WEB_ORIGIN` pinned to the web
origin — mirroring the CI `playthrough` job, then tears it all down (container
removed, servers killed) on exit or Ctrl-C. It needs Docker and a Playwright
Chromium (`pnpm playwright:install`); if Docker is absent it says so and points at
`--playthrough-base`.

**pnpm's dependency check — handled up front.** On pnpm 11 the
`verify-deps-before-run=false` line in `.npmrc` is **inert** (pnpm 11 reads
`verifyDepsBeforeRun` from `pnpm-workspace.yaml`, which is unset), so a `pnpm -r`
script on a **drifted** tree tries to repair `node_modules` mid-run and can prompt to
purge it — a hang or failure with no TTY. The gate defends against this by running
`pnpm install --frozen-lockfile` as its first preflight. A frozen install **never
purges** — it confirms the tree matches the lockfile (so no later step will try to
repair) or it fails read-only, at which point the tool **stops and prints how to
reconcile** `pnpm-lock.yaml` (a contested file it will not touch) rather than letting
a mid-run purge happen. As of this writing the lockfile is in sync
(`--frozen-lockfile` succeeds), so the preflight passes cleanly; the guard matters the
next time a dependency moves.

### The played-mission gate (`playthrough`)

`scripts/check-playthrough.mjs`, run by the `playthrough` job, is the only gate
that opens the game and plays it. Everything else in CI reads source, authored
data, collision hulls or mesh geometry; not one of them mounts the client. That
gap is not theoretical — three regressions in a single morning (a duel harness
rendering into an empty void, an encounter that armed but could never resolve, and
props rendering as untextured white boxes) each passed lint, typecheck, 2,712
tests, a build and four world verifiers while the mission was visibly broken. This
gate drives the real client with Playwright and asserts, each failing loudly by
name with no continue-on-error and no degrade-to-warning:

- **WORLD** — the scene renders: draw calls and triangles in a sane band, textures
  present, and **zero** untextured near-white "white-box" props (read off
  `renderer.info` and a material census, not pixels).
- **ROUTE** — a driven run advances east through the street and every mandatory
  encounter **arms *and* resolves** within a timeout that fails rather than hangs
  (arming alone is the soft-lock signature), with no body ever inside solid hull.
- **YARD** — a driven run reaches the rope-walk yard, the route's end line.
- **REFUSAL** — "no ladder, no climb", exercised in real play. At the foot of the
  authored scaffold ladder (route node `C_SCAFF_FOOT`, the `SCAFFOLD_D1` climb
  volume) a driven climb **arms**; with every ladder and grip stripped from the
  live collision world the **same** climb volume **refuses** — nothing offered,
  nothing performed. A controlled A/B whose only difference is the affordance, so
  it isolates the refusal predicate itself. It reads observable behaviour
  (`previewVerb` / `motion.phase` / `flow.verb` / `verbsUsed`), never the probe
  internals, because the engine lane is actively editing `parkour/probe.ts`. This
  is the runtime half of the fix the floating-ladder / climb-through bugs needed —
  the one check here that would have caught that shipped class.
- **BEAT** — the Liberty Elm crown is **reached by climbing**, not assumed by
  spawning on the bough (which is exactly what `missionBeat.test.ts` does). A
  drop-in on the low bough (`F_LOW`) climbs the authored elm grip to the crown
  (`F_CROWN`) and the posting beat **arms** from where the climb arrives —
  reachability against the widened stance (2.4 m, ±135°), not the old tight values.
- **DUEL** — `verdict=live` loads a real arena (not the void), a graded answer
  discriminates right from wrong (a correct answer pays more balls than a wrong
  one), **and the grader ran on the real path**: a real answer submitted on the
  live attempt advances the API's own grading window on `/v1/health`
  (`roundsInWindow` / `gradeableInWindow`), which a client-minted fallback the
  server never saw could not do. This is the wiring "grading never ran in play"
  broke, and asserting "a verdict appeared" would not have caught it.

**Why its own job, not a step in `verify`.** `verify` is deliberately the
database-free, browser-free gate that goes green in seconds; a Postgres service, a
browser and two long-lived servers do not belong in it. The `api-postgres` job is
the existing precedent for a service-backed job, so `playthrough` follows it: its
own `postgres:17-alpine` service, migrations applied before the API starts, the API
and the web dev server backgrounded (each waited on a real readiness signal — the
API on `/v1/health` reporting `database:true`, the web on a 200 — not a fixed
sleep), then the check. No `pnpm build` step is needed because every `@pa/*` package
exports `./src/*.ts`, so vite and tsx run straight from source; that is also why the
job is immune to the `packages/*/dist` `EPERM` a sandboxed build can throw.

**The origin requirement, and why the ports are not the defaults.** The duel's live
attempt is a CSRF-protected mutation. The API compares the request's `Origin` header
against its `WEB_ORIGIN` and refuses with `CSRF_INVALID` on any mismatch; the web dev
server proxies `/v1` and `/api` to the API but forwards the browser's real `Origin`,
so **`WEB_ORIGIN` must equal the web origin exactly, host and port included.** On the
default port the API's default (`http://localhost:5173`) happens to match, so the
trap is invisible there; on any other port the duel stage silently reports "could not
open a gradeable attempt", which reads exactly like broken attempt machinery. CI runs
on non-default ports (web `5273`, API `3011`) with `WEB_ORIGIN` pinned to the web
origin — this both fixes it and keeps the origin path exercised, so a regression in
the origin handling fails the gate instead of hiding behind a matching default. The
check itself now also **detects this specific refusal**: it watches the API's
responses and, if the live attempt fails after a `CSRF_INVALID`, says "ORIGIN
MISMATCH … start the API with `WEB_ORIGIN=<the base URL>`" rather than leaving it to
look like a code bug.

**On failure it leaves the frame.** A browser gate that fails opaquely gets
disabled, so the job uploads `.affordwork/playthrough-out/` as an artifact on
failure — `world-spawn.png`, `duel-live.png` (or `duel-live-fail.png`), and the
`route.json` / `world-census.json` / `duel-grading.json` the check writes. This is
the first CI job to upload an artifact; there was no prior pattern to match.

**The measure is SIM TICKS, not wall-clock — this is what makes it
machine-independent.** The mission and duel sims run at a fixed 60 Hz
(`FIELD_TICK_HZ`); the body's motion is a deterministic function of the fixed
STEPS that executed, not of how long they took. Each render frame,
`advanceFieldClock` runs at most `MAX_CATCHUP_STEPS` (5) and **discards** the rest
(`diag.ts`: "a dropped step is sim time DISCARDED … slow motion"), so on a GPU-less
runner the render loop is slow and the sim runs in heavy slow-motion — measured on
this harness, a full-scenery run drops ~⅔ of its steps and advances ~1.5 sim-ticks
per wall-second, a bare run ~24. A wall-clock budget ("reach x=60 in 95 s") therefore
measures the RENDERER, which is exactly why a cold/loaded/headless run
under-progressed and tripped a threshold a warm run cleared. Every budget in the
driven stages is now counted in **sim ticks** (`window.__floor.ticks`,
`window.__duel.getState().clock.tick`): a slow runner just takes more wall-clock to
accrue the same ticks, and clears the same thresholds. Wall-clock survives in one
place only — `SIM_DEAD_WALL_S` (45 s), a liveness watchdog that fails when the sim
is not ticking AT ALL (a hung/crashed page), never on how far it got.

**Two supporting changes keep the wall-clock cost bounded and the run reliable:**

- **The driven stages run in BARE mode** (`?bare=1`). The collision world, route,
  encounters, ladders/grips, beat and field are authored data, unchanged by scenery
  (`devEntry.tsx`: "the run is unchanged — this only stops the level's art loading"),
  and `window.__diag` penetration is dev-gated, not scenery-gated — so a bare drive
  reads the same authored verdicts ~16× faster, keeping the sim-tick budgets within
  a sane wall-clock even on a software rasteriser. WORLD keeps scenery: it IS the
  render census, and it now waits for the texture count to STABILISE (the scene has
  finished loading) rather than a fixed 8 s, so a slow loader is not censused half-loaded.
- **The ROUTE/YARD bots un-stick themselves.** The held-W + aim-at-waypoint +
  jump-on-preview bot follows the guided line but is not a skilled parkour player;
  when the sim runs slow the tick a press lands on shifts, and at a chained
  climb/vault/leap the bot can wedge — the transient the sibling lane saw as
  "stalled at x≈29, cleared on re-run". When the body makes no ground for
  `UNSTICK_AFTER_TICKS`, the driver rotates its aim off the waypoint line and jumps,
  cycling directions, exactly as a player wiggles free.

**How it still catches a real stall — the whole point of the gate.** Three signals,
distinguished by construction, so a slow runner is never confused with a stuck body:

- **slow runner** — `ticks` advance (fewer per wall-second) and the body ADVANCES
  per tick → PASS. Slowness alone cannot fail a tick-relative budget.
- **real stall** — a genuinely wedged body makes no ground for `stallTicks` (1500)
  EXECUTED ticks *despite* the un-stick nudges (a nudge cannot conjure an affordance
  that is not there, so a real block does not yield), or an encounter sits
  armed-but-unresolved past `encArmTimeoutTicks` (1800) — the PAST-DAWN soft-lock,
  which drains in exactly these sim-tick units → FAIL. The un-stick fires only while
  free-running, so it never touches an encounter.
- **dead sim** — `ticks` stop advancing at all (page hung/crashed) → caught by
  `SIM_DEAD_WALL_S`.

**Proven both ways.** On a deliberately starved renderer (`PLAYTHROUGH_SOFTWARE_GL=1`,
the CI SwiftShader rasteriser) the whole gate is **ALL PASS** — ROUTE reaches x=75
with both stops resolved in ~4,250 sim ticks (~71 s of sim; 2 un-stick nudges,
worst stall 280 t), every other stage green — where the wall-clock version failed 8
checks. And it still FAILS on a genuine stall: an unanswered encounter fails "no
encounter soft-lock" at 1801 armed-but-unresolved ticks, and a body pinned mid-route
fails "no stall before the stops resolve" at 1505 ticks **despite 16 un-stick nudges**
(the wedge cannot be nudged free, unlike the transient that cleared in 2). The
repro knobs `PLAYTHROUGH_SOFTWARE_GL=1` and `PLAYTHROUGH_CPU_THROTTLE=<n>` (default
off; the shipped gate and CI are unchanged) recreate the starved renderer so that
proof is repeatable.

**Runtime.** ~110 s on a GPU-ish dev box (unchanged from before); ~6 min under
forced software WebGL on a loaded laptop. It now scales with the runner (it waits
to accrue sim ticks) rather than racing a fixed budget, so wall-clock varies with
the rasteriser. Per-stage wall-clock is logged each run (`stage wall-clock: …`),
which is how you localise a slow run. Two measured points:

| stage | GPU dev box | forced software WebGL (loaded laptop) |
|---|---|---|
| world  |  9 s | **57 s** (loads the full 174-texture scene for the census) |
| route  | 42 s | **135 s** (the long free-run to both stops) |
| yard   |  4 s |   8 s |
| refusal| 13 s |  20 s |
| beat   |  4 s |   6 s |
| duel   | 36 s | **141 s** (three arena renders through the 10 s FACE_OFF) |
| total  | **~110 s** | **~367 s** |

Two things follow. First, **WORLD is not the cheap stage on a GPU-less runner** —
its 57 s is scene *load*, not the census. Second, the cost is dominated by ROUTE
and DUEL (≈75 %), which are inherent (the mission is that long; each duel has a
fixed 10 s FACE_OFF ×3), not per-frame render cost — so the render-cost levers
below barely move the total on a fast CPU, though they may help a weaker one.

**`timeout-minutes` is 50, deliberately generous, to LEARN the real CI figure.**
The first tick-relative run on a real GitHub runner **hit the old 20 m cap and was
cancelled mid-gate** (provisioning clean; it just didn't finish), so 20 was a
*censoring* cap, not a measurement — a GitHub SwiftShader runner is slower than the
~6 min this took under forced software WebGL on a laptop. Read the true total off
the next completed run's `stage wall-clock` line, then set the cap to ~2× it. **Do
not shrink the tick budgets to fit a cap** — that tests less of the route, which is
where the defects were.

**Placement (recommendation).** Keep it **per-push and blocking**, with the
generous cap. This repo has one developer and no PR queue, so a 20–30 min gate
blocks nobody, and the two expensive stages (ROUTE, DUEL) are *exactly* the ones
that catch the class that reached the owner — the encounter soft-lock (ROUTE) and
the duel void / grader-wiring (DUEL). Deferring them to a nightly reintroduces the
up-to-a-day window on `main` that the gate was promoted to close. A fast/slow
**split is technically clean** — every stage opens its own page against the shared
stack and shares no in-process state, so any subset can be its own job — but do not
split by "fast per-push, slow nightly": the slow half is the high-value half, and
WORLD (the supposed cheap half) is itself 57 s on CI. If wall-clock ever does bite,
split for *parallelism* (all stages per-push, in parallel jobs), at the cost of
provisioning each — not by deferring coverage.

**Render-cost levers (applied, honest effect).** The driven stages and the duel
discrimination runs assert SIM STATE, never pixels, so they run on a smaller canvas
and with shadows disabled (`lightenRender`) — a cheaper *renderer*, not a weaker
*test* (the sim is headless of rendering, fixed-step and deterministic). In
isolation that is ~+40 % sim-ticks/second under software WebGL; on the full run it
is within noise here, because the total is bound by inherent sim length and scene
load, not shading. The pixel-reading stages — WORLD's census and the DUEL void
check — keep the full 1280×800 and their shadows. The one change that *would* cut
ROUTE/DUEL materially (a lighter duel arena, or skipping the FACE_OFF intro in the
harness) is app-side and out of this lane; flagged, not hacked.

Informational figures that feed no threshold still jitter harmlessly (the positive
climb's `maxY`, the beat `maxY` in the 8.0–8.3 m crown band, the exact
draw-call/triangle counts).

**Each added check has been shown to FAIL on a broken state** (a check nobody has
seen fail is not a check): removing the ladder in the positive refusal run drops
`climbArmed` to false; leaving the ladder in place in the negative run makes the
climb happen where it must refuse (the exact neutered-refusal symptom); skipping
the climb in **BEAT** fails "reached by climbing"; shrinking the beat stance fails
"the beat arms from where the climb arrives"; and suppressing the live submit
leaves the grading window flat and fails "the grader ran on the real duel path".

#### What this gate CANNOT see

A green `playthrough` does **not** mean the game is correct. The check reads hull
penetration, a render census, encounter and beat state, climb affordances, route
progress and the API's grading counters — so it is still blind to a real class of
defects, and anyone reading a green run should not conclude otherwise:

- **Climbing through *drawn* geometry when an affordance IS present.** It reads the
  collision hull penetration ring, and the collision column is legitimately empty in
  places where the visible mesh is not; a body can pass through geometry that is
  drawn but not collidable and this gate sees nothing wrong. (What *is* now covered
  in play: that a climb-volume with **no** ladder or grip refuses — see REFUSAL.)
  The mesh-vs-collision agreement is the job of `assets:verify:collision`, not this.
- **Whether animations put hands on holds.** It never inspects rig poses. A climb
  can complete with the hands nowhere near the hold and the gate still passes; that
  is `scripts/check-clip-fidelity.mjs`'s domain.
- **Bare-wall climbs.** A separate audit measured eight climbs against blank wall
  (surfaces with no authored affordance). This gate does not evaluate whether a
  climbed surface *presents* the affordance it was authored against — that is
  `assets:verify:affordances` and its `KNOWN_DEBT` list.
- **The terminal skill beat's RESOLUTION.** BEAT now proves the crown is reached by
  climbing and the posting beat **arms** there; what it still does not play is the
  flare-timing skill beat to `RESOLVED` and the bough dismount, because a bot that
  reliably executes that skill beat would itself be a flaky dependency. Full
  `REACHED_DUEL` completion is covered at the data level by mission-m1's
  route/traversability tests, not here.
- **A real model classification.** DUEL now proves the grader ran on the real duel
  path (the server recorded a gradeable round), but not that a *model* graded it:
  CI runs with no classifier credential (`configured:false`, status `UNGRADED`), so
  `classifiedInWindow` cannot move and every round falls back to the max grant.
  Asserting a real classification would need a live model call — a flaky, paid,
  external dependency this gate refuses to take on. That the round reached the
  server pipeline is the honest, deterministic proof available; the model itself is
  covered by `apps/api/src/duels/verifyLive.ts` (run deliberately, with a key).

**What closed, and why the list is shorter.** Three properties this gate used to be
blind to are now covered: the climb refusal ("no ladder, no climb") holds in real
play, the elm crown is reachable by climbing (not merely assumed by a spawn), and
the grader genuinely runs on the live duel path (not a client-minted verdict). Each
was a **runtime, cross-system** property — the exact category a unit suite cannot
reach — and each was proven both to pass on the shipped world and to fail on a
deliberately broken one. This gate proves the mission *renders and can be driven end
to end with its encounters resolving, its climbs honestly gated, its elm reachable
and its duel gradeable by the server*. It still does not prove the climbing reads
right, the hands land, every surface is honest, or a model actually scored the
answer. Those have their own gates; keep reading them.

### Mutation testing (Stryker) — assessed with numbers, and recommended against as a gate

The played-mission checks above exist because a **manual** mutation hunt found real
gaps in one pass (neutering the climb refusal left 496/496 engine-world and 234/234
mission-m1 tests green, and two more of the same shape). That the hunt was manual
raises a fair question: should mutation testing be a standing, repeatable capability?
[Stryker](https://stryker-mutator.io) is the usual TypeScript answer. This is the
assessment, with measured costs. **The recommendation is: worth an occasional,
scoped, on-demand run as a discovery aid — not a CI gate, and not a substitute for
the runtime checks above.**

**Could it run scoped to the load-bearing packages?** Yes. Stryker's `mutate` globs
can scope to exactly the files that matter — `engine-world/src/collision.ts` and
`parkour/*`, `contracts`, `grading`, `duel` — rather than the whole monorepo, and
you would run it per-package because each needs its own test command.

**What would that cost?** The blocker is the runner. This repo tests with Node's
built-in `node --test`, and Stryker has **no official `node:test` runner** — support
is an open, unmerged PR ([stryker-js#6020](https://github.com/stryker-mutator/stryker-js/pull/6020),
opened 2026-06, itself a Claude-authored PoC). Until it lands you use the **command
runner**, which by design does **no coverage analysis**: it cannot tell which tests
cover which mutant, so it re-runs the *entire package suite for every mutant*. That
turns the per-package suite time into the per-mutant cost. Measured suite times and
source sizes for the scoped set:

| package (scope) | src LOC | suite time | est. mutants (~1/4 LOC) | serial CPU cost |
|---|---|---|---|---|
| engine-world (`collision.ts` + `parkour/*`) | 7,546 | 10.0 s | ~1,900 | ~5.3 h |
| duel | 6,171 | 27.0 s | ~1,540 | ~11.6 h |
| grading | 4,468 | 1.65 s | ~1,120 | ~31 min |
| contracts | 3,262 | 1.2 s | ~815 | ~16 min |
| **scoped total** | **21,447** | — | **~5,400** | **~17.6 CPU-hours** |

So one scoped run is on the order of **~17 CPU-hours — roughly 370× the ~170 s test
suite** — dominated by the two slow suites (`duel` at 27 s and `engine-world` at 10 s
re-run thousands of times). With Stryker's parallelism that is ~2–4.5 h wall-clock on
a typical 8-core runner; the mutant count is an estimate (the true figure needs a dry
run) but the order of magnitude is not sensitive to it. A supported runner with
`coverageAnalysis: "perTest"` — which only runs the handful of tests covering each
mutant and skips uncovered ones — would cut this by roughly 10–50×, into the tens of
minutes; but that requires migrating 14 packages off `node --test` (large, invasive)
or waiting for the `node:test` PR to merge and stabilise.

**Viable in CI?** Not as a per-PR blocking gate — hours per run against a ~170 s
suite and a ~115 s playthrough budget is a non-starter, and it would be the flaky,
slow gate the whole playthrough philosophy warns against. At best it is a **periodic
(nightly/weekly) or on-demand** job, and realistically an on-demand, single-file run
(`stryker run --mutate packages/engine-world/src/collision.ts`) that someone triggers
when they touch a load-bearing predicate — minutes-to-tens-of-minutes at that scope.

**Would it have caught the refusal gap — the most important finding?** Partly, and the
honest nuance matters more than the yes. Stryker mutating `probe.ts` **would** generate
mutants equivalent to neutering the refusal (a conditional forced false, the guard's
`return null` removed, `=== null` flipped), and because the manual hunt *proved* the
unit tests stay green under exactly that change, those mutants would **survive and be
reported**. In that narrow sense: yes, Stryker would have surfaced the refusal
predicate as under-tested. But three caveats are the real answer:

1. **It would drown the signal.** `probe.ts`/`collision.ts` are full of branches
   intentionally exercised only in play (dev diagnostics, defensive guards, geometry
   edge cases). A scoped run yields dozens-to-hundreds of survivors; the refusal one
   is a needle a human must find in that haystack. Stryker points at the haystack.
2. **Its notion of "fixed" is the fix that misses the bug.** Stryker is satisfied when
   a mutant is *killed by any test*. A one-line unit test on the isolated predicate
   kills it and raises the score — but that is precisely the isolated test the manual
   hunt showed does **not** protect the runtime property (a body climbing through in
   the real client). Stryker cannot distinguish "predicate is unit-tested" from
   "the property holds in play"; it would mark the gap closed the moment a green unit
   test exists, while the owner-facing bug could still ship.
3. **It is blind to the other two gaps entirely.** The grader-wiring gap ("classifier
   never invoked on the real duel path") and the beat-reachability gap ("crown assumed
   reachable") live at the browser+API integration boundary that no unit test touches.
   Stryker mutating that code produces `NoCoverage` mutants — never even executed,
   indistinguishable from dead code — so it says nothing about them.

The through-line: the manual hunt's most valuable finding was that these are
**runtime, cross-system** properties a unit suite structurally cannot protect — and a
unit-mutation score is exactly the wrong instrument to tell you that, because a green
score is satisfied by unit tests. **Recommendation:** keep mutation testing in the
toolbox as an occasional, scoped, on-demand *discovery* run over the pure-logic
packages (`collision`, `parkour`, `grading`, `contracts`) to surface under-tested
predicates like the refusal one; do **not** wire it into CI, and do **not** read a
high mutation score as evidence the game is correct — the playthrough gate remains the
only instrument for the runtime properties, which is why the work went there.

### Why two jobs are still advisory

The original reason — `pnpm-lock.yaml` describing fewer projects than the
workspace — is **resolved**: the lockfile now lists every one of the 17
workspace importers (`.`, `apps/api`, `apps/web`, `infra`, and the 13
`packages/*`), so the "fewer projects" blocker no longer holds. See the closed
entry in §4.

What has **not** happened yet is the CI switch. `.github/workflows/ci.yml` still:

- installs `verify` / `api-postgres` with `--no-frozen-lockfile`, so CI can
  still resolve versions the lockfile does not pin, and
- keeps `lockfile` and `api-image` on `continue-on-error: true`, so neither
  blocks unrelated work.

So these two jobs remain advisory by configuration, not because a frozen install
is known to be impossible. The remaining step — done on a quiet tree, and only
after confirming a clean `pnpm install --frozen-lockfile` (not run here) — is to
drop `continue-on-error` from both jobs and switch the two installs to
`--frozen-lockfile`. `api-image` matters independently: the Dockerfile installs
`--frozen-lockfile` on purpose, because a production image that resolves
different versions than CI is not a reproducible artifact. That switch is what
makes CI reproducible.

---

## 2. Browser checks

Playwright is a repo dev dependency (`playwright` at the root, pinned to the
version the harnesses were validated against). Browsers are **not** downloaded
by `pnpm install`: pnpm gates dependency lifecycle scripts and only `esbuild` is
allow-listed, so fetch the browser explicitly, once per machine:

```sh
pnpm install
pnpm playwright:install        # chromium into the default per-user cache
```

Then run a harness against a dev server, per
[`QA-PLAYBOOK.md` §5](./QA-PLAYBOOK.md):

```sh
# terminal 1 - dev server on the port the harness header names
cd apps/web && node_modules/.bin/vite --port 5173

# terminal 2 - from the repo root
node --import tsx assets/pipeline/qa_m4_browser.mjs
```

No `PLAYWRIGHT_BROWSERS_PATH` is needed; `playwright install` uses a persistent
per-user cache, unlike the `/tmp` paths in older instructions.

### Not reproducible yet

27 files under `assets/pipeline/`, including every `qa_*.mjs` harness, still
resolve Playwright by absolute path:

```js
import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";
```

So they run only on a machine where someone hand-installed Playwright into that
exact directory. The root dependency above makes the fix available; applying it
is Ticket B.4 in
[`REMAINING-WORK-HANDOFF.md`](./REMAINING-WORK-HANDOFF.md), which consolidates
the harnesses behind one launcher. The change is one line per file:

```js
import { chromium } from "playwright";
```

Until then, a stopgap that makes the existing harnesses resolve the repo's
Playwright on a machine that does not already have that directory. Run it from
the repo root; it leaves an existing hand-installed `/tmp/pw-check` alone rather
than replacing the only Playwright some machines have:

```sh
[ -e /tmp/pw-check/node_modules ] \
  || { mkdir -p /tmp/pw-check && ln -s "$PWD/node_modules" /tmp/pw-check/node_modules; }
```

There is now **one** CI browser gate: the `playthrough` job (see §1). It sidesteps
the `/tmp/pw-check` problem above by not being one of those harnesses — it imports
`playwright` normally and installs the browser with `pnpm exec playwright install
--with-deps chromium` — and it renders in CI only because the world GLBs it needs
are all tracked: every one of the files the web serves from `apps/web/public/world`
is in the repository, so a fresh checkout renders the same scene the census expects.
The 27 `assets/pipeline/qa_*.mjs` harnesses are still **not** wired into CI; they
await the `/tmp/pw-check` import fix (Ticket B.4). A missing production asset noted
below is not a reason those cannot run so much as a defect the `playthrough` gate
would itself catch, loudly, as a collapsed render census.

---

## 3. World assets in git

`apps/web/public/world` is now **admitted by default** rather than denied with a
per-asset `!` allow-list. The old pattern silently excluded every newly generated
asset until a human added a line for it, and 88 files (142 MB) had accumulated
behind it — including 13 of the 15 rigged characters and the animation library.
Nothing catches that: a missing GLB renders nothing and no test fails.

Of those 88, 25 (34.7 MB) are referenced by surviving code and are now tracked.
The rest are left untracked on purpose because they belong to the Boston world
being deleted, so they appear in `git status` until that deletion removes them
from disk. Stage assets by path; never `git add -A`.

### Whether this should be Git LFS

Probably yes, but only as part of one planned history rewrite — not on its own.
The numbers, for whoever decides:

| | |
|---|---|
| `.git` today | 859 MB |
| History attributable to `test-results/` | 439.8 MB (committed before it was ignored) |
| History attributable to `apps/web/dist-m4-final-qa/` | most of 263 MB (a committed production build) |
| History attributable to world assets | 127.7 MB |
| Tracked assets in the working tree | 168 MB, now ~176 MB |

Two things follow. First, the assets are not what made this repository large —
accidentally committed QA artifacts and a committed `dist` are, and LFS would
have prevented neither. Second, LFS does not shrink existing history, so
adopting it alone leaves ~700 MB of dead weight in place. Since removing that
requires a rewrite anyway, that is the moment to convert `*.glb` at the same
time. Doing it sooner is cheaper: an art agent is generating new props and
characters now, GLBs are already-compressed binaries that do not delta, and each
re-bake of a 3–9 MB character stores a full new copy forever.

If a rewrite is not on the table, tracking `*.glb` in LFS from here still caps
future growth without touching history — at the cost of a mixed regime, and of a
new failure mode where a clone without `git lfs` gets pointer files and the world
silently fails to load.

## 4. Known operational gaps

Not fixed here, listed so they are not rediscovered.

Four entries that used to be on this list are now closed, recorded so nobody
re-opens them from memory:

- ~~`SESSION_SECRET` is not injected in production.~~ Closed by
  `GRADING_RECEIPT_SECRET`, injected from its own Secrets Manager secret
  (`project-archive/verdict-receipt`). See `infra/README.md` for the value the
  owner has to mint.
- ~~The lockfile describes fewer projects than the workspace.~~ Regenerated;
  `pnpm install --frozen-lockfile` now succeeds for the whole workspace and for
  the image's `--filter "@pa/api..."`. The `lockfile` and `api-image` CI jobs can
  drop `continue-on-error`, and the two main jobs can switch to
  `--frozen-lockfile`.
- ~~`TRUEFOUNDRY_GRADING_MODEL` documents Nova Micro.~~ Corrected to
  `gemini-group/gemini-3.5-flash-lite` in `.env.example` and in the task
  definition. Nova Micro measured a 15% false-negative rate.
- ~~A grading outage is invisible.~~ `/v1/health` reports a fallback rate and a
  status word, and the stack alarms on the rate through CloudWatch. See
  `apps/api/src/duels/gradingSignal.ts`.

- ~~The image build context was 1.6 GB.~~ `.dockerignore` now excludes
  `.pnpm-store`, `.pw-browsers`, `.shots`, `.nm-trash-*` and `*.log`. CDK stages
  the whole context and uploads it as an image asset, so every deploy was carrying
  a Playwright browser bundle and a folder of QA screenshots to ECR; the staged
  asset is 6 MB now and `cdk synth` takes 7 seconds rather than 45. It was also the
  cause of a `pnpm lint` failure after any local synth: `.shots/` probe scripts got
  staged into `infra/cdk.out`, where the dangling-import scan found them and
  failed on relative paths that cannot resolve from a staged copy.

Still open:

- **`scripts/check-dangling-imports.mjs` scans build output.** No longer
  load-bearing now that the context is trimmed, but it still walks
  `infra/cdk.out`, so any future staged file that imports across the repo root
  will fail lint for a reason that is not a source problem. Add `cdk.out` to its
  ignore list.
- **The API image carries the root toolchain** (typescript, tsx, playwright).
  pnpm installs the workspace root's dependencies regardless of `--filter`. The
  durable fix is compiling the API instead of running it through tsx, or
  switching the image to `pnpm deploy`.
- **`apps/api` depends on `tsx` as a devDependency but needs it at runtime**, so
  the image cannot be installed `--prod`.
- **`.npmrc` is copied into the API image** for install fidelity. It must stay
  free of registry tokens; use a build secret if one is ever needed.
- **`verify-deps-before-run=false` in `.npmrc` has no effect on pnpm 11**, which
  reads that setting from `pnpm-workspace.yaml` (`verifyDepsBeforeRun`) instead.
  This is why `pnpm -r <script>` on a drifted tree tries to repair
  `node_modules` mid-run, and why it can prompt to purge it.
- **`COOKIE_SECURE` still defaults to insecure in the API itself.**
  `apps/api/src/app.ts` reads `process.env.COOKIE_SECURE === "true"`, so any
  process that forgets the variable serves cookies without Secure. The deployed
  task now always sets it to `true` and CDK refuses an insecure opt-out for a
  non-localhost origin, but the safe default belongs in the app: invert it to
  secure-unless-explicitly-disabled. Left alone because another agent is
  mid-flight in that file.
- **`API_ORIGIN` in `.env.example` is not read anywhere.** Harmless today, but it
  is the same shape of trap that `SESSION_SECRET` turned into. Now annotated in
  place rather than removed, so the next reader knows it is inert.
- **`DUEL_RECEIPT_ENFORCEMENT` cannot leave `AUDIT` yet, and the reason is no
  longer the client.** `apps/web/src/duel/duelGrading.ts` does read the
  `x-pa-verdict-receipt` response header and does send the duel id alongside it on
  the round's `VERDICT_COMMITTED` entry, and a graded round commits `verified`,
  measured against a running API. What blocks `REQUIRE` is that enforcement cannot
  tell a **stripped** receipt from an **honestly ungraded** round. The client's
  1.5-second cap, an unreachable API and the stand-in authority all produce a
  verdict no server minted; the design grants the maximum for all three so that
  infrastructure never costs a student a mission; and the only field that would
  distinguish tampering from one of those is client-supplied. So `REQUIRE` would
  answer 409 on a round that was legitimately never graded. Closing this needs a
  server-side record of what the server minted, not a change on the web side.
- **`@pa/reporting` still reports the degraded path.** The columns it asked for
  exist and the API writes them (migration 008), but
  `evidenceFromDurableRows` still hard-codes `masteredWithRecycledItems: null`
  and an empty review-flag list. Reading the new columns is a change in that
  package, and it will need the route's `MasteryRowInput`/`AttemptRowInput` to
  carry them.
- **`profiles.district_student_ref` was not added.** @pa/reporting marks it
  "wanted" rather than required; without it a district export falls back to the
  opaque profile id and the district builds a crosswalk by hand.
- **`apps/api/src/schema.sql` is dead.** Nothing loads it, and it still creates
  `mastery_reports`, which migration 009 drops. It is a second, stale description
  of the schema sitting next to the real one.
- **`registerGradingRoutes` (`apps/api/src/routes/grading.ts`) is never
  mounted.** `/v1/grading/answers` and `/v1/grading/items/:itemId` do not exist on
  a running server; the duel route supersedes the first and nothing serves the
  second. Either wire it or delete it.
