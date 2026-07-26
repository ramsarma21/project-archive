import { duelView } from "../mission/duelPort.js";
import { DUEL_CONTROLS } from "../duel/duelInput.js";
import { pvpArenaMode, pvpArenaView } from "./arenaPort.js";
import type { MatchSnapshot } from "./protocol.js";

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
}

function metres(value: number): string {
  return value.toFixed(1);
}

export function PvpArena(props: PvpArenaProps) {
  const View = pvpArenaView();
  if (pvpArenaMode(View !== null) === "VIEW" && View) {
    return (
      <div className="pvp-arena pvp-arena-live">
        <View
          snapshot={props.snapshot}
          reducedMotion={props.reducedMotion}
          onAim={props.onAim}
          onCameraYaw={props.onCameraYaw}
        />
      </div>
    );
  }

  const { snapshot } = props;
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
