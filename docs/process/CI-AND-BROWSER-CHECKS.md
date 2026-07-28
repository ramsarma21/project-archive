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
| `playthrough` | yes | opens the real client with Playwright against a running stack (Postgres + API + web) and plays the mission: world renders, route advances, every encounter arms **and** resolves, no penetration, yard reached, duel loads a graded world |
| `lockfile` | **advisory** | `pnpm install --frozen-lockfile` |
| `api-image` | **advisory** | Dockerfile lint plus a real build of `apps/api/Dockerfile` |

CI pins **Node 24**, matching the API's production base image, rather than
tracking whatever is newest locally.

`verify` runs its steps with `if: ${{ !cancelled() }}`, so one failure does not
hide the rest — a red run reports everything that is broken in a single pass.

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
- **DUEL** — `verdict=live` loads a real arena (not the void), and a graded answer
  discriminates right from wrong (a correct answer pays more balls than a wrong one).

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

**It is unweakened, and stays that way.** No retries that would mask a real failure,
no reduced timeouts that would skip the soft-lock check, nothing degraded to a
warning. Measured flakiness is zero across repeated runs with the census values
identical to the decimal (171 draw calls, 5,108,594 triangles, 147 textures,
duel `botSky` 0.058, magazines 14 vs 7, penetration 0 m); the ~90 s runtime is
mostly the deliberate route/soft-lock budget. If provisioning ever proves genuinely
unreliable, the honest move is to make it report-only with the reason stated here —
not to ship a flaky blocking gate. A gate people learn to ignore is worse than none.

#### What this gate CANNOT see

A green `playthrough` does **not** mean the game is correct. The check reads hull
penetration, a render census, encounter state and route progress — nothing more —
so it is structurally blind to a real class of defects, and anyone reading a green
run should not conclude otherwise:

- **Climbing through *drawn* geometry.** It reads the collision hull penetration
  ring, and the collision column is legitimately empty in places where the visible
  mesh is not; a body can pass through geometry that is drawn but not collidable and
  this gate sees nothing wrong. The mesh-vs-collision agreement is the job of
  `assets:verify:collision`, not this.
- **Whether animations put hands on holds.** It never inspects rig poses. A climb
  can complete with the hands nowhere near the hold and the gate still passes; that
  is `scripts/check-clip-fidelity.mjs`'s domain.
- **Bare-wall climbs.** A separate audit measured eight climbs against blank wall
  (surfaces with no authored affordance). This gate does not evaluate whether a
  climbed surface *presents* the affordance it was authored against — that is
  `assets:verify:affordances` and its `KNOWN_DEBT` list.
- **The terminal skill beat.** The autonomous driver deliberately does not play the
  Liberty Elm posting beat and bough dismount; a bot that reliably executes that
  skill beat would itself be a flaky dependency. Full `REACHED_DUEL` completion is
  covered at the data level by mission-m1's route/traversability tests, not here.

In short: this gate proves the mission *renders and can be driven end to end with
its encounters resolving and its duel gradeable*. It does not prove the climbing
reads right, the hands land, or every surface is honest. Those have their own gates;
keep reading them.

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
