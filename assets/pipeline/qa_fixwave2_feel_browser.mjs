// Focused Feel-Audit Fix Wave 2 acceptance for the remaining P1 contracts.
// Runs against a fresh dev server with system Chrome + ANGLE/Metal.
import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BOSTON_DAY1_FLOW_VERSION,
  CHAPTER_ID,
  PACKAGE_ID,
  createDay1Session,
} from "../../packages/chapter-boston/src/index.ts";

const BASE_URL = process.env.FIXWAVE2_QA_URL ?? "http://127.0.0.1:4902/";
const OUT = resolve(
  process.env.FIXWAVE2_QA_OUT ?? "test-results/fixwave-2",
);
const ONLY = new Set(
  (process.env.FIXWAVE2_QA_ONLY ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const SEED = "52".repeat(32);
mkdirSync(OUT, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function mechanicResult(request) {
  const params = request.params;
  if (params.kind === "PRESS") return { kind: "PRESS", stopOffset: 0.5 };
  if (params.kind === "EFFORT") return { kind: "EFFORT", holdMs: 1500 };
  if (params.kind === "PLACE") return { kind: "PLACE", alignment: 0.5 };
  if (params.kind === "PRINT_JOB") {
    return {
      kind: "PRINT_JOB",
      phases: {
        catch: 0.9,
        ink: 0.9,
        register: 0.9,
        pull: 0.9,
        peel: 0.9,
      },
      quality: "CRISP",
      accessible: false,
    };
  }
  const needs = new Set(["deed", "writ", "newspaper"]);
  return {
    kind: "SORT",
    assignments: (params.sortItems ?? []).map((item) => ({
      itemId: item.itemId,
      bucketId: needs.has(item.itemId) ? "NEEDS_STAMP" : "DOES_NOT",
    })),
  };
}

function ordinaryResponse(request) {
  switch (request.kind) {
    case "CONTINUE":
    case "DAY_END":
      return { type: "CONTINUE" };
    case "ACK":
      return { type: "ACK" };
    case "FOCUS_READ":
      return { type: "FOCUS_READ_OPENED", objectId: request.objectId };
    case "BREATHER":
      return { type: "BREATHER_COMPLETE" };
    case "FREE_ROAM": {
      const target =
        request.targets.find((candidate) => candidate.marker === "GOLD") ??
        request.targets[0];
      return { type: "FREE_ROAM_GOTO", targetId: target.targetId };
    }
    case "MECHANIC":
      return {
        type: "MECHANIC_RESULT",
        promptId: request.promptId,
        result: mechanicResult(request),
      };
    case "CHOICE": {
      const option =
        request.options.find((candidate) => !candidate.disabled) ??
        request.options[0];
      return {
        type: "CHOICE_SELECTED",
        promptId: request.promptId,
        choiceId: option.choiceId,
      };
    }
  }
}

function postMercerSession() {
  const session = createDay1Session({ variationRootSeedHex: SEED });
  for (let step = 0; step < 200; step++) {
    if (
      session.ctx.world.objectives.REPORT_TO_MERCER === "COMPLETED" &&
      session.plan?.request.kind === "FREE_ROAM" &&
      session.ctx.world.locationId === "BOSTON_STREET" &&
      session.plan.request.selectedTargetId
    ) {
      return session;
    }
    if (
      session.ctx.world.objectives.REPORT_TO_MERCER === "COMPLETED" &&
      session.plan?.request.kind === "FREE_ROAM" &&
      !session.plan.request.selectedTargetId
    ) {
      const target =
        session.plan.request.targets.find(
          (candidate) => candidate.marker === "GOLD",
        ) ?? session.plan.request.targets[0];
      session.advance({
        type: "FREE_ROAM_SELECT",
        targetId: target.targetId,
      });
      continue;
    }
    assert(session.plan, "runtime ended before post-Mercer free roam");
    session.advance(ordinaryResponse(session.plan.request));
  }
  throw new Error("could not construct post-Mercer save");
}

function initialStreetEvents() {
  const session = createDay1Session({ variationRootSeedHex: SEED });
  for (let step = 0; step < 80; step++) {
    if (
      session.plan?.request.kind === "FREE_ROAM" &&
      session.ctx.world.locationId === "BOSTON_STREET"
    ) {
      if (!session.plan.request.selectedTargetId) {
        const target =
          session.plan.request.targets.find(
            (candidate) => candidate.marker === "GOLD",
          ) ?? session.plan.request.targets[0];
        session.advance({
          type: "FREE_ROAM_SELECT",
          targetId: target.targetId,
        });
      }
      return [...session.committedEvents];
    }
    assert(session.plan, "runtime ended before initial street state");
    session.advance(ordinaryResponse(session.plan.request));
  }
  throw new Error("could not construct initial street save");
}

function appendExchange(session, serial, sourceId, outcomeId, completion) {
  const interruptId = `FW2_${serial}`;
  for (const event of [
    {
      type: "FIELD_INTERRUPT_STARTED",
      eventId: `${interruptId}_START`,
      interruptId,
      interruptKind: "REACTIVE_EXCHANGE",
      sourceId,
    },
    {
      type: "FIELD_REACTIVE_COMPLETED",
      eventId: `${interruptId}_COMPLETE`,
      interruptId,
      completion: {
        interactionId: `${sourceId}:${serial}`,
        sourceId,
        outcomeId,
        ...completion,
      },
    },
    {
      type: "FIELD_INTERRUPT_RESOLVED",
      eventId: `${interruptId}_RESOLVE`,
      interruptId,
      outcome: outcomeId,
    },
  ]) {
    session.emitFieldEvent(event);
  }
}

function dockReadyEvents() {
  const session = postMercerSession();
  appendExchange(session, "DOCK_OFFER", "SJ-dock-haul-offer", "ACCEPT", {
    activities: [
      {
        activityId: "SJ-dock-haul",
        stage: "ACCEPTED",
        breadcrumb: "Lift the dockhand's barrel beside the wharf crane.",
      },
    ],
  });
  appendExchange(session, "DOCK_LIFT", "SJ-dock-haul-lift", "ACCEPTED", {
    activities: [
      {
        activityId: "SJ-dock-haul",
        stage: "CARRYING",
        breadcrumb: "Carry the barrel to the gangplank.",
      },
    ],
    custody: [
      {
        objectId: "DOCK_BARREL",
        custody: "PLAYER",
        condition: "INTACT",
        concealment: "EXPOSED",
      },
    ],
  });
  appendExchange(session, "DOCK_BALANCE", "SJ-dock-haul-balance", "CARRYING", {
    activities: [
      {
        activityId: "SJ-dock-haul",
        stage: "READY_HANDOFF",
        breadcrumb: "Set the barrel down on the ship's deck.",
      },
    ],
  });
  return [...session.committedEvents];
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
  generatedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  scenarios: [],
  screenshots: [],
  errors: [],
  diagnostics: [],
};

async function closeBrowser() {
  await Promise.race([
    browser.close().catch(() => undefined),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 3000)),
  ]);
}

async function screenshot(page, p1Id, name) {
  const directory = resolve(OUT, p1Id);
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, `${name}.png`);
  const buffer = await page.screenshot({ path, fullPage: true });
  const luminance = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    let nonBlack = 0;
    let samples = 0;
    for (let index = 0; index < pixels.length; index += 16) {
      const luma =
        0.2126 * pixels[index] +
        0.7152 * pixels[index + 1] +
        0.0722 * pixels[index + 2];
      sum += luma;
      if (luma > 18) nonBlack++;
      samples++;
    }
    return {
      meanLuma: Number((sum / samples).toFixed(3)),
      nonBlackRatio: Number((nonBlack / samples).toFixed(4)),
    };
  }, buffer.toString("base64"));
  assert(
    luminance.meanLuma >= 5 && luminance.nonBlackRatio >= 0.1,
    `${p1Id}/${name} rendered black: ${JSON.stringify(luminance)}`,
  );
  report.screenshots.push({ p1Id, name, path, luminance });
}

async function seedProfile(
  page,
  profileId,
  displayName,
  events,
  primersSeen,
  preferences = {},
) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    async () => {
      const request = indexedDB.open("project-archive");
      const database = await new Promise((resolvePromise) => {
        request.onsuccess = () => resolvePromise(request.result);
        request.onerror = () => resolvePromise(null);
      });
      if (!database) return false;
      const ready =
        database.objectStoreNames.contains("profiles") &&
        database.objectStoreNames.contains("saves");
      database.close();
      return ready;
    },
    null,
    { timeout: 20_000 },
  );
  await page.evaluate(
    async ({
      profileId,
      displayName,
      events,
      primersSeen,
      seed,
      chapterId,
      packageId,
      flowVersion,
      preferences,
    }) => {
      const request = indexedDB.open("project-archive");
      await new Promise((resolvePromise, reject) => {
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(
            ["profiles", "saves"],
            "readwrite",
          );
          transaction.objectStore("profiles").put({
            profileId,
            accountId: `local:${profileId}`,
            displayName,
            variationRootSeedHex: seed,
            source: "LOCAL",
            createdAt: "2026-07-24T00:00:00.000Z",
            onboarding: {
              version: 1,
              readingSpeed: "BRISK",
              captions: true,
              audioDescription: false,
              inputMethod: "KEYBOARD_MOUSE",
              archiveAssistAutoOffer: true,
              highContrast: Boolean(preferences.highContrast),
              reducedMotion: Boolean(preferences.reducedMotion),
              chaseAssist: "STANDARD",
              primersSeen,
              calibrated: true,
              completedAt: "2026-07-24T00:00:00.000Z",
            },
          });
          if (events) {
            transaction.objectStore("saves").put({
              profileId,
              chapterId,
              packageId,
              flowVersion,
              committedEvents: events,
              revision: 1,
              status: "IN_PROGRESS",
              updatedAt: "2026-07-24T00:00:00.000Z",
            });
          }
          transaction.oncomplete = () => {
            database.close();
            resolvePromise();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    },
    {
      profileId,
      displayName,
      events,
      primersSeen,
      seed: SEED,
      chapterId: CHAPTER_ID,
      packageId: PACKAGE_ID,
      flowVersion: BOSTON_DAY1_FLOW_VERSION,
      preferences,
    },
  );
}

async function openProfile(page, displayName) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  const row = page
    .locator(".profile-row, [data-profile-row], li, article, div")
    .filter({ hasText: displayName })
    .filter({ has: page.getByRole("button", { name: "Play" }) })
    .first();
  await row
    .getByRole("button", { name: "Play" })
    .first()
    .click({ timeout: 20_000 });
}

async function waitFreeRoam(page) {
  await page.waitForFunction(
    () => {
      const play = document.querySelector('[data-game-root="play"]');
      const world = document.querySelector(".world3d");
      return (
        play?.getAttribute("data-plan-request") === "FREE_ROAM" &&
        play?.getAttribute("data-field-interrupt") === "" &&
        play?.getAttribute("data-interaction-busy") === "false" &&
        world?.getAttribute("data-movement-active") === "true" &&
        typeof window.__PA_QA_TELEPORT__ === "function" &&
        typeof window.__PA_FIELD_EVENT__ === "function"
      );
    },
    null,
    { timeout: 60_000 },
  );
}

async function teleport(page, x, z, faceY) {
  await page.evaluate(
    ({ x, z, faceY }) => window.__PA_QA_TELEPORT__(x, z, faceY),
    { x, z, faceY },
  );
  await page.waitForTimeout(350);
}

async function fieldEvent(page, event) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const accepted = await page.evaluate(
      async (payload) => window.__PA_FIELD_EVENT__(payload),
      event,
    );
    if (accepted) return;
    await page.waitForTimeout(120);
  }
  throw new Error(`field event rejected: ${event.type} ${event.eventId}`);
}

async function waitAffordance(page, id, phase) {
  const selector = `[data-interaction-id="${id}"][data-interaction-phase="${phase}"]`;
  const affordance = page.locator(selector);
  await affordance.waitFor({ state: "visible", timeout: 10_000 });
  const visibleCount = await page
    .locator(
      '.interaction-affordance:visible, .interaction-action-layer:visible',
    )
    .count();
  assert(
    visibleCount === 1,
    `${id}/${phase} produced ${visibleCount} visible affordances`,
  );
  return affordance;
}

async function scenario(id, run) {
  if (ONLY.size > 0 && !ONLY.has(id)) return;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const errors = [];
  const diagnostics = [];
  const failedRequests = [];
  const successfulPaths = new Set();
  const requestPath = (url) => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  };
  page.on("pageerror", (error) => errors.push(`page: ${String(error)}`));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource:")
    ) {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("requestfailed", (request) => {
    if (!request.url().includes("/v1/health")) {
      failedRequests.push({
        url: request.url(),
        path: requestPath(request.url()),
        error: request.failure()?.errorText ?? "",
      });
    }
  });
  page.on("response", (response) => {
    if (response.status() < 400) {
      successfulPaths.add(requestPath(response.url()));
      return;
    }
    const entry = `${response.status()} ${response.url()}`;
    if (response.url().includes("/v1/health")) diagnostics.push(entry);
    else errors.push(entry);
  });
  try {
    const details = await run(page);
    await page.waitForTimeout(1200);
    const unresolvedRequests = failedRequests.filter(
      (failure) => !successfulPaths.has(failure.path),
    );
    for (const failure of failedRequests) {
      if (successfulPaths.has(failure.path)) {
        diagnostics.push(
          `recovered request: ${failure.path} ${failure.error}`,
        );
      }
    }
    errors.push(
      ...unresolvedRequests.map(
        (failure) => `request: ${failure.url} ${failure.error}`,
      ),
    );
    assert(errors.length === 0, `${id} browser errors: ${errors.join(" | ")}`);
    report.scenarios.push({ id, status: "PASS", details });
  } catch (error) {
    report.scenarios.push({ id, status: "FAIL", error: String(error) });
    report.errors.push(`${id}: ${String(error)}`, ...errors);
    await page
      .screenshot({
        path: resolve(OUT, `${id}-FAILED.png`),
        fullPage: true,
      })
      .catch(() => undefined);
  } finally {
    report.diagnostics.push(...diagnostics);
    await Promise.race([
      context.close().catch(() => undefined),
      new Promise((resolvePromise) => setTimeout(resolvePromise, 2500)),
    ]);
  }
}

await scenario("opening", async (page) => {
  await seedProfile(
    page,
    "fw2-opening",
    "FW2 Opening",
    initialStreetEvents(),
    [],
  );
  await openProfile(page, "FW2 Opening");
  await waitFreeRoam(page);
  await page.mouse.click(720, 450);
  await page.waitForFunction(() => window.__paAmbientAudio?.ready === true, null, {
    timeout: 30_000,
  });
  const audioBefore = await page.evaluate(() => window.__paAmbientAudio);
  assert(audioBefore.muted === false, "audio did not default on");
  const bearing = page.locator(".quest-bearing");
  await bearing.waitFor({ state: "visible", timeout: 10_000 });
  const bearingState = await page.locator(".quest-hud").evaluate((element) => ({
    label: element.getAttribute("data-quest-bearing"),
    distance: element.getAttribute("data-quest-distance"),
  }));
  assert(bearingState.label, "persistent target bearing had no direction");
  await screenshot(page, "p1-20", "camera-relative-target-bearing");

  await page.keyboard.down("KeyW");
  await page.waitForTimeout(1800);
  await page.keyboard.up("KeyW");
  await page.waitForFunction(
    () => {
      const plays = window.__paAmbientAudio?.identity?.plays ?? {};
      return (
        (plays["footstep-stone-1"] ?? 0) +
          (plays["footstep-stone-2"] ?? 0) >
        0
      );
    },
    null,
    { timeout: 5000 },
  );
  const audioAfter = await page.evaluate(() => window.__paAmbientAudio);
  for (const name of [
    "footstep-stone-1",
    "footstep-stone-2",
    "footstep-wood-1",
    "footstep-wood-2",
  ]) {
    assert(
      audioAfter.identity.loaded.includes(name),
      `identity audio did not decode ${name}`,
    );
  }
  await screenshot(page, "p1-22", "default-on-footstep-audio");

  await teleport(page, 9.2, 9.1, Math.PI);
  assert(
    !(await page
      .getByRole("button", { name: /Talk to Ned/i })
      .isVisible()
      .catch(() => false)),
    "Ned's gated interaction leaked before Mercer",
  );
  await screenshot(page, "p1-13", "notice-reader-before-ned-unlocks");

  await teleport(page, -0.31, 10.61, 0);
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-game-root="play"]')
        ?.getAttribute("data-plan-request") === "CHOICE",
    null,
    { timeout: 30_000 },
  );
  for (const name of [
    /Knock first/,
    /Walk straight in/,
    /Look through the window first/,
  ]) {
    await page.getByRole("button", { name }).waitFor({ state: "visible" });
  }
  const taglines = await page
    .locator(".choice-panel .choice-subtext")
    .allTextContents();
  assert(
    taglines.length === 3 &&
      new Set(taglines.map((value) => value.trim())).size === 3,
    `Mercer choices lacked distinct stakes: ${JSON.stringify(taglines)}`,
  );
  assert(
    (await page.getByRole("button", { name: "ACKNOWLEDGE" }).count()) === 0,
    "blocking first-use primer returned",
  );
  assert(
    (await page.locator(".first-use-hint").count()) <= 1,
    "first-use hints stacked",
  );
  await screenshot(page, "p1-11", "nonblocking-entry-stake-tags");
  await page.getByRole("button", { name: /Knock first/ }).click();
  const receipt = page.locator(".ambient-subtitle.route-reminder", {
    hasText: "Knocked first",
  });
  await receipt.waitFor({ state: "visible", timeout: 30_000 });
  assert(
    (await page.locator(".ambient-subtitle.route-reminder").count()) === 1,
    "entry resolution emitted more than one consequence receipt",
  );
  await screenshot(page, "p2-stakes", "entry-consequence-receipt");
  return {
    bearingState,
    audio: audioAfter.identity,
    taglines,
    receipt: await receipt.textContent(),
  };
});

await scenario("collision-slide", async (page) => {
  const events = [...postMercerSession().committedEvents];
  await seedProfile(
    page,
    "fw2-collision",
    "FW2 Collision",
    events,
    ["ARCHIVE", "MOVEMENT", "READ", "WORK", "CHOICE"],
  );
  await openProfile(page, "FW2 Collision");
  await waitFreeRoam(page);
  await teleport(page, 33, 8.5, 0);
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(850);
  await page.keyboard.up("KeyW");
  const before = await page.locator(".world3d").evaluate((element) => ({
    pos: element.dataset.playerPos3d.split(",").map(Number),
    blocked: element.dataset.playerBlocked,
  }));
  await page.keyboard.down("KeyW");
  await page.keyboard.down("KeyD");
  await page.keyboard.down("ShiftLeft");
  await page.waitForTimeout(1200);
  await page.keyboard.up("ShiftLeft");
  await page.keyboard.up("KeyD");
  await page.keyboard.up("KeyW");
  const after = await page.locator(".world3d").evaluate((element) => ({
    pos: element.dataset.playerPos3d.split(",").map(Number),
    blocked: element.dataset.playerBlocked,
  }));
  const tangent = Math.abs(after.pos[0] - before.pos[0]);
  assert(tangent > 0.8, `diagonal wall contact dead-stopped: ${tangent}`);
  await screenshot(page, "p1-4", "diagonal-facade-slide");
  return { before, after, tangent };
});

await scenario("suspicion-drain", async (page) => {
  const events = [...postMercerSession().committedEvents];
  await seedProfile(
    page,
    "fw2-suspicion",
    "FW2 Suspicion",
    events,
    ["ARCHIVE", "MOVEMENT", "READ", "WORK", "CHOICE"],
  );
  await openProfile(page, "FW2 Suspicion");
  await waitFreeRoam(page);
  await page.waitForFunction(
    () => typeof window.__PA_QA_SUSPICION__ === "function",
    null,
    { timeout: 10_000 },
  );
  assert(
    await page.evaluate(() => window.__PA_QA_SUSPICION__(0.52)),
    "could not stage accrued watcher attention",
  );
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector(".world3d")?.getAttribute("data-max-suspicion"),
      ) >= 0.35,
    null,
    { timeout: 3000 },
  );
  const accrued = Number(
    await page.locator(".world3d").getAttribute("data-max-suspicion"),
  );
  assert(
    accrued >= 0.35 && accrued < 0.7,
    `could not establish sub-alert suspicion: ${accrued}`,
  );
  assert(
    (await page
      .locator('[data-game-root="play"]')
      .getAttribute("data-field-interrupt")) === "",
    "suspicion challenged before the scripted exchange",
  );
  await teleport(page, -53, 4, Math.PI);
  await fieldEvent(page, {
    type: "FIELD_INTERRUPT_STARTED",
    eventId: "FW2_SUSPICION_SARAH_START",
    interruptId: "FW2_SUSPICION_SARAH",
    interruptKind: "REACTIVE_EXCHANGE",
    sourceId: "THR-sarah",
  });
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector(".world3d")?.getAttribute("data-max-suspicion"),
      ) <= 0.15,
    null,
    { timeout: 4000 },
  );
  const drained = Number(
    await page.locator(".world3d").getAttribute("data-max-suspicion"),
  );
  assert(
    (await page
      .locator('[data-game-root="play"]')
      .getAttribute("data-field-interrupt")) === "REACTIVE_EXCHANGE",
    "watcher displaced Sarah's exchange while suspicion drained",
  );
  await screenshot(page, "p1-5", "sarah-exchange-drains-suspicion");
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-game-root="play"]')
        ?.getAttribute("data-field-interrupt") === "",
    null,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(1500);
  assert(
    (await page
      .locator('[data-game-root="play"]')
      .getAttribute("data-field-interrupt")) === "",
    "a stale watcher challenge fired after the harmless exchange",
  );
  await screenshot(page, "p1-5", "no-stale-challenge-after-sarah");
  return { accrued, drained };
});

await scenario("noticeboard-los-probe", async (page) => {
  const events = [...postMercerSession().committedEvents];
  await seedProfile(
    page,
    "fw2-noticeboard",
    "FW2 Noticeboard",
    events,
    ["ARCHIVE", "MOVEMENT", "READ", "WORK", "CHOICE"],
  );
  await openProfile(page, "FW2 Noticeboard");
  await waitFreeRoam(page);
  await teleport(page, 6.35, 6.55, 0);
  await page.waitForFunction(
    () => typeof window.__PA_QA_INTERACTIONS__ === "function",
  );
  const diagnostics = await page.evaluate(() => window.__PA_QA_INTERACTIONS__());
  const stamp = diagnostics.candidates.find(
    (candidate) => candidate.id === "M4:KN-noticeboard-stamp",
  );
  assert(stamp, `stamp candidate missing: ${JSON.stringify(diagnostics)}`);
  assert(
    stamp.occluders.length === 0,
    `noticeboard owner still occluded its paper: ${JSON.stringify(stamp)}`,
  );
  return { stamp };
});

await scenario("flavor-dog", async (page) => {
  const events = [...postMercerSession().committedEvents];
  await seedProfile(
    page,
    "fw2-dog",
    "FW2 Dog",
    events,
    ["ARCHIVE", "MOVEMENT", "READ", "WORK", "CHOICE"],
  );
  await openProfile(page, "FW2 Dog");
  await waitFreeRoam(page);
  await teleport(page, -30.2, 7.2, 0);
  let action;
  try {
    action = await waitAffordance(page, "M4:FLV-dog", "ACTION");
  } catch (error) {
    const diagnostics = await page.evaluate(() =>
      window.__PA_QA_INTERACTIONS__?.(),
    );
    throw new Error(`${String(error)} ${JSON.stringify(diagnostics)}`);
  }
  await screenshot(
    page,
    "interaction-presentation",
    "19-dog-action-near-facade",
  );
  await action.getByRole("button").click();
  await page
    .locator(".ambient-subtitle")
    .filter({ hasText: /dog/i })
    .waitFor({ state: "visible", timeout: 5000 });
  await screenshot(
    page,
    "interaction-presentation",
    "20-dog-reaction",
  );
  return { activated: true };
});

await scenario("interaction-presentation", async (page) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const events = [...postMercerSession().committedEvents];
  await seedProfile(
    page,
    "fw2-presentation",
    "FW2 Presentation",
    events,
    ["ARCHIVE", "MOVEMENT", "READ", "WORK", "CHOICE"],
  );
  await openProfile(page, "FW2 Presentation");
  await waitFreeRoam(page);

  // Thread figure: all three ranges, one target only.
  await teleport(page, -50, 3.3, Math.PI);
  await waitAffordance(page, "THREAD:SARAH", "DISCOVERY");
  await screenshot(
    page,
    "interaction-presentation",
    "01-sarah-discovery-range",
  );
  await teleport(page, -50, -0.7, Math.PI);
  await waitAffordance(page, "THREAD:SARAH", "APPROACH");
  await screenshot(
    page,
    "interaction-presentation",
    "02-sarah-approach-range",
  );
  await teleport(page, -50, -3.2, Math.PI);
  const sarahAction = await waitAffordance(
    page,
    "THREAD:SARAH",
    "ACTION",
  );
  await screenshot(
    page,
    "interaction-presentation",
    "03-sarah-action-range",
  );
  await sarahAction.getByRole("button").click();
  const sarahDialog = page.getByRole("dialog", {
    name: "Goodwife Sarah // The Wharf Widow",
  });
  await sarahDialog.waitFor({ state: "visible", timeout: 10_000 });
  assert(
    (await page
      .locator(
        '.interaction-affordance:visible, .interaction-action-layer:visible',
      )
      .count()) === 0,
    "affordance remained over blocking Sarah dialogue",
  );
  const dialogueReadability = await sarahDialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const body = element.querySelector("p");
    return {
      width: rect.width,
      right: rect.right,
      bottom: rect.bottom,
      bodyFontPx: Number.parseFloat(
        body ? getComputedStyle(body).fontSize : "0",
      ),
      bodyLineHeightPx: Number.parseFloat(
        body ? getComputedStyle(body).lineHeight : "0",
      ),
    };
  });
  assert(
    dialogueReadability.width >= 500 &&
      dialogueReadability.right <= 1280 &&
      dialogueReadability.bottom <= 800 &&
      dialogueReadability.bodyFontPx >= 17 &&
      dialogueReadability.bodyLineHeightPx >= 24,
    `Sarah dialogue was not readable: ${JSON.stringify(dialogueReadability)}`,
  );
  await screenshot(
    page,
    "interaction-presentation",
    "04-sarah-readable-dialogue",
  );
  await sarahDialog
    .getByRole("button", { name: /Help with the stall/i })
    .click();
  await sarahDialog
    .getByRole("button", { name: /Continue/i })
    .waitFor({ state: "visible", timeout: 5000 });
  await screenshot(
    page,
    "interaction-presentation",
    "05-sarah-response-waits",
  );
  await sarahDialog.getByRole("button", { name: /Continue/i }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-game-root="play"]')
        ?.getAttribute("data-field-interrupt") === "",
  );

  // Named cast: resolve Pike from his live deterministic route, then use the
  // same fixed action grammar and readable response panel.
  await teleport(page, 40, 4, Math.PI / 2);
  await fieldEvent(page, {
    type: "FIELD_INTERRUPT_STARTED",
    eventId: "FW2_PRESENTATION_PIKE_START",
    interruptId: "FW2_PRESENTATION_PIKE",
    interruptKind: "REACTIVE_EXCHANGE",
    sourceId: "NPC-pike",
  });
  await screenshot(
    page,
    "interaction-presentation",
    "06-named-pike-staged",
  );
  const pikeDialog = page.getByRole("dialog", { name: "Mr. Pike" });
  await pikeDialog.waitFor({ state: "visible", timeout: 10_000 });
  await screenshot(
    page,
    "interaction-presentation",
    "07-named-pike-dialogue",
  );
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-game-root="play"]')
        ?.getAttribute("data-field-interrupt") === "",
  );

  // Job giver: visible from discovery range, then fixed Help action.
  await teleport(page, -134, 11, Math.PI);
  await waitAffordance(
    page,
    "SIDE_JOB:DOCK:AVAILABLE",
    "DISCOVERY",
  );
  await screenshot(
    page,
    "interaction-presentation",
    "08-dockhand-discovery",
  );
  await teleport(page, -134, 4.5, Math.PI);
  await waitAffordance(page, "SIDE_JOB:DOCK:AVAILABLE", "ACTION");
  await screenshot(
    page,
    "interaction-presentation",
    "09-dockhand-action",
  );

  // A wall-mounted source never advertises through its building. The same
  // authored target appears immediately from the street-facing side.
  await teleport(page, -21.4, -15, 0);
  await page.waitForTimeout(500);
  assert(
    (await page.locator('[data-interaction-id="M4:KN-sign-tavern"]').count()) ===
      0,
    "tavern sign affordance leaked through the wall",
  );
  await screenshot(
    page,
    "interaction-presentation",
    "10-no-prompt-through-wall",
  );
  await teleport(page, -21.4, -6.75, Math.PI);
  await waitAffordance(page, "M4:KN-sign-tavern", "APPROACH");
  await screenshot(
    page,
    "interaction-presentation",
    "11-sign-approach-visible",
  );
  await teleport(page, -21.4, -9.15, Math.PI);
  const sourceAction = await waitAffordance(
    page,
    "M4:KN-sign-tavern",
    "ACTION",
  );
  await sourceAction.getByRole("button").click();
  const sourceDialog = page.getByRole("dialog", {
    name: "Bunch of Grapes sign",
  });
  await sourceDialog.waitFor({ state: "visible", timeout: 10_000 });
  assert(
    (await sourceDialog.locator(".exchange-source-card img").getAttribute(
      "src",
    )) === "/world/posters/sign-tavern-grapes.png",
    "source panel did not reuse the sign texture",
  );
  await screenshot(
    page,
    "interaction-presentation",
    "12-source-visual-provenance",
  );
  await sourceDialog
    .getByRole("button", { name: /Finish reading/i })
    .click();
  await sourceDialog
    .getByRole("button", { name: /Continue/i })
    .waitFor({ state: "visible", timeout: 5000 });
  await screenshot(
    page,
    "interaction-presentation",
    "13-source-meaning-feedback",
  );
  await sourceDialog.getByRole("button", { name: /Continue/i }).click();

  // Small interior artifact/hotspot uses the same fixed action phase and
  // suppresses all tags while its provenance card owns the screen.
  await page.evaluate(() =>
    window.__PA_QA_INTERIOR__("MERCER_PRESS", "CENTER"),
  );
  await page.waitForFunction(
    () =>
      document.querySelector(".world3d")?.getAttribute("data-interior-id") ===
      "MERCER_PRESS",
  );
  await page.evaluate(() =>
    window.__PA_QA_TELEPORT__(633.8, 640.1, Math.PI / 2),
  );
  const inspectAction = page.locator(
    '[data-interaction-id^="INTERIOR_INSPECT:"][data-interaction-phase="ACTION"]',
  );
  await inspectAction.waitFor({ state: "visible", timeout: 10_000 });
  await screenshot(
    page,
    "interaction-presentation",
    "14-interior-hotspot-action",
  );
  await inspectAction.getByRole("button").click();
  const inspectCard = page.locator(".context-inspect-card");
  await inspectCard.waitFor({ state: "visible", timeout: 10_000 });
  assert(
    (await page
      .locator(
        '.interaction-affordance:visible, .interaction-action-layer:visible',
      )
      .count()) === 0,
    "hotspot affordance remained over inspect card",
  );
  await screenshot(
    page,
    "interaction-presentation",
    "15-interior-hotspot-provenance",
  );
  await inspectCard
    .getByRole("button", { name: /Return to the room/i })
    .evaluate((element) => element.click());
  return { dialogueReadability };
});

await scenario("interaction-mobile", async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const events = [...postMercerSession().committedEvents];
  await seedProfile(
    page,
    "fw2-mobile",
    "FW2 Mobile",
    events,
    ["ARCHIVE", "MOVEMENT", "READ", "WORK", "CHOICE"],
    { highContrast: true, reducedMotion: true },
  );
  await openProfile(page, "FW2 Mobile");
  await waitFreeRoam(page);
  await teleport(page, -50, -3.2, Math.PI);
  const action = await waitAffordance(page, "THREAD:SARAH", "ACTION");
  assert(
    (await action.getAttribute("class")).includes("high-contrast") &&
      (await action.getAttribute("class")).includes("reduced-motion"),
    "mobile action lost accessibility presentation",
  );
  const actionRect = await action.getByRole("button").boundingBox();
  assert(
    actionRect &&
      actionRect.width <= 390 &&
      actionRect.height >= 48 &&
      actionRect.y + actionRect.height <= 844,
    `mobile action escaped viewport: ${JSON.stringify(actionRect)}`,
  );
  await screenshot(
    page,
    "interaction-presentation",
    "16-mobile-high-contrast-action",
  );
  await action.getByRole("button").click();
  const dialog = page.getByRole("dialog", {
    name: "Goodwife Sarah // The Wharf Widow",
  });
  await dialog.waitFor({ state: "visible", timeout: 10_000 });
  const dialogRect = await dialog.boundingBox();
  assert(
    dialogRect &&
      dialogRect.width <= 390 &&
      dialogRect.height <= 844 &&
      dialogRect.x >= 0 &&
      dialogRect.y >= 0,
    `mobile dialogue escaped viewport: ${JSON.stringify(dialogRect)}`,
  );
  await screenshot(
    page,
    "interaction-presentation",
    "17-mobile-touch-dialogue",
  );
  await dialog.getByRole("button", { name: /Sorry, running/i }).click();
  await dialog
    .getByRole("button", { name: /Continue/i })
    .waitFor({ state: "visible", timeout: 5000 });
  await screenshot(
    page,
    "interaction-presentation",
    "18-mobile-response-continue",
  );
  await dialog.getByRole("button", { name: /Continue/i }).click();
  return { actionRect, dialogRect };
});

await scenario("dock-payoff", async (page) => {
  await seedProfile(
    page,
    "fw2-dock",
    "FW2 Dock",
    dockReadyEvents(),
    ["ARCHIVE", "MOVEMENT", "READ", "WORK", "CHOICE"],
  );
  await openProfile(page, "FW2 Dock");
  await waitFreeRoam(page);
  await page.mouse.click(720, 450);
  await page.waitForFunction(() => window.__paAmbientAudio?.ready === true, null, {
    timeout: 30_000,
  });
  await teleport(page, -140, 14.6, 0);
  await page.waitForFunction(
    () =>
      (
        document
          .querySelector('[data-game-root="play"]')
          ?.getAttribute("data-carried-object-ids") ?? ""
      ).includes("DOCK_BARREL"),
    null,
    { timeout: 10_000 },
  );
  await page
    .locator(
      '.interaction-action-layer[data-interaction-id^="SIDE_JOB:DOCK"] button',
    )
    .waitFor({ state: "visible", timeout: 10_000 });
  await screenshot(page, "p1-15", "barrel-held-in-both-hands");
  await page.keyboard.press("KeyF");
  const dialog = page.getByRole("dialog", { name: "Dock haul // Set down" });
  await dialog.waitFor({ state: "visible", timeout: 10_000 });
  const startedAt = await page.evaluate(() => performance.now());
  await dialog
    .getByRole("button", { name: /Set down the barrel/i })
    .click();
  const receipt = dialog.locator(".exchange-completion-receipt");
  await receipt.waitFor({ state: "visible", timeout: 5000 });
  const commitMs = await page.evaluate(
    (start) => performance.now() - start,
    startedAt,
  );
  assert(
    commitMs < 2500,
    `interrupt commit stalled for ${commitMs.toFixed(1)}ms`,
  );
  assert(
    (await dialog.locator(".exchange-effect-chips").count()) === 0,
    "five-chip completion pile returned",
  );
  await page.waitForFunction(
    () =>
      !(
        document
          .querySelector('[data-game-root="play"]')
          ?.getAttribute("data-carried-object-ids") ?? ""
      ).includes("DOCK_BARREL"),
    null,
    { timeout: 5000 },
  );
  const audio = await page.evaluate(() => window.__paAmbientAudio);
  assert(
    (audio.identity.plays["coin-clink"] ?? 0) > 0,
    "dock completion sting did not fire",
  );
  await screenshot(page, "p1-19", "single-dock-consequence-receipt");
  await screenshot(page, "p1-21", "interrupt-commit-without-stall");
  await page.waitForTimeout(1100);
  await screenshot(page, "p1-15", "single-barrel-resting-on-deck");
  await dialog.getByRole("button", { name: /Continue/i }).click();
  return { commitMs, audio: audio.identity };
});

writeFileSync(
  resolve(OUT, "focused-report.json"),
  JSON.stringify(report, null, 2),
);
await closeBrowser();
const failed = report.scenarios.filter((scenario) => scenario.status !== "PASS");
assert(
  failed.length === 0 && report.errors.length === 0,
  `Wave 2 focused QA failed: ${JSON.stringify({ failed, errors: report.errors })}`,
);
console.log(
  "FIXWAVE2_FOCUSED_QA_PASS",
  JSON.stringify({
    scenarios: report.scenarios.map((scenario) => scenario.id),
    screenshots: report.screenshots.length,
  }),
);
process.exit(0);
