import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { hostCodexAuthPath, readHostCodexAuth } from "../src/crabbox/codexAuth.js";

describe("host codex auth resolution", () => {
  it("prefers the explicit auth path override", async () => {
    await withTempDir(async (root) => {
      const file = join(root, "auth.json");
      await writeFile(file, JSON.stringify({ tokens: { access_token: "t" } }));
      const env = { LOBSTERFLEET_CODEX_AUTH_PATH: file };

      assert.equal(hostCodexAuthPath(env), file);
      const auth = readHostCodexAuth(env);
      assert.equal(auth?.source, "host");
      assert.match(auth?.json ?? "", /access_token/);
    });
  });

  it("resolves auth.json under CODEX_HOME", async () => {
    await withTempDir(async (root) => {
      await writeFile(join(root, "auth.json"), JSON.stringify({ auth_mode: "chatgpt" }));
      const env = { CODEX_HOME: root };

      assert.equal(hostCodexAuthPath(env), join(root, "auth.json"));
      assert.equal(readHostCodexAuth(env)?.source, "host");
    });
  });

  it("falls back to OPENAI_API_KEY when no host file exists", async () => {
    await withTempDir(async (root) => {
      const env = {
        LOBSTERFLEET_CODEX_AUTH_PATH: join(root, "missing.json"),
        OPENAI_API_KEY: "sk-test-123",
      };

      const auth = readHostCodexAuth(env);
      assert.equal(auth?.source, "api-key");
      assert.deepEqual(JSON.parse(auth?.json ?? "{}"), {
        OPENAI_API_KEY: "sk-test-123",
        auth_mode: "apikey",
      });
    });
  });

  it("ignores a corrupt auth file instead of shipping it to boxes", async () => {
    await withTempDir(async (root) => {
      const file = join(root, "auth.json");
      await writeFile(file, "not json {");
      const env = { LOBSTERFLEET_CODEX_AUTH_PATH: file, OPENAI_API_KEY: "sk-fallback" };

      assert.equal(readHostCodexAuth(env)?.source, "api-key");
    });
  });

  it("returns null when nothing is configured", async () => {
    await withTempDir(async (root) => {
      const env = { LOBSTERFLEET_CODEX_AUTH_PATH: join(root, "missing.json"), OPENAI_API_KEY: "" };
      assert.equal(readHostCodexAuth(env), null);
    });
  });
});

async function withTempDir(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "lobsterfleet-codex-"));
  // keep process.env's real OPENAI_API_KEY from leaking into assertions
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await run(root);
  } finally {
    if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
    await rm(root, { recursive: true, force: true });
  }
}
