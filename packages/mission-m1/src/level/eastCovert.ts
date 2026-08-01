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

// THE STAGING IS DRAWN SCAFFOLD BOARD, and the crates that stood in for it are
// gone. This is the correction of two claims that used to live here.
//
// The first claim was that a thin deck "reads as empty air, so a deck-mantle must
// be validated by a ladder/grip". That was true once and is not now:
// `readRaisedSurface` in parkour/probe.ts exists specifically to read a raised
// PLATFORM as a ledge — "a scaffold staging two metres nine above the street was
// invisible to the verb ladder" is its own commit note. A bare lipped deck is
// offered on its own. What a ladder validates is the opposite case: a climb
// VOLUME refuses unless a ladder or grip backs it, so the volumes came out too.
//
// The second was that solid blocks were needed for the lip, which is why the four
// upper steps were `crate-stack`/`crate-mound` props — the "floating crates" the
// owner called out against this wall. They are deleted. `bldg-scaffold-run` now
// draws boarded staging at all seven planes, so the nodes stand on real scaffold.
//
// What actually governs the shape is the OVERHEAD rule: `readRaisedSurface` takes
// `overhead = raisedAt(0)` and skips every hit with that id, so a lift directly
// above the one you stand on is never offered. It reads authored deck RECTS, not
// the mesh. Hence the stagger in geometry.ts SCAFFOLD_LIFTS and the matching
// stagger in the generator; hence also that the node on each lift stands on the
// part with open sky. Measured, and caught by traversability.test.ts refusing all
// four staging climbs when the lifts were briefly authored full-run.
//
// The staircase sits on the SOUTH bays, clear of the G-B drop and gallery jump at
// the north end (z ≈ −6.4), reached by a short run south along the 5.60 staging
// (C_SCAFF_2 -> C_SCAFF_2S). Steps at 7.3 / 9.0 / 10.7 / 12.4.
const SCAFF_STEPS = [
  { deck: "SCAFFOLD_D3", top: 7.3, node: "C_SCAFF_3", nodeZ: -3.5 },
  { deck: "SCAFFOLD_D4", top: 9.0, node: "C_SCAFF_4", nodeZ: -2.1 },
  { deck: "SCAFFOLD_D5", top: 10.7, node: "C_SCAFF_5", nodeZ: -0.5 },
  { deck: "SCAFFOLD_D6", top: BAND.LEADS, node: "C_SCAFF_TOP", nodeZ: 1.1 },
] as const;

nodes.push(
  node("C_SCAFF_2S", "C_ASCENT", [44.8, BAND.GALLERY, -4.7], "SCAFFOLD_D2", ["safe-line", "golden", "scaffold"],
    "South along the 5.6 staging off the G-B landing, at the foot of the staging staircase — clear of the jump/drop bay to the north."),
);
SCAFF_STEPS.forEach((step) => {
  nodes.push(
    node(step.node, "C_ASCENT", [44.8, step.top, step.nodeZ], step.deck,
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
// The steeple ascent IS the ≤1.9 m mantle chain now (regen 08003ac): ridge 11.2 ->
// north set-off 13.0 -> east set-off 14.7 -> gallery 15.8, rises 1.8 / 1.7 / 1.1.
//
// Why it could not be done before, kept because it is the general lesson and not a
// steeple fact. The old chain climbed onto LOUVRE_SILL, a ring spanning the whole
// shaft (x 77.3..84.7, z 7.9..15.3) at 14.0, and MEETING_RIDGE (11.2) is likewise
// full-width across the steeple's north approach. `beginAuthored`/`crossesPlatform`
// forbid a climb trajectory — and the body's head at the top of it — from piercing
// any deck that is not the climb's own start or destination. Two full-width decks
// 2.8 m apart therefore have NO room between them: an intermediate needs >= 3.1 m,
// and a ring cannot skip a spanning deck it would cross on the way up. Every
// candidate placement was refused by beginAuthored, measured.
//
// The regen did not find the 3.1 m. It removed the premise: a ring is what makes a
// deck span the shaft, and a set-off on ONE FACE does not. With the belfry's two
// ledges on the north and east faces neither spans, neither roofs the other, and
// the same 4.6 m of rise takes three ordinary mantles.
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
    // Runs all the way to the merchant's south wall face at z −3.2. It used to
    // stop at −2.6 and leave a 0.6 m slot against that wall, which is narrower
    // than the 0.70 m capsule: a body that got into it was inside a solid
    // whichever way it faced, and the penetration fuzzer caught exactly that at
    // (34.0, 0, −2.85), 0.10 m in, for 44 consecutive ticks. Nothing was driving
    // a body there before only because the fuzzer's random starts happen to move
    // when the world bounds do — the slot is as old as the barricade. A barrier
    // with a gap too small to walk through is a wedge, not a barrier.
    rect: rect(33.4, 34.0, -3.2, -1.1),
    topY: 1.2,
    landable: false,
    tags: ["obstacle", "barricade", "dressing"],
    note: "A posted barrier beside the cart, closed against the merchant's south wall; the billeted soldiers' barricade across the merchant block (O2).",
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
  { id: "S2_WHARF_VANTAGE", section: "A_LEADS", pos: [-1.8, 4.3, 12.6], surface: "WHARF_WAREHOUSE_B__ROOF", partner: "WHARF_ASC_ROOF", why: "A ledge looking back over the dead port and its idle ships as you re-climb." },
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

// ===========================================================================
// THE MARKET DROP-TO-CONTACT — the SHAMBLES_STOP beat, on the covert line.
// ===========================================================================
//
// The guided covert line runs the market on the sheds and canopies, above the
// crowd. The market-watch constable (SHAMBLES_STOP) stands on the cobbles, and
// his stop is MANDATORY — traversal.ts gates REACHED_DUEL on encountersParticipated,
// so a covert line that sailed over him on the canopies would soft-lock the duel.
// So the golden line comes DOWN to him for the beat and climbs straight back up,
// an authored drop-to-contact rather than a wander across the market floor.
//
// It is built on the PROVEN street climb-in and needs no new market geometry: the
// line runs off stall 2's canopy (B_CANOPY_2) down to the crate foot where the
// constable stops it (B_CRATES_FOOT, the stop's relocated trigger — see
// encounters/bank.ts), then climbs the awning's overhanging south edge back onto
// the canopy line (the shipped B_CRATES_FOOT -> B_CANOPY_2_S mantle) and jumps on
// to stall 3. Descent and ascent take DISTINCT nodes (down B_CANOPY_2, up
// B_CANOPY_2_S) so the guidance never has to re-offer a node it already banked —
// the visited-set never sees the same node twice on the down-and-up.
links.push(
  link("B_CANOPY_2", "B_CRATES_FOOT", "DROP", "SAFE", "CHAIN_DROP", {
    // A hang-drop, not a run-off: the goods stack (SHAMBLES_CRATES_A, top 1.9)
    // sits directly south of the foot, so any running carry off the lip lands
    // ON the crate — the reader grabs the awning edge and lowers straight down
    // onto the cobbles just past it. speedMps is the assumed lip speed the
    // static solver flies the arc at; 1.0 keeps the 2.55 m descent near-vertical
    // so it clears the stack and lands on the foot, not the goods.
    speedMps: 1.0,
    note: "Drop-to-contact: off stall 2's canopy south edge, a controlled hang-drop down to the crate foot, where the market-watch stops the player on the cobbles (SHAMBLES_STOP).",
  }),
  link("B_CANOPY_2_S", "B_CANOPY_3", "JUMP", "SAFE", "LEAP", {
    note: "Back up and on: after the stop, the awning-edge mantle (B_CRATES_FOOT -> B_CANOPY_2_S) regains the canopy line and this hop carries east to stall 3 — a forward rejoin, not a re-tread of the drop.",
  }),
);

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
// Every CLIMB on it is a ≤1.9 m mantle EXCEPT two flagged dead-zone climbs
// (D_MEETING_ROOF->E_RIDGE 3.0 m, E_LEDGE_N->E_GALLERY 2.8 m), both of which now
// wait on an ASSET measurement rather than on level authoring. See the HOLLIS
// STEEPLE note above and the STEEPLE ASCENT note in route.ts.
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
  "WHARF_ASC_ROOF_E",
  "WHARF_SHED_W",
  // The Shambles high/mid line into the merchant (the SAFE interior drop-in).
  "B_SHED_MID",
  "B_CANOPY_1",
  "B_CANOPY_2",
  "B_CANOPY_3",
  "B_CANOPY_4",
  "B_CRATES_B",
  "M_LEDGE",
  "M_PARLOUR",
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
  // The Hollis steeple, up its staggered belfry set-offs to the 15.8 leap gallery,
  // then the dive.
  "E_RIDGE",
  "E_LEDGE_N",
  "E_GALLERY",
  "F_CROWN",
  "F_POST",
];

// The golden-line climbs still in the dead-zone. covertLine.test.ts asserts these
// are the ONLY >1.9 m climbs on the golden line, so an exemption cannot quietly
// outlive its cause: when the last one is re-massed the list must shrink to empty
// or the test fails on the leftover.
//
// `E_RIDGE->E_LOUVRE` was replaced, not resolved. The steeple regen (08003ac) split
// its 2.8 m onto ridge -> 13.0 (1.8) and 13.0 -> 15.8 (2.8), so the phantom 14.0
// ring is gone and one dead-zone step remains where there was one before. The
// 14.7 east set-off that would have made it 1.7 / 1.1 is drawn and standable but
// unreachable: the 15.8 gallery oversails its western 0.7 m and the north ledge
// ends before the clear part starts, so the climb crosses the soffit. See the
// STEEPLE ASCENT note in route.ts; it needs the asset moved, not the route.
//
// The other entry is the meeting-house ridge, waiting on the asset lane's
// `roof-ridge-monitor` measurement.
export const STEEPLE_DEADZONE_CLIMBS: readonly string[] = [
  "D_MEETING_ROOF->E_RIDGE",
  "E_LEDGE_N->E_GALLERY",
];

// ===========================================================================
// THE GUIDED LINE — the wayfound covert route the HUD/visor actually leads.
// ===========================================================================
//
// GOLDEN_LINE above is the covert IDEAL: elevated spawn→post, every ascent a
// ≤1.9 m mantle, checked by covertLine.test. The wayfinder needs two things that
// ideal does not carry, so it is guided down THIS line instead:
//
//   * the authored DROP-TO-CONTACT at the market-watch. The golden ideal stays
//     on the canopies over the constable and would sail over the MANDATORY
//     SHAMBLES_STOP (traversal.ts gates REACHED_DUEL on encountersParticipated),
//     soft-locking the duel; the guided line drops to him and climbs back (see
//     the MARKET DROP-TO-CONTACT block above).
//   * the post→yard chase. GOLDEN_LINE stops at the post; the wayfinder's second
//     goal is the arena spawn, so the chase down the elm and through the yard
//     crowd is appended here.
//
// The Shambles splice replaces the canopy-2→canopy-3 hop with the down-and-up
// (B_CANOPY_2 → B_CRATES_FOOT → B_CANOPY_2_S → B_CANOPY_3); everything else is
// GOLDEN_LINE verbatim, so the covert ideal and the guided line cannot drift.
export const GOLDEN_GUIDED_LINE: readonly string[] = [
  ...GOLDEN_LINE.flatMap((id) =>
    id === "B_CANOPY_2"
      ? ["B_CANOPY_2", "B_CRATES_FOOT", "B_CANOPY_2_S"]
      : [id],
  ),
  "F_POST_STEP",
  "F_LOW",
  "F_AWNING",
  "F_GROUND",
  "F_STALL_BACK",
  "F_CROWD_S",
  "F_VAULT_IN",
  "F_VAULT_OUT",
  "F_CROWD_E",
  "G_GATE",
  "G_SPAWN",
];
