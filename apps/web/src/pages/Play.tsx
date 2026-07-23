import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DayEndCard,
  InputRequest,
  PresentationDirective,
} from "@pa/contracts";
import { upsertProfile, type LocalProfile } from "../db.js";
import { saveOnboardingPreferences } from "../api.js";
import { Feed } from "../presenter/Feed.js";
import { Hud } from "../presenter/Hud.js";
import { Side, HoloTasks } from "../presenter/Side.js";
import { ArchiveOverlay } from "../presenter/ArchiveOverlay.js";
import { Controls, SystemWindow } from "../presenter/Controls.js";
import { World3D } from "../world/World3D.js";
import { documentForReadPanel, getDocumentImageUrl } from "../world/documentTextures.js";
import type { ChoiceAnimation } from "../world/choiceAnimations.js";
import { StealthHud } from "../presenter/StealthHud.js";
import { ConfrontationPanel } from "../presenter/ConfrontationPanel.js";
import {
  ActTransitionComplete,
  CheckpointDebrief,
} from "../presenter/CheckpointDebrief.js";
import { OpenResponsePanel } from "../presenter/OpenResponsePanel.js";
import {
  PRESENTATION_NOTICE_EVENT,
  PresentationNoticeArbiter,
  type PresentationNotice,
} from "../presenter/noticeArbiter.js";
import {
  createStealthStore,
  stealthPatchFromRuntimeField,
} from "../world/stealthStore.js";
import { ambientAudio } from "../world/ambientAudio.js";
import {
  presentationActionSurface,
  presentationCueReady,
} from "../presenter/presentationHandoff.js";
import { QA_RUNTIME_ENABLED } from "../world/qaEnvironment.js";
import {
  activeStep,
  advanceTimeline,
  buildTimeline,
  createTimelineCursor,
  isSubtitleDirective,
  type TimelineStep,
} from "../presenter/presentationTimeline.js";
import { useRuntimeSession } from "./play/useRuntimeSession.js";
import { useCommitPipeline } from "./play/useCommitPipeline.js";
import { useOpenResponseFlow } from "../presenter/openResponse/useOpenResponseFlow.js";
import {
  useFieldEventQaHook,
  useQaChaseHook,
} from "../world/qa/PlayQaHooks.js";
import {
  DAY_END_COPY,
  MANUAL_COPY,
  manualArchiveRows,
  manualMoveRows,
  objectiveLabel,
  primerFor,
  type Primer,
  type PrimerId,
} from "./play/playCopy.js";

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
  // Boot/init session: runtime worker client, committed event log, revisions,
  // presenter spatial snapshot pair, and all runtime-derived presenter state.
  const session = useRuntimeSession({ profile, chapterId, apiUp: props.apiUp });
  const {
    eventsRef,
    runtimeCommitInFlightRef,
    presenterSpatialRef,
    transcript,
    plan,
    view,
    busy,
    done,
    error,
    restoreSpatial,
    presentationLocationId,
    setPresentationLocationId,
    presentationOriginLocation,
  } = session;
  const [showManual, setShowManual] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [webglAvailable, setWebglAvailable] = useState(true);
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
  const playRootRef = useRef<HTMLDivElement | null>(null);
  const stealthStore = useMemo(
    () => createStealthStore(),
    [profile.profileId],
  );
  const [primersSeen, setPrimersSeen] = useState(() => new Set(profile.onboarding?.primersSeen ?? []));
  const [readyCueId, setReadyCueId] = useState<string | null>(null);
  const [choiceAnimation, setChoiceAnimation] = useState<ChoiceAnimation | null>(null);
  const [activeSubtitle, setActiveSubtitle] = useState<PresentationDirective | null>(null);
  const [activeReadPanel, setActiveReadPanel] = useState<
    Extract<PresentationDirective, { kind: "READ_PANEL" }> | null
  >(null);
  const [speaking, setSpeaking] = useState(false);
  const presentedTimelineCuesRef = useRef(new Set<string>());
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
  }, []);
  useEffect(() => {
    if (!view?.field) return;
    stealthStore.patch(stealthPatchFromRuntimeField(view.field));
  }, [stealthStore, view?.field]);

  // Commit pipeline: persist/onEvent/onFieldEvent with single-flight,
  // rollback, and acceptance propagation (pure core in play/commitPipeline.ts).
  const { onEvent, onFieldEvent, persistAndExit, committedEventCount } =
    useCommitPipeline({
      session,
      profile,
      chapterId,
      apiUp: props.apiUp,
      readyCueId,
      setChoiceAnimation,
      onExit: props.onExit,
    });

  // Optional open-response reflection flow (three-phase state machine).
  const openResponse = useOpenResponseFlow({
    view,
    plan,
    busy,
    profile,
    apiUp: props.apiUp,
    onFieldEvent,
  });

  // QA-only window hooks (no-ops in production builds).
  useFieldEventQaHook(onFieldEvent);
  useQaChaseHook({
    playRootRef,
    commitInFlightRef: runtimeCommitInFlightRef,
    eventsRef,
    onFieldEvent,
    plan,
    view,
    error,
    readyCueId,
  });

  // Post-commit micro-feedback: relationship cards and unlock flickers slide
  // in at the screen edge, non-blocking, and auto-dismiss. They never pause
  // the dialogue timeline (Day-1 §5 / Interaction-Spec §9).
  const quillAlternate = useRef(false);
  useEffect(() => {
    const feedback = (plan?.present ?? []).filter(
      (directive) => directive.kind === "RELATIONSHIP_CARD" || directive.kind === "FLICKER",
    );
    if (feedback.length === 0) return;
    feedback.forEach((directive, slot) => {
      const showTimer = window.setTimeout(() => {
        // Identity audio (design1 #5): quill scratch as a note files into the
        // Archive; a small coin clink under relationship/standing receipts.
        if (directive.kind === "FLICKER" && directive.flicker === "NOTES_ADDED") {
          quillAlternate.current = !quillAlternate.current;
          ambientAudio.playIdentity(
            quillAlternate.current ? "quill-scratch-1" : "quill-scratch-2",
          );
        } else if (directive.kind === "RELATIONSHIP_CARD") {
          ambientAudio.playIdentity("coin-clink", 0.28);
        }
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
  const beginOpenResponse = openResponse.begin;
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
  // First-use hints are contextual and NON-BLOCKING (design1 kill list): the
  // action surface never waits on them, so primerPending is always false.
  const actionSurface = presentationActionSurface({
    choreographyReady,
    presentationActive: speaking,
    primerPending: false,
  });
  const hint =
    actionSurface === "REQUEST" && !view?.field.activeInterrupt && !done
      ? primerFor(plan?.request ?? null, primersSeen)
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
      data-primer={hint?.id ?? ""}
      data-interaction-busy={interactionBusy ? "true" : "false"}
      data-checkpoint-status={view?.checkpoint.status ?? ""}
      data-open-response-phase={
        openResponseActive ? openResponse.phase : ""
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
          overlayActive={centralControlsBlocked}
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
          {hint && !cinematicBeat && !error && (
            <FirstUseHint
              key={hint.id}
              hint={hint}
              onSeen={(id) => void dismissPrimer(id)}
            />
          )}
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
            className={`world-controls-overlay request-${plan?.request.kind.toLowerCase() ?? "loading"}${centralControlsBlocked ? " is-blocked" : ""}${speaking ? " is-speaking" : ""}${
              view?.field.activeInterrupt?.kind === "CHASE" ||
              // A reactive exchange owns the screen with its own world-anchored
              // panel: the central overlay must not paint an empty band
              // beneath it (feel-audit-1 P1-6 empty-bar artifact).
              view?.field.activeInterrupt?.kind === "REACTIVE_EXCHANGE" ||
              (!error &&
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
            ) : done && view?.checkpoint.status === "TRANSITIONED" ? (
              <ActTransitionComplete onExit={props.onExit} />
            ) : plan?.request.kind === "CHECKPOINT_DEBRIEF" ? (
              <CheckpointDebrief
                request={plan.request}
                busy={interactionBusy}
                highContrast={Boolean(profile.onboarding?.highContrast)}
                reducedMotion={Boolean(profile.onboarding?.reducedMotion)}
                onEvent={onEvent}
              />
            ) : dayEnd && plan?.request.kind === "DAY_END" ? (
              <DayEnd
                card={dayEnd.card}
                doneLabel="Close the day"
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
          // Only a live runtime commit blocks the pause actions — the pause
          // overlay itself sets interactionBusy, which used to disable its
          // own preference/replay buttons.
          busy={busy}
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
          phase={openResponse.phase}
          feedback={openResponse.feedback}
          fallback={openResponse.fallback}
          retained={openResponse.retained}
          closeEnabled={openResponse.closeEnabled}
          onSubmit={(responseText, consent) =>
            void openResponse.submit(responseText, consent)
          }
          onClose={() => void openResponse.close()}
        />
      )}
    </div>
  );
}

// First-use hint (design1 kill list): one quiet line, docked out of the way,
// never modal, never stacking, no "!" iconography. It marks itself seen after
// one readable display (or on dismiss), preserving the primersSeen contract.
function FirstUseHint(props: {
  hint: Primer;
  onSeen: (id: PrimerId) => void;
}) {
  const [visible, setVisible] = useState(true);
  const seenRef = useRef(false);
  const markSeen = () => {
    if (seenRef.current) return;
    seenRef.current = true;
    props.onSeen(props.hint.id);
  };
  useEffect(() => {
    const seenTimer = window.setTimeout(markSeen, 6_000);
    const hideTimer = window.setTimeout(() => setVisible(false), 8_000);
    return () => {
      window.clearTimeout(seenTimer);
      window.clearTimeout(hideTimer);
    };
    // One display per hint id (keyed remount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.hint.id]);
  if (!visible) return null;
  return (
    <div className="first-use-hint" role="status" data-hint-id={props.hint.id}>
      <span className="first-use-hint-sigil" aria-hidden="true" />
      <span>{props.hint.hint}</span>
      <button
        type="button"
        aria-label="Dismiss hint"
        onClick={() => {
          markSeen();
          setVisible(false);
        }}
      >
        ×
      </button>
    </div>
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
            <div className="archive-kicker">{MANUAL_COPY.kicker}</div>
            <h2>{MANUAL_COPY.heading}</h2>
          </div>
          <button className="btn-ghost" onClick={props.onClose}>{MANUAL_COPY.close}</button>
        </div>
        <section className="manual-objective">
          <span>{MANUAL_COPY.objectiveKicker}</span>
          <strong>{objectiveLabel(props.request)}</strong>
        </section>
        <div className="manual-grid">
          <section>
            <h3>{MANUAL_COPY.moveSection}</h3>
            <dl>
              {manualMoveRows(settings).map((row) => (
                <div key={row.term}><dt>{row.term}</dt><dd>{row.description}</dd></div>
              ))}
            </dl>
          </section>
          <section>
            <h3>{MANUAL_COPY.archiveSection}</h3>
            <dl>
              {manualArchiveRows(settings).map((row) => (
                <div key={row.term}><dt>{row.term}</dt><dd>{row.description}</dd></div>
              ))}
            </dl>
          </section>
        </div>
        <section className="manual-settings">
          <h3>{MANUAL_COPY.settingsSection}</h3>
          <p className="manual-footnote">{MANUAL_COPY.settingsNote}</p>
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
            {MANUAL_COPY.adjustButton}
          </button>
          <button className="btn-ghost" disabled={props.busy} onClick={props.onReplayPrimers}>
            {MANUAL_COPY.replayButton}
          </button>
        </section>
        <p className="manual-footnote">{MANUAL_COPY.footnote}</p>
      </div>
    </div>
  );
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
      <SystemWindow heading={DAY_END_COPY.heading}>
        <p className="system-text">{c.headerLine}</p>
        <figure className="dayend-artifact">
          <figcaption className="dayend-artifact-kicker">{DAY_END_COPY.artifactKicker}</figcaption>
          <div className="dayend-artifact-headline">{c.selectedHeadline}</div>
        </figure>
        <section className="dayend-records" aria-label="Records added to Notes">
          <h3 className="dayend-section-title">{DAY_END_COPY.notesTitle}</h3>
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
            <span className="dayend-holo-label">{DAY_END_COPY.peopleLabel}</span>
            <span className="dayend-holo-value">{c.peopleMet.join(", ") || DAY_END_COPY.peopleEmpty}</span>
          </div>
          <div className="dayend-holo-row gold">
            <span className="dayend-glyph" aria-hidden="true" />
            <span className="dayend-holo-label">{DAY_END_COPY.routesLabel}</span>
            <span className="dayend-holo-value">{c.routesUnlocked.join(", ") || DAY_END_COPY.routesEmpty}</span>
          </div>
        </section>
        <button className="system-confirm" onClick={props.onDone}>{props.doneLabel ?? DAY_END_COPY.defaultDone}</button>
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

