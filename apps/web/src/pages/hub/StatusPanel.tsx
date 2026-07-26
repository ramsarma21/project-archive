import {
  LEVELS_PER_RANK,
  levelsToNextRank,
  rankFromCumulativeLevels,
} from "@pa/contracts";
import type { HubState } from "./hubState.js";
import { SystemPanel } from "./SystemPanel.js";

/**
 * Progression readout: one number. Level with its XP bar carries all growth,
 * and missions are the only thing that fills it.
 *
 * Rank shares the panel but is deliberately built as a different kind of object
 * — an outlined chip rather than a lit numeral — because Level starts over every
 * chapter and Rank does not. It is derived rather than awarded, so the caption
 * under it names the only thing that moves it.
 */
export function StatusPanel(props: { state: HubState; delay: number }) {
  const { state } = props;
  const xpPercent = Math.round((state.xp / state.xpToNext) * 100);
  const xpRemaining = state.xpToNext - state.xp;
  const rank = rankFromCumulativeLevels(state.cumulativeLevels);
  const toNextRank = levelsToNextRank(state.cumulativeLevels);

  return (
    <SystemPanel kicker="Runner" title={state.runnerName} from="left" delay={props.delay}>
      <div className="hub-level-block">
        <div className="hub-level-readout">
          <span className="hub-level-tag">Level</span>
          <strong className="hub-level-number">{state.level}</strong>
        </div>
        <div
          className="hub-xp-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={state.xpToNext}
          aria-valuenow={state.xp}
          aria-label="Experience toward the next level"
        >
          <div className="hub-xp-fill" style={{ width: `${xpPercent}%` }}>
            <span className="hub-xp-crest" aria-hidden="true" />
          </div>
        </div>
        <div className="hub-xp-figures">
          <span className="hub-xp-count">
            {state.xp.toLocaleString()} / {state.xpToNext.toLocaleString()} XP
          </span>
          <span className="hub-xp-remaining">{xpRemaining.toLocaleString()} to Level {state.level + 1}</span>
        </div>
      </div>

      <div className="hub-rank-block">
        <div className="hub-rank-head">
          <span className="hub-rank-tag">Rank</span>
          <span className="hub-rank-chip">{rank}</span>
        </div>
        <p className="hub-rank-note">
          {toNextRank} more {toNextRank === 1 ? "Level" : "Levels"} to Rank {rank + 1}.
          One Rank per {LEVELS_PER_RANK} Levels, and it carries between chapters.
        </p>
      </div>
    </SystemPanel>
  );
}
