import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { sql, type Kysely } from "kysely";
import { buildEnv } from "../src/env.js";
import { handleRequest, type RuntimeEnv } from "../src/core/index.js";
import { openDatabaseWithHandle } from "../src/db.js";
import { runMigrations } from "../src/migrate.js";

const originalFetch = globalThis.fetch;

describe("card deletion", () => {
  it("removes the card, events, and run attempts", async () => {
    await withTestEnv(async ({ db, env }) => {
      await allowlistRepo(db, "acme/app");
      const cookie = await login(env);

      const created = await handleRequest(
        apiRequest("POST", "/api/cards", cookie, {
          repo: "acme/app",
          prompt: "fix the failing test",
          title: "Fix test",
          runtime: "crabbox",
          policy: "open_pr",
        }),
        env,
      );
      assert.equal(created.status, 201);
      const body = (await created.json()) as { card: { id: string } };
      const cardId = body.card.id;

      const started = await handleRequest(
        apiRequest("POST", `/api/cards/${cardId}/actions`, cookie, { action: "start" }),
        env,
      );
      assert.equal(started.status, 200);
      assert.equal(await countRows(db, "cards", "id", cardId), 1);
      assert.equal(await countRows(db, "run_attempts", "card_id", cardId), 1);
      assert.ok((await countRows(db, "events", "card_id", cardId)) > 0);

      const deleted = await handleRequest(
        apiRequest("DELETE", `/api/cards/${cardId}`, cookie),
        env,
      );
      assert.equal(deleted.status, 200);
      assert.deepEqual(await deleted.json(), { ok: true, removedId: cardId });
      assert.equal(await countRows(db, "cards", "id", cardId), 0);
      assert.equal(await countRows(db, "run_attempts", "card_id", cardId), 0);
      assert.equal(await countRows(db, "events", "card_id", cardId), 0);
    });
  });
});

async function allowlistRepo(db: Kysely<unknown>, repo: string): Promise<void> {
  const now = Date.now();
  await sql`
    INSERT INTO repos (repo, enabled, created_at, updated_at)
    VALUES (${repo}, 1, ${now}, ${now})
  `.execute(db);
}

async function countRows(
  db: Kysely<unknown>,
  table: string,
  column: string,
  value: string,
): Promise<number> {
  const result = await sql<{ count: number }>`
    SELECT count(*) AS count
    FROM ${sql.table(table)}
    WHERE ${sql.ref(column)} = ${value}
  `.execute(db);
  return Number(result.rows[0]?.count ?? 0);
}

async function login(env: RuntimeEnv): Promise<string> {
  const res = await handleRequest(
    new Request("http://internal.local:8099/api/login/token", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Origin: "http://internal.local:8099",
      },
      body: JSON.stringify({ token: "dev" }),
    }),
    env,
  );
  assert.equal(res.status, 200);
  return res.headers.get("set-cookie") ?? "";
}

function apiRequest(
  method: "GET" | "POST" | "DELETE",
  path: string,
  cookie: string,
  body?: Record<string, unknown>,
): Request {
  return new Request(`http://internal.local:8099${path}`, {
    method,
    headers: {
      cookie,
      Origin: "http://internal.local:8099",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function withTestEnv(
  run: (ctx: { db: Kysely<unknown>; env: RuntimeEnv }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "lobsterfleet-card-delete-"));
  const { db, raw } = openDatabaseWithHandle(join(root, "test.db"));
  runMigrations(raw);
  const previous = {
    token: process.env.CRABBOX_BOOTSTRAP_TOKEN,
    archiveDir: process.env.SESSION_ARCHIVE_DIR,
  };
  process.env.CRABBOX_BOOTSTRAP_TOKEN = "dev";
  process.env.SESSION_ARCHIVE_DIR = join(root, "archives");
  globalThis.fetch = (async () => new Response("{}", { status: 404 })) as typeof fetch;
  try {
    const env = buildEnv(db) as RuntimeEnv;
    env.CRABBOX_BOOTSTRAP_TOKEN = "dev";
    await run({ db, env });
  } finally {
    restoreEnv("CRABBOX_BOOTSTRAP_TOKEN", previous.token);
    restoreEnv("SESSION_ARCHIVE_DIR", previous.archiveDir);
    globalThis.fetch = originalFetch;
    await db.destroy();
    await rm(root, { recursive: true, force: true });
  }
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
