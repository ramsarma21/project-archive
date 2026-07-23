// Side-view QA for idle, walk, run, and transition poses.
import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";

const browser = await chromium.launch({
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "/tmp/pw-browsers" },
  args: ["--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const input = page.locator('input[placeholder="Display name"]');
if (await input.count()) {
  await input.fill("PlayerSideQA");
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

const canvas = page.locator("canvas");
const box = await canvas.boundingBox();
if (!box) throw new Error("canvas missing");
const x = box.x + box.width * 0.55;
const y = box.y + box.height * 0.45;
await page.mouse.move(x, y);
await page.mouse.down();
await page.mouse.move(x + 260, y, { steps: 20 });
await page.waitForTimeout(400);
await page.screenshot({ path: "/tmp/playerqa-1-idle-side.png" });

await page.keyboard.down("KeyS");
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/playerqa-2-walk-side.png" });
await page.keyboard.down("ShiftLeft");
await page.waitForTimeout(600);
await page.screenshot({ path: "/tmp/playerqa-3-run-transition.png" });
await page.waitForTimeout(700);
await page.screenshot({ path: "/tmp/playerqa-4-run-side.png" });
await page.keyboard.up("ShiftLeft");
await page.waitForTimeout(600);
await page.screenshot({ path: "/tmp/playerqa-5-walk-transition.png" });
await page.keyboard.up("KeyS");
await page.waitForTimeout(900);
await page.screenshot({ path: "/tmp/playerqa-6-idle-return.png" });
await page.mouse.up();

console.log("ERRORS", JSON.stringify(errors));
await browser.close();
