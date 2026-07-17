// Generate + rig the Day 1 cast with Meshy (concurrency-limited).
// Usage: node assets/pipeline/batch_characters.mjs
import { spawn } from "node:child_process";

// Grounded-realism prompts. Period-accurate 1765 Boston, A-pose, single
// character, no weapons, no modern items. Kept concise for Meshy's prompt cap.
const CAST = [
  ["thomas", 1.74, "Realistic 1765 Boston merchant, age 48, solid build, weathered friendly face, natural gray-brown hair tied back, brown wool coat with cloth buttons, muted mustard waistcoat, white linen shirt and cravat, knee breeches, gray stockings, black buckled shoes, standing A-pose, full body, historically accurate colonial American clothing, no hat, no weapons, no modern elements"],
  ["pike", 1.7, "Realistic 1765 colonial court clerk, age 55, thin narrow shoulders, slight stoop, tired lined face, receding gray hair tied back, dark gray wool coat, faded brown waistcoat with ink-stained cuffs, white neckcloth, knee breeches, wool stockings, worn black shoes, standing A-pose, full body, historically accurate, no hat, no weapons, no modern elements"],
  ["clarke", 1.77, "Realistic 1765 Boston loyalist shopkeeper, age 45, upright careful posture, well groomed, neat olive green wool coat, subdued patterned waistcoat, clean white linen shirt and stock, knee breeches, white stockings, polished buckled shoes, standing A-pose, full body, prosperous but not aristocratic, historically accurate colonial clothing, no hat, no weapons, no modern elements"],
  ["rider", 1.76, "Realistic 1765 colonial post rider, age 30, lean weathered build, sun-darkened face, dark hair tied back, short practical brown riding coat, leather waistcoat, sturdy canvas breeches, riding boots, standing A-pose, full body, dusty travel-worn clothing, historically accurate, no hat, no weapons, no modern elements"],
  ["officer", 1.78, "Realistic 1765 British customs officer in civilian dress, age 40, stern face, practical dark blue wool coat with brass buttons, buff waistcoat, white shirt and stock, knee breeches, gray stockings, black buckled shoes, standing A-pose, full body, authoritative civil servant not soldier, historically accurate, no hat, no musket, no weapons, no modern elements"],
  ["townsman", 1.72, "Realistic 1765 Boston laborer, age 35, sturdy working build, plain rough linen shirt with rolled sleeves, simple brown wool waistcoat, worn canvas breeches, gray wool stockings, scuffed leather shoes, standing A-pose, full body, working class colonial clothing with visible wear and patches, historically accurate, no hat, no weapons, no modern elements"],
  ["townswoman", 1.62, "Realistic 1765 Boston working woman, age 38, practical sturdy build, plain blue-gray wool gown with fitted bodice, white linen apron, white linen cap, kerchief around shoulders, ankle-length petticoat, black leather shoes, standing A-pose, full body, working class colonial clothing, historically accurate, no modern elements"],
  ["playerboy", 1.58, "Realistic 1765 printer's apprentice boy, age 15, slim light build, youthful face, short brown hair, white linen shirt with rolled sleeves, dark gray wool waistcoat, ink-stained knee breeches, gray stockings, worn leather shoes, standing A-pose, full body, working class colonial American clothing, historically accurate, no hat, no bag, no weapons, no modern elements"],
];

const CONCURRENCY = 2;
let index = 0;
let active = 0;
let failures = 0;

function runNext() {
  if (index >= CAST.length) {
    if (active === 0) {
      console.log(failures ? `DONE WITH ${failures} FAILURES` : "ALL CHARACTERS DONE");
      process.exit(failures ? 1 : 0);
    }
    return;
  }
  const [name, height, prompt] = CAST[index++];
  active++;
  console.log(`[batch] starting ${name}`);
  const child = spawn("node", ["assets/pipeline/gen_character.mjs", name, String(height), prompt], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", (code) => {
    active--;
    if (code !== 0) { failures++; console.error(`[batch] ${name} FAILED (${code})`); }
    else console.log(`[batch] ${name} complete`);
    runNext();
  });
  if (active < CONCURRENCY) runNext();
}

runNext();
