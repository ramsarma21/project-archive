// The PvP session: one lobby, one match, one poll loop.
//
// The loop is a recursive timeout rather than an interval, so a slow response can
// never stack requests on a school network, and its period follows the phase —
// fast while the fight is live, slow while a question is open and nothing is
// moving. See `pollIntervalFor`.
//
// WHAT THIS DOES NOT DO. It does not simulate. There is no predicted position, no
// local hit detection, no optimistic health. Every number on screen came from a
// snapshot the server minted. That is what makes the transport swappable: when
// `packages/netcode` replaces polling with a socket, this file's job — hold the
// latest snapshot, hand up input, surface refusals — is unchanged, and the only
// edit is which `PvpTransport` it is given.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FIELD_TICK_HZ, type DuelSide } from "@pa/duel";
import { createDuelInput, type DuelInputController } from "../duel/duelInput.js";
import { EMPTY_PROGRESS, observeProgress, type MatchProgress } from "./progress.js";
import {
  frameFrom,
  httpPvpTransport,
  pollIntervalFor,
  type IntentFrame,
  type MatchResultPayload,
  type MatchSnapshot,
  type PvpIdentity,
  type PvpTransport,
  type QuestionPayload,
} from "./protocol.js";

export type PvpPhase =
  | { readonly name: "IDLE" }
  | { readonly name: "HOSTING"; readonly code: string; readonly handle: string }
  | { readonly name: "MATCH"; readonly matchId: string; readonly side: DuelSide }
  | {
      readonly name: "RESULT";
      readonly matchId: string;
      readonly side: DuelSide;
      readonly result: MatchResultPayload;
    };

export interface PvpSession {
  /** Null until the first identity read answers. */
  readonly identity: PvpIdentity | null;
  readonly phase: PvpPhase;
  readonly snapshot: MatchSnapshot | null;
  readonly question: QuestionPayload | null;
  readonly progress: MatchProgress;
  /** The verdict for the round this player last answered. Their own, never theirs. */
  readonly lastVerdict: "CORRECT" | "WRONG" | null;
  /** Why this player's evidence fell short last round, if it did. A class, never the answer. */
  readonly lastEvidence: string | null;
  readonly answering: boolean;
  readonly busy: boolean;
  /** A refusal the player needs to read: LOBBY_NOT_FOUND, CANNOT_DUEL_YOURSELF… */
  readonly error: string | null;
  /** True when the last call could not be completed. Not a refusal. */
  readonly offline: boolean;
  /** Intent frames the authority refused, newest last. Diagnostics, surfaced. */
  readonly rejected: readonly string[];
  readonly input: DuelInputController;
  host(): Promise<void>;
  join(code: string): Promise<void>;
  cancel(): Promise<void>;
  submitAnswer(text: string, selectedCardIds: readonly string[]): Promise<void>;
  forfeit(): Promise<void>;
  reset(): void;
  setAim(x: number, z: number): void;
  setCameraYaw(yaw: number): void;
  /**
   * Bind gameplay pointer input to the arena canvas — the ONLY place PvP captures a
   * pointer. Routed to ArenaStage, which calls it with the WebGL canvas. Returns the
   * detach, so the canvas owns the listeners for exactly as long as it is mounted.
   */
  bindInput(canvas: HTMLElement): () => void;
}

/** Phases in which the authority is accepting movement and fire. */
function playable(snapshot: MatchSnapshot | null): boolean {
  if (!snapshot) return false;
  return (
    snapshot.phase === "ENGAGEMENT_LIVE" ||
    snapshot.phase === "FACE_OFF" ||
    snapshot.phase === "BULLETS_GRANTED" ||
    snapshot.phase === "LINE_OF_SIGHT_BREAK" ||
    snapshot.phase === "ROUND_RESOLVED"
  );
}

export function usePvpSession(
  transport: PvpTransport = httpPvpTransport,
): PvpSession {
  const [identity, setIdentity] = useState<PvpIdentity | null>(null);
  const [phase, setPhase] = useState<PvpPhase>({ name: "IDLE" });
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
  const [question, setQuestion] = useState<QuestionPayload | null>(null);
  const [progress, setProgress] = useState<MatchProgress>(EMPTY_PROGRESS);
  const [lastVerdict, setLastVerdict] = useState<"CORRECT" | "WRONG" | null>(null);
  const [lastEvidence, setLastEvidence] = useState<string | null>(null);
  const [answering, setAnswering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [rejected, setRejected] = useState<readonly string[]>([]);

  // PvP mode: the canvas exclusively owns pointer gameplay, and edges are acked by
  // receipt rather than cleared per frame. Attached to the canvas by `bindInput`
  // (routed to ArenaStage), never to the window, so the HUD and the answer form never
  // emit gameplay.
  const input = useMemo(() => createDuelInput({ mode: "pvp" }), []);
  const seq = useRef(0);
  // The tick the last snapshot carried, when it arrived, and how long the round
  // trip is taking — all three are needed to stamp a frame the authority will
  // still accept. See `nextFrame`.
  const clock = useRef({ tick: 0, atMs: 0, rttMs: 0 });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  // A new match cancels any edges or held movement left from the last one, so a click
  // made at the end of one duel cannot fire into the start of the next.
  const activeMatchId =
    phase.name === "MATCH" || phase.name === "RESULT" ? phase.matchId : null;
  useEffect(() => {
    if (activeMatchId) input.cancel();
  }, [input, activeMatchId]);

  // Read once on mount. A window with no session is the normal state of the second
  // browser profile, and the lobby needs to offer a way in rather than a refusal.
  //
  // RELOAD RECOVERY. A browser refreshed mid-duel arrives on IDLE having forgotten the
  // match it was in. Once the identity read confirms a session, ask the server what
  // this profile is currently committed to and restore the phase: back into a live
  // MATCH, onto the terminal RESULT screen, or onto the HOSTING screen for an open
  // lobby. Only from IDLE, so a recovery in flight never clobbers an action the player
  // took in the meantime, and only when authenticated, because an anonymous window has
  // nothing to recover.
  useEffect(() => {
    let cancelled = false;
    void transport.identity().then(async (call) => {
      if (cancelled) return;
      const resolved =
        call.status === "OK"
          ? call.value
          : {
              authenticated: false,
              displayName: null,
              profileId: null,
              csrfToken: null,
            };
      setIdentity(resolved);
      if (!resolved.authenticated) return;

      const active = await transport.active();
      if (cancelled || active.status !== "OK") return;
      const state = active.value;
      setPhase((current) => {
        if (current.name !== "IDLE") return current;
        if (state.kind === "MATCH" && state.matchId && state.side) {
          seq.current = 0;
          setProgress(EMPTY_PROGRESS);
          return { name: "MATCH", matchId: state.matchId, side: state.side };
        }
        if (state.kind === "RESULT" && state.matchId && state.side && state.result) {
          return {
            name: "RESULT",
            matchId: state.matchId,
            side: state.side,
            result: state.result,
          };
        }
        if (state.kind === "LOBBY" && state.code) {
          return {
            name: "HOSTING",
            code: state.code,
            handle: state.handle ?? resolved.displayName ?? "",
          };
        }
        return current;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [transport]);

  const ingest = useCallback(
    (next: MatchSnapshot, result: MatchResultPayload | null) => {
      setSnapshot(next);
      setProgress((current) => observeProgress(current, next));
      clock.current = { ...clock.current, tick: next.tick, atMs: Date.now() };
      if (result) {
        setPhase((current) =>
          current.name === "MATCH"
            ? {
                name: "RESULT",
                matchId: current.matchId,
                side: current.side,
                result,
              }
            : current,
        );
      }
    },
    [],
  );

  /**
   * Stamp a frame for the tick the server will be on WHEN THE FRAME ARRIVES.
   *
   * The authority refuses a frame more than eight ticks ahead of its clock or
   * twelve behind, and the naive estimate — last snapshot tick plus the time since
   * it arrived — is short by a full round trip. Half of it because the snapshot was
   * sampled before the response travelled back, and half again because the frame
   * has to travel out. At 60Hz twelve ticks is 200ms, so a connection past roughly
   * 200ms round trip has EVERY frame refused, and the mode presents as controls
   * that do nothing at all rather than as a network problem.
   *
   * So the round trip is measured and added. The estimate is smoothed, because the
   * window is only 133ms wide on the leading side and a single slow response should
   * not push the next frame past it.
   *
   * PURE with respect to the edges: `sampleIntent` clears nothing; the receipt it
   * returns is acknowledged only if the authority accepts the frame.
   */
  const nextFrame = useCallback((): { frame: IntentFrame; receipt: readonly number[] } => {
    const { tick, atMs, rttMs } = clock.current;
    const aheadMs = Date.now() - atMs + rttMs;
    seq.current += 1;
    const sampled = input.sampleIntent();
    return {
      frame: frameFrom(
        sampled.intent,
        seq.current,
        Math.max(0, tick + Math.round((aheadMs / 1000) * FIELD_TICK_HZ)),
      ),
      receipt: sampled.receipt,
    };
  }, [input]);

  /** Smoothing factor for the round-trip estimate. Favours history over a spike. */
  const RTT_SMOOTHING = 0.3;

  const observeRoundTrip = useCallback((sentAtMs: number): void => {
    const sample = Date.now() - sentAtMs;
    const previous = clock.current.rttMs;
    clock.current = {
      ...clock.current,
      rttMs: previous === 0 ? sample : previous * (1 - RTT_SMOOTHING) + sample * RTT_SMOOTHING,
    };
  }, []);

  // ---- the loop ------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async (): Promise<void> => {
      const current = phaseRef.current;
      if (cancelled) return;

      if (current.name === "HOSTING") {
        const read = await transport.readLobby(current.code);
        if (cancelled) return;
        if (read.status === "OK") {
          setOffline(false);
          if (read.value.status === "STARTED" && read.value.matchId) {
            seq.current = 0;
            setProgress(EMPTY_PROGRESS);
            setPhase({
              name: "MATCH",
              matchId: read.value.matchId,
              side: read.value.side,
            });
          }
        } else if (read.status === "UNREACHABLE") {
          setOffline(true);
        } else if (read.error === "LOBBY_NOT_FOUND") {
          // The host's own lobby has gone: the server restarted, or it expired.
          // Say so and go back rather than polling a code nobody can join.
          setError("LOBBY_NOT_FOUND");
          setPhase({ name: "IDLE" });
        }
      } else if (current.name === "MATCH") {
        const live = playable(snapshotRef.current);
        // While the fight is live the intent post doubles as the read: it carries
        // this frame up and brings the snapshot back, so one round trip does both.
        // While a question is open there is no input to send and the read is the
        // only thing that carries the question text.
        const sentAt = Date.now();
        let sentReceipt: readonly number[] = [];
        let call;
        if (live) {
          const next = nextFrame();
          sentReceipt = next.receipt;
          call = await transport.sendIntents(current.matchId, [next.frame]);
        } else {
          call = await transport.readMatch(current.matchId);
        }
        if (cancelled) return;
        observeRoundTrip(sentAt);
        if (call.status === "OK") {
          setOffline(false);
          const value = call.value;
          ingest(value.snapshot, value.result);
          // Only the read carries a question, and only the intent post reports
          // refused frames, so each is taken from whichever call actually made it.
          if ("question" in value) setQuestion(value.question);
          if ("rejected" in value) {
            const refused = value.rejected;
            if (refused.length > 0) {
              setRejected((prior) => [...prior, ...refused].slice(-8));
            }
            // ACCEPTED clears exactly the ids this frame carried; a refusal preserves
            // them so the press rides the next poll. A press made AFTER this frame was
            // sampled is not in the receipt, so an ack can never clear a newer press.
            if (refused.length === 0) input.acknowledge(sentReceipt);
          }
        } else if (call.status === "UNREACHABLE") {
          // Says nothing about the match. Keep the last snapshot on screen and keep
          // polling; the authority forfeits a genuinely silent side itself — and the
          // press is preserved (never acknowledged), because nothing received it.
          setOffline(true);
        } else if (call.error === "MATCH_NOT_FOUND") {
          setError("MATCH_NOT_FOUND");
          setPhase({ name: "IDLE" });
        }
      }

      if (cancelled) return;
      const period =
        phaseRef.current.name === "MATCH"
          ? pollIntervalFor(snapshotRef.current?.phase ?? null)
          : pollIntervalFor(null);
      timer = setTimeout(() => void tick(), period);
    };

    timer = setTimeout(() => void tick(), 0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [transport, ingest, nextFrame, input, observeRoundTrip]);

  // Movement is suspended while a question is open, so a player typing an answer
  // does not walk into the open. The authority would accept the frames; the design
  // says the answering phase is not a fight phase.
  useEffect(() => {
    input.setEnabled(playable(snapshot));
  }, [input, snapshot]);

  // ---- commands ------------------------------------------------------------

  const host = useCallback(async () => {
    setBusy(true);
    setError(null);
    const created = await transport.createLobby();
    setBusy(false);
    if (created.status === "OK") {
      setPhase({
        name: "HOSTING",
        code: created.value.code,
        handle: created.value.handle,
      });
    } else if (created.status === "REFUSED") {
      setError(created.error);
    } else {
      setOffline(true);
      setError("API_UNREACHABLE");
    }
  }, [transport]);

  const join = useCallback(
    async (code: string) => {
      setBusy(true);
      setError(null);
      const joined = await transport.joinLobby(code.trim().toUpperCase());
      setBusy(false);
      if (joined.status === "OK") {
        seq.current = 0;
        setProgress(EMPTY_PROGRESS);
        setPhase({
          name: "MATCH",
          matchId: joined.value.matchId,
          side: joined.value.side,
        });
      } else if (joined.status === "REFUSED") {
        setError(joined.error);
      } else {
        setOffline(true);
        setError("API_UNREACHABLE");
      }
    },
    [transport],
  );

  const cancel = useCallback(async () => {
    const current = phaseRef.current;
    if (current.name !== "HOSTING") return;
    await transport.cancelLobby(current.code);
    setPhase({ name: "IDLE" });
  }, [transport]);

  const submitAnswer = useCallback(
    async (text: string, selectedCardIds: readonly string[]) => {
      const current = phaseRef.current;
      if (current.name !== "MATCH" || text.trim().length === 0) return;
      setAnswering(true);
      setError(null);
      const sent = await transport.answer(current.matchId, text.trim(), selectedCardIds);
      setAnswering(false);
      if (sent.status === "OK") {
        setLastVerdict(sent.value.verdict);
        setLastEvidence(sent.value.evidence ?? null);
        setQuestion(null);
        ingest(sent.value.snapshot, null);
      } else if (sent.status === "REFUSED") {
        setError(sent.error);
      } else {
        setOffline(true);
        setError("ANSWER_NOT_DELIVERED");
      }
    },
    [transport, ingest],
  );

  const forfeit = useCallback(async () => {
    const current = phaseRef.current;
    if (current.name !== "MATCH") return;
    const done = await transport.forfeit(current.matchId);
    if (done.status === "OK" && done.value.result) {
      setPhase({
        name: "RESULT",
        matchId: current.matchId,
        side: current.side,
        result: done.value.result,
      });
    }
  }, [transport]);

  const reset = useCallback(() => {
    setPhase({ name: "IDLE" });
    setSnapshot(null);
    setQuestion(null);
    setProgress(EMPTY_PROGRESS);
    setLastVerdict(null);
    setLastEvidence(null);
    setRejected([]);
    setError(null);
    seq.current = 0;
  }, []);

  // STABLE across every snapshot/session render. `input` is created once, so this
  // binder never changes identity — the canvas's attach effect (InputCapture) runs
  // exactly once for the life of the canvas instead of detaching and reattaching on
  // every poll, which would clear held movement and drop any edge queued between polls.
  const bindInput = useCallback(
    (canvas: HTMLElement) => input.attach(canvas),
    [input],
  );

  return {
    identity,
    phase,
    snapshot,
    question,
    progress,
    lastVerdict,
    lastEvidence,
    answering,
    busy,
    error,
    offline,
    rejected,
    input,
    host,
    join,
    cancel,
    submitAnswer,
    forfeit,
    reset,
    setAim: (x, z) => input.setAim(x, z),
    setCameraYaw: (yaw) => input.setCameraYaw(yaw),
    bindInput,
  };
}
