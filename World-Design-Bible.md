# World Design Bible — 1765 Boston (Project Archive)

**Status: build authority for the overnight world expansion.** Every asset, layout, system, and prompt decision for the 3D world references this document. It is subordinate to `Day-1.md` (behavior) and `Interaction-Spec.md` (interaction rules); it owns look, layout, atmosphere, and traversal. When the Day 1 script changes, beats rebind to this world; the world does not rebind to beats.

Related: `Day-1-3D-World-Spec.md` (current built state), `Production.md` (pipeline + no-mocap laws), `apps/web/src/world/manifest.ts` (machine-readable layout).

---

## 1. The fantasy

The player steps out of Mercer's Press onto a working Boston street in August 1765 and believes it. Overcast gloom, wet cobble sheen, gulls over the masts at the wharf end, a church bell counting the hour, carts and voices end to end. The reference mood is the user's approved concept image: dense timber-and-brick frontage, hanging trade signs, low gray sky, lantern glow in windows, people reading a Stamp Act bill on a post. Cozy, tense, alive, historical: never a theme park, never Minecraft-empty.

## 2. Historical grounding (only add what 1765 Boston could plausibly hold)

- Boston 1765: ~15,500 people, a peninsula town of ~80 wharves. **Long Wharf** ran ~1,586 ft from the foot of King Street into the harbor; up to 50 vessels; warehouses and counting houses along its NORTH side; ships unloaded directly into them. King Street ran Town House → shoreline → became the wharf. Our dock district is a compressed homage: "Town Wharf," one hero pier with warehouses on the north side, 2 moored square-rigged merchant vessels (brig/snow) + small sloop + rowboats.
- Buildings: 2.5-3.5 story timber clapboard and brick Georgian rows, gambrel and gable roofs, brick chimneys, small-pane sash windows, hanging pictorial trade signs, shutters. Church with white steeple (Old South Meeting House style). Town pump, market stalls, rope coils, barrels (shipping town = cooperage everywhere), firewood stacks, hitching posts, hay carts.
- Streets: packed earth and cobble, wheel ruts, standing puddles, no sidewalks; narrow with jettied upper floors in spots.
- People: laborers, dockhands, merchants, goodwives, apprentices, a town crier, fish sellers. **NO British troops** (they arrive 1768). Enforcement = customs officers, constable, Loyalist informers.
- Light: whale-oil lanterns on brackets, candlelight windows, no street gas. Night is DARK with warm pinpricks.
- Sounds: gulls, rigging and hull creak, water lap, cart wheels on stone, hammering, market chatter, church bells on the hour, dogs, wind. Press thump indoors.

## 3. World layout v3 (coordinates, y-up meters) — THE BIG STREET

User-approved structure. The street is ~2.5x longer and wider than the old build, the hero stops are spread far apart, and the cross-section is a sandwich:

```
        painted Boston backdrop / skyline ring          (z ~ -55)
        NORTH ALLEY  (semi-explorable route corridor)   (z -26 .. -20)
        NORTH BUILDING ROW (all enterable)              (z -20 .. -10)
        THE STREET (wide, packed earth + cobble)        (z -10 .. +10)
        SOUTH BUILDING ROW (all enterable)              (z +10 .. +20)
        SOUTH ALLEY  (semi-explorable route corridor)   (z +20 .. +26)
        painted Boston backdrop / skyline ring          (z ~ +55)
```

West→east along x (explorable span dock → Liberty Tree):

- **THE WHARF (x -160 .. -118):** Town Wharf apron (Long Wharf homage): timber-stone pier, water plane south+west (y ≈ -1.1), hero brig + sloop + rowboats moored, warehouses/counting houses on the NORTH side, crane/hoist, cargo, fish flakes, gulls. Wharf gate arch at x ≈ -118 joins the street. 3m clear apron beside the brig (future Tea Party boarding). Dead-port dressing hooks (chains, empty berths) for Day 4 reuse.
- **West street (x -118 .. -40):** warehouses/chandlery/rope walk south row; **Thomas's counting-house at [-70, north row]** (rebuilt, bigger); **rider post in the north alley mouth at x ≈ -95** (timed stop lives on the wharf approach); market stalls cluster ~[-55..-45].
- **Mid street (x -40 .. +25):** heart of town. **Mercer's Press stays the anchor at [0, south row]** (player home base, larger interior). Tavern ("Bunch of Grapes" style) north row at [-18]. **Clarke's shop south row at [-32]** (his doorway watches the main route). Well/pump at [-8, street median]. Town notice board at [+6]. Row homes (all enterable) fill every other slot.
- **East street / civic end (x +25 .. +80):** **Pike's office at [+30, south row]** near the **Town House square at [+45..+62]** — brick civic building with balcony on the north side (this square is the King Street / Massacre stage for Day 2 reuse) — **Custom House at [+55, south row]** facing it across the square. **Church with white steeple at [+72, north row]** (Old South stand-in: tea-meeting reuse) with small churchyard + pump.
- **East gate + Liberty Tree (x +80 .. +105):** timber town gate/palisade at +80 ("road to the Neck" backdrop beyond); the lane bends NE to the **Liberty Tree pocket at [+95, -25]** (elm, effigy rig, crowd ground, vantage roofs) — EventDirector staging migrates here.
- **Alleys (both rows, full length):** narrow, cluttered, gloomier; laundry lines (duck), crate squeezes, scaffolds (climb), rear doors of hero interiors. Alley ends and mid-block cuts are conveniently walled (fences, stacked cargo, house backs) so only authored openings connect alley ↔ street: west mouths, mid cuts at x ≈ -12 / +18, east mouths.
- **Routes for the rider run (physically distinct end to end):**
  - MAIN street: fastest, past Clarke, most watched.
  - NORTH ALLEY: behind the north row the whole way; parkour flavored (duck laundry, vault crates, squeeze) — slower, unseen.
  - DOCK route: south alley west mouth → wharf boardwalk along the water → rider. **Blocked by default** (chained swing-gate + dockhand at the south-alley west mouth ~[-40, +22]); unlocks with Thomas's favor (route state already in runtime).
- **Route gating law (from the docs, verbatim intent):** a route is state, not geometry. When a beat/favor hasn't opened it, its entrance is blocked by a diegetic object (chained gate, stacked cargo, a dockhand shooing you off, a cart); the blocker conveniently opens/moves when the story calls for it (`routes.THOMAS_DOCK_ROUTE === "UNLOCKED"` etc). Same mechanism reused for every alternate path across all Boston days.
- **Background skyline ring:** low-poly rooftop/steeple silhouette clusters at z < -50, z > +50, x < -170, x > +110, plus harbor-haze and hill billboards; every walkable sightline ends in Boston, never void.
- **Bounds:** x [-165, +108], z [-30, +30] exterior (alleys included); wharf pocket extends z accordingly; water is collider-fenced (bollards + rope rail).
- **Existing anchors:** this layout MOVES Thomas, Pike, Customs, rider, elm, and widens the street. All coordinate tables must be rebound together in one pass: `manifest.ts` (BUILDINGS/PROPS/LOCATIONS/MARKER_ANCHORS/NPCS/AMBIENT), `choreography.ts` STAGE_ANCHORS + cues, `DoorDirector`, `EntryDirector`, `EventDirector`, `FocusReadStaging`, `MechanicRigs`, colliders. Interior room defs move with their buildings. Day-1 runtime logic/IDs do not change.

## 2A. Eastward expansion — the Lexington/Concord country road (A4 gated corridor)

**Purpose:** deliver the one true out-of-town gap — **Lexington & Concord** (and, from the same edge, Washington's arrival at the **Siege of Boston**) — without building a second explorable town. This is a narrow linear "chute" appended east of the existing town gate, **blocked until Act 4 (1775)** by a diegetic barrier, terminating in a compact militia-green + North-Bridge pocket. It is an *appendage*, not a town expansion. Curriculum payoff: (4)(C), (1)(B) setup, (22)(A). See `Curriculum-World-Map.md`.

**Why east:** the west/southwest is the protected **harbor exclusion** (open water — never extend land there). The corridor extends **east/positive-x**, past the existing **east gate (x+80)** and **Liberty Tree pocket ([+95,-25])** — historically apt, since the Liberty Tree sat by the road out of town toward the Neck. The road is a *compression* of the real Neck → Roxbury → country-road route into one lane (note the abstraction; keep dressing rural, not suburban).

**Bounds extension:** exterior town bounds stay **x [-165, +108]** for Acts 1–3. In Act 4, the walkable bound extends east to **x ≈ +260** *only along a tight lane* **z [-14, +14]** (a country road, not a plaza). The background skyline ring's east clip (x > +110) is pushed to **x > +265** for A4, and its dressing swaps from town rooftops to **low hills / tree line / distant steeple** so sightlines still end in world, never void.

**Segment map (west→east), all imported GLB per the visible-assets rule:**
- **The town gate portal (x ≈ +105):** the existing palisade/gate at the east end becomes a **real portal**, not a backdrop. **Blocked by default** (closed fortified gate + posted sentries + a cart) — the standard route-gating blocker. Unlocks on the A4 alarm (`routes.COUNTRY_ROAD === "UNLOCKED"`), mirroring `THOMAS_DOCK_ROUTE`.
- **Country road (x +108 .. +210):** road-kit surface (reuse `road_kit` / `write_road_kit_manifest.mjs`), flanked by **stone walls, split-rail fence, scattered trees, a milestone marker, a lone farmhouse + barn**. One or two authored traversal spots (vault a stone wall, cross a plank over a ditch) to keep it a *doing* corridor, not a walk. Ambient: birdsong/wind bed (swap of `AmbientAudio` zone), no harbor.
- **Lexington Green pocket (x ≈ +215, z 0):** a small triangular common with a **meetinghouse facade** (colonial-kit reuse) and a **militia line** staging anchor — directed dawn confrontation (militia vs. regulars) played as a bounded EventDirector set-piece; no player combat.
- **Concord North Bridge pocket (x ≈ +250):** a short **timber bridge** over a narrow **stream** (animated water is allowed procedurally per the rule; banks/bridge are imported GLB), with a far-bank field. Finale staging anchor for "the shot heard round the world" + the march-back framing.

**Route-gating & state:** identical mechanism to existing routes — entrance blocked by a diegetic object until the beat opens it; `COUNTRY_ROAD` route state drives the gate, the extended bounds, the skyline-clip swap, and the ambient-zone swap. For Acts 1–3 the gate is closed and the corridor is not loaded/walkable.

**New assets (pipeline: Gemini concept → QA → Meshy → Blender optimize → manifest → sync):** fortified town gate (closed variant) · stone wall + split-rail fence modules · country milestone · farmhouse + barn · meetinghouse facade (may reuse church kit) · timber country bridge · stream banks · rural tree clusters. Road surface + skyline hills reuse existing kits.

## 3A. Multi-day reuse map (build once, re-dress per day)

| Boston day | Event | Where it stages on this street |
|---|---|---|
| Day 1 (1765 Stamp Act) | effigy hanging, march | Liberty Tree pocket + full street |
| Day 2 (1770 Massacre) | King Street confrontation | Town House square (+45..+62) + Custom House steps |
| Day 3 (1773 Tea Party) | Old South meeting → wharf boarding | Church interior → torchlit street walk → wharf brig apron |
| Day 4 (1774 Port Act) | dead port, occupation dressing | Wharf (empty berths, chains), gates manned, street subdued |

Landmarks required NOW so later days need only state re-dressing: Town House square + balcony, Custom House facing it, church with meeting-hall interior, wharf with boardable brig, gates, Liberty Tree pocket.

## 4. Explorable interiors (ALL buildings enterable)

All 36 street-facing buildings have independent one-floor scene spaces. Interior
dimensions are deliberately unrelated to exterior building footprints: a portal
crosses the finalized exterior `doorwayContract`, then lands in a stable isolated
96m-grid scene slot owned by `interiorManifest.ts`. Only the active interior is
mounted; exterior ground, buildings, density, population, water, weather, props,
barriers, and lights do not render indoors.

- **Hero interiors:** Mercer 22×16m; Thomas 24×16m; Pike 20×15m; Custom House
  26×18m; tavern 22×17m; meetinghouse 28×38m; hero warehouse 30×22m.
  Mercer contains two imported presses, composing/type work, proof and drying
  areas. Thomas is a merchant shop/workroom with a clear haul lane. Pike is a
  legal-document workroom. The Custom House has a gated public counter, clerk
  pen, records, posting wall, Crown arms, and seizure stock. The meetinghouse
  uses box pews, a five-metre aisle, high pulpit and sounding board, deacons'
  furniture, a three-sided gallery impression, and no altar/cross/organ.
- **Historically specific common interiors:** laborer, artisan, middling, and
  prosperous homes; mixed home-shop; chandlery, provisions, bookseller,
  mercery, dry-goods, and bakery shops; tailor and shoemaker workrooms;
  ropewalk, maritime stores, warehouses, and Town House chamber.
- **Imported-visible-world law:** shells, floors, partitions, furniture,
  papers, trade stock, and the operable press are GLBs/textures from the Gemini
  → Meshy → Blender → verification → sync pipeline. Missing assets render null
  and fail validation; there is no visible primitive room/furniture fallback.
- **Navigation:** the semantic collision world owns structural walls, ceiling,
  bounds, major furniture OBBs, depenetration, support, and last-safe recovery.
  Entrance zones remain 2×3m clear; primary/secondary circulation targets are
  1.2m/0.9m.
- **Optional learning:** nearby, faced objects expose Archive-teal `F —
  Inspect` context. Traversal F retains priority. Cards are 35–65 words,
  source-tagged as documented, representative, or inference, session-suppressed
  after reading, and never advance runtime, time, mastery, or saves.
- **Population:** exterior 3× density is untouched. A separate deterministic
  interior roster supplies up to six hero or three common workers, residents,
  clerks, clergy, keepers, apprentices, and customers without duplicating
  story actors.

## 5. Traversal & interactivity (the parkour layer)

Design after successful compact open worlds (Assassin's Creed's contextual one-button parkour, Uncharted's authored ledges, Zelda BotW's "if you see it you can touch it" spirit) scaled to a schoolable web game: **marker-based contextual verbs, one interact button, authored spots, never physics-fragile.**

Verbs (all effort-tier, spec §6; placeholder tween animations acceptable until real clips arrive):
- **CLIMB**: crate/cart/barrel stacks → shed roofs → the two authored VANTAGE ROOFS (cutscene-legal per Production §2AA): cart-to-roof by the elm square (observe vantage) and warehouse roof at the wharf. Ladder at the wharf crane.
- **VAULT**: fences, low walls, barrel rows (existing `vault` clip).
- **DUCK**: laundry lines in the back lane, low scaffold by rowB (repainting facade scaffold = also climbable), warehouse crate tunnels (crouch set exists).
- **JUMP/GAP**: short roof gaps on the vantage line (placeholder hop tween until a jump clip arrives).
- **SQUEEZE**: gap between rowD/rowE into the back lane (crouchWalk).
- **Interactive flavor**: town pump (splash), church bell rope (rings the bell), tavern bench sit, well bucket, cargo crane lever at wharf (lowers a net, pure flavor), rat/gull scatter triggers.
- Implementation: `TraversalDirector` with authored TRAVERSAL_MARKERS (id, kind, position, facing, path/end pose, clip or tween). Proximity + facing shows a small gold interact glyph; one key (E / tap) executes; player input locked for the beat; camera stays third person. Reduced motion = instant reposition.
- **Placement rule:** traversal spots must decorate the three rider routes and the two vantage roofs so route choice = different play, not just different corridor.

### Animation wishlist (for tomorrow — placeholders shipped tonight)
| Need | Used for | Tonight's placeholder |
|---|---|---|
| jump/hop (root motion) | roof gaps, puddle hops | tween arc + walk clip |
| ladder climb loop | wharf crane, church gallery | climbUp clip resampled |
| balance walk | wharf edge beam | slow walk + sway tween |
| sit-down / sit idle | tavern, church pews | teleport-seat + idle |
| rope pull | church bell, crane lever | reach clip + arm tween |
| push/shove heavy | moving a cart blocker | lean tween |
| swim (only if you want harbor fall-in) | else water = collider | blocked by rail (none) |

## 6. Sky, weather, day/night

One deterministic system driven by the runtime clock (`spentUnits / fixedEventBoundary`) + seed; presentation-only.

- **Sun path:** real arc: dawn low NE → noon high S → sunset NW; elevation/azimuth interpolated over day progress t. Existing DayLight extends rather than replaced.
- **Sunset/sunrise:** warm key + horizon gradient bands (authored palettes: dawn rose-gray, noon pewter, golden hour amber, dusk ember → the fixed event's torchlight).
- **Moon + stars:** after the boundary (evening beats: return, headline, close) the sky deepens to near-night: moon disc opposite the sun path, faint star field (additive points), windows/lanterns become the light sources.
- **Weather states (deterministic from day seed):** GLOOM (default: the reference image's overcast pewter sky, wet-sheen street), DRIZZLE (light rain streaks + puddle ripples + drips), CLEARING (broken clouds, god-ray-ish shafts late day). Day 1 uses GLOOM→DRIZZLE mid-day→CLEARING toward dusk so the burning effigy pops. Drifting cloud layer always.
- **Fog:** distance fog tuned per phase (thick gray morning → thin at dusk), plus harbor haze sprite at the wharf.

## 7. Water & ships

- Water plane with animated shader (two scrolling normal/na wave layers + vertex bob, dark green-gray, foam line at pilings), reflection faked with env tint — must run on Chromebook-class GPUs.
- Ships: 1 hero brig (masts, furled sails, rigging silhouette, bobbing ±2°), 1 background snow at anchor further out, 1 small sloop + 2 rowboats at the pier. Gentle bob/creak sway loops. Gulls: 4-6 billboard/low-poly birds on circular flight paths + perched.
- Tea Party future-proofing: pier and brig positioned so a later night scene can stage boarding from the pier edge (leave 3m clear apron beside the hero brig).

## 8. Ambient audio (no voiced dialogue yet)

WebAudio engine, zone + phase mixed, all loops generated via ElevenLabs SFX (key in .env) or synthesized; files in `apps/web/public/audio/`:
- Beds: street murmur (crowd walla, phase-scaled density), market clatter,
  harbor (water lap, rigging creak, gulls), interior room tone, press shop,
  church hush, tavern walla, warehouse creak, workshop tools, home hearth,
  civic murmur, and ropework. Interior street/rain bleed is faint and low-pass;
  church and warehouse beds use a cheap single delay tap.
- Events: church bell (rings on warning-stage changes + arriving at church square), cart pass-bys, dog bark, gull cries, door creaks on portal cross, thunder-less rain bed during DRIZZLE.
- Mix rules: crossfade by player zone (wharf/street/square/interior) over ~1s; density scales with clock phase (busier midday, tense sparse dusk); master volume setting; reduced-motion unaffected (audio fine), but respect a mute toggle in the HUD.

## 8A. Posters & signage (learning-concept layer)

Walls, posts, and boards carry period bills generated with Nano Banana (poster textures on planes, crisp at read distance). Content must tie to the chapter's learning concepts (per `Day-1.md` §2C and the chapter ledger): Stamp Act scope (stamped-paper schedules, "in force 1 November"), representation/consent ("no tax but by our own consent" broadsides), postwar revenue policy (Crown revenue proclamations), plus future-day seeds: non-importation/boycott notices, town-meeting summonses (church door), shipping/wharfage notices (warehouse walls). Ambient posters are UNTRACKED atmosphere (Interaction-Spec §2.1); tracked reads remain the authored FocusReadStaging objects. Every generated poster gets the standard QA pass + no anachronisms; hanging trade signs (pictorial: grapes for the tavern, sheaf for the baker, anchor for the chandler) come from the same pipeline.

## 9. NPC population (existing rigs + new archetypes)

New Meshy-generated archetypes (full pipeline: gen character → mixamo rig → bake → optimize → sync, same as the existing cast). Keep the count tight; tint/reuse for variety:
- **Dockhand/laborer** (rough shirt, kerchief) — wharf work loops
- **Sons of Liberty agitator** (leather apron, liberty-cap or cockade) — bill posting, huddled talk, event organizers
- **Customs/tax official** (dark suit, ledger, tricorn) — Custom House, checkpoint (officer-rigged already exists; this is the civil clerk variant)
- **Town crier / bellman** (greatcoat, handbell) — square announcements
- **Goodwife with basket** (market walker)
If any archetype fails the overnight rig pipeline, fall back to re-tinted existing rigs so density never suffers.

- Zones & counts (exterior, scaled by phase): street spine 10-14, wharf 6-8 (dockhands carrying, rope work), market 4-6, church square 3-4, back lane 1-2, elm pocket per event system.
- Loops: walkers with waypoint paths end-to-end (not just the middle), idlers in conversation pairs (argu/talk), workers (carry crates pier→warehouse, sweep, chop wood), a bench sitter, a bill-reader at the notice post (mirrors the reference image).
- Perf: cap ~26 skinned rigs exterior, distance-cull animation updates (mixer update skip beyond 35m), no shadows on ambient rigs.

## 10. Nano Banana (Gemini image) usage — prompts + QA

Script: `assets/pipeline/gen_concept_image.mjs` (TrueFoundry gateway; model `gemini-group/gemini-3-pro-image-preview`). Outputs → `assets/source/concepts/…` with `.prompt.json` sidecars.

**Two generation modes:**

1. **Design sheets** (world/interior scoping, NOT for Meshy): prompt prefix:
   > "Concept art design sheet for a historically grounded 1765 colonial Boston game level. Overcast gloomy daylight, wet packed-earth street, weathered timber clapboard and brick Georgian buildings, hanging trade signs, lantern glow. [SUBJECT]. Painterly but architecturally precise, muted pewter/umber palette, no modern elements, no text labels except period signage."
2. **Single-asset references** (Meshy inputs) — STRICT prompt template:
   > "Single [ASSET] only, centered, full object in frame, three-quarter view, plain light gray studio background, soft even lighting, no shadows on ground, no other objects, no people, no text or watermark. Historically accurate 1765 colonial Boston style: [DETAILS]. Realistic painted-wood/brick/canvas materials, muted colors, game asset reference photo style."

**QA checklist (read EVERY image before accepting; regenerate on any failure):**
- [ ] Single subject, nothing cropped, no extra objects/people/ground scene (asset mode)
- [ ] No text/watermark/labels (except intentional period signage)
- [ ] Period-plausible (no Victorian gas lamps, no troops, no anachronisms)
- [ ] Silhouette readable + materials distinct (Meshy quality depends on this)
- [ ] Style-consistent with the approved mood (pewter gloom, muted palette)
- Use `--edit` with an accepted image to derive variants (same building other angle, dusk version) for consistency.

**Meshy budgets:** buildings ≤ 40k tris, hero ship ≤ 60k, props ≤ 15k, texture ≤ 1024 (JPEG85) via `optimize_world.py`; sync via `sync_web.mjs`. GLBs land in `apps/web/public/world/props/` (tracked per .gitignore pattern).

## 11. Asset manifest (generation queue)

**Buildings/street:** church w/ white steeple · tavern facade w/ grapes sign · 6 row-house facades (3 clapboard weathered, 2 brick Georgian, 1 gambrel jettied) · scaffolded facade (climbable) · town gate + palisade · background skyline cluster x3 (low poly) · well/town pump (exists: reuse) · notice post (exists via FocusReadStaging) · street lantern bracket · hitching post · firewood stack · hay cart · market awning stall (variant) · churchyard fence.
**Wharf:** stone-timber pier edge modules · warehouse facade x2 (big + narrow) · timber crane/hoist · bollard · rope coil · cargo net bundle · crate mound · fish flakes rack · barrel cluster (exists: reuse) · gangplank · hero brig (furled sails) · anchored snow (simplified) · sloop · rowboat · buoy.
**Interior kits:** hearth+mantel · four-post bed · table+chairs set · dresser/shelves · counter · chest · spinning wheel · church pew block · pulpit · tavern table set · tankard cluster · candle sconce · ledger desk (exists: reuse clerk-desk) · crate canyon set (reuse crate-stack).
**Parkour props:** crate step-stack (authored heights 0.6/1.2/1.8m) · cart-to-roof ramp cart · laundry line (rope + cloth planes, tintable) · low scaffold section · roof walk boards.

## 12. Performance & platform budget

Chromebook target: keep exterior draw calls sane — merge static dressing into few groups, reuse GLBs aggressively (same facade re-tinted), LOD the skyline (single merged mesh), water shader cheap (no reflections/refraction rendering), max 2 shadow-casting lights (sun + event fire), everything else emissive/unshadowed. Frame budget: don't exceed ~350 draw calls exterior.

Interior budget: one active scene only; common ≤80 calls / 220k static
triangles / 3 ambient rigs, hero ≤140 calls / 450k static triangles / 6 total
rigs, meetinghouse ≤550k static triangles. The exact deployed-GLB budget
validator currently measures 213,993 maximum common, 330,996 maximum non-church
hero, and 488,993 meetinghouse static triangles. Interior lighting uses baked
textures, one unshadowed window key, one optional hearth fill, and at most two
unshadowed candle fills. The 36-room browser tour currently peaks at 43 draw
calls; renderer triangle probes include animated character rigs and are
therefore reported separately from static asset-manifest totals.

### 12A. Imported visible world law

Every visible physical production object or surface is an imported GLB and/or
an imported/generated texture produced through the established asset pipeline.
This includes buildings, ground, roads, alleys, barriers, traversal props,
street furniture, signs, foundations, clutter, interiors, and backdrop city
fabric. React/Three code may transform, animate, instance, or shade imported
assets, but must not construct visible physical stand-ins from box, cylinder,
plane, cone, capsule, or other procedural geometry.

Missing/loading production assets render nothing and report QA failure; they do
not fall back to a visible debug shell. Procedural code remains valid for
invisible collision/portal/navigation data, dev-only diagnostics, UI/Archive
highlights, and non-physical environment systems such as sky, fog, weather,
water shaders, lighting, particles, and contact shadows.

New physical assets follow: Gemini concept/reference → historical visual QA →
Meshy image-to-3D → scoped Blender optimization → verification manifest →
targeted `sync_web` copy/allowlist. Land-facing backdrop modules must be
grounded on imported surfaces. The west and southwest harbor remain open water:
never place city/backdrop/terrain modules beyond x=-160, south of the wharf
apron (z>14 for x<-118), or in the southwest water band (z>26.5 for x<=-40).

## 13. Verification standard (what "done" means tonight)

Screenshot tour (Playwright, seeded saves) at morning / midday / drizzle / golden hour / dusk / night-ish close covering: west gate → wharf (water+ships+gulls visible, audio zones switch), full street walk end to end (no gaps, no void sightlines), back lane duck/squeeze, dock route ≠ main route ≠ back lane (three visibly different walks to the rider), climb the two vantage roofs, church interior + bell, tavern interior, 3 common interiors, elm pocket cutscene still intact, all existing Day 1 beats replay clean (runtime tests + typechecks pass, full autoplay completes). Read every screenshot; iterate until it feels like the reference image.
