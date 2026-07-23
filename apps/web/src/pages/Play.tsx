import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DayEndCard,
  ExecutionPlan,
  FieldCommittedEvent,
  InputRequest,
  MasteryReport,
  MechanicRawResult,
  OpenResponseReference,
  PresentationDirective,
  PresenterEvent,
  RuntimeView,
} from "@pa/contracts";
import { PACKAGE_ID } from "@pa/contracts";
import { RuntimeClient } from "../runtimeClient.js";
import { getSave, putSave, upsertProfile, type LocalProfile } from "../db.js";
import { pullMastery, pushSave, saveOnboardingPreferences } from "../api.js";
import { Feed } from "../presenter/Feed.js";
import { Hud } from "../presenter/Hud.js";
import { Side, HoloTasks } from "../presenter/Side.js";
import { ArchiveOverlay } from "../presenter/ArchiveOverlay.js";
import { Controls, SystemWindow } from "../presenter/Controls.js";
import { World3D } from "../world/World3D.js";
import { documentForReadPanel, getDocumentImageUrl } from "../world/documentTextures.js";
import { choiceAnimationFor, type ChoiceAnimation } from "../world/choiceAnimations.js";
import { StealthHud } from "../presenter/StealthHud.js";
import { ConfrontationPanel } from "../presenter/ConfrontationPanel.js";
import {
  ActTransitionComplete,
  CheckpointDebrief,
} from "../presenter/CheckpointDebrief.js";
import {
  OpenResponsePanel,
  type RetentionConsent,
} from "../presenter/OpenResponsePanel.js";
import { submitOpenResponse } from "../gradingClient.js";
import {
  authoredFallbackForPrompt,
  authoredFeedback,
} from "@pa/runtime";
import {
  PRESENTATION_NOTICE_EVENT,
  PresentationNoticeArbiter,
  type PresentationNotice,
} from "../presenter/noticeArbiter.js";
import {
  createStealthStore,
  stealthPatchFromRuntimeField,
} from "../world/stealthStore.js";
import {
  presentationActionSurface,
  presentationCueReady,
} from "../presenter/presentationHandoff.js";
import {
  M1_QA_CONTRACT,
  qaChaseEligibility,
  qaChaseStartEvents,
  type QaChaseResult,
} from "../world/qaChaseContract.js";
import { QA_RUNTIME_ENABLED } from "../world/qaEnvironment.js";
import {
  activeStep,
  advanceTimeline,
  buildTimeline,
  createTimelineCursor,
  type TimelineStep,
} from "../presenter/presentationTimeline.js";
import type { PresenterSpatialState } from "../db.js";

const DAY1_FLOW_VERSION = 5;

interface HoloCard {
  id: number;
  kind: "RELATIONSHIP" | "FLICKER";
  title: string;
  line: string;
  direction: "UP" | "DOWN";
  cause: string | null;
}

export function Play(props: {
  profile: LocalProfile;
  chapterId: string;
  apiUp: boolean;
  onEditPreferences: (profile: LocalProfile) => void;
  onExit: () => void;
}) {
  const { profile, chapterId } = props;
  const [transcript, setTranscript] = useState<PresentationDirective[]>([]);
  const [plan, setPlan] = useState<ExecutionPlan | null>(null);
  const [view, setView] = useState<RuntimeView | null>(null);
  const [report, setReport] = useState<MasteryReport | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [webglAvailable, setWebglAvailable] = useState(true);
  const [busy, setBusy] = useState(true);
  const [done, setDone] = useState(false);
  // A world-side cinematic beat (e.g. the Watch House chewed-out scene) hides
  // the center controls so its dialogue is never buried under the task board.
  const [cinematicBeat, setCinematicBeat] = useState(false);
  const [cinematicOwner, setCinematicOwner] = useState<string | null>(null);
  useEffect(() => {
    const onBeat = (raw: Event) => {
      const detail = (
        raw as CustomEvent<{ active?: boolean; owner?: string }>
      ).detail;
      setCinematicBeat(Boolean(detail?.active));
      setCinematicOwner(detail?.active ? detail.owner ?? null : null);
    };
    window.addEventListener("pa:cinematic-beat", onBeat);
    return () => window.removeEventListener("pa:cinematic-beat", onBeat);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<RuntimeClient | null>(null);
  const playRootRef = useRef<HTMLDivElement | null>(null);
  const stealthStore = useMemo(
    () => createStealthStore(),
    [profile.profileId],
  );
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
  const [primersSeen, setPrimersSeen] = useState(() => new Set(profile.onboarding?.primersSeen ?? []));
  const [readyCueId, setReadyCueId] = useState<string | null>(null);
  const [choiceAnimation, setChoiceAnimation] = useState<ChoiceAnimation | null>(null);
  const [activeSubtitle, setActiveSubtitle] = useState<PresentationDirective | null>(null);
  const [activeReadPanel, setActiveReadPanel] = useState<
    Extract<PresentationDirective, { kind: "READ_PANEL" }> | null
  >(null);
  const [speaking, setSpeaking] = useState(false);
  const [openResponsePhase, setOpenResponsePhase] = useState<
    "COMPOSE" | "PENDING" | "FEEDBACK"
  >("COMPOSE");
  const [openResponseFeedback, setOpenResponseFeedback] = useState<string[]>([]);
  const [openResponseFallback, setOpenResponseFallback] = useState(false);
  const [openResponseRetained, setOpenResponseRetained] = useState(false);
  const [openResponseCloseEnabled, setOpenResponseCloseEnabled] = useState(false);
  const openResponseDwellTimer = useRef(0);
  const presentedTimelineCuesRef = useRef(new Set<string>());
  const [presentationLocationId, setPresentationLocationId] = useState<string | null>(null);
  const [presentationOriginLocation, setPresentationOriginLocation] = useState<string | null>(null);
  const markChoreographyReady = useCallback((cueId: string) => {
    // Synthetic field-interrupt plans suspend an already-ready authored cue.
    // They must never replace that cue's readiness token, or resuming the exact
    // saved FREE_ROAM plan would leave movement permanently locked.
    if (cueId.startsWith("PA.FIELD.INTERRUPT.")) return;
    setReadyCueId(cueId);
  }, []);
  const [holoCards, setHoloCards] = useState<HoloCard[]>([]);
  const holoCardSeq = useRef(0);
  const holoCardTimers = useRef<number[]>([]);
  useEffect(() => () => {
    for (const timer of holoCardTimers.current) window.clearTimeout(timer);
    window.clearTimeout(openResponseDwellTimer.current);
  }, []);
  useEffect(() => {
    if (!view?.field) return;
    stealthStore.patch(stealthPatchFromRuntimeField(view.field));
  }, [stealthStore, view?.field]);

  // Post-commit micro-feedback: relationship cards and unlock flickers slide
  // in at the screen edge, non-blocking, and auto-dismiss. They never pause
  // the dialogue timeline (Day-1 §5 / Interaction-Spec §9).
  useEffect(() => {
    const feedback = (plan?.present ?? []).filter(
      (directive) => directive.kind === "RELATIONSHIP_CARD" || directive.kind === "FLICKER",
    );
    if (feedback.length === 0) return;
    feedback.forEach((directive, slot) => {
      const showTimer = window.setTimeout(() => {
        holoCardSeq.current += 1;
        const id = holoCardSeq.current;
        const card: HoloCard =
          directive.kind === "RELATIONSHIP_CARD"
            ? {
                id,
                kind: "RELATIONSHIP",
                title: directive.character,
                line: `${directive.dimension} ${directive.direction === "UP" ? "▲" : "▼"}`,
                direction: directive.direction,
                cause: directive.label,
              }
            : {
                id,
                kind: "FLICKER",
                title: directive.flicker === "ROUTE_UNLOCKED" ? "Route unlocked" : "Added to Notes",
                line: directive.label,
                direction: "UP",
                cause: null,
              };
        setHoloCards((cards) => [...cards, card]);
        const hideTimer = window.setTimeout(() => {
          setHoloCards((cards) => cards.filter((existing) => existing.id !== id));
        }, 3400);
        holoCardTimers.current.push(hideTimer);
      }, 600 + slot * 450);
      holoCardTimers.current.push(showTimer);
    });
  }, [plan?.cueId, plan?.present]);

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
          props.apiUp && profile.source === "GOOGLE"
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
          for (let step = 0; r.plan && step < 160; step += 1) {
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

  // Save & exit refreshes the LOCAL save's presenter spatial snapshot so it
  // captures WHERE the player left, not just where the last runtime event
  // committed (feel-audit-1 P0-11: walking commits nothing, so exiting at
  // the wharf used to leave the snapshot back at the previous exchange).
  // The event log and revision are untouched (revision must always equal the
  // committed event count for cloud replay validation), so this never
  // affects determinism or cloud consistency.
  async function persistAndExit() {
    try {
      const spatial = presenterSpatialRef.current;
      if (spatial && view) {
        const existing = await getSave(profile.profileId);
        if (
          existing &&
          existing.flowVersion === DAY1_FLOW_VERSION &&
          existing.committedEvents.length === eventsRef.current.length
        ) {
          await putSave({ ...existing, presenterSpatial: spatial });
        }
      }
    } catch (cause) {
      console.error("Exit-time save failed; the last committed save stands", cause);
    }
    props.onExit();
  }

  async function persist(status: "IN_PROGRESS" | "COMPLETE") {
    const baseRevision = revisionRef.current;
    const save = {
      profileId: profile.profileId,
      chapterId,
      packageId: PACKAGE_ID,
      flowVersion: DAY1_FLOW_VERSION,
      committedEvents: eventsRef.current,
      revision: baseRevision + 1,
      status,
      updatedAt: new Date().toISOString(),
      presenterSpatial: presenterSpatialRef.current ?? undefined,
    };
    await putSave(save);
    revisionRef.current = save.revision;
    if (props.apiUp && profile.source === "GOOGLE") {
      const cloudBaseRevision = cloudRevisionRef.current;
      const result = await pushSave(profile.profileId, {
        baseRevision: cloudBaseRevision,
        record: { ...save, saveId: profile.profileId, variationRootSeedHex: profile.variationRootSeedHex },
      });
      if (result.conflict) throw new Error("Cloud progress changed in another session.");
      if (result.ok) {
        cloudRevisionRef.current = save.revision;
        await upsertProfile({ ...profile, cloudRevision: save.revision });
        if (result.mastery) setReport(result.mastery);
      }
    }
  }

  // Commits an ordinary presenter event. Returns true only when the runtime
  // accepted and persisted it. A `false` return means the event was DROPPED
  // by a transient guard (commit in flight, busy, choreography not ready):
  // one-shot emitters (breather timers, debrief form selection, quest
  // arrivals) MUST retry on false instead of latching, or the game idles
  // forever — the soft-lock class behind feel-audit-1 P0-4/P0-5/P0-6.
  async function onEvent(ev: PresenterEvent): Promise<boolean> {
    const client = clientRef.current;
    if (
      !client ||
      runtimeCommitInFlightRef.current ||
      busy ||
      error ||
      (plan &&
        plan.request.kind !== "CHECKPOINT_DEBRIEF" &&
        readyCueId !== plan.cueId)
    ) return false;
    runtimeCommitInFlightRef.current = true;
    setBusy(true);
    const priorEvents = eventsRef.current;
    const originLocation = presentationLocationId ?? view?.locationId ?? null;
    let runtimeAdvanced = false;
    try {
      if (ev.type === "CHOICE_SELECTED") {
        const animation = choiceAnimationFor(ev.choiceId);
        setChoiceAnimation(animation);
        if (!profile.onboarding?.reducedMotion) {
          await new Promise((resolve) => window.setTimeout(resolve, animation.durationMs));
        }
      }
      const r = await client.advance(ev);
      runtimeAdvanced = true;
      eventsRef.current = [...priorEvents, ev];
      setTranscript((t) => [...t, ...r.newDirectives]);
      const snap = await client.snapshot();
      setView(snap.view);
      setPresentationOriginLocation(originLocation);
      setPresentationLocationId(originLocation);
      setPlan(r.plan);
      setReport(snap.report);
      setDone(r.done);
      await persist(r.done ? "COMPLETE" : "IN_PROGRESS");
      return true;
    } catch (cause) {
      if (!runtimeAdvanced) eventsRef.current = priorEvents;
      console.error("Could not complete game action", cause);
      setError(
        cause instanceof Error && cause.message.includes("Cloud progress")
          ? "This account has newer cloud progress. Return to profiles to reload it."
          : "That action could not be completed. Return to profiles and try again.",
      );
      return false;
    } finally {
      setChoiceAnimation(null);
      runtimeCommitInFlightRef.current = false;
      setBusy(false);
    }
  }

  const onFieldEvent = useCallback(
    async (event: FieldCommittedEvent): Promise<boolean> => {
      const client = clientRef.current;
      const systemCleanup = event.type === "FIELD_REPOSITION_APPLIED";
      const reactiveEnvelope =
        view?.field.activeInterrupt?.kind === "REACTIVE_EXCHANGE";
      if (
        !client ||
        runtimeCommitInFlightRef.current ||
        (busy && !systemCleanup && !reactiveEnvelope) ||
        error ||
        (!presentationCueReady(plan?.cueId, readyCueId) &&
          !systemCleanup &&
          !reactiveEnvelope)
      ) {
        return false;
      }
      runtimeCommitInFlightRef.current = true;
      setBusy(true);
      const priorEvents = eventsRef.current;
      const originLocation =
        presentationLocationId ?? view?.locationId ?? null;
      let runtimeAdvanced = false;
      try {
        const result = await client.submitFieldEvent(event);
        runtimeAdvanced = true;
        // Invalid/context-inappropriate field events reject in the worker
        // before they are ever admitted to the authoritative save log.
        eventsRef.current = [...priorEvents, event];
        if (result.newDirectives.length > 0) {
          setTranscript((current) => [
            ...current,
            ...result.newDirectives,
          ]);
        }
        const snap = await client.snapshot();
        setView(snap.view);
        setPresentationOriginLocation(originLocation);
        setPresentationLocationId(originLocation);
        setPlan(result.plan);
        setReport(snap.report);
        setDone(result.done);
        await persist(result.done ? "COMPLETE" : "IN_PROGRESS");
        return true;
      } catch (cause) {
        if (!runtimeAdvanced) eventsRef.current = priorEvents;
        // Surface commit exceptions in EVERY mode. Swallowing them in dev hid
        // the underlying failure behind the audited "silent drop to the home
        // screen with nothing actionable in console" (feel-audit-1 P0-3).
        console.error("Could not commit durable field event", event, cause);
        setError(
          `A field action could not be committed (${
            cause instanceof Error ? cause.message : String(cause)
          }). Save & exit, then resume.`,
        );
        return false;
      } finally {
        runtimeCommitInFlightRef.current = false;
        setBusy(false);
      }
    },
    [
      busy,
      error,
      plan,
      presentationLocationId,
      readyCueId,
      view?.field.activeInterrupt?.kind,
      view?.locationId,
    ],
  );

  const beginOpenResponse = useCallback(
    async (promptId: string) => {
      if (
        !view ||
        (plan?.request.kind !== "FREE_ROAM" &&
          plan?.request.kind !== "BREATHER") ||
        view?.field.activeInterrupt ||
        busy
      ) {
        return;
      }
      const interruptId = `OPEN_${promptId}_${view.field.interactionOrdinal + 1}`;
      const opened = await onFieldEvent({
        type: "FIELD_OPEN_RESPONSE_STARTED",
        eventId: `${interruptId}_START`,
        interruptId,
        promptId,
      });
      if (opened) {
        setOpenResponsePhase("COMPOSE");
        setOpenResponseFeedback([]);
        setOpenResponseFallback(false);
        setOpenResponseRetained(false);
        setOpenResponseCloseEnabled(false);
      }
    },
    [busy, onFieldEvent, plan?.request.kind, view?.field],
  );

  const submitActiveOpenResponse = useCallback(
    async (responseText: string, consent: RetentionConsent | null) => {
      const prompt = view?.openResponse.activePrompt;
      const interrupt = view?.field.activeInterrupt;
      if (
        !prompt ||
        interrupt?.kind !== "OPEN_RESPONSE" ||
        openResponsePhase !== "COMPOSE"
      ) {
        return;
      }
      setOpenResponsePhase("PENDING");
      let response: OpenResponseReference = {
        responseId: `local-${crypto.randomUUID()}`,
        attemptId: `BOS.ACT01.${profile.profileId}`,
        promptId: prompt.promptId,
        promptVersion: prompt.version,
        submittedAt: new Date().toISOString(),
        storage: "LOCAL_EPHEMERAL" as const,
      };
      let resolution = authoredFallbackForPrompt(prompt.promptId);
      if (
        profile.source === "GOOGLE" &&
        props.apiUp &&
        consent
      ) {
        const result = await submitOpenResponse({
          profileId: profile.profileId,
          attemptId: response.attemptId,
          body: {
            promptId: prompt.promptId,
            promptVersion: prompt.version,
            responseText,
            idempotencyKey: interrupt.interruptId,
            consent: {
              granted: true,
              policyVersion: consent.policyVersion,
              retainedForEducatorReview: true,
              retentionDays: consent.retentionDays,
            },
          },
        });
        if (result.ok) {
          response = result.value.response;
          resolution = result.value.resolution;
          setOpenResponseRetained(
            result.value.response.storage === "ENCRYPTED_SERVER",
          );
        }
      }
      const committed = await onFieldEvent({
        type: "FIELD_OPEN_RESPONSE_SUBMITTED",
        eventId: `${interrupt.interruptId}_SUBMITTED`,
        interruptId: interrupt.interruptId,
        promptId: prompt.promptId,
        response,
        resolution,
      });
      if (!committed) {
        setOpenResponsePhase("COMPOSE");
        return;
      }
      setOpenResponseFeedback(
        resolution.feedbackIds
          .map((feedbackId) => authoredFeedback(feedbackId))
          .filter((line): line is string => Boolean(line)),
      );
      setOpenResponseFallback(
        resolution.status === "AUTHORED_FALLBACK",
      );
      if (response.storage !== "ENCRYPTED_SERVER") {
        setOpenResponseRetained(false);
      }
      setOpenResponsePhase("FEEDBACK");
      setOpenResponseCloseEnabled(false);
      window.clearTimeout(openResponseDwellTimer.current);
      openResponseDwellTimer.current = window.setTimeout(
        () => setOpenResponseCloseEnabled(true),
        profile.onboarding?.reducedMotion ? 700 : 1200,
      );
    },
    [
      onFieldEvent,
      openResponsePhase,
      profile.onboarding?.reducedMotion,
      profile.profileId,
      profile.source,
      props.apiUp,
      view?.field.activeInterrupt,
      view?.openResponse.activePrompt,
    ],
  );

  const closeActiveOpenResponse = useCallback(async () => {
    const interrupt = view?.field.activeInterrupt;
    if (
      interrupt?.kind !== "OPEN_RESPONSE" ||
      openResponsePhase !== "FEEDBACK" ||
      !openResponseCloseEnabled
    ) {
      return;
    }
    const closed = await onFieldEvent({
      type: "FIELD_INTERRUPT_RESOLVED",
      eventId: `${interrupt.interruptId}_RESOLVED`,
      interruptId: interrupt.interruptId,
      outcome: openResponseFallback
        ? "AUTHORED_FALLBACK"
        : "FORMATIVE_CLASSIFIED",
    });
    if (closed) {
      setOpenResponsePhase("COMPOSE");
      setOpenResponseFeedback([]);
      setOpenResponseFallback(false);
      setOpenResponseRetained(false);
      setOpenResponseCloseEnabled(false);
    }
  }, [
    onFieldEvent,
    openResponseCloseEnabled,
    openResponseFallback,
    openResponsePhase,
    view?.field.activeInterrupt,
  ]);

  useEffect(() => {
    const prompt = view?.openResponse.activePrompt;
    if (!prompt || view?.field.activeInterrupt?.kind !== "OPEN_RESPONSE") return;
    const existing = view.openResponse.evidence.find(
      (record) => record.response.promptId === prompt.promptId,
    );
    if (!existing || openResponsePhase === "PENDING") return;
    if (openResponsePhase !== "FEEDBACK") {
      setOpenResponseFeedback(
        existing.resolution.feedbackIds
          .map((feedbackId) => authoredFeedback(feedbackId))
          .filter((line): line is string => Boolean(line)),
      );
      setOpenResponseFallback(
        existing.resolution.status === "AUTHORED_FALLBACK",
      );
      setOpenResponseRetained(
        existing.response.storage === "ENCRYPTED_SERVER",
      );
      setOpenResponsePhase("FEEDBACK");
      setOpenResponseCloseEnabled(false);
      window.clearTimeout(openResponseDwellTimer.current);
      openResponseDwellTimer.current = window.setTimeout(
        () => setOpenResponseCloseEnabled(true),
        profile.onboarding?.reducedMotion ? 700 : 1200,
      );
    }
  }, [
    openResponsePhase,
    profile.onboarding?.reducedMotion,
    view?.field.activeInterrupt,
    view?.openResponse,
  ]);

  useEffect(() => {
    if (!QA_RUNTIME_ENABLED) return;
    type FieldQaWindow = Window & {
      __PA_FIELD_EVENT__?: (
        event: FieldCommittedEvent,
      ) => Promise<boolean>;
    };
    const qaWindow = window as FieldQaWindow;
    qaWindow.__PA_FIELD_EVENT__ = onFieldEvent;
    return () => {
      delete qaWindow.__PA_FIELD_EVENT__;
    };
  }, [onFieldEvent]);

  const onFieldEventRef = useRef(onFieldEvent);
  onFieldEventRef.current = onFieldEvent;
  const committedEventCount = useCallback(() => eventsRef.current.length, []);
  const qaStartInFlightRef = useRef(false);
  const qaSnapshotRef = useRef({
    request: plan?.request ?? null,
    field: view?.field ?? null,
    error,
    choreographyReady: presentationCueReady(plan?.cueId, readyCueId),
  });
  qaSnapshotRef.current = {
    request: plan?.request ?? null,
    field: view?.field ?? null,
    error,
    choreographyReady: presentationCueReady(plan?.cueId, readyCueId),
  };

  useEffect(() => {
    if (!QA_RUNTIME_ENABLED) return;
    type QaWindow = Window & {
      __PA_QA_CHASE__?: () => Promise<QaChaseResult>;
    };
    const qaWindow = window as QaWindow;
    const publish = (result: QaChaseResult): QaChaseResult => {
      const root = playRootRef.current;
      if (root) {
        root.dataset.qaChaseStatus = result.status;
        root.dataset.qaChaseReason = result.reason;
      }
      window.dispatchEvent(
        new CustomEvent<QaChaseResult>(M1_QA_CONTRACT.resultEvent, {
          detail: result,
        }),
      );
      return result;
    };
    const start = async (): Promise<QaChaseResult> => {
      const eligibility = qaChaseEligibility({
        ...qaSnapshotRef.current,
        busy: runtimeCommitInFlightRef.current,
      });
      if (eligibility) return publish(eligibility);
      if (qaStartInFlightRef.current) {
        return publish({
          ok: false,
          status: "BUSY",
          reason: "A QA chase start is already in flight.",
        });
      }
      qaStartInFlightRef.current = true;
      const field = qaSnapshotRef.current.field!;
      const suffix = `${field.seedHex.slice(-8)}_${eventsRef.current.length}`;
      const built = qaChaseStartEvents({
        suffix,
        heatBand: field.heat.band,
      });
      // Keep one eligibility snapshot for the interrupt envelope. React
      // publishes the intermediate CONFRONTATION plan after event one; using a
      // newly rendered callback for event two would reject on that transient
      // cue even though the runtime is correctly waiting for CHASE_STARTED.
      const commitEnvelopeEvent = onFieldEventRef.current;
      try {
        for (const event of built.events) {
          if (playRootRef.current) {
            playRootRef.current.dataset.qaChaseStep =
              `COMMITTING_${event.type}`;
          }
          const committed = await commitEnvelopeEvent(event);
          if (!committed) {
            return publish({
              ok: false,
              status: "COMMIT_REJECTED",
              reason: `Runtime rejected ${event.type}.`,
              interruptId: built.interruptId,
              chaseId: built.chaseId,
            });
          }
          if (playRootRef.current) {
            playRootRef.current.dataset.qaChaseStep =
              `COMMITTED_${event.type}`;
          }
        }
        return publish({
          ok: true,
          status: "STARTED",
          reason: "QA chase started.",
          interruptId: built.interruptId,
          chaseId: built.chaseId,
        });
      } finally {
        qaStartInFlightRef.current = false;
      }
    };
    qaWindow.__PA_QA_CHASE__ = start;
    const root = playRootRef.current;
    if (root) {
      root.dataset.qaChaseHook = "READY";
      root.dataset.qaChaseStatus = "IDLE";
      root.dataset.qaChaseReason = "";
    }
    const onCommand = () => {
      void start().then((result) => {
        console.info(`[m1-qa] ${result.status}: ${result.reason}`);
      });
    };
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const editable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (
        event.code === M1_QA_CONTRACT.shortcutCode &&
        !event.repeat &&
        !editable
      ) {
        onCommand();
      }
    };
    window.addEventListener(M1_QA_CONTRACT.startEvent, onCommand);
    window.addEventListener("keydown", onKey);
    return () => {
      if (qaWindow.__PA_QA_CHASE__ === start) {
        delete qaWindow.__PA_QA_CHASE__;
      }
      window.removeEventListener(M1_QA_CONTRACT.startEvent, onCommand);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  async function dismissPrimer(id: PrimerId) {
    const onboarding = profile.onboarding;
    if (!onboarding || primersSeen.has(id)) return;
    const nextSeen = [...primersSeen, id];
    setPrimersSeen(new Set(nextSeen));
    const nextOnboarding = { ...onboarding, primersSeen: nextSeen };
    const nextProfile = { ...profile, onboarding: nextOnboarding };
    await upsertProfile(nextProfile);
    if (profile.source === "GOOGLE") {
      void saveOnboardingPreferences(profile.profileId, nextOnboarding);
    }
  }

  async function replayPrimers() {
    const onboarding = profile.onboarding;
    if (!onboarding) return;
    setPrimersSeen(new Set());
    const nextOnboarding = { ...onboarding, primersSeen: [] };
    await upsertProfile({ ...profile, onboarding: nextOnboarding });
    if (profile.source === "GOOGLE") {
      void saveOnboardingPreferences(profile.profileId, nextOnboarding);
    }
    setShowManual(false);
  }

  useEffect(() => {
    const directives = plan?.present ?? [];
    setActiveSubtitle(null);
    setActiveReadPanel(null);
    setPresentationLocationId(presentationOriginLocation);
    const hasPresentation = directives.some(
      (directive) =>
        directive.kind === "SCENE" ||
        directive.kind === "READ_PANEL" ||
        isSubtitleDirective(directive),
    );
    const cueId = plan?.cueId ?? null;
    if (
      hasPresentation &&
      cueId &&
      presentedTimelineCuesRef.current.has(cueId)
    ) {
      // Field interrupts restore the exact suspended FREE_ROAM plan. Its
      // presentation has already played; only the objective/input state should
      // resume. Replaying the old scene would relock movement and move the
      // presentation location back to the Archive.
      setSpeaking(false);
      setPresentationLocationId(null);
      return;
    }
    if (!hasPresentation) {
      setSpeaking(false);
      setPresentationLocationId(null);
      return;
    }
    setSpeaking(true);
    // Frame-driven runner over the compiled timeline. requestAnimationFrame
    // does not run while the tab is hidden, and advanceTimeline clamps each
    // frame's delta, so a main-thread stall or background gap pauses the
    // presentation instead of expiring it wholesale. With the previous
    // setTimeout chain, a stall burst completed the entire batch unseen —
    // the audited "arrival dialogue never played" defect (feel-audit-1 P0-1).
    const steps = buildTimeline(
      directives,
      presentationOriginLocation,
      profile.onboarding?.readingSpeed ?? "STANDARD",
    );
    let cursor = createTimelineCursor(steps);
    let cancelled = false;
    let raf = 0;
    let lastFrameAt = performance.now();
    let appliedStepIndex = -1;
    const applyStep = (step: TimelineStep | null) => {
      if (step === null) return;
      if (step.kind === "LOCATION") {
        setActiveSubtitle(null);
        setActiveReadPanel(null);
        setPresentationLocationId(step.locationId);
      } else if (step.kind === "SUBTITLE") {
        setActiveReadPanel(null);
        setActiveSubtitle(step.directive);
      } else if (step.kind === "READ_PANEL") {
        setActiveSubtitle(null);
        setActiveReadPanel(
          step.directive as Extract<PresentationDirective, { kind: "READ_PANEL" }>,
        );
      } else {
        setActiveSubtitle(null);
        setActiveReadPanel(null);
      }
    };
    const frame = (now: number) => {
      if (cancelled) return;
      const delta = now - lastFrameAt;
      lastFrameAt = now;
      cursor = advanceTimeline(steps, cursor, delta);
      if (cursor.done) {
        if (cueId) presentedTimelineCuesRef.current.add(cueId);
        setActiveSubtitle(null);
        setActiveReadPanel(null);
        setSpeaking(false);
        setPresentationLocationId(null);
        return;
      }
      if (cursor.stepIndex !== appliedStepIndex) {
        appliedStepIndex = cursor.stepIndex;
        applyStep(activeStep(steps, cursor));
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame((now) => {
      lastFrameAt = now;
      if (cursor.stepIndex !== appliedStepIndex) {
        appliedStepIndex = cursor.stepIndex;
        applyStep(activeStep(steps, cursor));
      }
      raf = requestAnimationFrame(frame);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      setActiveSubtitle(null);
      setActiveReadPanel(null);
      setSpeaking(false);
      setPresentationLocationId(null);
    };
  }, [
    plan?.cueId,
    plan?.present,
    presentationOriginLocation,
    profile.onboarding?.readingSpeed,
  ]);

  const dayEnd = transcript.find((d) => d.kind === "DAY_END_CARD") as (PresentationDirective & { kind: "DAY_END_CARD" }) | undefined;
  const [showLog, setShowLog] = useState(false);
  // Escape always closes the log (feel-audit-1 P0-7: the panel overlapped its
  // own toggle and there was no keyboard escape).
  useEffect(() => {
    if (!showLog) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setShowLog(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showLog]);
  // The opened read shows the authored document artwork itself (same canvas
  // as the world object); panels with no matching document keep the plain
  // parchment card.
  const readPanelArt = activeReadPanel ? documentForReadPanel(activeReadPanel.objectId) : null;
  // Synthetic field-interrupt cue ids suspend an already-ready authored plan;
  // they are not camera choreography and must never lock chase/confrontation.
  const choreographyReady =
    plan?.request.kind === "CHECKPOINT_DEBRIEF" ||
    presentationCueReady(plan?.cueId, readyCueId);
  const openResponseActive =
    view?.field.activeInterrupt?.kind === "OPEN_RESPONSE";
  // The Log is a read-only side panel: it must never gate mechanic input or
  // freeze the world (feel-audit-1 P0-7). It intentionally does NOT feed
  // interactionBusy or movementLocked.
  const interactionBusy =
    busy ||
    !choreographyReady ||
    speaking ||
    showManual ||
    showArchive ||
    openResponseActive ||
    cinematicBeat;
  // An archive-only re-present (e.g. the gold-marker redirect nudge after
  // FREE_ROAM_IDLE) shows its subtitle without locking movement: the runner
  // keeps walking while the handler talks (Interaction-Spec §1.2a). Batches
  // containing any scene, read panel, or spoken dialogue lock exactly as
  // before, and only FREE_ROAM/BREATHER requests qualify.
  const timelinePresentation = (plan?.present ?? []).filter(
    (directive) =>
      directive.kind === "SCENE" ||
      directive.kind === "READ_PANEL" ||
      isSubtitleDirective(directive),
  );
  const archiveOnlyNudge =
    timelinePresentation.length > 0 &&
    timelinePresentation.every((directive) => directive.kind === "ARCHIVE") &&
    (plan?.request.kind === "FREE_ROAM" || plan?.request.kind === "BREATHER");
  // Movement lock for the 3D player. Unlike interactionBusy it excludes the
  // brief runtime advance roundtrip (`busy`) and archive-only speech, so
  // firing the idle nudge never zeroes velocity or halts mid-stride; request
  // kind changes and choreography holds still lock movement in World3D.
  const movementLocked =
    !choreographyReady ||
    (speaking && !archiveOnlyNudge) ||
    view?.field.activeInterrupt?.kind === "CONFRONTATION" ||
    showManual ||
    showArchive ||
    openResponseActive ||
    cinematicBeat;
  const pendingPrimer = primerFor(plan?.request ?? null, primersSeen);
  const actionSurface = presentationActionSurface({
    choreographyReady,
    presentationActive: speaking,
    primerPending: Boolean(pendingPrimer),
  });
  const primer =
    actionSurface === "PRIMER" && !view?.field.activeInterrupt
      ? pendingPrimer
      : null;
  const centralControlsBlocked = actionSurface === "BLOCKED" && !error;

  // Tab toggles the Archive between its collapsed strip and the full overlay.
  // Opening it is a free pause: it commits nothing and only blocks input
  // (via interactionBusy) while open, so the world clock cannot advance.
  const archiveAvailable =
    Boolean(view) && !done && !error && !showManual && !cinematicBeat &&
    !speaking && !view?.field.activeInterrupt &&
    plan?.request.kind !== "DAY_END" &&
    plan?.request.kind !== "CHECKPOINT_DEBRIEF";
  useEffect(() => {
    if (!archiveAvailable) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      event.preventDefault();
      setShowArchive((open) => !open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [archiveAvailable]);
  useEffect(() => {
    if (!archiveAvailable) setShowArchive(false);
  }, [archiveAvailable]);

  return (
    <div
      ref={playRootRef}
      className="play play3d"
      data-game-root="play"
      data-plan-request={plan?.request.kind ?? ""}
      data-runtime-ready={String(Boolean(view && plan))}
      data-runtime-location={view?.locationId ?? ""}
      data-field-interrupt={view?.field.activeInterrupt?.kind ?? ""}
      data-active-chase-id={view?.field.activeChase?.chaseId ?? ""}
      data-profile-source={profile.source}
      data-clock-spent={view?.clock.spentUnits ?? ""}
      data-carried-object-ids={view?.field.carriedObjectIds.join(",") ?? ""}
      data-confiscated-object-ids={
        view?.field.confiscatedObjectIds.join(",") ?? ""
      }
      data-pending-reposition={
        view?.field.pendingReposition?.anchorId ?? ""
      }
      data-last-chase-outcome={
        view?.field.chaseHistory.at(-1)?.outcome ?? ""
      }
      data-chase-assist={profile.onboarding?.chaseAssist ?? "STANDARD"}
      data-input-method={
        profile.onboarding?.inputMethod ?? "KEYBOARD_MOUSE"
      }
      data-high-contrast={String(Boolean(profile.onboarding?.highContrast))}
      data-reduced-motion={String(Boolean(profile.onboarding?.reducedMotion))}
      data-speaking={speaking ? "true" : "false"}
      data-choreography-ready={choreographyReady ? "true" : "false"}
      data-active-subtitle={activeSubtitle ? "true" : "false"}
      data-active-read-panel={activeReadPanel ? "true" : "false"}
      data-primer={primer?.id ?? ""}
      data-interaction-busy={interactionBusy ? "true" : "false"}
      data-checkpoint-status={view?.checkpoint.status ?? ""}
      data-open-response-phase={
        openResponseActive ? openResponsePhase : ""
      }
      data-open-response-eligible={
        view?.openResponse.eligible
          .map((prompt) => prompt.promptId)
          .join(",") ?? ""
      }
      data-npc-followups={
        view?.openResponse.npcFollowups
          .map((node) => `${node.npcId}:${node.nodeId}`)
          .join(",") ?? ""
      }
      data-archive-connections={
        view?.openResponse.archiveConnections
          .map((card) => card.cardId)
          .join(",") ?? ""
      }
      data-source-engagement-count={
        view?.field.sourceEngagements.length ?? 0
      }
    >
      <Hud
        view={view}
        profileName={profile.displayName}
        exitDisabled={interactionBusy}
        onManual={() => setShowManual(true)}
        onExit={() => void persistAndExit()}
      />
      <div className="world-wrap">
        <World3D
          view={view}
          presentationLocationId={presentationLocationId}
          request={plan?.request ?? null}
          present={activeSubtitle ? [activeSubtitle] : []}
          busy={interactionBusy || Boolean(error)}
          movementLocked={movementLocked || Boolean(error)}
          keyboardOnly={profile.onboarding?.inputMethod === "KEYBOARD_ONLY"}
          reducedMotion={Boolean(profile.onboarding?.reducedMotion)}
          highContrast={Boolean(profile.onboarding?.highContrast)}
          chaseAssist={profile.onboarding?.chaseAssist ?? "STANDARD"}
          readPanelActive={Boolean(activeReadPanel)}
          cueId={plan?.cueId ?? null}
          choreographyReady={choreographyReady}
          choiceAnimation={choiceAnimation}
          stealthStore={stealthStore}
          restoreSpatial={restoreSpatial}
          spatialSnapshotRef={presenterSpatialRef}
          committedEventCount={committedEventCount}
          overlayActive={Boolean(primer) || centralControlsBlocked}
          onChoreographyReady={markChoreographyReady}
          onWebglStatus={setWebglAvailable}
          onEvent={onEvent}
          onFieldEvent={onFieldEvent}
        />
        <StealthHud
          store={stealthStore}
          dev={QA_RUNTIME_ENABLED}
          highContrast={Boolean(profile.onboarding?.highContrast)}
          reducedMotion={Boolean(profile.onboarding?.reducedMotion)}
        />
        <GlobalNoticeHud
          blocked={
            Boolean(activeSubtitle) ||
            speaking ||
            Boolean(
              view?.field.activeInterrupt &&
                view.field.activeInterrupt.kind !== "CHASE",
            ) ||
            (cinematicBeat && cinematicOwner !== "RELEASE_CINEMATIC")
          }
          captions={profile.onboarding?.captions !== false}
        />
        {webglAvailable && !error && (
          <HoloTasks
            view={view}
            hidden={
              Boolean(primer) ||
              done ||
              showArchive ||
              Boolean(view?.field.activeInterrupt)
            }
            onExpand={archiveAvailable ? () => setShowArchive(true) : undefined}
          />
        )}
        {holoCards.length > 0 && (
          <div className="holo-cards">
            {holoCards.map((card) => (
              <div key={card.id} className={`holo-card ${card.kind === "FLICKER" ? "flicker" : card.direction.toLowerCase()}`}>
                <div className="holo-card-head">
                  <span className="holo-card-sigil" aria-hidden="true" />
                  <strong>{card.title}</strong>
                </div>
                <span className={`holo-card-line ${card.direction.toLowerCase()}`}>{card.line}</span>
                {card.cause && <small>{card.cause}</small>}
              </div>
            ))}
          </div>
        )}
        <div className="world-cinematic-ui">
          {!error &&
            !done &&
            !cinematicBeat &&
            !interactionBusy &&
            (plan?.request.kind === "FREE_ROAM" ||
              plan?.request.kind === "BREATHER") &&
            !view?.field.activeInterrupt &&
            (view?.openResponse.eligible.length ?? 0) > 0 && (
              // Docked corner chip; rendered only while actually clickable.
              // The old in-overlay disabled state painted an empty dark bar
              // across mid-screen (feel-audit-1 P1-6 / pill artifact).
              <button
                type="button"
                className="open-response-offer"
                onClick={() =>
                  void beginOpenResponse(
                    view!.openResponse.eligible[0]!.promptId,
                  )
                }
              >
                ✎ Optional reflection available
              </button>
            )}
          <div className="subtitles" role="log" aria-live="polite" aria-relevant="additions">
            {activeSubtitle && (
              <div
                key={`${plan?.cueId}-${activeSubtitle.kind}`}
                className={`sub sub-${
                  activeSubtitle.kind === "DIALOGUE" && activeSubtitle.speaker === "ARCHIVE"
                    ? "archive"
                    : activeSubtitle.kind.toLowerCase()
                }`}
              >
                {activeSubtitle.kind === "DIALOGUE" ? (
                  <strong>
                    {activeSubtitle.speaker === "PLAYER" || activeSubtitle.speaker === "NARRATOR"
                      ? "YOU: "
                      : activeSubtitle.speaker === "ARCHIVE"
                        ? "ARCHIVE // "
                        : `${activeSubtitle.speaker}: `}
                  </strong>
                ) : activeSubtitle.kind === "ARCHIVE" ? <strong>ARCHIVE // </strong> : null}
                {"text" in activeSubtitle ? activeSubtitle.text : null}
              </div>
            )}
          </div>
          <div
            className={`world-controls-overlay request-${plan?.request.kind.toLowerCase() ?? "loading"}${centralControlsBlocked ? " is-blocked" : ""}${speaking ? " is-speaking" : ""}${primer && !view?.field.activeInterrupt ? " has-primer" : ""}${
              view?.field.activeInterrupt?.kind === "CHASE" ||
              // A reactive exchange owns the screen with its own world-anchored
              // panel: the central overlay must not paint an empty band
              // beneath it (feel-audit-1 P1-6 empty-bar artifact).
              view?.field.activeInterrupt?.kind === "REACTIVE_EXCHANGE" ||
              (!primer &&
                !error &&
                !done &&
                webglAvailable &&
                !view?.field.activeInterrupt &&
                plan?.request.kind === "FREE_ROAM" &&
                plan.request.selectedTargetId)
                ? " is-empty"
                : ""
            }`}
          >
            {error ? (
              <div className="row world-error">
                <span className="warn grow">{error}</span>
                <button className="btn-ghost" onClick={props.onExit}>Back to profiles</button>
              </div>
            ) : cinematicBeat || openResponseActive ? null : view?.field.activeInterrupt?.kind === "CONFRONTATION" ? (
              <ConfrontationPanel
                field={view.field}
                reducedMotion={Boolean(profile.onboarding?.reducedMotion)}
                onFieldEvent={onFieldEvent}
              />
            ) : primer ? (
              <PrimerCard primer={primer} onContinue={() => void dismissPrimer(primer.id)} />
            ) : done && view?.checkpoint.status === "TRANSITIONED" ? (
              <ActTransitionComplete onExit={props.onExit} />
            ) : plan?.request.kind === "CHECKPOINT_DEBRIEF" ? (
              <CheckpointDebrief
                request={plan.request}
                dayRecord={dayEnd?.card}
                busy={interactionBusy}
                highContrast={Boolean(profile.onboarding?.highContrast)}
                reducedMotion={Boolean(profile.onboarding?.reducedMotion)}
                onEvent={onEvent}
              />
            ) : dayEnd && plan?.request.kind === "DAY_END" ? (
              <DayEnd
                card={dayEnd.card}
                doneLabel="Begin CP1 debrief"
                onDone={() => void onEvent({ type: "CONTINUE" })}
              />
            ) : plan ? (
              <Controls
                request={plan.request}
                onEvent={onEvent}
                busy={interactionBusy}
                spatialNavigation={webglAvailable}
                accessibleMechanics={
                  Boolean(profile.onboarding?.reducedMotion) ||
                  profile.onboarding?.inputMethod === "KEYBOARD_ONLY"
                }
              />
            ) : (
              <span className="muted">Synchronizing…</span>
            )}
          </div>
        </div>
        {activeReadPanel && (
          <div className="read-overlay">
            <figure
              className={`holo-doc${readPanelArt ? (readPanelArt.kind === "PAIR" ? " holo-doc-pair" : " holo-doc-artifact") : ""}`}
              key={activeReadPanel.objectId}
            >
              <i className="holo-beam" aria-hidden="true" />
              {readPanelArt ? (
                // The projected artifact IS the document (title and text are
                // part of the artwork), so no duplicate heading is rendered.
                <div
                  className="read-artifact"
                  role="img"
                  aria-label={`${activeReadPanel.title}. ${activeReadPanel.body}`}
                >
                  {readPanelArt.kind === "PAIR" ? (
                    <>
                      <img className="read-art" src={getDocumentImageUrl(readPanelArt.left)} alt="" />
                      <img className="read-art" src={getDocumentImageUrl(readPanelArt.right)} alt="" />
                    </>
                  ) : (
                    <img className="read-art" src={getDocumentImageUrl(readPanelArt.documentId)} alt="" />
                  )}
                </div>
              ) : (
                <div className="read-card">
                  <div className="read-title">{activeReadPanel.title}</div>
                  <div className="read-rule" aria-hidden="true" />
                  <div className="read-body">{activeReadPanel.body}</div>
                  <div className="read-ornament" aria-hidden="true">❦</div>
                </div>
              )}
              <i className="holo-scan" aria-hidden="true" />
              <i className="holo-corner tl" aria-hidden="true" />
              <i className="holo-corner tr" aria-hidden="true" />
              <i className="holo-corner bl" aria-hidden="true" />
              <i className="holo-corner br" aria-hidden="true" />
            </figure>
          </div>
        )}
        <button className="btn-ghost log-toggle" onClick={() => setShowLog((s) => !s)}>
          {showLog ? "Hide log" : "Log"}
        </button>
        {showLog && (
          <div className="log-panel">
            <Feed directives={transcript} />
          </div>
        )}
      </div>
      <Side view={view} />
      {showArchive && view && (
        <ArchiveOverlay
          view={view}
          onClose={() => setShowArchive(false)}
          onStartReflection={(promptId) => {
            setShowArchive(false);
            window.setTimeout(
              () => void beginOpenResponse(promptId),
              0,
            );
          }}
        />
      )}
      {showManual && (
        <ArchiveManual
          profile={profile}
          request={plan?.request ?? null}
          busy={interactionBusy}
          onEditPreferences={() => props.onEditPreferences({
            ...profile,
            onboarding: profile.onboarding ? { ...profile.onboarding, primersSeen: [...primersSeen] } : undefined,
          })}
          onReplayPrimers={() => void replayPrimers()}
          onClose={() => setShowManual(false)}
        />
      )}
      {openResponseActive && view?.openResponse.activePrompt && (
        <OpenResponsePanel
          prompt={view.openResponse.activePrompt}
          authenticated={profile.source === "GOOGLE" && props.apiUp}
          phase={openResponsePhase}
          feedback={openResponseFeedback}
          fallback={openResponseFallback}
          retained={openResponseRetained}
          closeEnabled={openResponseCloseEnabled}
          onSubmit={(responseText, consent) =>
            void submitActiveOpenResponse(responseText, consent)
          }
          onClose={() => void closeActiveOpenResponse()}
        />
      )}
    </div>
  );
}

type SubtitleDirective = Extract<
  PresentationDirective,
  { kind: "SCENE" | "DIALOGUE" | "NARRATION" | "ARCHIVE" | "AMBIENT_CHATTER" }
>;

function isSubtitleDirective(directive: PresentationDirective): directive is SubtitleDirective {
  return (
    directive.kind === "DIALOGUE" ||
    directive.kind === "SCENE" ||
    directive.kind === "NARRATION" ||
    directive.kind === "ARCHIVE" ||
    directive.kind === "AMBIENT_CHATTER"
  );
}

type PrimerId = "ARCHIVE" | "MOVEMENT" | "READ" | "WORK" | "CHOICE";
interface Primer {
  id: PrimerId;
  title: string;
  body: string;
  control: string;
}

function primerFor(request: InputRequest | null, seen: ReadonlySet<PrimerId>): Primer | null {
  if (!request) return null;
  let primer: Primer | null = null;
  switch (request.kind) {
    case "CONTINUE":
    case "ACK":
      primer = {
        id: "ARCHIVE",
        title: "Archive channel ready",
        body: "Archive records provide context and objectives. They never make a choice for you.",
        control: "Confirm once to continue.",
      };
      break;
    case "FREE_ROAM":
      primer = {
        id: "MOVEMENT",
        title: "Move through the field",
        body: "Follow the gold objective marker. Exploration costs no time until you commit to an activity.",
        control: "WASD/arrows walk; Shift sprints; Space jumps; Shift+Space running-jumps; C crouches; F uses marked objects.",
      };
      break;
    case "FOCUS_READ":
      primer = {
        id: "READ",
        title: "Examine field evidence",
        body: "Important documents can be opened and read in place. Skippable records never hide required history.",
        control: "Open the highlighted record, or choose Skip.",
      };
      break;
    case "MECHANIC":
      primer = {
        id: "WORK",
        title: "Complete the work",
        body: "Job actions use a focused control. The result changes local details, not fixed historical events.",
        control: "Follow the prompt, then commit the action once.",
      };
      break;
    case "CHOICE":
      primer = {
        id: "CHOICE",
        title: "Choose your approach",
        body: "Choices can change routes, time, and relationships. Short tags preview those immediate stakes.",
        control: "Select one response to commit it.",
      };
      break;
    case "BREATHER":
    case "DAY_END":
    case "CHECKPOINT_DEBRIEF":
      break;
  }
  return primer && !seen.has(primer.id) ? primer : null;
}

function PrimerCard(props: { primer: Primer; onContinue: () => void }) {
  return (
    <SystemWindow heading="FIELD PRIMER // FIRST USE">
      <h3 className="system-title" id={`primer-${props.primer.id}`}>{props.primer.title}</h3>
      <p className="system-text">{props.primer.body}</p>
      <small className="system-note">{props.primer.control}</small>
      <button className="system-confirm" onClick={props.onContinue}>ACKNOWLEDGE</button>
    </SystemWindow>
  );
}

function ArchiveManual(props: {
  profile: LocalProfile;
  request: InputRequest | null;
  busy: boolean;
  onEditPreferences: () => void;
  onReplayPrimers: () => void;
  onClose: () => void;
}) {
  const settings = props.profile.onboarding;
  return (
    <div className="overlay manual-overlay" onClick={props.onClose}>
      <div className="overlay-body archive-manual" onClick={(event) => event.stopPropagation()}>
        <div className="mastery-head">
          <div>
            <div className="archive-kicker">ARCHIVE // FIELD MANUAL</div>
            <h2>Insertion controls</h2>
          </div>
          <button className="btn-ghost" onClick={props.onClose}>Close</button>
        </div>
        <section className="manual-objective">
          <span>ACTIVE OBJECTIVE</span>
          <strong>{objectiveLabel(props.request)}</strong>
        </section>
        <div className="manual-grid">
          <section>
            <h3>Move and observe</h3>
            <dl>
              <div><dt>Walk</dt><dd>WASD or arrow keys</dd></div>
              <div><dt>Run</dt><dd>Hold Shift while moving</dd></div>
              <div><dt>Look</dt><dd>{settings?.inputMethod === "KEYBOARD_ONLY" ? "Fixed follow camera" : "Drag on the world"}</dd></div>
              <div><dt>Interact</dt><dd>F uses the nearest contextual object; enter quest markers to arrive</dd></div>
              <div><dt>Inspect</dt><dd>F opens optional teal Archive context when no traversal action has priority</dd></div>
            </dl>
          </section>
          <section>
            <h3>Archive interface</h3>
            <dl>
              <div><dt>Choose</dt><dd>Click, or Tab then Enter</dd></div>
              <div><dt>Read</dt><dd>Open highlighted records when prompted</dd></div>
              <div><dt>Log</dt><dd>Review recent dialogue from the world panel</dd></div>
              <div><dt>Assist</dt><dd>{settings?.archiveAssistAutoOffer ? "May offer help after a pause" : "Manual request only"}</dd></div>
            </dl>
          </section>
        </div>
        <section className="manual-settings">
          <h3>Accessibility profile</h3>
          <div className="manual-tags">
            <span>{settings?.readingSpeed.toLowerCase() ?? "standard"} reading</span>
            <span>{settings?.captions ? "captions on" : "captions off"}</span>
            <span>{settings?.audioDescription ? "audio description on" : "audio description off"}</span>
            {settings?.highContrast && <span>high contrast</span>}
            {settings?.reducedMotion && <span>reduced motion</span>}
            <span>
              chase assist: {(settings?.chaseAssist ?? "STANDARD")
                .toLowerCase()
                .replaceAll("_", " ")}
            </span>
          </div>
          <button className="btn-ghost" disabled={props.busy} onClick={props.onEditPreferences}>
            Adjust interface profile
          </button>
          <button className="btn-ghost" disabled={props.busy} onClick={props.onReplayPrimers}>
            Replay first-use primers
          </button>
        </section>
        <p className="manual-footnote">Opening the Manual never changes progress, evidence, or assessment.</p>
      </div>
    </div>
  );
}

function objectiveLabel(request: InputRequest | null): string {
  if (!request) return "Synchronizing field record…";
  switch (request.kind) {
    case "FREE_ROAM": return "Reach a marked destination";
    case "CHOICE": return request.frame;
    case "MECHANIC": return request.params.prompt;
    case "FOCUS_READ": return `Examine ${request.title}`;
    case "ACK": return request.text;
    case "BREATHER": return "Move through the world";
    case "DAY_END": return "Complete the day";
    case "CHECKPOINT_DEBRIEF": return "Complete Checkpoint One";
    case "CONTINUE": return request.label ?? "Continue the current scene";
  }
}

// The end-of-day record is the one moment the System window goes big: a
// full celebratory readout of the day, filed as an Archive record (Day-1 B13).
function DayEnd(props: {
  card: DayEndCard;
  doneLabel?: string;
  onDone: () => void;
}) {
  const c = props.card;
  return (
    <div className="system-dayend">
      <SystemWindow heading="ARCHIVE // DAY ONE FILED">
        <p className="system-text">{c.headerLine}</p>
        <figure className="dayend-artifact">
          <figcaption className="dayend-artifact-kicker">ARTIFACT OF RECORD</figcaption>
          <div className="dayend-artifact-headline">{c.selectedHeadline}</div>
        </figure>
        <section className="dayend-records" aria-label="Records added to Notes">
          <h3 className="dayend-section-title">RECORDS ADDED TO NOTES</h3>
          {c.notes.map((n) => (
            <div className="dayend-entry" key={n.concept}>
              <span className="dayend-entry-sigil" aria-hidden="true" />
              <span className="dayend-entry-copy">
                <strong>{n.concept}</strong>
                <small>{n.body}</small>
              </span>
            </div>
          ))}
        </section>
        <section className="dayend-ledger" aria-label="Field connections">
          <div className="dayend-holo-row">
            <span className="dayend-glyph" aria-hidden="true" />
            <span className="dayend-holo-label">PEOPLE MET</span>
            <span className="dayend-holo-value">{c.peopleMet.join(", ") || "No one new today"}</span>
          </div>
          <div className="dayend-holo-row gold">
            <span className="dayend-glyph" aria-hidden="true" />
            <span className="dayend-holo-label">ROUTES UNLOCKED</span>
            <span className="dayend-holo-value">{c.routesUnlocked.join(", ") || "None today"}</span>
          </div>
        </section>
        <button className="system-confirm" onClick={props.onDone}>{props.doneLabel ?? "Back to profiles"}</button>
      </SystemWindow>
    </div>
  );
}

// All non-timeline notices share one typed arbiter and one caption surface.
// Blocking dialogue owns the surface; lower-priority ambient notices are
// dropped rather than surfacing over an interaction.
function GlobalNoticeHud(props: { blocked: boolean; captions: boolean }) {
  const arbiter = useMemo(() => new PresentationNoticeArbiter(), []);
  const [notice, setNotice] = useState<PresentationNotice | null>(null);
  const blockedRef = useRef(props.blocked);
  blockedRef.current = props.blocked;
  const timer = useRef(0);
  useEffect(() => {
    const onNotice = (raw: Event) => {
      if (blockedRef.current || !props.captions) return;
      const detail = (raw as CustomEvent<PresentationNotice>).detail;
      const selected = arbiter.offer(detail);
      setNotice(selected);
      window.clearTimeout(timer.current);
      if (selected) {
        timer.current = window.setTimeout(() => {
          arbiter.clear(selected.id);
          setNotice(null);
        }, selected.expiresAt - performance.now());
      }
    };
    window.addEventListener(PRESENTATION_NOTICE_EVENT, onNotice);
    return () => {
      window.removeEventListener(PRESENTATION_NOTICE_EVENT, onNotice);
      window.clearTimeout(timer.current);
    };
  }, [arbiter, props.captions]);
  useEffect(() => {
    if (!props.blocked) return;
    arbiter.clear();
    setNotice(null);
    window.clearTimeout(timer.current);
  }, [arbiter, props.blocked]);
  if (!notice) return null;
  return (
    <div className="ambient-subtitle route-reminder">
      {notice.speaker && <strong>{notice.speaker} // </strong>}
      {notice.text}
    </div>
  );
}

function qaCheckpointTargetReached(
  request: Extract<InputRequest, { kind: "CHECKPOINT_DEBRIEF" }>,
  target: string,
): boolean {
  if (target === "question") return request.phase === "QUESTION";
  if (target === "review") {
    return request.phase === "REVIEW" && !request.readyToCommit;
  }
  if (target === "commit") {
    return request.phase === "REVIEW" && Boolean(request.readyToCommit);
  }
  if (target === "transition") return request.phase === "TRANSITION";
  return request.phase === "FORM_SELECTION";
}

function qaCheckpointBootstrapEvent(request: InputRequest): PresenterEvent {
  switch (request.kind) {
    case "CONTINUE":
    case "DAY_END":
      return { type: "CONTINUE" };
    case "ACK":
      return { type: "ACK" };
    case "BREATHER":
      return { type: "BREATHER_COMPLETE" };
    case "FOCUS_READ":
      return { type: "FOCUS_READ_OPENED", objectId: request.objectId };
    case "FREE_ROAM":
      return {
        type: "FREE_ROAM_GOTO",
        targetId: request.selectedTargetId ?? request.targets[0]!.targetId,
      };
    case "CHOICE": {
      const correctIds = new Set([
        "WALK_IN",
        "HELP",
        "MAIN_FAST",
        "CALM_CONCEAL",
        "QUICK",
        "CLIMB",
        "REVENUE",
        "TAXED_NO_VOICE",
        "CAUSE_PARLIAMENT",
        "EV_DEED",
        "STAMP_SYNC.CROWN_TAX",
        "REP_SYNC.NO_ELECTED_VOICE",
        "POLICY_SYNC.WAR_DEBT",
      ]);
      const option =
        request.options.find(
          (candidate) =>
            correctIds.has(candidate.choiceId) && !candidate.disabled,
        ) ?? request.options.find((candidate) => !candidate.disabled)!;
      return {
        type: "CHOICE_SELECTED",
        promptId: request.promptId,
        choiceId: option.choiceId,
      };
    }
    case "MECHANIC":
      return {
        type: "MECHANIC_RESULT",
        promptId: request.promptId,
        result: qaMechanicResult(request),
      };
    case "CHECKPOINT_DEBRIEF": {
      const formId =
        request.state.selection?.formId ??
        request.proposedSelection?.formId ??
        "";
      if (request.phase === "FORM_SELECTION" && request.proposedSelection) {
        return {
          type: "DEBRIEF_FORM_SELECTED",
          checkpointId: request.checkpointId,
          selection: request.proposedSelection,
        };
      }
      if (request.phase === "QUESTION" && request.item) {
        return {
          type: "DEBRIEF_ANSWERED",
          checkpointId: request.checkpointId,
          formId,
          itemId: request.item.itemId,
          optionId: request.item.correctOptionId,
        };
      }
      if (request.phase === "REVIEW" && !request.readyToCommit) {
        return {
          type: "DEBRIEF_CONTINUED",
          checkpointId: request.checkpointId,
          formId,
        };
      }
      if (request.phase === "REVIEW") {
        return {
          type: "DEBRIEF_COMMITTED",
          eventId: `${formId}.COMMIT.QA`,
          checkpointId: request.checkpointId,
          formId,
          bankVersion: request.state.bankVersion ?? "",
        };
      }
      if (request.phase === "TRANSITION") {
        return {
          type: "ACT_TRANSITIONED",
          eventId: `${formId}.TRANSITION.QA`,
          checkpointId: request.checkpointId,
          formId,
          targetChapterId: request.state.nextInsertion!.chapterId,
        };
      }
      throw new Error("QA CP1 bootstrap reached the production content gate");
    }
  }
}

function qaMechanicResult(
  request: Extract<InputRequest, { kind: "MECHANIC" }>,
): MechanicRawResult {
  const { kind } = request.params;
  if (kind === "PRESS") return { kind, stopOffset: 0.5 };
  if (kind === "EFFORT") return { kind, holdMs: 1500 };
  if (kind === "PLACE") return { kind, alignment: 0.5 };
  if (kind === "PRINT_JOB") {
    return {
      kind,
      phases: {
        catch: 0.95,
        ink: 0.95,
        register: 0.95,
        pull: 0.95,
        peel: 0.95,
      },
      quality: "CRISP",
      accessible: true,
    };
  }
  if (kind === "HAUL_JOB") {
    return {
      kind,
      phases: { load: 0.9, balance: 0.9, thread: 0.9 },
      accessible: true,
    };
  }
  if (kind === "POST_JOB") {
    return {
      kind,
      phases: { lineUp: 0.9, tackLeft: 0.9, tackRight: 0.9 },
      accessible: true,
    };
  }
  return {
    kind,
    assignments: (request.params.sortItems ?? []).map((item) => ({
      itemId: item.itemId,
      bucketId: ["deed", "writ", "newspaper"].includes(item.itemId)
        ? "NEEDS_STAMP"
        : "DOES_NOT",
    })),
  };
}
