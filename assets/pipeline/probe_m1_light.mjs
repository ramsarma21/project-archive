// Light-rig probe for M1.
//
// Answers three questions per vantage, from the real floor harness rather than
// an asset sheet: what is actually lighting the scene, how bright is the frame a
// player sees, and which materials are producing that brightness without being
// lit. The second is measured off the framebuffer so "you cannot see anything"
// stops being a matter of opinion.
//
// Run: node assets/pipeline/probe_m1_light.mjs <baseUrl> <outDir> <tag> [ticks] [nameSubstring]
import { chromium } from "playwright";
import { globSync, mkdirSync, writeFileSync } from "node:fs";
import zlib from "node:zlib";

const base = process.argv[2] ?? "http://localhost:5173";
const outDir = process.argv[3] ?? "/tmp/m1light";
const tag = process.argv[4] ?? "before";
const onlyTicks = process.argv[5] ? Number(process.argv[5]) : null;
// Re-shooting one vantage. A capture can come back wrong rather than missing —
// a page that navigated out from under the screenshot yields a plain white
// frame, which scores as a perfectly lit scene — so being able to redo a single
// vantage without disturbing the other sixteen is what keeps one bad frame from
// costing a whole run.
const onlyName = process.argv[6] ?? null;
mkdirSync(outDir, { recursive: true });

const candidates = globSync(
  "/var/folders/**/cursor-sandbox-cache/*/playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
);
const exe = candidates[0] ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const SEED = "48879";
// Two points on the dawn clock: 12s in (LAST_DARK, the state the mission is
// actually played in) and the budget boundary (GREY, brightest tick at which
// the crowd is still whole).
const CLOCKS = [
  ["early", 12 * 60],
  ["late", 180 * 60],
];

const VANTAGES = [
  ["P1-queen-street", "at=A_START&toward=A_SHEETS", "Queen Street start, facing the drying rack."],
  ["P2-shambles", "at=B_STREET_W&toward=B_STREET_E", "The Shambles, looking east down the market street."],
  ["P3-dock-square", "at=B2_CART_W&toward=B2_THRONG_E&back=3", "Dock Square, the whole blend crossing."],
  ["P4-arcade", "at=B2_ARCADE_PIER&toward=B2_ARCADE_N", "Inside the dark arcade, the unlit colonnade."],
  ["P5-townhouse", "at=C_SQUARE_W&toward=C_SCAFF_FOOT", "Town House square, foot of the scaffold."],
  ["P6-leads", "at=C_LEADS_S&toward=C_LEADS_E", "On the Town House leads, the high roof run."],
  ["P7-ropewalk-beam", "at=D2_BEAM_E&toward=D2_BEAM_W", "Ropewalk interior, on the tie beam over the night man."],
  ["P8-ropewalk-floor", "at=D2_FLOOR_W&toward=D2_STAGE", "Ropewalk interior floor, head of the walk."],
  ["P9-liberty", "at=F_CROWD_E&toward=F_STALL_BACK", "The crowd under the Liberty Tree."],
];

// --- minimal PNG reader (8-bit, non-interlaced, RGB/RGBA) -------------------
function decodePng(buf) {
  let off = 8;
  let width = 0, height = 0, colour = 0, bits = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bits = data[8];
      colour = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (bits !== 8) throw new Error(`unsupported bit depth ${bits}`);
  const channels = colour === 6 ? 4 : colour === 2 ? 3 : null;
  if (!channels) throw new Error(`unsupported colour type ${colour}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prior = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prior ? prior[x] : 0;
      const c = prior && x >= channels ? prior[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

/**
 * Frame statistics a person can argue with.
 *
 * The sky is excluded from the "world" figures: a night sky is legitimately
 * dark and averaging it in hides the thing being measured, which is whether the
 * BUILDINGS are readable. Sky is taken as the top eighth of the frame's median.
 */
function frameStats(png) {
  const { width, height, channels, data } = png;
  const lum = new Float64Array(width * height);
  for (let i = 0, p = 0; i < lum.length; i++, p += channels) {
    lum[i] = (0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]) / 255;
  }
  // Lower three-quarters of the frame: the street, not the sky.
  const startRow = Math.floor(height * 0.25);
  const world = Array.from(lum.subarray(startRow * width)).sort((a, b) => a - b);
  const at = (q) => world[Math.min(world.length - 1, Math.floor(world.length * q))];
  const mean = world.reduce((s, v) => s + v, 0) / world.length;
  // How much of the lower frame is effectively black — the "cannot see" figure.
  const black = world.filter((v) => v < 0.04).length / world.length;
  const bright = world.filter((v) => v > 0.6).length / world.length;
  return {
    mean: +mean.toFixed(4),
    p05: +at(0.05).toFixed(4),
    p50: +at(0.5).toFixed(4),
    p95: +at(0.95).toFixed(4),
    max: +world[world.length - 1].toFixed(4),
    blackFraction: +black.toFixed(4),
    brightFraction: +bright.toFixed(4),
  };
}

// A vantage loads a hundred-odd GLBs into a headless GPU process, and on a
// loaded machine that process does sometimes die. It used to take the run with
// it: the previous pass lost six of nine vantages to one dead page at P4, and
// a light rig that has only been measured on the three streets that happened to
// come first is not a light rig that has been measured. So the browser is a
// resource this loop can rebuild, and a vantage that cannot be captured twice
// is recorded as a hole rather than thrown.
const errors = [];
let browser = null;
let page = null;

async function openBrowser() {
  browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: ["--use-angle=metal", "--enable-webgl", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"],
  });
  page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 240));
  });
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 240)));
  await page.addInitScript(() => {
    const hide = () => {
      if (document.getElementById("probe-hide")) return;
      const style = document.createElement("style");
      style.id = "probe-hide";
      style.textContent =
        "[class^='msn-hud'],[class*=' msn-hud'],.msn-curtain{display:none!important}";
      document.head?.appendChild(style);
    };
    if (document.head) hide();
    else document.addEventListener("DOMContentLoaded", hide);
  });
}

async function closeBrowser() {
  try {
    await browser?.close();
  } catch {
    // Already gone, which is the case this exists to survive.
  }
  browser = null;
  page = null;
}

await openBrowser();

// Frame timing, sampled in the page so it is the real rAF cadence.
const fpsProbe = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const times = [];
        let last = performance.now();
        let n = 0;
        const tick = () => {
          const now = performance.now();
          times.push(now - last);
          last = now;
          if (++n < 90) requestAnimationFrame(tick);
          else {
            const sorted = [...times].slice(10).sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];
            resolve({
              fps: +(1000 / median).toFixed(1),
              medianMs: +median.toFixed(2),
              p95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
            });
          }
        };
        requestAnimationFrame(tick);
      }),
  );

/** What is in the scene graph: lights, and materials that light does not reach. */
const sceneAudit = () =>
  page.evaluate(() => {
    // `MissionStage` publishes its R3F state on the window in dev builds.
    const state = window.__stage;
    if (!state) return { error: "no __stage; is this a dev build?" };
    const scene = state.scene;
    const gl = state.gl;
    const lights = [];
    const selfLit = new Map();
    let meshes = 0;
    let litMaterials = 0;
    let shadowCasters = 0;
    scene.traverse((o) => {
      if (o.isLight) {
        lights.push({
          type: o.type,
          intensity: +o.intensity.toFixed(3),
          colour: `#${o.color?.getHexString?.() ?? "??????"}`,
          castShadow: !!o.castShadow,
          distance: o.distance,
        });
      }
      if (!o.isMesh) return;
      meshes++;
      if (o.castShadow) shadowCasters++;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        const unlit = m.type === "MeshBasicMaterial";
        const emissive = m.emissive ? m.emissive.getHex() : 0;
        const emissiveMap = !!m.emissiveMap;
        if (unlit || emissive !== 0 || emissiveMap) {
          // Walk up for a recognisable owner name.
          let owner = o;
          let name = o.name;
          for (let i = 0; i < 6 && owner.parent && !name; i++) {
            owner = owner.parent;
            name = owner.name;
          }
          const key = `${m.type}|emissive=#${m.emissive?.getHexString?.() ?? "0"}|emissiveMap=${emissiveMap}|intensity=${m.emissiveIntensity ?? "-"}`;
          const entry = selfLit.get(key) ?? { count: 0, examples: [] };
          entry.count++;
          if (entry.examples.length < 3 && name) entry.examples.push(name);
          selfLit.set(key, entry);
        } else litMaterials++;
      }
    });
    return {
      lights,
      meshes,
      litMaterials,
      shadowCasters,
      selfLit: [...selfLit].map(([k, v]) => ({ signature: k, ...v })),
      toneMapping: gl.toneMapping,
      toneMappingExposure: gl.toneMappingExposure,
      shadowsEnabled: gl.shadowMap.enabled,
      shadowType: gl.shadowMap.type,
      outputColorSpace: gl.outputColorSpace,
      drawCalls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
    };
  });

const rows = [];
let auditedOnce = false;
// Whether the scene graph was ever actually read. A run that captured only white
// frames from a page that never mounted the stage would otherwise print plausible
// brightness numbers and exit 0 — the exact "measured nothing, looked like good
// news" failure the P4 die-off produced. See the assertions after the loop.
let auditOk = false;

/** One vantage at one point on the clock. Throws if the page dies under it. */
async function capture(name, query, clock, ticks, wantAudit) {
  const url = `${base}/src/mission/floor.html?${query}&seed=${SEED}`;
  errors.length = 0;
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(9000);
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(9000);

  let stage = "?";
  let bodies = -1;
  for (let attempt = 0; attempt < 16; attempt++) {
    const read = await page.evaluate((t) => {
      const floor = window.__floor;
      if (!floor) return { stage: "NO_FLOOR", bodies: -1 };
      floor.ticks = t;
      return {
        stage: floor.dawn?.stage ?? "NO_DAWN",
        lift: floor.dawn?.lift01 ?? -1,
        bodies: floor.civilians?.length ?? -1,
      };
    }, ticks);
    stage = read.stage;
    bodies = read.bodies;
    await page.waitForTimeout(400);
    if (bodies > 0 && attempt >= 3) break;
  }

  const shot = `${outDir}/${tag}-${name}-${clock}.png`;
  const buf = await page.screenshot({ path: shot, timeout: 120000 });
  const stats = frameStats(decodePng(buf));
  const timing = await fpsProbe();
  const audit = wantAudit ? await sceneAudit() : null;
  return { stage, bodies, stats, timing, audit };
}

for (const [name, query, caption] of VANTAGES) {
  if (onlyName !== null && !name.includes(onlyName)) continue;
  for (const [clock, ticks] of CLOCKS) {
    if (onlyTicks !== null && ticks !== onlyTicks) continue;

    const wantAudit = !auditedOnce || name === "P7-ropewalk-beam";
    let result = null;
    for (let attempt = 0; attempt < 2 && !result; attempt++) {
      try {
        result = await capture(name, query, clock, ticks, wantAudit);
      } catch (error) {
        console.log(
          `   ${name} ${clock}: capture attempt ${attempt + 1} failed — ${String(error).split("\n")[0]}`,
        );
        // A dead page cannot be navigated back to life, so the browser goes
        // with it. Relaunching costs one cold asset load and buys the rest of
        // the run, which is the whole point of measuring nine vantages.
        await closeBrowser();
        await openBrowser();
      }
    }

    if (!result) {
      rows.push({ name, clock, failed: true });
      console.log(`${tag} ${name.padEnd(20)} ${clock.padEnd(5)} COULD NOT CAPTURE — ${caption}`);
      continue;
    }

    const { stage, bodies, stats, timing, audit } = result;
    if (audit && !auditedOnce) {
      writeFileSync(`${outDir}/${tag}-scene-audit.json`, JSON.stringify(audit, null, 2));
      auditedOnce = true;
      auditOk = !audit.error && Array.isArray(audit.lights) && audit.lights.length > 0;
    }

    rows.push({ name, clock, stage, bodies, ...stats, ...timing });
    console.log(
      `${tag} ${name.padEnd(20)} ${clock.padEnd(5)} dawn=${String(stage).padEnd(10)} bodies=${bodies} ` +
        `mean=${stats.mean} p50=${stats.p50} p95=${stats.p95} black%=${(stats.blackFraction * 100).toFixed(1)} ` +
        `bright%=${(stats.brightFraction * 100).toFixed(1)} fps=${timing.fps} p95ms=${timing.p95Ms}  — ${caption}`,
    );
    if (audit && audit.lights) {
      console.log(
        `   lights: ${audit.lights.map((l) => `${l.type}@${l.intensity}${l.castShadow ? "*" : ""}`).join(", ")}` +
          ` | meshes=${audit.meshes} lit=${audit.litMaterials} shadowCasters=${audit.shadowCasters}` +
          ` | tone=${audit.toneMapping} exposure=${audit.toneMappingExposure} calls=${audit.drawCalls} tris=${audit.triangles}`,
      );
      for (const s of audit.selfLit) {
        console.log(`   SELF-LIT x${s.count}: ${s.signature}  e.g. ${s.examples.join(", ")}`);
      }
    }
    if (errors.length) {
      const unique = [...new Set(errors.map((e) => e.split("\n")[0]))].slice(0, 4);
      console.log(`   console errors (${errors.length}): ${unique.join(" | ")}`);
    }

    // Written as the run goes rather than at the end, so a run that is killed
    // still reports on everything it did reach.
    writeFileSync(`${outDir}/${tag}-frames.json`, JSON.stringify(rows, null, 2));
  }
}

console.log(`\nWROTE ${outDir}/${tag}-frames.json`);
await closeBrowser();

// ASSERTION-BASED EXIT. A probe that measured nothing must not report success.
// Two conditions are load-bearing and each has a defined threshold: at least one
// vantage has to have been captured (a run that lost every vantage to a dead page
// measured the light rig on zero frames), and the scene graph has to have been
// read at least once with lights in it (a page that never mounted __stage yields
// white frames that score as a perfectly lit scene). Either alone is the "looks
// like good news" failure this file exists to make loud.
const captured = rows.filter((row) => !row.failed).length;
const problems = [];
if (captured === 0) {
  problems.push(`no vantage was captured (${rows.length} attempted, all failed)`);
}
if (!auditOk) {
  problems.push(
    "the scene audit never found a mounted stage with lights (is this a dev build, " +
      "and did the harness reach the mission?)",
  );
}
if (problems.length > 0) {
  console.error(`\nFAILED: light probe measured nothing usable:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(
  `\nOK: ${captured} vantage(s) captured and the scene graph was read with lights present.`,
);
process.exit(0);
