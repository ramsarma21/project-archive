import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  FittedGlb,
  GroundSurfaces,
  ImportedStructure,
  type CollisionWorld,
} from "@pa/engine-world";
import { groundPlacements, sceneryPlacements, type SceneryPlacement } from "@pa/mission-m1";
import { DAWN, dawnSky } from "../mission/dawn.js";

// ---------------------------------------------------------------------------
// The arena a mission fights in, drawn from the mission's own level.
//
// WHY THIS EXISTS RATHER THAN `ArenaView`. The stand-alone yard in arenaSpec.ts is
// a self-contained arena built around the origin, with its own symmetric cover for
// PvP. A mission's arena is not that: M1 carves its duel world out of the
// rope-walk yard the player has just run into, at the level's own coordinates —
// x 88 to 100 — with the level's own eight pieces of cover in it. Drawing the
// stand-alone yard around a fight happening ninety metres away would put both
// fighters over open space, and the shot would look plausible.
//
// It also keeps the rule that arenaSpec.ts states in capitals: THE COVER YOU SEE
// IS THE COVER THAT STOPS A BALL. Every placement here comes from the same level
// masses the brief's blockers were compiled from, so the hay cart the player hides
// behind is the blocker the core tests a shot against, and neither can drift from
// the other because there is only one list.
//
// Nothing physical is built here. Every object is an imported GLB the level
// declared, fitted to the footprint its collision was authored against; the sky,
// the fog and the two lights are procedural, which is the category the
// imported-visible-world rule names explicitly.
// ---------------------------------------------------------------------------

/**
 * How far outside the arena the level is still drawn.
 *
 * The arena is a walled yard, so this is not about gameplay — the player cannot
 * leave the bounds. It is about the horizon: the yard wall stands 3.6m and the
 * engagement camera looks over it, so with nothing beyond, a fight in the middle
 * of Boston is shot against empty sky. Sixteen metres reaches the Liberty Tree and
 * the ropewalk the mission just came through and stops well short of loading the
 * rest of the town for a fight nobody can see it from.
 */
export const ARENA_CONTEXT_M = 16;

/**
 * Where the duel's sky is on the mission clock.
 *
 * The brief carries no dawn state — see the note in missionDuel.tsx — so this is a
 * fixed stop rather than a guess dressed as a reading. `liftAtDawn` is where the
 * sky stands when the authored traversal budget is spent, which is when a player
 * who used their three minutes arrives at the yard. It matters that it comes from
 * the mission's own palette and not a second one: the duel is the frame after the
 * traversal, and a jump from a pre-dawn street to a bright afternoon yard would
 * read as a different place.
 */
const DUEL_SKY_LIFT = DAWN.liftAtDawn;

interface Rect {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function grown(bounds: Rect, by: number): Rect {
  return {
    minX: bounds.minX - by,
    maxX: bounds.maxX + by,
    minZ: bounds.minZ - by,
    maxZ: bounds.maxZ + by,
  };
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.maxX >= b.minX && a.minX <= b.maxX && a.maxZ >= b.minZ && a.minZ <= b.maxZ
  );
}

/**
 * Placements the arena can see, by overlap rather than containment.
 *
 * Overlap is the load-bearing choice: a shed or a wall run that merely reaches
 * into the band is drawn whole, so an enclosing structure is never sliced in half
 * by the filter. The alternative — keeping only what fits inside — deletes exactly
 * the big things the horizon needed.
 */
export function arenaScenery(
  bounds: Rect,
  marginM = ARENA_CONTEXT_M,
): SceneryPlacement[] {
  const band = grown(bounds, marginM);
  return sceneryPlacements().filter((placement) =>
    overlaps(band, {
      minX: placement.pos[0] - placement.size[0] / 2,
      maxX: placement.pos[0] + placement.size[0] / 2,
      minZ: placement.pos[2] - placement.size[2] / 2,
      maxZ: placement.pos[2] + placement.size[2] / 2,
    }),
  );
}

export function arenaGround(bounds: Rect, marginM = ARENA_CONTEXT_M) {
  const band = grown(bounds, marginM);
  return groundPlacements().filter((plate) => overlaps(band, plate));
}

/**
 * The yard's light, relocated.
 *
 * Two lights and no more, same composition as the stand-alone yard's: a low warm
 * key that throws cover shadows across the ground — which is how a player reads
 * where cover is from the far side of the arena — and a cool fill so a shadowed
 * coat is not black. What changes is that both are placed relative to the arena
 * rather than the origin, and the key's SHADOW TARGET is moved with it. A
 * directional light aims at the world origin by default, so a shadow camera left
 * at 0,0 covers a patch of Boston a hundred metres from the fight and the yard
 * gets no shadows at all.
 */
function ArenaLight(props: {
  centre: readonly [number, number];
  reducedMotion: boolean;
}) {
  void props.reducedMotion;
  const key = useRef<THREE.DirectionalLight>(null);
  const [cx, cz] = props.centre;
  const sky = useMemo(() => dawnSky(DUEL_SKY_LIFT), []);

  useEffect(() => {
    const light = key.current;
    if (!light) return;
    light.target.position.set(cx, 0, cz);
    light.target.updateMatrixWorld();
  }, [cx, cz]);

  const elevation = (sky.sunElevationDeg * Math.PI) / 180;
  const reach = 14;

  return (
    <>
      <hemisphereLight
        args={[sky.hemiSky, sky.hemiGround, sky.ambient]}
      />
      <directionalLight
        ref={key}
        position={[
          cx - Math.cos(elevation) * reach,
          Math.sin(elevation) * reach + 7.5,
          cz - reach * 0.6,
        ]}
        intensity={1.9}
        color={sky.sunColour}
        castShadow
        // 1024 texels over a 30m shadow camera is about 3cm each, which is finer
        // than the cobbles; doubling it buys nothing and costs a software
        // renderer dearly.
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
        shadow-camera-near={0.5}
        shadow-camera-far={60}
        shadow-bias={-0.0015}
      />
      <directionalLight
        position={[cx + reach * 0.7, 5, cz + reach * 0.8]}
        intensity={0.44}
        color={sky.hemiSky}
      />
    </>
  );
}

/** One placement, drawn the way the level said it wants to be drawn. */
function Placed(props: { placement: SceneryPlacement }) {
  const { placement } = props;
  return (
    <group position={placement.pos} rotation={[0, placement.yaw, 0]}>
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
          // One tile of a run: the level cut the box to the module, so filling it
          // is what keeps the run continuous. Contain-fitting leaves a gap at
          // every seam — and on a 0.6m-thick wall blocker it draws 27cm of a
          // 3.6m wall.
          fill={placement.fit === "MODULE"}
          fallback={null}
        />
      )}
    </group>
  );
}

export interface MissionArenaViewProps {
  /** The brief's own collision world. Its bounds are the arena. */
  readonly world: CollisionWorld;
  readonly reducedMotion: boolean;
}

/**
 * The mission's arena, as the player sees it.
 *
 * Memoised on the world because the placement lists are a walk over the whole
 * level's masses, and the duel re-renders on every HUD change.
 */
export const MissionArenaView = memo(function MissionArenaView(
  props: MissionArenaViewProps,
) {
  const bounds = props.world.bounds;
  const scenery = useMemo(() => arenaScenery(bounds), [bounds]);
  const ground = useMemo(() => arenaGround(bounds), [bounds]);
  const sky = useMemo(() => dawnSky(DUEL_SKY_LIFT), []);
  const centre = useMemo<[number, number]>(
    () => [(bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2],
    [bounds],
  );

  return (
    <>
      <color attach="background" args={[sky.sky]} />
      <fogExp2 attach="fog" args={[sky.sky, sky.fogDensity]} />
      <ArenaLight centre={centre} reducedMotion={props.reducedMotion} />
      <GroundSurfaces plates={ground} />
      <group name="mission-arena">
        {scenery.map((placement) => (
          <Placed key={placement.id} placement={placement} />
        ))}
      </group>
    </>
  );
});
