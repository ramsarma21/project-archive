// Definitive running-client capture of an OFF-RIM plummet off the crown, per the
// verification standard (real game + window.__diag). Forces the jump off the
// south rim (where the design says a stroll "falls to the street") by driving
// the look south and holding run+jump, then reports the real motion trajectory,
// the __diag penetration ring, and a screenshot at the landing.
//   node .affordwork/repro-plummet.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "repro-elm-out");
mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:5273";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const READ = () => {
  const rt = window.__floor; if (!rt?.motion) return null; const m = rt.motion;
  return { y: +m.pos.y.toFixed(3), x: +m.pos.x.toFixed(2), z: +m.pos.z.toFixed(2), phase: m.phase, grounded: m.grounded, vy: +m.vel.y.toFixed(2) };
};
const DIAG = () => {
  const d = window.__diag; if (!d) return { available: false };
  let maxStrict = 0, id = null; for (const e of d.embeds) for (const s of e.strict) if (s.depthM > maxStrict) { maxStrict = s.depthM; id = s.id; }
  return { available: true, embedTicks: d.embeds.length, maxStrict: +maxStrict.toFixed(3), id };
};

const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--headless=new", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const url = `${BASE}/src/mission/floor.html?at=F_POST&toward=F_CROWD_S&encounterVerdict=correct`;
await page.goto(url, { waitUntil: "commit", timeout: 120000 });
for (let i = 0; i < 300; i++) { if ((await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null)) !== null) break; await sleep(200); }
await sleep(6000);
await page.mouse.click(640, 400).catch(() => {});
await page.evaluate(() => window.__diag?.reset?.()).catch(() => {});
// Look due SOUTH (−z): yaw = atan2(dx=0, dz=-1) = PI.
await page.evaluate(() => { const L = window.__look; if (L?.look) L.look.yaw = Math.PI; }).catch(() => {});
const spawn = await page.evaluate(READ);
console.log("spawn:", JSON.stringify(spawn));

await page.keyboard.down("KeyW");
const traj = []; let minY = spawn.y, jumped = false, landedY = null;
for (let i = 0; i < 90; i++) {
  const s = await page.evaluate(READ).catch(() => null);
  if (s) {
    traj.push({ t: i, ...s });
    minY = Math.min(minY, s.y);
    if (!jumped && i >= 2 && s.grounded) { await page.keyboard.press("Space").catch(() => {}); jumped = true; }
    if (jumped && s.grounded && i > 8 && landedY === null && s.y < spawn.y - 1) { landedY = s.y; }
  }
  if (i === 20) await page.screenshot({ path: join(OUT, "P-midfall.png") }).catch(() => {});
  await sleep(45);
}
await page.keyboard.up("KeyW").catch(() => {});
const end = await page.evaluate(READ);
const diag = await page.evaluate(DIAG);
await page.screenshot({ path: join(OUT, "P-landed.png") }).catch(() => {});
console.log("minY:", minY, "landing:", JSON.stringify(end), "__diag:", JSON.stringify(diag));
console.log("trajectory (every 4th):");
for (let i = 0; i < traj.length; i += 4) { const p = traj[i]; console.log(`  t=${String(p.t).padStart(2)} y=${String(p.y).padStart(6)} x=${String(p.x).padStart(6)} z=${String(p.z).padStart(6)} ${p.phase.padEnd(13)} vy=${p.vy} g=${p.grounded}`); }
writeFileSync(join(OUT, "P-plummet.json"), JSON.stringify({ url, spawn, minY, end, diag, traj }, null, 2));
await browser.close();
