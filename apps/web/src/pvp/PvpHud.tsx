// Explicit React runtime import. PvpHud is the one arena HUD component rendered directly
// by the behavioral parity tests (outside the R3F canvas), so the JSX it emits must have
// React in scope under the test/runtime JSX configuration, not only the automatic runtime.
import React from "react";
import { convergence, type MatchProgress } from "./progress.js";
import type { PresentedSighting } from "./arenaPort.js";
import type { MatchSnapshot } from "./protocol.js";

// The answer to "is this fight going anywhere".
//
// There is no round total and there is no clock. A duel runs until a health pool
// empties, so the honest progress indicators are the health itself, the direction
// it is moving, and the rate — all measured from successive snapshots rather than
// assumed from a constant. See progress.ts for why nothing here is looked up.

function Bar(props: {
  readonly className: string;
  readonly fraction: number;
}) {
  const width = `${Math.max(0, Math.min(1, props.fraction)) * 100}%`;
  return (
    <div className={`pvp-bar ${props.className}`}>
      <div className="pvp-bar-fill" style={{ width }} />
    </div>
  );
}

/**
 * The swing bar. Centre is even; the fill grows toward whichever side is ahead.
 * One glance answers the question a round counter used to answer badly.
 */
function Swing(props: { readonly advantage: number }) {
  const clamped = Math.max(-1, Math.min(1, props.advantage));
  const magnitude = Math.abs(clamped) / 2;
  const ahead = clamped >= 0;
  return (
    <div
      className="pvp-swing"
      role="img"
      aria-label={
        Math.abs(clamped) < 0.02
          ? "Health is even"
          : ahead
            ? `You are ahead on health by ${Math.round(Math.abs(clamped) * 100)} percent`
            : `You are behind on health by ${Math.round(Math.abs(clamped) * 100)} percent`
      }
    >
      <div className="pvp-swing-mid" />
      <div
        className={`pvp-swing-fill ${ahead ? "pvp-swing-ahead" : "pvp-swing-behind"}`}
        style={{
          left: ahead ? "50%" : `${50 - magnitude * 100}%`,
          width: `${magnitude * 100}%`,
        }}
      />
    </div>
  );
}

export interface PvpHudProps {
  readonly snapshot: MatchSnapshot;
  readonly progress: MatchProgress;
  /**
   * The PRESENTED opponent sighting, from the same delayed `ArenaSample` the body is
   * drawn from. The "lost sight" warning reads THIS so it agrees with the arena; when
   * absent (no registered arena view) it falls back to the raw snapshot's flag.
   */
  readonly sighting?: PresentedSighting;
}

export function PvpHud(props: PvpHudProps) {
  const { snapshot, progress } = props;
  const reading = convergence(progress);
  const opponent = snapshot.opponent;
  // Presented sighting when the arena is reporting it, raw only as the telemetry fallback.
  const outOfSight = props.sighting ? props.sighting !== "IN_SIGHT" : !opponent.visible;

  return (
    <div className="pvp-panel">
      <div className="pvp-panel-title">The fight</div>

      <div className="pvp-fighters">
        <div className="pvp-fighter">
          <div className="pvp-fighter-line">
            <span className="pvp-fighter-name">You</span>
            <span>
              {Math.round(snapshot.self.health)} hp · {snapshot.self.ammo} loaded
            </span>
          </div>
          <Bar className="pvp-bar-self" fraction={reading.selfFraction} />
        </div>
        <div className="pvp-fighter">
          <div className="pvp-fighter-line">
            <span className="pvp-fighter-name">
              {opponent.handle} · Rank {opponent.rank}
            </span>
            <span>
              {Math.round(opponent.health)} hp · {opponent.ammo} loaded
            </span>
          </div>
          <Bar className="pvp-bar-opponent" fraction={reading.opponentFraction} />
        </div>
        <Swing advantage={reading.advantage} />
      </div>

      <div className="pvp-stats">
        <div className="pvp-stat">
          <span className="pvp-stat-label">Damage dealt</span>
          <span className="pvp-stat-value">{Math.round(progress.damageDealt)}</span>
        </div>
        <div className="pvp-stat">
          <span className="pvp-stat-label">Damage taken</span>
          <span className="pvp-stat-value">{Math.round(progress.damageTaken)}</span>
        </div>
        <div className="pvp-stat">
          <span className="pvp-stat-label">Hits landed</span>
          <span className="pvp-stat-value">{progress.hitsLanded}</span>
        </div>
        <div className="pvp-stat">
          <span className="pvp-stat-label">Hits taken</span>
          <span className="pvp-stat-value">{progress.hitsTaken}</span>
        </div>
        <div className="pvp-stat">
          <span className="pvp-stat-label">This round, dealt</span>
          <span className="pvp-stat-value">
            {Math.round(progress.currentRoundDealt)}
          </span>
        </div>
        <div className="pvp-stat">
          <span className="pvp-stat-label">This round, taken</span>
          <span className="pvp-stat-value">
            {Math.round(progress.currentRoundTaken)}
          </span>
        </div>
      </div>

      {/* Measured, not looked up, and labelled as an estimate because it is one. */}
      {reading.hitsToFinish !== null ? (
        <div className="pvp-waiting">
          At the rate you have been hitting, about{" "}
          <b>
            {reading.hitsToFinish} more clean{" "}
            {reading.hitsToFinish === 1 ? "hit" : "hits"}
          </b>{" "}
          finishes this.
          {reading.hitsToSurvive !== null && (
            <>
              {" "}
              You can take about {reading.hitsToSurvive} more.
            </>
          )}
          {reading.closing && <> {"\u2014"} it is nearly over.</>}
        </div>
      ) : (
        <div className="pvp-waiting">
          Nobody has landed a shot yet. The duel ends when one side's health reaches
          zero, however many rounds that takes.
        </div>
      )}

      {outOfSight && (
        <div className="pvp-waiting pvp-muted">
          You have lost sight of {opponent.handle}. Their marker is where they were
          last seen, not where they are.
        </div>
      )}
    </div>
  );
}
