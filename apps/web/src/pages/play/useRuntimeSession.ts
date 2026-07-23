import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type {
  ExecutionPlan,
  MasteryReport,
  PresentationDirective,
  PresenterEvent,
  RuntimeView,
} from "@pa/contracts";
import { RuntimeClient } from "../../runtimeClient.js";
import { getSave, type LocalProfile, type PresenterSpatialState } from "../../db.js";
import { pullMastery } from "../../api.js";
import { QA_RUNTIME_ENABLED } from "../../world/qaEnvironment.js";
import {
  qaBootstrapStopBeforeCheckpoint,
  qaCheckpointBootstrapEvent,
  qaCheckpointTargetReached,
} from "../../world/qa/cp1Bootstrap.js";

// v6 (design1 feature 3): street-level day ending — the day-close beat order
// changed (final pull -> town-board crier beat -> compressed CP1 -> Day
// Record card last), so older event logs no longer replay against this flow.
// v7 (design1 feature 4): effigy participation — the fixed event's first
// Continue became the pin-your-handbill hold and the aftermath Continue was
// folded into the walk back, changing the fixed-event beat sequence.
export const DAY1_FLOW_VERSION = 7;

// Boot/init session state for Play: the runtime worker client, the committed
// event log, save/cloud revisions, the presenter spatial snapshot pair, and
// all runtime-derived presenter state (view/plan/report/transcript/…).
// The boot effect (save load, optional cloud mastery pull, QA CP1
// fast-forward) is moved verbatim from Play.tsx.
export interface RuntimeSession {
  clientRef: MutableRefObject<RuntimeClient | null>;
  eventsRef: MutableRefObject<PresenterEvent[]>;
  runtimeCommitInFlightRef: MutableRefObject<boolean>;
  revisionRef: MutableRefObject<number>;
  cloudRevisionRef: MutableRefObject<number>;
  presenterSpatialRef: MutableRefObject<PresenterSpatialState | null>;
  transcript: PresentationDirective[];
  setTranscript: React.Dispatch<React.SetStateAction<PresentationDirective[]>>;
  plan: ExecutionPlan | null;
  setPlan: React.Dispatch<React.SetStateAction<ExecutionPlan | null>>;
  view: RuntimeView | null;
  setView: React.Dispatch<React.SetStateAction<RuntimeView | null>>;
  report: MasteryReport | null;
  setReport: React.Dispatch<React.SetStateAction<MasteryReport | null>>;
  busy: boolean;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  done: boolean;
  setDone: React.Dispatch<React.SetStateAction<boolean>>;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  restoreSpatial: PresenterSpatialState | null;
  presentationLocationId: string | null;
  setPresentationLocationId: React.Dispatch<React.SetStateAction<string | null>>;
  presentationOriginLocation: string | null;
  setPresentationOriginLocation: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useRuntimeSession(args: {
  profile: LocalProfile;
  chapterId: string;
  apiUp: boolean;
}): RuntimeSession {
  const { profile, chapterId } = args;
  const [transcript, setTranscript] = useState<PresentationDirective[]>([]);
  const [plan, setPlan] = useState<ExecutionPlan | null>(null);
  const [view, setView] = useState<RuntimeView | null>(null);
  const [report, setReport] = useState<MasteryReport | null>(null);
  const [busy, setBusy] = useState(true);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<RuntimeClient | null>(null);
  const eventsRef = useRef<PresenterEvent[]>([]);
  const runtimeCommitInFlightRef = useRef(false);
  const revisionRef = useRef(0);
  const cloudRevisionRef = useRef(0);
  // Live presenter-side spatial snapshot (player transform + visual interior),
  // mirrored by World3D every few frames. Persisted with each save so a resume
  // restores the last committed position instead of the day-start spawn
  // (feel-audit-1 P0-11). Purely presentational: replay determinism is
  // untouched because committed events never depend on it.
  const presenterSpatialRef = useRef<PresenterSpatialState | null>(null);
  const [restoreSpatial, setRestoreSpatial] =
    useState<PresenterSpatialState | null>(null);
  const [presentationLocationId, setPresentationLocationId] = useState<string | null>(null);
  const [presentationOriginLocation, setPresentationOriginLocation] = useState<string | null>(null);

  useEffect(() => {
    let client: RuntimeClient;
    try {
      client = new RuntimeClient();
    } catch (cause) {
      console.error("Could not create game worker", cause);
      setError("The game could not start on this device.");
      setBusy(false);
      return;
    }
    clientRef.current = client;
    let disposed = false;
    (async () => {
      try {
        const [save, cloudMastery] = await Promise.all([
          getSave(profile.profileId),
          args.apiUp && profile.source === "GOOGLE"
            ? pullMastery(profile.profileId)
            : Promise.resolve(null),
        ]);
        const prior =
          save?.status === "COMPLETE" || save?.flowVersion !== DAY1_FLOW_VERSION
            ? []
            : save.committedEvents;
        if (prior.length > 0 && save?.presenterSpatial) {
          setRestoreSpatial(save.presenterSpatial);
        }
        eventsRef.current = [...prior];
        revisionRef.current = save?.revision ?? 0;
        cloudRevisionRef.current = profile.cloudRevision ?? save?.revision ?? 0;
        let r = await client.init({
          profileId: profile.profileId,
          chapterId,
          variationRootSeedHex: profile.variationRootSeedHex,
          priorEvents: prior,
          assessmentMode:
            import.meta.env.VITE_CP1_ALLOW_DRAFT_BANK === "true"
              ? "QA_DRAFT"
              : "PRODUCTION",
          openResponseContentMode:
            import.meta.env.VITE_OPEN_RESPONSE_AUTHOR_DRAFT === "true"
              ? "AUTHOR_DRAFT_QA"
              : "PRODUCTION",
        });
        let bootstrapEvents = [...prior];
        const qaCp1Target =
          QA_RUNTIME_ENABLED &&
          import.meta.env.VITE_CP1_ALLOW_DRAFT_BANK === "true"
            ? new URLSearchParams(window.location.search).get("qaCp1")
            : null;
        if (qaCp1Target) {
          for (let step = 0; r.plan && step < 200; step += 1) {
            if (qaBootstrapStopBeforeCheckpoint(r.plan.request, qaCp1Target)) {
              break;
            }
            if (
              r.plan.request.kind === "CHECKPOINT_DEBRIEF" &&
              qaCheckpointTargetReached(r.plan.request, qaCp1Target)
            ) {
              break;
            }
            const event = qaCheckpointBootstrapEvent(r.plan.request);
            const advanced = await client.advance(event);
            bootstrapEvents.push(event);
            r = {
              plan: advanced.plan as ExecutionPlan,
              transcript: [...r.transcript, ...advanced.newDirectives],
              committedEventCount: advanced.committedEventCount,
            };
            if (!advanced.plan) break;
          }
        }
        if (disposed) return;
        eventsRef.current = bootstrapEvents;
        setTranscript(r.transcript);
        const snap = await client.snapshot();
        if (disposed) return;
        setView(snap.view);
        setPresentationOriginLocation(snap.view.locationId);
        setPresentationLocationId(snap.view.locationId);
        setPlan(r.plan);
        setReport(
          cloudMastery && cloudMastery.saveRevision === save?.revision
            ? cloudMastery.report
            : snap.report,
        );
        setDone(snap.done);
      } catch (cause) {
        if (!disposed) {
          console.error("Could not initialize game", cause);
          setError("Your game could not be loaded. Return to profiles and try again.");
        }
      } finally {
        if (!disposed) setBusy(false);
      }
    })();
    return () => {
      disposed = true;
      client.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.profileId]);

  return {
    clientRef,
    eventsRef,
    runtimeCommitInFlightRef,
    revisionRef,
    cloudRevisionRef,
    presenterSpatialRef,
    transcript,
    setTranscript,
    plan,
    setPlan,
    view,
    setView,
    report,
    setReport,
    busy,
    setBusy,
    done,
    setDone,
    error,
    setError,
    restoreSpatial,
    presentationLocationId,
    setPresentationLocationId,
    presentationOriginLocation,
    setPresentationOriginLocation,
  };
}
