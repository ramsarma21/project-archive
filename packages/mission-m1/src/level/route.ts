// M1 route: nodes on real surfaces, links the engine can actually perform.
//
// Every section carries at least two lines and most carry three. They are not
// parallel corridors — they cross, and a player may swap at any shared node
// without choosing a route in a menu:
//
//   SAFE    always works, no timing demanded, shipped affordances only
//   FAST    shorter or higher, wants a clean run-up, usually more exposed
//   EXPERT  the ceiling: full-sprint take-offs and gaps inside the expert cap
//
// Two constraints show up all over this file and are both enforced by tests
// rather than by good intentions:
//
//   * MANTLE is permanently disabled in playerMotion.ts, so no SAFE link may
//     need it.
//   * An authored CLIMB is a short reach, not a traverse. Its start node sits
//     within ~2m of its end and names the mass being climbed in `ignore`,
//     because `beginAuthored` sweeps the whole trajectory against the world.

import { link, node } from "../authoring.js";
import { BAND } from "../envelope.js";
import type { RouteLink, RouteNode } from "../types.js";

export const NODES: RouteNode[] = [
  // -- A: the leads ---------------------------------------------------------
  node("A_START", "A_LEADS", [3.0, BAND.LOW_ROOF, -11.0], "PRINTSHOP__ROOF", ["start"],
    "Open on a roof, not a street. The first thing the player sees is the route below them."),
  node("A_SHEETS", "A_LEADS", [7.3, BAND.LOW_ROOF, -11.0], "PRINTSHOP__ROOF", ["pickup"],
    "Through the drying rack. Custody of the unstamped sheets, no stop, no line of dialogue."),
  node("A_EAVE_S", "A_LEADS", [10.6, BAND.LOW_ROOF, -2.8], "PRINTSHOP__ROOF", ["lip"]),
  node("A_EAVE_SE", "A_LEADS", [13.2, BAND.LOW_ROOF, -2.8], "PRINTSHOP__ROOF", ["lip"],
    "The corner with nothing under it. Everything else on this face catches you; this one does not until the hay."),
  node("A_ALLEY_LIP", "A_LEADS", [12.9, BAND.LOW_ROOF, -11.6], "PRINTSHOP__ROOF", ["lip"]),

  node("A_SIGN", "A_LEADS", [11.0, 6.2, -1.9], "PRINTSHOP_SIGN", ["catch"]),
  node("A_PENTICE", "A_LEADS", [10.6, 4.4, 0.1], "PRINTSHOP_PENTICE", ["catch"]),
  node("A_HAY_W", "A_LEADS", [11.1, 2.2, 1.4], "HAY_WAIN_W", ["catch", "hay"]),
  node("A_HAY", "A_LEADS", [13.3, 2.2, 1.4], "HAY_WAIN_E", ["catch", "hay"]),
  node("A_STREET", "A_LEADS", [15.4, 0.0, 1.2], "GROUND", []),

  node("A_PLANK", "A_LEADS", [15.0, BAND.PENTICE, -11.6], "ALLEY_HOIST_PLANK", ["alley"]),
  node("A_LEANTO", "A_LEADS", [15.2, BAND.SHED, -8.6], "ALLEY_LEANTO", ["alley"]),
  node("A_ALLEY_CRATES", "A_LEADS", [15.1, BAND.STACK, -5.4], "ALLEY_CRATES", ["alley"]),
  node("A_ALLEY_FLOOR", "A_LEADS", [15.1, 0.0, -3.8], "GROUND", ["alley"]),

  // -- B: the shambles ------------------------------------------------------
  // The street line threads a 1.6m lane between the parked carts and the stall
  // fronts. That squeeze is the whole reason the market reads as crowded.
  node("B_STREET_W", "B_SHAMBLES", [17.8, 0.0, -0.4], "GROUND", ["street-line"]),
  node("B_CART_FOOT", "B_SHAMBLES", [20.8, 0.0, -0.6], "GROUND", ["street-line"]),
  node("B_CART_0", "B_SHAMBLES", [20.8, BAND.CART, -2.0], "CART_0", ["street-line"]),
  node("B_VAULT_IN", "B_SHAMBLES", [20.95, 0.0, -0.6], "GROUND", ["street-line"]),
  node("B_VAULT_OUT", "B_SHAMBLES", [23.4, 0.0, -0.6], "GROUND", ["street-line"]),
  node("B_DUCK", "B_SHAMBLES", [25.9, 0.0, -0.4], "GROUND", ["street-line", "crouch"],
    "Under the hoist frame. A standing capsule does not fit; a crouched one does."),
  node("B_STREET_MID", "B_SHAMBLES", [28.4, 0.0, -0.4], "GROUND", ["street-line", "blend"],
    "2.5m of slide under the hoist frame, just inside the 2.6m span the verb accepts."),
  node("B_STREET_E", "B_SHAMBLES", [39.4, 0.0, -0.4], "GROUND", ["street-line"]),
  node("B_EXIT", "B_SHAMBLES", [41.6, 0.0, -0.4], "GROUND", []),

  node("B_CRATES_FOOT", "B_SHAMBLES", [29.4, 0.0, -0.8], "GROUND", ["crossover"]),
  node("B_CRATES_B", "B_SHAMBLES", [39.2, BAND.STACK, -2.0], "SHAMBLES_CRATES_B", ["crossover"]),
  node("B_CRATES_A", "B_SHAMBLES", [29.4, BAND.STACK, -2.3], "SHAMBLES_CRATES_A", ["crossover"]),
  node("B_CANOPY_FOOT", "B_SHAMBLES", [19.7, 0.0, -0.4], "GROUND", ["crossover"]),

  node("B_PENTICE_FOOT", "B_SHAMBLES", [16.6, 0.0, 1.6], "GROUND", ["high-line"]),
  node("B_PENTICE", "B_SHAMBLES", [16.6, 3.1, 2.4], "SHAMBLES_PENTICE", ["high-line"]),
  node("B_SHED_E", "B_SHAMBLES", [16.6, 5.6, 4.2], "MARKET_SHED__ROOF", ["high-line"]),
  node("B_SHED_W", "B_SHAMBLES", [10.0, 5.6, 6.0], "MARKET_SHED__ROOF", ["high-line"]),
  node("B_SHED_MID", "B_SHAMBLES", [22.6, 5.6, 3.6], "MARKET_SHED__ROOF", ["high-line", "lip"]),

  node("B_CANOPY_0", "B_SHAMBLES", [19.7, BAND.STALL_ROOF, 1.3], "STALL_0__CANOPY", ["mid-line"]),
  node("B_CANOPY_1", "B_SHAMBLES", [23.9, BAND.STALL_ROOF, 1.3], "STALL_1__CANOPY", ["mid-line"]),
  node("B_CANOPY_2", "B_SHAMBLES", [28.1, BAND.STALL_ROOF, 1.3], "STALL_2__CANOPY", ["mid-line"]),
  // The SAFE street line's way up onto the canopies: a guided CLIMB from the crate
  // foot onto the SOUTH EDGE of stall 2's imported awning, whose deck overhangs to
  // z=-0.2. It lands here, on the canopy the body is standing on, then runs the
  // half-metre north to the canopy centre — a genuinely upward waypoint the reader
  // offers and auto-commits, replacing the crate->canopy JUMP that was only
  // executable through an unprompted Space window off a dead-standstill mantle.
  node("B_CANOPY_2_S", "B_SHAMBLES", [28.8, BAND.STALL_ROOF, 0.25], "STALL_2__CANOPY",
    ["mid-line", "crossover"],
    "South-edge climb landing on stall 2's awning, off the crate foot."),
  node("B_CANOPY_3", "B_SHAMBLES", [32.3, BAND.STALL_ROOF, 1.3], "STALL_3__CANOPY", ["mid-line"]),
  node("B_CANOPY_4", "B_SHAMBLES", [36.5, BAND.STALL_ROOF, 1.3], "STALL_4__CANOPY", ["mid-line"]),

  // -- C: the Town House ----------------------------------------------------
  node("C_SQUARE_W", "C_ASCENT", [42.6, 0.0, -1.0], "GROUND", []),
  node("C_SQUARE_NW", "C_ASCENT", [43.0, 0.0, -8.6], "GROUND", [],
    "Round the Town House's north-west corner. The island forces the choice: this lane, the south lane, or over the top."),
  node("C_SCAFF_FOOT", "C_ASCENT", [44.8, 0.0, -6.4], "GROUND", ["safe-line"]),
  node("C_SCAFF_1", "C_ASCENT", [44.8, BAND.SCAFFOLD_1, -6.4], "SCAFFOLD_D1", ["safe-line"]),
  node("C_SCAFF_2", "C_ASCENT", [44.8, BAND.GALLERY, -6.4], "SCAFFOLD_D2", ["safe-line"]),

  // -- C: the south lane, round the back of the island ----------------------
  node("C_LANE_S_W", "C_ASCENT", [46.9, 0.0, 8.6], "GROUND", ["south-lane"],
    "Into the lane at the Town House's south-west corner, out of the square's light and out of the tower's reach: the building's own mass is between you and him for the whole length of it."),
  node("C_LANE_VAULT_IN", "C_ASCENT", [47.9, 0.0, 8.55], "GROUND", ["south-lane"]),
  node("C_LANE_VAULT_OUT", "C_ASCENT", [50.4, 0.0, 8.55], "GROUND", ["south-lane"]),
  node("C_LANE_GATE_IN", "C_ASCENT", [50.9, 0.0, 8.6], "GROUND", ["south-lane"]),
  node("C_LANE_GATE_OUT", "C_ASCENT", [52.4, 0.0, 8.6], "GROUND", ["south-lane"]),
  node("C_KING_CRATES_FOOT", "C_ASCENT", [53.7, 0.0, 8.6], "GROUND", ["south-lane"]),
  node("C_LANE_S_E", "C_ASCENT", [56.4, 0.0, 8.6], "GROUND", ["south-lane"]),
  node("C_KING_HEAD", "C_ASCENT", [59.6, 0.0, 4.2], "GROUND", ["south-lane"],
    "The head of King Street, off the building's south-east corner. The constable's beat turns five metres from here, which is why the pentice landing above is loud and this is not."),
  node("C_KING_MID", "C_ASCENT", [60.2, 0.0, -1.0], "GROUND", ["south-lane"]),
  node("C_LANE_N_E", "C_ASCENT", [59.0, 0.0, -7.0], "GROUND", ["south-lane"],
    "Round into the north lane at its east end. From here it is ten metres west along the unlit side of the road to the foot of the scaffold, and the whole circuit has cost the open square."),

  // KING_ rather than LANE_, because C_LANE_CRATES and C_LANE_PENTICE are the
  // NORTH lane's and a duplicate id does not collide loudly — the node map is
  // built by id and the second definition simply wins, which silently moved this
  // climb thirty metres and failed it against geometry it was never near.
  node("C_KING_CRATES", "C_ASCENT", [53.7, BAND.STACK, 9.9], "KING_LANE_CRATES", ["fast-line"]),
  node("C_KING_PENTICE_W", "C_ASCENT", [54.0, BAND.SHED, 8.7], "KING_LANE_PENTICE", ["fast-line"]),
  node("C_KING_PENTICE_E", "C_ASCENT", [57.6, BAND.SHED, 7.3], "KING_LANE_PENTICE", ["fast-line", "lip"]),

  node("C_LANE_FOOT", "C_ASCENT", [49.5, 0.0, -7.4], "GROUND", ["fast-line"]),
  node("C_LANE_HAY", "C_ASCENT", [49.5, 2.2, -9.3], "LANE_HAY", ["fast-line", "catch"]),
  node("C_LANE_CRATES", "C_ASCENT", [52.6, BAND.STACK, -9.7], "LANE_CRATES", ["fast-line"]),
  node("C_LANE_PENTICE", "C_ASCENT", [53.0, 4.6, -9.6], "LANE_PENTICE", ["fast-line"]),
  // The Town House ledges narrowed to the width of the walk on them, so every node
  // below moved to its deck's new centreline. They were on the old one — a deck cut
  // back about its outer edge would have left the whole balcony line standing over
  // the new lip, which is the failure the probe reports as "over the lip" and the
  // player reports as falling off a balcony that looked solid.
  node("C_GALLERY_STAIRHEAD", "C_ASCENT", [53.8, BAND.GALLERY, -6.75], "GALLERY_N", ["fast-line"],
    "The gap in the balustrade where the balcony stair lands, and the bail-out when the tower calls out."),

  node("C_GALLERY_W", "C_ASCENT", [48.6, BAND.GALLERY, -6.45], "GALLERY_N", ["exposed"]),
  node("C_GALLERY_MASONS", "C_ASCENT", [47.9, BAND.GALLERY, -6.45], "GALLERY_N", ["reflex-cover", "cover"],
    "Behind the masons' stock at the west end. The only reflex answer that is not a complete break: he still has you at three tenths of a read, and you did not have to leave the balcony to get it."),
  node("C_GALLERY_HOOD", "C_ASCENT", [51.4, BAND.GALLERY, -6.45], "GALLERY_N", ["reflex-cover"],
    "Under the pediment: the only spot on the balcony the tower watch cannot see into."),
  node("C_GALLERY_E", "C_ASCENT", [56.6, BAND.GALLERY, -6.45], "GALLERY_N", ["exposed"]),
  node("C_GALLERY_CORNER", "C_ASCENT", [58.3, BAND.GALLERY, -6.7], "GALLERY_E", []),
  // The north-lip takeoff, not the deep mid-gallery. The clock ledge overhangs
  // the east gallery from its north edge at z=-4.5 south, so the body climbs onto
  // it here; sitting the node at z=0 marked a spot 4m south that a normal ascent —
  // up the lip, onto the ledge, on to the cornice — never stands on, and the
  // height-aware mark then held an unreachable hold once the player was above.
  //
  // z=-4.0 rather than the lip's own -4.5: at -4.5 the node clears the building's
  // east bulk and stands in the Old Brick tower watch's sweep (0.97 visibility),
  // which would put the guaranteed climb in the open and break the reflex beat's
  // one hidden escape. -4.0 is the northernmost spot still screened by the
  // building (0.0), half a metre under the ledge's north edge, which the body
  // reaches from the lip all the same.
  node("C_GALLERY_EMID", "C_ASCENT", [58.3, BAND.GALLERY, -4.0], "GALLERY_E", []),
  node("C_CLOCK", "C_ASCENT", [58.3, BAND.CLOCK_LEDGE, 0.0], "CLOCK_LEDGE", []),
  node("C_CORNICE_E", "C_ASCENT", [58.3, BAND.CORNICE, 0.0], "CORNICE_E", []),
  node("C_CORNICE_SE", "C_ASCENT", [58.3, BAND.CORNICE, 6.3], "CORNICE_E", []),
  node("C_CORNICE_S", "C_ASCENT", [52.0, BAND.CORNICE, 6.25], "CORNICE_S", []),
  node("C_LEADS_S", "C_ASCENT", [52.0, BAND.LEADS, 4.6], "TOWNHOUSE__ROOF", []),
  node("C_LEADS_TOWERFOOT", "C_ASCENT", [52.0, BAND.LEADS, 2.9], "TOWNHOUSE__ROOF", []),
  node("C_TOWER_PLINTH", "C_ASCENT", [52.0, BAND.TOWER_PLINTH, 2.75], "TOWER_PLINTH", []),
  node("C_TOWER_GALLERY", "C_ASCENT", [52.0, BAND.TOWER_GALLERY, 1.6], "TOWER_GALLERY", ["vista"],
    "17.6m up. The effigy is in clear sight from here and every metre after this is downhill toward it."),
  node("C_LEADS_SE", "C_ASCENT", [58.0, BAND.LEADS, 5.6], "TOWNHOUSE__ROOF", []),
  node("C_LEADS_E", "C_ASCENT", [57.6, BAND.LEADS, 4.2], "TOWNHOUSE__ROOF", []),
  node("C_LEADS_NE", "C_ASCENT", [58.0, BAND.LEADS, 6.2], "TOWNHOUSE__ROOF", ["lip"]),

  // -- D: the roofline ------------------------------------------------------
  node("D_GANTRY", "D_ROOFLINE", [59.9, BAND.LEADS, 4.2], "LEADS_GANTRY", ["safe-line"]),
  node("D_SROOF_W", "D_ROOFLINE", [62.4, BAND.LEADS, 4.2], "SOUTH_ROW_A__ROOF", []),
  node("D_SROOF_N", "D_ROOFLINE", [62.0, BAND.LEADS, 6.15], "SOUTH_ROW_A__ROOF", []),
  node("D_VAULT_IN_0", "D_ROOFLINE", [63.9, BAND.LEADS, 6.15], "SOUTH_ROW_A__ROOF", []),
  node("D_VAULT_OUT_0", "D_ROOFLINE", [66.3, BAND.LEADS, 6.15], "SOUTH_ROW_A__ROOF", []),
  node("D_VAULT_IN_1", "D_ROOFLINE", [67.1, BAND.LEADS, 6.15], "SOUTH_ROW_A__ROOF", []),
  node("D_VAULT_OUT_1", "D_ROOFLINE", [69.5, BAND.LEADS, 6.15], "SOUTH_ROW_A__ROOF", []),
  node("D_SROOF_E", "D_ROOFLINE", [71.0, BAND.LEADS, 9.0], "SOUTH_ROW_A__ROOF", ["lip"]),
  node("D_SROOF_DIVE", "D_ROOFLINE", [66.0, BAND.LEADS, 3.0], "SOUTH_ROW_A__ROOF", ["lip"],
    "The take-off for the street crossing: 5.0m of gap and 5.3m of fall."),

  node("D_NROOF_W", "D_ROOFLINE", [66.0, BAND.LOW_ROOF, -4.5], "ROW_N_A__ROOF", ["stealth-line"]),
  node("D_NROOF_E", "D_ROOFLINE", [72.6, BAND.LOW_ROOF, -8.0], "ROW_N_A__ROOF", ["stealth-line"]),
  node("D_MEETING_ROOF", "D_ROOFLINE", [76.5, BAND.MEETING_EAVE, 9.0], "HOLLIS_MEETING__ROOF", []),

  // -- E: the leap ----------------------------------------------------------
  node("E_ELLIOT_ROOF", "E_LEAP", [77.0, BAND.MEETING_EAVE, -9.0], "ELLIOT_HOUSE__ROOF", ["stealth-line"]),
  node("E_ELLIOT_LIP", "E_LEAP", [79.0, BAND.MEETING_EAVE, -6.9], "ELLIOT_HOUSE__ROOF", ["lip"]),
  node("E_RIDGE", "E_LEAP", [79.5, BAND.MEETING_RIDGE, 8.6], "MEETING_RIDGE", []),
  node("E_LOUVRE", "E_LEAP", [80.0, BAND.LOUVRE_SILL, 8.9], "LOUVRE_SILL", []),
  node("E_GALLERY", "E_LEAP", [80.0, BAND.STEEPLE_GALLERY, 9.6], "STEEPLE_GALLERY", ["leap-point"]),
  // The south-west corner of the lantern cornice. The ring is 0.8m of walkway now
  // rather than a 5.4m platform, so the position is the corner pad and not a
  // choice: a body needs both of its axes clear of the lantern to stand anywhere
  // on a ring this narrow.
  node("E_CROCKETS", "E_LEAP", [81.0, BAND.STEEPLE_CROCKETS, 10.6], "STEEPLE_CROCKETS", ["expert"]),
  // Moved inboard with the balcony. Narrowing STEEPLE_VANE to 2.6m put its north
  // lip at z=10.3, which is where this node used to stand — a take-off exactly on
  // the edge, which is the one place a body cannot be. 10.7 is the centreline of
  // the 0.8m walkway, 0.4m clear of both the lip and the spire, and 81.1 is the
  // same for the west walkway. It also mirrors E_CROCKETS below it, so the expert
  // climb between the two stays the short vertical reach an authored CLIMB has to be.
  node("E_VANE", "E_LEAP", [81.1, BAND.STEEPLE_VANE, 10.7], "STEEPLE_VANE", ["leap-point", "expert"]),

  // -- F: the tree ----------------------------------------------------------
  node("F_LOW", "F_TREE", [79.0, BAND.BOUGH_LOW, 2.6], "BOUGH_LOW", ["bough"]),
  node("F_CROWN", "F_TREE", [79.6, BAND.BOUGH_CROWN, 1.9], "BOUGH_CROWN", ["bough"],
    "Where LEAP_CROWN rests the diver. The dive is captured by an explicit target, so the node has to be the target."),
  node("F_CROWN_E", "F_TREE", [82.6, BAND.BOUGH_CROWN, 2.6], "BOUGH_CROWN", ["bough"],
    "Out along the limb, clear of the trunk. You walk around the bole on every tier; it is solid to twelve metres."),
  node("F_UPPER", "F_TREE", [82.0, BAND.BOUGH_UPPER, 2.6], "BOUGH_UPPER", ["bough", "expert"]),
  node("F_POST", "F_TREE", [79.6, BAND.BOUGH_CROWN, 0.4], "BOUGH_CROWN", ["post"],
    "Feet on the crown limb, the effigy swinging a tier below, the crowd under that."),
  node("F_POST_STEP", "F_TREE", [79.6, BAND.BOUGH_LOW, 3.8], "BOUGH_LOW", ["bough"],
    "The lip off the crown onto the low bough. F_LOW itself sits back under the crown's overhang — the spot the ascent climb-volume serves — so there is no edge there to leave from; you come down at the crown's northern rim and walk in. This is that rim, on the exposed low bough a body-length past where the crown ends."),
  // The two descent landings sit at the WEST edges the body actually drops off,
  // not under the overhang above them. The low bough (x from 77.4) overhangs the
  // stall awning, so the only rim a body can leave the boughs from is the bough's
  // west edge — a hang-drop there comes down on the awning a stride west at
  // (77.0, 3.2). Placed under the bough at x=78.2 the receiver sat behind a solid
  // deck the body cannot fall through, so the mark led it to an interior spot a
  // stride short of the rim and it braked at a fatal 6.4m walk-off it could never
  // take. The awning in turn overhangs the ground, so its own west edge (x=76.6)
  // is where the second hang-drop leaves from, coming down on open ground clear of
  // the awning at (76.2, 0). Both landings are on the same imported decks; only the
  // waypoints moved to where the descent is physically takeable.
  node("F_AWNING", "F_TREE", [77.0, 3.2, 2.8], "TREE_AWNING", ["catch"]),
  node("F_GROUND", "F_TREE", [76.2, 0.0, 3.6], "GROUND", []),

  // The crossing under the elm. Twelve bodies, torchlight at 0.85 — the brightest
  // ground in the mission — and the man you have been racing arriving on his own
  // patrol. The crowd is the only concealment left, and it is bought at walking
  // pace, so the last ten seconds are the first section's lesson asked again with
  // the objective already behind you.
  node("F_STALL_BACK", "F_TREE", [79.0, 0.0, 3.4], "GROUND", ["sight-break", "blend-entry"],
    "Behind the bookseller's stall at the foot of the tree. Break contact here and the blend takes before you are in the open; walk straight out from the boughs and the nearest torch has already shown you to everybody."),
  node("F_CROWD_S", "F_TREE", [81.6, 0.0, 5.2], "GROUND", ["blend"]),
  node("F_VAULT_IN", "F_TREE", [83.0, 0.0, 5.0], "GROUND", ["blend"]),
  node("F_VAULT_OUT", "F_TREE", [85.4, 0.0, 4.6], "GROUND", ["blend"]),
  // Lined up with the gate rather than merely near it: the opening is a 3.0m gap
  // in a 3.6m wall, so a body needs its centre inside 1.15m of the centre line for
  // the whole 0.6m thickness, and arriving on a diagonal puts a shoulder into the
  // south jamb. It is also still inside the crowd's six-metre radius, which the
  // last node before the gate has to be or the blend drops before the gate does.
  node("F_CROWD_E", "F_TREE", [85.8, 0.0, 1.6], "GROUND", ["blend"],
    "The east edge of the crowd, squared up on the gate. Past here there are no more bodies and the gate is the only thing left."),

  // -- G: the yard ----------------------------------------------------------
  node("G_HAY", "G_YARD", [90.4, 2.2, -3.2], "COVER_HAY_NW", ["arena", "catch"]),
  node("G_GATE", "G_YARD", [88.5, 0.0, 0.0], "GROUND", ["gate"]),
  node("G_SPAWN", "G_YARD", [90.5, 0.0, 0.0], "GROUND", ["arena"]),
];

export const LINKS: RouteLink[] = [
  // -- A --------------------------------------------------------------------
  link("A_START", "A_SHEETS", "RUN", "SAFE", "RUN"),
  link("A_SHEETS", "A_EAVE_S", "RUN", "SAFE", "RUN"),
  link("A_SHEETS", "A_ALLEY_LIP", "RUN", "SAFE", "RUN"),

  link("A_SHEETS", "A_EAVE_SE", "RUN", "FAST", "RUN"),
  link("A_EAVE_S", "A_SIGN", "DROP", "SAFE", "CHAIN_DROP", {
    speedMps: 2.3,
    note: "0.90m onto the printer's sign board. Every rung of this chain is inside the 2.2m run-off ceiling, so the descent is four strides rather than four hangs.",
  }),
  link("A_SIGN", "A_PENTICE", "DROP", "SAFE", "CHAIN_DROP", { speedMps: 2.3 }),
  link("A_PENTICE", "A_HAY_W", "DROP", "SAFE", "CHAIN_DROP", { speedMps: 2.3 }),
  link("A_HAY_W", "A_HAY", "RUN", "SAFE", "RUN"),
  link("A_EAVE_SE", "A_HAY", "DROP", "FAST", "CHAIN_DROP", {
    speedMps: 4.6,
    note: "Sprint off the corner instead and you clear the sign and the pentice entirely: 4.9m straight into the hay wain. It is also a roll landing, which the market watch can hear from thirty paces — the whole game's grammar in one action, eight seconds in.",
  }),
  link("A_HAY", "A_STREET", "DROP", "SAFE", "CHAIN_DROP", { speedMps: 3.0 }),

  // The second dash spend, and the biggest single shortcut in the mission: hold
  // the south eave flat, burst, and cross Queen Street at roof height onto the
  // market shed. 5.00m of gap against the 4.40m a running jump may be authored
  // for at this 1.50m drop, so it genuinely needs the burst.
  //
  // What it skips is the entire opening descent — sign, pentice, hay, street, and
  // the whole length of the Shambles at ground level — and what it costs if you
  // miss is nothing you were not already going to do: short off this lip is the
  // printer's sign board at 6.20m, then the pentice, then the hay. The authored
  // miss is the authored route.
  link("A_EAVE_S", "B_SHED_W", "DASH_JUMP", "EXPERT", "DASH", {
    note: "Straight over Queen Street from the printshop leads onto the market shed roof. It puts a player who can do it on the high line before the market watch has walked ten metres, and the chain drop they skipped is what catches them if they cannot.",
  }),

  link("A_ALLEY_LIP", "A_PLANK", "DROP", "SAFE", "CHAIN_DROP", { speedMps: 2.3 }),
  link("A_PLANK", "A_LEANTO", "DROP", "SAFE", "CHAIN_DROP", { speedMps: 2.6 }),
  link("A_LEANTO", "A_ALLEY_CRATES", "DROP", "SAFE", "CHAIN_DROP", { speedMps: 2.3 }),
  link("A_ALLEY_CRATES", "A_ALLEY_FLOOR", "DROP", "SAFE", "CHAIN_DROP", { speedMps: 2.3 }),

  link("A_STREET", "B_STREET_W", "RUN", "SAFE", "RUN"),
  link("A_ALLEY_FLOOR", "B_STREET_W", "RUN", "SAFE", "RUN"),
  link("A_STREET", "B_PENTICE_FOOT", "RUN", "SAFE", "RUN"),

  // -- B: street line -------------------------------------------------------
  link("B_STREET_W", "B_VAULT_IN", "RUN", "SAFE", "RUN"),
  link("B_VAULT_IN", "B_VAULT_OUT", "VAULT", "SAFE", "VAULT", {
    ignore: ["GAOL_BARRELS"],
    note: "Barrels rolled out of the gaol door: 1.10m high, 1.10m deep, inside the vault envelope on every face.",
  }),
  link("B_VAULT_OUT", "B_DUCK", "RUN", "SAFE", "RUN"),
  link("B_DUCK", "B_STREET_MID", "DUCK_UNDER", "SAFE", "DUCK_UNDER", {
    ignore: ["PASSAGE_HOIST"],
  }),
  link("B_STREET_MID", "B_STREET_E", "BLEND", "FAST", "BLEND", {
    speedMps: 2.3,
    note: "Straight down the Shambles instead of turning into Dock Square. Shorter, thinner crowd, and it puts you past the watch rather than through him.",
  }),
  link("B_STREET_E", "B_EXIT", "RUN", "SAFE", "RUN"),

  link("B_STREET_W", "B_CART_FOOT", "RUN", "FAST", "RUN"),
  link("B_CART_FOOT", "B_CART_0", "CLIMB", "FAST", "CLIMB", { ignore: ["CART_0"] }),
  link("B_CART_0", "B_VAULT_OUT", "DROP", "FAST", "CHAIN_DROP", { speedMps: 3.4 }),

  // -- B: mid line ----------------------------------------------------------
  link("B_STREET_W", "B_CANOPY_FOOT", "RUN", "FAST", "RUN"),
  link("B_CANOPY_FOOT", "B_CANOPY_0", "CLIMB", "FAST", "CLIMB", { ignore: ["STALL_0"] }),
  link("B_CANOPY_0", "B_CANOPY_1", "JUMP", "FAST", "LEAP"),
  link("B_CANOPY_1", "B_CANOPY_2", "JUMP", "FAST", "LEAP"),
  link("B_CANOPY_2", "B_CANOPY_3", "JUMP", "SAFE", "LEAP"),
  link("B_CANOPY_3", "B_CANOPY_4", "JUMP", "SAFE", "LEAP"),
  link("B_CANOPY_4", "B_CRATES_B", "DROP", "SAFE", "CHAIN_DROP", { speedMps: 4.0 }),
  link("B_CRATES_B", "B_STREET_E", "DROP", "SAFE", "CHAIN_DROP", { speedMps: 3.0 }),
  link("B_STREET_MID", "B_CRATES_FOOT", "RUN", "SAFE", "RUN"),
  // The SAFE way up is the guided climb onto stall 2's south-edge awning, not the
  // crates. The crate top is 0.65m BELOW the canopy and the reader, standing on
  // it, sees the street below its far lip and offers only a RUN_OFF — the
  // crate->canopy jump was executable only through an unprompted ~117-317ms Space
  // window off a dead-standstill mantle, which is not a truthful SAFE affordance.
  // Climbing the awning's overhanging south edge is a genuinely upward waypoint
  // the reader offers and auto-commits.
  link("B_CRATES_FOOT", "B_CANOPY_2_S", "CLIMB", "SAFE", "CLIMB"),
  link("B_CANOPY_2_S", "B_CANOPY_2", "RUN", "SAFE", "RUN"),
  // The crates are kept as visible optional scenery and a dev-inspection node,
  // OFF the SAFE progression. The climb-and-leap over them is a real but brutal
  // trick — the unprompted Space window above — so it is authored EXPERT, not
  // SAFE and not a FAST relabel of the SAFE line.
  link("B_CRATES_FOOT", "B_CRATES_A", "CLIMB", "EXPERT", "CLIMB", {
    ignore: ["SHAMBLES_CRATES_A"],
    note: "Optional crate climb. The awning south edge is the SAFE way up; this is the harder line onto the crate top.",
  }),
  link("B_CRATES_A", "B_CANOPY_2", "JUMP", "EXPERT", "LEAP"),

  // -- B: high line ---------------------------------------------------------
  link("B_PENTICE_FOOT", "B_PENTICE", "CLIMB", "SAFE", "CLIMB"),
  link("B_PENTICE", "B_SHED_E", "CLIMB", "SAFE", "CLIMB", { ignore: ["MARKET_SHED"] }),
  link("B_SHED_E", "B_SHED_MID", "RUN", "FAST", "RUN"),
  link("B_SHED_MID", "B_CANOPY_1", "DROP", "FAST", "CHAIN_DROP", {
    speedMps: 2.6,
    note: "The third height. Off the shambles roof onto the canopies, which is the only way the roof line rejoins anything.",
  }),
  link("B_SHED_E", "B_SHED_W", "RUN", "FAST", "RUN"),
  link("B_SHED_W", "B_SHED_E", "RUN", "FAST", "RUN", {
    note: "The shed roof is walked both ways, because it is now arrived at from the west as well as the east: the burst across Queen Street lands here.",
  }),
  link("B_SHED_E", "B_CANOPY_1", "DROP", "FAST", "CHAIN_DROP", {
    speedMps: 4.0,
    note: "The shambles roof dies against the sugar house, so it has to come down onto the canopies here.",
  }),

  // -- C --------------------------------------------------------------------
  // The Shambles does not connect to the Town House square directly. Dock
  // Square is between them, so the fast line through the market is a faster way
  // to the square rather than a way to skip it.
  link("B_EXIT", "B_GAP_N", "RUN", "SAFE", "RUN", {
    note: "Back west to the stall gap. Even the fast line through the Shambles has to thread the same slot into the square.",
  }),
  // Straight across the open square, and now a FAST line rather than the
  // guaranteed one. Twenty-two metres of lit granite with nothing on it, in front
  // of a posted watch who reads the scaffold foot for a quarter of his cycle: it
  // is the shortest way to the ascent and it is the most exposed thing in the
  // section. The cautious answer is the lane behind the building.
  link("C_SQUARE_W", "C_SQUARE_NW", "RUN", "FAST", "RUN", {
    note: "The direct crossing. Eight seconds quicker than the circuit and it spends the whole of them in the tower's sweep.",
  }),
  link("C_SQUARE_NW", "C_SCAFF_FOOT", "RUN", "SAFE", "RUN"),

  // -- C: the south lane ----------------------------------------------------
  link("B2_EXIT", "C_LANE_S_W", "RUN", "SAFE", "RUN", {
    note: "Out of Dock Square straight into the lane, which is the same corner: the market's north-east exit and the Town House's south-west one are four metres apart.",
  }),
  link("C_LANE_S_W", "C_LANE_VAULT_IN", "RUN", "SAFE", "RUN"),
  link("C_LANE_VAULT_IN", "C_LANE_VAULT_OUT", "VAULT", "SAFE", "VAULT", {
    ignore: ["KING_LANE_BARRELS"],
  }),
  link("C_LANE_VAULT_OUT", "C_LANE_GATE_IN", "RUN", "SAFE", "RUN"),
  link("C_LANE_GATE_IN", "C_LANE_GATE_OUT", "CLIMB", "SAFE", "CLIMB_OVER", {
    ignore: ["KING_LANE_GATE"],
    note: "Over the yard gate. The second climb-over in the mission and the first one on the guaranteed path, so the ropewalk's tar partition is not the player's introduction to the verb.",
  }),
  link("C_LANE_GATE_OUT", "C_KING_CRATES_FOOT", "RUN", "SAFE", "RUN"),
  link("C_KING_CRATES_FOOT", "C_LANE_S_E", "RUN", "SAFE", "RUN"),
  link("C_LANE_S_E", "C_KING_HEAD", "RUN", "SAFE", "RUN"),
  link("C_KING_HEAD", "C_KING_MID", "RUN", "SAFE", "RUN", {
    note: "Across the head of King Street, which is the one place on the circuit the constable's own beat can reach.",
  }),
  link("C_KING_MID", "C_LANE_N_E", "RUN", "SAFE", "RUN"),
  link("C_LANE_N_E", "C_LANE_FOOT", "RUN", "SAFE", "RUN", {
    note: "West down the north lane at 0.15 of full light, past the hay and the crates the fast line climbs, to the foot of the scaffold.",
  }),
  link("C_LANE_FOOT", "C_SCAFF_FOOT", "RUN", "SAFE", "RUN"),

  // The lane's own fast line: over the lean-to instead of through the gate.
  link("C_KING_CRATES_FOOT", "C_KING_CRATES", "CLIMB", "FAST", "CLIMB", {
    ignore: ["KING_LANE_CRATES"],
  }),
  link("C_KING_CRATES", "C_KING_PENTICE_W", "CLIMB", "FAST", "CLIMB", {
    ignore: ["KING_LANE_CRATES"],
  }),
  link("C_KING_PENTICE_W", "C_KING_PENTICE_E", "RUN", "FAST", "RUN"),
  link("C_KING_PENTICE_E", "C_KING_HEAD", "DROP", "FAST", "CHAIN_DROP", {
    speedMps: 4.0,
    note: "Off the lean-to into the head of King Street: 3.85m, which is a roll rather than a hang, and the loudest thing available in this section. The constable's beat turns five metres away, so the lane's fast line is paid for in exactly the currency section A taught in its first eight seconds.",
  }),
  link("C_SCAFF_FOOT", "C_SCAFF_1", "CLIMB", "SAFE", "CLIMB"),
  link("C_SCAFF_1", "C_SCAFF_2", "CLIMB", "SAFE", "CLIMB"),
  link("C_SCAFF_2", "C_GALLERY_W", "JUMP", "SAFE", "LEAP"),

  link("C_SQUARE_NW", "C_LANE_FOOT", "RUN", "FAST", "RUN"),
  link("C_LANE_FOOT", "C_LANE_HAY", "CLIMB", "FAST", "CLIMB", { ignore: ["LANE_HAY"] }),
  link("C_LANE_HAY", "C_LANE_CRATES", "DROP", "FAST", "CHAIN_DROP", {
    speedMps: 3.0,
    note: "Off the wain onto the crates: 0.30m down over a 0.60m gap, which lands at any pace from a walk to a sprint.",
  }),
  link("C_LANE_CRATES", "C_LANE_PENTICE", "CLIMB", "FAST", "CLIMB", {
    ignore: ["LANE_CRATES"],
  }),
  link("C_LANE_PENTICE", "C_GALLERY_STAIRHEAD", "JUMP", "FAST", "LEAP"),
  link("C_GALLERY_STAIRHEAD", "C_LANE_PENTICE", "DROP", "SAFE", "CHAIN_DROP", {
    speedMps: 2.3,
    note: "The reflex-time bail-out: back down the stair opening, give up the height, keep the attempt.",
  }),
  link("C_LANE_PENTICE", "C_LANE_HAY", "DROP", "SAFE", "CHAIN_DROP", { speedMps: 2.3 }),

  link("C_GALLERY_W", "C_GALLERY_HOOD", "RUN", "SAFE", "RUN"),
  link("C_GALLERY_W", "C_GALLERY_MASONS", "RUN", "SAFE", "REFLEX", {
    speedMps: 2.3,
    note: "Reflex-time answer three, and the cheapest of the three in distance: two strides back west into the builders' stock. It is also the only one that does not break his line — hard cover is worth 0.3 of a read, not zero — so it is the answer for a player who wants to keep walking east rather than commit to the pediment.",
  }),
  link("C_GALLERY_MASONS", "C_GALLERY_HOOD", "RUN", "SAFE", "RUN"),
  link("C_GALLERY_STAIRHEAD", "C_GALLERY_HOOD", "RUN", "SAFE", "RUN"),
  link("C_GALLERY_HOOD", "C_GALLERY_E", "RUN", "SAFE", "RUN"),
  link("C_GALLERY_E", "C_GALLERY_HOOD", "RUN", "SAFE", "REFLEX", {
    note: "Reflex-time answer one: two strides back under the pediment and the sight line is gone.",
  }),
  link("C_GALLERY_E", "C_GALLERY_CORNER", "RUN", "SAFE", "RUN"),
  link("C_GALLERY_CORNER", "C_GALLERY_EMID", "RUN", "SAFE", "REFLEX", {
    note: "Reflex-time answer two: keep going round onto the east face. The corner itself is still inside his sweep; it is the building's own mass, once you are south of it, that breaks the sight line.",
  }),
  link("C_GALLERY_EMID", "C_CLOCK", "CLIMB", "SAFE", "CLIMB", { ignore: ["TOWNHOUSE"] }),
  link("C_CLOCK", "C_CORNICE_E", "CLIMB", "SAFE", "CLIMB", { ignore: ["TOWNHOUSE"] }),
  link("C_CORNICE_E", "C_CORNICE_SE", "RUN", "SAFE", "RUN"),
  link("C_CORNICE_SE", "C_CORNICE_S", "RUN", "SAFE", "RUN"),
  link("C_CORNICE_S", "C_LEADS_S", "CLIMB", "SAFE", "CLIMB", { ignore: ["TOWNHOUSE"] }),
  link("C_LEADS_S", "C_LEADS_TOWERFOOT", "RUN", "SAFE", "RUN"),
  link("C_LEADS_TOWERFOOT", "C_TOWER_PLINTH", "CLIMB", "SAFE", "CLIMB", {
    ignore: ["TOWNHOUSE_TOWER"],
  }),
  link("C_TOWER_PLINTH", "C_TOWER_GALLERY", "CLIMB", "SAFE", "CLIMB", {
    ignore: ["TOWNHOUSE_TOWER"],
  }),
  link("C_TOWER_GALLERY", "C_LEADS_E", "DROP", "SAFE", "CHAIN_DROP", {
    speedMps: 3.4,
    note: "Off the tower: 5.2m onto the broad leads, a roll landing and the loudest thing you have done since the market. The descent starts here and does not stop until the tree.",
  }),
  link("C_TOWER_GALLERY", "C_LEADS_TOWERFOOT", "DROP", "FAST", "CHAIN_DROP", {
    speedMps: 2.3,
  }),
  link("C_LEADS_TOWERFOOT", "C_LEADS_E", "RUN", "FAST", "RUN", {
    note: "Straight across the leads without topping out. Quicker, and you never see where you are going.",
  }),
  // Deliberately not a SAFE link. The tower is the mission's only navigation —
  // it is where the effigy first comes into sight — so the guaranteed route goes
  // over the top and the shortcut across the leads is a FAST choice.
  link("C_LEADS_S", "C_LEADS_E", "RUN", "FAST", "RUN"),
  link("C_LEADS_E", "C_LEADS_NE", "RUN", "SAFE", "RUN"),
  // The cornice walk exits straight to the leads for anyone skipping the tower.
  link("C_CORNICE_SE", "C_LEADS_SE", "CLIMB", "FAST", "CLIMB", { ignore: ["TOWNHOUSE"] }),
  link("C_LEADS_SE", "C_LEADS_E", "RUN", "FAST", "RUN"),

  // -- D --------------------------------------------------------------------
  link("C_LEADS_E", "D_GANTRY", "RUN", "SAFE", "RUN"),
  link("D_GANTRY", "D_SROOF_W", "RUN", "SAFE", "RUN"),
  link("D_SROOF_W", "D_SROOF_N", "RUN", "SAFE", "RUN"),
  link("C_LEADS_NE", "D_SROOF_N", "JUMP", "FAST", "LEAP", {
    note: "2.8m over the lane beside the fire board. Same destination, a second cheaper.",
  }),

  link("D_SROOF_N", "D_VAULT_IN_0", "RUN", "SAFE", "RUN"),
  link("D_VAULT_IN_0", "D_VAULT_OUT_0", "VAULT", "SAFE", "VAULT", { ignore: ["CHIMNEY_0"] }),
  link("D_VAULT_OUT_0", "D_VAULT_IN_1", "RUN", "SAFE", "RUN"),
  link("D_VAULT_IN_1", "D_VAULT_OUT_1", "VAULT", "SAFE", "VAULT", { ignore: ["CHIMNEY_1"] }),
  link("D_VAULT_OUT_1", "D_SROOF_E", "RUN", "SAFE", "RUN"),
  link("D_SROOF_W", "D_SROOF_DIVE", "RUN", "FAST", "RUN"),
  link("D_SROOF_DIVE", "D_NROOF_W", "JUMP", "FAST", "LEAP", {
    note: "Orange Street: 5.0m across and 5.3m down. The only crossing on the block, and it only works downhill.",
  }),
  link("D_NROOF_W", "D_NROOF_E", "RUN", "FAST", "RUN"),
  link("D_NROOF_E", "E_ELLIOT_ROOF", "JUMP", "FAST", "LEAP", {
    note: "1.6m over the lane with 1.10m of rise: right on the hop-up ceiling, and the last move of the quiet line.",
  }),
  link("E_ELLIOT_ROOF", "E_ELLIOT_LIP", "RUN", "FAST", "RUN"),

  // AUTHORED AS A CHAIN DROP UNTIL TODAY, AND IT NEVER WAS ONE.
  //
  // A chain drop is passive: hold forward, leave the lip, land a tier lower.
  // There is no tier here. The south row's roof ends at x=71.6 and the meeting
  // house's begins at 73.3, so what is between the two nodes is 1.8m of open
  // air with a 12.4m fall to Orange Street underneath it. The link priced
  // itself node-to-node at 4.2m and passed every check; the reader, standing at
  // the actual lip, measured the actual fall and braked, which is exactly what
  // a safety brake is for. So the leg was takeable only by deliberately
  // pressing jump — the definition of a JUMP link and not of a drop — and two
  // readings of this route in a row called it a defect.
  //
  // It is a leap, and the ridge is where a leap lands. A full-speed running
  // jump off this lip flies 6.8m before it comes down, which overflies the
  // meeting house's eave and the three metres of roof behind it: aiming this at
  // D_MEETING_ROOF was authoring an arc the body does not fly. Measured from
  // the lip the ridge is 3.7m out against a 4.26m budget for a 1.2m drop.
  //
  // It stays FAST, so the guaranteed line still goes through the ropewalk, and
  // it is now a bigger shortcut than it was — it skips the gambrel climb as
  // well — which is the honest price of the most exposed move in the section.
  link("D_SROOF_E", "E_RIDGE", "JUMP", "FAST", "LEAP", {
    note: "Over the ropewalk rather than through it: across Orange Street onto the meeting-house ridge, with a 12.4m fall to the cobbles under it if it is misjudged. Four seconds cheaper than the ropewalk and fully exposed to the street below, which is where the constable now is.",
  }),

  // -- E --------------------------------------------------------------------
  link("D_MEETING_ROOF", "E_RIDGE", "CLIMB", "SAFE", "CLIMB", { ignore: ["HOLLIS_MEETING"] }),
  link("E_RIDGE", "E_LOUVRE", "CLIMB", "SAFE", "CLIMB", { ignore: ["STEEPLE"] }),
  link("E_LOUVRE", "E_GALLERY", "CLIMB", "SAFE", "CLIMB", { ignore: ["STEEPLE"] }),
  link("E_GALLERY", "E_CROCKETS", "CLIMB", "EXPERT", "CLIMB", { ignore: ["STEEPLE_LANTERN"] }),
  link("E_CROCKETS", "E_VANE", "CLIMB", "EXPERT", "CLIMB", { ignore: ["STEEPLE_LANTERN"] }),

  link("E_GALLERY", "F_CROWN", "LEAP_OF_FAITH", "SAFE", "LEAP_OF_FAITH", {
    target: "LEAP_CROWN",
    speedMps: 4.6,
    note: "The signature: 5.7m of gap and 7.5m of fall, off the steeple gallery into the crown of the Liberty Tree. Leave short and the low bough catches you a tier down.",
  }),
  // The third dash spend. Level with the elm's top limb across 4.00m of air, off
  // the gambrel ridge instead of going up the steeple for it: a running jump
  // reaches 3.65m flat and this is 4.00m, so the burst is the whole difference.
  // It trades the six-hold climb and the signature dive for one committed metre
  // of ground, which is the right shape for the ceiling of a level.
  link("E_RIDGE", "F_UPPER", "DASH_JUMP", "EXPERT", "DASH", {
    note: "From the meeting house ridge straight into the crown of the tree, skipping the louvre, the gallery and the leap of faith. The upper limb is also the only place the yard dive is offered from, so the burst does not shorten the mission — it changes which ending is available.",
  }),
  link("E_VANE", "F_UPPER", "LEAP_OF_FAITH", "EXPERT", "LEAP_OF_FAITH", {
    target: "LEAP_UPPER",
    speedMps: 4.6,
    note: "From the weathervane balcony: 6.7m of gap and 9.4m of fall, onto the upper limb above the nail point. The gap grew 0.4m and the fall 1.2m when the balcony narrowed to 2.6m and rose to 20.6 — both of which the drop pays for, since a longer fall buys airtime.",
  }),
  link("E_ELLIOT_LIP", "F_LOW", "JUMP", "FAST", "LEAP", {
    note: "Off Elliot's gambrel into the lowest tier of boughs: 3.5m across and 1.8m down. It is a jump, not a dive — 1.8m is nowhere near the 6m the reader needs to offer one.",
  }),
  link("E_ELLIOT_LIP", "F_CROWN", "DASH_JUMP", "EXPERT", "DASH", {
    note: "The same lip, held flat and taken out of a burst: 4.71m across and level, straight onto the crown limb where the nail is. It is the only place in the mission a dash is the answer, and it is authored so that failing it costs nothing — a running jump off this lip carries 3.65m, lands a metre short, and the low bough catches you exactly where the FAST line was going to put you anyway. So the burst does not buy access, it buys the climb: you arrive at the nail height already, with the seconds the F_LOW->F_CROWN pull would have cost still in hand. Those seconds are the point, because they are spent standing still on the bough with the constable coming up Orange Street underneath, and the beat is longer than the gap in his patrol is generous.",
  }),

  // -- F --------------------------------------------------------------------
  link("F_LOW", "F_CROWN", "CLIMB", "SAFE", "CLIMB", { ignore: ["LIBERTY_ELM_TRUNK"] }),
  link("F_CROWN", "F_CROWN_E", "RUN", "SAFE", "RUN"),
  link("F_CROWN_E", "F_UPPER", "CLIMB", "EXPERT", "CLIMB", { ignore: ["LIBERTY_ELM_TRUNK"] }),
  link("F_UPPER", "F_CROWN", "DROP", "EXPERT", "CHAIN_DROP", { speedMps: 2.3 }),
  link("F_CROWN", "F_POST", "RUN", "SAFE", "RUN"),
  link("F_POST", "F_CROWN", "RUN", "SAFE", "RUN"),
  // Down off the objective: a controlled climb-down at the crown's northern rim
  // onto the exposed low bough, then a step in under the overhang to the low-bough
  // spot. It is a CLIMB, not a run-off: the crown overhangs the low bough by about
  // a metre on every side, so a body that STROLLS off the rim sails past the
  // exposed bough beneath and falls to the street — the reader lowers the body
  // straight down onto the bough it can see under its feet instead. F_LOW itself
  // is under the overhang (the ascent climb-volume spot), so the rim is where the
  // descent is authored, the way a player actually comes down.
  link("F_POST", "F_POST_STEP", "CLIMB", "SAFE", "CLIMB", { ignore: ["LIBERTY_ELM_TRUNK"] }),
  link("F_POST_STEP", "F_LOW", "RUN", "SAFE", "RUN"),
  link("F_LOW", "F_AWNING", "CLIMB", "SAFE", "CLIMB", {
    note: "Out of the boughs onto the stall awning. Straight to the street would be 6.4m, which is past the roll ceiling, and the reader would brake at the lip with the constable arriving.",
  }),
  link("F_AWNING", "F_GROUND", "CLIMB", "SAFE", "CLIMB"),

  // -- the crossing under the elm -------------------------------------------
  link("F_GROUND", "F_STALL_BACK", "RUN", "SAFE", "RUN", { speedMps: 2.3 }),
  link("F_STALL_BACK", "F_CROWD_S", "BLEND", "SAFE", "BLEND", {
    speedMps: 2.3,
    note: "Out from behind the stall already unseen, and south round the bole because that is the side the crowd is on. The trunk is solid to twelve metres, so going round it is a sight break as well as a route.",
  }),
  link("F_CROWD_S", "F_VAULT_IN", "BLEND", "SAFE", "BLEND", { speedMps: 2.3 }),
  link("F_VAULT_IN", "F_VAULT_OUT", "VAULT", "SAFE", "VAULT", {
    ignore: ["LIBERTY_BARRELS"],
  }),
  link("F_VAULT_OUT", "F_CROWD_E", "BLEND", "SAFE", "BLEND", { speedMps: 2.3 }),
  link("F_CROWD_E", "G_GATE", "RUN", "SAFE", "RUN", {
    speedMps: 2.3,
    note: "The last three metres, and the only ones with nobody in them. The gate is a 3.0m gap in a 3.6m wall and there is no way to be anything in it but visible.",
  }),

  // -- G --------------------------------------------------------------------
  // The same ground at a sprint, which is exactly what the crowd stops working
  // at: above 2.4 m/s the throng parts around you instead of closing over you.
  // Eight metres shorter, across the brightest ground in the mission.
  link("F_GROUND", "G_GATE", "RUN", "FAST", "RUN", {
    note: "Straight across the corner from the foot of the tree, at a sprint and in torchlight. It saves three seconds and spends the last of the mission's concealment doing it.",
  }),
  link("G_GATE", "G_SPAWN", "RUN", "SAFE", "RUN"),
  link("F_UPPER", "G_HAY", "LEAP_OF_FAITH", "EXPERT", "LEAP_OF_FAITH", {
    target: "LEAP_YARD_HAY",
    speedMps: 4.6,
    note: "Straight off the upper limb, over 3.6m of yard wall, into the fodder wain and the duel. Only that limb clears the brick, which is the whole reward for taking the weathervane.",
  }),
  link("G_HAY", "G_SPAWN", "DROP", "EXPERT", "CHAIN_DROP", { speedMps: 3.0 }),
];

/** Nodes the reflex-time set piece is authored around. */
export const REFLEX_BEAT = {
  patrol: "WATCH_OLD_BRICK",
  exposedNodes: ["C_GALLERY_W", "C_GALLERY_E"],
  coverNodes: [
    "C_GALLERY_HOOD",
    "C_GALLERY_CORNER",
    "C_GALLERY_STAIRHEAD",
    // The one graded answer. The other three take his read to zero; this takes
    // it to three tenths and costs two strides instead of the height.
    "C_GALLERY_MASONS",
  ],
} as const;
