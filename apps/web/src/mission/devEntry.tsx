import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Vec3 } from "@pa/engine-world";
import { M1_EFFIGY_RUN } from "@pa/mission-m1";
import { M1Scenery } from "../chapter/M1Scenery.js";
import { M1_MISSION_ID, m1Instance } from "../chapter/m1Mission.js";
// The held moment, the same component the container's BRIEFING phase mounts.
// Imported through the visor's index so M1's annotation source is registered by
// the same import-time seam the container relies on.
import { VisorHold } from "../visor/index.js";
import { MissionEncounter } from "./MissionEncounter.js";
import { MissionHud } from "./MissionHud.js";
import { MissionStage } from "./MissionStage.js";
import {
  encounterAuthorityFromQuery,
  httpEncounterAuthority,
} from "./encounterAuthority.js";
import { attachMissionInput, createMissionInputState } from "./missionInput.js";
import { createMissionLookState } from "./missionLook.js";
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
// IT NOW HOLDS THE VISOR FIRST, AND THAT IS A BUG FIX RATHER THAN A FEATURE.
// This page used to mount the canvas directly, so it began at the spawn with the
// clock already running and no briefing of any kind. The container does not: its
// BRIEFING phase mounts `VisorHold` on the first attempt, which is where a
// first-time player is told what they are doing, where it is and what their body
// can do. Because the API has been down, this harness is what the mission has
// actually been played on — so the one thing everybody was judging onboarding by
// was the one surface that deliberately had none, and "the game never tells you
// anything" was a true report about a false build.
//
// A harness that quietly omits the first thing a player sees is not a cheaper
// version of the product, it is a different product. So the default is now the
// real order — hold, release, run — and skipping it is something you have to ask
// for with `?hold=0`.
//
//   ?at=<node>       a route node to drop in on. `F_POST` is the beat's stance;
//                    `E_ELLIOT_LIP` is the lip the dash gap leaves from.
//   ?toward=<node>   face this node. With `back`, this is how you get a run-up
//                    to an authored link instead of standing on its edge.
//   ?back=<metres>   back off from `at`, away from `toward`.
//   ?seed=n          attempt seed. The chart is drawn from it, so this is how
//                    you get a different rhythm.
//   ?hold=0          skip the visor and drop straight into the run. For working
//                    on movement, where sitting through the briefing every
//                    reload is the thing you are not testing. Implied by `at`,
//                    because a drop-in halfway down the route is not a first
//                    run and the hold is composed against the spawn.
//   ?reduced=1       reduced motion.
//   ?bare=1          mount no scenery. The collision world, the route and the
//                    field are authored data and do not come from the GLBs, so
//                    the run is unchanged — this only stops the level's art
//                    loading. For measuring movement, camera, input and frame
//                    pacing without a half-generated asset library in the way,
//                    and for telling a physics problem apart from an art one.
//   ?encounterVerdict=correct|wrong|granted
//                    a DETERMINISTIC dev authority for the perspective
//                    encounters, so the real overlay, world and runtime can be
//                    driven without a grading credential. It does NOT read the
//                    answer; it returns the scripted kind. Absent, the harness
//                    uses the real CSRF HTTP authority — which, offline, grants.

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
  // The encounter authority: a deterministic dev stand-in when asked for, else
  // the real HTTP one. The floor uses the same overlay and runtime the container
  // does, so this is injection at the authority, not a fake surface.
  const encounterAuthority = useMemo(
    () => encounterAuthorityFromQuery(window.location.search) ?? httpEncounterAuthority,
    [],
  );
  const [runId, setRunId] = useState(0);
  const [hud, setHud] = useState<MissionPresentation | null>(null);
  const [outcome, setOutcome] = useState<MissionTraversalOutcome | null>(null);
  const input = useMemo(createMissionInputState, []);

  // The hold is the default and the run is what comes after it, which is the
  // container's own order. A drop-in via `at` is not a first run — the visor is
  // composed against the spawn view and would annotate a district the player is
  // standing forty metres east of — so naming a node opts out.
  const wantsHold = params.get("hold") !== "0" && !params.get("at");
  const [held, setHeld] = useState(wantsHold);

  const instance = useMemo(() => {
    const attemptSeed = seed + runId;
    const authored = m1Instance({
      missionId: M1_MISSION_ID,
      attemptOrdinal: 1,
      seed: attemptSeed,
      Scenery: params.get("bare") === "1" ? null : M1Scenery,
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
    return drop
      ? {
          ...authored,
          spawn: { pos: drop.pos, yaw: onTheBough ? spec!.facingYaw : drop.yaw },
        }
      : authored;
  }, [runId, seed]);

  // Built only once the visor is gone, which is what makes "the clock starts
  // when you release" structural here as well as in the container: there is no
  // runtime to tick while the hold is up, so the three minutes cannot have begun.
  const runtime = useMemo(
    () => (held ? null : createMissionRuntime({ instance, seed: seed + runId })),
    [held, instance, runId, seed],
  );

  // Rebuilt whenever the runtime is, so "Again" re-aims the camera the way the
  // drop does rather than leaving it wherever the last run finished looking.
  const lookState = useMemo(
    () => createMissionLookState(instance.spawn.yaw),
    [instance],
  );

  // Keys only, and only once the player is actually running. The mouse is bound
  // inside the canvas by the stage, because the pointer request has to name the
  // element it is capturing.
  useEffect(() => (runtime ? attachMissionInput(input) : undefined), [input, runtime]);
  useEffect(() => {
    if (!runtime) return undefined;
    return () => disposeMissionRuntime(runtime);
  }, [runtime]);
  useEffect(() => {
    // Inspection handle, so a capture script can read the beat's phase, the
    // constable's suspicion and the tick instead of guessing them from pixels.
    (window as unknown as { __floor?: unknown }).__floor = runtime;
    // The look alongside it. A camera probe has to be able to ask where the
    // player is AIMING, not infer it from where the camera drifted to — which
    // is the same confusion that produced the spin this rig replaced.
    (window as unknown as { __look?: unknown }).__look = lookState;
  }, [lookState, runtime]);

  function again(): void {
    setOutcome(null);
    setHud(null);
    setHeld(wantsHold);
    setRunId((value) => value + 1);
  }

  if (held) {
    return (
      <VisorHold
        instance={instance}
        seed={seed + runId}
        reducedMotion={reducedMotion}
        onRelease={() => setHeld(false)}
      />
    );
  }
  if (!runtime) return null;

  return (
    <div className="msn">
      <MissionStage
        // The capture scripts in assets/pipeline read the light rig, the draw
        // count and the tone curve off this rather than guessing them from
        // pixels. Harness only; the mission never passes it.
        onStage={(state) => {
          (window as unknown as { __stage?: unknown }).__stage = state;
        }}
        runtime={runtime}
        input={input}
        lookState={lookState}
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
      <MissionEncounter
        runtime={runtime}
        authority={encounterAuthority}
        reducedMotion={reducedMotion}
      />
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

// No StrictMode here, deliberately: this harness owns the runtime through a
// `useMemo` and disposes it in an effect cleanup, and StrictMode's mount →
// unmount → remount would dispose that runtime and then hand the same disposed
// object back from the memo (a disposed runtime has its attempt-scoped state
// cleared). The production container (useMissionSession) rebuilds through a ref
// on the next transition, so it is unaffected and keeps its own StrictMode.
createRoot(document.getElementById("root")!).render(<Harness />);
