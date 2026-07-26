import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
} from "react";
import {
  duelCommitLog,
  type AbilityLoadout,
  type BossProfile,
  type DuelArena,
  type DuelEvent,
  type DuelOutcome,
  type DuelQuestionRef,
  type OpponentSource,
} from "@pa/duel";
import { DuelStage } from "./DuelStage.js";
import { RoundHud } from "./RoundHud.js";
import { QuestionPanel } from "./QuestionPanel.js";
import {
  BreakBeat,
  ControlsHint,
  DamageVignette,
  FaceOffTitle,
  OutcomePanel,
  VerdictBeat,
} from "./DuelOverlay.js";
import { createDuelRuntime, type DuelHud, type DuelRuntime } from "./duelRuntime.js";
import { createDuelInput } from "./duelInput.js";
import {
  httpVerdictAuthority,
  type VerdictAuthority,
  type VerdictReceipt,
} from "./duelGrading.js";
import {
  M1_ITEM_SOURCE,
  missingItemContent,
  questionSpeaker,
  type DuelItemSource,
} from "./duelItems.js";
import type { GripTuning } from "./DuelActor.js";
import type { InspectFraming } from "./duelCamera.js";
import type { CoverPlacement } from "./arenaSpec.js";
import "./duel.css";

// The whole visible duel, in one mountable surface.
//
// It owns three things and no more: the runtime (one DuelState), the input
// controller, and the round of asking-then-committing. Everything else is delegated —
// the fight to the core, the drawing to the stage, the question text to a content
// source, and the verdict to an authority that is passed in.
//
// The seam for PvP is `opponent`. A REMOTE opponent changes who owes a verdict and
// where side B's intents come from, both inside the core; nothing in this component
// asks whether side B is a person.
//
// THE DESCRIPTOR CANNOT EXPRESS A DUEL LENGTH, and that is the point. A duel runs
// until a health bar empties, so there is no round count to configure — and the
// item list is named a BANK rather than a schedule because its length is the depth
// of the authored content, not the length of the fight. The core draws from it in
// its own seeded order and recycles it openly when a duel outlasts it.

export interface DuelDescriptor {
  readonly duelId: string;
  readonly seed: number;
  /**
   * The arena's collision world and where the two fighters start.
   *
   * Narrower than @pa/duel's `DuelArena`, which also carries the `ArenaSpec` it
   * was built FROM. This screen reads the world and the placement and nothing
   * else, and a mission hands over a world it carved out of its own level rather
   * than one it built from a spec — so asking for the spec would make a
   * mission-driven caller invent an `arenaId` and a cover list nobody looks at.
   * A `buildArena` result still satisfies this, which is why `yardArena()` is
   * unchanged.
   */
  readonly arena: Pick<DuelArena, "world" | "placement">;
  readonly opponent: OpponentSource;
  /**
   * Everything this duel may ask. Not one item per round and not in round order:
   * `askQuestion` in the core owns the draw.
   */
  readonly questionBank: readonly DuelQuestionRef[];
  readonly playerLoadout?: AbilityLoadout;
  /** Rig for each side. The visible cast, not the simulation. */
  readonly playerGlbKey: string;
  readonly opponentGlbKey: string;
  readonly opponentName: string;
  readonly cover?: readonly CoverPlacement[];
}

export interface DuelScreenProps {
  readonly descriptor: DuelDescriptor;
  /** Where verdicts come from. Defaults to the real grading authority. */
  readonly verdictAuthority?: VerdictAuthority;
  readonly itemSource?: DuelItemSource;
  /**
   * What the arena looks like.
   *
   * Defaults to the stand-alone rope-walk yard in `arenaSpec.ts`, which is built
   * around the origin. A mission whose arena is a room inside its own level
   * passes its own scenery: the descriptor's world is then at the level's
   * coordinates, and drawing the stand-alone yard there would leave the fighters
   * standing over ninety metres of nothing.
   */
  readonly Scenery?: ComponentType<{ readonly reducedMotion: boolean }>;
  readonly reducedMotion?: boolean;
  readonly playerGrip?: Partial<GripTuning>;
  readonly opponentGrip?: Partial<GripTuning>;
  /** Asset-QA camera framing. Never set in play. */
  readonly inspect?: InspectFraming | null;
  /**
   * Fires once when the duel resolves, with the persisted subset of the event
   * stream: the verdicts, the derived grants and the result. No tick-level combat
   * events, and no answer text — there is no field for it.
   *
   * `receipts` is the server's proof for the rounds it graded, one per round it
   * minted a verdict for and nothing for the rounds the 1.5-second cap did.
   * Handed over separately because the commit log is @pa/duel's shape and a
   * receipt is an artifact of this client's transport; `attachVerdictReceipts`
   * is what joins them.
   */
  readonly onResolved?: (
    outcome: DuelOutcome,
    commitLog: readonly DuelEvent[],
    receipts: readonly VerdictReceipt[],
  ) => void;
  readonly onExit?: () => void;
  readonly onAgain?: () => void;
  /** Handed the live runtime once, for telemetry and for asset QA. */
  readonly onRuntime?: (runtime: DuelRuntime) => void;
}

function useDuelHud(runtime: DuelRuntime): DuelHud {
  return useSyncExternalStore(runtime.subscribe, runtime.getHud, runtime.getHud);
}

export function DuelScreen(props: DuelScreenProps) {
  const { descriptor } = props;
  const authority = props.verdictAuthority ?? httpVerdictAuthority;
  const items = props.itemSource ?? M1_ITEM_SOURCE;

  const runtime = useMemo(
    () =>
      createDuelRuntime({
        duelId: descriptor.duelId,
        seed: descriptor.seed,
        world: descriptor.arena.world,
        opponent: descriptor.opponent,
        questions: descriptor.questionBank,
        placement: descriptor.arena.placement,
        ...(descriptor.playerLoadout ? { playerLoadout: descriptor.playerLoadout } : {}),
      }),
    [descriptor],
  );

  const input = useMemo(
    () =>
      createDuelInput({
        abilityIds: (descriptor.playerLoadout ?? []).map((ability) => ability.abilityId),
      }),
    [descriptor.playerLoadout],
  );

  const hud = useDuelHud(runtime);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const reported = useRef(false);
  // Collected rather than held in state: nothing on screen reads a receipt, and a
  // re-render per graded round to store an opaque string would be a render nobody
  // asked for.
  const receipts = useRef<VerdictReceipt[]>([]);

  useEffect(() => input.attach(), [input]);

  useEffect(() => {
    props.onRuntime?.(runtime);
  }, [props.onRuntime, runtime]);

  // The fight and the answer box cannot both own the keyboard.
  const answering = hud.phase === "QUESTION_PENDING" && hud.awaitingVerdictFrom.includes("A");
  useEffect(() => {
    input.setEnabled(!answering && hud.phase !== "DUEL_RESOLVED");
  }, [input, answering, hud.phase]);

  useEffect(() => {
    if (!hud.outcome || reported.current) return;
    reported.current = true;
    props.onResolved?.(hud.outcome, duelCommitLog(runtime.getEvents()), [
      ...receipts.current,
    ]);
  }, [hud.outcome, props.onResolved, runtime]);

  const submit = useCallback(
    async (answer: string) => {
      if (submitting) return;
      const item = hud.item;
      if (!item) return;
      setSubmitting(true);
      setNotice(null);
      try {
        const result = await authority({
          duelId: descriptor.duelId,
          round: hud.round,
          side: "A",
          item,
          answer,
        });
        // The verdict is the authority's. The client hands it over unread, and there
        // is no field on this call that could carry a bullet count.
        const rejection = runtime.commitVerdict("A", result.verdict);
        if (rejection) setNotice(`The duel refused that verdict: ${rejection.code}.`);
        // Kept only for a verdict the core accepted: a receipt for a round the
        // duel refused would authenticate a verdict that never counted.
        else if (result.receipt) receipts.current.push(result.receipt);
      } catch (cause) {
        console.error("[duel] grading failed", cause);
        setNotice("The grader could not be reached. Try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [authority, descriptor.duelId, hud.item, hud.round, runtime, submitting],
  );

  const item = hud.item ? items.get(hud.item) ?? missingItemContent(hud.item) : null;

  return (
    <div className="duel">
      <div className="duel-stage">
        <DuelStage
          runtime={runtime}
          input={input}
          playerGlbKey={descriptor.playerGlbKey}
          opponentGlbKey={descriptor.opponentGlbKey}
          {...(descriptor.cover ? { cover: descriptor.cover } : {})}
          {...(props.Scenery ? { Scenery: props.Scenery } : {})}
          {...(props.reducedMotion === undefined ? {} : { reducedMotion: props.reducedMotion })}
          {...(props.playerGrip ? { playerGrip: props.playerGrip } : {})}
          {...(props.opponentGrip ? { opponentGrip: props.opponentGrip } : {})}
          inspect={props.inspect ?? null}
        />
      </div>

      <div className="duel-vignette" aria-hidden />
      <DamageVignette health={hud.health.A} />

      <RoundHud hud={hud} opponentName={descriptor.opponentName} />

      {hud.phase === "FACE_OFF" && (
        <FaceOffTitle hud={hud} opponentName={descriptor.opponentName} />
      )}

      <div className="duel-beats">
        {answering && item && (
          <QuestionPanel
            round={hud.round}
            item={item}
            appearance={hud.itemAppearance}
            recycled={hud.itemRecycled}
            speaker={questionSpeaker(hud.mode, descriptor.opponentName)}
            submitting={submitting}
            onSubmit={(answer) => void submit(answer)}
            notice={submitting ? "The System is reading your answer." : notice}
          />
        )}
        {hud.phase === "BULLETS_GRANTED" && <VerdictBeat hud={hud} />}
        {hud.phase === "LINE_OF_SIGHT_BREAK" && <BreakBeat hud={hud} />}
        {hud.phase === "DUEL_RESOLVED" && (
          <OutcomePanel
            hud={hud}
            {...(props.onExit ? { onExit: props.onExit } : {})}
            {...(props.onAgain ? { onAgain: props.onAgain } : {})}
          />
        )}
      </div>

      <ControlsHint
        visible={hud.phase === "ENGAGEMENT_LIVE" && hud.round <= 1}
        abilityCount={(descriptor.playerLoadout ?? []).length}
      />
    </div>
  );
}

/** Boss descriptor helper, so a mission hands over content and not plumbing. */
export function bossOpponent(profile: BossProfile): OpponentSource {
  return { kind: "BOSS", profile };
}
