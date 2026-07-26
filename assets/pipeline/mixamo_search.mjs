// Dump the card titles Mixamo returns for a set of queries so a clip target can
// name an EXACT performance instead of trusting "first card wins". The pull's
// ranked-query heuristic silently picked "Pistol Kneeling Idle" for a standing
// aim and "Look Around" for a duel stand-off; this is how you avoid that.
//   node assets/pipeline/mixamo_search.mjs "Pistol Idle" "Draw Pistol" ...
import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const PROFILE_DIR = resolve(homedir(), ".cache/pa-mixamo-profile");
const OUT_DIR = resolve("test-results/mixamo-search");
mkdirSync(OUT_DIR, { recursive: true });

const queries = process.argv.slice(2);
if (queries.length === 0) {
  console.error('usage: node mixamo_search.mjs "Query One" "Query Two" ...');
  process.exit(1);
}

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  viewport: { width: 1440, height: 900 },
  args: ["--disable-blink-features=AutomationControlled"],
});
const page = context.pages()[0] ?? (await context.newPage());

await page.goto("https://www.mixamo.com/#/?page=1&type=Motion%2CMotionPack", {
  waitUntil: "domcontentloaded",
});
for (let attempt = 0; attempt < 30; attempt++) {
  await page.waitForTimeout(3000);
  if ((await page.locator("div.product.product-animation").count().catch(() => 0)) > 0) break;
}

const results = {};
for (const query of queries) {
  await page.goto(
    `https://www.mixamo.com/#/?page=1&query=${encodeURIComponent(query)}&type=Motion%2CMotionPack`,
    { waitUntil: "domcontentloaded" },
  );
  await page.waitForTimeout(4500);
  const titles = (
    await page.locator("div.product.product-animation").allTextContents()
  ).map((title) => title.trim()).filter(Boolean);
  results[query] = titles;
  console.log(`\n== "${query}" (${titles.length})`);
  for (const [index, title] of titles.entries()) console.log(`  ${index}. ${title}`);
}
writeFileSync(resolve(OUT_DIR, "titles.json"), JSON.stringify(results, null, 2));
await context.close();
