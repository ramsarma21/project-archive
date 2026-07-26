// Reading the repo's .env, for the two command-line tools in this package.
//
// The API does not use this. `apps/api/src/config.ts` already calls dotenv against
// the repository root before anything imports the grading service, so inside the
// server the variables are simply present. This exists because the eval gate and
// the benchmark run as standalone scripts, and a package that has to be handed a
// credential by its caller cannot be run by a person.
//
// Existing values always win, so an operator can override the file for one run —
// `TRUEFOUNDRY_GRADING_MODEL=… pnpm grading:eval` — which is how the model
// comparison in the benchmark gets driven. dotenv is not a dependency of this
// package for the same reason it is not a dependency of assets/pipeline: the
// scripts there read the same file with the same precedence, and this is a
// stricter version of that parser rather than a new convention.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let loaded = false;

/** `packages/grading/src` → repo root. */
function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
}

export function parseEnvFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match === null) continue;
    const key = match[1];
    let value = (match[2] ?? "").trim();
    if (key === undefined) continue;
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    } else {
      // Unquoted values end at an inline comment.
      const comment = value.indexOf(" #");
      if (comment >= 0) value = value.slice(0, comment).trim();
    }
    values[key] = value;
  }
  return values;
}

/** Idempotent. Never overwrites a variable that is already set. */
export function loadRepoEnv(): void {
  if (loaded) return;
  loaded = true;
  const path = resolve(repoRoot(), ".env");
  if (!existsSync(path)) return;
  for (const [key, value] of Object.entries(
    parseEnvFile(readFileSync(path, "utf8")),
  )) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
