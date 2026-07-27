// The server-side match authority.
//
// This is the object that decides what happened. It owns the clock, the seed, both
// bodies, every ball, every hit, both bullet grants and the outcome, and it produces
// per-side snapshots that are strictly less than what it knows. A client contributes
// intents and answer text; everything else it holds is a prediction it will be
// corrected on.
//
// It is the SAME reducer a boss duel runs. PvP is `OpponentSource: REMOTE`, side B's
// intents arriving from a socket instead of from `bossIntent`, and that is the entire
// difference — which is why a student who has cleared fourteen missions already knows
// how to play this.
//
// WHY THIS IS PURE. The authority is a value, not a process: every function here takes
// a state and returns a new one, with no timers, no sockets and no clock reads. The
// API layer owns the loop. That keeps the thing that decides a ranked outcome fully
// testable and, because @pa/duel is replay-exact at 30, 60 and 120 fps, it also makes
// a disputed match RE-DERIVABLE: store the seed and the accepted intent stream and the
// result can be recomputed by anyone, including an auditor who trusts neither client.

import {
  DUEL_ROUND_CEILING,
  answeringSides,
  createDuel,
  duelOutcome,
  isAwaitingVerdict,
  parseVerdictEnvelope,
  reduceDuel,
  standingEffect,
  type CollisionWorld,
  type CombatIntent,
  type DuelEvent,
  type DuelOutcome,
  type DuelQuestionRef,
  type DuelSide,
  type DuelState,
  type Vec3,
} from "@pa/duel";
import { IDLE_INTENT } from "@pa/duel";
import { resolvePvpLoadout } from "@pa/abilities";
import {
  EMPTY_INTENT_WINDOW,
  acceptIntentFrame,
  type ClientIntentFrame,
  type IntentRejection,
  type IntentWindow,
} from "./intents.js";
import {
  initialLastKnown,
  projectSnapshotFor,
  updateLastKnown,
  type LastKnownBySide,
  type MatchSnapshot,
} from "./projection.js";
import { toDuelQuestionRefs, type PvpQuestionItem } from "./questionPool.js";
import {
  type MatchIdentity,
  type MatchPhase,
  type PvpParticipant,
} from "./match.js";

export type BySide<T> = { readonly A: T; readonly B: T };

// ---- the verdict trust boundary --------------------------------------------
//
// The wire shape of a verdict, and the verifier, are declared here as types and
// INJECTED rather than imported from @pa/grading.
//
// Not to avoid the dependency — @pa/grading owns both the HMAC and the secret, and
// nothing here reimplements either. It is so that the thing which decides a ranked
// outcome depends on an interface instead of on another package's build state, and so
// that the authority can be tested with a stub verifier without a secret in the test
// environment. The API route passes grading's real `verifyVerdictReceipt`.

/** Exactly @pa/duel's `VERDICT_ENVELOPE_KEYS`. Nothing else may cross. */
export interface PvpVerdictEnvelope {
  readonly kind: "CORRECT" | "WRONG";
  readonly itemId: string;
  readonly itemVersion: string;
  readonly source: string;
  readonly responseRef: string | null;
}

export interface VerdictReceiptBinding {
  readonly profileId: string;
  readonly attemptId: string;
  readonly roundIndex: number;
}

/**
 * Injected implementation of @pa/grading's `verifyVerdictReceipt`. A verdict that does
 * not verify never becomes a `CommittedVerdict`, so it can never reach the reducer that
 * derives bullets from it.
 */
export type ReceiptVerifier = (
  envelope: PvpVerdictEnvelope,
  binding: VerdictReceiptBinding,
  receipt: string,
) => boolean;

/**
 * Why a match ended without a simulated outcome. A forfeit is a LOSS decided by the
 * server, which is what stops closing the tab from being a way to avoid one.
 */
export type ForfeitReason = "DISCONNECTED" | "ABANDONED" | "TIMED_OUT";

export interface PvpAuthority {
  readonly identity: MatchIdentity;
  readonly participants: BySide<PvpParticipant>;
  readonly world: CollisionWorld;
  readonly state: DuelState;
  readonly phase: MatchPhase;
  readonly lastKnown: LastKnownBySide;
  readonly intentWindows: BySide<IntentWindow>;
  /**
   * The latest accepted intent per side, held until replaced. A dropped packet
   * therefore repeats the last instruction rather than stopping the player dead,
   * which is the standard and the kinder failure.
   */
  readonly heldIntents: BySide<CombatIntent>;
  readonly lastIntentAtMs: BySide<number>;
  /**
   * The last moment each side was PRESENT — proved by ANY authenticated contact
   * with the match, not only by an intent frame. A poll that reads a snapshot, an
   * answer POST and an intent batch all count; a side is "connected" whenever it is
   * making requests, whatever phase it is in.
   *
   * THIS EXISTS BECAUSE LIVENESS AND INPUT ARE DIFFERENT QUESTIONS. `lastIntentAtMs`
   * only advances when a frame is accepted, and a client sends no frames while it is
   * answering an untimed question (movement is suspended) or while it waits on the
   * opponent. So a fully-connected client that is polling the whole time goes "silent"
   * on intents alone the moment a question outlasts the grace window — and when combat
   * resumes, the side that started moving again refreshes its intent clock while the
   * side still reading does not, which is exactly one silent side and a spurious
   * DISCONNECTED forfeit of a player who never left. `silentSides` measures presence,
   * so a client that is talking to the server at all is never forfeited as gone; a
   * client that has genuinely stopped making requests still is.
   */
  readonly lastSeenAtMs: BySide<number>;
  readonly forfeit: { readonly side: DuelSide; readonly reason: ForfeitReason } | null;
  /** Audit trail: which rounds each side has had a verdict committed for. */
  readonly verdictRounds: BySide<readonly number[]>;
  readonly log: readonly DuelEvent[];
}

/** How long a side may go silent before the server may forfeit it. */
export const DISCONNECT_GRACE_MS = 12_000;

/**
 * How long a side may go silent before its held intent stops repeating.
 *
 * The authority holds the last accepted intent per side and replays it every tick,
 * so ONE dropped packet keeps a player moving rather than freezing them dead — the
 * kinder failure. But a side quiet for seconds is not dropping a packet, it is gone,
 * and replaying "sprint north into a wall" (or holding fire) until the disconnect
 * grace elapses spends its last seconds doing something the player never asked for,
 * and hands the opponent a target that is still walking. So the held intent DECAYS to
 * idle well before the grace window forfeits: the body stops, and if the silence
 * continues the forfeit follows as before. Shorter than DISCONNECT_GRACE_MS on
 * purpose — decay first, forfeit later.
 */
export const INTENT_DECAY_MS = 2_000;

export interface CreatePvpMatchInput {
  readonly identity: MatchIdentity;
  readonly participants: BySide<PvpParticipant>;
  readonly world: CollisionWorld;
  /**
   * The six items, already drawn and already filtered for legality by
   * `askableItems` + `selectRoundQuestions`. Passed as the richer PvP item so the
   * question text stays available to the API for presentation, while only the
   * identity is projected into the duel that commits it.
   */
  readonly questions: readonly PvpQuestionItem[];
  readonly placement?: BySide<{ readonly pos: Vec3; readonly yaw: number }>;
  readonly rounds?: number;
}

export type CreateMatchResult =
  | { readonly ok: true; readonly authority: PvpAuthority }
  | { readonly ok: false; readonly reason: string };

/**
 * Build a live match.
 *
 * Question legality is decided upstream by `askableItems`, which is the single place
 * the PvP-legal card gate lives; this refuses an empty or short draw rather than
 * re-deriving the rule, because two places deciding legality is how the two disagree.
 * Ability loadouts are resolved by @pa/abilities against its own four-slot cap, so PvP
 * cannot carry more than single-player does.
 */
export function createPvpMatch(input: CreatePvpMatchInput): CreateMatchResult {
  // A round OVERRIDE must never invalidate the protocol/presentation bounds derived from
  // DUEL_ROUND_CEILING (the feed's cue capacity, the wire's tick range). Reject a ceiling
  // above the authoritative one, and reject a malformed count outright rather than letting
  // createDuel coerce it — a silent clamp would let a caller quietly move the ceiling the
  // rest of the system trusts. The live default (no override) is untouched: createDuel is
  // handed nothing and uses DUEL_ROUND_CEILING itself.
  if (input.rounds !== undefined) {
    if (!Number.isInteger(input.rounds) || input.rounds <= 0) {
      return { ok: false, reason: `rounds must be a positive integer, got ${input.rounds}` };
    }
    if (input.rounds > DUEL_ROUND_CEILING) {
      return {
        ok: false,
        reason: `rounds ${input.rounds} exceeds the duel round ceiling of ${DUEL_ROUND_CEILING}`,
      };
    }
  }

  const rounds = input.rounds ?? input.questions.length;
  if (input.questions.length < rounds) {
    return {
      ok: false,
      reason: `a ${rounds}-round match needs ${rounds} drawn questions, got ${input.questions.length}`,
    };
  }

  const loadoutA = resolvePvpLoadout({
    unlockedAbilityIds: input.participants.A.unlockedAbilityIds,
    ...(input.participants.A.selectedAbilityIds
      ? { selectedAbilityIds: input.participants.A.selectedAbilityIds }
      : {}),
  });
  const loadoutB = resolvePvpLoadout({
    unlockedAbilityIds: input.participants.B.unlockedAbilityIds,
    ...(input.participants.B.selectedAbilityIds
      ? { selectedAbilityIds: input.participants.B.selectedAbilityIds }
      : {}),
  });

  let created;
  try {
    created = createDuel({
      duelId: input.identity.matchId,
      seed: input.identity.seed,
      world: input.world,
      // The one line that makes this PvP instead of a boss fight. Note what is NOT
      // passed: no cosmetics. The simulation is never handed a skin or a weapon id.
      opponent: {
        kind: "REMOTE",
        handle: input.participants.B.handle,
        loadout: loadoutB.duelLoadout,
      },
      playerLoadout: loadoutA.duelLoadout,
      questions: toDuelQuestionRefs(input.questions),
      ...(input.rounds !== undefined ? { rounds: input.rounds } : {}),
      ...(input.placement ? { placement: input.placement } : {}),
    });
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) };
  }

  return {
    ok: true,
    authority: {
      identity: input.identity,
      participants: input.participants,
      world: input.world,
      state: created.state,
      phase: "LIVE",
      lastKnown: initialLastKnown(created.state.combat),
      intentWindows: { A: EMPTY_INTENT_WINDOW, B: EMPTY_INTENT_WINDOW },
      heldIntents: { A: IDLE_INTENT, B: IDLE_INTENT },
      lastIntentAtMs: { A: input.identity.startedAtMs, B: input.identity.startedAtMs },
      lastSeenAtMs: { A: input.identity.startedAtMs, B: input.identity.startedAtMs },
      forfeit: null,
      verdictRounds: { A: [], B: [] },
      log: created.events,
    },
  };
}

// ---- intents ---------------------------------------------------------------

export type IngestResult =
  | { readonly ok: true; readonly authority: PvpAuthority }
  | {
      readonly ok: false;
      readonly authority: PvpAuthority;
      readonly reason: IntentRejection;
      readonly detail: string;
    };

export function ingestIntent(
  authority: PvpAuthority,
  side: DuelSide,
  frame: ClientIntentFrame,
  nowMs: number,
): IngestResult {
  if (authority.phase !== "LIVE") {
    return {
      ok: false,
      authority,
      reason: "MATCH_NOT_LIVE",
      detail: authority.phase,
    };
  }
  const acceptance = acceptIntentFrame(
    authority.intentWindows[side],
    frame,
    authority.state.combat.tick,
  );
  const intentWindows = withSide(authority.intentWindows, side, acceptance.window);
  if (!acceptance.ok) {
    return {
      ok: false,
      authority: { ...authority, intentWindows },
      reason: acceptance.reason,
      detail: acceptance.detail,
    };
  }
  return {
    ok: true,
    authority: {
      ...authority,
      intentWindows,
      heldIntents: withSide(authority.heldIntents, side, acceptance.intent),
      // Any accepted frame is proof of life, which is what the grace window measures.
      lastIntentAtMs: withSide(authority.lastIntentAtMs, side, nowMs),
      // An intent is also contact, so it refreshes presence — this keeps a
      // purely-intent-driven consumer (netcode's session) alive under `silentSides`
      // without having to call `markSeen` separately.
      lastSeenAtMs: withSide(authority.lastSeenAtMs, side, nowMs),
    },
  };
}

/**
 * Record that a side is PRESENT right now, from any authenticated contact with the
 * match — a snapshot poll, an answer, an intent batch. This is the liveness signal
 * `silentSides` measures, kept separate from `lastIntentAtMs` (which is input, and
 * legitimately goes quiet during an untimed question). A resolved match is left
 * untouched: presence only matters while there is a fight to forfeit.
 */
export function markSeen(
  authority: PvpAuthority,
  side: DuelSide,
  nowMs: number,
): PvpAuthority {
  if (authority.phase !== "LIVE") return authority;
  if (nowMs <= authority.lastSeenAtMs[side]) return authority;
  return { ...authority, lastSeenAtMs: withSide(authority.lastSeenAtMs, side, nowMs) };
}

/**
 * Idle any side that has gone silent past `decayMs`.
 *
 * Pure, and meant to be called once per pump before advancing. A side answering an
 * untimed question is not silent — the same guard `silentSides` applies — so a player
 * thinking about a question never has their movement zeroed out from under them. A
 * side already idle is left untouched, so this is a no-op on a healthy match.
 */
export function decayHeldIntents(
  authority: PvpAuthority,
  nowMs: number,
  decayMs = INTENT_DECAY_MS,
): PvpAuthority {
  if (authority.phase !== "LIVE") return authority;
  if (isAwaitingVerdict(authority.state)) return authority;
  let heldIntents = authority.heldIntents;
  for (const side of ["A", "B"] as const) {
    if (
      heldIntents[side] !== IDLE_INTENT &&
      nowMs - authority.lastIntentAtMs[side] > decayMs
    ) {
      heldIntents = withSide(heldIntents, side, IDLE_INTENT);
    }
  }
  if (heldIntents === authority.heldIntents) return authority;
  return { ...authority, heldIntents };
}

// ---- verdicts --------------------------------------------------------------

export type VerdictRejection =
  | "MATCH_NOT_LIVE"
  | "NOT_AWAITING_VERDICTS"
  | "SIDE_ALREADY_COMMITTED"
  | "RECEIPT_INVALID"
  | "ENVELOPE_INVALID"
  | "WRONG_ITEM";

export type SubmitVerdictResult =
  | { readonly ok: true; readonly authority: PvpAuthority }
  | {
      readonly ok: false;
      readonly authority: PvpAuthority;
      readonly reason: VerdictRejection;
      readonly detail: string;
    };

/**
 * Commit one side's verdict.
 *
 * The receipt is REQUIRED even though the grading service usually runs in the same
 * process. In a ranked match the verdict is the only input that can change the bullet
 * economy, so it is authenticated at the boundary regardless of which side of the
 * boundary it appears to come from — and that keeps the door open to splitting grading
 * into its own service without revisiting the trust model.
 *
 * Note the ordering: the receipt is verified BEFORE the envelope is minted into a
 * verdict, so an unauthenticated envelope never becomes a `CommittedVerdict` even
 * momentarily.
 */
export function submitVerdict(
  authority: PvpAuthority,
  side: DuelSide,
  envelope: PvpVerdictEnvelope,
  receipt: string,
  verifyReceipt: ReceiptVerifier,
): SubmitVerdictResult {
  if (authority.phase !== "LIVE") {
    return { ok: false, authority, reason: "MATCH_NOT_LIVE", detail: authority.phase };
  }
  const state = authority.state;
  if (!isAwaitingVerdict(state)) {
    return {
      ok: false,
      authority,
      reason: "NOT_AWAITING_VERDICTS",
      detail: state.phase,
    };
  }
  if (!state.awaiting.includes(side)) {
    return { ok: false, authority, reason: "SIDE_ALREADY_COMMITTED", detail: side };
  }
  if (envelope.itemId !== state.item.itemId) {
    return {
      ok: false,
      authority,
      reason: "WRONG_ITEM",
      detail: `${envelope.itemId} for round ${state.round}`,
    };
  }

  const bound = verifyReceipt(
    envelope,
    {
      profileId: authority.participants[side].profileId,
      attemptId: authority.identity.matchId,
      roundIndex: state.round,
    },
    receipt,
  );
  if (!bound) {
    return {
      ok: false,
      authority,
      reason: "RECEIPT_INVALID",
      detail: `round ${state.round}`,
    };
  }

  const parsed = parseVerdictEnvelope(envelope);
  if (!parsed.ok) {
    return {
      ok: false,
      authority,
      reason: "ENVELOPE_INVALID",
      detail: `${parsed.code}: ${parsed.detail}`,
    };
  }

  const result = reduceDuel(state, {
    kind: "COMMIT_VERDICT",
    side,
    verdict: parsed.verdict,
  });
  if (!result.ok) {
    return {
      ok: false,
      authority,
      reason: "SIDE_ALREADY_COMMITTED",
      detail: result.rejection.code,
    };
  }
  return {
    ok: true,
    authority: {
      ...authority,
      state: result.state,
      log: [...authority.log, ...result.events],
      verdictRounds: withSide(authority.verdictRounds, side, [
        ...authority.verdictRounds[side],
        state.round,
      ]),
    },
  };
}

// ---- the tick --------------------------------------------------------------

export interface AdvanceResult {
  readonly authority: PvpAuthority;
  readonly snapshots: BySide<MatchSnapshot>;
  readonly events: readonly DuelEvent[];
}

export function advanceMatch(
  authority: PvpAuthority,
  frameDtS: number,
): AdvanceResult {
  if (authority.phase !== "LIVE") {
    return {
      authority,
      snapshots: snapshotsFor(authority),
      events: [],
    };
  }

  const result = reduceDuel(authority.state, {
    kind: "ADVANCE",
    frameDtS,
    intents: { A: authority.heldIntents.A, B: authority.heldIntents.B },
  });
  const state = result.ok ? result.state : authority.state;
  const events = result.ok ? result.events : [];

  // Refresh visibility memory before projecting, so a snapshot can never contain a
  // position that this tick's line of sight does not justify.
  const lastKnown = updateLastKnown(authority.world, state.combat, authority.lastKnown);
  const next: PvpAuthority = {
    ...authority,
    state,
    lastKnown,
    log: [...authority.log, ...events],
    phase: duelOutcome(state) !== null ? "RESOLVED" : authority.phase,
  };
  return { authority: next, snapshots: snapshotsFor(next), events };
}

export function snapshotsFor(authority: PvpAuthority): BySide<MatchSnapshot> {
  const awaiting = isAwaitingVerdict(authority.state)
    ? authority.state.awaiting
    : ([] as readonly DuelSide[]);
  const input = {
    matchId: authority.identity.matchId,
    state: authority.state,
    world: authority.world,
    lastKnown: authority.lastKnown,
    handles: {
      A: authority.participants.A.handle,
      B: authority.participants.B.handle,
    },
    ranks: { A: authority.participants.A.rank, B: authority.participants.B.rank },
    awaiting,
  };
  return {
    A: projectSnapshotFor("A", input),
    B: projectSnapshotFor("B", input),
  };
}

/** Sides that owe a verdict right now. Both, in PvP, by `answeringSides`. */
export function awaitingVerdicts(authority: PvpAuthority): readonly DuelSide[] {
  return isAwaitingVerdict(authority.state) ? authority.state.awaiting : [];
}

/** Has a side gone silent long enough to forfeit? Policy, not a timer. */
export function silentSides(
  authority: PvpAuthority,
  nowMs: number,
  graceMs = DISCONNECT_GRACE_MS,
): readonly DuelSide[] {
  if (authority.phase !== "LIVE") return [];
  // A player thinking about an untimed question is not silent, they are answering, so
  // the grace window does not run while the machine is waiting on verdicts.
  if (isAwaitingVerdict(authority.state)) return [];
  // Silence is measured on PRESENCE, not on input. A side that is polling the match —
  // reading snapshots through an untimed question, then still reading while combat
  // resumes — is connected even though it has sent no intent frame, and forfeiting it
  // as DISCONNECTED is the bug this guards against. `lastIntentAtMs` legitimately goes
  // quiet during a question; the last of it and `lastSeenAtMs` is the true "last heard
  // from this side", and only a side that has sent NOTHING at all past the grace is
  // gone. `ingestIntent` refreshes both, so an intent-only consumer is covered too.
  return (["A", "B"] as const).filter(
    (side) =>
      nowMs - Math.max(authority.lastIntentAtMs[side], authority.lastSeenAtMs[side]) >
      graceMs,
  );
}

export function forfeitMatch(
  authority: PvpAuthority,
  side: DuelSide,
  reason: ForfeitReason,
): PvpAuthority {
  if (authority.phase !== "LIVE") return authority;
  return { ...authority, phase: "FORFEITED", forfeit: { side, reason } };
}

// ---- the result ------------------------------------------------------------

export interface PvpMatchResult {
  readonly matchId: string;
  readonly winner: DuelSide | null;
  readonly loser: DuelSide | null;
  readonly reason: DuelOutcome["reason"] | "FORFEIT";
  readonly tiebreak: DuelOutcome["tiebreak"];
  readonly healthA: number;
  readonly healthB: number;
  readonly standingApplies: boolean;
  readonly needsReview: boolean;
}

/**
 * The authoritative result, or null while the match is still running. There is no
 * client path to this: nothing a browser can send produces or alters it.
 */
export function matchResult(authority: PvpAuthority): PvpMatchResult | null {
  if (authority.phase === "FORFEITED" && authority.forfeit) {
    const loser = authority.forfeit.side;
    return {
      matchId: authority.identity.matchId,
      winner: loser === "A" ? "B" : "A",
      loser,
      reason: "FORFEIT",
      tiebreak: "NONE",
      healthA: authority.state.combat.fighters.A.health,
      healthB: authority.state.combat.fighters.B.health,
      standingApplies: true,
      needsReview: false,
    };
  }
  const outcome = duelOutcome(authority.state);
  if (!outcome) return null;
  const winner = outcome.winner;
  return {
    matchId: authority.identity.matchId,
    winner,
    loser: winner === null ? null : winner === "A" ? "B" : "A",
    reason: outcome.reason,
    tiebreak: outcome.tiebreak,
    healthA: outcome.healthA,
    healthB: outcome.healthB,
    // A true draw changes no standing and is logged for review — the duel's own rule,
    // consumed here rather than restated.
    standingApplies: standingEffect(outcome) === "WINNER_TAKES",
    needsReview: standingEffect(outcome) === "NO_CHANGE_LOGGED_FOR_REVIEW",
  };
}

function withSide<T>(pair: BySide<T>, side: DuelSide, value: T): BySide<T> {
  return side === "A" ? { A: value, B: pair.B } : { A: pair.A, B: value };
}
