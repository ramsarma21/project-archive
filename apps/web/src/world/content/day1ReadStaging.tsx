import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { InputRequest } from "@pa/contracts";
import type { PlayerApi } from "../Player.js";
import { STAGE_ANCHORS } from "../choreography.js";
import {
  documentForFocusReadObject,
  getDocumentTexture,
  type DocumentId,
} from "../documentTextures.js";
import { ImportedTexturedProp } from "../Character.js";
import { WORLD_BOUNDS } from "../manifest.js";

// ---- Focus-read world objects (tracked reads, Day-1) ------------------------
// A tracked read is offered on a physical object in the world; the legible
// face only ever appears in the post-open holographic panel. These planes
// carry the same authored artwork as that panel (documentTextures), small
// enough to stay unreadable at offer distance.
//
// Day-1 CONTENT staging, moved verbatim out of World3D (pure move, no
// redesign). Known primitive-geometry violations (board/post boxes) are a
// later asset-pipeline task — do not "fix" them here.

function PaperPlane(props: {
  documentId: DocumentId;
  width: number;
  position?: [number, number, number];
}) {
  const texture = useMemo(() => getDocumentTexture(props.documentId), [props.documentId]);
  const height = props.width * (4 / 3);
  return (
    <group position={props.position}>
      <ImportedTexturedProp
        texture={texture}
        size={[props.width, 0.16, height]}
      />
    </group>
  );
}

// The King's revenue proclamation pinned to the Custom House notice board
// ("There's a proclamation on the wall."). Same board convention as the
// tacked notice in MechanicRigs; offset along the board so the two never
// overlap once the notice is posted.
function CustomHouseProclamation() {
  // Board center is [50.6, -, 16.8] rotY 0.35; the sheet hangs on the upper
  // right of its south face, proud of the slats (the GLB face sits ~0.26m
  // from center), clear of the tack-mechanic notice spot at board center.
  const board = STAGE_ANCHORS.CUSTOMHOUSE_BOARD ?? [50.6, 1.25, 16.7];
  return (
    <group
      position={[board[0] + 0.25, board[1] + 0.18, board[2] - 0.04]}
      rotation={[0, Math.PI, 0]}
    >
      <PaperPlane documentId="REVENUE_PROCLAMATION" width={0.34} />
    </group>
  );
}

// Standing broadside board on the elm approach ("Right in your path. A
// single line."). Fixed dressing in the pocket, clear of the crowd ring.
function CrowdBoard() {
  const anchor = STAGE_ANCHORS.CROWD_BOARD_POST ?? [86.9, 0, -19.4];
  // Faces the player's stand spot, oblique to the offer camera: the runner
  // can read it in-fiction, the shot only shows a foreshortened bill.
  return (
    <group position={anchor} rotation={[0, 2.0, 0]}>
      {[-0.34, 0.34].map((x) => (
        <mesh key={x} position={[x, 0.85, -0.045]} castShadow>
          <boxGeometry args={[0.07, 1.7, 0.07]} />
          <meshStandardMaterial color="#4a3826" roughness={0.95} />
        </mesh>
      ))}
      <mesh position={[0, 1.25, 0]} castShadow>
        <boxGeometry args={[0.92, 0.98, 0.045]} />
        <meshStandardMaterial color="#5d4930" roughness={0.95} />
      </mesh>
      <PaperPlane documentId="CROWD_BOARD" width={0.32} position={[0.08, 1.28, 0.028]} />
    </group>
  );
}

// A freestanding posting post carrying an offered street bill ("nailed by
// the door", "the paste is still wet"), planted just ahead of wherever the
// runner stopped, facing them. Placed once per offer.
function StreetReadPost(props: {
  documentId: DocumentId;
  apiRef: { current: PlayerApi | null };
}) {
  const group = useRef<THREE.Group>(null);
  const placed = useRef(false);
  useFrame(({ camera }) => {
    const g = group.current;
    if (!g || placed.current) return;
    const player = props.apiRef.current?.position;
    if (!player) return;
    // Forward = camera->player on the ground plane (the follow camera sits
    // behind the runner). The post plants ahead, a half-step right; the bill
    // hangs high on a tall posting post so the centered offer panel sits
    // below it, not over it.
    let dx = player.x - camera.position.x;
    let dz = player.z - camera.position.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return;
    dx /= len;
    dz /= len;
    const rightX = -dz;
    const rightZ = dx;
    const px = THREE.MathUtils.clamp(
      player.x + dx * 1.9 + rightX * 0.55,
      WORLD_BOUNDS.minX + 1.5,
      WORLD_BOUNDS.maxX - 1.5,
    );
    // Stop short of the building facades on the street spine (fronts at |z|>=11).
    const rawZ = player.z + dz * 1.9 + rightZ * 0.55;
    const pz = Math.abs(player.z) < 12 ? THREE.MathUtils.clamp(rawZ, -10.5, 10.5) : rawZ;
    g.position.set(px, 0, pz);
    g.rotation.y = Math.atan2(player.x - px, player.z - pz);
    g.visible = true;
    placed.current = true;
  });
  return (
    <group ref={group} visible={false}>
      <mesh position={[0, 1.3, -0.05]} castShadow>
        <boxGeometry args={[0.1, 2.6, 0.1]} />
        <meshStandardMaterial color="#4a3826" roughness={0.95} />
      </mesh>
      <mesh position={[0, 2.42, -0.05]} castShadow>
        <boxGeometry args={[0.62, 0.07, 0.09]} />
        <meshStandardMaterial color="#4a3826" roughness={0.95} />
      </mesh>
      <mesh position={[0, 1.86, -0.02]} castShadow>
        <boxGeometry args={[0.56, 0.76, 0.035]} />
        <meshStandardMaterial color="#5d4930" roughness={0.95} />
      </mesh>
      <PaperPlane documentId={props.documentId} width={0.42} position={[0, 1.86, 0.002]} />
    </group>
  );
}

export function FocusReadStaging(props: {
  request: InputRequest | null;
  interiorId: string | null;
  apiRef: { current: PlayerApi | null };
}) {
  const objectId = props.request?.kind === "FOCUS_READ" ? props.request.objectId : null;
  const streetDoc =
    objectId === "TOWN_STAMP_NOTICE" || objectId === "FRESH_BROADSIDE"
      ? documentForFocusReadObject(objectId)
      : null;
  return (
    <group>
      {props.interiorId === "CUSTOM_HOUSE" && <CustomHouseProclamation />}
      {!props.interiorId && <CrowdBoard />}
      {streetDoc && !props.interiorId && (
        <StreetReadPost key={objectId} documentId={streetDoc} apiRef={props.apiRef} />
      )}
    </group>
  );
}
