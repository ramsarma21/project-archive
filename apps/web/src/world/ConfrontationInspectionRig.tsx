import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { FittedGlb } from "./Character.js";

/** Camera-space imported satchel used during the physical comply inspection. */
export function ConfrontationInspectionRig(props: {
  active: boolean;
  reducedMotion: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const camera = useThree((state) => state.camera);

  useFrame(({ clock }) => {
    const root = group.current;
    if (!root) return;
    root.visible = props.active;
    if (!props.active) return;
    root.position.copy(camera.position);
    root.quaternion.copy(camera.quaternion);
    root.translateZ(-1.15);
    root.translateY(-0.48);
    if (!props.reducedMotion) {
      root.rotation.z += Math.sin(clock.elapsedTime * 2.4) * 0.001;
    }
  });

  return (
    <group ref={group} visible={false}>
      <group rotation={[0.2, 0, -0.08]}>
        <FittedGlb
          glbKey="paper-satchel"
          size={[0.72, 0.42, 0.5]}
          fallback={<group />}
        />
      </group>
    </group>
  );
}
