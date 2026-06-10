import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import type { Kysely } from "kysely";
import { buildEnv } from "../src/env.js";

const KEYS = [
  "CRABBOX_BOOTSTRAP_TOKEN",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "CRABBOX_COORDINATOR_URL",
  "CRABBOX_COORDINATOR_TOKEN",
  "CRABBOX_COORDINATOR_SSH_PUBLIC_KEY",
  "CRABBOX_SSH_PRIVATE_KEY_PATH",
  "CRABBOX_TOKEN_ENCRYPTION_KEY",
  "LOBSTERFLEET_PUBLIC_URL",
  "SESSION_ARCHIVE_DIR",
  "NODE_ENV",
] as const;

describe("runtime preflight", () => {
  it("marks placeholder production settings as missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "lobsterfleet-preflight-"));
    await withEnv(
      {
        CRABBOX_BOOTSTRAP_TOKEN: "dev",
        CRABBOX_COORDINATOR_URL: "no",
        CRABBOX_COORDINATOR_TOKEN: "no",
        CRABBOX_COORDINATOR_SSH_PUBLIC_KEY: "no",
        CRABBOX_SSH_PRIVATE_KEY_PATH: join(root, "missing_key"),
        CRABBOX_TOKEN_ENCRYPTION_KEY: "no",
        SESSION_ARCHIVE_DIR: join(root, "archives"),
      },
      async () => {
        const env = buildEnv({} as Kysely<unknown>);
        const items = itemMap(env.__preflight);

        assert.equal(env.__preflight?.status, "missing");
        assert.equal(items.get("coordinator_url")?.status, "missing");
        assert.equal(items.get("coordinator_token")?.status, "missing");
        assert.equal(items.get("coordinator_ssh_key")?.status, "missing");
        assert.equal(items.get("ssh_private_key")?.status, "missing");
        assert.equal(items.get("token_encryption")?.status, "missing");
        assert.equal(items.get("session_archives")?.status, "ok");
        assert.equal(items.get("public_url")?.status, "warning");
        assert.equal(items.get("sign_in")?.status, "ok");
      },
    );
    await rm(root, { recursive: true, force: true });
  });

  it("reports ready config without exposing secret values", async () => {
    const root = await mkdtemp(join(tmpdir(), "lobsterfleet-preflight-"));
    const keyPath = join(root, "crabbox_key");
    const archiveDir = join(root, "archives");
    await mkdir(archiveDir, { recursive: true });
    await writeFile(keyPath, "-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n");

    await withEnv(
      {
        CRABBOX_BOOTSTRAP_TOKEN: "bootstrap-secret",
        CRABBOX_COORDINATOR_URL: "https://broker.example.test",
        CRABBOX_COORDINATOR_TOKEN: "broker-secret",
        CRABBOX_COORDINATOR_SSH_PUBLIC_KEY: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest",
        CRABBOX_SSH_PRIVATE_KEY_PATH: keyPath,
        CRABBOX_TOKEN_ENCRYPTION_KEY: "token-encryption-secret",
        LOBSTERFLEET_PUBLIC_URL: "https://fleet.example.test",
        SESSION_ARCHIVE_DIR: archiveDir,
      },
      async () => {
        const env = buildEnv({} as Kysely<unknown>);
        const details = JSON.stringify(env.__preflight);

        assert.equal(env.__preflight?.status, "ok");
        assert.ok(!details.includes("bootstrap-secret"));
        assert.ok(!details.includes("broker-secret"));
        assert.ok(!details.includes("token-encryption-secret"));
        assert.ok(!details.includes("AAAAC3NzaC1lZDI1NTE5AAAAITest"));
      },
    );
    await rm(root, { recursive: true, force: true });
  });

  it("warns when token encryption falls back to the GitHub client secret", async () => {
    await withEnv(
      {
        GITHUB_CLIENT_SECRET: "github-client-secret",
      },
      async () => {
        const env = buildEnv({} as Kysely<unknown>);
        const items = itemMap(env.__preflight);
        const details = JSON.stringify(env.__preflight);

        assert.equal(items.get("token_encryption")?.status, "warning");
        assert.ok(!details.includes("github-client-secret"));
      },
    );
  });

  it("warns when production public URL still points at localhost", async () => {
    await withEnv(
      {
        NODE_ENV: "production",
        LOBSTERFLEET_PUBLIC_URL: "http://localhost:8088",
      },
      async () => {
        const env = buildEnv({} as Kysely<unknown>);
        const items = itemMap(env.__preflight);

        assert.equal(items.get("public_url")?.status, "warning");
      },
    );
  });
});

async function withEnv(values: Record<string, string>, run: () => Promise<void>): Promise<void> {
  const previous = new Map(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  try {
    await run();
  } finally {
    for (const key of KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function itemMap(
  preflight: { items: { id: string; status: string }[] } | undefined,
): Map<string, { status: string }> {
  return new Map((preflight?.items ?? []).map((item) => [item.id, item]));
}
