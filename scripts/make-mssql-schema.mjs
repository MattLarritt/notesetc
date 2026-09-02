// Derives a SQL Server variant of the Prisma schema from the canonical
// (PostgreSQL) schema by swapping the datasource provider. Because the schema
// deliberately avoids Postgres-only constructs (native enums, jsonb, arrays),
// the model definitions are valid as-is for SQL Server.
//
// Used by CI (mssql-compat job) to prove portability. The production MSSQL
// migration additionally applies large-text native types (NVARCHAR(MAX)) for
// content/metadata columns; structural validation here does not require them.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'apps/api/prisma/schema.prisma');
const dest = resolve(root, 'apps/api/prisma/schema.mssql.prisma');

const original = readFileSync(src, 'utf8');
if (!original.includes('provider = "postgresql"')) {
  console.error('Expected provider = "postgresql" in schema.prisma');
  process.exit(1);
}

const swapped =
  '// AUTO-GENERATED from schema.prisma by scripts/make-mssql-schema.mjs — do not edit.\n' +
  original.replace('provider = "postgresql"', 'provider = "sqlserver"');

writeFileSync(dest, swapped);
console.log(`Wrote ${dest} (provider=sqlserver).`);
