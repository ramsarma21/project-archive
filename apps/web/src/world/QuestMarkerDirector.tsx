// Objective quest-marker world renderer. Loads the imported objective marker
// kit ONCE (objective-marker-kit.glb), clones its named nodes per active
// target, drives depth-tested world rendering + material state imperatively,
// and feeds the QuestMarkerHud store with the selected target's distance /
// occlusion / screen-edge guidance. Asset failure or loading renders `null`
// (never a visible primitive), per the imported-visible-world law.
//
// Only the single ACTIVE (selected / sole forced-gold) target gets a pulse,
// distance readout, occlusion ray, and edge wedge. AVAILABLE markers stay dim,
// static aged brass with no HUD affordance. No per-frame React state churn:
// transforms/materials update in one useFrame; the HUD store is written on a
// throttle and only when a rendered value changes.

import { Component, Suspense, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import type { PlayerApi } from "./Player.js";
import {
  KIND_HAS_SEAL,
  KIND_HERO_LIFT,
  KIND_HERO_SCALE,
  KIND_NEAR_PROMPT,
  KIND_THRESHOLDS,
  type QuestMarkerKind,
} from "./questMarkerManifest.js";
import {
  DISTANCE_SAMPLE_MS,
  OCCLUSION_SAMPLE_MS,
  distanceScale,
  farLabel,
  markerState,
  pickActiveTargetId,
  planarDistance,
  projectedEdge,
  type QuestMarkerState,
  type SafeArea,
} from "./questMarkerResolver.js";
import type { QuestMarkerHudStore, QuestHudActive } from "./QuestMarkerHud.js";

const MARKER_GLB = "/world/props/objective-marker-kit.glb";
const HERO_NODE = "QuestMarker_Hero";
const SEAL_NODE = "QuestMarker_GroundSeal";

// One resolved, eligible target the director should draw. World3D builds these
// from the FREE_ROAM request + questMarkerManifest (and the active interior for
// the dynamic STREET exit marker).
export interface ResolvedQuestMarker {
  targetId: string;
  label: string;
  kind: QuestMarkerKind;
  forcedGold: boolean;
  timed: boolean; // draws the "timed" sun glyph in the HUD (RIDER_HANDBILLS)
  visualAnchor: [number, number, number];
  arrivalAnchor: [number, number, number];
}

// Screen safe-area insets (viewport fractions) so the edge wedge and labels
// clear HoloTasks (top), subtitles + controls (bottom) and mobile safe areas.
const SAFE_AREA: SafeArea = { left: 0.07, right: 0.07, top: 0.14, bottom: 0.22 };

// ---- Material state palette -------------------------------------------------
const BRASS_AVAILABLE = { roughness: 0.48, metalness: 0.72 } as const;
const BRASS_ACTIVE = { roughness: 0.34, metalness: 0.75 } as const;
const GOLD_ACTIVE = new THREE.Color(0.86, 0.62, 0.22);
const GOLD_EMISSIVE = new THREE.Color(0.95, 0.66, 0.24);
const GOLD_ACTIVE_HC = new THREE.Color(0.98, 0.92, 0.66); // near-white/gold face
const EMISSIVE_DAY = 0.45;
const EMISSIVE_DUSK = 0.7;
const EMISSIVE_HC_BOOST = 0.5; // high contrast leans on emissive, not bloom

const BOB_AMP_M = 0.01; // ~2cm peak-to-peak breathing
const BOB_PERIOD_S = 3.2;
const SWELL_PERIOD_S = 4.0;
const ARRIVE_FADE_MS = 180;

interface BuiltMaterial {
  mat: THREE.MeshStandardMaterial;
  baseColor: THREE.Color;
  baseEmissive: THREE.Color;
}

interface BuiltMarker {
  meta: ResolvedQuestMarker;
  group: THREE.Group;
  hero: THREE.Object3D;
  seal: THREE.Object3D | null;
  materials: BuiltMaterial[];
  arrivingSince: number | null;
}

function cloneMarkerPart(
  source: THREE.Object3D,
): { object: THREE.Object3D; materials: BuiltMaterial[] } {
  const object = source.clone(true);
  const materials: BuiltMaterial[] = [];
  object.position.set(0, 0, 0);
  object.rotation.set(0, 0, 0);
  object.scale.setScalar(1);
  object.traverse((o) => {
    o.userData.questMarker = true;
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    // Markers must never occlude their own occlusion ray, and never collide.
    mesh.raycast = () => {};
    const src = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const cloned = src.map((m) => (m as THREE.MeshStandardMaterial).clone());
    for (const c of cloned) {
      c.transparent = true;
      c.depthWrite = true; // normal depth test (Interaction-Spec)
      c.depthTest = true;
      materials.push({
        mat: c,
        baseColor: c.color.clone(),
        baseEmissive: c.emissive.clone(),
      });
    }
    mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0]!;
  });
  return { object, materials };
}

function applyMaterialState(
  built: BuiltMarker,
  state: QuestMarkerState,
  dusk: boolean,
  highContrast: boolean,
  reducedMotion: boolean,
  elapsed: number,
  opacity: number,
): void {
  const isActive = state !== "AVAILABLE" && state !== "HIDDEN";
  for (const bm of built.materials) {
    const m = bm.mat;
    m.opacity = opacity;
    if (!isActive) {
      m.color.copy(bm.baseColor);
      m.emissive.copy(bm.baseEmissive);
      m.emissiveIntensity = 0;
      m.roughness = BRASS_AVAILABLE.roughness;
      m.metalness = BRASS_AVAILABLE.metalness;
      if (highContrast) {
        // Available stays neutral brass, but lifts a touch so it reads as a
        // solid object (never relying on colour alone).
        m.color.lerp(new THREE.Color(0.5, 0.42, 0.26), 0.5);
      }
      continue;
    }
    m.color.copy(highContrast ? GOLD_ACTIVE_HC : GOLD_ACTIVE);
    m.emissive.copy(GOLD_EMISSIVE);
    m.roughness = BRASS_ACTIVE.roughness;
    m.metalness = BRASS_ACTIVE.metalness;
    const base = (dusk ? EMISSIVE_DUSK : EMISSIVE_DAY) + (highContrast ? EMISSIVE_HC_BOOST : 0);
    // Restrained emissive swell only while ACTIVE (not NEARBY/ARRIVING) and not
    // reduced motion; otherwise a steady glow.
    const swell =
      state === "ACTIVE" && !reducedMotion
        ? Math.sin((elapsed * (Math.PI * 2)) / SWELL_PERIOD_S) * 0.12
        : 0;
    m.emissiveIntensity = Math.max(0, base + swell);
  }
}

class MarkerBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {}
  render() {
    // Asset failure -> render nothing at all (never a primitive fallback).
    return this.state.failed ? null : this.props.children;
  }
}

function QuestMarkerDirectorInner(props: {
  markers: ResolvedQuestMarker[];
  selectedTargetId: string | null;
  apiRef: { current: PlayerApi | null };
  reducedMotion: boolean;
  highContrast: boolean;
  dusk: boolean;
  hudStore: QuestMarkerHudStore;
  hostRef: { current: HTMLDivElement | null };
  onSelect: (targetId: string) => void;
}) {
  const gltf = useGLTF(MARKER_GLB);
  const scene = useThree((s) => s.scene);
  const sources = useMemo(() => {
    const nodes = gltf.nodes as Record<string, THREE.Object3D | undefined>;
    return {
      hero: nodes[HERO_NODE] ?? null,
      seal: nodes[SEAL_NODE] ?? null,
    };
  }, [gltf.nodes]);

  const built = useMemo<BuiltMarker[]>(() => {
    if (!sources.hero) return [];
    return props.markers.map((meta) => {
      const group = new THREE.Group();
      const heroPart = cloneMarkerPart(sources.hero!);
      const materials = [...heroPart.materials];
      group.add(heroPart.object);
      let seal: THREE.Object3D | null = null;
      if (KIND_HAS_SEAL[meta.kind] && sources.seal) {
        const sealPart = cloneMarkerPart(sources.seal);
        materials.push(...sealPart.materials);
        seal = sealPart.object;
        group.add(sealPart.object);
      }
      return { meta, group, hero: heroPart.object, seal, materials, arrivingSince: null };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources.hero, sources.seal, props.markers]);

  const raycaster = useRef(new THREE.Raycaster());
  const tmpTarget = useRef(new THREE.Vector3());
  const tmpDir = useRef(new THREE.Vector3());
  const tmpProj = useRef(new THREE.Vector3());
  const tmpView = useRef(new THREE.Vector3());
  const lastDistAt = useRef(0);
  const lastOccAt = useRef(0);
  const lastHudAt = useRef(0);
  const occludedRef = useRef(false);

  useFrame(({ camera, clock }) => {
    if (built.length === 0) return;
    const api = props.apiRef.current;
    const px = api?.position.x ?? camera.position.x;
    const pz = api?.position.z ?? camera.position.z;
    const now = performance.now();
    const elapsed = clock.elapsedTime;
    const distTick = now - lastDistAt.current >= DISTANCE_SAMPLE_MS;
    if (distTick) lastDistAt.current = now;

    const activeId = pickActiveTargetId(
      props.markers.map((m) => ({ targetId: m.targetId, forcedGold: m.forcedGold })),
      props.selectedTargetId,
    );

    let activeHud: QuestHudActive | null = null;

    for (const b of built) {
      const meta = b.meta;
      const [vx, , vz] = meta.visualAnchor;
      const d = planarDistance(px, pz, vx, vz);
      const th = KIND_THRESHOLDS[meta.kind];
      const isActive = meta.targetId === activeId;
      const state = markerState({
        eligible: true,
        active: isActive,
        distanceM: d,
        nearM: th.near,
        arrivalM: th.arrival,
      });

      // ---- Transform: distance scale + breathing bob (active, not nearby) ---
      const heroScale = KIND_HERO_SCALE[meta.kind] * distanceScale(d, "HERO");
      b.group.position.set(vx, 0, vz);
      b.hero.scale.setScalar(heroScale);
      const canBreathe = state === "ACTIVE" && !props.reducedMotion;
      const bob = canBreathe
        ? Math.sin((elapsed * (Math.PI * 2)) / BOB_PERIOD_S) * BOB_AMP_M
        : 0;
      b.hero.position.set(0, KIND_HERO_LIFT[meta.kind] + bob, 0);
      if (b.seal) {
        const sealScale = distanceScale(d, "SEAL");
        b.seal.scale.setScalar(sealScale);
        b.seal.position.set(0, 0.011, 0);
      }

      // ---- Arriving fade -> then World3D's arrival tracker fires onArrive ---
      let opacity = 1;
      if (state === "ARRIVING") {
        if (b.arrivingSince === null) b.arrivingSince = now;
        const p = Math.min(1, (now - b.arrivingSince) / ARRIVE_FADE_MS);
        opacity = 1 - p * 0.82;
      } else {
        b.arrivingSince = null;
      }

      applyMaterialState(
        b,
        state,
        props.dusk,
        props.highContrast,
        props.reducedMotion,
        elapsed,
        opacity,
      );

      // ---- HUD / occlusion / edge guidance: ACTIVE target only -------------
      if (isActive) {
        // Occlusion + LOS at <= 8 Hz.
        if (now - lastOccAt.current >= Math.max(OCCLUSION_SAMPLE_MS, 200)) {
          lastOccAt.current = now;
          tmpTarget.current.set(vx, KIND_HERO_LIFT[meta.kind] + 0.15, vz);
          tmpDir.current.copy(tmpTarget.current).sub(camera.position);
          const targetDist = tmpDir.current.length();
          tmpDir.current.normalize();
          raycaster.current.set(camera.position, tmpDir.current);
          raycaster.current.far = targetDist - 0.3;
          const hits = raycaster.current.intersectObjects(scene.children, true);
          let occluded = false;
          for (const hit of hits) {
            let o: THREE.Object3D | null = hit.object;
            let skip = false;
            while (o) {
              if (o.userData?.questMarker) {
                skip = true;
                break;
              }
              o = o.parent;
            }
            if (skip) continue;
            const mat = (hit.object as THREE.Mesh).material as THREE.Material | undefined;
            if (mat && (mat as THREE.Material).transparent) continue; // water/sky/fog
            occluded = true;
            break;
          }
          occludedRef.current = occluded;
        }

        // Project the label anchor (above the hero) to screen space.
        tmpProj.current.set(vx, KIND_HERO_LIFT[meta.kind] + 0.32 * heroScale + 0.14, vz);
        tmpView.current.copy(tmpProj.current).applyMatrix4(camera.matrixWorldInverse);
        const behind = tmpView.current.z >= 0;
        tmpProj.current.project(camera);
        const edge = projectedEdge({
          ndcX: tmpProj.current.x,
          ndcY: tmpProj.current.y,
          behindCamera: behind,
          safe: SAFE_AREA,
        });
        const occluded = occludedRef.current;
        const onScreen = edge.onScreen && !occluded;
        const near = state === "NEARBY" || state === "ARRIVING";
        activeHud = {
          targetId: meta.targetId,
          label: meta.label,
          state: state === "AVAILABLE" || state === "HIDDEN" ? "ACTIVE" : state,
          distanceM: Math.max(0, Math.round(d)),
          nearPrompt: KIND_NEAR_PROMPT[meta.kind],
          timed: meta.timed,
          onScreen,
          occluded,
          labelX: edge.onScreen ? edge.x : 0.5,
          labelY: edge.onScreen ? edge.y : 0.5,
          edgeX: edge.x,
          edgeY: edge.y,
          edgeAngleRad: edge.angleRad,
        };
        void near;
      }
    }

    // Throttle HUD store writes (~30 Hz); store dedupes unchanged snapshots.
    if (now - lastHudAt.current >= 33) {
      lastHudAt.current = now;
      props.hudStore.set({
        active: activeHud,
        highContrast: props.highContrast,
        reducedMotion: props.reducedMotion,
      });
      const host = props.hostRef.current;
      if (host) {
        host.dataset.questActiveId = activeHud?.targetId ?? "";
        host.dataset.questState = activeHud?.state ?? "";
        host.dataset.questDistance = activeHud ? String(activeHud.distanceM) : "";
        host.dataset.questOccluded = activeHud ? String(activeHud.occluded) : "";
        host.dataset.questEdgeVisible = String(Boolean(activeHud && !activeHud.onScreen));
      }
    }
  });

  return (
    <group>
      {built.map((b) => (
        <group
          key={b.meta.targetId}
          onClick={(event) => {
            event.stopPropagation();
            props.onSelect(b.meta.targetId);
          }}
        >
          <primitive object={b.group} />
          {/* Invisible, non-colliding click target (raycastable for mouse
              selection; excluded from occlusion via userData tag). */}
          <mesh
            position={[
              b.meta.visualAnchor[0],
              KIND_HERO_LIFT[b.meta.kind] + 0.2,
              b.meta.visualAnchor[2],
            ]}
            userData={{ questMarker: true }}
          >
            <boxGeometry args={[0.7, 0.9, 0.7]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function QuestMarkerDirector(props: {
  markers: ResolvedQuestMarker[];
  selectedTargetId: string | null;
  apiRef: { current: PlayerApi | null };
  reducedMotion: boolean;
  highContrast: boolean;
  dusk: boolean;
  hudStore: QuestMarkerHudStore;
  hostRef: { current: HTMLDivElement | null };
  onSelect: (targetId: string) => void;
}) {
  if (props.markers.length === 0) return null;
  return (
    <MarkerBoundary>
      <Suspense fallback={null}>
        <QuestMarkerDirectorInner {...props} />
      </Suspense>
    </MarkerBoundary>
  );
}

useGLTF.preload(MARKER_GLB);
