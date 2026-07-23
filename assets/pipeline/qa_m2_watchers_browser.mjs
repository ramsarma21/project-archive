// M2 browser acceptance harness. Uses only dev-only QA hooks and authored field
// events; production builds expose no shortcuts.
import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE_URL = process.env.M2_QA_URL ?? "http://127.0.0.1:5173/";
const OUT = resolve(process.env.M2_QA_OUT ?? "test-results/m2-browser-qa");
mkdirSync(OUT, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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
page.on("pageerror", (error) => errors.push(`page: ${String(error)}`));
page.on("console", (message) => {
  if (
    message.type() === "error" &&
    !message.text().includes("Failed to load resource")
  ) {
    errors.push(`console: ${message.text()}`);
  }
});
page.on("response", (response) => {
  if (response.status() < 400) return;
  const entry = `${response.status()} ${response.url()}`;
  if (response.url().includes("/v1/health")) diagnostics.push(entry);
  else errors.push(entry);
});

async function visible(locator) {
  return (await locator.count()) > 0 && (await locator.first().isVisible().catch(() => false));
}

async function bootstrap() {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  const nameInput = page.locator('input[placeholder="Display name"]');
  if (await visible(nameInput)) {
    await nameInput.fill(`M2-QA-${Date.now()}`);
    await page.locator('button:has-text("Create")').click();
    await page.waitForTimeout(400);
  }
  const play = page.locator('button:has-text("Play")').first();
  if (await visible(play)) {
    await play.click();
    await page.waitForTimeout(300);
  }
  let next = page.getByRole("button", { name: "Continue calibration" });
  if (await visible(next)) {
    await next.click();
    for (const label of ["High contrast", "Reduced motion"]) {
      const row = page.locator(".calibration-toggle").filter({ hasText: label });
      const input = row.locator('input[type="checkbox"]');
      if ((await input.count()) && !(await input.isChecked())) await row.click();
    }
    next = page.getByRole("button", { name: "Continue calibration" });
    await next.click();
    const keyboard = page.getByRole("button", { name: /Keyboard only/ });
    if (await visible(keyboard)) await keyboard.click();
    await page.getByRole("button", { name: "Begin synchronization" }).click();
  }

  const labels = [
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
  for (let attempt = 0; attempt < 60; attempt++) {
    const ready = await page.evaluate(() => {
      const playRoot = document.querySelector('[data-game-root="play"]');
      const world = document.querySelector('[data-game-root="world"]');
      return (
        playRoot?.getAttribute("data-plan-request") === "FREE_ROAM" &&
        world?.getAttribute("data-movement-active") === "true" &&
        typeof window.__PA_FIELD_EVENT__ === "function" &&
        typeof window.__PA_QA_TELEPORT__ === "function"
      );
    });
    if (ready) {
      const primer = page.getByRole("button", { name: "ACKNOWLEDGE" });
      if (await visible(primer)) {
        await primer.click();
        await page.waitForTimeout(250);
      }
      return;
    }
    const primer = page.getByRole("button", { name: "ACKNOWLEDGE" });
    if (await visible(primer)) {
      await primer.click();
      await page.waitForTimeout(250);
      continue;
    }
    for (const label of labels) {
      const button = page.locator(`button:has-text("${label}"):not([disabled])`).first();
      if (await visible(button)) {
        await button.click().catch(() => null);
        break;
      }
    }
    await page.waitForTimeout(550);
  }
  throw new Error(`M2 bootstrap did not reach FREE_ROAM: ${(await page.locator("body").innerText()).slice(0, 1000)}`);
}

async function fieldEvent(event) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const ok = await page.evaluate(
      async (payload) => await window.__PA_FIELD_EVENT__(payload),
      event,
    );
    if (ok) {
      await page.waitForTimeout(100);
      return;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`field event rejected: ${event.type}`);
}

async function challenge(suffix, reason = "CHECKPOINT") {
  await fieldEvent({
    type: "FIELD_WATCHER_CHALLENGE",
    eventId: `M2_QA_CHALLENGE_${suffix}`,
    interruptId: `M2_QA_INT_${suffix}`,
    challengeId: `M2_QA_CHALLENGE_ID_${suffix}`,
    watcherId: "WATCH-customs",
    reason,
  });
}

const report = {
  baseUrl: BASE_URL,
  placements: null,
  comply: null,
  talk: null,
  run: null,
  bell: null,
  accessibility: null,
  diagnostics,
  errors,
};

try {
  await bootstrap();
  await page.waitForFunction(() => {
    const world = document.querySelector('[data-game-root="world"]');
    return world?.getAttribute("data-watcher-count") === "4";
  });
  report.placements = await page.evaluate(() => {
    const world = document.querySelector('[data-game-root="world"]');
    return {
      count: world?.getAttribute("data-watcher-count"),
      ids: world?.getAttribute("data-watcher-ids"),
    };
  });
  assert(report.placements.count === "4", "exactly four watcher actors must register");
  assert(
    report.placements.ids ===
      "WATCH-customs,WATCH-patrol,WATCH-house-1,WATCH-house-2",
    `unexpected watcher roster ${report.placements.ids}`,
  );

  await page.evaluate(() => window.__PA_QA_TELEPORT__(55, 0, Math.PI));
  await page.waitForTimeout(350);
  await page.screenshot({
    path: resolve(OUT, "custom-house-watchers-high-contrast.png"),
    fullPage: true,
  });

  await page.evaluate(() => window.dispatchEvent(
    new CustomEvent("pa:flavor", {
      detail: { id: "CHURCH_BELL", markerId: "CHURCH_BELL_ROPE" },
    }),
  ));
  await page.waitForTimeout(100);
  report.bell = await page.locator(".stealth-hud [role=status]").textContent();
  assert(
    report.bell?.includes("church bell"),
    `bell did not publish text equivalent: ${report.bell}`,
  );

  await page.evaluate(() => window.__PA_QA_TELEPORT__(-70, 0, 0));
  await challenge("COMPLY");
  await page.waitForTimeout(500);
  console.log(
    "M2_AFTER_CHALLENGE",
    JSON.stringify(
      await page.evaluate(() => {
        const root = document.querySelector('[data-game-root="play"]');
        return {
          interrupt: root?.getAttribute("data-field-interrupt"),
          request: root?.getAttribute("data-plan-request"),
          busy: root?.getAttribute("data-interaction-busy"),
          panel: Boolean(document.querySelector(".confrontation-panel")),
          controlsClass: document.querySelector(".world-controls-overlay")?.className,
        };
      }),
    ),
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-game-root="play"]')
        ?.getAttribute("data-field-interrupt") === "CONFRONTATION" &&
      Boolean(document.querySelector(".confrontation-panel")),
  );
  const panel = page.locator(".confrontation-panel");
  assert(await visible(panel), "confrontation panel did not mount");
  assert(
    (await panel.locator("button").count()) === 3,
    "initial confrontation must expose exactly three options",
  );
  await page.screenshot({
    path: resolve(OUT, "confrontation-three-options.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: /Comply/ }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".confrontation-panel")
        ?.getAttribute("data-confrontation-phase") === "INSPECTING",
  );
  await page.screenshot({
    path: resolve(OUT, "comply-first-person-satchel.png"),
    fullPage: true,
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-game-root="play"]')
        ?.getAttribute("data-field-interrupt") === "",
  );
  report.comply = "RESOLVED";

  await challenge("TALK", "SUSPICION");
  await page.getByRole("button", { name: /Talk/ }).click();
  await page.waitForFunction(() => {
    const panel = document.querySelector(".confrontation-panel");
    return (
      !panel ||
      panel.getAttribute("data-confrontation-phase") === "TALK_FAILED"
    );
  });
  const talkPanel = page.locator(".confrontation-panel");
  if (await visible(talkPanel)) {
    report.talk = "FAILED_BOUNDED";
    assert(
      (await talkPanel.locator("button").count()) === 2,
      "failed talk must offer only comply or run",
    );
    await page.screenshot({
      path: resolve(OUT, "talk-failure-bounded-options.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: /Run/ }).click();
  } else {
    report.talk = "RELEASED";
    await challenge("RUN");
    await page.getByRole("button", { name: /Run/ }).click();
  }
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-game-root="play"]')
        ?.getAttribute("data-field-interrupt") === "CHASE",
  );
  report.run = "CHASE_ACTIVE";
  await page.screenshot({
    path: resolve(OUT, "run-chase-live-movement.png"),
    fullPage: true,
  });

  report.accessibility = await page.evaluate(() => {
    const root = document.querySelector('[data-game-root="play"]');
    const hud = document.querySelector(".stealth-hud");
    return {
      highContrast: root?.getAttribute("data-high-contrast"),
      reducedMotion: root?.getAttribute("data-reduced-motion"),
      inputMethod: root?.getAttribute("data-input-method"),
      hudClass: hud?.className,
    };
  });
  assert(report.accessibility.highContrast === "true", "high contrast was not retained");
  assert(report.accessibility.reducedMotion === "true", "reduced motion was not retained");
  assert(report.accessibility.inputMethod === "KEYBOARD_ONLY", "keyboard-only was not retained");
  assert(errors.length === 0, `browser errors: ${errors.join("\n")}`);
} finally {
  writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));
  await context.close();
  await browser.close();
}

console.log("M2_BROWSER_QA_PASS", JSON.stringify(report));
