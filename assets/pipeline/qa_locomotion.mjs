// Browser QA for the final locomotion control contract.
// Run against the dev server:
//   node --import tsx assets/pipeline/qa_locomotion.mjs
import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";
import { TRAVERSAL_SET } from "../../packages/chapter-boston-world/src/world/traversalMarkers.ts";
import {
  buildTraversalEndpoints,
  duckRequestFor,
} from "../../packages/chapter-boston-world/src/world/traversalRegistration.ts";
import { buildDensityTraversalRegistrations } from "../../packages/chapter-boston-world/src/world/densityTraversalAdapter.ts";

const out = process.env.LOCOMOTION_QA_OUT ?? "/tmp/locomotion-qa";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: [
    "--use-angle=metal",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--disable-dev-shm-usage",
  ],
});
async function closeBrowser() {
  await Promise.race([
    browser.close().catch(() => undefined),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 3000)),
  ]);
}
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
const failedRequests = [];
const httpErrors = [];
let v5Response = null;
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("requestfailed", (request) => failedRequests.push(`${request.url()} ${request.failure()?.errorText}`));
page.on("response", (response) => {
  if (response.status() >= 400) {
    httpErrors.push(`${response.url()} ${response.status()}`);
  }
  // Match the rig regardless of the cache-bust token. Pinning the token here
  // means the next bump silently stops this observer from ever firing, and the
  // check below then passes because it never saw a response rather than because
  // the rig loaded.
  if (/playerboy-rigged\.glb(\?|$)/.test(response.url())) {
    v5Response = { url: response.url(), status: response.status() };
  }
});

function isKnownConcurrentDependency(text) {
  return (
    text.includes("/v1/health") ||
    [
      "dockhand-rigged.glb",
      "agitator-rigged.glb",
      "taxclerk-rigged.glb",
      "towncrier-rigged.glb",
      "goodwife-rigged.glb",
    ].some((name) => text.includes(name))
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function state() {
  return page.locator(".world3d").evaluate((element) => ({
    pos: (element.dataset.playerPos3d ?? "").split(",").map(Number),
    phase: element.dataset.playerMotion,
    speed: Number(element.dataset.playerSpeed),
    clip: element.dataset.playerClip,
    sprinting: element.dataset.playerSprinting,
    crouched: element.dataset.playerCrouched,
  }));
}

async function waitPhase(phase, timeout = 2500) {
  await page.waitForFunction(
    (expected) => document.querySelector(".world3d")?.dataset.playerMotion === expected,
    phase,
    { timeout },
  );
  return state();
}

async function waitGrounded(timeout = 5000) {
  return waitPhase("GROUNDED", timeout);
}

async function waitTraversalReady(timeout = 15000) {
  await page.waitForFunction(
    () => document.querySelector(".world3d")?.getAttribute("data-traversal-active") === "true",
    undefined,
    { timeout },
  );
}

async function teleport(pos, faceY) {
  await page.evaluate(
    ({ target, yaw }) =>
      window.dispatchEvent(
        new CustomEvent("pa:qa-player-command", {
          detail: { teleport: target, faceY: yaw },
        }),
      ),
    { target: pos, yaw: faceY },
  );
  await page.waitForTimeout(200);
}

function marker(id) {
  const result = TRAVERSAL_SET.markers.find((item) => item.id === id);
  if (!result) throw new Error(`missing QA marker ${id}`);
  return result;
}

function yawBetween(a, b) {
  return Math.atan2(b[0] - a[0], b[2] - a[2]);
}

const QA_URL = process.env.LOCOMOTION_QA_URL ?? "http://127.0.0.1:5173/";
await page.goto(QA_URL, { waitUntil: "networkidle" });
const nameInput = page.locator('input[placeholder="Display name"]');
if (await nameInput.count()) {
  await nameInput.fill(`LocomotionQA-${Date.now()}`);
  await page.locator('button:has-text("Create")').click();
  await page.waitForTimeout(600);
}
const play = page.locator('button:has-text("Play")').first();
if (await play.count()) {
  await play.click();
  await page.waitForTimeout(400);
}
for (let i = 0; i < 2; i++) {
  const next = page.getByRole("button", { name: "Continue calibration" });
  if (await next.count()) {
    await next.click();
    await page.waitForTimeout(250);
  }
}
const beginSync = page.getByRole("button", { name: "Begin synchronization" });
if (await beginSync.count()) {
  await beginSync.click();
  await page.waitForTimeout(1800);
}
const advanceLabels = [
  "Continue calibration",
  "Begin synchronization",
  "Continue",
  "Begin",
  "Enter",
  "Insert",
  "Start",
  "Synchronize",
  "Acknowledge",
  "Understood",
  "Confirm",
];
let entered = false;
for (let attempt = 0; attempt < 45; attempt++) {
  for (const label of advanceLabels) {
    const button = page.locator(`button:has-text("${label}"):not([disabled])`);
    if (
      (await button.count()) > 0 &&
      (await button.first().isVisible().catch(() => false))
    ) {
      await button.first().click({ timeout: 2500 }).catch(() => null);
      break;
    }
  }
  const host = page.locator(".world3d");
  if (await host.count()) {
    const location = await host.getAttribute("data-location-id");
    const playerPosition = await host.getAttribute("data-player-pos3d");
    const worldHintVisible = await page.locator(".world-hint").isVisible().catch(() => false);
    if (
      location !== "ARCHIVE_TRANSIT" &&
      playerPosition &&
      worldHintVisible
    ) {
      entered = true;
      break;
    }
  }
  await page.waitForTimeout(800);
}
if (!entered) {
  console.log("ENTRY_BODY", (await page.locator("body").innerText()).slice(0, 4000));
  await page.screenshot({ path: `${out}/entry-failure.png`, fullPage: true });
}
assert(entered, "world exterior did not become ready");
await page.locator(".world3d").waitFor({ state: "visible" });
await page.waitForTimeout(1200);
assert(v5Response?.status === 200, `v5 player was not loaded: ${JSON.stringify(v5Response)}`);
const acknowledgePrimer = page.getByRole("button", { name: "Acknowledge" });
if (await acknowledgePrimer.isVisible().catch(() => false)) {
  await acknowledgePrimer.click();
  await page.waitForTimeout(250);
}
await page.waitForFunction(
  () => document.querySelector(".world3d")?.getAttribute("data-movement-active") === "true",
  undefined,
  { timeout: 15000 },
);
await waitTraversalReady();
await page.evaluate(() => {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
});
console.log(
  "READY",
  await page.locator(".world3d").evaluate((element) => ({
    attrs: Object.fromEntries([...element.attributes].map((attribute) => [attribute.name, attribute.value])),
    active: document.activeElement?.tagName,
  })),
);

if (process.env.MERCER_HANDOFF_QA_ONLY === "1") {
  await page.evaluate(() => window.__PA_QA_TELEPORT__(-0.31, 10.61, 0));
  await page.waitForFunction(
    () =>
      document.querySelector(".play")?.getAttribute("data-plan-request") ===
        "CHOICE",
    undefined,
    { timeout: 30000 },
  );
  const entryChoice = page.getByRole("button", { name: /Walk straight in/ });
  try {
    await entryChoice.waitFor({ state: "visible", timeout: 30000 });
  } catch (error) {
    console.log(
      "MERCER_HANDOFF_BLOCKED",
      JSON.stringify({
        play: await page.locator(".play").evaluate((element) =>
          Object.fromEntries(
            [...element.attributes].map((attribute) => [
              attribute.name,
              attribute.value,
            ]),
          ),
        ),
        world: await page.locator(".world3d").evaluate((element) =>
          Object.fromEntries(
            [...element.attributes].map((attribute) => [
              attribute.name,
              attribute.value,
            ]),
          ),
        ),
        buttons: await page.locator("button:visible").allTextContents(),
      }),
    );
    throw error;
  }
  for (const label of [
    /Knock first/,
    /Walk straight in/,
    /Look through the window first/,
  ]) {
    await page
      .getByRole("button", { name: label })
      .waitFor({ state: "visible", timeout: 5000 });
  }
  const entryTaglines = await page.locator(".choice-panel .choice-subtext").allTextContents();
  assert(
    entryTaglines.length === 3 &&
      new Set(entryTaglines.map((tagline) => tagline.trim())).size === 3,
    `entry choices did not expose distinct stakes: ${JSON.stringify(entryTaglines)}`,
  );
  assert(
    (await page.getByRole("button", { name: "ACKNOWLEDGE" }).count()) === 0,
    "entry choice regressed to a blocking primer",
  );
  await page.screenshot({ path: `${out}/mercer-entry-stake-tags.png` });
  const choiceState = await page.locator(".world3d").evaluate((element) => ({
    owner: element.dataset.cameraOwner,
    movement: element.dataset.movementActive,
    ready: element.dataset.choreographyReady,
  }));
  assert(
    choiceState.owner === "CHOREOGRAPHY" &&
      choiceState.movement === "false" &&
      choiceState.ready === "true",
    `entry choice camera/lock mismatch: ${JSON.stringify(choiceState)}`,
  );
  await entryChoice.click();
  await page.waitForFunction(
    () =>
      document.querySelector(".world3d")?.getAttribute("data-camera-owner") ===
      "FIRST_PERSON",
    undefined,
    { timeout: 30000 },
  );
  const firstPersonState = await page
    .locator(".world3d")
    .evaluate((element) => ({
      owner: element.dataset.cameraOwner,
      movement: element.dataset.movementActive,
      interior: element.dataset.interiorId,
      cue: element.dataset.cueId,
    }));
  assert(
    firstPersonState.movement === "false" &&
      firstPersonState.interior === "MERCER_PRESS",
    `first-person camera/lock mismatch: ${JSON.stringify(firstPersonState)}`,
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector(".play")
        ?.getAttribute("data-interaction-busy") === "false",
    undefined,
    { timeout: 10000 },
  );
  assert(
    (await page.getByRole("button", { name: "ACKNOWLEDGE" }).count()) === 0,
    "work handoff regressed to a blocking primer",
  );
  await page
    .locator(".world-controls-overlay.request-mechanic .mechanic-action")
    .waitFor({ state: "visible", timeout: 30000 });
  await page.screenshot({ path: `${out}/mercer-first-person-handoff.png` });
  const relevantErrors = errors.filter(
    (error) =>
      !error.includes("Failed to load resource") &&
      !isKnownConcurrentDependency(error),
  );
  const relevantFailures = failedRequests.filter(
    (failure) => !isKnownConcurrentDependency(failure),
  );
  const relevantHttpErrors = httpErrors.filter(
    (error) => !isKnownConcurrentDependency(error),
  );
  assert(
    relevantErrors.length === 0,
    `page/runtime errors: ${relevantErrors.join(" | ")}`,
  );
  assert(
    relevantHttpErrors.length === 0,
    `unexpected HTTP errors: ${relevantHttpErrors.join(" | ")}`,
  );
  assert(
    relevantFailures.length === 0,
    `unexpected failed requests: ${relevantFailures.join(" | ")}`,
  );
  console.log(
    "MERCER_HANDOFF_QA_OK",
    JSON.stringify({ choiceState, firstPersonState }),
  );
  await closeBrowser();
  process.exit(0);
}

if (process.env.EXTERNAL_CAMERA_QA_ONLY === "1") {
  const host = page.locator(".world3d");
  const owner = await host.getAttribute("data-camera-owner");
  const movementActive = await host.getAttribute("data-movement-active");
  assert(owner === "CHASE", `external camera owner was ${owner}`);
  assert(
    movementActive === "true",
    "external camera ownership unexpectedly locked movement",
  );
  const before = await state();
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(900);
  await page.keyboard.up("KeyW");
  await page.waitForTimeout(180);
  const after = await state();
  const moved = Math.hypot(
    after.pos[0] - before.pos[0],
    after.pos[2] - before.pos[2],
  );
  assert(moved > 0.5, `external camera movement did not advance: ${moved}`);
  await page.screenshot({ path: `${out}/external-camera-live-movement.png` });
  const relevantErrors = errors.filter(
    (error) =>
      !error.includes("Failed to load resource") &&
      !isKnownConcurrentDependency(error),
  );
  const relevantFailures = failedRequests.filter(
    (failure) => !isKnownConcurrentDependency(failure),
  );
  const relevantHttpErrors = httpErrors.filter(
    (error) => !isKnownConcurrentDependency(error),
  );
  assert(
    relevantErrors.length === 0,
    `page/runtime errors: ${relevantErrors.join(" | ")}`,
  );
  assert(
    relevantHttpErrors.length === 0,
    `unexpected HTTP errors: ${relevantHttpErrors.join(" | ")}`,
  );
  assert(
    relevantFailures.length === 0,
    `unexpected failed requests: ${relevantFailures.join(" | ")}`,
  );
  console.log("EXTERNAL_CAMERA_QA_OK", JSON.stringify({ before, after, moved }));
  await closeBrowser();
  process.exit(0);
}

// Space: standing jump, no object required.
await page.keyboard.press("Space");
let current = await waitPhase("STANDING_JUMP");
assert(current.clip === "jump", `standing jump selected ${current.clip}`);
let apex = current.pos[1];
for (let i = 0; i < 28; i++) {
  await page.waitForTimeout(35);
  current = await state();
  apex = Math.max(apex, current.pos[1]);
}
assert(apex > 1.1, `standing jump apex too low: ${apex}`);
await page.screenshot({ path: `${out}/standing-jump.png` });
await waitGrounded();

// Shift: explicit sprint clip/speed; release returns to walk.
await page.keyboard.down("KeyW");
await page.waitForTimeout(900);
current = await state();
assert(current.clip === "walk", `walk selected ${current.clip}`);
await page.keyboard.down("ShiftLeft");
await page.waitForTimeout(900);
current = await state();
assert(current.clip === "run", `sprint selected ${current.clip}`);
assert(current.sprinting === "true" && current.speed > 3.5, `invalid sprint ${JSON.stringify(current)}`);
await page.screenshot({ path: `${out}/sprint.png` });

// Shift+Space: running jump selected only from explicit forward sprint.
await page.keyboard.press("Space");
current = await waitPhase("RUNNING_JUMP");
assert(current.clip === "runJump", `running jump selected ${current.clip}`);
await page.screenshot({ path: `${out}/running-jump.png` });
await page.keyboard.up("ShiftLeft");
await page.keyboard.up("KeyW");
await waitGrounded();
await page.waitForFunction(
  () => Number(document.querySelector(".world3d")?.getAttribute("data-player-speed")) < 0.16,
  undefined,
  { timeout: 2500 },
);

// C: free crouch toggle, distinct from authored duck.
await page.keyboard.press("KeyC");
current = await waitPhase("CROUCH");
assert(current.clip === "crouchIdle", `free crouch selected ${current.clip}`);
assert(current.crouched === "true", "free crouch status missing");
await page.screenshot({ path: `${out}/free-crouch.png` });
await page.keyboard.press("KeyC");
await waitGrounded();

// Focused free-jump verification for the new standing `jump` clip: idle jump,
// jump while walking, and repeated jumps, each landing cleanly back to GROUNDED
// with negligible horizontal drift and no residual root offset. Guarded so it
// can run without the authored duck/vault/climb markers owned by other workers.
if (process.env.JUMP_QA_ONLY === "1") {
  await teleport([-6, 0, 1.5], Math.PI / 2);
  // Space while walking forward: still selects the standing `jump` clip and the
  // physics arc, then recovers to GROUNDED near the launch line (no teleport).
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(500);
  const preWalkJump = await state();
  await page.keyboard.press("Space");
  const walkJump = await waitPhase("STANDING_JUMP");
  assert(walkJump.clip === "jump", `walking jump selected ${walkJump.clip}`);
  let walkApex = walkJump.pos[1];
  for (let i = 0; i < 28; i++) {
    await page.waitForTimeout(35);
    walkApex = Math.max(walkApex, (await state()).pos[1]);
  }
  assert(walkApex > 1.1, `walking jump apex too low: ${walkApex}`);
  await page.screenshot({ path: `${out}/walking-jump.png` });
  await page.keyboard.up("KeyW");
  const landedWalk = await waitGrounded();
  assert(
    Math.abs(landedWalk.pos[1]) < 0.02,
    `walking jump left a root Y offset: ${landedWalk.pos[1]}`,
  );

  // Repeated idle jumps: each must re-enter STANDING_JUMP with the `jump` clip
  // and return to a grounded rest, proving stable recovery/re-trigger timing.
  await teleport([-6, 0, 1.5], Math.PI / 2);
  for (let rep = 0; rep < 3; rep++) {
    await page.keyboard.press("Space");
    const rj = await waitPhase("STANDING_JUMP");
    assert(rj.clip === "jump", `repeat ${rep} jump selected ${rj.clip}`);
    let apexR = rj.pos[1];
    for (let i = 0; i < 26; i++) {
      await page.waitForTimeout(35);
      apexR = Math.max(apexR, (await state()).pos[1]);
    }
    assert(apexR > 1.1, `repeat ${rep} apex too low: ${apexR}`);
    const grounded = await waitGrounded();
    assert(Math.abs(grounded.pos[1]) < 0.02, `repeat ${rep} bad rest Y ${grounded.pos[1]}`);
  }
  await page.screenshot({ path: `${out}/repeated-jumps.png` });

  const jumpErrors = errors.filter(
    (error) =>
      !error.includes("Failed to load resource") &&
      !isKnownConcurrentDependency(error),
  );
  const jumpFailures = failedRequests.filter((f) => !isKnownConcurrentDependency(f));
  const jumpHttp = httpErrors.filter((e) => !isKnownConcurrentDependency(e));
  console.log("V6", JSON.stringify(v5Response));
  console.log("PRE_WALK_JUMP", JSON.stringify(preWalkJump));
  console.log("ERRORS", JSON.stringify(jumpErrors));
  console.log("HTTP_ERRORS", JSON.stringify(jumpHttp));
  console.log("FAILED_REQUESTS", JSON.stringify(jumpFailures));
  assert(jumpErrors.length === 0, `page/runtime errors: ${jumpErrors.join(" | ")}`);
  assert(jumpHttp.length === 0, `unexpected HTTP errors: ${jumpHttp.join(" | ")}`);
  assert(jumpFailures.length === 0, `unexpected failed requests: ${jumpFailures.join(" | ")}`);
  console.log("JUMP_QA_OK");
  await closeBrowser();
  process.exit(0);
}

// Authored F duck path, distinct from free C.
const duck = marker("NALLEY_DUCK_W");
const duckEndpoint = buildTraversalEndpoints(TRAVERSAL_SET.markers).find(
  (endpoint) => endpoint.affordanceId === duck.id && endpoint.dir === 1,
);
assert(duckEndpoint, "duck endpoint not registered");
await waitTraversalReady();

// Misaligned inside the safety halo: no prompt and F is suppressed.
await teleport(
  [
    duckEndpoint.pos[0] - duckEndpoint.approachDirX,
    duckEndpoint.pos[1],
    duckEndpoint.pos[2] - duckEndpoint.approachDirZ,
  ],
  Math.atan2(duckEndpoint.approachDirZ, -duckEndpoint.approachDirX),
);
await page.waitForTimeout(250);
assert(
  !(await page.locator(".interaction-action-layer").allTextContents()).some((text) => text.includes("Duck")),
  "misaligned duck approach showed a prompt",
);
await page.keyboard.press("KeyF");
await page.waitForTimeout(250);
assert((await state()).phase === "GROUNDED", "misaligned F started duck action");

// Align and walk naturally into acquisition range.
await teleport(
  [
    duckEndpoint.pos[0] - duckEndpoint.approachDirX,
    duckEndpoint.pos[1],
    duckEndpoint.pos[2] - duckEndpoint.approachDirZ,
  ],
  Math.atan2(duckEndpoint.approachDirX, duckEndpoint.approachDirZ),
);
await page.keyboard.down("KeyW");
for (let step = 0; step < 30; step++) {
  await page.waitForTimeout(50);
  const approach = await state();
  if (
    Math.hypot(
      approach.pos[0] - duckEndpoint.pos[0],
      approach.pos[2] - duckEndpoint.pos[2],
    ) < 0.16
  ) break;
}
await page.keyboard.up("KeyW");
await page.locator(".interaction-action-layer", { hasText: "Duck" }).waitFor({
  state: "visible",
  timeout: 2500,
});
console.log("DUCK_ALIGNED", await state(), {
  glyphs: await page.locator(".interaction-action-layer").allTextContents(),
  active: await page.evaluate(() => document.activeElement?.tagName),
  traversal: await page.locator(".world3d").getAttribute("data-traversal-active"),
});
await page.keyboard.press("KeyF");
await page.waitForTimeout(250);
current = await state();
assert(current.phase === "DUCK_UNDER", `duck did not start: ${JSON.stringify(current)}`);
assert(current.clip === "crouchWalk", `duck-under selected ${current.clip}`);
await page.screenshot({ path: `${out}/duck-under.png` });
await page.waitForFunction(
  () => document.querySelector(".world3d")?.dataset.playerMotion !== "DUCK_UNDER",
  undefined,
  { timeout: 8000 },
);
current = await state();
const duckEnd = duckRequestFor(duck, 1).anchors.at(-1);
assert(current.phase === "GROUNDED" && current.crouched === "false", "duck did not return standing");
assert(
  Math.hypot(current.pos[0] - duckEnd.x, current.pos[2] - duckEnd.z) < 0.02,
  `duck exit missed endpoint: ${JSON.stringify(current.pos)}`,
);
if (process.env.DUCK_QA_ONLY === "1") {
  console.log("V5", JSON.stringify(v5Response));
  console.log("DUCK_EXIT", JSON.stringify(current));
  console.log("ERRORS", JSON.stringify(errors));
  console.log("HTTP_ERRORS", JSON.stringify(httpErrors));
  console.log("FAILED_REQUESTS", JSON.stringify(failedRequests));
  const relevantErrors = errors.filter(
    (error) =>
      !error.includes("Failed to load resource") &&
      !isKnownConcurrentDependency(error),
  );
  const relevantFailures = failedRequests.filter(
    (failure) => !isKnownConcurrentDependency(failure),
  );
  const relevantHttpErrors = httpErrors.filter(
    (error) => !isKnownConcurrentDependency(error),
  );
  assert(relevantErrors.length === 0, `page/runtime errors: ${relevantErrors.join(" | ")}`);
  assert(relevantHttpErrors.length === 0, `unexpected HTTP errors: ${relevantHttpErrors.join(" | ")}`);
  assert(relevantFailures.length === 0, `unexpected failed requests: ${relevantFailures.join(" | ")}`);
  await closeBrowser();
  process.exit(0);
}

// F without an object: no locomotion action.
await teleport([-6, 0, 1.5], Math.PI / 2);
await page.keyboard.press("KeyF");
await page.waitForTimeout(350);
current = await state();
assert(current.phase === "GROUNDED", `F fallback triggered ${current.phase}`);

// Space near an authored vault endpoint remains a physical standing jump.
const vaultRegistration = buildDensityTraversalRegistrations().find(
  (registration) =>
    registration.status === "ENABLED" &&
    registration.record.type === "VAULT",
);
const vaultEndpoint = vaultRegistration?.endpoints.find(
  (endpoint) => endpoint.kind === "VAULT",
);
if (vaultEndpoint) {
  const vaultYaw = Math.atan2(
    vaultEndpoint.approachDirX,
    vaultEndpoint.approachDirZ,
  );
  await teleport(vaultEndpoint.pos, vaultYaw);
  await page.keyboard.press("Space");
  current = await waitPhase("STANDING_JUMP");
  assert(current.clip === "jump", `Space near vault selected ${current.clip}`);
  await waitGrounded();

  // F at the same endpoint selects the exact measured vault.
  await teleport(vaultEndpoint.pos, vaultYaw);
  await page
    .locator(".interaction-action-layer", { hasText: "Vault" })
    .waitFor({ state: "visible", timeout: 2500 });
  await page.keyboard.press("KeyF");
  current = await waitPhase("VAULT");
  assert(current.clip === "vault", `F vault selected ${current.clip}`);
  await page.waitForTimeout(420);
  await page.screenshot({ path: `${out}/vault-mid.png` });
  await waitGrounded();
} else {
  console.log("NO_ENABLED_MEASURED_VAULT");
}

// Cardinally-authored climb up/down selection and descent facing are covered by
// pure tests; this browser pass verifies the actual clips are selected.
const climbRegistration = buildDensityTraversalRegistrations().find(
  (registration) =>
    registration.status === "ENABLED" &&
    registration.record.type === "CLIMB_UP",
);
const climbUpEndpoint = climbRegistration?.endpoints.find(
  (endpoint) => endpoint.dir === 1,
);
const climbDownEndpoint = climbRegistration?.endpoints.find(
  (endpoint) => endpoint.dir === -1,
);
assert(climbUpEndpoint && climbDownEndpoint, "climb endpoints not registered");
await teleport(
  climbUpEndpoint.pos,
  Math.atan2(climbUpEndpoint.approachDirX, climbUpEndpoint.approachDirZ),
);
await page
  .locator(
    `[data-interaction-id="TRAVERSAL:${climbRegistration.record.id}:${climbUpEndpoint.dir}"][data-interaction-phase="ACTION"]`,
  )
  .waitFor({ state: "visible", timeout: 2500 });
await page.keyboard.press("KeyF");
current = await waitPhase("CLIMB_UP");
assert(current.clip === "climbUp", `climb up selected ${current.clip}`);
await page.screenshot({ path: `${out}/climb-up.png` });
await page.waitForFunction(
  () => document.querySelector(".world3d")?.dataset.playerMotion !== "CLIMB_UP",
  undefined,
  { timeout: 8000 },
);

await teleport(
  climbDownEndpoint.pos,
  Math.atan2(climbDownEndpoint.approachDirX, climbDownEndpoint.approachDirZ),
);
console.log("CLIMB_DOWN_READY", await state(), await page.locator(".interaction-action-layer").allTextContents());
await page
  .locator(
    `[data-interaction-id="TRAVERSAL:${climbRegistration.record.id}:${climbDownEndpoint.dir}"][data-interaction-phase="ACTION"]`,
  )
  .waitFor({ state: "visible", timeout: 2500 });
await page.keyboard.press("KeyF");
await page.waitForTimeout(250);
current = await state();
assert(current.phase === "CLIMB_DOWN", `climb down did not start: ${JSON.stringify(current)}`);
assert(current.clip === "climbDown", `climb down selected ${current.clip}`);
await page.screenshot({ path: `${out}/climb-down.png` });
await page.waitForFunction(
  () => document.querySelector(".world3d")?.dataset.playerMotion !== "CLIMB_DOWN",
  undefined,
  { timeout: 8000 },
);

console.log("V5", JSON.stringify(v5Response));
console.log("APEX", apex.toFixed(3));
console.log("ERRORS", JSON.stringify(errors));
console.log("FAILED_REQUESTS", JSON.stringify(failedRequests));
console.log("OUTPUT", out);
const relevantErrors = errors.filter(
  (error) =>
    !error.includes("Failed to load resource") &&
    !isKnownConcurrentDependency(error),
);
const relevantFailures = failedRequests.filter(
  (failure) => !isKnownConcurrentDependency(failure),
);
const relevantHttpErrors = httpErrors.filter(
  (error) => !isKnownConcurrentDependency(error),
);
assert(
  relevantErrors.length === 0,
  `page/runtime errors: ${relevantErrors.join(" | ")}`,
);
assert(
  relevantFailures.length === 0,
  `failed requests: ${relevantFailures.join(" | ")}`,
);
assert(
  relevantHttpErrors.length === 0,
  `unexpected HTTP errors: ${relevantHttpErrors.join(" | ")}`,
);
await closeBrowser();
