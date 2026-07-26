import { Suspense, useCallback, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { FACE_OFF_SECONDS } from "@pa/duel";
import { PLAYER_RIG } from "../duel/m1Duel.js";
import {
  AIM_PLANE_Y,
  approach,
  cameraFollowRate,
  desiredCamera,
} from "../duel/duelCamera.js";
import { ArenaActor, type ArenaActorFrame } from "./ArenaActor.js";
import {
  ArenaAimMark,
  ArenaBalls,
  ArenaBodyShadows,
  ArenaDodgeReadiness,
  ArenaHitFlashes,
  ArenaLastSeenMark,
  ArenaMuzzleFlashes,
} from "./ArenaGunplay.js";
import { ArenaScenery } from "./ArenaScenery.js";
import { answeringCameraSettles, cameraPhaseFor } from "./arenaCamera.js";
import {
  staleBodyOpacity,
  type ArenaSample,
  type ArenaSource,
} from "./arenaFeed.js";
import type { ActorPose } from "../duel/duelRuntime.js";

// One canvas, one sampler, one camera.
//
// THE SAMPLER IS NOT A DRIVER. The boss duel mounts a component that hands the core a
// frame delta and gets a new state back; nothing in this tree advances anything. The
// sampler asks the source "where was everything at this instant" and puts the answer
// in a ref, and every other component in here reads that ref. It is mounted first so
// it runs first — R3F calls frame subscribers in mount order — which is what makes the
// bodies, the balls and the camera agree about which frame they are drawing.
//
// Both fighters wear the player rig. PvP is two students, and the officer rig would
// dress one of them as a redcoat. Cosmetics exist in @pa/pvp and are deliberately
// never handed to the simulation or projected into a snapshot, so there is nothing to
// read here yet; when there is, it arrives as a glbKey and this is where it lands.

const OPPONENT_RIG = PLAYER_RIG;

function Sampler(props: {
  source: ArenaSource;
  into: { current: ArenaSample | null };
}) {
  useFrame(() => {
    props.into.current = props.source.sample(performance.now());
  });
  return null;
}

/**
 * Pointer to a world aim direction.
 *
 * The authority's aim is a world-space vector, so the pointer is cast onto the plane
 * an aimed ball actually travels in — the standing chest line. That is what makes
 * "point at his chest and click" mean what it looks like it means. The direction is
 * reported up rather than the point, because a direction is all the intent frame has
 * a field for, which is also why a client cannot describe a position it did not earn.
 */
function AimTracker(props: {
  read: () => ArenaSample | null;
  aimRef: { current: THREE.Vector3 };
  onAim: (x: number, z: number) => void;
}) {
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const plane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 1, 0), -AIM_PLANE_Y),
    [],
  );
  const hit = useMemo(() => new THREE.Vector3(), []);
  const { camera, pointer } = useThree();

  useFrame(() => {
    const sample = props.read();
    if (!sample) return;
    raycaster.setFromCamera(pointer, camera);
    if (!raycaster.ray.intersectPlane(plane, hit)) return;
    props.aimRef.current.copy(hit);
    const dx = hit.x - sample.self.x;
    const dz = hit.z - sample.self.z;
    // Below this the pointer is inside the player's own body and the direction is
    // noise; the last good aim keeps standing, exactly as the duel does.
    if (Math.hypot(dx, dz) > 0.35) props.onAim(dx, dz);
  });

  return null;
}

/**
 * The camera, which is the traversal camera, which is the boss duel's camera.
 *
 * NOTHING HERE IS A SECOND CAMERA. Every pose comes out of the duel's own
 * `desiredCamera` and every approach rate out of its `cameraFollowRate`, for the same
 * reason the props and the ball treatments are imported rather than reinvented: a
 * player should not have to re-learn how they see their own character between running
 * a route and fighting at the end of it.
 *
 * The engagement pose is over-the-shoulder at 4.9 m back, 2.62 m up, 0.72 m outboard.
 * THE HEIGHT IS LOAD-BEARING AND IS NOT TOUCHED. The balls are slow and dodgeable
 * because they can be seen, and a low camera hides the one coming at you; that height
 * and the mark each ball casts on the cobbles are between them the whole reason a duel
 * is a fight rather than a coin flip.
 *
 * The single exception — what the camera does while a question is open — is decided in
 * `arenaCamera.ts`, where it can be read and tested on its own.
 */
function ArenaCamera(props: {
  read: () => ArenaSample | null;
  reducedMotion: boolean;
  onCameraYaw: (yaw: number) => void;
}) {
  const position = useRef(new THREE.Vector3(0, 3, -14));
  const target = useRef(new THREE.Vector3(0, 1.2, 0));
  const fov = useRef(40);
  const aimYaw = useRef(0);
  const started = useRef(false);
  // The last opponent pose the server was willing to place. See below.
  const lastOpponent = useRef<ActorPose | null>(null);

  useFrame(({ camera }, delta) => {
    const sample = props.read();
    if (!sample) return;

    const settled = answeringCameraSettles(sample.phase);
    // The chase camera sits behind the body's own facing, smoothed so a flick of the
    // pointer does not whip the whole frame, and reported up so movement stays
    // camera-relative like every other mode.
    if (!settled) {
      aimYaw.current = approach(
        aimYaw.current,
        sample.self.yaw,
        props.reducedMotion ? 5 : 9,
        delta,
      );
    }
    props.onCameraYaw(aimYaw.current);

    // A CULLED OPPONENT IS A STATE, NOT A GAP. The snapshot stops carrying a position
    // once cover breaks the sight line, so a camera that frames both bodies will
    // sometimes have one. The framing axis holds the last position the server was
    // willing to place — which is exactly what the rest of the renderer draws, as a
    // fading sighting — rather than collapsing onto the player and spinning the frame
    // to a default bearing. Before any sighting at all, the player's own facing is the
    // axis, which is the face-off bearing anyway.
    if (sample.opponent.kind !== "UNPLACED") lastOpponent.current = sample.opponent.pose;
    const opponentPose = lastOpponent.current ?? {
      ...sample.self,
      x: sample.self.x + Math.sin(sample.self.yaw),
      z: sample.self.z + Math.cos(sample.self.yaw),
    };

    const wanted = desiredCamera({
      phase: cameraPhaseFor(sample.phase),
      faceOffProgress:
        sample.phase === "FACE_OFF"
          ? Math.min(1, sample.faceOffElapsedS / FACE_OFF_SECONDS)
          : 1,
      player: sample.self,
      opponent: opponentPose,
      aimYaw: aimYaw.current,
      playerDowned: sample.selfReadout.health <= 0,
      reducedMotion: props.reducedMotion,
      inspect: null,
    });

    // The RATE still comes from the real phase. Nobody is steering while a question is
    // open, so the camera should settle rather than track.
    const rate = props.reducedMotion ? 9 : cameraFollowRate(sample.phase);
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

export interface ArenaStageProps {
  readonly source: ArenaSource;
  readonly reducedMotion: boolean;
  readonly onAim: (x: number, z: number) => void;
  readonly onCameraYaw: (yaw: number) => void;
}

export function ArenaStage(props: ArenaStageProps) {
  const sample = useRef<ArenaSample | null>(null);
  const aimRef = useRef(new THREE.Vector3(0, AIM_PLANE_Y, 0));
  const read = useCallback(() => sample.current, []);

  const readSelf = useCallback((): ArenaActorFrame | null => {
    const current = sample.current;
    if (!current) return null;
    return {
      pose: current.self,
      visual: {
        phase: current.phase,
        faceOffElapsedS: current.faceOffElapsedS,
        tick: current.tick,
        downed: current.selfReadout.health <= 0,
        crouched: current.self.crouched,
        speedMps: current.self.speedMps,
        travelOffFacing: current.self.travelOffFacing,
        dashing: current.selfReadout.dashing,
        lastFireTick: current.cues.SELF.lastFireTick,
        lastHitTick: current.cues.SELF.lastHitTick,
      },
      opacity: 1,
    };
  }, []);

  const readOpponent = useCallback((): ArenaActorFrame | null => {
    const current = sample.current;
    if (!current) return null;
    const sighting = current.opponent;
    // No usable position means no body. Never a stand-in at the origin, and never a
    // NaN transform: a projection that stops carrying a position must read as an
    // absence rather than as a fighter standing in the middle of the yard.
    if (sighting.kind === "UNPLACED") return null;
    const opacity =
      sighting.kind === "LAST_SEEN" ? staleBodyOpacity(sighting.ageS) : 1;
    if (opacity <= 0) return null;
    return {
      pose: sighting.pose,
      visual: {
        phase: current.phase,
        faceOffElapsedS: current.faceOffElapsedS,
        tick: current.tick,
        downed: sighting.health <= 0,
        crouched: sighting.pose.crouched,
        speedMps: sighting.pose.speedMps,
        travelOffFacing: sighting.pose.travelOffFacing,
        // The projection carries no dash for the opponent, and inferring one from two
        // positions would be a guess about a mechanic. So their roll is not animated,
        // which is a missing flourish rather than missing information: the burst is
        // visible in the movement itself.
        dashing: false,
        lastFireTick: current.cues.OPPONENT.lastFireTick,
        lastHitTick: current.cues.OPPONENT.lastHitTick,
      },
      opacity,
    };
  }, []);

  return (
    <Canvas
      className="pvp-canvas"
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={[1, 1.75]}
      camera={{ fov: 40, near: 0.1, far: 90, position: [0, 3, -14] }}
      gl={{
        antialias: true,
        powerPreference: "high-performance",
        toneMappingExposure: 1.05,
      }}
    >
      <Sampler source={props.source} into={sample} />
      <AimTracker read={read} aimRef={aimRef} onAim={props.onAim} />
      <ArenaCamera
        read={read}
        reducedMotion={props.reducedMotion}
        onCameraYaw={props.onCameraYaw}
      />
      <Suspense fallback={null}>
        <ArenaScenery />
        <ArenaBodyShadows read={read} />
        <ArenaActor glbKey={PLAYER_RIG} label="self" read={readSelf} />
        <ArenaActor glbKey={OPPONENT_RIG} label="opponent" read={readOpponent} />
        <ArenaBalls read={read} />
        <ArenaMuzzleFlashes read={read} />
        <ArenaHitFlashes read={read} />
        <ArenaLastSeenMark read={read} />
        <ArenaDodgeReadiness read={read} />
        <ArenaAimMark read={read} aim={aimRef} />
      </Suspense>
    </Canvas>
  );
}
