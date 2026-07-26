import {
  MAX_MISSION_ATTEMPTS,
  isModuleGateSatisfied,
} from "@pa/contracts";
import { projectFieldSeed } from "@pa/engine-world";
import type { DeployDecision, ModuleRunCompletion } from "../module/moduleGate.js";

// ---------------------------------------------------------------------------
// The attempt ticket: the module gate made structural.
//
// The gate's rule is that a mission is unreachable until its 3-minute module is
// complete for the exact attempt about to open, first attempt and both retries
// alike. `../module/moduleGate.ts` decides that. This file is what stops the
// decision from being advisory.
//
// A ticket is the only thing that can put the session into a mission phase, and
// every phase from the briefing onward carries one in its type — there is no
// representable TRAVERSAL state without a ticket, so no transition can reach a
// mission without one. The ticket is branded with a symbol this module does not
// export, so it cannot be written as an object literal anywhere else in the
// codebase: `openAttempt` is the sole constructor.
//
// WHAT THE CONSTRUCTOR NOW DEMANDS, AND WHY IT IS STRONGER
//
// It used to take an ENTER_MISSION decision and mint the rest itself: an
// attempt id from crypto, an ordinal counted in this tab, a seed derived from
// the mission and that ordinal. Every one of those was a client's opinion. The
// ordinal one had teeth — a browser that had forgotten a resolved attempt said
// "attempt 1" and the result screen promised full XP on a run the server was
// correctly paying two thirds for.
//
// So a ranked attempt now also demands a GRANT: the row the server wrote when
// it opened the attempt, carrying the ordinal it assigned, the id it minted and
// the seed it derived. The gate decision is still required and still checked;
// what changed is that satisfying it is no longer sufficient. A caller who
// wants a ranked ticket has to have been given one by the server.
//
// The one thing the grant DOES relax is the local ordinal check, and only
// because the server has already made it: `openMissionAttempt` refuses to open
// an ordinal that has no module completion bound to it, so a granted attempt is
// one whose module gate was verified against durable rows rather than against
// a ledger held in this tab. A server check replacing a client check is the
// direction this file exists to move in.
//
// UNRANKED_PRACTICE is the other arm and it is deliberately narrow: nobody is
// signed in, so there is no durable attempt to open, nothing is spent and
// nothing can ever be paid. It is named on the grant and recorded on the
// ticket, so no reader has to infer which kind of run they are looking at.
//
// The consequence worth stating: a caller who forgets to check the gate does not
// get a mission with the gate skipped. It gets `null`, and nothing to mount.
// ---------------------------------------------------------------------------

declare const ATTEMPT_TICKET: unique symbol;

/**
 * Permission to be inside one mission attempt, and the identity of that attempt.
 *
 * Unforgeable on purpose: the brand's key is a symbol declared and never
 * exported. A determined cast can still get past it — nothing in TypeScript
 * stops that — but an accident cannot, and every call site that accepts one
 * documents that the gate has already run.
 */
export interface MissionAttemptTicket {
  readonly [ATTEMPT_TICKET]: "OPENED_BY_THE_MODULE_GATE";
  readonly missionId: string;
  readonly chapterId: string;
  /** 1, 2 or 3. Assigned by the server on a ranked attempt. */
  readonly attemptOrdinal: number;
  /**
   * True when the server opened a durable row for this attempt. False is
   * unranked practice: no row, nothing spent, and nothing that can be paid.
   */
  readonly ranked: boolean;
  /** The completion that opened this attempt. The gate's receipt, carried. */
  readonly moduleCompletion: ModuleRunCompletion;
  /** 32-bit seed for the shared field clock. One per attempt. */
  readonly seed: number;
  /** The same seed as the 128-bit hex the durable attempt row stores. */
  readonly seedHex: string;
  readonly attemptId: string;
  readonly openedAt: string;
}

/**
 * What the server said when it opened the attempt.
 *
 * Structurally the three fields of `AttemptAuthorization` this container needs,
 * declared here rather than imported so the mission layer does not depend on
 * the progression layer — which already depends on it. The progression hook's
 * `authorize` satisfies this shape exactly.
 */
export interface ServerAttemptGrant {
  readonly attemptId: string;
  readonly attemptOrdinal: number;
  /** 32 lowercase hex characters, as `MissionAttemptSchema.attemptSeedHex`. */
  readonly attemptSeedHex: string;
}

/** Permission to open one attempt, and what kind of attempt it is. */
export type AttemptGrant =
  | { readonly kind: "SERVER"; readonly grant: ServerAttemptGrant }
  /** Signed out. The run happens, and nothing about it is durable. */
  | { readonly kind: "UNRANKED_PRACTICE"; readonly attemptId: string };

/**
 * The per-attempt seed.
 *
 * Keyed on the ordinal as well as the mission, which is the whole point: the
 * retired seed helper took an attempt index it never stored, so every retry
 * re-derived attempt one's seed and replayed the first attempt's variation. Two
 * attempts on the same mission are different runs and must draw different
 * authored patrol phases, obstacle states and precision patterns.
 */
export function attemptSeed(input: {
  chapterId: string;
  missionId: string;
  attemptOrdinal: number;
  profileSeedHex: string | null;
}): number {
  return projectFieldSeed([
    input.profileSeedHex ?? "local-profile",
    input.chapterId,
    input.missionId,
    input.attemptOrdinal,
  ]);
}

/**
 * The same seed widened to the 128 bits `MissionAttemptSchema.attemptSeedHex`
 * stores. Four salted projections of one input, so the hex and the 32-bit clock
 * seed are the same fact in two widths rather than two independent draws.
 */
export function attemptSeedHex(input: {
  chapterId: string;
  missionId: string;
  attemptOrdinal: number;
  profileSeedHex: string | null;
}): string {
  let hex = "";
  for (let word = 0; word < 4; word += 1) {
    const value = projectFieldSeed([
      input.profileSeedHex ?? "local-profile",
      input.chapterId,
      input.missionId,
      input.attemptOrdinal,
      `w${word}`,
    ]);
    hex += value.toString(16).padStart(8, "0");
  }
  return hex;
}

const SEED_HEX = /^[0-9a-f]{32}$/;

export interface OpenAttemptInput {
  /** Must be ENTER_MISSION. Anything else yields null. */
  readonly decision: DeployDecision;
  readonly chapterId: string;
  /** Where the attempt's identity comes from. A ranked run needs the server's. */
  readonly grant: AttemptGrant;
  readonly at: string;
  /** The profile's variation root. Seeds an unranked run; unused when granted. */
  readonly profileSeedHex: string | null;
}

/**
 * Mints a ticket from a gate decision and a grant, or returns null.
 *
 * Every condition below is one the gate or the server already satisfies for a
 * legitimate deploy. They are re-checked here anyway because this is the last
 * place a bad attempt can be refused, and the cost of the check is nothing
 * against the cost of a fourth attempt paying XP.
 */
export function openAttempt(input: OpenAttemptInput): MissionAttemptTicket | null {
  if (input.decision.kind !== "ENTER_MISSION") return null;
  const { missionId, completion } = input.decision;
  if (completion.missionId !== missionId) return null;

  const ranked = input.grant.kind === "SERVER";
  // The server's ordinal wins outright. The client's is a guess made from
  // whatever this browser remembers, and after a reload it remembers nothing.
  const attemptOrdinal = ranked
    ? input.grant.grant.attemptOrdinal
    : input.decision.attemptOrdinal;
  if (!Number.isInteger(attemptOrdinal)) return null;
  if (attemptOrdinal < 1 || attemptOrdinal > MAX_MISSION_ATTEMPTS) return null;

  if (input.grant.kind === "SERVER") {
    const { attemptId, attemptSeedHex: seedHex } = input.grant.grant;
    // The row's own seed, in the width the row stores. A malformed one is a
    // defect in the transport and must not become a level nobody can reproduce.
    if (!SEED_HEX.test(seedHex)) return null;
    if (attemptId.trim() === "") return null;
    return {
      missionId,
      chapterId: input.chapterId,
      attemptOrdinal,
      ranked: true,
      moduleCompletion: completion,
      // One lineage: the 32-bit clock seed is projected from the server's hex
      // rather than drawn beside it, so the floor and the fight are the same
      // run the durable row names.
      seed: projectFieldSeed([seedHex]),
      seedHex,
      attemptId,
      openedAt: input.at,
    } as MissionAttemptTicket;
  }

  // Unranked practice. Nothing durable exists, so the local checks are all
  // there is and every one of them is applied.
  if (
    !isModuleGateSatisfied({
      completion: { gatesOrdinal: completion.attemptOrdinal },
      attemptOrdinal,
    })
  ) {
    return null;
  }
  if (input.grant.attemptId.trim() === "") return null;
  const seedInput = {
    chapterId: input.chapterId,
    missionId,
    attemptOrdinal,
    profileSeedHex: input.profileSeedHex,
  };
  return {
    missionId,
    chapterId: input.chapterId,
    attemptOrdinal,
    ranked: false,
    moduleCompletion: completion,
    seed: attemptSeed(seedInput),
    seedHex: attemptSeedHex(seedInput),
    attemptId: input.grant.attemptId,
    openedAt: input.at,
  } as MissionAttemptTicket;
}

/**
 * The facts about an opened attempt the client is allowed to know, in the shape
 * `MissionAttemptSchema` stores.
 *
 * Note what is absent: the XP fraction and the awarded XP. Both are derived by
 * the server from the ordinal it assigned, and neither belongs in a payload the
 * client composes.
 */
export interface MissionAttemptOpening {
  readonly attemptId: string;
  readonly chapterId: string;
  readonly missionId: string;
  readonly attemptOrdinal: number;
  readonly attemptSeedHex: string;
  readonly moduleId: string;
  readonly moduleCompletedAt: string;
  readonly startedAt: string;
}

export function attemptOpening(ticket: MissionAttemptTicket): MissionAttemptOpening {
  return {
    attemptId: ticket.attemptId,
    chapterId: ticket.chapterId,
    missionId: ticket.missionId,
    attemptOrdinal: ticket.attemptOrdinal,
    attemptSeedHex: ticket.seedHex,
    moduleId: ticket.moduleCompletion.moduleId,
    moduleCompletedAt: ticket.moduleCompletion.completedAt,
    startedAt: ticket.openedAt,
  };
}

/**
 * Projects a child seed for a sub-system of the same attempt.
 *
 * The duel gets one of these rather than a seed of its own. Same lineage, same
 * kernel, one derivation — which is what keeps "one RNG" true across the seam
 * between the floor and the fight.
 */
export function attemptChildSeed(
  ticket: MissionAttemptTicket,
  purpose: string,
): number {
  return projectFieldSeed([ticket.seedHex, purpose]);
}
