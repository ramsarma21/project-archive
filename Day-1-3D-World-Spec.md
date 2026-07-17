# Day 1 3D World Spec (built state)

**Status: implemented and playable.** This documents the world as actually built in `apps/web/src/world/` plus the asset pipeline in `assets/pipeline/`. The machine-readable source of truth is [`apps/web/src/world/manifest.ts`](apps/web/src/world/manifest.ts); this file explains it. Grounded historical realism target per Production.md; the district is a compressed gameplay construct, topological not literal (no false geography is taught).

## 1. District topology (meters, y-up)

One east-west packed-earth street spine (x −52..52, z −6..6) with two building rows, plus two side lanes:

- **South row (fronts at z≈7):** rowB · Clarke's shop (−38) · rowA (−13) · **Mercer's Press (0)** · **Pike's office (14)** · rowC (26) · **Custom House (40)**.
- **North row (fronts at z≈−7.5):** **Thomas's counting-house (−30)** behind the market stalls · brick/clapboard fill rows (−16..32).
- **Northwest lane** (from x≈−38) → dock gate blocker → **rider post** at (−45, −29) with cargo, cart, crates.
- **Northeast lane** (from x≈32) → **Liberty Tree pocket**: the great elm at (44, −27) with the A.O. effigy hung from a low branch, crowd marks, and the approach anchor at (38, −21).
- Town notice-board at (6, 4.6) by Mercer's; well pump (−6, −3); carts, barrels, crates, market stalls per `PROPS`.

World bounds clamp: x ∈ [−56, 54], z ∈ [−40, 18]. Traversal legs stay in the 5–20 s window at walk speed 2.3 m/s (run 4.4).

## 2. Locations and runtime binding

`scene(locationId)` from the headless runtime teleports the player to `LOCATIONS[id].anchor`. Interiors (`MERCER_PRESS`, `THOMAS_COUNTINGHOUSE`, `PIKE_OFFICE`, `CUSTOM_HOUSE`) render a 2.75 m-high room shell (`room` def: center/size/door side) with warm candle fill; the street stays outside. When a `FREE_ROAM` request contains an exterior target (`STREET`, the four errand ids, `CROWD`), the player is placed at the location's `exitAnchor` facing the street — that is the "step out" state. Walking within 3 m of a marker fires `FREE_ROAM_GOTO` with that `targetId`; markers render gold/blue octahedron pings with ground rings and labels per Interaction-Spec §1.

Errand target anchors: `THOMAS_CIRCULAR` → Thomas's door, `PIKE_PROOF` → Pike's door, `CUSTOMHOUSE_NOTICE` → Custom House steps, `RIDER_HANDBILLS` → rider post, `CROWD` → elm approach, `MERCER_PRESS`/`STREET` → shop door / street center.

## 3. Time of day and ambience

The runtime clock (`view.clock.spentUnits / fixedEventBoundary`) drives the sun: elevation 58°→7°, azimuth 115°→245°, warm shift `#fff4e0`→`#ff8a3d`, plus fog `#cfd8de`→dusk `#3c2f28`. `phase === "DUSK"` or the Liberty Tree approach forces dusk with a bonfire point light at the elm. Ambient street population: two walkers pacing the spine (walk loops, position-lerped), two talkers at the market, idlers by the board, and two arguers near the elm — all suppressed while indoors.

## 4. Cast registry (all auto-rigged via Meshy, animated via shared Mixamo library)

| Character | GLB | Height | Source | Default clip |
|---|---|---|---|---|
| Player apprentice | `playerboy-rigged` | 1.58 | Meshy text-to-3D (A-pose, 1765 apprentice: shirt, waistcoat, ink-stained breeches) | idle/walk/run by speed |
| Abigail Mercer | `abigail-rigged` | 1.65 | **User-supplied** `abigail-boston.glb`, decimated 297k→55k tris, Meshy-rigged | work1 (in shop) |
| Thomas Bell | `thomas-rigged` | 1.74 | Meshy (merchant, brown wool coat, mustard waistcoat) | work2 |
| Mr. Pike | `pike-rigged` | 1.70 | Meshy (clerk, gray coat, ink-stained cuffs) | work1 |
| Edward Clarke | `clarke-rigged` | 1.77 | Meshy (loyalist shopkeeper, olive coat) | idle (doorway) |
| Post rider | `rider-rigged` | 1.76 | Meshy (riding coat, satchel) | work2 (at post) |
| Customs officer | `officer-rigged` | 1.78 | Meshy (civilian dark blue coat — 1765: no redcoat troops) | idle (checkpoint) |
| Custom House clerk | `clarke-rigged` reuse | 1.72 | shared model, distinct staging | work1 |
| Townsman/Townswoman | `townsman/-woman-rigged` | 1.68 | Meshy ambient archetypes | walk/talk/idle |

Characters normalize at load: uniform scale to spec height, feet grounded at y=0. A missing GLB degrades to a period-toned placeholder person (never a crash).

## 5. Animation library

30 user-supplied Mixamo clips (motion-only FBX, 30 FPS, `mixamorig` skeleton) baked by Blender into one `anim-library.glb` with named NLA clips: idle, walk, run, leftTurn, rightTurn, reach, search, carry, carryWalk, handoff, crouchIdle/Walk/Left/Right/ToStand, climbUp, climbDown, vault, work1, work2, cheer1, cheer2, talk–talk4, argu1, argue2, circleWalk1/2.

Runtime retarget (`apps/web/src/world/anims.ts`): bone-name map `mixamorig*` → Meshy rig (Hips, Spine/01/02, neck, Head, limbs), rotation keys rebased by rest-pose delta `qT = qTrest · qSrest⁻¹ · qS(t)`, hips translation rescaled by rest-height ratio. Clips are retargeted lazily per character and cached.

## 6. World asset kit (Meshy text-to-3D, grounded-realism prompts in `assets/pipeline/batch_world.mjs`)

Buildings: printshop (clapboard, shop window), brick Georgian townhouse, gray clapboard house, counting-house (hoist beam), Custom House (brick civic, cupola). Props: English common press, type cases, clerk desk, shop counter, cloth bolts, notice board, hand cart, barrel group, crate stack, market stall, well pump, dock fence gate, liberty elm. Each GLB is box-fit normalized to its manifest footprint at load, grounded, shadow-casting; anything not yet generated renders as a proportioned fallback shell (building with roof/door/windows or crate mass) so the world is always complete.

Interior dressing per room: Mercer = common press + type cases + desk; Thomas = counter + cloth bolts + crates; Pike = desk + document crates; Custom House = long counter + desk + posting board.

## 7. Pipeline commands (`assets/pipeline/`)

- `build_anims.py` — Blender: 30 FBX → `anim-library.glb` (NLA-named clips).
- `prep_abigail.py` — Blender: decimate + texture-shrink the supplied Abigail GLB.
- `rig_character.mjs` — Meshy rigging API for one prepped GLB (reads `MESHY_API_KEY` from `.env`).
- `gen_character.mjs` / `batch_characters.mjs` — Meshy text-to-3D preview→refine→rig for the cast.
- `gen_prop.mjs` / `batch_world.mjs` — Meshy preview→refine for buildings/props.
- `optimize_rigged.py` / `optimize_world.py` — Blender: decimate to web budgets (chars ~30k tris, buildings ~40k, props ~15k; textures ≤1024, JPEG85/80) into `assets/build/*-opt/`.
- `sync_web.mjs` — copy optimized GLBs into `apps/web/public/world/`.
- `shot_world.mjs` — Playwright headless playthrough + screenshots for visual verification.

Raw and optimized asset outputs are gitignored (regenerable); sources under `assets/source/` are the licensed local inputs.

## 8. Presenter integration (headless runtime unchanged)

`Play.tsx` renders `World3D` as the main surface: runtime `SCENE` → teleport; `FREE_ROAM` → world markers + walk-to trigger; all other input requests keep the dock controls (choices, press mechanic, sorts, Syncs). Last three dialogue/narration/Archive lines render as subtitle cards over the world; the latest `READ_PANEL` renders as a parchment overlay during read beats; the full transcript is available via the Log toggle. The Archive side panel, HUD day meter, mastery report, saves (local + cloud push for Google profiles), and the day-end card are unchanged. WebGL-unavailable devices fall back to the text dock, which remains fully playable.

## 9. Known gaps / next passes

- Remaining world GLBs still generating (elm, stalls, pump, counter, cloth, gate, printshop/clapboard shells); fallbacks cover them until synced.
- Clarke reuses the clerk model staging; a dedicated Custom House clerk variant is queued.
- Interior rooms are authored shells, not full hero interiors; press/type-case props land as their GLBs finish.
- No audio yet (ElevenLabs voices + ambience are the next pipeline stage).
- Retarget quality pass (shoulder/skirt review), crowd instancing for the dusk event, and Chromebook perf budgets remain open per Production.md §7/§9.
