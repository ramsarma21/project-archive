// Cheap login probe for the saved Mixamo Chrome profile. Answers one question
// before any clip work is planned: does mixamo_pull.mjs still have a live
// session, or does a human need to re-authenticate?
//   node assets/pipeline/mixamo_probe.mjs
import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const PROFILE_DIR = resolve(homedir(), ".cache/pa-mixamo-profile");
const SHOT_DIR = resolve("test-results/mixamo-probe");
mkdirSync(SHOT_DIR, { recursive: true });

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  viewport: { width: 1440, height: 900 },
  args: ["--disable-blink-features=AutomationControlled"],
  acceptDownloads: true,
});
const page = context.pages()[0] ?? (await context.newPage());
await page.goto("https://www.mixamo.com/#/?page=1&type=Motion%2CMotionPack", {
  waitUntil: "domcontentloaded",
});

// The stored profile re-authenticates through an Adobe -> Google deeplink
// chain that can take far longer than a single fixed wait. Poll for the
// animation grid instead of guessing a timeout.
let cards = 0;
for (let attempt = 0; attempt < 30; attempt++) {
  await page.waitForTimeout(3000);
  cards = await page.locator("div.product.product-animation").count().catch(() => 0);
  if (cards > 0) break;
  if (/auth\.services\.adobe\.com|accounts\.google\.com/.test(page.url())) continue;
  if (!/mixamo\.com/.test(page.url())) continue;
}
await page.screenshot({ path: resolve(SHOT_DIR, "landing.png") });

const signIn = page.getByRole("button", { name: /log in|sign in/i });
const loggedOut = await signIn.isVisible().catch(() => false);
console.log(JSON.stringify({ loggedOut, animationCards: cards, url: page.url() }, null, 2));
await context.close();
process.exit(loggedOut || cards === 0 ? 1 : 0);
