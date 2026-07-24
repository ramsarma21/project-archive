import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { RuntimeView } from "@pa/contracts";
import type { PlayerApi } from "../Player.js";
import type { ActorRegistry } from "../actorRegistry.js";
import type { StealthStore } from "../stealthStore.js";
import type { StaminaAssist } from "../stamina.js";
import { QA_RUNTIME_ENABLED } from "../qaEnvironment.js";

// Mirrors the live player position onto the wrapper element so QA tooling
// (and tests) can observe movement without reaching into the scene graph.
// Also installs the __PA_QA_TELEPORT__ window hook. Everything is gated on
// QA_RUNTIME_ENABLED and writes nothing in production runs.
export function PlayerPosProbe(props: {
  apiRef: { current: PlayerApi | null };
  hostRef: { current: HTMLDivElement | null };
  actors: ActorRegistry;
  stealthStore: StealthStore;
  field: RuntimeView["field"] | null;
  assist: StaminaAssist;
}) {
  const lastWriteAt = useRef(0);
  useEffect(() => {
    if (!QA_RUNTIME_ENABLED) return;
    type QaWindow = Window & {
      __PA_QA_TELEPORT__?: (x: number, z: number, faceY?: number) => void;
      __PA_QA_WALK_TO__?: (x: number, z: number, sprint?: boolean) => void;
    };
    const qaWindow = window as QaWindow;
    qaWindow.__PA_QA_TELEPORT__ = (x, z, faceY) => {
      props.apiRef.current?.teleport([x, 0, z], faceY);
    };
    qaWindow.__PA_QA_WALK_TO__ = (x, z, sprint = false) => {
      props.apiRef.current?.setQaWalkTarget([x, 0, z], sprint);
    };
    return () => {
      delete qaWindow.__PA_QA_TELEPORT__;
      delete qaWindow.__PA_QA_WALK_TO__;
    };
  }, [props.apiRef]);
  useFrame(({ scene, camera }) => {
    if (!QA_RUNTIME_ENABLED) return;
    const now = performance.now();
    if (now - lastWriteAt.current < 100) return;
    lastWriteAt.current = now;
    const api = props.apiRef.current;
    const host = props.hostRef.current;
    if (host) {
      host.dataset.cameraPos = `${camera.position.x.toFixed(2)},${camera.position.y.toFixed(2)},${camera.position.z.toFixed(2)}`;
    }
    if (api && host) {
      let objectCount = 0;
      let visibleMeshCount = 0;
      scene.traverse((object) => {
        objectCount += 1;
        if (object.visible && (object as THREE.Mesh).isMesh) {
          visibleMeshCount += 1;
        }
      });
      host.dataset.sceneObjectCount = String(objectCount);
      host.dataset.sceneVisibleMeshCount = String(visibleMeshCount);
      host.dataset.playerPos = `${api.position.x.toFixed(2)},${api.position.z.toFixed(2)}`;
      host.dataset.playerPos3d = `${api.position.x.toFixed(3)},${api.position.y.toFixed(3)},${api.position.z.toFixed(3)}`;
      host.dataset.playerMotion = api.motion.phase;
      host.dataset.playerSpeed = api.motion.speed.toFixed(3);
      host.dataset.playerClip = api.motion.clip;
      host.dataset.playerSprinting = String(api.motion.sprinting);
      host.dataset.playerCrouched = String(api.motion.crouched);
      host.dataset.playerStamina = api.motion.stamina.toFixed(3);
      host.dataset.playerMovementIntent = String(api.motion.movementIntent);
      host.dataset.playerBlocked = String(api.motion.blocked);
      host.dataset.playerFacing = `${api.motion.facingX.toFixed(3)},${api.motion.facingZ.toFixed(3)}`;
      host.dataset.playerActionSerial = String(api.motion.actionSerial);
      host.dataset.playerInputLocked = String(api.motion.inputLocked);
      host.dataset.qaWalkTarget = api.qaWalkTarget
        ? `${api.qaWalkTarget.x.toFixed(3)},${api.qaWalkTarget.z.toFixed(3)}`
        : "";
      const stealth = props.stealthStore.getSnapshot();
      host.dataset.chaseActive = String(stealth.chaseActive);
      host.dataset.chaseState = stealth.chaseState;
      host.dataset.chaseStamina = stealth.stamina.toFixed(3);
      host.dataset.chaseConfirmResolve = String(stealth.confirmResolve);
      host.dataset.chaseAssist = props.assist;
      const pursuer = props.actors.get("M1_PURSUER");
      host.dataset.pursuerRegistered = String(Boolean(pursuer));
      host.dataset.pursuerPosition = pursuer
        ? `${pursuer.position.x.toFixed(3)},${pursuer.position.y.toFixed(3)},${pursuer.position.z.toFixed(3)}`
        : "";
      host.dataset.pursuerForward = pursuer
        ? `${pursuer.forwardVec.x.toFixed(3)},${pursuer.forwardVec.y.toFixed(3)},${pursuer.forwardVec.z.toFixed(3)}`
        : "";
      host.dataset.pursuerVelocity = pursuer?.velocity
        ? `${pursuer.velocity.x.toFixed(3)},${pursuer.velocity.y.toFixed(3)},${pursuer.velocity.z.toFixed(3)}`
        : "";
      host.dataset.pursuerSpace = pursuer?.spaceId ?? "";
      host.dataset.chaseOutcome =
        props.field?.chaseHistory.at(-1)?.outcome ?? "";
      const namedIds = [
        "abigail",
        "thomas",
        "pike",
        "clarke",
        "rider",
      ];
      const namedActors = namedIds
        .map((id) => props.actors.get(id))
        .filter((actor) => Boolean(actor));
      host.dataset.namedActorIds = namedActors
        .map((actor) => actor!.id)
        .join(",");
      host.dataset.namedActorPositions = namedActors
        .map(
          (actor) =>
            `${actor!.id}:${actor!.position.x.toFixed(2)},${actor!.position.z.toFixed(2)}`,
        )
        .join(";");
    }
  });
  return null;
}
