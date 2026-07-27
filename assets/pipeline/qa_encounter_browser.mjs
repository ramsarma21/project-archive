// Prove the perspective encounters in the REAL browser, on the real Vite floor
// harness, with the installed Chrome — the state assertions unit tests cannot make.
//
// It reads the harness's `window.__floor` runtime handle (the same one the dawn
// QA script reads) and drives the actual overlay DOM: it fills the textarea and
// clicks the answer button, so the whole path — overlay -> dev authority ->
// runtime machine -> consequence — is exercised, not a mock of it.
//
// The dev authority (`?encounterVerdict=correct|wrong`) is deterministic and does
// not read the answer, so a run is reproducible without a grading credential.
//
// Run with a vite dev server already up:
//   node assets/pipeline/qa_encounter_browser.mjs http://127.0.0.1:4939 .shots/encounters

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:4939";
const OUT = resolve(process.argv[3] ?? ".shots/encounters");
mkdirSync(OUT, { recursive: true });

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const SCENARIOS = [
  {
    id: "shambles-correct",
    // Drop onto the street right after the mandatory opening drop, grounded.
    query: "at=B_STREET_W&toward=B_EXIT&bare=1&reduced=1&encounterVerdict=correct",
    encounterId: "SHAMBLES_STOP",
    speakers: ["WATCH_SHAMBLES", "SENTRY_GAOL"],
    verdict: "CORRECT",
  },
  {
    id: "shambles-wrong",
    query: "at=B_STREET_W&toward=B_EXIT&bare=1&reduced=1&encounterVerdict=wrong",
    encounterId: "SHAMBLES_STOP",
    speakers: ["WATCH_SHAMBLES", "SENTRY_GAOL"],
    verdict: "WRONG",
  },
  {
    id: "ropewalk-correct",
    // Drop onto the interior ropewalk floor, on the required route.
    query: "at=D2_VAULT_IN&toward=D2_STAGE&bare=1&reduced=1&encounterVerdict=correct",
    encounterId: "ROPEWALK_STOP",
    speakers: ["SENTRY_ROPEWALK"],
    verdict: "CORRECT",
  },
  {
    id: "ropewalk-wrong",
    query: "at=D2_VAULT_IN&toward=D2_STAGE&bare=1&reduced=1&encounterVerdict=wrong",
    encounterId: "ROPEWALK_STOP",
    speakers: ["SENTRY_ROPEWALK"],
    verdict: "WRONG",
  },
];

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror ${String(error).slice(0, 200)}`));
page.on("console", (message) => {
  if (message.type() === "error") {
    const text = message.text();
    // Missing GLBs are expected under ?bare and are not a logic failure.
    if (!/GLB|world\/|Could not load|404/.test(text)) errors.push(text.slice(0, 200));
  }
});

const results = [];
const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

for (const scenario of SCENARIOS) {
  console.log(`\n=== ${scenario.id}`);
  await page.goto(`${BASE}/src/mission/floor.html?${scenario.query}`, { waitUntil: "load" });
  await page.waitForSelector("canvas", { timeout: 60000 });
  await page.waitForFunction(() => (window.__floor?.ticks ?? 0) > 0, null, {
    timeout: 60000,
    polling: 50,
  });

  // 1. The stop arms and the actors approach. Sample the speaker twice to prove
  //    the body is walking through the world, supported and clear of the player.
  await page.waitForFunction(
    (id) => window.__floor?.encounterView?.encounterId === id,
    scenario.encounterId,
    { timeout: 30000, polling: 50 },
  );
  const sample = async () =>
    page.evaluate((speaker) => {
      const rt = window.__floor;
      const pose = rt.watcherPoses.find((p) => p.id === speaker);
      return {
        tick: rt.clock.tick,
        phase: rt.encounterView?.phase ?? null,
        player: { x: rt.motion.pos.x, y: rt.motion.pos.y, z: rt.motion.pos.z },
        actor: pose ? { x: pose.position.x, y: pose.position.y, z: pose.position.z } : null,
      };
    }, scenario.speakers[0]);
  const a = await sample();
  await page.waitForTimeout(300);
  const b = await sample();
  const supported = b.actor && Math.abs(b.actor.y) < 0.6;
  const spacing = b.actor
    ? Math.hypot(b.actor.x - b.player.x, b.actor.z - b.player.z)
    : 0;
  const moved = a.actor && b.actor
    ? Math.hypot(b.actor.x - a.actor.x, b.actor.z - a.actor.z)
    : 0;
  const dt = Math.max(1, b.tick - a.tick) / 60;
  check(`${scenario.id}: actor supported (y≈0)`, Boolean(supported), `y=${b.actor?.y?.toFixed(2)}`);
  check(`${scenario.id}: actor keeps personal space`, spacing > 0.6, `${spacing.toFixed(2)}m from player`);
  check(`${scenario.id}: actor approach is a walk, not a snap`, moved / dt < 3.0, `${(moved / dt).toFixed(2)} m/s`);

  // 2. The question opens: controls lock, input is owned, overlay is up.
  await page.waitForFunction(
    () => window.__floor?.encounterView?.phase === "QUESTION",
    null,
    { timeout: 30000, polling: 50 },
  );
  const atQuestion = await page.evaluate(() => ({
    locked: window.__floor.encounterLocked,
    owns: window.__floor.encounterOwnsInput,
    overlay: Boolean(document.querySelector(".msn-enc-card")),
    prompt: document.querySelector(".msn-enc-prompt")?.textContent ?? "",
    role: document.querySelector(".msn-enc-role")?.textContent ?? "",
    chips: document.querySelectorAll(".msn-enc-chip").length,
  }));
  check(`${scenario.id}: locks locomotion at the question`, atQuestion.locked === true);
  check(`${scenario.id}: owns input / freezes time`, atQuestion.owns === true);
  check(`${scenario.id}: overlay shows prompt and speaker`, atQuestion.overlay && atQuestion.prompt.length > 10 && atQuestion.chips >= 2, `role="${atQuestion.role}"`);

  // 3. Answer through the real overlay.
  await page.fill(".msn-enc-input", "A plausible answer the speaker would weigh.");
  await page.click(".msn-enc-submit");

  // 4. The verdict resolves and the consequence lands.
  await page.waitForFunction(
    () => window.__floor?.encounterView?.phase === "RESOLVED",
    null,
    { timeout: 30000, polling: 50 },
  );
  const resolved = await page.evaluate((speakers) => {
    const rt = window.__floor;
    return {
      verdictKind: rt.encounterView?.verdictKind ?? null,
      locked: rt.encounterLocked,
      tick: rt.clock.tick,
      suppression: [...rt.suppression.until.entries()],
      summaries: [...rt.encounterSummaries.values()],
      watchers: speakers.map((id) => {
        const w = rt.stealth.watchers.find((x) => x.id === id);
        return { id, state: w?.state ?? null, lastKnown: w?.lastKnown ?? null };
      }),
      resultCopy: document.querySelector(".msn-enc-result-detail")?.textContent ?? "",
    };
  }, scenario.speakers);

  check(`${scenario.id}: verdict is ${scenario.verdict}`, resolved.verdictKind === scenario.verdict, `got ${resolved.verdictKind}`);

  if (scenario.verdict === "CORRECT") {
    const suppressedIds = resolved.suppression.map(([id]) => id);
    const allSuppressed = scenario.speakers.every((id) => suppressedIds.includes(id));
    const expiry = resolved.suppression.length ? resolved.suppression[0][1] - resolved.tick : 0;
    check(`${scenario.id}: reprieve suppresses the involved guards`, allSuppressed, `suppressed=[${suppressedIds}]`);
    check(`${scenario.id}: reprieve is bounded (~10-12s)`, expiry > 300 && expiry <= 720, `${(expiry / 60).toFixed(1)}s`);
    check(`${scenario.id}: control returns after the reprieve`, resolved.locked === false);
  } else {
    const speaker = resolved.watchers[0];
    check(`${scenario.id}: wrong answer starts a pursuit`, speaker.state === "INVESTIGATING", `state=${speaker.state}`);
    check(`${scenario.id}: pursuit aims at the confrontation`, Boolean(speaker.lastKnown));
    check(`${scenario.id}: control returns so the player can run`, resolved.locked === false);
  }

  await page.screenshot({ path: join(OUT, `${scenario.id}.png`) });
  results.push({ scenario: scenario.id, atQuestion, resolved });

  // 5. Dismiss, and confirm the overlay releases.
  await page.click(".msn-enc-submit");
  await page.waitForFunction(
    () => window.__floor?.encounterView === null || window.__floor?.encounterView?.phase === "RELEASED",
    null,
    { timeout: 10000, polling: 50 },
  ).catch(() => {});
}

writeFileSync(join(OUT, "results.json"), `${JSON.stringify({ results, checks }, null, 2)}\n`);

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (errors.length) {
  console.log("page errors:");
  for (const e of [...new Set(errors)]) console.log("  ", e);
}
await browser.close();
process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1);
