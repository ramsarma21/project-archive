import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import { RiggedCharacter } from "@pa/engine-world";
import { stepTurntable, type TurntableSpin } from "./turntable.js";
import type { MutableRefObject } from "react";

// ---------------------------------------------------------------------------
// The hub stage: the player's own avatar on the System's dais, standing in the
// Archive Hall.
//
// The hall is a 2D generated plate (`.hub-backdrop` in hub.css), not geometry.
// That is sound here rather than a shortcut, because THIS CAMERA NEVER MOVES:
// `stepTurntable` yaws the character group only, so there is no parallax for a
// flat backdrop to fail. The Archive is UI chrome — the imported-asset rule
// governs the traversable world, and explicitly permits generated textures and
// UI/Archive treatment — so nothing physical is being faked here.
//
// The canvas is therefore TRANSPARENT: the avatar and the dais composite over
// the plate. Only the dais is procedural, and it is UI (a projected ring the
// System draws under whoever it is quantifying), not set dressing.
// ---------------------------------------------------------------------------

const PLAYER_HEIGHT = 1.62;
/** The turntable sits just forward of centre, on the plate's open floor. */
const TURNTABLE_Z = -0.45;

/**
 * The System's holographic dais. This is the one piece of procedural geometry in
 * the hub and it is deliberately UI, not set dressing: a projected ring the
 * System draws under whoever it is currently quantifying.
 *
 * The opacities below are tuned for a TRANSPARENT canvas over the Archive Hall
 * plate, and that is why they are higher than a dark opaque background needed.
 * Additive light composited onto a lit plate accumulates far less alpha than the
 * same light over near-black, so the pool and the rings read much fainter for
 * the same numbers — measured on the running page, where the first pass left the
 * dais almost invisible.
 */
function SystemDais(props: { reducedMotion: boolean }) {
  const outerRef = useRef<THREE.Mesh>(null);
  const innerRef = useRef<THREE.Mesh>(null);

  // Soft floor bloom, drawn once into a canvas texture rather than as geometry.
  // It peaks in a HALO rather than at the centre, deliberately: a bright centre
  // lands exactly where the contact shadow has to darken and cancels it out,
  // which is what left the avatar hovering in the first capture.
  const poolTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const context = canvas.getContext("2d")!;
    const gradient = context.createRadialGradient(128, 128, 4, 128, 128, 126);
    gradient.addColorStop(0, "rgba(140, 224, 255, 0.05)");
    gradient.addColorStop(0.3, "rgba(140, 224, 255, 0.36)");
    gradient.addColorStop(0.58, "rgba(84, 178, 250, 0.22)");
    gradient.addColorStop(1, "rgba(56, 140, 240, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);

  useFrame((_, delta) => {
    if (props.reducedMotion) return;
    const dt = Math.min(delta, 1 / 20);
    if (outerRef.current) outerRef.current.rotation.z += dt * 0.16;
    if (innerRef.current) innerRef.current.rotation.z -= dt * 0.34;
  });

  return (
    <group position={[0, 0.015, TURNTABLE_Z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
        <planeGeometry args={[2.3, 2.3]} />
        <meshBasicMaterial
          map={poolTexture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={outerRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} renderOrder={3}>
        <ringGeometry args={[0.7, 0.727, 96, 1, 0, Math.PI * 1.68]} />
        <meshBasicMaterial
          color="#57c4ff"
          transparent
          opacity={0.92}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={innerRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} renderOrder={4}>
        <ringGeometry args={[0.5, 0.514, 72, 1, 0, Math.PI * 0.58]} />
        <meshBasicMaterial
          color="#8adcff"
          transparent
          opacity={0.8}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

function Turntable(props: {
  spin: MutableRefObject<TurntableSpin>;
  reducedMotion: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    const yaw = stepTurntable(props.spin.current, delta, props.reducedMotion);
    if (groupRef.current) groupRef.current.rotation.y = yaw;
  });

  return (
    <group ref={groupRef} position={[0, 0, TURNTABLE_Z]}>
      {/* No debug body: a failed rig leaves the dais empty rather than putting
          a primitive placeholder on the one thing the hub is built to show. */}
      <RiggedCharacter
        glbKey="playerboy-rigged"
        height={PLAYER_HEIGHT}
        clip="idle"
        showFallback={false}
      />
    </group>
  );
}

/**
 * Camera framing. Placed inside the room, low enough to read as standing at eye
 * level with the player, angled so the doorway and press fall behind them.
 */
function StageCamera() {
  useFrame(({ camera }) => {
    // Set once per frame rather than once on mount so a resize/StrictMode
    // remount cannot leave the camera pointing at the origin default.
    camera.lookAt(0, 0.94, TURNTABLE_Z);
  });
  return null;
}

/**
 * Lighting matched to the plate rather than to a room. The plate's only bright
 * source is the far vanishing point directly behind the character, so the key
 * is a cool rim from behind; the front fill is deliberately weaker, to keep the
 * silhouette the plate's centre glow gives us, and just strong enough that the
 * face is not a black cutout. Nothing casts a shadow — the floor is painted, so
 * there is no receiver, and the dais pool is what grounds the figure.
 */
function ArchiveLighting() {
  return (
    <>
      <ambientLight intensity={0.62} color="#9ec6dc" />
      <hemisphereLight color="#cfeaff" groundColor="#0c1a24" intensity={0.55} />
      {/* The hall's far glow, behind the character: the plate's own key. */}
      <directionalLight position={[0, 2.4, -4.2]} color="#a8e6ff" intensity={2.6} />
      {/* Low front fill, so the face reads against that glow. */}
      <directionalLight position={[0.7, 1.7, 3.4]} color="#cfe6ff" intensity={1.15} />
      {/* The record banks down the left and right of the plate. */}
      <directionalLight position={[-4, 1.8, 0.6]} color="#57c4ff" intensity={0.7} />
      <directionalLight position={[4, 1.8, 0.6]} color="#57c4ff" intensity={0.6} />
      {/* The dais glow spilling up onto the legs. */}
      <pointLight
        position={[0, 0.42, TURNTABLE_Z]}
        color="#63d2ff"
        intensity={3}
        distance={4.2}
        decay={2}
      />
    </>
  );
}

export function HubStage(props: {
  spin: MutableRefObject<TurntableSpin>;
  reducedMotion: boolean;
  /**
   * True while a mission owns the screen. The mission draws its own full
   * background, so this stage is completely hidden — but it is still a whole
   * scene per frame, and a second live WebGL context, for nobody. Parking the
   * frameloop rather than unmounting keeps the context and the loaded rig warm,
   * so returning to the hub costs no reload.
   */
  hidden?: boolean;
}) {
  return (
    <Canvas
      className="hub-canvas"
      frameloop={props.hidden === true ? "never" : "always"}
      dpr={[1, 1.75]}
      camera={{ fov: 40, near: 0.1, far: 60, position: [0, 1.44, 2.72] }}
      gl={{
        antialias: true,
        powerPreference: "high-performance",
        // Transparent, so the Archive Hall plate behind the canvas is what the
        // avatar and the dais stand in. No `<color attach="background">`.
        alpha: true,
        toneMappingExposure: 1.14,
      }}
    >
      <StageCamera />
      <Suspense fallback={null}>
        <ArchiveLighting />
        {/* What grounds the avatar. The plate's floor is painted, so no light in
            the scene can lay a shadow on it and the body would otherwise hover
            over the hall — which is exactly what the first capture showed. A
            real contact shadow is the case the asset rule keeps procedural, and
            it beats a blob: it is the shape of the character, and it turns with
            him on the turntable. */}
        <ContactShadows
          position={[0, 0.017, TURNTABLE_Z]}
          scale={2.1}
          resolution={512}
          blur={1.7}
          far={1.9}
          opacity={1}
          color="#01060b"
        />
        <SystemDais reducedMotion={props.reducedMotion} />
        <Turntable spin={props.spin} reducedMotion={props.reducedMotion} />
      </Suspense>
    </Canvas>
  );
}
