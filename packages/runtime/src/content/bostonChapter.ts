import {
  CHAPTER_ID,
  CITED_CONFRONTATION_DEFENSES,
  CONCEPTS,
  CONCEPT_META,
  CONCEPT_TEKS,
  FIELD_REPOSITION_ANCHORS,
  MICRO_CONCEPT_IDS,
  OPTIONAL_ACTIVITY_IDS,
  PACKAGE_ID,
  SYNC_RULES,
  THREAD_IDS,
  THREAD_STABLE_FLAGS,
  type MicroConceptId,
  type OptionalActivityId,
  type OptionalActivityState,
  type ThreadId,
  type ThreadState,
} from "@pa/contracts";
import type { ChapterDefinition } from "../engine/chapter.js";
import { day1Flow } from "./day1/flow.js";
import { TEXT } from "./day1/text.js";
import { LORE_MACRO_SUPPORT } from "./day1/tables.js";
import {
  eligibleNpcFollowupsForField,
  resolveRegisteredReactiveOutcome,
} from "./day1/reactive.js";
import { createBostonWorldState } from "./bostonWorld.js";
import { canonicalSourceIds } from "./provenance.js";
import {
  CP1_ASSESSMENT_TO_LEARNER,
  CP1_CHECKPOINT_ID,
  CP1_FORM_ID_PREFIX,
  CP1_MICRO_SOURCE_LABELS,
  CP1_REQUIRED_MACROS,
} from "./checkpoints/cp1Ids.js";
import {
  CP1_BANK_REGISTRY,
  CP1_DEVELOPMENT_FIXTURE_BANK,
  CP1_PRODUCTION_BANK,
} from "./checkpoints/cp1Bank.js";
import {
  ACT1_OPEN_RESPONSE_PACKAGE_HASH,
  eligibleArchiveConnections,
  eligibleOpenResponses,
  npcFollowups,
  openResponsePackage,
  sourcePacket,
} from "../assessment/openResponseRegistry.js";

// ============================================================================
// The Boston 1765 ChapterDefinition: the complete content injection for the
// generic engine. Everything Boston lives behind this object.
// ============================================================================

// Boston chapter flow version (protocol: saves with a different flowVersion
// restart rather than replay across changed beat sequences).
export const BOSTON_DAY1_FLOW_VERSION = 7;

const MICRO_LABELS: Readonly<Record<MicroConceptId, string>> = {
  [MICRO_CONCEPT_IDS.SALUTARY_NEGLECT_END]: "The end of salutary neglect",
  [MICRO_CONCEPT_IDS.PORT_TOWN_BOSTON]: "Boston as a port town",
  [MICRO_CONCEPT_IDS.HARD_COIN_SCARCITY]: "Hard-coin scarcity",
  [MICRO_CONCEPT_IDS.PRINTERS_ROLE]: "Printers' role",
  [MICRO_CONCEPT_IDS.VICE_ADMIRALTY_COURTS]: "Vice-admiralty courts",
  [MICRO_CONCEPT_IDS.STAMP_WHAT_COUNTS]: "What the stamp covers",
  [MICRO_CONCEPT_IDS.ANDREW_OLIVER]: "Andrew Oliver",
  [MICRO_CONCEPT_IDS.LIBERTY_TREE]: "The Liberty Tree",
  [MICRO_CONCEPT_IDS.LOYAL_NINE]: "The Loyal Nine",
  [MICRO_CONCEPT_IDS.EFFIGY_PROTEST]: "Effigy protest",
  [MICRO_CONCEPT_IDS.NON_IMPORTATION]: "Non-importation",
  [MICRO_CONCEPT_IDS.NEWS_NETWORKS]: "News networks",
  [MICRO_CONCEPT_IDS.WRITS_OF_ASSISTANCE]: "Writs of assistance",
  [MICRO_CONCEPT_IDS.LOYALIST_VIEW]: "The Loyalist view",
};

function initialBostonThreads(): Record<ThreadId, ThreadState> {
  return {
    [THREAD_IDS.NED]: {
      threadId: THREAD_IDS.NED,
      flags: {},
      status: "UNMET",
      trust: 0,
      breadcrumb: null,
    },
    [THREAD_IDS.SARAH]: {
      threadId: THREAD_IDS.SARAH,
      flags: {},
      status: "UNMET",
      trust: 0,
      breadcrumb: null,
    },
  };
}

function initialBostonActivities(): Record<OptionalActivityId, OptionalActivityState> {
  const mk = (
    activityId: OptionalActivityId,
    stage: OptionalActivityState["stage"],
  ): OptionalActivityState => ({ activityId, stage, breadcrumb: null });
  return {
    [OPTIONAL_ACTIVITY_IDS.TAVERN_NOTE]: mk(OPTIONAL_ACTIVITY_IDS.TAVERN_NOTE, "AVAILABLE"),
    [OPTIONAL_ACTIVITY_IDS.DOCK_HAUL]: mk(OPTIONAL_ACTIVITY_IDS.DOCK_HAUL, "AVAILABLE"),
    [OPTIONAL_ACTIVITY_IDS.ROOF_KID]: mk(OPTIONAL_ACTIVITY_IDS.ROOF_KID, "AVAILABLE"),
    [OPTIONAL_ACTIVITY_IDS.CRIER]: mk(OPTIONAL_ACTIVITY_IDS.CRIER, "AVAILABLE"),
    [OPTIONAL_ACTIVITY_IDS.ROPEWALK]: mk(OPTIONAL_ACTIVITY_IDS.ROPEWALK, "AVAILABLE"),
    [OPTIONAL_ACTIVITY_IDS.AGITATOR_DARE]: mk(OPTIONAL_ACTIVITY_IDS.AGITATOR_DARE, "AVAILABLE"),
    // The rooftop run stays dormant until the roof-kid chain opens it.
    [OPTIONAL_ACTIVITY_IDS.ROOFTOP_RUN]: mk(OPTIONAL_ACTIVITY_IDS.ROOFTOP_RUN, "DORMANT"),
    [OPTIONAL_ACTIVITY_IDS.LOSE_WATCH]: mk(OPTIONAL_ACTIVITY_IDS.LOSE_WATCH, "AVAILABLE"),
  };
}

export const BOSTON_1765_CHAPTER: ChapterDefinition = {
  chapterId: CHAPTER_ID,
  packageId: PACKAGE_ID,
  flowVersion: BOSTON_DAY1_FLOW_VERSION,
  createFlow: day1Flow,
  content: {
    createInitialWorldState: createBostonWorldState,
    learnerConceptIds: [
      CONCEPTS.POSTWAR_REVENUE,
      CONCEPTS.STAMP_SCOPE,
      CONCEPTS.REPRESENTATION,
    ],
    conceptShortNames: {
      [CONCEPTS.POSTWAR_REVENUE]: "Postwar revenue",
      [CONCEPTS.STAMP_SCOPE]: "Stamp Act",
      [CONCEPTS.REPRESENTATION]: "Representation",
    },
    minimumInteractionsBetweenSyncs: SYNC_RULES.minimumInteractionsBetweenSyncs,
    defaultHeadline: "TAXED WITHOUT A VOICE",
    clockWarningLines: TEXT.clockWarnings,
    loreMacroSupport: LORE_MACRO_SUPPORT,
    reactiveOutcomeResolver: resolveRegisteredReactiveOutcome,
    authorDraftSourcePrefix: "BOS.ACT01.DLG.",
    cues: {
      continueCue: (label) => `BOS.MD01.CUE.CONTINUE.${label ?? "DEFAULT"}.v1`,
      ackCue: () => "BOS.MD01.CUE.ACK.v1",
      dayEndCue: () => "BOS.MD01.CUE.DAY_END.v1",
      readCue: (objectId) => `BOS.MD01.CUE.READ.${objectId}.v1`,
      roamCue: (targetIds) => `BOS.MD01.CUE.ROAM.${targetIds.join("_")}.v1`,
    },
    openResponse: {
      eligible: (input) => eligibleOpenResponses(input),
      package: (identifier, access) =>
        openResponsePackage(
          identifier,
          access ?? { allowAuthorDraft: true },
        ),
      npcFollowups: (access) => npcFollowups(access),
      eligibleNpcFollowupsForField: (field) =>
        eligibleNpcFollowupsForField(field),
      archiveConnections: (input) => eligibleArchiveConnections(input),
      sourcePacketBackingRefs: (sourcePacketId) =>
        sourcePacket(sourcePacketId)?.backingRefs ?? [],
    },
    canonicalSourceIds,
  },
  assessment: {
    checkpoint: {
      checkpointId: CP1_CHECKPOINT_ID,
      requiredMacroConceptIds: CP1_REQUIRED_MACROS,
      microConceptIds: Object.values(MICRO_CONCEPT_IDS),
      formIdPrefix: CP1_FORM_ID_PREFIX,
    },
    banks: CP1_BANK_REGISTRY,
    productionBankVersion: CP1_PRODUCTION_BANK.bankVersion,
    qaDraftBankVersion: CP1_DEVELOPMENT_FIXTURE_BANK.bankVersion,
    gateMaps: {
      assessmentToLearner: CP1_ASSESSMENT_TO_LEARNER,
      microSourceLabels: CP1_MICRO_SOURCE_LABELS,
    },
    legacyRubricIds: [
      "BOS.ACT01.RUBRIC.COMPARE_ECONOMIC_EVIDENCE.v1",
      "BOS.ACT01.RUBRIC.NEWS_STRATEGY.v1",
    ],
  },
  fieldVocabulary: {
    microConceptIds: Object.values(MICRO_CONCEPT_IDS),
    threadIds: Object.values(THREAD_IDS),
    threadFlags: THREAD_STABLE_FLAGS,
    activityIds: Object.values(OPTIONAL_ACTIVITY_IDS),
    initialThreads: initialBostonThreads,
    initialActivities: initialBostonActivities,
    repositionAnchors: FIELD_REPOSITION_ANCHORS,
    citedDefenses: CITED_CONFRONTATION_DEFENSES,
    confrontationMicro: {
      microConceptId: MICRO_CONCEPT_IDS.WRITS_OF_ASSISTANCE,
      confrontationRecordPrefix: "WRITS_",
      chaseRecordPrefix: "WRITS_CHASE_",
    },
    sourceEngagement: {
      canonicalSourceIds,
      contentPackageHash: ACT1_OPEN_RESPONSE_PACKAGE_HASH,
    },
  },
  report: {
    conceptNames: {
      [CONCEPTS.POSTWAR_REVENUE]: "Postwar revenue policy",
      [CONCEPTS.STAMP_SCOPE]: "Stamp Act",
      [CONCEPTS.REPRESENTATION]: "Representation",
    },
    conceptTeks: CONCEPT_TEKS,
    conceptMeta: CONCEPT_META,
    microLabels: MICRO_LABELS,
  },
};
