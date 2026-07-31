// M1 — the DEAD WHARF (beat 1), the run's one authored ground crossing.
//
// The closure made physical. Boston's port has been shut eight months: a wide
// flat dock at the water's edge with tall rigged ships moored idle over open
// water, cargo stacked and rotting, a gibbet-crane and ladders standing unused,
// nothing moving. The player comes DOWN off the printshop leads onto the closed
// port, crosses it in the open (the one EXPOSED beat on the west end), and
// climbs back up the far side onto the Shambles high line.
//
// Anchored on the owner's real in-game capture
// (assets/reference/harbour-cutscene/real-harbour-ingame.png) per plan A.6: a
// laid-plank deck at water level, two tall ships to one side, foreground crate
// and barrel stacks, a timber crane and leaning ladders on the far side,
// bollards along the water edge.
//
// Axis convention (geometry.ts): +x east, +z south, y up. The wharf sits WEST
// and SOUTH of the printshop, on the water. Open harbour water lies south and
// south-west — the World-Design-Bible exclusion band — so no land or backdrop
// mass crosses into it; the ships are VESSELS on the water, not land.
//
// STAGE 1 (this file, first pass): the visible dead-wharf massing + dressing —
// warehouses, the gibbet crane, cargo stacks, ships, bollards — placed so the
// owner sees a genuinely new west end. Every wharf-kit GLB already exists on
// `main` (verified on disk); this is PLACEMENT, no asset generation. The covert
// descent/ascent CHAIN and its route links are wired in a following pass, onto
// this geometry, verified against the shipped physics.
//
// All GROUND on the wharf is the level's implicit y0 plane (LEVEL_BOUNDS was
// widened west to x -22 to admit it), so the crossing is walked at y0 and reads
// as EXPOSED by the level's convention (open street/ground = exposed).

import { BAND } from "../envelope.js";
import { deck, prop, rect, structure } from "../authoring.js";
import type { DeckSpec, LightVolume, MassSpec } from "../types.js";

const masses: MassSpec[] = [];
const decks: DeckSpec[] = [];

// A backdrop building: a solid mass with no reachable roof. The wharf warehouses
// read as skyline behind the crossing — their eaves are a band out of reach of
// the covert line (which crosses on the DECK and climbs the crane/crates), so
// they are massing, not fake route.
function backdrop(opts: {
  id: string;
  asset: string;
  rect: ReturnType<typeof rect>;
  topY: number;
  note?: string;
}): void {
  masses.push(
    structure({
      id: opts.id,
      section: "A_LEADS",
      asset: opts.asset,
      rect: opts.rect,
      roofY: opts.topY,
      walkableRoof: false,
      tags: ["waterfront"],
      ...(opts.note ? { note: opts.note } : {}),
    }).mass,
  );
}

// ---------------------------------------------------------------------------
// The warehouses on the landward (north) edge, between the town and the water.
// Their loading galleries (5.35) will carry the descent off the printshop leads
// and the ascent up onto the Shambles shed — added with the route in the next
// pass; here they stand as the massing that makes the west end a working port.
// ---------------------------------------------------------------------------

backdrop({
  id: "WHARF_WAREHOUSE_A",
  asset: "bldg-warehouse-wharf-a",
  rect: rect(-19, -5, 3, 12),
  topY: 9,
  note: "Waterfront warehouse at the wharf's NW. Its loading gallery is the descent step off the printshop leads onto the closed port.",
});
backdrop({
  id: "WHARF_WAREHOUSE_B",
  asset: "bldg-warehouse-wharf-b",
  rect: rect(-5, 2, 3, 12),
  topY: 8,
  note: "The warehouse at the wharf's E, hard against the Shambles' west end. Its gallery is the ascent step up onto the market shed roof.",
});

// ---------------------------------------------------------------------------
// The gibbet-crane and the cargo left standing on the closed port. The crate
// and mound tops are the intermediate footings of the descend/climb chain; the
// barrels, coils, nets and fish-flakes are idle dressing — the shut port, with
// nothing shipping — kept clear of the crossing lane down the deck's middle.
// ---------------------------------------------------------------------------

masses.push(
  prop({
    id: "WHARF_CRANE",
    section: "A_LEADS",
    asset: "timber-crane",
    rect: rect(-14, -11, 13, 16),
    topY: 6.5,
    landable: false,
    tags: ["waterfront", "crane"],
    note: "The wharf gibbet-crane, idle. Its cargo staging is a mid-step of the descent chain to the deck.",
  }),
  prop({
    id: "WHARF_CRATE_STACK",
    section: "A_LEADS",
    asset: "crate-stack",
    rect: rect(-11, -9, 15, 17),
    topY: BAND.STACK,
    tags: ["waterfront", "cargo"],
    note: "Cargo left standing on the closed port.",
  }),
  prop({
    id: "WHARF_CRATE_MOUND",
    section: "A_LEADS",
    asset: "crate-mound",
    rect: rect(-8, -5, 14, 17),
    topY: 2.35,
    tags: ["waterfront", "cargo"],
    note: "The mound the ascent foots on, up toward the warehouse gallery and the Shambles shed.",
  }),
  prop({
    id: "WHARF_BARRELS_A",
    section: "A_LEADS",
    asset: "barrel-group",
    rect: rect(-4.1, -3.0, 15.0, 16.1),
    topY: BAND.BARREL,
    landable: false,
    tags: ["waterfront", "cargo"],
    note: "Empty. Nothing to fill them with while the port is shut.",
  }),
  prop({
    id: "WHARF_BARRELS_B",
    section: "A_LEADS",
    asset: "barrel-group",
    rect: rect(-2.2, -1.1, 12.6, 13.7),
    topY: BAND.BARREL,
    landable: false,
    tags: ["waterfront", "cargo"],
  }),
  prop({
    id: "WHARF_ROPE_COIL",
    section: "A_LEADS",
    asset: "rope-coil-large",
    rect: rect(-7, -5, 18, 20),
    topY: 0.75,
    landable: false,
    tags: ["waterfront", "cargo"],
  }),
  prop({
    id: "WHARF_CARGO_NET",
    section: "A_LEADS",
    asset: "cargo-net-bundle",
    rect: rect(-13, -10, 17, 20),
    topY: 1.1,
    landable: false,
    tags: ["waterfront", "cargo"],
  }),
  prop({
    id: "WHARF_FISH_FLAKES",
    section: "A_LEADS",
    asset: "fish-flakes-rack",
    rect: rect(-18, -15, 14, 18),
    topY: 2.0,
    landable: false,
    tags: ["waterfront", "dressing"],
    note: "Split-cod drying racks, empty. The fishery is shut with the port.",
  }),
);

// ---------------------------------------------------------------------------
// The water edge: bollards and a rope rail along the seaward (south) lip, an
// edge guard rather than footing. Non-standable.
// ---------------------------------------------------------------------------

[-16, -12, -8, -4].forEach((x, index) => {
  masses.push(
    prop({
      id: `WHARF_BOLLARD_${index}`,
      section: "A_LEADS",
      asset: "bollard",
      rect: rect(x - 0.25, x + 0.25, 19.7, 20.2),
      topY: 0.6,
      landable: false,
      tags: ["waterfront", "edge-guard"],
    }),
  );
});
[-14, -10, -6].forEach((x, index) => {
  masses.push(
    prop({
      id: `WHARF_RAIL_${index}`,
      section: "A_LEADS",
      asset: "wharf-rope-rail-straight",
      rect: rect(x - 1.9, x + 1.9, 19.85, 20.05),
      topY: 1.0,
      landable: false,
      tags: ["waterfront", "edge-guard"],
    }),
  );
});

// ---------------------------------------------------------------------------
// The moored ships, idle over open water on the S/SW edge — the shut port made
// legible. Non-standable dressing; the player never boards them. Placed clear of
// the deck crossing and of one another, fanned across the harbour so the two
// tall hulls read against the sky.
// ---------------------------------------------------------------------------

masses.push(
  prop({
    id: "WHARF_SHIP_BRIG",
    section: "A_LEADS",
    asset: "ship-brig-hero",
    rect: rect(-18, -4, 24, 30),
    topY: 18,
    landable: false,
    tags: ["waterfront", "ship"],
    note: "The hero brig, moored SW over open water. Rigged and idle — the dead harbour.",
  }),
  prop({
    id: "WHARF_SHIP_SNOW",
    section: "A_LEADS",
    asset: "ship-snow-background",
    rect: rect(-22, -8, 30, 35),
    topY: 15,
    landable: false,
    tags: ["waterfront", "ship"],
    note: "The snow moored further out behind the brig.",
  }),
  prop({
    id: "WHARF_SHIP_SLOOP",
    section: "A_LEADS",
    asset: "ship-sloop",
    rect: rect(-2, 12, 22, 26),
    topY: 14,
    landable: false,
    tags: ["waterfront", "ship"],
    note: "A sloop moored to the S.",
  }),
  prop({
    id: "WHARF_ROWBOAT",
    section: "A_LEADS",
    asset: "rowboat",
    rect: rect(-6, -3, 19, 21),
    topY: 1.0,
    landable: false,
    tags: ["waterfront", "ship"],
  }),
  prop({
    id: "WHARF_BUOY",
    section: "A_LEADS",
    asset: "buoy",
    rect: rect(-14, -13, 22, 23),
    topY: 0.8,
    landable: false,
    tags: ["waterfront", "ship"],
  }),
);

// The harbour is a shut port before dawn: dim, uncressetted, no lamps working.
// One low light volume over the deck so the crossing is legible without being
// lit like the market. The open water beyond keeps the level's ambient.
export const WHARF_LIGHT: LightVolume[] = [
  {
    id: "LIGHT_WHARF",
    section: "A_LEADS",
    rect: rect(-20, 2, 3, 20),
    level: 0.32,
    note: "Pre-dawn on the closed wharf. Enough to read the crossing, not the lit market floor.",
  },
];

export const WHARF_GEOMETRY = { masses, decks } as const;
