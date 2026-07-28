// Art dependencies, by stable key.
//
// The level references props by key and never by path, so the art pipeline and
// the geometry can land independently. Anything marked NEEDED does not exist in
// apps/web/public/world yet; the required dimensions are the ones the collision
// was authored against, so a delivered asset that does not fit them will look
// wrong against a hull the player can feel.

export type AssetStatus = "EXISTING" | "NEEDED";

export interface AssetRequirement {
  key: string;
  status: AssetStatus;
  /** Where the existing file lives, or where the new one should land. */
  path: string;
  /** Bounding size the level's collision assumes, in metres [x, y, z]. */
  sizeM: [number, number, number];
  why: string;
  /** Named sub-surfaces the level stands on, with their heights. */
  standableAt?: number[];
}

export const ASSETS: AssetRequirement[] = [
  // ---- already in the pipeline ------------------------------------------
  { key: "bldg-printshop", status: "EXISTING", path: "world/props/bldg-printshop.glb", sizeM: [13, 7.1, 14], why: "Edes & Gill. The run opens on its leads." },
  { key: "printer-drying-rack", status: "EXISTING", path: "world/props/printer-drying-rack.glb", sizeM: [2.6, 1.6, 2.8], why: "The unstamped sheets, taken at a run." },
  { key: "market-awning", status: "EXISTING", path: "world/props/market-awning.glb", sizeM: [3.2, 2.6, 2.4], why: "Pentices and stall canopies; the mid line's running surface." },
  { key: "hay-cart", status: "EXISTING", path: "world/props/hay-cart.glb", sizeM: [2.8, 2.2, 2.4], why: "A loaded fodder cart with a flat trodden top at 2.2m, dressing DOCK_CART_W. The lane and duel-yard catches (LANE_HAY, COVER_HAY_NW) are `hay-wain-loaded` now, not this: the cart mesh heaps to a crown 0.21m proud of its flat area, so the flat a diver actually lands on sat 0.21m under the authored catch. A wain's load is flat to 0.08m and is the surface a leap wants.", standableAt: [2.2] },
  { key: "market-stall", status: "EXISTING", path: "world/props/market-stall.glb", sizeM: [2.6, 1.9, 2.0], why: "The shambles, and the bookseller's stall under the elm.", standableAt: [1.9, 1.1] },
  { key: "hand-cart", status: "EXISTING", path: "world/props/hand-cart.glb", sizeM: [2.4, 0.95, 1.6], why: "Street-line cover that also breaks the watch's sightline.", standableAt: [0.95] },
  { key: "crate-stack", status: "EXISTING", path: "world/props/crate-stack.glb", sizeM: [2.2, 1.9, 1.8], why: "Crossovers between the street and the canopies.", standableAt: [1.9] },
  { key: "crate-mound", status: "EXISTING", path: "world/props/crate-mound.glb", sizeM: [2.4, 2.35, 2.4], why: "Full-height cover in the duel yard.", standableAt: [2.35] },
  { key: "barrel-group", status: "EXISTING", path: "world/props/barrel-group.glb", sizeM: [1.1, 1.1, 1.1], why: "The one vault in the market, and chest cover in the yard." },
  { key: "duck-beam-frame", status: "EXISTING", path: "world/props/duck-beam-frame.glb", sizeM: [3.2, 2.1, 2.0], why: "The slide in the shambles; underside must sit at 1.20m." },
  { key: "roof-walk-board-long", status: "EXISTING", path: "world/props/roof-walk-board-long.glb", sizeM: [5.4, 0.2, 1.4], why: "The hoist plank across Dassett Alley." },
  { key: "infill-lean-to", status: "EXISTING", path: "world/props/infill-lean-to.glb", sizeM: [3.0, 3.85, 3.2], why: "Second rung of the alley descent.", standableAt: [3.85] },
  { key: "churchyard-fence", status: "EXISTING", path: "world/props/churchyard-fence.glb", sizeM: [4.0, 1.15, 0.2], why: "Balcony balustrade, split at the stair opening." },
  { key: "timber-crane", status: "EXISTING", path: "world/props/timber-crane.glb", sizeM: [1.6, 2.6, 1.6], why: "Full-height cover in the duel yard." },
  { key: "ropewalk-laying-rig", status: "EXISTING", path: "world/props/ropewalk-laying-rig.glb", sizeM: [7.8, 1.15, 1.0], why: "Splits the duel yard lengthwise." },
  { key: "rope-coil-large", status: "EXISTING", path: "world/props/rope-coil-large.glb", sizeM: [2.0, 0.75, 1.8], why: "Footing, not cover, and it has to read that way." },
  { key: "service-wall-straight", status: "EXISTING", path: "world/props/service-wall-straight.glb", sizeM: [4.0, 3.6, 0.6], why: "The yard walls; 3.6m is exactly what the upper limb clears." },
  { key: "warehouse-platform-scale", status: "EXISTING", path: "world/props/warehouse-platform-scale.glb", sizeM: [2.6, 1.8, 4.2], why: "The loading stage: the duel's vertical axis.", standableAt: [1.8] },
  { key: "stone-steps", status: "EXISTING", path: "world/props/stone-steps.glb", sizeM: [2.6, 1.8, 1.8], why: "Dressing over the stepped strips up to the stage." },
  { key: "effigy-oliver", status: "EXISTING", path: "world/props/effigy-oliver.glb", sizeM: [1.0, 2.0, 1.0], why: "The thing the whole mission is about." },
  { key: "effigy-boot", status: "EXISTING", path: "world/props/effigy-boot.glb", sizeM: [0.8, 1.0, 0.8], why: "The jackboot with the devil in it, hung beside Oliver." },
  { key: "church-meetinghouse", status: "EXISTING", path: "world/props/church-meetinghouse.glb", sizeM: [16, 10.2, 14], why: "Old Brick's spire silhouette at the head of King Street. NOT the Hollis Street house (see bldg-meeting-hollis) and NOT the watch post any more (see belfry-old-brick): its steeple mesh is a point, so a watch deck authored on top of it stood on nothing. Kept declared for the body's spire read." },
  {
    key: "belfry-old-brick",
    // A re-key of the existing brick building mesh, not a new asset. Old Brick is
    // literally brick (First Church), so its tower is drawn from `bldg-brick.glb`
    // — the same masonry the gaol uses — rather than from `church-meetinghouse`,
    // whose mesh is a pointed steeple with no flat top at any height. The watch
    // post (OLD_BRICK_WATCH) is authored at 13.60m; a pointed spire fitted to that
    // height presents 0% standable surface there and the posted guard floated 3.4m
    // over the church's own 10.2m roofline (owner saw it; check-world-affordances
    // read it SEVERE). This box is solved so a contain-fit lands the mesh's own
    // FLAT roof at 13.60m over the watch footprint: `bldg-brick`'s natural mesh is
    // 1.28 x 1.90 x 1.11, so the y-ratio binds at 13.60/1.90 = 7.16 and the tower
    // draws 9.2 x 13.6 x 7.9 — a square brick belfry rising from the church's south
    // front, its leaded top the watch platform. Width/depth follow the mesh aspect
    // once the height binds; they oversail the 4 x 4 collision plinth the way all
    // the level's stonework oversails its footing (see runtime `sceneryPlacements`).
    status: "EXISTING",
    path: "world/props/bldg-brick.glb",
    sizeM: [9.2, 13.6, 8.0],
    standableAt: [13.6],
    why: "Old Brick's brick watch tower. Carries OLD_BRICK_WATCH at 13.60m — the posted tower guard's platform, 8m above the Town House gallery, which is the sightline the reflex-time beat is built on (opposition WATCH_OLD_BRICK, unchanged). Re-keyed onto the existing gaol brick mesh because the church's own steeple mesh is a point with no deck to stand on; a compact square tower with a flat leaded top is what the watch needs and what a brick meeting house put over its entrance.",
  },
  {
    key: "bldg-meeting-hollis",
    status: "EXISTING",
    path: "world/props/bldg-meeting-hollis.glb",
    // Its own key, because one mesh cannot fill two boxes.
    //
    // `church-meetinghouse` drew both meeting houses and is contain-fitted into
    // each. Old Brick is a several-entry cluster and takes its box from the sizeM
    // above, 16 x 10.2 x 14; Hollis Street is a single entry and takes its box
    // from its own rect, 12 x 8.2 x 8.6. A contain-fit takes the smallest of the
    // three box/mesh ratios, and against a mesh of 0.68 x 1.90 x 1.09 — which is
    // mostly steeple, the body being its bottom third — the Hollis box fitted at
    // 4.32 and drew a 2.94m-wide church on a 12m block. Eight per cent of the
    // roof deck the route lands on had anything under it.
    //
    // No sizeM fixes that. Rebuilding the shared mesh to 16 x 10.2 x 14 still
    // fits the Hollis box at 0.614 and puts its roof at 6.26m, two metres under
    // the deck. An aspect is not a scale.
    //
    // So this is the Hollis body alone: the church mesh's bottom third, turned a
    // quarter so its long elevation faces Orange Street, built to exactly the box
    // the level authored, with a lead flat at 8.20m. The steeple stays where it
    // was — `steeple-meetinghouse-climbable`, which the route climbs — so
    // carrying one here would put two spires on one roof.
    sizeM: [12, 8.2, 8.6],
    standableAt: [8.2],
    why: "The Hollis Street meeting house body: 12m of frontage on Orange Street, 8.6m deep, leaded flat at 8.2m. Six climbs stack off this roof and the leap of faith starts above it, so its eaves deck is walked rather than looked at.",
  },
  { key: "bldg-brick", status: "EXISTING", path: "world/props/bldg-brick.glb", sizeM: [13, 9.6, 14], why: "The stone gaol on Queen Street." },
  { key: "bldg-row-shop", status: "EXISTING", path: "world/props/bldg-row-shop.glb", sizeM: [18, 5.6, 12], why: "The shambles." },
  { key: "bldg-row-brick-a", status: "EXISTING", path: "world/props/bldg-row-brick-a.glb", sizeM: [16, 7.1, 14], why: "South row through the market." },
  { key: "bldg-row-brick-b", status: "EXISTING", path: "world/props/bldg-row-brick-b.glb", sizeM: [9, 12.4, 12], why: "The tall south row the roof run starts on." },
  { key: "bldg-row-clapboard-a", status: "EXISTING", path: "world/props/bldg-row-clapboard-a.glb", sizeM: [10, 7.1, 14], why: "The low north roofs the street crossing lands on." },
  { key: "bldg-row-clapboard-b", status: "EXISTING", path: "world/props/bldg-row-clapboard-b.glb", sizeM: [10, 8.2, 12], why: "Deacon Elliot's house." },
  { key: "bldg-warehouse-street", status: "EXISTING", path: "world/props/bldg-warehouse-street.glb", sizeM: [7, 12.4, 14], why: "The sugar house; the market's high line dies against it." },
  { key: "constable-rigged", status: "EXISTING", path: "world/characters/constable-rigged.glb", sizeM: [0.7, 1.75, 0.5], why: "The market watch and the duel opponent." },
  { key: "officer-rigged", status: "EXISTING", path: "world/characters/officer-rigged.glb", sizeM: [0.7, 1.75, 0.5], why: "Gaol sentry and tower watch." },
  { key: "playerboy-rigged", status: "EXISTING", path: "world/characters/playerboy-rigged.glb", sizeM: [0.7, 1.55, 0.5], why: "The runner." },
  { key: "tankard-cluster", status: "EXISTING", path: "world/props/tankard-cluster.glb", sizeM: [0.5, 0.3, 0.5], why: "Thrown diversion." },
  { key: "coin-paper-set", status: "EXISTING", path: "world/props/coin-paper-set.glb", sizeM: [0.3, 0.1, 0.3], why: "Thrown diversion." },
  { key: "protest-torch", status: "EXISTING", path: "world/props/protest-torch.glb", sizeM: [0.2, 1.2, 0.2], why: "Thrown diversion into the scaffolding." },

  { key: "int-shell-ropewalk-a", status: "EXISTING", path: "world/structures/int-shell-ropewalk-a.glb", sizeM: [22, 8.6, 10], why: "The ropewalk shell: the mission's only interior." },
  { key: "int-partition-board-a", status: "EXISTING", path: "world/structures/int-partition-board-a.glb", sizeM: [0.5, 1.6, 4.4], why: "The tarring partition; too thin on top to stand on, which is what makes it a climb-over." },
  { key: "cargo-net-bundle", status: "EXISTING", path: "world/props/cargo-net-bundle.glb", sizeM: [3.2, 3.2, 3.0], why: "Hemp bales: the quiet way down out of the tie beam.", standableAt: [3.2, 1.1] },
  // 1.0 deep, which is what `build_roofline_kit.py` built and what all six
  // arcade bays are authored at. The 1.2 this used to say was the depth of one
  // bay before the colonnade was regularised, and it outlived it: it made the
  // five correct piers look 0.2m short and the one wrong one look right, which
  // is the exact trap a declaration that disagrees with its own mesh sets.
  { key: "service-wall-end", status: "EXISTING", path: "world/props/service-wall-end.glb", sizeM: [0.6, 3.4, 1.0], why: "The Dock Square arcade piers." },
  { key: "bldg-row-clapboard-c", status: "EXISTING", path: "world/props/bldg-row-clapboard-c.glb", sizeM: [8, 7.1, 20], why: "The east side of Dock Square." },
  { key: "dockhand-rigged", status: "EXISTING", path: "world/characters/dockhand-rigged.glb", sizeM: [0.7, 1.75, 0.5], why: "The ropewalk's night man." },
  { key: "well-pump", status: "EXISTING", path: "world/props/well-pump.glb", sizeM: [1.8, 1.9, 1.8], why: "The town pump: the sightline break that lets the blend take." },
  { key: "flintlock-pistol", status: "EXISTING", path: "world/props/flintlock-pistol.glb", sizeM: [0.35, 0.12, 0.05], why: "The duel weapon, socketed to the hand bone by the duel's weapon rig." },

  // The roof kit, delivered as one wave. Between them they furnish every metre
  // of the two roof runs: the fire board off the Town House leads, the gambrel
  // top of the meeting house, and the stacks the vault rhythm is built on.
  { key: "roof-chimney-stack", status: "EXISTING", path: "world/props/roof-chimney-stack.glb", sizeM: [1.1, 1.05, 1.1], why: "The vault rhythm along the south roofline, and the ropewalk's roof vents. 1.05m tall by 1.10m deep exactly: taller is a mantle, deeper is blocked." },
  // The two heights below are 42mm and 30mm, and they are measurements rather
  // than allowances: `build_roofline_kit.py` builds both of these at true metre
  // scale, so the declaration and the mesh are the same number. The gambrel walk
  // is 42mm from the lead flat to the top of its boards and the fire board is
  // 30mm of pine. The 0.30 and 0.20 they used to declare were guesses at a
  // plank's thickness that never shipped.
  //
  // `standableAt` is the load-bearing half, and it is the whole of what these two
  // are: a deck's dressing whose walking surface is its own top face. `drawBox`
  // hangs a lone deck by that offset, so the boards land ON the plane the level
  // walks and the board's thickness is under the boot rather than over it. Before
  // it was read, both of these drew entirely above their own deck — a gambrel
  // walk from 11.200 to 11.242 over a deck at 11.200 — and no art at any height
  // could have carried the surface it was standing on.
  { key: "roof-ridge-walk", status: "EXISTING", path: "world/props/roof-ridge-walk.glb", sizeM: [9.4, 0.042, 2.8], why: "A leaded gambrel flat with a boarded walk down its spine, 42mm from the lead to the top of the boards. Nothing in M1 draws it today — MEETING_RIDGE was re-keyed to `roof-ridge-monitor`, which had three metres of gap to fill that 42mm of board cannot — and it is kept because 42mm of dressing over an EXISTING flat is a contract the next roof deck will want.", standableAt: [0.042] },
  { key: "roof-plank-gantry", status: "EXISTING", path: "world/props/roof-plank-gantry.glb", sizeM: [2.8, 0.03, 1.2], why: "The fire board off the Town House leads. `roof-walk-board-long` is 5.4m and too long for this 2.8m span.", standableAt: [0.03] },
  {
    key: "roof-ridge-monitor",
    status: "EXISTING",
    path: "world/props/roof-ridge-monitor.glb",
    // Three metres of building that the building cannot draw.
    //
    // MEETING_RIDGE is a walkable plane at 11.20m carried by HOLLIS_MEETING,
    // whose collision mass tops out at 8.20m. A single-entry cluster takes its
    // draw box from its OWN collision, so `bldg-meeting-hollis` is drawn to
    // 8.20 and cannot reach the walk however it is built. The plank walk hung
    // in the sky and the climb up to it went through open air.
    //
    // The owner's ruling is the one this whole level runs on — the art moves to
    // meet the collision, never the reverse — so the gap is filled with art: a
    // raised monitor 3.0m tall, based at 8.20 and topping out flat at 11.20.
    // `drawBox` hangs a lone deck's dressing so its declared `standableAt`
    // lands on the plane, computing baseY = plane - height, so a 3.0m asset
    // standable at 3.0 puts its base at 8.20m exactly. The declared height must
    // equal the mesh's true thickness or that arithmetic binds nothing.
    //
    // ITS OWN KEY, and that is the load-bearing half. `roof-ridge-walk` is
    // declared 0.042m with `standableAt: [0.042]`, and those two numbers are a
    // measurement of its mesh that was deliberately confirmed today and is
    // policed by verify_roofline_kit.mjs. Re-declaring that key at 3.0 to serve
    // this one draw would have made the kit's own contract a lie.
    //
    // 2.8m deep on an 8.6m building reads as a ridge monitor rather than as a
    // full gambrel, which the owner accepted: a raised monitor with louvred
    // sides and a leaded walk on top is what a New England meeting house put
    // over its roof to light and vent the hall, and it is period-plausible in a
    // way that a gambrel squeezed into a third of the plan would not be.
    sizeM: [9.4, 3.0, 2.8],
    standableAt: [3.0],
    why: "The raised monitor on the Hollis Street meeting house: 3.0m of louvred timber standing on the lead flat at 8.20m and carrying the leaded walk at 11.20m, which is the last standable surface before the steeple climb. Before it, MEETING_RIDGE's dressing was 42mm of board hanging three metres clear of the building underneath it.",
  },

  // ---- needed from the art agent ----------------------------------------
  {
    key: "liberty-elm-hero",
    status: "EXISTING",
    path: "world/props/liberty-elm-hero.glb",
    sizeM: [16, 18, 16],
    standableAt: [6.4, 8.3, 11.2],
    why: "The great elm at Essex and Orange, and the mission's climax. Trunk 1.8m across and solid to 12m so every tier is a walk-around; three climbable limb tiers at 6.4 / 8.3 / 11.2m, each at least 3m across so a body fits on them. The 8.3m tier carries the nail face on the west side of the bole. `liberty-elm.glb` exists but is scenery, not climbable.",
  },
  {
    key: "bldg-townhouse-1713",
    status: "EXISTING",
    path: "world/props/bldg-townhouse-1713.glb",
    // The same conflict the steeple had, and caught the same way: the authored
    // galleries and cornices oversail the 11m mass by up to 1.8m a side, so an
    // 11m box cannot reach the ledges the route stands on and a contain-fit would
    // drag all six of them down. 14.6 x 16.2 is the hull the collision actually
    // describes. Note `bldg-townhouse-civic.glb` is a different, older asset and
    // is not this one: seven route nodes stand on ledges it has none of.
    //
    // 15.0 rather than 14.6 on x: CORNICE_E and CORNICE_S reach 59.5 against the
    // 14.6 box's 59.3, so a tenth of the east cornice strip was undrawable. No
    // route node was outside, which is why it read as cosmetic rather than as a
    // hole — the kind of miss the probe finds and the eye does not.
    //
    // Widening this field is the one edit on this asset that MUST be followed by a
    // rebuild, and going from 14.6 to 15.0 without one is how the building shipped
    // with a tenth of CORNICE_E dry. A contain-fit takes the smallest of three
    // ratios, so a mesh short on x alone still draws at scale 1.0000 and nothing
    // about the scale looks wrong. `verify_m1_townhouse.mjs` now compares the mesh
    // to the box on each axis separately, which fails that case by name.
    sizeM: [15.0, 17.6, 16.2],
    standableAt: [5.6, 7.9, 10.2, 12.4, 15.2, 17.6],
    why: "The Town House, standing in the middle of the road as it did. Needs a north balcony at 5.6m with a pedimented centre bay whose soffit sits at 7.30m, a clock ledge at 7.9m, a cornice gutter walk at 10.2m, leads at 12.4m, and a tower to a balustraded gallery at 17.6m. The three ledges between the balcony and the leads are evenly spaced at 2.3 / 2.3 / 2.2m and that is not arbitrary: a cornice may only hang as deep as the headroom under it allows, so uneven gaps buy one moulding at another's expense. `bldg-townhouse-civic.glb` is the nearest existing thing and has none of the ledges.",
  },
  {
    key: "steeple-meetinghouse-climbable",
    status: "EXISTING",
    path: "world/props/steeple-meetinghouse-climbable.glb",
    // 7.4m across, not 4m, and the number is derived rather than chosen.
    //
    // `drawBox` takes an object's plan centre from the union of its solids and
    // its SIZE from this field, and a contain-fit then takes the smallest of the
    // three box/mesh ratios. Declared at 4m against a mesh whose louvre course
    // reaches 3.7m from the draw axis, the fit came out at 0.5405 and every
    // authored ring drew 8.91m BELOW where the collision puts it — the louvre
    // sill that the six-hold south-face climb arrives on had no stone under it at
    // all. A box narrower than the rings it is supposed to carry cannot be fixed
    // by any mesh, because the mesh is what is being shrunk.
    //
    // 30.0, tracking BAND.STEEPLE_FINIAL, because the collision now describes a
    // spire worth the name. At 22.2 the spire was 1.6m and the built mesh read as a
    // tower with a finial on it; at 30.0 it is 9.4m, which is 31% of the height
    // against roughly 40% on the two surviving Boston houses.
    //
    // This number is not independent of geometry.ts and must never be edited apart
    // from it. `drawBox` takes an object's plan centre from the union of its solids
    // and its SIZE from this field, and a contain-fit then takes the smallest of the
    // three box/mesh ratios — so a 30m mesh in a 22.2m box draws at 0.74 and every
    // authored ring lands metres below the collision. The earlier version of exactly
    // that mistake, 4m declared against a 7.4m louvre course, fitted at 0.5405.
    //
    // Worth knowing how quietly it fails: at 22.0 against 22.2 the fit is 0.9910,
    // and the steeple's own probe still reports 100% of every ring underfoot,
    // because 186mm of shortfall hides inside the reader's step-down tolerance. Only
    // the contain-fit check and the headroom check catch it.
    sizeM: [7.4, 30.0, 7.4],
    standableAt: [14.0, 15.8, 18.2, 20.6],
    why: "Hollis Street's steeple, and the take-off for both dives. ONE broad gallery, then a tall 1.2m lantern with a narrow cornice on it, then the weathervane balcony and a 9.4m spire — not four stacked galleries, which is what it was and which read as a pagoda. Ring ledges at louvre sill 14.0, gallery 15.8, lantern cornice 18.2 and vane balcony 20.6; the lower two at least 1.4m deep, the upper two 0.8m of walkway round the lantern and the spire.",
  },
  {
    key: "hay-wain-loaded",
    status: "EXISTING",
    path: "world/props/hay-wain-loaded.glb",
    sizeM: [2.2, 2.2, 3.2],
    standableAt: [2.2],
    why: "The wains the run dives and bails onto: the two under the printshop's south-east corner (the first dive target), the lane catch LANE_HAY, and the duel-yard catch COVER_HAY_NW. A four-wheeled farm wagon loaded above the sideboards; the load reaches 2.2m because that is where the player lands, and the top reads as loose hay rather than a lid. Filled as a BLOCK so the flat load meets the catch plane, where `hay-cart`'s heaped mesh crowns 0.21m proud and left the flat a diver actually lands on that far below it.",
  },
  {
    key: "buttress-stepped-stone",
    status: "EXISTING",
    path: "world/props/buttress-stepped-stone.glb",
    sizeM: [2.4, 2.6, 1.2],
    standableAt: [2.6],
    why: "First hold of the six-hold south-face climb, straight out of the ropewalk door. `service-wall-end` was standing in and cannot: that mesh is a 0.60 x 3.40 x 1.00 arcade pier, so a contain-fit into this box draws 0.46m of a 2.40m mass the route climbs. It cannot be solved by narrowing the collision either, because the reader needs 0.75m of standable span plus a 0.70m capsule and so will not stand a body on anything under 1.45m across. Wants a stepped stone buttress against the meeting house's north wall, 2.4 wide by 1.2 deep, topping out flat at 2.6m.",
  },
  {
    key: "printshop-sign-hood",
    status: "EXISTING",
    path: "world/props/printshop-sign-hood.glb",
    // 50mm, and the whole of it is board.
    //
    // This is the roofline kit's deck contract, and it is a consequence rather
    // than a style: `drawBox` boxes a lone deck at its asset's declared height
    // and hangs it by `standableAt`, so the mesh's TOP FACE is the plane and
    // everything else the object has must fit in the 50mm underneath it. There
    // is no room in that for the sign board itself, which is why the sign is
    // the hood's painted soffit rather than a board swinging under it — a
    // pendant on a bracket would put its own bottom at the bounding box floor
    // and drop the boarding it hangs from 400mm above the catch.
    sizeM: [3.2, 0.05, 1.4],
    standableAt: [0.05],
    why: "The catch at 6.20m outside Edes & Gill, 0.90m under the eaves, and the first rung of the opening descent. `printshop-hanging-sign` was standing in and cannot: its mesh is 1.90 x 1.06 x 0.14, a board on a bracket, so a contain-fit is bound by the board's HEIGHT and draws 2.14 x 1.20 x 0.16 — two thirds of the ledge's length, a ninth of its depth, and standing UP off the plane through the printshop roof, because a lone deck's dressing is registered on the surface the player lands on. What is here now is a projecting boarded hood over the shop door, 3.2 by 1.4 in plan and 50mm of pine boarding on a fascia, so its top IS the catch rather than something the runner clips.",
  },
  {
    key: "bldg-scaffold-run",
    status: "EXISTING",
    path: "world/props/bldg-scaffold-run.glb",
    // Two decks and no mass, which is what sets the base.
    //
    // SCAFFOLD_D1 and SCAFFOLD_D2 share a footprint exactly, so `clusterSpans`
    // makes them one object and `drawBox` takes the several-entry branch: the
    // size is this field and the base is `max(maxY) - height`, i.e. 5.60 - 5.60
    // = 0. So the declared height is also the statement that the scaffold
    // stands on the street, and the top staging's boards ARE the top of the
    // bounding box. Both of those are asserted by the build.
    sizeM: [2.5, 5.6, 11.3],
    standableAt: [2.9, 5.6],
    why: "Repair scaffolding the length of the Town House's west front, and the safe way up it: putlog staging at 2.90 and 5.60 over an 11.3m run, 2.5m out from the wall. `bldg-scaffold` was standing in and cannot, and the reason is a run rather than a shape: that mesh is 1.90 x 1.34 x 1.90, which at this height is a single 2.5m square section, so a contain-fit into the run draws 2.50 x 1.77 x 2.50 — one bay of scaffolding under one end of eleven metres of staging the route walks. It is not squashed art, it is a quarter of the object. What is here now is six bays of standards, ledgers and putlogs over the 11.3m frontage with boarded staging at both authored planes, the top staging flush with the box top at 5.60.",
  },
  {
    key: "work-ladder",
    status: "EXISTING",
    path: "world/props/work-ladder.glb",
    // SUPERSEDED by the `work-ladder-N` family below and no longer placed. The
    // Meshy delivery was a braced trestle: drawn upright and floating under a
    // deck it read as a free-standing A-frame in open air (the owner's
    // screenshot), and no placement turns a trestle into a leaning ladder. Kept
    // published/declared so its collision sidecar and density-kit entry stay
    // valid; `ladderPlacements` draws the generated leaning family instead.
    sizeM: [0.43, 1.9, 0.57],
    why: "SUPERSEDED by work-ladder-8..11 (a generated leaning ladder with human rungs). Retained only so its pipeline sidecars remain valid.",
  },
  // The leaning-ladder family, generated by assets/pipeline/build_work_ladder.mjs:
  // two rails and N rungs at a fixed 0.30 m gauge, one GLB per rung COUNT so the
  // rise is served by more rungs, never bigger ones. Built at real metres
  // (length N*0.30), so check-world-scale reads them as real-scale assets and
  // matches these declared boxes. Placed leaning on the exterior face by
  // `ladderPlacements`, filled per-axis so the gauge stays human at every rise.
  {
    key: "work-ladder-8",
    status: "EXISTING",
    path: "world/props/work-ladder-8.glb",
    sizeM: [0.43, 2.4, 0.05],
    why: "Leaning work ladder, 8 rungs — the ~2.3 m climbs (Town House clock, cornice).",
  },
  {
    key: "work-ladder-9",
    status: "EXISTING",
    path: "world/props/work-ladder-9.glb",
    sizeM: [0.43, 2.7, 0.05],
    why: "Leaning work ladder, 9 rungs — the ~2.6 m climbs (scaffold upper staging, Hollis lean-to).",
  },
  {
    key: "work-ladder-10",
    status: "EXISTING",
    path: "world/props/work-ladder-10.glb",
    sizeM: [0.43, 3.0, 0.05],
    why: "Leaning work ladder, 10 rungs — the ~2.8–2.9 m climbs (scaffold foot, tower plinth, louvre sill).",
  },
  {
    key: "work-ladder-11",
    status: "EXISTING",
    path: "world/props/work-ladder-11.glb",
    sizeM: [0.43, 3.3, 0.05],
    why: "Leaning work ladder, 11 rungs — the 3.0 m meeting-ridge climbs.",
  },
  {
    key: "yard-kerb-stone",
    status: "EXISTING",
    path: "world/props/yard-kerb-stone.glb",
    sizeM: [5.6, 0.34, 1.2],
    standableAt: [0.34],
    why: "The kerb round the Dock Square pump yard: 5.6m of dressed granite edging 0.34m proud, which is inside STEP_UP going up and inside the free step-down coming back. `colonial-yard-perimeter` was standing in and cannot, and this one is an asset bug rather than a declaration: that key is a road-kit GROUND PLATE measuring 226.00 x 0.08 x 20.00 with a sidecar that says so, so the contain-fit is 0.0248 and it draws 5.60 x 0.002 x 0.50 — two millimetres of paving lying in the road where the level says there is a step. A kerb is a raised edge; nothing about a ground plate can be one. What is here now is four dressed kerbstones on a bedding course, jointed and weathered, flat on top at 0.34 with the arris chamfered off the street side.",
  },
  {
    key: "crowd-market-1765",
    status: "NEEDED",
    path: "world/props/crowd-market-1765.glb",
    sizeM: [4, 1.8, 4],
    why: "An instanceable knot of townspeople for the two blend volumes. Blending is a real mechanic here, so the crowd has to be dense enough to disappear into: roughly one body per two square metres.",
  },
  {
    key: "handbill-unstamped",
    status: "EXISTING",
    path: "world/posters/handbill-unstamped.png",
    sizeM: [0.3, 0.4, 0.01],
    why: "What the player is carrying and what gets nailed up. Unstamped printed matter, which is the point.",
  },
  {
    key: "notice-stamp-act",
    status: "EXISTING",
    path: "world/posters/notice-stamp-act.png",
    sizeM: [0.5, 0.7, 0.01],
    why: "The official notice already on the tree, for the handbill to go up beside.",
  },
];

/** Clips the route's authored affordances will ask the animation layer for. */
export const REQUIRED_CLIPS = [
  "parkour.step_up",
  "parkour.slide",
  "parkour.vault",
  "parkour.climb_over",
  "parkour.mantle",
  "parkour.climb_up",
  "parkour.jump_gap",
  "parkour.hang_drop",
  "parkour.run_off",
  "parkour.leap_of_faith",
  "parkour.edge_brake",
  "mission.post_handbill",
] as const;

export const ASSET_KEYS = new Set(ASSETS.map((asset) => asset.key));
export const NEEDED_ASSETS = ASSETS.filter((a) => a.status === "NEEDED");
