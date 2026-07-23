import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import {
  DENSITY_PLACEMENTS,
  type DensityPlacement,
} from "./densityManifest.js";

class DensityAssetBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {}

  render() {
    // Imported-visible-world law: a failed asset renders nothing, never a
    // procedural physical approximation.
    return this.state.failed ? null : this.props.children;
  }
}

interface DensityBatch {
  key: string;
  glb: string;
  placements: DensityPlacement[];
  castShadow: boolean;
  receiveShadow: boolean;
  originMode: "CENTER_GROUND" | "SOURCE";
}

function buildBatches(): DensityBatch[] {
  const batches = new Map<string, DensityBatch>();
  for (const entry of DENSITY_PLACEMENTS) {
    // Density is fill, not hero lighting: keep it out of the expensive shadow
    // pass by default. Only an explicitly opted-in close hero detail may cast.
    const castShadow = entry.castShadow ?? false;
    const receiveShadow = entry.receiveShadow ?? true;
    const originMode = entry.originMode ?? "CENTER_GROUND";
    // Every density GLB is a verified one-mesh asset. Global per-asset
    // instancing costs one draw call regardless of the number of placements;
    // sector ids remain on the manifest for future LOD streaming/collision.
    const key = [
      entry.glb,
      castShadow ? "cast" : "no-cast",
      receiveShadow ? "receive" : "no-receive",
      originMode,
    ].join(":");
    const batch = batches.get(key);
    if (batch) {
      batch.placements.push(entry);
    } else {
      batches.set(key, {
        key,
        glb: entry.glb,
        placements: [entry],
        castShadow,
        receiveShadow,
        originMode,
      });
    }
  }
  return [...batches.values()];
}

const BATCHES = buildBatches();

function DensityBatchMesh({ batch }: { batch: DensityBatch }) {
  const gltf = useGLTF(`/world/props/${batch.glb}.glb`);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const lastCullAt = useRef(-Infinity);

  const prepared = useMemo(() => {
    gltf.scene.updateMatrixWorld(true);
    let sourceMesh: THREE.Mesh | null = null;
    gltf.scene.traverse((node) => {
      if (!sourceMesh && (node as THREE.Mesh).isMesh) {
        sourceMesh = node as THREE.Mesh;
      }
    });
    if (!sourceMesh) {
      throw new Error(`density asset ${batch.glb} contains no mesh`);
    }

    // Density-kit assets are deliberately optimized to one mesh. Bake its
    // imported node transform into cloned geometry so InstancedMesh can reuse
    // it without changing the source GLTF cache.
    const mesh = sourceMesh as THREE.Mesh;
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingBox();
    const sourceBox = geometry.boundingBox?.clone();
    if (!sourceBox) {
      throw new Error(`density asset ${batch.glb} has no bounds`);
    }
    const sourceSize = sourceBox.getSize(new THREE.Vector3());

    if (batch.originMode === "CENTER_GROUND") {
      const center = sourceBox.getCenter(new THREE.Vector3());
      geometry.translate(-center.x, -sourceBox.min.y, -center.z);
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const material = Array.isArray(mesh.material)
      ? mesh.material[0]!
      : mesh.material;
    return { geometry, material, sourceSize };
  }, [batch.glb, batch.originMode, gltf.scene]);
  useEffect(() => () => prepared.geometry.dispose(), [prepared.geometry]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    batch.placements.forEach((entry, index) => {
      const uniformScale = Math.min(
        entry.size[0] / Math.max(prepared.sourceSize.x, 0.001),
        entry.size[1] / Math.max(prepared.sourceSize.y, 0.001),
        entry.size[2] / Math.max(prepared.sourceSize.z, 0.001),
      );
      position.set(...entry.pos);
      quaternion.setFromAxisAngle(up, entry.rotY);
      scale.setScalar(uniformScale);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
  }, [batch.placements, prepared.sourceSize]);

  const cullState = useMemo(
    () => ({
      projection: new THREE.Matrix4(),
      frustum: new THREE.Frustum(),
      sphere: new THREE.Sphere(),
      matrix: new THREE.Matrix4(),
      quaternion: new THREE.Quaternion(),
      position: new THREE.Vector3(),
      scale: new THREE.Vector3(),
      up: new THREE.Vector3(0, 1, 0),
    }),
    [],
  );

  useFrame(({ camera, clock }) => {
    const mesh = meshRef.current;
    if (!mesh || clock.elapsedTime - lastCullAt.current < 0.35) return;
    lastCullAt.current = clock.elapsedTime;
    cullState.projection.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    cullState.frustum.setFromProjectionMatrix(cullState.projection);

    let visible = 0;
    for (const entry of batch.placements) {
      const maxDistance = entry.tags.includes("city-envelope")
        ? 120
        : entry.tags.includes("boundary")
          ? 95
          : 65;
      cullState.position.set(...entry.pos);
      const dx = camera.position.x - cullState.position.x;
      const dz = camera.position.z - cullState.position.z;
      if (dx * dx + dz * dz > maxDistance * maxDistance) continue;
      cullState.sphere.center.copy(cullState.position);
      cullState.sphere.radius = Math.hypot(...entry.size) * 0.55;
      if (!cullState.frustum.intersectsSphere(cullState.sphere)) continue;

      const uniformScale = Math.min(
        entry.size[0] / Math.max(prepared.sourceSize.x, 0.001),
        entry.size[1] / Math.max(prepared.sourceSize.y, 0.001),
        entry.size[2] / Math.max(prepared.sourceSize.z, 0.001),
      );
      cullState.quaternion.setFromAxisAngle(cullState.up, entry.rotY);
      cullState.scale.setScalar(uniformScale);
      cullState.matrix.compose(
        cullState.position,
        cullState.quaternion,
        cullState.scale,
      );
      mesh.setMatrixAt(visible, cullState.matrix);
      visible++;
    }
    mesh.count = visible;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[
        prepared.geometry,
        prepared.material,
        batch.placements.length,
      ]}
      castShadow={batch.castShadow}
      receiveShadow={batch.receiveShadow}
      frustumCulled={false}
      name={`density:${batch.key}`}
      userData={{ placementIds: batch.placements.map((entry) => entry.id) }}
      dispose={null}
    />
  );
}

export function DensityDirector() {
  // Dev-only baseline switch for performance attribution:
  // append ?density=0 to measure the released world without this pass.
  const disabled =
    import.meta.env.DEV &&
    (new URLSearchParams(window.location.search).get("density") === "0" ||
      window.localStorage.getItem("pa-density-disabled") === "1");
  useEffect(() => {
    if (import.meta.env.DEV) {
      (
        window as Window & { __PA_DENSITY_BATCHES__?: number }
      ).__PA_DENSITY_BATCHES__ = disabled ? 0 : BATCHES.length;
    }
  }, [disabled]);
  if (disabled) {
    return null;
  }
  return (
    <group name="imported-exterior-density">
      {BATCHES.map((batch) => (
        <DensityAssetBoundary key={batch.key}>
          <Suspense fallback={null}>
            <DensityBatchMesh batch={batch} />
          </Suspense>
        </DensityAssetBoundary>
      ))}
    </group>
  );
}
