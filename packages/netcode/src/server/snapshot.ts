// Turning the authority into what each client is told.
//
// The privacy and anti-wallhack half of this is @pa/pvp's, not ours:
// `snapshotsFor` runs its `projectSnapshotFor`, which hides an opponent the server
// cannot see a line to, carries no profileId and no answer text, and is asserted
// against `FORBIDDEN_SNAPSHOT_KEYS` in that package's own tests. This file calls
// it and adds two things it does not provide.
//
// FIRST, THE VIEWER'S COMPLETE OWN BODY. @pa/pvp's `SelfView` is shaped for
// rendering and reports a dash as `dashing: boolean`. Prediction cannot start from
// that: to integrate a burst forward you need its direction, its speed, and how
// many milliseconds of it have elapsed, and a boolean has none of them. So the
// snapshot carries the viewer's whole `FighterState`. That is not a widening of
// the trust boundary — it is the client's own body, which it already renders, and
// no field of it says anything about the opponent.
//
// SECOND, THE ROUND CLOCK. Published as an absolute server tick, because the
// alternative is a client-side twenty-second timer and a client-side timer can be
// slowed for extra shooting time. There is no clock in this design a client can
// influence; there is a number the server states and the client renders.

import { snapshotsFor, type PvpAuthority } from "../pvpPort.js";
import type { DuelSide, DuelState } from "@pa/duel";
import { hashPredictable, hashSelf } from "../hash.js";
import {
  appliedSeqOverSpan,
  healthChangedOverSpan,
  type TickHistory,
} from "../history.js";
import {
  encodeFighter,
  type ResyncMessage,
  type ResyncReason,
  type SnapshotMessage,
} from "../protocol.js";

/**
 * The clock tick a phase ends on, or null when it genuinely has no deadline.
 *
 * Exhaustive over the phase union on purpose: a new phase added upstream makes
 * this a compile error rather than a silently missing countdown.
 */
export function phaseDeadline(state: DuelState): number | null {
  switch (state.phase) {
    case "FACE_OFF":
      return state.endsAtTick;
    case "BULLETS_GRANTED":
      return state.resumesAtTick;
    case "ENGAGEMENT_LIVE":
      return state.endsAtTick;
    case "LINE_OF_SIGHT_BREAK":
      return state.endsAtTick;
    // QUESTION_PENDING is untimed by design — a student thinking about a
    // free-response question is not on a clock, and nothing here may imply one.
    // The remaining phases are instantaneous transitions.
    case "QUESTION_PENDING":
    case "VERDICT_COMMITTED":
    case "ROUND_RESOLVED":
    case "DUEL_RESOLVED":
      return null;
  }
}

export interface EncodeInput {
  readonly authority: PvpAuthority;
  readonly side: DuelSide;
  readonly appliedSeq: number;
  readonly nowMs: number;
  readonly history: TickHistory;
  /** Combat tick of this side's previous snapshot; the span starts after it. */
  readonly sinceTick: number;
}

export function encodeSnapshot(input: EncodeInput): SnapshotMessage {
  const state = input.authority.state;
  const self = state.combat.fighters[input.side];
  const tick = state.combat.tick;
  return {
    type: "SNAPSHOT",
    serverTick: tick,
    clockTick: state.clock.tick,
    view: snapshotsFor(input.authority)[input.side],
    self: encodeFighter(self),
    selfHash: hashSelf(self),
    predictableHash: hashPredictable(self),
    appliedSeq: input.appliedSeq,
    appliedSeqByTick: appliedSeqOverSpan(input.history, input.side, input.sinceTick, tick),
    healthChangedInSpan: healthChangedOverSpan(input.history, input.side, input.sinceTick, tick),
    phaseEndsAtTick: phaseDeadline(state),
    sentAtMs: input.nowMs,
  };
}

export function encodeResync(
  input: Omit<EncodeInput, "sinceTick"> & { readonly reason: ResyncReason },
): ResyncMessage {
  // A resync is a hard rebase, so there is no comparable span to describe: the
  // client throws its prediction away and starts from this state.
  const snapshot = encodeSnapshot({ ...input, sinceTick: input.authority.state.combat.tick });
  return {
    type: "RESYNC",
    reason: input.reason,
    serverTick: snapshot.serverTick,
    clockTick: snapshot.clockTick,
    view: snapshot.view,
    self: snapshot.self,
    selfHash: snapshot.selfHash,
    predictableHash: snapshot.predictableHash,
    appliedSeq: snapshot.appliedSeq,
    phaseEndsAtTick: snapshot.phaseEndsAtTick,
    sentAtMs: snapshot.sentAtMs,
    // The floor a returning client must start its sequence counter above.
    // Omitting this is the reconnect bug that looks like dead controls: @pa/pvp's
    // replay guard refuses any seq at or below the last accepted one, so a client
    // that restarts at 1 has every frame silently refused.
    resumeFromSeq: input.appliedSeq + 1,
  };
}
