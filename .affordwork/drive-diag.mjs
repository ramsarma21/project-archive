// Drive the REAL client through the M1 SAFE route with the running-game black
// box (window.__diag) recording. This is the admissible evidence path: real
// browser, real input, the real flow controller committing verbs off geometry —
// not the replay harness and not the shipped invariants that reported 0/44.
//
// Steering mirrors the wayfinder: aim the LOOK at the committed waypoint, hold
// W+Shift (Shift = the world catches you: climbs/vaults/drops fire for you),
// press Space when the flow previews a jump/leap, answer guard stops through the
// real overlay with the deterministic dev authority.
//
//   node .affordwork/drive-diag.mjs [baseURL] [outDir] [seed] [maxSeconds] [bare]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:5173";
const OUT = new URL(`./${process.argv[3] ?? "diag-out"}/`, import.meta.url).pathname;
const SEED = process.argv[4] ?? "0xb057";
const MAX_MS = (Number(process.argv[5]) || 240) * 1000;
const BARE = process.argv[6] === undefined ? "1" : process.argv[6];
mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

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
const viol = [];
page.on("pageerror", (e) => perr.push(String(e).slice(0, 240)));
page.on("console", (m) => {
  const t = m.text();
  if (/non-penetration violated|climbSurfaceInvariant|violated/.test(t)) viol.push(t.slice(0, 200));
});

async function waitRuntime() {
  for (let i = 0; i < 250; i++) {
    const t = await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null);
    if (t !== null) return true;
    await sleep(200);
  }
  return false;
}

const READ = () =>
  page.evaluate(() => {
    const rt = window.__floor;
    if (!rt || !rt.motion) return null;
    const m = rt.motion;
    const req = rt.instance.objectives.filter((o) => o.required);
    const met = new Set(rt.satisfied);
    const cur = req.find((o) => !met.has(o.id)) ?? null;
    let wp = null;
    if (cur && cur.mark && cur.mark.waypoint) {
      const w = cur.mark.waypoint(m.pos);
      if (w) wp = { x: w.pos.x, y: w.pos.y, z: w.pos.z, via: w.via };
    }
    const ev = rt.encounterView;
    return {
      tick: rt.ticks,
      pos: { x: +m.pos.x.toFixed(2), y: +m.pos.y.toFixed(2), z: +m.pos.z.toFixed(2) },
      grounded: m.grounded,
      speed: +Math.hypot(m.vel.x, m.vel.z).toFixed(2),
      verb: rt.flow?.verb ?? null,
      preview: rt.flow?.previewVerb ?? null,
      objId: cur?.id ?? null,
      wp,
      enc: ev ? { id: ev.encounterId, phase: ev.phase, verdict: ev.verdictKind } : null,
      encLocked: !!(rt.encounterLocked || rt.encounterOwnsInput),
      outcome: rt.outcome ? rt.outcome.kind : null,
    };
  }).catch(() => null);

async function aim(wp, pos) {
  if (!wp) return;
  const dx = wp.x - pos.x, dz = wp.z - pos.z, dy = wp.y - pos.y;
  const yaw = Math.atan2(dx, dz);
  const horiz = Math.hypot(dx, dz) || 0.001;
  let pitch = -Math.atan2(dy, horiz) * 0.55 - 0.06;
  pitch = Math.max(-0.5, Math.min(0.5, pitch));
  await page.evaluate(
    ([y, p]) => { const L = window.__look; if (L && L.look) { L.look.yaw = y; L.look.pitch = p; } },
    [yaw, pitch],
  );
}

async function handleEncounter(s) {
  log(`  [encounter ${s.enc.id}] phase=${s.enc.phase}`);
  await page.keyboard.up("KeyW").catch(() => {});
  await page.keyboard.up("ShiftLeft").catch(() => {});
  let answered = false;
  for (let i = 0; i < 120; i++) {
    const box = await page.$("#msn-enc-input");
    const cur = await READ();
    if (cur?.enc?.phase === "RESOLVED") break;
    if (box) {
      const disabled = await box.evaluate((el) => el.disabled).catch(() => true);
      if (!disabled && !answered) {
        await box.click().catch(() => {});
        await box.type("I am carrying handbills for the printer on Queen Street; there is no stamp owed on a broadside and I am about lawful business.", { delay: 1 }).catch(() => {});
        const submit = await page.$(".msn-enc-submit");
        if (submit) await submit.click().catch(() => {});
        answered = true;
      }
    }
    await sleep(200);
  }
  for (let i = 0; i < 40; i++) {
    const btn = await page.$(".msn-enc-submit");
    const cur = await READ();
    if (!cur?.enc || cur.enc.phase !== "RESOLVED") break;
    if (btn) await btn.click().catch(() => {});
    await sleep(150);
  }
  await page.keyboard.down("ShiftLeft").catch(() => {});
  await page.keyboard.down("KeyW").catch(() => {});
  await sleep(150);
}

const url = `${BASE}/src/mission/floor.html?hold=0&bare=${BARE}&seed=${SEED}&encounterVerdict=correct`;
log("run", url);
await page.goto(url, { waitUntil: "commit", timeout: 120000 });
if (!(await waitRuntime())) { log("runtime never came up"); await browser.close(); process.exit(1); }
await sleep(2500);
await page.mouse.click(640, 400).catch(() => {});
await sleep(300);
// Reset the black box so it holds only this run.
await page.evaluate(() => { window.__diag?.reset?.(); }).catch(() => {});

const trace = [];
const milestones = [];
let lastVia = null, jumpCd = 0, stallPos = null, stallTicks = 0, stalls = 0;

await page.keyboard.down("ShiftLeft");
await page.keyboard.down("KeyW");
const START = Date.now();
while (Date.now() - START < MAX_MS) {
  const s = await READ();
  if (!s) { await sleep(80); continue; }
  trace.push(s);
  if (s.outcome) { log(`OUTCOME: ${s.outcome} @${JSON.stringify(s.pos)}`); break; }
  if (s.enc && s.enc.phase !== "RESOLVED" && (s.encLocked || s.enc.phase === "QUESTION" || s.enc.phase === "APPROACH")) {
    await handleEncounter(s); jumpCd = 0; continue;
  }
  await aim(s.wp, s.pos);
  if (jumpCd > 0) jumpCd -= 1;
  if (s.grounded && jumpCd === 0 && ["JUMP", "JUMP_GAP", "LEAP_OF_FAITH", "DASH_JUMP"].includes(s.preview)) {
    await page.keyboard.press("Space").catch(() => {});
    jumpCd = 4;
  }
  if (s.wp && s.wp.via !== lastVia) {
    milestones.push({ tick: s.tick, via: s.wp.via, pos: s.pos, verb: s.verb });
    lastVia = s.wp.via;
    log(`  via ${s.wp.via} @t${s.tick} ${JSON.stringify(s.pos)}`);
  }
  if (stallPos && Math.hypot(s.pos.x - stallPos.x, s.pos.z - stallPos.z) < 0.2 && s.grounded && !s.enc) {
    stallTicks += 1;
  } else { stallTicks = 0; stallPos = s.pos; }
  if (stallTicks > 40) {
    log(`STALL @${JSON.stringify(s.pos)} via=${s.wp?.via} verb=${s.verb} preview=${s.preview}`);
    await page.keyboard.press("Space").catch(() => {});
    stallTicks = 0; stalls += 1;
    if (stalls > 10) { log("giving up after repeated stalls"); break; }
  }
  await sleep(70);
}
await page.keyboard.up("KeyW").catch(() => {});
await page.keyboard.up("ShiftLeft").catch(() => {});

const diag = await page.evaluate(() => {
  const d = window.__diag;
  if (!d) return null;
  return { frames: d.frames, embeds: d.embeds, authored: d.authored };
}).catch(() => null);
const fin = await READ();

writeFileSync(`${OUT}trace.json`, JSON.stringify(trace));
writeFileSync(`${OUT}milestones.json`, JSON.stringify(milestones, null, 2));
if (diag) writeFileSync(`${OUT}diag.json`, JSON.stringify(diag));

// ---- summary --------------------------------------------------------------
log("\n=== FINAL ===", JSON.stringify(fin));
log("milestones:", milestones.map((m) => m.via).join(" -> "));
log("page errors:", perr.length, perr.slice(0, 3));
log("console violations:", viol.length, viol.slice(0, 6));

if (diag) {
  const f = diag.frames;
  log(`\n=== FRAMES (${f.length}) ===`);
  if (f.length) {
    const sim = f.map((x) => x.simMs).sort((a, b) => a - b);
    const dl = f.map((x) => x.deltaMs).sort((a, b) => a - b);
    const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
    const droppedFrames = f.filter((x) => x.droppedThisFrame > 0).length;
    const totalDropped = f.length ? f[f.length - 1].droppedTotal : 0;
    const slowTs = f.filter((x) => x.timeScale < 0.999).length;
    log(`sim ms  p50=${pct(sim, 0.5).toFixed(2)} p95=${pct(sim, 0.95).toFixed(2)} max=${sim[sim.length - 1].toFixed(2)}`);
    log(`frame ms p50=${pct(dl, 0.5).toFixed(1)} p95=${pct(dl, 0.95).toFixed(1)} max=${dl[dl.length - 1].toFixed(1)}`);
    log(`frames with dropped steps: ${droppedFrames}/${f.length}; total dropped ticks: ${totalDropped}`);
    log(`frames with timeScale<1 (reflex dilation): ${slowTs}`);
    // Worst sim frames, with verb context.
    const worst = [...f].sort((a, b) => b.simMs - a.simMs).slice(0, 8);
    log("worst sim frames:", worst.map((w) => `t${w.tick} ${w.simMs.toFixed(1)}ms steps=${w.steps} verb=${w.verb} phase=${w.phase}`).join(" | "));
  }

  log(`\n=== EMBEDS (strict, no-ignore) (${diag.embeds.length} ticks) ===`);
  const byId = new Map();
  for (const e of diag.embeds) {
    for (const s of e.strict) {
      const cur = byId.get(s.id) ?? { max: 0, count: 0, verbs: new Set(), sample: null };
      cur.count += 1;
      cur.verbs.add(e.verb);
      if (s.depthM > cur.max) { cur.max = s.depthM; cur.sample = { tick: e.tick, verb: e.verb, phase: e.phase, pos: e.pos }; }
      byId.set(s.id, cur);
    }
  }
  const rows = [...byId.entries()].sort((a, b) => b[1].max - a[1].max);
  for (const [id, v] of rows) {
    log(`  ${id}: maxDepth=${v.max.toFixed(3)}m ticks=${v.count} verbs=${[...v.verbs].join(",")} @${JSON.stringify(v.sample?.pos)} t${v.sample?.tick} ${v.sample?.phase}`);
  }
  if (rows.length === 0) log("  (no strict hull embeds recorded)");

  log(`\n=== AUTHORED transitions: solver-vs-spline divergence (${diag.authored.length} ticks) ===`);
  // Group authored ticks into runs by contiguous verb+phase.
  const groups = [];
  let g = null;
  for (const a of diag.authored) {
    if (!g || g.verb !== a.verb || a.tick - g.lastTick > 3) {
      g = { verb: a.verb, startTick: a.tick, lastTick: a.tick, maxDiv: 0, maxEmbed: 0, embedId: null, n: 0, startPos: a.solved };
      groups.push(g);
    }
    g.lastTick = a.tick; g.n += 1;
    if (a.divergenceM > g.maxDiv) g.maxDiv = a.divergenceM;
    if (a.deepestEmbedM > g.maxEmbed) { g.maxEmbed = a.deepestEmbedM; g.embedId = a.deepestEmbedId; }
  }
  for (const gr of groups) {
    log(`  ${gr.verb} t${gr.startTick}-${gr.lastTick} (${gr.n}) maxDiv=${gr.maxDiv.toFixed(3)}m maxEmbed=${gr.maxEmbed.toFixed(3)}m in ${gr.embedId ?? "-"} from${JSON.stringify(gr.startPos)}`);
  }
  const worstDiv = [...diag.authored].sort((a, b) => b.divergenceM - a.divergenceM).slice(0, 5);
  log("worst divergence ticks:", worstDiv.map((a) => `${a.verb} t${a.tick} div=${a.divergenceM.toFixed(3)} embed=${a.deepestEmbedM.toFixed(3)}`).join(" | "));
}
log("\n-> wrote", OUT);
await browser.close();
