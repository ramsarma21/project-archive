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
| `verify` | yes | boundary lint, `pnpm typecheck`, `pnpm test`, packages build, web production build |
| `api-postgres` | yes | `@pa/api` persistence suite against a real `postgres:17-alpine` |
| `lockfile` | **advisory** | `pnpm install --frozen-lockfile` |
| `api-image` | **advisory** | Dockerfile lint plus a real build of `apps/api/Dockerfile` |

CI pins **Node 24**, matching the API's production base image, rather than
tracking whatever is newest locally.

`verify` runs its steps with `if: ${{ !cancelled() }}`, so one failure does not
hide the rest — a red run reports everything that is broken in a single pass.

### Migration checksums

Nothing in CI edits or re-checksums migrations. Two existing suites cover them,
and both self-adapt when a migration is added:

- `apps/api/test/migration-shape.test.ts` (in `verify`) re-hashes every
  `.sql` file in `apps/api/src/migrations` against `checksums.json` and fails if
  a migration was rewritten or is missing from the file. No database needed.
- The persistence suite (in `api-postgres`) applies every migration to a real
  Postgres twice and asserts each is applied exactly once, so a non-idempotent
  migration fails there.

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

There is no CI job for browser checks. Two things have to land first: the import
fix above, and the missing production assets noted below — a CI runner cannot
render a world whose GLBs are not in the repository.

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
