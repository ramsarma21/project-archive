import { useCallback, useMemo, useRef } from "react";
import type { DuelEvent, DuelOutcome } from "@pa/duel";
import type { MissionDuelViewProps } from "../mission/duelPort.js";
import { DuelScreen } from "./DuelScreen.js";
import { MissionArenaView } from "./missionArena.js";
import {
  missionCast,
  missionDuelDescriptor,
  missionDuelReport,
} from "./missionBrief.js";
import type { VerdictReceipt } from "./duelGrading.js";
import type { DuelRuntime } from "./duelRuntime.js";
import "./duel.css";

// The mission's duel, on screen.
//
// The translation both ways lives in missionBrief.ts, which is pure. What is left
// here is the shell around it: build the descriptor from the brief, hand the screen
// the arena the mission actually fights in, and turn the screen's resolution into
// the report the container is waiting for.
//
// Everything that matters about the fight is `DuelScreen`'s and unchanged — the
// runtime, the input, the round of asking and committing, the grading authority —
// so what a player fights through the mission is the same fight the dev harness
// screenshotted before this landed. There is no mission-only path through the core,
// and there is nothing here that could grant a bullet.

/**
 * The duel this directory cannot dress, said out loud.
 *
 * The same shape as the container's own `DuelUnavailable`: one way out and it is a
 * loss, because a surface that hands back a win for a fight nobody had is a surface
 * that hands out XP. Nothing here fabricates a cast.
 */
function CastMissing(props: {
  missionId: string;
  attemptOrdinal: number;
  onAbandon: (reason: string) => void;
}) {
  return (
    <div className="duel">
      <div className="duel-beats">
        <div className="duel-panel duel-question">
          <span className="duel-kicker">Duel armed · no cast</span>
          <p className="duel-prompt">
            {props.missionId} reached its duel on attempt {props.attemptOrdinal} and
            no cast is registered for it. There is no rig to put in the yard and one
            will not be invented, so leaving here spends the attempt.
          </p>
          <div className="duel-question-foot">
            <button
              type="button"
              className="duel-submit"
              onClick={() => props.onAbandon(`no duel cast for ${props.missionId}`)}
            >
              Concede the attempt
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MissionDuel(props: MissionDuelViewProps) {
  const { brief, missionId, onResolved } = props;
  const cast = useMemo(() => missionCast(missionId), [missionId]);

  const descriptor = useMemo(
    () => (cast ? missionDuelDescriptor(brief, cast) : null),
    [brief, cast],
  );

  // The arena's visible form, bound to the brief's own world. A component rather
  // than an element because that is what the stage takes, and memoised because
  // `DuelScreen` rebuilds its runtime whenever the descriptor changes and
  // re-renders on every HUD change.
  const Scenery = useMemo(() => {
    const world = brief.world;
    return function ArenaScenery(scenery: { reducedMotion: boolean }) {
      return <MissionArenaView world={world} reducedMotion={scenery.reducedMotion} />;
    };
  }, [brief.world]);

  // Held so the report can read the core's own engagement clock at the moment the
  // duel resolves. `DuelScreen` hands the runtime over once.
  const runtime = useRef<DuelRuntime | null>(null);
  const onRuntime = useCallback((live: DuelRuntime) => {
    runtime.current = live;
  }, []);

  const resolve = useCallback(
    (
      outcome: DuelOutcome,
      commitLog: readonly DuelEvent[],
      receipts: readonly VerdictReceipt[],
    ) => {
      onResolved(
        missionDuelReport({
          brief,
          outcome,
          commitLog,
          engagementTicks: runtime.current?.getState().engagementTicks ?? 0,
          // The server's proof for the rounds it graded, carried to the commit so
          // `commitReceipts.ts` can authenticate them instead of counting them
          // unsigned.
          receipts,
        }),
      );
    },
    [brief, onResolved],
  );

  if (!descriptor) {
    return (
      <CastMissing
        missionId={missionId}
        attemptOrdinal={props.attemptOrdinal}
        onAbandon={props.onAbandon}
      />
    );
  }

  // No `onExit` and no `onAgain`. The container takes the screen the moment the
  // report lands, and a retry is a fresh attempt through the module rather than a
  // button on an outcome panel.
  return (
    <DuelScreen
      descriptor={descriptor}
      Scenery={Scenery}
      reducedMotion={props.reducedMotion}
      onRuntime={onRuntime}
      onResolved={resolve}
    />
  );
}
