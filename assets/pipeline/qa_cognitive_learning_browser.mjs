import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CP1_BANK_REGISTRY,
  CP1_PRODUCTION_BANK,
  createDay1Session,
  openResponsePackages,
  resolveRubricObservation,
} from "../../packages/runtime/src/index.ts";

const BASE_URL =
  process.env.COGNITIVE_QA_URL ?? "http://127.0.0.1:5183/";
const OUT = resolve(
  process.env.COGNITIVE_QA_OUT ??
    "test-results/cognitive-learning-browser",
);
const EXECUTABLE =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SEED = "c7".repeat(32);
mkdirSync(OUT, { recursive: true });

const report = {
  baseUrl: BASE_URL,
  scenarios: [],
  screenshots: [],
  errors: [],
  nonBlack: {},
  assertions: {},
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function mechanicResult(request) {
  if (request.params.kind === "PRESS") {
    return { kind: "PRESS", stopOffset: 0.5 };
  }
  if (request.params.kind === "EFFORT") {
    return { kind: "EFFORT", holdMs: 1_500 };
  }
  if (request.params.kind === "PLACE") {
    return { kind: "PLACE", alignment: 0.5 };
  }
  if (request.params.kind === "PRINT_JOB") {
    return {
      kind: "PRINT_JOB",
      phases: {
        catch: 0.95,
        ink: 0.95,
        register: 0.95,
        pull: 0.95,
        peel: 0.95,
      },
      quality: "CRISP",
      accessible: true,
    };
  }
  if (request.params.kind === "HAUL_JOB") {
    return {
      kind: "HAUL_JOB",
      phases: { load: 0.9, balance: 0.9, thread: 0.9 },
      accessible: true,
    };
  }
  if (request.params.kind === "POST_JOB") {
    return {
      kind: "POST_JOB",
      phases: { lineUp: 0.9, tackLeft: 0.9, tackRight: 0.9 },
      accessible: true,
    };
  }
  return {
    kind: "SORT",
    assignments: (request.params.sortItems ?? []).map((item) => ({
      itemId: item.itemId,
      bucketId: ["deed", "writ", "newspaper"].includes(item.itemId)
        ? "NEEDS_STAMP"
        : "DOES_NOT",
    })),
  };
}

function ordinaryResponse(request) {
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
  if (request.kind === "CHECKPOINT_DEBRIEF") {
    throw new Error("QA source bootstrap unexpectedly reached CP1");
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

function sourceReadyEvents({
  spacing = true,
  activePrompt = false,
  limitedPrompt = false,
} = {}) {
  const session = createDay1Session({
    variationRootSeedHex: SEED,
    assessmentMode: "QA_DRAFT",
    openResponseContentMode: "AUTHOR_DRAFT_QA",
  });
  for (let step = 0; step < 200; step += 1) {
    if (session.plan?.request.kind === "FREE_ROAM") break;
    assert(session.plan, "runtime ended before FREE_ROAM");
    session.advance(ordinaryResponse(session.plan.request));
  }
  assert(
    session.plan?.request.kind === "FREE_ROAM",
    "no safe FREE_ROAM boundary",
  );
  const packages = openResponsePackages({ allowAuthorDraft: true });
  const selectedPackages = limitedPrompt ? [packages[0]] : packages;
  const sources = [
    ...new Set(
      selectedPackages.flatMap((entry) => entry.requiredSourcePacketIds),
    ),
  ];
  const micros = [
    ...new Set(
      selectedPackages.flatMap((entry) => entry.requiredMicroConceptIds),
    ),
  ];
  let ordinal = session.ctx.world.currentInteractionOrdinal;
  for (const sourceId of sources) {
    ordinal += 1;
    const interruptId = `QA_SOURCE_${ordinal}`;
    session.advance({
      type: "FIELD_INTERRUPT_STARTED",
      eventId: `${interruptId}_START`,
      interruptId,
      interruptKind: "REACTIVE_EXCHANGE",
      sourceId,
    });
    session.advance({
      type: "FIELD_REACTIVE_COMPLETED",
      eventId: `${interruptId}_COMPLETE`,
      interruptId,
      completion: {
        interactionId: `QA:${sourceId}:${ordinal}`,
        sourceId,
        outcomeId: "QA_ENGAGED",
        micros,
      },
    });
    session.advance({
      type: "FIELD_INTERRUPT_RESOLVED",
      eventId: `${interruptId}_RESOLVED`,
      interruptId,
      outcome: "QA_ENGAGED",
    });
  }
  if (spacing) {
    for (let index = 0; index < 3; index += 1) {
      ordinal += 1;
      const interruptId = `QA_SPACING_${ordinal}`;
      session.advance({
        type: "FIELD_INTERRUPT_STARTED",
        eventId: `${interruptId}_START`,
        interruptId,
        interruptKind: "REACTIVE_EXCHANGE",
        sourceId: `QA-SPACING-${index}`,
      });
      session.advance({
        type: "FIELD_REACTIVE_COMPLETED",
        eventId: `${interruptId}_COMPLETE`,
        interruptId,
        completion: {
          interactionId: `QA:SPACING:${ordinal}`,
          sourceId: `QA-SPACING-${index}`,
          outcomeId: "COMPLETE",
        },
      });
      session.advance({
        type: "FIELD_INTERRUPT_RESOLVED",
        eventId: `${interruptId}_RESOLVED`,
        interruptId,
        outcome: "COMPLETE",
      });
    }
  }
  if (activePrompt) {
    const prompt = session.ctx.eligibleOpenResponsePrompts()[0];
    assert(prompt, "no prompt eligible for resume fixture");
    session.advance({
      type: "FIELD_OPEN_RESPONSE_STARTED",
      eventId: "QA_OPEN_RESUME_START",
      interruptId: "QA_OPEN_RESUME",
      promptId: prompt.promptId,
    });
  }
  return [...session.committedEvents];
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

async function seedProfile(page, input) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() =>
    document.body.textContent?.includes("Project Archive"),
  );
  await evaluateStable(
    page,
    async ({ profile, events, seed }) => {
      const request = indexedDB.open("project-archive");
      await new Promise((resolvePromise, reject) => {
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const tx = database.transaction(["profiles", "saves"], "readwrite");
          tx.objectStore("profiles").clear();
          tx.objectStore("saves").clear();
          tx.objectStore("profiles").put(profile);
          tx.objectStore("saves").put({
            profileId: profile.profileId,
            chapterId: "PA.SEA01.CH02.BOSTON.v1",
            packageId: "PA.BOSTON.DAY1.TEXT.v1",
            variationRootSeedHex: seed,
            flowVersion: 5,
            committedEvents: events,
            revision: events.length,
            status: "IN_PROGRESS",
            updatedAt: "2026-07-22T00:00:00.000Z",
          });
          tx.oncomplete = () => {
            database.close();
            resolvePromise();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    { profile: input.profile, events: input.events, seed: SEED },
  );
}

function profile(id, preferences = {}, source = "LOCAL") {
  return {
    profileId: id,
    accountId: source === "LOCAL" ? `local:${id}` : `account:${id}`,
    displayName: `Cognitive QA ${id}`,
    variationRootSeedHex: SEED,
    source,
    createdAt: "2026-07-22T00:00:00.000Z",
    cloudRevision: 0,
    onboarding: {
      version: 1,
      readingSpeed: "BRISK",
      captions: true,
      audioDescription: false,
      inputMethod: preferences.keyboardOnly
        ? "KEYBOARD_ONLY"
        : "KEYBOARD_MOUSE",
      archiveAssistAutoOffer: true,
      highContrast: Boolean(preferences.highContrast),
      reducedMotion: Boolean(preferences.reducedMotion),
      chaseAssist: "AUTO_STAMINA",
      primersSeen: ["ARCHIVE", "MOVEMENT", "READ", "WORK", "CHOICE"],
      completedAt: "2026-07-22T00:00:00.000Z",
    },
  };
}

async function enterPlay(page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  const play = page.getByRole("button", { name: "Play" }).first();
  await play.waitFor({ state: "visible", timeout: 20_000 });
  await play.click();
  await page.waitForSelector('[data-game-root="play"]', {
    timeout: 30_000,
  });
  await page.waitForFunction(
    () =>
      document.querySelector('[data-game-root="play"]')?.getAttribute(
        "data-speaking",
      ) === "false",
    null,
    { timeout: 60_000 },
  );
}

function watch(page, scenario) {
  page.on("pageerror", (error) =>
    report.errors.push(`${scenario} pageerror: ${error.message}`),
  );
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().includes("Failed to load resource")
    ) {
      report.errors.push(`${scenario} console: ${message.text()}`);
    }
  });
  page.on("response", (response) => {
    const expectedOfflineApi = response.url().includes("/v1/health");
    if (response.status() >= 400 && !expectedOfflineApi) {
      report.errors.push(
        `${scenario} http ${response.status()}: ${response.url()}`,
      );
    }
  });
}

async function screenshot(page, name) {
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
    const pixels = context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height,
    ).data;
    let sum = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      sum +=
        pixels[index] * 0.2126 +
        pixels[index + 1] * 0.7152 +
        pixels[index + 2] * 0.0722;
    }
    return sum / (pixels.length / 4);
  }, buffer.toString("base64"));
  assert(luminance > 8, `${name} screenshot is effectively black`);
  report.screenshots.push(path);
  report.nonBlack[name] = luminance;
}

async function submitPanel(page, authenticated = false) {
  const panel = page.locator(".open-response-panel");
  await panel.waitFor({ state: "visible" });
  const underlyingEnabled = await page
    .locator(
      ".world-controls-overlay button:not([disabled]), .archive-ov, .context-inspect-card",
    )
    .count();
  assert(underlyingEnabled === 0, "underlying controls stacked under response");
  await panel
    .locator("textarea")
    .fill(
      "The notice gives an official reason, while the local source shows what people in Boston experienced and what the official wording leaves out.",
    );
  if (authenticated) {
    const submit = panel.getByRole("button", {
      name: "Submit reflection",
    });
    assert(await submit.isDisabled(), "consent-denied submit was enabled");
    await panel.locator('input[type="checkbox"]').check();
  }
  await panel
    .getByRole("button", { name: "Submit reflection" })
    .click();
  await page.waitForSelector(".open-response-feedback", {
    timeout: 10_000,
  });
}

async function mockAuthenticatedApi(page, googleProfile, mode) {
  const content = openResponsePackages({ allowAuthorDraft: true })[0];
  const allowedEvidenceIds = content.sourcePackets.flatMap((packet) =>
    packet.evidence.map((entry) => entry.evidenceId),
  );
  const observation = {
    schemaVersion: "0.1.0-draft",
    itemId: content.item.itemId,
    itemVersion: content.item.itemVersion,
    topicality: "ON_TOPIC",
    criteria: content.rubric.criteria.map((criterion) => ({
      criterionId: criterion.criterionId,
      level: "STRONG",
    })),
    citedEvidenceIds: allowedEvidenceIds.slice(0, 2),
    technical: { confidence: "HIGH" },
  };
  const resolution = resolveRubricObservation(
    content.rubric,
    observation,
    {
      itemId: content.item.itemId,
      itemVersion: content.item.itemVersion,
      allowedEvidenceIds: new Set(allowedEvidenceIds),
    },
  );
  await page.route("**/v1/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (url.endsWith("/v1/health")) {
      return route.fulfill({
        json: { ok: true, google: true, database: true },
      });
    }
    if (url.endsWith("/v1/session")) {
      return route.fulfill({
        json: {
          authenticated: true,
          csrfToken: "qa-csrf",
          profile: {
            profileId: googleProfile.profileId,
            accountId: googleProfile.accountId,
            displayName: googleProfile.displayName,
            variationRootSeedHex: googleProfile.variationRootSeedHex,
            onboarding: googleProfile.onboarding,
            createdAt: googleProfile.createdAt,
          },
        },
      });
    }
    if (url.endsWith("/save") && method === "GET") {
      return route.fulfill({ json: { save: null } });
    }
    if (url.endsWith("/mastery")) {
      return route.fulfill({ json: { mastery: null, saveRevision: null } });
    }
    if (url.endsWith("/save") && method === "PUT") {
      return route.fulfill({ json: { ok: true, revision: 1 } });
    }
    if (url.includes("/assessments/") && url.endsWith("/responses")) {
      if (mode === "timeout") {
        await new Promise((resolvePromise) =>
          setTimeout(resolvePromise, 5_000),
        );
      }
      return route.fulfill({
        json: {
          response: {
            responseId: "qa-encrypted-response",
            attemptId: `BOS.ACT01.${googleProfile.profileId}`,
            promptId: content.prompt.promptId,
            promptVersion: content.prompt.version,
            submittedAt: "2026-07-22T21:00:00.000Z",
            storage: "ENCRYPTED_SERVER",
          },
          observation,
          resolution,
        },
      });
    }
    return route.fulfill({ json: { ok: true } });
  });
}

const browser = await chromium.launch({
  headless: true,
  executablePath: EXECUTABLE,
  args: ["--use-angle=swiftshader", "--enable-webgl"],
});

try {
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      hasTouch: true,
    });
    const page = await context.newPage();
    watch(page, "offline-normal");
    const events = sourceReadyEvents();
    await seedProfile(page, {
      profile: profile("offline-normal"),
      events,
    });
    await enterPlay(page);
    const root = page.locator('[data-game-root="play"]');
    const eligible = (await root.getAttribute("data-open-response-eligible"))
      .split(",")
      .filter(Boolean);
    assert(eligible.length === 12, `expected 12 eligible, got ${eligible.length}`);
    const followups = await root.getAttribute("data-npc-followups");
    for (const npc of [
      "abigail",
      "thomas",
      "sarah",
      "pike",
      "clarke",
      "rider",
    ]) {
      assert(followups.includes(`${npc}:`), `${npc} followup not wired`);
    }
    const connections = (
      await root.getAttribute("data-archive-connections")
    )
      .split(",")
      .filter(Boolean);
    assert(connections.length === 5, "not all Archive Connections unlocked");
    const optionalOffer = page.locator(".open-response-offer");
    if ((await optionalOffer.count()) === 0) {
      const diagnostics = await root.evaluate((element) => ({
        request: element.getAttribute("data-plan-request"),
        interrupt: element.getAttribute("data-field-interrupt"),
        speaking: element.getAttribute("data-speaking"),
        interactionBusy: element.getAttribute("data-interaction-busy"),
        text: element.textContent?.slice(-800),
      }));
      throw new Error(
        `optional offer missing: ${JSON.stringify(diagnostics)}`,
      );
    }
    await optionalOffer.click();
    await submitPanel(page, false);
    const feedbackText = await page
      .locator(".open-response-feedback")
      .innerText();
    assert(
      feedbackText.includes("Authored fallback"),
      "offline authored fallback missing",
    );
    await screenshot(page, "offline-fallback-normal");
    await page.waitForTimeout(1_000);
    await page
      .getByRole("button", {
        name: "Return to the exact prior objective",
      })
      .click();
    await page.waitForSelector(".open-response-panel", {
      state: "detached",
    });
    const saveEvents = await page.evaluate(
      async (profileId) => {
        const request = indexedDB.open("project-archive");
        const database = await new Promise((resolvePromise, reject) => {
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolvePromise(request.result);
        });
        const tx = database.transaction("saves", "readonly");
        const get = tx.objectStore("saves").get(profileId);
        const save = await new Promise((resolvePromise, reject) => {
          get.onerror = () => reject(get.error);
          get.onsuccess = () => resolvePromise(get.result);
        });
        database.close();
        return save.committedEvents;
      },
      "offline-normal",
    );
    assert(
      !JSON.stringify(saveEvents).includes("The notice gives"),
      "raw response leaked into save events",
    );
    await page.keyboard.press("Tab");
    await page.getByRole("button", { name: "Connections" }).click();
    const artifactImages = page.locator(
      ".archive-connection-artifacts img",
    );
    assert(
      (await artifactImages.count()) >= 5,
      "source-comparison artifacts were not reused in Archive",
    );
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".archive-connection-artifacts img")].every(
          (image) => image.complete,
        ),
      null,
      { timeout: 15_000 },
    );
    const failedArtifacts = await artifactImages.evaluateAll((images) =>
      images
        .filter((image) => !image.complete || image.naturalWidth === 0)
        .map((image) => image.getAttribute("src")),
    );
    assert(
      failedArtifacts.length === 0,
      `imported source artifacts failed: ${failedArtifacts.join(",")}`,
    );
    await screenshot(page, "archive-connections-imported-artifacts");
    await page.keyboard.press("Escape");
    report.scenarios.push("offline-normal");
    await context.close();
  }

  {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    watch(page, "mock-timeout");
    const googleProfile = profile("mock-timeout", {}, "GOOGLE");
    await mockAuthenticatedApi(page, googleProfile, "timeout");
    await seedProfile(page, {
      profile: googleProfile,
      events: sourceReadyEvents(),
    });
    await enterPlay(page);
    await page.locator(".open-response-offer").click();
    await submitPanel(page, true);
    const text = await page.locator(".open-response-feedback").innerText();
    assert(
      text.includes("Authored fallback"),
      "timeout did not use authored fallback",
    );
    assert(
      text.includes("not retained"),
      "timeout impersonated encrypted retention",
    );
    report.scenarios.push("mock-timeout");
    await context.close();
  }

  {
    const context = await browser.newContext({
      viewport: { width: 1024, height: 768 },
      hasTouch: true,
    });
    const page = await context.newPage();
    watch(page, "accessible-resume");
    await seedProfile(page, {
      profile: profile("accessible-resume", {
        keyboardOnly: true,
        highContrast: true,
        reducedMotion: true,
      }),
      events: sourceReadyEvents({ activePrompt: true }),
    });
    await enterPlay(page);
    await page.waitForSelector(".open-response-panel");
    assert(
      (await page.locator("html").getAttribute("class")).includes(
        "pa-high-contrast",
      ),
      "high contrast class missing",
    );
    await page.locator(".open-response-panel textarea").focus();
    await page.keyboard.type(
      "A resumed keyboard response compares the official source with Boston's local experience and names the difference.",
    );
    await page.keyboard.press("Control+Enter");
    await page.waitForSelector(".open-response-feedback");
    await screenshot(page, "resume-high-contrast-reduced-touch");
    report.scenarios.push("accessible-resume");
    await context.close();
  }

  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    watch(page, "mock-online");
    const googleProfile = profile("mock-online", {}, "GOOGLE");
    await mockAuthenticatedApi(page, googleProfile, "classified");
    await seedProfile(page, {
      profile: googleProfile,
      events: sourceReadyEvents(),
    });
    await enterPlay(page);
    const authorityBefore = await page
      .locator('[data-game-root="play"]')
      .evaluate((root) => ({
        location: root.getAttribute("data-runtime-location"),
        clock: root.getAttribute("data-clock-spent"),
        carried: root.getAttribute("data-carried-object-ids"),
        checkpoint: root.getAttribute("data-checkpoint-status"),
      }));
    await page.locator(".open-response-offer").click();
    await submitPanel(page, true);
    const text = await page.locator(".open-response-feedback").innerText();
    assert(
      text.includes("two sources side by side"),
      "authored classified feedback missing",
    );
    assert(
      !text.includes("STRONG_RESPONSE"),
      "internal classifier outcome exposed",
    );
    const authorityAfter = await page
      .locator('[data-game-root="play"]')
      .evaluate((root) => ({
        location: root.getAttribute("data-runtime-location"),
        clock: root.getAttribute("data-clock-spent"),
        carried: root.getAttribute("data-carried-object-ids"),
        checkpoint: root.getAttribute("data-checkpoint-status"),
      }));
    assert(
      JSON.stringify(authorityAfter) ===
        JSON.stringify(authorityBefore),
      "classifier result changed gameplay authority fields",
    );
    await screenshot(page, "mock-online-classified-retained");
    report.scenarios.push("mock-online");
    await context.close();
  }

  {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    watch(page, "no-immediate-prompt");
    await seedProfile(page, {
      profile: profile("no-immediate-prompt"),
      events: sourceReadyEvents({
        spacing: false,
        limitedPrompt: true,
      }),
    });
    await enterPlay(page);
    assert(
      (await page
        .locator('[data-game-root="play"]')
        .getAttribute("data-open-response-eligible")) === "",
      "prompt appeared immediately after source engagement",
    );
    report.scenarios.push("no-immediate-prompt");
    await context.close();
  }

  report.assertions = {
    sourcePromptCount: 12,
    npcFollowups: 6,
    archiveConnections: 5,
    rawTextInSave: false,
    progressionAuthority: false,
    browserErrors: report.errors.length,
  };
  assert(report.errors.length === 0, report.errors.join("\n"));
} finally {
  await browser.close();
  writeFileSync(
    resolve(OUT, "report.json"),
    JSON.stringify(report, null, 2),
  );
}

console.log(JSON.stringify(report, null, 2));

