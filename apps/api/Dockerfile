# syntax=docker/dockerfile:1
# Multi-stage build for the Notes Etc API. Build context is the REPO ROOT so the
# npm workspace (shared package) resolves.

# --- deps: install all workspace deps ----------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
# web package isn't needed for the API image; omit to keep the layer lean.
RUN npm ci --omit=optional --workspace @notesetc/api --include-workspace-root

# --- build: compile shared + api, generate Prisma client ---------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN npm run build --workspace @notesetc/shared \
  && npm run prisma:generate --workspace @notesetc/api \
  && npm run build --workspace @notesetc/api

# --- runtime: minimal image --------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Bring in installed deps + built artifacts + Prisma schema/migrations.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY apps/api/docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
  && mkdir -p /app/storage \
  && chown -R node:node /app/storage
USER node
WORKDIR /app/apps/api
EXPOSE 4000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/main.js"]
