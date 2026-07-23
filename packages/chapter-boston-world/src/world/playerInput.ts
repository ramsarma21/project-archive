// Pure open-world input policy. Player owns Space/Shift/C; TraversalDirector
// owns object-bound F. Keeping this selection pure makes the explicit modifier
// contract testable without React or DOM events.
import { CROUCH_SPEED, RUN_SPEED, WALK_SPEED } from "./playerMotion.js";
import {
  staminaSprintSpeed,
  type StaminaAssist,
} from "./stamina.js";

export const FREE_INPUT_BUFFER_MS = 120;
export const FREE_ACTION_COOLDOWN_MS = 200;
export const RUN_JUMP_MIN_SPEED = 1.2;
export const RUN_JUMP_FORWARD_DOT = 0.6;
export const FREE_JUMP_COYOTE_MS = 100;

export type FreeJumpDecision = "NONE" | "STANDING_JUMP" | "RUNNING_JUMP";

export interface FreeJumpContext {
  nowMs: number;
  pressedAtMs: number | null;
  releasedSinceAction: boolean;
  cooldownUntilMs: number;
  enabled: boolean;
  uiFocused: boolean;
  actionActive: boolean;
  grounded: boolean;
  falling: boolean;
  airtimeMs: number;
  shiftHeld: boolean;
  forwardInput: boolean;
  crouched: boolean;
  speed: number;
  velX: number;
  velZ: number;
  facingX: number;
  facingZ: number;
}

export function resolveFreeJump(ctx: FreeJumpContext): FreeJumpDecision {
  if (
    ctx.pressedAtMs === null ||
    ctx.nowMs - ctx.pressedAtMs > FREE_INPUT_BUFFER_MS ||
    !ctx.releasedSinceAction ||
    ctx.nowMs < ctx.cooldownUntilMs ||
    !ctx.enabled ||
    ctx.uiFocused ||
    ctx.actionActive ||
    ctx.crouched
  ) {
    return "NONE";
  }
  const canJump =
    ctx.grounded || (ctx.falling && ctx.airtimeMs <= FREE_JUMP_COYOTE_MS);
  if (!canJump) return "NONE";

  // Running jump is an explicit modifier contract, not a speed inference:
  // Shift must still be held, forward input must be active, and the body must
  // actually have reached a forward-moving sprint state.
  const forwardDot =
    ctx.speed > 1e-3
      ? (ctx.velX * ctx.facingX + ctx.velZ * ctx.facingZ) / ctx.speed
      : 0;
  if (
    ctx.shiftHeld &&
    ctx.forwardInput &&
    ctx.speed >= RUN_JUMP_MIN_SPEED &&
    forwardDot >= RUN_JUMP_FORWARD_DOT
  ) {
    return "RUNNING_JUMP";
  }
  return "STANDING_JUMP";
}

export function freeMoveSpeed(input: {
  shiftHeld: boolean;
  moving: boolean;
  crouched: boolean;
  actionActive: boolean;
  resourceActive?: boolean;
  stamina?: number;
  staminaAssist?: StaminaAssist;
}): number {
  if (!input.moving || input.actionActive) return 0;
  if (input.crouched) return CROUCH_SPEED;
  if (!input.shiftHeld) return WALK_SPEED;
  return staminaSprintSpeed({
    resourceActive: input.resourceActive ?? false,
    shiftHeld: true,
    stamina: input.stamina ?? 1,
    assist: input.staminaAssist ?? "STANDARD",
    runSpeed: RUN_SPEED,
  });
}

export function freeLocomotionClip(input: {
  speed: number;
  shiftHeld: boolean;
  moving: boolean;
  crouched: boolean;
  actionActive: boolean;
}): "idle" | "walk" | "run" {
  if (input.speed < 0.16) return "idle";
  return input.shiftHeld && input.moving && !input.crouched && !input.actionActive
    ? "run"
    : "walk";
}
