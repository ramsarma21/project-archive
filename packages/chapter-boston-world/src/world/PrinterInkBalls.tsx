import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { QA_RUNTIME_ENABLED } from "./qaEnvironment.js";

type InkSide = "LEFT" | "RIGHT";

interface InkSignal {
  stage: string | null;
  progress: number;
  inkSide: InkSide | null;
  strokeAt: number;
}

class InkAssetBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {}
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function InkBallInner(props: {
  side: InkSide;
  reducedMotion: boolean;
}) {
  const gltf = useGLTF("/world/props/printer-ink-balls.glb?v=m4-final");
  const host = useRef<THREE.Group>(null);
  const rock = useRef<THREE.Group>(null);
  const signal = useRef<InkSignal>({
    stage: null,
    progress: 0,
    inkSide: null,
    strokeAt: 0,
  });
  const prepared = useMemo(() => {
    const scene = skeletonClone(gltf.scene);
    const rootName = props.side === "LEFT" ? "InkBall_Left" : "InkBall_Right";
    const gripName = `${rootName}_grip`;
    const rockName = `${rootName}_rock`;
    const surfaceName =
      props.side === "LEFT" ? "InkSurface_Left" : "InkSurface_Right";
    const source = scene.getObjectByName(rootName);
    if (!source) throw new Error(`printer ink asset missing ${rootName}`);
    const tool = source.clone(true);
    tool.position.set(0, 0, 0);
    tool.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      const materials = (
        Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      ).map((material) => material.clone());
      mesh.material = Array.isArray(mesh.material)
        ? materials
        : materials[0]!;
    });
    tool.updateMatrixWorld(true);
    const gripNode = tool.getObjectByName(gripName);
    const rockNode = tool.getObjectByName(rockName);
    const surfaceNode = tool.getObjectByName(surfaceName);
    if (!gripNode || !rockNode || !surfaceNode) {
      throw new Error(
        `printer ink asset missing ${gripName}/${rockName}/${surfaceName}`,
      );
    }
    const gripAt = gripNode.getWorldPosition(new THREE.Vector3());
    const rockFromGrip = rockNode
      .getWorldPosition(new THREE.Vector3())
      .sub(gripAt);
    const surfaceFromGrip = surfaceNode
      .getWorldPosition(new THREE.Vector3())
      .sub(gripAt);
    tool.position.sub(gripAt);
    tool.updateMatrixWorld(true);
    return { tool, rockFromGrip, surfaceFromGrip };
  }, [gltf.scene, props.side]);

  useEffect(() => {
    const onVisual = (raw: Event) => {
      const detail = (
        raw as CustomEvent<{
          kind?: string;
          stage?: string;
          progress?: number;
          inkSide?: InkSide;
        }>
      ).detail;
      if (detail?.kind !== "PRINT_JOB") return;
      signal.current.stage = detail.stage ?? null;
      signal.current.progress = THREE.MathUtils.clamp(
        detail.progress ?? 0,
        0,
        1,
      );
      if (detail.inkSide) {
        signal.current.inkSide = detail.inkSide;
        signal.current.strokeAt = performance.now();
      }
    };
    window.addEventListener("pa:mechanic-visual", onVisual);
    return () => window.removeEventListener("pa:mechanic-visual", onVisual);
  }, []);

  useFrame(({ clock }) => {
    const grip = host.current;
    const rocker = rock.current;
    if (!grip || !rocker) return;
    const current = signal.current;
    const visible = current.stage === "INK";
    grip.visible = visible;
    if (QA_RUNTIME_ENABLED) {
      const world = document.querySelector<HTMLElement>(".world3d");
      if (world) {
        const prefix = props.side === "LEFT" ? "inkBallLeft" : "inkBallRight";
        world.dataset[`${prefix}Visible`] = String(visible);
        world.dataset[`${prefix}Stage`] = current.stage ?? "";
        world.dataset[`${prefix}Progress`] = current.progress.toFixed(3);
        world.dataset[`${prefix}SurfaceOffset`] =
          prepared.surfaceFromGrip.toArray().map((value) => value.toFixed(3)).join(",");
      }
    }
    if (!visible) return;
    const elapsed = (performance.now() - current.strokeAt) / 1000;
    const explicit =
      current.inkSide === props.side && elapsed >= 0 && elapsed <= 0.42;
    const dab = props.reducedMotion
      ? 0
      : explicit
        ? Math.sin((elapsed / 0.42) * Math.PI)
        : Math.max(
            0,
            Math.sin(
              clock.elapsedTime * 2.4 +
                (props.side === "LEFT" ? 0 : Math.PI),
            ),
          ) * 0.08;
    // The imported grip pivot remains fixed to the first-person hand. Motion
    // happens around the authored rock pivot; the authored surface pivot
    // determines the small contact travel toward the forme.
    const contactTravel = Math.min(
      0.11,
      Math.abs(prepared.surfaceFromGrip.y) * 0.4,
    );
    grip.position.set(
      props.side === "LEFT" ? 0.02 : -0.16,
      0.28 - dab * contactTravel,
      -0.065 - dab * 0.075,
    );
    grip.rotation.set(
      props.side === "LEFT" ? 0.08 : -0.08,
      props.side === "LEFT" ? -0.18 : 0.18,
      0,
    );
    rocker.rotation.x =
      (props.side === "LEFT" ? 1 : -1) * dab * 0.42;
    rocker.rotation.z =
      (props.side === "LEFT" ? -1 : 1) * dab * 0.12;
  });

  useEffect(
    () => () => {
      if (!QA_RUNTIME_ENABLED) return;
      const world = document.querySelector<HTMLElement>(".world3d");
      if (!world) return;
      const prefix = props.side === "LEFT" ? "inkBallLeft" : "inkBallRight";
      delete world.dataset[`${prefix}Visible`];
      delete world.dataset[`${prefix}Stage`];
      delete world.dataset[`${prefix}Progress`];
      delete world.dataset[`${prefix}SurfaceOffset`];
    },
    [props.side],
  );

  return (
    <group
      ref={host}
      visible={false}
      name={`first-person-ink-ball-${props.side.toLowerCase()}`}
    >
      <group
        ref={rock}
        position={prepared.rockFromGrip}
        name={`${props.side === "LEFT" ? "InkBall_Left" : "InkBall_Right"}_rock_runtime`}
      >
        <group position={prepared.rockFromGrip.clone().multiplyScalar(-1)}>
          <primitive object={prepared.tool} dispose={null} />
        </group>
      </group>
    </group>
  );
}

/**
 * One imported common-press ink ball, isolated from the paired GLB and rooted
 * at its authored grip pivot. Mount this directly under the matching
 * first-person hand group.
 */
export function PrinterInkBall(props: {
  side: InkSide;
  reducedMotion: boolean;
}) {
  return (
    <InkAssetBoundary>
      <Suspense fallback={null}>
        <InkBallInner {...props} />
      </Suspense>
    </InkAssetBoundary>
  );
}

useGLTF.preload("/world/props/printer-ink-balls.glb?v=m4-final");
