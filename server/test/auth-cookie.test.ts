import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { buildEnv } from "../src/env.js";
import { handleRequest, type RuntimeEnv } from "../src/core/index.js";
import { openDatabaseWithHandle } from "../src/db.js";
import { runMigrations } from "../src/migrate.js";

describe("bootstrap session cookies", () => {
  it("sets HttpOnly SameSite cookies and allows the new session", async () => {
    await withTestEnv(async ({ env }) => {
      const login = await handleRequest(tokenRequest("http://localhost:8099", "dev"), env);
      const cookie = login.headers.get("set-cookie") ?? "";

      assert.equal(login.status, 200);
      assert.match(cookie, /^crabbox_session=/);
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /SameSite=Lax/);
      assert.match(cookie, /Path=\//);
      assert.ok(!cookie.includes("Secure"));

      const session = await handleRequest(
        new Request("http://localhost:8099/api/session", { headers: { cookie } }),
        env,
      );
      assert.equal(session.status, 200);
      const body = (await session.json()) as { user?: { role?: string; login?: string } };
      assert.equal(body.user?.role, "owner");
      assert.equal(body.user?.login, "bootstrap");
    });
  });

  it("sets Secure on HTTPS sessions", async () => {
    await withTestEnv(async ({ env }) => {
      const login = await handleRequest(tokenRequest("https://lobsterfleet.example.test", "dev"), env);
      const cookie = login.headers.get("set-cookie") ?? "";

      assert.equal(login.status, 200);
      assert.match(cookie, /Secure/);
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /SameSite=Lax/);
    });
  });

  it("rejects invalid bootstrap tokens without creating a cookie", async () => {
    await withTestEnv(async ({ env }) => {
      const login = await handleRequest(tokenRequest("http://localhost:8099", "wrong"), env);

      assert.equal(login.status, 401);
      assert.equal(login.headers.get("set-cookie"), null);
      assert.deepEqual(await login.json(), { error: "invalid token" });
    });
  });
});

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

async function withTestEnv(
  run: (ctx: { env: RuntimeEnv }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "lobsterfleet-auth-"));
  const { db, raw } = openDatabaseWithHandle(join(root, "test.db"));
  runMigrations(raw);
  const previousToken = process.env.CRABBOX_BOOTSTRAP_TOKEN;
  const previousArchiveDir = process.env.SESSION_ARCHIVE_DIR;
  process.env.CRABBOX_BOOTSTRAP_TOKEN = "dev";
  process.env.SESSION_ARCHIVE_DIR = join(root, "archives");
  try {
    const env = buildEnv(db) as RuntimeEnv;
    env.CRABBOX_BOOTSTRAP_TOKEN = "dev";
    await run({ env });
  } finally {
    if (previousToken === undefined) delete process.env.CRABBOX_BOOTSTRAP_TOKEN;
    else process.env.CRABBOX_BOOTSTRAP_TOKEN = previousToken;
    if (previousArchiveDir === undefined) delete process.env.SESSION_ARCHIVE_DIR;
    else process.env.SESSION_ARCHIVE_DIR = previousArchiveDir;
    await db.destroy();
    await rm(root, { recursive: true, force: true });
  }
}
