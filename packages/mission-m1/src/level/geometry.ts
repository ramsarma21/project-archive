// M1 "The Effigy Run" — geometry.
//
// Boston, 14 August 1765. The spine is the real high street of the peninsula —
// Cornhill becoming Marlborough becoming Newbury becoming Orange — ending at
// the great elm on the corner of Essex Street. The run compresses roughly a
// mile of that road into eighty-eight metres: the buildings, their order along
// the road and their relative heights are real; the distances are not.
//
// The height vocabulary is fixed (envelope.ts BAND) so a player learns to read
// altitude at a glance, and the legal ways between bands are a small set:
//
//   alley  (4.0m wide  -> 2.6m roof gap)   free leap, either direction
//   street (6.4m wide  -> 5.0m roof gap)   downhill only, or take a plank
//   square (22m wide)                      no leap exists; go down and come up
//
// Every roof deck oversails the mass beneath it by JETTY_M. That is the
// stand-off a capsule needs at a wall face — a deck flush with its own wall
// would embed the player the instant a fall took the foot below the wall top —
// and it is also exactly how the city was built.

import { BAND, JETTY_M } from "../envelope.js";
import { deck, inflate, prop, rampStrips, rect, soffit, structure } from "../authoring.js";
import type { DeckSpec, MassSpec, RampSpec } from "../types.js";

const masses: MassSpec[] = [];
const decks: DeckSpec[] = [];
const ramps: RampSpec[] = [];

function building(opts: Parameters<typeof structure>[0]): void {
  const built = structure(opts);
  masses.push(built.mass);
  if (built.deck) decks.push(built.deck);
}

export const LEVEL_BOUNDS = rect(-8, 106, -30, 24);
export const STREET = { minZ: -3.2, maxZ: 3.2 } as const;
/** The Town House square, and the open corner where the elm stands. */
export const SQUARE = rect(42, 62, -11.2, 11.2);
export const LIBERTY_CORNER = rect(74, 88, -7, 7);
export const YARD = rect(88, 100, -6.5, 6.5);

// ---------------------------------------------------------------------------
// A — Queen Street: the printing office (0:00-0:24). Verb: CHAIN_DROP.
// ---------------------------------------------------------------------------

// Edes & Gill — an ENTERABLE Georgian shell (was one solid mass). Four perimeter
// wall masses drawn as the brick facade, with a 4 m SOUTH SHOPFRONT GAP (open
// aperture, no door — the sanctioned ground entry facing the wharf), an interior
// CEILING slab so the body cannot clip up to the leads, and the leads roof kept.
// The mesh is regenerated to match by build_civic_facade.py (C.2). The player
// spawns inside on the ground → stairs → balcony → CLIMB chain onto the leads.
// PRINTSHOP is the north wall so PRINTSHOP__ROOF and the drying/sign/pentice
// decks keep their `carriedBy` and A_START stays on the leads.
const PS_FOOT = rect(0, 13, -17.2, -3.2);
const PS_WT = 0.5; // wall thickness
const PS_CEIL = 3.0; // interior ceiling
masses.push(
  prop({
    id: "PRINTSHOP",
    section: "A_LEADS",
    asset: "bldg-printshop",
    rect: rect(0, 13, -17.2, -17.2 + PS_WT),
    baseY: 0,
    topY: BAND.LOW_ROOF,
    landable: false,
    tags: ["structure", "north-row", "start", "interior-shell"],
    note: "Edes & Gill, in Queen Street near the prison. North wall + shell body; the run opens on its leads and the interior is enterable through the south shopfront.",
  }),
  prop({
    id: "PRINTSHOP_WALL_W",
    section: "A_LEADS",
    asset: "bldg-printshop",
    rect: rect(0, PS_WT, -17.2, -3.2),
    baseY: 0,
    topY: BAND.LOW_ROOF,
    landable: false,
    tags: ["structure", "north-row", "interior-shell"],
  }),
  prop({
    id: "PRINTSHOP_WALL_E",
    section: "A_LEADS",
    asset: "bldg-printshop",
    rect: rect(13 - PS_WT, 13, -17.2, -3.2),
    baseY: 0,
    topY: BAND.LOW_ROOF,
    landable: false,
    tags: ["structure", "north-row", "interior-shell"],
  }),
  // South (street/wharf) wall, split around the shopfront gap x 4.5..8.5.
  prop({
    id: "PRINTSHOP_WALL_S_W",
    section: "A_LEADS",
    asset: "bldg-printshop",
    rect: rect(0, 4.5, -3.2 - PS_WT, -3.2),
    baseY: 0,
    topY: BAND.LOW_ROOF,
    landable: false,
    tags: ["structure", "north-row", "interior-shell", "shopfront"],
  }),
  prop({
    id: "PRINTSHOP_WALL_S_E",
    section: "A_LEADS",
    asset: "bldg-printshop",
    rect: rect(8.5, 13, -3.2 - PS_WT, -3.2),
    baseY: 0,
    topY: BAND.LOW_ROOF,
    landable: false,
    tags: ["structure", "north-row", "interior-shell", "shopfront"],
  }),
  // Interior ceiling over the REAR of the room only (z −16.9..−8). It caps the
  // rear at 3.0 m so the body cannot clip up to the leads there; the FRONT bay
  // (z −8..−3.2) is left double-height so the internal stair can rise to the 2.9 m
  // gallery balcony with headroom (a 3.0 m ceiling over a 2.9 m balcony would bury
  // the player's head). Overlaps the walls 0.2 m so it clusters into the one
  // printshop draw (scenery.test "drawn once").
  prop({
    id: "PRINTSHOP_CEILING",
    section: "A_LEADS",
    asset: "bldg-printshop",
    rect: rect(0.3, 12.7, -16.9, -8.0),
    baseY: PS_CEIL,
    topY: PS_CEIL + 0.15,
    landable: false,
    tags: ["structure", "ceiling", "interior-shell"],
  }),
);
decks.push(
  deck({
    id: "PRINTSHOP__ROOF",
    section: "A_LEADS",
    asset: null,
    rect: inflate(PS_FOOT, JETTY_M),
    y: BAND.LOW_ROOF,
    carriedBy: ["PRINTSHOP"],
    tags: ["roof", "north-row", "start"],
  }),
);

// Interior → stairs → balcony → leads. The internal stair rises in the open front
// bay as stepped rampStrips (each strip ≤ freeStepUp, so the flow reader absorbs it
// with no stair clip) to a gallery balcony at 2.9 m that runs out through the
// shopfront gap, from which the exterior pentice (4.4) → sign (6.2) → leads (7.1,
// A_START) chain climbs. This is the sanctioned ground→roof start. The strips are
// invisible collision (asset rule allows it for ramps/stairs); a thin strip cannot
// carry a stone-steps mesh, so a visible stair block is a later polish nicety.
decks.push(
  ...rampStrips({
    id: "PRINTSHOP_STAIR",
    section: "A_LEADS",
    asset: null,
    axis: "Z",
    from: { at: -7.5, y: 0 },
    to: { at: -5.0, y: 2.9 },
    cross: 6.0,
    halfWidth: 1.0,
    tags: ["stairs"],
  }),
);
masses.push(
  // A full-width counting-room gallery along the front. It is a SOLID mezzanine
  // (baseY 2.6..topY 2.9), not a one-way deck: the shop floor is an occupiable
  // room directly beneath it, and a one-way deck there lets a body jumping in the
  // room clip up through the gallery underside (the airborne deck-edge graze
  // invariant). Solid, the mover simply stops that jump. Drawn by the printshop
  // mesh (asset bldg-printshop → the generator lays the slab, TOP on 2.9) so a rail
  // stands on real stone; overlaps the W/E walls 0.2 m so it clusters into the one
  // printshop draw, and stays inside the footprint so it is inside the draw
  // envelope. PRINTSHOP_BALCONY__DECK (route.ts, added at re-line) will be the
  // null-asset landing surface on its top.
  prop({
    id: "PRINTSHOP_BALCONY",
    section: "A_LEADS",
    asset: "bldg-printshop",
    rect: rect(0.3, 12.7, -5.0, -3.2),
    baseY: 2.6,
    topY: 2.9,
    landable: false,
    tags: ["structure", "balcony", "interior-shell"],
    note: "The printer's gallery over the shop floor — the first off-ground surface. Reached by the internal stair; opens south onto the shopfront and the leads chain.",
  }),
  // Balustrade along the gallery's inner (north) edge, split around the stair
  // head so the ascent is not railed off. Sits on the drawn gallery slab.
  prop({
    id: "PRINTSHOP_BALUSTRADE_W",
    section: "A_LEADS",
    asset: "churchyard-fence",
    rect: rect(0.5, 4.8, -5.0, -4.8),
    baseY: 2.9,
    topY: 2.9 + 1.15,
    landable: false,
    tags: ["balustrade"],
  }),
  prop({
    id: "PRINTSHOP_BALUSTRADE_E",
    section: "A_LEADS",
    asset: "churchyard-fence",
    rect: rect(7.2, 12.5, -5.0, -4.8),
    baseY: 2.9,
    topY: 2.9 + 1.15,
    landable: false,
    tags: ["balustrade"],
  }),
);

decks.push(
  deck({
    id: "PRINTSHOP_DRYING",
    section: "A_LEADS",
    asset: "printer-drying-rack",
    rect: rect(6.0, 8.6, -12.4, -9.6),
    y: BAND.LOW_ROOF,
    carriedBy: ["PRINTSHOP"],
    tags: ["pickup"],
    note: "Sheets pegged out to dry. Run through it; nothing stops.",
  }),
  deck({
    id: "PRINTSHOP_SIGN",
    section: "A_LEADS",
    asset: "printshop-sign-hood",
    rect: rect(9.4, 12.6, -2.6, -1.2),
    y: 6.2,
    carriedBy: ["PRINTSHOP"],
    tags: ["ledge", "catch"],
    note: "The printer's sign board. First rung of the descent, 0.90m under the eaves.",
  }),
  deck({
    id: "PRINTSHOP_PENTICE",
    section: "A_LEADS",
    asset: "market-awning",
    rect: rect(7.0, 12.6, -1.0, 1.2),
    y: 4.4,
    carriedBy: ["PRINTSHOP"],
    tags: ["awning", "catch"],
    note: "Every rung of this chain is 2.20m or less, which is exactly the run-off ceiling: the player never stops, never hangs, never brakes.",
  }),
);

// These two want an asset that does not exist yet, and it is worth writing down
// what was tried so nobody spends the afternoon again.
//
// The collision is 2.2 wide by 3.2 deep by 2.2 tall, twice, and `hay-cart`'s mesh
// is 1.90 x 0.89 x 1.06 — a small two-wheeled cart. A contain-fit takes the
// smallest of three ratios, so it draws 2.20 x 1.03 x 1.23: 38% of the landing's
// depth and, worse, a top 1.17m below the surface that actually catches you. The
// asset note calls this a dive target, and a thing you aim a leap at reading half
// the size of the area that catches you is a readability defect rather than a
// cosmetic one.
//
// Turning it does not work. `yaw` looks like a draw property and is not:
// `compile.ts` turns a yawed mass into an oriented bounding box, so a quarter turn
// rotates the COLLISION with the art, which swapped this footprint's 2.2 and 3.2
// and dropped A_PENTICE->A_HAY_W onto the ground beside it. Reshaping the rects
// does not work either: the two wains stand side by side under the roof's
// south-east corner with the catch nodes 2.2m apart, and a 3.4m cart laid along x
// needs 6.8m of frontage the alley does not have.
//
// So it needs its own key: a hay WAIN, which is what the level has always called
// it — a four-wheeled farm wagon piled above the sideboards, 2.2 x 2.2 x 3.2 —
// rather than the handcart `hay-cart` actually is. Declared in assets.ts as NEEDED.
masses.push(
  prop({
    id: "HAY_WAIN_W",
    section: "A_LEADS",
    asset: "hay-wain-loaded",
    rect: rect(10.0, 12.2, -0.2, 3.0),
    topY: 2.2,
    tags: ["catch", "hay"],
  }),
  prop({
    id: "HAY_WAIN_E",
    section: "A_LEADS",
    asset: "hay-wain-loaded",
    rect: rect(12.2, 14.4, -0.2, 3.0),
    topY: 2.2,
    tags: ["catch", "hay"],
    note: "Under the roof's south-east corner, clear of the sign and the pentice: the sprint line's 4.9m roll landing, and loud enough to reach the market watch.",
  }),
);

building({
  id: "GAOL",
  section: "A_LEADS",
  asset: "bldg-brick",
  rect: rect(17, 30, -17.2, -3.2),
  roofY: BAND.MID_ROOF,
  tags: ["north-row"],
  note: "The stone gaol. Its roof sits 2.5m above the printshop's, which is more than the apex of a running jump: you cannot leap up onto it, and that is deliberate.",
});

decks.push(
  deck({
    id: "ALLEY_HOIST_PLANK",
    section: "A_LEADS",
    asset: "roof-walk-board-long",
    rect: rect(13.7, 16.65, -13.0, -10.6),
    y: BAND.PENTICE,
    carriedBy: ["PRINTSHOP", "GAOL"],
    tags: ["plank"],
    note: "Loading beam across Dassett Alley. First rung of the hidden descent.",
  }),
  deck({
    id: "ALLEY_LEANTO",
    section: "A_LEADS",
    asset: "infill-lean-to",
    rect: rect(13.7, 16.65, -10.2, -7.0),
    y: BAND.SHED,
    carriedBy: ["GAOL"],
    tags: ["shed"],
  }),
);

masses.push(
  prop({
    id: "ALLEY_CRATES",
    section: "A_LEADS",
    // Filled wall-to-wall across Dassett Alley (PRINTSHOP east at x=13, GAOL west
    // at x=17), where it used to leave a 0.60m slot to the printshop and a 0.40m
    // slot to the gaol — both narrower than the 0.70m capsule, so a body pushing
    // along the alley clipped the wall it could not fit against. `crate-stack` is
    // a BLOCK module (runtime.ts): the imported mesh FILLS the collider on every
    // axis, so widening the box widens the drawn stack with it and leaves no
    // misleading visible gap. The descent lands on the top (A_ALLEY_CRATES at
    // x=15.1) and drops off the south face to A_ALLEY_FLOOR, neither of which the
    // widening touches.
    asset: "crate-stack",
    rect: rect(13.0, 17.0, -6.4, -4.4),
    topY: BAND.STACK,
    tags: ["crates"],
  }),
  prop({
    id: "ALLEY_OVERSHOOT_CRATES",
    section: "A_LEADS",
    // East face flush to the gaol's west wall (x=17), closing the 0.40m
    // sub-capsule slot it left against it. `crate-mound` is a BLOCK module, so
    // the drawn mound fills the widened collider and there is no visible gap.
    asset: "crate-mound",
    rect: rect(15.0, 17.0, -13.0, -10.6),
    topY: BAND.STACK,
    tags: ["crates", "catch"],
    note: "Catches a runner who sprints past the plank instead of onto it.",
  }),
);

// ---------------------------------------------------------------------------
// B — the Shambles (0:24-1:04). Verb: BLEND + DIVERT.
// ---------------------------------------------------------------------------

building({
  id: "MARKET_SHED",
  section: "B_SHAMBLES",
  asset: "bldg-row-shop",
  rect: rect(2, 23, 3.2, 15.2),
  roofY: 5.6,
  tags: ["south-row", "market"],
  note: "The butchers' shambles. Low roof, and the high line through the market runs along it.",
});

decks.push(
  deck({
    id: "SHAMBLES_PENTICE",
    section: "B_SHAMBLES",
    asset: "market-awning",
    // East edge 18.3, not 22.4, and this is a COLLISION move rather than an art
    // one — the only one in this pass, made on the owner's explicit authority.
    //
    // It ran to 22.4 and the stall row starts at 18.3, so this deck covered 3.92
    // of STALL_0__CANOPY's 8.40 square metres — 47% of it — while sitting 0.55m
    // higher, at 3.10 against the stall canopy's 2.55. Both are dressed with
    // `market-awning`, so a player standing on stall 0 had this pentice's canvas
    // drawn across their thighs. It is the first canopy the route climbs onto
    // (B_CANOPY_FOOT -> B_CANOPY_0) and it is the burial the owner photographed.
    //
    // No art could have fixed it. Two decks 0.55m apart in the same plan are two
    // solid surfaces in the same place, and whichever is drawn correctly the
    // other one is through somebody's legs. A stall is pitched IN FRONT OF a
    // shed's pentice, never under it, so the pentice now stops where the stall
    // row begins and the two abut at 18.3 instead of overlapping.
    //
    // No route node moves: B_PENTICE is at x 16.6, 1.7m inside what is left, and
    // B_CANOPY_0 at 19.7 is now under open sky. The pentice is 3.3m rather than
    // 7.4m, which is one module tile rather than two — and that also retires the
    // seam down its middle, where two tiles' worth of the old apron met and left
    // it the worst-covered awning in the level.
    rect: rect(15.0, 18.3, 1.4, 3.2),
    y: 3.1,
    carriedBy: ["MARKET_SHED"],
    tags: ["awning"],
  }),
);

// The south side of the market opens into Dock Square (see dockSquare.ts).
// There is deliberately no building here: the high line has to end somewhere.

building({
  id: "SUGAR_HOUSE",
  section: "B_SHAMBLES",
  asset: "bldg-warehouse-street",
  rect: rect(34, 41, -17.2, -3.2),
  roofY: BAND.LEADS,
  tags: ["north-row"],
  note: "The sugar house closes the north side; the market's high line dies against it.",
});

// 4.2m apart with 2.8m canopies: a 1.4m hop between each. The spacing sits on
// the chain controller's tuned window, so the canopy run pays out as one move
// instead of five separate ones.
const stallXs = [18.4, 22.6, 26.8, 31.0, 35.2];
stallXs.forEach((x, index) => {
  masses.push(
    prop({
      id: `STALL_${index}`,
      section: "B_SHAMBLES",
      asset: "market-stall",
      rect: rect(x, x + 2.6, 0.4, 2.4),
      topY: BAND.STACK,
      tags: ["stall", "mid-line"],
    }),
  );
  // The two canopies that FLANK the gaol-barrel vault (stalls 0 and 1, either
  // side of GAOL_BARRELS at x 21.6-22.7) keep their south edge OUT of the street
  // lane. A vault lifts a standing capsule to ~1.3m over the barrel; where a
  // canopy overhangs the lane to z=-0.20 that lifted head crosses the awning
  // deck plane, so `authoredTrajectoryClear` refused the vault for any body north
  // of z~=-0.55 — i.e. for a player running the natural street line (the street
  // nodes sit at z=-0.4). The vault only committed on the exact z=-0.6 axis, so a
  // normal forward run wedged against the barrels with a VAULT that never fired
  // and the only way on was to climb the canopies. Pulling these two south edges
  // to the stall front (z=0.0) clears the whole lane for the vault while leaving
  // the mid-line canopy run (the nodes sit at z=1.3) and every downstream awning
  // untouched. Stalls 2-4 keep the overhanging south edge the SAFE awning climb
  // (B_CRATES_FOOT -> B_CANOPY_2_S) reaches up onto.
  const canopySouthZ = index <= 1 ? 0.0 : -0.2;
  decks.push(
    deck({
      id: `STALL_${index}__CANOPY`,
      section: "B_SHAMBLES",
      asset: "market-awning",
      rect: rect(x - 0.1, x + 2.7, canopySouthZ, 2.8),
      y: BAND.STALL_ROOF,
      carriedBy: [`STALL_${index}`],
      tags: ["awning", "mid-line"],
    }),
  );
});

// The parked carts back onto the north-row wall (the GAOL runs x 17-30, the
// SUGAR_HOUSE x 34-41, both with their south face at z=-3.2). Where a wall is
// behind a cart the cart's back face is set flush to it (z=-3.2); left at -2.8 it
// stood 0.40m proud of the wall, a slot narrower than the 0.70m capsule that a
// body pushing north into it could neither enter nor clear. `hand-cart` is a
// BLOCK module (runtime.ts) — its mesh FILLS the collider on every axis — so the
// drawn cart deepens with the box and no misleading gap opens behind it. The
// SOUTH face stays at -1.2, so the 1.6m street lane and the GAOL_BARRELS vault
// gap in front of the carts are untouched. CART_2 (x 30.2-32.6) sits in the open
// break between the gaol and the sugar house with no wall behind it, so its back
// stays at -2.8.
const cartXs = [19.6, 25.4, 30.2, 36.4];
const cartBackZ = [-3.2, -3.2, -2.8, -3.2];
cartXs.forEach((x, index) => {
  masses.push(
    prop({
      id: `CART_${index}`,
      section: "B_SHAMBLES",
      asset: "hand-cart",
      rect: rect(x, x + 2.4, cartBackZ[index]!, -1.2),
      topY: BAND.CART,
      tags: ["cart", "street-line", "sight-break"],
    }),
  );
});

masses.push(
  prop({
    id: "GAOL_BARRELS",
    section: "B_SHAMBLES",
    asset: "barrel-group",
    // Shifted 0.25m south (z centre -0.35 -> -0.60) off the earlier [-0.90, 0.20]
    // footprint. The live vault's real obstacle-top arc used to clip the two
    // flanking stall canopies to either side; the counterfactual that clears both
    // without ignoring or shrinking them is this quarter-metre south. Depth (1.10)
    // and height unchanged, so the barrels still sit inside the vault envelope.
    rect: rect(21.6, 22.7, -1.15, -0.05),
    topY: BAND.BARREL,
    tags: ["vault"],
    note: "1.10m tall, 1.10m deep: inside the vault envelope on every face.",
  }),
  prop({
    id: "SHAMBLES_CRATES_A",
    section: "B_SHAMBLES",
    asset: "crate-stack",
    rect: rect(28.4, 30.4, -3.2, -1.4),
    topY: BAND.STACK,
    tags: ["climb", "crossover"],
    note: "The street line's way up to the canopies.",
  }),
  prop({
    id: "SHAMBLES_CRATES_B",
    section: "B_SHAMBLES",
    // Back face flush to the sugar house's south wall (z=-3.2), closing the 0.40m
    // sub-capsule slot behind it. `crate-mound` is a BLOCK module, so the drawn
    // mound fills the deepened collider with no visible gap; the crossover top
    // (B_CRATES_B at z=-2.0) is unaffected.
    asset: "crate-mound",
    rect: rect(38.0, 40.4, -3.2, -1.2),
    topY: BAND.STACK,
    tags: ["climb", "crossover"],
  }),
  soffit({
    id: "PASSAGE_HOIST",
    section: "B_SHAMBLES",
    asset: "duck-beam-frame",
    // 2.5m along the street, which is what B_STREET_MID's own note has always
    // claimed — "just inside the 2.6m span the verb accepts". The mass was 3.0m,
    // which is outside it, so the slide was refused every time and the only way
    // through the SAFE line's duck was to hold crouch and walk. Nothing teaches
    // that, and the measured result was a player pressed against the beam at
    // (24.05, 0, -0.4) for fifteen seconds with the reader offering nothing.
    rect: rect(24.4, 26.9, -1.2, 0.2),
    baseY: 1.2,
    thickness: 0.9,
    tags: ["duck"],
    note: "Underside at 1.20m: a standing capsule will not fit through, a crouched one will.",
  }),
);

// ---------------------------------------------------------------------------
// C — the Town House (1:04-1:48). Verb: CLIMB + REFLEX.
// ---------------------------------------------------------------------------

// It stands in the middle of the road, which is where it actually stood. Left
// lane, right lane, or over the top: the mission's one real fork.
building({
  id: "TOWNHOUSE",
  section: "C_ASCENT",
  asset: "bldg-townhouse-1713",
  rect: rect(46.5, 57.5, -5.5, 5.5),
  roofY: BAND.LEADS,
  jetty: 1.0,
  tags: ["island", "landmark"],
  note: "The 1713 Town House. The ascent spirals it twice and tops out on the tower.",
});

masses.push({
  id: "TOWNHOUSE_TOWER",
  section: "C_ASCENT",
  asset: "bldg-townhouse-1713",
  rect: rect(50.0, 54.0, -2.0, 2.0),
  baseY: BAND.LEADS,
  topY: 17.1,
  landable: false,
  // The tower is the same building rising out of its own leads, drawn by the one
  // townhouse mesh — not a separate mass set down on the roof — so it is carried
  // by the body below rather than resting on a drawn floor at 12.4m.
  carriedBy: ["TOWNHOUSE"],
  tags: ["structure", "tower"],
});

// Six walkable ledges on a five-storey block, and every one of them a shelf.
//
// The building drew correctly and probed clean and still read as a pagoda from the
// street, for the same reason the steeple did: the ledges were authored 1.8 to
// 2.8m deep, which is two to three times what the line walking them occupies, and
// six plates that deep oversailing four façades is a stack of eaves whatever is
// underneath them. The steeple's fix applies unchanged — the depth of a walkable
// ring should be the width of the walk, and the rest is silhouette the level is
// paying for and does not use.
//
// So each rect below is cut to a body plus a margin either side, measured off the
// nodes that actually stand on it, and stays welded to the wall that carries it.
// The nodes move with them: they sat on each deck's centreline, so a deck narrowed
// about its outer edge would have left them hanging over the new lip.
//
// There is a hard floor on how far this can go, and it is worth writing down
// because it is lower than it looks. `standableSpanM` measures the band the
// capsule's CENTRE can occupy, and the reader wants 0.75m of it; the capsule is
// 0.70m wide. So a walkable ledge cannot be shallower than 1.45m whatever the art
// wants, and cutting CORNICE_E to 1.4m produced a 0.70m span and a route node the
// reader would not stand on. Every depth below is 1.6m — the floor plus a step of
// margin — and 1.6m of oversail on six façades is as thin as this building can
// legally be. What is left of the pagoda after that is the NUMBER of ledges and
// the flat plates they are drawn as, neither of which is a rect.
decks.push(
  deck({
    id: "GALLERY_N",
    section: "C_ASCENT",
    asset: "bldg-townhouse-1713",
    // 2.2m rather than 2.4m, and the shallowest cut of the six, because this one
    // has things standing on it. A balustrade takes 0.2m of the floor and the
    // masons' stock behind it takes 0.45m, so the walk is what is left, and the
    // walk needs 1.45m: 2.10m is the floor and there is 0.3m to give. Cutting it
    // to 1.6m like the rest left the stock a 1.35m band and a 0.65m span, and the
    // reflex beat lost its third answer outright — the balustrade, the stock and
    // the pediment all had to come in with the lip rather than stay where they
    // were, or they stand off the edge of the floor they belong to.
    rect: rect(47.5, 57.5, -7.7, -5.5),
    y: BAND.GALLERY,
    carriedBy: ["TOWNHOUSE"],
    tags: ["gallery", "exposed"],
    note: "The north balcony. Fully open to the Old Brick watch except under the centre pediment.",
  }),
  deck({
    id: "GALLERY_E",
    section: "C_ASCENT",
    asset: "bldg-townhouse-1713",
    rect: rect(57.5, 59.1, -7.7, 5.5),
    y: BAND.GALLERY,
    carriedBy: ["TOWNHOUSE"],
    tags: ["gallery"],
  }),
  // The four ledges below name the building rather than a gutter prop, and that
  // is a correction rather than a simplification.
  //
  // They were dressed with `colonial-gutter-straight`, which is a road-kit
  // drainage channel: 20.00 x 0.08 x 1.30 of street surface, with a sidecar that
  // says "walkable ground surface, support is the implicit ground plane". Laid
  // into a cornice return the contain-fit is bound by the 20m length against a
  // 1.6m-wide walk, so CLOCK_LEDGE drew a 0.10m ribbon 6mm thick down a 9m
  // ledge and TOWER_PLINTH drew 0.46m of a 7m ring. Nothing carried; the strip
  // is not even counted as support for its own deck, because a deck's dressing
  // is drawn standing ON the plane it dresses.
  //
  // The stone under the foot here was always the Town House's own — the mesh is
  // built with a clock ledge at 7.9 and a cornice gutter walk at 10.2, and
  // `verify_m1_townhouse.mjs` has always probed these four as this building's
  // job whatever prop was laid on top. Naming the building is what the level
  // already means. No rect moves: the four decks join the Town House's cluster,
  // which takes its box from assets.ts and its plan centre from the footing, so
  // the building draws exactly where and as large as it did.
  deck({
    id: "CLOCK_LEDGE",
    section: "C_ASCENT",
    asset: "bldg-townhouse-1713",
    rect: rect(57.5, 59.1, -4.5, 4.5),
    y: BAND.CLOCK_LEDGE,
    carriedBy: ["TOWNHOUSE"],
    tags: ["ledge", "exposed"],
  }),
  deck({
    id: "CORNICE_E",
    section: "C_ASCENT",
    asset: "bldg-townhouse-1713",
    rect: rect(57.5, 59.1, -5.7, 6.6),
    y: BAND.CORNICE,
    carriedBy: ["TOWNHOUSE"],
    tags: ["ledge"],
  }),
  deck({
    id: "CORNICE_S",
    section: "C_ASCENT",
    asset: "bldg-townhouse-1713",
    // This one narrows from both sides, because only its outboard half was ever
    // standable: the block is solid through 12.4m, so the 1.1m of this rect that
    // lay inboard of the south wall was inside the building. Cutting the outboard
    // half to 0.7m therefore did not make a narrow walk, it made none at all —
    // `positionClear` separates axes, so a body there overlapped the block on both
    // and the probe reported 0.00m across the narrow axis. 5.4 to 6.9 keeps 1.4m
    // of walk outboard of the wall and tucks 0.1m under it so there is no crack of
    // daylight at the joint.
    rect: rect(46.0, 59.1, 5.4, 7.0),
    y: BAND.CORNICE,
    carriedBy: ["TOWNHOUSE"],
    tags: ["ledge"],
    note: "Leaded gutter walk along the south front: the second half of the spiral.",
  }),
  deck({
    id: "TOWER_PLINTH",
    section: "C_ASCENT",
    // 6.4m rather than 7.4m: 1.2m of walkway round the 4m shaft instead of 1.7m,
    // which still clears the 0.75m the reader needs by a wide margin and stops the
    // ring reading as a fourth eave halfway up the tower.
    asset: "bldg-townhouse-1713",
    rect: rect(48.5, 55.5, -3.5, 3.5),
    y: BAND.TOWER_PLINTH,
    carriedBy: ["TOWNHOUSE_TOWER"],
    tags: ["ledge", "ring"],
    note: "Balustraded ring; the tower mass fills the middle so this is a walk-around.",
  }),
  deck({
    id: "TOWER_GALLERY",
    section: "C_ASCENT",
    asset: "bldg-townhouse-1713",
    // 4.8m rather than 5.4m, so it caps the 4m shaft by 0.4m instead of 0.7m and
    // the tower stages narrow the whole way up: 6.4 then 4.8.
    rect: rect(49.6, 54.4, -2.4, 2.4),
    y: BAND.TOWER_GALLERY,
    carriedBy: ["TOWNHOUSE_TOWER"],
    tags: ["vista"],
    note: "The vista. From here the effigy in the elm is in clear line of sight and every metre after this is downhill toward it.",
  }),
);

masses.push(
  // Split at the stair opening, which is where the fast line comes up out of
  // the north lane. Without the gap the hop off the pentice hits the rail.
  prop({
    id: "GALLERY_BALUSTRADE_W",
    section: "C_ASCENT",
    asset: "churchyard-fence",
    rect: rect(47.5, 52.9, -7.7, -7.5),
    baseY: BAND.GALLERY,
    topY: 6.75,
    landable: false,
    tags: ["balustrade"],
  }),
  prop({
    id: "GALLERY_BALUSTRADE_E",
    section: "C_ASCENT",
    asset: "churchyard-fence",
    rect: rect(54.9, 57.5, -7.7, -7.5),
    baseY: BAND.GALLERY,
    topY: 6.75,
    landable: false,
    tags: ["balustrade"],
  }),
  // ---- the masons' materials, which are what makes hard cover exist ---------
  //
  // The Town House is under repair — the scaffold on the west front is the safe
  // way up — so builders' stock on the balcony and the staging is the ordinary
  // consequence of that, and it is the only hard cover anywhere near the reflex
  // beat. Before these, `covered` fired at NONE of the nodes where the player is
  // actually visible: everything in the level either screened nothing at all or
  // screened the chest ray too, and a blocked chest ray is already worth zero.
  //
  // 1.55m is measured, not chosen for looks. The tower watch is eight metres
  // ABOVE the balcony, so his sightline comes down at 47 degrees and a screen has
  // to be tall relative to that — which is why the shipped 1.15m balustrade does
  // nothing and `crouching behind the rail does not work` is a test. Standing at
  // C_GALLERY_MASONS the ladder is:
  //
  //   out on the balcony             mean read 0.51
  //   standing behind the stack      mean read 0.15   (the engine's coverFactor)
  //
  // At 1.90m the standing case goes to zero too and cover stops being a state
  // BETWEEN exposed and hidden, which is the whole thing it exists to be. So the
  // number is bounded on both sides and 1.55 is the middle.
  //
  // The stack stops short of x=48.8 on purpose. Reaching further east it stands
  // in the tower's line to C_GALLERY_W itself, and that node is authored to be
  // read in both stances — `crouching behind the rail does not work, because he
  // is above you` is the section's own claim. So the third answer to the reflex
  // beat is a PLACE, the way the hood and the corner are, and not a posture at
  // the node the beat is about.
  prop({
    id: "TOWNHOUSE_MASONS_W",
    section: "C_ASCENT",
    asset: "crate-stack",
    // Shifted 0.4m inboard with the balcony, keeping its 0.2m setback from the lip
    // and its 0.2m gap to the body pressing in behind it. Stacked against a
    // balustrade that has moved, it would have stood off the edge in mid-air and
    // the reflex beat's third answer would have been cover with nothing behind it.
    rect: rect(47.6, 48.8, -7.5, -7.05),
    baseY: BAND.GALLERY,
    topY: BAND.GALLERY + 1.55,
    landable: false,
    tags: ["cover"],
    note: "Lime barrels and boards stacked against the balustrade at the balcony's west end, where the stair off the scaffold lands. The third answer to the reflex beat: the hood, the corner, or two strides west and press in behind this.",
  }),
  prop({
    id: "TOWNHOUSE_MASONS_E",
    section: "C_ASCENT",
    asset: "crate-stack",
    // Shifted with the north balcony and pulled in with the east arm, which
    // narrowed to 58.9: at 59.3 this stock hung 0.4m off the side of the ledge
    // carrying it.
    rect: rect(57.6, 59.1, -7.7, -7.35),
    baseY: BAND.GALLERY,
    topY: BAND.GALLERY + 1.55,
    landable: false,
    tags: ["cover"],
    note: "The same stock round the corner on the east arm, so the run for the corner has something to arrive behind rather than only somewhere to be.",
  }),
  prop({
    id: "SCAFFOLD_MATERIALS",
    section: "C_ASCENT",
    asset: "crate-stack",
    rect: rect(43.6, 45.4, -7.7, -7.15),
    baseY: BAND.GALLERY,
    topY: BAND.GALLERY + 1.55,
    landable: false,
    tags: ["cover"],
    note: "Boards on the upper staging, and stopping 0.7m short of its east standard. Full width they also stood in the tower's sightline down to the LOWER staging and took that rung's exposure from 24% of his cycle to nothing — cover that deletes the tension it was added to grade is worse than none, so the stack is short and C_SCAFF_1 stays honest.",
  }),
  soffit({
    id: "BALCONY_HOOD",
    section: "C_ASCENT",
    asset: "bldg-townhouse-1713",
    // Follows the balcony in, keeping the same 0.2m of oversail past its lip. A
    // pediment that overhangs by 0.6m instead is the only cover on the balcony
    // reaching further out than the floor it shelters.
    rect: rect(49.6, 53.2, -7.9, -5.5),
    baseY: 7.3,
    thickness: 0.5,
    tags: ["reflex-cover"],
    note: "Pediment over the centre bay: the one thing on the balcony that breaks a sight line coming from above.",
  }),
);

// The scaffold's poles are deliberately not colliders. They are thin, you are
// meant to be able to run under the staging, and as blockers they would only
// litter the north lane with knee-high hazards the player cannot see.
decks.push(
  deck({
    id: "SCAFFOLD_D1",
    section: "C_ASCENT",
    asset: "bldg-scaffold-run",
    rect: rect(43.6, 46.1, -7.7, 3.6),
    y: BAND.SCAFFOLD_1,
    tags: ["scaffold"],
  }),
  deck({
    id: "SCAFFOLD_D2",
    section: "C_ASCENT",
    asset: "bldg-scaffold-run",
    rect: rect(43.6, 46.1, -7.7, 3.6),
    y: BAND.GALLERY,
    tags: ["scaffold"],
  }),
);

// The body is `bldg-meeting-hollis`, not `church-meetinghouse`, and the collision
// rect is untouched: only the asset the mass is drawn with changed.
//
// `church-meetinghouse` is a narrow tall mesh — mostly steeple — so contain-fitting
// it into this 16 x 10.2 x 14 block drew a 3.65m-wide church inside a 16m footprint:
// ~90% of the mass the solver collides had no building in it (an invisible wall on
// the square's north edge) and the roof plane at 10.2m had drawn stone under only
// 10% of it, 6.6m low. `scripts/check-world-affordances.mjs` flagged OLD_BRICK__ROOF
// SEVERE for exactly that. The cure the repo has used twice — for the Town House and
// the steeple — is to make the drawn thing fill its box rather than to move the box.
//
// `bldg-meeting-hollis.glb` is a real-scale meeting-house BODY (12 x 8.2 x 8.6),
// the same broad hall the Hollis Street house is drawn with, and its aspect fits
// this block: a single-entry contain-fit draws 14.9 x 10.2 x 10.7, filling the
// footprint and reaching the roof plane at 10.2m. Pointing OLD_BRICK at its own
// key (distinct from the tower/watch below) makes it a single-entry cluster, which
// takes its draw box from THIS rect rather than from a shared declared size, so no
// new asset declaration is needed and Old Brick and Hollis share one broad-hall
// mesh the way two Boston meeting houses plausibly would.
//
// The tower and its watch post stay `church-meetinghouse` (below): its steeple
// silhouette is what draws the belfry the watch stands on. See the note there on
// why the watch at 13.6m still needs its own resolution.
building({
  id: "OLD_BRICK",
  section: "C_ASCENT",
  asset: "bldg-meeting-hollis",
  rect: rect(44, 60, -25.2, -11.2),
  roofY: BAND.CORNICE,
  tags: ["north-row", "landmark"],
  note: "First Church, 'Old Brick', at the head of King Street. Its tower is the watch post.",
});

// RESOLVED (was UNRESOLVED). The tower and its watch deck now draw with
// `belfry-old-brick` — a re-key of the existing `bldg-brick.glb` masonry, not a
// new asset — instead of `church-meetinghouse`.
//
// Why the change. The watch post (OLD_BRICK_WATCH below) is authored at 13.60m,
// 3.4m ABOVE the 10.2m roof `church-meetinghouse` reached, and that mesh is a
// pointed steeple: fitted to 13.6m it presents 0% standable surface there, so the
// posted tower guard stood on nothing and floated 3.4m over the church's own
// roofline in the sky (the owner saw it; check-world-affordances read it SEVERE,
// -3.48m, 0% at plane). Lowering the deck instead was rejected: the guard's height
// lives in opposition `WATCH_OLD_BRICK` (waypoint y=13.60), and the deck does not
// drive it, so dropping the deck alone would leave the guard floating AND the 13.6m
// perch — 8m above the Town House gallery — is the deliberate sightline the reflex
// beat is composed against. So the geometry rises to meet the authored deck, per
// the level's own rule that the art moves to meet the collision.
//
// `belfry-old-brick`'s box is solved (see assets.ts) so a PROP contain-fit lands
// the brick mesh's FLAT roof at 13.60m over the watch footprint — 100% standable
// there (verified: check-world-affordances OLD_BRICK_WATCH satisfied). The tower's
// 4x4 COLLISION plinth is unchanged; only the drawn asset key changed, and the
// belfry mesh oversails that footing the way all the level's stonework oversails
// its own base (see runtime `sceneryPlacements`), so no cover/stealth/route hull
// moved. `church-meetinghouse` is kept declared for the spire silhouette read.
masses.push({
  id: "OLD_BRICK_TOWER",
  section: "C_ASCENT",
  asset: "belfry-old-brick",
  rect: rect(50, 54, -15.4, -11.4),
  baseY: 0,
  topY: 13.1,
  landable: false,
  tags: ["structure", "tower"],
});

decks.push(
  deck({
    id: "OLD_BRICK_WATCH",
    section: "C_ASCENT",
    asset: "belfry-old-brick",
    rect: rect(49.3, 54.7, -16.1, -10.7),
    y: 13.6,
    carriedBy: ["OLD_BRICK_TOWER"],
    tags: ["watch-post"],
  }),
);

masses.push(
  prop({
    id: "LANE_HAY",
    section: "C_ASCENT",
    // hay-wain-loaded, not hay-cart: this is a dive/bail-out catch, and the cart
    // mesh's heaped load crowns 0.21m above its flat area, so the flat a diver
    // meets sat 0.21m under the authored 2.2m catch. The wain's load is flat to
    // 0.08m. Both fill their blocker; only the top the diver lands on changed.
    asset: "hay-wain-loaded",
    rect: rect(48.0, 51.0, -10.4, -8.2),
    topY: 2.2,
    tags: ["catch", "hay", "fast-line"],
    note: "The balcony's bail-out as well as its approach: 3.4m down onto hay.",
  }),
  prop({
    id: "LANE_CRATES",
    section: "C_ASCENT",
    asset: "crate-stack",
    rect: rect(51.6, 53.8, -10.6, -8.8),
    topY: BAND.STACK,
    tags: ["fast-line"],
  }),
);

// ---------------------------------------------------------------------------
// The south lane — the third way round the island, and the one that was missing.
//
// C_SQUARE_NW's own note says the island forces a choice between "this lane, the
// south lane, or over the top", and the geometry offered two of those: the
// scaffold at the north-west corner and the hay-and-pentice line ten metres east
// of it. Both are in the north lane. Both are inside the Old Brick watch's sweep.
//
// So the cautious answer did not exist. The square is twenty-two metres of open
// lit granite with a posted watch at its head — the surface itself says there is
// no crossing here — and the honest reading of that is that a careful runner does
// not walk across it, they go round the back of the building where the service
// lane is. That is what this is: six metres of working lane between the Town
// House's south front and the market row, in the building's own shadow, with the
// ordinary furniture of a lane in it.
//
// It is longer than the crossing and it is where the section's verbs live, which
// is the trade the rest of the mission is built on.
// The ground under the elm, which the route crossed in one eleven-metre run.
//
// It is the mission's last ten seconds and its largest crowd — twelve bodies in a
// six-metre cluster, under torches, with the constable coming up the street — and
// the route spent none of it: down the boughs and a straight sprint to the yard
// gate. The barrels give the crossing the same verb the market and the lane use,
// and put it where the crowd is rather than beside it.
masses.push(
  prop({
    id: "LIBERTY_BARRELS",
    section: "F_TREE",
    asset: "barrel-group",
    rect: rect(83.65, 84.75, 4.25, 5.35),
    topY: BAND.BARREL,
    tags: ["vault", "crowd-lane"],
    note: "Barrels the crowd rolled out to stand on, south of the bole and inside the throng. Vaulting them keeps you under the 2.4 m/s the blend holds at, which is the whole reason the fast line across this ground is a different line and not the same one faster.",
  }),
);

masses.push(
  prop({
    id: "KING_LANE_BARRELS",
    section: "C_ASCENT",
    asset: "barrel-group",
    rect: rect(48.6, 49.7, 8.0, 9.1),
    topY: BAND.BARREL,
    tags: ["vault"],
    note: "Ash barrels outside the Town House's cellar door. 1.10m on every face, so the lane opens with the verb the Shambles taught.",
  }),
  prop({
    id: "KING_LANE_GATE",
    section: "C_ASCENT",
    asset: "int-partition-board-a",
    rect: rect(51.4, 51.9, 6.4, 10.8),
    topY: 1.6,
    landable: false,
    tags: ["climb-over"],
    note: "A boarded yard gate across the lane, 0.50m deep on top. Under the 0.75m a body needs to stand, which is what makes the reader pick CLIMB_OVER instead of putting the player on top of it.",
  }),
  prop({
    id: "KING_LANE_CRATES",
    section: "C_ASCENT",
    asset: "crate-stack",
    rect: rect(52.8, 54.6, 9.4, 11.2),
    topY: BAND.STACK,
    tags: ["fast-line"],
    note: "Market stock against the row's back wall: the way up onto the lane pentice, and the only height in the lane.",
  }),
);

decks.push(
  deck({
    id: "KING_LANE_PENTICE",
    section: "C_ASCENT",
    asset: "infill-lean-to",
    // North to 9.2 so its edge is 0.2m off the crates it is climbed from: an
    // authored CLIMB is a short reach rather than a traverse, and the whole
    // approach has to fit inside that.
    rect: rect(52.6, 58.4, 5.9, 9.2),
    y: BAND.SHED,
    tags: ["awning", "fast-line"],
    note: "The lean-to along the market row's back. Running it beats the lane floor by four metres of gate and barrel, and it ends in a 3.85m drop into the head of King Street — a roll landing, five metres from where the constable's beat turns. The lane is the quiet way and this is the quick one, and the difference is entirely noise.",
  }),
);

decks.push(
  deck({
    id: "LANE_PENTICE",
    section: "C_ASCENT",
    asset: "market-awning",
    rect: rect(51.0, 56.0, -11.0, -8.2),
    y: 4.6,
    tags: ["awning", "fast-line"],
  }),
);

// ---------------------------------------------------------------------------
// D — the Orange Street roofline (1:48-2:28). Verb: LEAP + VAULT.
// ---------------------------------------------------------------------------

building({
  id: "SOUTH_ROW_A",
  section: "D_ROOFLINE",
  asset: "bldg-row-brick-b",
  rect: rect(62, 71, 3.2, 15.2),
  roofY: BAND.LEADS,
  tags: ["south-row", "roof-run"],
});

building({
  id: "ROW_N_A",
  section: "D_ROOFLINE",
  asset: "bldg-row-clapboard-a",
  rect: rect(63, 73, -17.2, -3.2),
  roofY: BAND.LOW_ROOF,
  tags: ["north-row", "roof-run"],
  note: "5.3m below the south roofs. The only way across Orange Street on this block is downward, which is why the roof run descends.",
});

decks.push(
  deck({
    id: "LEADS_GANTRY",
    section: "D_ROOFLINE",
    asset: "roof-plank-gantry",
    rect: rect(58.5, 61.3, 3.6, 4.8),
    y: BAND.LEADS,
    carriedBy: ["TOWNHOUSE", "SOUTH_ROW_A"],
    tags: ["plank", "safe-line"],
    note: "Fire board off the Town House leads. The 2.8m leap beside it is the fast line.",
  }),
);

const chimneyXs = [64.4, 67.6];
chimneyXs.forEach((x, index) => {
  masses.push(
    prop({
      id: `CHIMNEY_${index}`,
      section: "D_ROOFLINE",
      asset: "roof-chimney-stack",
      rect: rect(x, x + 1.1, 5.6, 6.7),
      baseY: BAND.LEADS,
      topY: BAND.LEADS + 1.05,
      tags: ["vault", "roof-run"],
      note: "1.05m over the leads and 1.10m deep: a vault, not a climb.",
    }),
  );
});

// ---------------------------------------------------------------------------
// E/F — Hollis Street and the Liberty Tree (2:28-3:00).
// Verb: LEAP_OF_FAITH + PRECISION.
// ---------------------------------------------------------------------------

building({
  id: "HOLLIS_MEETING",
  // Its own key rather than `church-meetinghouse`, and the collision is
  // untouched: only the asset the body is drawn with changed. A single-entry
  // cluster takes its draw box from its own rect, so this box is 12 x 8.2 x 8.6
  // while Old Brick's — a cluster of body, tower and watch post — is the declared
  // 16 x 10.2 x 14. A contain-fit takes the smallest of three ratios, so the
  // shared mesh drew a 2.94m-wide church on this 12m block and 8% of the roof the
  // route lands on had anything under it. See assets.ts: no sizeM reconciles two
  // boxes with one aspect.
  section: "E_LEAP",
  asset: "bldg-meeting-hollis",
  rect: rect(74, 86, 7.0, 15.6),
  roofY: BAND.MEETING_EAVE,
  tags: ["south-row", "landmark"],
  note: "Hollis Street meeting house. Its steeple is the nearest high point to the elm once Orange Street is compressed.",
});

decks.push(
  deck({
    id: "MEETING_RIDGE",
    section: "E_LEAP",
    // `roof-ridge-monitor`, not `roof-ridge-walk`, and the collision is
    // untouched: only the asset the surface is dressed with changed, the same
    // swap HOLLIS_MEETING made above and for a related reason.
    //
    // This plane is at 11.20m and the building carrying it is a single-entry
    // cluster whose mass tops out at 8.20m, so `bldg-meeting-hollis` takes its
    // draw box from its own collision and stops three metres under the walk.
    // No roof art on the building can close that. `roof-ridge-walk` cannot
    // either: it is 42mm of leaded flat and boards, so it drew the walk
    // correctly ON the plane with nothing but sky between it and the roof.
    //
    // The monitor is 3.0m tall and standable at 3.0, which is what puts its
    // base at 11.20 - 3.00 = 8.20 exactly. See assets.ts.
    asset: "roof-ridge-monitor",
    rect: rect(75.3, 84.7, 7.6, 10.4),
    y: BAND.MEETING_RIDGE,
    carriedBy: ["HOLLIS_MEETING"],
    tags: ["roof-run"],
  }),
);

masses.push(
  {
    id: "STEEPLE",
    section: "E_LEAP",
    asset: "steeple-meetinghouse-climbable",
    rect: rect(79, 83, 9.6, 13.6),
    baseY: 0,
    topY: 15.3,
    landable: false,
    tags: ["structure", "steeple"],
  },
  // The lantern, 1.2m across rather than 2.0m.
  //
  // This is the silhouette fix. Four walkable rings at 7.4, 5.4, 5.4 and 3.4m
  // stacked at 1.8m centres on a 2.0m core is a pagoda, and it read as one: a
  // brick-and-white tower with its spire missing. Old South and Old North carry
  // ONE gallery, then a tall open lantern, then a spire. So the upper core
  // narrows to a lantern and the ring on it narrows with it, and the two of them
  // stop being a third and fourth gallery.
  //
  // 1.2m is not a taste: a 2.8m ring on a 2.0m core leaves 0.4m of annulus, and
  // `positionClear` separates axes, so a body at the ring's corner overlaps the
  // core on BOTH and there is nowhere on it to stand at all. Against a 1.2m core
  // the same ring leaves 0.8m, which clears the 0.75m the reader needs.
  {
    id: "STEEPLE_LANTERN",
    section: "E_LEAP",
    asset: "steeple-meetinghouse-climbable",
    rect: rect(81.4, 82.6, 11.0, 12.2),
    baseY: BAND.STEEPLE_GALLERY,
    topY: BAND.STEEPLE_VANE,
    landable: false,
    // The lantern is the steeple continuing up out of its gallery, one mesh, so
    // it is carried by the shaft below rather than standing on a drawn floor.
    carriedBy: ["STEEPLE"],
    tags: ["structure", "steeple", "lantern"],
  },
  // The spire, declared so that it can exist.
  //
  // Nothing was authored above the top ring, and `sceneryPlacements` sizes an
  // object from the hull its collision describes — so there was no height for a
  // spire to be drawn into, and anything the mesh carried up there would have been
  // art in air the player sprints through. Non-landable, tapered inside the
  // lantern head, and the reason the declared box is 22.2m rather than 20.6m.
  {
    id: "STEEPLE_SPIRE",
    section: "E_LEAP",
    asset: "steeple-meetinghouse-climbable",
    rect: rect(81.5, 82.5, 11.1, 12.1),
    baseY: BAND.STEEPLE_VANE,
    topY: BAND.STEEPLE_FINIAL,
    landable: false,
    // The spire is the steeple's own head above the vane balcony, one mesh.
    carriedBy: ["STEEPLE_LANTERN"],
    tags: ["structure", "steeple", "spire"],
  },
);

decks.push(
  deck({
    id: "LOUVRE_SILL",
    section: "E_LEAP",
    asset: "steeple-meetinghouse-climbable",
    rect: rect(77.3, 84.7, 7.9, 15.3),
    y: BAND.LOUVRE_SILL,
    carriedBy: ["STEEPLE"],
    tags: ["ledge", "ring"],
  }),
  deck({
    id: "STEEPLE_GALLERY",
    section: "E_LEAP",
    asset: "steeple-meetinghouse-climbable",
    rect: rect(78.3, 83.7, 8.9, 14.3),
    y: BAND.STEEPLE_GALLERY,
    carriedBy: ["STEEPLE"],
    tags: ["leap-point"],
    note: "The leap of faith: 5.7m of gap and 7.5m of fall into the crown of the elm.",
  }),
  // 2.8m, not 5.4m: a cornice round the lantern rather than a third gallery.
  //
  // It also fixes the dive off the gallery below, and that is not a coincidence.
  // At 5.4m this ring reached north to z=8.9, which is a half metre PAST the
  // take-off at z=9.6 — so the diver launched from under his own next ledge and
  // clipped its plane 0.18m out. At 2.8m the ring stops at z=10.2 and the arc,
  // which travels north to south, is never beneath it at all.
  deck({
    id: "STEEPLE_CROCKETS",
    section: "E_LEAP",
    asset: "steeple-meetinghouse-climbable",
    rect: rect(80.6, 83.4, 10.2, 13.0),
    y: BAND.STEEPLE_CROCKETS,
    carriedBy: ["STEEPLE_LANTERN"],
    tags: ["ledge", "ring"],
  }),
  // 2.6m, not 3.4m: the stages have to narrow all the way up.
  //
  // At 3.4m this balcony was WIDER than the 2.8m cornice under it, and a stage
  // that widens as it rises is the one silhouette move no meeting house makes —
  // it was the last pagoda cue left in the object after the lantern fix. 2.6m
  // makes the whole stack monotonic: 7.4, 5.4, 2.8, 2.6.
  //
  // 2.6 and not less because of the spire in the middle of it. A 1.0m spire
  // leaves (2.6 - 1.0) / 2 = 0.8m of walkway, which clears the 0.75m the reader
  // needs; 2.4m would leave 0.7m and there would be nowhere on it to stand. That
  // is also why the spire cannot be widened to match the lantern: at 1.2m the
  // walkway drops to 0.7m and the expert take-off has no floor.
  deck({
    id: "STEEPLE_VANE",
    section: "E_LEAP",
    asset: "steeple-meetinghouse-climbable",
    rect: rect(80.7, 83.3, 10.3, 12.9),
    y: BAND.STEEPLE_VANE,
    carriedBy: ["STEEPLE_LANTERN"],
    tags: ["leap-point", "expert"],
    note: "The weathervane balcony at the lantern head, and the take-off for the expert dive. It beds on the lantern rather than floating half a metre above it, which is what used to put a slab over the crockets ring and make 17% of that ring crouch-only.",
  }),
);

masses.push(
  prop({
    // Its own key, because a 0.6m arcade pier cannot be a 2.4m buttress.
    //
    // This was drawn by `service-wall-end`, whose mesh is 0.60 x 3.40 x 1.00. The
    // box is 2.40 x 2.60 x 1.20, so the contain-fit is driven by the height ratio
    // and draws 0.46 x 2.60 x 0.76 — 19% of the width of a mass the route climbs
    // and stands on. Narrowing the collision to the pier's shape is not open
    // either: the reader needs 0.75m of standable span plus a 0.70m capsule, so a
    // surface a body is left on cannot be under 1.45m across, and 0.6m is less
    // than half of that. Nothing about a placement can fix an aspect.
    id: "HOLLIS_BUTTRESS",
    section: "E_LEAP",
    asset: "buttress-stepped-stone",
    rect: rect(74.2, 76.6, 15.6, 16.8),
    topY: 2.6,
    tags: ["climb"],
    note: "First hold of the south-face climb, straight out of the ropewalk door.",
  }),
);

decks.push(
  deck({
    id: "HOLLIS_LEANTO",
    section: "E_LEAP",
    asset: "infill-lean-to",
    rect: rect(72.6, 78.4, 14.6, 17.0),
    y: 5.2,
    carriedBy: ["HOLLIS_MEETING"],
    tags: ["shed"],
    note: "Six climbs stacked back to back: buttress, lean-to, eave, gambrel, louvre, gallery. Sustained vertical, which is a different beat from the horizontal traverses either side of it.",
  }),
);

building({
  id: "ELLIOT_HOUSE",
  section: "E_LEAP",
  asset: "bldg-row-clapboard-b",
  rect: rect(76, 86, -19.0, -7.0),
  roofY: BAND.MEETING_EAVE,
  tags: ["north-row"],
  note: "Deacon Elliot's, on whose ground the elm stood. Its gambrel gives the cautious leap.",
});

masses.push({
  id: "LIBERTY_ELM_TRUNK",
  section: "F_TREE",
  asset: "liberty-elm-hero",
  rect: rect(80.1, 81.9, -0.1, 1.7),
  baseY: 0,
  topY: 12.0,
  landable: false,
  round: { radius: 0.9 },
  tags: ["tree", "landmark"],
  note: "Solid to 12m, so every limb tier is a walk-around rather than a platform.",
});

decks.push(
  deck({
    id: "TREE_AWNING",
    section: "F_TREE",
    asset: "market-awning",
    rect: rect(76.6, 79.8, 1.2, 4.4),
    y: 3.2,
    carriedBy: ["TREE_STALL"],
    tags: ["awning", "catch"],
    note: "Splits the 6.4m fall out of the boughs into two hang drops. Without it the reader brakes at the lip and the run ends standing still.",
  }),
  deck({
    id: "BOUGH_LOW",
    section: "F_TREE",
    asset: "liberty-elm-hero",
    rect: rect(77.4, 84.6, -2.8, 4.4),
    y: BAND.BOUGH_LOW,
    carriedBy: ["LIBERTY_ELM_TRUNK"],
    tags: ["bough", "catch"],
    note: "Widest tier: the catch for anyone who leaves the steeple short.",
  }),
  deck({
    id: "BOUGH_CROWN",
    section: "F_TREE",
    asset: "liberty-elm-hero",
    rect: rect(78.6, 83.4, -1.6, 3.2),
    y: BAND.BOUGH_CROWN,
    carriedBy: ["LIBERTY_ELM_TRUNK"],
    tags: ["bough", "catch", "post"],
    note: "The nail height. The effigy hangs a tier below and the crowd is under that.",
  }),
  deck({
    id: "BOUGH_UPPER",
    section: "F_TREE",
    asset: "liberty-elm-hero",
    rect: rect(81.4, 84.6, -1.6, 3.6),
    y: BAND.BOUGH_UPPER,
    carriedBy: ["LIBERTY_ELM_TRUNK"],
    tags: ["bough", "catch", "expert"],
  }),
);

masses.push(
  prop({
    id: "TREE_STALL",
    section: "F_TREE",
    asset: "market-stall",
    rect: rect(77.0, 79.4, 0.6, 2.2),
    topY: 1.1,
    tags: ["stall"],
    note: "A bookseller's stall under the elm. The corner was a place of business before it was a place of assembly.",
  }),
  prop({
    id: "EFFIGY_OLIVER",
    section: "F_TREE",
    asset: "effigy-oliver",
    rect: rect(82.6, 83.6, 1.6, 2.6),
    baseY: 4.2,
    topY: 6.2,
    landable: false,
    carriedBy: ["LIBERTY_ELM_TRUNK"],
    tags: ["dressing", "landmark"],
    note: "Hung before dawn on the 14th. The sheriff was ordered to cut it down and did not dare.",
  }),
  prop({
    id: "EFFIGY_BOOT",
    section: "F_TREE",
    asset: "effigy-boot",
    rect: rect(79.0, 79.8, 1.4, 2.2),
    baseY: 4.8,
    topY: 5.8,
    landable: false,
    carriedBy: ["LIBERTY_ELM_TRUNK"],
    tags: ["dressing"],
    note: "The jackboot with the devil climbing out of it: the pun on Lord Bute.",
  }),
);

// ---------------------------------------------------------------------------
// G — the rope-walk yard (the duel).
// ---------------------------------------------------------------------------

const yardWalls: Array<[string, ReturnType<typeof rect>]> = [
  ["YARD_WALL_W_N", rect(87.4, 88.0, -6.5, -1.5)],
  ["YARD_WALL_W_S", rect(87.4, 88.0, 1.5, 6.5)],
  ["YARD_WALL_E", rect(100.0, 100.6, -6.5, 6.5)],
  ["YARD_WALL_N", rect(87.4, 100.6, -7.1, -6.5)],
  ["YARD_WALL_S", rect(87.4, 100.6, 6.5, 7.1)],
];
yardWalls.forEach(([id, r]) => {
  masses.push(
    prop({
      id,
      section: "G_YARD",
      asset: "service-wall-straight",
      rect: r,
      topY: 3.6,
      landable: false,
      tags: ["arena-wall"],
    }),
  );
});

// A rope-walk yard is a long low laying floor with stock stacked round it,
// which happens to be the exact cover grammar a six-round duel needs: two
// full-height pieces that break a standing sight line, three chest pieces that
// break a crouched one, one long spine that splits the yard, and a raised
// stage so the fight has an up as well as a sideways.
masses.push(
  prop({
    id: "COVER_LAYING_RIG",
    section: "G_YARD",
    asset: "ropewalk-laying-rig",
    rect: rect(92.0, 98.0, -0.5, 0.5),
    topY: 1.15,
    tags: ["cover", "low"],
    note: "The laying floor runs the length of the yard and splits it in two.",
  }),
  prop({
    id: "COVER_HAY_NW",
    section: "G_YARD",
    // hay-wain-loaded for the same reason as LANE_HAY: this carries the yard-hay
    // leap catch (LEAP_YARD_HAY), and the wain's flat load meets the diver at the
    // authored 2.2m where the heaped cart's flat area sat 0.2m under it.
    //
    // 3.1 x 3.2 (was 2.8 x 2.6), grown ONLY toward the NW corner walls to back
    // LEAP_YARD_HAY's 1.6m acceptance disc. That dive is an OFFERED leap, so its
    // radius is pinned at 1.6m by the reader (traversability.test) and cannot be
    // shrunk to stop the "caught by air" overrun; the honest fix is the bigger
    // catching object. This is a BLOCK asset, so the loaded wain fills the rect
    // and the disc (recentred on the wain) lands on real hay across its whole
    // radius. The EAST (92.2) and SOUTH (-2.4) edges — the two that face the
    // duel's playing floor — are UNMOVED, because they are what the six-round
    // breaks were solved against: BREAK_R3's peek sits 0.05m off the east face
    // (92.6, cap radius 0.35 -> 92.25) and BREAK_R1 hides just west of the south
    // reach. Only WEST (89.4 -> 89.1) and NORTH (-5.0 -> -5.6) grow, into the dead
    // corner already walled off, so no break station, peek or fighting position
    // moves and the graded cover line is untouched (BREAK_R1.pos 0.15m clear at
    // x89.1, BREAK_R2.pos 0.15m clear at z-5.6). Wall clearances: 1.1m to
    // YARD_WALL_W (x88.0), 0.9m to YARD_WALL_N (z-6.5).
    asset: "hay-wain-loaded",
    rect: rect(89.1, 92.2, -5.6, -2.4),
    topY: 2.2,
    tags: ["cover", "high", "catch", "hay"],
    note: "Fodder for the rope-walk's draught horses. Full cover in the duel, and the receiving target for anyone who dives in over the wall off the upper limb.",
  }),
  prop({
    id: "COVER_STACK_SE",
    section: "G_YARD",
    asset: "crate-mound",
    rect: rect(96.0, 98.4, 2.8, 5.2),
    topY: 2.35,
    tags: ["cover", "high"],
  }),
  prop({
    id: "COVER_BARRELS_NE",
    section: "G_YARD",
    asset: "barrel-group",
    rect: rect(96.2, 98.2, -5.0, -3.0),
    topY: 1.55,
    tags: ["cover", "mid"],
  }),
  prop({
    id: "COVER_BARRELS_SW",
    section: "G_YARD",
    asset: "barrel-group",
    rect: rect(89.6, 91.6, 2.8, 4.8),
    topY: 1.55,
    tags: ["cover", "mid"],
  }),
  prop({
    id: "COVER_CRANE_BASE",
    section: "G_YARD",
    asset: "timber-crane",
    rect: rect(93.2, 94.8, -3.6, -2.0),
    topY: 2.6,
    landable: false,
    tags: ["cover", "high"],
  }),
  prop({
    id: "COVER_COILS_C",
    section: "G_YARD",
    asset: "rope-coil-large",
    rect: rect(92.6, 94.6, 3.0, 4.8),
    topY: 0.75,
    tags: ["texture"],
    note: "Too low to hide behind. It is footing, not cover, and it reads that way.",
  }),
  prop({
    id: "YARD_STAGE",
    section: "G_YARD",
    asset: "warehouse-platform-scale",
    rect: rect(97.4, 100.0, -2.0, 2.2),
    topY: 1.8,
    tags: ["stage"],
  }),
);

ramps.push({
  id: "YARD_STAGE_RAMP",
  section: "G_YARD",
  asset: "stone-steps",
  axis: "X",
  from: { at: 94.8, y: 0.0 },
  to: { at: 97.4, y: 1.8 },
  halfWidth: 0.9,
  cross: 0.1,
  tags: ["ramp", "arena"],
});

export const GEOMETRY = { masses, decks, ramps } as const;
export const JETTY = JETTY_M;
