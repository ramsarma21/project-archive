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
import { CombatHud } from "./CombatHud.js";
import { ammoReadout } from "./combatHudModel.js";
import { useControlsLegend } from "./controlsLegend.js";
import { QuestionPanel } from "./QuestionPanel.js";
import {
  BreakNotice,
  DamageVignette,
  FaceOffTitle,
  OutcomePanel,
  VerdictBeat,
} from "./DuelOverlay.js";
import { createDuelRuntime, type DuelHud, type DuelRuntime } from "./duelRuntime.js";
import { createDuelInput, duelControls } from "./duelInput.js";
import {
  httpVerdictAuthority,
  type VerdictAuthority,
  type VerdictOrigin,
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
  // How the last committed verdict was obtained, so the verdict beat can tell a slow
  // grader ("took too long") apart from an unreachable one ("could not be reached").
  // The verdict's own `source` is GRADING_TIMEOUT for both, so this is the only thing
  // that distinguishes them on screen. Never changes the generous grant.
  const [lastGrant, setLastGrant] = useState<{
    origin: VerdictOrigin;
    serverFallbackDiagnosis: string | null;
  } | null>(null);
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

  // The hold-Tab controls legend. Disabled during the answering beat and the outcome so
  // Tab stays with the question overlay's own focus traversal and the exit buttons.
  const hudWithdrawn =
    hud.phase === "QUESTION_PENDING" || hud.phase === "VERDICT_COMMITTED";
  const controlsHeld = useControlsLegend(!hudWithdrawn && hud.phase !== "DUEL_RESOLVED");
  const controlItems = useMemo(
    () => duelControls((descriptor.playerLoadout ?? []).length),
    [descriptor.playerLoadout],
  );

  useEffect(() => {
    if (!hud.outcome || reported.current) return;
    reported.current = true;
    props.onResolved?.(hud.outcome, duelCommitLog(runtime.getEvents()), [
      ...receipts.current,
    ]);
  }, [hud.outcome, props.onResolved, runtime]);

  const submit = useCallback(
    async (answer: string, selectedCardIds: readonly string[]) => {
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
          selectedCardIds,
        });
        // Say what actually happened, before the verdict is committed unread. A
        // generous grant is right either way, but conflating a slow grader with a
        // refused endpoint is how an unregistered route hid behind "the grader took
        // too long" for the life of the duel. This line is the console-facing half of
        // the truth the overlay tells the player.
        announceGrantOrigin(result, hud.round);
        setLastGrant({
          origin: result.origin,
          serverFallbackDiagnosis: result.serverFallbackDiagnosis,
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

      {/* The Overwatch-style HUD. It withdraws during the answering beat (below) rather
          than fighting the question panel for the same space; nothing it shows moves
          while a question is open, so there is nothing to withdraw that matters. */}
      <CombatHud
        self={{
          name: "You",
          weaponLabel: "Flintlock",
          glbKey: descriptor.playerGlbKey,
          health: hud.health.A,
          maxHealth: hud.maxHealth.A,
          ammo: ammoReadout(hud.ammo.A, hud.magazine.A),
        }}
        enemy={{
          // The display name only — no role line, which was duplicating "The King's
          // officer" alongside itself. In PvP the role is a genuinely distinct rank.
          name: descriptor.opponentName,
          health: hud.health.B,
          maxHealth: hud.maxHealth.B,
          // The one line worth keeping off the retired break card: how many clean
          // hits the opponent is from the ground, now persistent so it reads WHILE
          // shooting. The core's own termination arithmetic (duelRuntime.hitsToFall),
          // never a number this layer invents.
          hitsToFall: hud.hitsToFall.B,
          downed: hud.downed.B,
        }}
        round={hud.round}
        clockSeconds={hud.phase === "ENGAGEMENT_LIVE" ? hud.secondsRemaining : null}
        clockUrgent={
          hud.phase === "ENGAGEMENT_LIVE" &&
          hud.secondsRemaining !== null &&
          hud.secondsRemaining <= 5
        }
        withdrawn={hudWithdrawn}
        showReticle={hud.phase === "ENGAGEMENT_LIVE" || hud.phase === "BULLETS_GRANTED"}
        controls={{ items: controlItems, held: controlsHeld }}
        {...(props.reducedMotion === undefined ? {} : { reducedMotion: props.reducedMotion })}
      />

      {hud.phase === "FACE_OFF" && (
        <FaceOffTitle hud={hud} opponentName={descriptor.opponentName} />
      )}

      {/* The break no longer raises a blocking card. This non-blocking notice teaches
          the one real mechanic once (unfired balls do not carry) and renders nothing
          otherwise. A direct child of `.duel` (NOT the bottom-anchored `.duel-beats`)
          so it sits high-centre clear of the HUD clusters; mounted unconditionally so
          its once-ever hook is stable. */}
      <BreakNotice hud={hud} />

      <div className="duel-beats">
        {answering && item && (
          <QuestionPanel
            round={hud.round}
            item={item}
            appearance={hud.itemAppearance}
            recycled={hud.itemRecycled}
            speaker={questionSpeaker(hud.mode, descriptor.opponentName)}
            submitting={submitting}
            onSubmit={(answer, selectedCardIds) => void submit(answer, selectedCardIds)}
            notice={submitting ? "The System is reading your answer." : notice}
            {...(props.reducedMotion === undefined
              ? {}
              : { reducedMotion: props.reducedMotion })}
          />
        )}
        {hud.phase === "BULLETS_GRANTED" && (
          <VerdictBeat
            hud={hud}
            grantOrigin={lastGrant?.origin ?? null}
            serverFallbackDiagnosis={lastGrant?.serverFallbackDiagnosis ?? null}
          />
        )}

        {hud.phase === "DUEL_RESOLVED" && (
          <OutcomePanel
            hud={hud}
            {...(props.onExit ? { onExit: props.onExit } : {})}
            {...(props.onAgain ? { onAgain: props.onAgain } : {})}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The console-facing half of the truth the overlay tells the player.
 *
 * `app.ts` builds the API's logger off in development, and the server never even
 * sees a round the client granted itself on a non-2xx — so if this line is not
 * written here, a duel played entirely on the client's fallback leaves NOTHING on
 * any console saying grading never happened. That silence is exactly how "the
 * grader took too long" was believed for a route that was returning 404 every
 * round. It names the origin and, on an unreachable round, the HTTP status.
 */
function announceGrantOrigin(
  result: {
    origin: VerdictOrigin;
    httpStatus: number | null;
    serverFallbackDiagnosis: string | null;
  },
  round: number,
): void {
  switch (result.origin) {
    case "AUTHORITY_UNREACHABLE":
      console.warn(
        `[duel] round ${round}: the grader could not be reached` +
          `${result.httpStatus === null ? "" : ` (HTTP ${result.httpStatus})`}` +
          " — granted the maximum WITHOUT grading. This is not a slow grader; the " +
          "request never reached the classifier, so a wrong answer paid the same as " +
          "a right one. Check the verdict endpoint and the session/attempt it needs.",
      );
      return;
    case "AUTHORITY_TIMEOUT":
      console.warn(
        `[duel] round ${round}: the grader did not answer within the ${GRADING_CAP_MS_LABEL} cap` +
          " — granted the maximum without a verdict.",
      );
      return;
    case "AUTHORITY":
      if (result.serverFallbackDiagnosis !== null) {
        console.warn(
          `[duel] round ${round}: the server granted the maximum without grading` +
            ` (${result.serverFallbackDiagnosis}). The answer was not classified.`,
        );
      }
      return;
    default:
      return;
  }
}

/** Named once so the console line and the design's cap cannot drift apart. */
const GRADING_CAP_MS_LABEL = "1.5-second";

/** Boss descriptor helper, so a mission hands over content and not plumbing. */
export function bossOpponent(profile: BossProfile): OpponentSource {
  return { kind: "BOSS", profile };
}
