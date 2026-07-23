import type { InteractionCandidate } from "./interactionRegistry.js";

export interface InteractionPlayer {
  position: { x: number; y: number; z: number };
  facingX: number;
  facingZ: number;
  spaceId: string;
}

export interface ResolvedInteraction {
  candidate: InteractionCandidate;
  distance: number;
  facing: number;
}

export const INTERACTION_HYSTERESIS_M = 0.35;

function eligible(
  candidate: InteractionCandidate,
  player: InteractionPlayer,
  currentId: string | null,
  segmentClear: (
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
  ) => boolean,
): ResolvedInteraction | null {
  if (!candidate.enabled || candidate.spaceId !== player.spaceId) return null;
  const dx = candidate.position[0] - player.position.x;
  const dz = candidate.position[2] - player.position.z;
  const distance = Math.hypot(dx, dz);
  const radius =
    candidate.radius +
    (candidate.id === currentId ? INTERACTION_HYSTERESIS_M : 0);
  if (distance > radius) return null;
  const inverse = distance > 0.001 ? 1 / distance : 1;
  const facing =
    player.facingX * dx * inverse + player.facingZ * dz * inverse;
  if (facing < candidate.facingDot) return null;
  if (
    candidate.losRequired &&
    !segmentClear(
      {
        x: player.position.x,
        y: player.position.y + 1.05,
        z: player.position.z,
      },
      {
        x: candidate.position[0],
        y: candidate.position[1] + 1.05,
        z: candidate.position[2],
      },
    )
  ) {
    return null;
  }
  return { candidate, distance, facing };
}

export function resolveInteraction(input: {
  candidates: readonly InteractionCandidate[];
  player: InteractionPlayer;
  currentId: string | null;
  segmentClear: (
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
  ) => boolean;
}): ResolvedInteraction | null {
  const eligibleCandidates = input.candidates
    .map((candidate) =>
      eligible(
        candidate,
        input.player,
        input.currentId,
        input.segmentClear,
      ),
    )
    .filter((candidate): candidate is ResolvedInteraction =>
      Boolean(candidate),
    )
    .sort(
      (left, right) =>
        right.candidate.priority - left.candidate.priority ||
        left.distance - right.distance ||
        right.facing - left.facing ||
        left.candidate.id.localeCompare(right.candidate.id),
    );
  const best = eligibleCandidates[0] ?? null;
  if (!best || !input.currentId || best.candidate.id === input.currentId) {
    return best;
  }
  const current = eligibleCandidates.find(
    (candidate) => candidate.candidate.id === input.currentId,
  );
  if (!current) return best;
  if (best.candidate.priority > current.candidate.priority) return best;
  if (
    best.candidate.priority === current.candidate.priority &&
    best.distance + INTERACTION_HYSTERESIS_M >= current.distance
  ) {
    return current;
  }
  return best;
}
