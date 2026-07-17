import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import type { InputRequest, PresenterEvent, RuntimeView } from "@pa/contracts";
import { District } from "./District.js";
import { Player, type PlayerApi } from "./Player.js";
import {
  LOCATIONS,
  MARKER_ANCHORS,
  EXTERIOR_TARGETS,
  exteriorColliders,
} from "./manifest.js";

interface MarkerSpec {
  targetId: string;
  label: string;
  gold: boolean;
  pos: [number, number, number];
}

function Marker(props: { m: MarkerSpec }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const s = clock.elapsedTime;
    ref.current.position.y = 1.9 + Math.sin(s * 2.2) * 0.12;
    ref.current.rotation.y = s * 1.4;
  });
  const color = props.m.gold ? "#f2c14e" : "#4aa3ff";
  return (
    <group position={props.m.pos}>
      <group ref={ref} position={[0, 1.9, 0]}>
        <mesh>
          <octahedronGeometry args={[0.24]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.6} />
        </mesh>
      </group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <ringGeometry args={[0.5, 0.68, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.65} />
      </mesh>
      <Html position={[0, 2.6, 0]} center distanceFactor={14} occlude={false}>
        <div className={`marker-label ${props.m.gold ? "gold" : "blue"}`}>{props.m.label}</div>
      </Html>
    </group>
  );
}

// Watches player distance to markers and fires GOTO once within range.
function MarkerTriggers(props: {
  markers: MarkerSpec[];
  apiRef: { current: PlayerApi | null };
  busy: boolean;
  onArrive: (targetId: string) => void;
}) {
  const fired = useRef<string | null>(null);
  useFrame(() => {
    if (props.busy || !props.apiRef.current) return;
    for (const m of props.markers) {
      const dx = props.apiRef.current.position.x - m.pos[0];
      const dz = props.apiRef.current.position.z - m.pos[2];
      if (dx * dx + dz * dz < 3.0 * 3.0) {
        if (fired.current !== m.targetId) {
          fired.current = m.targetId;
          props.onArrive(m.targetId);
        }
        return;
      }
    }
    fired.current = null;
  });
  return null;
}

export function World3D(props: {
  view: RuntimeView | null;
  request: InputRequest | null;
  busy: boolean;
  onEvent: (ev: PresenterEvent) => void;
}) {
  const apiRef = useRef<PlayerApi | null>(null);
  const colliders = useMemo(() => exteriorColliders(), []);
  const [webglOk] = useState(() => {
    try {
      const c = document.createElement("canvas");
      return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
    } catch {
      return false;
    }
  });

  const locationId = props.view?.locationId ?? "BOSTON_STREET";
  const loc = LOCATIONS[locationId] ?? LOCATIONS.BOSTON_STREET!;

  // Stepping out: interior location + free-roam targets pointing outside.
  const headedOut =
    props.request?.kind === "FREE_ROAM" &&
    props.request.targets.some((t) => EXTERIOR_TARGETS.has(t.targetId));
  const interiorId = loc.interior && !headedOut ? loc.id : null;

  // Teleport when the effective place changes.
  const placeKey = `${loc.id}|${interiorId ? "in" : "out"}`;
  const lastPlace = useRef<string>("");
  useEffect(() => {
    if (lastPlace.current === placeKey) return;
    lastPlace.current = placeKey;
    const api = apiRef.current;
    if (!api) return;
    if (interiorId) {
      api.teleport(loc.anchor, loc.faceY);
    } else if (loc.interior && loc.exitAnchor) {
      api.teleport(loc.exitAnchor, Math.PI + loc.faceY);
    } else {
      api.teleport(loc.anchor, loc.faceY);
    }
  }, [placeKey, loc, interiorId]);

  const markers: MarkerSpec[] = useMemo(() => {
    if (props.request?.kind !== "FREE_ROAM") return [];
    return props.request.targets
      .filter((t) => t.marker !== "HIDDEN")
      .map((t) => {
        const pos = MARKER_ANCHORS[t.targetId] ?? loc.anchor;
        return { targetId: t.targetId, label: t.label, gold: t.marker === "GOLD", pos };
      });
  }, [props.request, loc]);

  const clock = props.view?.clock;
  const t = clock ? Math.min(1, clock.spentUnits / Math.max(1, clock.fixedEventBoundary)) : 0;
  const dusk = clock?.phase === "DUSK" || locationId === "LIBERTY_TREE_APPROACH";

  if (!webglOk) {
    return <div className="world-fallback">3D view unavailable on this device. Use the controls below to play.</div>;
  }

  return (
    <div className="world3d">
      <Canvas
        shadows
        dpr={[1, 1.5]}
        camera={{ fov: 55, near: 0.1, far: 400, position: [-11, 2.6, 1.5] }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <fog attach="fog" args={[dusk ? "#3c2f28" : "#cfd8de", 60, 190]} />
        <District interiorId={interiorId} t={t} dusk={dusk} />
        <Player apiRef={apiRef} colliders={colliders} room={interiorId ? loc.room ?? null : null} disabled={props.busy} />
        {markers.map((m) => (
          <Marker key={m.targetId} m={m} />
        ))}
        <MarkerTriggers
          markers={markers}
          apiRef={apiRef}
          busy={props.busy}
          onArrive={(targetId) => props.onEvent({ type: "FREE_ROAM_GOTO", targetId })}
        />
      </Canvas>
      <div className="world-hint">WASD or arrows to walk · Shift to run · walk into a marker to choose it</div>
    </div>
  );
}
