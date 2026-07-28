// Minimal smoke test: does the worktree client boot headless and tick?
import { chromium } from "playwright";
const BASE = process.argv[2] ?? "http://127.0.0.1:5273";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const perr = [];
page.on("pageerror", (e) => perr.push(String(e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error") perr.push("console:" + m.text().slice(0, 200)); });
const url = `${BASE}/src/mission/floor.html?at=E_BUTTRESS&toward=E_LEANTO&bare=1&seed=0xb057`;
await page.goto(url, { waitUntil: "commit", timeout: 60000 });
let ticks = null;
for (let i = 0; i < 200; i++) {
  ticks = await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null);
  if (ticks !== null) break;
  await sleep(150);
}
const motion = await page.evaluate(() => {
  const rt = window.__floor; if (!rt || !rt.motion) return null; const m = rt.motion;
  return { ticks: rt.ticks, pos: m.pos, phase: m.phase, diag: !!window.__diag };
}).catch(() => null);
console.log("ticks:", ticks);
console.log("motion:", JSON.stringify(motion));
console.log("pageerrors:", perr.length, perr.slice(0, 5));
await browser.close();
