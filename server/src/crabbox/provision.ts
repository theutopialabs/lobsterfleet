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
    // Which desktop env GUI leases start (xfce, gnome, ...). Defaults to xfce.
    CRABBOX_COORDINATOR_DESKTOP_ENV?: string;
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
  // The chosen runtime, so we know whether to lease a desktop (GUI) box or a
  // headless (TUI) one. Defaults to headless when missing.
  runtime?: string;
  // Box size class (standard/fast/large/beast). Empty = install default.
  size?: string;
};

// True when the broker creds are present, so we should take the real path.
export function crabboxConfigured(env: BrokerEnv): boolean {
  return Boolean(env.CRABBOX_COORDINATOR_URL && env.CRABBOX_COORDINATOR_TOKEN);
}

// Both crabbox runtimes lease a real box. "crabbox" is the headless TUI box,
// "crabbox-gui" adds a graphical desktop. Everything else (ssh bridge, codex
// bootstrap, heartbeat) is identical, so the gates use this to treat both alike.
export function isCrabboxRuntime(runtime: string | null | undefined): boolean {
  return runtime === "crabbox" || runtime === "crabbox-gui";
}

// Only the GUI runtime wants a desktop attached to the lease.
export function crabboxWantsDesktop(runtime: string | null | undefined): boolean {
  return runtime === "crabbox-gui";
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
  const wantsDesktop = crabboxWantsDesktop(session.runtime);
  let lease: Lease;
  try {
    lease = await createLease(env, {
      requestedSlug: slugFor(session.id),
      owner: session.owner,
      desktop: wantsDesktop,
      desktopEnv: env.CRABBOX_COORDINATOR_DESKTOP_ENV || "xfce",
      ...(session.size ? { class: session.size } : {}),
    });
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

    // GUI leases get a desktop. We serve it ourselves over an ssh-tunneled noVNC
    // bridge, so point at our own same-origin viewer route (no broker portal /
    // second login). null when this is a TUI lease or the box came up headless.
    const desktopUp = wantsDesktop && active.desktop !== false;
    const vncUrl = desktopUp ? `/vnc/${encodeURIComponent(session.id)}` : null;
    const desktopNote = wantsDesktop
      ? desktopUp
        ? " · desktop ready"
        : " · desktop requested but lease came back headless"
      : "";

    return {
      status: "ready",
      leaseId: lease.id,
      attachUrl,
      vncUrl,
      message: reachable
        ? `crabbox ${active.slug || lease.id} ready at ${active.host} · ${codexNote}${desktopNote}`
        : `crabbox ${active.slug || lease.id} up at ${active.host}, ssh still warming up${desktopNote}`,
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
