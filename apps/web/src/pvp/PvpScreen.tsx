import { useEffect, useState } from "react";
import { PvpArena } from "./PvpArena.js";
import { PvpHud } from "./PvpHud.js";
import { PvpLeaderboard } from "./PvpLeaderboard.js";
import { PvpLobby } from "./PvpLobby.js";
import { PvpQuestion } from "./PvpQuestion.js";
import { PvpResult } from "./PvpResult.js";
import { refusalText } from "./refusals.js";
import { usePvpSession } from "./usePvpSession.js";
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
            />
            <div className="pvp-side">
              {session.error && (
                <div className="pvp-error">{refusalText(session.error)}</div>
              )}
              <PvpQuestion
                question={session.question}
                snapshot={snapshot}
                lastVerdict={session.lastVerdict}
                answering={session.answering}
                onSubmit={session.submitAnswer}
              />
              <PvpHud snapshot={snapshot} progress={session.progress} />
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
