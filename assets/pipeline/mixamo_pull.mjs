// Pull motion FBXs from Mixamo using the saved login session (see
// mixamo_session.mjs) and land them in assets/source/mixamo/<clipId>.fbx,
// ready for the bake scripts. No credentials touch this script — it rides the
// persistent Chrome profile the human logged into.
//   PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-browsers node --import tsx assets/pipeline/mixamo_pull.mjs [clipId ...]
import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const PROFILE_DIR = resolve(homedir(), ".cache/pa-mixamo-profile");
const OUT_DIR = resolve("assets/source/mixamo");
const SHOT_DIR = resolve("test-results/mixamo-pull");
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(SHOT_DIR, { recursive: true });

// clipId -> ranked Mixamo search queries. First card of the first query that
// yields results wins; queries are ordered most-specific first.
const TARGETS = [
  { id: "shout", queries: ["Angry Point", "Yelling", "Shouting"], inPlace: false },
  { id: "satchelSearch", queries: ["Searching Files", "Searching", "Look Over"], inPlace: false },
  { id: "scolded", queries: ["Defeated", "Sad Idle", "Ashamed"], inPlace: false },
  { id: "ropePull", queries: ["Pulling A Rope", "Rope Pulling", "Pulling"], inPlace: true },
  { id: "read", queries: ["Standing Reading", "Reading", "Looking Down"], inPlace: false },
  { id: "sitIdle", queries: ["Sitting Idle", "Sitting"], inPlace: false },
  { id: "sitTalk", queries: ["Sitting Talking", "Sitting Dialogue"], inPlace: false },
];
const only = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const targets = only.length
  ? TARGETS.filter((target) => only.includes(target.id))
  : TARGETS;

const report = [];

setTimeout(() => {
  console.error("WATCHDOG: pull exceeded 15 minutes, aborting");
  process.exit(2);
}, 15 * 60 * 1000).unref();

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  viewport: { width: 1440, height: 900 },
  args: ["--disable-blink-features=AutomationControlled"],
  acceptDownloads: true,
});
const page = context.pages()[0] ?? (await context.newPage());

async function shot(name) {
  await page
    .screenshot({ path: resolve(SHOT_DIR, `${name}.png`) })
    .catch(() => {});
}

async function assertLoggedIn() {
  await page.goto("https://www.mixamo.com/#/?page=1&type=Motion%2CMotionPack", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(4000);
  const signIn = page.getByRole("button", { name: /log in|sign in/i });
  if (await signIn.isVisible().catch(() => false)) {
    await shot("00-not-logged-in");
    throw new Error("Mixamo session is not logged in — rerun mixamo_session.mjs and log in first.");
  }
}

async function searchAndSelect(query, clipId) {
  await dismissModalIfOpen();
  await page.goto(
    `https://www.mixamo.com/#/?page=1&query=${encodeURIComponent(query)}&type=Motion%2CMotionPack`,
    { waitUntil: "domcontentloaded" },
  );
  await page.waitForTimeout(4000);
  // Single-animation cards are div.product.product-animation (packs are a
  // different product class and are skipped automatically).
  const cards = page.locator("div.product.product-animation");
  const count = await cards.count();
  await shot(`${clipId}-1-results`);
  if (count === 0) return false;
  await cards.first().click();
  // The viewer re-processes the motion onto the current character; wait for
  // the timeline to leave "0 / 0".
  await page
    .waitForFunction(
      () => !document.body.textContent?.includes("0 / 0"),
      null,
      { timeout: 30000 },
    )
    .catch(() => {});
  await page.waitForTimeout(2500);
  await shot(`${clipId}-2-selected`);
  return true;
}

async function setInPlaceIfPresent() {
  // "In Place" renders as a labeled checkbox among the motion parameters.
  const checkbox = page
    .locator("label")
    .filter({ hasText: /in place/i })
    .locator("input[type=checkbox]")
    .first();
  if (await checkbox.isVisible().catch(() => false)) {
    if (!(await checkbox.isChecked().catch(() => false))) {
      await checkbox.click();
      await page.waitForTimeout(2500); // re-processes the motion
    }
    return true;
  }
  // Some builds put the checkbox beside a span label.
  const alt = page
    .locator("div,li")
    .filter({ hasText: /^in place$/i })
    .locator("input[type=checkbox]")
    .first();
  if (await alt.isVisible().catch(() => false)) {
    if (!(await alt.isChecked().catch(() => false))) {
      await alt.click();
      await page.waitForTimeout(2500);
    }
    return true;
  }
  return false;
}

async function selectOption(selectLocator, wanted) {
  const select = selectLocator.first();
  if (!(await select.isVisible().catch(() => false))) return false;
  const options = await select.locator("option").allTextContents();
  const match = options.find((option) =>
    option.toLowerCase().includes(wanted.toLowerCase()),
  );
  if (match) {
    await select.selectOption({ label: match });
    return true;
  }
  return false;
}

async function dismissModalIfOpen() {
  const cancel = page.getByRole("button", { name: /^cancel$/i }).first();
  if (await cancel.isVisible().catch(() => false)) {
    await cancel.click().catch(() => {});
    await page.waitForTimeout(600);
  }
}

async function downloadCurrent(clipId) {
  // The right-rail DOWNLOAD button opens the "DOWNLOAD SETTINGS" dialog. The
  // dialog carries no stable container class, so the labeled controls are
  // targeted globally (they exist nowhere else on the page).
  const trigger = page
    .locator("button, a")
    .filter({ hasText: /^download$/i })
    .first();
  await trigger.waitFor({ state: "visible", timeout: 15000 });
  await trigger.click();
  await page
    .getByText(/download settings/i)
    .waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(600);
  await shot(`${clipId}-3-modal`);
  // Format: FBX Binary (never dae).
  await selectOption(
    page.locator("select").filter({ has: page.locator("option", { hasText: /fbx binary/i }) }),
    "fbx binary",
  ).catch(() => {});
  // Skin: without skin (motion only — the bake scripts retarget).
  await selectOption(
    page.locator("select").filter({ has: page.locator("option", { hasText: /without skin/i }) }),
    "without skin",
  );
  // FPS 30.
  await selectOption(
    page.locator("select").filter({ has: page.locator("option", { hasText: /^30$/ }) }),
    "30",
  ).catch(() => {});
  await page.waitForTimeout(400);
  await shot(`${clipId}-4-modal-set`);
  const confirm = page
    .locator("button, a")
    .filter({ hasText: /^download$/i })
    .last();
  const downloadPromise = page.waitForEvent("download", { timeout: 120000 });
  await confirm.click();
  const download = await downloadPromise;
  const destination = resolve(OUT_DIR, `${clipId}.fbx`);
  await download.saveAs(destination);
  return destination;
}

await assertLoggedIn();
for (const target of targets) {
  let done = false;
  for (const query of target.queries) {
    try {
      const found = await searchAndSelect(query, target.id);
      if (!found) continue;
      if (target.inPlace) await setInPlaceIfPresent();
      const path = await downloadCurrent(target.id);
      report.push({ clip: target.id, query, path });
      console.log(`[pull] ${target.id} <- "${query}" -> ${path}`);
      done = true;
      break;
    } catch (error) {
      console.error(`[pull] ${target.id} via "${query}" failed: ${error.message.split("\n")[0]}`);
      await shot(`fail-${target.id}-${query.replaceAll(/\W+/g, "_")}`);
      // Dismiss any stuck settings dialog before the next attempt.
      await dismissModalIfOpen();
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(800);
    }
  }
  if (!done) report.push({ clip: target.id, error: "all queries failed" });
}

writeFileSync(resolve(SHOT_DIR, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await context.close();
const failures = report.filter((entry) => entry.error);
process.exit(failures.length > 0 ? 1 : 0);
