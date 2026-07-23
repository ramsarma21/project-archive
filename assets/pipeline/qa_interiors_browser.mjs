// Browser tour for the independent 36-interior runtime. Uses dev-only scene
// hooks and never mutates runtime/save state.
import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.argv[2] ?? "assets/build/interior-browser-qa");
const BASE_URL = process.env.INTERIOR_QA_URL ?? "http://127.0.0.1:5173/?atmoT=0.35";
const LIMIT = Number(process.env.INTERIOR_QA_LIMIT ?? 36);
mkdirSync(OUT, { recursive: true });

const INTERIORS = [
  "MERCER_PRESS", "THOMAS_COUNTINGHOUSE", "PIKE_OFFICE", "CUSTOM_HOUSE",
  "EXPLORE_warehouseHero", "EXPLORE_warehouseN2", "EXPLORE_warehouseN3",
  "EXPLORE_rowN1", "EXPLORE_rowN2", "EXPLORE_rowN3", "EXPLORE_rowN4",
  "EXPLORE_rowN5", "EXPLORE_rowN6", "EXPLORE_tavern", "EXPLORE_rowN7",
  "EXPLORE_rowN8", "EXPLORE_rowN9", "EXPLORE_rowN10", "EXPLORE_rowN11",
  "EXPLORE_rowN12", "EXPLORE_townhouse", "EXPLORE_church", "EXPLORE_ropewalk",
  "EXPLORE_chandlery", "EXPLORE_warehouseS", "EXPLORE_rowS1", "EXPLORE_rowS2",
  "EXPLORE_rowS3", "EXPLORE_clarke", "EXPLORE_rowS4", "EXPLORE_rowS5",
  "EXPLORE_rowS6", "EXPLORE_rowS7", "EXPLORE_rowS8", "EXPLORE_rowS9",
  "EXPLORE_rowS10",
];
const TOUR_INTERIORS = process.env.INTERIOR_QA_IDS
  ? process.env.INTERIOR_QA_IDS.split(",").map((id) => id.trim()).filter(Boolean)
  : INTERIORS;

const headed = process.env.INTERIOR_QA_HEADED === "1";
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: !headed,
  args: [
    headed ? "--use-angle=metal" : "--use-angle=swiftshader",
    ...(headed ? [] : ["--enable-unsafe-swiftshader"]),
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--disable-dev-shm-usage",
  ],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
const diagnostics = [];
page.on("console", (message) => {
  if (message.type() === "error" && !message.text().includes("Failed to load resource")) {
    errors.push(`console: ${message.text()}`);
  }
});
page.on("pageerror", (error) => errors.push(`page: ${String(error)}`));
page.on("response", (response) => {
  if (response.url().includes("/world/") && response.status() >= 400) {
    errors.push(`asset ${response.status()}: ${response.url()}`);
  } else if (response.status() >= 400 && !response.url().includes("/v1/health")) {
    diagnostics.push(`http ${response.status()}: ${response.url()}`);
  }
});

async function enterWorld() {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  const create = page.locator('button:has-text("Create")');
  if (await create.count()) {
    const input = page.locator('input[placeholder="Display name"]');
    if (await input.count()) await input.fill("InteriorQA");
    await create.click();
    await page.waitForTimeout(600);
  }
  for (let step = 0; step < 3; step++) {
    const continueButton = page.getByRole("button", { name: "Continue calibration" });
    const beginButton = page.getByRole("button", { name: "Begin synchronization" });
    if (await continueButton.count()) await continueButton.click();
    else if (await beginButton.count()) await beginButton.click();
    else break;
    await page.waitForTimeout(500);
  }
  const initialPlay = page.locator('button:has-text("Play")').first();
  if (await initialPlay.count()) {
    await initialPlay.click();
    await page.waitForTimeout(6500);
  }
  const advanceLabels = [
    "Continue", "Begin", "Enter", "Insert", "Start", "Synchronize",
    "Acknowledge", "ACKNOWLEDGE", "Understood", "Confirm",
    "Continue calibration", "Begin synchronization",
  ];
  for (let attempt = 0; attempt < 80; attempt++) {
    const profilePlay = page.locator('button:has-text("Play"):not([disabled])').first();
    if (
      (await profilePlay.count().catch(() => 0)) > 0 &&
      (await profilePlay.isVisible().catch(() => false))
    ) {
      await profilePlay.click().catch(() => undefined);
      await page.waitForTimeout(2500);
      continue;
    }
    const profileInput = page.locator('input[placeholder="Display name"]');
    if (
      (await profileInput.count().catch(() => 0)) > 0 &&
      (await profileInput.isVisible().catch(() => false))
    ) {
      await profileInput.fill(`InteriorQA-${Date.now()}`).catch(() => undefined);
      const createProfile = page.locator('button:has-text("Create"):not([disabled])').first();
      if (await createProfile.count()) {
        await createProfile.click().catch(() => undefined);
        await page.waitForTimeout(1200);
        continue;
      }
    }
    const ready = await page.evaluate(() => {
      const world = document.querySelector(".world3d");
      return (
        typeof window.__PA_QA_INTERIOR__ === "function" &&
        world?.dataset.movementActive === "true" &&
        world?.dataset.locationId !== "ARCHIVE_TRANSIT"
      );
    }).catch(() => false);
    if (ready) break;
    let advanced = false;
    for (const name of advanceLabels) {
      const button = page.locator(`button:has-text("${name}"):not([disabled])`).first();
      if (await button.count() && await button.isVisible()) {
        await button.click({ timeout: 2500 }).catch(() => undefined);
        advanced = true;
        break;
      }
    }
    if (advanced) {
      await page.waitForTimeout(700);
      continue;
    }
    const play = page.locator('button:has-text("Play")').first();
    if (await play.count() && await play.isVisible() && await play.isEnabled()) {
      await play.click();
      await page.waitForTimeout(2500);
    }
    const choice = page.locator(".choice-panel button.choice:visible:not([disabled])").first();
    if (await choice.count()) {
      await choice.click();
      await page.waitForTimeout(650);
    } else {
      await page.waitForTimeout(350);
    }
  }
  if (!(await page.evaluate(() => typeof window.__PA_QA_INTERIOR__ === "function").catch(() => false))) {
    await page.screenshot({ path: resolve(OUT, "bootstrap-failed.png") });
    const hooks = await page.evaluate(() => ({
      interior: typeof window.__PA_QA_INTERIOR__,
      door: typeof window.__PA_QA_DOOR__,
      teleport: typeof window.__PA_QA_TELEPORT__,
      webgl: document.querySelector(".world3d")?.dataset,
    }));
    throw new Error(`QA hook unavailable at ${page.url()} ${JSON.stringify(hooks)}: ${(await page.locator("body").innerText()).slice(0, 1200)}`);
  }
  await page.waitForSelector(".world3d canvas", { timeout: 20000 });
  await page.waitForFunction(
    () => typeof window.__PA_QA_INTERIOR__ === "function",
    null,
    { timeout: 15000 },
  );
}

await enterWorld();
const rooms = [];
async function stageInterior(id, view = "LANDING") {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await page.waitForFunction(
        () => typeof window.__PA_QA_INTERIOR__ === "function",
        null,
        { timeout: 10000 },
      );
      await page.evaluate(
        ({ interiorId, targetView }) =>
          window.__PA_QA_INTERIOR__(interiorId, targetView),
        { interiorId: id, targetView: view },
      );
      await page.waitForFunction(
        (interiorId) =>
          document.querySelector(".world3d")?.dataset.interiorId === interiorId,
        id,
        { timeout: 10000 },
      );
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(1000);
    }
  }
  throw lastError;
}
async function clearBlockingOverlays() {
  const synchronize = page.getByRole("button", { name: "Synchronize", exact: true });
  if (await synchronize.count() && await synchronize.isVisible() && await synchronize.isEnabled()) {
    await synchronize.click();
    await page.waitForTimeout(900);
  }
  const acknowledge = page.getByRole("button", { name: "ACKNOWLEDGE" });
  if (await acknowledge.count() && await acknowledge.isVisible() && await acknowledge.isEnabled()) {
    await acknowledge.click();
    await page.waitForTimeout(300);
  }
  const readOverlay = page.locator(".read-overlay");
  if (await readOverlay.count() && await readOverlay.isVisible()) {
    await readOverlay.waitFor({ state: "hidden", timeout: 8000 }).catch(() => undefined);
  }
}
for (let index = 0; index < Math.min(TOUR_INTERIORS.length, LIMIT); index++) {
  const id = TOUR_INTERIORS[index];
  await stageInterior(id);
  await page.waitForFunction(
    () => typeof window.__PA_QA_TELEPORT__ === "function",
    null,
    { timeout: 10000 },
  );
  // Call once more after Player has committed its API; this guarantees the
  // scene-local landing wins over the rig's initial exterior position.
  await stageInterior(id, "CENTER");
  await page.waitForTimeout(index < 7 ? 1500 : 750);
  await clearBlockingOverlays();
  await page.waitForTimeout(450);
  // The canonical entrance is on -Z. QA staging uses faceY=0, which looks back
  // through that doorway into the black isolation space; rotate 180° so each
  // screenshot reads the room, floor, furniture, and rear/side walls.
  await page.evaluate(() => {
    const raw = document.querySelector(".world3d")?.dataset.playerPos3d;
    const [x, , z] = (raw ?? "").split(",").map(Number);
    if (Number.isFinite(x) && Number.isFinite(z) && typeof window.__PA_QA_TELEPORT__ === "function") {
      window.__PA_QA_TELEPORT__(x, z, Math.PI);
    }
  });
  await page.waitForTimeout(index === 0 ? 2600 : 600);
  if (!(await page.locator(".world3d").count())) {
    errors.push(`world unmounted after staging ${id}: ${(await page.locator("body").innerText()).slice(0, 500)}`);
    break;
  }
  const host = await page.locator(".world3d").evaluate((node) => ({
    id: node.dataset.interiorId,
    playerPos: node.dataset.playerPos3d,
    drawCalls: Number(node.dataset.drawCalls ?? 0),
    triangles: Number(node.dataset.triangles ?? 0),
    geometries: Number(node.dataset.geometries ?? 0),
    textures: Number(node.dataset.textures ?? 0),
    programs: Number(node.dataset.programs ?? 0),
    qaCameraEnabled: node.dataset.interiorQaCameraEnabled,
    qaCamera: node.dataset.interiorQaCamera,
    qaCameraPosition: node.dataset.interiorQaCameraPosition,
    placements: Number(node.dataset.interiorPlacements ?? 0),
  }));
  const collision = await page.evaluate(() =>
    typeof window.__paCollision === "function" ? window.__paCollision() : null);
  rooms.push({
    ...host,
    collisionHits: collision?.hitIds ?? [],
    blockers: collision?.blockers?.length ?? 0,
  });
  const safe = id.replace(/^EXPLORE_/, "").replaceAll("_", "-").toLowerCase();
  await page.screenshot({ path: resolve(OUT, `${String(index).padStart(2, "0")}-${safe}.png`) });
}

// Focused inspection QA at the active Mercer press.
const canInspect = await page.evaluate(() =>
  typeof window.__PA_QA_INTERIOR__ === "function" &&
  typeof window.__PA_QA_TELEPORT__ === "function");
if (canInspect) {
  await stageInterior("MERCER_PRESS");
  await page.evaluate(() => {
    // Face the unobstructed proof-table hotspot from its aisle side.
    window.setTimeout(() => window.__PA_QA_TELEPORT__(641.8, 642.2, 0), 120);
  });
  await page.waitForTimeout(900);
  await page.keyboard.press("f");
  await page.waitForTimeout(250);
}
let inspectVisible = canInspect
  ? await page.locator(".context-inspect-card").isVisible().catch(() => false)
  : false;
if (!inspectVisible && canInspect) {
  const activated = await page.evaluate(() =>
    typeof window.__PA_QA_INSPECT__ === "function"
      ? window.__PA_QA_INSPECT__()
      : false);
  if (activated) {
    await page.waitForTimeout(250);
    inspectVisible = await page
      .locator(".context-inspect-card")
      .isVisible()
      .catch(() => false);
  }
}
if (inspectVisible) {
  await page.screenshot({ path: resolve(OUT, "inspect-mercer-press.png") });
  await page.keyboard.press("Escape");
} else {
  errors.push("inspect card did not open near Mercer press");
}

const pressQa = await page.evaluate(async () => {
  if (typeof window.__paPressV2 !== "function") return null;
  const before = window.__paPressV2();
  window.dispatchEvent(new CustomEvent("pa:mechanic-visual", {
    detail: { kind: "PRESS", progress: 0.82, active: true, phase: "ACTIVE" },
  }));
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 180));
  const active = window.__paPressV2();
  window.dispatchEvent(new CustomEvent("pa:mechanic-visual", {
    detail: { kind: "PRESS", progress: 0.82, active: false, phase: "COMMIT" },
  }));
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 720));
  const committed = window.__paPressV2();
  return { before, active, committed };
});
if (!pressQa) {
  errors.push("operable press QA hook unavailable");
} else {
  const required = ["pressPull", "pressRelease", "carriageIn", "carriageOut", "tympanOpen", "tympanClose"];
  if (!required.every((clip) => pressQa.before.clips.includes(clip))) {
    errors.push("operable press missing one or more required clips");
  }
  if (
    JSON.stringify(pressQa.before.lever) === JSON.stringify(pressQa.active.lever) &&
    JSON.stringify(pressQa.before.lever) === JSON.stringify(pressQa.committed.lever)
  ) {
    errors.push("operable press lever did not respond to mechanic progress");
  }
}

// Repeated transition/resource-stability probe. Cycle representative common,
// hero, and large-hall interiors; renderer memory may warm once but must not
// grow on the second identical cycle.
async function rendererMemory() {
  return page.locator(".world3d").evaluate((node) => ({
    geometries: Number(node.dataset.geometries ?? 0),
    textures: Number(node.dataset.textures ?? 0),
    programs: Number(node.dataset.programs ?? 0),
  }));
}
const stabilityIds = ["MERCER_PRESS", "EXPLORE_rowN1", "EXPLORE_warehouseHero", "EXPLORE_church"];
const stabilitySamples = [];
for (let cycle = 0; cycle < 3; cycle++) {
  for (const id of stabilityIds) {
    await stageInterior(id, "CENTER");
    await page.waitForTimeout(650);
  }
  stabilitySamples.push(await rendererMemory());
}
const warm = stabilitySamples[1] ?? stabilitySamples[0];
const finalMemory = stabilitySamples.at(-1);
const resourceGrowth = finalMemory && warm ? {
  geometries: finalMemory.geometries - warm.geometries,
  textures: finalMemory.textures - warm.textures,
  programs: finalMemory.programs - warm.programs,
} : null;
if (resourceGrowth && (resourceGrowth.geometries > 1 || resourceGrowth.textures > 1)) {
  errors.push(`renderer resource growth after repeated transitions: ${JSON.stringify(resourceGrowth)}`);
}

const commonOverBudget = rooms.filter((room) =>
  room.id !== "EXPLORE_church" &&
  room.drawCalls > (["MERCER_PRESS", "THOMAS_COUNTINGHOUSE", "PIKE_OFFICE", "CUSTOM_HOUSE", "EXPLORE_tavern", "EXPLORE_warehouseHero"].includes(room.id) ? 140 : 80));
const report = {
  generatedAt: new Date().toISOString(),
  url: BASE_URL,
  roomCount: rooms.length,
  rooms,
  inspectVisible,
  pressQa,
  stabilitySamples,
  resourceGrowth,
  commonOverBudget,
  errors: [...new Set(errors)],
  diagnostics: [...new Set(diagnostics)],
};
writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  roomCount: report.roomCount,
  inspectVisible,
  maxDrawCalls: Math.max(...rooms.map((room) => room.drawCalls)),
  maxTriangles: Math.max(...rooms.map((room) => room.triangles)),
  overBudget: commonOverBudget.map((room) => ({ id: room.id, drawCalls: room.drawCalls })),
  resourceGrowth,
  errors: report.errors,
}, null, 2));

await browser.close();
process.exit(report.errors.length ? 1 : 0);

