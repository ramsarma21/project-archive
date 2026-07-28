// B2 — Dock Square, before dawn. Verb: BLEND, with light as the second answer.
//
// This is the section where rooftops are not the answer. The square is open,
// the buildings around it are set back behind a covered walk too low and too
// short to run, and the only ways across are through the throng or round the
// dark arcade. It is street level, among people, at walking pace, and it is
// deliberately a different texture from the ninety seconds of roof either side.
//
// Boston at first light on 14 August was already gathering — people had been
// coming to look at the effigy since sunrise. Vanishing into a market crowd is
// not a videogame conceit here; it is what the job actually looked like.
//
// Two concealments, two costs:
//
//   the throng   full break once the blend completes, but it takes 0.7s and a
//                watcher inside 6m who never lost sight of you watched you walk
//                in and is not fooled. So the crowd only works if you break his
//                sightline FIRST — behind the well, a cart, the arcade mouth.
//   the arcade   no ramp-in and no pierce rule, but only a 55% reduction, and
//                the sentry is posted in it.

import { deck, prop, rect, soffit, structure } from "../authoring.js";
import { BAND } from "../envelope.js";
import type { DeckSpec, LightVolume, MassSpec } from "../types.js";

const masses: MassSpec[] = [];
const decks: DeckSpec[] = [];

function building(opts: Parameters<typeof structure>[0]): void {
  const built = structure(opts);
  masses.push(built.mass);
  if (built.deck) decks.push(built.deck);
}

export const DOCK_SQUARE = rect(24, 46, 4, 22);

// The square is closed on three sides. Nothing here has a walkable roof that
// leads anywhere: the high line genuinely ends at the Shambles.
building({
  id: "FANEUIL_ROW",
  section: "B2_THRONG",
  asset: "bldg-row-brick-a",
  rect: rect(24, 46, 22, 30),
  roofY: BAND.MID_ROOF,
  walkableRoof: false,
  tags: ["south-row", "square"],
  note: "The market row closing Dock Square. Roof deliberately unreachable.",
});

building({
  id: "DOCK_ROW_E",
  section: "B2_THRONG",
  asset: "bldg-row-clapboard-c",
  rect: rect(46, 54, 12, 26),
  roofY: BAND.LOW_ROOF,
  walkableRoof: false,
  tags: ["square"],
});

// The covered walk down the east side: unlit, sheltered, and watched.
masses.push(
  soffit({
    id: "ARCADE_ROOF",
    section: "B2_THRONG",
    asset: "market-awning",
    rect: rect(41.6, 46.0, 5.0, 22.0),
    baseY: 3.4,
    thickness: 0.4,
    tags: ["arcade", "dark"],
    note: "Solid, so it breaks a sightline from the roofs as well as from the square. Nothing stands on it; there is no roof answer here.",
  }),
);

// The colonnade.
//
// Two piers, one at each end, made the arcade a corridor with a dark factor
// and nothing else in it: seventeen metres in which the shipped `covered` term
// had nothing to be true about, so the only thing the route could spend here was
// the 0.45 on the light. A covered walk is a ROW of piers, and a row is what
// turns walking down it into a sequence of half-seen moments — screened from the
// square between one pier and the next, open in the bays between.
//
// 1.0m of pier and 2.6m of bay, which is a colonnade's own proportion and also
// what leaves the walk passable: the piers stand on the open west side, so the
// 3.8m east of them is clear lane.
//
// The two end piers keep their original ids because the asset pipeline's hull
// manifest names them.
// The four new bays are 0.6 x 3.4 x 1.0, which is a box the manifest already
// carries, so the colonnade costs the art pipeline nothing.
// Every bay is 1.0m deep because that is what the pier is. ARCADE_PIER_S was
// 1.2m, and `service-wall-end` being 0.6 x 3.4 x 1.0 the contain-fit drew it 1.0m
// into a 1.2m box — the one pier in six standing 0.2m short of its own collision,
// with the shortfall split as a 0.1m gap at each end of a colonnade whose whole
// job is to read as a rhythm.
const ARCADE_PIERS: Array<[string, number, number]> = [
  ["ARCADE_PIER_N", 5.0, 6.0],
  ["ARCADE_PIER_1", 8.6, 9.6],
  ["ARCADE_PIER_2", 11.4, 12.4],
  ["ARCADE_PIER_3", 15.0, 16.0],
  ["ARCADE_PIER_4", 17.8, 18.8],
  ["ARCADE_PIER_S", 20.8, 21.8],
];
ARCADE_PIERS.forEach(([id, minZ, maxZ]) => {
  masses.push(
    prop({
      id,
      section: "B2_THRONG",
      asset: "service-wall-end",
      rect: rect(41.6, 42.2, minZ, maxZ),
      topY: 3.4,
      landable: false,
      tags: ["arcade", "cover"],
    }),
  );
});

// The market's own goods, left in the walk overnight, and the reason hard cover
// is worth anything in this section.
//
// Both are placed NORTH of the sentry on purpose. He is posted at z=13.0 facing
// north with a 24-degree cone and a 30-degree sweep, so he can never look south
// of his own post — everything between the arcade's south mouth and his back is
// free, and the whole price of the dark route is the twelve metres past him. So
// that is where the cover goes.
//
// The two heights are the point. Casks at 1.10m sit above a standing chest at
// 1.12m and below a crouched one at 0.71m, so the same stack of barrels is
// partial cover to a body walking past it and a complete break to one that drops
// behind it. The crates at 1.90m break a standing sightline outright when the
// player is squarely behind them and screen the lower silhouette when they are
// not, which is the state `covered` exists to name.
masses.push(
  prop({
    id: "ARCADE_CASKS",
    section: "B2_THRONG",
    asset: "barrel-group",
    rect: rect(43.0, 44.8, 10.6, 12.2),
    topY: 1.1,
    landable: false,
    tags: ["arcade", "cover", "mid"],
    note: "Chest-high hogsheads straddling the walk, four metres inside the sentry's cone. Standing, they take your legs; crouched, they take all of you.",
  }),
  prop({
    id: "ARCADE_CRATES_N",
    section: "B2_THRONG",
    asset: "crate-stack",
    rect: rect(42.6, 44.4, 7.8, 9.4),
    topY: 1.9,
    landable: false,
    tags: ["arcade", "cover", "high"],
    note: "Head-high, and not landable: this is cover, not footing. Standing on it would put you inside the arcade roof, and there is no roof answer in this section.",
  }),
  prop({
    id: "ARCADE_STOCK_S",
    section: "B2_THRONG",
    asset: "crate-stack",
    rect: rect(42.4, 44.0, 16.2, 17.8),
    topY: 1.9,
    landable: false,
    tags: ["arcade", "cover", "high"],
    note: "South of the sentry, where he cannot look. It narrows the walk rather than hiding anything, which is what makes the approach feel like the dangerous part before it is.",
  }),
);

// Sightline breakers at the crowd's edge. These are the whole reason the blend
// is a tactic instead of a button: you break contact behind one of them, then
// walk in, and the pierce rule never fires.
masses.push(
  prop({
    id: "DOCK_WELL",
    section: "B2_THRONG",
    asset: "well-pump",
    rect: rect(28.6, 30.4, 9.4, 11.2),
    topY: 1.9,
    // Not landable: a town pump is not footing. The mesh is a tall, narrow pump
    // (0.93 x 1.90 x 1.09 as placed) whose only flat horizontal surface is the
    // trough at 0.57m; there is nothing to stand on at the 1.90m top, and nothing
    // in the route stands here — B2_WELL is a ground node beside it, not on it.
    // The 1.90m top was `prop()`'s default `landable: true` misapplied to cover,
    // the same correction the arcade casks two entries up already carry. Its job
    // is sight-break/blend-entry, which `coverAt` measures off the blocker
    // regardless of landable, so this changes nothing the pump was doing.
    landable: false,
    tags: ["sight-break", "blend-entry"],
    note: "The town pump. Chest-high and solid: the sightline break that lets the blend take.",
  }),
  prop({
    id: "DOCK_CART_W",
    section: "B2_THRONG",
    asset: "hay-cart",
    rect: rect(24.4, 27.0, 13.0, 15.2),
    topY: 2.2,
    tags: ["sight-break", "blend-entry"],
  }),
  prop({
    id: "DOCK_CART_E",
    section: "B2_THRONG",
    asset: "hand-cart",
    rect: rect(37.4, 39.8, 7.2, 8.8),
    topY: BAND.CART,
    tags: ["sight-break"],
  }),
  prop({
    id: "DOCK_CRESSET",
    section: "B2_THRONG",
    asset: "protest-torch",
    rect: rect(34.6, 35.4, 9.4, 10.2),
    topY: 2.4,
    landable: false,
    tags: ["light-source"],
    note: "The market cresset. It is why the middle of the square is the lit route and the arcade is the dark one.",
  }),
  prop({
    id: "DOCK_STALLS",
    section: "B2_THRONG",
    asset: "market-stall",
    rect: rect(31.0, 33.6, 17.6, 19.6),
    topY: BAND.STACK,
    tags: ["sight-break"],
  }),
  // The one thing to perform between the stall gap and the Town House.
  //
  // Twenty-one seconds of this mission used to contain no traversal verb at all
  // — the whole of the Shambles exit, the crossing, and the walk to the foot of
  // the scaffold — and fourteen of those seconds are authored at 2.3 m/s because
  // the blend will not hold above 2.4. Dock Square is dense in stealth decisions
  // and was empty of movement, and the second of those is the one a player feels.
  //
  // A vault is the smallest possible answer: 1.10m on every face, which is inside
  // the vault envelope in height and depth both, so it reads as the gaol barrels
  // the player already vaulted in the Shambles rather than as a new rule.
  prop({
    id: "DOCK_BARRELS",
    section: "B2_THRONG",
    asset: "barrel-group",
    rect: rect(42.05, 43.15, 5.95, 7.05),
    topY: BAND.BARREL,
    tags: ["vault"],
    note: "Market barrels left on the square overnight, straddling the line out of the north-east corner. The exit is a vault instead of four more metres of walking.",
  }),
  // Second verb, and it is inside the crossing rather than at the end of it: a
  // stall's tie beam over the crowd lane, underside at 1.20m. Same numbers as
  // PASSAGE_HOIST eight metres back in the Shambles, which is the point — the
  // slide is a verb the player has already been taught, restated where they are
  // walking at half speed with nothing to do.
  //
  // It sits on the blend's own southward bulge and nowhere else. Further
  // north-west — over the middle of the square — it would also stand in the
  // sprint line across the throng and under the arc off the stall canopy, and
  // taking two authored lines away to add a verb to a third is not a trade.
  soffit({
    id: "DOCK_STALL_BEAM",
    section: "B2_THRONG",
    asset: "duck-beam-frame",
    rect: rect(34.2, 36.0, 17.0, 18.2),
    baseY: 1.2,
    thickness: 0.9,
    tags: ["duck", "crowd-lane"],
    note: "The beam the market's awnings are guyed to, straight across the throng's own line. A standing body does not fit and a crouched one does not have to stop, so the crossing keeps its walking pace and stops being a straight line.",
  }),
  // A low kerb round the pump yard: half a metre, absorbed at a run. It exists
  // to give STEP_UP somewhere to happen at street level, and to make the pump
  // yard read as a place rather than a patch of ground.
  prop({
    id: "PUMP_KERB",
    section: "B2_THRONG",
    asset: "yard-kerb-stone",
    rect: rect(26.8, 32.4, 7.2, 8.4),
    topY: 0.34,
    tags: ["step-up"],
    note: "0.34m: inside STEP_UP going up and inside the free step-down coming back, so a sprint crosses it without a pause and it costs nothing but reads as something.",
  }),
);

// The one place in the square you can get off the ground, and it goes nowhere.
decks.push(
  deck({
    id: "DOCK_STALL_CANOPY",
    section: "B2_THRONG",
    asset: "market-awning",
    rect: rect(30.6, 34.0, 17.2, 20.0),
    y: BAND.STALL_ROOF,
    carriedBy: ["DOCK_STALLS"],
    tags: ["awning"],
    note: "A vantage, not a route. Standing here is the most visible thing you can do in this section.",
  }),
);

export const DOCK_LIGHT: LightVolume[] = [
  {
    id: "LIGHT_DOCK_SQUARE",
    section: "B2_THRONG",
    rect: rect(28, 42, 8, 20),
    level: 0.95,
    note: "Cresset light over the market floor. The crowd is here, and so is the light.",
  },
  {
    id: "LIGHT_DOCK_ARCADE",
    section: "B2_THRONG",
    rect: rect(41.6, 46.0, 5.0, 22.0),
    level: 0.08,
    note: "Under the arcade. A 0.45 dark factor makes this the quiet way across, at the price of walking past the sentry.",
  },
  {
    id: "LIGHT_DOCK_NW",
    section: "B2_THRONG",
    rect: rect(24, 33, 4, 9),
    level: 0.3,
    note: "The unlit corner you enter from, which is why the first sightline break is free.",
  },
];

export const DOCK_SQUARE_GEOMETRY = { masses, decks } as const;
