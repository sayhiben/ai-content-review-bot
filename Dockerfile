FROM node:26.12.1-bookworm-slim AS build
WORKDIR /app

# Native canvas can use a prebuilt binary or compile from source on this platform.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ pkg-config libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev \
    fonts-dejavu-core ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests
RUN npm run check && npm prune --omit=dev --no-fund

FROM node:26.12.1-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 \
    fonts-dejavu-core ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json LICENSE ./
RUN mkdir -m 700 data && chown node:node data
ARG REVISION=development
LABEL org.opencontainers.image.title="AI Content Review Bot" \
      org.opencontainers.image.description="Private AI-content reports for Discord moderators" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/sayhiben/ai-content-review-bot" \
      org.opencontainers.image.revision=$REVISION
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD ["node", "dist/health.js"]
STOPSIGNAL SIGTERM
CMD ["node", "dist/main.js"]
