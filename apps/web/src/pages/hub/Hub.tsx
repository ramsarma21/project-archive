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
import { useProgression, type DeployStanding } from "../../progression/index.js";
import { CodexOverlay } from "../../codex/CodexOverlay.js";
import "./hub.css";

/**
 * The Deploy button's word when it cannot open the operation. Threaded from the
 * server-backed standing so the button is actually disabled and states why —
 * "Sign in to deploy" for the preview, "Attempt open" while a run is unfinished —
 * rather than looking enabled and having `requestDeploy` quietly refuse.
 */
function deployButtonLabel(standing: DeployStanding | null): string {
  if (!standing || standing.deployable) return "Deploy";
  switch (standing.reason) {
    case "LOCKED":
      return "Locked";
    case "SPENT":
      return "Spent";
    case "SIGN_IN_REQUIRED":
      return "Sign in to deploy";
    case "INTERRUPTED":
      return "Attempt open";
    case "UNKNOWN":
      return "Reconnecting…";
  }
}

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
export function Hub(props: {
  reducedMotion: boolean;
  onExit: () => void;
  /** Opens the duelling ground. PvP owns its own lobby and authentication. */
  onEnterDuellingGround: () => void;
}) {
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
  // A forfeit is a round trip; the button says so and cannot be double-fired.
  const [forfeiting, setForfeiting] = useState(false);
  // The Codex overlay, opened from the top bar. UI only; it never opens a mission.
  const [codexOpen, setCodexOpen] = useState(false);
  const openAttempt = progression.view.openAttempt;
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
  // The server-backed standing for whatever the panel is showing. This is what
  // decides whether Deploy is live — a signed-out preview or an open attempt
  // disables it — rather than the map node's cosmetic status.
  const shownStanding = shown ? progression.standing(shown.id) : null;

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
            <div className="hub-topbar-actions">
              <button type="button" className="hub-back" onClick={props.onExit}>
                <span aria-hidden="true">←</span> Leave hub
              </button>
              {/* The one door to PvP from the game itself: a real button, so it is
                  reachable by keyboard and screen reader. The duelling ground owns
                  its own lobby and authentication, so this only opens the screen. */}
              {/* Opens the Codex — the index of every card a duel can ask. A real
                  button beside the duelling-ground entry, so it is reachable by
                  keyboard and screen reader. It opens a UI overlay only. */}
              <button
                type="button"
                className="hub-back hub-codex-open"
                onClick={() => setCodexOpen(true)}
              >
                <span aria-hidden="true">◇</span> Codex
              </button>
              <button
                type="button"
                className="hub-back hub-duelling-ground"
                onClick={props.onEnterDuellingGround}
              >
                Duelling ground <span aria-hidden="true">→</span>
              </button>
            </div>
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

          {/* An attempt the server still holds open. It is NOT resumed — the
              runtime restarts from the top while the durable attempt keeps its
              progress, which is the unlimited-replay bug this state exists to
              close. The one way forward is to forfeit it, which spends the
              attempt honestly; Deploy on that mission stays closed until then. */}
          {openAttempt && (
            <div className="hub-interrupted" role="alert">
              <div className="hub-interrupted-copy">
                <strong>An attempt is still open.</strong> A run you left
                unfinished is still counted. It cannot be resumed — retrying starts
                a fresh run — so forfeit it to continue. Forfeiting spends the
                attempt.
              </div>
              <button
                type="button"
                className="hub-back hub-interrupted-forfeit"
                disabled={forfeiting}
                onClick={() => {
                  setForfeiting(true);
                  void progression
                    .forfeitInterruptedAttempt()
                    .finally(() => setForfeiting(false));
                }}
              >
                {forfeiting
                  ? "Forfeiting…"
                  : "Forfeit interrupted attempt and retry"}
              </button>
            </div>
          )}

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
                canDeploy={shownStanding?.deployable ?? false}
                deployLabel={deployButtonLabel(shownStanding)}
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

      {/* The Codex overlay floats above the hub. It reads the server-backed codex
          standing and mutates nothing — a signed-out preview holds no cards, so it
          shows definitions without ever claiming one was learned. */}
      <CodexOverlay
        open={codexOpen}
        onClose={() => setCodexOpen(false)}
        codex={progression.view.codex}
        reducedMotion={props.reducedMotion}
      />
    </div>
  );
}
