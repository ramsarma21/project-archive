import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { PlayerApi } from "./Player.js";
import type { ChoiceAnimation, EntryApproach } from "./choiceAnimations.js";
import { doorwayForTarget } from "./doorwayContract.js";

// ---------------------------------------------------------------------------
// Mercer threshold executions (Day-1 B1, §5 L17): the chosen entry approach is
// performed on screen between selecting the option and the interior swap, so
// the choice never plays as a cut.
//   KNOCK      – stage the player at the shared threshold, play the supplied
//                baked `knock` performance, then open on its response beat.
//   LOOK_FIRST – the camera eases to the shop window beside the door and peers
//                in at a staged impression (glowing glass, dim room tone,
//                Abigail silhouetted at the press) without rendering the real
//                interior, then returns to the door as it opens.
//   WALK_IN    – the door swings first and the player rig walks through the
//                gap under scripted control, camera following, so the portal
//                swap continues the motion instead of cutting.
// Root translation is neutralized in the baked clips; shared threshold staging
// owns body placement. Reduced motion snaps to the same validated final state.
// ---------------------------------------------------------------------------

interface DoorSpace {
  opening: THREE.Vector3; // doorway center at ground level
  outward: THREE.Vector3; // unit vector toward the street
  inward: THREE.Vector3;
  tangent: THREE.Vector3; // along the facade (door local +x)
  rotationY: number;
  exterior: THREE.Vector3;
}

function mercerDoorSpace(): DoorSpace {
  const resolved = doorwayForTarget("MERCER_PRESS");
  const opening = new THREE.Vector3(...(resolved?.facadePoint ?? [-0.31, 0, 11.21]));
  opening.y = 0;
  const outward = new THREE.Vector3(...(resolved?.outwardNormal ?? [0, 0, -1]));
  const tangent = new THREE.Vector3(...(resolved?.tangent ?? [-1, 0, 0]));
  return {
    opening,
    outward,
    inward: outward.clone().negate(),
    tangent,
    rotationY: resolved?.effectiveYaw ?? Math.PI,
    exterior: new THREE.Vector3(...(resolved?.sensors.exterior ?? [-0.31, 0, 10.49])),
  };
}

function smooth01(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
}

// One rap of the knuckles: a 0..1 swing that peaks mid-window.
function rapSwing(t: number, startS: number, durationS: number): number {
  if (t < startS || t > startS + durationS) return 0;
  return Math.sin(((t - startS) / durationS) * Math.PI);
}

// Inner beats of each execution (seconds). The outer envelope — total length
// and when the door starts to swing — lives in choiceAnimations.ts so Play's
// advance timer, the DoorDirector signal, and this director stay in step.
const KNOCK_CAM_IN_S = 0.38;
const KNOCK_RAPS_S = [0.68, 1.55] as const;
const KNOCK_RAP_S = 0.28;
const LOOK_CAM_IN_S = 0.62;
const LOOK_RETURN_AT_S = 1.34;
const LOOK_RETURN_S = 0.55;
const WALK_LEAD_S = 1.15; // authored handle reach before threshold crossing
const WALK_TAIL_S = 0.06; // hold just inside before the runtime commits

function useWarmGlowTexture(): THREE.CanvasTexture {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(64, 70, 6, 64, 64, 62);
    grad.addColorStop(0, "rgba(255,216,152,1)");
    grad.addColorStop(0.55, "rgba(255,160,72,0.55)");
    grad.addColorStop(1, "rgba(120,60,20,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);
}

function useRoomToneTexture(): THREE.CanvasTexture {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, "#2c1c0e");
    grad.addColorStop(0.5, "#6d4520");
    grad.addColorStop(0.8, "#c08a45");
    grad.addColorStop(1, "#7c5124");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }, []);
}

// World3D feeds this into DoorDirector in place of the raw doorTargetId so a
// choice execution can hold the door shut through its opening beats (the
// knock raps, the window peek) before the swing is signalled.
export function useEntryDoorTarget(
  animation: ChoiceAnimation | null,
  reducedMotion: boolean,
): string | null {
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    const doorTargetId = animation?.doorTargetId ?? null;
    if (!doorTargetId) {
      setTarget(null);
      return;
    }
    const delay = reducedMotion ? 0 : animation?.doorDelayMs ?? 0;
    if (delay <= 0) {
      setTarget(doorTargetId);
      return;
    }
    setTarget(null);
    const timer = window.setTimeout(() => setTarget(doorTargetId), delay);
    return () => window.clearTimeout(timer);
  }, [animation, reducedMotion]);
  return target;
}

interface EntryState {
  entry: EntryApproach | null;
  startT: number;
  camStart: THREE.Vector3;
  look: THREE.Vector3;
  // authored framings, computed from the door transform at activation
  knockCam: THREE.Vector3;
  knockLook: THREE.Vector3;
  peekCam: THREE.Vector3;
  peekLook: THREE.Vector3;
  doorCam: THREE.Vector3;
  doorLook: THREE.Vector3;
  walk: { points: THREE.Vector3[]; lens: number[]; total: number } | null;
  pos: THREE.Vector3;
  goal: THREE.Vector3;
  lookGoal: THREE.Vector3;
  tmp: THREE.Vector3;
}

export function EntryDirector(props: {
  animation: ChoiceAnimation | null;
  reducedMotion: boolean;
  playerApiRef: { current: PlayerApi | null };
  // True once the interior scene swap has committed. The execution is an
  // EXTERIOR approach: the instant the room takes over, this director must
  // stop scripting the player pose and camera, or its remaining frames
  // overwrite the interior landing teleport and strand the committed body at
  // the exterior door coordinates (inside the wall void) for the whole scene.
  suspended: boolean;
}) {
  const camera = useThree((state) => state.camera);
  const entry =
    props.reducedMotion || props.suspended
      ? null
      : props.animation?.entry ?? null;
  const doorOpenS = (props.animation?.doorDelayMs ?? 0) / 1000;
  const totalS = (props.animation?.durationMs ?? 0) / 1000;
  const door = useMemo(() => mercerDoorSpace(), []);
  // Peek framing beside the door on the printshop facade; the component
  // authors its own lit sash there so it never depends on the GLB's windows.
  const windowCenter = useMemo(() => {
    const center = door.opening.clone().addScaledVector(door.tangent, 2.05);
    center.y = 1.5;
    return center;
  }, [door]);
  const glowTex = useWarmGlowTexture();
  const roomTex = useRoomToneTexture();
  const silhouetteMats = useMemo(
    () => ({
      figure: new THREE.MeshBasicMaterial({ color: "#160e07", transparent: true, opacity: 0 }),
      press: new THREE.MeshBasicMaterial({ color: "#110a05", transparent: true, opacity: 0 }),
    }),
    [],
  );

  const glowMat = useRef<THREE.MeshBasicMaterial>(null);
  const glowLight = useRef<THREE.PointLight>(null);
  const backdropMat = useRef<THREE.MeshBasicMaterial>(null);
  const glassMat = useRef<THREE.MeshBasicMaterial>(null);
  const haloMat = useRef<THREE.MeshBasicMaterial>(null);
  const sillLight = useRef<THREE.PointLight>(null);
  const silhouetteBody = useRef<THREE.Group>(null);
  const silhouetteArm = useRef<THREE.Group>(null);
  const handlingClipStarted = useRef(false);

  useEffect(() => {
    const api = props.playerApiRef.current;
    handlingClipStarted.current = false;
    if (!entry || !api) return;
    api.setInputLocked(true);
    if (entry === "KNOCK") {
      api.setInteractionClip("knock");
      api.setPose(
        [door.exterior.x, 0, door.exterior.z],
        Math.atan2(door.inward.x, door.inward.z),
      );
    } else if (entry === "WALK_IN") {
      api.setInteractionClip("doorOpenInward");
      handlingClipStarted.current = true;
    }
    return () => {
      api.setInteractionClip(null);
      api.setInputLocked(false);
    };
  }, [door, entry, props.playerApiRef]);

  const s = useRef<EntryState>({
    entry: null,
    startT: 0,
    camStart: new THREE.Vector3(),
    look: new THREE.Vector3(),
    knockCam: new THREE.Vector3(),
    knockLook: new THREE.Vector3(),
    peekCam: new THREE.Vector3(),
    peekLook: new THREE.Vector3(),
    doorCam: new THREE.Vector3(),
    doorLook: new THREE.Vector3(),
    walk: null,
    pos: new THREE.Vector3(),
    goal: new THREE.Vector3(),
    lookGoal: new THREE.Vector3(),
    tmp: new THREE.Vector3(),
  });

  // Runs after the Player rig and the ChoreographyDirector camera (priority
  // -1), so during the execution window this director owns the final camera
  // transform, the same layering the EventDirector march rig uses.
  useFrame(({ clock }, rawDt) => {
    const st = s.current;
    if (!entry) {
      st.entry = null;
      st.walk = null;
      return;
    }
    const dt = Math.min(rawDt, 0.05);
    const now = clock.elapsedTime;
    if (st.entry !== entry) {
      st.entry = entry;
      st.startT = now;
      st.walk = null;
      st.camStart.copy(camera.position);
      camera.getWorldDirection(st.tmp);
      st.look.copy(camera.position).addScaledVector(st.tmp, 7);
      st.knockCam
        .copy(door.opening)
        .addScaledVector(door.outward, 1.05)
        .addScaledVector(door.tangent, -0.36)
        .setY(1.42);
      st.knockLook.copy(door.opening).addScaledVector(door.inward, 0.25).setY(1.05);
      st.peekCam
        .copy(windowCenter)
        .addScaledVector(door.outward, 1.34)
        .addScaledVector(door.tangent, -0.3)
        .setY(1.56);
      // Aim slightly above the pane center: the HUD's choice panel band sits
      // across mid-frame, so the glass and silhouette compose below it.
      st.peekLook.copy(windowCenter).addScaledVector(door.inward, 0.4).setY(1.64);
      st.doorCam
        .copy(door.opening)
        .addScaledVector(door.outward, 1.65)
        .addScaledVector(door.tangent, 0.1)
        .setY(1.56);
      st.doorLook.copy(door.opening).setY(1.25);
    }
    const t = now - st.startT;
    if (
      entry === "LOOK_FIRST" &&
      t >= doorOpenS &&
      !handlingClipStarted.current
    ) {
      props.playerApiRef.current?.setInteractionClip("doorOpenInward");
      handlingClipStarted.current = true;
    }

    // Warm light past the threshold, revealed as the leaf swings open. Leads
    // the swing slightly so the gap never reads as a black void mid-open.
    const glowK = smooth01((t - Math.max(0, doorOpenS - 0.15)) / 0.5);
    if (glowMat.current) glowMat.current.opacity = glowK * 0.9;
    if (glowLight.current) glowLight.current.intensity = glowK * 9;

    if (entry === "KNOCK") {
      const arrive = smooth01(t / KNOCK_CAM_IN_S);
      st.pos.lerpVectors(st.camStart, st.knockCam, arrive);
      // The raised fist raps twice; each contact lands a tiny camera jab.
      let swing = 0;
      for (const rapAt of KNOCK_RAPS_S) swing = Math.max(swing, rapSwing(t, rapAt, KNOCK_RAP_S));
      st.pos.addScaledVector(door.inward, Math.max(0, swing - 0.55) * 0.07);
      // Once it opens, drift toward the warm gap.
      st.pos.addScaledVector(door.inward, smooth01((t - doorOpenS) / 0.65) * 0.2);
      camera.position.copy(st.pos);
      st.look.lerp(st.knockLook, arrive >= 1 ? 1 : 1 - Math.exp(-9 * dt));
      camera.lookAt(st.look);

      return;
    }

    if (entry === "LOOK_FIRST") {
      const arrive = smooth01(t / LOOK_CAM_IN_S);
      st.pos.lerpVectors(st.camStart, st.peekCam, arrive);
      // Slow lean toward the glass while reading the room.
      const lean = smooth01((Math.min(t, LOOK_RETURN_AT_S) - LOOK_CAM_IN_S) / 0.72);
      st.pos.addScaledVector(door.inward, lean * 0.16);
      // Then pull back toward the door as it opens.
      const back = smooth01((t - LOOK_RETURN_AT_S) / LOOK_RETURN_S);
      st.pos.lerp(st.doorCam, back);
      camera.position.copy(st.pos);
      st.lookGoal.lerpVectors(st.peekLook, st.doorLook, back);
      st.look.lerp(st.lookGoal, arrive >= 1 && back <= 0 ? 1 - Math.exp(-16 * dt) : 1 - Math.exp(-9 * dt));
      camera.lookAt(st.look);

      // Dress the pane in on approach; fade it back out on the return leg so
      // the shadow-box never reads edge-on while the camera swings to the door.
      const reveal = smooth01(t / 0.3) * (1 - back);
      if (backdropMat.current) backdropMat.current.opacity = reveal * 0.96;
      if (glassMat.current) glassMat.current.opacity = reveal * 0.15;
      if (haloMat.current) haloMat.current.opacity = reveal * 0.26;
      if (sillLight.current) sillLight.current.intensity = reveal * 2.2;
      silhouetteMats.figure.opacity = reveal;
      silhouetteMats.press.opacity = reveal;
      // Abigail's work loop behind the glass: pulling the bar and settling.
      if (silhouetteArm.current) {
        silhouetteArm.current.rotation.z = -0.42 + Math.sin(now * 3.4) * 0.5;
      }
      if (silhouetteBody.current) {
        silhouetteBody.current.position.y = Math.sin(now * 3.4 + 1.2) * 0.026;
        silhouetteBody.current.rotation.z = Math.sin(now * 3.4 + 0.4) * 0.045;
      }
      return;
    }

    // WALK_IN: script the rig from where the walk-up ended, through the
    // doorway gap, holding half a step inside until the portal commits.
    const api = props.playerApiRef.current;
    if (!api) return;
    if (!st.walk) {
      const start = api.position.clone().setY(0);
      const approach = door.opening.clone().addScaledVector(door.outward, 1.3);
      // A resume can present this choice away from the authored mark; start
      // the scripted walk on the door lane instead of streaking across the
      // street.
      if (start.distanceTo(approach) > 2.8) {
        start.copy(approach).addScaledVector(door.outward, 1.4);
      }
      const inside = door.opening.clone().addScaledVector(door.inward, 0.3);
      const points = [start, approach, inside];
      const lens: number[] = [0];
      let total = 0;
      for (let i = 1; i < points.length; i++) {
        total += points[i]!.distanceTo(points[i - 1]!);
        lens.push(total);
      }
      st.walk = { points, lens, total: Math.max(total, 0.001) };
    }
    const walkEndS = Math.max(totalS - WALK_TAIL_S, WALK_LEAD_S + 0.1);
    const linear = Math.min(1, Math.max(0, (t - WALK_LEAD_S) / (walkEndS - WALK_LEAD_S)));
    // Mild ease on both ends; mostly constant stride.
    const eased = linear + (smooth01(linear) - linear) * 0.35;
    const distance = eased * st.walk.total;
    let seg = 1;
    while (seg < st.walk.lens.length - 1 && st.walk.lens[seg]! < distance) seg += 1;
    const a = st.walk.points[seg - 1]!;
    const b = st.walk.points[seg]!;
    const segLen = Math.max(st.walk.lens[seg]! - st.walk.lens[seg - 1]!, 0.001);
    const k = Math.min(1, Math.max(0, (distance - st.walk.lens[seg - 1]!) / segLen));
    st.goal.lerpVectors(a, b, k);
    st.tmp.copy(b).sub(a).normalize();
    const heading = Math.atan2(st.tmp.x, st.tmp.z);
    api.setPose([st.goal.x, 0, st.goal.z], heading);

    // Follow cam: settle in behind the walker and track them through the
    // doorway without ever entering the facade itself.
    st.pos.copy(st.goal).addScaledVector(st.tmp, -2.7);
    st.pos.y = 2.0;
    const blendIn = smooth01(t / 0.45);
    st.pos.lerpVectors(st.camStart, st.pos.clone(), blendIn);
    if (blendIn >= 1) camera.position.lerp(st.pos, 1 - Math.exp(-9 * dt));
    else camera.position.copy(st.pos);
    // Aim a touch above the rig so the body composes in the lower half of the
    // frame, under the HUD's choice panel band, while crossing the threshold.
    st.lookGoal.copy(st.goal).setY(1.6);
    st.look.lerp(st.lookGoal, 1 - Math.exp(-10 * dt));
    camera.lookAt(st.look);
  });

  if (!entry) return null;
  const facadeRotY = door.rotationY + Math.PI;
  // A hair street-side of the facade plane: never swallowed by the shell,
  // reads as light spilling out once the leaf swings inward.
  const glowCenter = door.opening.clone().addScaledVector(door.outward, 0.06);
  return (
    <group>
      {/* Warm interior light in the doorway, revealed by the swing. Sits a
          hair street-side of the facade plane so it reads even where the shell
          behind the leaf is solid. */}
      <group position={[glowCenter.x, 0, glowCenter.z]} rotation={[0, facadeRotY, 0]}>
        <mesh position={[0, 1.14, 0]} renderOrder={4}>
          <planeGeometry args={[1.18, 2.14]} />
          <meshBasicMaterial ref={glowMat} map={glowTex} transparent opacity={0} depthWrite={false} />
        </mesh>
        <pointLight
          ref={glowLight}
          position={[0, 1.6, 0.45]}
          color="#ffbe78"
          distance={5.5}
          decay={1.6}
          intensity={0}
        />
      </group>
      {entry === "LOOK_FIRST" && (
        // A shallow lit shadow-box seated near the facade plane (the door leaf
        // sits recessed at the porch line; the wall face runs ~0.2m deeper).
        // Local +z faces the street.
        <group
          position={[
            windowCenter.x + door.inward.x * 0.12,
            windowCenter.y,
            windowCenter.z + door.inward.z * 0.12,
          ]}
          rotation={[0, facadeRotY, 0]}
        >
          {/* dim room tone behind the glass — an impression, not the interior */}
          <mesh position={[0, -0.02, -0.06]} renderOrder={5}>
            <planeGeometry args={[1.34, 1.42]} />
            <meshBasicMaterial ref={backdropMat} map={roomTex} transparent opacity={0} depthWrite={false} />
          </mesh>
          {/* Abigail silhouetted at the press, mid pull. Composed strictly
              within the pane (head-and-torso over the sill, the way a figure
              reads through a shop window) so nothing hangs outside the frame. */}
          <group position={[0.1, -0.2, -0.04]} scale={[0.7, 0.7, 0.7]}>
            <group ref={silhouetteBody}>
              {/* shoulders + torso, leaning into the pull */}
              <mesh
                position={[0.16, -0.24, 0]}
                rotation={[0, 0, -0.08]}
                renderOrder={6}
                material={silhouetteMats.figure}
              >
                <capsuleGeometry args={[0.115, 0.3, 4, 10]} />
              </mesh>
              <mesh position={[0.14, 0.09, 0]} renderOrder={6} material={silhouetteMats.figure}>
                <sphereGeometry args={[0.082, 10, 8]} />
              </mesh>
              {/* hair knot */}
              <mesh position={[0.19, 0.14, 0]} renderOrder={6} material={silhouetteMats.figure}>
                <sphereGeometry args={[0.045, 8, 6]} />
              </mesh>
              {/* working arm, shoulder-pivoted toward the press bar */}
              <group ref={silhouetteArm} position={[0.07, -0.06, 0]}>
                <mesh
                  position={[-0.16, 0.03, 0]}
                  rotation={[0, 0, 0.14]}
                  renderOrder={6}
                  material={silhouetteMats.figure}
                >
                  <boxGeometry args={[0.34, 0.05, 0.012]} />
                </mesh>
              </group>
            </group>
            {/* the press: cheek, cap and the angled bar the arm works */}
            <group position={[-0.36, 0, 0]}>
              <mesh position={[0, -0.1, 0]} renderOrder={6} material={silhouetteMats.press}>
                <boxGeometry args={[0.14, 0.95, 0.012]} />
              </mesh>
              <mesh position={[0.11, 0.36, 0]} renderOrder={6} material={silhouetteMats.press}>
                <boxGeometry args={[0.36, 0.06, 0.012]} />
              </mesh>
              <mesh
                position={[0.18, 0.06, 0]}
                rotation={[0, 0, -0.55]}
                renderOrder={6}
                material={silhouetteMats.press}
              >
                <boxGeometry args={[0.3, 0.04, 0.012]} />
              </mesh>
            </group>
          </group>
          {/* warm glass film + additive halo so the pane reads lit */}
          <mesh position={[0, 0, 0.02]} renderOrder={7}>
            <planeGeometry args={[1.1, 1.2]} />
            <meshBasicMaterial ref={glassMat} color="#ffd9a2" transparent opacity={0} depthWrite={false} />
          </mesh>
          <mesh position={[0, 0, 0.09]} renderOrder={8}>
            <planeGeometry args={[1.66, 1.62]} />
            <meshBasicMaterial
              ref={haloMat}
              map={glowTex}
              transparent
              opacity={0}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
          {/* sash frame + mullions */}
          {[0.63, -0.63].map((y) => (
            <mesh key={`h${y}`} position={[0, y, 0.05]}>
              <boxGeometry args={[1.28, 0.1, 0.08]} />
              <meshStandardMaterial color="#2b1f14" roughness={0.95} />
            </mesh>
          ))}
          {[0.59, -0.59].map((x) => (
            <mesh key={`v${x}`} position={[x, 0, 0.05]}>
              <boxGeometry args={[0.1, 1.36, 0.08]} />
              <meshStandardMaterial color="#2b1f14" roughness={0.95} />
            </mesh>
          ))}
          <mesh position={[0, 0.02, 0.045]}>
            <boxGeometry args={[0.04, 1.2, 0.05]} />
            <meshStandardMaterial color="#332516" roughness={0.95} />
          </mesh>
          <mesh position={[0, 0.02, 0.045]}>
            <boxGeometry args={[1.1, 0.04, 0.05]} />
            <meshStandardMaterial color="#332516" roughness={0.95} />
          </mesh>
          <pointLight
            ref={sillLight}
            position={[0, -0.35, 0.5]}
            color="#ffc584"
            distance={2.8}
            decay={1.7}
            intensity={0}
          />
        </group>
      )}
    </group>
  );
}
