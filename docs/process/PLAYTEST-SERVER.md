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

**`launchd` is the one and only supervisor.** Do not start these by hand and do not run
`playtest-start.mjs` (see the history below) — the ports are held by the services, `--strictPort`
makes a second vite fail, and two APIs cannot share 4301.

| Service | Label | Plist | Log |
| --- | --- | --- | --- |
| API | `com.projectarchive.playtest.api` | `~/Library/LaunchAgents/com.projectarchive.playtest.api.plist` | `<worktree>/playtest-api.log` |
| Web | `com.projectarchive.playtest.web` | `~/Library/LaunchAgents/com.projectarchive.playtest.web.plist` | `<worktree>/playtest-web.log` |

Properties: `RunAtLoad` (starts at login), `KeepAlive` (restarts on crash — which also covers the
API losing a start-up race against Postgres after a reboot), and `ThrottleInterval` 10s so a
genuinely broken config cannot spin hot. The web plist sets
`VITE_API_PROXY_TARGET=http://localhost:4301`; **without it the browser silently talks to the dev
API on 3001 instead of the frozen one**, which looks like the snapshot working when it is not.

```bash
U=$(id -u)
launchctl print gui/$U/com.projectarchive.playtest.api          # state, pid, run count
launchctl kickstart -k gui/$U/com.projectarchive.playtest.web    # force restart
launchctl bootout gui/$U/com.projectarchive.playtest.api         # stop and unload
launchctl bootstrap gui/$U ~/Library/LaunchAgents/com.projectarchive.playtest.api.plist  # load
lsof -nP -iTCP:4301 -sTCP:LISTEN   # who really holds the API port
lsof -nP -iTCP:4300 -sTCP:LISTEN   # who really holds the web port
```

### Process-supervision history (three failures, so nobody repeats them)

1. **`nohup … & disown` from an agent shell — died twice.** `nohup` only blocks SIGHUP and
   `disown` only edits one shell's job table; neither helps when the harness kills the whole
   process *group*. The server was found dead minutes after the launching agent finished. An
   earlier revision of this file claimed these survive an agent session; that was wrong.
2. **`playtest-start.mjs` (`spawn` with `detached: true` + `unref()`) — worked, but not
   reboot-proof.** It genuinely daemonises via `setsid(2)`, giving each server its own session
   (`ppid = 1`). It is kept in the tree for reference only. **Do not run it** — it would race
   `launchd` for the ports.
3. **`launchd` installed while the setsid pair still held the ports — crash-looped.** The
   services could not bind, `KeepAlive` respawned them every 10s, and the log filled with
   `EADDRINUSE` on 4301. Resolved by killing the setsid pair and running `kickstart`. The lesson:
   **pick one supervisor**, and always confirm with `lsof` which process actually owns the port
   rather than trusting `launchctl print` saying `state = running` — a crash-looping service also
   reports as running.

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

**Nothing to do in the normal case.** `RunAtLoad` starts both services at login and `KeepAlive`
retries the API until Postgres accepts connections. Just confirm Docker came up:

```bash
docker start project_archive_pg   # only if the container is not already running
```

If the game is not answering, diagnose in this order — the port check first, because a
crash-looping service still reports `state = running`:

```bash
U=$(id -u)
lsof -nP -iTCP:4300 -sTCP:LISTEN                # is anything serving?
launchctl print gui/$U/com.projectarchive.playtest.api | grep -E "state|pid|runs"
tail -30 /Users/ramsarma/Projects/project-archive-worktrees/playtest/playtest-api.log
launchctl kickstart -k gui/$U/com.projectarchive.playtest.api    # force a restart
launchctl kickstart -k gui/$U/com.projectarchive.playtest.web
```

Then verify, and note that the **proxy** check is the one that proves the browser reaches the
frozen API rather than a dev server that happens to be running:

```bash
curl -s http://127.0.0.1:4301/v1/health   # expect ok:true, database:true, grading.configured:true
curl -s http://127.0.0.1:4300/v1/health   # same, THROUGH the proxy — proves 4301, not 3001
curl -sI http://127.0.0.1:4300/ | head -1 # expect 200
```

## Refresh the snapshot to a newer commit (later)

When the owner likes a newer state (e.g. after merging lanes into `main`):

1. Stop the services: `U=$(id -u); launchctl bootout gui/$U/com.projectarchive.playtest.web;
   launchctl bootout gui/$U/com.projectarchive.playtest.api`
2. Tag the new commit: `git tag -a playtest/frozen-<yyyy-mm-dd> <commit> -m "…"`.
3. Repoint the worktree (it is detached, so just move HEAD):
   ```bash
   git -C /Users/ramsarma/Projects/project-archive-worktrees/playtest checkout --detach playtest/frozen-<yyyy-mm-dd>
   ```
4. If the lockfile changed: `cd <worktree> && CI=true pnpm install --frozen-lockfile`.
5. If there are new migrations: `cd <worktree>/apps/api && node --import tsx src/migrate.ts`
   (runs against `project_archive_playtest`; **existing play-test progress is preserved** —
   the DB is not recreated).
6. Reload the services:
   `launchctl bootstrap gui/$U ~/Library/LaunchAgents/com.projectarchive.playtest.api.plist` and
   the same for `.web.plist`. The plists reference the worktree path, not the commit, so they need
   no edit when the snapshot moves.

The `.env`, start script, pidfile and logs are untracked, so `checkout --detach` leaves them alone.

## Teardown (remove the play-test server entirely)

1. Stop and unload the services (this must come first — `KeepAlive` would otherwise respawn
   anything you kill by pid):
   ```bash
   U=$(id -u)
   launchctl bootout gui/$U/com.projectarchive.playtest.web
   launchctl bootout gui/$U/com.projectarchive.playtest.api
   rm ~/Library/LaunchAgents/com.projectarchive.playtest.{api,web}.plist
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
