// Real-client proof for the roof-encounter fix, driven on the served floor
// harness with installed Chrome via Playwright.
//
// Spawns the player on the Hollis Meeting leads at D_MEETING_W — the west landing
// where the guided line drops onto the roof, inside the BILLMAN_HOLLIS trigger —
// and watches the bill-sticker close and open his question ON THE ROOF, then
// answers CORRECT and confirms the stop resolves. Captures, every animation
// frame across the whole approach, the speaker's position, the measured per-frame
// ground speed and the locomotion clip the renderer selects from it (the exact
// idle<0.35<walk<2.4<run formula in MissionStage), so a threshold flip shows up
// in the trace.
//
//   node .affordwork/qa-billman-roof.mjs [baseURL]
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:5219";
const OUT = resolve(".affordwork/qa-billman-roof");
mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SPEAKER = "BILLMAN_HOLLIS";
const ANSWER =
  "Every sheet you paste is printed paper, and the stamp falls on each one — so the printers run fewer bills, the paste-work dries up, and the wage you take home shrinks. It lands on your trade, not just the lawyers'.";

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
page.on("console", (m) => {
  if (m.type() === "error") {
    const t = m.text();
    if (!/GLB|world\/|Could not load|404|Failed to load resource/i.test(t)) {
      errors.push(`console.error: ${t.slice(0, 200)}`);
    }
  }
});

// Install the per-animation-frame sampler BEFORE the page loads, so it captures
// the approach from the very first simulated frame (the stop arms on spawn). It
// reproduces MissionStage's clip selection exactly (same watcherPoses source,
// same per-frame delta, same idle<0.35<walk<2.4<run thresholds).
await page.addInitScript((speakerId) => {
  const WALK = 0.35, RUN = 2.4;
  const w = window;
  w.__trace = [];
  w.__prev = null;
  w.__last = performance.now();
  const tick = (now) => {
    const rt = w.__floor;
    if (rt) {
      const delta = (now - w.__last) / 1000;
      w.__last = now;
      const p = rt.motion.pos;
      const spk = rt.watcherPoses.find((x) => x.id === speakerId) ?? null;
      const enc = rt.encounterView;
      // Keep facing the speaker until a question owns input, so the approach is
      // watched head-on and the two-shot forms on the actor.
      const look = w.__look;
      if (spk && look && !(rt.encounterOwnsInput === true)) {
        const dx = spk.position.x - p.x, dz = spk.position.z - p.z;
        if (Math.hypot(dx, dz) > 1e-3) {
          look.look = { yaw: Math.atan2(dx, dz), pitch: look.look.pitch };
          look.pendingX = 0; look.pendingY = 0;
        }
      }
      if (spk) {
        const prev = w.__prev;
        const mps = prev && delta > 0
          ? Math.hypot(spk.position.x - prev.x, spk.position.z - prev.z) / delta
          : 0;
        // OLD path: the renderer's measured per-frame clip selection (the bug).
        const measuredClip = mps >= RUN ? "run" : mps >= WALK ? "walk" : "idle";
        // NEW path: the clip the renderer now DECLARES from the machine's known
        // state. Replicates encounterActorDirective by reading the speaker actor's
        // `arrived` flag off the live instance — APPROACH: walk while moving, idle
        // once arrived; other phases keep the existing forced clips.
        const inst = rt.encounters.find((e) => e.def?.speaker?.watcherId === speakerId);
        const spkActor = inst?.actors?.find((a) => a.kind === "SPEAKER") ?? null;
        let renderedClip = measuredClip;
        if (enc) {
          if (enc.phase === "APPROACH") renderedClip = spkActor && !spkActor.arrived ? "walk" : "idle";
          else if (enc.phase === "QUESTION" || enc.phase === "SUBMITTING") renderedClip = "idle";
        }
        w.__prev = { x: spk.position.x, z: spk.position.z };
        if (enc && (enc.phase === "APPROACH" || enc.phase === "QUESTION")) {
          w.__trace.push({
            tick: rt.clock.tick,
            phase: enc.phase,
            dMs: +(delta * 1000).toFixed(1),
            mps: +mps.toFixed(3),
            measuredClip,
            renderedClip,
            sx: +spk.position.x.toFixed(3), sy: +spk.position.y.toFixed(3), sz: +spk.position.z.toFixed(3),
            gap3D: +Math.hypot(spk.position.x - p.x, spk.position.y - p.y, spk.position.z - p.z).toFixed(3),
            gapXZ: +Math.hypot(spk.position.x - p.x, spk.position.z - p.z).toFixed(3),
          });
        }
      }
    }
    w.__raf = requestAnimationFrame(tick);
  };
  w.__raf = requestAnimationFrame(tick);
}, SPEAKER);

// Spawn exactly on the meeting leads at the west landing, inside the trigger, so
// the bill-sticker closes his short posted walk ON the roof (both at y=8.2).
const url = `${BASE}/src/mission/floor.html?at=D_MEETING_W&toward=D_MEETING_ROOF&encounterVerdict=correct`;
console.log(`\n=== drive BILLMAN_HOLLIS on the roof, CORRECT ===\n${url}`);
await page.goto(url, { waitUntil: "load" });
await page.waitForSelector("canvas", { timeout: 60000 });
await page.waitForFunction(() => !!window.__floor && !!window.__look, {
  timeout: 60000,
  polling: 30,
});
await page.locator("canvas").click({ position: { x: 640, y: 400 } }).catch(() => {});

const read = () => page.evaluate(() => {
  const rt = window.__floor;
  if (!rt) return null;
  const enc = rt.encounterView;
  return {
    tick: rt.clock.tick,
    phase: enc ? enc.phase : null,
    verdictKind: enc ? enc.verdictKind : null,
    locked: rt.encounterLocked === true,
    ownsInput: rt.encounterOwnsInput === true,
    domHasInput: document.querySelector("#msn-enc-input") != null,
    resolvedCount: rt.encounters.filter((e) => e.phase === "RESOLVED" || e.phase === "RELEASED").length,
    summaries: [...rt.encounterSummaries.values()].map((s) => ({ id: s.encounterId, kind: s.verdictKind, reprieve: s.reprieve })),
  };
});
const snap = (n) => page.screenshot({ path: join(OUT, `${n}.png`) }).catch(() => {});

let answered = false, resolvedSeen = false, armedSeen = false;
const deadline = Date.now() + 40000;
let approachShots = 0;
while (Date.now() < deadline) {
  const s = await read();
  if (!s) { await page.waitForTimeout(50); continue; }
  if (s.phase === "APPROACH") {
    armedSeen = true;
    if (approachShots < 4) { await snap(`approach-${approachShots}`); approachShots += 1; }
  }
  if (s.phase === "QUESTION" && s.domHasInput && !answered) {
    await snap("question");
    await page.fill("#msn-enc-input", ANSWER).catch((e) => errors.push(`fill: ${e.message}`));
    await page.waitForTimeout(120);
    await page.click(".msn-enc-submit").catch((e) => errors.push(`submit: ${e.message}`));
    answered = true;
  }
  if (answered && !resolvedSeen && s.phase === "RESOLVED") {
    resolvedSeen = true;
    await snap("resolved");
    await page.click(".msn-enc-submit").catch(() => {});
  }
  if (resolvedSeen && s.phase === null) { await snap("released"); break; }
  await page.waitForTimeout(16);
}

const trace = await page.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__trace; });
const final = await read();

// Analyse the approach trace: the clip flip is what "glitch runs" reads as. We
// count flips for BOTH the old measured selection and the new declared one.
const approach = trace.filter((t) => t.phase === "APPROACH");
const flipsOf = (key) => {
  let flips = 0, prev = null;
  const counts = {};
  for (const s of approach) {
    counts[s[key]] = (counts[s[key]] ?? 0) + 1;
    if (prev !== null && s[key] !== prev) flips += 1;
    prev = s[key];
  }
  return { flips, counts };
};
const measured = flipsOf("measuredClip");
const rendered = flipsOf("renderedClip");
let maxGap3D = 0;
for (const s of approach) maxGap3D = Math.max(maxGap3D, s.gap3D);
const openFrame = trace.find((t) => t.phase === "QUESTION");

const summary = {
  url,
  armedSeen,
  questionOpened: !!openFrame,
  openGap3D: openFrame ? openFrame.gap3D : null,
  openGapXZ: openFrame ? openFrame.gapXZ : null,
  approachFrames: approach.length,
  measuredClip_counts: measured.counts,
  measuredClip_flips: measured.flips, // the OLD buggy path, for reference
  renderedClip_counts: rendered.counts,
  renderedClip_flips: rendered.flips, // the NEW declared path — expect 0/1
  maxGap3DDuringApproach: +maxGap3D.toFixed(2),
  finalPhase: final?.phase ?? null,
  summaries: final?.summaries ?? [],
  errors,
};
writeFileSync(join(OUT, "trace.json"), `${JSON.stringify({ summary, approach }, null, 2)}\n`);

console.log(JSON.stringify(summary, null, 2));
console.log("\n--- approach clip trace (every rAF) ---");
for (const s of approach) console.log(`  t=${s.tick} d=${s.dMs}ms mps=${s.mps} measured=${s.measuredClip} rendered=${s.renderedClip} gapXZ=${s.gapXZ} gap3D=${s.gap3D}`);

await browser.close();
const openedOnRoof = !!openFrame && openFrame.gap3D <= 2.6;
const pass = !!openFrame && openedOnRoof && (final?.summaries ?? []).some((x) => x.id === "ROPEWALK_STOP" && x.kind === "CORRECT");
console.log(`\n${pass ? "PASS: roof stop opened ON the roof (3D≈XZ), resolved CORRECT" : "FAIL"}`);
process.exit(pass ? 0 : 1);
