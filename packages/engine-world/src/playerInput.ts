// Pure open-world input policy. Player owns Space/Shift/C/E; TraversalDirector
// owns object-bound F. Keeping this selection pure makes the explicit modifier
// contract testable without React or DOM events.
import { CROUCH_SPEED, RUN_SPEED, WALK_SPEED } from "./playerMotion.js";
import {
  staminaSprintSpeed,
  type StaminaAssist,
} from "./stamina.js";

// ---- the binding table -----------------------------------------------------
//
// ONE TABLE, AND IT IS THE ONE THE LEGEND IS DRAWN FROM.
//
// The traversal verb set is only half discoverable by design: vault, climb,
// mantle, slide, drop and the dive are read off the geometry, so there is
// nothing to learn and nothing to press. That leaves a short list of things the
// world cannot infer — move, run, crouch, jump, dash, throw — and for an
// eleven-year-old on a school Chromebook, six keys is the entire manual. It only
// works if the six are actually reachable and the on-screen legend cannot drift
// from what the key handler bound, which is why both read this.
//
// Every key sits under the left hand, around WASD, and nothing needs a chord.

export interface TraversalBinding {
  /** KeyboardEvent.code values, in priority order. */
  readonly codes: readonly string[];
  /** Held for as long as the effect lasts, versus latched by one press. */
  readonly kind: "HOLD" | "PRESS";
  /** Short label for an on-screen legend. */
  readonly label: string;
  /** What it does, in the player's words rather than the system's. */
  readonly does: string;
}

export const TRAVERSAL_BINDINGS = {
  moveForward: { codes: ["KeyW", "ArrowUp"], kind: "HOLD", label: "W", does: "Move" },
  moveBack: { codes: ["KeyS", "ArrowDown"], kind: "HOLD", label: "S", does: "Move" },
  moveLeft: { codes: ["KeyA", "ArrowLeft"], kind: "HOLD", label: "A", does: "Move" },
  moveRight: { codes: ["KeyD", "ArrowRight"], kind: "HOLD", label: "D", does: "Move" },
  sprint: {
    codes: ["ShiftLeft", "ShiftRight"],
    kind: "HOLD",
    label: "Shift",
    // The one line every player has to read. It is not a speed modifier: while
    // it is down the world will catch, vault, climb and dive FOR you, and while
    // it is up it will leave you alone. Both halves are load-bearing — see
    // SelectContext.sprintHeld — so both halves are said.
    does: "Hold to run AND to climb — the world only catches you while you hold it",
  },
  crouch: {
    codes: ["KeyC", "ControlLeft"],
    kind: "HOLD",
    label: "C",
    does: "Crouch — quieter, smaller, harder to see",
  },
  jump: {
    codes: ["Space"],
    kind: "PRESS",
    label: "Space",
    does: "Jump — and at a ledge, go anyway",
  },
  dash: {
    codes: ["KeyE"],
    kind: "PRESS",
    label: "E",
    does: "Dash — a short burst in the direction you are pushing",
  },
  throw: {
    codes: ["KeyQ"],
    kind: "PRESS",
    label: "Q",
    does: "Throw — pull a guard's eyes somewhere you are not",
  },
} as const satisfies Record<string, TraversalBinding>;

export type TraversalAction = keyof typeof TRAVERSAL_BINDINGS;

/** Which action a key code drives, or null. For a binding layer and its tests. */
export function traversalActionFor(code: string): TraversalAction | null {
  for (const action of Object.keys(TRAVERSAL_BINDINGS) as TraversalAction[]) {
    const binding: TraversalBinding = TRAVERSAL_BINDINGS[action];
    if (binding.codes.includes(code)) return action;
  }
  return null;
}

/**
 * The legend, in teaching order: what a player needs first comes first.
 *
 * Movement is one row rather than four, because "WASD" is a single thing every
 * player of this age already knows and spending four rows of a HUD on it pushes
 * the two verbs they do NOT know off the bottom.
 */
export const TRAVERSAL_LEGEND: readonly { keys: string; does: string }[] = [
  { keys: "WASD", does: "Move" },
  // The one entry with no row in the binding table above, because a mouse is
  // not a KeyboardEvent.code and inventing a fake one to satisfy the "drawn
  // from the table" rule would be the tidiness, not the point. It is listed
  // because it is the verb a player is most lost without: movement is relative
  // to where you are looking, so until you know the mouse turns you, half the
  // control scheme does not work. See playerLook.ts, which owns the look.
  { keys: "Mouse", does: "Look — and you move where you are looking" },
  { keys: TRAVERSAL_BINDINGS.sprint.label, does: TRAVERSAL_BINDINGS.sprint.does },
  { keys: TRAVERSAL_BINDINGS.jump.label, does: TRAVERSAL_BINDINGS.jump.does },
  { keys: TRAVERSAL_BINDINGS.dash.label, does: TRAVERSAL_BINDINGS.dash.does },
  { keys: TRAVERSAL_BINDINGS.crouch.label, does: TRAVERSAL_BINDINGS.crouch.does },
  { keys: TRAVERSAL_BINDINGS.throw.label, does: TRAVERSAL_BINDINGS.throw.does },
];

export const FREE_INPUT_BUFFER_MS = 120;
export const FREE_ACTION_COOLDOWN_MS = 200;
const RUN_JUMP_MIN_SPEED = 1.2;
const RUN_JUMP_FORWARD_DOT = 0.6;
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

export interface DashPressContext {
  nowMs: number;
  /** When the dash key went down, or null. */
  pressedAtMs: number | null;
  /** The key came up since the last dash was issued: one burst per press. */
  releasedSinceDash: boolean;
  enabled: boolean;
  uiFocused: boolean;
}

/**
 * Should a dash press be handed to the simulation this frame?
 *
 * Deliberately thin. Whether a burst is legal — grounded, not mid-verb, off
 * cooldown, not aimed over a ledge — is the flow controller's call and it makes
 * it every tick with the world in front of it. All this owns is the same press
 * hygiene the jump has: a stale press expires, a held key does not repeat, and a
 * focused text field is not a dash.
 *
 * The buffer window is the jump's, unchanged. Tolerances in this game are set
 * once, low, for a player with ordinary reflexes on a trackpad, and a second
 * verb is not a reason to set a second standard.
 */
export function resolveDashPress(ctx: DashPressContext): boolean {
  return (
    ctx.pressedAtMs !== null &&
    ctx.nowMs - ctx.pressedAtMs <= FREE_INPUT_BUFFER_MS &&
    ctx.releasedSinceDash &&
    ctx.enabled &&
    !ctx.uiFocused
  );
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
