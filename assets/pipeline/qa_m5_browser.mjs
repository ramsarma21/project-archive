import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PASS_URL = process.env.M5_QA_URL ?? "http://127.0.0.1:4177/";
const OUT = resolve(process.env.M5_QA_OUT ?? "test-results/m5-browser-qa");
const EXECUTABLE =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SEED = "a5".repeat(32);
mkdirSync(OUT, { recursive: true });

const report = {
  baseUrl: PASS_URL,
  scenarios: [],
  screenshots: [],
  errors: [],
  diagnostics: [],
  nonBlack: {},
};

function CET(condition, message) {
  if (!condition) throw new Error(message);
}

async function seedProfile(page, profileId, preferences) {
  await page.goto(PASS_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() =>
    document.body.textContent?.includes("Project Archive")
  );
  await page.evaluate(
    async ({ profileId, preferences, seed }) => {
      const request = indexedDB.open("project-archive");
      await new Promise((resolvePromise, reject) => {
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const tx = database.transaction(["profiles", "saves"], "readwrite");
          const profiles = tx.objectStore("profiles");
          const saves = tx.objectStore("saves");
          profiles.clear();
          saves.clear();
          profiles.put({
            profileId,
            accountId: `local:${profileId}`,
            displayName: `M5 QA ${profileId}`,
            variationRootSeedHex: seed,
            source: "LOCAL",
            createdAt: "2026-07-22T00:00:00.000Z",
            onboarding: {
              version: 1,
              readingSpeed: "BRISK",
              captions: true,
              audioDescription: false,
              inputMethod: preferences.keyboardOnly
                ? "KEYBOARD_ONLY"
                : "KEYBOARD_MOUSE",
              archiveAssistAutoOffer: true,
              highContrast: preferences.highContrast,
              reducedMotion: preferences.reducedMotion,
              chaseAssist: "AUTO_STAMINA",
              primersSeen: ["ARCHIVE", "MOVEMENT", "READ", "WORK", "CHOICE"],
              completedAt: "2026-07-22T00:00:00.000Z",
            },
          });
          saves.put({
            profileId,
            chapterId: "PA.SEA01.CH02.BOSTON.v1",
            packageId: "PA.BOSTON.DAY1.TEXT.v1",
            flowVersion: 5,
            committedEvents: [],
            revision: 1,
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
    { profileId, preferences, seed: SEED },
  );
}

async function enter(page, target) {
  await page.goto(`${PASS_URL}?qaCp1=${target}`, {
    waitUntil: "domcontentloaded",
  });
  const play = page.getByRole("button", { name: "Play" }).first();
  await play.waitFor({ state: "visible", timeout: 20000 });
  await play.click();
  await page.waitForSelector(".checkpoint-debrief", { timeout: 30000 });
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
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      sum +=
        pixels[index] * 0.2126 +
        pixels[index + 1] * 0.7152 +
        pixels[index + 2] * 0.0722;
    }
    return sum / (pixels.length / 4);
  }, buffer.toString("base64"));
  CET(luminance > 8, `${name} screenshot is effectively black`);
  report.screenshots.push(path);
  report.nonBlack[name] = luminance;
}

function watch(page) {
  page.on("pageerror", (error) => report.errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      message.text().startsWith("THREE.GLTFLoader: Couldn't load texture blob:")
    ) {
      report.diagnostics.push(
        `synthetic CP1 bootstrap asset teardown: ${message.text()}`,
      );
      return;
    }
    if (
      message.type() === "error" &&
      !message.text().includes("Failed to load resource")
    ) {
      report.errors.push(`console: ${message.text()}`);
    }
  });
  page.on("response", (response) => {
    const expectedOfflineApi =
      response.url().includes("/v1/health") ||
      response.url().includes("/v1/auth/me");
    if (response.status() >= 400 && !expectedOfflineApi) {
      report.errors.push(`http ${response.status()}: ${response.url()}`);
    }
  });
}

const browser = await chromium.launch({
  headless: true,
  executablePath: EXECUTABLE,
  args: [
    "--use-angle=metal",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--disable-dev-shm-usage",
  ],
});

try {
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      hasTouch: true,
    });
    const page = await context.newPage();
    watch(page);
    await seedProfile(page, "m5-normal", {
      keyboardOnly: false,
      highContrast: false,
      reducedMotion: false,
    });
    await enter(page, "question");
    const options = page.locator(".checkpoint-option");
    CET((await options.count()) <= 3, "CP1 exposed more than three choices");
    const text = await page.locator(".checkpoint-debrief").innerText();
    CET(!/%|predictor|STAAR score|Standing \d/i.test(text), "forbidden score language rendered");
    await screenshot(page, "cp1-question-normal");
    const firstStem = await page.locator(".checkpoint-stem").innerText();
    await options.first().focus();
    await page.keyboard.press("Enter");
    await page
      .locator(".checkpoint-answer-feedback")
      .waitFor({ state: "visible", timeout: 10000 });
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      (stem) =>
        document.querySelector(".checkpoint-stem")?.textContent !== stem,
      firstStem,
    );
    CET(
      /2 OF/.test(await page.locator(".checkpoint-debrief").innerText()),
      "keyboard answer did not advance progress",
    );
    await enter(page, "question");
    CET(
      /2 OF/.test(await page.locator(".checkpoint-debrief").innerText()),
      "reload did not restore exact CP1 progress",
    );
    await page.locator(".checkpoint-option").first().tap();
    await page
      .locator(".checkpoint-answer-feedback")
      .getByRole("button", { name: /Continue to/i })
      .tap();
    report.scenarios.push("normal/keyboard/touch/resume");
    await page.waitForTimeout(5000);
    await context.close();
  }

  {
    const context = await browser.newContext({
      viewport: { width: 1024, height: 800 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    watch(page);
    await seedProfile(page, "m5-accessible", {
      keyboardOnly: true,
      highContrast: true,
      reducedMotion: true,
    });
    await enter(page, "review");
    await page.waitForSelector('[data-checkpoint-phase="REVIEW"]');
    CET(
      (await page.locator(".checkpoint-enrichment-summary").count()) === 0,
      "empty enrichment section rendered",
    );
    const animation = await page.locator(".checkpoint-debrief").evaluate(
      (element) => getComputedStyle(element).animationName,
    );
    CET(animation === "none", "reduced-motion CP1 root is animated");
    CET(
      (await page.locator(".checkpoint-macros li").count()) === 3,
      "review omitted a required macro",
    );
    await screenshot(page, "cp1-review-high-contrast-reduced-motion");
    await page.getByRole("button", { name: "FILE IT" }).click();
    await page.getByRole("button", { name: "PRINT THE RECORD" }).click();
    await page.waitForSelector('[data-checkpoint-phase="TRANSITION"]');
    await screenshot(page, "cp1-transition");
    await page.getByRole("button", { name: "DONE FOR THE DAY" }).click();
    await page.waitForFunction(
      async () => {
        const request = indexedDB.open("project-archive");
        const database = await new Promise((resolvePromise, reject) => {
          request.onsuccess = () => resolvePromise(request.result);
          request.onerror = () => reject(request.error);
        });
        const transaction = database.transaction(["saves"], "readonly");
        const saves = await new Promise((resolvePromise, reject) => {
          const getAll = transaction.objectStore("saves").getAll();
          getAll.onsuccess = () => resolvePromise(getAll.result);
          getAll.onerror = () => reject(getAll.error);
        });
        database.close();
        return saves.some((save) =>
          (save.committedEvents ?? []).some(
            (event) => event.type === "ACT_TRANSITIONED",
          ),
        );
      },
      null,
      { timeout: 30000 },
    );
    const transitioned = await page.evaluate(async () => {
      const request = indexedDB.open("project-archive");
      const database = await new Promise((resolvePromise, reject) => {
        request.onsuccess = () => resolvePromise(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction(["saves"], "readonly");
      const saves = await new Promise((resolvePromise, reject) => {
        const getAll = transaction.objectStore("saves").getAll();
        getAll.onsuccess = () => resolvePromise(getAll.result);
        getAll.onerror = () => reject(getAll.error);
      });
      database.close();
      return saves.some((save) =>
        (save.committedEvents ?? []).some(
          (event) => event.type === "ACT_TRANSITIONED",
        ),
      );
    });
    CET(
      transitioned,
      "Act transition was not committed",
    );
    report.scenarios.push("high-contrast/reduced-motion/commit/transition");
    await page.waitForTimeout(5000);
    await context.close();
  }
} finally {
  await Promise.race([
    browser.close().catch(() => undefined),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 3000)),
  ]);
}

CET(report.errors.length === 0, report.errors.join("\n"));
writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
