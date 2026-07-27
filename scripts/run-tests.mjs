// Run every workspace package's tests and say what happened to all of them.
//
// WHY THIS EXISTS. `pnpm -r test` stops at the first package that fails, so a red
// run reports on one package and stays silent about the other thirteen. With
// several agents editing at once that makes "the tree is green" unverifiable in
// the direction that matters: you cannot tell a green tree from a run that
// stopped early. `pnpm -r --no-bail test` fixes the stopping, and that flag is
// doing the real work here - it is also what `typecheck` already uses.
//
// What --no-bail does not give is a roll-up on success: pnpm prints its
// `Summary: N fails, M passes` only when something failed, so a green run leaves
// you scrolling ~2500 interleaved lines to confirm every package actually ran.
// This adds that roll-up, and adds the check pnpm cannot make - comparing what
// ran against the set of packages that DECLARE a test script. A package whose
// tests silently stopped being executed is the failure mode that a pass/fail
// count cannot see, and it looks exactly like good news.
//
// Nothing here is serialised. pnpm's own parallel scheduling is untouched, the
// pipeline tests run alongside it, and child output is streamed as it arrives.
// A clean child exit is tightened to failure if either test set never ran or
// failed to print a test summary.
//
// Run:
//   pnpm test                      # via the root script
//   node scripts/run-tests.mjs     # same thing
//   node scripts/run-tests.mjs --selftest
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The asset pipeline is scripts, not a workspace package: it has no package.json,
 * so `pnpm -r test` cannot reach it, and its unit tests were run only when
 * somebody remembered to. That is how the placement instruments accumulated four
 * defects that each reported a confident wrong number instead of failing (see
 * assets/pipeline/placement_lib.test.mjs). CI runs them as a separate step; this
 * runs them here too, under `node --test`, so a local `pnpm test` is not quieter
 * than CI. Discovered rather than hard-coded, so a new `*.test.mjs` is picked up
 * without editing this list — the same failure mode this whole file exists to
 * catch would otherwise apply to the pipeline tests themselves.
 */
const ASSET_PIPELINE_DIR = join(ROOT, "assets", "pipeline");
const ASSET_PIPELINE_LABEL = "assets/pipeline";

function assetPipelineTestFiles(dir = ASSET_PIPELINE_DIR) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => join(dir, name));
}

/** Which workspace packages declare a test script? That is the set that must run. */
function expectedPackages(root = ROOT) {
  const found = [];
  for (const group of ["packages", "apps"]) {
    let entries;
    try {
      entries = readdirSync(join(root, group));
    } catch {
      continue;
    }
    for (const entry of entries) {
      let manifest;
      try {
        manifest = JSON.parse(readFileSync(join(root, group, entry, "package.json"), "utf8"));
      } catch {
        continue;
      }
      if (manifest.scripts?.test) found.push(`${group}/${entry}`);
    }
  }
  return found.sort();
}

/**
 * Read pnpm's append-only output into a per-package result.
 *
 * --reporter=append-only is requested explicitly so this format holds in a
 * terminal as well as in CI; pnpm's default interactive reporter redraws lines
 * and would leave this parsing a moving target.
 */
export function summarise(output, expected) {
  const packages = new Map();
  const of = (name) => {
    if (!packages.has(name)) packages.set(name, { name, tests: null, pass: null, fail: null, saw: false });
    return packages.get(name);
  };

  for (const line of output.split("\n")) {
    const prefixed = /^((?:packages|apps)\/[A-Za-z0-9_.-]+) test(?::| \|)\s?(.*)$/.exec(line);
    if (!prefixed) continue;
    const entry = of(prefixed[1]);
    entry.saw = true;
    const counted = /^[^A-Za-z0-9]*\s*(tests|pass|fail)\s+(\d+)\s*$/.exec(prefixed[2]);
    if (counted) entry[counted[1]] = Number(counted[2]);
  }

  const failures = [...output.matchAll(/^Summary: (\d+) fails?, (\d+) passe?s?$/gm)];
  const missing = expected.filter((name) => !packages.get(name)?.saw);
  const rows = expected
    .map((name) => packages.get(name) ?? { name, tests: null, pass: null, fail: null, saw: false })
    .concat([...packages.values()].filter((entry) => !expected.includes(entry.name)));
  return { rows, missing, pnpmSummary: failures.at(-1)?.[0] ?? null };
}

/** Pull node --test's summary counts out of its `ℹ tests N` diagnostic block. */
export function parseNodeTest(output) {
  const grab = (name) => {
    const match = new RegExp(String.raw`^\S*\s*${name}\s+(\d+)\s*$`, "m").exec(output);
    return match ? Number(match[1]) : null;
  };
  return { tests: grab("tests"), pass: grab("pass"), fail: grab("fail") };
}

/**
 * The exit code a run deserves, and the point of this file: a green pnpm run is
 * NOT sufficient. pnpm exits 0 for a package that silently stopped running, and
 * for a file that crashed before node --test printed a count — both of which look
 * exactly like good news to an exit code alone. So a clean pnpm/asset exit is
 * overridden to nonzero when any package declared a test script but produced no
 * output, never ran, or ran without reporting counts.
 */
export function effectiveExit(summary, pnpmCode, assetCode = 0) {
  if (pnpmCode !== 0) return pnpmCode;
  if (assetCode !== 0) return assetCode || 1;
  const suspect = summary.rows.some((row) => !row.saw || row.tests === null);
  if (summary.missing.length > 0 || suspect) return 1;
  return 0;
}

function report(output, expected, pnpmCode, extraRows = [], assetCode = 0) {
  const summary = summarise(output, expected);
  const rows = [...summary.rows, ...extraRows];
  const { missing } = summary;
  const width = Math.max(...rows.map((row) => row.name.length), 12);
  console.log(`\n${"=".repeat(width + 34)}\ntest summary (${rows.length} test set(s))`);
  let totalTests = 0;
  let totalFail = 0;
  const suspect = [];
  for (const row of rows) {
    if (!row.saw) {
      suspect.push(`${row.name}: never ran`);
      console.log(`  ${row.name.padEnd(width)}  DID NOT RUN`);
      continue;
    }
    if (row.tests === null) {
      // Produced output but no counts: a file that threw while loading never
      // reaches node --test's summary, which is what an unresolved identifier
      // mid-refactor looks like.
      suspect.push(`${row.name}: ran but reported no test counts`);
      console.log(`  ${row.name.padEnd(width)}  no test summary (did it crash before running?)`);
      continue;
    }
    totalTests += row.tests;
    totalFail += row.fail ?? 0;
    const verdict = (row.fail ?? 0) > 0 ? `FAIL ${row.fail}` : "ok";
    console.log(
      `  ${row.name.padEnd(width)}  ${String(row.tests).padStart(5)} tests  ` +
        `${String(row.pass ?? 0).padStart(5)} pass  ${verdict}`,
    );
  }
  console.log(
    `  ${"".padEnd(width)}  ${String(totalTests).padStart(5)} tests total, ${totalFail} failing`,
  );
  for (const note of suspect) console.log(`  ! ${note}`);
  if (missing.length > 0) {
    console.log(
      `\n  ${missing.length} package(s) declare a test script but produced no output: ${missing.join(", ")}`,
    );
  }
  const exit = effectiveExit({ rows, missing }, pnpmCode, assetCode);
  console.log(
    exit === 0
      ? "tests: OK (every package with a test script ran and passed, plus the asset pipeline)"
      : pnpmCode !== 0
        ? `tests: FAIL (pnpm exited ${pnpmCode}; see the per-package lines above)`
        : assetCode !== 0
          ? `tests: FAIL (asset pipeline tests exited ${assetCode})`
          : "tests: FAIL (a test set never ran or reported no counts; see the ! lines above)",
  );
  return exit;
}

// ---------------------------------------------------------------- self-test
// The roll-up has to be right about a RED run, and a red run is the one case that
// cannot be produced on demand without breaking a package on purpose. So the
// parser is exercised against recorded pnpm output instead.
function selfTest() {
  const expected = ["apps/api", "packages/beat", "packages/curriculum", "packages/netcode"];
  const recorded = [
    "Scope: 16 of 17 workspace projects",
    "packages/netcode test: ℹ tests 57",
    "packages/netcode test: ℹ pass 57",
    "packages/netcode test: ℹ fail 0",
    "apps/api test: ℹ tests 92",
    "apps/api test: ℹ pass 92",
    "apps/api test: ℹ fail 0",
    // Failed a test outright.
    "packages/beat test: ℹ tests 98",
    "packages/beat test: ℹ pass 97",
    "packages/beat test: ℹ fail 1",
    // Threw while loading, so node --test never printed a count.
    "packages/curriculum test: ReferenceError: MISSION_M3 is not defined",
    "[ERR_PNPM_RECURSIVE_FAIL] ",
    "Summary: 2 fails, 14 passes",
  ].join("\n");

  const { rows, missing, pnpmSummary } = summarise(recorded, expected);
  const byName = new Map(rows.map((row) => [row.name, row]));
  const cases = [
    ["every declared package appears", rows.length === 4],
    ["a passing package keeps its counts", byName.get("packages/netcode").pass === 57],
    ["a failing test is counted", byName.get("packages/beat").fail === 1],
    [
      "a package that crashed before running reports no counts",
      byName.get("packages/curriculum").saw === true && byName.get("packages/curriculum").tests === null,
    ],
    ["pnpm's own failure summary is found", pnpmSummary === "Summary: 2 fails, 14 passes"],
    ["nothing is wrongly reported missing", missing.length === 0],
  ];

  // A package that vanishes from the run must be reported, because that is the
  // failure a pass/fail count cannot see.
  const dropped = summarise(recorded, [...expected, "packages/ghost"]);
  cases.push(["a package that never ran is caught", dropped.missing.join() === "packages/ghost"]);

  // node --test's summary block parses to the same shape as a pnpm package row.
  const asset = parseNodeTest("ℹ tests 59\nℹ pass 59\nℹ fail 0\n");
  cases.push(["node --test counts parse", asset.tests === 59 && asset.pass === 59 && asset.fail === 0]);
  cases.push([
    "a crashed node --test run parses to no counts",
    parseNodeTest("ReferenceError: boom\n").tests === null,
  ]);

  // THE EXIT-CODE CONTRACT, which is the change that matters: a clean pnpm code
  // is not enough. Each of these would have exited 0 before and now must not.
  const cleanRecorded = [
    "packages/netcode test: ℹ tests 57",
    "packages/netcode test: ℹ pass 57",
    "packages/netcode test: ℹ fail 0",
    "apps/api test: ℹ tests 92",
    "apps/api test: ℹ pass 92",
    "apps/api test: ℹ fail 0",
  ].join("\n");
  const clean = summarise(cleanRecorded, ["packages/netcode", "apps/api"]);
  cases.push(["a fully-accounted clean run exits 0", effectiveExit(clean, 0, 0) === 0]);
  const withMissing = summarise(recorded, ["packages/netcode", "packages/ghost"]);
  cases.push([
    "a vanished package forces nonzero even when pnpm exited 0",
    effectiveExit(withMissing, 0, 0) === 1,
  ]);
  const withNoCounts = summarise(recorded, ["packages/curriculum"]);
  cases.push([
    "a package with no counts forces nonzero even when pnpm exited 0",
    effectiveExit(withNoCounts, 0, 0) === 1,
  ]);
  cases.push([
    "a failing asset pipeline run forces nonzero",
    effectiveExit(clean, 0, 1) === 1,
  ]);
  const assetWithoutSummary = {
    ...clean,
    rows: [
      ...clean.rows,
      {
        name: ASSET_PIPELINE_LABEL,
        tests: null,
        pass: null,
        fail: null,
        saw: true,
      },
    ],
  };
  cases.push([
    "an asset run with no test summary forces nonzero",
    effectiveExit(assetWithoutSummary, 0, 0) === 1,
  ]);
  cases.push([
    "asset pipeline test files are discovered",
    assetPipelineTestFiles().length >= 2,
  ]);
  cases.push(["pnpm's own nonzero code is preserved", effectiveExit(clean, 3, 0) === 3]);

  let failed = 0;
  console.log("run-tests selftest: does the roll-up describe a red run correctly?");
  for (const [label, ok] of cases) {
    if (!ok) failed++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  }
  console.log(failed === 0 ? "run-tests selftest: OK" : `run-tests selftest: FAIL (${failed})`);
  return failed;
}

// ---------------------------------------------------------------- CLI
const argv = process.argv.slice(2);
if (argv.includes("--selftest")) {
  process.exit(selfTest() === 0 ? 0 : 1);
}

function runChild(command, args, label) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: ["inherit", "pipe", "pipe"],
    });
    let captured = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolveRun({ ...result, output: captured });
    };

    for (const [stream, sink] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr],
    ]) {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        captured += chunk;
        sink.write(chunk); // streamed through, so nothing is buffered up or hidden
      });
    }

    child.once("error", (error) => {
      console.error(`tests: could not start ${label}: ${error.message}`);
      finish({ code: 1, started: false });
    });
    child.once("close", (code, signal) => {
      finish({ code: code ?? (signal ? 1 : 0), started: true });
    });
  });
}

async function main() {
  const expected = expectedPackages();
  const pipelineFiles = assetPipelineTestFiles();
  if (pipelineFiles.length === 0) {
    console.error(`tests: no ${ASSET_PIPELINE_LABEL}/*.test.mjs files were discovered`);
  }

  const pnpmRun = runChild(
    "pnpm",
    ["-r", "--no-bail", "--reporter=append-only", "test", ...argv],
    "pnpm",
  );
  const pipelineRun =
    pipelineFiles.length === 0
      ? Promise.resolve({ code: 1, started: false, output: "" })
      : runChild(
          process.execPath,
          ["--test", ...pipelineFiles],
          `${ASSET_PIPELINE_LABEL} tests`,
        );

  const [pnpmResult, pipelineResult] = await Promise.all([pnpmRun, pipelineRun]);
  const pipelineCounts = parseNodeTest(pipelineResult.output);
  const pipelineRow = {
    name: ASSET_PIPELINE_LABEL,
    ...pipelineCounts,
    saw: pipelineResult.started,
  };
  process.exitCode = report(
    pnpmResult.output,
    expected,
    pnpmResult.code,
    [pipelineRow],
    pipelineResult.code,
  );
}

await main();
