// WeatherDirector: deterministic GLOOM -> DRIZZLE -> CLEARING day (Bible §6).
// The schedule itself lives in atmosphere.ts (shared with the sky and audio);
// this director renders the visible weather: instanced rain streaks in a
// cylinder around the camera, a wet puddle-sheen overlay on the street, and
// subtle god-ray billboards when the sky breaks toward dusk. Reduced motion:
// no particles; lighting/wetness still follow the schedule.

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { mulberry32, type Atmosphere } from "./atmosphere.js";

const RAIN_COUNT = 340;
const RAIN_RADIUS = 15;
const RAIN_TOP = 13;
const RAIN_SPEED = 10.5;

function Rain(props: { atmo: Atmosphere }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const drops = useMemo(() => {
    const rnd = mulberry32(1122);
    return Array.from({ length: RAIN_COUNT }, () => ({
      // offset from camera, cylindrical; 2m inner clearing so streaks never
      // smear across the lens
      angle: rnd() * Math.PI * 2,
      radius: 2 + Math.sqrt(rnd()) * (RAIN_RADIUS - 2),
      y: rnd() * RAIN_TOP,
      speed: RAIN_SPEED * (0.85 + rnd() * 0.3),
      rotY: rnd() * Math.PI,
    }));
  }, []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ camera }, dt) => {
    const im = mesh.current;
    if (!im) return;
    const intensity = props.atmo.rain;
    if (mat.current) {
      mat.current.opacity = THREE.MathUtils.lerp(
        mat.current.opacity,
        intensity > 0.02 ? 0.13 + intensity * 0.16 : 0,
        1 - Math.exp(-dt * 3),
      );
    }
    const visible = Math.round(RAIN_COUNT * intensity);
    for (let i = 0; i < RAIN_COUNT; i++) {
      const d = drops[i]!;
      if (i < visible) {
        d.y -= d.speed * dt;
        if (d.y < -0.5) d.y += RAIN_TOP + 0.5;
        dummy.position.set(
          camera.position.x + Math.cos(d.angle) * d.radius,
          d.y,
          camera.position.z + Math.sin(d.angle) * d.radius,
        );
        dummy.rotation.set(0, d.rotY, 0.06);
        dummy.scale.setScalar(1);
      } else {
        dummy.position.set(0, -60, 0);
        dummy.scale.setScalar(0.001);
      }
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, RAIN_COUNT]} frustumCulled={false} renderOrder={3}>
      <planeGeometry args={[0.014, 0.52]} />
      <meshBasicMaterial
        ref={mat}
        color="#c7d3da"
        transparent
        opacity={0}
        depthWrite={false}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </instancedMesh>
  );
}

// Wet street sheen: a barely-there glossy overlay over the packed-earth strip.
// Roughness drops and the tint darkens as wetness rises, faking puddle gloss
// without touching the ground material the layout worker owns.
function PuddleSheen(props: { atmo: Atmosphere }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((_, dt) => {
    const m = mat.current;
    if (!m) return;
    const k = 1 - Math.exp(-dt * 2);
    m.opacity = THREE.MathUtils.lerp(m.opacity, 0.07 + props.atmo.wetness * 0.2, k);
    m.roughness = THREE.MathUtils.lerp(m.roughness, 0.42 - props.atmo.wetness * 0.3, k);
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.045, 0]} receiveShadow renderOrder={1}>
      <planeGeometry args={[132, 15.5]} />
      <meshStandardMaterial
        ref={mat}
        color="#1d232b"
        metalness={0.55}
        roughness={0.25}
        transparent
        opacity={0}
        depthWrite={false}
      />
    </mesh>
  );
}

// Broken-cloud light shafts for CLEARING: 3 slanted additive billboards,
// aligned with the sun azimuth, gently pulsing. Subtle by design.
function useShaftTexture(): THREE.CanvasTexture {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 256;
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "rgba(255,236,190,0.55)");
    grad.addColorStop(0.75, "rgba(255,224,168,0.14)");
    grad.addColorStop(1, "rgba(255,220,160,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 256);
    // soften the sides
    const side = g.createLinearGradient(0, 0, 64, 0);
    side.addColorStop(0, "rgba(0,0,0,1)");
    side.addColorStop(0.25, "rgba(0,0,0,0)");
    side.addColorStop(0.75, "rgba(0,0,0,0)");
    side.addColorStop(1, "rgba(0,0,0,1)");
    g.globalCompositeOperation = "destination-out";
    g.fillStyle = side;
    g.fillRect(0, 0, 64, 256);
    return new THREE.CanvasTexture(c);
  }, []);
}

const SHAFTS: { x: number; z: number; w: number; phase: number }[] = [
  { x: -18, z: -2, w: 7, phase: 0.4 },
  { x: 14, z: 3, w: 9, phase: 2.1 },
  { x: 42, z: -6, w: 6, phase: 4.4 },
];

function LightShafts(props: { atmo: Atmosphere; reducedMotion: boolean }) {
  const tex = useShaftTexture();
  const mats = useRef<THREE.MeshBasicMaterial[]>([]);
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }, dt) => {
    const a = props.atmo;
    const k = 1 - Math.exp(-dt * 1.6);
    const sunAngle = Math.atan2(a.sunDir.x, a.sunDir.z);
    if (group.current) {
      group.current.rotation.y = sunAngle;
      // lean the shafts along the low sun
      group.current.rotation.z = THREE.MathUtils.lerp(0.1, 0.35, a.t);
    }
    SHAFTS.forEach((s, i) => {
      const m = mats.current[i];
      if (!m) return;
      const pulse = props.reducedMotion ? 1 : 0.75 + 0.25 * Math.sin(clock.elapsedTime * 0.35 + s.phase);
      m.opacity = THREE.MathUtils.lerp(m.opacity, a.shafts * 0.16 * pulse, k);
    });
  });
  if (props.atmo.shafts <= 0.01) return null;
  return (
    <group ref={group}>
      {SHAFTS.map((s, i) => (
        <mesh key={i} position={[s.x, 13, s.z]} rotation={[0, 0, 0.12]} renderOrder={2}>
          <planeGeometry args={[s.w, 26]} />
          <meshBasicMaterial
            ref={(m) => {
              if (m) mats.current[i] = m;
            }}
            map={tex}
            transparent
            opacity={0}
            depthWrite={false}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

export function WeatherDirector(props: {
  atmo: Atmosphere;
  reducedMotion: boolean;
  interiorId: string | null;
}) {
  const outside = props.interiorId === null;
  return (
    <group>
      {outside && !props.reducedMotion && <Rain atmo={props.atmo} />}
      {outside && <PuddleSheen atmo={props.atmo} />}
      {outside && <LightShafts atmo={props.atmo} reducedMotion={props.reducedMotion} />}
    </group>
  );
}
