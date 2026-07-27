import { useEffect, useMemo, useState } from "react";
import { ArenaStage } from "./ArenaStage.js";
import { createSnapshotFeed, type OpponentSighting } from "./arenaFeed.js";
import { createPvpLookState } from "./pvpLook.js";
import type { PvpArenaViewProps } from "./arenaPort.js";

/** Phases where the player is steering, so held look input is legitimate. */
function playablePhase(phase: string): boolean {
  return (
    phase === "ENGAGEMENT_LIVE" ||
    phase === "FACE_OFF" ||
    phase === "BULLETS_GRANTED" ||
    phase === "LINE_OF_SIGHT_BREAK" ||
    phase === "ROUND_RESOLVED"
  );
}

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
// A NEW MATCH GETS A NEW FEED. The feed holds a tick-sorted buffer of recent snapshots
// and a cue journal derived from them, so carrying it across matches would bracket the
// next duel's first snapshot against the last one of the previous fight — a phantom hit,
// from health that "fell" because it belongs to a different match.

export function SnapshotArena(props: PvpArenaViewProps) {
  const { snapshot } = props;
  const feed = useMemo(() => createSnapshotFeed(), [snapshot.matchId]);
  // The look is owned here, not in the canvas, so it survives every re-render and one
  // value drives the camera, the movement basis and the aim. A new match gets a new
  // look, seeded from that match's first authoritative aim.
  const look = useMemo(() => createPvpLookState(), [snapshot.matchId]);

  useEffect(() => {
    feed.observe(snapshot, performance.now());
  }, [feed, snapshot]);

  // The look collects input only while the player is steering. A question disables it
  // — which neutralizes held/pending travel and drops the pointer lock so the answer
  // box is reachable — and it re-enables cleanly, from the same yaw, when play resumes.
  const lookEnabled = playablePhase(snapshot.phase);

  // The banner reads the DELAYED presentation sample, not the newest raw snapshot, so it
  // agrees with the drawn body about when the opponent is out of sight. `ArenaStage`
  // reports the sighting kind up whenever the presented value changes; a fresh match
  // starts in sight until the feed says otherwise.
  const [sightingKind, setSightingKind] = useState<OpponentSighting["kind"]>("IN_SIGHT");
  useEffect(() => {
    setSightingKind("IN_SIGHT");
    props.onOpponentSighting?.("IN_SIGHT");
  }, [snapshot.matchId, props.onOpponentSighting]);
  // One presented value drives both this in-arena banner AND the side-panel HUD warning:
  // it is set locally and forwarded up through the arena's own callback.
  const onSighting = (kind: OpponentSighting["kind"]): void => {
    setSightingKind(kind);
    props.onOpponentSighting?.(kind);
  };
  const outOfSight = sightingKind !== "IN_SIGHT";

  return (
    <div className="pvp-stage">
      <ArenaStage
        source={feed}
        reducedMotion={props.reducedMotion}
        look={look}
        lookEnabled={lookEnabled}
        bindInput={props.bindInput}
        onAim={props.onAim}
        onCameraYaw={props.onCameraYaw}
        onOpponentSighting={onSighting}
      />
      {/* Over the arena rather than in the side panel, because this one changes what
          the player should do RIGHT NOW: the shape by the cover is a memory, and
          shooting at it is a wasted ball. */}
      {outOfSight && (
        <div className="pvp-sight" role="status">
          Sight line broken {"\u00b7"} last seen
        </div>
      )}
      {/* The controls legend now lives in the shared combat HUD (top-left, hold-Tab),
          so the always-on key strip that used to sit here is gone — one legend, one
          language across both modes. */}
    </div>
  );
}
