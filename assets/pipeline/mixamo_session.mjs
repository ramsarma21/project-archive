// Opens a headed Chrome window with a persistent profile for Mixamo work.
// The human logs in once (Adobe SSO/2FA stays theirs); the saved session then
// lets the download automation (mixamo_pull.mjs) run without credentials ever
// touching the repo, env, or chat.
//   node --import tsx assets/pipeline/mixamo_session.mjs
import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const PROFILE_DIR = resolve(homedir(), ".cache/pa-mixamo-profile");
mkdirSync(PROFILE_DIR, { recursive: true });

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  viewport: { width: 1360, height: 900 },
  args: ["--disable-blink-features=AutomationControlled"],
});
const page = context.pages()[0] ?? (await context.newPage());
await page.goto("https://www.mixamo.com/", { waitUntil: "domcontentloaded" });
console.log(
  "Mixamo window open. Log in with your Adobe ID, then leave the window open (or close it — the session persists in the profile).",
);
// Keep the process alive until the window is closed by the human.
await new Promise((resolvePromise) => {
  context.on("close", resolvePromise);
});
console.log("Browser closed; session saved.");
