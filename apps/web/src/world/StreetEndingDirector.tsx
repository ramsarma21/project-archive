import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { PresentationDirective, RuntimeView } from "@pa/contracts";
import { RiggedCharacter, ImportedTexturedProp } from "./Character.js";
import { getDocumentTexture } from "./documentTextures.js";
import { PROPS } from "./manifest.js";

// ---------------------------------------------------------------------------
// Street-level day ending staging (design1 feature 3). Presentation-only:
// once the runtime offers the town-board walk (POST_THE_PAGE objective), the
// town crier stands by the imported notice board; while his attributed line
// plays he performs the shout clip (subtitle-only crier per the approved
// limit); after the pin beat commits, the player's printed front page hangs
// on the board via the existing document-texture path. Resume-safe: all
// staging derives from the runtime view, not local latches.
// ---------------------------------------------------------------------------

const BOARD = PROPS.find((prop) => prop.glb === "notice-board")!;
const CRIER_POS: [number, number, number] = [
  BOARD.pos[0] - 1.9,
  0,
  BOARD.pos[2] - 1.5,
];
// Face the street side (the stand anchor is north of the board).
const CRIER_YAW = Math.atan2(6 - CRIER_POS[0], 6.4 - CRIER_POS[2]);

export function StreetEndingDirector(props: {
  view: RuntimeView | null;
  interiorId: string | null;
  present: PresentationDirective[];
  reducedMotion: boolean;
}) {
  const stage = props.view?.objectives?.POST_THE_PAGE;
  const active = Boolean(stage) && !props.interiorId;
  const posted = stage === "COMPLETED";
  const crierSpeaking = props.present.some(
    (directive) =>
      directive.kind === "DIALOGUE" && directive.speaker === "CRIER",
  );
  const [clip, setClip] = useState("idle");
  const clipRef = useRef("idle");
  const sway = useRef<THREE.Group>(null);

  const pageTexture = useMemo(
    () => (posted ? getDocumentTexture("FINAL_FRONT_PAGE") : null),
    [posted],
  );

  useFrame(({ clock }) => {
    const next = crierSpeaking ? "shout" : "argu1";
    if (clipRef.current !== next) {
      clipRef.current = next;
      setClip(next);
    }
    if (sway.current && !props.reducedMotion) {
      sway.current.rotation.z =
        Math.sin(clock.elapsedTime * 0.7) * (crierSpeaking ? 0.035 : 0.015);
    }
  });

  if (!active) return null;
  return (
    <group>
      <group position={CRIER_POS} rotation={[0, CRIER_YAW, 0]}>
        <group ref={sway}>
          <RiggedCharacter
            glbKey="towncrier-rigged"
            height={1.74}
            clip={clip}
            contactShadow
            showFallback={false}
          />
        </group>
      </group>
      {posted && pageTexture && (
        // The player's printed page, pinned to the imported board's street
        // face (same textured-paper path as every staged document).
        <group
          position={[BOARD.pos[0], 0, BOARD.pos[2]]}
          rotation={[0, BOARD.rotY + Math.PI, 0]}
        >
          <group position={[0.22, 1.42, 0.34]} rotation={[Math.PI / 2, 0, 0.02]}>
            <ImportedTexturedProp texture={pageTexture} size={[0.46, 0.1, 0.62]} />
          </group>
        </group>
      )}
    </group>
  );
}
