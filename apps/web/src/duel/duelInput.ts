// Keyboard and pointer to CombatIntent.
//
// The intent shape is the engine's input policy, not a duel invention: sprint is
// Shift, crouch is C, jump is Space, and they mean the same thing here as in a
// mission. Aim is a world-space direction rather than a screen vector, because the
// core spawns a ball along it and a duel fought in one plane wants a pointer aim.
//
// Two of these are edge-latched rather than held. A dodge and a shot are decisions,
// and holding the button should not spend a round's whole magazine while the player
// is looking somewhere else. The core's fire interval and dodge cooldown would
// tolerate a held button; the design does not.
//
// A LATCH IS HELD UNTIL A SIMULATION TICK CONSUMES IT, WHICH IS NOT THE SAME AS
// UNTIL THE NEXT FRAME.
//
// The core runs at a fixed 60Hz and the renderer runs at the display's rate. On a
// 120Hz screen roughly every other frame buys no tick at all, so a latch cleared
// once per frame is a coin flip: about half of every click and every dodge would be
// built into an intent, handed to a reducer that advances nothing, and then thrown
// away unfired. Nothing errors, no test fails, and the mode simply feels like it
// ignores you — which is indistinguishable from broken controls.
//
// So reading the intent no longer clears anything. `peekIntent` is pure, and the
// driver calls `settle` with the tick count the core actually advanced; only a tick
// clears a press. Passing the same latched press to several ticks inside one frame
// is safe because the core gates repeats on `fireReadyAtTick` and the dodge
// cooldown, so a held latch can never spend two balls.
//
// The buffer is bounded because a press must not survive forever. QUESTION_PENDING
// advances no ticks by design, and a click that lands there would otherwise be
// banked and fired the instant the engagement resumes — a shot the player made
// seconds ago, at whatever they happen to be pointing at now.

import type { CombatIntent } from "@pa/duel";

export interface MoveKeys {
  readonly forward: boolean;
  readonly back: boolean;
  readonly left: boolean;
  readonly right: boolean;
}

/** Player-facing control list, so the HUD and the docs cannot drift apart. */
export const DUEL_CONTROLS: readonly { keys: string; action: string }[] = [
  { keys: "W A S D", action: "move" },
  { keys: "Shift", action: "run" },
  { keys: "C", action: "crouch" },
  { keys: "Space", action: "jump" },
  { keys: "Mouse", action: "aim" },
  { keys: "Click", action: "fire" },
  { keys: "Right-click / Q", action: "dodge roll" },
];

/**
 * The ability key, added only when the player actually holds an ability.
 *
 * ABILITIES ARE ON HOLD AND THIS IS THE WHOLE OF THE SEAM. The owner has not
 * settled the set, so nothing here knows any ability's name, cost, cooldown or
 * animation — the latch below carries whatever id the loadout supplies and hands
 * it to the core untouched. Dropping one in later is a loadout entry plus a clip,
 * and no change to the input path. Advertising the key with an empty loadout would
 * be worse than not advertising it, so the hint is gated rather than greyed.
 */
export function duelControls(
  abilityCount: number,
): readonly { keys: string; action: string }[] {
  if (abilityCount <= 0) return DUEL_CONTROLS;
  return [...DUEL_CONTROLS, { keys: "1", action: "ability" }];
}

/**
 * Camera-relative movement. Forward is the direction the camera looks in the
 * ground plane, so W always means "away from me" however the fight has rotated.
 */
export function moveVector(
  keys: MoveKeys,
  cameraYaw: number,
): { x: number; z: number } {
  const forwardX = Math.sin(cameraYaw);
  const forwardZ = Math.cos(cameraYaw);
  // Right-handed: facing +Z with +Y up puts the right hand on -X.
  const rightX = -Math.cos(cameraYaw);
  const rightZ = Math.sin(cameraYaw);
  const forward = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0);
  const strafe = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const x = forwardX * forward + rightX * strafe;
  const z = forwardZ * forward + rightZ * strafe;
  const length = Math.hypot(x, z);
  if (length < 1e-6) return { x: 0, z: 0 };
  return { x: x / length, z: z / length };
}

export interface IntentInput {
  readonly move: MoveKeys;
  readonly cameraYaw: number;
  readonly sprint: boolean;
  readonly crouch: boolean;
  readonly jump: boolean;
  readonly dodge: boolean;
  readonly fire: boolean;
  readonly aimX: number;
  readonly aimZ: number;
  readonly abilityId: string | null;
}

export function intentFrom(input: IntentInput): CombatIntent {
  const move = moveVector(input.move, input.cameraYaw);
  const aimLength = Math.hypot(input.aimX, input.aimZ);
  return {
    moveX: move.x,
    moveZ: move.z,
    sprint: input.sprint,
    crouch: input.crouch,
    jump: input.jump,
    dodge: input.dodge,
    fire: input.fire,
    aimX: aimLength > 1e-6 ? input.aimX / aimLength : 0,
    aimZ: aimLength > 1e-6 ? input.aimZ / aimLength : 0,
    abilityId: input.abilityId,
  };
}

const MOVE_CODES = {
  forward: ["KeyW", "ArrowUp"],
  back: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
} as const;

/**
 * How many consecutive tickless frames a latched press survives.
 *
 * Only a paused clock can reach this — at 120Hz a press waits one frame — so it is
 * a safety bound rather than a tuning value. Six frames is a twentieth of a second
 * at 120Hz and a tenth at 60: long enough that no display rate drops an input,
 * short enough that nothing is banked across a phase the player is reading.
 */
export const LATCH_BUFFER_FRAMES = 6;

export interface DuelInputController {
  /** Wire up listeners. Returns the detach function. */
  attach(): () => void;
  setAim(x: number, z: number): void;
  setCameraYaw(yaw: number): void;
  /**
   * This frame's intent. PURE — latched presses stay latched until `settle` is told
   * a tick consumed them.
   */
  peekIntent(): CombatIntent;
  /**
   * Report what the core did with the intent. A press is cleared when a tick
   * consumed it, or dropped once the buffer above runs out.
   */
  settle(ticksAdvanced: number): void;
  /** Suspend input while a question is open, without losing the crouch stance. */
  setEnabled(enabled: boolean): void;
  crouched(): boolean;
  /** Presses currently waiting for a tick. For tests and diagnostics. */
  pending(): { fire: boolean; dodge: boolean; ability: string | null };
  /**
   * @deprecated Read-and-clear in one call, which drops a press on any frame that
   * advanced no tick. Retained because `src/pvp` drives this controller and is
   * another agent's live file; it is exactly `peekIntent` followed by an
   * unconditional `settle`, so it behaves as it always did rather than changing
   * under that caller. Prefer peek/advance/settle — see the note at the top.
   */
  takeIntent(): CombatIntent;
}

export function createDuelInput(options: {
  /** Abilities the player actually holds; index 0 is bound to "1". */
  abilityIds?: readonly string[];
  /** The element that owns pointer buttons. Defaults to the window. */
  target?: HTMLElement | Window;
} = {}): DuelInputController {
  const held = new Set<string>();
  let crouch = false;
  let dodgeLatch = false;
  let fireLatch = false;
  let abilityLatch: string | null = null;
  let aimX = 0;
  let aimZ = 1;
  let cameraYaw = 0;
  let enabled = true;
  let framesLatched = 0;

  const abilityIds = options.abilityIds ?? [];

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!enabled) return;
    if (event.repeat) {
      held.add(event.code);
      return;
    }
    held.add(event.code);
    if (event.code === "KeyC") crouch = !crouch;
    if (event.code === "KeyQ") dodgeLatch = true;
    if (event.code === "Digit1" && abilityIds[0]) abilityLatch = abilityIds[0];
    if (event.code === "Space") event.preventDefault();
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    held.delete(event.code);
  };
  const onPointerDown = (event: MouseEvent): void => {
    if (!enabled) return;
    if (event.button === 0) fireLatch = true;
    if (event.button === 2) dodgeLatch = true;
  };
  const onContextMenu = (event: Event): void => event.preventDefault();
  const onBlur = (): void => {
    held.clear();
    dodgeLatch = false;
    fireLatch = false;
  };

  return {
    attach(): () => void {
      const target = options.target ?? window;
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      target.addEventListener("mousedown", onPointerDown as EventListener);
      target.addEventListener("contextmenu", onContextMenu);
      window.addEventListener("blur", onBlur);
      return () => {
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        target.removeEventListener("mousedown", onPointerDown as EventListener);
        target.removeEventListener("contextmenu", onContextMenu);
        window.removeEventListener("blur", onBlur);
      };
    },
    setAim(x: number, z: number): void {
      aimX = x;
      aimZ = z;
    },
    setCameraYaw(yaw: number): void {
      cameraYaw = yaw;
    },
    setEnabled(value: boolean): void {
      enabled = value;
      if (!value) {
        held.clear();
        dodgeLatch = false;
        fireLatch = false;
        abilityLatch = null;
        framesLatched = 0;
      }
    },
    crouched: () => crouch,
    pending: () => ({ fire: fireLatch, dodge: dodgeLatch, ability: abilityLatch }),
    peekIntent(): CombatIntent {
      const has = (codes: readonly string[]): boolean =>
        enabled && codes.some((code) => held.has(code));
      return intentFrom({
        move: {
          forward: has(MOVE_CODES.forward),
          back: has(MOVE_CODES.back),
          left: has(MOVE_CODES.left),
          right: has(MOVE_CODES.right),
        },
        cameraYaw,
        sprint: has(["ShiftLeft", "ShiftRight"]),
        crouch: enabled && crouch,
        jump: has(["Space"]),
        dodge: dodgeLatch,
        fire: fireLatch,
        aimX,
        aimZ,
        abilityId: abilityLatch,
      });
    },
    takeIntent(): CombatIntent {
      const intent = this.peekIntent();
      dodgeLatch = false;
      fireLatch = false;
      abilityLatch = null;
      framesLatched = 0;
      return intent;
    },
    settle(ticksAdvanced: number): void {
      const latched = dodgeLatch || fireLatch || abilityLatch !== null;
      if (!latched) {
        framesLatched = 0;
        return;
      }
      // A tick ran, so the press reached the reducer and is spent whether or not the
      // core chose to act on it — a shot refused for reload is a refusal the player
      // must see as a cooldown, not one we silently retry on the next frame.
      if (ticksAdvanced > 0) {
        dodgeLatch = false;
        fireLatch = false;
        abilityLatch = null;
        framesLatched = 0;
        return;
      }
      framesLatched += 1;
      if (framesLatched >= LATCH_BUFFER_FRAMES) {
        dodgeLatch = false;
        fireLatch = false;
        abilityLatch = null;
        framesLatched = 0;
      }
    },
  };
}
