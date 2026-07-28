// Prove the white-box and encounter-soft-lock detectors are NOT vacuous, by
// reproducing each fault in the live client and confirming the detector fires.
// (The regressions do not currently reproduce on this branch, so this is how we
// show the assertions would catch them if they did.)
import { chromium } from "playwright";
const BASE = process.argv[2] ?? "http://localhost:5373";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--headless=new", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });

// ---- 1) WHITE-BOX detector ------------------------------------------------
// Load the healthy mission, confirm whiteBoxes=0, then strip the base-color map
// off the instanced props and force their colour white (exactly the "texture did
// not bind" runtime failure) and confirm the census now reports white boxes.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${BASE}/src/mission/floor.html?hold=0&seed=0xb057&encounterVerdict=correct`, { waitUntil: "commit", timeout: 120000 });
  for (let i = 0; i < 250; i++) { if ((await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null)) !== null) break; await sleep(200); }
  await sleep(8000);
  const census = () => window.__stage && window.__stage.gl ? (() => {
    let whiteBoxes = 0; const ex = [];
    window.__stage.scene.traverse((o) => {
      if (!o.isMesh) return;
      const arr = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of arr) { if (!m) continue;
        const lit = m.type === "MeshStandardMaterial" || m.type === "MeshPhysicalMaterial";
        if (lit && !m.map && !o.isSkinnedMesh && m.color && m.color.r >= 0.85 && m.color.g >= 0.85 && m.color.b >= 0.85) { whiteBoxes++; if (ex.length < 5) ex.push(o.name || "(unnamed)"); }
      }
    });
    return { whiteBoxes, ex };
  })() : { error: "no stage" };
  const before = await page.evaluate(census);
  const corrupted = await page.evaluate(() => {
    let n = 0;
    window.__stage.scene.traverse((o) => {
      if (!o.isInstancedMesh) return;
      const arr = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of arr) { if (!m) continue; m.map = null; if (m.color) m.color.setRGB(1, 1, 1); n++; }
    });
    return n;
  });
  const after = await page.evaluate(census);
  console.log(`WHITE-BOX: before=${JSON.stringify(before)}  (stripped maps off ${corrupted} instanced materials)  after=${JSON.stringify(after)}`);
  console.log(`  => detector ${after.whiteBoxes > before.whiteBoxes ? "FIRES on injected fault (PASS)" : "did NOT fire (BAD)"}`);
  await page.close();
}

// ---- 2) ENCOUNTER SOFT-LOCK detector --------------------------------------
// Drop in at the ropewalk stop and drive into it, but NEVER answer — the exact
// shape of the soft-lock (the stop arms, the beat hangs, nothing resolves).
// Confirm it arms and stays unresolved long enough to trip the 30s timeout the
// gate uses. (The gate answers stops; here we withhold the answer to reproduce
// the hang and show the timeout catches it instead of waiting forever.)
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${BASE}/src/mission/floor.html?hold=0&seed=0xb057&encounterVerdict=correct`, { waitUntil: "commit", timeout: 120000 });
  for (let i = 0; i < 250; i++) { if ((await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null)) !== null) break; await sleep(200); }
  await sleep(4000);
  await page.mouse.click(640, 400).catch(() => {});
  const READ = () => page.evaluate(() => {
    const rt = window.__floor; const m = rt.motion;
    const req = rt.instance.objectives.filter((o) => o.required); const met = new Set(rt.satisfied);
    const cur = req.find((o) => !met.has(o.id)) ?? null; let wp = null;
    if (cur?.mark?.waypoint) { const w = cur.mark.waypoint(m.pos); if (w) wp = { x: w.pos.x, z: w.pos.z }; }
    return { pos: { x: m.pos.x, z: m.pos.z }, wp, enc: rt.encounters.map((e) => ({ id: e.def?.id ?? "?", phase: e.phase })) };
  }).catch(() => null);
  await page.keyboard.down("ShiftLeft"); await page.keyboard.down("KeyW");
  let armedAtS = null, resolvedAtS = null; const start = Date.now();
  const TIMEOUT = 30;
  while ((Date.now() - start) / 1000 < TIMEOUT + 8) {
    const tS = (Date.now() - start) / 1000;
    const s = await READ();
    if (s) {
      if (s.wp) { const yaw = Math.atan2(s.wp.x - s.pos.x, s.wp.z - s.pos.z); await page.evaluate((y) => { const L = window.__look; if (L?.look) L.look.yaw = y; }, yaw).catch(() => {}); }
      const stop = s.enc.find((e) => e.id === "SHAMBLES_STOP");
      if (stop && armedAtS === null && stop.phase !== "DORMANT") armedAtS = tS;
      if (stop && resolvedAtS === null && (stop.phase === "RESOLVED" || stop.phase === "RELEASED")) resolvedAtS = tS;
    }
    // deliberately do NOT answer the stop — reproduce the hang
    await sleep(120);
  }
  await page.keyboard.up("KeyW").catch(() => {}); await page.keyboard.up("ShiftLeft").catch(() => {});
  const armedForS = armedAtS !== null && resolvedAtS === null ? ((Date.now() - start) / 1000 - armedAtS) : 0;
  const trips = armedAtS !== null && resolvedAtS === null && armedForS > TIMEOUT;
  console.log(`SOFT-LOCK: SHAMBLES_STOP armedAt=${armedAtS === null ? "never" : armedAtS.toFixed(1) + "s"} resolvedAt=${resolvedAtS === null ? "NEVER (answer withheld)" : resolvedAtS.toFixed(1) + "s"} armedFor=${armedForS.toFixed(1)}s`);
  console.log(`  => soft-lock timeout (${TIMEOUT}s) ${trips ? "FIRES on withheld answer (PASS)" : (resolvedAtS !== null ? "did not fire — stop resolved" : "inconclusive")}`);
  await page.close();
}

await browser.close();
console.log("DONE");
