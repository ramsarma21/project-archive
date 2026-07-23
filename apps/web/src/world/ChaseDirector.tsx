import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type {
  ChaseRecord,
  FieldRuntimeView,
  HeatBand,
} from "@pa/contracts";
import { RiggedCharacter } from "./Character.js";
import type { PlayerApi } from "./Player.js";
import { useWorldServices } from "./WorldServicesContext.js";
import { dispatchPresentationNotice } from "../presenter/noticeArbiter.js";
import {
  createChaseState,
  stepChase,
  type ChaseOutcome,
  type ChaseState,
} from "./chaseModel.js";
import { FIELD_DT, FIELD_TICK_HZ } from "./fieldSimulation.js";
import {
  CHASE_TUNING,
  EXTERIOR_CHASE_GRAPH,
  INSPECTOR_OFFICE,
  interiorChaseGraph,
  pursuitPortalPolicy,
  volumesForSpace,
  type ChaseRouteGraph,
  type ChaseVec3,
} from "./stealthManifest.js";
import { interiorExitSensor } from "./interiorManifest.js";
import { ALL_INTERIOR_LOCATIONS } from "./manifest.js";
import { thresholdAnchorForLocation } from "./doorwayContract.js";
import type { StaminaAssist } from "./stamina.js";
import { QA_RUNTIME_ENABLED } from "./qaEnvironment.js";

const PURSUER_ID = "M1_PURSUER";

function planarDistance(
  a: { x: number; z: number },
  b: { x: number; z: number },
): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function angleDelta(a: number, b: number): number {
  let delta = b - a;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function graphForSpace(
  spaceId: string,
  worldBounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): ChaseRouteGraph {
  if (spaceId === "EXTERIOR") return EXTERIOR_CHASE_GRAPH;
  return interiorChaseGraph({
    spaceId,
    ...worldBounds,
    portal: interiorExitSensor(spaceId),
  });
}

function safeSpawn(
  graph: ChaseRouteGraph,
  player: PlayerApi,
  blockerIdsAt: (
    pos: { x: number; y: number; z: number },
    radius: number,
    height: number,
  ) => string[],
): { x: number; y: number; z: number } {
  const desired = {
    x: player.position.x - player.motion.facingX * 5.5,
    y: player.position.y,
    z: player.position.z - player.motion.facingZ * 5.5,
  };
  const candidates = graph.waypoints
    .map((waypoint) => ({
      point: {
        x: waypoint.position[0],
        y: waypoint.position[1],
        z: waypoint.position[2],
      },
      distance: planarDistance(desired, {
        x: waypoint.position[0],
        z: waypoint.position[2],
      }),
    }))
    .sort((a, b) => a.distance - b.distance);
  if (blockerIdsAt(desired, 0.32, 1.55).length === 0) return desired;
  return (
    candidates.find(
      ({ point }) =>
        planarDistance(point, player.position) >= 4.5 &&
        blockerIdsAt(point, 0.32, 1.55).length === 0,
    )?.point ?? desired
  );
}

function currentRefuge(
  spaceId: string,
  player: PlayerApi,
): { id: string; holdSeconds: number } | null {
  for (const volume of volumesForSpace(spaceId)) {
    // Authored REFUGE volumes resolve the chase with their own hold time;
    // HIDE volumes (market awnings, stack shadows) work the same way but are
    // never instant — a minimum hold keeps ducking behind a stall a real
    // beat, not a tap.
    if (volume.kind !== "REFUGE" && volume.kind !== "HIDE") continue;
    if (
      Math.hypot(
        player.position.x - volume.center[0],
        player.position.z - volume.center[2],
      ) <= volume.radius
    ) {
      return {
        id: volume.id,
        holdSeconds:
          volume.kind === "HIDE"
            ? Math.max(volume.holdSeconds, 1.1)
            : volume.holdSeconds,
      };
    }
  }
  return null;
}

export function ChaseDirector(props: {
  chase: ChaseRecord | null;
  field: FieldRuntimeView;
  apiRef: { current: PlayerApi | null };
  assist: StaminaAssist;
  reducedMotion: boolean;
  ownsCamera: boolean;
  suspended: boolean;
  onCameraYaw: (yaw: number) => void;
  qaHostRef: { current: HTMLDivElement | null };
}) {
  const services = useWorldServices();
  const camera = useThree((state) => state.camera);
  const group = useRef<THREE.Group>(null);
  const owner = useRef({});
  const stateRef = useRef<ChaseState | null>(null);
  const chaseIdRef = useRef<string | null>(null);
  const lastTickRef = useRef(services.fieldTickRef.current);
  const lastSpaceRef = useRef(services.spaceId);
  const transferUntilTick = useRef(0);
  const transferDestination = useRef<ChaseVec3 | null>(null);
  const resolutionStarted = useRef(false);
  const confirmResolve = useRef(false);
  const lastYawPublished = useRef(Number.NaN);
  const cameraLook = useRef(new THREE.Vector3());
  const outcomeReadyTick = useRef<number | null>(null);
  const caughtLockActive = useRef(false);
  const [pursuerClip, setPursuerClip] = useState("run");
  // React mirror of the sim phase, only for presentation (the shout bubble).
  const [phaseView, setPhaseView] = useState<string>("IDLE");

  const graph = useMemo(
    () =>
      graphForSpace(
        services.spaceId,
        services.gameplayWorld.collision.bounds,
      ),
    [services.gameplayWorld, services.spaceId],
  );

  useEffect(() => {
    const onConfirm = () => {
      confirmResolve.current = true;
    };
    window.addEventListener("pa:chase-confirm", onConfirm);
    return () => window.removeEventListener("pa:chase-confirm", onConfirm);
  }, []);

  useEffect(() => {
    if (!props.chase) {
      services.actors.remove(PURSUER_ID);
      chaseIdRef.current = null;
      stateRef.current = null;
      resolutionStarted.current = false;
      outcomeReadyTick.current = null;
      setPursuerClip("run");
      if (caughtLockActive.current) {
        props.apiRef.current?.setInteractionClip(null);
        props.apiRef.current?.setInputLocked(false);
        caughtLockActive.current = false;
      }
      services.stealthStore.patch({
        chaseActive: false,
        chaseState: "IDLE",
        confirmResolve: false,
        announcement: "",
      });
      return;
    }
    if (chaseIdRef.current === props.chase.chaseId) return;
    const player = props.apiRef.current;
    if (!player) return;
    const spawn = safeSpawn(
      graph,
      player,
      services.gameplayWorld.blockerIdsAt,
    );
    stateRef.current = createChaseState({
      tick: services.fieldTickRef.current,
      pursuer: spawn,
      player: player.position,
      actionSerial: player.motion.actionSerial,
    });
    chaseIdRef.current = props.chase.chaseId;
    lastTickRef.current = services.fieldTickRef.current;
    resolutionStarted.current = false;
    outcomeReadyTick.current = null;
    setPursuerClip("run");
    services.stealthStore.patch({
      chaseActive: true,
      chaseState: "STARTING",
      announcement: "Pursuit started. Break sight and open an eight metre gap.",
    });
  }, [
    graph,
    props.apiRef,
    props.chase,
    services.actors,
    services.fieldTickRef,
    services.gameplayWorld,
    services.stealthStore,
  ]);

  useEffect(
    () => () => {
      services.actors.remove(PURSUER_ID);
      if (caughtLockActive.current) {
        props.apiRef.current?.setInteractionClip(null);
        props.apiRef.current?.setInputLocked(false);
        caughtLockActive.current = false;
      }
      services.stealthStore.patch({
        chaseActive: false,
        chaseState: "IDLE",
        confirmResolve: false,
      });
    },
    [services.actors, services.stealthStore],
  );

  const resolveOutcome = async (
    outcome: ChaseOutcome,
    chase: ChaseRecord,
  ): Promise<void> => {
    if (resolutionStarted.current) return;
    resolutionStarted.current = true;
    const prefix = `${chase.chaseId}_RESOLUTION`;
    const submit = services.submitFieldEvent;
    try {
      if (props.field.heat.band !== "HUNTED") {
        const heatOk = await submit({
          type: "FIELD_HEAT_TRANSITION",
          eventId: `${prefix}_HEAT`,
          interruptId: chase.interruptId,
          from: props.field.heat.band as HeatBand,
          to: "HUNTED",
          cause: outcome === "CAUGHT" ? "CONFISCATION" : "RUN",
        });
        if (!heatOk) throw new Error("heat commit rejected");
      }
      if (outcome === "CAUGHT") {
        for (const objectId of props.field.carriedObjectIds) {
          const custodyOk = await submit({
            type: "FIELD_CUSTODY_CHANGED",
            eventId: `${prefix}_CONFISCATE_${objectId}`,
            interruptId: chase.interruptId,
            objectId,
            custody: "CONFISCATED",
            condition: "LOST",
            concealment: "EXPOSED",
            reason: "caught-during-chase",
          });
          if (!custodyOk) throw new Error("custody commit rejected");
        }
        const clockOk = await submit({
          type: "FIELD_CLOCK_ADVANCED",
          eventId: `${prefix}_CLOCK`,
          interruptId: chase.interruptId,
          units: CHASE_TUNING.caughtClockUnits,
          reason: "inspector-office-custody",
        });
        if (!clockOk) throw new Error("clock commit rejected");
        // Getting caught marks you with the town (small, bounded Standing
        // ding — real but recoverable stakes). Unique causeId per chase so
        // repeat catches keep costing.
        await submit({
          type: "FIELD_STANDING_DELTA",
          eventId: `${prefix}_STANDING`,
          interruptId: chase.interruptId,
          delta: -2,
          causeId: `CHASE_CAUGHT_${chase.chaseId}`,
        });
        const repositionOk = await submit({
          type: "FIELD_REPOSITION_INTENT",
          eventId: `${prefix}_REPOSITION`,
          interruptId: chase.interruptId,
          locationId: INSPECTOR_OFFICE.locationId,
          anchorId: INSPECTOR_OFFICE.releaseAnchorId,
          reason: "RELEASE",
        });
        if (!repositionOk) throw new Error("reposition commit rejected");
      }
      const resolved = await submit({
        type: "FIELD_CHASE_RESOLVED",
        eventId: `${prefix}_CHASE`,
        interruptId: chase.interruptId,
        chaseId: chase.chaseId,
        outcome,
      });
      if (!resolved) throw new Error("chase resolution rejected");
      if (stateRef.current) {
        stateRef.current = { ...stateRef.current, phase: "ENDED" };
      }
    } catch (error) {
      resolutionStarted.current = false;
      console.error("[chase] durable resolution failed", error);
    }
  };

  useFrame((_, rawDt) => {
    const chase = props.chase;
    const player = props.apiRef.current;
    let state = stateRef.current;
    if (!chase || !player || !state) {
      if (group.current) group.current.visible = false;
      return;
    }

    const tick = services.fieldTickRef.current;
    if (services.spaceId !== lastSpaceRef.current) {
      const previousSpace = lastSpaceRef.current;
      lastSpaceRef.current = services.spaceId;
      const policy = pursuitPortalPolicy(services.spaceId);
      transferUntilTick.current =
        tick + Math.round(policy.transferDelaySeconds * FIELD_TICK_HZ);
      if (services.spaceId === "EXTERIOR" && previousSpace !== "EXTERIOR") {
        const previousLocation = ALL_INTERIOR_LOCATIONS[previousSpace];
        transferDestination.current = previousLocation
          ? thresholdAnchorForLocation(previousLocation, "OUTSIDE")
          : [player.position.x, player.position.y, player.position.z];
      } else {
        transferDestination.current = interiorExitSensor(services.spaceId);
      }
      services.actors.remove(PURSUER_ID);
    }

    if (tick < transferUntilTick.current) {
      if (group.current) group.current.visible = false;
      services.stealthStore.patch({
        chaseState: state.phase,
        announcement: "The pursuer is crossing the doorway behind you.",
      });
      lastTickRef.current = tick;
      return;
    }
    if (transferDestination.current) {
      state = {
        ...state,
        pursuer: {
          x: transferDestination.current[0],
          y: transferDestination.current[1],
          z: transferDestination.current[2],
        },
        velocity: { x: 0, y: 0, z: 0 },
        obstacleDelaySeconds: CHASE_TUNING.obstacleDelaySeconds,
      };
      stateRef.current = state;
      transferDestination.current = null;
    }

    if (!props.suspended) {
      const firstTick = lastTickRef.current + 1;
      for (let stepTick = firstTick; stepTick <= tick; stepTick++) {
        const result = stepChase(state, {
          tick: stepTick,
          dt: FIELD_DT,
          player: player.position,
          playerStamina: player.motion.stamina,
          movementIntent: player.motion.movementIntent,
          movementBlocked: player.motion.blocked,
          actionSerial: player.motion.actionSerial,
          refuge: currentRefuge(services.spaceId, player),
          graph,
          world: services.gameplayWorld,
          // A recognized face gets chased harder: once the watch knows you
          // (complied before, or resolved a prior chase), pursuers carry the
          // authored high-heat bonus. Accessibility slow-pursuer stays flat.
          pursuerSpeed:
            props.assist === "SLOW_PURSUER"
              ? CHASE_TUNING.slowPursuerMps
              : CHASE_TUNING.pursuerMps +
                (props.field.identity.recognized
                  ? CHASE_TUNING.highHeatBonusMps
                  : 0),
          assist: props.assist,
          confirmResolve: confirmResolve.current,
        });
        state = result.state;
        if (confirmResolve.current) confirmResolve.current = false;
        if (state.outcome && outcomeReadyTick.current === null) {
          const caught = state.outcome === "CAUGHT";
          outcomeReadyTick.current =
            stepTick +
            Math.round(
              (props.reducedMotion ? 0.15 : caught ? 1.2 : 0.4) *
                FIELD_TICK_HZ,
            );
          setPursuerClip(caught ? "talk2" : "idle");
          if (caught) {
            player.setInputLocked(true);
            player.setInteractionClip("idle");
            caughtLockActive.current = true;
          }
          break;
        }
      }
    }
    lastTickRef.current = tick;
    stateRef.current = state;
    if (QA_RUNTIME_ENABLED && props.qaHostRef.current) {
      const host = props.qaHostRef.current;
      host.dataset.chaseGap = planarDistance(
        state.pursuer,
        player.position,
      ).toFixed(3);
      host.dataset.chaseShakeSeconds = state.shakeSeconds.toFixed(3);
      host.dataset.chaseCorneredSeconds = state.corneredSeconds.toFixed(3);
      host.dataset.chaseTargetWaypoint = state.targetWaypointId ?? "";
    }
    if (
      state.outcome &&
      outcomeReadyTick.current !== null &&
      tick >= outcomeReadyTick.current &&
      !resolutionStarted.current
    ) {
      void resolveOutcome(state.outcome, chase);
    }

    if (state.phase !== phaseView) {
      setPhaseView(state.phase);
      // The shouted head start is performed, not just captioned: the officer
      // plants and yells (shout clip), then breaks into the run.
      if (state.phase === "STARTING") setPursuerClip("shout");
      else if (state.phase === "ACTIVE") setPursuerClip("run");
    }
    const resolvingConfirm =
      props.assist === "CONFIRM_RESOLVE" &&
      state.pendingOutcome !== null;
    services.stealthStore.patch({
      chaseActive: true,
      chaseState: state.phase,
      confirmResolve: resolvingConfirm,
      announcement: resolvingConfirm
        ? `${state.pendingOutcome === "CAUGHT" ? "Caught" : "Escape"} ready. Confirm to resolve.`
        : state.phase === "ACTIVE"
          ? "Pursuit active."
          : state.phase === "CAUGHT"
            ? "Caught. Goods and time are recorded before release outside the Boston Watch House."
            : state.phase === "SHAKEN"
              ? "Pursuit shaken."
              : "",
    });

    const visible = tick >= transferUntilTick.current;
    if (group.current) {
      group.current.visible = visible;
      group.current.position.set(
        state.pursuer.x,
        state.pursuer.y,
        state.pursuer.z,
      );
      group.current.rotation.y = Math.atan2(
        state.forward.x,
        state.forward.z,
      );
    }
    services.actors.publish({
      id: PURSUER_ID,
      spaceId: services.spaceId,
      kind: "PURSUER",
      position: state.pursuer,
      forwardVec: state.forward,
      velocity: state.velocity,
      tick,
      owner: owner.current,
    });

    if (!props.ownsCamera) return;
    const movementYaw = Math.atan2(
      player.motion.facingX,
      player.motion.facingZ,
    );
    if (
      !Number.isFinite(lastYawPublished.current) ||
      Math.abs(angleDelta(lastYawPublished.current, movementYaw)) > 0.055
    ) {
      lastYawPublished.current = movementYaw;
      props.onCameraYaw(movementYaw);
    }
    const speedLead = Math.min(0.7, player.motion.speed * 0.1);
    const desired = new THREE.Vector3(
      player.position.x - Math.sin(movementYaw) * 7,
      player.position.y + 3.05,
      player.position.z - Math.cos(movementYaw) * 7,
    );
    const dt = Math.min(rawDt, 0.05);
    if (props.reducedMotion) {
      camera.position.copy(desired);
      if (camera instanceof THREE.PerspectiveCamera) camera.fov = 55;
    } else {
      camera.position.lerp(desired, 1 - Math.exp(-7 * dt));
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.fov = THREE.MathUtils.lerp(
          camera.fov,
          58,
          1 - Math.exp(-4 * dt),
        );
      }
    }
    camera.updateProjectionMatrix();
    const lookGoal = new THREE.Vector3(
      player.position.x + player.motion.facingX * speedLead,
      player.position.y + 1.25,
      player.position.z + player.motion.facingZ * speedLead,
    );
    if (props.reducedMotion) cameraLook.current.copy(lookGoal);
    else cameraLook.current.lerp(lookGoal, 1 - Math.exp(-10 * dt));
    camera.lookAt(cameraLook.current);
  });

  const startPhase = props.chase !== null && phaseView === "STARTING";
  useEffect(() => {
    if (!startPhase || !props.chase) return;
    dispatchPresentationNotice({
      id: `chase:${props.chase.chaseId}:start`,
      kind: "CHASE",
      speaker: "CONSTABLE",
      text: "STOP! IN THE KING'S NAME!",
      cooldownMs: 30_000,
      durationMs: 2_200,
      captions: true,
    });
  }, [props.chase, startPhase]);
  return (
    <group ref={group} visible={false}>
      <RiggedCharacter
        glbKey="constable-rigged"
        height={1.72}
        clip={pursuerClip}
        contactShadow
        showFallback={false}
      />
    </group>
  );
}
