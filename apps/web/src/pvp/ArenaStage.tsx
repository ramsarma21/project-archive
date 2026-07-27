import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { referenceArena } from "@pa/duel";
import {
  LOOK_TUNING,
  chaseCameraPosition,
  chaseFocus,
  type CollisionWorld,
} from "@pa/engine-world";
import { PLAYER_RIG } from "../duel/m1Duel.js";
import { AIM_PLANE_Y, approach } from "../duel/duelCamera.js";
import {
  aimGroundPoint,
  attachPvpLook,
  clearChaseDistance,
  drainLook,
  lookAim,
  seedLookFromAim,
  type PvpLookController,
  type PvpLookState,
} from "./pvpLook.js";
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
import {
  staleBodyOpacity,
  type ArenaSample,
  type ArenaSource,
  type OpponentSighting,
} from "./arenaFeed.js";

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
 * Bind the player's look to the canvas — the ONLY place a pointer is captured.
 *
 * On the canvas element, so a click on the HUD is not a request to capture the mouse,
 * and torn down on unmount so no listener outlives the match. The `enabled` prop is
 * driven by the phase: a question disables collection and drops the pointer lock so
 * the player can reach the answer box, and re-enables without replaying travel.
 */
function LookCapture(props: { look: PvpLookState; enabled: boolean }) {
  const gl = useThree((state) => state.gl);
  const controllerRef = useRef<PvpLookController | null>(null);
  const enabledRef = useRef(props.enabled);
  enabledRef.current = props.enabled;

  // ATTACH IN AN EFFECT, NOT IN RENDER. `attachPvpLook` adds document/window listeners,
  // so calling it from a useMemo — which runs during render — leaks a listener set every
  // time React discards a render (StrictMode's double invoke, a thrown-away memo), with
  // no symmetric teardown. An effect has one: exactly one attach per commit and one
  // detach per teardown, so a StrictMode mount/unmount/remount ends with a single
  // listener set, no duplicated mouse deltas, and no owned pointer lock left behind.
  useEffect(() => {
    const controller = attachPvpLook(
      props.look,
      gl.domElement as unknown as HTMLElement,
    );
    controller.setEnabled(enabledRef.current);
    controllerRef.current = controller;
    return () => {
      controller.detach();
      controllerRef.current = null;
    };
  }, [gl, props.look]);

  useEffect(() => {
    controllerRef.current?.setEnabled(props.enabled);
  }, [props.enabled]);
  return null;
}

/**
 * Bind gameplay pointer input to the canvas — the one place PvP captures a pointer.
 *
 * The session owns the input controller; this is the only layer with the canvas, so
 * it wires the two together and returns the detach so the listeners live exactly as
 * long as the canvas does.
 */
function InputCapture(props: { bindInput: (canvas: HTMLElement) => () => void }) {
  const gl = useThree((state) => state.gl);
  useEffect(
    () => props.bindInput(gl.domElement as unknown as HTMLElement),
    [gl, props.bindInput],
  );
  return null;
}

/**
 * Report the DELAYED opponent sighting to the DOM HUD, so the "sight line broken"
 * banner and the drawn body agree on when the opponent is out of sight.
 *
 * The banner used to read the newest raw snapshot, which flips the instant the server
 * says the line broke — while the body, drawn from the delayed presentation sample, is
 * still standing in the open for a render delay longer. Both must read the ONE delayed
 * sample. This reads the same sample the actor does and reports the sighting KIND up
 * only when it changes, so a per-frame value drives React state without a per-frame
 * re-render.
 */
function OpponentSightingReporter(props: {
  read: () => ArenaSample | null;
  onOpponentSighting: (kind: OpponentSighting["kind"]) => void;
}) {
  const last = useRef<OpponentSighting["kind"] | null>(null);
  useFrame(() => {
    const sample = props.read();
    if (!sample) return;
    const kind = sample.opponent.kind;
    if (kind !== last.current) {
      last.current = kind;
      props.onOpponentSighting(kind);
    }
  });
  return null;
}

/**
 * The ONE place the look is drained per frame.
 *
 * Draining here, before the camera and before the movement basis read the yaw, is
 * what makes camera, movement and aim agree on a single value within a frame — the
 * property that keeps them from disagreeing by one mouse event's worth of yaw. The
 * look is seeded once from the authoritative aim, then owned by the mouse. Aim and
 * camera yaw are reported upward; NOTHING downstream writes back into the look, which
 * is the whole of why the strafe can no longer precess the frame.
 */
function LookFrame(props: {
  look: PvpLookState;
  read: () => ArenaSample | null;
  aimRef: { current: THREE.Vector3 };
  bounds: CollisionWorld["bounds"];
  onAim: (x: number, z: number) => void;
  onCameraYaw: (yaw: number) => void;
}) {
  useFrame(() => {
    const sample = props.read();
    if (sample) {
      seedLookFromAim(props.look, Math.sin(sample.self.yaw), Math.cos(sample.self.yaw));
    }
    const look = drainLook(props.look);
    props.onCameraYaw(look.yaw);
    const aim = lookAim(props.look);
    props.onAim(aim.x, aim.z);
    if (sample) {
      // The reticle mark uses the ONE shared ground-point convention — clamped reach,
      // arena bounds, normalized aim — that the projectile marks use too.
      const ground = aimGroundPoint({ x: sample.self.x, z: sample.self.z }, aim, props.bounds);
      props.aimRef.current.set(ground.x, AIM_PLANE_Y, ground.z);
    }
  });
  return null;
}

/**
 * A mission-style orbit camera, placed FROM the player's look and from nothing else.
 *
 * No body-yaw follow and no recenter: the camera orbits where the mouse points, so it
 * cannot chase the body's facing and it cannot be part of the feedback loop that made
 * the frame precess. Pitch is clamped by the look primitive; the camera-to-focus
 * segment is tested against the arena so it never sits inside a chimney or a parapet,
 * pulling IN immediately when something intrudes and easing back OUT only once the
 * line is clear again. The look owns the yaw, so there is no shortest-angle turn to
 * make on a phase transition — there is no angle to interpolate at all.
 */
function OrbitCamera(props: {
  look: PvpLookState;
  read: () => ArenaSample | null;
  reducedMotion: boolean;
  world: CollisionWorld;
}) {
  const distance = useRef<number>(LOOK_TUNING.chaseDistanceM);
  const camPos = useRef(new THREE.Vector3());
  const focusV = useRef(new THREE.Vector3());

  useFrame(({ camera }, delta) => {
    const sample = props.read();
    if (!sample) return;
    // Already drained by `LookFrame`, which is mounted before this component.
    const look = props.look.look;
    const focus = chaseFocus({ x: sample.self.x, y: sample.self.y, z: sample.self.z });

    // A VERIFIED-clear distance, never the unchecked 0.85m fallback.
    const clear = clearChaseDistance(props.world, look, focus);
    if (clear < distance.current) {
      distance.current = clear; // pull in immediately: never clip through geometry
    } else {
      // Ease back out only once the line is clear, so the camera does not snap away
      // from the player the instant they clear a corner.
      distance.current = approach(distance.current, clear, props.reducedMotion ? 6 : 10, delta);
    }

    const pos = chaseCameraPosition(look, focus, distance.current);
    camPos.current.set(pos.x, pos.y, pos.z);
    focusV.current.set(focus.x, focus.y, focus.z);
    camera.position.copy(camPos.current);
    camera.lookAt(focusV.current);
  });

  return null;
}

export interface ArenaStageProps {
  readonly source: ArenaSource;
  readonly reducedMotion: boolean;
  /** The player's look, owned by the caller so it survives a re-render and drives input. */
  readonly look: PvpLookState;
  /** Whether look collection is on. False while a question is open. */
  readonly lookEnabled: boolean;
  /** Binds gameplay pointer input to the canvas; returns the detach. */
  readonly bindInput: (canvas: HTMLElement) => () => void;
  readonly onAim: (x: number, z: number) => void;
  readonly onCameraYaw: (yaw: number) => void;
  /**
   * The delayed opponent sighting, reported up when it changes, so the DOM banner reads
   * the same presentation sample the drawn body does rather than the newest raw snapshot.
   */
  readonly onOpponentSighting?: (kind: OpponentSighting["kind"]) => void;
}

export function ArenaStage(props: ArenaStageProps) {
  const sample = useRef<ArenaSample | null>(null);
  const aimRef = useRef(new THREE.Vector3(0, AIM_PLANE_Y, 0));
  const read = useCallback(() => sample.current, []);
  const world = useMemo<CollisionWorld>(() => referenceArena().world, []);

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
        // Snapshot-backed now: the projection carries the opponent's dash (LOS-gated,
        // frozen when unseen), so the roll animates from an observation rather than a
        // guess about a mechanic.
        dashing: sighting.dashing,
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
      {props.onOpponentSighting && (
        <OpponentSightingReporter read={read} onOpponentSighting={props.onOpponentSighting} />
      )}
      <LookCapture look={props.look} enabled={props.lookEnabled} />
      <InputCapture bindInput={props.bindInput} />
      <LookFrame
        look={props.look}
        read={read}
        aimRef={aimRef}
        bounds={world.bounds}
        onAim={props.onAim}
        onCameraYaw={props.onCameraYaw}
      />
      <OrbitCamera
        look={props.look}
        read={read}
        reducedMotion={props.reducedMotion}
        world={world}
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
