import { useCallback, useEffect, useRef, useState } from "react";
import type { CinePose } from "./encounterCinematic.js";
import {
  BOSS_CHALLENGE_BEATS,
  BOSS_CHALLENGE_HARD_CAP_S,
  BOSS_CHALLENGE_TOTAL_S,
  BOSS_SPEAKER_AFFILIATION,
  BOSS_SPEAKER_ROLE,
  bossBeatAt,
  bossElapsedS,
} from "./bossCutscene.js";
import "./missionEncounter.css";

// ---------------------------------------------------------------------------
// The boss challenge's subtitle surface — the on-glass half of the cutscene.
//
// The in-world half (the officer, the two-shot camera) is drawn by MissionStage
// from the SAME clock start this overlay owns; this is only the letterboxed
// subtitle and the skip. It reuses MissionEncounter's `.msn-enc-*` subtitle
// language on purpose, so the officer's challenge reads in the exact voice and
// styling as the guards who stop the player mid-route — that consistency is the
// point of the beat.
//
// IT CANNOT HANG, and this component is where that is enforced on the browser
// side. `onEnter` opens the duel and is called by THREE independent paths, all
// funnelled through one idempotent ref so the duel opens exactly once:
//   1. the scripted timeline completing (`BOSS_CHALLENGE_TOTAL_S`);
//   2. a hard backstop timer (`BOSS_CHALLENGE_HARD_CAP_S`), which fires even if
//      the rAF loop is starved — the "assume a player who has seen it five
//      times, and never let it stall the gateway to the fight" guarantee;
//   3. the player skipping (button, or Esc / Enter / Space).
// None of these depend on the officer GLB, the camera, or any 3D state having
// loaded: the fight opens on the clock and the key, not on the picture.
// ---------------------------------------------------------------------------

export function BossChallenge(props: {
  /** The player's grounded arrival pose. Only carried so the surface and the
   *  stage agree on the same moment; the subtitle itself is pose-independent. */
  readonly player: CinePose;
  /** `performance.now()` when the challenge armed. Shared with MissionStage so
   *  the subtitle and the camera/officer run off one clock. */
  readonly startedAtMs: number;
  readonly reducedMotion: boolean;
  /** Opens the duel. Called at most once, however the cutscene ends. */
  readonly onEnter: () => void;
}) {
  const { startedAtMs, onEnter } = props;
  const entered = useRef(false);
  const [beatIndex, setBeatIndex] = useState(0);

  const enter = useCallback(() => {
    if (entered.current) return;
    entered.current = true;
    onEnter();
  }, [onEnter]);

  // The scripted timeline, sampled once a frame. Re-renders only when the beat
  // changes, so a held line costs no renders. The frame the timeline completes,
  // the duel opens — this is the ordinary, expected exit.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const elapsedS = bossElapsedS(startedAtMs);
      const { index } = bossBeatAt(elapsedS);
      setBeatIndex((prev) => (prev === index ? prev : index));
      if (elapsedS >= BOSS_CHALLENGE_TOTAL_S) {
        enter();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enter, startedAtMs]);

  // The hard backstop. Independent of the rAF loop above (a backgrounded tab
  // throttles rAF but not this), so the duel opens even if every frame is
  // dropped. This is the structural anti-hang: the gateway to the fight cannot
  // stall on a stuck cutscene.
  useEffect(() => {
    const remainingMs = Math.max(
      0,
      (BOSS_CHALLENGE_HARD_CAP_S - bossElapsedS(startedAtMs)) * 1000,
    );
    const handle = setTimeout(enter, remainingMs);
    return () => clearTimeout(handle);
  }, [enter, startedAtMs]);

  // Skip on the obvious keys, for a player who has read it before.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        enter();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enter]);

  // `beatIndex` (state) is what forces the re-render; the line and phase are
  // read straight from the shared beat table by that index, so the subtitle and
  // the officer's clip in MissionStage cannot disagree about which beat is up.
  const beat =
    BOSS_CHALLENGE_BEATS[Math.min(beatIndex, BOSS_CHALLENGE_BEATS.length - 1)]!;
  const line = beat.line;

  return (
    <div
      className={
        `msn-enc msn-boss is-${beat.phase.toLowerCase()}` +
        (props.reducedMotion ? " is-reduced" : "")
      }
    >
      <div className="msn-boss-bar msn-boss-bar-top" aria-hidden />

      <div className="msn-enc-say" role="status" aria-live="polite">
        <p className="msn-enc-speaker">
          <span className="msn-enc-role">{BOSS_SPEAKER_ROLE}</span>
          <span className="msn-enc-affiliation">{BOSS_SPEAKER_AFFILIATION}</span>
        </p>
        <p className="msn-enc-line">{line}</p>
      </div>

      <div className="msn-boss-bar msn-boss-bar-bottom" aria-hidden>
        <button type="button" className="msn-boss-skip" onClick={enter}>
          Skip ›
        </button>
      </div>
    </div>
  );
}
