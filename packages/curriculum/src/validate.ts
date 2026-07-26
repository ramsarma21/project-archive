import { ALIASES } from "./aliases.js";
import { ALL_CONCEPTS, CONCEPTS } from "./conceptRegistry.js";
import {
  conceptItemDepth,
  eraOverlapsWindow,
  ITEM_MAPPINGS,
  type EraRange,
} from "./items.js";
import type { CurriculumMissionId } from "./missionIds.js";
import { ALL_MISSIONS, MISSIONS } from "./missions.js";
import { isSeCode, parseSeReference, type SeCode } from "./seCode.js";
import {
  ALL_STUDENT_EXPECTATIONS,
  BOSTON_ERA_WINDOW,
  STUDENT_EXPECTATIONS,
} from "./seRegistry.js";
import {
  isCurriculumConceptId,
  type CurriculumConceptId,
  type InstructionalConcept,
} from "./types.js";

// ============================================================================
// Validation.
//
// The registry is only worth building if it can refuse things. Everything below
// is a check that would have caught something the repository actually shipped:
// a strand tagged as a standard, a concept nailed to a mission that does not
// teach its standard, a Readiness standard with nothing beneath it, an item
// pointing at a concept that does not exist.
//
// ERROR   — referential integrity is broken. The registry is internally wrong
//           and the CLI exits non-zero.
// WARNING — the registry is coherent but the curriculum has a hole. These are
//           the eleven blocked missions, the unverified standards text, and the
//           concepts with no items. They must not fail CI, because failing CI on
//           known content gaps trains everyone to pass `--no-verify`.
// ============================================================================

export type Severity = "ERROR" | "WARNING";

export type FindingCode =
  // -- student expectations
  | "SE_CODE_MALFORMED"
  | "SE_KEY_MISMATCH"
  | "SE_DUPLICATE"
  | "SE_CLAUSE_DUPLICATE"
  | "SE_CLAUSE_TEXT_NOT_IN_OFFICIAL_TEXT"
  | "SE_VERBATIM_WITHOUT_SOURCE"
  | "SE_UNVERIFIED_WITH_TEXT"
  | "SE_TEXT_UNVERIFIED"
  | "SE_WITHOUT_CONCEPTS"
  | "SE_WITHOUT_ASSESSABLE_CONCEPT"
  | "SE_NOT_ASSIGNED_TO_ANY_MISSION"
  // -- concepts
  | "CONCEPT_ID_MALFORMED"
  | "CONCEPT_KEY_MISMATCH"
  | "CONCEPT_DUPLICATE"
  | "CONCEPT_ORPHANED_UNKNOWN_SE"
  | "CONCEPT_UNKNOWN_CLAUSE"
  | "CONCEPT_UNKNOWN_SECONDARY_SE"
  | "CONCEPT_SECONDARY_REPEATS_PARENT"
  | "CONCEPT_UNKNOWN_OWNER_MISSION"
  | "CONCEPT_SE_NOT_ASSIGNED_TO_OWNER_MISSION"
  | "CONCEPT_OWNER_SURFACE_MISMATCH"
  | "CODEX_CARD_ID_MALFORMED"
  | "CODEX_CARD_SHARED_ACROSS_CONCEPTS"
  | "CONCEPT_WITHOUT_MISSION_OWNER"
  | "CONCEPT_PARENT_RETAGGED"
  | "CONCEPT_REVIEW_PENDING"
  | "CONCEPT_WITHOUT_CODEX_CARDS"
  | "CONCEPT_WITHOUT_PRIMARY_ITEMS"
  // -- aliases
  | "ALIAS_DUPLICATE"
  | "ALIAS_COLLIDES_WITH_CANONICAL_CONCEPT_ID"
  | "ALIAS_COLLIDES_WITH_CANONICAL_SE_CODE"
  | "ALIAS_UNKNOWN_CONCEPT"
  | "ALIAS_UNKNOWN_SE"
  | "ALIAS_UNKNOWN_CLAUSE"
  | "ALIAS_SE_SET_UNKNOWN_MEMBER"
  | "ALIAS_STRUCTURAL_MISMATCH"
  | "ALIAS_UNRESOLVED"
  // -- items
  | "ITEM_DUPLICATE"
  | "ITEM_MAPPED_WITHOUT_EVIDENCE"
  | "ITEM_UNMAPPED_WITH_EVIDENCE"
  | "ITEM_UNKNOWN_CONCEPT"
  | "ITEM_DUPLICATE_CONCEPT"
  | "ITEM_PRIMARY_COUNT"
  | "ITEM_ERA_OUTSIDE_CHAPTER_WINDOW"
  | "ITEM_ERA_UNPARSEABLE"
  // -- missions
  | "MISSION_DUPLICATE"
  | "MISSION_UNKNOWN_SE"
  | "MISSION_ASSIGNED_WITHOUT_SES"
  | "MISSION_OPEN_WITH_SES"
  | "MISSION_ASSIGNMENT_OPEN"
  | "MISSION_WITHOUT_CONCEPTS"
  | "MISSION_SE_WITHOUT_CONCEPT";

export interface Finding {
  code: FindingCode;
  severity: Severity;
  /** The registry key the finding is about. */
  subject: string;
  message: string;
}

export interface ValidationOptions {
  /** Warn per concept that holds no Codex cards. Off: the namespace only covers M1. */
  requireCodexCards?: boolean;
  /** Warn per concept not yet SME-approved. Off: nothing in the seed is. */
  requireSmeApproval?: boolean;
  /** Era window for item-scope checks. */
  chapterEraWindow?: EraRange;
}

/**
 * Two independent axes, because the slate's two blockers are independent.
 *
 * Mission-Slate section 2.1 blocks eleven missions on concept vocabulary: their
 * assigned standards had no runtime concept ids at all. Section 2.2 blocks the
 * bank on item depth. A mission can clear the first and still fail the second,
 * and collapsing them into one boolean hides which team is holding the mission up.
 */
export interface MissionReadiness {
  missionId: CurriculumMissionId;
  title: string;
  assignedSeCodes: SeCode[];
  /** Concepts owned by this mission. */
  conceptIds: CurriculumConceptId[];
  /** Assigned standards with no concept owned by this mission. */
  seCodesWithoutOwnedConcept: SeCode[];
  /** Every assigned standard has an owned, assessable concept. */
  conceptVocabularyReady: boolean;
  /** Every owned assessable concept has at least one era-eligible primary item. */
  itemDepthReady: boolean;
  /** Era-eligible primary items across this mission's concepts. */
  itemCount: number;
  blockers: string[];
}

export interface ValidationSummary {
  studentExpectations: number;
  seByStandardType: Record<string, number>;
  seByRecurrence: Record<string, number>;
  seByReportingCategory: Record<string, number>;
  seByChapterTier: Record<string, number>;
  seWithVerbatimText: number;
  concepts: number;
  macroConcepts: number;
  microConcepts: number;
  conceptsAwaitingSmeApproval: number;
  conceptsWithProposedRetag: number;
  conceptsWithoutMissionOwner: number;
  conceptsWithNoDeliverySurface: number;
  aliases: number;
  aliasesByForm: Record<string, number>;
  aliasesResolvingToConcept: number;
  aliasesDeliberatelyUnresolved: number;
  items: number;
  itemsMapped: number;
  itemsEraEligible: number;
  itemConceptEdges: number;
  missionsConceptReady: number;
  missionsItemReady: number;
  missionsBlocked: number;
}

export interface ValidationReport {
  /** No ERROR findings. */
  ok: boolean;
  /** No ERROR and no WARNING findings. */
  strictOk: boolean;
  errors: Finding[];
  warnings: Finding[];
  summary: ValidationSummary;
  missionReadiness: MissionReadiness[];
}

const CODEX_CARD_PATTERN = /^[A-Z]{3}\.[A-Z0-9]+\.CARD\.[A-Z][A-Z0-9_]*\.v\d+$/;

function bump(counter: Record<string, number>, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

function conceptsBySe(): Map<SeCode, InstructionalConcept[]> {
  const out = new Map<SeCode, InstructionalConcept[]>();
  for (const concept of ALL_CONCEPTS) {
    const list = out.get(concept.parentSe);
    if (list) list.push(concept);
    else out.set(concept.parentSe, [concept]);
  }
  return out;
}

/** Join the mission table against the concept and item registries. */
export function missionReadiness(
  window: EraRange = BOSTON_ERA_WINDOW,
): MissionReadiness[] {
  return ALL_MISSIONS.map((mission) => {
    const owned = ALL_CONCEPTS.filter(
      (c) => c.owner.missionId === mission.missionId,
    );
    const assessable = owned.filter((c) => c.assessable);
    const missing = mission.assignedSeCodes.filter(
      (code) => !assessable.some((c) => c.parentSe === code),
    );
    const depths = assessable.map((c) => conceptItemDepth(c.conceptId, window));
    const itemCount = depths.reduce(
      (sum, d) => sum + d.eraEligiblePrimaryItems,
      0,
    );
    const conceptVocabularyReady =
      mission.assignmentStatus === "ASSIGNED" && missing.length === 0;
    const itemDepthReady =
      depths.length > 0 && depths.every((d) => d.eraEligiblePrimaryItems > 0);

    const blockers: string[] = [];
    if (mission.assignmentStatus === "OPEN") {
      blockers.push("no settled standard assignment");
    }
    if (missing.length > 0) {
      blockers.push(
        `assigned standards with no assessable concept owned here: ${missing.join(", ")}`,
      );
    }
    if (!itemDepthReady) {
      const bare = depths.filter((d) => d.eraEligiblePrimaryItems === 0);
      blockers.push(
        depths.length === 0
          ? "no assessable concepts, so no item depth to measure"
          : `${bare.length} of ${depths.length} concepts have no era-eligible item`,
      );
    }

    return {
      missionId: mission.missionId,
      title: mission.title,
      assignedSeCodes: [...mission.assignedSeCodes],
      conceptIds: owned.map((c) => c.conceptId),
      seCodesWithoutOwnedConcept: missing,
      conceptVocabularyReady,
      itemDepthReady,
      itemCount,
      blockers,
    };
  });
}

/**
 * Validate the whole registry. Pure: reads the seeded data, allocates nothing
 * outside the report, and is safe to call from a test, a content build, or CI.
 */
export function validateCurriculum(
  options: ValidationOptions = {},
): ValidationReport {
  const window = options.chapterEraWindow ?? BOSTON_ERA_WINDOW;
  const findings: Finding[] = [];
  const add = (
    code: FindingCode,
    severity: Severity,
    subject: string,
    message: string,
  ): void => {
    findings.push({ code, severity, subject, message });
  };

  // -- student expectations -------------------------------------------------
  const seenSe = new Set<string>();
  for (const [key, se] of STUDENT_EXPECTATIONS) {
    if (!isSeCode(se.code)) {
      add(
        "SE_CODE_MALFORMED",
        "ERROR",
        se.code,
        "not in canonical form; expected e.g. 8.4(A)",
      );
    }
    if (key !== se.code) {
      add(
        "SE_KEY_MISMATCH",
        "ERROR",
        String(key),
        `registry key does not match row code ${se.code}`,
      );
    }
    if (seenSe.has(se.code)) {
      add("SE_DUPLICATE", "ERROR", se.code, "appears more than once");
    }
    seenSe.add(se.code);

    const clauseIds = new Set<string>();
    for (const clause of se.clauses) {
      if (clauseIds.has(clause.clauseId)) {
        add(
          "SE_CLAUSE_DUPLICATE",
          "ERROR",
          `${se.code}:${clause.clauseId}`,
          "clause id appears more than once on this standard",
        );
      }
      clauseIds.add(clause.clauseId);
      if (
        clause.textStatus === "VERBATIM_CITED" &&
        (se.officialText === null || !se.officialText.includes(clause.text))
      ) {
        add(
          "SE_CLAUSE_TEXT_NOT_IN_OFFICIAL_TEXT",
          "ERROR",
          `${se.code}:${clause.clauseId}`,
          "clause claims verbatim text that does not appear in the standard's " +
            "official text; a clause cannot quote words the standard does not use",
        );
      }
    }

    if (se.textStatus === "VERBATIM_CITED") {
      if (se.officialText === null || se.provenance.textSource === null) {
        add(
          "SE_VERBATIM_WITHOUT_SOURCE",
          "ERROR",
          se.code,
          "claims verbatim text but is missing the text or its citation",
        );
      }
    } else {
      if (se.officialText !== null) {
        add(
          "SE_UNVERIFIED_WITH_TEXT",
          "ERROR",
          se.code,
          "carries official text while marked unverified; either cite it or " +
            "remove it, because an uncited standards quotation is indistinguishable " +
            "from an invented one",
        );
      }
      add(
        "SE_TEXT_UNVERIFIED",
        "WARNING",
        se.code,
        "official standards text is not held; reports must show the paraphrase " +
          "as ours, not as the standard's wording",
      );
    }
  }

  // -- concepts -------------------------------------------------------------
  const bySe = conceptsBySe();
  const seenConcept = new Set<string>();
  const codexOwners = new Map<string, CurriculumConceptId[]>();

  for (const [key, concept] of CONCEPTS) {
    if (!isCurriculumConceptId(concept.conceptId)) {
      add(
        "CONCEPT_ID_MALFORMED",
        "ERROR",
        concept.conceptId,
        "not in canonical form; expected e.g. BOS.CONCEPT.STAMP_SCOPE.v1",
      );
    }
    if (key !== concept.conceptId) {
      add(
        "CONCEPT_KEY_MISMATCH",
        "ERROR",
        String(key),
        `registry key does not match concept id ${concept.conceptId}`,
      );
    }
    if (seenConcept.has(concept.conceptId)) {
      add(
        "CONCEPT_DUPLICATE",
        "ERROR",
        concept.conceptId,
        "appears more than once",
      );
    }
    seenConcept.add(concept.conceptId);

    const parent = STUDENT_EXPECTATIONS.get(concept.parentSe);
    if (!parent) {
      add(
        "CONCEPT_ORPHANED_UNKNOWN_SE",
        "ERROR",
        concept.conceptId,
        `parent standard ${concept.parentSe} is not in the registry`,
      );
    } else if (concept.parentClauseId !== null) {
      const known = parent.clauses.some(
        (c) => c.clauseId === concept.parentClauseId,
      );
      if (!known) {
        add(
          "CONCEPT_UNKNOWN_CLAUSE",
          "ERROR",
          concept.conceptId,
          parent.clauses.length === 0
            ? `claims clause ${concept.parentClauseId} but ${parent.code} declares no clauses`
            : `clause ${concept.parentClauseId} is not declared on ${parent.code}`,
        );
      }
    }

    for (const secondaryCode of concept.secondarySeCodes) {
      if (!STUDENT_EXPECTATIONS.has(secondaryCode)) {
        add(
          "CONCEPT_UNKNOWN_SECONDARY_SE",
          "ERROR",
          concept.conceptId,
          `secondary standard ${secondaryCode} is not in the registry`,
        );
      }
      if (secondaryCode === concept.parentSe) {
        add(
          "CONCEPT_SECONDARY_REPEATS_PARENT",
          "ERROR",
          concept.conceptId,
          `secondary standard ${secondaryCode} repeats the parent`,
        );
      }
    }

    const missionId = concept.owner.missionId;
    if (missionId !== null) {
      const mission = MISSIONS.get(missionId);
      if (!mission) {
        add(
          "CONCEPT_UNKNOWN_OWNER_MISSION",
          "ERROR",
          concept.conceptId,
          `owner mission ${missionId} is not in the mission table`,
        );
      } else if (!mission.assignedSeCodes.includes(concept.parentSe)) {
        add(
          "CONCEPT_SE_NOT_ASSIGNED_TO_OWNER_MISSION",
          "ERROR",
          concept.conceptId,
          `owned by ${missionId}, whose assigned standards are ` +
            `${mission.assignedSeCodes.join(", ") || "(none)"} and do not include ` +
            `${concept.parentSe}`,
        );
      }
      if (concept.owner.surface === "UNALLOCATED") {
        add(
          "CONCEPT_OWNER_SURFACE_MISMATCH",
          "ERROR",
          concept.conceptId,
          "has a mission owner but an UNALLOCATED delivery surface",
        );
      }
    } else if (concept.owner.surface === "UNALLOCATED") {
      // A chapter-level or reactive-world surface is a real home; UNALLOCATED
      // means nothing delivers the concept at all.
      add(
        "CONCEPT_WITHOUT_MISSION_OWNER",
        "WARNING",
        concept.conceptId,
        "no mission and no chapter surface delivers this concept, so nothing can " +
          "teach it and no duel or assessment form can draw on it",
      );
    }

    for (const cardId of concept.codexCardIds) {
      if (!CODEX_CARD_PATTERN.test(cardId)) {
        add(
          "CODEX_CARD_ID_MALFORMED",
          "ERROR",
          `${concept.conceptId} -> ${cardId}`,
          "Codex card id is not in canonical form",
        );
      }
      const owners = codexOwners.get(cardId);
      if (owners) owners.push(concept.conceptId);
      else codexOwners.set(cardId, [concept.conceptId]);
    }

    if (concept.parentSeStatus === "PROPOSED_RETAG") {
      add(
        "CONCEPT_PARENT_RETAGGED",
        "WARNING",
        concept.conceptId,
        `parent standard was moved to ${concept.parentSe} from the source draft ` +
          `tag(s) ${concept.sourceDraftTags.join(", ") || "(none recorded)"}; ` +
          "needs SME confirmation",
      );
    }
    if (options.requireSmeApproval && concept.reviewStatus !== "SME_APPROVED") {
      add(
        "CONCEPT_REVIEW_PENDING",
        "WARNING",
        concept.conceptId,
        `review status is ${concept.reviewStatus}`,
      );
    }
    if (options.requireCodexCards && concept.codexCardIds.length === 0) {
      add(
        "CONCEPT_WITHOUT_CODEX_CARDS",
        "WARNING",
        concept.conceptId,
        "no Codex cards, so a duel question against it has nothing to index",
      );
    }
    if (concept.assessable) {
      const depth = conceptItemDepth(concept.conceptId, window);
      if (depth.eraEligiblePrimaryItems === 0) {
        add(
          "CONCEPT_WITHOUT_PRIMARY_ITEMS",
          "WARNING",
          concept.conceptId,
          "assessable but has no era-eligible item for which it is the primary " +
            "concept",
        );
      }
    }
  }

  for (const [cardId, owners] of codexOwners) {
    if (owners.length > 1) {
      add(
        "CODEX_CARD_SHARED_ACROSS_CONCEPTS",
        "WARNING",
        cardId,
        `claimed by ${owners.length} concepts (${owners.join(", ")}); a shared ` +
          "card makes per-concept mastery ambiguous",
      );
    }
  }

  // -- per-standard coverage ------------------------------------------------
  const missionSeCodes = new Set<string>(
    ALL_MISSIONS.flatMap((m) => m.assignedSeCodes),
  );
  for (const se of ALL_STUDENT_EXPECTATIONS) {
    const concepts = bySe.get(se.code) ?? [];
    if (concepts.length === 0) {
      add(
        "SE_WITHOUT_CONCEPTS",
        "WARNING",
        se.code,
        "no instructional concept sits beneath this standard, so nothing can " +
          "teach or assess it",
      );
    } else if (!concepts.some((c) => c.assessable)) {
      add(
        "SE_WITHOUT_ASSESSABLE_CONCEPT",
        "WARNING",
        se.code,
        `${concepts.length} concept(s) beneath it, all enrichment; an enrichment ` +
          "micro can never carry a standard on the assessment spine",
      );
    }
    if (!missionSeCodes.has(se.code)) {
      add(
        "SE_NOT_ASSIGNED_TO_ANY_MISSION",
        "WARNING",
        se.code,
        `${se.chapterTier === "A_MUST_OWN" ? "a must-own" : "a reinforce"} ` +
          `${se.standardType.toLowerCase()} standard with no mission assignment ` +
          "in the slate",
      );
    }
  }

  // -- aliases --------------------------------------------------------------
  const seenAlias = new Set<string>();
  for (const alias of ALIASES) {
    if (seenAlias.has(alias.alias)) {
      add(
        "ALIAS_DUPLICATE",
        "ERROR",
        alias.alias,
        "appears more than once in the alias table; the exact-string index would " +
          "silently keep only one",
      );
    }
    seenAlias.add(alias.alias);

    if (CONCEPTS.has(alias.alias as CurriculumConceptId)) {
      add(
        "ALIAS_COLLIDES_WITH_CANONICAL_CONCEPT_ID",
        "ERROR",
        alias.alias,
        "is also a canonical concept id, so lookups are ambiguous",
      );
    }
    if (STUDENT_EXPECTATIONS.has(alias.alias as SeCode)) {
      add(
        "ALIAS_COLLIDES_WITH_CANONICAL_SE_CODE",
        "ERROR",
        alias.alias,
        "is also a canonical standard code, so lookups are ambiguous",
      );
    }

    switch (alias.target.kind) {
      case "CONCEPT":
        if (!CONCEPTS.has(alias.target.conceptId)) {
          add(
            "ALIAS_UNKNOWN_CONCEPT",
            "ERROR",
            alias.alias,
            `points at unregistered concept ${alias.target.conceptId}`,
          );
        }
        break;
      case "SE": {
        const { code, clauseId } = alias.target;
        const se = STUDENT_EXPECTATIONS.get(code);
        if (!se) {
          add(
            "ALIAS_UNKNOWN_SE",
            "ERROR",
            alias.alias,
            `points at unregistered standard ${code}`,
          );
        } else if (
          clauseId !== null &&
          !se.clauses.some((c) => c.clauseId === clauseId)
        ) {
          add(
            "ALIAS_UNKNOWN_CLAUSE",
            "ERROR",
            alias.alias,
            `names clause ${clauseId}, which ${se.code} does not declare`,
          );
        }
        const parsed = parseSeReference(alias.alias);
        if (parsed.kind === "SE" && parsed.code !== code) {
          add(
            "ALIAS_STRUCTURAL_MISMATCH",
            "ERROR",
            alias.alias,
            `parses as ${parsed.code} but is mapped to ${code}`,
          );
        }
        break;
      }
      case "SE_SET":
        for (const code of alias.target.codes) {
          if (!STUDENT_EXPECTATIONS.has(code)) {
            add(
              "ALIAS_SE_SET_UNKNOWN_MEMBER",
              "ERROR",
              alias.alias,
              `set member ${code} is not in the registry`,
            );
          }
        }
        break;
      case "UNRESOLVED":
        add(
          "ALIAS_UNRESOLVED",
          "WARNING",
          alias.alias,
          `${alias.target.disposition}: ${alias.target.detail}`,
        );
        break;
    }
  }

  // -- items ----------------------------------------------------------------
  const seenItem = new Set<string>();
  let itemConceptEdges = 0;
  let itemsMapped = 0;
  let itemsEraEligible = 0;

  for (const item of ITEM_MAPPINGS) {
    if (seenItem.has(item.itemId)) {
      add("ITEM_DUPLICATE", "ERROR", item.itemId, "mapped more than once");
    }
    seenItem.add(item.itemId);

    itemConceptEdges += item.evidences.length;
    if (item.status === "MAPPED") itemsMapped += 1;

    if (item.status === "MAPPED" && item.evidences.length === 0) {
      add(
        "ITEM_MAPPED_WITHOUT_EVIDENCE",
        "ERROR",
        item.itemId,
        "status MAPPED with no concept evidence",
      );
    }
    if (item.status !== "MAPPED" && item.evidences.length > 0) {
      add(
        "ITEM_UNMAPPED_WITH_EVIDENCE",
        "ERROR",
        item.itemId,
        `status ${item.status} but carries concept evidence`,
      );
    }

    const seenEvidence = new Set<string>();
    for (const evidence of item.evidences) {
      if (!CONCEPTS.has(evidence.conceptId)) {
        add(
          "ITEM_UNKNOWN_CONCEPT",
          "ERROR",
          item.itemId,
          `evidences unregistered concept ${evidence.conceptId}`,
        );
      }
      if (seenEvidence.has(evidence.conceptId)) {
        add(
          "ITEM_DUPLICATE_CONCEPT",
          "ERROR",
          item.itemId,
          `lists concept ${evidence.conceptId} twice`,
        );
      }
      seenEvidence.add(evidence.conceptId);
    }

    if (item.status === "MAPPED") {
      const primaries = item.evidences.filter((e) => e.weight === "PRIMARY");
      if (primaries.length !== 1) {
        add(
          "ITEM_PRIMARY_COUNT",
          "ERROR",
          item.itemId,
          `has ${primaries.length} primary concepts; exactly one is required so ` +
            "per-concept mastery has an unambiguous owner",
        );
      }
    }

    const overlap = eraOverlapsWindow(item.era, window);
    if (overlap === null) {
      add(
        "ITEM_ERA_UNPARSEABLE",
        "WARNING",
        item.itemId,
        `era ${JSON.stringify(item.era)} yields no year, so scope cannot be checked`,
      );
    } else if (!overlap) {
      add(
        "ITEM_ERA_OUTSIDE_CHAPTER_WINDOW",
        "WARNING",
        item.itemId,
        `era ${item.era} does not overlap ${window.start}-${window.end}, so the ` +
          "item cannot appear on a Boston form however well its concept fits",
      );
    } else if (item.status === "MAPPED") {
      itemsEraEligible += 1;
    }
  }

  // -- missions -------------------------------------------------------------
  const seenMission = new Set<string>();
  for (const mission of ALL_MISSIONS) {
    if (seenMission.has(mission.missionId)) {
      add("MISSION_DUPLICATE", "ERROR", mission.missionId, "appears more than once");
    }
    seenMission.add(mission.missionId);

    for (const code of mission.assignedSeCodes) {
      if (!STUDENT_EXPECTATIONS.has(code)) {
        add(
          "MISSION_UNKNOWN_SE",
          "ERROR",
          mission.missionId,
          `assigned standard ${code} is not in the registry`,
        );
      } else if ((bySe.get(code) ?? []).length === 0) {
        add(
          "MISSION_SE_WITHOUT_CONCEPT",
          "WARNING",
          mission.missionId,
          `assigned standard ${code} has no concept beneath it`,
        );
      }
    }
    if (mission.assignmentStatus === "ASSIGNED" && mission.assignedSeCodes.length === 0) {
      add(
        "MISSION_ASSIGNED_WITHOUT_SES",
        "ERROR",
        mission.missionId,
        "marked ASSIGNED with no standards",
      );
    }
    if (mission.assignmentStatus === "OPEN" && mission.assignedSeCodes.length > 0) {
      add(
        "MISSION_OPEN_WITH_SES",
        "ERROR",
        mission.missionId,
        "marked OPEN but carries standards",
      );
    }
    if (mission.assignmentStatus === "OPEN") {
      add(
        "MISSION_ASSIGNMENT_OPEN",
        "WARNING",
        mission.missionId,
        "no settled standard assignment; content-blocked by design",
      );
    }
  }

  const readiness = missionReadiness(window);
  for (const mission of readiness) {
    if (
      !mission.conceptVocabularyReady &&
      mission.seCodesWithoutOwnedConcept.length > 0
    ) {
      add(
        "MISSION_WITHOUT_CONCEPTS",
        "WARNING",
        mission.missionId,
        `assigned standards with no assessable concept owned here: ` +
          mission.seCodesWithoutOwnedConcept.join(", "),
      );
    }
  }

  // -- summary --------------------------------------------------------------
  const seByStandardType: Record<string, number> = {};
  const seByRecurrence: Record<string, number> = {};
  const seByReportingCategory: Record<string, number> = {};
  const seByChapterTier: Record<string, number> = {};
  for (const se of ALL_STUDENT_EXPECTATIONS) {
    bump(seByStandardType, se.standardType);
    bump(seByRecurrence, se.recurrence);
    bump(seByReportingCategory, `RC${se.reportingCategory}`);
    bump(seByChapterTier, se.chapterTier);
  }

  const aliasesByForm: Record<string, number> = {};
  for (const alias of ALIASES) bump(aliasesByForm, alias.form);

  const summary: ValidationSummary = {
    studentExpectations: ALL_STUDENT_EXPECTATIONS.length,
    seByStandardType,
    seByRecurrence,
    seByReportingCategory,
    seByChapterTier,
    seWithVerbatimText: ALL_STUDENT_EXPECTATIONS.filter(
      (se) => se.textStatus === "VERBATIM_CITED",
    ).length,
    concepts: ALL_CONCEPTS.length,
    macroConcepts: ALL_CONCEPTS.filter((c) => c.tier === "MACRO").length,
    microConcepts: ALL_CONCEPTS.filter((c) => c.tier === "MICRO").length,
    conceptsAwaitingSmeApproval: ALL_CONCEPTS.filter(
      (c) => c.reviewStatus !== "SME_APPROVED",
    ).length,
    conceptsWithProposedRetag: ALL_CONCEPTS.filter(
      (c) => c.parentSeStatus === "PROPOSED_RETAG",
    ).length,
    conceptsWithoutMissionOwner: ALL_CONCEPTS.filter(
      (c) => c.owner.missionId === null,
    ).length,
    conceptsWithNoDeliverySurface: ALL_CONCEPTS.filter(
      (c) => c.owner.surface === "UNALLOCATED",
    ).length,
    aliases: ALIASES.length,
    aliasesByForm,
    aliasesResolvingToConcept: ALIASES.filter((a) => a.target.kind === "CONCEPT")
      .length,
    aliasesDeliberatelyUnresolved: ALIASES.filter(
      (a) => a.target.kind === "UNRESOLVED",
    ).length,
    items: ITEM_MAPPINGS.length,
    itemsMapped,
    itemsEraEligible,
    itemConceptEdges,
    missionsConceptReady: readiness.filter((m) => m.conceptVocabularyReady)
      .length,
    missionsItemReady: readiness.filter((m) => m.itemDepthReady).length,
    missionsBlocked: readiness.filter((m) => m.blockers.length > 0).length,
  };

  const errors = findings.filter((f) => f.severity === "ERROR");
  const warnings = findings.filter((f) => f.severity === "WARNING");

  return {
    ok: errors.length === 0,
    strictOk: errors.length === 0 && warnings.length === 0,
    errors,
    warnings,
    summary,
    missionReadiness: readiness,
  };
}
