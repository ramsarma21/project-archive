// Headless screenshot of the 3D world for visual verification.
// Usage: node assets/pipeline/shot_world.mjs [outPrefix]
import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";

const prefix = process.argv[2] ?? "/tmp/world";

const browser = await chromium.launch({
  executablePath: undefined,
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "/tmp/pw-browsers" },
  args: ["--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
page.on("console", (m) => {
  if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 300));
});
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));

await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

// Create a fresh local profile if needed, then play.
const create = page.locator('button:has-text("Create")');
if (await create.count()) {
  const input = page.locator('input[placeholder="Display name"]');
  if (await input.count()) {
    await input.fill("WorldTest");
    await create.click();
    await page.waitForTimeout(800);
  }
}
const play = page.locator('button:has-text("Play")').first();
await play.click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${prefix}-1-intake.png` });

// Advance through the Archive intake if the Synchronize button is up.
const sync = page.locator('button:has-text("Synchronize")');
if (await sync.count()) {
  await sync.click();
  await page.waitForTimeout(1000);
}
// Click through a few continues if present to reach the street.
for (let i = 0; i < 3; i++) {
  const btn = page.locator(".dock button.btn-primary").first();
  if (await btn.count()) {
    const label = (await btn.textContent())?.trim() ?? "";
    if (label && !label.startsWith("Mastery")) {
      await btn.click();
      await page.waitForTimeout(900);
    }
  }
}
await page.waitForTimeout(6000); // let GLBs stream in
await page.screenshot({ path: `${prefix}-2-street.png` });

// Walk forward for a couple seconds toward the gold marker.
await page.keyboard.down("KeyW");
await page.waitForTimeout(2200);
await page.keyboard.up("KeyW");
await page.waitForTimeout(1200);
await page.screenshot({ path: `${prefix}-3-walked.png` });

// Keep walking into the marker to trigger the shop transition.
await page.keyboard.down("KeyW");
await page.waitForTimeout(2600);
await page.keyboard.up("KeyW");
await page.waitForTimeout(2500);
await page.screenshot({ path: `${prefix}-4-arrive.png` });

// Advance through door choice + entrance beats into the shop interior.
for (let i = 0; i < 4; i++) {
  const choice = page.locator(".dock .choices button.choice").first();
  const primary = page.locator(".dock button.btn-primary").first();
  if (await choice.count()) {
    await choice.click();
    await page.waitForTimeout(1300);
  } else if (await primary.count()) {
    const label = (await primary.textContent())?.trim() ?? "";
    if (!label || label.startsWith("Mastery")) break;
    await primary.click();
    await page.waitForTimeout(1300);
  }
}
await page.waitForTimeout(2500);
await page.screenshot({ path: `${prefix}-5-interior.png` });

console.log("SHOTS DONE");
await browser.close();
