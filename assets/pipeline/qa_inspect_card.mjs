// Visual QA: the restyled interior Found-History inspect card (ARCHIVE //
// CONTEXT hologram). Enters Mercer's Press via the QA interior hook, opens the
// press hotspot, and screenshots the card.
//   (cd apps/web && VITE_CP1_ALLOW_DRAFT_BANK=true node_modules/.bin/vite --port 5183 &)
//   PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-browsers node --import tsx assets/pipeline/qa_inspect_card.mjs
import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";
import { resolve } from "node:path";
import { createDay1Session } from "../../packages/runtime/src/index.ts";
import { CHAPTER_ID, PACKAGE_ID } from "../../packages/contracts/src/index.ts";

const BASE_URL = process.env.SLICE_QA_URL ?? "http://localhost:5183/";
const SEED = "42".repeat(32);
const OUT = resolve(
  process.env.OUT ?? "test-results/slice-visual-qa/40-context-inspect-restyled.png",
);

// Hard watchdog: never hang the harness.
setTimeout(() => {
  console.error("WATCHDOG: probe exceeded 240s, aborting");
  process.exit(2);
}, 240000).unref();

function mechanicResult(request) {
  const params = request.params;
  if (params.kind === "PRESS") return { kind: "PRESS", stopOffset: 0.5 };
  if (params.kind === "EFFORT") return { kind: "EFFORT", holdMs: 1500 };
  if (params.kind === "PLACE") return { kind: "PLACE", alignment: 0.5 };
  if (params.kind === "PRINT_JOB") {
    return {
      kind: "PRINT_JOB",
      phases: { catch: 0.95, ink: 0.95, register: 0.95, pull: 0.95, peel: 0.95 },
      quality: "CRISP",
      accessible: false,
    };
  }
  if (params.kind === "HAUL_JOB") return { kind: "HAUL_JOB", phases: { load: 0.9, balance: 0.9, thread: 0.9 }, accessible: false };
  if (params.kind === "POST_JOB") return { kind: "POST_JOB", phases: { lineUp: 0.9, tackLeft: 0.9, tackRight: 0.9 }, accessible: false };
  const needs = new Set(["deed", "writ", "newspaper"]);
  return {
    kind: "SORT",
    assignments: (params.sortItems ?? []).map((item) => ({
      itemId: item.itemId,
      bucketId: needs.has(item.itemId) ? "NEEDS_STAMP" : "DOES_NOT",
    })),
  };
}

function ordinaryResponse(request) {
  switch (request.kind) {
    case "CONTINUE":
    case "DAY_END":
      return { type: "CONTINUE" };
    case "ACK":
      return { type: "ACK" };
    case "FOCUS_READ":
      return { type: "FOCUS_READ_OPENED", objectId: request.objectId };
    case "BREATHER":
      return { type: "BREATHER_COMPLETE" };
    case "FREE_ROAM": {
      const target =
        request.targets.find((candidate) => candidate.marker === "GOLD") ??
        request.targets[0];
      return { type: "FREE_ROAM_GOTO", targetId: target.targetId };
    }
    case "MECHANIC":
      return { type: "MECHANIC_RESULT", promptId: request.promptId, result: mechanicResult(request) };
    case "CHOICE": {
      const option =
        request.options.find((candidate) => !candidate.disabled) ?? request.options[0];
      return { type: "CHOICE_SELECTED", promptId: request.promptId, choiceId: option.choiceId };
    }
  }
}

function eventsAfterMercerDispatch() {
  const session = createDay1Session({ variationRootSeedHex: SEED });
  for (let step = 0; step < 200; step += 1) {
    if (
      session.ctx.world.objectives.REPORT_TO_MERCER === "COMPLETED" &&
      session.plan?.request.kind === "FREE_ROAM" &&
      session.ctx.world.locationId === "BOSTON_STREET"
    ) {
      return [...session.committedEvents];
    }
    session.advance(ordinaryResponse(session.plan.request));
  }
  throw new Error("no dispatch");
}

const browser = await chromium.launch({
  executablePath:
    "/tmp/pw-browsers/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell",
  headless: true,
  args: ["--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"],
});
try {
  // Warmup pass so the dev server finishes dependency optimization first.
  {
    const warm = await browser.newPage({ viewport: { width: 1440, height: 860 } });
    await warm.goto(BASE_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
    await warm.waitForTimeout(2500);
    await warm.close();
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.textContent?.includes("Project Archive"));
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
    async ({ profileId, seed, events, chapterId, packageId }) => {
      const request = indexedDB.open("project-archive");
      await new Promise((resolvePromise, reject) => {
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(["profiles", "saves"], "readwrite");
          transaction.objectStore("profiles").put({
            profileId,
            accountId: `local:${profileId}`,
            displayName: "Inspect Probe",
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
          transaction.objectStore("saves").put({
            profileId,
            chapterId,
            packageId,
            flowVersion: 5,
            committedEvents: events,
            revision: 1,
            status: "IN_PROGRESS",
            updatedAt: "2026-07-22T00:00:00.000Z",
          });
          transaction.oncomplete = () => {
            database.close();
            resolvePromise();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    },
    {
      profileId: "inspect-probe",
      seed: SEED,
      events: eventsAfterMercerDispatch(),
      chapterId: CHAPTER_ID,
      packageId: PACKAGE_ID,
    },
  );
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  const row = page
    .locator("li, article, div")
    .filter({ hasText: "Inspect Probe" })
    .filter({ has: page.getByRole("button", { name: "Play" }) })
    .first();
  await row.getByRole("button", { name: "Play" }).first().click();
  await page.waitForFunction(
    () => {
      const root = document.querySelector('[data-game-root="play"]');
      const world = document.querySelector(".world3d");
      return (
        root?.getAttribute("data-plan-request") === "FREE_ROAM" &&
        world?.getAttribute("data-movement-active") === "true" &&
        typeof window.__PA_QA_TELEPORT__ === "function" &&
        typeof window.__PA_QA_INTERIOR__ === "function"
      );
    },
    null,
    { timeout: 60000 },
  );
  await page.waitForTimeout(1000);

  // Enter Mercer's Press and stand at the press hotspot: interior origin for
  // slot 0 is [640,0,640]; hotspot "mercer-press" local anchor [-4.2,1.1,0.1]
  // with radius 1.8. Stand ~1.4m away at [636.9, 641.0] facing the anchor
  // (yaw = atan2(dx, dz) toward [635.8, 640.1]).
  await page.evaluate(() => window.__PA_QA_INTERIOR__("MERCER_PRESS", "CENTER"));
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__PA_QA_TELEPORT__(636.9, 641.0, -2.26));
  await page.waitForTimeout(1200);

  // Candidate stances around the press hotspot; the dedicated QA hook opens
  // the active prompt directly (no synthetic keyboard).
  const stances = [
    [636.9, 641.0, -2.26],
    [636.6, 640.7, -2.4],
    [637.0, 640.2, -1.62],
    [635.9, 641.5, Math.PI],
  ];
  let opened = false;
  for (const [x, z, faceY] of stances) {
    await page.evaluate(
      ({ x, z, faceY }) => window.__PA_QA_TELEPORT__(x, z, faceY),
      { x, z, faceY },
    );
    await page.waitForTimeout(600);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      opened = await page.evaluate(() => window.__PA_QA_INSPECT__?.() ?? false);
      if (opened) break;
      await page.waitForTimeout(300);
    }
    if (opened) break;
  }
  if (!opened) throw new Error("no inspect prompt became active at any stance");
  await page.waitForSelector(".context-inspect-card", { timeout: 8000 });
  await page.waitForTimeout(1400); // materialize animation settles
  await page.screenshot({ path: OUT, fullPage: true });
  console.log("saved:", OUT);
} finally {
  await browser.close();
}
