import { readFileSync } from "node:fs";
import { Client } from "ssh2";
import { readHostCodexAuth, type CodexAuthEnv } from "./codexAuth.js";

// Makes a freshly leased crabbox codex-ready: copies the host's codex
// credential onto the box and installs the codex CLI if the image lacks it.
// Runs once during provisioning, over the same app-managed SSH key the
// terminal bridge uses.

export type CodexBootstrapTarget = {
  host: string;
  port: number;
  user: string;
  privateKeyPath: string;
};

export type CodexBootstrapResult = {
  status: "ready" | "skipped" | "failed";
  detail: string;
  // sha256 hex of the box host key, observed on this first connection.
  // The caller pins it so the terminal bridge verifies later connects.
  hostKey: string | null;
};

// Write auth.json over stdin (never on a command line), then install codex
// from the official npm registry if the image does not ship it.
const BOOTSTRAP_SCRIPT = `bash -c 'set -e; umask 077; mkdir -p "$HOME/.codex"; cat > "$HOME/.codex/auth.json"; if ! command -v codex >/dev/null 2>&1; then export DEBIAN_FRONTEND=noninteractive; (sudo -n apt-get install -y -qq nodejs npm >/dev/null 2>&1 || (sudo -n apt-get update -qq >/dev/null 2>&1 && sudo -n apt-get install -y -qq nodejs npm >/dev/null 2>&1)) && sudo -n npm install -g @openai/codex >/dev/null 2>&1 || true; fi; command -v codex >/dev/null 2>&1 && codex --version || echo CODEX_MISSING'`;

const BOOTSTRAP_TIMEOUT_MS = 4 * 60 * 1000;

function bootstrapDisabled(env: CodexAuthEnv): boolean {
  const raw = (env.LOBSTERFLEET_CODEX_BOOTSTRAP ?? process.env.LOBSTERFLEET_CODEX_BOOTSTRAP ?? "")
    .trim()
    .toLowerCase();
  return raw === "0" || raw === "false" || raw === "never" || raw === "off";
}

export async function bootstrapCodexOnBox(
  env: CodexAuthEnv,
  target: CodexBootstrapTarget,
): Promise<CodexBootstrapResult> {
  if (bootstrapDisabled(env)) {
    return { status: "skipped", detail: "codex bootstrap disabled", hostKey: null };
  }
  const auth = readHostCodexAuth(env);
  if (!auth) {
    return {
      status: "skipped",
      detail: "no codex auth on host; run codex login on this host or set OPENAI_API_KEY",
      hostKey: null,
    };
  }

  let privateKey: Buffer;
  try {
    privateKey = readFileSync(target.privateKeyPath);
  } catch (error) {
    return {
      status: "failed",
      detail: `cannot read ssh key: ${String(error).slice(0, 160)}`,
      hostKey: null,
    };
  }

  return new Promise((resolve) => {
    const conn = new Client();
    let hostKey: string | null = null;
    let settled = false;
    const finish = (result: Omit<CodexBootstrapResult, "hostKey">): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        conn.end();
      } catch {
        // already gone
      }
      resolve({ ...result, hostKey });
    };
    const timer = setTimeout(
      () => finish({ status: "failed", detail: "codex bootstrap timed out" }),
      BOOTSTRAP_TIMEOUT_MS,
    );

    conn.on("ready", () => {
      conn.exec(BOOTSTRAP_SCRIPT, (err, stream) => {
        if (err || !stream) {
          finish({
            status: "failed",
            detail: `codex bootstrap exec failed: ${err ? err.message : "no stream"}`,
          });
          return;
        }
        let output = "";
        stream.on("data", (chunk: Buffer) => {
          output += chunk.toString("utf8");
        });
        stream.stderr.on("data", (chunk: Buffer) => {
          output += chunk.toString("utf8");
        });
        stream.on("close", (code: number | null) => {
          const text = output.trim();
          if (code === 0 && /codex-cli/i.test(text)) {
            finish({
              status: "ready",
              detail: `codex ready (${text.split("\n").pop()}, ${auth.source} auth)`,
            });
          } else if (/CODEX_MISSING/.test(text)) {
            finish({
              status: "failed",
              detail: "codex auth placed, but codex install failed on the box",
            });
          } else {
            finish({
              status: "failed",
              detail: `codex bootstrap exited ${code ?? "?"}: ${text.slice(0, 160)}`,
            });
          }
        });
        // auth.json goes in over stdin; EOF lets the script continue
        stream.write(auth.json);
        stream.end();
      });
    });

    conn.on("error", (err) => {
      finish({ status: "failed", detail: `codex bootstrap ssh error: ${err.message}` });
    });

    conn.connect({
      host: target.host,
      port: target.port,
      username: target.user,
      privateKey,
      readyTimeout: 30_000,
      hostHash: "sha256",
      // First contact with a fresh lease: record the host key so the caller
      // can pin it (TOFU). The terminal bridge verifies against the pin later.
      hostVerifier: (data: Buffer | string): boolean => {
        hostKey = typeof data === "string" ? data : data.toString("hex");
        return true;
      },
    });
  });
}
