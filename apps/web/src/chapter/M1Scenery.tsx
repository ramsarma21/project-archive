import { memo, useMemo } from "react";
import { FittedGlb, GroundSurfaces, ImportedStructure } from "@pa/engine-world";
import { groundPlacements, sceneryPlacements } from "@pa/mission-m1";
import type { DawnRead } from "../mission/dawn.js";
import { M1Lanterns } from "./M1Lanterns.js";

// ---------------------------------------------------------------------------
// M1's visible world.
//
// Every object here is an imported GLB fitted to the footprint the collision was
// authored against, derived from that collision rather than placed a second time
// by hand — so a prop cannot drift away from the hull the player feels, and the
// traversability tests are testing the thing on screen.
//
// The ground is the one exception and is drawn first: flat plates carrying the
// road kit's own paving materials, because the collision floor is a plane and the
// kit's plate meshes are 1.3MB of flat quad apiece. See `GroundSurfaces`. Without
// it every building, prop and body in this file stood against open sky.
//
// Nothing falls back to a primitive. `FittedGlb` renders its fallback while a
// model loads or if it fails, and that fallback is null: a missing asset leaves
// a hole, which is the correct failure. A visible box standing in for a building
// would pass QA and ship.
//
// Each placement is one object, not one collision entry, and it carries the path
// its asset was declared at — props, characters and structural shells do not all
// live in the same directory. The level also says which of the two importers an
// asset wants, because a shell is stretched onto its room and a prop is not.
//
// The crowd is deliberately NOT here. It is drawn by the container, off
// `runtime.civilians` at the attempt's seed, because that is the one array the
// stealth field counts density from and the one a thrown bottle collides with.
// This file drew a second crowd at a hardcoded seed 0, which put a set of bodies
// in the square that looked solid, blocked nothing, and hid the player from
// nobody.
// ---------------------------------------------------------------------------

function SceneryGround() {
  const plates = useMemo(() => groundPlacements(), []);
  return <GroundSurfaces plates={plates} />;
}

function SceneryProps() {
  const placements = useMemo(() => sceneryPlacements(), []);
  return (
    <group name="m1-scenery">
      {placements.map((placement) => (
        <group
          key={placement.id}
          position={placement.pos}
          rotation={[0, placement.yaw, 0]}
        >
          {placement.fit === "SHELL" ? (
            <ImportedStructure
              glbKey={placement.asset}
              src={placement.assetPath}
              size={placement.size}
            />
          ) : (
            <FittedGlb
              glbKey={placement.asset}
              src={placement.assetPath}
              size={placement.size}
              // One tile of a run. The level already cut the box to the module,
              // so filling it is what keeps the run continuous; contain-fitting
              // it would leave a gap at every seam.
              fill={placement.fit === "MODULE"}
              fallback={null}
            />
          )}
        </group>
      ))}
    </group>
  );
}

/**
 * The level's art. Mounted inside the container's canvas; the container never
 * guesses at an asset key.
 */
export const M1Scenery = memo(function M1Scenery(props: {
  readonly reducedMotion: boolean;
  readonly dawn: DawnRead;
}) {
  void props.reducedMotion;
  return (
    <>
      <SceneryGround />
      <SceneryProps />
      {/* The lamps are the level's art too, and they are the only thing in the
          mission that makes the authored light field visible. See M1Lanterns. */}
      <M1Lanterns dawn={props.dawn} />
    </>
  );
});
