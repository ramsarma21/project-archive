// Pure objective quest-marker logic (Interaction-Spec: marker replacement).
//
// This module owns every stateless decision the QuestMarkerDirector/Hud make:
// which target is ACTIVE, the per-marker display state, distance-driven scale,
// arrival dwell/hysteresis, and off-screen edge-wedge clamping. It imports no
// three.js/React so the whole state machine is unit-testable in isolation
// (see __tests__/questMarkerResolver.test.ts). The director feeds it sampled
// numbers (distances, timestamps, NDC coordinates) and applies the results.

// ---- Timing / geometry constants -------------------------------------------
// Distance is always planar (XZ); a selected marker only fades into ARRIVING
// after a short continuous dwell, and a freshly-selected marker additionally
// waits out a selection-confirmation window so a walk-in select never instantly
// teleports (Interaction-Spec: selection never moves the player).
export const ARRIVAL_DWELL_MS = 180;
export const SELECT_CONFIRM_MS = 250;
export const OCCLUSION_DEBOUNCE_MS = 250;
export const DISTANCE_SAMPLE_MS = 250; // 4 Hz distance sampling
export const OCCLUSION_SAMPLE_MS = 125; // <= 8 Hz LOS/occlusion sampling
// Idle-redirect parking radius is arrivalRadius + this margin (per kind).
export const IDLE_PARK_EXTRA_M = 0.35;
// 1x scale within this radius; beyond it markers grow by sqrt(d/base).
export const DISTANCE_SCALE_BASE_M = 18;
export const HERO_SCALE_MAX = 1.6;
export const SEAL_SCALE_MAX = 1.15;

export type QuestMarkerState =
  | "AVAILABLE" // unselected eligible: aged brass, hollow/static, no edge/label
  | "ACTIVE" // selected / sole forced gold, beyond near radius
  | "NEARBY" // active, inside kind near radius: approach prompt, distance hidden
  | "ARRIVING" // active, inside arrival radius: fade then arrive once
  | "HIDDEN"; // choreography/archive/non-roam/sibling after focus

export function planarDistance(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.hypot(dx, dz);
}

// Distance-driven world scale: identity out to the base radius, then sqrt
// growth so far markers stay readable, clamped tighter for the flat ground seal.
export function distanceScale(distanceM: number, part: "HERO" | "SEAL"): number {
  if (!(distanceM > DISTANCE_SCALE_BASE_M)) return 1;
  const raw = Math.sqrt(distanceM / DISTANCE_SCALE_BASE_M);
  const max = part === "SEAL" ? SEAL_SCALE_MAX : HERO_SCALE_MAX;
  return Math.min(max, Math.max(1, raw));
}

// The single ACTIVE (saturated gold) target: an explicit selection wins;
// otherwise a lone runtime-forced GOLD becomes active. With several eligible
// targets and no selection/forced gold, nothing is active (all AVAILABLE).
export function pickActiveTargetId(
  targets: { targetId: string; forcedGold: boolean }[],
  selectedTargetId: string | null | undefined,
): string | null {
  if (selectedTargetId && targets.some((t) => t.targetId === selectedTargetId)) {
    return selectedTargetId;
  }
  const golds = targets.filter((t) => t.forcedGold);
  return golds.length === 1 ? golds[0]!.targetId : null;
}

export function markerState(input: {
  eligible: boolean;
  active: boolean;
  distanceM: number;
  nearM: number;
  arrivalM: number;
}): QuestMarkerState {
  if (!input.eligible) return "HIDDEN";
  if (!input.active) return "AVAILABLE";
  if (input.distanceM <= input.arrivalM) return "ARRIVING";
  if (input.distanceM <= input.nearM) return "NEARBY";
  return "ACTIVE";
}

// Arrival hysteresis: the selected marker must sit inside its (kind-specific)
// arrival radius for a continuous dwell AND the selection itself must have
// settled for the confirmation window, so a walk-in select requires a genuine
// pause before FREE_ROAM_GOTO fires and selection never auto-teleports.
export function arrivalReady(input: {
  insideArrival: boolean;
  dwellMs: number;
  msSinceSelection: number;
}): boolean {
  return (
    input.insideArrival &&
    input.dwellMs >= ARRIVAL_DWELL_MS &&
    input.msSinceSelection >= SELECT_CONFIRM_MS
  );
}

export function farLabel(label: string, distanceM: number): string {
  return `${label} \u00b7 ${Math.max(0, Math.round(distanceM))}m`;
}

// ---- Screen-edge wedge / off-camera guidance -------------------------------
// Fractions are viewport-relative (0..1), origin top-left. `safe` insets keep
// the wedge clear of HoloTasks/subtitles/controls and mobile safe areas.
export interface SafeArea {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface EdgeResult {
  onScreen: boolean;
  x: number; // clamped viewport fraction
  y: number;
  angleRad: number; // direction the wedge points (screen space, atan2(dy, dx))
}

function clampToSafeRect(
  dx: number,
  dy: number,
  safe: SafeArea,
): { x: number; y: number } {
  const cx = 0.5;
  const cy = 0.5;
  const minX = safe.left;
  const maxX = 1 - safe.right;
  const minY = safe.top;
  const maxY = 1 - safe.bottom;
  let t = Infinity;
  if (dx > 1e-6) t = Math.min(t, (maxX - cx) / dx);
  else if (dx < -1e-6) t = Math.min(t, (minX - cx) / dx);
  if (dy > 1e-6) t = Math.min(t, (maxY - cy) / dy);
  else if (dy < -1e-6) t = Math.min(t, (minY - cy) / dy);
  if (!isFinite(t) || t < 0) t = 0;
  return { x: cx + dx * t, y: cy + dy * t };
}

// Given a marker's projected NDC position (and whether it is behind the
// camera), return whether it is on-screen, and if not, the clamped edge
// position + pointing angle for the gold wedge. Behind-camera points flip so
// the wedge still leads the player the correct way around.
export function projectedEdge(input: {
  ndcX: number;
  ndcY: number;
  behindCamera: boolean;
  safe: SafeArea;
}): EdgeResult {
  let nx = input.ndcX;
  let ny = input.ndcY;
  if (input.behindCamera) {
    nx = -nx;
    ny = -ny;
  }
  const onScreen =
    !input.behindCamera && nx >= -1 && nx <= 1 && ny >= -1 && ny <= 1;
  const sx = nx * 0.5 + 0.5;
  const sy = 1 - (ny * 0.5 + 0.5);
  if (onScreen) {
    return {
      onScreen: true,
      x: Math.min(1, Math.max(0, sx)),
      y: Math.min(1, Math.max(0, sy)),
      angleRad: 0,
    };
  }
  let dx = sx - 0.5;
  let dy = sy - 0.5;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) dy = 1; // straight ahead/behind
  const clamped = clampToSafeRect(dx, dy, input.safe);
  return {
    onScreen: false,
    x: clamped.x,
    y: clamped.y,
    angleRad: Math.atan2(dy, dx),
  };
}
