import { useEffect, useMemo, useRef, useState } from "react";
import { SystemPresenter } from "../../module/SystemPresenter.js";
import { ModuleVideoStage } from "../../module/ModuleFilePlayer.js";
import {
  defaultModuleVoiceoverProvider,
  type ModuleVoiceoverController,
} from "../../module/moduleVoiceover.js";
import { segmentBeatText } from "../../module/moduleShots.js";
import type { ModuleShotKind } from "../../module/moduleShots.js";
import { beatDurationMs } from "../../module/moduleTimeline.js";
import type { ModulePresenter, ModuleVideo } from "../../module/moduleFormat.js";
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
// MEDIA, per the design of record (M1-Remedial-Slice "Cutscene media pipeline"):
//   · Beats 1-2 are AI-GENERATED CUTSCENE FOOTAGE, authored here as PENDING
//     `ModuleVideo` slots — no `src` yet, so `ModuleVideoStage` renders NOTHING
//     and IRIS narrates over a clean frame rather than a broken element. When the
//     MP4s are produced they drop into the same slots. That footage is CLEAN,
//     realistic period video in the game's 3D-asset look — NEVER hologram-
//     filtered and never photoreal. The hologram treatment is reserved for IRIS
//     herself and the Archive UI, so nothing here composites a scanline/tint over
//     the video; the slot just plays it.
//   · Beat 3 is IRIS herself, live 3D (the same rigged presenter the lesson
//     uses), never video.
//
// This reuses the lesson's cinematic surface (SystemPresenter, ModuleVideoStage,
// the `mod-cine` room/subtitle chrome, the voiceover provider, the shot framings)
// so the intro and the lesson read as one system and the pending-video path is
// the SAME one the lesson already ships.
// ---------------------------------------------------------------------------

/**
 * IRIS is the same rigged presenter the lesson drives. Named here so her label
 * reads "IRIS" from the game's very first screen — the display name lives in
 * `content/m1/module.json` for the lesson; the intro is not module content, so it
 * carries its own copy of the presenter descriptor.
 */
const IRIS: ModulePresenter = {
  glbKey: "system-presenter-rigged",
  displayName: "IRIS",
  talkClip: "talk",
  idleClip: "idle",
};

/** A pending reconstruction slot: authored provenance, no source yet. */
function pendingClip(id: string, title: string, alt: string): ModuleVideo {
  return {
    id,
    // No `src`: the MP4 is generated later. ModuleVideoStage renders nothing.
    alt,
    title,
    caption:
      "A generated reconstruction for the Archive intake. A stylised scene, not a historical record.",
    attribution: "Project Archive",
    sourceUrl: "project-archive://cutscenes/intro",
    date: "reconstruction (pending)",
    rights: "Project Archive; generated reconstruction.",
    classification: "PROJECT_RECONSTRUCTION",
  };
}

interface IntroBeat {
  id: string;
  /** A whole spoken thought; split into short subtitle lines like a lesson beat. */
  text: string;
  /** Establishing footage slot (beats 1-2). Absent on IRIS's own beat. */
  video?: ModuleVideo;
}

// Grounded in the bible (PRODUCT-REQUIREMENTS §"enter…under a believable cover
// identity…witness fixed historical events"; Day-1 B0 §"the HUD is your AR
// overlay, the Archive AI is your handler"). IRIS's voice is the handler's:
// calm, dry, economical — not a lecturer.
const INTRO_BEATS: readonly IntroBeat[] = [
  {
    id: "INTRO.ARCHIVE",
    text:
      "Project Archive inserts you into real history, under a cover identity, to witness it and verify the record. The overlay around you is the Archive, invisible to anyone in the past.",
    video: pendingClip(
      "intro-archive",
      "Project Archive — what the Archive is",
      "Establishing reconstruction: an operative moving through a reconstructed historical city, a projected field overlay around them.",
    ),
  },
  {
    id: "INTRO.ROLE",
    text:
      "You are newly fielded. You will not study the past from a desk. You will live it, in disguise, and learn it by doing.",
    video: pendingClip(
      "intro-role",
      "Project Archive — your role",
      "Reconstruction: a newly-fielded operative in period cover taking up ordinary work in the reconstructed city.",
    ),
  },
  {
    id: "INTRO.IRIS",
    text:
      "I am IRIS, the Immersive Reconstruction and Instruction System, and your handler. I brief you, flag what matters while you work, and check your read before you file. Your first insertion is ready.",
  },
];

interface IntroSegment {
  beatId: string;
  text: string;
  shot: ModuleShotKind;
  video?: ModuleVideo;
}

export function GameIntro(props: { reducedMotion: boolean; onDone: () => void }) {
  const segments = useMemo<IntroSegment[]>(() => {
    const out: IntroSegment[] = [];
    for (const beat of INTRO_BEATS) {
      // While the clip is pending, IRIS narrates prominently (PRESENTER_MEDIUM).
      // Once the MP4 lands, the footage dominates and she recedes (VISUAL_FOCUS)
      // — the same shot the lesson uses when a visual owns the frame.
      const shot: ModuleShotKind = beat.video?.src ? "VISUAL_FOCUS" : "PRESENTER_MEDIUM";
      for (const line of segmentBeatText(beat.text)) {
        out.push({ beatId: beat.id, text: line, shot, ...(beat.video ? { video: beat.video } : {}) });
      }
    }
    return out;
  }, []);

  const [segIndex, setSegIndex] = useState(0);
  const doneRef = useRef(false);
  const voiceRef = useRef<ModuleVoiceoverController | null>(null);
  if (voiceRef.current === null) voiceRef.current = defaultModuleVoiceoverProvider().create();

  const finish = useMemo(
    () => () => {
      if (doneRef.current) return;
      doneRef.current = true;
      voiceRef.current?.stop();
      props.onDone();
    },
    [props],
  );

  useEffect(() => () => voiceRef.current?.stop(), []);

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

  // Advance line by line at each line's presentation length, speaking it as it
  // shows. The last line hands off to the hub. A pending clip changes none of
  // this — the frame is IRIS + subtitle rather than a broken video element.
  useEffect(() => {
    if (doneRef.current) return;
    const segment = segments[segIndex];
    if (!segment) return;
    voiceRef.current?.play([{ cueId: `${segment.beatId}:${segIndex}`, text: segment.text }]);
    const timer = window.setTimeout(() => {
      if (segIndex + 1 >= segments.length) finish();
      else setSegIndex(segIndex + 1);
    }, beatDurationMs(segment.text));
    return () => window.clearTimeout(timer);
  }, [segIndex, segments, finish]);

  const segment = segments[segIndex];
  const shot = segment?.shot ?? "PRESENTER_MEDIUM";
  const progress = segments.length > 0 ? (segIndex + 1) / segments.length : 1;

  return (
    <div className="mod mod-cine mod-intro" data-shot={shot} data-phase="PLAYING">
      <div className="mod-cine-room" aria-hidden="true">
        <div className="mod-cine-fog" />
        <div className="mod-cine-grid" />
        <div className="mod-cine-vignette" />
      </div>

      <div className="mod-cine-presenter">
        <SystemPresenter
          presenter={IRIS}
          speaking={!doneRef.current}
          shot={shot}
          reducedMotion={props.reducedMotion}
          speechCueId={`intro:${segIndex}`}
          speechText={segment?.text ?? ""}
        />
      </div>

      {/* Pending clips render nothing; a produced one plays here, clean (never
          hologram-filtered), with IRIS receded to VISUAL_FOCUS. */}
      {segment?.video?.src && (
        <ModuleVideoStage video={segment.video} reducedMotion={props.reducedMotion} />
      )}

      <div className="mod-cine-progress" aria-hidden="true">
        <span className="mod-cine-progress-fill" style={{ transform: `scaleX(${progress})` }} />
      </div>

      <header className="mod-cine-top mod-intro-top">
        <div className="mod-cine-title mod-intro-title">
          <span className="mod-cine-kicker">Project Archive</span>
          <span className="mod-cine-name">Intake</span>
        </div>
        <button type="button" className="mod-cine-leave mod-cine-leave-end" onClick={finish}>
          Skip <span aria-hidden="true">▸</span>
        </button>
      </header>

      <span className="mod-cine-presenter-name">{IRIS.displayName}</span>

      <div
        className="mod-cine-caption"
        data-on="true"
        data-empty={segment?.text?.trim() ? "false" : "true"}
      >
        <p className="mod-cine-caption-text" aria-live="polite" aria-atomic="true">
          {segment?.text ?? ""}
        </p>
      </div>
    </div>
  );
}
