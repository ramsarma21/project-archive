// Act-1 vertical-slice visual acceptance tour (new systems pass):
//   1. CP1 mastery gate — wrong answers climb the friction ladder
//      (memory cue -> explicit -> elimination) with enforced dwell.
//   2. Alive world — Found-History read, Ned's staged arc, owned-route
//      Archive reminder, engaged-micro mastery panel.
//   3. Consequence — caught-chase release: reappear at the Watch House,
//      constable chewed-out beat.
// Run with a dev server that has the draft bank enabled:
//   cd apps/web && VITE_CP1_ALLOW_DRAFT_BANK=true node_modules/.bin/vite --port 5183
//   PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-browsers node --import tsx assets/pipeline/qa_slice_browser.mjs
import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BOSTON_DAY1_FLOW_VERSION,
  CHAPTER_ID,
  MICRO_CONCEPT_IDS,
  PACKAGE_ID,
  THREAD_IDS,
  createDay1Session,
} from "../../packages/chapter-boston/src/index.ts";

const BASE_URL = process.env.SLICE_QA_URL ?? "http://127.0.0.1:5183/";
const OUT = resolve(process.env.SLICE_QA_OUT ?? "test-results/slice-visual-qa");
const SEED = "42".repeat(32);
// The web boot path discards any save whose flowVersion != the chapter's
// current BOSTON_DAY1_FLOW_VERSION (useRuntimeSession), restarting at B0. The
// alive-world and caught-release scenes seed committed events, so the seeded
// save MUST carry the live flow version or those scenes reset to a fresh
// session and their state waits time out.
const FLOW_VERSION = BOSTON_DAY1_FLOW_VERSION;
const HEADLESS_SHELL =
  "/tmp/pw-browsers/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell";
mkdirSync(OUT, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const report = { screenshots: [], notes: [], errors: [] };

// ---------------------------------------------------------------------------
// Node-side save construction (deterministic, validated by the real runtime).
// ---------------------------------------------------------------------------

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
  if (params.kind === "HAUL_JOB") {
    return { kind: "HAUL_JOB", phases: { load: 0.9, balance: 0.9, thread: 0.9 }, accessible: false };
  }
  if (params.kind === "POST_JOB") {
    return { kind: "POST_JOB", phases: { lineUp: 0.9, tackLeft: 0.9, tackRight: 0.9 }, accessible: false };
  }
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
      return {
        type: "MECHANIC_RESULT",
        promptId: request.promptId,
        result: mechanicResult(request),
      };
    case "CHOICE": {
      const option =
        request.options.find((candidate) => !candidate.disabled) ??
        request.options[0];
      return { type: "CHOICE_SELECTED", promptId: request.promptId, choiceId: option.choiceId };
    }
  }
}

function sessionAfterMercerDispatch() {
  const session = createDay1Session({ variationRootSeedHex: SEED });
  for (let step = 0; step < 200; step += 1) {
    const dispatched =
      session.ctx.world.objectives.REPORT_TO_MERCER === "COMPLETED";
    if (
      dispatched &&
      session.plan?.request.kind === "FREE_ROAM" &&
      session.ctx.world.locationId === "BOSTON_STREET"
    ) {
      return session;
    }
    assert(session.plan, "runtime ended before Mercer dispatch");
    session.advance(ordinaryResponse(session.plan.request));
  }
  throw new Error("could not reach post-Mercer free roam");
}

function exchange(session, id, completion) {
  for (const event of [
    {
      type: "FIELD_INTERRUPT_STARTED",
      eventId: `${id}-start`,
      interruptId: id,
      interruptKind: "REACTIVE_EXCHANGE",
      sourceId: completion.sourceId,
    },
    { type: "FIELD_REACTIVE_COMPLETED", eventId: `${id}-complete`, interruptId: id, completion },
    { type: "FIELD_INTERRUPT_RESOLVED", eventId: `${id}-resolved`, interruptId: id, outcome: completion.outcomeId },
  ]) {
    session.emitFieldEvent(event);
  }
}

// Alive-world save: post-dispatch, Ned stage-1 consumed (fetch), tavern note
// delivered (owned route), one lore read committed.
function aliveWorldEvents() {
  const session = sessionAfterMercerDispatch();
  exchange(session, "QA_NED1", {
    interactionId: "THR-ned:qa1",
    sourceId: "THR-ned",
    outcomeId: "FETCH",
    threads: [{
      threadId: THREAD_IDS.NED,
      flags: { MET: true, OPENED: true, NED_FETCHED_TYPE: true },
      status: "ACTIVE",
      trustDelta: 2,
      breadcrumb: "You helped Ned with a tray of type; check the shopfront later.",
    }],
    micros: [MICRO_CONCEPT_IDS.PRINTERS_ROLE],
    standing: { delta: 1, causeId: "NED_MET" },
  });
  exchange(session, "QA_NOTE", {
    interactionId: "SJ-tavern-note-handoff:qa",
    sourceId: "SJ-tavern-note-handoff",
    outcomeId: "HANDOFF",
    micros: [MICRO_CONCEPT_IDS.NON_IMPORTATION, MICRO_CONCEPT_IDS.LOYAL_NINE],
    standing: { delta: 4, causeId: "TAVERN_NOTE_DELIVERED" },
    routes: [{ routeId: "NORTH_ALLEY_ROUTE", label: "The laundry-lane cut (north back alley)" }],
    rumors: ["A meeting at the Bunch of Grapes points toward the Loyal Nine."],
  });
  return [...session.committedEvents];
}

// Caught-chase save: the full committed consequence chain, leaving a pending
// reposition for the web to apply (which triggers the chewed-out release).
function caughtChaseEvents() {
  const session = sessionAfterMercerDispatch();
  const interruptId = "QA_CATCH_INT";
  const events = [
    {
      type: "FIELD_WATCHER_CHALLENGE",
      eventId: "QA_CATCH_CHALLENGE",
      interruptId,
      challengeId: "QA_CATCH",
      watcherId: "WATCH-customs-a",
      reason: "CHECKPOINT",
    },
    { type: "FIELD_CONFRONTATION_DECISION", eventId: "QA_CATCH_RUN", interruptId, choice: "RUN" },
    {
      type: "FIELD_HEAT_TRANSITION",
      eventId: "QA_CATCH_HEAT",
      interruptId,
      from: session.ctx.field.heat.band,
      to: "HUNTED",
      cause: "RUN",
    },
    { type: "FIELD_CHASE_STARTED", eventId: "QA_CATCH_CHASE", interruptId, chaseId: "QA_CHASE_1", sourceId: "WATCH-customs-a" },
    { type: "FIELD_CLOCK_ADVANCED", eventId: "QA_CATCH_CLOCK", interruptId, units: 2, reason: "inspector-office-custody" },
    { type: "FIELD_STANDING_DELTA", eventId: "QA_CATCH_STANDING", interruptId, delta: -2, causeId: "CHASE_CAUGHT_QA_CHASE_1" },
    {
      type: "FIELD_REPOSITION_INTENT",
      eventId: "QA_CATCH_REPOSITION",
      interruptId,
      locationId: "BOSTON_STREET",
      anchorId: "INSPECTOR_OFFICE_RELEASE",
      reason: "RELEASE",
    },
    { type: "FIELD_CHASE_RESOLVED", eventId: "QA_CATCH_RESOLVED", interruptId, chaseId: "QA_CHASE_1", outcome: "CAUGHT" },
  ];
  for (const event of events) session.emitFieldEvent(event);
  return [...session.committedEvents];
}

// ---------------------------------------------------------------------------
// Browser plumbing.
// ---------------------------------------------------------------------------

async function seedProfile(page, profileId, events, displayName) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() =>
    document.body.textContent?.includes("Project Archive"),
  );
  // The app's db module creates the object stores on first open; wait until
  // they exist so seeding can't race the upgrade (fresh contexts start empty).
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
    async ({ profileId, seed, events, chapterId, packageId, flowVersion, displayName }) => {
      const request = indexedDB.open("project-archive");
      await new Promise((resolvePromise, reject) => {
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(["profiles", "saves"], "readwrite");
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
          if (events) {
            transaction.objectStore("saves").put({
              profileId,
              chapterId,
              packageId,
              flowVersion,
              committedEvents: events,
              revision: 1,
              status: "IN_PROGRESS",
              updatedAt: "2026-07-22T00:00:00.000Z",
            });
          }
          transaction.oncomplete = () => {
            database.close();
            resolvePromise();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    },
    {
      profileId,
      seed: SEED,
      events,
      chapterId: CHAPTER_ID,
      packageId: PACKAGE_ID,
      flowVersion: FLOW_VERSION,
      displayName,
    },
  );
}

async function openProfile(page, displayName, query = "") {
  await page.goto(`${BASE_URL}${query}`, { waitUntil: "domcontentloaded" });
  const row = page
    .locator(".profile-row, [data-profile-row], li, article, div")
    .filter({ hasText: displayName })
    .filter({ has: page.getByRole("button", { name: "Play" }) })
    .first();
  const play = row.getByRole("button", { name: "Play" }).first();
  await play.waitFor({ state: "visible", timeout: 15000 });
  await play.click();
}

async function waitFreeRoam(page) {
  await page.waitForFunction(
    () => {
      const root = document.querySelector('[data-game-root="play"]');
      const world = document.querySelector(".world3d");
      return (
        root?.getAttribute("data-plan-request") === "FREE_ROAM" &&
        root?.getAttribute("data-field-interrupt") === "" &&
        root?.getAttribute("data-interaction-busy") === "false" &&
        world?.getAttribute("data-movement-active") === "true" &&
        typeof window.__PA_QA_TELEPORT__ === "function"
      );
    },
    null,
    { timeout: 30000 },
  );
  await page.waitForTimeout(900);
}

async function shot(page, name, settleMs = 700) {
  await page.waitForTimeout(settleMs);
  const path = resolve(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  report.screenshots.push({ name, path });
  console.log(`  [shot] ${name}`);
  return path;
}

async function teleport(page, x, z, faceY) {
  await page.evaluate(
    ({ x, z, faceY }) => window.__PA_QA_TELEPORT__(x, z, faceY),
    { x, z, faceY },
  );
  await page.waitForTimeout(400);
}

// ---------------------------------------------------------------------------
// Scenes.
// ---------------------------------------------------------------------------

async function sceneGate(page) {
  console.log("Scene 1: CP1 mastery gate ladder");
  await seedProfile(page, "slice-qa-gate", null, "Slice QA Gate");
  await openProfile(page, "Slice QA Gate", "?qaCp1=question");
  const question = page.locator('[data-checkpoint-phase="QUESTION"]');
  await question.waitFor({ state: "visible", timeout: 60000 });
  await shot(page, "10-cp1-question", 500);

  const options = page.locator(".checkpoint-option");
  const texts = await options.allTextContents();
  assert(texts.length === 3, `expected 3 options, saw ${texts.length}`);

  // The first macro item's correct answer mentions war debt; pick wrong ones.
  const correctIndex = texts.findIndex((text) => /war debt|imperial costs/i.test(text));
  assert(correctIndex >= 0, `could not identify correct option in ${JSON.stringify(texts)}`);
  const wrongIndexes = [0, 1, 2].filter((index) => index !== correctIndex);

  // Dev-server event round-trips (persist + cloud-sync attempts) can take
  // >15s each; the waits are generous so the tour validates behavior, not
  // network latency.
  const answer = async (index) => {
    await options.nth(index).click({ timeout: 60000 });
  };
  const waitGate = async (kind) => {
    await page.waitForSelector(`.checkpoint-gate[data-gate-kind="${kind}"]`, { timeout: 60000 });
  };
  const waitEnabled = async () => {
    await page.waitForFunction(
      () => {
        const buttons = [...document.querySelectorAll(".checkpoint-option")];
        return buttons.some((button) => !button.disabled);
      },
      null,
      { timeout: 60000 },
    );
  };

  await answer(wrongIndexes[0]);
  await waitGate("MEMORY_CUE");
  const memoryHint = await page.locator(".checkpoint-gate-hint").textContent();
  assert(/Remember /.test(memoryHint ?? ""), `memory cue must cue a lived moment: ${memoryHint}`);
  report.notes.push({ memoryHint });
  await shot(page, "11-gate-memory-cue", 300);
  await waitEnabled();

  await answer(wrongIndexes[0]);
  await waitGate("EXPLICIT");
  await shot(page, "12-gate-explicit", 300);
  await waitEnabled();

  await answer(wrongIndexes[1]);
  await waitGate("ELIMINATION");
  const struck = await page.locator(".checkpoint-option.is-eliminated").count();
  assert(struck >= 1, "elimination must strike a distractor");
  await shot(page, "13-gate-elimination", 300);
  await waitEnabled();

  await answer(correctIndex);
  await page.waitForFunction(
    () => !document.querySelector('.checkpoint-gate'),
    null,
    { timeout: 60000 },
  );
  await shot(page, "14-gate-resolved-next-item", 500);
}

async function sceneAlive(page) {
  console.log("Scene 2: alive world (lore read, Ned arc, owned route, mastery micros)");
  await seedProfile(page, "slice-qa-alive", aliveWorldEvents(), "Slice QA Alive");
  await openProfile(page, "Slice QA Alive");
  await waitFreeRoam(page);

  // Found-History read at the wharfage schedule (PORT_TOWN_BOSTON micro).
  // (The central notice board sits beside the crier side-job prompt, which
  // outranks KNOWLEDGE; the wharf poster stands alone.)
  await teleport(page, -139, -8.6, Math.PI);
  await page.waitForTimeout(700);
  await shot(page, "20-wharf-poster-approach");
  await page.keyboard.press("KeyF");
  const exchangeCard = page.locator(".reactive-exchange");
  await exchangeCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if (await exchangeCard.isVisible()) {
    await shot(page, "21-lore-read", 400);
    await exchangeCard.getByRole("button").first().click();
    await page.waitForFunction(
      () => document.querySelector('[data-game-root="play"]')?.getAttribute("data-field-interrupt") === "",
      null,
      { timeout: 15000 },
    );
  } else {
    report.errors.push("wharf poster exchange did not open (glyph priority?)");
  }

  // Owned-route Archive reminder at the north alley mouth.
  await teleport(page, -33, -10, Math.PI);
  await page.waitForSelector(".route-reminder", { timeout: 10000 });
  await shot(page, "22-route-reminder", 200);

  // Ned's staged arc: with NED_FETCHED_TYPE consumed, the covered-errand ask.
  await teleport(page, 9.2, 5.4, 0);
  await page.waitForTimeout(700);
  await page.keyboard.press("KeyF");
  await exchangeCard.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if (await exchangeCard.isVisible()) {
    const nedText = await exchangeCard.textContent();
    report.notes.push({ nedStage2: nedText?.slice(0, 160) });
    await shot(page, "23-ned-arc-stage2", 300);
    // Close without committing (Later).
    const later = exchangeCard.getByRole("button", { name: /Later/i });
    if (await later.isVisible().catch(() => false)) await later.click();
    else await exchangeCard.getByRole("button").last().click();
  } else {
    report.errors.push("Ned exchange did not open");
  }
  await page.waitForTimeout(1200);

  // Production student UI must not expose the internal Mastery panel.
  assert(
    (await page.locator(".world-report-toggle, .mastery").count()) === 0,
    "student-facing internal Mastery surface returned",
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-game-root="play"]')
        ?.getAttribute("data-field-interrupt") === "",
    null,
    { timeout: 10_000 },
  );
  await page.keyboard.press("Tab");
  await page.getByRole("button", { name: "Notes" }).click();
  await shot(page, "24-archive-engaged-micros", 400);
  await page.keyboard.press("Escape");
}

async function sceneRelease(page) {
  console.log("Scene 3: caught-chase release (chewed-out beat)");
  await seedProfile(page, "slice-qa-release", caughtChaseEvents(), "Slice QA Release");
  await openProfile(page, "Slice QA Release");
  await page.waitForFunction(
    () =>
      document.querySelector(".ambient-subtitle.route-reminder")
        ?.textContent?.includes("CONSTABLE"),
    null,
    { timeout: 45000 },
  );
  await shot(page, "30-chewed-out", 300);
  await page.waitForTimeout(3200);
  await shot(page, "31-chewed-out-writ-line", 100);
  // Wait for release + control back.
  await page.waitForFunction(
    () =>
      !document.querySelector(".ambient-subtitle.route-reminder")
        ?.textContent?.includes("CONSTABLE"),
    null,
    { timeout: 20000 },
  );
  await shot(page, "32-released-outside-watchhouse", 600);
}

// ---------------------------------------------------------------------------

const browser = await chromium.launch({
  executablePath: HEADLESS_SHELL,
  headless: true,
  args: [
    "--use-gl=angle",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--disable-dev-shm-usage",
  ],
});
try {
  // Warmup pass: a throwaway page visit lets the dev server finish dependency
  // optimization (which otherwise forces a mid-scene full reload) before any
  // scene begins.
  {
    const warm = await browser.newContext({ viewport: { width: 1440, height: 860 } });
    const page = await warm.newPage();
    await page.goto(BASE_URL, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(2500);
    await warm.close();
  }
  for (const scene of [sceneGate, sceneAlive, sceneRelease]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 860 },
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => report.errors.push(`pageerror: ${error.message}`));
    try {
      await scene(page);
    } catch (error) {
      report.errors.push(`${scene.name}: ${error.message}`);
      await shot(page, `error-${scene.name}`, 100).catch(() => {});
    }
    await context.close();
  }
} finally {
  await browser.close();
  writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ errors: report.errors, shots: report.screenshots.length }, null, 2));
}
if (report.errors.length > 0) process.exit(1);
