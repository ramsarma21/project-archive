// SkyDirector: full-day sky rig for the 1765-Boston street (Bible §6).
// One sun-arc + drei Sky light rig extended with authored palettes,
// an overcast/night dome, a horizon gradient band, a drifting cloud layer,
// moon + stars for the post-boundary evening beats, scene fog management,
// and the dusk lantern/window-glow warmth. Everything is driven by the pure
// atmosphere schedule so weather and audio agree with what the sky shows.
// Chromebook budget: one shadow-casting light, instanced window glow, a
// handful of transparent planes; no post-processing.

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Sky } from "@react-three/drei";
import { BUILDINGS } from "./manifest.js";
import * as manifest from "./manifest.js";
import { mulberry32, type Atmosphere } from "./atmosphere.js";
import { QA_RUNTIME_ENABLED } from "./qaEnvironment.js";

// ---- Scene fog, smoothed per frame so stage changes never pop --------------
function FogRig(props: { atmo: Atmosphere }) {
  const scene = useThree((s) => s.scene);
  const fog = useMemo(() => new THREE.Fog("#cfd8de", 60, 190), []);
  useEffect(() => {
    scene.fog = fog;
    return () => {
      scene.fog = null;
    };
  }, [scene, fog]);
  useFrame((_, dt) => {
    const k = 1 - Math.exp(-dt * 2.2);
    fog.color.lerp(props.atmo.fogColor, k);
    fog.near = THREE.MathUtils.lerp(fog.near, props.atmo.fogNear, k);
    fog.far = THREE.MathUtils.lerp(fog.far, props.atmo.fogFar, k);
  });
  return null;
}

// ---- Sun + hemisphere + (night) moonlight ----------------------------------
// The shadow rig follows the camera in coarse steps so the one shadow box
// covers wherever the player walks on the long street (wharf to Liberty Tree).
function SunRig(props: { atmo: Atmosphere }) {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const a = props.atmo;
  useFrame(({ camera }) => {
    const light = lightRef.current;
    if (!light) return;
    const fx = Math.round(camera.position.x / 8) * 8;
    const fz = Math.round(camera.position.z / 8) * 8;
    target.position.set(fx, 0, fz);
    light.position.set(
      fx + a.sunDir.x * 60,
      Math.max(a.sunDir.y * 60, 6),
      fz + a.sunDir.z * 60,
    );
    light.target.updateMatrixWorld();
  });
  return (
    <group>
      <primitive object={target} />
      <hemisphereLight args={[a.hemiSky, a.hemiGround, a.hemiIntensity]} />
      <directionalLight
        ref={lightRef}
        intensity={a.sunIntensity}
        color={a.sunColor}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-55}
        shadow-camera-right={55}
        shadow-camera-top={45}
        shadow-camera-bottom={-45}
        shadow-bias={-0.0003}
        target={target}
      />
      {a.night > 0.01 && (
        <directionalLight
          position={[a.moonDir.x * 70, Math.max(a.moonDir.y * 70, 20), a.moonDir.z * 70]}
          intensity={0.5 * a.night}
          color="#9fb2d8"
        />
      )}
    </group>
  );
}

// ---- Overcast / night dome + horizon gradient band --------------------------
function useGradientTexture(stops: [number, string][]): THREE.CanvasTexture {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 4;
    c.height = 128;
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 128, 0, 0);
    for (const [at, color] of stops) grad.addColorStop(at, color);
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }, [stops]);
}

// White multiplies to the palette tint; the top darkens so the overcast
// presses down like the reference image instead of reading as a flat card.
const DOME_STOPS: [number, string][] = [
  [0, "rgba(255,255,255,1)"],
  [0.35, "rgba(238,240,243,0.99)"],
  [1, "rgba(168,172,180,0.97)"],
];
const BAND_STOPS: [number, string][] = [
  [0, "rgba(255,255,255,0.95)"],
  [0.4, "rgba(255,255,255,0.55)"],
  [1, "rgba(255,255,255,0)"],
];

function SkyDomes(props: { atmo: Atmosphere }) {
  const domeTex = useGradientTexture(DOME_STOPS);
  const bandTex = useGradientTexture(BAND_STOPS);
  const domeMat = useRef<THREE.MeshBasicMaterial>(null);
  const bandMat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((_, dt) => {
    const k = 1 - Math.exp(-dt * 2.2);
    if (domeMat.current) {
      domeMat.current.color.lerp(props.atmo.overcastColor, k);
      domeMat.current.opacity = THREE.MathUtils.lerp(
        domeMat.current.opacity,
        props.atmo.overcastOpacity,
        k,
      );
    }
    if (bandMat.current) {
      bandMat.current.color.lerp(props.atmo.horizonColor, k);
      bandMat.current.opacity = THREE.MathUtils.lerp(
        bandMat.current.opacity,
        0.5 + props.atmo.overcastOpacity * 0.4,
        k,
      );
    }
  });
  return (
    <group>
      {/* overcast/night dome: pewter gray by day, deep blue after boundary */}
      <mesh renderOrder={-9} frustumCulled={false}>
        <sphereGeometry args={[330, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
        <meshBasicMaterial
          ref={domeMat}
          map={domeTex}
          color="#8f99a3"
          transparent
          opacity={0.86}
          side={THREE.BackSide}
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </mesh>
      {/* horizon gradient band (dawn rose-gray / golden amber / ember) */}
      <mesh position={[0, 16, 0]} renderOrder={-8} frustumCulled={false}>
        <cylinderGeometry args={[300, 300, 70, 36, 1, true]} />
        <meshBasicMaterial
          ref={bandMat}
          map={bandTex}
          color="#b6bec6"
          transparent
          opacity={0.8}
          side={THREE.BackSide}
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

// ---- Moon disc + faint star points (post-boundary evening beats) ------------
function NightSky(props: { atmo: Atmosphere }) {
  const moonMat = useRef<THREE.MeshBasicMaterial>(null);
  const moonGlowMat = useRef<THREE.MeshBasicMaterial>(null);
  const starMat = useRef<THREE.PointsMaterial>(null);
  const moonGroup = useRef<THREE.Group>(null);
  const stars = useMemo(() => {
    const rnd = mulberry32(1765);
    const count = 420;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const az = rnd() * Math.PI * 2;
      const el = THREE.MathUtils.degToRad(12 + rnd() * 75);
      const r = 305;
      positions[i * 3] = r * Math.cos(el) * Math.sin(az);
      positions[i * 3 + 1] = r * Math.sin(el);
      positions[i * 3 + 2] = r * Math.cos(el) * Math.cos(az);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geo;
  }, []);
  useFrame((_, dt) => {
    const k = 1 - Math.exp(-dt * 1.6);
    const target = props.atmo.night;
    if (moonMat.current) moonMat.current.opacity = THREE.MathUtils.lerp(moonMat.current.opacity, target, k);
    if (moonGlowMat.current) moonGlowMat.current.opacity = THREE.MathUtils.lerp(moonGlowMat.current.opacity, target * 0.3, k);
    if (starMat.current) starMat.current.opacity = THREE.MathUtils.lerp(starMat.current.opacity, target * 0.85, k);
    if (moonGroup.current) {
      const d = props.atmo.moonDir;
      moonGroup.current.position.set(d.x * 290, Math.max(d.y * 290, 40), d.z * 290);
      moonGroup.current.lookAt(0, 0, 0);
    }
  });
  if (props.atmo.night <= 0.001) return null;
  return (
    <group>
      <group ref={moonGroup}>
        <mesh renderOrder={-6}>
          <circleGeometry args={[13, 28]} />
          <meshBasicMaterial ref={moonMat} color="#e8ecf2" transparent opacity={0} fog={false} toneMapped={false} depthWrite={false} />
        </mesh>
        <mesh renderOrder={-7}>
          <circleGeometry args={[24, 28]} />
          <meshBasicMaterial
            ref={moonGlowMat}
            color="#aebbd4"
            transparent
            opacity={0}
            fog={false}
            toneMapped={false}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      </group>
      <points geometry={stars} renderOrder={-6} frustumCulled={false}>
        <pointsMaterial
          ref={starMat}
          color="#cdd8ec"
          size={1.3}
          sizeAttenuation={false}
          transparent
          opacity={0}
          fog={false}
          toneMapped={false}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}

// ---- Drifting cloud layer ----------------------------------------------------
function useCloudTexture(): THREE.CanvasTexture {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, 256, 256);
    const rnd = mulberry32(431);
    for (let i = 0; i < 34; i++) {
      // keep every blob fully inside the canvas so the plane edges stay
      // transparent (a clipped blob prints a hard rectangle edge in the sky)
      const r = 20 + rnd() * 40;
      const x = r + 8 + rnd() * (256 - 2 * (r + 8));
      const y = r + 8 + rnd() * (256 - 2 * (r + 8));
      const grad = g.createRadialGradient(x, y, r * 0.12, x, y, r);
      const a = 0.24 + rnd() * 0.28;
      grad.addColorStop(0, `rgba(255,255,255,${a})`);
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 256);
    }
    return new THREE.CanvasTexture(c);
  }, []);
}

// Two cloud representations, both cheap: a ring of camera-facing billboards
// low over the horizon (what you actually see from the street) and a few
// horizontal sheets overhead (for look-up and vantage-roof moments). Drift is
// a slow orbit of the ring + slide of the sheets; reduced motion freezes both.
interface CloudSpec {
  angle: number; // ring position
  elev: number; // radians above horizon
  size: number;
  speed: number; // radians/sec around the ring
  stretch: number;
}

function CloudLayer(props: { atmo: Atmosphere; reducedMotion: boolean }) {
  const tex = useCloudTexture();
  const ringGroup = useRef<THREE.Group>(null);
  const sheetGroup = useRef<THREE.Group>(null);
  const mats = useRef<THREE.MeshBasicMaterial[]>([]);
  const ring = useMemo<CloudSpec[]>(() => {
    const rnd = mulberry32(97);
    return Array.from({ length: 10 }, () => ({
      angle: rnd() * Math.PI * 2,
      elev: THREE.MathUtils.degToRad(7 + rnd() * 16),
      size: 120 + rnd() * 110,
      speed: (0.0016 + rnd() * 0.0022) * (rnd() < 0.5 ? 1 : -1),
      stretch: 2.4 + rnd() * 1.4,
    }));
  }, []);
  const sheets = useMemo(() => {
    const rnd = mulberry32(53);
    return Array.from({ length: 4 }, () => ({
      x: -160 + rnd() * 320,
      z: -140 + rnd() * 280,
      y: 62 + rnd() * 20,
      size: 130 + rnd() * 90,
      speed: 2 + rnd() * 2.4,
      rot: rnd() * Math.PI * 2,
    }));
  }, []);
  useFrame(({ camera }, dt) => {
    const k = 1 - Math.exp(-dt * 2.2);
    const opacity = 0.24 + props.atmo.cloudCover * 0.58;
    for (const m of mats.current) {
      if (!m) continue;
      m.color.lerp(props.atmo.cloudColor, k);
      m.opacity = THREE.MathUtils.lerp(m.opacity, opacity, k);
    }
    const rg = ringGroup.current;
    if (rg) {
      rg.children.forEach((child, i) => {
        const spec = ring[i];
        if (!spec) return;
        if (!props.reducedMotion) spec.angle += spec.speed * dt;
        const r = 265;
        child.position.set(
          Math.sin(spec.angle) * r * Math.cos(spec.elev),
          Math.sin(spec.elev) * r,
          Math.cos(spec.angle) * r * Math.cos(spec.elev),
        );
        child.quaternion.copy(camera.quaternion); // billboard
      });
    }
    const sg = sheetGroup.current;
    if (sg && !props.reducedMotion) {
      sg.children.forEach((child, i) => {
        const spec = sheets[i];
        if (!spec) return;
        child.position.x += spec.speed * dt;
        if (child.position.x > 260) child.position.x = -260;
      });
    }
  });
  let mi = 0;
  const cloudMat = () => (
    <meshBasicMaterial
      ref={(m: THREE.MeshBasicMaterial | null) => {
        if (m) mats.current[mi++] = m;
      }}
      map={tex}
      color="#98a0a8"
      transparent
      opacity={0}
      depthWrite={false}
      fog={false}
      toneMapped={false}
      side={THREE.DoubleSide}
    />
  );
  return (
    <group>
      <group ref={ringGroup}>
        {ring.map((s, i) => (
          <mesh key={i} renderOrder={-5} frustumCulled={false}>
            <planeGeometry args={[s.size * s.stretch * 0.55, s.size * 0.34]} />
            {cloudMat()}
          </mesh>
        ))}
      </group>
      <group ref={sheetGroup}>
        {sheets.map((s, i) => (
          <mesh
            key={i}
            position={[s.x, s.y, s.z]}
            rotation={[-Math.PI / 2, 0, s.rot]}
            renderOrder={-5}
            frustumCulled={false}
          >
            <planeGeometry args={[s.size, s.size * 0.62]} />
            {cloudMat()}
          </mesh>
        ))}
      </group>
    </group>
  );
}

// ---- Dusk warmth: street lanterns + instanced window glow --------------------
// The visible lamp is the imported street-lantern-bracket GLB mounted on a
// facade (see manifest PROPS + LANTERNS). This director contributes ONLY the
// warm point light at each anchored bracket flame height; there is no
// procedural lantern box. If the manifest exposes no anchors, nothing is drawn
// (no floating fallback boxes against the open sky).
const LANTERN_POSITIONS: [number, number, number][] = manifest.LANTERNS ?? [];

function Lanterns(props: { atmo: Atmosphere }) {
  const warmth = props.atmo.lanternWarmth;
  if (warmth <= 0.02 || LANTERN_POSITIONS.length === 0) return null;
  return (
    <group>
      {LANTERN_POSITIONS.map((p, i) => (
        <pointLight
          key={i}
          position={p}
          intensity={15 * warmth}
          distance={13}
          decay={1.9}
          color="#ffb469"
          castShadow={false}
        />
      ))}
    </group>
  );
}

// Candle-glow spill on the facades at dusk. The generated building GLBs have
// arbitrary window layouts, so precise lit-window quads misalign; instead a
// soft radial halo hugs each facade low on the wall (hearth/candle spill) and
// reads as warm pinpricks down the street without claiming exact windows.
function useGlowTexture(): THREE.CanvasTexture {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    grad.addColorStop(0, "rgba(255,206,130,0.85)");
    grad.addColorStop(0.4, "rgba(255,180,100,0.32)");
    grad.addColorStop(1, "rgba(255,160,80,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }, []);
}

function WindowGlow(props: { atmo: Atmosphere }) {
  const tex = useGlowTexture();
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const glows = useMemo(() => {
    const out: { pos: [number, number, number]; rotY: number; scale: number }[] = [];
    for (const b of BUILDINGS) {
      const toStreet = b.pos[2] > 0 ? -1 : 1;
      const frontZ = b.pos[2] + toStreet * (b.size[2] / 2 + 0.14);
      for (const side of [-0.24, 0.26]) {
        out.push({
          pos: [b.pos[0] + side * b.size[0], 1.5 + (side > 0 ? 0.45 : 0), frontZ],
          rotY: toStreet > 0 ? 0 : Math.PI,
          scale: 1.1 + Math.abs(side) * 1.5,
        });
      }
    }
    return out;
  }, []);
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    glows.forEach((w, i) => {
      q.setFromEuler(new THREE.Euler(0, w.rotY, 0));
      m.compose(new THREE.Vector3(...w.pos), q, new THREE.Vector3(w.scale, w.scale, w.scale));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [glows]);
  useFrame((_, dt) => {
    if (!matRef.current) return;
    const k = 1 - Math.exp(-dt * 2.2);
    matRef.current.opacity = THREE.MathUtils.lerp(
      matRef.current.opacity,
      props.atmo.lanternWarmth * 0.55,
      k,
    );
  });
  if (props.atmo.lanternWarmth <= 0.02) return null;
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, glows.length]} frustumCulled={false}>
      <planeGeometry args={[1.6, 1.6]} />
      <meshBasicMaterial
        ref={matRef}
        map={tex}
        color="#ffc678"
        transparent
        opacity={0}
        toneMapped={false}
        depthWrite={false}
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
      />
    </instancedMesh>
  );
}

// ---- Perf probe (Bible §12): draw calls onto the .world3d dataset -----------
function PerfProbe() {
  const last = useRef(0);
  const frameTimes = useRef<number[]>([]);
  const latest = useRef<Record<string, unknown>>({});
  const renderer = useRef<THREE.WebGLRenderer | null>(null);
  const liveScene = useRef<THREE.Scene | null>(null);
  const liveCamera = useRef<THREE.Camera | null>(null);
  useEffect(() => {
    if (!QA_RUNTIME_ENABLED || typeof window === "undefined") return;
    const target = window as Window & {
      __paPerf?: () => unknown;
      __paPerfSetShadows?: (enabled: boolean) => void;
      __paPerfDetails?: () => unknown;
      __paPerfResources?: () => unknown;
    };
    target.__paPerf = () => {
      const sorted = [...frameTimes.current].sort((a, b) => a - b);
      const percentile = (p: number) =>
        sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
      const mean =
        sorted.length > 0
          ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length
          : 0;
      return {
        ...latest.current,
        frameMs: {
          samples: sorted.length,
          mean,
          p50: percentile(0.5),
          p95: percentile(0.95),
          p99: percentile(0.99),
          max: sorted[sorted.length - 1] ?? 0,
        },
        fps: mean > 0 ? 1000 / mean : 0,
      };
    };
    target.__paPerfSetShadows = (enabled) => {
      if (renderer.current) renderer.current.shadowMap.enabled = enabled;
    };
    target.__paPerfDetails = () => {
      const scene = liveScene.current;
      const camera = liveCamera.current;
      if (!scene || !camera) return [];
      const projection = new THREE.Matrix4().multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      );
      const frustum = new THREE.Frustum().setFromProjectionMatrix(projection);
      const sphere = new THREE.Sphere();
      const rows: { name: string; triangles: number; instances: number }[] = [];
      scene.traverseVisible((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        if (mesh.frustumCulled) {
          if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
          if (mesh.geometry.boundingSphere) {
            sphere.copy(mesh.geometry.boundingSphere).applyMatrix4(mesh.matrixWorld);
            if (!frustum.intersectsSphere(sphere)) return;
          }
        }
        const positionCount = mesh.geometry.getAttribute("position")?.count ?? 0;
        const primitiveCount = mesh.geometry.index?.count ?? positionCount;
        const instances = (mesh as THREE.InstancedMesh).isInstancedMesh
          ? (mesh as THREE.InstancedMesh).count
          : 1;
        const path: string[] = [];
        let cursor: THREE.Object3D | null = mesh;
        while (cursor && path.length < 5) {
          if (cursor.name) path.unshift(cursor.name);
          cursor = cursor.parent;
        }
        rows.push({
          name: path.join("/") || mesh.type,
          triangles: Math.floor(primitiveCount / 3) * instances,
          instances,
        });
      });
      return rows.sort((a, b) => b.triangles - a.triangles);
    };
    target.__paPerfResources = () => {
      const scene = liveScene.current;
      const gl = renderer.current;
      if (!scene || !gl) return null;
      const geometries = new Set<string>();
      const materials = new Set<string>();
      const textures = new Map<string, string>();
      scene.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (mesh.geometry) geometries.add(mesh.geometry.uuid);
        const meshMaterials = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        for (const material of meshMaterials) {
          if (!material) continue;
          materials.add(material.uuid);
          for (const value of Object.values(material)) {
            if (!(value instanceof THREE.Texture)) continue;
            const image = value.image as
              | { currentSrc?: string; src?: string }
              | undefined;
            textures.set(
              value.uuid,
              image?.currentSrc ?? image?.src ?? value.name ?? value.type,
            );
          }
        }
      });
      return {
        renderer: {
          geometries: gl.info.memory.geometries,
          textures: gl.info.memory.textures,
          programs: gl.info.programs?.length ?? 0,
        },
        scene: {
          geometryUuids: [...geometries].sort(),
          materialUuids: [...materials].sort(),
          textureUuids: [...textures.keys()].sort(),
          textures: [...textures.entries()].sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        },
      };
    };
    return () => {
      delete target.__paPerf;
      delete target.__paPerfSetShadows;
      delete target.__paPerfDetails;
      delete target.__paPerfResources;
    };
  }, []);
  useFrame(({ gl, scene, camera, size }, dt) => {
    renderer.current = gl;
    liveScene.current = scene;
    liveCamera.current = camera;
    const samples = frameTimes.current;
    samples.push(dt * 1000);
    if (samples.length > 240) samples.shift();
    const now = performance.now();
    if (now - last.current < 800) return;
    last.current = now;
    let visibleSkinnedMeshes = 0;
    let visibleMeshes = 0;
    scene.traverseVisible((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      visibleMeshes++;
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) visibleSkinnedMeshes++;
    });
    latest.current = {
      renderer: {
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        points: gl.info.render.points,
        lines: gl.info.render.lines,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
        programs: gl.info.programs?.length ?? 0,
      },
      dpr: gl.getPixelRatio(),
      viewport: [size.width, size.height],
      camera: {
        position: camera.position.toArray(),
        rotation: camera.rotation.toArray().slice(0, 3),
      },
      scene: { visibleMeshes, visibleSkinnedMeshes },
    };
    const host = document.querySelector<HTMLElement>(".world3d");
    if (host) {
      host.dataset.drawCalls = String(gl.info.render.calls);
      host.dataset.triangles = String(gl.info.render.triangles);
    }
  });
  return null;
}

// Sky furniture is conceptually at infinity: the domes/bands/stars ride the
// camera's x/z so walking to the wharf never reveals a dome edge.
function SkyAnchor(props: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ camera }) => {
    ref.current?.position.set(camera.position.x, 0, camera.position.z);
  });
  return <group ref={ref}>{props.children}</group>;
}

// ---- The director ------------------------------------------------------------
export function SkyDirector(props: { atmo: Atmosphere; reducedMotion: boolean }) {
  const a = props.atmo;
  return (
    <group>
      <FogRig atmo={a} />
      <Sky
        sunPosition={[a.sunDir.x * 100, Math.max(a.sunDir.y, 0.005) * 100, a.sunDir.z * 100]}
        turbidity={a.turbidity}
        rayleigh={a.rayleigh}
        mieCoefficient={0.006}
        mieDirectionalG={0.8}
      />
      <SkyAnchor>
        <SkyDomes atmo={a} />
        <CloudLayer atmo={a} reducedMotion={props.reducedMotion} />
        <NightSky atmo={a} />
      </SkyAnchor>
      <SunRig atmo={a} />
      <Lanterns atmo={a} />
      <WindowGlow atmo={a} />
      <PerfProbe />
    </group>
  );
}
