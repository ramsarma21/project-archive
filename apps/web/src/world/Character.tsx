import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { captureRestPose, prepareLibrary, clipFor } from "./anims.js";

const ANIM_URL = "/world/anims/anim-library.glb";

// ---- Error boundary so a missing/failed GLB degrades to a placeholder ----
class GlbBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {}
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// Simple period-plausible placeholder person while a character GLB is missing.
export function PlaceholderPerson(props: { height: number; coat?: string }) {
  const h = props.height;
  const coat = props.coat ?? "#5c4a38";
  return (
    <group>
      <mesh position={[0, h * 0.42, 0]} castShadow>
        <capsuleGeometry args={[h * 0.13, h * 0.5, 6, 12]} />
        <meshStandardMaterial color={coat} roughness={0.9} />
      </mesh>
      <mesh position={[0, h * 0.86, 0]} castShadow>
        <sphereGeometry args={[h * 0.085, 16, 12]} />
        <meshStandardMaterial color="#c9a284" roughness={0.7} />
      </mesh>
    </group>
  );
}

function RiggedInner(props: { glbKey: string; height: number; clip: string; timeOffset?: number }) {
  const url = `/world/characters/${props.glbKey}.glb`;
  const gltf = useGLTF(url);
  const lib = useGLTF(ANIM_URL);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionRef = useRef<THREE.AnimationAction | null>(null);

  const rig = useMemo(() => {
    prepareLibrary(lib.scene, lib.animations);
    const root = skeletonClone(gltf.scene);
    root.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = false;
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).frustumCulled = false;
    });
    // Normalize: feet on y=0, height matched to spec.
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);
    const s = size.y > 0.01 ? props.height / size.y : 1;
    root.scale.setScalar(s);
    root.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(root);
    root.position.y -= box2.min.y;
    const rest = captureRestPose(root, "Hips");
    console.log(`[char] ${props.glbKey} rawH=${size.y.toFixed(3)} scale=${s.toFixed(4)} hipsY=${rest.hipsY.toFixed(3)}`);
    return { root, rest };
  }, [gltf.scene, lib.scene, lib.animations, props.height]);

  useEffect(() => {
    const mixer = new THREE.AnimationMixer(rig.root);
    mixerRef.current = mixer;
    return () => {
      mixer.stopAllAction();
      mixerRef.current = null;
    };
  }, [rig]);

  useEffect(() => {
    const mixer = mixerRef.current;
    if (!mixer) return;
    const clip = clipFor(props.glbKey + ":" + props.height, rig.rest, props.clip);
    if (!clip) return;
    const next = mixer.clipAction(clip);
    next.reset();
    if (props.timeOffset) next.time = props.timeOffset % clip.duration;
    next.play();
    const prev = actionRef.current;
    if (prev && prev !== next) {
      next.crossFadeFrom(prev, 0.25, false);
    }
    actionRef.current = next;
  }, [props.clip, props.glbKey, props.height, rig]);

  useFrame((_, dt) => {
    mixerRef.current?.update(dt);
  });

  return <primitive object={rig.root} />;
}

export function RiggedCharacter(props: {
  glbKey: string;
  height: number;
  clip: string;
  timeOffset?: number;
  coat?: string;
}) {
  return (
    <GlbBoundary fallback={<PlaceholderPerson height={props.height} coat={props.coat} />}>
      <Suspense fallback={<PlaceholderPerson height={props.height} coat={props.coat} />}>
        <RiggedInner glbKey={props.glbKey} height={props.height} clip={props.clip} timeOffset={props.timeOffset} />
      </Suspense>
    </GlbBoundary>
  );
}

// ---- Fitted world prop/building: normalize arbitrary Meshy GLB dimensions ----
function FittedGlbInner(props: { glbKey: string; size?: [number, number, number]; scale?: number }) {
  const gltf = useGLTF(`/world/props/${props.glbKey}.glb`);
  const obj = useMemo(() => {
    const root = skeletonClone(gltf.scene);
    root.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);
    let s = props.scale ?? 1;
    if (props.size) {
      // Fit footprint + height without distorting proportions.
      const sx = props.size[0] / (size.x || 1);
      const sy = props.size[1] / (size.y || 1);
      const sz = props.size[2] / (size.z || 1);
      s = Math.min(sx, sy, sz);
    }
    root.scale.setScalar(s);
    const box2 = new THREE.Box3().setFromObject(root);
    const center = new THREE.Vector3();
    box2.getCenter(center);
    root.position.x -= center.x;
    root.position.z -= center.z;
    root.position.y -= box2.min.y;
    return root;
  }, [gltf.scene, props.size, props.scale]);
  return <primitive object={obj} />;
}

export function FittedGlb(props: {
  glbKey: string;
  size?: [number, number, number];
  scale?: number;
  fallback: ReactNode;
}) {
  return (
    <GlbBoundary fallback={props.fallback}>
      <Suspense fallback={props.fallback}>
        <FittedGlbInner glbKey={props.glbKey} size={props.size} scale={props.scale} />
      </Suspense>
    </GlbBoundary>
  );
}
