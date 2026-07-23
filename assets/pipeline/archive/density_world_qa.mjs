// Visual/performance QA tour for the imported exterior-density pass.
// Requires local API + Vite servers. Uses the dev-only teleport bridge so the
// tour never mutates gameplay state or depends on active locomotion mechanics.
import { mkdirSync } from "node:fs";
import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";

const outputDir = process.env.DENSITY_QA_OUT ?? "/tmp/density-world-qa";
const qaUrl = process.env.DENSITY_QA_URL ?? "http://127.0.0.1:5173/";
mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
if (process.env.DENSITY_QA_DISABLE_AFTER_ENTRY === "1") {
  await context.addInitScript(() => {
    window.localStorage.setItem("pa-density-disabled", "1");
  });
}
const page = await context.newPage();
const runtimeErrors = [];
const missingWorldAssets = [];
page.on("pageerror", (error) => runtimeErrors.push(`page: ${String(error)}`));
page.on("console", (message) => {
  if (
    message.type() === "error" &&
    !message.text().includes("Failed to load resource")
  ) {
    runtimeErrors.push(`console: ${message.text()}`);
  }
});
page.on("response", (response) => {
  if (response.url().includes("/world/") && response.status() >= 400) {
    missingWorldAssets.push(`${response.status()} ${response.url()}`);
  } else if (response.status() >= 400) {
    runtimeErrors.push(`${response.status()} ${response.url()}`);
  }
});

await page.goto(qaUrl, { waitUntil: "networkidle" });
const input = page.locator('input[placeholder="Display name"]');
if (await input.count()) {
  await input.fill(`DensityQA-${Date.now()}`);
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
      return true;
    }
  }
  return false;
}

let entered = false;
for (let attempt = 0; attempt < 90; attempt++) {
  await clickAdvance().catch(() => false);
  const host = page.locator(".world3d");
  if (await host.count()) {
    const location = await host.getAttribute("data-location-id");
    const playerPosition = await host.getAttribute("data-player-pos");
    if (location !== "ARCHIVE_TRANSIT" && playerPosition) {
      entered = true;
      break;
    }
  }
  await page.waitForTimeout(700);
}
if (!entered) {
  await page.screenshot({ path: `${outputDir}/00-entry-failure.png` });
  throw new Error("world exterior did not become ready");
}

await page.waitForTimeout(Number(process.env.DENSITY_QA_SETTLE_MS ?? 12000));
const host = page.locator(".world3d");

async function dismissPrimer() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const acknowledge = page.locator("button:not([disabled])").filter({ hasText: /acknowledge/i });
    if (
      (await acknowledge.count()) === 0 ||
      !(await acknowledge.first().isVisible().catch(() => false))
    ) return;
    await acknowledge.first().click();
    await page.waitForTimeout(250);
  }
}

async function teleportTo(x, z, faceY) {
  await page.evaluate(
    ({ x, z, faceY }) => {
      if (typeof window.__PA_QA_TELEPORT__ !== "function") {
        throw new Error("dev QA teleport bridge unavailable");
      }
      window.__PA_QA_TELEPORT__(x, z, faceY);
    },
    { x, z, faceY },
  );
  await page.waitForTimeout(900);
}

async function sampleFps(durationMs = 1600) {
  return page.evaluate((duration) => new Promise((resolve) => {
    const frames = [];
    const start = performance.now();
    let previous = start;
    const step = (now) => {
      frames.push(now - previous);
      previous = now;
      if (now - start >= duration) {
        const sorted = [...frames].sort((a, b) => a - b);
        resolve({
          fps: frames.length / ((now - start) / 1000),
          medianFrameMs: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
          p95FrameMs: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
        });
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }), durationMs);
}

const samples = [];
async function capture(name, x, z, yaw) {
  await dismissPrimer();
  await teleportTo(x, z, yaw);
  const perf = await sampleFps();
  const metrics = await host.evaluate((element) => ({
    calls: Number(element.dataset.drawCalls ?? 0),
    triangles: Number(element.dataset.triangles ?? 0),
    player: element.dataset.playerPos ?? "",
    densityBatches: window.__PA_DENSITY_BATCHES__ ?? -1,
  }));
  await page.screenshot({ path: `${outputDir}/${name}.png` });
  samples.push({ name, ...metrics, ...perf });
  console.log("SHOT", name, JSON.stringify(samples[samples.length - 1]));
}

await capture("01-town-heart-east", -6, 0, Math.PI / 2);
if (process.env.DENSITY_QA_EAST_ONLY === "1") {
  await capture("12-east-gate", 74, 0, Math.PI / 2);
  await capture("14-liberty-march-exit", 101, -24, Math.PI / 2);
} else if (process.env.DENSITY_QA_SMOKE !== "1") {
  await capture("02-town-heart-west", -6, 0, -Math.PI / 2);
  await capture("03-west-street", -100, 0, Math.PI / 2);
  await capture("04-market", -52, 0, -Math.PI / 2);
  await capture("05-rider-pocket", -102, -16, -Math.PI / 2);
  await capture("06-north-alley", -60, -23.2, Math.PI / 2);
  await capture("07-south-alley", 20, 23.2, -Math.PI / 2);
  await capture("08-wharf-townward", -125, 0, Math.PI / 2);
  await capture("09-wharf-open-harbor", -148, 9, -Math.PI / 2);
  await capture("10-civic-square", 48, 0, Math.PI / 2);
  await capture("11-church-edge", 63, -13, Math.PI / 2);
  await capture("12-east-gate", 74, 0, Math.PI / 2);
  await capture("13-liberty-approach", 86, -15, 2.2);
  await capture("14-liberty-march-exit", 101, -24, Math.PI / 2);
}

console.log("DENSITY_QA_REPORT", JSON.stringify({
  screenshots: samples.length,
  samples,
  maxDrawCalls: Math.max(...samples.map((entry) => entry.calls)),
  maxTriangles: Math.max(...samples.map((entry) => entry.triangles)),
  minFps: Math.min(...samples.map((entry) => entry.fps)),
  missingWorldAssets,
  runtimeErrors,
}));

await browser.close();
if (missingWorldAssets.length || runtimeErrors.length) process.exitCode = 1;
