import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  PLAYER_CLIP_SPEC,
  RiggedCharacter,
  STAND_HEIGHT,
  registerCharacterClips,
} from "@pa/engine-world";
import { dawnSky } from "../mission/dawn.js";
import type { MissionCivilian, MissionInstance } from "../mission/levelPort.js";
import { VisorAnnotation } from "./VisorAnnotation.js";
import { VisorIntensity } from "./VisorMarks.js";
import type { VisorPlan } from "./visorPlan.js";

// ---------------------------------------------------------------------------
// The held moment, as a frame.
//
// This is the world the player is about to run, standing still, from the exact
// viewpoint they will play it from — and the reason the visor is a held moment
// rather than a fly-over is entirely contained in that sentence. What is learned
// here is anchored to this camera, so it transfers to the run without being
// mentally re-projected out of a viewpoint the player will never occupy again.
//
// It is its own canvas rather than a layer inside the mission's, and that is a
// hard constraint doing something useful. `MissionStage` belongs to the container
// and the visor must not touch it; the container's BRIEFING phase already holds a
// loaded `MissionInstance` and has not yet built a runtime. So the hold renders the
// instance's own art, at tick zero, before any clock exists — which is precisely
// what "the world holds" means, and it is why the mission clock cannot have started
// during it even by accident. There is nothing here to tick.
//
// Two consequences worth stating. The sky is `dawnSky(0)`: full night, the last of
// the dark, unspent. And every GLB the level needs is fetched and parsed while the
// player is reading, so the hold doubles as the warm-up the first frame of the run
// would otherwise pay for.
// ---------------------------------------------------------------------------

const PLAYER_RIG = "playerboy-rigged";

/**
 * The chase camera's own resting geometry, mirrored.
 *
 * These are `ChaseCamera`'s numbers in MissionStage. They are restated rather than
 * imported because that component does not export them and the visor does not edit
 * that file — and restating them is the point of the whole design: the hold has to
 * put the camera where the run will put it, so if those numbers move, this frame
 * should be corrected to match rather than left to drift.
 */
const CHASE_BACK_M = 4.8;
const CHASE_BACK_REDUCED_M = 5.6;
const CHASE_UP_M = 2.5;
const CHASE_FOCUS_UP_M = 1.2;

/** How far the player may look around during the hold, in radians. */
const LOOK_YAW_LIMIT = 1.15;
const LOOK_PITCH_MIN = -0.12;
const LOOK_PITCH_MAX = 0.62;

export interface LookState {
  /** Added to the spawn facing. Written by the drag handler on the wrapper. */
  yaw: number;
  pitch: number;
}

export function createLookState(): LookState {
  return { yaw: 0, pitch: 0 };
}

/**
 * The camera, orbiting the spawn.
 *
 * The orbit is centred on the player's own chest and starts exactly where the
 * chase camera rests, so releasing the visor is a cut to the same frame rather
 * than a jump. Looking around moves the camera and never the player: nothing in
 * the hold may leave the run starting from somewhere the briefing did not show.
 */
function HoldCamera(props: {
  spawn: { pos: THREE.Vector3Like; yaw: number };
  look: LookState;
  reducedMotion: boolean;
}) {
  const focus = useMemo(
    () =>
      new THREE.Vector3(
        props.spawn.pos.x,
        props.spawn.pos.y + CHASE_FOCUS_UP_M,
        props.spawn.pos.z,
      ),
    [props.spawn.pos.x, props.spawn.pos.y, props.spawn.pos.z],
  );
  const rest = useMemo(() => {
    const back = props.reducedMotion ? CHASE_BACK_REDUCED_M : CHASE_BACK_M;
    const rise = CHASE_UP_M - CHASE_FOCUS_UP_M;
    return { radius: Math.hypot(back, rise), pitch: Math.atan2(rise, back) };
  }, [props.reducedMotion]);

  const smoothed = useRef({ yaw: 0, pitch: 0 });

  useFrame(({ camera }, delta) => {
    const target = props.look;
    // Eased so a drag feels like a head turning rather than a value being set,
    // and frame-rate independent so it feels the same at 30 and at 120.
    const ease = 1 - Math.pow(0.0025, Math.min(delta, 1 / 20));
    smoothed.current.yaw += (target.yaw - smoothed.current.yaw) * ease;
    smoothed.current.pitch += (target.pitch - smoothed.current.pitch) * ease;

    const yaw = props.spawn.yaw + smoothed.current.yaw;
    const pitch = Math.min(
      LOOK_PITCH_MAX,
      Math.max(LOOK_PITCH_MIN, rest.pitch + smoothed.current.pitch),
    );
    const flat = Math.cos(pitch) * rest.radius;
    camera.position.set(
      focus.x - Math.sin(yaw) * flat,
      focus.y + Math.sin(pitch) * rest.radius,
      focus.z - Math.cos(yaw) * flat,
    );
    camera.lookAt(focus);
  });

  return null;
}

/**
 * The reveal and the dissolve, on the frame loop that is already running.
 *
 * Inside the canvas on purpose. The repo's rule is one render loop and the loop is
 * R3F's, so the visor coming up is a term in that loop rather than a second
 * `requestAnimationFrame` racing it — and taking the frame delta rather than the
 * wall clock is the same reason the mission's sky does: a fade driven off
 * `performance.now()` behaves differently on a backgrounded tab, and this one ends
 * by starting a mission.
 *
 * The number is written to a ref, so a hologram fading over half a second costs no
 * React renders. `onSettled` is the only thing that escapes, once per direction.
 */
function VisorReveal(props: {
  intensity: { current: number };
  direction: { current: 1 | -1 };
  revealMs: number;
  dissolveMs: number;
  onSettled: (atTop: boolean) => void;
}) {
  const reported = useRef(0);
  useFrame((_, delta) => {
    const direction = props.direction.current;
    const span = direction > 0 ? props.revealMs : props.dissolveMs;
    // Clamped so a long frame — a GLB finishing its parse, a tab coming back —
    // cannot jump the whole animation in one step.
    const step = (Math.min(delta, 1 / 15) * 1000) / Math.max(1, span);
    props.intensity.current = Math.min(
      1,
      Math.max(0, props.intensity.current + direction * step),
    );
    if (direction > 0 && props.intensity.current >= 1 && reported.current !== 1) {
      reported.current = 1;
      props.onSettled(true);
    }
    if (direction < 0 && props.intensity.current <= 0 && reported.current !== -1) {
      reported.current = -1;
      props.onSettled(false);
    }
  });
  return null;
}

/** The night the hold is standing in, and the night the clock has not yet spent. */
function HoldSky() {
  const sky = useMemo(() => dawnSky(0), []);
  const sunDistance = 46;
  const bearing = { x: 0.83, z: 0.56 };
  const elevation = (sky.sunElevationDeg * Math.PI) / 180;
  const ground = Math.cos(elevation) * sunDistance;
  return (
    <>
      <color attach="background" args={[sky.sky]} />
      <fogExp2 attach="fog" args={[sky.sky, sky.fogDensity]} />
      <hemisphereLight args={[sky.hemiSky, sky.hemiGround, sky.ambient]} />
      <directionalLight
        color={sky.sunColour}
        intensity={sky.sunIntensity}
        position={[
          bearing.x * ground,
          Math.sin(elevation) * sunDistance,
          bearing.z * ground,
        ]}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
    </>
  );
}

/** The player, standing where the run will start. Imported rig, no fallback. */
function HoldPlayer(props: { spawn: { pos: THREE.Vector3Like; yaw: number } }) {
  useEffect(() => {
    registerCharacterClips(PLAYER_RIG, PLAYER_CLIP_SPEC);
  }, []);
  return (
    <group
      position={[props.spawn.pos.x, props.spawn.pos.y, props.spawn.pos.z]}
      rotation={[0, props.spawn.yaw, 0]}
    >
      <RiggedCharacter
        glbKey={PLAYER_RIG}
        height={STAND_HEIGHT}
        clip="idle"
        castShadow
        showFallback={false}
      />
    </group>
  );
}

/**
 * The crowd, at tick zero.
 *
 * Drawn because the briefing says "walk into that crowd and stay in it", and a ring
 * on empty cobbles teaches the player to look for a crowd that is not there. They
 * are the instance's own bodies at the attempt's own seed, so these are literally
 * the people who will be standing there when the player arrives.
 */
function HoldCrowd(props: {
  civilians: readonly MissionCivilian[];
  reducedMotion: boolean;
}) {
  return (
    <>
      {props.civilians.map((civilian) => (
        <group
          key={civilian.id}
          position={[civilian.pos.x, civilian.pos.y, civilian.pos.z]}
          rotation={[0, civilian.yaw, 0]}
        >
          <RiggedCharacter
            glbKey={civilian.rigKey}
            height={civilian.capsuleHeight}
            clip={civilian.clip ?? "idle"}
            tint={civilian.tint}
            distanceAnimThrottle
            cullBeyondM={props.reducedMotion ? 26 : 38}
            contactShadow={false}
            showFallback={false}
          />
        </group>
      ))}
    </>
  );
}

export function VisorHoldStage(props: {
  instance: MissionInstance;
  seed: number;
  plan: VisorPlan;
  look: LookState;
  /** 0 dark, 1 fully up. Owned by VisorHold; read every frame, never a prop change. */
  intensity: { current: number };
  /** +1 coming up, -1 going dark. Flipped by the release. */
  direction: { current: 1 | -1 };
  revealMs: number;
  dissolveMs: number;
  onSettled: (atTop: boolean) => void;
  reducedMotion: boolean;
}) {
  const Scenery = props.instance.Scenery;
  const spawn = props.instance.spawn;
  const civilians = useMemo(
    () => props.instance.civiliansAtTick?.(0, props.seed) ?? [],
    [props.instance, props.seed],
  );
  const spawnTuple = useMemo(
    () => [spawn.pos.x, spawn.pos.y, spawn.pos.z] as const,
    [spawn.pos.x, spawn.pos.y, spawn.pos.z],
  );

  return (
    <Canvas
      className="visor-canvas"
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={[1, 1.75]}
      camera={{
        fov: 52,
        near: 0.1,
        far: 240,
        position: [
          spawn.pos.x - Math.sin(spawn.yaw) * CHASE_BACK_M,
          spawn.pos.y + CHASE_UP_M,
          spawn.pos.z - Math.cos(spawn.yaw) * CHASE_BACK_M,
        ],
      }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      <HoldSky />
      <HoldCamera
        spawn={spawn}
        look={props.look}
        reducedMotion={props.reducedMotion}
      />
      <VisorReveal
        intensity={props.intensity}
        direction={props.direction}
        revealMs={props.revealMs}
        dissolveMs={props.dissolveMs}
        onSettled={props.onSettled}
      />

      <Suspense fallback={null}>
        <HoldPlayer spawn={spawn} />
      </Suspense>
      <Suspense fallback={null}>
        <HoldCrowd civilians={civilians} reducedMotion={props.reducedMotion} />
      </Suspense>
      {Scenery && (
        <Suspense fallback={null}>
          <Scenery reducedMotion={props.reducedMotion} />
        </Suspense>
      )}

      <VisorIntensity.Provider value={props.intensity}>
        <VisorAnnotation plan={props.plan} spawn={spawnTuple} />
      </VisorIntensity.Provider>
    </Canvas>
  );
}
