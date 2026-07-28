// Drop the REAL client at the in-node of each authored VAULT / CLIMB_OVER (and a
// couple of edge descents), hold W+Shift, and record the window.__diag black box
// per transition — the same admissible path as drive-climbs.mjs. Measures the
// solver-vs-spline divergence to decide whether these verbs share the CLIMB_UP
// face-planted-anchor defect before touching them.
//
//   node .affordwork/drive-vaults.mjs [baseURL] [seed] [secondsPer]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:5273";
const SEED = process.argv[3] ?? "0xb057";
const SECS = Number(process.argv[4]) || 6;
const OUT = new URL("./vaults-out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// in -> out. Every authored VAULT and CLIMB_OVER link in route.ts / route2.ts.
const XINGS = [
  ["B_VAULT_IN", "B_VAULT_OUT", "VAULT"],
  ["C_LANE_VAULT_IN", "C_LANE_VAULT_OUT", "VAULT"],
  ["D_VAULT_IN_0", "D_VAULT_OUT_0", "VAULT"],
  ["D_VAULT_IN_1", "D_VAULT_OUT_1", "VAULT"],
  ["F_VAULT_IN", "F_VAULT_OUT", "VAULT"],
  ["B2_GOODS_IN", "B2_GOODS_OUT", "VAULT"],
  ["D2_VENT_IN_0", "D2_VENT_OUT_0", "VAULT"],
  ["D2_VENT_IN_1", "D2_VENT_OUT_1", "VAULT"],
  ["D2_VAULT_IN", "D2_VAULT_OUT", "VAULT"],
  ["C_LANE_GATE_IN", "C_LANE_GATE_OUT", "CLIMB_OVER"],
  ["D2_OVER_IN", "D2_OVER_OUT", "CLIMB_OVER"],
];

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const perr = [];
page.on("pageerror", (e) => perr.push(String(e).slice(0, 200)));

async function waitRuntime() {
  for (let i = 0; i < 200; i++) {
    const t = await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null);
    if (t !== null) return true;
    await sleep(150);
  }
  return false;
}
const READ = () => page.evaluate(() => {
  const rt = window.__floor; if (!rt || !rt.motion) return null; const m = rt.motion;
  return { tick: rt.ticks, pos: { x: +m.pos.x.toFixed(2), y: +m.pos.y.toFixed(2), z: +m.pos.z.toFixed(2) }, grounded: m.grounded, verb: rt.flow?.verb, preview: rt.flow?.previewVerb, phase: m.phase };
}).catch(() => null);

const results = [];
for (const [inNode, outNode, expect] of XINGS) {
  const url = `${BASE}/src/mission/floor.html?at=${inNode}&toward=${outNode}&back=1.2&bare=1&seed=${SEED}`;
  await page.goto(url, { waitUntil: "commit", timeout: 60000 });
  if (!(await waitRuntime())) { log(`${inNode}->${outNode}: NO RUNTIME`); results.push({ inNode, outNode, error: "no runtime" }); continue; }
  await sleep(1200);
  await page.mouse.click(640, 400).catch(() => {});
  await page.evaluate(() => { window.__diag?.reset?.(); }).catch(() => {});
  const before = await READ();
  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("KeyW");
  const start = Date.now();
  let jumpCd = 0;
  while (Date.now() - start < SECS * 1000) {
    const s = await READ();
    if (jumpCd > 0) jumpCd -= 1;
    if (s && s.grounded && jumpCd === 0 && ["JUMP", "JUMP_GAP", "LEAP_OF_FAITH"].includes(s.preview)) {
      await page.keyboard.press("Space").catch(() => {}); jumpCd = 4;
    }
    await sleep(70);
  }
  await page.keyboard.up("KeyW").catch(() => {});
  await page.keyboard.up("ShiftLeft").catch(() => {});
  const after = await READ();
  const diag = await page.evaluate(() => {
    const d = window.__diag; if (!d) return null; return { authored: d.authored, embeds: d.embeds };
  }).catch(() => null);

  let maxDiv = 0, maxEmbed = 0, embedId = null;
  const verbs = new Set();
  const perVerb = new Map(); // verb -> maxDiv
  if (diag) for (const a of diag.authored) {
    verbs.add(a.verb);
    if (a.divergenceM > maxDiv) maxDiv = a.divergenceM;
    if (a.deepestEmbedM > maxEmbed) { maxEmbed = a.deepestEmbedM; embedId = a.deepestEmbedId; }
    perVerb.set(a.verb, Math.max(perVerb.get(a.verb) ?? 0, a.divergenceM));
  }
  const strictWorst = new Map();
  if (diag) for (const e of diag.embeds) for (const s of e.strict) {
    if (!strictWorst.has(s.id) || s.depthM > strictWorst.get(s.id)) strictWorst.set(s.id, s.depthM);
  }
  const r = {
    inNode, outNode, expect,
    verbs: [...verbs],
    committedExpected: verbs.has(expect),
    maxDivergenceM: +maxDiv.toFixed(3),
    perVerbDiv: [...perVerb.entries()].map(([v, d]) => `${v}:${d.toFixed(3)}`),
    maxAuthoredEmbedM: +maxEmbed.toFixed(3),
    authoredEmbedId: embedId,
    strictEmbeds: [...strictWorst.entries()].map(([id, d]) => `${id}:${d.toFixed(3)}`),
    from: before?.pos, to: after?.pos,
  };
  results.push(r);
  log(`${inNode}->${outNode} [${expect}]: committed=${r.committedExpected} verbs=${r.verbs.join(",")} maxDiv=${r.maxDivergenceM}m perVerb=[${r.perVerbDiv.join(", ")}] maxEmbed=${r.maxAuthoredEmbedM}m(${embedId ?? "-"}) strict=[${r.strictEmbeds.join(", ")}] from${JSON.stringify(r.from)} to${JSON.stringify(r.to)}`);
  if (diag && (maxDiv > 0.03 || maxEmbed > 0.03)) writeFileSync(`${OUT}${inNode}__${outNode}.json`, JSON.stringify(diag.authored));
}
writeFileSync(`${OUT}summary.json`, JSON.stringify(results, null, 2));
log("\npage errors:", perr.length, perr.slice(0, 3));
log("-> wrote", OUT);
await browser.close();
