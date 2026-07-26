import { useMemo } from "react";
import { FittedGlb } from "@pa/engine-world";
import { GlbGate } from "../duel/GlbGate.js";
import { drawnArena, type ArenaProp } from "./arenaScene.js";

// The visible yard.
//
// Every surface and object in it is an imported GLB from the asset pipeline, placed
// from `arenaScene.ts`, which derives the layout from the blockers the API's own
// authority is simulating. The only procedural things here are light, sky and fog,
// which the imported-visible-world rule names explicitly.
//
// A missing prop draws nothing. There is no primitive stand-in, by rule and for the
// same reason the pending surface never drew a stand-in fight: a placeholder that
// looks like content gets believed.

function Prop(props: { prop: ArenaProp }) {
  const { prop } = props;
  return (
    <group position={[prop.x, prop.y, prop.z]} rotation={[0, prop.yaw, 0]}>
      <GlbGate label={`pvp prop ${prop.glbKey}`}>
        <FittedGlb
          glbKey={prop.glbKey}
          size={[prop.size[0], prop.size[1], prop.size[2]]}
          fallback={null}
        />
      </GlbGate>
    </group>
  );
}

function Props(props: { of: readonly ArenaProp[] }) {
  return (
    <>
      {props.of.map((prop) => (
        <Prop key={prop.id} prop={prop} />
      ))}
    </>
  );
}

/**
 * The yard's light rig, matching the boss duel's.
 *
 * Deliberately the same numbers as `ArenaView`'s: a ranked duel and a boss duel
 * happening under different suns for no reason is worse than both happening under
 * the same one, and the reason those numbers are what they are is a gameplay one —
 * a low key throws long shadows off chest-high cover, so a player reads where cover
 * is from across the yard, and the warm key against the cool sky separates two
 * figures who are otherwise both dark against dark.
 */
function YardLight() {
  return (
    <>
      <hemisphereLight args={["#9fc4e8", "#4a3d2f", 0.55]} />
      <directionalLight
        position={[-9, 7.5, -6]}
        intensity={2.1}
        color="#ffd9a8"
        castShadow
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
      {/* Cool fill from the open side, so shadowed faces are not black. */}
      <directionalLight position={[7, 5, 8]} intensity={0.42} color="#8fb6e0" />
    </>
  );
}

export function ArenaScenery() {
  const arena = useMemo(() => drawnArena(), []);
  return (
    <>
      <color attach="background" args={["#8ba3b8"]} />
      <fogExp2 attach="fog" args={["#9db2c4", 0.026]} />
      <YardLight />
      <Props of={arena.ground} />
      <Props of={arena.cover} />
      <Props of={arena.wall} />
      <Props of={arena.dressing} />
    </>
  );
}
