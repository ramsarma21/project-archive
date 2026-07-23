import type * as THREE from "three";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// MechanicBodyStaging seam.
//
// Mechanic executions stage the player's VISIBLE body (never the physics
// transform): easing onto an authored stage anchor, playing an authored
// execution clip once the hold engages, applying an authored per-frame
// displacement curve, and optionally parenting a carried prop.
//
// The Player keeps only the generic blend/apply loop; every prompt-specific
// clip/anchor/curve lives in a registered implementation (Day-1's are in
// world/content/day1MechanicStaging.tsx, wired by the World3D shell).
// Registration order matters: the first registration whose match() accepts
// the prompt id wins, so specific matchers register before catch-alls.
// ---------------------------------------------------------------------------

export interface MechanicStageContext {
  body: THREE.Group;
  promptId: string;
  // 0..1 mechanic hold progress (already stage-weighted for multi-stage jobs).
  progress: number;
  // A hold is currently engaged.
  active: boolean;
  // Scene clock (seconds) for cadence curves.
  elapsedTime: number;
  reducedMotion: boolean;
  // The player's authoritative position/heading (the staged body is displaced
  // relative to it in body-local space).
  playerX: number;
  playerZ: number;
  heading: number;
}

export interface MechanicStageResult {
  // THOMAS_HAUL-style shuttle runs report whether the carrier is mid-walk so
  // the execution clip can switch between carry and carryWalk.
  walking?: boolean;
}

export interface MechanicBodyStaging {
  match(promptId: string): boolean;
  // Ease the visible body onto the authored stage anchor while executing
  // (third-person staged executions; head-cam beats always stage).
  stagesOnAnchor: boolean;
  // Authored execution clip once the player has engaged the hold at least
  // once; absent/null keeps the generic pose (Interaction-Spec §6).
  executionClip?(
    promptId: string,
    walking: boolean,
  ): { clip: string; loopOnce?: boolean } | null;
  // Authored per-frame displacement applied to the (already staged) body.
  stage?(ctx: MechanicStageContext): MechanicStageResult | void;
  // World prop parented to the body while this mechanic is mounted.
  carriedProp?(promptId: string, reducedMotion: boolean): ReactNode;
}

const REGISTRY: MechanicBodyStaging[] = [];

export function registerMechanicBodyStaging(staging: MechanicBodyStaging): void {
  REGISTRY.push(staging);
}

export function mechanicBodyStagingFor(
  promptId: string | null,
): MechanicBodyStaging | null {
  if (!promptId) return null;
  return REGISTRY.find((staging) => staging.match(promptId)) ?? null;
}
