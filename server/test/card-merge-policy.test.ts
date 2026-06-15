import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { sql, type Kysely } from "kysely";
import { buildEnv } from "../src/env.js";
import { handleRequest, type RuntimeEnv } from "../src/core/index.js";
import { openDatabaseWithHandle } from "../src/db.js";
import { runMigrations } from "../src/migrate.js";

const originalFetch = globalThis.fetch;

const policies = [
  "open_pr",
  "merge_when_green",
  "fix_until_green_and_merge",
  "open_draft_pr",
  "fix_draft_pr_until_green",
] as const;

describe("card merge policies", () => {
  it("accepts every supported PR policy when creating a card", async () => {
    await withTestEnv(async ({ db, env }) => {
      await allowlistRepo(db, "acme/app");
      const cookie = await login(env);

      for (const policy of policies) {
        const res = await handleRequest(
          apiRequest("POST", "/api/cards", cookie, {
            repo: "acme/app",
            prompt: `ship ${policy}`,
            policy,
          }),
          env,
        );
        assert.equal(res.status, 201);
        const body = (await res.json()) as { card: { policy: string } };
        assert.equal(body.card.policy, policy);
      }
    });
  });

  it("uses the repo workflow policy when the card asks for the default", async () => {
    await withTestEnv(async ({ db, env }) => {
      await allowlistRepo(db, "acme/app");
      const now = Date.now();
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
          'acme/app',
          'ok',
          'CRABBOX.md',
          NULL,
          ${JSON.stringify({ policy: "open_draft_pr" })},
          '',
          NULL,
          ${now},
          ${now}
        )
      `.execute(db);
      const cookie = await login(env);

      const res = await handleRequest(
        apiRequest("POST", "/api/cards", cookie, {
          repo: "acme/app",
          prompt: "draft first",
          policy: "default",
        }),
        env,
      );

      assert.equal(res.status, 201);
      const body = (await res.json()) as { card: { policy: string } };
      assert.equal(body.card.policy, "open_draft_pr");
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
  const root = await mkdtemp(join(tmpdir(), "lobsterfleet-card-policy-"));
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
