import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { GlbBoundary, chooseAvailableClip, fieldRandom } from "@pa/engine-world";
import type { ModulePresenter } from "./moduleFormat.js";
import { PRESENTER_FRAMINGS, type ModuleShotKind } from "./moduleShots.js";
import {
  buildHologramLights,
  holographize,
  hologramFlicker,
  measureRig,
} from "./presenterHologram.js";
import {
  HEAD_GAZE_SHARE,
  NECK_GAZE_SHARE,
  bodyYawTarget,
  dampAngle,
  glanceEnvelope,
  headPitchTarget,
  headYawTarget,
  shotGaze,
} from "./presenterGaze.js";
import {
  JAW_OPEN_MAX,
  JAW_OPEN_MORPH,
  SPEECH_HEAD_PITCH_MAX,
  advanceSpeechClock,
  defaultLipSyncProvider,
  sampleLipSync,
  speechJawInfluence,
  type LipSyncTimeline,
} from "./moduleLipSync.js";

/** How fast the driven jaw influence chases its target (per second). Fast
 * enough to follow syllables, slow enough to smooth per-frame jitter into
 * coarticulation. */
const JAW_SMOOTH_RATE = 22;

/** Finds the mesh + index carrying the `jawOpen` morph target, or null. The
 * control is optional so a future asset without it degrades to the head accent. */
function findJawMorph(
  root: THREE.Object3D,
): { mesh: THREE.Mesh; index: number } | null {
  let found: { mesh: THREE.Mesh; index: number } | null = null;
  root.traverse((object) => {
    if (found) return;
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
    const index = mesh.morphTargetDictionary[JAW_OPEN_MORPH];
    if (index != null) found = { mesh, index };
  });
  return found;
}

// ---------------------------------------------------------------------------
// The System presenter: an embodied, imported, holographic narrator, filmed.
//
// The visible-asset law is absolute here. The presenter is ALWAYS the imported
// rigged GLB. There is no primitive stand-in, no borrowed NPC, no silhouette
// and no flat reference image: a missing or still-loading model renders NOTHING
// and emits a dev QA error. That is the correct failure: an empty hologram
// stage that fails QA loudly beats a fake body that passes it quietly.
//
// The 'room' is not built here and is not world geometry: it is the CSS/Archive
// surface around this canvas (grid, fog, scanlines, floating DOM panels). What
// this file adds inside the transparent canvas is a procedural hologram
// treatment OF THE IMPORTED RIG (cyan emissive rim, scanlines and a dither
// breakup) tuned to keep the human texture and the face readable rather than
// blowing the model out to emissive white.
//
// This file also owns two performances the owner asked for by name:
//
//   EYE CONTACT. The body faces the camera on every shot; the head tracks the
//   active camera within clamped limits so the face looks AT the learner, and
//   takes a brief motivated glance toward a materializing visual before
//   returning. The maths is in presenterGaze and the bone offset is applied
//   AFTER the mixer each frame so the talk clip never overwrites the gaze. This
//   rig has no eye bones, so the head IS the eye contact.
//
//   SPEECH. The rig now carries one honest facial control: a `jawOpen` morph
//   target (added by assets/pipeline/add_presenter_face_rig.py against the
//   inspected mesh — a restrained lower-lip/chin/jaw drop, since the head is a
//   closed skin with no mouth cavity). moduleLipSync is the deterministic seam:
//   its `openness` drives the jaw morph every frame while narration speaks, at
//   a capped amplitude with per-frame smoothing, plus a tiny head accent.
//   Silence, pause and a mastery-check interruption close the mouth; reduced
//   motion holds it shut. A future ElevenLabs alignment or a richer facial GLB
//   plugs into the SAME seam. If the morph is absent the drive degrades to the
//   head accent alone.
// ---------------------------------------------------------------------------

// Reused per-frame scratch so the gaze loop allocates nothing.
const _headPos = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, "YXZ");
const _offset = new THREE.Quaternion();
const PRESENTER_MOTE_SEED = 0x5a17e;

export const PRESENTER_MISSING_QA_MESSAGE =
  "[module][QA] The System presenter GLB failed to load. The cinematic lesson " +
  "renders no presenter rather than substituting a primitive, NPC, silhouette " +
  "or the flat reference image. This is a hard QA failure on the imported asset.";

let presenterMissingReported = false;

/** Emits the presenter QA error once. Exported so a test can assert the seam. */
export function reportPresenterMissing(): void {
  if (presenterMissingReported) return;
  presenterMissingReported = true;
  console.error(PRESENTER_MISSING_QA_MESSAGE);
}

function presenterUrl(glbKey: string): string {
  return `/world/characters/${glbKey}.glb`;
}

/** Frame-rate independent smoothing factor for a per-frame lerp. */
function smoothing(dt: number, rate: number): number {
  return 1 - Math.pow(rate, Math.min(dt, 0.1));
}

function PresenterRig(props: {
  presenter: ModulePresenter;
  speaking: boolean;
  shot: ModuleShotKind;
  reducedMotion: boolean;
  /** Stable id of the spoken line; a change restarts the speech clock. */
  speechCueId: string;
  /** The spoken line's text; drives the deterministic lip-sync timeline. */
  speechText: string;
}) {
  const url = presenterUrl(props.presenter.glbKey);
  const gltf = useGLTF(url);
  const camera = useThree((state) => state.camera);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionRef = useRef<THREE.AnimationAction | null>(null);
  const holoClock = useRef({ value: 0 });

  // Gaze/speech state, kept in refs so the frame loop is allocation-free and
  // does not re-render React on every damped step.
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const bodyRef = useRef(0);
  const shotRef = useRef<ModuleShotKind | null>(null);
  const shotTimeRef = useRef(0);
  const cueRef = useRef<string | null>(null);
  const speechClockRef = useRef(0);
  const jawRef = useRef(0);

  const rig = useMemo(() => {
    const root = skeletonClone(gltf.scene);
    // Skinned-aware fit: measure the deformable bounds, scale to a stable
    // presenter height and stand the feet at y=0 so the camera preserves the
    // full body and face at any aspect ratio.
    const size = new THREE.Vector3();
    measureRig(root).getSize(size);
    const target = 1.72;
    const scale = size.y > 0.01 ? target / size.y : 1;
    root.scale.setScalar(scale);
    root.position.y -= measureRig(root).min.y;
    const owned = holographize(root, { reducedMotion: props.reducedMotion });
    const materials: THREE.Material[] = [];
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of list) materials.push(material);
    });
    // The head and neck are the gaze joints. Names come straight from the
    // inspected rig; either may be absent on a future asset, so both are
    // optional and the gaze degrades to whichever exists.
    const head = root.getObjectByName("Head") ?? null;
    const neck = root.getObjectByName("neck") ?? null;
    // The one facial control: the jawOpen morph target added by the facial
    // pass. Optional — a future asset without it drops to the head accent.
    const jaw = findJawMorph(root);
    return { root, owned, materials, head, neck, jaw };
  }, [gltf.scene, props.reducedMotion]);

  useEffect(() => {
    const mixer = new THREE.AnimationMixer(rig.root);
    mixerRef.current = mixer;
    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(rig.root);
      mixerRef.current = null;
      actionRef.current = null;
      for (const material of rig.owned) material.dispose();
    };
  }, [rig]);

  useEffect(() => {
    const mixer = mixerRef.current;
    if (!mixer || gltf.animations.length === 0) return;
    const requested = props.speaking ? props.presenter.talkClip : props.presenter.idleClip;
    const name = chooseAvailableClip(
      props.presenter.glbKey,
      requested,
      gltf.animations.map((clip) => clip.name),
    );
    const clip = name ? gltf.animations.find((c) => c.name === name) : undefined;
    if (!clip) return;
    const action = mixer.clipAction(clip);
    const previous = actionRef.current;
    if (previous === action && action.isRunning()) return;
    action.reset();
    action.enabled = true;
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
    if (previous && previous !== action) action.crossFadeFrom(previous, 0.3, true);
    actionRef.current = action;
  }, [gltf.animations, props.presenter, props.speaking]);

  // The deterministic lip-sync timeline for the current spoken line. Recomputed
  // per line; the provider uses text today and real alignment when it lands.
  const provider = useMemo(defaultLipSyncProvider, []);
  const timeline: LipSyncTimeline = useMemo(
    () => provider.timelineFor({ cueId: props.speechCueId, text: props.speechText }),
    [provider, props.speechCueId, props.speechText],
  );

  useFrame((_state, dt) => {
    // 1. The animation clip writes the whole skeleton FIRST.
    mixerRef.current?.update(dt);

    // 2. Gaze is layered on top, additively, so the clip cannot overwrite it.
    const gaze = shotGaze(props.shot);
    if (props.shot !== shotRef.current) {
      shotRef.current = props.shot;
      shotTimeRef.current = 0;
    } else {
      shotTimeRef.current += dt;
    }
    if (props.speechCueId !== cueRef.current) {
      cueRef.current = props.speechCueId;
      speechClockRef.current = 0;
    }
    speechClockRef.current = advanceSpeechClock(
      speechClockRef.current,
      dt * 1000,
      props.speaking,
    );
    // The mouth: sample the deterministic openness, map it to the capped
    // jawOpen target (0 on silence/pause/reduced motion so the mouth closes),
    // and chase it with per-frame smoothing for coarticulation.
    const sampledOpenness = sampleLipSync(timeline, speechClockRef.current).openness;
    const jawTarget = speechJawInfluence(sampledOpenness, {
      speaking: props.speaking,
      reducedMotion: props.reducedMotion,
    });
    jawRef.current = props.reducedMotion
      ? jawTarget
      : jawRef.current + (jawTarget - jawRef.current) * Math.min(1, dt * JAW_SMOOTH_RATE);
    if (rig.jaw) {
      rig.jaw.mesh.morphTargetInfluences![rig.jaw.index] = jawRef.current;
    }
    // DEV-only telemetry so a headless QA probe can read the live jaw influence
    // off `window` (R3F does not expose its store on the DOM). Tree-shaken out
    // of the production build; never present in a shipped bundle.
    if (import.meta.env.DEV) {
      (window as unknown as { __presenterJaw?: number }).__presenterJaw = jawRef.current;
    }

    // Yaw/pitch that would point the head at the (possibly offset) camera. The
    // rig faces +Z, so a camera at +X asks for a small positive yaw.
    (rig.head ?? rig.root).getWorldPosition(_headPos);
    camera.getWorldPosition(_camPos);
    const dx = _camPos.x - _headPos.x;
    const dy = _camPos.y - _headPos.y;
    const dz = _camPos.z - _headPos.z;
    const cameraYaw = Math.atan2(dx, dz);
    const cameraPitch = Math.atan2(dy, Math.hypot(dx, dz));

    const phase = props.reducedMotion ? 0 : glanceEnvelope(shotTimeRef.current);
    const targetYaw = headYawTarget(gaze, phase, cameraYaw);
    const targetPitch = headPitchTarget(gaze, cameraPitch);
    const targetBody = bodyYawTarget(gaze);

    if (props.reducedMotion) {
      yawRef.current = targetYaw;
      pitchRef.current = targetPitch;
      bodyRef.current = targetBody;
    } else {
      yawRef.current = dampAngle(yawRef.current, targetYaw, dt, 0.02);
      pitchRef.current = dampAngle(pitchRef.current, targetPitch, dt, 0.02);
      bodyRef.current = dampAngle(bodyRef.current, targetBody, dt, 0.02);
    }

    // The torso faces the learner (bodyRef is clamped near zero).
    rig.root.rotation.y = bodyRef.current;

    // A tiny downward head nod that rides ON TOP of the open mouth (normalized
    // from the smoothed jaw so it tracks the same cadence): sub-degree, just
    // enough to add life, never enough to distort the face.
    const speechPitch =
      -(jawRef.current / JAW_OPEN_MAX) * SPEECH_HEAD_PITCH_MAX;

    if (actionRef.current) {
      if (rig.neck) {
        _euler.set(
          pitchRef.current * NECK_GAZE_SHARE,
          yawRef.current * NECK_GAZE_SHARE,
          0,
        );
        _offset.setFromEuler(_euler);
        rig.neck.quaternion.multiply(_offset);
      }
      if (rig.head) {
        _euler.set(
          pitchRef.current * HEAD_GAZE_SHARE + speechPitch,
          yawRef.current * HEAD_GAZE_SHARE,
          0,
        );
        _offset.setFromEuler(_euler);
        rig.head.quaternion.multiply(_offset);
      }
    }

    // 3. Hologram shader time.
    holoClock.current.value += dt;
    for (const material of rig.materials) {
      const host = material.userData as {
        holoShader?: THREE.WebGLProgramParametersWithUniforms;
      };
      if (host.holoShader) host.holoShader.uniforms.uHoloTime!.value = holoClock.current.value;
    }
  });

  return <primitive object={rig.root} />;
}

/**
 * The presenter stage. The GLB is the only body it will ever show; a load
 * failure renders null and reports a QA error rather than substituting anything.
 */
export function SystemPresenter(props: {
  presenter: ModulePresenter;
  /** True while narration is playing; drives talk vs idle and the speech clock. */
  speaking: boolean;
  /** The current cutscene shot; drives the camera framing and gaze intent. */
  shot: ModuleShotKind;
  reducedMotion: boolean;
  /** Stable id of the spoken line; a change restarts the speech clock. */
  speechCueId: string;
  /** The spoken line's text; drives the deterministic lip-sync timeline. */
  speechText: string;
}) {
  const glbKey = props.presenter.glbKey;
  const initial = PRESENTER_FRAMINGS.PRESENTER_MEDIUM;
  return (
    <div className="mod-presenter-canvas" aria-hidden="true">
      <Canvas
        gl={{ alpha: true, antialias: true, preserveDrawingBuffer: false }}
        camera={{ position: [...initial.position], fov: initial.fov }}
        dpr={[1, 2]}
        style={{ background: "transparent" }}
        onCreated={({ gl }) => {
          // The albedo is now white-balanced warm skin. Left at exposure 1 the
          // warm KEY + cyan rig drives skin/blouse past 1.0 and ACES rolls the
          // clipped highlights toward white (which the cyan rim then tints) — the
          // cyan-white wash. A sub-unity exposure keeps the lit skin in its warm
          // mid-band so the albedo survives instead of blowing out.
          gl.toneMappingExposure = 0.76;
        }}
      >
        {/* A flattering, mostly-white key on the FACE so the imported albedo
            (skin tone, eyes, brows, lips, hair) reads in true tone — facial
            readability is the primary constraint. Kept restrained: with the warm
            albedo, a hot key clips the face to white. The key is warm-neutral and
            slightly stronger than fill for gentle modelling; the cyan is kept off
            the face front and added only at the edges/feet by HologramLights. */}
        <ambientLight intensity={0.34} color={0xffe6d2} />
        <directionalLight position={[1.3, 2.2, 3.6]} intensity={0.72} color={0xffeeda} />
        <directionalLight position={[-1.6, 1.7, 2.2]} intensity={0.34} color={0xfdece0} />
        <HologramLights reducedMotion={props.reducedMotion} />
        <HologramProjection reducedMotion={props.reducedMotion} />
        <ShotCamera shot={props.shot} reducedMotion={props.reducedMotion} />
        <GlbBoundary
          fallback={<PresenterMissing />}
          onBeforeRetry={() => useGLTF.clear(presenterUrl(glbKey))}
        >
          <Suspense fallback={null}>
            <PresenterRig
              presenter={props.presenter}
              speaking={props.speaking}
              shot={props.shot}
              reducedMotion={props.reducedMotion}
              speechCueId={props.speechCueId}
              speechText={props.speechText}
            />
          </Suspense>
        </GlbBoundary>
      </Canvas>
    </div>
  );
}

/**
 * Dollies the camera to the current shot's framing every frame. The move is a
 * frame-rate-independent lerp toward the target, so a shot change reads as a
 * smooth camera move rather than a cut; reduced motion snaps to the framing.
 */
function ShotCamera(props: { shot: ModuleShotKind; reducedMotion: boolean }) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const lookAt = useRef(
    new THREE.Vector3(...PRESENTER_FRAMINGS.PRESENTER_MEDIUM.target),
  );

  useEffect(() => {
    if (!props.reducedMotion) return;
    const framing = PRESENTER_FRAMINGS[props.shot];
    camera.position.set(...framing.position);
    lookAt.current.set(...framing.target);
    camera.lookAt(lookAt.current);
    camera.fov = framing.fov;
    camera.updateProjectionMatrix();
  }, [camera, props.shot, props.reducedMotion]);

  useFrame((_state, dt) => {
    const framing = PRESENTER_FRAMINGS[props.shot];
    if (props.reducedMotion) {
      camera.lookAt(lookAt.current);
      return;
    }
    const k = smoothing(dt, 0.015);
    camera.position.x += (framing.position[0] - camera.position.x) * k;
    camera.position.y += (framing.position[1] - camera.position.y) * k;
    camera.position.z += (framing.position[2] - camera.position.z) * k;
    lookAt.current.x += (framing.target[0] - lookAt.current.x) * k;
    lookAt.current.y += (framing.target[1] - lookAt.current.y) * k;
    lookAt.current.z += (framing.target[2] - lookAt.current.z) * k;
    camera.lookAt(lookAt.current);
    const nextFov = camera.fov + (framing.fov - camera.fov) * k;
    if (Math.abs(nextFov - camera.fov) > 0.001) {
      camera.fov = nextFov;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

// ---------------------------------------------------------------------------
// The projector's REAL light and its visible effects.
//
// Two distinct jobs, kept honest and separate:
//
//   HologramLights are three.js point lights. They are the only thing that can
//   actually spill cyan onto neighbouring surfaces (an emissive material never
//   lights its neighbours), so they light the presenter's own body and the
//   projector pad at her feet. Their config is the pure, bounded rig in
//   presenterHologram (no light bomb; identical under reduced motion).
//
//   HologramProjection is the *visible* light: a soft camera-facing body halo,
//   a bright contact glow on the floor, a faint vertical projection beam and a
//   few rising motes. These are additive procedural EFFECTS (allowed by the
//   workspace rules — shaders, particles, beams), never physical scenery, and
//   they render behind the figure with depthWrite off so they cannot punch
//   alpha holes in her. Reduced motion keeps every glow but stills the animation.
// ---------------------------------------------------------------------------

/** Real cyan point lights that give the presenter and the pad true light response. */
function HologramLights(props: { reducedMotion: boolean }) {
  const specs = useMemo(
    () => buildHologramLights(props.reducedMotion),
    [props.reducedMotion],
  );
  return (
    <>
      {specs.map((spec) => (
        <pointLight
          key={spec.key}
          color={spec.color}
          intensity={spec.intensity}
          distance={spec.distance}
          decay={spec.decay}
          position={[...spec.position]}
        />
      ))}
    </>
  );
}

/** A soft radial glow texture (cyan core → transparent) for the halo and pad. */
function radialGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, "rgba(180, 235, 255, 0.9)");
  g.addColorStop(0.35, "rgba(96, 200, 255, 0.5)");
  g.addColorStop(0.7, "rgba(50, 150, 235, 0.16)");
  g.addColorStop(1.0, "rgba(30, 110, 200, 0.0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/** The visible projected light around the imported figure: halo, pad, beam, motes. */
function HologramProjection(props: { reducedMotion: boolean }) {
  const haloRef = useRef<THREE.Sprite>(null);
  const padRef = useRef<THREE.Mesh>(null);
  const beamRef = useRef<THREE.Mesh>(null);
  const motesRef = useRef<THREE.Points>(null);
  const clock = useRef(0);

  const fx = useMemo(() => {
    const glow = radialGlowTexture();

    // The screen-space body halo. depthTest ON and positioned BEHIND the figure
    // (with a negative renderOrder) so the figure — which writes depth and is
    // near-opaque — occludes the halo's core: the glow reads as a soft ring
    // around her silhouette, not an additive wash over her face.
    const haloMat = new THREE.SpriteMaterial({
      map: glow,
      color: 0x7fdcff,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });

    const padMat = new THREE.MeshBasicMaterial({
      map: glow,
      color: 0x6fd6ff,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
    });

    // A faint volumetric-looking beam: an open cone whose double-sided additive
    // sides overlap thickest at the silhouette, fading up. Kept SHORT (its top
    // sits below the chin) and faint so it never washes cyan over the face.
    const beamGeo = new THREE.CylinderGeometry(0.5, 0.28, 1.5, 40, 1, true);
    const beamMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
      uniforms: { uOpacity: { value: 0.14 }, uColor: { value: new THREE.Color(0x63c8ff) } },
      vertexShader:
        "varying vec2 vUv;\nvoid main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader:
        "varying vec2 vUv;\nuniform float uOpacity;\nuniform vec3 uColor;\n" +
        "void main(){\n" +
        "  float up = smoothstep(1.0, 0.1, vUv.y);\n" +
        "  float edge = pow(sin(vUv.x * 3.14159), 1.5);\n" +
        "  gl_FragColor = vec4(uColor, uOpacity * up * (0.35 + 0.65 * edge));\n" +
        "}",
    });

    const moteCount = 46;
    const positions = new Float32Array(moteCount * 3);
    const speeds = new Float32Array(moteCount);
    for (let i = 0; i < moteCount; i += 1) {
      const r = Math.sqrt(fieldRandom(PRESENTER_MOTE_SEED, i, 0)) * 0.55;
      const a = fieldRandom(PRESENTER_MOTE_SEED, i, 1) * Math.PI * 2;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = fieldRandom(PRESENTER_MOTE_SEED, i, 2) * 1.9;
      positions[i * 3 + 2] = Math.sin(a) * r * 0.7;
      speeds[i] = 0.12 + fieldRandom(PRESENTER_MOTE_SEED, i, 3) * 0.22;
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const moteMat = new THREE.PointsMaterial({
      map: glow,
      color: 0xafe8ff,
      size: 0.08,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      toneMapped: false,
    });

    return { glow, haloMat, padMat, beamGeo, beamMat, moteGeo, moteMat, positions, speeds, moteCount };
  }, []);

  useEffect(() => {
    return () => {
      fx.glow.dispose();
      fx.haloMat.dispose();
      fx.padMat.dispose();
      fx.beamGeo.dispose();
      fx.beamMat.dispose();
      fx.moteGeo.dispose();
      fx.moteMat.dispose();
    };
  }, [fx]);

  useFrame((_state, dt) => {
    clock.current += dt;
    const t = clock.current;
    const flick = hologramFlicker(t, props.reducedMotion);
    // Halo/pad/beam breathe with the projector flicker; reduced motion pins the
    // multiplier to 1 so the glow is preserved without any animated breakup.
    const breathe = props.reducedMotion ? 1 : 0.9 + 0.1 * Math.sin(t * 1.4);
    fx.haloMat.opacity = 0.22 * flick * breathe;
    fx.padMat.opacity = 0.3 * flick * (props.reducedMotion ? 1 : 0.88 + 0.12 * Math.sin(t * 2.1));
    fx.beamMat.uniforms.uOpacity!.value = 0.07 * flick * breathe;

    if (!props.reducedMotion && motesRef.current) {
      const attr = fx.moteGeo.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < fx.moteCount; i += 1) {
        let y = fx.positions[i * 3 + 1]! + fx.speeds[i]! * dt;
        if (y > 2.0) y -= 2.0;
        fx.positions[i * 3 + 1] = y;
        attr.setY(i, y);
      }
      attr.needsUpdate = true;
    }
  });

  return (
    <group>
      <sprite
        ref={haloRef}
        position={[0, 1.02, -0.45]}
        scale={[2.7, 3.3, 1]}
        material={fx.haloMat}
        renderOrder={-3}
      />
      <mesh
        ref={padRef}
        position={[0, 0.02, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[2.3, 2.3, 1]}
        material={fx.padMat}
        renderOrder={-2}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>
      <mesh
        ref={beamRef}
        position={[0, 0.72, 0]}
        geometry={fx.beamGeo}
        material={fx.beamMat}
        renderOrder={-2}
      />
      <points ref={motesRef} geometry={fx.moteGeo} material={fx.moteMat} renderOrder={-1} />
    </group>
  );
}

/** Renders nothing and reports the QA error. Never a primitive body. */
function PresenterMissing() {
  useEffect(() => {
    reportPresenterMissing();
  }, []);
  return null;
}
