// Repro tour for the reported Abigail-scene glitch:
//   "after the press it kinda teleports u for a sec and after u view the
//    papers u get like stuck in the wall"
// Plays the real opening through the live UI (no runtime fast-forward),
// sampling the committed player position (data-player-pos-3d) and taking a
// screenshot burst around every transition so the momentary pops are caught.
// Run:
//   cd apps/web && VITE_CP1_ALLOW_DRAFT_BANK=true node_modules/.bin/vite --port 5183
//   node assets/pipeline/qa_mercer_repro.mjs
import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE_URL = process.env.SLICE_QA_URL ?? "http://localhost:5183/";
const OUT = resolve(process.env.MERCER_QA_OUT ?? "test-results/mercer-scene-qa");
const SEED = "42".repeat(32);
const HEADLESS_SHELL =
  "/tmp/pw-browsers/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell";
mkdirSync(OUT, { recursive: true });

const log = [];
let shotIndex = 0;

function note(text) {
  const line = `[${new Date().toISOString().slice(11, 23)}] ${text}`;
  log.push(line);
  console.log(line);
}

async function state(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-game-root="play"]');
    const world = document.querySelector(".world3d");
    const buttons = [...document.querySelectorAll("button")]
      .filter((b) => b.offsetParent !== null && !b.disabled)
      .map((b) => b.textContent?.trim().slice(0, 48) ?? "");
    return {
      request: root?.getAttribute("data-plan-request") ?? null,
      busy: root?.getAttribute("data-interaction-busy") ?? null,
      pos: world?.getAttribute("data-player-pos3d") ?? null,
      motion: world?.getAttribute("data-player-motion") ?? null,
      readPanel: Boolean(document.querySelector(".holo-doc")),
      buttons,
    };
  });
}

async function shot(page, name) {
  shotIndex += 1;
  const file = `${String(shotIndex).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: resolve(OUT, file) });
  const s = await state(page);
  note(`shot ${file} | req=${s.request} pos=${s.pos} motion=${s.motion} read=${s.readPanel}`);
  return s;
}

// Screenshot burst: capture every `stepMs` for `totalMs`, tagging positions.
async function burst(page, name, totalMs, stepMs = 240) {
  const frames = Math.ceil(totalMs / stepMs);
  for (let i = 0; i < frames; i += 1) {
    shotIndex += 1;
    const file = `${String(shotIndex).padStart(2, "0")}-${name}-t${String(i * stepMs).padStart(4, "0")}.png`;
    const s = await page.evaluate(() => {
      const world = document.querySelector(".world3d");
      return world?.getAttribute("data-player-pos3d") ?? null;
    });
    await page.screenshot({ path: resolve(OUT, file) });
    note(`burst ${file} pos=${s}`);
    await page.waitForTimeout(stepMs);
  }
}

async function clickButton(page, text, timeoutMs = 30000) {
  const button = page
    .locator("button", { hasText: text })
    .filter({ hasNot: page.locator("[disabled]") })
    .first();
  await button.waitFor({ state: "visible", timeout: timeoutMs });
  await page.waitForTimeout(120);
  await button.click();
  note(`clicked "${text}"`);
}

async function waitRequest(page, kind, timeoutMs = 45000) {
  await page.waitForFunction(
    (expected) => {
      const root = document.querySelector('[data-game-root="play"]');
      return (
        root?.getAttribute("data-plan-request") === expected &&
        root?.getAttribute("data-interaction-busy") === "false"
      );
    },
    kind,
    { timeout: timeoutMs },
  );
}

async function seedProfile(page, profileId, displayName) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() =>
    document.body.textContent?.includes("Project Archive"),
  );
  await page.waitForFunction(
    async () => {
      const opened = indexedDB.open("project-archive");
      const database = await new Promise((resolvePromise) => {
        opened.onsuccess = () => resolvePromise(opened.result);
        opened.onerror = () => resolvePromise(null);
      });
      if (!database) return false;
      const ready =
        database.objectStoreNames.contains("profiles") &&
        database.objectStoreNames.contains("saves");
      database.close();
      return ready;
    },
    null,
    { timeout: 20000 },
  );
  await page.evaluate(
    async ({ profileId, seed, displayName }) => {
      const request = indexedDB.open("project-archive");
      await new Promise((resolvePromise, reject) => {
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(["profiles"], "readwrite");
          transaction.objectStore("profiles").put({
            profileId,
            accountId: `local:${profileId}`,
            displayName,
            variationRootSeedHex: seed,
            source: "LOCAL",
            createdAt: "2026-07-22T00:00:00.000Z",
            onboarding: {
              version: 1,
              readingSpeed: "BRISK",
              captions: true,
              audioDescription: false,
              inputMethod: "KEYBOARD_ONLY",
              archiveAssistAutoOffer: true,
              highContrast: false,
              reducedMotion: false,
              chaseAssist: "AUTO_STAMINA",
              primersSeen: ["ARCHIVE", "MOVEMENT", "READ", "WORK", "CHOICE"],
              completedAt: "2026-07-22T00:00:00.000Z",
            },
          });
          transaction.oncomplete = () => {
            database.close();
            resolvePromise();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    },
    { profileId, seed: SEED, displayName },
  );
}

let activePage = null;

async function openProfile(page, displayName) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  const row = page
    .locator("li, article, div")
    .filter({ hasText: displayName })
    .filter({ has: page.getByRole("button", { name: "Play" }) })
    .first();
  await row.getByRole("button", { name: "Play" }).first().waitFor({ state: "visible", timeout: 15000 });
  await row.getByRole("button", { name: "Play" }).first().click();
}

// Plays the whole opening (intake -> enter -> press -> papers -> dispatch).
// observe=false is the warmup pass that lets Vite discover/optimize every
// lazily-reached module (otherwise the dev server full-reloads mid-scene and
// the tour resets to Home). observe=true captures screenshots + positions.
async function driveScene(page, observe) {
  const window_ = observe
    ? burst
    : async (page_, _name, totalMs) => page_.waitForTimeout(Math.min(totalMs, 2500));

  // ---- B0 Archive intake -> Synchronize --------------------------------
  await waitRequest(page, "CONTINUE", 90000);
  if (observe) await shot(page, "intake");
  await clickButton(page, "Synchronize");

  // ---- Free roam to Mercer's Press --------------------------------------
  await waitRequest(page, "FREE_ROAM", 120000);
  if (observe) await shot(page, "street-freeroam");
  await page.waitForFunction(() => typeof window.__PA_QA_TELEPORT__ === "function", null, { timeout: 20000 });
  // The audited DOOR arrival sensor sits at [-0.31, 10.61] (0.72 m off the
  // facade). Ambient busy pulses reset the arrival dwell, so re-enter the
  // sensor until the dwell survives and the entry CHOICE appears.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.evaluate(() => window.__PA_QA_TELEPORT__(-0.31, 10.0, 0));
    note(`arrival attempt ${attempt + 1}`);
    const arrived = await page
      .waitForFunction(
        () =>
          document
            .querySelector('[data-game-root="play"]')
            ?.getAttribute("data-plan-request") === "CHOICE",
        null,
        { timeout: 15000 },
      )
      .then(() => true)
      .catch(() => false);
    if (arrived) break;
    // Step out to rearm the dwell tracker, then loop back in.
    await page.evaluate(() => window.__PA_QA_TELEPORT__(-0.31, 6.5, 0));
    await page.waitForTimeout(900);
  }

  // ---- Entry choice ------------------------------------------------------
  await waitRequest(page, "CHOICE", 30000);
  if (observe) await shot(page, "enter-choice");
  await clickButton(page, "Walk straight in.");
  await window_(page, "entry", 2600);

  // ---- Catch beat + press job -------------------------------------------
  await waitRequest(page, "MECHANIC", 90000);
  if (observe) await shot(page, "print-job-open");
  // KEYBOARD_ONLY onboarding renders the accessible per-stage confirms.
  for (const stage of ["CATCH", "INK", "REGISTER", "PULL", "PEEL"]) {
    await clickButton(page, `COMPLETE ${stage}`, 20000);
    await page.waitForTimeout(700);
  }
  note("print job completed via accessible confirms");

  // ---- THE REPORTED WINDOW #1: post-press transition ---------------------
  await window_(page, "post-press", 4200);
  const s1 = await state(page);
  note(`post-press state req=${s1.request} buttons=${JSON.stringify(s1.buttons)}`);

  // Acknowledge/continue until the proof-compare offer appears.
  for (let i = 0; i < 12; i += 1) {
    const s = await state(page);
    if (s.request === "FOCUS_READ" && s.buttons.some((b) => b.includes("Compare the two proofs"))) break;
    const ack = s.buttons.find((b) => b === "ACKNOWLEDGE");
    const cont = s.buttons.find((b) => b === "Continue" || b === "Synchronize");
    if (ack) await clickButton(page, "ACKNOWLEDGE", 8000);
    else if (cont) await clickButton(page, cont, 8000);
    else await page.waitForTimeout(900);
  }

  // ---- Proof compare offer -> open the papers ----------------------------
  await waitRequest(page, "FOCUS_READ", 60000);
  if (observe) await shot(page, "proof-offer");
  await clickButton(page, "Compare the two proofs");
  await page.waitForTimeout(400);
  if (observe) await shot(page, "papers-open");

  // ---- THE REPORTED WINDOW #2: read panel auto-closes --------------------
  await window_(page, "post-papers", 9000, 300);
  const s2 = await state(page);
  note(`post-papers state req=${s2.request} buttons=${JSON.stringify(s2.buttons)}`);

  // ---- Continue to errand dispatch ---------------------------------------
  for (let i = 0; i < 14; i += 1) {
    const s = await state(page);
    if (s.request === "FREE_ROAM") break;
    const ack = s.buttons.find((b) => b === "ACKNOWLEDGE");
    const cont = s.buttons.find((b) => b === "Continue");
    if (ack) await clickButton(page, "ACKNOWLEDGE", 8000);
    else if (cont) await clickButton(page, "Continue", 8000);
    else await page.waitForTimeout(900);
  }
  await waitRequest(page, "FREE_ROAM", 60000);
  if (observe) await shot(page, "leave-freeroam");

  // ---- Free-roam movement check: is the player stuck? ---------------------
  const before = (await state(page)).pos;
  await page.keyboard.down("KeyW");
  await window_(page, "walk-out", 2400, 400);
  await page.keyboard.up("KeyW");
  const after = (await state(page)).pos;
  note(`movement check before=${before} after=${after}`);
  if (observe) await shot(page, "after-walk");
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: HEADLESS_SHELL,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
  activePage = page;
  page.on("pageerror", (error) => note(`PAGEERROR ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") note(`CONSOLE ${message.text().slice(0, 200)}`);
  });

  await page.goto(BASE_URL, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(800);

  // Warmup pass: full scene on a throwaway profile (module graph coverage).
  note("=== WARMUP PASS ===");
  await seedProfile(page, "mercer-warmup", "Mercer Warmup");
  await openProfile(page, "Mercer Warmup");
  try {
    await driveScene(page, false);
  } catch (error) {
    note(`warmup pass incomplete (ok if it was a dev-server reload): ${error.message?.slice(0, 160)}`);
  }
  await page.waitForTimeout(1500);

  // Observation pass: fresh profile, full capture.
  note("=== OBSERVATION PASS ===");
  await seedProfile(page, "mercer-glitch-qa", "Mercer Glitch QA");
  await openProfile(page, "Mercer Glitch QA");
  await driveScene(page, true);

  writeFileSync(resolve(OUT, "log.txt"), log.join("\n"));
  await browser.close();
}

main().catch(async (error) => {
  note(`FATAL ${error.stack ?? error}`);
  if (activePage) {
    try {
      const s = await state(activePage);
      note(`FATAL-STATE ${JSON.stringify(s)}`);
      await activePage.screenshot({ path: resolve(OUT, "99-fatal.png") });
    } catch {
      // page gone
    }
  }
  writeFileSync(resolve(OUT, "log.txt"), log.join("\n"));
  process.exit(1);
});
