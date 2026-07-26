import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import {
  ImportedPivotAsset,
  InteriorStructure,
  chooseInteriorFloorGrid,
} from "@pa/engine-world";

// ---------------------------------------------------------------------------
// The hub interior: a printer's back room the player launches operations from.
//
// Every visible surface and object is an imported production GLB, loaded through
// the same InteriorStructure path the in-world interiors use (shell + floor
// tiles + fitted props). Nothing physical is built from primitives; the only
// procedural geometry in the hub is the System's own holographic dais, which is
// UI, not set dressing.
// ---------------------------------------------------------------------------

/** Small, authored, intimate. Ratio tracks the shell's authored 1.33 footprint. */
export const HUB_ROOM = { width: 8.6, height: 3.4, depth: 6.6 } as const;

interface PropPlacement {
  id: string;
  glbKey: string;
  /** [x, y, z] in room-local metres; y=0 is the floor. */
  position: [number, number, number];
  rotY: number;
  /** Fitting box the imported asset is normalized into. */
  size: [number, number, number];
}

const HALF_W = HUB_ROOM.width / 2;
const HALF_D = HUB_ROOM.depth / 2;

// Set dressing hugs the walls so the turntable silhouette stays clean. The
// press is the hero read; -interior-lod variants carry the rest cheaply.
const ROOM_PROPS: readonly PropPlacement[] = [
  { id: "press", glbKey: "press-common-operable-v2", position: [-2.5, 0, -1.95], rotY: 0.42, size: [2.5, 2.3, 2.0] },
  { id: "type-cases", glbKey: "type-cases", position: [HALF_W - 0.55, 0, -0.85], rotY: -Math.PI / 2, size: [2.0, 1.9, 1.0] },
  { id: "composition", glbKey: "printer-composition-workstation", position: [2.35, 0, -2.15], rotY: -0.3, size: [1.9, 1.5, 1.2] },
  { id: "drying-rack", glbKey: "printer-drying-rack", position: [0.45, 0, -2.75], rotY: 0.06, size: [1.7, 1.9, 0.7] },
  { id: "desk", glbKey: "clerk-desk", position: [-HALF_W + 0.95, 0, 1.15], rotY: Math.PI / 2, size: [1.7, 1.6, 1.1] },
  // Back wall (camera-facing): fills the frame behind the turntable with
  // imported detail instead of an empty plank expanse.
  { id: "ledgers", glbKey: "bookshelf-ledgers-interior-lod", position: [-3.35, 0, -2.95], rotY: 0, size: [1.9, 2.1, 0.6] },
  { id: "hearth", glbKey: "hearth-mantel-interior-lod", position: [3.05, 0, -2.92], rotY: 0, size: [2.0, 1.9, 0.75] },
  { id: "notice", glbKey: "notice-board-interior-lod", position: [1.55, 1.5, -3.12], rotY: 0, size: [1.3, 0.95, 0.14] },
  { id: "crates", glbKey: "crate-stack-interior-lod", position: [-2.9, 0, 2.15], rotY: 0.28, size: [1.4, 1.2, 1.2] },
  { id: "chest", glbKey: "storage-chest-interior-lod", position: [2.95, 0, 2.35], rotY: -0.2, size: [1.1, 0.65, 0.65] },
  { id: "sconce-left", glbKey: "candle-sconce-interior-lod", position: [-HALF_W + 0.14, 1.62, -2.5], rotY: Math.PI / 2, size: [0.36, 0.72, 0.36] },
  { id: "sconce-right", glbKey: "candle-sconce-interior-lod", position: [HALF_W - 0.14, 1.62, 0.35], rotY: -Math.PI / 2, size: [0.36, 0.72, 0.36] },
];

const HEARTH_INTENSITY = 5.4;

/** Warm points that read as the sconce/hearth flames. */
const WARM_LOCALS: ReadonlyArray<{ position: [number, number, number]; intensity: number; distance: number }> = [
  { position: [-HALF_W + 0.4, 1.66, -2.5], intensity: 3.1, distance: 4.4 },
  { position: [HALF_W - 0.4, 1.66, 0.35], intensity: 2.6, distance: 4.0 },
];

export function HubRoom(props: { reducedMotion: boolean }) {
  const floorGrid = useMemo(
    () => chooseInteriorFloorGrid(HUB_ROOM.width, HUB_ROOM.depth),
    [],
  );
  const hearthRef = useRef<THREE.PointLight>(null);

  // A slow candle/hearth breath. Reduced motion holds the light steady.
  useFrame(({ clock }) => {
    const light = hearthRef.current;
    if (!light) return;
    if (props.reducedMotion) {
      light.intensity = HEARTH_INTENSITY;
      return;
    }
    const t = clock.elapsedTime;
    light.intensity =
      HEARTH_INTENSITY *
      (0.93 + Math.sin(t * 2.3) * 0.045 + Math.sin(t * 5.7 + 1.1) * 0.025);
  });

  return (
    <group>
      {/* --- Lighting: warm lamplight against the System's cold blue -------
          The key light hangs INSIDE the room, below the ceiling plane, so the
          shell never sits between it and the floor. */}
      {/* Ambient/hemisphere colours follow the production interior contract
          (InteriorDirector): near-white sky, warm ground bounce. A browner,
          dimmer ambient is what left the floorboards reading as black. */}
      <ambientLight intensity={0.8} color="#c8b99f" />
      <hemisphereLight color="#cbd8dd" groundColor="#6a4c34" intensity={0.72} />

      {/* Soft overhead wash, straight down: lifts the floor without flattening
          the walls the way more ambient would. */}
      <directionalLight position={[0.5, 3.2, 0.7]} color="#ffcf9c" intensity={1.15} />

      <directionalLight
        position={[2.9, 2.7, 1.9]}
        color="#ffbd82"
        intensity={2.4}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-radius={4}
        shadow-bias={-0.0004}
        shadow-normalBias={0.035}
      >
        <orthographicCamera attach="shadow-camera" args={[-5.5, 5.5, 5.5, -5.5, 0.3, 16]} />
      </directionalLight>

      {/* Cool rim from behind: separates the player from the dark back wall. */}
      <directionalLight position={[-3.2, 2.4, -3.4]} color="#68b8ff" intensity={1.35} />
      {/* Cold System fill from the panel side, low and wide. */}
      <directionalLight position={[0, 1.2, 4.2]} color="#3d7ac8" intensity={0.5} />

      {/* The room's practical: a lamp over the working floor. */}
      <pointLight position={[0, 2.62, 0.5]} color="#ffbe7a" intensity={9.5} distance={11} decay={2} />
      {/* Warm bounce at knee height so the boards read instead of going black. */}
      <pointLight position={[0.4, 0.8, 1.6]} color="#ffb268" intensity={4.6} distance={7.2} decay={2} />

      <pointLight
        ref={hearthRef}
        position={[3.05, 1.0, -2.5]}
        color="#ff8a3c"
        intensity={HEARTH_INTENSITY}
        distance={7}
        decay={2}
      />
      {WARM_LOCALS.map((local, index) => (
        <pointLight
          key={index}
          position={local.position}
          color="#ffc27a"
          intensity={local.intensity}
          distance={local.distance}
          decay={2}
        />
      ))}
      {/* The System's own glow, sitting on the floor with the dais. */}
      <pointLight position={[0, 0.5, -0.4]} color="#63d2ff" intensity={2.6} distance={4.4} decay={2} />

      {/* --- Imported shell + floor -------------------------------------- */}
      <InteriorStructure
        glbKey="int-shell-workroom-a"
        size={[HUB_ROOM.width, HUB_ROOM.height, HUB_ROOM.depth]}
        variant="shell"
        yaw={0}
        canonical
      />
      {Array.from({ length: floorGrid.columns * floorGrid.rows }, (_, index) => {
        const column = index % floorGrid.columns;
        const row = Math.floor(index / floorGrid.columns);
        return (
          <group
            key={`floor:${column}:${row}`}
            position={[
              -HALF_W + floorGrid.cellWidth * (column + 0.5),
              0,
              -HALF_D + floorGrid.cellDepth * (row + 0.5),
            ]}
          >
            <InteriorStructure
              glbKey="int-floor-wide-pine-a"
              size={[floorGrid.cellWidth, 0.18, floorGrid.cellDepth]}
              variant="floor"
              yaw={0}
              canonical
            />
          </group>
        );
      })}

      {/* --- Imported set dressing ---------------------------------------
          ImportedPivotAsset fits each production GLB uniformly into its box and
          grounds it; a missing asset renders nothing rather than a primitive. */}
      {ROOM_PROPS.map((placement) => (
        <group
          key={placement.id}
          position={placement.position}
          rotation={[0, placement.rotY, 0]}
        >
          <ImportedPivotAsset glbKey={placement.glbKey} size={placement.size} />
        </group>
      ))}
    </group>
  );
}
