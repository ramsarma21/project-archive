// Closing the loop on the duel verdict receipt.
//
// WHAT WAS DECORATION. `POST /v1/duels/:duelId/rounds/:round/verdict` mints an
// HMAC over the verdict envelope bound to `{profileId, duelId, roundIndex}` and
// returns it in `x-pa-verdict-receipt`. @pa/grading's verdict.ts says what it is
// for in as many words — "whoever commits the duel result verifies it before the
// verdict counts" — and nothing verified it. A signature nobody checks is worse
// than no signature: it reads, in a review, as though the relay were protected.
//
// WHERE A DUEL VERDICT IS SPENT. The verdict travels through the browser: the
// reducer derives fourteen bullets or seven from `kind`, the duel resolves, and
// the run's serialised commit log arrives at
// `POST /v1/profiles/:profileId/progression/mission-outcomes` as
// `committedEvents`. That log's `VERDICT_COMMITTED` entries are the durable record
// of what the server decided, and they are the last place the question can be
// asked. So it is asked here.
//
// WHAT THIS DOES NOT DO, AND WHY THAT IS RIGHT. It does not change a single
// number the commit derives. The award comes from the stored ordinal and the
// authored base award, and `committedEvents` is telemetry the store writes
// verbatim — @pa/contracts exempts its CONTENTS from the server-authoritative
// guard for exactly that reason. This is not a second grading authority; it is the
// authenticity check on a record, and its only power is to refuse a commit whose
// log carries a verdict the server can prove it did not mint.
//
// THE STAGED ENFORCEMENT, STATED PLAINLY. `apps/web/src/duel/duelGrading.ts` now
// reads `x-pa-verdict-receipt` and `attachVerdictReceipts` carries it into the
// commit log beside the envelope, so a graded round arrives signed. Two different
// failures still have to be treated differently.
//
//   * A receipt that is PRESENT AND WRONG is refused, always, under every
//     setting. It cannot be an accident.
//   * A receipt that is ABSENT is counted and let through while
//     DUEL_RECEIPT_ENFORCEMENT is AUDIT. Refusing first would cost every student
//     their mission clear, and the failure direction that matters here is the one
//     that takes a lesson down.
//
// ABSENT IS NOT ONLY THE OLD CLIENT, AND THAT IS WHAT DECIDES THE FLIP. Every
// grading fallback legitimately produces a null receipt: the 1.5-second cap, an
// unreachable authority, the stand-in. The design GRANTS the maximum on all three
// precisely so infrastructure never punishes a player — so REQUIRE refuses the
// commit of a round the design just decided to be generous about, and a grading
// outage stops being invisible and starts taking mission clears.
//
// Measured against a running API and the real client, two rounds a run:
//
//   both graded, AUDIT     200  claims 2  verified 2  unsigned 0
//   both graded, REQUIRE   200  claims 2  verified 2  unsigned 0
//   one unreachable, AUDIT   200  claims 2  verified 1  unsigned 1
//   one unreachable, REQUIRE 409  VERDICT_RECEIPT_MISSING — the clear is gone
//
// So the loop works and REQUIRE is still not safe. What it needs is a way to
// separate a stripped receipt from an honestly ungraded round, and nothing in the
// log can do that today: the only field that would say so — the envelope's
// `source` — is client-supplied, which is precisely what the receipt exists to
// stop trusting.

import type { ReceiptBinding, VerdictEnvelope } from "@pa/grading";

/** Only side A answers questions in a boss duel; B's magazine is authored. */
const PLAYER_SIDE = "A";

const VERDICT_KINDS = new Set(["CORRECT", "WRONG"]);
const VERDICT_SOURCES = new Set([
  "CLASSIFIER",
  "GRADING_TIMEOUT",
  "ABSTAINED",
  "OPPONENT_AUTHORITY",
]);

/** A receipt is base64url of a SHA-256 HMAC. Bounded before it is compared. */
const MAX_RECEIPT_CHARS = 128;
const MAX_DUEL_ID_CHARS = 200;

export type ReceiptEnforcement = "AUDIT" | "REQUIRE";

/**
 * Read once per call rather than cached, so an operator can change it on a
 * running task through a task-definition update without a code change.
 * Anything other than REQUIRE is AUDIT: an unreadable setting must not silently
 * become the strict one and start refusing commits.
 */
export function receiptEnforcement(): ReceiptEnforcement {
  return process.env.DUEL_RECEIPT_ENFORCEMENT?.trim().toUpperCase() === "REQUIRE"
    ? "REQUIRE"
    : "AUDIT";
}

export interface CommittedVerdictClaim {
  readonly roundIndex: number;
  readonly envelope: VerdictEnvelope;
  /** The header value the client carried through, or null when it carried none. */
  readonly receipt: string | null;
  /**
   * The duel this verdict claims to belong to, when the entry names one.
   *
   * The duel id is part of the signed message and the commit log does not carry
   * it: @pa/duel's `serialiseCommitLog` writes `type`, `round`, `side` and the
   * envelope, and `DUEL_STARTED` names a seed and an opponent rather than an id.
   * So a client that means to be verified says which duel, and one that does not
   * is checked against the ids this attempt could have produced instead.
   */
  readonly duelId: string | null;
}

export interface CommittedVerdictAudit {
  /** Player-side verdict entries in the log. The denominator. */
  readonly claims: number;
  /** Verified against a receipt and a binding. */
  readonly verified: number;
  /** No receipt at all. The state of every client today. */
  readonly unsigned: number;
  /**
   * Signed, but no duel id it verifies under.
   *
   * NOT counted as invalid, and that asymmetry is deliberate. It is what an entry
   * that did not name its own duel falls back to, and the fallback guesses:
   * `duelIdCandidates` rebuilds `<missionId>#duel@<ordinal>` from the attempt row
   * while the client composes its id from the LEVEL id, so the guess has never
   * been right. Counting a miss as tampering would have refused every commit in
   * the game. A forged receipt with no duel id is caught by REQUIRE, which is the
   * setting that exists for it.
   */
  readonly unbound: number;
  /** Entries whose shape is not a verdict envelope. Counted, never verified. */
  readonly malformed: number;
  /** Rounds whose receipt was present and did not verify. Always refused. */
  readonly invalidRounds: readonly number[];
}

export const EMPTY_VERDICT_AUDIT: CommittedVerdictAudit = {
  claims: 0,
  verified: 0,
  unsigned: 0,
  unbound: 0,
  malformed: 0,
  invalidRounds: [],
};

function optionalString(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : null;
}

/**
 * The five keys and nothing else, with the vocabulary @pa/duel accepts.
 *
 * Strict on purpose: the envelope is HMAC INPUT. A field that is present but of
 * the wrong type would build a different message and fail verification for a
 * reason that looks like tampering, so it is named as malformed instead.
 */
function parseEnvelope(value: unknown): VerdictEnvelope | null {
  if (value === null || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const { kind, itemId, itemVersion, source, responseRef } = entry;
  if (typeof kind !== "string" || !VERDICT_KINDS.has(kind)) return null;
  if (typeof source !== "string" || !VERDICT_SOURCES.has(source)) return null;
  if (typeof itemId !== "string" || itemId.length === 0) return null;
  if (typeof itemVersion !== "string" || itemVersion.length === 0) return null;
  if (responseRef !== null && typeof responseRef !== "string") return null;
  return {
    kind: kind as VerdictEnvelope["kind"],
    itemId,
    itemVersion,
    source: source as VerdictEnvelope["source"],
    responseRef: responseRef ?? null,
  };
}

/**
 * Every player-side verdict entry in a serialised duel commit log.
 *
 * Side B is skipped rather than audited: a boss owes no verdict, its magazine
 * comes from its authored profile, and @pa/duel's `roundAmmoSources` refuses a
 * verdict-derived magazine for a side that owes none. An entry for B is therefore
 * not knowledge evidence and there is no receipt that could exist for it.
 */
export function readCommittedVerdicts(
  events: readonly unknown[],
): { readonly claims: readonly CommittedVerdictClaim[]; readonly malformed: number } {
  const claims: CommittedVerdictClaim[] = [];
  let malformed = 0;
  for (const event of events) {
    if (event === null || typeof event !== "object") continue;
    const entry = event as Record<string, unknown>;
    if (entry.type !== "VERDICT_COMMITTED") continue;
    if (entry.side !== PLAYER_SIDE) continue;
    const round = entry.round;
    const envelope = parseEnvelope(entry.verdict);
    if (typeof round !== "number" || !Number.isInteger(round) || envelope === null) {
      malformed += 1;
      continue;
    }
    claims.push({
      roundIndex: round,
      envelope,
      receipt: optionalString(entry.receipt, MAX_RECEIPT_CHARS),
      duelId: optionalString(entry.duelId, MAX_DUEL_ID_CHARS),
    });
  }
  return { claims, malformed };
}

/**
 * The duel ids one mission attempt could have produced.
 *
 * The receipt binds to the duel id the CLIENT posted to, and the server knows the
 * attempt rather than the duel — so with nothing on the entry to go on this is a
 * GUESS assembled from the two halves the attempt row does hold.
 *
 * IT HAS NEVER MATCHED, AND IT IS KEPT ANYWAY. `apps/web/src/chapter/m1Mission.ts`
 * composes the id from the LEVEL id (`PA.SEA01.CH02.BOSTON.MD01.EFFIGY_RUN.v1`),
 * which is one segment longer than the mission id the row stores. That is what
 * made the loop silent for as long as it was. The client now sends its duel id and
 * `readCommittedVerdicts` prefers it; this remains as the floor, because a miss
 * here counts `unbound` rather than as tampering, and that is what stops a future
 * id-format change from refusing every commit in the game rather than logging a
 * number somebody can read.
 */
export function duelIdCandidates(input: {
  readonly missionId: string;
  readonly attemptOrdinal: number;
}): readonly string[] {
  return [`${input.missionId}#duel@${input.attemptOrdinal}`];
}

export function auditCommittedVerdicts(input: {
  readonly profileId: string;
  readonly events: readonly unknown[];
  /** Used only for entries that do not name their own duel id. */
  readonly duelIdCandidates: readonly string[];
  readonly verify: (
    envelope: VerdictEnvelope,
    binding: ReceiptBinding,
    receipt: string,
  ) => boolean;
}): CommittedVerdictAudit {
  const { claims, malformed } = readCommittedVerdicts(input.events);
  let verified = 0;
  let unsigned = 0;
  let unbound = 0;
  const invalidRounds: number[] = [];

  for (const claim of claims) {
    const receipt = claim.receipt;
    if (receipt === null) {
      unsigned += 1;
      continue;
    }
    const candidates =
      claim.duelId !== null ? [claim.duelId] : input.duelIdCandidates;
    const matched = candidates.some((duelId) =>
      input.verify(
        claim.envelope,
        {
          profileId: input.profileId,
          // The duel IS the attempt for a boss fight: PvE duel ids are
          // attempt-scoped, which is what makes this binding a single fight.
          attemptId: duelId,
          roundIndex: claim.roundIndex,
        },
        receipt,
      ),
    );
    if (matched) {
      verified += 1;
    } else if (claim.duelId !== null) {
      // It named its duel and the signature does not hold for it. There is no
      // benign reading of that.
      invalidRounds.push(claim.roundIndex);
    } else {
      unbound += 1;
    }
  }

  return {
    claims: claims.length,
    verified,
    unsigned,
    unbound,
    malformed,
    invalidRounds,
  };
}

export type ReceiptRefusal =
  /** A receipt was supplied for a duel it names, and it does not hold. */
  | "VERDICT_RECEIPT_INVALID"
  /** Under REQUIRE: a verdict arrived that cannot be authenticated. */
  | "VERDICT_RECEIPT_MISSING";

/**
 * Whether this commit may proceed.
 *
 * An invalid receipt refuses under both settings; everything unauthenticated
 * refuses only under REQUIRE. A log with no verdict entries at all is not a
 * refusal even under REQUIRE — a mission can be failed before its duel opens, and
 * the web client currently drops the whole log when the request guard refuses it,
 * so "no verdicts" must stay a legal commit.
 */
export function receiptRefusal(
  audit: CommittedVerdictAudit,
  enforcement: ReceiptEnforcement,
): ReceiptRefusal | null {
  if (audit.invalidRounds.length > 0) return "VERDICT_RECEIPT_INVALID";
  if (enforcement !== "REQUIRE") return null;
  if (audit.claims === 0 && audit.malformed === 0) return null;
  const authenticated = audit.verified === audit.claims && audit.malformed === 0;
  return authenticated ? null : "VERDICT_RECEIPT_MISSING";
}
