import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  HEAT_BANDS,
  MICRO_CONCEPT_IDS,
  OPTIONAL_ACTIVITY_IDS,
  standingDeltaForCause,
  THREAD_IDS,
  type FieldCommittedEvent,
  type ReactiveCompletionEffects,
  type RuntimeView,
} from "@pa/contracts";
import { FittedGlb, RiggedCharacter } from "./Character.js";
import type { PlayerApi } from "./Player.js";
import {
  actorRoutePose,
  type NamedActorId,
} from "./actorRoutes.js";
import {
  INTERACTION_PRIORITIES,
  type InteractionRegistry,
} from "./interactionRegistry.js";
import { interiorPoint } from "./interiorManifest.js";
import {
  effectChips,
  MICRO_LABELS,
  REACTIVE_NAMED_CAST,
  SIDE_JOB_ANCHORS,
  THREAD_FIGURES,
  type ReactiveActorDefinition,
} from "./reactiveManifest.js";
import { useWorldServices } from "./WorldServicesContext.js";
import { clampedPanelPosition } from "./panelPlacement.js";

interface ExchangeChoice {
  id: string;
  label: string;
  reply: string;
  effects: Omit<ReactiveCompletionEffects, "interactionId" | "sourceId" | "outcomeId">;
}

interface Exchange {
  sourceId: string;
  title: string;
  line: string;
  position: readonly [number, number, number];
  choices: readonly ExchangeChoice[];
}

function lowerHeat(band: RuntimeView["field"]["heat"]["band"]) {
  const index = HEAT_BANDS.indexOf(band);
  return HEAT_BANDS[Math.max(0, index - 1)]!;
}

function namedExchange(
  actor: ReactiveActorDefinition,
  view: RuntimeView,
  position: readonly [number, number, number],
): Exchange {
  const followup = view.openResponse.npcFollowups.find(
    (node) => node.npcId === actor.id,
  );
  if (followup) {
    return {
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
    };
  }
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
      return {
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
      };
    }
    case "thomas": {
      const note = view.field.activities[OPTIONAL_ACTIVITY_IDS.TAVERN_NOTE];
      const noteEligible =
        note.stage === "AVAILABLE" &&
        view.objectives.THOMAS_CIRCULAR === "COMPLETED";
      return {
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
      };
    }
    case "pike":
      return {
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
      };
    case "clarke":
      return {
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
      };
    case "rider":
      return {
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
      };
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
    return {
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
    };
  }
  if (fetched || encouraged) {
    return {
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
    };
  }
  return {
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
  };
}

function sarahExchange(
  view: RuntimeView,
  position: readonly [number, number, number],
): Exchange {
  const followup = view.openResponse.npcFollowups.find(
    (node) => node.npcId === "sarah",
  );
  if (followup) {
    return {
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
    };
  }
  return {
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
  };
}

function dockExchange(
  stage: RuntimeView["field"]["activities"][typeof OPTIONAL_ACTIVITY_IDS.DOCK_HAUL]["stage"],
  position: readonly [number, number, number],
): Exchange {
  if (stage === "AVAILABLE" || stage === "DORMANT") {
    return {
      sourceId: "SJ-dock-haul-offer",
      title: "Wharf dockhand",
      line: "Tide's turning and this barrel's got to be aboard. Lend a back?",
      position,
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
    };
  }
  const data: Record<string, { sourceId: string; title: string; line: string; label: string; reply: string; effects: ExchangeChoice["effects"] }> = {
    ACCEPTED: {
      sourceId: "SJ-dock-haul-lift",
      title: "Dock haul // Load",
      line: "The barrel is heavy but sound.",
      label: "Lift the barrel",
      reply: "You settle its weight and start toward the ship.",
      effects: {
        activities: [{
          activityId: OPTIONAL_ACTIVITY_IDS.DOCK_HAUL,
          stage: "CARRYING",
          breadcrumb: "Carry the barrel to the gangplank.",
        }],
        custody: [{ objectId: "DOCK_BARREL", custody: "PLAYER", condition: "INTACT", concealment: "EXPOSED" }],
      },
    },
    CARRYING: {
      sourceId: "SJ-dock-haul-balance",
      title: "Dock haul // Balance",
      line: "The gangplank shifts under the load.",
      label: "Balance and cross",
      reply: "Slow feet keep the barrel centered over the narrow planks.",
      effects: {
        activities: [{
          activityId: OPTIONAL_ACTIVITY_IDS.DOCK_HAUL,
          stage: "READY_HANDOFF",
          breadcrumb: "Set the barrel down on the ship's deck.",
        }],
      },
    },
    READY_HANDOFF: {
      sourceId: "SJ-dock-haul-setdown",
      title: "Dock haul // Set down",
      line: "The deck crew clears a place beside the cargo.",
      label: "Set down the barrel",
      reply: "The barrel is aboard before the tide turns.",
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
  const selected = data[stage] ?? data.CARRYING!;
  return {
    sourceId: selected.sourceId,
    title: selected.title,
    line: selected.line,
    position,
    choices: [
      {
        id: stage,
        label: selected.label,
        reply: selected.reply,
        effects: selected.effects,
      },
      { id: "PAUSE", label: "Set it safely and pause", reply: "The work waits without blocking the street.", effects: {} },
    ],
  };
}

// The ropewalk trades job — the slice's occupational-work template
// (Activity-Expansion family A). One occupant, three staged verbs the
// length of the longest room in Boston: take the strand, hook it at the far
// end, walk the lay back and close it. Teaching payload: port-town economics
// (PORT_TOWN_BOSTON) delivered by doing the harbor's work, not reading it.
function ropewalkExchange(
  stage: RuntimeView["field"]["activities"][typeof OPTIONAL_ACTIVITY_IDS.ROPEWALK]["stage"],
  position: readonly [number, number, number],
): Exchange {
  const data: Partial<Record<typeof stage, {
    sourceId: string;
    title: string;
    line: string;
    label: string;
    reply: string;
    effects: ExchangeChoice["effects"];
  }>> = {
    AVAILABLE: {
      sourceId: "SJ-ropewalk-offer",
      title: "The ropemaker",
      line: "Cordage for half the harbor is laid on this floor. Trade slows, rope slows — feel it yourself if you like.",
      label: "Take the strand's tail",
      reply: "Keep it off the floor and walk it to the far hook. The whole length, mind.",
      effects: {
        activities: [{
          activityId: OPTIONAL_ACTIVITY_IDS.ROPEWALK,
          stage: "ACCEPTED",
          breadcrumb: "Carry the strand the length of the ropewalk to the far hook.",
        }],
      },
    },
    ACCEPTED: {
      sourceId: "SJ-ropewalk-hook",
      title: "The far hook",
      line: "The strand runs the whole hall behind you.",
      label: "Loop the strand on the hook",
      reply: "It holds. Now walk the lay back — watch the twist as you go.",
      effects: {
        activities: [{
          activityId: OPTIONAL_ACTIVITY_IDS.ROPEWALK,
          stage: "READY_HANDOFF",
          breadcrumb: "Walk the lay back and close it with the ropemaker at the rig.",
        }],
      },
    },
    READY_HANDOFF: {
      sourceId: "SJ-ropewalk-close",
      title: "Close the lay",
      line: "The ropemaker steadies the rig as you come back down the walk.",
      label: "Close the lay at the rig",
      reply: "Good rope. Every fathom of it serves a ship — and when the ships sit idle, this floor goes quiet and wages go with it. Now you've felt the length of the harbor's living.",
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
  const selected = data[stage] ?? data.AVAILABLE!;
  return {
    sourceId: selected.sourceId,
    title: selected.title,
    line: selected.line,
    position,
    choices: [
      {
        id: stage,
        label: selected.label,
        reply: selected.reply,
        effects: selected.effects,
      },
      { id: "PAUSE", label: "Step back for now", reply: "The walk keeps. Come back to it.", effects: {} },
    ],
  };
}

function keeperExchange(position: readonly [number, number, number]): Exchange {
  return {
    sourceId: "SJ-tavern-note-handoff",
    title: "Keeper // Bunch of Grapes",
    line: "Thomas sent you?",
    position,
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
  };
}

function exchangeForSource(
  sourceId: string,
  view: RuntimeView,
  spaceId: string,
  tick: number,
  fieldSeed: number,
): Exchange | null {
  if (sourceId.startsWith("BOS.ACT01.DLG.")) {
    const followup = view.openResponse.npcFollowups.find(
      (node) => node.nodeId === sourceId,
    );
    if (!followup) return null;
    const definition = REACTIVE_NAMED_CAST.find(
      (actor) => actor.id === followup.npcId,
    );
    const pose = definition
      ? actorRoutePose(
          definition.id,
          spaceId,
          tick,
          fieldSeed,
        )
      : null;
    return definition && pose
      ? {
          sourceId: followup.nodeId,
          title: followup.name,
          line: followup.openingLines.join(" "),
          position: pose.position,
          choices: followup.options.map((option) => ({
            id: option.optionId,
            label: option.text,
            reply: option.reply,
            effects: {},
          })),
        }
      : null;
  }
  if (sourceId.startsWith("NPC-")) {
    const actorId = sourceId.slice(4) as NamedActorId;
    const definition = REACTIVE_NAMED_CAST.find(
      (actor) => actor.id === actorId,
    );
    const pose = definition
      ? actorRoutePose(actorId, spaceId, tick, fieldSeed)
      : null;
    return definition && pose
      ? namedExchange(definition, view, pose.position)
      : null;
  }
  if (sourceId === "THR-ned") {
    const position =
      spaceId === "MERCER_PRESS"
        ? interiorPoint(
            "MERCER_PRESS",
            [...THREAD_FIGURES.NED.interiorPosition],
          )
        : THREAD_FIGURES.NED.exteriorPosition;
    return nedExchange(view, position);
  }
  if (sourceId === "THR-sarah") {
    return sarahExchange(view, THREAD_FIGURES.SARAH.exteriorPosition);
  }
  if (sourceId.startsWith("SJ-dock-haul")) {
    const stage =
      view.field.activities[OPTIONAL_ACTIVITY_IDS.DOCK_HAUL].stage;
    const position =
      stage === "ACCEPTED"
        ? SIDE_JOB_ANCHORS[OPTIONAL_ACTIVITY_IDS.DOCK_HAUL].barrelInteract
        : stage === "CARRYING" || stage === "BALANCING"
          ? SIDE_JOB_ANCHORS[OPTIONAL_ACTIVITY_IDS.DOCK_HAUL].gangplank
          : stage === "READY_HANDOFF"
            ? SIDE_JOB_ANCHORS[OPTIONAL_ACTIVITY_IDS.DOCK_HAUL].deckInteract
            : SIDE_JOB_ANCHORS[OPTIONAL_ACTIVITY_IDS.DOCK_HAUL]
                .dockhandInteract;
    return dockExchange(stage, position);
  }
  if (sourceId === "SJ-tavern-note-handoff") {
    return keeperExchange(
      interiorPoint(
        "EXPLORE_tavern",
        [
          ...SIDE_JOB_ANCHORS[OPTIONAL_ACTIVITY_IDS.TAVERN_NOTE]
            .keeperInteractLocal,
        ],
      ),
    );
  }
  return null;
}

function ReactiveRig(props: {
  definition: ReactiveActorDefinition;
  fieldSeed: number;
  view: RuntimeView;
  registry: InteractionRegistry;
  enabled: boolean;
  offerEnabled: boolean;
  onEngage: (exchange: Exchange) => void;
}) {
  const services = useWorldServices();
  const group = useRef<THREE.Group>(null);
  const owner = useRef({});
  const renderPose = actorRoutePose(
    props.definition.id as NamedActorId,
    services.spaceId,
    services.fieldTickRef.current,
    props.fieldSeed,
  );
  useEffect(
    () => () => {
      services.actors.remove(props.definition.id);
      props.registry.clearSource(`REACTIVE:${props.definition.id}`);
    },
    [props.definition.id, props.registry, services.actors],
  );
  useFrame(() => {
    const source = `REACTIVE:${props.definition.id}`;
    props.registry.clearSource(source);
    const pose = actorRoutePose(
      props.definition.id as NamedActorId,
      services.spaceId,
      services.fieldTickRef.current,
      props.fieldSeed,
    );
    const root = group.current;
    if (!root || !pose || !props.enabled) {
      if (root) root.visible = false;
      services.actors.remove(props.definition.id);
      return;
    }
    root.visible = true;
    root.position.set(...pose.position);
    root.rotation.y = pose.yaw;
    // Reactive ownership is authoritative whenever this director is enabled.
    // Clear a retiring scripted sample from the same render tick before
    // publishing so exterior/interior swaps never expose two owners.
    services.actors.remove(props.definition.id);
    services.actors.publish({
      id: props.definition.id,
      kind: "DIRECTED_NPC",
      spaceId: services.spaceId,
      position: root.position,
      forwardVec: { x: Math.sin(pose.yaw), y: 0, z: Math.cos(pose.yaw) },
      velocity: pose.moving
        ? { x: Math.sin(pose.yaw) * 0.8, y: 0, z: Math.cos(pose.yaw) * 0.8 }
        : null,
      tick: services.fieldTickRef.current,
      owner: owner.current,
    });
    props.registry.upsert({
      id: `NPC:${props.definition.id}`,
      sourceId: source,
      kind: "NPC",
      label: props.definition.prompt,
      priority: INTERACTION_PRIORITIES.STORY_NPC,
      spaceId: services.spaceId,
      position: pose.position,
      radius: 2.15,
      facingDot: -0.1,
      losRequired: true,
      enabled: props.enabled && props.offerEnabled,
      activate: () => {
        props.onEngage(
          namedExchange(
            props.definition,
            props.view,
            pose.position,
          ),
        );
        return true;
      },
    });
  }, -2);
  return (
    <group ref={group}>
      <RiggedCharacter
        glbKey={props.definition.glb}
        height={props.definition.height}
        clip={renderPose?.moving ? "walk" : "idle"}
      />
    </group>
  );
}

function DockBarrelRig(props: {
  stage: RuntimeView["field"]["activities"][typeof OPTIONAL_ACTIVITY_IDS.DOCK_HAUL]["stage"];
  apiRef: { current: PlayerApi | null };
}) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const root = group.current;
    if (!root) return;
    if (props.stage === "CARRYING" || props.stage === "BALANCING") {
      const player = props.apiRef.current;
      if (!player) {
        root.visible = false;
        return;
      }
      root.visible = true;
      root.position.set(
        player.position.x + player.motion.facingX * 0.45,
        player.position.y + 0.5,
        player.position.z + player.motion.facingZ * 0.45,
      );
      root.rotation.y = player.facingY;
      return;
    }
    if (props.stage === "READY_HANDOFF") {
      root.visible = true;
      root.position.set(
        ...SIDE_JOB_ANCHORS[OPTIONAL_ACTIVITY_IDS.DOCK_HAUL].deck,
      );
      return;
    }
    root.visible = false;
  });
  return (
    <group ref={group} visible={false}>
      <FittedGlb
        glbKey="barrel-group"
        size={[0.9, 1.0, 0.9]}
        fallback={null}
      />
    </group>
  );
}

export function ReactiveNpcDirector(props: {
  view: RuntimeView;
  apiRef: { current: PlayerApi | null };
  interactionRegistry: InteractionRegistry;
  enabled: boolean;
  // Exchanges commit field interrupts, which the runtime accepts only during
  // FREE_ROAM. When false the cast renders but offers no exchange prompts.
  exchangesEnabled?: boolean;
  reducedMotion: boolean;
}) {
  const services = useWorldServices();
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [replyChips, setReplyChips] = useState<string[]>([]);
  const [committing, setCommitting] = useState(false);
  const interruptRef = useRef<string | null>(null);
  const resolutionTimer = useRef(0);
  const owner = useRef(new Map<string, object>());
  const figureRefs = useRef(new Map<string, THREE.Group>());
  const fieldSeed = useMemo(
    () => Number.parseInt(props.view.field.seedHex.slice(0, 8), 16) || 1765,
    [props.view.field.seedHex],
  );
  useEffect(() => {
    const interrupt = props.view.field.activeInterrupt;
    if (
      interrupt?.kind !== "REACTIVE_EXCHANGE" ||
      exchange ||
      interruptRef.current
    ) {
      return;
    }
    const resumed = exchangeForSource(
      interrupt.sourceId ?? "",
      props.view,
      services.spaceId,
      services.fieldTickRef.current,
      fieldSeed,
    );
    if (!resumed) return;
    interruptRef.current = interrupt.interruptId;
    props.apiRef.current?.setInputLocked(true);
    setExchange(resumed);
    const completed = [...props.view.field.reactiveCompletions]
      .reverse()
      .find((record) => record.sourceId === interrupt.sourceId);
    const completedChoice = completed
      ? resumed.choices.find(
          (choice) => choice.id === completed.outcomeId,
        )
      : undefined;
    if (completedChoice) {
      setReply(completedChoice.reply);
      setReplyChips(effectChips(completedChoice.effects, MICRO_LABELS));
      window.clearTimeout(resolutionTimer.current);
      resolutionTimer.current = window.setTimeout(() => {
        void (async () => {
          await services.submitFieldEvent({
            type: "FIELD_INTERRUPT_RESOLVED",
            eventId: `${interrupt.interruptId}_RESOLVED`,
            interruptId: interrupt.interruptId,
            outcome: completedChoice.id,
          });
          props.apiRef.current?.setInputLocked(false);
          props.apiRef.current?.setInteractionClip(null);
          interruptRef.current = null;
          setReply(null);
          setReplyChips([]);
          setExchange(null);
        })();
      }, props.reducedMotion ? 900 : 2_400);
    }
  }, [
    exchange,
    fieldSeed,
    props.apiRef,
    props.view,
    props.view.field.reactiveCompletions,
    props.reducedMotion,
    services,
    services.fieldTickRef,
    services.spaceId,
  ]);
  const begin = async (next: Exchange) => {
    if (!props.enabled || props.exchangesEnabled === false || exchange || committing) return;
    const ordinal = props.view.field.interactionOrdinal + 1;
    // Suffixed with the committed-event count so re-engagement after an
    // Escape-abandon never reuses the abandoned attempt's eventId.
    const interruptId = `M3_${next.sourceId}_${ordinal}_${services.committedEventCount()}`;
    setCommitting(true);
    const ok = await services.submitFieldEvent({
      type: "FIELD_INTERRUPT_STARTED",
      eventId: `${interruptId}_START`,
      interruptId,
      interruptKind: "REACTIVE_EXCHANGE",
      sourceId: next.sourceId,
    });
    setCommitting(false);
    if (!ok) return;
    interruptRef.current = interruptId;
    props.apiRef.current?.setInputLocked(true);
    props.apiRef.current?.setInteractionClip("talk");
    setExchange(next);
  };

  const finish = async (choice: ExchangeChoice) => {
    const active = exchange;
    const interruptId = interruptRef.current;
    if (!active || !interruptId || committing) return;
    setCommitting(true);
    setReply(choice.reply);
    setReplyChips(effectChips(choice.effects, MICRO_LABELS));
    const actionClip =
      active.sourceId.includes("handoff") || choice.id === "SET_DOWN"
        ? "handoff"
        : active.sourceId.includes("dock-haul")
          ? "carry"
          : active.sourceId.startsWith("SJ-ropewalk") && choice.id !== "PAUSE"
            ? "ropePull"
            : active.sourceId === "THR-ned" && choice.id === "FETCH"
              ? "work2"
              : active.sourceId === "THR-sarah" && choice.id !== "DECLINE"
                ? "work1"
                : "talk";
    props.apiRef.current?.setInteractionClip(actionClip);
    const completion: ReactiveCompletionEffects = {
      interactionId: `${active.sourceId}:${props.view.field.interactionOrdinal + 1}`,
      sourceId: active.sourceId,
      outcomeId: choice.id,
      ...choice.effects,
    };
    const complete: FieldCommittedEvent =
      active.sourceId.startsWith("NPC-") ||
      active.sourceId.startsWith("BOS.ACT01.DLG.")
      ? {
          type: "FIELD_REACTIVE_OUTCOME_SELECTED",
          eventId: `${interruptId}_COMPLETE_${choice.id}`,
          interruptId,
          interactionId: completion.interactionId,
          sourceId: completion.sourceId,
          outcomeId: completion.outcomeId,
        }
      : {
          type: "FIELD_REACTIVE_COMPLETED",
          eventId: `${interruptId}_COMPLETE_${choice.id}`,
          interruptId,
          completion,
        };
    const completed = await services.submitFieldEvent(complete);
    if (completed) {
      setCommitting(false);
      window.clearTimeout(resolutionTimer.current);
      resolutionTimer.current = window.setTimeout(() => {
        void (async () => {
          await services.submitFieldEvent({
            type: "FIELD_INTERRUPT_RESOLVED",
            eventId: `${interruptId}_RESOLVED`,
            interruptId,
            outcome: choice.id,
          });
          props.apiRef.current?.setInputLocked(false);
          props.apiRef.current?.setInteractionClip(null);
          interruptRef.current = null;
          setReply(null);
          setReplyChips([]);
          setExchange(null);
        })();
      }, props.reducedMotion ? 900 : 2400);
      return;
    }
    props.apiRef.current?.setInputLocked(false);
    setCommitting(false);
    interruptRef.current = null;
    props.apiRef.current?.setInteractionClip(null);
    setReply(null);
    setReplyChips([]);
    setExchange(null);
  };

  // Universal Escape dismissal (feel-audit-1 P0-2): abandon the exchange
  // without committing an outcome. Input unlocks, the suspended plan
  // restores, and no effect is recorded.
  const dismiss = async () => {
    const interruptId = interruptRef.current;
    if (!exchange || !interruptId || committing || reply) return;
    setCommitting(true);
    const resolved = await services.submitFieldEvent({
      type: "FIELD_INTERRUPT_RESOLVED",
      eventId: `${interruptId}_RESOLVED`,
      interruptId,
      outcome: "ABANDONED",
    });
    setCommitting(false);
    if (!resolved) return;
    props.apiRef.current?.setInputLocked(false);
    props.apiRef.current?.setInteractionClip(null);
    interruptRef.current = null;
    setReply(null);
    setReplyChips([]);
    setExchange(null);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!exchange || committing || reply) return;
      if (/^[123]$/.test(event.key)) {
        const choice = exchange.choices[Number(event.key) - 1];
        if (choice) void finish(choice);
      } else if (event.key === "Escape") {
        event.preventDefault();
        void dismiss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(
    () => () => {
      window.clearTimeout(resolutionTimer.current);
      props.apiRef.current?.setInputLocked(false);
      props.apiRef.current?.setInteractionClip(null);
      props.interactionRegistry.clearSource("REACTIVE_FIGURES");
      for (const id of ["ned", "sarah", "dockhand-m3"]) {
        services.actors.remove(id);
      }
    },
    [props.apiRef, props.interactionRegistry, services.actors],
  );

  useFrame(() => {
    props.interactionRegistry.clearSource("REACTIVE_FIGURES");
    const tick = services.fieldTickRef.current;
    const canOfferInteraction =
      !exchange && !committing && props.exchangesEnabled !== false;
    const publishFigure = (
      id: string,
      group: THREE.Group | undefined,
      position: readonly [number, number, number],
      kind: "THREAD_FIGURE" | "DIRECTED_NPC",
    ) => {
      if (!group) return;
      group.visible = props.enabled;
      group.position.set(...position);
      if (!props.enabled) {
        services.actors.remove(id);
        return;
      }
      let token = owner.current.get(id);
      if (!token) {
        token = {};
        owner.current.set(id, token);
      }
      services.actors.publish({
        id,
        kind,
        spaceId: services.spaceId,
        position: group.position,
        forwardVec: { x: 0, y: 0, z: 1 },
        tick,
        owner: token,
      });
    };

    if (!props.enabled) return;
    const nedThread = props.view.field.threads[THREAD_IDS.NED];
    const nedIntroduced = nedThread.status !== "UNMET";
    const nedWindowOpen =
      props.view.objectives.REPORT_TO_MERCER === "COMPLETED";
    const nedPosition =
      services.spaceId === "MERCER_PRESS" &&
      (nedIntroduced || nedWindowOpen)
        ? interiorPoint(
            "MERCER_PRESS",
            [...THREAD_FIGURES.NED.interiorPosition],
          )
        : services.spaceId === "EXTERIOR" && (nedIntroduced || nedWindowOpen)
          ? THREAD_FIGURES.NED.exteriorPosition
          : null;
    const ned = figureRefs.current.get("ned");
    if (nedPosition) {
      publishFigure("ned", ned, nedPosition, "THREAD_FIGURE");
      if (canOfferInteraction) {
      props.interactionRegistry.upsert({
        id: "THREAD:NED",
        sourceId: "REACTIVE_FIGURES",
        kind: "THREAD",
        label: "Talk to Ned",
        priority: INTERACTION_PRIORITIES.SIDE_JOB_THREAD,
        spaceId: services.spaceId,
        position: nedPosition,
        radius: 2.2,
        facingDot: -0.1,
        losRequired: true,
        enabled: true,
        activate: () => {
          void begin(nedExchange(props.view, nedPosition));
          return true;
        },
      });
      }
    } else if (ned) {
      ned.visible = false;
      services.actors.remove("ned");
    }

    const sarah = figureRefs.current.get("sarah");
    if (services.spaceId === "EXTERIOR") {
      const position = THREAD_FIGURES.SARAH.exteriorPosition;
      const interactionPosition = THREAD_FIGURES.SARAH.interactionPosition;
      publishFigure("sarah", sarah, position, "THREAD_FIGURE");
      if (canOfferInteraction) {
      props.interactionRegistry.upsert({
        id: "THREAD:SARAH",
        sourceId: "REACTIVE_FIGURES",
        kind: "THREAD",
        label: "Talk to Goodwife Sarah",
        priority: INTERACTION_PRIORITIES.SIDE_JOB_THREAD,
        spaceId: "EXTERIOR",
        position: interactionPosition,
        radius: 2.35,
        facingDot: -0.15,
        losRequired: true,
        enabled: true,
        activate: () => {
          void begin(sarahExchange(props.view, position));
          return true;
        },
      });
      }
    } else if (sarah) {
      sarah.visible = false;
      services.actors.remove("sarah");
    }

    const dockhand = figureRefs.current.get("dockhand-m3");
    const dockActivity =
      props.view.field.activities[OPTIONAL_ACTIVITY_IDS.DOCK_HAUL];
    if (
      services.spaceId === "EXTERIOR" &&
      dockActivity.stage !== "COMPLETED"
    ) {
      const stagePosition =
        dockActivity.stage === "ACCEPTED"
          ? SIDE_JOB_ANCHORS[OPTIONAL_ACTIVITY_IDS.DOCK_HAUL].barrelInteract
          : dockActivity.stage === "CARRYING" ||
              dockActivity.stage === "BALANCING"
            ? SIDE_JOB_ANCHORS[OPTIONAL_ACTIVITY_IDS.DOCK_HAUL].gangplank
            : dockActivity.stage === "READY_HANDOFF"
              ? SIDE_JOB_ANCHORS[OPTIONAL_ACTIVITY_IDS.DOCK_HAUL].deckInteract
              : SIDE_JOB_ANCHORS[OPTIONAL_ACTIVITY_IDS.DOCK_HAUL]
                  .dockhandInteract;
      publishFigure(
        "dockhand-m3",
        dockhand,
        SIDE_JOB_ANCHORS[OPTIONAL_ACTIVITY_IDS.DOCK_HAUL].dockhand,
        "DIRECTED_NPC",
      );
      const dock = dockExchange(dockActivity.stage, stagePosition);
      if (canOfferInteraction) {
      props.interactionRegistry.upsert({
        id: `SIDE_JOB:DOCK:${dockActivity.stage}`,
        sourceId: "REACTIVE_FIGURES",
        kind: "SIDE_JOB",
        label:
          dockActivity.stage === "AVAILABLE" || dockActivity.stage === "DORMANT"
            ? "Talk to the dockhand"
            : dock.choices[0]!.label,
        priority: INTERACTION_PRIORITIES.SIDE_JOB_THREAD,
        spaceId: "EXTERIOR",
        position: stagePosition,
        radius: 2.5,
        facingDot: -0.15,
        losRequired: true,
        enabled: true,
        activate: () => {
          void begin(dock);
          return true;
        },
      });
      }
    } else if (dockhand) {
      dockhand.visible = false;
      services.actors.remove("dockhand-m3");
    }

    const tavern =
      props.view.field.activities[OPTIONAL_ACTIVITY_IDS.TAVERN_NOTE];
    if (
      services.spaceId === "EXPLORE_tavern" &&
      tavern.stage === "ACCEPTED" &&
      props.view.field.carriedObjectIds.includes("TAVERN_NOTE")
    ) {
      const position = interiorPoint(
        "EXPLORE_tavern",
        [
          ...SIDE_JOB_ANCHORS[OPTIONAL_ACTIVITY_IDS.TAVERN_NOTE]
            .keeperInteractLocal,
        ],
      );
      if (canOfferInteraction) {
      props.interactionRegistry.upsert({
        id: "SIDE_JOB:TAVERN_NOTE:HANDOFF",
        sourceId: "REACTIVE_FIGURES",
        kind: "SIDE_JOB",
        label: "Hand the note to the keeper",
        priority: INTERACTION_PRIORITIES.SIDE_JOB_THREAD,
        spaceId: "EXPLORE_tavern",
        position,
        radius: 2.3,
        facingDot: -0.1,
        losRequired: true,
        enabled: true,
        activate: () => {
          void begin(keeperExchange(position));
          return true;
        },
      });
      }
    }

    // Ropewalk trades job: the occupant works the rig; the staged verb moves
    // down the hall (rig -> far hook -> back to the rig).
    const ropemaker = figureRefs.current.get("ropemaker");
    const ropewalk =
      props.view.field.activities[OPTIONAL_ACTIVITY_IDS.ROPEWALK];
    if (services.spaceId === "EXPLORE_ropewalk") {
      const anchors = SIDE_JOB_ANCHORS[OPTIONAL_ACTIVITY_IDS.ROPEWALK];
      const ropemakerPosition = interiorPoint("EXPLORE_ropewalk", [
        ...anchors.ropemakerLocal,
      ]);
      publishFigure("ropemaker", ropemaker, ropemakerPosition, "DIRECTED_NPC");
      if (ropewalk.stage !== "COMPLETED") {
        const stageLocal =
          ropewalk.stage === "ACCEPTED"
            ? anchors.farHookInteractLocal
            : ropewalk.stage === "READY_HANDOFF"
              ? anchors.rigCloseInteractLocal
              : anchors.ropemakerInteractLocal;
        const stagePosition = interiorPoint("EXPLORE_ropewalk", [
          ...stageLocal,
        ]);
        const job = ropewalkExchange(ropewalk.stage, stagePosition);
        if (canOfferInteraction) {
          props.interactionRegistry.upsert({
            id: `SIDE_JOB:ROPEWALK:${ropewalk.stage}`,
            sourceId: "REACTIVE_FIGURES",
            kind: "SIDE_JOB",
            label:
              ropewalk.stage === "AVAILABLE" || ropewalk.stage === "DORMANT"
                ? "Talk to the ropemaker"
                : job.choices[0]!.label,
            priority: INTERACTION_PRIORITIES.SIDE_JOB_THREAD,
            spaceId: "EXPLORE_ropewalk",
            position: stagePosition,
            radius: 2.4,
            facingDot: -0.15,
            losRequired: true,
            enabled: true,
            activate: () => {
              void begin(job);
              return true;
            },
          });
        }
      }
    } else if (ropemaker) {
      ropemaker.visible = false;
      services.actors.remove("ropemaker");
    }
  }, -2);

  return (
    <group>
      {REACTIVE_NAMED_CAST.map((definition) => (
        <ReactiveRig
          key={definition.id}
          definition={definition}
          fieldSeed={fieldSeed}
          view={props.view}
          registry={props.interactionRegistry}
          enabled={props.enabled && !exchange}
          offerEnabled={props.exchangesEnabled !== false && !exchange}
          onEngage={(next) => void begin(next)}
        />
      ))}
      <group
        ref={(node) => {
          if (node) figureRefs.current.set("ned", node);
        }}
      >
        <RiggedCharacter
          glbKey={THREAD_FIGURES.NED.glb}
          height={THREAD_FIGURES.NED.height}
          clip={exchange?.sourceId === "THR-ned" ? "talk" : "work2"}
          tint={THREAD_FIGURES.NED.tint}
        />
      </group>
      <DockBarrelRig
        stage={
          props.view.field.activities[OPTIONAL_ACTIVITY_IDS.DOCK_HAUL].stage
        }
        apiRef={props.apiRef}
      />
      <group
        ref={(node) => {
          if (node) figureRefs.current.set("sarah", node);
        }}
      >
        <RiggedCharacter
          glbKey={THREAD_FIGURES.SARAH.glb}
          height={THREAD_FIGURES.SARAH.height}
          clip={exchange?.sourceId === "THR-sarah" ? "talk" : "work1"}
          tint={THREAD_FIGURES.SARAH.tint}
        />
      </group>
      <group
        ref={(node) => {
          if (node) figureRefs.current.set("dockhand-m3", node);
        }}
      >
        <RiggedCharacter
          glbKey="dockhand-rigged"
          height={1.72}
          clip={exchange?.sourceId.startsWith("SJ-dock-haul") ? "talk" : "work1"}
          tint="#9f8d76"
        />
      </group>
      <group
        ref={(node) => {
          if (node) figureRefs.current.set("ropemaker", node);
        }}
        rotation={[0, Math.PI / 2, 0]}
      >
        <RiggedCharacter
          glbKey="townsman-rigged"
          height={1.73}
          clip={exchange?.sourceId.startsWith("SJ-ropewalk") ? "talk" : "work2"}
          tint="#8a7a5f"
        />
      </group>
      {exchange && (
        <Html
          position={[exchange.position[0], exchange.position[1] + 2, exchange.position[2]]}
          center
          occlude={false}
          zIndexRange={[20, 10]}
          calculatePosition={clampedPanelPosition}
        >
          <section className="reactive-exchange" role="dialog" aria-label={exchange.title}>
            <header>{exchange.title}</header>
            <p>{reply ?? exchange.line}</p>
            {reply && replyChips.length > 0 && (
              <div className="exchange-effect-chips" role="status">
                {replyChips.map((chip) => (
                  <span key={chip}>{chip}</span>
                ))}
              </div>
            )}
            {!reply && (
              <div className="reactive-exchange-choices">
                {exchange.choices.slice(0, 3).map((choice, index) => (
                  <button
                    key={choice.id}
                    type="button"
                    disabled={committing}
                    onClick={() => void finish(choice)}
                  >
                    <kbd>{index + 1}</kbd> {choice.label}
                  </button>
                ))}
              </div>
            )}
          </section>
        </Html>
      )}
    </group>
  );
}
