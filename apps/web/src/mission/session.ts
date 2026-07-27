import {
  EMPTY_MODULE_GATE_LEDGER,
  deployDecision,
  newMissionTally,
  recordModuleCompletion,
  type DeployBlock,
  type DeployDecision,
  type MissionAttemptTally,
  type ModuleGateLedger,
  type ModuleRunCompletion,
} from "../module/moduleGate.js";
import type { LearningModuleDefinition } from "../module/moduleFormat.js";
import {
  EMPTY_MODULE_KNOWLEDGE,
  knowledgeForMission,
  recordMissionKnowledge,
  retryOrderedModule,
  type ModuleKnowledgeLedger,
} from "../module/moduleOrder.js";
import {
  openAttempt,
  type AttemptGrant,
  type MissionAttemptTicket,
} from "./attempt.js";
import type { MissionDuelReport } from "./duelPort.js";
import {
  missionInstanceDefects,
  type MissionBriefing,
  type MissionInstance,
} from "./levelPort.js";
import type { MissionDefinition } from "./missionFormat.js";
import {
  deriveMissionResult,
  type MissionResult,
  type MissionTraversalObservation,
  type MissionTraversalOutcome,
} from "./result.js";

// ---------------------------------------------------------------------------
// The mission session machine.
//
// One player, one hub, one attempt at a time. This is the whole spine:
//
//   IDLE -> DEPLOYING -> MODULE -> AUTHORIZING -> LOADING -> BRIEFING?
//        -> TRAVERSAL -> DUEL -> RESULT -> RETURNING -> IDLE
//
// AUTHORIZING is a round trip and it is where the attempt actually begins. The
// container used to walk straight from the module into the level, counting the
// attempt ordinal in this tab — which meant a page reload reset the count, so a
// retry rendered "attempt 1, full XP" over a run the server was correctly
// paying two thirds for. The server assigns the ordinal, mints the attempt id
// and derives the seed; this phase is the client waiting to be told all three
// rather than deciding them.
//
// Three properties are structural rather than checked, in the manner of
// @pa/duel's round machine:
//
//   1. Each phase is its own type carrying ONLY what is legal in it. There is no
//      `result` field to leave stale on TRAVERSAL, no `instance` on MODULE, and
//      no `ticket` anywhere before the gate has produced one.
//
//   2. Every phase from LOADING onward carries a MissionAttemptTicket, and the
//      ticket's constructor demands both an ENTER_MISSION decision and a grant
//      (see attempt.ts). The module gate therefore cannot be bypassed by a
//      transition: there is no representable in-mission state to transition to,
//      and for a ranked run there is no ticket without the server's row.
//
//   3. The reducer is pure and returns EFFECTS. Loading an instance and
//      disposing of one are the two things that leak if they are done by
//      convention, so they are values the machine emits and a single caller
//      applies — which is also what lets a test assert that every exit path,
//      including an abandoned run and a load that resolved after the player
//      left, emits exactly one DISPOSE_INSTANCE.
//
// What is NOT here: the simulation. A 60 Hz fixed-step loop belongs in
// traversal.ts and its state is a mutable object behind a ref, because putting
// it through a reducer would mean sixty React updates a second. This machine
// owns the discrete facts; the runtime owns the continuous ones and reports a
// terminal outcome back through TRAVERSAL_RESOLVED.
// ---------------------------------------------------------------------------

/**
 * Why a deploy could not proceed: the gate's three, the container's two, and
 * the three the server can answer with when it declines to open the attempt.
 */
export type MissionBlock =
  | DeployBlock
  | "MISSION_NOT_REGISTERED"
  | "INSTANCE_UNAVAILABLE"
  | "OFFLINE"
  | "CONTENT_MISSING"
  | "AUTHORIZATION_REFUSED";

export const MISSION_BLOCK_COPY: Readonly<Record<MissionBlock, string>> = {
  MISSION_LOCKED: "That operation is not open yet.",
  MISSION_SPENT:
    "That operation is spent. Three attempts is all there are, and they do not come back.",
  MODULE_MISSING:
    "That operation has no learning module authored yet, so there is no way in. The gate fails closed.",
  MISSION_NOT_REGISTERED:
    "That operation has no level built yet. Nothing was launched.",
  INSTANCE_UNAVAILABLE:
    "The operation could not be assembled. The attempt was not spent.",
  OFFLINE:
    "The System could not be reached, so no attempt was opened and none was spent. Try again when you are back online.",
  CONTENT_MISSING:
    "The System has nothing authored for that operation yet, so it cannot price the attempt. Nothing was spent.",
  AUTHORIZATION_REFUSED:
    "The System declined to open the attempt. Nothing was spent — reload the hub and try again.",
};

/**
 * An authorization refusal, as something a player can read.
 *
 * Takes a bare string rather than the progression layer's `AuthorizationRefusal`
 * so the container keeps no dependency on it, and falls through to the generic
 * refusal for a code it does not recognise — a new refusal should read as a
 * refusal, never as silence.
 */
const BLOCK_BY_REFUSAL: Readonly<Record<string, MissionBlock>> = {
  OFFLINE: "OFFLINE",
  MISSION_SPENT: "MISSION_SPENT",
  MISSION_LOCKED: "MISSION_LOCKED",
  CONTENT_MISSING: "CONTENT_MISSING",
};

export function missionBlockForRefusal(reason: string): MissionBlock {
  return BLOCK_BY_REFUSAL[reason] ?? "AUTHORIZATION_REFUSED";
}

// ---- phases ---------------------------------------------------------------

export interface IdlePhase {
  readonly phase: "IDLE";
}

/** Deploy is pressed and the gate is being asked. Resolves within the reducer. */
export interface DeployingPhase {
  readonly phase: "DEPLOYING";
  readonly missionId: string;
}

export interface ModulePhase {
  readonly phase: "MODULE";
  readonly missionId: string;
  readonly attemptOrdinal: number;
  readonly definition: LearningModuleDefinition;
}

/**
 * The deck is read and the server is being asked to open the attempt.
 *
 * Nothing is loaded and nothing is spent from here: a refusal returns the
 * player to the hub with the module completion still on the ledger, so Deploy
 * re-enters this attempt rather than making them read six cards again.
 */
export interface AuthorizingPhase {
  readonly phase: "AUTHORIZING";
  readonly missionId: string;
  /** The gate's receipt, held while the server decides what it opens. */
  readonly completion: ModuleRunCompletion;
  /** What this browser believes the ordinal is. The server's may differ. */
  readonly expectedOrdinal: number;
}

/** The gate has opened an attempt and the instance is being assembled. */
export interface LoadingPhase {
  readonly phase: "LOADING";
  readonly ticket: MissionAttemptTicket;
}

export interface BriefingPhase {
  readonly phase: "BRIEFING";
  readonly ticket: MissionAttemptTicket;
  readonly instance: MissionInstance;
  readonly briefing: MissionBriefing;
}

export interface TraversalPhase {
  readonly phase: "TRAVERSAL";
  readonly ticket: MissionAttemptTicket;
  readonly instance: MissionInstance;
  readonly startedAt: string;
}

export interface DuelPhase {
  readonly phase: "DUEL";
  readonly ticket: MissionAttemptTicket;
  readonly instance: MissionInstance;
  /** Always REACHED_DUEL: a failed traversal cannot reach this phase. */
  readonly traversal: MissionTraversalOutcome & { readonly kind: "REACHED_DUEL" };
  /** Carried so the result can report the traversal's wall clock, not just its ticks. */
  readonly traversalStartedAt: string;
  readonly startedAt: string;
}

export interface ResultPhase {
  readonly phase: "RESULT";
  readonly ticket: MissionAttemptTicket;
  /** Retained so the arena can stay behind the summary. Freed on RETURNING. */
  readonly instance: MissionInstance | null;
  readonly result: MissionResult;
}

/** Teardown in flight. The result is still readable; the instance is gone. */
export interface ReturningPhase {
  readonly phase: "RETURNING";
  readonly result: MissionResult;
}

export interface BlockedPhase {
  readonly phase: "BLOCKED";
  readonly missionId: string;
  readonly reason: MissionBlock;
}

export type MissionPhaseState =
  | IdlePhase
  | DeployingPhase
  | ModulePhase
  | AuthorizingPhase
  | LoadingPhase
  | BriefingPhase
  | TraversalPhase
  | DuelPhase
  | ResultPhase
  | ReturningPhase
  | BlockedPhase;

export type MissionPhaseName = MissionPhaseState["phase"];

export interface MissionSession {
  readonly phase: MissionPhaseState;
  /** Module completions this session, one per (mission, attempt) at most. */
  readonly ledger: ModuleGateLedger;
  /** Resolved attempts per mission. A live attempt is not counted until it ends. */
  readonly tallies: Readonly<Record<string, MissionAttemptTally>>;
  /**
   * What each mission's last resolved attempt demonstrated, concept by concept.
   * Written when an attempt resolves; read by the gate to order the retry deck.
   *
   * Session-scoped like `ledger` and `tallies` above, so a reload drops it and
   * the next deck falls back to the authored order. The durable home is the
   * server's assessment record, and adopting it is a swap of this field's
   * source rather than a change to the gate.
   */
  readonly knowledge: ModuleKnowledgeLedger;
}

export function initialMissionSession(): MissionSession {
  return {
    phase: { phase: "IDLE" },
    ledger: EMPTY_MODULE_GATE_LEDGER,
    tallies: {},
    knowledge: EMPTY_MODULE_KNOWLEDGE,
  };
}

/** Phases that own the whole screen. The hub hides its chrome for these. */
const FOREGROUND: ReadonlySet<MissionPhaseName> = new Set<MissionPhaseName>([
  "MODULE",
  "AUTHORIZING",
  "LOADING",
  "BRIEFING",
  "TRAVERSAL",
  "DUEL",
  "RESULT",
  "RETURNING",
]);

export function missionSessionIsForeground(session: MissionSession): boolean {
  return FOREGROUND.has(session.phase.phase);
}

/** The instance the session currently holds, if any. Used by teardown. */
export function sessionInstance(session: MissionSession): MissionInstance | null {
  const phase = session.phase;
  switch (phase.phase) {
    case "BRIEFING":
    case "TRAVERSAL":
    case "DUEL":
      return phase.instance;
    case "RESULT":
      return phase.instance;
    default:
      return null;
  }
}

/**
 * How many attempts a mission has spent.
 *
 * Two sources, in one order that matters. `session.tallies` holds only missions
 * THIS session resolved, which is strictly newer than any snapshot — an outcome
 * still sitting in the offline outbox is real and the server has not heard of
 * it yet. Everything else falls through to the server's count, which is the
 * only one that survives a reload or a cleared browser store.
 */
export function missionTally(
  session: MissionSession,
  missionId: string,
  serverTallies: Readonly<Record<string, MissionAttemptTally>> = {},
): MissionAttemptTally {
  return (
    session.tallies[missionId] ??
    serverTallies[missionId] ??
    newMissionTally(missionId)
  );
}

// ---- commands and effects -------------------------------------------------

export type MissionCommand =
  | { readonly kind: "REQUEST_DEPLOY"; readonly missionId: string }
  | { readonly kind: "MODULE_COMPLETED"; readonly completion: ModuleRunCompletion }
  | { readonly kind: "ABANDON_MODULE" }
  /** The server opened the attempt, or practice is proceeding unranked. */
  | { readonly kind: "ATTEMPT_AUTHORIZED"; readonly grant: AttemptGrant }
  | { readonly kind: "ATTEMPT_REFUSED"; readonly reason: MissionBlock }
  | { readonly kind: "INSTANCE_READY"; readonly instance: MissionInstance }
  | { readonly kind: "INSTANCE_FAILED"; readonly detail: string }
  | { readonly kind: "BRIEFING_ACKNOWLEDGED" }
  | {
      readonly kind: "TRAVERSAL_RESOLVED";
      readonly outcome: MissionTraversalOutcome;
    }
  | { readonly kind: "DUEL_RESOLVED"; readonly report: MissionDuelReport }
  | {
      readonly kind: "ABANDON_ATTEMPT";
      readonly reason: string;
      /** What the live run had measured. A quit attempt's seconds are evidence too. */
      readonly observation?: MissionTraversalObservation;
    }
  | { readonly kind: "RETURN_TO_HUB" }
  | { readonly kind: "RETURN_SETTLED" }
  | { readonly kind: "DISMISS_BLOCK" };

export type MissionEffect =
  | {
      readonly kind: "LOAD_INSTANCE";
      readonly ticket: MissionAttemptTicket;
      readonly definition: MissionDefinition;
    }
  /** Ask the server to open the attempt. Answered by ATTEMPT_AUTHORIZED/REFUSED. */
  | {
      readonly kind: "AUTHORIZE_ATTEMPT";
      readonly missionId: string;
      readonly completion: ModuleRunCompletion;
    }
  | { readonly kind: "DISPOSE_INSTANCE"; readonly instance: MissionInstance }
  | { readonly kind: "COMMIT_RESULT"; readonly result: MissionResult };

/** Everything the reducer needs from outside itself. No state, no mutation. */
export interface MissionSessionEnv {
  readonly chapterId: string;
  isUnlocked(missionId: string): boolean;
  moduleFor(missionId: string): LearningModuleDefinition | undefined;
  definitionFor(missionId: string): MissionDefinition | undefined;
  /** ISO instant for this transition. Injected so the machine stays pure. */
  readonly now: string;
  /** Fresh attempt id. Unranked practice only; a ranked run takes the server's. */
  newAttemptId(): string;
  /** The profile's variation root, when there is one. Seeds an unranked run. */
  readonly profileSeedHex: string | null;
  /**
   * True when an attempt must be opened server-side before it can be entered.
   * False is the unranked and headless case: no profile to open a row against,
   * so nothing is spent and nothing can be paid.
   */
  readonly authorizesAttempts?: boolean;
  /** Resolved attempts the server reports, by mission. Survives a reload. */
  readonly serverTallies?: Readonly<Record<string, MissionAttemptTally>>;
}

export type MissionRejectionCode =
  | "COMMAND_NOT_LEGAL_IN_PHASE"
  | "COMPLETION_DOES_NOT_MATCH_BRIEFING"
  | "TICKET_COULD_NOT_BE_OPENED"
  | "INSTANCE_DOES_NOT_MATCH_ATTEMPT"
  | "TRAVERSAL_OUTCOME_NOT_TERMINAL";

export interface MissionRejection {
  readonly code: MissionRejectionCode;
  readonly detail: string;
}

export type MissionReduceResult =
  | {
      readonly ok: true;
      readonly session: MissionSession;
      readonly effects: readonly MissionEffect[];
    }
  | {
      readonly ok: false;
      readonly session: MissionSession;
      readonly rejection: MissionRejection;
    };

function ok(
  session: MissionSession,
  effects: readonly MissionEffect[] = [],
): MissionReduceResult {
  return { ok: true, session, effects };
}

function reject(
  session: MissionSession,
  code: MissionRejectionCode,
  detail: string,
): MissionReduceResult {
  return { ok: false, session, rejection: { code, detail } };
}

function blocked(
  session: MissionSession,
  missionId: string,
  reason: MissionBlock,
  effects: readonly MissionEffect[] = [],
): MissionReduceResult {
  return ok({ ...session, phase: { phase: "BLOCKED", missionId, reason } }, effects);
}

/**
 * Asks the gate and acts on its answer.
 *
 * Called from two places — pressing Deploy, and finishing the module — and it is
 * deliberately the same call in both. Finishing a module is not itself
 * permission to enter: the completion is recorded and the gate is asked again,
 * so there is one answer to "may this player be in a mission" rather than one at
 * Deploy and a second at the end of the deck.
 */
function decideAndAct(
  session: MissionSession,
  missionId: string,
  ledger: ModuleGateLedger,
  env: MissionSessionEnv,
): MissionReduceResult {
  const withLedger: MissionSession = { ...session, ledger };
  const definition = env.definitionFor(missionId);
  if (!definition) {
    return blocked(withLedger, missionId, "MISSION_NOT_REGISTERED");
  }

  // The retry deck opens on what the last attempt got wrong. This is the only
  // place a module definition enters the machine, so ordering it here means
  // both routes in — pressing Deploy, and re-asking after the deck is read —
  // see the same deck, and the second cannot disagree with the first. On a
  // first attempt, and on a loss where every question landed, there is no
  // evidence to act on and the authored definition comes back unchanged.
  const authored = env.moduleFor(missionId);
  const definitionForGate = retryOrderedModule(
    authored,
    knowledgeForMission(session.knowledge, missionId),
  );

  const decision = deployDecision({
    ledger,
    tally: missionTally(withLedger, missionId, env.serverTallies),
    unlocked: env.isUnlocked(missionId),
    definition: definitionForGate,
  });

  if (decision.kind === "BLOCKED") {
    return blocked(withLedger, missionId, decision.reason);
  }
  if (decision.kind === "RUN_MODULE") {
    return ok({
      ...withLedger,
      phase: {
        phase: "MODULE",
        missionId,
        attemptOrdinal: decision.attemptOrdinal,
        definition: decision.definition,
      },
    });
  }

  // The gate is satisfied. Who opens the attempt is the remaining question, and
  // for a signed-in player the answer is the server — including the ordinal,
  // which is the whole reason this is a round trip rather than a transition.
  if (env.authorizesAttempts) {
    return ok(
      {
        ...withLedger,
        phase: {
          phase: "AUTHORIZING",
          missionId,
          completion: decision.completion,
          expectedOrdinal: decision.attemptOrdinal,
        },
      },
      [
        {
          kind: "AUTHORIZE_ATTEMPT",
          missionId,
          completion: decision.completion,
        },
      ],
    );
  }

  return enterMission(withLedger, decision, definition, env, {
    kind: "UNRANKED_PRACTICE",
    attemptId: env.newAttemptId(),
  });
}

/** Mints the ticket and asks for the level. The only route into LOADING. */
function enterMission(
  session: MissionSession,
  decision: DeployDecision,
  definition: MissionDefinition,
  env: MissionSessionEnv,
  grant: AttemptGrant,
): MissionReduceResult {
  const ticket = openAttempt({
    decision,
    chapterId: definition.chapterId,
    grant,
    at: env.now,
    profileSeedHex: env.profileSeedHex,
  });
  if (!ticket) {
    // The gate said yes and the ticket refused. That is a defect in one of the
    // two, not a player-facing state, so it fails closed and loudly.
    return reject(
      session,
      "TICKET_COULD_NOT_BE_OPENED",
      `${definition.missionId} on a ${grant.kind} grant`,
    );
  }
  return ok({ ...session, phase: { phase: "LOADING", ticket } }, [
    { kind: "LOAD_INSTANCE", ticket, definition },
  ]);
}

/** Resolves the open attempt into a result, spending it. */
function resolveAttempt(
  session: MissionSession,
  input: {
    ticket: MissionAttemptTicket;
    instance: MissionInstance | null;
    traversal: MissionTraversalOutcome | null;
    observation: MissionTraversalObservation | null;
    duel: MissionDuelReport | null;
    abandoned: { reason: string } | null;
    traversalStartedAt: string | null;
    duelStartedAt: string | null;
  },
  env: MissionSessionEnv,
): MissionReduceResult {
  const definition = env.definitionFor(input.ticket.missionId);
  const result = deriveMissionResult({
    ticket: input.ticket,
    baseXp: definition?.baseXp ?? 0,
    tallyBefore: missionTally(session, input.ticket.missionId, env.serverTallies),
    traversal: input.traversal,
    observation: input.observation,
    duel: input.duel,
    abandoned: input.abandoned,
    traversalBudgetS: input.instance?.traversalBudgetS ?? 0,
    clock: {
      traversalStartedAt: input.traversalStartedAt,
      duelStartedAt: input.duelStartedAt,
    },
    at: env.now,
  });
  return ok(
    {
      ...session,
      tallies: { ...session.tallies, [input.ticket.missionId]: result.tally },
      // The evidence the next deck is ordered by. Recorded for every resolved
      // attempt including a clear, because a mission the player cleared cannot
      // be retried and an empty round list orders nothing.
      knowledge: recordMissionKnowledge(
        session.knowledge,
        input.ticket.missionId,
        result.knowledge.rounds,
      ),
      phase: {
        phase: "RESULT",
        ticket: input.ticket,
        instance: input.instance,
        result,
      },
    },
    [{ kind: "COMMIT_RESULT", result }],
  );
}

/**
 * The reducer. One command, one transition, and the effects that transition owes.
 */
export function reduceMission(
  session: MissionSession,
  command: MissionCommand,
  env: MissionSessionEnv,
): MissionReduceResult {
  const phase = session.phase;

  // Handled first and in every phase: an instance that arrives when nothing is
  // waiting for it is a leak unless it is disposed of here. This is the case a
  // player produces by leaving the hub while a level is still loading.
  if (command.kind === "INSTANCE_READY" && phase.phase !== "LOADING") {
    return ok(session, [
      { kind: "DISPOSE_INSTANCE", instance: command.instance },
    ]);
  }

  switch (command.kind) {
    case "REQUEST_DEPLOY": {
      if (phase.phase !== "IDLE" && phase.phase !== "BLOCKED") {
        return reject(session, "COMMAND_NOT_LEGAL_IN_PHASE", phase.phase);
      }
      return decideAndAct(
        { ...session, phase: { phase: "DEPLOYING", missionId: command.missionId } },
        command.missionId,
        session.ledger,
        env,
      );
    }

    case "MODULE_COMPLETED": {
      if (phase.phase !== "MODULE") {
        return reject(session, "COMMAND_NOT_LEGAL_IN_PHASE", phase.phase);
      }
      const { completion } = command;
      if (
        completion.missionId !== phase.missionId ||
        completion.attemptOrdinal !== phase.attemptOrdinal
      ) {
        // One module run arms exactly one attempt on exactly one mission.
        return reject(
          session,
          "COMPLETION_DOES_NOT_MATCH_BRIEFING",
          `${completion.missionId}#${completion.attemptOrdinal} for ${phase.missionId}#${phase.attemptOrdinal}`,
        );
      }
      return decideAndAct(
        session,
        phase.missionId,
        recordModuleCompletion(session.ledger, completion),
        env,
      );
    }

    case "ABANDON_MODULE": {
      if (phase.phase !== "MODULE") {
        return reject(session, "COMMAND_NOT_LEGAL_IN_PHASE", phase.phase);
      }
      // Nothing is recorded, so the gate stays shut and the ordinal does not move.
      return ok({ ...session, phase: { phase: "IDLE" } });
    }

    case "ATTEMPT_AUTHORIZED": {
      if (phase.phase !== "AUTHORIZING") {
        // A grant that arrives after the player left. The server's row stays
        // open and `authorizeAttempt` resumes it on the next deploy, so
        // dropping it here costs nothing and entering on it would put a player
        // into a mission they had already backed out of.
        return reject(session, "COMMAND_NOT_LEGAL_IN_PHASE", phase.phase);
      }
      const definition = env.definitionFor(phase.missionId);
      if (!definition) {
        return blocked(session, phase.missionId, "MISSION_NOT_REGISTERED");
      }
      // Re-asking the gate would re-derive the ordinal from this browser's
      // tally, which is the number the round trip exists to replace. The
      // decision is rebuilt from the receipt the phase is holding instead, and
      // the ticket takes its ordinal from the grant.
      return enterMission(
        session,
        {
          kind: "ENTER_MISSION",
          missionId: phase.missionId,
          attemptOrdinal: phase.expectedOrdinal,
          completion: phase.completion,
        },
        definition,
        env,
        command.grant,
      );
    }

    case "ATTEMPT_REFUSED": {
      if (phase.phase !== "AUTHORIZING") {
        return reject(session, "COMMAND_NOT_LEGAL_IN_PHASE", phase.phase);
      }
      // The completion stays on the ledger. The server refused to OPEN the
      // attempt, so nothing was spent, and making the player re-read the deck
      // for a network failure would be a punishment for the wrong party.
      return blocked(session, phase.missionId, command.reason);
    }

    case "INSTANCE_READY": {
      // phase.phase === "LOADING" by the guard above.
      const loading = phase as LoadingPhase;
      const instance = command.instance;
      const wrongAttempt =
        instance.missionId !== loading.ticket.missionId ||
        instance.attemptOrdinal !== loading.ticket.attemptOrdinal;
      const defects = wrongAttempt
        ? [`built for ${instance.missionId} attempt ${instance.attemptOrdinal}`]
        : missionInstanceDefects(instance);
      if (defects.length > 0) {
        // Refused before the player is inside it, and freed on the way out.
        console.error(
          `[mission] ${loading.ticket.missionId} attempt ` +
            `${loading.ticket.attemptOrdinal} was refused: ${defects.join("; ")}.`,
        );
        return ok(
          {
            ...session,
            phase: {
              phase: "BLOCKED",
              missionId: loading.ticket.missionId,
              reason: "INSTANCE_UNAVAILABLE",
            },
          },
          [{ kind: "DISPOSE_INSTANCE", instance }],
        );
      }
      if (instance.briefing) {
        return ok({
          ...session,
          phase: {
            phase: "BRIEFING",
            ticket: loading.ticket,
            instance,
            briefing: instance.briefing,
          },
        });
      }
      return ok({
        ...session,
        phase: {
          phase: "TRAVERSAL",
          ticket: loading.ticket,
          instance,
          startedAt: env.now,
        },
      });
    }

    case "INSTANCE_FAILED": {
      if (phase.phase !== "LOADING") {
        return reject(session, "COMMAND_NOT_LEGAL_IN_PHASE", phase.phase);
      }
      // Nothing was played, so nothing is spent. The ordinal is still open and
      // the module completion still gates it, so Deploy re-enters this attempt.
      return blocked(session, phase.ticket.missionId, "INSTANCE_UNAVAILABLE");
    }

    case "BRIEFING_ACKNOWLEDGED": {
      if (phase.phase !== "BRIEFING") {
        return reject(session, "COMMAND_NOT_LEGAL_IN_PHASE", phase.phase);
      }
      return ok({
        ...session,
        phase: {
          phase: "TRAVERSAL",
          ticket: phase.ticket,
          instance: phase.instance,
          startedAt: env.now,
        },
      });
    }

    case "TRAVERSAL_RESOLVED": {
      if (phase.phase !== "TRAVERSAL") {
        return reject(session, "COMMAND_NOT_LEGAL_IN_PHASE", phase.phase);
      }
      if (command.outcome.kind === "REACHED_DUEL") {
        return ok({
          ...session,
          phase: {
            phase: "DUEL",
            ticket: phase.ticket,
            instance: phase.instance,
            traversal: command.outcome,
            traversalStartedAt: phase.startedAt,
            startedAt: env.now,
          },
        });
      }
      return resolveAttempt(
        session,
        {
          ticket: phase.ticket,
          instance: phase.instance,
          traversal: command.outcome,
          observation: null,
          duel: null,
          abandoned: null,
          traversalStartedAt: phase.startedAt,
          duelStartedAt: null,
        },
        env,
      );
    }

    case "DUEL_RESOLVED": {
      if (phase.phase !== "DUEL") {
        return reject(session, "COMMAND_NOT_LEGAL_IN_PHASE", phase.phase);
      }
      return resolveAttempt(
        session,
        {
          ticket: phase.ticket,
          instance: phase.instance,
          traversal: phase.traversal,
          observation: null,
          duel: command.report,
          abandoned: null,
          traversalStartedAt: phase.traversalStartedAt,
          duelStartedAt: phase.startedAt,
        },
        env,
      );
    }

    case "ABANDON_ATTEMPT": {
      // Cancelling a load, or walking out while the server is still deciding,
      // spends nothing: the player never saw the mission. A row the server
      // opened in the meantime is resumed by the next deploy.
      if (phase.phase === "LOADING" || phase.phase === "AUTHORIZING") {
        return ok({ ...session, phase: { phase: "IDLE" } });
      }
      // From the briefing onward the instance is mounted and the attempt is
      // live, so leaving spends it. Any softer rule makes quitting an infinite
      // retry, which is exactly what a three-attempt schedule cannot allow.
      if (
        phase.phase === "BRIEFING" ||
        phase.phase === "TRAVERSAL" ||
        phase.phase === "DUEL"
      ) {
        return resolveAttempt(
          session,
          {
            ticket: phase.ticket,
            instance: phase.instance,
            traversal: phase.phase === "DUEL" ? phase.traversal : null,
            observation: command.observation ?? null,
            duel: null,
            abandoned: { reason: command.reason },
            traversalStartedAt:
              phase.phase === "TRAVERSAL"
                ? phase.startedAt
                : phase.phase === "DUEL"
                  ? phase.traversalStartedAt
                  : null,
            duelStartedAt: phase.phase === "DUEL" ? phase.startedAt : null,
          },
          env,
        );
      }
      return reject(session, "COMMAND_NOT_LEGAL_IN_PHASE", phase.phase);
    }

    case "RETURN_TO_HUB": {
      if (phase.phase !== "RESULT") {
        return reject(session, "COMMAND_NOT_LEGAL_IN_PHASE", phase.phase);
      }
      return ok(
        { ...session, phase: { phase: "RETURNING", result: phase.result } },
        phase.instance
          ? [{ kind: "DISPOSE_INSTANCE", instance: phase.instance }]
          : [],
      );
    }

    case "RETURN_SETTLED": {
      if (phase.phase !== "RETURNING") {
        return reject(session, "COMMAND_NOT_LEGAL_IN_PHASE", phase.phase);
      }
      return ok({ ...session, phase: { phase: "IDLE" } });
    }

    case "DISMISS_BLOCK": {
      if (phase.phase !== "BLOCKED") {
        return reject(session, "COMMAND_NOT_LEGAL_IN_PHASE", phase.phase);
      }
      return ok({ ...session, phase: { phase: "IDLE" } });
    }
  }
}
