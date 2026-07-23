import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import type { PresentationDirective } from "@pa/contracts";
import {
  ImportedTexturedProp,
  RiggedCharacter,
} from "./Character.js";
import { ImportedPivotAsset } from "./ImportedPivotAsset.js";

// ---------------------------------------------------------------------------
// Presentation-only staging of the August 14 fixed event at the great elm:
// the gathering crowd, the elevated organizer, the effigy of Andrew Oliver
// (lowered, caught, and carried off toward Fort Hill), and the aftermath glow
// beyond the horizon. Driven entirely by plan cue ids plus the runtime view;
// nothing here mutates game state (Day-1 §B11, Production §2AA).
// ---------------------------------------------------------------------------

export const EVENT_CUES = {
  OBSERVE: "BOS.MD01.ACT.OBSERVE_CROWD_FORMING.v1",
  ONRAMP: "BOS.MD01.ACT.EVENT_ONRAMP.v1",
  CLIMB: "BOS.MD01.ACT.EVENT_CLIMB.v1",
  PUSH: "BOS.MD01.ACT.EVENT_PUSH.v1",
  CHANT: "BOS.MD01.ACT.EVENT_CHANT.v1",
  MARCH: "BOS.MD01.CUE.FIXED_EVENT_MARCH.v1",
  AFTERMATH: "BOS.MD01.CUE.FIXED_EVENT_AFTERMATH.v1",
} as const;

const PEAK_CUES = new Set<string>([
  EVENT_CUES.OBSERVE,
  EVENT_CUES.ONRAMP,
  EVENT_CUES.CLIMB,
  EVENT_CUES.PUSH,
  EVENT_CUES.CHANT,
]);

type EventPhase = "PRE" | "FORMING" | "PEAK" | "MARCH" | "AFTERMATH";

// ---- Fixed staging geometry (world meters) ----------------------------------
// v3 layout: the Liberty Tree pocket sits at [95,0,-25] past the east gate
// (Bible §3). The elm trunk is massive; everything is staged on the open
// northwest pocket side where the player walks in, so nothing hides behind
// the tree from the authored camera shots.
const TRUNK = new THREE.Vector3(95, 0, -25);
// The effigy hangs from a long limb reaching northwest over the open pocket,
// well clear of the elm's very wide trunk, so every shot reads it in space.
const EFFIGY_HANG = new THREE.Vector3(91.9, 3.6, -20.3);
const EFFIGY_GROUND = new THREE.Vector3(91.9, 0, -20.3);
const ORGANIZER_POS = new THREE.Vector3(93.3, 0, -21.6);
const CROWD_HEART = new THREE.Vector3(89.6, 0, -18.2); // where the organizer aims his lines
// The march leaves AWAY from town - past the elm toward the Fort Hill
// horizon beyond the pocket's east fence - skirting north of the trunk so
// the column never clips it.
const MARCH_DIR = new THREE.Vector3(10, 0, -2.5).normalize();
const MARCH_PERP = new THREE.Vector3(MARCH_DIR.z, 0, -MARCH_DIR.x);
const MARCH_YAW = Math.atan2(MARCH_DIR.x, MARCH_DIR.z);
const GLOW_POINT = new THREE.Vector3(113, 0, -26.5); // Fort Hill, beyond the horizon
const MARCH_SPEED = 0.85;
const MARCH_MAX = 24;
const LOWER_S = 3.0;
const LIFT_S = 1.4;
const CARRY_Y = 1.78;
const RM_MARCH_PROGRESS = 7; // reduced-motion static tableau distance

// Directed march camera (two-stage: push-in on the lowering, then pan/track).
const MARCH_CAM_BASE = new THREE.Vector3(88.3, 2.25, -16.9); // matches the authored shot
const MARCH_CAM_PUSH = new THREE.Vector3(89.4, 2.05, -18.2);
const MARCH_CAM_PAN = new THREE.Vector3(90.4, 2.7, -17.9);

interface MarchState {
  stage: "HANG" | "LOWER" | "LIFT" | "MARCH";
  signalT: number | null;
  marchStartT: number | null;
  effigyPos: THREE.Vector3;
  carry: THREE.Vector3;
  progress: number;
}

function createMarchState(): MarchState {
  return {
    stage: "HANG",
    signalT: null,
    marchStartT: null,
    effigyPos: EFFIGY_HANG.clone(),
    carry: EFFIGY_GROUND.clone(),
    progress: 0,
  };
}

function frac(n: number): number {
  return n - Math.floor(n);
}
function hash(i: number, salt: number): number {
  return frac(Math.sin(i * 127.1 + salt * 311.7) * 43758.5453);
}
function smooth01(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
}
function lerpAngle(from: number, to: number, alpha: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * alpha;
}
function yawToward(from: THREE.Vector3, to: THREE.Vector3): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

// ---- Crowd slots: a dense arc/ring facing the effigy ------------------------
interface CrowdSlot {
  id: number;
  pos: [number, number];
  glb: string;
  height: number;
  clip: string;
  timeOffset: number;
  role: "STAY" | "FOLLOW" | "CARRY";
  orderIdx: number;
  forming: boolean;
  walkFrom?: [number, number];
}

const CROWD_CLIPS = ["argu1", "talk2", "argue2", "idle"] as const;
const WALK_IN_SPAWNS: [number, number][] = [
  [88.5, -11.5],
  [92.5, -10.8],
  [85.8, -14.9],
];

function buildSlots(): CrowdSlot[] {
  const centerAngle = Math.atan2(88.4 - EFFIGY_GROUND.x, -17.6 - EFFIGY_GROUND.z);
  const raw: { x: number; z: number; d: number; id: number }[] = [];
  for (let i = 0; i < 16; i++) {
    const angle = centerAngle + (i / 15 - 0.5) * 3.9 + (hash(i, 1) - 0.5) * 0.16;
    let radius = 2.2 + (i % 2) * 1.2 + (hash(i, 2) - 0.5) * 0.7;
    const place = () => {
      const x = EFFIGY_GROUND.x + Math.sin(angle) * radius;
      const z = EFFIGY_GROUND.z + Math.cos(angle) * radius;
      return { x, z };
    };
    let { x, z } = place();
    // Keep clear of the elm's very wide trunk, the player's stand spot, the
    // barrel dressing, and the organizer's crate.
    for (let guard = 0; guard < 5; guard++) {
      if (Math.hypot(x - TRUNK.x, z - TRUNK.z) < 3.7) radius = Math.max(1.7, radius - 1.4);
      else if (Math.hypot(x - 89, z + 19) < 1.1) radius += 1.2;
      else if (Math.hypot(x - 87, z + 18) < 2.1) radius = Math.max(1.7, radius - 1.3);
      else if (Math.hypot(x - ORGANIZER_POS.x, z - ORGANIZER_POS.z) < 1.4) radius += 1.1;
      else break;
      ({ x, z } = place());
    }
    raw.push({ x, z, d: Math.hypot(x - EFFIGY_GROUND.x, z - EFFIGY_GROUND.z), id: i });
  }
  // Roles by proximity: nearest four carry, next seven follow, the rest stay.
  const byDistance = [...raw].sort((a, b) => a.d - b.d);
  const roleOf = new Map<number, { role: CrowdSlot["role"]; orderIdx: number }>();
  byDistance.forEach((entry, rank) => {
    if (rank < 4) roleOf.set(entry.id, { role: "CARRY", orderIdx: rank });
    else if (rank < 11) roleOf.set(entry.id, { role: "FOLLOW", orderIdx: rank - 4 });
    else roleOf.set(entry.id, { role: "STAY", orderIdx: rank - 11 });
  });
  let walkIns = 0;
  return raw.map((entry) => {
    const assignment = roleOf.get(entry.id)!;
    const forming = entry.id % 3 !== 1;
    const walkFrom =
      forming && assignment.role !== "CARRY" && walkIns < WALK_IN_SPAWNS.length && entry.id % 5 === 0
        ? WALK_IN_SPAWNS[walkIns++]
        : undefined;
    return {
      id: entry.id,
      pos: [entry.x, entry.z] as [number, number],
      glb: entry.id % 2 === 0 ? "townsman-rigged" : "townswoman-rigged",
      height: 1.6 + hash(entry.id, 4) * 0.16,
      clip: CROWD_CLIPS[entry.id % CROWD_CLIPS.length]!,
      timeOffset: hash(entry.id, 3) * 4,
      role: assignment.role,
      orderIdx: assignment.orderIdx,
      forming,
      walkFrom,
    };
  });
}

const CROWD_SLOTS = buildSlots();

function carryFormationTarget(out: THREE.Vector3, carry: THREE.Vector3, orderIdx: number): THREE.Vector3 {
  const along = orderIdx < 2 ? 0.62 : -0.62;
  const side = orderIdx % 2 === 0 ? 0.5 : -0.5;
  return out.copy(carry).addScaledVector(MARCH_DIR, along).addScaledVector(MARCH_PERP, side);
}
function catchTarget(out: THREE.Vector3, orderIdx: number): THREE.Vector3 {
  return out
    .copy(EFFIGY_GROUND)
    .addScaledVector(MARCH_PERP, orderIdx === 0 ? 0.6 : -0.6)
    .addScaledVector(MARCH_DIR, -0.12);
}
function followTrailTarget(out: THREE.Vector3, carry: THREE.Vector3, orderIdx: number): THREE.Vector3 {
  const lateral = (hash(orderIdx, 7) - 0.5) * 2.0;
  return out
    .copy(carry)
    .addScaledVector(MARCH_DIR, -(2.4 + orderIdx * 1.1))
    .addScaledVector(MARCH_PERP, lateral);
}

function CrowdFigure(props: {
  slot: CrowdSlot;
  phase: EventPhase;
  march: MutableRefObject<MarchState>;
  reducedMotion: boolean;
}) {
  const root = useRef<THREE.Group>(null);
  const sway = useRef<THREE.Group>(null);
  const clipRef = useRef(props.slot.clip);
  const [clip, setClip] = useState(props.slot.clip);
  const walkInInit = useRef(false);
  const attached = useRef(false);
  const heading = useRef(
    yawToward(new THREE.Vector3(props.slot.pos[0], 0, props.slot.pos[1]), EFFIGY_GROUND),
  );
  const scratch = useMemo(
    () => ({ target: new THREE.Vector3(), delta: new THREE.Vector3() }),
    [],
  );

  const setClipSafe = (next: string) => {
    if (clipRef.current !== next) {
      clipRef.current = next;
      setClip(next);
    }
  };

  useFrame(({ clock }, rawDt) => {
    const g = root.current;
    if (!g) return;
    const dt = Math.min(rawDt, 0.05);
    const now = clock.elapsedTime;
    const m = props.march.current;
    const slot = props.slot;
    const signalE = m.signalT === null ? -1 : now - m.signalT;
    const marching = props.phase === "MARCH" && signalE >= 0;

    scratch.target.set(slot.pos[0], 0, slot.pos[1]);
    let speed = 0;
    let facePoint: THREE.Vector3 | null = EFFIGY_GROUND;
    let desiredClip = slot.clip;
    let rigid = false;
    let swayScale = 1;

    if (marching) {
      if (signalE < LOWER_S + 0.9) swayScale = 2.2; // the surge as the leader calls it
      if (slot.role === "CARRY") {
        if (m.stage === "LOWER") {
          if (slot.orderIdx < 2) {
            catchTarget(scratch.target, slot.orderIdx);
            speed = 1.3;
            desiredClip = "argu1";
          } else if (signalE > 1.6) {
            carryFormationTarget(scratch.target, m.carry, slot.orderIdx);
            speed = 1.15;
          }
          facePoint = m.effigyPos;
        } else if (m.stage === "LIFT" || m.stage === "MARCH") {
          carryFormationTarget(scratch.target, m.carry, slot.orderIdx);
          if (!attached.current) {
            speed = 1.5;
            if (g.position.distanceTo(scratch.target) < 0.3) attached.current = true;
          }
          if (attached.current) {
            rigid = true;
            desiredClip = "carryWalk";
            facePoint = null;
            heading.current = lerpAngle(heading.current, MARCH_YAW, 1 - Math.exp(-6 * dt));
          } else {
            facePoint = m.effigyPos;
          }
          swayScale = 0;
        }
      } else if (slot.role === "FOLLOW") {
        if (m.stage === "MARCH" && signalE > 5.4 + slot.orderIdx * 0.75) {
          followTrailTarget(scratch.target, m.carry, slot.orderIdx);
          speed = 0.9 + hash(slot.id, 5) * 0.25;
          facePoint = null;
          swayScale = 0;
        }
      } else if (signalE > 4.2) {
        // Stayers turn together and watch the march leave.
        facePoint = m.carry;
        desiredClip = slot.id % 2 === 0 ? "talk2" : "idle";
      }
    } else if (slot.walkFrom && props.phase === "FORMING" && !walkInInit.current) {
      walkInInit.current = true;
      g.position.set(slot.walkFrom[0], 0, slot.walkFrom[1]);
    }
    if (!marching && walkInInit.current) speed = Math.max(speed, 0.85);

    if (props.reducedMotion) {
      // Static tableau: instant repositioning, no procedural sway or travel.
      if (marching && slot.role === "CARRY") {
        carryFormationTarget(scratch.target, m.carry, slot.orderIdx);
        g.position.copy(scratch.target);
        heading.current = MARCH_YAW;
        setClipSafe("idle");
      } else if (marching && slot.role === "FOLLOW") {
        followTrailTarget(scratch.target, m.carry, slot.orderIdx);
        g.position.copy(scratch.target);
        heading.current = MARCH_YAW;
        setClipSafe("idle");
      } else {
        g.position.set(slot.pos[0], 0, slot.pos[1]);
        heading.current = facePoint ? yawToward(g.position, facePoint) : heading.current;
        setClipSafe(marching ? "idle" : slot.clip);
      }
      g.rotation.y = heading.current;
      if (sway.current) sway.current.rotation.z = 0;
      return;
    }

    scratch.delta.copy(scratch.target).sub(g.position);
    scratch.delta.y = 0;
    const dist = scratch.delta.length();
    let moving = false;
    if (rigid) {
      g.position.copy(scratch.target);
    } else if (speed > 0 && dist > 0.09) {
      moving = true;
      const step = Math.min(dist, speed * dt);
      scratch.delta.normalize();
      g.position.addScaledVector(scratch.delta, step);
      heading.current = lerpAngle(
        heading.current,
        Math.atan2(scratch.delta.x, scratch.delta.z),
        1 - Math.exp(-8 * dt),
      );
      desiredClip = "walk";
    }
    if (!moving && !rigid && facePoint) {
      heading.current = lerpAngle(
        heading.current,
        yawToward(g.position, facePoint),
        1 - Math.exp(-5 * dt),
      );
    }
    g.rotation.y = heading.current;
    if (sway.current) {
      sway.current.rotation.z =
        moving || rigid ? 0 : Math.sin(now * 0.85 + slot.id * 1.63) * 0.022 * swayScale;
    }
    setClipSafe(desiredClip);
  });

  return (
    <group ref={root} position={[props.slot.pos[0], 0, props.slot.pos[1]]} rotation={[0, heading.current, 0]}>
      <group ref={sway}>
        <RiggedCharacter
          glbKey={props.slot.glb}
          height={props.slot.height}
          clip={clip}
          timeOffset={props.slot.timeOffset}
          castShadow={false}
          showFallback={false}
        />
      </group>
    </group>
  );
}

// ---- Imported banners planted where the crowd gathered ----------------------
function CrowdBanner(props: {
  pos: [number, number, number];
  rotY: number;
  textureKey: "banner-consent" | "banner-never-asked";
  reducedMotion: boolean;
}) {
  const sway = useRef<THREE.Group>(null);
  const texture = useTexture(`/world/posters/${props.textureKey}.png`);
  texture.colorSpace = THREE.SRGBColorSpace;
  const attachments = useMemo(
    () => [
      {
        nodeName: "banner_face",
        content: (
          <group position={[0, 0, 0.015]} rotation={[Math.PI / 2, 0, 0]}>
            <ImportedTexturedProp
              texture={texture}
              size={[0.82, 0.2, 0.52]}
            />
          </group>
        ),
      },
    ],
    [texture],
  );
  useFrame(({ clock }) => {
    if (!sway.current) return;
    sway.current.rotation.z = props.reducedMotion
      ? 0
      : Math.sin(clock.elapsedTime * 0.8 + props.rotY) * 0.035;
  });
  return (
    <group position={props.pos} rotation={[0, props.rotY, 0]}>
      <group ref={sway}>
        <ImportedPivotAsset
          glbKey="protest-banner"
          size={[2.15, 2.7, 0.42]}
          pivotName="banner_sway_pivot"
          attachments={attachments}
        />
      </group>
    </group>
  );
}

// ---- The organizer: elevated on a crate, torch-lit, source of the lines -----
function Organizer(props: { marchSignal: boolean; reducedMotion: boolean }) {
  const figure = useRef<THREE.Group>(null);
  const flame = useRef<THREE.PointLight>(null);
  const heading = useRef(yawToward(ORGANIZER_POS, CROWD_HEART));
  const [clip, setClip] = useState("argu1");
  const clipRef = useRef("argu1");
  const torchAttachments = useMemo(
    () => [
      {
        nodeName: "torch_flame",
        content: (
          <pointLight
            ref={flame}
            color="#ffb36a"
            distance={11}
            decay={1.5}
            intensity={14}
          />
        ),
      },
    ],
    [],
  );

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const now = clock.elapsedTime;
    const targetYaw = props.marchSignal ? MARCH_YAW : yawToward(ORGANIZER_POS, CROWD_HEART);
    heading.current = props.reducedMotion
      ? targetYaw
      : lerpAngle(heading.current, targetYaw, 1 - Math.exp(-4 * dt));
    if (figure.current) figure.current.rotation.y = heading.current;
    const next = props.marchSignal ? "argue2" : "argu1";
    if (clipRef.current !== next) {
      clipRef.current = next;
      setClip(next);
    }
    if (flame.current) {
      flame.current.intensity = props.reducedMotion
        ? 14
        : 14 + Math.sin(now * 9.7) * 2.1 + Math.sin(now * 23.3 + 1.4) * 1.3;
    }
  });

  return (
    <group position={[ORGANIZER_POS.x, 0, ORGANIZER_POS.z]}>
      <ImportedPivotAsset
        glbKey="organizer-crate-perch"
        size={[1.6, 1.32, 1.15]}
      />
      <group ref={figure} position={[0, 1.12, 0]}>
        <RiggedCharacter glbKey="townsman-rigged" height={1.76} clip={clip} timeOffset={1.7} coat="#402f1f" showFallback={false} />
      </group>
      <group position={[-0.66, 1.95, 0.46]}>
        <ImportedPivotAsset
          glbKey="protest-torch"
          size={[0.36, 2.05, 0.36]}
          pivotName="torch_flame"
          attachments={torchAttachments}
        />
      </group>
    </group>
  );
}

// ---- Effigy rig: hang/sway -> lower -> caught -> carried march --------------
function EffigyRig(props: {
  phase: EventPhase;
  marchSignal: boolean;
  march: MutableRefObject<MarchState>;
  reducedMotion: boolean;
}) {
  const body = useRef<THREE.Group>(null);
  const boot = useRef<THREE.Group>(null);
  const placard = useTexture(
    "/world/posters/placard-andrew-oliver.png",
  );
  placard.colorSpace = THREE.SRGBColorSpace;
  const effigyAttachments = useMemo(
    () => [
      {
        nodeName: "placard_mount",
        content: (
          <group position={[0, 0, 0.018]} rotation={[Math.PI / 2, 0, 0]}>
            <ImportedTexturedProp
              texture={placard}
              size={[0.42, 0.15, 0.3]}
            />
          </group>
        ),
      },
      {
        nodeName: "effigy_hang_pivot",
        content: <group name="event-effigy-hang-anchor" />,
      },
    ],
    [placard],
  );

  useFrame(({ clock }, rawDt) => {
    const g = body.current;
    if (!g) return;
    void rawDt;
    const now = clock.elapsedTime;
    const m = props.march.current;

    if (props.phase !== "MARCH" || !props.marchSignal) {
      // Hanging above the crowd (the whole day, and through the on-ramps).
      m.stage = "HANG";
      m.signalT = null;
      m.marchStartT = null;
      m.progress = 0;
      m.carry.copy(EFFIGY_GROUND);
      const swayX = props.reducedMotion ? 0 : Math.sin(now * 0.5) * 0.06;
      const swayZ = props.reducedMotion ? 0 : Math.sin(now * 0.34 + 2.1) * 0.045;
      g.position.set(EFFIGY_HANG.x + swayX, EFFIGY_HANG.y, EFFIGY_HANG.z + swayZ);
      g.rotation.set(swayZ * 0.7, 0.4, swayX * 0.8);
      if (boot.current && !props.reducedMotion) {
        boot.current.rotation.z = Math.sin(now * 0.44 + 1.1) * 0.05;
      }
      m.effigyPos.copy(g.position);
      return;
    }

    if (m.signalT === null) m.signalT = now;
    const e = now - m.signalT;

    if (props.reducedMotion) {
      // Static imported tableau instead of animated lowering + march.
      m.stage = "MARCH";
      m.progress = RM_MARCH_PROGRESS;
      m.carry.copy(EFFIGY_GROUND).addScaledVector(MARCH_DIR, m.progress);
      if (m.marchStartT === null) m.marchStartT = now;
      g.position.set(m.carry.x, CARRY_Y, m.carry.z);
      g.rotation.set(Math.PI / 2, MARCH_YAW, 0);
      m.effigyPos.copy(g.position);
      return;
    }

    if (e < LOWER_S) {
      // The men at the tree lower the effigy toward the waiting carriers.
      m.stage = "LOWER";
      const k = smooth01(e / LOWER_S);
      const y = EFFIGY_HANG.y - k * (EFFIGY_HANG.y - 1.32);
      g.position.set(EFFIGY_HANG.x, y, EFFIGY_HANG.z);
      g.rotation.set(0, 0.4, Math.sin(now * 1.7) * 0.03);
    } else if (e < LOWER_S + LIFT_S) {
      // Caught, cut loose, hoisted flat over the carriers' shoulders.
      m.stage = "LIFT";
      const k = smooth01((e - LOWER_S) / LIFT_S);
      g.position.set(EFFIGY_HANG.x, 1.32 + k * (CARRY_Y - 1.32), EFFIGY_HANG.z);
      g.rotation.set(k * (Math.PI / 2), lerpAngle(0.4, MARCH_YAW, k), 0);
    } else {
      // The crowd turns together and carries it toward Fort Hill.
      m.stage = "MARCH";
      if (m.marchStartT === null) m.marchStartT = now;
      m.progress = Math.min((e - LOWER_S - LIFT_S) * MARCH_SPEED, MARCH_MAX);
      m.carry.copy(EFFIGY_GROUND).addScaledVector(MARCH_DIR, m.progress);
      const bob = Math.sin(now * 2.6) * 0.045;
      g.position.set(m.carry.x, CARRY_Y + bob, m.carry.z);
      g.rotation.set(Math.PI / 2, MARCH_YAW, Math.sin(now * 1.9) * 0.05);
    }
    m.effigyPos.copy(g.position);
  });

  if (props.phase === "AFTERMATH") return null;

  return (
    <group>
      <group ref={body} position={[EFFIGY_HANG.x, EFFIGY_HANG.y, EFFIGY_HANG.z]} rotation={[0, 0.4, 0]}>
        <ImportedPivotAsset
          glbKey="effigy-oliver"
          size={[0.75, 1.48, 0.58]}
          pivotName="effigy_carry_pivot"
          attachments={effigyAttachments}
        />
        <pointLight position={[0, 0.2, 0]} color="#ffab5e" distance={7} decay={1.7} intensity={6} />
      </group>
      {/* the effigy stays legible at dusk: a faint lantern fill on the subject */}
      {props.phase !== "PRE" && (
        <pointLight
          position={[EFFIGY_HANG.x - 0.6, 4.6, EFFIGY_HANG.z + 0.9]}
          color="#ffc890"
          distance={9}
          decay={1.8}
          intensity={8}
        />
      )}
      <group ref={boot} position={[EFFIGY_HANG.x - 0.9, 4.8, EFFIGY_HANG.z - 0.7]}>
        <ImportedPivotAsset
          glbKey="effigy-boot"
          size={[0.4, 0.78, 0.52]}
          pivotName="boot_swing_pivot"
        />
      </group>
    </group>
  );
}

// ---- Aftermath: the pocket empties; Fort Hill burns beyond the horizon ------
function useRadialTexture(stops: [number, string][]): THREE.CanvasTexture {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(128, 128, 8, 128, 128, 126);
    for (const [at, color] of stops) grad.addColorStop(at, color);
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  }, [stops]);
}

const GLOW_STOPS: [number, string][] = [
  [0, "rgba(255,120,35,0.95)"],
  [0.4, "rgba(230,70,18,0.5)"],
  [1, "rgba(180,45,10,0)"],
];
const CORE_STOPS: [number, string][] = [
  [0, "rgba(255,214,140,1)"],
  [0.5, "rgba(255,130,40,0.65)"],
  [1, "rgba(255,90,25,0)"],
];
const SMOKE_STOPS: [number, string][] = [
  [0, "rgba(34,24,18,0.55)"],
  [0.6, "rgba(30,22,16,0.28)"],
  [1, "rgba(26,20,14,0)"],
];

function AftermathGlow(props: { reducedMotion: boolean }) {
  const glowTex = useRadialTexture(GLOW_STOPS);
  const coreTex = useRadialTexture(CORE_STOPS);
  const smokeTex = useRadialTexture(SMOKE_STOPS);
  const fire = useRef<THREE.PointLight>(null);
  const glowMat = useRef<THREE.MeshBasicMaterial>(null);
  const coreMat = useRef<THREE.MeshBasicMaterial>(null);
  const smokeRefs = useRef<(THREE.Mesh | null)[]>([]);
  const glowYaw = Math.atan2(89 - GLOW_POINT.x, -17 - GLOW_POINT.z);

  useFrame(({ clock }) => {
    const now = clock.elapsedTime;
    if (fire.current) {
      fire.current.intensity = props.reducedMotion
        ? 42
        : 42 + Math.sin(now * 0.9) * 8 + Math.sin(now * 2.3 + 1.2) * 4;
    }
    if (glowMat.current) {
      glowMat.current.opacity = props.reducedMotion
        ? 0.62
        : 0.62 + Math.sin(now * 0.7) * 0.12 + Math.sin(now * 1.9 + 0.6) * 0.05;
    }
    if (coreMat.current) {
      coreMat.current.opacity = props.reducedMotion
        ? 0.85
        : 0.85 + Math.sin(now * 1.3 + 0.4) * 0.12;
    }
    if (!props.reducedMotion) {
      smokeRefs.current.forEach((mesh, i) => {
        if (!mesh) return;
        const cycle = frac(now * 0.055 + i * 0.33);
        mesh.position.y = 4.5 + cycle * 9;
        mesh.position.x = GLOW_POINT.x - 1 + i * 1.5 + cycle * 2.2;
        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = Math.sin(cycle * Math.PI) * 0.42;
        mesh.scale.setScalar(1 + cycle * 1.6);
      });
    }
  });

  return (
    <group>
      {/* Fort Hill bonfire glow, beyond the horizon in the march direction */}
      <pointLight
        ref={fire}
        position={[GLOW_POINT.x, 3.2, GLOW_POINT.z]}
        color="#ff7a2e"
        distance={90}
        decay={1.4}
        intensity={42}
      />
      {/* distant building-glow (the Kilby Street timbers feeding the fire) */}
      <pointLight position={[106, 2.2, -32.5]} color="#ff9a55" distance={42} decay={1.6} intensity={10} />
      <mesh position={[GLOW_POINT.x + 1, 3.0, GLOW_POINT.z - 1.5]} rotation={[0, glowYaw, 0]}>
        <planeGeometry args={[28, 9.5]} />
        <meshBasicMaterial
          ref={glowMat}
          map={glowTex}
          transparent
          opacity={0.62}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* hot core right at the horizon line */}
      <mesh position={[GLOW_POINT.x, 1.4, GLOW_POINT.z - 0.5]} rotation={[0, glowYaw, 0]}>
        <planeGeometry args={[9, 3.6]} />
        <meshBasicMaterial
          ref={coreMat}
          map={coreTex}
          transparent
          opacity={0.85}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {props.reducedMotion ? (
        <mesh position={[GLOW_POINT.x + 0.5, 8.5, GLOW_POINT.z - 1]} rotation={[0, glowYaw, 0]}>
          <planeGeometry args={[7, 7]} />
          <meshBasicMaterial map={smokeTex} transparent opacity={0.22} depthWrite={false} />
        </mesh>
      ) : (
        [0, 1, 2].map((i) => (
          <mesh
            key={i}
            ref={(el) => {
              smokeRefs.current[i] = el;
            }}
            position={[GLOW_POINT.x - 1 + i * 1.5, 5 + i * 2.4, GLOW_POINT.z - 1 - i * 0.9]}
            rotation={[0, glowYaw, 0]}
          >
            <planeGeometry args={[6, 6]} />
            <meshBasicMaterial map={smokeTex} transparent opacity={0} depthWrite={false} />
          </mesh>
        ))
      )}
    </group>
  );
}

// A few stragglers stay behind after the march has gone.
const STRAGGLERS: { pos: [number, number]; glb: string; clip: string; faceGlow: boolean }[] = [
  { pos: [90.6, -19.2], glb: "townsman-rigged", clip: "talk", faceGlow: false },
  { pos: [91.7, -18.7], glb: "townswoman-rigged", clip: "talk2", faceGlow: false },
  { pos: [89.0, -20.6], glb: "townsman-rigged", clip: "idle", faceGlow: true },
  { pos: [94.0, -18.4], glb: "townswoman-rigged", clip: "idle", faceGlow: true },
];

function Stragglers() {
  return (
    <group>
      {STRAGGLERS.map((s, i) => {
        const pos = new THREE.Vector3(s.pos[0], 0, s.pos[1]);
        const face = s.faceGlow
          ? yawToward(pos, GLOW_POINT)
          : yawToward(pos, new THREE.Vector3(STRAGGLERS[i === 0 ? 1 : 0]!.pos[0], 0, STRAGGLERS[i === 0 ? 1 : 0]!.pos[1]));
        return (
          <group key={i} position={[s.pos[0], 0, s.pos[1]]} rotation={[0, face, 0]}>
            <RiggedCharacter glbKey={s.glb} height={1.64 + i * 0.04} clip={s.clip} timeOffset={i * 1.2} castShadow={false} showFallback={false} />
          </group>
        );
      })}
    </group>
  );
}

// ---- Directed march/chant camera (runs on top of the CameraDirector shot) ---
function EventCameraRig(props: {
  cueId: string | null;
  reducedMotion: boolean;
  march: MutableRefObject<MarchState>;
}) {
  const camera = useThree((state) => state.camera);
  const state = useRef({
    cueId: null as string | null,
    startT: 0,
    hasStart: false,
    startPos: new THREE.Vector3(),
    look: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    pos: new THREE.Vector3(),
  });

  useFrame(({ clock }, rawDt) => {
    if (props.reducedMotion) return;
    const cue = props.cueId;
    const isMarch = cue === EVENT_CUES.MARCH;
    const isChant = cue === EVENT_CUES.CHANT;
    const s = state.current;
    if (!isMarch && !isChant) {
      s.hasStart = false;
      return;
    }
    const dt = Math.min(rawDt, 0.05);
    const now = clock.elapsedTime;
    if (!s.hasStart || s.cueId !== cue) {
      s.cueId = cue;
      s.startT = now;
      s.hasStart = true;
      s.startPos.copy(camera.position);
      // A resume can mount this cue with the camera still at the follow-cam
      // spawn (buried in the crowd near the trunk); start the push from the
      // authored frame instead so the shot is directed from the first frame.
      if (isMarch && s.startPos.distanceTo(MARCH_CAM_BASE) > 4.5) {
        s.startPos.copy(MARCH_CAM_BASE);
        camera.position.copy(MARCH_CAM_BASE);
        s.look.copy(EFFIGY_HANG);
      } else {
        camera.getWorldDirection(s.forward);
        s.look.copy(camera.position).addScaledVector(s.forward, 12);
      }
    }
    const t = now - s.startT;
    if (isChant) {
      // Jostled in the chanting crowd: translate without re-aiming.
      const ramp = Math.min(1, t / 2.2);
      camera.position.x += Math.sin(now * 1.6) * 0.06 * ramp;
      camera.position.y += Math.sin(now * 2.35 + 1.3) * 0.045 * ramp;
      return;
    }
    // MARCH: stage one is a slow push-in on the effigy while it is lowered;
    // stage two lifts and pans, tracking the carried effigy up the lane.
    const m = props.march.current;
    const a = smooth01(t / 11);
    s.pos.lerpVectors(s.startPos, MARCH_CAM_PUSH, a);
    if (m.marchStartT !== null) {
      const b = smooth01((now - m.marchStartT) / 9);
      s.pos.lerp(MARCH_CAM_PAN, b);
    }
    camera.position.copy(s.pos);
    const blend = 1 - Math.exp(-2.6 * dt);
    // Aim below the subject while it hangs so the crowd shares the frame;
    // once marching, lead the column slightly to keep the group composed.
    const lookGoal = m.effigyPos.clone();
    lookGoal.y = THREE.MathUtils.clamp(m.effigyPos.y - 0.55, 1.35, 2.7);
    if (m.stage === "MARCH") {
      lookGoal.addScaledVector(MARCH_DIR, Math.min(2.5, m.progress * 0.35));
    }
    s.look.lerp(lookGoal, blend);
    camera.lookAt(s.look);
  });

  return null;
}

// ---- Top-level director ------------------------------------------------------
function derivePhase(
  cueId: string | null,
  forming: boolean,
  postEvent: boolean,
): EventPhase {
  if (cueId === EVENT_CUES.AFTERMATH || postEvent) return "AFTERMATH";
  if (cueId === EVENT_CUES.MARCH) return "MARCH";
  if (cueId && PEAK_CUES.has(cueId)) return "PEAK";
  return forming ? "FORMING" : "PRE";
}

export function EventDirector(props: {
  cueId: string | null;
  interiorId: string | null;
  dusk: boolean;
  lateDay: boolean;
  reducedMotion: boolean;
  present: PresentationDirective[];
  postEvent: boolean;
}) {
  const phase = derivePhase(props.cueId, props.dusk || props.lateDay, props.postEvent);
  const march = useRef<MarchState>(createMarchState());
  const [marchSignal, setMarchSignal] = useState(false);

  // "To Fort Hill!" is the causal trigger: the leader calls it, the crowd
  // lowers the effigy and moves. Falls back to a timer if the line was missed.
  useEffect(() => {
    if (props.cueId !== EVENT_CUES.MARCH) {
      setMarchSignal(false);
      return;
    }
    // Presenter timing can resume directly at the march cue without replaying
    // the leader's subtitle. Keep the authored line as the primary trigger,
    // but bound the fallback so the forced cutscene cannot stall.
    const timer = window.setTimeout(() => setMarchSignal(true), 2500);
    return () => window.clearTimeout(timer);
  }, [props.cueId]);
  useEffect(() => {
    if (props.cueId !== EVENT_CUES.MARCH) return;
    const called = props.present.some(
      (d) => d.kind === "DIALOGUE" && d.speaker === "CROWD" && /fort hill/i.test(d.text),
    );
    if (called) setMarchSignal(true);
  }, [props.cueId, props.present]);

  const crowdVisible = phase !== "PRE" && !props.interiorId;

  return (
    <group>
      <EffigyRig phase={phase} marchSignal={marchSignal} march={march} reducedMotion={props.reducedMotion} />
      {crowdVisible && phase !== "AFTERMATH" && (
        <>
          {CROWD_SLOTS.filter((slot) => phase !== "FORMING" || slot.forming).map((slot) => (
            <CrowdFigure
              key={slot.id}
              slot={slot}
              phase={phase}
              march={march}
              reducedMotion={props.reducedMotion}
            />
          ))}
          <Organizer marchSignal={marchSignal} reducedMotion={props.reducedMotion} />
          <CrowdBanner
            pos={[92.6, 0, -23.2]}
            rotY={-0.55}
            textureKey="banner-never-asked"
            reducedMotion={props.reducedMotion}
          />
          <CrowdBanner
            pos={[88.5, 0, -21.1]}
            rotY={0.65}
            textureKey="banner-consent"
            reducedMotion={props.reducedMotion}
          />
        </>
      )}
      {crowdVisible && phase === "AFTERMATH" && <Stragglers />}
      {phase === "AFTERMATH" && !props.interiorId && <AftermathGlow reducedMotion={props.reducedMotion} />}
      <EventCameraRig cueId={props.cueId} reducedMotion={props.reducedMotion} march={march} />
    </group>
  );
}
