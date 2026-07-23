export const INTERACTION_PRIORITIES = {
  FLAVOR: 100,
  KNOWLEDGE: 200,
  SIDE_JOB_THREAD: 300,
  STORY_NPC: 400,
  SAFETY_TRAVERSAL: 500,
  // Mid-chase context verbs (topple a stack, cut through the tavern) outrank
  // ordinary traversal while a pursuit is live — during a chase the one F
  // glyph must always be the escape verb, never a flavor read.
  CHASE_VERB: 550,
  BLOCKING_AUTHORED: 600,
} as const;

export type InteractionPriority =
  (typeof INTERACTION_PRIORITIES)[keyof typeof INTERACTION_PRIORITIES];

export type InteractionKind =
  | "TRAVERSAL"
  | "INTERIOR_INSPECT"
  | "NPC"
  | "THREAD"
  | "SIDE_JOB"
  | "KNOWLEDGE"
  | "FLAVOR"
  | "CHASE_VERB";

export interface InteractionCandidate {
  id: string;
  sourceId: string;
  kind: InteractionKind;
  label: string;
  priority: InteractionPriority;
  spaceId: string;
  position: readonly [number, number, number];
  radius: number;
  facingDot: number;
  losRequired: boolean;
  enabled: boolean;
  activate: () => boolean | Promise<boolean>;
}

export interface InteractionRegistry {
  upsert(candidate: InteractionCandidate): void;
  remove(id: string): void;
  clearSource(sourceId: string): void;
  clear(): void;
  list(): readonly InteractionCandidate[];
  get(id: string): InteractionCandidate | undefined;
  readonly size: number;
}

export function createInteractionRegistry(): InteractionRegistry {
  const candidates = new Map<string, InteractionCandidate>();
  return {
    upsert(candidate) {
      candidates.set(candidate.id, candidate);
    },
    remove(id) {
      candidates.delete(id);
    },
    clearSource(sourceId) {
      for (const [id, candidate] of candidates) {
        if (candidate.sourceId === sourceId) candidates.delete(id);
      }
    },
    clear() {
      candidates.clear();
    },
    list() {
      return [...candidates.values()];
    },
    get(id) {
      return candidates.get(id);
    },
    get size() {
      return candidates.size;
    },
  };
}
