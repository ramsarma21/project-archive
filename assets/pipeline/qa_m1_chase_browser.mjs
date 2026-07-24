// M1 browser acceptance harness. Runs only against a dev server and uses
// dev-only QA hooks; no production UI or main-flow trigger is introduced.
// Usage:
//   node --import tsx assets/pipeline/qa_m1_chase_browser.mjs
import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  M1_QA_CONTRACT,
} from "../../packages/engine-world/src/qaChaseContract.ts";
import { buildDensityTraversalRegistrations } from "../../packages/chapter-boston-world/src/world/densityTraversalAdapter.ts";
import {
  STAMINA_ACTION_DEBIT,
  STAMINA_MAX,
  STAMINA_REGEN_PER_S,
  STAMINA_SPRINT_DRAIN_PER_S,
} from "../../packages/engine-world/src/stamina.ts";
import { CHASE_TUNING } from "../../packages/chapter-boston-world/src/world/stealthManifest.ts";

const BASE_URL = process.env.M1_QA_URL ?? "http://127.0.0.1:5173/";
const OUT = resolve(
  process.env.M1_QA_OUT ?? "test-results/m1-browser-qa",
);
mkdirSync(OUT, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function planar(a, b) {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: [
    "--use-angle=metal",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--disable-dev-shm-usage",
  ],
});

const report = {
  baseUrl: BASE_URL,
  scenarios: [],
  diagnostics: [],
  errors: [],
};

async function createPage() {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const pageErrors = [];
  const assetErrors = [];
  const diagnostics = [];
  page.on("pageerror", (error) => {
    pageErrors.push(String(error));
    console.log("M1_PAGE_ERROR", String(error));
  });
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().includes("Failed to load resource")
    ) {
      pageErrors.push(`console: ${message.text()}`);
      console.log("M1_CONSOLE_ERROR", message.text());
    }
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const entry = `${response.status()} ${response.url()}`;
    if (response.url().includes("/v1/health")) diagnostics.push(entry);
    else if (response.url().includes("/world/")) assetErrors.push(entry);
    else diagnostics.push(entry);
    if (!response.url().includes("/v1/health")) {
      console.log("M1_HTTP_ERROR", entry);
    }
  });
  return { context, page, pageErrors, assetErrors, diagnostics };
}

// design1 kill list (product decision): the pre-game calibration interview is
// DELETED, so the chase assist and accessibility preferences are no longer
// chosen through an onboarding wizard. QA seeds them directly onto a per-run
// profile — with `calibrated: true` so the explicit choices are honored
// verbatim (never OS-overridden) — exactly as the shipped pause-settings
// surface would persist them. Each scenario runs in its own fresh context, so
// its IndexedDB starts empty and the seed cannot collide across scenarios.
async function seedProfile(page, options) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() =>
    document.body.textContent?.includes("Project Archive"),
  );
  await page.waitForFunction(
    async () => {
      const opened = indexedDB.open("project-archive");
      const database = await new Promise((res) => {
        opened.onsuccess = () => res(opened.result);
        opened.onerror = () => res(null);
      });
      if (!database) return false;
      const ready = database.objectStoreNames.contains("profiles");
      database.close();
      return ready;
    },
    null,
    { timeout: 20000 },
  );
  const onboarding = {
    version: 1,
    readingSpeed: "STANDARD",
    captions: true,
    audioDescription: false,
    inputMethod: options.keyboardOnly ? "KEYBOARD_ONLY" : "KEYBOARD_MOUSE",
    archiveAssistAutoOffer: true,
    highContrast: Boolean(options.highContrast),
    reducedMotion: Boolean(options.reducedMotion),
    chaseAssist: options.assist,
    primersSeen: ["ARCHIVE", "MOVEMENT", "READ", "WORK", "CHOICE"],
    calibrated: true,
    completedAt: "2026-07-23T00:00:00.000Z",
  };
  await page.evaluate(
    async ({ profileId, displayName, onboarding }) => {
      const request = indexedDB.open("project-archive");
      await new Promise((res, rej) => {
        request.onerror = () => rej(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const tx = database.transaction(["profiles"], "readwrite");
          tx.objectStore("profiles").put({
            profileId,
            accountId: `local:${profileId}`,
            displayName,
            variationRootSeedHex: "a1".repeat(32),
            source: "LOCAL",
            createdAt: "2026-07-23T00:00:00.000Z",
            onboarding,
          });
          tx.oncomplete = () => {
            database.close();
            res();
          };
          tx.onerror = () => rej(tx.error);
        };
      });
    },
    {
      profileId: `m1-qa-${options.name}`,
      displayName: options.name,
      onboarding,
    },
  );
}

async function bootstrap(page, options) {
  await seedProfile(page, options);
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  const row = page
    .locator(".profile-row, [data-profile-row], li, article, div")
    .filter({ hasText: options.name })
    .filter({ has: page.getByRole("button", { name: "Play" }) })
    .first();
  const play = row.getByRole("button", { name: "Play" }).first();
  await play.waitFor({ state: "visible", timeout: 15000 });
  await play.click();

  const advanceLabels = [
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
  for (let attempt = 0; attempt < 50; attempt++) {
    const world = page.locator(M1_QA_CONTRACT.worldRootSelector);
    const playRoot = page.locator(M1_QA_CONTRACT.playRootSelector);
    const ready =
      (await world.count()) > 0 &&
      (await world.getAttribute("data-movement-active")) === "true" &&
      (await playRoot.getAttribute("data-plan-request")) === "FREE_ROAM" &&
      (await playRoot.getAttribute("data-qa-chase-hook")) === "READY";
    if (ready) break;
    for (const label of advanceLabels) {
      const button = page
        .locator(`button:has-text("${label}"):not([disabled])`)
        .first();
      if (
        (await button.count()) > 0 &&
        (await button.isVisible().catch(() => false))
      ) {
        await button.click({ timeout: 2500 }).catch(() => null);
        break;
      }
    }
    await page.waitForTimeout(700);
  }
  const primer = page.getByRole("button", { name: "ACKNOWLEDGE" });
  if (await primer.isVisible().catch(() => false)) {
    await primer.click();
    await page.waitForTimeout(250);
  }
  console.log(
    "M1_BOOTSTRAP",
    JSON.stringify(
      await page.evaluate(({ playSelector, worldSelector }) => {
        const playRoot = document.querySelector(playSelector);
        const world = document.querySelector(worldSelector);
        return {
          play: playRoot
            ? Object.fromEntries(
                [...playRoot.attributes]
                  .filter((attribute) => attribute.name.startsWith("data-"))
                  .map((attribute) => [attribute.name, attribute.value]),
              )
            : null,
          world: world
            ? Object.fromEntries(
                [...world.attributes]
                  .filter((attribute) => attribute.name.startsWith("data-"))
                  .map((attribute) => [attribute.name, attribute.value]),
              )
            : null,
          hook: typeof window.__PA_QA_CHASE__,
          fieldHook: typeof window.__PA_FIELD_EVENT__,
          body: document.body.innerText.slice(0, 1000),
        };
      }, {
        playSelector: M1_QA_CONTRACT.playRootSelector,
        worldSelector: M1_QA_CONTRACT.worldRootSelector,
      }),
    ),
  );
  await page.screenshot({
    path: resolve(OUT, `bootstrap-${options.name}.png`),
    fullPage: true,
  });
  await page.waitForFunction(
    ({ playSelector, worldSelector }) => {
      const playRoot = document.querySelector(playSelector);
      const world = document.querySelector(worldSelector);
      return (
        playRoot?.getAttribute("data-plan-request") === "FREE_ROAM" &&
        playRoot?.getAttribute("data-qa-chase-hook") === "READY" &&
        world?.getAttribute("data-movement-active") === "true" &&
        typeof window.__PA_QA_CHASE__ === "function"
      );
    },
    {
      playSelector: M1_QA_CONTRACT.playRootSelector,
      worldSelector: M1_QA_CONTRACT.worldRootSelector,
    },
    { timeout: 20_000 },
  );
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
}

async function worldState(page) {
  return page.locator(M1_QA_CONTRACT.worldRootSelector).evaluate((node) => ({
    space: node.dataset.fieldSpace,
    cameraOwner: node.dataset.cameraOwner,
    cameraInputLocked: node.dataset.cameraInputLocked,
    movementActive: node.dataset.movementActive,
    traversalActive: node.dataset.traversalActive,
    player: (node.dataset.playerPos3d ?? "").split(",").map(Number),
    playerMotion: node.dataset.playerMotion,
    playerSpeed: Number(node.dataset.playerSpeed),
    playerSprinting: node.dataset.playerSprinting,
    playerCrouched: node.dataset.playerCrouched,
    playerStamina: Number(node.dataset.playerStamina),
    playerActionSerial: Number(node.dataset.playerActionSerial),
    playerInputLocked: node.dataset.playerInputLocked,
    playerFacing: (node.dataset.playerFacing ?? "").split(",").map(Number),
    playerMovementIntent: node.dataset.playerMovementIntent,
    playerBlocked: node.dataset.playerBlocked,
    chaseActive: node.dataset.chaseActive,
    chaseState: node.dataset.chaseState,
    stamina: Number(node.dataset.chaseStamina),
    confirmResolve: node.dataset.chaseConfirmResolve,
    assist: node.dataset.chaseAssist,
    pursuerRegistered: node.dataset.pursuerRegistered,
    pursuer: (node.dataset.pursuerPosition ?? "").split(",").map(Number),
    pursuerVelocity: (node.dataset.pursuerVelocity ?? "")
      .split(",")
      .map(Number),
    pursuerSpace: node.dataset.pursuerSpace,
    outcome: node.dataset.chaseOutcome,
    gap: Number(node.dataset.chaseGap),
    shakeSeconds: Number(node.dataset.chaseShakeSeconds),
    corneredSeconds: Number(node.dataset.chaseCorneredSeconds),
    targetWaypoint: node.dataset.chaseTargetWaypoint,
  }));
}

async function playState(page) {
  return page.locator(M1_QA_CONTRACT.playRootSelector).evaluate((node) => ({
    plan: node.dataset.planRequest,
    location: node.dataset.runtimeLocation,
    interrupt: node.dataset.fieldInterrupt,
    chaseId: node.dataset.activeChaseId,
    clock: Number(node.dataset.clockSpent),
    carried: (node.dataset.carriedObjectIds ?? "")
      .split(",")
      .filter(Boolean),
    confiscated: (node.dataset.confiscatedObjectIds ?? "")
      .split(",")
      .filter(Boolean),
    pendingReposition: node.dataset.pendingReposition,
    outcome: node.dataset.lastChaseOutcome,
    qaStatus: node.dataset.qaChaseStatus,
    qaReason: node.dataset.qaChaseReason,
    assist: node.dataset.chaseAssist,
    inputMethod: node.dataset.inputMethod,
    highContrast: node.dataset.highContrast,
    reducedMotion: node.dataset.reducedMotion,
  }));
}

async function startChase(page) {
  let result = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    result = await page.evaluate(() =>
      Promise.race([
        window.__PA_QA_CHASE__(),
        new Promise((resolve) =>
          window.setTimeout(
            () =>
              resolve({
                ok: false,
                status: "TIMEOUT",
                reason:
                  document
                    .querySelector('[data-game-root="play"]')
                    ?.getAttribute("data-qa-chase-step") ?? "no QA step",
              }),
            20_000,
          ),
        ),
      ]),
    );
    // BUSY = presentation still settling. COMMIT_REJECTED at start time is a
    // transient race: a prior chase's interrupt cleanup is still draining in
    // the authoritative runtime while the React field view already reads clear,
    // so eligibility passes but the FIELD_WATCHER_CHALLENGE is refused. The
    // rejected challenge never committed, so re-issuing once the interrupt has
    // fully cleared is safe (and gets a fresh event suffix). Give it a longer
    // settle than the BUSY case.
    if (result?.status !== "BUSY" && result?.status !== "COMMIT_REJECTED") break;
    await page.waitForTimeout(result?.status === "COMMIT_REJECTED" ? 500 : 200);
  }
  console.log("M1_CHASE_START", JSON.stringify(result));
  assert(
    result?.ok,
    `QA chase start failed: ${JSON.stringify(result)} ${JSON.stringify(
      await playState(page),
    )}`,
  );
  await page.waitForFunction(
    (selector) => {
      const world = document.querySelector(selector);
      return (
        world?.getAttribute("data-chase-active") === "true" &&
        world?.getAttribute("data-camera-owner") === "CHASE" &&
        world?.getAttribute("data-pursuer-registered") === "true"
      );
    },
    M1_QA_CONTRACT.worldRootSelector,
    { timeout: 12_000 },
  );
  return result;
}

async function teleport(page, position, yaw = 0) {
  await page.evaluate(
    ({ position, yaw }) =>
      window.dispatchEvent(
        new CustomEvent("pa:qa-player-command", {
          detail: { teleport: position, faceY: yaw },
        }),
      ),
    { position, yaw },
  );
  await page.waitForTimeout(250);
}

async function shot(page, name) {
  const path = resolve(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

async function waitOutcome(page, outcome, timeout = 15_000) {
  await page.waitForFunction(
    ({ selector, outcome }) =>
      document.querySelector(selector)?.getAttribute("data-chase-outcome") ===
      outcome,
    { selector: M1_QA_CONTRACT.worldRootSelector, outcome },
    { timeout },
  );
  await page.waitForFunction(
    (selector) =>
      document.querySelector(selector)?.getAttribute("data-chase-active") ===
      "false",
    M1_QA_CONTRACT.worldRootSelector,
    { timeout },
  );
}

async function finishScenario(env, name) {
  report.scenarios.push({
    name,
    play: await playState(env.page),
    world: await worldState(env.page),
  });
  report.diagnostics.push(...env.diagnostics);
  report.errors.push(...env.pageErrors, ...env.assetErrors);
  await env.context.close();
}

// STANDARD: live controls, stamina, traversal debit, LOS shake, refuge,
// generic isolated interior transfer, and both caught paths.
{
  const env = await createPage();
  const { page } = env;
  await bootstrap(page, { name: "M1Standard", assist: "STANDARD" });
  await shot(page, "01-start-free-roam");
  await startChase(page);
  await page.waitForTimeout(700);
  if (process.env.M1_QA_TRIGGER_ONLY === "1") {
    console.log(
      "M1_TRIGGER_STATE",
      JSON.stringify({ play: await playState(page), world: await worldState(page) }),
    );
    await shot(page, "trigger-only-active");
    await env.context.close();
    await browser.close();
    process.exit(0);
  }
  const active = await worldState(page);
  assert(active.cameraOwner === "CHASE", "chase did not own camera");
  assert(active.cameraInputLocked === "false", "chase locked camera input policy");
  assert(active.pursuerRegistered === "true", "pursuer actor was not registered");
  await shot(page, "02-active-chase");

  const beforeMove = await worldState(page);
  await page.keyboard.down("Shift");
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(1200);
  await page.keyboard.up("KeyW");
  await page.keyboard.up("Shift");
  const afterSprint = await worldState(page);
  assert(
    planar(beforeMove.player, afterSprint.player) > 1,
    "WASD did not move under chase camera",
  );
  // Sprint drain is feel-tuned to STAMINA_SPRINT_DRAIN_PER_S (0.14/s so a full
  // sprint lasts ~7s). A ~1.2s burst can therefore drain at most ~0.17, so the
  // check is tied to the tuned model instead of a stale pre-retune 0.2 magic
  // number. It still fails hard if sprint drain regresses to zero, and we keep
  // the sprint window short to avoid the player reaching street geometry (which
  // would block movement and switch stamina back to regen).
  const sprintDrain = beforeMove.stamina - afterSprint.stamina;
  assert(
    sprintDrain > STAMINA_SPRINT_DRAIN_PER_S * 0.6,
    `stamina did not drain: ${beforeMove.stamina} -> ${afterSprint.stamina} (Δ${sprintDrain.toFixed(3)}, expected > ${(STAMINA_SPRINT_DRAIN_PER_S * 0.6).toFixed(3)})`,
  );
  await shot(page, "03-stamina-drain");
  const drained = afterSprint.stamina;
  await page.waitForTimeout(1000);
  const recovered = await worldState(page);
  // Regen is tuned to STAMINA_REGEN_PER_S (0.3/s). Because the gentle sprint
  // drain leaves stamina high, a fixed +0.15 target would collide with the
  // STAMINA_MAX clamp; instead require a regen-rate-proportional rise that is
  // also capped just below the ceiling so a near-full recovery still passes.
  const recoveryFloor = Math.min(
    STAMINA_MAX - 0.01,
    drained + STAMINA_REGEN_PER_S * 0.3,
  );
  assert(
    recovered.stamina > recoveryFloor,
    `stamina did not recover: ${drained} -> ${recovered.stamina} (floor ${recoveryFloor.toFixed(3)})`,
  );

  await page.keyboard.press("KeyC");
  await page.waitForFunction(
    (selector) =>
      document.querySelector(selector)?.getAttribute("data-player-crouched") ===
      "true",
    M1_QA_CONTRACT.worldRootSelector,
  );
  await page.keyboard.press("KeyC");
  await page.keyboard.press("Space");
  await page.waitForFunction(
    (selector) =>
      document.querySelector(selector)?.getAttribute("data-player-motion") ===
      "STANDING_JUMP",
    M1_QA_CONTRACT.worldRootSelector,
    { timeout: 2500 },
  );
  const climbCandidates = buildDensityTraversalRegistrations()
    .filter(
      (registration) =>
        registration.status === "ENABLED" &&
        registration.record.type === "CLIMB_UP",
    )
    .map((registration) => ({
      id: registration.record.id,
      endpoint: registration.endpoints.find(
        (endpoint) => endpoint.kind === "CLIMB_UP",
      ),
    }))
    .filter((candidate) => candidate.endpoint);
  let climb = null;
  const climbDiagnostics = [];
  for (const candidate of climbCandidates) {
    const endpoint = candidate.endpoint;
    await teleport(
      page,
      endpoint.pos,
      Math.atan2(endpoint.approachDirX, endpoint.approachDirZ),
    );
    await page.waitForTimeout(350);
    const labels = await page.locator(".interaction-glyph").allTextContents();
    climbDiagnostics.push({
      id: candidate.id,
      labels,
      state: await worldState(page),
      play: await playState(page),
    });
    if (labels.some((label) => label.includes("Climb"))) {
      climb = candidate;
      break;
    }
  }
  assert(
    climb,
    `no measured climb remained browser-reachable during chase: ${JSON.stringify(
      climbDiagnostics,
    )}`,
  );
  console.log(
    "M1_CLIMB_READY",
    JSON.stringify({
      state: await worldState(page),
      glyphs: await page.locator(".interaction-glyph").allTextContents(),
    }),
  );
  await shot(page, "climb-ready");
  const beforeClimb = await worldState(page);
  await page.keyboard.press("KeyF");
  await page.waitForFunction(
    (selector) =>
      document.querySelector(selector)?.getAttribute("data-player-motion") ===
      "CLIMB_UP",
    M1_QA_CONTRACT.worldRootSelector,
    { timeout: 2500 },
  );
  const duringClimb = await worldState(page);
  // A climb costs exactly one STAMINA_ACTION_DEBIT charge (feel-tuned to 0.12).
  // A little regen can accrue in the frame the debit lands, so allow the debit
  // to fall between one charge and one charge minus a frame of regen, tied to
  // the model constants rather than a stale 0.15 literal.
  const climbDebit = beforeClimb.stamina - duringClimb.stamina;
  assert(
    climbDebit > STAMINA_ACTION_DEBIT - 0.03 &&
      climbDebit < STAMINA_ACTION_DEBIT + 0.02,
    `climb debit was not one ${STAMINA_ACTION_DEBIT} charge: ${beforeClimb.stamina} -> ${duringClimb.stamina} (Δ${climbDebit.toFixed(3)})`,
  );
  assert(
    duringClimb.playerActionSerial === beforeClimb.playerActionSerial + 1,
    "accepted climb did not increment action serial once",
  );

  // Break LOS across the north building row and hold a large gap.
  await teleport(page, [18, 0, -22], Math.PI / 2);
  await page.waitForTimeout(5200);
  if ((await playState(page)).outcome !== "ESCAPED") {
    await teleport(page, [65, 0, -22], Math.PI / 2);
    await page.waitForTimeout(5200);
  }
  await waitOutcome(page, "ESCAPED", 5000);
  await shot(page, "04-escaped-los");

  await startChase(page);
  await teleport(page, [-18, 0, -9.7], 0);
  await waitOutcome(page, "REFUGE", 6000);
  await shot(page, "05-tagged-refuge");

  await startChase(page);
  const genericInterior = "EXPLORE_rowN1";
  await page.evaluate((id) => window.__PA_QA_INTERIOR__(id, "CENTER"), genericInterior);
  await page.waitForFunction(
    ({ selector, id }) =>
      document.querySelector(selector)?.getAttribute("data-field-space") === id,
    { selector: M1_QA_CONTRACT.worldRootSelector, id: genericInterior },
    { timeout: 5000 },
  );
  await page.waitForTimeout(250);
  assert(
    (await worldState(page)).pursuerRegistered === "false",
    "pursuer was not removed during portal transfer delay",
  );
  await page.waitForFunction(
    ({ selector, id }) => {
      const world = document.querySelector(selector);
      return (
        world?.getAttribute("data-pursuer-registered") === "true" &&
        world?.getAttribute("data-pursuer-space") === id
      );
    },
    { selector: M1_QA_CONTRACT.worldRootSelector, id: genericInterior },
    { timeout: 7000 },
  );
  await shot(page, "06-generic-interior-transfer");
  await page.evaluate(() => window.__PA_QA_DOOR__(null, null));
  await teleport(page, [-6, 0, 1.5], Math.PI / 2);
  await page.waitForFunction(
    (selector) =>
      document.querySelector(selector)?.getAttribute("data-field-space") ===
      "EXTERIOR",
    M1_QA_CONTRACT.worldRootSelector,
    { timeout: 5000 },
  );
  await page.waitForFunction(
    (selector) => {
      const world = document.querySelector(selector);
      return (
        world?.getAttribute("data-pursuer-registered") === "true" &&
        world?.getAttribute("data-pursuer-space") === "EXTERIOR"
      );
    },
    M1_QA_CONTRACT.worldRootSelector,
    { timeout: 7000 },
  );
  await teleport(page, [89, 0, -19], Math.PI);
  await waitOutcome(page, "REFUGE", 6000);

  // Seed one relevant carried good through the typed interrupt event, then
  // exhaust stamina on an open street and let the pursuer catch up.
  await teleport(page, [-32, 0, 0], Math.PI / 2);
  const caughtStart = await startChase(page);
  const seeded = await page.evaluate(
    ({ interruptId }) =>
      window.__PA_FIELD_EVENT__({
        type: "FIELD_CUSTODY_CHANGED",
        eventId: `${interruptId}_QA_CARRIED`,
        interruptId,
        objectId: "CARRIER_HANDBILLS",
        custody: "PLAYER",
        condition: "INTACT",
        concealment: "WRAPPED",
        reason: "m1-browser-qa-carried-good",
      }),
    caughtStart,
  );
  assert(seeded, "could not seed carried chase good");
  const clockBefore = (await playState(page)).clock;
  await page.keyboard.down("Shift");
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(1200);
  // The sprint above proves live drain; the feel-tuned 0.14/s rate would need
  // ~7s of unobstructed sprint to hit zero, which overruns the authored QA
  // street (a wall would block movement and flip stamina back to regen). Seed
  // the exhausted precondition through the dev-only QA player command while the
  // player is still sprinting+moving, so per-frame stamina stepping pins it at
  // zero rather than regenerating.
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("pa:qa-player-command", { detail: { stamina: 0 } }),
    ),
  );
  await page.waitForTimeout(300);
  console.log(
    "M1_EXHAUSTED_READY",
    JSON.stringify({ play: await playState(page), world: await worldState(page) }),
  );
  assert(
    (await worldState(page)).stamina <= 0.02,
    "sprint did not exhaust stamina",
  );
  // Turn back into the pursuing officer while still holding Shift. Stamina
  // stays empty, proving the <1.2m exhausted catch path without depending on a
  // long straight route beyond the authored QA street segment.
  await page.keyboard.up("KeyW");
  await page.keyboard.down("KeyS");
  await waitOutcome(page, "CAUGHT", 15_000);
  await page.keyboard.up("KeyS");
  await page.keyboard.up("Shift");
  const caught = await playState(page);
  assert(caught.clock === clockBefore + 2, "caught did not cost two clock units");
  assert(
    caught.confiscated.includes("CARRIER_HANDBILLS"),
    "caught did not confiscate carried handbills",
  );
  assert(
    caught.location === "BOSTON_STREET",
    "caught did not continue on Boston street",
  );
  await page.waitForFunction(
    ({ playSelector, worldSelector }) =>
      document.querySelector(worldSelector)?.getAttribute(
        "data-player-input-locked",
      ) === "false" &&
      document.querySelector(worldSelector)?.getAttribute(
        "data-movement-active",
      ) === "true" &&
      document.querySelector(worldSelector)?.getAttribute(
        "data-camera-owner",
      ) === "PLAYER" &&
      document.querySelector(playSelector)?.getAttribute(
        "data-pending-reposition",
      ) === "",
    {
      playSelector: M1_QA_CONTRACT.playRootSelector,
      worldSelector: M1_QA_CONTRACT.worldRootSelector,
    },
    { timeout: 8000 },
  );
  await shot(page, "07-caught-release");
  await startChase(page);
  // Drive into the solid east shoulder of Pike's facade (clear of its door)
  // so movement intent is continuously blocked by semantic collision.
  await teleport(page, [33, 0, 8.5], 0);
  await page.keyboard.down("KeyW");
  // Hold into the facade long enough to accrue the full corneredHoldSeconds
  // (2.6s) plus the short approach that presses the player flush to it.
  await page.waitForTimeout(4500);
  await page.keyboard.up("KeyW");
  console.log("M1_CORNER_READY", JSON.stringify(await worldState(page)));
  await waitOutcome(page, "CAUGHT", 8000);
  await page.waitForFunction(
    (selector) => {
      const world = document.querySelector(selector);
      return (
        world?.getAttribute("data-player-input-locked") === "false" &&
        world?.getAttribute("data-movement-active") === "true" &&
        world?.getAttribute("data-camera-owner") === "PLAYER"
      );
    },
    M1_QA_CONTRACT.worldRootSelector,
    { timeout: 8000 },
  );
  await shot(page, "08-cornered-catch");
  await finishScenario(env, "STANDARD_FULL");
}

// SLOW_PURSUER speed contract.
{
  const env = await createPage();
  await bootstrap(env.page, { name: "M1Slow", assist: "SLOW_PURSUER" });
  await startChase(env.page);
  // The officer plants and shouts for CHASE_TUNING.startSeconds (1.2s) before
  // he runs, so wait for the pursuer to actually be moving rather than reading
  // during the authored head start. Speed is tied to the feel-tuned
  // slowPursuerMps constant, not a stale literal.
  await env.page.waitForFunction(
    (selector) => {
      const raw = document
        .querySelector(selector)
        ?.getAttribute("data-pursuer-velocity") ?? "";
      const parts = raw.split(",").map(Number);
      return Math.hypot(parts[0] ?? 0, parts[2] ?? 0) > 1;
    },
    M1_QA_CONTRACT.worldRootSelector,
    { timeout: 6000 },
  );
  const velocity = (await worldState(env.page)).pursuerVelocity;
  const speed = Math.hypot(velocity[0], velocity[2]);
  assert(
    Math.abs(speed - CHASE_TUNING.slowPursuerMps) < 0.15,
    `slow pursuer speed was ${speed}, expected ~${CHASE_TUNING.slowPursuerMps}`,
  );
  await shot(env.page, "09-slow-pursuer");
  await finishScenario(env, "SLOW_PURSUER");
}

// AUTO_STAMINA plus reduced-motion/high-contrast/keyboard-only.
{
  const env = await createPage();
  await bootstrap(env.page, {
    name: "M1Accessible",
    assist: "AUTO_STAMINA",
    highContrast: true,
    reducedMotion: true,
    keyboardOnly: true,
  });
  await startChase(env.page);
  await env.page.keyboard.down("Shift");
  await env.page.keyboard.down("KeyW");
  await env.page.waitForTimeout(1200);
  await env.page.keyboard.up("KeyW");
  await env.page.keyboard.up("Shift");
  const world = await worldState(env.page);
  const play = await playState(env.page);
  assert(world.stamina > 0.99, "AUTO_STAMINA drained");
  assert(play.inputMethod === "KEYBOARD_ONLY", "keyboard-only was not applied");
  assert(play.highContrast === "true", "high contrast was not applied");
  assert(play.reducedMotion === "true", "reduced motion was not applied");
  assert(
    await env.page.locator(".stealth-hud.is-high-contrast.is-reduced-motion").count(),
    "accessible chase HUD classes missing",
  );
  await shot(env.page, "10-accessibility-auto-stamina");
  await finishScenario(env, "ACCESSIBILITY_AUTO_STAMINA");
}

// CONFIRM_RESOLVE pauses the same refuge outcome for explicit confirmation.
{
  const env = await createPage();
  await bootstrap(env.page, { name: "M1Confirm", assist: "CONFIRM_RESOLVE" });
  await startChase(env.page);
  await teleport(env.page, [-18, 0, -9.7], 0);
  await env.page.waitForFunction(
    (selector) =>
      document.querySelector(selector)?.getAttribute(
        "data-chase-confirm-resolve",
      ) === "true",
    M1_QA_CONTRACT.worldRootSelector,
    { timeout: 5000 },
  );
  assert(
    (await playState(env.page)).outcome !== "REFUGE",
    "confirm assist resolved before confirmation",
  );
  await shot(env.page, "11-confirm-resolve-pending");
  await env.page.getByRole("button", { name: "Confirm chase outcome" }).click();
  await waitOutcome(env.page, "REFUGE", 6000);
  await shot(env.page, "12-confirm-resolve-complete");
  await finishScenario(env, "CONFIRM_RESOLVE");
}

const uniqueDiagnostics = [...new Set(report.diagnostics)];
report.diagnostics = uniqueDiagnostics;
writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
assert(report.errors.length === 0, `browser game errors: ${report.errors.join(" | ")}`);
const unexpectedDiagnostics = report.diagnostics.filter(
  (entry) => !entry.includes("/v1/health"),
);
assert(
  unexpectedDiagnostics.length === 0,
  `unexpected browser HTTP diagnostics: ${unexpectedDiagnostics.join(" | ")}`,
);
await browser.close();
console.log(`M1 browser QA passed. Evidence: ${OUT}`);
