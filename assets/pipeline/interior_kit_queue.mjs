// FURNISHING / TRADE asset kit queue for the planned 36-interior rebuild.
//
// This is an ISOLATED asset factory. It is intentionally separated from the
// structural / wharf / character workers:
//   - concepts   -> assets/source/concepts/interior-kit/<key>.png
//   - raw GLBs   -> assets/build/interior-kit/<key>.glb
//   - optimized  -> assets/build/interior-kit-opt/<key>.glb
//   - manifest   -> assets/build/interior-kit/interior-kit-manifest.json
// so its Blender optimizer and manifest never collide with the shared
// world-v3 / world-v3-opt build tree used by other overnight workers.
//
// Each entry:
//   key    stable asset id (also the concept/GLB filename)
//   tris   triangle budget (Blender decimates down to this)
//   tex    max texture dimension (Blender scales textures down to this)
//   meshy  Meshy image-to-3D remesh target_polycount (before Blender decimate)
//   desc   the [DETAILED ASSET] clause for the shared prompt pattern
//   uses   where this asset is intended to be placed in the 36-interior set
//   reuse  production asset evaluated as a possible substitute (and why not)
//   hero   true for the operable/named-part hero (press) special handling

// Shared prompt pattern (from the build brief). [DETAILED ASSET] is replaced
// by each entry's `desc`.
export const PROMPT_PREFIX = "Single ";
export const PROMPT_SUFFIX =
  " only, centered, full object in frame, three-quarter view, plain light gray studio background, " +
  "soft even lighting, no shadows on ground, no other objects, no people, no text or watermark. " +
  "Historically accurate 1765 colonial Boston style. Realistic aged wood, iron, brick, plaster, paper, " +
  "linen, wool, leather, ceramic, and glass as appropriate; muted used colors; game asset reference photo " +
  "style. No Victorian, modern, fantasy, or museum-perfect styling.";

export function promptFor(entry) {
  return PROMPT_PREFIX + entry.desc + PROMPT_SUFFIX;
}

export const QUEUE = [
  // ---- Priority shared / hero props ----
  {
    key: "int-paper-surface-flat",
    tris: 2000,
    tex: 512,
    meshy: 6000,
    desc: "flat sheet of handmade rag paper, cream off-white, with a deckled uneven torn edge and a slight natural curl at one corner, lying flat with a blank smooth face",
    uses: "shared document surface: receives runtime document textures on desks, counters, pulpits across all interiors",
    reuse: "none (no flat blank paper sheet exists; paper-satchel/notice-board are different objects)",
  },
  {
    key: "int-foodware-cluster",
    tris: 8000,
    tex: 512,
    meshy: 18000,
    desc: "tight arranged cluster, grouped together as one composite prop, of colonial tableware: two dented used pewter plates, a wooden trencher, two redware clay bowls, a grey salt-glazed stoneware jug, a horn spoon, and a folded linen cloth",
    uses: "shared dining/kitchen dressing for homes, tavern, kitchens",
    reuse: "none (tankard-cluster is drinkware only, not plates/trenchers/bowls)",
  },
  {
    key: "int-pantry-cupboard-stocked",
    tris: 12000,
    tex: 1024,
    meshy: 24000,
    desc: "colonial pine pantry cupboard with paneled doors standing open, its shelves stocked with a stoneware crock, redware jugs, a wheel of cheese, a small cloth sack of grain, tin canisters, hanging dried herbs, and a few pewter plates",
    uses: "kitchens, provisioner back rooms, tavern pantry",
    reuse: "dresser-shelves considered but it is empty open shelving, not a stocked closed pantry cupboard",
  },
  {
    key: "int-textile-personal-cluster",
    tris: 10000,
    tex: 512,
    meshy: 20000,
    desc: "neatly folded stack of personal textiles grouped as one composite prop: a folded wool blanket, a folded linen shirt, a woolen shawl, a pair of knitted stockings, and a folded neckcloth",
    uses: "bedchambers, personal quarters dressing",
    reuse: "none (drying-line-rack is a hanging rack, not a folded personal-textile stack)",
  },
  {
    key: "int-wall-peg-cluster",
    tris: 8000,
    tex: 512,
    meshy: 18000,
    desc: "wooden wall-mounted peg rail with several turned wooden pegs, hung with a felt tricorn hat, a wool cloak, a leather satchel, a coil of cord, and a linen apron",
    uses: "entryways, workshops, homes wall dressing",
    reuse: "none",
  },
  {
    key: "int-repair-mending-cluster",
    tris: 8000,
    tex: 512,
    meshy: 18000,
    desc: "tight arranged cluster of household mending tools grouped as one composite prop: an open wooden sewing box, spools of thread, a pincushion, iron scissors, a wooden darning egg, a folded cloth stuck with needles, and scraps of fabric",
    uses: "homes, tailor, general domestic detail",
    reuse: "none",
  },
  {
    key: "press-common-operable",
    tris: 15000,
    tex: 1024,
    meshy: 30000,
    hero: true,
    desc: "English common wooden printing press with a full standing frame of two tall upright cheeks, a large central iron screw and spindle, a flat rectangular platen, a sliding carriage bed carrying hinged tympan and frisket frames, and a long horizontal wooden bar lever",
    uses: "print shop hero centerpiece",
    reuse: "press-common exists but is static and lacks separable moving parts; brief requests operable version",
  },
  {
    key: "printer-composition-workstation",
    tris: 15000,
    tex: 1024,
    meshy: 30000,
    desc: "printer's composing workstation: a slanted double type-case frame on tall legs holding two compartmented wooden type cases, a metal composing stick, a galley tray of set metal type, and a small round ink dabber resting on the sloped top",
    uses: "print shop composition area",
    reuse: "type-cases exists but is only the cases, not the full standing composing frame/galley",
  },
  {
    key: "printer-drying-rack",
    tris: 10000,
    tex: 1024,
    meshy: 20000,
    desc: "tall wooden printer's drying rack with horizontal cord lines strung between two uprights, draped with several freshly printed rectangular paper sheets hanging to dry",
    uses: "print shop drying area",
    reuse: "drying-line-rack considered but it reads as laundry linens; this is a printer's sheet-drying rack",
  },
  {
    key: "merchant-scale-measure",
    tris: 8000,
    tex: 512,
    meshy: 18000,
    desc: "merchant's balance scale on a turned wooden stand, with a central iron beam, two round brass weighing pans hung on chains, a set of stacked graduated weights, and a wooden dry-goods measuring scoop at its base",
    uses: "shops, counting house, provisioner, customs",
    reuse: "none",
  },
  {
    key: "court-record-pigeonholes",
    tris: 12000,
    tex: 1024,
    meshy: 24000,
    desc: "tall wooden record cabinet with a grid of open pigeonhole compartments stuffed with rolled parchment documents, tied paper bundles, and a few bound ledgers",
    uses: "court, customhouse, counting house records wall",
    reuse: "none",
  },
  {
    key: "court-sealing-desk",
    tris: 10000,
    tex: 1024,
    meshy: 20000,
    desc: "colonial clerk's sloped writing desk on four legs, its top holding an inkwell with quill, a stick of red sealing wax, a brass seal matrix, folded documents, and a small candle in a holder for melting wax",
    uses: "court, customhouse sealing station",
    reuse: "clerk-desk exists but lacks the sealing implements and sloped sealing-desk form",
  },
  {
    key: "customhouse-counter-gate",
    tris: 15000,
    tex: 1024,
    meshy: 30000,
    desc: "heavy customhouse service counter of aged oak with a paneled front and a raised writing top, and a hinged swing gate section at one end that opens the counter to let an officer pass, iron hinges",
    uses: "customhouse main counter",
    reuse: "shop-counter-long considered but it is an open shop counter without the official swing-gate passage",
  },
  {
    key: "crown-arms-1760",
    tris: 8000,
    tex: 1024,
    meshy: 18000,
    desc: "carved and painted wooden royal coat of arms of Great Britain of about the year 1760, a quartered shield bearing the three English lions, the Scottish lion, the French fleurs-de-lis and the Irish harp, flanked by a crowned lion and a unicorn supporter, in flat restrained mid-eighteenth-century Georgian heraldic carving and paint",
    uses: "customhouse, court crown authority wall piece",
    reuse: "none (must be historically correct 1760 arms, not Victorian)",
  },
  {
    key: "customs-seizure-shelf",
    tris: 12000,
    tex: 1024,
    meshy: 24000,
    desc: "rough wooden storage shelf unit holding seized contraband goods: bundled bolts of cloth, small casks, a wooden tea chest, tied crates, and paper-tagged parcels",
    uses: "customhouse seizure store room",
    reuse: "none",
  },
  {
    key: "meetinghouse-box-pew-block",
    tris: 12000,
    tex: 1024,
    meshy: 24000,
    desc: "block of colonial enclosed paneled box pews, waist-high wooden partition walls forming square enclosures each with a small hinged door and inward-facing bench seating, plain painted pine",
    uses: "meetinghouse seating (replaces generic slip-pew block)",
    reuse: "church-pew-block exists but reads as 19th-century open slip pews, not enclosed box pews",
  },
  {
    key: "meetinghouse-pulpit-soundingboard",
    tris: 15000,
    tex: 1024,
    meshy: 30000,
    desc: "tall plain paneled colonial tub pulpit raised on a single post, reached by a narrow winding wooden stair with a rail, topped by a suspended polygonal wooden sounding board canopy above it, with no cross and no altar",
    uses: "meetinghouse pulpit hero",
    reuse: "church-pulpit exists but lacks the raised tub form, stair, and sounding board",
  },
  {
    key: "meetinghouse-gallery-impression",
    tris: 20000,
    tex: 1024,
    meshy: 30000,
    desc: "modular straight section of a colonial meetinghouse gallery balcony front, a paneled balustraded gallery face carried on plain slender timber columns, plain painted wood, square-cut ends for tiling",
    uses: "meetinghouse upper gallery (repeatable module)",
    reuse: "none",
  },
  {
    key: "meetinghouse-deacons-set",
    tris: 8000,
    tex: 512,
    meshy: 18000,
    desc: "colonial deacons' furniture set grouped as one composite prop: a long plain wooden communion table, two flanking backless benches, a small slanted Bible book stand, and two low wooden foot-warmer boxes, with no altar and no cross",
    uses: "meetinghouse front, below pulpit",
    reuse: "none",
  },
  {
    key: "tavern-serving-dresser",
    tris: 12000,
    tex: 1024,
    meshy: 24000,
    desc: "colonial tavern serving dresser, a tall pine cupboard with an open plate-rack top displaying pewter plates and hanging tankards, a middle serving shelf, and a closed cupboard base with two drawers",
    uses: "tavern serving area",
    reuse: "tavern-bar-barrels / dresser-shelves considered but neither is a plate-rack serving dresser",
  },
  {
    key: "warehouse-platform-scale",
    tris: 12000,
    tex: 1024,
    meshy: 24000,
    desc: "warehouse weighing station: a low heavy timber platform beam scale with an iron weigh beam and hanging counterweights over a sturdy oak platform, with a stack of graduated iron weights beside it",
    uses: "warehouse, wharf goods weighing",
    reuse: "none (merchant-scale is a small counter balance, not a floor platform scale)",
  },
  {
    key: "warehouse-hoist-tackle",
    tris: 10000,
    tex: 1024,
    meshy: 20000,
    desc: "warehouse block-and-tackle hoist: a wooden and iron multi-sheave pulley block system threaded with coiled hemp rope ending in a large iron cargo hook, hanging from a short timber beam bracket",
    uses: "warehouse loft, wharf loading",
    reuse: "timber-crane considered but that is the full dockside crane, not the detachable block-and-tackle",
  },

  // ---- Trade kits (12-15k / 1024 each) ----
  {
    key: "chandlery-stock-cluster",
    tris: 15000,
    tex: 1024,
    meshy: 30000,
    desc: "ship chandler's stock cluster grouped as one composite prop: coils of tarred rope, wooden blocks and pulleys, an oil lantern, tin candle molds, bundles of tallow candles, a small keg, and rolled canvas",
    uses: "chandlery shop trade dressing",
    reuse: "none",
  },
  {
    key: "ropewalk-laying-rig",
    tris: 15000,
    tex: 1024,
    meshy: 30000,
    desc: "rope-maker's laying rig: a wooden ropewalk stand with a hand-crank twisting head, several iron hooks holding twisted hemp yarns, a grooved wooden top separator, and a coil of finished rope on the ground",
    uses: "ropewalk trade interior",
    reuse: "rope-coil-large is only a coil, not the laying rig",
  },
  {
    key: "tailor-workbench-stock",
    tris: 15000,
    tex: 1024,
    meshy: 30000,
    desc: "tailor's workbench cluster: a low wooden work table topped with folded bolts of wool and linen cloth, large iron shears, a pressing goose iron, spools of thread, a pincushion, and a paper pattern",
    uses: "tailor trade interior",
    reuse: "none",
  },
  {
    key: "shoemaker-workbench-stock",
    tris: 15000,
    tex: 1024,
    meshy: 30000,
    desc: "shoemaker's cobbler workbench: a low wooden bench with an iron shoe last, a leather apron draped over it, awls and a hammer, cut leather pieces, a partly finished shoe, and a small pot of nails",
    uses: "shoemaker trade interior",
    reuse: "none",
  },
  {
    key: "baker-stock-cluster",
    tris: 15000,
    tex: 1024,
    meshy: 30000,
    desc: "baker's stock cluster grouped as one composite prop: a wooden table with round loaves of bread, a long wooden bread peel, a dough trough, a cloth sack of flour, and stacked baking pans",
    uses: "bakery trade interior",
    reuse: "none",
  },
  {
    key: "provisions-stock-cluster",
    tris: 15000,
    tex: 1024,
    meshy: 30000,
    desc: "provisioner's stock cluster grouped as one composite prop: a barrel of salted meat, cloth sacks of grain, a wheel of cheese, strings of dried onions, a wooden crate of root vegetables, and stacked wooden boxes",
    uses: "provisions / general store trade interior",
    reuse: "none",
  },
  {
    key: "bookseller-stock-cluster",
    tris: 15000,
    tex: 1024,
    meshy: 30000,
    desc: "bookseller's stock cluster grouped as one composite prop: a wooden display table stacked with leather-bound books, a small open bookcase filled with more books, a few rolled maps, and pamphlets tied in bundles",
    uses: "bookseller trade interior",
    reuse: "bookshelf-ledgers considered but that is a records shelf, not a bookseller retail stock display",
  },
];

export const KEYS = QUEUE.map((q) => q.key);
