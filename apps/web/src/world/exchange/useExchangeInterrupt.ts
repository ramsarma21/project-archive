// ---------------------------------------------------------------------------
// The ONE exchange-interrupt engine (refactor wave 2). Owns:
//   - candidate hand-off: begin(sourceId) resolves through the source registry
//   - begin/finish/dismiss lifecycle + unique interrupt ids
//   - resume-from-activeInterrupt reconstruction for EVERY registered source
//   - input-lock / interaction-clip choreography
//   - the reply dwell (reduced motion keeps a nonzero dwell)
//   - resolution submission through the typed field-event path
//
// Ported from the duplicated engines in ReactiveNpcDirector (M3 sources) and
// M4ContentDirector (M4 sources). Event payloads, ids, and ordering are
// byte-identical to both legacy copies (see exchangeSources event builders).
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import type { RuntimeView } from "@pa/contracts";
import type { PlayerApi } from "../Player.js";
import { effectChips, MICRO_LABELS } from "../reactiveManifest.js";
import { useWorldServices } from "../WorldServicesContext.js";
import {
  completedFallbackExchange,
  exchangeCompletionEvent,
  exchangeInterruptId,
  exchangeResolvedEvent,
  exchangeStartEvent,
  isExchangeSourceRegistered,
  resolveExchangeForSource,
  type Exchange,
  type ExchangeChoice,
} from "./exchangeSources.js";

export interface ExchangeInterruptApi {
  exchange: Exchange | null;
  reply: string | null;
  replyChips: string[];
  committing: boolean;
  /** True while candidates may offer new exchanges (no active panel/commit). */
  offersOpen: boolean;
  /** Deterministic world seed shared by the engine and route-posed staging. */
  fieldSeed: number;
  begin: (sourceId: string) => Promise<void>;
  finish: (choice: ExchangeChoice) => Promise<void>;
  dismiss: () => Promise<void>;
}

export function useExchangeInterrupt(props: {
  view: RuntimeView;
  apiRef: { current: PlayerApi | null };
  enabled: boolean;
  // Exchanges commit field interrupts, which the runtime accepts only during
  // FREE_ROAM. When false, content stays visible but no exchange may begin.
  exchangesEnabled?: boolean;
  reducedMotion: boolean;
}): ExchangeInterruptApi {
  const services = useWorldServices();
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [replyChips, setReplyChips] = useState<string[]>([]);
  const [committing, setCommitting] = useState(false);
  const interruptRef = useRef<string | null>(null);
  const resolutionTimer = useRef(0);
  const warnedUnregistered = useRef(new Set<string>());
  const fieldSeed = useMemo(
    () => Number.parseInt(props.view.field.seedHex.slice(0, 8), 16) || 1765,
    [props.view.field.seedHex],
  );
  const replyDwellMs = props.reducedMotion ? 900 : 2400;

  const clearPanel = () => {
    interruptRef.current = null;
    setReply(null);
    setReplyChips([]);
    setExchange(null);
  };

  const unlockPlayer = () => {
    props.apiRef.current?.setInputLocked(false);
    props.apiRef.current?.setInteractionClip(null);
  };

  // Resume: an activeInterrupt with no local panel state means the exchange
  // was interrupted by a reload. Reconstruct it from the source registry; if
  // the completion already committed (save landed inside the reply dwell),
  // replay the reply and schedule the resolution the dwell owed.
  useEffect(() => {
    const interrupt = props.view.field.activeInterrupt;
    if (
      interrupt?.kind !== "REACTIVE_EXCHANGE" ||
      exchange ||
      interruptRef.current
    ) {
      return;
    }
    const sourceId = interrupt.sourceId ?? "";
    if (!isExchangeSourceRegistered(sourceId, props.view)) {
      // Wave-2 stage A: M4ContentDirector still owns its sources and QA
      // harnesses drive synthetic interrupts; both must stay untouched here.
      // Stage B replaces this silent return with a loud unregistered report.
      return;
    }
    const completed = [...props.view.field.reactiveCompletions]
      .reverse()
      .find((record) => record.sourceId === sourceId);
    const resumed =
      resolveExchangeForSource(
        sourceId,
        props.view,
        services.spaceId,
        services.fieldTickRef.current,
        fieldSeed,
      ) ??
      (completed
        ? completedFallbackExchange(sourceId, completed.outcomeId)
        : null);
    if (!resumed) return;
    interruptRef.current = interrupt.interruptId;
    props.apiRef.current?.setInputLocked(true);
    setExchange(resumed);
    const completedChoice = completed
      ? resumed.choices.find((choice) => choice.id === completed.outcomeId)
      : undefined;
    if (completed && completedChoice) {
      setReply(completedChoice.reply);
      setReplyChips(effectChips(completedChoice.effects, MICRO_LABELS));
      window.clearTimeout(resolutionTimer.current);
      resolutionTimer.current = window.setTimeout(() => {
        void (async () => {
          await services.submitFieldEvent(
            exchangeResolvedEvent(interrupt.interruptId, completed.outcomeId),
          );
          unlockPlayer();
          clearPanel();
        })();
      }, replyDwellMs);
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

  const begin = async (sourceId: string) => {
    if (
      !props.enabled ||
      props.exchangesEnabled === false ||
      exchange ||
      committing
    ) {
      return;
    }
    const next = resolveExchangeForSource(
      sourceId,
      props.view,
      services.spaceId,
      services.fieldTickRef.current,
      fieldSeed,
    );
    if (!next) {
      // A candidate offered a source the registry cannot resolve: an
      // authoring error. Loud (fails browser QA console gates), never a wedge.
      if (!warnedUnregistered.current.has(sourceId)) {
        warnedUnregistered.current.add(sourceId);
        console.error(
          `[exchange] candidate activated unresolvable source id ${sourceId}`,
        );
      }
      return;
    }
    const interruptId = exchangeInterruptId(
      next,
      props.view.field.interactionOrdinal,
      services.committedEventCount(),
    );
    setCommitting(true);
    const ok = await services.submitFieldEvent(
      exchangeStartEvent(next, interruptId),
    );
    setCommitting(false);
    if (!ok) return;
    interruptRef.current = interruptId;
    props.apiRef.current?.setInputLocked(true);
    props.apiRef.current?.setInteractionClip(next.engine.beginClip);
    setExchange(next);
  };

  const finish = async (choice: ExchangeChoice) => {
    const active = exchange;
    const interruptId = interruptRef.current;
    if (!active || !interruptId || committing) return;
    setCommitting(true);
    setReply(choice.reply);
    setReplyChips(effectChips(choice.effects, MICRO_LABELS));
    if (choice.actionClip !== undefined) {
      props.apiRef.current?.setInteractionClip(choice.actionClip);
    }
    const completed = await services.submitFieldEvent(
      exchangeCompletionEvent(
        active,
        choice,
        interruptId,
        props.view.field.interactionOrdinal,
      ),
    );
    if (completed) {
      setCommitting(false);
      window.clearTimeout(resolutionTimer.current);
      resolutionTimer.current = window.setTimeout(() => {
        void (async () => {
          await services.submitFieldEvent(
            exchangeResolvedEvent(interruptId, choice.id),
          );
          await choice.afterCommit?.({
            view: props.view,
            submitFieldEvent: services.submitFieldEvent,
          });
          unlockPlayer();
          clearPanel();
        })();
      }, replyDwellMs);
      return;
    }
    unlockPlayer();
    setCommitting(false);
    clearPanel();
  };

  // Universal Escape dismissal (feel-audit-1 P0-2): abandon the exchange
  // without committing an outcome. Input unlocks, the suspended plan
  // restores, and no effect is recorded.
  const dismiss = async () => {
    const interruptId = interruptRef.current;
    if (!exchange || !interruptId || committing || reply) return;
    setCommitting(true);
    const resolved = await services.submitFieldEvent(
      exchangeResolvedEvent(interruptId, "ABANDONED"),
    );
    setCommitting(false);
    if (!resolved) return;
    unlockPlayer();
    clearPanel();
  };

  // One keyboard model for every exchange panel (feel-audit-1 P0-2/P1-1):
  // the advertised numeric hotkey commits, Escape abandons.
  useEffect(() => {
    if (!exchange) return;
    const onKey = (event: KeyboardEvent) => {
      if (committing || reply) return;
      if (/^[123]$/.test(event.key)) {
        const choice = exchange.choices[Number(event.key) - 1];
        if (choice) {
          event.preventDefault();
          void finish(choice);
        }
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
    },
    [props.apiRef],
  );

  return {
    exchange,
    reply,
    replyChips,
    committing,
    offersOpen: !exchange && !committing && props.exchangesEnabled !== false,
    fieldSeed,
    begin,
    finish,
    dismiss,
  };
}
