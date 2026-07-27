import { Suspense, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type RootState } from "@react-three/fiber";
import {
  AIRBORNE_VISUAL_TUNING,
  FIELD_DT,
  LANDING_CLIP,
  LANDING_RECOVERY_TICKS,
  LOOK_TUNING,
  OFFICER_CLIP_SPEC,
  PARKOUR_TUNING,
  PLAYER_ACTION_CLIPS,
  PLAYER_CLIP_SPEC,
  RiggedCharacter,
  STAND_HEIGHT,
  STEALTH_TUNING,
  VERB_CLIP,
  chaseCameraDistance,
  chaseCameraPosition,
  chaseFocus,
  clipStartSeconds,
  lookForward,
  lookMoveIntent,
  playerClipFor,
  registerCharacterClips,
  segmentOccluderIds,
  strideTimeScale,
  verbTimeScale,
} from "@pa/engine-world";
import {
  VisorHolds,
  VisorRunMark,
  VisorThrowAim,
  type HoldsRead,
  type OfferRead,
  type RunMarkRead,
  type ThrowAimRead,
} from "../visor/index.js";
import { affordanceRead, teachable, verbCaption } from "./affordance.js";
import { MISSION_EXPOSURE, dawnSky } from "./dawn.js";
import {
  cinematicActive,
  cinematicEase,
  encounterActorDirective,
  encounterConversationShot,
  speakingGesture,
  type CinePose,
} from "./encounterCinematic.js";
import type { MissionCivilian, MissionWatcherCast } from "./levelPort.js";
import type { MissionInputState } from "./missionInput.js";
import {
  attachMissionLook,
  drainLook,
  type MissionLookState,
} from "./missionLook.js";
import type { MissionTraversalOutcome } from "./result.js";
import {
  THROW_CLIP_TICKS,
  encounterCinematicRead,
  markRead,
  missionCrowdParity,
  missionPresentation,
  missionRenderPose,
  missionThrowCue,
  missionThrowing,
  standingObjective,
  stepMissionRuntime,
  stepMissionThrowAim,
  throwRefusalMessage,
  type MissionPresentation,
  type MissionRuntime,
} from "./traversal.js";

/** The live pose of one watcher by id, in the cinematic module's plain shape. */
function watcherCinePose(runtime: MissionRuntime, id: string): CinePose | null {
  const pose = runtime.watcherPoses.find((w) => w.id === id);
  if (!pose) return null;
  const yaw =
    runtime.watcherFacings.find((facing) => facing.id === id)?.yaw ?? pose.baseYaw;
  return { x: pose.position.x, y: pose.position.y, z: pose.position.z, yaw };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Pull a desired camera point in toward the look target until the segment
 * between them is clear of world geometry — the same discipline the chase
 * camera uses against chimneys, applied to the conversation shot so it cannot
 * sit inside a market stall or awning. Marches from the desired point toward the
 * target and takes the first clear candidate; falls back to a point close to the
 * target (which is out in the open between the two figures) if none is clear.
 */
function clearCameraPoint(
  world: MissionRuntime["instance"]["world"],
  target: { x: number; y: number; z: number },
  desired: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  if (segmentOccluderIds(world, target, desired).length === 0) return desired;
  let fallback = desired;
  for (let t = 0.18; t <= 0.86; t += 0.17) {
    const candidate = {
      x: lerp(desired.x, target.x, t),
      y: lerp(desired.y, target.y, t),
      z: lerp(desired.z, target.z, t),
    };
    fallback = candidate;
    if (segmentOccluderIds(world, target, candidate).length === 0) return candidate;
  }
  return fallback;
}

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
 * The throw performance, played over locomotion for its window.
 *
 * The clip was authored upper-body-weighted so it could be layered additively
 * over a run — "the player never stops to throw". There is no additive layer on
 * this rig yet, so for now it replaces the locomotion clip for its 450ms, which
 * does momentarily plant a sprinting player. That is a visible compromise and
 * it is the right one against the alternative, which is the verb having no tell
 * at all: the object it throws has no GLB and so is not drawn, leaving the
 * player with nothing but a HUD counter to tell them the key did anything.
 */
const THROW_CLIP = "throwLight";

/**
 * Mixer timeScale for the clip currently playing.
 *
 * EVERY LOOKUP HERE IS ON THE CLIP THE RIG WILL ACTUALLY PLAY, not on the clip
 * the flow controller asked for. Those differ for the two names this rig does
 * not carry: a `dash` and a `stepUp` are both answered with `run`. Timing the
 * requested name found no measurement for either and played the run cycle at
 * 1.0 — under a body bursting at 6.7 m/s, which skates — so the fix that made
 * the fallbacks reach the mixer needs this one beside it to make them reach the
 * clock as well.
 *
 * Three cases remain, and they are genuinely different problems.
 *
 * LOCOMOTION is stride-matched: a cycle authored at one ground speed and driven
 * at another slides its feet, and `strideTimeScale` is the ratio that removes
 * it. See CLIP_AUTHORED_SPEED_MPS, whose numbers were re-measured because the
 * old ones had the run cycle at nearly twice the cadence the body was moving at.
 *
 * ONE-SHOT PERFORMANCES are Mixamo takes several times longer than the beat
 * they have to cover, and are fitted by `verbTimeScale` — content length, not
 * file length, over the slower of the mechanical window and the contract's
 * target, capped so the physics cannot overrule the animation without limit.
 *
 * AIRBORNE clips have their own published numbers and are neither.
 *
 * The landing branch is asked LAST and by landing kind rather than by clip
 * name, because `stepFlow` sets the verb to NONE on the very tick it resolves a
 * landing: a landing clip never matches the verb branch, which is how landings
 * used to fall all the way through to a stride match that had nothing to say
 * about them and played them at 1.0.
 */
function clipTimeScale(runtime: MissionRuntime, requested: string): number {
  const clip = playerClipFor(requested);
  if (clip === "jump") return AIRBORNE_VISUAL_TUNING.standingTimeScale;
  if (clip === "runJump") return AIRBORNE_VISUAL_TUNING.runningTimeScale;
  if (clip === THROW_CLIP) {
    return verbTimeScale(clip, THROW_CLIP_TICKS * FIELD_DT * 1000) ?? 1;
  }

  const verb = runtime.flow.verb;
  if (verb !== "NONE" && playerClipFor(VERB_CLIP[verb]) === clip) {
    const fitted = verbTimeScale(clip, PARKOUR_TUNING.durationsMs[verb]);
    if (fitted !== null) return fitted;
  }

  // A landing owns the body for `landingTicks`, and while it does, `flow.clip`
  // is the landing's. Asking the landing rather than the clip name keeps the two
  // in step even if a landing kind is ever pointed at a different performance.
  const landing = runtime.flow.landing;
  if (runtime.flow.landingTicks > 0 && playerClipFor(LANDING_CLIP[landing]) === clip) {
    const fitted = verbTimeScale(
      clip,
      LANDING_RECOVERY_TICKS[landing] * FIELD_DT * 1000,
    );
    if (fitted !== null) return fitted;
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
  lookState: MissionLookState;
  reducedMotion: boolean;
  paused: boolean;
  onResolved: (outcome: MissionTraversalOutcome) => void;
  onSample: (presentation: MissionPresentation) => void;
}) {
  const reported = useRef(false);
  const sampledAt = useRef(-1);
  const auditedAt = useRef(-1);

  useFrame((_state, delta) => {
    const { runtime, input } = props;
    // Intent is relative to WHERE THE PLAYER IS LOOKING, which is an input, and
    // deliberately not to where the camera physically is, which is an output.
    //
    // Those were the same thing until now, and that identity was the bug. The
    // camera was placed behind the body's facing; the body's facing chases the
    // direction it is travelling; and the direction it travels was resolved
    // against the camera. Holding one strafe key therefore drove its own basis
    // round in a circle — 442 degrees in 3.6 seconds, measured — which is the
    // "camera moves randomly when moving" the owner reported.
    //
    // Draining the mouse here, once, is what makes the look a single value for
    // the whole frame: this basis and the camera placed later in the same frame
    // read the identical yaw, so they cannot disagree by one mouse event.
    const look = drainLook(props.lookState);
    const move = lookMoveIntent(look.yaw, input.forward, input.right);

    const step = stepMissionRuntime(runtime, {
      dtS: delta,
      moveX: move.x,
      moveZ: move.z,
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

    // A perspective encounter that owns input or locks the player drops any
    // buffered one-shot, so a jump, dash or strike pressed just before the stop
    // cannot fire on release. The simulation already ignores them for the ticks
    // it runs locked; this clears the browser-side latch the sim cannot reach.
    if (runtime.encounterOwnsInput || runtime.encounterLocked) {
      input.jumpBuffered = false;
      input.dashBuffered = false;
      input.strikeBuffered = false;
    }

    // The throw is aim-and-release. Aimed down the LOOK, not the body's facing:
    // the body turns to face where it travels, so aiming off it would throw the
    // bottle sideways whenever the player strafed, and "somewhere I am not" is
    // the entire point of the verb. The distance is clamped short of the tuned
    // maximum to the band where the arc spends its flight near body height —
    // where a civilian can block it and the throw is a skill rather than a
    // button.
    const range = Math.min(STEALTH_TUNING.throwMaxRangeM, 8);
    const forward = lookForward(look.yaw);
    const aimPoint = {
      x: runtime.motion.pos.x + forward.x * range,
      y: runtime.motion.pos.y,
      z: runtime.motion.pos.z + forward.z * range,
    };
    // The one place the throw's aim is advanced. It latches the aim while the key
    // is held, throws the latched target on release, drops everything and spends
    // nothing while a UI surface owns input, and holds a refusal on screen for a
    // deterministic window. The cue it writes is drawn by <VisorThrowAim>, read
    // purely off the runtime. See `stepMissionThrowAim`.
    // The encounter freezes the throw the same way the abandon modal does: no
    // aim opens, and a release cannot fire, while a question is up.
    stepMissionThrowAim(runtime, input, aimPoint, {
      uiOwnsInput: props.paused || runtime.encounterOwnsInput,
    });

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
 * The watch, as bodies.
 *
 * These men existed in every layer of the simulation except this one. The level
 * authored seven of them with a rig, a height, a cone and a beat of patrol each;
 * the stealth field resolved sight lines from their eyes sixty times a second;
 * the visor briefing drew all seven as holograms and named them. Nothing put one
 * on the street. A player asked to evade seven constables was asked to evade a
 * number in the corner of the screen, which is why "is anyone chasing me" was
 * not a question the game could answer by being looked at.
 *
 * THE POSE IS THE SIMULATION'S, WITHOUT INTERPRETATION. `runtime.watcherPoses`
 * is the exact array handed to `stepStealthField` on the last fixed step, and
 * the yaw is the cone's own facing off `runtime.watcherFacings`. So the man you
 * can see is standing where the thing that can see you is standing, and looking
 * where it is looking. Any second opinion here would be a tell that lies, and a
 * stealth game whose tells lie is worse than one with no tells.
 *
 * The clip is measured rather than declared, for the same reason: how fast this
 * body is actually crossing the ground, frame over frame. A man on his authored
 * beat walks, a man closing on a last-known position runs, a posted sentry
 * stands — and none of that has to be kept in step with the pursuit's phases by
 * hand.
 */
const WATCH_WALK_MPS = 0.35;
const WATCH_RUN_MPS = 2.4;

/**
 * Clips a watcher plays once and clamps rather than looping. `draw` is the
 * wrong-answer reaction — he draws and holds the pose while the camera pulls
 * back — so it must not loop back to a holstered stance.
 */
const WATCH_ACTION_CLIPS: ReadonlySet<string> = new Set([
  "draw",
  "hitReaction",
  "death",
]);

function MissionWatch(props: { runtime: MissionRuntime; reducedMotion: boolean }) {
  const cast: readonly MissionWatcherCast[] =
    props.runtime.instance.watcherCast ?? NO_WATCH;
  const groups = useRef(new Map<string, THREE.Group>());
  const previous = useRef(new Map<string, { x: number; z: number }>());
  // One mutable box per watcher, so the mixer's rate is written every frame
  // without any of it costing a React render. The same arrangement the player
  // rig uses, and the same reason: a stride matched per frame to the ground
  // speed is what stops a walk cycle skating.
  const rates = useRef(new Map<string, { current: number }>());
  const [clips, setClips] = useState<Readonly<Record<string, string>>>({});
  const clipsRef = useRef<Record<string, string>>({});
  // Elapsed presentation time for the speaking gesture. Not a sim clock: the
  // gesture is cosmetic, so wall-frame time is exactly right for it.
  const gestureTime = useRef(0);

  const rateFor = (id: string) => {
    let box = rates.current.get(id);
    if (!box) {
      box = { current: 1 };
      rates.current.set(id, box);
    }
    return box;
  };

  useEffect(() => {
    for (const member of cast) {
      registerCharacterClips(member.rigKey, OFFICER_CLIP_SPEC);
    }
  }, [cast]);

  useFrame((_, delta) => {
    gestureTime.current += delta;
    // The active stop, if any: its speaker/secondary get a scripted performance
    // (stand and speak, or draw on a wrong answer) layered over the ordinary
    // speed-based clip selection. Every other watcher is untouched.
    const read = encounterCinematicRead(props.runtime);
    let changed = false;
    for (const pose of props.runtime.watcherPoses) {
      const node = groups.current.get(pose.id);
      if (!node) continue;
      node.position.set(pose.position.x, pose.position.y, pose.position.z);
      node.rotation.x = 0;
      node.rotation.y =
        props.runtime.watcherFacings.find((facing) => facing.id === pose.id)
          ?.yaw ?? pose.baseYaw;

      const was = previous.current.get(pose.id);
      previous.current.set(pose.id, { x: pose.position.x, z: pose.position.z });
      // Frame delta rather than the fixed step: several fixed steps can land in
      // one frame, and the question here is only "how fast does this look".
      const mps =
        was && delta > 0
          ? Math.hypot(pose.position.x - was.x, pose.position.z - was.z) / delta
          : 0;
      const speedClip =
        mps >= WATCH_RUN_MPS ? "run" : mps >= WATCH_WALK_MPS ? "walk" : "idle";

      const role =
        read === null
          ? null
          : pose.id === read.speakerId
            ? "SPEAKER"
            : pose.id === read.secondaryId
              ? "SECONDARY"
              : null;
      const directive =
        read && role
          ? encounterActorDirective({
              phase: read.phase,
              verdictKind: read.verdictKind,
              role,
            })
          : null;
      const wanted = directive?.clip ?? speedClip;

      // The drawn officer holds the pose; a spoken idle is stride-matched at 0.
      rateFor(pose.id).current = strideTimeScale(wanted, mps);
      if (clipsRef.current[pose.id] !== wanted) {
        clipsRef.current[pose.id] = wanted;
        changed = true;
      }

      // Restrained procedural speaking (no talk clip on this rig): a gentle
      // lean and bob while the officer is questioning the player.
      if (directive?.gesture) {
        const gesture = speakingGesture(gestureTime.current, props.reducedMotion);
        node.position.y = pose.position.y + gesture.bobY;
        node.rotation.x = gesture.nod;
      }
    }
    if (changed) setClips({ ...clipsRef.current });
  });

  return (
    <>
      {cast.map((member) => {
        const clip = clips[member.id] ?? "idle";
        return (
          <group
            key={member.id}
            ref={(node) => {
              if (node) groups.current.set(member.id, node);
              else groups.current.delete(member.id);
            }}
          >
            <RiggedCharacter
              glbKey={member.rigKey}
              height={member.capsuleHeight}
              clip={clip}
              loopOnce={WATCH_ACTION_CLIPS.has(clip)}
              timeScaleRef={rateFor(member.id)}
              distanceAnimThrottle
              cullBeyondM={props.reducedMotion ? 34 : 52}
              castShadow
              showFallback={false}
            />
          </group>
        );
      })}
    </>
  );
}

/** Shared so a level with no cast keeps a stable identity across renders. */
const NO_WATCH: readonly MissionWatcherCast[] = [];

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
      {/* The shadow frustum is fitted and follows the player, which it did not.
          A default directional light shadows an orthographic box ten metres
          across, centred on a target at the world origin — so over a hundred and
          twenty metres of Boston the only thing that could ever have cast a
          shadow was whatever happened to be standing at (0,0,0), and the one
          depth pass a frame was being spent on nothing. Forty-eight metres is
          about twice the fogged view distance, which is as far as a shadow can
          be seen to matter. */}
      <directionalLight
        ref={sun}
        color={opening.sunColour}
        intensity={opening.sunIntensity}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0006}
        shadow-normalBias={0.035}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={24}
        shadow-camera-bottom={-24}
        shadow-camera-near={1}
        shadow-camera-far={130}
      />
    </>
  );
}

/**
 * The tone curve, held against R3F.
 *
 * This is the single change that decides whether the mission is playable, and it
 * cannot be made through the canvas. three's ACES filmic fit evaluates its
 * numerator as `x(x + 0.0245786) - 0.000090537`, which is negative below 0.00325
 * linear and clamps — so ACES does not darken the bottom of the range, it CLIPS
 * it to black. Everything in a pre-dawn street lives down there. Khronos PBR
 * Neutral is linear through the low end and only rolls off highlights, which
 * turns the same radiance into a picture: a mid wall at full dark reads 0.12
 * under Neutral and 0.02 under ACES, a factor of six for free.
 *
 * Asserted from inside the loop rather than set once, because R3F's `configure`
 * writes `toneMapping` itself — ACES, or none when `flat` — every time the canvas
 * is reconfigured, which includes every resize. Setting it in `onCreated` worked
 * until the window changed size and then silently stopped. One integer compare a
 * frame is the cheapest way to make a display decision actually stick.
 */
function ToneCurve(props: { onStage?: (state: RootState) => void }) {
  const reported = useRef(false);
  useFrame((state) => {
    const { gl } = state;
    if (gl.toneMapping !== THREE.NeutralToneMapping) {
      gl.toneMapping = THREE.NeutralToneMapping;
    }
    if (gl.toneMappingExposure !== MISSION_EXPOSURE) {
      gl.toneMappingExposure = MISSION_EXPOSURE;
    }
    if (!reported.current && props.onStage) {
      reported.current = true;
      props.onStage(state);
    }
  });
  return null;
}

/**
 * The level's art, given the clock.
 *
 * The dawn read changes on every fixed step and the scenery is the most
 * expensive subtree on the stage, so handing it a fresh object sixty times a
 * second would re-render the whole city to move a number in the fourth decimal.
 * It is resampled on the same `SKY_STEP` the sky uses, which over three minutes
 * is a few hundred renders of a memoised component rather than eleven thousand.
 */
function SceneryMount(props: {
  Scenery: NonNullable<MissionRuntime["instance"]["Scenery"]>;
  reducedMotion: boolean;
  runtime: MissionRuntime;
}) {
  const [dawn, setDawn] = useState(() => props.runtime.dawn);
  const sampledLift = useRef(props.runtime.dawn.lift01);

  useFrame(() => {
    const live = props.runtime.dawn;
    if (Math.abs(live.lift01 - sampledLift.current) < SKY_STEP) return;
    sampledLift.current = live.lift01;
    setDawn(live);
  });

  const { Scenery } = props;
  return <Scenery reducedMotion={props.reducedMotion} dawn={dawn} />;
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
    const { flow } = props.runtime;
    // Drawn between the two fixed steps that bracket this frame rather than at
    // the latest one. The simulation is 60Hz and the display is not, so reading
    // the tick directly shows the same position for two frames of a 144Hz
    // display and then moves two steps at once — a judder that reads as the
    // movement being loose rather than as a frame-rate artifact. Presentation
    // only: `motion.pos` remains what every simulation term is computed from.
    const pose = missionRenderPose(props.runtime);
    node.position.set(pose.x, pose.y, pose.z);
    node.rotation.y = pose.yaw;
    timeScaleRef.current = clipTimeScale(props.runtime, clipRef.current);
    // The throw outranks locomotion for its window; every other clip is the
    // flow controller's, which is the only thing that knows what verb is
    // running. A traversal verb outranks the throw in turn, because a vault is
    // a whole-body commitment and cannot be overpainted by an arm swing.
    const wanted =
      missionThrowing(props.runtime) && props.runtime.flow.verb === "NONE"
        ? THROW_CLIP
        : flow.clip;
    if (wanted !== clipRef.current) {
      clipRef.current = wanted;
      setClip(wanted);
    }
  });

  return (
    <group ref={group}>
      <RiggedCharacter
        glbKey={PLAYER_RIG}
        height={STAND_HEIGHT}
        clip={clip}
        // Start on the performance rather than on the take's held first pose.
        // Only `leapOfFaithLand` has a lead worth skipping, and it is a big one:
        // 2.5s of lying motionless in front of a 3.7s get-up, which the payoff
        // beat was spending three tenths of its screen time playing.
        timeOffset={clipStartSeconds(playerClipFor(clip))}
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
 * THE ORIENTATION IS THE PLAYER'S AND NOTHING ELSE WRITES IT. The camera is
 * placed from one focus point by the look's yaw and pitch, and aimed back at
 * that same point — so its forward vector IS the look, identically, on every
 * frame. There is no auto-follow term, not a weak one and not a suppressible
 * one: a camera that reorients itself toward the body is fighting a player who
 * is also steering, and on a route with a direction change every few seconds
 * that is a rotation the player did not ask for arriving exactly when they most
 * need the frame to hold still.
 *
 * NOTHING HERE SMOOTHS ROTATION, AND NOTHING SMOOTHS HORIZONTAL POSITION.
 * Smoothing an aim is input latency wearing a nicer name, and the previous
 * version's positional lerp was a second, quieter source of swivel: a camera
 * lagging behind its rig position but still aimed at the live player has to
 * rotate to keep the player centred, so translation lag becomes rotation the
 * player did not ask for. Placing it exactly removes that by construction.
 *
 * Two things are eased, both narrow and both for a named discontinuity:
 * the focus HEIGHT, because `stepGrounded` snaps the feet up to 0.35m in a
 * single tick when the player takes a curb and an unfiltered camera would jolt
 * with it; and the pull-out from camera collision. Neither touches yaw.
 *
 * Reduced motion sits further back and tracks HARDER, not softer. The thing to
 * remove is the camera's own independent movement — a lazy camera swings through
 * every turn the player makes, which is precisely the motion being opted out of.
 */
/** Step-up absorption. Fast enough not to trail a fall, slow enough for a curb. */
const FOCUS_EASE_BASE = 0.000002;
/** Past this the change is a drop or a teleport, and trailing it is worse. */
const FOCUS_SNAP_M = 2.5;
/** Camera blend weight past which the conversation shot counts as "in". */
const SHOT_READY_WEIGHT = 0.6;
/**
 * Greatest speaker separation at which the answer may enable, metres. Mirrors the
 * machine's own open gate; the answer dock is refused above it even if the phase
 * somehow read QUESTION, so the assertion "answer disabled until ≤2.2m" holds in
 * the presentation layer as well as the deterministic one.
 */
const ANSWER_MAX_SEPARATION_M = 2.2;

function ChaseCamera(props: {
  runtime: MissionRuntime;
  lookState: MissionLookState;
  reducedMotion: boolean;
}) {
  const focusVec = useRef(new THREE.Vector3());
  // The distance actually in use, so an obstruction can be eased out of rather
  // than snapped away from. Starts at the rig's nominal length.
  const heldDistance = useRef<number>(LOOK_TUNING.chaseDistanceM);
  const heldFocusY = useRef<number>(Number.NaN);
  // How far the camera has eased into the encounter conversation shot, 0..1.
  // Eased every frame toward 1 while a stop is running and back to 0 once it
  // releases, so the hand-over into the cinematic and the return to gameplay are
  // smooth rather than a cut. Presentation only — the simulation never reads it.
  const cineWeight = useRef(0);

  useFrame(({ camera }, delta) => {
    const { runtime } = props;
    // The same interpolated pose the body is drawn at, so the camera is not
    // chasing a position half a tick away from the character on screen.
    const pose = missionRenderPose(runtime);
    const look = props.lookState.look;
    const nominal = props.reducedMotion
      ? LOOK_TUNING.chaseDistanceM + 0.8
      : LOOK_TUNING.chaseDistanceM;

    const focus = chaseFocus(pose);
    if (
      !Number.isFinite(heldFocusY.current) ||
      Math.abs(focus.y - heldFocusY.current) > FOCUS_SNAP_M
    ) {
      heldFocusY.current = focus.y;
    } else {
      const ease = 1 - Math.pow(FOCUS_EASE_BASE, Math.min(delta, 1 / 20));
      heldFocusY.current += (focus.y - heldFocusY.current) * ease;
    }
    focus.y = heldFocusY.current;

    const clear = chaseCameraDistance(
      runtime.instance.world,
      look,
      focus,
      nominal,
    );
    // Pull in the instant geometry demands it and ease back out afterwards.
    // Symmetric easing would let the camera spend a few frames inside a chimney
    // on the way in, which on this route means the player briefly cannot see
    // the jump they are lining up.
    if (clear < heldDistance.current) {
      heldDistance.current = clear;
    } else {
      const ease = 1 - Math.pow(0.02, Math.min(delta, 1 / 20));
      heldDistance.current += (clear - heldDistance.current) * ease;
    }

    const target = chaseCameraPosition(look, focus, heldDistance.current);

    // The encounter conversation shot, eased in and out. The chase placement
    // above is still computed every frame so the camera returns to exactly the
    // gameplay framing the look implies once the stop releases — no snap, and no
    // second camera fighting this one.
    const read = encounterCinematicRead(runtime);
    const active = read !== null && cinematicActive(read.phase);
    cineWeight.current += (Number(active) - cineWeight.current) *
      cinematicEase(props.reducedMotion, delta);
    if (!active && cineWeight.current < 0.002) cineWeight.current = 0;

    // The shot-readiness gate the overlay reads: the conversation shot has eased
    // in AND the speaker is genuinely at conversational separation. Written here
    // because this is the only place that knows the blend weight. It is what
    // keeps the answer dock from enabling while the officer is far or the camera
    // is still handing over — belt-and-braces on top of the machine, which has
    // already refused to reach QUESTION above conversational distance.
    runtime.encounterShotReady =
      read !== null &&
      cinematicActive(read.phase) &&
      cineWeight.current >= SHOT_READY_WEIGHT &&
      read.speakerSeparationM <= ANSWER_MAX_SEPARATION_M;

    let camX = target.x;
    let camY = target.y;
    let camZ = target.z;
    let lookX = focus.x;
    let lookY = focus.y;
    let lookZ = focus.z;
    if (cineWeight.current > 0.002 && read) {
      const speaker = watcherCinePose(runtime, read.speakerId);
      if (speaker) {
        const secondary = read.secondaryId
          ? watcherCinePose(runtime, read.secondaryId)
          : null;
        const shot = encounterConversationShot({
          player: { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw },
          speaker,
          secondary,
          reducedMotion: props.reducedMotion,
        });
        // Keep the shot out of the stalls/awnings that flank the market street.
        const clear = clearCameraPoint(
          runtime.instance.world,
          shot.target,
          shot.position,
        );
        const w = cineWeight.current;
        camX = lerp(camX, clear.x, w);
        camY = lerp(camY, clear.y, w);
        camZ = lerp(camZ, clear.z, w);
        lookX = lerp(lookX, shot.target.x, w);
        lookY = lerp(lookY, shot.target.y, w);
        lookZ = lerp(lookZ, shot.target.z, w);
      }
    }

    camera.position.set(camX, camY, camZ);
    focusVec.current.set(lookX, lookY, lookZ);
    camera.lookAt(focusVec.current);
  });

  return null;
}

/**
 * Binds mouse look to the canvas the renderer actually created.
 *
 * Inside the canvas so R3F hands over the real element and so unmounting the
 * stage is the whole of releasing the pointer — the same property that makes
 * unmounting the whole of stopping the simulation. Binding to `window` instead
 * would capture clicks on the HUD, and a click on "leave the mission" is not a
 * request to hide the cursor.
 */
function MouseLook(props: { lookState: MissionLookState }) {
  const gl = useThree((state) => state.gl);
  const { lookState } = props;
  useEffect(
    () => attachMissionLook(lookState, gl.domElement),
    [gl, lookState],
  );
  return null;
}

/**
 * The objective the standing mark should be on, read off the live runtime.
 *
 * Derived here rather than passed down as state so the mark and the HUD cannot
 * disagree: both go through `standingObjective`, which is the one definition of
 * "the thing to be doing now". A level whose current objective declares no
 * place — a condition rather than a destination — returns null, and the mark
 * draws nothing at all rather than inventing somewhere to point.
 */
function runMarkFor(runtime: MissionRuntime): RunMarkRead | null {
  const standing = standingObjective(runtime);
  if (!standing) return null;
  return markRead(standing.objective, runtime.motion.pos);
}

/**
 * What the catch line draws, read off the live runtime.
 *
 * Composed here for the same reason the mark's read is: the visor is handed
 * finished data and no way to ask the simulation anything, so it cannot grow an
 * opinion about the run. Everything below is derived — the edges from the verb
 * ladder, the offer from `flow.previewVerb` — and none of it is authored.
 */
/**
 * The throw's aim cue, read off the live runtime — the aim while aiming, or a
 * refusal still inside its window. Composed here for the same reason the mark's
 * read is: the canvas is handed finished data and no way to move it. The runtime
 * owns the cue (see `stepMissionThrowAim`); this only maps the refusal reason to
 * a player-facing line.
 */
function throwAimFor(runtime: MissionRuntime): ThrowAimRead | null {
  const cue = missionThrowCue(runtime);
  if (!cue) return null;
  return {
    from: cue.from,
    aim: cue.aim,
    ok: cue.ok,
    restsAt: cue.restsAt,
    radiusM: cue.radiusM,
    samples: cue.samples,
    message: cue.ok ? null : throwRefusalMessage(cue.refusal),
  };
}

function holdsFor(runtime: MissionRuntime): HoldsRead {
  const read = affordanceRead(runtime);
  return { holds: read.holds, strength: read.strength };
}

/**
 * The live offer, per frame.
 *
 * `flow.previewVerb` is the flow controller's own answer to "what would happen
 * if you kept going", recomputed every fixed step from the real probe and, until
 * now, kept only for a dev overlay that was never built. It is the most honest
 * signal in the game about what is about to happen to the player's body, and it
 * was being thrown away sixty times a second.
 */
function offerFor(runtime: MissionRuntime): OfferRead {
  const offered = runtime.flow.previewVerb;
  const speed = Math.hypot(runtime.motion.vel.x, runtime.motion.vel.z);
  // Travelling direction where there is one, body facing where there is not, so
  // a caption raised while the player is easing up to a wall still lands in
  // front of them rather than behind.
  const dirX = speed > 0.35 ? runtime.motion.vel.x / speed : Math.sin(runtime.motion.yaw);
  const dirZ = speed > 0.35 ? runtime.motion.vel.z / speed : Math.cos(runtime.motion.yaw);
  return {
    offered,
    offeredIsNew:
      offered !== "NONE" && teachable(offered) && !runtime.verbsUsed.has(offered),
    caption: verbCaption(offered),
    at: runtime.motion.pos,
    dirX,
    dirZ,
  };
}

export function MissionStage(props: {
  runtime: MissionRuntime;
  input: MissionInputState;
  /**
   * Where the player is looking. Owned by the container so it survives a
   * re-render of the canvas, and mutated in place for the same reason the input
   * state is: a mouse move must not cost a React render.
   */
  lookState: MissionLookState;
  reducedMotion: boolean;
  /** True while a UI surface owns input. The sim keeps integrating; flow stops. */
  paused: boolean;
  onResolved: (outcome: MissionTraversalOutcome) => void;
  onSample: (presentation: MissionPresentation) => void;
  /**
   * Handed the renderer once, on the first frame it draws.
   *
   * The floor harness passes this and nothing else does. A capture script has to
   * be able to ask the renderer what is in the scene — which lights, how many
   * draw calls, which tone curve — and R3F keeps its store off the DOM, so the
   * alternative was inferring the light rig from pixels. The mission itself
   * never sets it, so there is no debug handle on the shipped path.
   */
  onStage?: (state: RootState) => void;
}) {
  const Scenery = props.runtime.instance.Scenery;
  const spawn = props.runtime.instance.spawn;

  // The first frame is drawn before any useFrame runs, so the opening camera is
  // placed from the same rig the loop will use. Computed rather than restated:
  // the old literal offset drifted from the chase camera it was meant to match.
  const opening = chaseCameraPosition(
    props.lookState.look,
    chaseFocus(spawn.pos),
  );

  return (
    <Canvas
      className="msn-canvas"
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={[1, 1.75]}
      camera={{
        fov: 52,
        near: 0.1,
        far: 240,
        position: [opening.x, opening.y, opening.z],
      }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      <ToneCurve onStage={props.onStage} />
      <DawnSky runtime={props.runtime} />

      <MissionDriver
        runtime={props.runtime}
        input={props.input}
        lookState={props.lookState}
        reducedMotion={props.reducedMotion}
        paused={props.paused}
        onResolved={props.onResolved}
        onSample={props.onSample}
      />
      <ChaseCamera
        runtime={props.runtime}
        lookState={props.lookState}
        reducedMotion={props.reducedMotion}
      />
      <MouseLook lookState={props.lookState} />

      {/* Suspense per subtree so a slow level asset cannot hold up the player
          rig, and neither one substitutes a visible placeholder while it loads. */}
      <Suspense fallback={null}>
        <MissionPlayer runtime={props.runtime} />
      </Suspense>
      <Suspense fallback={null}>
        <MissionCrowd runtime={props.runtime} reducedMotion={props.reducedMotion} />
      </Suspense>
      {/* The opposition. Its own boundary so a constable's rig loading late
          cannot hold up the crowd, and vice versa. */}
      <Suspense fallback={null}>
        <MissionWatch runtime={props.runtime} reducedMotion={props.reducedMotion} />
      </Suspense>
      {Scenery && (
        <Suspense fallback={null}>
          <SceneryMount Scenery={Scenery} reducedMotion={props.reducedMotion} runtime={props.runtime} />
        </Suspense>
      )}

      {/* The visor's one surviving mark. Inside the canvas because it is in the
          street rather than on the glass, and last in the tree so its plate
          sorts over the level's own transparent art — the elm's leaves were
          drawn over the plate naming the elm the first time the hold tried
          this. Nothing about it can drive the run: it is handed a reader and no
          way to write. */}
      <VisorRunMark read={() => runMarkFor(props.runtime)} />

      {/* The catch line. Mounted beside the mark and under the same contract —
          a reader and no way to write — because the two answer the two halves
          of being lost: the mark says where, and this says what your body can
          do with what is in front of you. */}
      <VisorHolds
        read={() => holdsFor(props.runtime)}
        offer={() => offerFor(props.runtime)}
      />

      {/* The throw's aim, while one is being aimed. Same contract as the two
          marks above — a reader and no way to write — and the same procedural
          licence: the arc (the object's real trajectory samples) and the landing
          ring are annotation, not a production object. The thrown object itself
          is NOT drawn here; it has no imported GLB yet, which is a named
          asset-pipeline gap rather than a thing to fake with a primitive. */}
      <VisorThrowAim read={() => throwAimFor(props.runtime)} />
    </Canvas>
  );
}
