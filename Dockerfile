# syntax=docker/dockerfile:1
# Notes Etc — single application image: the API (NestJS) and the web app
# (Next.js standalone) run in one container. The web server owns the only
# published port and proxies /api/v1, /docs and /healthz to the API process
# on localhost, so the whole product is one origin, one port.

# --- deps: install all workspace deps ----------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=optional --include-workspace-root \
  --workspace @notesetc/api --workspace @notesetc/web

# --- build: shared + api + web -----------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY apps/web ./apps/web
# Un-hoisted workspace deps (see the note in the old web Dockerfile).
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
# The API lives in this container: bake the rewrites against localhost.
ENV API_INTERNAL_URL=http://127.0.0.1:4100
RUN npm run build --workspace @notesetc/shared \
  && npm run prisma:generate --workspace @notesetc/api \
  && npm run build --workspace @notesetc/api \
  && npm run build --workspace @notesetc/web

# --- runtime ------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# The two process trees stay separate: the API's full dependency tree under
# /app, the web's self-contained standalone bundle under /web — their
# node_modules must not merge.
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/web/.next/standalone /web
COPY --from=build /app/apps/web/.next/static /web/apps/web/.next/static
COPY docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
  && mkdir -p /app/storage \
  && chown -R node:node /app/storage
USER node
# The API binds localhost inside the container; only the web port is exposed.
ENV API_PORT=4100
ENV API_INTERNAL_URL=http://127.0.0.1:4100
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
