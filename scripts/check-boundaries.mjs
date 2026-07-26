#!/usr/bin/env node
// Architecture boundary check (wave0a; hardened in waves 3 and 4).
// Dependency-free, plain Node + fs walk.
//
// The engine/content split is DONE: protocol/runtime (wave3) and the web world
// engine (wave4) are chapter-agnostic. These rules keep it that way:
//
// (a) ERROR — no content imports in the engine or contracts. Any import whose
//     specifier reaches a content layer (a "content/" path or a chapter
//     package "@pa/chapter-*") from packages/runtime/src or
//     packages/contracts/src or packages/engine-world/src fails the build.
// (b) ERROR — zero "BOS." literals in any engine/protocol package.
// (c) ERROR — apps/web imports world packages only through their public roots;
//     the app never reaches package internals or a relative src/world path.
//
// Waves 5+ add the ONE-CORE rules. Parkour, stealth, the duel and PvP all run on
// the same simulation core, and the failure mode is not a broken test on the day a
// second copy appears — it is drift, six weeks later, when two systems disagree
// about how far a body can jump or how much a dodge covers. These rules are cheap
// and they are the reason that cannot happen quietly:
//
// (d) ERROR — each core is defined exactly ONCE repo-wide, and in engine-world:
//     the fixed-step clock, the seeded RNG, the motion integrator, the collision
//     world and its sweep, the body model and its landmarks, the burst phase, and
//     the actor hit query.
// (e) ERROR — no package re-declares an engine tuning value. A local
//     `const GRAVITY = 9.8` is the canonical way this invariant dies.
// (f) ERROR — no Math.random in gameplay code. Every draw is seeded through
//     fieldRandom so a replay is a replay. Exceptions are named, dated and
//     justified in MATH_RANDOM_ALLOWLIST, never silent.
// (g) ERROR — no wall-clock reads in the simulation path. A run is a function of
//     its ticks; seconds are ticks * FIELD_DT. Exceptions are named and
//     justified in WALL_CLOCK_ALLOWLIST, never silent.
//
// Rules (d) through (f) discover packages dynamically, so a brand-new package is
// covered the moment it has a src directory, with no edit to this file. Rule (g)
// is scoped to the simulation directories, so a new module inside one of them is
// covered on creation.
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
  "packages/engine-world/src",
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
// (c) app world-package public-surface boundary (ERROR)
// ---------------------------------------------------------------------------

const appFiles = [];
const appSrc = join(ROOT, "apps/web/src");
if (existsSync(appSrc)) walk(appSrc, appFiles);
const appImportViolations = [];
for (const abs of appFiles) {
  const rel = toPosix(relative(ROOT, abs));
  const src = readFileSync(abs, "utf8");
  let m;
  SPEC_RE.lastIndex = 0;
  while ((m = SPEC_RE.exec(src)) !== null) {
    const spec = m[1];
    if (spec.startsWith("@pa/engine-world/") || /(?:^|\/)world\//.test(spec)) {
      appImportViolations.push(`${rel}  ->  ${spec}`);
    }
  }
}

// ---------------------------------------------------------------------------
// gameplay-file discovery + comment stripping (shared by (d), (e) and (f))
// ---------------------------------------------------------------------------

// Every package's src plus the web app's src. Discovered rather than listed, so a
// new package is covered on creation instead of when somebody remembers this file.
function collectGameplayFiles() {
  const roots = [];
  const packagesDir = join(ROOT, "packages");
  if (existsSync(packagesDir)) {
    for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const src = join(packagesDir, entry.name, "src");
      if (existsSync(src)) roots.push(src);
    }
  }
  const webSrc = join(ROOT, "apps/web/src");
  if (existsSync(webSrc)) roots.push(webSrc);

  const files = [];
  for (const root of roots) walk(root, files);
  return files;
}

// Comments are stripped before matching, so a line that merely SAYS
// "never Math.random" is not a violation and a commented-out constant is not a
// second definition. Newlines survive, so reported line numbers stay true.
function stripComments(source) {
  let out = "";
  let mode = "code";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (mode === "code") {
      if (c === "/" && next === "/") {
        mode = "line";
        i += 2;
        continue;
      }
      if (c === "/" && next === "*") {
        mode = "block";
        i += 2;
        continue;
      }
      if (c === "'") mode = "single";
      else if (c === '"') mode = "double";
      else if (c === "`") mode = "template";
      out += c;
      i += 1;
      continue;
    }
    if (mode === "line") {
      if (c === "\n") {
        mode = "code";
        out += c;
      }
      i += 1;
      continue;
    }
    if (mode === "block") {
      if (c === "*" && next === "/") {
        mode = "code";
        i += 2;
      } else {
        if (c === "\n") out += c;
        i += 1;
      }
      continue;
    }
    // inside a string or template literal
    if (c === "\\") {
      out += c + (next ?? "");
      i += 2;
      continue;
    }
    if (
      (mode === "single" && c === "'") ||
      (mode === "double" && c === '"') ||
      (mode === "template" && c === "`")
    ) {
      mode = "code";
    }
    out += c;
    i += 1;
  }
  return out;
}

const gameplayFiles = collectGameplayFiles().map((abs) => ({
  rel: toPosix(relative(ROOT, abs)),
  code: stripComments(readFileSync(abs, "utf8")),
}));

// ---------------------------------------------------------------------------
// (d) one core, repo-wide (ERROR)
// ---------------------------------------------------------------------------

const CORE_OWNER = "packages/engine-world/";

// Package-level ownership rather than file-level on purpose: which engine file a
// core lives in is engine-world's business — the body landmarks moved into
// collision.ts deliberately, because that file already owned three of the five body
// numbers — but WHICH PACKAGE owns it is the invariant.
const CORES = {
  "fixed-step clock": /^export const FIELD_TICK_HZ\s*[:=]/m,
  "seeded RNG": /^export function fieldRandom\s*\(/m,
  "seed projection": /^export function projectFieldSeed\s*\(/m,
  "motion integrator": /^export function stepMotion\s*\(/m,
  "swept collision": /^export function sweepXZ\s*\(/m,
  "collision world": /^export interface CollisionWorld\s*\{/m,
  gravity: /^export const GRAVITY\s*[:=]/m,
  "capsule radius": /^export const CAPSULE_RADIUS\s*[:=]/m,
  "body pose": /^export interface BodyPose\s*\{/m,
  "eye landmark": /^export const EYE_HEIGHT_FRACTION\s*[:=]/m,
  "chest landmark": /^export const CHEST_HEIGHT_FRACTION\s*[:=]/m,
  "burst phase entry": /^export function beginDash\s*\(/m,
  "actor hit query": /^export function segmentHitsCapsule\s*\(/m,
};

const coreViolations = [];
for (const [name, pattern] of Object.entries(CORES)) {
  const defining = gameplayFiles.filter((file) => pattern.test(file.code));
  if (defining.length === 0) {
    coreViolations.push(`${name}: no definition found (has it been renamed?)`);
    continue;
  }
  if (defining.length > 1) {
    coreViolations.push(
      `${name}: defined ${defining.length} times -> ${defining.map((f) => f.rel).join(", ")}`,
    );
    continue;
  }
  const [only] = defining;
  if (!only.rel.startsWith(CORE_OWNER)) {
    coreViolations.push(`${name}: defined outside the engine -> ${only.rel}`);
  }
}

// ---------------------------------------------------------------------------
// (e) no second copy of an engine tuning value (ERROR)
// ---------------------------------------------------------------------------

// Each group names the one package allowed to declare those values. Everyone
// else imports them.
const TUNING_OWNERS = [
  {
    owner: CORE_OWNER,
    names: [
      "GRAVITY",
      "PHYSICS_SUBSTEP",
      "CAPSULE_RADIUS",
      "STAND_HEIGHT",
      "CROUCH_HEIGHT",
      "EYE_HEIGHT_FRACTION",
      "CHEST_HEIGHT_FRACTION",
      "FIELD_TICK_HZ",
      "FIELD_DT",
      "WALK_SPEED",
      "RUN_SPEED",
      "CROUCH_SPEED",
      "DASH_SPEED_SCALE",
      "DASH_DURATION_MS",
    ],
  },
  {
    // The duel's structural numbers travel further than the engine's — grading,
    // the API and the HUD all reason about a round. A second copy of the round
    // count is how grading came to refuse every verdict past round 6 while its
    // own suite stayed green, and a second copy of a grant is how the same
    // suite went on asserting 3 and 1 bullets after the economy moved to 14
    // and 7. Both were restatements, not logic errors.
    owner: "packages/duel/",
    names: [
      "DUEL_ROUND_CEILING",
      "DUEL_ROUNDS",
      "BULLETS_FOR_CORRECT",
      "BULLETS_FOR_WRONG",
      "ENGAGEMENT_SECONDS",
    ],
  },
];

// Declarations only. `export { RUN_SPEED } from "…"` is a re-export, which is the
// correct way to pass an engine number along and must not trip this.
const tuningViolations = [];
for (const { owner, names } of TUNING_OWNERS) {
  const re = new RegExp(
    `\\b(?:const|let|var)\\s+(${names.join("|")})\\s*[:=]`,
    "g",
  );
  for (const file of gameplayFiles) {
    if (file.rel.startsWith(owner)) continue;
    const lines = file.code.split("\n");
    lines.forEach((line, index) => {
      re.lastIndex = 0;
      const match = re.exec(line);
      if (match) {
        tuningViolations.push(
          `${file.rel}:${index + 1}  re-declares ${match[1]} (owned by ${owner})`,
        );
      }
    });
  }
}

// ---------------------------------------------------------------------------
// (f) no Math.random in gameplay code (ERROR)
// ---------------------------------------------------------------------------

// Named exceptions, with a reason each. An entry here is a decision, not a mute:
// every accepted exception is printed on every successful run, so the list cannot
// grow quietly. The line the rule is really after is simulation randomness — a draw
// that changes what happens — as distinct from minting an identifier, which is
// non-determinism nobody replays.
const MATH_RANDOM_ALLOWLIST = new Map([
  [
    "apps/web/src/mission/useMissionSession.ts",
    "fallback branch of an attempt-id generator when crypto.randomUUID is missing; " +
      "identity, not a simulation draw, and the id is committed before it seeds anything",
  ],
]);

const randomViolations = [];
const randomExceptions = [];
for (const file of gameplayFiles) {
  const lines = file.code.split("\n");
  lines.forEach((line, index) => {
    if (!/\bMath\s*\.\s*random\s*\(/.test(line)) return;
    const reason = MATH_RANDOM_ALLOWLIST.get(file.rel);
    if (reason) {
      randomExceptions.push(`${file.rel}:${index + 1} — ${reason}`);
      return;
    }
    randomViolations.push(`${file.rel}:${index + 1}  ${line.trim().slice(0, 100)}`);
  });
}

// ---------------------------------------------------------------------------
// (g) no wall-clock reads in the simulation path (ERROR)
// ---------------------------------------------------------------------------

// The sibling of rule (f), and it fails the same way: not loudly, but as drift.
// A simulation is a function of its ticks. The moment one term of it is read off
// `performance.now()` — a stamina drain, a patrol phase, a sky brightening toward
// dawn — the run stops being reproducible from its seed and its inputs, and the
// replay story quietly becomes a claim nobody can check. It also stops being the
// same game at 30 and 144 Hz, and on a backgrounded school Chromebook it stops
// being a game at all.
//
// Scoped by directory rather than by file so a new simulation module is covered
// the moment it exists. Reporting wall time is fine and necessary — the result
// screen's "what the student actually sat through" is a wall-clock measurement —
// which is what the allowlist below is for, one named reason each.
const SIMULATION_DIRS = [
  "packages/engine-world/src/",
  "packages/beat/src/",
  "packages/duel/src/",
  "packages/pvp/src/",
  "packages/mission-m1/src/",
  "apps/web/src/mission/",
];

const WALL_CLOCK_ALLOWLIST = new Map([
  [
    "packages/engine-world/src/useSmoothedNumber.ts",
    "a React hook that eases a displayed number between renders; presentation " +
      "smoothing outside the fixed step, and nothing it produces is read back " +
      "into the simulation",
  ],
  [
    "packages/engine-world/src/noticeArbiter.ts",
    "presentation notice scheduling, injectable and defaulted; the arbiter " +
      "decides how long a caption is on screen, which is wall time by definition",
  ],
  [
    "apps/web/src/mission/useMissionSession.ts",
    "mints attempt ids and the ISO instants the attempt ledger and the result " +
      "screen's wall-clock figures are made of; the session's clock, never a " +
      "term in the run",
  ],
]);

const WALL_CLOCK_RE = /\b(?:Date\s*\.\s*now\s*\(|performance\s*\.\s*now\s*\(|new\s+Date\s*\()/;

const wallClockViolations = [];
const wallClockExceptions = [];
for (const file of gameplayFiles) {
  if (!SIMULATION_DIRS.some((dir) => file.rel.startsWith(dir))) continue;
  const lines = file.code.split("\n");
  lines.forEach((line, index) => {
    if (!WALL_CLOCK_RE.test(line)) return;
    const reason = WALL_CLOCK_ALLOWLIST.get(file.rel);
    if (reason) {
      wallClockExceptions.push(`${file.rel}:${index + 1} — ${reason}`);
      return;
    }
    wallClockViolations.push(`${file.rel}:${index + 1}  ${line.trim().slice(0, 100)}`);
  });
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

console.log(
  `boundary-check: scanned ${engineFiles.length} engine/protocol files, ` +
    `${appFiles.length} web app files and ${gameplayFiles.length} gameplay files ` +
    `across ${new Set(gameplayFiles.map((f) => f.rel.split("/").slice(0, 2).join("/"))).size} packages`,
);

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
if (appImportViolations.length) {
  failed = true;
  console.error(`\n  FAIL: ${appImportViolations.length} web app world deep import(s):`);
  for (const v of appImportViolations) console.error(`    error: ${v}`);
  console.error("  apps/web must import @pa/engine-world through package roots.");
}
if (coreViolations.length) {
  failed = true;
  console.error(`\n  FAIL: ${coreViolations.length} one-core violation(s):`);
  for (const v of coreViolations) console.error(`    error: ${v}`);
  console.error("  There is one simulation core and it lives in packages/engine-world.");
  console.error("  Consume it; never fork it. A second copy does not break today, it drifts.");
}
if (tuningViolations.length) {
  failed = true;
  console.error(`\n  FAIL: ${tuningViolations.length} duplicated engine tuning value(s):`);
  for (const v of tuningViolations) console.error(`    error: ${v}`);
  console.error("  Import the engine's constant instead of restating it. Two gravities is two games.");
}
if (randomViolations.length) {
  failed = true;
  console.error(`\n  FAIL: ${randomViolations.length} Math.random call(s) in gameplay code:`);
  for (const v of randomViolations) console.error(`    error: ${v}`);
  console.error("  Gameplay randomness is seeded: use fieldRandom(seed, tick, salt) so a replay replays.");
  console.error("  A genuine exception goes in MATH_RANDOM_ALLOWLIST with a reason.");
}
if (wallClockViolations.length) {
  failed = true;
  console.error(`\n  FAIL: ${wallClockViolations.length} wall-clock read(s) in the simulation path:`);
  for (const v of wallClockViolations) console.error(`    error: ${v}`);
  console.error("  A simulation is a function of its ticks. Take the fixed step's dt, or the tick,");
  console.error("  and derive seconds as ticks * FIELD_DT — never the wall clock.");
  console.error("  Reporting wall time is legitimate: name the exception in WALL_CLOCK_ALLOWLIST.");
}

if (failed) process.exit(1);

if (randomExceptions.length) {
  console.log(`\n  ${randomExceptions.length} accepted Math.random exception(s):`);
  for (const note of randomExceptions) console.log(`    note: ${note}`);
}
if (wallClockExceptions.length) {
  console.log(`\n  ${wallClockExceptions.length} accepted wall-clock exception(s):`);
  for (const note of wallClockExceptions) console.log(`    note: ${note}`);
}

console.log(
  "\nboundary-check: OK (engine/protocol are chapter-clean; app world imports are public;" +
    " one core, one body model, one clock, one RNG; no unseeded randomness;" +
    " no wall clock in the simulation)",
);
process.exit(0);
