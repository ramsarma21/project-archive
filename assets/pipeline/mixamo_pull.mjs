// Pull motion FBXs from Mixamo using the saved login session (see
// mixamo_session.mjs) and land them in assets/source/mixamo/<clipId>.fbx,
// ready for the bake scripts. No credentials touch this script — it rides the
// persistent Chrome profile the human logged into.
//   PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-browsers node --import tsx assets/pipeline/mixamo_pull.mjs [clipId ...]
import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const PROFILE_DIR = resolve(homedir(), ".cache/pa-mixamo-profile");
const OUT_DIR = resolve("assets/source/mixamo");
const SHOT_DIR = resolve("test-results/mixamo-pull");
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(SHOT_DIR, { recursive: true });

// clipId -> ranked Mixamo search queries. First card of the first query that
// yields results wins; queries are ordered most-specific first. Batches are
// kept as a record of which pull produced which clip; --batch selects one.
const BATCHES = {
  "feel-2026-07-22": [
    { id: "shout", queries: ["Angry Point", "Yelling", "Shouting"], inPlace: false },
    { id: "satchelSearch", queries: ["Searching Files", "Searching", "Look Over"], inPlace: false },
    { id: "scolded", queries: ["Defeated", "Sad Idle", "Ashamed"], inPlace: false },
    { id: "ropePull", queries: ["Pulling A Rope", "Rope Pulling", "Pulling"], inPlace: true },
    { id: "read", queries: ["Standing Reading", "Reading", "Looking Down"], inPlace: false },
    { id: "sitIdle", queries: ["Sitting Idle", "Sitting"], inPlace: false },
    { id: "sitTalk", queries: ["Sitting Talking", "Sitting Dialogue"], inPlace: false },
  ],
  // Flintlock duel + vertical parkour mission.
  //
  // `match` is a substring of the card's title+description and is REQUIRED for
  // anything ambiguous. Taking the first card is actively dangerous here:
  // "Pistol Idle" returns a KNEELING idle first, "Draw Pistol" returns that same
  // kneeling idle, and "Hit Reaction" has six same-titled cards of which the
  // first is on the ground. Every one of those shipped silently on the first
  // pull. Card order is not stable either, so match on text, not on index.
  //
  // Mixamo's gun library is modern (two-hand brace). A flintlock is fired
  // one-handed, so the left arm is brought down to the side at bake time
  // (ONE_HANDED_PISTOL in bake_native_mixamo_character.py); the underlying
  // performances still supply correct recoil, reload and stance timing.
  "duel-2026-07-25": [
    // Anchored on "Description:" because the kneeling card's description
    // ("Kneeling Idle With Aimed Pistol") contains the standing one's as a
    // substring and sorts first.
    { id: "idleAim", queries: ["Pistol"], match: "Description: Idle With Aimed Pistol", inPlace: true },
    { id: "fire", queries: ["Pistol Shoot"], match: "Shooting Pistol", inPlace: true },
    { id: "reload", queries: ["Reload Gun"], match: "Reloading", inPlace: true },
    { id: "draw", queries: ["Pistol"], match: "Pistol Aim To Holster Idle", inPlace: true },
    { id: "standoff", queries: ["Pistol"], match: "Ready Alert Two Hand Pistol Grip", inPlace: true },
    { id: "hitReaction", queries: ["Pistol"], match: "Hit Reaction While Holding A Pistol", inPlace: true },
    { id: "aimWalk", queries: ["Pistol"], match: "Walking With An Aimed Pistol", inPlace: true },
    { id: "aimRun", queries: ["Pistol"], match: "Running With Aimed Pistol", inPlace: true },
    { id: "dodge", queries: ["Sprinting Forward Roll"], match: "Sprinting Forward Roll", inPlace: true },
    { id: "death", queries: ["Dying"], match: "Dying", inPlace: false },
    { id: "sprint", queries: ["Fast Run"], match: "Fast Run", inPlace: true },
    { id: "land", queries: ["Hard Landing"], match: "Hard Landing", inPlace: true },
  ],
  // The ten clips packages/engine-world/src/parkour/clips.ts asks for. Every
  // `match` was chosen by reading the actual card descriptions
  // (mixamo_search.mjs) rather than guessing a query, because the verbs the
  // parkour system names are not the words Mixamo files them under.
  "parkour-2026-07-25": [
    // "Pulling Up To A Ledge" is the fast one-hand pull; Mixamo's other climbs
    // are ladders, ropes and slow wall ascents.
    { id: "mantle", queries: ["Climbing"], match: "Description: Pulling Up To A Ledge", inPlace: false },
    // Candidate B for mantle, REJECTED (kept for provenance; not in CLIPS).
    // "Pulling Up To A Ledge" ends with the torso folded over the lip rather than
    // standing, so this card, which says "To Standing" outright, was pulled and
    // compared. It is worse: a 240cm freehang ascent that swings the body fully
    // horizontal mid-clip, which would read as absurd on a waist-high wall. The
    // 189cm ledge pull is the closer scale; its folded exit is covered by the
    // landing clip the traversal system already resolves after every verb.
    { id: "mantleAlt", queries: ["Hanging"], match: "Freehang Climb To Standing", inPlace: false },
    // Exactly the authored spec: enters from a run and exits back into one.
    { id: "slide", queries: ["Slide"], match: "Running To Slide And Back To Running", inPlace: true },
    // Mixamo has no clean curb absorb. This is the closest: a single planted
    // stride onto an object. Verify it does not read as a jump.
    { id: "stepUp", queries: ["Step Up"], match: "Step Up To Jump Over Object", inPlace: false },
    { id: "climbOver", queries: ["Climbing"], match: "Climb Through Fence And Jump Down", inPlace: false },
    // Landing that keeps stride, as opposed to the absorbing "land".
    { id: "landRun", queries: ["Landing"], match: "Jump Into Run Forward", inPlace: false },
    // Braced hang = facing the wall, which is what the spec asks for.
    { id: "hangDrop", queries: ["Hanging"], match: "Braced Hang Drop To Standing", inPlace: false },
    // Standing throw rather than the running grenade: upper-body dominant, so it
    // has a chance of blending additively over locomotion.
    { id: "throwLight", queries: ["Throw"], match: "Throwing An Object From A Standard Pose", inPlace: false },
    // Judgement call. Mixamo has no plain unhurried civilian walk; the library is
    // rifle walks, drunk walks, zombie walks and struts. This one is relaxed with
    // free hands and no runner's urgency.
    { id: "blendWalk", queries: ["Walking"], match: "Walking With A Swagger", inPlace: true },
    // "Leap of faith" is an Assassin's Creed term with no Mixamo equivalent, and
    // no single card carries the move. It is built as a two-clip chain:
    //   leapOfFaithDive  the committed launch off the ledge (plays once)
    //   leapOfFaith      the held descent, looped for the fall's duration
    // The launch matters because a falling idle alone reads as someone who FELL;
    // the dive entry is what reads as someone who CHOSE.
    { id: "leapOfFaithDive", queries: ["Dive"], match: "Diving From A Run Pose", inPlace: false },
    { id: "leapOfFaith", queries: ["Dive"], match: "Mid-Air Falling Idle", inPlace: false },
    // Sit up, swing out, stand: emerging from the hay cart.
    { id: "leapOfFaithLand", queries: ["Getting Up"], match: "Getting Up From Back", inPlace: false },
  ],
  // Giving dropRoll its own performance.
  //
  // dropRoll shipped as an ALIAS of dodge (CLIP_SOURCE mapped it to dodge.fbx),
  // so the landing roll and the combat evade were byte-identical on the rig —
  // one 1.20s "Sprint To Forward Roll To Sprinting" under two names. The
  // parkour contract asks dropRoll to read as a "shoulder roll out of a 2.2-5.5m
  // drop", which is a different event from evading a shot at sprint speed: it
  // begins in the air and absorbs downward momentum.
  //
  // "Falling To Roll" is that performance verbatim. Both cards are pulled so the
  // choice is made by looking at them rather than by guessing which of two
  // same-titled cards is better, the way mantle/mantleAlt was decided.
  "landing-2026-07-26": [
    { id: "dropRoll", queries: ["Falling To Roll"], match: "Description: Mid-Air Falling Into A Roll Game Blend", inPlace: true },
    { id: "dropRollAlt", queries: ["Falling To Roll"], match: "Description: Mid-Air Falling Into A Roll", exclude: "Game Blend", inPlace: true },
  ],
  // The player's dash verb (packages/engine-world/src/parkour/clips.ts, VERB_CLIP.DASH).
  //
  // Mixamo files no card under "dash" — the whole "Dash" query is cyclic runs,
  // strafes and falls (see test-results/mixamo-search/titles.json). The verb's
  // read is "an explosive directed push off one foot, low and forward,
  // recovering into a run" that "must read as a decision rather than a faster
  // stride". The one card that IS that launch, rather than a loop, is "Idle To
  // Sprint" ("Start Sprint From Action Idle"): the actor drops into a low
  // action-ready crouch and drives off the plant into a sprint — a committed
  // burst, not a cycle. Anchored on the description because the "Idle To Sprint"
  // title also fronts rifle/aiming starts.
  //
  // Pulled In Place so Mixamo strips the forward travel at the source; the bake
  // then owns horizontal placement (dash is code-driven), keeping only the
  // clip's vertical drive down-and-forward, which is the read.
  "dash-2026-07-27": [
    { id: "dash", queries: ["Sprint Start", "Idle To Sprint"], match: "Start Sprint From Action Idle", inPlace: true },
  ],
};
const args = process.argv.slice(2);
const batchArg = args.find((arg) => arg.startsWith("--batch="))?.split("=")[1];
const batch = batchArg ?? "parkour-2026-07-25";
const TARGETS = BATCHES[batch];
if (!TARGETS) {
  console.error(`unknown batch "${batch}"; known: ${Object.keys(BATCHES).join(", ")}`);
  process.exit(2);
}
const force = args.includes("--force");
const only = args.filter((arg) => !arg.startsWith("-"));
const selected = only.length
  ? TARGETS.filter((target) => only.includes(target.id))
  : TARGETS;
// Re-downloading an FBX that is already on disk wastes a slow browser round
// trip and risks landing a different first card than the one already verified.
const targets = force
  ? selected
  : selected.filter((target) => {
      if (!existsSync(resolve(OUT_DIR, `${target.id}.fbx`))) return true;
      console.log(`[pull] ${target.id} already present, skipping (--force to redo)`);
      return false;
    });

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
  // The saved profile re-authenticates through an Adobe -> Google deeplink
  // chain that regularly takes 15s+. Poll for the grid rather than assuming a
  // fixed wait, otherwise a live session reports as logged out.
  for (let attempt = 0; attempt < 30; attempt++) {
    await page.waitForTimeout(3000);
    if ((await page.locator("div.product.product-animation").count().catch(() => 0)) > 0) return;
  }
  await shot("00-not-logged-in");
  throw new Error("Mixamo session is not logged in — rerun mixamo_session.mjs and log in first.");
}

async function searchAndSelect(query, clipId, match, exclude) {
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
  const titles = (await cards.allTextContents()).map((title) => title.trim());
  let index = 0;
  if (match) {
    // `exclude` is how you name the SHORTER of two cards whose descriptions are
    // prefixes of each other. "Mid-Air Falling Into A Roll" is a substring of
    // "Mid-Air Falling Into A Roll Game Blend", so a match alone always returns
    // whichever sorts first and there is no way to ask for the other one.
    index = titles.findIndex(
      (title) =>
        title.toLowerCase().includes(match.toLowerCase()) &&
        (!exclude || !title.toLowerCase().includes(exclude.toLowerCase())),
    );
    if (index < 0) {
      console.error(`[pull] ${clipId}: no card matching "${match}" among ${count} results`);
      return false;
    }
  }
  // Record which card actually won so the report names the real Mixamo
  // performance behind each clip id, not just the query that found it.
  const chosen = titles[index].replace(/Description:.*$/s, "").trim();
  await cards.nth(index).click();
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
  return chosen || true;
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
      const found = await searchAndSelect(query, target.id, target.match, target.exclude);
      if (!found) continue;
      const inPlace = target.inPlace ? await setInPlaceIfPresent() : false;
      const path = await downloadCurrent(target.id);
      const card = typeof found === "string" ? found : null;
      report.push({ clip: target.id, query, card, inPlace, path });
      console.log(`[pull] ${target.id} <- "${query}" card="${card}" inPlace=${inPlace} -> ${path}`);
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
