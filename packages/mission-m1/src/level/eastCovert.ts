// The EAST-HALF covert golden line, built TRAVERSAL-FIRST as a ≤1.9 m mantle
// vocabulary (owner, 31-Jul: NO ladders, NO long straight climbs; every ascent
// is a chain of ≤1.9 m mantles onto a real drawn ledge, drawn == collision).
//
// This file ADDS the east-half covert continuation ALONGSIDE the existing proven
// geometry in geometry.ts / route.ts — it never edits it — so the old spiral
// (gallery reflex beat, clock/cornice ledges, ridge/louvre steeple climbs) stays
// green as the reachable fallback while the new ≤1.9 m golden line is the marked
// covert route. Its pieces, west→east:
//
//   TOWN HOUSE   the canonical UNDER-REPAIR west-front scaffold, EXTENDED into a
//                ≤1.9 m mantle chain from the G-B landing (5.6) up to the leads
//                (12.4). Free-standing scaffold decks have OPEN SKY above each
//                (only masses reduce head clearance; a scaffold deck west of the
//                Town House mass has none overhead), so they escape the mantle
//                dead-zone that the attached tower ledges (2.2–2.9 m gaps) fall
//                into. Do NOT re-mass the Town House mesh; the scaffold does it.
//
//   HOLLIS       the steeple regenerated (asset worker) with stacked ≤1.9 m
//   STEEPLE      gallery RINGS: a clean ~1.7 m mantle chain off the meeting roof
//                (8.2) up to the 15.8 leap gallery. The LEAP take-off (E_GALLERY,
//                15.8) is UNCHANGED — the signature dive stays exactly where it
//                is.
//
//   OBSTACLES    O2–O5: diegetic non-standable blockers that close the straighter
//                line so the golden path's wind reads as earned (plan A.1b).
//   PADS         S1–S7: reserved SAFE standable pads for future learning objects,
//                on the golden path but off its running lane (plan A.10), UNPOPULATED.
//
// Every mantle is ≤1.9 m onto a standable top; every link is proven by the shipped
// physics (traversability.test verifyLink). Where a reused mesh does not yet DRAW
// the surface the route needs (the scaffold above 5.6, the ≤1.9 m steeple rings),
// it is recorded as itemised PENDING-REGEN debt in check-world-affordances.mjs
// with the exact target height — the STRUCTURE (decks/route) is authored to the
// target and the regenerated mesh swaps in under the same key.

import { BAND } from "../envelope.js";
import { link, node, prop, rect } from "../authoring.js";
import type {
  ClimbSpec,
  DeckSpec,
  MassSpec,
  RouteLink,
  RouteNode,
} from "../types.js";

const masses: MassSpec[] = [];
const decks: DeckSpec[] = [];
const nodes: RouteNode[] = [];
const links: RouteLink[] = [];
const climbs: ClimbSpec[] = [];

// ===========================================================================
// TOWN HOUSE — the west-front repair scaffold, EXTENDED to the leads (12.4).
// ===========================================================================
//
// The Town House is canonically UNDER REPAIR and the west-front scaffold is the
// sanctioned way up (see geometry.ts SCAFFOLD_D1/D2 at 2.9/5.6 and the masons'
// stock on the gallery). The covert golden line drops onto the scaffold at 5.6
// off the merchant's leads (G-B: route.ts M_EAVE_E -> C_SCAFF_2), and from there
// the proven ascent was a spiral up the building's OWN oversailed ledges —
// clock 7.9, cornice 10.2, leads 12.4 — whose gaps (2.3 / 2.3 / 2.2 m) all sit
// in the mantle DEAD-ZONE: too tall for one ≤1.9 m mantle, too short for two
// (a body needs STAND_HEIGHT 1.55 m of clear space to stand on an intermediate
// ledge, and an attached ledge has the ledge above it inside that space).
//
// The fix the owner approved: EXTEND the repair scaffold/staging up the west
// front so the whole ascent is ≤1.9 m mantles with OPEN SKY above each step (the
// Town House mass is EAST of the scaffold, x >= 46.5, and each step is ahead of
// the last, not overhead — so nothing reduces the head clearance a step offers).
// Four ~1.7 m staging steps carry 5.6 -> 7.3 -> 9.0 -> 10.7 -> 12.4, topping out
// level with the leads, then a flat step onto the roof proper.
//
// The staging stays on the WEST FRONT only (2 m of the 11.3 m frontage, its south
// bays) — a believable repair scaffold, NOT a shroud burying the civic landmark.
// The existing 0 -> 2.9 -> 5.6 foot climbs and the gallery / clock / cornice
// spiral are UNTOUCHED (reachable fallback; the Old Brick reflex beat still lives
// on the gallery a deviating player climbs).

// THE STAGING IS SOLID, NOT THIN DECK, and that is what lets it be laddderless.
// The parkour reader only OFFERS a mantle a walking player can take when it meets
// a SOLID FACE with a lip (its forward read walks at blockers; a thin deck has no
// span and reads as empty air, so a deck-mantle must be validated by a ladder/grip
// — exactly what the existing SCAFFOLD_D1/D2 needed and what the owner is retiring).
// So the lift staging is a STAGGERED STAIRCASE of solid staging blocks (the
// masons' materials boarded onto the putlog frame), the same shape as the proven
// wharf ascent (crate steps + the warehouse mass): each block OVERLAPS the one
// below for support and OVERHANGS it for the next lip, and each has OPEN SKY above
// its clear top (the Town House mass is east at x >= 46.5, the next block is ahead
// not overhead), so the chain escapes the dead-zone AND offers ≤1.9 m mantles with
// no ladder. drawn == collision: crate-stack draws each block's standable top on
// its plane, so there is NO pending-regen debt here.
//
// The staircase sits on the SOUTH bays (z −4.0..1.6), clear of the G-B drop and
// gallery jump at the north end (z ≈ −6.4), reached by a short run south along the
// 5.60 staging (C_SCAFF_2 -> C_SCAFF_2S). Steps at 7.3 / 9.0 / 10.7 / 12.4.
// Each step is a DISTINCT solid asset, so the scenery clusterer draws each on its
// own (same-asset overlapping props merge into one draw and the upper ones read as
// empty air — the wharf ascent avoids this the same way, alternating crate-stack
// and crate-mound). Each block OVERLAPS the one below for support and OVERHANGS it
// for the next lip; the route node stands on the clear (un-overhung) part of each.
const SCAFF_STEPS = [
  { id: "SCAFF_STEP_A", asset: "crate-stack", base: BAND.GALLERY, top: 7.3, r: rect(43.8, 45.8, -4.0, -2.0), node: "C_SCAFF_3", nodeZ: -3.5 },
  { id: "SCAFF_STEP_B", asset: "crate-mound", base: 7.3, top: 9.0, r: rect(43.8, 45.8, -2.4, -0.4), node: "C_SCAFF_4", nodeZ: -2.1 },
  { id: "SCAFF_STEP_C", asset: "crate-stack", base: 9.0, top: 10.7, r: rect(43.8, 45.8, -0.8, 1.2), node: "C_SCAFF_5", nodeZ: -0.5 },
  { id: "SCAFF_STEP_D", asset: "crate-mound", base: 10.7, top: BAND.LEADS, r: rect(43.8, 45.8, 0.8, 2.8), node: "C_SCAFF_TOP", nodeZ: 1.1 },
] as const;

SCAFF_STEPS.forEach((step, i) => {
  masses.push(
    prop({
      id: step.id,
      section: "C_ASCENT",
      asset: step.asset,
      rect: step.r,
      baseY: step.base,
      topY: step.top,
      landable: true,
      tags: ["scaffold", "staging", "cargo"],
      note:
        i === 0
          ? "Masons' materials boarded onto the repair-scaffold staging: the first ≤1.9 m mantle step off the 5.6 landing, open sky above its clear top."
          : undefined,
    }),
  );
});

nodes.push(
  node("C_SCAFF_2S", "C_ASCENT", [44.8, BAND.GALLERY, -4.7], "SCAFFOLD_D2", ["safe-line", "golden", "scaffold"],
    "South along the 5.6 staging off the G-B landing, at the foot of the staging staircase — clear of the jump/drop bay to the north."),
);
SCAFF_STEPS.forEach((step) => {
  nodes.push(
    node(step.node, "C_ASCENT", [44.8, step.top, step.nodeZ], step.id,
      ["safe-line", "golden", "scaffold"],
      step.node === "C_SCAFF_TOP"
        ? "Top of the staging staircase, level with the leads: step off onto the Town House roof."
        : `≤1.9 m mantle up the repair-scaffold staging to ${step.top.toFixed(1)} m, open sky above.`),
  );
});
nodes.push(
  node("C_LEADS_NW", "C_ASCENT", [47.0, BAND.LEADS, 0.6], "TOWNHOUSE__ROOF", ["safe-line", "golden", "leads"],
    "Onto the Town House leads off the staging top — the covert ascent reaches the roof without the dead-zone spiral."),
);

links.push(
  link("C_SCAFF_2", "C_SCAFF_2S", "RUN", "SAFE", "RUN", {
    note: "South along the 5.6 staging off the G-B landing to the foot of the staging staircase, clear of the drop/jump bay.",
  }),
  link("C_SCAFF_2S", "C_SCAFF_3", "CLIMB", "SAFE", "CLIMB", {
    note: "Mantle up onto the first staging block — a ≤1.9 m reach off a real lip, not the dead-zone spiral. No ladder.",
  }),
  link("C_SCAFF_3", "C_SCAFF_4", "CLIMB", "SAFE", "CLIMB"),
  link("C_SCAFF_4", "C_SCAFF_5", "CLIMB", "SAFE", "CLIMB"),
  link("C_SCAFF_5", "C_SCAFF_TOP", "CLIMB", "SAFE", "CLIMB", {
    note: "Last mantle onto the top staging (10.7 -> 12.4), flush with the leads.",
  }),
  link("C_SCAFF_TOP", "C_LEADS_NW", "RUN", "SAFE", "RUN", {
    note: "Step off the staging onto the Town House roof proper — flat, at the leads plane.",
  }),
  link("C_LEADS_NW", "C_LEADS_S", "RUN", "SAFE", "RUN", {
    note: "South-east across the leads (west of the tower base) onto the proven leads network — the elm is downhill from here.",
  }),
);

// ===========================================================================
// HOLLIS STEEPLE — FLAGGED, blocked on the asset worker's steeple regen.
// ===========================================================================
//
// The owner wants the steeple ascent re-authored as a ≤1.9 m ring mantle chain
// (asset worker regenerating steeple-meetinghouse-climbable with ≤1.9 m rings to
// 15.8). That re-mass is NOT authored here; the proven spiral in route.ts
// (D_MEETING_ROOF -> ridge 11.2 -> louvre 14.0 -> gallery 15.8) is kept as the
// green fallback, because the current STEEPLE COLLISION makes a ≤1.9 m ring chain
// impossible until the regen replaces it (verified against the shipped physics):
//
//   * MEETING_RIDGE (11.2) is the meeting-house roof monitor — proven geometry
//     that must not move — a FULL-WIDTH deck spanning the steeple's north approach
//     (x 75.3..84.7, z 7.6..10.4). LOUVRE_SILL (14.0) is likewise full-width
//     (x 77.3..84.7, z 7.9..15.3).
//   * `beginAuthored`/`crossesPlatform` forbid a climb trajectory — and a body's
//     head (feet + STAND_HEIGHT 1.55) at the top of a climb — from piercing any
//     deck that is not the climb's own start/dest. So a body standing on the ridge
//     (head 12.75) may not have a ring within 1.55 m above it, and a ring below
//     the louvre must sit <= 12.45; the ridge->louvre gap is only 2.8 m, so NO ring
//     fits between them (it would need >= 3.1 m), and a ring cannot skip a spanning
//     deck it would cross on the way up. (Both measured: every candidate ring
//     placement was refused by beginAuthored.)
//
// The fix is the regen delivering a ring stack that REPLACES LOUVRE_SILL's
// spanning collision — rings on the shaft's south annulus (z > 13.6, clear of the
// ridge monitor) up to a south node of the UNCHANGED 15.8 leap gallery. Authoring
// that here, without the mesh, would be collision the art cannot draw AND a
// re-mass of proven meeting-house geometry. Recorded in docs/process/M1-STATUS.md
// as the one genuine asset-coordination decision this build surfaced.

// ===========================================================================
// OBSTACLES — diegetic blockers that earn the golden path's winding (A.1b).
// ===========================================================================
//
// Non-standable dressing that closes a STRAIGHTER alternative so the wind reads
// as intended, never blocking the golden line or any authored fallback node.
// O1 (the shut harbour) is already delivered as the dead-wharf water; O3 (the
// too-wide Shambles->merchant roof gap) and O5 (the sheer Hollis north wall) are
// INHERENT — they are the absence of a bridge and the presence of a blank face,
// so no mass authors them. O2 and O4 are the two that need props:
//
// O2 · the barricaded, troop-occupied street across the merchant's block. Cart
// and wall barricades in front of the quartered house, set on the NORTH side of
// the Shambles street line (z <= -1.0) so they close the direct lane under the
// merchant without touching the street-line fallback nodes (B_STREET_E at z -0.4,
// B_EXIT) or the covert canopies (z ~1.3).
// West of the merchant-frontage crates (CART_3 x≈37.6, SHAMBLES_CRATES_B x≈39.2)
// so it never fouls their flush-seam probes, and north of the street line (z −0.4)
// so the ground fallback still runs it.
masses.push(
  prop({
    id: "O2_BARRICADE_CART",
    section: "B_SHAMBLES",
    asset: "hand-cart",
    rect: rect(34.0, 36.4, -2.5, -1.1),
    topY: 0.95,
    landable: false,
    tags: ["obstacle", "barricade", "dressing"],
    note: "Overturned cart barricading the lane under the merchant's — the troops closed the direct street, so the covert line goes over the roofs.",
  }),
  prop({
    id: "O2_BARRICADE_WALL",
    section: "B_SHAMBLES",
    asset: "service-wall-straight",
    rect: rect(33.4, 34.0, -2.6, -1.1),
    topY: 1.2,
    landable: false,
    tags: ["obstacle", "barricade", "dressing"],
    note: "A posted barrier beside the cart; the billeted soldiers' barricade across the merchant block (O2).",
  }),
);

// O4 · the broken Town House->south-row roofline is INHERENT: the ~5 m gap the
// fire-board gantry (LEADS_GANTRY) bridges IS the collapse — the roofline does not
// run straight across it, it steps onto the board. A rubble mass in that gap only
// fouls the south-lane ground run (C_LANE_S_E->C_KING_HEAD threads x 56..60) and
// the gantry, so O4 is left as the authored gap itself; reserved pad S5 sits on the
// safe landing beside it (SOUTH_ROW_A__ROOF) overlooking the barricaded street.

// ===========================================================================
// RESERVED PADS S1–S7 — SAFE standable vantages for future learning objects.
// ===========================================================================
//
// UNPOPULATED (owner, 30 Jul): these mark convenient, open, accessible spots on
// the golden path but OFF its running lane, where an interactable + a text/still
// panel can be dropped in later (plan A.10). Each is a real standable node on an
// existing SAFE surface, tagged `reserved-pad`, reached and left by a short flat
// run off a nearby route node so it is never a gate. No object, count or plumbing
// is authored here.
const RESERVED_PADS: ReadonlyArray<{
  id: string;
  section: RouteNode["section"];
  pos: readonly [number, number, number];
  surface: string;
  partner: string;
  why: string;
}> = [
  { id: "S1_PRINTSHOP_VANTAGE", section: "A_LEADS", pos: [4.5, BAND.LOW_ROOF, -9.0], surface: "PRINTSHOP__ROOF", partner: "A_START", why: "First safe vantage — the whole route and the shut harbour lie below." },
  { id: "S2_WHARF_VANTAGE", section: "A_LEADS", pos: [-1.8, 5.35, 12.6], surface: "WHARF_WAREHOUSE_B__ROOF", partner: "WHARF_ASC_ROOF", why: "A ledge looking back over the dead port and its idle ships as you re-climb." },
  { id: "S3_SHAMBLES_BREATH", section: "B_SHAMBLES", pos: [20.6, BAND.GALLERY, 3.6], surface: "MARKET_SHED__ROOF", partner: "B_SHED_MID", why: "A breath on the market high line, above the crowd, beside the drop-to-contact." },
  { id: "S4_MERCHANT_ALCOVE", section: "B_SHAMBLES", pos: [35.0, 4.0, -13.0], surface: "MERCHANT_PARLOUR__DECK", partner: "M_PARLOUR", why: "A SAFE interior nook where the billeting fills the room — occupation seen from inside." },
  { id: "S6_TOWNHOUSE_VISTA", section: "C_ASCENT", pos: [51.0, BAND.LEADS, 3.5], surface: "TOWNHOUSE__ROOF", partner: "C_LEADS_S", why: "The high mid-run vantage with the elm already in sight." },
  { id: "S5_ROOFLINE_LANDING", section: "D_ROOFLINE", pos: [62.4, BAND.LEADS, 5.6], surface: "SOUTH_ROW_A__ROOF", partner: "D_SROOF_W", why: "The landing that rewards the forced detour, overlooking the barricaded street below." },
  { id: "S7_HOLLIS_NICHE", section: "E_LEAP", pos: [78.0, BAND.MEETING_RIDGE, 9.2], surface: "MEETING_RIDGE", partner: "E_RIDGE", why: "A roof-level niche at the endorsement stop before the steeple climb, clear of the shaft to the north-west." },
];

RESERVED_PADS.forEach((pad) => {
  nodes.push(
    node(pad.id, pad.section, [pad.pos[0], pad.pos[1], pad.pos[2]], pad.surface, ["reserved-pad", "safe"], pad.why),
  );
  // Off the running lane and back: a short flat run so the pad is reachable and
  // never stranded, but the golden line never routes through it.
  links.push(
    link(pad.partner, pad.id, "RUN", "SAFE", "RUN", { note: `Onto reserved pad ${pad.id} (future learning object).` }),
    link(pad.id, pad.partner, "RUN", "SAFE", "RUN", { note: `Back off reserved pad ${pad.id} to the golden line.` }),
  );
});

export const EAST_COVERT_GEOMETRY = { masses, decks } as const;
export const EAST_COVERT_NODES = nodes;
export const EAST_COVERT_LINKS = links;
export const EAST_COVERT_CLIMBS = climbs;

// ===========================================================================
// THE GOLDEN LINE — the one marked, wayfound covert route, spawn -> post.
// ===========================================================================
//
// The node-tagged golden path of plan Section E.2: an ordered, link-connected
// SAFE line from the printshop leads to the elm crown, elevated except at the
// three authored ground beats (the wharf crossing, and the elm->yard chase after
// the post). It is NOT the cheapest SAFE path — the retired ground street line is
// shorter — so it is authored explicitly here rather than derived, and marked so
// the guidance/HUD lead it and covertLine.test.ts can verify its properties.
//
// Every CLIMB on it is a ≤1.9 m mantle EXCEPT the two flagged steeple dead-zone
// climbs (D_MEETING_ROOF->E_RIDGE 3.0 m, E_RIDGE->E_LOUVRE 2.8 m), which stay the
// proven spiral until the asset worker's steeple regen replaces the LOUVRE_SILL
// spanning collision (see the HOLLIS STEEPLE note above and M1-STATUS.md).
export const GOLDEN_LINE: readonly string[] = [
  // West end — the printshop leads and the dead-wharf crossing (the ground beat).
  "A_START",
  "WHARF_LEADS_SW",
  "WHARF_DESC_ROOF",
  "WHARF_DESC_MOUND_T",
  "WHARF_DECK_1",
  "WHARF_DECK_2",
  "WHARF_ASC_1",
  "WHARF_ASC_2",
  "WHARF_ASC_ROOF",
  "WHARF_SHED_W",
  // The Shambles high/mid line into the merchant (the SAFE interior drop-in).
  "B_SHED_MID",
  "B_CANOPY_1",
  "B_CANOPY_2",
  "B_CANOPY_3",
  "B_CANOPY_4",
  "B_CRATES_B",
  "M_LEDGE",
  "M_STRING",
  "M_EAVE_S",
  "M_EAVE",
  "M_EAVE_E",
  // The Town House — the extended repair-scaffold ≤1.9 m mantle chain to the leads.
  "C_SCAFF_2",
  "C_SCAFF_2S",
  "C_SCAFF_3",
  "C_SCAFF_4",
  "C_SCAFF_5",
  "C_SCAFF_TOP",
  "C_LEADS_NW",
  "C_LEADS_S",
  "C_LEADS_TOWERFOOT",
  "C_LEADS_E",
  // The Orange-Street roofline over the chimney vaults, down to the meeting roof.
  "D_GANTRY",
  "D_SROOF_W",
  "D_SROOF_N",
  "D_VAULT_IN_0",
  "D_VAULT_OUT_0",
  "D_VAULT_IN_1",
  "D_VAULT_OUT_1",
  "D_SROOF_E",
  "D_MEETING_W",
  "D_MEETING_ROOF",
  // The Hollis steeple (flagged spiral) up to the 15.8 leap gallery, then the dive.
  "E_RIDGE",
  "E_LOUVRE",
  "E_GALLERY",
  "F_CROWN",
  "F_POST",
];

// The two golden-line climbs still in the dead-zone, pending the steeple regen.
// covertLine.test.ts asserts these are the ONLY >1.9 m climbs on the golden line,
// so when the regen lands and they are re-massed to rings, the exemption fails
// loudly and is removed rather than quietly outliving its cause.
export const STEEPLE_DEADZONE_CLIMBS: readonly string[] = [
  "D_MEETING_ROOF->E_RIDGE",
  "E_RIDGE->E_LOUVRE",
];
