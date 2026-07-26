// The server's tick history: what was true, and what was asked for, at every tick.
//
// This is the difference between fixing a desync once and chasing it all year. A
// divergence with no history is a complaint; a divergence with the baseline state
// and the exact input sequence that produced it is a unit test.
//
// CHECKPOINTS ARE FREE HERE, AND THAT IS NOT LUCK. @pa/duel's reducer is
// persistent — every step returns a new immutable CombatState rather than mutating
// one — so keeping a checkpoint is keeping a reference. There is no copy, no
// structured clone and no serialisation on the hot path. A system built on mutable
// state would have to choose between the cost of snapshotting and the ability to
// reproduce a bug; this one does not have to choose.
//
// THE RING IS BOUNDED BY THE ROUND, NOT BY A GUESS. A barrier resync happens every
// round (see barrier.ts), so nothing older than one round can be needed to explain
// a divergence. The window is sized to one round plus slack, and the retention
// policy is therefore derived from the game's shape rather than picked.

import type { BySide, CombatIntent, CombatState, DuelSide } from "@pa/duel";
import {
  hashCombatState,
  hashPredictable,
  hashSelf,
  type StateHash,
} from "./hash.js";

export interface TickRecord {
  readonly tick: number;
  /** Hash of the whole authoritative state. What a server replay must reproduce. */
  readonly stateHash: StateHash;
  /** Per-side hash of that side's complete body. The audit record. */
  readonly selfHashes: BySide<StateHash>;
  /**
   * Per-side hash of the locally predictable subset. The only surface on which a
   * client's claim is comparable; see `hashPredictable`.
   */
  readonly predictableHashes: BySide<StateHash>;
  /** Exactly the intents the authority applied on this tick. */
  readonly intents: BySide<CombatIntent>;
  /** Highest accepted sequence per side at this tick, for reconciliation. */
  readonly appliedSeq: BySide<number>;
  /** Per-side health at this tick. A change voids a client comparison window. */
  readonly health: BySide<number>;
}

export interface Checkpoint {
  readonly tick: number;
  readonly state: CombatState;
  readonly round: number;
}

export interface TickHistory {
  readonly records: readonly TickRecord[];
  readonly checkpoints: readonly Checkpoint[];
  /** Rolling digest of every stateHash in order. One number for a whole match. */
  readonly chain: StateHash;
  readonly windowTicks: number;
  readonly checkpointIntervalTicks: number;
}

/** One round of engagement plus the break, plus a second of slack. */
export const DEFAULT_HISTORY_WINDOW_TICKS = 1400;
/** Five seconds. Bounds the replay a divergence report has to carry. */
export const DEFAULT_CHECKPOINT_INTERVAL_TICKS = 300;

export function createHistory(
  windowTicks = DEFAULT_HISTORY_WINDOW_TICKS,
  checkpointIntervalTicks = DEFAULT_CHECKPOINT_INTERVAL_TICKS,
): TickHistory {
  return {
    records: [],
    checkpoints: [],
    chain: "0000000000000000",
    windowTicks,
    checkpointIntervalTicks,
  };
}

function chainNext(previous: StateHash, tickHash: StateHash): StateHash {
  // Folded as text rather than as numbers: the inputs are already well-mixed
  // digests, and text folding keeps the chain reproducible by anything that can
  // read the log, including a script that never imports this package.
  let lo = 0x811c9dc5;
  let hi = 0x9e3779b9;
  const combined = `${previous}:${tickHash}`;
  for (let index = 0; index < combined.length; index++) {
    const code = combined.charCodeAt(index);
    lo = Math.imul(lo ^ code, 0x01000193) >>> 0;
    hi = Math.imul(hi ^ code, 0x85ebca6b) >>> 0;
  }
  return (lo >>> 0).toString(16).padStart(8, "0") + (hi >>> 0).toString(16).padStart(8, "0");
}

export interface RecordTickInput {
  readonly state: CombatState;
  readonly round: number;
  readonly intents: BySide<CombatIntent>;
  readonly appliedSeq: BySide<number>;
  /** Force a checkpoint regardless of the interval; the barrier uses this. */
  readonly checkpoint?: boolean;
}

export function recordTick(history: TickHistory, input: RecordTickInput): TickHistory {
  const stateHash = hashCombatState(input.state);
  const record: TickRecord = {
    tick: input.state.tick,
    stateHash,
    selfHashes: {
      A: hashSelf(input.state.fighters.A),
      B: hashSelf(input.state.fighters.B),
    },
    predictableHashes: {
      A: hashPredictable(input.state.fighters.A),
      B: hashPredictable(input.state.fighters.B),
    },
    intents: input.intents,
    appliedSeq: input.appliedSeq,
    health: { A: input.state.fighters.A.health, B: input.state.fighters.B.health },
  };

  const records = [...history.records, record];
  const oldest = record.tick - history.windowTicks;
  const trimmed = records[0] && records[0].tick < oldest
    ? records.filter((entry) => entry.tick >= oldest)
    : records;

  const dueForCheckpoint =
    input.checkpoint === true ||
    history.checkpoints.length === 0 ||
    input.state.tick - history.checkpoints[history.checkpoints.length - 1]!.tick >=
      history.checkpointIntervalTicks;

  const checkpoints = dueForCheckpoint
    ? [...history.checkpoints, { tick: input.state.tick, state: input.state, round: input.round }]
    : history.checkpoints;

  // Keep the checkpoint that covers the oldest retained record, and everything
  // after it. Dropping it would leave records in the ring with nothing to replay
  // them from, which is worse than keeping one extra reference.
  const usableFrom = trimmed[0]?.tick ?? input.state.tick;
  const keepFrom = checkpoints.reduce(
    (best, entry) => (entry.tick <= usableFrom && entry.tick > best ? entry.tick : best),
    -1,
  );
  const prunedCheckpoints =
    keepFrom >= 0 ? checkpoints.filter((entry) => entry.tick >= keepFrom) : checkpoints;

  return {
    ...history,
    records: trimmed,
    checkpoints: prunedCheckpoints,
    chain: chainNext(history.chain, stateHash),
  };
}

export function recordAt(history: TickHistory, tick: number): TickRecord | null {
  // Records are dense and ascending, so this is an index rather than a scan.
  const first = history.records[0];
  if (!first) return null;
  const index = tick - first.tick;
  const candidate = history.records[index];
  return candidate && candidate.tick === tick ? candidate : null;
}

export function selfHashAt(
  history: TickHistory,
  side: DuelSide,
  tick: number,
): StateHash | null {
  return recordAt(history, tick)?.selfHashes[side] ?? null;
}

export function predictableHashAt(
  history: TickHistory,
  side: DuelSide,
  tick: number,
): StateHash | null {
  return recordAt(history, tick)?.predictableHashes[side] ?? null;
}

/**
 * The sequence in force on each tick of a span, oldest first.
 *
 * Published to the client so it can reproduce the server's per-tick input mapping
 * exactly. Without it a client only knows WHICH of its frames the server has seen,
 * not WHEN each took effect, and a comparison that guesses the boundary reports
 * false divergences on every input change — which would make the detector useless
 * by making it noisy.
 */
export function appliedSeqOverSpan(
  history: TickHistory,
  side: DuelSide,
  fromTickExclusive: number,
  toTickInclusive: number,
): readonly number[] {
  const out: number[] = [];
  for (let tick = fromTickExclusive + 1; tick <= toTickInclusive; tick++) {
    const record = recordAt(history, tick);
    if (!record) return out;
    out.push(record.appliedSeq[side]);
  }
  return out;
}

/** Did a side's health change anywhere in a span? A change voids a comparison. */
export function healthChangedOverSpan(
  history: TickHistory,
  side: DuelSide,
  fromTickInclusive: number,
  toTickInclusive: number,
): boolean {
  const first = recordAt(history, fromTickInclusive);
  if (!first) return true;
  for (let tick = fromTickInclusive + 1; tick <= toTickInclusive; tick++) {
    const record = recordAt(history, tick);
    if (!record) return true;
    if (record.health[side] !== first.health[side]) return true;
  }
  return false;
}

/** The most recent checkpoint at or before a tick. Where a replay starts. */
export function checkpointBefore(history: TickHistory, tick: number): Checkpoint | null {
  let best: Checkpoint | null = null;
  for (const checkpoint of history.checkpoints) {
    if (checkpoint.tick <= tick && (!best || checkpoint.tick > best.tick)) {
      best = checkpoint;
    }
  }
  return best;
}

/** The applied intents from one tick to another, inclusive of the destination. */
export function intentsBetween(
  history: TickHistory,
  fromTickExclusive: number,
  toTickInclusive: number,
): readonly { tick: number; intents: BySide<CombatIntent> }[] {
  const slice: { tick: number; intents: BySide<CombatIntent> }[] = [];
  for (const record of history.records) {
    if (record.tick > fromTickExclusive && record.tick <= toTickInclusive) {
      slice.push({ tick: record.tick, intents: record.intents });
    }
  }
  return slice;
}
