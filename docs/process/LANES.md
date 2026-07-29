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
| `mission-flow` | `apps/web/public/world/props/liberty-elm-hero.glb` and its `assets/pipeline/*liberty_elm*` pipeline files. **Its elm-beat UI pass (`MissionHud`/`MissionBeatPanel`/`missionInput`/`mission.css`) is held under a GRANT, not ownership** — see Grants. |
| `boss-fight` | `content/*`, `packages/grading/*`, `packages/curriculum/*`, `apps/web/src/codex/*`, `apps/web/src/pvp/*`, `apps/web/src/duel/duelItems.ts`, `apps/web/src/duel/verdictLabel.ts` and its test |
| `duel-hud` | the duel 3-D HUD + interstitial presentation: `apps/web/src/duel/CombatHud.tsx`, `DuelScreen.tsx`, `combatHud.css`, `combatHudParts.tsx`, `combatHudModel.ts`, `duelRuntime.ts`, `learnOnce.ts`, and `apps/web/test/{combatHud,duelPresentation}.test.ts` |
| `camera-occluder` | nothing permanently; its whole footprint is a GRANT carved out of `mission-world` (camera-clearance in `engine-world` + `MissionStage`). See Grants. |
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
when its work merges** — a grant that outlives its work is a silent re-owning. Live grants (29 Jul):
`mission-flow` holds the four elm-beat UI files; `camera-occluder` holds its camera-clearance carve-out
of `engine-world` + `MissionStage`.

## Detection when prevention fails open

The guard is prevention and it fails **open** by design; on 29 Jul it did not fire at all for a
background subagent, and four contested writes landed unnoticed. `node scripts/check-lane-integrity.mjs`
is the backstop: it reads git state for every worktree lane and reports, most-dangerous first, the
**same file modified on two live lanes at once** (the real clobber), then writes a lane made that the
map forbids, then unclaimed drift. Run it in the standing loop; a non-zero exit is a crossed lane.

**Live conflicts it is currently reporting (29 Jul), which the orchestrator must sequence:**
- `boss-fight` and `duel-hud` are BOTH editing `apps/web/src/duel/{DuelOverlay.tsx,duel.css,devEntry.tsx}`
  right now — a genuine clobber. The verdict-label rework (boss-fight) and the HUD overhaul (duel-hud)
  cannot both hold these files; one must finish and merge before the other touches them, or the shared
  overlay must be split.
- The duel **card content** and the **grading policy** are the same file (`content/m1/duel-items.json`
  carries both), so a "duel cards" brief and a "grading" brief cannot run in parallel.
- The `apps/api` health wiring reads grading health, so the grading work (`packages/grading`, boss-fight)
  and the health work (`apps/api`, api-hunt) are one change split across two lanes — sequence or grant.

## Verification every lane must pass

`pnpm lint && pnpm typecheck && pnpm test && pnpm build`, plus `verify:content` and the three
`assets:verify:*` with the 25 affordance debt entries **held or shrunk, never grown**, plus
`check-playthrough` ALL PASS where the change could affect play.

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
