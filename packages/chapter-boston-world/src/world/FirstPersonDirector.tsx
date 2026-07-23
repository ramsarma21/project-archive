import { useEffect, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { AuthoredMotion } from "@pa/contracts";
import { FittedGlb } from "./Character.js";
import { SortFanSlide } from "./MechanicRigs.js";
import { PrinterInkBall } from "./PrinterInkBalls.js";
import type { FirstPersonHands } from "./FirstPersonCamera.js";
import {
  getDocumentTexture,
  SORT_FAN_ITEMS,
  type PaperContent,
} from "./documentTextures.js";

export function FirstPersonDirector(props: {
  active: boolean;
  introActive: boolean;
  motion: AuthoredMotion;
  paperMode: "NONE" | "CATCH" | "READ" | "PLACE";
  paper?: PaperContent | null;
  reducedMotion: boolean;
  // Head-camera first person: the visible character's own animated arms are
  // the hands, so the synthetic arm rig stays hidden and hand-held documents
  // snap to the real hand bones published by FirstPersonCamera.
  headCam?: boolean;
  hands?: FirstPersonHands;
}) {
  const camera = useThree((state) => state.camera);
  const root = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);
  const paper = useRef<THREE.Group>(null);
  const wasActive = useRef(false);
  const mechanicProgress = useRef(0);
  const mechanicActive = useRef(false);
  const mechanicKind = useRef<"PRESS" | "EFFORT" | "SORT" | "PLACE" | null>(null);
  const mechanicStage = useRef<string | null>(null);
  const mechanicPhase = useRef<"READY" | "ACTIVE" | "COMMIT" | "COMPLETE">("READY");
  const mechanicCommitAt = useRef(0);
  const handMid = useRef(new THREE.Vector3());
  // Script-correct document for this beat; legacy default keeps the old
  // Pike-proof look for any unmapped context.
  const paperContent: PaperContent =
    props.paper ??
    (props.paperMode === "READ"
      ? { kind: "PAIR", left: "PIKE_PROOF_STAMPED", right: "PIKE_PROOF_PLAIN" }
      : { kind: "SHEET", documentId: "PIKE_PROOF_PLAIN" });

  useEffect(() => {
    const onVisual = (event: Event) => {
      const detail = (event as CustomEvent<{
        kind?:
          | "PRESS"
          | "EFFORT"
          | "SORT"
          | "PLACE"
          | "PRINT_JOB"
          | "HAUL_JOB"
          | "POST_JOB";
        progress?: number;
        stage?: string;
        active?: boolean;
        phase?: "READY" | "ACTIVE" | "COMMIT" | "COMPLETE";
      }>).detail;
      mechanicProgress.current = detail?.progress ?? 0;
      mechanicActive.current = Boolean(detail?.active);
      mechanicStage.current = detail?.stage ?? null;
      mechanicKind.current =
        detail?.kind === "PRINT_JOB"
          ? "PRESS"
          : detail?.kind === "HAUL_JOB"
            ? "EFFORT"
            : detail?.kind === "POST_JOB"
              ? "PLACE"
              : detail?.kind ?? null;
      const nextPhase = detail?.phase ?? (detail?.active ? "ACTIVE" : "READY");
      if (
        (nextPhase === "COMMIT" || nextPhase === "COMPLETE") &&
        mechanicPhase.current !== "COMMIT" &&
        mechanicPhase.current !== "COMPLETE"
      ) {
        mechanicCommitAt.current = performance.now();
      }
      mechanicPhase.current = nextPhase;
    };
    window.addEventListener("pa:mechanic-visual", onVisual);
    return () => window.removeEventListener("pa:mechanic-visual", onVisual);
  }, []);

  useFrame(({ clock }, dt) => {
    if (
      !root.current ||
      !leftArm.current ||
      !rightArm.current ||
      !paper.current
    ) return;
    root.current.visible = props.active;
    if (!props.active) {
      wasActive.current = false;
      return;
    }
    root.current.position.copy(camera.position);
    root.current.quaternion.copy(camera.quaternion);
    // Head-camera beats: the visible body's own arms are the hands, so the
    // synthetic arm rig (and its sleeves) stays out of the frame entirely.
    const headCam = Boolean(props.headCam);
    leftArm.current.visible = !headCam;
    rightArm.current.visible = !headCam;

    const phase = props.reducedMotion ? 0 : clock.elapsedTime;
    const pulse = Math.sin(phase * 5);
    const holdingPaper =
      (props.motion === "CATCH" || props.paperMode === "READ") && !props.introActive;
    const leftPosition = new THREE.Vector3(-0.24, -0.62, -1.08);
    const rightPosition = new THREE.Vector3(0.24, -0.62, -1.08);
    const leftRotation = new THREE.Euler(-0.22, 0.08, -0.08);
    const rightRotation = new THREE.Euler(-0.22, -0.08, 0.08);

    switch (props.motion) {
      case "CATCH": {
        // The tossed sheet flutters just above the waiting grip and the hold
        // steadies it down into the hands. The hands sit BEHIND the sheet from
        // frame one (the sheet is nearer the camera), so its face occludes the
        // palms/fingers throughout — only knuckle slivers show at its edges.
        // Wide raised open palms read as a floating claw; never show them.
        const progress = mechanicProgress.current;
        const settle = mechanicActive.current ? Math.max(0, pulse) * 0.012 : 0;
        const x = THREE.MathUtils.lerp(0.14, 0.11, progress);
        const y = THREE.MathUtils.lerp(-0.68, -0.62, progress) + settle;
        const z = THREE.MathUtils.lerp(-1.16, -1.08, progress);
        leftPosition.set(-x, y, z);
        rightPosition.set(x, y, z);
        leftRotation.set(THREE.MathUtils.lerp(-0.45, -0.3, progress), 0.12, -0.1);
        rightRotation.set(THREE.MathUtils.lerp(-0.45, -0.3, progress), -0.12, 0.1);
        break;
      }
      case "PRESS": {
        const sweep = mechanicKind.current === "PRESS" ? mechanicProgress.current : 0.5;
        const committing = mechanicKind.current === "PRESS" && mechanicPhase.current === "COMMIT";
        // The left hand braces the press bed while the right hand works the
        // stop lever. Its travel mirrors the live timing needle exactly.
        leftPosition.set(-0.21, -0.47, -1.04);
        rightPosition.set(
          THREE.MathUtils.lerp(0.17, 0.08, sweep),
          committing ? -0.56 : -0.43 + Math.sin(sweep * Math.PI) * 0.035,
          committing ? -1.2 : THREE.MathUtils.lerp(-1.1, -1.17, sweep),
        );
        leftRotation.set(-0.3, 0.08, -0.13);
        rightRotation.set(
          committing ? -0.48 : THREE.MathUtils.lerp(-0.18, -0.34, sweep),
          -0.05,
          THREE.MathUtils.lerp(0.16, -0.08, sweep),
        );
        break;
      }
      case "READ":
        // Two sheets held for comparison: hands behind each sheet's lower
        // corner, paper in front.
        leftPosition.set(-0.2, -0.72, -1.0);
        rightPosition.set(0.2, -0.72, -1.0);
        leftRotation.set(-0.28, 0.1, -0.1);
        rightRotation.set(-0.28, -0.1, 0.1);
        break;
      case "HANDOFF":
      case "GESTURE":
        if (mechanicKind.current === "PLACE") {
          const placeCommitted =
            mechanicPhase.current === "COMMIT" || mechanicPhase.current === "COMPLETE";
          if (placeCommitted) {
            // Tacked: the sheet has left the hands for the world board
            // (PostedNotice mounts it there with its tacks), so both arms
            // simply withdraw below the frame. With the fixed open-palm arm
            // asset, any bare hand raised against the board reads as a
            // floating claw, so the posted sheet carries the beat alone.
            leftPosition.set(-0.16, -1.05, -1.0);
            rightPosition.set(0.16, -1.05, -1.0);
            leftRotation.set(-0.2, 0.08, -0.12);
            rightRotation.set(-0.2, -0.08, 0.12);
          } else {
            // Aligning: both hands behind the notice's lower half, arms
            // rising nearly vertically from the bottom edge (narrow V); the
            // slider walks hands + sheet together across the board line.
            const alignment = mechanicProgress.current - 0.5;
            leftPosition.set(-0.085 + alignment * 0.24, -0.57, -1.04);
            rightPosition.set(0.085 + alignment * 0.24, -0.57, -1.04);
            leftRotation.set(-0.34, 0.1, -0.1);
            rightRotation.set(-0.34, -0.1, 0.1);
          }
        } else if (props.paperMode === "PLACE") {
          // Handing the document over: both hands grip its lower corners low
          // in the frame (the steadied-catch grip), then the arms extend it
          // together toward the receiver as the hold progresses.
          const extend = mechanicKind.current === "EFFORT" ? mechanicProgress.current : 0;
          const settle = mechanicActive.current ? Math.max(0, pulse) * 0.008 : 0;
          const x = THREE.MathUtils.lerp(0.11, 0.095, extend);
          const y = THREE.MathUtils.lerp(-0.68, -0.58, extend) + settle;
          const z = THREE.MathUtils.lerp(-1.13, -1.28, extend);
          leftPosition.set(-x, y, z);
          rightPosition.set(x, y, z);
          leftRotation.set(THREE.MathUtils.lerp(-0.3, -0.42, extend), 0.12, -0.1);
          rightRotation.set(THREE.MathUtils.lerp(-0.3, -0.42, extend), -0.12, 0.1);
        } else {
          rightPosition.set(0.08, -0.5, -1.14);
        }
        break;
      case "CARRY":
        {
          const lift = mechanicKind.current === "EFFORT" ? mechanicProgress.current : 0;
          const x = THREE.MathUtils.lerp(0.27, 0.18, lift);
          const y = THREE.MathUtils.lerp(-0.6, -0.42, lift);
          const z = THREE.MathUtils.lerp(-0.98, -1.13, lift);
          leftPosition.set(-x, y + pulse * 0.01 * lift, z);
          rightPosition.set(x, y - pulse * 0.01 * lift, z);
          leftRotation.z = THREE.MathUtils.lerp(-0.08, -0.22, lift);
          rightRotation.z = THREE.MathUtils.lerp(0.08, 0.22, lift);
        }
        break;
      case "IDLE":
      case "WALK":
      case "TALK":
        break;
    }

    // Committing a placement plays a quick tack beat: snap responsiveness up
    // so the two nail taps and the sheet settling read at full speed.
    const placeCommitBeat =
      mechanicKind.current === "PLACE" &&
      (mechanicPhase.current === "COMMIT" || mechanicPhase.current === "COMPLETE");
    const blend = props.reducedMotion || !wasActive.current
      ? 1
      : 1 - Math.exp(-(placeCommitBeat ? 26 : 12) * Math.min(dt, 0.05));
    if (!headCam) {
      leftArm.current.position.lerp(leftPosition, blend);
      rightArm.current.position.lerp(rightPosition, blend);
      dampEuler(leftArm.current.rotation, leftRotation, blend);
      dampEuler(rightArm.current.rotation, rightRotation, blend);
    }
    const commitPhase =
      mechanicPhase.current === "COMMIT" || mechanicPhase.current === "COMPLETE";
    // Once a hand-grip effort commits, the held sheet/bundle leaves the
    // player's hands: the world-side prop (or receiver) carries it from here.
    // A committed tack likewise hands the notice to the world board
    // (PostedNotice mounts it at commit), so the nail-tap beat plays against
    // the posted sheet rather than a duplicate held one.
    const handedOver =
      ((props.motion === "HANDOFF" || props.motion === "GESTURE") &&
        mechanicKind.current === "EFFORT" &&
        commitPhase) ||
      (mechanicKind.current === "PLACE" && commitPhase);
    const showPaper =
      props.paperMode !== "NONE" &&
      (props.paperMode !== "CATCH" || !props.introActive) &&
      mechanicStage.current !== "INK" &&
      !handedOver;
    paper.current.visible = showPaper;
    const effortProgress =
      mechanicKind.current === "EFFORT" ? mechanicProgress.current : 0;
    // A held document belongs to the two-hand grip only while the arms are in
    // the handoff pose; press-work beats keep the sheet on the work surface.
    const handGrip = props.motion === "HANDOFF" || props.motion === "GESTURE";
    // The paper always sits slightly nearer the camera than the hands so the
    // sheet occludes finger geometry while wrists stay visible at its edges.
    let paperTilt =
      props.paperMode === "PLACE"
        ? mechanicKind.current === "PLACE"
          ? placeCommitBeat ? -0.02 : -0.12
          : handGrip
            ? THREE.MathUtils.lerp(-0.16, -0.3, effortProgress)
            : -0.12
        : -0.14;
    let paperWobble = 0;
    const paperTarget =
      props.paperMode === "READ"
        ? paperContent.kind === "SORT_FAN"
          // The sort fan sits low so the HUD sort panel does not cover it.
          ? new THREE.Vector3(0, -0.31, -0.86)
          : new THREE.Vector3(0, -0.2, -0.94)
        : props.paperMode === "PLACE"
          ? mechanicKind.current === "PLACE"
            // Aligning against the notice board: the sheet rides low in the
            // frame (under the placement panel) just above the two-hand grip,
            // tracking the alignment slider together with the hands. On
            // commit the paper is handed to the world board, so this target
            // only steers the pre-commit hold.
            ? new THREE.Vector3(
                (mechanicProgress.current - 0.5) * 0.24,
                -0.38,
                -0.98,
              )
            : handGrip
              // Handing the sheet over: it stays in the two-hand grip low in
              // the frame (the steadied-catch pose) and travels with the
              // hands toward the receiver as the hold extends the arms.
              ? new THREE.Vector3(
                  0,
                  THREE.MathUtils.lerp(-0.26, -0.21, effortProgress),
                  THREE.MathUtils.lerp(-1.05, -1.2, effortProgress),
                )
              // Press-work with a staged sheet: keep it low over the bed.
              : new THREE.Vector3(
                  0,
                  THREE.MathUtils.lerp(-0.2, -0.08, effortProgress),
                  THREE.MathUtils.lerp(-1.0, -1.17, effortProgress),
                )
          : holdingPaper
            ? new THREE.Vector3(0, THREE.MathUtils.lerp(-0.26, -0.2, mechanicProgress.current), -1.05)
            : new THREE.Vector3(0, THREE.MathUtils.lerp(-0.24, -0.18, effortProgress), -1.08);
    if (props.motion === "CATCH" && props.paperMode === "CATCH") {
      // Tossed-sheet flight: it hangs fluttering where Abigail's toss ended
      // (upper band, mostly behind the grip panel), and holding steadies it
      // DOWN into the visible band under the panel where the rising hands
      // meet it. The tumble damps out as the grip takes.
      const progress = mechanicProgress.current;
      const drift = 1 - progress;
      // Idle it hangs in the visible band UNDER the input panel (y/z ratio
      // ~0.24, just clear of the panel's bottom edge at both viewports);
      // the hold draws it nearer, growing it down into the rising grip.
      paperTarget.set(
        Math.sin(phase * 1.7) * 0.05 * drift,
        THREE.MathUtils.lerp(-0.34, -0.32, progress) + Math.sin(phase * 2.3) * 0.03 * drift,
        THREE.MathUtils.lerp(-1.4, -1.0, progress),
      );
      // Mostly upright while airborne (a flatter tilt read as lying on the
      // floor from the eye-level camera), settling toward the read grip.
      paperTilt = THREE.MathUtils.lerp(-0.3, -0.16, progress);
      paperWobble = Math.sin(phase * 3.1) * 0.2 * drift;
    }
    // Head-camera beats: a hand-held sheet/bundle rides the visible hands.
    // The hand-bone midpoint (world) converts into this camera-locked
    // group's space; the grip sits at the sheet's lower edge so the paper
    // stays the subject while the real fingers curl behind/below it.
    const handsFresh =
      props.hands &&
      props.hands.updatedAt > 0 &&
      performance.now() - props.hands.updatedAt < 250;
    const gripPaper =
      headCam &&
      handsFresh &&
      paperContent.kind !== "SORT_FAN" &&
      paperContent.kind !== "PAIR" &&
      (handGrip || (props.motion === "CATCH" && mechanicProgress.current > 0.65));
    if (gripPaper) {
      root.current.updateMatrixWorld();
      handMid.current
        .copy(props.hands!.left)
        .add(props.hands!.right)
        .multiplyScalar(0.5);
      root.current.worldToLocal(handMid.current);
      // Keep the sheet legible: push it out along its own sight ray if the
      // hands ride too close to the near plane, then clamp it into the lower
      // visible band (proportional to depth so it works at any fov/aspect).
      if (handMid.current.z > -0.72) {
        const scale = handMid.current.z < -0.01 ? -0.72 / handMid.current.z : 1;
        handMid.current.multiplyScalar(Math.max(scale, 1));
        handMid.current.z = Math.min(handMid.current.z, -0.72);
      }
      const depth = -handMid.current.z;
      handMid.current.x = THREE.MathUtils.clamp(
        handMid.current.x, -0.3 * depth, 0.3 * depth,
      );
      handMid.current.y = THREE.MathUtils.clamp(
        handMid.current.y, -0.42 * depth, 0.08 * depth,
      );
      paperTarget.set(
        handMid.current.x,
        handMid.current.y + 0.13,
        handMid.current.z,
      );
      if (mechanicKind.current === "PLACE" && !placeCommitBeat) {
        // The alignment slider still walks the sheet across the board line.
        paperTarget.x += (mechanicProgress.current - 0.5) * 0.24;
      }
      paperTilt = -0.2;
    }
    paper.current.position.lerp(paperTarget, blend);
    paper.current.rotation.x = THREE.MathUtils.lerp(paper.current.rotation.x, paperTilt, blend);
    paper.current.rotation.z = THREE.MathUtils.lerp(paper.current.rotation.z, paperWobble, blend);
    wasActive.current = true;
  });

  return (
    <group ref={root} visible={false}>
      <group ref={leftArm}>
        <SleeveExtension side="LEFT" />
        <FittedGlb
          glbKey="first-person-left-arm"
          size={[0.26, 0.58, 0.28]}
          fallback={<group />}
        />
        <PrinterInkBall side="LEFT" reducedMotion={props.reducedMotion} />
      </group>
      <group ref={rightArm}>
        <SleeveExtension side="RIGHT" />
        <group scale={[-1, 1, 1]}>
          <FittedGlb
            glbKey="first-person-left-arm"
            size={[0.26, 0.58, 0.28]}
            fallback={<group />}
          />
        </group>
        <PrinterInkBall side="RIGHT" reducedMotion={props.reducedMotion} />
      </group>
      <group
        ref={paper}
        visible={false}
        position={[0, -0.12, -1.08]}
        rotation={[0.02, 0, 0]}
      >
        {paperContent.kind === "PAIR" ? (
          <>
            <ProofSheetMesh
              texture={getDocumentTexture(paperContent.left)}
              position={[-0.17, 0, 0]}
              rotation={[0, 0.08, -0.035]}
              size={[0.22, 0.3]}
            />
            <ProofSheetMesh
              texture={getDocumentTexture(paperContent.right)}
              position={[0.17, 0, 0]}
              rotation={[0, -0.08, 0.035]}
              size={[0.22, 0.3]}
            />
          </>
        ) : paperContent.kind === "BUNDLE" ? (
          <HandbillBundle wrap={paperContent.wrap} progressRef={mechanicProgress} />
        ) : paperContent.kind === "SORT_FAN" ? (
          <SortFan reducedMotion={props.reducedMotion} />
        ) : (
          <ProofSheetMesh
            texture={getDocumentTexture(paperContent.documentId)}
            size={[0.22, 0.3]}
          />
        )}
      </group>
    </group>
  );
}

function SleeveExtension(props: { side: "LEFT" | "RIGHT" }) {
  // Continues the generated arm's white linen shirt off the bottom frame
  // edge (fallback beats only; head-camera beats use the real body's own
  // sleeves). Closed-cap cylinders — an open-ended cone showed its dark
  // interior and read as a hoof stump — in the GLB sleeve's linen tone, with
  // a short dark coat cuff where cloth meets wrist, angled down along the
  // forearm so the sleeve always exits the frame.
  const cuffX = 0.02 * (props.side === "LEFT" ? -1 : 1);
  const lean = 0.1 * (props.side === "LEFT" ? 1 : -1);
  return (
    <group position={[cuffX, -0.06, 0.09]} rotation={[0.42, 0, lean]}>
      <mesh position={[0, -0.03, 0]} castShadow renderOrder={-1}>
        <cylinderGeometry args={[0.06, 0.068, 0.09, 20]} />
        <meshStandardMaterial color="#42372b" roughness={0.9} metalness={0} />
      </mesh>
      <mesh position={[0, -0.36, 0]} castShadow renderOrder={-1}>
        <cylinderGeometry args={[0.066, 0.09, 0.66, 20]} />
        <meshStandardMaterial color="#e9e2d2" roughness={0.95} metalness={0} />
      </mesh>
    </group>
  );
}

function dampEuler(current: THREE.Euler, target: THREE.Euler, blend: number) {
  current.x = THREE.MathUtils.lerp(current.x, target.x, blend);
  current.y = THREE.MathUtils.lerp(current.y, target.y, blend);
  current.z = THREE.MathUtils.lerp(current.z, target.z, blend);
}

function ProofSheetMesh(props: {
  texture: THREE.Texture;
  position?: [number, number, number];
  rotation?: [number, number, number];
  size: [number, number];
}) {
  return (
    <mesh position={props.position} rotation={props.rotation}>
      <planeGeometry args={props.size} />
      <meshBasicMaterial
        map={props.texture}
        color="#ffffff"
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </mesh>
  );
}

// The rider's anti-Stamp handbill bundle: a thin offset stack with the slogan
// legible on the top bill. With `wrap`, the plain wrap sheet folds across the
// face as the conceal hold progresses (pa:mechanic-visual progress).
function HandbillBundle(props: {
  wrap: boolean;
  progressRef: MutableRefObject<number>;
}) {
  const hinge = useRef<THREE.Group>(null);
  const handbill = getDocumentTexture("ANTI_STAMP_HANDBILL");
  const wrapTexture = getDocumentTexture("PLAIN_WRAP");
  const width = 0.19;
  const height = 0.245;
  useFrame(() => {
    if (!hinge.current) return;
    const fold = props.wrap ? THREE.MathUtils.clamp(props.progressRef.current, 0, 1) : 0;
    // The wrap starts folded back past the bundle's left edge, then swings
    // over the face as the tuck progresses.
    hinge.current.rotation.y = THREE.MathUtils.lerp(-2.55, 0, fold);
    hinge.current.visible = props.wrap;
  });
  return (
    <group>
      {[3, 2, 1].map((depth) => (
        <mesh
          key={depth}
          position={[depth * 0.006, -depth * 0.005, -depth * 0.0035]}
          rotation={[0, 0, depth * 0.045]}
        >
          <planeGeometry args={[width, height]} />
          <meshBasicMaterial
            map={handbill}
            color={depth === 1 ? "#d9d2c0" : depth === 2 ? "#bfb59e" : "#a89d84"}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      ))}
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={handbill} color="#ffffff" side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <group position={[-width / 2, 0, 0.004]} ref={hinge} visible={props.wrap}>
        <mesh position={[width * 0.54, -0.004, 0]} rotation={[0, 0, -0.03]}>
          <planeGeometry args={[width * 1.08, height * 1.05]} />
          <meshBasicMaterial map={wrapTexture} color="#ffffff" side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

// Pike's sort pile fanned for inspection: deed, writ, newspaper, letter, and
// the wooden ruler (not paper). The HUD sort panel carries the interaction;
// SortFanSlide moves each assigned item onto its pile (left = needs the
// stamp, right = does not) as the player commits assignments.
function SortFan(props: { reducedMotion: boolean }) {
  const slots: { x: number; y: number; tilt: number }[] = [
    { x: -0.31, y: -0.015, tilt: 0.16 },
    { x: -0.155, y: 0.008, tilt: 0.08 },
    { x: 0, y: 0.018, tilt: 0 },
    { x: 0.155, y: 0.008, tilt: -0.08 },
    { x: 0.31, y: -0.015, tilt: -0.16 },
  ];
  return (
    <group>
      {SORT_FAN_ITEMS.map((item, index) => {
        const slot = slots[index]!;
        if (item.documentId === "WOOD_TOOL") {
          // Pike's wooden ruler, laid at the fan's edge.
          return (
            <SortFanSlide
              key={item.itemId}
              itemId={item.itemId}
              basePosition={[slot.x, slot.y - 0.02, index * 0.002]}
              baseRotation={[0.1, 0, slot.tilt + 0.5]}
              reducedMotion={props.reducedMotion}
            >
              <mesh>
                <boxGeometry args={[0.026, 0.15, 0.008]} />
                <meshStandardMaterial color="#7a5330" roughness={0.85} />
              </mesh>
              {[-0.05, -0.02, 0.01, 0.04].map((markY) => (
                <mesh key={markY} position={[0, markY, 0.0045]}>
                  <boxGeometry args={[0.016, 0.0022, 0.0012]} />
                  <meshStandardMaterial color="#3d2a16" roughness={0.9} />
                </mesh>
              ))}
            </SortFanSlide>
          );
        }
        return (
          <SortFanSlide
            key={item.itemId}
            itemId={item.itemId}
            basePosition={[slot.x, slot.y, index * 0.002]}
            baseRotation={[0, 0, slot.tilt]}
            reducedMotion={props.reducedMotion}
          >
            <mesh>
              <planeGeometry args={[0.135, 0.18]} />
              <meshBasicMaterial
                map={getDocumentTexture(item.documentId)}
                color="#ffffff"
                side={THREE.DoubleSide}
                toneMapped={false}
              />
            </mesh>
          </SortFanSlide>
        );
      })}
    </group>
  );
}
