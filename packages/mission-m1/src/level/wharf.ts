// M1 — the DEAD WHARF (beat 1), the run's one authored ground crossing.
//
// The closure made physical. Boston's port has been shut eight months: a wide
// flat dock at the water's edge with tall rigged ships moored idle over open
// water, cargo stacked and rotting, a gibbet-crane standing unused, nothing
// moving. The player comes DOWN off the printshop leads onto the closed port,
// crosses it in the open (the one EXPOSED beat on the west end), and climbs back
// up the far side onto the Shambles high line.
//
// Anchored on the owner's real in-game capture
// (assets/reference/harbour-cutscene/real-harbour-ingame.png), plan A.6.
//
// Axis convention (geometry.ts): +x east, +z south, y up. The wharf sits WEST
// and SOUTH of the printshop, on the water. Open harbour water lies south and
// south-west — the World-Design-Bible exclusion band — so no land or backdrop
// mass crosses into it; the ships are VESSELS on the water, not land.
//
// TRAVERSAL-FIRST. The descent/ascent chain is drawn == collision: every surface
// the covert line stands on is either a warehouse-shed ROOF (a real building
// roof drawn to its own top) or a crate-mound (a BLOCK-filled prop whose drawn
// top is its collider top). No route stands on an un-drawn "gallery" ledge. The
// wharf-warehouse sheds are built LOW (roof at 5.35) precisely so their roofs ARE
// the chain step, rather than tall backdrop with an invisible ledge partway up.
//
// The crossing itself is the level's implicit y0 GROUND plane (LEVEL_BOUNDS was
// widened west to x -22 to admit it), so it is walked at y0 and reads EXPOSED by
// the level's convention (open ground = exposed). Descent NW off the printshop,
// ascent SE onto the Shambles shed.

import { BAND } from "../envelope.js";
import { prop, rect, structure } from "../authoring.js";
import type { DeckSpec, LightVolume, MassSpec } from "../types.js";

const masses: MassSpec[] = [];
const decks: DeckSpec[] = [];

// A wharf shed with a WALKABLE low roof: the roof deck is a real drawn surface
// (the shed mesh is drawn to its own top, oversailed by the jetty) that the
// covert chain stands on. Tagged "wharf-roof" not "roof" so the roof-oversail
// test only polices the town's leads, while these still oversail by the jetty
// (structure() applies it) so a body cannot clip off the lip.
function shed(opts: {
  id: string;
  asset: string;
  rect: ReturnType<typeof rect>;
  roofY: number;
  note?: string;
}): DeckSpec {
  const built = structure({
    id: opts.id,
    section: "A_LEADS",
    asset: opts.asset,
    rect: opts.rect,
    roofY: opts.roofY,
    tags: ["waterfront"],
    ...(opts.note ? { note: opts.note } : {}),
  });
  masses.push(built.mass);
  // Re-tag the roof deck: it is a wharf shed roof (chain footing), not a town
  // leads, so the "every roof deck oversails" test (roof-tagged only) leaves it
  // to the chain's own verifyLink while the jetty oversail is still present.
  const roof: DeckSpec = { ...built.deck!, tags: ["wharf-roof", "waterfront"] };
  decks.push(roof);
  return roof;
}

// ---------------------------------------------------------------------------
// The descent shed (NW), hard against the printshop's south-west corner: the
// player runs off the printshop leads (7.1) onto its roof (5.35) — the first
// authored ground beat begins here. Its roof is the descent's first footing.
// ---------------------------------------------------------------------------

// Roof deck id: WHARF_WAREHOUSE_A__ROOF (the descent's first footing).
shed({
  id: "WHARF_WAREHOUSE_A",
  asset: "bldg-warehouse-wharf-a",
  rect: rect(-10, 0, -2, 6),
  roofY: BAND.PENTICE, // 5.35 — the descent step off the printshop leads
  note: "Waterfront warehouse at the wharf's NW, against the printshop's SW corner. Its low roof is the first step of the descent onto the closed port.",
});

// ---------------------------------------------------------------------------
// The ascent shed (E), hard against the Shambles market shed's west end: its
// roof (5.35) is a STEP_UP (0.25) below the shed roof (5.6), so the climb back
// up off the port tops out onto the Shambles high line.
// ---------------------------------------------------------------------------

// Roof deck id: WHARF_WAREHOUSE_B__ROOF (the ascent's TOP MANTLE target).
//
// RE-POINTED 31-Jul FROM 5.35 TO 4.30, WHICH IS WHERE THE MESH ACTUALLY IS. The
// pending-regen note that stood here said the mesh drew ~1.8 m below its 5.35
// box and that a regen would deliver a gallery at the box. The regen came
// (a72015e) and it did not: measured off the placed GLB, this asset tops out at
// 4.57 and its one real plateau is 20.6 m2 of FLAT ROOF at 4.30 spanning the
// whole footprint — nothing at 5.35 at all. The debt entry was written against a
// promise rather than a delivery, and the affordance gate has been carrying it
// as SEVERE (0% of footprint at plane) ever since.
//
// 4.30 is not a compromise, it is the better surface. 20.6 m2 of flat roof is a
// traversal surface; a declared plane with no mesh at it is a body walking on
// air, which is the whole class this rebuild exists to end. The ascent re-masses
// cleanly around it and nothing is invented: cargo 3.50 -> roof 4.30 is 0.80 m,
// and roof 4.30 -> Shambles shed 5.60 is 1.30 m. Both are mantles, where the old
// numbers were 1.85 and 0.25.
shed({
  id: "WHARF_WAREHOUSE_B",
  asset: "bldg-warehouse-wharf-b",
  rect: rect(-2, 2, 6, 14),
  roofY: 4.3, // measured: the drawn flat roof, 20.6 m2 across the full footprint
  note: "The warehouse at the wharf's E, abutting the Shambles shed. Its flat roof at 4.30 is the top of the cargo ascent and the mantle onto the market shed roof.",
});

// ---------------------------------------------------------------------------
// The cargo footings of the chain: two crate-mounds (BLOCK-filled, drawn == the
// collider top) — one for the descent (shed roof 5.35 -> mound 2.35 -> deck 0),
// one for the ascent (deck 0 -> mound 2.35 -> shed roof 5.35).
// ---------------------------------------------------------------------------

masses.push(
  prop({
    id: "WHARF_DESC_MOUND",
    section: "A_LEADS",
    asset: "crate-mound",
    rect: rect(-8, -5, 7, 10),
    topY: 2.35,
    tags: ["waterfront", "cargo", "chain"],
    note: "Descent footing: hang-drop onto it off the warehouse roof, then off it to the deck.",
  }),
  // Ascent = a MANTLE STAIRCASE (no ladders, no tall climb): deck 0 → cargo 1.64
  // → cargo 3.5 → warehouse loading gallery 5.35 → Shambles shed 5.6, each hop a
  // ≤1.9 m mantle onto a standable top. The two cargo steps are crates at their
  // TRUE mesh size (natural aspect), so the drawn crate IS the collider. The last
  // mantle tops onto the warehouse's 5.35 loading gallery — its mesh is being
  // regenerated with a real oversailed gallery at that box (see WHARF_WAREHOUSE_B).
  prop({
    id: "WHARF_ASC_STEP1",
    section: "A_LEADS",
    asset: "crate-stack",
    rect: rect(-5.3, -3.4, 9.85, 11.4), // ~1.9 x 1.55, crate-stack's natural aspect
    topY: 1.64, // crate-stack's natural height → drawn == collision
    tags: ["waterfront", "cargo", "chain"],
    note: "First mantle off the deck: a crate stack at its true size (drawn == collision).",
  }),
  prop({
    id: "WHARF_ASC_STEP2",
    section: "A_LEADS",
    asset: "crate-mound",
    rect: rect(-4.0, -2.1, 9.75, 11.65), // ~1.9 x 1.9, crate-mound's natural aspect
    baseY: 1.64, // stacked on STEP1
    topY: 3.5, // + crate-mound's natural 1.86 height → drawn == collision
    tags: ["waterfront", "cargo", "chain"],
    note: "Second mantle, a mound stacked on the first: 3.5 m, one mantle under the warehouse's 5.35 loading gallery.",
  }),
);

// ---------------------------------------------------------------------------
// The gibbet-crane and idle cargo left standing on the closed port — dressing,
// clear of the crossing lane down the deck's middle.
// ---------------------------------------------------------------------------

masses.push(
  prop({
    id: "WHARF_CRANE",
    section: "A_LEADS",
    asset: "timber-crane",
    rect: rect(-15, -12, 10, 13),
    topY: 6.5,
    landable: false,
    tags: ["waterfront", "crane"],
    note: "The wharf gibbet-crane, idle over the closed port.",
  }),
  prop({
    id: "WHARF_CRATE_STACK",
    section: "A_LEADS",
    asset: "crate-stack",
    rect: rect(-13, -11, 14, 16),
    topY: BAND.STACK,
    landable: false,
    tags: ["waterfront", "cargo"],
    note: "Cargo left standing on the shut port.",
  }),
  prop({
    id: "WHARF_BARRELS_A",
    section: "A_LEADS",
    asset: "barrel-group",
    rect: rect(-9.1, -8.0, 12.6, 13.7),
    topY: BAND.BARREL,
    landable: false,
    tags: ["waterfront", "cargo"],
    note: "Empty. Nothing to fill them with while the port is shut.",
  }),
  prop({
    id: "WHARF_BARRELS_B",
    section: "A_LEADS",
    asset: "barrel-group",
    rect: rect(-11.2, -10.1, 10.6, 11.7),
    topY: BAND.BARREL,
    landable: false,
    tags: ["waterfront", "cargo"],
  }),
  prop({
    id: "WHARF_ROPE_COIL",
    section: "A_LEADS",
    asset: "rope-coil-large",
    rect: rect(-14, -12, 16, 18),
    topY: 0.75,
    landable: false,
    tags: ["waterfront", "cargo"],
  }),
  prop({
    id: "WHARF_CARGO_NET",
    section: "A_LEADS",
    asset: "cargo-net-bundle",
    rect: rect(-11, -8, 16, 19),
    topY: 1.1,
    landable: false,
    tags: ["waterfront", "cargo"],
  }),
  prop({
    id: "WHARF_FISH_FLAKES",
    section: "A_LEADS",
    asset: "fish-flakes-rack",
    rect: rect(-18, -15, 8, 12),
    topY: 2.0,
    landable: false,
    tags: ["waterfront", "dressing"],
    note: "Split-cod drying racks, empty. The fishery is shut with the port.",
  }),
);

// The water edge: bollards and a rope rail along the seaward (south) lip.
[-16, -12, -8, -4].forEach((x, index) => {
  masses.push(
    prop({
      id: `WHARF_BOLLARD_${index}`,
      section: "A_LEADS",
      asset: "bollard",
      rect: rect(x - 0.25, x + 0.25, 18.7, 19.2),
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
      rect: rect(x - 1.9, x + 1.9, 18.85, 19.05),
      topY: 1.0,
      landable: false,
      tags: ["waterfront", "edge-guard"],
    }),
  );
});

// ---------------------------------------------------------------------------
// The moored ships, idle over open water on the S/SW edge — the shut port made
// legible. Non-standable dressing; the player never boards them. Fanned across
// the harbour, clear of the deck and of one another, the two tall hulls against
// the sky.
//
// EACH BOX IS THE DRAWN HULL'S OWN AABB, and it must stay that way. These three
// were authored to the height a rigged ship LOOKS (brig 18) rather than the
// height its mesh draws (8.73), so the solver carried 9.3 m of empty air above
// the masthead and 1.8 m astern — the invisible-wall class, and the only three
// `check-world-collision` failures in the level. Measured off the placed GLBs:
//
//   brig  drawn 14.000 x 8.733 x 4.197   was boxed 14 x 18 x 6   (29% fill)
//   snow  drawn 14.000 x 9.027 x 4.304   was boxed 14 x 15 x 5   (35% fill)
//   sloop drawn 14.000 x 9.849 x 2.747   was boxed 14 x 14 x 4   (47% fill)
//
// THE TRAP, if you retune these: a prop contain-fits UNIFORMLY, so the box
// decides the drawn size. x is the binding axis on all three (drawn x sits
// exactly on the box), which is the only reason shrinking y and z leaves the
// ships drawn where they are. Each y/z below is the measured extent rounded UP
// to the next 0.05 m, so its ratio stays looser than x's and x keeps binding.
// Round one DOWN and that axis binds instead: the whole ship shrinks, and the
// hull no longer fills the box you just authored for it.
//
// The z-centres are unchanged, so every hull is drawn exactly where it was.
// ---------------------------------------------------------------------------

masses.push(
  prop({
    id: "WHARF_SHIP_BRIG",
    section: "A_LEADS",
    asset: "ship-brig-hero",
    rect: rect(-18, -4, 22.875, 27.125), // z 4.25 about the old centre 25
    topY: 8.8, // drawn 8.733
    landable: false,
    tags: ["waterfront", "ship"],
    note: "The hero brig, moored SW over open water. Rigged and idle — the dead harbour.",
  }),
  prop({
    id: "WHARF_SHIP_SNOW",
    section: "A_LEADS",
    asset: "ship-snow-background",
    rect: rect(-22, -8, 28.325, 32.675), // z 4.35 about the old centre 30.5
    topY: 9.1, // drawn 9.027
    landable: false,
    tags: ["waterfront", "ship"],
    note: "The snow moored further out behind the brig.",
  }),
  prop({
    id: "WHARF_SHIP_SLOOP",
    section: "A_LEADS",
    asset: "ship-sloop",
    rect: rect(0, 14, 22.6, 25.4), // z 2.80 about the old centre 24
    topY: 9.9, // drawn 9.849
    landable: false,
    tags: ["waterfront", "ship"],
    note: "A sloop moored to the S.",
  }),
  prop({
    id: "WHARF_ROWBOAT",
    section: "A_LEADS",
    asset: "rowboat",
    rect: rect(-6, -3, 17, 19),
    topY: 1.0,
    landable: false,
    tags: ["waterfront", "ship"],
  }),
  prop({
    id: "WHARF_BUOY",
    section: "A_LEADS",
    asset: "buoy",
    rect: rect(-14, -13, 20, 21),
    topY: 0.8,
    landable: false,
    tags: ["waterfront", "ship"],
  }),
);

// The harbour is a shut port before dawn: dim, no lamps working. One low light
// volume over the deck so the crossing is legible without being lit like the
// market; the open water beyond keeps the level's ambient dark.
export const WHARF_LIGHT: LightVolume[] = [
  {
    id: "LIGHT_WHARF",
    section: "A_LEADS",
    rect: rect(-20, 2, -2, 18),
    level: 0.34,
    note: "Pre-dawn on the closed wharf. Enough to read the crossing, not the lit market floor.",
  },
];

export const WHARF_GEOMETRY = { masses, decks } as const;
