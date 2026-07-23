import {
  HEAT_BANDS,
  MICRO_CONCEPT_IDS,
  OPTIONAL_ACTIVITY_IDS,
  standingDeltaForCause,
  type FieldDurableState,
  type ReactiveCompletionEffects,
} from "@pa/contracts";
import { npcFollowups } from "../../assessment/openResponseRegistry.js";

export interface RegisteredReactiveOutcome {
  sourceId: string;
  outcomeId: string;
  /**
   * Knowledge-as-ammunition gate: the outcome resolves only when this
   * micro-concept is durably engaged (runtime-authoritative — a presenter
   * offering the option without the flag is rejected at commit).
   */
  requiresMicroId?: (typeof MICRO_CONCEPT_IDS)[keyof typeof MICRO_CONCEPT_IDS];
  build: (
    field: FieldDurableState,
  ) => Omit<
    ReactiveCompletionEffects,
    "interactionId" | "sourceId" | "outcomeId"
  >;
}

function lowerHeat(field: FieldDurableState) {
  const index = HEAT_BANDS.indexOf(field.heat.band);
  return HEAT_BANDS[Math.max(0, index - 1)]!;
}

const NONE = () => ({});

export const REACTIVE_OUTCOME_REGISTRY: readonly RegisteredReactiveOutcome[] = [
  {
    sourceId: "NPC-abigail",
    outcomeId: "PRESS",
    build: () => ({
      micros: [MICRO_CONCEPT_IDS.PRINTERS_ROLE],
      relationships: [
        {
          relationshipId: "ABIGAIL_TRUST",
          delta: 4,
          causeId: "abigail-press-talk",
        },
      ],
    }),
  },
  {
    sourceId: "NPC-abigail",
    outcomeId: "VOUCH",
    build: (field) =>
      field.heat.history.some((record) => record.cause === "VOUCH")
        ? {}
        : {
            heat: { to: lowerHeat(field), cause: "VOUCH" },
            relationships: [
              {
                relationshipId: "ABIGAIL_TRUST",
                delta: 3,
                causeId: "abigail-vouch",
              },
            ],
          },
  },
  {
    sourceId: "NPC-thomas",
    outcomeId: "TRADE",
    build: () => ({
      micros: [
        MICRO_CONCEPT_IDS.NON_IMPORTATION,
        MICRO_CONCEPT_IDS.PORT_TOWN_BOSTON,
      ],
      relationships: [
        {
          relationshipId: "THOMAS_OBLIGATION",
          delta: 3,
          causeId: "thomas-trade-talk",
        },
      ],
    }),
  },
  {
    sourceId: "NPC-thomas",
    outcomeId: "ROUTE",
    build: () => ({ micros: [MICRO_CONCEPT_IDS.PORT_TOWN_BOSTON] }),
  },
  {
    sourceId: "NPC-thomas",
    outcomeId: "TAKE_NOTE",
    build: () => ({
      activities: [
        {
          activityId: OPTIONAL_ACTIVITY_IDS.TAVERN_NOTE,
          stage: "ACCEPTED",
          breadcrumb:
            "Thomas asked for a quiet hand-off inside the Bunch of Grapes.",
        },
      ],
      custody: [
        {
          objectId: "TAVERN_NOTE",
          custody: "PLAYER",
          condition: "INTACT",
          concealment: "HIDDEN",
        },
      ],
    }),
  },
  {
    sourceId: "NPC-pike",
    outcomeId: "COURTS",
    build: () => ({
      micros: [MICRO_CONCEPT_IDS.VICE_ADMIRALTY_COURTS],
      relationships: [
        {
          relationshipId: "PIKE_RESPECT",
          delta: 4,
          causeId: "pike-courts-talk",
        },
      ],
    }),
  },
  {
    sourceId: "NPC-pike",
    outcomeId: "COIN",
    build: () => ({ micros: [MICRO_CONCEPT_IDS.HARD_COIN_SCARCITY] }),
  },
  {
    sourceId: "NPC-clarke",
    outcomeId: "HEAR",
    build: () => ({
      micros: [MICRO_CONCEPT_IDS.LOYALIST_VIEW],
      relationships: [
        {
          relationshipId: "CLARKE_POLITICAL_READ",
          delta: 8,
          causeId: "clarke-heard-out",
        },
      ],
    }),
  },
  {
    // Knowledge as ammunition (design1 feature 2): a runner who has engaged
    // the non-importation compact can answer Clarke's pressure with the
    // merchants' own lawful defense instead of a reckless brush-off. Clarke
    // respects an informed opponent: no marking, no heat, a real read gain.
    sourceId: "NPC-clarke",
    outcomeId: "CITE_COMPACT",
    requiresMicroId: MICRO_CONCEPT_IDS.NON_IMPORTATION,
    build: () => ({
      micros: [MICRO_CONCEPT_IDS.NON_IMPORTATION],
      relationships: [
        {
          relationshipId: "CLARKE_POLITICAL_READ",
          delta: 5,
          causeId: "clarke-cited-compact",
        },
      ],
      rumors: [
        "Clarke repeats your words at his counter: the compact is lawful, whatever he thinks of it.",
      ],
    }),
  },
  {
    sourceId: "NPC-clarke",
    outcomeId: "CURT",
    build: (field) => ({
      standing: {
        delta: standingDeltaForCause("CLARKE_INFORMED"),
        causeId: "CLARKE_INFORMED",
      },
      identity: { clarkeMarked: true, reason: "clarke-informed" },
      heat: {
        to: field.heat.band === "CALM" ? "NOTICED" : field.heat.band,
        cause: "DETECTION",
      },
      relationships: [
        {
          relationshipId: "CLARKE_POLITICAL_READ",
          delta: -12,
          causeId: "clarke-curt",
        },
      ],
    }),
  },
  {
    sourceId: "NPC-rider",
    outcomeId: "NETWORK",
    build: () => ({
      micros: [MICRO_CONCEPT_IDS.NEWS_NETWORKS],
      relationships: [
        {
          relationshipId: "RIDER_TRUST",
          delta: 4,
          causeId: "rider-network-talk",
        },
      ],
    }),
  },
  ...["LATER", "BELL"].flatMap((outcomeId) =>
    ["NPC-abigail", "NPC-thomas", "NPC-pike", "NPC-clarke", "NPC-rider"].map(
      (sourceId) => ({ sourceId, outcomeId, build: NONE }),
    ),
  ),
  ...npcFollowups({ allowAuthorDraft: true }).flatMap((node) =>
    node.options.map((option) => ({
      sourceId: node.nodeId,
      outcomeId: option.optionId,
      build: NONE,
    })),
  ),
];

export function eligibleNpcFollowupsForField(
  field: FieldDurableState,
  npcId?: string,
) {
  const engaged = new Set(
    Object.values(field.sourceEngagements).map(
      (record) => record.sourcePacketId,
    ),
  );
  const completedSources = new Set(
    Object.values(field.reactiveCompletions).map(
      (record) => record.sourceId,
    ),
  );
  return npcFollowups({ allowAuthorDraft: true }).filter((node) => {
    if (npcId && node.npcId !== npcId) return false;
    if (completedSources.has(node.nodeId)) return false;
    if (
      !node.gate.completedSources.every((sourceId) =>
        engaged.has(sourceId),
      )
    ) {
      return false;
    }
    return (
      !("anyOf" in node.gate) ||
      node.gate.anyOf.some((sourceId) => engaged.has(sourceId))
    );
  });
}

export function resolveRegisteredReactiveOutcome(input: {
  field: FieldDurableState;
  interactionId: string;
  sourceId: string;
  outcomeId: string;
}): ReactiveCompletionEffects {
  const registered = REACTIVE_OUTCOME_REGISTRY.find(
    (entry) =>
      entry.sourceId === input.sourceId && entry.outcomeId === input.outcomeId,
  );
  if (!registered) {
    throw new Error(
      `FIELD_EVENT_INVALID: unregistered reactive outcome ${input.sourceId}/${input.outcomeId}`,
    );
  }
  if (
    registered.requiresMicroId &&
    !input.field.engagedMicroIds.includes(registered.requiresMicroId)
  ) {
    throw new Error(
      `FIELD_EVENT_INVALID: cited outcome ${input.sourceId}/${input.outcomeId} requires engaged ${registered.requiresMicroId}`,
    );
  }
  if (
    input.sourceId.startsWith("BOS.ACT01.DLG.") &&
    !eligibleNpcFollowupsForField(input.field).some(
      (node) => node.nodeId === input.sourceId,
    )
  ) {
    throw new Error(
      `FIELD_EVENT_INVALID: gated reactive node ${input.sourceId} is not eligible`,
    );
  }
  return {
    interactionId: input.interactionId,
    sourceId: input.sourceId,
    outcomeId: input.outcomeId,
    ...registered.build(input.field),
  };
}

