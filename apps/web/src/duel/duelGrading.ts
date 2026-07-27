// Getting a verdict, without ever deciding one.
//
// THE CLIENT CANNOT GRADE. It holds no rubric and no acceptable answers, so there
// is nothing here to classify with even if someone wanted to. It posts the player's
// text to the grading authority and waits for a minted verdict, which arrives as
// JSON and is admitted only through the core's own wire boundary
// (`parseVerdictEnvelope`) — the function that rejects unknown fields rather than
// ignoring them, so a `bullets` key cannot ride in on a response either.
//
// THE 1.5 SECOND CAP IS THE DESIGN'S, NOT A FALLBACK I INVENTED. Mission-Slate 1.7
// fixes it: grading that overruns grants the maximum and logs for review, because a
// player is never punished for infrastructure. That is expressed as
// `mintTimeoutVerdict`, which is the core's own constructor and is flagged by
// `verdictNeedsGradingReview`. It is also what happens when the grading service is
// not running at all, which is the state of the repository today.
//
// ANSWER TEXT LIVES IN EXACTLY ONE PLACE: the request body. It is never logged,
// never put on an event, and never handed to the reducer — `mintVerdict` has no
// parameter for it.
//
// THE RECEIPT IS THE OTHER HALF OF THE VERDICT, AND IT IS READ HERE. The server
// mints an HMAC over the envelope bound to `{profileId, duelId, roundIndex}` and
// returns it in `x-pa-verdict-receipt`; `apps/api/src/duels/commitReceipts.ts`
// verifies it when the run's commit log arrives, and refuses a receipt that is
// present and wrong. Until this module read the header, every verdict committed
// `unsigned`, so the signature proved nothing and enforcement could not leave
// AUDIT. Carrying it is what makes the relay through the browser checkable.
//
// The receipt is NOT a verdict and cannot become one. It is an opaque string, it
// never reaches the reducer, and `attachVerdictReceipts` puts it on the commit log
// beside the envelope the server already minted rather than inside it.

import {
  mintTimeoutVerdict,
  parseVerdictEnvelope,
  type CommittedVerdict,
  type DuelQuestionRef,
  type DuelSide,
  type VerdictKind,
} from "@pa/duel";
import { withDevSessionHeader } from "../devSession.js";

/** Mission-Slate 1.7. Not a network timeout: a game rule with a number. */
export const GRADING_CAP_MS = 1500;

/**
 * Where the server puts the receipt.
 *
 * Listed in the API's CORS `exposedHeaders`, without which `fetch` cannot see it
 * from any origin but the API's own. Development goes through Vite's same-origin
 * proxy, which is why a deployment could have shipped with this unreadable.
 */
export const VERDICT_RECEIPT_HEADER = "x-pa-verdict-receipt";

/** Only side A answers questions in a boss duel, so only A can hold a receipt. */
const PLAYER_SIDE: DuelSide = "A";

/**
 * One round's proof that the server minted the verdict it is sitting beside.
 *
 * `duelId` TRAVELS WITH IT BECAUSE THE FALLBACK IS ALREADY WRONG, not merely
 * fragile. The duel id is part of the signed message and @pa/duel's commit log
 * does not carry one — `serialiseCommitLog` writes `type`, `round`, `side` and the
 * envelope, and `DUEL_STARTED` names a seed and an opponent rather than an id — so
 * `apps/api/src/duels/commitReceipts.ts` reconstructs it from the attempt row as
 * `<missionId>#duel@<ordinal>`. But `m1Mission.ts` composes the duel id from the
 * LEVEL id, so what this client actually posts to is
 * `PA.SEA01.CH02.BOSTON.MD01.EFFIGY_RUN.v1#duel@1` while the row yields
 * `PA.SEA01.CH02.BOSTON.MD01#duel@1`. Those never match, so every receipt would
 * count as `unbound` for as long as the id is inferred rather than sent.
 */
export interface VerdictReceipt {
  readonly round: number;
  readonly duelId: string;
  readonly receipt: string;
}

export interface VerdictRequest {
  readonly duelId: string;
  readonly round: number;
  readonly side: DuelSide;
  readonly item: DuelQuestionRef;
  /** The player's own words. Goes to the authority and nowhere else. */
  readonly answer: string;
  /**
   * The Codex cards the player placed as evidence. A CLAIM about what was placed, not
   * about what is relevant: the server re-derives the offered hand and the policy for
   * the round's item and grades this against them. The client cannot mark a card
   * "relevant" — there is no field for it.
   */
  readonly selectedCardIds: readonly string[];
}

export type VerdictOrigin =
  | "AUTHORITY"
  | "AUTHORITY_TIMEOUT"
  | "AUTHORITY_UNREACHABLE"
  | "STAND_IN";

export interface VerdictResult {
  readonly verdict: CommittedVerdict;
  readonly origin: VerdictOrigin;
  /** How long the authority took, for the telemetry the cap exists to inform. */
  readonly elapsedMs: number;
  /**
   * The server's receipt for this round, when there is one.
   *
   * Null for every verdict the server did not mint — the 1.5-second cap, an
   * unreachable authority, the stand-in — because a verdict the client granted
   * itself has nothing to authenticate. Those commit as `unsigned` and are
   * counted, which is exactly what the API's audit exists to measure.
   */
  readonly receipt: VerdictReceipt | null;
}

export type VerdictAuthority = (request: VerdictRequest) => Promise<VerdictResult>;

/** Where a duel verdict is minted. The grading service owns the final shape. */
export function duelVerdictEndpoint(duelId: string, round: number): string {
  return `/v1/duels/${encodeURIComponent(duelId)}/rounds/${round}/verdict`;
}

async function csrfToken(): Promise<string | null> {
  try {
    const response = await fetch("/v1/session", {
      credentials: "include",
      headers: withDevSessionHeader(),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { csrfToken?: unknown };
    return typeof body.csrfToken === "string" ? body.csrfToken : null;
  } catch {
    return null;
  }
}

/**
 * The real path: ask the server, admit the answer through the core's wire boundary,
 * and apply the cap when it does not come back in time.
 */
export const httpVerdictAuthority: VerdictAuthority = async (request) => {
  const startedAt = Date.now();
  const timeout = (origin: Extract<VerdictOrigin, "AUTHORITY_TIMEOUT" | "AUTHORITY_UNREACHABLE">): VerdictResult => ({
    verdict: mintTimeoutVerdict(request.item.itemId, request.item.itemVersion),
    origin,
    elapsedMs: Date.now() - startedAt,
    // The cap grants the maximum without the server having decided anything, so
    // there is no receipt and inventing one is the one thing that must not happen.
    receipt: null,
  });

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), GRADING_CAP_MS);
  try {
    const csrf = await csrfToken();
    const response = await fetch(duelVerdictEndpoint(request.duelId, request.round), {
      method: "POST",
      signal: controller.signal,
      credentials: "include",
      headers: withDevSessionHeader({
        "content-type": "application/json",
        ...(csrf ? { "x-pa-csrf-token": csrf } : {}),
      }),
      body: JSON.stringify({
        side: request.side,
        itemId: request.item.itemId,
        itemVersion: request.item.itemVersion,
        conceptId: request.item.conceptId,
        answer: request.answer,
        selectedCardIds: request.selectedCardIds,
      }),
    });
    if (!response.ok) return timeout("AUTHORITY_UNREACHABLE");
    // Read before the body, so a receipt is never lost to a parse failure below.
    const receipt = response.headers.get(VERDICT_RECEIPT_HEADER);
    const parsed = parseVerdictEnvelope(await response.json());
    if (!parsed.ok) {
      console.warn(`[duel] grading authority sent a bad verdict: ${parsed.code} ${parsed.detail}`);
      return timeout("AUTHORITY_UNREACHABLE");
    }
    return {
      verdict: parsed.verdict,
      origin: "AUTHORITY",
      elapsedMs: Date.now() - startedAt,
      receipt: receipt
        ? { round: request.round, duelId: request.duelId, receipt }
        : null,
    };
  } catch (cause) {
    const aborted = cause instanceof DOMException && cause.name === "AbortError";
    return timeout(aborted ? "AUTHORITY_TIMEOUT" : "AUTHORITY_UNREACHABLE");
  } finally {
    window.clearTimeout(timer);
  }
};

/**
 * A stand-in for the authority, for inspecting the mode before the grading service
 * exists.
 *
 * It is NOT a classifier and must never become one: it does not read
 * `request.answer` at all, it returns a scripted verdict for the round, and it is
 * injected by a harness rather than reached for by the game. Its whole purpose is
 * to let a human see both halves of the bullet economy — one ball and three — in a
 * single run.
 */
export function createStandInVerdictAuthority(
  scriptedVerdict: (round: number) => VerdictKind,
  latencyMs = 420,
): VerdictAuthority {
  return async (request) => {
    const startedAt = Date.now();
    await new Promise((resolve) => window.setTimeout(resolve, latencyMs));
    const parsed = parseVerdictEnvelope({
      kind: scriptedVerdict(request.round),
      itemId: request.item.itemId,
      itemVersion: request.item.itemVersion,
      source: "CLASSIFIER",
      responseRef: `stand-in:${request.duelId}:${request.round}`,
    });
    if (!parsed.ok) throw new Error(`stand-in built an illegal verdict: ${parsed.code}`);
    return {
      verdict: parsed.verdict,
      origin: "STAND_IN",
      elapsedMs: Date.now() - startedAt,
      // A stand-in holds no signing key and must not look as though it does.
      receipt: null,
    };
  };
}

/** Alternating script: the run shows a three-ball round and a one-ball round. */
export function alternatingVerdicts(round: number): VerdictKind {
  return round % 2 === 1 ? "CORRECT" : "WRONG";
}

/**
 * Put each round's receipt on its own entry in the serialised commit log.
 *
 * WHY IT HAPPENS AFTER SERIALISATION RATHER THAN ON THE EVENT. @pa/duel's
 * `serialiseCommitLog` projects a `VERDICT_COMMITTED` onto exactly `type`,
 * `round`, `side` and the envelope, so a receipt carried on the event would be
 * dropped there. The core is also the wrong owner for it: a receipt is an
 * artifact of the transport between this client and the API, and the duel state
 * machine is deliberately ignorant of both.
 *
 * `receipt` and `duelId` sit BESIDE `verdict`, not inside it, because the
 * envelope is the HMAC input — a key added to it would change the message the
 * server re-derives and read as tampering. `commitReceipts.ts` reads them at
 * exactly this level.
 *
 * An entry with no receipt is returned untouched rather than given a null: the
 * server distinguishes absent from invalid, and absent is what a capped or
 * unreachable round honestly is.
 */
export function attachVerdictReceipts(
  events: readonly Record<string, unknown>[],
  receipts: readonly VerdictReceipt[],
): readonly Record<string, unknown>[] {
  if (receipts.length === 0) return events;
  const byRound = new Map(receipts.map((entry) => [entry.round, entry]));
  return events.map((event) => {
    if (event.type !== "VERDICT_COMMITTED" || event.side !== PLAYER_SIDE) return event;
    const held = typeof event.round === "number" ? byRound.get(event.round) : undefined;
    return held
      ? { ...event, receipt: held.receipt, duelId: held.duelId }
      : event;
  });
}
