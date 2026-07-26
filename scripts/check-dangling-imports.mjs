// Resolve every import in the workspace and fail on any that points nowhere.
//
// WHY THIS EXISTS. `tsc` already catches a broken import inside a package that
// typechecks. This catches the two cases it does not:
//
//   1. A file that nothing typechecks — a .mjs script, a test excluded from the
//      project, a package whose typecheck is red for an unrelated reason — can
//      hold a stale path indefinitely.
//   2. An import of a workspace package that no longer exists. That resolves
//      through node_modules until someone reinstalls, at which point it becomes
//      a mystery failure a long way from the deletion that caused it.
//
// It was written to make a large deletion safe (removing the retired Boston
// chapter) and kept because the next large deletion will want it too. It needs
// no node_modules, so it still works when the workspace is mid-install.
//
// Comments are stripped before matching: a doc comment that shows an example
// import is documentation, not a dependency.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN = ["apps", "packages", "scripts", "infra"];
// Generated output, all of it gitignored. `cdk.out` belongs with the rest for the
// same reason and was simply missed: a CDK synth snapshots directories wholesale
// into `asset.<hash>/` bundles, so a copied script lands at a different depth than
// its original and its relative imports resolve to nothing THERE while remaining
// correct in the source tree. That is a false positive nobody can fix by editing
// code — the only edit would be to a build artifact — and it appears and vanishes
// with whether anyone has run `pnpm aws:synth` lately, which makes this check's
// result depend on untracked local state.
const SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".vite",
  "coverage",
  "cdk.out",
]);
const EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".json", ".html", ".glsl"];

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) out.push(path);
  }
}

// Line and block comments removed; string literals preserved so the specs
// inside them still count. Newlines survive so reported lines stay true.
function stripComments(source) {
  let out = "";
  let mode = "code";
  let quote = "";
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];
    if (mode === "code") {
      if (c === '"' || c === "'" || c === "`") {
        mode = "string";
        quote = c;
        out += c;
      } else if (c === "/" && next === "/") {
        mode = "line";
        i++;
      } else if (c === "/" && next === "*") {
        mode = "block";
        i++;
      } else out += c;
    } else if (mode === "string") {
      if (c === "\\") {
        out += c + (next ?? "");
        i++;
      } else {
        out += c;
        if (c === quote) mode = "code";
        else if (c === "\n") mode = "code";
      }
    } else if (mode === "line") {
      if (c === "\n") {
        out += c;
        mode = "code";
      }
    } else if (mode === "block") {
      if (c === "*" && next === "/") {
        mode = "code";
        i++;
      } else if (c === "\n") out += c;
    }
  }
  return out;
}

const files = [];
for (const dir of SCAN) walk(join(ROOT, dir), files);

const workspacePackages = new Set();
for (const group of ["packages", "apps"]) {
  let entries;
  try {
    entries = readdirSync(join(ROOT, group), { withFileTypes: true });
  } catch {
    continue;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest = JSON.parse(
        readFileSync(join(ROOT, group, entry.name, "package.json"), "utf8"),
      );
      if (manifest.name) workspacePackages.add(manifest.name);
    } catch {
      /* a directory without a manifest is not a workspace package */
    }
  }
}

const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\(\s*|^\s*import\s+)["']([^"']+)["']/gm;
const isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const dangling = [];
const missingPackages = [];
for (const file of files) {
  const source = stripComments(readFileSync(file, "utf8"));
  SPEC.lastIndex = 0;
  let match;
  while ((match = SPEC.exec(source)) !== null) {
    const spec = match[1];
    const line = source.slice(0, match.index).split("\n").length;
    const where = `${relative(ROOT, file)}:${line}`;
    if (spec.startsWith(".")) {
      const base = resolve(dirname(file), spec);
      const candidates = [
        base,
        ...EXT.map((e) => base + e),
        // TS writes ./x.js for ./x.ts
        ...EXT.map((e) => base.replace(/\.[a-z]+$/, e)),
        ...EXT.map((e) => join(base, "index" + e)),
      ];
      if (!candidates.some(isFile)) dangling.push(`${where}  ->  ${spec}`);
    } else if (spec.startsWith("@pa/")) {
      const pkg = spec.split("/").slice(0, 2).join("/");
      if (!workspacePackages.has(pkg)) missingPackages.push(`${where}  ->  ${spec}`);
    }
  }
}

console.log(
  `dangling-imports: scanned ${files.length} files across ${workspacePackages.size} workspace packages`,
);

let failed = false;
if (dangling.length) {
  failed = true;
  console.error(`\n  FAIL: ${dangling.length} import(s) resolve to nothing:`);
  for (const d of dangling) console.error(`    error: ${d}`);
}
if (missingPackages.length) {
  failed = true;
  console.error(`\n  FAIL: ${missingPackages.length} import(s) of a deleted workspace package:`);
  for (const d of missingPackages) console.error(`    error: ${d}`);
  console.error("  The package is gone. Remove the import and the dependency entry.");
}
if (failed) process.exit(1);

console.log("dangling-imports: OK (every relative path and @pa specifier resolves)");
