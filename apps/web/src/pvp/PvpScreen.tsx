import { useEffect, useState } from "react";
import { PvpArena } from "./PvpArena.js";
import { PvpHud } from "./PvpHud.js";
import { PvpLeaderboard } from "./PvpLeaderboard.js";
import { PvpLobby } from "./PvpLobby.js";
import { PvpQuestion } from "./PvpQuestion.js";
import { PvpResult } from "./PvpResult.js";
import { refusalText } from "./refusals.js";
import { usePvpSession } from "./usePvpSession.js";
import type { PresentedSighting } from "./arenaPort.js";
import type { PvpTransport } from "./protocol.js";
import "./pvp.css";

// The whole of PvP, from one component.
//
// Three surfaces and no router: a lobby, a live match, a result. The session hook
// owns every call and every piece of state, so this file is layout and nothing
// else — which is what makes it possible to say with confidence that no screen
// here decides anything about the fight.

export interface PvpScreenProps {
  readonly reducedMotion?: boolean;
  /** Swappable for the netcode agent's transport, and for tests. */
  readonly transport?: PvpTransport;
  /** Rendered as a way out when PvP is mounted inside the app rather than alone. */
  readonly onExit?: () => void;
}

export function PvpScreen(props: PvpScreenProps) {
  const session = usePvpSession(props.transport);
  const reducedMotion = props.reducedMotion ?? false;
  const [handle, setHandle] = useState<string | null>(null);
  // The presented opponent sighting, reported up from the arena so the side-panel HUD
  // warning reads the same delayed sample the drawn body does.
  const [sighting, setSighting] = useState<PresentedSighting>("IN_SIGHT");

  useEffect(() => {
    if (session.phase.name === "HOSTING") setHandle(session.phase.handle);
  }, [session.phase]);

  if (session.phase.name === "RESULT") {
    return (
      <div className="pvp">
        <PvpResult
          result={session.phase.result}
          side={session.phase.side}
          progress={session.progress}
          ownHandle={handle}
          {...(props.transport ? { transport: props.transport } : {})}
          onAgain={session.reset}
        />
      </div>
    );
  }

  if (session.phase.name === "MATCH") {
    const snapshot = session.snapshot;
    if (!snapshot) {
      return (
        <div className="pvp">
          <div className="pvp-lobby">
            <div className="pvp-kicker">Archive // Duelling ground</div>
            <h1>Both runners are on the ground.</h1>
            <p>Reading the first snapshot from the server.</p>
          </div>
        </div>
      );
    }
    const answering =
      snapshot.phase === "QUESTION_PENDING" || snapshot.phase === "VERDICT_COMMITTED";
    return (
      <div className="pvp">
        <div className="pvp-match">
          <div className="pvp-strip">
            <div className="pvp-strip-group">
              {/* No total. A duel runs until a health pool empties. */}
              <span className="pvp-round">Round {snapshot.round}</span>
              <span className="pvp-phase">
                {snapshot.phase.replace(/_/g, " ").toLowerCase()}
              </span>
            </div>
            <div className="pvp-strip-group">
              <span
                className={`pvp-conn ${session.offline ? "pvp-conn-off" : "pvp-conn-ok"}`}
              >
                {session.offline ? "reconnecting" : "live"}
              </span>
              <button className="pvp-btn pvp-btn-danger" onClick={session.forfeit}>
                Forfeit
              </button>
              {props.onExit && (
                <button className="pvp-btn" onClick={props.onExit}>
                  Leave
                </button>
              )}
            </div>
          </div>
          <div className="pvp-body">
            <PvpArena
              snapshot={snapshot}
              reducedMotion={reducedMotion}
              onAim={session.setAim}
              onCameraYaw={session.setCameraYaw}
              bindInput={session.bindInput}
              onOpponentSighting={setSighting}
              progress={session.progress}
            />
            {/* The question/wait/verdict/countdown is a large centered overlay OVER the
                arena and side, in the System's language — not a panel in the narrow
                sidebar. It owns keyboard input while a question is open, and is inert
                otherwise so movement during the resume countdown still reaches the
                canvas. It hides itself once combat resumes. */}
            <PvpQuestion
              question={session.question}
              snapshot={snapshot}
              lastVerdict={session.lastVerdict}
              lastEvidence={session.lastEvidence}
              answering={session.answering}
              reducedMotion={reducedMotion}
              onSubmit={session.submitAnswer}
            />
            {/* The centred question overlay covers the whole body, including this side
                column. Rather than fight it for the same pixels at 1024x692, the side
                withdraws while a question is open: its stats are frozen then and the
                only thing that matters is the overlay. The live health/ammo the player
                still needs live in the arena HUD, which withdraws on the same beat. */}
            <div
              className="pvp-side"
              style={
                answering
                  ? { opacity: 0.12, pointerEvents: "none", transition: "opacity 0.24s ease" }
                  : { transition: "opacity 0.24s ease" }
              }
              aria-hidden={answering}
            >
              {session.error && (
                <div className="pvp-error">{refusalText(session.error)}</div>
              )}
              <PvpHud snapshot={snapshot} progress={session.progress} sighting={sighting} />
              {session.rejected.length > 0 && (
                <div className="pvp-panel">
                  <div className="pvp-panel-title">Refused frames</div>
                  <div className="pvp-rejects">
                    {session.rejected.map((line, index) => (
                      <div key={`${line}-${index}`}>{line}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pvp">
      <PvpLobby
        identity={session.identity}
        hosting={session.phase.name === "HOSTING" ? session.phase : null}
        busy={session.busy}
        error={session.error}
        offline={session.offline}
        onHost={() => void session.host()}
        onJoin={(code) => void session.join(code)}
        onCancel={() => void session.cancel()}
      />
      {session.phase.name === "IDLE" && (
        <div
          style={{
            padding: "0 clamp(1.5rem, 8vw, 9rem) 2.5rem",
            display: "flex",
            justifyContent: "center",
          }}
        >
          <div style={{ width: "min(34rem, 100%)" }}>
            <PvpLeaderboard
              {...(props.transport ? { transport: props.transport } : {})}
              ownHandle={handle}
            />
          </div>
        </div>
      )}
      {props.onExit && (
        <div className="pvp-actions" style={{ paddingBottom: "2rem" }}>
          <button className="pvp-btn" onClick={props.onExit}>
            Leave the duelling ground
          </button>
        </div>
      )}
    </div>
  );
}
