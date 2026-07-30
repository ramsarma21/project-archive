import test from "node:test";
import assert from "node:assert/strict";
import {
  conceptItemDepth,
  conceptsForItem,
  eraOverlapsWindow,
  ITEM_MAPPINGS,
  itemsForConcept,
  parseEraRange,
} from "../items.js";
import { bostonConceptId } from "../conceptRegistry.js";
import { MISSION_M1, MISSION_M3 } from "../missionIds.js";
import { missionReadiness, validateCurriculum } from "../validate.js";

// ---------------------------------------------------------------------------
// The registry must be internally consistent. Warnings are expected; errors are
// not, and an error means the registry itself is broken.
// ---------------------------------------------------------------------------

test("the seeded registry has no referential-integrity errors", () => {
  const report = validateCurriculum();
  assert.deepEqual(
    report.errors.map((e) => `${e.code} ${e.subject}`),
    [],
  );
  assert.equal(report.ok, true);
});

test("the registry reports its known holes rather than hiding them", () => {
  const report = validateCurriculum();
  assert.equal(report.strictOk, false, "there are known content gaps");
  const codes = new Set(report.warnings.map((w) => w.code));
  for (const expected of [
    "SE_TEXT_UNVERIFIED",
    "SE_WITHOUT_ASSESSABLE_CONCEPT",
    "SE_NOT_ASSIGNED_TO_ANY_MISSION",
    "CONCEPT_WITHOUT_MISSION_OWNER",
    "CONCEPT_PARENT_RETAGGED",
    "CONCEPT_WITHOUT_PRIMARY_ITEMS",
    "ALIAS_UNRESOLVED",
    "ITEM_ERA_OUTSIDE_CHAPTER_WINDOW",
    "MISSION_ASSIGNMENT_OPEN",
  ]) {
    assert.ok(codes.has(expected as never), `expected a ${expected} warning`);
  }
});

test("8.21(A) is caught as a must-own standard carried only by enrichment", () => {
  const report = validateCurriculum();
  const finding = report.warnings.find(
    (w) => w.code === "SE_WITHOUT_ASSESSABLE_CONCEPT" && w.subject === "8.21(A)",
  );
  assert.ok(finding, "a Tier A standard with only a micro beneath it must warn");
});

test("the three standards no mission claims are named", () => {
  const report = validateCurriculum();
  const unassigned = report.warnings
    .filter((w) => w.code === "SE_NOT_ASSIGNED_TO_ANY_MISSION")
    .map((w) => w.subject)
    .sort();
  assert.deepEqual(unassigned, ["8.15(A)", "8.15(C)", "8.21(A)"]);
});

test("opt-in checks stay off by default and fire when asked", () => {
  const relaxed = validateCurriculum();
  const strict = validateCurriculum({
    requireSmeApproval: true,
    requireCodexCards: true,
  });
  assert.equal(
    relaxed.warnings.filter((w) => w.code === "CONCEPT_REVIEW_PENDING").length,
    0,
  );
  assert.ok(
    strict.warnings.filter((w) => w.code === "CONCEPT_REVIEW_PENDING").length > 0,
  );
  assert.ok(
    strict.warnings.filter((w) => w.code === "CONCEPT_WITHOUT_CODEX_CARDS").length >
      0,
  );
  assert.equal(strict.ok, true, "opt-in checks add warnings, never errors");
});

// ---------------------------------------------------------------------------
// Mission readiness: the two blockers are separate.
// ---------------------------------------------------------------------------

test("concept vocabulary is ready for thirteen of fourteen missions", () => {
  const readiness = missionReadiness();
  const ready = readiness.filter((m) => m.conceptVocabularyReady);
  assert.equal(ready.length, 13);
  const blocked = readiness.filter((m) => !m.conceptVocabularyReady);
  assert.deepEqual(blocked.map((m) => m.missionId), [MISSION_M3]);
});

test("only M1 has item depth, which is the bank's problem and not the registry's", () => {
  const readiness = missionReadiness();
  const withItems = readiness.filter((m) => m.itemDepthReady);
  assert.deepEqual(withItems.map((m) => m.missionId), [MISSION_M1]);
  const m1 = withItems[0]!;
  assert.equal(
    m1.itemCount,
    21,
    "eighteen authored duel items plus the three era-eligible owner items",
  );
});

test("every mission that is not ready says what is blocking it", () => {
  for (const mission of missionReadiness()) {
    if (mission.conceptVocabularyReady && mission.itemDepthReady) {
      assert.deepEqual(mission.blockers, []);
    } else {
      assert.ok(
        mission.blockers.length > 0,
        `${mission.missionId} is blocked without saying why`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Item mapping.
// ---------------------------------------------------------------------------

test("era ranges parse the shapes the bank actually uses", () => {
  assert.deepEqual(parseEraRange("1765"), { start: 1765, end: 1765 });
  assert.deepEqual(parseEraRange("1764-1767"), { start: 1764, end: 1767 });
  assert.deepEqual(parseEraRange("1789 (constitutional)"), {
    start: 1789,
    end: 1789,
  });
  assert.deepEqual(parseEraRange("1770-1797"), { start: 1770, end: 1797 });
  assert.equal(parseEraRange(null), null);
  assert.equal(parseEraRange("undated"), null);
});

test("era eligibility is computed, not trusted", () => {
  assert.equal(eraOverlapsWindow("1764-1767"), true, "overlaps at the low edge");
  assert.equal(eraOverlapsWindow("1770-1797"), true, "overlaps at the high edge");
  assert.equal(eraOverlapsWindow("1776"), false, "one year past the window");
  assert.equal(eraOverlapsWindow("1789-1791"), false);
});

test("eight of the sixteen owner items are era-eligible for Boston", () => {
  const owner = ITEM_MAPPINGS.filter((m) => m.bankId === "BOS.ACT01.CP1.PRODUCTION");
  assert.equal(owner.length, 16);
  const eligible = owner.filter((m) => eraOverlapsWindow(m.era) === true);
  assert.equal(eligible.length, 8);
});

test("one item can evidence several concepts, with exactly one primary", () => {
  const evidences = conceptsForItem("BANK.BOSTON.USER.Q26.v1");
  assert.equal(evidences.length, 3, "natural rights, representation, town meeting");
  assert.equal(evidences[0]!.weight, "PRIMARY", "primary sorts first");
  assert.equal(
    evidences.filter((e) => e.weight === "PRIMARY").length,
    1,
    "per-concept mastery needs one unambiguous owner",
  );
});

test("a concept can be reached from every item that evidences it", () => {
  const representation = bostonConceptId("REPRESENTATION");
  const all = itemsForConcept(representation);
  const primaryOnly = itemsForConcept(representation, { primaryOnly: true });
  assert.ok(all.length > primaryOnly.length, "secondary evidence is reachable");
  assert.equal(
    primaryOnly.length,
    7,
    "six authored duel items plus one owner assessment item",
  );
  assert.equal(
    all.length - primaryOnly.length,
    3,
    "three further owner items evidence representation as a secondary concept",
  );
});

test("item depth is reportable per concept", () => {
  // After the 2026-07-30 rescope M1's spine concept is INTOLERABLE_ACTS, which
  // carries its six authored duel items plus the two era-eligible owner items.
  const depth = conceptItemDepth(bostonConceptId("INTOLERABLE_ACTS"));
  assert.equal(depth.primaryItems, 8, "six duel items plus the two owner Intolerable-Acts items");
  assert.equal(depth.eraEligiblePrimaryItems, 8);

  // STAMP_SCOPE was retired from M1's duel bank in the rescope; only its one
  // owner assessment item stays primary to it.
  const demoted = conceptItemDepth(bostonConceptId("STAMP_SCOPE"));
  assert.equal(demoted.primaryItems, 1, "just the owner Stamp item after the rescope");

  const bare = conceptItemDepth(bostonConceptId("ALARM_NETWORK_GEOGRAPHY"));
  assert.equal(bare.primaryItems, 0, "M13 has no authored items yet");
});

test("an out-of-scope item carries no concept evidence", () => {
  const valleyForge = ITEM_MAPPINGS.find(
    (m) => m.itemId === "BANK.BOSTON.USER.Q12.v1",
  )!;
  assert.equal(valleyForge.status, "UNMAPPED_OUT_OF_SCOPE");
  assert.deepEqual(valleyForge.evidences, []);
  assert.ok(valleyForge.note, "and says why");
});

test("every item mapping preserves the tags it was retagged from", () => {
  for (const mapping of ITEM_MAPPINGS) {
    assert.ok(
      mapping.sourceTags.length > 0,
      `${mapping.itemId} lost its original tags`,
    );
  }
});
