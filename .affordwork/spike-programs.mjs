// Attribute the REMAINING spawn spike to the actual program(s) that link.
//
// Reuses spike-hunt's accelerated-client approach (real Chrome + GPU, NOT
// SwiftShader) but instead of only timing frames, it installs an in-page
// per-frame recorder the moment R3F's renderer exists (window.__stage.gl) and
// watches renderer.info.programs grow. When the program list gains an entry it
// records that frame's wall time, the diag frame deltaMs, and the NAME of every
// new program — so a link that lands on a long frame is attributed to the
// material type that compiled (a MeshDepthMaterial name == a shadow-pass depth
// variant; a MeshStandardMaterial == a beauty program).
//
//   node .affordwork/spike-programs.mjs [baseURL] [runs]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:5273";
const RUNS = Number(process.argv[3]) || 3;
const OUT = new URL("./spike-programs-out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// Recorder installed in-page. Waits for window.__stage, then every animation
// frame reads renderer.info.programs and the last diag frame, recording program
// growth with the frame cost it landed on. Runs for `frames` frames total,
// spanning the settle AND the first idle frames after the diag reset, so the
// spawn spike (which the prior worker put at post-reset frame 0-4) is inside it.
const RECORD = async (page, frames) => page.evaluate(async (nFrames) => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  // Wait for the R3F store handle the harness sets on the first drawn frame.
  for (let i = 0; i < 600; i++) {
    if (window.__stage?.gl) break;
    await raf();
  }
  const gl = window.__stage.gl;
  const seen = new Set();
  const growth = []; // { frame, tMs, deltaMs, added:[names], total }
  const nameOf = (p) => `${p.name ?? "?"}${p.cacheKey ? "" : ""}`;
  let didReset = false;
  const t0 = performance.now();
  for (let f = 0; f < nFrames; f++) {
    await raf();
    // Mirror the real driver: settle ~3s then reset the diag ring once, so the
    // recorded diag deltas below are the post-settle (gameplay-onset) frames.
    if (!didReset && performance.now() - t0 > 3000) {
      window.__diag?.reset?.();
      didReset = true;
    }
    const programs = gl.info.programs ?? [];
    const added = [];
    for (const p of programs) {
      const key = `${p.id}:${nameOf(p)}`;
      if (!seen.has(key)) {
        seen.add(key);
        added.push(nameOf(p));
      }
    }
    if (added.length) {
      const dframes = window.__diag?.frames ?? [];
      const last = dframes[dframes.length - 1];
      growth.push({
        frame: f,
        tMs: +(performance.now() - t0).toFixed(1),
        afterReset: didReset,
        deltaMs: last ? +last.deltaMs.toFixed(1) : null,
        added,
        total: programs.length,
      });
    }
  }
  // Final full census of the program cache, categorized.
  const programs = gl.info.programs ?? [];
  const census = programs.map((p) => ({
    id: p.id,
    name: p.name ?? "?",
    usedTimes: p.usedTimes,
    cacheKey: (p.cacheKey ?? "").slice(0, 600),
  }));
  // The post-reset (gameplay-onset) diag frames, for the spike verdict.
  const dframes = (window.__diag?.frames ?? []).map((x) => ({
    deltaMs: +x.deltaMs.toFixed(1),
    dropped: x.droppedThisFrame,
    steps: x.steps,
  }));
  return { growth, census, dframes, shadowEnabled: gl.shadowMap.enabled, shadowType: gl.shadowMap.type };
}, frames);

async function oneRun(runIdx) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ["--headless=new", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${BASE}/src/mission/floor.html?hold=0&seed=0xb057&encounterVerdict=correct`, { waitUntil: "commit", timeout: 120000 });
  // ~7s of frames at 60fps ≈ 420; cover the 3s settle + reset + idle onset.
  const result = await RECORD(page, 420);
  await browser.close();
  return result;
}

for (let r = 0; r < RUNS; r++) {
  log(`\n================ run ${r + 1}/${RUNS} ================`);
  const { growth, census, dframes, shadowEnabled, shadowType } = await oneRun(r);
  writeFileSync(`${OUT}run-${r + 1}.json`, JSON.stringify({ growth, census, dframes }, null, 2));

  // Categorize the census by program name.
  const byName = new Map();
  for (const c of census) byName.set(c.name, (byName.get(c.name) ?? 0) + 1);
  log(`shadowMap.enabled=${shadowEnabled} type=${shadowType}`);
  log(`TOTAL PROGRAMS: ${census.length}`);
  log(`  by name: ${[...byName.entries()].map(([n, c]) => `${n}×${c}`).join("  ")}`);

  log(`\nprogram GROWTH timeline (when each new program appeared):`);
  for (const g of growth) {
    log(`  frame ${String(g.frame).padStart(3)}  t=${String(g.tMs).padStart(7)}ms  ${g.afterReset ? "POST-reset" : "pre-reset "}  diagΔ=${g.deltaMs ?? "—"}ms  total=${g.total}  +[${g.added.join(", ")}]`);
  }

  // The post-reset spike, if any, and whether a new program landed near it.
  const spikes = dframes.map((f, i) => ({ i, ...f })).filter((f) => f.deltaMs > 83);
  log(`\npost-reset frames captured: ${dframes.length}`);
  log(`post-reset spikes >83ms: ${spikes.length}  ${spikes.map((s) => `[frame ${s.i}] ${s.deltaMs}ms drop${s.dropped}`).join("  ")}`);
  const worst = dframes.reduce((m, f) => Math.max(m, f.deltaMs), 0);
  log(`worst post-reset frame: ${worst}ms`);
}
log(`\n-> wrote ${OUT}`);
