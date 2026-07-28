// Minimal reachability smoke: load the floor harness, confirm the runtime ticks.
import { chromium } from "playwright";
const BASE = process.argv[2] ?? "http://localhost:5173";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: [
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--ignore-gpu-blocklist",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.log("PAGEERR", String(e).slice(0, 200)));
const url = `${BASE}/src/mission/floor.html?hold=0&bare=1&seed=0xb057`;
console.log("goto", url);
await page.goto(url, { waitUntil: "commit", timeout: 60000 });
let up = false;
for (let i = 0; i < 100; i++) {
  const t = await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null);
  if (t !== null) { up = true; console.log("runtime up, ticks=", t); break; }
  await sleep(200);
}
if (!up) { console.log("RUNTIME NEVER CAME UP"); await browser.close(); process.exit(2); }
await page.mouse.click(640, 400).catch(() => {});
await page.keyboard.down("ShiftLeft");
await page.keyboard.down("KeyW");
await sleep(1500);
const s = await page.evaluate(() => {
  const rt = window.__floor; const m = rt.motion;
  return { tick: rt.ticks, pos: m.pos, verb: rt.flow?.verb, dropped: rt.droppedSteps, timeScale: rt.timeScale };
});
console.log("after 1.5s W+Shift:", JSON.stringify(s));
await page.keyboard.up("KeyW");
await browser.close();
console.log("SMOKE OK");
