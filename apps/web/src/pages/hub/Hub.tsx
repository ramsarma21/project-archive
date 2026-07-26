import { useCallback, useMemo, useState } from "react";
import { AssessmentPanel } from "./AssessmentPanel.js";
import { HubStage } from "./HubStage.js";
import { MissionMap } from "./MissionMap.js";
import { SystemPanel } from "./SystemPanel.js";
import { StatusPanel } from "./StatusPanel.js";
import { useTurntable } from "./turntable.js";
import {
  hubSaveNote,
  hubStateFrom,
  missionNodesFor,
  nodeById,
} from "./hubState.js";
import {
  BOSTON_CHAPTER_ID,
  BOSTON_SLATE,
  missionUnlocked,
} from "../../chapter/bostonChapter.js";
import { MissionDeck, useMissionSession } from "../../mission/index.js";
import { useProgression } from "../../progression/index.js";
import "./hub.css";

/**
 * The hub: where the player is quantified and where operations are launched.
 *
 * Every number on screen is the server's. `useProgression` discovers the
 * signed-in profile itself and returns the projected snapshot, so the hub takes
 * no progression props and holds no counter of its own — there is no XP, no
 * Level and no attempt tally computed anywhere in this file. What the hub does
 * own is the selection, the turntable, and which panel is on screen.
 *
 * Deploy is not presentation either. It opens a mission session, which owns two
 * rules the hub cannot bend: a mission is unreachable until its 3-minute module
 * is complete for the attempt being opened, and that attempt is opened by the
 * server rather than by this browser. The hub hands Deploy to the session and
 * hides its own chrome while the session holds the foreground.
 */
export function Hub(props: { reducedMotion: boolean; onExit: () => void }) {
  const progression = useProgression({
    chapterId: BOSTON_CHAPTER_ID,
    isRouteOpen: missionUnlocked,
  });
  const state = hubStateFrom({
    view: progression.view,
    runnerName: progression.runnerName,
  });

  // One render, on the first real drag, to retire the affordance. The spin
  // itself never touches state — see turntable.ts.
  const [hasDragged, setHasDragged] = useState(false);
  const onFirstDrag = useCallback(() => setHasDragged(true), []);
  const turntable = useTurntable({ onFirstDrag });

  const nodes = useMemo(
    () =>
      missionNodesFor({
        slate: BOSTON_SLATE,
        view: progression.view,
        isRouteOpen: missionUnlocked,
      }),
    [progression.view],
  );

  // Selection follows the route: the first operation still open is what a
  // returning player is looking for, and it moves as they clear the chapter.
  const openId = useMemo(
    () => nodes.find((node) => node.status !== "LOCKED")?.id ?? null,
    [nodes],
  );
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const selectedId = pinnedId ?? openId;
  // Hover/focus previews the assessment without moving the committed selection.
  const [previewId, setPreviewId] = useState<string | null>(null);
  const shown = nodeById(nodes, previewId ?? selectedId);

  const session = useMissionSession({
    chapterId: BOSTON_CHAPTER_ID,
    // Route open AND the server says attempts remain. Both, from one answer.
    isUnlocked: progression.isUnlocked,
    profileSeedHex: progression.profileSeedHex,
    // Server truth for how many attempts a mission has spent, so the deck
    // offers the right ordinal on a machine that has never seen this profile.
    tallies: progression.tallies,
    // The round trip that opens the attempt. Supplying it is what makes a run
    // ranked: no durable row, no mission.
    authorizeAttempt: progression.authorize,
    onResult: (result) => {
      void progression.recordResult(result);
    },
  });

  return (
    <div className="hub">
      {/* The stage is the backdrop; the panels float over it. The drag surface
          spans the whole stage so a spin can start anywhere the room is
          visible — the panels above it opt back into hit testing individually
          (see the pointer-events rules in hub.css), which is what keeps an
          empty column from swallowing a drag aimed at the character. */}
      <div className="hub-stage">
        <HubStage
          spin={turntable.spin}
          reducedMotion={props.reducedMotion}
          hidden={session.isForeground}
        />
        <div
          className="hub-drag-surface"
          {...turntable.surfaceHandlers}
          aria-hidden="true"
        />
        <div className="hub-vignette" aria-hidden="true" />
      </div>

      {/* A session replaces the hub's foreground rather than floating over it.
          The room stays visible behind — the stage holds no focusable elements —
          so the deck is the only thing on the screen a Tab can reach, and no
          focus trap is needed to keep a keyboard reader inside it. */}
      {!session.isForeground && (
        <>
          <header className="hub-topbar">
            <button type="button" className="hub-back" onClick={props.onExit}>
              <span aria-hidden="true">←</span> Leave hub
            </button>
            <div className="hub-topbar-title">
              <span className="hub-sigil" aria-hidden="true">◈</span>
              <span className="hub-wordmark">THE SYSTEM</span>
            </div>
            {/* Never silently wrong about persistence: signed out, showing a
                cached picture and holding undelivered results each read
                differently, because they mean different things to a student. */}
            <span className="hub-topbar-note">
              {hubSaveNote({
                unranked: progression.unranked,
                stale: progression.source === "CACHE",
                unsyncedOutcomes: progression.unsyncedOutcomes,
              })}
            </span>
          </header>

          <div className="hub-layout">
            <div className="hub-col hub-col-left">
              <StatusPanel state={state} delay={0.06} />
            </div>

            <div className="hub-col hub-col-right">
              <SystemPanel
                kicker="Operations"
                title="Mission Map"
                from="right"
                delay={0.12}
                className="hub-panel-map"
              >
                <MissionMap
                  nodes={nodes}
                  selectedId={selectedId}
                  onSelect={setPinnedId}
                  onPreview={setPreviewId}
                />
              </SystemPanel>

              <AssessmentPanel
                mission={shown}
                preview={previewId !== null && previewId !== selectedId}
                delay={0.22}
                reducedMotion={props.reducedMotion}
                onDeploy={session.requestDeploy}
              />
            </div>
          </div>

          {/* A hint, not a control: the turntable is a decorative viewer, drag
              is its only input, and nothing is gated behind it. It retires
              itself once the player has found the gesture. */}
          <div className="hub-stage-footer" aria-hidden="true">
            <div className={`hub-rotate${hasDragged ? " is-retired" : ""}`}>
              <span className="hub-rotate-glyph">⟲</span>
              <span className="hub-rotate-copy">Drag to rotate</span>
            </div>
          </div>

        </>
      )}

      {/* Everything between pressing Deploy and returning with a result lives in
          the deck, including the mandatory module. Mounting it unconditionally
          is deliberate: the deck decides its own visibility from the session
          phase, so there is exactly one route into a mission. */}
      <MissionDeck session={session} reducedMotion={props.reducedMotion} />
    </div>
  );
}
