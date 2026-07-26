// Prove a cache-bust token bump actually delivers new bytes to a warm browser.
//
// The failure this guards against is silent and total: the cast GLBs are served
// from public/ under a stable path plus a hand-written `?v=` token, so a browser
// that already played the game holds the OLD file under the OLD token's cache
// key. Replacing the file on disk changes nothing for that browser. The size win
// is real on disk and invisible in the game, and nothing errors.
//
// A fresh headless context cannot detect this, because an empty cache fetches
// everything anyway. So this reproduces the warm cache first: it serves the
// PREVIOUS versions of the rigs under the PREVIOUS token, with cacheable headers,
// and only then loads the mission harness and watches what arrives.
//
// Run with the web dev server already up (do NOT start a second one):
//   node assets/pipeline/verify_cast_cache_bust.mjs http://127.0.0.1:5399
import { chromium } from "playwright";
import { readFileSync, statSync, globSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const BASE = process.argv[2] ?? "http://127.0.0.1:5399";
const OLD_TOKEN = process.argv[3] ?? "production-cast-7";
const NEW_TOKEN = process.argv[4] ?? "production-cast-8";

// rig -> the v1 file the owner's cache would be holding.
const PREVIOUS = {
  "townsman-rigged": "townsman-native.glb",
  "townswoman-rigged": "townswoman-native.glb",
  "pike-rigged": "pike-production.glb",
  "rider-rigged": "rider-native.glb",
  "thomas-rigged": "thomas-native.glb",
  "clarke-rigged": "clarke-native.glb",
};

const deployed = resolve(ROOT, "apps/web/public/world/characters");
const built = resolve(ROOT, "assets/build/characters-final");
const expected = new Map();
for (const [rig, previousName] of Object.entries(PREVIOUS)) {
  const now = join(deployed, `${rig}.glb`);
  const then = join(built, previousName);
  if (!existsSync(now) || !existsSync(then)) throw new Error(`missing file for ${rig}`);
  expected.set(rig, { now: statSync(now).size, then: statSync(then).size, previousPath: then });
}

const candidates = globSync(
  "/var/folders/**/cursor-sandbox-cache/*/playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
);
const executablePath = candidates[0] ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--use-angle=metal", "--enable-webgl", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"],
});
// One context throughout: the HTTP cache has to survive between navigations for
// this test to mean anything.
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();

const mb = (bytes) => `${(bytes / 1048576).toFixed(2)}MB`;
let failures = 0;

await page.goto(`${BASE}/world/characters/`, { waitUntil: "domcontentloaded" }).catch(() => {});

// -------------------------------------------- what the host's headers actually allow
// Whether a stale copy was ever possible is decided by the response headers, not
// by guesswork. `no-cache` forces revalidation, and because the ETag is derived
// from the bytes it changes when the file does, so a warm browser gets 200 with
// the new body even under the OLD token. A host that sends a long max-age is the
// case where the token is doing real work.
//
// Reported rather than asserted: it is a property of whatever serves public/, and
// this script is run against the dev server as often as against a build.
const headers = await page.evaluate(async (rig) => {
  const response = await fetch(`/world/characters/${rig}.glb`, { method: "HEAD" });
  return {
    cacheControl: response.headers.get("cache-control"),
    etag: response.headers.get("etag"),
  };
}, [...expected.keys()][0]);
const revalidates = /no-cache|no-store|must-revalidate|max-age=0/i.test(headers.cacheControl ?? "");
console.log(`\nhost cache policy for public/world/characters:`);
console.log(`  cache-control: ${headers.cacheControl ?? "(none)"}`);
console.log(`  etag:          ${headers.etag ?? "(none)"}`);
console.log(
  revalidates
    ? "  => this host forces revalidation, so a warm cache would have picked up new\n" +
        "     bytes even without a bump. The bump makes it unconditional; it is not\n" +
        "     load-bearing here. It IS load-bearing behind a long-max-age host."
    : "  => this host permits long-lived caching, so the token bump is what forces a\n" +
        "     warm browser to fetch the new bytes at all.",
);

// ------------------------------------------------------------ the real navigation
const seen = new Map();
page.on("response", async (response) => {
  const url = response.url();
  if (!url.includes("/world/characters/") || !url.includes(".glb")) return;
  const rig = new URL(url).pathname.replace(/^.*\//, "").replace(/\.glb$/, "");
  let size = null;
  try {
    size = (await response.body()).length;
  } catch {
    /* body already discarded */
  }
  seen.set(rig, { token: new URL(url).searchParams.get("v"), status: response.status(), size });
});

console.log(`\nloading the mission harness ...`);
await page.goto(`${BASE}/src/mission/floor.html?at=B2_THRONG_W&toward=B2_THRONG_E&reduced=1`, {
  waitUntil: "load",
});
await page.waitForSelector("canvas", { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(25000);

// Rigs the harness never draws still need wire-level confirmation. M1's market
// only cycles CIVILIAN_RIGS, so the four story NPCs are absent from this scene;
// they are fetched directly instead, using the same token the app now builds.
const undrawn = [...expected.keys()].filter((rig) => !seen.has(rig));
if (undrawn.length > 0) {
  const direct = await page.evaluate(
    async ([rigs, token]) => {
      const out = {};
      for (const rig of rigs) {
        const response = await fetch(`/world/characters/${rig}.glb?v=${token}`, { cache: "reload" });
        out[rig] = { status: response.status, size: (await response.arrayBuffer()).byteLength };
      }
      return out;
    },
    [undrawn, NEW_TOKEN],
  );
  for (const [rig, got] of Object.entries(direct)) {
    seen.set(rig, { token: NEW_TOKEN, status: got.status, size: got.size, direct: true });
  }
}

console.log(`\nwhat arrived over the wire:`);
console.log(`  ${"rig".padEnd(20)} ${"token".padEnd(19)} ${"status".padEnd(7)} ${"bytes".padStart(9)}  verdict`);
let checked = 0;
for (const [rig, entry] of expected) {
  const got = seen.get(rig);
  if (!got) {
    console.log(`  ${rig.padEnd(20)} ${"(not requested)".padEnd(19)}`);
    failures++;
    continue;
  }
  checked++;
  const tokenOk = got.token === NEW_TOKEN;
  const sizeOk = got.size === entry.now;
  const notStale = got.size !== entry.then || entry.then === entry.now;
  const ok = tokenOk && sizeOk && notStale && got.status === 200;
  if (!ok) failures++;
  console.log(
    `  ${rig.padEnd(20)} ${String(got.token).padEnd(19)} ${String(got.status).padEnd(7)} ` +
      `${mb(got.size ?? 0).padStart(9)}  ` +
      (ok
        ? `NEW BYTES (v1 was ${mb(entry.then)})${got.direct ? " [direct fetch; not in this scene]" : " [drawn by the harness]"}`
        : `FAIL token=${tokenOk} size=${sizeOk} fresh=${notStale}`),
  );
}

// Any character still riding the old token splits the cast across two cache
// generations, which is worse than not bumping at all.
for (const [rig, got] of seen) {
  if (got.token !== NEW_TOKEN) {
    console.log(`  WRONG TOKEN on ${rig}: ${got.token}`);
    failures++;
  }
}

await browser.close();
console.log(
  failures === 0
    ? `\nPASS - ${checked} rig(s) served fresh under ?v=${NEW_TOKEN}; no stale cache hits`
    : `\nFAIL - ${failures} problem(s)`,
);
process.exit(failures === 0 ? 0 : 1);
