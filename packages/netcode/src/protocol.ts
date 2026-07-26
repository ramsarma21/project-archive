// The wire vocabulary, in both directions.
//
// WHAT DECIDED THE SHAPE OF THIS FILE. @pa/pvp already settled the hard question:
// a client sends INTENT and nothing else, because a client that cannot describe
// state cannot lie about state. Nothing here widens that. `ClientIntentFrame` is
// imported from @pa/pvp rather than restated, so there is exactly one definition
// of what a browser is allowed to say and exactly one parser for it, and a field
// added there is automatically a field here.
//
// What netcode adds to @pa/pvp's model is only transport concerns:
//
//   redundancy   an intent datagram carries a WINDOW of recent frames, not one
//                frame, so a single dropped packet does not lose a shot. This is
//                free rather than clever: the authority already drops duplicates
//                by sequence number, so resending an old frame is a no-op it was
//                built to absorb.
//   acknowledgement
//                every snapshot names the highest sequence the authority had
//                actually applied AT THAT TICK, which is what lets a client
//                replay exactly the inputs the server has not yet seen — no
//                more, and no fewer.
//   agreement    every snapshot carries the server's hash of the client's own
//                body, so the two can be compared instead of assumed equal.
//   resumption   a match-scoped resume token and a full baseline, because school
//                wifi drops and a student must be able to come back.
//
// ON THE SNAPSHOT'S TWO HALVES. `view` is @pa/pvp's own `MatchSnapshot`, produced
// by its `projectSnapshotFor`, and it is the privacy and anti-wallhack boundary:
// it hides the opponent behind cover and carries no profileId and no answer text.
// `self` is the viewer's COMPLETE fighter state, which is not a leak — it is their
// own body — and is what makes client-side prediction possible at all, because a
// prediction cannot start from a baseline that omits the dash window it is about
// to integrate.

import type {
  AbilityLedger,
  CombatIntent,
  DuelOutcome,
  DuelSide,
  FighterState,
} from "@pa/duel";
import type { MotionState } from "./enginePort.js";
import type { ClientIntentFrame, MatchSnapshot, PvpMatchResult } from "./pvpPort.js";
import type { StateHash } from "./hash.js";

export const NETCODE_PROTOCOL_VERSION = 1;

// ---- client -> server -------------------------------------------------------

/**
 * How many recent frames ride along in every intent datagram.
 *
 * Sized against the ugly case the brief names: a dropped input at the moment of a
 * shot. At a 30 Hz send rate a window of four means a fire press survives three
 * consecutive losses, which is a ~0.1% event at the 10% loss of the worst school
 * profile and a rounding error at realistic ones. Going wider buys very little and
 * costs bandwidth on every datagram, not just the lossy ones.
 */
export const INTENT_REDUNDANCY_FRAMES = 4;

export interface IntentDatagram {
  readonly type: "INTENTS";
  /**
   * Oldest first. Frames the server has already accepted are dropped by sequence
   * number inside the authority, so this is safe to overlap heavily.
   */
  readonly frames: readonly ClientIntentFrame[];
  /** Highest server tick this client has observed. Feeds the RTT estimate. */
  readonly ackServerTick: number;
  /** Echo of the server's send stamp, so the server can measure the round trip. */
  readonly ackServerSentAtMs: number;
}

/**
 * A client's claim about its own predicted state at a tick it has already been
 * told about.
 *
 * Note what this is NOT: it is not an input to the simulation, and disagreeing
 * with it changes nothing about the match. A malicious client can report any hash
 * it likes and the only consequence is a divergence record with its side on it.
 * That asymmetry is deliberate — the instrument must not become a lever.
 */
export interface HashReportDatagram {
  readonly type: "HASH_REPORT";
  readonly tick: number;
  readonly selfHash: StateHash;
  /** The sequence the client believes the server had applied at that tick. */
  readonly appliedSeq: number;
}

export interface ResumeDatagram {
  readonly type: "RESUME";
  readonly resumeToken: string;
}

/** An explicit leave. Distinct from a drop, and it forfeits. */
export interface LeaveDatagram {
  readonly type: "LEAVE";
}

export type ClientMessage =
  | IntentDatagram
  | HashReportDatagram
  | ResumeDatagram
  | LeaveDatagram;

// ---- server -> client -------------------------------------------------------

/**
 * A fighter as it crosses the wire.
 *
 * `MotionState.action.ignore` is a Set, which JSON does not carry, so the codec is
 * explicit rather than a spread — and being explicit is also what lets a test
 * assert the encoding is total. An authored action never occurs inside a duel
 * today (nothing in combat.ts opens one), but the field is on the type the
 * integrator reads, and a codec that silently drops a field is the exact bug this
 * package exists to prevent.
 */
type AuthoredAction = NonNullable<MotionState["action"]>;

export type WireAuthoredAction = Omit<AuthoredAction, "ignore"> & {
  readonly ignore: readonly string[];
};

export interface WireMotionState extends Omit<MotionState, "action"> {
  readonly action: WireAuthoredAction | null;
}

export interface WireFighterState extends Omit<FighterState, "motion"> {
  readonly motion: WireMotionState;
}

export function encodeFighter(fighter: FighterState): WireFighterState {
  const { action, ...motion } = fighter.motion;
  return {
    ...fighter,
    abilities: { ...fighter.abilities },
    motion: {
      ...motion,
      pos: { ...fighter.motion.pos },
      vel: { ...fighter.motion.vel },
      dash: fighter.motion.dash ? { ...fighter.motion.dash } : null,
      stagger: fighter.motion.stagger ? { ...fighter.motion.stagger } : null,
      action: action
        ? {
            ...action,
            anchors: action.anchors.map((anchor) => ({ ...anchor })),
            startPos: { ...action.startPos },
            endPos: { ...action.endPos },
            ignore: [...action.ignore].sort(),
          }
        : null,
    },
  };
}

export function decodeFighter(wire: WireFighterState): FighterState {
  const { action, ...motion } = wire.motion;
  const decodedAction: AuthoredAction | null = action
    ? {
        ...action,
        anchors: action.anchors.map((anchor) => ({ ...anchor })),
        startPos: { ...action.startPos },
        endPos: { ...action.endPos },
        ignore: new Set<string>(action.ignore),
      }
    : null;
  return {
    ...wire,
    abilities: { ...wire.abilities } as AbilityLedger,
    motion: {
      ...motion,
      pos: { ...wire.motion.pos },
      vel: { ...wire.motion.vel },
      dash: wire.motion.dash ? { ...wire.motion.dash } : null,
      stagger: wire.motion.stagger ? { ...wire.motion.stagger } : null,
      action: decodedAction,
    },
  };
}

export interface SnapshotMessage {
  readonly type: "SNAPSHOT";
  /**
   * The COMBAT tick, which advances only during a live engagement. This is the
   * tick a client stamps its intents with, because it is the one @pa/pvp's
   * `acceptIntentFrame` measures its acceptance window against.
   */
  readonly serverTick: number;
  /**
   * The FIELD CLOCK tick, which advances through every timed phase including the
   * face-off and the reload break. Deliberately carried alongside the combat tick
   * rather than instead of it: the two are different counters and conflating them
   * is the sort of off-by-a-phase bug that only shows up in round two.
   */
  readonly clockTick: number;
  /** @pa/pvp's projection: fog of war, no identity, no answer text. */
  readonly view: MatchSnapshot;
  /** The viewer's own body, complete. The baseline every prediction starts from. */
  readonly self: WireFighterState;
  /** The server's hash of the complete `self`. Carried for the audit trail. */
  readonly selfHash: StateHash;
  /**
   * The server's hash of the LOCALLY PREDICTABLE subset of `self`. This is the one
   * a client can meaningfully disagree with; see `hashPredictable`.
   */
  readonly predictableHash: StateHash;
  /**
   * The highest intent sequence from this side that the authority had actually
   * applied at `serverTick`. A client replays strictly the frames after this.
   */
  readonly appliedSeq: number;
  /**
   * The sequence in force on each tick from the previous snapshot's tick
   * (exclusive) to `serverTick` (inclusive), oldest first.
   *
   * Three numbers at a 20 Hz snapshot rate, and they are what make the client's
   * reproduction EXACT rather than approximate. Knowing only which frames the
   * server has seen leaves the client guessing which tick each took effect on, and
   * a comparison that guesses reports a divergence on every input change. A
   * detector that cries wolf on every keypress is a detector nobody reads.
   */
  readonly appliedSeqByTick: readonly number[];
  /**
   * True when this side's health changed anywhere in the span above.
   *
   * Damage is never predicted, so a span containing it is not comparable and the
   * client skips it rather than reporting a divergence it caused itself. Stated by
   * the server rather than inferred by the client, because the client only sees
   * health at snapshot boundaries and would miss a hit that was healed— or in this
   * game, a hit followed by a round boundary — inside one span.
   */
  readonly healthChangedInSpan: boolean;
  /**
   * THE ROUND CLOCK, AND IT IS THE SERVER'S.
   *
   * Published as an absolute server tick rather than as a remaining duration, so a
   * client renders `(phaseEndsAtTick - serverTick) / FIELD_TICK_HZ` and has nothing
   * of its own to slow down. A client-owned twenty-second timer can simply be
   * throttled for extra shooting time; there is no such timer anywhere in this
   * design. Null in the phases that genuinely have no deadline — above all
   * QUESTION_PENDING, which is untimed by design. Measured in CLOCK ticks, so it
   * is compared against `clockTick` and never against `serverTick`.
   */
  readonly phaseEndsAtTick: number | null;
  /** Server wall clock at send. Echoed back for the round-trip estimate. */
  readonly sentAtMs: number;
}

/**
 * The full baseline: sent on join, at every inter-round barrier, and on resume.
 *
 * It carries the opponent's complete fighter state as well, which the periodic
 * snapshot deliberately never does. That is safe for exactly one reason and it is
 * worth being explicit about it: a barrier only ever fires in a phase where the
 * fight is not live — the untimed question, the grant countdown, the resolved
 * round — so there is nothing to gain from knowing where the other body is. On
 * resume mid-round the opponent is projected through the same fog-of-war path as
 * any other snapshot instead.
 */
export interface ResyncMessage {
  readonly type: "RESYNC";
  readonly reason: ResyncReason;
  readonly serverTick: number;
  readonly clockTick: number;
  readonly view: MatchSnapshot;
  readonly self: WireFighterState;
  readonly selfHash: StateHash;
  readonly predictableHash: StateHash;
  readonly appliedSeq: number;
  readonly phaseEndsAtTick: number | null;
  readonly sentAtMs: number;
  /**
   * Where the client must restart its sequence counter.
   *
   * Load-bearing on reconnect and easy to miss: a client that comes back and
   * restarts `seq` at 1 has every frame refused as STALE_SEQUENCE by the
   * authority's own replay guard, and looks to the player exactly like the
   * controls being dead. The server states the floor and the client obeys it.
   */
  readonly resumeFromSeq: number;
}

export type ResyncReason =
  | "JOIN"
  | "ROUND_BARRIER"
  | "RECONNECT"
  | "DIVERGENCE_CORRECTION";

export interface WelcomeMessage {
  readonly type: "WELCOME";
  readonly protocolVersion: number;
  readonly matchId: string;
  readonly side: DuelSide;
  readonly seed: number;
  readonly tickHz: number;
  readonly snapshotHz: number;
  /** Presented once, held by the client, and the only way back into this match. */
  readonly resumeToken: string;
  readonly resync: ResyncMessage;
}

export interface OpponentPresenceMessage {
  readonly type: "OPPONENT_PRESENCE";
  readonly present: boolean;
  /** Server tick the grace window expires on, when the opponent is away. */
  readonly graceEndsAtMs: number | null;
}

export interface ResultMessage {
  readonly type: "RESULT";
  readonly result: PvpMatchResult;
  readonly outcome: DuelOutcome | null;
}

export interface RejectionMessage {
  readonly type: "REJECTED";
  readonly reason: string;
  readonly detail: string;
}

export type ServerMessage =
  | WelcomeMessage
  | SnapshotMessage
  | ResyncMessage
  | OpponentPresenceMessage
  | ResultMessage
  | RejectionMessage;

/**
 * One sampled frame, kept in both forms.
 *
 * BOTH, AND THAT IS THE POINT. `frame` is what goes on the wire. `intent` is what
 * @pa/pvp's `toCombatIntent` makes of it — and a prediction MUST use that one,
 * because normalisation is not the identity even on a vector that is already unit
 * length: `Math.hypot(0.6, 0.8)` is not guaranteed to be exactly 1, so dividing by it
 * changes the last bit. A client that predicts with the raw input while the server
 * simulates the normalised input diverges on the very first tick, on localhost, with
 * no network involved at all. Storing both is how the two ends are handed identical
 * bits rather than merely equal-looking numbers.
 */
export interface RecordedIntent {
  readonly seq: number;
  readonly tick: number;
  readonly frame: ClientIntentFrame;
  readonly intent: CombatIntent;
}
