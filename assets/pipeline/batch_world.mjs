// Generate the Day 1 world asset kit with Meshy text-to-3D.
// Usage: node assets/pipeline/batch_world.mjs
import { spawn } from "node:child_process";

// Grounded-realism 1765 Boston building/prop kit. Each asset is a standalone
// GLB placed by the district assembler. No characters here.
const KIT = [
  ["bldg-printshop", "Realistic 1765 colonial Boston two story print shop building exterior, timber frame with weathered dark red painted clapboard siding, steep wood shingle gable roof, brick chimney, large multi-pane shop window on ground floor, wooden door, small sash windows upstairs, stone foundation, historically accurate New England colonial architecture, aged and weathered, no people, no text signs"],
  ["bldg-brick", "Realistic 1765 colonial Boston three story brick townhouse, Georgian style, red brick with lime mortar, white painted sash windows with small panes, wooden shutters, granite lintels, steep slate roof with dormers, two brick chimneys, worn entrance steps, historically accurate, aged weathered brick, no people, no signs"],
  ["bldg-clapboard", "Realistic 1765 colonial New England wooden house, two stories, weathered gray unpainted clapboard siding, steep wood shingle roof, central brick chimney, small multi-pane windows with shutters, plank door, stone foundation, slightly crooked with age, historically accurate, no people, no signs"],
  ["bldg-counting", "Realistic 1765 colonial Boston merchant counting house, two story building, ground floor brick and upper floor painted mustard yellow clapboard, wide warehouse door and hoist beam, multi-pane windows, wood shingle roof, brick chimney, weathered, historically accurate, no people, no signs"],
  ["bldg-customhouse", "Realistic 1765 colonial Boston official brick building, Georgian civic architecture, two and a half stories, red brick, white painted door surround with pediment and columns, tall first floor sash windows, hipped slate roof with balustrade and cupola, stone steps, dignified government building, historically accurate, no people, no signs, no flag"],
  ["press-common", "Realistic 18th century English common printing press, large wooden frame press with heavy oak timbers, central wooden screw and iron bar lever, flat stone bed on rolling carriage, tympan and frisket frames, ink stained wood, historically accurate colonial print shop equipment, no people"],
  ["type-cases", "Realistic 18th century printer's type case work station, slanted double wooden case stand with many small compartments holding metal letter type, worn oak wood, ink stains, historically accurate colonial printing equipment, no people"],
  ["notice-board", "Realistic 18th century town notice board, weathered vertical wooden board panel mounted on two sturdy oak posts, small wooden roof cap, tattered paper notices pinned to it, aged gray wood, historically accurate colonial town square fixture, no readable text"],
  ["hand-cart", "Realistic 18th century wooden hand cart, two large wooden spoked wheels with iron rims, long pull handles, weathered oak plank bed with low sides, historically accurate colonial delivery cart, no people"],
  ["barrel-group", "Realistic cluster of three 18th century wooden barrels of different sizes, oak staves with rusted iron hoops, weathered and stained, one barrel on its side, historically accurate colonial cargo, no people"],
  ["crate-stack", "Realistic stack of 18th century wooden shipping crates and burlap sacks, rough sawn pine boards, rope, weathered, historically accurate colonial dock cargo, no people"],
  ["market-stall", "Realistic 18th century wooden market stall, simple timber frame with canvas awning roof, plank counter table, baskets of vegetables and goods, weathered wood, historically accurate colonial street market, no people, no text"],
  ["liberty-elm", "Realistic massive old American elm tree, very large spreading canopy, thick gnarled trunk with heavy low branches, full green summer foliage, 120 year old tree, photorealistic bark texture, no people"],
  ["well-pump", "Realistic 18th century town water pump, wooden post pump with iron handle and spout, stone trough basin below, weathered oak, cobblestones around base, historically accurate colonial street fixture, no people"],
  ["fence-gate", "Realistic 18th century wooden dock gate barrier, heavy timber gate with cross bracing across a passage, iron hinges and chain with padlock, weathered gray wood, historically accurate colonial, no people"],
  ["clerk-desk", "Realistic 18th century clerk's writing desk, tall slanted oak desk with high stool, pigeonhole shelf on top stuffed with rolled papers, quill and ink pot, candlestick, worn dark wood, historically accurate colonial office furniture, no people"],
  ["shop-counter", "Realistic 18th century shop counter, long oak plank counter with paneled front, brass scale on top, ledger book, shelves behind, worn wood, historically accurate colonial store furniture, no people"],
  ["cloth-bolts", "Realistic stack of 18th century fabric bolts, rolls of wool and linen cloth in muted indigo brown and cream colors, stacked on a low wooden pallet, historically accurate colonial merchant goods, no people"],
];

const CONCURRENCY = 2;
let index = 0;
let active = 0;
let failures = 0;

function runNext() {
  if (index >= KIT.length) {
    if (active === 0) {
      console.log(failures ? `WORLD DONE WITH ${failures} FAILURES` : "ALL WORLD ASSETS DONE");
      process.exit(failures ? 1 : 0);
    }
    return;
  }
  const [name, prompt] = KIT[index++];
  active++;
  console.log(`[world] starting ${name}`);
  const child = spawn("node", ["assets/pipeline/gen_prop.mjs", name, prompt], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", (code) => {
    active--;
    if (code !== 0) { failures++; console.error(`[world] ${name} FAILED (${code})`); }
    else console.log(`[world] ${name} complete`);
    runNext();
  });
  if (active < CONCURRENCY) runNext();
}

runNext();
