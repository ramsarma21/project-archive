import type { DuelSide } from "@pa/duel";
import { outcomeLine, type MatchProgress } from "./progress.js";
import { PvpLeaderboard } from "./PvpLeaderboard.js";
import type { MatchResultPayload, PvpTransport } from "./protocol.js";

export interface PvpResultProps {
  readonly result: MatchResultPayload;
  readonly side: DuelSide;
  readonly progress: MatchProgress;
  readonly ownHandle: string | null;
  readonly transport?: PvpTransport;
  readonly onAgain: () => void;
}

export function PvpResult(props: PvpResultProps) {
  const { result, side, progress } = props;
  const yours = side === "A" ? result.healthA : result.healthB;
  const theirs = side === "A" ? result.healthB : result.healthA;

  return (
    <div className="pvp-result">
      <div className="pvp-kicker">Duel resolved</div>
      <h1>{outcomeLine(result.winner, side, result.reason)}</h1>
      <p className="pvp-muted">
        {Math.round(yours)} health left against {Math.round(theirs)}.{" "}
        {progress.rounds.length + 1} rounds fought, {progress.hitsLanded} hits landed,{" "}
        {Math.round(progress.damageDealt)} damage dealt.
      </p>
      {result.tiebreak !== "NONE" && (
        <p className="pvp-muted">Decided on {result.tiebreak.toLowerCase().replace(/_/g, " ")}.</p>
      )}
      {!result.standingApplies && (
        <div className="pvp-note">
          No points moved. {result.needsReview
            ? "This one is logged for review — a true draw is rare enough that it is worth a look."
            : "The result did not qualify for a standing change."}
        </div>
      )}
      <div style={{ width: "min(34rem, 100%)" }}>
        <PvpLeaderboard
          {...(props.transport ? { transport: props.transport } : {})}
          ownHandle={props.ownHandle}
          refreshKey={1}
        />
      </div>
      <div className="pvp-actions">
        <button className="pvp-btn pvp-btn-primary" onClick={props.onAgain}>
          Back to the duelling ground
        </button>
      </div>
    </div>
  );
}
