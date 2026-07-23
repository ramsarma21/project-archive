// Contextual-F traversal resolver (World-Built-State §traversal input). Pure
// and deterministic. F is object-bound only:
//
//   1. a valid nearest authored affordance (vault / climb / duck / hop) wins;
//   2. otherwise, if the player is near an affordance but misaligned inside its
//      safety halo, the action is SUPPRESSED;
//   3. otherwise F does nothing. Free jump is owned by Player's Space input.
//
// Prompt selection carries hysteresis (a wider release radius than acquire) so
// the gold glyph does not flicker. All gating (UI focus, busy, existing action,
// cooldown, F-release-since-last, one-prompt-only) lives here so the director
// and tests share one policy. Enter stays a UI key; Space is free jump in the
// open world (and focused mechanics when UI owns focus); F never falls back.
import type { VaultApproachPlan } from "./traversalClassifier.js";

export const ACQUIRE_RANGE = 1.35;
export const RELEASE_RANGE = 1.55; // sticky halo once acquired
export const FACING_DOT_MIN = 0.35; // rough facing toward the affordance
export const INPUT_BUFFER_MS = 120; // F press is honored for this long
export const COOLDOWN_MS = 200; // 180-250ms completion cooldown (plus F release)
export const SAME_TIER_Y = 0.7; // ground vs roof separation

export type AffordanceKind =
  | "VAULT"
  | "CLIMB_UP"
  | "CLIMB_DOWN"
  | "CLIMB"
  | "DUCK_UNDER"
  | "JUMP"
  | "LADDER"
  | "INTERACT_FLAVOR";

export interface AffordanceEndpoint {
  affordanceId: string;
  dir: 1 | -1;
  kind: AffordanceKind;
  label: string;
  pos: [number, number, number]; // approach/interact endpoint (path start)
  // Unit XZ direction the player should roughly face to take this affordance.
  approachDirX: number;
  approachDirZ: number;
  acquireRange?: number;
  releaseRange?: number;
  minFacingDot?: number;
  cooldownMs?: number;
  strictApproachSide?: boolean;
  source?: "LEGACY" | "DENSITY";
  obstacleId?: string;
  vaultPlan?: VaultApproachPlan;
}

export interface PromptTarget {
  affordanceId: string;
  dir: 1 | -1;
  label: string;
  pos: [number, number, number];
  cooldownMs?: number;
  vaultPlan?: VaultApproachPlan;
}

function alignmentValid(
  affordance: AffordanceEndpoint,
  player: PlayerKinematics,
  distance: number,
  allowNearFacingWaiver: boolean,
): boolean {
  const facingDot =
    player.facingX * affordance.approachDirX +
    player.facingZ * affordance.approachDirZ;
  if (
    (!allowNearFacingWaiver || distance > 0.55) &&
    facingDot < (affordance.minFacingDot ?? FACING_DOT_MIN)
  ) {
    return false;
  }
  if (affordance.strictApproachSide && distance > 0.15) {
    const toX = affordance.pos[0] - player.x;
    const toZ = affordance.pos[2] - player.z;
    const sideDot =
      (toX * affordance.approachDirX + toZ * affordance.approachDirZ) /
      distance;
    if (sideDot < 0.2) return false;
  }
  return true;
}

export interface PlayerKinematics {
  x: number;
  z: number;
  y: number;
  facingX: number; // unit XZ heading
  facingZ: number;
  speed: number; // horizontal speed
  velX: number;
  velZ: number;
  grounded: boolean;
  airtimeMs: number; // time since last grounded (for coyote)
}

// A stable key for a prompt (id + direction) used for hysteresis comparison.
export function promptKey(p: { affordanceId: string; dir: 1 | -1 } | null): string | null {
  return p ? `${p.affordanceId}:${p.dir}` : null;
}

// Nearest eligible affordance endpoint for the glyph, with acquire/release
// hysteresis. `prevKey` is the previously shown prompt so it stays sticky out
// to RELEASE_RANGE. Returns null when nothing is eligible (or when the player
// is airborne / already busy).
export function selectPrompt(
  affordances: readonly AffordanceEndpoint[],
  player: PlayerKinematics,
  prevKey: string | null,
  gate: { enabled: boolean; actionActive: boolean } = { enabled: true, actionActive: false },
): PromptTarget | null {
  if (!gate.enabled || gate.actionActive) return null;
  if (!player.grounded) return null;
  let best: PromptTarget | null = null;
  let bestDist = Infinity;
  for (const a of affordances) {
    const [ex, ey, ez] = a.pos;
    if (Math.abs(player.y - ey) > SAME_TIER_Y) continue;
    const d = Math.hypot(player.x - ex, player.z - ez);
    const key = `${a.affordanceId}:${a.dir}`;
    const radius =
      key === prevKey
        ? (a.releaseRange ?? RELEASE_RANGE)
        : (a.acquireRange ?? ACQUIRE_RANGE);
    if (d > radius) continue;
    if (!alignmentValid(a, player, d, true)) continue;
    if (d < bestDist) {
      bestDist = d;
      best = {
        affordanceId: a.affordanceId,
        dir: a.dir,
        label: a.label,
        pos: [ex, ey, ez],
        cooldownMs: a.cooldownMs,
        vaultPlan: a.vaultPlan,
      };
    }
  }
  return best;
}

export type ActionDecision =
  | { kind: "NONE"; reason: string }
  | {
      kind: "AFFORDANCE";
      affordanceId: string;
      dir: 1 | -1;
      cooldownMs?: number;
      vaultPlan?: VaultApproachPlan;
    }
  | { kind: "SUPPRESS"; reason: string };

export interface ActionContext {
  affordances: readonly AffordanceEndpoint[];
  player: PlayerKinematics;
  prompt: PromptTarget | null; // the currently shown prompt (already validated by selectPrompt)
  nowMs: number;
  fPressedAtMs: number | null; // timestamp of the last F keydown
  fReleasedSinceAction: boolean; // F came back up since the last action fired
  uiFocused: boolean; // an input/button/editable has focus
  busy: boolean; // blocking UI / dialogue / choreography
  actionActive: boolean; // an authored action or jump is already running
  cooldownUntilMs: number; // completion cooldown end
}

// Decide what a fresh F press should do this frame. Returns NONE unless a
// buffered, de-duplicated, ungated F press is present.
export function decideAction(ctx: ActionContext): ActionDecision {
  const buffered =
    ctx.fPressedAtMs !== null && ctx.nowMs - ctx.fPressedAtMs <= INPUT_BUFFER_MS;
  if (!buffered) return { kind: "NONE", reason: "no-buffered-press" };
  if (ctx.uiFocused) return { kind: "NONE", reason: "ui-focused" };
  if (ctx.busy) return { kind: "NONE", reason: "busy" };
  if (ctx.actionActive) return { kind: "NONE", reason: "action-active" };
  if (!ctx.fReleasedSinceAction) return { kind: "NONE", reason: "repeat" };
  if (ctx.nowMs < ctx.cooldownUntilMs) return { kind: "NONE", reason: "cooldown" };

  if (!ctx.player.grounded) return { kind: "NONE", reason: "airborne" };

  // 1. Valid nearest authored affordance wins.
  if (ctx.prompt) {
    return {
      kind: "AFFORDANCE",
      affordanceId: ctx.prompt.affordanceId,
      dir: ctx.prompt.dir,
      cooldownMs: ctx.prompt.cooldownMs,
      vaultPlan: ctx.prompt.vaultPlan,
    };
  }

  // 2. Near an affordance but misaligned inside the safety halo -> suppress.
  for (const a of ctx.affordances) {
    const [ex, ey, ez] = a.pos;
    if (Math.abs(ctx.player.y - ey) > SAME_TIER_Y) continue;
    const d = Math.hypot(ctx.player.x - ex, ctx.player.z - ez);
    if (d > (a.releaseRange ?? RELEASE_RANGE)) continue;
    if (!alignmentValid(a, ctx.player, d, false)) {
      return { kind: "SUPPRESS", reason: "near-misaligned" };
    }
  }

  return { kind: "NONE", reason: "no-affordance" };
}
