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
import {
  DOOR_CLIP_OPEN_INWARD,
  DOOR_CLIP_OPEN_OUTWARD,
  DOOR_LEAF_CLEAR_HEIGHT,
  DOOR_LEAF_CLEAR_WIDTH,
  DOOR_FRAME_NODE,
  DOOR_KIT_GLB_KEY,
  DOOR_RECESS_NODE,
  doorwayForBuilding,
  resolveAllExteriorDoorways,
  type ResolvedDoorway,
  type TrimPolicy,
  type Vec3,
} from "./doorwayContract.js";
import {
  interiorDef,
  interiorDoorFacade,
} from "./interiorManifest.js";

export const DOOR_TARGETS = new Set([
  "THOMAS_CIRCULAR",
  "PIKE_PROOF",
  "CUSTOMHOUSE_NOTICE",
  "MERCER_REPRINT",
  "MERCER_RETURN",
  "PIKE_RETURN",
]);

const EXTERIOR_DOORS = resolveAllExteriorDoorways();

interface RenderDoor {
  doorId: string;
  targetIds: string[];
  leafCenter: Vec3;
  yaw: number;
  clearWidth: number;
  clearHeight: number;
  trim: TrimPolicy;
  direction: "INWARD" | "OUTWARD";
}

function renderDoorFromExterior(door: ResolvedDoorway): RenderDoor {
  return {
    doorId: door.doorId,
    targetIds: door.targetIds,
    leafCenter: door.leafCenter,
    yaw: door.effectiveYaw,
    clearWidth: door.clearWidth,
    clearHeight: door.clearHeight,
    trim: door.trim,
    direction: "INWARD",
  };
}

function renderDoorForInterior(interiorId: string): RenderDoor | null {
  const def = interiorDef(interiorId);
  if (!def) return null;
  const exterior = doorwayForBuilding(def.buildingId);
  const facade = interiorDoorFacade(interiorId);
  return {
    doorId: `INTERIOR_${interiorId}`,
    targetIds: ["STREET"],
    // Independent interiors use the local -Z wall as their exit. The imported
    // kit is seated just inside that wall; exterior facade placement remains
    // wholly owned by doorwayContract.
    leafCenter: [facade[0], facade[1], facade[2] + 0.06],
    yaw: Math.PI,
    clearWidth: exterior?.clearWidth ?? DOOR_LEAF_CLEAR_WIDTH,
    clearHeight: exterior?.clearHeight ?? DOOR_LEAF_CLEAR_HEIGHT,
    trim: "imported-frame",
    direction: "OUTWARD",
  };
}

class DoorAssetBoundary extends Component<
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

function DoorKitInner(props: {
  door: RenderDoor;
  open: boolean;
  reducedMotion: boolean;
}) {
  const gltf = useGLTF(`/world/props/${DOOR_KIT_GLB_KEY}.glb?v=door-kit-1`);
  const mixer = useRef<THREE.AnimationMixer | null>(null);
  const active = useRef<THREE.AnimationAction | null>(null);

  const root = useMemo(() => {
    const copy = skeletonClone(gltf.scene);
    copy.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
    const frame = copy.getObjectByName(DOOR_FRAME_NODE);
    if (frame) frame.visible = props.door.trim !== "authored-trim";
    const recess = copy.getObjectByName(DOOR_RECESS_NODE);
    if (recess) recess.visible = true;
    return copy;
  }, [gltf.scene, props.door.trim]);

  useEffect(() => {
    const next = new THREE.AnimationMixer(root);
    mixer.current = next;
    return () => {
      next.stopAllAction();
      mixer.current = null;
      active.current = null;
    };
  }, [root]);

  useEffect(() => {
    const currentMixer = mixer.current;
    if (!currentMixer || props.door.trim === "sealed-decorative") return;
    const clipName =
      props.door.direction === "INWARD"
        ? DOOR_CLIP_OPEN_INWARD
        : DOOR_CLIP_OPEN_OUTWARD;
    const clip = gltf.animations.find((candidate) => candidate.name === clipName);
    if (!clip) return;
    active.current?.stop();
    const action = currentMixer.clipAction(clip, root);
    action.reset();
    action.enabled = true;
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.time = props.open ? 0 : clip.duration;
    action.timeScale = props.open ? 1 : -1;
    action.paused = props.reducedMotion;
    action.play();
    if (props.reducedMotion) {
      action.time = props.open ? clip.duration : 0;
      currentMixer.update(0);
    }
    active.current = action;
  }, [
    gltf.animations,
    props.door.direction,
    props.door.trim,
    props.open,
    props.reducedMotion,
    root,
  ]);

  useFrame((_, dt) => {
    mixer.current?.update(Math.min(dt, 0.05));
  });

  const scaleX = props.door.clearWidth / DOOR_LEAF_CLEAR_WIDTH;
  const scaleY = props.door.clearHeight / DOOR_LEAF_CLEAR_HEIGHT;
  return (
    <group
      position={props.door.leafCenter}
      rotation={[0, props.door.yaw, 0]}
      scale={[scaleX, scaleY, 1]}
    >
      <primitive object={root} />
    </group>
  );
}

function AnimatedDoor(props: {
  door: RenderDoor;
  open: boolean;
  reducedMotion: boolean;
}) {
  return (
    <DoorAssetBoundary>
      <Suspense fallback={null}>
        <DoorKitInner {...props} />
      </Suspense>
    </DoorAssetBoundary>
  );
}

export function DoorDirector(props: {
  activeTargetId: string | null;
  interiorId: string | null;
  reducedMotion: boolean;
}) {
  const interior = props.interiorId
    ? renderDoorForInterior(props.interiorId)
    : null;
  const visibleDoors = interior
    ? [interior]
    : EXTERIOR_DOORS.map(renderDoorFromExterior);
  return (
    <group>
      {visibleDoors.map((door) => (
        <AnimatedDoor
          key={door.doorId}
          door={door}
          open={
            door.trim !== "sealed-decorative" &&
            props.activeTargetId !== null &&
            (door.targetIds.includes(props.activeTargetId) ||
              Boolean(props.interiorId))
          }
          reducedMotion={props.reducedMotion}
        />
      ))}
    </group>
  );
}

useGLTF.preload(`/world/props/${DOOR_KIT_GLB_KEY}.glb?v=door-kit-1`);
