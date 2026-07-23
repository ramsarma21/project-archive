#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { ProjectArchiveStack } from "../lib/project-archive-stack.js";

const app = new cdk.App();
const account = process.env.CDK_DEFAULT_ACCOUNT;
if (account && account !== "056956104102") {
  throw new Error(`Refusing to deploy Project Archive to non-sandbox account ${account}`);
}

const stack = new ProjectArchiveStack(app, "ProjectArchiveSandbox", {
  env: {
    account: account ?? "056956104102",
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
  description: "Project Archive sandbox API and PostgreSQL persistence",
});

cdk.Tags.of(stack).add("Project", "project-archive");
cdk.Tags.of(stack).add("Environment", "sandbox");
cdk.Tags.of(stack).add("ManagedBy", "aws-cdk");
