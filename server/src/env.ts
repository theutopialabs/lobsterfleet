import { accessSync, constants, existsSync, mkdirSync, statSync } from "node:fs";
import type { Kysely } from "kysely";
import { createLocalBucket } from "./localBucket.js";
import { resolveRuntimePath } from "./runtimePaths.js";
import { hostCodexAuthPath, readHostCodexAuth } from "./crabbox/codexAuth.js";

// Builds the RuntimeEnv-shaped object the ported handler expects, reading every
// CRABBOX_*/GITHUB_*/OPENAI_* var from process.env. The DB handle gets attached
// separately at boot (env.__db) so database(env) can reuse one connection.
//
// The handler's RuntimeEnv type is `Env & {...}` where Env is an ambient index
// bag, so this plain object satisfies it. We type the return loosely to avoid a
// circular import with core/index.ts.

const KEYS = [
  "CRABBOX_BOOTSTRAP_TOKEN",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_REDIRECT_URI",
  "GITHUB_TOKEN",
  "LOBSTERFLEET_GITHUB_TOKEN",
  "GITHUB_ORG",
  "CRABBOX_INTERACTIVE_PROVISION_URL",
  "CRABBOX_INTERACTIVE_PROVISION_TOKEN",
  "CRABBOX_RUNTIME_PROVISION_URL",
  "CRABBOX_RUNTIME_PROVISION_TOKEN",
  "CRABBOX_CLOUDFLARE_RUNNER_URL",
  "CRABBOX_CLOUDFLARE_RUNNER_TOKEN",
  "CRABBOX_PTY_BRIDGE_URL",
  "CRABBOX_PTY_BRIDGE_TOKEN",
  "CRABBOX_CLAWFLEET_URL",
  "CRABBOX_CLAWFLEET_TOKEN",
  "CRABBOX_CLAWFLEET_PUBLIC_URL",
  "CRABBOX_COORDINATOR_URL",
  "CRABBOX_COORDINATOR_TOKEN",
  "CRABBOX_COORDINATOR_PUBLIC_URL",
  "CRABBOX_COORDINATOR_PROVIDER",
  "CRABBOX_COORDINATOR_CLASS",
  "CRABBOX_SIZE_CLASSES",
  "CRABBOX_COORDINATOR_SERVER_TYPE",
  "CRABBOX_COORDINATOR_LOCATION",
  "CRABBOX_COORDINATOR_PROVIDER_KEY",
  "CRABBOX_COORDINATOR_WORK_ROOT",
  "CRABBOX_COORDINATOR_DESKTOP",
  "CRABBOX_COORDINATOR_DESKTOP_ENV",
  "CRABBOX_COORDINATOR_TTL_SECONDS",
  "CRABBOX_COORDINATOR_IDLE_SECONDS",
  "CRABBOX_COORDINATOR_SSH_PUBLIC_KEY",
  "CRABBOX_SSH_PRIVATE_KEY_PATH",
  "CRABBOX_COORDINATOR_ORG",
  "CRABBOX_OWNER",
  "LOBSTERBOX_URL",
  "LOBSTERBOX_TOKEN",
  "LOBSTERBOX_OWNER",
  "LOBSTERBOX_REGION",
  "LOBSTERBOX_MACHINE",
  "LOBSTERBOX_TTL_SECONDS",
  "LOBSTERBOX_IDLE_SECONDS",
  "LOBSTERBOX_WORK_ROOT",
  "LOBSTERBOX_SSH_PUBLIC_KEY",
  "LOBSTERFLEET_PUBLIC_URL",
  "LOBSTERFLEET_REDIRECT_HOSTS",
  "CRABBOX_SSH_GATEWAY_TOKEN",
  "LOBSTERFLEET_SSH_GATEWAY_TOKEN",
  "CRABBOX_OPENCLAW_TOKEN",
  "CRABBOX_TOKEN_ENCRYPTION_KEY",
  "BACKUP_BUCKET_NAME",
  "CLOUDFLARE_ACCOUNT_ID",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORG_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "SESSION_ARCHIVE_DIR",
  "LOBSTERFLEET_ENABLE_DEV_IDENTITY",
  "LOBSTERFLEET_CODEX_AUTH_PATH",
  "LOBSTERFLEET_CODEX_BOOTSTRAP",
  "NODE_ENV",
] as const;

type RuntimePreflightStatus = "ok" | "warning" | "missing" | "error";

type RuntimePreflightItem = {
  id: string;
  label: string;
  status: RuntimePreflightStatus;
  detail: string;
};

type RuntimePreflight = {
  status: RuntimePreflightStatus;
  generatedAt: number;
  items: RuntimePreflightItem[];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RuntimeEnvLike = Record<string, any> & {
  __db?: Kysely<unknown>;
  __preflight?: RuntimePreflight;
  SESSION_LOGS?: R2Bucket;
};

export function buildEnv(db: Kysely<unknown>): RuntimeEnvLike {
  const archiveDir = resolveRuntimePath(process.env.SESSION_ARCHIVE_DIR ?? "./data/archives");
  const env: RuntimeEnvLike = {
    __db: db,
    __preflight: runtimePreflight(archiveDir),
    SESSION_LOGS: createLocalBucket(archiveDir),
  };
  for (const key of KEYS) {
    const value = process.env[key];
    if (value !== undefined && value !== "") env[key] = value;
  }
  // Cloudflare-only bindings we dropped. SESSION_LOGS is a local bucket now.
  // SANDBOX / DB / BACKUP_BUCKET stay undefined on purpose.
  return env;
}

const PLACEHOLDERS = new Set(["no", "none", "todo", "tbd", "changeme", "placeholder"]);

function runtimePreflight(archiveDir: string): RuntimePreflight {
  const items = [
    coordinatorUrlItem(),
    requiredEnvItem("coordinator_token", "Broker token", "LOBSTERBOX_TOKEN"),
    sshPublicKeyItem(),
    sshPrivateKeyItem(),
    archiveDirItem(archiveDir),
    tokenEncryptionItem(),
    codexAuthItem(),
    publicUrlItem(),
    signInItem(),
  ];
  return {
    status: overallStatus(items),
    generatedAt: Date.now(),
    items,
  };
}

function coordinatorUrlItem(): RuntimePreflightItem {
  const value = cleanEnv(process.env.LOBSTERBOX_URL);
  if (!meaningful(value)) {
    return missing("coordinator_url", "Broker URL", "Set LOBSTERBOX_URL");
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return problem("coordinator_url", "Broker URL", "error", "Use an http or https URL");
    }
    return ok("coordinator_url", "Broker URL", url.host);
  } catch {
    return problem("coordinator_url", "Broker URL", "error", "URL is not valid");
  }
}

function sshPublicKeyItem(): RuntimePreflightItem {
  const value = cleanEnv(
    process.env.LOBSTERBOX_SSH_PUBLIC_KEY ?? process.env.CRABBOX_COORDINATOR_SSH_PUBLIC_KEY,
  );
  if (!meaningful(value)) {
    return missing("coordinator_ssh_key", "Runner SSH key", "Set LOBSTERBOX_SSH_PUBLIC_KEY");
  }
  if (!/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-)/.test(value)) {
    return problem("coordinator_ssh_key", "Coordinator SSH key", "warning", "Value does not look like an SSH public key");
  }
  return ok("coordinator_ssh_key", "Coordinator SSH key", "Public key is present");
}

function sshPrivateKeyItem(): RuntimePreflightItem {
  const keyPath = process.env.CRABBOX_SSH_PRIVATE_KEY_PATH ?? "./data/crabbox_key";
  if (!meaningful(keyPath)) {
    return missing("ssh_private_key", "SSH private key", "Set CRABBOX_SSH_PRIVATE_KEY_PATH");
  }
  const file = resolveRuntimePath(keyPath);
  try {
    if (!existsSync(file)) {
      return missing("ssh_private_key", "SSH private key", `Missing at ${keyPath}`);
    }
    const stat = statSync(file);
    if (!stat.isFile()) {
      return problem("ssh_private_key", "SSH private key", "error", `${keyPath} is not a file`);
    }
    accessSync(file, constants.R_OK);
    return ok("ssh_private_key", "SSH private key", `Readable at ${keyPath}`);
  } catch {
    return problem("ssh_private_key", "SSH private key", "error", `Cannot read ${keyPath}`);
  }
}

function archiveDirItem(dir: string): RuntimePreflightItem {
  try {
    const full = resolveRuntimePath(dir);
    mkdirSync(full, { recursive: true });
    const stat = statSync(full);
    if (!stat.isDirectory()) {
      return problem("session_archives", "Session archives", "error", `${dir} is not a directory`);
    }
    accessSync(full, constants.R_OK | constants.W_OK);
    return ok("session_archives", "Session archives", `Writable at ${dir}`);
  } catch {
    return problem("session_archives", "Session archives", "error", `Cannot write ${dir}`);
  }
}

function publicUrlItem(): RuntimePreflightItem {
  const value = cleanEnv(process.env.LOBSTERFLEET_PUBLIC_URL);
  if (!meaningful(value)) {
    return problem("public_url", "Public URL", "warning", "Set LOBSTERFLEET_PUBLIC_URL for production links");
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return problem("public_url", "Public URL", "error", "Use an http or https URL");
    }
    if (isProductionEnv() && isLocalHostname(url.hostname)) {
      return problem(
        "public_url",
        "Public URL",
        "warning",
        "Set this to the URL users and agents can reach",
      );
    }
    return ok("public_url", "Public URL", url.origin);
  } catch {
    return problem("public_url", "Public URL", "error", "URL is not valid");
  }
}

function tokenEncryptionItem(): RuntimePreflightItem {
  if (meaningful(process.env.CRABBOX_TOKEN_ENCRYPTION_KEY)) {
    return ok("token_encryption", "Token encryption", "Dedicated key is configured");
  }
  if (meaningful(process.env.GITHUB_CLIENT_SECRET)) {
    return problem(
      "token_encryption",
      "Token encryption",
      "warning",
      "Using GitHub client secret fallback",
    );
  }
  return missing(
    "token_encryption",
    "Token encryption",
    "Set CRABBOX_TOKEN_ENCRYPTION_KEY",
  );
}

function codexAuthItem(): RuntimePreflightItem {
  const auth = readHostCodexAuth();
  if (auth?.source === "host") {
    return ok("codex_auth", "Codex auth", `Host credential at ${hostCodexAuthPath()}`);
  }
  if (auth?.source === "api-key") {
    return ok("codex_auth", "Codex auth", "Using OPENAI_API_KEY");
  }
  return missing(
    "codex_auth",
    "Codex auth",
    "Install codex and sign in on this host, or set OPENAI_API_KEY",
  );
}

function signInItem(): RuntimePreflightItem {
  const hasBootstrap = meaningful(process.env.CRABBOX_BOOTSTRAP_TOKEN);
  const hasGithub = meaningful(process.env.GITHUB_CLIENT_ID) && meaningful(process.env.GITHUB_CLIENT_SECRET);
  if (hasGithub) return ok("sign_in", "Sign-in path", "GitHub OAuth is configured");
  if (hasBootstrap) return ok("sign_in", "Sign-in path", "Bootstrap token is configured");
  return missing("sign_in", "Sign-in path", "Set GitHub OAuth or CRABBOX_BOOTSTRAP_TOKEN");
}

function requiredEnvItem(id: string, label: string, key: string): RuntimePreflightItem {
  return meaningful(process.env[key]) ? ok(id, label, "Configured") : missing(id, label, `Set ${key}`);
}

function cleanEnv(value: string | undefined): string {
  return value?.trim() ?? "";
}

function meaningful(value: string | undefined): boolean {
  const trimmed = value?.trim();
  return Boolean(trimmed && !PLACEHOLDERS.has(trimmed.toLowerCase()));
}

function isProductionEnv(): boolean {
  return cleanEnv(process.env.NODE_ENV).toLowerCase() === "production";
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

function ok(id: string, label: string, detail: string): RuntimePreflightItem {
  return { id, label, status: "ok", detail };
}

function missing(id: string, label: string, detail: string): RuntimePreflightItem {
  return { id, label, status: "missing", detail };
}

function problem(
  id: string,
  label: string,
  status: "warning" | "error",
  detail: string,
): RuntimePreflightItem {
  return { id, label, status, detail };
}

function overallStatus(items: RuntimePreflightItem[]): RuntimePreflightStatus {
  if (items.some((item) => item.status === "error")) return "error";
  if (items.some((item) => item.status === "missing")) return "missing";
  if (items.some((item) => item.status === "warning")) return "warning";
  return "ok";
}
