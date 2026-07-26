// The browser end: sample input, predict, render, verify, reconnect.
//
// Like the host, this is a VALUE. It has no timers, no sockets and no clock reads —
// `nowMs` is a parameter and messages go in and out through plain arrays — because
// a network client that can only be exercised by starting two browsers is a network
// client whose bugs are found by students.
//
// FOUR POLICIES LIVE HERE AND EACH ONE WAS DERIVED, NOT CHOSEN. Three of them are
// answers to bugs the divergence detector found rather than to bugs anyone predicted.
//
// 1. HOW AN INTENT IS STAMPED. @pa/pvp accepts a frame within +8 / -12 ticks of the
//    server's own tick. A client that stamps frames with its best estimate of the
//    server tick RIGHT NOW is wrong by a full round trip by the time the frame
//    lands, because the estimate was already half a trip stale when it was made and
//    the packet then spends another half getting there. At 200 ms that is 12 ticks —
//    exactly the rejection boundary. So the stamp leads by the measured round trip,
//    which puts the frame on the tick that will actually apply it, and the lead is
//    clamped to @pa/pvp's own limit rather than to a number invented here. See
//    `stampTickFor`, and `estimatedServerTick` beneath it, which must not extrapolate
//    through the phases where the combat tick does not advance.
//
// 2. HOW A SEQUENCE IS CHOSEN. Monotonic, and never below the highest the server
//    says it has applied. That one rule solves two problems at once: it lets the
//    client resume after a reconnect without every frame being refused as a replay,
//    and it makes the sequence self-heal if the server ever accepts something the
//    client did not think it had sent.
//
// 3. WHAT GETS RE-SENT. Every datagram carries the last few frames, not just the
//    newest. The authority drops duplicates by sequence, so redundancy costs
//    nothing but bytes and buys immunity to the case the brief singles out: a
//    dropped input at the moment of a shot.
//
// 4. WHICH INPUTS ARE LATCHED, which is the correction to policy 3. Batching frames
//    into one datagram means only the newest is ever in force, so redundancy on its
//    own silently ATE one-frame presses on a perfect link. Momentary inputs are held
//    until acknowledged; see `LATCHED_PRESSES`.
//
// What is predicted and what is never predicted is `prediction.ts`'s decision, not
// this file's; this file only decides what to send and when to believe a correction.

import {
  FIELD_TICK_HZ,
  type CombatIntent,
  type CombatParams,
  type CollisionWorld,
  type DuelPhase,
  type DuelSide,
  type FighterState,
  type Vec3,
} from "@pa/duel";
import {
  MAX_INTENT_LEAD_TICKS,
  toCombatIntent,
  type ClientIntentFrame,
} from "../pvpPort.js";
import {
  decodeFighter,
  INTENT_REDUNDANCY_FRAMES,
  type ClientMessage,
  type RecordedIntent,
  type ResyncMessage,
  type ServerMessage,
  type SnapshotMessage,
} from "../protocol.js";
import {
  createOpponentBuffer,
  interpolationDelayTicks,
  newestTick,
  observeSnapshot,
  opponentAt,
  type InterpolatedOpponent,
  type OpponentBuffer,
} from "./interpolation.js";
import {
  absorbCorrection,
  baselineFrom,
  decayOffset,
  predict,
  ZERO_OFFSET,
  type Baseline,
  type PredictionResult,
  type SmoothedOffset,
} from "./prediction.js";

export interface ClientConfig {
  readonly world: CollisionWorld;
  readonly params: CombatParams;
  readonly sendEveryMs: number;
  readonly redundancy: number;
  /** Clamp on how far ahead a frame may be stamped. @pa/pvp's bound by default. */
  readonly maxLeadTicks: number;
}

export function clientConfig(
  world: CollisionWorld,
  params: CombatParams,
  overrides: Partial<Omit<ClientConfig, "world" | "params">> = {},
): ClientConfig {
  return {
    // 30 Hz. Double the snapshot rate, because input latency is felt and snapshot
    // latency is hidden by interpolation, so the asymmetry is the right way round.
    sendEveryMs: 1000 / 30,
    redundancy: INTENT_REDUNDANCY_FRAMES,
    maxLeadTicks: MAX_INTENT_LEAD_TICKS,
    ...overrides,
    world,
    params,
  };
}

export interface ClientStats {
  readonly framesSent: number;
  readonly snapshotsApplied: number;
  readonly resyncsApplied: number;
  readonly correctionsAbsorbed: number;
  /** Sum of correction magnitudes in metres. Divided by count, this is the feel. */
  readonly correctionMetres: number;
  readonly worstCorrectionMetres: number;
  readonly comparisonsMade: number;
  readonly comparisonsSkipped: number;
  readonly divergencesFound: number;
  readonly stepsReplayedTotal: number;
  /**
   * Why comparisons were skipped, by reason.
   *
   * Kept rather than summed into one number because the reasons mean very different
   * things operationally. A rising SPAN_INCOMPLETE is packet loss; a rising
   * FRAME_EVICTED means the input log is too short for the link's latency and the
   * detector has quietly stopped watching; HEALTH_CHANGED and ABILITY_USED are
   * expected and benign. One combined counter would hide the two that matter behind
   * the two that do not.
   */
  readonly skipped: Readonly<Record<SkipReason, number>>;
}

export type SkipReason =
  | "NO_BASELINE"
  | "SPAN_INCOMPLETE"
  | "HEALTH_CHANGED"
  | "FRAME_EVICTED"
  | "ABILITY_USED";

const NO_SKIPS: Readonly<Record<SkipReason, number>> = {
  NO_BASELINE: 0,
  SPAN_INCOMPLETE: 0,
  HEALTH_CHANGED: 0,
  FRAME_EVICTED: 0,
  ABILITY_USED: 0,
};

const EMPTY_STATS: ClientStats = {
  framesSent: 0,
  snapshotsApplied: 0,
  resyncsApplied: 0,
  correctionsAbsorbed: 0,
  correctionMetres: 0,
  worstCorrectionMetres: 0,
  comparisonsMade: 0,
  comparisonsSkipped: 0,
  divergencesFound: 0,
  stepsReplayedTotal: 0,
  skipped: NO_SKIPS,
};

/**
 * How wrong the client turned out to be about a tick the server has now spoken for.
 *
 * THE ONLY HONEST SMOOTHNESS NUMBER. It is tempting to measure "the client's position
 * now" against "the server's position now", and that number is garbage: the client is
 * deliberately ahead of the server by about a round trip, so a correctly working
 * prediction scores badly on it. What a player actually feels is the CORRECTION —
 * the gap between what the client had already drawn for tick T and what the server
 * later says tick T was — and that is what this records.
 */
export interface Reconciliation {
  readonly tick: number;
  readonly metres: number;
  /** True when the digests matched exactly. */
  readonly exact: boolean;
  /**
   * Both bodies, kept so a dev overlay or a test can say WHICH field disagreed.
   *
   * Position matching while the digest does not is a real and common case — a stale
   * fire cooldown, a dash window one tick out — and "the hashes differ" without the
   * two states is the unfalsifiable report this package exists to replace. They are
   * immutable values already held elsewhere, so keeping them costs a reference.
   */
  readonly predicted: FighterState;
  readonly authoritative: FighterState;
}

export interface NetClient {
  readonly side: DuelSide;
  readonly config: ClientConfig;
  readonly baseline: Baseline | null;
  readonly opponent: OpponentBuffer;
  /**
   * Every recent local frame, acknowledged or not, oldest first.
   *
   * NOT trimmed to the unacknowledged ones, and that distinction is load-bearing. A
   * client samples at 60 Hz and sends at 30 Hz, so plenty of server ticks run with a
   * frame the server has ALREADY acknowledged still in force. Reproducing such a tick
   * needs that frame, and a log trimmed at the acknowledgement boundary has thrown it
   * away — which silently turns the divergence detector off for most spans.
   */
  readonly log: readonly RecordedIntent[];
  readonly nextSeq: number;
  readonly lastReconciliation: Reconciliation | null;
  /** Open press latches, per momentary input. See `LATCHED_PRESSES`. */
  readonly latches: {
    readonly fire: { readonly seq: number; readonly frames: number } | null;
    readonly jump: { readonly seq: number; readonly frames: number } | null;
    readonly dodge: { readonly seq: number; readonly frames: number } | null;
    readonly ability: { readonly seq: number; readonly frames: number } | null;
  };
  readonly latchedAbilityId: string | null;
  readonly lastSnapshotAtMs: number | null;
  readonly lastSnapshotTick: number;
  readonly lastSnapshotSentAtMs: number;
  readonly phase: DuelPhase;
  readonly round: number;
  readonly clockTick: number;
  readonly phaseEndsAtTick: number | null;
  readonly rttMs: number | null;
  readonly resumeToken: string | null;
  readonly outbox: readonly ClientMessage[];
  readonly lastSendAtMs: number;
  readonly offset: SmoothedOffset;
  readonly lastDrawnPos: Vec3 | null;
  readonly stats: ClientStats;
  readonly divergentTicks: readonly number[];
  readonly connected: boolean;
}

/** Two seconds of input at 60 Hz. Longer than any span a snapshot can describe. */
const LOG_WINDOW_FRAMES = 120;

/** Frames still awaiting acknowledgement: the ones a prediction must replay. */
export function unappliedFrames(client: NetClient): readonly RecordedIntent[] {
  const applied = client.baseline?.appliedSeq ?? 0;
  return client.log.filter((entry) => entry.seq > applied);
}

export function createClient(side: DuelSide, config: ClientConfig): NetClient {
  return {
    side,
    config,
    baseline: null,
    opponent: createOpponentBuffer(),
    log: [],
    nextSeq: 1,
    lastReconciliation: null,
    latches: { fire: null, jump: null, dodge: null, ability: null },
    latchedAbilityId: null,
    lastSnapshotAtMs: null,
    lastSnapshotTick: 0,
    lastSnapshotSentAtMs: 0,
    phase: "FACE_OFF",
    round: 0,
    clockTick: 0,
    phaseEndsAtTick: null,
    rttMs: null,
    resumeToken: null,
    outbox: [],
    lastSendAtMs: Number.NEGATIVE_INFINITY,
    offset: ZERO_OFFSET,
    lastDrawnPos: null,
    stats: EMPTY_STATS,
    divergentTicks: [],
    connected: true,
  };
}

// ---- clock estimation -------------------------------------------------------

/**
 * The server's combat tick right now, as best this client can tell.
 *
 * Deliberately does NOT include the travel time of the snapshot that produced the
 * estimate: this is "what the server had done when it spoke", advanced by local
 * elapsed time. Adding the travel correction here would double-count it in
 * `stampTickFor`, which is where it belongs.
 */
export function estimatedServerTick(client: NetClient, nowMs: number): number {
  if (client.lastSnapshotAtMs === null) return client.lastSnapshotTick;
  // THE COMBAT TICK ONLY ADVANCES IN A LIVE ENGAGEMENT, and extrapolating it through
  // the phases where it does not is a bug with a long fuse. `stepCombat` runs only
  // from `stepEngagement`, so the face-off, the untimed question, the three-second
  // grant countdown and the reload break all leave the combat tick frozen while wall
  // time keeps passing. A client that adds elapsed milliseconds to it regardless
  // drifts hundreds of ticks ahead during a question, every frame it then sends is
  // refused as TICK_TOO_FAR_AHEAD, and play resumes with the server holding a stale
  // intent and the player's controls apparently dead for a moment. The field clock is
  // the one that runs in those phases, and it is carried separately for exactly this
  // reason.
  if (client.phase !== "ENGAGEMENT_LIVE") return client.lastSnapshotTick;
  const elapsed = Math.max(0, nowMs - client.lastSnapshotAtMs);
  return client.lastSnapshotTick + Math.floor((elapsed / 1000) * FIELD_TICK_HZ);
}

/**
 * The tick to stamp on a frame sent now: the tick the server will be on when the
 * frame arrives.
 *
 * The lead is the full measured round trip — half of it undoes the staleness of the
 * estimate above, half of it covers the outbound flight — clamped to @pa/pvp's own
 * acceptance limit, imported rather than restated so the two cannot drift apart.
 *
 * The clamp is what caps this design's usable latency, and the number is worth
 * knowing: with an 8-tick lead bound a client can compensate 133 ms of round trip,
 * and the remaining lag is absorbed by the 12-tick lag window, so frames are
 * accepted up to roughly 350 ms of round trip and refused above it. That is
 * comfortably past a bad school link and short of a satellite one.
 */
export function stampTickFor(client: NetClient, nowMs: number): number {
  const base = estimatedServerTick(client, nowMs);
  if (client.rttMs === null) return base;
  const leadTicks = Math.round((client.rttMs / 1000) * FIELD_TICK_HZ);
  return base + Math.min(leadTicks, client.config.maxLeadTicks);
}

// ---- input ------------------------------------------------------------------

/**
 * Momentary presses that must survive being batched, and how long each may be held.
 *
 * THE BUG THIS EXISTS TO FIX, BECAUSE IT IS NOT OBVIOUS AND IT COST A SHOT.
 *
 * @pa/pvp's authority keeps ONE held intent per side, replaced by each accepted
 * frame. When a datagram carries several frames — which is the whole point of the
 * redundant window — they are ingested back to back with no tick in between, so only
 * the LAST one is ever in force. A fire press sampled on a frame that is not the
 * newest in its datagram is therefore applied for zero ticks and simply never
 * happens. Redundancy, added to protect a shot from packet loss, was quietly eating
 * shots on a perfect link.
 *
 * The fix is to latch: once a press is sampled it stays set on every frame until the
 * server acknowledges a frame at or after it. Because every frame from the press
 * onward carries the bit, an acknowledgement at or beyond that sequence PROVES a
 * frame carrying it was applied. Double-firing is not a risk: every one of these is
 * gated server-side by a window far longer than a round trip — the fire interval, the
 * dodge cooldown, being grounded, one ability use per duel — so holding the request
 * for a few frames requests the same single action.
 *
 * The better fix belongs upstream: `ingestIntent` could OR these bits across the
 * frames accepted since the last tick, which needs no latch and no cap. That is in
 * @pa/pvp, so it is reported rather than reached into.
 */
const LATCHED_PRESSES = ["fire", "jump", "dodge"] as const;
type LatchedPress = (typeof LATCHED_PRESSES)[number];

/** Ceiling on a latch, in sampled frames. ~500 ms, well under every gate above. */
export const MAX_LATCH_FRAMES = 30;

interface Latch {
  readonly seq: number;
  readonly frames: number;
}

/**
 * Record one tick of local will.
 *
 * The sequence never goes below what the server has already applied, which is what
 * makes a reconnect work: @pa/pvp refuses any frame at or below the last accepted
 * sequence, so a client that resumes and restarts at 1 has every frame silently
 * dropped and the player sees dead controls with no error anywhere.
 */
export function sampleInput(
  client: NetClient,
  intent: CombatIntent,
  nowMs: number,
): NetClient {
  const floor = (client.baseline?.appliedSeq ?? 0) + 1;
  const seq = Math.max(client.nextSeq, floor);
  const applied = client.baseline?.appliedSeq ?? 0;

  const latches: Record<LatchedPress, Latch | null> = {
    fire: client.latches.fire,
    jump: client.latches.jump,
    dodge: client.latches.dodge,
  };
  const pressed: Record<LatchedPress, boolean> = { fire: false, jump: false, dodge: false };
  for (const press of LATCHED_PRESSES) {
    const open = latches[press];
    // An open latch stays open until the server acknowledges a frame at or after the
    // one that opened it, and never longer than the cap.
    const waiting = open !== null && open.seq > applied && open.frames < MAX_LATCH_FRAMES;
    if (intent[press]) {
      latches[press] = waiting && open ? { ...open, frames: open.frames + 1 } : { seq, frames: 0 };
      pressed[press] = true;
    } else if (waiting && open) {
      latches[press] = { ...open, frames: open.frames + 1 };
      pressed[press] = true;
    } else {
      latches[press] = null;
      pressed[press] = false;
    }
  }

  // An ability id is latched the same way, but it is a value rather than a flag, so
  // it is carried rather than OR-ed.
  const abilityLatch = client.latches.ability ?? null;
  let abilityId = intent.abilityId;
  let nextAbilityLatch: Latch | null = null;
  if (intent.abilityId !== null) {
    nextAbilityLatch = { seq, frames: 0 };
  } else if (
    abilityLatch !== null &&
    abilityLatch.seq > applied &&
    abilityLatch.frames < MAX_LATCH_FRAMES
  ) {
    nextAbilityLatch = { ...abilityLatch, frames: abilityLatch.frames + 1 };
    abilityId = client.latchedAbilityId;
  }

  const frame: ClientIntentFrame = {
    seq,
    tick: stampTickFor(client, nowMs),
    moveX: intent.moveX,
    moveZ: intent.moveZ,
    sprint: intent.sprint,
    crouch: intent.crouch,
    jump: pressed.jump,
    dodge: pressed.dodge,
    fire: pressed.fire,
    aimX: intent.aimX,
    aimZ: intent.aimZ,
    abilityId,
  };
  const recorded: RecordedIntent = {
    seq,
    tick: frame.tick,
    frame,
    // Normalised through @pa/pvp's own projection, which is the function the server
    // will run on the very same frame. Predicting with the raw vector instead
    // diverges on tick one; see the note on `RecordedIntent`.
    intent: toCombatIntent(frame),
  };
  const log = [...client.log, recorded];
  return {
    ...client,
    log: log.length > LOG_WINDOW_FRAMES ? log.slice(-LOG_WINDOW_FRAMES) : log,
    nextSeq: seq + 1,
    latches: { ...latches, ability: nextAbilityLatch },
    latchedAbilityId: intent.abilityId ?? client.latchedAbilityId,
  };
}

/** Queue a datagram if the send interval has elapsed. */
export function tickSend(client: NetClient, nowMs: number): NetClient {
  if (nowMs - client.lastSendAtMs < client.config.sendEveryMs) return client;
  const unsent = unappliedFrames(client);
  if (unsent.length === 0) return { ...client, lastSendAtMs: nowMs };

  // Sent verbatim as sampled. Rebuilding the frame from the normalised intent would
  // put the vector through normalisation twice, once here and once on the server, and
  // the second pass is not guaranteed to be the identity.
  const frames = unsent.slice(-client.config.redundancy).map((entry) => entry.frame);

  return {
    ...client,
    lastSendAtMs: nowMs,
    outbox: [
      ...client.outbox,
      {
        type: "INTENTS",
        frames,
        ackServerTick: client.lastSnapshotTick,
        ackServerSentAtMs: client.lastSnapshotSentAtMs,
      },
    ],
    stats: { ...client.stats, framesSent: client.stats.framesSent + frames.length },
  };
}

export function drainClient(client: NetClient): {
  client: NetClient;
  messages: readonly ClientMessage[];
} {
  if (client.outbox.length === 0) return { client, messages: [] };
  return { client: { ...client, outbox: [] }, messages: client.outbox };
}

// ---- inbound ----------------------------------------------------------------

export function receiveServer(
  client: NetClient,
  message: ServerMessage,
  nowMs: number,
): NetClient {
  switch (message.type) {
    case "WELCOME":
      return applyResync(
        { ...client, resumeToken: message.resumeToken, connected: true },
        message.resync,
        nowMs,
      );
    case "RESYNC":
      return applyResync(client, message, nowMs);
    case "SNAPSHOT":
      return applySnapshot(client, message, nowMs);
    case "OPPONENT_PRESENCE":
    case "RESULT":
    case "REJECTED":
      return client;
  }
}

function commonUpdate(
  client: NetClient,
  message: SnapshotMessage | ResyncMessage,
  nowMs: number,
  authoritative: boolean,
): NetClient {
  const sample = nowMs - message.sentAtMs;
  // One-way, so the round trip is twice it. Same 1/8 smoothing the host uses;
  // matching them keeps the two ends' idea of the link from disagreeing.
  const rttSample = Math.max(0, sample) * 2;
  const rttMs =
    client.rttMs === null ? rttSample : client.rttMs * 0.875 + rttSample * 0.125;

  // A LATE PACKET MUST NOT REWIND THE CLOCK. Jitter reorders arrivals, so a snapshot
  // for an older tick can land after a newer one. Its opponent sample is still
  // useful — the interpolation buffer is keyed by tick and merges it in the right
  // place — but adopting its clock, phase or deadline would drag the client's idea of
  // "now" backwards, which then mis-stamps the next intents and mis-sizes the next
  // comparison span. A resync is exempt: it is authoritative by definition.
  const stale = !authoritative && message.serverTick < client.lastSnapshotTick;
  const buffered = {
    ...client,
    opponent: observeSnapshot(client.opponent, message.view, nowMs),
    rttMs,
    connected: true,
  };
  if (stale) return buffered;

  return {
    ...buffered,
    lastSnapshotAtMs: nowMs,
    lastSnapshotTick: message.serverTick,
    lastSnapshotSentAtMs: message.sentAtMs,
    phase: message.view.phase,
    round: message.view.round,
    clockTick: message.clockTick,
    phaseEndsAtTick: message.phaseEndsAtTick,
  };
}

/**
 * A hard rebase. Everything predicted is discarded, including inputs that have not
 * been acknowledged.
 *
 * Discarding unacknowledged input looks lossy and is correct: a resync happens at a
 * round barrier, on reconnect, or after a divergence, and in all three cases the
 * inputs in flight describe a world that no longer exists. Replaying them onto the
 * new baseline would reintroduce exactly the drift the resync exists to clear.
 */
function applyResync(client: NetClient, message: ResyncMessage, nowMs: number): NetClient {
  const updated = commonUpdate(client, message, nowMs, true);
  return {
    ...updated,
    baseline: baselineFrom({
      tick: message.serverTick,
      round: message.view.round,
      self: message.self,
      opponentPos: message.view.opponent.position,
      opponentCapsuleHeight: message.view.opponent.capsuleHeight,
      appliedSeq: message.appliedSeq,
      selfHash: message.predictableHash,
    }),
    log: [],
    nextSeq: Math.max(client.nextSeq, message.resumeFromSeq),
    offset: ZERO_OFFSET,
    lastDrawnPos: null,
    lastReconciliation: null,
    stats: { ...updated.stats, resyncsApplied: updated.stats.resyncsApplied + 1 },
  };
}

function applySnapshot(
  client: NetClient,
  message: SnapshotMessage,
  nowMs: number,
): NetClient {
  // Out of order: the newer baseline already supersedes it, and the opponent buffer
  // has taken the position it carried, which is the only part still useful.
  if (client.baseline && message.serverTick <= client.baseline.tick) {
    return commonUpdate(client, message, nowMs, false);
  }

  const verified = verifyAgainst(client, message);
  const updated = commonUpdate(verified, message, nowMs, false);
  const baseline = baselineFrom({
    tick: message.serverTick,
    round: message.view.round,
    self: message.self,
    opponentPos: message.view.opponent.position,
    opponentCapsuleHeight: message.view.opponent.capsuleHeight,
    appliedSeq: message.appliedSeq,
    selfHash: message.predictableHash,
  });

  return {
    ...updated,
    baseline,
    // The log is NOT trimmed at the acknowledgement boundary; `unappliedFrames`
    // derives what still needs replaying. See the note on `NetClient.log`.
    nextSeq: Math.max(client.nextSeq, message.appliedSeq + 1),
    // Whatever the client had already drawn for this tick is now superseded, so the
    // gap between the two becomes a render-space offset that decays over a few
    // frames rather than a visible jump.
    offset: verified.lastReconciliation
      ? { ...verified.offset }
      : verified.offset,
    stats: {
      ...updated.stats,
      snapshotsApplied: updated.stats.snapshotsApplied + 1,
    },
  };
}

/**
 * Reproduce the server's own span and compare.
 *
 * This is the detection half of the package, and the reason it is exact rather
 * than heuristic is `appliedSeqByTick`: the server states which of this client's
 * frames was in force on each tick of the span, so the client re-runs the identical
 * input sequence from the identical baseline. Any difference in the result is a
 * difference in the SIMULATION, which is the only thing worth reporting.
 */
function verifyAgainst(client: NetClient, message: SnapshotMessage): NetClient {
  const baseline = client.baseline;
  if (!baseline) return skipComparison(client, "NO_BASELINE");
  const span = message.appliedSeqByTick;
  if (span.length === 0 || span.length !== message.serverTick - baseline.tick) {
    return skipComparison(client, "SPAN_INCOMPLETE");
  }
  // Damage is never predicted, so a span that contains a hit is not comparable and
  // reporting it would be reporting a limitation of prediction as a bug.
  if (message.healthChangedInSpan) return skipComparison(client, "HEALTH_CHANGED");

  const bySeq = new Map(client.log.map((entry) => [entry.seq, entry]));
  const replay: RecordedIntent[] = [];
  for (let index = 0; index < span.length; index++) {
    const seq = span[index]!;
    const frame = bySeq.get(seq);
    // The server applied a frame this client no longer holds, which happens after a
    // resync cleared the log. Not a divergence; just unverifiable.
    if (!frame) return skipComparison(client, "FRAME_EVICTED");
    // An ability invocation is gated server-side on a line of sight to the real
    // opponent, and this client's opponent is an interpolated ghost, so the two can
    // legitimately disagree about whether the ability opened. One use per ability
    // per duel makes this at most a couple of spans a match.
    if (frame.intent.abilityId !== null) return skipComparison(client, "ABILITY_USED");
    replay.push({ ...frame, seq: baseline.appliedSeq + index + 1 });
  }

  const seat = seatFromBuffer(client);
  const result = predict(
    { world: client.config.world, side: client.side, params: client.config.params },
    { ...baseline, appliedSeq: baseline.appliedSeq },
    replay,
    seat,
  );
  const agrees = result.predictableHash === message.predictableHash;
  const authoritative = decodeFighter(message.self);
  const truth = authoritative.motion.pos;
  const predicted = result.self.motion.pos;
  const metres = Math.hypot(
    predicted.x - truth.x,
    predicted.y - truth.y,
    predicted.z - truth.z,
  );
  const reconciliation: Reconciliation = {
    tick: message.serverTick,
    metres,
    exact: agrees,
    predicted: result.self,
    authoritative,
  };
  const measured: NetClient = {
    ...client,
    lastReconciliation: reconciliation,
    offset: absorbCorrection(client.offset, predicted, truth),
    stats: {
      ...client.stats,
      comparisonsMade: client.stats.comparisonsMade + 1,
      correctionsAbsorbed: metres > 1e-9 ? client.stats.correctionsAbsorbed + 1 : client.stats.correctionsAbsorbed,
      correctionMetres: client.stats.correctionMetres + metres,
      worstCorrectionMetres: Math.max(client.stats.worstCorrectionMetres, metres),
    },
  };
  if (agrees) return measured;

  return {
    ...measured,
    divergentTicks: [...measured.divergentTicks, message.serverTick],
    outbox: [
      ...measured.outbox,
      {
        type: "HASH_REPORT",
        tick: message.serverTick,
        selfHash: result.predictableHash,
        appliedSeq: message.appliedSeq,
      },
    ],
    stats: {
      ...measured.stats,
      divergencesFound: measured.stats.divergencesFound + 1,
    },
  };
}

function skipComparison(client: NetClient, reason: SkipReason): NetClient {
  return {
    ...client,
    stats: {
      ...client.stats,
      comparisonsSkipped: client.stats.comparisonsSkipped + 1,
      skipped: { ...client.stats.skipped, [reason]: client.stats.skipped[reason] + 1 },
    },
  };
}

// ---- what to draw -----------------------------------------------------------

function seatFromBuffer(client: NetClient) {
  const fallback = client.baseline;
  return (tick: number) => {
    const pose = opponentAt(client.opponent, tick);
    if (pose) return { pos: pose.pos, capsuleHeight: pose.capsuleHeight };
    return {
      pos: fallback?.opponentPos ?? { x: 0, y: 0, z: 0 },
      capsuleHeight: fallback?.opponentCapsuleHeight ?? 1.8,
    };
  };
}

export interface RenderView {
  readonly self: PredictionResult["self"] | null;
  readonly localProjectiles: PredictionResult["localProjectiles"];
  readonly opponent: InterpolatedOpponent | null;
  /** Add to the predicted position at DRAW TIME only; never fed back into the sim. */
  readonly drawOffset: SmoothedOffset;
  readonly serverTick: number;
  readonly phase: DuelPhase;
  readonly round: number;
  /** Server-owned. Null while the phase is genuinely untimed. */
  readonly secondsRemaining: number | null;
  readonly interpolationDelayTicks: number;
  readonly stepsReplayed: number;
}

/**
 * Everything a renderer needs for one frame, and nothing it could cheat with.
 *
 * Note the two clocks in play. The local body is drawn at the PREDICTED tick, which
 * is slightly in the future of the last snapshot. The opponent is drawn at the
 * INTERPOLATION tick, which is slightly in the past of it. Both players see
 * themselves in the present and each other in the past, which is the standard
 * arrangement and the one that makes a slow-projectile duel read correctly: you
 * lead a target over a 900 ms flight either way, so the fixed offset is absorbed
 * into the lead rather than felt as lag.
 */
export function renderView(client: NetClient): RenderView {
  const delay = interpolationDelayTicks(client.opponent, FIELD_TICK_HZ);
  const newest = newestTick(client.opponent);
  const opponent = newest === null ? null : opponentAt(client.opponent, newest - delay);

  if (!client.baseline) {
    return {
      self: null,
      localProjectiles: [],
      opponent,
      drawOffset: client.offset,
      serverTick: client.lastSnapshotTick,
      phase: client.phase,
      round: client.round,
      secondsRemaining: remainingSeconds(client),
      interpolationDelayTicks: delay,
      stepsReplayed: 0,
    };
  }

  const predicted = predict(
    { world: client.config.world, side: client.side, params: client.config.params },
    client.baseline,
    unappliedFrames(client),
    seatFromBuffer(client),
  );

  return {
    self: predicted.self,
    localProjectiles: predicted.localProjectiles,
    opponent,
    drawOffset: client.offset,
    serverTick: predicted.tick,
    phase: client.phase,
    round: client.round,
    secondsRemaining: remainingSeconds(client),
    interpolationDelayTicks: delay,
    stepsReplayed: predicted.stepsReplayed,
  };
}

function remainingSeconds(client: NetClient): number | null {
  if (client.phaseEndsAtTick === null) return null;
  return Math.max(0, (client.phaseEndsAtTick - client.clockTick) / FIELD_TICK_HZ);
}

/**
 * Retire a slice of the render-space correction offset. Called once per drawn frame.
 *
 * The offset itself is created when a snapshot lands and the client learns it had
 * drawn a tick in the wrong place; this only decays it. Keeping creation and decay in
 * different functions is what keeps the smoothing purely presentational: nothing here
 * touches the prediction, and the offset is never read back into it.
 */
export function absorbFrame(client: NetClient): NetClient {
  const view = renderView(client);
  if (!view.self) return client;
  return {
    ...client,
    lastDrawnPos: { ...view.self.motion.pos },
    offset: decayOffset(client.offset),
    stats: {
      ...client.stats,
      stepsReplayedTotal: client.stats.stepsReplayedTotal + view.stepsReplayed,
    },
  };
}

// ---- reconnect --------------------------------------------------------------

export function markDisconnected(client: NetClient): NetClient {
  return { ...client, connected: false };
}

/**
 * Ask to come back.
 *
 * The pending log is cleared here rather than on the resync that answers, because
 * anything still in it describes ticks the server has long since simulated without
 * it. Sending it would only earn a pile of TICK_TOO_FAR_BEHIND rejections.
 */
export function requestResume(client: NetClient): NetClient {
  if (client.resumeToken === null) return client;
  return {
    ...client,
    log: [],
    outbox: [...client.outbox, { type: "RESUME", resumeToken: client.resumeToken }],
  };
}

export function requestLeave(client: NetClient): NetClient {
  return { ...client, outbox: [...client.outbox, { type: "LEAVE" }] };
}
