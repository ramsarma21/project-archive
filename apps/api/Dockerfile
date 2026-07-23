FROM node:24-bookworm-slim

RUN corepack enable \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && mkdir -p /app/certs \
  && curl --fail --silent --show-error --location \
    https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
    --output /app/certs/aws-rds-global-bundle.pem \
  && apt-get purge -y curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/runtime/package.json packages/runtime/package.json

RUN CI=true pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY packages/contracts packages/contracts
COPY packages/runtime packages/runtime

ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3001 \
    NODE_EXTRA_CA_CERTS=/app/certs/aws-rds-global-bundle.pem

EXPOSE 3001

CMD ["pnpm", "--filter", "@pa/api", "start"]
