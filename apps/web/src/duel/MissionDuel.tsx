import { useCallback, useMemo, useRef } from "react";
import type { DuelEvent, DuelOutcome } from "@pa/duel";
import type { MissionDuelViewProps } from "../mission/duelPort.js";
import { ArenaView } from "./ArenaView.js";
import { DuelScreen } from "./DuelScreen.js";
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
// here is the shell around it: build the descriptor from the brief and turn the
// screen's resolution into the report the container is waiting for.
//
// The arena is NO LONGER passed here. Entering the duel is a transition into the
// shared rope-walk yard, so `missionDuelDescriptor` builds the descriptor from
// `yardArena()` and this screen lets `DuelStage` fall back to its default
// `ArenaView` — the stand-alone yard's own visible form, drawn from the same
// `YARD_COVER` its blockers are compiled from. That is what makes the fight entered
// from the mission look like the scripted `?verdict=live` modes rather than a slice
// of Boston carved around the fight.
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

  // When the container passes a time of day, light the yard from it via the
  // arena's own `ArenaView` through DuelStage's existing `Scenery` seam — the
  // one built for "a mission whose arena is not the stand-alone yard". This
  // draws the identical yard (ground, wall, dressing, default cover) in the
  // mission's pre-dawn palette, so cutscene→duel is continuous. Absent, no
  // Scenery is passed and the stand-alone daylight arena is unchanged.
  const sky = props.sky;
  const MissionArena = useMemo(
    () =>
      sky
        ? function MissionArena({ reducedMotion }: { reducedMotion: boolean }) {
            return <ArenaView sky={sky} reducedMotion={reducedMotion} />;
          }
        : undefined,
    [sky],
  );

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
  //
  // No `Scenery`: the descriptor's arena is the shared yard, so `DuelStage` draws
  // its default `ArenaView`, whose cover is the very list the arena's blockers were
  // built from.
  return (
    <DuelScreen
      descriptor={descriptor}
      reducedMotion={props.reducedMotion}
      {...(MissionArena ? { Scenery: MissionArena } : {})}
      onRuntime={onRuntime}
      onResolved={resolve}
    />
  );
}
