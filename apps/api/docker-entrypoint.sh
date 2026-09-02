#!/bin/sh
set -e

# Apply pending database migrations before starting. `migrate deploy` is the
# production-safe, non-interactive migration command.
echo "[entrypoint] Applying database migrations..."
npx prisma migrate deploy

# Seed is idempotent; only run when explicitly requested.
if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[entrypoint] Seeding demo data..."
  npx prisma db seed || echo "[entrypoint] Seed skipped/failed (non-fatal)."
fi

echo "[entrypoint] Starting API..."
exec "$@"
