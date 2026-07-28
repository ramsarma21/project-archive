#!/usr/bin/env node
// Checks the M1 content package against the claims README.md makes about it.
//
// Content is this project's bottleneck, and the failures that hurt a content
// package are all quiet ones: a module that has drifted past three minutes, a
// duel item that asks for a proposition the module stopped teaching, a Codex
// card cited by an item and defined nowhere. None of those breaks a build. Each
// of them ships a mission that is unfair to a thirteen-year-old.
//
// So every number in README.md is this script's output rather than a hand tally,
// and the answerable-from-the-module claim is an assertion here rather than a
// promise there.
//
// Reads only this directory plus content/staar (read-only), and IMPORTS one number
// it must not restate — @pa/duel's DUEL_ROUND_CEILING — from the source that owns
// it. That import needs the repo's TypeScript loader, so this runs under tsx.
// Run:  node --import tsx content/m1/verify.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => JSON.parse(readFileSync(join(here, rel), "utf8"));

const moduleFile = read("module.json");
const bank = read("duel-items.json");
const codex = read("codex-cards.json");
const concepts = read("concepts.json");
const evalSet = read("eval/duel-answers.labeled.json");

const failures = [];
const warnings = [];
const fail = (m) => failures.push(m);
const warn = (m) => warnings.push(m);

// ---------------------------------------------------------------------------
// Values that belong to another package are READ FROM IT, never copied.
//
// A constant copied into a second file drifts silently, and a checker that
// passes against a number the engine stopped using is worse than no checker. So
// the module length, the concept-id pattern and the shape of ModuleCard are
// parsed out of the source that declares them.
//
// The round ceiling is the one number checked here that is a CONTRACT another
// package owns rather than a shape this file describes, so it is not text-scraped
// at all: it is imported and executed from `@pa/duel`'s own leaf module. Scraping
// it is precisely how it broke — the constant moved from tuning.ts into
// structure.ts and left a bare re-export behind, which no `NAME = <digits>` regex
// can match, so the check quietly warned and stopped verifying. An import cannot
// fail that way silently: if the value cannot be resolved the check FAILS (see
// the invariant below), because a missing contract must never pass as a clean run.
// ---------------------------------------------------------------------------

const repoRoot = join(here, "..", "..");
const CONTRACTS = "packages/contracts/src/progression.ts";
const CURRICULUM_TYPES = "packages/curriculum/src/types.ts";
const MODULE_FORMAT = "apps/web/src/module/moduleFormat.ts";

// The leaf module @pa/duel exports the ceiling from — it has no imports of its
// own, so loading it drags in nothing else. Imported by file path rather than by
// the `@pa/duel/structure` specifier so resolution does not depend on where this
// script is run from; a move of the file surfaces as a loud import failure, which
// is the correct outcome.
const DUEL_STRUCTURE = "packages/duel/src/structure.ts";

async function importRoundCeiling() {
  const href = pathToFileURL(join(repoRoot, DUEL_STRUCTURE)).href;
  const mod = await import(href);
  const value = mod.DUEL_ROUND_CEILING;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `DUEL_ROUND_CEILING imported as ${JSON.stringify(value)}, not a positive integer`,
    );
  }
  return value;
}

function sourceText(relPath) {
  try {
    return readFileSync(join(repoRoot, relPath), "utf8");
  } catch {
    return null;
  }
}

function numberFrom(relPath, name, fallback) {
  const match = sourceText(relPath)?.match(new RegExp(`${name}\\s*(?::[^=]+)?=\\s*(\\d+)`));
  if (match) return Number(match[1]);
  warn(`${name} could not be read from ${relPath}; ${fallback} is unverified`);
  return fallback;
}

function regexFrom(relPath, name, fallback) {
  const match = sourceText(relPath)?.match(new RegExp(`${name}\\s*=\\s*/(.+?)/;`));
  if (match) return new RegExp(match[1]);
  warn(`${name} could not be read from ${relPath}; the fallback pattern is unverified`);
  return fallback;
}

/**
 * Property names of a TypeScript interface. The module player is another
 * agent's file, so a field added there should surface here as a check that
 * noticed rather than as a payload that silently lacks it.
 */
function interfaceKeys(relPath, name, fallback) {
  const text = sourceText(relPath);
  const start = text?.indexOf(`export interface ${name} {`);
  if (text === null || start === undefined || start < 0) {
    warn(`interface ${name} could not be read from ${relPath}; the fallback key list is unverified`);
    return fallback;
  }
  const keys = [];
  let depth = 0;
  for (const line of text.slice(start).split("\n").slice(1)) {
    if (depth === 0 && line.startsWith("}")) break;
    const property = line.match(/^\s{2}(?:readonly\s+)?([A-Za-z_]\w*)\??\s*:/);
    if (depth === 0 && property) keys.push(property[1]);
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
  }
  return keys.length > 0 ? keys : fallback;
}

const CONCEPT_ID = regexFrom(
  CURRICULUM_TYPES,
  "CONCEPT_ID_PATTERN",
  /^[A-Z]{3}\.CONCEPT\.[A-Z][A-Z0-9_]*\.v\d+$/,
);
const MODULE_SECONDS = numberFrom(CONTRACTS, "LEARNING_MODULE_SECONDS", 180);
const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;
/** Lower-cased, punctuation-stripped, whitespace-collapsed. For dedup only. */
const norm = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// ---------------------------------------------------------------------------
// 1. The module: format defects, then the timing arithmetic.
// ---------------------------------------------------------------------------

const deck = moduleFile.module;
const rates = moduleFile.budget.readingRateWpm;
const excerptRate = moduleFile.budget.excerptRateWpm.planning;

// The payload has to be exactly what the player's type declares. An extra key
// is harmless when a consumer casts a parsed object and fatal when one validates
// it, and the module player is being built concurrently by someone else — so the
// conservative rule is that nothing unknown appears inside `module`.
const MODULE_KEYS = interfaceKeys(MODULE_FORMAT, "LearningModuleDefinition", [
  "moduleId",
  "chapterId",
  "missionId",
  "title",
  "subtitle",
  "cards",
]);
const CARD_KEYS = interfaceKeys(MODULE_FORMAT, "ModuleCard", [
  "id",
  "cueId",
  "throughSeconds",
  "kicker",
  "body",
  "excerpt",
  "conceptIds",
  "codexCardIds",
  "advanceLabel",
]);
const EXCERPT_KEYS = interfaceKeys(MODULE_FORMAT, "ModuleSourceExcerpt", [
  "sourceId",
  "title",
  "attribution",
  "lines",
]);
const strayKeys = (object, allowed) => Object.keys(object).filter((k) => !allowed.includes(k));

for (const key of strayKeys(deck, MODULE_KEYS)) {
  fail(`module: LearningModuleDefinition does not declare "${key}"`);
}

const seenCardIds = new Set();
const seenCueIds = new Set();
let previousThrough = 0;
for (const card of deck.cards) {
  for (const key of strayKeys(card, CARD_KEYS)) {
    fail(`module: ModuleCard does not declare "${key}" (on ${card.id})`);
  }
  if (card.excerpt) {
    for (const key of strayKeys(card.excerpt, EXCERPT_KEYS)) {
      fail(`module: ModuleSourceExcerpt does not declare "${key}" (on ${card.id})`);
    }
  }
  if (seenCardIds.has(card.id)) fail(`module: duplicate card id ${card.id}`);
  seenCardIds.add(card.id);
  if (seenCueIds.has(card.cueId)) fail(`module: duplicate cue id ${card.cueId}`);
  seenCueIds.add(card.cueId);
  if (!Number.isInteger(card.throughSeconds) || card.throughSeconds <= previousThrough) {
    fail(`module: ${card.id} ends at ${card.throughSeconds}s, not after ${previousThrough}s`);
  }
  previousThrough = card.throughSeconds;
  if (card.body.length === 0) fail(`module: ${card.id} teaches nothing`);
  if (!card.advanceLabel.trim()) fail(`module: ${card.id} has no advance label`);
  for (const conceptId of card.conceptIds) {
    if (!CONCEPT_ID.test(conceptId)) {
      fail(`module: ${card.id} carries non-canonical concept id ${conceptId}`);
    }
  }
}
const deckSeconds = deck.cards.at(-1).throughSeconds;
if (deckSeconds !== MODULE_SECONDS) {
  fail(`module: deck targets ${deckSeconds}s; every module is exactly ${MODULE_SECONDS}s`);
}

const rows = [];
let from = 0;
let proseWords = 0;
let excerptWords = 0;
for (const card of deck.cards) {
  const prose = words(card.body.join(" "));
  const excerpt = card.excerpt ? words(card.excerpt.lines.join(" ")) : 0;
  const seconds = (prose / rates.planning) * 60 + (excerpt / excerptRate) * 60;
  const window = card.throughSeconds - from;
  rows.push({ kicker: card.kicker, prose, excerpt, seconds, window, slack: window - seconds });
  // A card may run a shade over its window — the windows are integers and the
  // rail is a target, not a timer. More than a second means the window is wrong.
  if (window - seconds < -1) {
    fail(
      `module: "${card.kicker}" needs ${seconds.toFixed(1)}s and its window is ${window}s. ` +
        `Cut the prose or re-cut the window.`,
    );
  }
  from = card.throughSeconds;
  proseWords += prose;
  excerptWords += excerpt;
}

const secondsAt = (proseRate, exRate) =>
  (proseWords / proseRate) * 60 + (excerptWords / exRate) * 60;
const planned = secondsAt(rates.planning, excerptRate);
if (planned > MODULE_SECONDS + 2) {
  fail(`module: deck reads in ${planned.toFixed(1)}s at ${rates.planning} wpm, over a ${MODULE_SECONDS}s budget`);
}

// ---------------------------------------------------------------------------
// 2. The bank: shape, depth, and pool/concept agreement.
// ---------------------------------------------------------------------------

const cueIds = new Set(deck.cards.map((c) => c.cueId));
const deckCodexIds = new Set(deck.cards.flatMap((c) => c.codexCardIds));
const poolsById = new Map(bank.pools.map((p) => [p.poolId, p]));
const itemsById = new Map();
const perPool = new Map(bank.pools.map((p) => [p.poolId, 0]));

if (bank.items.length !== bank.depth.itemsTotal) {
  fail(`bank: ${bank.items.length} items authored, depth claims ${bank.depth.itemsTotal}`);
}
if (JSON.stringify(bank.gradingPolicy.verdictSpace) !== JSON.stringify(["CORRECT", "WRONG"])) {
  fail("bank: the verdict space is not exactly CORRECT and WRONG");
}

const policyText = JSON.stringify(bank.gradingPolicy);
if (/\bpartial\b/i.test(policyText) && !/partial credit was removed|richer internal/i.test(policyText)) {
  warn("bank: the grading policy mentions 'partial' outside the passage that rules it out");
}

for (const item of bank.items) {
  if (itemsById.has(item.itemId)) fail(`bank: duplicate item id ${item.itemId}`);
  itemsById.set(item.itemId, item);

  const pool = poolsById.get(item.poolId);
  if (!pool) {
    fail(`bank: ${item.itemId} names unknown pool ${item.poolId}`);
    continue;
  }
  perPool.set(item.poolId, perPool.get(item.poolId) + 1);
  if (pool.conceptId !== item.conceptId) {
    fail(`bank: ${item.itemId} is tagged ${item.conceptId} but sits in a ${pool.conceptId} pool`);
  }
  if (!CONCEPT_ID.test(item.conceptId)) {
    fail(`bank: ${item.itemId} carries non-canonical concept id ${item.conceptId}`);
  }

  // The claim that matters most: every item is answerable from the module.
  for (const cue of item.answerableFrom) {
    if (!cueIds.has(cue)) {
      fail(`bank: ${item.itemId} says it is answerable from ${cue}, which the deck does not raise`);
    }
  }
  for (const cardId of item.codexCardIds) {
    if (!deckCodexIds.has(cardId)) {
      fail(`bank: ${item.itemId} cites ${cardId}, which no module card sources`);
    }
  }

  // A rubric with no line is a rubric that made the classifier decide.
  if (!item.rubric.requiredCore.trim()) fail(`bank: ${item.itemId} has no requiredCore`);
  if (!item.rubric.line.trim()) fail(`bank: ${item.itemId} does not say where its line is`);
  if (item.rubric.acceptExamples.length < 3) {
    fail(`bank: ${item.itemId} has ${item.rubric.acceptExamples.length} accept examples; three is the floor`);
  }
  if (item.rubric.rejectExamples.length < 3) {
    fail(`bank: ${item.itemId} has ${item.rubric.rejectExamples.length} reject examples; three is the floor`);
  }
  // An accept and a reject example that normalise to the same string means the
  // rubric contradicts itself, which is worse than either verdict.
  const accepted = new Set(item.rubric.acceptExamples.map((e) => norm(e.text)));
  for (const rejected of item.rubric.rejectExamples) {
    if (accepted.has(norm(rejected.text))) {
      fail(`bank: ${item.itemId} both accepts and rejects "${rejected.text}"`);
    }
  }
}

for (const [poolId, count] of perPool) {
  const expected = poolsById.get(poolId).authoredDepth;
  if (count !== expected) fail(`bank: pool ${poolId} holds ${count} items, claims ${expected}`);
  if (count < bank.depth.roundsPerAttempt / bank.pools.length * bank.depth.attempts) {
    fail(`bank: pool ${poolId} cannot fill ${bank.depth.attempts} non-repeating attempts`);
  }
}

// Nothing in authored content may carry a bullet count; the reducer derives it.
for (const item of bank.items) {
  const text = JSON.stringify(item);
  if (/"bullets"|"bulletCount"|"ammo"/.test(text)) {
    fail(`bank: ${item.itemId} carries a bullet field. Bullets are derived from the verdict.`);
  }
}

// ---------------------------------------------------------------------------
// 2a. Rendered question prose: the constable's voice, not a model's.
//
// The `question` field is the only prose a player reads verbatim. Two AI-cadence
// tells are cheap to catch and worth catching: the em/en dash used as prose
// punctuation, and prompts that balloon past a couple of spoken sentences. The
// rubric prose (line, why) is authoring apparatus and is left alone; only what a
// thirteen-year-old actually reads is held to this bar.
// ---------------------------------------------------------------------------

const QUESTION_WORD_CAP = 65;
const renderedQuestions = [
  ...bank.items.map((i) => ({ itemId: i.itemId, question: i.question })),
  ...hardeningQuestionsForProseCheck(),
];
function hardeningQuestionsForProseCheck() {
  return (bank.pvpHardening?.items ?? []).map((i) => ({
    itemId: i.itemId,
    question: i.question,
  }));
}
for (const { itemId, question } of renderedQuestions) {
  if (typeof question !== "string" || question.trim().length === 0) {
    fail(`prose: ${itemId} has no question`);
    continue;
  }
  if (/[\u2014\u2013]/.test(question)) {
    fail(`prose: ${itemId} uses an em/en dash in the rendered question. Rewrite it as speech.`);
  }
  if (words(question) > QUESTION_WORD_CAP) {
    fail(`prose: ${itemId} runs ${words(question)} words; keep a spoken prompt under ${QUESTION_WORD_CAP}.`);
  }
}

// ---------------------------------------------------------------------------
// 2b. The PvP-hardening items, which are deliberately NOT the eighteen.
// ---------------------------------------------------------------------------

const hardening = bank.pvpHardening?.items ?? [];
for (const item of hardening) {
  if (itemsById.has(item.itemId)) {
    fail(`hardening: ${item.itemId} collides with a PvE item id`);
  }
  if (item.pvpOnly !== true) {
    // The PvE rotation is exactly six per concept so three attempts exhaust it
    // with no repeats. An item that leaked into it would break that property
    // silently, which is why the flag is asserted rather than assumed.
    fail(`hardening: ${item.itemId} is not marked pvpOnly`);
  }
  if (!poolsById.has(item.poolId)) fail(`hardening: ${item.itemId} names unknown pool ${item.poolId}`);
  if (!CONCEPT_ID.test(item.conceptId)) {
    fail(`hardening: ${item.itemId} carries non-canonical concept id ${item.conceptId}`);
  }
  for (const cue of item.answerableFrom ?? []) {
    if (!cueIds.has(cue)) fail(`hardening: ${item.itemId} cites cue ${cue}, which the deck does not raise`);
  }
  for (const cardId of item.codexCardIds ?? []) {
    if (!deckCodexIds.has(cardId)) fail(`hardening: ${item.itemId} cites ${cardId}, sourced by no module card`);
  }
  const r = item.rubric;
  if (!r?.requiredCore?.trim()) fail(`hardening: ${item.itemId} has no requiredCore`);
  if (!r?.line?.trim()) fail(`hardening: ${item.itemId} does not say where its line is`);
  if ((r?.acceptExamples ?? []).length < 3) fail(`hardening: ${item.itemId} has fewer than three accept examples`);
  if ((r?.rejectExamples ?? []).length < 3) fail(`hardening: ${item.itemId} has fewer than three reject examples`);
  // Each hardening item exists to defeat the universal sentence, so each must
  // name one in its reject list. Without that the item is merely another item.
  const rejectsTheSentence = (r?.rejectExamples ?? []).some((e) =>
    /universal sentence/i.test(e.why ?? ""),
  );
  if (!rejectsTheSentence) {
    fail(`hardening: ${item.itemId} does not reject the universal sentence it was authored against`);
  }
}
if (hardening.length > 0 && bank.items.length !== bank.depth.itemsTotal) {
  fail("hardening: the PvE rotation is no longer exactly the authored eighteen");
}

// ---------------------------------------------------------------------------
// 2c. The PvP pool: composed rather than authored, and larger than one match.
// ---------------------------------------------------------------------------

const pvp = bank.pvpPool;
let capstoneProse = [];
try {
  const capstone = JSON.parse(
    readFileSync(
      join(here, "..", "capstone", "boston-1765", "items", "open-response.json"),
      "utf8",
    ),
  );
  capstoneProse = capstone.entries.map((e) => e.descriptor);
} catch {
  warn("the capstone open-response items are not readable; the PvP pool size is unverified");
}

if (pvp) {
  const counted =
    bank.items.length + hardening.length + capstoneProse.length;
  if (capstoneProse.length > 0 && counted !== pvp.size) {
    fail(`pvpPool claims ${pvp.size} items; the three sources hold ${counted}`);
  }
  for (const part of pvp.composition) {
    const actual =
      part.source.includes("PvE duel items")
        ? bank.items.length
        : part.source.includes("hardening")
          ? hardening.length
          : capstoneProse.length;
    if (capstoneProse.length > 0 && part.count !== actual) {
      fail(`pvpPool: "${part.source}" claims ${part.count}, holds ${actual}`);
    }
  }

  // The guard on the shared capstone items. It is stated in two files so that a
  // reader of either finds it; the cost of that is exactly the drift this checks
  // for, so the two copies must be identical strings.
  const guard = pvp.capstoneSharingGuard;
  if (!guard?.rule?.trim()) {
    fail("pvpPool: capstone items are shared with no guard on their reuse");
  } else {
    let capstoneGuardCopy = null;
    try {
      const capstone = JSON.parse(
        readFileSync(
          join(here, "..", "capstone", "boston-1765", "items", "open-response.json"),
          "utf8",
        ),
      );
      capstoneGuardCopy = capstone.gradingPolicy?.theseItemsAlsoPvPContent
        ?? capstone.gradingPolicy?.theseItemsAreAlsoPvPContent
        ?? null;
    } catch {
      /* already warned above */
    }
    if (capstoneGuardCopy === null) {
      warn("the capstone items file does not restate the PvP guard");
    } else {
      if (capstoneGuardCopy.rule !== guard.rule) {
        fail(
          `the PvP guard is worded differently in the two files:\n` +
            `      duel:     ${guard.rule}\n` +
            `      capstone: ${capstoneGuardCopy.rule}`,
        );
      }
      if (capstoneGuardCopy.guardedBy !== guard.predicateId) {
        fail(`the capstone file names guard ${capstoneGuardCopy.guardedBy}, not ${guard.predicateId}`);
      }
    }
    // The predicate has to read a field that exists, or it is a comment.
    const contracts = sourceText(CONTRACTS) ?? "";
    if (!contracts.includes("masteredAt")) {
      fail("the PvP guard reads ConceptMastery.masteredAt, which @pa/contracts no longer declares");
    }
    if (!(guard.pseudocode ?? []).join(" ").includes("masteredAt")) {
      fail("the PvP guard's pseudocode does not read masteredAt");
    }
  }

  // Every shared capstone item must be on an M1 concept, or PvP would ask a
  // question the M1 module never taught.
  const m1Concepts = new Set(bank.pools.map((p) => p.conceptId));
  for (const item of capstoneProse) {
    if (!m1Concepts.has(item.conceptId)) {
      fail(`pvpPool: capstone item ${item.itemId} is on ${item.conceptId}, which M1 does not teach`);
    }
    if (item.format !== "OPEN_RESPONSE") {
      fail(`pvpPool: capstone item ${item.itemId} is not open response`);
    }
  }

  // THE INVARIANT. While the pool is larger than the hard round ceiling, no
  // single match can repeat a question — tier 3 of the draw policy is
  // unreachable. It is IMPORTED from @pa/duel rather than restated, so raising the
  // ceiling there fails here instead of silently repeating questions at play. An
  // unresolvable value is a FAILURE, never a warning: the whole reason this check
  // exists is defeated the moment it cannot read the number it guards.
  let ceiling = null;
  try {
    ceiling = await importRoundCeiling();
  } catch (error) {
    fail(
      `DUEL_ROUND_CEILING could not be imported from ${DUEL_STRUCTURE}: ${error.message}. ` +
        `The round-ceiling invariant cannot be checked and this run is not a pass. ` +
        `Run under the TypeScript loader: node --import tsx content/m1/verify.mjs`,
    );
  }
  if (ceiling === null) {
    // Recorded as a FAILURE above; without the real value none of the checks
    // below mean anything, so they are skipped rather than run against a guess.
  } else {
    if (pvp.size <= ceiling) {
      fail(
        `pvpPool holds ${pvp.size} items and DUEL_ROUND_CEILING is ${ceiling}. ` +
          `One match can now repeat a question. Either the pool grows or the ceiling falls.`,
      );
    }
    if (pvp.size - ceiling < 5) {
      warn(`pvpPool clears the round ceiling by only ${pvp.size - ceiling} items`);
    }
    if (!String(pvp.theInvariant?.today ?? "").includes(String(ceiling))) {
      fail(`pvpPool.theInvariant.today does not name the current ceiling of ${ceiling}`);
    }
    // The invariant has to hold in the GUARDED state too, not only the full one.
    // PVP.GUARD.CAPSTONE_ALREADY_MASTERED withholds the shared capstone items
    // until a concept is mastered, so every player in a build that opens PvP
    // before the capstone draws from a materially smaller pool than the headline.
    const guardedSize = bank.items.length + hardening.length;
    if (guardedSize <= ceiling) {
      fail(
        `guarded pool is ${guardedSize} against a ceiling of ${ceiling}: a player who has mastered ` +
          `nothing can repeat a question inside one match, which is every player until the first ` +
          `capstone is sat. Needs ${ceiling + 1 - guardedSize} more PvP-only items.`,
      );
    }
    if (pvp.sizeUnderTheCapstoneGuard !== guardedSize) {
      fail(
        `pvpPool.sizeUnderTheCapstoneGuard says ${pvp.sizeUnderTheCapstoneGuard}; it is ${guardedSize}`,
      );
    }

    // The per-concept reading of the same invariant. Nothing in @pa/duel
    // schedules concepts today, so this is contingent — but the PvE schedule
    // rotated them and the natural generalisation of an open round count does
    // too, in which case a maximal match asks ceiling/concepts of each.
    const perConcept = Math.ceil(ceiling / bank.pools.length);
    for (const pool of bank.pools) {
      const depth =
        bank.items.filter((i) => i.poolId === pool.poolId).length +
        hardening.filter((i) => i.poolId === pool.poolId).length;
      if (depth < perConcept) {
        warn(
          `${pool.poolId.replace("BOS.MD01.POOL.DUEL_", "")} has ${depth} guarded items; an evenly ` +
            `rotated ${ceiling}-round match would ask ${perConcept}. Contingent on a rotating ` +
            `selector, which does not exist yet. One more item closes it.`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Codex cards: defined, sourced, and cited in both directions.
// ---------------------------------------------------------------------------

const cardsById = new Map(codex.cards.map((c) => [c.cardId, c]));
for (const card of codex.cards) {
  if (!CONCEPT_ID.test(card.conceptId)) {
    fail(`codex: ${card.cardId} carries non-canonical concept id ${card.conceptId}`);
  }
  if (!cueIds.has(card.sourceCueId)) {
    fail(`codex: ${card.cardId} is sourced by ${card.sourceCueId}, which the deck does not raise`);
  }
  const sourceCard = deck.cards.find((c) => c.cueId === card.sourceCueId);
  if (sourceCard && !sourceCard.codexCardIds.includes(card.cardId)) {
    fail(`codex: ${card.cardId} claims ${card.sourceCueId} as its source; that card does not list it`);
  }
  for (const itemId of card.askedBy) {
    const item = itemsById.get(itemId);
    if (!item) {
      fail(`codex: ${card.cardId} says ${itemId} asks for it; no such item`);
    } else if (!item.codexCardIds.includes(card.cardId)) {
      fail(`codex: ${card.cardId} says ${itemId} asks for it; that item does not cite it`);
    } else if (item.conceptId !== card.conceptId) {
      fail(`codex: ${card.cardId} (${card.conceptId}) is cited by ${itemId} (${item.conceptId})`);
    }
  }
}
for (const cardId of deckCodexIds) {
  if (!cardsById.has(cardId)) fail(`codex: the deck sources ${cardId}, which is defined nowhere`);
}
for (const card of codex.cards) {
  const citedBy = bank.items.filter((i) => i.codexCardIds.includes(card.cardId));
  if (citedBy.length === 0) {
    warn(`codex: ${card.cardId} is taught and no duel item asks for it — the module is not 1:1 here`);
  }
  const missing = citedBy.map((i) => i.itemId).filter((id) => !card.askedBy.includes(id));
  if (missing.length) fail(`codex: ${card.cardId} omits ${missing.join(", ")} from askedBy`);
}

// ---------------------------------------------------------------------------
// 4. Concept binding: three concepts, agreeing everywhere.
// ---------------------------------------------------------------------------

const boundIds = new Set(concepts.concepts.map((c) => c.conceptId));
for (const bound of concepts.concepts) {
  const pool = bank.pools.find((p) => p.conceptId === bound.conceptId);
  if (!pool) fail(`concepts: ${bound.conceptId} has no duel pool`);
  else if (pool.poolId !== bound.duelPoolId) {
    fail(`concepts: ${bound.conceptId} names pool ${bound.duelPoolId}; the bank uses ${pool.poolId}`);
  }
  if (!cueIds.has(bound.moduleCueId)) {
    fail(`concepts: ${bound.conceptId} names module cue ${bound.moduleCueId}, which the deck does not raise`);
  }
  const items = bank.items.filter((i) => i.conceptId === bound.conceptId).length;
  if (items !== bound.duelItems) {
    fail(`concepts: ${bound.conceptId} claims ${bound.duelItems} items; the bank holds ${items}`);
  }
  const cards = codex.cards.filter((c) => c.conceptId === bound.conceptId).length;
  if (cards !== bound.codexCards) {
    fail(`concepts: ${bound.conceptId} claims ${bound.codexCards} cards; ${cards} are defined`);
  }
}
for (const pool of bank.pools) {
  if (!boundIds.has(pool.conceptId)) fail(`concepts: pool ${pool.poolId} uses unbound ${pool.conceptId}`);
}
// Every concept the deck teaches must be one the duel asks about, and the other
// way round. That is what 1:1 with the mission means, mechanically.
for (const card of deck.cards) {
  for (const conceptId of card.conceptIds) {
    if (!boundIds.has(conceptId)) fail(`module: ${card.id} teaches unbound concept ${conceptId}`);
  }
}

// ---------------------------------------------------------------------------
// 5. The eval set: real items, both verdicts, and nothing copied from a rubric.
// ---------------------------------------------------------------------------

const tally = { CORRECT: 0, WRONG: 0 };
const perItemEval = new Map(bank.items.map((i) => [i.itemId, 0]));
for (const row of evalSet.answers) {
  const item = itemsById.get(row.itemId);
  if (!item) {
    fail(`eval: row for unknown item ${row.itemId}`);
    continue;
  }
  if (row.expected !== "CORRECT" && row.expected !== "WRONG") {
    fail(`eval: ${row.itemId} row expects ${row.expected}`);
    continue;
  }
  tally[row.expected] += 1;
  perItemEval.set(row.itemId, perItemEval.get(row.itemId) + 1);

  // The whole point of the set: a grader must not be able to pass it by
  // matching the rubric it was given.
  const inRubric = [...item.rubric.acceptExamples, ...item.rubric.rejectExamples].some(
    (e) => norm(e.text) === norm(row.answer),
  );
  if (inRubric) {
    fail(`eval: "${row.answer}" is already an example in ${row.itemId}'s rubric`);
  }
  if (!row.why?.trim()) fail(`eval: ${row.itemId} row "${row.answer}" has no reason`);
}
for (const [itemId, count] of perItemEval) {
  if (count < 3) fail(`eval: ${itemId} has ${count} labelled answers; three is the floor`);
}
if (evalSet.counts.total !== evalSet.answers.length) {
  fail(`eval: counts.total is ${evalSet.counts.total}, the file holds ${evalSet.answers.length}`);
}
if (evalSet.counts.CORRECT !== tally.CORRECT || evalSet.counts.WRONG !== tally.WRONG) {
  fail(
    `eval: counts say ${evalSet.counts.CORRECT}/${evalSet.counts.WRONG}, ` +
      `rows are ${tally.CORRECT}/${tally.WRONG}`,
  );
}

// The calibration dataset is another agent's file. Its absence is not our
// failure, but a claim that we calibrated against a file that is not there is.
try {
  const staar = JSON.parse(
    readFileSync(join(here, "..", "staar", "eval", "scr-8.4A-2023-scored-student-responses.json"), "utf8"),
  );
  if (staar.item?.studentExpectation !== "8.4(A)") {
    warn("eval: the calibration dataset is no longer on 8.4(A)");
  }
} catch {
  warn("eval: content/staar/eval calibration dataset not found; the calibration claim is unverified here");
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

console.log(`\n  M1 content — ${deck.moduleId}\n`);
console.log(`  ${pad("card", 24)}${num("words", 6)}${num("source", 8)}${num("secs", 7)}${num("window", 8)}${num("slack", 7)}`);
console.log(`  ${"-".repeat(60)}`);
for (const r of rows) {
  console.log(
    `  ${pad(r.kicker, 24)}${num(r.prose, 6)}${num(r.excerpt || "-", 8)}` +
      `${num(r.seconds.toFixed(1), 7)}${num(r.window, 8)}${num(r.slack.toFixed(1), 7)}`,
  );
}
console.log(`  ${"-".repeat(60)}`);
console.log(
  `  ${pad("deck", 24)}${num(proseWords, 6)}${num(excerptWords, 8)}` +
    `${num(planned.toFixed(1), 7)}${num(deckSeconds, 8)}${num((deckSeconds - planned).toFixed(1), 7)}`,
);
// Printed so a reader can see the spec was read rather than assumed. A silent
// mis-parse shows up here as a wrong count long before it shows up as a check
// that passed for the wrong reason.
console.log(
  `\n  read from source: module ${MODULE_SECONDS}s · ` +
    `LearningModuleDefinition ${MODULE_KEYS.length} fields · ModuleCard ${CARD_KEYS.length} · ` +
    `ModuleSourceExcerpt ${EXCERPT_KEYS.length}`,
);
console.log(
  `  reads in ${planned.toFixed(0)}s at ${rates.planning} wpm · ` +
    `${secondsAt(rates.slowerReader, excerptRate - 10).toFixed(0)}s at ${rates.slowerReader} · ` +
    `${secondsAt(rates.strongReader, excerptRate + 10).toFixed(0)}s at ${rates.strongReader}`,
);
console.log(
  `  ${bank.items.length} duel items (+${hardening.length} PvP-only) · ${bank.pools.length} pools · ` +
    `${codex.cards.length} codex cards · ${evalSet.answers.length} labelled answers ` +
    `(${tally.CORRECT} correct, ${tally.WRONG} wrong)`,
);
if (pvp) {
  console.log(
    `  PvP pool ${bank.items.length} + ${hardening.length} + ${capstoneProse.length} capstone prose = ` +
      `${bank.items.length + hardening.length + capstoneProse.length}`,
  );
}

if (warnings.length) {
  console.log(`\n  ${warnings.length} warning${warnings.length === 1 ? "" : "s"}:`);
  for (const w of warnings) console.log(`    · ${w}`);
}
if (failures.length) {
  console.log(`\n  ${failures.length} FAILURE${failures.length === 1 ? "" : "S"}:`);
  for (const f of failures) console.log(`    × ${f}`);
  console.log("");
  process.exit(1);
}
console.log("\n  all checks pass\n");
