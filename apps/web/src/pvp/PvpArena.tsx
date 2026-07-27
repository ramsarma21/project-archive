import { useEffect, useMemo, useState } from "react";
import { duelView } from "../mission/duelPort.js";
import { DUEL_CONTROLS, duelControls } from "../duel/duelInput.js";
import { useControlsLegend } from "../duel/controlsLegend.js";
import { CombatHud } from "../duel/CombatHud.js";
import {
  ammoReadout,
  observeRoundAmmo,
  type AmmoRoundTracker,
} from "../duel/combatHudModel.js";
import { PLAYER_RIG } from "../duel/m1Duel.js";
import { pvpArenaMode, pvpArenaView, type PresentedSighting } from "./arenaPort.js";
import type { MatchProgress } from "./progress.js";
import type { MatchSnapshot } from "./protocol.js";

/** Phases where the fight is frozen on a question and the HUD withdraws. */
function isAnsweringPhase(phase: string): boolean {
  return phase === "QUESTION_PENDING" || phase === "VERDICT_COMMITTED";
}

// The picture of the fight, or an honest statement that there is not one yet.
//
// Two registries are consulted and they are not the same question:
//
//   `pvpArenaView()`  — a renderer that draws THE SERVER'S SNAPSHOT. This is what
//                       PvP needs, and mounting it is the whole job here.
//   `duelView()`      — the mission container's registry, which installs a view
//                       that RUNS a duel from a brief. It is read only to report
//                       whether the duel visuals have landed at all, because that
//                       is the milestone the reader is waiting on. It is never
//                       mounted here: it would start a second simulation in the
//                       browser, and a browser that simulates a ranked match is
//                       exactly what the server authority exists to prevent.
//
// While no arena view is registered this renders the authoritative telemetry and
// says plainly that the fight is running on the server. It does not draw a
// stand-in duel. A fabricated arena is indistinguishable from a real one in a
// screenshot, so it would be believed, and the first person to believe it would be
// the person deciding whether PvP is ready.

export interface PvpArenaProps {
  readonly snapshot: MatchSnapshot;
  readonly reducedMotion: boolean;
  readonly onAim: (x: number, z: number) => void;
  readonly onCameraYaw: (yaw: number) => void;
  readonly bindInput: (canvas: HTMLElement) => () => void;
  /** The presented opponent sighting, reported up for the HUD's "lost sight" warning. */
  readonly onOpponentSighting?: (kind: PresentedSighting) => void;
  /**
   * Observed match progress, for the HUD's health denominators. PvP snapshots carry no
   * maximum, so — exactly as `progress.ts` does for the side panel — the max is the
   * high-water mark each pool has been seen at, never an assumed constant.
   */
  readonly progress?: MatchProgress;
}

function metres(value: number): string {
  return value.toFixed(1);
}

export function PvpArena(props: PvpArenaProps) {
  const { snapshot, progress } = props;
  const View = pvpArenaView();

  // The round's magazine, observed rather than assumed: the peak ammo this round has
  // shown. A new round resets it. This is the "total" the Cassidy-style ammo reads
  // against — the snapshot carries only the current count.
  const [ammoTracker, setAmmoTracker] = useState<AmmoRoundTracker>(() => ({
    round: snapshot.round,
    magazine: snapshot.self.ammo,
  }));
  useEffect(() => {
    setAmmoTracker((tracker) =>
      observeRoundAmmo(tracker, snapshot.round, snapshot.self.ammo),
    );
  }, [snapshot.round, snapshot.self.ammo]);

  const answering = isAnsweringPhase(snapshot.phase);
  const controlsHeld = useControlsLegend(!answering);
  const controlItems = useMemo(
    () => duelControls(Object.keys(snapshot.self.abilityUsesRemaining).length),
    [snapshot.self.abilityUsesRemaining],
  );

  if (pvpArenaMode(View !== null) === "VIEW" && View) {
    const selfMax = Math.max(progress?.selfHealthMax ?? 0, snapshot.self.health, 1);
    const opponentMax = Math.max(
      progress?.opponentHealthMax ?? 0,
      snapshot.opponent.health,
      1,
    );
    return (
      <div className="pvp-arena pvp-arena-live">
        <View
          snapshot={snapshot}
          reducedMotion={props.reducedMotion}
          onAim={props.onAim}
          onCameraYaw={props.onCameraYaw}
          bindInput={props.bindInput}
          {...(props.onOpponentSighting ? { onOpponentSighting: props.onOpponentSighting } : {})}
        />
        {/* The shared combat HUD, overlaid on the arena. Each side sees its OWN health
            and ammo in the player cluster and the OPPONENT's in the enemy display —
            both already exposed by the projection, so nothing extra leaks. */}
        <CombatHud
          self={{
            name: "You",
            weaponLabel: "Flintlock",
            glbKey: PLAYER_RIG,
            health: snapshot.self.health,
            maxHealth: selfMax,
            ammo: ammoReadout(snapshot.self.ammo, ammoTracker.magazine),
          }}
          enemy={{
            name: snapshot.opponent.handle,
            role: `Rank ${snapshot.opponent.rank}`,
            health: snapshot.opponent.health,
            maxHealth: opponentMax,
          }}
          round={snapshot.round}
          withdrawn={answering}
          showReticle
          controls={{ items: controlItems, held: controlsHeld }}
          reducedMotion={props.reducedMotion}
        />
      </div>
    );
  }

  const duelVisualsLanded = duelView() !== null;

  return (
    <div className="pvp-arena">
      <div className="pvp-pending">
        <div className="pvp-kicker">Arena view not registered</div>
        <h2>The duel is running on the server. There is no picture of it yet.</h2>
        <p className="pvp-muted">
          Everything below is the authority's own snapshot, polled live. Your keys are
          attached and your intent frames are being accepted — movement, fire and dodge
          all reach the simulation. What is missing is the registration, and nothing
          here invents a picture in its place.
        </p>
        <div className="pvp-note">
          The renderer exists: <code>installPvpArena()</code> registers it, and the
          entry point that mounted this screen has not called it. Everything below is
          still true and still live — this surface is what an unregistered arena looks
          like, and it draws no stand-in fight.
          {duelVisualsLanded && (
            <>
              {" "}
              The mission container's duel view is registered, and it is still not what
              goes here: it is brief-driven and runs its own duel, and a second
              simulation in the browser is what the server authority exists to prevent.
            </>
          )}
        </div>

        <div className="pvp-telemetry">
          <div>
            <span>Phase</span>
            {snapshot.phase.replace(/_/g, " ").toLowerCase()}
          </div>
          <div>
            <span>Tick</span>
            {snapshot.tick}
          </div>
          <div>
            <span>You</span>
            {metres(snapshot.self.position.x)}, {metres(snapshot.self.position.z)}
            {snapshot.self.dashing ? " · dashing" : ""}
          </div>
          <div>
            <span>{snapshot.opponent.handle}</span>
            {metres(snapshot.opponent.position.x)},{" "}
            {metres(snapshot.opponent.position.z)}
            {snapshot.opponent.visible ? "" : " · last seen"}
          </div>
          <div>
            <span>Balls in flight</span>
            {snapshot.projectiles.length}
          </div>
          <div>
            <span>Line of sight</span>
            {snapshot.opponent.visible ? "clear" : "broken"}
          </div>
        </div>

        <div className="pvp-keys">
          {DUEL_CONTROLS.map((control) => (
            <span key={control.action}>
              <kbd>{control.keys}</kbd> {control.action}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
