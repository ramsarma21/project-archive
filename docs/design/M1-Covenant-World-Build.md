# M1 Covenant World Build — execution-ready plan

**Status: PLAN ONLY. Nothing here is built.** This is the canonical, single-source
world-build plan for the 1774 Solemn League and Covenant courier run. It supersedes the
**world/traversal** sections of `docs/design/M1-Mission-Build.md` (that doc's audit numbers
remain valid history; its *build order* for world/traversal is replaced here). Mission
fiction of record stays `docs/design/M1-Remedial-Slice.md`.

**Owner sequencing (verbatim spirit, 30 Jul):** build/re-author the WORLD first, *then* close
traversability; design traversal INTO each asset at the concept stage so the visible surface
makes the path and collision follows it (never force traversability into an asset that never
considered it); re-authoring/moving locations is allowed — keep what worked, cut useless
circles and long detours; do not start building until the owner says go.

**What "covert traversal" means (owner refinement, 30 Jul).** This is NOT an explicit geometric
"no-ground" rule — being a few feet off the ground does not "count," and there is **no tracked
line-of-sight system** (that reads as buggy). The intent is the *feel*: you move **above the
street — on roofs, ledges, planks and paths** where, in theory, you are out of sight of people on
the ground. Rooftop/elevated reads as covert **by convention**; the street reads as exposed by
convention. So the real requirement is **connectivity, not a node count**: the elevated network
must be continuous enough that a player *can* stay up across the run (this is what closing the
three islands / the G1–G2 gaps achieves). Ground contact is by **authored intent** — dropping to a
contact, or a deliberate crossing (the dead harbour; the elm→yard climax) — never an accidental
hole in the roofline. The Phase-2 gate is reframed accordingly (Section E): assert the covert line
is a **connected elevated path with ground touches only at authored beats**, not "zero ground nodes."

**Legacy docs describe a DIFFERENT game — do not carry them over (owner, 30 Jul).** The old
open-world Boston game is not this game. Much surviving documentation describes it, and its
constructs must **not** be imported: the open-world **roam**, **Thomas "opens the dock route,"** the
`Day-1.md` **order-free errands / day clock / People·Notes·Routes panels**, and any "wander the
city" framing. This build is the **focused, linear-spine M1 mission** (lesson → Covenant courier
run → boss duel → capstone). Where a legacy cast note carries an open-world job (e.g. Thomas
"opening a route"), keep only the concept role (Thomas = the merchant whose mark you need;
non-importation + the closure's blast radius) and drop the open-world mechanic. Read old docs for
**historical facts and asset inventory**, never for **mechanics or structure**.

**Verified state this plan is written against (measured, not asserted):**
- Branch `workflow/m1-evasion-loop`, worktree off `main` @ `440677c`, clean. Baseline **2889
  tests / 0 failing** — must stay there.
- No-ground route-graph BFS over the *current* `M1_EFFIGY_RUN` (reproduced this session):
  **67/166 nodes on GROUND**; the SAFE guided line start→post has **11 ground-contact nodes**
  (G1 = `A_ALLEY_FLOOR, B_STREET_W, B_VAULT_IN, B_VAULT_OUT, B_DUCK, B_STREET_MID,
  B_CRATES_FOOT`; G2 = `B_STREET_E, B_EXIT, C_SQUARE_N, C_SCAFF_FOOT`); the elevated network is
  **3 islands** (START `A_LEADS`; the Shambles canopy tier; the long spine holding `F_POST`);
  `F_POST` is **not** reachable off-ground from START. Post→arena (G3) has 8 ground nodes and is
  the **intentional climax exposure — exempt**.
- Clip-fidelity (`scripts/check-clip-fidelity.mjs`, IK live, `playerboy-rigged.glb`): **HANG_DROP
  SEVERE — foot 26.5 cm through the wall**; **STEP_UP has no baked clip** (falls back to `run`);
  **landings overrun** — LAND_RUN 44 %, LAND_ROLL 67 %, LAND_HARD 89 %, LAND_RECEIVED 55 % of the
  clip shown; **CLIMB_UP mantle 97 %** shown (1.04× overrun, cosmetic); VAULT / CLIMB_OVER / SLIDE OK.
- Tooling (orchestrator-verified): **Blender 5.1.2** at
  `/Applications/Blender.app/Contents/MacOS/Blender`; **`MESHY_API_KEY` SET**; **FAL / GEMINI /
  GOOGLE / RUNWAY NOT set**. A grep of `assets/pipeline/**` finds **no script that reads
  GEMINI/GOOGLE/FAL/RUNWAY** — the only generation credential any pipeline script reads is
  `MESHY_API_KEY`, which is present.

---

## The movement envelope every asset is designed against (the contract)

Source: `packages/engine-world/src/parkour/tuning.ts` (`PARKOUR_TUNING`, `MOVEMENT_CAPABILITIES`).
Every target dimension in Sections A–C is chosen so the shipped reader offers the intended verb
with margin — this is the "traversal baked in" the owner asked for.

| Verb | Reader offers when… | Authoring target (with margin) |
|---|---|---|
| free step (no verb) | rise ≤ `freeStepUpM` (`STEP_DOWN`), drop ≤ free step-down | kerbs/thresholds ≤ ~0.3 m |
| STEP_UP | rise ≤ **0.5 m**, top standable | curbs/sills **0.34–0.45 m**, top ≥ 0.75 m deep |
| VAULT | obstacle ≤ **1.15 m** tall × ≤ **1.2 m** deep, far drop ≤ **1.2 m** | barrels/rails **1.05–1.10 m** tall, ≤ 1.1 m deep |
| CLIMB_OVER | thin top, height ≤ **1.9 m**, depth ≤ **0.9 m**, top < 0.75 m | gates/partitions **1.6 m** tall, **0.5 m** top |
| CLIMB_UP (mantle band) | rise ≤ **1.9 m**, top standable ≥ **0.75 m** | crate/sill steps **1.5–1.9 m** onto ≥ 0.9 m deck |
| CLIMB_UP (tall/ladder) | rise ≤ **3.2 m** (`climbMaxHeightM`); above = BLOCKED | scaffold/ladder climbs **2.3–2.9 m**, never > 3.0 m |
| SLIDE | headroom **1.0–1.45 m**, span ≤ **2.6 m** | duck beams underside **1.20 m**, span ≤ 2.5 m |
| RUN_OFF (drop) | drop ≤ **2.2 m** | chain-drop rungs each ≤ 2.2 m |
| HANG_DROP | drop ≤ **3.2 m** | controlled descents **2.2–3.2 m** |
| ROLL | drop ≤ **5.5 m** | roof crossings ≤ 5.5 m |
| EDGE_BRAKE (refused) | drop > **5.5 m** off a run | never author a plain run-off > 5.5 m |
| LEAP_OF_FAITH | drop ≥ **6 m**, target radius **1.6 m**, off-axis ≤ 0.7 rad | steeple→elm dive only |
| JUMP_GAP (SAFE) | lip-to-lip ≤ `levelDesignMaxGapM(drop) × 0.8` | flat SAFE hops **≤ ~1.4 m**; wider ⇒ a plank |

Standing-surface floor: **`minStandableTopDepthM` = 0.75 m** (2·`CAPSULE_RADIUS` 0.35 + 0.05) on
the narrow axis, or the reader will not leave a body there. Roof decks must **oversail their mass
by ≥ `CAPSULE_RADIUS` (0.35 m)**; the house jetty is **0.70 m**. Vertical band vocabulary
(`envelope.ts BAND`, metres): STREET 0 · CART 0.95 · BARREL 1.1 · STACK 1.9 · TREE_AWNING 2.2 ·
STALL_ROOF 2.55 · SCAFFOLD_1 2.9 · SHED 3.85 · PENTICE 5.35 · GALLERY 5.6 · LOW_ROOF 7.1 ·
MEETING_EAVE 8.2 · CLOCK_LEDGE 7.9 · CORNICE 10.2 · MEETING_RIDGE 11.2 · LEADS 12.4 · LOUVRE_SILL 14 ·
STEEPLE_GALLERY 15.8; elm BOUGH_LOW 6.4 · BOUGH_CROWN 8.3 · BOUGH_UPPER 11.2.

Every new authored link is proven by `verifyLink` (`packages/mission-m1/src/traversal.ts`), which
runs the *shipped* physics (`simulateBallistic`, `beginAuthored`, `solveLeapOfFaith`) — an asset
that reads well but fails `verifyLink` does not ship.

---

## A. Re-authored mission spatial design — the Covenant courier run

**Design rule:** one compact west→east spine, each stop a **drop-to-contact-and-climb-back** off a
continuous elevated line — no laps, no useless circles (the two current off-line loops, Dock
Square `B2` and the ropewalk `D2`, stay as *optional* dark spaces but the guided covert line never
threads them). The spine reuses the working buildings and their node ids where they already work;
it re-authors only what makes the path compact and off-ground.

**World-dressing — the spine is not the whole world (owner, 30 Jul).** Between and around the
functional stops the world must *feel real and lived-in*: rows of prop buildings, the wharf, and
the street furniture that make Boston read as a town rather than a corridor of set-pieces. Almost
all of it already exists (the `bldg-*` row/shop/warehouse set, the wharf kit, market dressing), so
this is placement/layout, not new-gen. **Constraint:** dressing obeys the same movement envelope as
the spine — it never blocks the covert line, never creates a *fake* affordance (a ledge you cannot
actually stand on), and any rooftop that reads as runnable either is runnable or is clearly out of
reach. A believable skyline is part of the traversal design, not scenery bolted on afterward.

Beat order, west→east (≈88 m of street compressed), with traversal role. **These beats are the
functional spine; the ambient world ("world-dressing" above) fills the space between them:**

0. **Abigail's printshop — interior → stairs → balcony → leads (the off-ground start).**
   Start INSIDE the shop on the ground (safe), climb the **stairs** to the **balcony** (first
   off-ground surface), step out onto the printshop **leads** (`PRINTSHOP__ROOF`, y 7.1, existing
   `A_START` region). The stairs are the one sanctioned ground→roof transition; the covert run
   begins on the balcony. *Traversal role:* tutorial ascent; establishes "up here you are unseen."
   **Reuse** the leads/`A_*` roof chain; **build** the interior+stairs+balcony (Section C).
1. **The dead harbour — the deliberate wharf crossing (NEW, owner 30 Jul).** Come down off the
   printshop leads to the **shut wharf** and cross it at dock level — past idle rigged ships, empty
   crates and fish-flakes with no cargo moving — then climb back up on the far side into the market
   district. This is a **chosen, exposed crossing at ground/dock level, not a rooftop**: the one
   place the covert run deliberately comes down into the open, because the point is to *stand on the
   closed port*. **Concept 2 made physical** — the harbour is dead, and the player feels the closure
   before any contact explains its effects. Anchored on the owner's real harbour photo
   (`assets/reference/harbour-cutscene/real-harbour-ingame.png`), **not** the superseded renders.
   *Traversal role:* the deliberate exposed crossing (varies the loop; the wharf is not a roofline).
   **Reuse** the wharf kit + ships (`ship-brig-hero`, `ship-snow-background`, `ship-sloop`, apron/
   pier/warehouse/crane/cargo — all present on `main`). *Route:* adds a **WHARF zone** the graph
   must accommodate (a new section between `A_LEADS` and `B_SHAMBLES`).
2. **The Shambles (market) — first drop-to-contact.** Travel the market high/mid line; **drop** to
   the market-watch contact (the wired `SHAMBLES_STOP`, ground trigger `[16.6, 0, 0.4]`),
   talk-your-way-past, **climb back** onto the canopy tier. *Traversal role:* the loop's first full
   rooftop→contact→rooftop rep. **Reuse** `MARKET_SHED`, the stall canopies (`STALL_*__CANOPY`, y
   2.55), the crate crossovers.
3. **The merchant's house (Thomas) — interior stop with billeted soldiers.** A **new placed
   interior** (`int-shell-domestic-wide-b`) set into the north row between the Shambles and the
   Town House, entered by **dropping from the high line to an upper-window/parlour balcony** (not
   the guarded ground door). *Traversal role:* a *vertical* drop-in that varies the loop (per the
   design's "not four identical drop-and-returns"); quartering is the obstacle. Thomas is the
   **merchant contact whose mark you need** (non-importation + the closure's blast radius) — **not**
   the old open-world "opens the dock route" role. This is the one genuinely new stop location.
4. **The Town House — the climb centrepiece (kept).** Spiral the scaffold → gallery → clock →
   cornice → leads. *Traversal role:* the sustained CLIMB set-piece and the reflex-beat exposure;
   it already works and reads. **Reuse** wholesale (`bldg-townhouse-1713`, `bldg-scaffold-run`,
   ladders).
5. **Hollis meeting house — endorsement stop (bill-sticker / Clarke).** Cross the Orange-Street
   roofline → meeting-house leads; the wired `ROPEWALK_STOP` sits here (`[74.6, 8.2, 9.4]`).
   *Traversal role:* a roof-level stop (no ground drop) — a deliberate variant. **Reuse**
   `bldg-meeting-hollis`, `steeple-meetinghouse-climbable`, the ridge monitor.
6. **The Liberty Elm — post the Covenant → detection → chase → duel.** Steeple gallery →
   **leap-of-faith** into the crown (`F_CROWN`), **post** at `F_POST` (precision beat), then the
   **deliberate exposure**: alarm, chase EAST on the ground (`F_GROUND` → crowd → `G_GATE`) to the
   rope-walk yard `G_SPAWN` and the duel. *Traversal role:* covert line ends; the chase is
   intentionally grounded. **Reuse** `liberty-elm-hero`, the yard/`yardArena`.

**Compactness statement.** The covert connective line is `printshop balcony/leads → down to the
dead wharf and across → up into the shambles high line → merchant upper window → town-house climb →
roofline → meeting-house leads → steeple → elm`, monotonic west→east with no backtracking. Ground
contact happens only at **authored beats** — the wharf crossing (beat 1), each drop-to-contact, and
the elm→yard chase — never as a forced hole in the roofline. Dock Square and the ropewalk remain
reachable but **off** the guided line. The re-author keeps the existing spine shape (`route.test.ts`
pins `A_LEADS → B_SHAMBLES → C_ASCENT → D_ROOFLINE → E_LEAP → F_TREE → G_YARD`, with
`B2_THRONG`/`D2_ROPEWALK` off it) and **adds** the printshop start (0), a **wharf section** (1) and
the merchant interior — so the pinned section order gains a wharf section and the tests update with it.

---

## B. Per-location "traversal-baked-in" asset spec

For each location: the designed-in affordances and their target dims, tied to the envelope table
above so nothing is forced later. **Cite the current clip defects** so the geometry is built to
land the FIXED clip, not the broken one: HANG_DROP feet currently punch **26.5 cm** through a wall
(so any hang-drop face must be a real solid the foot-pin IK can seat against — Section D fixes the
IK, not the geometry); STEP_UP has **no clip** (so keep every authored curb ≤ 0.45 m where the
`run` fallback reads cleanly, per M1-DONE §3); landings overrun (**44/67/89/55 %**) so keep drop
receivers generous; mantle is **97 %** (cosmetic).

**0. Printshop interior → balcony → leads.**
- Interior floor (ground, safe spawn): a `int-shell-*` domestic/shopfront shell, clear ≥ 0.75 m
  standable throughout.
- **Stairs**: authored as `rampStrips` (invisible stepped collision under a `stone-steps`-class
  visible mesh) rising ground→balcony (~2.6–3.0 m over ~3 m run), each strip ≤ `freeStepUpM` so
  locomotion absorbs it — **no stair clip needed** (confirm in-build; only bake one if it reads
  badly).
- **Balcony deck**: y ≈ 2.6–3.0 m, ≥ 1.4 m deep, balustrade `churchyard-fence` split at the stair
  opening (the asset is already declared "Balcony balustrade, split at the stair opening").
- **Balcony → leads**: a CLIMB_UP ≤ 1.9 m (mantle band) or a short authored climb onto
  `PRINTSHOP__ROOF` (y 7.1) via the existing sign hood (6.2) / pentice (4.4) chain, so the ascent
  is ≤ 3.2 m per hop.

**1. Shambles market.**
- Mid-line canopies `STALL_*__CANOPY` at **2.55 m**, 2.8 m wide, spaced 4.2 m → **1.4 m** lip
  hops (SAFE JUMP, within budget) — already authored for stalls 2–4; extend to stalls 0–1.
- Crate crossovers `crate-stack` top **1.9 m** (CLIMB_UP from street) — reuse.
- Drop to `SHAMBLES_STOP` contact: a controlled **HANG_DROP ≤ 3.2 m** or chain RUN_OFF ≤ 2.2 m
  from the canopy to the ground trigger; climb-back the same crates.

**2. Merchant's house (new interior).**
- Shell `int-shell-domestic-wide-b` (per structures-manifest / Build-audit §3b — **verify GLB
  present in Step 0**), ~18 × 3.8 × 14 m, four-wall + ceiling, floor ≥ 0.75 m standable.
- **Upper-window/parlour balcony** at y ≈ 2.9–3.85 m (SCAFFOLD_1 / SHED band) reached by a
  **HANG_DROP ≤ 3.2 m** off the adjacent roof/high line — the covert entry.
- **Billeting dressing** (reads "soldiers quartered here"): stacked-musket / bedroll / pack / drum
  set — the one genuinely thin prop family (Section C, NEW-GEN). Non-traversal dressing, but sized
  so it does not block the ≥ 0.75 m standable interior path or the sill.
- Mantel/sill heights: hearth-mantel and window sills authored at STEP_UP (0.34–0.45 m) or
  vault (1.05–1.10 m) so interior movement reads as parkour, not collision bumps.

**3. Town House (reuse; no new asset).** Ledges 5.6 / 7.9 / 10.2 / 12.4 m at the authored 2.2–2.3 m
climb spacing (each ≤ climbMax 3.2 m); scaffold stagings 2.9 / 5.6 m; leaning ladders
`work-ladder-8..11`. Standable ledges already cut to ≥ 1.6 m. **Preserve as-is.**

**4. Hollis meeting house (reuse).** Leads at 8.2 m; ridge monitor to 11.2 m; steeple rings 14 /
15.8 / 18.2 / 20.6 m at ≤ 3.2 m climb spacing. Buttress `buttress-stepped-stone` top 2.6 m.
**Preserve.**

**5. Liberty Elm (reuse; PRESERVE — do not regenerate).** Boughs 6.4 / 8.3 / 11.2 m, each ≥ 3 m
across; trunk solid to 12 m (walk-around); tree awning 3.2 m splits the 6.4 m descent into two
HANG_DROPs. Leap-of-faith from the steeple gallery (drop ≥ 6 m, target radius 1.6 m). The elm is
hand-authored, not Meshy (Meshy foliage was the shard defect). **Preserve.**

**Connective crossovers (the covert-line closers that connect the roof islands, built as REAL
props, Phase 1 geometry — placed but route-linked in Phase 2):**
- **G1 (printshop island → Shambles canopy tier):** a `roof-walk-board-long` (5.4 m) plank from the
  hay-wain SE corner (`HAY_WAIN_E`, top 2.2 m) to `STALL_0__CANOPY` (2.55 m) — a ~4 m span at
  matched height, RUN across + a 0.35 m STEP_UP onto the canopy. Reuses declared props; verified
  by placement, not assumed.
- **G2 (Shambles crate tier → Town House scaffold):** a `roof-walk-board-long`/`roof-plank-gantry`
  from `SHAMBLES_CRATES_B` (1.9 m) to a new node on `SCAFFOLD_D1` (2.9 m), a ~3.2 m span + a ≤ 1 m
  CLIMB_UP onto the staging. Crosses the street/square corner at roof height — **not** through Dock
  Square.
- **On-ramp climbs** for both must start on a **non-GROUND** surface (crate/hay top), satisfying
  the owner's "on-ramp that does not start on the ground."

---

## C. Asset build list (INVENTORY first, then build)

**Legend:** `REUSE` = reposition via level files only (no GLB touched) · `EDIT` = Blender edit of an
existing GLB · `NEW-GEN` = Meshy image-to-3D from a concept PNG.

### C.0 Existing reusable inventory (reuse before generating)
From `packages/mission-m1/src/assets.ts` (all `EXISTING`, published):
- **Planks/gantries:** `roof-walk-board-long` (5.4 × 0.2 × 1.4), `roof-plank-gantry` (2.8 × 0.03 ×
  1.2), `roof-ridge-walk` (0.042 flat), `printshop-sign-hood`.
- **Ladders:** `work-ladder-8/9/10/11` (leaning, human rung gauge, 2.4–3.3 m rises) + `GRIPS`
  (buttress, elm boughs).
- **Steps/cover:** `crate-stack` (1.9), `crate-mound` (2.35), `barrel-group` (1.1), `hand-cart`
  (0.95), `market-stall` (1.9/1.1), `market-awning`, `hay-wain-loaded` (2.2), `infill-lean-to`
  (3.85), `duck-beam-frame` (1.2 underside), `churchyard-fence` (balcony balustrade), `stone-steps`,
  `yard-kerb-stone` (0.34).
- **Buildings:** `bldg-printshop`, `bldg-brick`, `bldg-row-shop`, `bldg-row-brick-a/b`,
  `bldg-row-clapboard-a/b/c`, `bldg-warehouse-street`, `bldg-townhouse-1713`, `bldg-meeting-hollis`,
  `belfry-old-brick`, `steeple-meetinghouse-climbable`, `bldg-scaffold-run`, `buttress-stepped-stone`.
- **Interiors:** `int-shell-ropewalk-a` (declared+placed), `int-partition-board-a`; **audit-reported
  in `structures-manifest.json` but not yet declared in m1 `assets.ts`:** `int-shell-domestic-wide-b`
  ("merchant residence room"), `int-shell-shopfront-a`, `int-shell-domestic-narrow-a`,
  `int-shell-meetinghouse-hero`, floor tiles, `int-partition-plaster-a`. The `colonial-door-kit`
  exists (`gen_door_kit_meshy.mjs`). **Renderer `InteriorStructure.tsx` is live** (used by the hub);
  nothing places an interior in the mission yet (the old placement lived in the deleted
  `chapter-boston-world`).
- **Harbour / wharf (reuse — confirmed present on `main`):** `ship-brig-hero`, `ship-snow-background`,
  `ship-sloop`, `rowboat`, `buoy`; the wharf kit (apron, pier modules, boardwalk,
  `bldg-warehouse-wharf-a/b`, `timber-crane`, `bollard`, `rope-coil-large`, `cargo-net-bundle`,
  `crate-mound/stack`, `barrel-group`, `fish-flakes-rack`); `dockhand-rigged`. The composed scene was
  lost in the deleted redesign but every GLB survives — this dresses the beat-1 wharf crossing.
- **Hero:** `liberty-elm-hero` (PRESERVE).

### C.1 Build list

| # | Item / asset key | Tag | Traversal role | Target dims | QA gate |
|---|---|---|---|---|---|
| 1 | Printshop **interior shell** (place `int-shell-shopfront-a` or `-domestic-narrow-a`) | REUSE (place) | ground spawn room | ≥ 0.75 m standable, 4-wall+ceiling | `check-world-collision`, `check-world-affordances`, interior QA |
| 2 | Printshop **stairs** (`rampStrips` + `stone-steps` visible) | REUSE (author collision) | ground→balcony ascent | rise ~2.6–3.0 m, strips ≤ 0.3 m | affordances (no BLOCKED), playthrough |
| 3 | Printshop **balcony deck** + `churchyard-fence` balustrade | REUSE (place) | off-ground start surface | y ~2.6–3.0, ≥ 1.4 m deep | affordances, oversail ≥ 0.35 m |
| 4 | `bldg-printshop.glb` **interior/stairs/balcony geometry** | **EDIT (Blender) — see C.2** | makes the interior a real drawn shell | interior cavity + stair well + balcony opening | `assets:verify:collision` (drawn fills solid), placement |
| 5 | **Merchant's house** interior (`int-shell-domestic-wide-b`) | REUSE (declare + place) | stop-2 interior | ~18 × 3.8 × 14 m | interior QA, affordances |
| 6 | Merchant **upper-window/parlour balcony** deck | REUSE (place) | HANG_DROP entry (≤ 3.2 m) | y ~2.9–3.85, ≥ 1.0 m deep | affordances, clip-fidelity (hang-drop) |
| 7 | **Military billeting prop set** (stacked muskets, bedrolls, packs, drum) | **NEW-GEN (Meshy)** | reads "quartered"; non-blocking dressing | small props ≤ 1.1 m; keep 0.75 m path clear | historical QA, placement, scale |
| 8 | **G1 plank** (`roof-walk-board-long`) printshop→shambles | REUSE (place + link) | covert crossover (connects roof islands) | ~4 m span @ y 2.2–2.55 | placement, affordances, `verifyLink`, covert-connectivity |
| 9 | **G2 plank** (`roof-walk-board-long`/`roof-plank-gantry`) shambles→scaffold | REUSE (place + link) | covert crossover (connects roof islands) | ~3.2 m span @ y 1.9→2.9 | placement, affordances, `verifyLink`, covert-connectivity |
| 10 | On-ramp **climb volumes** (`climbVolume`, `serves` the new links) | REUSE (author in `climbs.ts`) | non-ground on-ramps | ≤ 3.2 m rise; foot on crate/hay | `route.test`, affordances |
| 11 | **Wharf zone** (place the wharf kit + ships for the beat-1 crossing) | REUSE (place + link) | deliberate exposed dock crossing | dock deck at water level; descent/ascent ramps ≤ 3.2 m | placement, affordances, playthrough, historical QA (rigging/period) |

**Meshy is the only NEW-GEN here (item 7).** Everything structural is REUSE/EDIT — this honours
"reuse before generate" and the Preserve-list (Section I).

### C.2 Printshop resolution (explicit)
The printshop is currently a **solid exterior mass** (`bldg-printshop` 13 × 7.1 × 14, `landable:
false`) with the start on its **leads** (roof) — there is **no interior, stairs, or balcony**, and
the collision is solid to the roof so a mesh interior alone would not be enterable.
**Decision: EDIT (Blender), not NEW-GEN.** Keep the recognisable Edes & Gill exterior; in Blender,
hollow a ground-floor room, cut a stair well and a balcony opening on the street face, and export.
Then author the matching collision as authored masses/decks (interior floor mass, `rampStrips`
stairs, balcony deck) so **drawn geometry = collision** (the repo's law; `assets:verify:collision`
enforces it). The interior→stairs→balcony→leads flow is then: spawn on the interior floor →
`rampStrips` up → balcony deck (off-ground) → CLIMB_UP/chain onto `PRINTSHOP__ROOF`.
*Rationale for EDIT over NEW-GEN:* a fresh Meshy building would lose the established silhouette the
lesson/hub already show and risk the facade-tear defect (`bldg-brick`-class); a Blender hollow-out
is surgical and keeps the working exterior. `bldg-printshop.glb` is **world-audit lane** — grant
required (Section G).

---

## D. Parkour clip work (Blender 5.1.2 now available)

Fixes ranked by the current defect severity, each labelled **pure-IK / pure-tuning / needs-bake**:

1. **HANG_DROP foot-through-wall (SEVERE, 26.5 cm) — PURE-IK, no bake.** Root cause traced in
   `packages/engine-world/src/parkourIk.ts`: `footTarget` returns a foot **pin verbatim**
   (`if (footPin) return footPin;`), so a hang-drop foot pinned *inside* the wall face stays there
   and the guarded solve (max correction 0.4 m) keeps the clip pose. **Fix:** when a foot pin lies
   inside a solid box, project it out to the body-side face with the existing `exitFaceToward`
   (skin-proud), then solve. The needed correction is 0.265 m < the 0.4 m guard, so the solver
   keeps it — the foot seats on the face. Files: `parkourIk.ts` (held). *Verify:* `check-clip-fidelity`
   HANG_DROP clip-through → ≤ CLIP_THROUGH (0.05 m), clears SEVERE.
2. **Mantle 97 % overrun (cosmetic) — PURE-TUNING, no bake.** CLIMB_UP window 900 ms; mantle
   content 3729 ms needs 4.14× (capped at 4.0× → 97 %). **Fix:** widen `durationsMs.CLIMB_UP`
   900 → ~940 ms (3729/940 = 3.97× ≤ 4.0 → 100 %). Files: `parkour/tuning.ts` (held). **CAUTION:**
   the paused `mission-world` jump-hang branch also edits `tuning.ts`; keep this one-line change in
   its **own commit** so that future rebase stays clean. (Alternative: a shorter mantle re-bake —
   not worth a bake for a 3 % cosmetic gain.)
3. **The four landing overruns (LAND_RUN 44 %, ROLL 67 %, HARD 89 %, RECEIVED 55 %) — NEEDS BAKE
   (Blender trim).** The windows are control-feel and must **not** be widened (tuning note); the
   clips must be **shorter re-baked takes**. `landRun`/`dropRoll`/`landHard`/`leapOfFaithLand` are
   Mixamo-sourced. **Fix:** in Blender, trim each source take to its readable core and re-append via
   `append_clips.py` (below). No new Mixamo pull if the source takes exist in `assets/source/mixamo/`
   (verify in Step 0); if a take is inherently long, trim its keyframe range in Blender. *Verify:*
   `check-clip-fidelity` landings ≥ 90 % shown.
4. **STEP_UP no clip — NEEDS BAKE, with a known SOURCE dependency the owner already hit.** The verb
   falls back to `run`. A dedicated sub-0.5 s curb-absorb clip does not exist in the Mixamo library
   (owner's prior blocker); **MESHY generates 3-D models, not animations**, so it cannot supply this.
   **Options, in order:** (a) leave STEP_UP on the `run` fallback for the demo — it is a **FLAGGED
   cosmetic** (M1-DONE §3 measured `run` spatially clean on a curb: 0 clip-through, 0 slide), not a
   SEVERE, and all authored curbs are ≤ 0.45 m; (b) owner sources a short step-up take from Mixamo;
   (c) hand-author a ~0.35 s step-up in Blender. **Recommendation: (a) for the demo**, revisit if the
   owner wants it. This is the one clip item that stays owner-gated.

**Bake tooling (Blender available):**
- Incremental (safe, does not touch existing anims): `blender --background --python
  assets/pipeline/append_clips.py -- <in.glb> <out.glb> <clipsCsv>` — reads Mixamo sources from
  `assets/source/mixamo/`, rest-delta retargets onto the Meshy rig, freezes horizontal hip drift.
- Full re-bake (clears anims; only if needed): `assets/pipeline/bake_character_anims.py`.
- Rig GLB (in and out): `apps/web/public/world/characters/playerboy-rigged.glb` (then
  `assets/pipeline/sync_web.mjs` if the source/build path differs from the published one).
- Instrument: `scripts/check-clip-fidelity.mjs` (`--selftest` first, then the report; `--json` for
  numbers).

**Net:** HANG_DROP + mantle are **code-only (held grants), no Blender needed**; landings need a
**Blender trim re-bake** (tooling present); STEP_UP stays **owner-gated** on a Mixamo source.

---

## E. Traversability guarantee (PHASE 2 — after the world is built)

Run only *after* Sections A–C land, so the graph is measured over the built world, not the current
one. Targets and gates:

1. **Connected covert rooftop line (connectivity, not a zero-ground count).** Per the owner's
   refinement, the requirement is that the **elevated network is continuous enough to stay up**
   across the run — not that the path touches zero ground. Re-line the guided path over the built
   crossovers (G1/G2 planks + on-ramp climbs) so it runs roof-to-roof between authored beats, and
   demote the *accidental* forced-ground drops off the elevated islands (`A_HAY→A_STREET`,
   `A_ALLEY_CRATES→A_ALLEY_FLOOR`, `B_CRATES_B→B_STREET_E`) so the line cannot fall to the street by
   default. **Authored ground touches are intentional and allowed:** the **wharf crossing (beat 1)**,
   each **drop-to-contact**, and the **elm→yard chase (G3)**. There is **no tracked line-of-sight
   system** — rooftop reads as covert by convention, the street as exposed.
2. **Covert-connectivity gate** (`packages/mission-m1/src/__tests__/covertLine.test.ts`, unowned —
   no grant): asserts (a) the elevated network is **connected** from the printshop start to `F_POST`
   — a roof-to-roof path exists that touches ground only at nodes tagged `authoredGroundBeat` (the
   wharf crossing, the drop-to-contacts, the climax); (b) `F_POST` is reachable over that network;
   (c) **no *untagged* forced-ground node** sits on the cheapest guided path (an accidental hole in
   the roofline fails the gate). This replaces the brittle "zero ground nodes" idea with "the roofs
   connect and every ground touch is on purpose," and closes the audit's finding that no such gate
   exists so the G1/G2 islands cannot silently reopen.
3. **Existing gates, all green:** `traversability.test.ts` (`verifyLink` OK on every link — the hard
   one, since new planks/climbs must pass the shipped physics), `route.test.ts` /
   `routeFlow.test.ts` / `wayfind.test.ts` (they pin the guided-line section order and the
   drive-executability of every SAFE descent — the re-line must keep them green), `assets:verify:placement`
   / `:collision` / `:affordances` (**0 CRITICAL**; affordance debt held-or-shrunk), the
   collision-vs-visible gate (`assets:verify:collision`), `check-clip-fidelity` (HANG_DROP clears
   SEVERE, landings ≥ 90 %, mantle 100 %), and `check-playthrough` (route advances, stops resolve,
   no soft-lock; note the guided line must still lead the player to each contact drop, or the
   encounter gate soft-locks — sequence with the Stage-1 loop wiring).
4. **Baseline held:** typecheck / lint / full suite **2889 / 0**.

**Known Phase-2 interaction to sequence (flagged, not solved here):** the wired encounters gate
`REACHED_DUEL` on participation and arm on a **ground** trigger; a fully elevated *guided* line
does not pass through them, so the guided line needs authored **drop-to-contact waypoints** at each
stop (the Stage-1 loop work) or `check-playthrough` soft-locks. World-build first; loop-wiring +
this waypointing is the following stage.

---

## F. Pipeline + tooling map (exact script per step)

| Stage | Script / tool | Credential / tooling | Status |
|---|---|---|---|
| Concept image (per new-gen key) | agent image tool or owner-supplied PNG → `assets/source/concepts/<kit>/<key>.png` | **none in-pipeline** (no script reads GEMINI/GOOGLE/FAL/RUNWAY) | OK (owner/agent supplies PNG) |
| Net-new 3-D (item 7) | `gen_interior_kit_meshy.mjs` / `gen_prop_from_image.mjs` (Meshy **image-to-3D**, consumes the PNG) | **`MESHY_API_KEY`** | **SET ✓** |
| Blender edit (printshop hollow-out; interior optimise) | `blender --background --python …` (e.g. `optimize_interiors_v4_structures.py`, `optimize_world_v3_wharf.py`) | Blender 5.1.2 | **✓** |
| Clip bake / trim | `append_clips.py` (incremental) / `bake_character_anims.py` (full) | Blender + Mixamo source in `assets/source/mixamo/` | Blender ✓; **Mixamo = manual/owner** for STEP_UP |
| Publish to served tree | `sync_web.mjs` | — | ✓ |
| Collision manifest | `build_collision_manifest.mjs`, `author_collision_sidecars.mjs`, `export_runtime_collision_manifest.mjs` | — | ✓ |
| Validate collision | `validate_collision_manifest.mjs` | — | ✓ |
| Placement gate | `assets:verify:placement` → `assets/pipeline/verify_m1_placements.mjs` | — | ✓ |
| Collision-vs-visible gate | `assets:verify:collision` → `scripts/check-world-collision.mjs` | — | ✓ |
| Affordance gate | `assets:verify:affordances` → `scripts/check-world-affordances.mjs --gate` | — | ✓ |
| Clip-fidelity | `scripts/check-clip-fidelity.mjs` | reads `apps/web/node_modules/three` | ✓ |
| Playthrough | `scripts/check-playthrough.mjs` | throwaway stack | ✓ (orchestrator/merge-gate) |

**Credential gaps, precisely:** the only generation credential any `assets/pipeline` script reads
is `MESHY_API_KEY` (present). **No pipeline script references GEMINI / GOOGLE / FAL / RUNWAY**
(grep-confirmed), so those unset keys **block nothing in the current pipeline**. Meshy is
image-to-3D and needs a **concept PNG** per key as input — produced by the agent image tool or the
owner, not by a keyed script. If a future stage is wired to Gemini for concepts, that key is unset
and would need setting; today it is not required.

---

## G. Lane grants required on "go" (beyond what is held)

Held now (grant `31ebe3a`): `level-data` (`packages/mission-m1/src/level/{route,route2,geometry,
dockSquare,climbs}.ts`) and `mission-world` engine-world parkour
(`packages/engine-world/src/{parkourIk.ts,parkour/tuning.ts,parkour/clips.ts}`), plus the unowned
new test.

Additional grants to apply on "go" (owner enforced map `.cursor/lane-ownership.json`):

| Files / globs | Current owner | Why |
|---|---|---|
| `packages/mission-m1/src/assets.ts` | **mission-world** | declare new asset keys (interior shells, billeting set, planks) |
| `packages/mission-m1/src/{compile.ts,runtime.ts,types.ts}` | **mission-world** | interior/deck compile + placement support if needed |
| `apps/web/src/chapter/M1Scenery.tsx` | **mission-world** | place interiors/planks/billeting in the scene |
| `packages/engine-world/**` (beyond the 3 parkour files) | **mission-world** | only if a renderer/interior change is required |
| `scripts/check-clip-fidelity.mjs`, `scripts/check-world-affordances.mjs`, `assets/pipeline/*ladder*` | **mission-world** | instrument/ladder tweaks if needed |
| `apps/web/public/world/props/bldg-printshop.glb` + `assets/pipeline/*printshop*` | **world-audit** | printshop interior/stairs/balcony EDIT |
| `apps/web/public/world/props/bldg-*.glb` + `assets/pipeline/*townhouse*/*brick*/*facade*` | **world-audit** | only if a building EDIT is required |
| `apps/web/src/chapter/m1Mission.ts`, `packages/mission-m1/src/level/opposition.ts`, `encounters/**` | **mission-cinematic** | place contacts/patrols (billeted soldiers) + (later) retheme |
| `content/**`, `@pa/grading` | **boss-fight** | only for the encounter retheme (later stage), not world-build |
| `docs/**` | **mission-presentation** | this plan doc + the supersede pointer (written under owner instruction) |

**OPEN (no grant needed, but flagged so the orchestrator is aware):** `apps/web/public/world/props/**`
(new props other than `work-ladder*`/named `bldg-*`), `apps/web/public/world/structures/**`
(interior shells), `apps/web/public/world/characters/playerboy-rigged.glb` (the rig for clip bakes),
`assets/pipeline/**` (generation/bake/optimise/collision scripts other than the
`*ladder*`/`*townhouse*`/`*brick*`/`*facade*`/`*printshop*`/`*liberty_elm*` globs), and
`assets/source/**` (incl. `assets/source/characters/abigail.glb`, `assets/source/mixamo/`,
`assets/source/concepts/**`). These match no lane glob in the enforced map; the build may write
them without a grant, but the orchestrator should confirm no sibling lane is mid-edit.

**Do not touch:** `.cursor/**` (no self-grant), `../project-archive-worktrees/playtest`, ports
5173/3001/55432/4300/4301, `.affordwork/`.

---

## H. Ordered build sequence (each step: gate + bounded stop)

**Phase 0 — verify inputs (read-only, ~15 min).**
0.1 Confirm `int-shell-domestic-wide-b` (+ shopfront/domestic shells) present in
`apps/web/public/world/structures/` and in `structures-manifest.json`. 0.2 Confirm Mixamo landing
source takes exist in `assets/source/mixamo/`. 0.3 `check-clip-fidelity --selftest`;
`check-world-affordances --selftest`. **Gate:** inputs present. **Stop** if a shell or source take
is missing → report to owner (that item becomes NEW-GEN / Mixamo-pull).

**Phase 1 — build the world (owner's "world first").**
1. **Printshop interior/stairs/balcony** (C item 1–4): Blender hollow-out of `bldg-printshop.glb`
   → authored interior/stair/balcony collision. **Gate:** `assets:verify:collision` (drawn fills
   solid), placement, affordances 0 CRITICAL. **Stop.**
2. **Merchant's house** (C item 5–6): declare + place `int-shell-domestic-wide-b`, author the
   upper-window balcony. **Gate:** interior QA, affordances, hang-drop clip-fidelity. **Stop.**
3. **Billeting prop set** (C item 7, NEW-GEN Meshy): concept PNG → `gen_prop_from_image.mjs` →
   Blender optimise → `sync_web`. **Gate:** historical QA, placement, `check-world-scale`. **Stop.**
4. **G1/G2 crossover props** (C item 8–9): place `roof-walk-board-long`/`roof-plank-gantry` decks
   in `geometry.ts` (no route links yet). **Gate:** placement, `assets:verify:collision`,
   affordances. **Stop.**

**Phase 1b — clips (parallel, code-first).**
5. **HANG_DROP IK** (`parkourIk.ts`) + **mantle tuning** (`tuning.ts`, own commit). **Gate:**
   `check-clip-fidelity` HANG_DROP clears SEVERE, mantle 100 %; `parkourIk.test.ts` still pins
   presentation-only (motion digest unchanged). **Stop.**
6. **Landing trims** (Blender `append_clips.py`). **Gate:** landings ≥ 90 % shown. **Stop.**
   (STEP_UP: leave on `run` fallback; flag to owner.)

**Phase 2 — traversability guarantee (owner's "then ensure traversable").**
7. Route-link the crossovers + on-ramp `climbVolume`s (`route.ts`/`route2.ts`/`climbs.ts`) and
   re-line SAFE off the forced-ground drops. **Gate:** `traversability.test.ts` (`verifyLink` all
   OK), `route.test.ts`/`routeFlow.test.ts`/`wayfind.test.ts` green. **Stop.**
8. Add `covertLine.test.ts`; run the covert-connectivity check. **Gate:** the elevated network is
   **connected start→`F_POST`**, every ground touch on the guided line is a **tagged authored beat**
   (wharf crossing, drop-to-contacts, G3 chase), and **no *untagged* forced-ground node** sits on
   the cheapest guided path. **Stop.**
9. Full gate: typecheck / lint / affected suites **2889/0** (+ new tests), all `assets:verify:*` at
   0 CRITICAL, `check-clip-fidelity`, and `check-playthrough` (with the drop-to-contact waypointing
   from the loop stage). **Bounded end:** report measured numbers; do not push/merge — orchestrator
   sequences.

---

## I. Preserve-list (do NOT regenerate — reuse/reposition only)

- **`liberty-elm-hero`** and the elm boughs/awning — hand-authored; Meshy foliage is the shard
  defect. Reposition only.
- **Working buildings:** `bldg-townhouse-1713`, `bldg-meeting-hollis`, `steeple-meetinghouse-climbable`,
  `belfry-old-brick`, `bldg-scaffold-run`, the row/shop/warehouse `bldg-*` set — they read and pass
  their placement/affordance gates. Reposition/re-link only; EDIT only the printshop.
- **The already-wired mission systems:** `onDetected` invocation seam, the stealth **hunt**,
  **watcher pursuit** (`stepWatcherPursuit`), the two perspective encounters
  (`SHAMBLES_STOP`/`ROPEWALK_STOP`), and the graded **duel** (`yardArena`) — all live and tested.
  Do not rebuild; the loop stage wires consequences onto them.
- **The off-ground roof start** (`A_START` @ `PRINTSHOP__ROOF` y 7.1) — already satisfies "off the
  ground from the first moment"; the interior/stairs/balcony is added *beneath/beside* it, not a
  replacement.
- **VAULT / CLIMB_OVER / SLIDE clips** — measured OK; do not touch.
- **Route sections that pass today** (Town House climb, roofline, steeple, elm→yard climax) — keep
  the geometry and node ids; the re-author adds stops 0/2 and the G1/G2 crossovers around them.

---

**Do not build, do not push, do not merge.** On the owner's "go", execute Section H in order from
the held grants + the Section G grants applied.
