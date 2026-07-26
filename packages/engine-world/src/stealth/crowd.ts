// Crowd blending: the historically apt hiding place.
//
// Boston in 1765 was a dense town of crowds, mobs and market throngs, and losing
// yourself in one is the period-correct version of a smoke bomb. Walk into a
// cluster of townspeople and a pursuer's cone stops resolving you as a person to
// chase; sprint into one and you shove your way through a lot of shoulders, which
// is the opposite of blending.
//
// Three rules keep it honest, and the third is the one that makes it a tactic
// rather than a button:
//
//   1. It takes a moment. Blending ramps in over ~0.7s, so it cannot be used as
//      an instant escape at the last possible frame.
//   2. It requires walking. Above 2.4 m/s the crowd parts around you instead.
//   3. A watcher who is close AND who never lost sight of you during the ramp-in
//      watched you walk in. He is not fooled. Breaking his sightline for even a
//      moment first — a cart, a corner, a doorway — is what makes the blend take.

import type { Vec3 } from "../collision.js";
import { STEALTH_TUNING, type StealthTuning } from "./tuning.js";
import { clamp01 } from "./vision.js";

/**
 * A cluster of civilians. Level design owns placement and density; the crowd's
 * own animation and rendering belong to the presentation layer.
 */
export interface CrowdCluster {
  id: string;
  x: number;
  z: number;
  /** Horizontal radius of the cluster. */
  radiusM: number;
  /** Civilians in the cluster. Below the tuned minimum it hides nobody. */
  density: number;
}

export interface CrowdBlendState {
  /** The cluster the player is inside, if any. */
  clusterId: string | null;
  /** Ticks of continuous qualifying presence. */
  insideTicks: number;
  /** Ticks since leaving, used to fade the blend out. */
  exitTicks: number;
  /** [0,1] blend strength. At 1 a cone does not resolve the player at all. */
  strength: number;
  /** True while a watcher watched the player walk in and is not fooled. */
  pierced: boolean;
  /** The watcher that pierced the blend, for HUD and tests. */
  piercedBy: string | null;
}

export function createCrowdBlendState(): CrowdBlendState {
  return {
    clusterId: null,
    insideTicks: 0,
    exitTicks: 0,
    strength: 0,
    pierced: false,
    piercedBy: null,
  };
}

/** The cluster containing this point, nearest centre first. Stable on ties. */
export function clusterContaining(
  clusters: readonly CrowdCluster[],
  x: number,
  z: number,
  tuning: StealthTuning = STEALTH_TUNING,
): CrowdCluster | null {
  let best: CrowdCluster | null = null;
  let bestDistance = Infinity;
  for (const cluster of clusters) {
    if (cluster.density < tuning.crowdBlendMinDensity) continue;
    const distance = Math.hypot(cluster.x - x, cluster.z - z);
    if (distance > cluster.radiusM) continue;
    if (
      distance < bestDistance - 1e-9 ||
      (Math.abs(distance - bestDistance) <= 1e-9 &&
        best !== null &&
        cluster.id < best.id)
    ) {
      best = cluster;
      bestDistance = distance;
    }
  }
  return best;
}

export interface CrowdStepInput {
  playerPosition: Vec3;
  /** Horizontal speed. Above the tuned maximum the crowd parts rather than hides. */
  speedMps: number;
  clusters: readonly CrowdCluster[];
  /**
   * Watchers with unbroken visual contact this tick, and their distance. A close
   * watcher who never lost sight of the player through the whole ramp-in pierces
   * the blend.
   */
  watchersWithContact: readonly { id: string; distanceM: number }[];
}

/**
 * One fixed step of crowd blending.
 *
 * `strength` is what the vision model consumes; it is a ramp rather than a flag
 * so that a partial blend gives a partial reduction and the player can feel the
 * cover arriving.
 */
export function stepCrowdBlend(
  stateIn: CrowdBlendState,
  input: CrowdStepInput,
  tuning: StealthTuning = STEALTH_TUNING,
): CrowdBlendState {
  const state: CrowdBlendState = { ...stateIn };
  const cluster = clusterContaining(
    input.clusters,
    input.playerPosition.x,
    input.playerPosition.z,
    tuning,
  );
  const qualifies =
    cluster !== null && input.speedMps <= tuning.crowdBlendMaxSpeedMps;

  if (!qualifies) {
    state.clusterId = null;
    state.insideTicks = 0;
    state.exitTicks = Math.min(state.exitTicks + 1, tuning.crowdBlendExitTicks);
    state.strength =
      tuning.crowdBlendExitTicks <= 0
        ? 0
        : clamp01(
            state.strength * (1 - state.exitTicks / tuning.crowdBlendExitTicks),
          );
    if (state.exitTicks >= tuning.crowdBlendExitTicks) {
      state.strength = 0;
      state.pierced = false;
      state.piercedBy = null;
    }
    return state;
  }

  if (state.clusterId !== cluster.id) {
    state.clusterId = cluster.id;
    state.insideTicks = 0;
    state.pierced = false;
    state.piercedBy = null;
  }
  state.insideTicks += 1;
  state.exitTicks = 0;

  // A close watcher with contact during the ramp-in saw the player join the
  // crowd. Once the blend has completed, arriving contact no longer pierces it —
  // by then the player is one more body in a throng.
  if (state.insideTicks <= tuning.crowdBlendEnterTicks && !state.pierced) {
    for (const watcher of input.watchersWithContact) {
      if (watcher.distanceM <= tuning.crowdBlendPierceM) {
        state.pierced = true;
        state.piercedBy = watcher.id;
        break;
      }
    }
  }

  if (state.pierced) {
    state.strength = 0;
    return state;
  }

  const ramp =
    tuning.crowdBlendEnterTicks <= 0
      ? 1
      : clamp01(state.insideTicks / tuning.crowdBlendEnterTicks);
  // Denser crowds hide better, but a qualifying cluster always reaches a full
  // break: a partial best-case would make the verb unreliable and therefore
  // unused.
  state.strength = ramp;
  return state;
}
