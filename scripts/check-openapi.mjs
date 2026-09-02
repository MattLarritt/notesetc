// Boots the compiled API, fetches the generated OpenAPI document, and asserts
// it is well-formed. Run from apps/api after `npm run build`. Requires
// DATABASE_URL to point at a reachable, migrated database.
import { spawn } from 'node:child_process';

// Must match the API_PORT default in apps/api/src/config/config.schema.ts —
// with API_PORT unset (as in CI) the app listens on 4100, so defaulting to
// 4000 here polls a port nothing is bound to and always times out.
const PORT = process.env.API_PORT ?? '4100';
const BASE = `http://localhost:${PORT}`;

const child = spawn('node', ['dist/main.js'], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: process.env,
});

function done(code) {
  child.kill();
  process.exit(code);
}

async function poll(url, attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

const res = await poll(`${BASE}/api/v1/openapi.json`);
if (!res) {
  console.error('FAIL: API did not serve OpenAPI within timeout.');
  done(1);
}

const doc = await res.json();
const problems = [];
if (doc?.info?.title !== 'Notes Etc API') problems.push(`unexpected title: ${doc?.info?.title}`);
if (!doc?.paths?.['/healthz']) problems.push('missing /healthz path');
if (!doc?.openapi?.startsWith('3.')) problems.push(`unexpected openapi version: ${doc?.openapi}`);

if (problems.length) {
  console.error('FAIL: OpenAPI check:\n - ' + problems.join('\n - '));
  done(1);
}

console.log(`OK: OpenAPI ${doc.openapi} "${doc.info.title}" with ${Object.keys(doc.paths).length} paths.`);
done(0);
