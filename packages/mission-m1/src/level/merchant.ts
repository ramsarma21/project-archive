// M1 — the merchant's house (Thomas), the SECOND and LAST enterable interior.
// It supersedes the sugar house on the Shambles' north row.
//
// Built the printshop way: a generated Georgian brick facade (`bldg-merchant`, via
// build_civic_facade shell mode) authored as thin perimeter WALL blockers so that
// drawn == collision, with a real OPEN UPPER WINDOW on the south face (an aperture,
// NO door) and a SOLID parlour floor at 4.0 m you drop onto from the roofline.
//
// The covert model, and why this asset rather than an int-shell: the player crosses
// the G-A plank to the eave (7.1), HANG_DROPs 3.1 m over the south lip through the
// open upper window onto the parlour floor — a drop INTO a SAFE interior, never the
// guarded ground door — and climbs back out to the eave for the G-B plank. An
// interior-only shell has no real exterior for a building read from the rooftops and
// cannot reach eave 7.1; a generated facade gives the exterior, the height, the solid
// floor/ceiling, and a drawn==collision aperture. Only the printshop and this are
// interiors; every other building on the run is a solid exterior mass.
//
// South face kept at z −3.2 so the Shambles carts/crates still back flush to it (the
// wall the penetration invariant checks CART_3 / SHAMBLES_CRATES_B against).

import { BAND, JETTY_M } from "../envelope.js";
import { deck, inflate, prop, rect } from "../authoring.js";
import type { DeckSpec, MassSpec } from "../types.js";

const masses: MassSpec[] = [];
const decks: DeckSpec[] = [];

// North-row slot vacated by the sugar house. The EAST edge stops at x 42 — west of
// the Town House scaffold approach (C_SQUARE_N x≈43, C_SCAFF_* and the scaffold at
// x 43.6..46.1): the old sugar house ended at x 41 for exactly this reason, and a
// wall past ~x 42.6 buries those C_ nodes and the B_EXIT→C_SQUARE_N run. z
// −17.2..−3.2 is the sugar house's own depth, so the south wall lands exactly where
// the Shambles carts/crates back on. 9 × 14 m, long axis N–S (the slot is only ~9 m
// wide between the gaol at x 30 and the scaffold at x 43.6).
export const MERCHANT_FOOT = rect(33, 42, -17.2, -3.2);
const WT = 0.5; // wall thickness
const EAVE = BAND.LOW_ROOF; // 7.1 — the leads / eave the planks meet
const PARLOUR = 4.0; // parlour floor: a single 3.1 m HANG_DROP under the eave
// Open upper window on the south face, centred, from the parlour floor to the eave.
const AP_X0 = 36.0;
const AP_X1 = 39.0;

masses.push(
  // North wall + main body. The roof and parlour floor are carriedBy this, and the
  // asset clusters on it, exactly as PRINTSHOP is the printshop's north wall.
  prop({
    id: "MERCHANT",
    section: "B_SHAMBLES",
    asset: "bldg-merchant",
    rect: rect(33, 42, -17.2, -17.2 + WT),
    baseY: 0,
    topY: EAVE,
    landable: false,
    tags: ["structure", "north-row", "interior-shell"],
    note: "Thomas's house — the mark whose seal the courier needs, quartered with troops. Entered covertly through the open upper window off the roofline, never the guarded ground door.",
  }),
  prop({
    id: "MERCHANT_WALL_W",
    section: "B_SHAMBLES",
    asset: "bldg-merchant",
    rect: rect(33, 33 + WT, -17.2, -3.2),
    baseY: 0,
    topY: EAVE,
    landable: false,
    tags: ["structure", "north-row", "interior-shell"],
  }),
  prop({
    id: "MERCHANT_WALL_E",
    section: "B_SHAMBLES",
    asset: "bldg-merchant",
    rect: rect(42 - WT, 42, -17.2, -3.2),
    baseY: 0,
    topY: EAVE,
    landable: false,
    tags: ["structure", "north-row", "interior-shell"],
  }),
  // South (street) wall, split around the open upper-window aperture: full-height
  // flanks, and a spandrel below the window (0..PARLOUR). The window itself
  // (PARLOUR..EAVE over x AP_X0..AP_X1) carries no blocker — it is the open hole.
  prop({
    id: "MERCHANT_WALL_S_W",
    section: "B_SHAMBLES",
    asset: "bldg-merchant",
    rect: rect(33, AP_X0, -3.2 - WT, -3.2),
    baseY: 0,
    topY: EAVE,
    landable: false,
    tags: ["structure", "north-row", "interior-shell", "shopfront"],
  }),
  prop({
    id: "MERCHANT_WALL_S_E",
    section: "B_SHAMBLES",
    asset: "bldg-merchant",
    rect: rect(AP_X1, 42, -3.2 - WT, -3.2),
    baseY: 0,
    topY: EAVE,
    landable: false,
    tags: ["structure", "north-row", "interior-shell", "shopfront"],
  }),
  prop({
    id: "MERCHANT_WALL_S_SPANDREL",
    section: "B_SHAMBLES",
    asset: "bldg-merchant",
    rect: rect(AP_X0, AP_X1, -3.2 - WT, -3.2),
    baseY: 0,
    topY: PARLOUR,
    landable: false,
    tags: ["structure", "north-row", "interior-shell", "shopfront"],
  }),
  // Parlour floor: a SOLID mezzanine at 4.0, drawn by the merchant mesh (asset
  // bldg-merchant → the balcony slab case, TOP on 4.0). Solid, not a one-way deck:
  // the sealed ground storey below is unreachable, but a solid slab keeps the
  // airborne deck-graze invariant honest regardless. Overlaps the perimeter walls
  // 0.2 m so it clusters into the one merchant draw and stays in the draw envelope.
  prop({
    id: "MERCHANT_PARLOUR",
    section: "B_SHAMBLES",
    asset: "bldg-merchant",
    rect: rect(33.3, 41.7, -16.9, -3.4),
    baseY: PARLOUR - 0.15,
    topY: PARLOUR,
    landable: false,
    tags: ["structure", "balcony", "interior-shell"],
    note: "The quartered parlour floor: the drop-in landing, a SAFE interior 4.0 m up. The billeting dressing reads occupation from inside.",
  }),
);

decks.push(
  deck({
    id: "MERCHANT__ROOF",
    section: "B_SHAMBLES",
    asset: null,
    rect: inflate(MERCHANT_FOOT, JETTY_M),
    y: EAVE,
    carriedBy: ["MERCHANT"],
    tags: ["roof", "north-row", "eave"],
    note: "The merchant's leads — the eave. The G-A plank lands here and G-B leaves from it; the drop-in goes over the south lip into the open window.",
  }),
);

export const MERCHANT_GEOMETRY = { masses, decks } as const;
