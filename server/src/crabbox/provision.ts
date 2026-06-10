import {
  createLease,
  waitForActive,
  waitForSshReachable,
  type BrokerEnv,
  type Lease,
} from "./broker.js";
import { bootstrapCodexOnBox } from "./codexBootstrap.js";
import type { CodexAuthEnv } from "./codexAuth.js";
import { resolveRuntimePath } from "../runtimePaths.js";

// Provisions a real crabbox for an interactive session: leases a box from the
// broker, waits for it to come up, bootstraps codex with the host's credential,
// then returns the ssh target encoded as the attach_url. The caller persists
// this on the session row.

export type ProvisionEnv = BrokerEnv &
  CodexAuthEnv & {
    CRABBOX_SSH_PRIVATE_KEY_PATH?: string;
  };

export type ProvisionResult = {
  status: "ready" | "failed";
  leaseId: string | null;
  // ssh://user@host:port when ready, null on failure
  attachUrl: string | null;
  vncUrl: string | null;
  message: string;
  // box host key (sha256 hex) seen during bootstrap, for TOFU pinning
  hostKey: string | null;
};

export type CrabboxSessionLike = {
  id: string;
  owner?: string;
};

// True when the broker creds are present, so we should take the real path.
export function crabboxConfigured(env: BrokerEnv): boolean {
  return Boolean(env.CRABBOX_COORDINATOR_URL && env.CRABBOX_COORDINATOR_TOKEN);
}

function slugFor(id: string): string {
  return `lobsterfleet-${id.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`.slice(0, 60);
}

// Builds the ssh:// attach url the bridge later parses to find the box.
export function sshAttachUrl(lease: Lease): string | null {
  if (!lease.host) return null;
  const user = lease.sshUser || "crabbox";
  const port = lease.sshPort ?? 22;
  return `ssh://${user}@${lease.host}:${port}`;
}

export async function provisionCrabbox(
  env: ProvisionEnv,
  session: CrabboxSessionLike,
): Promise<ProvisionResult> {
  let lease: Lease;
  try {
    lease = await createLease(env, { requestedSlug: slugFor(session.id), owner: session.owner });
  } catch (error) {
    return {
      status: "failed",
      leaseId: null,
      attachUrl: null,
      vncUrl: null,
      message: `crabbox lease create failed: ${String(error).slice(0, 300)}`,
      hostKey: null,
    };
  }

  try {
    const active = await waitForActive(env, lease.id, { timeoutMs: 3 * 60 * 1000 });
    const attachUrl = sshAttachUrl(active);
    if (!attachUrl) {
      return {
        status: "failed",
        leaseId: lease.id,
        attachUrl: null,
        vncUrl: null,
        message: "crabbox active but missing host",
        hostKey: null,
      };
    }
    // Wait for sshd to actually answer before calling it ready, so the first
    // attach lands on a live shell instead of a connection-refused retry.
    const port = Number(active.sshPort ?? 22);
    const reachable = await waitForSshReachable(active.host as string, port, { timeoutMs: 90_000 });

    // Make the box codex-ready with the host's credential. Best effort: a
    // failure leaves a usable shell, but the outcome lands in the message so
    // the operator sees it on the session.
    let codexNote = "codex bootstrap skipped: ssh not reachable yet";
    let hostKey: string | null = null;
    if (reachable) {
      const codex = await bootstrapCodexOnBox(env, {
        host: active.host as string,
        port,
        user: (active.sshUser as string) || "crabbox",
        privateKeyPath: resolveRuntimePath(
          env.CRABBOX_SSH_PRIVATE_KEY_PATH ?? "./data/crabbox_key",
        ),
      });
      codexNote = codex.detail;
      hostKey = codex.hostKey;
    }

    return {
      status: "ready",
      leaseId: lease.id,
      attachUrl,
      vncUrl: active.desktop ? `${attachUrl}#vnc` : null,
      message: reachable
        ? `crabbox ${active.slug || lease.id} ready at ${active.host} · ${codexNote}`
        : `crabbox ${active.slug || lease.id} up at ${active.host}, ssh still warming up`,
      hostKey,
    };
  } catch (error) {
    return {
      status: "failed",
      leaseId: lease.id,
      attachUrl: null,
      vncUrl: null,
      message: `crabbox provision failed: ${String(error).slice(0, 300)}`,
      hostKey: null,
    };
  }
}

// Parses an ssh://user@host:port attach url back into a target for the bridge.
export function parseSshAttachUrl(
  attachUrl: string | null | undefined,
): { host: string; port: number; user: string } | null {
  if (!attachUrl || !attachUrl.startsWith("ssh://")) return null;
  try {
    const url = new URL(attachUrl);
    const host = url.hostname;
    if (!host) return null;
    return {
      host,
      port: url.port ? Number(url.port) : 22,
      user: decodeURIComponent(url.username) || "crabbox",
    };
  } catch {
    return null;
  }
}
