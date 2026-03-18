FROM node:20-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/publisher/package.json apps/publisher/
COPY apps/ponder/package.json apps/ponder/
COPY apps/webhook-worker/package.json apps/webhook-worker/
RUN npm ci
COPY . .

# Non-root user
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup appuser && \
    chown -R appuser:appgroup /app
USER appuser

# API target (default)
FROM base AS api
EXPOSE 4040
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4040)+'/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx/esm", "apps/api/src/server.ts"]

# Worker target
FROM base AS worker
CMD ["node", "--import", "tsx/esm", "apps/worker/src/index.ts"]

# Publisher target
FROM base AS publisher
CMD ["node", "--import", "tsx/esm", "apps/publisher/src/index.ts"]

# Webhook worker target
FROM base AS webhook-worker
CMD ["node", "--import", "tsx/esm", "apps/webhook-worker/src/index.ts"]

# Ponder target (Base indexer)
FROM base AS ponder
CMD ["npx", "ponder", "start"]
