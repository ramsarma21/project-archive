import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { FittedGlb, ImportedStructure } from "./Character.js";
import {
  InteriorStructure,
  chooseInteriorFloorGrid,
} from "./InteriorStructure.js";
import { InteriorPopulationDirector } from "./InteriorPopulationDirector.js";
import type {
  InteriorArchetype,
  InteriorDef,
  InteriorPropPlacement,
} from "./interiorManifest.js";
import { weatherBlend } from "./atmosphere.js";
import { QA_RUNTIME_ENABLED } from "./qaEnvironment.js";

class InteriorAssetBoundary extends Component<
  { asset: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    if (import.meta.env.DEV) {
      console.error(`[interior] imported asset failed: ${this.props.asset}`, error);
    }
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// Interior lighting contract (Sol audit correction). Window key: day 1.0,
// drizzle 0.8, dusk 0.35. Hearth: day 2.5 / dusk 4. Candles: day 0.8 / dusk 1.8.
const WINDOW_KEY = { day: 1.0, drizzle: 0.8, dusk: 0.35 } as const;
const HEARTH = { day: 2.5, dusk: 4.0, distance: 7, decay: 2 } as const;
const CANDLE = { day: 0.8, dusk: 1.8, distance: 4, decay: 2 } as const;

export interface InteriorLightingProfile {
  ambient: number;
  hemisphere: number;
  window: number;
  roomFill: number;
  entranceFill: number;
  exposure: number;
  practical: number;
}

/** Archetype-specific readability floor without flattening historical mood. */
export function interiorLightingProfile(
  archetype: InteriorArchetype,
): InteriorLightingProfile {
  if (archetype === "MEETINGHOUSE") {
    return {
      ambient: 0.52,
      hemisphere: 0.5,
      window: 1.25,
      roomFill: 1.3,
      entranceFill: 1.15,
      exposure: 1.08,
      practical: 1.15,
    };
  }
  if (archetype === "WAREHOUSE" || archetype === "MARITIME_STORE") {
    return {
      ambient: 0.5,
      hemisphere: 0.45,
      window: 1.15,
      roomFill: 1.2,
      entranceFill: 1,
      exposure: 1.08,
      practical: 1,
    };
  }
  if (
    archetype.endsWith("_HOME") ||
    archetype === "HOME_SHOP"
  ) {
    return {
      ambient: 0.44,
      hemisphere: 0.38,
      window: 1,
      roomFill: 0.8,
      entranceFill: 0.75,
      exposure: 1.03,
      practical: 1,
    };
  }
  if (archetype === "TAVERN") {
    return {
      ambient: 0.44,
      hemisphere: 0.35,
      window: 0.85,
      roomFill: 0.75,
      entranceFill: 0.8,
      exposure: 1.02,
      practical: 1.15,
    };
  }
  return {
    ambient: 0.46,
    hemisphere: 0.4,
    window: 1.05,
    roomFill: 0.9,
    entranceFill: 0.85,
    exposure: 1.04,
    practical: 1,
  };
}

function InteriorEnvironment(props: {
  def: InteriorDef;
  t: number;
  dusk: boolean;
}) {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const prior = useRef<{
    background: THREE.Color | THREE.Texture | null;
    fog: THREE.Fog | THREE.FogExp2 | null;
    toneMapping: THREE.ToneMapping;
    exposure: number;
  } | null>(null);
  const fogEnabled = props.def.lighting.fogEnabled;
  const profile = interiorLightingProfile(props.def.archetype);
  const drizzle = props.dusk ? 0 : weatherBlend(props.t).drizzle;
  const exposure =
    profile.exposure + (props.dusk ? 0.06 : 0) - drizzle * 0.02;
  const fog = useMemo(
    () =>
      fogEnabled
        ? new THREE.Fog("#332e29", props.def.lighting.fogNear, props.def.lighting.fogFar)
        : null,
    [fogEnabled, props.def.lighting.fogFar, props.def.lighting.fogNear],
  );
  useEffect(() => {
    // ACES Filmic + sRGB with a slightly pulled-back exposure while inside so
    // window/hearth highlights do not blow to white; restore on exit.
    prior.current = {
      background: scene.background as THREE.Color | THREE.Texture | null,
      fog: scene.fog,
      toneMapping: gl.toneMapping,
      exposure: gl.toneMappingExposure,
    };
    scene.background = new THREE.Color("#171512");
    scene.fog = fog;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = exposure;
    return () => {
      scene.background = prior.current?.background ?? null;
      scene.fog = prior.current?.fog ?? null;
      if (prior.current) {
        gl.toneMapping = prior.current.toneMapping;
        gl.toneMappingExposure = prior.current.exposure;
      }
    };
  }, [fog, gl, scene]);
  useFrame(() => {
    gl.toneMappingExposure = exposure;
  });

  const [ox, oy, oz] = props.def.origin;
  const window = props.def.lighting.windowLocal;
  const hearth = props.def.lighting.hearthLocal;
  // Day/drizzle/dusk window key. drizzle amount is derived from the same
  // deterministic weather schedule the exterior uses.
  const windowKey = props.dusk
    ? WINDOW_KEY.dusk * profile.window
    : THREE.MathUtils.lerp(WINDOW_KEY.day, WINDOW_KEY.drizzle, drizzle) *
      profile.window;
  const candleKey =
    (props.dusk ? CANDLE.dusk : CANDLE.day) * profile.practical;
  const hearthRef = useRef<THREE.PointLight>(null);
  const hearthBase = props.dusk ? HEARTH.dusk : HEARTH.day;
  useFrame(({ clock }) => {
    if (!hearthRef.current || !hearth) return;
    const phase = props.def.layoutSeed * 0.013;
    hearthRef.current.intensity =
      hearthBase * (0.94 + Math.sin(clock.elapsedTime * 2.1 + phase) * 0.035);
  });

  return (
    <group>
      <ambientLight intensity={profile.ambient} color="#c8b99f" />
      <hemisphereLight
        color={props.dusk ? "#a8b8ce" : "#d6e0df"}
        groundColor="#4a3528"
        intensity={profile.hemisphere}
      />
      <directionalLight
        position={[ox + window[0], oy + window[1] + 2, oz + window[2] - 3]}
        target-position={[ox, oy + 1.1, oz]}
        color={props.dusk ? "#9daec6" : "#d7e0e2"}
        intensity={windowKey}
        castShadow={false}
      />
      <pointLight
        position={[
          ox,
          oy + 1.45,
          oz - props.def.dimensions[2] / 2 + 1.4,
        ]}
        color="#d9b57d"
        intensity={
          profile.entranceFill * (props.dusk ? 1.08 : 0.88)
        }
        distance={Math.min(10, Math.max(5, props.def.dimensions[2] * 0.36))}
        decay={2}
        castShadow={false}
      />
      <pointLight
        position={[
          ox,
          oy + Math.min(2.4, props.def.dimensions[1] * 0.55),
          oz + props.def.dimensions[2] * 0.08,
        ]}
        color={props.dusk ? "#b7b7a8" : "#d7cab0"}
        intensity={profile.roomFill * (props.dusk ? 0.82 : 1)}
        distance={
          Math.max(props.def.dimensions[0], props.def.dimensions[2]) * 0.68
        }
        decay={2}
        castShadow={false}
      />
      {hearth && (
        <pointLight
          ref={hearthRef}
          position={[ox + hearth[0], oy + 1.0, oz + hearth[2] - 0.4]}
          color="#ff9b55"
          intensity={hearthBase}
          distance={HEARTH.distance}
          decay={HEARTH.decay}
          castShadow={false}
        />
      )}
      {props.def.lighting.candleLocals.slice(0, 4).map((local, index) => (
        <pointLight
          key={index}
          position={[ox + local[0], oy + local[1], oz + local[2]]}
          color="#ffc879"
          intensity={candleKey}
          distance={CANDLE.distance}
          decay={CANDLE.decay}
          castShadow={false}
        />
      ))}
    </group>
  );
}

interface MechanicVisual {
  kind:
    | "PRESS"
    | "EFFORT"
    | "SORT"
    | "PLACE"
    | "PRINT_JOB"
    | "HAUL_JOB"
    | "POST_JOB"
    | null;
  stage?: string;
  progress: number;
  active: boolean;
  phase: "READY" | "ACTIVE" | "COMMIT" | "COMPLETE";
}

function OperablePressInner(props: {
  placement: InteriorPropPlacement;
}) {
  const gltf = useGLTF("/world/props/press-common-operable-v2.glb?v=press-v2");
  const root = useMemo(() => {
    const copy = skeletonClone(gltf.scene);
    copy.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      const materials = (
        Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      ).map((material) => material.clone());
      mesh.material = Array.isArray(mesh.material)
        ? materials
        : materials[0]!;
    });
    const box = new THREE.Box3().setFromObject(copy);
    const source = box.getSize(new THREE.Vector3());
    const scale = Math.min(
      props.placement.size[0] / Math.max(source.x, 0.001),
      props.placement.size[1] / Math.max(source.y, 0.001),
      props.placement.size[2] / Math.max(source.z, 0.001),
    );
    copy.scale.setScalar(scale);
    const fitted = new THREE.Box3().setFromObject(copy);
    const center = fitted.getCenter(new THREE.Vector3());
    copy.position.set(-center.x, -fitted.min.y, -center.z);
    return copy;
  }, [gltf.scene, props.placement.size]);
  const mixer = useMemo(() => new THREE.AnimationMixer(root), [root]);
  const inkMaterials = useMemo(() => {
    const target =
      root.getObjectByName("Press_Carriage") ??
      root.getObjectByName("Press_Tympan");
    const materials: {
      material: THREE.MeshStandardMaterial;
      base: THREE.Color;
    }[] = [];
    target?.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material]) {
        const standard = material as THREE.MeshStandardMaterial;
        if (!standard.color) continue;
        materials.push({
          material: standard,
          base: standard.color.clone(),
        });
      }
    });
    return materials;
  }, [root]);
  const inkCoverage = useRef(0);
  const inkTone = useMemo(() => new THREE.Color("#211d19"), []);
  const mechanic = useRef<MechanicVisual>({
    kind: null,
    stage: undefined,
    progress: 0,
    active: false,
    phase: "READY",
  });
  const sequence = useRef<{ startedAt: number; pullStarted: boolean; releaseStarted: boolean; carriageStarted: boolean } | null>(null);
  const pull = useMemo(
    () => gltf.animations.find((clip) => clip.name === "pressPull") ?? null,
    [gltf.animations],
  );

  const playClip = (name: string, startAt = 0) => {
    const clip = gltf.animations.find((candidate) => candidate.name === name);
    if (!clip) return;
    const action = mixer.clipAction(clip, root);
    action.reset();
    action.enabled = true;
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.time = Math.min(startAt, clip.duration);
    action.play();
  };

  useEffect(() => {
    const onMechanic = (event: Event) => {
      const detail = (event as CustomEvent<Partial<MechanicVisual>>).detail;
      mechanic.current = {
        kind: detail.kind ?? null,
        stage: detail.stage,
        progress: detail.progress ?? 0,
        active: Boolean(detail.active),
        phase: detail.phase ?? (detail.active ? "ACTIVE" : "READY"),
      };
      if (detail.kind === "PRINT_JOB" && detail.stage === "CATCH") {
        inkCoverage.current = 0;
      } else if (detail.kind === "PRINT_JOB" && detail.stage === "INK") {
        inkCoverage.current = Math.max(
          inkCoverage.current,
          THREE.MathUtils.clamp(detail.progress ?? 0, 0, 1),
        );
      } else if (
        detail.kind === "PRINT_JOB" &&
        detail.stage === "PEEL" &&
        detail.phase === "COMPLETE"
      ) {
        inkCoverage.current = 0;
      }
      if (
        (detail.kind === "PRESS" ||
          detail.kind === "EFFORT" ||
          (detail.kind === "PRINT_JOB" && detail.stage === "PULL")) &&
        (detail.phase === "COMMIT" || detail.phase === "COMPLETE")
      ) {
        sequence.current = {
          startedAt: performance.now(),
          pullStarted: false,
          releaseStarted: false,
          carriageStarted: false,
        };
      }
      if (
        detail.kind === "PRINT_JOB" &&
        detail.stage === "REGISTER" &&
        detail.phase === "COMMIT"
      ) {
        playClip("tympanClose");
        playClip("carriageIn");
      }
      if (
        detail.kind === "PRINT_JOB" &&
        detail.stage === "PEEL" &&
        (detail.phase === "COMMIT" || detail.phase === "COMPLETE")
      ) {
        playClip("carriageOut");
        playClip("tympanOpen");
      }
    };
    window.addEventListener("pa:mechanic-visual", onMechanic);
    return () => window.removeEventListener("pa:mechanic-visual", onMechanic);
  }, []);

  useEffect(() => {
    if (!QA_RUNTIME_ENABLED) return;
    const target = window as unknown as {
      __paPressV2?: () => {
        clips: string[];
        lever: number[] | null;
        platenY: number | null;
        carriageZ: number | null;
        inkCoverage: number;
      };
    };
    target.__paPressV2 = () => {
      const lever = root.getObjectByName("Press_Lever");
      const platen = root.getObjectByName("Press_Platen");
      const carriage = root.getObjectByName("Press_Carriage");
      return {
        clips: gltf.animations.map((clip) => clip.name),
        lever: lever ? lever.quaternion.toArray() : null,
        platenY: platen?.position.y ?? null,
        carriageZ: carriage?.position.z ?? null,
        inkCoverage: inkCoverage.current,
      };
    };
    return () => {
      delete target.__paPressV2;
    };
  }, [gltf.animations, root]);

  useEffect(
    () => () => {
      mixer.stopAllAction();
    },
    [mixer],
  );

  useFrame((_, dt) => {
    const state = mechanic.current;
    const inkBlend = THREE.MathUtils.clamp(inkCoverage.current, 0, 1);
    for (const { material, base } of inkMaterials) {
      material.color.copy(base).lerp(inkTone, inkBlend * 0.58);
      material.roughness = THREE.MathUtils.lerp(0.82, 0.98, inkBlend);
    }
    const seq = sequence.current;
    if (seq) {
      const elapsed = (performance.now() - seq.startedAt) / 1000;
      if (!seq.pullStarted) {
        mixer.stopAllAction();
        playClip("pressPull", (pull?.duration ?? 0) * Math.min(state.progress, 0.92));
        seq.pullStarted = true;
      }
      if (elapsed >= 0.22 && !seq.carriageStarted) {
        playClip("carriageOut");
        seq.carriageStarted = true;
      }
      if (elapsed >= 0.42 && !seq.releaseStarted) {
        playClip("pressRelease");
        seq.releaseStarted = true;
      }
      if (elapsed >= 1.05) {
        sequence.current = null;
        playClip("carriageIn");
      }
      mixer.update(Math.min(dt, 0.05));
      return;
    }
    if (
      (state.kind === "PRESS" ||
        state.kind === "EFFORT" ||
        (state.kind === "PRINT_JOB" && state.stage === "PULL")) &&
      state.active &&
      pull
    ) {
      const action = mixer.clipAction(pull, root);
      action.enabled = true;
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.paused = true;
      action.play();
      action.time = pull.duration * Math.min(0.88, Math.max(0, state.progress * 0.88));
      mixer.update(0);
    }
  });

  return <primitive object={root} />;
}

function OperablePress(props: { placement: InteriorPropPlacement }) {
  return (
    <InteriorAssetBoundary asset="press-common-operable-v2">
      <Suspense fallback={null}>
        <OperablePressInner placement={props.placement} />
      </Suspense>
    </InteriorAssetBoundary>
  );
}

function InteriorProp(props: { placement: InteriorPropPlacement }) {
  const placement = props.placement;
  if (placement.glb.startsWith("int-partition-")) {
    return (
      <ImportedStructure
        glbKey={placement.glb}
        size={placement.size}
        rotateShell={false}
      />
    );
  }
  if (placement.id === "press-operable") {
    return <OperablePress placement={placement} />;
  }
  return (
    <FittedGlb
      glbKey={placement.glb}
      size={placement.size}
      fallback={<group />}
    />
  );
}

function InteriorPerfProbe(props: { def: InteriorDef }) {
  const last = useRef(0);
  useFrame(({ gl }) => {
    const now = performance.now();
    if (now - last.current < 750) return;
    last.current = now;
    const host = document.querySelector<HTMLElement>(".world3d");
    if (!host) return;
    host.dataset.drawCalls = String(gl.info.render.calls);
    host.dataset.triangles = String(gl.info.render.triangles);
    host.dataset.geometries = String(gl.info.memory.geometries);
    host.dataset.textures = String(gl.info.memory.textures);
    host.dataset.programs = String(gl.info.programs?.length ?? 0);
    host.dataset.interiorPlacements = String(
      props.def.props.length + props.def.partitions.length,
    );
  });
  return null;
}

/**
 * Dev-only deterministic inside viewpoint for the browser acceptance harness.
 * Normal gameplay camera ownership is untouched unless the explicit
 * `?interiorQaStatic=1` query is present.
 */
function InteriorQaCameraActive(props: { def: InteriorDef }) {
  useFrame(({ camera, gl, scene }) => {
    const [ox, oy, oz] = props.def.origin;
    const [, height, depth] = props.def.dimensions;
    camera.position.set(ox, oy + Math.min(1.75, height * 0.46), oz - depth / 2 + 3.2);
    camera.lookAt(ox, oy + Math.min(1.35, height * 0.34), oz + depth * 0.2);
    camera.updateMatrixWorld();
    const host = document.querySelector<HTMLElement>(".world3d");
    if (host) {
      host.dataset.interiorQaCamera = "active";
      host.dataset.interiorQaCameraPosition = camera.position
        .toArray()
        .map((value) => value.toFixed(2))
        .join(",");
    }
    // Positive priority takes over the QA frame so later gameplay camera
    // directors cannot overwrite this deterministic viewpoint.
    gl.render(scene, camera);
  }, 100);
  return null;
}

function InteriorQaCamera(props: { def: InteriorDef }) {
  const enabled = useMemo(
    () =>
      QA_RUNTIME_ENABLED &&
      new URLSearchParams(window.location.search).get("interiorQaStatic") === "1",
    [],
  );
  useEffect(() => {
    const host = document.querySelector<HTMLElement>(".world3d");
    if (host) host.dataset.interiorQaCameraEnabled = String(enabled);
  }, [enabled]);
  return enabled ? <InteriorQaCameraActive def={props.def} /> : null;
}

export function InteriorDirector(props: {
  def: InteriorDef;
  t: number;
  dusk: boolean;
  reducedMotion: boolean;
}) {
  const [width, height, depth] = props.def.dimensions;
  const canonical = props.def.shellContract === "canonical";
  const floorGrid = useMemo(
    () => chooseInteriorFloorGrid(width, depth),
    [width, depth],
  );
  return (
    <group>
      <InteriorEnvironment def={props.def} t={props.t} dusk={props.dusk} />
      <group position={props.def.origin}>
        <InteriorStructure
          glbKey={props.def.shellGlb}
          size={[width, height, depth]}
          variant="shell"
          yaw={props.def.shellYaw}
          canonical={canonical}
        />
        {/* Exactly ONE floor. Canonical shells carry no embedded floor, so a
            dedicated tile mounts with its authored top at local y=0. Legacy
            cutaway shells already include a floor, so a second one is NOT drawn
            (that duplicate/coplanar overlap is the audited z-fighting cause). */}
        {canonical &&
          Array.from({ length: floorGrid.columns * floorGrid.rows }, (_, index) => {
            const column = index % floorGrid.columns;
            const row = Math.floor(index / floorGrid.columns);
            return (
              <group
                key={`floor:${column}:${row}`}
                position={[
                  -width / 2 + floorGrid.cellWidth * (column + 0.5),
                  0,
                  -depth / 2 + floorGrid.cellDepth * (row + 0.5),
                ]}
              >
                <InteriorStructure
                  glbKey={props.def.floorGlb}
                  size={[floorGrid.cellWidth, 0.18, floorGrid.cellDepth]}
                  variant="floor"
                  yaw={0}
                  canonical
                />
              </group>
            );
          })}
        {[...props.def.partitions, ...props.def.props].map((placement, index) => (
          <group
            key={`${placement.id}:${index}`}
            position={placement.local}
            rotation={[0, placement.rotY, 0]}
          >
            <InteriorProp placement={placement} />
          </group>
        ))}
      </group>
      <InteriorPopulationDirector
        def={props.def}
        reducedMotion={props.reducedMotion}
      />
      <InteriorQaCamera def={props.def} />
      <InteriorPerfProbe def={props.def} />
    </group>
  );
}

useGLTF.preload("/world/props/press-common-operable-v2.glb?v=press-v2");

export function preloadInteriorAssets(def: InteriorDef): void {
  useGLTF.preload(`/world/structures/${def.shellGlb}.glb`);
  useGLTF.preload(`/world/structures/${def.floorGlb}.glb`);
  for (const placement of [...def.partitions, ...def.props]) {
    const folder = placement.glb.startsWith("int-partition-")
      ? "structures"
      : "props";
    useGLTF.preload(`/world/${folder}/${placement.glb}.glb`);
  }
}

