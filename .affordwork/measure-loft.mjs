// Measure the VERTICAL behaviour of authored transitions in the running game:
// how far the solved foot rides above the surface under it, per tick. A vault
// that lofts over its obstacle reads a large lift mid-cross; the goal of Stage 2
// (solver owns Y) is for the body to conform to the obstacle instead.
//
//   node .affordwork/measure-loft.mjs [baseURL] [seed] [secondsPer]
import { chromium } from "playwright";
const BASE = process.argv[2] ?? "http://localhost:5273";
const SEED = process.argv[3] ?? "0xb057";
const SECS = Number(process.argv[4]) || 6;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// A representative spread: two ground vaults with loft, a roof vault, a climb-up
// (control: a bare-face rise SHOULD read large lift and that is correct).
const CASES = [
  ["F_VAULT_IN", "F_VAULT_OUT", "VAULT"],
  ["D2_VENT_IN_0", "D2_VENT_OUT_0", "VAULT"],
  ["D_VAULT_IN_0", "D_VAULT_OUT_0", "VAULT"],
  ["C_LANE_GATE_IN", "C_LANE_GATE_OUT", "CLIMB_OVER"],
  ["D2_OUTSIDE", "E_BUTTRESS", "CLIMB_UP(control)"],
];

const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => log("PAGEERR", String(e).slice(0, 160)));
async function waitRuntime() { for (let i = 0; i < 200; i++) { const t = await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null); if (t !== null) return true; await sleep(150); } return false; }
const READ = () => page.evaluate(() => { const rt = window.__floor; if (!rt) return null; const m = rt.motion; return { grounded: m.grounded, preview: rt.flow?.previewVerb, verb: rt.flow?.verb }; }).catch(() => null);

for (const [inNode, outNode, label] of CASES) {
  await page.goto(`${BASE}/src/mission/floor.html?at=${inNode}&toward=${outNode}&back=1.2&bare=1&seed=${SEED}`, { waitUntil: "commit", timeout: 60000 });
  if (!(await waitRuntime())) { log(`${label} ${inNode}: NO RUNTIME`); continue; }
  await sleep(1200);
  await page.mouse.click(640, 400).catch(() => {});
  await page.evaluate(() => window.__diag?.reset?.()).catch(() => {});
  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("KeyW");
  const start = Date.now(); let jumpCd = 0;
  while (Date.now() - start < SECS * 1000) {
    const s = await READ();
    if (jumpCd > 0) jumpCd -= 1;
    if (s?.grounded && jumpCd === 0 && ["JUMP", "JUMP_GAP", "LEAP_OF_FAITH"].includes(s.preview)) { await page.keyboard.press("Space").catch(() => {}); jumpCd = 4; }
    await sleep(70);
  }
  await page.keyboard.up("KeyW").catch(() => {});
  await page.keyboard.up("ShiftLeft").catch(() => {});
  const authored = await page.evaluate(() => window.__diag?.authored ?? []).catch(() => []);
  if (!authored.length) { log(`${label} ${inNode}->${outNode}: no authored ticks (not committed)`); continue; }
  let maxLift = 0, maxDiv = 0;
  const profile = [];
  for (const a of authored) {
    if (a.liftM !== null && a.liftM > maxLift) maxLift = a.liftM;
    if (a.divergenceM > maxDiv) maxDiv = a.divergenceM;
    profile.push(a.liftM === null ? "-" : a.liftM.toFixed(2));
  }
  log(`\n${label} ${inNode}->${outNode}: ticks=${authored.length} maxLift=${maxLift.toFixed(3)}m maxDiv=${maxDiv.toFixed(3)}m`);
  log(`  lift/tick: ${profile.join(" ")}`);
}
await browser.close();
