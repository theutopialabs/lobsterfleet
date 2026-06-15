import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

// Simple migration runner. Reads server/migrations/*.sql sorted by filename and
// applies any not yet recorded in _migrations. Each file runs in its own
// transaction so a bad migration can't leave a half-applied file behind.
//
// We run against the raw node:sqlite handle (not Kysely) because migration files
// have multiple statements and Kysely's prepare/run only runs one. exec() runs
// the whole script.
//
// Note: there are two 0013_* files. Lexicographic sort runs both.

const here = dirname(fileURLToPath(import.meta.url));

// In dev (tsx) we're at server/src. In prod (esbuild bundle) at server/dist.
// Migrations live at server/migrations either way.
function migrationsDir(): string {
  return process.env.MIGRATIONS_DIR ?? join(here, "../migrations");
}

export function runMigrations(raw: DatabaseSync): number {
  raw.exec(
    "create table if not exists _migrations (name text primary key, applied_at integer not null)",
  );

  const applied = new Set(
    (raw.prepare("select name from _migrations").all() as Array<{ name: string }>).map(
      (r) => r.name,
    ),
  );

  const dir = migrationsDir();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const record = raw.prepare("insert into _migrations (name, applied_at) values (?, ?)");

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const text = readFileSync(join(dir, file), "utf8");
    raw.exec("begin");
    try {
      raw.exec(text);
      record.run(file, Date.now());
      raw.exec("commit");
    } catch (error) {
      raw.exec("rollback");
      throw new Error(`migration ${file} failed: ${(error as Error).message}`, { cause: error });
    }
    count += 1;
  }

  return count;
}
