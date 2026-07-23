import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  normalizeInteriorMaterials,
  surfaceKindForStructure,
  type InteriorSurfaceKind,
} from "./interiorMaterials.js";

// ---------------------------------------------------------------------------
// Interior-only structural loader.
//
// Deliberately separate from Character.tsx's ImportedStructure so the interior
// visual-correction can own its fitting/material/pivot rules without touching
// the exterior/world path (owned by other workers). Rules enforced here:
//
//  - Materials are cloned + normalized (interiorMaterials.ts) and disposed on
//    unmount; shared GLTF resources are never mutated.
//  - Shells rotate by explicit `yaw` metadata (canonical assets author their
//    entrance on -Z with yaw 0; legacy cutaway assets authored -X → yaw -PI/2).
//  - Horizontal fitting anisotropy is clamped for `canonical` assets so a
//    matching shell variant is scaled, not stretched 3–8×. Legacy assets keep
//    per-axis fitting until they are regenerated (their normalized ~1.9 cube
//    cannot avoid anisotropy without new proportioned geometry).
//  - Floors mount their authored top surface at local y=0 (no bbox grounding,
//    no coplanar y=-0.02 overlap with a shell's embedded floor).
//  - Loading/parse failure renders nothing (imported-only law: never a visible
//    primitive fallback).
// ---------------------------------------------------------------------------

class InteriorStructureBoundary extends Component<
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

// Max horizontal (X vs Z) scale ratio allowed for canonical assets: matches the
// runtime fitting anisotropy budget (<=1.15x).
const MAX_HORIZONTAL_ANISOTROPY = 1.15;

export interface InteriorFloorGrid {
  columns: number;
  rows: number;
  cellWidth: number;
  cellDepth: number;
  horizontalAnisotropy: number;
}

/**
 * Choose a square-ish imported floor tile grid. Every tile fills one exact
 * cell; the cell X/Z ratio is <=1.15 so neither geometry nor UVs are stretched
 * across a whole 14–38m room. The 5.5m target keeps common rooms near 6–12
 * tiles and the meetinghouse below 40.
 */
export function chooseInteriorFloorGrid(width: number, depth: number): InteriorFloorGrid {
  let best: InteriorFloorGrid | null = null;
  let bestScore = Infinity;
  for (let columns = 1; columns <= 10; columns++) {
    for (let rows = 1; rows <= 12; rows++) {
      const cellWidth = width / columns;
      const cellDepth = depth / rows;
      const horizontalAnisotropy = Math.max(
        cellWidth / cellDepth,
        cellDepth / cellWidth,
      );
      if (horizontalAnisotropy > MAX_HORIZONTAL_ANISOTROPY + 1e-6) continue;
      const tiles = columns * rows;
      const cellScalePenalty = Math.abs((cellWidth + cellDepth) * 0.5 - 5.5);
      // Prefer fewer draw units, but not enormous cells that would magnify a
      // single imported texture over the whole room.
      const oversizePenalty = Math.max(0, cellWidth - 7) * 5 + Math.max(0, cellDepth - 7) * 5;
      const score = tiles * 0.18 + cellScalePenalty + oversizePenalty;
      if (score < bestScore) {
        bestScore = score;
        best = { columns, rows, cellWidth, cellDepth, horizontalAnisotropy };
      }
    }
  }
  // All authored room dimensions have a solution in the search range.
  return best ?? {
    columns: 1,
    rows: 1,
    cellWidth: width,
    cellDepth: depth,
    horizontalAnisotropy: Math.max(width / depth, depth / width),
  };
}

export interface InteriorStructureProps {
  glbKey: string;
  /** Target [width(x), height(y), depth(z)] in metres. */
  size: [number, number, number];
  /** Explicit yaw applied to the imported shell (radians). */
  yaw?: number;
  /**
   * "shell": ground the module so its floor plane sits at local y=0.
   * "floor": mount the authored top surface at local y=0 (extends downward).
   */
  variant: "shell" | "floor";
  /** Semantic surface for the roughness band; inferred from key if omitted. */
  materialKind?: InteriorSurfaceKind;
  /** Thin partitions are the only double-sided structural surface. */
  doubleSided?: boolean;
  /**
   * Canonical (regenerated) assets carry intended proportions, so horizontal
   * anisotropy is clamped and vertical is fitted to room height. Legacy assets
   * keep independent per-axis fitting (default).
   */
  canonical?: boolean;
}

function InteriorStructureInner(props: InteriorStructureProps) {
  const gltf = useGLTF(`/world/structures/${props.glbKey}.glb`);
  const ownedRef = useRef<Set<THREE.Material> | null>(null);

  const object = useMemo(() => {
    const root = skeletonClone(gltf.scene);
    root.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        node.castShadow = false; // structural shadow casting stays disabled until clean
        node.receiveShadow = true;
        node.frustumCulled = true;
      }
    });

    // Double-sided policy: thin partitions always; canonical thick shells/floors
    // are front-side (kills interior backface stripe). LEGACY thick assets keep
    // double-sided because their cutaway geometry has outward-facing wall normals
    // — front-side would make walls vanish when viewed from inside until the
    // asset is regenerated.
    const doubleSided =
      props.doubleSided ??
      (props.glbKey.startsWith("int-partition-") ? true : !props.canonical);
    ownedRef.current = normalizeInteriorMaterials(root, {
      kind: props.materialKind ?? surfaceKindForStructure(props.glbKey),
      doubleSided,
    });

    // Rotate first, then measure, so the fitted bbox is in the placed frame.
    root.rotation.y = props.yaw ?? 0;
    root.updateMatrixWorld(true);
    const source = new THREE.Box3().setFromObject(root);
    const sourceSize = source.getSize(new THREE.Vector3());

    const [targetX, targetY, targetZ] = props.size;
    let sx = targetX / Math.max(sourceSize.x, 0.001);
    let sy = targetY / Math.max(sourceSize.y, 0.001);
    let sz = targetZ / Math.max(sourceSize.z, 0.001);

    if (props.canonical) {
      // Clamp horizontal anisotropy: scale uniformly in X/Z around the larger
      // fit, capped so neither axis is stretched more than 1.15x past the other.
      const base = Math.max(sx, sz);
      sx = THREE.MathUtils.clamp(sx, base / MAX_HORIZONTAL_ANISOTROPY, base);
      sz = THREE.MathUtils.clamp(sz, base / MAX_HORIZONTAL_ANISOTROPY, base);
    }
    root.scale.set(sx, sy, sz);

    root.updateMatrixWorld(true);
    const fitted = new THREE.Box3().setFromObject(root);
    const center = fitted.getCenter(new THREE.Vector3());
    if (props.variant === "floor") {
      // Authored top surface sits at local y=0; geometry extends downward.
      root.position.set(-center.x, -fitted.max.y, -center.z);
    } else {
      // Shell floor plane sits at local y=0.
      root.position.set(-center.x, -fitted.min.y, -center.z);
    }
    return root;
  }, [
    gltf.scene,
    props.glbKey,
    props.yaw,
    props.variant,
    props.canonical,
    props.doubleSided,
    props.materialKind,
    props.size,
  ]);

  useEffect(() => {
    const owned = ownedRef.current;
    return () => {
      // Dispose only the cloned materials this instance created; never the
      // shared cache originals.
      if (owned) for (const material of owned) material.dispose();
    };
  }, [object]);

  return <primitive object={object} />;
}

/**
 * Imported interior structural shell/floor. Missing/loading assets render
 * nothing rather than a visible primitive (imported-only law).
 */
export function InteriorStructure(props: InteriorStructureProps) {
  return (
    <InteriorStructureBoundary>
      <Suspense fallback={null}>
        <InteriorStructureInner {...props} />
      </Suspense>
    </InteriorStructureBoundary>
  );
}
