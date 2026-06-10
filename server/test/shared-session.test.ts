import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { sql, type Kysely } from "kysely";
import { buildEnv } from "../src/env.js";
import {
  authorizeTerminalBridge,
  handleRequest,
  type RuntimeEnv,
} from "../src/core/index.js";
import { openDatabaseWithHandle } from "../src/db.js";
import { runMigrations } from "../src/migrate.js";

describe("shared interactive sessions", () => {
  it("uses the public app URL for share links and validates the token", async () => {
    await withTestEnv(async ({ db, env }) => {
      const login = await handleRequest(tokenRequest("http://internal.local:8099", "dev"), env);
      const cookie = login.headers.get("set-cookie") ?? "";
      assert.equal(login.status, 200);

      await insertInteractiveSession(db, "share-1");

      const share = await handleRequest(
        new Request("http://internal.local:8099/api/interactive-sessions/share-1/actions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Origin: "http://internal.local:8099",
            cookie,
          },
          body: JSON.stringify({ action: "share_link" }),
        }),
        env,
      );
      assert.equal(share.status, 200);

      const body = (await share.json()) as { shareUrl?: string };
      assert.ok(body.shareUrl);
      const shareUrl = new URL(body.shareUrl);
      assert.equal(shareUrl.origin, "https://fleet.example.test");
      assert.equal(shareUrl.pathname, "/sessions/share-1");

      const token = shareUrl.searchParams.get("token") ?? "";
      assert.ok(token);

      const shared = await handleRequest(
        new Request(`http://internal.local:8099/api/shared-sessions/share-1?token=${token}`),
        env,
      );
      assert.equal(shared.status, 200);

      const wrong = await handleRequest(
        new Request("http://internal.local:8099/api/shared-sessions/share-1?token=wrong"),
        env,
      );
      assert.equal(wrong.status, 404);
    });
  });

  it("keeps shared terminal links view-only and scoped to one session", async () => {
    await withTestEnv(async ({ db, env }) => {
      const login = await handleRequest(tokenRequest("http://internal.local:8099", "dev"), env);
      const cookie = login.headers.get("set-cookie") ?? "";
      assert.equal(login.status, 200);

      await insertInteractiveSession(db, "share-1");
      await insertInteractiveSession(db, "share-2");

      const share = await handleRequest(
        new Request("http://internal.local:8099/api/interactive-sessions/share-1/actions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Origin: "http://internal.local:8099",
            cookie,
          },
          body: JSON.stringify({ action: "share_link" }),
        }),
        env,
      );
      assert.equal(share.status, 200);

      const body = (await share.json()) as { shareUrl?: string };
      const token = new URL(body.shareUrl ?? "").searchParams.get("token") ?? "";
      assert.ok(token);

      const view = await authorizeTerminalBridge(
        new Request(`http://internal.local:8099/api/terminal/ws?shareSession=share-1&token=${token}`),
        env,
        "share-1",
        "view",
      );
      assert.deepEqual(view, { ok: true, canInput: false });

      const control = await authorizeTerminalBridge(
        new Request(`http://internal.local:8099/api/terminal/ws?shareSession=share-1&token=${token}`),
        env,
        "share-1",
        "control",
      );
      assert.equal(control.ok, false);
      if (!control.ok) assert.equal(control.status, 403);

      const wrongSession = await authorizeTerminalBridge(
        new Request(`http://internal.local:8099/api/terminal/ws?shareSession=share-1&token=${token}`),
        env,
        "share-2",
        "view",
      );
      assert.equal(wrongSession.ok, false);
      if (!wrongSession.ok) assert.equal(wrongSession.status, 401);

      const disable = await handleRequest(
        new Request("http://internal.local:8099/api/interactive-sessions/share-1/actions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Origin: "http://internal.local:8099",
            cookie,
          },
          body: JSON.stringify({ action: "disable_share" }),
        }),
        env,
      );
      assert.equal(disable.status, 200);

      const revoked = await authorizeTerminalBridge(
        new Request(`http://internal.local:8099/api/terminal/ws?shareSession=share-1&token=${token}`),
        env,
        "share-1",
        "view",
      );
      assert.equal(revoked.ok, false);
      if (!revoked.ok) assert.equal(revoked.status, 401);
    });
  });
});

describe("agent interactive sessions", () => {
  it("scopes agent tokens to their own session path", async () => {
    await withTestEnv(async ({ db, env }) => {
      await insertInteractiveSession(db, "agent-1", "agent-one");
      await insertInteractiveSession(db, "agent-2", "agent-two");

      const own = await handleRequest(agentRequest("GET", "agent-1", "agent-1", "agent-one"), env);
      assert.equal(own.status, 200);

      const other = await handleRequest(agentRequest("GET", "agent-2", "agent-1", "agent-one"), env);
      assert.equal(other.status, 403);

      const logs = await handleRequest(
        agentRequest("GET", "agent-2/logs", "agent-1", "agent-one"),
        env,
      );
      assert.equal(logs.status, 403);

      const summary = await handleRequest(
        agentRequest("POST", "agent-2/summary", "agent-1", "agent-one", {
          purpose: "changed",
          summary: "changed",
        }),
        env,
      );
      assert.equal(summary.status, 403);

      const pty = await handleRequest(
        agentRequest("GET", "agent-2/pty", "agent-1", "agent-one"),
        env,
      );
      assert.equal(pty.status, 403);
    });
  });
});

async function insertInteractiveSession(
  db: Kysely<unknown>,
  id: string,
  agentToken?: string,
): Promise<void> {
  const now = Date.now();
  await sql`
    INSERT INTO interactive_sessions (
      id,
      repo,
      branch,
      runtime,
      command,
      prompt,
      owner,
      status,
      lease_id,
      attach_url,
      vnc_url,
      last_event,
      created_at,
      updated_at,
      last_seen_at,
      stopped_at,
      root_session_id,
      created_by,
      purpose,
      summary,
      agent_token_hash
    )
    VALUES (
      ${id},
      ${"openclaw/crabfleet"},
      ${"main"},
      ${"crabbox"},
      ${"codex --yolo"},
      ${"test share"},
      ${"bootstrap"},
      ${"ready"},
      ${"crabbox:lease-1"},
      ${"ssh://root@example.test:22"},
      ${null},
      ${"ready"},
      ${now},
      ${now},
      ${now},
      ${null},
      ${id},
      ${"bootstrap"},
      ${"test"},
      ${"test share"},
      ${agentToken ? sha256Hex(agentToken) : null}
    )
  `.execute(db);
}

function tokenRequest(origin: string, token: string): Request {
  return new Request(`${origin}/api/login/token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify({ token }),
  });
}

function agentRequest(
  method: "GET" | "POST",
  path: string,
  sessionId: string,
  token: string,
  body?: Record<string, unknown>,
): Request {
  return new Request(
    `http://internal.local:8099/api/agent/interactive-sessions/${path}?sessionId=${sessionId}`,
    {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function withTestEnv(
  run: (ctx: { db: Kysely<unknown>; env: RuntimeEnv }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "lobsterfleet-shared-"));
  const { db, raw } = openDatabaseWithHandle(join(root, "test.db"));
  runMigrations(raw);
  const previous = {
    token: process.env.CRABBOX_BOOTSTRAP_TOKEN,
    archiveDir: process.env.SESSION_ARCHIVE_DIR,
    publicUrl: process.env.LOBSTERFLEET_PUBLIC_URL,
  };
  process.env.CRABBOX_BOOTSTRAP_TOKEN = "dev";
  process.env.SESSION_ARCHIVE_DIR = join(root, "archives");
  process.env.LOBSTERFLEET_PUBLIC_URL = "https://fleet.example.test";
  try {
    const env = buildEnv(db) as RuntimeEnv;
    env.CRABBOX_BOOTSTRAP_TOKEN = "dev";
    env.LOBSTERFLEET_PUBLIC_URL = "https://fleet.example.test";
    await run({ db, env });
  } finally {
    restoreEnv("CRABBOX_BOOTSTRAP_TOKEN", previous.token);
    restoreEnv("SESSION_ARCHIVE_DIR", previous.archiveDir);
    restoreEnv("LOBSTERFLEET_PUBLIC_URL", previous.publicUrl);
    await db.destroy();
    await rm(root, { recursive: true, force: true });
  }
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
