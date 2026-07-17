import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Sky, Text } from "@react-three/drei";
import { BUILDINGS, PROPS, LOCATIONS, NPCS, AMBIENT, type LocationDef } from "./manifest.js";
import { FittedGlb, RiggedCharacter, PlaceholderPerson } from "./Character.js";

// ---- Ground: packed-earth street through dirt and worn grass ----
function useGroundTexture(): THREE.CanvasTexture {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 512;
    const g = c.getContext("2d")!;
    g.fillStyle = "#6f6049";
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 4200; i++) {
      const shade = 90 + Math.random() * 50;
      g.fillStyle = `rgba(${shade + 12},${shade - 4},${shade - 28},${0.16 + Math.random() * 0.2})`;
      g.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }
    // wheel ruts along x
    g.strokeStyle = "rgba(52,42,30,0.5)";
    g.lineWidth = 5;
    for (const y of [216, 232, 286, 300]) {
      g.beginPath();
      g.moveTo(0, y + Math.random() * 6);
      for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x * 0.03) * 5 + Math.random() * 3);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(10, 6);
    tex.anisotropy = 4;
    return tex;
  }, []);
}

function Ground() {
  const tex = useGroundTexture();
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[220, 160]} />
        <meshStandardMaterial color="#5d6b46" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <planeGeometry args={[130, 15]} />
        <meshStandardMaterial map={tex} roughness={1} />
      </mesh>
      {/* side lane to the rider post and the elm pocket */}
      <mesh rotation={[-Math.PI / 2, 0, 0.45]} position={[-42, 0.015, -18]} receiveShadow>
        <planeGeometry args={[7, 34]} />
        <meshStandardMaterial map={tex} roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, -0.5]} position={[40, 0.015, -14]} receiveShadow>
        <planeGeometry args={[8, 30]} />
        <meshStandardMaterial map={tex} roughness={1} />
      </mesh>
    </group>
  );
}

// ---- Fallback building shell when a GLB is missing ----
function BuildingShell(props: { size: [number, number, number]; color: string }) {
  const [w, h, d] = props.size;
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={props.color} roughness={0.95} />
      </mesh>
      <mesh position={[0, h + h * 0.22, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[Math.max(w, d) * 0.72, h * 0.5, 4]} />
        <meshStandardMaterial color="#4a3b2c" roughness={1} />
      </mesh>
      {/* door + windows to break up the mass */}
      <mesh position={[0, 1.05, d / 2 + 0.02]}>
        <planeGeometry args={[1.0, 2.1]} />
        <meshStandardMaterial color="#2e2419" roughness={1} />
      </mesh>
      {[-w / 4, w / 4].map((x) => (
        <mesh key={x} position={[x, h * 0.62, d / 2 + 0.02]}>
          <planeGeometry args={[0.9, 1.2]} />
          <meshStandardMaterial color="#1d2733" roughness={0.4} metalness={0.1} />
        </mesh>
      ))}
    </group>
  );
}

function Buildings() {
  return (
    <group>
      {BUILDINGS.map((b) => (
        <group key={b.id} position={b.pos} rotation={[0, b.rotY, 0]}>
          <FittedGlb glbKey={b.glb ?? ""} size={b.size} fallback={<BuildingShell size={b.size} color={b.color} />} />
        </group>
      ))}
      {/* Mercer's hanging sign */}
      <group position={[0, 3.1, 6.9]}>
        <mesh position={[0, 0.55, 0]}>
          <boxGeometry args={[0.08, 1.1, 0.08]} />
          <meshStandardMaterial color="#3a2f22" />
        </mesh>
        <mesh castShadow>
          <boxGeometry args={[1.7, 0.8, 0.07]} />
          <meshStandardMaterial color="#2f2419" roughness={0.9} />
        </mesh>
        <Text position={[0, 0.08, 0.045]} fontSize={0.21} color="#d8c58c" anchorX="center" anchorY="middle" maxWidth={1.6}>
          MERCER'S PRESS
        </Text>
        <Text position={[0, -0.2, 0.045]} fontSize={0.1} color="#a5946a" anchorX="center" anchorY="middle">
          PRINTING · NOTICES
        </Text>
      </group>
    </group>
  );
}

function Props3D() {
  return (
    <group>
      {PROPS.map((p, i) => (
        <group key={i} position={p.pos} rotation={[0, p.rotY, 0]}>
          <FittedGlb
            glbKey={p.glb}
            scale={p.scale}
            size={p.glb === "liberty-elm" ? [14, 16, 14] : p.glb.startsWith("bldg") ? undefined : [2.6, 2.6, 2.6]}
            fallback={
              <mesh position={[0, 0.6, 0]} castShadow>
                <boxGeometry args={[1.4, 1.2, 1.1]} />
                <meshStandardMaterial color="#6a5138" roughness={1} />
              </mesh>
            }
          />
        </group>
      ))}
    </group>
  );
}

// ---- Interior room, rendered only for the active interior location ----
const INTERIOR_PROPS: Record<string, { glb: string; pos: [number, number, number]; rotY: number; size?: [number, number, number] }[]> = {
  MERCER_PRESS: [
    { glb: "press-common", pos: [-2.4, 0, 10.6], rotY: 0.5, size: [2.6, 2.4, 2.6] },
    { glb: "type-cases", pos: [3.1, 0, 11.6], rotY: -Math.PI / 2, size: [2.2, 1.6, 2.2] },
    { glb: "clerk-desk", pos: [0.6, 0, 12.2], rotY: Math.PI, size: [1.8, 1.8, 1.4] },
  ],
  THOMAS_COUNTINGHOUSE: [
    { glb: "shop-counter", pos: [-30, 0, -12.6], rotY: 0, size: [3, 1.4, 1.4] },
    { glb: "cloth-bolts", pos: [-33.4, 0, -11.6], rotY: 0.4, size: [2, 1.4, 2] },
    { glb: "crate-stack", pos: [-26.8, 0, -12.4], rotY: -0.3, size: [2.2, 1.8, 1.8] },
  ],
  PIKE_OFFICE: [
    { glb: "clerk-desk", pos: [14.8, 0, 11.6], rotY: Math.PI, size: [1.8, 1.8, 1.4] },
    { glb: "crate-stack", pos: [11.4, 0, 11.8], rotY: 0.3, size: [1.8, 1.5, 1.5] },
  ],
  CUSTOM_HOUSE: [
    { glb: "shop-counter", pos: [40, 0, 11.6], rotY: 0, size: [4, 1.4, 1.4] },
    { glb: "clerk-desk", pos: [44.2, 0, 12.6], rotY: Math.PI - 0.4, size: [1.8, 1.8, 1.4] },
    { glb: "notice-board", pos: [35.6, 0, 12.8], rotY: 0.35, size: [2, 2.4, 0.8] },
  ],
};

function InteriorRoom(props: { loc: LocationDef }) {
  const room = props.loc.room!;
  const [cx, cz] = room.center;
  const [w, d] = room.size;
  const H = 2.75;
  const doorZ = room.doorSide === "S" ? cz - d / 2 : cz + d / 2;
  const wallMat = <meshStandardMaterial color="#b7a98c" roughness={1} side={THREE.DoubleSide} />;
  return (
    <group>
      {/* floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.03, cz]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#7c6244" roughness={1} />
      </mesh>
      {/* ceiling */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[cx, H, cz]}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#5f4c36" roughness={1} side={THREE.DoubleSide} />
      </mesh>
      {/* east/west walls */}
      <mesh position={[cx - w / 2, H / 2, cz]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[d, H]} />
        {wallMat}
      </mesh>
      <mesh position={[cx + w / 2, H / 2, cz]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[d, H]} />
        {wallMat}
      </mesh>
      {/* solid back wall */}
      <mesh position={[cx, H / 2, room.doorSide === "S" ? cz + d / 2 : cz - d / 2]}>
        <planeGeometry args={[w, H]} />
        {wallMat}
      </mesh>
      {/* door wall: two segments leaving a 1.2m gap */}
      <mesh position={[cx - w / 4 - 0.3, H / 2, doorZ]}>
        <planeGeometry args={[w / 2 - 0.6, H]} />
        {wallMat}
      </mesh>
      <mesh position={[cx + w / 4 + 0.3, H / 2, doorZ]}>
        <planeGeometry args={[w / 2 - 0.6, H]} />
        {wallMat}
      </mesh>
      <mesh position={[cx, H - 0.35, doorZ]}>
        <planeGeometry args={[1.4, 0.7]} />
        {wallMat}
      </mesh>
      {/* warm interior light + window glow */}
      <pointLight position={[cx, H - 0.4, cz]} intensity={14} distance={12} color="#ffd9a0" castShadow={false} />
      <pointLight position={[cx + w / 3, 1.4, cz]} intensity={5} distance={7} color="#ffe7c4" />
      {(INTERIOR_PROPS[props.loc.id] ?? []).map((p, i) => (
        <group key={i} position={p.pos} rotation={[0, p.rotY, 0]}>
          <FittedGlb
            glbKey={p.glb}
            size={p.size}
            fallback={
              <mesh position={[0, 0.5, 0]} castShadow>
                <boxGeometry args={[1.2, 1, 0.8]} />
                <meshStandardMaterial color="#5d4a34" roughness={1} />
              </mesh>
            }
          />
        </group>
      ))}
    </group>
  );
}

// ---- Effigy hanging from the elm (documented Aug 14 staging) ----
function Effigy() {
  return (
    <group position={[44, 0, -27]}>
      <mesh position={[1.6, 4.6, 1.2]}>
        <cylinderGeometry args={[0.015, 0.015, 1.6]} />
        <meshStandardMaterial color="#3c3327" />
      </mesh>
      <group position={[1.6, 3.4, 1.2]} rotation={[0.06, 0.4, 0.1]}>
        <mesh castShadow>
          <capsuleGeometry args={[0.16, 0.6, 4, 8]} />
          <meshStandardMaterial color="#8a7a5c" roughness={1} />
        </mesh>
        <mesh position={[0, 0.55, 0]} castShadow>
          <sphereGeometry args={[0.14, 10, 8]} />
          <meshStandardMaterial color="#9c8b6b" roughness={1} />
        </mesh>
        <Text position={[0, 0.05, 0.2]} fontSize={0.12} color="#2e2517" anchorX="center">
          A. O.
        </Text>
      </group>
    </group>
  );
}

function Npcs(props: { interiorId: string | null }) {
  return (
    <group>
      {NPCS.map((n) => {
        const visible = n.interiorOf ? props.interiorId === n.interiorOf : props.interiorId === null;
        if (!visible) return null;
        return (
          <group key={n.id} position={n.pos} rotation={[0, n.rotY, 0]}>
            <RiggedCharacter glbKey={n.glb} height={n.height} clip={n.clip} />
          </group>
        );
      })}
    </group>
  );
}

function AmbientWalker(props: {
  glb: string;
  from: [number, number, number];
  to: [number, number, number];
  speed: number;
  offset: number;
}) {
  const ref = useRef<THREE.Group>(null);
  const a = useMemo(() => new THREE.Vector3(...props.from), [props.from]);
  const b = useMemo(() => new THREE.Vector3(...props.to), [props.to]);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const dist = a.distanceTo(b);
    const period = (dist / props.speed) * 2;
    const t = ((clock.elapsedTime * 1 + props.offset) % period) / period;
    const seg = t < 0.5 ? t * 2 : (1 - t) * 2;
    const from = t < 0.5 ? a : b;
    const to = t < 0.5 ? b : a;
    ref.current.position.lerpVectors(from, to, seg);
    ref.current.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
  });
  return (
    <group ref={ref}>
      <RiggedCharacter glbKey={props.glb} height={1.68} clip="walk" timeOffset={props.offset} />
    </group>
  );
}

function AmbientFolk(props: { interiorId: string | null }) {
  if (props.interiorId) return null;
  return (
    <group>
      {AMBIENT.map((a, i) =>
        a.path ? (
          <AmbientWalker key={i} glb={a.glb} from={a.pos} to={a.path.to} speed={a.path.speed} offset={i * 3.1} />
        ) : (
          <group key={i} position={a.pos} rotation={[0, a.rotY, 0]}>
            <RiggedCharacter glbKey={a.glb} height={1.68} clip={a.clip} timeOffset={i * 0.7} coat={i % 2 ? "#54432f" : "#3f4653"} />
          </group>
        ),
      )}
    </group>
  );
}

// ---- Day light rig driven by the runtime clock ----
export function DayLight(props: { t: number; dusk: boolean }) {
  const t = props.dusk ? 1 : props.t;
  const elev = THREE.MathUtils.lerp(58, 7, t);
  const azim = THREE.MathUtils.lerp(115, 245, t);
  const phi = THREE.MathUtils.degToRad(90 - elev);
  const theta = THREE.MathUtils.degToRad(azim);
  const sun = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
  const sunColor = new THREE.Color().lerpColors(new THREE.Color("#fff4e0"), new THREE.Color("#ff8a3d"), t * t);
  const intensity = THREE.MathUtils.lerp(2.6, 1.0, t);
  return (
    <group>
      <Sky sunPosition={[sun.x * 100, sun.y * 100, sun.z * 100]} turbidity={6 + t * 6} rayleigh={1.2 + t * 2.4} mieCoefficient={0.006} mieDirectionalG={0.8} />
      <hemisphereLight args={["#c8d9ee", "#8a7355", THREE.MathUtils.lerp(0.75, 0.32, t)]} />
      <directionalLight
        position={[sun.x * 60, Math.max(sun.y * 60, 6), sun.z * 60]}
        intensity={intensity}
        color={sunColor}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
        shadow-bias={-0.0004}
      />
      {props.dusk && <pointLight position={[44, 3.5, -27]} intensity={30} distance={26} color="#ff9040" />}
    </group>
  );
}

export function District(props: { interiorId: string | null; t: number; dusk: boolean }) {
  const interiorLoc = props.interiorId ? LOCATIONS[props.interiorId] : null;
  return (
    <group>
      <DayLight t={props.t} dusk={props.dusk} />
      <Ground />
      <Buildings />
      <Props3D />
      <Effigy />
      <Npcs interiorId={props.interiorId} />
      <AmbientFolk interiorId={props.interiorId} />
      {interiorLoc?.room && <InteriorRoom loc={interiorLoc} />}
    </group>
  );
}
