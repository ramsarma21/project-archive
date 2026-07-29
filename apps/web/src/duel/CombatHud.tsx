import {
  Suspense,
  memo,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { STAND_HEIGHT } from "@pa/engine-world";
import {
  PALM_DROP_M,
  SOCKET_OFFSET_M,
  TRIM_EULER_DEG,
  findHandBone,
  seatWeaponInHand,
} from "./weaponSocket.js";
import {
  PORTRAIT_HEAD_LIFT_RAD,
  PORTRAIT_NECK_LIFT_RAD,
  portraitClipName,
  portraitSampleSeconds,
} from "./portraitPose.js";
import { ammoReadout, healthTone, type AmmoReadout } from "./combatHudModel.js";
import {
  AmmoNumbers,
  ControlsLegend,
  EnemyHealth,
  HealthBar,
  HitMarker,
} from "./combatHudParts.js";
import "./combatHud.css";

// The Overwatch-style combat HUD, shared by the boss duel and the live arena so the
// two read as ONE language rather than two dialects.
//
//   bottom-left   the hero: a live portrait of the rig you play, a bevelled frame, and
//                 a large player health bar with a recent-damage chip and distinct
//                 damaged/critical states (never colour-only).
//   bottom-right  the ammo: the ACTUAL flintlock model beside a Cassidy-style current-
//                 over-reserve reading. No caption — the reload mechanic is learned in
//                 the fight, not parked permanently in the HUD.
//   top-centre    the enemy: a prominent bar on a scrim that keeps it and the round/
//                 timer legible over a bright sky OR a dark scene, with a damage-chip
//                 trail so a landed shot reads as the bite it took.
//   top-left      the controls legend, hold-Tab-to-view, with a small persistent hint.
//   centre        the hit marker: flashes once per authoritative hit, harder on a
//                 threshold cross or a knockout.
//
// THE ANSWERING-BEAT RULE. While a question is open the fight is frozen, so the whole
// HUD withdraws — honest (nothing it shows is moving) and the clean fix for its
// clusters colliding with the centred question overlay at 1024x692. `withdrawn` carries
// that decision in from the caller, which knows the phase.
//
// The DOM pieces live in `combatHudParts.tsx` so they can be component-tested without a
// stylesheet or a WebGL context; this file adds the live GLB views and the layout.

// ---------------------------------------------------------------------------
// Live GLB views: the real imported assets, transformed and shaded at runtime (which
// the imported-visible-world rule allows), never a primitive stand-in or a 2D drawing.
// Rendered on demand: the pose is static, so after first paint they cost nothing.
// ---------------------------------------------------------------------------

const CHARACTER_URL_TOKEN = "production-cast-10";
const PISTOL_URL = "/world/props/flintlock-pistol.glb";

function characterUrl(glbKey: string): string {
  return `/world/characters/${glbKey}.glb?v=${CHARACTER_URL_TOKEN}`;
}

/**
 * Pump a few frames after mount on a `demand` canvas.
 *
 * A single `invalidate()` can paint before an imported GLB's textures have finished
 * decoding — leaving the portrait or the weapon blank on a cold load, which QA caught.
 * Pumping for a short window covers the decode, then goes idle so the static view still
 * costs nothing at rest.
 */
function usePaintPump(durationMs = 1800): void {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    let raf = 0;
    const start = typeof performance !== "undefined" ? performance.now() : Date.now();
    const pump = (): void => {
      invalidate();
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - start < durationMs) raf = requestAnimationFrame(pump);
    };
    raf = requestAnimationFrame(pump);
    return () => cancelAnimationFrame(raf);
  }, [invalidate]);
}

function prepMaterials(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      material.side = THREE.DoubleSide;
      material.depthWrite = true;
      material.needsUpdate = true;
    }
  });
}

/** The first bone whose sanitised name ends with `suffix` (so `Head`, not `HeadTop_End`). */
function findBoneEndingWith(root: THREE.Object3D, suffix: string): THREE.Bone | null {
  const re = new RegExp(`${suffix}$`, "i");
  let found: THREE.Bone | null = null;
  root.traverse((node) => {
    if (found) return;
    const bone = node as THREE.Bone;
    if (bone.isBone && re.test(bone.name)) found = bone;
  });
  return found;
}

/** Turn toward camera for a hero three-quarter, in radians. */
const PORTRAIT_BODY_YAW = -0.34;

/** One posed, framed frame of the player's rig, holding the flintlock. */
function PortraitRig(props: { glbKey: string }) {
  const gltf = useGLTF(characterUrl(props.glbKey));
  const pistol = useGLTF(PISTOL_URL);
  const invalidate = useThree((state) => state.invalidate);
  usePaintPump();

  const rig = useMemo(() => {
    const root = skeletonClone(gltf.scene);
    prepMaterials(root);
    root.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    const scale = size.y > 1e-4 ? STAND_HEIGHT / size.y : 1;
    root.scale.setScalar(scale);
    root.updateMatrixWorld(true);
    root.position.y -= new THREE.Box3().setFromObject(root).min.y;
    // Turn to a three-quarter so both shoulders and the forward weapon read.
    root.rotation.y = PORTRAIT_BODY_YAW;
    return root;
  }, [gltf.scene]);

  useEffect(() => {
    const bone = findHandBone(rig);
    if (!bone) return undefined;
    rig.updateMatrixWorld(true);
    const weapon = pistol.scene.clone(true);
    const socket = seatWeaponInHand({
      bone,
      weapon,
      grip: { offset: SOCKET_OFFSET_M, trimEulerDeg: TRIM_EULER_DEG, palmDrop: PALM_DROP_M },
      name: "portrait.socket",
    });
    bone.add(socket);
    invalidate();
    return () => {
      bone.remove(socket);
    };
  }, [rig, pistol.scene, invalidate]);

  useEffect(() => {
    const names = gltf.animations.map((clip) => clip.name);
    const chosen = portraitClipName(props.glbKey, names);
    const clip = chosen ? gltf.animations.find((candidate) => candidate.name === chosen) : undefined;
    const neck = findBoneEndingWith(rig, "Neck");
    const head = findBoneEndingWith(rig, "Head");
    if (!clip) {
      invalidate();
      return undefined;
    }
    const mixer = new THREE.AnimationMixer(rig);
    mixer.clipAction(clip).play();
    mixer.update(portraitSampleSeconds(clip.duration));
    // Lift the gaze off the sights toward the viewer — the one thing a combat pose does
    // not give a portrait. Applied AFTER the mixer sample so the clip cannot overwrite
    // it, and split neck/head so it curves rather than snapping the skull. Negative
    // local-X pitches the Mixamo neck/head chain up.
    if (neck) neck.rotation.x -= PORTRAIT_NECK_LIFT_RAD;
    if (head) head.rotation.x -= PORTRAIT_HEAD_LIFT_RAD;
    rig.updateMatrixWorld(true);
    invalidate();
    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(rig);
    };
  }, [rig, gltf.animations, props.glbKey, invalidate]);

  return <primitive object={rig} />;
}

/** The player-portrait canvas. Memoised on the rig key so HUD re-renders never remount it. */
const HeroPortrait = memo(function HeroPortrait(props: { glbKey: string }) {
  return (
    <div className="cbt-portrait" aria-hidden>
      <Canvas
        className="cbt-portrait-canvas"
        frameloop="demand"
        dpr={[1, 1.75]}
        gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
        camera={{ fov: 30, near: 0.1, far: 14, position: [0.52, 1.26, 1.66] }}
        onCreated={({ camera }) => camera.lookAt(-0.05, 1.52, 0)}
      >
        {/* Flattering three-point: a warm key from front-right, a cool cyan rim from
            behind-left to lift the silhouette off the panel, and a soft front fill. */}
        <ambientLight intensity={0.7} />
        <directionalLight position={[2.6, 3.2, 3.0]} intensity={1.7} color="#fff2e0" />
        <directionalLight position={[-2.8, 2.2, -1.6]} intensity={0.8} color="#8fd0ff" />
        <directionalLight position={[0, 1.4, 3.4]} intensity={0.45} />
        <Suspense fallback={null}>
          <PortraitRig glbKey={props.glbKey} />
        </Suspense>
      </Canvas>
    </div>
  );
});

/** One framed frame of the flintlock GLB, angled for the ammo cluster. */
function WeaponModel() {
  const pistol = useGLTF(PISTOL_URL);
  const invalidate = useThree((state) => state.invalidate);
  usePaintPump();
  const group = useMemo(() => {
    const root = pistol.scene.clone(true);
    prepMaterials(root);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    root.position.sub(box.getCenter(new THREE.Vector3()));
    const holder = new THREE.Group();
    holder.add(root);
    // Barrel to the left, grip toward the viewer: a readable three-quarter of a pistol.
    holder.rotation.set(0.12, -0.5, 0);
    return holder;
  }, [pistol.scene]);
  useEffect(() => {
    invalidate();
  }, [group, invalidate]);
  return <primitive object={group} />;
}

const WeaponView = memo(function WeaponView() {
  return (
    <div className="cbt-weapon-view" aria-hidden>
      <Canvas
        className="cbt-weapon-canvas"
        frameloop="demand"
        dpr={[1, 1.75]}
        gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
        camera={{ fov: 32, near: 0.01, far: 6, position: [0, 0.06, 0.58] }}
        onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
      >
        <ambientLight intensity={0.9} />
        <directionalLight position={[1.2, 1.8, 1.4]} intensity={1.7} />
        <directionalLight position={[-1.4, 0.6, -0.8]} intensity={0.5} color="#8fd0ff" />
        <Suspense fallback={null}>
          <WeaponModel />
        </Suspense>
      </Canvas>
    </div>
  );
});

// ---------------------------------------------------------------------------
// The clusters that wrap the live views around the DOM parts.
// ---------------------------------------------------------------------------

/** Bottom-left: the hero portrait, the weapon name, and the large player health bar. */
function HeroPanel(props: {
  name: string;
  weaponLabel: string;
  glbKey: string;
  health: number;
  maxHealth: number;
  reducedMotion: boolean;
}) {
  const tone = healthTone(props.health, props.maxHealth);
  return (
    <div className={`cbt-hero cbt-hero-${tone}`}>
      <HeroPortrait glbKey={props.glbKey} />
      <div className="cbt-hero-body">
        <div className="cbt-hero-head">
          <span className="cbt-name">{props.name}</span>
          <span className="cbt-weapon">{props.weaponLabel}</span>
        </div>
        <HealthBar
          health={props.health}
          maxHealth={props.maxHealth}
          reducedMotion={props.reducedMotion}
        />
      </div>
    </div>
  );
}

/** Bottom-right: the flintlock model and a Cassidy-style current-over-reserve reading. */
function AmmoCluster(props: { ammo: AmmoReadout }) {
  const { ammo } = props;
  const state = ammo.empty ? "empty" : ammo.low ? "low" : "ready";
  return (
    <div className={`cbt-ammo cbt-ammo-${state}`}>
      <AmmoNumbers ammo={ammo} />
      <WeaponView />
      <p className="cbt-sr" role="status" aria-live="polite">
        {ammo.empty ? "out of ammunition" : `${ammo.current} of ${ammo.total} rounds loaded`}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The layer that positions everything. One overlay, both modes.
// ---------------------------------------------------------------------------

export interface CombatHudSelf {
  readonly name: string;
  readonly weaponLabel: string;
  readonly glbKey: string;
  readonly health: number;
  readonly maxHealth: number;
  readonly ammo: AmmoReadout;
}

export interface CombatHudEnemy {
  readonly name: string;
  readonly role?: string;
  readonly health: number;
  readonly maxHealth: number;
  /**
   * Clean hits this opponent is from the ground, at the player's own shot damage.
   * When set it is drawn as a persistent line under the enemy pool — the useful read
   * the retired line-of-sight break card used to give only after stopping the fight.
   * Omitted (PvP today) draws nothing.
   */
  readonly hitsToFall?: number;
  /** True once the opponent is down, so the line reads "down" rather than "0". */
  readonly downed?: boolean;
}

export interface CombatHudControls {
  readonly items: readonly { keys: string; action: string }[];
  readonly held: boolean;
}

export interface CombatHudProps {
  readonly self: CombatHudSelf;
  readonly enemy: CombatHudEnemy;
  readonly clockSeconds?: number | null;
  readonly clockUrgent?: boolean;
  readonly round?: number;
  readonly withdrawn?: boolean;
  readonly showReticle?: boolean;
  readonly controls?: CombatHudControls;
  readonly reducedMotion?: boolean;
}

export function CombatHud(props: CombatHudProps): ReactNode {
  const reducedMotion = props.reducedMotion ?? false;
  const withdrawn = props.withdrawn ?? false;
  return (
    <div className={`cbt${withdrawn ? " is-withdrawn" : ""}${reducedMotion ? " is-reduced" : ""}`}>
      {props.controls && <ControlsLegend items={props.controls.items} held={props.controls.held} />}

      <div className="cbt-top">
        <EnemyHealth
          name={props.enemy.name}
          {...(props.enemy.role ? { role: props.enemy.role } : {})}
          health={props.enemy.health}
          maxHealth={props.enemy.maxHealth}
          {...(props.enemy.hitsToFall !== undefined
            ? { hitsToFall: props.enemy.hitsToFall }
            : {})}
          {...(props.enemy.downed !== undefined ? { downed: props.enemy.downed } : {})}
          {...(props.round !== undefined ? { round: props.round } : {})}
          clockSeconds={props.clockSeconds ?? null}
          clockUrgent={props.clockUrgent ?? false}
          reducedMotion={reducedMotion}
        />
      </div>

      {props.showReticle && !withdrawn && (
        <HitMarker
          enemyHealth={props.enemy.health}
          enemyMaxHealth={props.enemy.maxHealth}
          reducedMotion={reducedMotion}
        />
      )}

      <div className="cbt-bottom">
        <HeroPanel
          name={props.self.name}
          weaponLabel={props.self.weaponLabel}
          glbKey={props.self.glbKey}
          health={props.self.health}
          maxHealth={props.self.maxHealth}
          reducedMotion={reducedMotion}
        />
        <AmmoCluster ammo={props.self.ammo} />
      </div>
    </div>
  );
}

export { ammoReadout };

useGLTF.preload(PISTOL_URL);
