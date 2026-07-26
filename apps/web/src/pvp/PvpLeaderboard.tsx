import { useEffect, useState } from "react";
import { httpPvpTransport, type LeaderboardRow, type PvpTransport } from "./protocol.js";

// The board. Handles, Ranks and points; no names, no classes, no profile ids —
// the server's row type has no field for any of them.
//
// Points are in memory with the rest of PvP state, so a server restart clears the
// board. That is said on the surface rather than left for somebody to discover
// after a good run.

export interface PvpLeaderboardProps {
  readonly transport?: PvpTransport;
  /** Highlights the caller's own row without telling the board who they are. */
  readonly ownHandle?: string | null;
  /** Bumped by the caller after a match so the board refetches. */
  readonly refreshKey?: number;
}

export function PvpLeaderboard(props: PvpLeaderboardProps) {
  const transport = props.transport ?? httpPvpTransport;
  const [rows, setRows] = useState<readonly LeaderboardRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void transport.leaderboard().then((call) => {
      if (cancelled) return;
      if (call.status === "OK") {
        setRows(call.value.rows);
        setFailed(false);
      } else {
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [transport, props.refreshKey]);

  return (
    <div className="pvp-panel">
      <div className="pvp-panel-title">Standing</div>
      {failed && <div className="pvp-waiting pvp-warn">The board could not be read.</div>}
      {rows && rows.length === 0 && (
        <div className="pvp-waiting pvp-muted">
          Nobody has finished a duel yet.
        </div>
      )}
      {rows && rows.length > 0 && (
        <table className="pvp-board">
          <thead>
            <tr>
              <th>#</th>
              <th>Handle</th>
              <th>Rank</th>
              <th>Points</th>
              <th>W</th>
              <th>L</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.handle}
                className={row.handle === props.ownHandle ? "pvp-board-you" : undefined}
              >
                <td>{row.position}</td>
                <td>{row.handle}</td>
                <td>{row.rank}</td>
                <td>{row.points}</td>
                <td>{row.wins}</td>
                <td>{row.losses}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="pvp-waiting pvp-muted">
        A win takes 20 points and a loss gives up 12, floored at zero. Standing lives
        in memory for now, so restarting the API clears the board.
      </div>
    </div>
  );
}
