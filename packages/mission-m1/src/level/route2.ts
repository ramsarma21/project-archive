// Route additions for the two sections that are not parkour.
//
// B2 is walked, not run, and the whole section is a choice between two
// concealments that behave differently. D2 is an interior, where the choice is
// between one loud drop and three quiet ones — the same noise grammar section A
// teaches in its first eight seconds, restated somewhere the player cannot see
// the sky.

import { link, node } from "../authoring.js";
import { BAND } from "../envelope.js";
import type { RouteLink, RouteNode } from "../types.js";

export const NODES_2: RouteNode[] = [
  // -- B2: Dock Square ------------------------------------------------------
  node("B_GAP_N", "B_SHAMBLES", [34.4, 0.0, -0.4], "GROUND", ["street-line"]),
  node("B_STALL_GAP", "B_SHAMBLES", [34.4, 0.0, 1.4], "GROUND", ["street-line"],
    "A 0.9m slot between two stalls. The market's three heights all funnel through gaps like this one to reach the square."),
  node("B2_ENTER", "B2_THRONG", [34.4, 0.0, 5.4], "GROUND", ["street-line"],
    "Into the square out of the market's unlit corner. Nothing above you here goes anywhere."),
  node("B2_KERB", "B2_THRONG", [29.6, 0.34, 7.9], "PUMP_KERB", ["step-up"]),
  node("B2_PUMP_W", "B2_THRONG", [27.4, 0.34, 7.9], "PUMP_KERB", ["step-up"]),
  node("B2_WELL", "B2_THRONG", [27.6, 0.0, 11.6], "GROUND", ["sight-break", "blend-entry"],
    "Behind the town pump. Break contact here and the blend takes; walk straight in and the nearest watch saw you do it."),
  node("B2_THRONG_W", "B2_THRONG", [32.6, 0.0, 15.4], "GROUND", ["blend"]),
  node("B2_DUCK", "B2_THRONG", [35.18, 0.0, 17.58], "GROUND", ["blend", "crouch"],
    "Under the awning beam, in the middle of the throng. A standing capsule does not fit; a crouched one does, and crouching is already what the crowd wants from you."),
  node("B2_THRONG_S", "B2_THRONG", [36.4, 0.0, 18.6], "GROUND", ["blend"],
    "The crossing bulges south round the stalls because the direct north-east line walks straight into the arcade sentry's cone. The long way is the way the crowd is actually going."),
  node("B2_THRONG_E", "B2_THRONG", [38.4, 0.0, 14.2], "GROUND", ["blend"]),
  node("B2_CART_W", "B2_THRONG", [27.8, 0.0, 14.6], "GROUND", ["sight-break", "blend-entry"]),
  node("B2_STALL_TOP", "B2_THRONG", [32.3, BAND.STALL_ROOF, 18.6], "DOCK_STALL_CANOPY", ["exposed"],
    "The one thing you can climb in this section, and it makes you the most visible object in the square."),
  node("B2_ARCADE_S", "B2_THRONG", [43.8, 0.0, 19.4], "GROUND", ["dark"]),
  node("B2_ARCADE_STOCK", "B2_THRONG", [45.2, 0.0, 16.8], "GROUND", ["dark", "cover"],
    "Squeezed between the market's overnight crates and the shop fronts. Still south of the sentry, who cannot look behind himself."),
  node("B2_ARCADE_PIER", "B2_THRONG", [45.2, 0.0, 13.0], "GROUND", ["dark", "exposed"],
    "Level with the post, a body's width east of him, with nothing between. The one metre of this section where the dark is the only thing working."),
  node("B2_ARCADE_CASKS", "B2_THRONG", [45.2, 0.0, 9.8], "GROUND", ["dark", "crouch", "cover"],
    "Down behind the hogsheads, four metres inside his cone. Crouched, they are the whole of you; standing, they are your legs."),
  node("B2_ARCADE_N", "B2_THRONG", [43.8, 0.0, 7.2], "GROUND", ["dark"],
    "The arcade's north mouth. Unlit the whole way, and the sentry is posted in it."),
  node("B2_SQUARE_NE", "B2_THRONG", [40.8, 0.0, 9.4], "GROUND", []),
  node("B2_EXIT", "B2_THRONG", [44.6, 0.0, 4.4], "GROUND", []),

  // ---- threading the colonnade -------------------------------------------
  //
  // The arcade's west side is a ROW of piers at x=41.6-42.2 with bays between
  // them, so a body may only cross that line in five places, and each of those
  // is 2.6m or 1.8m wide against a 0.70m body. Every crossing here used to be
  // aimed at a pier rather than at a bay, and missed by 2, 4 and 13 centimetres
  // — which is enough, because a link the verifier refuses is a link the route
  // graph does not have. These three waypoints are the bays.
  node("B2_PIER_GAP", "B2_THRONG", [41.2, 0.0, 8.3], "GROUND", [],
    "The mouth of the colonnade's north bay. The exit line turns here rather than cutting the diagonal, which put a shoulder into the first pier."),
  node("B2_ARCADE_MOUTH", "B2_THRONG", [41.2, 0.0, 19.2], "GROUND", [],
    "Outside the last bay before the market row closes the walk. Both ways out of the throng enter the dark here, which is why it is one place and not two."),
  node("B2_ARCADE_LANE", "B2_THRONG", [44.8, 0.0, 7.4], "GROUND", ["dark"],
    "Round the north end of the overnight crates. The walk is 3.8m wide and the goods take half of it, so leaving the arcade means stepping out from behind them."),

  // The market's own barrels, left in the square overnight, and the one thing
  // to perform between the stall gap and the foot of the Town House scaffold.
  node("B2_GOODS_IN", "B2_THRONG", [41.81, 0.0, 7.4], "GROUND", []),
  node("B2_GOODS_OUT", "B2_THRONG", [43.39, 0.0, 5.6], "GROUND", []),

  // -- D2: the ropewalk -----------------------------------------------------
  node("D2_ROOF_W", "D2_ROPEWALK", [66.0, 8.6, 17.4], "ROPEWALK_ROOF_W", []),
  node("D2_VENT_IN_0", "D2_ROPEWALK", [68.5, 8.6, 19.95], "ROPEWALK_ROOF_W", []),
  node("D2_VENT_OUT_0", "D2_ROPEWALK", [70.9, 8.6, 19.95], "ROPEWALK_ROOF_W", []),
  node("D2_VENT_IN_1", "D2_ROPEWALK", [71.7, 8.6, 19.95], "ROPEWALK_ROOF_W", []),
  node("D2_VENT_OUT_1", "D2_ROPEWALK", [74.1, 8.6, 19.95], "ROPEWALK_ROOF_W", []),
  node("D2_ROOF_N", "D2_ROPEWALK", [76.1, 8.6, 18.6], "ROPEWALK_ROOF_N", ["lip"]),
  node("D2_BEAM_MID", "D2_ROPEWALK", [76.1, 5.2, 21.3], "ROPEWALK_TIE_BEAM", ["beam"],
    "Down the hatch onto the tie beam, four metres over an unlit floor."),
  node("D2_BEAM_E", "D2_ROPEWALK", [72.0, 5.2, 21.3], "ROPEWALK_TIE_BEAM", ["beam"],
    "Directly over the night man's lantern. Thirteen metres of beam west to the hemp in the dark, or 5.2m straight down onto his floor. The long way is quiet."),
  node("D2_BEAM_W", "D2_ROPEWALK", [63.0, 5.2, 21.3], "ROPEWALK_TIE_BEAM", ["beam"],
    "The west end of the walked beam, over the hemp stacks. From here the descent is three run-offs and none of them is heard."),
  // Where the 5.2m run-off actually puts you, not where it aims: off the beam's
  // south edge at a walk the arc carries 2.3m before the floor arrives, which
  // lands a stride from the night man's own post at (72.6, 23.6). That is the
  // point. The loud line is loud because of where it lands as much as how hard.
  node("D2_FLOOR_MID", "D2_ROPEWALK", [72.0, 0.0, 24.6], "GROUND", ["dark"],
    "The loud way down: 5.2m off the beam is a roll landing, taken within arm's reach of the man with the lantern, and it skips the whole tarring floor."),
  node("D2_BALES_HIGH", "D2_ROPEWALK", [63.0, 3.2, 23.7], "HEMP_BALES_HIGH", ["dark", "cover"]),
  node("D2_BALES_LOW", "D2_ROPEWALK", [60.1, 1.1, 23.9], "HEMP_BALES_LOW", ["dark", "cover"]),
  node("D2_FLOOR_W", "D2_ROPEWALK", [59.6, 0.0, 21.8], "GROUND", ["dark", "cover"],
    "The foot of the hemp, at the head of the walk. The stacks are between here and the post, which is the only reason standing on an unlit floor in front of a lantern is survivable."),
  node("D2_VAULT_IN", "D2_ROPEWALK", [59.8, 0.0, 19.3], "GROUND", ["dark"]),
  node("D2_VAULT_OUT", "D2_ROPEWALK", [62.1, 0.0, 19.3], "GROUND", ["dark"]),
  node("D2_SLIDE_IN", "D2_ROPEWALK", [62.8, 0.0, 19.3], "GROUND", ["dark"]),
  node("D2_SLIDE_OUT", "D2_ROPEWALK", [65.2, 0.0, 19.3], "GROUND", ["dark"]),
  node("D2_OVER_IN", "D2_ROPEWALK", [66.6, 0.0, 19.3], "GROUND", ["dark"]),
  node("D2_OVER_OUT", "D2_ROPEWALK", [68.6, 0.0, 19.3], "GROUND", ["dark"]),
  node("D2_STAGE", "D2_ROPEWALK", [73.0, 0.34, 19.4], "LAYING_STAGE", ["dark", "step-up"]),
  node("D2_DOOR", "D2_ROPEWALK", [75.0, 0.0, 17.8], "GROUND", ["exposed"],
    "The one lit patch inside. Leaving is the exposed part of the interior."),
  node("D2_OUTSIDE", "D2_ROPEWALK", [75.4, 0.0, 17.4], "GROUND", []),

  // -- E: the sustained climb out of the ropewalk ---------------------------
  node("E_BUTTRESS", "E_LEAP", [75.4, 2.6, 16.2], "HOLLIS_BUTTRESS", ["climb"]),
  node("E_LEANTO", "E_LEAP", [75.4, 5.2, 16.3], "HOLLIS_LEANTO", ["climb"]),
  node("E_MEETING_S", "E_LEAP", [75.4, BAND.MEETING_EAVE, 13.8], "HOLLIS_MEETING__ROOF", ["climb"]),
  node("E_GAMBREL_S", "E_LEAP", [78.0, BAND.MEETING_EAVE, 10.2], "HOLLIS_MEETING__ROOF", ["climb"]),
  node("E_RIDGE_W", "E_LEAP", [78.0, BAND.MEETING_RIDGE, 8.6], "MEETING_RIDGE", []),
];

export const LINKS_2: RouteLink[] = [
  // -- into and across Dock Square ------------------------------------------
  link("B_STREET_MID", "B_GAP_N", "RUN", "FAST", "RUN", {
    note: "Straight along the street to the stall gap. It is the shortest thing in the Shambles and it keeps you at ground level in front of the watch for the whole length of it.",
  }),
  link("B_GAP_N", "B_STALL_GAP", "RUN", "SAFE", "RUN"),
  link("B_STALL_GAP", "B2_ENTER", "RUN", "SAFE", "RUN", {
    note: "Out of the Shambles and south into the square. The roofline does not come with you.",
  }),
  link("B2_ENTER", "B2_KERB", "RUN", "SAFE", "STEP_UP", {
    speedMps: 2.3,
    note: "The pump-yard kerb, absorbed at a run. It costs nothing, which is the point of a half-metre step.",
  }),
  link("B2_KERB", "B2_PUMP_W", "RUN", "SAFE", "RUN", { speedMps: 2.3 }),
  link("B2_PUMP_W", "B2_WELL", "RUN", "SAFE", "RUN", {
    speedMps: 2.3,
    note: "Down off the kerb and round the west side of the pump, which is the side the market watch is never on.",
  }),
  link("B2_WELL", "B2_CART_W", "RUN", "SAFE", "RUN", { speedMps: 2.3 }),

  // The throng: walked, and only after breaking contact.
  link("B2_WELL", "B2_THRONG_W", "BLEND", "SAFE", "BLEND", {
    speedMps: 2.3,
    note: "Step out from behind the pump already unseen and the 0.7s ramp completes before anyone resolves you.",
  }),
  link("B2_CART_W", "B2_THRONG_W", "BLEND", "SAFE", "BLEND", { speedMps: 2.3 }),
  link("B2_THRONG_W", "B2_DUCK", "BLEND", "SAFE", "BLEND", {
    speedMps: 2.3,
    note: "Walking pace in the middle of a lit square, invisible because of the bodies rather than the dark. Sprint and the crowd parts around you instead of closing over you.",
  }),
  link("B2_DUCK", "B2_THRONG_S", "DUCK_UNDER", "SAFE", "SLIDE", {
    ignore: ["DOCK_STALL_BEAM"],
    note: "Under the awning beam without leaving the crowd. It is the only thing to perform in twenty-one seconds of route, and it is deliberately a verb the player was taught in the Shambles rather than a new one — the same 1.20m underside, one section earlier.",
  }),
  link("B2_THRONG_S", "B2_THRONG_E", "BLEND", "SAFE", "BLEND", { speedMps: 2.3 }),
  link("B2_THRONG_E", "B2_SQUARE_NE", "BLEND", "SAFE", "BLEND", { speedMps: 2.3 }),
  // Out of the throng and over the barrels. The exit is the section's one
  // traversal verb: everything from the stall gap to here is walked, and a vault
  // at 1.10m is the smallest thing that breaks that without asking the player to
  // leave the crowd.
  link("B2_SQUARE_NE", "B2_PIER_GAP", "RUN", "SAFE", "RUN", { speedMps: 2.3 }),
  link("B2_PIER_GAP", "B2_GOODS_IN", "RUN", "SAFE", "RUN", { speedMps: 2.3 }),
  link("B2_GOODS_IN", "B2_GOODS_OUT", "VAULT", "SAFE", "VAULT", {
    ignore: ["DOCK_BARRELS"],
    note: "1.10m high and 1.10m deep, which is inside the vault envelope on every face — the same numbers as the barrels rolled out of the gaol door twenty metres back, so the verb is one the player already met.",
  }),
  link("B2_GOODS_OUT", "B2_EXIT", "RUN", "SAFE", "RUN", { speedMps: 2.3 }),
  link("B2_THRONG_W", "B2_THRONG_E", "RUN", "FAST", "RUN", {
    note: "The same ground at a sprint. Above 2.4 m/s the crowd parts around you instead of closing over you, so this is the fast line and it is fully exposed.",
  }),

  // The arcade: unlit, no ramp-in, but the sentry lives there.
  //
  // Twelve metres in four moves instead of one, because the colonnade is what
  // the section spends: the walk threads east of the goods stacked in it, so
  // hard cover comes and goes as the piers and the casks pass between the
  // player and the post. The 0.45 dark factor was doing all of the work here and
  // now it is doing half of it.
  //
  // Both ways out of the throng converge on the same bay before going in, because
  // the colonnade only opens in five places and this is the one south of the
  // sentry. The approach is free either way: he faces north and cannot turn far
  // enough to see his own back.
  link("B2_THRONG_S", "B2_ARCADE_MOUTH", "RUN", "FAST", "RUN", { speedMps: 2.3 }),
  link("B2_THRONG_E", "B2_ARCADE_MOUTH", "RUN", "FAST", "RUN"),
  link("B2_ARCADE_MOUTH", "B2_ARCADE_S", "RUN", "FAST", "RUN", { speedMps: 2.3 }),
  link("B2_ARCADE_S", "B2_ARCADE_STOCK", "RUN", "FAST", "RUN", {
    speedMps: 2.3,
    note: "In at the south mouth and behind the crates. The approach is free: he faces north and cannot turn far enough to see his own back.",
  }),
  link("B2_ARCADE_STOCK", "B2_ARCADE_PIER", "RUN", "FAST", "RUN", {
    speedMps: 2.3,
    note: "Past the post itself. Nothing screens this metre and the dark is 0.45, not zero, so this is where the arcade is paid for.",
  }),
  link("B2_ARCADE_PIER", "B2_ARCADE_CASKS", "RUN", "FAST", "RUN", {
    speedMps: 1.15,
    note: "Down behind the hogsheads at a crouch. Slower than walking it upright and the difference is the difference between 0.3 of a read and all of it.",
  }),
  link("B2_ARCADE_CASKS", "B2_ARCADE_LANE", "RUN", "FAST", "RUN", { speedMps: 1.15 }),
  link("B2_ARCADE_LANE", "B2_ARCADE_N", "RUN", "FAST", "RUN", {
    speedMps: 1.15,
    note: "Half a metre of detour round the crates rather than through their corner, still crouched. The head-high stack is the last thing between you and the post.",
  }),
  link("B2_ARCADE_N", "B2_EXIT", "RUN", "FAST", "RUN"),

  // The trap line, authored so it exists to be rejected.
  link("B2_THRONG_W", "B2_STALL_TOP", "CLIMB", "EXPERT", "CLIMB", {
    ignore: ["DOCK_STALLS"],
  }),
  link("B2_STALL_TOP", "B2_THRONG_E", "DROP", "EXPERT", "CHAIN_DROP", { speedMps: 2.3 }),

  link("B2_EXIT", "C_SQUARE_W", "RUN", "SAFE", "RUN"),

  // -- into the ropewalk ----------------------------------------------------
  link("D_SROOF_E", "D2_ROOF_W", "DROP", "SAFE", "CHAIN_DROP", {
    speedMps: 3.4,
    note: "Off the south row onto the ropewalk's roof. The descent off the Town House continues straight into a building rather than over one.",
  }),
  link("D2_ROOF_W", "D2_VENT_IN_0", "RUN", "SAFE", "RUN"),
  link("D2_VENT_IN_0", "D2_VENT_OUT_0", "VAULT", "SAFE", "VAULT", {
    ignore: ["ROPEWALK_VENT_0"],
  }),
  link("D2_VENT_OUT_0", "D2_VENT_IN_1", "RUN", "SAFE", "RUN"),
  link("D2_VENT_IN_1", "D2_VENT_OUT_1", "VAULT", "SAFE", "VAULT", {
    ignore: ["ROPEWALK_VENT_1"],
  }),
  link("D2_VENT_OUT_1", "D2_ROOF_N", "RUN", "SAFE", "RUN"),
  link("D2_ROOF_N", "D2_BEAM_MID", "DROP", "SAFE", "CHAIN_DROP", {
    speedMps: 2.3,
    note: "Through the hatch. From here to the door there is no sky and no height to spend.",
  }),

  // The beam is the fork, and both halves of it are a walk: nineteen metres of
  // 1.6m board in the dark, west to the hemp or east over the lantern. What is
  // risked is never the beam, it is how you get off it.
  //
  // 2.3 m/s is load-bearing here, not flavour: the board is 1.6m wide and a
  // full-sprint entry off the hatch (near 4.6 m/s) overshoots it into the dark.
  // The guidance exposes this authored target and the runtime caps free movement
  // to it while the leg is live, so a player who holds Shift still lands the beam.
  link("D2_BEAM_MID", "D2_BEAM_W", "RUN", "SAFE", "RUN", { speedMps: 2.3 }),
  link("D2_BEAM_MID", "D2_BEAM_E", "RUN", "SAFE", "RUN", { speedMps: 2.3 }),

  // The quiet way down: three run-offs off the west end, none of them past the
  // 2.2m ceiling, so the descent out of the roof never actually stops.
  link("D2_BEAM_W", "D2_BALES_HIGH", "DROP", "SAFE", "CHAIN_DROP", {
    speedMps: 2.3,
    note: "2.0m off the beam's west end into the raw hemp. A run-off, which is the quietest landing the game has, and it is why walking the whole length of the beam is worth the seconds it costs.",
  }),
  link("D2_BALES_HIGH", "D2_BALES_LOW", "DROP", "SAFE", "CHAIN_DROP", { speedMps: 2.3 }),
  link("D2_BALES_LOW", "D2_FLOOR_W", "DROP", "SAFE", "CHAIN_DROP", { speedMps: 2.3 }),

  // The loud way down, off the east end, four metres from the post. One roll
  // landing at 0.5 intensity against three run-offs at 0.2, and it skips every
  // authored verb on the tarring floor.
  link("D2_BEAM_E", "D2_FLOOR_MID", "DROP", "FAST", "CHAIN_DROP", {
    speedMps: 2.3,
    note: "5.2m straight to the floor beside the night man. It is a roll, it is the loudest thing in the building, and it saves four seconds by cutting out the capstan, the stretcher frame and the tarring partition.",
  }),
  link("D2_FLOOR_MID", "D2_STAGE", "RUN", "FAST", "STEP_UP", {
    note: "Straight up onto the laying stage and east to the door. This is what the four seconds buy, and it is the only stretch of the interior that is walked in a straight line.",
  }),

  // The tarring floor, walked back east. This is the guaranteed line: the
  // section is built around SLIDE, so the slide cannot live on the shortcut.
  link("D2_FLOOR_W", "D2_VAULT_IN", "RUN", "SAFE", "RUN"),
  link("D2_VAULT_IN", "D2_VAULT_OUT", "VAULT", "SAFE", "VAULT", {
    ignore: ["ROPE_CAPSTAN"],
  }),
  link("D2_VAULT_OUT", "D2_SLIDE_IN", "RUN", "SAFE", "RUN"),
  link("D2_SLIDE_IN", "D2_SLIDE_OUT", "DUCK_UNDER", "SAFE", "SLIDE", {
    ignore: ["STRETCHER_FRAME"],
    note: "Under the stretcher frame at 1.25m of headroom. The only slide in the mission that is not optional.",
  }),
  link("D2_SLIDE_OUT", "D2_OVER_IN", "RUN", "SAFE", "RUN"),
  link("D2_OVER_IN", "D2_OVER_OUT", "CLIMB", "SAFE", "CLIMB_OVER", {
    ignore: ["TAR_PARTITION"],
    note: "Over the tarring partition. Its top is 0.5m deep, under the 0.75m a body needs, so it is a climb-over and not a mantle.",
  }),
  link("D2_OVER_OUT", "D2_STAGE", "RUN", "SAFE", "STEP_UP"),
  link("D2_STAGE", "D2_DOOR", "DROP", "SAFE", "CHAIN_DROP", { speedMps: 2.3 }),
  link("D2_DOOR", "D2_OUTSIDE", "RUN", "SAFE", "RUN"),

  // -- the sustained climb up the south face --------------------------------
  link("D2_OUTSIDE", "E_BUTTRESS", "CLIMB", "SAFE", "CLIMB", {
    ignore: ["HOLLIS_BUTTRESS"],
  }),
  link("E_BUTTRESS", "E_LEANTO", "CLIMB", "SAFE", "CLIMB", {
    ignore: ["HOLLIS_MEETING"],
  }),
  link("E_LEANTO", "E_MEETING_S", "CLIMB", "SAFE", "CLIMB", {
    ignore: ["HOLLIS_MEETING"],
  }),
  link("E_MEETING_S", "E_GAMBREL_S", "RUN", "SAFE", "RUN"),
  // The west end of the same roof. It used to be reached by the Orange Street
  // leg, which now lands on the ridge instead; without this the node and the
  // climb authored at it would be content nothing can get to.
  link("E_MEETING_S", "D_MEETING_ROOF", "RUN", "SAFE", "RUN"),
  link("E_GAMBREL_S", "E_RIDGE_W", "CLIMB", "SAFE", "CLIMB", {
    ignore: ["HOLLIS_MEETING"],
    note: "Sixth and last hold of the south-face climb. From the ropewalk floor to the steeple gallery is 15.8m of pure vertical in six moves, which is a different beat from every horizontal metre before it.",
  }),
  link("E_RIDGE_W", "E_RIDGE", "RUN", "SAFE", "RUN"),
];
