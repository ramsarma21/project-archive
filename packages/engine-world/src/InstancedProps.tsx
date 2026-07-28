import { Suspense, useMemo, type ReactNode } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { GlbBoundary } from "./GlbBoundary.js";

// ---------------------------------------------------------------------------
// Instanced imported props.
//
// The imported-visible-world rule admits exactly this: "Runtime code may
// transform, animate, INSTANCE, or shade imported assets." Nothing here builds
// geometry — it takes the same GLB `FittedGlb` draws and, where a level places
// the same asset more than once (six arcade piers, fourteen awnings, eighteen
// shop bays), renders every copy from ONE `InstancedMesh` per mesh primitive
// instead of one cloned scene graph per copy. The pixels are identical; the
// draw calls collapse from N-per-copy to one-per-primitive.
//
// The transform each copy needs is the SAME one `FittedGlb` computes, plus the
// world placement `M1Scenery` wraps it in. Reproduced here operation-for-
// operation so an instanced pier lands exactly where a fitted one did:
//
//   1. fit    — scale the mesh into the placement's box (contain-fit for a
//               PROP, per-axis fill for a MODULE tile), then re-centre X/Z and
//               ground Y on the SCALED bounds. This is `FittedGlbInner`.
//   2. place  — translate to the placement's position and turn by its yaw. This
//               is the `<group>` in `M1Scenery`.
//
// Each mesh keeps its own local transform within the GLB, so the per-instance
// matrix is  place · fit · meshLocal.
//
// Skinned meshes are never instanced here — a rigged body is placed by its bones
// and does not share a static instance matrix. Props are not skinned; a GLB that
// turns out to carry a skeleton falls back to nothing rather than drawing wrong.
// ---------------------------------------------------------------------------

/** One placed copy of an asset: where it goes and the box it is fitted into. */
export interface PropInstance {
  readonly id: string;
  /** Centre, at the base of the object. Matches `SceneryPlacement.pos`. */
  readonly pos: readonly [number, number, number];
  /** Box the GLB is fitted into. Matches `SceneryPlacement.size`. */
  readonly size: readonly [number, number, number];
  readonly yaw: number;
  /** Fill the box on every axis (a MODULE tile) instead of contain-fitting. */
  readonly fill: boolean;
}

/**
 * The world matrix one instance needs: fit the natural mesh into its box exactly
 * as `FittedGlbInner` does, then place it exactly as `M1Scenery`'s group does.
 *
 * `naturalMin`/`naturalMax` are the GLB's own bounds at identity, measured once.
 */
function instanceMatrix(
  instance: PropInstance,
  naturalMin: THREE.Vector3,
  naturalMax: THREE.Vector3,
): THREE.Matrix4 {
  const sizeX = naturalMax.x - naturalMin.x || 1;
  const sizeY = naturalMax.y - naturalMin.y || 1;
  const sizeZ = naturalMax.z - naturalMin.z || 1;
  const rx = instance.size[0] / sizeX;
  const ry = instance.size[1] / sizeY;
  const rz = instance.size[2] / sizeZ;
  let sx: number;
  let sy: number;
  let sz: number;
  if (instance.fill) {
    sx = rx;
    sy = ry;
    sz = rz;
  } else {
    const uniform = Math.min(rx, ry, rz);
    sx = uniform;
    sy = uniform;
    sz = uniform;
  }

  // The scaled, unrotated bounds — `new Box3().setFromObject(root)` after the
  // scale, which for a scale about the origin is the natural box scaled per axis.
  const centreX = ((naturalMin.x + naturalMax.x) / 2) * sx;
  const centreZ = ((naturalMin.z + naturalMax.z) / 2) * sz;
  const minY = naturalMin.y * sy;

  // fit = translate(-centreX, -minY, -centreZ) · scale(s)
  const fit = new THREE.Matrix4().compose(
    new THREE.Vector3(-centreX, -minY, -centreZ),
    new THREE.Quaternion(),
    new THREE.Vector3(sx, sy, sz),
  );
  // place = translate(pos) · rotateY(yaw)
  const place = new THREE.Matrix4().compose(
    new THREE.Vector3(instance.pos[0], instance.pos[1], instance.pos[2]),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, instance.yaw, 0)),
    new THREE.Vector3(1, 1, 1),
  );
  return place.multiply(fit);
}

/** Every drawable primitive in a GLB, with its transform inside the GLB. */
interface GlbPrimitive {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  /** The mesh's matrix relative to the GLB scene root. */
  local: THREE.Matrix4;
}

function InstancedPropsInner(props: {
  url: string;
  instances: readonly PropInstance[];
}) {
  const gltf = useGLTF(props.url);

  const batch = useMemo(() => {
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    const naturalBox = new THREE.Box3().setFromObject(scene);
    const naturalMin = naturalBox.min.clone();
    const naturalMax = naturalBox.max.clone();

    const primitives: GlbPrimitive[] = [];
    let skinned = false;
    scene.traverse((node) => {
      const mesh = node as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh) {
        skinned = true;
        return;
      }
      if (!(mesh as unknown as THREE.Mesh).isMesh) return;
      primitives.push({
        geometry: mesh.geometry,
        material: mesh.material,
        // Relative to the scene root, which sits at identity: matrixWorld is the
        // mesh's own transform inside the GLB.
        local: mesh.matrixWorld.clone(),
      });
    });

    const matrices = props.instances.map((instance) =>
      instanceMatrix(instance, naturalMin, naturalMax),
    );

    return { primitives, matrices, skinned };
  }, [gltf.scene, props.instances]);

  // A skinned "prop" is a data error, not something to draw wrong: render
  // nothing, the same failure a missing asset gives.
  if (batch.skinned || batch.primitives.length === 0) return null;

  return (
    <group name="instanced-prop">
      {batch.primitives.map((primitive, index) => (
        <InstancedPrimitive
          key={index}
          primitive={primitive}
          matrices={batch.matrices}
        />
      ))}
    </group>
  );
}

function InstancedPrimitive(props: {
  primitive: GlbPrimitive;
  matrices: readonly THREE.Matrix4[];
}) {
  const ref = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return;
    const composed = new THREE.Matrix4();
    for (let i = 0; i < props.matrices.length; i++) {
      composed.multiplyMatrices(props.matrices[i]!, props.primitive.local);
      mesh.setMatrixAt(i, composed);
    }
    mesh.instanceMatrix.needsUpdate = true;
    // Instance transforms move geometry far from its own origin, so the batch's
    // bounds have to be recomputed from the matrices — otherwise culling uses a
    // sphere at the origin and a whole run pops out when the camera turns.
    // `InstancedMesh.computeBoundingSphere` folds the instance matrices in, so
    // per-batch frustum culling stays correct (the duel-yard run culls while the
    // street run draws).
    mesh.computeBoundingSphere();
  };
  return (
    <instancedMesh
      ref={ref}
      args={[props.primitive.geometry, props.primitive.material, props.matrices.length]}
      castShadow
      receiveShadow
    />
  );
}

/**
 * Render every placed copy of one imported prop from a single instanced draw per
 * mesh primitive. A drop-in for a run of identical `FittedGlb`s: same asset, same
 * per-copy fit, same world placement — one draw call each instead of N.
 *
 * Loading or parse failure renders nothing, exactly as `FittedGlb` does with a
 * null fallback: a missing asset leaves a hole, which is the correct failure.
 */
export function InstancedFittedGlb(props: {
  /** Served path under the world root, e.g. `world/props/market-awning.glb`. */
  src: string;
  instances: readonly PropInstance[];
  fallback?: ReactNode;
}) {
  const url = props.src.startsWith("/") ? props.src : `/${props.src}`;
  if (props.instances.length === 0) return null;
  return (
    <GlbBoundary fallback={props.fallback ?? null} onBeforeRetry={() => useGLTF.clear(url)}>
      <Suspense fallback={props.fallback ?? null}>
        <InstancedPropsInner url={url} instances={props.instances} />
      </Suspense>
    </GlbBoundary>
  );
}
