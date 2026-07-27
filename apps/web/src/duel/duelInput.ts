// Keyboard and pointer to CombatIntent.
//
// The intent shape is the engine's input policy, not a duel invention: sprint is
// Shift, crouch is C, jump is Space, and they mean the same thing here as in a
// mission. Aim is a world-space direction rather than a screen vector, because the
// core spawns a ball along it and a duel fought in one plane wants a pointer aim.
//
// Two of these are EDGE decisions rather than held. A dodge and a shot are choices,
// and holding the button must not spend a round's whole magazine. Each edge press is
// stored as a bounded {id, timestamp} in a queue, and there are two ways it is
// cleared:
//
//   BOSS DUEL (local clock) — `peekIntent` samples the queue and `settle(ticks)`
//   clears the sampled press ONLY when a simulation tick actually consumed it. A
//   tickless frame clears nothing, so a 120Hz display cannot drop a click into a
//   frame that advanced no tick.
//
//   PVP (server clock) — `sampleIntent` returns the intent AND a RECEIPT naming the
//   press ids it carried; the transport calls `acknowledge(receipt)` only when the
//   authority ACCEPTED the frame. A refused or unreachable frame clears nothing, so
//   the press rides the next poll; and because a receipt names only the ids it
//   carried, an old response can never clear a press made after it was sent.
//
// A press cannot live forever: it expires after `EDGE_INTENT_MAX_AGE_MS` (measured on
// the injected clock, not in frames), and a question/lifecycle transition cancels the
// whole queue at once, so nothing a player pressed seconds ago fires when play
// resumes. `EDGE_INTENT_MAX_AGE_MS` replaces the old frame-count buffer, which was a
// display-rate quantity masquerading as a time.

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
 * How long an unacknowledged edge press lives, in milliseconds on the injected clock.
 *
 * This REPLACES the old frame-count buffer, which measured a duration in display
 * frames — a quantity that meant a fifth of a second at 120Hz and a tenth at 60. A
 * press that is never delivered (a paused clock, a network that never answers) is
 * dropped after this, so nothing a player pressed a second ago fires when play
 * resumes, on any display or any connection.
 */
export const EDGE_INTENT_MAX_AGE_MS = 1000;

/** Fallback (unlocked-drag) click discrimination: a fire is a short, still press. */
const CLICK_MAX_TRAVEL_PX = 6;
const CLICK_MAX_MS = 250;
/** A queue cannot grow without bound while no poll lands to acknowledge it. */
const EDGE_QUEUE_MAX = 32;

type EdgeKind = "fire" | "dodge" | "ability";
interface EdgePress {
  readonly id: number;
  readonly ts: number;
  readonly kind: EdgeKind;
  readonly abilityId?: string;
}

/** An intent and the exact edge ids it carried, so an ack can clear only those. */
export interface EdgeSample {
  readonly intent: CombatIntent;
  readonly receipt: readonly number[];
}

/**
 * Is this event target a control that must never emit gameplay? A HUD button, a
 * form field, or anything contenteditable. Structural, so a control drawn over the
 * canvas is caught by `closest` as well as by its own tag.
 */
export function isControlTarget(target: unknown): boolean {
  const el = target as
    | { tagName?: string; isContentEditable?: boolean; closest?: (s: string) => unknown }
    | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") {
    return true;
  }
  if (el.isContentEditable) return true;
  if (
    typeof el.closest === "function" &&
    el.closest('input, textarea, select, button, [contenteditable="true"]')
  ) {
    return true;
  }
  return false;
}

export interface DuelInputController {
  /** Wire up listeners on a pointer target (a canvas in PvP). Returns the detach. */
  attach(pointerTarget?: HTMLElement | Window): () => void;
  setAim(x: number, z: number): void;
  setCameraYaw(yaw: number): void;
  /**
   * PvP: this poll's intent AND the edge ids it carried. Clears nothing — the
   * transport calls `acknowledge` with the receipt only when the frame was accepted.
   */
  sampleIntent(nowMs?: number): EdgeSample;
  /** PvP: clear exactly the edge ids an accepted frame carried, and nothing else. */
  acknowledge(receipt: readonly number[]): void;
  /**
   * Boss duel: this frame's intent. PURE — edges stay until `settle` is told a tick
   * consumed them.
   */
  peekIntent(): CombatIntent;
  /**
   * Boss duel: clear the last sampled edges ONLY when a tick actually consumed them.
   * A tickless frame clears nothing; age expiry is the backstop.
   */
  settle(ticksAdvanced: number): void;
  /** Suspend input (a question). Clears held movement and every edge; keeps crouch. */
  setEnabled(enabled: boolean): void;
  /** Cancel held movement and every edge at once — a match change or lifecycle loss. */
  cancel(): void;
  crouched(): boolean;
  /** Presses currently queued. For tests and diagnostics. */
  pending(): { fire: boolean; dodge: boolean; ability: string | null };
  /** @deprecated Read-and-clear in one call. Prefer sample/acknowledge or peek/settle. */
  takeIntent(): CombatIntent;
}

export function createDuelInput(options: {
  /** Abilities the player actually holds; index 0 is bound to "1". */
  abilityIds?: readonly string[];
  /** The element that owns pointer buttons. Defaults to the window. */
  target?: HTMLElement | Window;
  /**
   * "pvp" makes the canvas the exclusive owner of pointer gameplay and adds the
   * capture/fire semantics; "boss" (the default) preserves the mission duel's
   * behaviour exactly — a primary click fires, a right click dodges.
   */
  mode?: "boss" | "pvp";
  /** Injected clock, so edge age is testable without waiting a real second. */
  now?: () => number;
} = {}): DuelInputController {
  const abilityIds = options.abilityIds ?? [];
  const mode = options.mode ?? "boss";
  const clock = options.now ?? ((): number => Date.now());

  const held = new Set<string>();
  let crouch = false;
  let aimX = 0;
  let aimZ = 1;
  let cameraYaw = 0;
  let enabled = true;

  let edges: EdgePress[] = [];
  let nextId = 1;
  let lastReceipt: readonly number[] = [];

  // SHORT-TAP LATCH FOR CONTINUOUS KEYS.
  //
  // Movement/sprint/jump are LATEST-STATE: sampled once per tick/poll from `held`,
  // never a queue of every OS `keydown` repeat (repeats only re-touch the set). That
  // alone is correct while a key is held, but it silently drops a TAP shorter than the
  // sampling interval — and the network sample runs at the poll cadence (~11Hz / 90ms),
  // so a quick W/A/S/D tap whose down AND up both fall between two polls is never seen
  // as held at any sample and is lost. Rapidly spamming movement then reads as a laggy,
  // unresponsive fighter.
  //
  // The fix mirrors the edge latch WITHOUT turning movement into a queue: a continuous
  // key that saw a keydown since the last CONSUMED sample is represented for exactly one
  // delivered sample. `tapped` maps a code to the wall time it was pressed; it is
  // cleared on the same signal that clears an edge — a receipt acknowledged (PVP) or a
  // tick that consumed the frame (boss) — and only for the codes the acknowledged frame
  // actually sampled, so a press made after sampling can never be cleared by an older
  // ack. A never-consumed tap expires by age like an edge, so nothing stale is replayed.
  const tapped = new Map<string, number>();
  let lastSampledTaps: Array<[string, number]> = [];

  // PvP pointer state.
  let pointerCanvas: HTMLElement | null = null;
  let captureEstablished = false;
  let fallbackDown = false;
  let downAt = 0;
  let downTravel = 0;

  const isLocked = (): boolean =>
    pointerCanvas != null &&
    pointerCanvas.ownerDocument.pointerLockElement === pointerCanvas;

  const expire = (nowMs: number): void => {
    if (edges.length === 0) return;
    edges = edges.filter((edge) => nowMs - edge.ts <= EDGE_INTENT_MAX_AGE_MS);
  };

  const expireTaps = (nowMs: number): void => {
    if (tapped.size === 0) return;
    for (const [code, ts] of tapped) {
      // A still-held key is kept regardless of age: `held` is its real state and the
      // tap entry is only redundant. A released tap that no consume ever reached is
      // dropped once stale, so no movement a player made a second ago replays.
      if (!held.has(code) && nowMs - ts > EDGE_INTENT_MAX_AGE_MS) tapped.delete(code);
    }
  };

  /**
   * Clear the tap latch for exactly the codes an acknowledged/consumed frame sampled.
   * A still-held code stays represented by `held` from here on, so its latch is spent
   * too — dropping it is what stops a held-then-released key from leaving a one-sample
   * overshoot after the key is up. Matching the sampled timestamp makes this race-safe:
   * a NEWER tap of the same code (a fresh keydown after the sample) carries a different
   * timestamp and is preserved for its own frame.
   */
  const consumeTaps = (): void => {
    for (const [code, ts] of lastSampledTaps) {
      if (tapped.get(code) === ts) tapped.delete(code);
    }
    lastSampledTaps = [];
  };

  const pushEdge = (kind: EdgeKind, abilityId?: string): void => {
    if (!enabled) return;
    edges.push({ id: nextId++, ts: clock(), kind, ...(abilityId ? { abilityId } : {}) });
    if (edges.length > EDGE_QUEUE_MAX) edges = edges.slice(edges.length - EDGE_QUEUE_MAX);
  };

  const clearEdges = (): void => {
    edges = [];
    lastReceipt = [];
    // A lifecycle loss clears held movement too (see the callers); the tap latch is the
    // transient half of that state and must go with it, or a tap made just before a
    // blur/question survives to move the fighter when play resumes.
    tapped.clear();
    lastSampledTaps = [];
  };

  const resetPointer = (): void => {
    captureEstablished = false;
    fallbackDown = false;
  };

  const sample = (nowMs: number): EdgeSample => {
    expire(nowMs);
    expireTaps(nowMs);
    // A continuous key counts if it is held now OR was tapped since the last consume:
    // a tap fully between two samples is thereby represented at least once, then cleared
    // when the frame is consumed. Opposite keys still resolve deterministically because
    // `moveVector` subtracts one axis from the other.
    const has = (codes: readonly string[]): boolean =>
      enabled && codes.some((code) => held.has(code) || tapped.has(code));
    // Snapshot which taps this sample carried, so a later acknowledge/settle clears
    // exactly these and never a tap made after the sample.
    lastSampledTaps = [...tapped];
    // ONE EDGE PER BOOLEAN PER FRAME. The intent is a boolean protocol — `fire`,
    // `dodge`, `abilityId` — so a single submitted frame can represent at most one
    // press of each kind. The receipt must therefore name ONLY the queue head each
    // true boolean actually carried; the rest of the queue stays for later polls. The
    // old version put every queued id of a kind in the receipt while the boolean spoke
    // for one, so acknowledging a frame that delivered a single fire cleared several
    // presses at once — two rapid fires collapsed into one accepted server edge, and
    // the second was silently dropped rather than riding the next poll.
    const fireHead = edges.find((e) => e.kind === "fire");
    const dodgeHead = edges.find((e) => e.kind === "dodge");
    const abilityHead = edges.find((e) => e.kind === "ability");
    const receipt = [
      ...(fireHead ? [fireHead.id] : []),
      ...(dodgeHead ? [dodgeHead.id] : []),
      ...(abilityHead ? [abilityHead.id] : []),
    ];
    const intent = intentFrom({
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
      dodge: dodgeHead !== undefined,
      fire: fireHead !== undefined,
      aimX,
      aimZ,
      abilityId: abilityHead?.abilityId ?? null,
    });
    return { intent, receipt };
  };

  const acknowledge = (receipt: readonly number[]): void => {
    // An accepted frame consumes its movement taps EVEN WHEN it carried no edge — a
    // frame that moved but did not fire still has an empty receipt, and leaving the tap
    // latched would replay that movement on the next poll. So the tap consume runs first,
    // unconditionally, and only the edge clear is gated on a non-empty receipt.
    consumeTaps();
    if (receipt.length === 0) return;
    const clear = new Set(receipt);
    edges = edges.filter((edge) => !clear.has(edge.id));
  };

  // ---- listeners -----------------------------------------------------------

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!enabled) return;
    // A form field or a HUD control must never emit a gameplay key.
    if (isControlTarget(event.target)) return;
    if (event.repeat) {
      // An OS auto-repeat is not a new press: it only re-touches the held set, and
      // never latches a tap or an edge. This is what keeps a leaned-on key from queuing.
      held.add(event.code);
      return;
    }
    held.add(event.code);
    // Latch the press for the short-tap path. Harmless for codes `has()` never reads
    // (KeyC, KeyQ, Digit1): they are simply never queried as movement/sprint/jump.
    tapped.set(event.code, clock());
    if (event.code === "KeyC") crouch = !crouch;
    if (event.code === "KeyQ") pushEdge("dodge");
    if (event.code === "Digit1" && abilityIds[0]) pushEdge("ability", abilityIds[0]);
    if (event.code === "Space") event.preventDefault();
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    // Never guarded: a key released over a form must still lift the held movement.
    held.delete(event.code);
  };

  // Boss pointer: a primary click fires, a right click dodges. Unchanged.
  const onPointerDownBoss = (event: MouseEvent): void => {
    if (!enabled) return;
    if (event.button === 0) pushEdge("fire");
    if (event.button === 2) pushEdge("dodge");
  };

  // PvP pointer: the canvas exclusively owns gameplay.
  const onPointerDownPvp = (event: MouseEvent): void => {
    if (!enabled) return;
    if (isControlTarget(event.target)) return; // a control on the canvas never fires
    if (event.button === 2) {
      pushEdge("dodge"); // right click dodges
      return;
    }
    if (event.button !== 0) return;
    if (isLocked()) {
      pushEdge("fire"); // locked primary fires
      return;
    }
    if (!captureEstablished) {
      // First unlocked primary CAPTURES (pvpLook starts the lock/drag) and never fires.
      captureEstablished = true;
      return;
    }
    // Established fallback (lock was refused): a short still press is a fire, a drag is
    // look. Decided on the mouseup below.
    fallbackDown = true;
    downAt = clock();
    downTravel = 0;
  };
  const onPointerMovePvp = (event: MouseEvent): void => {
    if (fallbackDown) {
      downTravel += Math.abs(event.movementX ?? 0) + Math.abs(event.movementY ?? 0);
    }
  };
  const onPointerUpPvp = (event: MouseEvent): void => {
    if (event.button !== 0 || !fallbackDown) return;
    fallbackDown = false;
    if (downTravel <= CLICK_MAX_TRAVEL_PX && clock() - downAt <= CLICK_MAX_MS) {
      pushEdge("fire"); // a short click in the fallback fires; a drag does not
    }
  };
  const onPointerLockChangePvp = (): void => {
    // Any transition to unlocked re-arms the capture click, so the next click captures
    // rather than firing.
    if (!isLocked()) {
      captureEstablished = false;
      // Losing the pointer lock (Esc, an alt-tab, a browser overlay) usually means the
      // keyup for a held movement key will land somewhere other than the game — so the
      // key would otherwise stay "held" and the fighter would walk into the open on its
      // own. Clear held movement and its tap latch so movement cannot stick; edges stay,
      // since an incidental lock blip should not swallow a queued shot.
      held.clear();
      tapped.clear();
      lastSampledTaps = [];
    }
  };

  const onContextMenu = (event: Event): void => event.preventDefault();
  const onLifecycleLoss = (): void => {
    held.clear();
    clearEdges();
    resetPointer();
  };
  const onVisibility = (doc: Document): void => {
    if (doc.hidden) onLifecycleLoss();
  };

  return {
    attach(pointerTarget?: HTMLElement | Window): () => void {
      const target = pointerTarget ?? options.target ?? window;
      const win: typeof window | undefined =
        typeof window !== "undefined" ? window : undefined;
      win?.addEventListener("keydown", onKeyDown as EventListener);
      win?.addEventListener("keyup", onKeyUp as EventListener);
      win?.addEventListener("blur", onLifecycleLoss);
      win?.addEventListener("pagehide", onLifecycleLoss);

      let doc: Document | null = null;
      let visibility: (() => void) | null = null;
      if (mode === "pvp") {
        pointerCanvas = target as HTMLElement;
        doc = pointerCanvas.ownerDocument;
        target.addEventListener("mousedown", onPointerDownPvp as EventListener);
        target.addEventListener("contextmenu", onContextMenu);
        doc.addEventListener("mousemove", onPointerMovePvp as EventListener);
        doc.addEventListener("mouseup", onPointerUpPvp as EventListener);
        doc.addEventListener("pointerlockchange", onPointerLockChangePvp);
        visibility = () => onVisibility(doc as Document);
        doc.addEventListener("visibilitychange", visibility);
      } else {
        target.addEventListener("mousedown", onPointerDownBoss as EventListener);
        target.addEventListener("contextmenu", onContextMenu);
      }

      return () => {
        win?.removeEventListener("keydown", onKeyDown as EventListener);
        win?.removeEventListener("keyup", onKeyUp as EventListener);
        win?.removeEventListener("blur", onLifecycleLoss);
        win?.removeEventListener("pagehide", onLifecycleLoss);
        if (mode === "pvp" && doc) {
          target.removeEventListener("mousedown", onPointerDownPvp as EventListener);
          target.removeEventListener("contextmenu", onContextMenu);
          doc.removeEventListener("mousemove", onPointerMovePvp as EventListener);
          doc.removeEventListener("mouseup", onPointerUpPvp as EventListener);
          doc.removeEventListener("pointerlockchange", onPointerLockChangePvp);
          if (visibility) doc.removeEventListener("visibilitychange", visibility);
          pointerCanvas = null;
        } else {
          target.removeEventListener("mousedown", onPointerDownBoss as EventListener);
          target.removeEventListener("contextmenu", onContextMenu);
        }
        onLifecycleLoss();
      };
    },
    setAim(x: number, z: number): void {
      aimX = x;
      aimZ = z;
    },
    setCameraYaw(yaw: number): void {
      cameraYaw = yaw;
    },
    sampleIntent(nowMs: number = clock()): EdgeSample {
      const result = sample(nowMs);
      lastReceipt = result.receipt;
      return result;
    },
    acknowledge,
    peekIntent(): CombatIntent {
      const result = sample(clock());
      lastReceipt = result.receipt;
      return result.intent;
    },
    settle(ticksAdvanced: number): void {
      // Boss duel: a tick reached the reducer, so the sampled press is spent whether
      // or not the core acted on it — edges via the receipt, movement taps via the
      // snapshot acknowledge consumes. A tickless frame consumes NOTHING (so a tap
      // survives to the frame that finally advances a tick), and only ages the latches.
      if (ticksAdvanced > 0) {
        acknowledge(lastReceipt);
      } else {
        expire(clock());
        expireTaps(clock());
      }
    },
    setEnabled(value: boolean): void {
      enabled = value;
      if (!value) {
        held.clear();
        clearEdges();
        resetPointer();
      }
    },
    cancel(): void {
      held.clear();
      clearEdges();
      resetPointer();
    },
    crouched: () => crouch,
    pending: () => {
      expire(clock());
      // The head ability, matching the one `sample` would carry next.
      const abilityHead = edges.find((e) => e.kind === "ability");
      return {
        fire: edges.some((e) => e.kind === "fire"),
        dodge: edges.some((e) => e.kind === "dodge"),
        ability: abilityHead?.abilityId ?? null,
      };
    },
    takeIntent(): CombatIntent {
      const result = sample(clock());
      clearEdges();
      return result.intent;
    },
  };
}
