import { chromium } from "playwright";
const BASE = "http://127.0.0.1:5273";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, executablePath: CHROME,
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const url = `${BASE}/src/mission/floor.html?at=D2_OUTSIDE&toward=E_BUTTRESS&bare=1&seed=0xb057`;
await page.goto(url, { waitUntil: "commit", timeout: 60000 });
const READ = () => page.evaluate(() => { const rt = window.__floor; if (!rt?.motion) return null; const m = rt.motion;
  return { tick: rt.ticks, pos: { x: +m.pos.x.toFixed(2), y: +m.pos.y.toFixed(2), z: +m.pos.z.toFixed(2) }, phase: m.phase, verb: rt.flow?.verb, preview: rt.flow?.previewVerb, speed: +Math.hypot(m.vel.x, m.vel.z).toFixed(2) }; }).catch(() => null);
for (let i = 0; i < 20 && (await READ())?.tick == null; i++) await sleep(150);
console.log("t0", JSON.stringify(await READ()));
await sleep(1200);
await page.mouse.click(640, 400).catch(() => {});
console.log("after-click", JSON.stringify(await READ()));
await page.keyboard.down("ShiftLeft"); await page.keyboard.down("KeyW");
for (let i = 0; i < 8; i++) { await sleep(400); console.log("t+"+((i+1)*0.4).toFixed(1), JSON.stringify(await READ())); }
await page.keyboard.up("KeyW"); await page.keyboard.up("ShiftLeft");
await browser.close();
