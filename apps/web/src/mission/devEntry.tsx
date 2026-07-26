import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Vec3 } from "@pa/engine-world";
import { M1_EFFIGY_RUN } from "@pa/mission-m1";
import { M1Scenery } from "../chapter/M1Scenery.js";
import { M1_MISSION_ID, m1Instance } from "../chapter/m1Mission.js";
import { MissionHud } from "./MissionHud.js";
import { MissionStage } from "./MissionStage.js";
import { attachMissionInput, createMissionInputState } from "./missionInput.js";
import {
  createMissionRuntime,
  disposeMissionRuntime,
  type MissionPresentation,
} from "./traversal.js";
import type { MissionTraversalOutcome } from "./result.js";
import "../styles.css";
import "./mission.css";

// Harness for playing the floor. Not shipped and not routed: the hub deploys the
// real mission through the session machine, and this exists so the traversal can
// be played and looked at without the module gate, the attempt ledger and the
// account service in front of it.
//
// It is injection, never a shortcut through the core. The instance is M1's own,
// the runtime is the same `createMissionRuntime`, the stage is the same canvas
// and the HUD is the same HUD. What it skips is everything OUTSIDE the three
// minutes — which is the difference between checking one hammer stroke in five
// seconds and checking it in ten minutes.
//
//   ?at=<node>       a route node to drop in on. `F_POST` is the beat's stance;
//                    `E_ELLIOT_LIP` is the lip the dash gap leaves from.
//   ?toward=<node>   face this node. With `back`, this is how you get a run-up
//                    to an authored link instead of standing on its edge.
//   ?back=<metres>   back off from `at`, away from `toward`.
//   ?seed=n          attempt seed. The chart is drawn from it, so this is how
//                    you get a different rhythm.
//   ?reduced=1       reduced motion.

const params = new URLSearchParams(window.location.search);

function nodeAt(id: string | null): [number, number, number] | null {
  if (!id) return null;
  const node = M1_EFFIGY_RUN.nodes.find((candidate) => candidate.id === id);
  if (!node) {
    console.warn(`[floor] no route node "${id}"`);
    return null;
  }
  return node.pos;
}

/**
 * Where to drop in and which way to face, read out of the authored route so it
 * is somewhere the player could actually have reached.
 *
 * The spawn is overridden rather than the motion nudged after the fact, because
 * the chase camera is placed from the spawn — and movement intent is
 * camera-relative, so a camera that starts eighty metres away turns the first
 * two seconds of "hold forward" into a diagonal.
 */
function dropSpawn(): { pos: Vec3; yaw: number } | null {
  const at = nodeAt(params.get("at"));
  if (!at) return null;
  const toward = nodeAt(params.get("toward"));
  const back = Number(params.get("back") ?? "") || 0;

  let yaw = 0;
  let [x, , z] = at;
  if (toward) {
    const dx = toward[0] - at[0];
    const dz = toward[2] - at[2];
    const length = Math.hypot(dx, dz) || 1;
    yaw = Math.atan2(dx / length, dz / length);
    x -= (dx / length) * back;
    z -= (dz / length) * back;
  }
  // A hair above the surface, so the first step settles onto it rather than
  // starting a frame inside it.
  return { pos: { x, y: at[1] + 0.05, z }, yaw };
}

function Harness() {
  const reducedMotion = params.get("reduced") === "1";
  const seed = Number(params.get("seed") ?? "") || 0xb057;
  const [runId, setRunId] = useState(0);
  const [hud, setHud] = useState<MissionPresentation | null>(null);
  const [outcome, setOutcome] = useState<MissionTraversalOutcome | null>(null);
  const input = useMemo(createMissionInputState, []);

  const runtime = useMemo(() => {
    const attemptSeed = seed + runId;
    const authored = m1Instance({
      missionId: M1_MISSION_ID,
      attemptOrdinal: 1,
      seed: attemptSeed,
      Scenery: M1Scenery,
    });
    const drop = dropSpawn();
    const spec = authored.beat?.spec;
    // Facing the work when the drop is on the bough, because otherwise which way
    // the harness happens to point decides whether the beat is available at all,
    // and that is not a thing to leave to luck.
    const onTheBough =
      drop &&
      spec &&
      Math.hypot(drop.pos.x - spec.stance.x, drop.pos.z - spec.stance.z) <=
        spec.stanceRadiusM;
    const instance = drop
      ? {
          ...authored,
          spawn: { pos: drop.pos, yaw: onTheBough ? spec!.facingYaw : drop.yaw },
        }
      : authored;
    return createMissionRuntime({ instance, seed: attemptSeed });
  }, [runId, seed]);

  useEffect(() => attachMissionInput(input), [input]);
  useEffect(() => () => disposeMissionRuntime(runtime), [runtime]);
  useEffect(() => {
    // Inspection handle, so a capture script can read the beat's phase, the
    // constable's suspicion and the tick instead of guessing them from pixels.
    (window as unknown as { __floor?: unknown }).__floor = runtime;
  }, [runtime]);

  function again(): void {
    setOutcome(null);
    setHud(null);
    setRunId((value) => value + 1);
  }

  return (
    <div className="msn">
      <MissionStage
        runtime={runtime}
        input={input}
        reducedMotion={reducedMotion}
        paused={outcome !== null}
        onResolved={setOutcome}
        onSample={setHud}
      />
      {hud && (
        <MissionHud
          title="The Effigy Run · floor harness"
          attemptOrdinal={1}
          presentation={hud}
          onAbandon={again}
        />
      )}
      {outcome && (
        <div className="msn-curtain" role="status">
          <span className="msn-curtain-kicker">
            {outcome.kind === "FAILED" ? "Attempt lost" : "Route complete"}
          </span>
          <h1 className="msn-curtain-headline">
            {outcome.kind === "FAILED"
              ? outcome.failure.headline
              : "The duel is armed."}
          </h1>
          {outcome.kind === "FAILED" && (
            <p className="msn-curtain-detail">{outcome.failure.detail}</p>
          )}
          <div className="msn-curtain-actions">
            <button type="button" onClick={again}>
              Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
