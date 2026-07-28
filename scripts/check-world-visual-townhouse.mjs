// check-world-visual-townhouse — a tight, four-angle capture of the Town House
// join between the brick body, the cornice/leads, and the cupola tower.
//
// The full sweep (check-world-visual-sweep.mjs) frames a whole placement from the
// route-approach bearing, which is the right frame for "does this look like a
// building" but the wrong one for "did the gap close": a wide frame where the sky
// band is a few pixels can look fine when it is not. So this drives the same
// free-fly capture camera the sweep uses, but points it at the JOIN — centred on
// the leads at 12.4m, framed tight enough that the band between the brick and the
// cupola fills the frame — from the four corners, so a gap on any face shows.
//
// It captures whatever the dev server is serving right now, labelled. Run it once
// against the shipped GLB, swap in the backup, run it again, and the two sets are
// the before/after the acceptance test asks for.
//
// USAGE
//   PLAYTHROUGH_BASE=http://127.0.0.1:4930 \
//     node scripts/check-world-visual-townhouse.mjs <label>
// Output: .affordwork/townhouse-fix/<label>-<bearing>.png

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const OUT = join(REPO, ".affordwork", "townhouse-fix");
mkdirSync(OUT, { recursive: true });

const LABEL = process.argv[2] ?? "shot";
const BASE = (process.env.PLAYTHROUGH_BASE ?? "http://127.0.0.1:4930").replace(/\/$/, "");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The Town House stands at x 46.5..57.5, z -5.5..5.5; the join the owner
// photographed runs from the cornice at 10.2m through the leads at 12.4m to the
// cupola drum. Centre the frame on that band and frame ~11m of height, so the
// crop shows the cornice below and the cupola above with the join in the middle.
// CAP_CENTRE / CAP_FRAMEH override it, so the same rig frames the elm effigies.
const CENTRE = (process.env.CAP_CENTRE ?? "52.0,12.6,0.0").split(",").map(Number);
const FRAME_H = Number(process.env.CAP_FRAMEH ?? 11.5);
const ELEV = Number(process.env.CAP_ELEV ?? 10);

// The four corners, so a sky band on any face is caught. Elevation is low (10deg)
// and slightly BELOW the join so open sky sits behind it — a floating slab reads
// against the sky, which is exactly how the defect presented.
const BEARINGS = [
  ["NE", [1, -1]],
  ["SE", [1, 1]],
  ["SW", [-1, 1]],
  ["NW", [-1, -1]],
];

const CAPTURE_FN = ({ centre, frameH, dir, exposure, boost, elevDeg }) => {
  const st = window.__stage;
  if (!st || !st.gl) return { err: "window.__stage.gl absent" };
  const cam = st.camera.clone();
  const vfov = (cam.fov * Math.PI) / 180;
  // Distance that makes frameH fill the viewport height, tight (margin 1.06).
  const dist = Math.max(3, (frameH * 0.5 / Math.tan(vfov / 2)) * 1.06);
  let dx = dir[0];
  let dz = dir[1];
  const len = Math.hypot(dx, dz) || 1;
  dx /= len; dz /= len;
  const el = (elevDeg * Math.PI) / 180;
  const horiz = Math.cos(el);
  cam.position.set(
    centre[0] + dx * horiz * dist,
    centre[1] + Math.sin(el) * dist,
    centre[2] + dz * horiz * dist,
  );
  cam.lookAt(centre[0], centre[1], centre[2]);
  cam.near = 0.1;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);

  const gl = st.gl;
  const prevExp = gl.toneMappingExposure;
  gl.toneMappingExposure = exposure;
  const saved = [];
  st.scene.traverse((o) => { if (o.isLight) { saved.push([o, o.intensity]); o.intensity *= boost; } });
  gl.render(st.scene, cam);
  const url = gl.domElement.toDataURL("image/png");
  gl.toneMappingExposure = prevExp;
  for (const [o, v] of saved) o.intensity = v;
  return { url };
};

async function main() {
  const { chromium } = await import("playwright");
  const opts = {
    headless: true,
    args: ["--headless=new", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"],
  };
  const { existsSync } = await import("node:fs");
  if (existsSync(CHROME)) opts.executablePath = CHROME;
  const browser = await chromium.launch(opts);
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
  page.on("pageerror", (e) => console.log("  [page error]", String(e).slice(0, 140)));

  const url = `${BASE}/src/mission/floor.html?hold=0`;
  await page.goto(url, { waitUntil: "commit", timeout: 120000 });
  let up = false;
  for (let i = 0; i < 300; i++) {
    if ((await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null)) !== null) { up = true; break; }
    await sleep(200);
  }
  if (!up) { await browser.close(); throw new Error(`mission runtime never came up at ${url}`); }
  await sleep(9000);

  for (const [name, dir] of BEARINGS) {
    const res = await page.evaluate(CAPTURE_FN, {
      centre: CENTRE, frameH: FRAME_H, dir,
      exposure: Number(process.env.CAP_EXPOSURE ?? 3.4),
      boost: Number(process.env.CAP_BOOST ?? 7),
      elevDeg: ELEV,
    }).catch((e) => ({ err: String(e).slice(0, 120) }));
    if (res.err) { console.log(`  ${name}: ERROR ${res.err}`); continue; }
    const file = join(OUT, `${LABEL}-${name}.png`);
    writeFileSync(file, Buffer.from(res.url.split(",")[1], "base64"));
    console.log(`  wrote ${file}`);
  }
  await browser.close();
}

await main();
