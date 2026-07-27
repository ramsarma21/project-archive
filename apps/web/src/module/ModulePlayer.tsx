import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAX_MISSION_ATTEMPTS } from "@pa/contracts";
import {
  formatModuleClock,
  type LearningModuleDefinition,
  type ModuleVisual,
} from "./moduleFormat.js";
import {
  advanceModuleTimeline,
  createModuleCursor,
  type ModuleTimelineCursor,
} from "./moduleTimeline.js";
import {
  directorOnCheckMastered,
  directorOnSceneEnd,
  moduleProgressFraction,
  planCardShots,
  segmentDurations,
  type ModuleSegment,
  type ModuleShotKind,
  type ModuleVisualMotion,
} from "./moduleShots.js";
import {
  defaultModuleVoiceoverProvider,
  type ModuleVoiceoverController,
  type ModuleVoiceoverProvider,
} from "./moduleVoiceover.js";
import { completeModuleRun, type ModuleRunCompletion } from "./moduleGate.js";
import { ModuleCheckPanel } from "./ModuleCheckPanel.js";
import { SystemPresenter } from "./SystemPresenter.js";
import "./module.css";

const SUBTITLE_ID = "mod-cine-subtitle";
/** How long the transport lingers after the last input before auto-dimming. */
const CONTROLS_IDLE_MS = 3200;

type ModulePhase = "PLAYING" | "CHECK" | "COMPLETE";

/**
 * The module player: a cinematic cutscene, not a reading UI.
 *
 * The whole lesson plays itself. A deterministic beat cursor walks the current
 * card's shots; when a scene ends the director rolls the next card, or — on a
 * card that carries one — interrupts with a mastery check that pauses the
 * timeline until it is answered correctly. There is no "advance every card
 * yourself": the learner's controls are the cinematic ones (pause, subtitles,
 * mute, replay, skip), and the only thing that ever gates progress is a required
 * check, exactly as before.
 *
 * What is unchanged and load-bearing: the module pays no XP, its three minutes
 * are a presentation target rather than a cutoff, a card's cue is a high-water
 * acknowledgement, and completion requires every cue AND every required check.
 * The cutscene is how the content is presented; the gate underneath it is the
 * same one moduleGate enforces and the server re-derives.
 */
export function ModulePlayer(props: {
  definition: LearningModuleDefinition;
  /** Which attempt this run opens. Above 1 the module is a retry gate. */
  attemptOrdinal: number;
  reducedMotion: boolean;
  onComplete: (completion: ModuleRunCompletion) => void;
  /** Leaving without finishing. The gate stays shut; nothing is recorded. */
  onExit: () => void;
  /** Injected for tests; defaults to browser speech synthesis. */
  voiceoverProvider?: ModuleVoiceoverProvider;
}) {
  const { definition } = props;
  const { cards } = definition;

  const [cardIndex, setCardIndex] = useState(0);
  const [segIndex, setSegIndex] = useState(0);
  const [phase, setPhase] = useState<ModulePhase>("PLAYING");
  const [masteredChecks, setMasteredChecks] = useState<readonly string[]>([]);
  const [elapsed, setElapsed] = useState(0);

  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [subtitlesOn, setSubtitlesOn] = useState(true);
  const [controlsAwake, setControlsAwake] = useState(true);

  const card = cards[cardIndex]!;
  const segments = useMemo(() => planCardShots(card, cardIndex), [card, cardIndex]);
  const durations = useMemo(() => segmentDurations(segments), [segments]);
  const segment: ModuleSegment | undefined = segments[Math.min(segIndex, segments.length - 1)];

  // The check is "active" once its card's scene has played out and the run has
  // not mastered it. The mastered set is mirrored to a ref so the rAF-driven
  // scene-end handler reads the current value without re-subscribing.
  const check = card.check;
  const checkMastered = check ? masteredChecks.includes(check.id) : true;
  const masteredRef = useRef<readonly string[]>(masteredChecks);
  useEffect(() => {
    masteredRef.current = masteredChecks;
  }, [masteredChecks]);

  const cursorRef = useRef<ModuleTimelineCursor>(createModuleCursor(durations.length));
  const sceneEndedRef = useRef(false);
  const completedRef = useRef(false);
  const startedAtRef = useRef(Date.now());

  // The voiceover controller lives for the whole mounted run and is stopped on
  // unmount, so no utterance can outlive the player.
  const provider = props.voiceoverProvider ?? useMemo(defaultModuleVoiceoverProvider, []);
  const controllerRef = useRef<ModuleVoiceoverController | null>(null);
  if (controllerRef.current === null) controllerRef.current = provider.create();

  // ---- Wall clock: reported, never a gate. --------------------------------
  useEffect(() => {
    startedAtRef.current = Date.now();
    setElapsed(0);
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [definition.moduleId]);

  // ---- Completion. Every cue has been presented by the time we reach here. --
  const finishModule = useCallback(() => {
    if (completedRef.current) return;
    const completion = completeModuleRun({
      definition,
      attemptOrdinal: props.attemptOrdinal,
      acknowledgedCueIds: definition.cards.map((entry) => entry.cueId),
      acknowledgedCheckIds: masteredRef.current,
      observedSeconds: (Date.now() - startedAtRef.current) / 1000,
      at: new Date().toISOString(),
    });
    if (!completion) {
      console.warn(
        `[module] ${definition.moduleId} reached its final scene with cues or ` +
          "checks still outstanding. Nothing was completed.",
      );
      return;
    }
    completedRef.current = true;
    setPhase("COMPLETE");
    props.onComplete(completion);
  }, [definition, props]);

  const goToCard = useCallback((next: number) => {
    setCardIndex(next);
    setSegIndex(0);
    setPhase("PLAYING");
  }, []);

  // A scene has reached its end: acknowledge the card and take the director's
  // decision. Called from the rAF loop and from Skip; guarded so it fires once.
  const handleSceneEnd = useCallback(() => {
    const action = directorOnSceneEnd(definition, cardIndex, masteredRef.current);
    if (action.kind === "SHOW_CHECK") {
      setPhase("CHECK");
    } else if (action.kind === "NEXT_CARD") {
      goToCard(action.cardIndex);
    } else {
      finishModule();
    }
  }, [definition, cardIndex, finishModule, goToCard]);

  // ---- The card cursor: reset when the card changes. ----------------------
  useEffect(() => {
    cursorRef.current = createModuleCursor(durations.length);
    sceneEndedRef.current = durations.length === 0;
    setSegIndex(0);
    if (durations.length === 0) {
      // A truly empty scene ends immediately (defensive; M1 has none).
      handleSceneEnd();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardIndex, definition.moduleId]);

  // ---- The cinematic timeline: a clamped rAF cursor across the card's shots.
  useEffect(() => {
    if (phase !== "PLAYING" || paused || durations.length === 0) return undefined;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const delta = now - last;
      last = now;
      cursorRef.current = advanceModuleTimeline(durations, cursorRef.current, delta);
      setSegIndex(cursorRef.current.beatIndex);
      if (cursorRef.current.done) {
        if (!sceneEndedRef.current) {
          sceneEndedRef.current = true;
          handleSceneEnd();
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cardIndex, durations, phase, paused, handleSceneEnd]);

  // ---- Voiceover: speak the active segment; stop on change/unmount. -------
  const lastSpokenRef = useRef<string | null>(null);
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller || phase !== "PLAYING" || paused || !segment) return;
    const key = `${cardIndex}:${segIndex}`;
    if (lastSpokenRef.current === key) return;
    lastSpokenRef.current = key;
    controller.play([{ cueId: segment.beatId, text: segment.text }]);
  }, [cardIndex, segIndex, segment, phase, paused]);

  useEffect(() => {
    controllerRef.current?.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (phase !== "PLAYING" || paused) controller.pause();
    else controller.resume();
  }, [phase, paused]);

  useEffect(() => {
    if (phase !== "PLAYING") {
      controllerRef.current?.stop();
      lastSpokenRef.current = null;
    }
  }, [phase]);

  // Card change stops the previous card's speech before the next begins.
  useEffect(() => {
    lastSpokenRef.current = null;
    controllerRef.current?.stop();
  }, [cardIndex]);

  useEffect(() => {
    const controller = controllerRef.current;
    return () => {
      controller?.stop();
    };
  }, []);

  // ---- Mastering a check, and the transition back into the cutscene. ------
  const masterCheck = useCallback((checkId: string) => {
    if (!masteredRef.current.includes(checkId)) {
      masteredRef.current = [...masteredRef.current, checkId];
    }
    setMasteredChecks(masteredRef.current);
  }, []);

  const resumeFromCheck = useCallback(() => {
    const action = directorOnCheckMastered(definition, cardIndex);
    if (action.kind === "NEXT_CARD") goToCard(action.cardIndex);
    else finishModule();
  }, [definition, cardIndex, finishModule, goToCard]);

  // Once the check is settled, hold on the reinforcement briefly, then roll on.
  useEffect(() => {
    if (phase !== "CHECK" || !check || !checkMastered) return undefined;
    const hold = props.reducedMotion ? 650 : 1650;
    const timer = window.setTimeout(resumeFromCheck, hold);
    return () => window.clearTimeout(timer);
  }, [phase, check, checkMastered, props.reducedMotion, resumeFromCheck]);

  // ---- Transport actions. -------------------------------------------------
  const replayScene = useCallback(() => {
    cursorRef.current = createModuleCursor(durations.length);
    sceneEndedRef.current = durations.length === 0;
    setSegIndex(0);
    setPaused(false);
    setPhase("PLAYING");
    lastSpokenRef.current = null;
    controllerRef.current?.stop();
  }, [durations.length]);

  const skipScene = useCallback(() => {
    if (phase !== "PLAYING" || durations.length === 0) return;
    cursorRef.current = {
      beatIndex: durations.length - 1,
      elapsedInBeatMs: durations[durations.length - 1] ?? 0,
      done: true,
    };
    setSegIndex(durations.length - 1);
    if (!sceneEndedRef.current) {
      sceneEndedRef.current = true;
      handleSceneEnd();
    }
  }, [phase, durations, handleSceneEnd]);

  const togglePause = useCallback(() => setPaused((value) => !value), []);

  // ---- Controls auto-dim: any input wakes them; idle re-hides them. -------
  useEffect(() => {
    let timer = 0;
    const wake = () => {
      setControlsAwake(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setControlsAwake(false), CONTROLS_IDLE_MS);
    };
    wake();
    window.addEventListener("pointermove", wake, { passive: true });
    window.addEventListener("pointerdown", wake, { passive: true });
    window.addEventListener("keydown", wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);

  // ---- Keyboard: Space pauses, Escape leaves. Arrows do not turn cards. ---
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const inCheck = target?.closest?.(".mod-cine-check") != null;
      const onControl = target?.closest?.("button, input, textarea, a, select") != null;
      if (event.key === "Escape") {
        event.preventDefault();
        props.onExit();
      } else if ((event.key === " " || event.key === "k") && !inCheck && !onControl) {
        event.preventDefault();
        if (phase === "PLAYING") togglePause();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, togglePause, props]);

  const isRetry = props.attemptOrdinal > 1;
  const shot: ModuleShotKind = phase === "CHECK" ? "REACTION" : segment?.shot ?? "PRESENTER_MEDIUM";
  const activeVisual = phase === "PLAYING" ? segment?.visual : undefined;
  const speaking = phase === "PLAYING" && !paused && durations.length > 0;
  const controlsHidden = !controlsAwake && phase === "PLAYING" && !paused;
  const progress = moduleProgressFraction(definition, cardIndex, segIndex);
  const subtitleText = subtitlesOn && phase === "PLAYING" ? segment?.text ?? "" : "";

  return (
    <div
      className={`mod mod-cine${props.reducedMotion ? " is-reduced" : ""}`}
      data-shot={shot}
      data-phase={phase}
      data-controls={controlsHidden ? "idle" : "awake"}
    >
      <div className="mod-cine-room" aria-hidden="true">
        <div className="mod-cine-fog" />
        <div className="mod-cine-grid" />
        <div className="mod-cine-vignette" />
      </div>

      {/* The presenter: an imported hologram, filmed. Missing/loading shows
          nothing and reports a QA error — never a primitive body. */}
      {definition.presenter && (
        <div className="mod-cine-presenter">
          <SystemPresenter
            presenter={definition.presenter}
            speaking={speaking}
            shot={shot}
            reducedMotion={props.reducedMotion}
            speechCueId={`${cardIndex}:${segIndex}`}
            speechText={segment?.text ?? ""}
          />
        </div>
      )}

      {/* The historical visual, materialized into the frame at its beat. */}
      {activeVisual && (
        <ModuleVisualStage
          visual={activeVisual}
          motion={segment?.visualMotion ?? "none"}
          focused={shot === "VISUAL_FOCUS"}
          reducedMotion={props.reducedMotion}
        />
      )}

      {/* The thin, unobtrusive progress line and a small elapsed readout. */}
      <div className="mod-cine-progress" aria-hidden="true">
        <span className="mod-cine-progress-fill" style={{ transform: `scaleX(${progress})` }} />
      </div>

      <header className="mod-cine-top" data-dim={controlsHidden ? "true" : "false"}>
        <button type="button" className="mod-cine-leave" onClick={props.onExit}>
          <span aria-hidden="true">←</span> Leave
        </button>
        <div className="mod-cine-title">
          <span className="mod-cine-kicker">
            {isRetry
              ? `Required again · attempt ${props.attemptOrdinal} of ${MAX_MISSION_ATTEMPTS}`
              : "Required before deployment"}
          </span>
          <span className="mod-cine-name">{definition.title}</span>
        </div>
        <span className="mod-cine-clock">
          {formatModuleClock(elapsed)}
          <span className="mod-cine-xp"> · Pays no XP</span>
        </span>
      </header>

      {definition.presenter && (
        <span className="mod-cine-presenter-name" data-dim={controlsHidden ? "true" : "false"}>
          {definition.presenter.displayName}
        </span>
      )}

      {/* The subtitle band: one short line at a time, announced politely. */}
      <div className="mod-cine-caption" data-on={subtitlesOn ? "true" : "false"}>
        <p className="mod-cine-caption-text" id={SUBTITLE_ID} aria-live="polite" aria-atomic="true">
          {subtitleText}
        </p>
      </div>

      <ModuleControls
        paused={paused}
        muted={muted}
        subtitlesOn={subtitlesOn}
        hidden={controlsHidden}
        canControl={phase === "PLAYING"}
        voiceoverAvailable={controllerRef.current?.available ?? false}
        onTogglePause={togglePause}
        onToggleMute={() => setMuted((value) => !value)}
        onToggleSubtitles={() => setSubtitlesOn((value) => !value)}
        onReplay={replayScene}
        onSkip={skipScene}
      />

      {/* The mastery check: a focused holographic overlay that pauses the
          cutscene, never a permanent dashboard. */}
      {phase === "CHECK" && check && (
        <ModuleCheckOverlay
          check={check}
          mastered={checkMastered}
          reducedMotion={props.reducedMotion}
          onMastered={() => masterCheck(check.id)}
          onContinue={resumeFromCheck}
        />
      )}
    </div>
  );
}

const CLASSIFICATION_LABEL: Record<ModuleVisual["classification"], string> = {
  PRIMARY_SOURCE: "Primary source",
  PERIOD_ART: "Period art",
  LATER_DEPICTION: "Later depiction",
  PROJECT_RECONSTRUCTION: "Reconstruction",
};

/**
 * A historical image/document materialized into the cinematic frame. The image
 * is the imported provenanced asset; the frame, scanline sweep, holo-assembly
 * entrance and Ken Burns drift are all procedural UI, which the workspace rules
 * permit around an imported visible asset. The caption is brief — title, date,
 * source, classification — never the full narration prose.
 */
function ModuleVisualStage(props: {
  visual: ModuleVisual;
  motion: ModuleVisualMotion;
  focused: boolean;
  reducedMotion: boolean;
}) {
  const { visual } = props;
  return (
    <figure
      className={`mod-cine-visual${props.focused ? " is-focused" : ""}`}
      key={visual.id}
      data-motion={props.reducedMotion ? "none" : props.motion}
    >
      <div className="mod-cine-visual-frame">
        <img
          className={`mod-cine-visual-img${
            props.focused && !props.reducedMotion ? " is-kenburns" : ""
          }`}
          src={visual.src}
          alt={visual.alt}
        />
        <span className="mod-cine-visual-sweep" aria-hidden="true" />
        <span className="mod-cine-visual-corner tl" aria-hidden="true" />
        <span className="mod-cine-visual-corner br" aria-hidden="true" />
      </div>
      <figcaption className="mod-cine-visual-cap">
        <span className={`mod-cine-tag mod-cine-tag-${visual.classification.toLowerCase()}`}>
          {CLASSIFICATION_LABEL[visual.classification]}
        </span>
        <span className="mod-cine-visual-title">{visual.title}</span>
        <span className="mod-cine-visual-src">
          {visual.attribution} · {visual.date}
        </span>
      </figcaption>
    </figure>
  );
}

/** The cinematic transport: pause, replay, skip, mute, subtitles. Auto-dims. */
function ModuleControls(props: {
  paused: boolean;
  muted: boolean;
  subtitlesOn: boolean;
  hidden: boolean;
  canControl: boolean;
  voiceoverAvailable: boolean;
  onTogglePause: () => void;
  onToggleMute: () => void;
  onToggleSubtitles: () => void;
  onReplay: () => void;
  onSkip: () => void;
}) {
  return (
    <div
      className="mod-cine-controls"
      role="group"
      aria-label="Lesson playback controls"
      data-hidden={props.hidden ? "true" : "false"}
    >
      <button
        type="button"
        className="mod-cine-btn is-primary"
        onClick={props.onTogglePause}
        disabled={!props.canControl}
        aria-pressed={props.paused}
      >
        {props.paused ? "Play" : "Pause"}
      </button>
      <button
        type="button"
        className="mod-cine-btn"
        onClick={props.onReplay}
      >
        Replay scene
      </button>
      <button
        type="button"
        className="mod-cine-btn"
        onClick={props.onSkip}
        disabled={!props.canControl}
      >
        Skip
      </button>
      <button
        type="button"
        className="mod-cine-btn"
        onClick={props.onToggleMute}
        aria-pressed={props.muted}
        title={props.voiceoverAvailable ? undefined : "No voice on this device"}
      >
        {props.muted ? "Unmute" : "Mute"}
      </button>
      <button
        type="button"
        className="mod-cine-btn"
        onClick={props.onToggleSubtitles}
        aria-pressed={props.subtitlesOn}
      >
        {props.subtitlesOn ? "Subtitles on" : "Subtitles off"}
      </button>
    </div>
  );
}

/**
 * The mastery check as a focused overlay. It scrims the cutscene, holds the
 * timeline, and reuses ModuleCheckPanel — which shows an option's own
 * misconception feedback on a wrong answer, requires the correct answer, and
 * reinforces on success. On mastery it offers Continue (and the player also
 * auto-resumes shortly after), transitioning back into the cutscene.
 */
function ModuleCheckOverlay(props: {
  check: NonNullable<LearningModuleDefinition["cards"][number]["check"]>;
  mastered: boolean;
  reducedMotion: boolean;
  onMastered: () => void;
  onContinue: () => void;
}) {
  const continueRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (props.mastered) continueRef.current?.focus({ preventScroll: true });
  }, [props.mastered]);

  return (
    <div className="mod-cine-check-scrim">
      <div
        className="mod-cine-check"
        role="dialog"
        aria-modal="true"
        aria-label="Check your understanding"
      >
        <ModuleCheckPanel
          check={props.check}
          active
          mastered={props.mastered}
          reducedMotion={props.reducedMotion}
          onMastered={props.onMastered}
        />
        {props.mastered && (
          <button
            type="button"
            className="mod-cine-continue"
            onClick={props.onContinue}
            ref={continueRef}
          >
            Continue
          </button>
        )}
      </div>
    </div>
  );
}
