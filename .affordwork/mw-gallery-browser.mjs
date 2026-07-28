// REAL CLIENT proof: drop the actual browser client at the top of the scaffold
// (C_SCAFF_2) facing the gallery (C_GALLERY_W) — the direct short-run-up western
// approach — hold W+Shift, and record the running-game black box. The flow
// controller commits the real verb off geometry; window.__diag captures the
// strict (no-ignore) hull embed each tick, so a penetration in real play is seen.
//
//   node .affordwork/mw-gallery-browser.mjs [baseURL]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:5291";
const OUT = new URL("./mw-gallery-browser/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const browser = await chromium.launch({
  headless: true, executablePath: CHROME,
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader",
    "--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const perr = []; const viol = [];
page.on("pageerror", (e) => perr.push(String(e).slice(0, 200)));
page.on("console", (m) => { const t = m.text(); if (/non-penetration|violat/i.test(t)) viol.push(t); });

async function waitRuntime() {
  for (let i = 0; i < 200; i++) {
    const t = await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null);
    if (t !== null) return true; await sleep(150);
  }
  return false;
}
const READ = () => page.evaluate(() => {
  const rt = window.__floor; if (!rt || !rt.motion) return null; const m = rt.motion;
  return { tick: rt.ticks, x: +m.pos.x.toFixed(2), y: +m.pos.y.toFixed(2), z: +m.pos.z.toFixed(2),
    grounded: m.grounded, phase: m.phase, verb: rt.flow?.verb ?? null, prev: rt.flow?.previewVerb ?? null,
    speed: +Math.hypot(m.vel.x, m.vel.z).toFixed(2) };
}).catch(() => null);

const url = `${BASE}/src/mission/floor.html?at=C_SCAFF_2&toward=C_GALLERY_W&bare=1&seed=0xb057`;
await page.goto(url, { waitUntil: "commit", timeout: 60000 });
if (!(await waitRuntime())) { log("NO RUNTIME"); await browser.close(); process.exit(1); }
await sleep(1200);
await page.mouse.click(640, 400).catch(() => {});
await page.evaluate(() => { window.__diag?.reset?.(); }).catch(() => {});
const before = await READ();
log("spawn:", JSON.stringify(before));

await page.keyboard.down("ShiftLeft");
await page.keyboard.down("KeyW");
const seenVerbs = new Set();
let committedJumpGap = false, braked = false, maxY = before?.y ?? 0;
const trace = [];
const start = Date.now();
while (Date.now() - start < 22000) {
  const s = await READ();
  if (s) {
    trace.push(s);
    if (s.verb && s.verb !== "NONE") seenVerbs.add(s.verb);
    if (s.verb === "JUMP_GAP") committedJumpGap = true;
    if (s.prev === "EDGE_BRAKE" || s.verb === "EDGE_BRAKE") braked = true;
    if (s.y > maxY) maxY = s.y;
  }
  await sleep(40);
}
await page.keyboard.up("KeyW").catch(() => {});
await page.keyboard.up("ShiftLeft").catch(() => {});
const after = await READ();

const diag = await page.evaluate(() => {
  const d = window.__diag; if (!d) return null;
  const strictWorst = {};
  for (const e of d.embeds) for (const s of e.strict) {
    if (!(s.id in strictWorst) || s.depthM > strictWorst[s.id]) strictWorst[s.id] = s.depthM;
  }
  return { embedTicks: d.embeds.length, strictWorst };
}).catch(() => null);

writeFileSync(`${OUT}trace.json`, JSON.stringify(trace, null, 1));
log("final:", JSON.stringify(after));
log("verbs seen:", [...seenVerbs].join(",") || "(none)");
log("committed JUMP_GAP:", committedJumpGap, " braked:", braked, " apex y:", +maxY.toFixed(2));
const onGallery = after && after.x >= 47.5 - 0.05 && after.y > 5.2 && after.grounded;
log("landed on gallery (x>=47.5, y>5.2, grounded):", onGallery, "->", JSON.stringify(after));
log("diag:", JSON.stringify(diag));
log("non-penetration console violations:", viol.length, viol.slice(0, 2));
log("page errors:", perr.length, perr.slice(0, 2));
await page.screenshot({ path: `${OUT}final.png` }).catch(() => {});
await browser.close();
log(committedJumpGap && onGallery ? "\nRESULT: REAL-CLIENT LEAP OK ✓" : "\nRESULT: leap not confirmed ✗");
