// check-playthrough — an automated end-to-end PLAYTHROUGH gate.
//
// WHY THIS EXISTS. The repo has six blocking gates (lint, verify:content, the
// three asset verifiers, typecheck) plus 2,702 tests and a build, and NOT ONE of
// them opens the game and plays it. They all read source, authored data, collision
// hulls and mesh geometry. So a change can pass everything and still ship a broken
// EXPERIENCE: a duel harness rendering into an empty void, repeated props rendering
// as white untextured boxes, a relocated encounter that arms from the cobbles but
// whose speaker can never close — every gate green, the mission unplayable.
//
// This driver opens the REAL client with Playwright and asserts the mission
// actually works. It reads the running game's own black boxes — window.__floor
// (the mission runtime), window.__stage (the R3F root: renderer.info + scene),
// window.__diag (per-tick penetration), and window.__duel (the duel runtime) —
// exactly the handles the dev harnesses already expose. Nothing here is a mock.
//
// WHAT IT ASSERTS (each fails LOUDLY, naming what broke and where — no warning
// that degrades to green, no continue-on-error):
//
//   WORLD  the mission scene actually renders a world: draw calls and triangle
//          count in a sane band, textures present, and ZERO untextured near-white
//          "white box" props (a scene of white boxes fails). Read off
//          renderer.info and a scene material census, not a screenshot.
//   ROUTE  a driven run from spawn advances through the street in order and every
//          mandatory encounter ARMS *and* RESOLVES within a timeout that FAILS
//          rather than hangs — arming alone is the soft-lock, so it is not enough.
//          No body is ever inside solid geometry (window.__diag penetration ring).
//   YARD   a driven run reaches the rope-walk yard region (the route's end line).
//   DUEL   the duel harness LOADS A WORLD (verdict=live must not render the two
//          fighters into an empty void), and a graded answer discriminates right
//          from wrong (verdict=correct grants the player more balls than wrong).
//
// WHAT IT DELIBERATELY DOES NOT ASSERT, with the reason (see the report / README):
//   Full REACHED_DUEL completion is NOT required of the autonomous driver. The
//   terminal objective is gated on the reaction-timing posting beat at the Liberty
//   Elm and a precise bough dismount; a bot that reliably executes that skill beat
//   is itself a flaky dependency, and a flaky gate gets disabled — worse than none.
//   The authored route's reachability is already covered at the DATA level by
//   mission-m1's route.test.ts / traversability.test.ts; this gate adds the
//   rendered + encounter + penetration coverage those cannot see, and samples the
//   final "reach the yard" section end-to-end via a drop-in rather than requiring
//   the skill beat to be played.
//
// USAGE
//   node scripts/check-playthrough.mjs [baseURL] [--only world,route,yard,duel]
//   PLAYTHROUGH_BASE=http://localhost:5273 node scripts/check-playthrough.mjs
//
// It needs a running dev web server (the mission + duel harnesses), and the DUEL
// stage additionally needs the API up (verdict=live opens a throwaway graded
// attempt). If either is missing it says exactly what to start.
//
// THE ORIGIN REQUIREMENT (read this before running on a non-default port). The
// DUEL live attempt is a CSRF-protected mutation, and the API refuses it with
// CSRF_INVALID unless its WEB_ORIGIN env var EXACTLY equals the origin the browser
// runs on — the same host and port as this baseURL. On the default port the API's
// default WEB_ORIGIN (http://localhost:5173) happens to match; on any other port
// it does not, and the duel silently reports "could not open a gradeable attempt"
// that reads like broken attempt machinery but is only a mismatched origin. So
// start the API with WEB_ORIGIN set to this baseURL. This check watches the API's
// responses and, if it sees that refusal, names the mismatch outright rather than
// leaving it to look like a code bug.
//
// This IS wired into CI as a blocking job (`playthrough` in .github/workflows/ci.yml),
// which provisions Postgres + the API (WEB_ORIGIN pinned to the web origin) + the
// web dev server before running it. See docs/process/CI-AND-BROWSER-CHECKS.md for
// the job's shape and for what this gate structurally CANNOT see.

import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const OUT = join(REPO, ".affordwork", "playthrough-out");
mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const onlyIdx = argv.indexOf("--only");
const onlyArg = onlyIdx >= 0 && argv[onlyIdx + 1] ? new Set(argv[onlyIdx + 1].split(",")) : null;
// A positional argument is anything that is not a flag and is not the value that
// follows `--only`. The `onlyIdx < 0` guard matters: without it, `onlyIdx + 1`
// is 0 when there is no `--only`, which would wrongly drop the FIRST positional
// (the baseURL) and silently fall back to the default port.
const positional = argv.filter(
  (a, i) => !a.startsWith("--") && (onlyIdx < 0 || i !== onlyIdx + 1),
);
const BASE = (process.env.PLAYTHROUGH_BASE ?? positional[0] ?? "http://localhost:5273").replace(/\/$/, "");
const wants = (stage) => !onlyArg || onlyArg.has(stage);

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// ---- assertion bands ------------------------------------------------------
// Read off a healthy run (172 draw calls, ~5.1M tris, 149 textures) and set wide
// so only a genuine collapse (an empty scene, a texture wipe) or a runaway trips.
const WORLD = {
  minCalls: 40, maxCalls: 4000,
  minTris: 300_000, maxTris: 40_000_000,
  minTextures: 20,
  // A "white box": a lit (Standard/Physical) mesh with NO base-color map and a
  // near-white color — the exact signature of a prop whose texture did not bind.
  // Skinned meshes (characters) and unlit MeshBasic (markers/UI) are exempt.
  whiteColorMin: 0.85,
};
const ROUTE = {
  seed: "0xb057",
  capS: 95, // > the encounter soft-lock timeout, so a stuck stop is caught not waited on
  encArmTimeoutS: 30, // an encounter that armed but has not resolved this long is a soft-lock
  stallLimitS: 8, // motionless this long, while free-running, is a hang
  minProgressX: 60, // a driven run that never gets this far east never reached the ropewalk
  penInvariantLimitM: 0.3, // the shipped non-penetration invariant's tolerance
};
const YARD = {
  // rect(88, 100, -6.5, 6.5) from mission-m1 geometry; the route's end line.
  minX: 88, maxX: 100, minZ: -6.5, maxZ: 6.5,
  at: "F_VAULT_OUT", toward: "G_SPAWN", // drop just outside the gate, facing in
  capS: 25,
};
const DUEL = {
  // botSky = fraction of the lower-centre band that is open sky. A real arena fills
  // it with ground/props (~0.06); the void leaves the fighters in open sky (~0.89).
  voidBotSkyMax: 0.5,
};
const JUMP_VERBS = ["JUMP", "JUMP_GAP", "LEAP_OF_FAITH", "DASH_JUMP"];

// ---- results --------------------------------------------------------------
const failures = [];
const notes = [];
function assert(cond, name, detail) {
  if (cond) { log(`  PASS  ${name}`); return true; }
  log(`  FAIL  ${name}\n        ${detail}`);
  failures.push({ name, detail });
  return false;
}

// ---- browser --------------------------------------------------------------
async function reachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return res.status < 500;
  } catch {
    return false;
  }
}

// Records any API response that refused a mutation with CSRF_INVALID. A duel
// bootstrap that fails on a mismatched WEB_ORIGIN produces exactly this — a 403
// on /v1/auth/local-session or the module/attempt POST — and without capturing it
// the on-screen message ("could not open a gradeable attempt") reads as if the
// attempt machinery is broken rather than as the origin trap it is.
function watchOriginDenials(page) {
  const denials = [];
  page.on("response", (res) => {
    try {
      const url = res.url();
      if (!/\/(v1|api)\//.test(url) || res.status() !== 403) return;
      res
        .text()
        .then((body) => {
          if (/CSRF_INVALID/.test(body)) denials.push({ url, body: body.slice(0, 120) });
        })
        .catch(() => {});
    } catch {
      /* a response that cannot be read tells us nothing; ignore it */
    }
  });
  return denials;
}

// The plain-language remediation for a duel-live failure that was really an origin
// mismatch. Empty when no CSRF refusal was seen, so it only speaks when it applies.
function originMismatchHint(denials) {
  if (denials.length === 0) return "";
  return (
    ` ORIGIN MISMATCH, not broken attempt machinery: the API refused the attempt with` +
    ` CSRF_INVALID on ${denials.length} call(s) (e.g. ${denials[0].url}). The browser's` +
    ` Origin is ${BASE}, but the API's WEB_ORIGIN is set to something else. Start the API` +
    ` with WEB_ORIGIN=${BASE} — it must equal this base URL exactly, host and port included.`
  );
}

async function launch() {
  const opts = {
    headless: true,
    args: [
      "--headless=new", "--ignore-gpu-blocklist", "--enable-gpu-rasterization",
      "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
    ],
  };
  if (existsSync(CHROME)) opts.executablePath = CHROME;
  return chromium.launch(opts);
}

// ---------------------------------------------------------------------------
// STAGE: WORLD + ROUTE (share the spawn page).
// ---------------------------------------------------------------------------
const MISSION_READ = () => {
  const rt = window.__floor;
  if (!rt || !rt.motion) return null;
  const m = rt.motion;
  const req = rt.instance.objectives.filter((o) => o.required);
  const met = new Set(rt.satisfied);
  const cur = req.find((o) => !met.has(o.id)) ?? null;
  let wp = null;
  if (cur?.mark?.waypoint) {
    const w = cur.mark.waypoint(m.pos);
    if (w) wp = { x: w.pos.x, y: w.pos.y, z: w.pos.z };
  }
  const ev = rt.encounterView;
  return {
    pos: { x: m.pos.x, y: m.pos.y, z: m.pos.z },
    grounded: m.grounded,
    preview: rt.flow?.previewVerb ?? null,
    beat: rt.beat ? rt.beat.phase : null,
    wp,
    reqTotal: req.length,
    satisfied: [...rt.satisfied],
    encLocked: !!(rt.encounterLocked || rt.encounterOwnsInput),
    encView: ev ? { id: ev.encounterId, phase: ev.phase } : null,
    encounters: rt.encounters.map((e) => ({ id: e.def?.id ?? e.id ?? "?", phase: e.phase })),
    outcome: rt.outcome ? { kind: rt.outcome.kind, code: rt.outcome.failure?.code ?? null } : null,
  };
};

function worldCensus() {
  const st = window.__stage;
  if (!st || !st.gl) return { error: "window.__stage.gl is not present" };
  const r = st.gl.info.render;
  const mats = {};
  let meshes = 0, skinned = 0, instanced = 0, instances = 0;
  let nullMaterials = 0, whiteBoxes = 0;
  const whiteExamples = [];
  st.scene.traverse((o) => {
    if (o.isInstancedMesh) { instanced++; instances += o.count; }
    if (o.isSkinnedMesh) skinned++;
    if (!o.isMesh) return;
    meshes++;
    const arr = Array.isArray(o.material) ? o.material : [o.material];
    for (const mtl of arr) {
      if (!mtl) { nullMaterials++; continue; }
      mats[mtl.type] = (mats[mtl.type] ?? 0) + 1;
      const lit = mtl.type === "MeshStandardMaterial" || mtl.type === "MeshPhysicalMaterial";
      const hasMap = !!mtl.map;
      if (lit && !hasMap && !o.isSkinnedMesh && mtl.color) {
        const c = mtl.color;
        if (c.r >= 0.85 && c.g >= 0.85 && c.b >= 0.85) {
          whiteBoxes++;
          if (whiteExamples.length < 10) {
            whiteExamples.push({ name: o.name || "(unnamed)", parent: o.parent?.name ?? null, type: mtl.type });
          }
        }
      }
    }
  });
  return {
    calls: r.calls, triangles: r.triangles,
    textures: st.gl.info.memory.textures, geometries: st.gl.info.memory.geometries,
    meshes, skinned, instanced, instances, nullMaterials, whiteBoxes, whiteExamples, mats,
  };
}

async function stageWorldAndRoute(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));

  const url = `${BASE}/src/mission/floor.html?hold=0&seed=${ROUTE.seed}&encounterVerdict=correct`;
  await page.goto(url, { waitUntil: "commit", timeout: 120000 });
  let up = false;
  for (let i = 0; i < 300; i++) {
    if ((await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null)) !== null) { up = true; break; }
    await sleep(200);
  }
  if (!up) {
    assert(false, "mission runtime comes up", `window.__floor never appeared at ${url}`);
    await page.close();
    return;
  }
  await sleep(8000); // let every GLB load and the first frames settle

  // ---- WORLD ----
  if (wants("world")) {
    log("\n[WORLD] mission scene census");
    const c = await page.evaluate(worldCensus).catch((e) => ({ error: String(e).slice(0, 160) }));
    writeFileSync(join(OUT, "world-census.json"), JSON.stringify(c, null, 2));
    if (c.error) {
      assert(false, "renderer + scene readable", c.error);
    } else {
      log(`        calls=${c.calls} tris=${c.triangles.toLocaleString()} textures=${c.textures} meshes=${c.meshes} (skinned ${c.skinned}, instanced ${c.instanced}/${c.instances}) whiteBoxes=${c.whiteBoxes}`);
      assert(c.calls >= WORLD.minCalls && c.calls <= WORLD.maxCalls, "draw calls in a sane band",
        `renderer.info.render.calls=${c.calls}, expected ${WORLD.minCalls}..${WORLD.maxCalls} (near-zero = empty scene)`);
      assert(c.triangles >= WORLD.minTris && c.triangles <= WORLD.maxTris, "triangle count in a sane band",
        `renderer.info.render.triangles=${c.triangles}, expected ${WORLD.minTris}..${WORLD.maxTris}`);
      assert(c.textures >= WORLD.minTextures, "textures uploaded",
        `only ${c.textures} textures on the GPU (a wiped scene would be near zero)`);
      assert(c.whiteBoxes === 0, "no untextured white-box props",
        `${c.whiteBoxes} lit mesh(es) with no base-color map and a near-white colour — the white-box signature: ${JSON.stringify(c.whiteExamples)}`);
    }
    await page.screenshot({ path: join(OUT, "world-spawn.png") }).catch(() => {});
  }

  // ---- ROUTE ----
  if (wants("route")) {
    log("\n[ROUTE] driven approach through the mandatory encounters");
    await page.mouse.click(640, 400).catch(() => {});
    await page.evaluate(() => window.__diag?.reset?.()).catch(() => {});

    const aim = async (wp, pos) => {
      if (!wp) return;
      const yaw = Math.atan2(wp.x - pos.x, wp.z - pos.z);
      await page.evaluate((y) => { const L = window.__look; if (L?.look) L.look.yaw = y; }, yaw).catch(() => {});
    };
    const answer = async () => {
      await page.keyboard.up("KeyW").catch(() => {});
      for (let i = 0; i < 120; i++) {
        const cur = await page.evaluate(MISSION_READ).catch(() => null);
        if (!cur?.encView || cur.encView.phase === "RESOLVED") break;
        const box = await page.$("#msn-enc-input");
        if (box && !(await box.evaluate((el) => el.disabled).catch(() => true))) {
          await box.click().catch(() => {});
          await box.fill("Lawful business; the stamp is Parliament's and I carry cleared paper.").catch(() => {});
        }
        const btn = await page.$(".msn-enc-submit");
        if (btn) await btn.click().catch(() => {});
        await sleep(180);
      }
      await page.keyboard.down("KeyW").catch(() => {});
    };

    await page.keyboard.down("ShiftLeft");
    await page.keyboard.down("KeyW");

    const mandatory = new Map(); // id -> { armedAtS, resolvedAtS }
    let maxProgressX = -Infinity, prevPos = null, stall = 0, maxStall = 0, softLock = null;
    const start = Date.now();
    let outcome = null;
    while ((Date.now() - start) / 1000 < ROUTE.capS) {
      const tS = (Date.now() - start) / 1000;
      const s = await page.evaluate(MISSION_READ).catch(() => null);
      if (!s) { await sleep(80); continue; }
      for (const e of s.encounters) {
        if (!mandatory.has(e.id)) mandatory.set(e.id, { armedAtS: null, resolvedAtS: null });
        const rec = mandatory.get(e.id);
        if (rec.armedAtS === null && e.phase !== "DORMANT") rec.armedAtS = tS;
        if (rec.resolvedAtS === null && (e.phase === "RESOLVED" || e.phase === "RELEASED")) rec.resolvedAtS = tS;
      }
      if (s.pos.x > maxProgressX) maxProgressX = s.pos.x;
      if (s.outcome) { outcome = s.outcome; break; }

      // Soft-lock watch: an encounter that armed but has not resolved in time.
      for (const [id, rec] of mandatory) {
        if (rec.armedAtS !== null && rec.resolvedAtS === null && tS - rec.armedAtS > ROUTE.encArmTimeoutS) {
          softLock = { id, armedForS: +(tS - rec.armedAtS).toFixed(1) };
        }
      }
      if (softLock) break;

      if (s.encView && s.encView.phase !== "RESOLVED" && s.encLocked) { await answer(); prevPos = null; stall = 0; continue; }
      if (s.beat === "ACTIVE") await page.keyboard.press("KeyF").catch(() => {});
      await aim(s.wp, s.pos);
      if (s.grounded && JUMP_VERBS.includes(s.preview)) await page.keyboard.press("Space").catch(() => {});

      // Hang watch (free-running only): motionless too long.
      if (prevPos && !s.encLocked) {
        const moved = Math.hypot(s.pos.x - prevPos.x, s.pos.z - prevPos.z);
        stall = moved < 0.05 ? stall + 0.09 : 0;
      }
      if (stall > maxStall) maxStall = stall;
      prevPos = s.pos;

      // Stop once every mandatory stop has resolved — no need to drive into the
      // skill-beat section the autonomous driver deliberately does not play.
      const allResolved = mandatory.size > 0 && [...mandatory.values()].every((r) => r.resolvedAtS !== null);
      if (allResolved && tS > 3) break;

      // A genuine hang before the stops are done is a failure, not something to wait out.
      if (stall > ROUTE.stallLimitS) break;
      await sleep(80);
    }
    await page.keyboard.up("KeyW").catch(() => {});
    await page.keyboard.up("ShiftLeft").catch(() => {});
    const elapsedS = +((Date.now() - start) / 1000).toFixed(1);

    const pen = await page.evaluate(() => {
      const d = window.__diag;
      if (!d) return { available: false };
      let maxInv = 0, invId = null, maxStrict = 0, strictId = null;
      for (const e of d.embeds) {
        for (const s of e.invariant) if (s.depthM > maxInv) { maxInv = s.depthM; invId = s.id; }
        for (const s of e.strict) if (s.depthM > maxStrict) { maxStrict = s.depthM; strictId = s.id; }
      }
      return { available: true, embedTicks: d.embeds.length, maxInv: +maxInv.toFixed(3), invId, maxStrict: +maxStrict.toFixed(3), strictId };
    }).catch(() => ({ available: false }));

    const encSummary = [...mandatory.entries()].map(([id, r]) =>
      `${id}{armed:${r.armedAtS === null ? "no" : r.armedAtS.toFixed(0) + "s"},resolved:${r.resolvedAtS === null ? "NO" : r.resolvedAtS.toFixed(0) + "s"}}`);
    log(`        elapsed=${elapsedS}s progressX=${maxProgressX.toFixed(0)} maxStall=${maxStall.toFixed(1)}s outcome=${outcome ? outcome.kind : "(stopped after stops resolved)"} penetration(invariant)=${pen.maxInv ?? "n/a"}m`);
    log(`        encounters: ${encSummary.join("  ")}`);
    writeFileSync(join(OUT, "route.json"), JSON.stringify({ url, elapsedS, maxProgressX, maxStall, outcome, mandatory: Object.fromEntries(mandatory), pen, pageErrors }, null, 2));

    // A stuck-then-timeout outcome is a HANG, not a normal loss.
    const timedOutWhileStuck = outcome?.code === "TRAVERSAL_TIMEOUT" && (softLock || maxStall > ROUTE.stallLimitS);

    assert(mandatory.size > 0, "mandatory encounters exist on the route",
      "the run saw no authored encounters at all — the route or its stops are gone");
    for (const [id, rec] of mandatory) {
      assert(rec.armedAtS !== null, `encounter ${id} arms`,
        `${id} never left DORMANT during the driven approach — the trigger did not fire or the section is unreachable`);
      assert(rec.resolvedAtS !== null, `encounter ${id} resolves`,
        `${id} armed at ${rec.armedAtS}s but never reached RESOLVED — the beat hangs (soft-lock); the speaker never closed / the question never opened`);
    }
    assert(!softLock, "no encounter soft-lock",
      softLock ? `encounter ${softLock.id} sat armed-but-unresolved for ${softLock.armedForS}s (> ${ROUTE.encArmTimeoutS}s)` : "");
    assert(!timedOutWhileStuck, "no beat hang (stuck-then-timeout)",
      `the run hit TRAVERSAL_TIMEOUT while stuck (maxStall=${maxStall.toFixed(1)}s) — the timer expired because the player was stranded, not because of a fair loss`);
    assert(maxStall <= ROUTE.stallLimitS || outcome === null, "no hang before the stops resolve",
      `the run was motionless for ${maxStall.toFixed(1)}s (> ${ROUTE.stallLimitS}s) while free-running`);
    assert(maxProgressX >= ROUTE.minProgressX, "route advances through the street in order",
      `the driven run only reached x=${maxProgressX.toFixed(0)} (< ${ROUTE.minProgressX}); it never got past the Shambles/ropewalk`);
    if (pen.available) {
      assert(pen.maxInv < ROUTE.penInvariantLimitM, "no penetration during play",
        `a body was ${pen.maxInv}m inside solid hull "${pen.invId}" (invariant limit ${ROUTE.penInvariantLimitM}m) — window.__diag recorded a body inside solid geometry`);
    } else {
      notes.push("ROUTE: window.__diag penetration ring unavailable (non-dev build?) — penetration not checked");
      log("        note: window.__diag unavailable; penetration not checked");
    }
  }

  await page.close();
}

// ---------------------------------------------------------------------------
// STAGE: YARD (reach the rope-walk yard via a drop-in on the final section).
// ---------------------------------------------------------------------------
async function stageYard(browser) {
  log("\n[YARD] a driven run reaches the rope-walk yard");
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const url = `${BASE}/src/mission/floor.html?at=${YARD.at}&toward=${YARD.toward}&encounterVerdict=correct`;
  await page.goto(url, { waitUntil: "commit", timeout: 120000 });
  let up = false;
  for (let i = 0; i < 250; i++) {
    if ((await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null)) !== null) { up = true; break; }
    await sleep(200);
  }
  if (!up) { assert(false, "mission runtime comes up (yard drop-in)", `window.__floor never appeared at ${url}`); await page.close(); return; }
  await sleep(3000);
  await page.mouse.click(640, 400).catch(() => {});
  await page.evaluate(() => window.__diag?.reset?.()).catch(() => {});
  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("KeyW");
  let inYard = false, last = null;
  const start = Date.now();
  while ((Date.now() - start) / 1000 < YARD.capS) {
    const s = await page.evaluate(MISSION_READ).catch(() => null);
    if (s) {
      last = s.pos;
      if (s.pos.x >= YARD.minX && s.pos.x <= YARD.maxX && s.pos.z >= YARD.minZ && s.pos.z <= YARD.maxZ) { inYard = true; break; }
      if (s.grounded && JUMP_VERBS.includes(s.preview)) await page.keyboard.press("Space").catch(() => {});
    }
    await sleep(80);
  }
  await page.keyboard.up("KeyW").catch(() => {});
  await page.keyboard.up("ShiftLeft").catch(() => {});
  await page.screenshot({ path: join(OUT, "yard.png") }).catch(() => {});
  log(`        final pos=${last ? `[${last.x.toFixed(0)},${last.y.toFixed(0)},${last.z.toFixed(0)}]` : "n/a"} inYard=${inYard}`);
  assert(inYard, "reaches the rope-walk yard region",
    `driven from ${YARD.at} toward the yard, the player ended at ${last ? `x=${last.x.toFixed(0)},z=${last.z.toFixed(0)}` : "unknown"} and never entered YARD [x ${YARD.minX}..${YARD.maxX}, z ${YARD.minZ}..${YARD.maxZ}] within ${YARD.capS}s`);
  await page.close();
}

// ---------------------------------------------------------------------------
// STAGE: DUEL (world loads, and grading discriminates).
// ---------------------------------------------------------------------------
// botSky: fraction of the lower-centre band of a screenshot that is open sky. A
// real arena fills that band with ground/props; the void leaves it sky. Computed
// in-page by drawing the screenshot onto a 2D canvas and reading pixels, so it
// needs no image library. Calibrated: void 0.885, real yard 0.058.
function skyFractionOfPng(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const W = c.width, H = c.height;
      const d = ctx.getImageData(0, 0, W, H).data;
      const isSky = (r, g, b) => b > 120 && b >= r && b >= g && b - r < 90 && b - r > -10 && r > 90;
      let total = 0, sky = 0;
      const y0 = Math.floor(H * 0.72), y1 = Math.floor(H * 0.98);
      const x0 = Math.floor(W * 0.30), x1 = Math.floor(W * 0.70);
      for (let y = y0; y < y1; y += 3) for (let x = x0; x < x1; x += 3) {
        const i = (y * W + x) * 4; total++; if (isSky(d[i], d[i + 1], d[i + 2])) sky++;
      }
      resolve(total ? sky / total : 1);
    };
    img.onerror = () => reject(new Error("could not decode screenshot"));
    img.src = dataUrl;
  });
}

async function duelBotSky(page) {
  const buf = await page.screenshot();
  const dataUrl = `data:image/png;base64,${buf.toString("base64")}`;
  return page.evaluate(skyFractionOfPng, dataUrl);
}

async function stageDuel(browser) {
  // --- world loads (verdict=live must not be an empty void) ---
  log("\n[DUEL] the harness loads a world (verdict=live)");
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const denials = watchOriginDenials(page);
    const url = `${BASE}/src/duel/duel.html?verdict=live`;
    await page.goto(url, { waitUntil: "commit", timeout: 120000 });
    let mounted = false;
    for (let i = 0; i < 250; i++) {
      if (await page.evaluate(() => !!window.__duel).catch(() => false)) { mounted = true; break; }
      await sleep(200);
    }
    await sleep(6000);
    if (!mounted) {
      await page.screenshot({ path: join(OUT, "duel-live-fail.png") }).catch(() => {});
      const notice = await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => "");
      assert(false, "duel harness opens a graded attempt",
        `verdict=live never mounted a duel (window.__duel absent). It opens a real attempt, so this stage needs the API up.${originMismatchHint(denials)} On-screen: ${JSON.stringify(notice)}`);
    } else {
      const botSky = await duelBotSky(page).catch(() => 1);
      await page.screenshot({ path: join(OUT, "duel-live.png") }).catch(() => {});
      const pos = await page.evaluate(() => { try { const s = window.__duel.getState(); return { A: s.combat.fighters.A.motion.pos, B: s.combat.fighters.B.motion.pos }; } catch { return null; } }).catch(() => null);
      log(`        botSky=${botSky.toFixed(3)} (void>${DUEL.voidBotSkyMax}) fighters=${pos ? `A(${pos.A.x.toFixed(0)},${pos.A.z.toFixed(0)}) B(${pos.B.x.toFixed(0)},${pos.B.z.toFixed(0)})` : "n/a"}`);
      assert(botSky <= DUEL.voidBotSkyMax, "duel renders a world, not an empty void",
        `the lower-centre of the frame is ${(botSky * 100).toFixed(0)}% open sky (> ${(DUEL.voidBotSkyMax * 100).toFixed(0)}%) — the fighters are standing in the void with no arena around them (the arena is drawn at the origin while the fight is at the mission's coordinates)`);
    }
    await page.close();
  }

  // --- grading discriminates (scripted correct vs wrong, no classifier needed) ---
  log("\n[DUEL] a graded answer discriminates right from wrong");
  const magazineAfterAnswer = async (mode) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const url = `${BASE}/src/duel/duel.html?verdict=${mode}`;
    await page.goto(url, { waitUntil: "commit", timeout: 120000 });
    for (let i = 0; i < 250; i++) { if (await page.evaluate(() => !!window.__duel).catch(() => false)) break; await sleep(200); }
    const readHud = () => page.evaluate(() => { const d = window.__duel; if (!d) return null; const h = d.getHud(); return { phase: h.phase, magA: h.magazine.A, magB: h.magazine.B }; }).catch(() => null);
    let sawQ = false;
    for (let i = 0; i < 150; i++) {
      const h = await readHud();
      if ((await page.$("textarea.duel-answer")) && h?.phase === "QUESTION_PENDING") { sawQ = true; break; }
      await sleep(300);
    }
    let result = { sawQ, magA: null };
    if (sawQ) {
      await page.fill("textarea.duel-answer", "Parliament resolved the colonies should help pay the war debt through the stamp.").catch(() => {});
      const cards = await page.$$("button.ev-mini-face");
      for (let i = 0; i < cards.length && i < 4; i++) {
        await cards[i].click().catch(() => {});
        await sleep(180);
        if (!(await page.$eval("button.duel-submit", (b) => b.disabled).catch(() => true))) break;
      }
      if (!(await page.$eval("button.duel-submit", (b) => b.disabled).catch(() => true))) {
        await page.click("button.duel-submit").catch(() => {});
        for (let i = 0; i < 40; i++) { const h = await readHud(); if (h && (h.phase === "BULLETS_GRANTED" || h.magA > 0)) { result.magA = h.magA; break; } await sleep(200); }
      }
    }
    await page.close();
    return result;
  };
  const correct = await magazineAfterAnswer("correct");
  const wrong = await magazineAfterAnswer("wrong");
  log(`        player magazine: correct=${correct.magA} wrong=${wrong.magA}`);
  writeFileSync(join(OUT, "duel-grading.json"), JSON.stringify({ correct, wrong }, null, 2));
  if (!correct.sawQ || !wrong.sawQ) {
    assert(false, "duel opens a question in both modes",
      `could not reach the answer panel (correct.sawQ=${correct.sawQ}, wrong.sawQ=${wrong.sawQ})`);
  } else {
    assert(correct.magA !== null && wrong.magA !== null, "duel commits a graded verdict in both modes",
      `no magazine granted (correct=${correct.magA}, wrong=${wrong.magA})`);
    assert(correct.magA > wrong.magA && wrong.magA > 0, "a graded answer discriminates right from wrong",
      `a correct answer loaded ${correct.magA} balls and a wrong one ${wrong.magA} — grading is not discriminating (a wrong answer must pay fewer than a right one)`);
  }
}

// ---------------------------------------------------------------------------
async function main() {
  log(`check-playthrough → ${BASE}`);
  if (!(await reachable(`${BASE}/`))) {
    log(`\nFATAL: no dev web server reachable at ${BASE}.`);
    log(`Start one (a port the owner is not using), e.g.:`);
    log(`  (cd apps/web && node node_modules/vite/bin/vite.js --port 5273 --strictPort)`);
    log(`The DUEL stage also needs the API up (verdict=live opens a throwaway attempt).`);
    process.exit(2);
  }

  const browser = await launch();
  try {
    if (wants("world") || wants("route")) await stageWorldAndRoute(browser);
    if (wants("yard")) await stageYard(browser);
    if (wants("duel")) await stageDuel(browser);
  } finally {
    await browser.close();
  }

  log("\n==================== PLAYTHROUGH ====================");
  for (const n of notes) log(`  note: ${n}`);
  if (failures.length === 0) {
    log(`ALL PASS — the mission renders, the route advances, every stop resolves, and the duel loads a graded world.`);
    process.exit(0);
  }
  log(`${failures.length} CHECK(S) FAILED:`);
  for (const f of failures) log(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}

await main();
