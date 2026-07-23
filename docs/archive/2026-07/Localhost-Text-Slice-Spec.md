# Localhost Text Vertical Slice

## Zero-Autonomy Implementation Directive

**Version:** 1.0  
**Locked:** 16 July 2026  
**Scope:** Google-login, multi-account, localhost Boston Day 1 text flow on the production headless runtime boundary.

**Authority.** This document is the exact coding contract for the first runnable Project Archive implementation. `Day-1.md` is the canonical behavioral fixture. `Backend-AI-System.md` supplies the platform architecture. If this document disagrees with current `Day-1.md`, stop and correct this document before coding.

**Implementer contract.** The implementing agent must execute this specification as written. It may fix syntax, types, imports, and objectively broken implementation details without changing behavior. It may not select a different framework, dependency, database, authentication flow, state model, route, UI flow, game rule, time value, relationship value, identifier, or test expectation. An unavailable credential or external console permission is a blocker to report, not an invitation to invent a bypass.

**Goal.** From a clean clone, a developer with Docker, Node, pnpm, and Google OAuth credentials can:

1. start PostgreSQL;
2. run migrations and seed the Day 1 package;
3. start API and text client;
4. sign in with one Google account;
5. play and resume the complete text version of Boston Day 1;
6. log out without losing progress;
7. sign in with a different Google account and receive a separate, differently seeded game;
8. return to the first account and resume its exact state;
9. run automated tests proving account isolation, deterministic outcomes, save/resume identity, fixed history, and the Day 1 learning guarantee.

The text client is disposable. The headless runtime, package, IDs, APIs, database, saves, and tests are production foundations for the later Three.js client.

### Exact implementer prompt

Give the coding agent this prompt without modification:

```text
Implement Localhost-Text-Slice-Spec.md completely.

Authority order:
1. Day-1.md for Boston Day 1 behavior.
2. Localhost-Text-Slice-Spec.md for exact implementation.
3. Backend-AI-System.md for platform contracts.

Do not redesign, substitute technologies, add product behavior, simplify the state
machines, move logic into the text UI, or use the legacy Python simulator as the
fixture. Complete tickets in the specified order and run every required test.

Stop only for a blocker explicitly listed in §21. At completion, return the exact
handoff required by §32. If any requirement or test is incomplete, report the task
as incomplete rather than claiming success.
```

---

## 1. Definition of done

The slice is done only when all statements below are true.

- `pnpm dev` starts the text client at `http://localhost:5173` and API at `http://localhost:3001`.
- Google login uses a real Google OAuth web client and explicit account selection.
- Account A and Account B receive different `profile_id`, 32-byte variation root seeds, Learner State, ReplayProfileState, and SaveRecords.
- Logging out clears the application session but preserves both local and server saves.
- After one online login, an unexpired device-bound offline grant permits a cold offline reload/resume of that same profile; explicit logout removes the grant.
- Login never identifies ownership by email; it uses Google issuer + immutable subject.
- Day 1 runs from Archive intake through the full-screen Archive day-end record.
- The runtime is a Web Worker importing no React or Three.js.
- The text client receives typed `ExecutionPlan`s and returns typed presenter events.
- Deleting `apps/text-web` does not break runtime package tests.
- No backend/API endpoint chooses the next game action.
- Every decision has at most three choices.
- Traversal itself adds zero clock units.
- The fixed event becomes mandatory at clock unit 24 regardless of unfinished errands.
- Missed errands remain missed; learning reroutes without reversing them.
- Every Day 1 concept reaches three tracked occasions across at least two types, Understanding, and Demonstration on every legal path.
- The initial Understanding miss gets one re-exposure and one retry. A second miss corrects in place and cannot loop.
- Notes is added exactly once at first Understanding.
- Same-day demonstration and later reassessment corrections never add Notes again.
- Save/resume at every checkpoint produces the same selected action IDs, outcomes, clock, learning evidence, relationships, and continuation as uninterrupted play.
- The current legacy Python simulator is not imported or treated as the Day 1 fixture.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:model`, and `pnpm test:e2e` pass.

---

## 2. Locked toolchain

Use exactly these runtime/dependency versions and commit `pnpm-lock.yaml`.

### Runtime

```text
Node.js                  24.18.0
pnpm                     11.13.1
PostgreSQL               17 (Docker image postgres:17-alpine)
TypeScript               7.0.2
```

### Client

```text
react                    19.2.7
react-dom                19.2.7
vite                     8.1.5
@vitejs/plugin-react     6.0.3
vite-plugin-pwa          1.3.0
dexie                    4.4.4
zod                      4.4.3
```

### API/data

```text
fastify                  5.10.0
@fastify/cookie          11.1.2
@fastify/helmet          13.1.0
@fastify/rate-limit      11.1.0
google-auth-library      10.9.0
jose                     6.2.3
drizzle-orm              0.45.2
drizzle-kit              0.31.10
pg                       8.22.0
dotenv                   17.4.2
zod                      4.4.3
json-canonicalize        2.0.0
```

### Development/test

```text
tsx                      4.23.1
vitest                   4.1.10
@playwright/test         1.61.1
supertest                7.2.2
@types/supertest         7.2.1
@types/node              24.13.3
@types/react             19.2.17
@types/react-dom         19.2.3
eslint                   10.7.0
typescript-eslint        8.64.0
prettier                 3.9.5
concurrently             10.0.3
```

Install every package with `pnpm add --save-exact` / `pnpm add --save-dev --save-exact`. No caret or tilde ranges are allowed in package manifests.
The implementing agent creates and commits `pnpm-lock.yaml` once. Every clean-clone install and CI run after that uses `pnpm install --frozen-lockfile`.

Do not install:

- Next.js;
- NestJS;
- Prisma;
- Redux;
- Zustand;
- Redis;
- GraphQL;
- an authentication framework;
- an LLM SDK;
- Three.js or R3F in the text slice.

### Dependency allocation

Root dev dependencies:

```text
typescript, tsx, vitest, @playwright/test, eslint, typescript-eslint,
prettier, concurrently, drizzle-kit, @types/node
```

`@pa/api` dependencies:

```text
fastify, @fastify/cookie, @fastify/helmet, @fastify/rate-limit,
google-auth-library, jose, drizzle-orm, pg, zod, dotenv,
@pa/contracts, @pa/content-schema
```

`@pa/text-web` dependencies:

```text
react, react-dom, dexie, zod, jose,
@pa/contracts, @pa/save-runtime
```

`@pa/text-web` dev dependencies:

```text
vite, @vitejs/plugin-react, vite-plugin-pwa, @types/react, @types/react-dom
```

Internal package dependency direction:

```text
contracts                 -> zod only
content-schema            -> contracts, zod
world-state               -> contracts
learner-model             -> contracts
replay-state              -> contracts
selector                  -> contracts
outcome-resolver          -> contracts
save-runtime              -> contracts
runtime-core              -> contracts, world-state, learner-model,
                             replay-state, selector, outcome-resolver, save-runtime
content-compiler          -> contracts, content-schema, json-canonicalize
model-checker             -> contracts, runtime-core, compiled Day 1 package
```

No internal dependency may point from a package into an app or content source directory.

---

## 3. Exact repository layout

Create this structure without renaming modules:

```text
.
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── app.ts
│   │   │   ├── server.ts
│   │   │   ├── config.ts
│   │   │   ├── db/
│   │   │   │   ├── client.ts
│   │   │   │   ├── schema.ts
│   │   │   │   └── migrations/
│   │   │   ├── auth/
│   │   │   │   ├── google.ts
│   │   │   │   ├── sessions.ts
│   │   │   │   ├── csrf.ts
│   │   │   │   └── authorization.ts
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts
│   │   │   │   ├── profiles.ts
│   │   │   │   ├── saves.ts
│   │   │   │   ├── packages.ts
│   │   │   │   └── health.ts
│   │   │   └── services/
│   │   │       ├── profile-service.ts
│   │   │       ├── save-service.ts
│   │   │       └── package-service.ts
│   │   └── test/
│   └── text-web/
│       ├── src/
│       │   ├── main.tsx
│       │   ├── app.tsx
│       │   ├── vite-env.d.ts
│       │   ├── routes/
│       │   │   ├── login-page.tsx
│       │   │   ├── home-page.tsx
│       │   │   ├── play-page.tsx
│       │   │   └── auth-result-page.tsx
│       │   ├── auth/
│       │   │   ├── session-client.ts
│       │   │   └── csrf-client.ts
│       │   ├── runtime/
│       │   │   ├── runtime.worker.ts
│       │   │   ├── runtime-client.ts
│       │   │   └── text-presentation-port.ts
│       │   ├── presenters/
│       │   │   ├── narrative-presenter.tsx
│       │   │   ├── prompt-presenter.tsx
│       │   │   ├── focus-read-presenter.tsx
│       │   │   ├── timing-presenter.tsx
│       │   │   ├── hold-presenter.tsx
│       │   │   ├── sort-presenter.tsx
│       │   │   ├── place-presenter.tsx
│       │   │   ├── free-roam-presenter.tsx
│       │   │   └── day-end-presenter.tsx
│       │   ├── components/
│       │   │   ├── archive-strip.tsx
│       │   │   ├── transcript.tsx
│       │   │   ├── relationship-card.tsx
│       │   │   └── sync-status.tsx
│       │   ├── local/
│       │   │   ├── database.ts
│       │   │   ├── encryption.ts
│       │   │   ├── save-repository.ts
│       │   │   └── sync-outbox.ts
│       │   ├── offline/
│       │   │   ├── grant-client.ts
│       │   │   ├── offline-unlock.ts
│       │   │   └── register-service-worker.ts
│       │   └── styles.css
│       └── test/
├── packages/
│   ├── contracts/
│   │   └── src/
│   │       ├── ids.ts
│   │       ├── content.ts
│   │       ├── execution.ts
│   │       ├── state.ts
│   │       ├── auth.ts
│   │       ├── api.ts
│   │       └── index.ts
│   ├── content-schema/
│   │   └── src/
│   │       ├── action-spec.ts
│   │       ├── prompt-spec.ts
│   │       ├── carrier-contract.ts
│   │       ├── package.ts
│   │       └── index.ts
│   ├── content-compiler/
│   │   └── src/
│   │       ├── compile.ts
│   │       ├── validate.ts
│   │       ├── sign.ts
│   │       └── cli.ts
│   ├── runtime-core/
│   │   ├── src/
│   │       ├── runtime.ts
│   │       ├── event-manager.ts
│   │       ├── eligibility.ts
│   │       ├── archive-queue.ts
│   │       ├── prepared-frontier.ts
│   │       ├── transaction.ts
│   │       └── index.ts
│   │   └── test/
│   │       ├── scripted-presentation-port.ts
│   │       └── presenter-conformance.test.ts
│   ├── selector/
│   │   └── src/
│   │       ├── canonical.ts
│   │       ├── rank.ts
│   │       ├── select.ts
│   │       └── vectors.test.ts
│   ├── outcome-resolver/
│   │   └── src/
│   │       ├── resolve.ts
│   │       ├── canonical.ts
│   │       └── vectors.test.ts
│   ├── world-state/
│   │   └── src/
│   │       ├── schema.ts
│   │       ├── reducer.ts
│   │       ├── objectives.ts
│   │       ├── relationships.ts
│   │       └── clock.ts
│   ├── learner-model/
│   │   └── src/
│   │       ├── schema.ts
│   │       ├── reducer.ts
│   │       ├── exposures.ts
│   │       ├── lifecycle.ts
│   │       └── reroute.ts
│   ├── replay-state/
│   │   └── src/
│   │       ├── schema.ts
│   │       ├── seed.ts
│   │       └── reducer.ts
│   ├── save-runtime/
│   │   └── src/
│   │       ├── schema.ts
│   │       ├── serialize.ts
│   │       ├── transaction.ts
│   │       └── resume.ts
│   ├── model-checker/
│   │   └── src/
│   │       ├── enumerate.ts
│   │       ├── invariants.ts
│   │       ├── day1-model.test.ts
│   │       └── cli.ts
│   └── test-vectors/
│       └── fixtures/
├── content/
│   └── boston-day1/
│       ├── source/
│       │   ├── package.ts
│       │   ├── initial-state.ts
│       │   ├── concepts.ts
│       │   ├── relationships.ts
│       │   ├── objectives.ts
│       │   ├── actions/
│       │   └── index.ts
│       ├── compiled/
│       └── test/
├── scripts/
│   ├── generate-dev-signing-key.ts
│   ├── generate-offline-grant-key.ts
│   ├── seed-local.ts
│   └── reset-local.ts
├── .env.example
├── .gitignore
├── .nvmrc
├── docker-compose.yml
├── drizzle.config.ts
├── eslint.config.js
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── vite.config.ts
```

Do not put game rules in `apps/text-web` or `apps/api`.

---

## 4. Root configuration

### `.nvmrc`

```text
24.18.0
```

### `pnpm-workspace.yaml`

```yaml
packages:
  - apps/*
  - packages/*
  - content/*
```

### Root scripts

Root `package.json` must expose exactly:

```json
{
  "private": true,
  "packageManager": "pnpm@11.13.1",
  "engines": {
    "node": "24.18.0",
    "pnpm": "11.13.1"
  },
  "scripts": {
    "dev": "concurrently -k -n API,WEB -c blue,green \"pnpm --filter @pa/api dev\" \"pnpm --filter @pa/text-web dev\"",
    "build": "pnpm -r build",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "pnpm -r typecheck",
    "test": "vitest run",
    "test:model": "pnpm --filter @pa/model-checker test",
    "test:e2e": "playwright test",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:seed": "tsx scripts/seed-local.ts",
    "db:reset": "tsx scripts/reset-local.ts",
    "content:compile": "tsx packages/content-compiler/src/cli.ts compile content/boston-day1",
    "content:verify": "tsx packages/content-compiler/src/cli.ts verify content/boston-day1/compiled/package.json",
    "keys:dev": "tsx scripts/generate-dev-signing-key.ts",
    "keys:offline": "tsx scripts/generate-offline-grant-key.ts"
  }
}
```

`apps/api/package.json` scripts:

```json
{
  "name": "@pa/api",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  }
}
```

`apps/text-web/package.json` scripts:

```json
{
  "name": "@pa/text-web",
  "type": "module",
  "scripts": {
    "dev": "vite --config ../../vite.config.ts",
    "build": "vite build --config ../../vite.config.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  }
}
```

Every package under `packages/` and `content/boston-day1` uses its specified `@pa/...` name, `"type": "module"`, explicit `exports`, and scripts `build`, `typecheck`, and `test`. Empty test suites are not permitted; each package needs at least one contract/unit test before its ticket closes.

### `docker-compose.yml`

Use one service named `db`:

```yaml
services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: project_archive
      POSTGRES_USER: project_archive
      POSTGRES_PASSWORD: project_archive_local
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U project_archive -d project_archive"]
      interval: 2s
      timeout: 2s
      retries: 20
    volumes:
      - project_archive_pg:/var/lib/postgresql/data

volumes:
  project_archive_pg:
```

No Redis or object-storage emulator is used in this slice.

### `.gitignore` required entries

```gitignore
node_modules/
dist/
coverage/
.env
.env.*
!.env.example
.local/
playwright-report/
test-results/
content/*/compiled/
*.log
.DS_Store
```

Commit source content, migrations, package manifests, tests, and `pnpm-lock.yaml`. Do not commit generated compiled packages or development keys.

### `vite.config.ts`

```ts
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"
import { VitePWA } from "vite-plugin-pwa"

const repoRoot = fileURLToPath(new URL("./", import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "")
  const publicKeyPem = readFileSync(
    resolve(repoRoot, env.DEV_PACKAGE_PUBLIC_KEY_PATH),
    "utf8"
  )
  const offlineGrantPublicJwk = JSON.parse(
    readFileSync(resolve(repoRoot, env.OFFLINE_GRANT_PUBLIC_JWK_PATH), "utf8")
  )

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        manifest: {
          name: "Project Archive Text Slice",
          short_name: "Project Archive",
          start_url: "/",
          display: "standalone",
          background_color: "#ffffff",
          theme_color: "#111827"
        },
        devOptions: {
          enabled: true,
          type: "module"
        },
        workbox: {
          globPatterns: ["**/*.{html,js,css,svg,woff2}"],
          navigateFallback: "/index.html",
          runtimeCaching: [
            {
              urlPattern: /\/v1\/content\/day1$/,
              handler: "CacheFirst",
              options: {
                cacheName: "pa-content-v1",
                expiration: {
                  maxEntries: 2,
                  maxAgeSeconds: 60 * 60 * 24 * 30
                }
              }
            }
          ]
        }
      })
    ],
    define: {
      __PA_PACKAGE_PUBLIC_KEY_PEM__: JSON.stringify(publicKeyPem),
      __PA_OFFLINE_GRANT_PUBLIC_JWK__: JSON.stringify(offlineGrantPublicJwk)
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        "/v1": {
          target: "http://127.0.0.1:3001",
          changeOrigin: false
        }
      }
    },
    worker: {
      format: "es"
    }
  }
})
```

Client code uses relative `/v1/...` URLs only.

`apps/text-web/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
declare const __PA_PACKAGE_PUBLIC_KEY_PEM__: string
declare const __PA_OFFLINE_GRANT_PUBLIC_JWK__: {
  publicJwk: JsonWebKey
  thumbprint: string
}
```

### TypeScript rules

`tsconfig.base.json` must enable:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": false
  }
}
```

Every workspace extends this base. No `any`, `@ts-ignore`, or unchecked type assertion is allowed outside a test fixture with a comment naming the fixture reason.

Node-executed workspaces (`apps/api`, `content-compiler`, `model-checker`, `scripts`) override:

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  }
}
```

Every internal package uses ESM and `"type": "module"`. Internal imports use package exports, never source-relative paths crossing package boundaries.

---

## 5. Google Cloud setup

The human operator must perform these exact external steps once.

1. Open Google Cloud Console.
2. Create/select project `Project Archive Local Dev`.
3. Configure OAuth consent:
   - audience: External for ordinary Google accounts;
   - publishing status: Testing;
   - app name: `Project Archive Local`;
   - scopes: `openid`, `email`, `profile`;
   - add every Google account used for local testing as a test user.
4. Create OAuth Client ID:
   - application type: Web application;
   - name: `Project Archive localhost`;
   - authorized JavaScript origin: `http://localhost:5173`;
   - authorized redirect URI: `http://localhost:3001/v1/auth/google/callback`.
5. Copy client ID and client secret into `.env`.

Do not request Google Classroom, Drive, contacts, calendar, or offline Google API access.

---

## 6. Environment variables

Commit `.env.example` with exactly these keys, the fixed non-secret localhost values shown below, and blank secret/Google values:

```dotenv
NODE_ENV=development
API_HOST=127.0.0.1
API_PORT=3001
WEB_ORIGIN=http://localhost:5173
API_ORIGIN=http://localhost:3001
DATABASE_URL=postgres://project_archive:project_archive_local@localhost:5432/project_archive
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3001/v1/auth/google/callback
COOKIE_SIGNING_SECRET=
LOCAL_DATA_ENCRYPTION_SECRET=
OFFLINE_GRANT_PRIVATE_KEY_PATH=.local/keys/offline-es256-private.pem
OFFLINE_GRANT_PUBLIC_JWK_PATH=.local/keys/offline-es256-public.jwk.json
OFFLINE_GRANT_TTL_SECONDS=86400
POLICY_SNAPSHOT_ID=DEV.LOCAL.v1
DEV_PACKAGE_PRIVATE_KEY_PATH=.local/keys/dev-ed25519-private.pem
DEV_PACKAGE_PUBLIC_KEY_PATH=.local/keys/dev-ed25519-public.pem
CONTENT_PACKAGE_PATH=content/boston-day1/compiled/package.json
VITE_ENABLE_DEBUG_PANEL=false
```

Rules:

- `COOKIE_SIGNING_SECRET` is 32 random bytes encoded base64url.
- `LOCAL_DATA_ENCRYPTION_SECRET` is a separate 32-byte base64url value.
- `.env`, `.local/`, compiled development private keys, Playwright auth state, and database dumps are gitignored.
- Application startup fails with a clear error if any required variable is absent or malformed.
- No default Google client, cookie secret, or encryption secret exists.

`apps/api/src/config.ts` computes repository root with:

```ts
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url))
```

`CONTENT_PACKAGE_PATH` and development key paths resolve against `repoRoot`, never against `process.cwd()`.

Generate local secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Run it twice and use different results.

---

## 7. Local startup procedure

From a clean clone:

```bash
nvm install 24.18.0
nvm use 24.18.0
corepack enable
corepack prepare pnpm@11.13.1 --activate
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d db
pnpm keys:dev
pnpm keys:offline
pnpm db:migrate
pnpm content:compile
pnpm content:verify
pnpm db:seed
pnpm dev
```

Then open `http://localhost:5173`.

`pnpm db:seed` is idempotent. It inserts the compiled package metadata and no fake Google users.

---

## 8. Authentication and session protocol

### 8.1 Login

Use server-side Google Authorization Code flow with PKCE.

`GET /v1/auth/google/start`:

1. Generate 32 random bytes each for `state`, `nonce`, and PKCE verifier.
2. Compute S256 PKCE challenge.
3. Insert one `oauth_login_attempts` row containing SHA-256 hashes of state/nonce/verifier, creation time, 10-minute expiry, and `used_at = null`.
4. Set signed `pa_oauth_attempt` cookie containing only the login-attempt UUID:
   - HttpOnly;
   - SameSite=Lax;
   - Path=/v1/auth/google;
   - Max-Age=600;
   - Secure only when `NODE_ENV=production`.
5. Redirect to Google with:
   - response type `code`;
   - scopes `openid email profile`;
   - `prompt=select_account`;
   - `state`;
   - `nonce`;
   - `code_challenge`;
   - `code_challenge_method=S256`;
   - configured redirect URI.

`GET /v1/auth/google/callback`:

1. Require code, state, and signed attempt cookie.
2. Load unused, unexpired attempt.
3. Compare state using constant-time hashes.
4. Exchange code using client ID, secret, redirect URI, and stored verifier.
5. Verify ID-token signature, issuer, client-ID audience, expiry, and nonce.
6. Accept issuer only as `accounts.google.com` or `https://accounts.google.com`, normalize either to `https://accounts.google.com`, and reject every other issuer.
7. Read only `iss`, `sub`, `email`, `email_verified`, `name`, and `picture`.
8. Require `email_verified = true`.
9. In one PostgreSQL transaction:
   - upsert `external_identities` by `(issuer, subject)`;
   - create account/profile only if identity is new;
   - create 32-byte variation root seed only for a new profile;
   - mark login attempt used;
   - create refresh session and access session.
10. Set session and CSRF cookies.
11. Clear `pa_oauth_attempt`.
12. Redirect to `http://localhost:5173/auth/result?status=success`.

Email changes update display metadata but never change ownership.

### 8.2 Session cookies

Use opaque random tokens. Store only SHA-256 token hashes server-side.

`pa_access`:

- 32 random bytes, base64url;
- HttpOnly;
- SameSite=Lax;
- Path=/;
- 15-minute expiry;
- Secure in production.

`pa_refresh`:

- separate 32 random bytes;
- HttpOnly;
- SameSite=Lax;
- Path=/v1;
- 7-day idle expiry;
- 30-day absolute family expiry;
- Secure in production.

`pa_csrf`:

- 32 random bytes;
- readable by JavaScript;
- SameSite=Lax;
- Path=/;
- 7-day maximum lifetime, rotated whenever access/refresh tokens rotate;
- hash stored in access-session row.

Every mutating request requires `X-CSRF-Token` equal to `pa_csrf` and verifies the exact `Origin`.
Every authenticated request reloads session/account status and rejects revoked/expired sessions, disabled accounts, or deleted profiles before resource authorization.

### 8.3 Refresh

`POST /v1/session/refresh`:

1. Validate refresh cookie hash, family, expiry, revocation, user agent hash, and CSRF.
2. Rotate refresh token and access token in one transaction.
3. Revoke the previous refresh row.
4. If a revoked refresh token is reused, revoke the entire token family.

The client performs one refresh/retry after a 401. It never loops refresh requests.

API startup schedules one unref'd hourly cleanup task that deletes used/expired OAuth attempts older than 24 hours and expired/revoked access sessions older than 24 hours. Refresh-session rows remain through their absolute expiry plus 30 days for reuse detection, then delete.

### 8.4 Logout

Client logout sequence:

1. Flush the current runtime transaction/outbox to IndexedDB.
2. Write a local `logoutFences` record for the account before making any network request.
3. Attempt one cloud sync with a 2-second deadline; continue if offline/timeout.
4. Call `POST /v1/logout` with CSRF when reachable.
5. On successful server logout, remove the logout fence.
6. Delete the active profile's offline-grant JWS and `offline-signing:<profileId>` key.
7. Post `LOCK_PROFILE` to the runtime worker.
8. Remove all decrypted profile/session state from memory.
9. Navigate to `/login`.

API `POST /v1/logout`:

1. Require CSRF plus either the current access session or valid refresh token.
2. Revoke the access session and complete refresh-token family.
3. Clear `pa_access`, `pa_refresh`, and `pa_csrf`.
4. Return 204.

Logout does not call Google's global logout endpoint and does not delete saves.

On application boot, a logout fence blocks session restoration and profile decryption. If online, the client first calls `/v1/logout`, removes the fence after success, then shows Google login. If offline, it shows `Connect to finish signing out` and exposes no game/profile data.

### 8.5 Automated-test authentication

Playwright must not automate Google pages.

When and only when `NODE_ENV=test`, register:

```text
POST /v1/test/auth/login
```

Request:

```ts
{
  testSubject: "student-a" | "student-b"
}
```

The route:

- rejects any other value;
- creates/loads identity issuer `https://project-archive.local/test`;
- uses subject exactly `student-a` or `student-b`;
- creates the same application access/refresh/CSRF sessions as Google callback;
- is not registered at all outside `NODE_ENV=test`;
- requires header `X-PA-Test-Secret` matching a random secret provided only to the Playwright process.

Manual acceptance still requires two real Google test accounts.

---

## 9. Replaceable presentation architecture

The runtime worker is the product. The text React app is one presentation adapter.

### Forbidden imports

The following packages may not import from `react`, `react-dom`, browser DOM types, Three.js, or `apps/*`:

```text
contracts
content-schema
content-compiler
runtime-core
selector
outcome-resolver
world-state
learner-model
replay-state
save-runtime
model-checker
```

### Worker boundary

The main thread sends:

```ts
type RuntimeCommand =
  | { type: "BOOT"; profileId: string; packageBytes: Uint8Array }
  | { type: "START_NEW_DAY1_ATTEMPT" }
  | { type: "RESUME_SAVE"; saveId: string }
  | { type: "PRESENTER_EVENT"; event: PresenterEvent }
  | { type: "LOCK_PROFILE" }
```

The worker emits:

```ts
type RuntimeMessage =
  | { type: "READY"; profileId: string; saveId?: string }
  | { type: "EXECUTION_PLAN"; plan: ExecutionPlan }
  | { type: "STATE_VIEW"; view: PlayerVisibleStateView }
  | { type: "LOCAL_COMMIT"; transactionId: string; encryptedSave: Uint8Array }
  | { type: "DAY_COMPLETE"; saveId: string }
  | { type: "FATAL"; code: string; message: string }
```

No message exposes attempt seeds, hidden rank tuples, misconception labels, or correct-answer flags to the presenter.

### Text-only free roam

Day 1 contains self-driven exits and free-roam periods that the Three.js client will implement spatially. The text adapter represents these with a single neutral `Continue` control generated by the presenter, not by a ChoiceSpec. It returns:

```ts
{ type: "PROGRESS", progress: { phaseId: "TEXT_FREE_ROAM_CONTINUED" } }
```

This control:

- is not a player decision;
- has no choice ID;
- has no effect tags;
- does not count as an interaction for Sync spacing;
- adds no clock units;
- is not serialized as a world choice.

The Three.js adapter replaces it with actual traversal/location triggers.

---

## 10. Text client behavior

### Routes

Use a minimal client-side route switch based on `window.location.pathname`. Do not add React Router.

```text
/login         Google login button and existing locked-profile notices
/auth/result   consumes callback result, loads session, redirects home
/              account/profile home
/play          text game
```

### Login page

Render:

- Project Archive title;
- `Sign in with Google` button linking to `/v1/auth/google/start`;
- no email/password form;
- no guest mode;
- no developer bypass in development.

Test-only authentication is compiled only under `NODE_ENV=test` and unavailable in `pnpm dev` or production builds.

### Home page

Render:

- Google display name and email;
- `Continue Day 1` if an incomplete save exists;
- `Start Day 1` if none exists;
- `Replay Day 1` only after completion;
- `Log out`;
- `Remove account from this device` inside a secondary settings/details disclosure with an unsynced-work warning;
- no save-slot selection.

One account has one authoritative current save and may have completed attempt records.

### Play page

Render four regions:

1. top account bar with display name and Logout;
2. Archive strip with active tasks and non-numeric daylight bar;
3. append-only visible transcript;
4. current presenter control.

No debug state appears in the player UI.

When `VITE_ENABLE_DEBUG_PANEL=true`, a collapsible developer panel may show semantic IDs, state revisions, transaction IDs, legal set, and clock units. It must not expose correct answers before commit and must default off.

### Presenter mapping

```text
NARRATIVE          narrative-presenter
PROMPT             prompt-presenter
FOCUS_READ         focus-read-presenter
TIMING             timing-presenter
EFFORT_HOLD        hold-presenter
SORT               sort-presenter
PLACE              place-presenter
FREE_ROAM          free-roam-presenter
DAY_END            day-end-presenter
```

Rules:

- Every presenter uses IDs/data from `ExecutionPlan`.
- Choice button order is authored and immutable.
- Disabled/eliminated distractors remain visible but cannot be clicked.
- Directional correction displays the approved nudge and never the answer.
- All controls are keyboard accessible.
- No presenter calls game APIs directly; it sends presenter events to the worker.

---

## 11. Text mechanic controls

### Press timing

Render a horizontal meter from 0 to 100.

- Start marker at 0 moving right.
- Use `requestAnimationFrame`.
- Pass 1 speed: 45 units/second.
- On each edge reversal multiply speed by 1.25.
- `Pull` button captures the marker.
- Crisp: 45–55 inclusive.
- Usable: 30–44 or 56–70.
- Smudged: 0–29 or 71–100.
- One click ends the mechanic; waiting only makes it harder.
- Accessibility confirm mode emits `USABLE`.

Emit only:

```ts
{
  timingBucket: "CRISP" | "USABLE" | "SMUDGED",
  completedPhaseIds: ["PRESS_PULL_COMMITTED"],
  accessibilityTreatmentId: string
}
```

### Effort hold

- Pointer/key down starts.
- Hold for 800 milliseconds.
- Release early resets visible progress.
- Completion emits the declared phase.
- Cannot fail.

### Sort

- Render each object once.
- Player selects object then `Needs stamp` or `Does not`.
- Submit becomes enabled after all objects have a destination.
- Incorrect already-Understood submission plays its directional nudge and returns only incorrect objects for correction.
- Corrected state emits one terminal result.

### Place/tack

- Player selects one authored column.
- Then completes 800ms hold.
- Wrong already-Understood column receives nudge, is disabled, and requires another selection.

### Free roam

- Render narrative and neutral Continue only.
- If a gold objective is ignored in the future Three.js version, Archive redirect uses spatial movement state. In text mode, free-roam Continue always advances to the gold objective after the authored breather transcript.

---

## 12. Local database and encryption

Use one Dexie database named `project-archive-v1`.

Schema version 1:

```ts
db.version(1).stores({
  keys: "&keyId",
  profileCache: "&profileId, accountId, lastOpenedAt",
  saveRecords: "&saveId, profileId, revision, updatedAt",
  transactions: "&transactionId, saveId, resultingRevision",
  outbox: "++localSequence, &idempotencyKey, profileId, status, createdAt",
  packages: "&packageHash, packageId, installStatus, lastUsedAt",
  offlineGrants: "&profileId, expiresAt",
  logoutFences: "&accountId, createdAt"
})
```

### Encryption

On first install:

1. Generate non-exportable AES-GCM 256-bit `CryptoKey`.
2. Store it by structured clone in `keys` as `device-data-v1`.
3. Encrypt every `saveRecords` payload and outbox body separately with random 12-byte IV.
4. Additional authenticated data is UTF-8:

```text
PA.LOCAL.SAVE.v1|profileId|saveId|revision
```

5. Store IV + ciphertext, never plaintext state.

Logout locks the profile in memory. Profile decryption requires either a valid online application session or the matching unexpired device-bound offline grant described below.

Content packages are signed/public and do not require profile encryption.

### Offline cached-profile unlock

1. After an online Google session loads a profile, generate an ECDSA P-256 keypair with Web Crypto. The private key is non-exportable; the public key is exportable.
2. Store the private `CryptoKey` in `keys` using key ID `offline-signing:<profileId>`.
3. POST the public JWK to the offline-grant endpoint.
4. Verify the returned ES256 JWS with `__PA_OFFLINE_GRANT_PUBLIC_JWK__.publicJwk`.
5. Store the JWS in `offlineGrants`.
6. The service worker caches the app shell and exact signed package, never session/save API responses.

On offline reload:

1. Load unexpired grant, matching non-exportable private key, encrypted profile save, and verified package.
2. Verify JWS signature, issuer, audience, expiration, policy snapshot, profile ID, account ID, and `cnf.jkt`.
3. Sign a fresh 32-byte local challenge with the private key and verify it against the public JWK/thumbprint named by the grant.
4. If valid and no logout fence exists, unlock the profile AES key and resume locally.
5. Mark cloud sync paused; gameplay commits/outbox continue normally.

Offline grant cannot create/switch accounts, access another profile, refresh itself, or outlive 24 hours.

On explicit logout, delete that profile's offline-grant JWS and offline-signing private key but preserve encrypted saves/outbox/AES data key. A later Google login issues a new offline grant. `Remove account from this device` is a separate destructive control that warns about unsynced work, then deletes the profile's keys, grants, encrypted saves, transactions, and outbox.

---

## 13. PostgreSQL schema

Use UUID primary keys generated in Node with `crypto.randomUUID()`. Use `timestamptz`. Use `bytea` for hashes/tokens/seeds. Use `jsonb` only for versioned composite snapshots and compiled package metadata.

Create exactly these tables.

### `policy_snapshots`

```text
id text primary key
document jsonb not null
document_hash bytea not null check octet_length(document_hash) = 32
effective_at timestamptz not null
created_at timestamptz not null default now()
```

Rows are immutable. Local seed inserts exactly `DEV.LOCAL.v1`; it is a development policy and cannot be used for a student pilot.

Exact seeded document:

```json
{
  "id": "DEV.LOCAL.v1",
  "environment": "LOCAL_DEVELOPMENT_ONLY",
  "studentLinkedProductionUseAllowed": false,
  "openTextProcessingAuthorized": false,
  "openTextRetentionAuthorized": false,
  "rawVoiceRetentionAuthorized": false,
  "teacherReportingEnabled": false,
  "researchExportEnabled": false,
  "localRetentionDays": 30
}
```

### `accounts`

```text
id uuid primary key
role text not null default 'STUDENT' check role = 'STUDENT'
created_at timestamptz not null default now()
disabled_at timestamptz null
```

### `external_identities`

```text
id uuid primary key
account_id uuid not null references accounts(id) on delete cascade
issuer text not null
subject text not null
email text not null
email_verified boolean not null
display_name text not null
picture_url text null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
unique (issuer, subject)
```

### `profiles`

MVP rule: exactly one student profile per account.

```text
id uuid primary key
account_id uuid not null unique references accounts(id) on delete cascade
display_name text not null
variation_root_seed bytea not null check octet_length(variation_root_seed) = 32
policy_snapshot_id text not null references policy_snapshots(id)
created_at timestamptz not null default now()
deleted_at timestamptz null
```

### `oauth_login_attempts`

```text
id uuid primary key
state_hash bytea not null unique
nonce_hash bytea not null
pkce_verifier_encrypted bytea not null
created_at timestamptz not null
expires_at timestamptz not null
used_at timestamptz null
```

PKCE verifier is encrypted with `LOCAL_DATA_ENCRYPTION_SECRET` using AES-256-GCM.

### `refresh_sessions`

```text
id uuid primary key
account_id uuid not null references accounts(id) on delete cascade
family_id uuid not null
token_hash bytea not null unique
csrf_hash bytea not null
user_agent_hash bytea not null
created_at timestamptz not null
last_used_at timestamptz not null
idle_expires_at timestamptz not null
absolute_expires_at timestamptz not null
rotated_to_id uuid null
revoked_at timestamptz null
```

Index `(account_id, family_id)`.

### `access_sessions`

```text
id uuid primary key
account_id uuid not null references accounts(id) on delete cascade
refresh_session_id uuid not null references refresh_sessions(id) on delete cascade
token_hash bytea not null unique
csrf_hash bytea not null
created_at timestamptz not null
expires_at timestamptz not null
revoked_at timestamptz null
```

Index `(account_id, expires_at)`.

### `offline_grants`

```text
id uuid primary key
account_id uuid not null references accounts(id) on delete cascade
profile_id uuid not null references profiles(id) on delete cascade
public_key_jwk jsonb not null
public_key_thumbprint text not null
policy_snapshot_id text not null
created_at timestamptz not null
expires_at timestamptz not null
revoked_at timestamptz null
unique (profile_id, public_key_thumbprint)
```

Index `(profile_id, expires_at)`.

### `content_packages`

```text
package_hash bytea primary key check octet_length(package_hash) = 32
package_id text not null
package_version text not null
release_sequence bigint not null
manifest jsonb not null
compiled_payload jsonb not null
installed_at timestamptz not null default now()
unique (package_id, package_version)
```

### `save_heads`

```text
save_id uuid primary key
profile_id uuid not null references profiles(id) on delete cascade
package_hash bytea not null references content_packages(package_hash)
schema_version text not null
revision bigint not null
snapshot jsonb not null
snapshot_hash bytea not null check octet_length(snapshot_hash) = 32
current_attempt_id uuid null
completed_at timestamptz null
created_at timestamptz not null
updated_at timestamptz not null
unique (profile_id)
```

The unique profile constraint enforces one authoritative current save in MVP.

### `save_transactions`

```text
transaction_id uuid primary key
save_id uuid not null references save_heads(save_id) on delete cascade
parent_revision bigint not null
resulting_revision bigint not null
request_hash bytea not null
result_snapshot_hash bytea not null
created_at timestamptz not null
unique (save_id, resulting_revision)
```

### `chapter_attempts`

```text
id uuid primary key
profile_id uuid not null references profiles(id) on delete cascade
chapter_id text not null
attempt_start_sequence bigint not null
attempt_seed bytea not null check octet_length(attempt_seed) = 16
package_hash bytea not null references content_packages(package_hash)
status text not null check status in ('ACTIVE','COMPLETED','ABANDONED')
started_at timestamptz not null
completed_at timestamptz null
unique (profile_id, chapter_id, attempt_start_sequence)
```

### `replay_profiles`

```text
profile_id uuid primary key references profiles(id) on delete cascade
revision bigint not null
state jsonb not null
state_hash bytea not null
updated_at timestamptz not null
```

### `learner_evidence_events`

```text
id uuid primary key
profile_id uuid not null references profiles(id) on delete cascade
transaction_id uuid not null references save_transactions(transaction_id)
concept_id text not null
evidence_event_id text not null
action_id text not null
occasion_key text not null
exposure_type text null
rule_version text not null
payload jsonb not null
created_at timestamptz not null
unique (profile_id, evidence_event_id)
```

### `telemetry_events`

```text
idempotency_key text primary key
profile_id uuid null references profiles(id) on delete set null
chapter_attempt_id uuid null references chapter_attempts(id) on delete set null
event_type text not null
consent_class text not null
package_hash bytea not null
payload jsonb not null
created_at timestamptz not null
```

General telemetry payload validation rejects raw response text, email, display name, Google subject, seeds, and hidden learner labels.

---

## 14. API contract

All responses use:

```ts
type ApiSuccess<T> = { ok: true; data: T }
type ApiFailure = {
  ok: false
  error: {
    code: string
    message: string
    requestId: string
  }
}
```

Never return stack traces.

API defaults:

- generate/echo `X-Request-Id` as UUID;
- `@fastify/helmet` enabled with defaults, except CSP permits only the localhost client/API and Google authorization navigation required by the redirect flow;
- body limit 2 MiB for save sync, 64 KiB for all other JSON routes;
- reject unknown JSON fields through Zod strict objects;
- exact Origin allowlist: `http://localhost:5173` in development;
- rate limits:
  - Google start: 20 requests/minute/IP;
  - Google callback: 30 requests/minute/IP;
  - session refresh: 60 requests/minute/session family;
  - save upload: 120 requests/minute/profile;
  - all other authenticated routes: 300 requests/minute/account.

### `GET /v1/health`

Returns API/database/package readiness.

### `GET /v1/session`

Returns:

```ts
{
  account: {
    id: string
    displayName: string
    email: string
    pictureUrl?: string
  }
  profile: {
    id: string
    displayName: string
  }
  csrfToken: string
}
```

Returns 401 when access/refresh cannot establish a session.

### `POST /v1/session/refresh`

Rotates sessions. Empty JSON request body.

### `POST /v1/logout`

Revokes current token family. Empty JSON request body.

### `GET /v1/profiles/:profileId/save`

Authorization: profile must be owned by session account.

Returns current save or `data: null`.

### `POST /v1/profiles/:profileId/day1-attempts`

Creates a new Day 1 save only if no incomplete save exists.

Request:

```ts
{ mode: "INITIAL" | "REPLAY" }
```

Response contains `saveId`, revision `0`, package hash, and encrypted-client bootstrap snapshot.

### `POST /v1/profiles/:profileId/offline-grants`

Authorization: owned profile, current access session, CSRF.

Request:

```ts
{
  publicKeyJwk: {
    kty: "EC"
    crv: "P-256"
    x: string
    y: string
  }
}
```

The API validates the JWK, computes its RFC 7638 thumbprint, stores the `offline_grants` row, and signs an ES256 compact JWS containing:

```ts
{
  iss: "project-archive-api"
  aud: "pa-web-offline"
  sub: accountId
  profileId: string
  grantId: string
  policySnapshotId: "DEV.LOCAL.v1"
  cnf: { jkt: string }
  iat: number
  exp: number
}
```

`exp = iat + OFFLINE_GRANT_TTL_SECONDS`.

Response:

```ts
{
  grant: string
  expiresAt: string
}
```

### `PUT /v1/profiles/:profileId/saves/:saveId`

Headers:

```text
If-Match: "<parent revision>"
Idempotency-Key: "<transaction UUID>"
X-CSRF-Token: "<csrf cookie value>"
```

Body:

```ts
{
  parentRevision: string
  resultingRevision: string
  packageHash: string
  snapshot: SaveRecord
  snapshotHash: string
  evidenceEvents: EvidenceEvent[]
  replayDeltas: ReplayDelta[]
  telemetryEvents: TelemetryEvent[]
}
```

Rules:

- Verify body profile/save IDs.
- Verify revision increments by exactly one.
- Verify package hash pinned by attempt.
- Verify snapshot hash from canonical serialization.
- Apply save head, transaction, evidence, replay, and telemetry in one PostgreSQL transaction.
- Duplicate Idempotency-Key returns original committed response.
- Revision conflict returns 409 with current server revision; never field-merge.

### `GET /v1/content/day1`

Returns the signed compiled package envelope. It is public but signature verified by client/runtime.

---

## 15. Save ownership and synchronization

The runtime worker is locally authoritative during play. Every committed action:

1. creates one semantic `StateTransaction`;
2. atomically writes encrypted SaveRecord, transaction record, and outbox item in Dexie;
3. publishes the new state to the UI;
4. asynchronously uploads the outbox item.

Save serialization:

- every revision/ordinal/u64 is a canonical unsigned decimal string;
- bytes are lowercase base64url without padding;
- timestamps are UTC RFC 3339 strings;
- no `Date`, `Map`, `Set`, class instance, function, DOM value, or Three.js value appears;
- canonical bytes are `UTF8(jsonCanonicalize(saveRecord))`;
- `snapshotHash = SHA-256(canonical bytes)`;
- local encryption wraps those same canonical bytes, so local/cloud hashes identify identical semantic saves.

The UI never waits for upload.

On login:

1. load local profile cache;
2. fetch cloud save;
3. compare revision and transaction ancestry;
4. if one is a strict ancestor, choose the descendant;
5. if diverged, stop play and display a deterministic conflict screen preserving both records. Do not merge.

On logout offline, local save remains and outbox status stays `PENDING`.

---

## 16. Day 1 global constants

Use these values exactly:

```ts
const DAY1_CLOCK = {
  start: 0,
  firstWarning: 14,
  secondWarning: 19,
  finalWarning: 22,
  fixedEventBoundary: 24
} as const

const RELATIONSHIP_RANGE = { min: 0, max: 100 } as const

const BASELINES = {
  abigailTrust: 35,
  abigailRespect: 35,
  abigailWarmth: 35,
  thomasObligation: 0,
  pikeRespect: 35,
  clarkePoliticalRead: 0,
  riderTrust: 35
} as const

const SYNC_RULES = {
  minimumInteractionsBetweenSyncs: 2,
  initialUnderstandingReexposureCycles: 1,
  maximumCorrectionSteps: 2
} as const

const REDIRECT_RULES = {
  textFreeRoamContinuesBeforeRedirect: 1,
  threeJsGraceSeconds: 7
} as const
```

### Standard time costs

```ts
const TIME_COST = {
  traversal: 0,
  neutralContinue: 0,
  shortDialogue: 1,
  focusRead: 1,
  archiveSyncQuestion: 1,
  simpleHandoff: 1,
  effortInteraction: 2,
  gradedPressPull: 2,
  longHelp: 3,
  fullReprintLoop: 5,
  waitForGap: 2,
  quickHandoff: 1
} as const
```

An ActionSpec must bind one of these values explicitly. It cannot derive cost from rendered duration.

---

## 17. Determinism and seeds

For a new profile:

- generate exactly 32 CSPRNG bytes as variation root seed;
- never expose it through UI/API telemetry.

For a new chapter attempt:

```text
attempt_seed =
leftmost_16_bytes(
  HMAC-SHA-256(
    variation_root_seed,
    PA.RUN.SEED.v1 canonical message from Backend-AI-System
  )
)
```

The text and future Three.js presenters must receive identical results for identical semantic MechanicResult fields.

Use no `Math.random()` anywhere in runtime packages. ESLint must forbid it under `packages/`.

---

## 18. Error behavior

Use these player-safe errors:

```text
AUTH_REQUIRED
AUTH_CALLBACK_FAILED
PROFILE_FORBIDDEN
SAVE_CONFLICT
PACKAGE_MISSING
PACKAGE_INVALID
SAVE_INVALID
RUNTIME_DEADLOCK
PRESENTER_PROTOCOL_ERROR
```

Rules:

- Authentication errors return to login.
- Package invalid/missing blocks play; never use unverified content.
- Save conflict preserves both versions.
- Runtime deadlock is a fatal test failure and player-safe error; never invent an action.
- Presenter protocol error restores the last committed checkpoint.

---

## 19. Required implementation order

The implementer must complete tickets in this exact order. Do not start a later ticket while an earlier ticket's tests fail.

1. Root workspace/toolchain/config files.
2. Shared ID, canonical serialization, execution, state, and API contracts.
3. PostgreSQL Docker service, Drizzle schema, migration, and DB connection.
4. Google OAuth login attempts, account/profile creation, sessions, CSRF, logout.
5. Profile/save API authorization and idempotent save transaction.
6. Dexie schema, encryption, local transaction, and outbox.
7. Device-bound offline grant, service worker, cold offline unlock, and logout removal.
8. Package schema, compiler, dev key generation, signing, verification.
9. World State reducers: clock, objectives, relationships, consequences.
10. Learner reducers: exposure, 3/2 gate, Understanding retry, Notes, demonstration correction.
11. Replay seed/state.
12. Deterministic selector and outcome resolver with golden vectors.
13. Event Manager, Archive queue, transactions, resume token, PreparedFrontier.
14. Runtime Web Worker protocol.
15. Text presentation adapter and all presenter controls.
16. Exact Day 1 content fixture.
17. Day 1 fully avoidant model checker.
18. Google multi-account Playwright flow, offline unlock, and save isolation tests.
19. Save-at-every-boundary resume tests.
20. README localhost setup and final clean-clone verification.

---

## 20. Forbidden implementation decisions

The implementer may not:

- put game branching logic in React components;
- put game branching logic in API route handlers;
- call an LLM;
- add guest login;
- add passwords;
- add multiple manual save slots;
- use email as account identity;
- store Google access/refresh tokens after ID verification;
- use unsigned Day 1 content;
- use `Math.random()` for gameplay;
- let a presenter apply state;
- let the API choose the next action;
- silently merge divergent saves;
- treat ambient chatter as tracked learning;
- skip B11.5 deficit closure;
- add a fourth choice;
- add a second re-exposure loop;
- change Day 1 dialogue/choices to simplify coding;
- make the text client schema incompatible with Three.js;
- use the legacy Python simulator as canonical behavior;
- mark implementation complete without the fully avoidant and save-boundary proofs.

---

## 21. Secrets and legitimate blockers

The implementer must stop and report only when:

- Google client ID/secret are missing;
- Docker/PostgreSQL cannot run;
- required Node/pnpm versions cannot be installed;
- `Day-1.md` contains a direct contradiction not resolved by this directive;
- a cryptographic/package verification test proves the specified format internally inconsistent.

Everything else is an engineering task to complete without requesting a product decision.

### 21A. Development package build

`pnpm keys:dev`:

- creates `.local/keys/` when absent;
- generates Ed25519 keypair with Node `generateKeyPairSync("ed25519")`;
- writes PKCS8 private PEM and SPKI public PEM;
- never overwrites an existing key;
- chmods the private file to `0600`.

`pnpm keys:offline`:

- uses `jose.generateKeyPair("ES256", { extractable: true })`;
- writes PKCS8 private PEM to `.local/keys/offline-es256-private.pem`;
- writes the public JWK plus RFC 7638 thumbprint as JSON to `.local/keys/offline-es256-public.jwk.json`;
- never overwrites existing keys;
- chmods the private file to `0600`;
- this key is distinct from the Ed25519 content-signing key.

`pnpm content:compile`:

1. imports typed source records from `content/boston-day1/source`;
2. validates every source record with Zod;
3. compiles immutable ActionSpecs;
4. runs graph/curriculum/objective/prompt/fallback validation;
5. canonicalizes the unsigned manifest with `json-canonicalize@2.0.0`;
6. computes SHA-256 package hash;
7. signs the Backend-AI-System detached envelope with the development private key;
8. writes:

```text
content/boston-day1/compiled/package.json
content/boston-day1/compiled/validation-report.json
content/boston-day1/compiled/package-hash.txt
```

The development public key is loaded from the configured path by API/runtime verification. The private key is never served or included in compiled output.

`validation-report.json` contains explicit PASS/FAIL records for every compiler gate. Any FAIL exits nonzero and writes no signed package.

At Vite startup, `vite.config.ts` reads the development **public** key file and injects it as compile-time constant `__PA_PACKAGE_PUBLIC_KEY_PEM__`. Startup fails if the key is absent. The private key is never read by Vite.

Client package install:

1. Fetch `/v1/content/day1`.
2. Validate envelope fields with Zod.
3. Canonicalize the unsigned manifest using the same package.
4. Recompute package hash.
5. Verify Ed25519 detached signature with `__PA_PACKAGE_PUBLIC_KEY_PEM__`.
6. Validate compiled payload hash/schema/engine version.
7. In one Dexie transaction write package bytes, `installStatus=VERIFIED`, and package hash.
8. Pass only verified bytes to the runtime worker.

Any mismatch produces `PACKAGE_INVALID` and blocks play.

---

## 22. Day 1 identifiers and initial state

Use these exact IDs.

### Package hierarchy

```text
package_id       PA.BOSTON.DAY1.TEXT.v1
season_id        PA.SEA01.COLONIES.v1
chapter_id       PA.SEA01.CH02.BOSTON.v1
mission_day_id   PA.SEA01.CH02.BOSTON.MD01.v1
```

### Concepts

```text
BOS.MD01.CONCEPT.POSTWAR_REVENUE.v1
BOS.MD01.CONCEPT.STAMP_SCOPE.v1
BOS.MD01.CONCEPT.REPRESENTATION.v1
```

### Relationships

```text
BOS.CHAR.ABIGAIL.TRUST.v1
BOS.CHAR.ABIGAIL.RESPECT.v1
BOS.CHAR.ABIGAIL.WARMTH.v1
BOS.CHAR.THOMAS.OBLIGATION.v1
BOS.CHAR.PIKE.RESPECT.v1
BOS.CHAR.CLARKE.POLITICAL_READ.v1
BOS.CHAR.RIDER.TRUST.v1
```

### Job objects

```text
BOS.MD01.OBJ.THOMAS_CIRCULAR.v1
BOS.MD01.OBJ.PIKE_PROOF.v1
BOS.MD01.OBJ.CARRIER_HANDBILLS.v1
BOS.MD01.OBJ.CUSTOMHOUSE_NOTICE.v1
BOS.MD01.OBJ.PLAIN_WRAP.v1
BOS.MD01.OBJ.RETAINED_STAMP_FORM.v1
BOS.MD01.OBJ.RETAINED_POLICY_SOURCE.v1
BOS.MD01.OBJ.RETAINED_REPRESENTATION_SOURCE.v1
```

### Objective groups

```text
BOS.MD01.OBJECTIVES.OPENING.v1          MUST_COMPLETE_ALL
BOS.MD01.OBJECTIVES.ERRANDS.v1          MUST_COMPLETE_ALL
BOS.MD01.OBJECTIVES.RIDER_ROUTE.v1      CHOOSE_ONE
BOS.MD01.OBJECTIVES.EVENT_ONRAMP.v1     CHOOSE_ONE
BOS.MD01.OBJECTIVES.CLOSE.v1            MUST_COMPLETE_ALL
```

The four errand markers are **not a PromptSpec/options screen**. They are members of one objective group and may all appear blue simultaneously. The three-choice cap applies to a single PromptSpec, not to the Today strip/world-marker set.

### Initial World State

```ts
const initialDay1WorldState = {
  revision: "0",
  locationId: "ARCHIVE_TRANSIT",
  controlState: "ARCHIVE",
  clock: {
    spentUnits: 0,
    fixedEventBoundary: 24,
    warningStage: "NONE",
    phase: "MORNING"
  },
  currentInteractionOrdinal: 0,
  lastSyncCompletionInteractionOrdinal: null,
  firstErrandCompletionRecorded: false,
  fixedEvent: "NOT_STARTED",
  objectives: {
    REPORT_TO_MERCER: "ACTIVE",
    THOMAS_CIRCULAR: "NOT_YET_ELIGIBLE",
    PIKE_PROOF: "NOT_YET_ELIGIBLE",
    RIDER_HANDBILLS: "NOT_YET_ELIGIBLE",
    CUSTOMHOUSE_NOTICE: "NOT_YET_ELIGIBLE",
    OBSERVE_CROWD: "NOT_YET_ELIGIBLE",
    RETURN_TO_PRESS: "NOT_YET_ELIGIBLE",
    SET_HEADLINE: "NOT_YET_ELIGIBLE"
  },
  jobObjects: {
    THOMAS_CIRCULAR: { custody: "ABIGAIL", condition: "INTACT" },
    PIKE_PROOF: { custody: "ABIGAIL", condition: "UNPRINTED" },
    CARRIER_HANDBILLS: { custody: "ABIGAIL", condition: "INTACT", concealment: "EXPOSED" },
    CUSTOMHOUSE_NOTICE: { custody: "ABIGAIL", condition: "INTACT" },
    PLAIN_WRAP: { custody: "ABIGAIL", condition: "INTACT" }
  },
  relationships: {
    ABIGAIL_TRUST: 35,
    ABIGAIL_RESPECT: 35,
    ABIGAIL_WARMTH: 35,
    THOMAS_OBLIGATION: 0,
    PIKE_RESPECT: 35,
    CLARKE_POLITICAL_READ: 0,
    RIDER_TRUST: 35
  },
  routes: {
    THOMAS_DOCK_ROUTE: "LOCKED"
  },
  attention: {
    watcherHeat: 0,
    clarkeInformed: false,
    recognized: false
  },
  pendingContingentEffects: [],
  realizedHiddenEffects: []
} as const
```

### Initial Learner State

For each of the three concept IDs:

```ts
{
  exposures: [],
  distinctOccasionCount: 0,
  exposureTypes: [],
  learningGate: "NOT_READY",
  understanding: "NOT_ASSESSED",
  firstUnderstandingAttemptCount: 0,
  pendingReexposure: null,
  notesAddedTransactionId: null,
  demonstration: "LOCKED",
  priorDayReassessment: "NOT_DUE",
  misconceptionIds: []
}
```

---

## 23. Day 1 tracked exposure registry

Only these authored exposure IDs may increment the initial 3/2 gates.

### Postwar revenue policy

```text
POLICY.B0.ARCHIVE_ARTICLE_SCENE          SCENE          mandatory
POLICY.B6.PIKE_WAR_DEBT_LINE             CONVERSATION   conditional on reaching Pike
POLICY.B7_5.CROWN_PROCLAMATION           ARTICLE        explicit focus-read
POLICY.B11_5.RETAINED_DEBT_SOURCE        HANDS_ON       mandatory only when deficit
POLICY.B11_5.ABIGAIL_CAUSE_LINE          CONVERSATION   mandatory only when deficit
```

### Stamp scope

```text
STAMP.B3.PROOF_COMPARISON                HANDS_ON       mandatory
STAMP.B4_5.OFFICIAL_NOTICE               ARTICLE        explicit focus-read
STAMP.B6.PIKE_SCOPE_LINE                 CONVERSATION   conditional on reaching Pike
STAMP.B9.OFFICER_STAMP_LINE              CONVERSATION   only when B9 line actually plays
STAMP.B11_5.RETAINED_FORM_COMPARE        HANDS_ON       mandatory only when deficit
STAMP.B11_5.ABIGAIL_FEE_DISTINCTION      CONVERSATION   mandatory only when deficit
```

### Representation

```text
REP.B5_5.FRESH_BROADSIDE                 ARTICLE        explicit focus-read
REP.B5.THOMAS_CONSENT_LINE               CONVERSATION   help/ask branch only
REP.B7.CONCEALED_HANDBILL                HANDS_ON       calm-cover/conceal branch only
REP.B10_4.CROWD_BOARD                    ARTICLE        explicit focus-read
REP.B11.EVENT_BANNER                     SCENE          mandatory
REP.B11_5.TOWN_INSTRUCTION_SOURCE        HANDS_ON       mandatory only when deficit
REP.B11_5.ABIGAIL_NO_MEMBER_LINE          CONVERSATION   mandatory only when deficit
```

Rules:

- An exposure ID commits once per attempt.
- B0 is `SCENE`, even though a real article is shown.
- Focus-read commits on read-panel open, not on seeing the prompt.
- Ambient lines never use IDs from this registry.
- B11.5 chooses the minimum unused entries needed to reach count 3 and type count 2.

### Post-Sync re-exposure registry

These IDs never count retroactively toward the initial 3/2 gate and may fire only after the concept's initial failed Sync transaction:

```text
POLICY.RETRY.SECOND_DEBT_EXCERPT          ARTICLE
STAMP.RETRY.COVERED_ITEMS_SCHEDULE        HANDS_ON
REP.RETRY.MASSACHUSETTS_INSTRUCTION       ARTICLE
```

Each concept may commit at most one retry exposure.

---

## 24. Day 1 relationship reducers

### Abigail Respect from press

Apply immediately because Abigail witnesses the work:

```text
CRISP      -> 45
USABLE     -> 35
SMUDGED    -> 25
```

### Pike Respect

Press quality creates a contingent effect. It does not move Pike before meeting.

At Pike:

```text
CRISP proof                    -> 45
USABLE proof                   -> 35
SMUDGED proof before response  -> 20
```

Smudged response:

```text
reprint, new result CRISP      -> 50
reprint, new result USABLE     -> 45
reprint, new result SMUDGED    -> 25
own it, let it stand           -> 35
brush it off                   -> 15
```

If Pike is missed at closure, expire the contingent effect and leave Pike at 35.

### Thomas Obligation

```text
help haul cloth    -> 40 and unlock THOMAS_DOCK_ROUTE
beg off            -> 0
ask only           -> 0
```

### Clarke Political Read

Centered scale is -100 harmless/ally to +100 threat.

```text
calm cover + conceal   -> -20, clarkeInformed=false
curt refusal           -> +35, clarkeInformed=true
hear him out           -> +10, clarkeInformed=false
```

### Rider/network Trust

```text
delivered unseen       -> 50
delivered recognized   -> 40
delivered damaged      -> 30
missed/confiscated     -> 20
```

### Abigail Trust at return

Errand outcomes record causes but do not move Abigail Trust on the street. At B11.5 return:

```text
4 errands completed successfully       -> 50
exactly 1 missed/failed/refused         -> 25
2 or more missed/failed/refused         -> 15
```

Recognized/damaged delivery still counts as completed for reliability; its separate world/network consequence remains.

Abigail Warmth remains 35 in this text fixture because Day 1 currently defines no completed warmth-bearing choice. The B13 warmth branch remains closed.

### Exact displayed effect tags

```text
THOMAS / HELP             costs time · earns a favor
THOMAS / BEG_OFF          saves time · no favor earned
THOMAS / ASK              no tags

PIKE / REPRINT            costs time · earns respect
PIKE / OWN_IT             earns respect
PIKE / BRUSH_OFF          loses respect

RIDER ROUTE / MAIN_FAST   saves time · risky
RIDER ROUTE / BACK_LANES  costs time · safe
RIDER ROUTE / DOCK_ROUTE  saves time · safe

CLARKE / CALM_CONCEAL     reads as harmless
CLARKE / CURT             risky · reads as a threat
CLARKE / HEAR_OUT         no tags

CUSTOMS / COMPLY          risky
CUSTOMS / TALK            risky
CUSTOMS / SLIP            risky · draws attention

RIDER / QUICK             saves time · risky
RIDER / WAIT_FOR_GAP      costs time · safe

EVENT / CLIMB             costs a little time · safe
EVENT / PUSH              risky · draws attention
EVENT / CHANT             reads as sympathy
```

Focus reads, Archive Sync answers, correction choices, source-desk work, and headline evidence answers carry no relationship/risk tags. Routine clock cost is not shown as a tag unless the list above explicitly says `costs time`/`saves time`.

---

## 25. Day 1 understanding prompts

The scheduler may present a concept's first Sync only when:

- initial count is at least 3;
- exposure type count is at least 2;
- no foreground/anchor/fixed-event lock is active;
- at least two committed, `countsForSyncSpacing=true` interactions have occurred since the previous Sync completion.

Pending concept priority is:

```text
STAMP_SCOPE
REPRESENTATION
POSTWAR_REVENUE
```

### Stamp Sync

Archive frame:

```text
Before I file, what is that stamp, really?
```

Choices:

```text
STAMP_SYNC.SHOP_CHARGE
A charge Mercer's shop adds to the paper.

STAMP_SYNC.PUNISHMENT
Something Boston was hit with for stirring up trouble.

STAMP_SYNC.CROWN_TAX            TARGET
A tax the Crown put on printed and legal paper.
```

### Representation Sync

Archive frame:

```text
That banner said, "We were never asked." What are they actually angry about?
```

Choices:

```text
REP_SYNC.ALL_TAXES
The Crown raising taxes at all.

REP_SYNC.NO_ELECTED_VOICE       TARGET
Being taxed by a Parliament they elected no one to.

REP_SYNC.OLIVER_PERSONAL
Andrew Oliver personally.
```

### Policy Sync

Archive frame:

```text
Why does London want money from these colonies in the first place?
```

Choices:

```text
POLICY_SYNC.PUNISH_MOB
To punish Boston for the mob at the elm.

POLICY_SYNC.WAR_DEBT            TARGET
To pay debt from the war Britain just fought.

POLICY_SYNC.COLONIES_RICH
Because the colonies had become rich enough to afford it.
```

### Initial miss and retry

On the initial miss:

- commit no Notes entry;
- show no `wrong`/negative label;
- set `REEXPOSURE_REQUIRED`;
- enqueue the concept's exact retry exposure from §23;
- after retry exposure and two spacing interactions, present the same prompt and authored choice order once.

On retry miss:

- show the concept/choice-specific directional nudge;
- disable the selected distractor;
- require another selection;
- disable each newly selected distractor;
- finish as `UNDERSTOOD`;
- add Notes exactly once.

Exact ActionSpecs:

```text
BOS.MD01.ACT.SYNC.STAMP.INITIAL.v1
BOS.MD01.ACT.SYNC.STAMP.RETRY.v1
BOS.MD01.ACT.SYNC.REPRESENTATION.INITIAL.v1
BOS.MD01.ACT.SYNC.REPRESENTATION.RETRY.v1
BOS.MD01.ACT.SYNC.POLICY.INITIAL.v1
BOS.MD01.ACT.SYNC.POLICY.RETRY.v1
```

Every Sync:

- presenter `PROMPT`;
- clock `ADD(1)` before the fixed event and `ADD(0)` after it;
- does not increment the interaction ordinal used to space Syncs;
- initial pass writes one Notes entry;
- retry correction pass writes the same Notes entry only if it does not already exist.

Retry directional nudges:

```text
STAMP / SHOP_CHARGE:
Mercer charges for her work. Who requires the stamp?

STAMP / PUNISHMENT:
The law was written before tonight's crowd. What kind of charge does Pike describe?

REPRESENTATION / ALL_TAXES:
Thomas said it wasn't only the shilling. What did Boston lack in Parliament?

REPRESENTATION / OLIVER_PERSONAL:
Oliver distributes the stamp. Who made the law?

POLICY / PUNISH_MOB:
The tax came before tonight's mob. What expense was London already carrying?

POLICY / COLONIES_RICH:
Look back to the war account. What debt followed it?
```

Notes entries:

```text
Stamp Act:
The Stamp Act required paid stamps on covered printed and legal paper beginning 1 November 1765.

Representation:
Colonists objected that Parliament taxed them even though they elected no representatives to it.

Postwar revenue policy:
After the French and Indian War, British debt helped drive Parliament to seek more colonial revenue.
```

---

## 26. Day 1 demonstration targets

### Stamp demonstration

At Pike when Stamp is already Understood; otherwise at B12 evidence pin.

Sort:

```text
deed                 NEEDS_STAMP
court writ           NEEDS_STAMP
printed newspaper    NEEDS_STAMP
personal letter      DOES_NOT
wooden tool          DOES_NOT
```

Wrong submission nudge:

```text
Would the Crown fuss over what a man writes to his own sister?
Think which of these is printed, or made official.
```

Return only mis-sorted items for correction.

### Policy demonstration

At Custom House only if Policy is Understood before posting; otherwise B12 cause line.

```text
By order of Parliament, to raise revenue from the colonies.   TARGET
By the printers' guild.
For the town's own use.
```

Wrong-choice nudge:

```text
That names who handles the paper, not why London wants the money.
```

### Representation demonstration

B12 headline:

```text
MOB WRECKS STAMP OFFICE
BOSTON WON'T PAY THE TAX
TAXED WITHOUT A VOICE             TARGET
```

Nudges:

```text
MOB WRECKS STAMP OFFICE:
That tells people what the crowd did. What made them gather?

BOSTON WON'T PAY THE TAX:
Cost mattered. What did they say they never had?
```

### B12 policy cause line

```text
By order of Parliament, to raise revenue after the war.       TARGET
A printing fee, added by the shop.
After a mob burned the stamp man in effigy.
```

Nudges:

```text
SHOP FEE:
That's my fee, not the Crown's reason. Why would London suddenly need money from the likes of us?

EFFIGY:
That happened after the tax. What came before it?
```

### B12 Stamp evidence pin

```text
A court deed                         TARGET
Thomas's personal letter
A carpenter's wooden ruler
```

Nudges:

```text
PERSONAL LETTER:
Thomas wrote that by hand for one person. Think about the official papers on Pike's desk.

WOODEN RULER:
That's a tool, not a printed or legal paper.
```

---

## 27. Day 1 outcome policies

Use integer weights with the canonical HMAC outcome resolver.

```text
B8_MAIN_FAST
  CLEAR             75
  STOP_TRIGGERED    25

B9_COMPLY_CONCEALED
  PASS              90
  RECOGNIZED        10

B9_TALK_NORMAL
  PASS              70
  SEARCH            30

B9_TALK_INFORMED
  PASS              35
  SEARCH            65

B9_SLIP
  ESCAPE            65
  CAUGHT            35

B10_QUICK_LOW_HEAT
  DELIVERED_UNSEEN       90
  DELIVERED_RECOGNIZED   10

B10_QUICK_HIGH_HEAT
  DELIVERED_UNSEEN       65
  DELIVERED_RECOGNIZED   35
```

Deterministic rules override draws:

- B9 comply with exposed handbills -> confiscated.
- B9 search/caught with exposed handbills -> confiscated.
- B9 search/caught with concealed handbills -> recognized and creased, not confiscated.
- Any successful rider transfer of creased handbills -> delivered damaged; recognition remains a separate attention flag and Rider Trust resolves to 30.
- Rider wait-for-gap before boundary -> delivered unseen.
- Rider action reaching boundary before transfer -> missed.
- Confiscated handbills -> rider objective failed and cannot be restored.

---

## 28. Day 1 objective and event rules

### Four errands

After B4:

- all four errand markers/strip lines become blue;
- selecting one makes it gold and temporarily hides the other three;
- completion resolves it and resurfaces remaining pending errands;
- the last remaining errand becomes gold automatically;
- the text client renders objective markers separately from PromptSpec choices.

### B4.5

Before entering the first selected errand, offer the official Stamp notice once. Read or skip.

### B5.5

Immediately after the first errand terminal outcome, offer the newly pasted representation broadside once. Read or skip.

### Dusk closure

After every committed action:

1. apply clock effect;
2. if spent units cross 14/19/22, enqueue the matching warning;
3. if spent units reach 24, let the active action commit its safe phase/terminal result;
4. remove optional actions;
5. present must-acknowledge shops-closed action;
6. resolve every unfinished errand to its declared missed/failed terminal state;
7. enter the same B10.4 crowd free-roam/board funnel used by the completed-errands path;
8. make the fixed crowd event mandatory after that funnel; it cannot be postponed by returning to errands.

### Early errand completion

If all four errands become terminal before unit 24:

1. run B10.4 free roam and optional board;
2. run B10.5 synthesis/catch-up if eligible;
3. present `BOS.MD01.ACT.OBSERVE_CROWD_FORMING.v1`;
4. that action uses clock effect `ADVANCE_TO_FIXED_EVENT_BOUNDARY`;
5. start B11.

This is an authored observation/waiting activity, not traversal time.

### Event on-ramp

Prompt:

```text
Climb for a clear vantage.
Push toward the front.
Take up the chant.
```

All three use effort-tier presenters and converge on the same mandatory event/banner carrier.

Local consequences:

```text
CLIMB     attention unchanged
PUSH      watcherHeat +1
CHANT     political sympathy flag true
```

The historical event content and outcome are identical.

---

## 29. B11.5 deficit closure algorithm

On return after B11, iterate concepts in priority:

```text
STAMP_SCOPE
REPRESENTATION
POSTWAR_REVENUE
```

For each:

1. calculate missing occasion count;
2. calculate whether a second type is missing;
3. select the smallest unused fallback sequence from §23 that fills both;
4. present each fallback as mandatory gold source-desk work;
5. after each commit, run Sync scheduler;
6. do not present a fallback when the concept already satisfies 3/2;
7. do not change missed objective/object/relationship consequences.

If a first-understanding miss exists:

1. present its reserved retry exposure;
2. present the next unused occupational spacer from the fixed list below until the two-interaction spacing threshold is met;
3. run the retry;
4. on second miss, correct in place.

Late Sync spacer order:

```text
BOS.MD01.ACT.FILE_POLICY_SOURCE.v1
BOS.MD01.ACT.FILE_STAMP_SOURCE.v1
BOS.MD01.ACT.FILE_REP_SOURCE.v1
BOS.MD01.ACT.SORT_TYPE_LEADS.v1
BOS.MD01.ACT.PREPARE_TYPE_CASE.v1
BOS.MD01.ACT.INK_PRESS_BED.v1
BOS.MD01.ACT.CUT_PROOF_PAPER.v1
BOS.MD01.ACT.SET_PRESS_CHASE.v1
```

Each may run once. They are effort holds for real page-preparation work, expose an already-seen source/label as untracked reinforcement, cost no authoritative clock units after the fixed event, count for Sync spacing, and cannot change relationships or concept gates. The scheduler uses only the minimum unused actions needed; package validation proves the pool is large enough for every legal late-Sync/retry ordering.

The model checker must prove the path that:

- skips B4.5;
- skips B5.5;
- begs off Thomas or misses him;
- avoids/declines Clarke conceal;
- skips Custom House proclamation or misses the stop;
- misses/loses the rider bundle;
- skips B10.4 board;
- misses each initial Understanding prompt.

It must still complete all stages with no restored World success.

---

## 30. Text transcript and day close

The transcript is player-visible presentation history, not authoritative save state. On resume, reconstruct it from committed presentation records in the SaveRecord; never persist arbitrary rendered HTML.

After B12:

1. effort-hold the final press pull;
2. commit final artifact text;
3. validate all three concepts are Understood and Demonstrated;
4. play Abigail's end line;
5. show full-screen Archive day record containing:
   - `Day one, filed. You held together better than most first days.`
   - selected headline;
   - the three Notes entries;
   - people met;
   - routes unlocked;
6. Continue commits `mission_day_complete`;
7. preserve completed attempt and return Home.

No score or percentage is shown.

---

## 31. Required tests

### Auth/account

- New test subject creates one account/profile/root seed.
- Repeat login returns same account/profile/root seed.
- Different subject creates different account/profile/root seed.
- Email change on same issuer/subject preserves ownership.
- Logout revokes token family and preserves saves.
- Account A cannot fetch Account B profile/save.
- Test auth route does not exist when `NODE_ENV` is not `test`.
- Valid offline grant + matching private key unlocks only its profile.
- Expired/revoked/wrong-profile grant or copied grant without the private key cannot unlock.

### Runtime contracts

- Runtime packages import no app/React/DOM/Three dependency.
- Presenter cannot mutate state.
- API has no next-action route.
- A framework-free `ScriptedPresentationPort` drives the complete Day 1 package without React; its semantic trace is the reference for text and future Three.js presenter conformance.
- The text presenter conformance suite feeds the same scripted choice/mechanic events and produces the same runtime trace as `ScriptedPresentationPort`.
- Every future `game-web` Three.js presenter must pass this unchanged conformance suite before replacing the text app.
- Choice PromptSpec rejects 0, 1 (except acknowledgment), or >3 choices.
- Four errand objective markers compile because they are not PromptSpec choices.

### Learning

- Every exposure commits at most once.
- Ambient actions emit no learning.
- Focus-read does not commit before panel open.
- Initial 3/2 gate works for each concept.
- Initial miss creates exactly one post-miss re-exposure obligation.
- Retry second miss terminates through at most two eliminated distractors.
- Notes commits exactly once.
- Demonstration cannot run before Understanding.

### Time/world

- Traversal/neutral Continue costs 0.
- Clock warnings fire once.
- Boundary 24 always starts closure/event flow.
- All completed early advances through crowd observation, not traversal.
- Missed objectives remain missed after learning fallback.
- Pike contingent effect expires when Pike is missed.
- Abigail Trust realizes only on return.

### Save/resume

For every ActionSpec checkpoint:

- save;
- destroy runtime instance;
- restore;
- complete with same presenter events;
- compare full semantic trace with uninterrupted execution.

Comparison includes selected IDs, eliminated correction choices, exposure IDs, clock units, objective states, relationships, object custody, outcome IDs, Notes, and next legal set.

### E2E

- Student A login -> start -> play to a mid-Pike checkpoint -> logout.
- Student B login -> sees no A progress -> starts independent attempt.
- Student B logout.
- Student A login -> resumes exact Pike checkpoint.
- Complete A Day 1.
- Confirm B remains at its own checkpoint.
- Separate offline test: A logs in online, receives a grant, reaches a checkpoint, browser goes offline and cold reloads, A resumes; explicit logout removes the grant and the next offline reload exposes no profile.
- Service-worker test confirms `/v1/session`, saves, auth, and telemetry responses are never cached.

### Model checker

Enumerate all:

- shop-entry variants;
- press buckets;
- optional reads;
- four errand orders;
- Thomas choices;
- Pike quality/choices/reprint quality;
- rider route/Clarke/B9/handoff outcomes;
- Custom read/order state;
- fixed-event on-ramps;
- initial Sync responses and retry responses;
- demonstration distractor sequences;
- save boundaries.

Assert fixed history, no deadlocks, learning completion, three-option PromptSpecs, objective consequence persistence, and exact resume.

---

## 32. Final implementer handoff format

The implementing agent must finish by reporting:

1. exact files created/changed;
2. startup commands;
3. Google console values the human must supply;
4. migration/package hashes;
5. automated test counts and results;
6. manual two-Google-account test result;
7. any requirement not implemented, which means the task is not complete.

It must not claim completion with skipped tests, mock Google login in manual verification, an unproven avoidant path, or a text-specific runtime.

---

## 33. Exact Day 1 ActionSpec registry

Every ID below must exist in compiled output. `ADD(n)` means add clock units. `BOUNDARY` means advance to fixed-event boundary. `SPACE` means increment the committed interaction ordinal used by Sync spacing. `NO_SPACE` does not.

Nested execution actions (haul, conceal, reprint timing) inherit their parent choice's clock/spacing commit unless the registry explicitly assigns their own. They never double-charge time or increment spacing twice. One player-facing choice plus its physical execution is one committed interaction.

### Opening

```text
BOS.MD01.ACT.ARCHIVE_INTAKE.v1
  presenter: NARRATIVE
  clock: ADD(0)
  spacing: SPACE
  effect: commit POLICY.B0.ARCHIVE_ARTICLE_SCENE
  effect: objective REPORT_TO_MERCER -> ACTIVE/GOLD
  next: BOS.MD01.ACT.TRAVERSE_TO_MERCER.v1

BOS.MD01.ACT.TRAVERSE_TO_MERCER.v1
  presenter: FREE_ROAM
  clock: ADD(0)
  spacing: NO_SPACE
  next: BOS.MD01.ACT.ENTER_MERCER.v1

BOS.MD01.ACT.ENTER_MERCER.v1
  presenter: PROMPT
  clock: ADD(1)
  spacing: SPACE
  choices:
    KNOCK      -> Abigail: "Door's open. In."
    WALK_IN    -> Abigail: "You the new runner? Good, catch."
    LOOK_FIRST -> Abigail: "If you're here for work, come in."
  state effect: none
  next: BOS.MD01.ACT.CATCH_SHEET.v1

BOS.MD01.ACT.CATCH_SHEET.v1
  presenter: EFFORT_HOLD
  clock: ADD(1)
  spacing: SPACE
  required phase: SHEET_CAUGHT
  next: BOS.MD01.ACT.PRESS_PIKE_PROOF.v1

BOS.MD01.ACT.PRESS_PIKE_PROOF.v1
  presenter: TIMING
  clock: ADD(2)
  spacing: SPACE
  outcomes: CRISP | USABLE | SMUDGED
  effect: PIKE_PROOF condition = outcome
  effect: Abigail Respect = 45 | 35 | 25
  effect: create contingent Pike proof-quality effect
  next: BOS.MD01.ACT.COMPARE_STAMP_PROOFS.v1

BOS.MD01.ACT.COMPARE_STAMP_PROOFS.v1
  presenter: FOCUS_READ
  clock: ADD(1)
  spacing: SPACE
  effect: commit STAMP.B3.PROOF_COMPARISON
  effect: show Stamp Act field tag
  next: BOS.MD01.ACT.ABIGAIL_ASSIGN_ERRANDS.v1

BOS.MD01.ACT.ABIGAIL_ASSIGN_ERRANDS.v1
  presenter: NARRATIVE
  clock: ADD(1)
  spacing: SPACE
  line: "Four stops. Rider goes at the bell, don't miss him. Street's already ugly."
  effect: transfer circular/proof/handbills/notice/plain-wrap to player
  effect: REPORT_TO_MERCER -> COMPLETED
  effect: four errand objectives -> PENDING/BLUE
  next: BOS.MD01.ACT.EXIT_MERCER.v1

BOS.MD01.ACT.EXIT_MERCER.v1
  presenter: FREE_ROAM
  clock: ADD(0)
  spacing: NO_SPACE
  next: objective-selection state

BOS.MD01.ACT.TOWN_STAMP_NOTICE_OFFER.v1
  presenter: PROMPT
  clock: ADD(0)
  spacing: NO_SPACE
  choices:
    READ -> BOS.MD01.ACT.TOWN_STAMP_NOTICE_READ.v1
    SKIP -> dispatch active selected objective

BOS.MD01.ACT.TOWN_STAMP_NOTICE_READ.v1
  presenter: FOCUS_READ
  clock: ADD(1)
  spacing: SPACE
  effect: commit STAMP.B4_5.OFFICIAL_NOTICE
  next: dispatch active selected objective
```

### Objective selection

Objective selection is an Event Manager command, not an ActionSpec prompt:

```ts
{ type: "SELECT_OBJECTIVE"; objectiveId: string }
```

Legal IDs are pending members of the four-errand group. Selection sets one gold/active and other pending members hidden with reason `FOCUS_ON_OTHER_GROUP_MEMBER`.

On the first objective selection only, retain the selected objective as active and run `TOWN_STAMP_NOTICE_OFFER` before dispatching its stop. Later selections dispatch immediately.

Dispatch:

```text
THOMAS_CIRCULAR    -> BOS.MD01.ACT.THOMAS_DELIVERY.v1
PIKE_PROOF         -> BOS.MD01.ACT.PIKE_DELIVERY.v1
CUSTOMHOUSE_NOTICE -> BOS.MD01.ACT.CUSTOMHOUSE_ENTER.v1
RIDER_HANDBILLS    -> BOS.MD01.ACT.RIDER_ROUTE_SELECT.v1
```

After the first errand whose terminal status is `COMPLETED` only, dispatch B5.5 before resurfacing the group. A `FAILED`, `MISSED`, `REFUSED`, or `CANCELLED` errand does not trigger the fresh broadside.

### First-stop broadside

```text
BOS.MD01.ACT.FRESH_BROADSIDE_OFFER.v1
  presenter: PROMPT
  clock: ADD(0)
  spacing: NO_SPACE
  choices:
    READ -> BOS.MD01.ACT.FRESH_BROADSIDE_READ.v1
    SKIP -> objective-selection state

BOS.MD01.ACT.FRESH_BROADSIDE_READ.v1
  presenter: FOCUS_READ
  clock: ADD(1)
  spacing: SPACE
  effect: commit REP.B5_5.FRESH_BROADSIDE
  next: objective-selection state
```

### Thomas

```text
BOS.MD01.ACT.THOMAS_DELIVERY.v1
  presenter: PROMPT
  clock: choice-specific
  spacing: SPACE
  choices:
    HELP:
      execution: BOS.MD01.ACT.THOMAS_HAUL.v1
      clock: ADD(3)
      effect: circular custody -> THOMAS
      effect: objective -> COMPLETED
      effect: Thomas Obligation -> 40
      effect: dock route -> UNLOCKED
      effect: commit REP.B5.THOMAS_CONSENT_LINE
    BEG_OFF:
      clock: ADD(1)
      effect: circular custody -> THOMAS
      effect: objective -> COMPLETED
      effect: obligation remains 0
      effect: no exposure
    ASK_TROUBLE:
      clock: ADD(1)
      effect: circular custody -> THOMAS
      effect: objective -> COMPLETED
      effect: obligation remains 0
      effect: commit REP.B5.THOMAS_CONSENT_LINE

BOS.MD01.ACT.THOMAS_HAUL.v1
  presenter: EFFORT_HOLD
  nested execution owned by HELP
  cannot fail
```

### Pike

```text
BOS.MD01.ACT.PIKE_DELIVERY.v1
  presenter: NARRATIVE
  clock: ADD(1)
  spacing: SPACE
  effect: proof custody -> PIKE
  effect: commit STAMP.B6.PIKE_SCOPE_LINE
  effect: commit POLICY.B6.PIKE_WAR_DEBT_LINE
  effect: realize Pike contingent effect from proof quality
  branch:
    CRISP | USABLE -> objective COMPLETED -> run archive scheduler -> optional sort
    SMUDGED        -> BOS.MD01.ACT.PIKE_SMUDGE_RESPONSE.v1

BOS.MD01.ACT.PIKE_SMUDGE_RESPONSE.v1
  presenter: PROMPT
  spacing: SPACE
  choices:
    REPRINT:
      clock: ADD(5)
      execution: BOS.MD01.ACT.REPRINT_PIKE_PROOF.v1
    OWN_IT:
      clock: ADD(1)
      effect: Pike Respect -> 35
      effect: objective -> COMPLETED
    BRUSH_OFF:
      clock: ADD(1)
      effect: Pike Respect -> 15
      effect: objective -> COMPLETED

BOS.MD01.ACT.REPRINT_PIKE_PROOF.v1
  presenter: TIMING
  one attempt only
  clock included by parent
  outcomes:
    CRISP   -> proof CRISP, Pike Respect 50
    USABLE  -> proof USABLE, Pike Respect 45
    SMUDGED -> proof SMUDGED, Pike Respect 25
  effect: objective -> COMPLETED

BOS.MD01.ACT.PIKE_STAMP_SORT.v1
  eligibility: Stamp UNDERSTOOD and player still at Pike and Stamp not DEMONSTRATED
  presenter: SORT
  clock: ADD(2)
  spacing: SPACE
  effect: Stamp -> DEMONSTRATED after bounded correction
```

The archive scheduler runs after Pike delivery/response terminal commit. If Stamp Understanding becomes legal and spacing permits, its Sync runs before `PIKE_STAMP_SORT`.

### Custom House

```text
BOS.MD01.ACT.CUSTOMHOUSE_ENTER.v1
  presenter: NARRATIVE
  clock: ADD(0)
  spacing: NO_SPACE
  next: BOS.MD01.ACT.CUSTOMHOUSE_PROCLAMATION_OFFER.v1

BOS.MD01.ACT.CUSTOMHOUSE_PROCLAMATION_OFFER.v1
  presenter: PROMPT
  clock: ADD(0)
  spacing: NO_SPACE
  choices:
    READ -> BOS.MD01.ACT.CUSTOMHOUSE_PROCLAMATION_READ.v1
    SKIP -> post dispatcher

BOS.MD01.ACT.CUSTOMHOUSE_PROCLAMATION_READ.v1
  presenter: FOCUS_READ
  clock: ADD(1)
  spacing: SPACE
  effect: commit POLICY.B7_5.CROWN_PROCLAMATION
  next: run archive scheduler, then post dispatcher

post dispatcher:
  if Policy UNDERSTOOD:
    BOS.MD01.ACT.CUSTOMHOUSE_POLICY_POST.v1
  else:
    BOS.MD01.ACT.CUSTOMHOUSE_PLAIN_POST.v1

BOS.MD01.ACT.CUSTOMHOUSE_PLAIN_POST.v1
  presenter: EFFORT_HOLD
  clock: ADD(2)
  spacing: SPACE
  effect: notice custody -> CUSTOM_HOUSE
  effect: subscription collected
  effect: objective -> COMPLETED

BOS.MD01.ACT.CUSTOMHOUSE_POLICY_POST.v1
  presenter: PLACE
  clock: ADD(2)
  spacing: SPACE
  prompt/targets: §26 Policy demonstration
  effect: notice custody -> CUSTOM_HOUSE
  effect: subscription collected
  effect: Policy -> DEMONSTRATED after bounded correction
  effect: objective -> COMPLETED
```

### Rider route, Clarke, customs stop, and handoff

```text
BOS.MD01.ACT.RIDER_ROUTE_SELECT.v1
  presenter: PROMPT
  spacing: route-specific
  choices:
    MAIN_FAST:
      label: "Cross fast past the watchers."
      clock: ADD(1)
      route outcome policy: B8_MAIN_FAST
      then Clarke
    BACK_LANES:
      label: "Wait for the patrol to pass, then take the back lanes."
      clock: ADD(2)
      route outcome: CLEAR
      then Clarke
    DOCK_ROUTE:
      label: "Use Thomas's dock route."
      eligibility: THOMAS_DOCK_ROUTE == UNLOCKED
      clock: ADD(0)
      route outcome: CLEAR
      skip Clarke and B9
      then handoff

BOS.MD01.ACT.CLARKE_CHALLENGE.v1
  presenter: PROMPT
  spacing: SPACE
  choices:
    CALM_CONCEAL:
      clock: ADD(2)
      execution: BOS.MD01.ACT.CONCEAL_HANDBILLS.v1
      effect: Clarke Political Read -> -20
      effect: clarkeInformed=false
      effect: commit REP.B7.CONCEALED_HANDBILL
    CURT:
      clock: ADD(1)
      effect: Clarke Political Read -> 35
      effect: clarkeInformed=true
    HEAR_OUT:
      clock: ADD(1)
      effect: Clarke Political Read -> 10
      effect: clarkeInformed=false

BOS.MD01.ACT.CONCEAL_HANDBILLS.v1
  presenter: EFFORT_HOLD
  nested execution owned by CALM_CONCEAL
  effect: handbills concealment -> WRAPPED

customs-stop eligibility:
  route outcome == STOP_TRIGGERED
  OR clarkeInformed == true
  OR watcherHeat >= 2

BOS.MD01.ACT.CUSTOMS_STOP.v1
  presenter: PROMPT
  clock: choice-specific
  spacing: SPACE
  setup effect: if Stamp initial gate is short and STAMP.B9.OFFICER_STAMP_LINE is unused, play the officer's stamp line and commit that exposure
  choices:
    COMPLY:
      clock: ADD(1)
      exposed -> CONFISCATED
      concealed -> B9_COMPLY_CONCEALED
    TALK:
      clock: ADD(1)
      policy: B9_TALK_INFORMED when clarkeInformed else B9_TALK_NORMAL
      failed search + exposed -> CONFISCATED
      failed search + concealed -> RECOGNIZED + CREASED
    SLIP:
      clock: ADD(2)
      policy: B9_SLIP
      caught + exposed -> CONFISCATED
      caught + concealed -> RECOGNIZED + CREASED

if handbills CONFISCATED:
  custody -> CUSTOMS
  rider objective -> FAILED
  Rider Trust -> 20
  continue after errand

BOS.MD01.ACT.RIDER_HANDOFF.v1
  presenter: PROMPT
  eligibility: handbills in player custody and clock < 24
  spacing: SPACE
  choices:
    QUICK:
      clock: ADD(1)
      policy: B10_QUICK_HIGH_HEAT when recognized/watcherHeat>0 else B10_QUICK_LOW_HEAT
    WAIT_FOR_GAP:
      clock: ADD(2)
      if boundary reached before transfer -> MISSED
      else -> DELIVERED_UNSEEN
  effect: objective terminal
  effect: custody/Trust from §24
```

### Per-errand terminal dispatcher

After any errand reaches `COMPLETED`, `FAILED`, `MISSED`, or `REFUSED`:

1. commit transaction;
2. run clock warning/closure logic;
3. if this is the first successfully `COMPLETED` errand, run B5.5 offer;
4. run archive scheduler at the next safe point;
5. resurface pending errand objectives;
6. if no errands remain, enter crowd phase.

### Crowd phase and fixed event

```text
BOS.MD01.ACT.CROWD_BOARD_OFFER.v1
  presenter: PROMPT
  clock: ADD(0)
  spacing: NO_SPACE
  choices:
    READ -> BOS.MD01.ACT.CROWD_BOARD_READ.v1
    CONTINUE -> BOS.MD01.ACT.ARCHIVE_DAY_SYNTHESIS.v1

BOS.MD01.ACT.CROWD_BOARD_READ.v1
  presenter: FOCUS_READ
  clock: ADD(1)
  spacing: SPACE
  effect: commit REP.B10_4.CROWD_BOARD
  next: BOS.MD01.ACT.ARCHIVE_DAY_SYNTHESIS.v1

BOS.MD01.ACT.ARCHIVE_DAY_SYNTHESIS.v1
  presenter: NARRATIVE
  clock: ADD(1)
  spacing: NO_SPACE
  line: "Cost, the paper, the war to pay for it. But something's got them angrier than a fee. Hold that."
  behavior: if clock < 24 and a first-understanding Sync is due/legal, run it instead of synthesis copy
  behavior: if fixed event is due, defer every Sync to B11.5 and continue to event

BOS.MD01.ACT.OBSERVE_CROWD_FORMING.v1
  presenter: EFFORT_HOLD
  clock: ADVANCE_TO_FIXED_EVENT_BOUNDARY
  spacing: SPACE
  effect: objective OBSERVE_CROWD -> COMPLETED

BOS.MD01.ACT.SHOPS_CLOSED_ACK.v1
  presenter: PROMPT acknowledgement
  one control: Continue
  clock: ADD(0)
  line: "That's it. Light's gone, shops are shuttering. Whatever's not done is done."
  effect: every unfinished errand -> authored missed terminal
  next: BOS.MD01.ACT.CROWD_BOARD_OFFER.v1

BOS.MD01.ACT.EVENT_ONRAMP.v1
  presenter: PROMPT
  choices:
    CLIMB -> BOS.MD01.ACT.EVENT_CLIMB.v1
    PUSH  -> BOS.MD01.ACT.EVENT_PUSH.v1
    CHANT -> BOS.MD01.ACT.EVENT_CHANT.v1

BOS.MD01.ACT.EVENT_CLIMB.v1
  presenter: EFFORT_HOLD
  spacing: SPACE
  consequence: none
  next: fixed event

BOS.MD01.ACT.EVENT_PUSH.v1
  presenter: EFFORT_HOLD
  spacing: SPACE
  consequence: watcherHeat +1
  next: fixed event

BOS.MD01.ACT.EVENT_CHANT.v1
  presenter: EFFORT_HOLD
  spacing: SPACE
  consequence: politicalSympathy=true
  next: fixed event

BOS.MD01.ACT.AUG14_FIXED_EVENT.v1
  presenter: NARRATIVE
  clock: ADD(0)
  spacing: SPACE
  effect: fixed history committed
  effect: commit REP.B11.EVENT_BANNER
  effect: objective RETURN_TO_PRESS -> ACTIVE/GOLD

BOS.MD01.ACT.AUG14_FIXED_EVENT_RECAP.v1
  eligibility: accessibility profile requests reduced-intensity/skip presentation
  presenter: NARRATIVE
  clock: ADD(0)
  spacing: SPACE
  effect: commit the exact same fixed history state, RCC.ORGANIZED_RESISTANCE_EVENT, REP.B11.EVENT_BANNER, and return objective as the primary event
  prohibition: no reduced consequence/learning state and no alternate history
```

### Return, deficit closure, and retry assets

```text
BOS.MD01.ACT.RETURN_TO_MERCER.v1
  presenter: FREE_ROAM
  clock: ADD(0)
  spacing: NO_SPACE
  next: BOS.MD01.ACT.ABIGAIL_DAY_RESULT.v1

BOS.MD01.ACT.ABIGAIL_DAY_RESULT.v1
  presenter: NARRATIVE
  clock: ADD(0)
  spacing: SPACE
  effect: realize Abigail Trust from §24
  asset selection: all complete -> ALL ERRANDS COMPLETE; one missed -> matching named line from §34; multiple -> MULTIPLE line
  effect: objective RETURN_TO_PRESS -> COMPLETED
  next: B11.5 audit

BOS.MD01.ACT.POLICY_DEFICIT_SOURCE.v1
  presenter: FOCUS_READ
  spacing: SPACE
  effect: commit POLICY.B11_5.RETAINED_DEBT_SOURCE

BOS.MD01.ACT.POLICY_DEFICIT_LINE.v1
  presenter: NARRATIVE
  spacing: SPACE
  effect: commit POLICY.B11_5.ABIGAIL_CAUSE_LINE

BOS.MD01.ACT.STAMP_DEFICIT_SOURCE.v1
  presenter: FOCUS_READ
  spacing: SPACE
  effect: commit STAMP.B11_5.RETAINED_FORM_COMPARE

BOS.MD01.ACT.STAMP_DEFICIT_LINE.v1
  presenter: NARRATIVE
  spacing: SPACE
  effect: commit STAMP.B11_5.ABIGAIL_FEE_DISTINCTION

BOS.MD01.ACT.REP_DEFICIT_SOURCE.v1
  presenter: FOCUS_READ
  spacing: SPACE
  effect: commit REP.B11_5.TOWN_INSTRUCTION_SOURCE

BOS.MD01.ACT.REP_DEFICIT_LINE.v1
  presenter: NARRATIVE
  spacing: SPACE
  effect: commit REP.B11_5.ABIGAIL_NO_MEMBER_LINE

BOS.MD01.ACT.POLICY_RETRY_SOURCE.v1
  presenter: FOCUS_READ
  spacing: SPACE
  effect: commit POLICY.RETRY.SECOND_DEBT_EXCERPT

BOS.MD01.ACT.STAMP_RETRY_SOURCE.v1
  presenter: FOCUS_READ
  spacing: SPACE
  effect: commit STAMP.RETRY.COVERED_ITEMS_SCHEDULE

BOS.MD01.ACT.REP_RETRY_SOURCE.v1
  presenter: FOCUS_READ
  spacing: SPACE
  effect: commit REP.RETRY.MASSACHUSETTS_INSTRUCTION

BOS.MD01.ACT.FILE_POLICY_SOURCE.v1
BOS.MD01.ACT.FILE_STAMP_SOURCE.v1
BOS.MD01.ACT.FILE_REP_SOURCE.v1
BOS.MD01.ACT.SORT_TYPE_LEADS.v1
BOS.MD01.ACT.PREPARE_TYPE_CASE.v1
BOS.MD01.ACT.INK_PRESS_BED.v1
BOS.MD01.ACT.CUT_PROOF_PAPER.v1
BOS.MD01.ACT.SET_PRESS_CHASE.v1
  presenter: EFFORT_HOLD
  each action may fire once
  spacing: SPACE
  effect: untracked occupational reinforcement only
  effect: no relationship/concept-gate change
```

All B11.5 actions use `ADD(0)` because the fixed event has already occurred; they still emit pacing duration telemetry.

### Headline and close

```text
BOS.MD01.ACT.HEADLINE_SELECT.v1
  presenter: PROMPT
  spacing: SPACE
  targets/nudges: §26 Representation
  effect: Representation -> DEMONSTRATED after bounded correction

BOS.MD01.ACT.HEADLINE_CAUSE_LINE.v1
  presenter: PROMPT
  spacing: SPACE
  targets/nudges: §26 policy cause
  effect: if Policy not DEMONSTRATED, mark it after correction

BOS.MD01.ACT.HEADLINE_EVIDENCE_PIN.v1
  presenter: PROMPT
  spacing: SPACE
  targets/nudges: §26 Stamp evidence
  effect: if Stamp not DEMONSTRATED, mark it after correction

BOS.MD01.ACT.FINAL_PRESS_PULL.v1
  presenter: EFFORT_HOLD
  spacing: SPACE
  effect: final headline artifact committed
  effect: objective SET_HEADLINE -> COMPLETED

BOS.MD01.ACT.ABIGAIL_END_LINE.v1
  presenter: NARRATIVE
  spacing: SPACE
  line: "Get some rest. Street'll be worse tomorrow, not better. Be here early."

BOS.MD01.ACT.ARCHIVE_DAY_RECORD.v1
  presenter: DAY_END
  one control: Continue
  effect: mission_day_complete
  effect: save completed-at timestamp
```

Before `ARCHIVE_DAY_RECORD`, End Day validation must prove all three concepts `UNDERSTOOD` + `DEMONSTRATED` and no correction/retry/deficit obligation open.

---

## 34. Exact localhost text assets

These strings are the player-facing localhost fixture. Do not ask a model to expand them. Text not listed here but quoted in `Day-1.md` must be copied verbatim from `Day-1.md`. Design prose is never shown to the player.

### B0

```text
IDENTITY SYNCHRONIZED
Boston, 14 August 1765
Cover: runner for Mercer's Press

CONTEXT
The war with France ended in 1763.
Britain is deeply in debt.
Parliament is turning to the colonies for revenue.

SOURCE
"Towards further defraying the expenses of defending, protecting, and securing the British colonies and plantations in America."

ASSIGNMENT
Report to Abigail Mercer, print shop owner.
```

The source is a development fixture excerpt from the revenue language used in British colonial legislation. It must be replaced by the production-reviewed/provenanced scan and transcription before a student pilot, but its localhost string is fixed above.

### Arrival and shop

```text
Heat. Cart wheels. Ink and paper through an open window.
A hanging sign reads MERCER'S PRESS.

Inside, the press knocks against the floorboards.
Abigail is already reaching for the next sheet.

Abigail: "You the new runner? Good, catch."

The legal proof and the shop's plain form use the same words.
The new proof carries the space for the Crown's paid stamp.

FIELD TAG
Stamp Act: an internal tax on printed and legal paper. Takes effect 1 Nov 1765.
```

### Street sources

```text
OFFICIAL STAMP NOTICE
Duties on newspapers and legal papers, to be in force the First of November.

FRESH BROADSIDE
No tax laid upon us but by our own consent, given by ourselves or by the men we choose to speak for us.
We have chosen no man to sit in their Parliament, yet they tax us still.

LATE CROWD BROADSIDE
No tax laid on us but by our own consent.
```

### Thomas

```text
Thomas is pulling good cloth away from the front of his counting-house.

Thomas: "Put the circular there."

HELP/ASK LEARNING LINE
Thomas: "It's not the shilling. It's the not being asked."

ASK FOLLOW-UP
Thomas: "Trouble's already here. Question is who pays for it."

BEG OFF
Thomas: "Fine. Go. Bell won't wait for either of us."
```

### Pike

```text
Pike lays the proof beside a deed and a court writ.

Pike: "A tax on paper. On the very paper the law's written on. How's a man supposed to do business?"
Pike: "London had a war to pay for. Guess who they sent the bill to."

REPRINT
Player: "That one's on me. I'll run you a fresh copy."

OWN IT
Player: "That's my rush, sorry. It'll still serve."

BRUSH OFF
Player: "Whole street's slammed today. It reads fine."

SORT SETUP
Pike: "Come November these all need the stamp, or they're worthless. Sort me the ones that'll need it."

SORT COMPLETE
Pike: "There. That's the work."
```

### Clarke

```text
Clarke stands in his shop doorway as people move toward the square.

Clarke: "Liberty, they call it."
Clarke: "Hold a moment. What's that you're carrying?"

CALM COVER
Player: "Overruns for the rider."

CURT
Player: "None of your business."

HEAR OUT
Player: "What do you make of the crowd?"

CLARKE VIEW
Clarke: "This liberty is just mobs and broken windows. The Crown feeds this town."
```

### Custom House

```text
The Custom House hall smells of damp wool and ledger ink.
The Crown's arms hang above the clerks' counter.

REVENUE PROCLAMATION
For defraying the expenses of defending and securing the colonies, such duties and taxes are laid.

PLAIN POST COMPLETE
The notice sits square on the board. A clerk pushes Abigail's subscription across the counter.

POLICY POST COMPLETE
The notice sits under Parliament's revenue column. A clerk pushes Abigail's subscription across the counter.
```

### Customs stop and rider

```text
CUSTOMS OFFICER
"Hold. What's in the bag?"
"Come November, printed sheets will need the Crown's stamp. Let's see what you're carrying."

RIDER
The rider is tying down the last bundle. The bell is close.

QUICK COMPLETE
The bundle changes hands before the next passer turns.

WAIT COMPLETE
The street opens for one breath. You pass the bundle through the gap.

MISSED
The hitching place is empty. The handbills are still with you.
```

### Crowd and fixed event

```text
The great elm is surrounded. An effigy turns above the crowd.

ARCHIVE
"The crowd's gathering, let's go check it out."

ORGANIZER
"Andrew Oliver! The Crown's man for the stamps!"
"To Fort Hill!"

BANNER
We were never asked. No stamp, no tax, but by our own consent.

FIELD TAG
Liberty Tree: the elm where the crowd hung the effigy of Andrew Oliver, the stamp distributor.

The men at the tree lower the effigy.
The crowd turns together and carries it toward Fort Hill.
The event is organized, aimed at the stamp distributor, and already beyond anything the runner can start or stop.

REDUCED-INTENSITY ARCHIVE RECAP
On 14 August 1765, organizers hung Andrew Oliver's effigy on the elm.
The crowd followed their signals, paraded it, pulled down the building believed to be his stamp office, and burned the effigy at Fort Hill.
Their signs said Parliament taxed the colonies without their elected consent.
Oliver resigned the next morning.
```

This exact recap is locked for localhost implementation and contract testing. It remains blocked from a student pilot until historical and accessibility review records are attached to the production package.

### Return and headline

```text
ALL ERRANDS COMPLETE
Abigail: "All of it. The rider, Pike, the Custom House, the notice posted. You ran it clean. You'll do."

ONE OR MORE MISSED
Rider only: Abigail: "The rider left without the bundle. That was needed."
Pike only: Abigail: "Pike never got his proof. That was paid work."
Thomas only: Abigail: "Thomas never got the circular. He was waiting."
Custom House only: Abigail: "The notice never reached the Custom House."
Multiple: Abigail: "More than one stop went unfinished. I needed the whole run."

POLICY DEFICIT SOURCE
The war had left Britain with heavier debt. Parliament sought revenue from the colonies.

POLICY DEFICIT LINE
Abigail: "London came out of the war owing money. Parliament meant the colonies to help pay."

STAMP DEFICIT SOURCE
Court deeds, writs, and printed newspapers require paid stamped paper. A private handwritten letter and a wooden tool do not.

STAMP DEFICIT LINE
Abigail: "My fee pays for ink and labor. The Crown's stamp is a tax laid on the covered paper."

REPRESENTATION DEFICIT SOURCE
No tax should be laid without consent given by the people or by representatives they elect.

REPRESENTATION DEFICIT LINE
Abigail: "Boston elects nobody to Parliament. That's the voice the broadside says is missing."

POLICY RETRY SOURCE
The cost of defending the colonies followed the war. Parliament looked to colonial revenue.

STAMP RETRY SOURCE
Covered printed and legal papers require the paid stamp beginning the First of November.

REPRESENTATION RETRY SOURCE
The colony has its own elected assembly, but sends no elected member to Parliament.

HEADLINE FRAME
Abigail: "You saw what happened at the elm. So set it. What's tomorrow's front page?"

CAUSE FRAME
Abigail: "Good. Now the line under it. A good story says why, not just what happened. Why did London lay this on us in the first place?"

EVIDENCE FRAME
Abigail: "Now pin the proof beside it, so no one calls us liars. Which of these is the sort of document the Crown's stamp has to go on?"

FINAL PULL
You lock the type, ink it, lay down the sheet, and pull.

FINAL PAGE
TAXED WITHOUT A VOICE
By order of Parliament, to raise revenue after the war.
Source: a court deed.
```

If the player selected a wrong headline/cause/evidence option before correction, the final page still uses the corrected target while the original selected response remains in formative evidence history.

---

## 35. No-autonomy review checklist

Before handing this specification to the implementer, the directing agent must confirm:

- no unresolved implementation placeholder, framework alternative, or product decision remains in this document;
- every installed dependency and version is named;
- every external human step is named;
- every API endpoint and auth cookie is named;
- every database table needed by the localhost flow is named;
- every Day 1 concept, exposure, Sync, demonstration, relationship, objective, object, and fallback is named;
- every conditional action has a deterministic branch rule;
- every unresolved production-quality historical asset is explicitly separated from the fixed localhost fixture;
- text UI replacement with Three.js requires only a new PresentationPort adapter.

---

## 36. Localhost replay variation

The text slice includes three optional ambient slots so separate accounts exercise the real deterministic Director even when they make identical choices.

```text
BOS.MD01.SLOT.AMBIENT_EARLY.v1
  candidates:
    BOS.MD01.ACT.AMBIENT.PRINTER_PAPER.v1
    BOS.MD01.ACT.AMBIENT.MERCHANT_NOTICE.v1
    NO_ACTION

BOS.MD01.SLOT.AMBIENT_MID.v1
  candidates:
    BOS.MD01.ACT.AMBIENT.DOCK_WAR_BILL.v1
    BOS.MD01.ACT.AMBIENT.SHOPKEEPER_CROWD.v1
    NO_ACTION

BOS.MD01.SLOT.AMBIENT_LATE.v1
  candidates:
    BOS.MD01.ACT.AMBIENT.OLIVER_RUMOR.v1
    BOS.MD01.ACT.AMBIENT.BELL_WARNING.v1
    NO_ACTION
```

Exact lines:

```text
Printer: "Paper costs enough before Parliament puts its mark on it."
Merchant: "Another notice. Always another notice."
Dock worker: "London fights the war, then sends us the bill."
Shopkeeper: "Shutters first. Arguments after."
Passerby: "They've got Oliver hanging from the elm, or something made to look like him."
Carter: "Bell's close. Finish what you're carrying."
```

Rules:

- ambient actions cost 0, do not increment Sync spacing, and emit no Learner EvidenceEvent;
- speech glyph + attributed subtitle are shown;
- early slot resolves after shop exit;
- mid slot resolves after the second errand;
- late slot resolves on the crowd approach before the Archive redirect;
- the deterministic selector uses the account's attempt seed and replay state;
- `NO_ACTION` commits durable silence;
- two accounts are guaranteed different seeds, not guaranteed different selections at every slot;
- the E2E account-isolation test asserts seeds/profile/replay state differ and that each account resumes its own exact selected ambient actions.

