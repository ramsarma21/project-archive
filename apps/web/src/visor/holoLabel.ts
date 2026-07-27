import * as THREE from "three";

// ---------------------------------------------------------------------------
// Labels, drawn the way the hub draws panels.
//
// A label is display furniture pinned to a point in the world, and that is a
// deliberate choice about the visor's two scales. The GEOMETRY — paths, cones,
// rings, the destination shaft — is fully world-space and perspective-correct, so
// it sits in the street rather than on the screen. The TEXT is pinned at constant
// screen size, so the elm's name eighty metres away is exactly as readable as the
// drying rack's four metres away.
//
// That split is what makes a standing viewpoint work at all. Perspective text at
// eighty metres is three illegible pixels; a floating panel that ignores the world
// entirely is a menu. A named point whose name stays readable and whose LINE still
// recedes into the street is how a real head-up display behaves, and it is the one
// arrangement that answers "where am I going" from a rooftop.
//
// Drawn into a 2D canvas rather than assembled from meshes because the hub's
// language is typographic — tracked uppercase kickers, hairline borders, corner
// brackets — and a canvas is the cheapest honest way to reproduce it. One texture
// per label, built once, disposed with the component.
// ---------------------------------------------------------------------------

export type LabelTone = "BRIGHT" | "NORMAL" | "DIM";

export interface LabelSpec {
  readonly title: string;
  readonly detail?: string;
  /** Right-aligned against the title. Ranges, counts, key names. */
  readonly range?: string;
  /** Hex. The accent bar, the border and the brackets take it. */
  readonly accent: string;
  readonly tone?: LabelTone;
}

export interface HoloLabel {
  readonly texture: THREE.CanvasTexture;
  /** Device-independent size, for deriving the sprite's aspect. */
  readonly widthPx: number;
  readonly heightPx: number;
  dispose(): void;
}

/** Supersample, so tracked 11px uppercase is crisp rather than mushy. */
const SS = 3;

const PAD_X = 11;
const PAD_Y = 9;
const ACCENT_BAR = 2;
const BRACKET = 9;
const TITLE_PX = 14;
const DETAIL_PX = 12;
const RANGE_PX = 11;
const ROW_GAP = 5;

const TONE_ALPHA: Record<LabelTone, { plate: number; border: number; ink: number }> = {
  BRIGHT: { plate: 0.8, border: 0.72, ink: 1 },
  NORMAL: { plate: 0.72, border: 0.5, ink: 0.94 },
  DIM: { plate: 0.55, border: 0.3, ink: 0.72 },
};

function rgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Tracked uppercase, the way the hub's kickers are set.
 *
 * `letterSpacing` on a 2D context is not universal, so the tracking is measured
 * rather than assumed: where the browser honours the property the text is drawn
 * in one call, and where it does not the width comes out narrower and the plate
 * is simply tighter. Nothing is clipped either way, which is the only property
 * this needs to guarantee.
 */
function setFont(
  ctx: CanvasRenderingContext2D,
  weight: number,
  px: number,
  trackingPx: number,
): void {
  ctx.font = `${weight} ${px * SS}px ui-monospace, "SF Mono", Menlo, monospace`;
  try {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
      `${trackingPx * SS}px`;
  } catch {
    // Not supported: the plate measures narrower and still fits its text.
  }
}

/**
 * The arrow on a mark that has left the frame.
 *
 * Drawn pointing UP in its own texture, so whoever places it can turn it with a
 * single sprite rotation rather than rebuilding it per heading. It is a
 * chevron and not a filled triangle for the same reason the hub's chrome is
 * hairlines: a solid arrowhead is the vocabulary of a form control, and this is
 * the same instrument as the plate it sits beside.
 */
export function holoChevron(accent: string): HoloLabel {
  const sizePx = 22;
  const canvas = document.createElement("canvas");
  canvas.width = sizePx * SS;
  canvas.height = sizePx * SS;
  const ctx = canvas.getContext("2d")!;
  const S = sizePx * SS;

  ctx.strokeStyle = rgba(accent, 1);
  ctx.lineWidth = 2.4 * SS;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.shadowColor = rgba(accent, 0.8);
  ctx.shadowBlur = 7 * SS;
  ctx.beginPath();
  ctx.moveTo(S * 0.17, S * 0.68);
  ctx.lineTo(S * 0.5, S * 0.24);
  ctx.lineTo(S * 0.83, S * 0.68);
  ctx.stroke();
  // A short bar under the point, which is what stops a lone chevron reading as
  // a caret in a sentence and makes it read as an instrument's needle.
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.moveTo(S * 0.3, S * 0.84);
  ctx.lineTo(S * 0.7, S * 0.84);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return {
    texture,
    widthPx: sizePx,
    heightPx: sizePx,
    dispose: () => texture.dispose(),
  };
}

export function holoLabel(spec: LabelSpec): HoloLabel {
  const tone = TONE_ALPHA[spec.tone ?? "NORMAL"];
  const title = spec.title.toUpperCase();
  const detail = spec.detail ?? "";
  const range = spec.range ?? "";

  // Measure on a scratch context first: the plate is sized to its text, so a
  // two-word pin does not carry the same slab as a sentence.
  const scratch = document.createElement("canvas").getContext("2d")!;
  setFont(scratch, 800, TITLE_PX, 1.7);
  const titleW = scratch.measureText(title).width;
  setFont(scratch, 700, RANGE_PX, 1.2);
  const rangeW = range ? scratch.measureText(range).width : 0;
  setFont(scratch, 500, DETAIL_PX, 0.2);
  const detailW = detail ? scratch.measureText(detail).width : 0;

  const gapW = range ? 16 * SS : 0;
  const textW = Math.max(titleW + gapW + rangeW, detailW);
  const innerW = textW / SS;
  const rows = detail ? TITLE_PX + ROW_GAP + DETAIL_PX : TITLE_PX;

  const widthPx = Math.ceil(innerW + PAD_X * 2 + ACCENT_BAR + 4);
  const heightPx = Math.ceil(rows + PAD_Y * 2);

  const canvas = document.createElement("canvas");
  canvas.width = widthPx * SS;
  canvas.height = heightPx * SS;
  const ctx = canvas.getContext("2d")!;

  const W = canvas.width;
  const H = canvas.height;

  // Plate: the hub's glass, a vertical gradient over near-black blue.
  const glass = ctx.createLinearGradient(0, 0, 0, H);
  glass.addColorStop(0, `rgba(8, 26, 42, ${tone.plate})`);
  glass.addColorStop(1, `rgba(4, 12, 22, ${tone.plate})`);
  ctx.fillStyle = glass;
  ctx.fillRect(0, 0, W, H);

  // The scanline wash the hub puts over its whole surface, at the same weight.
  ctx.fillStyle = "rgba(150, 220, 255, 0.05)";
  for (let y = 0; y < H; y += 3 * SS) ctx.fillRect(0, y, W, SS);

  // Hairline border, then the corner brackets that make it a System object.
  ctx.strokeStyle = rgba(spec.accent, tone.border);
  ctx.lineWidth = SS;
  ctx.strokeRect(SS / 2, SS / 2, W - SS, H - SS);

  ctx.strokeStyle = rgba(spec.accent, Math.min(1, tone.border + 0.35));
  ctx.lineWidth = 2 * SS;
  const b = BRACKET * SS;
  for (const [x, y, dx, dy] of [
    [0, 0, 1, 1],
    [W, 0, -1, 1],
    [0, H, 1, -1],
    [W, H, -1, -1],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(x + dx * b, y + dy * SS);
    ctx.lineTo(x + dx * SS, y + dy * SS);
    ctx.lineTo(x + dx * SS, y + dy * b);
    ctx.stroke();
  }

  // The accent bar down the left edge: the hub's `.holo-tasks` signature, and
  // what makes a row of these read as one instrument rather than a set of tags.
  ctx.fillStyle = rgba(spec.accent, Math.min(1, tone.border + 0.45));
  ctx.fillRect(0, 0, ACCENT_BAR * SS, H);

  const textX = (PAD_X + ACCENT_BAR) * SS;
  let baseline = (PAD_Y + TITLE_PX * 0.78) * SS;

  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = rgba(spec.accent, 0.65);
  ctx.shadowBlur = 9 * SS;
  setFont(ctx, 800, TITLE_PX, 1.7);
  ctx.fillStyle = `rgba(234, 248, 255, ${tone.ink})`;
  ctx.fillText(title, textX, baseline);
  ctx.shadowBlur = 0;

  if (range) {
    setFont(ctx, 700, RANGE_PX, 1.2);
    ctx.fillStyle = rgba(spec.accent, Math.min(1, tone.ink));
    ctx.textAlign = "right";
    ctx.fillText(range, W - PAD_X * SS, baseline);
    ctx.textAlign = "left";
  }

  if (detail) {
    baseline += (ROW_GAP + DETAIL_PX) * SS;
    setFont(ctx, 500, DETAIL_PX, 0.2);
    ctx.fillStyle = `rgba(157, 195, 221, ${tone.ink * 0.95})`;
    ctx.fillText(detail, textX, baseline);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;

  return {
    texture,
    widthPx,
    heightPx,
    dispose: () => texture.dispose(),
  };
}
