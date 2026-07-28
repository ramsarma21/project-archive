// Measure the Shambles street after the constable stop: perf (draw calls,
// triangles, frame time) at street level, a per-mesh triangle breakdown, and a
// forward-run passability trace. Wall-clock frame counting so it cannot hang.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:5273";
const OUT = new URL("./measure-street/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader",
    "--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const perr = [];
page.on("pageerror", (e) => perr.push(String(e).slice(0, 200)));

async function waitRuntime() {
  for (let i = 0; i < 160; i++) {
    const t = await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null);
    if (t !== null) return true;
    await sleep(250);
  }
  return false;
}

async function perfAt(name, at, toward) {
  log(`[${name}] navigating...`);
  await page.goto(`${BASE}/src/mission/floor.html?hold=0&at=${at}&toward=${toward}&encounterVerdict=correct`,
    { waitUntil: "commit", timeout: 120000 });
  const up = await waitRuntime();
  log(`[${name}] runtime up=${up}`);
  if (!up) return { name, up: false };
  await sleep(6000); // let GLBs load and frames settle

  // Frame timing: count rAF frames over a 3s wall-clock window (bounded).
  const frame = await page.evaluate(() => new Promise((resolve) => {
    let frames = 0; const t0 = performance.now(); let last = t0; const deltas = [];
    function tick(t) { frames++; deltas.push(t - last); last = t; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); }
    requestAnimationFrame(tick);
    setTimeout(() => {
      const elapsed = performance.now() - t0;
      deltas.sort((a, b) => a - b);
      resolve({ frames, elapsedMs: +elapsed.toFixed(0), fps: +(frames / (elapsed / 1000)).toFixed(1),
        medMs: deltas.length ? +deltas[Math.floor(deltas.length / 2)].toFixed(1) : null,
        p95Ms: deltas.length ? +deltas[Math.floor(deltas.length * 0.95)].toFixed(1) : null });
    }, 3300);
  })).catch((e) => ({ error: String(e).slice(0, 80) }));
  log(`[${name}] frame=${JSON.stringify(frame)}`);

  const gfx = await page.evaluate(() => {
    const st = window.__stage;
    const out = { render: null, top: [], byAsset: {}, totalMeshes: 0 };
    if (!st || !st.gl) return out;
    const r = st.gl.info.render;
    out.render = { calls: r.calls, triangles: r.triangles, geometries: st.gl.info.memory.geometries, textures: st.gl.info.memory.textures };
    const meshes = [];
    st.scene.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry;
      const tris = g?.index ? g.index.count / 3 : (g?.attributes?.position ? g.attributes.position.count / 3 : 0);
      let anc = o; while (anc && !(anc.userData && anc.userData.glbKey)) anc = anc.parent;
      const key = anc?.userData?.glbKey ?? o.name ?? "?";
      meshes.push({ tris, key });
    });
    meshes.sort((a, b) => b.tris - a.tris);
    out.top = meshes.slice(0, 12).map((m) => ({ key: m.key, tris: Math.round(m.tris) }));
    const agg = {};
    for (const m of meshes) { agg[m.key] = agg[m.key] || { tris: 0, meshes: 0 }; agg[m.key].tris += m.tris; agg[m.key].meshes += 1; }
    out.byAsset = Object.fromEntries(Object.entries(agg).sort((a, b) => b[1].tris - a[1].tris).slice(0, 20)
      .map(([k, v]) => [k, { tris: Math.round(v.tris), meshes: v.meshes }]));
    out.totalMeshes = meshes.length;
    return out;
  }).catch((e) => ({ error: String(e).slice(0, 80) }));
  log(`[${name}] render=${JSON.stringify(gfx.render)} totalMeshes=${gfx.totalMeshes}`);
  log(`[${name}] byAsset=${JSON.stringify(gfx.byAsset)}`);

  await page.screenshot({ path: `${OUT}${name}.png` }).catch(() => {});
  return { name, up: true, frame, gfx };
}

const views = [];
views.push(await perfAt("shambles-east", "B_STREET_W", "B_STREET_E"));
views.push(await perfAt("dock-square", "C_SQUARE_W", "B_STREET_W"));
writeFileSync(`${OUT}perf.json`, JSON.stringify(views, null, 2));

// ---- passability forward-run from the constable stop --------------------
log("[fwd] navigating bare run...");
await page.goto(`${BASE}/src/mission/floor.html?bare=1&at=B_STREET_W&toward=B_STREET_E&encounterVerdict=correct`,
  { waitUntil: "commit", timeout: 120000 });
await waitRuntime();
await sleep(1200);
await page.mouse.click(640, 400).catch(() => {});
await sleep(1400);
const viol = [];
page.on("console", (m) => { const t = m.text(); if (/non-penetration violated/.test(t)) viol.push(t); });

const trace = [];
await page.keyboard.down("KeyW");
await page.keyboard.down("ShiftLeft");
for (let i = 0; i < 60; i++) {
  await sleep(150);
  const s = await page.evaluate(() => {
    const rt = window.__floor; if (!rt?.motion) return null;
    const m = rt.motion;
    return { t: rt.ticks, x: +m.pos.x.toFixed(2), y: +m.pos.y.toFixed(2), z: +m.pos.z.toFixed(2),
      grounded: m.grounded, verb: rt.flow?.verb ?? null, speed: +Math.hypot(m.vel.x, m.vel.z).toFixed(2) };
  }).catch(() => null);
  if (s) trace.push(s);
}
await page.keyboard.up("KeyW");
await page.keyboard.up("ShiftLeft");
const startX = trace[0]?.x, endX = trace.at(-1)?.x;
log("\n=== FORWARD RUN from B_STREET_W(x17.8) toward B_STREET_E(x39.4) ===");
log(`start x=${startX} end x=${endX} advanced=${(endX - startX).toFixed(2)}m samples=${trace.length}`);
let stuck = null;
for (let i = 6; i < trace.length; i++) { if (Math.abs(trace[i].x - trace[i - 6].x) < 0.15 && trace[i].grounded) { stuck = trace[i]; break; } }
log("first stall:", stuck ? JSON.stringify(stuck) : "none");
log("violations:", viol.length, "last6:", JSON.stringify(trace.slice(-6)));
writeFileSync(`${OUT}forward-run.json`, JSON.stringify({ trace, viol }, null, 2));
log("page errors:", perr.length, perr.slice(0, 3));
await browser.close();
log("DONE");
