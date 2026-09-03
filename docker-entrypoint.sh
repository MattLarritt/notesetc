#!/bin/bash
set -e

# Apply pending database migrations before starting anything.
cd /app/apps/api
echo "[notesetc] Applying database migrations..."
npx prisma migrate deploy

if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[notesetc] Seeding demo data..."
  npx prisma db seed || echo "[notesetc] Seed skipped/failed (non-fatal)."
fi

# One container, two processes: the API on localhost:${API_PORT}, the web
# server on ${PORT} (the only published port — it proxies API paths). If
# either process dies, the container exits so the restart policy kicks in.
echo "[notesetc] Starting API on :${API_PORT}..."
node dist/main.js &

echo "[notesetc] Starting web on :${PORT}..."
(cd /web && exec node apps/web/server.js) &

wait -n
EXIT_CODE=$?
echo "[notesetc] A process exited (code ${EXIT_CODE}); shutting down."
exit $EXIT_CODE
