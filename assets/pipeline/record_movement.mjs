// Record an actual street movement sequence for visual QA.
import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";
import { mkdirSync, rmSync } from "node:fs";

const dir = "/tmp/movement-video";
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "/tmp/pw-browsers" },
  args: ["--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const input = page.locator('input[placeholder="Display name"]');
if (await input.count()) {
  await input.fill("MovementQA");
  await page.locator('button:has-text("Create")').click();
  await page.waitForTimeout(600);
}
await page.locator('button:has-text("Play")').first().click();
await page.waitForTimeout(1800);
const sync = page.locator('button:has-text("Synchronize")');
if (await sync.count()) {
  await sync.click();
  await page.waitForTimeout(1000);
}

// Walk away from the Mercer marker, arc, sprint, release and observe braking.
await page.keyboard.down("KeyS");
await page.waitForTimeout(2200);
await page.keyboard.down("KeyD");
await page.waitForTimeout(1200);
await page.keyboard.up("KeyD");
await page.keyboard.down("ShiftLeft");
await page.waitForTimeout(1800);
await page.keyboard.up("ShiftLeft");
await page.keyboard.up("KeyS");
await page.waitForTimeout(1400);
await page.keyboard.down("KeyA");
await page.waitForTimeout(800);
await page.keyboard.up("KeyA");
await page.waitForTimeout(1000);

const video = page.video();
await page.close();
const path = await video.path();
await context.close();
await browser.close();
console.log("VIDEO", path);
console.log("ERRORS", JSON.stringify(errors));
