// After-fix render metrics at the Shambles street + Dock Square, plus a
// screenshot of the now-passable lane. Fast: no frame-timing loop.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const BASE = "http://localhost:5273";
const OUT = new URL("./after-perf/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
async function up() { for (let i=0;i<160;i++){ const t=await page.evaluate(()=>window.__floor?.ticks??null).catch(()=>null); if(t!==null)return true; await sleep(250);} return false; }
async function at(name, a, t) {
  await page.goto(`${BASE}/src/mission/floor.html?hold=0&at=${a}&toward=${t}&encounterVerdict=correct`, { waitUntil: "commit", timeout: 120000 });
  await up(); await sleep(6000);
  const g = await page.evaluate(() => { const st=window.__stage; const r=st.gl.info.render; let inst=0; st.scene.traverse(o=>{if(o.isInstancedMesh)inst++;}); return { calls:r.calls, triangles:r.triangles, geometries:st.gl.info.memory.geometries, textures:st.gl.info.memory.textures, instancedMeshes:inst }; });
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log(name, JSON.stringify(g));
}
await at("shambles-east", "B_STREET_W", "B_STREET_E");
await at("dock-square", "C_SQUARE_W", "B_STREET_W");
await browser.close();
console.log("DONE");
