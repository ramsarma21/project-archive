import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { ActorChoreography, AuthoredMotion, ChoreographyCue } from "@pa/contracts";
import { RiggedCharacter } from "./Character.js";
import { clipForMotion } from "./animationManifest.js";
import { STAGE_ANCHORS } from "./choreography.js";
import type { NpcDef } from "./manifest.js";
import { useWorldServices } from "./WorldServicesContext.js";

const ACTOR_IDS: Record<string, ActorChoreography["actorId"]> = {
  abigail: "ABIGAIL",
  thomas: "THOMAS",
  pike: "PIKE",
  clarke: "CLARKE",
  rider: "RIDER",
  officer: "OFFICER",
  clerk: "OFFICER",
};

export function actorCueFor(npc: NpcDef, cue: ChoreographyCue | null): ActorChoreography | null {
  const actorId = ACTOR_IDS[npc.id];
  return actorId ? cue?.actors.find((actor) => actor.actorId === actorId) ?? null : null;
}

export function DirectedNpc(props: {
  npc: NpcDef;
  cue: ActorChoreography | null;
  reducedMotion: boolean;
}) {
  const { actors, spaceId, fieldTickRef } = useWorldServices();
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const registryOwner = useRef({});
  const defaultPosition = useRef(new THREE.Vector3(...props.npc.pos));

  useEffect(
    () => () => actors.remove(props.npc.id),
    [actors, props.npc.id, spaceId],
  );

  useFrame(({ clock }, dt) => {
    const group = root.current;
    const character = body.current;
    if (!group || !character) return;
    const expectedSpace = props.npc.interiorOf ?? "EXTERIOR";
    if (spaceId !== expectedSpace) {
      actors.remove(props.npc.id);
      return;
    }
    const targetArray = props.cue ? STAGE_ANCHORS[props.cue.anchorId] : undefined;
    const target = targetArray ? new THREE.Vector3(...targetArray) : defaultPosition.current;
    const positionBlend = props.reducedMotion ? 1 : 1 - Math.exp(-7 * Math.min(dt, 0.05));
    group.position.lerp(target, positionBlend);

    let desiredYaw = props.npc.rotY;
    if (props.cue?.faceAnchorId) {
      const face = STAGE_ANCHORS[props.cue.faceAnchorId];
      if (face) desiredYaw = Math.atan2(face[0] - group.position.x, face[2] - group.position.z);
    }
    group.rotation.y = lerpAngle(group.rotation.y, desiredYaw, props.reducedMotion ? 1 : positionBlend);

    const phase = props.reducedMotion ? 0 : clock.elapsedTime;
    applyProceduralMotion(character, props.cue?.motion ?? "IDLE", phase);
    actors.publish({
      id: props.npc.id,
      spaceId,
      kind: "DIRECTED_NPC",
      position: group.position,
      forwardVec: {
        x: Math.sin(group.rotation.y),
        y: 0,
        z: Math.cos(group.rotation.y),
      },
      tick: fieldTickRef.current,
      owner: registryOwner.current,
    });
  });

  const motion = props.cue?.motion ?? motionForClip(props.npc.clip);
  return (
    <group ref={root} position={props.npc.pos} rotation={[0, props.npc.rotY, 0]}>
      <group ref={body}>
        <RiggedCharacter
          glbKey={props.npc.glb}
          height={props.npc.height}
          clip={clipForMotion(props.npc.glb, motion)}
          loopOnce={motion === "CATCH" || motion === "HANDOFF"}
        />
      </group>
    </group>
  );
}

function motionForClip(clip: string): AuthoredMotion {
  return clip === "walk" ? "WALK" : "IDLE";
}

export function applyProceduralMotion(group: THREE.Group, motion: AuthoredMotion, phase: number) {
  group.position.y = 0;
  group.position.x = 0;
  group.position.z = 0;
  group.rotation.x = 0;
  group.rotation.z = 0;
  switch (motion) {
    case "TALK":
      group.rotation.z = Math.sin(phase * 2.8) * 0.012;
      break;
    case "GESTURE":
      group.rotation.z = Math.sin(phase * 2.2) * 0.03;
      group.position.y = Math.max(0, Math.sin(phase * 2.2)) * 0.012;
      break;
    case "CATCH":
      group.rotation.x = -0.08 + Math.sin(phase * 3.4) * 0.02;
      break;
    case "PRESS":
      group.rotation.x = 0.09 + Math.sin(phase * 2.6) * 0.025;
      break;
    case "READ":
      group.rotation.x = 0.06;
      break;
    case "HANDOFF":
      // Attentive lean toward the exchange with a slow breath so a quiet
      // receiving clip never reads as frozen.
      group.rotation.x = 0.045 + Math.sin(phase * 1.7) * 0.012;
      group.rotation.z = Math.sin(phase * 2.8) * 0.012;
      break;
    case "CARRY":
      group.rotation.x = 0.035;
      group.position.y = Math.max(0, Math.sin(phase * 3)) * 0.008;
      break;
    case "IDLE":
    case "WALK":
      break;
  }
}

function lerpAngle(from: number, to: number, alpha: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * alpha;
}
