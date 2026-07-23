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

`scene(locationId)` from the headless runtime declares authored context; it does **not** move the player. Exterior travel is continuous. With several available errands, `FREE_ROAM_SELECT` first collapses the field to one gold objective while leaving the player where they stand; only physically reaching that ping emits `FREE_ROAM_GOTO`.

All 36 interiors now use independent isolated scene slots from
`interiorManifest.ts`; their dimensions are not constrained by exterior
footprints. The finalized exterior sensor/landing remains owned by
`doorwayContract.ts`. After the imported door's established swing beat, the
presenter mounts only the destination interior and places the player at its
local landing. The interior exit sensor reverses the transition to the
validated exterior landing. Anti-ping-pong arming, reduced-motion timings,
quest-marker alignment, and story event semantics are unchanged.

`District.tsx` renders either the exterior district or one `InteriorDirector`,
never both. Interior movement uses semantic wall, ceiling, furniture, support,
bounds, depenetration, and last-safe collision rather than a nominal room
clamp. Story cameras and actor/prop anchors for Mercer, Thomas, Pike, and the
Custom House are transformed into the isolated scene coordinates.

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

The interior factory adds 13 verified structural GLBs under
`world-v3-structures-opt` and 29 furnishing/trade GLBs under
`interior-kit-opt`. Structural keys cover domestic narrow/wide, shopfront,
workroom, warehouse, civic, meetinghouse, and ropewalk shells; board/plaster
partitions; and two pine plus one brick-work floor. Furnishings cover domestic
clutter, printing, merchant measurement, court/customs records, meetinghouse
box pews/gallery/pulpit, tavern service, warehouse tackle/scales, and specific
chandlery/ropewalk/tailor/shoemaker/baker/provisions/bookseller stock.

Mercer's centerpiece is `press-common-operable-v2.glb`: 34,997 imported
triangles, seven named imported nodes, and six clips (`pressPull`,
`pressRelease`, `carriageIn`, `carriageOut`, `tympanOpen`, `tympanClose`).
The press mechanic scrubs and commits those clips; the retired static press and
procedural mechanism no longer render. Physical papers use the imported
`int-paper-surface-flat` GLB with the existing runtime document textures.

Production interiors contain no visible React/Three room, furniture, paper, or
mechanism primitives. Missing/loading assets render null and fail manifest
tests instead of producing fallback shells.

## 7. Pipeline commands (`assets/pipeline/`)

- `build_anims.py` — Blender: 30 FBX → `anim-library.glb` (NLA-named clips).
- `prep_abigail.py` — Blender: decimate + texture-shrink the supplied Abigail GLB.
- `rig_character.mjs` — Meshy rigging API for one prepped GLB (reads `MESHY_API_KEY` from `.env`).
- `gen_character.mjs` / `batch_characters.mjs` — Meshy text-to-3D preview→refine→rig for the cast.
- `gen_prop.mjs` / `batch_world.mjs` — Meshy preview→refine for buildings/props.
- `optimize_rigged.py` / `optimize_world.py` — Blender: decimate to web budgets (chars ~30k tris, buildings ~40k, props ~15k; textures ≤1024, JPEG85/80) into `assets/build/*-opt/`.
- `sync_web.mjs` — copy optimized GLBs into `apps/web/public/world/`.
- `verify_interior_structures.mjs` / `verify_interior_kit.mjs` /
  `verify_press_v2.mjs` — parse, budget, grounding, texture, rig, named-node,
  and animation validation for the complete interior asset set.
- `optimize_interior_runtime_lods.py` /
  `verify_interior_runtime_lods.mjs` / `measure_interior_budgets.mts` —
  interior-only legacy-prop LODs, provenance checks, and exact per-room static
  triangle enforcement without changing exterior asset keys.
- `qa_interiors_browser.mjs` — dev-hook tour of all 36 interiors, collision and
  asset failures, draw/triangle probes, Archive inspect, and imported press
  response; supports day, drizzle, and dusk URLs.
- `shot_world.mjs` — Playwright headless playthrough + screenshots for visual verification.

Raw and optimized asset outputs are gitignored (regenerable); sources under `assets/source/` are the licensed local inputs.

## 8. Presenter integration (headless runtime unchanged)

`Play.tsx` renders `World3D` as the main surface. Runtime `SCENE` sets dialogue/choreography context without changing player coordinates. `FREE_ROAM` has separate select and arrive phases, live-distance pings, gold-objective redirect, explicit door crossings, and authored route waypoints. Action-bearing choices advance into playable mechanics or travel legs; they never use a generic animation timer as a substitute for the action. Fine work uses first-person mechanics, gross movement remains third-person, and seven-second `BREATHER` states return ordinary movement between resolved errands and the next prompted beat. Dialogue/narration/Archive lines render as timed subtitles over the world; tracked reads open only after their spatial approach and explicit focus-read input. The runtime activity clock remains deterministic while the HUD and world lighting ease toward each committed authored cost. WebGL-unavailable devices retain the typed fallback presenter.

## 9. Current verification and remaining art polish

- Exactly 36 `InteriorDef` records, unique explicit slots, target dimensions,
  imported references, hotspot anchors, and collision entry zones are tested.
- All interior assets, structures, and press v2 pass their factory verifiers
  and deployed-file checks.
- Browser QA visited all 36 rooms with no missing `/world/**`, page, runtime,
  or WebGL errors. Representative drizzle and dusk tours also passed.
- Peak interior draw calls in the current tour are 43. Total renderer triangle
  probes peak around 783k and include the player plus animated occupants. Exact
  deployed-GLB static totals peak at 213,993 for common rooms, 330,996 for
  non-church heroes, and 488,993 for the meetinghouse, all within budget.
- Web typecheck/build, all 137 current world tests, runtime tests, and happy/missed-Sync
  full autoplay paths pass.
- Remaining work is optional art polish: tune a few generated shell
  silhouettes/materials after target-Chromebook review and replace reused
  ambient character variants when additional historically reviewed rigs land.
