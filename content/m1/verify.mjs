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
// Reads only this directory plus content/staar (read-only), and RESOLVES every
// value it must not restate — @pa/duel's DUEL_ROUND_CEILING, @pa/contracts'
// LEARNING_MODULE_SECONDS, @pa/curriculum's CONCEPT_ID_PATTERN, and the shapes of
// the module interfaces — from the source that owns each, never from a scraped
// literal. Constants and patterns are imported and executed; interface shapes are
// read from the actual declaration through the TypeScript compiler. All of that
// needs the repo's TypeScript loader, so this runs under tsx.
// Run:  node --import tsx content/m1/verify.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

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
// Values that belong to another package are RESOLVED FROM IT, never copied.
//
// A constant copied into a second file drifts silently, and a checker that
// passes against a number the engine stopped using is worse than no checker. The
// original sin here was text-scraping: a `NAME = <digits>` or `NAME = /…/` regex
// against the source, falling back to a hardcoded copy of the expected value on a
// miss and carrying on "checking" against the stale copy. That is exactly how
// DUEL_ROUND_CEILING broke — it moved from tuning.ts into structure.ts and left a
// bare re-export the regex could not match, so the check quietly warned and
// stopped verifying while still exiting 0.
//
// So nothing is scraped. The module length and the concept-id pattern are
// IMPORTED and executed from the modules that own them. The three module
// interfaces have no runtime representation, so their property sets are read from
// the actual `interface` declaration through the TypeScript compiler — which
// fails loudly if the interface is renamed or moved, rather than matching a
// weaker set of lines. The round ceiling is imported the same way (see below).
//
// In every case an UNRESOLVABLE value is a HARD FAILURE, never a warning: a
// missing contract, pattern or shape must never pass as a clean run. The only
// values still read as source TEXT are existence probes for a named field, and
// those already fail (not warn) when the text is absent.
// ---------------------------------------------------------------------------

const repoRoot = join(here, "..", "..");
const CONTRACTS = "packages/contracts/src/progression.ts";
const CURRICULUM_TYPES = "packages/curriculum/src/types.ts";
const MODULE_FORMAT = "apps/web/src/module/moduleFormat.ts";

// The leaf module @pa/duel exports the ceiling from — it has no imports of its
// own, so loading it drags in nothing else. Imported by file path rather than by
// the `@pa/duel/structure` specifier so resolution does not depend on where this
// script is run from; a move of the file surfaces as a loud import failure, which
// is the correct outcome. The other imports below follow the same file-path rule.
const DUEL_STRUCTURE = "packages/duel/src/structure.ts";

function sourceText(relPath) {
  try {
    return readFileSync(join(repoRoot, relPath), "utf8");
  } catch {
    return null;
  }
}

/** A named export, imported and executed from the module that owns it by file path. */
async function importNamed(relPath, name) {
  const mod = await import(pathToFileURL(join(repoRoot, relPath)).href);
  if (!(name in mod)) {
    throw new Error(`${relPath} does not export ${name}`);
  }
  return mod[name];
}

async function importRoundCeiling() {
  const value = await importNamed(DUEL_STRUCTURE, "DUEL_ROUND_CEILING");
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `DUEL_ROUND_CEILING imported as ${JSON.stringify(value)}, not a positive integer`,
    );
  }
  return value;
}

/** A positive-integer constant, imported (never scraped) from its owning module. */
async function positiveIntFrom(relPath, name) {
  const value = await importNamed(relPath, name);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `${name} imported from ${relPath} as ${JSON.stringify(value)}, not a positive integer`,
    );
  }
  return value;
}

/** A RegExp constant, imported (never scraped) from its owning module. */
async function regexpFrom(relPath, name) {
  const value = await importNamed(relPath, name);
  if (!(value instanceof RegExp)) {
    throw new Error(
      `${name} imported from ${relPath} is ${JSON.stringify(String(value))}, not a RegExp`,
    );
  }
  return value;
}

/**
 * The property names of a TypeScript interface, read from the ACTUAL declaration
 * through the compiler rather than by matching indented lines. The module player
 * is another agent's file, so a field added there should surface here as a check
 * that noticed rather than as a payload that silently lacks it — and, just as
 * importantly, an interface that is renamed or moved out from under this check
 * must make the check FAIL, not fall back to a hardcoded key list that no longer
 * describes anything. Parsing the declaration is what gives that property: an
 * interface the compiler cannot find throws here, and the run fails.
 */
function interfaceKeys(relPath, name) {
  const text = sourceText(relPath);
  if (text === null) {
    throw new Error(`cannot read ${relPath} to resolve interface ${name}`);
  }
  const source = ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, false);
  let members = null;
  const visit = (node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === name) {
      members = node.members;
    } else {
      ts.forEachChild(node, visit);
    }
  };
  visit(source);
  if (members === null) {
    throw new Error(`interface ${name} not found in ${relPath}`);
  }
  const keys = [];
  for (const member of members) {
    if (ts.isPropertySignature(member) && member.name) {
      if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) {
        keys.push(member.name.text);
      }
    }
  }
  if (keys.length === 0) {
    throw new Error(`interface ${name} in ${relPath} declares no property members`);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Resolve everything owned elsewhere, up front. Any value that cannot be
// resolved is recorded as a hard failure and the run stops here: the checks
// below are meaningless against a value this script had to guess, and a run that
// could not read what it guards is not a pass. (The round ceiling is resolved in
// its own section further down, the same way and under the same rule.)
// ---------------------------------------------------------------------------

const resolutionFailures = [];
async function resolveOrFail(label, resolver) {
  try {
    return await resolver();
  } catch (error) {
    resolutionFailures.push(`${label}: ${error.message}`);
    return null;
  }
}

const CONCEPT_ID = await resolveOrFail(
  `CONCEPT_ID_PATTERN from ${CURRICULUM_TYPES}`,
  () => regexpFrom(CURRICULUM_TYPES, "CONCEPT_ID_PATTERN"),
);
const MODULE_SECONDS = await resolveOrFail(
  `LEARNING_MODULE_SECONDS from ${CONTRACTS}`,
  () => positiveIntFrom(CONTRACTS, "LEARNING_MODULE_SECONDS"),
);
const MODULE_KEYS = await resolveOrFail(
  `interface LearningModuleDefinition from ${MODULE_FORMAT}`,
  () => interfaceKeys(MODULE_FORMAT, "LearningModuleDefinition"),
);
const CARD_KEYS = await resolveOrFail(
  `interface ModuleCard from ${MODULE_FORMAT}`,
  () => interfaceKeys(MODULE_FORMAT, "ModuleCard"),
);
const EXCERPT_KEYS = await resolveOrFail(
  `interface ModuleSourceExcerpt from ${MODULE_FORMAT}`,
  () => interfaceKeys(MODULE_FORMAT, "ModuleSourceExcerpt"),
);

if (resolutionFailures.length > 0) {
  console.error(
    `\n  ${resolutionFailures.length} value(s) this checker guards could not be ` +
      `resolved from source. It cannot verify content against a guess, so this ` +
      `run is a FAILURE, not a pass:\n`,
  );
  for (const message of resolutionFailures) console.error(`    × ${message}`);
  console.error(
    `\n  Run under the TypeScript loader: node --import tsx content/m1/verify.mjs\n`,
  );
  process.exit(1);
}

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
// conservative rule is that nothing unknown appears inside `module`. The three
// key sets (MODULE_KEYS, CARD_KEYS, EXCERPT_KEYS) were read from the interfaces
// themselves in the resolution phase above.
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

// The PvP pool BORROWS the capstone's nine open-response items, so the file that
// holds them is a required input to the pool-size invariant, not an optional
// cross-reference. When it could not be read this check used to skip its size and
// composition assertions behind a warning and still pass — the same silent
// degradation the round ceiling lives in a leaf module to prevent, in a different
// costume. So an unreadable capstone file is a FAILURE for the size claims that
// depend on it (below), not a skip. The genuinely optional reads off this file —
// the guard RESTATEMENT and the per-item advisories — stay warnings, because a
// missing restatement of a rule stated in full elsewhere is not a broken pool.
const CAPSTONE_OPEN_RESPONSE = join(
  here,
  "..",
  "capstone",
  "boston-1765",
  "items",
  "open-response.json",
);
let capstone = null;
try {
  capstone = JSON.parse(readFileSync(CAPSTONE_OPEN_RESPONSE, "utf8"));
} catch {
  capstone = null;
}
// null (not []) means UNREAD, which the checks below treat as a failure rather
// than as "held zero capstone items".
const capstoneProse = capstone ? capstone.entries.map((e) => e.descriptor) : null;

if (pvp) {
  if (capstoneProse === null) {
    fail(
      `pvpPool composes in the capstone's open-response items, but ` +
        `content/capstone/boston-1765/items/open-response.json could not be read; ` +
        `pvp.size (${pvp.size}) and its composition are unverified and this run is not a pass.`,
    );
  }
  const capstoneCount = capstoneProse?.length ?? 0;
  const counted = bank.items.length + hardening.length + capstoneCount;
  if (capstoneProse !== null && counted !== pvp.size) {
    fail(`pvpPool claims ${pvp.size} items; the three sources hold ${counted}`);
  }
  for (const part of pvp.composition) {
    const actual =
      part.source.includes("PvE duel items")
        ? bank.items.length
        : part.source.includes("hardening")
          ? hardening.length
          : capstoneCount;
    if (capstoneProse !== null && part.count !== actual) {
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
    // The guard is stated in two files so that a reader of either finds it; the
    // cost of that is exactly the drift this checks for, so the two copies must
    // be identical strings. This is a redundancy cross-check, not the pool-size
    // invariant: when the file is genuinely unreadable the size check above has
    // already failed, so here a missing restatement only WARNS. It is read from
    // the single parse above rather than re-opening the file.
    if (capstone !== null) {
      const capstoneGuardCopy =
        capstone.gradingPolicy?.theseItemsAlsoPvPContent
        ?? capstone.gradingPolicy?.theseItemsAreAlsoPvPContent
        ?? null;
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
    }
    // The predicate has to read a field that exists on ConceptMastery, or it is a
    // comment. The field is resolved from the SCHEMA that declares it — imported,
    // not grepped — so the string appearing only in a comment cannot satisfy the
    // check and a rename of the field fails here.
    let masteryDeclaresMasteredAt = null;
    try {
      const schema = await importNamed(CONTRACTS, "ConceptMasterySchema");
      masteryDeclaresMasteredAt = Boolean(schema?.shape) && "masteredAt" in schema.shape;
    } catch (error) {
      fail(
        `the PvP guard reads ConceptMastery.masteredAt, but ConceptMasterySchema ` +
          `could not be imported from ${CONTRACTS}: ${error.message}`,
      );
    }
    if (masteryDeclaresMasteredAt === false) {
      fail("the PvP guard reads ConceptMastery.masteredAt, which @pa/contracts no longer declares");
    }
    if (!(guard.pseudocode ?? []).join(" ").includes("masteredAt")) {
      fail("the PvP guard's pseudocode does not read masteredAt");
    }
  }

  // Every shared capstone item must be on an M1 concept, or PvP would ask a
  // question the M1 module never taught. (Skipped when the file is unread — the
  // size check above has already failed for that.)
  const m1Concepts = new Set(bank.pools.map((p) => p.conceptId));
  for (const item of capstoneProse ?? []) {
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
  const capstoneCount = capstoneProse?.length ?? 0;
  const capstoneNote = capstoneProse === null ? " (unread)" : "";
  console.log(
    `  PvP pool ${bank.items.length} + ${hardening.length} + ${capstoneCount}${capstoneNote} capstone prose = ` +
      `${bank.items.length + hardening.length + capstoneCount}`,
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
