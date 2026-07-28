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
| `mission-world` | `packages/engine-world/*`, `packages/mission-m1/*`, ladder files in `assets/pipeline/*` and `apps/web/public/world/*`, `apps/web/src/chapter/M1Scenery.tsx`, `scripts/check-world-affordances.mjs` |
| `mission-flow` | `apps/web/public/world/props/liberty-elm-hero.glb` and its own new pipeline script |
| `boss-fight` | `content/*`, `packages/grading/*`, `packages/curriculum/*`, `apps/web/src/codex/*`, `apps/web/src/duel/duelItems.ts` |
| `mission-encounters` | `packages/duel/src/combat.ts`, `policy.ts` and their tests, `packages/netcode/*` |
| `mission-cinematic` | `apps/web/src/mission/duelPort.ts`, `missionDuelSky.ts`, `bossCutscene.ts`, `BossChallenge.tsx`, `MissionEncounter.tsx`, `encounterCinematic.ts`, `missionEncounter.css`, `apps/web/src/chapter/m1Mission.ts` |
| `mission-presentation` | `scripts/*`, `.github/*`, `docs/process/*`, `package.json` scripts, tests under `packages/{assessment,contracts,reporting,abilities,netcode}` |
| `world-audit` | **audit only** — one new script in `scripts/` plus `.affordwork/` output. Edits nothing else. |

**Contested, needs sequencing rather than a claim:** `packages/mission-m1/src/assets.ts` and
`runtime.ts` (ladder work holds uncommitted edits); `apps/web/src/duel/ArenaView.tsx` and
`MissionDuel.tsx` (lighting seams); `apps/web/src/duel/missionBrief.ts`.

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
