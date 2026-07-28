import { chromium } from "playwright";
const BASE = "http://localhost:5173";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.log("PAGEERR", String(e).slice(0, 300)));
page.on("console", (m) => { const t = m.text(); if (/diag|Diag|import|module|Cannot|error/i.test(t)) console.log("CONSOLE:", t.slice(0,200)); });
await page.goto(`${BASE}/src/mission/floor.html?hold=0&bare=1&seed=0xb057`, { waitUntil: "commit", timeout: 60000 });
for (let i=0;i<100;i++){ const t=await page.evaluate(()=>window.__floor?.ticks??null).catch(()=>null); if(t!==null) break; await sleep(200);}
await page.mouse.click(640,400).catch(()=>{});
await page.keyboard.down("ShiftLeft"); await page.keyboard.down("KeyW");
await sleep(2500);
const r = await page.evaluate(() => ({
  hasDiag: typeof window.__diag,
  frames: window.__diag?.frames?.length ?? null,
  embeds: window.__diag?.embeds?.length ?? null,
  authored: window.__diag?.authored?.length ?? null,
  ticks: window.__floor?.ticks ?? null,
  boot: window.__diagBoot ?? null,
}));
console.log("PROBE", JSON.stringify(r));
await browser.close();
