// The match host: an authority, two sessions, a tick history, and an outbox.
//
// WHERE THE WALL CLOCK LIVES, AND IT IS ONLY HERE. @pa/duel advances on explicit
// ticks and reads no clock; @pa/pvp is a pure value with no timers. That property
// is what makes a duel replayable from an input log and it must survive contact
// with a network. So this file is the edge: it takes `nowMs` as a PARAMETER,
// converts elapsed real time into a whole number of 60 Hz ticks, and passes ticks
// inward. Nothing below it ever learns what time it is.
//
// THE HOST IS STILL A VALUE. There is no `setInterval` in this file either — the
// caller supplies `nowMs` and drains an outbox — for the same reason @pa/pvp is
// pure: the thing that decides a ranked outcome should be testable without a
// process. `loop.ts` is the thin adapter that owns the actual timer.
//
// ONE TICK PER CALL, DELIBERATELY. `advanceMatch` is invoked with exactly FIELD_DT
// so it produces exactly one fixed step. The API's current `pump()` hands the
// reducer a variable slice instead, which is legal — the engine's accumulator
// handles it — but it makes "which intents were applied on tick 412" unanswerable,
// because a slice can span several ticks with one held intent and no record of the
// boundary. Stepping one at a time makes the input log exact, and an exact input
// log is the difference between a divergence report and a shrug.
//
// AND IT REMOVES A CLASS OF EXPLOIT. Because the loop is driven by the wall clock
// rather than by an arriving request, the twenty-second round clock advances
// whether or not anybody is polling. A client that stops sending cannot buy itself
// extra shooting time by freezing the round, because its packets were never what
// moved the clock.

import {
  duelOutcome,
  FIELD_DT,
  FIELD_TICK_HZ,
  type BySide,
  type CombatIntent,
  type DuelSide,
} from "@pa/duel";
import { MAX_CATCHUP_STEPS } from "../enginePort.js";
import {
  advanceMatch,
  forfeitMatch,
  matchResult,
  ingestIntent,
  silentSides,
  type PvpAuthority,
} from "../pvpPort.js";
import {
  INITIAL_BARRIER_TRACKER,
  observePhase,
  type BarrierTracker,
} from "../barrier.js";
import {
  buildDivergenceReport,
  type DivergenceReport,
} from "../divergence.js";
import {
  createHistory,
  predictableHashAt,
  recordTick,
  type TickHistory,
} from "../history.js";
import {
  NETCODE_PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from "../protocol.js";
import { encodeResync, encodeSnapshot } from "./snapshot.js";
import {
  createSession,
  graceExpired,
  noteAccepted,
  noteDropped,
  noteGone,
  noteHeard,
  noteRejected,
  noteRoundTrip,
  resumeSession,
  shouldDecayHeldIntent,
  RESUME_GRACE_MS,
  type Session,
} from "./session.js";

/** Every third tick: 20 Hz of snapshots against a 60 Hz simulation. */
export const DEFAULT_SNAPSHOT_EVERY_TICKS = 3;

export interface HostConfig {
  readonly snapshotEveryTicks: number;
  /**
   * Mints a resume token. INJECTED rather than generated here, and required
   * rather than defaulted, because the token must be unguessable by the opponent
   * — who already knows the lobby code, the match id and the seed — so it cannot
   * be derived from any of them. The API passes a CSPRNG; tests pass a counter.
   */
  readonly mintResumeToken: (side: DuelSide) => string;
  readonly maxCatchUpTicks: number;
  readonly historyWindowTicks?: number;
  readonly graceMs: number;
}

export function hostConfig(
  mintResumeToken: (side: DuelSide) => string,
  overrides: Partial<Omit<HostConfig, "mintResumeToken">> = {},
): HostConfig {
  return {
    snapshotEveryTicks: DEFAULT_SNAPSHOT_EVERY_TICKS,
    // The engine's own catch-up bound rather than a second opinion about how much
    // a stalled process may fast-forward.
    maxCatchUpTicks: MAX_CATCHUP_STEPS,
    graceMs: RESUME_GRACE_MS,
    ...overrides,
    mintResumeToken,
  };
}

export interface Addressed {
  readonly side: DuelSide;
  readonly message: ServerMessage;
}

export interface HostStats {
  readonly ticksRun: number;
  readonly ticksDropped: number;
  readonly snapshotsSent: number;
  readonly barriersFired: number;
  readonly divergencesDetected: number;
  /**
   * Ticks on which a side's held intent was older than the decay threshold. Not
   * acted on here — see the note on `decayObserved` below — but counted, because
   * a rising number is the earliest signal of a link in trouble.
   */
  readonly staleIntentTicks: number;
}

export interface MatchHost {
  readonly authority: PvpAuthority;
  readonly history: TickHistory;
  readonly sessions: BySide<Session>;
  readonly barriers: BySide<BarrierTracker>;
  readonly divergences: readonly DivergenceReport[];
  readonly outbox: readonly Addressed[];
  readonly config: HostConfig;
  readonly nextTickAtMs: number;
  /** Combat tick of the last snapshot sent to each side; the span's lower bound. */
  readonly lastSnapshotTick: BySide<number>;
  /**
   * Clock tick the last snapshot went out on.
   *
   * The loop is polled far faster than it ticks — deliberately, so a tick lands close
   * to its due time — which means the same clock tick is current for many consecutive
   * polls. Without this guard the send condition is true on every one of them and the
   * server emits a burst of identical snapshots per tick. That is not merely wasteful:
   * each duplicate resets the per-side span to zero length, so the client can never
   * assemble a comparable window and the divergence detector silently stops working.
   */
  readonly lastSentClockTick: number;
  /** Last presence pair announced, so presence is sent on change rather than always. */
  readonly lastPresence: BySide<boolean>;
  readonly stats: HostStats;
  readonly resultSent: boolean;
}

const TICK_MS = 1000 / FIELD_TICK_HZ;

export function createHost(
  authority: PvpAuthority,
  config: HostConfig,
  nowMs: number,
): MatchHost {
  const sessions: BySide<Session> = {
    A: createSession("A", config.mintResumeToken("A"), nowMs),
    B: createSession("B", config.mintResumeToken("B"), nowMs),
  };
  const host: MatchHost = {
    authority,
    history: createHistory(config.historyWindowTicks),
    sessions,
    barriers: { A: INITIAL_BARRIER_TRACKER, B: INITIAL_BARRIER_TRACKER },
    divergences: [],
    outbox: [],
    config,
    nextTickAtMs: nowMs + TICK_MS,
    lastSnapshotTick: { A: 0, B: 0 },
    lastSentClockTick: -1,
    lastPresence: { A: true, B: true },
    stats: {
      ticksRun: 0,
      ticksDropped: 0,
      snapshotsSent: 0,
      barriersFired: 0,
      divergencesDetected: 0,
      staleIntentTicks: 0,
    },
    resultSent: false,
  };
  return welcomeBoth(host, nowMs);
}

function welcomeBoth(host: MatchHost, nowMs: number): MatchHost {
  let current = host;
  for (const side of ["A", "B"] as const) {
    current = emit(current, side, {
      type: "WELCOME",
      protocolVersion: NETCODE_PROTOCOL_VERSION,
      matchId: current.authority.identity.matchId,
      side,
      seed: current.authority.identity.seed,
      tickHz: FIELD_TICK_HZ,
      snapshotHz: FIELD_TICK_HZ / current.config.snapshotEveryTicks,
      resumeToken: current.sessions[side].resumeToken,
      resync: encodeResync({
        authority: current.authority,
        side,
        appliedSeq: current.sessions[side].lastAcceptedSeq,
        nowMs,
        history: current.history,
        reason: "JOIN",
      }),
    });
  }
  return current;
}

function emit(host: MatchHost, side: DuelSide, message: ServerMessage): MatchHost {
  return { ...host, outbox: [...host.outbox, { side, message }] };
}

function withSession(host: MatchHost, side: DuelSide, session: Session): MatchHost {
  return {
    ...host,
    sessions: side === "A" ? { A: session, B: host.sessions.B } : { A: host.sessions.A, B: session },
  };
}

/** Take everything queued for the transport. The host keeps no send history. */
export function drain(host: MatchHost): { host: MatchHost; messages: readonly Addressed[] } {
  if (host.outbox.length === 0) return { host, messages: [] };
  return { host: { ...host, outbox: [] }, messages: host.outbox };
}

// ---- the tick ---------------------------------------------------------------

/**
 * Run every 60 Hz tick that real time has made due, then send what is owed.
 *
 * `nextTickAtMs` is advanced by exactly one tick period per tick RUN, so the
 * schedule does not drift; when the bound bites it is rebased to now, so a stalled
 * process drops the missed time rather than banking it and fast-forwarding the
 * fight afterwards. Dropping is the correct failure: a duel that catches up in a
 * burst is a duel where somebody was shot during a frame that never rendered.
 */
export function advanceTo(host: MatchHost, nowMs: number): MatchHost {
  let current = host;
  let ran = 0;

  while (nowMs >= current.nextTickAtMs) {
    if (ran >= current.config.maxCatchUpTicks) {
      const behind = Math.floor((nowMs - current.nextTickAtMs) / TICK_MS) + 1;
      current = {
        ...current,
        nextTickAtMs: nowMs + TICK_MS,
        stats: { ...current.stats, ticksDropped: current.stats.ticksDropped + behind },
      };
      break;
    }
    current = runOneTick(current, nowMs);
    current = { ...current, nextTickAtMs: current.nextTickAtMs + TICK_MS };
    ran += 1;
  }

  current = evaluatePresence(current, nowMs);
  return sendDue(current, nowMs);
}

function runOneTick(host: MatchHost, nowMs: number): MatchHost {
  const before = host.authority;
  if (before.phase !== "LIVE") return host;

  // Captured BEFORE the step, because these are exactly what the step will apply.
  // Reading them afterwards would record an intent that arrived during the tick.
  const intents: BySide<CombatIntent> = {
    A: before.heldIntents.A,
    B: before.heldIntents.B,
  };
  const appliedSeq: BySide<number> = {
    A: host.sessions.A.lastAcceptedSeq,
    B: host.sessions.B.lastAcceptedSeq,
  };

  const advanced = advanceMatch(before, FIELD_DT);
  const authority = advanced.authority;
  const combatAdvanced = authority.state.combat.tick > before.state.combat.tick;

  let stale = host.stats.staleIntentTicks;
  if (combatAdvanced) {
    for (const side of ["A", "B"] as const) {
      if (shouldDecayHeldIntent(host.sessions[side], authority.state.combat.tick)) {
        stale += 1;
      }
    }
  }

  // The barrier is observed per side because each side is told separately, but the
  // phase is shared, so both fire on the same transition.
  const barrierA = observePhase(host.barriers.A, authority.state.phase, authority.state.round);
  const barrierB = observePhase(host.barriers.B, authority.state.phase, authority.state.round);

  const history = combatAdvanced
    ? recordTick(host.history, {
        state: authority.state.combat,
        round: authority.state.round,
        intents,
        appliedSeq,
        checkpoint: barrierA.fire,
      })
    : host.history;

  let current: MatchHost = {
    ...host,
    authority,
    history,
    barriers: { A: barrierA.tracker, B: barrierB.tracker },
    stats: {
      ...host.stats,
      ticksRun: host.stats.ticksRun + 1,
      staleIntentTicks: stale,
      barriersFired: host.stats.barriersFired + (barrierA.fire ? 1 : 0),
    },
  };

  if (barrierA.fire) current = sendResync(current, "A", "ROUND_BARRIER", nowMs);
  if (barrierB.fire) current = sendResync(current, "B", "ROUND_BARRIER", nowMs);
  return current;
}

function sendResync(
  host: MatchHost,
  side: DuelSide,
  reason: Parameters<typeof encodeResync>[0]["reason"],
  nowMs: number,
): MatchHost {
  const message = encodeResync({
    authority: host.authority,
    side,
    appliedSeq: host.sessions[side].lastAcceptedSeq,
    nowMs,
    history: host.history,
    reason,
  });
  return {
    ...emit(host, side, message),
    lastSnapshotTick: withSideValue(host.lastSnapshotTick, side, message.serverTick),
  };
}

function withSideValue<T>(pair: BySide<T>, side: DuelSide, value: T): BySide<T> {
  return side === "A" ? { A: value, B: pair.B } : { A: pair.A, B: value };
}

function sendDue(host: MatchHost, nowMs: number): MatchHost {
  let current = host;
  const clockTick = current.authority.state.clock.tick;
  // Keyed off the clock tick rather than the combat tick, so the countdown phases
  // — the face-off, the grant countdown, the reload break — keep updating even
  // though no combat tick is being produced. Guarded on the tick having CHANGED, so
  // one tick produces one snapshot however often the loop is polled.
  if (
    clockTick !== current.lastSentClockTick &&
    clockTick % current.config.snapshotEveryTicks === 0
  ) {
    current = { ...current, lastSentClockTick: clockTick };
    for (const side of ["A", "B"] as const) {
      if (current.sessions[side].presence === "GONE") continue;
      const message = encodeSnapshot({
        authority: current.authority,
        side,
        appliedSeq: current.sessions[side].lastAcceptedSeq,
        nowMs,
        history: current.history,
        sinceTick: current.lastSnapshotTick[side],
      });
      current = {
        ...emit(current, side, message),
        lastSnapshotTick: withSideValue(
          current.lastSnapshotTick,
          side,
          message.serverTick,
        ),
      };
    }
    current = {
      ...current,
      stats: { ...current.stats, snapshotsSent: current.stats.snapshotsSent + 2 },
    };
  }
  const result = matchResult(current.authority);
  if (result && !current.resultSent) {
    current = { ...current, resultSent: true };
    for (const side of ["A", "B"] as const) {
      current = emit(current, side, {
        type: "RESULT",
        result,
        outcome: duelOutcome(current.authority.state),
      });
    }
  }
  return current;
}

/**
 * Decide who has gone, and tell each side about the other.
 *
 * Two independent signals, because they mean different things. `silentSides` is
 * @pa/pvp's own policy over accepted intents and is consumed rather than
 * reimplemented — including its rule that a player thinking about an untimed
 * question is never silent. `graceExpired` is the transport's knowledge that a
 * socket actually closed, which arrives sooner and is not inferrable from silence.
 */
function evaluatePresence(host: MatchHost, nowMs: number): MatchHost {
  let current = host;
  if (current.authority.phase !== "LIVE") return current;

  const closed = (["A", "B"] as const).filter((side) =>
    graceExpired(current.sessions[side], nowMs, current.config.graceMs),
  );
  const silent = silentSides(current.authority, nowMs);
  const forfeitable = new Set<DuelSide>([...closed, ...silent]);

  // Only when exactly one side is gone. Both gone is a network partition or a
  // stopped test, and awarding a win to whichever side was checked first would be
  // arbitrary; @pa/pvp's route makes the same call.
  if (forfeitable.size === 1) {
    const side = [...forfeitable][0]!;
    current = {
      ...current,
      authority: forfeitMatch(current.authority, side, "DISCONNECTED"),
      sessions:
        side === "A"
          ? { A: noteGone(current.sessions.A), B: current.sessions.B }
          : { A: current.sessions.A, B: noteGone(current.sessions.B) },
    };
  }

  // Announced on change only. A presence message per poll would be a thousand
  // messages a second saying nothing, and would drown the snapshots on a bad link.
  const presence: BySide<boolean> = {
    A: current.sessions.A.presence === "CONNECTED",
    B: current.sessions.B.presence === "CONNECTED",
  };
  if (
    presence.A !== current.lastPresence.A ||
    presence.B !== current.lastPresence.B
  ) {
    current = { ...current, lastPresence: presence };
    for (const side of ["A", "B"] as const) {
      const other = side === "A" ? current.sessions.B : current.sessions.A;
      current = emit(current, side, {
        type: "OPPONENT_PRESENCE",
        present: side === "A" ? presence.B : presence.A,
        graceEndsAtMs:
          other.droppedAtMs === null ? null : other.droppedAtMs + current.config.graceMs,
      });
    }
  }
  return current;
}

// ---- inbound ----------------------------------------------------------------

export interface ReceiveResult {
  readonly host: MatchHost;
  /** Divergence found by this message, if any. Also appended to `host`. */
  readonly divergence: DivergenceReport | null;
}

export function receive(
  host: MatchHost,
  side: DuelSide,
  message: ClientMessage,
  nowMs: number,
): ReceiveResult {
  switch (message.type) {
    case "INTENTS":
      return { host: receiveIntents(host, side, message, nowMs), divergence: null };
    case "HASH_REPORT":
      return receiveHashReport(host, side, message, nowMs);
    case "RESUME":
      return { host: receiveResume(host, side, message.resumeToken, nowMs), divergence: null };
    case "LEAVE":
      return { host: receiveLeave(host, side), divergence: null };
  }
}

function receiveIntents(
  host: MatchHost,
  side: DuelSide,
  message: Extract<ClientMessage, { type: "INTENTS" }>,
  nowMs: number,
): MatchHost {
  let current = host;
  let session = noteHeard(current.sessions[side], nowMs);
  if (message.ackServerSentAtMs > 0) {
    session = noteRoundTrip(session, nowMs - message.ackServerSentAtMs);
  }

  // Oldest first. Frames the authority has already seen are refused by its own
  // sequence guard, which is precisely what makes a redundant window free: the
  // duplicate handling is not something this file had to build.
  for (const frame of message.frames) {
    const ingested = ingestIntent(current.authority, side, frame, nowMs);
    current = { ...current, authority: ingested.authority };
    session = ingested.ok
      ? noteAccepted(session, frame.seq, current.authority.state.combat.tick, nowMs)
      : noteRejected(session, nowMs);
  }
  return withSession(current, side, session);
}

function receiveHashReport(
  host: MatchHost,
  side: DuelSide,
  message: Extract<ClientMessage, { type: "HASH_REPORT" }>,
  nowMs: number,
): ReceiveResult {
  const session = noteHeard(host.sessions[side], nowMs);
  // Compared against the PREDICTABLE subset, not the full body: a client that has
  // not been told the opponent's position cannot be expected to reproduce a hit it
  // took, and holding it to that standard would bury the real signal in noise.
  const expected = predictableHashAt(host.history, side, message.tick);
  if (expected === null || expected === message.selfHash) {
    return { host: withSession(host, side, session), divergence: null };
  }

  const report = buildDivergenceReport({
    kind: "CLIENT_SELF_MISMATCH",
    matchId: host.authority.identity.matchId,
    seed: host.authority.identity.seed,
    side,
    tick: message.tick,
    round: host.authority.state.round,
    history: host.history,
    reportedHash: message.selfHash,
    params: host.authority.state.params,
    observedAtMs: nowMs,
    note: `client appliedSeq=${message.appliedSeq} serverAppliedSeq=${session.lastAcceptedSeq}`,
  });
  if (!report) return { host: withSession(host, side, session), divergence: null };

  const withReport: MatchHost = {
    ...withSession(host, side, {
      ...session,
      divergencesReported: session.divergencesReported + 1,
    }),
    divergences: [...host.divergences, report],
    stats: {
      ...host.stats,
      divergencesDetected: host.stats.divergencesDetected + 1,
    },
  };
  // A correction, not a punishment: the client is told the truth and rebases. Its
  // claim never touched the simulation, so there is nothing to roll back.
  return {
    host: sendResync(withReport, side, "DIVERGENCE_CORRECTION", nowMs),
    divergence: report,
  };
}

function receiveResume(
  host: MatchHost,
  side: DuelSide,
  token: string,
  nowMs: number,
): MatchHost {
  const attempt = resumeSession(host.sessions[side], token, nowMs, host.config.graceMs);
  if (!attempt.ok) {
    return emit(host, side, {
      type: "REJECTED",
      reason: "RESUME_REFUSED",
      detail: attempt.reason,
    });
  }
  const resumed = withSession(host, side, attempt.session);
  return sendResync(resumed, side, "RECONNECT", nowMs);
}

function receiveLeave(host: MatchHost, side: DuelSide): MatchHost {
  // An explicit leave is ABANDONED, never DISCONNECTED: the distinction is the
  // whole of "you may come back from a dropped connection, but not from quitting".
  return {
    ...withSession(host, side, noteGone(host.sessions[side])),
    authority: forfeitMatch(host.authority, side, "ABANDONED"),
  };
}

/** The transport telling the host a socket closed. Starts the grace window. */
export function detach(host: MatchHost, side: DuelSide, nowMs: number): MatchHost {
  return withSession(host, side, noteDropped(host.sessions[side], nowMs));
}
