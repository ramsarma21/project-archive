// WaterDirector: the harbor at the wharf pocket (Bible §3 + §7).
// One large water plane west of the wharf gate (x ≈ -118, y ≈ -1.1) with a
// cheap animated MeshStandardMaterial (onBeforeCompile): a directional
// multi-sine wave field drives vertex heave + a rebuilt surface normal, and a
// hand-rolled Fresnel sky term plus directional sun/moon glitter make the
// motion actually read on flat overcast light (no env map, no reflection
// probe). Wind/amplitude/highlight colour all track the atmosphere (drizzle
// choppier, clearing glassier + golden, night cool moon glint). Imported ships,
// rowboats, and buoys ride gentle bob/sway loops. Gull flavor is audio and
// attributed text only until an approved imported bird asset exists; no
// procedural bird stand-in. Under reducedMotion the water keeps a slow
// low-amplitude drift. No reflections, refraction, or simulation.

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { FittedGlb } from "./Character.js";
import type { Atmosphere } from "./atmosphere.js";

// Wharf-pocket geometry (Bible §3). The deck itself belongs to the layout
// worker; water surrounds the deck rectangle and the foam band traces it.
// TODO(layout): rebind these once the big-street manifest lands with the
// final wharf coordinates.
const WATER_Y = -1.1;
const DECK = { minX: -160, maxX: -118, minZ: -30, maxZ: 14 };

function WaterPlane(props: { atmo: Atmosphere; reducedMotion: boolean }) {
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uDeck: { value: new THREE.Vector4(DECK.minX, DECK.minZ, DECK.maxX, DECK.maxZ) },
      uFoamColor: { value: new THREE.Color("#c8d2cc") },
      // uAmp: master wave amplitude (drops, never to zero, under reduced motion)
      uAmp: { value: 1 },
      // uSteep: how hard the surface normals tilt — the main lever on how much
      // the specular/sky sheen visibly travels across the plane
      uSteep: { value: 2.6 },
      // uWind: xz ripple-train direction * speed (choppier in drizzle)
      uWind: { value: new THREE.Vector2(0.6, 0.32) },
      // uSunDir: world-space unit vector toward the key light (sun by day,
      // moon by night) — drives the moving glitter highlights
      uSunDir: { value: new THREE.Vector3(0.3, 0.7, 0.4) },
      uSunColor: { value: new THREE.Color("#f2eddf") },
      // uSkyColor: cheap stand-in for a reflection probe; grazing angles pick
      // this up as a Fresnel sheen so the harbor reads wet without a real env map
      uSkyColor: { value: new THREE.Color("#8f99a3") },
      uSpec: { value: 0.6 }, // glitter strength
      uReflect: { value: 0.3 }, // Fresnel sky-reflection strength
    }),
    [],
  );
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(150, 190, 72, 72);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  const material = useMemo(() => {
    // metalness stays near zero: with no environment map a metallic surface
    // just multiplies to black on Chromebook-class GPUs. The wet look comes
    // from the hand-rolled Fresnel sky term + directional glitter instead.
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#2c3a35"),
      roughness: 0.52,
      metalness: 0.06,
    });
    // Shared wave field, sampled in both stages. Directional ripple trains plus
    // a couple of crossed swells; kept cheap (handful of sines) for Chromebooks.
    const WAVE_GLSL = `
      uniform float uTime;
      uniform float uAmp;
      uniform vec2 uWind;
      varying vec3 vWaterPos;
      float waveH(vec2 p) {
        float t = uTime;
        float h = 0.0;
        h += sin(dot(p, vec2(0.14, 0.10)) + t * 0.85) * 0.55;
        h += sin(dot(p, vec2(-0.09, 0.17)) + t * 1.12) * 0.40;
        h += sin(dot(p, vec2(0.22, -0.13)) - t * 1.55) * 0.24;
        h += sin(dot(p, vec2(0.33, 0.27)) - t * 2.10) * 0.13;
        // wind-aligned short chop for directionality
        h += sin(dot(p, uWind) * 0.55 + t * 2.4) * 0.11;
        return h * uAmp;
      }`;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${WAVE_GLSL}`)
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
           vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
           // vertical heave uses a fraction of the field so the 72x72 grid never
           // spikes; the rest of the motion is faked in the normal below
           transformed.y += waveH(wp.xz) * 0.28;
           vWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
           ${WAVE_GLSL}
           uniform vec4 uDeck;
           uniform vec3 uFoamColor;
           uniform float uSteep;
           uniform vec3 uSunDir;
           uniform vec3 uSunColor;
           uniform vec3 uSkyColor;
           uniform float uSpec;
           uniform float uReflect;`,
        )
        .replace(
          "#include <normal_fragment_begin>",
          `#include <normal_fragment_begin>
           // Rebuild the surface normal from the analytic wave gradient. These
           // locals stay in scope for the reflection block further down main().
           vec2 wsp = vWaterPos.xz;
           float e = 0.85;
           float wh0 = waveH(wsp);
           float whx = waveH(wsp + vec2(e, 0.0));
           float whz = waveH(wsp + vec2(0.0, e));
           vec3 gWaveN = normalize(vec3(-(whx - wh0) / e * uSteep, 1.0, -(whz - wh0) / e * uSteep));
           normal = normalize((viewMatrix * vec4(gWaveN, 0.0)).xyz);
           vec3 gViewDir = normalize(cameraPosition - vWaterPos);
           float gFresnel = pow(1.0 - clamp(dot(gViewDir, gWaveN), 0.0, 1.0), 4.0);`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
           {
             // foam line hugging the pier: distance to the deck rectangle
             vec2 p = vWaterPos.xz;
             vec2 dmin = uDeck.xy - p;
             vec2 dmax = p - uDeck.zw;
             vec2 dv = max(vec2(0.0), max(dmin, dmax));
             float dist = length(dv) + min(0.0, max(max(dmin.x, dmax.x), max(dmin.y, dmax.y)));
             // narrow lapping band hugging the pier face; soft modulation so
             // grazing views never stretch on/off segments into wedges
             float band = abs(dist - 0.3);
             float wob = sin(p.x * 2.3 + uTime * 1.3) * 0.1 + sin(p.y * 2.9 - uTime * 1.1) * 0.1;
             float foam = 1.0 - smoothstep(0.0, 0.85 + wob, band);
             foam *= 0.82 + 0.18 * sin(uTime * 1.7 + p.x * 3.7 + p.y * 2.9);
             foam = clamp(foam, 0.0, 1.0) * 0.4;
             diffuseColor.rgb = mix(diffuseColor.rgb, uFoamColor, foam);
             // troughs read darker than crests → visible travelling bands
             // (color_fragment runs before the normal block, so sample fresh)
             diffuseColor.rgb *= 0.9 + 0.12 * clamp(waveH(p) * 0.6 + 0.5, 0.0, 1.0);
           }`,
        )
        .replace(
          "#include <opaque_fragment>",
          `// --- water sheen: Fresnel sky reflection + directional glitter ---
           {
             vec3 skyRef = uSkyColor * (0.55 + 0.45 * gWaveN.y);
             outgoingLight = mix(outgoingLight, skyRef, gFresnel * uReflect);
             vec3 hv = normalize(gViewDir + uSunDir);
             float ndh = max(dot(gWaveN, hv), 0.0);
             // sharp sparkle, chopped into points by a high-freq wave term
             float sparkle = pow(ndh, 240.0) * (0.55 + 0.45 * sin(vWaterPos.x * 6.1 + vWaterPos.z * 5.3 + uTime * 3.1));
             // broad soft glint keeps some highlight alive under flat overcast
             float glint = pow(ndh, 26.0);
             outgoingLight += uSunColor * (sparkle * uSpec + glint * uSpec * 0.22);
           }
           #include <opaque_fragment>`,
        );
    };
    return m;
  }, [uniforms]);
  const tmpDir = useMemo(() => new THREE.Vector3(), []);
  const tmpSun = useMemo(() => new THREE.Color(), []);
  const tmpSky = useMemo(() => new THREE.Color(), []);
  const MOON_TINT = useMemo(() => new THREE.Color("#a9b8d8"), []);
  const NIGHT_SKY = useMemo(() => new THREE.Color("#1b2740"), []);
  useFrame((_, dt) => {
    const a = props.atmo;
    const rm = props.reducedMotion;
    // Reduced motion keeps a slow, low-amplitude drift rather than a dead plane:
    // time still advances (slowly) and amplitude eases down, never to zero.
    uniforms.uTime.value += dt * (rm ? 0.4 : 1);
    const windMag = 0.7 + a.drizzle * 0.75 - a.clearing * 0.2;
    uniforms.uWind.value.set(0.62 * windMag, 0.34 * windMag);
    let amp = 0.9 + a.drizzle * 0.55 - a.clearing * 0.28;
    uniforms.uAmp.value = rm ? amp * 0.42 : amp;
    uniforms.uSteep.value = rm ? 1.5 : 2.6;
    // golden hour / clearing brightens highlights; night swaps to a cool moon
    // glint; gloom keeps a modest but non-flat sheen
    uniforms.uSpec.value = (0.4 + a.clearing * 0.95 + a.night * 0.55) * (rm ? 0.6 : 1);
    uniforms.uReflect.value = 0.26 + a.clearing * 0.2 + a.night * 0.12;
    // key light: sun by day, sliding to the moon track after dark
    tmpDir.copy(a.sunDir).lerp(a.moonDir, a.night).normalize();
    uniforms.uSunDir.value.copy(tmpDir);
    uniforms.uSunColor.value.copy(tmpSun.copy(a.sunColor).lerp(MOON_TINT, a.night));
    // reflected "sky": overcast/horizon tint by day, deep blue at night
    uniforms.uSkyColor.value.copy(
      tmpSky.copy(a.overcastColor).lerp(a.horizonColor, 0.4).lerp(NIGHT_SKY, a.night),
    );
    // pewter water in the gloom, greener when clearing, near-black at night
    const k = 1 - Math.exp(-dt * 2);
    const target = new THREE.Color("#2c3a35")
      .lerp(new THREE.Color("#334a40"), a.clearing)
      .lerp(new THREE.Color("#16202a"), a.night);
    material.color.lerp(target, k);
    material.roughness = THREE.MathUtils.lerp(material.roughness, 0.56 - a.clearing * 0.12, k);
  });
  // No receiveShadow: the shadow map is rendered against the undisplaced
  // plane, so piling shadows smear into bright streaks across the bobbing
  // surface — and Bible §12 wants the water free of shadow work anyway.
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={[-186, WATER_Y, 0]}
      frustumCulled={false}
    />
  );
}

// ---- Pilings: one instanced mesh along the pier faces ------------------------
function Pilings() {
  const spots = useMemo(() => {
    const out: [number, number, number][] = [];
    for (let x = DECK.minX + 2; x <= DECK.maxX - 2; x += 5.2) out.push([x, WATER_Y - 0.4, DECK.maxZ + 0.35]);
    for (let z = DECK.minZ + 4; z <= DECK.maxZ - 2; z += 6) out.push([DECK.minX - 0.35, WATER_Y - 0.4, z]);
    return out;
  }, []);
  return (
    <instancedMesh
      ref={(m: THREE.InstancedMesh | null) => {
        if (!m || m.userData.placed) return;
        const mat = new THREE.Matrix4();
        spots.forEach((p, i) => {
          mat.makeTranslation(p[0], p[1] + 1.3, p[2]);
          m.setMatrixAt(i, mat);
        });
        m.instanceMatrix.needsUpdate = true;
        m.userData.placed = true;
      }}
      args={[undefined, undefined, spots.length]}
      castShadow
    >
      <cylinderGeometry args={[0.13, 0.16, 2.6, 7]} />
      <meshStandardMaterial color="#372c21" roughness={0.95} />
    </instancedMesh>
  );
}

// ---- Masted hull primitive: stands in for any missing ship GLB ---------------
function MastedHull(props: { length: number; masts: number; hull?: string }) {
  const L = props.length;
  const W = L * 0.26;
  const H = L * 0.14;
  const hull = props.hull ?? "#3b2f24";
  return (
    <group>
      <mesh position={[0, H * 0.5, 0]} castShadow>
        <boxGeometry args={[L * 0.78, H, W]} />
        <meshStandardMaterial color={hull} roughness={0.9} />
      </mesh>
      {/* bow + stern tapers */}
      <mesh position={[L * 0.44, H * 0.5, 0]} rotation={[0, 0, -Math.PI / 2]} castShadow>
        <coneGeometry args={[W * 0.5, L * 0.2, 4]} />
        <meshStandardMaterial color={hull} roughness={0.9} />
      </mesh>
      <mesh position={[-L * 0.42, H * 0.5, 0]} castShadow>
        <boxGeometry args={[L * 0.1, H * 1.1, W * 0.8]} />
        <meshStandardMaterial color="#463828" roughness={0.9} />
      </mesh>
      {/* rail strake */}
      <mesh position={[0, H + 0.06, 0]}>
        <boxGeometry args={[L * 0.8, 0.12, W * 1.02]} />
        <meshStandardMaterial color="#2c2318" roughness={0.95} />
      </mesh>
      {/* masts + yards + furled sail bundles */}
      {Array.from({ length: props.masts }, (_, i) => {
        const x = props.masts === 1 ? 0 : THREE.MathUtils.lerp(L * 0.22, -L * 0.24, i / (props.masts - 1));
        const mastH = L * (0.95 - i * 0.08);
        return (
          <group key={i} position={[x, H, 0]}>
            <mesh position={[0, mastH / 2, 0]} castShadow>
              <cylinderGeometry args={[0.07, 0.12, mastH, 6]} />
              <meshStandardMaterial color="#4a3b2a" roughness={0.9} />
            </mesh>
            {[0.62, 0.82].map((f) => (
              <group key={f} position={[0, mastH * f, 0]}>
                <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
                  <cylinderGeometry args={[0.045, 0.045, W * 2.4 * (1.15 - f * 0.4), 5]} />
                  <meshStandardMaterial color="#41332a" roughness={0.9} />
                </mesh>
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                  <cylinderGeometry args={[0.1, 0.1, W * 2.1 * (1.15 - f * 0.4), 5]} />
                  <meshStandardMaterial color="#b8a98c" roughness={1} />
                </mesh>
              </group>
            ))}
          </group>
        );
      })}
      {/* bowsprit */}
      <mesh position={[L * 0.52, H * 1.15, 0]} rotation={[0, 0, -0.4]} castShadow>
        <cylinderGeometry args={[0.05, 0.08, L * 0.3, 5]} />
        <meshStandardMaterial color="#4a3b2a" roughness={0.9} />
      </mesh>
    </group>
  );
}

// ---- Bobbing wrapper: gentle roll/sway/heave loop ----------------------------
function Bobbing(props: {
  position: [number, number, number];
  rotY: number;
  amp?: number; // radians of roll
  heave?: number;
  phase?: number;
  reducedMotion: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  const amp = props.amp ?? 0.035;
  const heave = props.heave ?? 0.05;
  const phase = props.phase ?? 0;
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    if (props.reducedMotion) {
      g.position.set(...props.position);
      g.rotation.set(0, props.rotY, 0);
      return;
    }
    const s = clock.elapsedTime;
    g.position.set(
      props.position[0],
      props.position[1] + Math.sin(s * 0.5 + phase) * heave,
      props.position[2],
    );
    g.rotation.set(
      Math.sin(s * 0.33 + phase * 1.7) * amp * 0.55,
      props.rotY,
      Math.sin(s * 0.45 + phase) * amp,
    );
  });
  return (
    <group ref={ref} position={props.position} rotation={[0, props.rotY, 0]}>
      {props.children}
    </group>
  );
}

// ---- Harbor haze sprite (Bible §6) -------------------------------------------
function useHazeTexture(): THREE.CanvasTexture {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
    grad.addColorStop(0, "rgba(215,222,228,0.5)");
    grad.addColorStop(1, "rgba(215,222,228,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);
}

function HarborHaze(props: { atmo: Atmosphere }) {
  const tex = useHazeTexture();
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((_, dt) => {
    if (!mat.current) return;
    const target = 0.16 + props.atmo.gloom * 0.2 + props.atmo.drizzle * 0.26 - props.atmo.night * 0.1;
    mat.current.opacity = THREE.MathUtils.lerp(mat.current.opacity, Math.max(0.05, target), 1 - Math.exp(-dt * 2));
  });
  return (
    <mesh position={[-215, 9, 10]} rotation={[0, Math.PI / 2.4, 0]} renderOrder={2} frustumCulled={false}>
      <planeGeometry args={[130, 34]} />
      <meshBasicMaterial ref={mat} map={tex} transparent opacity={0.3} depthWrite={false} fog={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

// ---- The director -------------------------------------------------------------
export function WaterDirector(props: { atmo: Atmosphere; reducedMotion: boolean }) {
  const rm = props.reducedMotion;
  return (
    <group>
      <WaterPlane atmo={props.atmo} reducedMotion={rm} />
      <HarborHaze atmo={props.atmo} />
      {/* hero brig, moored along the pier south face with the 3m clear apron */}
      <Bobbing position={[-137, WATER_Y, 21.5]} rotY={0.06} phase={0.3} reducedMotion={rm}>
        <FittedGlb glbKey="ship-brig-hero" size={[17, 15, 6]} fallback={null} />
      </Bobbing>
      {/* small sloop nearer the gate */}
      <Bobbing position={[-122.5, WATER_Y, 19]} rotY={-0.35} phase={2.1} amp={0.05} reducedMotion={rm}>
        <FittedGlb glbKey="ship-sloop" size={[9.5, 9, 3.4]} fallback={null} />
      </Bobbing>
      {/* background snow at anchor, out in the haze; FittedGlb grounds the hull's
          lowest point at y=0, so sink it to seat the below-waterline hull in the water */}
      <Bobbing position={[-196, WATER_Y, 34]} rotY={0.8} phase={4.4} amp={0.02} heave={0.03} reducedMotion={rm}>
        <group position={[0, -1.1, 0]}>
          <FittedGlb glbKey="ship-snow-background" size={[14, 12, 5]} fallback={null} />
        </group>
      </Bobbing>
      {/* rowboats + buoys */}
      <Bobbing position={[-146.5, WATER_Y + 0.12, 16.4]} rotY={1.2} phase={1.4} amp={0.07} heave={0.08} reducedMotion={rm}>
        <FittedGlb
          glbKey="rowboat"
          size={[3.4, 1.2, 1.5]}
          fallback={null}
        />
      </Bobbing>
      <Bobbing position={[-127, WATER_Y + 0.12, 25]} rotY={-0.7} phase={3.3} amp={0.07} heave={0.08} reducedMotion={rm}>
        <FittedGlb
          glbKey="rowboat"
          size={[3.4, 1.2, 1.5]}
          fallback={null}
        />
      </Bobbing>
      {[
        [-166, 30],
        [-131, 34],
      ].map(([x, z], i) => (
        <Bobbing
          key={i}
          position={[x!, WATER_Y + 0.15, z!]}
          rotY={0}
          phase={i * 2.6}
          amp={0.1}
          heave={0.12}
          reducedMotion={rm}
        >
          <FittedGlb
            glbKey="buoy"
            size={[0.9, 1.6, 0.9]}
            fallback={null}
          />
        </Bobbing>
      ))}
    </group>
  );
}
