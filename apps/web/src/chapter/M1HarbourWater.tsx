import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { dawnSky, type DawnRead } from "../mission/dawn.js";

// ---------------------------------------------------------------------------
// M1 — the harbour water under the dead wharf.
//
// PROCEDURAL, and allowed as such: the imported-visible-world rule lists
// "animated water" among the procedural exceptions, and the World-Design-Bible
// §7 asks for exactly this — an animated wave shader, "reflection faked with an
// env tint", running on Chromebook-class GPUs, and §12 rules out reflection or
// refraction *render passes*. No imported asset, one plane, one draw, no
// textures, no render targets, no lookups.
//
// It fills the SW harbour band, sitting just below the wharf deck so the dock
// reads as standing over water, and running out past the camera's far plane.
// The whole plane is occluded by the opaque land plates and building masses
// everywhere except that open harbour corner, so it costs one draw and shows
// only where there is genuinely open water.
//
// WHAT THIS REPLACED, and why the replacement is shaped the way it is.
// The first pass drew a flat matte plate, and the owner's note on it was "the
// water does not look realistic at all". Measured before rewriting, against the
// live build rather than the source:
//
//   * The shader bound and ran correctly. Its uniforms were intact
//     (uDeep/uShallow read back exactly as authored), fog was wired and
//     refreshing (fogDensity 0.016 from the scene), and the rendered pixels
//     matched the shader's own arithmetic to within 1/255. So the earlier
//     "mistyped uniforms may be failing to bind and falling back to a default"
//     theory is DISPROVEN — a fallback cannot land on the authored value. The
//     typecheck repair at 5d807f5 is behaviour-preserving: it wraps two
//     per-frame assignments in truthiness guards, and the colour uniforms are
//     set once at construction and never touched at runtime.
//   * The water was simply never finished. Its ripple had a ~30 m wavelength
//     and a total on-screen contrast of 7/255 across the whole visible plane,
//     which is not detail, it is a gradient. Its "foam" needed the ripple above
//     0.6 to fire and added 0.09 to a 0.2 base. Its "reflection" was a constant
//     additive tint with no fresnel and no view dependence, so the surface could
//     not brighten toward the horizon the way water does.
//   * It wrote gl_FragColor straight to the framebuffer with neither
//     <tonemapping_fragment> nor <colorspace_fragment>, while the stage forces
//     NeutralToneMapping and three's output is sRGB. So it was the one surface
//     in the mission living outside the colour pipeline, mixing a linear colour
//     against a fog colour three delivers already sRGB-encoded. That is why a
//     "grey-green" authored at 0.19 linear read as a pale plate roughly five
//     times the sky's brightness in a full-dark scene, and why the far water
//     never resolved into the fog: at the horizon it was still visibly lighter
//     than the sky it was supposed to be dissolving into.
//
// So the rewrite is: a real multi-octave wave normal, a fresnel-weighted
// reflection of the mission's own dawn sky, and the same tonemap → colourspace →
// fog tail three's own materials use, in that order.
// ---------------------------------------------------------------------------

// The harbour surface. The wharf crossing is walked on the level's y0 floor
// (drawn by the LOT ground plate, whose base sits at ~-0.020 — see
// level/ground.ts groundPlateY); this OPAQUE water is laid a few mm ABOVE that
// base plate, so it hides the rubble texture in the harbour while the deck/feet
// at y0 stand a hair proud of the waterline. It sits 8mm above that base plate
// AND carries a negative polygonOffset, so over the huge harbour span — where a
// bare few-mm gap z-fights at grazing/elevated angles — it wins the depth test
// consistently and reads as one solid sheet. Being opaque, nothing under it is
// ever seen.
const WATER_Y = -0.012;

// The open harbour is SOUTH of the wharf's seaward lip (the bollards + rope rail
// sit at z ~19) and runs out to the SW. So the plane starts at the rail line
// (z ~18) — it never covers the walkable crossing (z < 18), which would read as
// walking on water — and runs far S and W past the ground skirt, so every
// seaward sightline ends in water rather than in the plane's own edge. The
// nearest edge in any open direction is ~320 m, well past the camera's 240 m far
// plane and far past the distance the mission's fog saturates at, so the edge is
// never the thing the player sees at the horizon. The moored ships (z 22..33)
// sit on it.
const CENTER_X = -150;
const CENTER_Z = 220;
const WIDTH = 340;
const DEPTH = 404;

// DELIBERATELY FLAT — no vertex displacement, which IS a departure from the
// bible's "vertex bob", and the reason is worth recording so it is not "fixed"
// back. There are 12 mm between this surface and the deck the player walks on,
// and 8 mm between it and the rubble plate underneath. Any upward displacement
// floods the wharf; any downward displacement drops the sheet below the plate
// and shows the rubble through it. A shore taper would buy the bob back, but the
// bob is worth almost nothing here: at 1.6 m eye height essentially all of the
// signal is in how the surface REFLECTS, which is the shading normal, and that
// is displaced fully below. So the geometry stays a flat sheet and the waves
// live entirely in the normal.
const SEGMENTS = 24;

const VERT = /* glsl */ `
  #include <fog_pars_vertex>
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAG = /* glsl */ `
  #include <fog_pars_fragment>

  // No <tonemapping_pars_fragment> / <colorspace_pars_fragment> here, and that
  // is deliberate rather than an omission: three injects both into every
  // non-raw fragment prefix already, so including them again redefines
  // toneMapping() and sRGBTransferOETF() and the shader fails to compile. Its
  // own materials include only the _fragment halves, for the same reason.
  // cameraPosition comes from that same prefix.
  uniform float uTime;
  uniform float uChop;
  uniform vec3 uDeep;
  uniform vec3 uSkyLow;
  uniform vec3 uSkyHigh;
  uniform vec3 uMoon;
  uniform vec3 uMoonDir;
  uniform float uMoonGain;
  varying vec3 vWorld;

  // One directional wave train, accumulated ANALYTICALLY: the slope is the
  // derivative of the height, not a difference of two samples, so the normal is
  // exact and costs one extra multiply rather than three more evaluations.
  void train(
    inout vec2 grad, inout float height,
    vec2 p, float t, vec2 dir, float k, float amp, float speed, float gain
  ) {
    float phase = k * dot(dir, p) + speed * t;
    float a = amp * gain;
    height += a * sin(phase);
    grad += dir * (a * k * cos(phase));
  }

  // How much of an octave survives at this distance. A wave whose crests fall
  // closer together than the pixels drawing them is not detail, it is noise that
  // crawls when the camera moves — and unfaded, that shimmer is exactly what
  // reads as a repeating tiled sheet on a plane this size. Each octave dies over
  // a band proportional to its own wavelength, so the fine chop lives near the
  // dock, the medium chop out to the moored ships, and only the swell survives
  // to the horizon. That is also, conveniently, what real water does.
  float detail(float dist, float from, float to) {
    return 1.0 - smoothstep(from, to, dist);
  }

  void main() {
    vec3 toEye = cameraPosition - vWorld;
    float dist = length(toEye);
    vec3 V = toEye / max(dist, 1e-4);

    vec2 p = vWorld.xz;
    vec2 grad = vec2(0.0);
    float height = 0.0;

    // Seven octaves from a 47 m swell down to 46 cm ripples, each on its own
    // bearing and at its own gravity-wave speed (w = sqrt(g k), slowed for a
    // sheltered harbour), so no two ever line up into a grid.
    train(grad, height, p, uTime, vec2( 0.951,  0.309),  0.1337, 0.1500 * uChop, 0.630, 1.0);
    train(grad, height, p, uTime, vec2( 0.326,  0.946),  0.2732, 0.0780 * uChop, 0.900, 1.0);
    train(grad, height, p, uTime, vec2(-0.629,  0.777),  0.5712, 0.0360 * uChop, 1.302, detail(dist, 286.0, 660.0));
    train(grad, height, p, uTime, vec2(-0.906, -0.423),  1.2083, 0.0170 * uChop, 1.894, detail(dist, 135.0, 312.0));
    train(grad, height, p, uTime, vec2(-0.105,  0.995),  2.6180, 0.0072 * uChop, 2.787, detail(dist,  62.0, 144.0));
    train(grad, height, p, uTime, vec2(-0.866,  0.500),  5.9840, 0.0030 * uChop, 4.214, detail(dist,  27.0,  63.0));
    train(grad, height, p, uTime, vec2( 0.766,  0.643), 13.6590, 0.0012 * uChop, 6.366, detail(dist,  12.0,  28.0));

    vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));

    // Schlick against water's real F0. This is the whole reason the surface
    // reads as water rather than as a coloured floor: looking down at your feet
    // you see almost none of the sky and the water is nearly black, and looking
    // out toward the horizon you see almost nothing BUT the sky. The wave slopes
    // then modulate that transition, which is what produces the streaked,
    // restless look of a harbour at night.
    float grazing = 1.0 - clamp(dot(N, V), 0.0, 1.0);
    float fresnel = 0.02 + 0.98 * pow(grazing, 5.0);

    // The env tint the bible asks for, evaluated per fragment instead of being a
    // constant: reflect the eye ray and read the mission's OWN dawn sky at that
    // elevation, so the water is always mirroring the sky the player can see
    // above it and comes up through dawn on the same clock.
    vec3 R = reflect(-V, N);
    vec3 sky = mix(uSkyLow, uSkyHigh, sqrt(clamp(R.y, 0.0, 1.0)));

    // Roughly where this fragment sits between trough and crest, [0,1]. The
    // divisor is the sum of the octave amplitudes, so this stays normalised
    // whatever uChop is set to.
    float rise = clamp(height / (0.5848 * max(uChop, 1e-3)) + 0.5, 0.0, 1.0);

    // Light coming back OUT of the water, shadowed between the waves: a trough
    // sits in the shade of the crests either side of it and a crest does not.
    //
    // This term is what carries the near field, and it is needed because of a
    // measured fact about this scene rather than for effect. Schlick gives ~2%
    // reflectance where the player looks down off the wharf, and at FULL DARK
    // the sky being reflected is #0a1220 — so within ten metres of the dock the
    // reflection contributes about a thousandth of the frame and every wave in
    // it is invisible. Reflection alone makes water that only works at the
    // horizon. Body shading is what makes it work at your feet.
    vec3 body = uDeep * (0.55 + 0.75 * rise);

    vec3 col = mix(body, sky, fresnel);

    // The moon's glint. Two lobes: a tight one for the sparkle on a wave face
    // square to the moon, and a broad one so the sparkle sits in a soft path
    // rather than firing as isolated pixels that crawl. Worth little when the
    // moon is behind the player, which at the wharf it usually is, and worth a
    // great deal by the time the sun is up on the same bearing.
    vec3 H = normalize(uMoonDir + V);
    float NdotH = max(dot(N, H), 0.0);
    col += uMoon * (pow(NdotH, 320.0) + 0.06 * pow(NdotH, 22.0)) * uMoonGain;

    // Crest sheen — the bible's "foam line", honestly scaled. A sheltered
    // harbour at night has no whitecap; what it has is the tops of the chop
    // catching the sky at a flatter angle than the water either side. Near the
    // eye only, where there is enough resolution for it to be a crest rather
    // than a speckle that crawls.
    float crest = smoothstep(0.81, 1.0, rise);
    col += uSkyLow * crest * 0.45 * detail(dist, 55.0, 140.0);

    gl_FragColor = vec4(col, 1.0);

    // The same tail, in the same order, that every built-in three material runs.
    // Order is not cosmetic: three delivers fogColor already in OUTPUT colour
    // space, so fog has to be mixed AFTER the encode or the horizon never
    // matches the sky it is fading into.
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/** Unit XZ bearing the moon/sun sits on. Matches `SUN_BEARING` in MissionStage. */
const SUN_BEARING = { x: 0.83, z: 0.56 };
/** Only re-derive the palette when the lift has actually moved. */
const SKY_STEP = 0.0015;
/**
 * The water's own body colour, before dawn scales it.
 *
 * Much darker than the sky and pushed green: this is light that came back OUT
 * of the water rather than off it, and at night there is very little of it.
 * Nearly all of the brightness on screen arrives through `fresnel` instead.
 *
 * Not driven to black, though, and the reason is a measurement rather than a
 * preference. Schlick puts the reflectance at about 3% where the player stands
 * looking down off the wharf, so a black body makes the nearest ten metres of
 * harbour a hole — which is the failure the surface this replaced was
 * over-correcting for when it lit the whole plane to five times the sky. Boston
 * harbour water is silt, not distilled: at full dark this leaves the near water
 * around sRGB 12/22/21, a shade greener and no brighter than the #0a1220 sky,
 * so it still reads as the darkest thing in the frame without reading as void.
 */
const BODY = new THREE.Color(0.012, 0.025, 0.023);
/**
 * Specular gain per unit of the sky table's `sunIntensity`.
 *
 * Sized so the moon's glint at full dark (intensity 0.25) is a few times the
 * night water's own value — visible as sparkle — without the sun-up figure
 * (7.12) blowing the surface out under the Neutral curve.
 */
const MOON_GAIN = 0.09;

export function M1HarbourWater(props: {
  readonly reducedMotion: boolean;
  readonly dawn: DawnRead;
}) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const appliedLift = useRef(Number.NaN);

  const uniforms = useMemo(
    () =>
      THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          // Scales every octave's amplitude together, so it scales the SLOPE,
          // which is the only thing the shading reads. 1.8 puts the steepest
          // wave face at about 14 degrees off level — a working harbour rather
          // than a millpond, and shallow enough that a flat sheet can carry it
          // in the normal without the eye noticing the geometry is not moving.
          uChop: { value: 1.8 },
          uDeep: { value: new THREE.Color(0, 0, 0) },
          uSkyLow: { value: new THREE.Color(0, 0, 0) },
          uSkyHigh: { value: new THREE.Color(0, 0, 0) },
          uMoon: { value: new THREE.Color(0, 0, 0) },
          uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
          uMoonGain: { value: 0 },
        },
      ]),
    [],
  );

  useFrame((state) => {
    const mat = matRef.current;
    if (!mat) return;
    // `uniforms` is an index signature, so under noUncheckedIndexedAccess each
    // lookup is possibly undefined however certain the shader source makes it.
    const { uTime, uDeep, uSkyLow, uSkyHigh, uMoon, uMoonDir, uMoonGain } =
      mat.uniforms;
    if (uTime && !props.reducedMotion) uTime.value = state.clock.elapsedTime;

    const lift = props.dawn.lift01;
    if (Math.abs(lift - appliedLift.current) < SKY_STEP) return;
    appliedLift.current = lift;

    // Read the mission's own sky table rather than carrying a second palette.
    // The water is a mirror; a mirror with its own opinion about the colour of
    // the sky is the thing that makes a surface look pasted on.
    const sky = dawnSky(lift);
    if (uSkyHigh) (uSkyHigh.value as THREE.Color).set(sky.sky);
    if (uSkyLow) (uSkyLow.value as THREE.Color).set(sky.horizon);
    if (uMoon) (uMoon.value as THREE.Color).set(sky.sunColour);
    if (uMoonGain) uMoonGain.value = sky.sunIntensity * MOON_GAIN;
    if (uDeep) {
      (uDeep.value as THREE.Color).copy(BODY).multiplyScalar(0.25 + 1.9 * lift);
    }
    if (uMoonDir) {
      const elevation = (sky.sunElevationDeg * Math.PI) / 180;
      const ground = Math.cos(elevation);
      (uMoonDir.value as THREE.Vector3)
        .set(SUN_BEARING.x * ground, Math.sin(elevation), SUN_BEARING.z * ground)
        .normalize();
    }
  });

  return (
    <mesh
      name="m1-harbour-water"
      position={[CENTER_X, WATER_Y, CENTER_Z]}
      rotation={[-Math.PI / 2, 0, 0]}
      frustumCulled={false}
      renderOrder={-1}
    >
      <planeGeometry args={[WIDTH, DEPTH, SEGMENTS, SEGMENTS]} />
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
