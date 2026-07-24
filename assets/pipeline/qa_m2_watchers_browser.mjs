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

const SEED_HEX = "a1".repeat(32);
const DISPLAY_NAME = "M2 QA Watchers";

// design1 kill list (product decision): the pre-game calibration interview is
// DELETED, so accessibility/assist preferences are no longer chosen through an
// onboarding wizard. QA seeds them directly onto the profile — with
// `calibrated: true` so the explicit high-contrast / reduced-motion /
// keyboard-only choices are honored verbatim (never OS-overridden) — exactly
// as the shipped pause-settings surface would persist them.
async function seedProfile(onboarding) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() =>
    document.body.textContent?.includes("Project Archive"),
  );
  await page.waitForFunction(
    async () => {
      const opened = indexedDB.open("project-archive");
      const database = await new Promise((res) => {
        opened.onsuccess = () => res(opened.result);
        opened.onerror = () => res(null);
      });
      if (!database) return false;
      const ready = database.objectStoreNames.contains("profiles");
      database.close();
      return ready;
    },
    null,
    { timeout: 20000 },
  );
  await page.evaluate(
    async ({ seed, onboarding, displayName }) => {
      const request = indexedDB.open("project-archive");
      await new Promise((res, rej) => {
        request.onerror = () => rej(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const tx = database.transaction(["profiles"], "readwrite");
          tx.objectStore("profiles").put({
            profileId: "m2-qa-watchers",
            accountId: "local:m2-qa-watchers",
            displayName,
            variationRootSeedHex: seed,
            source: "LOCAL",
            createdAt: "2026-07-23T00:00:00.000Z",
            onboarding,
          });
          tx.oncomplete = () => {
            database.close();
            res();
          };
          tx.onerror = () => rej(tx.error);
        };
      });
    },
    { seed: SEED_HEX, onboarding, displayName: DISPLAY_NAME },
  );
}

async function openProfile(displayName) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  const row = page
    .locator(".profile-row, [data-profile-row], li, article, div")
    .filter({ hasText: displayName })
    .filter({ has: page.getByRole("button", { name: "Play" }) })
    .first();
  const play = row.getByRole("button", { name: "Play" }).first();
  await play.waitFor({ state: "visible", timeout: 15000 });
  await play.click();
}

async function bootstrap() {
  // Keyboard-only + high-contrast + reduced-motion, seeded and calibrated so
  // the accessibility assertions below read the intended, explicit choices.
  await seedProfile({
    version: 1,
    readingSpeed: "STANDARD",
    captions: true,
    audioDescription: false,
    inputMethod: "KEYBOARD_ONLY",
    archiveAssistAutoOffer: true,
    highContrast: true,
    reducedMotion: true,
    chaseAssist: "STANDARD",
    primersSeen: ["ARCHIVE", "MOVEMENT", "READ", "WORK", "CHOICE"],
    calibrated: true,
    completedAt: "2026-07-23T00:00:00.000Z",
  });
  await openProfile(DISPLAY_NAME);

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
  cited: null,
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

  // Talk belongs to the UNARMED confrontation triangle, so it is exercised
  // first — before any stop resolves. A resolved stop durably engages the
  // writs-of-assistance micro, which arms the design1 CITE defense; the cited
  // option then deterministically takes the Talk slot on every later stop
  // (ConfrontationPanel renders cited-in-place-of-Talk). Heat is raised to
  // WATCHED first so this talk lands on its authored bounded-failure branch
  // (standing NEUTRAL + heat WATCHED is below the release threshold), proving
  // the failure stays comply-or-run rather than opening a new path.
  await fieldEvent({
    type: "FIELD_HEAT_TRANSITION",
    eventId: "M2_QA_HEAT_WATCHED",
    from: "CALM",
    to: "WATCHED",
    cause: "DETECTION",
  });

  await challenge("TALK", "SUSPICION");
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
  assert(
    await visible(page.getByRole("button", { name: /Talk/ })),
    "unarmed confrontation must offer the plain Talk verb",
  );
  await page.screenshot({
    path: resolve(OUT, "confrontation-three-options.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: /Talk/ }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".confrontation-panel")
        ?.getAttribute("data-confrontation-phase") === "TALK_FAILED",
  );
  const talkPanel = page.locator(".confrontation-panel");
  assert(await visible(talkPanel), "failed talk must keep the panel mounted");
  report.talk = "FAILED_BOUNDED";
  assert(
    (await talkPanel.locator("button").count()) === 2,
    "failed talk must offer only comply or run",
  );
  await page.screenshot({
    path: resolve(OUT, "talk-failure-bounded-options.png"),
    fullPage: true,
  });

  // Recover from the failed talk by complying — the comply resolution path.
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

  // The resolved stop has engaged the writs micro. The next stop must now
  // surface the CITE defense in the Talk slot (knowledge as ammunition) — a
  // direct check that the chapter field vocabulary still feeds the confrontation
  // after the @pa/chapter-boston(-world) split — while Run stays open. Choosing
  // Run proves the run -> chase handoff.
  await challenge("RUN");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-game-root="play"]')
        ?.getAttribute("data-field-interrupt") === "CONFRONTATION" &&
      Boolean(document.querySelector(".confrontation-panel")),
  );
  const runPanel = page.locator(".confrontation-panel");
  assert(
    (await runPanel.locator("button").count()) === 3,
    "armed confrontation must still expose exactly three options",
  );
  const citedButton = runPanel.locator(".confrontation-cited");
  assert(
    await visible(citedButton),
    "engaged writs must arm the cited defense on the armed stop",
  );
  assert(
    !(await visible(page.getByRole("button", { name: /Talk/ }))),
    "the cited defense must take the Talk slot once armed",
  );
  report.cited = (await citedButton.getAttribute("data-cited-micro")) ?? "PRESENT";
  await page.getByRole("button", { name: /Run/ }).click();
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
