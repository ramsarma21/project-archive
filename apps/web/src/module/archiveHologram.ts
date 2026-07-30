import * as THREE from "three";
import type { ArchiveFileStatus } from "./archiveLayout.js";

// ---------------------------------------------------------------------------
// The Archive room's holographic materials, layout maths and file-face art.
//
// This is the "make the assets" half of the Archive overhaul, and it is
// deliberately ALL procedural — custom shaders, a rack-arc layout, and a
// canvas-drawn "dossier" face per file. The workspace rule requires visible
// PHYSICAL production props to be imported GLB, but it explicitly permits
// procedural code and shaders for "UI/Archive highlights". A case file is
// projected light — Archive UI, not a physical object — so it is built from a
// shader and a canvas texture, which is both allowed and the correct technical
// choice (importing a mesh to fake projected light would be the wrong one).
//
// Depends on three ALONE (no R3F, no drei), the same discipline presenterHologram
// follows, so the layout maths stay unit-checkable and the materials stay
// disposable and owned by their caller.
// ---------------------------------------------------------------------------

/** A case-file slab: portrait, with real thickness so it reads as an object. */
export const SLAB = {
  width: 1.04,
  height: 1.44,
  depth: 0.07,
  /** The lit face sits a hair proud of the front so the text never z-fights. */
  faceInset: 0.94,
} as const;

/** Where a file sits in the rack, and the phase of its idle drift. */
export interface SlotPlacement {
  readonly position: readonly [number, number, number];
  readonly rotationY: number;
  /** A per-slot phase so the rack does not bob in unison. */
  readonly driftPhase: number;
}

/**
 * A shallow arc of slabs facing the viewer, centred on the origin.
 *
 * Pure maths: the ends fan back in Z and yaw inward so the whole rack "faces"
 * a camera sitting on +Z, readable at a glance. The brief slab, when present,
 * is pushed a little further out on the right as a distinct end-cap.
 */
export function rackPlacements(
  fileCount: number,
  includeBrief: boolean,
  centerX = 0,
): SlotPlacement[] {
  const total = fileCount + (includeBrief ? 1 : 0);
  if (total <= 0) return [];
  const gapX = total > 4 ? 1.3 : 1.44;
  const centre = (total - 1) / 2;
  const out: SlotPlacement[] = [];
  for (let i = 0; i < total; i += 1) {
    const spread = i - centre;
    const isBrief = includeBrief && i === total - 1;
    const x = centerX + spread * gapX;
    // Ends recede and the whole rack floats at chest height.
    const z = -Math.abs(spread) * 0.24 - (isBrief ? 0.16 : 0);
    const y = 1.46 + (isBrief ? 0.02 : 0);
    const rotationY = -spread * 0.14;
    out.push({
      position: [x, y, z],
      rotationY,
      driftPhase: (i * 1.618) % (Math.PI * 2),
    });
  }
  return out;
}

/** The camera framing for the rack at rest, in room space (floor at y=0). The
 * rack sits right-of-centre (see RACK_CENTER_X) so the presenter stands clear of
 * it on the left; the camera looks a little right so the rack fills that space. */
export const RACK_CENTER_X = 1.25;
export const ROOM_CAMERA = {
  position: [-0.5, 1.6, 5.8] as const,
  target: [0.35, 1.46, -0.1] as const,
  fov: 45,
};

/** Where the presenter projects in the room (feet at y=0, but only her upper
 * body renders — see the modesty crop). Forward in the LEFT FOREGROUND, close
 * enough to read as a real presence at bust scale, yawed toward the rack so she
 * presents it; the camera is offset left to keep her fully in frame beside it. */
export const PRESENTER_POS: readonly [number, number, number] = [-1.2, 0, 3.8];
export const PRESENTER_YAW = -0.34;

// ---------------------------------------------------------------------------
// State → light. The owner's brief: state must read at a distance through light,
// not text pills. Locked is contained and unstable; ready is inviting and
// pulsing; reviewed is settled, not dead.
// ---------------------------------------------------------------------------

export type SlabVisualState = "LOCKED" | "READY" | "DONE";

export interface SlabPalette {
  /** Interior fill colour. */
  readonly base: number;
  /** Edge/fresnel glow colour. */
  readonly edge: number;
  /** Emissive lift added on top of the fill (0..1-ish). */
  readonly emissive: number;
  /** Steady-state body opacity. */
  readonly opacity: number;
  /** Slow pulse depth (0 = steady). */
  readonly pulse: number;
  /** Projection-dropout depth (0 = solid, higher = unstable/flickering). */
  readonly dropout: number;
  /** Idle vertical drift amplitude, in metres. */
  readonly drift: number;
  /** Whether the reticle corner brackets arm on this state. */
  readonly reticle: boolean;
}

export function slabPalette(state: SlabVisualState): SlabPalette {
  switch (state) {
    case "LOCKED":
      // Contained and unstable: desaturated steel, low glow, occasional dropout.
      return {
        base: 0x21384a,
        edge: 0x3f6f8c,
        emissive: 0.04,
        opacity: 0.5,
        pulse: 0,
        dropout: 0.5,
        drift: 0.012,
        reticle: false,
      };
    case "READY":
      // Inviting: bright cyan, a slow breathing pulse, brackets armed. Emissive
      // kept low so the drawn dossier face still reads through the glow rather
      // than blooming to a flat white panel.
      return {
        base: 0x268fce,
        edge: 0x9fe4ff,
        emissive: 0.12,
        opacity: 0.72,
        pulse: 0.14,
        dropout: 0,
        drift: 0.03,
        reticle: true,
      };
    case "DONE":
      // Settled, not dead: a calm teal, steady, brackets off.
      return {
        base: 0x1f8f86,
        edge: 0x7ee3d8,
        emissive: 0.16,
        opacity: 0.74,
        pulse: 0.05,
        dropout: 0,
        drift: 0.018,
        reticle: false,
      };
  }
}

/** Maps the Archive's logical status to the slab's visual state (identity today,
 * kept as a seam so a future "reviewing" nuance need not touch the shader). */
export function slabStateFor(status: ArchiveFileStatus): SlabVisualState {
  return status;
}

// ---------------------------------------------------------------------------
// The slab body shader — a translucent projected panel with a fresnel edge, a
// fine internal scanline, a slow vertical scan sweep and a projector dropout.
// toneMapped is left ON so the bloom pass lifts the cyan edges rather than the
// whole face; the emissive term is folded into colour so it still blooms.
// ---------------------------------------------------------------------------

export interface SlabUniforms {
  uTime: { value: number };
  uColor: { value: THREE.Color };
  uEdge: { value: THREE.Color };
  uOpacity: { value: number };
  uEmissive: { value: number };
  uPulse: { value: number };
  uDropout: { value: number };
  uHover: { value: number };
  uSelect: { value: number };
  uReduced: { value: number };
}

const SLAB_VERT = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying vec2 vUv;
  varying vec3 vLocal;
  void main() {
    vUv = uv;
    vLocal = position;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const SLAB_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec3 uEdge;
  uniform float uOpacity;
  uniform float uEmissive;
  uniform float uPulse;
  uniform float uDropout;
  uniform float uHover;
  uniform float uSelect;
  uniform float uReduced;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying vec2 vUv;
  varying vec3 vLocal;

  float hash(float n) { return fract(sin(n) * 43758.5453123); }

  void main() {
    float ndv = clamp(dot(normalize(vNormalW), normalize(vViewDir)), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 3.0);
    float rim = pow(1.0 - ndv, 6.0);
    float anim = (1.0 - uReduced) * uTime;

    // Fine horizontal scanlines running up the local face.
    float scan = 0.5 + 0.5 * sin(vLocal.y * 150.0 - anim * 2.2);
    // A slow vertical scan sweep that reads as an active projection.
    float sweepY = fract(vUv.y - anim * 0.14);
    float sweep = smoothstep(0.0, 0.06, sweepY) * (1.0 - smoothstep(0.06, 0.14, sweepY));

    // A slow breathing pulse (ready) and a projector dropout (locked).
    float pulse = 1.0 + uPulse * (1.0 - uReduced) * sin(anim * 2.0);
    float dropGate = step(0.972, hash(floor(anim * 4.0) + 3.0));
    float drop = 1.0 - uDropout * (1.0 - uReduced) * dropGate * 0.7;

    vec3 col = mix(uColor, uEdge, clamp(fres * 0.85 + rim * 0.6, 0.0, 1.0));
    col += uEdge * (uEmissive + sweep * 0.5 + uHover * 0.35 + uSelect * 0.5);
    col += uEdge * scan * 0.05;
    col *= pulse;

    float alpha = uOpacity * (0.26 + 0.62 * fres + 0.18 * rim);
    alpha += sweep * 0.14 + uHover * 0.12 + uSelect * 0.18;
    alpha = clamp(alpha, 0.0, 1.0) * drop;

    gl_FragColor = vec4(col, alpha);
  }
`;

/** A fresh slab-body material with its own uniforms. Caller owns disposal. */
export function makeSlabMaterial(reducedMotion: boolean): THREE.ShaderMaterial {
  const uniforms: SlabUniforms = {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(0x2ea6e6) },
    uEdge: { value: new THREE.Color(0x9fe4ff) },
    uOpacity: { value: 0.85 },
    uEmissive: { value: 0.3 },
    uPulse: { value: 0.15 },
    uDropout: { value: 0 },
    uHover: { value: 0 },
    uSelect: { value: 0 },
    uReduced: { value: reducedMotion ? 1 : 0 },
  };
  return new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader: SLAB_VERT,
    fragmentShader: SLAB_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    blending: THREE.NormalBlending,
  });
}

// ---------------------------------------------------------------------------
// The file "face": a canvas-drawn dossier, so each slab reads as an ACTUAL file
// rather than a coloured pane. Drawn once per (file, state) and mapped onto a
// plane a hair proud of the slab front. Cyan monospace, hairline rules, a
// classification strip, a status glyph, and a body-of-text block that redacts
// itself while the file is contained.
// ---------------------------------------------------------------------------

export interface SlabFaceSpec {
  readonly ordinalLabel: string; // "01"
  readonly kicker: string; // the file's title
  readonly note: string; // one line of the body
  readonly conceptTag: string; // classification strip, e.g. "CASE FILE"
  readonly state: SlabVisualState;
  readonly reducedMotion: boolean;
  /** The file's document image, drawn as an inset scan on ready/reviewed faces
   * so the slab reads as an actual dossier. Sealed files stay redacted. */
  readonly thumbnail?: string;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    } else {
      line = candidate;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  const joined = lines.slice(0, maxLines);
  if (words.length > joined.join(" ").split(/\s+/).length && joined.length > 0) {
    joined[joined.length - 1] = `${joined[joined.length - 1]!}…`;
  }
  return joined;
}

/**
 * Draws one file face to a CanvasTexture. The palette echoes `slabPalette` so
 * the drawn dossier and the shader body read as one projection.
 */
export function makeSlabFaceTexture(spec: SlabFaceSpec): THREE.CanvasTexture {
  const W = 620;
  const H = 860;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const ink =
    spec.state === "LOCKED"
      ? "rgba(150, 194, 221, 0.62)"
      : spec.state === "DONE"
        ? "rgba(201, 255, 242, 0.94)"
        : "rgba(224, 248, 255, 0.98)";
  const dim =
    spec.state === "LOCKED"
      ? "rgba(120, 168, 198, 0.4)"
      : "rgba(159, 220, 255, 0.72)";
  const accent =
    spec.state === "DONE" ? "#7ee3d8" : spec.state === "LOCKED" ? "#5f86a0" : "#9fe4ff";

  ctx.clearRect(0, 0, W, H);

  // An interior panel so text always has a readable substrate — darker on the
  // READY file, whose bright body would otherwise wash the dossier out.
  const panel = ctx.createLinearGradient(0, 0, 0, H);
  const substrate = spec.state === "READY" ? 0.24 : 0.12;
  panel.addColorStop(0, `rgba(6, 24, 40, ${0.5 + substrate})`);
  panel.addColorStop(1, `rgba(2, 11, 21, ${0.62 + substrate})`);
  ctx.fillStyle = panel;
  roundRect(ctx, 20, 20, W - 40, H - 40, 18);
  ctx.fill();

  const pad = 54;

  // Header: classification strip + ordinal.
  ctx.fillStyle = accent;
  roundRect(ctx, pad, 70, 176, 34, 4);
  ctx.fill();
  ctx.fillStyle = "#04121e";
  ctx.font = "800 20px ui-monospace, monospace";
  ctx.textBaseline = "middle";
  ctx.fillText(spec.conceptTag.toUpperCase().slice(0, 12), pad + 14, 88);

  ctx.fillStyle = ink;
  ctx.font = "800 72px ui-monospace, monospace";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "right";
  ctx.fillText(spec.ordinalLabel, W - pad, 108);
  ctx.textAlign = "left";

  // Hairline rule.
  ctx.strokeStyle = dim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad, 150);
  ctx.lineTo(W - pad, 150);
  ctx.stroke();

  // Docket line — a technical reference so the face reads as a filed record.
  const isBrief = spec.conceptTag.toLowerCase().includes("brief");
  ctx.fillStyle = dim;
  ctx.font = "700 16px ui-monospace, monospace";
  const docket =
    spec.state === "LOCKED"
      ? `DOSSIER ${spec.ordinalLabel} · SEALED`
      : isBrief
        ? "TRANSMISSION · MISSION BRIEF"
        : `DOSSIER ${spec.ordinalLabel} · BOSTON · 1774`;
  ctx.fillText(docket, pad, 180);

  // Title.
  ctx.fillStyle = ink;
  ctx.font = "700 44px system-ui, -apple-system, Segoe UI, sans-serif";
  const titleLines = wrapText(ctx, spec.kicker, W - pad * 2, 2);
  let ty = 232;
  for (const line of titleLines) {
    ctx.fillText(line, pad, ty);
    ty += 52;
  }

  // Body — a redacted, contained file when locked; an inset document scan plus a
  // line of text when ready/reviewed, so the rack reads as intelligence.
  const contentW = W - pad * 2;
  const bodyTop = ty + 14;
  const thumbH = 250;
  if (spec.state === "LOCKED") {
    // Labelled-but-redacted FIELDS: a field name, then a blacked-out value — so
    // it reads as a withheld classified record with structure, not a blank card.
    const rowY = bodyTop + 6;
    for (let i = 0; i < 4; i += 1) {
      const y = rowY + i * 40;
      const labelW = 78 + ((i * 41) % 66);
      ctx.fillStyle = "rgba(127, 196, 232, 0.5)";
      roundRect(ctx, pad, y, labelW, 13, 3);
      ctx.fill();
      ctx.fillStyle = "rgba(7, 18, 30, 0.96)";
      roundRect(ctx, pad + labelW + 14, y - 3, contentW - labelW - 14, 19, 3);
      ctx.fill();
    }
    // A containment crest with weight: a filled hex ring + a padlock.
    const cx = pad + contentW / 2;
    const cy = rowY + 4 * 40 + 80;
    ctx.strokeStyle = accent;
    ctx.fillStyle = "rgba(63, 111, 140, 0.18)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      const px = cx + Math.cos(a) * 52;
      const py = cy + Math.sin(a) * 52;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy - 8, 13, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = accent;
    roundRect(ctx, cx - 18, cy - 8, 36, 26, 4);
    ctx.fill();
    ctx.fillStyle = "rgba(6, 20, 32, 0.9)";
    ctx.beginPath();
    ctx.arc(cx, cy + 3, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx - 2, cy + 3, 4, 9);
    ctx.fillStyle = "rgba(127, 196, 232, 0.75)";
    ctx.font = "800 16px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("CLEARANCE REQUIRED", cx, cy + 76);
    ctx.textAlign = "left";
  } else if (spec.thumbnail) {
    // A framed inset for the document scan (drawn on image load, below).
    ctx.fillStyle = "rgba(4, 16, 28, 0.62)";
    roundRect(ctx, pad, bodyTop, contentW, thumbH, 6);
    ctx.fill();
    ctx.strokeStyle = dim;
    ctx.lineWidth = 2;
    roundRect(ctx, pad, bodyTop, contentW, thumbH, 6);
    ctx.stroke();
    ctx.fillStyle = dim;
    ctx.font = "400 26px system-ui, -apple-system, Segoe UI, sans-serif";
    const noteLines = wrapText(ctx, spec.note, contentW, 2);
    let ny = bodyTop + thumbH + 42;
    for (const line of noteLines) {
      ctx.fillText(line, pad, ny);
      ny += 36;
    }
  } else {
    ctx.fillStyle = dim;
    ctx.font = "400 27px system-ui, -apple-system, Segoe UI, sans-serif";
    const noteLines = wrapText(ctx, spec.note, contentW, 6);
    let ny = bodyTop + 8;
    for (const line of noteLines) {
      ctx.fillText(line, pad, ny);
      ny += 38;
    }
  }

  // Footer: status glyph + word, drawn as light not a pill.
  const footY = H - 96;
  ctx.strokeStyle = dim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad, footY - 26);
  ctx.lineTo(W - pad, footY - 26);
  ctx.stroke();

  ctx.strokeStyle = accent;
  ctx.fillStyle = accent;
  ctx.lineWidth = 3;
  const gx = pad + 16;
  const gy = footY + 8;
  if (spec.state === "LOCKED") {
    // A containment hexagon with a bar across it.
    ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      const px = gx + Math.cos(a) * 16;
      const py = gy + Math.sin(a) * 16;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fillRect(gx - 10, gy - 3, 20, 6);
  } else if (spec.state === "DONE") {
    // A filed check.
    ctx.beginPath();
    ctx.moveTo(gx - 14, gy);
    ctx.lineTo(gx - 4, gy + 11);
    ctx.lineTo(gx + 16, gy - 13);
    ctx.stroke();
  } else {
    // Ready: a target reticle.
    ctx.beginPath();
    ctx.arc(gx, gy, 13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(gx, gy - 20);
    ctx.lineTo(gx, gy + 20);
    ctx.moveTo(gx - 20, gy);
    ctx.lineTo(gx + 20, gy);
    ctx.stroke();
  }

  ctx.font = "800 26px ui-monospace, monospace";
  ctx.textBaseline = "middle";
  const word =
    spec.state === "LOCKED" ? "SEALED" : spec.state === "DONE" ? "REVIEWED" : "READY";
  ctx.fillText(word, gx + 34, gy + 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;

  // The document scan is drawn asynchronously into the reserved inset and the
  // texture re-uploaded once it loads. Same-origin images do not taint the
  // canvas. Sealed files get no scan.
  if (spec.thumbnail && spec.state !== "LOCKED") {
    const img = new Image();
    img.onload = () => {
      ctx.save();
      roundRect(ctx, pad, bodyTop, contentW, thumbH, 6);
      ctx.clip();
      const scale = Math.max(contentW / img.width, thumbH / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, pad + (contentW - dw) / 2, bodyTop + (thumbH - dh) / 2, dw, dh);
      // Tint the paper into the cyan projection palette so it reads as a scan.
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = "rgba(122, 172, 208, 0.92)";
      ctx.fillRect(pad, bodyTop, contentW, thumbH);
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = "rgba(22, 74, 112, 0.32)";
      ctx.fillRect(pad, bodyTop, contentW, thumbH);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(160, 226, 255, 0.1)";
      for (let y = bodyTop + 8; y < bodyTop + thumbH; y += 6) ctx.fillRect(pad, y, contentW, 1);
      ctx.restore();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      roundRect(ctx, pad, bodyTop, contentW, thumbH, 6);
      ctx.stroke();
      tex.needsUpdate = true;
    };
    img.src = spec.thumbnail;
  }

  return tex;
}

// ---------------------------------------------------------------------------
// Reticle corner brackets — four L-shaped strokes framing a ready/focused slab,
// as line segments in the slab's local space.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The presenter as a true projection.
//
// The first pass composited the imported rig as an opaque, near-photoreal figure
// over the translucent room — she read as a stock character dropped in, not the
// Archive's own projection. This gives her the SAME visual language as the slabs:
// translucency, a cyan tint, internal scanlines, a fresnel rim that blooms, a
// soft projector dropout, and feet that dissolve into the emitter light. The
// face stays the one thing preserved — the front-facing albedo is kept warm and
// readable while every dramatic effect is gated to the edges, the same principle
// presenterHologram encodes for the composited version (which still drives the
// in-FILE framing untouched).
//
// This lives here, not in presenterHologram.ts, because that file belongs to
// another lane; this is the archive-room lane's own, more aggressive treatment
// applied to a rig clone rendered inside the room's shared scene.
// ---------------------------------------------------------------------------

/** A soft radial cyan glow texture (core → transparent) for the emitter pool. */
export function radialGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, "rgba(190, 240, 255, 0.95)");
  g.addColorStop(0.32, "rgba(110, 210, 255, 0.55)");
  g.addColorStop(0.7, "rgba(56, 158, 235, 0.18)");
  g.addColorStop(1.0, "rgba(30, 110, 200, 0.0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

const PRESENTER_HOLO_FRAG = /* glsl */ `
  vec3 holoN = normalize(vNormal);
  if (!gl_FrontFacing) holoN = -holoN;
  float holoNdV = clamp(dot(holoN, vHoloView), 0.0, 1.0);
  float holoFront = smoothstep(0.30, 0.80, holoNdV);
  float holoEdge = 1.0 - holoFront;
  float holoFres = pow(1.0 - holoNdV, 4.0);
  float holoRim = pow(1.0 - holoNdV, 7.0);
  float holoAnim = (1.0 - uReduced) * uHoloTime;
  float holoScan = 0.5 + 0.5 * sin(vHoloWorldY * 150.0 - holoAnim * 3.2);
  float holoDit = fract(sin(dot(floor(gl_FragCoord.xy + holoAnim), vec2(12.9898, 78.233))) * 43758.5453);
  float holoDrop = step(0.985, fract(sin(floor(holoAnim * 3.0) * 91.7) * 4813.0));
  // Keep the face warm and readable on the front; pull blue down so cyan light
  // cannot turn skin cyan. The body/hair (holoFront~0) keep the projection look.
  gl_FragColor.rgb *= mix(vec3(1.0), vec3(1.12, 1.0, 0.82), holoFront);
  float holoWarmB = min(gl_FragColor.b, max(gl_FragColor.r, gl_FragColor.g) * 0.92);
  gl_FragColor.b = mix(gl_FragColor.b, holoWarmB, holoFront * 0.92);
  // A cyan projection tint, light on the face front, full on the body edges.
  gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(0.62, 0.96, 1.16) + vec3(0.0, 0.05, 0.09), holoEdge * 0.85 + 0.22);
  // Additive silhouette energy — the rim blooms, so she reads as lit-from-within.
  gl_FragColor.rgb += vec3(0.10, 0.40, 0.52) * holoFres;
  gl_FragColor.rgb += vec3(0.34, 0.78, 0.96) * holoRim;
  // Scanlines (only ever dim), stronger toward the edges so the face stays clean.
  gl_FragColor.rgb *= mix(1.0, mix(0.80, 1.0, holoScan), 0.45 + 0.45 * holoEdge);
  // Projector flicker/dropout — only dims, frozen under reduced motion.
  gl_FragColor.rgb *= 1.0 - (1.0 - uReduced) * (0.06 * (0.5 + 0.5 * sin(holoAnim * 40.0)) + 0.10 * holoDrop) * (0.4 + 0.6 * holoEdge);
  // Highlight rolloff so a warmed cheek/forehead cannot clip to white.
  float holoL = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor.rgb *= 1.0 - holoFront * smoothstep(0.62, 1.0, holoL) * 0.5;
  // MODESTY BUST: the shipped rig wears an open jacket, so the room projects a
  // proper hologram BUST — head, neck, both (jacket-covered) shoulders and the
  // top of the chest — fading out into the emitter beam ABOVE where the jacket
  // opens, not a severed head cut at the jaw. Solid down through the shoulders
  // (~1.46), fading out by ~1.36, which sits above the open V. Do NOT lower the
  // floor past the jacket line; a fully-covered replacement asset is coming.
  float holoBust = smoothstep(1.36, 1.46, vHoloWorldY);
  float holoA = uOpacity * (0.72 + 0.26 * holoFres + 0.18 * holoRim);
  holoA *= holoBust;
  holoA *= mix(0.92, 1.0, holoDit);
  holoA *= 1.0 - (1.0 - uReduced) * 0.14 * holoDrop;
  gl_FragColor.a = clamp(holoA, 0.0, 0.94);
`;

/**
 * Rewrites one imported material into the room's strong hologram treatment and
 * returns the clone. Preserves the base colour map (the face) and confines the
 * cyan/scan/flicker to the edges; the front stays warm and readable.
 */
export function holographizePresenterMaterial(
  source: THREE.MeshStandardMaterial,
  options: { reducedMotion: boolean },
): THREE.MeshStandardMaterial {
  const material = source.clone();
  material.transparent = true;
  material.opacity = 1;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
  material.blending = THREE.NormalBlending;
  material.toneMapped = true;
  material.emissive = new THREE.Color(0x0d5f86);
  material.emissiveIntensity = 0.05;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHoloTime = { value: 0 };
    shader.uniforms.uReduced = { value: options.reducedMotion ? 1 : 0 };
    shader.uniforms.uOpacity = { value: 0.82 };
    (material.userData as { holoShader?: THREE.WebGLProgramParametersWithUniforms }).holoShader = shader;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vHoloView;\nvarying vec4 vHoloScreen;\nvarying float vHoloWorldY;",
      )
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\n" +
          "  vHoloView = normalize(-(modelViewMatrix * vec4(transformed,1.0)).xyz);\n" +
          "  vHoloScreen = projectionMatrix * modelViewMatrix * vec4(transformed,1.0);\n" +
          "  vHoloWorldY = (modelMatrix * vec4(transformed,1.0)).y;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uHoloTime;\nuniform float uReduced;\nuniform float uOpacity;\nvarying vec3 vHoloView;\nvarying vec4 vHoloScreen;\nvarying float vHoloWorldY;",
      )
      .replace("#include <dithering_fragment>", "#include <dithering_fragment>\n" + PRESENTER_HOLO_FRAG);
  };
  material.needsUpdate = true;
  return material;
}

/**
 * Applies the room hologram treatment to every mesh under a rig clone and
 * returns the disposable clones so the caller can free them.
 */
export function holographizePresenter(
  root: THREE.Object3D,
  options: { reducedMotion: boolean },
): Set<THREE.Material> {
  const owned = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    const sources = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const rewritten = sources.map((source) => {
      const material = holographizePresenterMaterial(source as THREE.MeshStandardMaterial, options);
      owned.add(material);
      return material;
    });
    mesh.material = Array.isArray(mesh.material) ? rewritten : rewritten[0]!;
  });
  return owned;
}

/** Corner-bracket line segments framing a w×h face, each arm `len` long. */
export function cornerBracketPositions(
  w: number,
  h: number,
  len: number,
): Float32Array {
  const hw = w / 2;
  const hh = h / 2;
  const seg: number[] = [];
  const corner = (sx: number, sy: number) => {
    const x = sx * hw;
    const y = sy * hh;
    // Horizontal arm.
    seg.push(x, y, 0, x - sx * len, y, 0);
    // Vertical arm.
    seg.push(x, y, 0, x, y - sy * len, 0);
  };
  corner(1, 1);
  corner(-1, 1);
  corner(1, -1);
  corner(-1, -1);
  return new Float32Array(seg);
}
