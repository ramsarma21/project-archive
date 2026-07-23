import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CreateSecretCommand,
  DescribeSecretCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const env = new Map();
for (const line of readFileSync(resolve(root, ".env"), "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
  if (!match) continue;
  let value = match[2] ?? "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  env.set(match[1], value);
}

const clientId = env.get("GOOGLE_CLIENT_ID");
const clientSecret = env.get("GOOGLE_CLIENT_SECRET");
if (!clientId || !clientSecret) {
  throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env");
}

const region = process.env.AWS_REGION ?? process.env.CDK_DEFAULT_REGION ?? "us-east-1";
const identity = await new STSClient({ region }).send(new GetCallerIdentityCommand({}));
if (identity.Account !== "056956104102") {
  throw new Error(`Refusing to write secrets to non-sandbox account ${identity.Account ?? "unknown"}`);
}

const secretName = "project-archive/google-oauth";
const secretString = JSON.stringify({ clientId, clientSecret });
const secrets = new SecretsManagerClient({ region });
try {
  await secrets.send(new DescribeSecretCommand({ SecretId: secretName }));
  await secrets.send(new PutSecretValueCommand({ SecretId: secretName, SecretString: secretString }));
  console.log(`Updated ${secretName} in sandbox account ${identity.Account}.`);
} catch (error) {
  if (!(error instanceof ResourceNotFoundException)) throw error;
  await secrets.send(
    new CreateSecretCommand({
      Name: secretName,
      Description: "Google OAuth client credentials for Project Archive sandbox",
      SecretString: secretString,
    }),
  );
  console.log(`Created ${secretName} in sandbox account ${identity.Account}.`);
}
