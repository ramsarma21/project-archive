import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type LearningModuleDefinition,
  type ModuleCard,
  type ModuleCheck,
  type ModulePresenter,
  type ModuleVideo,
  type ModuleVisual,
} from "./moduleFormat.js";
import {
  advanceModuleTimeline,
  createModuleCursor,
  type ModuleTimelineCursor,
} from "./moduleTimeline.js";
import {
  directorOnSceneEnd,
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
import { ModuleCheckPanel } from "./ModuleCheckPanel.js";
import { SystemPresenter } from "./SystemPresenter.js";
import "./module.css";

const SUBTITLE_ID = "mod-cine-subtitle";
/** How long the transport lingers after the last input before auto-dimming. */
const CONTROLS_IDLE_MS = 3200;

type FilePhase = "PLAYING" | "CHECK";

/** What a finished file reports: its cue is acknowledged, and the check it
 * carried (if any) was mastered. The Archive accumulates these into the run. */
export interface FilePlayedResult {
  readonly cueId: string;
  readonly masteredCheckId: string | null;
}

/**
 * The player for ONE case file (or one framing screen).
 *
 * It reuses the whole cinematic shot language — `planCardShots`,
 * `PRESENTER_FRAMINGS` and the beat cursor — to play a single card's scene, and
 * then, if the card poses a question, surfaces that mastery check exactly as the
 * deck always did. It reports the result upward rather than deciding completion:
 * the Archive owns the accumulated cues and answered questions and the one gate
 * they feed. This is the "inside a file" half of the design; the Archive is the
 * "browse the files" half.
 */
export function ModuleFilePlayer(props: {
  /** The authored deck, so the shot director's scene-end decision is unchanged. */
  definition: LearningModuleDefinition;
  card: ModuleCard;
  /** The card's index in the authored deck, so the opening card still establishes. */
  deckIndex: number;
  /** The options this sitting shows. A pooled check is drawn by the caller. */
  drawnCheck?: ModuleCheck;
  reducedMotion: boolean;
  presenter?: ModulePresenter;
  /** Injected for tests; defaults to browser speech synthesis. */
  voiceoverProvider?: ModuleVoiceoverProvider;
  /** True when replaying a file whose question is already answered, so the check
   * shows its reinforcement rather than re-asking a settled concept. */
  alreadyMastered?: boolean;
  /** A short label shown in the file player's header, e.g. "File 1 · The closure". */
  fileLabel?: string;
  /** Sub-label, e.g. "Case file · Question 1 of 4". */
  fileKicker?: string;
  onComplete: (result: FilePlayedResult) => void;
  /** Leaving the Archive entirely. Nothing is recorded. */
  onExit: () => void;
  /** Back to the Archive index without finishing this file. */
  onBackToIndex: () => void;
}) {
  const { card, deckIndex } = props;

  const [segIndex, setSegIndex] = useState(0);
  const [phase, setPhase] = useState<FilePhase>("PLAYING");
  const [checkMastered, setCheckMastered] = useState(props.alreadyMastered ?? false);

  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [subtitlesOn, setSubtitlesOn] = useState(true);
  const [controlsAwake, setControlsAwake] = useState(true);

  const segments = useMemo(() => planCardShots(card, deckIndex), [card, deckIndex]);
  const durations = useMemo(() => segmentDurations(segments), [segments]);
  const segment: ModuleSegment | undefined =
    segments[Math.min(segIndex, segments.length - 1)];

  const check = props.drawnCheck ?? card.check;
  const video = card.scene?.video;

  const cursorRef = useRef<ModuleTimelineCursor>(createModuleCursor(durations.length));
  const sceneEndedRef = useRef(false);
  const doneRef = useRef(false);

  const provider = props.voiceoverProvider ?? useMemo(defaultModuleVoiceoverProvider, []);
  const controllerRef = useRef<ModuleVoiceoverController | null>(null);
  if (controllerRef.current === null) controllerRef.current = provider.create();

  // The card's scene finished. The shot director makes the SAME decision it
  // always did — a mastery check the run has not answered interrupts here — only
  // now "the deck rolls on" is the Archive unlocking the next file rather than an
  // automatic advance, so anything that is not SHOW_CHECK means this file is done
  // and control returns to the browser.
  const handleSceneEnd = useCallback(() => {
    const action = directorOnSceneEnd(
      props.definition,
      deckIndex,
      checkMastered && card.check ? [card.check.id] : [],
    );
    if (action.kind === "SHOW_CHECK") {
      setPhase("CHECK");
    } else if (!doneRef.current) {
      doneRef.current = true;
      props.onComplete({ cueId: card.cueId, masteredCheckId: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, deckIndex, checkMastered, props.definition]);

  // ---- The cinematic timeline: a clamped rAF cursor across the card's shots.
  useEffect(() => {
    if (phase !== "PLAYING" || paused || durations.length === 0) {
      if (durations.length === 0 && !sceneEndedRef.current) {
        sceneEndedRef.current = true;
        handleSceneEnd();
      }
      return undefined;
    }
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
  }, [durations, phase, paused, handleSceneEnd]);

  // ---- Voiceover: speak the active segment; stop on change/unmount. -------
  const lastSpokenRef = useRef<string | null>(null);
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller || phase !== "PLAYING" || paused || !segment) return;
    const key = `${card.id}:${segIndex}`;
    if (lastSpokenRef.current === key) return;
    lastSpokenRef.current = key;
    controller.play([{ cueId: segment.beatId, text: segment.text }]);
  }, [card.id, segIndex, segment, phase, paused]);

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

  useEffect(() => {
    const controller = controllerRef.current;
    return () => {
      controller?.stop();
    };
  }, []);

  const finishAfterCheck = useCallback(() => {
    if (doneRef.current || !card.check) return;
    doneRef.current = true;
    props.onComplete({ cueId: card.cueId, masteredCheckId: card.check.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card]);

  const masterCheck = useCallback(() => setCheckMastered(true), []);

  // Once the check is mastered, hold on the reinforcement briefly, then finish.
  useEffect(() => {
    if (phase !== "CHECK" || !card.check || !checkMastered) return undefined;
    const hold = props.reducedMotion ? 650 : 1650;
    const timer = window.setTimeout(finishAfterCheck, hold);
    return () => window.clearTimeout(timer);
  }, [phase, card, checkMastered, props.reducedMotion, finishAfterCheck]);

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

  // ---- Keyboard: Space pauses, Escape returns to the index. ---------------
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const inCheck = target?.closest?.(".mod-cine-check") != null;
      const onControl = target?.closest?.("button, input, textarea, a, select") != null;
      if (event.key === "Escape") {
        event.preventDefault();
        props.onBackToIndex();
      } else if ((event.key === " " || event.key === "k") && !inCheck && !onControl) {
        event.preventDefault();
        if (phase === "PLAYING") togglePause();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, togglePause, props]);

  const shot: ModuleShotKind =
    phase === "CHECK" ? "REACTION" : segment?.shot ?? "PRESENTER_MEDIUM";
  const activeVisual = phase === "PLAYING" ? segment?.visual : undefined;
  const speaking = phase === "PLAYING" && !paused && durations.length > 0;
  const controlsHidden = !controlsAwake && phase === "PLAYING" && !paused;
  const progress =
    durations.length > 0 ? Math.min(1, (segIndex + 1) / durations.length) : 1;
  const subtitleText = subtitlesOn && phase === "PLAYING" ? segment?.text ?? "" : "";
  const showVideo = phase === "PLAYING" && Boolean(video?.src);

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

      {props.presenter && (
        <div className="mod-cine-presenter">
          <SystemPresenter
            presenter={props.presenter}
            speaking={speaking}
            shot={shot}
            reducedMotion={props.reducedMotion}
            speechCueId={`${card.id}:${segIndex}`}
            speechText={segment?.text ?? ""}
          />
        </div>
      )}

      {/* The generated clip, when one has been produced. Absent/pending renders
          nothing; the document image and the question still show. */}
      {showVideo && video && (
        <ModuleVideoStage video={video} reducedMotion={props.reducedMotion} />
      )}

      {/* The historical document, materialized into the frame at its beat. */}
      {activeVisual && !showVideo && (
        <ModuleVisualStage
          visual={activeVisual}
          motion={segment?.visualMotion ?? "none"}
          focused={shot === "VISUAL_FOCUS"}
          reducedMotion={props.reducedMotion}
        />
      )}

      <div className="mod-cine-progress" aria-hidden="true">
        <span
          className="mod-cine-progress-fill"
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>

      <header className="mod-cine-top" data-dim={controlsHidden ? "true" : "false"}>
        <button type="button" className="mod-cine-leave" onClick={props.onBackToIndex}>
          <span aria-hidden="true">←</span> Archive
        </button>
        <div className="mod-cine-title">
          <span className="mod-cine-kicker">
            {props.fileKicker ?? "Case file"}
          </span>
          <span className="mod-cine-name">{props.fileLabel ?? card.kicker}</span>
        </div>
        <button type="button" className="mod-cine-leave mod-cine-leave-end" onClick={props.onExit}>
          Leave
        </button>
      </header>

      {props.presenter && (
        <span
          className="mod-cine-presenter-name"
          data-dim={controlsHidden ? "true" : "false"}
        >
          {props.presenter.displayName}
        </span>
      )}

      <div className="mod-cine-caption" data-on={subtitlesOn ? "true" : "false"}>
        <p
          className="mod-cine-caption-text"
          id={SUBTITLE_ID}
          aria-live="polite"
          aria-atomic="true"
        >
          {subtitleText}
        </p>
      </div>

      <FileControls
        paused={paused}
        muted={muted}
        subtitlesOn={subtitlesOn}
        hidden={controlsHidden}
        canControl={phase === "PLAYING"}
        onTogglePause={togglePause}
        onToggleMute={() => setMuted((value) => !value)}
        onToggleSubtitles={() => setSubtitlesOn((value) => !value)}
        onReplay={replayScene}
        onSkip={skipScene}
      />

      {phase === "CHECK" && check && (
        <ModuleCheckOverlay
          check={check}
          mastered={checkMastered}
          reducedMotion={props.reducedMotion}
          onMastered={masterCheck}
          onContinue={finishAfterCheck}
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

/** A historical image/document materialized into the cinematic frame. */
export function ModuleVisualStage(props: {
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
        <span
          className={`mod-cine-tag mod-cine-tag-${visual.classification.toLowerCase()}`}
        >
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

/**
 * The generated cutscene clip, when one exists. This is only reached when the
 * video carries a real `src` (see the caller); a pending clip has no source and
 * this component is never mounted, so the file falls back to its document image
 * and question with no broken frame. The provenance caption is shown for the
 * same reason a still's is: a generated scene is a reconstruction, never
 * documentary evidence, and it says so.
 */
export function ModuleVideoStage(props: {
  video: ModuleVideo;
  reducedMotion: boolean;
}) {
  const { video } = props;
  if (!video.src) return null;
  return (
    <figure className="mod-cine-visual mod-cine-video is-focused" key={video.id}>
      <div className="mod-cine-visual-frame">
        <video
          className="mod-cine-visual-img"
          src={video.src}
          poster={video.poster}
          autoPlay={!props.reducedMotion}
          muted
          playsInline
          controls={props.reducedMotion}
        />
        <span className="mod-cine-visual-corner tl" aria-hidden="true" />
        <span className="mod-cine-visual-corner br" aria-hidden="true" />
      </div>
      <figcaption className="mod-cine-visual-cap">
        <span
          className={`mod-cine-tag mod-cine-tag-${video.classification.toLowerCase()}`}
        >
          {CLASSIFICATION_LABEL[video.classification]}
        </span>
        <span className="mod-cine-visual-title">{video.title}</span>
        <span className="mod-cine-visual-src">
          {video.attribution} · {video.date}
        </span>
      </figcaption>
    </figure>
  );
}

/** The cinematic transport: pause, replay, skip, mute, subtitles. Auto-dims. */
function FileControls(props: {
  paused: boolean;
  muted: boolean;
  subtitlesOn: boolean;
  hidden: boolean;
  canControl: boolean;
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
      <button type="button" className="mod-cine-btn" onClick={props.onReplay}>
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
 * The mastery check as a focused overlay. Reuses ModuleCheckPanel — an option's
 * own misconception feedback on a wrong answer, the correct answer required, and
 * reinforcement on success — exactly as the deck always gated it.
 */
function ModuleCheckOverlay(props: {
  check: ModuleCheck;
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
