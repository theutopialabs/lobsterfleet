import { readFileSync } from "node:fs";
import { Client } from "ssh2";
import { readHostCodexAuth, readHostCodexExtras, type CodexAuthEnv } from "./codexAuth.js";
import { readProjectCodexDefaults } from "./codexDefaults.js";

// Makes a freshly leased crabbox ready to work: copies the host's codex
// credential + config onto the box, installs the codex CLI / git / tmux if the
// image lacks them, clones the session's repo, and starts the session command
// (codex) inside a detached tmux session so work begins before anyone attaches.
// Runs once during provisioning, over the same app-managed SSH key the
// terminal bridge uses.

export type CodexBootstrapTarget = {
  host: string;
  port: number;
  user: string;
  privateKeyPath: string;
};

// What to set up on the box beyond codex itself. All optional: without it the
// bootstrap degrades to the old credential-only behavior.
export type CodexWorkspace = {
  repo?: string; // org/repo
  branch?: string;
  command?: string; // started inside tmux, e.g. "codex --yolo"
  prompt?: string; // written to .crabbox-prompt.md and fed to the command
  configToml?: string | null;
  agentsMd?: string | null;
  githubToken?: string; // for private clones and pushes
};

export type CodexBootstrapResult = {
  status: "ready" | "skipped" | "failed";
  detail: string;
  // sha256 hex of the box host key, observed on this first connection.
  // The caller pins it so the terminal bridge verifies later connects.
  hostKey: string | null;
};

// Everything dynamic (secrets, repo, branch, command, prompt) is streamed over
// stdin as length-prefixed parts, so the remote script is static and nothing
// sensitive shows up in argv / ps on the box. Part order must match
// buildBootstrapStdin below. rp reads one part: a byte-count line, then
// exactly that many bytes. No single quotes anywhere (the script is wrapped
// in bash -c '...').
//
// set -e is on, so anything allowed to fail sits in a condition or || true.
// Exported so tests can run it locally against a temp HOME.
export const BOOTSTRAP_SCRIPT = `bash -c 'set -e; umask 077
rp() { local n; IFS= read -r n; case "$n" in (""|*[!0-9]*) n=0;; esac; if [ "$n" -gt 0 ]; then dd bs=1 count="$n" 2>/dev/null; fi; }
mkdir -p "$HOME/.codex"
rp > "$HOME/.codex/auth.json"
CFG=$(rp); if [ -n "$CFG" ]; then printf "%s\\n" "$CFG" > "$HOME/.codex/config.toml"; fi
AGM=$(rp); if [ -n "$AGM" ]; then printf "%s\\n" "$AGM" > "$HOME/.codex/AGENTS.md"; fi
CRED=$(rp); URL=$(rp); BRANCH=$(rp); DIR=$(rp); CMD=$(rp); PROMPT=$(rp)
export DEBIAN_FRONTEND=noninteractive
i=0; while [ $i -lt 40 ]; do command -v codex >/dev/null 2>&1 && command -v git >/dev/null 2>&1 && command -v tmux >/dev/null 2>&1 && break; i=$((i+1)); sleep 5; done
if ! command -v codex >/dev/null 2>&1; then
  sudo -n apt-get -o DPkg::Lock::Timeout=300 install -y -qq curl ca-certificates git tmux >/dev/null 2>&1 || true
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -n bash - >/dev/null 2>&1 && sudo -n apt-get -o DPkg::Lock::Timeout=300 install -y -qq nodejs >/dev/null 2>&1 || true
  sudo -n npm install -g @openai/codex >/dev/null 2>&1 || true
fi
command -v git >/dev/null 2>&1 || sudo -n apt-get install -y -qq git >/dev/null 2>&1 || true
command -v tmux >/dev/null 2>&1 || sudo -n apt-get install -y -qq tmux >/dev/null 2>&1 || true
if [ -n "$CRED" ]; then printf "%s\\n" "$CRED" > "$HOME/.git-credentials"; chmod 600 "$HOME/.git-credentials"; git config --global credential.helper store >/dev/null 2>&1 || true; fi
git config --global --get user.email >/dev/null 2>&1 || git config --global user.email crabbox@lobsterfleet.local >/dev/null 2>&1 || true
git config --global --get user.name >/dev/null 2>&1 || git config --global user.name crabbox >/dev/null 2>&1 || true
WORK="$HOME/work"; mkdir -p "$WORK"; TDIR="$HOME"
if [ -n "$URL" ] && [ -n "$DIR" ] && command -v git >/dev/null 2>&1; then
  TDIR="$WORK/$DIR"
  if [ -d "$TDIR/.git" ]; then echo CLONE_EXISTS
  elif git clone --branch "$BRANCH" --single-branch "$URL" "$TDIR" >/dev/null 2>&1; then echo CLONE_OK
  elif git clone "$URL" "$TDIR" >/dev/null 2>&1 && git -C "$TDIR" checkout -B "$BRANCH" >/dev/null 2>&1; then echo CLONE_NEW_BRANCH
  else echo CLONE_FAIL; TDIR="$HOME"; fi
fi
if [ "$TDIR" != "$HOME" ] && [ -d "$TDIR" ]; then
  TRUST_SECTION="[projects.\\"$TDIR\\"]"
  if ! grep -Fqx "$TRUST_SECTION" "$HOME/.codex/config.toml" 2>/dev/null; then
    printf "\\n%s\\ntrust_level = \\"trusted\\"\\n" "$TRUST_SECTION" >> "$HOME/.codex/config.toml"
  fi
fi
if [ -n "$PROMPT" ] && [ -d "$TDIR" ]; then printf "%s\\n" "$PROMPT" > "$TDIR/.crabbox-prompt.md"; fi
if [ -n "$CMD" ] && command -v tmux >/dev/null 2>&1; then
  tmux start-server >/dev/null 2>&1 || true
  tmux set-option -g mouse on >/dev/null 2>&1 || true
  tmux set-option -g history-limit 50000 >/dev/null 2>&1 || true
  if tmux has-session -t crabbox >/dev/null 2>&1; then echo TMUX_EXISTS
  elif [ -s "$TDIR/.crabbox-prompt.md" ]; then
    tmux new-session -d -s crabbox -c "$TDIR" "$CMD \\"\\$(cat .crabbox-prompt.md)\\"; exec bash" && echo TMUX_OK || echo TMUX_FAIL
  else
    tmux new-session -d -s crabbox -c "$TDIR" "$CMD; exec bash" && echo TMUX_OK || echo TMUX_FAIL
  fi
fi
command -v codex >/dev/null 2>&1 && codex --version || echo CODEX_MISSING'`;

const BOOTSTRAP_TIMEOUT_MS = 6 * 60 * 1000;

// tmux session name the bootstrap starts and the terminal bridge attaches to.
export const CRABBOX_TMUX_SESSION = "crabbox";

// Builds the stdin payload the script consumes: one "byte-count\n<bytes>" pair
// per part, fixed order, zero count for parts we skip. Exported for tests.
export function buildBootstrapStdin(parts: {
  authJson: string;
  configToml?: string | null;
  agentsMd?: string | null;
  gitCredential?: string | null;
  repoUrl?: string | null;
  branch?: string | null;
  dir?: string | null;
  command?: string | null;
  prompt?: string | null;
}): string {
  const ordered = [
    parts.authJson,
    parts.configToml ?? "",
    parts.agentsMd ?? "",
    parts.gitCredential ?? "",
    parts.repoUrl ?? "",
    parts.branch ?? "",
    parts.dir ?? "",
    parts.command ?? "",
    parts.prompt ?? "",
  ];
  return ordered.map((part) => `${Buffer.byteLength(part, "utf8")}\n${part}`).join("");
}

export function codexFileForWorkspace(
  hostValue: string | null,
  projectValue: string | null,
  override?: string | null,
): string | null {
  if (override !== undefined && override !== null) return override;
  if (projectValue !== null) return projectValue;
  return hostValue;
}

// org/repo -> the directory name we clone into under ~/work.
export function repoDirName(repo: string): string {
  const name = repo.split("/").pop() ?? "";
  return name.replace(/[^a-zA-Z0-9._-]/g, "-") || "repo";
}

// Turns the script's stdout markers into the human note that lands on the
// session's last_event. Exported for tests.
export function workspaceNotes(output: string): string {
  const notes: string[] = [];
  if (/CLONE_EXISTS/.test(output)) notes.push("repo already cloned");
  else if (/CLONE_NEW_BRANCH/.test(output)) notes.push("repo cloned (new branch)");
  else if (/CLONE_OK/.test(output)) notes.push("repo cloned");
  else if (/CLONE_FAIL/.test(output)) notes.push("repo clone failed");
  if (/TMUX_EXISTS/.test(output)) notes.push("codex already running in tmux");
  else if (/TMUX_OK/.test(output)) notes.push("codex started in tmux");
  else if (/TMUX_FAIL/.test(output)) notes.push("tmux start failed");
  return notes.length ? ` · ${notes.join(" · ")}` : "";
}

function bootstrapDisabled(env: CodexAuthEnv): boolean {
  const raw = (env.LOBSTERFLEET_CODEX_BOOTSTRAP ?? process.env.LOBSTERFLEET_CODEX_BOOTSTRAP ?? "")
    .trim()
    .toLowerCase();
  return raw === "0" || raw === "false" || raw === "never" || raw === "off";
}

export async function bootstrapCodexOnBox(
  env: CodexAuthEnv,
  target: CodexBootstrapTarget,
  workspace: CodexWorkspace = {},
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
  const extras = readHostCodexExtras(env);
  const projectDefaults = readProjectCodexDefaults();

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

  const repo = workspace.repo?.trim() ?? "";
  const stdinPayload = buildBootstrapStdin({
    authJson: auth.json,
    configToml: codexFileForWorkspace(
      extras.configToml,
      projectDefaults.configToml,
      workspace.configToml,
    ),
    agentsMd: codexFileForWorkspace(extras.agentsMd, projectDefaults.agentsMd, workspace.agentsMd),
    gitCredential: workspace.githubToken
      ? `https://x-access-token:${workspace.githubToken}@github.com`
      : "",
    repoUrl: repo ? `https://github.com/${repo}.git` : "",
    branch: workspace.branch?.trim() || "main",
    dir: repo ? repoDirName(repo) : "",
    command: workspace.command?.trim() ?? "",
    prompt: workspace.prompt ?? "",
  });

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
          const notes = workspaceNotes(text);
          if (code === 0 && /codex-cli/i.test(text)) {
            finish({
              status: "ready",
              detail: `codex ready (${text.split("\n").pop()}, ${auth.source} auth)${notes}`,
            });
          } else if (/CODEX_MISSING/.test(text)) {
            finish({
              status: "failed",
              detail: `codex auth placed, but codex install failed on the box${notes}`,
            });
          } else {
            finish({
              status: "failed",
              detail: `codex bootstrap exited ${code ?? "?"}: ${text.slice(0, 160)}`,
            });
          }
        });
        // secrets and workspace config go in over stdin. EOF unblocks the script
        stream.write(stdinPayload);
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
