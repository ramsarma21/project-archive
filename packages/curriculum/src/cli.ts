import { DEFECTS_BY_OWNER, SOURCE_DEFECTS } from "./sourceDefects.js";
import { validateCurriculum, type Finding, type ValidationReport } from "./validate.js";

// ============================================================================
// CI check. Same validator as the library; this only chooses an exit code and a
// format.
//
//   pnpm --filter @pa/curriculum curriculum:check
//   pnpm --filter @pa/curriculum curriculum:check -- --json
//   pnpm --filter @pa/curriculum curriculum:check -- --strict
//
// Exit codes: 0 clean, 1 referential-integrity errors, 2 warnings under
// --strict. Warnings alone never fail the default run, because every warning in
// the Boston seed is a known content gap and a check that always fails is a
// check nobody reads.
// ============================================================================

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const strict = argv.includes("--strict");
const requireCodexCards = argv.includes("--require-codex-cards");
const requireSmeApproval = argv.includes("--require-sme-approval");

const report = validateCurriculum({
  ...(requireCodexCards ? { requireCodexCards: true } : {}),
  ...(requireSmeApproval ? { requireSmeApproval: true } : {}),
});

function groupByCode(findings: Finding[]): Map<string, Finding[]> {
  const out = new Map<string, Finding[]>();
  for (const finding of findings) {
    const list = out.get(finding.code);
    if (list) list.push(finding);
    else out.set(finding.code, [finding]);
  }
  return out;
}

function printHuman(result: ValidationReport): void {
  const s = result.summary;
  console.log("curriculum registry check");
  console.log("=========================\n");

  console.log(
    `student expectations   ${s.studentExpectations}` +
      `  (readiness ${s.seByStandardType.READINESS ?? 0},` +
      ` supporting ${s.seByStandardType.SUPPORTING ?? 0};` +
      ` once ${s.seByRecurrence.ONCE ?? 0}, spiral ${s.seByRecurrence.SPIRAL ?? 0})`,
  );
  const withoutText = s.studentExpectations - s.seWithVerbatimText;
  console.log(
    `  verbatim text        ${s.seWithVerbatimText} of ${s.studentExpectations}` +
      (withoutText === 0
        ? " — every standard holds its own words"
        : ` — ${withoutText} carry paraphrase only`),
  );
  console.log(
    `concepts               ${s.concepts}` +
      `  (macro ${s.macroConcepts}, micro ${s.microConcepts})`,
  );
  console.log(
    `  proposed retags      ${s.conceptsWithProposedRetag}` +
      `   awaiting SME ${s.conceptsAwaitingSmeApproval}` +
      `   no mission owner ${s.conceptsWithoutMissionOwner}` +
      `   no delivery surface ${s.conceptsWithNoDeliverySurface}`,
  );
  console.log(
    `aliases                ${s.aliases}` +
      `  (${s.aliasesResolvingToConcept} reach a concept,` +
      ` ${s.aliasesDeliberatelyUnresolved} deliberately unresolved)`,
  );
  for (const [form, count] of Object.entries(s.aliasesByForm).sort()) {
    console.log(`    ${form.padEnd(28)} ${count}`);
  }
  console.log(
    `items                  ${s.items}` +
      `  (${s.itemsMapped} mapped, ${s.itemsEraEligible} era-eligible,` +
      ` ${s.itemConceptEdges} item/concept edges)`,
  );
  console.log(
    `missions               ${s.missionsConceptReady}/14 concept-ready,` +
      ` ${s.missionsItemReady}/14 item-ready\n`,
  );

  console.log("mission readiness                concepts  items");
  console.log("------------------------------------------------");
  for (const mission of result.missionReadiness) {
    const concepts = mission.conceptVocabularyReady ? "ok   " : "BLOCK";
    const items = mission.itemDepthReady ? "ok   " : "BLOCK";
    const label = `${mission.missionId.padEnd(4)} ${mission.title}`;
    console.log(`  ${label.padEnd(31)} ${concepts}     ${items}`);
    for (const blocker of mission.blockers) {
      console.log(`      - ${blocker}`);
    }
  }
  console.log("");

  const sections: [string, Finding[]][] = [
    ["errors", result.errors],
    ["warnings", result.warnings],
  ];
  for (const [title, findings] of sections) {
    console.log(`${title} (${findings.length})`);
    console.log("-".repeat(title.length + 6));
    if (findings.length === 0) {
      console.log("  none\n");
      continue;
    }
    for (const [code, group] of groupByCode(findings)) {
      console.log(`  ${code}  x${group.length}`);
      for (const finding of group) {
        console.log(`    ${finding.subject}: ${finding.message}`);
      }
    }
    console.log("");
  }

  console.log(`recorded source defects (${SOURCE_DEFECTS.length})`);
  console.log("--------------------------------------------");
  for (const [owner, defects] of DEFECTS_BY_OWNER) {
    console.log(`  ${owner} (${defects.length})`);
    for (const defect of defects) {
      console.log(`    ${defect.id}  [${defect.kind}]`);
    }
  }
  console.log("");

  console.log(
    result.ok
      ? "PASS — referential integrity holds."
      : `FAIL — ${result.errors.length} referential-integrity error(s).`,
  );
  if (result.ok && !result.strictOk) {
    console.log(
      `${result.warnings.length} warning(s): the registry is coherent and the ` +
        "curriculum has known holes.",
    );
  }
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printHuman(report);
}

if (!report.ok) {
  process.exitCode = 1;
} else if (strict && !report.strictOk) {
  process.exitCode = 2;
}
