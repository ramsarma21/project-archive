import { Html, useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  MICRO_CONCEPT_IDS,
  OPTIONAL_ACTIVITY_IDS,
  standingDeltaForCause,
  type OptionalActivityId,
  type ReactiveCompletionEffects,
  type RuntimeView,
} from "@pa/contracts";
import {
  FittedGlb,
  ImportedTexturedProp,
  RiggedCharacter,
} from "./Character.js";
import type { PlayerApi } from "./Player.js";
import {
  INTERACTION_PRIORITIES,
  type InteractionRegistry,
} from "./interactionRegistry.js";
import { interiorPoint } from "./interiorManifest.js";
import {
  M4_ACTIVITY_ANCHORS,
  M4_EAVESDROPS,
  M4_FLAVOR,
  M4_KNOWLEDGE,
  type EavesdropScene,
  type KnowledgePlacement,
} from "./m4ContentManifest.js";
import { effectChips, MICRO_LABELS } from "./reactiveManifest.js";
import { useWorldServices } from "./WorldServicesContext.js";
import { dispatchPresentationNotice } from "../presenter/noticeArbiter.js";
import { clampedPanelPosition } from "./panelPlacement.js";

interface ContentPrompt {
  sourceId: string;
  title: string;
  text: string;
  action: string;
  position: readonly [number, number, number];
  effects: Omit<
    ReactiveCompletionEffects,
    "interactionId" | "sourceId" | "outcomeId"
  >;
  outcomeId: string;
  clip?: string;
  afterCommit?: () => void | Promise<void>;
}

function worldPosition(
  placement: KnowledgePlacement,
): readonly [number, number, number] {
  return placement.spaceId === "EXTERIOR"
    ? placement.position
    : interiorPoint(placement.spaceId, [...placement.position]);
}

function KnowledgeVisual({ placement }: { placement: KnowledgePlacement }) {
  const texture = useTexture(`/world/posters/${placement.texture}.png`);
  texture.colorSpace = THREE.SRGBColorSpace;
  const position = worldPosition(placement);
  if (placement.carrier === "PAPER") {
    return (
      <group position={position} rotation={[0, placement.rotY, 0]}>
        <group rotation={[Math.PI / 2, 0, 0]}>
          <ImportedTexturedProp
            texture={texture}
            size={[...placement.size]}
          />
        </group>
      </group>
    );
  }
  if (placement.carrier === "HANGING_SIGN") {
    return (
      <group position={position} rotation={[0, placement.rotY, 0]}>
        <ImportedTexturedProp
          glbKey="printshop-hanging-sign"
          texture={texture}
          size={[...placement.size]}
        />
      </group>
    );
  }
  return (
    <group position={position} rotation={[0, placement.rotY, 0]}>
      <FittedGlb
        glbKey="coin-paper-set"
        size={[...placement.size]}
        fallback={null}
      />
      <group position={[0, 0.08, 0.28]} rotation={[-Math.PI / 2, 0, 0]}>
        <ImportedTexturedProp
          texture={texture}
          size={[0.48, 0.15, 0.34]}
        />
      </group>
    </group>
  );
}

function Eavesdrop(props: {
  scene: EavesdropScene;
  apiRef: { current: PlayerApi | null };
  active: boolean;
  reducedMotion: boolean;
}) {
  const [line, setLine] = useState<number | null>(null);
  const lastLine = useRef<number | null>(null);
  useFrame(({ clock }) => {
    const player = props.apiRef.current;
    const near =
      props.active &&
      player &&
      Math.hypot(
        player.position.x - props.scene.position[0],
        player.position.z - props.scene.position[2],
      ) <= 5.5;
    const next = near ? (Math.floor(clock.elapsedTime / 4) % 2) : null;
    if (next !== lastLine.current) {
      lastLine.current = next;
      setLine(next);
    }
  });
  useEffect(() => {
    if (line === null) return;
    dispatchPresentationNotice({
      id: `${props.scene.id}:${line}`,
      kind: "EAVESDROP",
      speaker: props.scene.speakers[line],
      text: props.scene.lines[line]!,
      dedupeKey: `${props.scene.id}:${line}`,
      cooldownMs: 9_000,
      durationMs: props.reducedMotion ? 1_800 : 3_200,
      captions: true,
    });
  }, [line, props.reducedMotion, props.scene]);
  const skipFirst = props.scene.id === "EAV-customs";
  return (
    <group>
      {!skipFirst && (
        <group
          position={[
            props.scene.position[0] - 0.65,
            props.scene.position[1],
            props.scene.position[2],
          ]}
          rotation={[0, 1.2, 0]}
        >
          <RiggedCharacter
            glbKey={props.scene.rigs[0]}
            height={1.68}
            clip={props.reducedMotion ? "idle" : line === 0 ? "argu1" : "idle"}
            castShadow={false}
            showFallback={false}
            distanceAnimThrottle
            cullBeyondM={34}
            probeId={`${props.scene.id}:a`}
          />
        </group>
      )}
      <group
        position={[
          props.scene.position[0] + 0.65,
          props.scene.position[1],
          props.scene.position[2],
        ]}
        rotation={[0, -1.2, 0]}
      >
        <RiggedCharacter
          glbKey={props.scene.rigs[1]}
          height={1.66}
          clip={props.reducedMotion ? "idle" : line === 1 ? "talk" : "idle"}
          castShadow={false}
          showFallback={false}
          distanceAnimThrottle
          cullBeyondM={34}
          probeId={`${props.scene.id}:b`}
        />
      </group>
    </group>
  );
}

function activityAnchor(
  activityId: OptionalActivityId,
  index: number,
): readonly [number, number, number] {
  return M4_ACTIVITY_ANCHORS[activityId][index] ?? [0, -20, 0];
}

export function M4ContentDirector(props: {
  view: RuntimeView;
  apiRef: { current: PlayerApi | null };
  interactionRegistry: InteractionRegistry;
  enabled: boolean;
  // Field interrupts start only during FREE_ROAM; when false, content stays
  // visible but knowledge/side-job prompts are withheld (flavor verbs remain).
  exchangesEnabled?: boolean;
  reducedMotion: boolean;
}) {
  const services = useWorldServices();
  const [prompt, setPrompt] = useState<ContentPrompt | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [replyChips, setReplyChips] = useState<string[]>([]);
  const [committing, setCommitting] = useState(false);
  const interruptId = useRef<string | null>(null);
  const resolutionTimer = useRef(0);

  const begin = async (next: ContentPrompt) => {
    if (prompt || committing || !props.enabled || props.exchangesEnabled === false) return;
    // The committed-event-count suffix keeps re-engagement after an
    // Escape-abandon unique (the runtime rejects duplicate eventIds) while
    // staying deterministic per action history.
    const id = `M4_${next.sourceId}_${props.view.field.interactionOrdinal + 1}_${services.committedEventCount()}`;
    setCommitting(true);
    const ok = await services.submitFieldEvent({
      type: "FIELD_INTERRUPT_STARTED",
      eventId: `${id}_START`,
      interruptId: id,
      interruptKind: "REACTIVE_EXCHANGE",
      sourceId: next.sourceId,
    });
    setCommitting(false);
    if (!ok) return;
    interruptId.current = id;
    props.apiRef.current?.setInputLocked(true);
    props.apiRef.current?.setInteractionClip(next.clip ?? "search");
    setPrompt(next);
  };

  // Universal Escape dismissal (feel-audit-1 P0-2): abandon the exchange
  // without committing its outcome. The interrupt resolves (input unlocks,
  // the suspended plan restores) and no reward/learning effect is recorded —
  // the same terminal state as never having pressed the action, except the
  // FIELD_INTERRUPT_STARTED/RESOLVED pair stays in the log.
  const dismiss = async () => {
    const activeInterrupt = interruptId.current;
    if (!prompt || !activeInterrupt || committing || reply) return;
    setCommitting(true);
    const resolved = await services.submitFieldEvent({
      type: "FIELD_INTERRUPT_RESOLVED",
      eventId: `${activeInterrupt}_RESOLVED`,
      interruptId: activeInterrupt,
      outcome: "ABANDONED",
    });
    setCommitting(false);
    if (!resolved) return;
    props.apiRef.current?.setInputLocked(false);
    props.apiRef.current?.setInteractionClip(null);
    interruptId.current = null;
    setReply(null);
    setReplyChips([]);
    setPrompt(null);
  };

  const finish = async () => {
    const current = prompt;
    const activeInterrupt = interruptId.current;
    if (!current || !activeInterrupt || committing) return;
    setCommitting(true);
    setReply(current.text);
    setReplyChips(effectChips(current.effects, MICRO_LABELS));
    const completion: ReactiveCompletionEffects = {
      interactionId: `${current.sourceId}:${props.view.field.interactionOrdinal + 1}`,
      sourceId: current.sourceId,
      outcomeId: current.outcomeId,
      ...current.effects,
    };
    const completed = await services.submitFieldEvent({
      type: "FIELD_REACTIVE_COMPLETED",
      eventId: `${activeInterrupt}_COMPLETE_${current.outcomeId}`,
      interruptId: activeInterrupt,
      completion,
    });
    if (completed) {
      setCommitting(false);
      window.clearTimeout(resolutionTimer.current);
      resolutionTimer.current = window.setTimeout(() => {
        void (async () => {
          await services.submitFieldEvent({
            type: "FIELD_INTERRUPT_RESOLVED",
            eventId: `${activeInterrupt}_RESOLVED`,
            interruptId: activeInterrupt,
            outcome: current.outcomeId,
          });
          await current.afterCommit?.();
          props.apiRef.current?.setInputLocked(false);
          props.apiRef.current?.setInteractionClip(null);
          interruptId.current = null;
          setReply(null);
          setReplyChips([]);
          setPrompt(null);
        })();
      }, props.reducedMotion ? 900 : 2400);
      return;
    }
    props.apiRef.current?.setInputLocked(false);
    interruptId.current = null;
    setCommitting(false);
    props.apiRef.current?.setInteractionClip(null);
    setReply(null);
    setReplyChips([]);
    setPrompt(null);
  };

  const playFlavor = (id: "DOG" | "GULLS") => {
    const dog = id === "DOG";
    const audio = new Audio(
      dog ? "/audio/dog-bark.wav" : "/audio/gull-cry.wav",
    );
    audio.volume = 0.62;
    void audio.play().catch(() => {});
    window.dispatchEvent(
      new CustomEvent("pa:flavor", {
        detail: { id: dog ? "DOG_BARK" : "GULLS_SPOOKED" },
      }),
    );
    dispatchPresentationNotice({
      id: dog ? "flavor:dog" : "flavor:gulls",
      kind: "FLAVOR",
      text: dog
        ? "The street dog stays put, leans into your hand, and barks once."
        : "The gulls startle from the wharf with a burst of cries.",
      cooldownMs: 3_000,
      durationMs: 2_800,
      captions: true,
    });
  };

  useEffect(() => {
    const onFlavor = (raw: Event) => {
      const id = (raw as CustomEvent<{ id?: string }>).detail?.id;
      const content =
        id === "CHURCH_BELL"
          ? {
              audio: "/audio/church-bell.wav",
              text: "The meeting-house bell answers across the street.",
            }
          : id === "PUMP_SPLASH"
            ? {
                audio: "/audio/harbor-lap.wav",
                text: "The pump handle knocks; water splashes into the basin.",
              }
            : id === "BENCH_SIT"
              ? {
                  audio: null,
                  text: "You sit outside the tavern and let the street pass.",
                }
              : null;
      if (!content) return;
      if (content.audio) {
        const audio = new Audio(content.audio);
        audio.volume = 0.58;
        void audio.play().catch(() => {});
      }
      dispatchPresentationNotice({
        id: `flavor:${id}`,
        kind: "FLAVOR",
        text: content.text,
        cooldownMs: 3_000,
        durationMs: 2_800,
        captions: true,
      });
    };
    window.addEventListener("pa:flavor", onFlavor);
    return () => window.removeEventListener("pa:flavor", onFlavor);
  }, []);

  const activityPrompt = (
    activityId: OptionalActivityId,
  ): ContentPrompt | null => {
    const activity = props.view.field.activities[activityId];
    if (!activity) return null;
    if (activityId === OPTIONAL_ACTIVITY_IDS.ROOF_KID) {
      if (activity.stage === "AVAILABLE" || activity.stage === "DORMANT") {
        return {
          sourceId: "SJ-roof-kid-offer",
          title: "A worried goodwife",
          text: "My Jonah is on the painters' scaffold again. Fetch him down before he breaks his neck.",
          action: "Take the roof-kid job",
          position: activityAnchor(activityId, 0),
          outcomeId: "ACCEPT",
          clip: "talk",
          effects: {
            activities: [{ activityId, stage: "ACCEPTED", breadcrumb: "Climb the central scaffold and speak to Jonah." }],
          },
        };
      }
      if (activity.stage === "ACCEPTED") {
        return {
          sourceId: "SJ-roof-kid-reached",
          title: "Jonah on the scaffold",
          text: "I can see the whole harbor! All right—I'll take the ladder when you turn around.",
          action: "Shoo Jonah toward the ladder",
          position: activityAnchor(activityId, 1),
          outcomeId: "COMPLETED",
          clip: "talk",
          effects: {
            activities: [
              { activityId, stage: "COMPLETED", breadcrumb: "Jonah came down safely." },
              { activityId: OPTIONAL_ACTIVITY_IDS.ROOFTOP_RUN, stage: "AVAILABLE", breadcrumb: "The scaffold now marks a short roof-board challenge." },
            ],
            standing: { delta: standingDeltaForCause("ROOF_KID_COMPLETED"), causeId: "ROOF_KID_COMPLETED" },
            rumors: ["Jonah's harbor perch reveals the short scaffold and Liberty roof-board route."],
          },
        };
      }
    }
    if (activityId === OPTIONAL_ACTIVITY_IDS.CRIER) {
      const stageIndex =
        activity.stage === "AVAILABLE" || activity.stage === "DORMANT"
          ? 0
          : activity.stage === "ACCEPTED"
            ? 1
            : activity.stage === "CARRYING"
              ? 2
              : activity.stage === "BALANCING"
                ? 3
                : -1;
      if (stageIndex < 0) return null;
      if (stageIndex === 0) {
        return {
          sourceId: "SJ-crier-offer",
          title: "Town crier",
          text: "My voice is gone. Take up the cry at three street corners; the subtitles carry the words until a voiced pass is approved.",
          action: "Take up the cry",
          position: activityAnchor(activityId, 0),
          outcomeId: "ACCEPT",
          clip: "talk",
          effects: {
            activities: [{ activityId, stage: "ACCEPTED", breadcrumb: "Call the meeting at the west, center, and east street spots." }],
          },
        };
      }
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
        position: activityAnchor(activityId, stageIndex),
        outcomeId: `CALL_${stageIndex}`,
        clip: "argu1",
        effects: {
          activities: [{ activityId, stage: nextStage, breadcrumb: nextStage === "COMPLETED" ? "The full cry reached the street." : `Continue to call spot ${stageIndex + 1}.` }],
          ...(nextStage === "COMPLETED"
            ? {
                micros: [MICRO_CONCEPT_IDS.NEWS_NETWORKS],
                standing: { delta: standingDeltaForCause("CRIER_COMPLETED"), causeId: "CRIER_COMPLETED" as const },
                rumors: ["The crier's route confirms how spoken and printed news reinforce one another."],
              }
            : {}),
        },
      };
    }
    if (activityId === OPTIONAL_ACTIVITY_IDS.AGITATOR_DARE) {
      if (activity.stage === "AVAILABLE" || activity.stage === "DORMANT") {
        return {
          sourceId: "CH-agitator-dare-offer",
          title: "Agitator's dare",
          text: "Take this wrapped bundle past the two Custom House constables. The job is optional; getting checked changes the outcome, never the day's learning.",
          action: "Accept the watched crossing",
          position: activityAnchor(activityId, 0),
          outcomeId: "ACCEPT",
          clip: "talk",
          effects: {
            activities: [{ activityId, stage: "ACCEPTED", breadcrumb: "Carry the wrapped bundle to the contact beside the Custom House." }],
          },
        };
      }
      if (activity.stage === "ACCEPTED") {
        const clean =
          props.view.field.heat.band === "CALM" ||
          props.view.field.heat.band === "NOTICED";
        return {
          sourceId: "CH-agitator-dare-drop",
          title: "Custom House contact",
          text: clean
            ? "Clean crossing. The watch never laid a hand on it."
            : "They marked the route, but the message still arrives. Next time, read the gaps.",
          action: "Hand over the bundle",
          position: activityAnchor(activityId, 1),
          outcomeId: clean ? "CLEAN" : "SEEN",
          clip: "handoff",
          effects: {
            activities: [{ activityId, stage: "COMPLETED", breadcrumb: clean ? "The dare crossed unseen." : "The dare landed with watch attention." }],
            micros: [MICRO_CONCEPT_IDS.LOYAL_NINE, MICRO_CONCEPT_IDS.EFFIGY_PROTEST],
            ...(clean
              ? { standing: { delta: standingDeltaForCause("AGITATOR_DARE_COMPLETED"), causeId: "AGITATOR_DARE_COMPLETED" as const } }
              : {}),
            rumors: ["The Custom House contact points toward the short Liberty roof-board perch."],
          },
        };
      }
    }
    if (activityId === OPTIONAL_ACTIVITY_IDS.ROOFTOP_RUN) {
      if (activity.stage === "AVAILABLE") {
        return {
          sourceId: "CH-rooftop-run-start",
          title: "Short roof-board run",
          text: "Use the scaffold board and the Liberty perch. This is a bounded two-vantage challenge, not a continuous citywide roof course.",
          action: "Start the short roof run",
          position: activityAnchor(activityId, 0),
          outcomeId: "START",
          effects: {
            activities: [{ activityId, stage: "ACCEPTED", breadcrumb: "Reach the imported Liberty roof board and stay above street level." }],
          },
        };
      }
      if (activity.stage === "ACCEPTED") {
        return {
          sourceId: "CH-rooftop-run-goal",
          title: "Liberty roof perch",
          text: "The short route is complete. The event pocket and harbor approaches are visible from here.",
          action: "Claim the vantage",
          position: activityAnchor(activityId, 1),
          outcomeId: "COMPLETED",
          effects: {
            activities: [{ activityId, stage: "COMPLETED", breadcrumb: "The short scaffold-to-Liberty vantage challenge is complete." }],
            standing: { delta: standingDeltaForCause("ROOFTOP_RUN_COMPLETED"), causeId: "ROOFTOP_RUN_COMPLETED" },
          },
        };
      }
    }
    if (activityId === OPTIONAL_ACTIVITY_IDS.LOSE_WATCH) {
      if (activity.stage === "AVAILABLE" || activity.stage === "DORMANT") {
        return {
          sourceId: "CH-lose-watch-start",
          title: "Lose the watch",
          text: "Draw the central patrol, choose Run, then break sight and hold the gap. The same chase rules and real heat consequences apply.",
          action: "Provoke the patrol",
          position: activityAnchor(activityId, 0),
          outcomeId: "PROVOKE",
          clip: "argu1",
          effects: {
            activities: [{ activityId, stage: "ACCEPTED", breadcrumb: "Choose Run when the patrol challenges you, then shake the chase." }],
          },
          afterCommit: async () => {
            const serial = props.view.field.confrontationHistory.length + 1;
            await services.submitFieldEvent({
              type: "FIELD_WATCHER_CHALLENGE",
              eventId: `M4_LOSE_WATCH_CHALLENGE_${serial}`,
              interruptId: `M4_LOSE_WATCH_INT_${serial}`,
              challengeId: `M4_LOSE_WATCH_${serial}`,
              watcherId: "WATCH-patrol",
              reason: "SUSPICION",
            });
          },
        };
      }
      if (activity.stage === "ACCEPTED") {
        // The dare settles on ANY resolution of the provoked confrontation —
        // running (chase outcome) or backing down (comply/talk). Without the
        // confrontation branch the activity wedges ACCEPTED forever.
        const chase = props.view.field.chaseHistory.at(-1);
        const confrontation = props.view.field.confrontationHistory.at(-1);
        if (chase?.outcome) {
          const escaped = chase.outcome === "ESCAPED" || chase.outcome === "REFUGE";
          return {
            sourceId: "CH-lose-watch-result",
            title: escaped ? "Watch shaken" : "Dare settled",
            text: escaped
              ? "You broke the patrol's sightline and held the gap."
              : "The watch caught you. The dare ends, and the heat remains real.",
            action: "Close the dare",
            position: activityAnchor(activityId, 0),
            outcomeId: chase.outcome,
            effects: {
              activities: [{ activityId, stage: "COMPLETED", breadcrumb: escaped ? "You lost the watch cleanly." : "The watch caught the dare." }],
              micros: [MICRO_CONCEPT_IDS.WRITS_OF_ASSISTANCE],
              ...(escaped
                ? { standing: { delta: standingDeltaForCause("LOSE_WATCH_COMPLETED"), causeId: "LOSE_WATCH_COMPLETED" as const } }
                : {}),
            },
          };
        }
        if (confrontation?.outcome) {
          return {
            sourceId: "CH-lose-watch-backdown",
            title: "Dare declined",
            text: "You stood for the patrol instead of running. The dare ends quietly — the searches were still real.",
            action: "Close the dare",
            position: activityAnchor(activityId, 0),
            outcomeId: "BACKED_DOWN",
            effects: {
              activities: [{ activityId, stage: "COMPLETED", breadcrumb: "You faced the patrol rather than run the dare." }],
              micros: [MICRO_CONCEPT_IDS.WRITS_OF_ASSISTANCE],
            },
          };
        }
        return null;
      }
    }
    return null;
  };

  useEffect(() => {
    const interrupt = props.view.field.activeInterrupt;
    if (
      interrupt?.kind !== "REACTIVE_EXCHANGE" ||
      prompt ||
      interruptId.current
    ) {
      return;
    }
    const sourceId = interrupt.sourceId ?? "";
    const knowledge = M4_KNOWLEDGE.find((entry) => entry.id === sourceId);
    const reactiveDirectorOwnsSource =
      sourceId.startsWith("SJ-dock-haul") ||
      sourceId.startsWith("SJ-tavern-note") ||
      sourceId.startsWith("SJ-ropewalk");
    const ownsSource =
      !reactiveDirectorOwnsSource &&
      (Boolean(knowledge) ||
        sourceId.startsWith("SJ-") ||
        sourceId.startsWith("CH-") ||
        sourceId.startsWith("INFO-"));
    if (!ownsSource) return;
    let resumed: ContentPrompt | null = knowledge
      ? {
          sourceId: knowledge.id,
          title: knowledge.title,
          text: knowledge.body,
          action: "Finish reading",
          position: worldPosition(knowledge),
          outcomeId: "READ",
          effects: { micros: [...knowledge.micros] },
        }
      : null;
    if (!resumed) {
      for (const activityId of Object.values(OPTIONAL_ACTIVITY_IDS)) {
        const candidate = activityPrompt(activityId);
        if (candidate?.sourceId === sourceId) {
          resumed = candidate;
          break;
        }
      }
    }
    const completed = [...props.view.field.reactiveCompletions]
      .reverse()
      .find((record) => record.sourceId === sourceId);
    if (!resumed && completed) {
      resumed = {
        sourceId,
        title: "Field interaction complete",
        text: "The Archive has retained the completed outcome.",
        action: "Continue",
        position: [0, 0, 0],
        outcomeId: completed.outcomeId,
        effects: {},
      };
    }
    if (!resumed) return;
    interruptId.current = interrupt.interruptId;
    props.apiRef.current?.setInputLocked(true);
    setPrompt(resumed);
    if (completed) {
      setReply(resumed.text);
      setReplyChips(effectChips(resumed.effects, MICRO_LABELS));
      window.clearTimeout(resolutionTimer.current);
      resolutionTimer.current = window.setTimeout(() => {
        void (async () => {
          await services.submitFieldEvent({
            type: "FIELD_INTERRUPT_RESOLVED",
            eventId: `${interrupt.interruptId}_RESOLVED`,
            interruptId: interrupt.interruptId,
            outcome: completed.outcomeId,
          });
          props.apiRef.current?.setInputLocked(false);
          props.apiRef.current?.setInteractionClip(null);
          interruptId.current = null;
          setReply(null);
          setReplyChips([]);
          setPrompt(null);
        })();
      }, props.reducedMotion ? 900 : 2_400);
    }
  }, [
    prompt,
    props.apiRef,
    props.reducedMotion,
    props.view,
    services,
  ]);

  useFrame(() => {
    props.interactionRegistry.clearSource("M4_CONTENT");
    if (!props.enabled || prompt || committing) return;
    const spaceId = services.spaceId;
    const offersEnabled = props.exchangesEnabled !== false;
    for (const knowledge of M4_KNOWLEDGE) {
      if (knowledge.spaceId !== spaceId) continue;
      const position = worldPosition(knowledge);
      props.interactionRegistry.upsert({
        id: `M4:${knowledge.id}`,
        sourceId: "M4_CONTENT",
        kind: "KNOWLEDGE",
        label: `Read ${knowledge.title}`,
        priority: INTERACTION_PRIORITIES.KNOWLEDGE,
        spaceId,
        position,
        radius: 2.15,
        facingDot: -0.1,
        // The authored point sits on the imported carrier face; semantic LOS
        // would otherwise count the destination surface itself as an occluder.
        losRequired: false,
        enabled: offersEnabled,
        activate: () => {
          void begin({
            sourceId: knowledge.id,
            title: knowledge.title,
            text: knowledge.body,
            action: "Finish reading",
            position,
            outcomeId: "READ",
            effects: { micros: [...knowledge.micros] },
          });
          return true;
        },
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
        const content = activityPrompt(activityId);
        if (!content) continue;
        props.interactionRegistry.upsert({
          id: `M4:${content.sourceId}`,
          sourceId: "M4_CONTENT",
          kind: "SIDE_JOB",
          label: content.action,
          priority: INTERACTION_PRIORITIES.SIDE_JOB_THREAD,
          spaceId,
          position: content.position,
          radius: 2.5,
          facingDot: -0.2,
          losRequired: true,
          enabled: offersEnabled,
          activate: () => {
            void begin(content);
            return true;
          },
        });
      }
      for (const [kind, flavor] of [
        ["DOG", M4_FLAVOR.DOG],
        ["GULLS", M4_FLAVOR.GULLS],
      ] as const) {
        props.interactionRegistry.upsert({
          id: `M4:${flavor.id}`,
          sourceId: "M4_CONTENT",
          kind: "FLAVOR",
          label: kind === "DOG" ? "Pet the dog" : "Spook the gulls",
          priority: INTERACTION_PRIORITIES.FLAVOR,
          spaceId,
          position: flavor.position,
          radius: kind === "DOG" ? 2.9 : 2.4,
          facingDot: -0.3,
          losRequired: false,
          enabled: true,
          activate: () => {
            playFlavor(kind);
            return true;
          },
        });
      }
    }
    const tavernDone =
      props.view.field.activities[OPTIONAL_ACTIVITY_IDS.TAVERN_NOTE].stage ===
      "COMPLETED";
    const dockDone =
      props.view.field.activities[OPTIONAL_ACTIVITY_IDS.DOCK_HAUL].stage ===
      "COMPLETED";
    const info = [
      ...(spaceId === "EXPLORE_tavern" && tavernDone
        ? [{
            id: "INFO-tavern-keeper",
            title: "Keeper's rumors",
            text: "The Loyal Nine use taverns, printers, and trusted runners to move word without an official network.",
            position: interiorPoint("EXPLORE_tavern", [-5.2, 0, 1]) as readonly [number, number, number],
            micros: [MICRO_CONCEPT_IDS.LOYAL_NINE, MICRO_CONCEPT_IDS.NEWS_NETWORKS],
          }]
        : []),
      ...(spaceId === "EXTERIOR" && dockDone
        ? [{
            id: "INFO-dockhand",
            title: "Dock rumors",
            text: "Idle hulls mean idle wages. The harbor feels every customs delay first.",
            position: [-134, 0, 3] as const,
            micros: [MICRO_CONCEPT_IDS.PORT_TOWN_BOSTON],
          }]
        : []),
      ...(spaceId === "EXTERIOR"
        ? [{
            id: "INFO-goodwife",
            title: "A goodwife's word",
            text: "Find Sarah at the market. Refusing English goods sounds noble until a widow's stall pays the price.",
            position: [-28, 0, 9.2] as const,
            micros: [MICRO_CONCEPT_IDS.NON_IMPORTATION],
          }]
        : []),
    ];
    for (const figure of info) {
      props.interactionRegistry.upsert({
        id: `M4:${figure.id}`,
        sourceId: "M4_CONTENT",
        kind: "NPC",
        label: "Ask for rumors",
        priority: INTERACTION_PRIORITIES.STORY_NPC,
        spaceId,
        position: figure.position,
        radius: 2.3,
        facingDot: -0.2,
        losRequired: true,
        enabled: offersEnabled,
        activate: () => {
          void begin({
            sourceId: figure.id,
            title: figure.title,
            text: figure.text,
            action: "Thank them",
            position: figure.position,
            outcomeId: "HEARD",
            clip: "talk",
            effects: { micros: figure.micros },
          });
          return true;
        },
      });
    }
  });

  useEffect(
    () => () => {
      window.clearTimeout(resolutionTimer.current);
      props.interactionRegistry.clearSource("M4_CONTENT");
      props.apiRef.current?.setInputLocked(false);
      props.apiRef.current?.setInteractionClip(null);
    },
    [props.apiRef, props.interactionRegistry],
  );

  // One keyboard model for every exchange panel (feel-audit-1 P0-2/P1-1):
  // the advertised numeric hotkey commits, Escape abandons.
  useEffect(() => {
    if (!prompt) return;
    const onKey = (event: KeyboardEvent) => {
      if (committing || reply) return;
      if (event.key === "1") {
        event.preventDefault();
        void finish();
      } else if (event.key === "Escape") {
        event.preventDefault();
        void dismiss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const roofKid =
    props.view.field.activities[OPTIONAL_ACTIVITY_IDS.ROOF_KID].stage;
  const dockDone =
    props.view.field.activities[OPTIONAL_ACTIVITY_IDS.DOCK_HAUL].stage ===
    "COMPLETED";
  const tavernDone =
    props.view.field.activities[OPTIONAL_ACTIVITY_IDS.TAVERN_NOTE].stage ===
    "COMPLETED";

  return (
    <group>
      {M4_KNOWLEDGE.filter(
        (knowledge) =>
          knowledge.texture &&
          knowledge.carrier !== "EVENT_PROP" &&
          knowledge.carrier !== "EXISTING",
      ).map((knowledge) => (
        <group
          key={knowledge.id}
          visible={knowledge.spaceId === services.spaceId}
        >
          <KnowledgeVisual placement={knowledge} />
        </group>
      ))}
      {services.spaceId === "EXTERIOR" && (
        <>
          <group position={[-24, 0, 9.8]} rotation={[0, 2.5, 0]}>
            <RiggedCharacter glbKey="goodwife-rigged" height={1.62} clip="talk" showFallback={false} />
          </group>
          {roofKid !== "COMPLETED" && (
            <group position={[13.5, 3.05, -10.8]} rotation={[0, Math.PI, 0]}>
              <RiggedCharacter glbKey="townsman-rigged" height={1.45} clip="sitIdle" tint="#a98d72" showFallback={false} />
            </group>
          )}
          <group position={[6, 0, 8.8]} rotation={[0, Math.PI, 0]}>
            <RiggedCharacter glbKey="towncrier-rigged" height={1.72} clip="idle" showFallback={false} />
          </group>
          <group position={[-16, 0, 6]} rotation={[0, 1.7, 0]}>
            <RiggedCharacter glbKey="agitator-rigged" height={1.74} clip="argu1" showFallback={false} />
          </group>
          <group position={[50, 0, 8]} rotation={[0, Math.PI, 0]}>
            <RiggedCharacter glbKey="townsman-rigged" height={1.7} clip="idle" tint="#7f7468" showFallback={false} />
          </group>
          <group position={[-28, 0, 9.2]} rotation={[0, 2.4, 0]}>
            <RiggedCharacter glbKey="goodwife-rigged" height={1.63} clip="talk2" tint="#a59380" showFallback={false} />
          </group>
          {dockDone && (
            <group position={[-134, 0, 0.5]} rotation={[0, 0.4, 0]}>
              <RiggedCharacter glbKey="dockhand-rigged" height={1.72} clip="work1" showFallback={false} />
            </group>
          )}
          {M4_EAVESDROPS.map((scene) => (
            <Eavesdrop
              key={scene.id}
              scene={scene}
              apiRef={props.apiRef}
              active={props.enabled}
              reducedMotion={props.reducedMotion}
            />
          ))}
        </>
      )}
      {services.spaceId === "EXPLORE_tavern" && tavernDone && (
        <group position={interiorPoint("EXPLORE_tavern", [-7, 0, 1])} rotation={[0, Math.PI, 0]}>
          <RiggedCharacter glbKey="townsman-rigged" height={1.7} clip="talk" showFallback={false} />
        </group>
      )}
      {prompt && (
        <Html
          position={[prompt.position[0], prompt.position[1] + 2, prompt.position[2]]}
          center
          occlude={false}
          zIndexRange={[25, 10]}
          calculatePosition={clampedPanelPosition}
        >
          <section className="reactive-exchange" role="dialog" aria-label={prompt.title}>
            <header>{prompt.title}</header>
            <p>{reply ?? prompt.text}</p>
            {reply && replyChips.length > 0 && (
              <div className="exchange-effect-chips" role="status">
                {replyChips.map((chip) => (
                  <span key={chip}>{chip}</span>
                ))}
              </div>
            )}
            {!reply && (
              <div className="reactive-exchange-choices">
                <button type="button" disabled={committing} onClick={() => void finish()}>
                  <kbd>1</kbd> {prompt.action}
                </button>
                <button
                  type="button"
                  className="exchange-dismiss"
                  disabled={committing}
                  onClick={() => void dismiss()}
                >
                  <kbd>ESC</kbd> Step away
                </button>
              </div>
            )}
          </section>
        </Html>
      )}
    </group>
  );
}

