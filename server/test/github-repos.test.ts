// Covers the token-backed repo and branch list endpoints plus the strict
// repo allowlist gate on session create.

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, describe, it } from "node:test";
import { sql, type Kysely } from "kysely";
import { buildEnv } from "../src/env.js";
import { handleRequest, type RuntimeEnv } from "../src/core/index.js";
import { openDatabaseWithHandle } from "../src/db.js";
import { runMigrations } from "../src/migrate.js";

const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

describe("github repo listing", () => {
  it("returns token-visible repos, skipping archived ones", async () => {
    await withTestEnv(async ({ env }) => {
      env.LOBSTERFLEET_GITHUB_TOKEN = "list-token-1";
      stubGitHub({
        "/user/repos": [
          { full_name: "Acme/Active", archived: false, disabled: false },
          { full_name: "acme/old", archived: true, disabled: false },
          { full_name: "acme/broken", archived: false, disabled: true },
        ],
      });

      const cookie = await login(env);
      const res = await handleRequest(apiRequest("GET", "/api/github/repos", cookie), env);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { repos: string[] };
      assert.deepEqual(body.repos, ["acme/active"]);
    });
  });

  it("rejects with a clear error when no token is configured", async () => {
    await withTestEnv(async ({ env }) => {
      delete env.LOBSTERFLEET_GITHUB_TOKEN;
      delete env.GITHUB_TOKEN;

      const cookie = await login(env);
      const res = await handleRequest(apiRequest("GET", "/api/github/repos", cookie), env);
      assert.equal(res.status, 400);
    });
  });
});

describe("repo allowlist gate on session create", () => {
  it("blocks repos outside the allowlist even when the token can see them", async () => {
    await withTestEnv(async ({ db, env }) => {
      env.LOBSTERFLEET_GITHUB_TOKEN = "gate-token-1";
      // token would see the repo, but the allowlist is the only gate now
      stubGitHub({ "/repos/acme/fresh": { full_name: "acme/fresh" } });

      const cookie = await login(env);
      const res = await handleRequest(
        apiRequest("POST", "/api/interactive-sessions", cookie, {
          repo: "acme/fresh",
          branch: "main",
        }),
        env,
      );
      assert.equal(res.status, 403);

      const row = await sql<{ repo: string }>`SELECT repo FROM repos`.execute(db);
      assert.equal(row.rows.length, 0);
    });
  });

  it("lets allowlisted repos through the gate", async () => {
    await withTestEnv(async ({ db, env }) => {
      env.LOBSTERFLEET_GITHUB_TOKEN = "gate-token-2";
      stubGitHub({});
      await allowlistRepo(db, "acme/fresh");

      const cookie = await login(env);
      const res = await handleRequest(
        apiRequest("POST", "/api/interactive-sessions", cookie, {
          repo: "acme/fresh",
          branch: "main",
        }),
        env,
      );
      // provisioning may fail (no broker in tests), the gate just must not 403
      assert.notEqual(res.status, 403);
    });
  });
});

describe("github branch listing", () => {
  it("rejects repos outside the allowlist", async () => {
    await withTestEnv(async ({ env }) => {
      env.LOBSTERFLEET_GITHUB_TOKEN = "branch-token-1";
      stubGitHub({});

      const cookie = await login(env);
      const res = await handleRequest(
        apiRequest("GET", "/api/github/branches?repo=acme/app", cookie),
        env,
      );
      assert.equal(res.status, 403);
    });
  });

  it("lists branches via graphql, default branch first and deduped", async () => {
    await withTestEnv(async ({ db, env }) => {
      env.LOBSTERFLEET_GITHUB_TOKEN = "branch-token-2";
      await allowlistRepo(db, "acme/app");
      stubGitHub({
        "/graphql": {
          data: {
            repository: {
              defaultBranchRef: { name: "main" },
              refs: { nodes: [{ name: "feat-z" }, { name: "main" }, { name: "fix-y" }] },
            },
          },
        },
      });

      const cookie = await login(env);
      const res = await handleRequest(
        apiRequest("GET", "/api/github/branches?repo=acme/app", cookie),
        env,
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as { branches: string[]; defaultBranch: string };
      assert.deepEqual(body, { branches: ["main", "feat-z", "fix-y"], defaultBranch: "main" });
    });
  });

  it("falls back to rest when graphql fails", async () => {
    await withTestEnv(async ({ db, env }) => {
      env.LOBSTERFLEET_GITHUB_TOKEN = "branch-token-3";
      await allowlistRepo(db, "acme/app");
      stubGitHub({
        "/graphql": { status: 500, body: {} },
        "/repos/acme/app": { default_branch: "main" },
        "/repos/acme/app/branches": [{ name: "a" }, { name: "main" }],
      });

      const cookie = await login(env);
      const res = await handleRequest(
        apiRequest("GET", "/api/github/branches?repo=acme/app", cookie),
        env,
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as { branches: string[]; defaultBranch: string };
      assert.deepEqual(body, { branches: ["main", "a"], defaultBranch: "main" });
    });
  });

  it("rejects with a clear error when no token is configured", async () => {
    await withTestEnv(async ({ db, env }) => {
      delete env.LOBSTERFLEET_GITHUB_TOKEN;
      delete env.GITHUB_TOKEN;
      await allowlistRepo(db, "acme/app");

      const cookie = await login(env);
      const res = await handleRequest(
        apiRequest("GET", "/api/github/branches?repo=acme/app", cookie),
        env,
      );
      assert.equal(res.status, 400);
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

// Routes github api paths to canned json. Anything not listed 404s.
// A route value shaped like { status, body } controls the status code,
// anything else comes back as 200 json.
function stubGitHub(routes: Record<string, unknown>): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "api.github.com") {
      return new Response("not stubbed", { status: 502 });
    }
    const hit = routes[url.pathname];
    if (hit === undefined) return new Response("{}", { status: 404 });
    const { status, body } =
      hit !== null && typeof hit === "object" && "status" in hit && "body" in hit
        ? (hit as { status: number; body: unknown })
        : { status: 200, body: hit };
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
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
  method: "GET" | "POST",
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
  const root = await mkdtemp(join(tmpdir(), "lobsterfleet-ghrepos-"));
  const { db, raw } = openDatabaseWithHandle(join(root, "test.db"));
  runMigrations(raw);
  const previous = {
    token: process.env.CRABBOX_BOOTSTRAP_TOKEN,
    archiveDir: process.env.SESSION_ARCHIVE_DIR,
  };
  process.env.CRABBOX_BOOTSTRAP_TOKEN = "dev";
  process.env.SESSION_ARCHIVE_DIR = join(root, "archives");
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
