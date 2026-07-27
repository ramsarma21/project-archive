// Server refusal codes, in English.
//
// Every string the server can refuse with is a real situation a thirteen-year-old
// has to act on, so each one says what to DO rather than restating the code. The
// codes themselves come from @pa/pvp's `JoinRefusal`, `EligibilityRefusal` and the
// route's own error names; an unmapped code falls through readably rather than
// rendering a blank box.

/** @pa/pvp's `MATCH_CODE_LENGTH`. Restated because @pa/web does not depend on it. */
export const MATCH_CODE_LENGTH = 6;

const TEXT: Readonly<Record<string, string>> = {
  AUTH_REQUIRED:
    "You are not signed in. Sign in with Google in this window, then try again.",
  CANNOT_DUEL_YOURSELF:
    "That is your own lobby. A duel needs two different accounts — open the second window as a private/incognito window and sign in there with the other account.",
  LOBBY_NOT_FOUND:
    "No lobby with that code. Check the characters, or ask for a fresh one — a lobby expires after fifteen minutes and the server forgets every lobby when it restarts.",
  LOBBY_NOT_OPEN: "Somebody already joined that lobby.",
  LOBBY_EXPIRED: "That lobby timed out. Open a new one.",
  ALREADY_IN_LOBBY: "You are already in a lobby.",
  LOBBY_ALREADY_OPEN:
    "You already have a lobby open. Use its code, or cancel it before opening another.",
  ACTIVE_MATCH_EXISTS:
    "You are already in a duel. Finish it — or forfeit it — before starting another.",
  ABILITIES_NOT_ACCEPTED:
    "Abilities are not part of PvP yet, so a loadout cannot be sent. Try again without one.",
  CARDS_NOT_ACCEPTED:
    "The server decides which Codex cards you carry into PvP — they cannot be sent from here. Try again without them.",
  MATCH_CODE_INVALID:
    "That is not a match code. They are six characters, and they never contain O, I, L, 0 or 1.",
  MATCH_NOT_FOUND:
    "That match is gone. The server restarts clear live matches — PvP state is in memory for now.",
  NOT_IN_MATCH: "You are not one of the two fighters in that match.",
  NOT_IN_LOBBY: "You are not in that lobby.",
  NOT_LOBBY_HOST: "Only the player who opened the lobby can cancel it.",
  MATCH_NOT_STARTED: "The match could not be built. Nothing was staked.",
  NO_QUESTIONS:
    "No question could be drawn that both players are allowed to be asked.",
  NO_QUESTION_THIS_ROUND:
    "The server has no question for this round. The bank ran out — this is a content gap, not your mistake.",
  CHAPTER_NOT_COMPLETE: "PvP unlocks when you have finished a chapter.",
  NO_PVP_LEGAL_CARDS:
    "You have not mastered a concept to 100% on a capstone yet, so there is nothing you can be asked.",
  ANSWER_REQUIRED: "Write an answer before sending it.",
  ANSWER_TOO_LONG: "That answer is too long. Tighten it and send again.",
  ANSWER_NOT_DELIVERED:
    "The answer did not reach the server. Nothing was graded — send it again.",
  RECEIPT_INVALID:
    "The server would not accept its own verdict for this round. Report this; do not keep playing on it.",
  NOT_AWAITING_VERDICTS: "That round is no longer taking answers.",
  SIDE_ALREADY_COMMITTED: "You have already answered this round.",
  WRONG_ITEM: "That answer was for a different question.",
  API_UNREACHABLE:
    "The API is not answering. Check that it is running on port 3001.",
  HANDLE_GENERATION_FAILED: "The server could not mint a handle for you.",
  LOBBY_INCONSISTENT: "The lobby is in a state the server cannot start from.",
};

export function refusalText(code: string): string {
  const known = TEXT[code];
  if (known) return known;
  // Cosmetic refusals arrive as COSMETICS_<reason>; there is no useful detail to
  // add beyond naming the field, and the default loadout is always accepted.
  if (code.startsWith("COSMETICS_")) {
    return "That cosmetic loadout was refused. The default one always works.";
  }
  return `The server refused this: ${code}.`;
}
