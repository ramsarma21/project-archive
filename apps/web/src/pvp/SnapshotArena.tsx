import { useEffect, useMemo } from "react";
import { duelControls } from "../duel/duelInput.js";
import { ArenaStage } from "./ArenaStage.js";
import { createSnapshotFeed } from "./arenaFeed.js";
import type { PvpArenaViewProps } from "./arenaPort.js";

// The picture of the fight.
//
// This is what `arenaPort.ts` asked for and nothing more: a component handed the
// latest authoritative snapshot that draws it and reports aim back. There is no
// reducer here, no `stepCombat`, no predicted health and no local hit. Every position
// on screen is one the API process reported, or a point on the straight line between
// two positions it reported — see `arenaFeed.ts` for why interpolating backwards is
// the only smoothing a client without reconciliation is entitled to.
//
// It deliberately reports only aim and camera yaw upward. Aim because the pointer is
// resolved against the drawn scene and no other layer can produce it; camera yaw
// because movement is camera-relative in every mode and the camera lives here. Both
// are inputs. Neither is a claim about the fight.
//
// A NEW MATCH GETS A NEW FEED. The feed holds two snapshots and a set of ball ids it
// has already seen, so carrying it across matches would open the next duel comparing
// its first snapshot against the last one of the previous fight — a phantom hit, from
// health that "fell" because it belongs to a different match.

export function SnapshotArena(props: PvpArenaViewProps) {
  const { snapshot } = props;
  const feed = useMemo(() => createSnapshotFeed(), [snapshot.matchId]);

  useEffect(() => {
    feed.observe(snapshot, performance.now());
  }, [feed, snapshot]);

  const outOfSight = !snapshot.opponent.visible;
  const hints = useMemo(
    () => duelControls(Object.keys(snapshot.self.abilityUsesRemaining).length),
    [snapshot.self.abilityUsesRemaining],
  );

  return (
    <div className="pvp-stage">
      <ArenaStage
        source={feed}
        reducedMotion={props.reducedMotion}
        onAim={props.onAim}
        onCameraYaw={props.onCameraYaw}
      />
      {/* Over the arena rather than in the side panel, because this one changes what
          the player should do RIGHT NOW: the shape by the cover is a memory, and
          shooting at it is a wasted ball. */}
      {outOfSight && (
        <div className="pvp-sight" role="status">
          Sight line broken {"\u00b7"} last seen
        </div>
      )}
      <div className="pvp-stage-keys">
        {hints.map((control) => (
          <span key={control.action}>
            <kbd>{control.keys}</kbd> {control.action}
          </span>
        ))}
      </div>
    </div>
  );
}
