import { useMemo } from "react";
import { FittedGlb } from "@pa/engine-world";
import { GlbGate } from "./GlbGate.js";
import {
  GROUND_TILES,
  GROUND_TILE_SIZE,
  YARD_DRESSING,
  fitPropToHeight,
  fittedCover,
  perimeterWall,
  type CoverPlacement,
  type DressingPlacement,
} from "./arenaSpec.js";

// The visible yard. Every surface and object in it is an imported GLB from the asset
// pipeline; the only procedural things in the scene are light, sky and fog, which the
// imported-visible-world rule names explicitly.
//
// Cover is drawn from the same declaration the collision shell is built from, so the
// crate that stops a ball is the crate you can see. The engine's `FittedGlb` scales a
// prop into a box and stands it on the ground, which is exactly right here because
// every box is the prop's own measured aspect ratio scaled to a chosen height.

function Prop(props: {
  glbKey: string;
  x: number;
  z: number;
  yaw: number;
  size: readonly [number, number, number];
  y?: number;
}) {
  return (
    <group position={[props.x, props.y ?? 0, props.z]} rotation={[0, props.yaw, 0]}>
      <GlbGate label={`prop ${props.glbKey}`}>
        <FittedGlb
          glbKey={props.glbKey}
          size={[props.size[0], props.size[1], props.size[2]]}
          fallback={null}
        />
      </GlbGate>
    </group>
  );
}

/** The paved yard, tiled from a real-scale ground plate rather than one stretched copy. */
function Ground() {
  return (
    <>
      {GROUND_TILES.map((tile) => (
        <Prop
          key={`${tile.x},${tile.z},${tile.yaw}`}
          glbKey="colonial-yard-ground"
          x={tile.x}
          z={tile.z}
          yaw={tile.yaw}
          y={-GROUND_TILE_SIZE[1] - tile.drop}
          size={GROUND_TILE_SIZE}
        />
      ))}
    </>
  );
}

function Cover(props: { placements?: readonly CoverPlacement[] }) {
  const resolved = useMemo(() => fittedCover(props.placements), [props.placements]);
  return (
    <>
      {resolved.map((entry) => (
        <Prop
          key={entry.id}
          glbKey={entry.glbKey}
          x={entry.x}
          z={entry.z}
          yaw={entry.yaw}
          size={entry.size}
        />
      ))}
    </>
  );
}

function Dressing(props: { placements: readonly DressingPlacement[] }) {
  return (
    <>
      {props.placements.map((entry, index) => {
        const fitted = fitPropToHeight(entry.glbKey, entry.heightM);
        return (
          <Prop
            key={`${entry.glbKey}-${index}`}
            glbKey={entry.glbKey}
            x={entry.x}
            z={entry.z}
            yaw={entry.yaw}
            size={fitted.size}
          />
        );
      })}
    </>
  );
}

/**
 * Late-afternoon light, raking across the yard.
 *
 * A low sun is a gameplay decision as much as a mood: long shadows off chest-high
 * cover tell the player where cover is from across the yard, and the warm key against
 * the cool sky separates two figures who are otherwise both dark against dark.
 */
function YardLight(props: { reducedMotion: boolean }) {
  void props.reducedMotion;
  return (
    <>
      <hemisphereLight args={["#9fc4e8", "#4a3d2f", 0.55]} />
      <directionalLight
        position={[-9, 7.5, -6]}
        intensity={2.1}
        color="#ffd9a8"
        castShadow
        // 1024 over a 26m shadow camera is ~2.5cm a texel, which is finer than the
        // cobbles; doubling it costs a software renderer dearly and buys nothing.
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-13}
        shadow-camera-right={13}
        shadow-camera-top={13}
        shadow-camera-bottom={-13}
        shadow-camera-near={0.5}
        shadow-camera-far={40}
        shadow-bias={-0.0015}
      />
      {/* Cool fill from the open side of the yard, so shadowed faces are not black. */}
      <directionalLight position={[7, 5, 8]} intensity={0.42} color="#8fb6e0" />
    </>
  );
}

export function ArenaView(props: {
  cover?: readonly CoverPlacement[];
  reducedMotion?: boolean;
}) {
  const wall = useMemo(() => perimeterWall(), []);
  return (
    <>
      <color attach="background" args={["#8ba3b8"]} />
      <fogExp2 attach="fog" args={["#9db2c4", 0.026]} />
      <YardLight reducedMotion={props.reducedMotion ?? false} />
      <Ground />
      <Cover placements={props.cover} />
      <Dressing placements={wall} />
      <Dressing placements={YARD_DRESSING} />
    </>
  );
}
