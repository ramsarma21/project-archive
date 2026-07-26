#!/usr/bin/env node
// Checks the M1 capstone pool against the spec in packages/assessment and
// against the claims README.md makes about it.
//
// This is a gate, which is why the checks are sharper than the duel bank's. A
// defect here does not cost a round of ammunition — it denies a concept at 100%,
// and denying a concept denies the chapter unlock and every PvP-legal Codex card
// hanging off it. The three failures worth automating are the quiet ones: a
// concept that cannot build three fresh forms, two items on one form that turn
// out to be the same question, and an answer key that has drifted from the
// options it keys.
//
// Zero dependencies. Reads this directory plus content/staar (read-only).
// Run:  node content/capstone/boston-1765/verify.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => JSON.parse(readFileSync(join(here, rel), "utf8"));

const plan = read("blueprint.json");
const releasedMap = read("released-item-map.json");
const sr = read("items/selected-response.json");
const or = read("items/open-response.json");
const key = read("answer-key.json");
const evalSet = read("eval/open-response-answers.labeled.json");

const failures = [];
const warnings = [];
const fail = (m) => failures.push(m);
const warn = (m) => warnings.push(m);

// ---------------------------------------------------------------------------
// The spec, READ FROM ITS REAL SOURCE rather than copied.
//
// A constant copied into a second file always eventually drifts, and the drift
// is silent: this script would keep passing against a number the engine no
// longer uses, which is worse than not checking at all. So every value below is
// parsed out of the package that declares it, and a value that cannot be read
// is reported as unverified rather than quietly assumed.
//
// Reading TypeScript with a regular expression is crude. It is the right crude:
// the alternative is a build step in a content directory, and the failure mode
// here is a loud warning rather than a wrong answer.
// ---------------------------------------------------------------------------

const repoRoot = join(here, "..", "..", "..");
const CONTRACTS = "packages/contracts/src/progression.ts";
const BLUEPRINT = "packages/assessment/src/blueprint.ts";
const ITEMS = "packages/assessment/src/items.ts";
const SE_REGISTRY = "packages/curriculum/src/seRegistry.ts";
const TYPES = "packages/curriculum/src/types.ts";
const CHAPTERS = "packages/curriculum/src/chapters.ts";
const ASSESSMENTS = "packages/curriculum/src/assessments.ts";

function sourceText(relPath) {
  try {
    return readFileSync(join(repoRoot, relPath), "utf8");
  } catch {
    return null;
  }
}

function numberFrom(relPath, name, fallback) {
  const match = sourceText(relPath)?.match(
    new RegExp(`${name}\\s*(?::[^=]+)?=\\s*(\\d+)`),
  );
  if (match) return Number(match[1]);
  warn(`${name} could not be read from ${relPath}; ${fallback} is unverified`);
  return fallback;
}

function stringArrayFrom(relPath, name, fallback) {
  const match = sourceText(relPath)?.match(new RegExp(`${name}[^=]*=\\s*\\[([^\\]]*)\\]`));
  if (match) return [...match[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
  warn(`${name} could not be read from ${relPath}; the fallback list is unverified`);
  return fallback;
}

/** A `const NAME = "literal"` declaration, brand cast or not. */
function stringFrom(relPath, name, fallback) {
  const match = sourceText(relPath)?.match(new RegExp(`${name}\\s*=\\s*"([^"]+)"`));
  if (match) return match[1];
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
 * Property names of a TypeScript interface, so a field added upstream shows up
 * here as a check that noticed rather than as content that silently lacks it.
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

const ITEMS_PER_CONCEPT = numberFrom(CONTRACTS, "ASSESSMENT_ITEMS_PER_CONCEPT", 2);
const FRESH_FORM_TARGET = numberFrom(BLUEPRINT, "FRESH_FORM_TARGET", 3);
const OPEN_RESPONSE_PER_FORM = numberFrom(BLUEPRINT, "OPEN_RESPONSE_PER_FORM", 1);
/** blueprint.ts derives this the same way: items per form, once per fresh form. */
const RESERVE_TARGET = ITEMS_PER_CONCEPT * FRESH_FORM_TARGET;
function eraWindowFrom(relPath, fallback) {
  const match = sourceText(relPath)?.match(
    /BOSTON_ERA_WINDOW\s*=\s*\{\s*start:\s*(\d+),\s*end:\s*(\d+)/,
  );
  if (match) return { start: Number(match[1]), end: Number(match[2]) };
  warn(`BOSTON_ERA_WINDOW could not be read from ${relPath}; the fallback window is unverified`);
  return fallback;
}

const ERA_WINDOW = eraWindowFrom(SE_REGISTRY, { start: 1765, end: 1775 });
const PROBES = stringArrayFrom(ITEMS, "ITEM_PROBES", [
  "RECALL",
  "BOUNDARY",
  "ORDERING",
  "CORRECTION",
  "DISCRIMINATION",
  "APPLICATION",
]);
const CONCEPT_ID = regexFrom(
  TYPES,
  "CONCEPT_ID_PATTERN",
  /^[A-Z]{3}\.CONCEPT\.[A-Z][A-Z0-9_]*\.v\d+$/,
);
const DESCRIPTOR_KEYS = interfaceKeys(ITEMS, "AssessmentItemDescriptor", [
  "itemId",
  "itemVersion",
  "conceptId",
  "format",
  "probe",
  "provenance",
  "reviewStatus",
  "era",
  "stem",
  "prompt",
  "options",
  "usableAsIs",
  "optionPoolComplete",
  "usabilityNote",
]);
// Anything that could carry correctness into a descriptor. The assessment
// package's integrity rests on there being no key in a servable shape, and the
// cheapest way for one to arrive is an author adding a helpful field.
const KEY_SHAPED = /"(correctOptionId|isCorrect|correctAnswer|answerKey|correct)"\s*:/;

const CONCEPTS = plan.scope.conceptsAuthored;

// ---------------------------------------------------------------------------
// 0. The scope block names the chapter and the assessment the registry holds.
//
// This used to be the only part of blueprint.json nothing read, and it had gone
// wrong exactly the way unread metadata does: `scope.chapterId` said `BOSTON`
// while @pa/curriculum, the API, the client and every stored row said
// `boston-1765`. Harmless while nobody read it and a trap the moment somebody
// did, since a capstone scoped to a chapter that does not exist is a gate that
// asks a student for nothing.
//
// Read out of the registry rather than copied, for the reason stated above: a
// copied constant drifts silently, and this file would go on passing against a
// spelling the registry no longer uses.
// ---------------------------------------------------------------------------

const CHAPTER_ID = stringFrom(CHAPTERS, "CHAPTER_BOSTON", "boston-1765");
const ASSESSMENT_ID = stringFrom(
  ASSESSMENTS,
  "ASSESSMENT_BOSTON_CAPSTONE",
  "BOS.CAPSTONE.v1",
);

if (plan.scope.chapterId !== CHAPTER_ID) {
  fail(
    `blueprint scope.chapterId is ${JSON.stringify(plan.scope.chapterId)}; ` +
      `the registry's chapter is ${JSON.stringify(CHAPTER_ID)}`,
  );
}
if (plan.scope.assessmentId !== ASSESSMENT_ID) {
  fail(
    `blueprint scope.assessmentId is ${JSON.stringify(plan.scope.assessmentId)}; ` +
      `the registry's capstone is ${JSON.stringify(ASSESSMENT_ID)}`,
  );
}

const norm = (s) =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

/** Same year-range read @pa/curriculum uses: any 4-digit year in the string. */
function eraOverlaps(era) {
  if (!era) return null;
  const years = [...era.matchAll(/(1[5-9]\d{2})/g)].map((m) => Number(m[1]));
  if (years.length === 0) return null;
  return Math.min(...years) <= ERA_WINDOW.end && Math.max(...years) >= ERA_WINDOW.start;
}

// ---------------------------------------------------------------------------
// 1. Collect the pool: two released by reference plus sixteen authored.
// ---------------------------------------------------------------------------

for (const file of [
  ["items/selected-response.json", sr],
  ["items/open-response.json", or],
]) {
  if (KEY_SHAPED.test(JSON.stringify(file[1]))) {
    fail(`${file[0]}: a key-shaped field is present. Keys live only in answer-key.json.`);
  }
}

const authored = [...sr.entries, ...or.entries];
const pool = [];

for (const entry of authored) {
  const d = entry.descriptor;
  for (const k of Object.keys(d)) {
    if (!DESCRIPTOR_KEYS.includes(k)) {
      fail(`${d.itemId}: AssessmentItemDescriptor does not declare "${k}"`);
    }
  }
  if (d.provenance?.kind !== "AUTHORED_STAAR_STYLE") {
    fail(`${d.itemId}: an item authored in this repository must not claim released provenance`);
  }
  pool.push({ ...d, source: "AUTHORED", rubric: entry.rubric ?? null, authoring: entry.authoring });
}

for (const mapped of releasedMap.served) {
  pool.push({
    itemId: mapped.itemId,
    conceptId: mapped.conceptId,
    format: mapped.format,
    probe: mapped.probe,
    era: mapped.era,
    source: "RELEASED_TEA",
    stem: `[by reference: ${mapped.capturedIn}]`,
    options: [],
    rubric: null,
  });
}

// ---------------------------------------------------------------------------
// 2. Per-concept readiness, computed the way blueprintReadiness computes it.
// ---------------------------------------------------------------------------

const rows = [];
for (const conceptId of CONCEPTS) {
  if (!CONCEPT_ID.test(conceptId)) fail(`non-canonical concept id ${conceptId}`);
  const items = pool.filter((i) => i.conceptId === conceptId);
  const eligible = items.filter((i) => eraOverlaps(i.era) !== false);
  const openResponse = eligible.filter((i) => i.format === "OPEN_RESPONSE").length;
  const released = eligible.filter((i) => i.source === "RELEASED_TEA").length;

  const findings = [];
  if (eligible.length < ITEMS_PER_CONCEPT) findings.push("INSUFFICIENT_FOR_ONE_FORM");
  else if (eligible.length < RESERVE_TARGET) findings.push("RESERVE_BELOW_TARGET");
  if (released === 0) findings.push("NO_RELEASED_TEA_ITEM");
  if (openResponse === 0) findings.push("NO_OPEN_RESPONSE_ITEM");

  const status =
    eligible.length < ITEMS_PER_CONCEPT
      ? "UNASSESSABLE"
      : eligible.length < RESERVE_TARGET
        ? "THIN"
        : "READY";

  // The floor the package does not state: one prose item per form, three forms.
  const proseFloor = OPEN_RESPONSE_PER_FORM * FRESH_FORM_TARGET;
  if (openResponse < proseFloor) {
    fail(
      `${conceptId}: ${openResponse} open-response items. ` +
        `${OPEN_RESPONSE_PER_FORM} per form over ${FRESH_FORM_TARGET} fresh forms needs ${proseFloor}, ` +
        `or the last form serves a recycled prose item.`,
    );
  }

  // One item per probe is what makes `probesDistinct` true for every pair the
  // shuffle can draw, rather than true on average.
  const probes = eligible.map((i) => i.probe);
  for (const probe of probes) {
    if (!PROBES.includes(probe)) fail(`${conceptId}: unknown probe ${probe}`);
  }
  const missing = PROBES.filter((p) => !probes.includes(p));
  const duplicated = PROBES.filter((p) => probes.filter((x) => x === p).length > 1);
  if (missing.length) fail(`${conceptId}: no item takes the ${missing.join(", ")} stance`);
  if (duplicated.length) {
    fail(`${conceptId}: ${duplicated.join(", ")} used twice, so some form can ask one question twice`);
  }

  // Paraphrase guard. Two items on a concept must be different questions, not
  // one question reworded — that is the whole point of the shrinking retry.
  const texts = eligible
    .filter((i) => i.source === "AUTHORED")
    .map((i) => ({ id: i.itemId, words: new Set(norm(i.prompt ?? i.stem ?? "").split(" ")) }));
  for (let a = 0; a < texts.length; a += 1) {
    for (let b = a + 1; b < texts.length; b += 1) {
      const shared = [...texts[a].words].filter((w) => texts[b].words.has(w)).length;
      const overlap = shared / Math.min(texts[a].words.size, texts[b].words.size);
      if (overlap > 0.6) {
        fail(
          `${texts[a].id} and ${texts[b].id} share ${Math.round(overlap * 100)}% of their wording. ` +
            `A retry that draws the second after the first measures memory.`,
        );
      } else if (overlap > 0.45) {
        warn(`${texts[a].id} and ${texts[b].id} share ${Math.round(overlap * 100)}% of their wording`);
      }
    }
  }

  rows.push({
    conceptId,
    status,
    eligible: eligible.length,
    released,
    authoredCount: eligible.length - released,
    openResponse,
    freshForms: Math.floor(eligible.length / ITEMS_PER_CONCEPT),
    findings,
  });
}

for (const item of pool) {
  if (!CONCEPTS.includes(item.conceptId)) {
    fail(`${item.itemId} is tagged ${item.conceptId}, which this pass did not author`);
  }
  if (eraOverlaps(item.era) === false) {
    fail(`${item.itemId}: era ${item.era} falls outside ${ERA_WINDOW.start}-${ERA_WINDOW.end}`);
  }
}

// The plan's own table must agree with the arithmetic.
for (const row of rows) {
  const claimed = plan.expectedReadiness[row.conceptId];
  if (!claimed) {
    fail(`blueprint.json claims no readiness for ${row.conceptId}`);
    continue;
  }
  for (const [field, actual] of [
    ["status", row.status],
    ["eligibleItems", row.eligible],
    ["releasedTeaItems", row.released],
    ["openResponseItems", row.openResponse],
    ["freshFormsAvailable", row.freshForms],
  ]) {
    if (claimed[field] !== actual) {
      fail(`blueprint.json says ${row.conceptId}.${field} is ${claimed[field]}; it is ${actual}`);
    }
  }
  if (JSON.stringify(claimed.findings ?? []) !== JSON.stringify(row.findings)) {
    fail(
      `blueprint.json says ${row.conceptId} findings are ` +
        `${JSON.stringify(claimed.findings ?? [])}; they are ${JSON.stringify(row.findings)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 3. The key: one per selected-response item, none for prose, no clustering.
// ---------------------------------------------------------------------------

const keyed = new Map(key.authoredItems.map((k) => [k.itemId, k]));
const letters = new Map();
for (const item of pool) {
  const entry = keyed.get(item.itemId);
  if (item.source === "RELEASED_TEA") {
    if (entry) fail(`${item.itemId}: a released key must stay in content/staar, not be copied here`);
    continue;
  }
  if (item.format === "SELECTED_RESPONSE") {
    if (!entry) {
      fail(`${item.itemId}: no answer key`);
      continue;
    }
    if (item.options.length !== 4) {
      fail(`${item.itemId}: ${item.options.length} options; the authored idiom is four`);
    }
    const ids = item.options.map((o) => o.optionId);
    if (!ids.includes(entry.correctOptionId)) {
      fail(`${item.itemId}: keyed ${entry.correctOptionId}, which is not one of ${ids.join("")}`);
    }
    if (new Set(ids).size !== ids.length) fail(`${item.itemId}: duplicate option id`);
    letters.set(entry.correctOptionId, (letters.get(entry.correctOptionId) ?? 0) + 1);
  } else {
    if (entry) fail(`${item.itemId}: an open-response item must not have an answer key`);
    if (!item.rubric) fail(`${item.itemId}: no rubric`);
    else {
      const r = item.rubric;
      if (!r.requiredCore?.trim()) fail(`${item.itemId}: rubric has no requiredCore`);
      if (!r.line?.trim()) fail(`${item.itemId}: rubric does not say where its line is`);
      if ((r.acceptExamples ?? []).length < 3) fail(`${item.itemId}: fewer than three accept examples`);
      if ((r.rejectExamples ?? []).length < 3) fail(`${item.itemId}: fewer than three reject examples`);
      if (!["LOW", "MEDIUM", "HIGH"].includes(r.falseNegativeRisk)) {
        fail(`${item.itemId}: no falseNegativeRisk rating`);
      }
      const accepted = new Set((r.acceptExamples ?? []).map((e) => norm(e.text)));
      for (const rejected of r.rejectExamples ?? []) {
        if (accepted.has(norm(rejected.text))) {
          fail(`${item.itemId}: both accepts and rejects "${rejected.text}"`);
        }
      }
    }
  }
}
const keyedCount = [...letters.values()].reduce((a, b) => a + b, 0);
for (const [letter, count] of letters) {
  if (count > keyedCount / 2) {
    fail(`answer key: ${count} of ${keyedCount} keys are ${letter}. Always-${letter} passes the pool.`);
  }
}
for (const entry of key.authoredItems) {
  if (!pool.some((i) => i.itemId === entry.itemId)) {
    fail(`answer-key.json keys ${entry.itemId}, which is not in the pool`);
  }
}

// ---------------------------------------------------------------------------
// 4. The released map points at captures that exist and say what it says.
// ---------------------------------------------------------------------------

let captures = null;
try {
  const dir = join(here, "..", "..", "staar", "items");
  const { readdirSync } = await import("node:fs");
  captures = new Map();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    for (const item of JSON.parse(readFileSync(join(dir, file), "utf8")).items ?? []) {
      if (item.itemId) captures.set(item.itemId, { ...item, file: `content/staar/items/${file}` });
    }
  }
} catch {
  warn("content/staar not readable; the released-item mapping is unverified here");
}

if (captures) {
  for (const mapped of releasedMap.served) {
    const capture = captures.get(mapped.itemId);
    if (!capture) {
      fail(`released map: ${mapped.itemId} is not in content/staar`);
      continue;
    }
    if (!mapped.capturedIn.endsWith(capture.file.split("/").pop())) {
      fail(`released map: ${mapped.itemId} names the wrong capture file`);
    }
    if (capture.usableAsIs === false) fail(`released map: ${mapped.itemId} is usableAsIs:false`);
    if (capture.optionPoolComplete === false) {
      fail(`released map: ${mapped.itemId} has an incomplete option pool`);
    }
    if (capture.stimulus?.imageDependent === true) {
      fail(`released map: ${mapped.itemId} depends on an image TEA did not publish as text`);
    }
    if (capture.era !== mapped.era) {
      fail(`released map: ${mapped.itemId} era is "${capture.era}" in the capture, "${mapped.era}" here`);
    }
    if (eraOverlaps(capture.era) === false) {
      fail(`released map: ${mapped.itemId} era ${capture.era} is outside the chapter window`);
    }
  }
  for (const notServed of releasedMap.notServed) {
    if (!captures.has(notServed.itemId)) {
      warn(`released map: ${notServed.itemId} is excluded but is not in content/staar either`);
    }
  }
}

// ---------------------------------------------------------------------------
// 5. The eval set: real items, both verdicts, nothing copied from a rubric.
// ---------------------------------------------------------------------------

const byId = new Map(pool.map((i) => [i.itemId, i]));
const tally = { CORRECT: 0, WRONG: 0 };
const perItem = new Map(pool.filter((i) => i.format === "OPEN_RESPONSE").map((i) => [i.itemId, 0]));
for (const row of evalSet.answers) {
  const item = byId.get(row.itemId);
  if (!item) {
    fail(`eval: row for unknown item ${row.itemId}`);
    continue;
  }
  if (item.format !== "OPEN_RESPONSE") fail(`eval: ${row.itemId} is not an open-response item`);
  if (row.expected !== "CORRECT" && row.expected !== "WRONG") {
    fail(`eval: ${row.itemId} expects ${row.expected}`);
    continue;
  }
  tally[row.expected] += 1;
  perItem.set(row.itemId, (perItem.get(row.itemId) ?? 0) + 1);
  const inRubric = [...(item.rubric?.acceptExamples ?? []), ...(item.rubric?.rejectExamples ?? [])].some(
    (e) => norm(e.text) === norm(row.answer),
  );
  if (inRubric) fail(`eval: "${row.answer}" is already an example in ${row.itemId}'s rubric`);
  if (!row.why?.trim()) fail(`eval: ${row.itemId} row "${row.answer}" has no reason`);
}
for (const [itemId, count] of perItem) {
  if (count < 3) fail(`eval: ${itemId} has ${count} labelled answers; three is the floor`);
}
if (evalSet.counts.total !== evalSet.answers.length) {
  fail(`eval: counts.total is ${evalSet.counts.total}, the file holds ${evalSet.answers.length}`);
}
if (evalSet.counts.CORRECT !== tally.CORRECT || evalSet.counts.WRONG !== tally.WRONG) {
  fail(`eval: counts say ${evalSet.counts.CORRECT}/${evalSet.counts.WRONG}, rows are ${tally.CORRECT}/${tally.WRONG}`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);
const short = (id) => id.replace("BOS.CONCEPT.", "").replace(".v1", "");

console.log(`\n  Boston capstone — M1 concepts\n`);
console.log(`  ${pad("concept", 20)}${num("items", 6)}${num("real", 6)}${num("auth", 6)}${num("prose", 7)}${num("forms", 7)}  ${pad("status", 8)}findings`);
console.log(`  ${"-".repeat(84)}`);
for (const r of rows) {
  console.log(
    `  ${pad(short(r.conceptId), 20)}${num(r.eligible, 6)}${num(r.released, 6)}` +
      `${num(r.authoredCount, 6)}${num(r.openResponse, 7)}${num(r.freshForms, 7)}  ` +
      `${pad(r.status, 8)}${r.findings.join(", ") || "—"}`,
  );
}
console.log(`  ${"-".repeat(84)}`);
const total = rows.reduce((a, r) => a + r.eligible, 0);
const totalReleased = rows.reduce((a, r) => a + r.released, 0);
const totalProse = rows.reduce((a, r) => a + r.openResponse, 0);
console.log(
  `  ${pad("pool", 20)}${num(total, 6)}${num(totalReleased, 6)}${num(total - totalReleased, 6)}${num(totalProse, 7)}`,
);
console.log(
  `\n  key distribution: ${[...letters.entries()].sort().map(([l, c]) => `${l}:${c}`).join("  ")}` +
    `   ·   ${evalSet.answers.length} labelled answers (${tally.CORRECT} correct, ${tally.WRONG} wrong)`,
);
// Printed so a reader can see the spec was read rather than assumed. A silent
// mis-parse would show up here as a wrong number long before it showed up as a
// check that passed for the wrong reason.
console.log(
  `  spec read from source: ${ITEMS_PER_CONCEPT}/form · reserve ${RESERVE_TARGET} · ` +
    `${OPEN_RESPONSE_PER_FORM} prose/form × ${FRESH_FORM_TARGET} forms · ` +
    `era ${ERA_WINDOW.start}-${ERA_WINDOW.end} · ${PROBES.length} probes · ` +
    `${DESCRIPTOR_KEYS.length} descriptor fields`,
);

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
