import * as THREE from "three";
import type { InputRequest } from "@pa/contracts";
import { DAY1_CUES } from "@pa/contracts";
// Verbatim script strings (docs/archive/2026-07/Localhost-Text-Slice-Spec.md §34) come straight from
// the runtime content module so the 3D papers can never drift from the script.
import { TEXT } from "@pa/runtime";
import { getProofSheetTexture } from "./proofSheetTexture.js";

// ============================================================================
// Day 1 document catalog. Every hands/paper moment in the world renders one of
// these canvas-generated sheets; the Pike proof is only ever used where the
// script actually puts Pike's proof.
// ============================================================================
export type DocumentId =
  | "PIKE_PROOF_PLAIN"
  | "PIKE_PROOF_STAMPED"
  | "TOWN_STAMP_NOTICE"
  | "FRESH_BROADSIDE"
  | "REVENUE_PROCLAMATION"
  | "CROWD_BOARD"
  | "THOMAS_CIRCULAR"
  | "CUSTOMHOUSE_NOTICE"
  | "ANTI_STAMP_HANDBILL"
  | "PLAIN_WRAP"
  | "SORT_DEED"
  | "SORT_WRIT"
  | "SORT_NEWSPAPER"
  | "SORT_LETTER"
  | "FINAL_FRONT_PAGE"
  | "BLANK_SHEET";

// What the first-person hands are holding for the current beat.
export type PaperContent =
  | { kind: "SHEET"; documentId: DocumentId }
  | { kind: "PAIR"; left: DocumentId; right: DocumentId }
  | { kind: "BUNDLE"; wrap: boolean }
  | { kind: "SORT_FAN" };

// ---------------------------------------------------------------------------
// Pure selection helpers: script context -> document.
// ---------------------------------------------------------------------------
const FOCUS_READ_DOCUMENTS: Record<string, DocumentId> = {
  TOWN_STAMP_NOTICE: "TOWN_STAMP_NOTICE",
  FRESH_BROADSIDE: "FRESH_BROADSIDE",
  REVENUE_PROCLAMATION: "REVENUE_PROCLAMATION",
  CROWD_BOARD: "CROWD_BOARD",
};

export function documentForContext(
  request: InputRequest | null,
  cueId: string | null,
): PaperContent | null {
  if (request?.kind === "FOCUS_READ") {
    if (request.objectId === "STAMP_PROOF_COMPARE") {
      return { kind: "PAIR", left: "PIKE_PROOF_STAMPED", right: "PIKE_PROOF_PLAIN" };
    }
    const doc = FOCUS_READ_DOCUMENTS[request.objectId];
    return { kind: "SHEET", documentId: doc ?? "BLANK_SHEET" };
  }
  if (request?.kind === "MECHANIC") {
    const id = request.promptId;
    if (id.includes("CONCEAL_HANDBILLS")) return { kind: "BUNDLE", wrap: true };
    if (id.includes("RIDER_QUICK_HANDOFF") || id.includes("RIDER_GAP_HANDOFF")) {
      return { kind: "BUNDLE", wrap: false };
    }
    if (id.includes("THOMAS_CIRCULAR")) return { kind: "SHEET", documentId: "THOMAS_CIRCULAR" };
    if (id.includes("PIKE_PROOF_HANDOFF")) return { kind: "SHEET", documentId: "PIKE_PROOF_STAMPED" };
    if (id.includes("FINAL_PRESS_PULL")) return { kind: "SHEET", documentId: "FINAL_FRONT_PAGE" };
    if (request.params.kind === "PRINT_JOB") {
      return {
        kind: "SHEET",
        documentId:
          request.params.printVariant === "FINAL_PAGE"
            ? "FINAL_FRONT_PAGE"
            : "PIKE_PROOF_PLAIN",
      };
    }
    if (request.params.kind === "SORT") return { kind: "SORT_FAN" };
    if (request.params.kind === "PLACE" || request.params.kind === "POST_JOB") {
      return { kind: "SHEET", documentId: "CUSTOMHOUSE_NOTICE" };
    }
    if (id.includes("CATCH_SHEET")) return { kind: "SHEET", documentId: "PIKE_PROOF_PLAIN" };
    return null;
  }
  if (cueId === DAY1_CUES.CATCH_SHEET) return { kind: "SHEET", documentId: "PIKE_PROOF_PLAIN" };
  return null;
}

// The physical world object a FOCUS_READ offer points at (board posters,
// posting-post bills). The offer must show this object in the world; the
// legible face belongs to the post-open holographic read panel.
export function documentForFocusReadObject(objectId: string): DocumentId | null {
  return FOCUS_READ_DOCUMENTS[objectId] ?? null;
}

// What the opened holographic read panel shows for a READ_PANEL objectId:
// the same authored document artwork as the world object. Panels with no
// matching document (Archive intake, deficit sources) return null and fall
// back to the plain parchment card.
export type ReadPanelArt =
  | { kind: "SHEET"; documentId: DocumentId }
  | { kind: "PAIR"; left: DocumentId; right: DocumentId };

export function documentForReadPanel(objectId: string): ReadPanelArt | null {
  if (objectId === "STAMP_PROOF_COMPARE") {
    // Same order as the physical proofs on Abigail's table: old plain proof
    // on the left, the fresh stamped pull on the right.
    return { kind: "PAIR", left: "PIKE_PROOF_PLAIN", right: "PIKE_PROOF_STAMPED" };
  }
  if (objectId === "FINAL_PAGE") return { kind: "SHEET", documentId: "FINAL_FRONT_PAGE" };
  const doc = FOCUS_READ_DOCUMENTS[objectId];
  return doc ? { kind: "SHEET", documentId: doc } : null;
}

// World-prop papers (PropDirector) keyed by choreography propId.
export function documentForProp(propId: string): DocumentId {
  switch (propId) {
    case "FRESH_SHEET":
      return "PIKE_PROOF_PLAIN";
    case "PIKE_PROOF":
    case "WORK_SHEET":
      return "PIKE_PROOF_STAMPED";
    case "OLD_PROOF":
      return "PIKE_PROOF_PLAIN";
    case "CUSTOMHOUSE_NOTICE":
      return "CUSTOMHOUSE_NOTICE";
    case "DELIVERY_BUNDLE":
      return "PLAIN_WRAP";
    default:
      return "BLANK_SHEET";
  }
}

// The five Pike sort items, in presentation order (matches STAMP_SORT items).
export const SORT_FAN_ITEMS: { itemId: string; documentId: DocumentId | "WOOD_TOOL" }[] = [
  { itemId: "deed", documentId: "SORT_DEED" },
  { itemId: "writ", documentId: "SORT_WRIT" },
  { itemId: "newspaper", documentId: "SORT_NEWSPAPER" },
  { itemId: "letter", documentId: "SORT_LETTER" },
  { itemId: "tool", documentId: "WOOD_TOOL" },
];

// ---------------------------------------------------------------------------
// Texture generation.
// ---------------------------------------------------------------------------
const textureCache = new Map<DocumentId, THREE.CanvasTexture>();

export function getDocumentTexture(id: DocumentId): THREE.CanvasTexture {
  if (id === "PIKE_PROOF_PLAIN") return getProofSheetTexture("PLAIN");
  if (id === "PIKE_PROOF_STAMPED") return getProofSheetTexture("STAMPED");
  const cached = textureCache.get(id);
  if (cached) return cached;
  const painter = PAINTERS[id];
  const canvas = document.createElement("canvas");
  canvas.width = painter.width;
  canvas.height = painter.height;
  const context = canvas.getContext("2d")!;
  painter.paint(context, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Posters/boards are read at grazing angles; high anisotropy keeps the
  // period type crisp instead of smearing at poster scale.
  texture.anisotropy = 16;
  textureCache.set(id, texture);
  return texture;
}

// Data-URL face of an authored document for DOM surfaces (the holographic
// read panel). Painted once per document and cached, so the hologram and the
// world object are visibly the same artifact. Painters are re-run at 2x so
// the large projected sheet stays crisp on hidpi displays.
const imageUrlCache = new Map<DocumentId, string>();

export function getDocumentImageUrl(id: DocumentId): string {
  const cached = imageUrlCache.get(id);
  if (cached) return cached;
  let url: string;
  const painter =
    id === "PIKE_PROOF_PLAIN" || id === "PIKE_PROOF_STAMPED" ? null : PAINTERS[id];
  if (painter) {
    const canvas = document.createElement("canvas");
    canvas.width = painter.width * 2;
    canvas.height = painter.height * 2;
    const context = canvas.getContext("2d")!;
    context.scale(2, 2);
    painter.paint(context, painter.width, painter.height);
    url = canvas.toDataURL("image/png");
  } else {
    url = (getDocumentTexture(id).image as HTMLCanvasElement).toDataURL("image/png");
  }
  imageUrlCache.set(id, url);
  return url;
}

type Ctx2D = CanvasRenderingContext2D;
interface Painter {
  width: number;
  height: number;
  paint: (context: Ctx2D, width: number, height: number) => void;
}

const SERIF = "Georgia, 'Times New Roman', serif";
const SCRIPT = "'Snell Roundhand', 'Apple Chancery', 'Segoe Script', cursive";
const INK = "#2d261c";
const FADED_INK = "#4a3f2e";

// Deterministic PRNG so cached textures are stable across mounts.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function agedPaper(context: Ctx2D, width: number, height: number, tone: string, seed: number) {
  context.fillStyle = tone;
  context.fillRect(0, 0, width, height);
  const rand = mulberry32(seed);
  // fibre flecks
  context.save();
  for (let index = 0; index < 260; index += 1) {
    context.globalAlpha = 0.05 + rand() * 0.07;
    context.fillStyle = rand() > 0.5 ? "#8a7550" : "#c7b78d";
    const x = rand() * width;
    const y = rand() * height;
    context.fillRect(x, y, 1 + rand() * 3, 1 + rand() * 2);
  }
  // soft age blotches
  for (let index = 0; index < 7; index += 1) {
    const gradient = context.createRadialGradient(
      rand() * width, rand() * height, 8,
      rand() * width, rand() * height, 90 + rand() * 130,
    );
    gradient.addColorStop(0, "rgba(140,112,66,0.06)");
    gradient.addColorStop(1, "rgba(140,112,66,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  }
  context.restore();
  // darker edges
  const edge = context.createLinearGradient(0, 0, 0, height);
  edge.addColorStop(0, "rgba(94,74,40,0.10)");
  edge.addColorStop(0.08, "rgba(94,74,40,0)");
  edge.addColorStop(0.92, "rgba(94,74,40,0)");
  edge.addColorStop(1, "rgba(94,74,40,0.12)");
  context.fillStyle = edge;
  context.fillRect(0, 0, width, height);
}

function wrapLines(context: Ctx2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const attempt = line ? `${line} ${word}` : word;
    if (context.measureText(attempt).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = attempt;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function centerParagraph(
  context: Ctx2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  const lines = wrapLines(context, text, maxWidth);
  lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
  return y + lines.length * lineHeight;
}

// Rows of word-shaped bars: dense period print too small to read.
function printFiller(
  context: Ctx2D,
  x: number,
  y: number,
  width: number,
  rows: number,
  rowHeight: number,
  seed: number,
) {
  const rand = mulberry32(seed);
  context.save();
  context.fillStyle = "rgba(52,42,28,0.62)";
  for (let row = 0; row < rows; row += 1) {
    let cursor = x;
    const rowY = y + row * rowHeight;
    const rowEnd = x + width * (row === rows - 1 ? 0.45 + rand() * 0.4 : 1);
    while (cursor < rowEnd) {
      const wordWidth = 12 + rand() * 34;
      context.fillRect(cursor, rowY, Math.min(wordWidth, rowEnd - cursor), rowHeight * 0.4);
      cursor += wordWidth + 7 + rand() * 6;
    }
  }
  context.restore();
}

// Ink-drawn handwriting: wavering baseline strokes.
function handwritingFiller(
  context: Ctx2D,
  x: number,
  y: number,
  width: number,
  rows: number,
  rowHeight: number,
  seed: number,
  color = "rgba(46,36,58,0.72)",
) {
  const rand = mulberry32(seed);
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 2.1;
  context.lineCap = "round";
  for (let row = 0; row < rows; row += 1) {
    const rowY = y + row * rowHeight;
    const rowEnd = x + width * (row === rows - 1 ? 0.35 + rand() * 0.4 : 0.92 + rand() * 0.08);
    let cursor = x + (row === 0 ? 26 : 0);
    while (cursor < rowEnd) {
      const span = 18 + rand() * 42;
      const end = Math.min(cursor + span, rowEnd);
      context.beginPath();
      context.moveTo(cursor, rowY + rand() * 3);
      for (let px = cursor; px <= end; px += 6) {
        context.lineTo(
          px,
          rowY + Math.sin(px * 0.55 + row * 2.4) * 3.2 + (rand() - 0.5) * 2.4,
        );
      }
      context.stroke();
      cursor = end + 8 + rand() * 8;
    }
  }
  context.restore();
}

function doubleRuleBorder(context: Ctx2D, width: number, height: number, color = "#8a7350") {
  context.strokeStyle = color;
  context.lineWidth = 7;
  context.strokeRect(24, 24, width - 48, height - 48);
  context.lineWidth = 2.5;
  context.strokeRect(42, 42, width - 84, height - 84);
}

function ruleAcross(context: Ctx2D, x1: number, x2: number, y: number, lineWidth = 3, color = INK) {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.beginPath();
  context.moveTo(x1, y);
  context.lineTo(x2, y);
  context.stroke();
  context.restore();
}

function drawCrown(context: Ctx2D, x: number, y: number, size: number, color = INK) {
  context.save();
  context.translate(x, y);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = size * 0.09;
  context.lineJoin = "round";
  // band
  context.strokeRect(-size * 0.52, size * 0.28, size * 1.04, size * 0.26);
  // points
  context.beginPath();
  context.moveTo(-size * 0.52, size * 0.28);
  context.lineTo(-size * 0.34, -size * 0.34);
  context.lineTo(-size * 0.02, size * 0.06);
  context.lineTo(size * 0.3, -size * 0.34);
  context.lineTo(size * 0.52, size * 0.28);
  context.closePath();
  context.stroke();
  // tip orbs
  for (const px of [-size * 0.34, size * 0.3]) {
    context.beginPath();
    context.arc(px, -size * 0.42, size * 0.085, 0, Math.PI * 2);
    context.fill();
  }
  // cross above the middle
  context.lineWidth = size * 0.075;
  context.beginPath();
  context.moveTo(-size * 0.02, -size * 0.18);
  context.lineTo(-size * 0.02, -size * 0.48);
  context.moveTo(-size * 0.14, -size * 0.34);
  context.lineTo(size * 0.1, -size * 0.34);
  context.stroke();
  context.restore();
}

function waxSeal(context: Ctx2D, x: number, y: number, radius: number) {
  context.save();
  const gradient = context.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.2, x, y, radius);
  gradient.addColorStop(0, "#a03a30");
  gradient.addColorStop(1, "#6f1f1a");
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "rgba(255,220,200,0.35)";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(x, y, radius * 0.62, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

// Split TEXT strings of the form "TITLE\nbody..." used by the read panels.
function splitTitled(raw: string): { title: string; body: string } {
  const newline = raw.indexOf("\n");
  if (newline < 0) return { title: "", body: raw };
  return { title: raw.slice(0, newline), body: raw.slice(newline + 1) };
}

const PAINTERS: Record<Exclude<DocumentId, "PIKE_PROOF_PLAIN" | "PIKE_PROOF_STAMPED">, Painter> = {
  // ---- Official town Stamp notice (FOCUS_READ TOWN_STAMP_NOTICE) ----------
  TOWN_STAMP_NOTICE: {
    width: 768,
    height: 1024,
    paint(context, width, height) {
      agedPaper(context, width, height, "#e7d9b4", 11);
      doubleRuleBorder(context, width, height, "#6d5a3c");
      const { body } = splitTitled(TEXT.streetSources.officialNotice);
      drawCrown(context, width / 2, 150, 74);
      context.fillStyle = INK;
      context.textAlign = "center";
      context.font = `600 26px ${SERIF}`;
      context.fillText("B Y   A U T H O R I T Y", width / 2, 248);
      context.font = `700 58px ${SERIF}`;
      context.fillText("OFFICIAL", width / 2, 330);
      context.fillText("STAMP NOTICE", width / 2, 398);
      ruleAcross(context, 120, width - 120, 438, 4);
      ruleAcross(context, 120, width - 120, 448, 1.6);
      context.font = `400 34px ${SERIF}`;
      const bodyEnd = centerParagraph(context, body, width / 2, 520, width - 220, 52);
      ruleAcross(context, 200, width - 200, bodyEnd + 30, 2);
      context.font = `italic 400 27px ${SERIF}`;
      context.fillText("Boston, in New England", width / 2, bodyEnd + 84);
      context.font = `600 25px ${SERIF}`;
      context.fillText("GOD SAVE THE KING", width / 2, height - 96);
    },
  },

  // ---- Fresh broadside, wet-pasted (FOCUS_READ FRESH_BROADSIDE) -----------
  FRESH_BROADSIDE: {
    width: 768,
    height: 1024,
    paint(context, width, height) {
      agedPaper(context, width, height, "#e9dfc0", 23);
      // wet paste: darker damp patches at corners and one streak
      const rand = mulberry32(77);
      for (const [px, py, radius] of [
        [60, 70, 150], [width - 50, 90, 130], [40, height - 80, 170], [width - 90, height - 60, 150], [width / 2, 40, 120],
      ] as const) {
        const damp = context.createRadialGradient(px, py, 10, px, py, radius + rand() * 40);
        damp.addColorStop(0, "rgba(96,82,52,0.22)");
        damp.addColorStop(1, "rgba(96,82,52,0)");
        context.fillStyle = damp;
        context.fillRect(0, 0, width, height);
      }
      ruleAcross(context, 48, width - 48, 74, 9);
      ruleAcross(context, 48, width - 48, height - 74, 9);
      context.fillStyle = INK;
      context.textAlign = "center";
      // Verbatim: TEXT.streetSources.freshBroadside body.
      context.font = `700 62px ${SERIF}`;
      centerParagraph(context, "No tax laid upon us", width / 2, 190, width - 130, 70);
      context.font = `italic 700 56px ${SERIF}`;
      centerParagraph(context, "but by our own consent,", width / 2, 276, width - 130, 66);
      context.font = `400 38px ${SERIF}`;
      const middle = centerParagraph(
        context,
        "given by ourselves or by the men we choose to speak for us.",
        width / 2,
        392,
        width - 190,
        54,
      );
      ruleAcross(context, 260, width - 260, middle + 20, 2.4);
      context.font = `400 40px ${SERIF}`;
      centerParagraph(
        context,
        "We have chosen no man to sit in their Parliament, yet they tax us still.",
        width / 2,
        middle + 86,
        width - 170,
        58,
      );
    },
  },

  // ---- Crown revenue proclamation (FOCUS_READ REVENUE_PROCLAMATION) -------
  REVENUE_PROCLAMATION: {
    width: 768,
    height: 1024,
    paint(context, width, height) {
      agedPaper(context, width, height, "#e4d5ae", 31);
      doubleRuleBorder(context, width, height, "#75603f");
      drawCrown(context, width / 2, 170, 96, "#5d4322");
      context.fillStyle = "#5d4322";
      context.textAlign = "center";
      context.font = `700 42px ${SERIF}`;
      context.fillText("G", width / 2 - 120, 190);
      context.fillText("R", width / 2 + 120, 190);
      context.fillStyle = INK;
      context.font = `600 30px ${SERIF}`;
      context.fillText("BY THE KING", width / 2, 292);
      context.font = `700 54px ${SERIF}`;
      context.fillText("REVENUE", width / 2, 366);
      context.fillText("PROCLAMATION", width / 2, 430);
      ruleAcross(context, 110, width - 110, 470, 3.4);
      const { body } = splitTitled(TEXT.customHouse.proclamation);
      context.font = `italic 400 34px ${SERIF}`;
      const bodyEnd = centerParagraph(context, body, width / 2, 540, width - 200, 54);
      printFiller(context, 130, bodyEnd + 48, width - 260, 4, 30, 5);
      context.font = `600 26px ${SERIF}`;
      context.fillText("GOD SAVE THE KING", width / 2, height - 100);
    },
  },

  // ---- Late crowd broadside: one bold line (FOCUS_READ CROWD_BOARD) -------
  CROWD_BOARD: {
    width: 768,
    height: 1024,
    paint(context, width, height) {
      agedPaper(context, width, height, "#e6dcbd", 41);
      ruleAcross(context, 60, width - 60, 130, 12, "#241d12");
      ruleAcross(context, 60, width - 60, height - 130, 12, "#241d12");
      context.fillStyle = "#221b11";
      context.textAlign = "center";
      // Verbatim: TEXT.streetSources.lateCrowdBroadside body.
      context.font = `700 88px ${SERIF}`;
      const lines = ["No tax laid", "on us but by", "our own", "consent."];
      lines.forEach((line, index) => context.fillText(line, width / 2, 320 + index * 130));
    },
  },

  // ---- Thomas's merchant trade circular ------------------------------------
  THOMAS_CIRCULAR: {
    width: 768,
    height: 1024,
    paint(context, width, height) {
      agedPaper(context, width, height, "#ece1c2", 53);
      context.fillStyle = INK;
      context.textAlign = "center";
      context.font = `600 30px ${SERIF}`;
      context.fillText("C I R C U L A R", width / 2, 96);
      ruleAcross(context, 250, width - 250, 116, 2);
      context.font = `italic 400 33px ${SERIF}`;
      context.fillText("To Mr. Thomas Bell, Merchant,", width / 2, 178);
      context.fillText("at his counting-house, Boston.", width / 2, 222);
      ruleAcross(context, 90, width - 90, 262, 3);
      context.font = `400 30px ${SERIF}`;
      centerParagraph(
        context,
        "Prices current and advices of goods lately landed on the Long Wharf.",
        width / 2,
        318,
        width - 200,
        44,
      );
      // ledger table: column rules + entry rows
      const tableTop = 430;
      const tableBottom = height - 220;
      ruleAcross(context, 90, width - 90, tableTop, 2.4);
      context.save();
      context.strokeStyle = "rgba(45,38,28,0.75)";
      context.lineWidth = 1.6;
      for (const columnX of [width - 280, width - 160]) {
        context.beginPath();
        context.moveTo(columnX, tableTop);
        context.lineTo(columnX, tableBottom);
        context.stroke();
      }
      context.restore();
      const rand = mulberry32(9);
      context.textAlign = "left";
      for (let row = 0; row < 9; row += 1) {
        const rowY = tableTop + 46 + row * 48;
        printFiller(context, 106, rowY - 14, width - 420, 1, 30, 100 + row);
        context.font = `400 26px ${SERIF}`;
        context.fillStyle = FADED_INK;
        context.fillText(`${Math.floor(rand() * 9) + 1} s ${Math.floor(rand() * 11)} d`, width - 262, rowY);
        context.fillText(`${Math.floor(rand() * 30) + 4}`, width - 138, rowY);
      }
      ruleAcross(context, 90, width - 90, tableBottom + 10, 2.4);
      context.textAlign = "center";
      context.fillStyle = INK;
      context.font = `italic 400 27px ${SERIF}`;
      context.fillText("Printed at Mercer's Press, Boston.", width / 2, height - 130);
    },
  },

  // ---- Abigail's Custom House notice ---------------------------------------
  CUSTOMHOUSE_NOTICE: {
    width: 768,
    height: 1024,
    paint(context, width, height) {
      agedPaper(context, width, height, "#ebdfbe", 67);
      context.strokeStyle = "#7d684a";
      context.lineWidth = 5;
      context.strokeRect(30, 30, width - 60, height - 60);
      context.fillStyle = INK;
      context.textAlign = "center";
      context.font = `700 66px ${SERIF}`;
      context.fillText("NOTICE", width / 2, 150);
      ruleAcross(context, 150, width - 150, 190, 3.4);
      ruleAcross(context, 150, width - 150, 200, 1.4);
      context.font = `400 33px ${SERIF}`;
      const paragraphEnd = centerParagraph(
        context,
        "Mercer's Press, near the head of Queen Street, continues to print all manner of blanks, forms, and public papers as formerly, with care and dispatch.",
        width / 2,
        280,
        width - 190,
        50,
      );
      context.font = `italic 400 31px ${SERIF}`;
      centerParagraph(
        context,
        "Subscriptions for the paper are received at the clerks' counter of the Custom House.",
        width / 2,
        paragraphEnd + 56,
        width - 210,
        46,
      );
      ruleAcross(context, 240, width - 240, paragraphEnd + 210, 2);
      context.font = `600 30px ${SERIF}`;
      context.fillText("A. MERCER, printer", width / 2, paragraphEnd + 266);
      context.font = `400 26px ${SERIF}`;
      context.fillStyle = FADED_INK;
      context.fillText("Boston, 14 August 1765", width / 2, height - 110);
    },
  },

  // ---- Anti-Stamp handbill (bundle top bill) --------------------------------
  ANTI_STAMP_HANDBILL: {
    width: 620,
    height: 800,
    paint(context, width, height) {
      agedPaper(context, width, height, "#e8ddba", 71);
      ruleAcross(context, 44, width - 44, 88, 10, "#241d12");
      ruleAcross(context, 44, width - 44, height - 88, 10, "#241d12");
      ruleAcross(context, 44, width - 44, 108, 3, "#241d12");
      ruleAcross(context, 44, width - 44, height - 108, 3, "#241d12");
      context.fillStyle = "#1f180e";
      context.textAlign = "center";
      // Slogan per docs/chapters/boston-1765/Day-1.md B4/B7: bold block type.
      context.font = `700 92px ${SERIF}`;
      context.fillText("NO", width / 2, 235);
      context.font = `700 76px ${SERIF}`;
      context.fillText("TAXATION", width / 2, 340);
      context.font = `700 62px ${SERIF}`;
      context.fillText("WITHOUT", width / 2, 460);
      context.font = `700 60px ${SERIF}`;
      context.fillText("REPRESENTATION", width / 2, 580);
      context.font = `italic 400 27px ${SERIF}`;
      context.fillStyle = FADED_INK;
      context.fillText("Boston, August 1765", width / 2, 672);
    },
  },

  // ---- Plain wrap sheet (concealment) ---------------------------------------
  PLAIN_WRAP: {
    width: 620,
    height: 800,
    paint(context, width, height) {
      agedPaper(context, width, height, "#d8c496", 83);
      // fold creases
      context.save();
      context.strokeStyle = "rgba(96,76,44,0.35)";
      context.lineWidth = 2.4;
      for (const creaseY of [height * 0.34, height * 0.67]) {
        context.beginPath();
        context.moveTo(0, creaseY);
        context.lineTo(width, creaseY + 12);
        context.stroke();
      }
      context.beginPath();
      context.moveTo(width * 0.52, 0);
      context.lineTo(width * 0.5, height);
      context.stroke();
      // worn corner smudges
      context.fillStyle = "rgba(90,70,40,0.14)";
      context.beginPath();
      context.arc(width * 0.16, height * 0.2, 60, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.arc(width * 0.8, height * 0.75, 80, 0, Math.PI * 2);
      context.fill();
      context.restore();
    },
  },

  // ---- Pike sort: court deed (manuscript, wax seal) --------------------------
  SORT_DEED: {
    width: 768,
    height: 1024,
    paint(context, width, height) {
      agedPaper(context, width, height, "#e3d3a6", 97);
      context.fillStyle = "#3a2b46";
      context.textAlign = "left";
      context.font = `italic 700 64px ${SERIF}`;
      context.fillText("This Indenture", 72, 140);
      context.font = `italic 400 32px ${SERIF}`;
      const opening = wrapLines(
        context,
        "witnesseth, made this fourteenth day of August, in the fifth year of the reign of King George the Third,",
        width - 165,
      );
      opening.forEach((line, index) => context.fillText(line, 76, 200 + index * 46));
      handwritingFiller(context, 76, 340, width - 150, 11, 52, 7, "rgba(58,43,70,0.7)");
      waxSeal(context, 130, height - 130, 58);
      context.font = `italic 400 30px ${SERIF}`;
      context.fillStyle = "rgba(58,43,70,0.85)";
      context.fillText("Sealed and delivered", 230, height - 150);
      handwritingFiller(context, 430, height - 190, 240, 2, 46, 19, "rgba(58,43,70,0.8)");
    },
  },

  // ---- Pike sort: court writ (printed form, royal opening) -------------------
  SORT_WRIT: {
    width: 768,
    height: 1024,
    paint(context, width, height) {
      agedPaper(context, width, height, "#e9dcb8", 101);
      context.strokeStyle = "#7d684a";
      context.lineWidth = 3;
      context.strokeRect(34, 34, width - 68, height - 68);
      // embossed paper seal, top left
      context.save();
      context.fillStyle = "rgba(214,199,158,0.9)";
      context.strokeStyle = "rgba(120,100,64,0.6)";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(130, 150, 62, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.beginPath();
      context.arc(130, 150, 46, 0, Math.PI * 2);
      context.stroke();
      context.restore();
      drawCrown(context, 130, 146, 42, "rgba(110,90,56,0.75)");
      context.fillStyle = INK;
      context.textAlign = "center";
      context.font = `700 52px ${SERIF}`;
      context.fillText("GEORGE the Third,", width / 2 + 60, 150);
      context.font = `italic 400 30px ${SERIF}`;
      context.fillText("by the Grace of God, King, defender of the faith,", width / 2, 224);
      ruleAcross(context, 80, width - 80, 262, 2.4);
      context.font = `600 36px ${SERIF}`;
      context.fillText("To the Sheriff of our County of Suffolk,", width / 2, 330);
      context.font = `italic 600 34px ${SERIF}`;
      context.fillText("Greeting:", width / 2, 382);
      printFiller(context, 90, 440, width - 180, 9, 42, 13);
      context.textAlign = "left";
      context.font = `italic 400 30px ${SERIF}`;
      context.fillText("Witness our Justices at Boston.", 90, height - 160);
      handwritingFiller(context, 470, height - 200, 210, 2, 44, 29, "rgba(45,38,28,0.8)");
      context.textAlign = "center";
      context.font = `600 28px ${SERIF}`;
      context.fillStyle = FADED_INK;
      context.fillText("W R I T", width / 2, height - 84);
    },
  },

  // ---- Pike sort: printed newspaper ------------------------------------------
  SORT_NEWSPAPER: {
    width: 768,
    height: 1024,
    paint(context, width, height) {
      agedPaper(context, width, height, "#eae0c4", 103);
      context.fillStyle = INK;
      context.textAlign = "center";
      context.font = `italic 700 62px ${SERIF}`;
      context.fillText("The Boston Gazette.", width / 2, 110);
      context.font = `400 24px ${SERIF}`;
      context.fillText("AND COUNTRY JOURNAL", width / 2, 152);
      ruleAcross(context, 60, width - 60, 176, 3);
      context.font = `italic 400 24px ${SERIF}`;
      context.fillText("MONDAY, August 12, 1765.", width / 2, 212);
      ruleAcross(context, 60, width - 60, 234, 1.6);
      // two columns of print with a center rule
      context.save();
      context.strokeStyle = "rgba(45,38,28,0.7)";
      context.lineWidth = 1.6;
      context.beginPath();
      context.moveTo(width / 2, 260);
      context.lineTo(width / 2, height - 70);
      context.stroke();
      context.restore();
      printFiller(context, 68, 280, width / 2 - 104, 21, 34, 17);
      printFiller(context, width / 2 + 36, 280, width / 2 - 104, 21, 34, 27);
    },
  },

  // ---- Pike sort: personal handwritten letter --------------------------------
  SORT_LETTER: {
    width: 768,
    height: 1024,
    paint(context, width, height) {
      agedPaper(context, width, height, "#f0e6cb", 107);
      context.fillStyle = "#2e2444";
      context.textAlign = "right";
      context.font = `400 40px ${SCRIPT}`;
      context.fillText("Boston, 14 August 1765", width - 80, 130);
      context.textAlign = "left";
      context.font = `400 44px ${SCRIPT}`;
      context.fillText("Dear Sister,", 84, 230);
      handwritingFiller(context, 84, 300, width - 170, 10, 56, 37);
      context.font = `italic 400 38px ${SCRIPT}`;
      context.fillText("your affectionate brother,", 250, height - 180);
      handwritingFiller(context, 430, height - 150, 190, 1, 40, 47, "rgba(46,36,88,0.8)");
      // single fold crease across the middle
      context.strokeStyle = "rgba(96,76,44,0.28)";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(0, height * 0.52);
      context.lineTo(width, height * 0.515);
      context.stroke();
    },
  },

  // ---- Tomorrow's front page (final press pull) -------------------------------
  FINAL_FRONT_PAGE: {
    width: 768,
    height: 1024,
    paint(context, width, height) {
      agedPaper(context, width, height, "#ece2c4", 113);
      context.fillStyle = INK;
      context.textAlign = "center";
      context.font = `600 30px ${SERIF}`;
      context.fillText("M E R C E R ' S   P R E S S", width / 2, 90);
      context.font = `italic 400 24px ${SERIF}`;
      context.fillText("Boston, Thursday, 15 August 1765.", width / 2, 130);
      ruleAcross(context, 52, width - 52, 154, 4);
      ruleAcross(context, 52, width - 52, 164, 1.6);
      // Verbatim: TEXT.headline.finalPage lines.
      const [headline = "", deck = "", source = ""] = TEXT.headline.finalPage.split("\n");
      context.font = `700 78px ${SERIF}`;
      const headlineLines = wrapLines(context, headline, width - 320);
      headlineLines.forEach((line, index) => context.fillText(line, width / 2, 268 + index * 90));
      const headlineBottom = 268 + (headlineLines.length - 1) * 90 + 42;
      ruleAcross(context, 170, width - 170, headlineBottom, 2.4);
      context.font = `italic 400 33px ${SERIF}`;
      const deckEnd = centerParagraph(context, deck, width / 2, headlineBottom + 58, width - 180, 48);
      context.font = `400 28px ${SERIF}`;
      context.fillStyle = FADED_INK;
      context.fillText(source, width / 2, deckEnd + 26);
      ruleAcross(context, 52, width - 52, deckEnd + 66, 2);
      context.save();
      context.strokeStyle = "rgba(45,38,28,0.7)";
      context.lineWidth = 1.6;
      context.beginPath();
      context.moveTo(width / 2, deckEnd + 88);
      context.lineTo(width / 2, height - 64);
      context.stroke();
      context.restore();
      const fillerTop = deckEnd + 104;
      const fillerRows = Math.max(3, Math.floor((height - 70 - fillerTop) / 34));
      printFiller(context, 68, fillerTop, width / 2 - 104, fillerRows, 34, 57);
      printFiller(context, width / 2 + 36, fillerTop, width / 2 - 104, fillerRows, 34, 67);
    },
  },

  // ---- Fallback aged sheet -----------------------------------------------------
  BLANK_SHEET: {
    width: 512,
    height: 680,
    paint(context, width, height) {
      agedPaper(context, width, height, "#e8dcba", 127);
    },
  },
};
