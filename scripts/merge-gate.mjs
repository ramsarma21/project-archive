// merge-gate — run the WHOLE gate and refuse the merge if any part of it fails.
//
// WHY THIS EXISTS. `M1-DONE.md` §8 carried one unmet regression condition for
// days: "the full gate is run before every merge, not at the orchestrator's
// discretion." That was an honest description of the process — lanes were merged
// on worker reports, and once a ladder facade was merged on captures that did not
// show what they claimed. This is the tool that removes the discretion: it runs
// every blocking gate the repo has and exits non-zero the moment one fails, so a
// merge can be made conditional on it rather than on a judgement call.
//
// WHERE THE ENFORCEMENT CAN HONESTLY LIVE — read this before trusting it.
//   A git hook is the obvious idea and it is the wrong one here. `git merge`
//   fast-forwards (which the orchestrator's lane merges routinely are) run NO
//   hook at all; `pre-merge-commit` fires only for a true merge commit and is
//   skipped by `--no-verify`; and hooks do not travel through a clone. So a hook
//   cannot reliably intercept THIS process's merges, and one that fires on some
//   merges but not others is worse than none because it feels like protection.
//   The honest answer: local enforcement can only ever be *a convention plus a
//   loud, single tool*. This is that tool. It is loud (it prints MERGE REFUSED and
//   exits non-zero), it is single (one command, `pnpm gate` or `node
//   scripts/merge-gate.mjs`, that runs everything), and it is the thing the
//   process now requires before a merge. The ONLY place discretion is truly
//   removed is CI as a REQUIRED status check once `main` is pushed and branch
//   protection is on — the `verify`, `api-postgres` and `playthrough` jobs already
//   run this same set. `--install-hooks` adds a best-effort `pre-push` hook as
//   belt-and-suspenders, honestly labelled as bypassable.
//
// WHAT IT COVERS (every blocking gate; see docs/process/LANES.md "Verification"):
//   lint, typecheck, test, build, verify:content, verify:units, and the three
//   assets:verify:* with the affordance debt list "held or shrunk, never grown";
//   plus check-playthrough WHERE THE CHANGE COULD AFFECT PLAY; plus
//   check-lane-integrity, which is coordination rather than correctness and is
//   here because a merge is exactly when a crossed lane stops being recoverable.
//
// USABILITY — a gate that is too slow gets skipped, which returns us to
// discretion. Two things keep it usable:
//   1. The static gates run in PARALLEL. Sequentially they are ~260 s on this
//      machine (test ~195 s dominates); in parallel the wall clock is ~ the test
//      time. Each gate's output is buffered and only replayed in full if it fails,
//      so the console stays legible.
//   2. The playthrough (~115 s of check + a stack to run it against) is run only
//      when the change COULD affect play. An asset-only / docs-only / CI-only /
//      test-only change cannot alter what check-playthrough asserts — its route,
//      refusal and beat verdicts read authored hulls and nodes (unchanged by an
//      asset swap), and its wide render-census bands are enforced more precisely
//      by assets:verify:* + the lint texture/scale checks. So those changes skip
//      it, JUSTIFIABLY, with the reason printed. Anything touching source, content
//      or config runs it.
//
// pnpm's DEPENDENCY CHECK, the first thing that breaks in practice. On pnpm 11
// the `verify-deps-before-run` setting in `.npmrc` is inert (pnpm 11 reads
// `verifyDepsBeforeRun` from pnpm-workspace.yaml, which is unset), so a `pnpm -r`
// script on a DRIFTED tree tries to repair node_modules mid-run and can prompt to
// purge it — non-interactively that is a hang or a failure. This tool defends
// against that up front: it runs `pnpm install --frozen-lockfile` as a preflight.
// A frozen install NEVER purges — it either confirms the tree matches the lockfile
// (so no `pnpm -r` step will try to repair) or it fails read-only. If it fails, the
// tool STOPS and tells the operator exactly how to reconcile the lockfile, rather
// than letting a mid-run purge happen. (Reconciling pnpm-lock.yaml is a contested
// file — the operator does it deliberately, this tool never does.)
//
// USAGE
//   node scripts/merge-gate.mjs                 # gate the current branch vs main
//   node scripts/merge-gate.mjs --base <ref>    # diff against <ref> to scope play
//   node scripts/merge-gate.mjs --all           # force the playthrough regardless
//   node scripts/merge-gate.mjs --no-playthrough# skip the playthrough (prints why)
//   node scripts/merge-gate.mjs --playthrough-base http://127.0.0.1:5273
//                                               # use a stack you already have up
//   node scripts/merge-gate.mjs --static        # static gates only (no play)
//   node scripts/merge-gate.mjs --install-hooks # install the pre-push safety hook
//   node scripts/merge-gate.mjs --selftest      # exercise the pure logic, no gates
//
// Exit codes: 0 all run gates passed (or the playthrough was justifiably skipped);
// 1 a gate failed (MERGE REFUSED); 2 a preflight could not be satisfied.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import net from "node:net";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// --------------------------------------------------------------------------
// Play-relevance: can a changed file alter the check-playthrough verdict?
//
// A path is play-IRRELEVANT (cannot change the verdict) when it is one of:
//   - docs, CI config, gate/verify scripts (not shipped into the running game);
//   - the asset pipeline and the published assets it emits (covered precisely by
//     assets:verify:* and the lint texture/scale checks, which read the GLB itself
//     against the authored hull — the playthrough only adds a wide census band);
//   - a test file anywhere (covered by `test`, never shipped).
// EVERYTHING ELSE is play-relevant: app/package source, content (encounters,
// duel cards, beats), api source, and dependency/config files that change runtime.
// The default is therefore "run the playthrough"; skipping is the exception and it
// carries its reason.
// --------------------------------------------------------------------------
const PLAY_IRRELEVANT = [
  /^docs\//,
  /^\.github\//,
  /^\.cursor\//, // agent config: hooks, rules, skills, the lane map. Never bundled.
  /^scripts\//,
  /^assets\/pipeline\//,
  /^apps\/web\/public\//,
  /^README\.md$/,
  /(^|\/)[^/]*\.md$/,
  /^\.gitignore$/,
  /^\.npmrc$/,
  /^\.dockerignore$/,
];
const TEST_FILE = [/\.test\.[cm]?[jt]sx?$/, /(^|\/)test\//, /(^|\/)__tests__\//];

export function isPlayIrrelevant(path) {
  if (TEST_FILE.some((re) => re.test(path))) return true;
  return PLAY_IRRELEVANT.some((re) => re.test(path));
}

/** Given the changed paths, decide whether the playthrough must run and why. */
export function playthroughDecision(changedFiles) {
  if (changedFiles === null) {
    return { run: true, reason: "could not determine the changed files; running it to be safe" };
  }
  if (changedFiles.length === 0) {
    return { run: true, reason: "no changed files detected against the base; running it to be safe" };
  }
  const relevant = changedFiles.filter((f) => !isPlayIrrelevant(f));
  if (relevant.length === 0) {
    return {
      run: false,
      reason:
        `all ${changedFiles.length} changed file(s) are play-irrelevant (docs / CI / scripts / ` +
        `asset pipeline / published assets / tests) — none can alter the route, refusal, beat ` +
        `or duel verdicts, and asset integrity is covered by assets:verify:* + lint`,
    };
  }
  return {
    run: true,
    reason: `${relevant.length} changed file(s) could affect play: ${relevant.slice(0, 8).join(", ")}${relevant.length > 8 ? ` (+${relevant.length - 8} more)` : ""}`,
  };
}

// --------------------------------------------------------------------------
// Arg parsing (exported for the selftest).
// --------------------------------------------------------------------------
export function parseArgs(argv) {
  const opts = {
    base: null,
    all: false,
    noPlaythrough: false,
    static: false,
    playthroughOnly: false,
    playthroughBase: null,
    installHooks: false,
    selftest: false,
    help: false,
    concurrency: Number(process.env.MERGE_GATE_CONCURRENCY) || 4,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") opts.base = argv[++i];
    else if (a === "--all") opts.all = true;
    else if (a === "--no-playthrough") opts.noPlaythrough = true;
    else if (a === "--static") opts.static = true;
    else if (a === "--playthrough-only") opts.playthroughOnly = true;
    else if (a === "--playthrough-base") opts.playthroughBase = argv[++i];
    else if (a === "--install-hooks") opts.installHooks = true;
    else if (a === "--selftest") opts.selftest = true;
    else if (a === "--concurrency") opts.concurrency = Number(argv[++i]);
    else if (a === "--help" || a === "-h") opts.help = true;
  }
  return opts;
}

// --------------------------------------------------------------------------
// Small utilities.
// --------------------------------------------------------------------------
const C = { reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", dim: "\x1b[2m", bold: "\x1b[1m" };
const log = (...a) => console.log(...a);
const fmtS = (ms) => `${(ms / 1000).toFixed(0)}s`;

function git(args) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return { code: r.status ?? 1, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}

/** Pick a base ref to diff against: the requested one, else `main`, else HEAD~1. */
function resolveBase(requested) {
  const tryRef = (ref) => (git(["rev-parse", "--verify", "--quiet", ref]).code === 0 ? ref : null);
  if (requested) {
    const r = tryRef(requested);
    if (!r) return { ref: null, error: `base ref '${requested}' does not resolve` };
    return { ref: r };
  }
  return { ref: tryRef("main") ?? tryRef("HEAD~1") ?? null };
}

/** Files changed between the base's merge-point and HEAD, plus anything dirty. */
function changedFiles(baseRef) {
  if (!baseRef) return null;
  const committed = git(["diff", "--name-only", `${baseRef}...HEAD`]);
  const dirty = git(["status", "--porcelain=v1"]);
  if (committed.code !== 0) return null;
  const set = new Set(committed.out.split("\n").filter(Boolean));
  for (const line of dirty.out.split("\n").filter(Boolean)) {
    // "XY path" (rename lines have " -> "); take the final path token.
    const path = line.slice(3).split(" -> ").pop();
    if (path) set.add(path);
  }
  return [...set];
}

function portOpen(port, host = "127.0.0.1") {
  return new Promise((res) => {
    const s = net.connect({ port, host });
    const done = (ok) => { s.destroy(); res(ok); };
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
    setTimeout(() => done(false), 800);
  });
}

async function httpOk(url, timeoutMs = 2500) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return r.status > 0 && r.status < 500;
  } catch {
    return false;
  }
}

// --------------------------------------------------------------------------
// Running a gate step: buffer output, replay only on failure.
// --------------------------------------------------------------------------
function runStep(step) {
  return new Promise((res) => {
    const start = Date.now();
    const child = spawn(step.cmd, step.args, { cwd: ROOT, env: { ...process.env, ...(step.env ?? {}) } });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (out += c));
    child.once("error", (e) => res({ ...step, code: 1, ms: Date.now() - start, out: `${out}\nfailed to start: ${e.message}` }));
    child.once("close", (code) => res({ ...step, code: code ?? 1, ms: Date.now() - start, out }));
  });
}

/** Run steps with a concurrency cap; print a line as each finishes. */
async function runPool(steps, concurrency) {
  const results = [];
  let i = 0;
  const worker = async () => {
    while (i < steps.length) {
      const step = steps[i++];
      log(`${C.dim}▶ start ${step.name}${C.reset}`);
      const r = await runStep(step);
      results.push(r);
      const ok = r.code === 0;
      log(`${ok ? C.green + "✔" : C.red + "✗"} ${step.name}${C.reset}  ${C.dim}${fmtS(r.ms)}${C.reset}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return results;
}

const STATIC_STEPS = [
  { name: "test", cmd: "pnpm", args: ["test"] }, // longest first
  { name: "typecheck", cmd: "pnpm", args: ["typecheck"] },
  { name: "build", cmd: "pnpm", args: ["build"] },
  { name: "assets:verify:affordances", cmd: "pnpm", args: ["assets:verify:affordances"] },
  { name: "assets:verify:collision", cmd: "pnpm", args: ["assets:verify:collision"] },
  { name: "assets:verify:placement", cmd: "pnpm", args: ["assets:verify:placement"] },
  { name: "verify:content", cmd: "pnpm", args: ["verify:content"] },
  { name: "verify:units", cmd: "pnpm", args: ["verify:units"] },
  { name: "lint", cmd: "pnpm", args: ["lint"] },
  // COORDINATION, not correctness — and it belongs here anyway, because here is
  // the moment it protects. `check-lane-integrity` catches a crossed lane from
  // git state after the fact, which is the ONLY enforcement available: the
  // preToolUse guard does not fire for background subagents and cannot see an
  // edit made through `Shell` at all (M1-STATUS.md, "Guard coverage"). Left to be
  // remembered, a post-hoc detector protects nothing; the merge is the deadline.
  //
  // `--lane auto` scopes the FAILURE to the lane being gated. It still prints
  // every finding, but a red caused by a different lane is not something the
  // person merging can fix, and an unfixable red is how a gate gets muted. Run it
  // bare (`pnpm verify:lanes`) for the orchestrator's audit, which fails on any.
  { name: "lane-integrity", cmd: process.execPath, args: ["scripts/check-lane-integrity.mjs", "--lane", "auto"] },
];

// --------------------------------------------------------------------------
// Dependency preflight — see the header. Frozen install never purges.
// --------------------------------------------------------------------------
function dependencyPreflight() {
  log(`${C.cyan}» preflight: pnpm install --frozen-lockfile${C.reset}`);
  const r = spawnSync("pnpm", ["install", "--frozen-lockfile"], { cwd: ROOT, encoding: "utf8" });
  if ((r.status ?? 1) === 0) {
    log(`${C.green}✔ dependencies match the lockfile${C.reset}`);
    return true;
  }
  const detail = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-12).join("\n");
  log(`${C.red}✗ frozen install failed — the lockfile and package.json have drifted.${C.reset}`);
  log(detail);
  log(
    `\n${C.yellow}The lockfile drift must be reconciled before the gate can run.${C.reset}\n` +
      `  pnpm-lock.yaml is a CONTESTED file — this tool will not touch it. Do it deliberately:\n` +
      `    1. pnpm install --no-frozen-lockfile     # updates node_modules AND pnpm-lock.yaml\n` +
      `    2. review the pnpm-lock.yaml diff, then commit it on the lane that owns the change\n` +
      `    3. re-run the gate\n` +
      `  Why the tool refuses to auto-fix: on pnpm 11 a drifted tree makes 'pnpm -r <script>'\n` +
      `  try to repair node_modules mid-run and it can PURGE it; reconciling the lockfile once,\n` +
      `  up front and reviewed, is the safe fix rather than a silent purge inside a gate step.`,
  );
  return false;
}

// --------------------------------------------------------------------------
// Ephemeral playthrough stack (mirrors the CI `playthrough` job). Isolated on
// its own ports and its OWN throwaway Postgres container so it never touches the
// owner's dev database on 55432.
// --------------------------------------------------------------------------
const STACK = {
  webPort: 5399,
  apiPort: 3099,
  pgPort: 55433,
  pgName: "pa-merge-gate-pg",
};

function stackEnv() {
  const webOrigin = `http://127.0.0.1:${STACK.webPort}`;
  return {
    API_PORT: String(STACK.apiPort),
    API_HOST: "127.0.0.1",
    WEB_ORIGIN: webOrigin,
    VITE_API_PROXY_TARGET: `http://127.0.0.1:${STACK.apiPort}`,
    DATABASE_URL: `postgres://project_archive:project_archive@localhost:${STACK.pgPort}/project_archive`,
    COOKIE_SECURE: "false",
    GRADING_RECEIPT_SECRET: "merge-gate-throwaway-secret",
  };
}

function haveDocker() {
  return spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" }).status === 0;
}

async function startPostgres() {
  // Reclaim a leftover of OUR OWN container from an aborted run, then confirm the
  // port is genuinely free before binding it (docker would fail cryptically if a
  // foreign service holds it).
  spawnSync("docker", ["rm", "-f", STACK.pgName], { stdio: "ignore" });
  if (await portOpen(STACK.pgPort)) {
    throw new Error(`port ${STACK.pgPort} is held by another process (not our container); free it or pass --playthrough-base against your own stack`);
  }
  const run = spawnSync("docker", [
    "run", "-d", "--rm", "--name", STACK.pgName,
    "-e", "POSTGRES_USER=project_archive",
    "-e", "POSTGRES_PASSWORD=project_archive",
    "-e", "POSTGRES_DB=project_archive",
    "-p", `${STACK.pgPort}:5432`,
    "postgres:17-alpine",
  ], { encoding: "utf8" });
  if ((run.status ?? 1) !== 0) throw new Error(`could not start postgres: ${run.stderr}`);
  for (let i = 0; i < 60; i++) {
    const r = spawnSync("docker", ["exec", STACK.pgName, "pg_isready", "-U", "project_archive", "-d", "project_archive"], { stdio: "ignore" });
    if ((r.status ?? 1) === 0) return;
    await delay(1000);
  }
  throw new Error("postgres never became ready");
}
function stopPostgres() {
  spawnSync("docker", ["rm", "-f", STACK.pgName], { stdio: "ignore" });
}

// Spawn a long-lived server in its own process group (detached) so the whole
// tree — including any pnpm-spawned child — can be killed on teardown.
function spawnServerIn(cwd, name, cmd, args, env, logFile) {
  mkdirSync(dirname(logFile), { recursive: true });
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  const sink = (c) => { out += c; try { writeFileSync(logFile, out); } catch {} };
  child.stdout.on("data", sink);
  child.stderr.on("data", sink);
  return { name, child, getOut: () => out };
}
function killServer(server) {
  if (!server?.child?.pid) return;
  try { process.kill(-server.child.pid, "SIGKILL"); } catch {}
  try { server.child.kill("SIGKILL"); } catch {}
}

async function waitFor(label, check, tries, everyMs, onFail) {
  for (let i = 0; i < tries; i++) {
    if (await check()) return true;
    await delay(everyMs);
  }
  if (onFail) onFail();
  throw new Error(`${label} never became ready`);
}

/**
 * Bring up postgres + API + web on isolated ports, run check-playthrough, tear
 * everything down. Returns the check's exit code. Throws only if the stack itself
 * could not be provisioned (which is a preflight failure, not a gate failure).
 */
async function runPlaythroughWithStack() {
  const env = stackEnv();
  const base = `http://127.0.0.1:${STACK.webPort}`;
  const outDir = join(ROOT, ".affordwork", "merge-gate");
  mkdirSync(outDir, { recursive: true });
  let api = null, web = null;
  // Always attempt to remove the container on teardown — `docker rm -f` is a no-op
  // when it is already gone, so this is safe whether or not startPostgres finished.
  const cleanup = () => { killServer(web); killServer(api); stopPostgres(); };
  process.on("SIGINT", () => { cleanup(); process.exit(130); });
  try {
    log(`${C.cyan}» playthrough: starting throwaway postgres (container ${STACK.pgName}, port ${STACK.pgPort})${C.reset}`);
    await startPostgres();

    log(`${C.cyan}» playthrough: applying migrations${C.reset}`);
    const mig = spawnSync("pnpm", ["--filter", "@pa/api", "migrate"], { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8" });
    if ((mig.status ?? 1) !== 0) throw new Error(`migrations failed:\n${mig.stdout}\n${mig.stderr}`);

    log(`${C.cyan}» playthrough: starting API (port ${STACK.apiPort}) and web (port ${STACK.webPort})${C.reset}`);
    api = spawnServerIn(join(ROOT, "apps/api"), "api", process.execPath, ["--import", "tsx", "src/server.ts"], env, join(outDir, "api.log"));
    await waitFor(
      "API",
      () => httpOk(`http://127.0.0.1:${STACK.apiPort}/v1/health`),
      60, 1000,
      () => log(`${C.red}API log tail:${C.reset}\n${api.getOut().split("\n").slice(-20).join("\n")}`),
    );

    web = spawnServerIn(ROOT, "web", "pnpm", ["--filter", "@pa/web", "exec", "vite", "--port", String(STACK.webPort), "--strictPort", "--host", "127.0.0.1"], env, join(outDir, "web.log"));
    await waitFor(
      "web dev server",
      () => httpOk(`${base}/`),
      60, 1000,
      () => log(`${C.red}web log tail:${C.reset}\n${web.getOut().split("\n").slice(-20).join("\n")}`),
    );

    log(`${C.cyan}» playthrough: running scripts/check-playthrough.mjs against ${base}${C.reset}`);
    const check = await runStep({ name: "check-playthrough", cmd: process.execPath, args: ["scripts/check-playthrough.mjs", base] });
    process.stdout.write(check.out);
    return check.code;
  } finally {
    cleanup();
  }
}

// --------------------------------------------------------------------------
// The pre-push hook installer (best-effort, honestly bypassable).
// --------------------------------------------------------------------------
function installHooks() {
  const hooksDir = git(["rev-parse", "--git-path", "hooks"]).out;
  const dir = resolve(ROOT, hooksDir);
  mkdirSync(dir, { recursive: true });
  const hookPath = join(dir, "pre-push");
  const body = `#!/bin/sh
# Installed by scripts/merge-gate.mjs --install-hooks.
# Best-effort only: a pre-push hook is bypassable with 'git push --no-verify' and
# does not travel through a clone. It is belt-and-suspenders, not the enforcement.
# The real, non-discretionary enforcement is CI as a required status check.
echo "pre-push: running the full merge gate (bypass with --no-verify) ..."
exec node scripts/merge-gate.mjs "$@"
`;
  writeFileSync(hookPath, body);
  chmodSync(hookPath, 0o755);
  log(`${C.green}installed pre-push hook at ${hookPath}${C.reset}`);
  log(`${C.yellow}note:${C.reset} bypassable with 'git push --no-verify'; not shared through a clone. Convention + this tool + CI required checks are the real gate.`);
}

// --------------------------------------------------------------------------
// Selftest: exercise the pure decision logic without running any gate.
// --------------------------------------------------------------------------
function selftest() {
  const cases = [
    ["docs only skips", playthroughDecision(["docs/process/M1-STATUS.md", "README.md"]).run === false],
    ["ci only skips", playthroughDecision([".github/workflows/ci.yml"]).run === false],
    ["scripts only skips", playthroughDecision(["scripts/merge-gate.mjs"]).run === false],
    // Agent configuration is not shipped into the game by any path — no bundle
    // imports it and no server reads it — so a lane-map or hook change cannot
    // alter a route, refusal, beat or duel verdict. It was costing a full
    // ~3-minute playthrough on every coordination-only change.
    ["cursor config only skips", playthroughDecision([".cursor/lane-ownership.json", ".cursor/hooks/lane-guard.sh"]).run === false],
    ["but package.json still runs", playthroughDecision([".cursor/lane-ownership.json", "package.json"]).run === true],
    ["asset pipeline only skips", playthroughDecision(["assets/pipeline/build_x.py", "apps/web/public/world/props/x.glb"]).run === false],
    ["test-only skips", playthroughDecision(["packages/duel/src/__tests__/x.test.ts", "apps/api/test/y.test.ts"]).run === false],
    ["app source runs", playthroughDecision(["apps/web/src/mission/floor.ts"]).run === true],
    ["engine source runs", playthroughDecision(["packages/engine-world/src/collision.ts"]).run === true],
    ["content runs", playthroughDecision(["content/m1/encounters.ts"]).run === true],
    ["api source runs", playthroughDecision(["apps/api/src/server.ts"]).run === true],
    ["mixed relevant+irrelevant runs", playthroughDecision(["docs/x.md", "packages/mission-m1/src/runtime.ts"]).run === true],
    ["lockfile change runs", playthroughDecision(["pnpm-lock.yaml"]).run === true],
    ["empty runs (safe)", playthroughDecision([]).run === true],
    ["null runs (safe)", playthroughDecision(null).run === true],
    ["isPlayIrrelevant: nested md", isPlayIrrelevant("packages/x/NOTES.md") === true],
    ["isPlayIrrelevant: src ts", isPlayIrrelevant("packages/x/src/a.ts") === false],
    ["isPlayIrrelevant: nested test dir", isPlayIrrelevant("apps/api/test/a.ts") === true],
    ["parseArgs base", parseArgs(["--base", "origin/main"]).base === "origin/main"],
    ["parseArgs flags", parseArgs(["--all", "--no-playthrough"]).all === true && parseArgs(["--no-playthrough"]).noPlaythrough === true],
  ];
  let failed = 0;
  log("merge-gate selftest:");
  for (const [label, ok] of cases) { if (!ok) failed++; log(`  ${ok ? "PASS" : "FAIL"}  ${label}`); }
  log(failed === 0 ? "merge-gate selftest: OK" : `merge-gate selftest: FAIL (${failed})`);
  return failed;
}

// --------------------------------------------------------------------------
function printHelp() {
  log(`merge-gate — run the whole gate and refuse the merge if any part fails.

  node scripts/merge-gate.mjs [options]

  --base <ref>            diff against <ref> to decide if the playthrough is
                          needed (default: main). Point it at the merge target.
  --all                   run the playthrough regardless of the diff
  --no-playthrough        skip the playthrough (prints that it was skipped)
  --static                run only the static gates (no playthrough)
  --playthrough-only      run only the playthrough (no static gates)
  --playthrough-base <url>  run check-playthrough against a stack you already have
                          up, instead of provisioning a throwaway one
  --install-hooks         install a best-effort pre-push hook
  --selftest              exercise the pure logic; run no gates
  --concurrency <n>       static-gate parallelism (default 4)
  -h, --help              this help`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { printHelp(); process.exit(0); }
  if (opts.selftest) process.exit(selftest() === 0 ? 0 : 1);
  if (opts.installHooks) { installHooks(); process.exit(0); }

  log(`${C.bold}=== merge gate ===${C.reset}`);

  // Preflight 1: dependencies.
  if (!dependencyPreflight()) { log(`\n${C.red}${C.bold}MERGE REFUSED${C.reset} — dependency preflight not satisfied.`); process.exit(2); }

  // Scope the playthrough.
  const { ref: baseRef, error: baseErr } = resolveBase(opts.base);
  if (opts.base && baseErr) { log(`${C.red}${baseErr}${C.reset}`); process.exit(2); }
  const files = changedFiles(baseRef);
  log(`${C.dim}base: ${baseRef ?? "(none)"} — ${files === null ? "changed files unknown" : `${files.length} changed file(s)`}${C.reset}`);

  let decision;
  if (opts.playthroughOnly) decision = { run: true, reason: "--playthrough-only" };
  else if (opts.static) decision = { run: false, reason: "--static: static gates only" };
  else if (opts.all) decision = { run: true, reason: "--all: forced" };
  else if (opts.noPlaythrough) decision = { run: false, reason: "--no-playthrough: skipped by request" };
  else decision = playthroughDecision(files);

  // Run the static gates in parallel (unless the operator asked for play only).
  let staticResults = [];
  if (opts.playthroughOnly) {
    log(`\n${C.yellow}⊘ static gates SKIPPED${C.reset} — --playthrough-only`);
  } else {
    log(`\n${C.bold}static gates${C.reset} (parallel, concurrency ${opts.concurrency})`);
    staticResults = await runPool(STATIC_STEPS, opts.concurrency);
  }

  // Run (or justifiably skip) the playthrough.
  let playResult = null; // { code, skipped, reason }
  if (!decision.run) {
    playResult = { code: 0, skipped: true, reason: decision.reason };
    log(`\n${C.yellow}⊘ check-playthrough SKIPPED${C.reset} — ${decision.reason}`);
  } else {
    log(`\n${C.bold}playthrough${C.reset} — ${decision.reason}`);
    try {
      if (opts.playthroughBase) {
        const base = opts.playthroughBase.replace(/\/$/, "");
        if (!(await httpOk(`${base}/`))) throw new Error(`no web server reachable at ${base} (--playthrough-base)`);
        const r = await runStep({ name: "check-playthrough", cmd: process.execPath, args: ["scripts/check-playthrough.mjs", base] });
        process.stdout.write(r.out);
        playResult = { code: r.code, skipped: false };
      } else if (!haveDocker()) {
        throw new Error("docker is not available to provision a throwaway stack. Start a stack yourself and pass --playthrough-base, or run on a host with docker.");
      } else {
        const code = await runPlaythroughWithStack();
        playResult = { code, skipped: false };
      }
    } catch (e) {
      log(`${C.red}✗ playthrough could not be run: ${e.message}${C.reset}`);
      playResult = { code: 2, skipped: false, provisionError: true };
    }
  }

  // Summary.
  log(`\n${C.bold}==================== gate summary ====================${C.reset}`);
  const rows = [...staticResults].sort((a, b) => a.name.localeCompare(b.name));
  let anyFail = false;
  for (const r of rows) {
    const ok = r.code === 0;
    if (!ok) anyFail = true;
    log(`  ${ok ? C.green + "PASS" : C.red + "FAIL"}${C.reset}  ${r.name.padEnd(28)} ${C.dim}${fmtS(r.ms)}${C.reset}`);
  }
  if (playResult?.skipped) log(`  ${C.yellow}SKIP${C.reset}  ${"check-playthrough".padEnd(28)} ${C.dim}(${playResult.reason})${C.reset}`);
  else if (playResult) {
    const ok = playResult.code === 0;
    if (!ok) anyFail = true;
    const tag = playResult.provisionError ? C.red + "ERROR" : ok ? C.green + "PASS" : C.red + "FAIL";
    log(`  ${tag}${C.reset}  ${"check-playthrough".padEnd(28)}`);
  }

  // Replay the full output of anything that failed, so the reason is in-console.
  const failed = rows.filter((r) => r.code !== 0);
  for (const r of failed) {
    log(`\n${C.red}${C.bold}----- ${r.name} output -----${C.reset}`);
    process.stdout.write(r.out);
  }

  if (anyFail) {
    log(`\n${C.red}${C.bold}MERGE REFUSED${C.reset} — the gate did not pass. Fix the above and re-run; do not merge on a red gate.`);
    process.exit(1);
  }
  log(`\n${C.green}${C.bold}GATE GREEN${C.reset} — every gate passed${playResult?.skipped ? " (playthrough justifiably skipped)" : ""}. Safe to merge.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(2); });
