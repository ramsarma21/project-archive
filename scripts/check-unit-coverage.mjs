#!/usr/bin/env node
// Every concept a unit TEACHES must be assessed somewhere in that same unit.
//
// THE INVARIANT, in the owner's words: "mission + boss fight needs to cover all
// the concepts in that mission's lesson." A chapter is 3-4 units; a unit is one
// lesson plus a mission plus a boss fight. So for each unit, every concept its
// lesson deck teaches must have AT LEAST ONE encounter item or duel item in the
// same unit. Anything less fails this check.
//
// WHY IT FAILS RATHER THAN WARNS, which is the whole reason it exists. Adaptive
// remediation is being built on the rule that ABSENT EVIDENCE MEANS TEACH. A
// concept that is taught but tested nowhere can never produce evidence, so it
// sits in the reteach set permanently: re-taught on every replay, unclearable by
// any student, and completely invisible from play — the deck looks fine, the duel
// looks fine, every existing gate is green. That is a silent, permanent
// degradation of the thing the product is for, and it is introduced by an
// ordinary authoring edit (retire an item, add a card) that no reviewer would
// flag. A warning printed into a gate log does not survive that.
//
// WHAT COUNTS AS COVERAGE
//   - an ENCOUNTER item: one authored variant of a perspective encounter on the
//     mission route (packages/mission-*/src/encounters/bank.ts).
//   - a DUEL item: one authored item in the mission's boss-fight bank
//     (content/*/duel-items.json, the `items` array).
// NOT counted: `pvpHardening.items`, which the bank itself records as
// "deliberately outside the PvE rotation" — a student playing the unit never
// meets them, so they cannot produce that student's evidence. Not counted
// either: a pool with no items, or an encounter with no variants. A container is
// not an assessment.
//
// The encounter source read is the CLIENT bank, because that is the question a
// player is actually asked. Its server-side rubric twin lives in @pa/grading and
// apps/api/test/encounter-drift.test.ts already pins the two together id for id,
// so reading one of them is reading both.
//
// GENERALISED OVER UNITS, NOT WRITTEN FOR M1. Units come from the mission
// registry's `set: 1|2|3|4` field, which is what the four units are intended to
// become; lessons, duels and encounters are DISCOVERED from the repository
// rather than listed here. Today that finds exactly one authored unit, and a
// mission with no lesson deck teaches nothing and is therefore required to
// assess nothing — so the thirteen unauthored missions cost no false failures.
// When the rescope from 14 missions to 4 lands, this check follows it without an
// edit. It does not read or need the pending rescope proposal.
//
// AN UNREADABLE SOURCE IS A HARD FAILURE, never a skip. Silently dropping an
// assessment source manufactures the exact defect this check exists to catch: a
// concept that looks untested because the tool could not see its items.
//
// Runs under tsx: the registry, the id resolver and the encounter banks are
// TypeScript, and every value is resolved from the module that owns it rather
// than restated here.
//
//   node --import tsx scripts/check-unit-coverage.mjs
//   node --import tsx scripts/check-unit-coverage.mjs --selftest
//   node --import tsx scripts/check-unit-coverage.mjs --json

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SELFTEST = process.argv.includes("--selftest");
const JSON_OUT = process.argv.includes("--json");

const problems = [];
const fail = (m) => problems.push(m);

// ---------------------------------------------------------------------------
// THE PURE CORE. Everything above it is discovery, everything below it is
// printing; this is the decision, and `--selftest` drives it directly.
// ---------------------------------------------------------------------------

/**
 * @param units [{
 *   unit,                                   // 1|2|3|4
 *   missionIds: [id],
 *   lessons: [{ missionId, source, concepts: [{ conceptId, cardId }] }],
 *   items:   [{ missionId, source, kind: "encounter"|"duel", conceptId, itemId }],
 * }]
 * @returns one verdict per unit, with the gaps named.
 */
export function auditUnits(units) {
  return units.map((u) => {
    const taught = new Map(); // conceptId -> [taught-by]
    for (const lesson of u.lessons ?? []) {
      for (const c of lesson.concepts ?? []) {
        if (!c.conceptId) continue;
        if (!taught.has(c.conceptId)) taught.set(c.conceptId, []);
        taught.get(c.conceptId).push(`${lesson.source}:${c.cardId ?? "?"}`);
      }
    }

    // Coverage is counted WITHIN the unit only. A concept taught in unit 1 and
    // asked about in unit 3 is not covered: the student meets the lesson and its
    // fight in one sitting, and evidence that arrives two units later cannot
    // clear a reteach flag raised now.
    const assessed = new Map(); // conceptId -> { encounter: n, duel: n }
    for (const item of u.items ?? []) {
      if (!item.conceptId) continue;
      if (!assessed.has(item.conceptId)) assessed.set(item.conceptId, { encounter: 0, duel: 0 });
      assessed.get(item.conceptId)[item.kind] += 1;
    }

    const gaps = [];
    const covered = [];
    for (const [conceptId, taughtBy] of taught) {
      const counts = assessed.get(conceptId);
      if (counts && counts.encounter + counts.duel > 0) covered.push({ conceptId, taughtBy, ...counts });
      else gaps.push({ conceptId, taughtBy });
    }

    const assessedNotTaught = [...assessed.keys()]
      .filter((c) => !taught.has(c))
      .map((conceptId) => ({ conceptId, ...assessed.get(conceptId) }));

    const byId = (a, b) => a.conceptId.localeCompare(b.conceptId);
    return {
      unit: u.unit,
      missionIds: u.missionIds ?? [],
      lessonCount: (u.lessons ?? []).length,
      itemCount: (u.items ?? []).length,
      taughtCount: taught.size,
      covered: covered.sort(byId),
      gaps: gaps.sort(byId),
      assessedNotTaught: assessedNotTaught.sort(byId),
    };
  });
}

// ---------------------------------------------------------------------------
// Selftest. Each case that asserts a PASS is paired with the mutation that must
// turn it into a gap, because a coverage check that cannot report a gap is
// exactly the silent degradation it was written to prevent.
// ---------------------------------------------------------------------------
function selftest(verbose = true) {
  const lesson = (missionId, ...conceptIds) => ({
    missionId,
    source: `content/${missionId}/module.json`,
    concepts: conceptIds.map((conceptId, i) => ({ conceptId, cardId: `CARD${i}` })),
  });
  const item = (missionId, kind, conceptId) => ({
    missionId, source: "x", kind, conceptId, itemId: `${conceptId}#${kind}`,
  });
  const one = (u) => auditUnits([u])[0];

  const cases = [
    ["a duel item covers a taught concept", one({
      unit: 1, lessons: [lesson("m1", "A")], items: [item("m1", "duel", "A")],
    }).gaps.length === 0],
    ["an encounter item covers a taught concept", one({
      unit: 1, lessons: [lesson("m1", "A")], items: [item("m1", "encounter", "A")],
    }).gaps.length === 0],
    ["ONE item is enough; the invariant is at-least-one", one({
      unit: 1, lessons: [lesson("m1", "A", "B")],
      items: [item("m1", "duel", "A"), item("m1", "encounter", "B")],
    }).gaps.length === 0],

    // The failing direction.
    ["a taught concept with NO item is a gap", one({
      unit: 1, lessons: [lesson("m1", "A")], items: [],
    }).gaps.length === 1],
    ["the gap names the concept", one({
      unit: 1, lessons: [lesson("m1", "A")], items: [],
    }).gaps[0].conceptId === "A"],
    ["the gap names the card that teaches it", one({
      unit: 1, lessons: [lesson("m1", "A")], items: [],
    }).gaps[0].taughtBy[0] === "content/m1/module.json:CARD0"],
    ["one covered and one bare is still a gap", one({
      unit: 1, lessons: [lesson("m1", "A", "B")], items: [item("m1", "duel", "A")],
    }).gaps.length === 1],
    ["items for OTHER concepts do not cover it", one({
      unit: 1, lessons: [lesson("m1", "A")], items: [item("m1", "duel", "Z"), item("m1", "encounter", "Y")],
    }).gaps.length === 1],

    // Coverage does not leak across units — the case a per-chapter check misses.
    ["a sibling unit's items do not cover this one", (() => {
      const [u1, u3] = auditUnits([
        { unit: 1, lessons: [lesson("m1", "A")], items: [] },
        { unit: 3, lessons: [], items: [item("m9", "duel", "A")] },
      ]);
      return u1.gaps.length === 1 && u3.gaps.length === 0;
    })()],

    // Shape of a unit that is not authored yet.
    ["a unit with no lesson requires nothing", one({ unit: 2, lessons: [], items: [] }).gaps.length === 0],
    ["a unit with a lesson and no content at all is all gaps", one({
      unit: 2, lessons: [lesson("m5", "A", "B", "C")], items: [],
    }).gaps.length === 3],

    // Unions and edges.
    ["two lessons in one unit union their concepts", one({
      unit: 1, lessons: [lesson("m1", "A"), lesson("m2", "B")],
      items: [item("m1", "duel", "A"), item("m2", "duel", "B")],
    }).taughtCount === 2],
    ["a unit's item may come from a sibling mission in the SAME unit", one({
      unit: 1, lessons: [lesson("m1", "A")], items: [item("m2", "duel", "A")],
    }).gaps.length === 0],
    ["an item with no conceptId is ignored, not counted as coverage", one({
      unit: 1, lessons: [lesson("m1", "A")], items: [item("m1", "duel", null)],
    }).gaps.length === 1],
    ["duplicate teaching of one concept is one concept", one({
      unit: 1, lessons: [lesson("m1", "A"), lesson("m2", "A")], items: [item("m1", "duel", "A")],
    }).taughtCount === 1],
    ["counts are reported per kind", (() => {
      const v = one({ unit: 1, lessons: [lesson("m1", "A")],
        items: [item("m1", "duel", "A"), item("m1", "duel", "A"), item("m1", "encounter", "A")] });
      return v.covered[0].duel === 2 && v.covered[0].encounter === 1;
    })()],

    // The reverse direction is reported, and is deliberately NOT a failure.
    ["assessed-but-not-taught is noted", one({
      unit: 1, lessons: [lesson("m1", "A")], items: [item("m1", "duel", "A"), item("m1", "duel", "B")],
    }).assessedNotTaught.length === 1],
    ["assessed-but-not-taught is not a gap", one({
      unit: 1, lessons: [lesson("m1", "A")], items: [item("m1", "duel", "A"), item("m1", "duel", "B")],
    }).gaps.length === 0],
  ];

  let failed = 0;
  if (verbose) console.log("check-unit-coverage selftest:");
  for (const [label, ok] of cases) {
    if (!ok) failed++;
    if (verbose || !ok) console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  }
  if (verbose || failed) {
    console.log(
      failed === 0
        ? `check-unit-coverage selftest: OK (${cases.length} cases)`
        : `check-unit-coverage selftest: FAILED (${failed}/${cases.length})`,
    );
  }
  return { failed, total: cases.length };
}

if (SELFTEST) process.exit(selftest().failed === 0 ? 0 : 1);

// ---------------------------------------------------------------------------
// Discovery. Registry first, then the authored sources, then the code banks.
// ---------------------------------------------------------------------------
const imp = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

// Imported by FILE PATH rather than by the `@pa/curriculum` specifier, so
// resolution does not depend on where this is run from and a moved file surfaces
// as a loud import failure instead of a quiet miss. Same rule as content/m1/verify.mjs.
const { ALL_MISSIONS } = await imp("packages/curriculum/src/missions.ts");
const { resolveMissionId } = await imp("packages/curriculum/src/missionIds.ts");
const { resolveConcept } = await imp("packages/curriculum/src/resolve.ts");

/**
 * Canonicalise a concept id so a lesson written in one vocabulary and a bank
 * written in another are compared as the same concept. `BOS.MD01.CONCEPT.*` is
 * the legacy learner spelling of `BOS.CONCEPT.*` and the registry resolves it;
 * comparing the raw strings would report a gap that does not exist.
 *
 * An id the registry cannot resolve is NOT dropped — it is kept verbatim, so the
 * two sides can still match each other, and it is reported. Dropping it would
 * silently manufacture a gap.
 */
const unresolved = new Set();
function canonicalConcept(raw, where) {
  if (typeof raw !== "string" || raw === "") return null;
  const r = resolveConcept(raw);
  if (r.ok) return r.concept.conceptId;
  unresolved.add(`${raw}  (${where}: ${r.failure})`);
  return raw;
}

function requireMission(raw, where) {
  const resolved = raw == null ? null : resolveMissionId(String(raw));
  if (!resolved) {
    fail(`${where}: "${raw}" names no mission in the registry, so its content cannot be placed in a unit`);
    return null;
  }
  return resolved;
}

const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
const dirsIn = (rel) =>
  existsSync(join(ROOT, rel))
    ? readdirSync(join(ROOT, rel), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
    : [];

// ---- lesson decks: content/<slug>/module.json ------------------------------
const lessons = [];
for (const slug of dirsIn("content")) {
  const rel = `content/${slug}/module.json`;
  if (!existsSync(join(ROOT, rel))) continue;
  let deck;
  try {
    deck = readJson(rel);
  } catch (err) {
    fail(`${rel}: could not be read as JSON (${err.message})`);
    continue;
  }
  const mod = deck.module;
  if (!mod || !Array.isArray(mod.cards)) {
    fail(`${rel}: has no \`module.cards\` array, so what the lesson teaches cannot be read`);
    continue;
  }
  const missionId = requireMission(mod.missionId ?? deck.authoredFor?.missionId, rel);
  if (!missionId) continue;
  const concepts = [];
  for (const card of mod.cards) {
    for (const raw of card.conceptIds ?? []) {
      const conceptId = canonicalConcept(raw, rel);
      if (conceptId) concepts.push({ conceptId, cardId: card.id ?? "(unnamed card)" });
    }
  }
  lessons.push({ missionId, source: rel, concepts });
}

// ---- duel banks: content/<slug>/duel-items.json ----------------------------
const items = [];
for (const slug of dirsIn("content")) {
  const rel = `content/${slug}/duel-items.json`;
  if (!existsSync(join(ROOT, rel))) continue;
  let bank;
  try {
    bank = readJson(rel);
  } catch (err) {
    fail(`${rel}: could not be read as JSON (${err.message})`);
    continue;
  }
  if (!Array.isArray(bank.items)) {
    fail(`${rel}: has no \`items\` array, so the boss fight's coverage cannot be read`);
    continue;
  }
  const missionId = requireMission(bank.authoredFor?.missionId ?? bank.authoredFor?.stableMissionId, rel);
  if (!missionId) continue;
  for (const it of bank.items) {
    const conceptId = canonicalConcept(it.conceptId, rel);
    items.push({ missionId, source: rel, kind: "duel", conceptId, itemId: it.itemId ?? "(unnamed item)" });
  }
}

// ---- encounter banks: packages/mission-<slug>/src/encounters/bank.ts -------
for (const pkg of dirsIn("packages")) {
  if (!pkg.startsWith("mission-")) continue;
  const rel = `packages/${pkg}/src/encounters/bank.ts`;
  if (!existsSync(join(ROOT, rel))) continue;
  const missionId = requireMission(pkg.slice("mission-".length).toUpperCase(), rel);
  if (!missionId) continue;
  let mod;
  try {
    mod = await imp(rel);
  } catch (err) {
    fail(`${rel}: could not be imported (${err.message}) — its encounters cannot be counted as coverage`);
    continue;
  }
  const encounters = Object.values(mod)
    .filter((v) => Array.isArray(v))
    .flat()
    .filter((e) => e && typeof e === "object" && "conceptId" in e && Array.isArray(e.variants));
  if (encounters.length === 0) {
    fail(`${rel}: exports no encounter array (objects with \`conceptId\` and \`variants\`); if this mission has no encounters, delete the file rather than leaving one this check cannot read`);
    continue;
  }
  for (const enc of encounters) {
    const conceptId = canonicalConcept(enc.conceptId, rel);
    for (const v of enc.variants) {
      items.push({ missionId, source: rel, kind: "encounter", conceptId, itemId: v.itemId ?? `${enc.id}/${v.variantId}` });
    }
  }
}

// ---- assemble the units ----------------------------------------------------
const setOf = new Map(ALL_MISSIONS.map((m) => [m.missionId, m.set]));
const titleOf = new Map(ALL_MISSIONS.map((m) => [m.missionId, m.title]));
const unitNumbers = [...new Set(ALL_MISSIONS.map((m) => m.set))].sort((a, b) => a - b);

function unitOf(missionId, where) {
  const set = setOf.get(missionId);
  if (set === undefined) {
    fail(`${where}: mission ${missionId} is not in the mission registry, so it belongs to no unit`);
    return null;
  }
  return set;
}

const units = unitNumbers.map((unit) => ({
  unit,
  missionIds: ALL_MISSIONS.filter((m) => m.set === unit).map((m) => m.missionId),
  lessons: lessons.filter((l) => unitOf(l.missionId, l.source) === unit),
  items: items.filter((i) => unitOf(i.missionId, i.source) === unit),
}));

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------
const { failed: stFailed, total: stTotal } = selftest(false);
if (stFailed > 0) {
  console.error(`check-unit-coverage: own selftest failed ${stFailed}/${stTotal}; refusing to report a verdict from it`);
  process.exit(2);
}

const verdicts = auditUnits(units);
const totalGaps = verdicts.reduce((n, v) => n + v.gaps.length, 0);

if (JSON_OUT) {
  console.log(JSON.stringify({ verdicts, unresolved: [...unresolved], problems }, null, 2));
} else {
  console.log(
    `check-unit-coverage: selftest OK (${stTotal} cases) · ${unitNumbers.length} unit(s) from the mission ` +
      `registry's \`set\`, ${lessons.length} lesson deck(s), ${items.length} assessment item(s) discovered`,
  );

  for (const v of verdicts) {
    const missions = v.missionIds.map((id) => titleOf.get(id) ?? id).length;
    if (v.lessonCount === 0) {
      console.log(
        `\n  unit ${v.unit} — ${missions} mission(s), no lesson deck authored yet. ` +
          `Nothing taught, so nothing required.` +
          (v.itemCount ? `  (${v.itemCount} item(s) exist here already)` : ""),
      );
      continue;
    }
    console.log(
      `\n  unit ${v.unit} — ${v.lessonCount} lesson deck(s), ${v.taughtCount} concept(s) taught, ` +
        `${v.itemCount} item(s) available`,
    );
    for (const c of v.covered) {
      console.log(`    ok    ${c.conceptId}  <-  ${c.encounter} encounter + ${c.duel} duel item(s)`);
    }
    for (const g of v.gaps) {
      console.error(`    GAP   ${g.conceptId}  taught by ${g.taughtBy.join(", ")} — assessed by NOTHING in unit ${v.unit}`);
    }
    for (const a of v.assessedNotTaught) {
      console.log(`    note  ${a.conceptId} is assessed here (${a.encounter} enc + ${a.duel} duel) but no lesson in unit ${v.unit} teaches it`);
    }
  }

  if (unresolved.size) {
    console.log(`\n  ${unresolved.size} concept id(s) the registry could not resolve (compared verbatim instead):`);
    for (const u of unresolved) console.log(`    note: ${u}`);
  }
}

if (problems.length) {
  console.error(`\n  ${problems.length} source(s) could not be read, which would fake a gap or hide one:`);
  for (const p of problems) console.error(`    error: ${p}`);
}

if (totalGaps > 0) {
  console.error(
    `\ncheck-unit-coverage: FAIL — ${totalGaps} concept(s) taught but assessed nowhere in their unit.\n` +
      `  Each one is permanently unclearable: remediation treats absent evidence as "teach", so a\n` +
      `  concept with no item can never produce evidence and is re-taught on every replay, forever,\n` +
      `  with nothing visible in play to say why. Give it at least one encounter or duel item in its\n` +
      `  own unit, or stop teaching it in that unit's lesson.`,
  );
  process.exit(1);
}
if (problems.length) {
  console.error("\ncheck-unit-coverage: FAIL — unreadable source(s); the verdict above is not trustworthy.");
  process.exit(1);
}
console.log("\ncheck-unit-coverage: OK — every concept taught by a unit's lesson is assessed inside that unit.");
process.exit(0);
