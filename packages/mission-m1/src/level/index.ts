import type { MissionLevel, SectionSpec } from "../types.js";
import { CLIMBS } from "./climbs.js";
import { GRIPS, LADDERS } from "./ladders.js";
import { GEOMETRY, LEVEL_BOUNDS } from "./geometry.js";
import { LINKS, NODES } from "./route.js";
import {
  BLEND,
  CATCHES,
  DIVERSIONS,
  LIGHT,
  PATROLS,
  PRECISION,
} from "./opposition.js";
import { DOCK_LIGHT, DOCK_SQUARE_GEOMETRY } from "./dockSquare.js";
import { MERCHANT_GEOMETRY } from "./merchant.js";
import { ROPEWALK_GEOMETRY, ROPEWALK_LIGHT } from "./ropewalk.js";
import { WHARF_GEOMETRY, WHARF_LIGHT } from "./wharf.js";
import { LINKS_2, NODES_2 } from "./route2.js";
import { WHARF_CLIMBS, WHARF_LINKS, WHARF_NODES } from "./wharfRoute.js";
import { ARENA } from "./duelArena.js";

export const SECTIONS: SectionSpec[] = [
  {
    id: "A_LEADS",
    rerouteBudgetS: 0,
    title: "Off the leads",
    builtAround: "CHAIN_DROP",
    street: "Queen Street",
    budgetS: 22,
    intent:
      "Open on height. The tutorial is the descent: hold forward off the eaves and the geometry catches you, but the speed you carry off the lip decides which tier catches you, so the first eight seconds already teach commitment.",
  },
  {
    id: "B_SHAMBLES",
    rerouteBudgetS: 4,
    title: "The shambles",
    builtAround: "BLEND",
    street: "Cornhill",
    budgetS: 26,
    intent:
      "Two cones, three heights, one crowd. Blending is slower and safe, the canopies are faster and watched, and a thrown tankard reassigns which is which.",
  },
  {
    id: "B2_THRONG",
    rerouteBudgetS: 9,
    title: "Dock Square",
    builtAround: "BLEND",
    street: "Dock Square",
    budgetS: 32,
    intent:
      "The section where height is not the answer. Nothing above the square goes anywhere, so the two ways across are the throng and the dark arcade, and they fail differently: the crowd needs a broken sightline first, the arcade only halves you and has a sentry in it.",
  },
  {
    id: "C_ASCENT",
    rerouteBudgetS: 8,
    title: "The Town House",
    builtAround: "CLIMB",
    street: "the head of King Street",
    budgetS: 40,
    intent:
      "A building standing in the middle of the road. Spiral it twice to the tower, get read by the Old Brick watch halfway up, and top out somewhere you can see the whole rest of the mission from.",
  },
  {
    id: "D_ROOFLINE",
    rerouteBudgetS: 4,
    title: "The Orange Street roofline",
    builtAround: "LEAP",
    street: "Marlborough into Newbury",
    budgetS: 12,
    intent:
      "Everything from here is downhill. The south roofs run high and fast over chimney vaults; crossing to the north roofs costs 5.3m of height and buys you the constable's blind side.",
  },
  {
    id: "D2_ROPEWALK",
    rerouteBudgetS: 5,
    title: "Through the ropewalk",
    builtAround: "SLIDE",
    street: "the ropewalk off Orange Street",
    budgetS: 30,
    intent:
      "Through a building instead of over one. A tie beam in the dark, then a floor of slides and partitions, with the same loud-or-quiet choice section A taught — one 5.2m roll the night man hears, or three run-offs down the bales that he does not.",
  },
  {
    id: "E_LEAP",
    rerouteBudgetS: 0,
    title: "The leap of faith",
    builtAround: "LEAP_OF_FAITH",
    street: "Orange Street at Hollis",
    budgetS: 18,
    intent:
      "The signature. Off the steeple gallery into the crown of the Liberty Tree — the leap and the objective are the same object, so the biggest move in the mission is also the arrival.",
  },
  {
    id: "F_TREE",
    rerouteBudgetS: 2,
    title: "Nailed to the tree",
    builtAround: "PRECISION",
    street: "Essex and Orange",
    budgetS: 18,
    intent:
      "Six hammer strokes in rhythm, eight metres up, beside the effigy the sheriff did not dare cut down, then off the boughs and into the yard before the constable reaches the board.",
  },
  {
    id: "G_YARD",
    rerouteBudgetS: 0,
    title: "The rope-walk yard",
    builtAround: "RUN",
    street: "off Essex Street",
    budgetS: 0,
    intent:
      "Twelve by thirteen metres of walled yard with graded cover: the duel's six line-of-sight breaks are places, not scripts.",
  },
];

export const M1_EFFIGY_RUN: MissionLevel = {
  id: "PA.SEA01.CH02.BOSTON.MD01.EFFIGY_RUN.v1",
  title: "The Effigy Run",
  date: "1765-08-14",
  bounds: LEVEL_BOUNDS,
  missionClockS: 180,
  sections: SECTIONS,
  masses: [
    ...GEOMETRY.masses,
    ...WHARF_GEOMETRY.masses,
    ...DOCK_SQUARE_GEOMETRY.masses,
    ...MERCHANT_GEOMETRY.masses,
    ...ROPEWALK_GEOMETRY.masses,
  ],
  decks: [
    ...GEOMETRY.decks,
    ...WHARF_GEOMETRY.decks,
    ...DOCK_SQUARE_GEOMETRY.decks,
    ...MERCHANT_GEOMETRY.decks,
    ...ROPEWALK_GEOMETRY.decks,
  ],
  ramps: [...GEOMETRY.ramps],
  climbs: [...CLIMBS, ...WHARF_CLIMBS],
  ladders: LADDERS,
  grips: GRIPS,
  nodes: [...NODES, ...WHARF_NODES, ...NODES_2],
  links: [...LINKS, ...WHARF_LINKS, ...LINKS_2],
  patrols: PATROLS,
  diversions: DIVERSIONS,
  blend: BLEND,
  light: [...LIGHT, ...WHARF_LIGHT, ...DOCK_LIGHT, ...ROPEWALK_LIGHT],
  catches: CATCHES,
  precision: PRECISION,
  arena: ARENA,
  startNode: "A_START",
  postNode: "F_POST",
  arenaNode: "G_SPAWN",
};
