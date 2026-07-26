// Noise: the one currency shared between movement and stealth.
//
// A noise event is a point in the world with an intensity and a radius. It is
// the only thing parkour hands the stealth field, and it is why movement choices
// have stealth consequences: a hard landing off a roof is loud, a slide is
// moderate, a mantle is quiet, and a thrown object is loud somewhere you are not.
//
// The kind matters, and it is the difference between a diversion working and not
// working. Noise the player made points attention AT the player's position.
// Noise an object made points attention at the OBJECT and contributes nothing to
// the player's own suspicion — otherwise throwing a stone would incriminate you,
// which is the opposite of a diversion.

export type NoiseKind =
  | "PLAYER_MOVE"
  | "PLAYER_LANDING"
  | "DIVERSION_IMPACT"
  | "DIVERSION_REST"
  | "ENVIRONMENT";

export interface NoiseEvent {
  kind: NoiseKind;
  x: number;
  y: number;
  z: number;
  /** [0,1] loudness at the source. */
  intensity: number;
  /** Distance at which the noise is no longer audible at all. */
  radiusM: number;
  /**
   * Multiplier on how long a watcher stays interested in where this noise came
   * from. 1, or absent, is the authored hold.
   *
   * It rides on the EVENT rather than being read from anywhere global, because the
   * only thing that raises it is an ability that armed one specific thrown object,
   * and that object outlives the ability's window. Carrying it here means attention
   * needs to know nothing about abilities: it reads a property of the noise it just
   * heard, exactly as it reads the loudness.
   */
  attentionHoldScale?: number;
}

/** Does this noise implicate the player, or merely redirect attention? */
export function noiseImplicatesPlayer(kind: NoiseKind): boolean {
  return kind === "PLAYER_MOVE" || kind === "PLAYER_LANDING";
}

/**
 * Audibility of a noise at a listener, [0,1]. Linear falloff to the radius; a
 * noise outside its radius is silent rather than faint, so the audible set is
 * bounded and a distant noise can never accumulate suspicion.
 */
export function noiseAudibility(
  noise: NoiseEvent,
  listenerX: number,
  listenerZ: number,
): number {
  if (noise.radiusM <= 0) return 0;
  const distance = Math.hypot(noise.x - listenerX, noise.z - listenerZ);
  if (distance >= noise.radiusM) return 0;
  return noise.intensity * (1 - distance / noise.radiusM);
}
