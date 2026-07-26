import { Suspense, useMemo, type ReactNode } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { GlbBoundary } from "./GlbBoundary.js";

// ---- Fitted world prop/building: normalize arbitrary Meshy GLB dimensions ----

/**
 * Where a world asset actually lives.
 *
 * Most props sit under /world/props, so a bare key still resolves there. But
 * characters live under /world/characters and structural shells under
 * /world/structures, and prefixing the props directory onto a path that already
 * names its own directory is a 404 — which is how the mission's only interior,
 * nine wall and roof placements of the ropewalk shell plus its partition, came
 * to draw nothing at all. A caller that knows the path passes it.
 */
function worldAssetUrl(glbKey: string, src?: string): string {
  if (!src) return `/world/props/${glbKey}.glb`;
  return src.startsWith("/") ? src : `/${src}`;
}

function FittedGlbInner(props: {
  glbKey: string;
  src?: string;
  size?: [number, number, number];
  scale?: number;
  fill?: boolean;
}) {
  const gltf = useGLTF(worldAssetUrl(props.glbKey, props.src));
  const obj = useMemo(() => {
    const root = skeletonClone(gltf.scene);
    root.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);
    if (props.size) {
      const sx = props.size[0] / (size.x || 1);
      const sy = props.size[1] / (size.y || 1);
      const sz = props.size[2] / (size.z || 1);
      if (props.fill) root.scale.set(sx, sy, sz);
      else root.scale.setScalar(Math.min(sx, sy, sz));
    } else {
      root.scale.setScalar(props.scale ?? 1);
    }
    const box2 = new THREE.Box3().setFromObject(root);
    const center = new THREE.Vector3();
    box2.getCenter(center);
    root.position.x -= center.x;
    root.position.z -= center.z;
    root.position.y -= box2.min.y;
    return root;
  }, [gltf.scene, props.size, props.scale, props.fill]);
  return <primitive object={obj} />;
}

export function FittedGlb(props: {
  glbKey: string;
  /** Declared path under the served world root; overrides the props default. */
  src?: string;
  size?: [number, number, number];
  scale?: number;
  /**
   * Fill `size` on every axis instead of fitting inside it.
   *
   * The default contain-fit takes the smallest of the three ratios, which is
   * right for an object placed in a box roomier than itself and catastrophic for
   * one placed in a box shaped nothing like it: a wall module contain-fitted into
   * a 0.6m-thick blocker draws 27cm of a 3.6m wall, because the thin axis decides
   * the whole scale. A caller that has already sized the box to the module —
   * tiling a long run into module-sized pieces — wants each piece filled.
   */
  fill?: boolean;
  fallback: ReactNode;
}) {
  const url = worldAssetUrl(props.glbKey, props.src);
  return (
    <GlbBoundary fallback={props.fallback} onBeforeRetry={() => useGLTF.clear(url)}>
      <Suspense fallback={props.fallback}>
        <FittedGlbInner
          glbKey={props.glbKey}
          src={props.src}
          size={props.size}
          scale={props.scale}
          fill={props.fill}
        />
      </Suspense>
    </GlbBoundary>
  );
}

function structureUrl(glbKey: string, src?: string): string {
  if (!src) return `/world/structures/${glbKey}.glb`;
  return src.startsWith("/") ? src : `/${src}`;
}

/**
 * Whether a shell has to turn a quarter to face the room it is filling.
 *
 * Structural concepts are authored to a proportion, not to an orientation: the
 * ropewalk shed is 34 long on its own X and the board partition is 1.9 wide on
 * its own X while being 0.23 thin on Z. Asking a caller to know which is which
 * is asking it to carry a fact only the mesh has, so the shell turns itself:
 * whichever way puts its long horizontal axis along the room's long horizontal
 * axis. An explicit `rotateShell` still wins where a caller knows better.
 */
function shellQuarterTurn(
  source: THREE.Vector3,
  size: [number, number, number],
  rotateShell?: boolean,
): boolean {
  if (rotateShell !== undefined) return rotateShell;
  const sourceLongOnX = source.x >= source.z;
  const targetLongOnX = size[0] >= size[2];
  return sourceLongOnX !== targetLongOnX;
}

function ImportedStructureInner(props: {
  glbKey: string;
  src?: string;
  size: [number, number, number];
  rotateShell?: boolean;
}) {
  const gltf = useGLTF(structureUrl(props.glbKey, props.src));
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
    // A turned shell maps source X to room depth and source Z to room width.
    const turn = shellQuarterTurn(sourceSize, props.size, props.rotateShell);
    const targetX = turn ? props.size[2] : props.size[0];
    const targetZ = turn ? props.size[0] : props.size[2];
    root.scale.set(
      targetX / Math.max(sourceSize.x, 0.001),
      props.size[1] / Math.max(sourceSize.y, 0.001),
      targetZ / Math.max(sourceSize.z, 0.001),
    );
    const fitted = new THREE.Box3().setFromObject(root);
    const center = fitted.getCenter(new THREE.Vector3());
    root.position.set(-center.x, -fitted.min.y, -center.z);
    root.rotation.y = turn ? -Math.PI / 2 : 0;
    return root;
  }, [gltf.scene, props.glbKey, props.rotateShell, props.size, props.src]);
  return <primitive object={object} />;
}

/**
 * Imported structural shell/floor module. Loading or parse failure renders
 * nothing; production never substitutes primitive room geometry.
 *
 * Unlike `FittedGlb` this scales each axis independently, because that is what
 * a shell is for: the same four-walls-and-a-ceiling module fills a 22m ropewalk
 * and a 6m back room. Contain-fitting one uniformly is how a shed with 8.6m
 * walls comes out 2.8m tall with its roof five metres under the roof deck the
 * player walks on.
 */
export function ImportedStructure(props: {
  glbKey: string;
  /** Declared path under the served world root; overrides the structures default. */
  src?: string;
  size: [number, number, number];
  rotateShell?: boolean;
}) {
  const url = structureUrl(props.glbKey, props.src);
  return (
    <GlbBoundary fallback={null} onBeforeRetry={() => useGLTF.clear(url)}>
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
