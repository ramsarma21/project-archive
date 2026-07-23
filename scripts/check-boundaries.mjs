#!/usr/bin/env node
// Architecture boundary check (wave0a). Dependency-free, plain Node + fs walk.
//
// (a) Engine/assessment/contracts must not grow NEW imports from the content
//     layer (packages/runtime/src/content/*). The current known violations are
//     allowlisted as tracked debt and printed as warnings; any content import
//     NOT on the allowlist fails the check.
// (b) Generic-engine world modules should stay content-agnostic. We WARN (never
//     fail) when a "BOS." content literal appears in the files the audit
//     classified as GENERIC-ENGINE, so drift is visible without blocking.
//
// Usage: node scripts/check-boundaries.mjs

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const toPosix = (p) => p.split(sep).join("/");

// ---------------------------------------------------------------------------
// (a) content-import boundary
// ---------------------------------------------------------------------------

// Directories (recursive) + individual files scanned for content-layer imports.
const SCAN_DIRS = [
  "packages/runtime/src/engine",
  "packages/runtime/src/assessment",
  "packages/contracts/src",
];
const SCAN_FILES = [
  // runtime public barrel: re-exports Day-1 content by design (tracked debt).
  "packages/runtime/src/index.ts",
];

// Allowlist of the CURRENT known content-layer imports (path -> specifiers),
// normalized so the specifier starts at "content/". Anything here is warned
// about as debt; anything not here is a NEW violation and fails the check.
const ALLOWLIST = {
  // wave3 stage 1: engine/ctx.ts debt burned to ZERO (ChapterDefinition
  // injection); the barrel's re-export debt remains until the chapter package
  // lands and consumers move to @pa/chapter-boston.
  "packages/runtime/src/assessment/openResponseRegistry.ts": [
    "content/generated/act1OpenResponseContent.generated.js",
  ],
  "packages/runtime/src/index.ts": [
    "content/bostonChapter.js",
    "content/day1/flow.js",
    "content/day1/tables.js",
    "content/day1/text.js",
    "content/day1/reactive.js",
    "content/day1/choreography.js",
    "content/checkpoints/cp1Bank.js",
    "content/checkpoints/cp1Ids.js",
    "content/provenance.js",
  ],
};

const CODE_EXT = new Set([".ts", ".tsx", ".mts", ".cts"]);

function walk(absDir, out) {
  for (const entry of readdirSync(absDir)) {
    const abs = join(absDir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__" || entry.startsWith(".")) continue;
      walk(abs, out);
    } else {
      const dot = entry.lastIndexOf(".");
      if (dot >= 0 && CODE_EXT.has(entry.slice(dot))) out.push(abs);
    }
  }
}

function collectFiles() {
  const files = [];
  for (const d of SCAN_DIRS) {
    const abs = join(ROOT, d);
    if (existsSync(abs)) walk(abs, files);
  }
  for (const f of SCAN_FILES) {
    const abs = join(ROOT, f);
    if (existsSync(abs)) files.push(abs);
  }
  return files;
}

// Extract module specifiers from `import ... from "x"`, `export ... from "x"`,
// side-effect `import "x"`, and dynamic `import("x")`.
const SPEC_RE = /(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g;

function contentSpecifier(spec) {
  const i = spec.indexOf("content/");
  return i === -1 ? null : spec.slice(i);
}

const warnings = [];
const violations = [];

for (const abs of collectFiles()) {
  const rel = toPosix(relative(ROOT, abs));
  const src = readFileSync(abs, "utf8");
  const allowed = ALLOWLIST[rel] || [];
  let m;
  SPEC_RE.lastIndex = 0;
  while ((m = SPEC_RE.exec(src)) !== null) {
    const norm = contentSpecifier(m[1]);
    if (!norm) continue;
    if (allowed.includes(norm)) {
      warnings.push(`${rel}  ->  ${norm}`);
    } else {
      violations.push(`${rel}  ->  ${m[1]}`);
    }
  }
}

// ---------------------------------------------------------------------------
// (b) "BOS." literals in GENERIC-ENGINE world modules (warn only)
// ---------------------------------------------------------------------------

const GENERIC_ENGINE_WORLD = [
  "collision.ts",
  "playerMotion.ts",
  "playerInput.ts",
  "stamina.ts",
  "gameplayWorld.ts",
  "actorRegistry.ts",
  "interactionRegistry.ts",
  "interactionResolver.ts",
  "cameraOwnership.ts",
  "fieldSimulation.ts",
  "chaseModel.ts",
  "watcherDetection.ts",
].map((f) => `apps/web/src/world/${f}`);

const BOS_RE = /BOS\./g;
const bosWarnings = [];
for (const rel of GENERIC_ENGINE_WORLD) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) continue;
  const lines = readFileSync(abs, "utf8").split("\n");
  lines.forEach((line, idx) => {
    if (BOS_RE.test(line)) {
      BOS_RE.lastIndex = 0;
      bosWarnings.push(`${rel}:${idx + 1}  ${line.trim()}`);
    }
  });
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

console.log("boundary-check: content-layer imports in engine/assessment/contracts");
if (warnings.length) {
  console.log(`\n  known content-coupling debt (allowlisted, ${warnings.length}):`);
  for (const w of warnings) console.log(`    warn: ${w}`);
} else {
  console.log("  (no allowlisted content imports found)");
}

if (bosWarnings.length) {
  console.log(`\n  BOS.* literals in GENERIC-ENGINE world modules (${bosWarnings.length}):`);
  for (const w of bosWarnings) console.log(`    warn: ${w}`);
} else {
  console.log("\n  no BOS.* literals in GENERIC-ENGINE world modules");
}

if (violations.length) {
  console.error(`\n  FAIL: ${violations.length} NEW content-layer import(s) outside the allowlist:`);
  for (const v of violations) console.error(`    error: ${v}`);
  console.error("\n  Move the content dependency behind a contract, or extend the");
  console.error("  allowlist in scripts/check-boundaries.mjs if this is intentional debt.");
  process.exit(1);
}

console.log("\nboundary-check: OK (warnings only, no new violations)");
process.exit(0);
