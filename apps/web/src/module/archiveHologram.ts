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
export const RACK_CENTER_X = 1.2;
export const ROOM_CAMERA = {
  position: [0.5, 1.62, 5.9] as const,
  target: [0.62, 1.42, -0.1] as const,
  fov: 44,
};

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

  // Title.
  ctx.fillStyle = ink;
  ctx.font = "700 44px system-ui, -apple-system, Segoe UI, sans-serif";
  const titleLines = wrapText(ctx, spec.kicker, W - pad * 2, 3);
  let ty = 214;
  for (const line of titleLines) {
    ctx.fillText(line, pad, ty);
    ty += 52;
  }

  // Body block — real text when ready/reviewed, redacted bars when contained.
  const bodyTop = ty + 26;
  if (spec.state === "LOCKED") {
    ctx.fillStyle = "rgba(95, 134, 160, 0.5)";
    for (let i = 0; i < 6; i += 1) {
      const bw = (W - pad * 2) * (0.55 + 0.42 * ((i * 37) % 100) / 100);
      roundRect(ctx, pad, bodyTop + i * 40, bw, 18, 4);
      ctx.fill();
    }
  } else {
    ctx.fillStyle = dim;
    ctx.font = "400 27px system-ui, -apple-system, Segoe UI, sans-serif";
    const noteLines = wrapText(ctx, spec.note, W - pad * 2, 6);
    let ny = bodyTop + 6;
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
  return tex;
}

// ---------------------------------------------------------------------------
// Reticle corner brackets — four L-shaped strokes framing a ready/focused slab,
// as line segments in the slab's local space.
// ---------------------------------------------------------------------------

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
