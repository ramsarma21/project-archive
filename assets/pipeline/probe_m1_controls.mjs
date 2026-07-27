// Control-rig probe for M1: mouse look, the bound keys, and frame pacing.
//
// The owner's playtest report mixed two classes of problem — real defects, and
// artifacts of a machine under a load average of 38 on ten cores — and feel is
// not able to tell them apart from inside. So this measures instead:
//
//   look    Does mouse travel actually turn the player, through the real
//           pointer-lock path, and is the turn proportional to the travel?
//   keys    Does each bound key reach the simulation and change the state it
//           claims to change? Read off `__floor`, not off pixels.
//   frames  Frame time distribution, and whether the camera is frame-rate
//           independent: the same gesture at 60Hz and at a throttled rate must
//           leave the look in the same place, or the jank is real code.
//
// Run: node assets/pipeline/probe_m1_controls.mjs [baseUrl] [outDir]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadavg, cpus } from "node:os";

const base = process.argv[2] ?? "http://localhost:5173";
const outDir = process.argv[3] ?? "/tmp/m1controls";
mkdirSync(outDir, { recursive: true });

const lines = [];
function say(text) {
  lines.push(text);
  console.log(text);
}

function load() {
  const [one] = loadavg();
  return `load ${one.toFixed(2)} on ${cpus().length} cores`;
}

// The bare harness: no level art. The collision world, the route and the field
// are authored data rather than read off the GLBs, so movement and camera are
// identical — this only removes a half-generated asset library from the frame,
// which is the difference between measuring the controls and measuring the
// art pipeline's current state.
const URL_BARE = `${base}/src/mission/floor.html?bare=1&at=C_SQUARE_W&toward=C_SCAFF_FOOT`;

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--enable-unsafe-swiftshader", "--disable-lcd-text"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("console", (message) => {
  const text = message.text();
  if (/error|warn|missing|no "/i.test(text)) say(`  [console] ${text}`);
});

say(`# M1 control probe — ${new Date().toISOString()}`);
say(`# ${load()}`);
say("");

await page.goto(URL_BARE, { waitUntil: "load" });
// The stage mounts a canvas and the runtime publishes itself on window; wait
// for the handle rather than a fixed sleep, which on a saturated machine is
// either far too short or a guess that wastes a minute.
await page.waitForFunction(() => window.__floor && window.__look, null, {
  timeout: 60000,
});
await page.waitForTimeout(1500);

const canvas = await page.locator("canvas").first();
const box = await canvas.boundingBox();
const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

// ---------------------------------------------------------------------------
// 1. Mouse look
// ---------------------------------------------------------------------------
say("## look");

const yaw0 = await page.evaluate(() => window.__look.look.yaw);

// Drag-look first: it is the fallback that does not need the browser to grant
// anything, so a failure here is unambiguous.
await page.mouse.move(centre.x, centre.y);
await page.mouse.down();
for (let step = 0; step < 10; step += 1) {
  await page.mouse.move(centre.x + (step + 1) * 20, centre.y);
  await page.waitForTimeout(16);
}
await page.mouse.up();
await page.waitForTimeout(200);

const yawDrag = await page.evaluate(() => window.__look.look.yaw);
const dragDelta = yawDrag - yaw0;
say(`drag 200px right -> yaw ${yaw0.toFixed(4)} to ${yawDrag.toFixed(4)} (${(dragDelta * 180 / Math.PI).toFixed(2)} deg)`);

// Pitch, and that it clamps rather than rolling over.
const pitch0 = await page.evaluate(() => window.__look.look.pitch);
await page.mouse.move(centre.x, centre.y);
await page.mouse.down();
for (let step = 0; step < 10; step += 1) {
  await page.mouse.move(centre.x, centre.y + (step + 1) * 20);
  await page.waitForTimeout(16);
}
await page.mouse.up();
await page.waitForTimeout(200);
const pitchDown = await page.evaluate(() => window.__look.look.pitch);
say(`drag 200px down -> pitch ${pitch0.toFixed(4)} to ${pitchDown.toFixed(4)}`);

// Does the CAMERA actually follow the look? The look moving while the camera
// does not is the same failure to a player as the look not moving.
const camera = await page.evaluate(() => {
  const state = window.__floor;
  return { yaw: window.__look.look.yaw, pos: { ...state.motion.pos } };
});
say(`player at (${camera.pos.x.toFixed(2)}, ${camera.pos.y.toFixed(2)}, ${camera.pos.z.toFixed(2)})`);

// Pointer lock, the real path. Requested by a click on the canvas.
await page.mouse.click(centre.x, centre.y);
await page.waitForTimeout(400);
const locked = await page.evaluate(() => ({
  locked: window.__look.pointerLocked,
  element: document.pointerLockElement?.tagName ?? null,
}));
say(`pointer lock granted: ${locked.locked} (element ${locked.element})`);

if (locked.locked) {
  const before = await page.evaluate(() => window.__look.look.yaw);
  for (let step = 0; step < 10; step += 1) {
    await page.mouse.move(centre.x + step * 15, centre.y);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => window.__look.look.yaw);
  say(`locked mouse travel -> yaw ${before.toFixed(4)} to ${after.toFixed(4)} (${((after - before) * 180 / Math.PI).toFixed(2)} deg)`);
  await page.evaluate(() => document.exitPointerLock?.());
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------------------
// 2. The precession regression, measured live
//
// The reported bug: hold one strafe key and the frame turns without bound. The
// look must not move at all while a movement key is held, because nothing
// downstream of it is allowed to write it.
// ---------------------------------------------------------------------------
say("");
say("## strafe precession");

const strafeStart = await page.evaluate(() => ({
  look: window.__look.look.yaw,
  body: window.__floor.motion.yaw,
}));
await page.keyboard.down("KeyD");
await page.keyboard.down("ShiftLeft");
await page.waitForTimeout(3600);
const strafeEnd = await page.evaluate(() => ({
  look: window.__look.look.yaw,
  body: window.__floor.motion.yaw,
}));
await page.keyboard.up("KeyD");
await page.keyboard.up("ShiftLeft");
await page.waitForTimeout(200);

const lookDrift = Math.abs(strafeEnd.look - strafeStart.look) * 180 / Math.PI;
say(`3.6s of held strafe: look moved ${lookDrift.toFixed(3)} deg (was 442 deg)`);
say(`  body yaw ${(strafeStart.body * 180 / Math.PI).toFixed(1)} -> ${(strafeEnd.body * 180 / Math.PI).toFixed(1)} deg (turning to face travel is expected and cosmetic)`);

// ---------------------------------------------------------------------------
// 3. Every bound key, and what it changed
// ---------------------------------------------------------------------------
say("");
say("## keys");

async function probeKey(code, label, read) {
  const before = await page.evaluate(read);
  await page.keyboard.press(code);
  await page.waitForTimeout(500);
  const after = await page.evaluate(read);
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  say(`${code.padEnd(10)} ${label.padEnd(28)} ${changed ? "CHANGED" : "no change"}  ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  return changed;
}

const readThrow = () => ({
  charges: window.__floor.stealth.diversions.charges,
  live: window.__floor.stealth.diversions.live.length,
  thrown: window.__floor.stealth.diversions.thrown,
});
const readBeat = () => ({
  beat: window.__floor.beat ? window.__floor.beat.phase : null,
  strokes: window.__floor.beat ? window.__floor.beat.strokes?.length ?? null : null,
  inStance: window.__floor.instance.beat
    ? Math.hypot(
        window.__floor.motion.pos.x - window.__floor.instance.beat.spec.stance.x,
        window.__floor.motion.pos.z - window.__floor.instance.beat.spec.stance.z,
      ) <= window.__floor.instance.beat.spec.stanceRadiusM
    : false,
});
const readDash = () => ({
  phase: window.__floor.motion.phase,
  cooldown: window.__floor.flow.dashCooldownTicks,
});

const keyChanges = {
  KeyQ: await probeKey("KeyQ", "throw a diversion", readThrow),
  KeyF: await probeKey("KeyF", "strike (beat)", readBeat),
  KeyE: await probeKey("KeyE", "dash", readDash),
  Space: await probeKey("Space", "jump", () => ({ phase: window.__floor.motion.phase })),
};

// ---------------------------------------------------------------------------
// 4. Frame pacing, and frame-rate independence
// ---------------------------------------------------------------------------
say("");
say("## frames");

const frames = await page.evaluate(async () => {
  const samples = [];
  let last = performance.now();
  await new Promise((resolve) => {
    let count = 0;
    function tick(now) {
      samples.push(now - last);
      last = now;
      count += 1;
      if (count >= 180) resolve();
      else requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
  return samples.slice(1);
});
frames.sort((a, b) => a - b);
const median = frames[Math.floor(frames.length / 2)];
const p95 = frames[Math.floor(frames.length * 0.95)];
say(`frame time: median ${median.toFixed(1)}ms, p95 ${p95.toFixed(1)}ms, max ${frames[frames.length - 1].toFixed(1)}ms over ${frames.length} frames`);
say(`  ${load()}`);
say(`  dropped fixed steps so far: ${await page.evaluate(() => window.__floor.droppedSteps)}`);

// The property that decides whether jank is code or machine: the same mouse
// gesture, at a normal frame rate and at a throttled one, must leave the look
// in the same place. A dt anywhere in the look path shows up here as a
// difference, and nowhere else as anything but "feels wrong".
async function gestureYaw(cpuRate) {
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
  await page.evaluate(() => {
    window.__look.look.yaw = 0;
    window.__look.look.pitch = 0.265;
  });
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  for (let step = 0; step < 20; step += 1) {
    await page.mouse.move(centre.x + (step + 1) * 10, centre.y);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
  const yaw = await page.evaluate(() => window.__look.look.yaw);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await client.detach();
  return yaw;
}

const fast = await gestureYaw(1);
const slow = await gestureYaw(6);
say(`same 200px gesture: 1x cpu -> ${(fast * 180 / Math.PI).toFixed(3)} deg, 6x throttled -> ${(slow * 180 / Math.PI).toFixed(3)} deg`);
say(`  difference ${(Math.abs(fast - slow) * 180 / Math.PI).toFixed(4)} deg (nonzero means a dt is in the look path)`);

await page.screenshot({ path: `${outDir}/controls.png` });

// ---------------------------------------------------------------------------
// Verdict. Three defined thresholds decide whether the control rig is doing its
// job, and until now this probe printed them and exited 0 whatever they said —
// so the precession regression, if it came back, would have been a line of text
// in a file nobody re-reads rather than a red run.
//
//   look responds   a 200px drag right must turn the view. A dead look reads as
//                   ~0 deg here; a working one is tens of degrees.
//   no precession   the look MUST NOT move while a movement key is held (the
//                   reported bug turned the frame 442 deg over 3.6s). Anything
//                   over a couple of degrees of drift is that code returning.
//   keys reach sim  at least one bound key must change the state it claims to.
//                   All four doing nothing means keyboard input is not reaching
//                   the simulation at all, whatever the per-key state happens to
//                   be. (Individual keys are state-dependent — a strike needs a
//                   stance — so the floor is "input arrives", not "each key".)
// ---------------------------------------------------------------------------
const LOOK_RESPONSE_MIN_DEG = 1.0;
const PRECESSION_MAX_DEG = 2.0;
const dragDeltaDeg = Math.abs(dragDelta * 180 / Math.PI);
const anyKeyReached = Object.values(keyChanges).some(Boolean);

const failures = [];
if (dragDeltaDeg < LOOK_RESPONSE_MIN_DEG) {
  failures.push(`look did not respond to a 200px drag (${dragDeltaDeg.toFixed(3)} deg turned)`);
}
if (lookDrift > PRECESSION_MAX_DEG) {
  failures.push(
    `strafe precession: the look moved ${lookDrift.toFixed(3)} deg while a key was held ` +
      `(threshold ${PRECESSION_MAX_DEG} deg; the reported regression was 442 deg)`,
  );
}
if (!anyKeyReached) {
  failures.push(
    `no bound key changed any simulation state (${Object.keys(keyChanges).join(", ")}); ` +
      "keyboard input is not reaching the sim",
  );
}

say("");
if (failures.length > 0) {
  say(`## VERDICT: FAIL (${failures.length})`);
  for (const problem of failures) say(`  - ${problem}`);
} else {
  say("## VERDICT: OK (look responds, no strafe precession, keyboard reaches the sim)");
}

writeFileSync(`${outDir}/controls.txt`, lines.join("\n"));
say(`wrote ${outDir}/controls.txt and controls.png`);

await browser.close();
process.exit(failures.length === 0 ? 0 : 1);
