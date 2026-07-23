// Mechanics UI + haul-regression tour (KEYBOARD_MOUSE profile, real inputs):
//   1. Press job: all five stages through the redesigned panel (stage rail,
//      per-stage headline, ink daub guidance, hold-to-peel fill button).
//   2. Thomas stop: effort hold (fill button), then the 3-stage haul job —
//      asserting it progresses past BALANCE (previously wedged: the reused
//      HoldAdvance kept progress=1 and refused to re-arm).
// Run with the dev server:
//   cd apps/web && VITE_CP1_ALLOW_DRAFT_BANK=true node_modules/.bin/vite --port 5183
//   node assets/pipeline/qa_mechanics_ui.mjs
import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE_URL = process.env.SLICE_QA_URL ?? "http://localhost:5183/";
const OUT = resolve(process.env.MECH_QA_OUT ?? "test-results/mechanics-ui-qa");
const SEED = "42".repeat(32);
const HEADLESS_SHELL =
  "/tmp/pw-browsers/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell";
mkdirSync(OUT, { recursive: true });

const log = [];
let shotIndex = 0;
let activePage = null;

function note(text) {
  const line = `[${new Date().toISOString().slice(11, 23)}] ${text}`;
  log.push(line);
  console.log(line);
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

async function state(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-game-root="play"]');
    const shell = document.querySelector(".mechanic-shell");
    const buttons = [...document.querySelectorAll("button")]
      .filter((b) => b.offsetParent !== null && !b.disabled)
      .map((b) => b.textContent?.trim().slice(0, 44) ?? "");
    return {
      request: root?.getAttribute("data-plan-request") ?? null,
      busy: root?.getAttribute("data-interaction-busy") ?? null,
      headline: shell?.querySelector("h2")?.textContent ?? null,
      railCurrent:
        shell?.querySelector(".stage-rail li.current")?.textContent?.trim() ?? null,
      buttons,
    };
  });
}

async function shot(page, name, settleMs = 400) {
  await page.waitForTimeout(settleMs);
  shotIndex += 1;
  const file = `${String(shotIndex).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: resolve(OUT, file) });
  const s = await state(page);
  note(`shot ${file} | req=${s.request} stage=${s.railCurrent} headline=${s.headline}`);
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

async function holdButton(page, selector, ms) {
  const button = page.locator(selector).first();
  await button.waitFor({ state: "visible", timeout: 15000 });
  const box = await button.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const hit = await page.evaluate(
    ({ cx, cy }) => {
      const el = document.elementFromPoint(cx, cy);
      return `${el?.tagName}.${(el?.className && typeof el.className === "string" ? el.className : "").split(" ")[0]}`;
    },
    { cx, cy },
  );
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(300);
  const mid = await button.evaluate((el) => ({
    cls: el.className,
    hold: el.style.getPropertyValue("--hold"),
    disabled: el.disabled,
    label: el.querySelector(".hold-label")?.textContent ?? el.textContent?.slice(0, 30),
  }));
  note(`mid-hold hit=${hit} ${JSON.stringify(mid)}`);
  await page.waitForTimeout(Math.max(0, ms - 300));
  await page.mouse.up();
  note(`held ${selector} for ${ms}ms`);
}

async function waitRequest(page, kind, timeoutMs = 60000) {
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

async function waitHeadline(page, text, timeoutMs = 20000) {
  await page.waitForFunction(
    (expected) =>
      document
        .querySelector(".mechanic-shell h2")
        ?.textContent?.includes(expected),
    text,
    { timeout: timeoutMs },
  );
}

async function seedProfile(page, profileId, displayName, inputMethod) {
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
    async ({ profileId, seed, displayName, inputMethod }) => {
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
              inputMethod,
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
    { profileId, seed: SEED, displayName, inputMethod },
  );
}

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

// Teleport into a DOOR arrival sensor, retrying (busy pulses reset the dwell).
async function arriveAtDoor(page, x, z, backOffZ) {
  await page.waitForFunction(() => typeof window.__PA_QA_TELEPORT__ === "function", null, { timeout: 20000 });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.evaluate(({ x, z }) => window.__PA_QA_TELEPORT__(x, z, 0), { x, z });
    note(`arrival attempt ${attempt + 1} at [${x}, ${z}]`);
    const advanced = await page
      .waitForFunction(
        () => {
          const root = document.querySelector('[data-game-root="play"]');
          const request = root?.getAttribute("data-plan-request");
          return request !== "FREE_ROAM";
        },
        null,
        { timeout: 15000 },
      )
      .then(() => true)
      .catch(() => false);
    if (advanced) return;
    await page.evaluate(
      ({ x, backOffZ }) => window.__PA_QA_TELEPORT__(x, backOffZ, 0),
      { x, backOffZ },
    );
    await page.waitForTimeout(900);
  }
  throw new Error(`never arrived at door [${x}, ${z}]`);
}

// Click ACK/Continue prompts (and decline optional street reads) until the
// wanted state shows up.
async function ackUntil(page, isDone, maxSteps = 16) {
  for (let step = 0; step < maxSteps; step += 1) {
    const s = await state(page);
    if (await isDone(s)) return;
    if (s.buttons.includes("ACKNOWLEDGE")) await clickButton(page, "ACKNOWLEDGE", 8000);
    else if (s.buttons.includes("Continue")) await clickButton(page, "Continue", 8000);
    else if (
      s.request === "FOCUS_READ" &&
      s.buttons.some((b) => b.includes("Keep moving"))
    ) {
      await clickButton(page, "Keep moving", 8000);
    } else await page.waitForTimeout(900);
  }
  throw new Error("ackUntil exceeded step budget");
}

async function drivePress(page) {
  // CATCH (slider pre-centred = clean catch).
  await waitRequest(page, "MECHANIC", 90000);
  await waitHeadline(page, "Catch the sheet square");
  await shot(page, "press-catch");
  await clickButton(page, "CATCH SHEET", 15000);

  // INK: follow the lit side, four strokes.
  await waitHeadline(page, "Ink the forme evenly");
  await shot(page, "press-ink");
  for (let strokeCount = 0; strokeCount < 4; strokeCount += 1) {
    const expected = page.locator(".ink-daubs button.expected").first();
    await expected.waitFor({ state: "visible", timeout: 8000 });
    await expected.click();
    await page.waitForTimeout(180);
  }

  // REGISTER + PULL (pre-centred sliders).
  await waitHeadline(page, "Set the register true");
  await shot(page, "press-register");
  await clickButton(page, "SET REGISTER", 15000);
  await waitHeadline(page, "Pull the bar smoothly");
  await clickButton(page, "PULL BAR", 15000);

  // PEEL: hold-to-fill button.
  await waitHeadline(page, "Peel the proof clean");
  await shot(page, "press-peel");
  await holdButton(page, "button.mechanic-hold", 1000);
  note("press job completed with real inputs");
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: HEADLESS_SHELL,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
  activePage = page;
  page.on("pageerror", (error) => note(`PAGEERROR ${error.message}`));

  // Warmup: reach the street once so Vite finishes dependency optimization
  // (otherwise a mid-scene full reload resets the tour to Home).
  await page.goto(BASE_URL, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(800);
  await seedProfile(page, "mech-warmup", "Mech Warmup", "KEYBOARD_MOUSE");
  await openProfile(page, "Mech Warmup");
  await waitRequest(page, "CONTINUE", 90000);
  await clickButton(page, "Synchronize");
  await waitRequest(page, "FREE_ROAM", 120000);
  note("warmup reached free roam");
  await page.waitForTimeout(2000);

  // Observation run.
  await seedProfile(page, "mech-ui-qa", "Mech UI QA", "KEYBOARD_MOUSE");
  await openProfile(page, "Mech UI QA");
  await waitRequest(page, "CONTINUE", 90000);
  await clickButton(page, "Synchronize");
  await waitRequest(page, "FREE_ROAM", 120000);

  // ---- Mercer: entry + full press job on the new panel -------------------
  await arriveAtDoor(page, -0.31, 10.0, 6.5);
  await waitRequest(page, "CHOICE", 30000);
  await clickButton(page, "Walk straight in.");
  await drivePress(page);

  // ---- Through the proofs to the dispatch -------------------------------
  await ackUntil(page, async (s) =>
    s.request === "FOCUS_READ" &&
    s.buttons.some((b) => b.includes("Compare the two proofs")));
  await clickButton(page, "Compare the two proofs");
  // The papers auto-close, the dispatch dialogue plays, and the errand picker
  // appears once presentation ends — a long, timer-driven stretch.
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some((b) =>
        b.textContent?.includes("Deliver the circular to Thomas"),
      ),
    null,
    { timeout: 120000 },
  );

  // ---- Thomas: select stop, walk in --------------------------------------
  await clickButton(page, "Deliver the circular to Thomas");
  await page.waitForTimeout(600);
  await arriveAtDoor(page, -72, -10.05, -6.0);

  // Thomas's greeting, then the circular handoff (EFFORT hold).
  await ackUntil(page, async (s) => s.request === "MECHANIC");
  await shot(page, "thomas-effort");
  await holdButton(page, "button.mechanic-hold", 1600);
  await page.waitForTimeout(900);

  // Choice: help him haul.
  await waitRequest(page, "CHOICE", 30000);
  await shot(page, "thomas-choice");
  await clickButton(page, "Help him haul the cloth in.");

  // ---- THE REGRESSION: 3-stage haul must advance past BALANCE ------------
  await waitRequest(page, "MECHANIC", 30000);
  await waitHeadline(page, "Shoulder the bolt");
  await shot(page, "haul-load");
  await holdButton(page, "button.mechanic-hold", 1000);

  await waitHeadline(page, "Balance the weight", 8000);
  const balance = await state(page);
  assert(balance.railCurrent?.includes("BALANCE"), "rail shows BALANCE current");
  await shot(page, "haul-balance");
  await holdButton(page, "button.mechanic-hold", 1000);

  // Previously wedged here: the hold button stayed "COMPLETE" and never
  // re-armed. Now THREAD must arrive.
  await waitHeadline(page, "Thread the doorway", 8000);
  await shot(page, "haul-thread");
  await holdButton(page, "button.mechanic-hold", 1000);

  // The job submits: the request leaves MECHANIC.
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-game-root="play"]')
        ?.getAttribute("data-plan-request") !== "MECHANIC",
    null,
    { timeout: 20000 },
  );
  note("HAUL REGRESSION PASS: all three stages completed");
  await shot(page, "haul-done", 900);

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
