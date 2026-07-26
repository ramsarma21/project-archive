// Pre-flight: do the secrets this stack imports actually exist, and do they
// hold the keys the task definition names?
//
// WHY THIS EXISTS AS A SEPARATE STEP. `Secret.fromSecretNameV2` resolves at
// deploy time, not at synth. A missing secret — or a secret that exists but is
// missing one JSON key — is therefore not a synth error and not a CloudFormation
// error either. It is a task that cannot start, discovered by the ECS deployment
// circuit breaker several minutes into a deploy that has already begun replacing
// the running service. `scripts/deploy.mjs` runs this first so that the answer
// arrives before anything moves.
//
// IT NEVER MINTS A VALUE, and never prints one. A signing key or a gateway
// credential invented by a script is a credential nobody chose and nobody can
// rotate on purpose; the whole point of importing these rather than creating
// them is that their values are the owner's. This reports what is missing and
// exits non-zero, and the remedy it prints is a command for a human to run.

import {
  GetSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { REQUIRED_SECRETS } from "../lib/project-archive-stack.js";

const SANDBOX_ACCOUNT = "056956104102";

const region =
  process.env.AWS_REGION ?? process.env.CDK_DEFAULT_REGION ?? "us-east-1";

/**
 * Whose account this is.
 *
 * Separated from the checks below and given its own error message because
 * "cannot reach AWS" and "a secret is missing" want different actions from the
 * reader, and an SDK credentials stack trace in the middle of a deploy reads as a
 * bug in this script rather than as an unset AWS_PROFILE.
 */
let account: string | undefined;
try {
  const identity = await new STSClient({ region }).send(
    new GetCallerIdentityCommand({}),
  );
  account = identity.Account;
} catch (error) {
  console.error(
    `Could not identify the AWS account in ${region}: ` +
      `${error instanceof Error ? error.message : String(error)}\n` +
      "Set AWS_PROFILE and AWS_REGION. The secrets were NOT checked, and a " +
      "deploy would not have been able to authenticate either.",
  );
  process.exit(1);
}
if (account !== SANDBOX_ACCOUNT) {
  console.error(
    `Refusing to inspect secrets in non-sandbox account ${account ?? "unknown"}.`,
  );
  process.exit(1);
}

const secrets = new SecretsManagerClient({ region });

type Problem =
  | { readonly kind: "MISSING_SECRET"; readonly secret: string; readonly keys: readonly string[] }
  | { readonly kind: "MISSING_KEYS"; readonly secret: string; readonly keys: readonly string[] }
  | { readonly kind: "NOT_JSON"; readonly secret: string; readonly keys: readonly string[] }
  | { readonly kind: "EMPTY_KEYS"; readonly secret: string; readonly keys: readonly string[] };

const problems: Problem[] = [];

for (const [secret, requiredKeys] of Object.entries(REQUIRED_SECRETS)) {
  let raw: string | undefined;
  try {
    const value = await secrets.send(new GetSecretValueCommand({ SecretId: secret }));
    raw = value.SecretString;
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      problems.push({ kind: "MISSING_SECRET", secret, keys: requiredKeys });
      continue;
    }
    // Anything else — a denied GetSecretValue, a throttle — is a failure to CHECK
    // rather than a missing secret, and saying "missing" would send the reader off
    // to create a secret that already exists.
    console.error(
      `Could not read ${secret}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw ?? "") as Record<string, unknown>;
  } catch {
    problems.push({ kind: "NOT_JSON", secret, keys: requiredKeys });
    continue;
  }
  const absent = requiredKeys.filter((key) => !(key in parsed));
  if (absent.length > 0) {
    problems.push({ kind: "MISSING_KEYS", secret, keys: absent });
    continue;
  }
  // A key present and empty passes ECS injection and then fails inside the app,
  // which is the harder failure to read: the task starts, the endpoint answers,
  // and one subsystem is quietly dead.
  const blank = requiredKeys.filter(
    (key) => typeof parsed[key] !== "string" || (parsed[key] as string).trim() === "",
  );
  if (blank.length > 0) {
    problems.push({ kind: "EMPTY_KEYS", secret, keys: blank });
    continue;
  }
  console.log(`ok    ${secret} (${requiredKeys.join(", ")})`);
}

if (problems.length === 0) {
  console.log(`\nAll ${Object.keys(REQUIRED_SECRETS).length} imported secrets are present.`);
  process.exit(0);
}

console.error("\nThe deploy would produce a task that cannot start.\n");
for (const problem of problems) {
  const detail =
    problem.kind === "MISSING_SECRET"
      ? `does not exist; needs keys ${problem.keys.join(", ")}`
      : problem.kind === "NOT_JSON"
        ? `is not a JSON object; needs keys ${problem.keys.join(", ")}`
        : problem.kind === "EMPTY_KEYS"
          ? `has empty keys ${problem.keys.join(", ")}`
          : `is missing keys ${problem.keys.join(", ")}`;
  console.error(`FAIL  ${problem.secret} ${detail}`);
}
console.error(
  "\nCreate or repair each one in Secrets Manager in account " +
    `${SANDBOX_ACCOUNT} / ${region}. See infra/README.md for what each value is ` +
    "and how to generate the two that are ours to generate.",
);
process.exit(1);
