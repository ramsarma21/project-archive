import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RiggedCharacter } from "./Character.js";
import type { InteriorDef, InteriorOccupantDef } from "./interiorManifest.js";

function faceYaw(
  from: [number, number, number],
  to: [number, number, number],
): number {
  return Math.atan2(to[0] - from[0], to[2] - from[2]);
}

function InteriorOccupant(props: {
  def: InteriorDef;
  occupant: InteriorOccupantDef;
  index: number;
  reducedMotion: boolean;
}) {
  const root = useRef<THREE.Group>(null);
  const path = props.occupant.path;
  const worldPoints = useMemo(
    () =>
      (path ?? [props.occupant.local]).map(
        (point) =>
          new THREE.Vector3(
            props.def.origin[0] + point[0],
            props.def.origin[1] + point[1],
            props.def.origin[2] + point[2],
          ),
      ),
    [path, props.def.origin, props.occupant.local],
  );
  const moving = Boolean(path && path.length >= 2);

  useFrame(({ clock }) => {
    const group = root.current;
    if (!group || !moving || props.reducedMotion) return;
    const a = worldPoints[0]!;
    const b = worldPoints[worldPoints.length - 1]!;
    const distance = Math.max(0.1, a.distanceTo(b));
    const duration = distance / 0.72;
    const phase = ((clock.elapsedTime + props.index * 2.7) % (duration * 2)) / duration;
    const t = phase <= 1 ? phase : 2 - phase;
    const from = phase <= 1 ? a : b;
    const to = phase <= 1 ? b : a;
    group.position.lerpVectors(a, b, t);
    group.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
  });

  const start = worldPoints[0]!;
  const localFace = props.occupant.faceLocal;
  const faceWorld: [number, number, number] = [
    props.def.origin[0] + localFace[0],
    props.def.origin[1] + localFace[1],
    props.def.origin[2] + localFace[2],
  ];
  const startTuple: [number, number, number] = [start.x, start.y, start.z];
  const clip = props.reducedMotion
    ? "idle"
    : moving
      ? "walk"
      : props.occupant.clip;
  return (
    <group
      ref={root}
      position={start}
      rotation={[0, faceYaw(startTuple, faceWorld), 0]}
    >
      <RiggedCharacter
        glbKey={props.occupant.glb}
        height={props.occupant.glb.includes("woman") ? 1.61 : 1.69}
        clip={clip}
        timeOffset={props.index * 1.37}
        timeScale={0.92 + (props.index % 3) * 0.06}
        tint={props.index % 2 ? "#b7aa95" : "#aab3aa"}
        castShadow={false}
        contactShadow
      />
    </group>
  );
}

export function InteriorPopulationDirector(props: {
  def: InteriorDef;
  reducedMotion: boolean;
}) {
  const limit = [
    "PRINTSHOP",
    "MERCHANT_SHOP",
    "COURT_OFFICE",
    "CUSTOM_HOUSE",
    "TAVERN",
    "MEETINGHOUSE",
    "WAREHOUSE",
  ].includes(props.def.archetype)
    ? 6
    : 3;
  return (
    <group>
      {props.def.occupants.slice(0, limit).map((occupant, index) => (
        <InteriorOccupant
          key={occupant.id}
          def={props.def}
          occupant={occupant}
          index={index}
          reducedMotion={props.reducedMotion}
        />
      ))}
    </group>
  );
}

