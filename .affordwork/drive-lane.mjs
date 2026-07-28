// Drive the Shambles lane past the constable stop (spawn past the trigger), at
// ground level, to see whether the natural street path wedges or is forced to
// climb props. Also attribute the heaviest scene meshes by world position.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:5273";
const OUT = new URL("./drive-lane/", import.meta.url).pathname;
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
page.on("console", (m) => { const t = m.text(); if (/non-penetration violated/.test(t)) viol.push(t); });

async function waitRuntime() {
  for (let i = 0; i < 160; i++) {
    const t = await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null);
    if (t !== null) return true; await sleep(250);
  } return false;
}

// A driven leg: spawn at `at` toward `toward`, hold keys, log the trace.
async function leg(name, at, toward, keys, secs) {
  log(`\n[${name}] spawn ${at}->${toward} keys=${keys.join("+")}`);
  await page.goto(`${BASE}/src/mission/floor.html?bare=1&at=${at}&toward=${toward}&encounterVerdict=correct`,
    { waitUntil: "commit", timeout: 120000 });
  await waitRuntime(); await sleep(1000);
  await page.mouse.click(640, 400).catch(() => {}); await sleep(1400);
  const trace = []; const verbs = new Set();
  for (const k of keys) await page.keyboard.down(k);
  const steps = Math.round((secs * 1000) / 150);
  for (let i = 0; i < steps; i++) {
    await sleep(150);
    const s = await page.evaluate(() => {
      const rt = window.__floor; if (!rt?.motion) return null; const m = rt.motion;
      return { t: rt.ticks, x: +m.pos.x.toFixed(2), y: +m.pos.y.toFixed(2), z: +m.pos.z.toFixed(2),
        grounded: m.grounded, verb: rt.flow?.verb ?? null, prev: rt.flow?.previewVerb ?? null,
        speed: +Math.hypot(m.vel.x, m.vel.z).toFixed(2) };
    }).catch(() => null);
    if (s) { trace.push(s); if (s.verb && s.verb !== "NONE") verbs.add(s.verb); }
  }
  for (const k of keys) await page.keyboard.up(k);
  const s0 = trace[0], sN = trace.at(-1);
  const advanced = sN && s0 ? +(sN.x - s0.x).toFixed(2) : 0;
  // Detect a hard stall: 1.5s window with <0.15m x-change while grounded, verb NONE.
  let stall = null;
  for (let i = 10; i < trace.length; i++) {
    if (Math.abs(trace[i].x - trace[i - 10].x) < 0.15 && trace[i].grounded && trace[i].speed < 0.2) { stall = trace[i]; break; }
  }
  log(`[${name}] start x=${s0?.x} end x=${sN?.x} advanced=${advanced}m verbs=[${[...verbs].join(",")}]`);
  log(`[${name}] stall=${stall ? JSON.stringify(stall) : "none"} viol=${viol.length}`);
  await page.screenshot({ path: `${OUT}${name}.png` }).catch(() => {});
  return { name, advanced, verbs: [...verbs], stall, trace };
}

const legs = [];
// The natural ground run east through the market, standing (no crouch): hits the
// hoist duck-frame at x~25.9.
legs.push(await leg("lane-run-stand", "B_VAULT_OUT", "B_STREET_E", ["KeyW", "ShiftLeft"], 8));
// Same with crouch held (does the duck-under pass?).
legs.push(await leg("lane-run-crouch", "B_VAULT_OUT", "B_STREET_E", ["KeyW", "ShiftLeft", "ControlLeft"], 8));
// From mid-street into Dock Square.
legs.push(await leg("mid-to-dock", "B_STREET_MID", "C_SQUARE_W", ["KeyW", "ShiftLeft"], 9));
writeFileSync(`${OUT}legs.json`, JSON.stringify(legs, null, 2));

// ---- heavy-mesh attribution by world position (full scenery) ------------
await page.goto(`${BASE}/src/mission/floor.html?hold=0&at=B_STREET_W&toward=B_STREET_E`, { waitUntil: "commit", timeout: 120000 });
await waitRuntime(); await sleep(6000);
const heavy = await page.evaluate(() => {
  const st = window.__stage; if (!st) return null;
  const THREE_pos = new (window.THREE?.Vector3 ?? function(){})();
  const meshes = [];
  st.scene.updateMatrixWorld(true);
  st.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const tris = g?.index ? g.index.count / 3 : (g?.attributes?.position ? g.attributes.position.count / 3 : 0);
    const p = { x: 0, y: 0, z: 0 };
    o.getWorldPosition(p);
    meshes.push({ tris: Math.round(tris), x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1), name: o.name });
  });
  meshes.sort((a, b) => b.tris - a.tris);
  return meshes.slice(0, 25);
}).catch((e) => String(e));
log("\n[heavy meshes by tris @world pos]");
log(JSON.stringify(heavy, null, 1));
writeFileSync(`${OUT}heavy.json`, JSON.stringify(heavy, null, 2));
log("\npage errors:", perr.length, perr.slice(0, 3));
await browser.close();
log("DONE");
