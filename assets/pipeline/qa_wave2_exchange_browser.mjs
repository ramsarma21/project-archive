// Wave-2 exchange-interrupt browser acceptance: in-flight exchange
// save -> reload -> complete for the unified engine, plus the fix-wave
// presentation invariants (viewport clamp, Escape-abandon, numeric hotkeys,
// input lock restored across reload, nonzero reduced-motion reply dwell).
//
// Each scenario opens a REAL exchange (candidate click where the figure is
// static, durable FIELD_INTERRUPT_STARTED where the actor wanders), captures
// the panel, reloads the page mid-interrupt, asserts the SAME panel
// reconstructs from the persisted save, completes it, and verifies the
// interrupt resolves. Run with:
//   PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-browsers \
//   W2_QA_URL=http://127.0.0.1:5188/ W2_QA_OUT=test-results/wave2-parity/stageA/scenarios \
//   node --import tsx assets/pipeline/qa_wave2_exchange_browser.mjs
import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDay1Session } from "../../packages/runtime/src/index.ts";
import { CHAPTER_ID, PACKAGE_ID } from "../../packages/contracts/src/index.ts";

const BASE_URL = process.env.W2_QA_URL ?? "http://127.0.0.1:5188/";
const OUT = resolve(
  process.env.W2_QA_OUT ?? "test-results/wave2-parity/scenarios",
);
const SEED = "31".repeat(32);
const ONLY = (process.env.W2_QA_ONLY ?? "").split(",").filter(Boolean);
const EXECUTABLE =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(OUT, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

function streetEvents() {
  const session = createDay1Session({ variationRootSeedHex: SEED });
  for (let step = 0; step < 200; step += 1) {
    if (
      session.ctx.world.objectives.REPORT_TO_MERCER === "COMPLETED" &&
      session.plan?.request.kind === "FREE_ROAM" &&
      session.ctx.world.locationId === "BOSTON_STREET"
    ) {
      return [...session.committedEvents];
    }
    assert(session.plan, "runtime ended before street state");
    session.advance(ordinaryResponse(session.plan.request));
  }
  throw new Error("could not construct the street save");
}

const STREET_EVENTS = streetEvents();

const report = {
  baseUrl: BASE_URL,
  out: OUT,
  scenarios: [],
  screenshots: [],
  errors: [],
};

async function shot(page, name) {
  const path = resolve(OUT, `${name}.png`);
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
      if (luma > 18) nonBlack += 1;
      samples += 1;
    }
    return {
      meanLuma: Number((sum / samples).toFixed(3)),
      nonBlackRatio: Number((nonBlack / samples).toFixed(4)),
    };
  }, buffer.toString("base64"));
  assert(
    luminance.meanLuma >= 5 && luminance.nonBlackRatio >= 0.1,
    `${name} rendered black: ${JSON.stringify(luminance)}`,
  );
  report.screenshots.push({ name, path, luminance });
}

async function bootstrap(page, profileId, events, reducedMotion) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() =>
    document.body.textContent?.includes("Project Archive"),
  );
  await page.evaluate(
    async ({ profileId, seed, events, chapterId, packageId, reducedMotion }) => {
      const request = indexedDB.open("project-archive");
      await new Promise((resolvePromise, reject) => {
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const tx = database.transaction(["profiles", "saves"], "readwrite");
          tx.objectStore("profiles").put({
            profileId,
            accountId: `local:${profileId}`,
            displayName: `Wave2 ${profileId}`,
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
              reducedMotion,
              chaseAssist: "AUTO_STAMINA",
              primersSeen: ["ARCHIVE", "MOVEMENT", "READ", "WORK", "CHOICE"],
              completedAt: "2026-07-21T00:00:00.000Z",
            },
          });
          tx.objectStore("saves").put({
            profileId,
            chapterId,
            packageId,
            flowVersion: 5,
            committedEvents: events,
            revision: 1,
            status: "IN_PROGRESS",
            updatedAt: "2026-07-21T00:00:00.000Z",
          });
          tx.oncomplete = () => {
            database.close();
            resolvePromise();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    {
      profileId,
      seed: SEED,
      events,
      chapterId: CHAPTER_ID,
      packageId: PACKAGE_ID,
      reducedMotion,
    },
  );
}

async function pressPlay(page, query = "") {
  await page.goto(`${BASE_URL}${query}`, { waitUntil: "domcontentloaded" });
  const play = page.getByRole("button", { name: "Play" }).first();
  await play.waitFor({ state: "visible", timeout: 20000 });
  await play.click();
}

async function waitFreeRoam(page) {
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
  await page.waitForTimeout(700);
}

// After a mid-exchange reload the save's tail is FIELD_INTERRUPT_STARTED: the
// world must come back INSIDE the interrupt (panel reconstructed, input
// locked) rather than in clean free-roam.
async function waitReloadedIntoExchange(page) {
  await page.waitForFunction(
    () => {
      const root = document.querySelector('[data-game-root="play"]');
      return (
        root?.getAttribute("data-plan-request") === "FREE_ROAM" &&
        root?.getAttribute("data-field-interrupt") === "REACTIVE_EXCHANGE"
      );
    },
    null,
    { timeout: 60000 },
  );
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(400);
}

async function waitResolved(page) {
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
    { timeout: 20000 },
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
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const ok = await page.evaluate(
      async (payload) => window.__PA_FIELD_EVENT__(payload),
      event,
    );
    if (ok) {
      await page.waitForTimeout(150);
      return;
    }
    await page.waitForTimeout(120);
  }
  throw new Error(`field event rejected: ${event.type} ${event.eventId}`);
}

async function clearConfrontation(page) {
  const active = await page.evaluate(
    () =>
      document
        .querySelector('[data-game-root="play"]')
        ?.getAttribute("data-field-interrupt") === "CONFRONTATION",
  );
  if (!active) return;
  const comply = page.getByRole("button", { name: /Comply — open the bag/i });
  if (await comply.isVisible().catch(() => false)) {
    await comply.click({ force: true }).catch(() => {});
  }
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
  await page.waitForTimeout(300);
}

async function openViaCandidate(page, target, buttonName) {
  const button = page.getByRole("button", { name: buttonName });
  const offsets = [
    { dx: 0, dz: 1.6, yaw: Math.PI },
    { dx: 0, dz: -1.6, yaw: 0 },
    { dx: -1.6, dz: 0, yaw: Math.PI / 2 },
    { dx: 1.6, dz: 0, yaw: -Math.PI / 2 },
  ];
  for (let pass = 0; pass < 2; pass += 1) {
    for (const offset of offsets) {
      await teleport(page, target.x + offset.dx, target.z + offset.dz, offset.yaw);
      await clearConfrontation(page);
      if (await button.isVisible().catch(() => false)) break;
    }
    if (await button.isVisible().catch(() => false)) break;
  }
  await button.waitFor({ state: "visible", timeout: 10000 });
  const glyphs = await page.locator(".interaction-glyph").count();
  assert(glyphs === 1, `${buttonName} arbitration produced ${glyphs} glyphs`);
  await button.evaluate((element) => element.click());
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-game-root="play"]')
        ?.getAttribute("data-field-interrupt") === "REACTIVE_EXCHANGE",
    null,
    { timeout: 15000 },
  );
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 15000 });
}

async function openViaStartedEvent(page, name, sourceId) {
  const interruptId = `W2_${name}`;
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
    null,
    { timeout: 15000 },
  );
  await page.waitForTimeout(250);
  try {
    await page
      .getByRole("dialog")
      .waitFor({ state: "visible", timeout: 30000 });
  } catch (cause) {
    const diagnostics = await page.evaluate(() => {
      const panel = document.querySelector(".reactive-exchange");
      const chain = [];
      let node = panel;
      while (node && node !== document.body) {
        const style = getComputedStyle(node);
        chain.push({
          tag: node.tagName,
          cls: node.className?.toString?.().slice(0, 40),
          visibility: style.visibility,
          display: style.display,
          transform: style.transform?.slice(0, 60),
          rect: node.getBoundingClientRect?.().toJSON?.(),
        });
        node = node.parentElement;
      }
      return {
        interrupt: document
          .querySelector('[data-game-root="play"]')
          ?.getAttribute("data-field-interrupt"),
        locked: document
          .querySelector(".world3d")
          ?.getAttribute("data-player-input-locked"),
        dialogs: document.querySelectorAll('[role="dialog"]').length,
        panelTitle: panel?.querySelector("header")?.textContent ?? null,
        ancestorChain: chain.slice(0, 4),
      };
    });
    throw new Error(
      `${name}: exchange dialog missing after STARTED ${JSON.stringify(diagnostics)} (${String(cause)})`,
    );
  }
}

async function panelSnapshot(page) {
  return page.evaluate(() => {
    const panel = document.querySelector(".reactive-exchange");
    const rect = panel?.getBoundingClientRect();
    return {
      title: panel?.querySelector("header")?.textContent ?? null,
      body: panel?.querySelector("p")?.textContent ?? null,
      buttons: [...(panel?.querySelectorAll("button") ?? [])].map((button) =>
        button.textContent?.trim(),
      ),
      inputLocked: document
        .querySelector(".world3d")
        ?.getAttribute("data-player-input-locked"),
      rect: rect
        ? {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
          }
        : null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
}

// Fix-wave P0-2 contract (panelPlacement.ts): the panel's CENTER is clamped
// into the safe-area margin box (left/right 190, top 130, bottom 210), which
// keeps the header and every choice button reachable. Edges of the 420px-wide
// panel may legitimately overhang by up to halfWidth - margin.
const PANEL_MARGINS = { left: 190, right: 190, top: 130, bottom: 210 };
const PANEL_EPSILON = 8;

function assertPanelInViewport(snapshot, label) {
  assert(snapshot.rect, `${label}: exchange panel missing`);
  const { rect, viewport } = snapshot;
  const centerX = (rect.left + rect.right) / 2;
  const centerY = (rect.top + rect.bottom) / 2;
  assert(
    centerX >= PANEL_MARGINS.left - PANEL_EPSILON &&
      centerX <= viewport.width - PANEL_MARGINS.right + PANEL_EPSILON &&
      centerY >= PANEL_MARGINS.top - PANEL_EPSILON &&
      centerY <= viewport.height - PANEL_MARGINS.bottom + PANEL_EPSILON,
    `${label}: panel center escaped the clamped safe area ${JSON.stringify({
      centerX,
      centerY,
      rect: snapshot.rect,
    })}`,
  );
}

async function reloadMidExchange(page, name) {
  await pressPlay(page);
  await waitReloadedIntoExchange(page);
  const resumed = await panelSnapshot(page);
  assert(
    resumed.inputLocked === "true",
    `${name}: input lock did not restore across reload`,
  );
  assertPanelInViewport(resumed, `${name} after reload`);
  return resumed;
}

// Each scenario boots a full 3D world; a single Chrome instance accumulates
// GPU state across worlds and can stall the R3F frame loop by the fifth
// heavy context (drei <Html> then never positions its panel). Launch an
// isolated browser per scenario — the engine under test is unaffected, and
// each run stays deterministic.
async function scenario(id, options, run) {
  if (ONLY.length > 0 && !ONLY.includes(id)) return;
  const browser = await chromium.launch({
    executablePath: EXECUTABLE,
    headless: true,
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "/tmp/pw-browsers" },
    args: [
      "--use-angle=metal",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--disable-dev-shm-usage",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`${id}:page:${String(error)}`));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource:")
    ) {
      errors.push(`${id}:console:${message.text()}`);
    }
  });
  await bootstrap(page, `w2-${id}`, STREET_EVENTS, options.reducedMotion ?? false);
  await pressPlay(page, options.query ?? "?atmoT=0.45");
  await waitFreeRoam(page);
  try {
    await run(page);
    report.scenarios.push({ id, status: "PASS", errors });
  } catch (cause) {
    report.scenarios.push({ id, status: "FAIL", error: String(cause), errors });
    await page
      .screenshot({ path: resolve(OUT, `${id}-FAILED.png`), fullPage: true })
      .catch(() => {});
    throw cause;
  } finally {
    report.errors.push(...errors);
    // Let embedded GLB image promises settle before teardown (M4 harness
    // precedent) so Chromium cannot report revoked blob URLs.
    await page.waitForTimeout(1200);
    await context.close();
    await browser.close();
  }
}

try {
  // 1. Named NPC (Pike, wandering cast): durable-start, reload, hotkey commit.
  await scenario("named-pike", {}, async (page) => {
    await teleport(page, 40, 4, Math.PI / 2);
    await openViaStartedEvent(page, "NAMED_PIKE", "NPC-pike");
    const before = await panelSnapshot(page);
    assert(before.title === "Mr. Pike", `pike panel title ${before.title}`);
    await shot(page, "01-pike-before-reload");
    const resumed = await reloadMidExchange(page, "named-pike");
    assert(
      resumed.title === before.title && resumed.body === before.body,
      `pike panel changed across reload: ${JSON.stringify(resumed)}`,
    );
    await shot(page, "02-pike-after-reload");
    // Numeric hotkey commit on the RECONSTRUCTED panel (fix-wave P0-2).
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("1");
    await waitResolved(page);
    await shot(page, "03-pike-completed");
  });

  // 2. Sarah (static thread figure): real candidate click, reload, button commit.
  await scenario("thread-sarah", {}, async (page) => {
    await openViaCandidate(
      page,
      { x: -50, z: -4.7 },
      /Talk to Goodwife Sarah/i,
    );
    const before = await panelSnapshot(page);
    assert(
      before.title === "Goodwife Sarah // The Wharf Widow",
      `sarah panel title ${before.title}`,
    );
    await shot(page, "04-sarah-before-reload");
    const resumed = await reloadMidExchange(page, "thread-sarah");
    assert(
      resumed.title === before.title && resumed.body === before.body,
      "sarah panel changed across reload",
    );
    await shot(page, "05-sarah-after-reload");
    const help = page.getByRole("button", { name: /Help with the stall/i });
    await help.evaluate((element) => element.click());
    await page.locator(".exchange-effect-chips").waitFor({
      state: "visible",
      timeout: 8000,
    });
    await shot(page, "06-sarah-reply-chips");
    await waitResolved(page);
  });

  // 3. Dock haul offer (reduced motion): candidate click, reload, verify the
  //    reply dwell still presents feedback before resolving.
  await scenario("dock-haul", { reducedMotion: true }, async (page) => {
    await openViaCandidate(page, { x: -134, z: 3.0 }, /Talk to the dockhand/i);
    const before = await panelSnapshot(page);
    assert(before.title === "Wharf dockhand", `dock title ${before.title}`);
    await shot(page, "07-dock-before-reload");
    const resumed = await reloadMidExchange(page, "dock-haul");
    assert(
      resumed.title === before.title && resumed.body === before.body,
      "dock panel changed across reload",
    );
    await shot(page, "08-dock-after-reload");
    const accept = page.getByRole("button", { name: /Lend a back/i });
    await accept.evaluate((element) => element.click());
    // Reduced motion keeps a NONZERO dwell: the reply must be readable
    // before the interrupt resolves.
    await page.waitForFunction(
      () =>
        document
          .querySelector(".reactive-exchange p")
          ?.textContent?.includes("Take the barrel by the crane"),
      null,
      { timeout: 4000 },
    );
    await waitResolved(page);
    await shot(page, "09-dock-accepted");
  });

  // 4. Tavern keeper (interior): durable-start inside the tavern, reload,
  //    complete, custody transfers.
  await scenario("tavern-keeper", {}, async (page) => {
    // Seed the accepted note + custody through the same synthetic exchange
    // the M3 tour uses (an UNREGISTERED sourceId so the engine leaves the
    // externally-driven interrupt alone), then walk into the tavern.
    await fieldEvent(page, {
      type: "FIELD_INTERRUPT_STARTED",
      eventId: "W2_TAVERN_SEED_START",
      interruptId: "W2_TAVERN_SEED",
      interruptKind: "REACTIVE_EXCHANGE",
      sourceId: "W2-tavern-seed",
    });
    await fieldEvent(page, {
      type: "FIELD_REACTIVE_COMPLETED",
      eventId: "W2_TAVERN_SEED_ACCEPT",
      interruptId: "W2_TAVERN_SEED",
      completion: {
        interactionId: "W2:TAVERN:ACCEPT",
        sourceId: "W2-tavern-seed",
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
      eventId: "W2_TAVERN_SEED_RESOLVED",
      interruptId: "W2_TAVERN_SEED",
      outcome: "TAKE_NOTE",
    });
    await page
      .locator(".reactive-exchange")
      .waitFor({ state: "detached", timeout: 10000 })
      .catch(() => {});
    await waitResolved(page);
    await page.evaluate(() =>
      window.__PA_QA_INTERIOR__("EXPLORE_tavern", "CENTER"),
    );
    await page.waitForFunction(
      () =>
        document.querySelector(".world3d")?.dataset.interiorId ===
        "EXPLORE_tavern",
    );
    await openViaStartedEvent(page, "KEEPER", "SJ-tavern-note-handoff");
    const before = await panelSnapshot(page);
    assert(
      before.title === "Keeper // Bunch of Grapes",
      `keeper title ${before.title}`,
    );
    await shot(page, "10-keeper-before-reload");
    const resumed = await reloadMidExchange(page, "tavern-keeper");
    assert(
      resumed.title === before.title && resumed.body === before.body,
      "keeper panel changed across reload",
    );
    await shot(page, "11-keeper-after-reload");
    const handoff = page.getByRole("button", {
      name: /Hand over the folded note/i,
    });
    await handoff.evaluate((element) => element.click());
    await waitResolved(page);
    const carried = await page
      .locator('[data-game-root="play"]')
      .getAttribute("data-carried-object-ids");
    assert(
      !(carried ?? "").includes("TAVERN_NOTE"),
      "tavern note stayed in player custody after the reloaded handoff",
    );
    await shot(page, "12-keeper-completed");
  });

  // 5. Escape-abandon on a reconstructed panel (fix-wave P0-2): no outcome
  //    commits, input unlocks, and the exchange can be re-engaged. Ned is a
  //    fixed-position thread figure, so the panel anchor is deterministic
  //    (wandering cast anchors can legitimately fall behind the camera, where
  //    drei hides world-anchored Html — pre-existing engine-wide behavior).
  await scenario("escape-abandon", {}, async (page) => {
    await teleport(page, 9.2, 8.9, Math.PI);
    await openViaStartedEvent(page, "ESCAPE_NED", "THR-ned");
    await shot(page, "13-ned-panel");
    const resumed = await reloadMidExchange(page, "escape-abandon");
    assert(
      resumed.title === "Ned // The Apprentice",
      `ned reconstruction title ${resumed.title}`,
    );
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("Escape");
    await waitResolved(page);
    await shot(page, "14-ned-abandoned");
    // Re-engage after abandon: the engine must mint a fresh interrupt id
    // (committed-event-count suffix) and the runtime must accept it.
    await openViaStartedEvent(page, "ESCAPE_NED_2", "THR-ned");
    await page.getByRole("dialog").waitFor({ state: "visible" });
    const second = await panelSnapshot(page);
    assert(second.title === "Ned // The Apprentice", "ned re-engage failed");
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("Escape");
    await waitResolved(page);
  });
} finally {
  writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));
}

const failed = report.scenarios.filter((entry) => entry.status !== "PASS");
assert(failed.length === 0, `scenarios failed: ${JSON.stringify(failed)}`);
assert(
  report.errors.length === 0,
  `browser errors: ${report.errors.join("\n")}`,
);
console.log(
  "W2_EXCHANGE_QA_PASS",
  JSON.stringify({
    scenarios: report.scenarios.map((entry) => entry.id),
    screenshots: report.screenshots.length,
    out: OUT,
  }),
);
process.exit(0);
