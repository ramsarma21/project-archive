// Targeted browser QA for the production doorway contract. Uses the app's
// dev-only semantic teleport/door hooks; no runtime/save/quest contracts are
// mutated. Captures closed/half/full exterior and interior states in day/dusk,
// plus console/page/network failures.
import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.argv[2] ?? "assets/build/door-browser-qa");
const BASE_URL = process.env.DOOR_QA_URL ?? "http://127.0.0.1:5173/";
mkdirSync(OUT, { recursive: true });
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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
const diagnostics = [];
page.on("console", (message) => {
  if (
    message.type() === "error" &&
    !message.text().includes("Failed to load resource")
  ) errors.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => errors.push(`page: ${String(error)}`));
page.on("response", (response) => {
  if (response.url().includes("/world/") && response.status() >= 400) {
    errors.push(`asset ${response.status()}: ${response.url()}`);
  } else if (response.status() >= 400) {
    diagnostics.push(`http ${response.status()}: ${response.url()}`);
  }
});

async function enterWorld(url) {
  await page.goto(url, { waitUntil: "networkidle" });
  const create = page.locator('button:has-text("Create")');
  if (await create.count()) {
    const input = page.locator('input[placeholder="Display name"]');
    if (await input.count()) await input.fill("DoorQA");
    await create.click();
    await page.waitForTimeout(600);
  }
  for (let step = 0; step < 3; step++) {
    const continueButton = page.getByRole("button", { name: "Continue calibration" });
    const beginButton = page.getByRole("button", { name: "Begin synchronization" });
    if (await continueButton.count()) await continueButton.click();
    else if (await beginButton.count()) await beginButton.click();
    else break;
    await page.waitForTimeout(500);
  }
  const play = page.locator('button:has-text("Play")').first();
  if (await play.count()) {
    await play.click();
    await page.waitForTimeout(6500);
  }
  for (let i = 0; i < 30; i++) {
    const qaReady = await page.evaluate(
      () => typeof window.__PA_QA_TELEPORT__ === "function" &&
        typeof window.__PA_QA_DOOR__ === "function",
    );
    if (qaReady) break;
    const continueCalibration = page.getByRole("button", { name: "Continue calibration" });
    const beginSynchronization = page.getByRole("button", { name: "Begin synchronization" });
    if (await continueCalibration.count()) {
      await continueCalibration.click();
      await page.waitForTimeout(500);
      continue;
    }
    if (await beginSynchronization.count()) {
      await beginSynchronization.click();
      await page.waitForTimeout(700);
      const delayedPlay = page.locator('button:has-text("Play")').first();
      if (await delayedPlay.count()) await delayedPlay.click();
      await page.waitForTimeout(6500);
      continue;
    }
    const sync = page.locator("button:visible").filter({ hasText: /^Synchronize$/ }).first();
    if (await sync.count() && await sync.isEnabled()) {
      await sync.click();
      await page.waitForTimeout(700);
      continue;
    }
    const acknowledge = page.getByRole("button", { name: "ACKNOWLEDGE" });
    if (await acknowledge.count() && await acknowledge.isEnabled()) {
      await acknowledge.click();
      await page.waitForTimeout(900);
      continue;
    }
    const choice = page.locator(".choice-panel button.choice:visible:not([disabled])").first();
    if (await choice.count()) {
      await choice.click();
      await page.waitForTimeout(900);
      continue;
    }
    const button = page.locator(".dock button.btn-primary").first();
    if (await button.count()) {
      const label = (await button.textContent())?.trim() ?? "";
      if (label && !label.startsWith("Mastery")) {
        await button.click();
        await page.waitForTimeout(750);
        continue;
      }
    }
    await page.waitForTimeout(500);
  }
  console.log("BOOTSTRAP URL", page.url());
  console.log("QA HOOKS", await page.evaluate(() => ({
    teleport: typeof window.__PA_QA_TELEPORT__,
    door: typeof window.__PA_QA_DOOR__,
  })));
  console.log("BOOTSTRAP BUTTONS", await page.locator("button").allTextContents());
  console.log("BOOTSTRAP TEXT", (await page.locator("body").innerText()).slice(0, 1200));
  await page.screenshot({ path: resolve(OUT, "bootstrap.png") });
  await page.waitForSelector(".world3d canvas", { timeout: 20000 });
  await page.waitForFunction(
    () => typeof window.__PA_QA_TELEPORT__ === "function" &&
      typeof window.__PA_QA_DOOR__ === "function",
    null,
    { timeout: 10000 },
  );
  await page.waitForTimeout(5000);
}

async function stage({ x, z, yaw, target = null, interior }) {
  await page.evaluate(
    ({ x, z, yaw, target, interior }) => {
      window.__PA_QA_DOOR__(target, interior);
      window.__PA_QA_TELEPORT__(x, z, yaw);
    },
    { x, z, yaw, target, interior },
  );
  await page.waitForTimeout(250);
  for (let i = 0; i < 4; i++) {
    const acknowledge = page.getByRole("button", { name: "ACKNOWLEDGE" });
    if (!(await acknowledge.count()) || !(await acknowledge.isVisible())) break;
    await acknowledge.click();
    await page.waitForTimeout(650);
  }
}

async function shot(name) {
  await page.screenshot({ path: resolve(OUT, `${name}.png`) });
}

async function exteriorSequence(name, pose, target) {
  await stage({ ...pose, target: null, interior: null });
  await page.waitForTimeout(1400);
  await shot(`${name}-closed`);
  await stage({ ...pose, target });
  await page.waitForTimeout(600);
  await shot(`${name}-half`);
  await page.waitForTimeout(850);
  await shot(`${name}-open`);
  await stage({ ...pose, target: null });
  await page.waitForTimeout(1400);
}

async function interiorSequence(name, pose, interior) {
  await stage({ ...pose, target: null, interior });
  await page.waitForTimeout(1400);
  await shot(`${name}-closed`);
  await stage({ ...pose, target: "STREET" });
  await page.waitForTimeout(600);
  await shot(`${name}-half`);
  await page.waitForTimeout(850);
  await shot(`${name}-open`);
  await stage({ ...pose, target: null });
  await page.waitForTimeout(1400);
}

await enterWorld(`${BASE_URL}?atmoT=0.25`);
await stage({ x: -6, z: 1.5, yaw: Math.PI / 2, target: null, interior: null });
await page.waitForTimeout(1600);
await stage({ x: -6, z: 1.5, yaw: Math.PI / 2, target: null, interior: null });

if (process.env.DOOR_QA_QUICK === "1") {
  if (process.env.DOOR_QA_ONE !== "rowS3") {
    await exteriorSequence("final-north-warehouseN2", { x: -138.45, z: -10.5, yaw: Math.PI }, "EXPLORE_warehouseN2");
  }
  await exteriorSequence("final-south-rowS3", { x: -39.3, z: 9.7, yaw: 0 }, "EXPLORE_rowS3");
  if (process.env.DOOR_QA_ONE !== "rowS3") {
    await exteriorSequence("final-north-thomas", { x: -72, z: -8.5, yaw: Math.PI }, "THOMAS_CIRCULAR");
  }
  const quickReport = {
    generatedAt: new Date().toISOString(),
    screenshots: process.env.DOOR_QA_ONE === "rowS3" ? 3 : 9,
    errors: [...new Set(errors)],
    diagnostics: [...new Set(diagnostics)],
  };
  writeFileSync(resolve(OUT, "quick-report.json"), JSON.stringify(quickReport, null, 2));
  console.log(JSON.stringify(quickReport, null, 2));
  await browser.close();
  process.exit(quickReport.errors.length ? 1 : 0);
}

// Day: representative north/south common, hero recesses, civic/church/warehouse.
await exteriorSequence("day-north-rowN1", { x: -86.5, z: -10.2, yaw: Math.PI }, "EXPLORE_rowN1");
await exteriorSequence("day-north-warehouseN2", { x: -139.5, z: -10.5, yaw: Math.PI }, "EXPLORE_warehouseN2");
await exteriorSequence("day-north-church", { x: 71.5, z: -9.4, yaw: Math.PI }, "EXPLORE_church");
await exteriorSequence("day-north-thomas", { x: -72, z: -8.5, yaw: Math.PI }, "THOMAS_CIRCULAR");
await exteriorSequence("day-south-rowS3", { x: -40.75, z: 9.7, yaw: 0 }, "EXPLORE_rowS3");
await exteriorSequence("day-south-mercer", { x: -0.31, z: 8.9, yaw: 0 }, "MERCER_PRESS");
await exteriorSequence("day-south-pike", { x: 30.08, z: 11.8, yaw: 0 }, "PIKE_PROOF");
await exteriorSequence("day-south-customs", { x: 55, z: 10.7, yaw: 0 }, "CUSTOMHOUSE_NOTICE");

// Interior exit semantics: same lane/hinge identity, outward leaf clip.
await interiorSequence("day-interior-mercer", { x: -0.31, z: 12.2, yaw: Math.PI }, "MERCER_PRESS");
await interiorSequence("day-interior-rowN1", { x: -86.5, z: -13.1, yaw: 0 }, "EXPLORE_rowN1");

// Dusk coverage from both rows; profile/session is preserved on navigation.
await enterWorld(`${BASE_URL}?atmoT=0.9&atmoDusk=1`);
await page.waitForTimeout(3500);
await stage({ x: 6, z: -9.7, yaw: Math.PI, target: "EXPLORE_rowN8", interior: null });
await page.waitForTimeout(1350);
await shot("dusk-north-rowN8-open");
await stage({ x: 10.5, z: 9.9, yaw: 0, target: "EXPLORE_rowS6", interior: null });
await page.waitForTimeout(1350);
await shot("dusk-south-rowS6-open");

const host = await page.locator(".world3d").evaluate((node) => ({
  locationId: node.dataset.locationId,
  interiorId: node.dataset.interiorId,
  doorTarget: node.dataset.doorTarget,
  playerPos: node.dataset.playerPos3d,
  playerClip: node.dataset.playerClip,
}));
const report = {
  generatedAt: new Date().toISOString(),
  screenshots: 32,
  host,
  errors: [...new Set(errors)],
  diagnostics: [...new Set(diagnostics)],
};
writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
process.exit(report.errors.length ? 1 : 0);
