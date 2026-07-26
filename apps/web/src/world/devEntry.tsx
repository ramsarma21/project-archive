import { Suspense } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import {
  FittedGlb,
  GroundSurface,
  PLAYER_CLIP_SPEC,
  RiggedCharacter,
  registerCharacterClips,
} from "@pa/engine-world";
import { ASSETS } from "@pa/mission-m1";

// The asset sheet. Every world asset the level declares, drawn at a known size
// with the imported player rig standing beside it as a 1.55m ruler.
//
// This exists because a fitted GLB can be wrong in a way nothing else catches. A
// contain-fit takes the SMALLEST of the three box/mesh ratios, so an asset whose
// proportions do not match the box it was given draws a fraction of itself and
// still lands in the right place — a wall module fitted into a 0.6m-thick blocker
// draws 27cm of a 3.6m wall. In a mission eighty metres long that reads as "the
// art is a bit thin"; here it reads as a doll's house next to a boy, which is a
// judgement anyone can make in a second.
//
//   /src/world/assetSheet.html
//   ?keys=market-awning,crate-stack     which assets, in order. Default: all of
//                                       the ones M1 declares that exist.
//   ?h=3                                fit each one to this height, keeping its
//                                       own proportions. Default 3m.
//   ?cells=market-awning:5.6x0.35x2.2   raw boxes instead, exactly as the level
//                                       would hand them to FittedGlb. This is
//                                       the mode that answers "what does the
//                                       level actually draw here".
//   ?fill=1                             fill the box on every axis instead of
//                                       fitting inside it: what a MODULE gets.
//   ?pitch=10                           metres between cells.
//   ?dist=40                            camera distance.

const params = new URLSearchParams(window.location.search);

interface Cell {
  readonly key: string;
  readonly src: string;
  readonly size: [number, number, number];
}

/**
 * Assets by key, from the level's own declared requirements — which is also
 * where each one's path lives. A sheet that guessed `world/props/<key>.glb`
 * would silently 404 every character and every structural shell.
 */
const DECLARED = new Map(ASSETS.map((asset) => [asset.key, asset]));

function pathFor(key: string): string {
  return DECLARED.get(key)?.path ?? `world/props/${key}.glb`;
}

/**
 * Uniform scale to a target height, without a table of measured bounding boxes.
 *
 * The old version of this page carried its own hand-copied list of natural GLB
 * sizes, which went stale the first time an asset was re-exported. It is not
 * needed: a contain-fit already takes the smallest ratio, so a box that is
 * effectively unbounded on the horizontal axes leaves the height to decide the
 * scale, and the asset keeps its own proportions.
 */
function toHeight(height: number): [number, number, number] {
  return [1e4, height, 1e4];
}

function cells(): Cell[] {
  const raw = params.get("cells");
  if (raw) {
    return raw.split(",").map((entry) => {
      const [key, dims] = entry.split(":");
      const [x, y, z] = (dims ?? "2x2x2").split("x").map(Number);
      return { key: key!, src: pathFor(key!), size: [x!, y!, z!] };
    });
  }
  const height = Number(params.get("h") ?? "3") || 3;
  const requested = params.get("keys");
  const keys = requested
    ? requested.split(",")
    : ASSETS.filter((asset) => asset.status === "EXISTING").map((asset) => asset.key);
  return keys.map((key) => ({ key, src: pathFor(key), size: toHeight(height) }));
}

const CELLS = cells();
const FILL = params.get("fill") === "1";
const PITCH = Number(params.get("pitch") ?? "") || 10;
const SPAN = PITCH * Math.max(1, CELLS.length - 1);
const RULER_HEIGHT_M = 1.55;

registerCharacterClips("playerboy-rigged", PLAYER_CLIP_SPEC);

function Sheet() {
  return (
    <>
      {CELLS.map((cell, index) => {
        const x = -SPAN / 2 + index * PITCH;
        return (
          <group key={`${cell.key}#${index}`} position={[x, 0, 0]}>
            <Suspense fallback={null}>
              <FittedGlb
                glbKey={cell.key}
                src={cell.src}
                size={cell.size}
                fill={FILL}
                fallback={null}
              />
            </Suspense>
            {/* The ruler: the imported rig at the height the mission runs it at. */}
            <group position={[0, 0, 3.4]}>
              <Suspense fallback={null}>
                <RiggedCharacter
                  glbKey="playerboy-rigged"
                  height={RULER_HEIGHT_M}
                  clip="idle"
                  showFallback={false}
                />
              </Suspense>
            </group>
          </group>
        );
      })}
    </>
  );
}

/** Ground under the sheet, so a fit is judged against a surface and not against sky. */
function SheetGround() {
  return (
    <GroundSurface
      plate={{
        id: "SHEET_GROUND",
        texturePath: "world/textures/ground-yard-rubble.jpg",
        minX: -SPAN / 2 - PITCH,
        maxX: SPAN / 2 + PITCH,
        minZ: -PITCH,
        maxZ: PITCH,
        tileM: 7,
        grain: "Z",
        y: -0.004,
      }}
    />
  );
}

/**
 * Which cell is which, left to right. Alignment-free on purpose: labels drawn in
 * the scene need a font file, and the camera here never moves.
 */
function Legend() {
  return (
    <ol
      style={{
        position: "fixed",
        inset: "auto auto 0 0",
        margin: 0,
        padding: "10px 14px",
        maxHeight: "40vh",
        overflow: "auto",
        columns: "3 220px",
        background: "rgba(10, 14, 20, 0.82)",
        color: "#dce6f2",
        font: "12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      {CELLS.map((cell, index) => (
        <li key={`${cell.key}#${index}`}>
          {cell.key}
          {DECLARED.has(cell.key) ? "" : " (undeclared)"}
        </li>
      ))}
    </ol>
  );
}

const dist = Number(params.get("dist") ?? "") || Math.max(12, SPAN * 0.85);

createRoot(document.getElementById("root")!).render(
  <>
    <Canvas
      style={{ width: "100vw", height: "100vh" }}
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={[1, 1.5]}
      camera={{ fov: 42, near: 0.1, far: 400, position: [0, dist * 0.32, dist] }}
      onCreated={({ camera }) => camera.lookAt(0, 1.6, 0)}
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#8c9db1"]} />
      <hemisphereLight args={["#cddcf0", "#3c3a34", 1.35]} />
      <directionalLight position={[18, 26, 12]} intensity={1.5} castShadow />
      <Suspense fallback={null}>
        <SheetGround />
      </Suspense>
      <Sheet />
    </Canvas>
    <Legend />
  </>,
);
