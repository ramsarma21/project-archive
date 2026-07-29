#!/usr/bin/env node
// Post-hoc lane-integrity detector: catch a crossed-lane edit from git state,
// AFTER it has happened, so a violation is caught even when prevention fails.
//
// WHY THIS EXISTS. `.cursor/hooks/lane-guard.sh` is the PREVENTION: a preToolUse
// hook that refuses a write into another lane's files. It is logically correct
// (`--selftest` passes) and it fails OPEN by design so a guard bug cannot halt
// all work. But prevention that fails open needs detection that cannot: on
// 29 Jul four writes into `apps/web/src/mission/**` — paths the enforced map
// marks contested — SUCCEEDED, because the preToolUse hook did not fire for that
// background subagent's tool calls at all. A guard that never runs denies
// nothing, and nothing noticed until a human read the diff. This check is the
// thing that notices.
//
// It reads the SAME map the guard reads (`.cursor/lane-ownership.json` in the
// main checkout) and, for every worktree lane, compares the files that lane's
// branch has changed against what the map says the lane may write. It honours
// the same `grants` the guard honours, so a file legitimately granted to a lane
// is not reported against it.
//
// WHAT IT REPORTS, most dangerous first:
//   1. CLOBBER   the same file modified on two live lanes at once. This is the
//                actual way work gets destroyed — not a permission technicality,
//                but two branches that will not merge cleanly and whose last
//                writer wins. Fails the run.
//   2. VIOLATION a file a lane edited that (a) another lane owns, (b) is granted
//                to another lane, or (c) is contested and not granted to it.
//                Each is a write the guard would have denied. Fails the run.
//   3. OPEN      a file edited that no lane owns and no rule covers. The map's
//                policy is "anything unclaimed is open", so this is ALLOWED and
//                does not fail the run — but it is scope drift (the map does not
//                describe what the lane is actually doing) and is printed so the
//                map can grow to cover it. `--strict` promotes OPEN to a failure.
//
// A deliberately NON-symmetric choice, matching the guard: OPEN does not fail by
// default. The guard allows unclaimed paths; a detector that failed on them would
// contradict the enforced policy and would fail on nearly every branch, which is
// how a check becomes noise nobody reads. The clobber and the true violations are
// what carry the risk, and those fail loudly.
//
// Usage:
//   node scripts/check-lane-integrity.mjs            # audit all worktree lanes
//   node scripts/check-lane-integrity.mjs --strict   # also fail on OPEN drift
//   node scripts/check-lane-integrity.mjs --json      # machine-readable report
// Overrides (for tests / non-standard layouts):
//   LANE_HUB=<main checkout>  LANE_WORKTREES=<worktrees root>  LANE_MAP=<map path>

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const STRICT = process.argv.includes("--strict");
const JSON_OUT = process.argv.includes("--json");

// ---------------------------------------------------------------------------
// Locate the hub (main checkout) and the worktrees root. The script lives at
// <checkout>/scripts/, and <checkout> is either the main `project-archive` or a
// worktree `project-archive-worktrees/<lane>`. Resolve both from that, so the
// tool works whether it is run from main (the audit loop's home) or from the
// lane it happens to be committed on.
// ---------------------------------------------------------------------------
const CHECKOUT = dirname(dirname(fileURLToPath(import.meta.url)));
let HUB = process.env.LANE_HUB;
let WORKTREES = process.env.LANE_WORKTREES;
if (!HUB || !WORKTREES) {
  const parent = dirname(CHECKOUT);
  if (basename(parent) === "project-archive-worktrees") {
    WORKTREES = WORKTREES || parent;
    HUB = HUB || join(dirname(parent), "project-archive");
  } else {
    HUB = HUB || CHECKOUT;
    WORKTREES = WORKTREES || join(dirname(CHECKOUT), "project-archive-worktrees");
  }
}
const MAP_PATH = process.env.LANE_MAP || join(HUB, ".cursor", "lane-ownership.json");

function fail(message) {
  console.error(`check-lane-integrity: ${message}`);
  process.exit(2);
}

if (!existsSync(MAP_PATH)) fail(`ownership map not found at ${MAP_PATH}`);
if (!existsSync(WORKTREES)) fail(`worktrees root not found at ${WORKTREES}`);

let MAP;
try {
  MAP = JSON.parse(readFileSync(MAP_PATH, "utf8"));
} catch (err) {
  fail(`could not parse ${MAP_PATH}: ${err.message}`);
}

const LANES = MAP.lanes || {};
const CONTESTED = MAP.contested || [];
const GRANTS = MAP.grants || [];

// ---------------------------------------------------------------------------
// Glob matching, kept faithful to the guard. The guard tests `[[ $rel == $glob ]]`
// in bash, where `*` (and therefore `**`) matches any run of characters INCLUDING
// slashes. So both collapse to `.*` here. Anything else is matched literally.
// ---------------------------------------------------------------------------
function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}
const matchesAny = (rel, globs) => (globs || []).some((g) => globToRegExp(g).test(rel));

// ---------------------------------------------------------------------------
// Which files has a lane's branch changed? The lane's own commits since it left
// main (`main...HEAD`, three-dot: merge-base to HEAD, so a `git merge main` does
// not drag main's own files into the set), UNION the working tree (staged,
// unstaged, and untracked). That union is "what this branch would bring to a
// merge", which is exactly the clobber surface.
// ---------------------------------------------------------------------------
function git(dir, args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" });
}

function changedFiles(dir) {
  const files = new Set();
  try {
    const committed = git(dir, ["diff", "--name-only", "main...HEAD"]);
    for (const line of committed.split("\n")) {
      const p = line.trim();
      if (p) files.add(p);
    }
  } catch {
    // no `main` ref or a detached state: fall back to working tree only.
  }
  try {
    const porcelain = git(dir, ["status", "--porcelain"]);
    for (const raw of porcelain.split("\n")) {
      if (!raw.trim()) continue;
      // "XY path" or "XY orig -> new"; take the live path (the new one on rename).
      let p = raw.slice(3).trim();
      const arrow = p.indexOf(" -> ");
      if (arrow >= 0) p = p.slice(arrow + 4).trim();
      // git may quote paths containing unusual characters; strip the quotes.
      if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
      if (p) files.add(p);
    }
  } catch {
    // not a git worktree: leave the set as-is.
  }
  return [...files].sort();
}

// ---------------------------------------------------------------------------
// Classify one file for one lane, mirroring the guard's precedence exactly:
// grant-to-me > grant-to-other > contested > owned-by-me > owned-by-other > open.
// ---------------------------------------------------------------------------
function classify(lane, rel) {
  const grantedToMe = GRANTS.find((g) => g.lane === lane && matchesAny(rel, g.paths));
  if (grantedToMe) return { kind: "granted", detail: grantedToMe.reason || "granted" };

  const grantedToOther = GRANTS.find((g) => g.lane !== lane && matchesAny(rel, g.paths));
  if (grantedToOther) {
    return { kind: "violation", why: `granted to lane '${grantedToOther.lane}'`, severity: "granted-elsewhere" };
  }

  if (matchesAny(rel, CONTESTED)) {
    return { kind: "violation", why: "contested (shared, owned by no lane)", severity: "contested" };
  }

  if (matchesAny(rel, LANES[lane])) return { kind: "owned" };

  const owner = Object.keys(LANES).find((l) => l !== lane && matchesAny(rel, LANES[l]));
  if (owner) return { kind: "violation", why: `owned by lane '${owner}'`, severity: "owned-elsewhere" };

  return { kind: "open" };
}

// ---------------------------------------------------------------------------
// Walk the worktrees.
// ---------------------------------------------------------------------------
const laneDirs = readdirSync(WORKTREES, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

const perLane = [];
const fileToLanes = new Map(); // rel -> Set(lane) for lanes that changed it

for (const lane of laneDirs) {
  const dir = join(WORKTREES, lane);
  if (!existsSync(join(dir, ".git"))) continue; // not a worktree
  const files = changedFiles(dir);
  const record = { lane, dir, granted: [], owned: [], open: [], violations: [], fileCount: files.length };
  for (const rel of files) {
    if (!fileToLanes.has(rel)) fileToLanes.set(rel, new Set());
    fileToLanes.get(rel).add(lane);
    const verdict = classify(lane, rel);
    if (verdict.kind === "violation") record.violations.push({ rel, ...verdict });
    else if (verdict.kind === "granted") record.granted.push({ rel, ...verdict });
    else if (verdict.kind === "owned") record.owned.push(rel);
    else record.open.push(rel);
  }
  perLane.push(record);
}

// The clobber condition: one file, two (or more) live lanes.
const collisions = [...fileToLanes.entries()]
  .filter(([, lanes]) => lanes.size > 1)
  .map(([rel, lanes]) => ({ rel, lanes: [...lanes].sort() }))
  .sort((a, b) => a.rel.localeCompare(b.rel));

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------
if (JSON_OUT) {
  console.log(JSON.stringify({ hub: HUB, worktrees: WORKTREES, map: MAP_PATH, perLane, collisions }, null, 2));
}

const totalViolations = perLane.reduce((n, l) => n + l.violations.length, 0);
const totalOpen = perLane.reduce((n, l) => n + l.open.length, 0);
const liveLanes = perLane.filter((l) => l.fileCount > 0);

if (!JSON_OUT) {
  console.log(
    `check-lane-integrity: ${laneDirs.length} worktree lane(s), ${liveLanes.length} with changes, ` +
      `map ${MAP_PATH.replace(HUB + "/", "")}`,
  );

  // 1. CLOBBER — the same file on two live lanes.
  if (collisions.length) {
    console.error(`\n  CLOBBER: ${collisions.length} file(s) modified on more than one live lane at once:`);
    for (const c of collisions) console.error(`    error: ${c.rel}  <-  ${c.lanes.join(", ")}`);
    console.error("  This is the condition that destroys work: two branches change one file and the");
    console.error("  merge keeps one. Sequence these lanes — one finishes and merges before the other");
    console.error("  touches the file — or split the file so each lane owns a side.");
  }

  // 2. VIOLATION — writes the guard would have denied.
  for (const l of perLane) {
    if (!l.violations.length) continue;
    console.error(`\n  VIOLATION: lane '${l.lane}' changed ${l.violations.length} file(s) it may not write:`);
    for (const v of l.violations) console.error(`    error: ${v.rel}  (${v.why})`);
  }
  if (totalViolations) {
    console.error("\n  Each of these is a write the lane guard would refuse. If the work is legitimate,");
    console.error("  the orchestrator grants the file to the lane (an entry in `grants`, with a reason)");
    console.error("  or reassigns ownership — it does not stay an unrecorded cross-lane edit.");
  }

  // 3. OPEN — allowed, but drift worth seeing.
  if (totalOpen) {
    const header = STRICT ? "OPEN (failing under --strict)" : "OPEN (allowed — unclaimed paths, reported as drift)";
    console.log(`\n  ${header}:`);
    for (const l of perLane) {
      if (!l.open.length) continue;
      console.log(`    ${l.lane}:`);
      for (const rel of l.open) console.log(`      note: ${rel}`);
    }
    console.log("  No lane owns these, so the guard allows them. Claiming them in the map is how the");
    console.log("  map stays a description of what lanes actually do rather than what they once did.");
  }

  // Grants that were honoured, so the escape hatch is visible on every run.
  const grantedNotes = perLane.flatMap((l) => l.granted.map((g) => ({ lane: l.lane, ...g })));
  if (grantedNotes.length) {
    console.log(`\n  ${grantedNotes.length} edit(s) under an active grant (allowed):`);
    for (const g of grantedNotes) console.log(`    note: ${g.lane} -> ${g.rel}  (${g.detail})`);
  }
}

const failed = collisions.length > 0 || totalViolations > 0 || (STRICT && totalOpen > 0);
if (failed) {
  if (!JSON_OUT) console.error("\ncheck-lane-integrity: FAIL");
  process.exit(1);
}
if (!JSON_OUT) console.log("\ncheck-lane-integrity: OK (no clobber, no cross-lane violation)");
process.exit(0);
