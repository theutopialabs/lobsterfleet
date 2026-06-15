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

describe("board lease links", () => {
  it("attaches, exposes, detaches, and closes session links", async () => {
    await withTestEnv(async ({ db, env }) => {
      await allowlistRepo(db, "acme/app");
      await insertInteractiveSession(db, "IS-901", "acme/app", "crabbox:lease-901");
      const cookie = await login(env);
      const cardId = await createCard(env, cookie);

      const attached = await handleRequest(
        apiRequest("POST", `/api/cards/${cardId}/lease-links`, cookie, {
          sessionId: "IS-901",
          role: "primary",
          source: "manual_attach",
        }),
        env,
      );
      assert.equal(attached.status, 201);
      const attachedBody = (await attached.json()) as {
        link: { id: string; cardId: string; sessionId: string; leaseId: string };
      };
      assert.equal(attachedBody.link.cardId, cardId);
      assert.equal(attachedBody.link.sessionId, "IS-901");
      assert.equal(attachedBody.link.leaseId, "crabbox:lease-901");

      const state = await handleRequest(apiRequest("GET", "/api/state", cookie), env);
      assert.equal(state.status, 200);
      const stateBody = (await state.json()) as {
        cards: Array<{ id: string; leaseLinks: Array<{ sessionId: string }> }>;
        interactiveSessions: Array<{ id: string; boardLinks: Array<{ cardId: string }> }>;
      };
      assert.equal(
        stateBody.cards.find((card) => card.id === cardId)?.leaseLinks[0]?.sessionId,
        "IS-901",
      );
      assert.equal(
        stateBody.interactiveSessions.find((session) => session.id === "IS-901")?.boardLinks[0]
          ?.cardId,
        cardId,
      );

      const detached = await handleRequest(
        apiRequest("DELETE", `/api/cards/${cardId}/lease-links/${attachedBody.link.id}`, cookie),
        env,
      );
      assert.equal(detached.status, 200);
      assert.equal(await countLinks(db, cardId, "attached"), 0);

      const reattached = await handleRequest(
        apiRequest("POST", `/api/cards/${cardId}/lease-links`, cookie, {
          sessionId: "IS-901",
        }),
        env,
      );
      assert.equal(reattached.status, 201);
      assert.equal(await countLinks(db, cardId, "attached"), 1);

      const stopped = await handleRequest(
        apiRequest("POST", "/api/interactive-sessions/IS-901/actions", cookie, { action: "stop" }),
        env,
      );
      assert.equal(stopped.status, 200);
      assert.equal(await countLinks(db, cardId, "attached"), 0);
      assert.equal(await countLinks(db, cardId, "released"), 1);
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

async function insertInteractiveSession(
  db: Kysely<unknown>,
  id: string,
  repo: string,
  leaseId: string,
): Promise<void> {
  const now = Date.now();
  await sql`
    INSERT INTO interactive_sessions (
      id,
      parent_session_id,
      root_session_id,
      repo,
      branch,
      runtime,
      command,
      prompt,
      purpose,
      summary,
      owner,
      created_by,
      status,
      lease_id,
      attach_url,
      vnc_url,
      last_event,
      created_at,
      updated_at,
      last_seen_at,
      stopped_at,
      share_mode,
      share_token_hash,
      share_token_preview,
      control_requested_by,
      control_requested_at,
      controller,
      control_granted_at,
      control_expires_at,
      multiplayer_mode,
      agent_token_hash
    )
    VALUES (
      ${id},
      NULL,
      ${id},
      ${repo},
      'main',
      'crabbox',
      'codex --yolo',
      'fix the app',
      'fix the app',
      'Fix app',
      'dev',
      'dev',
      'ready',
      ${leaseId},
      'ssh://dev@example.test',
      NULL,
      'ready',
      ${now},
      ${now},
      ${now},
      NULL,
      'private',
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      0,
      NULL
    )
  `.execute(db);
}

async function countLinks(
  db: Kysely<unknown>,
  cardId: string,
  status: string,
): Promise<number> {
  const result = await sql<{ count: number }>`
    SELECT count(*) AS count
    FROM board_lease_links
    WHERE card_id = ${cardId}
      AND status = ${status}
  `.execute(db);
  return Number(result.rows[0]?.count ?? 0);
}

async function createCard(env: RuntimeEnv, cookie: string): Promise<string> {
  const created = await handleRequest(
    apiRequest("POST", "/api/cards", cookie, {
      repo: "acme/app",
      prompt: "fix the failing test",
      title: "Fix test",
    }),
    env,
  );
  assert.equal(created.status, 201);
  const body = (await created.json()) as { card: { id: string } };
  return body.card.id;
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
  const root = await mkdtemp(join(tmpdir(), "lobsterfleet-board-links-"));
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
