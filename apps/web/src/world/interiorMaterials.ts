import * as THREE from "three";

// ---------------------------------------------------------------------------
// Interior-only material normalization.
//
// Sol's audit found interiors failing partly because imported structural
// materials arrive with aggressive normal maps, wrong color spaces, glossy
// ridges, and blanket double-sided forcing (so thick walls draw their inner
// backfaces and z-fight/stripe). This helper enforces the interior material
// contract at runtime WITHOUT mutating shared GLTF resources: every material is
// cloned first (scene clones share materials via SkeletonUtils.clone), the
// clamped copy is swapped in, and the caller is handed the owned clones so it
// can dispose exactly those on unmount — never the cached/shared originals.
//
// This module is interior-scoped and must not be imported by exterior/world
// systems; it deliberately overrides values that are correct for the street.
// ---------------------------------------------------------------------------

export type InteriorSurfaceKind = "plaster" | "wood" | "brick" | "thin-partition";

export interface InteriorMaterialContract {
  /** Semantic surface used to pick the roughness band. */
  kind: InteriorSurfaceKind;
  /**
   * Thin partitions (single-plane dividers) legitimately need double-sided
   * rendering; thick shells/floors must stay front-side so inner backfaces
   * never stripe/z-fight against the visible face.
   */
  doubleSided: boolean;
}

// Roughness bands from the interior contract: plaster/wood 0.82–0.92, brick
// 0.9. Metalness is always 0 (no interior structural surface is a metal).
const ROUGHNESS_BAND: Record<InteriorSurfaceKind, [number, number]> = {
  plaster: [0.82, 0.92],
  wood: [0.82, 0.92],
  brick: [0.9, 0.9],
  "thin-partition": [0.85, 0.92],
};

// Normal strength must stay gentle (0.25–0.4) so aged plaster/wood reads as
// texture, not as harsh embossed ridges under raking window/hearth light.
export const INTERIOR_NORMAL_SCALE_MIN = 0.25;
export const INTERIOR_NORMAL_SCALE_MAX = 0.4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Pick a surface kind from a structural GLB key so shells/floors get the right
 * roughness band without per-asset config.
 */
export function surfaceKindForStructure(glbKey: string): InteriorSurfaceKind {
  if (glbKey.startsWith("int-partition-")) return "thin-partition";
  if (glbKey.includes("brick")) return "brick";
  if (glbKey.includes("floor")) return "wood";
  // Shells are mixed plaster/wood; plaster band is the safe default and shares
  // the wood band values anyway.
  return "plaster";
}

/**
 * Normalize every material under `root` in place, returning the set of cloned
 * materials the caller now owns (and must dispose on unmount). The shared
 * source materials are left untouched, so the drei/three GLTF cache and any
 * concurrently-mounted clone keep their originals.
 */
export function normalizeInteriorMaterials(
  root: THREE.Object3D,
  contract: InteriorMaterialContract,
): Set<THREE.Material> {
  const owned = new Set<THREE.Material>();
  const [roughMin, roughMax] = ROUGHNESS_BAND[contract.kind];
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const sources = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const cloned = sources.map((source) => {
      const copy = source.clone();
      owned.add(copy);
      applyContract(copy, contract, roughMin, roughMax);
      return copy;
    });
    mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0]!;
  });
  return owned;
}

function applyContract(
  material: THREE.Material,
  contract: InteriorMaterialContract,
  roughMin: number,
  roughMax: number,
): void {
  // Thick shells/floors are front-side; only intentional thin partitions are
  // double-sided. This kills the interior "backface stripe" from the audit.
  material.side = contract.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
  material.depthWrite = true;

  const standard = material as THREE.MeshStandardMaterial;
  if (standard.isMeshStandardMaterial) {
    standard.metalness = 0;
    standard.roughness = clamp(
      standard.roughness > 0 ? standard.roughness : roughMax,
      roughMin,
      roughMax,
    );
    // Base color is authored/lit in sRGB; the normal map must stay linear
    // (Non-Color) or plaster/brick relief inverts and stripes.
    if (standard.map) standard.map.colorSpace = THREE.SRGBColorSpace;
    if (standard.normalMap) {
      standard.normalMap.colorSpace = THREE.NoColorSpace;
      const nx = clamp(
        standard.normalScale.x || INTERIOR_NORMAL_SCALE_MAX,
        INTERIOR_NORMAL_SCALE_MIN,
        INTERIOR_NORMAL_SCALE_MAX,
      );
      const ny = clamp(
        standard.normalScale.y || INTERIOR_NORMAL_SCALE_MAX,
        INTERIOR_NORMAL_SCALE_MIN,
        INTERIOR_NORMAL_SCALE_MAX,
      );
      standard.normalScale.set(nx, ny);
    }
    if (standard.emissiveMap) standard.emissiveMap.colorSpace = THREE.SRGBColorSpace;
    // Structural shells are not self-lit; kill any stray emissive that would
    // blow out under interior exposure.
    if (standard.emissive) standard.emissive.setRGB(0, 0, 0);
  }
  material.needsUpdate = true;
}

/**
 * Clamp a requested normal scale to the interior band. Exposed for tests and
 * for callers that author their own materials.
 */
export function clampInteriorNormalScale(value: number): number {
  return clamp(value, INTERIOR_NORMAL_SCALE_MIN, INTERIOR_NORMAL_SCALE_MAX);
}

/**
 * Roughness band accessor for tests / validation.
 */
export function interiorRoughnessBand(kind: InteriorSurfaceKind): [number, number] {
  return ROUGHNESS_BAND[kind];
}
