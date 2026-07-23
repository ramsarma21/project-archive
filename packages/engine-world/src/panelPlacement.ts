import type { Camera, Object3D } from "three";
import { Vector3 } from "three";

// ---------------------------------------------------------------------------
// Screen-space clamping for world-anchored interrupt panels (feel-audit-1
// P0-2). Drei's <Html> projects the 3D anchor to raw screen coordinates with
// no viewport awareness: a hanging sign at y≈2.65m projects ABOVE the screen
// when the player stands beneath it, leaving a locked-input panel the player
// can neither see nor dismiss. Every interrupt panel goes through this
// clamp so its content always lands inside the safe viewport area.
// ---------------------------------------------------------------------------

export interface PanelMargins {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

// Safe-area margins for a center-anchored exchange panel: half the panel's
// typical footprint plus breathing room. Bottom reserves extra space so the
// choice buttons always stay reachable above the HUD edge.
export const EXCHANGE_PANEL_MARGINS: PanelMargins = {
  left: 190,
  right: 190,
  top: 130,
  bottom: 210,
};

// Pure clamp (unit-tested): keeps a center-anchored projected point inside
// the viewport safe area. Degenerate viewports (smaller than the margins)
// fall back to the viewport centre.
export function clampPanelPoint(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
  margins: PanelMargins = EXCHANGE_PANEL_MARGINS,
): [number, number] {
  const minX = margins.left;
  const maxX = viewportWidth - margins.right;
  const minY = margins.top;
  const maxY = viewportHeight - margins.bottom;
  if (minX > maxX || minY > maxY) {
    return [viewportWidth / 2, viewportHeight / 2];
  }
  return [
    Math.min(Math.max(x, minX), maxX),
    Math.min(Math.max(y, minY), maxY),
  ];
}

const projected = new Vector3();

// drei <Html calculatePosition> adapter: default projection + safe clamp.
// When the anchor is BEHIND the camera the raw projection mirrors across the
// screen; anchor those cases to the lower-centre band instead so the panel
// reads as "the thing you just used is at your back".
export function clampedPanelPosition(
  el: Object3D,
  camera: Camera,
  size: { width: number; height: number },
): [number, number] {
  projected.setFromMatrixPosition(el.matrixWorld);
  projected.project(camera);
  const behind = projected.z > 1;
  const x = behind
    ? size.width / 2
    : ((projected.x + 1) / 2) * size.width;
  const y = behind
    ? size.height - EXCHANGE_PANEL_MARGINS.bottom
    : ((1 - projected.y) / 2) * size.height;
  return clampPanelPoint(x, y, size.width, size.height);
}
