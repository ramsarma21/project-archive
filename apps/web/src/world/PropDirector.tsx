import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { DAY1_CUES, type ChoreographyCue, type PropChoreography } from "@pa/contracts";
import { STAGE_ANCHORS } from "./choreography.js";
import { documentForProp, getDocumentTexture } from "./documentTextures.js";
import { FittedGlb, ImportedTexturedProp } from "./Character.js";

// Props whose staging is owned by a MechanicRigs execution rig for a given
// cue: the tossed catch sheet and the hauled cloth bolt.
function stagedByMechanicRig(cueId: string, propId: string): boolean {
  if (cueId === DAY1_CUES.CATCH_SHEET && propId === "FRESH_SHEET") return true;
  if (cueId.includes("THOMAS_HAUL") && propId === "CLOTH_BOLT") return true;
  return false;
}

export function PropDirector(props: {
  cue: ChoreographyCue | null;
  active: boolean;
  reducedMotion: boolean;
}) {
  if (!props.cue) return null;
  return (
    <group>
      {props.cue.props
        .filter((prop) => !stagedByMechanicRig(props.cue!.cueId, prop.propId))
        .map((prop) => (
        prop.propId === "CLOTH_BOLT" ? (
          <ClothBolt
            key={prop.propId}
            prop={prop}
            active={props.active}
            reducedMotion={props.reducedMotion}
          />
        ) : (
          <DirectedPaper
            key={prop.propId}
            prop={prop}
            cue={props.cue!}
            active={props.active}
            reducedMotion={props.reducedMotion}
          />
        )
      ))}
      {/* The active press interaction is owned by MechanicRigs.ProceduralPress
          on the imported press body (INTERIOR_PROPS `press-common`); no stray
          duplicate press handle is staged here. */}
    </group>
  );
}

function ClothBolt(props: {
  prop: PropChoreography;
  active: boolean;
  reducedMotion: boolean;
}) {
  const ref = useRef<THREE.Group>(null);
  const position: [number, number, number] = props.prop.anchorId
    ? STAGE_ANCHORS[props.prop.anchorId] ?? [0, -20, 0]
    : [0, -20, 0];
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const lift = props.active && !props.reducedMotion ? Math.max(0, Math.sin(clock.elapsedTime * 3.2)) * 0.08 : 0;
    ref.current.position.y = position[1] + lift;
    ref.current.rotation.z = props.active && !props.reducedMotion ? Math.sin(clock.elapsedTime * 2.1) * 0.05 : 0;
  });
  return (
    <group ref={ref} position={position} rotation={[0.08, 0.45, 0]}>
      <FittedGlb
        glbKey="int-textile-personal-cluster"
        size={[0.9, 0.5, 0.65]}
        fallback={<group />}
      />
    </group>
  );
}

function DirectedPaper(props: {
  prop: PropChoreography;
  cue: ChoreographyCue;
  active: boolean;
  reducedMotion: boolean;
}) {
  const ref = useRef<THREE.Group>(null);
  const cueStartedAt = useRef<number | null>(null);
  const position = propPosition(props.prop, props.cue);
  // Each staged paper carries the document the script says it is.
  const paperTexture = useMemo(
    () => getDocumentTexture(documentForProp(props.prop.propId)),
    [props.prop.propId],
  );

  useEffect(() => {
    cueStartedAt.current = null;
  }, [props.cue.cueId, props.prop.propId]);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    if (cueStartedAt.current === null) cueStartedAt.current = clock.elapsedTime;
    const toss =
      props.cue.cueId === DAY1_CUES.CATCH_SHEET &&
      props.prop.propId === "FRESH_SHEET";
    if (toss) {
      const start = STAGE_ANCHORS.MERCER_ABIGAIL_HAND!;
      const end = STAGE_ANCHORS.MERCER_PLAYER_CATCH!;
      const elapsed = clock.elapsedTime - cueStartedAt.current;
      const raw = props.reducedMotion ? 1 : THREE.MathUtils.clamp(elapsed / 1.15, 0, 1);
      const t = raw * raw * (3 - 2 * raw);
      ref.current.visible = raw < 0.98;
      ref.current.position.set(
        THREE.MathUtils.lerp(start[0], end[0], t),
        THREE.MathUtils.lerp(start[1], end[1], t) + Math.sin(t * Math.PI) * 0.24,
        THREE.MathUtils.lerp(start[2], end[2], t),
      );
      ref.current.rotation.set(
        -0.25,
        -2.7,
        THREE.MathUtils.lerp(0.3, -0.15, t) + Math.sin(t * Math.PI) * 0.12,
      );
      return;
    }
    ref.current.visible = true;
    const moving = props.active && !props.reducedMotion;
    ref.current.position.set(
      position[0],
      position[1] + (moving ? Math.sin(clock.elapsedTime * 4.5) * 0.015 : 0),
      position[2],
    );
  });

  if (props.prop.state === "HIDDEN") return null;
  const held = props.prop.state === "HELD_ACTOR" || props.prop.state === "HELD_PLAYER";
  const catchSheet = props.prop.propId === "FRESH_SHEET";
  const width = held ? (catchSheet ? 0.28 : 0.34) : 0.48;
  const height = held ? (catchSheet ? 0.38 : 0.46) : 0.65;
  return (
    <group ref={ref} position={position} rotation={held ? [-0.25, -2.7, -0.15] : [-Math.PI / 2, 0, 0]}>
      <ImportedTexturedProp
        texture={paperTexture}
        size={[width, 0.16, height]}
      />
    </group>
  );
}

function propPosition(prop: PropChoreography, cue: ChoreographyCue): [number, number, number] {
  if (prop.anchorId && STAGE_ANCHORS[prop.anchorId]) {
    const anchor = STAGE_ANCHORS[prop.anchorId]!;
    if (prop.state === "ON_TABLE") {
      const offset = prop.propId === "OLD_PROOF" ? -0.28 : prop.propId === "PIKE_PROOF" ? 0.28 : 0;
      return [anchor[0] + offset, anchor[1], anchor[2]];
    }
    return anchor;
  }
  if (prop.actorId) {
    const actor = cue.actors.find((candidate) => candidate.actorId === prop.actorId);
    const anchor = actor ? STAGE_ANCHORS[actor.anchorId] : undefined;
    if (anchor) return [anchor[0], anchor[1] + 1.05, anchor[2] - 0.18];
  }
  return [0, -20, 0];
}
