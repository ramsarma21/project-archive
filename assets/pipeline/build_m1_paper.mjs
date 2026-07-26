// Set M1's two sheets: the handbill the player carries and the Crown notice it
// goes up beside.
//
// Why the type is set here and not generated
// ------------------------------------------
// Nine whole-sheet generations are in assets/source/concepts/posters and the
// best of them is beautiful and unusable. It prints "NEW-ENGLAND fee", it drops
// the sheet on a grey background instead of bleeding it, and it says something
// content/m1 deliberately does not teach. And it is 896 x 1200, which is the
// ceiling of that route, for a sheet the player's face is a foot from during the
// nailing beat.
//
// So the sheet is split where each tool is strong. The model made the PAPER —
// rag stock, foxing, rain runs, tack holes, a thumbprint — which is exactly the
// kind of thing no code should be writing. The TYPE is set here, in Big Caslon
// and Baskerville. That is not a compromise: Caslon is the type Boston printers
// imported and set by, Baskerville was cut in 1757, and both are on this
// machine. The period reading is bought with the real faces rather than with a
// model's impression of them, and the sheet says the authored copy exactly, at
// 2048, with no hallucinated words.
//
// Where the copy comes from
// -------------------------
// Every proposition on the handbill is in content/m1/module.json, and the last
// line is that file's own sentence. See COPY for the line-by-line provenance.
// The notice's list of taxed papers is the module's own list of six exemplars,
// in the module's order, because those six are what the duel's rubrics grade.
// The pair is therefore an argument rather than two documents: the Crown's sheet
// names what is taxed, and the sheet nailed up beside it answers who laid it.
//
// Run:
//   node assets/pipeline/build_m1_paper.mjs            # every variant
//   node assets/pipeline/build_m1_paper.mjs handbill-a # one
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const STOCK = resolve(ROOT, "assets/source/concepts/m1-paper");
const OUT = resolve(ROOT, "assets/build/world-m1-paper");
const MASTERS = resolve(OUT, "masters");

// Served size. Both sheets are drawn at the aspect packages/mission-m1 declares
// them at — 0.30 x 0.40m and 0.50 x 0.70m — so nothing is stretched at draw
// time, and both are 2048 on the long edge because the precision beat puts the
// player's face right against one of them.
const LONG_EDGE = 2048;
const SHEETS = {
  handbill: { wM: 0.3, hM: 0.4 },
  notice: { wM: 0.5, hM: 0.7 },
};
// JPEG bytes under a .png name, which is what all sixteen shipped posters in
// apps/web/public/world/posters already are. An RGBA albedo whose alpha is fully
// opaque is waste — probe_texture_alpha.py exists to say so — and these sheets
// are opaque rectangles on a quad.
const JPEG_QUALITY = 82;

// ---------------------------------------------------------------------------
// The copy
// ---------------------------------------------------------------------------
// Period orthography, one deliberate exception: no long s.
//
// By 1765 the long s was universal and `handbill-unstamped-e` duly printed
// "NEW-ENGLAND fee" for "see". This sheet is read at arm's length by an eighth
// grader, and it is the one surface in the mission that states the mission's
// argument, so a glyph that costs comprehension for atmosphere is the wrong
// trade — and the shipped poster-no-consent broadside already set that
// precedent in this world. The period reading is carried instead by Caslon and
// Baskerville, by capitalised nouns, by the long dateline, by the rules, and by
// the ink and paper. Everything else about the setting is 1765.
const COPY = {
  handbill: {
    // "Boston, 14 August 1765." — module.json, IDENTITY card.
    dateline: "BOSTON, August 14. 1765.",
    address: "To the Inhabitants of this Province.",
    // The shipped poster-no-consent broadside in this same world reads "NO TAX
    // BUT BY OUR OWN CONSENT", so the handbill is printed by the same movement
    // in the same words. It is also exactly module.json's positive principle:
    // "a tax may be laid only by a body the taxed people chose".
    display: ["NO TAX", "BUT BY OUR OWN", "CONSENT."],
    body: [
      // POSTWAR card: the war ended in 1763, Britain came out owing more than
      // ever, Parliament decided the colonies should pay a share. And the card's
      // anti-reversal guard: "the debt came first, and the tax is Parliament's
      // answer to it, not the other way round."
      "THE War with France is ended these two Years, and the Debt of it remains. " +
        "Parliament has resolved that America shall pay a Share, and has laid a Duty upon our Paper " +
        "to that End. Mark the Order of it: the Debt came first, and the Stamp is Parliament's " +
        "Answer to the Debt, and not the other way about.",
      // STAMP card, both halves of the boundary, including its three physical
      // exemplars of what is outside: a bolt of cloth, a barrel of nails, a
      // letter you wrote out by hand yourself.
      "From the First Day of November next, no News Paper, Hand-Bill, Deed, Court Paper nor Licence " +
        "is good unless it carry a Stamp that some Man has paid for. It does not touch a Bolt of " +
        "Cloth, nor a Barrel of Nails, nor a Letter writ in your own Hand. It is our printed and our " +
        "legal Paper that is taxed, and a Printer's whole Trade with it.",
      // REPRESENTATION card: "the complaint is not the price — the town would
      // say the same if the stamp cost a farthing. The complaint is who laid it."
      "We do not complain of the Price. Were the Stamp a Farthing we should complain the same. " +
        "We complain of WHO LAID IT.",
      // REPRESENTATION card: Boston elects its own town meeting and its own
      // members in the Massachusetts assembly, and elects nobody in Parliament.
      "This Town chooses its own Meeting, and its own Members in the Assembly. In the Parliament " +
        "that laid this Duty it chooses NOT ONE MAN. London answers that Parliament speaks for every " +
        "Subject, chosen or not.",
    ],
    // module.json's own last word on the concept, in its own words: "A lawful
    // vote by men we never picked is still not consent."
    hammer: "A lawful Vote, by Men we never chose, is still not Consent.",
    // Abigail Mercer's shop, which module.json makes the player's employer
    // ("you run printed sheets through this town for Mercer's Press") and
    // Mission-Slate has press the wet sheet into the runner's hands. Queen
    // Street is where the level puts the printing office.
    colophon: [
      "Printed by A. MERCER, in Queen-Street,",
      "and struck off without a Stamp.",
    ],
  },
  notice: {
    crown: "GEORGE the Third, by the Grace of GOD, KING.",
    display: "STAMP-DUTIES.",
    subhead: [
      "An ACT for granting certain Stamp Duties",
      "in the British Colonies and Plantations in AMERICA.",
    ],
    body: [
      "BE it known to all His Majesty's Subjects within this Province, That from and after the First " +
        "Day of NOVEMBER next, none of the Papers herein named shall be good in Law unless it be " +
        "printed upon stamped Paper, and the Duty thereon paid.",
    ],
    // module.json's six exemplars, in the module's order, because these six are
    // what the duel's STAMP rubrics grade: "newspapers, handbills, deeds, court
    // papers, licences, even playing cards."
    list: [
      "Every News Paper.",
      "Every Hand-Bill and Pamphlet.",
      "Every Deed and Conveyance.",
      "Every Paper of the Courts.",
      "Every Licence.",
      "Every Pack of Playing Cards.",
    ],
    // The other half of the module's boundary, said by the Crown itself, which
    // is what lets the notice teach the thing the duel actually grades.
    after: [
      "Nothing herein chargeth the ordinary Goods or Merchandize of the Town, nor any Letter written " +
        "in a private Hand.",
      "Whosoever shall obstruct the same answers for it at his Peril.",
    ],
    // A fortnight before the mission's date, which is what the weathering on
    // the stock says has happened to it.
    given: [
      "Given at the Council Chamber in Boston,",
      "the Second Day of August, 1765.",
    ],
    god: "GOD Save the KING.",
  },
};

// ---------------------------------------------------------------------------
// Ink
// ---------------------------------------------------------------------------
// 1765 ink is lamp black in varnish: a warm brown-black, never neutral and never
// pure. A hand-inked forme lays it unevenly, so every line gets its own weight
// and its own hair of baseline drift, and patches of the sheet come up starved.
// All of it from one seed, so a build is reproducible.
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const INK = "#1e1710";

/** Per-line inking: a starved line goes grey and thin, a bitten one goes heavy. */
function inking(random, { spread = 1 } = {}) {
  const bite = random();
  const opacity = (0.86 + bite * 0.14).toFixed(3);
  const drift = ((random() - 0.5) * 1.1 * spread).toFixed(2);
  const skew = ((random() - 0.5) * 0.14 * spread).toFixed(3);
  // Over-inked type spreads into the paper; starved type does not.
  const bleed = bite > 0.72 ? `text-shadow:0 0 ${(bite * 1.4).toFixed(2)}px ${INK};` : "";
  return `opacity:${opacity};transform:translateY(${drift}px) skewX(${skew}deg);${bleed}`;
}

/** Blobs of thin ink, as a screen-blended lightening mask over the type only. */
function starve(random, count, width, height) {
  const blobs = [];
  for (let i = 0; i < count; i++) {
    const x = (random() * 100).toFixed(1);
    const y = (random() * 100).toFixed(1);
    const r = (8 + random() * 22).toFixed(1);
    const strength = (0.10 + random() * 0.26).toFixed(3);
    blobs.push(
      `radial-gradient(ellipse ${r}% ${(Number(r) * (0.4 + random() * 0.8)).toFixed(1)}% at ${x}% ${y}%,` +
        `rgba(255,252,245,${strength}) 0%,rgba(255,252,245,0) 70%)`,
    );
  }
  return blobs.join(",");
}

// ---------------------------------------------------------------------------
// Paper
// ---------------------------------------------------------------------------
// The generated stock supplies everything low-frequency: colour, mottle, stains,
// mildew, the tack holes, the thumbprint. Its own grain is 896 x 1200 stretched
// to 2048, so the crisp high-frequency detail — laid lines about a millimetre
// apart, chain lines about an inch — is drawn here instead, at the served
// resolution, in real-world millimetres off the sheet's declared size.
function paperLayers({ stock, crop, wPx, hPx, wM, random }) {
  const pxPerMm = wPx / (wM * 1000);
  const laid = Math.max(2, +(1.05 * pxPerMm).toFixed(2));
  const chain = +(26 * pxPerMm).toFixed(1);
  const flecks = [];
  for (let i = 0; i < 220; i++) {
    const x = (random() * 100).toFixed(2);
    const y = (random() * 100).toFixed(2);
    const size = (0.4 + random() * 1.3).toFixed(2);
    const dark = (0.06 + random() * 0.20).toFixed(3);
    flecks.push(
      `radial-gradient(ellipse ${size}px ${(Number(size) * (0.5 + random())).toFixed(2)}px at ${x}% ${y}%,` +
        `rgba(60,48,34,${dark}) 0%,rgba(60,48,34,0) 100%)`,
    );
  }
  return `
    .stock{
      position:absolute;inset:0;
      background-image:url("${stock}");
      background-repeat:no-repeat;
      /* Crop inside the deckle edge so no white surround survives into the
         albedo, while keeping whatever the stock has near its corners. */
      background-size:${(100 / crop.w).toFixed(4)}% ${(100 / crop.h).toFixed(4)}%;
      background-position:${((crop.x / (1 - crop.w)) * 100).toFixed(3)}% ${((crop.y / (1 - crop.h)) * 100).toFixed(3)}%;
    }
    .laid{
      position:absolute;inset:0;mix-blend-mode:multiply;opacity:0.30;
      background-image:
        repeating-linear-gradient(90deg,
          rgba(120,104,80,0.16) 0px,
          rgba(120,104,80,0.16) ${(laid * 0.42).toFixed(2)}px,
          rgba(255,255,255,0) ${(laid * 0.42).toFixed(2)}px,
          rgba(255,255,255,0) ${laid}px),
        repeating-linear-gradient(0deg,
          rgba(96,82,62,0.13) 0px,
          rgba(96,82,62,0.13) 1.4px,
          rgba(255,255,255,0) 1.4px,
          rgba(255,255,255,0) ${chain}px);
    }
    .fibre{position:absolute;inset:0;mix-blend-mode:multiply;background-image:${flecks.join(",")};}
  `;
}

// ---------------------------------------------------------------------------
// Cuts
// ---------------------------------------------------------------------------
// Where the ink actually is inside a generated cut, measured rather than
// guessed.
//
// The arms and the stamp device were asked for on plain white and arrived
// centred in a landscape frame with a great deal of white around them, so a
// naive `background-size:contain` box sizes itself on the WHITE and draws the
// device at a third of the size it was given room for. The first notice proof
// put a 293px box on the sheet and a 117px stamp in it, which for the one
// element the pair of sheets turns on is a red smudge.
//
// So the ink is found the way the elm sampled its bark and the plank tile its
// board bands: read the pixels. Anything darker or more saturated than paper
// counts as ink, and the returned box is in fractions of the image.
async function inkBox(tab, path) {
  return tab.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const luma = (r * 299 + g * 587 + b * 114) / 1000;
        const chroma = Math.max(r, g, b) - Math.min(r, g, b);
        // The paper these were drawn on is near-white and near-neutral; ink is
        // either dark (the woodcut) or coloured (the rose-red die).
        if (luma < 205 || chroma > 26) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return { x: 0, y: 0, w: 1, h: 1, aspect: canvas.width / canvas.height };
    // A hair of margin so an anti-aliased outer stroke is not clipped.
    const pad = Math.round(Math.max(canvas.width, canvas.height) * 0.004);
    const x0 = Math.max(0, minX - pad);
    const y0 = Math.max(0, minY - pad);
    const x1 = Math.min(canvas.width, maxX + 1 + pad);
    const y1 = Math.min(canvas.height, maxY + 1 + pad);
    return {
      x: x0 / canvas.width,
      y: y0 / canvas.height,
      w: (x1 - x0) / canvas.width,
      h: (y1 - y0) / canvas.height,
      aspect: (x1 - x0) / (y1 - y0),
    };
  }, `file://${path}`);
}

/** CSS that draws only the measured ink of `path`, filling its element. */
function cutCss(path, box) {
  return (
    `background-image:url("file://${path}");background-repeat:no-repeat;` +
    `background-size:${(100 / box.w).toFixed(4)}% ${(100 / box.h).toFixed(4)}%;` +
    `background-position:${((box.x / Math.max(1e-6, 1 - box.w)) * 100).toFixed(3)}% ` +
    `${((box.y / Math.max(1e-6, 1 - box.h)) * 100).toFixed(3)}%;`
  );
}

// ---------------------------------------------------------------------------
// The sheets
// ---------------------------------------------------------------------------

function handbill({ variant, wPx, hPx, seed }) {
  const random = rng(seed);
  const c = COPY.handbill;
  const line = (text, cls = "", opts) =>
    `<div class="${cls}" style="${inking(random, opts)}">${text}</div>`;
  const para = (text) =>
    `<p style="${inking(random, { spread: 0.5 })}">${text}</p>`;

  // Variant A leads with the slogan, which is how a protest broadside was set
  // and how this world's other broadsides are set. Variant B leads with the
  // address and holds the slogan back to the foot, which is how a reasoned
  // address was set. Both carry identical propositions.
  const head =
    variant !== "b"
      ? [
          line(c.dateline, "dateline"),
          line(c.address, "address"),
          `<div class="display">${c.display.map((l) => line(l, "displayLine", { spread: 1.4 })).join("")}</div>`,
          `<div class="rule thick"></div>`,
        ].join("")
      : [
          line(c.dateline, "dateline"),
          `<div class="display quiet">${line("TO THE", "displaySmall", { spread: 1.2 })}${line("INHABITANTS", "displayLine", { spread: 1.4 })}${line("OF THIS PROVINCE.", "displaySmall", { spread: 1.2 })}</div>`,
          `<div class="rule thick"></div>`,
        ].join("");

  const foot =
    variant !== "b"
      ? [
          `<div class="hammerBox">${line(c.hammer, "hammer")}</div>`,
          `<div class="rule thin"></div>`,
          `<div class="colophon">${c.colophon.map((l) => line(l)).join("")}</div>`,
        ].join("")
      : [
          `<div class="display tight">${c.display.map((l) => line(l, "displayLine", { spread: 1.4 })).join("")}</div>`,
          `<div class="hammerBox">${line(c.hammer, "hammer")}</div>`,
          `<div class="rule thin"></div>`,
          `<div class="colophon">${c.colophon.map((l) => line(l)).join("")}</div>`,
        ].join("");

  const body = c.body.map(para).join("");
  // Variant C keeps A's arrangement and rebalances it. The argument IS the
  // payload of this sheet — it is what the constable is about to ask about —
  // so the body copy takes size off the display rather than the other way
  // round, which is also how a printer with a lot to say set a small sheet.
  const bodySize = variant === "c" ? 38 : variant === "a" ? 34 : 31;

  return {
    stock: resolve(STOCK, "stock-handbill-fresh-a.png"),
    // The stock's own left edge is damp-dark and its extreme edges carry a
    // sliver of the background the model could not help leaving; crop inside
    // both, keeping the thumbprint at the top right.
    crop: { x: 0.035, y: 0.02, w: 0.93, h: 0.955 },
    starveCount: 9,
    // Wide margins because a compositor left the margins for the shears, and
    // because the level nails this sheet through them.
    pad: [Math.round(hPx * 0.055), Math.round(wPx * 0.088)],
    css: `
      .dateline{
        font-family:"Hoefler Text",Baskerville,serif;font-variant-caps:small-caps;
        font-variant-numeric:oldstyle-nums;letter-spacing:0.06em;
        font-size:${Math.round(wPx * 0.036)}px;text-align:center;
      }
      .address{
        font-family:Baskerville,serif;font-style:italic;
        font-size:${Math.round(wPx * 0.031)}px;text-align:center;
        margin-top:${Math.round(hPx * 0.008)}px;
      }
      .display{margin:${Math.round(hPx * 0.018)}px 0 ${Math.round(hPx * 0.012)}px;text-align:center;}
      .display.tight{margin:${Math.round(hPx * 0.014)}px 0 ${Math.round(hPx * 0.008)}px;}
      .displayLine{
        font-family:"Big Caslon",Baskerville,serif;
        font-size:${Math.round(wPx * (variant === "c" ? 0.086 : 0.098))}px;
        line-height:1.02;letter-spacing:0.012em;
      }
      .display.quiet .displayLine{font-size:${Math.round(wPx * 0.105)}px;}
      .displaySmall{
        font-family:"Big Caslon",Baskerville,serif;font-size:${Math.round(wPx * 0.046)}px;
        letter-spacing:0.16em;line-height:1.3;
      }
      p{
        font-family:Baskerville,serif;font-size:${Math.round(wPx * (bodySize / 1000))}px;
        line-height:1.30;text-align:justify;text-indent:${Math.round(wPx * 0.045)}px;
        margin:0 0 ${Math.round(hPx * 0.0115)}px;hyphens:auto;
      }
      p:first-of-type{text-indent:0;}
      .hammerBox{margin:${Math.round(hPx * 0.012)}px 0 ${Math.round(hPx * 0.012)}px;}
      .hammer{
        font-family:"Big Caslon",Baskerville,serif;font-size:${Math.round(wPx * 0.042)}px;
        text-align:center;line-height:1.2;
      }
      .colophon{
        font-family:Baskerville,serif;font-style:italic;font-variant-numeric:oldstyle-nums;
        font-size:${Math.round(wPx * 0.028)}px;text-align:center;line-height:1.34;
      }
      .rule{margin:${Math.round(hPx * 0.012)}px auto;background:${INK};opacity:0.8;}
      .rule.thick{height:${Math.max(2, Math.round(hPx * 0.0035))}px;width:100%;}
      .rule.thin{height:${Math.max(1, Math.round(hPx * 0.0014))}px;width:76%;}
    `,
    head,
    mid: body,
    foot,
  };
}

function notice({ variant, wPx, hPx, seed, cuts }) {
  const random = rng(seed);
  const c = COPY.notice;
  const line = (text, cls = "", opts) =>
    `<div class="${cls}" style="${inking(random, opts)}">${text}</div>`;
  const para = (text, cls = "") =>
    `<p class="${cls}" style="${inking(random, { spread: 0.5 })}">${text}</p>`;

  // Variant A heads with the arms and sets the device at the foot under GOD
  // SAVE THE KING, so the eye finishes on the stamp. Variant B heads with the
  // crowned cipher and sets the device in the upper right, where a clerk struck
  // it on the sheet itself. Variant C is A's arms and C's rule border with the
  // device large at the foot: the two proofs said the arms carry the Crown
  // better than a cipher does, the border reads official, and the device has to
  // be big enough to be a stamp rather than a red mark. Same copy throughout.
  const cut = variant === "b" ? "cut-royal-arms-b.png" : "cut-royal-arms-a.png";
  const armsBox = cuts[cut];
  const deviceBox = cuts["dev-stamp-america-a.png"];
  // Every cut is sized on its measured ink, and its box is given that ink's own
  // aspect, so `contain` has nothing left to decide.
  const armsW = Math.round(wPx * (variant === "b" ? 0.20 : 0.46));
  const deviceW = Math.round(wPx * (variant === "b" ? 0.15 : 0.235));
  const arms =
    `<div class="arms" style="width:${armsW}px;height:${Math.round(armsW / armsBox.aspect)}px;` +
    `${inking(random, { spread: 0.3 })}"></div>`;
  const device =
    `<div class="device ${variant}" style="width:${deviceW}px;` +
    `height:${Math.round(deviceW / deviceBox.aspect)}px;` +
    `opacity:${(0.80 + random() * 0.16).toFixed(3)};` +
    `transform:rotate(${((random() - 0.5) * 5).toFixed(2)}deg)"></div>`;

  return {
    stock: resolve(STOCK, "stock-notice-heavy-c.png"),
    // Inside the deckle edge on all four sides, which still keeps the three
    // legible tack holes and the mildew along the foot.
    crop: { x: 0.028, y: 0.022, w: 0.90, h: 0.945 },
    starveCount: 7,
    pad: [Math.round(hPx * 0.045), Math.round(wPx * 0.09)],
    extra: `
      /* darken, not multiply. Both cuts were drawn on "white" that is really a
         warm near-white, and multiplying that over the sheet prints a pale
         rectangle round the cut. darken takes the darker of cut and paper per
         channel, so the surround disappears completely and only the ink lands —
         which is also physically what a block does. */
      .arms{${cutCss(resolve(STOCK, cut), armsBox)}mix-blend-mode:darken;margin:0 auto;}
      .device{${cutCss(resolve(STOCK, "dev-stamp-america-a.png"), deviceBox)}mix-blend-mode:darken;}
      .device.a,.device.c{margin:${Math.round(hPx * 0.008)}px auto 0;}
      /* Percentages, not pixels: this one is positioned inside the zoomed forme. */
      .device.b{position:absolute;top:3.5%;right:6%;}
    `,
    css: `
      .crown{
        font-family:Baskerville,serif;font-style:italic;
        font-size:${Math.round(wPx * 0.030)}px;text-align:center;
        margin-top:${Math.round(hPx * 0.006)}px;
      }
      .display{
        font-family:"Big Caslon",Baskerville,serif;font-size:${Math.round(wPx * 0.115)}px;
        text-align:center;letter-spacing:0.03em;line-height:1.06;
        margin:${Math.round(hPx * 0.012)}px 0 ${Math.round(hPx * 0.006)}px;
      }
      .subhead{
        font-family:Baskerville,serif;font-style:italic;
        font-size:${Math.round(wPx * 0.034)}px;text-align:center;line-height:1.26;
      }
      p{
        font-family:Baskerville,serif;font-size:${Math.round(wPx * 0.0335)}px;
        line-height:1.32;text-align:justify;margin:0 0 ${Math.round(hPx * 0.010)}px;
        hyphens:auto;
      }
      .list{
        font-family:Baskerville,serif;font-size:${Math.round(wPx * 0.0355)}px;
        line-height:1.44;margin:${Math.round(hPx * 0.006)}px 0 ${Math.round(hPx * 0.010)}px
          ${Math.round(wPx * 0.10)}px;
      }
      .given{
        /* Hoefler Text rather than Baskerville: Baskerville italic kerns its
           oldstyle figures apart here and sets the year as "176 5". */
        font-family:"Hoefler Text",Baskerville,serif;font-style:italic;
        font-variant-numeric:oldstyle-nums;
        font-size:${Math.round(wPx * 0.029)}px;text-align:center;line-height:1.32;
        margin-top:${Math.round(hPx * 0.004)}px;
      }
      .god{
        font-family:"Big Caslon",Baskerville,serif;font-size:${Math.round(wPx * 0.050)}px;
        text-align:center;letter-spacing:0.04em;margin-top:${Math.round(hPx * 0.010)}px;
      }
      .rule{margin:${Math.round(hPx * 0.010)}px auto;background:${INK};opacity:0.78;}
      .rule.thick{height:${Math.max(2, Math.round(hPx * 0.0028))}px;width:100%;}
      .rule.thin{height:${Math.max(1, Math.round(hPx * 0.0012))}px;width:100%;}
      .border{
        position:absolute;inset:2.2% 4.5%;
        border:${Math.max(2, Math.round(hPx * 0.0016))}px solid ${INK};opacity:0.72;
        mix-blend-mode:multiply;
      }
    `,
    head: [
      variant === "a" ? "" : `<div class="border"></div>`,
      variant === "b" ? device : "",
      arms,
      line(c.crown, "crown"),
      line(c.display, "display", { spread: 1.4 }),
      `<div class="subhead">${c.subhead.map((l) => line(l)).join("")}</div>`,
      `<div class="rule thick"></div>`,
    ].join(""),
    mid: [
      c.body.map((t) => para(t)).join(""),
      `<div class="list">${c.list.map((l) => line(l, "", { spread: 0.7 })).join("")}</div>`,
      `<div class="rule thin"></div>`,
      c.after.map((t) => para(t)).join(""),
    ].join(""),
    foot: [
      `<div class="given">${c.given.map((l) => line(l)).join("")}</div>`,
      line(c.god, "god", { spread: 1.1 }),
      variant === "b" ? "" : device,
    ].join(""),
  };
}

const VARIANTS = {
  "handbill-a": { sheet: "handbill", build: handbill, variant: "a", seed: 17650814 },
  "handbill-b": { sheet: "handbill", build: handbill, variant: "b", seed: 17650825 },
  "handbill-c": { sheet: "handbill", build: handbill, variant: "c", seed: 17650814 },
  "notice-a": { sheet: "notice", build: notice, variant: "a", seed: 17650802 },
  "notice-b": { sheet: "notice", build: notice, variant: "b", seed: 17651101 },
  "notice-c": { sheet: "notice", build: notice, variant: "c", seed: 17650802 },
};

/** The two the mission ships, once the proofs have been judged. */
const CHOSEN = { "handbill-c": "handbill-unstamped", "notice-c": "notice-stamp-act" };

function page(spec, wPx, hPx, zoom) {
  const random = rng(spec.seed ^ 0x5f5f);
  const layers = paperLayers({
    stock: spec.built.stock,
    crop: spec.built.crop,
    wPx,
    hPx,
    wM: spec.wM,
    random,
  });
  const [padY, padX] = spec.built.pad;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box;}
    html,body{width:${wPx}px;height:${hPx}px;overflow:hidden;background:#000;}
    .sheet{position:relative;width:${wPx}px;height:${hPx}px;overflow:hidden;}
    .type{
      position:absolute;top:0;left:0;color:${INK};
      /* zoom scales this element's own box as well as its contents, so the box
         and the margins are pre-divided by it: what lands on the sheet is then
         exactly wPx x hPx with exactly the authored margin, whatever the forme
         had to be scaled to in order to fit. */
      width:${(wPx / zoom).toFixed(3)}px;height:${(hPx / zoom).toFixed(3)}px;
      padding:${(padY / zoom).toFixed(3)}px ${(padX / zoom).toFixed(3)}px;
      /* Ink on paper is a multiply, so the laid lines and the foxing read
         THROUGH the letters instead of being covered by a flat black. */
      mix-blend-mode:multiply;
      /* Three groups, and the slack between them is the leading a compositor
         opened up round the display and the imprint rather than a gap at the
         foot of the sheet. */
      display:flex;flex-direction:column;justify-content:space-between;
      zoom:${zoom};
    }
    .type>*{flex:0 0 auto;}
    .starved{
      position:absolute;inset:0;mix-blend-mode:screen;pointer-events:none;
      background-image:${starve(random, spec.built.starveCount, wPx, hPx)};
    }
    ${layers}
    ${spec.built.css}
    ${spec.built.extra ?? ""}
  </style></head><body>
    <div class="sheet">
      <div class="stock"></div>
      <div class="laid"></div>
      <div class="fibre"></div>
      <div class="type">
        <div class="head">${spec.built.head}</div>
        <div class="mid">${spec.built.mid}</div>
        <div class="foot">${spec.built.foot}</div>
      </div>
      <div class="starved"></div>
    </div>
  </body></html>`;
}

const wanted = process.argv.slice(2);
const names = wanted.length > 0 ? wanted : Object.keys(VARIANTS);
const unknown = names.filter((name) => !VARIANTS[name]);
if (unknown.length > 0) {
  console.error(`unknown variant(s): ${unknown.join(", ")}\nknown: ${Object.keys(VARIANTS).join(", ")}`);
  process.exit(1);
}

mkdirSync(MASTERS, { recursive: true });

// The browser cache in this repo is .pw-browsers, not the per-user default and
// not the /tmp path the older QA harnesses hard-code, so the binary is found
// rather than assumed. `pnpm install` is off the table, so a miss here is fatal
// and says so instead of asking Playwright to download.
function headlessShell() {
  const candidates = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    resolve(ROOT, ".pw-browsers"),
    "/tmp/pw-browsers",
  ].filter(Boolean);
  for (const base of candidates) {
    for (const build of ["chromium_headless_shell-1228", "chromium-1228"]) {
      for (const leaf of [
        "chrome-headless-shell-mac-arm64/chrome-headless-shell",
        "chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium",
      ]) {
        const path = resolve(base, build, leaf);
        try {
          statSync(path);
          return path;
        } catch {
          /* next */
        }
      }
    }
  }
  throw new Error(
    `no chromium found under ${candidates.join(", ")}; set PLAYWRIGHT_BROWSERS_PATH`,
  );
}

const browser = await chromium.launch({
  executablePath: headlessShell(),
  // inkBox reads pixels back out of a canvas, and a file:// image drawn into a
  // canvas from a page with an opaque origin both fails to load and would taint
  // it. Nothing here touches the network.
  args: ["--allow-file-access-from-files"],
});

// Measure the cuts once, before anything is set.
const measurer = await browser.newContext({ viewport: { width: 64, height: 64 } });
const scratch = await measurer.newPage();
await scratch.goto(`file://${STOCK}/`, { waitUntil: "domcontentloaded" }).catch(() => {});
await scratch.setContent("<body></body>");
const cuts = {};
for (const file of ["cut-royal-arms-a.png", "cut-royal-arms-b.png", "dev-stamp-america-a.png"]) {
  cuts[file] = await inkBox(scratch, resolve(STOCK, file));
  const box = cuts[file];
  console.log(
    `cut ${file.padEnd(24)} ink ${(box.w * 100).toFixed(1)}% x ${(box.h * 100).toFixed(1)}% ` +
      `of the frame, aspect ${box.aspect.toFixed(3)}`,
  );
}
await measurer.close();

const results = [];
for (const name of names) {
  const entry = VARIANTS[name];
  const sheet = SHEETS[entry.sheet];
  const hPx = LONG_EDGE;
  const wPx = Math.round((LONG_EDGE * sheet.wM) / sheet.hM);
  const built = entry.build({ variant: entry.variant, wPx, hPx, seed: entry.seed, cuts });
  const spec = { ...entry, built, wM: sheet.wM };

  const context = await browser.newContext({
    viewport: { width: wPx, height: hPx },
    deviceScaleFactor: 1,
  });
  const tab = await context.newPage();
  // file:// so the stock and the cuts load off disk without a server.
  await tab.goto(`file://${OUT}/`, { waitUntil: "domcontentloaded" }).catch(() => {});

  // Fit the forme to the sheet rather than trusting a font size.
  //
  // Justified body copy re-breaks whenever the type changes size, so overset is
  // not a number that can be solved once. This walks the largest scale that
  // still fits, and reports it: a sheet that had to come down to 0.6 is a sheet
  // whose copy is too long and should be cut, not quietly set in eight point.
  const measure = async () =>
    tab.evaluate(() => {
      const type = document.querySelector(".type");
      const groups = [...type.children].filter((el) => !el.classList.contains("border"));
      const used = groups.reduce((sum, el) => sum + el.getBoundingClientRect().height, 0);
      const style = getComputedStyle(type);
      const room =
        type.getBoundingClientRect().height -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom);
      return { used, room };
    });

  let zoom = 1;
  let best = null;
  let html = "";
  for (let pass = 0; pass < 7; pass++) {
    html = page(spec, wPx, hPx, zoom);
    await tab.setContent(html, { waitUntil: "load" });
    await tab.evaluate(() => document.fonts.ready);
    const { used, room } = await measure();
    const slack = room - used;
    if (slack >= 0 && (best === null || zoom > best.zoom)) best = { zoom, slack, html };
    // Inside a line of leading of full is as set as it needs to be.
    if (slack >= 0 && slack < room * 0.012) break;
    const next = +(zoom * (room / used)).toFixed(4);
    // Creep rather than jump on the last passes, so a re-break cannot oscillate.
    zoom = pass < 3 ? next : +((zoom + next) / 2).toFixed(4);
    zoom = Math.min(1.5, Math.max(0.5, zoom));
  }
  if (!best) throw new Error(`${name}: could not fit the forme onto the sheet`);
  if (best.html !== html) {
    html = best.html;
    await tab.setContent(html, { waitUntil: "load" });
    await tab.evaluate(() => document.fonts.ready);
  }
  zoom = best.zoom;
  const overset = -Math.round(best.slack);

  const master = resolve(MASTERS, `${name}.png`);
  await tab.screenshot({ path: master, type: "png" });
  await context.close();

  // Served bytes: JPEG under a .png name, the shipped poster convention. sips
  // wants the suffix to match the format, so it writes a .jpg and the bytes are
  // moved onto the served name.
  const served = resolve(OUT, `${name}.png`);
  const temp = resolve(MASTERS, `${name}.jpg`);
  execFileSync("sips", [
    "-s", "format", "jpeg",
    "-s", "formatOptions", String(JPEG_QUALITY),
    master, "--out", temp,
  ]);
  writeFileSync(served, readFileSync(temp));
  rmSync(temp);
  writeFileSync(resolve(MASTERS, `${name}.html`), html);
  // The chosen proof is also written under the key packages/mission-m1 names,
  // which is the file publish_roofline_kit.mjs promotes. Proofs stay beside it
  // so the choice is auditable rather than asserted.
  const shipped = CHOSEN[name];
  if (shipped) writeFileSync(resolve(OUT, `${shipped}.png`), readFileSync(served));
  results.push({
    name,
    shipped,
    px: `${wPx}x${hPx}`,
    zoom,
    overset: Math.round(overset),
    masterKiB: Math.round(statSync(master).size / 1024),
    servedKiB: Math.round(statSync(served).size / 1024),
  });
}
await browser.close();

console.log("");
for (const r of results) {
  console.log(
    `${r.name.padEnd(12)} ${r.px.padEnd(10)} scale ${r.zoom.toFixed(3)}  ` +
      `overset ${String(r.overset).padStart(4)}px  ` +
      `master ${String(r.masterKiB).padStart(5)} KiB   served ${String(r.servedKiB).padStart(4)} KiB` +
      (r.shipped ? `   -> ${r.shipped}.png` : ""),
  );
}
const overset = results.filter((r) => r.overset > 0);
if (overset.length > 0) {
  console.log(`\nOVERSET: ${overset.map((r) => r.name).join(", ")} — copy is too long for the sheet`);
  process.exitCode = 1;
}
console.log(`\n${results.length} sheet${results.length === 1 ? "" : "s"} set -> ${OUT.replace(ROOT + "/", "")}`);
