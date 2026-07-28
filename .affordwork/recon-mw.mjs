// Reconnaissance for the mission-world worktree: dump the collision world and the
// render load near the Shambles/Dock Square, and the route node layout, so the
// three complaints (passability, prop density, lag) can be measured, not guessed.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:5273";
const OUT = new URL("./recon-mw/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

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
const perr = [];
page.on("pageerror", (e) => perr.push(String(e).slice(0, 200)));
page.on("console", (m) => {
  const t = m.text();
  if (/non-penetration|error|Error|violated/.test(t)) console.log("  [console]", t.slice(0, 160));
});

// Full scenery, drop straight into the run (hold=0), spawn at the true start.
await page.goto(`${BASE}/src/mission/floor.html?hold=0&encounterVerdict=correct`, { waitUntil: "commit", timeout: 120000 });
let ok = false;
for (let i = 0; i < 120; i++) {
  const t = await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null);
  if (t !== null) { ok = true; break; }
  await new Promise((r) => setTimeout(r, 250));
}
console.log("runtime up:", ok);
await new Promise((r) => setTimeout(r, 4000)); // let GLBs load and frames render

const info = await page.evaluate(() => {
  const rt = window.__floor;
  const world = rt.instance.world;
  // Route nodes with positions and section.
  const level = rt.instance.level ?? null;
  // Collision primitive counts.
  const counts = {
    blockers: world.blockers?.length ?? 0,
    platforms: world.platforms?.length ?? 0,
    decks: world.decks?.length ?? 0,
    masses: world.masses?.length ?? 0,
  };
  // Render scene stats from the r3f RootState captured on window.__stage.
  const st = window.__stage;
  let render = null;
  let sceneStats = null;
  if (st && st.gl) {
    const r = st.gl.info.render;
    render = { calls: r.calls, triangles: r.triangles, points: r.points, lines: r.lines };
    const mem = st.gl.info.memory;
    render.geometries = mem.geometries;
    render.textures = mem.textures;
    let meshes = 0, instanced = 0, instancedInstances = 0, groups = 0;
    st.scene.traverse((o) => {
      if (o.isMesh && !o.isInstancedMesh) meshes++;
      if (o.isInstancedMesh) { instanced++; instancedInstances += o.count ?? 0; }
      if (o.isGroup) groups++;
    });
    sceneStats = { meshes, instanced, instancedInstances, groups };
  }
  return {
    tick: rt.ticks,
    pos: rt.motion ? { x: +rt.motion.pos.x.toFixed(2), y: +rt.motion.pos.y.toFixed(2), z: +rt.motion.pos.z.toFixed(2) } : null,
    counts,
    render,
    sceneStats,
    bounds: world.bounds,
  };
});
console.log(JSON.stringify(info, null, 2));
writeFileSync(`${OUT}world-render.json`, JSON.stringify(info, null, 2));

await page.screenshot({ path: `${OUT}spawn.png` });
console.log("page errors:", perr.length, perr.slice(0, 3));
await browser.close();
