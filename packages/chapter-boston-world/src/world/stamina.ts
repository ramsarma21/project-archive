// Pure chase/timed-dash stamina resource. Ordinary free roam never consults
// this system, preserving its unlimited Shift sprint contract.

export const STAMINA_MAX = 1;
// Feel-tuned 2026-07-22 (playtest: "he chases you too fast"): a full sprint
// lasts ~7s and recovers quickly at a jog, so a chase is won by managing
// bursts and breaking line of sight — not lost in the first four seconds.
export const STAMINA_SPRINT_DRAIN_PER_S = 0.14;
export const STAMINA_ACTION_DEBIT = 0.12;
export const STAMINA_REGEN_PER_S = 0.3;
export const EXHAUSTED_JOG_SPEED = 3.5;
// Exhausted traversal stays available (required routes cannot dead-end), but
// takes long enough for the pursuer to gain meaningful ground.
export const EXHAUSTED_TRAVERSAL_DURATION_MULTIPLIER = 1.35;

export type StaminaAssist = "STANDARD" | "SLOW_PURSUER" | "AUTO_STAMINA" | "CONFIRM_RESOLVE";

export interface StaminaState {
  value: number;
}

export interface StaminaStepInput {
  dt: number;
  resourceActive: boolean;
  sprinting: boolean;
  moving: boolean;
  actionActive: boolean;
  assist: StaminaAssist;
}

export interface StaminaActionResult {
  state: StaminaState;
  accepted: boolean;
  debited: boolean;
  durationMultiplier: number;
}

export function clampStamina(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(STAMINA_MAX, value));
}

export function createStamina(value = STAMINA_MAX): StaminaState {
  return { value: clampStamina(value) };
}

export function stepStamina(
  state: StaminaState,
  input: StaminaStepInput,
): StaminaState {
  if (!input.resourceActive) return state;
  if (input.assist === "AUTO_STAMINA") return createStamina(STAMINA_MAX);
  const dt = Number.isFinite(input.dt) ? Math.max(0, input.dt) : 0;
  if (input.sprinting && input.moving && !input.actionActive) {
    return createStamina(state.value - STAMINA_SPRINT_DRAIN_PER_S * dt);
  }
  if (!input.actionActive) {
    return createStamina(state.value + STAMINA_REGEN_PER_S * dt);
  }
  return state;
}

// Called only after Player has accepted an authored traversal preflight.
// Rejected preflights never reach this function, so they never debit. At zero,
// traversal remains accepted with a deterministic slowdown rather than
// dead-ending an authored route.
export function acceptTraversalStamina(
  state: StaminaState,
  input: {
    resourceActive: boolean;
    debitEligible: boolean;
    assist: StaminaAssist;
  },
): StaminaActionResult {
  if (!input.resourceActive || !input.debitEligible || input.assist === "AUTO_STAMINA") {
    return {
      state: input.assist === "AUTO_STAMINA" && input.resourceActive
        ? createStamina(STAMINA_MAX)
        : state,
      accepted: true,
      debited: false,
      durationMultiplier: 1,
    };
  }
  if (state.value <= 0) {
    return {
      state,
      accepted: true,
      debited: false,
      durationMultiplier: EXHAUSTED_TRAVERSAL_DURATION_MULTIPLIER,
    };
  }
  return {
    state: createStamina(state.value - STAMINA_ACTION_DEBIT),
    accepted: true,
    debited: true,
    durationMultiplier: 1,
  };
}

export function staminaSprintSpeed(input: {
  resourceActive: boolean;
  shiftHeld: boolean;
  stamina: number;
  assist: StaminaAssist;
  runSpeed: number;
}): number {
  if (!input.shiftHeld) return input.runSpeed;
  if (!input.resourceActive || input.assist === "AUTO_STAMINA" || input.stamina > 0) {
    return input.runSpeed;
  }
  return EXHAUSTED_JOG_SPEED;
}
