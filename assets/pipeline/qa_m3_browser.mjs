// M3 visual acceptance tour. Uses the repository's known-good Playwright and
// WebGL installation, dev-only QA hooks, a fresh local profile/save, and strict
// screenshot pixel validation. Run with:
//   PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-browsers \
//   M3_QA_URL=http://127.0.0.1:5183/ \
//   node --import tsx assets/pipeline/qa_m3_browser.mjs
import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BOSTON_DAY1_FLOW_VERSION,
  CHAPTER_ID,
  PACKAGE_ID,
  createDay1Session,
} from "../../packages/chapter-boston/src/index.ts";

const BASE_URL = process.env.M3_QA_URL ?? "http://127.0.0.1:5183/";
const OUT = resolve(process.env.M3_QA_OUT ?? "test-results/m3-visual-qa");
const PROFILE_ID = "m3-visual-qa";
const SEED = "31".repeat(32);
const FLOW_VERSION = Number(
  process.env.M3_QA_FLOW_VERSION ?? BOSTON_DAY1_FLOW_VERSION,
);
const HEADLESS_SHELL =
  "/tmp/pw-browsers/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell";
mkdirSync(OUT, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hash(text) {
  return createHash("sha256").update(text).digest("hex");
}

function mechanicResult(request) {
  const params = request.params;
  if (params.kind === "PRESS") return { kind: "PRESS", stopOffset: 0.5 };
  if (params.kind === "EFFORT") return { kind: "EFFORT", holdMs: 1500 };
  if (params.kind === "PLACE") return { kind: "PLACE", alignment: 0.5 };
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
    case "DAY_END":
      return { type: "CONTINUE" };
  }
}

function eventsAfterMercerDispatch() {
  const session = createDay1Session({ variationRootSeedHex: SEED });
  for (let step = 0; step < 200; step += 1) {
    const reportComplete =
      session.ctx.world.objectives.REPORT_TO_MERCER === "COMPLETED";
    if (
      reportComplete &&
      session.plan?.request.kind === "FREE_ROAM" &&
      session.ctx.world.locationId === "BOSTON_STREET"
    ) {
      return [...session.committedEvents];
    }
    assert(session.plan, "runtime ended before Mercer dispatch");
    session.advance(ordinaryResponse(session.plan.request));
  }
  throw new Error("could not construct post-Mercer M3 visual save");
}

const priorEvents = eventsAfterMercerDispatch();
const launchVariants = [
  {
    id: "headless-shell-angle",
    executablePath: HEADLESS_SHELL,
    headless: true,
    args: [
      "--use-gl=angle",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--disable-dev-shm-usage",
    ],
  },
  {
    // Proven headless Metal-ANGLE config shared with the M1/M4 harnesses: real
    // GPU rendering that is fast and stable, so the long visual tour does not
    // flake on software-renderer frame latency. Screenshot validation is
    // luminance/non-black metric based (not exact-hash), so GPU output is fine.
    id: "chrome-metal",
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: [
      "--use-angle=metal",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--disable-dev-shm-usage",
    ],
  },
  {
    id: "chrome-swiftshader",
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: [
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--disable-dev-shm-usage",
    ],
  },
  {
    id: "chrome-metal-headed",
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: false,
    args: [
      "--use-angle=metal",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--disable-dev-shm-usage",
    ],
  },
].filter(
  (variant) =>
    !process.env.M3_QA_LAUNCH_ID ||
    variant.id === process.env.M3_QA_LAUNCH_ID,
);

const report = {
  baseUrl: BASE_URL,
  out: OUT,
  servedSource: {},
  selectedLaunch: null,
  launchAttempts: [],
  gpu: null,
  screenshots: [],
  interactions: [],
  errors: [],
  health: null,
};

async function sourceProbe() {
  let devSourceAvailable = true;
  for (const path of [
    "src/presenter/ArchiveOverlay.tsx",
    "src/presenter/CheckpointDebrief.tsx",
    "src/pages/Play.tsx",
  ]) {
    const response = await fetch(new URL(path, BASE_URL));
    const body = await response.text();
    if (
      !response.ok ||
      !body.includes(path.includes("Play") ? "function Play" : path.split("/").at(-1).replace(".tsx", ""))
    ) {
      devSourceAvailable = false;
      break;
    }
    report.servedSource[path] = {
      bytes: body.length,
      sha256: hash(body),
    };
  }
  if (devSourceAvailable) return;
  report.servedSource = {};
  const root = await fetch(BASE_URL);
  assert(root.ok, `served application missing: ${root.status}`);
  const html = await root.text();
  const script = html.match(/<script[^>]+src="([^"]+index-[^"]+\.js)"/)?.[1];
  assert(script, "could not identify immutable preview bundle");
  const bundleResponse = await fetch(new URL(script, BASE_URL));
  assert(bundleResponse.ok, `preview bundle missing: ${bundleResponse.status}`);
  const bundle = await bundleResponse.text();
  let servedCode = bundle;
  const relatedAssets = new Set(
    [...bundle.matchAll(/(?:\/assets\/|\.\/)([A-Za-z0-9_.-]+\.js)/g)].map(
      (match) => `/assets/${match[1]}`,
    ),
  );
  for (const asset of relatedAssets) {
    const response = await fetch(new URL(asset, BASE_URL));
    if (response.ok) servedCode += `\n${await response.text()}`;
  }
  for (const marker of [
    "Talk to Goodwife Sarah",
    "FIELD_REACTIVE_COMPLETED",
    "Town standing",
  ]) {
    assert(servedCode.includes(marker), `preview bundle lacks M3 marker ${marker}`);
  }
  report.servedSource["immutable-preview-bundle"] = {
    path: script,
    bytes: bundle.length,
    sha256: hash(bundle),
    relatedAssets: [...relatedAssets],
    markers: [
      "Talk to Goodwife Sarah",
      "FIELD_REACTIVE_COMPLETED",
      "Town standing",
    ],
  };
}

async function gpuProbe(page) {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2", { antialias: false }) ??
      canvas.getContext("webgl", { antialias: false });
    if (!gl) return { available: false };
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const gameCanvas = document.querySelector(".world3d canvas");
    const gameGl =
      gameCanvas?.getContext("webgl2") ?? gameCanvas?.getContext("webgl");
    let framebuffer = null;
    if (gameGl && gameCanvas) {
      const width = gameGl.drawingBufferWidth;
      const height = gameGl.drawingBufferHeight;
      const pixels = new Uint8Array(width * height * 4);
      gameGl.readPixels(
        0,
        0,
        width,
        height,
        gameGl.RGBA,
        gameGl.UNSIGNED_BYTE,
        pixels,
      );
      let nonBlack = 0;
      let sum = 0;
      let samples = 0;
      for (let index = 0; index < pixels.length; index += 64) {
        const luma =
          0.2126 * pixels[index] +
          0.7152 * pixels[index + 1] +
          0.0722 * pixels[index + 2];
        sum += luma;
        if (luma > 18) nonBlack += 1;
        samples += 1;
      }
      framebuffer = {
        width,
        height,
        contextLost: gameGl.isContextLost(),
        glError: gameGl.getError(),
        sampledMeanLuma: Number((sum / samples).toFixed(3)),
        sampledNonBlackRatio: Number((nonBlack / samples).toFixed(4)),
        worldDataset: {
          drawCalls: document.querySelector(".world3d")?.dataset.drawCalls,
          triangles: document.querySelector(".world3d")?.dataset.triangles,
          locationId: document.querySelector(".world3d")?.dataset.locationId,
          interiorId: document.querySelector(".world3d")?.dataset.interiorId,
          movementActive:
            document.querySelector(".world3d")?.dataset.movementActive,
          sceneObjectCount:
            document.querySelector(".world3d")?.dataset.sceneObjectCount,
          sceneVisibleMeshCount:
            document.querySelector(".world3d")?.dataset.sceneVisibleMeshCount,
        },
      };
    }
    return {
      available: true,
      version: gl.getParameter(gl.VERSION),
      shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      vendor: debug
        ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)
        : gl.getParameter(gl.VENDOR),
      renderer: debug
        ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
      framebuffer,
    };
  });
}

async function imageMetrics(page, buffer, worldCrop) {
  return page.evaluate(
    async ({ base64, world }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const crop = world
        ? {
            x: Math.floor(image.width * 0.18),
            y: Math.floor(image.height * 0.13),
            width: Math.floor(image.width * 0.74),
            height: Math.floor(image.height * 0.72),
          }
        : { x: 0, y: 0, width: image.width, height: image.height };
      const pixels = context.getImageData(
        crop.x,
        crop.y,
        crop.width,
        crop.height,
      ).data;
      let sum = 0;
      let sumSquares = 0;
      let nonBlack = 0;
      let colorful = 0;
      let minimum = 255;
      let maximum = 0;
      const bins = new Set();
      for (let index = 0; index < pixels.length; index += 16) {
        const r = pixels[index];
        const g = pixels[index + 1];
        const b = pixels[index + 2];
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        sum += luma;
        sumSquares += luma * luma;
        if (luma > 18) nonBlack += 1;
        if (Math.max(r, g, b) - Math.min(r, g, b) > 12) colorful += 1;
        minimum = Math.min(minimum, luma);
        maximum = Math.max(maximum, luma);
        bins.add(
          `${Math.floor(r / 16)}:${Math.floor(g / 16)}:${Math.floor(b / 16)}`,
        );
      }
      const samples = pixels.length / 16;
      const mean = sum / samples;
      return {
        width: image.width,
        height: image.height,
        crop,
        samples,
        meanLuma: Number(mean.toFixed(3)),
        lumaStdDev: Number(
          Math.sqrt(Math.max(0, sumSquares / samples - mean * mean)).toFixed(3),
        ),
        nonBlackRatio: Number((nonBlack / samples).toFixed(4)),
        colorfulRatio: Number((colorful / samples).toFixed(4)),
        minimumLuma: Number(minimum.toFixed(2)),
        maximumLuma: Number(maximum.toFixed(2)),
        colorBins: bins.size,
      };
    },
    { base64: buffer.toString("base64"), world: worldCrop },
  );
}

async function bootstrapProfile(page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => document.body.textContent?.includes("Project Archive"),
  );
  await page.evaluate(
    async ({ profileId, seed, events, chapterId, packageId, flowVersion }) => {
      const request = indexedDB.open("project-archive");
      await new Promise((resolve, reject) => {
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
            displayName: "M3 Visual Runner",
            variationRootSeedHex: seed,
            source: "LOCAL",
            createdAt: "2026-07-21T00:00:00.000Z",
            onboarding: {
              version: 1,
              readingSpeed: "BRISK",
              captions: true,
              audioDescription: false,
              inputMethod: "KEYBOARD_ONLY",
              archiveAssistAutoOffer: true,
              highContrast: false,
              reducedMotion: false,
              chaseAssist: "AUTO_STAMINA",
              primersSeen: ["ARCHIVE", "MOVEMENT", "READ", "WORK", "CHOICE"],
              completedAt: "2026-07-21T00:00:00.000Z",
            },
          });
          transaction.objectStore("saves").put({
            profileId,
            chapterId,
            packageId,
            flowVersion,
            committedEvents: events,
            revision: 1,
            status: "IN_PROGRESS",
            updatedAt: "2026-07-21T00:00:00.000Z",
          });
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    },
    {
      profileId: PROFILE_ID,
      seed: SEED,
      events: priorEvents,
      chapterId: CHAPTER_ID,
      packageId: PACKAGE_ID,
      flowVersion: FLOW_VERSION,
    },
  );
}

async function enterSavedWorld(page, query = "") {
  await page.goto(`${BASE_URL}${query}`, { waitUntil: "domcontentloaded" });
  const play = page.getByRole("button", { name: "Play" }).first();
  await play.waitFor({ state: "visible", timeout: 15000 });
  await play.click();
  try {
    await page.waitForFunction(
      () => {
        const root = document.querySelector('[data-game-root="play"]');
        const world = document.querySelector(".world3d");
        return (
          root?.getAttribute("data-plan-request") === "FREE_ROAM" &&
          root?.getAttribute("data-field-interrupt") === "" &&
          root?.getAttribute("data-interaction-busy") === "false" &&
          world?.getAttribute("data-movement-active") === "true" &&
          typeof window.__PA_QA_TELEPORT__ === "function" &&
          typeof window.__PA_FIELD_EVENT__ === "function"
        );
      },
      null,
      { timeout: 60000 },
    );
  } catch (error) {
    const diagnostics = await page.evaluate(() => {
      const root = document.querySelector('[data-game-root="play"]');
      const world = document.querySelector(".world3d");
      return {
        plan: root?.getAttribute("data-plan-request"),
        interrupt: root?.getAttribute("data-field-interrupt"),
        busy: root?.getAttribute("data-interaction-busy"),
        movement: world?.getAttribute("data-movement-active"),
        teleport: typeof window.__PA_QA_TELEPORT__,
        fieldEvent: typeof window.__PA_FIELD_EVENT__,
        body: document.body.textContent?.slice(-600),
      };
    });
    throw new Error(
      `${String(error)} M3_BOOTSTRAP ${JSON.stringify(diagnostics)}`,
    );
  }
  await page.waitForTimeout(900);
}

async function setPreferences(page, patch) {
  await page.evaluate(
    async ({ profileId, patch }) => {
      const request = indexedDB.open("project-archive");
      await new Promise((resolve, reject) => {
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("profiles", "readwrite");
          const store = transaction.objectStore("profiles");
          const get = store.get(profileId);
          get.onsuccess = () => {
            store.put({
              ...get.result,
              onboarding: { ...get.result.onboarding, ...patch },
            });
          };
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    },
    { profileId: PROFILE_ID, patch },
  );
}

async function isolatedCanvasScreenshot(page, path = null) {
  const isolation = await page.addStyleTag({
    content: `
      .holo-tasks,
      .world-cinematic-ui,
      .stealth-hud,
      .quest-marker-hud,
      .world-hint,
      .log-toggle,
      .report-toggle,
      .scene-transition,
      .interaction-glyph,
      .reactive-exchange,
      .context-inspect-prompt,
      .context-inspect-backdrop {
        visibility: hidden !important;
      }
    `,
  });
  await page.waitForTimeout(100);
  try {
    const canvas = page.locator(".world3d canvas").first();
    await canvas.waitFor({ state: "visible", timeout: 10000 });
    const clip = await canvas.boundingBox();
    assert(clip, "world canvas has no screenshot bounds");
    return await page.screenshot(path ? { path, clip } : { clip });
  } finally {
    await isolation.evaluate((element) => element.remove());
  }
}

async function teleport(page, x, z, faceY) {
  await page.evaluate(
    ({ x, z, faceY }) => window.__PA_QA_TELEPORT__(x, z, faceY),
    { x, z, faceY },
  );
  await page.waitForTimeout(320);
}

async function domClick(locator) {
  await locator.evaluate((element) => element.click());
}

async function continueExchangeReply(page) {
  const button = page.getByRole("button", { name: /Continue/i });
  await button.waitFor({ state: "visible", timeout: 10_000 });
  await domClick(button);
  await waitResumed(page);
}

async function waitResumed(page) {
  await page.waitForFunction(
    () => {
      const play = document.querySelector('[data-game-root="play"]');
      const world = document.querySelector(".world3d");
      return (
        play?.getAttribute("data-field-interrupt") === "" &&
        play?.getAttribute("data-interaction-busy") === "false" &&
        world?.getAttribute("data-movement-active") === "true" &&
        world?.getAttribute("data-player-input-locked") === "false"
      );
    },
    null,
    { timeout: 15000 },
  );
}

async function screenshot(page, name, options = {}) {
  await page.waitForTimeout(options.settleMs ?? 900);
  const path = resolve(OUT, `${name}.png`);
  const buffer = await page.screenshot({ path, fullPage: true });
  let analysisBuffer = buffer;
  let canvasPath = null;
  if (options.world !== false) {
    canvasPath = resolve(OUT, `${name}-canvas.png`);
    analysisBuffer = await isolatedCanvasScreenshot(page, canvasPath);
  }
  const metrics = await imageMetrics(page, analysisBuffer, false);
  const minimumRatio = options.world === false ? 0.045 : 0.08;
  const minimumMean = options.world === false ? 6 : 12;
  assert(
    metrics.nonBlackRatio >= minimumRatio,
    `${name} black-frame rejection: nonBlackRatio=${metrics.nonBlackRatio}`,
  );
  assert(
    metrics.meanLuma >= minimumMean,
    `${name} black-frame rejection: meanLuma=${metrics.meanLuma}`,
  );
  assert(
    metrics.lumaStdDev >= 8 && metrics.colorBins >= 24,
    `${name} lacks visual variance: ${JSON.stringify(metrics)}`,
  );
  report.screenshots.push({ name, path, canvasPath, metrics });
  return { path, metrics };
}

function namedActorPositions(value) {
  return Object.fromEntries(
    String(value ?? "")
      .split(";")
      .filter(Boolean)
      .map((entry) => {
        const [id, coords] = entry.split(":");
        const [x, z] = coords.split(",").map(Number);
        return [id, { x, z }];
      }),
  );
}

async function namedActorPosition(page, id) {
  await page.waitForFunction(
    (actorId) =>
      document
        .querySelector(".world3d")
        ?.getAttribute("data-named-actor-positions")
        ?.split(";")
        .some((entry) => entry.startsWith(`${actorId}:`)),
    id,
    { timeout: 10000 },
  );
  const positions = namedActorPositions(
    await page
      .locator(".world3d")
      .getAttribute("data-named-actor-positions"),
  );
  assert(positions[id], `missing named actor position for ${id}`);
  return positions[id];
}

async function approach(
  page,
  accessibleName,
  target,
  screenshotName,
  choiceName,
  useKeyboard = true,
  startSource = null,
  promptScreenshot = null,
  preferredSide = null,
  actorId = null,
) {
  // Named NPCs wander on their route poses, so a single last-known position can
  // drift out of the interaction radius before the glyph resolves (worse now
  // that GPU rendering advances actor routes at full rate). When an actorId is
  // supplied, re-read the live position on every attempt so we always land on
  // the moving target; thread figures stay at their fixed anchor.
  const offsetsBySide = {
    SOUTH: { dx: 0, dz: 1.95, yaw: Math.PI },
    NORTH: { dx: 0, dz: -1.95, yaw: 0 },
    WEST: { dx: -1.95, dz: 0, yaw: Math.PI / 2 },
    EAST: { dx: 1.95, dz: 0, yaw: -Math.PI / 2 },
  };
  const offsets = [
    ...(preferredSide ? [offsetsBySide[preferredSide]] : []),
    { dx: 0, dz: 1.4, yaw: Math.PI },
    { dx: 0, dz: -1.4, yaw: 0 },
    { dx: -1.4, dz: 0, yaw: Math.PI / 2 },
    { dx: 1.4, dz: 0, yaw: -Math.PI / 2 },
  ];
  const button = page.getByRole("button", { name: accessibleName });
  // Up to two full passes so a still-drifting actor gets a second fresh fix.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const offset of offsets) {
      const base = actorId
        ? await namedActorPosition(page, actorId).catch(() => target)
        : target;
      await teleport(page, base.x + offset.dx, base.z + offset.dz, offset.yaw);
      await page.waitForTimeout(300);
      // A teleport near the customs checkpoint can trip a watcher confrontation
      // (a spot-check, not accumulated suspicion). That interrupt suspends the
      // reactive cast, so no NPC glyph can resolve. Comply to clear it (hidden
      // goods are never seized) and keep approaching — what a stopped player
      // does; it does not weaken the cast-glyph check below.
      await clearConfrontation(page);
      if (await button.isVisible().catch(() => false)) break;
    }
    if (await button.isVisible().catch(() => false)) break;
  }
  await clearConfrontation(page);
  await button.waitFor({ state: "visible", timeout: 10000 });
  assert(
    (await page.locator(".interaction-glyph").count()) === 1,
    `${accessibleName} did not arbitrate to exactly one glyph`,
  );
  if (promptScreenshot) {
    await screenshot(page, promptScreenshot);
  }
  if (startSource) {
    const interruptId = `M3_VISUAL_${screenshotName.toUpperCase()}`;
    await fieldEvent(page, {
      type: "FIELD_INTERRUPT_STARTED",
      eventId: `${interruptId}_START`,
      interruptId,
      interruptKind: "REACTIVE_EXCHANGE",
      sourceId: startSource,
    });
  } else if (useKeyboard) {
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("KeyF");
  } else {
    await button.click({ force: true });
  }
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-game-root="play"]')
        ?.getAttribute("data-field-interrupt") === "REACTIVE_EXCHANGE",
  );
  await page.getByRole("dialog").waitFor({ state: "visible" });
  await screenshot(page, screenshotName, { world: false });
  await domClick(page.getByRole("button", { name: choiceName }));
  await continueExchangeReply(page);
  report.interactions.push({
    accessibleName: String(accessibleName),
    choiceName: String(choiceName),
    status: "COMPLETED",
  });
}

async function fieldEvent(page, event) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const ok = await page.evaluate(
      async (payload) => window.__PA_FIELD_EVENT__(payload),
      event,
    );
    if (ok) {
      await page.waitForTimeout(120);
      return;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`field event rejected: ${event.type}`);
}

async function clearConfrontation(page) {
  const active = await page.evaluate(
    () =>
      document
        .querySelector('[data-game-root="play"]')
        ?.getAttribute("data-field-interrupt") === "CONFRONTATION",
  );
  if (!active) return false;
  const comply = page.getByRole("button", { name: /Comply — open the bag/i });
  if (await comply.isVisible().catch(() => false)) {
    await comply.click({ force: true }).catch(() => {});
  }
  // The panel auto-drives INSPECTING -> RESOLVED; wait for the interrupt to clear.
  await page
    .waitForFunction(
      () =>
        document
          .querySelector('[data-game-root="play"]')
          ?.getAttribute("data-field-interrupt") !== "CONFRONTATION",
      undefined,
      { timeout: 15000 },
    )
    .catch(() => {});
  await page.waitForTimeout(400);
  return true;
}

async function runMatrix(page) {
  report.gpu = await gpuProbe(page);
  assert(report.gpu.available, "WebGL probe unavailable");
  const world = page.locator(".world3d");
  await world.waitFor({ state: "visible" });
  const ids = (await world.getAttribute("data-named-actor-ids"))
    ?.split(",")
    .filter(Boolean);
  assert(
    JSON.stringify(ids) ===
      JSON.stringify(["abigail", "thomas", "pike", "clarke", "rider"]),
    `named actor ownership mismatch ${JSON.stringify(ids)}`,
  );
  const selectPike = page.getByRole("button", {
    name: /Bring Pike his stamped proof/i,
  });
  if (await selectPike.isVisible().catch(() => false)) {
    await selectPike.click();
    await waitResumed(page);
  }
  let positions = namedActorPositions(
    await world.getAttribute("data-named-actor-positions"),
  );
  const abigailPosition = await namedActorPosition(page, "abigail");
  await teleport(
    page,
    abigailPosition.x,
    abigailPosition.z + 2,
    Math.PI,
  );
  await screenshot(page, "01-day-reactive-cast");

  // Thread figures first: Sarah's market stall sits near the customs watcher,
  // so validate her deliberate exchange before the longer named-cast tour can
  // accumulate any unrelated suspicion.
  await approach(
    page,
    /Goodwife Sarah/i,
    { x: -50, z: -4.7 },
    "thread-sarah",
    /Help with the stall/i,
    false,
    "THR-sarah",
    "unified-f-priority",
  );
  await approach(
    page,
    /Ned \/\/ The Apprentice/i,
    { x: 9.2, z: 7.0 },
    "thread-ned",
    /Fetch the tray of type/i,
    false,
    "THR-ned",
    null,
    "EAST",
  );

  const named = [
    ["Abigail", "abigail", /Talk: Abigail/i, /Ask about the press/i],
    ["Thomas", "thomas", /Talk: Thomas/i, /Ask what the duties change/i],
    ["Pike", "pike", /Talk: Mr\. Pike/i, /Ask about the courts/i],
    ["Clarke", "clarke", /Talk: Edward Clarke/i, /Hear him out/i],
    ["Rider", "rider", /Talk: The rider/i, /Ask where the news goes/i],
  ];
  for (const [label, id, prompt, choice] of named) {
    const actorPosition = await namedActorPosition(page, id);
    await approach(
      page,
      prompt,
      actorPosition,
      `named-${label.toLowerCase()}`,
      choice,
      true, // useKeyboard
      null, // startSource
      null, // promptScreenshot
      null, // preferredSide
      id, // actorId — re-read the live pose each attempt (NPCs wander)
    );
  }

  await teleport(page, -134, 4.5, Math.PI);
  const dockhand = page.getByRole("button", { name: /dockhand/i });
  await dockhand.waitFor({ state: "visible" });
  await fieldEvent(page, {
    type: "FIELD_INTERRUPT_STARTED",
    eventId: "M3_VISUAL_DOCK_OFFER_START",
    interruptId: "M3_VISUAL_DOCK_OFFER",
    interruptKind: "REACTIVE_EXCHANGE",
    sourceId: "SJ-dock-haul-offer",
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-game-root="play"]')
        ?.getAttribute("data-field-interrupt") === "REACTIVE_EXCHANGE",
  );
  await screenshot(page, "dock-offer", { world: false });
  await domClick(page.getByRole("button", { name: /Lend a back/i }));
  await continueExchangeReply(page);
  const dockStages = [
    [-135.2, 4.5, Math.PI, /Take: Dock haul \/\/ Load/i, /Lift the barrel/i, "dock-load", "SJ-dock-haul-lift"],
    [-142, 14.2, Math.PI / 2, /Cross: Dock haul \/\/ Balance/i, /Balance and cross/i, "dock-balance", "SJ-dock-haul-balance"],
    [-140, 14.6, 0, /Deliver: Dock haul \/\/ Set down/i, /Set down the barrel/i, "dock-setdown", "SJ-dock-haul-setdown"],
  ];
  for (const [x, z, yaw, glyphName, label, name, sourceId] of dockStages) {
    await teleport(page, x, z, yaw);
    const glyph = page.getByRole("button", { name: glyphName });
    await glyph.waitFor({ state: "visible" });
    const interruptId = `M3_VISUAL_${name.toUpperCase()}`;
    await fieldEvent(page, {
      type: "FIELD_INTERRUPT_STARTED",
      eventId: `${interruptId}_START`,
      interruptId,
      interruptKind: "REACTIVE_EXCHANGE",
      sourceId,
    });
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-game-root="play"]')
          ?.getAttribute("data-field-interrupt") === "REACTIVE_EXCHANGE",
    );
    await screenshot(page, name, { world: false });
    await domClick(page.getByRole("button", { name: label }));
    await continueExchangeReply(page);
  }

  await fieldEvent(page, {
    type: "FIELD_INTERRUPT_STARTED",
    eventId: "M3_VISUAL_TAVERN_START",
    interruptId: "M3_VISUAL_TAVERN",
    interruptKind: "REACTIVE_EXCHANGE",
    sourceId: "M3_VISUAL_TAVERN",
  });
  await fieldEvent(page, {
    type: "FIELD_REACTIVE_COMPLETED",
    eventId: "M3_VISUAL_TAVERN_ACCEPT",
    interruptId: "M3_VISUAL_TAVERN",
    completion: {
      interactionId: "M3:VISUAL:TAVERN:ACCEPT",
      sourceId: "M3_VISUAL_TAVERN",
      outcomeId: "TAKE_NOTE",
      activities: [
        {
          activityId: "SJ-tavern-note",
          stage: "ACCEPTED",
          breadcrumb:
            "Thomas asked for a quiet hand-off inside the Bunch of Grapes.",
        },
      ],
      custody: [{ objectId: "TAVERN_NOTE", custody: "PLAYER" }],
    },
  });
  await fieldEvent(page, {
    type: "FIELD_INTERRUPT_RESOLVED",
    eventId: "M3_VISUAL_TAVERN_RESOLVED",
    interruptId: "M3_VISUAL_TAVERN",
    outcome: "TAKE_NOTE",
  });
  await waitResumed(page);
  await page
    .locator(".reactive-exchange")
    .waitFor({ state: "detached", timeout: 10_000 })
    .catch(() => {});
  await page.evaluate(() => window.__PA_QA_INTERIOR__("EXPLORE_tavern", "CENTER"));
  await page.waitForFunction(
    () => document.querySelector(".world3d")?.dataset.interiorId === "EXPLORE_tavern",
  );
  await teleport(page, 732.2, 833, -Math.PI / 2);
  // Validate the keeper handoff is actually OFFERED as a contextual F glyph
  // (custody + tavern-stage + space gating all satisfied)...
  const keeper = page.getByRole("button", { name: /Deliver: Keeper/i });
  await keeper.waitFor({ state: "visible" });
  // ...then start the exchange through the same durable field-event path the
  // other reactive side-job figures (Sarah, Ned, the Thomas offer) use in this
  // tour. The figures director reconstructs the keeper exchange from the active
  // interrupt's sourceId, so this deterministically drives the handoff without
  // depending on a click landing in the narrow window between transient commit
  // round-trips (which clear the figure glyph mid-frame).
  await fieldEvent(page, {
    type: "FIELD_INTERRUPT_STARTED",
    eventId: "M3_VISUAL_KEEPER_START",
    interruptId: "M3_VISUAL_KEEPER",
    interruptKind: "REACTIVE_EXCHANGE",
    sourceId: "SJ-tavern-note-handoff",
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-game-root="play"]')
        ?.getAttribute("data-field-interrupt") === "REACTIVE_EXCHANGE",
  );
  await screenshot(page, "tavern-note-handoff", { world: false });
  await domClick(
    page.getByRole("button", { name: /Hand over the folded note/i }),
  );
  await continueExchangeReply(page);
  assert(
    !(await page
      .locator('[data-game-root="play"]')
      .getAttribute("data-carried-object-ids"))
      ?.includes("TAVERN_NOTE"),
    "tavern note remained in player custody",
  );

  await page.keyboard.press("Tab");
  const archive = page.getByRole("dialog", {
    name: "Archive field interface",
  });
  await archive.waitFor({ state: "visible" });
  await screenshot(page, "archive-standing", { world: false });
  await page.getByRole("button", { name: "Threads" }).click();
  await screenshot(page, "archive-threads", { world: false });
  await page.getByRole("button", { name: "Notes" }).click();
  await screenshot(page, "archive-micros", { world: false });
  await page.keyboard.press("Escape");

  await setPreferences(page, { highContrast: true, reducedMotion: false });
  await enterSavedWorld(page, "?atmoT=0.55");
  const thomasPosition = await namedActorPosition(page, "thomas");
  await teleport(
    page,
    thomasPosition.x,
    thomasPosition.z + 1.8,
    Math.PI,
  );
  await screenshot(page, "02-drizzle-reactive-cast");

  await setPreferences(page, { highContrast: false, reducedMotion: false });
  await enterSavedWorld(page, "?atmoT=0.95&atmoDusk=1");
  const pikePosition = await namedActorPosition(page, "pike");
  await teleport(page, pikePosition.x, pikePosition.z + 1.8, Math.PI);
  await screenshot(page, "03-dusk-reactive-cast");

  await setPreferences(page, { highContrast: true, reducedMotion: true });
  await enterSavedWorld(page, "?atmoT=0.35");
  await screenshot(page, "accessibility-high-contrast-reduced-keyboard");
  const play = page.locator('[data-game-root="play"]');
  assert(
    (await play.getAttribute("data-high-contrast")) === "true" &&
      (await play.getAttribute("data-reduced-motion")) === "true" &&
      (await play.getAttribute("data-input-method")) === "KEYBOARD_ONLY",
    "accessibility preferences did not survive reload",
  );
}

async function smokeVariant(variant) {
  const browser = await chromium.launch({
    executablePath: variant.executablePath,
    headless: variant.headless,
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: "/tmp/pw-browsers",
    },
    args: variant.args,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const errors = [];
  const diagnostics = [];
  page.on("pageerror", (error) => errors.push(`page: ${String(error)}`));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource:")
    ) {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const entry = `${response.status()} ${response.url()}`;
    if (response.url().includes("/v1/health")) diagnostics.push(entry);
    else errors.push(entry);
  });
  await bootstrapProfile(page);
  await enterSavedWorld(page);
  const gpu = await gpuProbe(page);
  let metrics = null;
  let passed = false;
  let renderWaitMs = 0;
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const buffer = await isolatedCanvasScreenshot(page);
    metrics = await imageMetrics(page, buffer, false);
    passed =
      gpu.available &&
      metrics.nonBlackRatio >= 0.08 &&
      metrics.meanLuma >= 12 &&
      metrics.lumaStdDev >= 8 &&
      metrics.colorBins >= 24;
    if (passed) break;
    await page.waitForTimeout(1000);
    renderWaitMs += 1000;
  }
  let interiorProbe = null;
  if (!passed) {
    const hasInteriorHook = await page.evaluate(
      () => typeof window.__PA_QA_INTERIOR__ === "function",
    );
    if (hasInteriorHook) {
      await page.evaluate(() =>
        window.__PA_QA_INTERIOR__("MERCER_PRESS", "CENTER"),
      );
      await page.waitForTimeout(2500);
      const interiorBuffer = await isolatedCanvasScreenshot(page);
      interiorProbe = {
        interiorId: await page
          .locator(".world3d")
          .getAttribute("data-interior-id"),
        metrics: await imageMetrics(page, interiorBuffer, false),
        gpu: await gpuProbe(page),
      };
    }
  }
  report.launchAttempts.push({
    id: variant.id,
    executablePath: variant.executablePath,
    headless: variant.headless,
    args: variant.args,
    gpu,
    metrics,
    renderWaitMs,
    interiorProbe,
    passed,
    errors,
    diagnostics,
  });
  if (!passed) {
    await page.screenshot({
      path: resolve(OUT, `launch-failed-${variant.id}.png`),
      fullPage: true,
    });
    await Promise.race([
      context.close().catch(() => undefined),
      new Promise((resolvePromise) => setTimeout(resolvePromise, 2500)),
    ]);
    await Promise.race([
      browser.close().catch(() => undefined),
      new Promise((resolvePromise) => setTimeout(resolvePromise, 3000)),
    ]);
    return null;
  }
  return { browser, context, page, errors, diagnostics, variant };
}

await sourceProbe();
let selected = null;
// Prefer real GPU (Metal) rendering for speed/stability across the long tour;
// fall back to the deterministic software renderer if the GPU variant cannot
// produce non-black pixels (e.g. a headless host without a GPU).
const SELECTION_ORDER = ["chrome-metal", "chrome-swiftshader"];
for (const variant of SELECTION_ORDER.map((id) =>
  launchVariants.find((candidate) => candidate.id === id),
).filter(Boolean)) {
  try {
    selected = await smokeVariant(variant);
    if (selected) break;
  } catch (error) {
    report.launchAttempts.push({
      id: variant.id,
      passed: false,
      launchError: String(error),
    });
  }
}

if (!selected) {
  writeFileSync(
    resolve(OUT, "report.json"),
    JSON.stringify(report, null, 2),
  );
  throw new Error(
    `M3_VISUAL_QA_BLOCKED: no launch variant produced non-black WebGL pixels; see ${resolve(OUT, "report.json")}`,
  );
}

report.selectedLaunch = selected.variant.id;
try {
  await runMatrix(selected.page);
  report.errors.push(...selected.errors);
  report.health = {
    diagnostics: selected.diagnostics,
    isolatedProbe: true,
  };
  assert(
    selected.errors.length === 0,
    `browser errors:\n${selected.errors.join("\n")}`,
  );
} finally {
  writeFileSync(
    resolve(OUT, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await Promise.race([
    selected.context.close().catch(() => undefined),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 2500)),
  ]);
  await Promise.race([
    selected.browser.close().catch(() => undefined),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 3000)),
  ]);
}

console.log(
  "M3_VISUAL_QA_PASS",
  JSON.stringify({
    selectedLaunch: report.selectedLaunch,
    gpu: report.gpu,
    screenshots: report.screenshots.length,
    interactions: report.interactions.length,
    errors: report.errors.length,
    report: resolve(OUT, "report.json"),
  }),
);
