import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { RiggedCharacter } from "./Character.js";
import { WORLD_BOUNDS, type RoomDef } from "./manifest.js";

export interface PlayerApi {
  position: THREE.Vector3;
  teleport: (pos: [number, number, number], faceY?: number) => void;
}

const WALK = 2.3;
const RUN = 4.6;
const ACCEL = 9; // m/s^2 toward target velocity
const DECEL = 14;

export function Player(props: {
  apiRef: { current: PlayerApi | null };
  colliders: [number, number, number, number][];
  room: RoomDef | null; // when inside, clamp to the room instead of colliders
  disabled: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const keys = useRef<Record<string, boolean>>({});
  const heading = useRef(Math.PI / 2);
  const camYaw = useRef(Math.PI / 2);
  const speedRef = useRef(0);
  const camera = useThree((s) => s.camera);

  const snapCam = useRef(true);
  const api = useMemo<PlayerApi>(
    () => ({
      position: new THREE.Vector3(-6, 0, 1.5),
      teleport(pos, faceY) {
        this.position.set(pos[0], pos[1], pos[2]);
        if (faceY !== undefined) {
          heading.current = faceY;
          camYaw.current = faceY;
        }
        if (group.current) {
          group.current.position.copy(this.position);
          group.current.rotation.y = heading.current;
        }
        snapCam.current = true;
      },
    }),
    [],
  );
  props.apiRef.current = api;

  const drag = useRef<{ active: boolean; lastX: number; lastY: number }>({ active: false, lastX: 0, lastY: 0 });
  const camPitch = useRef(0);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      keys.current[e.code] = true;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      keys.current[e.code] = false;
    };
    // Drag anywhere on the canvas to orbit the camera (GTA-style look-around).
    const pdown = (e: PointerEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName !== "CANVAS") return;
      drag.current = { active: true, lastX: e.clientX, lastY: e.clientY };
    };
    const pmove = (e: PointerEvent) => {
      if (!drag.current.active) return;
      const dx = e.clientX - drag.current.lastX;
      const dy = e.clientY - drag.current.lastY;
      drag.current.lastX = e.clientX;
      drag.current.lastY = e.clientY;
      camYaw.current -= dx * 0.006;
      camPitch.current = THREE.MathUtils.clamp(camPitch.current + dy * 0.004, -0.5, 0.55);
    };
    const pup = () => {
      drag.current.active = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("pointerdown", pdown);
    window.addEventListener("pointermove", pmove);
    window.addEventListener("pointerup", pup);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("pointerdown", pdown);
      window.removeEventListener("pointermove", pmove);
      window.removeEventListener("pointerup", pup);
    };
  }, []);

  const velocity = useRef(new THREE.Vector3());
  const lookTarget = useRef(new THREE.Vector3());

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const k = keys.current;
    let fwd = 0;
    let strafe = 0;
    if (!props.disabled) {
      if (k.KeyW || k.ArrowUp) fwd += 1;
      if (k.KeyS || k.ArrowDown) fwd -= 1;
      if (k.KeyA || k.ArrowLeft) strafe += 1;
      if (k.KeyD || k.ArrowRight) strafe -= 1;
    }
    const running = Boolean(k.ShiftLeft || k.ShiftRight);
    const moving = fwd !== 0 || strafe !== 0;

    // ---- Velocity model: accelerate toward the target velocity, brake to a
    // stop. This is what makes starts/stops/turns feel weighted, not snappy.
    const targetVel = new THREE.Vector3();
    if (moving) {
      targetVel
        .set(
          Math.sin(camYaw.current) * fwd + Math.sin(camYaw.current + Math.PI / 2) * strafe,
          0,
          Math.cos(camYaw.current) * fwd + Math.cos(camYaw.current + Math.PI / 2) * strafe,
        )
        .normalize()
        .multiplyScalar(running ? RUN : WALK);
    }
    const rate = moving ? ACCEL : DECEL;
    const blend = 1 - Math.exp(-rate * dt * 0.6);
    velocity.current.lerp(targetVel, blend);
    const speed = velocity.current.length();
    speedRef.current = speed;
    if (speed > 0.02) {
      const step = velocity.current.clone().multiplyScalar(dt);
      const target = api.position.clone().add(step);
      const r = 0.35;

      if (props.room) {
        const [cx, cz] = props.room.center;
        const hx = props.room.size[0] / 2 - r;
        const hz = props.room.size[1] / 2 - r;
        target.x = THREE.MathUtils.clamp(target.x, cx - hx, cx + hx);
        target.z = THREE.MathUtils.clamp(target.z, cz - hz, cz + hz);
        api.position.copy(target);
      } else {
        const tryAxis = (nx: number, nz: number) => {
          for (const [bx, bz, hx, hz] of props.colliders) {
            if (nx > bx - hx - r && nx < bx + hx + r && nz > bz - hz - r && nz < bz + hz + r) return false;
          }
          return true;
        };
        const nx = THREE.MathUtils.clamp(target.x, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX);
        const nz = THREE.MathUtils.clamp(target.z, WORLD_BOUNDS.minZ, WORLD_BOUNDS.maxZ);
        if (tryAxis(nx, api.position.z)) api.position.x = nx;
        else velocity.current.x *= 0.4;
        if (tryAxis(api.position.x, nz)) api.position.z = nz;
        else velocity.current.z *= 0.4;
      }

      // Face the direction of travel; turn rate scales with speed so slow
      // steps pivot gently and sprints whip around.
      const desired = Math.atan2(velocity.current.x, velocity.current.z);
      let dh = desired - heading.current;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      heading.current += dh * (1 - Math.exp(-(6 + speed * 1.6) * dt));
      if (!drag.current.active) {
        let dc = heading.current - camYaw.current;
        while (dc > Math.PI) dc -= Math.PI * 2;
        while (dc < -Math.PI) dc += Math.PI * 2;
        camYaw.current += dc * (1 - Math.exp(-2.4 * dt));
      }
    }

    if (group.current) {
      group.current.position.copy(api.position);
      group.current.rotation.y = heading.current;
    }

    // Third-person follow camera with drag pitch and boom collision: if the
    // desired position sits inside a building, shorten the boom until clear.
    const maxDist = props.room ? 2.6 : 5.2;
    let dist = maxDist;
    if (!props.room) {
      const margin = 0.5;
      for (let tBoom = 1; tBoom >= 0.25; tBoom -= 0.125) {
        const cx = api.position.x - Math.sin(camYaw.current) * maxDist * tBoom;
        const cz = api.position.z - Math.cos(camYaw.current) * maxDist * tBoom;
        let blocked = false;
        for (const [bx, bz, hx, hz] of props.colliders) {
          if (cx > bx - hx - margin && cx < bx + hx + margin && cz > bz - hz - margin && cz < bz + hz + margin) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          dist = maxDist * tBoom;
          break;
        }
        dist = maxDist * 0.25;
      }
    }
    const height = (props.room ? 1.7 : 2.0 + 0.5 * (dist / maxDist)) + camPitch.current * dist;
    const camPos = new THREE.Vector3(
      api.position.x - Math.sin(camYaw.current) * dist,
      api.position.y + height,
      api.position.z - Math.cos(camYaw.current) * dist,
    );
    if (props.room) {
      // Keep the camera inside the room shell.
      const [cx, cz] = props.room.center;
      const hx = props.room.size[0] / 2 - 0.3;
      const hz = props.room.size[1] / 2 - 0.3;
      camPos.x = THREE.MathUtils.clamp(camPos.x, cx - hx, cx + hx);
      camPos.z = THREE.MathUtils.clamp(camPos.z, cz - hz, cz + hz);
      camPos.y = Math.min(camPos.y, 2.45);
    }
    if (snapCam.current) {
      // Hard-place the camera on spawn/teleport so it never eases in from a
      // stale position (which read as "first person" on load).
      camera.position.copy(camPos);
      lookTarget.current.copy(api.position).add(new THREE.Vector3(0, 1.35, 0));
      snapCam.current = false;
    } else {
      // Critically-damped style follow: position eases harder than the look
      // point, giving the slight camera lag that reads as weight.
      camera.position.lerp(camPos, 1 - Math.exp(-6 * dt));
      const lookGoal = api.position.clone().add(new THREE.Vector3(0, 1.35, 0)).addScaledVector(velocity.current, 0.12);
      lookTarget.current.lerp(lookGoal, 1 - Math.exp(-10 * dt));
    }
    camera.lookAt(lookTarget.current);
  });

  const clip = speedRef.current > 3.2 ? "run" : speedRef.current > 0.35 ? "walk" : "idle";
  // Sync stride cadence to actual ground speed so feet never skate.
  const timeScale =
    clip === "walk" ? THREE.MathUtils.clamp(speedRef.current / WALK, 0.6, 1.5)
    : clip === "run" ? THREE.MathUtils.clamp(speedRef.current / RUN, 0.7, 1.3)
    : 1;

  return (
    <group ref={group}>
      <RiggedCharacter glbKey="playerboy-rigged" height={1.58} clip={clip} timeScale={timeScale} coat="#4a4237" />
    </group>
  );
}
