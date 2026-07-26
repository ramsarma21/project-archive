# syntax=docker/dockerfile:1

# Runtime image for @pa/api (Fastify 5).
#
# CDK builds this with the repository root as the build context, so every path
# below is repo-root relative:
#   infra/lib/project-archive-stack.ts
#     ecs.ContainerImage.fromAsset(repositoryRoot, { file: "apps/api/Dockerfile",
#                                                    platform: LINUX_ARM64 })
#
# The API executes its TypeScript sources through tsx rather than a compiled
# bundle, so there is no build output to isolate. The first stage exists to
# collect the workspace manifests without naming them, which also keeps the
# dependency install out of the layer that source edits invalidate.

ARG NODE_IMAGE=node:24-bookworm-slim

# ---------------------------------------------------------------------------
# Stage 1 - workspace manifests, and nothing else.
#
# pnpm validates the lockfile against every project matched by the globs in
# pnpm-workspace.yaml, and it cannot resolve a `workspace:*` dependency whose
# package.json is absent. A hand-written list of COPY lines therefore fails the
# install outright the moment it drifts, which is what broke this image once:
# the API had gained a dependency whose manifest was never copied.
#
# A hand-written list also goes stale constantly: this workspace gained six
# packages in a single working session and then lost two more when the retired
# chapter was deleted, none of which required a line here.
#
# So instead of naming packages, take the whole context and keep only the files
# pnpm needs to describe the workspace. Nothing below this line names an
# individual package, which is what makes the image survive the package set
# changing.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS manifests

WORKDIR /src
COPY . .

# `install -D` recreates each manifest at the same relative path under
# /manifests, so the workspace layout is preserved without listing it.
RUN set -eux; \
    find . -name node_modules -type d -prune -o -name package.json -print \
      | xargs -I {} install -D {} /manifests/{}; \
    for file in pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json; do \
      install -D "$file" "/manifests/$file"; \
    done

# ---------------------------------------------------------------------------
# Stage 2 - the image that ships.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

# The RDS global trust bundle is baked in at build time so a running task needs
# no network access to verify TLS to Postgres. curl is removed again afterwards
# to keep it out of the shipped image.
RUN set -eux; \
    corepack enable; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl; \
    mkdir -p /app/certs; \
    curl --fail --silent --show-error --location \
      https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
      --output /app/certs/aws-rds-global-bundle.pem; \
    apt-get purge -y curl; \
    apt-get autoremove -y; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=manifests /manifests/ ./

# `--filter "@pa/api..."` selects the API plus its transitive workspace
# dependencies, so a package added to the workspace costs nothing here unless
# the API actually depends on it — and a package DELETED from the workspace
# costs nothing either, which is how the retired chapter left this file
# untouched. Each of those projects is here because the API imports it, not
# because someone remembered to add a line.
#
# pnpm always installs the workspace root's own dependencies regardless of the
# filter, so the root toolchain (typescript, tsx, playwright) does land in the
# image. Removing it would mean compiling the API to JavaScript or switching to
# `pnpm deploy`; see docs/process/CI-AND-BROWSER-CHECKS.md.
#
# Deliberately not --prod: `start` is `node --import tsx`, and tsx is declared
# in apps/api devDependencies, so a production-only install would remove the
# runtime loader.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN CI=true pnpm install --frozen-lockfile --filter "@pa/api..."

# Source comes last so editing it reuses the install layer above.
#
# `packages` is copied wholesale for the same reason the manifests are: the set
# changes week to week and a per-package list is the bug this file used to have.
# It is a few MB of TypeScript, and the filtered install already keeps unrelated
# dependencies out of the image.
COPY --chown=node:node apps/api apps/api
COPY --chown=node:node packages packages

ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3001 \
    NODE_EXTRA_CA_CERTS=/app/certs/aws-rds-global-bundle.pem

EXPOSE 3001

# The service only reads from /app and writes nothing to disk (tsx caches under
# os.tmpdir()), so it does not need root.
USER node
WORKDIR /app/apps/api

# Equivalent to `pnpm --filter @pa/api start` - same argv, same working
# directory - but without a pnpm parent process, which would intercept the
# SIGTERM that ECS sends on task stop and would run a dependency-status check on
# every container start.
CMD ["node", "--import", "tsx", "src/server.ts"]
