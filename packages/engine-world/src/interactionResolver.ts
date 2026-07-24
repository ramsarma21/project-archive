import {
  interactionPresentationMetadata,
  type InteractionCandidate,
} from "./interactionRegistry.js";

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
  phase: "DISCOVERY" | "APPROACH" | "ACTION";
}

export const INTERACTION_HYSTERESIS_M = 0.35;

// Within arm's reach the facing gate is waived: standing ON an anchor with a
// slightly-off heading used to produce dead silence (or offer a FARTHER
// candidate whose facing happened to pass) — the audited gangplank/notice-
// board fussiness (feel-audit-1 P1-3). Facing still gates approach-range
// offers so distant prompts never fire at the player's back.
export const INTERACTION_FACING_WAIVER_M = 0.75;
export const INTERACTION_TARGET_INSET_M = 0.4;
const PHASE_PRIORITY = {
  DISCOVERY: 0,
  APPROACH: 1,
  ACTION: 2,
} as const;

function eligible(
  candidate: InteractionCandidate,
  player: InteractionPlayer,
  currentId: string | null,
  includeDiscovery: boolean,
  segmentClear: (
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
    ignore?: ReadonlySet<string>,
  ) => boolean,
): ResolvedInteraction | null {
  if (!candidate.enabled || candidate.spaceId !== player.spaceId) return null;
  const dx = candidate.position[0] - player.position.x;
  const dz = candidate.position[2] - player.position.z;
  const distance = Math.hypot(dx, dz);
  const metadata = interactionPresentationMetadata(candidate);
  const sticky = candidate.id === currentId ? INTERACTION_HYSTERESIS_M : 0;
  const radius = (includeDiscovery
    ? metadata.discoveryRadius
    : candidate.radius) + sticky;
  if (distance > radius) return null;
  const inverse = distance > 0.001 ? 1 / distance : 1;
  const facing =
    player.facingX * dx * inverse + player.facingZ * dz * inverse;
  if (distance > INTERACTION_FACING_WAIVER_M && facing < candidate.facingDot) {
    return null;
  }
  if (
    (includeDiscovery || candidate.losRequired) &&
    !segmentClear(
      {
        x: player.position.x,
        y: player.position.y + 1.05,
        z: player.position.z,
      },
      {
        // Stop just before the authored anchor: posters, doors, and artifacts
        // often sit directly on their owning collision surface. That surface
        // must not occlude itself, while any wall in front still blocks.
        x:
          candidate.position[0] -
          (distance > INTERACTION_TARGET_INSET_M
            ? (dx / distance) * INTERACTION_TARGET_INSET_M
            : 0),
        y: candidate.position[1] + 1.05,
        z:
          candidate.position[2] -
          (distance > INTERACTION_TARGET_INSET_M
            ? (dz / distance) * INTERACTION_TARGET_INSET_M
            : 0),
      },
      candidate.losIgnoreIds
        ? new Set(candidate.losIgnoreIds)
        : undefined,
    )
  ) {
    return null;
  }
  const phase =
    distance <= candidate.radius + sticky
      ? "ACTION"
      : distance <= metadata.approachRadius + sticky
        ? "APPROACH"
        : "DISCOVERY";
  return { candidate, distance, facing, phase };
}

function resolve(input: {
  candidates: readonly InteractionCandidate[];
  player: InteractionPlayer;
  currentId: string | null;
  includeDiscovery: boolean;
  segmentClear: (
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
    ignore?: ReadonlySet<string>,
  ) => boolean;
}): ResolvedInteraction | null {
  const eligibleCandidates = input.candidates
    .map((candidate) =>
      eligible(
        candidate,
        input.player,
        input.currentId,
        input.includeDiscovery,
        input.segmentClear,
      ),
    )
    .filter((candidate): candidate is ResolvedInteraction =>
      Boolean(candidate),
    )
    .sort(
      (left, right) =>
        PHASE_PRIORITY[right.phase] - PHASE_PRIORITY[left.phase] ||
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

export function resolveInteraction(input: {
  candidates: readonly InteractionCandidate[];
  player: InteractionPlayer;
  currentId: string | null;
  segmentClear: (
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
    ignore?: ReadonlySet<string>,
  ) => boolean;
}): ResolvedInteraction | null {
  return resolve({ ...input, includeDiscovery: false });
}

export function resolveInteractionAffordance(input: {
  candidates: readonly InteractionCandidate[];
  player: InteractionPlayer;
  currentId: string | null;
  segmentClear: (
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
    ignore?: ReadonlySet<string>,
  ) => boolean;
}): ResolvedInteraction | null {
  return resolve({ ...input, includeDiscovery: true });
}
