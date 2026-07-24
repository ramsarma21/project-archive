import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BOSTON_DAY1_FLOW_VERSION,
  CHAPTER_ID,
  PACKAGE_ID,
} from "../../packages/chapter-boston/src/index.ts";

const BASE_URL = process.env.DESIGN2_E2E_URL ?? "http://127.0.0.1:4912/";
const OUT = resolve(
  process.env.DESIGN2_E2E_OUT ?? "test-results/design2/e2e-continuous",
);
const STOP_AFTER = process.env.DESIGN2_E2E_STOP_AFTER ?? "";
const RESUME = process.env.DESIGN2_E2E_RESUME === "1";
const EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(OUT, { recursive: true });

const report = {
  baseUrl: BASE_URL,
  startedAt: new Date().toISOString(),
  steps: [],
  arrivalTelemetry: [],
  featureChecks: {
    pressQuality: false,
    stakeReceipt: false,
    nedWager: false,
    nedCallback: false,
    typesetArtifact: false,
    mapCompass: false,
    saveResume: false,
    confrontationChase: false,
    effigy: false,
    crier: false,
    cp1Rationales: 0,
    actComplete: false,
  },
  screenshots: [],
  errors: [],
  assetFailures: [],
  networkFailures: [],
};

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function evaluateStable(page, fn, argument) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await page.evaluate(fn, argument);
    } catch (error) {
      if (
        attempt === 2 ||
        !String(error).includes("Execution context was destroyed")
      ) {
        throw error;
      }
      await page.waitForLoadState("domcontentloaded");
    }
  }
}

async function screenshot(page, name) {
  const path = resolve(OUT, `${name}.png`);
  const buffer = await page.screenshot({ path });
  const pixels = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    let nonBlack = 0;
    let samples = 0;
    for (let index = 0; index < data.length; index += 32) {
      const luma =
        0.2126 * data[index] +
        0.7152 * data[index + 1] +
        0.0722 * data[index + 2];
      sum += luma;
      if (luma > 18) nonBlack += 1;
      samples += 1;
    }
    return { meanLuma: sum / samples, nonBlackRatio: nonBlack / samples };
  }, buffer.toString("base64"));
  assert(
    pixels.meanLuma >= 5 && pixels.nonBlackRatio >= 0.04,
    `${name} rendered black: ${JSON.stringify(pixels)}`,
  );
  report.screenshots.push({ name, path, ...pixels });
}

async function seedFreshProfile(page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() =>
    document.body.textContent?.includes("Project Archive"),
  );
  if (RESUME) {
    const row = page.locator(".obj", { hasText: "Design 2 Continuous" });
    await row.getByRole("button", { name: "Play" }).click();
    await page.waitForSelector(
      '[data-game-root="play"][data-runtime-ready="true"]',
      { timeout: 60_000 },
    );
    return;
  }
  await evaluateStable(
    page,
    async ({ chapterId, packageId, flowVersion }) => {
      const profileId = "design2-continuous";
      const request = indexedDB.open("project-archive");
      await new Promise((resolvePromise, reject) => {
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const tx = database.transaction(["profiles", "saves"], "readwrite");
          tx.objectStore("profiles").put({
            profileId,
            accountId: `local:${profileId}`,
            displayName: "Design 2 Continuous",
            variationRootSeedHex: "d2".repeat(32),
            source: "LOCAL",
            createdAt: "2026-07-24T00:00:00.000Z",
            onboarding: {
              version: 1,
              readingSpeed: "BRISK",
              captions: true,
              audioDescription: false,
              inputMethod: "KEYBOARD_MOUSE",
              archiveAssistAutoOffer: false,
              highContrast: false,
              reducedMotion: false,
              chaseAssist: "AUTO_STAMINA",
              primersSeen: ["ARCHIVE", "MOVEMENT", "READ", "WORK", "CHOICE"],
              calibrated: true,
              completedAt: "2026-07-24T00:00:00.000Z",
            },
          });
          tx.objectStore("saves").delete(profileId);
          tx.oncomplete = () => {
            database.close();
            resolvePromise();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
      void chapterId;
      void packageId;
      void flowVersion;
    },
    {
      chapterId: CHAPTER_ID,
      packageId: PACKAGE_ID,
      flowVersion: BOSTON_DAY1_FLOW_VERSION,
    },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Play" }).first().click();
  await page.waitForSelector(
    '[data-game-root="play"][data-runtime-ready="true"]',
    { timeout: 60_000 },
  );
}

async function state(page) {
  return page.evaluate(() => {
    const play = document.querySelector('[data-game-root="play"]');
    const world = document.querySelector(".world3d");
    const copy = (element) =>
      Object.fromEntries(
        [...element.attributes]
          .filter((attribute) => attribute.name.startsWith("data-"))
          .map((attribute) => [attribute.name, attribute.value]),
      );
    return {
      play: play ? copy(play) : {},
      world: world ? copy(world) : {},
      body: document.body.innerText.slice(-1200),
    };
  });
}

async function waitUnblocked(page) {
  await page.waitForFunction(
    () => {
      const play = document.querySelector('[data-game-root="play"]');
      const world = document.querySelector(".world3d");
      return (
        play?.getAttribute("data-interaction-busy") === "false" &&
        play?.getAttribute("data-choreography-ready") === "true" &&
        world?.getAttribute("data-player-input-locked") === "false"
      );
    },
    null,
    { timeout: 60_000 },
  );
}

async function waitPlanAdvance(page, request, cue, timeout = 45_000) {
  await page.waitForFunction(
    ({ request, cue }) => {
      const play = document.querySelector('[data-game-root="play"]');
      const world = document.querySelector(".world3d");
      return (
        play?.getAttribute("data-plan-request") !== request ||
        world?.getAttribute("data-cue-id") !== cue
      );
    },
    { request, cue },
    { timeout },
  );
}

async function walkSegment(page, point, allowPlanAdvance, sprint = true) {
  const root = page.locator('[data-game-root="play"]');
  const beforeKind = await root.getAttribute("data-plan-request");
  const beforeState = await state(page);
  const beforePosition = beforeState.world["data-player-pos3d"]
    .split(",")
    .map(Number);
  const distance = Math.hypot(
    point[0] - beforePosition[0],
    point[1] - beforePosition[2],
  );
  const maxSamples = Math.max(200, Math.ceil((distance / 1.0) * 8) + 160);
  await page.evaluate(
    ({ x, z, sprint }) => window.__PA_QA_WALK_TO__(x, z, sprint),
    { x: point[0], z: point[1], sprint },
  );
  await page.waitForFunction(
    ({ point, beforeKind }) => {
      const world = document.querySelector(".world3d");
      const play = document.querySelector('[data-game-root="play"]');
      const player = (world?.getAttribute("data-player-pos3d") ?? "")
        .split(",")
        .map(Number);
      return (
        Boolean(world?.getAttribute("data-qa-walk-target")) ||
        play?.getAttribute("data-plan-request") !== beforeKind ||
        (player.length === 3 &&
          Math.hypot(point[0] - player[0], point[1] - player[2]) <= 0.3)
      );
    },
    { point, beforeKind },
    { timeout: 3_000 },
  );
  let blockedSamples = 0;
  for (let sample = 0; sample < maxSamples; sample += 1) {
    await page.waitForTimeout(125);
    const current = await state(page);
    if (report.arrivalTelemetry.length < 700) {
      report.arrivalTelemetry.push({
        at: performance.now(),
        request: current.play["data-plan-request"],
        cue: current.world["data-cue-id"],
        choreographyReady: current.play["data-choreography-ready"],
        interactionBusy: current.play["data-interaction-busy"],
        player: current.world["data-player-pos3d"],
        movementIntent: current.world["data-player-movement-intent"],
        blocked: current.world["data-player-blocked"],
        marker: current.world["data-quest-active-id"],
        markerState: current.world["data-quest-state"],
        questArrivalAnchor: current.world["data-quest-arrival-anchor"],
        arrivalPhase: current.world["data-arrival-phase"],
        arrivalBusy: current.world["data-arrival-busy"],
        arrivalSelected: current.world["data-arrival-selected-id"],
        arrivalTarget: current.world["data-arrival-target-id"],
        arrivalAnchor: current.world["data-arrival-anchor"],
        arrivalDistance: current.world["data-arrival-distance"],
        arrivalInside: current.world["data-arrival-inside"],
        arrivalDwellMs: current.world["data-arrival-dwell-ms"],
        arrivalSinceSelectionMs:
          current.world["data-arrival-since-selection-ms"],
        arrivalReady: current.world["data-arrival-ready"],
        arrivalInFlight: current.world["data-arrival-in-flight-key"],
        arrivalFired: current.world["data-arrival-fired-key"],
        qaWalkTarget: current.world["data-qa-walk-target"],
      });
    }
    if (
      allowPlanAdvance &&
      current.play["data-plan-request"] !== beforeKind
    ) {
      return "ADVANCED";
    }
    if (current.play["data-field-interrupt"]) return "INTERRUPTED";
    if (!current.world["data-qa-walk-target"]) return "ARRIVED";
    blockedSamples =
      current.world["data-player-blocked"] === "true"
        ? blockedSamples + 1
        : 0;
    if (blockedSamples >= 18) return "BLOCKED";
  }
  throw new Error(
    `walk segment timed out at ${point.join(",")}: ${JSON.stringify(
      await state(page),
    )}`,
  );
}

async function walkToResolvedArrival(page) {
  const root = page.locator('[data-game-root="play"]');
  await page.waitForFunction(
    () =>
      typeof window.__PA_QA_WALK_TO__ === "function" &&
      document.querySelector(".world3d canvas"),
    null,
    { timeout: 60_000 },
  );
  await waitUnblocked(page);
  await page.waitForFunction(
    () => {
      const world = document.querySelector(".world3d");
      return (
        Boolean(world?.getAttribute("data-quest-arrival-anchor")) ||
        Boolean(document.querySelector(".choice-panel .choice:not([disabled])"))
      );
    },
    null,
    { timeout: 45_000 },
  );
  const cards = page.locator(".choice-panel .choice:not([disabled])");
  let worldState = await state(page);
  if (!worldState.world["data-quest-arrival-anchor"] && (await cards.count())) {
    await cards.first().click();
    await page.waitForFunction(
      () =>
        Boolean(
          document
            .querySelector(".world3d")
            ?.getAttribute("data-quest-arrival-anchor"),
        ),
      null,
      { timeout: 30_000 },
    );
    worldState = await state(page);
  }
  const anchor = worldState.world["data-quest-arrival-anchor"]
    .split(",")
    .map(Number);
  const player = worldState.world["data-player-pos3d"].split(",").map(Number);
  assert(
    anchor.length === 3 && anchor.every(Number.isFinite),
    `invalid resolved arrival anchor: ${worldState.world["data-quest-arrival-anchor"]}`,
  );
  const interior = Boolean(worldState.world["data-interior-id"]);
  if (
    !interior &&
    worldState.world["data-quest-active-id"] === "CROWD" &&
    player[0] < 80
  ) {
    const beforeGate = await walkSegment(page, [77, 0], true);
    if (beforeGate === "ADVANCED" || beforeGate === "INTERRUPTED") return;
    if (beforeGate !== "ARRIVED") {
      throw new Error(`could not reach east gate approach: ${beforeGate}`);
    }
    const throughGate = await walkSegment(page, [83, 0], true, false);
    if (throughGate === "ADVANCED" || throughGate === "INTERRUPTED") return;
    if (throughGate !== "ARRIVED") {
      throw new Error(
        `could not cross east gate: ${throughGate} ${JSON.stringify(await state(page))}`,
      );
    }
  }
  if (!interior && Math.hypot(anchor[0] - player[0], anchor[2] - player[2]) > 8) {
    // Use the open street spine as a real route waypoint, then turn into the
    // current manifest arrival anchor. Both legs use normal collision motion.
    const spine = [anchor[0], 5];
    let spineResult = await walkSegment(page, spine, true);
    if (spineResult === "ADVANCED" || spineResult === "INTERRUPTED") return;
    if (spineResult === "BLOCKED") {
      for (const offset of [6, -12, 18, -24]) {
        const current = (await state(page)).world["data-player-pos3d"]
          .split(",")
          .map(Number);
        const detour = await walkSegment(
          page,
          [current[0], current[2] + offset],
          true,
        );
        if (detour === "ADVANCED" || detour === "INTERRUPTED") return;
        if (detour !== "ARRIVED") continue;
        spineResult = await walkSegment(page, spine, true);
        if (spineResult === "ADVANCED" || spineResult === "INTERRUPTED") return;
        if (spineResult === "ARRIVED") break;
      }
      if (spineResult === "BLOCKED") {
        throw new Error(
          `street route blocked before ${worldState.world["data-quest-active-id"]}: ${JSON.stringify(await state(page))}`,
        );
      }
    }
  }
  let result = await walkSegment(
    page,
    [anchor[0], anchor[2]],
    true,
    false,
  );
  if (result === "INTERRUPTED") return;
  if (result === "BLOCKED") {
    for (const scale of [3.5, -7, 10.5, -14]) {
      const current = (await state(page)).world["data-player-pos3d"]
        .split(",")
        .map(Number);
      const dx = anchor[0] - current[0];
      const dz = anchor[2] - current[2];
      const length = Math.hypot(dx, dz) || 1;
      const detour = [
        current[0] - (dz / length) * scale,
        current[2] + (dx / length) * scale,
      ];
      const detourResult = await walkSegment(page, detour, true);
      if (detourResult === "ADVANCED" || detourResult === "INTERRUPTED") return;
      if (detourResult !== "ARRIVED") continue;
      result = await walkSegment(
        page,
        [anchor[0], anchor[2]],
        true,
        false,
      );
      if (result !== "BLOCKED") break;
    }
  }
  if (result === "BLOCKED") {
    throw new Error(
      `arrival approach blocked before ${worldState.world["data-quest-active-id"]}: ${JSON.stringify(await state(page))}`,
    );
  }
  await page.waitForFunction(
    (kind) =>
      document
        .querySelector('[data-game-root="play"]')
        ?.getAttribute("data-plan-request") !== kind,
    await root.getAttribute("data-plan-request"),
    { timeout: 30_000 },
  ).catch(() => {});
}

async function hold(page, locator, duration = 1250) {
  await locator.waitFor({ state: "visible", timeout: 45_000 });
  const box = await locator.boundingBox();
  assert(box, "hold control had no bounds");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(duration);
  await page.mouse.up();
}

async function waitTiming(page, label) {
  await page.waitForFunction(
    (name) =>
      Number(
        document
          .querySelector(`[role="meter"][aria-label="${name}"]`)
          ?.getAttribute("aria-valuenow") ?? 0,
      ) >= 90,
    label,
    { timeout: 10_000 },
  );
}

async function completePrint(page) {
  const catchButton = page.getByRole("button", { name: /CATCH NOW/i });
  await catchButton.waitFor({ state: "visible", timeout: 45_000 });
  await waitTiming(page, "catch timing");
  await catchButton.click();
  for (const name of [/DAUB LEFT/i, /DAUB RIGHT/i, /DAUB LEFT/i, /DAUB RIGHT/i]) {
    await page.waitForTimeout(500);
    await page.getByRole("button", { name }).click();
  }
  await page.locator('input[aria-label="register alignment"]').evaluate(
    (element) => {
      element.value = "50";
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    },
  );
  await page.getByRole("button", { name: /SET REGISTER/i }).click();
  await waitTiming(page, "pull timing");
  await page.getByRole("button", { name: /DROP THE BAR/i }).click();
  await hold(page, page.getByRole("button", { name: /HOLD TO PEEL/i }), 1250);
}

async function completeMechanic(page) {
  const shell = page.locator(".mechanic-shell");
  await shell.waitFor({ state: "visible", timeout: 45_000 });
  if (await page.getByRole("button", { name: /CATCH NOW/i }).count()) {
    await completePrint(page);
    report.featureChecks.pressQuality = true;
    return;
  }
  if (await page.getByRole("button", { name: /HOLD TO (LOAD|BALANCE|THREAD)/i }).count()) {
    for (let index = 0; index < 3; index += 1) {
      const button = page
        .getByRole("button", { name: /HOLD TO (LOAD|BALANCE|THREAD)/i })
        .first();
      if (!(await button.count())) break;
      await hold(page, button, 1250);
      await page.waitForTimeout(160);
    }
    return;
  }
  if (await page.getByRole("button", { name: /HOLD TO STEADY/i }).count()) {
    await hold(page, page.getByRole("button", { name: /HOLD TO STEADY/i }), 1300);
    return;
  }
  if (await page.getByRole("button", { name: /SET ALIGNMENT|SET LEFT TACK|SET RIGHT TACK/i }).count()) {
    for (let index = 0; index < 3; index += 1) {
      const button = page
        .getByRole("button", {
          name: /SET ALIGNMENT|SET LEFT TACK|SET RIGHT TACK/i,
        })
        .first();
      if (!(await button.count())) break;
      await button.click();
      await page.waitForTimeout(160);
    }
    return;
  }
  if (await page.getByRole("button", { name: /TACK IT HERE/i }).count()) {
    await page.getByRole("button", { name: /TACK IT HERE/i }).click();
    return;
  }
  if (await page.locator(".sort-item").count()) {
    for (const item of await page.locator(".sort-item").all()) {
      const needsStamp = /deed|writ|newspaper/i.test(await item.innerText());
      await item.getByRole("button").nth(needsStamp ? 0 : 1).click();
    }
    await page.getByRole("button", { name: /LOCK COMPOSITION/i }).click();
    return;
  }
  throw new Error(`unknown mechanic: ${(await shell.innerText()).slice(0, 240)}`);
}

async function resolveActiveInterrupt(page) {
  const root = page.locator('[data-game-root="play"]');
  const kind = await root.getAttribute("data-field-interrupt");
  if (kind === "CONFRONTATION") {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if ((await root.getAttribute("data-field-interrupt")) !== "CONFRONTATION") {
        return true;
      }
      const cite = page.getByRole("button", {
        name: /Quote the writs procedure/i,
      });
      const comply = page.getByRole("button", {
        name: /Comply — open the bag/i,
      });
      const button =
        (await cite.isVisible().catch(() => false)) &&
        (await cite.isEnabled().catch(() => false))
          ? cite
          : (await comply.isVisible().catch(() => false))
              && (await comply.isEnabled().catch(() => false))
            ? comply
            : null;
      if (button) {
        const clicked = await button
          .click({ timeout: 3_000 })
          .then(() => true)
          .catch(() => false);
        if (clicked) return true;
      }
      await page.waitForTimeout(125);
    }
    throw new Error(
      `confrontation had no actionable or resolving panel: ${JSON.stringify(
        await state(page),
      )}`,
    );
  }
  if (kind === "CHASE") {
    const world = await state(page);
    const player = world.world["data-player-pos3d"].split(",").map(Number);
    await page.evaluate(
      ({ x, z }) => window.__PA_QA_WALK_TO__(x, z),
      { x: player[0] + 24, z: player[2] },
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-game-root="play"]')
          ?.getAttribute("data-field-interrupt") !== "CHASE",
      null,
      { timeout: 45_000 },
    );
    report.featureChecks.confrontationChase = true;
    return true;
  }
  return false;
}

async function optionalNedWager(page) {
  await page.evaluate(() => window.__PA_QA_WALK_TO__(9.2, 8.9));
  await page.waitForFunction(
    () => !document.querySelector(".world3d")?.getAttribute("data-qa-walk-target"),
    null,
    { timeout: 30_000 },
  );
  for (let visit = 0; visit < 3; visit += 1) {
    const action = page.locator(".interaction-action-layer button", {
      hasText: "Ned",
    });
    await action.waitFor({ state: "visible", timeout: 15_000 });
    await action.click();
    const dialog = page.getByRole("dialog", { name: /Ned/i });
    await dialog.waitFor({ state: "visible", timeout: 15_000 });
    if (visit === 0) {
      await dialog.getByRole("button", { name: /Show me the press/i }).click();
    } else if (visit === 1) {
      await screenshot(page, "ned-wager-offer");
      await dialog
        .getByRole("button", { name: /Pull a cleaner sheet than Ned/i })
        .click();
      report.featureChecks.nedWager = true;
    } else {
      await dialog.getByRole("button", { name: /Cover for him/i }).click();
    }
    await dialog.getByRole("button", { name: /Continue/i }).click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-game-root="play"]')
          ?.getAttribute("data-field-interrupt") !== "REACTIVE_EXCHANGE",
      null,
      { timeout: 15_000 },
    );
  }
  await page.keyboard.press("KeyM");
  await page.getByRole("dialog", { name: /Boston, from Queen Street/i }).waitFor({
    state: "visible",
    timeout: 10_000,
  });
  await screenshot(page, "runner-map-same-run");
  await page.keyboard.press("KeyM");
  await page.locator(".compass-ribbon").waitFor({ state: "visible" });
  report.featureChecks.mapCompass = true;
}

async function optionalAbigailSource(page) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const current = await state(page);
    const entry = (current.world["data-named-actor-positions"] ?? "")
      .split(";")
      .find((value) => value.startsWith("abigail:"));
    if (entry) {
      const [x, z] = entry.slice("abigail:".length).split(",").map(Number);
      await page.evaluate(
        ({ x, z }) => window.__PA_QA_WALK_TO__(x, z, false),
        { x, z },
      );
    }
    const action = page.locator(".interaction-action-layer button", {
      hasText: "Abigail",
    });
    if (await action.isVisible().catch(() => false)) {
      await action.click();
      const dialog = page.getByRole("dialog", { name: /Abigail/i });
      await dialog.waitFor({ state: "visible", timeout: 15_000 });
      await dialog.getByRole("button", { name: /Ask about the press/i }).click();
      await dialog.getByRole("button", { name: /Continue/i }).click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-game-root="play"]')
            ?.getAttribute("data-field-interrupt") !== "REACTIVE_EXCHANGE",
        null,
        { timeout: 15_000 },
      );
      return;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`could not reach Abigail source exchange: ${JSON.stringify(await state(page))}`);
}

async function crowdRefugeChase(page) {
  const current = await state(page);
  const anchor = current.world["data-quest-arrival-anchor"]
    .split(",")
    .map(Number);
  assert(
    current.world["data-quest-active-id"] === "CROWD",
    "crowd chase requires the live crowd route",
  );
  const beforeGate = await walkSegment(page, [77, 0], false);
  if (beforeGate === "INTERRUPTED") return false;
  assert(
    beforeGate === "ARRIVED",
    `could not reach east gate approach: ${beforeGate}`,
  );
  const throughGate = await walkSegment(page, [83, 0], false, false);
  if (throughGate === "INTERRUPTED") return false;
  assert(
    throughGate === "ARRIVED",
    `could not cross east gate opening: ${throughGate} ${JSON.stringify(
      await state(page),
    )}`,
  );
  const chase = await page.evaluate(() => window.__PA_QA_CHASE__());
  assert(chase?.ok, `QA chase did not start: ${JSON.stringify(chase)}`);
  await page.evaluate(
    ({ x, z }) => window.__PA_QA_WALK_TO__(x, z, true),
    { x: anchor[0], z: anchor[2] },
  );
  try {
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-game-root="play"]')
          ?.getAttribute("data-field-interrupt") !== "CHASE",
      null,
      { timeout: 60_000 },
    );
  } catch {
    throw new Error(`crowd refuge chase stalled: ${JSON.stringify(await state(page))}`);
  }
  await screenshot(page, "confrontation-chase-refuge-same-run");
  report.featureChecks.confrontationChase = true;
  return true;
}

async function optionalTypeset(page) {
  const offer = page.locator(".open-response-offer");
  if (!(await offer.count()) || !(await offer.isVisible())) return false;
  await offer.click();
  const panel = page.locator(".open-response-panel");
  await panel.waitFor({ state: "visible", timeout: 10_000 });
  await panel.locator(".typeset-chips").first().getByRole("button").first().click();
  await panel
    .locator(".typeset-chips.evidence")
    .getByRole("button")
    .first()
    .click();
  await panel.locator("textarea").fill(
    "The official reason names revenue, while the street shows who pays the cost.",
  );
  await panel.getByRole("button", { name: "Print mini-broadside" }).click();
  await panel.getByLabel("Printed mini-broadside").waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await screenshot(page, "typeset-artifact-same-run");
  await page.waitForTimeout(800);
  await panel.getByRole("button", { name: "Back to the street" }).click();
  report.featureChecks.typesetArtifact = true;
  return true;
}

async function saveAndResume(page, count) {
  await screenshot(page, `before-save-resume-${count}`);
  await page.getByRole("button", { name: "Save & exit" }).click();
  await page.waitForFunction(
    () => !document.querySelector('[data-game-root="play"]'),
    null,
    { timeout: 30_000 },
  );
  const row = page.locator(".obj", { hasText: "Design 2 Continuous" });
  await row.getByRole("button", { name: "Play" }).click();
  await page.waitForSelector(
    '[data-game-root="play"][data-runtime-ready="true"]',
    { timeout: 60_000 },
  );
  await page.waitForFunction(
    () =>
      typeof window.__PA_QA_WALK_TO__ === "function" &&
      document.querySelector(".world3d canvas"),
    null,
    { timeout: 60_000 },
  );
  await screenshot(page, `after-save-resume-${count}`);
  report.featureChecks.saveResume = true;
}

async function drive(page) {
  let nedDone = false;
  let abigailDone = false;
  let reflectionDone = false;
  let chaseDone = false;
  let resumeCount = 0;
  let entryCaptured = false;
  for (let step = 0; step < 320; step += 1) {
    const play = page.locator('[data-game-root="play"]');
    if (!(await play.count())) {
      report.featureChecks.actComplete = true;
      return;
    }
    if (await resolveActiveInterrupt(page)) continue;
    const current = await state(page);
    const request = current.play["data-plan-request"];
    report.steps.push({
      step,
      request,
      cue: current.world["data-cue-id"],
      location: current.play["data-runtime-location"],
      clock: current.play["data-clock-spent"],
    });
    if (
      !report.featureChecks.nedCallback &&
      /That sheet is cleaner than mine|Usable, yes\. Cleaner than mine, no/i.test(
        current.body,
      )
    ) {
      report.featureChecks.nedCallback = true;
      await screenshot(page, "ned-callback-same-run");
    }
    if (
      !report.featureChecks.crier &&
      /Tomorrow's page, hot off Mercer's press/i.test(current.body)
    ) {
      report.featureChecks.crier = true;
      await screenshot(page, "crier-ending-same-run");
    }
    if (
      resumeCount < 1 &&
      request === "FREE_ROAM" &&
      !current.world["data-interior-id"] &&
      Number(current.play["data-clock-spent"]) >= 14
    ) {
      resumeCount += 1;
      await saveAndResume(page, resumeCount);
      continue;
    }
    if (
      !abigailDone &&
      request === "FREE_ROAM" &&
      current.play["data-runtime-location"] === "BOSTON_STREET" &&
      !current.world["data-interior-id"] &&
      /Deliver circular to Thomas/.test(current.body)
    ) {
      await optionalAbigailSource(page);
      abigailDone = true;
      continue;
    }
    if (
      !nedDone &&
      request === "FREE_ROAM" &&
      current.play["data-runtime-location"] === "BOSTON_STREET" &&
      !current.world["data-interior-id"] &&
      /Deliver circular to Thomas/.test(current.body)
    ) {
      await optionalNedWager(page);
      nedDone = true;
      continue;
    }
    if (!reflectionDone && request === "FREE_ROAM") {
      reflectionDone = await optionalTypeset(page);
      if (reflectionDone) continue;
    }
    if (
      !chaseDone &&
      request === "FREE_ROAM" &&
      current.world["data-quest-active-id"] === "CROWD"
    ) {
      chaseDone = await crowdRefugeChase(page);
      continue;
    }
    if (request === "CONTINUE") {
      if (
        /CONTINUE\.(Pay up|Collect on the bet)/.test(
          current.world["data-cue-id"] ?? "",
        )
      ) {
        report.featureChecks.nedCallback = true;
        await screenshot(page, "ned-callback-same-run");
      }
      const button = page
        .locator(".world-controls-overlay button:not([disabled])")
        .first();
      await button.waitFor({ state: "visible", timeout: 45_000 });
      await button.click();
      await waitPlanAdvance(
        page,
        request,
        current.world["data-cue-id"],
      );
      continue;
    }
    if (request === "FREE_ROAM") {
      await walkToResolvedArrival(page);
      if (STOP_AFTER === "arrival" && !entryCaptured) {
        entryCaptured = true;
        await screenshot(page, "mercer-arrival-cleared");
        return;
      }
      continue;
    }
    if (request === "CHOICE") {
      const buttons = page.locator(
        ".world-controls-overlay button.choice:not([disabled])",
      );
      await buttons.first().waitFor({ state: "visible", timeout: 45_000 });
      if (!entryCaptured && /shop door/i.test(current.body)) {
        await screenshot(page, "mercer-entry-stakes");
        entryCaptured = true;
      }
      await buttons.first().click();
      if (!report.featureChecks.stakeReceipt) {
        const receipt = page.locator(".ambient-subtitle.route-reminder");
        await receipt.waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
        if (await receipt.count()) {
          report.featureChecks.stakeReceipt = true;
          await screenshot(page, "stake-receipt-same-run");
        }
      }
      await waitPlanAdvance(
        page,
        request,
        current.world["data-cue-id"],
      );
      continue;
    }
    if (request === "MECHANIC") {
      if (/POST_HEADLINE_BOARD/.test(current.world["data-cue-id"] ?? "")) {
        report.featureChecks.crier = true;
        await screenshot(page, "crier-ending-same-run");
      }
      if (/PIN_HANDBILL_EFFIGY/.test(current.world["data-cue-id"] ?? "")) {
        report.featureChecks.effigy = true;
      }
      await completeMechanic(page);
      await page.waitForFunction(
        (cue) => {
          const play = document.querySelector('[data-game-root="play"]');
          const world = document.querySelector(".world3d");
          return (
            play?.getAttribute("data-plan-request") !== "MECHANIC" ||
            world?.getAttribute("data-cue-id") !== cue
          );
        },
        current.world["data-cue-id"],
        { timeout: 45_000 },
      );
      continue;
    }
    if (request === "FOCUS_READ") {
      await page.locator(".choice-panel .choice:not([disabled])").first().click();
      await waitPlanAdvance(
        page,
        request,
        current.world["data-cue-id"],
      );
      continue;
    }
    if (request === "BREATHER") {
      try {
        await page.waitForFunction(
          () =>
            document
              .querySelector('[data-game-root="play"]')
              ?.getAttribute("data-plan-request") !== "BREATHER",
          null,
          { timeout: 30_000 },
        );
      } catch {
        throw new Error(`breather stalled: ${JSON.stringify(await state(page))}`);
      }
      continue;
    }
    if (request === "CHECKPOINT_DEBRIEF") {
      const feedback = page.locator(".checkpoint-answer-feedback");
      const option = page.locator(".checkpoint-option").first();
      if (
        (await option.isVisible().catch(() => false)) &&
        (await option.isEnabled().catch(() => false))
      ) {
        await option.click();
      } else if (await feedback.isVisible().catch(() => false)) {
        const rationales = feedback.locator(
          '[aria-label="Why each choice works or fails"] li',
        );
        assert((await rationales.count()) >= 2, "CP1 rationales missing");
        report.featureChecks.cp1Rationales += 1;
        await screenshot(
          page,
          `cp1-rationale-${report.featureChecks.cp1Rationales}`,
        );
        await feedback.getByRole("button", { name: /Continue to/i }).click();
      } else if (await page.getByRole("button", { name: "FILE IT" }).count()) {
        await page.getByRole("button", { name: "FILE IT" }).click();
      } else if (
        await page.getByRole("button", { name: "PRINT THE RECORD" }).count()
      ) {
        await page.getByRole("button", { name: "PRINT THE RECORD" }).click();
      } else if (
        await page.getByRole("button", { name: "DONE FOR THE DAY" }).count()
      ) {
        await page.getByRole("button", { name: "DONE FOR THE DAY" }).click();
      } else {
        await page.waitForTimeout(500);
      }
      continue;
    }
    if (request === "DAY_END") {
      await screenshot(page, "day-record-act-complete");
      await page.locator(".world-controls-overlay button:not([disabled])").first().click();
      report.featureChecks.actComplete = true;
      await page.waitForTimeout(500);
      return;
    }
    await page.waitForTimeout(400);
  }
  throw new Error("continuous Day 1 exceeded step cap");
}

const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  headless: true,
  args: [
    "--use-angle=metal",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--disable-dev-shm-usage",
  ],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const failedRequests = new Set();
const successfulRequests = new Set();
page.on("pageerror", (error) => report.errors.push(`page:${error.message}`));
page.on("console", (message) => {
  if (
    message.type() === "error" &&
    !message.text().startsWith("Failed to load resource:")
  ) {
    report.errors.push(`console:${message.text()}`);
  }
});
page.on("requestfailed", (request) => {
  const failure = `${request.url()} ${request.failure()?.errorText ?? ""}`;
  failedRequests.add(failure);
});
page.on("response", (response) => {
  if (response.ok()) successfulRequests.add(response.url());
});

try {
  await seedFreshProfile(page);
  // The profile bootstrap intentionally reloads the page. Ignore requests
  // cancelled by that navigation; the continuous run starts here.
  report.errors.length = 0;
  report.assetFailures.length = 0;
  report.networkFailures.length = 0;
  await screenshot(page, "fresh-profile-archive-intake");
  await drive(page);
  const unresolvedFailures = [...failedRequests].filter(
    (failure) =>
      ![...successfulRequests].some((url) => failure.startsWith(`${url} `)),
  );
  report.assetFailures = unresolvedFailures.filter((failure) =>
    failure.startsWith("blob:"),
  );
  report.networkFailures = unresolvedFailures.filter(
    (failure) => !failure.startsWith("blob:"),
  );
  if (STOP_AFTER !== "arrival") {
    for (const [feature, passed] of Object.entries(report.featureChecks)) {
      assert(
        feature === "cp1Rationales" ? passed >= 3 : passed === true,
        `continuous feature check failed: ${feature}=${String(passed)}`,
      );
    }
  }
  assert(report.errors.length === 0, `game/page errors: ${report.errors.join(" | ")}`);
  assert(
    report.assetFailures.length === 0,
    `asset failures: ${report.assetFailures.join(" | ")}`,
  );
  assert(
    report.networkFailures.length === 0,
    `network failures: ${report.networkFailures.join(" | ")}`,
  );
  report.completedAt = new Date().toISOString();
  writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(
    STOP_AFTER === "arrival"
      ? "DESIGN2_ARRIVAL_REPRO_PASS"
      : "DESIGN2_CONTINUOUS_E2E_PASS",
    JSON.stringify({
      steps: report.steps.length,
      screenshots: report.screenshots.length,
      features: report.featureChecks,
    }),
  );
} catch (error) {
  report.errors.push(String(error));
  await page
    .screenshot({ path: resolve(OUT, "FAILED.png") })
    .catch(() => {});
  writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));
  throw error;
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
