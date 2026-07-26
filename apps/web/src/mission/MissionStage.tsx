import { Suspense, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  AIRBORNE_VISUAL_TUNING,
  CLIP_AUTHORED_MS,
  PARKOUR_TUNING,
  PLAYER_ACTION_CLIPS,
  PLAYER_CLIP_SPEC,
  RiggedCharacter,
  STAND_HEIGHT,
  STEALTH_TUNING,
  VERB_CLIP,
  registerCharacterClips,
  strideTimeScale,
} from "@pa/engine-world";
import { dawnSky } from "./dawn.js";
import type { MissionCivilian } from "./levelPort.js";
import type { MissionInputState } from "./missionInput.js";
import type { MissionTraversalOutcome } from "./result.js";
import {
  missionCrowdParity,
  missionPresentation,
  stepMissionRuntime,
  throwMissionDiversion,
  type MissionPresentation,
  type MissionRuntime,
} from "./traversal.js";

function isDevBuild(): boolean {
  try {
    return Boolean(import.meta.env.DEV);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The mission stage.
//
// One render loop, R3F's, and the simulation is stepped inside it. There is no
// second requestAnimationFrame, no interval, and no clock of the container's own:
// the frame delta goes into `stepMissionRuntime`, which scales it for reflex time
// and hands it to the shared fixed-step field clock. Unmounting the canvas is
// therefore the whole of stopping the mission, which is what makes teardown
// something the framework guarantees rather than something this file remembers.
//
// Nothing physical is drawn here. Every visible production object is the level's
// imported GLB, mounted through `instance.Scenery`, and the player is the imported
// rig with `showFallback={false}` — a level with no scenery yet renders an empty
// stage rather than a primitive stand-in, because a debug shell that looks like
// content is worse than nothing. Lighting, sky and camera are procedural, which
// the imported-world rule allows precisely because none of them is an object.
// ---------------------------------------------------------------------------

const PLAYER_RIG = "playerboy-rigged";

/**
 * Mixer timeScale for the clip currently playing.
 *
 * Three cases, and they are genuinely different problems. Locomotion clips are
 * authored at a cycle speed that does not match the speed the motion code drives,
 * so `run` skates about 64% at sprint speed until the stride is matched — that is
 * `strideTimeScale`. Authored verb clips are Mixamo performances several times
 * longer than the parkour contract's duration, so they are scaled to hit the
 * authored intent. Airborne clips have their own published numbers.
 */
function clipTimeScale(runtime: MissionRuntime, clip: string): number {
  if (clip === "jump") return AIRBORNE_VISUAL_TUNING.standingTimeScale;
  if (clip === "runJump") return AIRBORNE_VISUAL_TUNING.runningTimeScale;

  const verb = runtime.flow.verb;
  if (verb !== "NONE" && VERB_CLIP[verb] === clip) {
    const authored = CLIP_AUTHORED_MS[clip];
    const target = PARKOUR_TUNING.durationsMs[verb];
    if (authored && target > 0) return authored / target;
  }

  const speed = Math.hypot(runtime.motion.vel.x, runtime.motion.vel.z);
  return strideTimeScale(clip, speed);
}

/**
 * Steps the simulation and reports the terminal outcome once.
 *
 * The guard matters: a run resolves on a tick, and the frames between that tick
 * and the container re-rendering would otherwise report the same outcome several
 * times over — which at the session machine's boundary is several attempts trying
 * to resolve.
 */
function MissionDriver(props: {
  runtime: MissionRuntime;
  input: MissionInputState;
  reducedMotion: boolean;
  paused: boolean;
  onResolved: (outcome: MissionTraversalOutcome) => void;
  onSample: (presentation: MissionPresentation) => void;
}) {
  const reported = useRef(false);
  const sampledAt = useRef(-1);
  const auditedAt = useRef(-1);

  useFrame(({ camera }, delta) => {
    const { runtime, input } = props;
    // Camera-relative intent, resolved where the camera is. Flattened to the
    // ground plane so looking down never shortens a run.
    const yaw = Math.atan2(camera.position.x - runtime.motion.pos.x, camera.position.z - runtime.motion.pos.z);
    const away = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    const right = { x: -away.z, z: away.x };
    const moveX = away.x * input.forward + right.x * input.right;
    const moveZ = away.z * input.forward + right.z * input.right;

    const step = stepMissionRuntime(runtime, {
      dtS: delta,
      moveX,
      moveZ,
      sprintHeld: input.sprintHeld,
      crouchHeld: input.crouchHeld,
      jumpBuffered: input.jumpBuffered,
      dashBuffered: input.dashBuffered,
      strikeBuffered: input.strikeBuffered,
      reducedMotion: props.reducedMotion,
      flowEnabled: !props.paused,
    });
    // Each latch survives until a fixed step actually took it. A frame that
    // advanced no ticks — a very high refresh rate, or a resumed tab whose delta
    // was clamped to nothing — must not swallow the press.
    if (step.jumpConsumed) input.jumpBuffered = false;
    if (step.dashConsumed) input.dashBuffered = false;
    if (step.strikeConsumed) input.strikeBuffered = false;

    // A throw goes where the player is facing, and is released by the runtime
    // rather than from here: the object is simulation, not presentation, and it
    // has to be able to strike a body on its way.
    //
    // The distance is not arbitrary and is not the maximum. `solveThrow` takes the
    // flatter of the two ballistic angles, but the arc still climbs with range: an
    // 18 m throw passes 3.7 m up and clears every head for fifteen metres, and a
    // 13 m throw is still 2.0 m up at four metres out. Only inside about eight
    // metres does the object spend its flight at body height, which is the band
    // where a civilian can block it and the verb is a skill. Until there is an aim
    // reticle this is the honest default; see the note in the handoff.
    if (input.throwBuffered) {
      input.throwBuffered = false;
      const range = Math.min(STEALTH_TUNING.throwMaxRangeM, 8);
      throwMissionDiversion(runtime, {
        x: runtime.motion.pos.x + away.x * range,
        y: runtime.motion.pos.y,
        z: runtime.motion.pos.z + away.z * range,
      });
    }

    // The HUD samples from inside this loop rather than running one of its own,
    // at a rate a person can read. Sixty React updates a second to draw a clock
    // that changes ten times is the expensive way to do nothing.
    //
    // While the beat is running it is exactly the right way, though. The read is
    // one mark converging on one line and the windows are two ticks wide at the
    // top end, so a mark that moves in eight-tick jumps is not a read at all —
    // it is a slideshow the player is asked to hit. Full rate for the few
    // seconds a chart lasts is the cheapest honest answer.
    const striking = runtime.beat?.phase === "STRIKING";
    const slice = striking ? runtime.ticks : Math.floor(runtime.ticks / 8);
    if (slice !== sampledAt.current) {
      sampledAt.current = slice;
      props.onSample(missionPresentation(runtime));
    }

    // Once a second in development, check that the crowd the stealth field
    // believes in is the crowd this component just drew. It should be impossible
    // to fail — density is counted from `runtime.civilians` and so is this — and
    // that is the reason to check it: the invariant is one refactor from becoming
    // a convention, and its failure mode looks correct and plays wrong.
    const second = Math.floor(runtime.ticks / 60);
    if (second !== auditedAt.current) {
      auditedAt.current = second;
      if (isDevBuild()) {
        for (const complaint of missionCrowdParity(runtime)) {
          console.error(`[mission] crowd parity: ${complaint}.`);
        }
      }
    }

    if (step.outcome && !reported.current) {
      reported.current = true;
      props.onSample(missionPresentation(runtime));
      props.onResolved(step.outcome);
    }
  });

  return null;
}

/**
 * The crowd, instanced from exactly the list the stealth field counted.
 *
 * The parity this holds is the point: `runtime.civilians` is the one array, and it
 * is what the throw physics collides with, what the crowd's density was counted
 * from, and what is drawn here. Rendering a subset for performance would hide the
 * player behind bodies that are not on screen, which looks correct and plays wrong,
 * so the lever for cost is `distanceAnimThrottle` and `cullBeyondM` — both of which
 * stop *animating and drawing* a distant body without changing how many there are.
 *
 * The set of ids is React state and only changes when the cast does; positions are
 * written imperatively every frame, so a walking crowd costs no re-renders.
 */
function MissionCrowd(props: { runtime: MissionRuntime; reducedMotion: boolean }) {
  const groups = useRef(new Map<string, THREE.Group>());
  const [cast, setCast] = useState<readonly MissionCivilian[]>(
    () => props.runtime.civilians,
  );
  const castKey = useRef("");

  useFrame(() => {
    const civilians = props.runtime.civilians;
    for (const civilian of civilians) {
      const node = groups.current.get(civilian.id);
      if (!node) continue;
      node.position.set(civilian.pos.x, civilian.pos.y, civilian.pos.z);
      node.rotation.y = civilian.yaw;
    }
    const key = civilians.map((civilian) => civilian.id).join("|");
    if (key !== castKey.current) {
      castKey.current = key;
      setCast(civilians);
    }
  });

  return (
    <>
      {cast.map((civilian) => (
        <group
          key={civilian.id}
          ref={(node) => {
            if (node) groups.current.set(civilian.id, node);
            else groups.current.delete(civilian.id);
          }}
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

/**
 * The sky, as the mission clock.
 *
 * This is the whole visible half of the dawn design. The three minutes are the
 * last of the night, so the background, the fog, the ambient and the sun are all
 * driven off `runtime.dawn.lift01` — the same number the stealth field's light
 * term was lifted by on the same tick. That identity is the point: the player is
 * not being told the dark is going, they are watching it go, and the thing they
 * are watching is literally the thing that is exposing them.
 *
 * Procedural, and allowed to be. The imported-world rule scopes to physical
 * objects and surfaces; sky, fog and lighting are named exceptions, and there is
 * no GLB that could express a sky changing over three minutes anyway.
 *
 * Written imperatively through refs so a sky that changes every frame costs no
 * React renders, and recomputed only when the lift has actually moved enough to
 * be worth a colour mix — a hex parse sixty times a second to produce the same
 * colour is the expensive way to do nothing.
 */
const SKY_STEP = 0.0015;
const SUN_DISTANCE_M = 46;
/** Unit XZ bearing the sun rises on. The azimuth the shipped light already used. */
const SUN_BEARING = { x: 0.83, z: 0.56 };

function DawnSky(props: { runtime: MissionRuntime }) {
  const background = useRef<THREE.Color>(null);
  const fog = useRef<THREE.FogExp2>(null);
  const hemisphere = useRef<THREE.HemisphereLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const appliedLift = useRef(Number.NaN);

  useFrame(() => {
    const lift = props.runtime.dawn.lift01;
    if (Math.abs(lift - appliedLift.current) < SKY_STEP) return;
    appliedLift.current = lift;

    const sky = dawnSky(lift);
    background.current?.set(sky.sky);
    if (fog.current) {
      fog.current.color.set(sky.sky);
      fog.current.density = sky.fogDensity;
    }
    if (hemisphere.current) {
      hemisphere.current.color.set(sky.hemiSky);
      hemisphere.current.groundColor.set(sky.hemiGround);
      hemisphere.current.intensity = sky.ambient;
    }
    if (sun.current) {
      sun.current.color.set(sky.sunColour);
      sun.current.intensity = sky.sunIntensity;
      const elevation = (sky.sunElevationDeg * Math.PI) / 180;
      const ground = Math.cos(elevation) * SUN_DISTANCE_M;
      sun.current.position.set(
        SUN_BEARING.x * ground,
        Math.sin(elevation) * SUN_DISTANCE_M,
        SUN_BEARING.z * ground,
      );
    }
  });

  // Initial values are the first stop's, so the first frame drawn is night
  // rather than a flash of daylight while the loop catches up.
  const opening = dawnSky(props.runtime.dawn.lift01);
  return (
    <>
      <color ref={background} attach="background" args={[opening.sky]} />
      <fogExp2
        ref={fog}
        attach="fog"
        args={[opening.sky, opening.fogDensity]}
      />
      <hemisphereLight
        ref={hemisphere}
        args={[opening.hemiSky, opening.hemiGround, opening.ambient]}
      />
      <directionalLight
        ref={sun}
        color={opening.sunColour}
        intensity={opening.sunIntensity}
        position={[
          SUN_BEARING.x * SUN_DISTANCE_M,
          SUN_DISTANCE_M * Math.sin((opening.sunElevationDeg * Math.PI) / 180),
          SUN_BEARING.z * SUN_DISTANCE_M,
        ]}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
    </>
  );
}

/** The imported rig, driven by motion. Motion owns the transform; this reads it. */
function MissionPlayer(props: { runtime: MissionRuntime }) {
  const group = useRef<THREE.Group>(null);
  const timeScaleRef = useRef(1);
  const [clip, setClip] = useState("idle");
  const clipRef = useRef("idle");

  // Registered on mount rather than at import time: @pa/chapter-boston-world
  // registers this same rig from a stale list when it loads, and whichever
  // registration runs last wins.
  useEffect(() => {
    registerCharacterClips(PLAYER_RIG, PLAYER_CLIP_SPEC);
  }, []);

  useFrame(() => {
    const node = group.current;
    if (!node) return;
    const { motion, flow } = props.runtime;
    node.position.set(motion.pos.x, motion.pos.y, motion.pos.z);
    node.rotation.y = motion.yaw;
    timeScaleRef.current = clipTimeScale(props.runtime, clipRef.current);
    if (flow.clip !== clipRef.current) {
      clipRef.current = flow.clip;
      setClip(flow.clip);
    }
  });

  return (
    <group ref={group}>
      <RiggedCharacter
        glbKey={PLAYER_RIG}
        height={STAND_HEIGHT}
        clip={clip}
        timeScaleRef={timeScaleRef}
        loopOnce={PLAYER_ACTION_CLIPS.has(clip)}
        castShadow
        showFallback={false}
      />
    </group>
  );
}

/**
 * Third-person chase camera. Procedural on purpose: a camera is not an object,
 * and the imported-world rule scopes to physical geometry.
 *
 * It trails the player's facing rather than their velocity, so a vault or a slide
 * does not swing the frame, and it lerps in a frame-rate-independent way so the
 * feel is the same at 30 and 120.
 *
 * Reduced motion sits further back and tracks HARDER, not softer. The thing to
 * remove is the camera's own independent movement — a lazy camera swings through
 * every turn the player makes, which is precisely the motion being opted out of.
 */
function ChaseCamera(props: { runtime: MissionRuntime; reducedMotion: boolean }) {
  const desired = useRef(new THREE.Vector3());
  const focus = useRef(new THREE.Vector3());

  useFrame(({ camera }, delta) => {
    const { motion } = props.runtime;
    const back = props.reducedMotion ? 5.6 : 4.8;
    const up = 2.5;
    desired.current.set(
      motion.pos.x - Math.sin(motion.yaw) * back,
      motion.pos.y + up,
      motion.pos.z - Math.cos(motion.yaw) * back,
    );
    const ease = 1 - Math.pow(props.reducedMotion ? 0.0005 : 0.004, Math.min(delta, 1 / 20));
    camera.position.lerp(desired.current, ease);
    focus.current.set(motion.pos.x, motion.pos.y + 1.2, motion.pos.z);
    camera.lookAt(focus.current);
  });

  return null;
}

export function MissionStage(props: {
  runtime: MissionRuntime;
  input: MissionInputState;
  reducedMotion: boolean;
  /** True while a UI surface owns input. The sim keeps integrating; flow stops. */
  paused: boolean;
  onResolved: (outcome: MissionTraversalOutcome) => void;
  onSample: (presentation: MissionPresentation) => void;
}) {
  const Scenery = props.runtime.instance.Scenery;
  const spawn = props.runtime.instance.spawn;

  return (
    <Canvas
      className="msn-canvas"
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={[1, 1.75]}
      camera={{
        fov: 52,
        near: 0.1,
        far: 240,
        position: [spawn.pos.x, spawn.pos.y + 2.5, spawn.pos.z - 4.8],
      }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      <DawnSky runtime={props.runtime} />

      <MissionDriver
        runtime={props.runtime}
        input={props.input}
        reducedMotion={props.reducedMotion}
        paused={props.paused}
        onResolved={props.onResolved}
        onSample={props.onSample}
      />
      <ChaseCamera runtime={props.runtime} reducedMotion={props.reducedMotion} />

      {/* Suspense per subtree so a slow level asset cannot hold up the player
          rig, and neither one substitutes a visible placeholder while it loads. */}
      <Suspense fallback={null}>
        <MissionPlayer runtime={props.runtime} />
      </Suspense>
      <Suspense fallback={null}>
        <MissionCrowd runtime={props.runtime} reducedMotion={props.reducedMotion} />
      </Suspense>
      {Scenery && (
        <Suspense fallback={null}>
          <Scenery reducedMotion={props.reducedMotion} />
        </Suspense>
      )}
    </Canvas>
  );
}
