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
const RUN = 4.4;

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
    const speed = moving ? (running ? RUN : WALK) : 0;
    speedRef.current = THREE.MathUtils.lerp(speedRef.current, speed, 0.2);

    if (moving) {
      const dir = new THREE.Vector3(
        Math.sin(camYaw.current) * fwd + Math.sin(camYaw.current + Math.PI / 2) * strafe,
        0,
        Math.cos(camYaw.current) * fwd + Math.cos(camYaw.current + Math.PI / 2) * strafe,
      ).normalize();

      const target = api.position.clone().addScaledVector(dir, speed * dt);
      const r = 0.35;

      if (props.room) {
        const [cx, cz] = props.room.center;
        const hx = props.room.size[0] / 2 - r;
        const hz = props.room.size[1] / 2 - r;
        // Door gap: allow passing slightly beyond the door wall near its center.
        target.x = THREE.MathUtils.clamp(target.x, cx - hx, cx + hx);
        target.z = THREE.MathUtils.clamp(target.z, cz - hz, cz + hz);
        api.position.copy(target);
      } else {
        // Axis-separated AABB slide.
        const tryAxis = (nx: number, nz: number) => {
          for (const [bx, bz, hx, hz] of props.colliders) {
            if (nx > bx - hx - r && nx < bx + hx + r && nz > bz - hz - r && nz < bz + hz + r) return false;
          }
          return true;
        };
        const nx = THREE.MathUtils.clamp(target.x, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX);
        const nz = THREE.MathUtils.clamp(target.z, WORLD_BOUNDS.minZ, WORLD_BOUNDS.maxZ);
        if (tryAxis(nx, api.position.z)) api.position.x = nx;
        if (tryAxis(api.position.x, nz)) api.position.z = nz;
      }

      const desired = Math.atan2(dir.x, dir.z);
      let dh = desired - heading.current;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      heading.current += dh * Math.min(1, dt * 10);
      // Camera yaw eases toward heading while moving (unless the player is
      // actively dragging to look around).
      if (!drag.current.active) {
        let dc = heading.current - camYaw.current;
        while (dc > Math.PI) dc -= Math.PI * 2;
        while (dc < -Math.PI) dc += Math.PI * 2;
        camYaw.current += dc * Math.min(1, dt * 2.2);
      }
    }

    if (group.current) {
      group.current.position.copy(api.position);
      group.current.rotation.y = heading.current;
    }

    // Third-person follow camera with drag pitch.
    const dist = props.room ? 2.6 : 5.2;
    const height = (props.room ? 1.7 : 2.5) + camPitch.current * dist;
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
      snapCam.current = false;
    } else {
      camera.position.lerp(camPos, Math.min(1, dt * 5));
    }
    const look = api.position.clone().add(new THREE.Vector3(0, 1.35, 0));
    camera.lookAt(look);
  });

  const clip = speedRef.current > 3 ? "run" : speedRef.current > 0.25 ? "walk" : "idle";

  return (
    <group ref={group}>
      <RiggedCharacter glbKey="playerboy-rigged" height={1.58} clip={clip} coat="#4a4237" />
    </group>
  );
}
