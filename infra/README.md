# Project Archive AWS sandbox

This CDK stack deploys the API to ECS/Fargate behind an HTTPS API Gateway
endpoint and stores accounts, sessions, saves, progress, and materialized
mastery reports in encrypted RDS PostgreSQL.

The stack is hard-locked to AWS account `056956104102` and defaults to
`us-east-1`.

## Deploy

```bash
export PATH="$HOME/.npm-global/bin:$PATH"
export AWS_PROFILE=sbsandbox
export AWS_REGION=us-east-1

pnpm aws:secret
pnpm aws:bootstrap
pnpm aws:deploy
```

`aws:secret` reads the existing Google OAuth values from the repository `.env`
file and sends them directly to Secrets Manager. It does not print or commit
the values.

After deployment, copy the `ApiUrl` stack output and run the local web app:

```bash
VITE_API_PROXY_TARGET="https://<api-id>.execute-api.us-east-1.amazonaws.com" \
  pnpm --filter @pa/web dev
```

The browser still uses `http://localhost:5173`, so the existing Google OAuth
redirect URI and first-party session-cookie behavior remain valid.

## Cost and teardown

RDS, NAT Gateway, Fargate, the internal load balancer, and API Gateway incur
ongoing sandbox charges. Remove the runtime stack when it is not needed:

```bash
AWS_PROFILE=sbsandbox AWS_REGION=us-east-1 \
  pnpm --filter @pa/infra exec cdk destroy --force
```

The stack retains an RDS snapshot on deletion. The imported
`project-archive/google-oauth` secret is managed separately and is not deleted
with the stack.
