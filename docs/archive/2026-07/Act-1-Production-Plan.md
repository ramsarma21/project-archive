# Boston Act 1 — Production Plan (activities · assets · animation · stealth/chase systems)

**Status: the production bridge from design → build for Boston Act 1.** It answers four questions concretely: (A) what there is to *do* in the world, (B) how the assets get built, (C) what animation each activity needs, and (D) exactly how running away / suspicion / heat / detection work as systems.

**Grounded in the real codebase** (verified reads, not assumptions):
- Movement: `playerMotion.ts` (`WALK_SPEED 2.3`, `RUN_SPEED 4.6`, `CROUCH_SPEED 1.15 m/s`; exponential accel; Shift = unlimited sprint, published as `PlayerApi.motion.sprinting`), `playerInput.ts`, `Player.tsx`.
- Collision: `collision.ts` — a **pure semantic AABB** model (`blockers` = XZ rects w/ vertical spans, `platforms`, `bounds`), built **privately inside `Player`** from `manifest.ts` rect colliders. Not mesh/raycast. `CAPSULE_RADIUS 0.35`, `WORLD_BOUNDS {minX:-165,maxX:108,minZ:-30,maxZ:30}`.
- Traversal: `traversalMarkers.ts` / `traversalResolver.ts` / `TraversalDirector.tsx` — verbs `VAULT/CLIMB_UP/CLIMB_DOWN/DUCK_UNDER` execute; clips are **phase-driven** in `Player.clipForPhase()`, not marker-authored.
- Population: `PopulationDirector.tsx` — deterministic waypoint loops (`sampleRoute()` from `clock.elapsedTime`), **no AI/patrol/collision/perception**; positions private to components. Cap `MAX_AMBIENT_RIGS 66`, cull 74m.
- Camera: `CameraDirector.tsx` / `Player.tsx` — boolean ownership; `cameraOverride` currently couples external camera control **and** movement lock.
- HUD: `Hud.tsx` (DOM, top grid) + `QuestMarkerHud.tsx` (external store + `useSyncExternalStore` — the pattern to copy for live gauges).
- Assets: concept (`gen_*_concepts.mjs`/`gen_concept_image.mjs`) → manual QA → Meshy (`gen_*_meshy.mjs`) → Blender optimize (`optimize_*.py`) → verify/manifest (`verify_*`/`write_*_manifest.mjs`, collision via `build_collision_manifest.mjs`) → `sync_web.mjs`. Animation is **baked per-character** (self-contained GLBs; no runtime shared library). Inventory: 122 prop GLBs, 14 rigs, 11 posters.

**Confirmed: zero stealth/detection/heat/stamina/chase/patrol infrastructure exists today.** This plan is a from-scratch systems build on top of solid movement/collision/traversal foundations.

Design authority: `Gameplay-Design.md` (§7 stealth, §8 reactive world, §11A flow). Build script: `Day-1-Build-Script.md`. Micro content: `Micro-Concepts.md`.

---

# PART A — What there is to DO (the activity catalog)

Every activity, its type, its **build status** (🟢 exists / 🟡 extend existing / 🔴 new), the systems it needs, and where it's specced. Two-budget law (Gameplay-Design §2): free-clock = movement/parkour/flavor; activity-budget = learning beats.

## A.1 Core traversal & movement (free-clock)
| Activity | Status | System | Notes |
|---|---|---|---|
| Walk / run / crouch / turn | 🟢 | `playerMotion` | done |
| Vault / climb up-down / duck-under | 🟢 | traversal resolver | done; clips phase-driven |
| Standing jump / running jump | 🟡 | `playerMotion` ballistic | logic done; **`jump`/`runJump` clips fall back to idle until v5 bake** |
| Sprint | 🟡→🔴 | `freeMoveSpeed()` | exists as unlimited; **gate behind stamina for chases only** (Part D.1) |
| Roof route (continuous) | 🟡 | traversal + assets | verbs exist; **roof-walk-board kit incomplete** (Part B) |
| Balance / mantle / jump-gap | 🔴 | traversal | authored but **disabled** in `DENSITY_TRAVERSAL_TYPE_STATUS`; enable only if needed |

## A.2 Compound-verb skill jobs (activity-budget; graded/effort)
| Activity | Beat | Status | Mechanic hook |
|---|---|---|---|
| Print job (catch→ink→register→pull→peel) | B2 | 🟡 | extend `ProceduralPress` (`pa:mechanic-visual`, kind PRESS) w/ ink+register sub-phases |
| Compare proofs (read) | B3 | 🟢 | focus-read grammar |
| Haul cloth (load→balance→thread) | B5 | 🟡 | `THOMAS_HAUL` staging exists; add sub-beats |
| Hand off proof | B6 | 🟢 | handoff mechanic |
| Sort papers (needs-stamp) | B6.5 | 🟢 | `SortFanSlide` / `pa:sort-assign` |
| Conceal fold (2 tucks) | B7 | 🟡 | conceal mechanic (kind EFFORT) + concealment state (Part D) |
| Post notice (line-up→2 tacks→column) | B7.5 | 🟢 | `POST_NOTICE` / `PostedNotice` |
| Rider handoff (quick / gap-timed) | B10 | 🟢 | `RIDER_QUICK/GAP_HANDOFF` |
| Set headline (headline→cause→evidence→pull) | B12 | 🟡 | `FINAL_PRESS_PULL` + construct UI |
| Event on-ramps (climb / push+dodge / chant) | B11 | 🟢 | `EVENT_CLIMB/PUSH/CHANT` |

## A.3 The four runs (activity-budget spine; order-free)
| Run | Type | Status | New system load |
|---|---|---|---|
| Rider's handbills | Timed + **Stealth + chase** | 🔴 | full stealth+chase (Part D) |
| Custom House notice | Chokepoint + **Stealth** | 🔴 | watchers + spot-check (Part D) |
| Pike's proof | Standard + skill | 🟡 | heat-tension only |
| Thomas's circular | Heavy-haul | 🟡 | none new (route unlock exists) |

## A.4 Stealth & confrontation (the signature new gameplay — Part D)
| Activity | Status |
|---|---|
| Read watcher cones / patrols; blend in crowd; use cover; time gaps; concealment | 🔴 |
| Build Standing via unnamed interactions (social camouflage) | 🔴 |
| Confrontation branch: comply / talk out / **run** | 🔴 |
| Escape sequence + stamina; shake or get caught → chewed-out → released later | 🔴 |
| Misdirection (bell/gulls/dropped object) | 🔴 (reuses flavor interactables) |

> **The exact placed content** for everything below (and above) — coordinates, assets, triggers, dialogue, states — is enumerated in **`World-Content.md`**, organized by zone.

## A.5 Reactive world (optional, non-carrier — Gameplay-Design §8)
| Activity | Status |
|---|---|
| Ad-hoc chats with the mobile named 5 (micro + relationship, multi-input) | 🔴 (needs mobile actors + interaction) |
| Interactable unnamed crowd (exposition + micro + builds Standing) | 🔴 |
| Knowledge interactables (posters/signage/objects → micro) | 🟡 (posters exist; needs focus-interact tagging) |
| Side-jobs ×3-4 (tavern note, dock haul, roof-kid, town crier) | 🔴 |
| Flavor verbs (bell, pump, gulls, dog, bench) | 🟢 (`INTERACT_FLAVOR` markers exist) |

## A.6 Learning & assessment surfaces
| Activity | Status |
|---|---|
| Tracked reads / Syncs / demonstrations (macro spine) | 🟢 |
| Micro logging on tracked interaction | 🔴 (needs engaged-micro tracker) |
| CP1 debrief (STAAR-style, macro + engaged micro) | 🔴 (needs debrief overlay + bank) |

---

# PART B — How the assets get built

## B.1 The pipeline (unchanged law — follow it for every new physical asset)
`concept image` (`gen_concept_image.mjs` / batch `gen_*_concepts.mjs`, needs `TRUEFOUNDRY_API_KEY`) → **manual historical/visual QA** (Bible checklist; isolated subject, 1765-plausible, muted pewter/umber) → **Meshy image-to-3D** (`gen_prop_from_image.mjs` / `gen_character_from_image.mjs` / batch `gen_*_meshy.mjs`, needs `MESHY_API_KEY`) → **Blender optimize** (`optimize_*.py`, tri/texture budgets) → **verify + manifest** (`check_glb.mjs`/`inspect_glb.mjs`, `write_*_manifest.mjs`, collision `build_collision_manifest.mjs` → `author_collision_sidecars.mjs` → `validate_collision_manifest.mjs` → `export_runtime_collision_manifest.mjs`) → **sync** (`sync_web.mjs` for props/anims; characters via explicit allowlist from `characters-final/`) → **hand-author placement** in `manifest.ts` / `densityManifest.ts`.

**Reuse-first rule:** the inventory is deep (122 props). Prototype every new system by **re-tinting/re-placing existing assets**; only commission new GLBs where nothing reads acceptably. `RiggedCharacter` already supports multiplicative tint + seeded height.

## B.2 Act-1 asset worklist
| # | Asset need | Approach | Pipeline | Collision | Priority |
|---|---|---|---|---|---|
| 1 | **Watchman / constable rig** | **Prototype:** tint `officer-rigged` (+ `taxclerk-rigged`) via existing tint palette. **Production:** commission `constable-rigged` (tricorne, dark coat, baton) via character path (Meshy rig → rest-delta bake). | `gen_character_from_image` → `rig_character.mjs` → `optimize_rigged.py` → `bake_character_anims.py` (NPC 10-clip subset) → allowlist sync | none (no NPC colliders) | P0 prototype / P2 production |
| 2 | **Watcher props** (baton, hand-lantern, warrant satchel) | small props; optional for prototype | `gen_prop_from_image` → `optimize_missing_props.py` → collision `none` | `none` | P2 |
| 3 | **Watch house (inspector's office) landmark** | **[LOCKED]** Reuse `bldg-townhouse-civic` + `stone-steps` as a distinct **watch house** (separate from the Custom House); add a new **`sign-watchhouse.png`** texture + a named `INSPECTOR_OFFICE` anchor & release-spawn. | poster/sign via concept gen; placement in `manifest.ts` | reuse building sidecar | P1 |
| 4 | **Refuge / hide affordances** | **Reuse** doorways (slam-to-interior), dense crowd, `market-stall`/`crate-stack`/`hay-cart` as cover. Add **semantic `REFUGE`/`HIDE` markers** (data, not new art) + optional 1 hide prop (curtained alcove) later. | data only (markers) + optional 1 prop | tag existing sidecars w/ `los-cover` | P1 (markers) / P3 (prop) |
| 5 | **Roof route completion** | Enable + place existing `roof-ramp-cart`, `work-ladder`, `balance-plank`, `scaffold-low`, `crate-stack`; commission 1-2 **`roof-walk-board`** modules to bridge gaps. Enable `BALANCE`/`JUMP_GAP` in `DENSITY_TRAVERSAL_TYPE_STATUS` where used. | `gen_prop_from_image` → `optimize_road_kit.py`-style → sync; placement | authored support polygons (walkable) | P2 |
| 6 | **Alley chokepoints** | **Place** already-built `infill-passage-gate`, gate-wings, `service-wall-*`, `duck-beam-frame` in `densityManifest.ts`; finalize pending opening collision. | placement + collision finalize | finalize pending door/opening profiles | P1 |
| 7 | **Watch checkpoint dressing** (optional booth/barrier) | reuse `bollard` + `hand-cart` + barrels as a makeshift checkpoint; new booth only if needed | reuse | reuse | P3 |
| 8 | **Effigy of Andrew Oliver** (event prop w/ placard) | 🟡 verify the fixed event already stages an effigy; add a readable **placard texture** for `MICRO.ANDREW_OLIVER` | concept poster; event staging | `none` | P1 |

**Net new GLB commissions for a full Act 1:** realistically **1 character** (constable) + **1-2 roof boards** + optional watcher props/hide prop. Everything else is **placement + tint + data + textures** on the existing library. This keeps the expensive pipeline load small.

## B.3 Collision & the shared-world blocker
Runtime collision is built **inside `Player`** from `manifest.ts` rects; the generated sidecar adapter (`outdoorCollisionAdapter.ts`) exists but **isn't wired into `World3D`**. For stealth we need **LOS queries against the same geometry** → **engineering task D.0.1: lift collision-world construction into a shared service** `World3D` owns and passes to both `Player` and `WatcherDirector`. This is the single most important prerequisite and blocks Part D.

---

# PART C — What animation each activity needs

## C.1 The two hard laws (both verified against code)
1. **No-mocap law:** mechanics animate the **object/prop** (`MechanicRigs`, `pa:mechanic-visual`) and hold a **generic library clip** on the body. Do not author bespoke skinned performances per beat.
2. **Traversal clips are phase-driven:** `Player.clipForPhase()` maps `MotionPhase → clip` (`VAULT→vault`, `CLIMB_UP→climbUp`, `STANDING_JUMP→jump`, etc.). New traversal = a new phase + a clip mapping, **not** a marker animation.

Clip library is **baked into each character's GLB** (35 for the player, 10-clip NPC subset for others). There is **no runtime retarget** — adding a clip means re-baking characters (see C.4).

## C.2 Animation coverage per activity (object vs. body vs. new)
| Activity | Object anim | Body clip (existing) | FP hands | New baked clip? |
|---|---|---|---|---|
| Print job (ink/register) | press rig ink-ball + sheet-register tweens (extend `ProceduralPress`) | `work1` / `reach` | ink balls, sheet | **no** |
| Pull/slam/peel | lever/platen/sheet (exists) | `work1` | bar, sheet | no |
| Conceal fold | wrap-fold prop tween | `work1` | fold paper | no |
| Haul | bolt staging (exists) | `carry`/`carryWalk` | — | no |
| Sort | fan-slide (exists) | `work2`/`search` | drag items | no |
| Post notice | line-up + tacks (exists) | `reach`/`work1` | line up, tap | no |
| Handoffs | bundle travel (exists) | `handoff` | bundle | no |
| Headline construct | type-set + final pull | `work1`/`work2` | set type | no |
| **Watcher idle/patrol** | — | `idle` / `walk` / `run` (NPC subset ✅) | — | **no** |
| **Watcher alert/point** | — | `talk2` or `argu1` (reuse) | — | no (optional `point` later) |
| **Chase: sprint** | — | `run` | — | no |
| **Chase: hops** | doors/props | `jump` / `runJump` | — | **yes — bake `jump`/`runJump`** (already queued w/ v5) |
| **Chase: winded** | — | `idle` (reuse) | — | no (optional `winded`) |
| Misdirection (throw/ring) | prop (bell/object) | `reach` / flavor pose | — | no |
| Caught / chewed-out scene | — | `idle` + officer `talk`/`argu1` | — | no |
| Ad-hoc NPC chat | — | `talk`/`talk2` (NPC subset ✅) | — | no |

## C.3 Net animation work
- **Genuinely new baked clips: essentially just `jump` + `runJump`** (already queued with the `playerboy-v5/v6-native` GLB — **prioritize baking them**; they're load-bearing for the chase). Everything else reuses existing clips because objects carry the action.
- **Watchers need NO new clips** — the 10-clip NPC subset (`idle/walk/run/talk/talk2/argu1/...`) covers posted, patrol, and alert states.
- Optional polish clips (defer): `point`/alert gesture, `winded` idle, a `shove` for `EVENT_PUSH`.

## C.4 Adding a new clip (if we decide to, e.g. `point`)
Per the pipeline: get a 30fps Mixamo motion FBX → `assets/source/mixamo/<clip>.fbx` → add the name to `bake_character_anims.py` + `bake_native_mixamo_character.py` (+ `ROOT_MODE`) → add to the character subset in `build_cast.mjs` → add to `animationManifest.ts` (`PLAYER_CLIPS`/NPC list, and `PLAYER_ACTION_CLIPS` if play-once) → **re-bake every character needing it** → `inspect_glb.mjs` QA → copy to `characters-final/` → `sync_web.mjs`. There is no shortcut; a shared library alone won't work at runtime.

---

# PART D — Stealth & chase systems (the mechanics)

All deterministic (sim state + inputs + attempt seed; **no live RNG**). Bounded per Gameplay-Design §L-D: they move suspicion/heat/access, **never learning, never a dead-end**.

## D.0 Foundational engineering (prerequisites — build first)
1. **Shared gameplay world service.** Lift the collision-world build out of `Player` into a `World3D`-owned service exposing `sweepXZ` **and a new `segmentClear(a,b)` LOS test** (segment vs. the same XZ blocker rects, honoring vertical spans). Pass it to `Player` (unchanged behavior) and `WatcherDirector`.
2. **Actor registry.** A `World3D`-owned registry where `DirectedNpc` and watchers publish `{id, position, forwardVec, kind}` each frame, so watchers/pursuers can be queried. Ambient crowd stays private; **watchers/pursuers are dedicated actors owned by `WatcherDirector`/`ChaseDirector`** (not ambient route sampling), so they have authoritative motion + forward vectors.
3. **Stealth store** (`stealthStore`, patterned on `QuestMarkerHud`): `{stamina, suspicion(max over watchers), detectionState, heat, standing, chaseActive, nearestWatcherDir}` written by directors, read by HUD via `useSyncExternalStore`.
4. **Camera-ownership split.** Refactor `Player.cameraOverride` into two flags: `cameraControlledExternally` and `inputLocked`. Chase needs external camera **with live movement**; choreography needs both. Precedence: choreography/FP > chase > free-roam.
5. **Heat persistence.** Store heat (+ Clarke-marked, Standing) in the runtime contract / `Play`, not local `World3D` state, so it survives interior transitions and feeds the day.

## D.1 Stamina (chase/timed-dash only; invisible in free-roam)
- State `stamina ∈ [0,1]` added to a player resource slice; **gate Shift in `freeMoveSpeed()`** so sprint requires `stamina > 0` **and** `chaseActive || timedDash`.
- Update beside `stepMotion()` with frame `dt`:
  - sprinting: `-0.28/s` · vault/climb: `-0.15` per action · walk/idle: `+0.22/s` · empty: forced jog (cap speed to `JOG_SPEED 3.2 m/s`) + slow/"fumbled" vaults.
- Publish `stamina` on `PlayerMotionStatus`; HUD bar (D.8). **Tunable — validate in the vertical slice.**

## D.2 Watchers (`WatcherDirector`, new)
- **Posted watcher:** fixed position, slow scan (yaw oscillates ±`SCAN_YAW 0.6 rad` at `SCAN_RATE 0.3 rad/s`). Cone: half-angle `35°`, range `12 m`.
- **Patrol watcher:** authored waypoint loop (reuse `buildRoute`/`sampleRoute` pattern but as an owned actor with forward = velocity dir). Cone: half-angle `28°`, range `10 m`.
- **Placement [LOCKED ≤4 active + crowd]:** Custom House chokepoint (posted ×2), the watched square near Clarke (patrol ×1-2), town-edge toward the rider (posted ×1) — capped at 4 active at peak. Cone *length* (not count) scales with the escalation clock later in the day.
- Rendered with tinted `officer-rigged` (prototype) → `constable-rigged` (production); clips `idle`/`walk`/`run`/`talk2`.

## D.3 Detection & suspicion (deterministic, graduated)
Per watcher each frame, compute **visibility** `v ∈ [0,1]`:
```
v = coneFactor · distanceFactor · exposureFactor · movementFactor · coverFactor,  gated to 0 if !segmentClear(watcherEye, playerChest)
  coneFactor     = smoothstep(cos(halfAngle), 1, dot(coneForward, dirToPlayer))     // 1 center → 0 edge
  distanceFactor = clamp01(1 − dist/range)
  exposureFactor = exposed 1.0 | wrapped 0.5 | hidden 0.15                           // concealment state
  movementFactor = still 0.5 | crouch 0.4 | walk 0.8 | sprint 1.3 | vault/climb 1.5
  coverFactor    = inCrowd/inCover 0.3 | open 1.0
```
Integrate suspicion `S ∈ [0,1]`:
```
dS/dt = v>0 ?  +K_up  · v · heatMult · standingMult
             :  −K_down                                   // decays out of LOS
  K_up 0.6/s, K_down 0.5/s
  heatMult     = calm 0.8 | noticed 1.0 | watched 1.25 | hunted 1.6
  standingMult = high 0.7 | neutral 1.0 | marked 1.4
```
- **Tells (diegetic, telegraphed):** `S≥0.35` watcher head-turns toward you + soft audio sting; `S≥0.7` watcher breaks toward you ("Hold there…"); `S≥1.0` → **confrontation (D.6)**. HUD suspicion pip mirrors the max-S watcher.
- **Spot-checks** (chokepoints, e.g. Custom House): a **deterministic** check fires when you cross the checkpoint volume if `standing<high` and `heat≥noticed`; wrapped/hidden + high Standing passes; otherwise → confrontation. No dice — outcome is a function of state + seed.

## D.4 Heat (global, persistent, acute)
State machine `calm → noticed → watched → hunted` (stored in runtime contract):
- **Up:** first `S≥0.7` tell → `noticed`; a comply/inspection or failed talk → `watched`; a **run/escape or confiscation** → `hunted`.
- **Down (decay):** `hunted→watched` after `45 s` with no contact; `watched→noticed` after `60 s`; `noticed→calm` after `90 s`. Timers pause while in a watcher cone.
- Heat feeds `heatMult` (D.3), watcher density/cone length, and NPC lines. Carries into the day-end read.

## D.5 Standing (social camouflage — `StandingCard`, new)
- Band `marked → neutral → familiar → trusted`, built by **tracked** unnamed-crowd interactions + side-jobs (each `+standingPoints`); helping/greeting raises it, curt/caught lowers it. Persistent, town-wide, slow-moving (contrast heat = fast).
- Feeds `standingMult` (D.3) and spot-check rate (D.3). Named-cast standing can additionally **vouch** (one-shot heat bleed) or **inform** (Clarke → `marked` + heat).
- Rendered as a player card (band, never a number) in the Archive overlay; **not** a morality meter.

## D.6 Confrontation branch (bounded; never a dead-end)
Triggered by `S≥1`, spot-check fail, or Clarke informing. Options (≤3):
- **Comply** — 1st-person bag inspection. `hidden`/`wrapped` + a seeded draw → passes (heat→`watched`); `exposed` → confiscated + reroute (§7). Teaches writs-of-assistance micro.
- **Talk out** — social check vs. Standing (harder if Clarke informed / high heat). Success → released, heat→`watched`; fail → forced to comply or run.
- **Run** — → **escape sequence (D.7)**; heat→`hunted`.

## D.7 Escape sequence + chase (`ChaseDirector`, new)
- **Pursuer** = dedicated actor with a simple steering motor toward the player at `PURSUER_SPEED 4.3 m/s` (just under fresh sprint `4.6`), **delayed** by obstacles it must path around (reuse `segmentClear` to detect blocked straight-line → it slows/rounds corners) and by each vault the player takes. Higher heat → +1 pursuer and/or `+0.2 m/s`. Fully deterministic.
- **Player** keeps live movement (camera split D.0.4); stamina (D.1) is the skill: burst to open a gap, spend vaults to cut corners, then break LOS. Empty stamina → jog `3.2 < 4.3` → you *will* be caught unless already hidden.
- **Shake (win):** break `segmentClear(pursuer,player)` **and** hold distance `>SHAKE_DIST 8 m` for `SHAKE_HOLD 4.5 s`, **or** reach a `REFUGE` marker (slam an interior door / deep crowd). → keep goods + errand; **heat stays `hunted`**; face known (carryover). Reuse `CUSTOMS_SLIP` staging for the "lost them" beat.
- **Caught (lose):** pursuer within `CATCH_DIST 1.2 m` while player stamina `=0` **or** cornered (no valid move for `2 s`). → short **chewed-out scene** (officer `talk`/`argu1`, player `idle`), contraband **confiscated** if carried, then **released outside `INSPECTOR_OFFICE`, clock advanced** (`+ escalation step`; a timed window like the rider bell may be blown), heat→`hunted`. **Learning reroutes, never lost.**
- **Accessibility:** assist mode — slower pursuer / auto-stamina / or a single confirm-to-resolve with the *same bounded outcome*; full keyboard path (no mouse-look required).

## D.8 HUD (via `stealthStore` + DOM overlay, `QuestMarkerHud` pattern)
- **Stamina bar** — visible only when `chaseActive || timedDash`; reuse the daylight-meter `div`-width pattern in `Hud.tsx`.
- **Suspicion pip** — appears near the reticle when any `S>0`, fills with max-S; color-shifts at the `0.35/0.7` tells; directional chevron to `nearestWatcherDir`.
- **Heat** — a small persistent state chip (calm→hunted) + Archive overlay history.
- **Standing** — Archive overlay card (persistent), not moment-to-moment.
- Accessibility announcements through the store like `QuestMarkerHud` already does.

## D.9 Determinism & test hooks
- All factors are pure functions of authored patrols + player state + a per-attempt seed. Reuse the `collisionMotion.test.ts` / `traversalResolver.test.ts` style: unit-test `segmentClear`, the suspicion integrator (given a scripted path → expected S curve), the chase shake/caught conditions, and stamina drain/regen. No wall-clock, no RNG.

---

# PART E — Build order (milestones)

1. **M0 — Foundations (D.0):** shared collision/LOS service + `segmentClear`, actor registry, `stealthStore`, camera-ownership split, heat-in-contract. *No player-visible feature yet; unblocks everything.*
2. **M1 — Stamina + chase vertical slice:** stamina (D.1) + `ChaseDirector` (D.7) + one scripted pursuer + caught/shake + HUD bar. Prove the *feel* with tinted `officer-rigged`. Bake `jump`/`runJump`.
3. **M2 — Watchers + suspicion + heat (D.2-D.4):** `WatcherDirector`, cones, suspicion integrator, tells, heat bands. Wire the B8 watched street + B9 confrontation.
4. **M3 — Standing + reactive world (D.5, Part A.5):** `StandingCard`, unnamed-crowd interactions, mobile named cast, knowledge-interactable tagging, 1-2 side-jobs.
5. **M4 — Content & assets (Part B):** constable rig, inspector-office landmark + sign, roof-board(s), chokepoint placement, effigy placard; enable extra traversal verbs as needed.
6. **M5 — Micro tracking + CP1 debrief (Part A.6):** engaged-micro tracker + debrief overlay + STAAR items.

Each milestone is independently playable/testable; M1 is the highest-risk "is it fun?" bet, so it goes first.

---

# Locked decisions (2026-07-21)

1. **Watchers:** **tint `officer-rigged`** through M1-M2 to prove the gameplay; **commission the dedicated `constable-rigged`** at M4. (Cheapest path to proving fun first.)
2. **Inspector's office = a distinct "watch house":** reuse `bldg-townhouse-civic` + a **new `sign-watchhouse.png`** texture and a named `INSPECTOR_OFFICE`/watch-house anchor. Kept separate from the Custom House (which stays the customs/notice chokepoint). No new building GLB.
3. **Constants:** ship the Part-D **initial defaults**, then **tune by feel in the M1 vertical slice**. Not locked yet.
4. **Roof route:** **minimal** — enable existing roof props + 1-2 bridge boards for a few escape routes; no full rooftop network in Act 1.
5. **Watchers on screen:** **up to 4 active watchers + crowd** at peak (posted ×2 at the Custom House chokepoint, patrol ×1-2 at the square/town-edge). Well within the 66-rig cap / 74m cull.
