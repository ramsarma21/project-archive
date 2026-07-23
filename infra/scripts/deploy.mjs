import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Docker Desktop's macOS credential helper can block non-interactive CDK ECR
// login. An isolated temporary Docker config stores only the short-lived ECR
// token and is removed immediately after deployment.
const dockerConfig = mkdtempSync(join(tmpdir(), "project-archive-cdk-docker-"));
try {
  const result = spawnSync(
    "pnpm",
    ["exec", "cdk", "deploy", "--require-approval", "never"],
    {
      stdio: "inherit",
      env: { ...process.env, DOCKER_CONFIG: dockerConfig },
    },
  );
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(dockerConfig, { recursive: true, force: true });
}
