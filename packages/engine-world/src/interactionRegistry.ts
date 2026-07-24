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
  | "PORTAL"
  | "INTERIOR_INSPECT"
  | "NPC"
  | "THREAD"
  | "SIDE_JOB"
  | "KNOWLEDGE"
  | "FLAVOR"
  | "CHASE_VERB";

export type InteractionVerb =
  | "Talk"
  | "Inspect"
  | "Read"
  | "Help"
  | "Deliver"
  | "Enter"
  | "Exit"
  | "Use"
  | "Climb"
  | "Cross"
  | "Take"
  | "Interact";

export type InteractionImportance = "AMBIENT" | "STANDARD" | "STORY";

export interface InteractionCandidate {
  id: string;
  sourceId: string;
  kind: InteractionKind;
  label: string;
  priority: InteractionPriority;
  spaceId: string;
  position: readonly [number, number, number];
  radius: number;
  /** Far, LOS-gated discoverability without quest-marker intensity. */
  discoveryRadius?: number;
  /** Named approach card range; always clamped between action/discovery. */
  approachRadius?: number;
  /** Player-facing noun, separate from the action verb. */
  displayName?: string;
  /** Consistent action class used at every presentation range. */
  verb?: InteractionVerb;
  /** Controls subtle emphasis only; never changes resolver priority. */
  importance?: InteractionImportance;
  facingDot: number;
  losRequired: boolean;
  /** Owning target surfaces may be ignored; intervening walls never are. */
  losIgnoreIds?: readonly string[];
  enabled: boolean;
  activate: () => boolean | Promise<boolean>;
}

export interface InteractionPresentationMetadata {
  discoveryRadius: number;
  approachRadius: number;
  displayName: string;
  verb: InteractionVerb;
  importance: InteractionImportance;
  category: string;
}

const DEFAULT_DISCOVERY_RADIUS: Record<InteractionKind, number> = {
  NPC: 11,
  THREAD: 10,
  SIDE_JOB: 9,
  KNOWLEDGE: 8,
  INTERIOR_INSPECT: 7,
  FLAVOR: 7,
  PORTAL: 5,
  TRAVERSAL: 3,
  CHASE_VERB: 3,
};

const CATEGORY: Record<InteractionKind, string> = {
  NPC: "Person",
  THREAD: "Thread",
  SIDE_JOB: "Work",
  KNOWLEDGE: "Source",
  INTERIOR_INSPECT: "Artifact",
  FLAVOR: "Detail",
  PORTAL: "Door",
  TRAVERSAL: "Route",
  CHASE_VERB: "Escape",
};

function inferredVerb(candidate: InteractionCandidate): InteractionVerb {
  if (candidate.verb) return candidate.verb;
  const label = candidate.label.toLowerCase();
  if (/^(talk|ask|hear|say)\b/.test(label)) return "Talk";
  if (/^(read|finish reading)\b/.test(label)) return "Read";
  if (/^(inspect|examine|compare)\b/.test(label)) return "Inspect";
  if (/^(help|lend|cover|fetch)\b/.test(label)) return "Help";
  if (/^(deliver|hand|set down|give)\b/.test(label)) return "Deliver";
  if (/^(enter|open)\b/.test(label)) return "Enter";
  if (/^(exit|step outside|leave)\b/.test(label)) return "Exit";
  if (/^(climb|vault|duck)\b/.test(label)) return "Climb";
  if (/^(cross|balance)\b/.test(label)) return "Cross";
  if (/^(take|lift|pick)\b/.test(label)) return "Take";
  return "Interact";
}

function inferredDisplayName(candidate: InteractionCandidate): string {
  if (candidate.displayName) return candidate.displayName;
  return (
    candidate.label
      .replace(
        /^(talk to|ask|read|finish reading|inspect|examine|compare|help|lend a hand to|deliver|hand over|hand|set down|give|enter|open|exit|step outside|leave|climb|vault|duck under|cross|balance and cross|take|lift|pick up)\s+/i,
        "",
      )
      .trim() || candidate.label
  );
}

export function interactionPresentationMetadata(
  candidate: InteractionCandidate,
): InteractionPresentationMetadata {
  const defaultDiscovery = DEFAULT_DISCOVERY_RADIUS[candidate.kind];
  const discoveryRadius = Math.max(
    candidate.radius,
    candidate.discoveryRadius ?? defaultDiscovery,
  );
  const approachRadius = Math.min(
    discoveryRadius,
    Math.max(
      candidate.radius,
      candidate.approachRadius ?? Math.max(4, candidate.radius + 1.5),
    ),
  );
  return {
    discoveryRadius,
    approachRadius,
    displayName: inferredDisplayName(candidate),
    verb: inferredVerb(candidate),
    importance: candidate.importance ?? "STANDARD",
    category: CATEGORY[candidate.kind],
  };
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
