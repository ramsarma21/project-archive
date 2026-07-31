// The vertical ascents, declared.
//
// Every other move in this level is inferred: the reader walks forward until
// the ground steps up, finds a face, measures it, and offers a verb. That works
// because there is something to find. A vertical ascent has nothing — the two
// route nodes share an x and a z, the body stands in the middle of a floor and
// goes straight up, and no amount of looking distinguishes it from standing
// under a canopy that happens to be within reach.
//
// The mission spent a morning on both sides of that. With the reader guessing
// generously it climbed players up through market awnings and scaffold boards
// from anywhere underneath; with it guessing carefully the Town House, the
// clock, the cornice, the meeting-house ridge and the Liberty Elm all went
// silent and there was no route to the objective at all. The clock stands 3.5m
// inside its own ledge and the cornice 5.7m inside its own: no bound that means
// anything reaches them, because they are not near an edge.
//
// So the twelve places where this level genuinely wants a straight climb are
// written down here, each one against the route link it exists to serve, and
// route.test.ts checks that the two still agree. Everywhere else the reader's
// half-metre reach applies and a body under the middle of a floor is offered
// nothing.

import { climbVolume } from "../authoring.js";
import type { ClimbSpec } from "../types.js";

export const CLIMBS: ClimbSpec[] = [
  // ---- B_SHAMBLES: the merchant's house — the covert drop-in ---------------
  // Off the Shambles crate up the goods-ladder in the merchant's open window
  // onto the projecting balcony ledge, and out of the parlour up the window
  // reveal onto the leads. Both are straight-up climbs the reader would not
  // otherwise offer (a ledge over a crate, a floor under an eave), so they are
  // written down here against the links they serve.
  climbVolume({
    section: "B_SHAMBLES",
    serves: "B_CRATES_B->M_LEDGE",
    onto: "MERCHANT_BALCONY",
    at: [39.2, 1.9, -2.0],
    halfX: 0.6,
    halfZ: 0.4,
    note: "Standing on the Shambles crate under the merchant's open window; the balcony overhangs the crate, and going up is the climb-in. A foothold, not the whole ledge (the balcony is only 0.8 m deep).",
  }),
  climbVolume({
    section: "B_SHAMBLES",
    serves: "M_LEDGE->M_EAVE",
    onto: "MERCHANT__ROOF",
    at: [39.2, 4.0, -2.8],
    halfX: 1.0,
    halfZ: 0.4,
    note: "On the window balcony; the leads are one climb up the south face, riding the wall exterior clear of the roof edge.",
  }),

  // ---- C_ASCENT: the Town House, twice round and up the tower --------------
  climbVolume({
    section: "C_ASCENT",
    serves: "C_SCAFF_FOOT->C_SCAFF_1",
    onto: "SCAFFOLD_D1",
    at: [44.8, 0, -6.4],
    halfX: 1.1,
    note: "The south bay of the mason's scaffold. Standing in it and going up is what a scaffold is.",
  }),
  climbVolume({
    section: "C_ASCENT",
    serves: "C_SCAFF_1->C_SCAFF_2",
    onto: "SCAFFOLD_D2",
    at: [44.8, 2.9, -6.4],
    halfX: 1.1,
    note: "Second staging, same bay. The feet band is what keeps the two apart.",
  }),
  climbVolume({
    section: "C_ASCENT",
    serves: "C_GALLERY_EMID->C_CLOCK",
    onto: "CLOCK_LEDGE",
    at: [58.3, 5.6, -4.0],
    halfX: 0.8,
    halfZ: 1.2,
    note: "Under the clock ledge's north edge, where it overhangs the east gallery. This is the lip a normal ascent climbs onto — not the mid-gallery interior 4m south, nor the exposed edge half a metre north that the tower watch sees.",
  }),
  climbVolume({
    section: "C_ASCENT",
    serves: "C_CLOCK->C_CORNICE_E",
    onto: "CORNICE_E",
    at: [58.3, 7.9, 0],
    halfX: 0.8,
    halfZ: 1.2,
    note: "Clock ledge to cornice, the deepest-set climb in the mission at 5.7m in.",
  }),
  climbVolume({
    section: "C_ASCENT",
    serves: "C_LEADS_TOWERFOOT->C_TOWER_PLINTH",
    onto: "TOWER_PLINTH",
    at: [52.0, 12.4, 2.9],
    halfX: 1.4,
    halfZ: 0.9,
    note: "The foot of the tower, standing on the leads.",
  }),

  // ---- E_LEAP: the meeting house and the steeple ---------------------------
  climbVolume({
    section: "E_LEAP",
    serves: "D2_OUTSIDE->E_BUTTRESS",
    onto: "HOLLIS_BUTTRESS",
    at: [75.4, 0, 17.4],
    halfX: 1.2,
    halfZ: 1.1,
    note: "Ground to the buttress set-off at the corner of the meeting house.",
  }),
  climbVolume({
    section: "E_LEAP",
    serves: "E_BUTTRESS->E_LEANTO",
    onto: "HOLLIS_LEANTO",
    at: [75.4, 2.6, 16.2],
    halfX: 1.2,
    halfZ: 0.7,
    note: "Buttress to lean-to roof. The buttress top sits 1.6m inside the lean-to's boards.",
  }),
  climbVolume({
    section: "E_LEAP",
    serves: "D_MEETING_ROOF->E_RIDGE",
    onto: "MEETING_RIDGE",
    at: [76.5, 8.2, 9.0],
    halfX: 1.3,
    halfZ: 1.3,
    note: "Up the gambrel onto the ridge from the west; the ridge runs on past the player.",
  }),
  climbVolume({
    section: "E_LEAP",
    serves: "E_GAMBREL_S->E_RIDGE_W",
    onto: "MEETING_RIDGE",
    at: [78.0, 8.2, 10.2],
    halfX: 1.2,
    halfZ: 1.2,
    note: "The same ridge from the south slope.",
  }),
  climbVolume({
    section: "E_LEAP",
    serves: "E_RIDGE->E_LOUVRE",
    onto: "LOUVRE_SILL",
    at: [78.5, 11.2, 8.6],
    halfX: 1.2,
    halfZ: 1.0,
    note: "Off the ridge onto the louvre sill, under the belfry.",
  }),

  // ---- F_TREE: the Liberty Elm --------------------------------------------
  climbVolume({
    section: "F_TREE",
    serves: "F_LOW->F_CROWN",
    onto: "BOUGH_CROWN",
    at: [78.7, 6.4, 0.4],
    halfX: 1.0,
    halfZ: 1.0,
    note: "Low bough to crown. The crown overhangs the standing spot on every side.",
  }),
];
