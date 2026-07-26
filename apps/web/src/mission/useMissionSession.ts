import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { moduleForMission } from "../module/m1Module.js";
import type { LearningModuleDefinition } from "../module/moduleFormat.js";
import type {
  MissionAttemptTally,
  ModuleGateLedger,
  ModuleRunCompletion,
} from "../module/moduleGate.js";
import type { AuthorizationResult } from "../progression/authorize.js";
import type { MissionAttemptTicket } from "./attempt.js";
import type { MissionDuelReport } from "./duelPort.js";
import type { MissionInstance } from "./levelPort.js";
import { missionDefinition } from "./missionFormat.js";
import type { MissionResult, MissionTraversalOutcome } from "./result.js";
import {
  initialMissionSession,
  missionBlockForRefusal,
  missionSessionIsForeground,
  missionTally,
  reduceMission,
  sessionInstance,
  type MissionCommand,
  type MissionEffect,
  type MissionPhaseState,
  type MissionSession,
  type MissionSessionEnv,
} from "./session.js";
import {
  createMissionRuntime,
  disposeMissionRuntime,
  missionObservation,
  type MissionRuntime,
} from "./traversal.js";

// ---------------------------------------------------------------------------
// The seam between the hub and all gameplay.
//
// The hub holds one object. It presses Deploy on it, renders whatever it says is
// in the foreground, and is handed a result when an attempt resolves. It does not
// know what a ticket is, cannot compute XP, and has no way to reach a mission
// without the module gate having produced permission first.
//
// This hook owns exactly two things a pure reducer cannot: the async instance
// load, and disposal. Both are effects the machine emits, applied here in one
// place, so there is a single answer to "what frees the level" instead of one per
// exit path. Disposal is idempotent through a WeakSet, because the paths that
// converge on it — returning to the hub, abandoning a run, a load that resolves
// after the player left, an unmounted hub — genuinely can overlap.
//
// Note what this hook does NOT own: a frame loop. The simulation is stepped
// inside the canvas's existing render loop (see MissionStage), so there is no
// second requestAnimationFrame and no interval anywhere in the container. That is
// deliberate: a leaked loop across repeated attempts is the failure mode the
// design called out, and the way to not leak one is to not create one.
// ---------------------------------------------------------------------------

/** Instances already freed. A second dispose is a no-op rather than a crash. */
const disposed = new WeakSet<MissionInstance>();

function disposeInstanceOnce(instance: MissionInstance): void {
  if (disposed.has(instance)) return;
  disposed.add(instance);
  try {
    instance.dispose();
  } catch (cause) {
    console.error(`[mission] ${instance.missionId} failed to dispose cleanly`, cause);
  }
}

function newAttemptId(): string {
  const source = globalThis.crypto;
  if (source && typeof source.randomUUID === "function") return source.randomUUID();
  // Non-cryptographic, and it does not need to be: an attempt id is identity for
  // one browser session until the server mints the durable one.
  return `attempt-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export interface MissionSessionOptions {
  /** The chapter the hub is showing. Scopes the attempt seed and the commit. */
  readonly chapterId: string;
  /** Whether the chapter route has opened a mission. The hub's map decides. */
  isUnlocked(missionId: string): boolean;
  /** The profile's variation root, when signed in. Seeds an unranked run. */
  readonly profileSeedHex?: string | null;
  /**
   * Resolved attempts per mission, as the SERVER reports them.
   *
   * `progression.tallies` is exactly this shape. Without it the container
   * counts attempts in this tab, which is a number a page reload sets back to
   * zero — so the module header offers "attempt 1 of 3" on a mission with two
   * already burned, and the result screen promises a payout that is not coming.
   */
  readonly tallies?: Readonly<Record<string, MissionAttemptTally>>;
  /**
   * Opens the attempt server-side, and is what makes the run ranked.
   *
   * `progression.authorize` is exactly this shape. Supplying it means no
   * mission can be entered without a durable row behind it; omitting it is the
   * unranked case — practice, dev harnesses and tests — where nothing is
   * spent because nothing was ever opened.
   */
  readonly authorizeAttempt?: (
    completion: ModuleRunCompletion,
  ) => Promise<AuthorizationResult>;
  /**
   * Called once per resolved attempt, with the XP already derived. This is the
   * hub's cue to persist: the result carries the commit the server needs and the
   * tally the hub should store.
   */
  readonly onResult?: (result: MissionResult) => void;
  /** Override for tests and for chapters whose modules live elsewhere. */
  readonly moduleFor?: (missionId: string) => LearningModuleDefinition | undefined;
}

export interface MissionSessionApi {
  readonly phase: MissionPhaseState;
  /** True while the container owns the screen. The hub hides its chrome. */
  readonly isForeground: boolean;
  /** The live run, during TRAVERSAL and after. Null everywhere else. */
  readonly runtime: MissionRuntime | null;
  /** The most recent resolved attempt, for as long as the session lasts. */
  readonly lastResult: MissionResult | null;
  readonly ledger: ModuleGateLedger;
  tallyFor(missionId: string): MissionAttemptTally;

  /** What the hub's Deploy button calls. Everything else follows from it. */
  requestDeploy(missionId: string): void;
  completeModule(completion: ModuleRunCompletion): void;
  abandonModule(): void;
  acknowledgeBriefing(): void;
  resolveTraversal(outcome: MissionTraversalOutcome): void;
  resolveDuel(report: MissionDuelReport): void;
  abandonAttempt(reason: string): void;
  returnToHub(): void;
  dismissBlock(): void;
}

export function useMissionSession(
  options: MissionSessionOptions,
): MissionSessionApi {
  const { chapterId, isUnlocked, onResult } = options;
  const profileSeedHex = options.profileSeedHex ?? null;
  const moduleFor = options.moduleFor ?? moduleForMission;
  const serverTallies = options.tallies ?? {};
  const authorizeAttempt = options.authorizeAttempt;

  const [session, setSession] = useState<MissionSession>(initialMissionSession);
  const [lastResult, setLastResult] = useState<MissionResult | null>(null);
  const [runtime, setRuntime] = useState<MissionRuntime | null>(null);

  // The ref is the sequencing authority and the state is for rendering. Reducing
  // against a ref means two commands dispatched in the same tick — a duel that
  // resolves and a player who presses Return in the same frame — see each
  // other's transition rather than racing one setState.
  const sessionRef = useRef(session);
  const runtimeRef = useRef<MissionRuntime | null>(null);
  const loadRef = useRef<AbortController | null>(null);

  const envRef = useRef<MissionSessionEnv>({
    chapterId,
    isUnlocked,
    moduleFor,
    definitionFor: missionDefinition,
    now: new Date().toISOString(),
    newAttemptId,
    profileSeedHex,
    authorizesAttempts: authorizeAttempt !== undefined,
    serverTallies,
  });
  envRef.current = {
    ...envRef.current,
    chapterId,
    isUnlocked,
    moduleFor,
    profileSeedHex,
    authorizesAttempts: authorizeAttempt !== undefined,
    serverTallies,
  };

  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const authorizeRef = useRef(authorizeAttempt);
  authorizeRef.current = authorizeAttempt;

  const releaseRuntime = useCallback((instance: MissionInstance | null) => {
    const current = runtimeRef.current;
    if (!current) return;
    if (instance && current.instance !== instance) return;
    disposeMissionRuntime(current);
    runtimeRef.current = null;
    setRuntime(null);
  }, []);

  const applyEffect = useCallback(
    (effect: MissionEffect, dispatch: (command: MissionCommand) => void) => {
      if (effect.kind === "DISPOSE_INSTANCE") {
        releaseRuntime(effect.instance);
        disposeInstanceOnce(effect.instance);
        return;
      }
      if (effect.kind === "COMMIT_RESULT") {
        setLastResult(effect.result);
        onResultRef.current?.(effect.result);
        return;
      }
      if (effect.kind === "AUTHORIZE_ATTEMPT") {
        const authorize = authorizeRef.current;
        if (!authorize) {
          // The reducer only emits this when an authorizer is wired, so losing
          // one between the transition and the effect is a defect, not a state.
          dispatch({ kind: "ATTEMPT_REFUSED", reason: "AUTHORIZATION_REFUSED" });
          return;
        }
        void authorize(effect.completion)
          .then((result) => {
            if (result.ok) {
              dispatch({
                kind: "ATTEMPT_AUTHORIZED",
                grant: { kind: "SERVER", grant: result.authorization },
              });
              return;
            }
            // Nobody is signed in, so there is no durable attempt to open and
            // nothing that could be paid. The run still happens — the hub is
            // already saying "Practice · nothing is saved" — and the ticket
            // records that it was never ranked.
            if (result.reason === "NO_PROFILE") {
              dispatch({
                kind: "ATTEMPT_AUTHORIZED",
                grant: { kind: "UNRANKED_PRACTICE", attemptId: newAttemptId() },
              });
              return;
            }
            dispatch({
              kind: "ATTEMPT_REFUSED",
              reason: missionBlockForRefusal(result.reason),
            });
          })
          .catch((cause: unknown) => {
            console.error("[mission] the attempt could not be authorized", cause);
            dispatch({ kind: "ATTEMPT_REFUSED", reason: "OFFLINE" });
          });
        return;
      }
      // LOAD_INSTANCE. The controller is held so leaving the hub aborts the load,
      // and the instance is disposed of the moment it arrives unwanted — twice
      // over, because the reducer also disposes an INSTANCE_READY that lands
      // outside LOADING.
      loadRef.current?.abort();
      const controller = new AbortController();
      loadRef.current = controller;
      const { ticket, definition } = effect;
      void definition
        .load({
          missionId: ticket.missionId,
          chapterId: ticket.chapterId,
          attemptOrdinal: ticket.attemptOrdinal,
          seed: ticket.seed,
          seedHex: ticket.seedHex,
          attemptId: ticket.attemptId,
          signal: controller.signal,
        })
        .then((instance) => {
          if (controller.signal.aborted) {
            disposeInstanceOnce(instance);
            return;
          }
          dispatch({ kind: "INSTANCE_READY", instance });
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          console.error(`[mission] ${ticket.missionId} failed to load`, cause);
          dispatch({
            kind: "INSTANCE_FAILED",
            detail: cause instanceof Error ? cause.message : String(cause),
          });
        });
    },
    [releaseRuntime],
  );

  const dispatch = useCallback(
    (command: MissionCommand) => {
      const env: MissionSessionEnv = {
        ...envRef.current,
        now: new Date().toISOString(),
      };
      const before = sessionRef.current;
      const result = reduceMission(before, command, env);
      if (!result.ok) {
        console.warn(
          `[mission] ${command.kind} refused: ${result.rejection.code} (${result.rejection.detail}).`,
        );
        return;
      }
      sessionRef.current = result.session;
      setSession(result.session);

      // Leaving LOADING for anything the load was not for — an abandoned deploy,
      // a refused instance — cancels it. The reducer disposes of a level that
      // arrives unwanted anyway; this stops it being fetched in the first place.
      if (before.phase.phase === "LOADING" && result.session.phase.phase !== "LOADING") {
        loadRef.current?.abort();
        loadRef.current = null;
      }

      // The runtime is built with the transition rather than after it, so the
      // frame that first renders TRAVERSAL already has something to step.
      const phase = result.session.phase;
      if (phase.phase === "TRAVERSAL" && runtimeRef.current?.instance !== phase.instance) {
        const next = createMissionRuntime({
          instance: phase.instance,
          seed: phase.ticket.seed,
        });
        runtimeRef.current = next;
        setRuntime(next);
      }

      for (const effect of result.effects) applyEffect(effect, dispatch);
    },
    [applyEffect],
  );

  // Teardown settles on the next frame, which is also the frame the canvas
  // unmounts on, so the curtain covers it instead of a flash of the hub.
  useEffect(() => {
    if (session.phase.phase !== "RETURNING") return undefined;
    const handle = requestAnimationFrame(() => dispatch({ kind: "RETURN_SETTLED" }));
    return () => cancelAnimationFrame(handle);
  }, [dispatch, session.phase.phase]);

  // The last line of defence. A hub that unmounts mid-attempt — a route change, a
  // thrown error caught upstream — still frees the level and cancels the load.
  useEffect(
    () => () => {
      loadRef.current?.abort();
      loadRef.current = null;
      const instance = sessionInstance(sessionRef.current);
      releaseRuntime(null);
      if (instance) disposeInstanceOnce(instance);
    },
    [releaseRuntime],
  );

  return useMemo<MissionSessionApi>(
    () => ({
      phase: session.phase,
      isForeground: missionSessionIsForeground(session),
      runtime,
      lastResult,
      ledger: session.ledger,
      tallyFor: (missionId: string) =>
        missionTally(session, missionId, envRef.current.serverTallies),
      requestDeploy: (missionId: string) =>
        dispatch({ kind: "REQUEST_DEPLOY", missionId }),
      completeModule: (completion: ModuleRunCompletion) =>
        dispatch({ kind: "MODULE_COMPLETED", completion }),
      abandonModule: () => dispatch({ kind: "ABANDON_MODULE" }),
      acknowledgeBriefing: () => dispatch({ kind: "BRIEFING_ACKNOWLEDGED" }),
      resolveTraversal: (outcome: MissionTraversalOutcome) =>
        dispatch({ kind: "TRAVERSAL_RESOLVED", outcome }),
      resolveDuel: (report: MissionDuelReport) =>
        dispatch({ kind: "DUEL_RESOLVED", report }),
      // The live run's measurements go with it. A quit attempt still spent real
      // minutes of a student's lesson, and those minutes are the evidence the
      // pacing budget is checked against.
      abandonAttempt: (reason: string) =>
        dispatch({
          kind: "ABANDON_ATTEMPT",
          reason,
          ...(runtimeRef.current
            ? { observation: missionObservation(runtimeRef.current) }
            : {}),
        }),
      returnToHub: () => dispatch({ kind: "RETURN_TO_HUB" }),
      dismissBlock: () => dispatch({ kind: "DISMISS_BLOCK" }),
    }),
    [dispatch, lastResult, runtime, session],
  );
}

/** Re-exported so a caller can name the ticket type without reaching for it. */
export type { MissionAttemptTicket };
