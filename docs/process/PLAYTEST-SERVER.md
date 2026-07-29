# Frozen Play-test Server

A **frozen, always-playable snapshot** of the game, served locally so the owner can
play-test continuously while development proceeds on lane branches. It is deliberately
**immune to ongoing development**: pinned code (a git tag), no file watching, isolated
ports, and an isolated database.

> **THIS IS NOT A DEV TREE. DO NOT DEVELOP HERE.**
> The worktree at `../project-archive-worktrees/playtest` is a **detached** checkout pinned
> to a tag. Editing its source does nothing useful (there is no `--watch`, and it will be
> thrown away on the next refresh). Do lane work in `../project-archive-worktrees/<lane>`
> as usual. The only files that are *meant* to differ here from the tagged commit are the
> untracked files this server needs: `.env`, `playtest-start.mjs`, `playtest.pids`, `*.log`.

Stood up 2026-07-29.

## Identity (what is frozen)

| Thing | Value |
| --- | --- |
| Tag (annotated) | `playtest/frozen-2026-07-29` (tag object `119ff4f`) |
| Commit | `4c16caf98e108139f00654015e07e5520932bffb` — "docs(process): record the 29 Jul M1 trunk consolidation" |
| Why this commit | Consolidated M1 trunk, verified green (2869 tests 0 failing, static gate green, `check-playthrough` all pass). |
| Worktree | `/Users/ramsarma/Projects/project-archive-worktrees/playtest` (detached HEAD at the tag) |

The tag pins the snapshot. `main` moving on (including this doc's own commit) does not affect it.

## URL and ports

| Service | URL / port | Bind |
| --- | --- | --- |
| **Play here** | **http://localhost:4300/** | `127.0.0.1` only |
| Frozen API | http://localhost:4301/ (`/v1/health`) | `127.0.0.1` only |

Ports were chosen to avoid every reserved/in-use port in the project (5173, 3001, 55432,
54321-54327, 55321-55327, 5199, 55437, 3097) and were verified free before binding. The dev
stack's own ports (5173 web / 3001 API) are intentionally left free for ongoing development.

## Database — ISOLATED (owner starts clean)

The frozen API uses a **separate database** inside the existing Postgres container so a future
dev migration can never corrupt play-test data.

| Thing | Value |
| --- | --- |
| Container | `project_archive_pg` (shared, healthy, host port `55432`) |
| Database | **`project_archive_playtest`** (created 2026-07-29, migrations applied) |
| Connection | `postgres://project_archive:project_archive@localhost:55432/project_archive_playtest` |
| Dev DB (untouched) | `project_archive` — the frozen stack never touches it |

**Fresh start:** this is a brand-new database, so the owner's existing accounts/progress from
the dev DB are **not** here. Create a local profile on the landing page ("NEW LOCAL PROFILE
(FOR TESTING)") to start playing — no Google sign-in required (see caveat below). To reset
progress later: `pnpm dev:reset-mission` (script `apps/api/src/dev/resetMission.ts`), run with
this server's `.env` so it targets `project_archive_playtest`.

## How the pieces are wired

- **Web → API:** `apps/web/vite.config.ts` proxies `/v1` and `/api` to
  `process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3001"`. The frozen web is launched
  with `VITE_API_PROXY_TARGET=http://localhost:4301`, so the browser talks to the frozen API
  through the proxy. **No source was edited** — the wiring is env + CLI flags only.
- **API config:** `apps/api/src/server.ts` reads `API_PORT`/`API_HOST`; `apps/api/src/db.ts`
  reads `DATABASE_URL`; `apps/api/src/config.ts` loads the repo-root `.env`. The frozen tree's
  root `.env` (untracked/gitignored) is a copy of the dev `.env` with only these overrides:
  `API_PORT=4301`, `API_ORIGIN=http://localhost:4301`, `WEB_ORIGIN=http://localhost:4300`,
  `DATABASE_URL=…/project_archive_playtest`, `GOOGLE_REDIRECT_URI=http://localhost:4300/…`.
  All grading secrets (`GRADING_ENABLED`, `TRUEFOUNDRY_API_KEY`, `TRUEFOUNDRY_BASE_URL`, the
  encryption/receipt keys) are preserved verbatim, which is what keeps `grading.configured:
  true` — so the boss duel actually grades prose instead of crediting every answer.

## Processes and logs

Launched **without `--watch`** so no file change can ever reload them.

Both are started by one script, which daemonises them properly:

```bash
node /Users/ramsarma/Projects/project-archive-worktrees/playtest/playtest-start.mjs
```

| Service | Process | Node PID at setup | Log |
| --- | --- | --- | --- |
| API | `node --import tsx src/server.ts` (cwd `apps/api`) | `54323` | `<worktree>/playtest-api.log` |
| Web | `vite --port 4300 --strictPort`, `VITE_API_PROXY_TARGET=http://localhost:4301` (cwd `apps/web`) | `54324` | `<worktree>/playtest-web.log` |

**PIDs are ephemeral** — they change on every restart. The script writes the current pair to
`<worktree>/playtest.pids`; otherwise find them with:

```bash
lsof -nP -iTCP:4301 -sTCP:LISTEN   # frozen API
lsof -nP -iTCP:4300 -sTCP:LISTEN   # frozen web
```

### Why a script and not `nohup … &` (learned the hard way)

The first attempt launched the servers from an agent/tool shell with `nohup … & disown`. **They
were killed the moment the launching job ended** — twice. `nohup` only blocks SIGHUP, and
`disown` only removes the job from one shell's table; neither helps when the supervisor kills
the whole process *group* or descendant tree. An earlier note in this file claiming these
survive an agent session was wrong and has been corrected.

`playtest-start.mjs` uses `spawn(..., { detached: true })` (which is `setsid(2)`) plus
`unref()`, so each server gets its **own session and process group** and reparents to launchd.
Verified after launch: `ppid = 1` and `pgid = pid` for both processes. Nothing in an editor or
agent session can take them down now.

**Still not reboot-proof.** A restart or shutdown ends them; re-run the script (below). A
`launchd` LaunchAgent with `KeepAlive` would make it survive reboots and auto-restart — not
done, ask if you want it.

## Verification (measured 2026-07-29, not inferred)

- `GET http://127.0.0.1:4301/v1/health` → `{ ok: true, database: true, google: true,
  grading: { status: "OK", configured: true } }`.
- `GET http://127.0.0.1:4300/v1/health` (through the web proxy) → `ok: true, database: true,
  grading.configured: true` — proves the browser reaches the **frozen** API (4301), not 3001.
- `GET http://127.0.0.1:4300/` → HTTP 200.
- Vite process cwd = `<worktree>/apps/web` — served from the frozen tree, not the main checkout.
- `pg_stat_activity`: the frozen API's live connection is on `project_archive_playtest`.
- Headless-browser smoke load of `/`: 0 console errors, 0 page errors, 0 failed requests;
  landing renders "server online" and the local-profile flow (fresh DB, "No profiles yet").

## Restart after a reboot

1. Ensure the DB container is running: `docker start project_archive_pg`
   (or `docker compose up -d` from the main checkout).
2. Start both servers:
   ```bash
   node /Users/ramsarma/Projects/project-archive-worktrees/playtest/playtest-start.mjs
   ```
3. Verify:
   ```bash
   curl -s http://127.0.0.1:4301/v1/health   # expect ok:true, database:true, grading.configured:true
   curl -sI http://127.0.0.1:4300/ | head -1 # expect 200
   ```
   Then open http://localhost:4300/.

The script is safe to re-run only when the servers are down — `--strictPort` means a second
web instance fails rather than silently taking another port. Stop them first (Teardown step 1)
if you are unsure.

## Refresh the snapshot to a newer commit (later)

When the owner likes a newer state (e.g. after merging lanes into `main`):

1. Stop the servers (see Teardown step 1).
2. Tag the new commit: `git tag -a playtest/frozen-<yyyy-mm-dd> <commit> -m "…"`.
3. Repoint the worktree (it is detached, so just move HEAD):
   ```bash
   git -C /Users/ramsarma/Projects/project-archive-worktrees/playtest checkout --detach playtest/frozen-<yyyy-mm-dd>
   ```
4. If the lockfile changed: `cd <worktree> && CI=true pnpm install --frozen-lockfile`.
5. If there are new migrations: `cd <worktree>/apps/api && node --import tsx src/migrate.ts`
   (runs against `project_archive_playtest`; **existing play-test progress is preserved** —
   the DB is not recreated).
6. Restart the servers (Restart section above).

The `.env`, start script, pidfile and logs are untracked, so `checkout --detach` leaves them alone.

## Teardown (remove the play-test server entirely)

1. Stop the servers:
   ```bash
   lsof -nP -iTCP:4301 -sTCP:LISTEN -t | xargs -r kill
   lsof -nP -iTCP:4300 -sTCP:LISTEN -t | xargs -r kill
   ```
2. Remove the worktree (untracked `.env`/logs make it "dirty", so force):
   `git worktree remove --force ../project-archive-worktrees/playtest`
3. (Optional) Drop the DB:
   `docker exec project_archive_pg psql -U project_archive -d postgres -c "DROP DATABASE project_archive_playtest;"`
4. (Optional) Delete the tag: `git tag -d playtest/frozen-2026-07-29`

## Caveats

- **Google sign-in does not work on 4300.** The Google console only has `http://localhost:5173/…`
  registered as an OAuth redirect/origin. Use the guest / local-profile path instead
  (`registerLocalSessionRoute`, active because `NODE_ENV=development`). Local profiles are the
  intended play-test flow anyway.
- The database is shared *at the container level* with dev, but not at the database level:
  isolation is per-database, which is enough to keep a dev migration from touching play-test data.
