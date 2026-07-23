// Reproduce the resume path: play a few beats, reload the page, resume the
// same profile, then move around. Captures the state the user actually sees.
import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";

const prefix = process.argv[2] ?? "/tmp/resume";

const browser = await chromium.launch({
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "/tmp/pw-browsers" },
  args: ["--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

async function clickThrough(n) {
  for (let i = 0; i < n; i++) {
    const choice = page.locator(".dock .choices button.choice").first();
    const primary = page.locator(".dock button.btn-primary").first();
    if (await choice.count()) {
      await choice.click();
    } else if (await primary.count()) {
      const label = (await primary.textContent())?.trim() ?? "";
      if (!label || label.startsWith("Mastery")) break;
      await primary.click();
    }
    await page.waitForTimeout(900);
  }
}

await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
const input = page.locator('input[placeholder="Display name"]');
if (await input.count()) {
  await input.fill("ResumeTest");
  await page.locator('button:has-text("Create")').click();
  await page.waitForTimeout(700);
}
await page.locator('button:has-text("Play")').first().click();
await page.waitForTimeout(2200);

// Advance into the shop and through the press beats to build up a save.
const sync = page.locator('button:has-text("Synchronize")');
if (await sync.count()) { await sync.click(); await page.waitForTimeout(800); }
await page.keyboard.down("KeyW");
await page.waitForTimeout(4200);
await page.keyboard.up("KeyW");
await page.waitForTimeout(1500);
await clickThrough(6);
await page.screenshot({ path: `${prefix}-1-before.png` });

// ---- Reload mid-day and resume the same profile ----
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.locator('button:has-text("Play")').first().click();
await page.waitForTimeout(3500);
await page.screenshot({ path: `${prefix}-2-resumed.png` });

// Try to move.
await page.keyboard.down("KeyW");
await page.waitForTimeout(1600);
await page.keyboard.up("KeyW");
await page.keyboard.down("KeyD");
await page.waitForTimeout(900);
await page.keyboard.up("KeyD");
await page.waitForTimeout(800);
await page.screenshot({ path: `${prefix}-3-move.png` });

// Diagnostics: player + camera + a few NPC world positions.
const diag = await page.evaluate(() => {
  const out = { errors: [] };
  return out;
});
console.log("pageerrors:", JSON.stringify(errors.slice(0, 6), null, 2));
console.log("RESUME SHOTS DONE", JSON.stringify(diag));
await browser.close();
