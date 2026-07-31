import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { DawnRead } from "../mission/dawn.js";

// ---------------------------------------------------------------------------
// M1 — the harbour water under the dead wharf.
//
// PROCEDURAL, and allowed as such: the imported-visible-world rule lists
// "animated water" among the procedural exceptions, and the World-Design-Bible
// §7 specifies exactly this — "a water plane with an animated shader (two
// scrolling wave layers + vertex bob, dark green-gray, foam line at pilings),
// reflection faked with an env tint — must run on Chromebook-class GPUs." No
// imported asset; one plane, one cheap shader.
//
// It fills the SW harbour band the ground plate now LEAVES OPEN (see
// level/ground.ts: the LOT is cut at z=18 west of x=17), sitting just below the
// wharf deck so the dock reads as standing over water, and running out to the
// SW horizon. It shares the mission's OWN FogExp2 (fog:true + the merged fog
// uniforms), so the far water fades into the same pre-dawn haze as the fogged
// buildings instead of ending on a hard line — which is what makes "water to the
// horizon" read. The palette is tuned to the harbour cutscene reference frames
// (assets/reference/harbour-cutscene/shot1.png + real-harbour-ingame.png): a
// muted grey-green, darkest close in, fading pale into the overcast.
//
// The whole plane is occluded by the opaque land plates and building masses
// everywhere except that open harbour corner, so it costs one draw and shows
// only where there is genuinely open water.
// ---------------------------------------------------------------------------

// The harbour surface. The wharf crossing is walked on the level's y0 floor
// (drawn by the LOT ground plate, whose base sits at ~-0.020 — see
// level/ground.ts groundPlateY); this OPAQUE water is laid a few mm ABOVE that
// base plate, so it hides the grey rubble in the harbour while the deck/feet at
// y0 stand a hair proud of the waterline. It sits 8mm above that base plate AND
// carries a negative polygonOffset, so over the huge harbour span — where a bare
// few-mm gap z-fights at grazing/elevated angles — it wins the depth test
// consistently and reads as one solid sheet instead of a patchwork of the grey
// showing through. Being opaque, nothing under it is ever seen.
const WATER_Y = -0.012;

// The open harbour is SOUTH of the wharf's seaward lip (the bollards + rope rail
// sit at z ~19) and runs out to the SW. So the plane starts at the rail line
// (z ~18) — it never covers the walkable crossing (z < 18), which would read as
// walking on water — and runs far S and W past the ground skirt into the fog, so
// the water reaches the SW horizon. The moored ships (z 22..33) sit on it.
const CENTER_X = -150;
const CENTER_Z = 220;
const WIDTH = 340;
const DEPTH = 404;

const VERT = /* glsl */ `
  #include <fog_pars_vertex>
  uniform float uTime;
  uniform float uChop;
  varying vec3 vWorld;
  void main() {
    vec3 p = position;
    // Two crossing swells give the surface a gentle bob; kept tiny so the deck
    // edge never reads as the sea climbing the pilings.
    vec4 world = modelMatrix * vec4(p, 1.0);
    float s = sin(world.x * 0.22 + uTime * 0.6) + cos(world.z * 0.18 + uTime * 0.5);
    p.z += s * uChop; // local z is world-up before the mesh's -90deg tilt
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    vWorld = (modelMatrix * vec4(p, 1.0)).xyz;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAG = /* glsl */ `
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform float uBright;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSkyTint;
  varying vec3 vWorld;

  // A cheap ripple field: two scrolling sine layers, no textures, no lookups.
  float ripple(vec2 uv, float t) {
    float a = sin(dot(uv, vec2(0.15, 0.11)) + t * 0.55);
    float b = sin(dot(uv, vec2(-0.09, 0.19)) + t * 0.77);
    return a * 0.5 + b * 0.5;
  }

  void main() {
    vec2 uv = vWorld.xz;
    float r = ripple(uv, uTime);
    // A faked normal from the ripple slope, lit by one fixed high sky direction —
    // the "reflection faked with an env tint" the bible asks for, not a real probe.
    vec3 n = normalize(vec3(r * 0.22, 1.0, r * 0.17));
    vec3 L = normalize(vec3(0.25, 1.0, 0.35));
    float d = clamp(dot(n, L), 0.0, 1.0);
    vec3 col = mix(uDeep, uShallow, d);
    col += uSkyTint * pow(d, 2.0);
    // A thin foam glint on the wave crests — the moving highlight that reads as a
    // live water surface at night, near the pilings and out.
    float foam = smoothstep(0.80, 1.0, r * 0.5 + 0.5);
    col += foam * 0.09;
    col *= uBright;
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
  }
`;

export function M1HarbourWater(props: {
  readonly reducedMotion: boolean;
  readonly dawn: DawnRead;
}) {
  const matRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () =>
      THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uChop: { value: 0.06 },
          uBright: { value: 0.85 },
          // Grey-green, from the harbour reference frames. Kept a wide deep→shallow
          // spread so the ripple slope reads as moving water (its distinguishing
          // cue at night) rather than a flat dark plate that looks like ground.
          uDeep: { value: new THREE.Color(0.04, 0.075, 0.075) },
          uShallow: { value: new THREE.Color(0.17, 0.25, 0.235) },
          uSkyTint: { value: new THREE.Color(0.08, 0.12, 0.14) },
        },
      ]),
    [],
  );

  // The water sits in the mission's own dawn/fog: it must still read as water at
  // full dark (a near-black plate looks like ground and defeats "a dock over
  // water"), so the night floor stays up and dawn only lifts it further. It fades
  // into whatever the FogExp2 is at this instant (fog:true, below).
  const bright = 0.85 + 0.35 * props.dawn.lift01;

  useFrame((state) => {
    const mat = matRef.current;
    if (!mat) return;
    if (!props.reducedMotion) {
      mat.uniforms.uTime.value = state.clock.elapsedTime;
    }
    mat.uniforms.uBright.value = bright;
  });

  return (
    <mesh
      name="m1-harbour-water"
      position={[CENTER_X, WATER_Y, CENTER_Z]}
      rotation={[-Math.PI / 2, 0, 0]}
      frustumCulled={false}
      renderOrder={-1}
    >
      <planeGeometry args={[WIDTH, DEPTH, 48, 48]} />
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={VERT}
        fragmentShader={FRAG}
        fog
        depthWrite
        polygonOffset
        polygonOffsetFactor={-4}
        polygonOffsetUnits={-4}
      />
    </mesh>
  );
}
