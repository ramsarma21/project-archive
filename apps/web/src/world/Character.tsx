import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";

// Clips are pre-baked onto the shared Meshy auto-rig skeleton in Blender
// (assets/pipeline/retarget_to_meshy.py). They bind to every Meshy-rigged
// character by bone name; no runtime retargeting.
const ANIM_URL = "/world/anims/meshy-anim-library.glb";

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

// Soft radial contact shadow that grounds characters against the street.
let blobTex: THREE.CanvasTexture | null = null;
function contactShadowTexture(): THREE.CanvasTexture {
  if (blobTex) return blobTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 62);
  grad.addColorStop(0, "rgba(0,0,0,0.42)");
  grad.addColorStop(0.7, "rgba(0,0,0,0.18)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}

export function ContactShadow(props: { radius: number }) {
  const tex = useMemo(() => contactShadowTexture(), []);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} renderOrder={1}>
      <planeGeometry args={[props.radius * 2, props.radius * 2]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} />
    </mesh>
  );
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

function RiggedInner(props: { glbKey: string; height: number; clip: string; timeOffset?: number; timeScale?: number }) {
  const url = `/world/characters/${props.glbKey}.glb`;
  const gltf = useGLTF(url);
  const lib = useGLTF(ANIM_URL);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionRef = useRef<THREE.AnimationAction | null>(null);

  const rig = useMemo(() => {
    const root = skeletonClone(gltf.scene);
    root.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = false;
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).frustumCulled = false;
    });
    // Skinned-aware bounds: feet on y=0, height matched to spec.
    const measure = () => {
      root.updateMatrixWorld(true);
      const box = new THREE.Box3();
      const tmp = new THREE.Box3();
      let any = false;
      root.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (m.isSkinnedMesh) {
          m.computeBoundingBox();
          if (m.boundingBox) {
            tmp.copy(m.boundingBox).applyMatrix4(m.matrixWorld);
            any ? box.union(tmp) : box.copy(tmp);
            any = true;
          }
        } else if ((o as THREE.Mesh).isMesh) {
          tmp.setFromObject(o);
          any ? box.union(tmp) : box.copy(tmp);
          any = true;
        }
      });
      return box;
    };
    const box = measure();
    const size = new THREE.Vector3();
    box.getSize(size);
    const s = size.y > 0.01 ? props.height / size.y : 1;
    root.scale.setScalar(s);
    const box2 = measure();
    root.position.y -= box2.min.y;
    return { root };
  }, [gltf.scene, props.height]);

  useEffect(() => {
    const mixer = new THREE.AnimationMixer(rig.root);
    mixerRef.current = mixer;
    actionRef.current = null;
    return () => {
      mixer.stopAllAction();
      mixerRef.current = null;
      actionRef.current = null;
    };
  }, [rig]);

  useEffect(() => {
    const mixer = mixerRef.current;
    if (!mixer) return;
    // Prefer clips baked into the character itself (per-character retarget);
    // fall back to the shared library for rigs without embedded animations.
    const own = gltf.animations ?? [];
    const clip =
      own.find((c) => c.name === props.clip) ??
      (own.length === 0 ? lib.animations.find((c) => c.name === props.clip) : undefined) ??
      own[0] ??
      lib.animations[0];
    if (!clip) return;
    const next = mixer.clipAction(clip);
    next.reset();
    next.enabled = true;
    if (props.timeOffset) next.time = props.timeOffset % clip.duration;
    next.play();
    const prev = actionRef.current;
    if (prev && prev !== next) {
      next.crossFadeFrom(prev, 0.3, true);
    }
    actionRef.current = next;
  }, [props.clip, props.timeOffset, lib.animations, rig]);

  useFrame((_, dt) => {
    if (actionRef.current && props.timeScale !== undefined) {
      actionRef.current.timeScale = props.timeScale;
    }
    mixerRef.current?.update(dt);
  });

  return <primitive object={rig.root} />;
}

export function RiggedCharacter(props: {
  glbKey: string;
  height: number;
  clip: string;
  timeOffset?: number;
  timeScale?: number;
  coat?: string;
}) {
  return (
    <group>
      <ContactShadow radius={0.55} />
      <GlbBoundary fallback={<PlaceholderPerson height={props.height} coat={props.coat} />}>
        <Suspense fallback={<PlaceholderPerson height={props.height} coat={props.coat} />}>
          <RiggedInner glbKey={props.glbKey} height={props.height} clip={props.clip} timeOffset={props.timeOffset} timeScale={props.timeScale} />
        </Suspense>
      </GlbBoundary>
    </group>
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
