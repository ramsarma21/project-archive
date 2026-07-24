import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type {
  ConcealmentState,
  FieldCommittedEvent,
  FieldRuntimeView,
} from "@pa/contracts";
import { RiggedCharacter } from "./Character.js";
import type { PlayerApi } from "./Player.js";
import { useWorldServices } from "./WorldServicesContext.js";
import { FIELD_DT, FIELD_TICK_HZ } from "./fieldSimulation.js";
import {
  CHECKPOINT_VOLUMES,
  WATCHERS,
  WATCHER_SCAN,
  pointInCover,
  type ChaseVec3,
  type WatcherDefinition,
} from "./stealthManifest.js";
import {
  checkpointChallenges,
  initialCheckpointState,
  initialSuspicionState,
  rangeAtDayProgress,
  stepCheckpoint,
  stepHeatDecay,
  stepSuspicion,
  visibilityFactors,
  watcherAttentionPolicy,
  watcherHeatMigrationReady,
  watcherPoseAt,
  type CheckpointState,
  type SuspicionState,
  type WatcherMotion,
} from "./watcherDetection.js";
import { detectionStateForSuspicion } from "./stealthStore.js";
import {
  dispatchPresentationNotice,
  SUSPICION_THRESHOLDS,
} from "@pa/engine-world";
import { ambientAudio } from "./ambientAudio.js";
import { QA_RUNTIME_ENABLED } from "./qaEnvironment.js";

type AlertLevel = "IDLE" | "WARY" | "ALERTED";

const BELL_TARGET: ChaseVec3 = [69, 0, -9];
const GULL_TARGET: ChaseVec3 = [-145, 0, 6];

function playerMotion(player: PlayerApi): WatcherMotion {
  if (
    player.motion.phase.includes("VAULT") ||
    player.motion.phase.includes("CLIMB")
  ) {
    return "VAULT_CLIMB";
  }
  if (player.motion.crouched) return "CROUCH";
  if (player.motion.sprinting) return "SPRINT";
  return player.motion.speed < 0.08 ? "STILL" : "WALK";
}

function effectiveConcealment(field: FieldRuntimeView): ConcealmentState {
  let result: ConcealmentState = "HIDDEN";
  let sawCarried = false;
  for (const objectId of field.carriedObjectIds) {
    sawCarried = true;
    const concealment = field.concealmentByObjectId[objectId] ?? "EXPOSED";
    if (concealment === "EXPOSED") return "EXPOSED";
    if (concealment === "WRAPPED") result = "WRAPPED";
  }
  return sawCarried ? result : "EXPOSED";
}

function eventId(prefix: string, tick: number, serial: number): string {
  return `M2_${prefix}_${tick}_${serial}`;
}

export function WatcherDirector(props: {
  field: FieldRuntimeView;
  apiRef: { current: PlayerApi | null };
  active: boolean;
  dayProgress: number;
  suspended: boolean;
  qaHostRef: { current: HTMLDivElement | null };
}) {
  const services = useWorldServices();
  const camera = useThree((state) => state.camera);
  const cameraForward = useRef(new THREE.Vector3());
  const groups = useRef(new Map<string, THREE.Group>());
  const owners = useRef(new Map(WATCHERS.map((watcher) => [watcher.id, {}])));
  const suspicion = useRef(
    new Map<string, SuspicionState>(
      WATCHERS.map((watcher) => [watcher.id, initialSuspicionState()]),
    ),
  );
  const checkpointWarned = useRef(new Set<string>());
  const checkpoints = useRef(
    new Map<string, CheckpointState>(
      CHECKPOINT_VOLUMES.map((volume) => [
        volume.id,
        initialCheckpointState(),
      ]),
    ),
  );
  const attention = useRef(
    new Map<string, { target: ChaseVec3; untilTick: number }>(),
  );
  const lastTick = useRef(services.fieldTickRef.current);
  const eventSerial = useRef(0);
  const queuedIds = useRef(new Set<string>());
  const queue = useRef<FieldCommittedEvent[]>([]);
  const draining = useRef(false);
  const lastDecayCommitSecond = useRef(
    Math.floor(props.field.heat.decay.elapsedSeconds),
  );
  const lastDecayPaused = useRef(props.field.heat.decay.paused);
  const localDecay = useRef({ ...props.field.heat.decay });
  const announcedClarke = useRef(false);
  const migrationQueued = useRef(false);
  const lastAnnouncement = useRef("");
  const [alertLevels, setAlertLevels] = useState<Record<string, AlertLevel>>({});
  const alertLevelsRef = useRef<Record<string, AlertLevel>>({});

  useEffect(() => {
    localDecay.current = { ...props.field.heat.decay };
    lastDecayCommitSecond.current = Math.floor(
      props.field.heat.decay.elapsedSeconds,
    );
    lastDecayPaused.current = props.field.heat.decay.paused;
  }, [
    props.field.heat.band,
    props.field.heat.decay.elapsedSeconds,
    props.field.heat.decay.paused,
  ]);

  const enqueue = (event: FieldCommittedEvent) => {
    if (queuedIds.current.has(event.eventId)) return;
    queuedIds.current.add(event.eventId);
    queue.current.push(event);
    if (draining.current) return;
    draining.current = true;
    void (async () => {
      try {
        while (queue.current.length > 0) {
          const next = queue.current.shift()!;
          const ok = await services.submitFieldEvent(next);
          if (!ok) {
            queuedIds.current.delete(next.eventId);
            break;
          }
        }
      } finally {
        draining.current = false;
      }
    })();
  };

  useEffect(() => {
    const onFlavor = (raw: Event) => {
      const event = raw as CustomEvent<{ id?: string }>;
      const target =
        event.detail?.id === "CHURCH_BELL"
          ? BELL_TARGET
          : event.detail?.id === "GULLS_SPOOKED"
            ? GULL_TARGET
            : null;
      if (!target) return;
      const tick = services.fieldTickRef.current;
      let nearest: WatcherDefinition | null = null;
      let distance = Infinity;
      for (const watcher of WATCHERS) {
        const pose = watcherPoseAt(watcher, tick);
        const candidate = Math.hypot(
          pose.position.x - target[0],
          pose.position.z - target[2],
        );
        if (candidate < distance) {
          nearest = watcher;
          distance = candidate;
        }
      }
      if (!nearest) return;
      attention.current.set(nearest.id, {
        target,
        untilTick:
          tick + Math.round(WATCHER_SCAN.attentionSeconds * FIELD_TICK_HZ),
      });
      lastAnnouncement.current =
        event.detail?.id === "CHURCH_BELL"
          ? "The nearest watcher turns toward the church bell."
          : "The nearest watcher turns toward the startled gulls.";
      services.stealthStore.patch({
        announcement: lastAnnouncement.current,
      });
    };
    window.addEventListener("pa:flavor", onFlavor);
    return () => window.removeEventListener("pa:flavor", onFlavor);
  }, [services.fieldTickRef, services.stealthStore]);

  useEffect(() => {
    if (!QA_RUNTIME_ENABLED) return;
    const target = window as unknown as {
      __PA_QA_SUSPICION__?: (value: number, watcherId?: string) => boolean;
    };
    target.__PA_QA_SUSPICION__ = (
      rawValue,
      watcherId = "WATCH-customs",
    ) => {
      if (!WATCHERS.some((watcher) => watcher.id === watcherId)) return false;
      const value = Math.max(0, Math.min(1, rawValue));
      suspicion.current.set(watcherId, {
        value,
        toldWary: value >= SUSPICION_THRESHOLDS.WARY,
        toldAlerted: value >= SUSPICION_THRESHOLDS.ALERTED,
        confronted: value >= SUSPICION_THRESHOLDS.CONFRONTATION,
      });
      return true;
    };
    return () => {
      delete target.__PA_QA_SUSPICION__;
    };
  }, []);

  useEffect(
    () => () => {
      for (const watcher of WATCHERS) services.actors.remove(watcher.id);
      services.stealthStore.patch({
        suspicion: 0,
        detectionState: "CLEAR",
        nearestWatcherDir: null,
      });
    },
    [services.actors, services.stealthStore],
  );

  useFrame(() => {
    const player = props.apiRef.current;
    const tick = services.fieldTickRef.current;
    const exterior = services.spaceId === "EXTERIOR";
    for (const watcher of WATCHERS) {
      const group = groups.current.get(watcher.id);
      if (group) group.visible = exterior;
    }
    if (!player) {
      lastTick.current = tick;
      return;
    }
    if (
      watcherHeatMigrationReady({
        active: props.active,
        interruptActive: props.field.activeInterrupt !== null,
        legacyAuthority:
          props.field.heat.authority === "LEGACY_WATCHER_HEAT",
        alreadyQueued: migrationQueued.current,
      })
    ) {
      migrationQueued.current = true;
      enqueue({
        type: "FIELD_HEAT_TRANSITION",
        eventId: `M2_HEAT_MIGRATION_${props.field.seedHex}`,
        from: props.field.heat.band,
        to: props.field.heat.band,
        cause: "LEGACY_MIGRATION",
      });
    }

    const poses = new Map<string, ReturnType<typeof watcherPoseAt>>();
    for (const watcher of WATCHERS) {
      const distraction = attention.current.get(watcher.id);
      if (distraction && tick >= distraction.untilTick) {
        attention.current.delete(watcher.id);
      }
      const pose = watcherPoseAt(
        watcher,
        tick,
        distraction && tick < distraction.untilTick
          ? distraction.target
          : null,
      );
      poses.set(watcher.id, pose);
      const group = groups.current.get(watcher.id);
      if (group && exterior) {
        group.position.set(pose.position.x, pose.position.y, pose.position.z);
        group.rotation.y = pose.yaw;
      }
      if (exterior) {
        services.actors.publish({
          id: watcher.id,
          spaceId: "EXTERIOR",
          kind: "WATCHER",
          position: pose.position,
          forwardVec: pose.forward,
          velocity: pose.velocity,
          tick,
          owner: owners.current.get(watcher.id),
        });
      } else {
        services.actors.remove(watcher.id);
      }
    }

    const attentionPolicy = watcherAttentionPolicy({
      exterior,
      active: props.active,
      chaseActive: props.field.activeChase !== null,
      suspended: props.suspended,
      interruptActive: props.field.activeInterrupt !== null,
    });
    const simulationActive = attentionPolicy.simulationActive;
    // Scripted exchanges and overlays suppress accrual but do not freeze the
    // meter. Existing attention drains while the player is occupied, so a
    // harmless notice read cannot release a queued challenge on close.
    const canAccrue = attentionPolicy.canAccrue;
    const concealment = effectiveConcealment(props.field);
    const motion = playerMotion(player);
    const covered = Boolean(pointInCover(player.position, services.spaceId));
    let maxSuspicion = 0;
    let nearestOffset: { dx: number; dz: number } | null = null;
    let nearestDistance = Infinity;
    let inAnyCone = false;
    let announcement = "";

    const previousTick = lastTick.current;
    const firstTick = previousTick + 1;
    for (let stepTick = firstTick; stepTick <= tick; stepTick++) {
      if (!simulationActive) break;
      for (const watcher of WATCHERS) {
        const distraction = attention.current.get(watcher.id);
        const pose = watcherPoseAt(
          watcher,
          stepTick,
          distraction && stepTick < distraction.untilTick
            ? distraction.target
            : null,
        );
        const factors = canAccrue
          ? visibilityFactors({
              watcherPosition: pose.position,
              watcherForward: pose.forward,
              playerPosition: player.position,
              halfAngleRad: watcher.halfAngleRad,
              rangeM: rangeAtDayProgress(watcher, props.dayProgress),
              concealment,
              motion,
              covered,
              segmentClear: services.gameplayWorld.segmentClear,
            })
          : null;
        inAnyCone ||= factors?.inCone ?? false;
        const current =
          suspicion.current.get(watcher.id) ?? initialSuspicionState();
        const stepped = stepSuspicion(current, {
          dt: FIELD_DT,
          visibility: factors?.visibility ?? 0,
          heat: props.field.heat.band,
          standing: props.field.standing.band,
        });
        suspicion.current.set(watcher.id, stepped.state);
        if (stepped.crossed.includes("WARY")) {
          announcement = "A watcher has noticed movement nearby.";
        }
        if (stepped.crossed.includes("ALERTED")) {
          announcement = "Hold there. A watcher is moving to challenge you.";
          if (props.field.heat.band === "CALM") {
            eventSerial.current += 1;
            enqueue({
              type: "FIELD_HEAT_TRANSITION",
              eventId: eventId("DETECTION_HEAT", stepTick, eventSerial.current),
              from: "CALM",
              to: "NOTICED",
              cause: "DETECTION",
            });
          }
        }
        if (stepped.crossed.includes("CONFRONTATION")) {
          ambientAudio.playIdentity("constable-whistle");
          eventSerial.current += 1;
          const suffix = `${props.field.confrontationHistory.length}_${watcher.id}_${stepTick}_${eventSerial.current}`;
          enqueue({
            type: "FIELD_WATCHER_CHALLENGE",
            eventId: `M2_CHALLENGE_${suffix}`,
            interruptId: `M2_INT_${suffix}`,
            challengeId: `M2_SUSPICION_${suffix}`,
            watcherId: watcher.id,
            reason: "SUSPICION",
          });
        }
      }

      if (!canAccrue) continue;
      for (const volume of CHECKPOINT_VOLUMES) {
        const current =
          checkpoints.current.get(volume.id) ?? initialCheckpointState();
        const wouldChallenge = checkpointChallenges({
          heat: props.field.heat.band,
          standing: props.field.standing.band,
          concealment,
        });
        // Telegraph before the stop: when the player nears a customs post
        // that WOULD challenge them, warn once per approach so the search is
        // a consequence they saw coming (turn back, or conceal the goods).
        const approachDistance = Math.hypot(
          player.position.x - volume.center[0],
          player.position.z - volume.center[2],
        );
        const warnRadius =
          Math.max(volume.halfExtents[0], volume.halfExtents[1]) + 7;
        const warned = checkpointWarned.current.has(volume.id);
        if (wouldChallenge && approachDistance <= warnRadius && !warned) {
          checkpointWarned.current.add(volume.id);
          dispatchPresentationNotice({
            id: `checkpoint:${volume.id}:warning`,
            kind: "ROUTE_WARNING",
            speaker: "ARCHIVE",
            text:
              concealment === "EXPOSED"
                ? "A customs post ahead — and your goods ride in plain view."
                : "A customs post ahead. The watch is checking bundles.",
            durationMs: 4_200,
            cooldownMs: 20_000,
            captions: true,
          });
        } else if (approachDistance > warnRadius + 6 && warned) {
          checkpointWarned.current.delete(volume.id);
        }
        const stepped = stepCheckpoint(
          current,
          volume,
          player.position,
          stepTick,
        );
        checkpoints.current.set(volume.id, stepped.state);
        if (stepped.crossed && wouldChallenge) {
          eventSerial.current += 1;
          const watcherId = volume.watcherIds[0]!;
          const suffix = `${props.field.confrontationHistory.length}_${volume.id}_${stepped.ordinal}_${eventSerial.current}`;
          enqueue({
            type: "FIELD_WATCHER_CHALLENGE",
            eventId: `M2_CHECK_${suffix}`,
            interruptId: `M2_INT_${suffix}`,
            challengeId: `M2_CHECKPOINT_${suffix}`,
            watcherId,
            reason: "CHECKPOINT",
          });
        }
      }
    }
    for (const watcher of WATCHERS) {
      const pose = poses.get(watcher.id)!;
      const state =
        suspicion.current.get(watcher.id) ?? initialSuspicionState();
      maxSuspicion = Math.max(maxSuspicion, state.value);
      const distance = Math.hypot(
        pose.position.x - player.position.x,
        pose.position.z - player.position.z,
      );
      if (distance < nearestDistance && (state.value > 0 || distance < 14)) {
        nearestDistance = distance;
        nearestOffset = {
          dx: pose.position.x - player.position.x,
          dz: pose.position.z - player.position.z,
        };
      }
    }
    const nextAlertLevels = Object.fromEntries(
      WATCHERS.map((watcher) => {
        const value =
          suspicion.current.get(watcher.id)?.value ?? 0;
        const level: AlertLevel =
          value >= SUSPICION_THRESHOLDS.ALERTED
            ? "ALERTED"
            : value >= SUSPICION_THRESHOLDS.WARY
              ? "WARY"
              : "IDLE";
        return [watcher.id, level];
      }),
    );
    if (
      WATCHERS.some(
        (watcher) =>
          alertLevelsRef.current[watcher.id] !== nextAlertLevels[watcher.id],
      )
    ) {
      alertLevelsRef.current = nextAlertLevels;
      setAlertLevels(nextAlertLevels);
    }

    if (
      canAccrue &&
      props.field.identity.clarkeMarked &&
      !announcedClarke.current
    ) {
      announcedClarke.current = true;
      eventSerial.current += 1;
      const watcherId = "WATCH-customs";
      const suffix = `${props.field.confrontationHistory.length}_CLARKE_${tick}_${eventSerial.current}`;
      enqueue({
        type: "FIELD_WATCHER_CHALLENGE",
        eventId: `M2_CHALLENGE_${suffix}`,
        interruptId: `M2_INT_${suffix}`,
        challengeId: `M2_CLARKE_${suffix}`,
        watcherId,
        reason: "CLARKE_INFORMED",
      });
    }

    const heat = props.field.heat;
    if (
      !props.suspended &&
      props.field.activeInterrupt === null &&
      heat.band !== "CALM"
    ) {
      for (let stepTick = firstTick; stepTick <= tick; stepTick++) {
        const result = stepHeatDecay(
          localDecay.current,
          FIELD_DT,
          exterior ? inAnyCone : false,
        );
        localDecay.current = result.progress;
        if (result.transition) {
          eventSerial.current += 1;
          enqueue({
            type: "FIELD_HEAT_TRANSITION",
            eventId: eventId("HEAT_DECAY", stepTick, eventSerial.current),
            from: result.transition.from,
            to: result.transition.to,
            cause: "DECAY",
          });
          break;
        }
        const wholeSecond = Math.floor(result.progress.elapsedSeconds);
        const pauseChanged =
          result.progress.paused !== lastDecayPaused.current;
        if (
          wholeSecond > lastDecayCommitSecond.current ||
          pauseChanged
        ) {
          lastDecayCommitSecond.current = wholeSecond;
          lastDecayPaused.current = result.progress.paused;
          eventSerial.current += 1;
          enqueue({
            type: "FIELD_HEAT_DECAY_CHECKPOINT",
            eventId: `M2_HEAT_PROGRESS_${result.progress.band}_${result.progress.elapsedSeconds.toFixed(3)}_${String(result.progress.paused)}_${eventSerial.current}`,
            band: result.progress.band,
            elapsedSeconds: result.progress.elapsedSeconds,
            paused: result.progress.paused,
          });
        }
      }
    }
    lastTick.current = tick;

    if (announcement) lastAnnouncement.current = announcement;
    // Convert the nearest-watcher offset into the camera-relative chevron
    // rotation the HUD renders directly (CSS clockwise, 0 = screen-right,
    // -PI/2 = dead ahead). World bearings would only be correct while the
    // camera happened to face north.
    let chevron: number | null = null;
    if (nearestOffset) {
      const forward = camera.getWorldDirection(cameraForward.current);
      forward.y = 0;
      if (forward.lengthSq() > 1e-6) {
        forward.normalize();
        const fwdComp =
          nearestOffset.dx * forward.x + nearestOffset.dz * forward.z;
        const rightComp =
          nearestOffset.dx * -forward.z + nearestOffset.dz * forward.x;
        chevron = Math.atan2(-fwdComp, rightComp);
      } else {
        chevron = Math.atan2(nearestOffset.dz, nearestOffset.dx);
      }
    }
    services.stealthStore.patch({
      suspicion: maxSuspicion,
      detectionState: detectionStateForSuspicion(maxSuspicion),
      nearestWatcherDir: chevron,
      announcement: announcement || lastAnnouncement.current,
    });

    if (props.qaHostRef.current) {
      const host = props.qaHostRef.current;
      host.dataset.watcherCount = String(
        services.actors.queryKind("WATCHER").length,
      );
      host.dataset.maxSuspicion = maxSuspicion.toFixed(3);
      host.dataset.inWatcherCone = String(inAnyCone);
      host.dataset.coverVolume =
        pointInCover(player.position, services.spaceId)?.id ?? "";
      host.dataset.watcherIds = WATCHERS.map((watcher) => watcher.id).join(",");
    }
  });

  return (
    <group visible={services.spaceId === "EXTERIOR"}>
      {WATCHERS.map((watcher) => {
        const level = alertLevels[watcher.id] ?? "IDLE";
        // The officer running the active confrontation performs it: rummaging
        // through the satchel during the comply inspection, squared up while
        // the player decides.
        const confrontation = props.field.activeConfrontation;
        const confronting = confrontation?.watcherId === watcher.id;
        const clip = confronting
          ? confrontation?.phase === "INSPECTING"
            ? "satchelSearch"
            : "talk2"
          : level === "ALERTED"
            ? "talk2"
            : level === "WARY"
              ? "argu1"
              : watcher.kind === "PATROL"
                ? "walk"
                : "idle";
        return (
          <group
            key={watcher.id}
            ref={(group) => {
              if (group) groups.current.set(watcher.id, group);
              else groups.current.delete(watcher.id);
            }}
            position={watcher.position}
            rotation={[0, watcher.baseYaw, 0]}
          >
            <RiggedCharacter
              glbKey="constable-rigged"
              height={1.78}
              clip={clip}
              contactShadow
              showFallback={false}
            />
          </group>
        );
      })}
    </group>
  );
}
