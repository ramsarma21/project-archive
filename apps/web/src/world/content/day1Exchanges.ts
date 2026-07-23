// ---------------------------------------------------------------------------
// Day-1 exchange content (chapter data), extracted verbatim from
// ReactiveNpcDirector in refactor wave 2. Authored copy is byte-identical to
// the legacy tables; only the container shape changed (every source id now
// registers explicitly in the exchange source registry, replacing the
// NPC-/THR-/SJ- prefix routing).
//
// Owners registered here:
//   NAMED_CAST         NPC-abigail / NPC-thomas / NPC-pike / NPC-clarke / NPC-rider
//   AUTHORED_DIALOGUE  BOS.ACT01.DLG.* follow-up nodes (exact ids from the view)
//   THREAD_FIGURE      THR-ned / THR-sarah
//   SIDE_JOB           SJ-dock-haul-* / SJ-ropewalk-* / SJ-tavern-note-handoff
// ---------------------------------------------------------------------------

import {
  HEAT_BANDS,
  MICRO_CONCEPT_IDS,
  OPTIONAL_ACTIVITY_IDS,
  standingDeltaForCause,
  THREAD_IDS,
  type RuntimeView,
} from "@pa/contracts";
import {
  actorRoutePose,
  NAMED_ACTOR_ROUTES,
  type NamedActorId,
} from "../actorRoutes.js";
import { INTERACTION_PRIORITIES } from "../interactionRegistry.js";
import type {
  InteractionKind,
  InteractionPriority,
} from "../interactionRegistry.js";
import { interiorPoint } from "../interiorManifest.js";
import {
  REACTIVE_NAMED_CAST,
  SIDE_JOB_ANCHORS,
  THREAD_FIGURES,
  type ReactiveActorDefinition,
} from "../reactiveManifest.js";
import {
  registerExchangeSourcePackage,
  type Exchange,
  type ExchangeChoice,
  type ExchangeEngineProfile,
  type ExchangeSource,
  type ExchangeSourceFamily,
} from "../exchange/exchangeSources.js";

// Legacy ReactiveNpcDirector engine constants: M3_ interrupt ids, the "talk"
// begin clip, panel z-band [20,10], no explicit ESC button. Named-cast and
// authored-dialogue outcomes resolve runtime-side (the registered-outcome
// table); thread and side-job completions carry their authored effects.
const M3_RUNTIME_RESOLVED: ExchangeEngineProfile = {
  interruptIdPrefix: "M3",
  completionEvent: "FIELD_REACTIVE_OUTCOME_SELECTED",
  beginClip: "talk",
  panelZRange: [20, 10],
  dismissButton: false,
};

const M3_AUTHORED_EFFECTS: ExchangeEngineProfile = {
  ...M3_RUNTIME_RESOLVED,
  completionEvent: "FIELD_REACTIVE_COMPLETED",
};

// Byte-for-byte port of the legacy finish() action-clip selection. Authored
// mapping over authored ids (presentation only, no ownership routing).
function m3ActionClip(sourceId: string, choiceId: string): string {
  return sourceId.includes("handoff") || choiceId === "SET_DOWN"
    ? "handoff"
    : sourceId.includes("dock-haul")
      ? "carry"
      : sourceId.startsWith("SJ-ropewalk") && choiceId !== "PAUSE"
        ? "ropePull"
        : sourceId === "THR-ned" && choiceId === "FETCH"
          ? "work2"
          : sourceId === "THR-sarah" && choiceId !== "DECLINE"
            ? "work1"
            : "talk";
}

type AuthoredChoice = Omit<ExchangeChoice, "actionClip">;

function m3Exchange(
  profile: ExchangeEngineProfile,
  exchange: {
    sourceId: string;
    title: string;
    line: string;
    position: readonly [number, number, number];
    choices: readonly AuthoredChoice[];
  },
): Exchange {
  return {
    ...exchange,
    choices: exchange.choices.map((choice) => ({
      ...choice,
      actionClip: m3ActionClip(exchange.sourceId, choice.id),
    })),
    engine: profile,
  };
}

function lowerHeat(band: RuntimeView["field"]["heat"]["band"]) {
  const index = HEAT_BANDS.indexOf(band);
  return HEAT_BANDS[Math.max(0, index - 1)]!;
}

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

// Route pose when the actor is present in the space; otherwise the actor's
// first exterior waypoint. The legacy resume returned null on a missing pose,
// which left a reloaded exchange unreconstructable (wave-2 P0 gap); the panel
// clamp makes any world anchor safe.
function namedCastAnchor(
  actorId: NamedActorId,
  spaceId: string,
  tick: number,
  fieldSeed: number,
): readonly [number, number, number] {
  const pose = actorRoutePose(actorId, spaceId, tick, fieldSeed);
  return pose?.position ?? NAMED_ACTOR_ROUTES[actorId].exterior[0]!;
}

function nedAnchor(spaceId: string): readonly [number, number, number] {
  return spaceId === "MERCER_PRESS"
    ? interiorPoint("MERCER_PRESS", [...THREAD_FIGURES.NED.interiorPosition])
    : THREAD_FIGURES.NED.exteriorPosition;
}

const keeperAnchor = () =>
  interiorPoint("EXPLORE_tavern", [
    ...SIDE_JOB_ANCHORS[OPTIONAL_ACTIVITY_IDS.TAVERN_NOTE].keeperInteractLocal,
  ]);

// ---------------------------------------------------------------------------
// Authored exchanges (copy ported byte-identically)
// ---------------------------------------------------------------------------

function followupExchange(
  followup: RuntimeView["openResponse"]["npcFollowups"][number],
  position: readonly [number, number, number],
): Exchange {
  return m3Exchange(M3_RUNTIME_RESOLVED, {
    sourceId: followup.nodeId,
    title: followup.name,
    line: followup.openingLines.join(" "),
    position,
    choices: followup.options.map((option) => ({
      id: option.optionId,
      label: option.text,
      reply: option.reply,
      effects: {},
    })),
  });
}

function namedExchange(
  actor: ReactiveActorDefinition,
  view: RuntimeView,
  position: readonly [number, number, number],
): Exchange {
  const followup = view.openResponse.npcFollowups.find(
    (node) => node.npcId === actor.id,
  );
  if (followup) return followupExchange(followup, position);
  const common = {
    sourceId: `NPC-${actor.id}`,
    title: actor.name,
    line: actor.line,
    position,
  };
  switch (actor.id) {
    case "abigail": {
      const alreadyVouched = view.field.heat.history.some(
        (record) => record.cause === "VOUCH",
      );
      return m3Exchange(M3_RUNTIME_RESOLVED, {
        ...common,
        choices: [
          {
            id: "PRESS",
            label: "Ask about the press",
            reply: "Ink and paper are only half of it. A printer decides what the town can hear.",
            effects: {
              micros: [MICRO_CONCEPT_IDS.PRINTERS_ROLE],
              relationships: [{ relationshipId: "ABIGAIL_TRUST", delta: 4, causeId: "abigail-press-talk" }],
            },
          },
          {
            id: "VOUCH",
            label: alreadyVouched ? "Thank her for backing you" : "Ask her to vouch for you",
            reply: alreadyVouched
              ? "I have already put my name beside yours. Use it wisely."
              : "If the watch asks, you are on Mercer business. Do not make me regret it.",
            effects: alreadyVouched
              ? {}
              : {
                  heat: { to: lowerHeat(view.field.heat.band), cause: "VOUCH" },
                  relationships: [{ relationshipId: "ABIGAIL_TRUST", delta: 3, causeId: "abigail-vouch" }],
                },
          },
          { id: "LATER", label: "Keep moving", reply: "Then move.", effects: {} },
        ],
      });
    }
    case "thomas": {
      const note = view.field.activities[OPTIONAL_ACTIVITY_IDS.TAVERN_NOTE];
      const noteEligible =
        note.stage === "AVAILABLE" &&
        view.objectives.THOMAS_CIRCULAR === "COMPLETED";
      return m3Exchange(M3_RUNTIME_RESOLVED, {
        ...common,
        choices: [
          {
            id: "TRADE",
            label: "Ask what the duties change",
            reply: "Every delay at the harbor becomes a price in the shop—and a wage lost on the quay.",
            effects: {
              micros: [
                MICRO_CONCEPT_IDS.NON_IMPORTATION,
                MICRO_CONCEPT_IDS.PORT_TOWN_BOSTON,
              ],
              relationships: [{ relationshipId: "THOMAS_OBLIGATION", delta: 3, causeId: "thomas-trade-talk" }],
            },
          },
          noteEligible
            ? {
                id: "TAKE_NOTE",
                label: "Take the tavern note",
                reply: "The meeting is tonight. Keeper needs to know. Quiet-like.",
                effects: {
                  activities: [{
                    activityId: OPTIONAL_ACTIVITY_IDS.TAVERN_NOTE,
                    stage: "ACCEPTED",
                    breadcrumb: "Thomas asked for a quiet hand-off inside the Bunch of Grapes.",
                  }],
                  custody: [{ objectId: "TAVERN_NOTE", custody: "PLAYER", condition: "INTACT", concealment: "HIDDEN" }],
                },
              }
            : {
                id: "ROUTE",
                label: "Ask about the docks",
                reply: "Know the wharf and you know half of Boston's troubles.",
                effects: { micros: [MICRO_CONCEPT_IDS.PORT_TOWN_BOSTON] },
              },
          { id: "LATER", label: "Keep moving", reply: "Business waits for no runner.", effects: {} },
        ],
      });
    }
    case "pike":
      return m3Exchange(M3_RUNTIME_RESOLVED, {
        ...common,
        choices: [
          {
            id: "COURTS",
            label: "Ask about the courts",
            reply: "Vice-admiralty means a Crown judge and no local jury. That difference matters.",
            effects: {
              micros: [MICRO_CONCEPT_IDS.VICE_ADMIRALTY_COURTS],
              relationships: [{ relationshipId: "PIKE_RESPECT", delta: 4, causeId: "pike-courts-talk" }],
            },
          },
          {
            id: "COIN",
            label: "Ask why coin matters",
            reply: "The duty wants specie. Boston mostly trades in paper promises and credit.",
            effects: { micros: [MICRO_CONCEPT_IDS.HARD_COIN_SCARCITY] },
          },
          { id: "LATER", label: "Leave him to his files", reply: "Quite.", effects: {} },
        ],
      });
    case "clarke":
      return m3Exchange(M3_RUNTIME_RESOLVED, {
        ...common,
        choices: [
          {
            id: "HEAR",
            label: "Hear him out",
            reply: "Parliament is lawful government. A crowd with a rope is not.",
            effects: {
              micros: [MICRO_CONCEPT_IDS.LOYALIST_VIEW],
              relationships: [{ relationshipId: "CLARKE_POLITICAL_READ", delta: 8, causeId: "clarke-heard-out" }],
            },
          },
          {
            id: "CURT",
            label: "Answer him curtly",
            reply: "Then I shall remember which side of the street you chose.",
            effects: {
              standing: {
                delta: standingDeltaForCause("CLARKE_INFORMED"),
                causeId: "CLARKE_INFORMED",
              },
              identity: { clarkeMarked: true, reason: "clarke-informed" },
              heat: {
                to:
                  view.field.heat.band === "CALM"
                    ? "NOTICED"
                    : view.field.heat.band,
                cause: "DETECTION",
              },
              relationships: [{ relationshipId: "CLARKE_POLITICAL_READ", delta: -12, causeId: "clarke-curt" }],
            },
          },
          { id: "LATER", label: "Say nothing", reply: "Silence is an answer too.", effects: {} },
        ],
      });
    case "rider":
      return m3Exchange(M3_RUNTIME_RESOLVED, {
        ...common,
        choices: [
          {
            id: "NETWORK",
            label: "Ask where the news goes",
            reply: "Press to tavern, tavern to saddle, then every road that leaves Boston.",
            effects: {
              micros: [MICRO_CONCEPT_IDS.NEWS_NETWORKS],
              relationships: [{ relationshipId: "RIDER_TRUST", delta: 4, causeId: "rider-network-talk" }],
            },
          },
          { id: "BELL", label: "Ask about the bell", reply: "When it rings, the road decides what arrives on time.", effects: {} },
          { id: "LATER", label: "Let him prepare", reply: "Good. I have a horse to mind.", effects: {} },
        ],
      });
  }
}

// Ned's Thread-A arc is staged: the opener (meet/craft/fetch), then the
// covered-errand ask once he trusts you, then a settled Act-2 breadcrumb.
// Each step reads the durable thread flags, so the arc survives saves and
// never repeats a consumed beat (Quests-and-NPCs Thread A).
function nedExchange(
  view: RuntimeView,
  position: readonly [number, number, number],
): Exchange {
  const thread = view.field.threads[THREAD_IDS.NED];
  const fetched = Boolean(thread.flags.NED_FETCHED_TYPE);
  const encouraged = Boolean(thread.flags.NED_ENCOURAGED_CRAFT);
  const covered = Boolean(thread.flags.NED_COVERED_ERRAND);
  if (covered) {
    return m3Exchange(M3_AUTHORED_EFFECTS, {
      sourceId: "THR-ned",
      title: "Ned // The Apprentice",
      line: "Abigail never knew about the errand. I owe you one, runner — and I keep accounts better than Pike.",
      position,
      choices: [
        {
          id: "SETTLED",
          label: "See you around, Ned",
          reply: "Five years from now I'll have my own press. You'll see.",
          effects: {},
        },
        { id: "LATER", label: "Keep moving", reply: "Go on then.", effects: {} },
      ],
    });
  }
  if (fetched || encouraged) {
    return m3Exchange(M3_AUTHORED_EFFECTS, {
      sourceId: "THR-ned",
      title: "Ned // The Apprentice",
      line: "Runner — a quiet favor? I slipped out to hear the elm crowd and Abigail noticed the empty stool. Say you sent me on an errand.",
      position,
      choices: [
        {
          id: "COVER",
          label: "Cover for him",
          reply: "You're a friend. The men at the elm — the Loyal Nine, folk whisper — they use printers' boys as runners too. Word moves through us.",
          effects: {
            threads: [{
              threadId: THREAD_IDS.NED,
              flags: { NED_COVERED_ERRAND: true },
              status: "ACTIVE",
              trustDelta: 2,
              breadcrumb: "You covered Ned's absence; he owes you and talks of the Loyal Nine's runners.",
            }],
            micros: [MICRO_CONCEPT_IDS.LOYAL_NINE, MICRO_CONCEPT_IDS.NEWS_NETWORKS],
          },
        },
        {
          id: "REFUSE",
          label: "Not lying to Abigail",
          reply: "Fair. Honest, anyway. I'll take my scolding straight.",
          effects: {
            threads: [{
              threadId: THREAD_IDS.NED,
              trustDelta: -1,
              flags: { NED_ROPED_INTO_RUN: false },
              breadcrumb: "Ned took his scolding; he respects the honesty, mostly.",
            }],
          },
        },
        { id: "LATER", label: "Later", reply: "Quick, though. She counts stools.", effects: {} },
      ],
    });
  }
  return m3Exchange(M3_AUTHORED_EFFECTS, {
    sourceId: "THR-ned",
    title: "Ned // The Apprentice",
    line: "You're the new runner? Lucky. I'm stuck setting type till my fingers are black.",
    position,
    choices: [
      {
        id: "DEMONSTRATE",
        label: "Show me the press",
        reply: "The cases hold every letter. Set them backward, lock the form, then the press does its work.",
        effects: {
          threads: [{
            threadId: THREAD_IDS.NED,
            flags: { MET: true, OPENED: true, NED_ENCOURAGED_CRAFT: true },
            status: "OPEN",
            trustDelta: 1,
            breadcrumb: "Ned is learning the printer's trade at Mercer's.",
          }],
          micros: [MICRO_CONCEPT_IDS.PRINTERS_ROLE],
          standing: {
            delta: standingDeltaForCause("NED_MET"),
            causeId: "NED_MET",
          },
        },
      },
      {
        id: "FETCH",
        label: "Fetch the tray of type",
        reply: "Mind the sorts—drop the tray and we will be finding tiny letters until winter.",
        effects: {
          threads: [{
            threadId: THREAD_IDS.NED,
            flags: { MET: true, OPENED: true, NED_FETCHED_TYPE: true },
            status: "ACTIVE",
            trustDelta: 2,
            breadcrumb: "You helped Ned with a tray of type; check the shopfront later.",
          }],
          micros: [MICRO_CONCEPT_IDS.PRINTERS_ROLE],
          standing: {
            delta: standingDeltaForCause("NED_TYPE_FETCH"),
            causeId: "NED_TYPE_FETCH",
          },
        },
      },
      {
        id: "LATER",
        label: "Later",
        reply: "I'll still be here. The type will too.",
        effects: {
          threads: [{
            threadId: THREAD_IDS.NED,
            flags: { MET: true },
            status: "DORMANT",
            breadcrumb: "Ned is still at Mercer's when you have time.",
          }],
        },
      },
    ],
  });
}

function sarahExchange(
  view: RuntimeView,
  position: readonly [number, number, number],
): Exchange {
  const followup = view.openResponse.npcFollowups.find(
    (node) => node.npcId === "sarah",
  );
  if (followup) return followupExchange(followup, position);
  return m3Exchange(M3_AUTHORED_EFFECTS, {
    sourceId: "THR-sarah",
    title: "Goodwife Sarah // The Wharf Widow",
    line: "Fish and thread, love—what's left of it. Half my trade's gone since the new duties.",
    position,
    choices: [
      {
        id: "BUY",
        label: "Buy something",
        reply: "Kind of you. A market survives one small purchase at a time.",
        effects: {
          threads: [{
            threadId: THREAD_IDS.SARAH,
            flags: { MET: true, OPENED: true, SARAH_BOUGHT_GOODS: true },
            status: "OPEN",
            trustDelta: 2,
            breadcrumb: "Sarah keeps her stall near the west-street market.",
          }],
          micros: [MICRO_CONCEPT_IDS.PORT_TOWN_BOSTON],
          standing: {
            delta: standingDeltaForCause("SARAH_BOUGHT_GOODS"),
            causeId: "SARAH_BOUGHT_GOODS",
          },
        },
      },
      {
        id: "HELP",
        label: "Help with the stall",
        reply: "Folk stop buying English goods to spite the Crown. Noble, till it's my children going without.",
        effects: {
          threads: [{
            threadId: THREAD_IDS.SARAH,
            flags: { MET: true, OPENED: true, SARAH_HELPED_HAUL: true, SARAH_HEARD_OUT: true },
            status: "ACTIVE",
            trustDelta: 3,
            breadcrumb: "You helped Sarah at the market; her trade is caught in the boycott.",
          }],
          micros: [
            MICRO_CONCEPT_IDS.NON_IMPORTATION,
            MICRO_CONCEPT_IDS.PORT_TOWN_BOSTON,
          ],
          standing: {
            delta: standingDeltaForCause("SARAH_HELPED_STALL"),
            causeId: "SARAH_HELPED_STALL",
          },
        },
      },
      {
        id: "DECLINE",
        label: "Sorry, running",
        reply: "Then run. The stall will be here tomorrow, if the trade is.",
        effects: {
          threads: [{
            threadId: THREAD_IDS.SARAH,
            flags: { MET: true },
            status: "DORMANT",
            breadcrumb: "Sarah's market stall remains open if you return.",
          }],
        },
      },
    ],
  });
}

const DOCK_ANCHORS = SIDE_JOB_ANCHORS[OPTIONAL_ACTIVITY_IDS.DOCK_HAUL];

function dockOfferExchange(): Exchange {
  return m3Exchange(M3_AUTHORED_EFFECTS, {
    sourceId: "SJ-dock-haul-offer",
    title: "Wharf dockhand",
    line: "Tide's turning and this barrel's got to be aboard. Lend a back?",
    position: DOCK_ANCHORS.dockhandInteract,
    choices: [
      {
        id: "ACCEPT",
        label: "Lend a back",
        reply: "Good. Take the barrel by the crane, then mind the gangplank.",
        effects: {
          activities: [{
            activityId: OPTIONAL_ACTIVITY_IDS.DOCK_HAUL,
            stage: "ACCEPTED",
            breadcrumb: "Lift the dockhand's barrel beside the wharf crane.",
          }],
        },
      },
      {
        id: "ASK",
        label: "Ask why it matters",
        reply: "Miss the tide and the cargo misses the ship. Then everybody on this apron loses wages.",
        effects: { micros: [MICRO_CONCEPT_IDS.PORT_TOWN_BOSTON] },
      },
      {
        id: "DECLINE",
        label: "Not now",
        reply: "If the tide allows, the work will still be here.",
        effects: {
          activities: [{
            activityId: OPTIONAL_ACTIVITY_IDS.DOCK_HAUL,
            stage: "DORMANT",
            breadcrumb: "The dockhand may still need help before the tide turns.",
          }],
        },
      },
    ],
  });
}

interface StagedVerbRow {
  /** The stage this verb consumes — doubles as the recorded choice/outcome id. */
  stage: string;
  title: string;
  line: string;
  label: string;
  reply: string;
  position: readonly [number, number, number];
  effects: AuthoredChoice["effects"];
}

// Staged dock verbs. The choice id is the stage the verb consumes (recorded in
// saves), matching the legacy table exactly.
const DOCK_STAGE_EXCHANGES: Record<
  "SJ-dock-haul-lift" | "SJ-dock-haul-balance" | "SJ-dock-haul-setdown",
  StagedVerbRow
> = {
  "SJ-dock-haul-lift": {
    stage: "ACCEPTED",
    title: "Dock haul // Load",
    line: "The barrel is heavy but sound.",
    label: "Lift the barrel",
    reply: "You settle its weight and start toward the ship.",
    position: DOCK_ANCHORS.barrelInteract,
    effects: {
      activities: [{
        activityId: OPTIONAL_ACTIVITY_IDS.DOCK_HAUL,
        stage: "CARRYING",
        breadcrumb: "Carry the barrel to the gangplank.",
      }],
      custody: [{ objectId: "DOCK_BARREL", custody: "PLAYER", condition: "INTACT", concealment: "EXPOSED" }],
    },
  },
  "SJ-dock-haul-balance": {
    stage: "CARRYING",
    title: "Dock haul // Balance",
    line: "The gangplank shifts under the load.",
    label: "Balance and cross",
    reply: "Slow feet keep the barrel centered over the narrow planks.",
    position: DOCK_ANCHORS.gangplank,
    effects: {
      activities: [{
        activityId: OPTIONAL_ACTIVITY_IDS.DOCK_HAUL,
        stage: "READY_HANDOFF",
        breadcrumb: "Set the barrel down on the ship's deck.",
      }],
    },
  },
  "SJ-dock-haul-setdown": {
    stage: "READY_HANDOFF",
    title: "Dock haul // Set down",
    line: "The deck crew clears a place beside the cargo.",
    label: "Set down the barrel",
    reply: "The barrel is aboard before the tide turns.",
    position: DOCK_ANCHORS.deckInteract,
    effects: {
      activities: [{
        activityId: OPTIONAL_ACTIVITY_IDS.DOCK_HAUL,
        stage: "COMPLETED",
        breadcrumb: "Dock haul complete; the dockhand now shares wharf rumors.",
      }],
      custody: [{ objectId: "DOCK_BARREL", custody: "SHIP", condition: "INTACT", concealment: "EXPOSED" }],
      standing: {
        delta: standingDeltaForCause("DOCK_HAUL_COMPLETED"),
        causeId: "DOCK_HAUL_COMPLETED",
      },
      micros: [MICRO_CONCEPT_IDS.PORT_TOWN_BOSTON],
      rumors: ["Dock workers know a scaffold route toward the central roofs."],
      clockUnits: 1,
    },
  },
};

function dockStageExchange(
  sourceId: keyof typeof DOCK_STAGE_EXCHANGES,
): Exchange {
  const data = DOCK_STAGE_EXCHANGES[sourceId];
  return m3Exchange(M3_AUTHORED_EFFECTS, {
    sourceId,
    title: data.title,
    line: data.line,
    position: data.position,
    choices: [
      { id: data.stage, label: data.label, reply: data.reply, effects: data.effects },
      { id: "PAUSE", label: "Set it safely and pause", reply: "The work waits without blocking the street.", effects: {} },
    ],
  });
}

// The ropewalk trades job — the slice's occupational-work template
// (Activity-Expansion family A). One occupant, three staged verbs the
// length of the longest room in Boston: take the strand, hook it at the far
// end, walk the lay back and close it. Teaching payload: port-town economics
// (PORT_TOWN_BOSTON) delivered by doing the harbor's work, not reading it.
const ROPEWALK_ANCHORS = SIDE_JOB_ANCHORS[OPTIONAL_ACTIVITY_IDS.ROPEWALK];

const ROPEWALK_EXCHANGES: Record<
  "SJ-ropewalk-offer" | "SJ-ropewalk-hook" | "SJ-ropewalk-close",
  Omit<StagedVerbRow, "position"> & {
    local: readonly [number, number, number];
  }
> = {
  "SJ-ropewalk-offer": {
    stage: "AVAILABLE",
    title: "The ropemaker",
    line: "Cordage for half the harbor is laid on this floor. Trade slows, rope slows — feel it yourself if you like.",
    label: "Take the strand's tail",
    reply: "Keep it off the floor and walk it to the far hook. The whole length, mind.",
    local: ROPEWALK_ANCHORS.ropemakerInteractLocal,
    effects: {
      activities: [{
        activityId: OPTIONAL_ACTIVITY_IDS.ROPEWALK,
        stage: "ACCEPTED",
        breadcrumb: "Carry the strand the length of the ropewalk to the far hook.",
      }],
    },
  },
  "SJ-ropewalk-hook": {
    stage: "ACCEPTED",
    title: "The far hook",
    line: "The strand runs the whole hall behind you.",
    label: "Loop the strand on the hook",
    reply: "It holds. Now walk the lay back — watch the twist as you go.",
    local: ROPEWALK_ANCHORS.farHookInteractLocal,
    effects: {
      activities: [{
        activityId: OPTIONAL_ACTIVITY_IDS.ROPEWALK,
        stage: "READY_HANDOFF",
        breadcrumb: "Walk the lay back and close it with the ropemaker at the rig.",
      }],
    },
  },
  "SJ-ropewalk-close": {
    stage: "READY_HANDOFF",
    title: "Close the lay",
    line: "The ropemaker steadies the rig as you come back down the walk.",
    label: "Close the lay at the rig",
    reply: "Good rope. Every fathom of it serves a ship — and when the ships sit idle, this floor goes quiet and wages go with it. Now you've felt the length of the harbor's living.",
    local: ROPEWALK_ANCHORS.rigCloseInteractLocal,
    effects: {
      activities: [{
        activityId: OPTIONAL_ACTIVITY_IDS.ROPEWALK,
        stage: "COMPLETED",
        breadcrumb: "You laid a strand the full length of the ropewalk.",
      }],
      micros: [MICRO_CONCEPT_IDS.PORT_TOWN_BOSTON],
      standing: {
        delta: standingDeltaForCause("ROPEWALK_COMPLETED"),
        causeId: "ROPEWALK_COMPLETED",
      },
      rumors: ["The ropewalk crew reads the harbor's health in every idle hook."],
      clockUnits: 1,
    },
  },
};

function ropewalkExchange(sourceId: keyof typeof ROPEWALK_EXCHANGES): Exchange {
  const data = ROPEWALK_EXCHANGES[sourceId];
  return m3Exchange(M3_AUTHORED_EFFECTS, {
    sourceId,
    title: data.title,
    line: data.line,
    position: interiorPoint("EXPLORE_ropewalk", [...data.local]),
    choices: [
      { id: data.stage, label: data.label, reply: data.reply, effects: data.effects },
      { id: "PAUSE", label: "Step back for now", reply: "The walk keeps. Come back to it.", effects: {} },
    ],
  });
}

function keeperExchange(): Exchange {
  return m3Exchange(M3_AUTHORED_EFFECTS, {
    sourceId: "SJ-tavern-note-handoff",
    title: "Keeper // Bunch of Grapes",
    line: "Thomas sent you?",
    position: keeperAnchor(),
    choices: [
      {
        id: "HANDOFF",
        label: "Hand over the folded note",
        reply: "Tell him we'll be ready. And you didn't hear it from me.",
        effects: {
          activities: [{
            activityId: OPTIONAL_ACTIVITY_IDS.TAVERN_NOTE,
            stage: "COMPLETED",
            breadcrumb: "The keeper received Thomas's note; tavern rumors are now open.",
          }],
          custody: [{ objectId: "TAVERN_NOTE", custody: "TAVERN_KEEPER", condition: "INTACT", concealment: "HIDDEN" }],
          micros: [
            MICRO_CONCEPT_IDS.NON_IMPORTATION,
            MICRO_CONCEPT_IDS.LOYAL_NINE,
          ],
          standing: {
            delta: standingDeltaForCause("TAVERN_NOTE_DELIVERED"),
            causeId: "TAVERN_NOTE_DELIVERED",
          },
          relationships: [{ relationshipId: "THOMAS_OBLIGATION", delta: 5, causeId: "tavern-note-delivered" }],
          rumors: ["A meeting at the Bunch of Grapes points toward the Loyal Nine."],
          // Running the quiet errand teaches you the quiet way: the north
          // back lane becomes an owned route (Archive ROUTES + R3 reminders).
          routes: [{ routeId: "NORTH_ALLEY_ROUTE", label: "The laundry-lane cut (north back alley)" }],
          clockUnits: 1,
        },
      },
      { id: "WAIT", label: "Keep the note for now", reply: "Then keep it hidden.", effects: {} },
    ],
  });
}

// ---------------------------------------------------------------------------
// Source registration (exact ids; no prefix routing anywhere)
// ---------------------------------------------------------------------------

const NAMED_SOURCES: ExchangeSource[] = REACTIVE_NAMED_CAST.map(
  (definition) => ({
    sourceId: `NPC-${definition.id}`,
    owner: "NAMED_CAST",
    kind: "EXCHANGE",
    resolve: (view, spaceId, tick, fieldSeed) =>
      namedExchange(
        definition,
        view,
        namedCastAnchor(definition.id, spaceId, tick, fieldSeed),
      ),
  }),
);

const THREAD_SOURCES: ExchangeSource[] = [
  {
    sourceId: "THR-ned",
    owner: "THREAD_FIGURE",
    kind: "EXCHANGE",
    resolve: (view, spaceId) => nedExchange(view, nedAnchor(spaceId)),
  },
  {
    sourceId: "THR-sarah",
    owner: "THREAD_FIGURE",
    kind: "EXCHANGE",
    resolve: (view) =>
      sarahExchange(view, THREAD_FIGURES.SARAH.exteriorPosition),
  },
];

const SIDE_JOB_SOURCES: ExchangeSource[] = [
  {
    sourceId: "SJ-dock-haul-offer",
    owner: "SIDE_JOB",
    kind: "EXCHANGE",
    resolve: () => dockOfferExchange(),
  },
  ...(Object.keys(DOCK_STAGE_EXCHANGES) as (keyof typeof DOCK_STAGE_EXCHANGES)[]).map(
    (sourceId): ExchangeSource => ({
      sourceId,
      owner: "SIDE_JOB",
      kind: "EXCHANGE",
      resolve: () => dockStageExchange(sourceId),
    }),
  ),
  ...(Object.keys(ROPEWALK_EXCHANGES) as (keyof typeof ROPEWALK_EXCHANGES)[]).map(
    (sourceId): ExchangeSource => ({
      sourceId,
      owner: "SIDE_JOB",
      kind: "EXCHANGE",
      resolve: () => ropewalkExchange(sourceId),
    }),
  ),
  {
    sourceId: "SJ-tavern-note-handoff",
    owner: "SIDE_JOB",
    kind: "EXCHANGE",
    resolve: () => keeperExchange(),
  },
];

// Runtime-authored NPC follow-up dialogue nodes. Exact ids come from the view
// (the runtime force-includes the active interrupt's node even when its gate
// would hide it, so resume membership is guaranteed). Anchors: the speaking
// cast member's live pose, or the matching thread figure for non-cast npcIds
// (the legacy resume returned null for Sarah's follow-ups — a wave-2 P0 gap).
const AUTHORED_DIALOGUE_FAMILY: ExchangeSourceFamily = {
  familyId: "day1-npc-followups",
  owner: "AUTHORED_DIALOGUE",
  memberIds: (view) =>
    view.openResponse.npcFollowups.map((node) => node.nodeId),
  resolve: (sourceId, view, spaceId, tick, fieldSeed) => {
    const followup = view.openResponse.npcFollowups.find(
      (node) => node.nodeId === sourceId,
    );
    if (!followup) return null;
    const cast = REACTIVE_NAMED_CAST.find(
      (actor) => actor.id === followup.npcId,
    );
    const position = cast
      ? namedCastAnchor(cast.id, spaceId, tick, fieldSeed)
      : followup.npcId === "ned"
        ? nedAnchor(spaceId)
        : followup.npcId === "sarah"
          ? THREAD_FIGURES.SARAH.exteriorPosition
          : ([0, 0, 0] as const);
    return followupExchange(followup, position);
  },
};

registerExchangeSourcePackage("day1-exchanges", {
  sources: [...NAMED_SOURCES, ...THREAD_SOURCES, ...SIDE_JOB_SOURCES],
  families: [AUTHORED_DIALOGUE_FAMILY],
});

// ---------------------------------------------------------------------------
// Figure staging + interaction candidates (data consumed by the director's
// generic frame loop; gating logic ported verbatim from the legacy useFrame)
// ---------------------------------------------------------------------------

export interface Day1FigureDefinition {
  id: "ned" | "sarah" | "dockhand-m3" | "ropemaker";
  glb: string;
  height: number;
  tint: string;
  rotationY?: number;
  workClip: string;
  /** Exchange source ids that switch this figure to its talk clip. */
  talkSourceIds: readonly string[];
}

export const DAY1_FIGURES: readonly Day1FigureDefinition[] = [
  {
    id: "ned",
    glb: THREAD_FIGURES.NED.glb,
    height: THREAD_FIGURES.NED.height,
    tint: THREAD_FIGURES.NED.tint,
    workClip: "work2",
    talkSourceIds: ["THR-ned"],
  },
  {
    id: "sarah",
    glb: THREAD_FIGURES.SARAH.glb,
    height: THREAD_FIGURES.SARAH.height,
    tint: THREAD_FIGURES.SARAH.tint,
    workClip: "work1",
    talkSourceIds: ["THR-sarah"],
  },
  {
    id: "dockhand-m3",
    glb: "dockhand-rigged",
    height: 1.72,
    tint: "#9f8d76",
    workClip: "work1",
    talkSourceIds: [
      "SJ-dock-haul-offer",
      "SJ-dock-haul-lift",
      "SJ-dock-haul-balance",
      "SJ-dock-haul-setdown",
    ],
  },
  {
    id: "ropemaker",
    glb: "townsman-rigged",
    height: 1.73,
    tint: "#8a7a5f",
    rotationY: Math.PI / 2,
    workClip: "work2",
    talkSourceIds: ["SJ-ropewalk-offer", "SJ-ropewalk-hook", "SJ-ropewalk-close"],
  },
];

/** The imported dock barrel's staging behavior (generic CarriedStagePropRig). */
export const DOCK_BARREL_STAGING = {
  glbKey: "barrel-group",
  size: [0.9, 1.0, 0.9] as const,
  carryForwardM: 0.45,
  carryLiftM: 0.5,
  carryStages: ["CARRYING", "BALANCING"] as const,
  restStage: "READY_HANDOFF" as const,
  restPosition: DOCK_ANCHORS.deck,
  activityId: OPTIONAL_ACTIVITY_IDS.DOCK_HAUL,
} as const;

export interface Day1FigureFrame {
  id: Day1FigureDefinition["id"];
  kind: "THREAD_FIGURE" | "DIRECTED_NPC";
  /** null hides the figure and retires its actor-registry entry. */
  position: readonly [number, number, number] | null;
}

export interface Day1CandidateFrame {
  id: string;
  kind: InteractionKind;
  label: string;
  priority: InteractionPriority;
  spaceId: string;
  position: readonly [number, number, number];
  radius: number;
  facingDot: number;
  losRequired: boolean;
  /** Handed to the engine: begin(sourceId) resolves through the registry. */
  sourceId: string;
}

export interface Day1ExchangeFrame {
  figures: Day1FigureFrame[];
  candidates: Day1CandidateFrame[];
}

const dockSourceIdForStage = (
  stage: RuntimeView["field"]["activities"][typeof OPTIONAL_ACTIVITY_IDS.DOCK_HAUL]["stage"],
) =>
  stage === "ACCEPTED"
    ? ("SJ-dock-haul-lift" as const)
    : stage === "CARRYING" || stage === "BALANCING"
      ? ("SJ-dock-haul-balance" as const)
      : stage === "READY_HANDOFF"
        ? ("SJ-dock-haul-setdown" as const)
        : ("SJ-dock-haul-offer" as const);

const ropewalkSourceIdForStage = (
  stage: RuntimeView["field"]["activities"][typeof OPTIONAL_ACTIVITY_IDS.ROPEWALK]["stage"],
) =>
  stage === "ACCEPTED"
    ? ("SJ-ropewalk-hook" as const)
    : stage === "READY_HANDOFF"
      ? ("SJ-ropewalk-close" as const)
      : ("SJ-ropewalk-offer" as const);

/**
 * Per-frame figure placements + interaction candidates for the Day-1 exchange
 * cast. Pure data; the director publishes/upserts it generically.
 */
export function day1ExchangeFrame(
  view: RuntimeView,
  spaceId: string,
): Day1ExchangeFrame {
  const figures: Day1FigureFrame[] = [];
  const candidates: Day1CandidateFrame[] = [];

  const nedThread = view.field.threads[THREAD_IDS.NED];
  const nedIntroduced = nedThread.status !== "UNMET";
  const nedWindowOpen = view.objectives.REPORT_TO_MERCER === "COMPLETED";
  const nedPosition =
    spaceId === "MERCER_PRESS" && (nedIntroduced || nedWindowOpen)
      ? interiorPoint("MERCER_PRESS", [...THREAD_FIGURES.NED.interiorPosition])
      : spaceId === "EXTERIOR" && (nedIntroduced || nedWindowOpen)
        ? THREAD_FIGURES.NED.exteriorPosition
        : null;
  figures.push({ id: "ned", kind: "THREAD_FIGURE", position: nedPosition });
  if (nedPosition) {
    candidates.push({
      id: "THREAD:NED",
      kind: "THREAD",
      label: "Talk to Ned",
      priority: INTERACTION_PRIORITIES.SIDE_JOB_THREAD,
      spaceId,
      position: nedPosition,
      radius: 2.2,
      facingDot: -0.1,
      losRequired: true,
      sourceId: "THR-ned",
    });
  }

  figures.push({
    id: "sarah",
    kind: "THREAD_FIGURE",
    position:
      spaceId === "EXTERIOR" ? THREAD_FIGURES.SARAH.exteriorPosition : null,
  });
  if (spaceId === "EXTERIOR") {
    candidates.push({
      id: "THREAD:SARAH",
      kind: "THREAD",
      label: "Talk to Goodwife Sarah",
      priority: INTERACTION_PRIORITIES.SIDE_JOB_THREAD,
      spaceId: "EXTERIOR",
      position: THREAD_FIGURES.SARAH.interactionPosition,
      radius: 2.35,
      facingDot: -0.15,
      losRequired: true,
      sourceId: "THR-sarah",
    });
  }

  const dockActivity = view.field.activities[OPTIONAL_ACTIVITY_IDS.DOCK_HAUL];
  const dockActive =
    spaceId === "EXTERIOR" && dockActivity.stage !== "COMPLETED";
  figures.push({
    id: "dockhand-m3",
    kind: "DIRECTED_NPC",
    position: dockActive ? DOCK_ANCHORS.dockhand : null,
  });
  if (dockActive) {
    const dockSourceId = dockSourceIdForStage(dockActivity.stage);
    const dock =
      dockSourceId === "SJ-dock-haul-offer"
        ? dockOfferExchange()
        : dockStageExchange(dockSourceId);
    candidates.push({
      id: `SIDE_JOB:DOCK:${dockActivity.stage}`,
      kind: "SIDE_JOB",
      label:
        dockActivity.stage === "AVAILABLE" || dockActivity.stage === "DORMANT"
          ? "Talk to the dockhand"
          : dock.choices[0]!.label,
      priority: INTERACTION_PRIORITIES.SIDE_JOB_THREAD,
      spaceId: "EXTERIOR",
      position: dock.position,
      radius: 2.5,
      facingDot: -0.15,
      losRequired: true,
      sourceId: dockSourceId,
    });
  }

  const tavern = view.field.activities[OPTIONAL_ACTIVITY_IDS.TAVERN_NOTE];
  if (
    spaceId === "EXPLORE_tavern" &&
    tavern.stage === "ACCEPTED" &&
    view.field.carriedObjectIds.includes("TAVERN_NOTE")
  ) {
    candidates.push({
      id: "SIDE_JOB:TAVERN_NOTE:HANDOFF",
      kind: "SIDE_JOB",
      label: "Hand the note to the keeper",
      priority: INTERACTION_PRIORITIES.SIDE_JOB_THREAD,
      spaceId: "EXPLORE_tavern",
      position: keeperAnchor(),
      radius: 2.3,
      facingDot: -0.1,
      losRequired: true,
      sourceId: "SJ-tavern-note-handoff",
    });
  }

  // Ropewalk trades job: the occupant works the rig; the staged verb moves
  // down the hall (rig -> far hook -> back to the rig).
  const ropewalk = view.field.activities[OPTIONAL_ACTIVITY_IDS.ROPEWALK];
  const inRopewalk = spaceId === "EXPLORE_ropewalk";
  figures.push({
    id: "ropemaker",
    kind: "DIRECTED_NPC",
    position: inRopewalk
      ? interiorPoint("EXPLORE_ropewalk", [...ROPEWALK_ANCHORS.ropemakerLocal])
      : null,
  });
  if (inRopewalk && ropewalk.stage !== "COMPLETED") {
    const ropewalkSourceId = ropewalkSourceIdForStage(ropewalk.stage);
    const job = ropewalkExchange(ropewalkSourceId);
    candidates.push({
      id: `SIDE_JOB:ROPEWALK:${ropewalk.stage}`,
      kind: "SIDE_JOB",
      label:
        ropewalk.stage === "AVAILABLE" || ropewalk.stage === "DORMANT"
          ? "Talk to the ropemaker"
          : job.choices[0]!.label,
      priority: INTERACTION_PRIORITIES.SIDE_JOB_THREAD,
      spaceId: "EXPLORE_ropewalk",
      position: job.position,
      radius: 2.4,
      facingDot: -0.15,
      losRequired: true,
      sourceId: ropewalkSourceId,
    });
  }

  return { figures, candidates };
}
