// Concepts and materials for M1's roofline kit, the arcade pier and the paper.
//
// Two kinds of output, and the split is the point:
//
//   MATERIALS  seamless overhead orthographic albedo squares. Every prop in this
//              kit is either flat (a plank walk, a leaded gambrel deck) or a
//              simple prismatic solid (a corbelled chimney, a brick pier), and
//              for those a generated mesh buys nothing a generated material does
//              not. The road kit already proved the economics: its paving
//              materials paved the whole level for 1.9MB where its own GLB
//              plates would have cost 23MB.
//
//   PAPER      the handbill and the stamped notice, straight to their served
//              size. These are the two most important things in the list even
//              though they are the smallest, because the player's face ends up
//              a foot from one of them during the nailing beat, and they are what
//              the mission is about. They are textures and nothing else.
//
// Several candidates per subject, chosen afterwards on evidence rather than
// taking the first. Each candidate's prompt is written from documented 1765
// material rather than from a generic category, because these are humble objects
// and humble objects have no grand silhouette to carry them — the period reading
// is entirely in the surface.
//
// Run: node assets/pipeline/gen_roofline_concepts.mjs [subject ...]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const CONCEPTS = resolve(ROOT, "assets/source/concepts/m1-roofline");
const PAPER = resolve(ROOT, "assets/source/concepts/posters");
// Paper STOCK and cut ornaments, as opposed to whole sheets: the ingredients
// build_m1_paper.mjs sets type onto. See the note above the STOCK subjects.
const PAPERSTOCK = resolve(ROOT, "assets/source/concepts/m1-paper");

// A seamless-tile clause every material candidate carries verbatim, lifted from
// the road kit's own published prompts (assets/source/concepts/roads/materials)
// because those tiles demonstrably tile.
const TILE =
  "Perfectly overhead orthographic seamless square albedo texture, filling the frame edge to edge. " +
  "No perspective, no object edges, no background, no border, no cast shadows, no lighting gradient, " +
  "no vignette. Opposite edges tile invisibly. Flat even illumination.";

const PERIOD =
  "Boston, Massachusetts, 1765. Muted, weathered, working-town palette; nothing new, nothing bright, " +
  "nothing modern. No modern materials, no plastic, no paint, no machine-perfect repetition.";

// The paper's framing clause, and it earns its length.
//
// This route ignores `size` and always returns a 1024 square, so a sheet that
// needs to be served 3 wide by 4 tall has to be generated square and cropped.
// That only works if the type is set inside the middle three quarters of the
// width, which is also how a real handbill was set: the compositor left the
// margins for the shears. And the paper has to run off all four edges, because
// the first pass came back as a photograph of a document lying on a grey desk,
// complete with drop shadow, and a drop shadow baked into an albedo map is a
// grey border round the sheet forever.
const SHEET =
  "Photographed dead flat and perfectly straight on, no perspective, no tilt. " +
  "FULL BLEED: the sheet of paper is LARGER than this picture and is cropped by all four edges of it, so every " +
  "single pixel of the image is paper or printing ink. No desk, no table, no wall, no surface, no drop shadow, " +
  "no vignette, no background of any kind is visible anywhere. " +
  "The printed type block occupies only the middle three quarters of the width, leaving wide clear paper margins " +
  "down the left and right edges, and the type block is taller than it is wide.";

// Blank paper stock. Every clause here is load-bearing: the model's reflex on
// "old paper" is to print something on it, and one hallucinated word baked into
// the stock is a word under the real type forever.
const BLANK =
  "A photograph of a sheet of blank unprinted paper, lit flat and evenly, straight on with no perspective. " +
  "FULL BLEED: the sheet is LARGER than this picture and is cropped away by all four edges, so every single " +
  "pixel is paper. No desk, no table, no wall, no surface, no drop shadow, no vignette, no background. " +
  "ABSOLUTELY NOTHING IS PRINTED OR WRITTEN ON THIS PAPER: no letters, no words, no numbers, no type, no " +
  "handwriting, no lines of text, no border, no watermark device, no seal, no ornament, no picture. It is a " +
  "blank sheet and nothing but a blank sheet.";

// Aspect has to be bought in words: this route returns a square when `size` is
// sent and picks its own shape when it is not, so the only lever on shape is the
// prompt. Repeated at the front because it is the instruction most often lost.
const PORTRAIT =
  "A TALL PORTRAIT image, three units wide by four units tall, clearly and obviously taller than it is wide. ";

// A cut or a device, on nothing, so it can be multiplied onto the stock. A cut
// that arrives with its own paper behind it drags a second paper texture into
// the sheet, and two papers at two scales is exactly what reads as a decal.
const ISOLATED =
  "Centred on a perfectly plain flat pure white background, filling most of the frame, straight on and flat. " +
  "No paper texture, no parchment, no aging, no border, no frame, no drop shadow, no vignette, no background " +
  "detail of any kind: white, and the subject.";

/**
 * Every candidate. `dir` chooses the output tree, `size` is only sent when the
 * subject needs an aspect the model would not pick on its own.
 */
const SUBJECTS = {
  // ---- the paper -------------------------------------------------------
  // 3:4 portrait, served at 0.30 x 0.40m. A cheap, fast, unstamped job off
  // Edes & Gill's press in Queen Street — the shop the mission opens on.
  // The verse is the one that was actually pinned to Oliver's effigy in the
  // elm on the morning of 14 August 1765, which makes the sheet the player
  // nails up the same document the mission is named after.
  "handbill-unstamped-a": {
    dir: PAPER,
    prompt:
      SHEET +
      " A small cheap 1765 Boston handbill, printed in haste. " +
      "Laid rag paper, warm off-white to pale oatmeal, visible laid lines and chain lines. " +
      "Letterpress in a transitional serif with a blackletter display line; uneven inking, some letters grey and " +
      "starved, some over-inked and squashed, slight show-through from the back. Generous margins. " +
      "Small-capital dateline at the top reads \"BOSTON, August 14. 1765.\" " +
      "Large display line reads \"WHAT greater Joy did NEW-ENGLAND see\". " +
      "Second display line reads \"Than a STAMPMAN hanging on a Tree!\" " +
      "Then two lines of smaller roman text reading \"The Stamp-Master is this Day exhibited in the great Elm at " +
      "the South End.\" and \"Let every Friend to LIBERTY come and behold him.\" " +
      "Then a bold line in spaced capitals: \"NO STAMPED PAPER TO BE HAD.\" " +
      "At the foot, small italic: \"EDES and GILL, in Queen-Street.\" " +
      "The long s is used throughout, as in \"Stamp-Maſter\" and \"ſee\". " +
      "No royal arms, no crown, no stamp device of any kind anywhere on the sheet: this sheet is unstamped and " +
      "that absence is the whole point. Slight foxing, one thumb-smudge of ink, faint crease. " +
      "No em dash characters anywhere. " +
      PERIOD,
  },
  "handbill-unstamped-b": {
    dir: PAPER,
    prompt:
      SHEET +
      " A small 1765 Boston liberty handbill. " +
      "Cheap laid rag paper in warm cream, chain lines visible, two tack holes at the top. " +
      "Rough letterpress: a heavy blackletter headline over roman body type, ink unevenly bitten, one line " +
      "visibly crooked on the page as if the forme was locked up in a hurry. Wide uneven margins. " +
      "Blackletter headline reads \"Liberty, Property, and No Stamps.\" " +
      "Under it a printed rule, then roman text reading \"BOSTON, August 14. 1765.\" " +
      "Then a paragraph reading \"This Morning the STAMP-MASTER of this Province is found hanging in the great " +
      "Elm at the South End, with a Boot and a Devil beside him.\" " +
      "Then a spaced capital line: \"COME AND SEE HIM.\" " +
      "At the foot small italic: \"Printed by EDES and GILL, Queen-Street. Unstamped.\" " +
      "The long s is used throughout. " +
      "No royal arms, no crown, no revenue stamp device anywhere. Slight foxing, a smear of press ink at one edge. " +
      "No em dash characters anywhere. " +
      PERIOD,
  },
  // 5:7 portrait, served at 0.50 x 0.70m: a big official broadside, and the
  // one that carries the revenue stamp device the handbill pointedly lacks.
  "notice-stamp-act-a": {
    dir: PAPER,
    prompt:
      SHEET +
      " A large official 1765 royal broadside notice, formal letterpress. " +
      "Good heavy laid rag paper, pale warm grey-white, crisp even impression from a well-inked forme. " +
      "At the top centre a printed royal coat of arms woodcut, lion and unicorn supporters, over the letters " +
      "\"G R\". Header in large roman capitals reads \"STAMP-DUTIES\". " +
      "Under it, in italic: \"An ACT for granting and applying certain Stamp Duties in the British Colonies in " +
      "AMERICA.\" " +
      "Then two short paragraphs of small formal serif text beginning \"BE it known to all His Majesty's Subjects " +
      "within this Province, That from and after the First Day of November One thousand seven hundred and sixty " +
      "five, no Instrument, Pamphlet, News Paper, Almanack, Deed nor Bill of Lading shall be valid unless written " +
      "or printed upon stamped Vellum, Parchment or Paper.\" " +
      "A line lower down in capitals reads \"GOD Save the KING.\" " +
      "In the upper right corner, printed distinctly and legibly, the revenue stamp device itself: a small circular " +
      "device the size of a coin, a crown above a Tudor rose and a thistle sprig, ringed by the legend AMERICA and " +
      'the words "ONE PENNY", impressed in dark rose-red ink so it stands out from the black type around it. ' +
      "A thin double printed rule frames the text. Four tack holes, one at each corner, and slight weather staining " +
      "down one side as if it has been nailed up outdoors. The long s is used throughout. " +
      "No em dash characters anywhere. " +
      PERIOD,
  },
  "notice-stamp-act-b": {
    dir: PAPER,
    prompt:
      SHEET +
      " A large 1765 Massachusetts governor's proclamation broadside. " +
      "Heavy laid rag paper, warm stone-white, letterpress with a formal transitional serif and a blackletter " +
      "opening word. At the very top a crowned GR royal cipher woodcut, small and centred. " +
      "Header capitals read \"By His EXCELLENCY the GOVERNOR, A PROCLAMATION\". " +
      "The body opens with a large blackletter word \"Whereas\" and continues in roman: \"the Duties upon stamped " +
      "Vellum, Parchment and Paper take Force within this Province upon the First Day of November next; and " +
      "whereas divers riotous Persons have presumed to obstruct the same: ALL Magistrates, Sheriffs and " +
      "Constables are hereby strictly required to suppress every such Riot, Tumult and unlawful Assembly.\" " +
      "Then, set apart: \"Given at the Council Chamber in Boston, the Fourteenth Day of August, 1765.\" " +
      "Then capitals: \"GOD Save the KING.\" " +
      "Centred low on the sheet, printed clearly, the revenue stamp device: a circular coin-sized mark, a crown " +
      "over a rose and thistle, the legend AMERICA around the rim and the value below, struck in dark red ink. " +
      "Wide margins, thin single rule border, four tack holes, a rain-run streak of dissolved ink at the lower edge. " +
      "The long s is used throughout. No em dash characters anywhere. " +
      PERIOD,
  },

  // Round two on both sheets, and the fix is the copy rather than the prompt.
  //
  // Rounds one and two came back landscape however the aspect was worded,
  // because seven short lines ARE a wide shallow block and the model was
  // setting the copy it was given. A 0.30 x 0.40m handbill is twelve inches by
  // sixteen and a real one carried far more type than that, so the tall aspect
  // is bought by writing a tall sheet's worth of copy rather than by asking
  // for one.
  //
  // The notice also gains its reason to exist here. What is nailed to the elm
  // on the morning of the 14th is the order to take the effigy down — the
  // sheriff was commanded to cut it down and did not dare, which the mission's
  // own README says — so the official sheet the player nails beside is that
  // order. It makes the pair an argument rather than two documents.
  "handbill-unstamped-c": {
    dir: PAPER,
    prompt:
      "A TALL PORTRAIT sheet, three units wide by four units tall, noticeably taller than it is wide. " +
      SHEET +
      " A 1765 Boston handbill struck off in a hurry on a common press. " +
      "Laid rag paper, warm oatmeal off-white, laid and chain lines showing through, light foxing, one corner " +
      "thumbed and grubby, a smear of press ink at one edge. Letterpress in an 18th century transitional serif " +
      "with the long s used initially and medially but never at the end of a word; uneven inking, some lines " +
      "grey and starved, some bitten heavy, one line very slightly out of level. " +
      "The type is set as a TALL COLUMN with these elements stacked down the sheet in this order, filling it " +
      "from top to bottom with a clear margin all round: " +
      "small capitals \"BOSTON, August 14. 1765.\"; " +
      "then a large display couplet on four short lines, \"WHAT greater Joy did\" / \"NEW-ENGLAND see\" / " +
      "\"Than a STAMPMAN\" / \"hanging on a Tree!\"; " +
      "then a printed rule across the column; " +
      "then a paragraph of body text, \"THE Stamp-Master of this Province is this Day exhibited in the great Elm " +
      "at the South End of the Town, with a Boot beside him and the Devil climbing out of it.\"; " +
      "then a second paragraph, \"The Sheriff is commanded to cut him down. Let him try.\"; " +
      "then a third paragraph, \"Let every Friend to LIBERTY come and behold him, and let no Man hinder the Peace " +
      "of the Town.\"; " +
      "then a bold spaced-capital couplet on two lines, \"NO STAMPED PAPER\" / \"TO BE HAD HERE.\"; " +
      "then a rule; " +
      "then a small italic colophon on two lines, \"Printed by EDES and GILL, in Queen-Street,\" / " +
      "\"where this Sheet was struck off without a Stamp.\" " +
      "No royal arms, no crown, no revenue stamp device anywhere on this sheet: it is unstamped and that absence " +
      "is the whole point of it. No em dash characters anywhere. Every word spelled correctly and legibly; no " +
      "scrambled or nonsense words. " +
      PERIOD +
      " Remember: the finished image is TALLER THAN IT IS WIDE, a portrait sheet.",
  },
  "handbill-unstamped-d": {
    dir: PAPER,
    prompt:
      "A TALL PORTRAIT sheet, three units wide by four units tall, noticeably taller than it is wide. " +
      SHEET +
      " A 1765 Boston liberty handbill, cheap and quickly set. " +
      "Cheap laid rag paper in warm cream gone slightly brown at the edges, chain lines visible, two tack holes " +
      "at the top, one corner torn away. Rough letterpress, a heavy blackletter display line over roman body " +
      "type, ink unevenly bitten, visible bite of the type into the paper. " +
      "Set as a TALL COLUMN, these elements stacked down the sheet in this order and filling it top to bottom: " +
      "a blackletter headline on two lines, \"Liberty, Property,\" / \"and No Stamps.\"; " +
      "a thick printed rule; " +
      "small capitals \"BOSTON, August 14. 1765.\"; " +
      "a crude small woodcut of a great spreading elm tree with a figure hanging from one limb, heavy black " +
      "folk-art lines, about a quarter of the sheet's width; " +
      "a paragraph, \"THIS Morning the Stamp-Master of this Province is found hanging in the great Elm at the " +
      "South End, with a Boot and a Devil beside him.\"; " +
      "a paragraph, \"He that would be free, let him come and see.\"; " +
      "a spaced-capital line, \"COME AND SEE HIM.\"; " +
      "a rule; " +
      "a small italic colophon, \"Printed by EDES and GILL, Queen-Street. Unstamped.\" " +
      "The long s is used initially and medially but never at the end of a word. " +
      "No royal arms, no crown and no revenue stamp device anywhere. No em dash characters anywhere. " +
      "Every word spelled correctly and legibly; no scrambled or nonsense words. " +
      PERIOD +
      " Remember: the finished image is TALLER THAN IT IS WIDE, a portrait sheet.",
  },
  "notice-stamp-act-c": {
    dir: PAPER,
    prompt:
      "A TALL PORTRAIT broadside, five units wide by seven units tall, clearly taller than it is wide. " +
      SHEET +
      " A large official 1765 Massachusetts proclamation broadside, formal letterpress, well printed. " +
      "Heavy good laid rag paper, pale warm stone-white, crisp even impression, four tack holes, a rain-run " +
      "streak of dissolved ink down one side from being nailed up outdoors. Formal transitional serif with the " +
      "long s used initially and medially but never at the end of a word. A thin single printed rule frames the " +
      "whole sheet. " +
      "Set as a TALL COLUMN, these elements stacked down the sheet in this order and filling it top to bottom " +
      "with a clear margin all round: " +
      "a printed royal coat of arms woodcut at the top centre, lion and unicorn supporters, with the letters " +
      "\"G R\" beneath it; " +
      "roman capitals \"By His EXCELLENCY the GOVERNOR,\"; " +
      "large spaced roman capitals \"A PROCLAMATION\"; " +
      "a paragraph opening with a large blackletter word \"Whereas\" and continuing in roman, \"the Duties upon " +
      "stamped Vellum, Parchment and Paper take Force within this Province upon the First Day of November next:\"; " +
      "a paragraph, \"AND WHEREAS divers riotous Persons have this Day presumed to expose an Effigy in the great " +
      "Elm at the South End of this Town:\"; " +
      "a paragraph, \"ALL Magistrates, Sheriffs and Constables are hereby strictly required to take down the same, " +
      "and to suppress every such Riot, Tumult and unlawful Assembly.\"; " +
      "a line, \"Given at the Council Chamber in Boston, the Fourteenth Day of August, 1765.\"; " +
      "a small italic line, \"By Order of His Excellency.\"; " +
      "and last, roman capitals \"GOD Save the KING.\" " +
      "In the upper right corner, printed distinctly and legibly, the revenue stamp device itself: a circular " +
      "device the size of a large coin, a crown above a Tudor rose and a thistle sprig, ringed by the legend " +
      "AMERICA and the words ONE PENNY, struck in dark rose-red ink so it stands out from the black type. " +
      "All the text fits inside the sheet with a clear margin below the last line; nothing is cut off at any edge. " +
      "No em dash characters anywhere. Every word spelled correctly and legibly; no scrambled or nonsense words. " +
      PERIOD +
      " Remember: the finished image is TALLER THAN IT IS WIDE, a portrait broadside.",
  },
  "notice-stamp-act-d": {
    dir: PAPER,
    prompt:
      "A TALL PORTRAIT broadside, five units wide by seven units tall, clearly taller than it is wide. " +
      SHEET +
      " A large official 1765 royal notice of the Stamp Duties, formal letterpress, nailed up out of doors. " +
      "Heavy laid rag paper, warm grey-white, weather-stained down both sides, four tack holes, one lower corner " +
      "curled. Formal serif type with the long s used initially and medially but never at the end of a word. " +
      "Set as a TALL COLUMN, these elements stacked down the sheet in this order and filling it top to bottom: " +
      "a small crowned GR royal cipher woodcut at the top centre; " +
      "large roman capitals \"STAMP-DUTIES\"; " +
      "an italic subheading on two lines, \"An ACT for granting certain Stamp Duties\" / \"in the British Colonies " +
      "in AMERICA.\"; " +
      "a thin rule; " +
      "a paragraph, \"BE it known to all His Majesty's Subjects within this Province, That from and after the " +
      "First Day of November next, no Instrument, Pamphlet, News Paper, Almanack, Deed nor Bill of Lading shall " +
      "be valid unless printed upon stamped Paper.\"; " +
      "then a short list of five lines, each an item and a sum: \"Every Pamphlet, One Shilling\", \"Every " +
      "Almanack, Two Pence\", \"Every News Paper, One Penny\", \"Every Deed, One Shilling Six Pence\", \"Every " +
      "Bill of Lading, Four Pence\"; " +
      "a thin rule; " +
      "a line, \"Whosoever shall obstruct the same doth answer for it at his Peril.\"; " +
      "and last, roman capitals \"GOD Save the KING.\" " +
      "Centred low on the sheet below the last line, printed clearly, the revenue stamp device: a circular " +
      "coin-sized mark, a crown over a rose and thistle, the legend AMERICA around the rim and the value below, " +
      "struck in dark rose-red ink. " +
      "All the text fits inside the sheet with a clear margin below the last line; nothing is cut off at any edge. " +
      "No em dash characters anywhere. Every word spelled correctly and legibly; no scrambled or nonsense words. " +
      PERIOD +
      " Remember: the finished image is TALLER THAN IT IS WIDE, a portrait broadside.",
  },

  // ---- paper stock and cuts --------------------------------------------
  // Round three, and it changes the division of labour rather than the wording.
  //
  // Rounds one and two asked one model call for a whole finished sheet: paper,
  // type, copy and all. The paper always came back beautiful and the type never
  // came back trustworthy — `handbill-unstamped-e` is the best of the nine and
  // it still prints "NEW-ENGLAND fee", drops the sheet on a grey background
  // instead of bleeding it, and says something the mission's own content
  // deliberately does not teach. And it is 896 x 1200, which is all this route
  // will ever give: a sheet the player's face is a foot from wants 2048.
  //
  // So the sheet is split at the seam where each tool is strong. The model makes
  // the PAPER — rag stock, foxing, stains, tack holes, the dirt of a working
  // town, which is exactly the kind of thing no code should be writing. The
  // TYPE is set by build_m1_paper.mjs in Big Caslon and Baskerville, which are
  // on this machine: Caslon is the type Boston printers actually imported and
  // Baskerville was cut in 1757, so the period reading is bought with the real
  // faces rather than with a model's impression of them. That also means the
  // sheet says the authored copy exactly, at 2048, with no hallucinated words.
  //
  // These stocks are therefore BLANK on purpose, and the prompts have to fight
  // for that: asked for old paper, the model's first instinct is to print
  // something on it.
  "stock-handbill-cheap-a": {
    dir: PAPERSTOCK,
    prompt:
      BLANK +
      " Cheap coarse 18th century laid rag paper, the sort a jobbing printer kept for handbills. " +
      "Warm oatmeal off-white gone a little brown and uneven, definitely not white and definitely not yellow. " +
      "Visible laid lines and widely spaced chain lines pressed into the sheet by the mould. Coarse pulp with " +
      "flecks and specks of darker fibre and a few linen threads beaten into it. Light scattered brown foxing " +
      "spots, one soft crease, one grubby thumbed corner, a faint grey smudge of printing ink at one edge. " +
      PERIOD,
  },
  "stock-handbill-cheap-b": {
    dir: PAPERSTOCK,
    prompt:
      BLANK +
      " Coarse cheap colonial rag paper, warm cream to pale oatmeal, mottled and blotchy in large soft patches " +
      "where the pulp lay unevenly. Laid lines fine and close, chain lines about an inch apart. Scattered dark " +
      "fibre flecks, two small foxing blooms, faint water tide-line low down, edges very slightly darker than " +
      "the middle from handling. Nothing printed, nothing written, no marks that could be read as letters. " +
      PERIOD,
  },
  "stock-notice-heavy-a": {
    dir: PAPERSTOCK,
    prompt:
      BLANK +
      " Good heavy 18th century laid rag paper of the quality used for an official proclamation, nailed up out " +
      "of doors for a fortnight. Pale warm stone-grey-white. Laid and chain lines clear. Weather has run grey " +
      "streaks down it and left a soft brown tide-line; a little green-grey mildew low down; four small torn " +
      "tack holes, one near each corner, each with a rust ring around it. One lower corner curled and frayed. " +
      "Nothing printed on it. " +
      PERIOD,
  },
  "stock-notice-heavy-b": {
    dir: PAPERSTOCK,
    prompt:
      BLANK +
      " Heavy good laid rag paper, warm grey-white, weathered outdoors: broad soft rain-run stains down both " +
      "sides, dust and soot greying the surface unevenly, a dried brown watermark across one corner, small " +
      "insect-nibbled edge losses, four tack holes with rust bleeding into the fibre. Firm smooth stock, laid " +
      "lines showing where the light rakes it. Completely unprinted. " +
      PERIOD,
  },
  // Round two on the stock, and it is two corrections.
  //
  // Both first stocks came back landscape, and a landscape sheet cropped to a
  // portrait one throws away three fifths of it — including, on the notice, the
  // tack holes, which are in the corners of the sheet the model drew and not of
  // the sheet being served. Asking for portrait costs one call.
  //
  // The second correction is the mission's, not the model's. The handbill is not
  // an old document: Mission-Slate has Abigail press the WET sheet into the
  // runner's hands at 0:00 and the run takes three minutes, so it is minutes old
  // when it goes up. Foxing and tide-lines are the Crown notice's business —
  // that one HAS been nailed up outdoors. Making the pair a fresh sheet against
  // a weathered one is free, and it is the difference between two documents and
  // a document answering a document.
  "stock-handbill-fresh-a": {
    dir: PAPERSTOCK,
    prompt:
      PORTRAIT +
      BLANK +
      " Cheap coarse 18th century laid rag paper, one sheet of a jobbing printer's cheapest stock, FRESH and NEW " +
      "and still faintly damp from the press. Warm oatmeal off-white, clean, no age spots and no foxing at all. " +
      "Laid lines and widely spaced chain lines pressed in by the mould. Coarse pulp with dark fibre flecks and " +
      "beaten-in linen threads. Very slightly cockled and wavy where the damping water is still in it, a shade " +
      "darker and cooler down one edge where it is wettest. One corner grubby from a hand that has just held it, " +
      "and a faint grey thumb-smear of printing ink. Nothing printed on it. " +
      PERIOD,
  },
  "stock-notice-heavy-c": {
    dir: PAPERSTOCK,
    prompt:
      PORTRAIT +
      BLANK +
      " Good heavy 18th century laid rag paper of the quality used for an official proclamation, and it has been " +
      "nailed up out of doors for a fortnight. Pale warm stone-grey-white. Laid and chain lines clear. Rain has " +
      "run long grey streaks straight DOWN the sheet from top to bottom and left a soft brown tide-line across " +
      "it; green-grey mildew gathering along the bottom edge; dust and soot greying it unevenly. Four small torn " +
      "tack holes, one near each of the four corners, each with a rust ring bled into the fibre around it. The " +
      "lower right corner is curled and frayed. Nothing printed on it. " +
      PERIOD,
  },
  // The revenue stamp device, which is the one thing on the Crown's sheet that
  // no font can set and the one thing the pair of sheets turns on: the notice
  // carries it and the handbill pointedly does not. Wanted isolated on flat
  // white so it can be multiplied onto the stock without dragging a second
  // paper texture in behind it.
  "dev-stamp-america-a": {
    dir: PAPERSTOCK,
    prompt:
      ISOLATED +
      " The 1765 American revenue stamp device, drawn as a single circular embossed mark about the size of a " +
      "large coin, filling the frame. Inside the circle: a royal crown above a Tudor rose and a thistle sprig " +
      "on one stem. Around the rim, following the circle, the single word AMERICA at the top and the words ONE " +
      "PENNY at the bottom, in small 18th century roman capitals, correctly spelled and legible. Printed in " +
      "dark rose-red ink, slightly uneven, with the crisp bitten edge of an intaglio die and a faint blind " +
      "impression around it. Nothing else in the frame.",
  },
  "dev-stamp-america-b": {
    dir: PAPERSTOCK,
    prompt:
      ISOLATED +
      " An 18th century British revenue stamp die impression, circular, filling the frame: a crown over a rose " +
      "and thistle, a beaded ring inside the rim, and around the rim in small clean roman capitals the word " +
      "AMERICA above and ONE PENNY below, spelled correctly. Struck in dull red-brown ink, the lines fine and " +
      "engraved rather than drawn, edges slightly ragged where the ink took unevenly. No lettering anywhere " +
      "except AMERICA and ONE PENNY. Nothing else in the frame.",
  },
  // The Crown's authority, at the head of its own notice.
  "cut-royal-arms-a": {
    dir: PAPERSTOCK,
    prompt:
      ISOLATED +
      " An 18th century printer's woodcut of the royal arms of Great Britain, as a colonial printing office " +
      "would have owned it: a crowned shield with a lion supporter on the left and a unicorn supporter on the " +
      "right, a scroll below. Cut in heavy black lines with coarse hatching for shading, the way a woodcut is, " +
      "slightly crude and slightly worn, one line broken where the block has chipped. Solid black ink only, no " +
      "colour, no grey wash, no lettering of any kind. Nothing else in the frame.",
  },
  "cut-royal-arms-b": {
    dir: PAPERSTOCK,
    prompt:
      ISOLATED +
      " An 18th century printer's woodcut of a crowned royal cipher: a large ornate letter G and letter R side " +
      "by side beneath a heavy royal crown, cut in bold black lines with hatched shading, worn and a little " +
      "chipped as a much-used block is. The only letters in the image are G and R. Solid black ink, no colour, " +
      "no grey, nothing else in the frame.",
  },

  // ---- materials -------------------------------------------------------
  // The gangway. Rough-sawn, not planed: an up-and-down sawmill leaves straight
  // parallel kerf marks across the grain, which is the single detail that dates
  // a board to before the circular saw.
  "mat-gangway-plank-a": {
    dir: CONCEPTS,
    prompt:
      "Weathered rough-sawn colonial softwood scaffold planks laid side by side, running top to bottom of the frame. " +
      "Eastern white pine, silver-grey from years of weather with warm brown showing where it has split. " +
      "Straight parallel saw kerf marks across the grain from an up-and-down sawmill. Raised grain, shakes and " +
      "checks along the length, a few dark knots, one board cupped and one board split at the end. " +
      "Narrow dark gaps between boards. Hand-forged iron rose-head nails driven in pairs, each with a rust bloom " +
      "staining the wood around it. Lichen and grey-green weathering in the joints, no moss on the wear line. " +
      TILE +
      " " +
      PERIOD,
  },
  "mat-gangway-plank-b": {
    dir: CONCEPTS,
    prompt:
      "Old builder's staging boards, colonial New England, viewed from directly above. Five or six wide unpainted " +
      "spruce planks of slightly different widths butted together, weathered to a dry bone-grey with tan streaks. " +
      "Coarse open grain, torn fibres where a saw ran out, splinter edges, mortar spatter and tar spots trodden in, " +
      "boot scuffing worn pale along the middle of each board. Wrought iron nails with square heads, some proud, " +
      "some sunk, each ringed with rust. Fine dark shadow lines in the board gaps. " +
      TILE +
      " " +
      PERIOD,
  },
  // The gambrel deck. Lead was the flat-roof material of the period; its
  // rolled joints are the relief the build actually models, so the tile has
  // to read as sheet lead rather than as modern zinc.
  "mat-gambrel-lead-a": {
    dir: CONCEPTS,
    prompt:
      "Old sheet lead roof covering seen from directly overhead, colonial New England flat roof. " +
      "Dull mid-grey lead gone chalky white and pale blue-grey with oxide bloom, faint hammer dressing marks, " +
      "shallow ripples and creases where the sheet was worked by hand over boards. Dark grey-green moss and dirt " +
      "collected in the low lines and along the seams. Occasional pale water-run streaks and a few rust stains " +
      "bleeding from iron fixings. Soft matte, absolutely not shiny, not metallic silver, not modern zinc. " +
      TILE +
      " " +
      PERIOD,
  },
  "mat-gambrel-shingle-a": {
    dir: CONCEPTS,
    prompt:
      "Hand-split cedar roof shingles in overlapping courses, colonial New England meeting house, seen from " +
      "directly overhead. Weathered silver-grey to charcoal, each shingle a slightly different width and a " +
      "slightly different weathering, split faces rough and fibrous, corners curled and a few shingles missing " +
      "or cracked. Dark shadow lines under each course. Green-black moss thick in the joins and along the course " +
      "lines where water sits. " +
      TILE +
      " " +
      PERIOD,
  },
  // The chimney and the arcade pier are the same clay in two bonds.
  "mat-boston-brick-flemish-a": {
    dir: CONCEPTS,
    prompt:
      "Eighteenth-century Boston brickwork in Flemish bond, seen from directly in front, flat on. " +
      "Soft hand-made red clay brick, unevenly fired so the colour runs from orange-red through dull rose to " +
      "purple-black where a brick was over-burnt. Each brick slightly different in size and set slightly out of " +
      "line, faces pitted and worn, arrises chipped. Wide creamy lime mortar joints struck by hand, some raked " +
      "back, some smeared, small losses where the mortar has fallen out. Faint white lime bloom and a wash of " +
      "grey soot low in the joints. " +
      TILE +
      " " +
      PERIOD,
  },
  "mat-boston-brick-english-a": {
    dir: CONCEPTS,
    prompt:
      "Eighteenth-century New England chimney brickwork, English bond, flat elevation seen straight on. " +
      "Hand-made clay bricks in warm brick-red and burnt umber, considerable variation brick to brick, several " +
      "badly spalled and one replaced with a paler brick. Thick pale lime mortar joints, irregular, tooled by hand. " +
      "Sooty grey-black staining washed down from above, heaviest at the top of the frame and thinning downward. " +
      TILE +
      " " +
      PERIOD,
  },
  // Round two on the rope house wall, and the fix is to take two things OUT.
  //
  // `-a` was asked for boards "blackened with pine tar", with algae low down and
  // sun-bleaching high up, and it delivered all three. On a 22 x 8.6m wall that
  // is two separate faults. The blackening left no board edges to see, so the
  // shed read as one dark striped surface rather than as boarding; and the
  // top-to-bottom weathering means the tile is only seamless ACROSS the boards,
  // so there is exactly one honest number of vertical repeats — which forces a
  // four-and-a-half-times stretch, and a stretched tar streak is a hard vertical
  // line. A tile with no baked gradient can repeat up the wall, keep its
  // cross-grain, and let the geometry carry the weathering instead.
  "mat-ropewalk-board-b": {
    dir: CONCEPTS,
    prompt:
      "Exterior wall of a colonial ropewalk: WIDE vertical unpainted pine boards butted side by side, seen dead " +
      "flat on from directly in front. Each board is clearly separate from its neighbours, with a narrow dark " +
      "shadow gap between them, and each has its own colour: weathered grey-brown, warm tan where the tar has " +
      "worn thin, silver where the sun has had it. Coarse sawn grain running vertically, long checks and shakes, " +
      "dark knots, sap bleed at the knots, streaks and spatters of pine tar down some boards but not all. " +
      "Hand-forged nails in vertical rows with a rust run beneath each one. " +
      "IMPORTANT: the weathering is EVEN over the whole square. No gradient from top to bottom, no darker band " +
      "along the bottom, no lighter band along the top, no algae, no moss, no ground, no sky, no roof, no " +
      "framing, no window, no door. The image must tile invisibly against itself on ALL FOUR edges, top to bottom " +
      "as well as left to right, so the boards continue straight through the top and bottom edges. " +
      TILE +
      " " +
      PERIOD,
  },
  // The ropewalk's outside. Tarred vertical boarding is what a rope house was.
  "mat-ropewalk-board-a": {
    dir: CONCEPTS,
    prompt:
      "Exterior wall of a colonial ropewalk: wide vertical unpainted pine boards with narrow batten strips over " +
      "the joints, seen flat on from directly in front. Boards weathered to a dark grey-brown, streaked and " +
      "blackened with pine tar and stockholm tar which is what a rope house was full of, sap bleed at the knots, " +
      "long vertical checks and shakes. Hand-forged nails in vertical rows, each with a rust run beneath it. " +
      "Green algae staining low down, pale sun-bleaching high up. " +
      TILE +
      " " +
      PERIOD,
  },
};

const only = process.argv.slice(2);
const names = only.length > 0 ? only : Object.keys(SUBJECTS);
const unknown = names.filter((name) => !SUBJECTS[name]);
if (unknown.length > 0) {
  console.error(`unknown subject(s): ${unknown.join(", ")}`);
  console.error(`known: ${Object.keys(SUBJECTS).join(", ")}`);
  process.exit(1);
}

mkdirSync(CONCEPTS, { recursive: true });
mkdirSync(PAPER, { recursive: true });
mkdirSync(PAPERSTOCK, { recursive: true });

const generator = resolve(import.meta.dirname, "gen_concept_image.mjs");

function generate(name) {
  const subject = SUBJECTS[name];
  const out = resolve(subject.dir, `${name}.png`);
  const args = [generator, "--prompt", subject.prompt, "--out", out];
  if (subject.size) args.push("--size", subject.size);
  return new Promise((done) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", (chunk) => (log += chunk));
    child.stderr.on("data", (chunk) => (log += chunk));
    child.on("close", (code) => {
      const ok = code === 0 && existsSync(out);
      console.log(`${ok ? "OK  " : "FAIL"} ${name}${ok ? "" : `\n${log.trim().slice(0, 600)}`}`);
      done({ name, ok });
    });
  });
}

// Four at a time. The gateway is fine with it and the whole set is otherwise
// twelve minutes of waiting in series.
const CONCURRENCY = 4;
const queue = [...names];
const results = [];
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let name = queue.shift(); name; name = queue.shift()) {
      results.push(await generate(name));
    }
  }),
);

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} generated`);
if (failed.length > 0) {
  console.log(`failed: ${failed.map((result) => result.name).join(", ")}`);
  process.exitCode = 1;
}
