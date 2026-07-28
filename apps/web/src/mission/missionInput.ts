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
    label: "F / Click",
    does: "Strike the lit flare at the work. A fumble is heard",
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
   * The panel cell the player struck for the precision beat, or null. Latched
   * by a click or a key press and cleared by the tick that consumes it.
   *
   * EDGE TRIGGERED for the same reason a jump is: a value delivered on every
   * fixed step of a long frame would read to the beat as a run of strays. This
   * is written by the whack-a-mole panel — which knows the lit cell for the
   * keyboard path and the clicked cell for the pointer path — rather than by the
   * key handler here, because the key handler cannot know which cell is lit.
   */
  beatHitCell: number | null;
  /**
   * True while the throw key is HELD. This is the aiming state.
   *
   * The verb is hold-to-aim, release-to-throw, because the object cannot miss in
   * a way the player can learn from unless they can see where it will land before
   * they commit — three charges is far too few to learn a lottery. While this is
   * true the canvas solves `previewThrow` from the live look and draws the arc and
   * the landing ring; the aim point is resolved inside the canvas, where the
   * camera is, and the distance is clamped to the tuned range.
   */
  throwAiming: boolean;
  /**
   * Latched by RELEASING the throw key while aiming; cleared once the throw is
   * issued or refused. Release, not press, is what throws — so the preview the
   * player was reading is the throw they get.
   */
  throwReleased: boolean;
}

export function createMissionInputState(): MissionInputState {
  return {
    forward: 0,
    right: 0,
    sprintHeld: false,
    crouchHeld: false,
    jumpBuffered: false,
    dashBuffered: false,
    beatHitCell: null,
    throwAiming: false,
    throwReleased: false,
  };
}

export function clearMissionInput(state: MissionInputState): void {
  state.forward = 0;
  state.right = 0;
  state.sprintHeld = false;
  state.crouchHeld = false;
  state.jumpBuffered = false;
  state.dashBuffered = false;
  state.beatHitCell = null;
  state.throwAiming = false;
  state.throwReleased = false;
}

const codesOf = (action: MissionAction): ReadonlySet<string> =>
  new Set(MISSION_BINDINGS[action].codes);

/**
 * Whether a key event is being typed into a control rather than played into the
 * game. A run has no text fields, but a debug overlay or a name prompt might, and
 * a throw key pressed while typing must not aim a bottle. Read off the event
 * target so it needs no document, and so it is testable without a DOM.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as
    | { readonly tagName?: string; readonly isContentEditable?: boolean }
    | null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

const FORWARD_KEYS = codesOf("moveForward");
const BACK_KEYS = codesOf("moveBack");
const LEFT_KEYS = codesOf("moveLeft");
const RIGHT_KEYS = codesOf("moveRight");
const SPRINT_KEYS = codesOf("sprint");
const CROUCH_KEYS = codesOf("crouch");
// The throw is neither a movement key nor a one-shot latch: it is held to aim
// and released to throw, handled on its own in the key events below.
const THROW_KEYS = codesOf("throw");

type LatchField = "jumpBuffered" | "dashBuffered";

/**
 * Which latch a one-shot press sets. Held actions are not in here, and neither
 * is the beat strike: it is a cell, not a boolean, and the panel owns it because
 * only the panel knows which cell is lit. See `MissionInputState.beatHitCell`.
 */
const LATCHES: ReadonlyArray<{
  readonly codes: ReadonlySet<string>;
  readonly field: LatchField;
}> = (
  [
    ["jump", "jumpBuffered"],
    ["dash", "dashBuffered"],
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
    // Typing into a control is not a game input. Ignoring it here means a throw
    // key pressed in a field never opens an aim, and no charge can be spent from
    // one.
    if (isEditableTarget(event.target)) return;
    // The browser's own auto-repeat. A held strike key would otherwise deliver a
    // press every 30ms, which the judge scores as a swing at nothing each time.
    if (event.repeat) return;
    // The throw is held to aim. The keydown only opens the aim; the throw itself
    // is issued on keyup, so the arc the player read is the throw they get.
    if (THROW_KEYS.has(event.code)) {
      event.preventDefault();
      state.throwAiming = true;
      return;
    }
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
    if (isEditableTarget(event.target)) {
      // Focus moved into a field between the press and the release, so the keyup
      // lands on the control, not the game. It must NOT throw — and it must not
      // leave the aim latched on for a release that will never arrive here. Drop
      // the aim and any pending release so no throw fires and no charge is spent.
      if (THROW_KEYS.has(event.code)) {
        state.throwAiming = false;
        state.throwReleased = false;
      }
      return;
    }
    if (THROW_KEYS.has(event.code)) {
      // Releasing while aiming is the throw. If the aim was never opened (the
      // key came up without our keydown, e.g. focus changed mid-press) nothing
      // is issued.
      if (state.throwAiming) state.throwReleased = true;
      state.throwAiming = false;
      return;
    }
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
