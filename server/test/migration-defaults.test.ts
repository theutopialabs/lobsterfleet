import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { sql, type Kysely } from "kysely";
import { openDatabaseWithHandle } from "../src/db.js";
import { runMigrations } from "../src/migrate.js";

describe("fresh database defaults", () => {
  it("does not seed deployment-specific users, repos, or demo cards", async () => {
    await withFreshDb(async ({ db }) => {
      const settings = await sql<{ key: string; value: string }>`
        SELECT key, value FROM settings
      `.execute(db);
      const settingMap = new Map(settings.rows.map((row) => [row.key, row.value]));
      assert.equal(settingMap.get("org"), "Lobsterfleet OS");
      assert.equal(settingMap.get("github_org"), "");

      const allow = await countRows(db, "allow_entries");
      const repos = await countRows(db, "repos");
      const cards = await countRows(db, "cards");
      const events = await countRows(db, "events");

      assert.equal(allow, 0);
      assert.equal(repos, 0);
      assert.equal(cards, 0);
      assert.equal(events, 0);
    });
  });

  it("moves old namespace cutover rows to the neutral upstream repo", async () => {
    await withFreshDb(async ({ db, raw }) => {
      await sql`DELETE FROM _migrations WHERE name = '0020_neutral_default_seed_data.sql'`.execute(db);
      await sql`
        INSERT INTO repos (repo, enabled, created_at, updated_at)
        VALUES ('theutopialabs/lobsterfleet', 1, 1, 1)
      `.execute(db);
      await sql`
        INSERT INTO repo_workflows (
          repo,
          status,
          source_path,
          source_sha,
          config_json,
          prompt,
          error,
          evaluated_at,
          updated_at
        )
        VALUES (
          'theutopialabs/lobsterfleet',
          'ok',
          'CRABBOX.md',
          NULL,
          '{}',
          'workflow',
          NULL,
          1,
          1
        )
      `.execute(db);
      await sql`
        INSERT INTO cards (
          id,
          title,
          prompt,
          repo,
          source,
          runtime,
          policy,
          lane,
          owner,
          started_at,
          created_at,
          updated_at,
          last_event
        )
        VALUES (
          'USER-1',
          'User card',
          'Prompt',
          'theutopialabs/lobsterfleet',
          'Prompt',
          'crabbox',
          'open_pr',
          'Todo',
          'user',
          NULL,
          1,
          1,
          'created'
        )
      `.execute(db);

      runMigrations(raw);

      const repos = await readValues(db, "repos", "repo");
      const cardRepos = await readValues(db, "cards", "repo");
      const workflowRepos = await readValues(db, "repo_workflows", "repo");

      assert.deepEqual(repos, ["openclaw/crabfleet"]);
      assert.deepEqual(cardRepos, ["openclaw/crabfleet"]);
      assert.deepEqual(workflowRepos, ["openclaw/crabfleet"]);
    });
  });
});

async function countRows(db: Kysely<unknown>, table: string): Promise<number> {
  const result = await sql<{ count: number }>`SELECT count(*) AS count FROM ${sql.table(table)}`.execute(db);
  return Number(result.rows[0]?.count ?? 0);
}

async function readValues(
  db: Kysely<unknown>,
  table: string,
  column: string,
): Promise<string[]> {
  const result = await sql<{ value: string }>`
    SELECT ${sql.ref(column)} AS value FROM ${sql.table(table)} ORDER BY ${sql.ref(column)}
  `.execute(db);
  return result.rows.map((row) => row.value);
}

async function withFreshDb(
  run: (ctx: ReturnType<typeof openDatabaseWithHandle>) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "lobsterfleet-defaults-"));
  const ctx = openDatabaseWithHandle(join(root, "test.db"));
  try {
    runMigrations(ctx.raw);
    await run(ctx);
  } finally {
    await ctx.db.destroy();
    await rm(root, { recursive: true, force: true });
  }
}
