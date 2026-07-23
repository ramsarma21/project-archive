# World Built State (Boston 1765)

**Status: implemented and playable.** This documents the world as actually built in `apps/web/src/world/` plus the asset pipeline in `assets/pipeline/`. The machine-readable source of truth is [`apps/web/src/world/manifest.ts`](../../apps/web/src/world/manifest.ts); this file explains it. Grounded historical realism target per `Production.md`; the district is a compressed gameplay construct, topological not literal (no false geography is taught).

## 1. District topology (meters, y-up)

The built world is **world layout v3 — "the big street"**: one long east-west packed-earth street spine flanked by two enterable building rows and two alley route corridors, running west (the wharf) to east (the town gate / Liberty Tree). The authoritative coordinates are [`apps/web/src/world/manifest.ts`](../../apps/web/src/world/manifest.ts); the full layout law is in [`World-Design-Bible.md`](../design/World-Design-Bible.md) §3. This is the orientation summary; the manifest governs.

- **Bounds:** x ∈ [−165, +108], z ∈ [−30, +30] (alleys included; the wharf pocket extends z accordingly; harbor water is collider-fenced).
- **The wharf (x −160 .. −118):** Town Wharf apron west of x ≈ −118, hero brig + sloop + rowboats, warehouses on the north side; the wharf gate joins the street.
- **West street (x −118 .. −40):** warehouses / chandlery / ropewalk south row; **Thomas's counting-house** (north row); the **rider post** in the north-alley mouth (~x −95); market stalls.
- **Mid street (x −40 .. +25):** **Mercer's Press** anchor at [0, south row]; tavern; **Clarke's shop**; well / pump; the **town notice board at [6, 0, 8.8]**.
- **East / civic end (x +25 .. +80):** **Pike's office**, the **Town House square (x +45 .. +62)** (King Street / Massacre stage, Day 2 reuse), the **Custom House** facing it across the square, and the church with white steeple.
- **East gate + Liberty Tree (x +80 .. +105):** the **east gate at x = +80**; the lane bends NE to the **Liberty Tree pocket at [+95, −25]** (elm, effigy rig, crowd ground) where EventDirector stages the effigy hanging.
- Alleys run both rows the full length (duck laundry, vault crates, squeeze) as the unseen route options; a route is *state*, not geometry.

Two readable surfaces are distinct and must not be conflated: the **town notice board** at [6, 0, 8.8] by Mercer's is a **focus-read knowledge surface** (read the posted Stamp Act bill), whereas the **Custom House notice** is the **posting errand** (`CUSTOMHOUSE_NOTICE` → Custom House steps) — a placed/posted beat at the civic chokepoint, not the town-board read.

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

## 4. Cast registry (auto-rigged via Meshy, per-character baked Mixamo clips)

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

## 5. Animation (per-character baked Mixamo clips)

Animation is **baked per character**: each character GLB ships self-contained named clips. The player carries the full set (idle, walk, run, leftTurn, rightTurn, reach, search, carry, carryWalk, handoff, crouchIdle/Walk/Left/Right/ToStand, climbUp, climbDown, vault, work1, work2, cheer1, cheer2, talk–talk4, argu1, argue2, circleWalk1/2, and the queued jump/runJump); other cast carry the 10-clip NPC subset (idle/walk/run/talk/talk2/argu1/…). Source motion is 30 FPS Mixamo FBX baked by Blender during the character pipeline (`bake_character_anims.py` / `bake_native_mixamo_character.py`).

There is **no runtime retargeting and no shared animation library** — the former `anims.ts` runtime retarget path (and the single `anim-library.glb`) has been removed. Adding a clip means adding the motion to the bake step and re-baking each character that needs it (see `Production.md` §C.4), not remapping bones at runtime.

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

- `bake_character_anims.py` / `bake_native_mixamo_character.py` — Blender: bake the 30 FPS Mixamo FBX motions into each character GLB as named clips (per-character; no shared library).
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
