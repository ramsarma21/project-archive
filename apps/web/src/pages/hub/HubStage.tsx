import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { RiggedCharacter } from "@pa/engine-world";
import { HUB_ROOM, HubRoom } from "./HubRoom.js";
import { stepTurntable, type TurntableSpin } from "./turntable.js";
import type { MutableRefObject } from "react";

const PLAYER_HEIGHT = 1.62;
/** The turntable sits just forward of room centre, clear of the press. */
const TURNTABLE_Z = -0.45;

/**
 * The System's holographic dais. This is the one piece of procedural geometry in
 * the hub and it is deliberately UI, not set dressing: a projected ring the
 * System draws under whoever it is currently quantifying.
 */
function SystemDais(props: { reducedMotion: boolean }) {
  const outerRef = useRef<THREE.Mesh>(null);
  const innerRef = useRef<THREE.Mesh>(null);

  // Soft floor bloom, drawn once into a canvas texture rather than as geometry.
  const poolTexture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const context = canvas.getContext("2d")!;
    const gradient = context.createRadialGradient(128, 128, 4, 128, 128, 126);
    gradient.addColorStop(0, "rgba(140, 224, 255, 0.34)");
    gradient.addColorStop(0.4, "rgba(84, 178, 250, 0.15)");
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
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
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
          opacity={0.5}
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
          opacity={0.4}
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

export function HubStage(props: {
  spin: MutableRefObject<TurntableSpin>;
  reducedMotion: boolean;
  /**
   * True while a mission owns the screen. The mission draws its own full
   * background, so this room is completely hidden — but it is still a whole
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
      // Explicit PCF: three deprecated PCFSoftShadowMap (r18x) and silently
      // falls back to this anyway, so asking for it directly keeps the console
      // clean without changing what is drawn.
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={[1, 1.75]}
      camera={{ fov: 40, near: 0.1, far: 60, position: [0, 1.44, 2.72] }}
      gl={{
        antialias: true,
        powerPreference: "high-performance",
        // Matches the interior exposure contract; ACES at 1.0 crushed the
        // dark-oak floor and plank walls into black.
        toneMappingExposure: 1.14,
      }}
    >
      <color attach="background" args={["#05080d"]} />
      <fogExp2 attach="fog" args={["#0a0f16", 0.03]} />
      <StageCamera />
      <Suspense fallback={null}>
        <HubRoom reducedMotion={props.reducedMotion} />
        <SystemDais reducedMotion={props.reducedMotion} />
        <Turntable spin={props.spin} reducedMotion={props.reducedMotion} />
      </Suspense>
    </Canvas>
  );
}

/** Room extent, exported so the hub copy can describe the space. */
export const HUB_STAGE_ROOM = HUB_ROOM;
