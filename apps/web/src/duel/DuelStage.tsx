import {
  Suspense,
  useMemo,
  useRef,
  type ComponentType,
  type MutableRefObject,
} from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { FACE_OFF_TICKS } from "@pa/duel";
import { ArenaView } from "./ArenaView.js";
import { DuelActor, type GripTuning } from "./DuelActor.js";
import {
  AimMark,
  DodgeReadiness,
  FighterShadows,
  Impacts,
  MuzzleFlashes,
  Projectiles,
} from "./Gunplay.js";
import {
  AIM_PLANE_Y,
  ENGAGEMENT_MAX_YAW_RATE,
  ENGAGEMENT_YAW_RATE,
  approach,
  cameraFollowRate,
  dampAngle,
  desiredCamera,
  engagementCameraYaw,
  type InspectFraming,
} from "./duelCamera.js";
import { lerpPose, type DuelRuntime } from "./duelRuntime.js";
import type { DuelInputController } from "./duelInput.js";
import type { CoverPlacement } from "./arenaSpec.js";

// The stage: one canvas, one driver, one camera.
//
// THE DRIVER IS THE ONLY THING THAT ADVANCES THE FIGHT, and it does so by handing the
// core the real frame delta exactly once per rendered frame. The core owns the
// fixed-step clock, decides how many 60Hz steps that delta buys, and returns the new
// state. Nothing in the render tree integrates anything: every other component in
// here reads the state the driver produced and interpolates between the last two
// fixed steps using the core clock's own leftover accumulator.
//
// It is mounted first so it runs first — R3F calls frame subscribers in mount order —
// which means the actors, the balls and the camera all see the same frame's state.

function Driver(props: { runtime: DuelRuntime; input: DuelInputController }) {
  useFrame((_, delta) => {
    // Read, advance, then settle. The settle step is what keeps a click alive across
    // the frames that buy no simulation tick — at 120Hz that is most of them, and
    // clearing the latch here instead would discard about half of all input.
    const intent = props.input.peekIntent();
    const ticksAdvanced = props.runtime.advance(delta, { A: intent });
    props.input.settle(ticksAdvanced);
  });
  return null;
}

/**
 * Pointer to a world aim direction.
 *
 * The core's aim is a world-space vector, not a screen one, so the pointer is cast
 * onto the plane an aimed ball actually travels in — the standing chest line. That
 * makes "point at his chest and click" mean what it looks like it means.
 */
function AimTracker(props: {
  runtime: DuelRuntime;
  input: DuelInputController;
  aimRef: MutableRefObject<THREE.Vector3>;
}) {
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const plane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 1, 0), -AIM_PLANE_Y),
    [],
  );
  const hit = useMemo(() => new THREE.Vector3(), []);
  const { camera, pointer } = useThree();

  useFrame(() => {
    raycaster.setFromCamera(pointer, camera);
    if (!raycaster.ray.intersectPlane(plane, hit)) return;
    props.aimRef.current.copy(hit);
    const player = props.runtime.getState().combat.fighters.A;
    const dx = hit.x - player.motion.pos.x;
    const dz = hit.z - player.motion.pos.z;
    if (Math.hypot(dx, dz) > 0.35) props.input.setAim(dx, dz);
  });

  return null;
}

/** Follows the pose the phase asks for; a phase change reads as a camera move. */
function DuelCamera(props: {
  runtime: DuelRuntime;
  reducedMotion: boolean;
  input: DuelInputController;
  inspect?: InspectFraming | null;
}) {
  const position = useRef(new THREE.Vector3(0, 3, -14));
  const target = useRef(new THREE.Vector3(0, 1.2, 0));
  const fov = useRef(40);
  const camYaw = useRef(0);
  const started = useRef(false);

  useFrame(({ camera }, delta) => {
    const runtime = props.runtime;
    const state = runtime.getState();
    const poses = runtime.getPoses();
    const player = lerpPose(poses.prev.A, poses.next.A, poses.alpha);
    const opponent = lerpPose(poses.prev.B, poses.next.B, poses.alpha);

    // The engagement camera orbits behind the OPPONENT AXIS (authoritative, and one the
    // pointer cannot write back into) with a bounded lean toward the aim, then damped
    // and slew-clamped. That combination is the fix for the wild spin: see the note on
    // `engagementCameraYaw` in duelCamera.ts. The aim vector and the raycast are
    // untouched — only the yaw the camera is placed from changed.
    const axisYaw = Math.atan2(opponent.x - player.x, opponent.z - player.z);
    const aim = state.combat.fighters.A;
    const aimYaw = Math.hypot(aim.aimX, aim.aimZ) > 1e-6
      ? Math.atan2(aim.aimX, aim.aimZ)
      : axisYaw;
    const goalYaw = engagementCameraYaw(axisYaw, aimYaw);
    if (!started.current) {
      camYaw.current = goalYaw;
    } else {
      const yawRate = props.reducedMotion ? ENGAGEMENT_YAW_RATE * 1.4 : ENGAGEMENT_YAW_RATE;
      camYaw.current = dampAngle(
        camYaw.current,
        goalYaw,
        yawRate,
        ENGAGEMENT_MAX_YAW_RATE,
        delta,
      );
    }
    props.input.setCameraYaw(camYaw.current);

    const wanted = desiredCamera({
      phase: state.phase,
      faceOffProgress:
        state.phase === "FACE_OFF"
          ? 1 - (state.endsAtTick - state.clock.tick) / FACE_OFF_TICKS
          : 1,
      player,
      opponent,
      aimYaw: camYaw.current,
      playerDowned: state.combat.fighters.A.health <= 0,
      reducedMotion: props.reducedMotion,
      inspect: props.inspect ?? null,
    });

    const rate = props.inspect ? 12 : props.reducedMotion ? 9 : cameraFollowRate(state.phase);
    if (!started.current) {
      started.current = true;
      position.current.set(...wanted.position);
      target.current.set(...wanted.target);
      fov.current = wanted.fov;
    } else {
      position.current.set(
        approach(position.current.x, wanted.position[0], rate, delta),
        approach(position.current.y, wanted.position[1], rate, delta),
        approach(position.current.z, wanted.position[2], rate, delta),
      );
      target.current.set(
        approach(target.current.x, wanted.target[0], rate * 1.3, delta),
        approach(target.current.y, wanted.target[1], rate * 1.3, delta),
        approach(target.current.z, wanted.target[2], rate * 1.3, delta),
      );
      fov.current = approach(fov.current, wanted.fov, rate, delta);
    }

    camera.position.copy(position.current);
    camera.lookAt(target.current);
    const perspective = camera as THREE.PerspectiveCamera;
    if (perspective.isPerspectiveCamera && Math.abs(perspective.fov - fov.current) > 0.01) {
      perspective.fov = fov.current;
      perspective.updateProjectionMatrix();
    }
  });

  return null;
}

export interface DuelStageProps {
  readonly runtime: DuelRuntime;
  readonly input: DuelInputController;
  readonly playerGlbKey: string;
  readonly opponentGlbKey: string;
  readonly cover?: readonly CoverPlacement[];
  /**
   * The visible arena, when it is not the stand-alone yard.
   *
   * Everything else in this canvas is placed from the core's own positions, so a
   * duel fought at a mission's coordinates needs nothing changed but this: the
   * default `ArenaView` builds its ground, wall and dressing around the origin,
   * and `cover` is the list that goes with it.
   */
  readonly Scenery?: ComponentType<{ readonly reducedMotion: boolean }>;
  readonly reducedMotion?: boolean;
  readonly playerGrip?: Partial<GripTuning>;
  readonly opponentGrip?: Partial<GripTuning>;
  /** Asset-QA framing. Off in play. */
  readonly inspect?: InspectFraming | null;
}

export function DuelStage(props: DuelStageProps) {
  const aimRef = useRef(new THREE.Vector3(0, AIM_PLANE_Y, 0));
  const reducedMotion = props.reducedMotion ?? false;
  const Scenery = props.Scenery;

  return (
    <Canvas
      className="duel-canvas"
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={[1, 1.75]}
      camera={{ fov: 40, near: 0.1, far: 90, position: [0, 3, -14] }}
      gl={{
        antialias: true,
        powerPreference: "high-performance",
        toneMappingExposure: 1.05,
      }}
    >
      <Driver runtime={props.runtime} input={props.input} />
      <AimTracker runtime={props.runtime} input={props.input} aimRef={aimRef} />
      <DuelCamera
        runtime={props.runtime}
        reducedMotion={reducedMotion}
        input={props.input}
        inspect={props.inspect ?? null}
      />
      <Suspense fallback={null}>
        {Scenery ? (
          <Scenery reducedMotion={reducedMotion} />
        ) : (
          <ArenaView cover={props.cover} reducedMotion={reducedMotion} />
        )}
        <FighterShadows runtime={props.runtime} />
        <DuelActor
          runtime={props.runtime}
          side="A"
          glbKey={props.playerGlbKey}
          grip={props.playerGrip}
        />
        <DuelActor
          runtime={props.runtime}
          side="B"
          glbKey={props.opponentGlbKey}
          grip={props.opponentGrip}
        />
        <Projectiles runtime={props.runtime} />
        <MuzzleFlashes runtime={props.runtime} />
        <Impacts runtime={props.runtime} />
        <DodgeReadiness runtime={props.runtime} />
        <AimMark runtime={props.runtime} aim={aimRef} />
      </Suspense>
    </Canvas>
  );
}
