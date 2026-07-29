# Lanes — who owns which files right now

**This file is authoritative. Do not infer ownership from a task brief, and do not edit a
file this file assigns to another lane.** Two lanes editing the same authoring destroyed a
worker's edits on 27 Jul; a crossed interrupt swept a sibling's uncommitted work into a
stray commit on 28 Jul. Both were coordination failures, not code failures.

Worktrees live at `/Users/ramsarma/Projects/project-archive-worktrees/<lane>` on branch
`workflow/<lane>`. `/Users/ramsarma/Projects/project-archive` is `main` — **never edit it
directly**; the owner plays there, with web on `localhost:5173`, API on `127.0.0.1:3001`,
Postgres on `55432`. Use your own ports and stop them when you finish.

## Standing rules for every lane

- **One worker per worktree.** Never two at once, even for unrelated files.
- `git merge main` first. Commit on your branch. The orchestrator merges to `main`.
- If the honest fix needs a file another lane owns: **stop and report.** Do not edit it, and
  do not work around it. Say what you need and why.
- If you must touch a shared file, make the edit minimal, put it in **its own commit**, and
  name it in your report so the merge can be sequenced.
- Read `docs/process/M1-STATUS.md` before forming any theory. It records what is fixed, what
  is open, what was already disproven, and what each gate is blind to.

## Ownership

| Lane | Owns |
|---|---|
| `mission-world` | `packages/engine-world/*`, `packages/mission-m1/*`, ladder files in `assets/pipeline/*` and `apps/web/public/world/*`, `apps/web/src/chapter/M1Scenery.tsx`, `apps/web/src/mission/MissionStage.tsx`, `scripts/check-world-affordances.mjs`, `scripts/check-clip-fidelity.mjs` |
| `mission-flow` | `apps/web/public/world/props/liberty-elm-hero.glb` and its `assets/pipeline/*liberty_elm*` pipeline files. (Its elm-beat UI grant is **retired** — merged `2c27d6a` — so those four files are contested again and denied to it like everyone else.) |
| `boss-fight` | `content/*`, `packages/grading/*`, `packages/curriculum/*`, `apps/web/src/codex/*`, `apps/web/src/pvp/*`, `apps/web/src/duel/duelItems.ts`, `apps/web/src/duel/verdictLabel.ts` and its test. **Less `content/m1/module.json` and its schema, granted to `module-lesson`** — see Grants. |
| `duel-hud` | the duel 3-D HUD + interstitial presentation: `apps/web/src/duel/CombatHud.tsx`, `DuelScreen.tsx`, `combatHud.css`, `combatHudParts.tsx`, `combatHudModel.ts`, `duelRuntime.ts`, `learnOnce.ts`, and `apps/web/test/{combatHud,duelPresentation}.test.ts` |
| `module-lesson` | `apps/web/src/module/**`, plus a GRANT on `content/m1/module.json` and `content/m1/schema/learning-module.schema.json` (see Grants). Its tests under `apps/web/test/{checkDraw,moduleCheckModel,moduleCinematic,remediationDeck}.test.ts` are **unclaimed**, so the guard allows them; claim them if that stops being what is wanted. |
| `mission-encounters` | `packages/duel/*` (incl. `combat.ts`, `policy.ts`, `bossAi.ts`, `cover.ts`, `machine.ts`), `packages/netcode/*` |
| `mission-cinematic` | `apps/web/src/mission/duelPort.ts`, `missionDuelSky.ts`, `bossCutscene.ts`, `BossChallenge.tsx`, `MissionEncounter.tsx`, `encounterCinematic.ts`, `missionEncounter.css`, `apps/web/src/chapter/m1Mission.ts` |
| `api-hunt` | `apps/api/*`, `packages/pvp/*` |
| `mission-presentation` | `scripts/*`, `.github/*`, `docs/*`, `package.json` scripts, tests under `packages/{assessment,contracts,reporting,abilities}` |
| `world-audit` | **audit only** — `scripts/check-world-visual*` plus named building GLBs and their pipeline files. |

**Contested — denied to everyone by default, needs sequencing rather than a claim:**
`apps/web/src/mission/{MissionRun,MissionHud,MissionBeatPanel,missionInput,mission.css,traversal,devEntry}`,
`apps/web/src/duel/{ArenaView,MissionDuel,missionBrief,DuelOverlay,duel.css,devEntry}`, `pnpm-lock.yaml`.
A contested file that *must* change now has a legal path: a **grant** (below). It stays contested;
the grant is the temporary, recorded exception.

## Grants — the temporary, exclusive, auditable escape hatch

`contested` used to mean "denied to everyone, full stop", which left a file that genuinely had to
change with no legal way to change it — so the change happened anyway, off the books. A **grant**
(`grants` in `.cursor/lane-ownership.json`) hands one lane the listed paths **temporarily and
exclusively**: while it stands, that lane may write them (overriding contested *and* another lane's
ownership) and every other lane is denied them. Each grant carries a lane, the exact paths, a reason,
and the date. The guard honours it; `scripts/check-lane-integrity.mjs` reports on it. **Retire a grant
when its work merges** — a grant that outlives its work is a silent re-owning, and retiring one means
re-pointing the guard's `--selftest` cases at a live grant in the same edit, or the mechanism stops
being tested. One live grant (29 Jul): `module-lesson` holds `content/m1/module.json` and its schema.
Retired the same day, both merged: `mission-flow`'s elm-beat UI four (`2c27d6a`) and
`camera-occluder`'s engine-world/MissionStage carve-out (`d457081`; that lane no longer exists).

## Detection, because prevention is not available

**The guard cannot protect this repo, and that is now measured rather than suspected.** Its logic is
right — 89 completed invocations, 87 allow, 2 correct deny — but 148 more were cancelled at 0 ms with
no verdict, and they split **by session**: foreground calls complete, whole background-subagent
conversations abort and fall open. Most lane work is background subagents. Worse, `Shell` is not in
the hook matcher, so an edit made with python, `sed`, a heredoc, `cp` or `>` fires no hook at all and
never even reaches the log — and a shell command carries no file path to inspect, so that hole cannot
be closed. The guard stays (free, and it works for foreground writes); do not set `failClosed` and do
not add `Shell` to the matcher, which would look stronger and not be. Details in `M1-STATUS.md`.

**So the enforcement point is the detector.** `scripts/check-lane-integrity.mjs` reads the same map out
of git state and reports, most-dangerous first: **CLOBBER** (one file, two lanes, *differing* content —
the thing that destroys work), **VIOLATION** (a write the guard would refuse), **PROPAGATION** (shared
but harmless), then unclaimed **OPEN** drift. It self-tests before it measures.

- `pnpm verify:lanes` — the orchestrator's audit. Fails on any crossing anywhere. Run it in the loop.
- `pnpm gate` runs it with `--lane auto`, which prints everything but fails only on findings involving
  the lane being gated. A red a merger cannot fix is how a gate gets muted.
- **Not in CI, deliberately:** it reads local sibling worktrees, which do not exist on a runner, so a
  CI job would be a green light that can see nothing.

The old "`.cursor/*` clobber on every lane, read past it" caveat is **gone** — the detector now compares
each lane's copy against `main`'s, so a stale propagated copy is not a change the lane is bringing.

**Live conflicts it is currently reporting (29 Jul), which the orchestrator must sequence:**
- **`duel-hud` is editing contested `apps/web/src/duel/{DuelOverlay.tsx,duel.css}` with no grant.**
  `boss-fight` landed first (`540c0e3`), so the sequencing is settled and `duel-hud` is now the single
  lane on those files — but that is not recorded, so it reads as an off-the-books cross-lane edit and
  fails the audit. **It needs a grant, or the files reassigned.** Not done here: nobody asked for it,
  and inventing a grant is exactly the unrecorded authorisation the map exists to prevent. When
  `duel-hud` reconciles it MUST preserve the "Not graded" label (`verdictBeatTone` in
  `verdictLabel.ts`) — see the invariant row in `M1-STATUS.md`.
- The duel **card content** and the **grading policy** are the same file (`content/m1/duel-items.json`
  carries both), so a "duel cards" brief and a "grading" brief cannot run in parallel.
- The `apps/api` health wiring reads grading health, so the grading work (`packages/grading`, boss-fight)
  and the health work (`apps/api`, api-hunt) are one change split across two lanes — sequence or grant.

**Handoff state (29 Jul, post-merge round):**
- **Landed on `main`:** `boss-fight` (`540c0e3`), `mission-presentation` detector (`eeedfd0`),
  `mission-flow` elm-beat (`2c27d6a`, full gate GREEN incl. build + check-playthrough on a throwaway
  stack). `mission-world` and `api-hunt` deliberately NOT merged — their agents are still working.
- **`api-hunt` carries two grading-integrity fixes that are NOT on `main`** and have been reported as
  landed: outage rounds enforcing the deterministic card half, and the encounter `/v1/health` blind
  spot. Merging that lane is worth more than it looks. See `M1-STATUS.md` → Open.
- **A map edit reaches the guard and the detector by two different routes, and both must happen.**
  `.cursor/hooks.json` registers the guard as the **relative** path `.cursor/hooks/lane-guard.sh`,
  so an agent working in a worktree runs *that worktree's* copy against *that worktree's* map.
  `check-lane-integrity.mjs` instead always reads the **hub's** map
  (`/Users/ramsarma/Projects/project-archive/.cursor/lane-ownership.json`). So editing the map on a
  lane branch changes nothing anywhere until it merges to `main` **and** the reconciled `.cursor/`
  is copied into each worktree. That copy is what the detector then reports as PROPAGATION.
  Copy it only into worktrees whose current copy still matches the previous `main` blob — a
  differing copy means somebody edited it, and that is theirs, not yours.

## Verification every lane must pass

`pnpm gate` runs all of it in one command and refuses on any failure: `lint`, `typecheck`, `test`,
`build`, `verify:content`, `verify:units`, the three `assets:verify:*` with the 25 affordance debt
entries **held or shrunk, never grown**, `check-lane-integrity` scoped to your lane, plus
`check-playthrough` where the change could affect play (skipped, with its reason printed, when it
cannot).

**Environment quirks that will otherwise cost you an hour.** `pnpm build` may throw `EPERM` on
`packages/*/dist` under the sandbox — re-run unsandboxed. If `pnpm` refuses to install for
lack of a TTY, use `CI=true pnpm install`. `?verdict=live` returns `CSRF_INVALID` unless the
API's `WEB_ORIGIN` matches your web origin exactly, port included.

## What counts as evidence here

Read the "what each gate is blind to" table in `M1-STATUS.md` before claiming a fix works.

- **Instrumented real play, not the replay harness.** The harness reported "0 of 44
  transitions phase" while the owner was visibly climbing through a church, because the mover
  reads authored hulls and has never touched a GLB.
- **A screenshot must plainly show what you claim, at a brightness where geometry is legible.**
  An illegible frame is a failed check, not a caption. Nine ladders were merged as "flush to
  the face" on captures the worker itself called too dark to read; the owner disproved it with
  one frame.
- **A test that cannot fail is not evidence.** Break the code your test guards and confirm it
  fails. Turning climb refusal off entirely left 730 tests green.
- **Declare what you did not do.** An honest gap outranks a claim that doesn't hold.
