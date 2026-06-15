import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { resolveRuntimePath } from "../runtimePaths.js";

// Resolves the codex credential this host carries. The deployment requirement
// is: codex is installed and authed on the host (the LXC / container), and the
// app hands that credential to every crabbox it leases.
//
// Lookup order:
//   1. LOBSTERFLEET_CODEX_AUTH_PATH  - explicit auth.json path
//   2. $CODEX_HOME/auth.json      - codex's own home override
//   3. ~/.codex/auth.json         - the default codex login location
//   4. OPENAI_API_KEY             - synthesized api-key auth.json

export type CodexAuthEnv = Record<string, string | undefined>;

export type HostCodexAuth = {
  // auth.json contents to place on the box
  json: string;
  // where it came from, for logs and session events
  source: "host" | "api-key";
};

function lookup(env: CodexAuthEnv, key: string): string | undefined {
  const value = env[key] ?? process.env[key];
  return value?.trim() ? value.trim() : undefined;
}

export function hostCodexAuthPath(env: CodexAuthEnv = {}): string {
  const explicit = lookup(env, "LOBSTERFLEET_CODEX_AUTH_PATH");
  if (explicit) return resolveRuntimePath(explicit);
  const codexHome = lookup(env, "CODEX_HOME");
  if (codexHome) return join(resolveRuntimePath(codexHome), "auth.json");
  return join(homedir(), ".codex", "auth.json");
}

export function readHostCodexAuth(env: CodexAuthEnv = {}): HostCodexAuth | null {
  const path = hostCodexAuthPath(env);
  try {
    const raw = readFileSync(path, "utf8");
    JSON.parse(raw); // a corrupt file should fall through, not ship to boxes
    return { json: raw, source: "host" };
  } catch {
    // missing or unreadable, try the api key fallback
  }
  const apiKey = lookup(env, "OPENAI_API_KEY");
  if (apiKey) {
    return {
      json: JSON.stringify({ OPENAI_API_KEY: apiKey, auth_mode: "apikey" }),
      source: "api-key",
    };
  }
  return null;
}

// The host's codex config and instructions, copied to boxes next to auth.json
// so codex behaves the same there as it does here. Both optional.
export type HostCodexExtras = {
  configToml: string | null;
  agentsMd: string | null;
};

export function readHostCodexExtras(env: CodexAuthEnv = {}): HostCodexExtras {
  const dir = dirname(hostCodexAuthPath(env));
  return {
    configToml: readOptional(join(dir, "config.toml")),
    agentsMd: readOptional(join(dir, "AGENTS.md")),
  };
}

function readOptional(path: string): string | null {
  try {
    const raw = readFileSync(path, "utf8");
    return raw.trim() ? raw : null;
  } catch {
    return null;
  }
}
