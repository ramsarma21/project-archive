# Project Archive AWS sandbox

This CDK stack deploys the API to ECS/Fargate behind an HTTPS API Gateway
endpoint and stores accounts, sessions, progression, mastery and PvP standing in
encrypted RDS PostgreSQL.

The stack is hard-locked to AWS account `056956104102` and defaults to
`us-east-1`.

## Secrets the owner must provision

The stack **imports** four Secrets Manager secrets and creates none of them,
because every value is a credential or a signing key that no script in this
repository may invent. `Secret.fromSecretNameV2` resolves at task start rather
than at synth, so a missing one is not a synth error — it is a task that cannot
start, found by the deployment circuit breaker after the running service has
begun being replaced. Run the pre-flight check before deploying (`pnpm aws:deploy`
runs it for you):

```bash
pnpm aws:secrets:check
```

| Secret | Keys | Where the value comes from |
|---|---|---|
| `project-archive/google-oauth` | `clientId`, `clientSecret` | Google Cloud console. `pnpm aws:secret` uploads the pair already in `.env`. |
| `project-archive/formative-grading` | `csrfSecret` | 32 random bytes, yours to generate. |
| `project-archive/verdict-receipt` | `receiptSecret` | 32 random bytes, yours to generate. **New.** |
| `project-archive/grading-credential` | `apiKey` | A TrueFoundry API key **provisioned with its own rate limit**, separate from the image-pipeline key. |

### `project-archive/verdict-receipt`

`@pa/grading` derives the duel-verdict receipt key from `GRADING_RECEIPT_SECRET`,
falling back to `SESSION_SECRET`. Neither was injected, so verdict signing threw
on every deployed duel round — and the receipt is what stops a modified client
turning a WRONG verdict into a CORRECT one on its way to the mission commit.

```bash
aws secretsmanager create-secret \
  --name project-archive/verdict-receipt \
  --description "Duel verdict receipt HMAC key" \
  --secret-string "{\"receiptSecret\":\"$(openssl rand -base64 32)\"}"
```

Rotating it invalidates receipts already in flight, which costs at most the
verdicts of duels in progress at that moment. Do it between lessons.

### `project-archive/grading-credential`

This must be a **dedicated grading credential with its own quota**, not the key
`assets/pipeline` uses for image generation. The reason is measured, not
cosmetic: the gateway serialises, at 622 ms median serially and 1516 ms at
concurrency 3 against a 1.5-second cap, so a class of thirty sharing a key with
an asset render sits on the cap and takes the generous fallback — which grants a
full magazine for any answer. `@pa/grading` refuses to fall back to
`TRUEFOUNDRY_API_KEY` in production for the same reason.

Provision a TrueFoundry virtual key scoped to the grading model
(`gemini-group/gemini-3.5-flash-lite`) with a per-minute limit sized for a class:
six rounds per student per duel, thirty students, so roughly 180 requests per
lesson with bursts of thirty. Then:

```bash
aws secretsmanager create-secret \
  --name project-archive/grading-credential \
  --description "TrueFoundry grading key, own quota" \
  --secret-string '{"apiKey":"<the key>"}'
```

Until it exists and holds a working key, every duel round is granted the maximum
without being graded. That state is now **alarmed** rather than silent — see
below — but it is not visible in `/v1/health`, which stays green because the API
and the database are fine.

## Alerting

`PA_ALERT_EMAIL` subscribes an address to the stack's SNS topic and every alarm
delivers to it, on both the alarm and the recovery transition. Without it synth
prints a warning and the alarms fire into an unsubscribed topic.

```bash
PA_ALERT_EMAIL=ops@example.org pnpm aws:deploy
```

SNS sends a confirmation mail that must be accepted before anything is
delivered.

Two of the four alarms are about grading, and they exist because grading grants
the maximum on timeout: an unreachable gateway is otherwise indistinguishable
from a class of geniuses.

| Alarm | Fires on |
|---|---|
| `GradingUnreachable` | 20+ ungraded rounds in 5 minutes. The shape a dead gateway takes. |
| `GradingFallbackRateHigh` | 25%+ of rounds ungraded across two 5-minute periods, once at least five rounds have been graded. |

Both read `ProjectArchive/Grading` metrics extracted by log metric filter from
the API's own per-round log line. `apps/api/test/grading-signal.test.ts` asserts
the field names in this stack still match the ones the API writes, because a
rename produces a metric that is permanently zero — which reads exactly like
healthy grading.

## Deploy

```bash
export PATH="$HOME/.npm-global/bin:$PATH"
export AWS_PROFILE=sbsandbox
export AWS_REGION=us-east-1

pnpm aws:secret
pnpm aws:secrets:check
pnpm aws:bootstrap
PA_ALERT_EMAIL=ops@example.org pnpm aws:deploy
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

The stack retains an RDS snapshot on deletion. All four imported secrets are
managed separately and are not deleted with the stack.
