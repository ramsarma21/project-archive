import type {
  ExecutionPlan,
  FieldCommittedEvent,
  MasteryReport,
  PresentationDirective,
  PresenterEvent,
  RuntimeSnapshot,
  RuntimeView,
} from "@pa/contracts";
import type { LocalSave, PresenterSpatialState } from "../../db.js";
import { presentationCueReady } from "../../presenter/presentationHandoff.js";

// ---------------------------------------------------------------------------
// Commit pipeline core (pure factories, no React and no persistence imports).
//
// The bodies below are moved VERBATIM from Play.tsx; every dependency is
// injected so the concurrency invariants are unit-testable under node:
//   - single-flight: one runtime commit at a time (inFlightRef guard),
//   - guard-drop semantics: a dropped event returns false and MUST be
//     retryable by one-shot emitters (feel-audit-1 P0-4/5/6),
//   - rollback: the event log reverts only when the runtime did NOT advance,
//   - acceptance propagation: resolves true only after advance + persist.
// useCommitPipeline.ts binds these factories to the live session/profile.
// ---------------------------------------------------------------------------

export interface CommitClient {
  advance(ev: PresenterEvent): Promise<{
    plan: ExecutionPlan | null;
    newDirectives: PresentationDirective[];
    done: boolean;
    committedEventCount: number;
  }>;
  submitFieldEvent(event: FieldCommittedEvent): Promise<{
    plan: ExecutionPlan | null;
    newDirectives: PresentationDirective[];
    done: boolean;
    committedEventCount: number;
  }>;
  snapshot(): Promise<RuntimeSnapshot>;
}

export interface PersistDeps {
  profileId: string;
  chapterId: string;
  packageId: string;
  flowVersion: number;
  variationRootSeedHex: string;
  // props.apiUp && profile.source === "GOOGLE" at bind time.
  cloudEnabled: boolean;
  eventsRef: { current: PresenterEvent[] };
  revisionRef: { current: number };
  cloudRevisionRef: { current: number };
  presenterSpatialRef: { current: PresenterSpatialState | null };
  putSave(save: LocalSave): Promise<unknown>;
  pushSave(
    profileId: string,
    body: unknown,
  ): Promise<{ ok: boolean; conflict?: boolean; mastery?: MasteryReport }>;
  // Bound to upsertProfile({ ...profile, cloudRevision }) by the hook.
  updateProfileCloudRevision(revision: number): Promise<void>;
  setReport(report: MasteryReport): void;
}

export function createPersist(
  deps: PersistDeps,
): (status: "IN_PROGRESS" | "COMPLETE") => Promise<void> {
  return async function persist(status: "IN_PROGRESS" | "COMPLETE") {
    const baseRevision = deps.revisionRef.current;
    const save: LocalSave = {
      profileId: deps.profileId,
      chapterId: deps.chapterId,
      packageId: deps.packageId,
      flowVersion: deps.flowVersion,
      committedEvents: deps.eventsRef.current,
      revision: baseRevision + 1,
      status,
      updatedAt: new Date().toISOString(),
      presenterSpatial: deps.presenterSpatialRef.current ?? undefined,
    };
    await deps.putSave(save);
    deps.revisionRef.current = save.revision;
    if (deps.cloudEnabled) {
      const cloudBaseRevision = deps.cloudRevisionRef.current;
      const result = await deps.pushSave(deps.profileId, {
        baseRevision: cloudBaseRevision,
        record: {
          ...save,
          saveId: deps.profileId,
          variationRootSeedHex: deps.variationRootSeedHex,
        },
      });
      if (result.conflict) throw new Error("Cloud progress changed in another session.");
      if (result.ok) {
        deps.cloudRevisionRef.current = save.revision;
        await deps.updateProfileCloudRevision(save.revision);
        if (result.mastery) deps.setReport(result.mastery);
      }
    }
  };
}

export interface ChoiceAnimationLike {
  durationMs: number;
}

export interface CommitDeps<Animation extends ChoiceAnimationLike> {
  // Read at CALL time (matching the original Play closures over clientRef).
  clientRef: { current: CommitClient | null };
  inFlightRef: { current: boolean };
  eventsRef: { current: PresenterEvent[] };
  busy: boolean;
  error: string | null;
  plan: ExecutionPlan | null;
  readyCueId: string | null;
  presentationLocationId: string | null;
  viewLocationId: string | null;
  // view?.field.activeInterrupt?.kind at bind time (onFieldEvent envelope).
  activeInterruptKind: string | undefined;
  reducedMotion: boolean;
  choiceAnimationFor(choiceId: string): Animation;
  waitMs(ms: number): Promise<void>;
  setChoiceAnimation(animation: Animation | null): void;
  setBusy(busy: boolean): void;
  setError(error: string | null): void;
  setTranscript(
    updater: (current: PresentationDirective[]) => PresentationDirective[],
  ): void;
  setView(view: RuntimeView): void;
  setPresentationOriginLocation(locationId: string | null): void;
  setPresentationLocationId(locationId: string | null): void;
  setPlan(plan: ExecutionPlan | null): void;
  setReport(report: MasteryReport): void;
  setDone(done: boolean): void;
  persist(status: "IN_PROGRESS" | "COMPLETE"): Promise<void>;
}

// Commits an ordinary presenter event. Returns true only when the runtime
// accepted and persisted it. A `false` return means the event was DROPPED
// by a transient guard (commit in flight, busy, choreography not ready):
// one-shot emitters (breather timers, debrief form selection, quest
// arrivals) MUST retry on false instead of latching, or the game idles
// forever — the soft-lock class behind feel-audit-1 P0-4/P0-5/P0-6.
// Dev-only diagnostics for guard-dropped commits (invisible soft-lock class):
// which guard rejected which event, so a stuck harness/manual session can be
// read straight off the console instead of re-deriving it from screenshots.
const DEV_BUILD: boolean =
  (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
function logDrop(kind: string, ev: { type: string }, guards: Record<string, unknown>): void {
  if (DEV_BUILD) console.warn(`[commit-drop] ${kind} ${ev.type}`, guards);
}

export function createOnEvent<Animation extends ChoiceAnimationLike>(
  deps: CommitDeps<Animation>,
): (ev: PresenterEvent) => Promise<boolean> {
  return async function onEvent(ev: PresenterEvent): Promise<boolean> {
    const client = deps.clientRef.current;
    if (
      !client ||
      deps.inFlightRef.current ||
      deps.busy ||
      deps.error ||
      (deps.plan &&
        deps.plan.request.kind !== "CHECKPOINT_DEBRIEF" &&
        deps.readyCueId !== deps.plan.cueId)
    ) {
      logDrop("onEvent", ev, {
        noClient: !client,
        inFlight: deps.inFlightRef.current,
        busy: deps.busy,
        error: deps.error,
        planCue: deps.plan?.cueId,
        readyCue: deps.readyCueId,
      });
      return false;
    }
    deps.inFlightRef.current = true;
    deps.setBusy(true);
    const priorEvents = deps.eventsRef.current;
    const originLocation = deps.presentationLocationId ?? deps.viewLocationId ?? null;
    let runtimeAdvanced = false;
    try {
      if (ev.type === "CHOICE_SELECTED") {
        const animation = deps.choiceAnimationFor(ev.choiceId);
        deps.setChoiceAnimation(animation);
        if (!deps.reducedMotion) {
          await deps.waitMs(animation.durationMs);
        }
      }
      const r = await client.advance(ev);
      runtimeAdvanced = true;
      deps.eventsRef.current = [...priorEvents, ev];
      deps.setTranscript((t) => [...t, ...r.newDirectives]);
      const snap = await client.snapshot();
      deps.setView(snap.view);
      deps.setPresentationOriginLocation(originLocation);
      deps.setPresentationLocationId(originLocation);
      deps.setPlan(r.plan);
      deps.setReport(snap.report);
      deps.setDone(r.done);
      await deps.persist(r.done ? "COMPLETE" : "IN_PROGRESS");
      return true;
    } catch (cause) {
      if (!runtimeAdvanced) deps.eventsRef.current = priorEvents;
      console.error("Could not complete game action", cause);
      deps.setError(
        cause instanceof Error && cause.message.includes("Cloud progress")
          ? "This account has newer cloud progress. Return to profiles to reload it."
          : "That action could not be completed. Return to profiles and try again.",
      );
      return false;
    } finally {
      deps.setChoiceAnimation(null);
      deps.inFlightRef.current = false;
      deps.setBusy(false);
    }
  };
}

// Commits a durable field event. Same acceptance semantics as onEvent, with
// two envelope exemptions: FIELD_REPOSITION_APPLIED is system cleanup and
// REACTIVE_EXCHANGE interrupts commit inside an already-busy envelope.
export function createOnFieldEvent<Animation extends ChoiceAnimationLike>(
  deps: CommitDeps<Animation>,
): (event: FieldCommittedEvent) => Promise<boolean> {
  return async function onFieldEvent(event: FieldCommittedEvent): Promise<boolean> {
    const client = deps.clientRef.current;
    const systemCleanup = event.type === "FIELD_REPOSITION_APPLIED";
    const reactiveEnvelope = deps.activeInterruptKind === "REACTIVE_EXCHANGE";
    if (
      !client ||
      deps.inFlightRef.current ||
      (deps.busy && !systemCleanup && !reactiveEnvelope) ||
      deps.error ||
      (!presentationCueReady(deps.plan?.cueId, deps.readyCueId) &&
        !systemCleanup &&
        !reactiveEnvelope)
    ) {
      return false;
    }
    deps.inFlightRef.current = true;
    deps.setBusy(true);
    const priorEvents = deps.eventsRef.current;
    const originLocation =
      deps.presentationLocationId ?? deps.viewLocationId ?? null;
    let runtimeAdvanced = false;
    try {
      const result = await client.submitFieldEvent(event);
      runtimeAdvanced = true;
      // Invalid/context-inappropriate field events reject in the worker
      // before they are ever admitted to the authoritative save log.
      deps.eventsRef.current = [...priorEvents, event];
      if (result.newDirectives.length > 0) {
        deps.setTranscript((current) => [
          ...current,
          ...result.newDirectives,
        ]);
      }
      const snap = await client.snapshot();
      deps.setView(snap.view);
      deps.setPresentationOriginLocation(originLocation);
      deps.setPresentationLocationId(originLocation);
      deps.setPlan(result.plan);
      deps.setReport(snap.report);
      deps.setDone(result.done);
      await deps.persist(result.done ? "COMPLETE" : "IN_PROGRESS");
      return true;
    } catch (cause) {
      if (!runtimeAdvanced) deps.eventsRef.current = priorEvents;
      // Surface commit exceptions in EVERY mode. Swallowing them in dev hid
      // the underlying failure behind the audited "silent drop to the home
      // screen with nothing actionable in console" (feel-audit-1 P0-3).
      console.error("Could not commit durable field event", event, cause);
      deps.setError(
        `A field action could not be committed (${
          cause instanceof Error ? cause.message : String(cause)
        }). Save & exit, then resume.`,
      );
      return false;
    } finally {
      deps.inFlightRef.current = false;
      deps.setBusy(false);
    }
  };
}
