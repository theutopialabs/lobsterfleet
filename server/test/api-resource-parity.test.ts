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

describe("api resource parity", () => {
  it("exposes GitHub sign-in through the api namespace", async () => {
    await withTestEnv(async ({ env }) => {
      const res = await handleRequest(
        new Request("http://internal.local:8099/api/login/github", { method: "GET" }),
        env,
      );
      assert.equal(res.status, 503);
      assert.match(await res.text(), /GitHub OAuth is not configured/);
    });
  });

  it("exposes the card, lease, run and session reads used by the UI", async () => {
    await withTestEnv(async ({ db, env }) => {
      await allowlistRepo(db, "acme/app");
      await insertInteractiveSession(db, "IS-777", "acme/app", "crabbox:lease-777");
      const cookie = await login(env);
      const cardId = await createCard(env, cookie);

      const started = await handleRequest(
        apiRequest("POST", `/api/cards/${cardId}/actions`, cookie, { action: "start" }),
        env,
      );
      assert.equal(started.status, 200);

      const attached = await handleRequest(
        apiRequest("POST", `/api/cards/${cardId}/lease-links`, cookie, {
          sessionId: "IS-777",
          role: "primary",
          source: "manual_attach",
        }),
        env,
      );
      assert.equal(attached.status, 201);

      const cards = await handleRequest(apiRequest("GET", "/api/cards", cookie), env);
      assert.equal(cards.status, 200);
      const cardsBody = (await cards.json()) as { cards: Array<{ id: string }> };
      assert.ok(cardsBody.cards.some((card) => card.id === cardId));

      const card = await handleRequest(apiRequest("GET", `/api/cards/${cardId}`, cookie), env);
      assert.equal(card.status, 200);
      const cardBody = (await card.json()) as {
        card: { id: string; run: { id: string } | null; leaseLinks: Array<{ sessionId: string }> };
      };
      assert.equal(cardBody.card.id, cardId);
      assert.ok(cardBody.card.run?.id);
      assert.equal(cardBody.card.leaseLinks[0]?.sessionId, "IS-777");

      const runs = await handleRequest(apiRequest("GET", `/api/cards/${cardId}/runs`, cookie), env);
      assert.equal(runs.status, 200);
      const runsBody = (await runs.json()) as { runs: Array<{ cardId: string }> };
      assert.equal(runsBody.runs[0]?.cardId, cardId);

      const links = await handleRequest(
        apiRequest("GET", `/api/cards/${cardId}/lease-links`, cookie),
        env,
      );
      assert.equal(links.status, 200);
      const linksBody = (await links.json()) as { links: Array<{ sessionId: string }> };
      assert.equal(linksBody.links[0]?.sessionId, "IS-777");

      const sessions = await handleRequest(apiRequest("GET", "/api/interactive-sessions", cookie), env);
      assert.equal(sessions.status, 200);
      const sessionsBody = (await sessions.json()) as { sessions: Array<{ id: string }> };
      assert.ok(sessionsBody.sessions.some((session) => session.id === "IS-777"));

      const boxes = await handleRequest(apiRequest("GET", "/api/boxes", cookie), env);
      assert.equal(boxes.status, 200);
      const boxesBody = (await boxes.json()) as { boxes: Array<{ id: string }> };
      assert.ok(boxesBody.boxes.some((box) => box.id === "IS-777"));

      const session = await handleRequest(
        apiRequest("GET", "/api/interactive-sessions/IS-777", cookie),
        env,
      );
      assert.equal(session.status, 200);
      const sessionBody = (await session.json()) as {
        session: { id: string; boardLinks: Array<{ cardId: string }> };
      };
      assert.equal(sessionBody.session.id, "IS-777");
      assert.equal(sessionBody.session.boardLinks[0]?.cardId, cardId);

      const logs = await handleRequest(
        apiRequest("GET", "/api/interactive-sessions/IS-777/logs", cookie),
        env,
      );
      assert.equal(logs.status, 200);
      const logsBody = (await logs.json()) as {
        events: Array<{ message: string }>;
        eventCount: number;
      };
      assert.ok(logsBody.eventCount >= 2);
      assert.equal(logsBody.events[0]?.message, "session ready");
    });
  });

  it("exposes current box status and stack metadata", async () => {
    await withTestEnv(async ({ db, env }) => {
      await allowlistRepo(db, "acme/stack");
      const cookie = await login(env);

      const created = await handleRequest(
        apiRequest("POST", "/api/interactive-sessions", cookie, {
          repo: "acme/stack",
          branch: "feature/status",
          runtime: "crabbox-gui",
          size: "fast",
          region: "local",
          machine: "docker",
          aptUpgrade: true,
          command: "codex --yolo",
          prompt: "Ask before changing the schema",
        }),
        env,
      );
      assert.equal(created.status, 201);
      const createdBody = (await created.json()) as { session: { id: string } };

      const boxes = await handleRequest(apiRequest("GET", "/api/boxes", cookie), env);
      assert.equal(boxes.status, 200);
      const body = (await boxes.json()) as {
        boxes: Array<{
          id: string;
          repo: string;
          branch: string;
          runtime: string;
          size: string;
          region: string;
          machine: string;
          aptUpgrade: boolean;
          command: string;
          prompt: string;
          status: string;
          attentionState: string;
        }>;
      };
      const box = body.boxes.find((item) => item.id === createdBody.session.id);
      assert.ok(box);
      assert.equal(box.repo, "acme/stack");
      assert.equal(box.branch, "feature/status");
      assert.equal(box.runtime, "crabbox-gui");
      assert.equal(box.size, "fast");
      assert.equal(box.region, "local");
      assert.equal(box.machine, "docker");
      assert.equal(box.aptUpgrade, true);
      assert.equal(box.command, "codex --yolo");
      assert.equal(box.prompt, "Ask before changing the schema");
      assert.equal(box.status, "pending_adapter");
      assert.equal(box.attentionState, "");
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
  await sql`
    INSERT INTO interactive_session_events (session_id, actor, message, created_at)
    VALUES
      (${id}, 'dev', 'session ready', ${now}),
      (${id}, 'dev', 'agent attached', ${now + 1})
  `.execute(db);
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
  const root = await mkdtemp(join(tmpdir(), "lobsterfleet-api-parity-"));
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
