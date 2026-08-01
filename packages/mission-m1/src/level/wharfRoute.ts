// The covert golden line across the DEAD WHARF (plan A.1 legs 1a–1h).
//
// The run's one authored ground beat: down off the printshop leads onto the
// closed port, across the deck in the open (EXPOSED), and back up the far side
// onto the Shambles high line, which carries on into the merchant (the existing
// G-A drop-in) and the Town House (G-B). This is added ALONGSIDE the old
// printshop→street→Shambles line, which stays green as the fallback until the
// covert line passes its gates.
//
// Every surface here is drawn == collision (warehouse-shed roofs and BLOCK crate
// mounds), and every leg is proven by the shipped physics (traversability.test):
// the DROPs by simulateBallistic + the live stepFlow driver (routeFlow.test),
// the CLIMBs by beginAuthored with the climbed mass ignored.

import { climbVolume, link, node } from "../authoring.js";
import { BAND } from "../envelope.js";
import type { ClimbSpec, RouteLink, RouteNode } from "../types.js";

export const WHARF_NODES: RouteNode[] = [
  // -- descent off the printshop leads (NW) ---------------------------------
  node("WHARF_LEADS_SW", "A_LEADS", [-0.3, BAND.LOW_ROOF, -3.0], "PRINTSHOP__ROOF", ["start", "high-line"],
    "The printshop leads' SW corner, over the closed port. The first authored ground beat drops from here."),
  node("WHARF_DESC_ROOF", "A_LEADS", [-2.5, BAND.PENTICE, 0.5], "WHARF_WAREHOUSE_A__ROOF", ["wharf", "descent"],
    "Onto the waterfront warehouse roof off the leads — the first step down onto the port."),
  node("WHARF_DESC_MOUND_T", "A_LEADS", [-6.5, 2.35, 9.0], "WHARF_DESC_MOUND", ["wharf", "descent"],
    "The descent's cargo footing: a crate mound between the warehouse roof and the deck."),
  node("WHARF_DECK_1", "A_LEADS", [-6.5, 0.0, 12.5], "GROUND", ["wharf", "exposed", "authoredGroundBeat"],
    "Down onto the closed port. The crossing is walked in the open past the idle ships — the shut harbour, felt."),

  // -- cross the open deck (EXPOSED) ----------------------------------------
  node("WHARF_DECK_2", "A_LEADS", [-4.6, 0.0, 11.9], "GROUND", ["wharf", "exposed", "authoredGroundBeat"],
    "Across the deck to the foot of the far-side cargo staircase, past the ships over open water."),

  // -- ascent onto the Shambles high line (SE): a mantle staircase of cargo ---
  node("WHARF_ASC_1", "A_LEADS", [-4.6, 1.64, 10.6], "WHARF_ASC_STEP1", ["wharf", "ascent"],
    "First mantle off the deck onto stacked dock cargo (1.64 m)."),
  node("WHARF_ASC_2", "A_LEADS", [-3.2, 3.5, 10.7], "WHARF_ASC_STEP2", ["wharf", "ascent"],
    "Second mantle onto the higher cargo, one step under the warehouse gallery."),
  node("WHARF_ASC_ROOF", "A_LEADS", [-1.5, 4.3, 10.7], "WHARF_WAREHOUSE_B__ROOF", ["wharf", "ascent", "high-line"],
    "Mantle onto the warehouse's flat roof (4.30) — the top of the cargo ascent, one more mantle under the Shambles shed. 4.30 is where the mesh draws its roof; the 5.35 this node used to claim was a box the asset never filled."),
  node("WHARF_ASC_ROOF_E", "A_LEADS", [0.6, 4.3, 10.7], "WHARF_WAREHOUSE_B__ROOF", ["wharf", "ascent", "high-line"],
    "The warehouse roof's east end, at the foot of the mantle onto the Shambles shed. It exists because the two roofs OVERLAP in x 1.3..2.7 with only 1.30 m of headroom under the shed, which is less than a body: the climb has to be taken from west of 1.3, and the cargo mantle lands 2 m west of here, so the roof is crossed on foot between them."),
  node("WHARF_SHED_W", "B_SHAMBLES", [2.0, 5.6, 10.4], "MARKET_SHED__ROOF", ["high-line"],
    "Onto the Shambles market-shed roof off the wharf warehouse — back on the covert high line. Pulled west and south to sit a mantle's length from the warehouse roof rather than five metres of it: the two roofs overlap in x 1.3..2.7, and 1.30 m of headroom under the shed is less than a body, so the climb has to start west of 1.3 and land east of it."),
];

export const WHARF_LINKS: RouteLink[] = [
  // Reach the wharf lip off the leads (the golden line's opening).
  link("A_START", "WHARF_LEADS_SW", "RUN", "SAFE", "RUN", {
    note: "West across the printshop leads to the SW corner over the closed port.",
  }),
  // 1a: leads (7.1) → warehouse roof (5.35). RUN_OFF 1.75.
  link("WHARF_LEADS_SW", "WHARF_DESC_ROOF", "DROP", "SAFE", "CHAIN_DROP", {
    speedMps: 2.3,
    note: "1a: off the leads onto the waterfront warehouse roof — the descent onto the shut port begins.",
  }),
  // 1b: warehouse roof (5.35) → crate mound (2.35). HANG_DROP 3.0.
  link("WHARF_DESC_ROOF", "WHARF_DESC_MOUND_T", "DROP", "SAFE", "CHAIN_DROP", {
    speedMps: 2.3,
    note: "1b: down the warehouse face onto the cargo mound.",
  }),
  // 1c/1d: crate mound (2.35) → deck (0). HANG_DROP 2.35. EXPOSED.
  link("WHARF_DESC_MOUND_T", "WHARF_DECK_1", "DROP", "SAFE", "CHAIN_DROP", {
    speedMps: 2.3,
    note: "1d: off the cargo onto the deck — the one EXPOSED beat on the west end.",
  }),
  // 1e: cross the plank deck in the open.
  link("WHARF_DECK_1", "WHARF_DECK_2", "RUN", "SAFE", "RUN", {
    speedMps: 3.0,
    note: "1e: across the closed port in the open, past the idle ships.",
  }),
  // 1f–1g: up the cargo mantle staircase (each ≤1.9 m onto a standable top):
  // deck 0 → cargo 1.8 → cargo 3.6 → warehouse roof 5.35. No ladders, no tall climb.
  link("WHARF_DECK_2", "WHARF_ASC_1", "CLIMB", "SAFE", "CLIMB", {
    note: "1f: mantle off the deck onto the first cargo step.",
  }),
  link("WHARF_ASC_1", "WHARF_ASC_2", "CLIMB", "SAFE", "CLIMB", {
    note: "up onto the higher cargo, one mantle under the warehouse roof.",
  }),
  link("WHARF_ASC_2", "WHARF_ASC_ROOF", "CLIMB", "SAFE", "CLIMB", {
    // The warehouse the mantle tops onto is the climb's own hold, not a wall to
    // avoid — ignored so the sweep verifies against the world it moves through.
    ignore: ["WHARF_WAREHOUSE_B"],
    note: "1g: the mantle onto the far warehouse roof (3.50 -> 4.30).",
  }),
  // 1h: warehouse roof (4.30) → Shambles shed roof (5.60). A 1.30 m MANTLE, not
  // the old 0.25 m step: the warehouse roof is authored where the mesh draws it
  // now, so the last hop onto the high line is a real pull rather than a kerb.
  link("WHARF_ASC_ROOF", "WHARF_ASC_ROOF_E", "RUN", "SAFE", "RUN", {
    speedMps: 2.3,
    note: "Across the warehouse roof to the foot of the shed mantle.",
  }),
  link("WHARF_ASC_ROOF_E", "WHARF_SHED_W", "CLIMB", "SAFE", "CLIMB", {
    speedMps: 2.3,
    // The shed the mantle tops onto is the climb's own hold, not a wall to avoid
    // — the same ignore the cargo mantle below it carries for the warehouse.
    ignore: ["MARKET_SHED"],
    note: "1h: the last mantle onto the market shed roof — back on the covert high line.",
  }),

  // The high line east along the shed to the market's mid-line canopies, which
  // carry on into the merchant (the existing G-A drop-in) — no ground touch.
  link("WHARF_SHED_W", "B_SHED_MID", "RUN", "SAFE", "RUN", {
    note: "East along the market-shed roof to its mid-line.",
  }),
  link("B_SHED_MID", "B_CANOPY_1", "DROP", "SAFE", "CHAIN_DROP", {
    speedMps: 2.6,
    note: "Down off the shed roof onto the stall-canopy mid-line the merchant approach runs.",
  }),
  // Close the canopy run so the mid-line is continuous from the shed drop east
  // to the merchant crate (B_CRATES_B → M_LEDGE, existing).
  link("B_CANOPY_1", "B_CANOPY_2", "JUMP", "SAFE", "LEAP", {
    note: "1.4 m canopy hop, the same as the market's other mid-line leaps.",
  }),
];

export const WHARF_CLIMBS: ClimbSpec[] = [
  climbVolume({
    section: "A_LEADS",
    serves: "WHARF_DECK_2->WHARF_ASC_1",
    onto: "WHARF_ASC_STEP1",
    at: [-4.6, 0.0, 11.9],
    halfX: 0.9,
    halfZ: 0.9,
    note: "At the foot of the cargo staircase, on the deck; mantle onto the first step.",
  }),
  climbVolume({
    section: "A_LEADS",
    serves: "WHARF_ASC_1->WHARF_ASC_2",
    onto: "WHARF_ASC_STEP2",
    at: [-4.6, 1.64, 10.6],
    halfX: 0.8,
    halfZ: 0.8,
    note: "On the first cargo step; mantle onto the higher one.",
  }),
  climbVolume({
    section: "A_LEADS",
    serves: "WHARF_ASC_2->WHARF_ASC_ROOF",
    onto: "WHARF_WAREHOUSE_B__ROOF",
    at: [-3.2, 3.5, 10.7],
    halfX: 0.8,
    halfZ: 0.8,
    note: "On the higher cargo; mantle onto the warehouse's drawn flat roof.",
  }),
];
