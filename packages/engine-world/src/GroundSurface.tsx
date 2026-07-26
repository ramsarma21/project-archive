import { Suspense, useEffect, useMemo } from "react";
import * as THREE from "three";
import { useTexture } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { GlbBoundary } from "./GlbBoundary.js";

// ---------------------------------------------------------------------------
// The ground.
//
// A level's traversable surface, drawn as flat plates carrying the asset
// pipeline's own paving materials. This is the one visible surface the project
// draws on generated geometry rather than on an imported mesh, and the reason is
// specific rather than convenient: the pipeline's road kit already generates its
// paving as SEAMLESS SQUARE ALBEDO TILES — "opposite edges must tile invisibly"
// is in every material's prompt sidecar — so the artwork a ground needs is the
// image, and the plate mesh wrapped around it in the kit's GLBs is 1.3MB of
// flat quad per twenty metres. Eighty-eight metres of street and fifty of back
// lots is twenty-odd of those plates; the same ground off the same images is
// four textures and six quads. The imported-visible-world rule admits "imported
// GLB and/or imported/generated texture from the project asset pipeline", and
// this is the second half of that clause, used for the one case where the mesh
// carries no shape.
//
// Everything else on the ground — every building, prop, cart and body standing
// on it — is still an imported GLB, and a missing texture here draws nothing
// rather than a coloured plane, so a hole still fails QA as a hole.
//
// TWO THINGS ARE LOAD-BEARING, both learned from the duel yard's ground.
//
// ONE PLATE PER SURFACE, NOT A GRID OF THEM. The repeat lives in the plate's UVs,
// so a hundred metres of street is one quad with the tile repeating along it and
// there is no geometry seam anywhere on the run. The yard's ground was originally
// laid as two columns of plates meeting at x=0, which put a visible seam straight
// down the line both duellists stand on; the fix there was to turn the plates
// across the duel axis, and the fix here is to have no interior edge to turn.
//
// PLATES OVERLAP, AT DIFFERENT HEIGHTS. Where two surfaces meet — the carriageway
// crossing a square, the road dying into the open ground at the Liberty corner —
// the upper plate runs a little way into the lower one instead of abutting it.
// Abutting plates leave a hairline of background between them and coplanar
// overlapping ones z-fight; a few millimetres of drop does neither, and on paving
// it is invisible. The plates sit just UNDER the collision floor for the same
// reason, so nothing standing at y=0 is ever inside the ground it stands on.
// ---------------------------------------------------------------------------

/**
 * Which world axis the tile's own vertical — image v — points along.
 *
 * This is a statement about the IMAGE, not about the world, and it is the
 * difference between a road and a set of cross-drains: the cobble material
 * carries its wheel ruts down its v axis, so the street asks for "X" and gets
 * ruts running with the direction of travel. A material whose courses run across
 * its image asks for the other one to reach the same place on the ground.
 */
export type GroundGrain = "X" | "Z";

export interface GroundPlate {
  readonly id: string;
  /** Served path of the albedo tile. Declared by the level, never guessed. */
  readonly texturePath: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** Metres of world one edge of the square tile covers. */
  readonly tileM: number;
  readonly grain: GroundGrain;
  /** Surface height. Just under the collision floor; see the note above. */
  readonly y: number;
}

function texturePathUrl(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

/**
 * The plate's own dimensions, before the quarter turn that orients its grain.
 *
 * A plate turned to put its v axis along X maps its own width onto world Z and
 * its own length onto world X, so the two extents swap. Everything downstream —
 * the geometry, the UV repeat — is in the plate's frame.
 */
function localSize(plate: GroundPlate): [number, number] {
  const spanX = plate.maxX - plate.minX;
  const spanZ = plate.maxZ - plate.minZ;
  return plate.grain === "X" ? [spanZ, spanX] : [spanX, spanZ];
}

function GroundPlateInner(props: { plate: GroundPlate }) {
  const { plate } = props;
  const gl = useThree((state) => state.gl);
  const shared = useTexture(texturePathUrl(plate.texturePath));

  // Wrapping and colour space are the same for every consumer of a paving tile,
  // so they are set on the shared texture rather than on a per-plate clone: one
  // upload serves every plate that names the same image. The per-plate part — how
  // many times the tile repeats — is in the geometry's UVs instead, which is what
  // keeps a shared texture shareable.
  const texture = useMemo(() => {
    shared.wrapS = THREE.RepeatWrapping;
    shared.wrapT = THREE.RepeatWrapping;
    shared.colorSpace = THREE.SRGBColorSpace;
    // Ground is the one surface always seen at a grazing angle. Without this it
    // dissolves into shimmer four metres ahead of the player, which reads as a
    // rendering fault rather than as paving.
    shared.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    shared.needsUpdate = true;
    return shared;
  }, [shared, gl]);

  const geometry = useMemo(() => {
    const [width, length] = localSize(plate);
    const built = new THREE.PlaneGeometry(width, length);
    const uv = built.attributes.uv!;
    const across = width / plate.tileM;
    const along = length / plate.tileM;
    for (let index = 0; index < uv.count; index++) {
      uv.setXY(index, uv.getX(index) * across, uv.getY(index) * along);
    }
    uv.needsUpdate = true;
    return built;
  }, [plate]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh
      name={plate.id}
      geometry={geometry}
      position={[
        (plate.minX + plate.maxX) / 2,
        plate.y,
        (plate.minZ + plate.maxZ) / 2,
      ]}
      // -90° about X lays the plate down; the third term is the in-plane quarter
      // turn that puts its grain on the axis the level asked for.
      rotation={[-Math.PI / 2, 0, plate.grain === "X" ? Math.PI / 2 : 0]}
      receiveShadow
    >
      <meshStandardMaterial map={texture} roughness={0.94} metalness={0} />
    </mesh>
  );
}

/**
 * One ground plate. Renders nothing while its material loads or if the material
 * is missing: an untextured plane is a visible primitive standing in for
 * content, which is the failure the imported-visible-world rule exists to stop.
 */
export function GroundSurface(props: { plate: GroundPlate }) {
  const url = texturePathUrl(props.plate.texturePath);
  return (
    <GlbBoundary fallback={null} onBeforeRetry={() => useTexture.clear(url)}>
      <Suspense fallback={null}>
        <GroundPlateInner plate={props.plate} />
      </Suspense>
    </GlbBoundary>
  );
}

/**
 * Every plate a level declared, in the order it declared them.
 *
 * Order is the whole of the layering: a level lists its ground from the bottom
 * up, and the heights it assigned put the later plates over the earlier ones.
 */
export function GroundSurfaces(props: { plates: readonly GroundPlate[] }) {
  return (
    <group name="ground">
      {props.plates.map((plate) => (
        <GroundSurface key={plate.id} plate={plate} />
      ))}
    </group>
  );
}
