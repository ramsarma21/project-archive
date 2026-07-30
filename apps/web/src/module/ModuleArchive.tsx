import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAX_MISSION_ATTEMPTS } from "@pa/contracts";
import { formatModuleClock, type LearningModuleDefinition } from "./moduleFormat.js";
import {
  archiveFileStatuses,
  allFilesResolved,
  deriveArchiveLayout,
  type ArchiveFile,
  type ArchiveFileStatus,
} from "./archiveLayout.js";
import { completeModuleRun, type ModuleRunCompletion } from "./moduleGate.js";
import { drawCheckOptions } from "./checkDraw.js";
import { ModuleFilePlayer, type FilePlayedResult } from "./ModuleFilePlayer.js";
import type { ModuleVoiceoverProvider } from "./moduleVoiceover.js";
import "./module.css";

// ---------------------------------------------------------------------------
// The Archive: a player-paced case-file browser.
//
// This REPLACES the auto-advancing deck. The handler opens an Archive of case
// files, one per concept. The player presses play on a file, watches it, answers
// its one question, and the next file unlocks — files unlock IN ORDER because
// the sequence is itself a lesson. What happens INSIDE a file is unchanged: the
// shot director (`planCardShots`, `PRESENTER_FRAMINGS`) still drives the
// cutscene, and the mastery check still gates it. This file owns only the browse
// layer around those files, and it drives one `ModuleFilePlayer` at a time.
//
// THE COMPLETION GATE MOVED WITH THE CHANGE, without weakening. It is now "every
// file played and every question answered", which is the same two conditions the
// server re-derives — every cue acknowledged AND every required check mastered —
// renamed. The receipt is still `completeModuleRun`, so `moduleRequiredCheckIds`
// and `apps/api`'s module-deck parity are untouched: the Archive accumulates the
// cues and answers as the player works through the files and framing, then mints
// one completion for the whole deck exactly as before.
// ---------------------------------------------------------------------------

type ArchiveView =
  | { readonly kind: "OPENING"; readonly at: number }
  | { readonly kind: "INDEX" }
  | { readonly kind: "FILE"; readonly fileIndex: number }
  | { readonly kind: "BRIEF"; readonly at: number }
  | { readonly kind: "COMPLETE" };

export function ModuleArchive(props: {
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
  const { definition, attemptOrdinal } = props;
  const layout = useMemo(() => deriveArchiveLayout(definition), [definition]);

  const [acknowledgedCueIds, setAcknowledgedCueIds] = useState<readonly string[]>([]);
  const [masteredCheckIds, setMasteredCheckIds] = useState<readonly string[]>([]);
  const [view, setView] = useState<ArchiveView>(() =>
    layout.opening.length > 0 ? { kind: "OPENING", at: 0 } : { kind: "INDEX" },
  );
  const [elapsed, setElapsed] = useState(0);

  const startedAtRef = useRef(Date.now());
  const completedRef = useRef(false);

  useEffect(() => {
    startedAtRef.current = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [definition.moduleId]);

  const statuses = archiveFileStatuses(layout, acknowledgedCueIds, masteredCheckIds);
  const resolved = allFilesResolved(layout, acknowledgedCueIds, masteredCheckIds);

  const ackCue = useCallback((cueId: string) => {
    setAcknowledgedCueIds((current) =>
      current.includes(cueId) ? current : [...current, cueId],
    );
  }, []);

  const finishRun = useCallback(
    (cues: readonly string[], checks: readonly string[]) => {
      if (completedRef.current) return;
      const completion = completeModuleRun({
        definition,
        attemptOrdinal,
        acknowledgedCueIds: cues,
        acknowledgedCheckIds: checks,
        observedSeconds: (Date.now() - startedAtRef.current) / 1000,
        at: new Date().toISOString(),
      });
      if (!completion) {
        console.warn(
          `[module] ${definition.moduleId}: the Archive reached its handoff with a ` +
            "file or a question still outstanding. Nothing was completed.",
        );
        return;
      }
      completedRef.current = true;
      setView({ kind: "COMPLETE" });
      props.onComplete(completion);
    },
    [definition, attemptOrdinal, props],
  );

  // A framing screen (opening or brief) finished: acknowledge its cue and move
  // to the next framing screen, the index, or the run's completion.
  const onFramingDone = useCallback(
    (kind: "OPENING" | "BRIEF", at: number, cueId: string) => {
      const nextCues = acknowledgedCueIds.includes(cueId)
        ? acknowledgedCueIds
        : [...acknowledgedCueIds, cueId];
      ackCue(cueId);
      if (kind === "OPENING") {
        setView(
          at + 1 < layout.opening.length
            ? { kind: "OPENING", at: at + 1 }
            : { kind: "INDEX" },
        );
        return;
      }
      if (at + 1 < layout.brief.length) {
        setView({ kind: "BRIEF", at: at + 1 });
      } else {
        finishRun(nextCues, masteredCheckIds);
      }
    },
    [acknowledgedCueIds, masteredCheckIds, layout, ackCue, finishRun],
  );

  // A case file finished: record its cue and its answered question, then return
  // to the index — the next file is now unlocked. When the last file is done and
  // there is no handoff to play, the run completes here.
  const onFileDone = useCallback(
    (fileIndex: number, result: FilePlayedResult) => {
      const nextCues = acknowledgedCueIds.includes(result.cueId)
        ? acknowledgedCueIds
        : [...acknowledgedCueIds, result.cueId];
      const nextChecks =
        result.masteredCheckId && !masteredCheckIds.includes(result.masteredCheckId)
          ? [...masteredCheckIds, result.masteredCheckId]
          : masteredCheckIds;
      setAcknowledgedCueIds(nextCues);
      setMasteredCheckIds(nextChecks);
      const done = allFilesResolved(layout, nextCues, nextChecks);
      if (done && layout.brief.length === 0) {
        finishRun(nextCues, nextChecks);
      } else {
        setView({ kind: "INDEX" });
      }
    },
    [acknowledgedCueIds, masteredCheckIds, layout, finishRun],
  );

  if (view.kind === "OPENING") {
    const framing = layout.opening[view.at]!;
    return (
      <ModuleFilePlayer
        key={`opening-${framing.card.id}`}
        definition={definition}
        card={framing.card}
        deckIndex={framing.deckIndex}
        reducedMotion={props.reducedMotion}
        presenter={definition.presenter}
        voiceoverProvider={props.voiceoverProvider}
        fileKicker="Archive · Opening"
        fileLabel={framing.card.kicker}
        onComplete={() => onFramingDone("OPENING", view.at, framing.card.cueId)}
        onExit={props.onExit}
        onBackToIndex={() => onFramingDone("OPENING", view.at, framing.card.cueId)}
      />
    );
  }

  if (view.kind === "BRIEF") {
    const framing = layout.brief[view.at]!;
    return (
      <ModuleFilePlayer
        key={`brief-${framing.card.id}`}
        definition={definition}
        card={framing.card}
        deckIndex={framing.deckIndex}
        reducedMotion={props.reducedMotion}
        presenter={definition.presenter}
        voiceoverProvider={props.voiceoverProvider}
        fileKicker="Archive · The handoff"
        fileLabel={framing.card.kicker}
        onComplete={() => onFramingDone("BRIEF", view.at, framing.card.cueId)}
        onExit={props.onExit}
        onBackToIndex={() => onFramingDone("BRIEF", view.at, framing.card.cueId)}
      />
    );
  }

  if (view.kind === "FILE") {
    const file = layout.files[view.fileIndex]!;
    const alreadyDone = statuses[view.fileIndex] === "DONE";
    const drawnCheck = file.card.check
      ? drawCheckOptions(file.card.check, attemptOrdinal)
      : undefined;
    return (
      <ModuleFilePlayer
        key={`file-${file.card.id}`}
        definition={definition}
        card={file.card}
        deckIndex={file.deckIndex}
        drawnCheck={drawnCheck}
        reducedMotion={props.reducedMotion}
        presenter={definition.presenter}
        voiceoverProvider={props.voiceoverProvider}
        alreadyMastered={alreadyDone}
        fileKicker={`Case file ${file.ordinal} of ${layout.files.length}`}
        fileLabel={file.card.kicker}
        onComplete={(result) => onFileDone(view.fileIndex, result)}
        onExit={props.onExit}
        onBackToIndex={() => setView({ kind: "INDEX" })}
      />
    );
  }

  // view.kind === "INDEX" || "COMPLETE": the Archive shelf.
  const isRetry = attemptOrdinal > 1;
  return (
    <div className={`mod mod-archive${props.reducedMotion ? " is-reduced" : ""}`}>
      <div className="mod-cine-room" aria-hidden="true">
        <div className="mod-cine-fog" />
        <div className="mod-cine-grid" />
        <div className="mod-cine-vignette" />
      </div>

      <header className="mod-cine-top mod-archive-top">
        <button type="button" className="mod-cine-leave" onClick={props.onExit}>
          <span aria-hidden="true">←</span> Leave
        </button>
        <div className="mod-cine-title">
          <span className="mod-cine-kicker">
            {isRetry
              ? `Required again · attempt ${attemptOrdinal} of ${MAX_MISSION_ATTEMPTS}`
              : "Required before deployment"}
          </span>
          <span className="mod-cine-name">{definition.title}</span>
        </div>
        <span className="mod-cine-clock">
          {formatModuleClock(elapsed)}
          <span className="mod-cine-xp"> · Pays no XP</span>
        </span>
      </header>

      <div className="mod-archive-shelf" role="list" aria-label="Case files">
        <p className="mod-archive-lede">{definition.subtitle}</p>
        {layout.files.map((file, index) => (
          <ArchiveFileCard
            key={file.card.id}
            file={file}
            status={statuses[index]!}
            onOpen={() => setView({ kind: "FILE", fileIndex: index })}
          />
        ))}

        {layout.brief.length > 0 && (
          <div
            className={`mod-archive-file mod-archive-brief${resolved ? "" : " is-locked"}`}
            role="listitem"
          >
            <div className="mod-archive-file-head">
              <span className="mod-archive-file-ord">›</span>
              <span className="mod-archive-file-kicker">The handoff</span>
              <span className={`mod-archive-file-state state-${resolved ? "ready" : "locked"}`}>
                {resolved ? "Ready" : "Locked"}
              </span>
            </div>
            <p className="mod-archive-file-note">
              {resolved
                ? "Every file read, every question answered. The brief into the mission."
                : "Read every case file first."}
            </p>
            {resolved && (
              <button
                type="button"
                className="mod-archive-play"
                onClick={() => setView({ kind: "BRIEF", at: 0 })}
              >
                Play the handoff
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** One row on the Archive shelf: a case file with its play state. */
function ArchiveFileCard(props: {
  file: ArchiveFile;
  status: ArchiveFileStatus;
  onOpen: () => void;
}) {
  const { file, status } = props;
  const label =
    status === "DONE" ? "Reviewed" : status === "READY" ? "Ready" : "Locked";
  return (
    <div
      className={`mod-archive-file state-${status.toLowerCase()}`}
      role="listitem"
      data-status={status}
    >
      <div className="mod-archive-file-head">
        <span className="mod-archive-file-ord">
          {String(file.ordinal).padStart(2, "0")}
        </span>
        <span className="mod-archive-file-kicker">{file.card.kicker}</span>
        <span className={`mod-archive-file-state state-${status.toLowerCase()}`}>
          {label}
        </span>
      </div>
      <p className="mod-archive-file-note">{file.card.body[0]}</p>
      {status !== "LOCKED" && (
        <button type="button" className="mod-archive-play" onClick={props.onOpen}>
          {status === "DONE" ? "Replay file" : "Play file"}
        </button>
      )}
    </div>
  );
}
