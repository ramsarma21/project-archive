import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { M1Scenery } from "../chapter/M1Scenery.js";
import { M1_MISSION_ID, m1Instance } from "../chapter/m1Mission.js";
import { MissionHud } from "../mission/MissionHud.js";
import { MissionStage } from "../mission/MissionStage.js";
import {
  attachMissionInput,
  createMissionInputState,
} from "../mission/missionInput.js";
import {
  createMissionRuntime,
  disposeMissionRuntime,
  type MissionPresentation,
} from "../mission/traversal.js";
import type { MissionTraversalOutcome } from "../mission/result.js";
import { VisorHold, type VisorPhase } from "./VisorHold.js";
import { m1VisorSource } from "./m1VisorSource.js";
import { visorHoldsBriefing } from "./visorRegistry.js";
import "../styles.css";
import "../mission/mission.css";

// Harness for the held moment, and for the two frames that matter about it: the
// visor up, and the first second of the bare run immediately after. Not shipped
// and not routed — the mission container mounts `VisorHold` in its BRIEFING phase.
//
// The point of showing both halves on one page is that the design claim is a claim
// about the SEAM. "Everything goes dark except the stealth readout" is not
// checkable from a screenshot of the visor; it is checkable from the frame after.
// So this harness holds, releases, and then mounts the container's own stage and
// HUD with nothing of the visor left in the tree.
//
//   ?attempt=n     attempt ordinal. 2 or 3 exercises the no-visor path.
//   ?seed=n        attempt seed. Watcher poses at tick 0 come from it.
//   ?reduced=1     reduced motion.
//   ?stay=1        never release, even if something asks. For iterating on the hold.
//
// window.__visor is the inspection handle: `phase`, `plan`, and `release()`, so a
// capture script reads the state instead of guessing it from pixels.

const params = new URLSearchParams(window.location.search);

interface VisorHandle {
  phase: VisorPhase | "RUN";
  plan: unknown;
  release(): void;
}

function Harness() {
  const reducedMotion = params.get("reduced") === "1";
  const attemptOrdinal = Number(params.get("attempt") ?? "") || 1;
  const seed = Number(params.get("seed") ?? "") || 0xb057;
  const stay = params.get("stay") === "1";

  const [released, setReleased] = useState(!visorHoldsBriefing(attemptOrdinal));
  const [hud, setHud] = useState<MissionPresentation | null>(null);
  const [outcome, setOutcome] = useState<MissionTraversalOutcome | null>(null);
  const input = useMemo(createMissionInputState, []);

  const instance = useMemo(
    () =>
      m1Instance({
        missionId: M1_MISSION_ID,
        attemptOrdinal,
        seed,
        Scenery: M1Scenery,
      }),
    [attemptOrdinal, seed],
  );

  // Built only once the visor is gone, so the run's clock cannot start behind the
  // briefing. This is the same ordering the container has: the runtime is created
  // with the transition into TRAVERSAL, and BRIEFING has no runtime to tick.
  const runtime = useMemo(
    () => (released ? createMissionRuntime({ instance, seed }) : null),
    [instance, released, seed],
  );

  useEffect(() => {
    if (!runtime) return undefined;
    return () => disposeMissionRuntime(runtime);
  }, [runtime]);

  useEffect(() => {
    if (!released) return undefined;
    return attachMissionInput(input);
  }, [input, released]);

  const release = useCallback(() => {
    if (stay) return;
    setReleased(true);
  }, [stay]);

  useEffect(() => {
    const handle: VisorHandle = {
      phase: released ? "RUN" : "REVEALING",
      plan: null,
      release,
    };
    (window as unknown as { __visor?: VisorHandle }).__visor = handle;
  }, [release, released]);

  const onPhase = useCallback((phase: VisorPhase) => {
    const handle = (window as unknown as { __visor?: VisorHandle }).__visor;
    if (handle) handle.phase = phase;
  }, []);

  if (!released) {
    return (
      <VisorHold
        instance={instance}
        seed={seed}
        source={m1VisorSource()}
        reducedMotion={reducedMotion}
        onRelease={release}
        onPhase={onPhase}
      />
    );
  }

  if (!runtime) return null;

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
          title="The Effigy Run · after the visor"
          attemptOrdinal={attemptOrdinal}
          presentation={hud}
          onAbandon={() => window.location.reload()}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
