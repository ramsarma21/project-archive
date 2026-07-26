// Canvas textures for the duel's particles.
//
// The project's imported-visible-world rule reserves procedural code for a named
// list that includes particles, shaders, lighting and contact shadows, and forbids
// it for physical objects and surfaces — buildings, ground, props, clutter. A ball
// in flight, a muzzle flash and an impact are the former: there is no GLB for
// ordnance, and the repo already draws its light pools and contact shadows exactly
// this way (see ContactShadow and the hub's System dais).
//
// Everything is a single cached canvas per kind, drawn once and shared by every
// instance, because these are the only textures in the mode that are not imported.

import * as THREE from "three";

const cache = new Map<string, THREE.CanvasTexture>();

function build(key: string, size: number, paint: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const existing = cache.get(key);
  if (existing) return existing;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  paint(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  cache.set(key, texture);
  return texture;
}

/** Hot core: white centre falling off to nothing. Used for balls and flashes. */
export function glowTexture(): THREE.CanvasTexture {
  return build("glow", 128, (ctx, size) => {
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 1, half, half, half - 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.22, "rgba(255,236,196,0.95)");
    gradient.addColorStop(0.55, "rgba(255,168,74,0.42)");
    gradient.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  });
}

/** Soft round falloff with no hot core: haloes, dust, ground threat marks. */
export function softTexture(): THREE.CanvasTexture {
  return build("soft", 128, (ctx, size) => {
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 1, half, half, half - 2);
    gradient.addColorStop(0, "rgba(255,255,255,0.85)");
    gradient.addColorStop(0.5, "rgba(255,255,255,0.28)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  });
}

/**
 * Tracer body: hottest at the head and fading away behind, narrowing across.
 *
 * The head is the top of the canvas, which is v=1, which is where the sprite is
 * anchored — so the bright end lands on the ball and the tail lies back along its
 * path without the renderer having to reason about UV direction at runtime.
 */
export function tracerTexture(): THREE.CanvasTexture {
  return build("tracer", 128, (ctx, size) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, size);
    gradient.addColorStop(0, "rgba(255,238,205,0.95)");
    gradient.addColorStop(0.35, "rgba(255,190,110,0.5)");
    gradient.addColorStop(1, "rgba(255,150,60,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    // Narrow the spine towards the edges so the quad does not read as a rectangle.
    const across = ctx.createLinearGradient(0, 0, size, 0);
    across.addColorStop(0, "rgba(0,0,0,1)");
    across.addColorStop(0.5, "rgba(0,0,0,0)");
    across.addColorStop(1, "rgba(0,0,0,1)");
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = across;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = "source-over";
  });
}

/** Thin ring: the aim mark on the ground and the shock of an impact. */
export function ringTexture(): THREE.CanvasTexture {
  return build("ring", 128, (ctx, size) => {
    const half = size / 2;
    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(half, half, half - 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(half, half, half - 12, 0, Math.PI * 2);
    ctx.stroke();
  });
}

/** Soft elliptical contact shadow, so a body is planted on the yard. */
export function contactShadowTexture(): THREE.CanvasTexture {
  return build("contact", 128, (ctx, size) => {
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 4, half, half, half - 2);
    gradient.addColorStop(0, "rgba(0,0,0,0.46)");
    gradient.addColorStop(0.62, "rgba(0,0,0,0.2)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  });
}
