import { useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { ChoreographyCue } from "@pa/contracts";

export function CameraDirector(props: {
  cue: ChoreographyCue | null;
  active: boolean;
  reducedMotion: boolean;
}) {
  const camera = useThree((state) => state.camera);
  const lookTarget = useRef(new THREE.Vector3());

  useFrame((_, rawDt) => {
    const shot = props.cue?.camera;
    if (!props.active || !shot) return;
    const destination = new THREE.Vector3(...shot.position);
    const target = new THREE.Vector3(...shot.lookAt);
    if (props.reducedMotion || shot.firstPerson || shot.transitionMs <= 0) {
      camera.position.copy(destination);
      lookTarget.current.copy(target);
    } else {
      const dt = Math.min(rawDt, 0.05);
      const rate = Math.max(2, 5000 / shot.transitionMs);
      const blend = 1 - Math.exp(-rate * dt);
      camera.position.lerp(destination, blend);
      lookTarget.current.lerp(target, blend);
    }
    camera.lookAt(lookTarget.current);
  }, -1);

  return null;
}
