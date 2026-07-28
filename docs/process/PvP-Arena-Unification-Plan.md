# PvP Arena Unification — ready-to-execute plan

**Status:** staged, not started. Hand to a pass that owns `packages/pvp`, `packages/netcode`, and `apps/api`.

**Goal (owner's decision):** one arena serves every Boston PvE boss fight *and* PvP.
PvE already fights in the shared rope-walk yard (`yardArena()` in
`apps/web/src/duel/arenaSpec.ts`); the mission-entered duel was moved into it and
the M1 boss now fights it with cover-seeking tactics. PvP is the last holdout: it
still fights the generic `referenceArena()`.

## Why it wasn't done in the boss-fight pass

- `yardArena()` and the data it derives from (`YARD_COVER`, `PROP_NATURAL_SIZE`,
  `fitPropToHeight`) live in **`apps/web`**. The PvP authority is **headless**
  (`apps/api/src/routes/pvp.ts` → `packages/pvp`, run under `node --test`) and
  cannot import from `apps/web`. So there is no shared arena for both sides to name
  until the yard spec moves into a package both can import — `@pa/duel`.
- The two arenas are genuinely different geometry: `referenceArena()` is 12×12 with
  4 cover pieces (2 chest pillars, 2 low crates); `yardArena()` is 11×11 with 8
  cover pieces. Swapping changes every simulated trajectory, so the PvP
  winnability / settlement / round-ceiling tuning and the netcode lockstep hashes
  have to be re-validated, not just recompiled.
- `packages/pvp`, `packages/netcode`, and `apps/api` were outside the boss-fight
  pass's ownership, and re-baselining their fight tests is a real risk to the
  2,702-test green baseline. It deserves a pass that owns them.

## The move, in order

### 1. Lift the canonical yard spec into `@pa/duel` (headless, pure)

Create `packages/duel/src/yard.ts` and move — verbatim, they are pure number/data
and have no React/three dependency — from `apps/web/src/duel/arenaSpec.ts`:

- `PROP_NATURAL_SIZE` (or at minimum the cover-prop subset:
  `crate-mound`, `crate-stack`, `barrel-group`, `firewood-stack`),
- `FittedProp`, `fitPropToHeight`,
- `CoverPlacement`, `YARD_COVER`,
- `YARD_HALF_EXTENT_X` / `YARD_HALF_EXTENT_Z`,
- `fittedCover`, `yardArenaSpec`, and a new `yardArena()` built with the existing
  `buildArena` already in `packages/duel/src/arena.ts`.

Export them from `packages/duel/src/index.ts`. This keeps the single-source rule:
one `YARD_COVER` list, one `fitPropToHeight`, from which both the blockers and the
drawn props derive — the property `apps/web/test/duelArena.test.ts` proves.

> **Do NOT** move `perimeterWall`, `GROUND_TILES`, `GROUND_TILE_SIZE`,
> `YARD_DRESSING`, `DressingPlacement`, or `GroundTile`. Those are drawing-only and
> `perimeterWall` needs `CAPSULE_RADIUS` from `@pa/engine-world`; they stay in
> `apps/web`.

### 2. Re-point `apps/web/src/duel/arenaSpec.ts` at the core

Replace the moved definitions with `export { … } from "@pa/duel"` re-exports, so
`ArenaView`, `m1Duel.ts`, `missionBrief.ts`, and every existing importer are
unchanged. Keep the drawing-only exports local. Net effect in `apps/web`: zero
behaviour change, the yard spec is now the core's.

### 3. Switch the PvP authority to the shared arena

- `apps/api/src/routes/pvp.ts` line ~1067: `const arena = referenceArena();` →
  `const arena = yardArena();`.
- `packages/pvp/src/index.ts` line ~26: re-export `yardArena` alongside (or instead
  of) `referenceArena`.
- Because the snapshot has no arena field (the "one coupling" named at the top of
  `apps/web/src/pvp/arenaScene.ts`), this is still a matched pair of hardcoded
  calls. If PvP is ever to have a second arena, lift the arena id into the snapshot
  now; otherwise leave a TODO where `referenceArena` used to be.

### 4. Redraw PvP from `YARD_COVER` so it inherits the cover invariant *by construction*

`apps/web/src/pvp/arenaScene.ts` currently derives props from blockers
(`fillBlocker`) because the browser was told nothing about the arena. Once the
arena is the shared yard, replace that back-derivation with the boss duel's own
forward path: draw `fittedCover()` (the same list the blockers are built from),
exactly as `apps/web/src/duel/ArenaView.tsx`'s `<Cover>` does. Then PvP gets
"the cover you see is the cover that stops a ball" the same way PvE does — one
prop per blocker, matched on centre, footprint and top height — rather than a
best-effort fill. Keep `groundProps`, `perimeterWall`, `pushOutside`/`YARD_DRESSING`.

Consider deleting `fillBlocker`, `blockerCells`, `containFit` and their tests once
nothing calls them; or keep them if a future non-yard PvP arena still needs the
back-derivation.

### 5. Re-baseline the fight tests (the real work)

Arena-**agnostic** tests (they just need *a* world) can keep `referenceArena` OR
switch — cheap either way. Arena-**sensitive** tests assert outcomes/positions/
hashes and must be re-validated against `yardArena` geometry:

| File | Why it moves | Rough effort |
| --- | --- | --- |
| `packages/pvp/src/__tests__/harness.ts` | shared fight harness builds the arena | switch to `yardArena`; downstream tests inherit |
| `packages/pvp/src/__tests__/roundCeiling.test.ts` | ceiling measured against arena distances | re-check thresholds |
| `packages/pvp/src/__tests__/policy.test.ts` | uses the arena world | likely mechanical |
| `packages/pvp/src/__tests__/settlement.test.ts`, `directMatch.test.ts`, `resumeCountdown.test.ts`, `authority.test.ts` | advance the reducer; outcomes shift with cover/LOS | re-validate expected outcomes |
| `packages/duel/src/__tests__/pvp.test.ts`, `winnability.test.ts` | winnability is tuned per arena | **re-tune**, highest risk |
| `packages/netcode/src/__tests__/hash.test.ts`, `divergence.test.ts`, `transcendental.test.ts`, `harness.ts` | lockstep **hashes are baked** for `referenceArena` | regenerate golden hashes |
| `apps/web/test/pvpArena.test.ts` | asserts `halfExtent === 12` and 4-cover mapping | rewrite for 11×11 / 8 cover; add the drawn-cover-is-blocking-cover assertion mirroring `duelArena.test.ts` |
| `apps/web/test/pvpLook.test.ts` | draws from `referenceArena` | rewrite for the yard |

Estimate: ~8–10 test files touched; 2 of them (duel winnability, netcode golden
hashes) are re-derivation rather than mechanical edits. Everything else is a
world-swap plus expected-value refresh.

### 6. Gate

Full green as usual: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` plus
`verify:content` and the three `assets:verify:*`. Add a PvP analogue of
`apps/web/test/duelArena.test.ts` so the cover invariant is pinned on the PvP
drawing path too.

## Authority model — unchanged, must stay unchanged

Nothing here weakens the duel's authority model: verdicts stay HMAC-receipted and
server-authoritative, `@pa/duel` keeps rejecting unknown verdict sources, and the
PvP authority keeps advancing by running the duel reducer. Swapping the arena only
changes the *world* the reducer integrates, not who owes a verdict or who signs it.

## What could go wrong

- **Winnability drift.** The yard has twice the cover; a PvP round that was winnable
  in the open reference arena may not be, or vice versa. `winnability.test.ts` is
  the guard — expect to re-tune magazine/round tuning, not just the assertions.
- **Spawn fairness.** PvP requires 180° rotational symmetry for fair spawns.
  `YARD_COVER` is authored symmetric (see the note in `arenaSpec.ts`), so this
  should hold — assert it explicitly in the new PvP arena test.
- **Netcode golden hashes.** These are recorded constants; regenerate them
  deliberately and eyeball the divergence metrics, don't just paste new numbers.
- **Bundle coupling.** Moving `PROP_NATURAL_SIZE` into `@pa/duel` puts asset
  measurements in a headless package. That's fine (they're numbers), but keep the
  drawing-only data in `apps/web` so `@pa/duel` never grows a three/react edge.

---

## Adjacent cleanup the boss-fight pass flagged (decide with the mission-geometry owner)

These are consequences of moving the duel into the shared arena. The boss-fight
pass deliberately did **not** change them.

1. **`MissionDuelBrief.world` / `.placement` are now assembled but unused.**
   `apps/web/src/chapter/m1Mission.ts`'s `duelBrief` still calls `arenaWorld()` and
   `arenaPlacement()` (from `@pa/mission-m1`), but `missionDuelDescriptor` now
   builds the arena from `yardArena()` and ignores both. The brief mirrors
   `CreateDuelInput`, so the fields are legal to carry — but they are dead weight
   and a place a future reader could be misled into thinking the mission's carved
   yard still matters. **Recommendation:** drop `world`/`placement` from
   `MissionDuelBrief` (and stop building them), or, if the mirror with
   `CreateDuelInput` is worth keeping, add a one-line comment at the brief that they
   are unused by the duel and why. Touches `duelPort.ts` and `@pa/mission-m1`.

2. **The M1 rope-walk yard's duel-cover props are now purely decorative.**
   The eight cover masses the level authored at x≈88–100 — including the yard stage
   another lane fixed this morning specifically because the duel was fought on it —
   no longer stop any ball: the fight happens in the origin arena. The player still
   walks into the yard to *trigger* the duel, so the props remain as approach
   dressing, but nothing there is gameplay-load-bearing anymore.
   **Recommendation:** the mission-geometry owner can simplify or re-tune that
   geometry (it only needs to *read* as a rope-walk yard now, not to be shootable
   cover), and should re-examine the yard-stage fix against its new, purely visual
   role. Do not silently leave it tuned as cover that does nothing.
