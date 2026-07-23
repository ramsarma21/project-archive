#!/usr/bin/env node
// Architecture boundary check (wave0a; hardened in wave3).
// Dependency-free, plain Node + fs walk.
//
// The engine/content split is DONE (wave3): @pa/contracts is protocol-only
// and @pa/runtime is a chapter-agnostic engine. These rules keep it that way:
//
// (a) ERROR — no content imports in the engine or contracts. Any import whose
//     specifier reaches a content layer (a "content/" path or a chapter
//     package "@pa/chapter-*") from packages/runtime/src or
//     packages/contracts/src fails the build. The allowlist is GONE (debt
//     burned to zero in wave3); do not reintroduce one.
// (b) ERROR — zero "BOS." literals in packages/contracts/src and
//     packages/runtime/src (comments included: chapter vocabulary belongs in
//     chapter packages, full stop).
// (c) WARN — "BOS." literals in the web GENERIC-ENGINE world modules stay
//     visible-but-nonblocking until Wave 4 flips them to ERROR.
//
// Usage: node scripts/check-boundaries.mjs

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const toPosix = (p) => p.split(sep).join("/");

// ---------------------------------------------------------------------------
// (a) content-import boundary (ERROR, no allowlist)
// ---------------------------------------------------------------------------

// Engine + protocol directories that must never import chapter content.
const ENGINE_SCAN_DIRS = [
  "packages/runtime/src",
  "packages/contracts/src",
];

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

function collectEngineFiles() {
  const files = [];
  for (const d of ENGINE_SCAN_DIRS) {
    const abs = join(ROOT, d);
    if (existsSync(abs)) walk(abs, files);
  }
  return files;
}

// Extract module specifiers from `import ... from "x"`, `export ... from "x"`,
// side-effect `import "x"`, and dynamic `import("x")`.
const SPEC_RE = /(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g;

function isContentSpecifier(spec) {
  if (spec.startsWith("@pa/chapter-")) return true;
  return spec.includes("content/");
}

const violations = [];
const engineFiles = collectEngineFiles();

for (const abs of engineFiles) {
  const rel = toPosix(relative(ROOT, abs));
  const src = readFileSync(abs, "utf8");
  let m;
  SPEC_RE.lastIndex = 0;
  while ((m = SPEC_RE.exec(src)) !== null) {
    if (isContentSpecifier(m[1])) {
      violations.push(`${rel}  ->  ${m[1]}`);
    }
  }
}

// ---------------------------------------------------------------------------
// (b) "BOS." literals in engine/protocol packages (ERROR)
// ---------------------------------------------------------------------------

const BOS_RE = /BOS\./;
const bosViolations = [];
for (const abs of engineFiles) {
  const rel = toPosix(relative(ROOT, abs));
  const lines = readFileSync(abs, "utf8").split("\n");
  lines.forEach((line, idx) => {
    if (BOS_RE.test(line)) {
      bosViolations.push(`${rel}:${idx + 1}  ${line.trim().slice(0, 120)}`);
    }
  });
}

// ---------------------------------------------------------------------------
// (c) "BOS." literals in web GENERIC-ENGINE world modules (WARN until wave 4)
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

const bosWarnings = [];
for (const rel of GENERIC_ENGINE_WORLD) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) continue;
  const lines = readFileSync(abs, "utf8").split("\n");
  lines.forEach((line, idx) => {
    if (BOS_RE.test(line)) {
      bosWarnings.push(`${rel}:${idx + 1}  ${line.trim().slice(0, 120)}`);
    }
  });
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

console.log(`boundary-check: scanned ${engineFiles.length} engine/protocol files`);

if (bosWarnings.length) {
  console.log(`\n  BOS.* literals in GENERIC-ENGINE world modules (warn until wave 4, ${bosWarnings.length}):`);
  for (const w of bosWarnings) console.log(`    warn: ${w}`);
} else {
  console.log("\n  no BOS.* literals in GENERIC-ENGINE world modules");
}

let failed = false;
if (violations.length) {
  failed = true;
  console.error(`\n  FAIL: ${violations.length} content-layer import(s) in engine/protocol packages:`);
  for (const v of violations) console.error(`    error: ${v}`);
  console.error("  The engine never imports chapter content. Inject it through");
  console.error("  ChapterDefinition (packages/runtime/src/engine/chapter.ts).");
}
if (bosViolations.length) {
  failed = true;
  console.error(`\n  FAIL: ${bosViolations.length} "BOS." literal(s) in engine/protocol packages:`);
  for (const v of bosViolations) console.error(`    error: ${v}`);
  console.error("  Chapter vocabulary belongs in the chapter package (@pa/chapter-boston).");
}

if (failed) process.exit(1);

console.log("\nboundary-check: OK (engine/protocol are chapter-clean)");
process.exit(0);
