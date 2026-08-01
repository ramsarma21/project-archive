import { useCallback, useEffect, useRef, useState } from "react";
import "../../module/module.css";
import "./intro.css";

// ---------------------------------------------------------------------------
// The game-open intake cutscene.
//
// Plays on entering the game, EVERY launch, with a Skip control and NO
// persistence flag, then hands off to the hub. It is the whole-game framing the
// lesson opening is not: what Project Archive is, who the player is in it, and
// who IRIS is.
//
// This is now the FINISHED FILM, not a live-rendered scene. The seven generated
// shots are assembled, dubbed in IRIS's voice, mixed over the Archive-hall bed
// and captioned in post (~/Downloads/game-intro builds it), so this component
// plays one file rather than driving a presenter, a voiceover provider and a
// beat timer. Captions and the acronym title card are burned into the picture,
// which is why nothing here draws a caption: what the owner reviewed in the MP4
// is exactly what ships. `game-intro.vtt` sits beside the MP4 as the text
// sidecar for anything that needs the lines as data.
//
// The last shot cuts to the player's own avatar, face-on in the Archive Hall,
// framed to match the hub's opening view (HOME_ANGLE = 0). The handoff fades
// that frame out over the same dark ground the hub comes up on, so launch ->
// intro -> hub reads as one move rather than three screens.
// ---------------------------------------------------------------------------

const INTRO_SRC = "/cutscenes/intro/game-intro.mp4";

/** How long the last frame takes to give way to the hub. */
const HANDOFF_MS = 700;

export function GameIntro(props: { reducedMotion: boolean; onDone: () => void }) {
  const { reducedMotion, onDone } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const doneRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  // Autoplay policy blocks sound when there was no user gesture on this
  // document — `?intro=1` opens straight into the cutscene, which is exactly
  // that case. Rather than fail silently we fall back to a muted play and offer
  // the sound back, so the intro always runs.
  const [muted, setMuted] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    videoRef.current?.pause();
    onDone();
  }, [onDone]);

  // Reached the end on its own: hold the last frame, dissolve, then hand over.
  const handOff = useCallback(() => {
    if (doneRef.current) return;
    if (reducedMotion) {
      finish();
      return;
    }
    setLeaving(true);
    timerRef.current = window.setTimeout(finish, HANDOFF_MS);
  }, [finish, reducedMotion]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  // Escape skips, so the intro never traps a keyboard user.
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

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    void video.play().catch(() => {
      if (cancelled) return;
      video.muted = true;
      setMuted(true);
      // If even a muted play is refused there is nothing left to try; the Skip
      // control and Escape both still work, so the player is never stuck.
      void video.play().catch(() => undefined);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const unmute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    setMuted(false);
    void video.play().catch(() => undefined);
  };

  return (
    <div className="mod mod-cine mod-intro" data-phase="PLAYING" data-leaving={leaving}>
      <video
        ref={videoRef}
        className="mod-intro-film"
        src={INTRO_SRC}
        preload="auto"
        playsInline
        // A missing or unplayable file must not hold the player on a dead
        // screen: go straight to the hub, which is where this was headed.
        onError={finish}
        onEnded={handOff}
      />

      <header className="mod-cine-top mod-intro-top">
        <div className="mod-cine-title mod-intro-title">
          <span className="mod-cine-kicker">Project Archive</span>
          <span className="mod-cine-name">Intake</span>
        </div>
        <div className="mod-intro-controls">
          {muted && (
            <button type="button" className="mod-cine-leave" onClick={unmute}>
              Sound on
            </button>
          )}
          <button type="button" className="mod-cine-leave mod-cine-leave-end" onClick={finish}>
            Skip <span aria-hidden="true">▸</span>
          </button>
        </div>
      </header>
    </div>
  );
}
