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
//   REFUSAL "no ladder, no climb", in real play. At the foot of an authored ladder
//          a climb ARMS; with every ladder and grip stripped from the live world
//          the SAME climb volume REFUSES (nothing offered, nothing performed). A
//          controlled A/B whose only difference is the affordance — the runtime
//          half of the fix the floating-ladder / climb-through bugs needed.
//   BEAT   the Liberty Elm crown is REACHED BY CLIMBING (not by spawning on the
//          bough as the unit test does), and the posting beat ARMS from where the
//          climb arrives — reachability against the widened stance (2.4 m, ±135°).
//   DUEL   the duel harness LOADS A WORLD (verdict=live must not render the two
//          fighters into an empty void), a graded answer discriminates right from
//          wrong (verdict=correct grants more balls than wrong), and the GRADER
//          RAN ON THE REAL PATH — a live answer moves the API's own grading window
//          (/v1/health), which a client-minted fallback the server never saw could
//          not do.
//
// WHAT IT DELIBERATELY DOES NOT ASSERT, with the reason (see the report / README):
//   Full REACHED_DUEL completion is NOT required of the autonomous driver. The
//   terminal objective is gated on the reaction-timing posting beat at the Liberty
//   Elm and a precise bough dismount; a bot that reliably executes that skill beat
//   is itself a flaky dependency, and a flaky gate gets disabled — worse than none.
//   BEAT proves the crown is reachable and the beat ARMS; it does not play the
//   flare-timing skill beat to RESOLVED. And the grader check proves the real path
//   ran, NOT that a model classified: with no classifier credential (the CI shape)
//   classifiedInWindow cannot move, and asserting a real classification would need
//   a live model call — a flaky external dependency this gate refuses to take on.
//
// USAGE
//   node scripts/check-playthrough.mjs [baseURL] [--only world,route,yard,refusal,beat,duel]
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

// ---- reproduction knobs (default OFF; the shipped gate is unchanged) -------
// The gate must be provable BOTH WAYS: that it PASSES on a deliberately starved
// renderer (the CI shape — no GPU, software WebGL, a loaded CPU) and still FAILS
// on a genuinely stalled body. These env knobs recreate the starved renderer
// locally so that proof is reproducible; they are read only from the environment
// and default off, so a normal `node scripts/check-playthrough.mjs` run — and CI
// — behaves exactly as before.
//   PLAYTHROUGH_SOFTWARE_GL=1     force software WebGL (SwiftShader) + no GPU —
//                                 the CI runner's rasteriser, which is what makes
//                                 the render loop slow and drops the sim's ticks.
//   PLAYTHROUGH_CPU_THROTTLE=<n>  CDP CPU throttle multiplier (e.g. 4 = 4x slower)
//                                 applied to every page, to amplify the slowdown.
const SOFTWARE_GL = process.env.PLAYTHROUGH_SOFTWARE_GL === "1";
const CPU_THROTTLE = Number(process.env.PLAYTHROUGH_CPU_THROTTLE ?? "") || 1;

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
// ---- the SIMULATION CLOCK is the measure, not wall-clock -------------------
// WHY (traced, not inferred). The mission sim runs at a FIXED 60 Hz
// (engine-world FIELD_TICK_HZ): every step is exactly 1/60 s of SIMULATED time,
// and the body's position is a deterministic function of the STEPS that
// EXECUTED, not of how long they took in wall-clock (traversal.ts:
// "a 1/30, 1/60 or 1/120 frame delta over the same elapsed time visits the same
// integer ticks"). Each render frame, advanceFieldClock runs at most
// MAX_CATCHUP_STEPS (5) fixed steps and DISCARDS the rest — dropped sim time is
// NOT banked (diag.ts: "a dropped step is sim time DISCARDED, i.e. slow motion").
// So on a runner whose render loop is slow (no GPU → software WebGL), the sim
// runs in heavy slow-motion. Measured on this harness: a full-scenery run drops
// ~2/3 of its steps and advances ~1.5 sim-ticks per wall-second; a bare run ~24.
// That is the whole flake: a wall-clock budget ("reach x=60 in 95 s") measures
// the RENDERER, so a cold/loaded/headless run under-progresses and trips a
// threshold a warm run clears.
//
// THE FIX, two parts, both here in the harness:
//  (1) MEASURE IN SIM TICKS. Every budget below is counted in rt.ticks (mission)
//      or combat.tick (duel), which advance identically per unit of SIMULATED
//      progress on any machine. A slow runner simply takes more wall-clock to
//      accrue the same ticks; metres-per-tick is unchanged, so it clears the same
//      thresholds. This is what makes the gate machine-independent.
//  (2) DRIVE THE DRIVEN STAGES IN BARE MODE (?bare=1). The collision world,
//      route, encounters, ladders/grips, beat and field are AUTHORED DATA,
//      unchanged by scenery (devEntry.tsx: "the run is unchanged — this only
//      stops the level's art loading"); window.__diag penetration is dev-gated,
//      not scenery-gated. Bare removes the GLB render cost that starves the loop,
//      so the sim runs ~16x faster and the tick budgets clear in bounded
//      wall-clock even on a GPU-less runner. WORLD keeps scenery (it IS the
//      render census); nothing else needs the picture to assert its authored verdict.
//
// HOW THIS STILL CATCHES A REAL STALL (the point of the gate — the PAST-DAWN
// soft-lock drained the mission clock while the body sat stuck). Three distinct
// signals, distinguished by construction:
//  - a SLOW runner: rt.ticks advances (fewer per wall-second), and the body
//    ADVANCES per tick → passes. Tick-relative, so slowness alone never fails it.
//  - a real STALL (wedged body / soft-lock): rt.ticks keeps advancing but the
//    body does NOT move across `stallTicks` executed ticks, or an encounter sits
//    armed-but-unresolved past `encArmTimeoutTicks` — both defined in SIM ticks,
//    exactly the units the soft-lock clock drains in → fails.
//  - a DEAD sim (hung/crashed page): rt.ticks stops advancing at all. Caught by
//    SIM_DEAD_WALL_S, the ONLY wall-clock assertion — it asserts the process is
//    ticking, never how far it got, so a slow renderer cannot trip it.
const TICK_HZ = 60; // engine-world FIELD_TICK_HZ; the fixed step the sim runs at.
const SIM_DEAD_WALL_S = 45; // rt.ticks not advancing for this long in REAL time is a
                            // hung/crashed page — the one honest wall-clock failure.
const ROUTE = {
  seed: "0xb057",
  bare: true, // drive without scenery (authored verdicts unchanged; see the SIM CLOCK note)
  // Sim-tick budgets. Calibrated from a healthy bare run (logged as "consumed"
  // in route.json) and set to a generous multiple so a slow runner never trips
  // the ceiling before the drive is done. See the SIM CLOCK note for why ticks.
  capTicks: 12000,          // ~200 s of SIMULATED time; the whole-approach ceiling
  encArmTimeoutTicks: 1800, // ~30 s of sim armed-but-unresolved is a soft-lock
  // No 0.5 m of ground for this many EXECUTED sim ticks — DESPITE the un-stick
  // nudges — is a genuine wedge, not a slow renderer (which advances per tick) and
  // not a transient (which the un-stick clears in well under this; measured worst
  // ~270 ticks under software WebGL). Well separated from a healthy worst stall (~90).
  stallTicks: 1500,
  minProgressX: 60, // a driven run that never gets this far east never reached the ropewalk
  penInvariantLimitM: 0.3, // the shipped non-penetration invariant's tolerance
};
const YARD = {
  // rect(88, 100, -6.5, 6.5) from mission-m1 geometry; the route's end line.
  minX: 88, maxX: 100, minZ: -6.5, maxZ: 6.5,
  at: "F_VAULT_OUT", toward: "G_SPAWN", // drop just outside the gate, facing in
  bare: true,
  capTicks: 4000,   // ~65 s of sim to cover the short final stretch into the yard
  stallTicks: 1500, // no xz progress across this many sim ticks, despite un-stick, is a wedge
};
const DUEL = {
  // botSky = fraction of the lower-centre band that is open sky. A real arena fills
  // it with ground/props (~0.06); the void leaves the fighters in open sky (~0.89).
  voidBotSkyMax: 0.5,
};
// REFUSAL — "no ladder, no climb", exercised in real play. Spawns at the foot of
// the authored scaffold ladder (route node C_SCAFF_FOOT, the SCAFFOLD_D1 climb
// volume) and drives the body up. With the ladder present a climb must ARM; with
// every ladder AND grip stripped from the live collision world the same climb
// volume must REFUSE — nothing offered, nothing performed. The stance is written
// against OBSERVABLE behaviour (previewVerb / motion.phase / flow.verb /
// verbsUsed), never the probe internals, because the engine lane is actively
// changing parkour/probe.ts. Real ladder/grip coordinates come from
// packages/mission-m1/src/level/ladders.ts, not invented here.
const REFUSAL = {
  at: "C_SCAFF_FOOT", toward: "C_SCAFF_1", climbSurface: "SCAFFOLD_D1",
  bare: true,
  driveTicks: 360, // ~6 s of SIM: long enough that a refusal that leaks would have
                   // climbed by now, counted in sim ticks so a slow renderer that
                   // executes them slowly gets the same 360 steps of driving.
};
// BEAT — the Liberty Elm posting beat must be REACHED BY CLIMBING, not assumed by
// spawning on the bough (which is exactly what missionBeat.test.ts does). Drops in
// on the low bough (F_LOW), climbs the authored elm GRIP to the crown (F_CROWN),
// and asserts the beat ARMS from where the climb arrives. Reachability, not the
// old tight stance values — the tolerances were widened to 2.4 m / ±135°.
const BEAT = {
  at: "F_LOW", toward: "F_CROWN",
  bare: true,
  crownY: 8.0, // BOUGH_CROWN band is 8.3; 8.0 is "arrived at the crown"
  climbTicks: 600,  // ~10 s of SIM to climb bough → crown (counted in sim ticks)
  settleTicks: 360, // ~6 s of SIM in the stance for the beat to arm
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
  const args = [
    "--headless=new",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
  ];
  if (SOFTWARE_GL) {
    // The CI runner has no GPU, so WebGL is SwiftShader (software). Forcing it
    // locally reproduces the slow render loop that drops the sim's ticks.
    args.push("--use-gl=swiftshader", "--use-angle=swiftshader", "--disable-gpu");
    log("  (repro) PLAYTHROUGH_SOFTWARE_GL=1 — forcing software WebGL (SwiftShader)");
  } else {
    args.push("--ignore-gpu-blocklist", "--enable-gpu-rasterization");
  }
  const opts = { headless: true, args };
  if (existsSync(CHROME)) opts.executablePath = CHROME;
  return chromium.launch(opts);
}

// Every page is opened through here so the optional CPU throttle is applied
// uniformly. With the knob off this is just browser.newPage.
async function openPage(browser, opts = { viewport: { width: 1280, height: 800 } }) {
  const page = await browser.newPage(opts);
  if (CPU_THROTTLE > 1) {
    try {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
    } catch {
      /* CDP unavailable (non-Chromium): the knob is best-effort for local repro */
    }
  }
  return page;
}

// A SIM-CLOCK watchdog, shared by every driven stage. It reads the fixed-step
// tick counter each poll and tracks three things, so a caller's loop can be
// written in SIM TICKS rather than wall-clock:
//   - elapsed(): sim ticks since the first read (the machine-independent budget),
//   - stalled(sinceTick, val): whether a progress value has not advanced for
//     `stallTicks` EXECUTED ticks (a wedged body, not a slow one),
//   - simDead(): whether rt.ticks has not advanced for SIM_DEAD_WALL_S REAL
//     seconds (a hung/crashed page — the one honest wall-clock failure).
function makeSimClock() {
  let startTick = null, lastTick = null, lastTickWallMs = Date.now();
  return {
    /** Feed each poll's tick reading. Returns sim ticks elapsed since the first. */
    tick(t) {
      if (t == null) return this.elapsed;
      if (startTick === null) startTick = t;
      if (t !== lastTick) { lastTick = t; lastTickWallMs = Date.now(); }
      this.elapsed = t - startTick;
      this.current = t;
      return this.elapsed;
    },
    elapsed: 0,
    current: null,
    /**
     * REAL time since rt.ticks last advanced (or since the drive began, if it has
     * never advanced) — the ONLY wall-clock signal in the gate. True means the
     * page is hung or crashed: the sim is not stepping at all. A merely slow
     * renderer keeps advancing rt.ticks (just fewer per wall-second) and never
     * trips this, which is the whole point.
     */
    simDead() {
      return (Date.now() - lastTickWallMs) / 1000 > SIM_DEAD_WALL_S;
    },
  };
}

// A human-like UN-STICK for the driven free-run. The bot drives with held-W +
// aim-at-waypoint + jump-on-preview, which reliably follows the guided line but
// is NOT a skilled parkour player: when the sim runs slow, the exact tick a press
// lands on shifts (input is delivered at wall-clock poll boundaries, the sim runs
// up to MAX_CATCHUP_STEPS per frame), and at a chained climb/vault/leap the bot can
// mistime the chain and wedge — the transient the sibling lane saw as "stalled at
// x≈29, cleared on re-run". This makes that recovery deterministic: while the body
// is making no ground, rotate the aim off the waypoint line and force a jump,
// cycling directions, exactly as a player wiggles out of a snag.
//
// WHY THIS DOES NOT MASK A REAL STALL. It is BOUNDED by the stall ceiling
// (`stallTicks`): if the nudges do not restore progress within that many EXECUTED
// sim ticks, the body is genuinely wedged and the stage still FAILS. A nudge
// cannot conjure an affordance that is not there, so a real block does not yield
// to it; and it fires ONLY while free-running (never during an encounter), so the
// soft-lock the gate exists to catch — an encounter armed-but-unresolved, the
// PAST-DAWN drain — is untouched and still trips `encArmTimeoutTicks`.
function makeUnsticker() {
  const OFFSETS = [1.2, -1.2, 2.4, Math.PI, 0.6, -0.6]; // radians off the waypoint line
  const BURST_TICKS = 90; // ~1.5 s of sim per direction before trying the next
  let untilTick = -1, offset = 0, seq = 0;
  return {
    /** Call each poll with the current sim tick and whether the body is stalling. */
    step(tick, stalling) {
      if (stalling && tick > untilTick) { offset = OFFSETS[seq % OFFSETS.length]; seq++; untilTick = tick + BURST_TICKS; }
      const active = tick <= untilTick;
      return { yawOffset: active ? offset : 0, forceJump: active };
    },
    reset() { untilTick = -1; }, // called when the body makes real ground again
    get bursts() { return seq; },
  };
}
const UNSTICK_AFTER_TICKS = 240; // no 0.5 m of ground for this many sim ticks → start wiggling

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
    // The FIXED-STEP simulation clock. Progress is measured against this, never
    // wall-clock: rt.ticks advances one per 1/60 s of SIMULATED time, and the
    // body's motion is a pure function of the ticks that executed (see the SIM
    // CLOCK note by the config). A slow renderer runs fewer ticks per wall-second
    // but the same metres per tick, so a tick-relative budget is machine-independent.
    ticks: rt.ticks ?? null,
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

// The climb-affordance observables, read off the running game's own black boxes.
// previewVerb is what the geometry OFFERS (the affordance cue, computed every step
// regardless of consent); motion.phase / flow.verb / verbsUsed are what actually
// RAN. A refusal is the absence of all four; a climb is the presence of any.
const CLIMB_READ = () => {
  const rt = window.__floor;
  if (!rt || !rt.motion) return null;
  const m = rt.motion;
  return {
    ticks: rt.ticks ?? null, // the fixed-step sim clock; see MISSION_READ / the SIM CLOCK note.
    pos: { x: m.pos.x, y: m.pos.y, z: m.pos.z },
    phase: m.phase,
    grounded: m.grounded,
    previewVerb: rt.flow?.previewVerb ?? null,
    verb: rt.flow?.verb ?? null,
    climbing: m.phase === "CLIMB_UP" || rt.flow?.verb === "CLIMB_UP",
    climbUsed: [...(rt.verbsUsed ?? [])].includes("CLIMB_UP"),
    climbOffered: rt.flow?.previewVerb === "CLIMB_UP",
    beat: rt.beat ? rt.beat.phase : null,
  };
};

// The API's own grading counters, read without a session off /v1/health through
// the web dev server's proxy. `configured:false` (no classifier credential — the
// CI shape) pins the model out of reach, so `classifiedInWindow` cannot move; what
// still moves when a REAL duel round reaches the server pipeline is the round /
// gradeable count, and that is the honest proof the grader ran in play rather than
// the client minting a fallback the server never saw.
async function fetchGrading() {
  try {
    const res = await fetch(`${BASE}/v1/health`, { signal: AbortSignal.timeout(4000) });
    const json = await res.json();
    return json?.grading ?? null;
  } catch {
    return null;
  }
}

// Boot a mission-floor drop-in at a named route node and wait for the runtime to
// tick. No GLB settle is needed here (these stages read the collision world and
// motion, not the render census), so the wait is short.
async function bootMissionAt(browser, at, toward, { settleMs = 2500, bare = false } = {}) {
  const page = await openPage(browser);
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
  // Driven stages spawn in BARE mode so the sim is not slow-motioned by the GLB
  // render cost (see the SIM CLOCK note); the authored world they read is identical.
  const bareParam = bare ? "&bare=1" : "";
  const url = `${BASE}/src/mission/floor.html?hold=0&at=${at}&toward=${toward}&encounterVerdict=correct${bareParam}`;
  await page.goto(url, { waitUntil: "commit", timeout: 120000 });
  let up = false;
  for (let i = 0; i < 300; i++) {
    if ((await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null)) !== null) { up = true; break; }
    await sleep(200);
  }
  if (up) await sleep(settleMs);
  return { page, url, up, pageErrors };
}

// Sprint the body forward (Shift+W) and buffer Space each grounded tick so a gated
// upward ascent commits. Watches the climb observables for the whole window (or
// until the first climb, when breakOnClimb is set). Returns what it saw.
async function driveAndWatchClimb(page, driveTicks, { breakOnClimb = false } = {}) {
  await page.mouse.click(640, 400).catch(() => {});
  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("KeyW");
  let climbArmed = false, climbOffered = false, maxY = -Infinity;
  const verbs = new Set();
  // Drive for `driveTicks` SIM ticks, not wall-clock seconds: a slow renderer
  // executes the same number of climb-arming steps, just over more wall time.
  const clock = makeSimClock();
  let simDead = false;
  while (clock.elapsed < driveTicks) {
    const s = await page.evaluate(CLIMB_READ).catch(() => null);
    if (s) {
      clock.tick(s.ticks);
      if (s.pos.y > maxY) maxY = s.pos.y;
      if (s.verb && s.verb !== "NONE") verbs.add(s.verb);
      if (s.climbOffered) climbOffered = true;
      if (s.climbing || s.climbUsed) { climbArmed = true; climbOffered = true; }
      if (s.grounded) await page.keyboard.press("Space").catch(() => {});
      if (breakOnClimb && climbArmed) break;
    }
    if (clock.simDead()) { simDead = true; break; }
    await sleep(100);
  }
  await page.keyboard.up("KeyW").catch(() => {});
  await page.keyboard.up("ShiftLeft").catch(() => {});
  return { climbArmed, climbSeen: climbArmed || climbOffered, maxY, verbs: [...verbs], simTicks: clock.elapsed, simDead };
}

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

// WORLD needs the full scene (it IS the render census), so it runs on a SCENERY
// page. ROUTE reads authored motion / encounter / penetration state, so it runs
// on a separate BARE page where the sim is not slow-motioned by the GLB render
// cost (see the SIM CLOCK note). They no longer share a page.
async function stageWorldAndRoute(browser) {
  if (wants("world")) await stageWorld(browser);
  if (wants("route")) await stageRoute(browser);
}

async function stageWorld(browser) {
  const page = await openPage(browser);
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
  // Wait for the scene to finish LOADING rather than a fixed sleep: on a slow
  // loader (a GPU-less runner) the GLBs decode and upload late, and an 8 s census
  // would count a half-loaded scene and false-fail the triangle/texture bands.
  // Poll the texture count until it stops climbing for a few polls (loaded) or a
  // generous cap. This is the render census's version of "measure, don't race the
  // clock": settle on the observed state, not a guessed duration.
  let texPrev = -1, texStable = 0;
  for (let i = 0; i < 90; i++) {
    const t = await page.evaluate(() => window.__stage?.gl?.info?.memory?.textures ?? 0).catch(() => 0);
    if (t > 0 && t === texPrev) { if (++texStable >= 3) break; } else texStable = 0;
    texPrev = t;
    await sleep(1000);
  }
  await sleep(1000); // a last frame or two after the uploads settle

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
  await page.close();
}

async function stageRoute(browser) {
  log("\n[ROUTE] driven approach through the mandatory encounters (bare; measured in sim ticks)");
  const page = await openPage(browser);
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
  const bareParam = ROUTE.bare ? "&bare=1" : "";
  const url = `${BASE}/src/mission/floor.html?hold=0&seed=${ROUTE.seed}&encounterVerdict=correct${bareParam}`;
  await page.goto(url, { waitUntil: "commit", timeout: 120000 });
  let up = false;
  for (let i = 0; i < 300; i++) {
    if ((await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null)) !== null) { up = true; break; }
    await sleep(200);
  }
  if (!up) { assert(false, "mission runtime comes up (route)", `window.__floor never appeared at ${url}`); await page.close(); return; }
  await sleep(1500); // bare has no GLBs to wait on; a short settle for the first ticks

  await page.mouse.click(640, 400).catch(() => {});
  await page.evaluate(() => window.__diag?.reset?.()).catch(() => {});

  const aim = async (wp, pos, yawOffset = 0) => {
    if (!wp) return;
    const yaw = Math.atan2(wp.x - pos.x, wp.z - pos.z) + yawOffset;
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

  // Every budget below is in SIM TICKS. armedAtTick / resolvedAtTick are read off
  // the runtime's own fixed-step clock, so "armed but unresolved for N ticks" is
  // the same soft-lock the PAST-DAWN drain is (the mission clock is ticks*FIELD_DT).
  const mandatory = new Map(); // id -> { armedAtTick, resolvedAtTick }
  let maxProgressX = -Infinity, outcome = null, softLock = null, simDead = false;
  // Stall = no net xz progress across `stallTicks` EXECUTED sim ticks while
  // free-running. Machine-independent: a slow renderer runs these ticks slower in
  // wall-clock but the body still ADVANCES per tick, so only a wedged body trips.
  const PROGRESS_EPS_M = 0.5;
  let anchorTick = null, anchorPos = null, worstStallTicks = 0;
  const clock = makeSimClock();
  const unsticker = makeUnsticker();

  for (;;) {
    const s = await page.evaluate(MISSION_READ).catch(() => null);
    if (!s) { if (clock.simDead()) { simDead = true; break; } await sleep(80); continue; }
    clock.tick(s.ticks);
    if (clock.elapsed >= ROUTE.capTicks) break;

    for (const e of s.encounters) {
      if (!mandatory.has(e.id)) mandatory.set(e.id, { armedAtTick: null, resolvedAtTick: null });
      const rec = mandatory.get(e.id);
      if (rec.armedAtTick === null && e.phase !== "DORMANT") rec.armedAtTick = clock.current;
      if (rec.resolvedAtTick === null && (e.phase === "RESOLVED" || e.phase === "RELEASED")) rec.resolvedAtTick = clock.current;
    }
    if (s.pos.x > maxProgressX) maxProgressX = s.pos.x;
    if (s.outcome) { outcome = s.outcome; break; }

    // Soft-lock watch, in SIM ticks.
    for (const [id, rec] of mandatory) {
      if (rec.armedAtTick !== null && rec.resolvedAtTick === null && clock.current - rec.armedAtTick > ROUTE.encArmTimeoutTicks) {
        softLock = { id, armedForTicks: clock.current - rec.armedAtTick };
      }
    }
    if (softLock) break;

    if (s.encView && s.encView.phase !== "RESOLVED" && s.encLocked) { await answer(); anchorTick = null; anchorPos = null; unsticker.reset(); continue; }
    if (s.beat === "ACTIVE") await page.keyboard.press("KeyF").catch(() => {});

    // Stall watch (free-running only), in EXECUTED sim ticks. Reset the anchor
    // whenever the body makes real ground; a wedged body never resets it. While
    // stalling, drive an un-stick nudge so a transient parkour hiccup recovers
    // like a player wiggling free — bounded by stallTicks (see makeUnsticker).
    let stalling = false;
    if (!s.encLocked && s.ticks != null) {
      if (anchorTick === null || !anchorPos) { anchorTick = clock.current; anchorPos = s.pos; }
      else if (Math.hypot(s.pos.x - anchorPos.x, s.pos.z - anchorPos.z) > PROGRESS_EPS_M) { anchorTick = clock.current; anchorPos = s.pos; unsticker.reset(); }
      else {
        const stalledTicks = clock.current - anchorTick;
        if (stalledTicks > worstStallTicks) worstStallTicks = stalledTicks;
        stalling = stalledTicks > UNSTICK_AFTER_TICKS;
      }
    } else { anchorTick = null; anchorPos = null; }

    const nudge = unsticker.step(clock.current, stalling);
    await aim(s.wp, s.pos, nudge.yawOffset);
    if (s.grounded && (JUMP_VERBS.includes(s.preview) || nudge.forceJump)) await page.keyboard.press("Space").catch(() => {});

    // Stop once every mandatory stop has resolved — no need to drive into the
    // skill-beat section the autonomous driver deliberately does not play.
    const allResolved = mandatory.size > 0 && [...mandatory.values()].every((r) => r.resolvedAtTick !== null);
    if (allResolved && clock.elapsed > 180) break;

    if (worstStallTicks > ROUTE.stallTicks) break; // a genuine stall is a failure, not something to wait out
    if (clock.simDead()) { simDead = true; break; }
    await sleep(80);
  }
  await page.keyboard.up("KeyW").catch(() => {});
  await page.keyboard.up("ShiftLeft").catch(() => {});

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
    `${id}{armed:${r.armedAtTick === null ? "no" : r.armedAtTick + "t"},resolved:${r.resolvedAtTick === null ? "NO" : r.resolvedAtTick + "t"}}`);
  log(`        simTicks=${clock.elapsed} (~${(clock.elapsed / TICK_HZ).toFixed(0)}s of sim) progressX=${maxProgressX.toFixed(0)} worstStall=${worstStallTicks}t unstickBursts=${unsticker.bursts} outcome=${outcome ? outcome.kind : "(stopped after stops resolved)"} penetration(invariant)=${pen.maxInv ?? "n/a"}m simDead=${simDead}`);
  log(`        encounters: ${encSummary.join("  ")}`);
  writeFileSync(join(OUT, "route.json"), JSON.stringify({ url, consumedTicks: clock.elapsed, maxProgressX, worstStallTicks, unstickBursts: unsticker.bursts, outcome, mandatory: Object.fromEntries(mandatory), pen, simDead, pageErrors }, null, 2));

  // A stuck-then-timeout outcome is a HANG, not a normal loss.
  const timedOutWhileStuck = outcome?.code === "TRAVERSAL_TIMEOUT" && (softLock || worstStallTicks > ROUTE.stallTicks);

  assert(!simDead, "the sim keeps ticking during the approach (page not hung)",
    `window.__floor.ticks did not advance for ${SIM_DEAD_WALL_S}s of REAL time — the page hung or crashed, distinct from a slow-but-live renderer; see route.json`);
  assert(mandatory.size > 0, "mandatory encounters exist on the route",
    "the run saw no authored encounters at all — the route or its stops are gone");
  for (const [id, rec] of mandatory) {
    assert(rec.armedAtTick !== null, `encounter ${id} arms`,
      `${id} never left DORMANT during the driven approach (${clock.elapsed} sim ticks) — the trigger did not fire or the section is unreachable`);
    assert(rec.resolvedAtTick !== null, `encounter ${id} resolves`,
      `${id} armed at tick ${rec.armedAtTick} but never reached RESOLVED — the beat hangs (soft-lock); the speaker never closed / the question never opened`);
  }
  assert(!softLock, "no encounter soft-lock",
    softLock ? `encounter ${softLock.id} sat armed-but-unresolved for ${softLock.armedForTicks} sim ticks (> ${ROUTE.encArmTimeoutTicks})` : "");
  assert(!timedOutWhileStuck, "no beat hang (stuck-then-timeout)",
    `the run hit TRAVERSAL_TIMEOUT while stuck (worstStall=${worstStallTicks} ticks) — the timer expired because the player was stranded, not because of a fair loss`);
  assert(worstStallTicks <= ROUTE.stallTicks, "no stall before the stops resolve",
    `the body made no ground for ${worstStallTicks} EXECUTED sim ticks (> ${ROUTE.stallTicks}) despite ${unsticker.bursts} un-stick nudge(s) — a genuinely wedged body, not a slow renderer (which advances per tick) and not a transient (which the nudges clear); see route.json`);
  assert(maxProgressX >= ROUTE.minProgressX, "route advances through the street in order",
    `the driven run only reached x=${maxProgressX.toFixed(0)} (< ${ROUTE.minProgressX}) in ${clock.elapsed} sim ticks; it never got past the Shambles/ropewalk`);
  if (pen.available) {
    assert(pen.maxInv < ROUTE.penInvariantLimitM, "no penetration during play",
      `a body was ${pen.maxInv}m inside solid hull "${pen.invId}" (invariant limit ${ROUTE.penInvariantLimitM}m) — window.__diag recorded a body inside solid geometry`);
  } else {
    notes.push("ROUTE: window.__diag penetration ring unavailable (non-dev build?) — penetration not checked");
    log("        note: window.__diag unavailable; penetration not checked");
  }
  await page.close();
}

// ---------------------------------------------------------------------------
// STAGE: YARD (reach the rope-walk yard via a drop-in on the final section).
// ---------------------------------------------------------------------------
async function stageYard(browser) {
  log("\n[YARD] a driven run reaches the rope-walk yard (bare; measured in sim ticks)");
  const page = await openPage(browser);
  const bareParam = YARD.bare ? "&bare=1" : "";
  const url = `${BASE}/src/mission/floor.html?at=${YARD.at}&toward=${YARD.toward}&encounterVerdict=correct${bareParam}`;
  await page.goto(url, { waitUntil: "commit", timeout: 120000 });
  let up = false;
  for (let i = 0; i < 250; i++) {
    if ((await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null)) !== null) { up = true; break; }
    await sleep(200);
  }
  if (!up) { assert(false, "mission runtime comes up (yard drop-in)", `window.__floor never appeared at ${url}`); await page.close(); return; }
  await sleep(1500);
  await page.mouse.click(640, 400).catch(() => {});
  await page.evaluate(() => window.__diag?.reset?.()).catch(() => {});
  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("KeyW");
  let inYard = false, last = null, simDead = false, worstStallTicks = 0;
  let anchorTick = null, anchorPos = null;
  const PROGRESS_EPS_M = 0.5;
  const clock = makeSimClock();
  const unsticker = makeUnsticker();
  const aimYard = async (wp, pos, off = 0) => {
    if (!wp) return;
    const yaw = Math.atan2(wp.x - pos.x, wp.z - pos.z) + off;
    await page.evaluate((y) => { const L = window.__look; if (L?.look) L.look.yaw = y; }, yaw).catch(() => {});
  };
  for (;;) {
    const s = await page.evaluate(MISSION_READ).catch(() => null);
    if (s) {
      clock.tick(s.ticks);
      last = s.pos;
      if (s.pos.x >= YARD.minX && s.pos.x <= YARD.maxX && s.pos.z >= YARD.minZ && s.pos.z <= YARD.maxZ) { inYard = true; break; }
      // Stall watch + un-stick in executed sim ticks (same rationale as ROUTE).
      let stalling = false;
      if (s.ticks != null) {
        if (anchorTick === null || !anchorPos) { anchorTick = clock.current; anchorPos = s.pos; }
        else if (Math.hypot(s.pos.x - anchorPos.x, s.pos.z - anchorPos.z) > PROGRESS_EPS_M) { anchorTick = clock.current; anchorPos = s.pos; unsticker.reset(); }
        else {
          const st = clock.current - anchorTick;
          if (st > worstStallTicks) worstStallTicks = st;
          stalling = st > UNSTICK_AFTER_TICKS;
        }
      }
      const nudge = unsticker.step(clock.current, stalling);
      if (nudge.yawOffset) await aimYard(s.wp, s.pos, nudge.yawOffset);
      if (s.grounded && (JUMP_VERBS.includes(s.preview) || nudge.forceJump)) await page.keyboard.press("Space").catch(() => {});
    }
    if (clock.elapsed >= YARD.capTicks) break;
    if (worstStallTicks > YARD.stallTicks) break;
    if (clock.simDead()) { simDead = true; break; }
    await sleep(80);
  }
  await page.keyboard.up("KeyW").catch(() => {});
  await page.keyboard.up("ShiftLeft").catch(() => {});
  await page.screenshot({ path: join(OUT, "yard.png") }).catch(() => {});
  log(`        final pos=${last ? `[${last.x.toFixed(0)},${last.y.toFixed(0)},${last.z.toFixed(0)}]` : "n/a"} inYard=${inYard} simTicks=${clock.elapsed} worstStall=${worstStallTicks}t simDead=${simDead}`);
  assert(!simDead, "the sim keeps ticking (yard, page not hung)",
    `window.__floor.ticks did not advance for ${SIM_DEAD_WALL_S}s of REAL time during the yard drive — the page hung, not a slow renderer`);
  assert(inYard, "reaches the rope-walk yard region",
    `driven from ${YARD.at} toward the yard, the player ended at ${last ? `x=${last.x.toFixed(0)},z=${last.z.toFixed(0)}` : "unknown"} and never entered YARD [x ${YARD.minX}..${YARD.maxX}, z ${YARD.minZ}..${YARD.maxZ}] within ${clock.elapsed} sim ticks (worstStall ${worstStallTicks}t)`);
  await page.close();
}

// ---------------------------------------------------------------------------
// STAGE: REFUSAL (a climb arms at a validated ladder; without one it refuses).
//
// This is the runtime half of the "no ladder, no climb" rule and the one check
// here that would have caught the shipped floating-ladder / climb-through class.
// It is a controlled A/B at ONE authored ladder foot, so the only difference
// between the two runs is whether the affordance exists — which is exactly what
// the refusal predicate keys on. Written against observable behaviour so it does
// not break when the engine lane edits probe.ts.
// ---------------------------------------------------------------------------
async function stageRefusal(browser) {
  log("\n[REFUSAL] a climb arms at a validated ladder, and refuses without one");

  // --- positive: the scaffold ladder is authored, so a climb MUST arm here ---
  {
    const { page, url, up } = await bootMissionAt(browser, REFUSAL.at, REFUSAL.toward, { bare: REFUSAL.bare });
    if (!up) {
      assert(false, "mission runtime comes up (refusal/ladder)", `window.__floor never appeared at ${url}`);
      await page.close();
    } else {
      const armed = await driveAndWatchClimb(page, REFUSAL.driveTicks, { breakOnClimb: true });
      await page.screenshot({ path: join(OUT, "refusal-ladder.png") }).catch(() => {});
      writeFileSync(join(OUT, "refusal-ladder.json"), JSON.stringify(armed, null, 2));
      log(`        ladder present: climbArmed=${armed.climbArmed} maxY=${armed.maxY.toFixed(2)} verbs=${JSON.stringify(armed.verbs)} simTicks=${armed.simTicks}`);
      assert(armed.climbArmed, "a validated ladder arms a climb in real play",
        `driven up the authored scaffold ladder at ${REFUSAL.at}, the body never entered CLIMB_UP (motion.phase/flow.verb/verbsUsed) within ${REFUSAL.driveTicks} sim ticks — a climb the world authors a ladder for did not arm (maxY=${armed.maxY.toFixed(2)}, verbs ${JSON.stringify(armed.verbs)}); see refusal-ladder.png`);
      await page.close();
    }
  }

  // --- negative: strip every ladder AND grip; the SAME climb volume must refuse.
  // Removing the affordances from the live collision world reconstructs "a climb
  // volume that has no ladder or grip" — the shipped world authors one for all 11,
  // so this is the only way to reach the bare-volume state the predicate guards.
  {
    const { page, url, up } = await bootMissionAt(browser, REFUSAL.at, REFUSAL.toward, { bare: REFUSAL.bare });
    if (!up) {
      assert(false, "mission runtime comes up (refusal/bare)", `window.__floor never appeared at ${url}`);
      await page.close();
    } else {
      const stripped = await page.evaluate(() => {
        const w = window.__floor?.instance?.world;
        if (!w) return { ok: false, had: null };
        const had = { ladders: (w.ladders ?? []).length, grips: (w.grips ?? []).length };
        w.ladders = [];
        w.grips = [];
        return { ok: true, had };
      });
      const bare = await driveAndWatchClimb(page, REFUSAL.driveTicks);
      await page.screenshot({ path: join(OUT, "refusal-bare.png") }).catch(() => {});
      writeFileSync(join(OUT, "refusal-bare.json"), JSON.stringify({ stripped, bare }, null, 2));
      log(`        affordance stripped (${JSON.stringify(stripped.had)}): climbSeen=${bare.climbSeen} maxY=${bare.maxY.toFixed(2)}`);
      assert(stripped.ok, "the live collision world is reachable to strip affordances",
        "window.__floor.instance.world was not present, so the refusal negative could not be set up (build without the dev runtime handle?)");
      assert(!bare.climbSeen, "no ladder and no grip means no climb (refusal holds in play)",
        `standing in the ${REFUSAL.climbSurface} climb volume with EVERY ladder and grip removed from the live world, the body was still offered or performed a climb (previewVerb/motion.phase/flow.verb/verbsUsed reported CLIMB_UP; reached y=${bare.maxY.toFixed(2)}) — the climb-refusal predicate did not fire, which is the floating-ladder / climb-through class the refusal fix exists to prevent; see refusal-bare.png`);
      await page.close();
    }
  }
}

// ---------------------------------------------------------------------------
// STAGE: BEAT (the Liberty Elm crown is reached by CLIMBING, and the beat arms).
//
// missionBeat.test.ts spawns the player on the bough and pins arming from there;
// it never proves the crown can be climbed to. This drops in on the low bough,
// climbs the authored elm grip to the crown, and asserts the posting beat arms
// from where the climb arrives — reachability, against the widened stance.
// ---------------------------------------------------------------------------
async function stageBeat(browser) {
  log("\n[BEAT] the Liberty Elm crown is reachable by climbing, and the beat arms on arrival (bare; sim ticks)");
  const { page, url, up } = await bootMissionAt(browser, BEAT.at, BEAT.toward, { bare: BEAT.bare });
  if (!up) {
    assert(false, "mission runtime comes up (elm beat)", `window.__floor never appeared at ${url}`);
    await page.close();
    return;
  }
  const spawn = await page.evaluate(CLIMB_READ);
  await page.mouse.click(640, 400).catch(() => {});

  // Phase 1: climb from the bough to the crown, then stop pushing. Budgeted in
  // SIM ticks so a slow renderer gets the same number of climb steps.
  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("KeyW");
  let sawClimb = false, maxY = -Infinity, reachedCrown = false, simDead = false;
  const climbClock = makeSimClock();
  while (climbClock.elapsed < BEAT.climbTicks) {
    const s = await page.evaluate(CLIMB_READ).catch(() => null);
    if (s) {
      climbClock.tick(s.ticks);
      if (s.pos.y > maxY) maxY = s.pos.y;
      if (s.climbing || s.climbUsed) sawClimb = true;
      if (s.pos.y >= BEAT.crownY) { reachedCrown = true; break; }
      if (s.grounded) await page.keyboard.press("Space").catch(() => {});
    }
    if (climbClock.simDead()) { simDead = true; break; }
    await sleep(100);
  }
  await page.keyboard.up("KeyW").catch(() => {});
  await page.keyboard.up("ShiftLeft").catch(() => {});

  // Phase 2: settle in the stance; the beat must arm from the arrival pose.
  let beatArmed = false, arrival = null;
  const settleClock = makeSimClock();
  while (settleClock.elapsed < BEAT.settleTicks) {
    const s = await page.evaluate(CLIMB_READ).catch(() => null);
    if (s) {
      settleClock.tick(s.ticks);
      if (!arrival) arrival = s.pos;
      if (s.beat === "ACTIVE" || s.beat === "SETTLING" || s.beat === "RESOLVED") { beatArmed = true; break; }
    }
    if (settleClock.simDead()) { simDead = true; break; }
    await sleep(120);
  }
  const end = await page.evaluate(CLIMB_READ);
  await page.screenshot({ path: join(OUT, "beat-crown.png") }).catch(() => {});
  writeFileSync(join(OUT, "beat.json"), JSON.stringify({ url, spawn: spawn?.pos, arrival, end, sawClimb, maxY, reachedCrown, beatArmed, climbTicks: climbClock.elapsed, settleTicks: settleClock.elapsed, simDead }, null, 2));
  log(`        spawn y=${spawn?.pos.y.toFixed(1)} maxY=${maxY.toFixed(2)} reachedCrown=${reachedCrown} climbed=${sawClimb} endBeat=${end?.beat} beatArmed=${beatArmed} climbTicks=${climbClock.elapsed} settleTicks=${settleClock.elapsed}`);
  assert(!simDead, "the sim keeps ticking (elm beat, page not hung)",
    `window.__floor.ticks did not advance for ${SIM_DEAD_WALL_S}s of REAL time during the elm climb — the page hung, not a slow renderer`);
  assert(sawClimb || reachedCrown, "the elm crown is reached by CLIMBING, not by spawning there",
    `driven from ${BEAT.at} toward ${BEAT.toward}, the body never entered CLIMB_UP — the crown climb the posting beat sits on did not run (maxY=${maxY.toFixed(2)}); see beat-crown.png`);
  assert(reachedCrown, "the climb reaches the crown band",
    `the body climbed but only reached y=${maxY.toFixed(2)} (< crown ${BEAT.crownY}) in ${climbClock.elapsed} sim ticks — it did not arrive at the crown where the posting beat sits; see beat-crown.png`);
  assert(beatArmed, "the posting beat arms from where the climb arrives",
    `the body climbed to the crown (y=${maxY.toFixed(2)}) but the beat never left STANCE (end phase ${end?.beat ?? "n/a"}) in ${settleClock.elapsed} settle ticks — the beat's stance (2.4 m / ±135°) is not reachable from the climb's arrival pose; see beat-crown.png`);
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

// The duel's pre-combat FACE_OFF intro counts down on the shared FIELD clock
// (machine.ts: endsAtTick = FACE_OFF_TICKS = 600), which advances via
// advanceFieldClock exactly like the mission — so on a GPU-less runner it reaches
// the question in the SAME number of sim ticks but more wall-clock (measured: the
// FACE_OFF→QUESTION_PENDING transition took ~10 s on a GPU and ~48 s under
// software WebGL + a CPU throttle, while combat.tick stayed 0 the whole time).
// That is why the old fixed 36 s wall-clock wait for the question is the duel's
// share of the same flake — a slow runner never reaches QUESTION_PENDING inside
// it — and why this waits on clock.tick, NOT combat.tick (which is 0 until combat
// starts). QUESTION_PENDING then FREEZES the clock (machine.ts: ADVANCE is a
// no-op there), so the moment it opens this returns and never watches a frozen clock.
const DUEL_READ = () => {
  const d = window.__duel;
  if (!d) return null;
  let tick = null;
  try { tick = d.getState().clock.tick; } catch { /* not mounted yet */ }
  return { phase: d.getHud().phase, tick };
};
const DUEL_QUESTION_BUDGET_TICKS = 1800; // ~30 s of sim; FACE_OFF is 600 — a generous ceiling

// Wait for the answerable QUESTION_PENDING panel, budgeted in duel SIM TICKS.
async function waitForDuelQuestion(page) {
  const clock = makeSimClock();
  for (;;) {
    const s = await page.evaluate(DUEL_READ).catch(() => null);
    if (s) {
      clock.tick(s.tick);
      if (s.phase === "QUESTION_PENDING" && (await page.$("textarea.duel-answer"))) {
        return { sawQ: true, simTicks: clock.elapsed, simDead: false };
      }
    }
    if (clock.elapsed >= DUEL_QUESTION_BUDGET_TICKS) return { sawQ: false, simTicks: clock.elapsed, simDead: false };
    if (clock.simDead()) return { sawQ: false, simTicks: clock.elapsed, simDead: true };
    await sleep(200);
  }
}

// Fill the answer, select evidence cards until Submit enables, and click. Returns
// { submitted, simTicks, simDead } — the round it triggers is what must reach the
// server's grading pipeline.
async function submitLiveAnswer(page) {
  const q = await waitForDuelQuestion(page);
  if (!q.sawQ) return { submitted: false, ...q };
  await page.fill("textarea.duel-answer", "Parliament resolved the colonies should help pay the war debt through the stamp.").catch(() => {});
  const cards = await page.$$("button.ev-mini-face");
  for (let i = 0; i < cards.length && i < 4; i++) {
    await cards[i].click().catch(() => {});
    await sleep(180);
    if (!(await page.$eval("button.duel-submit", (b) => b.disabled).catch(() => true))) break;
  }
  if (await page.$eval("button.duel-submit", (b) => b.disabled).catch(() => true)) return { submitted: false, ...q };
  await page.click("button.duel-submit").catch(() => {});
  return { submitted: true, ...q };
}

async function stageDuel(browser) {
  // --- world loads (verdict=live must not be an empty void) ---
  log("\n[DUEL] the harness loads a world (verdict=live)");
  {
    const page = await openPage(browser);
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

      // --- the grader RAN on the real duel path (not a client-minted verdict) ---
      // "Grading never ran in play" was a WIRING failure — the classifier not
      // invoked on the real duel path — and it disguised itself as a client-minted
      // fallback verdict, so asserting "a verdict appeared" catches nothing. Submit
      // a real answer on this live attempt and require the API's OWN grading window
      // to advance: the round/gradeable counters move only when the server grading
      // pipeline processes the round, whereas a client mint the server never saw
      // leaves them flat. classifiedInWindow deliberately is NOT asserted — with no
      // classifier credential (the CI shape, status UNGRADED) the model is out of
      // reach and cannot classify, so requiring it would need a live model call:
      // a flaky external dependency this gate must not take on. The gradeable-round
      // delta is the honest, deterministic proof that the real path ran.
      log("\n[DUEL] the grader ran on the real duel path (live submit moves /v1/health)");
      const before = await fetchGrading();
      const sub = await submitLiveAnswer(page);
      const submitted = sub.submitted;
      log(`        question reached in ${sub.simTicks} duel ticks${sub.simDead ? " (SIM DEAD — page hung)" : ""}`);
      let after = before;
      if (submitted && before) {
        // A SERVER-side wait (not a sim race): the answer POST must reach the API
        // and the grading window must record it. Generous but bounded; polls until
        // it advances, then stops.
        for (let i = 0; i < 75; i++) {
          const h = await fetchGrading();
          if (h && h.roundsInWindow > before.roundsInWindow) { after = h; break; }
          await sleep(200);
        }
      }
      const dRounds = before && after ? after.roundsInWindow - before.roundsInWindow : null;
      const dGradeable = before && after ? after.gradeableInWindow - before.gradeableInWindow : null;
      const dClassified = before && after ? after.classifiedInWindow - before.classifiedInWindow : null;
      writeFileSync(join(OUT, "duel-grader.json"), JSON.stringify({ before, after, submitted, dRounds, dGradeable, dClassified }, null, 2));
      log(`        live submit=${submitted} rounds ${before?.roundsInWindow}→${after?.roundsInWindow} gradeable ${before?.gradeableInWindow}→${after?.gradeableInWindow} classified ${before?.classifiedInWindow}→${after?.classifiedInWindow} (status ${after?.status})`);
      assert(before !== null && after !== null, "the API grading counters are readable",
        `GET ${BASE}/v1/health returned no grading snapshot — cannot prove the grader ran on the real path (is the API up and exposing /v1/health.grading?)`);
      assert(submitted, "the live duel accepts a real answer on the real attempt",
        `verdict=live never reached a submittable QUESTION_PENDING panel within ${sub.simTicks} duel ticks${sub.simDead ? " (the page hung — clock stopped ticking)" : ` (FACE_OFF is 600 ticks; budget ${DUEL_QUESTION_BUDGET_TICKS})`}, so the grader could not be exercised on the real path.${originMismatchHint(denials)}`);
      assert(dGradeable !== null && dGradeable > 0 && dRounds !== null && dRounds > 0,
        "the grader ran on the real duel path (server recorded a gradeable round)",
        `a live answer was submitted but the API's grading window did not advance (roundsInWindow Δ=${dRounds}, gradeableInWindow Δ=${dGradeable}) — the verdict reached the player WITHOUT the server grading pipeline running, which is exactly how "grading never ran in play" hid last time (a client-minted fallback the server never saw); see duel-grader.json`);
      if (after && before && dClassified === 0) {
        notes.push(`DUEL grader: classifiedInWindow did not move (${after.classifiedInWindow}) — expected with no classifier credential (grading OFF, status ${after.status}). The gradeable-round delta (${dGradeable}) proves the round reached the server pipeline and fell back to the max grant; a real model classification would need a live credential and is deliberately not asserted (it would be flaky).`);
      }
    }
    await page.close();
  }

  // --- grading discriminates (scripted correct vs wrong, no classifier needed) ---
  log("\n[DUEL] a graded answer discriminates right from wrong");
  const magazineAfterAnswer = async (mode) => {
    const page = await openPage(browser);
    const url = `${BASE}/src/duel/duel.html?verdict=${mode}`;
    await page.goto(url, { waitUntil: "commit", timeout: 120000 });
    for (let i = 0; i < 250; i++) { if (await page.evaluate(() => !!window.__duel).catch(() => false)) break; await sleep(200); }
    const readHud = () => page.evaluate(() => { const d = window.__duel; if (!d) return null; const h = d.getHud(); return { phase: h.phase, magA: h.magazine.A, magB: h.magazine.B }; }).catch(() => null);
    // Same tick-relative wait as the live grader: FACE_OFF counts down on the
    // field clock, so a slow renderer reaches the question in the same sim ticks.
    const q = await waitForDuelQuestion(page);
    let result = { sawQ: q.sawQ, magA: null };
    if (q.sawQ) {
      await page.fill("textarea.duel-answer", "Parliament resolved the colonies should help pay the war debt through the stamp.").catch(() => {});
      const cards = await page.$$("button.ev-mini-face");
      for (let i = 0; i < cards.length && i < 4; i++) {
        await cards[i].click().catch(() => {});
        await sleep(180);
        if (!(await page.$eval("button.duel-submit", (b) => b.disabled).catch(() => true))) break;
      }
      if (!(await page.$eval("button.duel-submit", (b) => b.disabled).catch(() => true))) {
        await page.click("button.duel-submit").catch(() => {});
        // The grant follows the answer within a bounded number of duel ticks; wait
        // in sim ticks, not wall-clock, for BULLETS_GRANTED / a filled magazine.
        const grantClock = makeSimClock();
        for (;;) {
          const h = await readHud();
          if (h && (h.phase === "BULLETS_GRANTED" || h.magA > 0)) { result.magA = h.magA; break; }
          const d = await page.evaluate(DUEL_READ).catch(() => null);
          grantClock.tick(d?.tick);
          if (grantClock.elapsed >= 1200 || grantClock.simDead()) break;
          await sleep(200);
        }
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
    if (wants("refusal")) await stageRefusal(browser);
    if (wants("beat")) await stageBeat(browser);
    if (wants("duel")) await stageDuel(browser);
  } finally {
    await browser.close();
  }

  log("\n==================== PLAYTHROUGH ====================");
  for (const n of notes) log(`  note: ${n}`);
  if (failures.length === 0) {
    log(`ALL PASS — the mission renders, the route advances, every stop resolves, a climb refuses without a ladder and arms with one, the elm crown is reachable and its beat arms, and the duel loads a graded world whose grader runs on the real path.`);
    process.exit(0);
  }
  log(`${failures.length} CHECK(S) FAILED:`);
  for (const f of failures) log(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}

await main();
