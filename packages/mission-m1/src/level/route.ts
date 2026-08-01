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
  node("B_CRATES_B", "B_SHAMBLES", [39.2, 2.15, -2.0], "SHAMBLES_CRATES_B", ["crossover"]),
  node("B_CRATES_A", "B_SHAMBLES", [29.4, BAND.STACK, -2.3], "SHAMBLES_CRATES_A", ["crossover"]),
  node("B_CANOPY_FOOT", "B_SHAMBLES", [19.7, 0.0, -0.4], "GROUND", ["crossover"]),

  // -- the merchant's house: the covert drop-in (G-A) and its exit (G-B) ------
  // The high line reaches the merchant here. Off the Shambles crate the player
  // climbs the goods-ladder in the open window onto the projecting BALCONY — a
  // vertical climb-in directly over the crate onto a solid ledge, no ground touch
  // — steps into the quartered parlour (the SAFE interior, billeted), then climbs
  // out the window onto the leads to cross to the Town House. Option 1, the
  // projecting-balcony drop-in.
  node("M_LEDGE", "B_SHAMBLES", [39.2, 4.0, -2.8], "MERCHANT_BALCONY", ["merchant", "safe-interior", "ledge", "crossover"],
    "The merchant's window balcony, a solid ledge 4.0 m up directly over the Shambles crate — the covert climb-in off the high line."),
  node("M_STRING", "B_SHAMBLES", [39.2, 5.7, -2.0], "MERCHANT_STRING", ["merchant", "ledge", "high-line"],
    "The jettied gallery oversailing the street: the intermediate mantle between the balcony (4.0) and the leads (7.1), out south of the eave for headroom."),
  node("M_PARLOUR", "B_SHAMBLES", [39.0, 4.0, -5.0], "MERCHANT_PARLOUR__DECK", ["merchant", "safe-interior"],
    "The quartered parlour, a SAFE interior off the window balcony. The billeting reads occupation; the way on is back to the window and up onto the leads."),
  node("M_EAVE_S", "B_SHAMBLES", [39.2, 7.1, -2.7], "MERCHANT__ROOF", ["merchant", "eave", "high-line"],
    "The south lip of the merchant's leads, mantled onto off the jettied gallery — the top of the covert climb-in."),
  node("M_EAVE", "B_SHAMBLES", [39.2, 7.1, -3.5], "MERCHANT__ROOF", ["merchant", "eave", "high-line"],
    "The merchant's leads, climbed up the south face off the window balcony — clear of the drawn roof edge at z −3.2."),
  node("M_EAVE_E", "B_SHAMBLES", [42.2, 7.1, -6.0], "MERCHANT__ROOF", ["merchant", "eave", "high-line"],
    "The east lip of the leads, over the Town House scaffold — the take-off for the G-B crossing."),

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
  // A stepping stone on the direct approach from the Shambles to the scaffold,
  // collinear with B_EXIT -> C_SCAFF_FOOT so the guided line crosses the square's
  // north-west corner in two short hops rather than one long diagonal — which
  // keeps the objective-distance plate stepping smoothly instead of inflating
  // over an eight-metre edge and snapping when the anchor catches up.
  node("C_SQUARE_N", "C_ASCENT", [43.2, 0.0, -3.4], "GROUND", [],
    "The open ground north-west of the Town House, on the line to the scaffold."),
  node("C_SQUARE_NW", "C_ASCENT", [43.0, 0.0, -8.6], "GROUND", [],
    "Round the Town House's north-west corner. The island forces the choice: this lane, the south lane, or over the top."),
  // The foot stays at z −6.4. It is a GROUND WAYPOINT ONLY: the ground ascent up
  // the staging is NOT authored, and the note is here so the next reader does not
  // re-derive why.
  //
  // The staging's first lift is boarded at z −3.0..−1.0, and a mantle is refused
  // onto a lift that is over the player's head, so the climb has to be entered
  // from south of z −1.0 — about 5.9 m south of here. Moving this node there was
  // tried and measured: it breaks two ground RUN links (C_SQUARE_NW and
  // C_LANE_FOOT both stop with "body does not fit", the latter cutting the Town
  // House corner at 48.39,−5.78) and it breaks SAFE-distance continuity across the
  // branch crossings. The fallback needs its own bent approach rather than a moved
  // node, which is a separate piece of authoring.
  //
  // Nothing on the golden line depends on it: that line drops onto the 5.60
  // staging off the merchant's leads (M_EAVE_E -> C_SCAFF_2) and climbs from
  // there, and the seven lifts are all drawn and all standable regardless.
  node("C_SCAFF_FOOT", "C_ASCENT", [44.8, 0.0, -6.4], "GROUND", ["safe-line"]),
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
  // The crossing's landing, on the west strip of the meeting-house roof. The
  // south row ends at x=71 (12.4m) and the meeting roof begins at x=73.3 (8.2m),
  // a ~1.6m lip-to-lip gap and a 4.2m drop — taken as a controlled run-off/roll,
  // not a running leap (a full leap carries past this strip onto the 11.2m ridge
  // monitor that covers the roof from x=75.3 east). The strip west of the monitor
  // is 2.0m of clear roof, wide enough to stand and land on; from here the body
  // walks in under the monitor and climbs onto the steeple line. This is also the
  // node the relocated STAMP_SCOPE bill-sticker stop (ROPEWALK_STOP) is anchored
  // beside, on HOLLIS_MEETING__ROOF, now that the beat is on the roofline.
  node("D_MEETING_W", "D_ROOFLINE", [74.3, BAND.MEETING_EAVE, 9.0], "HOLLIS_MEETING__ROOF", ["lip"],
    "Onto the meeting-house roof off the south row, west of the ridge monitor."),

  // -- E: the leap ----------------------------------------------------------
  node("E_ELLIOT_ROOF", "E_LEAP", [77.0, BAND.MEETING_EAVE, -9.0], "ELLIOT_HOUSE__ROOF", ["stealth-line"]),
  node("E_ELLIOT_LIP", "E_LEAP", [79.0, BAND.MEETING_EAVE, -6.9], "ELLIOT_HOUSE__ROOF", ["lip"]),
  node("E_RIDGE", "E_LEAP", [78.5, BAND.MEETING_RIDGE, 8.6], "MEETING_RIDGE", [],
    "The ridge foot of the steeple climb, pulled west off [79.5] so the reach up to the louvre sill threads clear of the elm's northern canopy sprawl (which reaches z8.8 over the belfry) rather than driving the body 0.46m into it. The ridge monitor runs the width of the roof, so the hold moves without leaving it."),
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
  node("F_LOW", "F_TREE", [78.7, BAND.BOUGH_LOW, 0.4], "BOUGH_LOW", ["bough"],
    "Under the crown's south-west overhang. Pulled off the [79.0, 2.6] spot (still under the crown) because that sat the walked path's HEAD up in the drawn canopy raft at z1.9-3.0: the swept climbs off it (to the awning, up to the crown) drove the body 0.67m and 0.33m into the drawn elm. This spot — same tier, same overhang, out from under the raft — takes both to a graze."),
  node("F_CROWN", "F_TREE", [79.6, BAND.BOUGH_CROWN, 1.9], "BOUGH_CROWN", ["bough"],
    "Where LEAP_CROWN rests the diver. The dive is captured by an explicit target, so the node has to be the target."),
  node("F_CROWN_E", "F_TREE", [82.6, BAND.BOUGH_CROWN, 2.6], "BOUGH_CROWN", ["bough"],
    "Out along the limb, clear of the trunk. You walk around the bole on every tier; it is solid to twelve metres."),
  node("F_UPPER", "F_TREE", [82.0, BAND.BOUGH_UPPER, 2.6], "BOUGH_UPPER", ["bough", "expert"]),
  node("F_POST", "F_TREE", [79.6, BAND.BOUGH_CROWN, 0.4], "BOUGH_CROWN", ["post"],
    "Feet on the crown limb, the effigy swinging a tier below, the crowd under that."),
  node("F_POST_STEP", "F_TREE", [77.8, BAND.BOUGH_LOW, 0.4], "BOUGH_LOW", ["bough"],
    "The lip off the crown onto the low bough. F_LOW itself sits back under the crown's overhang — the spot the ascent climb-volume serves — so there is no edge there to leave from; you come down at an exposed rim and walk in. This is the WEST rim, on the exposed low bough a stride past where the crown ends (x<78.6). It was the NORTH rim [79.6, 3.8], but the pinned post (F_POST, the beat stance, cannot move) sits at z0.4, so a climb-down to the north rim swept the body's head north through the drawn canopy raft at z1.9-3.0 (0.81m into the elm). Dropping down the west rim at the post's own z keeps the descent out of that raft, and F_LOW is a short step east of here."),
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
  node("F_AWNING", "F_TREE", [77.0, 3.2, 1.4], "TREE_AWNING", ["catch"]),
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
  node("G_HAY", "G_YARD", [90.65, 2.2, -4.0], "COVER_HAY_NW", ["arena", "catch"],
    "On the corner hay wain, its own centre, where the upper-limb dive (LEAP_YARD_HAY) is caught."),
  node("G_GATE", "G_YARD", [88.5, 0.0, 0.0], "GROUND", ["gate"]),
  node("G_SPAWN", "G_YARD", [90.5, 0.0, 0.0], "GROUND", ["arena"]),
];

export const LINKS: RouteLink[] = [
  // -- A --------------------------------------------------------------------
  link("A_START", "A_SHEETS", "RUN", "SAFE", "RUN"),
  link("A_SHEETS", "A_EAVE_S", "RUN", "SAFE", "RUN"),
  link("A_SHEETS", "A_ALLEY_LIP", "RUN", "SAFE", "RUN"),

  link("A_EAVE_S", "A_SIGN", "DROP", "SAFE", "CHAIN_DROP", {
    speedMps: 2.3,
    note: "0.90m onto the printer's sign board. Every rung of this chain is inside the 2.2m run-off ceiling, so the descent is four strides rather than four hangs.",
  }),
  link("A_SIGN", "A_PENTICE", "DROP", "SAFE", "CHAIN_DROP", { speedMps: 2.3 }),
  link("A_PENTICE", "A_HAY_W", "DROP", "SAFE", "CHAIN_DROP", { speedMps: 2.3 }),
  link("A_HAY_W", "A_HAY", "RUN", "SAFE", "RUN"),
  link("A_HAY", "A_STREET", "DROP", "SAFE", "CHAIN_DROP", { speedMps: 3.0 }),

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
  link("B_STREET_E", "B_EXIT", "RUN", "SAFE", "RUN"),

  // -- B: mid line ----------------------------------------------------------
  link("B_CANOPY_2", "B_CANOPY_3", "JUMP", "SAFE", "LEAP"),
  link("B_CANOPY_3", "B_CANOPY_4", "JUMP", "SAFE", "LEAP"),
  link("B_CANOPY_4", "B_CRATES_B", "DROP", "SAFE", "CHAIN_DROP", { speedMps: 4.0 }),
  link("B_CRATES_B", "B_STREET_E", "DROP", "SAFE", "CHAIN_DROP", { speedMps: 3.0 }),
  link("B_STREET_MID", "B_CRATES_FOOT", "RUN", "SAFE", "RUN"),

  // -- the merchant's house: the covert drop-in (G-A) and its exit (G-B) ------
  // The elevated line's alternative to the old ground drop (B_CRATES_B->B_STREET_E,
  // kept as the fallback): stay off the street, climb into the merchant, and cross
  // his leads to the Town House scaffold.
  link("B_CRATES_B", "M_LEDGE", "CLIMB", "SAFE", "CLIMB", {
    note: "G-A: a single ≤1.9 m mantle off the Shambles goods on-ramp (2.15) onto the window balcony ledge (4.0) into the SAFE interior — no ground touch, no ladder.",
  }),
  link("M_LEDGE", "M_PARLOUR", "RUN", "SAFE", "RUN", {
    speedMps: 2.0,
    note: "Off the balcony through the open window into the quartered parlour, past the billeting — the SAFE room.",
  }),
  link("M_PARLOUR", "M_LEDGE", "RUN", "SAFE", "RUN", {
    speedMps: 2.0,
    note: "Back out of the parlour to the window balcony, the hub of the drop-in.",
  }),
  link("M_LEDGE", "M_STRING", "CLIMB", "SAFE", "CLIMB", {
    note: "Up off the balcony onto the jettied gallery (4.0 → 5.5), out over the street south of the eave.",
  }),
  link("M_STRING", "M_EAVE_S", "CLIMB", "SAFE", "CLIMB", {
    note: "Last mantle off the gallery onto the leads' south lip (5.5 → 7.1) — tops onto the roof, not through it. No ladder.",
  }),
  link("M_EAVE_S", "M_EAVE", "RUN", "SAFE", "RUN", {
    note: "In off the south lip across the merchant's leads to the G-B take-off.",
  }),
  link("M_EAVE", "M_EAVE_E", "RUN", "SAFE", "RUN"),
  link("M_EAVE_E", "C_SCAFF_2", "DROP", "SAFE", "CHAIN_DROP", {
    speedMps: 2.6,
    note: "G-B: off the leads' east lip onto the Town House mason's scaffold — the covert line rejoins the proven spiral.",
  }),
  // The SAFE way up is the guided climb onto stall 2's south-edge awning, not the
  // crates. The crate top is 0.65m BELOW the canopy and the reader, standing on
  // it, sees the street below its far lip and offers only a RUN_OFF — the
  // crate->canopy jump was executable only through an unprompted ~117-317ms Space
  // window off a dead-standstill mantle, which is not a truthful SAFE affordance.
  // Climbing the awning's overhanging south edge is a genuinely upward waypoint
  // the reader offers and auto-commits.
  link("B_CRATES_FOOT", "B_CANOPY_2_S", "CLIMB", "SAFE", "CLIMB"),
  link("B_CANOPY_2_S", "B_CANOPY_2", "RUN", "SAFE", "RUN"),

  // -- B: high line ---------------------------------------------------------
  link("B_PENTICE_FOOT", "B_PENTICE", "CLIMB", "SAFE", "CLIMB"),
  link("B_PENTICE", "B_SHED_E", "CLIMB", "SAFE", "CLIMB", { ignore: ["MARKET_SHED"] }),

  // -- C --------------------------------------------------------------------
  // The guided line goes straight from the Shambles to the foot of the Town
  // House scaffold: the market's east end and the building's north-west corner
  // are the same few metres of open square ground, so a sensible first mission
  // heads for the way up over the building blocking the road rather than walking
  // a lap of Dock Square and the south lane first. The lane loop existed only to
  // manufacture a westward run-up for the scaffold-to-gallery leap; the solver
  // fix (EDGE_BRAKE now defers to the exact ballistic planner) makes that leap
  // commit straight off the short direct approach, so the loop is no longer
  // load-bearing. Dock Square stays authored and reachable off the guided line.
  link("B_EXIT", "C_SQUARE_N", "RUN", "SAFE", "RUN", {
    note: "Out of the Shambles into the Town House square, heading for the scaffold at its north-west corner.",
  }),
  link("C_SQUARE_N", "C_SCAFF_FOOT", "RUN", "SAFE", "RUN", {
    note: "To the foot of the mason's scaffold, the way up over the building blocking the road.",
  }),
  // Kept so a player who deviates south into Dock Square and comes back up its
  // north-west corner still has a way onto the scaffold.
  link("C_SQUARE_NW", "C_SCAFF_FOOT", "RUN", "SAFE", "RUN"),
  // Kept so Dock Square remains reachable off the guided line: the market crowd
  // and its blend beat survive as an optional space, not deleted.
  link("B_EXIT", "B_GAP_N", "RUN", "SAFE", "RUN", {
    note: "West to the stall gap and the slot into Dock Square — off the guided line now, but the crowd crossing is still there for a player who takes it.",
  }),

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
    note: "West down the north lane at 0.15 of full light, past the hay and the crates, to the foot of the scaffold.",
  }),
  link("C_LANE_FOOT", "C_SCAFF_FOOT", "RUN", "SAFE", "RUN"),

  // The two ground climb links are GONE with the ladders that served them. They
  // were 0 -> 2.90 -> 5.60, i.e. rises of 2.9 and 2.7: both over the 1.9 m mantle
  // limit, both inside the 1.9-3.1 m dead zone, and both therefore reliant on a
  // ladder. The staging that replaced them climbs 1.85 / 1.85 / 1.90 on drawn
  // board, but entering it from the ground needs an approach south of z −1.0 that
  // this node cannot provide — see the note on C_SCAFF_FOOT.
  link("C_SCAFF_2", "C_GALLERY_W", "JUMP", "SAFE", "LEAP"),

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
  // Straight on across the leads to the east side and off onto the roofline.
  // Topping out on the broad leads with the elm already in sight is enough; the
  // tower gallery above is 5m of climb and 5m of drop for a look at a place the
  // visor already points at, so the guided line no longer detours up it. The
  // tower stays a reachable set piece from here (the CLIMB links below).
  link("C_LEADS_TOWERFOOT", "C_LEADS_E", "RUN", "SAFE", "RUN", {
    note: "East over the Town House roof to the descent onto the Orange Street roofline. The elm is downhill from here in a straight line.",
  }),
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
  link("C_LEADS_E", "C_LEADS_NE", "RUN", "SAFE", "RUN"),

  // -- D --------------------------------------------------------------------
  link("C_LEADS_E", "D_GANTRY", "RUN", "SAFE", "RUN"),
  link("D_GANTRY", "D_SROOF_W", "RUN", "SAFE", "RUN"),
  link("D_SROOF_W", "D_SROOF_N", "RUN", "SAFE", "RUN"),

  link("D_SROOF_N", "D_VAULT_IN_0", "RUN", "SAFE", "RUN"),
  link("D_VAULT_IN_0", "D_VAULT_OUT_0", "VAULT", "SAFE", "VAULT", { ignore: ["CHIMNEY_0"] }),
  link("D_VAULT_OUT_0", "D_VAULT_IN_1", "RUN", "SAFE", "RUN"),
  link("D_VAULT_IN_1", "D_VAULT_OUT_1", "VAULT", "SAFE", "VAULT", { ignore: ["CHIMNEY_1"] }),
  link("D_VAULT_OUT_1", "D_SROOF_E", "RUN", "SAFE", "RUN"),
  // The direct crossing to the steeple. The south row ends at x=71 and the
  // meeting house begins at x=74 with its roof 4.2m lower, so the roofline
  // continues straight onto it in one controlled drop over a ~1.6m lip-to-lip
  // gap, rather than dropping SOUTH into the ropewalk shed and climbing the
  // meeting house's far face back up. From the meeting roof the existing CLIMB
  // chain (D_MEETING_ROOF -> E_RIDGE -> E_LOUVRE -> E_GALLERY) tops out at the
  // gallery the leap of faith launches from. The ropewalk drop below
  // (D_SROOF_E -> D2_ROOF_W) stays authored, so the shed survives as an optional
  // dark-interior space; the guided line just no longer detours through it.
  link("D_SROOF_E", "D_MEETING_W", "DROP", "SAFE", "CHAIN_DROP", {
    speedMps: 3.0,
    note: "Off the south row onto the Hollis meeting-house roof — the roofline continues straight onto the nearest high ground to the steeple, rather than dropping south into the ropewalk.",
  }),
  link("D_MEETING_W", "D_MEETING_ROOF", "RUN", "SAFE", "RUN", {
    note: "In under the ridge monitor to the foot of the climb onto the steeple line.",
  }),

  // -- E --------------------------------------------------------------------
  // STEEPLE ASCENT — kept as the proven spiral (D_MEETING_ROOF -> ridge 11.2 ->
  // louvre 14.0 -> gallery 15.8) as the green fallback. The owner's ≤1.9 m ring
  // re-mass is BLOCKED ON THE ASSET WORKER'S STEEPLE REGEN and flagged: the ridge
  // monitor MEETING_RIDGE (11.2, proven meeting-house geometry, must not move) and
  // the louvre sill LOUVRE_SILL (14.0) are full-width decks 2.8 m apart, and
  // `crossesPlatform` forbids a body's head (feet+STAND_HEIGHT 1.55) from piercing
  // a ledge deck — so no intermediate ring fits between them (needs ≥3.1 m) and a
  // ring cannot skip a spanning deck either. A clean ≤1.9 m ring chain needs the
  // regen to REPLACE LOUVRE_SILL's spanning collision with a ring stack on the
  // shaft's south annulus (clear of the ridge monitor). See docs/process/M1-STATUS.md.
  link("D_MEETING_ROOF", "E_RIDGE", "CLIMB", "SAFE", "CLIMB", { ignore: ["HOLLIS_MEETING"] }),
  link("E_RIDGE", "E_LOUVRE", "CLIMB", "SAFE", "CLIMB", { ignore: ["STEEPLE"] }),
  link("E_LOUVRE", "E_GALLERY", "CLIMB", "SAFE", "CLIMB", { ignore: ["STEEPLE"] }),

  link("E_GALLERY", "F_CROWN", "LEAP_OF_FAITH", "SAFE", "LEAP_OF_FAITH", {
    target: "LEAP_CROWN",
    speedMps: 4.6,
    note: "The signature: 5.7m of gap and 7.5m of fall, off the steeple gallery into the crown of the Liberty Tree. Leave short and the low bough catches you a tier down.",
  }),

  // -- F --------------------------------------------------------------------
  link("F_LOW", "F_CROWN", "CLIMB", "SAFE", "CLIMB", { ignore: ["LIBERTY_ELM_TRUNK"] }),
  link("F_CROWN", "F_CROWN_E", "RUN", "SAFE", "RUN"),
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
  link("G_GATE", "G_SPAWN", "RUN", "SAFE", "RUN"),
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
