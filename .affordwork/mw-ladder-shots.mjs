// Capture every placed ladder from a SIDE vantage in the lean plane, showing
// both ends: the foot on the ground and the top on the served surface. Geometry
// comes from ladderDraws (geom.json), NOT the pure-vertical route nodes, so the
// lean is well defined even where the climb foot and served node share x,z.
//
//   node .affordwork/mw-ladder-shots.mjs [baseURL]
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:5280";
const SEED = "0xb057";
const OUT = new URL("./ladder-shots/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GEOM = JSON.parse(readFileSync(`${OUT}geom.json`, "utf8"));

// ladder id -> [footNode, servedNode] (spawn point so the world around it loads)
const SPAWN = {
  SCAFFOLD_1: ["C_SCAFF_FOOT", "C_SCAFF_1"],
  SCAFFOLD_2: ["C_SCAFF_1", "C_SCAFF_2"],
  CLOCK: ["C_GALLERY_EMID", "C_CLOCK"],
  CORNICE_E: ["C_CLOCK", "C_CORNICE_E"],
  TOWER_PLINTH: ["C_LEADS_TOWERFOOT", "C_TOWER_PLINTH"],
  LEANTO: ["E_BUTTRESS", "E_LEANTO"],
  RIDGE_W: ["D_MEETING_ROOF", "E_RIDGE"],
  RIDGE_S: ["E_GAMBREL_S", "E_RIDGE_W"],
  LOUVRE: ["E_RIDGE", "E_LOUVRE"],
};

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
const perr = [];
page.on("pageerror", (e) => perr.push(String(e).slice(0, 160)));

for (const draw of GEOM) {
  const key = draw.id.replace(/^LADDER_/, "");
  const [foot, top] = SPAWN[key] ?? [null, null];
  if (!foot) continue;
  const url = `${BASE}/src/mission/floor.html?at=${foot}&toward=${top}&hold=0&seed=${SEED}`;
  await page.goto(url, { waitUntil: "commit", timeout: 60000 });
  let up = false;
  for (let i = 0; i < 200; i++) {
    if ((await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null)) !== null) { up = true; break; }
    await sleep(150);
  }
  if (!up) { console.log(`${key}: no runtime`); continue; }
  await sleep(2500);

  // Hide the HUD DOM so the geometry is not covered by objective/encounter cards.
  await page.addStyleTag({ content: ".msn-hud, .msn-encounter, .msn-curtain { display:none !important; }" }).catch(() => {});

  const ok = await page.evaluate((d) => {
    const st = window.__stage;
    if (!st?.camera || !st.gl) return false;
    const foot = { x: d.foot[0], y: d.foot[1], z: d.foot[2] };
    const top = { x: d.top[0], y: d.top[1], z: d.top[2] };
    const mid = { x: (foot.x + top.x) / 2, y: (foot.y + top.y) / 2, z: (foot.z + top.z) / 2 };
    // Horizontal lean direction (foot->top) and the side perpendicular to it.
    let dx = top.x - foot.x, dz = top.z - foot.z;
    let len = Math.hypot(dx, dz);
    if (len < 0.05) { dx = 1; dz = 0; len = 1; } // pure vertical fallback
    const sx = -dz / len, sz = dx / len; // side, in the lean plane
    const dist = 5.5;
    // Slightly above the mid and a touch back along the lean, so both the foot
    // (on the ground) and the top (on the surface) are in frame.
    const cam = { x: mid.x + sx * dist + (dx / len) * 0.5, y: mid.y + 1.0, z: mid.z + sz * dist + (dz / len) * 0.5 };
    st.gl.toneMappingExposure = 3.4;
    const c = st.camera;
    if (c.fov) { c.fov = 55; c.updateProjectionMatrix?.(); }
    window.__ladderCam = () => { c.position.set(cam.x, cam.y, cam.z); c.lookAt(mid.x, mid.y, mid.z); c.updateMatrixWorld(); };
    if (!st.__patched) {
      const orig = st.gl.render.bind(st.gl);
      st.gl.render = (scene, camera) => { if (window.__ladderCam) window.__ladderCam(); orig(scene, camera); };
      st.__patched = true;
    }
    return true;
  }, draw).catch(() => false);

  await sleep(700);
  await page.screenshot({ path: `${OUT}${key}.png` });
  console.log(`${key}: n=${draw.count} foot=[${draw.foot.map((v)=>v.toFixed(1))}] top=[${draw.top.map((v)=>v.toFixed(1))}] framed=${ok}`);
}
console.log("page errors:", perr.length, perr.slice(0, 3));
await browser.close();
