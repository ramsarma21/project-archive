import { useCallback, useEffect, useRef, useState } from "react";
import {
  captionsPathFor,
  useActiveCueText,
} from "../../module/ModuleFilePlayer.js";
import "../../module/module.css";
import "./intro.css";

// ---------------------------------------------------------------------------
// The LESSON intake cutscene.
//
// Plays on Deploy, full-bleed, before the Archive's case-file index appears:
// where the operative is going and why there is a lesson in front of the
// mission. It is NOT the game-open intake (`GameIntro`), which introduces the
// product and IRIS herself and runs once per launch from the home screen. Two
// different cutscenes at two different doors; neither replaces the other.
//
// It is also a different KIND of surface from GameIntro. GameIntro drives the
// live 3D presenter and the browser voice over authored beats, because its
// footage slots are still pending. This one has a produced MP4 that carries its
// own voiceover, so the clip IS the scene: no presenter, no speech synthesis,
// nothing to talk over it. What the two share is the chrome — the `mod-cine`
// room, the subtitle band, the Skip affordance — so the lesson reads as one
// system with the game around it.
//
// SUBTITLES are the game's own band, fed from the `.vtt` beside the MP4, on the
// same convention the case-file clips use (`captionsPathFor`). The master is the
// no-subs cut, so nothing is burned into the picture to collide with it.
// ---------------------------------------------------------------------------

/** Where the lesson intro's media lives. Same directory as the file clips. */
const LESSON_INTRO_SRC = "/cutscenes/m1/lesson-intro.mp4";
const LESSON_INTRO_POSTER = "/cutscenes/m1/lesson-intro-poster.jpg";

export function LessonIntro(props: {
  reducedMotion: boolean;
  /** Played out, skipped, or escaped — all the same to the caller. */
  onDone: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const doneRef = useRef(false);
  const [silenced, setSilenced] = useState(false);
  const [fraction, setFraction] = useState(0);
  const caption = useActiveCueText(videoRef, true);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    videoRef.current?.pause();
    props.onDone();
  }, [props]);

  // Escape skips, so the cutscene never traps a keyboard user.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish]);

  // Play it with sound. Deploy is the learner's own click, so the document is
  // activated and audible playback is allowed. A genuine refusal
  // (NotAllowedError) falls back to a silent picture rather than a dead poster;
  // an INTERRUPTED play is not a refusal — it rejects with AbortError and a
  // later play() has already taken over — so it is left alone.
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    const started = element.play();
    if (!started) return;
    void started.catch((error: unknown) => {
      const refused = error instanceof DOMException && error.name === "NotAllowedError";
      if (!refused || videoRef.current !== element) return;
      element.muted = true;
      setSilenced(true);
      void element.play().catch(() => {});
    });
  }, []);

  useEffect(() => {
    const element = videoRef.current;
    return () => {
      element?.pause();
    };
  }, []);

  const captions = captionsPathFor(LESSON_INTRO_SRC);

  return (
    <div
      className={`mod mod-cine mod-intro mod-lesson-intro${
        props.reducedMotion ? " is-reduced" : ""
      }`}
      data-phase="CLIP"
      data-clip-audio={silenced ? "blocked" : "on"}
    >
      <div className="mod-cine-room" aria-hidden="true">
        <div className="mod-cine-fog" />
        <div className="mod-cine-grid" />
        <div className="mod-cine-vignette" />
      </div>

      <div className="mod-lesson-intro-stage">
        <video
          className="mod-lesson-intro-video"
          ref={videoRef}
          src={LESSON_INTRO_SRC}
          poster={LESSON_INTRO_POSTER}
          playsInline
          controls={props.reducedMotion}
          onTimeUpdate={(event) => {
            const { currentTime, duration } = event.currentTarget;
            if (Number.isFinite(duration) && duration > 0) {
              setFraction(Math.min(1, currentTime / duration));
            }
          }}
          onEnded={finish}
        >
          {captions && (
            <track kind="captions" srcLang="en" label="English" src={captions} default />
          )}
        </video>
      </div>

      <div className="mod-cine-progress" aria-hidden="true">
        <span
          className="mod-cine-progress-fill"
          style={{ transform: `scaleX(${fraction})` }}
        />
      </div>

      <header className="mod-cine-top mod-intro-top">
        <div className="mod-cine-title mod-intro-title">
          <span className="mod-cine-kicker">Briefing</span>
          <span className="mod-cine-name">Boston, June 1774</span>
        </div>
        <button
          type="button"
          className="mod-cine-leave mod-cine-leave-end"
          onClick={finish}
        >
          Skip <span aria-hidden="true">▸</span>
        </button>
      </header>

      {/* A generated scene is a reconstruction and says so, exactly as a case
          file's clip does. It is never offered as a record of the period. */}
      <span className="mod-lesson-intro-tag">Reconstruction</span>

      <div
        className="mod-cine-caption"
        data-on="true"
        data-empty={caption.trim() ? "false" : "true"}
      >
        <p className="mod-cine-caption-text" aria-live="polite" aria-atomic="true">
          {caption}
        </p>
      </div>
    </div>
  );
}
