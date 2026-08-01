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
// Open upper window on the south face, aligned over the Shambles crate-mound
// on-ramp (SHAMBLES_CRATES_B / node B_CRATES_B at x 39.2) so the G-A climb-in
// (crate 1.9 → parlour 4.0, a 2.1 m CLIMB_UP) passes through the real hole rather
// than a solid wall. From the parlour floor to the eave.
const AP_X0 = 37.5;
const AP_X1 = 40.5;

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
  // Billeting dressing on the parlour floor: soldiers are quartered here (the
  // concept-2 obstacle). Non-blocking clutter set against the walls, clear of the
  // centre so the 0.75 m path and the drop-in landing stay open. Reads "occupied"
  // from the moment the player drops in.
  prop({
    id: "MERCHANT_BILLET_A",
    section: "B_SHAMBLES",
    asset: "billeting-pile",
    rect: rect(34.0, 35.9, -16.4, -14.85),
    baseY: PARLOUR,
    topY: PARLOUR + 0.86,
    landable: false,
    tags: ["billeting", "dressing"],
    note: "Stacked muskets, bedrolls and packs against the parlour's back wall.",
  }),
  prop({
    id: "MERCHANT_BILLET_B",
    section: "B_SHAMBLES",
    asset: "billeting-pile",
    rect: rect(39.4, 40.95, -11.9, -10.0),
    baseY: PARLOUR,
    topY: PARLOUR + 0.86,
    landable: false,
    yaw: Math.PI / 2,
    tags: ["billeting", "dressing"],
    note: "A second billet against the east wall, turned across the room.",
  }),
);

decks.push(
  deck({
    id: "MERCHANT__ROOF",
    section: "B_SHAMBLES",
    asset: null,
    // The standard JETTY_M lip on three sides, and NOT on the south front. Two
    // measurements forced that, both off the placed mesh:
    //   the drawn roof plateau stops at z −3.25, so the jetty's south 0.75 m was
    //   authored roof over nothing — a lip a body can stand on and not see; and
    //   the regenerated gallery slab (z −3.4..−2.6, top 5.70) sits UNDER it, so
    //   the jetty roofed the new ledge at 1.40 m, under STAND_HEIGHT, and no body
    //   could have stood on the intermediate the whole chain turns on.
    // The collision lip is 0.10 m behind the drawn lip. That is the smallest
    // inset which leaves a radius-wide standing centreline on the 0.80 m gallery:
    // putting the deck at the exact drawn edge makes the roof overlap that
    // centreline and the shipped reader cannot offer the climb. The capsule axis
    // still rises south of the visible edge, so the drawn eave stays clear.
    rect: { ...inflate(MERCHANT_FOOT, JETTY_M), maxZ: -3.35 },
    y: EAVE,
    carriedBy: ["MERCHANT"],
    tags: ["roof", "north-row", "eave"],
    note: "The merchant's leads — the eave. G-B leaves from it to the Town House scaffold; the covert line climbs up here off the jettied gallery and the drop-in comes down over the south lip.",
  }),
  // The landable route surface on the parlour, a null-asset deck coincident with
  // the drawn (non-landable) MERCHANT_PARLOUR mass top at 4.0. The mass draws the
  // floor; this deck is what the route node M_PARLOUR stands on. The sealed ground
  // void below is unreachable, so a one-way deck here grazes nothing.
  deck({
    id: "MERCHANT_PARLOUR__DECK",
    section: "B_SHAMBLES",
    asset: null,
    // Runs out to z −2.6, which is where the mesh actually stops: the placed GLB
    // draws ONE up-facing plateau at 4.00 spanning z −16.90..−2.60, the parlour
    // floor and its projecting window course together. It used to be authored as
    // two decks over that one slab, and the shorter of them (MERCHANT_BALCONY,
    // 0.8 m deep) straddled the drawn window sill — a 0.12 m course the mesh
    // carries 0.15 m proud at z −3.22..−3.10 — so one of its three samples read
    // 4.15 and the affordance gate called it MARGINAL at 67%. Nothing was
    // missing; the deck was small enough for a moulding to be a third of it.
    // One drawn slab, one deck: the sill is now a 0.15 m step-over inside a
    // 13.8 m floor, which is what it is.
    rect: rect(33.8, 41.2, -16.4, -2.6),
    y: PARLOUR,
    carriedBy: ["MERCHANT_PARLOUR"],
    tags: ["floor", "safe-interior"],
  }),
  // MERCHANT_BALCONY was folded into MERCHANT_PARLOUR__DECK above (see its note).
  // The projecting window course it stood for is still there and still drawn; it
  // is simply the south end of the one 4.00 slab rather than a second deck laid
  // over the same triangles.
  // --- The mantle-chain ledge (owner 31-Jul: the covert line is ≤1.9 m mantles, no
  // ladders/tall climbs). The old exit (balcony 4.0 → eave 7.1, a 3.1 m laddered
  // CLIMB) splits into two ≤1.9 m mantles onto a moulded string course at 5.5. The
  // old climb-in (crate → balcony 4.0, a 2.1 m laddered CLIMB) is now a single 1.85 m
  // mantle by raising the Shambles goods on-ramp to 2.15 (see geometry.ts
  // SHAMBLES_CRATES_B) — no intermediate ledge needed, and none fits: a ledge
  // between the 1.9 m crate and the 4.0 m balcony would either sit under the balcony
  // overhang or over the crate, and lose its headroom either way.
  //
  // The intermediate is a JETTIED UPPER-STOREY GALLERY, not a flush string course:
  // the 3.1 m storey between the balcony (4.0) and the eave (7.1) is shorter than two
  // body-heights, so a ledge stacked flush on the facade has no headroom (the roof
  // 7.1 or the balcony 4.0 sits inside a body-height of it). A believable Georgian
  // jetty solves it: the gallery OVERSAILS the street SOUTH of the roof's own south
  // edge (z −2.5, = MERCHANT_FOOT south −3.2 + JETTY 0.7), so a body on it has open
  // sky overhead, not the eave. It projects to z −1.7 (a full jettied storey) and
  // stands clear of the balcony node (z −2.8) below it.
  //
  // REGEN LANDED (08003ac) AND THE RECT MOVED ONTO IT. The pending-regen note that
  // stood here aimed the gallery at z −2.4..−1.6, oversailed south of the old roof
  // lip for headroom. The delivered mesh draws it at z −3.4..−2.6 across the whole
  // front (x 33.3..41.7), measured off the placed GLB: one 6.7 m2 up-facing plateau
  // at exactly 5.70, with the 0.20 m balcony hood and the redundant 5.65 string
  // course gone. The rect follows the mesh rather than the other way round.
  //
  // The headroom the old oversail was buying is now bought by the ROOF pulling its
  // south jetty back to z −3.4 (see MERCHANT__ROOF above) — which it owed the mesh
  // anyway. The chain is therefore parlour floor (4.0) → gallery (5.70) → eave
  // (7.10), 1.70 m and 1.40 m, both inside the mantle band, and each tier's
  // footprint is clear of the one above it.
  //
  // The rect runs the full drawn front, not just the window bay. Outside the
  // aperture (x 37.5..40.5) the south wall rises through the slab's north 0.2 m,
  // so only the 0.6 m proud strip is walkable there — which is what a Georgian
  // jetty is. `canStand` refuses the buried part on its own; nothing needs to
  // exclude it, and narrowing the rect to the bay would leave 5.6 m of drawn
  // ledge with no collision under it.
  deck({
    id: "MERCHANT_STRING",
    section: "B_SHAMBLES",
    asset: "bldg-merchant",
    rect: rect(33.3, 41.7, -3.4, -2.6),
    y: 5.7,
    carriedBy: ["MERCHANT"],
    tags: ["ledge", "gallery"],
    note: "The jettied upper-storey gallery across the merchant's south front: the intermediate mantle between the parlour floor (4.0) and the leads (7.1). Stood on in the window bay, where the wall below stops at the parlour and the slab is 0.8 m of clear depth.",
  }),
);

export const MERCHANT_GEOMETRY = { masses, decks } as const;
