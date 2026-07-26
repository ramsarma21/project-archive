// Per-side connection state, and the disconnect policy.
//
// THE PROBLEM THIS SOLVES IS A SCHOOL PROBLEM. School wifi drops. A student whose
// laptop loses the access point for four seconds must come back into the same
// match, and a student who closes the tab because they are losing must not thereby
// avoid the loss. Those two requirements pull in opposite directions and the whole
// of the policy below is the line between them.
//
// FOUR STATES, AND THE TRANSITIONS ARE THE POLICY:
//
//   CONNECTED    a live transport, frames arriving.
//   SILENT       transport still open, nothing arriving for a while. Held intent
//                decays to idle so the body stops rather than sprinting into a
//                wall on a repeated instruction.
//   DROPPED      transport gone, inside the grace window. The match keeps running
//                and the player can still be shot; see below.
//   GONE         grace expired, or an explicit leave. Forfeits.
//
// THE SIMULATION DOES NOT PAUSE FOR A DROP, AND THAT IS DELIBERATE. Pausing is the
// intuitive kindness and it is an exploit: pulling the ethernet cable the moment a
// ball is in the air would become the strongest defensive move in the game. So a
// dropped player's body stays in the world and stays shootable. What the policy
// gives back instead is the ability to RETURN — reconnect inside the grace window
// and you resume the same match with no standing penalty at all — plus the idle
// decay, which at least stops the abandoned body from running in a straight line
// off the far side of the arena.
//
// RAGE-QUITTING IS ALREADY A LOSS AND WE DID NOT HAVE TO BUILD THAT. @pa/pvp's
// `forfeitMatch` + `matchResult` give the opponent the win with
// `standingApplies: true`, so closing the tab costs the ladder points a loss costs.
// This file only decides WHEN to call it.

import type { DuelSide } from "@pa/duel";
import { DISCONNECT_GRACE_MS } from "../pvpPort.js";

/**
 * Ticks of silence during live play after which a held intent has gone stale.
 *
 * ~200 ms at 60 Hz: long enough to ride out several dropped datagrams at any
 * realistic send rate, because @pa/pvp's held-intent repeat is the RIGHT behaviour
 * for ordinary packet loss and must not be undone by a twitchy timeout.
 *
 * DETECTED HERE, NOT ACTED ON, AND THAT IS A DELIBERATE REFUSAL TO WORK AROUND
 * @pa/pvp. The obvious fix for an abandoned body sprinting into a wall on a
 * repeated instruction is for netcode to feed an idle frame in on the player's
 * behalf. It must not, because `ingestIntent` is the only writer of `heldIntents`
 * and it also stamps `lastIntentAtMs` — the very field `silentSides` measures. An
 * injected idle would therefore mark a disconnected player as alive and they would
 * never forfeit, turning a cosmetic problem into a ladder exploit. So this counts
 * the condition and the host reports it, and the fix belongs in @pa/pvp, where
 * `advanceMatch` can decay the held intent without lying about liveness.
 */
export const HELD_INTENT_DECAY_TICKS = 12;

/**
 * How long a transport may be gone and still be resumable.
 *
 * Set equal to @pa/pvp's own forfeit grace on purpose: two different windows would
 * produce the state where a player is allowed back into a match the authority has
 * already forfeited. Consumed rather than restated, so it cannot drift.
 */
export const RESUME_GRACE_MS = DISCONNECT_GRACE_MS;

/** How many times one side may resume before it looks like connection abuse. */
export const MAX_RESUMES_PER_MATCH = 6;

export type SessionPresence = "CONNECTED" | "SILENT" | "DROPPED" | "GONE";

export interface Session {
  readonly side: DuelSide;
  readonly presence: SessionPresence;
  /**
   * The only way back into this match. Injected by the host rather than minted
   * here: it must be unguessable by the OPPONENT, who already knows the match code
   * and the lobby code, so it cannot be derived from either.
   */
  readonly resumeToken: string;
  /** Bumps on every attach. Stale messages from a previous socket are dropped. */
  readonly epoch: number;
  readonly lastHeardAtMs: number;
  readonly droppedAtMs: number | null;
  readonly resumesUsed: number;
  /** Highest intent sequence the authority has accepted from this side. */
  readonly lastAcceptedSeq: number;
  /** Combat tick of the last accepted frame; drives the idle decay. */
  readonly lastIntentTick: number;
  /** Smoothed round trip in milliseconds, or null before the first sample. */
  readonly rttMs: number | null;
  readonly divergencesReported: number;
  readonly framesAccepted: number;
  readonly framesRejected: number;
}

export function createSession(
  side: DuelSide,
  resumeToken: string,
  nowMs: number,
): Session {
  return {
    side,
    presence: "CONNECTED",
    resumeToken,
    epoch: 1,
    lastHeardAtMs: nowMs,
    droppedAtMs: null,
    resumesUsed: 0,
    lastAcceptedSeq: 0,
    lastIntentTick: 0,
    rttMs: null,
    divergencesReported: 0,
    framesAccepted: 0,
    framesRejected: 0,
  };
}

export function noteHeard(session: Session, nowMs: number): Session {
  if (session.presence === "GONE") return session;
  return {
    ...session,
    presence: "CONNECTED",
    lastHeardAtMs: nowMs,
    droppedAtMs: null,
  };
}

/**
 * Exponentially smoothed round trip.
 *
 * A 1/8 weight, which is the same choice TCP makes for the same reason: a single
 * pathological sample on a congested link must not move the estimate enough to
 * change the interpolation delay, but a sustained change must be tracked within a
 * second or so.
 */
export function noteRoundTrip(session: Session, sampleMs: number): Session {
  if (!Number.isFinite(sampleMs) || sampleMs < 0 || sampleMs > 10_000) return session;
  const rttMs = session.rttMs === null ? sampleMs : session.rttMs * 0.875 + sampleMs * 0.125;
  return { ...session, rttMs };
}

export function noteDropped(session: Session, nowMs: number): Session {
  if (session.presence === "GONE") return session;
  return { ...session, presence: "DROPPED", droppedAtMs: nowMs };
}

export function noteGone(session: Session): Session {
  return { ...session, presence: "GONE" };
}

export type ResumeRefusal =
  | "UNKNOWN_TOKEN"
  | "GRACE_EXPIRED"
  | "TOO_MANY_RESUMES"
  | "MATCH_OVER";

export type ResumeResult =
  | { readonly ok: true; readonly session: Session }
  | { readonly ok: false; readonly reason: ResumeRefusal };

/**
 * Attempt to bring a side back.
 *
 * The token is compared in full and a mismatch is UNKNOWN_TOKEN rather than a more
 * specific error, so a wrong token teaches an attacker nothing about whether the
 * match or the side exists.
 */
export function resumeSession(
  session: Session,
  token: string,
  nowMs: number,
  graceMs = RESUME_GRACE_MS,
): ResumeResult {
  if (token !== session.resumeToken) return { ok: false, reason: "UNKNOWN_TOKEN" };
  if (session.presence === "GONE") return { ok: false, reason: "MATCH_OVER" };
  if (session.resumesUsed >= MAX_RESUMES_PER_MATCH) {
    return { ok: false, reason: "TOO_MANY_RESUMES" };
  }
  if (session.droppedAtMs !== null && nowMs - session.droppedAtMs > graceMs) {
    return { ok: false, reason: "GRACE_EXPIRED" };
  }
  return {
    ok: true,
    session: {
      ...session,
      presence: "CONNECTED",
      epoch: session.epoch + 1,
      resumesUsed: session.resumesUsed + 1,
      lastHeardAtMs: nowMs,
      droppedAtMs: null,
    },
  };
}

/**
 * Has this side been gone long enough to lose the match?
 *
 * Note the caller is expected to combine this with @pa/pvp's `silentSides`, which
 * already refuses to run the clock during an untimed question. This function is
 * about a CLOSED TRANSPORT rather than about silence, which is why it has its own
 * timer: a student who is thinking has an open socket and is not dropped, and a
 * student whose wifi died has a closed one and is.
 */
export function graceExpired(
  session: Session,
  nowMs: number,
  graceMs = RESUME_GRACE_MS,
): boolean {
  if (session.presence !== "DROPPED" || session.droppedAtMs === null) return false;
  return nowMs - session.droppedAtMs > graceMs;
}

/** Should the held intent decay to idle? True after a stretch of no new frames. */
export function shouldDecayHeldIntent(
  session: Session,
  combatTick: number,
  decayTicks = HELD_INTENT_DECAY_TICKS,
): boolean {
  if (session.presence === "GONE") return false;
  return combatTick - session.lastIntentTick >= decayTicks;
}

export function noteAccepted(
  session: Session,
  seq: number,
  combatTick: number,
  nowMs: number,
): Session {
  return {
    ...noteHeard(session, nowMs),
    lastAcceptedSeq: Math.max(session.lastAcceptedSeq, seq),
    lastIntentTick: combatTick,
    framesAccepted: session.framesAccepted + 1,
  };
}

export function noteRejected(session: Session, nowMs: number): Session {
  return { ...noteHeard(session, nowMs), framesRejected: session.framesRejected + 1 };
}
