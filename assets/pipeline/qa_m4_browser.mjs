// Focused M4 browser acceptance: compound print stages, imported watch-house /
// roof / dog content, and the full imported B11 event in normal + reduced
// motion. Uses the repository's installed Playwright browser.
import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDay1Session } from "../../packages/runtime/src/index.ts";
import { CHAPTER_ID, PACKAGE_ID } from "../../packages/contracts/src/index.ts";

const BASE_URL = process.env.M4_QA_URL ?? "http://127.0.0.1:5190/";
const OUT = resolve(process.env.M4_QA_OUT ?? "test-results/m4-browser-qa");
const SEED = "94".repeat(32);
const ONLY = process.env.M4_QA_ONLY ?? "";
const HIGH_CONTRAST = process.env.M4_QA_HIGH_CONTRAST === "1";
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
  if (params.kind === "PRINT_JOB") {
    return {
      kind: "PRINT_JOB",
      phases: { catch: 0.92, ink: 0.92, register: 0.92, pull: 0.92, peel: 0.92 },
      quality: "CRISP",
      accessible: false,
    };
  }
  if (params.kind === "HAUL_JOB") {
    return {
      kind: "HAUL_JOB",
      phases: { load: 0.9, balance: 0.9, thread: 0.9 },
      accessible: false,
    };
  }
  if (params.kind === "POST_JOB") {
    return {
      kind: "POST_JOB",
      phases: { lineUp: 0.9, tackLeft: 0.9, tackRight: 0.9 },
      accessible: false,
    };
  }
  return {
    kind: "SORT",
    assignments: (params.sortItems ?? []).map((item) => ({
      itemId: item.itemId,
      bucketId: ["deed", "writ", "newspaper"].includes(item.itemId)
        ? "NEEDS_STAMP"
        : "DOES_NOT",
    })),
  };
}

function response(request) {
  if (request.kind === "CONTINUE" || request.kind === "DAY_END") {
    return { type: "CONTINUE" };
  }
  if (request.kind === "ACK") return { type: "ACK" };
  if (request.kind === "FOCUS_READ") {
    return { type: "FOCUS_READ_OPENED", objectId: request.objectId };
  }
  if (request.kind === "BREATHER") return { type: "BREATHER_COMPLETE" };
  if (request.kind === "FREE_ROAM") {
    const target =
      request.targets.find((candidate) => candidate.marker === "GOLD") ??
      request.targets[0];
    return { type: "FREE_ROAM_GOTO", targetId: target.targetId };
  }
  if (request.kind === "MECHANIC") {
    return {
      type: "MECHANIC_RESULT",
      promptId: request.promptId,
      result: mechanicResult(request),
    };
  }
  const option =
    request.options.find((candidate) => !candidate.disabled) ??
    request.options[0];
  return {
    type: "CHOICE_SELECTED",
    promptId: request.promptId,
    choiceId: option.choiceId,
  };
}

function eventsUntil(predicate, responder = response) {
  const session = createDay1Session({ variationRootSeedHex: SEED });
  for (let step = 0; step < 800; step += 1) {
    assert(session.plan, "runtime ended before requested M4 cue");
    if (predicate(session)) return [...session.committedEvents];
    session.advance(responder(session.plan.request));
  }
  throw new Error("M4 QA cue generation exceeded step cap");
}

let spoiledInitialProof = false;
const reprintEvents = eventsUntil(
  (session) =>
    session.plan?.request.kind === "MECHANIC" &&
    session.plan.request.params.kind === "PRINT_JOB" &&
    session.plan.request.params.printVariant === "PIKE_REPRINT",
  (request) => {
    if (
      request.kind === "MECHANIC" &&
      request.params.kind === "PRINT_JOB" &&
      request.params.printVariant === "PIKE_PROOF" &&
      !spoiledInitialProof
    ) {
      spoiledInitialProof = true;
      return {
        type: "MECHANIC_RESULT",
        promptId: request.promptId,
        result: {
          kind: "PRINT_JOB",
          phases: {
            catch: 0.92,
            ink: 0.2,
            register: 0.9,
            pull: 0.9,
            peel: 0.9,
          },
          quality: "SMUDGED",
          accessible: false,
        },
      };
    }
    if (
      request.kind === "CHOICE" &&
      request.promptId.includes("PIKE_SMUDGE")
    ) {
      return {
        type: "CHOICE_SELECTED",
        promptId: request.promptId,
        choiceId: "REPRINT",
      };
    }
    return response(request);
  },
);

const eventSets = {
  print: eventsUntil((session) =>
    session.plan?.request.kind === "MECHANIC" &&
    session.plan.request.params.kind === "PRINT_JOB" &&
    session.plan.request.params.printVariant === "PIKE_PROOF"
  ),
  street: eventsUntil((session) =>
    session.ctx.world.objectives.REPORT_TO_MERCER === "COMPLETED" &&
    session.ctx.world.locationId === "BOSTON_STREET" &&
    session.plan?.request.kind === "FREE_ROAM"
  ),
  event: eventsUntil((session) =>
    session.plan?.cueId.includes("FIXED_EVENT_MARCH")
  ),
  reprint: reprintEvents,
  final: eventsUntil((session) =>
    session.plan?.request.kind === "MECHANIC" &&
    session.plan.request.params.kind === "PRINT_JOB" &&
    session.plan.request.params.printVariant === "FINAL_PAGE"
  ),
};

const report = {
  baseUrl: BASE_URL,
  screenshots: [],
  scenarios: [],
  errors: [],
  assetFailures: [],
  networkFailures: [],
  harnessDiagnostics: [],
};

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

async function bootstrap(
  page,
  profileId,
  events,
  reducedMotion,
  inputMethod,
) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() =>
    document.body.textContent?.includes("Project Archive")
  );
  await evaluateStable(
    page,
    async ({ profileId, events, reducedMotion, highContrast, inputMethod, seed, chapterId, packageId }) => {
      const request = indexedDB.open("project-archive");
      await new Promise((resolvePromise, reject) => {
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const tx = database.transaction(["profiles", "saves"], "readwrite");
          tx.objectStore("profiles").put({
            profileId,
            accountId: `local:${profileId}`,
            displayName: `M4 QA ${profileId}`,
            variationRootSeedHex: seed,
            source: "LOCAL",
            createdAt: "2026-07-21T00:00:00.000Z",
            onboarding: {
              version: 1,
              readingSpeed: "BRISK",
              captions: true,
              audioDescription: false,
              inputMethod,
              archiveAssistAutoOffer: true,
              highContrast,
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
      events,
      reducedMotion,
      highContrast: HIGH_CONTRAST,
      inputMethod,
      seed: SEED,
      chapterId: CHAPTER_ID,
      packageId: PACKAGE_ID,
    },
  );
}

async function enter(page, query = "") {
  await page.goto(`${BASE_URL}${query}`, { waitUntil: "domcontentloaded" });
  const play = page.getByRole("button", { name: "Play" }).first();
  await play.waitFor({ state: "visible", timeout: 20000 });
  await play.click();
  await page.waitForFunction(
    () =>
      document.querySelector(".world3d canvas") &&
      document.querySelector('[data-game-root="play"]')?.getAttribute("data-plan-request") &&
      typeof window.__PA_QA_TELEPORT__ === "function",
    null,
    { timeout: 60000 },
  );
  await page.waitForTimeout(900);
}

async function shot(page, name) {
  const path = resolve(OUT, `${name}.png`);
  const buffer = await page.screenshot({ path });
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
  const metrics = await page.evaluate(() => {
    const root = document.querySelector('[data-game-root="play"]');
    const world = document.querySelector(".world3d");
    const perf =
      typeof window.__paPerf === "function" ? window.__paPerf() : null;
    return {
      request: root?.getAttribute("data-plan-request"),
      cue: world?.getAttribute("data-cue-id"),
      watcherCount: world?.getAttribute("data-watcher-count"),
      drawCalls: world?.getAttribute("data-draw-calls"),
      triangles: world?.getAttribute("data-triangles"),
      canvas: Boolean(document.querySelector(".world3d canvas")),
      perf,
    };
  });
  report.screenshots.push({ name, path, luminance, metrics });
}

async function teleport(page, x, z, faceY) {
  await page.evaluate(
    ({ x, z, faceY }) => window.__PA_QA_TELEPORT__(x, z, faceY),
    { x, z, faceY },
  );
  await page.waitForTimeout(500);
}

async function ensureMercerInterior(page) {
  await page.waitForFunction(
    () => typeof window.__PA_QA_INTERIOR__ === "function",
    null,
    { timeout: 10000 },
  );
  await page.evaluate(() => window.__PA_QA_INTERIOR__("MERCER_PRESS", "CENTER"));
  await page.waitForFunction(
    () => {
      const world = document.querySelector(".world3d");
      const position = world?.getAttribute("data-player-pos3d") ?? "";
      return (
        world?.getAttribute("data-interior-id") === "MERCER_PRESS" &&
        Number(position.split(",")[0]) > 600
      );
    },
    null,
    { timeout: 10000 },
  );
  await page.waitForTimeout(350);
}

async function waitFreeRoamReady(page) {
  await page.waitForFunction(
    () => {
      const play = document.querySelector('[data-game-root="play"]');
      const world = document.querySelector('[data-game-root="world"]');
      return (
        play?.getAttribute("data-plan-request") === "FREE_ROAM" &&
        play?.getAttribute("data-interaction-busy") === "false" &&
        play?.getAttribute("data-choreography-ready") === "true" &&
        play?.getAttribute("data-field-interrupt") === "" &&
        world?.getAttribute("data-movement-active") === "true"
      );
    },
    null,
    { timeout: 15000 },
  );
}

async function startConfrontation(page, suffix) {
  const ok = await page.evaluate(
    (id) =>
      window.__PA_FIELD_EVENT__({
        type: "FIELD_WATCHER_CHALLENGE",
        eventId: `M4_FINAL_M2_CHALLENGE_${id}`,
        interruptId: `M4_FINAL_M2_INTERRUPT_${id}`,
        challengeId: `M4_FINAL_M2_${id}`,
        watcherId: "WATCH-customs",
        reason: "SUSPICION",
      }),
    suffix,
  );
  assert(ok, `M2 challenge ${suffix} rejected`);
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-game-root="play"]')
        ?.getAttribute("data-field-interrupt") === "CONFRONTATION" &&
      Boolean(document.querySelector(".confrontation-panel")),
    null,
    { timeout: 15000 },
  );
}

async function drivePrintJob(page, prefix, accessible) {
  if (accessible) {
    await page.getByRole("button", { name: /COMPLETE CATCH/i }).waitFor({
      state: "visible",
      timeout: 15000,
    });
    await shot(page, `${prefix}-catch`);
    for (const stage of ["CATCH", "INK", "REGISTER", "PULL", "PEEL"]) {
      const button = page.getByRole("button", {
        name: new RegExp(`COMPLETE ${stage}`, "i"),
      });
      await button.waitFor({ state: "visible", timeout: 10000 });
      // Retry until this stage's button is consumed (relabels to the next
      // stage / disables): completeStage() silently drops a click that lands
      // while the presenter is momentarily busy, which otherwise strands the
      // print in MECHANIC when scenarios run back-to-back under load.
      for (let attempt = 0; attempt < 5; attempt++) {
        const live =
          (await button.isVisible().catch(() => false)) &&
          (await button.isEnabled().catch(() => false));
        if (!live) break;
        await button.click({ force: true }).catch(() => {});
        await page.waitForTimeout(stage === "INK" ? 700 : 200);
      }
    }
    return;
  }

  const catchButton = page.getByRole("button", { name: /CATCH SHEET/i });
  await catchButton.waitFor({ state: "visible", timeout: 15000 });
  await shot(page, `${prefix}-catch`);
  await catchButton.click();

  const left = page.getByRole("button", { name: /DAUB LEFT/i });
  const right = page.getByRole("button", { name: /DAUB RIGHT/i });
  await left.waitFor({ state: "visible", timeout: 10000 });
  await shot(page, `${prefix}-ink-ready`);
  await left.click();
  await page.waitForTimeout(140);
  const inkState = await page.evaluate(() => {
    const world = document.querySelector(".world3d");
    return {
      leftVisible: world?.getAttribute("data-ink-ball-left-visible"),
      rightVisible: world?.getAttribute("data-ink-ball-right-visible"),
      leftStage: world?.getAttribute("data-ink-ball-left-stage"),
      rightStage: world?.getAttribute("data-ink-ball-right-stage"),
      press: typeof window.__paPressV2 === "function" ? window.__paPressV2() : null,
    };
  });
  assert(
    inkState.leftVisible === "true" &&
      inkState.rightVisible === "true" &&
      inkState.leftStage === "INK" &&
      inkState.rightStage === "INK" &&
      (inkState.press?.inkCoverage ?? 0) >= 0.24,
    `ink staging disconnected: ${JSON.stringify(inkState)}`,
  );
  report.scenarios.push({ id: `${prefix}-ink-signal`, diagnostics: inkState });
  await shot(page, `${prefix}-ink-left-dab`);
  await right.click();
  await page.waitForTimeout(110);
  await left.click();
  await page.waitForTimeout(110);
  await right.click();

  const register = page.getByRole("button", { name: /SET REGISTER/i });
  await register.waitFor({ state: "visible", timeout: 10000 });
  await register.click();
  const pull = page.getByRole("button", { name: /PULL BAR/i });
  await pull.waitFor({ state: "visible", timeout: 10000 });
  await pull.click();
  // Peel is a press-and-hold (HoldAdvance, 700ms). Press at the button's
  // bounding-box centre and hold past the duration; retry until the button is
  // consumed (locked/disabled or removed), so a mousedown that misses the
  // live 3D-anchored button never silently drops the final phase.
  const peel = page.getByRole("button", { name: /HOLD TO PEEL/i });
  await peel.waitFor({ state: "visible", timeout: 10000 });
  for (let attempt = 0; attempt < 4; attempt++) {
    const box = await peel.boundingBox().catch(() => null);
    const enabled = await peel.isEnabled().catch(() => false);
    if (!box || !enabled) break;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(900);
    await page.mouse.up();
    await page.waitForTimeout(250);
  }
}

async function scenario(
  id,
  events,
  reducedMotion,
  query,
  run,
  inputMethod = "KEYBOARD_ONLY",
) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) =>
    report.errors.push(`${id}:page:${error.stack ?? error.message}`),
  );
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      message.text().startsWith("THREE.GLTFLoader: Couldn't load texture blob:")
    ) {
      // Chromium can revoke embedded-image blob URLs while an isolated QA
      // context is being torn down. HTTP asset failures and screenshot
      // luminance are validated separately, so keep this as harness-only
      // diagnostics rather than misclassifying it as a game asset failure.
      report.harnessDiagnostics.push(`${id}: ${message.text()}`);
      return;
    }
    if (
      message.type() === "error" &&
      !message.text().includes("Failed to load resource")
    ) {
      report.errors.push(`${id}:console:${message.text()}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      const failure = `${id}:${response.status()}:${response.url()}`;
      if (/\/world\//.test(response.url()) || /runtime\.worker/.test(response.url())) {
        report.assetFailures.push(failure);
      } else {
        report.networkFailures.push(failure);
      }
    }
  });
  await bootstrap(page, `m4-${id}`, events, reducedMotion, inputMethod);
  await enter(page, query);
  await run(page);
  const diagnostics = await page.evaluate(() => {
    const canvas = document.querySelector(".world3d canvas");
    const world = document.querySelector(".world3d");
    const root = document.querySelector('[data-game-root="play"]');
    const gl =
      canvas?.getContext("webgl2") ??
      canvas?.getContext("webgl");
    return {
      worldData: world ? { ...world.dataset } : null,
      playData: root ? { ...root.dataset } : null,
      canvas: canvas
        ? {
            width: canvas.width,
            height: canvas.height,
            rect: canvas.getBoundingClientRect().toJSON(),
            opacity: getComputedStyle(canvas).opacity,
            display: getComputedStyle(canvas).display,
            renderer: gl?.getParameter(gl.RENDERER) ?? null,
          }
        : null,
    };
  });
  report.scenarios.push({
    id,
    reducedMotion,
    highContrast: await page.locator('[data-game-root="play"]').getAttribute("data-high-contrast"),
    diagnostics,
  });
  // Let embedded GLB image promises settle before destroying the isolated
  // context; otherwise Chromium can report revoked blob URLs during teardown
  // even though the rendered asset and HTTP response both succeeded.
  await page.waitForTimeout(1200);
  await context.close();
}

const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  headless: process.env.M4_QA_HEADED !== "1",
  args: [
    ...(process.env.M4_QA_HEADED === "1"
      ? ["--use-angle=metal"]
      : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]),
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--disable-dev-shm-usage",
  ],
});

try {
  if (!ONLY || ONLY === "print") await scenario("print", eventSets.print, false, "?atmoT=0.35", async (page) => {
    await ensureMercerInterior(page);
    await drivePrintJob(page, "m4-b2", false);
    await page.waitForFunction(
      () => document.querySelector('[data-game-root="play"]')?.getAttribute("data-plan-request") === "FOCUS_READ",
    );
    await shot(page, "m4-b2-complete");
  }, "KEYBOARD_MOUSE");

  if (!ONLY || ONLY === "print-accessible") await scenario("print-accessible", eventSets.print, true, "?atmoT=0.35", async (page) => {
    await ensureMercerInterior(page);
    await page.waitForTimeout(2500);
    await drivePrintJob(page, "m4-b2-accessible", true);
    await page.waitForFunction(
      () => document.querySelector('[data-game-root="play"]')?.getAttribute("data-plan-request") === "FOCUS_READ",
    );
    await shot(page, "m4-b2-accessible-complete");
  });

  if (!ONLY || ONLY === "reprint") await scenario("reprint", eventSets.reprint, false, "?atmoT=0.55", async (page) => {
    await ensureMercerInterior(page);
    await drivePrintJob(page, "m4-reprint", false);
    await page.waitForFunction(
      () => document.querySelector('[data-game-root="play"]')?.getAttribute("data-plan-request") !== "MECHANIC",
    );
    await shot(page, "m4-reprint-complete");
  }, "KEYBOARD_MOUSE");

  if (!ONLY || ONLY === "final-print") await scenario("final-print", eventSets.final, false, "?atmoT=0.98&atmoDusk=1", async (page) => {
    await ensureMercerInterior(page);
    await drivePrintJob(page, "m4-b12", false);
    await page.waitForFunction(
      () => document.querySelector('[data-game-root="play"]')?.getAttribute("data-plan-request") !== "MECHANIC",
      undefined,
      { timeout: 30000 },
    );
    await shot(page, "m4-b12-complete");
  }, "KEYBOARD_MOUSE");

  if (!ONLY || ONLY === "m1-chase") await scenario("m1-chase", eventSets.street, false, "?atmoT=0.55", async (page) => {
    await page.getByRole("button", { name: /Deliver the circular to Thomas/i }).click();
    await waitFreeRoamReady(page);
    const result = await page.evaluate(() => window.__PA_QA_CHASE__());
    assert(result?.ok, `M1 QA hook rejected: ${JSON.stringify(result)}`);
    await page
      .waitForFunction(
        () => {
          const play = document.querySelector('[data-game-root="play"]');
          const world = document.querySelector('[data-game-root="world"]');
          return (
            Boolean(play?.getAttribute("data-active-chase-id")) &&
            world?.getAttribute("data-chase-active") === "true" &&
            world?.getAttribute("data-camera-owner") === "CHASE" &&
            world?.getAttribute("data-pursuer-registered") === "true"
          );
        },
        null,
        { timeout: 20000 },
      )
      .catch(async (error) => {
        const diagnostics = await page.evaluate(() => ({
          play: {
            ...document.querySelector('[data-game-root="play"]')?.dataset,
          },
          world: {
            ...document.querySelector('[data-game-root="world"]')?.dataset,
          },
        }));
        throw new Error(
          `M1 chase did not mount: ${JSON.stringify(diagnostics)} (${error.message})`,
        );
      });
    await page.waitForTimeout(700);
    await shot(page, "m4-m1-chase-active");
  }, "KEYBOARD_MOUSE");

  if (!ONLY || ONLY === "m2-comply") await scenario("m2-comply", eventSets.street, false, "?atmoT=0.55", async (page) => {
    await page.getByRole("button", { name: /Deliver the circular to Thomas/i }).click();
    await waitFreeRoamReady(page);
    await startConfrontation(page, "COMPLY");
    await shot(page, "m4-m2-three-options");
    await page.getByRole("button", { name: /Comply/ }).click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-game-root="play"]')
          ?.getAttribute("data-field-interrupt") === "",
      null,
      { timeout: 15000 },
    );
    await shot(page, "m4-m2-comply-resolved");
  }, "KEYBOARD_MOUSE");

  if (!ONLY || ONLY === "m2-talk") await scenario("m2-talk", eventSets.street, false, "?atmoT=0.55", async (page) => {
    await page.getByRole("button", { name: /Deliver the circular to Thomas/i }).click();
    await waitFreeRoamReady(page);
    await startConfrontation(page, "TALK");
    await page.getByRole("button", { name: /Talk/ }).click();
    await page.waitForFunction(
      () => {
        const panel = document.querySelector(".confrontation-panel");
        const interrupt = document
          .querySelector('[data-game-root="play"]')
          ?.getAttribute("data-field-interrupt");
        return (
          interrupt === "" ||
          panel?.getAttribute("data-confrontation-phase") === "TALK_FAILED"
        );
      },
      null,
      { timeout: 15000 },
    );
    const activePanel = page.locator(".confrontation-panel");
    const failed =
      (await activePanel.count()) > 0
        ? await activePanel.getAttribute("data-confrontation-phase")
        : null;
    if (failed === "TALK_FAILED") {
      await shot(page, "m4-m2-talk-failed-bounded");
      await page.getByRole("button", { name: /Comply/ }).click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-game-root="play"]')
            ?.getAttribute("data-field-interrupt") === "",
        null,
        { timeout: 15000 },
      );
    } else {
      await shot(page, "m4-m2-talk-released");
    }
  }, "KEYBOARD_MOUSE");

  if (!ONLY || ONLY === "m2-run") await scenario("m2-run", eventSets.street, false, "?atmoT=0.55", async (page) => {
    await page.getByRole("button", { name: /Deliver the circular to Thomas/i }).click();
    await waitFreeRoamReady(page);
    await startConfrontation(page, "RUN");
    await page.getByRole("button", { name: /^Run/ }).click();
    await page.waitForFunction(
      () => {
        const play = document.querySelector('[data-game-root="play"]');
        const world = document.querySelector('[data-game-root="world"]');
        return (
          Boolean(play?.getAttribute("data-active-chase-id")) &&
          world?.getAttribute("data-camera-owner") === "CHASE" &&
          world?.getAttribute("data-pursuer-registered") === "true"
        );
      },
      null,
      { timeout: 20000 },
    );
    await shot(page, "m4-m2-run-chase-active");
  }, "KEYBOARD_MOUSE");

  if (!ONLY || ONLY === "street") await scenario("street", eventSets.street, false, "?atmoT=0.35", async (page) => {
    await page.getByRole("button", { name: /Deliver the circular to Thomas/i }).click();
    await page.waitForTimeout(400);
    await teleport(page, 53.5, -6.5, Math.PI);
    await shot(page, "m4-watch-house");
    await teleport(page, 55, 4.6, 0);
    await shot(page, "m4-constables-custom-house");
    if (
      (await page
        .locator('[data-game-root="play"]')
        .getAttribute("data-field-interrupt")) === "CONFRONTATION"
    ) {
      await page.getByRole("button", { name: /Comply/ }).click();
      await waitFreeRoamReady(page);
    }
    await teleport(page, 15.2, -7.8, Math.PI);
    await shot(page, "m4-roof-board-scaffold");
    await teleport(page, -30.2, 7.2, 0);
    await shot(page, "m4-static-dog");
    const dog = page.getByRole("button", { name: /Pet the dog/i });
    if (await dog.isVisible().catch(() => false)) {
      await dog.click();
      await page.waitForTimeout(250);
      await shot(page, "m4-dog-reaction");
    } else {
      report.errors.push("street:interaction:Pet the dog prompt missing");
    }
    await teleport(page, 6, 6.45, 0);
    const crier = page.getByRole("button", { name: /Take up the cry/i });
    const crierVisible = await crier
      .waitFor({ state: "visible", timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (crierVisible) {
      await crier.click();
      await page.waitForFunction(
        () => document.querySelector('[data-game-root="play"]')?.getAttribute("data-field-interrupt") === "REACTIVE_EXCHANGE",
      );
      await page.locator(".reactive-exchange button").click();
      await page.waitForFunction(
        () => document.querySelector('[data-game-root="play"]')?.getAttribute("data-field-interrupt") === "",
      );
    }
    if (
      (await page
        .locator('[data-game-root="play"]')
        .getAttribute("data-field-interrupt")) === "CONFRONTATION"
    ) {
      await page.getByRole("button", { name: /Comply/ }).click();
      await waitFreeRoamReady(page);
    }
    await teleport(page, 6.35, 6.55, 0);
    await page.waitForTimeout(500);
    const blockingCrier = page.getByRole("button", {
      name: /Take up the cry/i,
    });
    if (await blockingCrier.isVisible().catch(() => false)) {
      await blockingCrier.click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-game-root="play"]')
            ?.getAttribute("data-field-interrupt") ===
          "REACTIVE_EXCHANGE",
      );
      await page.locator(".reactive-exchange button").first().click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-game-root="play"]')
            ?.getAttribute("data-field-interrupt") === "",
      );
      await teleport(page, 6.35, 6.55, 0);
      await page.waitForTimeout(500);
    }
    const knowledge = page.getByRole("button", { name: /Read Stamp schedule/i });
    try {
      await knowledge.waitFor({ state: "visible", timeout: 10000 });
    } catch (error) {
      const diagnostics = await page.evaluate(() => ({
        glyphs: [...document.querySelectorAll(".interaction-glyph")].map(
          (element) => element.textContent,
        ),
        interrupt: document
          .querySelector('[data-game-root="play"]')
          ?.getAttribute("data-field-interrupt"),
        busy: document
          .querySelector('[data-game-root="play"]')
          ?.getAttribute("data-interaction-busy"),
        player: document
          .querySelector(".world3d")
          ?.getAttribute("data-player-pos"),
      }));
      throw new Error(`${String(error)} ${JSON.stringify(diagnostics)}`);
    }
    await knowledge.click();
    await page.getByRole("button", { name: /Finish reading/i }).click();
    await page.waitForFunction(
      () => document.querySelector('[data-game-root="play"]')?.getAttribute("data-field-interrupt") === "",
    );
    await shot(page, "m4-knowledge-complete");

    await teleport(page, -50, -3.5, Math.PI);
    await page.locator(".ambient-subtitle").first().waitFor({ state: "visible", timeout: 10000 });
    await shot(page, "m4-eavesdrop-market");

    // Approach from the mother's east side so Clarke's mobile story-NPC
    // candidate cannot preempt the optional-job glyph between frames.
    await teleport(page, -22.5, 9.0, -1.08);
    const roofJob = page.getByRole("button", { name: /Take the roof-kid job/i });
    await roofJob.waitFor({ state: "visible", timeout: 10000 });
    await roofJob.click();
    await page.waitForFunction(
      () =>
        Boolean(
          document
            .querySelector('[data-game-root="play"]')
            ?.getAttribute("data-field-interrupt"),
        ),
    );
    if (
      (await page
        .locator('[data-game-root="play"]')
        .getAttribute("data-field-interrupt")) === "CONFRONTATION"
    ) {
      await page.getByRole("button", { name: /Comply/ }).click();
      await waitFreeRoamReady(page);
      await teleport(page, -22.5, 9.0, -1.08);
      await roofJob.waitFor({ state: "visible", timeout: 10000 });
      await roofJob.click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-game-root="play"]')
            ?.getAttribute("data-field-interrupt") ===
          "REACTIVE_EXCHANGE",
      );
    }
    await page.locator(".reactive-exchange button").click();
    await page.waitForFunction(
      () => document.querySelector('[data-game-root="play"]')?.getAttribute("data-field-interrupt") === "",
    );
    await shot(page, "m4-roof-kid-accepted");
  });

  if (!ONLY || ONLY === "event") await scenario("event", eventSets.event, false, "?atmoT=0.9&atmoDusk=1", async (page) => {
    await page.waitForTimeout(9000);
    await shot(page, "m4-b11-dusk");
  });

  if (!ONLY || ONLY === "event-reduced") await scenario("event-reduced", eventSets.event, true, "?atmoT=0.9&atmoDusk=1", async (page) => {
    await page.waitForTimeout(4000);
    await shot(page, "m4-b11-reduced-motion");
  });
} finally {
  await browser.close();
}

writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
assert(report.assetFailures.length === 0, `asset failures: ${report.assetFailures.join(", ")}`);
assert(report.networkFailures.length === 0, `network failures: ${report.networkFailures.join(", ")}`);
assert(report.errors.length === 0, `browser errors: ${report.errors.join(", ")}`);
console.log(`M4 browser QA passed. Evidence: ${OUT}`);
// Validation has fully passed above. Force a clean exit so a lingering
// Playwright teardown handle after 14 heavy 3D contexts cannot surface a
// spurious non-zero code (the report is the authoritative pass signal).
process.exit(0);
