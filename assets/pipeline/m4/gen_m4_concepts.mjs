// M4 long-lead concept/texture generation (Gemini via TrueFoundry gateway).
// Scoped to the M4 batch only. Writes concept PNGs + .prompt.json sidecars into
// assets/source/concepts/m4/. 2D textures (signs/placards/banners/cards) are
// final deliverables; prop/character PNGs feed Meshy image-to-3D next.
//
// Usage: node assets/pipeline/m4/gen_m4_concepts.mjs [name ...]
//   (no args = all; otherwise only the named keys). Concurrency limited.
import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
process.chdir(ROOT);
const OUT = "assets/source/concepts/m4";
mkdirSync(OUT, { recursive: true });
const GEN = "assets/pipeline/gen_concept_image.mjs";

const PROMPTS = {
  // ---- 2D textures (flat board/paper faces; runtime planes/decals) ----
  "sign-watchhouse":
    'Flat straight-on view of a weathered rectangular painted wooden trade sign board, the wood board completely fills the frame edge to edge. Painted on the old cracked boards: a black colonial hand-lantern and a crossed watchman\'s staff and rattle inside a painted cream oval, on a dark slate-blue ground, small serif letters beneath read "WATCH HOUSE", faded oil paint, flaking edges, iron nail heads in the corners. Historically plausible 1765 colonial Boston hanging trade sign face, no background visible, no hands, no modern elements, no em dash characters.',
  "placard-andrew-oliver":
    'Flat straight-on scan of a crude 1765 colonial protest placard, a rough rectangular pine board completely filling the frame edge to edge, hand-lettered in dripping black paint. A crude folk-art painted figure of a hanged man effigy in a gentleman\'s coat, above it bold uneven capitals read "A. OLIVER" and below "STAMP-MAN", a small crude green devil and a large jack-boot painted in the lower corner, rough brush strokes, weathered nailed plank board, tack holes. No background visible, no hands, no modern elements, no watermark, no em dash characters.',
  "coinpaper-card":
    'Flat straight-on scan of an aged 1765 rag-paper study plate completely filling the frame edge to edge. On the cream foxed paper are drawn and laid: three worn Spanish silver milled dollar coins and two small silver shilling coins on the left, and on the right a folded piece of colonial Massachusetts paper currency scrip with engraved border and serif numerals, ink and engraving illustration style, slight foxing and creases. No background beyond the paper, no hands, no modern elements, no em dash characters.',
  "banner-consent":
    'Flat straight-on view of a rough off-white colonial linen protest banner cloth completely filling the frame edge to edge, gentle fabric wrinkles. Hand-painted on the cloth in dark madder-red and black serif capitals across two lines: "NO STAMP" and "BUT BY OUR OWN CONSENT", uneven hand lettering, paint bleed into weave, frayed edges. 1765 colonial Boston. No background visible, no pole, no hands, no modern elements, no em dash characters.',
  "banner-never-asked":
    'Flat straight-on view of a rough off-white colonial linen protest banner cloth completely filling the frame edge to edge, gentle fabric wrinkles. Hand-painted on the cloth in dark madder-red and black serif capitals across two lines: "WE WERE" and "NEVER ASKED", uneven hand lettering, paint bleed into weave, frayed edges. 1765 colonial Boston. No background visible, no pole, no hands, no modern elements, no em dash characters.',

  // ---- Prop concept references (single subject -> Meshy image-to-3D) ----
  "roof-walk-board":
    'Single complete rough colonial plank walk-board bridge module only, centered, full object in frame, three-quarter view, plain light gray studio background, soft even lighting, no building, no ground scenery, no people, no readable text, no watermark. Two thick weathered pine planks laid side by side forming a short flat walkway about three meters long, resting on two simple crossed timber trestle supports at each end that stand on the ground, a low single rope hand-rail on one side strung between short posts, hand-hewn nailed joinery, muted aged umber and gray weathered wood. Historically plausible 1765 colonial construction, structurally grounded and self-supporting, no Victorian, modern, fantasy, or ornate excess. Game asset reference photo style.',
  "roof-walk-board-long":
    'Single complete long rough colonial plank gangway walk-board only, centered, full object in frame, three-quarter view, plain light gray studio background, soft even lighting, no building, no ground scenery, no people, no readable text, no watermark. Three long weathered pine planks lashed and nailed together forming a narrow flat walkway about five meters long, supported by a sturdy A-frame timber trestle at the middle and short leg supports at each end all standing on the ground, thin rope hand-lines on both sides, hand-hewn nailed and lashed joinery, muted aged umber and gray weathered wood. Historically plausible 1765 colonial construction, structurally grounded and self-supporting, no modern or fantasy elements. Game asset reference photo style.',
  "effigy-oliver":
    'Single complete crude stuffed straw protest effigy dummy of a man only, centered, full object in frame, three-quarter view, plain light gray studio background, soft even lighting, no rope, no tree, no ground scenery, no people, no readable text, no watermark. A limp life-size crude figure sewn from sackcloth and stuffed with straw, dressed in a shabby colonial gentleman\'s brown coat and breeches, a crude painted cloth face, a small tricorne hat, wisps of straw at the wrists and neck, arms hanging limp, muted aged umber, cream and brown. Historically plausible 1765 Boston Stamp Act protest effigy, crude folk-made, no modern or fantasy elements, single object. Game asset reference photo style.',
  "effigy-boot":
    'Single complete large satirical protest prop of a giant jack-boot only, centered, full object in frame, three-quarter view, plain light gray studio background, soft even lighting, no rope, no ground scenery, no people, no readable text, no watermark. An oversized crude papier-mache and cloth green-soled black riding jack-boot about one meter tall with a small crude grinning green devil figure climbing out of the boot top, folk-made protest craft, muted black, dark green and umber. Historically plausible 1765 Boston Stamp Act protest boot effigy referencing Lord Bute, crude folk-made, single object, no modern or fantasy game elements. Game asset reference photo style.',
  "organizer-crate-perch":
    'Single complete stack of colonial shipping crates and a barrel forming a low speaking platform only, centered, full object in frame, three-quarter view, plain light gray studio background, soft even lighting, no ground scenery, no people, no readable text, no watermark. Two sturdy weathered wooden shipping crates stacked to form a flat standing platform about knee-to-waist high with one wooden barrel beside them, rope lashings, hand-sawn planks and iron banding, muted aged umber and gray wood. Historically plausible 1765 colonial wharf crates, structurally stable, single grouped object, no modern or fantasy elements. Game asset reference photo style.',
  "protest-torch":
    'Single complete colonial pitch torch on a wooden pole only, centered, vertical, full object in frame, three-quarter view, plain light gray studio background, soft even lighting, no flame, no fire, no ground scenery, no people, no readable text, no watermark. A tall straight wooden pole about two meters with an iron cage cresset basket at the top holding tarred rope and pitch-soaked rags ready to burn, hand-forged iron bands, muted aged umber wood and dark iron. Historically plausible 1765 colonial night-march torch, unlit, single object, no modern or fantasy elements. Game asset reference photo style.',
  "protest-banner-cloth":
    'Single complete plain colonial cloth banner hanging from a wooden cross-pole only, centered, full object in frame, three-quarter view, plain light gray studio background, soft even lighting, no ground scenery, no people, no readable text, no lettering, no watermark. A rough off-white undyed linen rectangular banner cloth with gentle wrinkles and frayed edges hung from a horizontal wooden dowel lashed to a vertical carrying pole, muted natural linen and umber wood. Historically plausible 1765 colonial protest banner blank, single object, no modern or fantasy elements. Game asset reference photo style.',
  "coin-paper-set":
    'Single complete small grouped pile of colonial money only, centered, full object in frame, three-quarter view, plain light gray studio background, soft even lighting, no table, no ground scenery, no people, no readable text, no watermark. A small heap of a few worn Spanish silver dollar coins and shilling coins beside one folded piece of colonial paper currency scrip, resting together, aged tarnished silver and cream foxed paper. Historically plausible 1765 colonial hard coin and paper money, single small grouped object, no modern or fantasy elements. Game asset reference photo style.',
  "street-dog":
    'Single complete small colonial street dog only, standing in profile, full body in frame, three-quarter view, plain light gray studio background, soft even lighting, no leash, no ground scenery, no people, no readable text, no watermark. A lean short-haired mixed-breed farm and street terrier-type dog about knee height, alert upright ears, medium tail, tan and white brindle short coat, natural realistic proportions, standing four-square on all legs. Historically plausible 1765 colonial New England town dog, ordinary mongrel, single animal, no collar tags, no modern or fantasy elements. Game asset reference photo style.',
  // Single common-press printer's ink ball. One clean subject -> Meshy image-to-3D;
  // the matched PAIR (asset key printer-ink-balls) is assembled from this one ball
  // in assemble_ink_balls.py (InkBall_Left / InkBall_Right).
  "printer-ink-ball":
    "Single eighteenth-century printer's ink ball only, complete object centered and fully visible, three-quarter view, plain light gray studio background, no table, no scenery, no people, no text, no watermark. Historically accurate 1765 English common-press printer tool: round stuffed wool pad covered in dark ink-stained leather with visible hand stitching and small tacks, mounted on a stout turned hardwood handle, heavily used but structurally sound. Not a roller, brayer, rubber stamp, boxing glove, mallet, plunger, modern tool, fantasy item, or decorative museum display. Realistic game asset reference photo style.",
  constable:
    'Single complete standing figure of a 1765 colonial Boston town watchman constable only, front view, full body head to boots in frame, standing straight in a symmetric relaxed T-pose with both arms out to the sides and legs slightly apart, plain light gray studio background, soft even lighting, no props held, no ground scenery, no other people, no readable text, no watermark. A middle-aged colonial night watchman in a plain dark slate-blue-gray civilian wool coat with pewter buttons, a buff waistcoat, dark breeches, gray wool stockings, black buckled shoes, a black tricorne hat, plain white neck stock, weathered practical civilian clothing, NOT a red British army soldier, NO red coat, NO military uniform, NO musket. Muted aged pewter, umber and slate colors. Historically accurate ordinary 1765 Boston constable of the watch, plain and civilian, no modern or fantasy elements. Game character reference, clean full-body T-pose.',
};

const ALL = Object.keys(PROMPTS);
const args = process.argv.slice(2);
const keys = args.length ? args : ALL;
const MAX = 4;
const force = process.env.M4_FORCE === "1";

function runOne(name) {
  return new Promise((res) => {
    const prompt = PROMPTS[name];
    if (!prompt) { console.log(`[skip] no prompt for ${name}`); return res(); }
    const out = `${OUT}/${name}.png`;
    if (!force && existsSync(out)) { console.log(`[cached] ${name}`); return res(); }
    console.log(`[gen] ${name}`);
    const child = spawn("node", [GEN, "--prompt", prompt, "--out", out], { stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", (d) => { log += d; });
    child.stderr.on("data", (d) => { log += d; });
    child.on("close", (code) => {
      if (code === 0) console.log(`[ok] ${name}`);
      else console.log(`[FAIL] ${name} (code ${code}): ${log.trim().split("\n").slice(-3).join(" | ")}`);
      res();
    });
  });
}

const queue = [...keys];
async function worker() {
  while (queue.length) await runOne(queue.shift());
}
await Promise.all(Array.from({ length: MAX }, worker));
console.log("M4 CONCEPTS DONE");
