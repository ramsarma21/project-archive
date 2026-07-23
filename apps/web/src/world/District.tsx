import {
  Component,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Sky, useGLTF } from "@react-three/drei";
import type { ChoreographyCue } from "@pa/contracts";
import {
  BUILDINGS,
  PROPS,
  NPCS,
  AMBIENT,
} from "./manifest.js";
import { RiggedCharacter } from "./Character.js";
import { actorCueFor, DirectedNpc } from "./ActorDirector.js";
import { atmosphereAt } from "./atmosphere.js";
import { SkyDirector } from "./SkyDirector.js";
import { WeatherDirector } from "./WeatherDirector.js";
import { WaterDirector } from "./WaterDirector.js";
import { PopulationDirector } from "./PopulationDirector.js";
import { DensityDirector } from "./DensityDirector.js";
import { InteriorDirector } from "./InteriorDirector.js";
import { interiorDef } from "./interiorManifest.js";

// ---- Imported modular ground kit -------------------------------------------
// Every visible road, alley, gutter, yard and deck surface below is a GLB
// produced by Gemini concept -> Meshy image-to-3D -> Blender optimization ->
// sync_web. The player's existing y=0 movement plane remains the only
// procedural surface, and it is invisible.
interface SurfacePlacement {
  id: string;
  glb: string;
  pos: [number, number, number];
  size: [number, number];
  relief: number;
  rotY?: number;
}

const STREET_VARIANTS = [
  "colonial-street-a",
  "colonial-street-b",
  "colonial-street-c",
] as const;
const ALLEY_VARIANTS = ["colonial-alley-a", "colonial-alley-b"] as const;

const MAIN_STREET_MODULES: SurfacePlacement[] = [
  {
    id: "street-west-endcap",
    glb: "colonial-street-endcap",
    pos: [-113, -0.14, 0],
    size: [10, 20],
    relief: 0.22,
  },
  ...[-98, -78, -58, -38, -18, 2, 22].map((x, index) => ({
    id: `street-${index}`,
    glb: STREET_VARIANTS[index % STREET_VARIANTS.length]!,
    pos: [x, -0.14, 0] as [number, number, number],
    size: [20, 20] as [number, number],
    relief: 0.22,
    rotY: index % 2 ? Math.PI : 0,
  })),
  {
    id: "street-east-run",
    glb: "colonial-street-c",
    pos: [38.5, -0.14, 0],
    size: [13, 20],
    relief: 0.22,
  },
  {
    id: "town-house-square",
    glb: "colonial-civic-square",
    pos: [53.5, -0.13, 0],
    size: [17, 20],
    relief: 0.2,
  },
  {
    id: "church-junction",
    glb: "colonial-street-junction",
    pos: [67, -0.13, 0],
    size: [10, 20],
    relief: 0.2,
  },
  {
    id: "street-east-endcap",
    glb: "colonial-street-endcap",
    pos: [76, -0.14, 0],
    size: [8, 20],
    relief: 0.22,
    rotY: Math.PI,
  },
];

const GUTTER_MODULES: SurfacePlacement[] = [-9.35, 9.35].flatMap((z, side) =>
  Array.from({ length: 10 }, (_, index) => ({
    id: `gutter-${side}-${index}`,
    glb: "colonial-gutter-straight",
    pos: [-108 + index * 20, -0.13, z] as [number, number, number],
    size: [20, 1.3] as [number, number],
    relief: 0.18,
    rotY: side ? Math.PI : 0,
  })),
);

const GUTTER_CORNERS: SurfacePlacement[] = [
  [-117.2, -9.25, 0],
  [-117.2, 9.25, Math.PI / 2],
  [79.2, -9.25, -Math.PI / 2],
  [79.2, 9.25, Math.PI],
].map(([x, z, rotY], index) => ({
  id: `gutter-corner-${index}`,
  glb: "colonial-gutter-corner",
  pos: [x!, -0.14, z!] as [number, number, number],
  size: [1.5, 1.5] as [number, number],
  relief: 0.2,
  rotY,
}));

const NORTH_ALLEY_MODULES: SurfacePlacement[] = [
  ...Array.from({ length: 16 }, (_, index) => ({
    id: `north-alley-${index}`,
    glb: ALLEY_VARIANTS[index % ALLEY_VARIANTS.length]!,
    pos: [-112 + index * 12, -0.1, -23.25] as [number, number, number],
    size: [12, 6.5] as [number, number],
    relief: 0.15,
    rotY: index % 3 === 1 ? Math.PI : 0,
  })),
  {
    id: "north-alley-end",
    glb: "colonial-alley-a",
    pos: [77, -0.1, -23.25],
    size: [6, 6.5],
    relief: 0.15,
  },
];

const SOUTH_ALLEY_MODULES: SurfacePlacement[] = Array.from(
  { length: 10 },
  (_, index) => ({
    id: `south-alley-${index}`,
    glb: ALLEY_VARIANTS[(index + 1) % ALLEY_VARIANTS.length]!,
    pos: [-34 + index * 12, -0.1, 23.25] as [number, number, number],
    size: [12, 6.5] as [number, number],
    relief: 0.15,
    rotY: index % 3 === 2 ? Math.PI : 0,
  }),
);

const ROW_AND_PERIMETER_YARDS: SurfacePlacement[] = [-15, 15, -28.25, 28.25]
  .flatMap((z, row) =>
    Array.from({ length: 9 }, (_, index) => ({
      id: `yard-row-${row}-${index}`,
      glb: "colonial-yard-ground",
      pos: [-107 + index * 22, -0.12, z] as [number, number, number],
      size: [22, Math.abs(z) > 20 ? 3.5 : 10] as [number, number],
      relief: 0.12,
      rotY: (index + row) % 2 ? Math.PI : 0,
    })),
  );

const PASSAGE_MODULES: SurfacePlacement[] = [
  [-10.5, -15, 3, 10, "colonial-alley-a"],
  [17.5, -15, 3, 10, "colonial-alley-b"],
  [63.25, -15, 3.5, 10, "colonial-civic-square"],
  [79, -15, 2, 10, "colonial-alley-a"],
  [-90.75, 15, 2.5, 10, "colonial-alley-b"],
  [-12.5, 15, 3, 10, "colonial-alley-a"],
  [17.5, 15, 3, 10, "colonial-alley-b"],
  [72, 15, 2, 10, "colonial-alley-a"],
].map(([x, z, width, depth, glb], index) => ({
  id: `row-passage-${index}`,
  glb: glb as string,
  pos: [x as number, -0.09, z as number],
  // The imported alley texture runs along local X; rotate it into the
  // north/south passage and swap the fitted footprint to preserve exact
  // world-space bounds.
  size: [depth as number, width as number],
  relief: 0.14,
  rotY: Math.PI / 2,
}));

const EAST_POCKET_MODULES: SurfacePlacement[] = [
  ...[-20, 0, 20].map((z, index) => ({
    id: `east-pocket-yard-${index}`,
    glb: "colonial-yard-ground",
    pos: [94, -0.12, z] as [number, number, number],
    size: [28, 20] as [number, number],
    relief: 0.12,
    rotY: index % 2 ? Math.PI : 0,
  })),
  {
    id: "liberty-lane",
    glb: "colonial-street-endcap",
    pos: [89, -0.1, -11] as [number, number, number],
    size: [28, 8] as [number, number],
    relief: 0.16,
    rotY: -0.6,
  },
  {
    // The only retained greenery: imported, muddy and visibly trodden, wholly
    // inside the fenced Liberty Tree pocket.
    id: "liberty-courtyard",
    glb: "colonial-liberty-courtyard",
    pos: [95, -0.07, -21] as [number, number, number],
    size: [26, 19] as [number, number],
    relief: 0.1,
  },
];

const WHARF_MODULES: SurfacePlacement[] = [
  {
    id: "wharf-apron",
    glb: "colonial-wharf-apron",
    pos: [-139, -0.52, -3],
    size: [42, 34],
    relief: 0.58,
  },
  {
    id: "wharf-pier-finger",
    glb: "colonial-wharf-pier-finger",
    pos: [-146, -0.52, 24.5],
    size: [10, 9],
    relief: 0.58,
  },
  {
    id: "wharf-boardwalk",
    glb: "colonial-wharf-boardwalk",
    pos: [-77, -0.38, 23.25],
    size: [74, 6.5],
    relief: 0.44,
  },
  {
    id: "wharf-warehouse-backlot",
    glb: "colonial-yard-ground",
    pos: [-139, -0.12, -30],
    size: [42, 20],
    relief: 0.12,
  },
];

const MISC_YARDS: SurfacePlacement[] = [
  {
    id: "rider-pocket-yard",
    glb: "colonial-yard-ground",
    pos: [-104, -0.11, -17],
    size: [28, 17],
    relief: 0.13,
  },
];

const SKYLINE_SEAM_YARDS: SurfacePlacement[] = [
  {
    id: "north-skyline-yard",
    glb: "colonial-yard-perimeter",
    pos: [-5, -0.12, -40],
    size: [226, 20],
    relief: 0.1,
  },
  {
    id: "south-skyline-yard",
    glb: "colonial-yard-perimeter",
    // Land only: x=-40..+108. The released road kit originally extended this
    // apron over the southwest harbor; density keeps z>26.5/x<=-40 open water.
    pos: [34, -0.12, 40],
    size: [148, 20],
    relief: 0.1,
    rotY: Math.PI,
  },
  {
    id: "east-skyline-yard",
    glb: "colonial-yard-east-cap",
    // Continue imported land beneath the road-to-the-Neck/march canyon.
    // Flanking city blocks stop at its edges; the center remains traversable.
    pos: [132, -0.12, 0],
    size: [48, 60],
    relief: 0.1,
  },
  {
    id: "north-east-city-yard",
    glb: "colonial-yard-ground",
    pos: [132, -0.12, -40],
    size: [48, 20],
    relief: 0.12,
  },
];

const ALL_SURFACE_MODULES: SurfacePlacement[] = [
  ...SKYLINE_SEAM_YARDS,
  ...ROW_AND_PERIMETER_YARDS,
  ...MISC_YARDS,
  ...MAIN_STREET_MODULES,
  ...GUTTER_MODULES,
  ...GUTTER_CORNERS,
  ...NORTH_ALLEY_MODULES,
  ...SOUTH_ALLEY_MODULES,
  ...PASSAGE_MODULES,
  ...EAST_POCKET_MODULES,
  ...WHARF_MODULES,
];

class SurfaceAssetBoundary extends Component<
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

interface SurfaceBatch {
  glb: string;
  placements: SurfacePlacement[];
}

const SURFACE_BATCHES: SurfaceBatch[] = [
  ...ALL_SURFACE_MODULES.reduce((batches, placement) => {
    const batch = batches.get(placement.glb);
    if (batch) batch.placements.push(placement);
    else batches.set(placement.glb, { glb: placement.glb, placements: [placement] });
    return batches;
  }, new Map<string, SurfaceBatch>()).values(),
];

function SurfaceBatchMesh({ batch }: { batch: SurfaceBatch }) {
  const gltf = useGLTF(`/world/props/${batch.glb}.glb`);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const lastCullAt = useRef(-Infinity);
  const prepared = useMemo(() => {
    gltf.scene.updateMatrixWorld(true);
    let source: THREE.Mesh | null = null;
    gltf.scene.traverse((node) => {
      if (!source && (node as THREE.Mesh).isMesh) source = node as THREE.Mesh;
    });
    if (!source) throw new Error(`surface asset ${batch.glb} contains no mesh`);
    const mesh = source as THREE.Mesh;
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) throw new Error(`surface asset ${batch.glb} has no bounds`);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -box.min.y, -center.z);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return { geometry, material: mesh.material, size };
  }, [batch.glb, gltf.scene]);

  useEffect(() => () => prepared.geometry.dispose(), [prepared.geometry]);

  const scratch = useMemo(
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

  const writeInstances = (camera?: THREE.Camera) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (camera) {
      scratch.projection.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      );
      scratch.frustum.setFromProjectionMatrix(scratch.projection);
    }
    let visible = 0;
    for (const placement of batch.placements) {
      scratch.position.set(...placement.pos);
      if (camera) {
        const dx = camera.position.x - placement.pos[0];
        const dz = camera.position.z - placement.pos[2];
        if (dx * dx + dz * dz > 115 * 115) continue;
        if (dx * dx + dz * dz > 22 * 22) {
          scratch.sphere.center.copy(scratch.position);
          scratch.sphere.radius = Math.hypot(placement.size[0], placement.size[1]) * 0.55;
          if (!scratch.frustum.intersectsSphere(scratch.sphere)) continue;
        }
      }
      scratch.quaternion.setFromAxisAngle(scratch.up, placement.rotY ?? 0);
      scratch.scale.set(
        placement.size[0] / Math.max(prepared.size.x, 0.001),
        placement.relief / Math.max(prepared.size.y, 0.001),
        placement.size[1] / Math.max(prepared.size.z, 0.001),
      );
      scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
      mesh.setMatrixAt(visible++, scratch.matrix);
    }
    mesh.count = visible;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  };

  useLayoutEffect(() => writeInstances(), [batch.placements, prepared]);
  useFrame(({ camera, clock }) => {
    if (clock.elapsedTime - lastCullAt.current < 0.3) return;
    lastCullAt.current = clock.elapsedTime;
    writeInstances(camera);
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[prepared.geometry, prepared.material, batch.placements.length]}
      castShadow={false}
      receiveShadow
      frustumCulled={false}
      name={`surface-batch:${batch.glb}`}
      dispose={null}
    />
  );
}

function Ground() {
  return (
    <group name="imported-surface-batches">
      {SURFACE_BATCHES.map((batch) => (
        <SurfaceAssetBoundary key={batch.glb}>
          <Suspense fallback={null}>
            <SurfaceBatchMesh batch={batch} />
          </Suspense>
        </SurfaceAssetBoundary>
      ))}
    </group>
  );
}

interface StaticPlacement {
  id: string;
  glb: string;
  pos: [number, number, number];
  rotY: number;
  size?: [number, number, number];
  scale?: number;
}

const BUILDING_VISUALS: StaticPlacement[] = BUILDINGS.map((building) => ({
  id: building.id,
  glb: building.glb ?? "",
  pos: building.pos,
  rotY: building.rotY,
  size: building.size,
}));

function StaticFittedBatchMesh(props: {
  glb: string;
  placements: StaticPlacement[];
  maxDistance: number;
}) {
  const gltf = useGLTF(`/world/props/${props.glb}.glb`);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const lastCullAt = useRef(-Infinity);
  const prepared = useMemo(() => {
    gltf.scene.updateMatrixWorld(true);
    let source: THREE.Mesh | null = null;
    gltf.scene.traverse((node) => {
      if (!source && (node as THREE.Mesh).isMesh) source = node as THREE.Mesh;
    });
    if (!source) throw new Error(`static asset ${props.glb} contains no mesh`);
    const mesh = source as THREE.Mesh;
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) throw new Error(`static asset ${props.glb} has no bounds`);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -box.min.y, -center.z);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return { geometry, material: mesh.material, size };
  }, [gltf.scene, props.glb]);
  useEffect(() => () => prepared.geometry.dispose(), [prepared.geometry]);

  const scratch = useMemo(
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

  const writeInstances = (camera?: THREE.Camera) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (camera) {
      scratch.projection.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      );
      scratch.frustum.setFromProjectionMatrix(scratch.projection);
    }
    let visible = 0;
    for (const placement of props.placements) {
      scratch.position.set(...placement.pos);
      if (camera) {
        const dx = camera.position.x - placement.pos[0];
        const dz = camera.position.z - placement.pos[2];
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq > props.maxDistance * props.maxDistance) continue;
        if (distanceSq > 20 * 20) {
          scratch.sphere.center.copy(scratch.position);
          const radius = placement.size
            ? Math.hypot(...placement.size) * 0.6
            : prepared.geometry.boundingSphere?.radius ?? 3;
          scratch.sphere.radius = radius;
          if (!scratch.frustum.intersectsSphere(scratch.sphere)) continue;
        }
      }
      let scale = placement.scale ?? 1;
      if (placement.size) {
        scale = Math.min(
          placement.size[0] / Math.max(prepared.size.x, 0.001),
          placement.size[1] / Math.max(prepared.size.y, 0.001),
          placement.size[2] / Math.max(prepared.size.z, 0.001),
        );
      }
      scratch.quaternion.setFromAxisAngle(scratch.up, placement.rotY);
      scratch.scale.setScalar(scale);
      scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
      mesh.setMatrixAt(visible++, scratch.matrix);
    }
    mesh.count = visible;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  };

  useLayoutEffect(() => writeInstances(), [prepared, props.placements]);
  useFrame(({ camera, clock }) => {
    if (clock.elapsedTime - lastCullAt.current < 0.3) return;
    lastCullAt.current = clock.elapsedTime;
    writeInstances(camera);
  });
  return (
    <instancedMesh
      ref={meshRef}
      args={[prepared.geometry, prepared.material, props.placements.length]}
      castShadow={false}
      receiveShadow
      frustumCulled={false}
      name={`static-batch:${props.glb}`}
      dispose={null}
    />
  );
}

function StaticFittedBatches(props: {
  name: string;
  placements: StaticPlacement[];
  maxDistance: number;
}) {
  const batches = useMemo(() => {
    const grouped = new Map<string, StaticPlacement[]>();
    for (const placement of props.placements) {
      const entries = grouped.get(placement.glb);
      if (entries) entries.push(placement);
      else grouped.set(placement.glb, [placement]);
    }
    return [...grouped.entries()];
  }, [props.placements]);
  return (
    <group name={props.name}>
      {batches.map(([glb, placements]) => (
        <SurfaceAssetBoundary key={glb}>
          <Suspense fallback={null}>
            <StaticFittedBatchMesh
              glb={glb}
              placements={placements}
              maxDistance={props.maxDistance}
            />
          </Suspense>
        </SurfaceAssetBoundary>
      ))}
    </group>
  );
}

function Buildings() {
  return (
    <StaticFittedBatches
      name="instanced-buildings"
      placements={BUILDING_VISUALS}
      maxDistance={90}
    />
  );
}

function Props3D(props: { dockRouteUnlocked: boolean }) {
  const placements = useMemo(
    () =>
      PROPS.filter(
        (prop) =>
          !(props.dockRouteUnlocked && prop.gate === "THOMAS_DOCK_ROUTE"),
      ).map((prop, index) => ({
        id: `prop-${index}`,
        glb: prop.glb,
        pos: prop.pos,
        rotY: prop.rotY,
        scale: prop.scale,
        size:
          prop.size ??
          (prop.glb === "liberty-elm"
            ? ([14, 16, 14] as [number, number, number])
            : prop.glb.startsWith("bldg")
              ? undefined
              : ([2.6, 2.6, 2.6] as [number, number, number])),
      })),
    [props.dockRouteUnlocked],
  );
  return (
    <StaticFittedBatches
      name="instanced-static-props"
      placements={placements}
      maxDistance={55}
    />
  );
}

// The effigy (and the whole Aug 14 set-piece) is staged by the EventDirector,
// mounted from World3D so it can react to the active cue and runtime view.

function Npcs(props: {
  interiorId: string | null;
  t: number;
  choreography: ChoreographyCue | null;
  reducedMotion: boolean;
  reactiveActorsActive: boolean;
}) {
  return (
    <group>
      {NPCS.map((n) => {
        const directed = actorCueFor(n, props.choreography);
        // M2 promotes the customs officer into WatcherDirector ownership. The
        // legacy static NPC must never coexist with WATCH-customs.
        if (n.id === "officer") return null;
        if (
          props.reactiveActorsActive &&
          ["abigail", "thomas", "pike", "clarke", "rider"].includes(n.id)
        ) {
          return null;
        }
        const visible = n.interiorOf ? props.interiorId === n.interiorOf : props.interiorId === null;
        if (!visible) return null;
        return (
          <DirectedNpc
            key={n.id}
            npc={n}
            cue={directed}
            reducedMotion={props.reducedMotion}
          />
        );
      })}
    </group>
  );
}

function AmbientWalker(props: {
  glb: string;
  from: [number, number, number];
  to: [number, number, number];
  speed: number;
  offset: number;
  reducedMotion: boolean;
}) {
  const ref = useRef<THREE.Group>(null);
  const a = useMemo(() => new THREE.Vector3(...props.from), [props.from]);
  const b = useMemo(() => new THREE.Vector3(...props.to), [props.to]);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    if (props.reducedMotion) {
      ref.current.position.copy(a);
      ref.current.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      return;
    }
    const dist = a.distanceTo(b);
    const period = (dist / props.speed) * 2;
    const t = ((clock.elapsedTime * 1 + props.offset) % period) / period;
    const seg = t < 0.5 ? t * 2 : (1 - t) * 2;
    const from = t < 0.5 ? a : b;
    const to = t < 0.5 ? b : a;
    ref.current.position.lerpVectors(from, to, seg);
    ref.current.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
  });
  return (
    <group ref={ref}>
      <RiggedCharacter glbKey={props.glb} height={1.68} clip={props.reducedMotion ? "idle" : "walk"} timeOffset={props.offset} />
    </group>
  );
}

function AmbientFolk(props: { interiorId: string | null; t: number; reducedMotion: boolean }) {
  if (props.interiorId) return null;
  const visibleCount = props.t < 0.45 ? 6 : props.t < 0.75 ? 8 : AMBIENT.length;
  return (
    <group>
      {AMBIENT.slice(0, visibleCount).map((a, i) =>
        a.path ? (
          <AmbientWalker
            key={i}
            glb={a.glb}
            from={a.pos}
            to={a.path.to}
            speed={a.path.speed}
            offset={i * 3.1}
            reducedMotion={props.reducedMotion}
          />
        ) : (
          <group key={i} position={a.pos} rotation={[0, a.rotY, 0]}>
            <RiggedCharacter glbKey={a.glb} height={1.68} clip={a.clip} timeOffset={i * 0.7} coat={i % 2 ? "#54432f" : "#3f4653"} />
          </group>
        ),
      )}
    </group>
  );
}

// ---- Day light rig driven by the runtime clock ----
export function DayLight(props: { t: number; dusk: boolean }) {
  const t = props.dusk ? 1 : props.t;
  const elev = THREE.MathUtils.lerp(58, 7, t);
  const azim = THREE.MathUtils.lerp(115, 245, t);
  const phi = THREE.MathUtils.degToRad(90 - elev);
  const theta = THREE.MathUtils.degToRad(azim);
  const sun = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
  const sunColor = new THREE.Color().lerpColors(new THREE.Color("#fff4e0"), new THREE.Color("#ff8a3d"), t * t);
  const intensity = THREE.MathUtils.lerp(2.6, 1.0, t);
  return (
    <group>
      <Sky sunPosition={[sun.x * 100, sun.y * 100, sun.z * 100]} turbidity={6 + t * 6} rayleigh={1.2 + t * 2.4} mieCoefficient={0.006} mieDirectionalG={0.8} />
      <hemisphereLight args={["#c8d9ee", "#8a7355", THREE.MathUtils.lerp(0.75, 0.32, t)]} />
      <directionalLight
        position={[sun.x * 60, Math.max(sun.y * 60, 6), sun.z * 60]}
        intensity={intensity}
        color={sunColor}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
        shadow-bias={-0.0003}
      />
      {props.dusk && <pointLight position={[95, 3.5, -25]} intensity={30} distance={26} color="#ff9040" />}
    </group>
  );
}

export function District(props: {
  interiorId: string | null;
  t: number;
  dusk: boolean;
  dockRouteUnlocked: boolean;
  reducedMotion: boolean;
  choreography: ChoreographyCue | null;
  clock: { spentUnits: number; fixedEventBoundary: number } | null;
  reactiveActorsActive?: boolean;
}) {
  const activeInterior = interiorDef(props.interiorId);
  // One shared atmosphere sample per frame-tree: sky, weather, water, and the
  // window/lantern dressing all agree about the hour (Bible §6).
  const evening = Boolean(
    props.clock && props.clock.spentUnits >= props.clock.fixedEventBoundary,
  );
  const atmo = useMemo(
    () => atmosphereAt({ t: props.t, dusk: props.dusk, evening }),
    [props.t, props.dusk, evening],
  );
  if (activeInterior) {
    return (
      <group>
        <InteriorDirector
          def={activeInterior}
          t={props.t}
          dusk={props.dusk}
          reducedMotion={props.reducedMotion}
        />
        <Npcs
          interiorId={props.interiorId}
          t={props.t}
          choreography={props.choreography}
          reducedMotion={props.reducedMotion}
          reactiveActorsActive={Boolean(props.reactiveActorsActive)}
        />
      </group>
    );
  }
  return (
    <group>
      <SkyDirector atmo={atmo} reducedMotion={props.reducedMotion} />
      <WeatherDirector atmo={atmo} reducedMotion={props.reducedMotion} interiorId={props.interiorId} />
      <WaterDirector atmo={atmo} reducedMotion={props.reducedMotion} />
      {props.dusk && <pointLight position={[95, 3.5, -25]} intensity={30} distance={26} color="#ff9040" />}
      <Ground />
      <DensityDirector />
      <Buildings />
      <Props3D dockRouteUnlocked={props.dockRouteUnlocked} />
      <Npcs
        interiorId={props.interiorId}
        t={props.t}
        choreography={props.choreography}
        reducedMotion={props.reducedMotion}
        reactiveActorsActive={Boolean(props.reactiveActorsActive)}
      />
      <PopulationDirector
        interiorId={props.interiorId}
        t={props.t}
        dusk={props.dusk}
        dockRouteUnlocked={props.dockRouteUnlocked}
        reducedMotion={props.reducedMotion}
      />
    </group>
  );
}
