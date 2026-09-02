# syntax=docker/dockerfile:1
# Multi-stage build for the Notes Etc web app (Next.js standalone). Build context
# is the REPO ROOT so the npm workspace (shared package) resolves.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=optional --workspace @notesetc/web --include-workspace-root

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
# npm does not hoist every workspace dependency to the root: anything with a
# conflicting transitive version (the @tiptap/* direct deps, via tiptap-markdown)
# is installed under apps/web/node_modules instead. Copying only the root tree
# leaves those behind and the build fails with "Module not found: @tiptap/react".
# This must come AFTER `COPY apps/web` so it isn't shadowed by the source copy.
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
# next.config.mjs resolves its rewrite destinations (/api/v1, /docs, /healthz,
# /readyz) when `next build` runs, and `output: standalone` freezes them into
# the routes manifest. Setting this only at runtime is too late — the rewrites
# would keep the localhost fallback and every proxied path would 500. Default
# to the compose service name; override with --build-arg for other topologies.
ARG API_INTERNAL_URL=http://api:4100
ENV API_INTERNAL_URL=$API_INTERNAL_URL
# Shared package must be built before Next resolves @notesetc/shared.
RUN npm run build --workspace @notesetc/shared \
  && npm run build --workspace @notesetc/web

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# Next standalone bundles a minimal server + traced node_modules.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# In the monorepo, standalone emits the server entry under apps/web/.
CMD ["node", "apps/web/server.js"]
