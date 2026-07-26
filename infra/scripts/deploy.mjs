import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// The imported Secrets Manager secrets are resolved by ECS at task start, not by
// CDK at synth, so a missing one is not a synth failure and not a CloudFormation
// failure either — it is a task that cannot start, discovered by the deployment
// circuit breaker after the running service has already begun being replaced.
// Checking first turns that into a refusal before anything moves. Skippable for
// the case where the operator knows a secret is mid-rotation:
//   PA_SKIP_SECRET_CHECK=true pnpm aws:deploy
if (process.env.PA_SKIP_SECRET_CHECK !== "true") {
  const preflight = spawnSync(
    "node",
    ["--import", "tsx", join(import.meta.dirname, "check-secrets.ts")],
    { stdio: "inherit" },
  );
  if (preflight.status !== 0) {
    console.error(
      "\nRefusing to deploy: see above. Re-run with PA_SKIP_SECRET_CHECK=true " +
        "only if you know the task can start without them.",
    );
    process.exit(preflight.status ?? 1);
  }
}

// Docker Desktop's macOS credential helper can block non-interactive CDK ECR
// login. An isolated temporary Docker config stores only the short-lived ECR
// token and is removed immediately after deployment.
const dockerConfig = mkdtempSync(join(tmpdir(), "project-archive-cdk-docker-"));
try {
  // Extra arguments are forwarded so deployment settings can be passed as CDK
  // context, e.g. `pnpm aws:deploy -- -c webOrigin=https://…`. They can equally
  // be supplied as PA_* environment variables, which pass through below.
  const result = spawnSync(
    "pnpm",
    ["exec", "cdk", "deploy", "--require-approval", "never", ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: { ...process.env, DOCKER_CONFIG: dockerConfig },
    },
  );
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(dockerConfig, { recursive: true, force: true });
}
