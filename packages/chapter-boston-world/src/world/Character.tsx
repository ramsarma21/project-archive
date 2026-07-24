import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  chooseAvailableClip,
  compactPlayerAirborneClips,
  PLAYER_ACTION_CLIPS,
} from "./animationManifest.js";

// ---- Error boundary so a missing/failed GLB degrades to a placeholder ----
// TRANSIENT failures retry (feel-audit-1 P1-12): dev-server hiccups and
// aborted in-flight fetches (net::ERR_ABORTED on double-mount churn) used to
// latch `failed` for the whole session, leaving imported-only rigs invisible
// — markers and exchanges attached to empty air, a QA fail state under the
// imported-visible-world law. Each retry evicts the rejected loader cache
// entry (onBeforeRetry) and re-suspends with exponential backoff.
class GlbBoundary extends Component<
  {
    fallback: ReactNode;
    children: ReactNode;
    onBeforeRetry?: () => void;
    maxRetries?: number;
  },
  { failed: boolean; attempts: number }
> {
  state = { failed: false, attempts: 0 };
  private retryTimer = 0;
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    const max = this.props.maxRetries ?? 3;
    if (this.state.attempts >= max) {
      console.error("GLB load failed permanently after retries", error);
      return;
    }
    const delay = 600 * 2 ** this.state.attempts;
    window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => {
      this.props.onBeforeRetry?.();
      this.setState((state) => ({ failed: false, attempts: state.attempts + 1 }));
    }, delay);
  }
  componentWillUnmount() {
    window.clearTimeout(this.retryTimer);
  }
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

// Ambient rigs opt into skipping animation-mixer updates when far from the
// camera (World-Design-Bible §9 perf cap). Far rigs advance in coarse steps
// so distant crowds still drift instead of freezing solid.
const ANIM_THROTTLE_DISTANCE_M = 35;
const ANIM_THROTTLE_STEP_S = 0.5;
const throttleScratch = new THREE.Vector3();
const viewCullScratch = new THREE.Vector3();

function RiggedInner(props: {
  glbKey: string;
  height: number;
  clip: string;
  timeOffset?: number;
  timeScale?: number;
  timeScaleRef?: { current: number };
  loopOnce?: boolean;
  castShadow?: boolean;
  tint?: string;
  distanceAnimThrottle?: boolean;
  cullBeyondM?: number;
  probeId?: string;
  // Fired when a loopOnce action clip reaches its final frame. Physics owns
  // the displacement/landing; this lets a caller drive the visible recovery.
  onActionComplete?: () => void;
}) {
  const url = `/world/characters/${props.glbKey}.glb?v=production-cast-6`;
  const gltf = useGLTF(url);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionRef = useRef<THREE.AnimationAction | null>(null);
  const throttleAccum = useRef(0);
  const castShadow = props.castShadow ?? true;
  const onActionCompleteRef = useRef(props.onActionComplete);
  const pendingResourceDispose = useRef<{
    rig: THREE.Object3D;
    timer: number;
  } | null>(null);
  onActionCompleteRef.current = props.onActionComplete;

  const rig = useMemo(() => {
    const root = skeletonClone(gltf.scene);
    const tintColor = props.tint ? new THREE.Color(props.tint) : null;
    const skeletons = new Set<THREE.Skeleton>();
    const ownedMaterials = new Set<THREE.Material>();
    root.traverse((o) => {
      o.castShadow = castShadow;
      o.receiveShadow = false;
      if ((o as THREE.Mesh).isMesh) {
        const mesh = o as THREE.Mesh;
        const skinned = mesh as THREE.SkinnedMesh;
        if (skinned.isSkinnedMesh) skeletons.add(skinned.skeleton);
        mesh.frustumCulled = false;
        if (tintColor) {
          // skeletonClone shares materials across instances; clone before
          // tinting so re-used ambient GLBs can wear different hues.
          const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          const cloned = source.map((material) => {
            const copy = material.clone();
            ownedMaterials.add(copy);
            const color = (copy as THREE.MeshStandardMaterial).color;
            if (color instanceof THREE.Color) color.multiply(tintColor);
            return copy;
          });
          mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0]!;
        }
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          // Generated clothing can contain thin or inconsistently wound
          // surfaces. Render both faces and solid depth so shoulders/vests do
          // not appear hollow or transparent from side and rear cameras.
          material.side = THREE.DoubleSide;
          material.depthWrite = true;
          material.needsUpdate = true;
        }
      }
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
    return { root, skeletons, ownedMaterials };
  }, [gltf.scene, props.height, castShadow, props.tint]);
  const animationClips = useMemo(
    () => compactPlayerAirborneClips(props.glbKey, gltf.animations),
    [gltf.animations, props.glbKey],
  );

  useEffect(() => {
    const pending = pendingResourceDispose.current;
    if (pending?.rig === rig.root) {
      window.clearTimeout(pending.timer);
      pendingResourceDispose.current = null;
    }
    const mixer = new THREE.AnimationMixer(rig.root);
    mixerRef.current = mixer;
    actionRef.current = null;
    // Mixer completion fires the recovery callback for loopOnce action clips.
    const onFinished = () => onActionCompleteRef.current?.();
    mixer.addEventListener("finished", onFinished);
    return () => {
      mixer.removeEventListener("finished", onFinished);
      mixer.stopAllAction();
      mixer.uncacheRoot(rig.root);
      mixerRef.current = null;
      actionRef.current = null;
      // StrictMode immediately re-runs effects against the same memoized rig.
      // Delay owned-resource disposal one task so that rehearsal can cancel it,
      // while a real unmount releases per-clone bone textures and tint materials.
      const timer = window.setTimeout(() => {
        for (const skeleton of rig.skeletons) skeleton.dispose();
        for (const material of rig.ownedMaterials) material.dispose();
        if (pendingResourceDispose.current?.rig === rig.root) {
          pendingResourceDispose.current = null;
        }
      }, 0);
      pendingResourceDispose.current = { rig: rig.root, timer };
    };
  }, [rig]);

  useEffect(() => {
    const mixer = mixerRef.current;
    if (!mixer) return;
    // Every production character is a self-contained GLB with clips baked
    // against its own rig. Never bind a shared clip from another skeleton.
    const clipName = chooseAvailableClip(
      props.glbKey,
      props.clip,
      animationClips.map((clip) => clip.name),
    );
    const clip = clipName
      ? animationClips.find((candidate) => candidate.name === clipName)
      : undefined;
    if (!clip) return;
    const next = mixer.clipAction(clip);
    const prev = actionRef.current;
    let locomotionPhase: number | null = null;
    if (prev && prev !== next) {
      const prevClip = prev.getClip();
      if (["walk", "run"].includes(prevClip.name) && ["walk", "run"].includes(clip.name) && prevClip.duration > 0) {
        locomotionPhase = (prev.time % prevClip.duration) / prevClip.duration;
      }
    }
    next.reset();
    next.enabled = true;
    next.setLoop(props.loopOnce ? THREE.LoopOnce : THREE.LoopRepeat, props.loopOnce ? 1 : Infinity);
    next.clampWhenFinished = Boolean(props.loopOnce);
    if (props.timeOffset) next.time = props.timeOffset % clip.duration;
    else if (locomotionPhase !== null) next.time = locomotionPhase * clip.duration;
    next.play();
    if (prev && prev !== next) {
      // Snap into short one-shot action clips (jump/vault/climb/knock) so the
      // authored verb reads immediately; blend locomotion normally.
      const fade = PLAYER_ACTION_CLIPS.has(clip.name) ? 0.12 : 0.3;
      next.crossFadeFrom(prev, fade, true);
    }
    actionRef.current = next;
  }, [props.clip, props.timeOffset, props.loopOnce, animationClips, rig]);

  useFrame(({ camera }, dt) => {
    if (actionRef.current) {
      actionRef.current.timeScale = props.timeScaleRef?.current ?? props.timeScale ?? 1;
    }
    const mixer = mixerRef.current;
    if (!mixer) return;
    if (props.distanceAnimThrottle) {
      rig.root.getWorldPosition(throttleScratch);
      const dist = camera.position.distanceTo(throttleScratch);
      // Far imposture cull: a tripled ambient pool must not pay draw + skinning
      // cost across the whole map, so rigs beyond the cull radius are hidden
      // (three.js skips invisible subtrees) and their mixer freezes. They snap
      // back deterministically on approach because positions are pure functions
      // of clock time, not per-frame integration.
      const cull = props.cullBeyondM ?? Infinity;
      if (dist > cull) {
        if (rig.root.visible) rig.root.visible = false;
        return;
      }
      const perspective = camera as THREE.PerspectiveCamera;
      if (dist > 10 && perspective.isPerspectiveCamera) {
        viewCullScratch.copy(throttleScratch).applyMatrix4(camera.matrixWorldInverse);
        const forward = -viewCullScratch.z;
        const halfHeight =
          Math.tan(THREE.MathUtils.degToRad(perspective.fov * 0.5)) * forward;
        const halfWidth = halfHeight * perspective.aspect;
        // A generous world-space gutter provides turn hysteresis while still
        // removing costly skinned rigs several blocks behind the camera.
        if (
          forward <= 0 ||
          Math.abs(viewCullScratch.x) > halfWidth + 6 ||
          Math.abs(viewCullScratch.y) > halfHeight + 4
        ) {
          if (rig.root.visible) rig.root.visible = false;
          return;
        }
      }
      if (!rig.root.visible) rig.root.visible = true;
      if (dist > ANIM_THROTTLE_DISTANCE_M) {
        // Mid rig: bank time and step the mixer coarsely (~2 Hz).
        throttleAccum.current += dt;
        if (throttleAccum.current >= ANIM_THROTTLE_STEP_S) {
          mixer.update(throttleAccum.current);
          throttleAccum.current = 0;
        }
        return;
      }
      if (throttleAccum.current > 0) {
        mixer.update(throttleAccum.current);
        throttleAccum.current = 0;
        return;
      }
    }
    mixer.update(dt);
  });

  return <primitive object={rig.root} />;
}

export function RiggedCharacter(props: {
  glbKey: string;
  height: number;
  clip: string;
  timeOffset?: number;
  timeScale?: number;
  timeScaleRef?: { current: number };
  loopOnce?: boolean;
  coat?: string;
  castShadow?: boolean;
  // Multiplicative material hue applied on load: lets 2-4 shared ambient GLBs
  // read as different townsfolk (Bible §9). Story NPCs never pass this.
  tint?: string;
  // Opt-in for ambient rigs only: skip mixer updates beyond ~35m.
  distanceAnimThrottle?: boolean;
  // Opt-in for ambient rigs only: hide + freeze the rig beyond this radius so a
  // dense population never draws across the whole map (§9 perf). Hero rigs omit.
  cullBeyondM?: number;
  // Stable id so a dev harness can count currently-drawn ambient rigs.
  probeId?: string;
  onActionComplete?: () => void;
  contactShadow?: boolean;
  // Dedicated gameplay actors may require imported-only failure behavior:
  // when false, loading/missing assets render nothing instead of a debug body.
  showFallback?: boolean;
}) {
  const fallback =
    props.showFallback === false
      ? null
      : <PlaceholderPerson height={props.height} coat={props.coat} />;
  const glbKey = props.glbKey;
  return (
    <group>
      {props.contactShadow !== false && <ContactShadow radius={0.55} />}
      <GlbBoundary
        fallback={fallback}
        onBeforeRetry={() =>
          useGLTF.clear(`/world/characters/${glbKey}.glb?v=production-cast-6`)
        }
      >
        <Suspense fallback={fallback}>
          <RiggedInner
            glbKey={props.glbKey}
            height={props.height}
            clip={props.clip}
            timeOffset={props.timeOffset}
            timeScale={props.timeScale}
            timeScaleRef={props.timeScaleRef}
            loopOnce={props.loopOnce}
            castShadow={props.castShadow}
            tint={props.tint}
            distanceAnimThrottle={props.distanceAnimThrottle}
            cullBeyondM={props.cullBeyondM}
            probeId={props.probeId}
            onActionComplete={props.onActionComplete}
          />
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
    <GlbBoundary
      fallback={props.fallback}
      onBeforeRetry={() => useGLTF.clear(`/world/props/${props.glbKey}.glb`)}
    >
      <Suspense fallback={props.fallback}>
        <FittedGlbInner glbKey={props.glbKey} size={props.size} scale={props.scale} />
      </Suspense>
    </GlbBoundary>
  );
}

function ImportedStructureInner(props: {
  glbKey: string;
  size: [number, number, number];
  rotateShell?: boolean;
}) {
  const gltf = useGLTF(`/world/structures/${props.glbKey}.glb`);
  const object = useMemo(() => {
    const root = skeletonClone(gltf.scene);
    root.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        node.castShadow = false;
        node.receiveShadow = true;
        node.frustumCulled = true;
      }
    });
    const source = new THREE.Box3().setFromObject(root);
    const sourceSize = source.getSize(new THREE.Vector3());
    // Structural concepts put their authored entrance on local -X. Rotate the
    // shell into the runtime convention (entrance on -Z), so source X maps to
    // room depth and source Z maps to room width.
    const targetX = props.rotateShell === false ? props.size[0] : props.size[2];
    const targetZ = props.rotateShell === false ? props.size[2] : props.size[0];
    root.scale.set(
      targetX / Math.max(sourceSize.x, 0.001),
      props.size[1] / Math.max(sourceSize.y, 0.001),
      targetZ / Math.max(sourceSize.z, 0.001),
    );
    const fitted = new THREE.Box3().setFromObject(root);
    const center = fitted.getCenter(new THREE.Vector3());
    root.position.set(-center.x, -fitted.min.y, -center.z);
    root.rotation.y = props.rotateShell === false ? 0 : -Math.PI / 2;
    return root;
  }, [gltf.scene, props.glbKey, props.rotateShell, props.size]);
  return <primitive object={object} />;
}

/**
 * Imported structural shell/floor module. Loading or parse failure renders
 * nothing; production never substitutes primitive room geometry.
 */
export function ImportedStructure(props: {
  glbKey: string;
  size: [number, number, number];
  rotateShell?: boolean;
}) {
  return (
    <GlbBoundary
      fallback={null}
      onBeforeRetry={() => useGLTF.clear(`/world/structures/${props.glbKey}.glb`)}
    >
      <Suspense fallback={null}>
        <ImportedStructureInner {...props} />
      </Suspense>
    </GlbBoundary>
  );
}

function ImportedTexturedPropInner(props: {
  glbKey: string;
  size: [number, number, number];
  texture: THREE.Texture;
}) {
  const gltf = useGLTF(`/world/props/${props.glbKey}.glb`);
  const object = useMemo(() => {
    const root = skeletonClone(gltf.scene);
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(
        (source) => {
          const material = source.clone() as THREE.MeshStandardMaterial;
          material.map = props.texture;
          material.color.set("#ffffff");
          material.roughness = 0.92;
          material.metalness = 0;
          material.side = THREE.DoubleSide;
          material.needsUpdate = true;
          return material;
        },
      );
      mesh.material = Array.isArray(mesh.material) ? materials : materials[0]!;
    });
    const box = new THREE.Box3().setFromObject(root);
    const sourceSize = box.getSize(new THREE.Vector3());
    const scale = Math.min(
      props.size[0] / Math.max(sourceSize.x, 0.001),
      props.size[1] / Math.max(sourceSize.y, 0.001),
      props.size[2] / Math.max(sourceSize.z, 0.001),
    );
    root.scale.setScalar(scale);
    const fitted = new THREE.Box3().setFromObject(root);
    const center = fitted.getCenter(new THREE.Vector3());
    root.position.set(-center.x, -fitted.min.y, -center.z);
    return root;
  }, [gltf.scene, props.glbKey, props.size, props.texture]);
  return <primitive object={object} />;
}

/**
 * Imported physical surface with a runtime-authored document texture. Only the
 * material changes; the visible paper geometry remains the generated GLB.
 */
export function ImportedTexturedProp(props: {
  glbKey?: string;
  size: [number, number, number];
  texture: THREE.Texture;
}) {
  const glbKey = props.glbKey ?? "int-paper-surface-flat";
  return (
    <GlbBoundary
      fallback={null}
      onBeforeRetry={() => useGLTF.clear(`/world/props/${glbKey}.glb`)}
    >
      <Suspense fallback={null}>
        <ImportedTexturedPropInner
          glbKey={glbKey}
          size={props.size}
          texture={props.texture}
        />
      </Suspense>
    </GlbBoundary>
  );
}

function ImportedSurfaceInner(props: {
  glbKey: string;
  size: [number, number];
  relief: number;
}) {
  const gltf = useGLTF(`/world/props/${props.glbKey}.glb`);
  const object = useMemo(() => {
    const root = skeletonClone(gltf.scene);
    root.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        node.castShadow = false;
        node.receiveShadow = true;
      }
    });

    // Meshy preserves the concept's useful proportions, but street modules
    // need exact fitted seams in world space. Scale the imported geometry
    // (never a generated Three mesh) to the requested footprint and relief.
    const sourceBox = new THREE.Box3().setFromObject(root);
    const sourceSize = sourceBox.getSize(new THREE.Vector3());
    root.scale.set(
      props.size[0] / Math.max(sourceSize.x, 0.001),
      props.relief / Math.max(sourceSize.y, 0.001),
      props.size[1] / Math.max(sourceSize.z, 0.001),
    );

    const fittedBox = new THREE.Box3().setFromObject(root);
    const center = fittedBox.getCenter(new THREE.Vector3());
    root.position.set(-center.x, -fittedBox.min.y, -center.z);
    return root;
  }, [gltf.scene, props.size, props.relief]);

  return <primitive object={object} />;
}

/**
 * Exact-footprint visual surface backed exclusively by an imported GLB.
 * Missing/loading assets render nothing rather than a visible primitive
 * fallback; gameplay collision remains owned by the existing player system.
 */
export function ImportedSurface(props: {
  glbKey: string;
  size: [number, number];
  relief?: number;
}) {
  return (
    <GlbBoundary
      fallback={null}
      onBeforeRetry={() => useGLTF.clear(`/world/props/${props.glbKey}.glb`)}
    >
      <Suspense fallback={null}>
        <ImportedSurfaceInner
          glbKey={props.glbKey}
          size={props.size}
          relief={props.relief ?? 0.25}
        />
      </Suspense>
    </GlbBoundary>
  );
}
