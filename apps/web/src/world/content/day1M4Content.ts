// ---------------------------------------------------------------------------
// Day-1 M4 content (chapter data), extracted verbatim from M4ContentDirector
// in refactor wave 2 stage B. Authored copy is byte-identical; every source id
// registers explicitly in the exchange source registry (the SJ-/CH-/INFO-/
// knowledge prefix-exclusion routing dies with the old director).
//
// Owners registered here:
//   KNOWLEDGE    KN-* poster/sign/prop reads (from the M4 knowledge manifest)
//   SIDE_JOB     SJ-roof-kid-* / SJ-crier-*
//   CHALLENGE    CH-agitator-dare-* / CH-rooftop-run-* / CH-lose-watch-*
//   INFO_FIGURE  INFO-tavern-keeper / INFO-dockhand / INFO-goodwife
//   FLAVOR       FLV-dog / FLV-gulls (ambient verbs; never field interrupts)
// ---------------------------------------------------------------------------

import type { MicroConceptId, OptionalActivityId, RuntimeView } from "@pa/contracts";
import { MICRO_CONCEPT_IDS, OPTIONAL_ACTIVITY_IDS, standingDeltaForCause } from "@pa/chapter-boston";
import { INTERACTION_PRIORITIES } from "../interactionRegistry.js";
import type {
  InteractionKind,
  InteractionPriority,
} from "../interactionRegistry.js";
import { interiorPoint } from "../interiorManifest.js";
import {
  M4_ACTIVITY_ANCHORS,
  M4_FLAVOR,
  M4_KNOWLEDGE,
  type KnowledgePlacement,
} from "../m4ContentManifest.js";
import {
  registerExchangeSourcePackage,
  type Exchange,
  type ExchangeChoiceEffects,
  type ExchangeEngineProfile,
  type ExchangeSource,
} from "../exchange/exchangeSources.js";

// Legacy M4ContentDirector engine constants: M4_ interrupt ids, per-prompt
// begin clip (default "search"), panel z-band [25,10], the explicit ESC
// "Step away" button, and authored effects riding FIELD_REACTIVE_COMPLETED.
function m4Profile(clip?: string): ExchangeEngineProfile {
  return {
    interruptIdPrefix: "M4",
    completionEvent: "FIELD_REACTIVE_COMPLETED",
    beginClip: clip ?? "search",
    panelZRange: [25, 10],
    dismissButton: true,
  };
}

// Single-action content prompt -> unified exchange: the prompt body doubles
// as the reply (the legacy panel kept the text visible through the dwell).
interface ContentPrompt {
  sourceId: string;
  title: string;
  text: string;
  action: string;
  position: readonly [number, number, number];
  effects: ExchangeChoiceEffects;
  outcomeId: string;
  clip?: string;
  afterCommit?: Exchange["choices"][number]["afterCommit"];
}

function m4Exchange(prompt: ContentPrompt): Exchange {
  return {
    sourceId: prompt.sourceId,
    title: prompt.title,
    line: prompt.text,
    position: prompt.position,
    choices: [
      {
        id: prompt.outcomeId,
        label: prompt.action,
        reply: prompt.text,
        effects: prompt.effects,
        afterCommit: prompt.afterCommit,
      },
    ],
    engine: m4Profile(prompt.clip),
  };
}

export function knowledgeWorldPosition(
  placement: KnowledgePlacement,
): readonly [number, number, number] {
  return placement.spaceId === "EXTERIOR"
    ? placement.position
    : interiorPoint(placement.spaceId, [...placement.position]);
}

function knowledgePrompt(placement: KnowledgePlacement): ContentPrompt {
  return {
    sourceId: placement.id,
    title: placement.title,
    text: placement.body,
    action: "Finish reading",
    position: knowledgeWorldPosition(placement),
    outcomeId: "READ",
    effects: { micros: [...placement.micros] },
  };
}

function activityAnchor(
  activityId: OptionalActivityId,
  index: number,
): readonly [number, number, number] {
  return M4_ACTIVITY_ANCHORS[activityId]?.[index] ?? [0, -20, 0];
}

// ---------------------------------------------------------------------------
// Optional activities + challenges (copy ported byte-identically)
// ---------------------------------------------------------------------------

const M4_ACTIVITY_PROMPTS: Record<
  string,
  (view: RuntimeView) => ContentPrompt | null
> = {
  "SJ-roof-kid-offer": () => ({
    sourceId: "SJ-roof-kid-offer",
    title: "A worried goodwife",
    text: "My Jonah is on the painters' scaffold again. Fetch him down before he breaks his neck.",
    action: "Take the roof-kid job",
    position: activityAnchor(OPTIONAL_ACTIVITY_IDS.ROOF_KID, 0),
    outcomeId: "ACCEPT",
    clip: "talk",
    effects: {
      activities: [{ activityId: OPTIONAL_ACTIVITY_IDS.ROOF_KID, stage: "ACCEPTED", breadcrumb: "Climb the central scaffold and speak to Jonah." }],
    },
  }),
  "SJ-roof-kid-reached": () => ({
    sourceId: "SJ-roof-kid-reached",
    title: "Jonah on the scaffold",
    text: "I can see the whole harbor! All right—I'll take the ladder when you turn around.",
    action: "Shoo Jonah toward the ladder",
    position: activityAnchor(OPTIONAL_ACTIVITY_IDS.ROOF_KID, 1),
    outcomeId: "COMPLETED",
    clip: "talk",
    effects: {
      activities: [
        { activityId: OPTIONAL_ACTIVITY_IDS.ROOF_KID, stage: "COMPLETED", breadcrumb: "Jonah came down safely." },
        { activityId: OPTIONAL_ACTIVITY_IDS.ROOFTOP_RUN, stage: "AVAILABLE", breadcrumb: "The scaffold now marks a short roof-board challenge." },
      ],
      standing: { delta: standingDeltaForCause("ROOF_KID_COMPLETED"), causeId: "ROOF_KID_COMPLETED" },
      rumors: ["Jonah's harbor perch reveals the short scaffold and Liberty roof-board route."],
    },
  }),
  "SJ-crier-offer": () => ({
    sourceId: "SJ-crier-offer",
    title: "Town crier",
    text: "My voice is gone. Take up the cry at three street corners; the subtitles carry the words until a voiced pass is approved.",
    action: "Take up the cry",
    position: activityAnchor(OPTIONAL_ACTIVITY_IDS.CRIER, 0),
    outcomeId: "ACCEPT",
    clip: "talk",
    effects: {
      activities: [{ activityId: OPTIONAL_ACTIVITY_IDS.CRIER, stage: "ACCEPTED", breadcrumb: "Call the meeting at the west, center, and east street spots." }],
    },
  }),
  ...Object.fromEntries(
    ([1, 2, 3] as const).map((stageIndex) => [
      `SJ-crier-call-${stageIndex}`,
      (): ContentPrompt => {
        const nextStage =
          stageIndex === 1 ? "CARRYING" : stageIndex === 2 ? "BALANCING" : "COMPLETED";
        return {
          sourceId: `SJ-crier-call-${stageIndex}`,
          title: `Take up the cry // ${stageIndex} of 3`,
          text:
            stageIndex === 1
              ? "HEAR YE: THE TOWN MEETING IS CALLED."
              : stageIndex === 2
                ? "NEWS FROM THE BOARD—THE MEETING IS TONIGHT."
                : "PASS THE WORD: BOSTON MEETS BEFORE THE BELL.",
          action: "Call with attributed subtitles",
          position: activityAnchor(OPTIONAL_ACTIVITY_IDS.CRIER, stageIndex),
          outcomeId: `CALL_${stageIndex}`,
          clip: "argu1",
          effects: {
            activities: [{ activityId: OPTIONAL_ACTIVITY_IDS.CRIER, stage: nextStage, breadcrumb: nextStage === "COMPLETED" ? "The full cry reached the street." : `Continue to call spot ${stageIndex + 1}.` }],
            ...(nextStage === "COMPLETED"
              ? {
                  micros: [MICRO_CONCEPT_IDS.NEWS_NETWORKS],
                  standing: { delta: standingDeltaForCause("CRIER_COMPLETED"), causeId: "CRIER_COMPLETED" as const },
                  rumors: ["The crier's route confirms how spoken and printed news reinforce one another."],
                }
              : {}),
          },
        };
      },
    ]),
  ),
  "CH-agitator-dare-offer": () => ({
    sourceId: "CH-agitator-dare-offer",
    title: "Agitator's dare",
    text: "Take this wrapped bundle past the two Custom House constables. The job is optional; getting checked changes the outcome, never the day's learning.",
    action: "Accept the watched crossing",
    position: activityAnchor(OPTIONAL_ACTIVITY_IDS.AGITATOR_DARE, 0),
    outcomeId: "ACCEPT",
    clip: "talk",
    effects: {
      activities: [{ activityId: OPTIONAL_ACTIVITY_IDS.AGITATOR_DARE, stage: "ACCEPTED", breadcrumb: "Carry the wrapped bundle to the contact beside the Custom House." }],
    },
  }),
  "CH-agitator-dare-drop": (view) => {
    const clean =
      view.field.heat.band === "CALM" || view.field.heat.band === "NOTICED";
    return {
      sourceId: "CH-agitator-dare-drop",
      title: "Custom House contact",
      text: clean
        ? "Clean crossing. The watch never laid a hand on it."
        : "They marked the route, but the message still arrives. Next time, read the gaps.",
      action: "Hand over the bundle",
      position: activityAnchor(OPTIONAL_ACTIVITY_IDS.AGITATOR_DARE, 1),
      outcomeId: clean ? "CLEAN" : "SEEN",
      clip: "handoff",
      effects: {
        activities: [{ activityId: OPTIONAL_ACTIVITY_IDS.AGITATOR_DARE, stage: "COMPLETED", breadcrumb: clean ? "The dare crossed unseen." : "The dare landed with watch attention." }],
        micros: [MICRO_CONCEPT_IDS.LOYAL_NINE, MICRO_CONCEPT_IDS.EFFIGY_PROTEST],
        ...(clean
          ? { standing: { delta: standingDeltaForCause("AGITATOR_DARE_COMPLETED"), causeId: "AGITATOR_DARE_COMPLETED" as const } }
          : {}),
        rumors: ["The Custom House contact points toward the short Liberty roof-board perch."],
      },
    };
  },
  "CH-rooftop-run-start": () => ({
    sourceId: "CH-rooftop-run-start",
    title: "Short roof-board run",
    text: "Use the scaffold board and the Liberty perch. This is a bounded two-vantage challenge, not a continuous citywide roof course.",
    action: "Start the short roof run",
    position: activityAnchor(OPTIONAL_ACTIVITY_IDS.ROOFTOP_RUN, 0),
    outcomeId: "START",
    effects: {
      activities: [{ activityId: OPTIONAL_ACTIVITY_IDS.ROOFTOP_RUN, stage: "ACCEPTED", breadcrumb: "Reach the imported Liberty roof board and stay above street level." }],
    },
  }),
  "CH-rooftop-run-goal": () => ({
    sourceId: "CH-rooftop-run-goal",
    title: "Liberty roof perch",
    text: "The short route is complete. The event pocket and harbor approaches are visible from here.",
    action: "Claim the vantage",
    position: activityAnchor(OPTIONAL_ACTIVITY_IDS.ROOFTOP_RUN, 1),
    outcomeId: "COMPLETED",
    effects: {
      activities: [{ activityId: OPTIONAL_ACTIVITY_IDS.ROOFTOP_RUN, stage: "COMPLETED", breadcrumb: "The short scaffold-to-Liberty vantage challenge is complete." }],
      standing: { delta: standingDeltaForCause("ROOFTOP_RUN_COMPLETED"), causeId: "ROOFTOP_RUN_COMPLETED" },
    },
  }),
  "CH-lose-watch-start": (view) => ({
    sourceId: "CH-lose-watch-start",
    title: "Lose the watch",
    text: "Draw the central patrol, choose Run, then break sight and hold the gap. The same chase rules and real heat consequences apply.",
    action: "Provoke the patrol",
    position: activityAnchor(OPTIONAL_ACTIVITY_IDS.LOSE_WATCH, 0),
    outcomeId: "PROVOKE",
    clip: "argu1",
    effects: {
      activities: [{ activityId: OPTIONAL_ACTIVITY_IDS.LOSE_WATCH, stage: "ACCEPTED", breadcrumb: "Choose Run when the patrol challenges you, then shake the chase." }],
    },
    afterCommit: async (ctx) => {
      const serial = ctx.view.field.confrontationHistory.length + 1;
      await ctx.submitFieldEvent({
        type: "FIELD_WATCHER_CHALLENGE",
        eventId: `M4_LOSE_WATCH_CHALLENGE_${serial}`,
        interruptId: `M4_LOSE_WATCH_INT_${serial}`,
        challengeId: `M4_LOSE_WATCH_${serial}`,
        watcherId: "WATCH-patrol",
        reason: "SUSPICION",
      });
    },
  }),
  // The dare settles on ANY resolution of the provoked confrontation —
  // running (chase outcome) or backing down (comply/talk). Without the
  // confrontation branch the activity wedges ACCEPTED forever.
  "CH-lose-watch-result": (view) => {
    const chase = view.field.chaseHistory.at(-1);
    if (!chase?.outcome) return null;
    const escaped = chase.outcome === "ESCAPED" || chase.outcome === "REFUGE";
    return {
      sourceId: "CH-lose-watch-result",
      title: escaped ? "Watch shaken" : "Dare settled",
      text: escaped
        ? "You broke the patrol's sightline and held the gap."
        : "The watch caught you. The dare ends, and the heat remains real.",
      action: "Close the dare",
      position: activityAnchor(OPTIONAL_ACTIVITY_IDS.LOSE_WATCH, 0),
      outcomeId: chase.outcome,
      effects: {
        activities: [{ activityId: OPTIONAL_ACTIVITY_IDS.LOSE_WATCH, stage: "COMPLETED", breadcrumb: escaped ? "You lost the watch cleanly." : "The watch caught the dare." }],
        micros: [MICRO_CONCEPT_IDS.WRITS_OF_ASSISTANCE],
        ...(escaped
          ? { standing: { delta: standingDeltaForCause("LOSE_WATCH_COMPLETED"), causeId: "LOSE_WATCH_COMPLETED" as const } }
          : {}),
      },
    };
  },
  "CH-lose-watch-backdown": (view) => {
    const confrontation = view.field.confrontationHistory.at(-1);
    if (!confrontation?.outcome) return null;
    return {
      sourceId: "CH-lose-watch-backdown",
      title: "Dare declined",
      text: "You stood for the patrol instead of running. The dare ends quietly — the searches were still real.",
      action: "Close the dare",
      position: activityAnchor(OPTIONAL_ACTIVITY_IDS.LOSE_WATCH, 0),
      outcomeId: "BACKED_DOWN",
      effects: {
        activities: [{ activityId: OPTIONAL_ACTIVITY_IDS.LOSE_WATCH, stage: "COMPLETED", breadcrumb: "You faced the patrol rather than run the dare." }],
        micros: [MICRO_CONCEPT_IDS.WRITS_OF_ASSISTANCE],
      },
    };
  },
};

// Stage -> offered source id, ported from the legacy activityPrompt stage
// switches (the offer side keeps the stage gating; per-id resume does not).
function activityOfferSourceId(
  view: RuntimeView,
  activityId: OptionalActivityId,
): string | null {
  const activity = view.field.activities[activityId];
  if (!activity) return null;
  if (activityId === OPTIONAL_ACTIVITY_IDS.ROOF_KID) {
    if (activity.stage === "AVAILABLE" || activity.stage === "DORMANT") return "SJ-roof-kid-offer";
    if (activity.stage === "ACCEPTED") return "SJ-roof-kid-reached";
    return null;
  }
  if (activityId === OPTIONAL_ACTIVITY_IDS.CRIER) {
    if (activity.stage === "AVAILABLE" || activity.stage === "DORMANT") return "SJ-crier-offer";
    if (activity.stage === "ACCEPTED") return "SJ-crier-call-1";
    if (activity.stage === "CARRYING") return "SJ-crier-call-2";
    if (activity.stage === "BALANCING") return "SJ-crier-call-3";
    return null;
  }
  if (activityId === OPTIONAL_ACTIVITY_IDS.AGITATOR_DARE) {
    if (activity.stage === "AVAILABLE" || activity.stage === "DORMANT") return "CH-agitator-dare-offer";
    if (activity.stage === "ACCEPTED") return "CH-agitator-dare-drop";
    return null;
  }
  if (activityId === OPTIONAL_ACTIVITY_IDS.ROOFTOP_RUN) {
    if (activity.stage === "AVAILABLE") return "CH-rooftop-run-start";
    if (activity.stage === "ACCEPTED") return "CH-rooftop-run-goal";
    return null;
  }
  if (activityId === OPTIONAL_ACTIVITY_IDS.LOSE_WATCH) {
    if (activity.stage === "AVAILABLE" || activity.stage === "DORMANT") return "CH-lose-watch-start";
    if (activity.stage === "ACCEPTED") {
      if (view.field.chaseHistory.at(-1)?.outcome) return "CH-lose-watch-result";
      if (view.field.confrontationHistory.at(-1)?.outcome) return "CH-lose-watch-backdown";
      return null;
    }
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Info figures (rumor NPCs) — content and offer gating ported verbatim
// ---------------------------------------------------------------------------

interface InfoFigureDefinition {
  id: string;
  title: string;
  text: string;
  spaceId: string;
  position: readonly [number, number, number];
  micros: readonly MicroConceptId[];
  offered: (view: RuntimeView) => boolean;
}

const tavernDone = (view: RuntimeView) =>
  view.field.activities[OPTIONAL_ACTIVITY_IDS.TAVERN_NOTE]!.stage === "COMPLETED";
const dockDone = (view: RuntimeView) =>
  view.field.activities[OPTIONAL_ACTIVITY_IDS.DOCK_HAUL]!.stage === "COMPLETED";

export const M4_INFO_FIGURES: readonly InfoFigureDefinition[] = [
  {
    id: "INFO-tavern-keeper",
    title: "Keeper's rumors",
    text: "The Loyal Nine use taverns, printers, and trusted runners to move word without an official network.",
    spaceId: "EXPLORE_tavern",
    position: interiorPoint("EXPLORE_tavern", [-5.2, 0, 1]),
    micros: [MICRO_CONCEPT_IDS.LOYAL_NINE, MICRO_CONCEPT_IDS.NEWS_NETWORKS],
    offered: tavernDone,
  },
  {
    id: "INFO-dockhand",
    title: "Dock rumors",
    text: "Idle hulls mean idle wages. The harbor feels every customs delay first.",
    spaceId: "EXTERIOR",
    position: [-134, 0, 3],
    micros: [MICRO_CONCEPT_IDS.PORT_TOWN_BOSTON],
    offered: dockDone,
  },
  {
    id: "INFO-goodwife",
    title: "A goodwife's word",
    text: "Find Sarah at the market. Refusing English goods sounds noble until a widow's stall pays the price.",
    spaceId: "EXTERIOR",
    position: [-28, 0, 9.2],
    micros: [MICRO_CONCEPT_IDS.NON_IMPORTATION],
    offered: () => true,
  },
] as const;

function infoPrompt(figure: InfoFigureDefinition): ContentPrompt {
  return {
    sourceId: figure.id,
    title: figure.title,
    text: figure.text,
    action: "Thank them",
    position: figure.position,
    outcomeId: "HEARD",
    clip: "talk",
    effects: { micros: [...figure.micros] },
  };
}

// ---------------------------------------------------------------------------
// Flavor verbs (ambient; no field interrupts) + the pa:flavor echo content
// ---------------------------------------------------------------------------

export interface FlavorVerbDefinition {
  id: string;
  label: string;
  position: readonly [number, number, number];
  radius: number;
  audio: string;
  /** detail id dispatched on window "pa:flavor" for world reactions. */
  eventId: string;
  notice: { id: string; text: string };
}

export const M4_FLAVOR_VERBS: readonly FlavorVerbDefinition[] = [
  {
    id: M4_FLAVOR.DOG.id,
    label: "Pet the dog",
    position: M4_FLAVOR.DOG.position,
    radius: 2.9,
    audio: "/audio/dog-bark.wav",
    eventId: "DOG_BARK",
    notice: {
      id: "flavor:dog",
      text: "The street dog stays put, leans into your hand, and barks once.",
    },
  },
  {
    id: M4_FLAVOR.GULLS.id,
    label: "Spook the gulls",
    position: M4_FLAVOR.GULLS.position,
    radius: 2.4,
    audio: "/audio/gull-cry.wav",
    eventId: "GULLS_SPOOKED",
    notice: {
      id: "flavor:gulls",
      text: "The gulls startle from the wharf with a burst of cries.",
    },
  },
] as const;

/** World flavor echoes triggered by gameplay systems via "pa:flavor". */
export const M4_FLAVOR_ECHOES: Readonly<
  Record<string, { audio: string | null; text: string }>
> = {
  CHURCH_BELL: {
    audio: "/audio/church-bell.wav",
    text: "The meeting-house bell answers across the street.",
  },
  PUMP_SPLASH: {
    audio: "/audio/harbor-lap.wav",
    text: "The pump handle knocks; water splashes into the basin.",
  },
  BENCH_SIT: {
    audio: null,
    text: "You sit outside the tavern and let the street pass.",
  },
};

// ---------------------------------------------------------------------------
// Source registration (exact ids)
// ---------------------------------------------------------------------------

const KNOWLEDGE_SOURCES: ExchangeSource[] = M4_KNOWLEDGE.map((placement) => ({
  sourceId: placement.id,
  owner: "KNOWLEDGE",
  kind: "EXCHANGE",
  resolve: () => m4Exchange(knowledgePrompt(placement)),
}));

// Explicit owner per activity source (no prefix derivation anywhere).
const ACTIVITY_OWNERS: Record<string, "SIDE_JOB" | "CHALLENGE"> = {
  "SJ-roof-kid-offer": "SIDE_JOB",
  "SJ-roof-kid-reached": "SIDE_JOB",
  "SJ-crier-offer": "SIDE_JOB",
  "SJ-crier-call-1": "SIDE_JOB",
  "SJ-crier-call-2": "SIDE_JOB",
  "SJ-crier-call-3": "SIDE_JOB",
  "CH-agitator-dare-offer": "CHALLENGE",
  "CH-agitator-dare-drop": "CHALLENGE",
  "CH-rooftop-run-start": "CHALLENGE",
  "CH-rooftop-run-goal": "CHALLENGE",
  "CH-lose-watch-start": "CHALLENGE",
  "CH-lose-watch-result": "CHALLENGE",
  "CH-lose-watch-backdown": "CHALLENGE",
};

const ACTIVITY_SOURCES: ExchangeSource[] = Object.entries(
  M4_ACTIVITY_PROMPTS,
).map(([sourceId, build]) => {
  const owner = ACTIVITY_OWNERS[sourceId];
  if (!owner) {
    throw new Error(`activity source ${sourceId} has no declared owner`);
  }
  return {
    sourceId,
    owner,
    kind: "EXCHANGE",
    resolve: (view) => {
      const prompt = build(view);
      return prompt ? m4Exchange(prompt) : null;
    },
  };
});

const INFO_SOURCES: ExchangeSource[] = M4_INFO_FIGURES.map((figure) => ({
  sourceId: figure.id,
  owner: "INFO_FIGURE",
  kind: "EXCHANGE",
  resolve: () => m4Exchange(infoPrompt(figure)),
}));

const FLAVOR_SOURCES: ExchangeSource[] = M4_FLAVOR_VERBS.map((verb) => ({
  sourceId: verb.id,
  owner: "FLAVOR",
  kind: "AMBIENT",
  resolve: () => null,
}));

registerExchangeSourcePackage("day1-m4-content", {
  sources: [
    ...KNOWLEDGE_SOURCES,
    ...ACTIVITY_SOURCES,
    ...INFO_SOURCES,
    ...FLAVOR_SOURCES,
  ],
  families: [],
});

// ---------------------------------------------------------------------------
// Interaction candidates (data consumed by the director's M4 frame loop;
// gating and parameters ported verbatim from the legacy useFrame)
// ---------------------------------------------------------------------------

export interface M4CandidateFrame {
  id: string;
  kind: InteractionKind;
  label: string;
  priority: InteractionPriority;
  spaceId: string;
  position: readonly [number, number, number];
  radius: number;
  facingDot: number;
  losRequired: boolean;
  /** Offer availability (exchangesEnabled); flavor verbs stay always-on. */
  enabledWithOffers: boolean;
  activate:
    | { kind: "EXCHANGE"; sourceId: string }
    | { kind: "FLAVOR"; flavorId: string };
}

export function day1M4Frame(
  view: RuntimeView,
  spaceId: string,
): M4CandidateFrame[] {
  const candidates: M4CandidateFrame[] = [];
  for (const knowledge of M4_KNOWLEDGE) {
    if (knowledge.spaceId !== spaceId) continue;
    candidates.push({
      id: `M4:${knowledge.id}`,
      kind: "KNOWLEDGE",
      label: `Read ${knowledge.title}`,
      priority: INTERACTION_PRIORITIES.KNOWLEDGE,
      spaceId,
      position: knowledgeWorldPosition(knowledge),
      radius: 2.15,
      facingDot: -0.1,
      // The authored point sits on the imported carrier face; semantic LOS
      // would otherwise count the destination surface itself as an occluder.
      losRequired: false,
      enabledWithOffers: true,
      activate: { kind: "EXCHANGE", sourceId: knowledge.id },
    });
  }
  if (spaceId === "EXTERIOR") {
    for (const activityId of [
      OPTIONAL_ACTIVITY_IDS.ROOF_KID,
      OPTIONAL_ACTIVITY_IDS.CRIER,
      OPTIONAL_ACTIVITY_IDS.AGITATOR_DARE,
      OPTIONAL_ACTIVITY_IDS.ROOFTOP_RUN,
      OPTIONAL_ACTIVITY_IDS.LOSE_WATCH,
    ] as const) {
      const sourceId = activityOfferSourceId(view, activityId);
      if (!sourceId) continue;
      const prompt = M4_ACTIVITY_PROMPTS[sourceId]!(view);
      if (!prompt) continue;
      candidates.push({
        id: `M4:${prompt.sourceId}`,
        kind: "SIDE_JOB",
        label: prompt.action,
        priority: INTERACTION_PRIORITIES.SIDE_JOB_THREAD,
        spaceId,
        position: prompt.position,
        radius: 2.5,
        facingDot: -0.2,
        losRequired: true,
        enabledWithOffers: true,
        activate: { kind: "EXCHANGE", sourceId: prompt.sourceId },
      });
    }
    for (const verb of M4_FLAVOR_VERBS) {
      candidates.push({
        id: `M4:${verb.id}`,
        kind: "FLAVOR",
        label: verb.label,
        priority: INTERACTION_PRIORITIES.FLAVOR,
        spaceId,
        position: verb.position,
        radius: verb.radius,
        facingDot: -0.3,
        losRequired: false,
        enabledWithOffers: false,
        activate: { kind: "FLAVOR", flavorId: verb.id },
      });
    }
  }
  for (const figure of M4_INFO_FIGURES) {
    if (figure.spaceId !== spaceId || !figure.offered(view)) continue;
    candidates.push({
      id: `M4:${figure.id}`,
      kind: "NPC",
      label: "Ask for rumors",
      priority: INTERACTION_PRIORITIES.STORY_NPC,
      spaceId,
      position: figure.position,
      radius: 2.3,
      facingDot: -0.2,
      losRequired: true,
      enabledWithOffers: true,
      activate: { kind: "EXCHANGE", sourceId: figure.id },
    });
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Static cast placements (inline JSX rows from the legacy render, as data)
// ---------------------------------------------------------------------------

export interface M4CastPlacement {
  key: string;
  glb: string;
  height: number;
  clip: string;
  tint?: string;
  spaceId: string;
  position: readonly [number, number, number];
  rotY: number;
  visible?: (view: RuntimeView) => boolean;
}

export const M4_STATIC_CAST: readonly M4CastPlacement[] = [
  { key: "roof-mother", glb: "goodwife-rigged", height: 1.62, clip: "talk", spaceId: "EXTERIOR", position: [-24, 0, 9.8], rotY: 2.5 },
  {
    key: "jonah",
    glb: "townsman-rigged",
    height: 1.45,
    clip: "sitIdle",
    tint: "#a98d72",
    spaceId: "EXTERIOR",
    position: [13.5, 3.05, -10.8],
    rotY: Math.PI,
    visible: (view) =>
      view.field.activities[OPTIONAL_ACTIVITY_IDS.ROOF_KID]!.stage !==
      "COMPLETED",
  },
  { key: "towncrier", glb: "towncrier-rigged", height: 1.72, clip: "idle", spaceId: "EXTERIOR", position: [6, 0, 8.8], rotY: Math.PI },
  { key: "agitator", glb: "agitator-rigged", height: 1.74, clip: "argu1", spaceId: "EXTERIOR", position: [-16, 0, 6], rotY: 1.7 },
  { key: "custom-contact", glb: "townsman-rigged", height: 1.7, clip: "idle", tint: "#7f7468", spaceId: "EXTERIOR", position: [50, 0, 8], rotY: Math.PI },
  { key: "info-goodwife", glb: "goodwife-rigged", height: 1.63, clip: "talk2", tint: "#a59380", spaceId: "EXTERIOR", position: [-28, 0, 9.2], rotY: 2.4 },
  {
    key: "info-dockhand",
    glb: "dockhand-rigged",
    height: 1.72,
    clip: "work1",
    spaceId: "EXTERIOR",
    position: [-134, 0, 0.5],
    rotY: 0.4,
    visible: dockDone,
  },
  {
    key: "info-keeper",
    glb: "townsman-rigged",
    height: 1.7,
    clip: "talk",
    spaceId: "EXPLORE_tavern",
    position: interiorPoint("EXPLORE_tavern", [-7, 0, 1]),
    rotY: Math.PI,
    visible: tavernDone,
  },
] as const;
