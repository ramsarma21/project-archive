import {
  TRAVERSAL_BINDINGS,
  TRAVERSAL_LEGEND,
  type TraversalBinding,
} from "@pa/engine-world";

// ---------------------------------------------------------------------------
// Mission input.
//
// A mutable object the render loop reads, not React state: a key press must not
// cost a re-render of the whole container, and the simulation reads input inside
// the frame it is stepping.
//
// Intent is camera-relative and is resolved into world space inside the canvas,
// where the camera actually is. Keeping the raw axes here means the binding layer
// never needs to know which way the camera is pointing.
//
// NO KEY CODE IS WRITTEN TWICE. Every code this file listens for comes out of
// `MISSION_BINDINGS`, and the on-screen legend is generated from the same table,
// so the footer of the HUD cannot drift from what the handler actually bound.
// That is not tidiness — the dash spent a whole build bound to nothing because
// the key and the legend were two separate lists and neither one was wrong.
// ---------------------------------------------------------------------------

/**
 * The traversal table, plus the one verb the mission container owns.
 *
 * @pa/engine-world publishes the six keys the movement system knows about. The
 * strike is not one of them: the beat is the container's, and the engine has no
 * business naming a key for a mechanic it does not run. F is the interact key
 * this repo already reserves for object-bound work — see the header of
 * playerInput.ts — so it needs no new corner of the keyboard.
 */
export const MISSION_BINDINGS = {
  ...TRAVERSAL_BINDINGS,
  strike: {
    codes: ["KeyF"],
    kind: "PRESS",
    label: "F",
    does: "Strike — in rhythm, at the work. A stroke off the beat is heard",
  },
} as const satisfies Record<string, TraversalBinding>;

export type MissionAction = keyof typeof MISSION_BINDINGS;

/**
 * The legend, in teaching order, with the strike appended.
 *
 * The engine's own ordering is kept — it puts what a player needs first, first —
 * and the strike goes last because it is the only entry that is not always
 * available: it does nothing until the player is standing at the work.
 */
export const MISSION_LEGEND: readonly { keys: string; does: string }[] = [
  ...TRAVERSAL_LEGEND,
  { keys: MISSION_BINDINGS.strike.label, does: MISSION_BINDINGS.strike.does },
];

export interface MissionInputState {
  /** +1 away from the camera, -1 toward it. */
  forward: number;
  /** +1 to the camera's right. */
  right: number;
  sprintHeld: boolean;
  crouchHeld: boolean;
  /** Latched by a press, cleared by the tick that consumes it. */
  jumpBuffered: boolean;
  /**
   * Latched by a press, cleared by the tick that consumes it.
   *
   * The burst is the one traversal verb the geometry never asks for, so it is
   * the one that has to be pressed. `stepFlow` decides whether it is legal —
   * grounded, off cooldown, not aimed over a lip it cannot land past — and this
   * only owns the press.
   */
  dashBuffered: boolean;
  /**
   * Latched by a press, cleared by the tick that consumes it.
   *
   * EDGE TRIGGERED, and the latch is why: `keydown` repeats while a key is held,
   * and a strike delivered on every repeat — or on every fixed step of a long
   * frame — would read to the beat's judge as a burst of swings at nothing.
   */
  strikeBuffered: boolean;
  /**
   * Latched by a throw press, cleared once the throw is issued or refused.
   *
   * The aim point is resolved inside the canvas, where the camera is: a throw is
   * aimed where the player is looking, and the distance is clamped to the tuned
   * range. Throwing short is a mistake the player is allowed to make — that, and
   * a body being able to block the object, is the whole of what makes aiming a
   * skill instead of a button.
   */
  throwBuffered: boolean;
}

export function createMissionInputState(): MissionInputState {
  return {
    forward: 0,
    right: 0,
    sprintHeld: false,
    crouchHeld: false,
    jumpBuffered: false,
    dashBuffered: false,
    strikeBuffered: false,
    throwBuffered: false,
  };
}

export function clearMissionInput(state: MissionInputState): void {
  state.forward = 0;
  state.right = 0;
  state.sprintHeld = false;
  state.crouchHeld = false;
  state.jumpBuffered = false;
  state.dashBuffered = false;
  state.strikeBuffered = false;
  state.throwBuffered = false;
}

const codesOf = (action: MissionAction): ReadonlySet<string> =>
  new Set(MISSION_BINDINGS[action].codes);

const FORWARD_KEYS = codesOf("moveForward");
const BACK_KEYS = codesOf("moveBack");
const LEFT_KEYS = codesOf("moveLeft");
const RIGHT_KEYS = codesOf("moveRight");
const SPRINT_KEYS = codesOf("sprint");
const CROUCH_KEYS = codesOf("crouch");

type LatchField =
  | "jumpBuffered"
  | "dashBuffered"
  | "strikeBuffered"
  | "throwBuffered";

/** Which latch a one-shot press sets. Held actions are not in here. */
const LATCHES: ReadonlyArray<{
  readonly codes: ReadonlySet<string>;
  readonly field: LatchField;
}> = (
  [
    ["jump", "jumpBuffered"],
    ["dash", "dashBuffered"],
    ["strike", "strikeBuffered"],
    ["throw", "throwBuffered"],
  ] as ReadonlyArray<[MissionAction, LatchField]>
).map(([action, field]) => ({ codes: codesOf(action), field }));

/**
 * Binds the keyboard and returns the unbind.
 *
 * Three behaviours worth naming. Modified chords are ignored, so browser
 * shortcuts keep working during a run. Auto-repeat is dropped, so leaning on a
 * key latches exactly one press — which the beat needs and the jump has always
 * wanted. And losing focus clears every axis: a tab switch mid-sprint must not
 * leave the player running into a patrol while the page is in the background.
 */
export function attachMissionInput(
  state: MissionInputState,
  target: Window = window,
): () => void {
  const held = new Set<string>();

  function recompute(): void {
    let forward = 0;
    let right = 0;
    for (const code of held) {
      if (FORWARD_KEYS.has(code)) forward += 1;
      else if (BACK_KEYS.has(code)) forward -= 1;
      else if (RIGHT_KEYS.has(code)) right += 1;
      else if (LEFT_KEYS.has(code)) right -= 1;
    }
    state.forward = Math.max(-1, Math.min(1, forward));
    state.right = Math.max(-1, Math.min(1, right));
    state.sprintHeld = [...held].some((code) => SPRINT_KEYS.has(code));
    state.crouchHeld = [...held].some((code) => CROUCH_KEYS.has(code));
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // The browser's own auto-repeat. A held strike key would otherwise deliver a
    // press every 30ms, which the judge scores as a swing at nothing each time.
    if (event.repeat) return;
    for (const latch of LATCHES) {
      if (!latch.codes.has(event.code)) continue;
      event.preventDefault();
      state[latch.field] = true;
      return;
    }
    if (held.has(event.code)) return;
    held.add(event.code);
    recompute();
  }

  function onKeyUp(event: KeyboardEvent): void {
    held.delete(event.code);
    recompute();
  }

  function onBlur(): void {
    held.clear();
    clearMissionInput(state);
  }

  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);
  target.addEventListener("blur", onBlur);
  return () => {
    target.removeEventListener("keydown", onKeyDown);
    target.removeEventListener("keyup", onKeyUp);
    target.removeEventListener("blur", onBlur);
    held.clear();
    clearMissionInput(state);
  };
}
