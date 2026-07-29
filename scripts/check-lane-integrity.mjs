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
// PREVENTION IS NOT AVAILABLE HERE, SO THIS IS THE ENFORCEMENT POINT. The 29 Jul
// hooks log settled it: the guard's logic works (89 completed invocations, 87
// allow, 2 correct deny) but 148 more were cancelled at 0 ms with no verdict, and
// they split by session — foreground calls complete, whole background-subagent
// conversations abort and fall open. On top of that, `Shell` is not in the hook
// matcher, so an edit made with python, sed, a heredoc, cp or a redirect fires no
// hook at all and is invisible even to that log. A shell command carries no file
// path to inspect, so that hole is structural. Neither is fixable from the guard,
// which is why this check is wired into `pnpm gate` rather than left to be
// remembered: a detector nobody runs protects exactly as much as a guard that
// never fires.
//
// WHAT IT REPORTS, most dangerous first:
//   1. CLOBBER   the same file modified on two live lanes at once AND holding
//                DIFFERENT content on them. This is the actual way work gets
//                destroyed — two branches change one file and the merge keeps
//                one. Fails the run.
//   2. VIOLATION a file a lane edited that (a) another lane owns, (b) is granted
//                to another lane, or (c) is contested and not granted to it.
//                Each is a write the guard would have denied. Fails the run.
//   3. PROPAGATION the same file on several lanes with BYTE-IDENTICAL content.
//                Allowed and non-failing: whichever lane merges first, the others
//                merge as a no-op, so there is nothing to destroy. This is what
//                copying the reconciled `.cursor/` guard and map into every
//                worktree looks like, and reporting it as a CLOBBER made every
//                run exit non-zero for a condition nobody could act on — which is
//                how a check gets muted. It is still PRINTED, because identical
//                today is divergent tomorrow.
//   4. OPEN      a file edited that no lane owns and no rule covers. The map's
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
// WHY `--lane` EXISTS, and why it is not the default. Run bare, this fails on any
// crossed lane anywhere — correct for the orchestrator's standing audit, wrong for
// a merge gate, where a red caused by a DIFFERENT lane is not something the person
// merging can fix, and an unfixable red is the other way a check gets muted. With
// `--lane <name>` the report is unchanged and complete; only the FAILURE is scoped
// to findings that involve that lane. `--lane auto` reads the lane from the
// checkout the script is running in, which is what `scripts/merge-gate.mjs`
// passes; in the MAIN checkout it deliberately resolves to no scope at all, so
// the orchestrator's own gate run is the full audit.
//
// Usage:
//   node scripts/check-lane-integrity.mjs             # audit all worktree lanes
//   node scripts/check-lane-integrity.mjs --lane auto # fail only on THIS lane's findings
//   node scripts/check-lane-integrity.mjs --lane duel-hud
//   node scripts/check-lane-integrity.mjs --strict    # also fail on OPEN drift
//   node scripts/check-lane-integrity.mjs --json      # machine-readable report
//   node scripts/check-lane-integrity.mjs --selftest  # exercise the pure logic
// Overrides (for tests / non-standard layouts):
//   LANE_HUB=<main checkout>  LANE_WORKTREES=<worktrees root>  LANE_MAP=<map path>

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const STRICT = process.argv.includes("--strict");
const JSON_OUT = process.argv.includes("--json");
const SELFTEST = process.argv.includes("--selftest");
const LANE_ARG = (() => {
  const i = process.argv.indexOf("--lane");
  return i >= 0 ? process.argv[i + 1] : null;
})();

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

/** The lane a checkout IS, or "main" for the hub, or null when outside both. */
function laneOfCheckout(dir) {
  const parent = dirname(dir);
  if (basename(parent) === "project-archive-worktrees") return basename(dir);
  if (basename(dir) === "project-archive") return "main";
  return null;
}

function fail(message) {
  console.error(`check-lane-integrity: ${message}`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Glob matching, kept faithful to the guard. The guard tests `[[ $rel == $glob ]]`
// in bash, where `*` (and therefore `**`) matches any run of characters INCLUDING
// slashes. So both collapse to `.*` here. Anything else is matched literally.
// ---------------------------------------------------------------------------
export function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}
export const matchesAny = (rel, globs) => (globs || []).some((g) => globToRegExp(g).test(rel));

// ---------------------------------------------------------------------------
// The two pure decisions, lifted out so `--selftest` can drive them without a
// repository. They are the part that can be wrong quietly: a mis-partitioned
// collision either hides a real clobber or restores the noise that got the check
// ignored, and neither shows up in a normal green run.
// ---------------------------------------------------------------------------

/**
 * Split one-file-on-many-lanes into the case that destroys work and the cases
 * that cannot.
 *
 * WHY THE COMPARISON IS AGAINST `main`, NOT BETWEEN LANES. `changedFiles` diffs a
 * branch against its MERGE BASE, so a lane that is merely behind main and has had
 * one file synced forward reports that file as "changed" while carrying content
 * main already has. Six lanes did exactly that with the reconciled `.cursor/`
 * guard and map, and reporting it as a CLOBBER made the run exit non-zero for a
 * condition nobody could act on — which is how a check gets muted. A copy equal
 * to main's is not a change the lane is bringing; merging it is a literal no-op,
 * so it cannot be one side of a clobber. Note the trap this avoids: as soon as
 * ONE lane legitimately edits the map, a between-lanes comparison calls it a
 * seven-way clobber against six stale copies, which is the same false alarm
 * wearing a different hat.
 *
 * @param entries [{ rel, mainKey, lanes: [{ lane, contentKey }] }] — a
 *   `contentKey` is the blob hash of that lane's copy, `"(absent)"` where the
 *   lane deleted it, or `null` where it could not be read.
 * @returns { clobbers, propagations } — a CLOBBER is a file that two or more
 *   lanes are bringing DIFFERENT new content for (last writer wins, work is
 *   destroyed). A PROPAGATION is shared but harmless, and carries the reason.
 */
export function partitionCollisions(entries) {
  const clobbers = [];
  const propagations = [];
  for (const entry of entries) {
    const lanes = [...entry.lanes].sort((a, b) => a.lane.localeCompare(b.lane));
    const names = lanes.map((l) => l.lane);
    // An unreadable copy counts as diverging on purpose: "I could not compare
    // them" must never render as "they agree".
    const diverging = lanes.filter((l) => l.contentKey === null || l.contentKey !== entry.mainKey);
    const keys = new Set(diverging.map((l) => l.contentKey));

    if (diverging.length <= 1) {
      propagations.push({
        rel: entry.rel,
        lanes: names,
        reason:
          diverging.length === 0
            ? `every copy equals main's; no lane is changing it`
            : `only '${diverging[0].lane}' differs from main; the rest carry main's own copy`,
      });
    } else if (keys.size === 1 && !keys.has(null)) {
      propagations.push({
        rel: entry.rel,
        lanes: diverging.map((l) => l.lane),
        reason: `${diverging.length} lanes ahead of main with byte-identical content; whichever merges first, the rest are no-ops`,
      });
    } else {
      clobbers.push({ rel: entry.rel, lanes: diverging.map((l) => l.lane) });
    }
  }
  const byRel = (a, b) => a.rel.localeCompare(b.rel);
  return { clobbers: clobbers.sort(byRel), propagations: propagations.sort(byRel) };
}

/**
 * Does this run fail, and on what?
 *
 * `lane` scopes only the VERDICT, never the report: with a lane set, a clobber
 * counts when that lane is one of its sides and a violation counts when that lane
 * committed it. Everything else is still printed — it is simply not this merge's
 * to fix.
 */
export function failureDecision({ clobbers = [], perLane = [], strict = false, lane = null }) {
  const myClobbers = lane ? clobbers.filter((c) => c.lanes.includes(lane)) : clobbers;
  const laneRecords = lane ? perLane.filter((l) => l.lane === lane) : perLane;
  const violations = laneRecords.reduce((n, l) => n + l.violations.length, 0);
  const open = laneRecords.reduce((n, l) => n + l.open.length, 0);
  return {
    failed: myClobbers.length > 0 || violations > 0 || (strict && open > 0),
    clobbers: myClobbers.length,
    violations,
    open,
  };
}

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
export function classify(map, lane, rel) {
  const grants = map.grants || [];
  const lanes = map.lanes || {};
  const contested = map.contested || [];

  const grantedToMe = grants.find((g) => g.lane === lane && matchesAny(rel, g.paths));
  if (grantedToMe) return { kind: "granted", detail: grantedToMe.reason || "granted" };

  const grantedToOther = grants.find((g) => g.lane !== lane && matchesAny(rel, g.paths));
  if (grantedToOther) {
    return { kind: "violation", why: `granted to lane '${grantedToOther.lane}'`, severity: "granted-elsewhere" };
  }

  if (matchesAny(rel, contested)) {
    return { kind: "violation", why: "contested (shared, owned by no lane)", severity: "contested" };
  }

  if (matchesAny(rel, lanes[lane])) return { kind: "owned" };

  const owner = Object.keys(lanes).find((l) => l !== lane && matchesAny(rel, lanes[l]));
  if (owner) return { kind: "violation", why: `owned by lane '${owner}'`, severity: "owned-elsewhere" };

  return { kind: "open" };
}

// ---------------------------------------------------------------------------
// Selftest — the pure logic only, no repository, no worktrees. Every case that
// asserts an ALLOW is paired with the mutation that must turn it into a failure,
// because a check that cannot fail is not evidence.
// ---------------------------------------------------------------------------
function selftest(verbose = true) {
  const map = {
    contested: ["apps/web/src/duel/duel.css"],
    grants: [{ lane: "module-lesson", paths: ["content/m1/module.json"], reason: "deck rework" }],
    lanes: {
      "boss-fight": ["content/**"],
      "module-lesson": ["apps/web/src/module/**"],
      "duel-hud": ["apps/web/src/duel/CombatHud.tsx"],
    },
  };
  const kind = (lane, rel) => classify(map, lane, rel).kind;
  const part = (entries) => partitionCollisions(entries);
  // `mainKey: "M"` throughout, so a copy keyed "M" is one main already has.
  const two = (rel, aKey, bKey) => [
    { rel, mainKey: "M", lanes: [{ lane: "a", contentKey: aKey }, { lane: "b", contentKey: bKey }] },
  ];
  const perLane = [
    { lane: "duel-hud", violations: [{ rel: "x" }], open: ["y"] },
    { lane: "boss-fight", violations: [], open: [] },
  ];

  const cases = [
    // Precedence, mirroring the guard.
    ["grant beats ownership", kind("module-lesson", "content/m1/module.json") === "granted"],
    ["owner is denied a file granted away", kind("boss-fight", "content/m1/module.json") === "violation"],
    ["owner keeps the rest of its tree", kind("boss-fight", "content/m1/duel-items.json") === "owned"],
    ["contested denies everyone", kind("duel-hud", "apps/web/src/duel/duel.css") === "violation"],
    ["a lane owns its own tree", kind("module-lesson", "apps/web/src/module/ModulePlayer.tsx") === "owned"],
    ["another lane is denied it", kind("duel-hud", "apps/web/src/module/ModulePlayer.tsx") === "violation"],
    ["unclaimed is open", kind("duel-hud", "apps/web/src/db.ts") === "open"],

    // The partition. This is where the noise lived, so it is tested in both
    // directions: harmless sharing must NOT fail, a real divergence MUST.
    ["every copy equals main is propagation", part(two(".cursor/x.json", "M", "M")).propagations.length === 1],
    ["every copy equals main is not a clobber", part(two(".cursor/x.json", "M", "M")).clobbers.length === 0],
    ["one lane ahead of stale copies is not a clobber", part([{ rel: ".cursor/x.json", mainKey: "M", lanes: [
      { lane: "a", contentKey: "NEW" }, { lane: "b", contentKey: "M" }, { lane: "c", contentKey: "M" },
    ] }]).clobbers.length === 0],
    ["two lanes ahead with identical content is propagation", part(two("a.ts", "NEW", "NEW")).propagations.length === 1],
    ["two lanes ahead with different content is a CLOBBER", part(two("apps/web/src/duel/duel.css", "X", "Y")).clobbers.length === 1],
    ["a real clobber is not filed as propagation", part(two("apps/web/src/duel/duel.css", "X", "Y")).propagations.length === 0],
    ["one lane edits, another deletes, is a clobber", part(two("a.ts", "X", "(absent)")).clobbers.length === 1],
    ["an uncomparable copy is a clobber, never 'agrees'", part(two("a.ts", "X", null)).clobbers.length === 1],
    ["a file absent from main, authored the same on two lanes, is propagation", part([{ rel: "n.ts", mainKey: "(absent)", lanes: [
      { lane: "a", contentKey: "S" }, { lane: "b", contentKey: "S" },
    ] }]).propagations.length === 1],
    ["one divergent copy among three ahead of main is a clobber", part([{ rel: "p", lanes: [
      { lane: "a", contentKey: "h" }, { lane: "b", contentKey: "h" }, { lane: "c", contentKey: "OTHER" },
    ], mainKey: "M" }]).clobbers.length === 1],
    ["a clobber names only the diverging lanes", part([{ rel: "p", mainKey: "M", lanes: [
      { lane: "a", contentKey: "X" }, { lane: "b", contentKey: "Y" }, { lane: "stale", contentKey: "M" },
    ] }]).clobbers[0].lanes.join(",") === "a,b"],

    // The verdict, scoped and unscoped.
    ["unscoped fails on any violation", failureDecision({ perLane }).failed === true],
    ["scoped fails on its own violation", failureDecision({ perLane, lane: "duel-hud" }).failed === true],
    ["scoped ignores another lane's", failureDecision({ perLane, lane: "boss-fight" }).failed === false],
    ["scoped fails on a clobber it is in", failureDecision({
      clobbers: [{ rel: "f", lanes: ["duel-hud", "boss-fight"] }], lane: "duel-hud",
    }).failed === true],
    ["scoped ignores a clobber it is not in", failureDecision({
      clobbers: [{ rel: "f", lanes: ["a", "b"] }], perLane: [], lane: "boss-fight",
    }).failed === false],
    ["propagation alone is green", failureDecision({ clobbers: [], perLane: [{ lane: "a", violations: [], open: ["z"] }] }).failed === false],
    ["--strict promotes OPEN", failureDecision({ perLane, strict: true, lane: "boss-fight" }).failed === false],
    ["--strict fails on this lane's OPEN", failureDecision({ perLane, strict: true, lane: "duel-hud" }).failed === true],
  ];

  let failed = 0;
  if (verbose) console.log("check-lane-integrity selftest:");
  for (const [label, ok] of cases) {
    if (!ok) failed++;
    if (verbose || !ok) console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  }
  if (verbose || failed) {
    console.log(
      failed === 0
        ? `check-lane-integrity selftest: OK (${cases.length} cases)`
        : `check-lane-integrity selftest: FAILED (${failed}/${cases.length})`,
    );
  }
  return { failed, total: cases.length };
}

if (SELFTEST) process.exit(selftest().failed === 0 ? 0 : 1);

// It self-tests before it measures, always — not only when asked. This check now
// runs inside `pnpm gate`, where a silently-wrong detector would report a clean
// audit forever and nobody would open it to notice. Costs about a millisecond.
{
  const { failed, total } = selftest(false);
  if (failed > 0) {
    fail(`the detector's own logic failed ${failed}/${total} selftest cases (above); refusing to report an audit from it`);
  }
  if (!JSON_OUT) console.log(`check-lane-integrity: selftest OK (${total} cases)`);
}

// ---------------------------------------------------------------------------
// From here down the run needs a real repository.
//
// A missing WORKTREES root is NOT a failure and never a silent pass either: on a
// CI runner or a plain clone there are no sibling lanes, so there is no
// cross-lane surface for this check to have an opinion about. It says so and
// exits 0. A missing or unparseable MAP is different — that is the enforced
// policy itself gone, and it exits 2.
// ---------------------------------------------------------------------------
if (!existsSync(MAP_PATH)) fail(`ownership map not found at ${MAP_PATH}`);

let MAP;
try {
  MAP = JSON.parse(readFileSync(MAP_PATH, "utf8"));
} catch (err) {
  fail(`could not parse ${MAP_PATH}: ${err.message}`);
}

// `--lane auto` resolves to the worktree the script is running in. Two cases
// must NOT scope, and both would otherwise fail open silently:
//   - the MAIN checkout, where `laneOfCheckout` says "main". There is no
//     worktree named `main`, so scoping to it would match no lane record and no
//     clobber side, and the run could never fail. Main is the hub and the
//     orchestrator's home; the full audit is exactly what belongs there.
//   - a checkout outside both layouts, where the lane is unknown.
const autoLane = LANE_ARG === "auto" ? laneOfCheckout(CHECKOUT) : null;
const SCOPE_LANE = LANE_ARG === "auto" ? (autoLane === "main" ? null : autoLane) : LANE_ARG;
if (LANE_ARG === "auto" && SCOPE_LANE === null) {
  console.log(
    `check-lane-integrity: --lane auto found ${autoLane === "main" ? "the MAIN checkout" : "no lane"} ` +
      `for ${CHECKOUT}; auditing every lane and failing on any crossing.`,
  );
}

if (!existsSync(WORKTREES)) {
  console.log(
    `check-lane-integrity: NOT APPLICABLE — no worktrees root at ${WORKTREES}, so this ` +
      `checkout has no sibling lanes to cross. This check reads LOCAL worktree git state; ` +
      `it can see nothing on a runner or a single clone, and says so rather than passing quietly.`,
  );
  process.exit(0);
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
    const verdict = classify(MAP, lane, rel);
    if (verdict.kind === "violation") record.violations.push({ rel, ...verdict });
    else if (verdict.kind === "granted") record.granted.push({ rel, ...verdict });
    else if (verdict.kind === "owned") record.owned.push(rel);
    else record.open.push(rel);
  }
  perLane.push(record);
}

// ---------------------------------------------------------------------------
// One file on several lanes. Whether that destroys work depends on which lanes
// are actually bringing NEW content, so read the bytes rather than assume.
//
// A lane's copy is the WORKING-TREE one, hashed with `git hash-object`: that is
// what it would carry into a merge once committed. `null` means the hash could
// not be taken, and `partitionCollisions` treats that as divergent — an
// unreadable copy must never be reported as agreeing.
// ---------------------------------------------------------------------------
function contentKey(dir, rel) {
  if (!existsSync(join(dir, rel))) return "(absent)";
  try {
    return git(dir, ["hash-object", "--", rel]).trim() || null;
  } catch {
    return null;
  }
}

/** The blob `main` currently holds for a path, or "(absent)" if it holds none. */
function mainContentKey(rel) {
  try {
    return git(HUB, ["rev-parse", "--verify", "--quiet", `main:${rel}`]).trim() || "(absent)";
  } catch {
    return "(absent)";
  }
}

const shared = [...fileToLanes.entries()]
  .filter(([, lanes]) => lanes.size > 1)
  .map(([rel, lanes]) => ({
    rel,
    mainKey: mainContentKey(rel),
    lanes: [...lanes].sort().map((lane) => ({ lane, contentKey: contentKey(join(WORKTREES, lane), rel) })),
  }));

const { clobbers, propagations } = partitionCollisions(shared);

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------
const verdict = failureDecision({ clobbers, perLane, strict: STRICT, lane: SCOPE_LANE });

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      { hub: HUB, worktrees: WORKTREES, map: MAP_PATH, scopedToLane: SCOPE_LANE, perLane, clobbers, propagations, verdict },
      null,
      2,
    ),
  );
}

const totalViolations = perLane.reduce((n, l) => n + l.violations.length, 0);
const totalOpen = perLane.reduce((n, l) => n + l.open.length, 0);
const liveLanes = perLane.filter((l) => l.fileCount > 0);

if (!JSON_OUT) {
  console.log(
    `check-lane-integrity: ${laneDirs.length} worktree lane(s), ${liveLanes.length} with changes, ` +
      `map ${MAP_PATH.replace(HUB + "/", "")}` +
      (SCOPE_LANE ? `, verdict scoped to lane '${SCOPE_LANE}'` : ""),
  );

  // 1. CLOBBER — the same file on two live lanes, holding DIFFERENT content.
  if (clobbers.length) {
    console.error(`\n  CLOBBER: ${clobbers.length} file(s) modified on more than one live lane, with DIFFERING content:`);
    for (const c of clobbers) console.error(`    error: ${c.rel}  <-  ${c.lanes.join(", ")}`);
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

  // 3. PROPAGATION — the same file on several lanes, byte-identical. Not a
  //    clobber and not a failure; printed because identical today is divergent
  //    tomorrow, and because a silent suppression is indistinguishable from a
  //    blind spot.
  if (propagations.length) {
    console.log(`\n  PROPAGATION (allowed — shared, but nothing to destroy):`);
    for (const p of propagations) console.log(`    note: ${p.rel}  <-  ${p.lanes.join(", ")}  (${p.reason})`);
    console.log("  Copying one reconciled file into every worktree looks exactly like this. It becomes");
    console.log("  a CLOBBER the moment two lanes bring DIFFERENT new content, which is when to hear it.");
  }

  // 4. OPEN — allowed, but drift worth seeing.
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

if (verdict.failed) {
  if (!JSON_OUT) {
    console.error(
      `\ncheck-lane-integrity: FAIL — ${verdict.clobbers} clobber(s), ${verdict.violations} violation(s)` +
        (SCOPE_LANE ? ` involving lane '${SCOPE_LANE}'` : ""),
    );
  }
  process.exit(1);
}
if (!JSON_OUT) {
  const unscopedProblems = clobbers.length + totalViolations;
  const scopeNote =
    SCOPE_LANE && unscopedProblems > 0
      ? ` — but ${unscopedProblems} finding(s) on OTHER lanes are printed above and are the orchestrator's to sequence`
      : "";
  console.log(
    `\ncheck-lane-integrity: OK (no clobber, no cross-lane violation${SCOPE_LANE ? ` for '${SCOPE_LANE}'` : ""})${scopeNote}`,
  );
}
process.exit(0);
