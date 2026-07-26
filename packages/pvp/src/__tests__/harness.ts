// Shared PvP test harness: two members, a lobby, a live authority, and a stub verdict
// authority that behaves exactly like the real one at the trust boundary.

import { FIELD_DT, referenceArena } from "@pa/duel";
import {
  advanceMatch,
  createPvpMatch,
  submitVerdict,
  type PvpAuthority,
  type PvpVerdictEnvelope,
  type ReceiptVerifier,
} from "../authority.js";
// `selectRoundQuestions` is no longer used here: the fixture hands the duel the
// whole askable bank and lets `askQuestion` choose each round, which is what the
// production route does. The function is still exported and still tested directly
// in policy.test.ts.
import { askableItems, parseQuestionBank, type PvpQuestionBank } from "../questionPool.js";
import { createLobby, joinLobby, lobbySides, type LobbyMember } from "../lobby.js";
import { DEFAULT_COSMETIC_LOADOUT } from "../cosmetics.js";
import { generateHandle } from "../handles.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function loadM1Bank(): PvpQuestionBank {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "../../../../content/m1/duel-items.json");
  const parsed = parseQuestionBank(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.bank;
}

export function member(
  profileId: string,
  overrides: Partial<LobbyMember> = {},
): LobbyMember {
  return {
    profileId,
    handle: generateHandle(profileId).handle,
    rank: 1,
    unlockedAbilityIds: [],
    cosmetics: DEFAULT_COSMETIC_LOADOUT,
    pvpLegalCardIds: [],
    ...overrides,
  };
}

/** A stub standing in for @pa/grading's HMAC. Same shape, same refusals. */
export function stubVerifier(secret = "test-secret"): ReceiptVerifier {
  return (envelope, binding, receipt) => receipt === expectedReceipt(envelope, binding, secret);
}

export function expectedReceipt(
  envelope: PvpVerdictEnvelope,
  binding: { profileId: string; attemptId: string; roundIndex: number },
  secret = "test-secret",
): string {
  return [
    secret,
    binding.profileId,
    binding.attemptId,
    String(binding.roundIndex),
    envelope.itemId,
    envelope.itemVersion,
    envelope.kind,
    envelope.source,
    envelope.responseRef ?? "",
  ].join("|");
}

export function envelopeFor(
  itemId: string,
  kind: "CORRECT" | "WRONG",
): PvpVerdictEnvelope {
  return {
    kind,
    itemId,
    itemVersion: "v1",
    source: "CLASSIFIER",
    responseRef: `resp_${itemId}_${kind}`,
  };
}

export interface LiveFixture {
  authority: PvpAuthority;
  readonly questions: readonly { itemId: string }[];
  readonly verify: ReceiptVerifier;
}

/**
 * The whole direct-match path, as a fixture: create, join, draw, start.
 *
 * THE DRAW IS THE WHOLE ASKABLE BANK AND THE CEILING IS THE DUEL'S OWN. This used
 * to draw six and pass `rounds: 6` to `createPvpMatch`, which quietly became the
 * duel's round ceiling — so the package's tests only ever ran six-round duels,
 * against a production route that passes the whole pool and leaves the ceiling at
 * `DUEL_ROUND_CEILING`. A fixture that pins a bound production does not pin cannot
 * catch anything past it, which is exactly where an open-ended duel now lives.
 */
export function liveMatch(): LiveFixture {
  const host = member("profile-host");
  const guest = member("profile-guest");
  const lobby = createLobby(host, 1_000_000);
  const joined = joinLobby(lobby, guest, 1_000_100);
  if (!joined.ok) throw new Error(joined.reason);
  const sides = lobbySides(joined.lobby);
  if (!sides) throw new Error("no sides");

  const bank = loadM1Bank();
  const questions = askableItems(bank, { A: [], B: [] });
  if (questions.length === 0) throw new Error("the bank produced no askable items");

  const arena = referenceArena();
  const created = createPvpMatch({
    identity: { matchId: `pvp_${joined.lobby.code}`, seed: joined.lobby.seed, startedAtMs: 0 },
    participants: { A: sides.A, B: sides.B },
    world: arena.world,
    // No `rounds`: the ceiling belongs to @pa/duel, and which item a round asks
    // belongs to `askQuestion`. Handing over the pool is the whole contract.
    questions,
    placement: arena.placement,
  });
  if (!created.ok) throw new Error(created.reason);
  return { authority: created.authority, questions, verify: stubVerifier() };
}

/**
 * The item the AUTHORITY is asking right now.
 *
 * Not `questions[round - 1]`. A duel outlasts its bank, so @pa/duel chooses each
 * round's item with `askQuestion` — a seeded permutation that reshuffles per lap —
 * and the index and the draw stopped agreeing the moment that landed. Every test
 * that built a verdict from the index was refused on WRONG_ITEM before it reached
 * the check it was written for, which is a worse failure than a red assertion:
 * `submitVerdict` returns `ok: false` either way, so a test that only asserted
 * "refused" went on passing while checking nothing.
 */
export function askedItem(authority: PvpAuthority): { itemId: string; itemVersion: string } {
  const state = authority.state;
  if (state.phase !== "QUESTION_PENDING") {
    throw new Error(`no question is being asked in phase ${state.phase}`);
  }
  return { itemId: state.item.itemId, itemVersion: state.item.itemVersion };
}

/** The envelope the honest grader would mint for the round being asked. */
export function askedEnvelope(
  authority: PvpAuthority,
  kind: "CORRECT" | "WRONG",
): PvpVerdictEnvelope {
  const item = askedItem(authority);
  return { ...envelopeFor(item.itemId, kind), itemVersion: item.itemVersion };
}

/**
 * An item the authority is definitely NOT asking, for the tests that are about
 * item mismatch. Derived rather than indexed, so it cannot accidentally become the
 * asked item when the seed changes and quietly stop testing anything.
 */
export function unaskedItem(
  authority: PvpAuthority,
  questions: readonly { itemId: string }[],
): { itemId: string } {
  const asked = askedItem(authority).itemId;
  const other = questions.find((question) => question.itemId !== asked);
  if (!other) throw new Error("the bank has only one item; nothing is unasked");
  return other;
}

/** Advance the authority until a predicate holds, or throw. */
export function advanceUntil(
  authority: PvpAuthority,
  predicate: (authority: PvpAuthority) => boolean,
  limit = 4000,
): PvpAuthority {
  let current = authority;
  for (let step = 0; step < limit; step++) {
    if (predicate(current)) return current;
    current = advanceMatch(current, FIELD_DT).authority;
  }
  if (predicate(current)) return current;
  throw new Error(
    `predicate never held; phase ${current.phase} duel ${current.state.phase} tick ${current.state.combat.tick}`,
  );
}

/** Commit both sides' verdicts for the round that is currently being asked. */
export function answerRound(
  fixture: LiveFixture,
  kinds: { A: "CORRECT" | "WRONG"; B: "CORRECT" | "WRONG" },
): PvpAuthority {
  let authority = fixture.authority;
  const round = authority.state.round;
  for (const side of ["A", "B"] as const) {
    // Asked, not indexed — see `askedItem`. Re-read inside the loop because the
    // first commit moves the machine and the second must agree with it.
    const envelope = askedEnvelope(authority, kinds[side]);
    const receipt = expectedReceipt(envelope, {
      profileId: authority.participants[side].profileId,
      attemptId: authority.identity.matchId,
      roundIndex: round,
    });
    const result = submitVerdict(authority, side, envelope, receipt, fixture.verify);
    if (!result.ok) throw new Error(`${side}: ${result.reason} ${result.detail}`);
    authority = result.authority;
  }
  return authority;
}
