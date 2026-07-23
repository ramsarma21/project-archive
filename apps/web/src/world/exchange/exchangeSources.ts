// ---------------------------------------------------------------------------
// Exchange source registry (refactor wave 2).
//
// ONE typed registry replaces the string-prefix ownership routing that used to
// be split across ReactiveNpcDirector and M4ContentDirector. Every source id
// that can appear in FIELD_INTERRUPT_STARTED.sourceId for a REACTIVE_EXCHANGE
// interrupt is registered here explicitly — either as a static ExchangeSource
// or as an exact-id member of an ExchangeSourceFamily (runtime-authored
// dialogue nodes whose ids come from the content package via the view).
//
// This module is engine-generic: it holds no authored ids, copy, anchors, or
// Boston content. Content modules under world/content/ register their sources
// through registerExchangeSourcePackage().
// ---------------------------------------------------------------------------

import type {
  FieldCommittedEvent,
  ReactiveCompletionEffects,
  RuntimeView,
} from "@pa/contracts";

/** Effects payload authored per choice (identity fields are engine-added). */
export type ExchangeChoiceEffects = Omit<
  ReactiveCompletionEffects,
  "interactionId" | "sourceId" | "outcomeId"
>;

export interface ExchangeAfterCommitContext {
  view: RuntimeView;
  submitFieldEvent: (event: FieldCommittedEvent) => Promise<boolean>;
}

export interface ExchangeChoice {
  id: string;
  label: string;
  reply: string;
  effects: ExchangeChoiceEffects;
  /**
   * Player-rig clip applied when this choice commits. Undefined keeps the
   * begin clip locked through the reply dwell (legacy M4ContentDirector
   * behavior); the legacy ReactiveNpcDirector always set one.
   */
  actionClip?: string;
  /**
   * Runs inside the resolution dwell, after FIELD_INTERRUPT_RESOLVED commits
   * and before input unlocks (legacy M4ContentDirector afterCommit — e.g. the
   * lose-the-watch dare provokes its patrol challenge here). Never invoked on
   * the resume-of-a-completed-interrupt path, matching the old directors.
   */
  afterCommit?: (ctx: ExchangeAfterCommitContext) => void | Promise<void>;
}

/**
 * Per-source engine constants. These were implicit in WHICH director owned a
 * source; they are now explicit data so the engine has zero prefix logic.
 */
export interface ExchangeEngineProfile {
  /** "M3" | "M4" historically; preserved so new interrupt ids stay byte-identical. */
  interruptIdPrefix: string;
  /**
   * FIELD_REACTIVE_OUTCOME_SELECTED → the runtime's registered-outcome table
   * resolves the effects authoritatively (named cast + authored dialogue).
   * FIELD_REACTIVE_COMPLETED → the authored effects payload rides the event.
   */
  completionEvent:
    | "FIELD_REACTIVE_OUTCOME_SELECTED"
    | "FIELD_REACTIVE_COMPLETED";
  /** Player-rig clip locked when the exchange opens. */
  beginClip: string;
  /** drei <Html> zIndexRange for the panel ([20,10] legacy RND, [25,10] legacy M4). */
  panelZRange: readonly [number, number];
  /** Render the explicit ESC "Step away" button (legacy M4 panels). */
  dismissButton: boolean;
}

export interface Exchange {
  sourceId: string;
  title: string;
  line: string;
  position: readonly [number, number, number];
  choices: readonly ExchangeChoice[];
  engine: ExchangeEngineProfile;
}

export type ExchangeOwner =
  | "NAMED_CAST"
  | "AUTHORED_DIALOGUE"
  | "THREAD_FIGURE"
  | "SIDE_JOB"
  | "CHALLENGE"
  | "KNOWLEDGE"
  | "INFO_FIGURE"
  | "FLAVOR";

export type ExchangeResolver = (
  view: RuntimeView,
  spaceId: string,
  tick: number,
  fieldSeed: number,
) => Exchange | null;

export interface ExchangeSource {
  sourceId: string;
  owner: ExchangeOwner;
  /**
   * EXCHANGE sources begin/resume field interrupts. AMBIENT sources (flavor
   * verbs) never commit field events; they are registered so the inventory is
   * complete and their resolve is never consulted by the interrupt engine.
   */
  kind: "EXCHANGE" | "AMBIENT";
  resolve: ExchangeResolver;
}

/**
 * A family registers sources whose exact ids are only enumerable from live
 * runtime content (authored dialogue nodes). Membership is exact-id — the
 * runtime force-includes the active interrupt's node in
 * view.openResponse.npcFollowups, so resume lookups never need prefixes.
 */
export interface ExchangeSourceFamily {
  familyId: string;
  owner: ExchangeOwner;
  memberIds: (view: RuntimeView) => readonly string[];
  resolve: (
    sourceId: string,
    view: RuntimeView,
    spaceId: string,
    tick: number,
    fieldSeed: number,
  ) => Exchange | null;
}

interface ExchangeSourcePackage {
  sources: readonly ExchangeSource[];
  families: readonly ExchangeSourceFamily[];
}

// Registered by package so a dev-server hot reload replaces (never duplicates)
// a content module's registrations, while an accidental cross-package id
// collision still fails loudly at module load.
const packages = new Map<string, ExchangeSourcePackage>();

export function registerExchangeSourcePackage(
  packageId: string,
  contents: ExchangeSourcePackage,
): void {
  packages.set(packageId, contents);
  const seen = new Map<string, string>();
  for (const [id, entry] of packages) {
    for (const source of entry.sources) {
      const existing = seen.get(source.sourceId);
      if (existing) {
        throw new Error(
          `exchange source ${source.sourceId} registered by both ${existing} and ${id}`,
        );
      }
      seen.set(source.sourceId, id);
    }
  }
}

export function registeredExchangeSources(): ExchangeSource[] {
  return [...packages.values()].flatMap((entry) => [...entry.sources]);
}

export function registeredExchangeFamilies(): ExchangeSourceFamily[] {
  return [...packages.values()].flatMap((entry) => [...entry.families]);
}

export function getExchangeSource(sourceId: string): ExchangeSource | undefined {
  for (const entry of packages.values()) {
    const source = entry.sources.find(
      (candidate) => candidate.sourceId === sourceId,
    );
    if (source) return source;
  }
  return undefined;
}

/** Exact-id registration check (static sources + live family members). */
export function isExchangeSourceRegistered(
  sourceId: string,
  view: RuntimeView,
): boolean {
  if (getExchangeSource(sourceId)) return true;
  return registeredExchangeFamilies().some((family) =>
    family.memberIds(view).includes(sourceId),
  );
}

/**
 * Resolve a source id to its full exchange for the current view. Returns null
 * for unregistered ids and for registered ids whose content preconditions are
 * not present in the view (callers decide whether that is an error).
 */
export function resolveExchangeForSource(
  sourceId: string,
  view: RuntimeView,
  spaceId: string,
  tick: number,
  fieldSeed: number,
): Exchange | null {
  const source = getExchangeSource(sourceId);
  if (source) {
    return source.kind === "EXCHANGE"
      ? source.resolve(view, spaceId, tick, fieldSeed)
      : null;
  }
  for (const family of registeredExchangeFamilies()) {
    if (family.memberIds(view).includes(sourceId)) {
      return family.resolve(sourceId, view, spaceId, tick, fieldSeed);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Field-event construction. Pure and unit-tested: payloads, ids, and ordering
// must stay byte-identical to what ReactiveNpcDirector / M4ContentDirector
// emitted (existing saves replay against these exact shapes).
// ---------------------------------------------------------------------------

/**
 * Interrupt id for a fresh engagement. Suffixed with the committed-event count
 * so an exchange re-engaged after an Escape-abandon never reuses the abandoned
 * attempt's eventId (the runtime rejects duplicate eventIds) while staying
 * deterministic per action history.
 */
export function exchangeInterruptId(
  exchange: Exchange,
  interactionOrdinal: number,
  committedEventCount: number,
): string {
  return `${exchange.engine.interruptIdPrefix}_${exchange.sourceId}_${
    interactionOrdinal + 1
  }_${committedEventCount}`;
}

export function exchangeStartEvent(
  exchange: Exchange,
  interruptId: string,
): FieldCommittedEvent {
  return {
    type: "FIELD_INTERRUPT_STARTED",
    eventId: `${interruptId}_START`,
    interruptId,
    interruptKind: "REACTIVE_EXCHANGE",
    sourceId: exchange.sourceId,
  };
}

export function exchangeCompletionEvent(
  exchange: Exchange,
  choice: ExchangeChoice,
  interruptId: string,
  interactionOrdinal: number,
): FieldCommittedEvent {
  const completion: ReactiveCompletionEffects = {
    interactionId: `${exchange.sourceId}:${interactionOrdinal + 1}`,
    sourceId: exchange.sourceId,
    outcomeId: choice.id,
    ...choice.effects,
  };
  return exchange.engine.completionEvent === "FIELD_REACTIVE_OUTCOME_SELECTED"
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
}

export function exchangeResolvedEvent(
  interruptId: string,
  outcome: string,
): FieldCommittedEvent {
  return {
    type: "FIELD_INTERRUPT_RESOLVED",
    eventId: `${interruptId}_RESOLVED`,
    interruptId,
    outcome,
  };
}

/**
 * Reconstruction of an interrupt whose completion committed but whose
 * resolution never did (save landed inside the reply dwell) and whose source
 * content can no longer produce the original exchange. The panel replays a
 * neutral acknowledgement and the engine resolves with the recorded outcome.
 * Copy is byte-identical to the legacy M4ContentDirector fallback.
 */
export function completedFallbackExchange(
  sourceId: string,
  outcomeId: string,
): Exchange {
  return {
    sourceId,
    title: "Field interaction complete",
    line: "The Archive has retained the completed outcome.",
    position: [0, 0, 0],
    choices: [
      {
        id: outcomeId,
        label: "Continue",
        reply: "The Archive has retained the completed outcome.",
        effects: {},
      },
    ],
    engine: {
      interruptIdPrefix: "M4",
      completionEvent: "FIELD_REACTIVE_COMPLETED",
      beginClip: "search",
      panelZRange: [25, 10],
      dismissButton: false,
    },
  };
}
