// Representative browser QA for density-manifest contextual-F affordances.
import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";
import {
  buildDensityTraversalRegistrations,
  densityActionRequest,
} from "../../apps/web/src/world/densityTraversalAdapter.ts";

const output = "/tmp/density-traversal-qa";
const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:5173";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    "/tmp/pw-browsers/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell",
  args: ["--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
const httpErrors = [];
const failedRequests = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));
page.on("response", (response) => {
  if (response.status() >= 400) httpErrors.push(`${response.url()} ${response.status()}`);
});
page.on("requestfailed", (request) =>
  failedRequests.push(`${request.url()} ${request.failure()?.errorText}`),
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isExpectedHarnessDependency(text) {
  return (
    text.includes("/v1/health") ||
    [
      "dockhand-rigged.glb",
      "agitator-rigged.glb",
      "taxclerk-rigged.glb",
      "towncrier-rigged.glb",
      "goodwife-rigged.glb",
    ].some((name) => text.includes(name))
  );
}

const registrations = buildDensityTraversalRegistrations();
function registration(id) {
  const result = registrations.find((entry) => entry.record.id === id);
  if (!result) throw new Error(`missing density registration ${id}`);
  return result;
}

async function state() {
  return page.locator(".world3d").evaluate((element) => ({
    pos: (element.dataset.playerPos3d ?? "").split(",").map(Number),
    phase: element.dataset.playerMotion,
    clip: element.dataset.playerClip,
    crouched: element.dataset.playerCrouched,
    speed: Number(element.dataset.playerSpeed),
  }));
}

async function waitTraversalReady(timeout = 15000) {
  await page.waitForFunction(
    () => document.querySelector(".world3d")?.dataset.traversalActive === "true",
    undefined,
    { timeout },
  );
}

async function teleport(pos, faceY) {
  await page.evaluate(
    ({ target, yaw }) =>
      window.dispatchEvent(
        new CustomEvent("pa:qa-player-command", {
          detail: { teleport: target, faceY: yaw },
        }),
      ),
    { target: pos, yaw: faceY },
  );
  await page.waitForTimeout(220);
  await waitTraversalReady();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

async function execute(id, dir = 1, screenshot = null) {
  const item = registration(id);
  const request = densityActionRequest(item, dir);
  assert(request, `${id} is not executable`);
  const start = request.anchors[0];
  const end = request.anchors.at(-1);
  const promptLabel =
    request.kind === "VAULT"
      ? "Vault"
      : request.kind === "DUCK_UNDER"
        ? "Duck"
        : request.kind === "CLIMB_DOWN"
          ? "Climb down"
          : "Climb";
  await teleport([start.x, start.y, start.z], start.yaw ?? 0);
  await page
    .locator(".traversal-glyph", { hasText: promptLabel })
    .waitFor({ state: "visible", timeout: 5000 });
  await page.keyboard.press("KeyF");
  await page.waitForTimeout(250);
  let current = await state();
  assert(current.phase === request.kind, `${id} did not start ${request.kind}: ${JSON.stringify(current)}`);
  const expectedClip =
    request.kind === "VAULT"
      ? "vault"
      : request.kind === "DUCK_UNDER"
        ? "crouchWalk"
        : request.kind === "CLIMB_DOWN"
          ? "climbDown"
          : "climbUp";
  assert(current.clip === expectedClip, `${id} selected ${current.clip}`);
  if (screenshot) await page.screenshot({ path: `${output}/${screenshot}.png` });
  await page.waitForFunction(
    (phase) => document.querySelector(".world3d")?.dataset.playerMotion !== phase,
    request.kind,
    { timeout: 20000 },
  );
  current = await state();
  assert(current.phase === "GROUNDED", `${id} ended ${current.phase}`);
  assert(
    Math.hypot(
      current.pos[0] - end.x,
      current.pos[1] - end.y,
      current.pos[2] - end.z,
    ) < 0.02,
    `${id} missed endpoint: ${JSON.stringify(current.pos)}`,
  );
  await page.waitForTimeout(item.record.cooldownMs + 50);
  return current;
}

await page.goto(baseUrl, { waitUntil: "networkidle" });
const name = page.locator('input[placeholder="Display name"]');
if (await name.count()) {
  await name.fill(`DensityTraversalQA-${Date.now()}`);
  await page.locator('button:has-text("Create")').first().click();
  await page.waitForTimeout(500);
}
const play = page.locator('button:has-text("Play")').first();
if (await play.count()) {
  await play.click();
  await page.waitForTimeout(500);
}

const advanceLabels = [
  "Continue calibration",
  "Begin synchronization",
  "Continue",
  "Begin",
  "Enter",
  "Insert",
  "Start",
  "Synchronize",
  "Acknowledge",
  "Confirm",
];
for (let attempt = 0; attempt < 90; attempt++) {
  for (const label of advanceLabels) {
    const button = page.locator(`button:has-text("${label}"):not([disabled])`);
    if (
      (await button.count()) > 0 &&
      (await button.first().isVisible().catch(() => false))
    ) {
      await button.first().click({ timeout: 2500 }).catch(() => null);
      break;
    }
  }
  if (
    (await page.locator(".world3d").count()) &&
    (await page.locator(".world3d").getAttribute("data-traversal-active")) === "true"
  ) break;
  await page.waitForTimeout(750);
}
await waitTraversalReady();
await page.addStyleTag({
  content: ".world-controls-overlay.has-primer { display: none !important; }",
});

// Ordinary controls remain ordinary beside a density vault.
const market = registration("DENSITY.MARKET.CART.VAULT");
await teleport(market.record.start.pos, market.record.start.facing);
assert(
  !(await page.locator(".traversal-glyph").allTextContents()).some((text) =>
    text.includes("Vault"),
  ),
  "blocked market cart exposed an F vault",
);
await page.keyboard.press("Space");
await page.waitForFunction(
  () => document.querySelector(".world3d")?.dataset.playerMotion === "STANDING_JUMP",
);
await page.waitForFunction(
  () => document.querySelector(".world3d")?.dataset.playerMotion === "GROUNDED",
);
await page.keyboard.press("KeyC");
await page.waitForFunction(
  () => document.querySelector(".world3d")?.dataset.playerMotion === "CROUCH",
);
await page.keyboard.press("KeyC");
await page.waitForFunction(
  () => document.querySelector(".world3d")?.dataset.playerMotion === "GROUNDED",
);

// A measured short/shallow plank is Shift+Space-only: no F affordance, real
// solid collision, ballistic clearance and safe landing.
if (process.env.QA_SKIP_RUN_JUMP !== "1") {
const jumpable = registration("DENSITY.WHARF.BALANCE");
const jumpObb = jumpable.profile.obstacle;
await teleport(
  [jumpObb.centerX, 0, jumpObb.centerZ - jumpObb.halfZ - 12],
  0,
);
assert(
  !(await page.locator(".traversal-glyph").allTextContents()).length,
  "run-jump-clearable plank exposed F",
);
await page.keyboard.down("KeyW");
await page.keyboard.down("ShiftLeft");
await page.waitForFunction(
  () => Number(document.querySelector(".world3d")?.dataset.playerSpeed) >= 4.3,
  undefined,
  { timeout: 15000 },
);
await page.waitForFunction(
  ([centerZ, halfZ]) => {
    const pos = (document.querySelector(".world3d")?.dataset.playerPos3d ?? "")
      .split(",")
      .map(Number);
    return pos[2] >= centerZ - halfZ - 2;
  },
  [jumpObb.centerZ, jumpObb.halfZ],
  { timeout: 15000 },
);
await page.keyboard.press("Space");
await page.waitForFunction(
  () => document.querySelector(".world3d")?.dataset.playerMotion === "RUNNING_JUMP",
);
await page.keyboard.up("ShiftLeft");
await page.keyboard.up("KeyW");
await page.waitForFunction(
  () => document.querySelector(".world3d")?.dataset.playerMotion === "GROUNDED",
  undefined,
  { timeout: 15000 },
);
const jumpLanding = await state();
await page.screenshot({ path: `${output}/run-jump-clearable.png` });
assert(
  jumpLanding.pos[2] > jumpObb.centerZ + jumpObb.halfZ,
  `running jump did not clear the plank: ${JSON.stringify(jumpLanding.pos)}`,
);
if (process.env.QA_RUN_JUMP_ONLY === "1") {
  console.log("RUN_JUMP_CLEAR", JSON.stringify(jumpLanding));
  await browser.close();
  process.exit(0);
}
}

// Representative enabled objects across available authored sectors.
await execute("DENSITY.WHARF.CLIMB", 1, "wharf-climb-up");
await execute("DENSITY.WHARF.CLIMB", -1, "wharf-climb-down");
await execute("DENSITY.LIBERTY.CLIMB", 1, "liberty-climb");
await execute("DENSITY.NALLEY.DUCK.WEST", 1, "north-duck");
await execute("DENSITY.SALLEY.DUCK.EAST", -1, "south-duck");
await execute("DENSITY.SALLEY.CLIMB.MID", 1, "south-climb");

// Unsupported authored records expose no misleading F prompt/action.
for (const id of [
  "DENSITY.WHARF.CRATE.MANTLE",
  "DENSITY.EAST.CRATE.MANTLE",
  "DENSITY.MARKET.CART.VAULT",
]) {
  const item = registration(id);
  await teleport(item.record.start.pos, item.record.start.facing);
  assert(
    !(await page.locator(".traversal-glyph").allTextContents()).length,
    `${id} exposed an unsupported prompt`,
  );
  await page.keyboard.press("KeyF");
  await page.waitForTimeout(250);
  assert(
    !["VAULT", "CLIMB_UP", "CLIMB_DOWN", "DUCK_UNDER"].includes(
      (await state()).phase,
    ),
    `${id} started an authored action`,
  );
}

const relevantHttp = httpErrors.filter(
  (error) => !isExpectedHarnessDependency(error),
);
const relevantFailed = failedRequests.filter(
  (error) => !isExpectedHarnessDependency(error),
);
console.log("ENABLED", registrations.filter((entry) => entry.status === "ENABLED").length);
console.log("DISABLED", registrations.filter((entry) => entry.status !== "ENABLED").length);
console.log("PAGE_ERRORS", JSON.stringify(pageErrors));
console.log("HTTP_ERRORS", JSON.stringify(httpErrors));
console.log("FAILED_REQUESTS", JSON.stringify(failedRequests));
assert(pageErrors.length === 0, `page errors: ${pageErrors.join(" | ")}`);
assert(relevantHttp.length === 0, `HTTP errors: ${relevantHttp.join(" | ")}`);
assert(relevantFailed.length === 0, `failed requests: ${relevantFailed.join(" | ")}`);
await browser.close();
