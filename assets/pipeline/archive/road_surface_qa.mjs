// Focused visual QA for the imported colonial road kit.
// Requires the local Vite server on :5173 and Playwright installed at
// /tmp/pw-check (the repository's existing visual-QA convention).
import { mkdirSync } from "node:fs";
import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";

const outputDir = process.env.ROAD_QA_OUT ?? "/tmp/road-surface-qa";
mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "/tmp/pw-browsers" },
  args: ["--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const runtimeErrors = [];
page.on("pageerror", (error) => runtimeErrors.push(`page: ${String(error)}`));
page.on("console", (message) => {
  if (message.type() === "error") {
    const text = message.text();
    // API 500s are still failures; retain every console error in the report.
    runtimeErrors.push(`console: ${text}`);
  }
});

await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
const input = page.locator('input[placeholder="Display name"]');
if (await input.count()) {
  await input.fill(`RoadQA-${Date.now()}`);
  await page.locator('button:has-text("Create")').first().click();
  await page.waitForTimeout(600);
}
const play = page.locator('button:has-text("Play")');
if (await play.count()) {
  await play.first().click();
  await page.waitForTimeout(900);
}

const advanceLabels = [
  "Continue calibration",
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

async function clickAdvance() {
  for (const label of advanceLabels) {
    const button = page.locator(`button:has-text("${label}"):not([disabled])`);
    if (
      (await button.count()) > 0 &&
      (await button.first().isVisible().catch(() => false))
    ) {
      await button.first().click({ timeout: 2500 });
      return label;
    }
  }
  return null;
}

// Complete calibration and archive insertion. A canvas can exist during
// ARCHIVE_TRANSIT, so wait for the live exterior player probe, not canvas.
let entered = false;
for (let attempt = 0; attempt < 90; attempt++) {
  await clickAdvance().catch(() => null);
  const host = page.locator(".world3d");
  if (await host.count()) {
    const location = await host.getAttribute("data-location-id");
    const playerPosition = await host.getAttribute("data-player-pos");
    if (location !== "ARCHIVE_TRANSIT" && playerPosition) {
      entered = true;
      break;
    }
  }
  await page.waitForTimeout(800);
}
if (!entered) {
  await page.screenshot({ path: `${outputDir}/00-entry-failure.png` });
  throw new Error("world exterior did not become ready");
}

const host = page.locator(".world3d");
const canvas = page.locator("canvas");
const canvasBox = await canvas.boundingBox();
if (!canvasBox) throw new Error("world canvas missing");
const centerX = canvasBox.x + canvasBox.width / 2;
const centerY = canvasBox.y + canvasBox.height / 2;

async function dismissPrimer() {
  for (let attempt = 0; attempt < 4; attempt++) {
    const acknowledge = page
      .locator("button:not([disabled])")
      .filter({ hasText: /acknowledge/i });
    if (
      (await acknowledge.count()) === 0 ||
      !(await acknowledge.first().isVisible().catch(() => false))
    ) {
      return;
    }
    await acknowledge.first().click();
    await page.waitForTimeout(300);
  }
}

async function playerPosition() {
  const value = await host.getAttribute("data-player-pos");
  if (!value) throw new Error("player position probe missing");
  const [x, z] = value.split(",").map(Number);
  return { x, z };
}

async function dragLook(dx, dy = 0) {
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + dx, centerY + dy, { steps: 18 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

async function calibrateDirections() {
  const mapping = {};
  for (const key of ["KeyW", "KeyS", "KeyA", "KeyD"]) {
    const before = await playerPosition();
    await page.keyboard.down(key);
    await page.waitForTimeout(260);
    await page.keyboard.up(key);
    await page.waitForTimeout(100);
    const after = await playerPosition();
    mapping[key] = { dx: after.x - before.x, dz: after.z - before.z };
  }
  return mapping;
}

async function walkTo(targetX, targetZ, tolerance = 3, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const current = await playerPosition();
    const ex = targetX - current.x;
    const ez = targetZ - current.z;
    if (Math.hypot(ex, ez) <= tolerance) return current;

    const mapping = await calibrateDirections();
    let bestKey = null;
    let bestScore = -Infinity;
    for (const [key, movement] of Object.entries(mapping)) {
      const length = Math.hypot(movement.dx, movement.dz);
      if (length < 0.005) continue;
      const score = (movement.dx * ex + movement.dz * ez) / length;
      if (score > bestScore) {
        bestScore = score;
        bestKey = key;
      }
    }
    if (!bestKey) {
      await dismissPrimer();
      await page.waitForTimeout(800);
      continue;
    }
    if (bestScore <= 0) {
      await dragLook(180);
      continue;
    }
    await page.keyboard.down("ShiftLeft");
    await page.keyboard.down(bestKey);
    await page.waitForTimeout(1100);
    await page.keyboard.up(bestKey);
    await page.keyboard.up("ShiftLeft");
    await page.waitForTimeout(120);
  }
  throw new Error(
    `navigation timeout to ${targetX},${targetZ}; at ${JSON.stringify(await playerPosition())}`,
  );
}

async function capture(name, lookDx = 0, lookDy = 0) {
  await dismissPrimer();
  if (lookDx || lookDy) await dragLook(lookDx, lookDy);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outputDir}/${name}.png` });
  console.log("SHOT", name, await playerPosition());
}

async function teleportTo(x, z, faceY = 0) {
  await page.evaluate(
    ({ targetX, targetZ, yaw }) => {
      const teleport = window.__PA_QA_TELEPORT__;
      if (typeof teleport !== "function") {
        throw new Error("dev QA teleport bridge unavailable");
      }
      teleport(targetX, targetZ, yaw);
    },
    { targetX: x, targetZ: z, yaw: faceY },
  );
  await page.waitForTimeout(700);
}

// Representative views requested by the road-surface brief.
// Let the first exterior arrival subtitle/camera beat release movement.
await page.waitForTimeout(12000);
await dismissPrimer();
await capture("01-main-street-spawn", 260, 90);
await teleportTo(48, 0, Math.PI / 2);
await capture("02-civic-square-east", -220, 70);
await teleportTo(63, -13, Math.PI);
await capture("03-church-edge", 180, 80);
await teleportTo(64, -23, Math.PI / 2);
await capture("05-north-alley", 220, 70);
await teleportTo(74, 0, Math.PI / 2);
await capture("04-east-gate-transition", -180, 70);
await teleportTo(95, -21, Math.PI);
await capture("09-liberty-courtyard-retained-green", 180, 70);
await teleportTo(20, 23, -Math.PI / 2);
await capture("06-south-alley", -220, 70);
await teleportTo(-100, 0, -Math.PI / 2);
await capture("07-west-street", 180, 75);
await teleportTo(-124, 0, -Math.PI / 2);
await capture("08-wharf-transition", -180, 70);

const report = {
  screenshots: 9,
  finalPosition: await playerPosition(),
  runtimeErrors,
};
console.log("ROAD_QA_REPORT", JSON.stringify(report));
await browser.close();
if (runtimeErrors.length > 0) process.exitCode = 1;
