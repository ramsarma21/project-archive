// What a client is allowed to say, which is the whole of what a client is allowed to
// do.
//
// A ranked client sends INTENT and nothing else: a direction, some held modifiers, an
// aim vector, and an ability id. It never sends a position, a velocity, a hit, a
// health value, a bullet count or an outcome, because none of those is a field in this
// type. That is the anti-cheat design in one sentence — most cheats in a shooter are
// lies about state, and a client that cannot describe state cannot lie about it.
//
// What remains is bounded rather than trusted:
//
//   direction   normalised, so `moveX: 1e9` is `moveX: 1`. Speed is derived
//               server-side by engine-world's freeMoveSpeed, so there is no speed
//               field to inflate.
//   aim         normalised. Aim QUALITY is a legitimate input and therefore the one
//               residual cheat surface in any shooter; see the note below.
//   fire        a request, not an event. The server's resolveFiring gates it on ammo
//               and the fire interval, so a client that sends fire every tick fires
//               exactly as often as one that does not.
//   ability     an id, checked against the server-resolved four-slot loadout and the
//               one-use-per-duel ledger.
//   tick        advisory. The server owns the clock; a frame stamped outside the
//               acceptance window is dropped rather than believed.
//
// ON AIMBOTS, STATED PLAINLY. Perfect aim cannot be prevented by construction,
// because aim is genuinely the player's input. What matters is that it is bounded by
// everything else: a bot still cannot exceed the fire interval, cannot exceed its
// ammunition, and above all cannot obtain more bullets, because bullets come from a
// verdict. So the ceiling on a cheater is the same six or eighteen shots as everyone
// else, and the residual advantage is accuracy within that budget. That is an
// analytics problem — accuracy far outside the distribution for a Rank — and it is
// recorded here as a known limit rather than left to be discovered.

import { intent as combatIntent, type CombatIntent } from "@pa/duel";

export const INTENT_FRAME_KEYS = [
  "seq",
  "tick",
  "moveX",
  "moveZ",
  "sprint",
  "crouch",
  "jump",
  "dodge",
  "fire",
  "aimX",
  "aimZ",
  "abilityId",
] as const;

export interface ClientIntentFrame {
  /** Per-match monotonic counter. Duplicates and rewinds are dropped. */
  readonly seq: number;
  /** The tick the client sampled this for. Advisory; the server owns the clock. */
  readonly tick: number;
  readonly moveX: number;
  readonly moveZ: number;
  readonly sprint: boolean;
  readonly crouch: boolean;
  readonly jump: boolean;
  readonly dodge: boolean;
  readonly fire: boolean;
  readonly aimX: number;
  readonly aimZ: number;
  readonly abilityId: string | null;
}

/**
 * How far ahead of the server a frame may be stamped and still be accepted. A client
 * predicts locally, so it is legitimately a few ticks ahead; beyond that it is either
 * badly clocked or trying to schedule the future.
 */
export const MAX_INTENT_LEAD_TICKS = 8;

/**
 * How far behind. Roughly 200 ms of tolerance for a school network, after which the
 * frame describes a moment that has already been simulated and cannot be revised —
 * accepting it would be a rollback the other player did not agree to.
 */
export const MAX_INTENT_LAG_TICKS = 12;

export type IntentRejection =
  | "NOT_AN_OBJECT"
  | "UNKNOWN_FIELD"
  | "MISSING_FIELD"
  | "BAD_FIELD_TYPE"
  | "NON_FINITE_NUMBER"
  | "STALE_SEQUENCE"
  | "TICK_TOO_FAR_AHEAD"
  | "TICK_TOO_FAR_BEHIND"
  | "MATCH_NOT_LIVE";

export type IntentParseResult =
  | { readonly ok: true; readonly frame: ClientIntentFrame }
  | { readonly ok: false; readonly reason: IntentRejection; readonly detail: string };

const NUMBER_FIELDS = ["seq", "tick", "moveX", "moveZ", "aimX", "aimZ"] as const;
const BOOLEAN_FIELDS = ["sprint", "crouch", "jump", "dodge", "fire"] as const;

export function parseIntentFrame(input: unknown): IntentParseResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, reason: "NOT_AN_OBJECT", detail: typeof input };
  }
  const record = input as Record<string, unknown>;
  const allowed = new Set<string>(INTENT_FRAME_KEYS);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      // Refused rather than ignored: an attempt to send `health` or `position` is a
      // signal worth logging, not a field to quietly drop.
      return { ok: false, reason: "UNKNOWN_FIELD", detail: key };
    }
  }
  for (const key of NUMBER_FIELDS) {
    if (!(key in record)) return { ok: false, reason: "MISSING_FIELD", detail: key };
    if (typeof record[key] !== "number") {
      return { ok: false, reason: "BAD_FIELD_TYPE", detail: key };
    }
    if (!Number.isFinite(record[key] as number)) {
      return { ok: false, reason: "NON_FINITE_NUMBER", detail: key };
    }
  }
  for (const key of BOOLEAN_FIELDS) {
    if (!(key in record)) return { ok: false, reason: "MISSING_FIELD", detail: key };
    if (typeof record[key] !== "boolean") {
      return { ok: false, reason: "BAD_FIELD_TYPE", detail: key };
    }
  }
  const abilityId = record.abilityId;
  if (abilityId !== null && typeof abilityId !== "string") {
    return { ok: false, reason: "BAD_FIELD_TYPE", detail: "abilityId" };
  }

  return {
    ok: true,
    frame: {
      seq: Math.trunc(record.seq as number),
      tick: Math.trunc(record.tick as number),
      moveX: record.moveX as number,
      moveZ: record.moveZ as number,
      sprint: record.sprint as boolean,
      crouch: record.crouch as boolean,
      jump: record.jump as boolean,
      dodge: record.dodge as boolean,
      fire: record.fire as boolean,
      aimX: record.aimX as number,
      aimZ: record.aimZ as number,
      abilityId: (abilityId as string | null) ?? null,
    },
  };
}

/**
 * Project a validated frame onto the duel's own intent type, normalising both
 * vectors. This is where "the client cannot move faster" is actually enforced: the
 * magnitude is discarded and only the direction survives.
 */
export function toCombatIntent(frame: ClientIntentFrame): CombatIntent {
  const moveLength = Math.hypot(frame.moveX, frame.moveZ);
  const aimLength = Math.hypot(frame.aimX, frame.aimZ);
  return combatIntent({
    moveX: moveLength > 1e-6 ? frame.moveX / moveLength : 0,
    moveZ: moveLength > 1e-6 ? frame.moveZ / moveLength : 0,
    sprint: frame.sprint,
    crouch: frame.crouch,
    jump: frame.jump,
    dodge: frame.dodge,
    fire: frame.fire,
    aimX: aimLength > 1e-6 ? frame.aimX / aimLength : 0,
    aimZ: aimLength > 1e-6 ? frame.aimZ / aimLength : 0,
    abilityId: frame.abilityId,
  });
}

export interface IntentWindow {
  readonly lastSeq: number;
  readonly accepted: number;
  readonly rejected: number;
}

export const EMPTY_INTENT_WINDOW: IntentWindow = {
  lastSeq: 0,
  accepted: 0,
  rejected: 0,
};

export type IntentAcceptance =
  | {
      readonly ok: true;
      readonly window: IntentWindow;
      readonly intent: CombatIntent;
    }
  | {
      readonly ok: false;
      readonly window: IntentWindow;
      readonly reason: IntentRejection;
      readonly detail: string;
    };

/**
 * Accept or refuse a frame against the authority's clock and the side's sequence.
 * Pure, so the acceptance policy is testable without a server.
 */
export function acceptIntentFrame(
  window: IntentWindow,
  frame: ClientIntentFrame,
  serverTick: number,
): IntentAcceptance {
  const reject = (reason: IntentRejection, detail: string): IntentAcceptance => ({
    ok: false,
    window: { ...window, rejected: window.rejected + 1 },
    reason,
    detail,
  });

  if (frame.seq <= window.lastSeq) {
    return reject("STALE_SEQUENCE", `${frame.seq} <= ${window.lastSeq}`);
  }
  if (frame.tick > serverTick + MAX_INTENT_LEAD_TICKS) {
    return reject("TICK_TOO_FAR_AHEAD", `${frame.tick} vs ${serverTick}`);
  }
  if (frame.tick < serverTick - MAX_INTENT_LAG_TICKS) {
    return reject("TICK_TOO_FAR_BEHIND", `${frame.tick} vs ${serverTick}`);
  }
  return {
    ok: true,
    window: {
      lastSeq: frame.seq,
      accepted: window.accepted + 1,
      rejected: window.rejected,
    },
    intent: toCombatIntent(frame),
  };
}
