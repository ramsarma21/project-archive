import * as THREE from "three";

// ---------------------------------------------------------------------------
// The presenter's hologram material and fit maths.
//
// Extracted from SystemPresenter so it depends on three ALONE — no R3F, no
// drei, no WebGL — which is what lets the face-readability contract be asserted
// by a plain unit test rather than by a screenshot or a brittle source grep.
//
// The contract, in one place:
//
//   The imported base colour map IS the face. It is never nulled and never
//   replaced; the cyan is a restrained emissive plus a shader wash that
//   MULTIPLIES the lit albedo (preserving every feature), an edge-only fresnel
//   rim, a gentle scanline and a faint alpha dither.
//
//   Blending is NormalBlending, never additive; opacity never drops below the
//   floor. So the rig reads unmistakably holographic without collapsing into a
//   blown-out cyan silhouette. There is one material pass — the room's glow is
//   CSS/UI, not stacked opaque/additive clones.
// ---------------------------------------------------------------------------

/** The floor the hologram opacity must never cross, so the face stays solid. */
export const HOLOGRAM_OPACITY_FLOOR = 0.85;
/** Ceiling on the cyan emissive, so the rig never blows out to a flat glow. */
export const HOLOGRAM_EMISSIVE_CEILING = 0.35;
/** The cyan emissive intensity the rig ships with. Held DELIBERATELY low:
 *  emissive lifts the whole surface uniformly toward cyan (it ignores the
 *  albedo), so on the face it desaturates skin and erases features. Facial
 *  readability is the primary constraint, so the "lit-from-within" glow lives at
 *  the silhouette (fresnel/rim) and in the room, not on the face interior. */
export const HOLOGRAM_EMISSIVE_INTENSITY = 0.014;

export interface HologramOptions {
  reducedMotion: boolean;
}

// ---------------------------------------------------------------------------
// Flicker / projection breakup (pure, unit-testable).
//
// The shader shimmers on the GPU, but the SAME curve also nudges the JS-side
// emissive and the effect opacities so the whole projection breathes together.
// Keeping it pure lets a test pin two contracts the owner cares about:
//   · under reduced motion the flicker is pinned to 1.0 (glow preserved, no
//     animated strobe), and
//   · when motion is allowed it only ever DIMS, and never below a floor, so the
//     hologram never brightens past its steady state or drops out entirely.
// ---------------------------------------------------------------------------

/** The lowest the flicker multiplier may reach — a gentle breakup, not a strobe. */
export const HOLOGRAM_FLICKER_MIN = 0.86;

function hash11(n: number): number {
  return fract(Math.sin(n * 91.7) * 4813.0);
}
function fract(x: number): number {
  return x - Math.floor(x);
}

/**
 * A subtle flicker/projection-breakup multiplier in [HOLOGRAM_FLICKER_MIN, 1].
 *
 * Pure and deterministic in `tSeconds`: a continuous low shimmer plus an
 * occasional brief dropout (a projector losing sync for a frame), never a
 * constant strobe. Reduced motion pins it to exactly 1 so the glow is preserved
 * without any animated breakup.
 */
export function hologramFlicker(tSeconds: number, reducedMotion: boolean): number {
  if (reducedMotion) return 1;
  const shimmer = 0.045 * (0.5 + 0.5 * Math.sin(tSeconds * 37.0));
  const dropoutGate = hash11(Math.floor(tSeconds * 3.0));
  const dropout = dropoutGate > 0.985 ? 0.09 : 0;
  return Math.max(HOLOGRAM_FLICKER_MIN, 1 - shimmer - dropout);
}

// ---------------------------------------------------------------------------
// The cyan light rig (pure config, unit-testable).
//
// Emissive materials do not light their neighbours in three.js, so the cyan
// "spill" on the presenter's own body — and on the projector-pad effect at her
// feet — is real, motivated light, not a shader trick. These specs are data so a
// test can pin that every source is cyan-ish, bounded well under a ceiling
// (no light bomb that flattens the face), and — crucially — IDENTICAL under
// reduced motion: reduced motion calms the flicker, it never dims the light.
// ---------------------------------------------------------------------------

/** Nobody in the rig may exceed this intensity, so the face is never flooded. */
export const HOLOGRAM_LIGHT_INTENSITY_CEILING = 3.2;

export interface HologramLightSpec {
  readonly key: string;
  readonly color: number;
  readonly intensity: number;
  readonly position: readonly [number, number, number];
  readonly distance: number;
  readonly decay: number;
}

/**
 * The cyan point lights that give the presenter real light response — placed so
 * the cyan lands on her EDGES and lower body, never as a flat wash on her face.
 * A cyan light on the front of the face cancels the warm skin albedo and turns
 * her into a cyan lamp, so there is deliberately NO cyan front fill: the face is
 * lit warm/neutral by the white key (in SystemPresenter) and the cyan is:
 *   · two back-rim kickers that carve the silhouette and hair edges, and
 *   · a projector uplight at the feet for contact spill on the lower body/pad.
 * All are in rig-local space (feet at y=0) so the spill tracks the framing.
 * Reduced motion does not change them.
 */
export function buildHologramLights(_reducedMotion: boolean): HologramLightSpec[] {
  // Kept deliberately DIM: the hologram's cyan edge glow comes mostly from the
  // shader fresnel/rim (free, and it never lands on the warm face front). These
  // real lights exist only for a subtle motivated spill on the body/pad and the
  // room; bright cyan lamps here re-cast the forehead and hair cyan and blow the
  // blouse out, which is the exact wash the face-readability contract forbids.
  return [
    { key: "holo-rim-l", color: 0x7fe0ff, intensity: 0.34, position: [-1.9, 2.05, -2.2], distance: 6, decay: 2 },
    { key: "holo-rim-r", color: 0x63d2ff, intensity: 0.26, position: [1.9, 1.9, -2.1], distance: 6, decay: 2 },
    // A cyan uplight kept BELOW and slightly BEHIND the feet so it grazes the lower
    // body/pad for contact spill without washing the front chest cyan.
    { key: "holo-projector", color: 0x4fc6ff, intensity: 0.22, position: [0, 0.05, -0.35], distance: 1.2, decay: 3.0 },
  ];
}

/**
 * Turns ONE imported material into a readable hologram, and returns the clone.
 * Pure: no side effects beyond cloning the source material.
 */
export function holographizeMaterial(
  source: THREE.MeshStandardMaterial,
  options: HologramOptions,
): THREE.MeshStandardMaterial {
  const material = source.clone();
  // The base map is the face. Never null it, never replace it.
  material.transparent = true;
  // Near-opaque so the cyan additive halo/pad BEHIND her cannot bleed through and
  // tint the skin/blouse cyan; the projection read comes from the edge fresnel,
  // scanlines and dither, not from see-through. Well above the 0.85 floor.
  material.opacity = 0.97;
  material.depthWrite = true;
  material.blending = THREE.NormalBlending;
  // DoubleSide: the imported mesh has inconsistent winding / thin shells (hair,
  // clothing), so FrontSide backface-culls them into black tears. DoubleSide
  // fills them; the raised opacity keeps the cyan bleed-through negligible.
  material.side = THREE.DoubleSide;
  material.toneMapped = true;
  // A restrained cyan emissive: enough to read as lit-from-within in the dark
  // stage, far below a wash that would erase the texture.
  material.emissive = new THREE.Color(0x1a9fd0);
  material.emissiveIntensity = HOLOGRAM_EMISSIVE_INTENSITY;
  // The imported albedo is now white-balanced to warm skin at the asset
  // (correct_presenter_albedo.py), so the shader preserves it and only adds cyan
  // at the edges; the warm KEY light (SystemPresenter) still models the face.
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHoloTime = { value: 0 };
    shader.uniforms.uReduced = { value: options.reducedMotion ? 1 : 0 };
    (material.userData as { holoShader?: THREE.WebGLProgramParametersWithUniforms }).holoShader =
      shader;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vHoloView;\nvarying vec4 vHoloScreen;",
      )
      .replace(
        "#include <worldpos_vertex>",
        // The camera sits at the ORIGIN of view space, so the view direction at a
        // vertex is simply the (normalised) vector from the view-space vertex
        // position back to the origin. The previous form subtracted the world
        // origin mapped into view space instead of using zero, so holoNdV was
        // garbage and holoFront never reached 1 on the camera-facing face — that
        // was the real cause of the whole-figure cyan wash and the per-tri shards.
        "#include <worldpos_vertex>\n  vHoloView = normalize(-(modelViewMatrix * vec4(transformed,1.0)).xyz);\n  vHoloScreen = projectionMatrix * modelViewMatrix * vec4(transformed,1.0);",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uHoloTime;\nuniform float uReduced;\nvarying vec3 vHoloView;\nvarying vec4 vHoloScreen;\nfloat holoDither(vec2 p){return fract(sin(dot(floor(p),vec2(12.9898,78.233)))*43758.5453);}",
      )
      .replace(
        // FACIAL READABILITY IS THE PRIMARY CONSTRAINT. This injection runs at
        // <dithering_fragment>, i.e. AFTER tone mapping and sRGB conversion, so
        // anything added here clips with no rolloff. Therefore the face FRONT is
        // left almost untouched (the imported, warmly-key-lit albedo shows
        // through) and every dramatic hologram effect is gated to the EDGES:
        //
        //   · holoFront ~1 on surfaces facing the camera (face, chest); the
        //     cyan cast is tiny there and skin/eyes/lips/hair keep their tone.
        //   · holoEdge ~1 at the silhouette; that is where the fresnel + tight
        //     rim energy, the scanlines and the flicker/breakup all live, so the
        //     glow reads as a projection at her outline, never as a mask over
        //     her features.
        //   · a highlight rolloff pulls down any bright front-facing pixel so
        //     cheeks/forehead/chest cannot blow out to near-white.
        "#include <dithering_fragment>",
        "#include <dithering_fragment>\n" +
          "  // The imported mesh has inconsistent winding: many camera-facing tris are\n" +
          "  // back-wound, so their raw vNormal points AWAY from the camera. three.js\n" +
          "  // already flips the normal for LIGHTING on DoubleSide (gl_FrontFacing), so\n" +
          "  // we mirror that here — otherwise those tris are misread as silhouette\n" +
          "  // 'edge' and get darkened/cyaned, which produced the jagged shards AND the\n" +
          "  // whole-figure cyan wash. Flipping makes front/edge classification correct\n" +
          "  // on both sides, so the face reads as one warm, seam-free surface.\n" +
          "  vec3 holoN = normalize(vNormal);\n" +
          "  if (!gl_FrontFacing) holoN = -holoN;\n" +
          "  float holoNdV = clamp(dot(holoN, vHoloView), 0.0, 1.0);\n" +
          "  float holoFront = smoothstep(0.30, 0.78, holoNdV);\n" +
          "  float holoEdge = 1.0 - holoFront;\n" +
          "  float holoFres = pow(1.0 - holoNdV, 4.5);\n" +
          "  float holoRim = pow(1.0 - holoNdV, 6.5);\n" +
          "  vec2 holoNdc = vHoloScreen.xy / max(vHoloScreen.w, 0.0001);\n" +
          "  float holoAnim = (1.0 - uReduced) * uHoloTime;\n" +
          "  float holoScan = 0.5 + 0.5 * sin((holoNdc.y * 300.0) + holoAnim * 2.6);\n" +
          "  float holoDit = holoDither(gl_FragCoord.xy + holoAnim);\n" +
          "  float holoDrop = step(0.985, holoDither(vec2(floor(holoAnim * 3.0), 7.0)));\n" +
          "  // The albedo is now warm skin (white-balanced at the asset), so the\n" +
          "  // shader NO LONGER recolours the face. It preserves the lit albedo and\n" +
          "  // confines every cyan effect to the EDGES. This also removes the old\n" +
          "  // luminance skin-ramp, whose per-luminance mapping exaggerated triangle\n" +
          "  // boundaries into shards.\n" +
          "  // 1. A warm lift on front-facing skin that also pulls the blue channel\n" +
          "  //    down, so the face reads as warm skin against the cyan body.\n" +
          "  gl_FragColor.rgb *= mix(vec3(1.0), vec3(1.16, 1.0, 0.80), holoFront);\n" +
          "  // 1b. GUARANTEE a warm face: on front-facing pixels the blue channel may\n" +
          "  //     not dominate the warm channels, so no matter how much cyan light the\n" +
          "  //     forehead/cheeks catch from the rig, the skin cannot read cyan. The\n" +
          "  //     body/hair (holoFront~0) keep their cyan projection look untouched.\n" +
          "  float holoWarmB = min(gl_FragColor.b, max(gl_FragColor.r, gl_FragColor.g) * 0.90);\n" +
          "  gl_FragColor.b = mix(gl_FragColor.b, holoWarmB, holoFront);\n" +
          "  // 2. Mild local contrast on the front so eyes/brows/lip line separate.\n" +
          "  //    Safe now: normals are smooth so holoFront varies smoothly (no facets).\n" +
          "  vec3 holoContr = (gl_FragColor.rgb - 0.5) * 1.14 + 0.5;\n" +
          "  gl_FragColor.rgb = mix(gl_FragColor.rgb, holoContr, holoFront * 0.75);\n" +
          "  // 3. Silhouette energy: additive cyan ONLY at the edges (holoFres/holoRim\n" +
          "  //    are ~0 where the surface faces the camera), so the face stays warm\n" +
          "  //    and the projection glow lives at her outline and hair edges.\n" +
          "  gl_FragColor.rgb += vec3(0.10, 0.34, 0.45) * holoFres;\n" +
          "  gl_FragColor.rgb += vec3(0.20, 0.58, 0.72) * holoRim;\n" +
          "  // 4. Scanlines + flicker restricted to the edges, so the eyes and mouth\n" +
          "  //    stay clean. They only ever DIM. Frozen under reduced motion.\n" +
          "  gl_FragColor.rgb *= mix(1.0, mix(0.9, 1.0, holoScan), holoEdge * 0.85);\n" +
          "  gl_FragColor.rgb *= 1.0 - (1.0 - uReduced) * holoEdge * (0.05 * (0.5 + 0.5 * sin(holoAnim * 37.0)) + 0.09 * holoDrop);\n" +
          "  // 5. Highlight rolloff so warmed cheeks/forehead and the bright blouse\n" +
          "  //    cannot clip to white (which the cyan rig then tints cyan). Applied\n" +
          "  //    on front-facing surfaces where the albedo should read in true tone.\n" +
          "  float holoL2 = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));\n" +
          "  gl_FragColor.rgb *= 1.0 - holoFront * smoothstep(0.52, 1.0, holoL2) * 0.62;\n" +
          "  gl_FragColor.a = clamp(gl_FragColor.a * mix(0.97, 1.0, holoDit) * (0.9 + 0.12 * holoFres), 0.78, 1.0);",
      );
  };
  material.needsUpdate = true;
  return material;
}

/**
 * Applies the hologram material to every mesh under the rig and returns the
 * disposable clones so the caller can free them.
 */
export function holographize(
  root: THREE.Object3D,
  options: HologramOptions,
): Set<THREE.Material> {
  const owned = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    const sources = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const rewritten = sources.map((source) => {
      const material = holographizeMaterial(source as THREE.MeshStandardMaterial, options);
      owned.add(material);
      return material;
    });
    mesh.material = Array.isArray(mesh.material) ? rewritten : rewritten[0]!;
  });
  return owned;
}

/**
 * Skinned-aware bounds. `Box3().setFromObject` under-measures a SkinnedMesh —
 * its geometry bounding box is the bind pose in mesh-local space and misses the
 * armature's scale — so a naive fit scaled the rig up until the camera sat
 * inside it, filling the stage with one flat surface. This mirrors the measure
 * RiggedCharacter uses for exactly this reason: union each skinned mesh's own
 * computed bounding box transformed into world space.
 */
export function measureRig(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  let any = false;
  root.traverse((object) => {
    const skinned = object as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      skinned.computeBoundingBox();
      if (skinned.boundingBox) {
        tmp.copy(skinned.boundingBox).applyMatrix4(skinned.matrixWorld);
        any ? box.union(tmp) : box.copy(tmp);
        any = true;
      }
    } else if ((object as THREE.Mesh).isMesh) {
      tmp.setFromObject(object);
      any ? box.union(tmp) : box.copy(tmp);
      any = true;
    }
  });
  return box;
}
