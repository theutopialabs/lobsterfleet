import { randomBytes } from "node:crypto";
import { Socket } from "node:net";

// Typed client for the crabbox broker (the lease control plane).
// Leases a real Hetzner box, polls it to active, keeps it alive, tears it down.
// Contract lives at https://broker.theutopialabs.com (see BLUEPRINT.md).

export type BrokerEnv = {
  CRABBOX_COORDINATOR_URL?: string;
  CRABBOX_COORDINATOR_TOKEN?: string;
  CRABBOX_COORDINATOR_PROVIDER?: string;
  CRABBOX_COORDINATOR_PROVIDER_KEY?: string;
  CRABBOX_COORDINATOR_CLASS?: string;
  CRABBOX_COORDINATOR_TTL_SECONDS?: string;
  CRABBOX_COORDINATOR_IDLE_SECONDS?: string;
  CRABBOX_COORDINATOR_WORK_ROOT?: string;
  CRABBOX_COORDINATOR_SSH_PUBLIC_KEY?: string;
  CRABBOX_COORDINATOR_ORG?: string;
  CRABBOX_OWNER?: string;
};

// What the broker hands back. We only type the bits we use, rest is loose.
export type Lease = {
  id: string;
  state: "provisioning" | "active" | "failed" | "expired" | "releasing" | string;
  host?: string;
  sshUser?: string;
  sshPort?: string | number;
  slug?: string;
  provider?: string;
  desktop?: boolean;
  provisioningAttempts?: number;
  capacityHints?: unknown;
  [key: string]: unknown;
};

export type CreateLeaseOpts = {
  // Optional friendly slug, ends up in the hostname.
  requestedSlug?: string;
  // Extra fields override the env-derived defaults.
  ttlSeconds?: number;
  idleTimeoutSeconds?: number;
  sshPublicKey?: string;
  workRoot?: string;
  owner?: string;
  // Ask the broker for a graphical desktop (GUI runtime). Omit/false = headless.
  desktop?: boolean;
  // Which desktop env to start when desktop is true (xfce, gnome, etc).
  desktopEnv?: string;
  // Box size class (standard/fast/large/beast). Falls back to the install
  // default when unset. The broker maps the class to real hardware.
  class?: string;
};

const DEFAULT_TTL_SECONDS = 3600;
const DEFAULT_IDLE_SECONDS = 900;

// Makes a new lease id like cbx_<24 hex chars>.
export function newLeaseID(): string {
  return "cbx_" + randomBytes(12).toString("hex");
}

function baseUrl(env: BrokerEnv): string {
  const url = env.CRABBOX_COORDINATOR_URL;
  if (!url) throw new Error("CRABBOX_COORDINATOR_URL is not set");
  return url.replace(/\/+$/, "");
}

function authHeaders(env: BrokerEnv, ownerOverride?: string): Record<string, string> {
  const token = env.CRABBOX_COORDINATOR_TOKEN;
  if (!token) throw new Error("CRABBOX_COORDINATOR_TOKEN is not set");
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const owner = (env.CRABBOX_OWNER ?? ownerOverride ?? "").trim();
  const org = (env.CRABBOX_COORDINATOR_ORG ?? "").trim();
  if (owner) headers["x-crabbox-owner"] = owner;
  if (org) headers["x-crabbox-org"] = org;
  return headers;
}

function toInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// Throws a clear error on non-2xx, including the response body so we can see why.
async function request(
  env: BrokerEnv,
  method: string,
  path: string,
  body?: unknown,
  ownerOverride?: string,
): Promise<unknown> {
  const res = await fetch(`${baseUrl(env)}${path}`, {
    method,
    headers: authHeaders(env, ownerOverride),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`broker ${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// whoami sanity check. Returns the broker's view of the caller.
export async function whoami(env: BrokerEnv): Promise<unknown> {
  return request(env, "GET", "/v1/whoami");
}

export async function createLease(env: BrokerEnv, opts: CreateLeaseOpts = {}): Promise<Lease> {
  const sshPublicKey = (opts.sshPublicKey ?? env.CRABBOX_COORDINATOR_SSH_PUBLIC_KEY ?? "").trim();
  if (!sshPublicKey) throw new Error("CRABBOX_COORDINATOR_SSH_PUBLIC_KEY is not set");
  const workRoot = opts.workRoot ?? env.CRABBOX_COORDINATOR_WORK_ROOT ?? "/home/crabbox/work";
  const body = {
    leaseID: newLeaseID(),
    ...(opts.requestedSlug ? { requestedSlug: opts.requestedSlug } : {}),
    provider: env.CRABBOX_COORDINATOR_PROVIDER ?? "hetzner",
    target: "linux",
    class: (opts.class || env.CRABBOX_COORDINATOR_CLASS || "standard").trim(),
    // name our key in the provider account. without this the broker falls back
    // to its default key name and rejects our (different) public key.
    ...(env.CRABBOX_COORDINATOR_PROVIDER_KEY
      ? { providerKey: env.CRABBOX_COORDINATOR_PROVIDER_KEY }
      : {}),
    sshUser: "crabbox",
    sshPort: "22",
    sshPublicKey,
    workRoot,
    // Only send desktop when asked. GUI runtime sets this true so the broker
    // brings up a graphical box; TUI runtime leaves it false (headless).
    ...(opts.desktop
      ? { desktop: true, desktopEnv: opts.desktopEnv || "xfce" }
      : { desktop: false }),
    ttlSeconds: opts.ttlSeconds ?? toInt(env.CRABBOX_COORDINATOR_TTL_SECONDS, DEFAULT_TTL_SECONDS),
    idleTimeoutSeconds:
      opts.idleTimeoutSeconds ?? toInt(env.CRABBOX_COORDINATOR_IDLE_SECONDS, DEFAULT_IDLE_SECONDS),
    keep: true,
  };
  const out = (await request(env, "POST", "/v1/leases", body, opts.owner)) as { lease?: Lease };
  if (!out.lease?.id) throw new Error(`broker create lease: missing lease in response`);
  return out.lease;
}

export async function getLease(env: BrokerEnv, id: string): Promise<Lease> {
  const out = (await request(env, "GET", `/v1/leases/${encodeURIComponent(id)}`)) as {
    lease?: Lease;
  };
  if (!out.lease?.id) throw new Error(`broker get lease ${id}: missing lease in response`);
  return out.lease;
}

export async function listLeases(env: BrokerEnv, limit = 20): Promise<Lease[]> {
  const out = (await request(env, "GET", `/v1/leases?limit=${limit}`)) as {
    leases?: Lease[];
  };
  return Array.isArray(out.leases) ? out.leases : [];
}

export async function heartbeatLease(env: BrokerEnv, id: string): Promise<void> {
  await request(env, "POST", `/v1/leases/${encodeURIComponent(id)}/heartbeat`, {});
}

export async function releaseLease(env: BrokerEnv, id: string, del = true): Promise<void> {
  await request(env, "POST", `/v1/leases/${encodeURIComponent(id)}/release`, { delete: del });
}

export function coordinatorLeaseIdFromSessionLease(
  leaseId: string | null | undefined,
): string | null {
  if (!leaseId) return null;
  if (leaseId.startsWith("crabbox:")) return leaseId.slice("crabbox:".length) || null;
  if (leaseId.startsWith("cbx_")) return leaseId;
  return null;
}

export type WaitForActiveOpts = {
  timeoutMs?: number;
  pollMs?: number;
  // Called on each poll so callers can log progress.
  onPoll?: (lease: Lease) => void;
};

// Polls a lease until it is active with a host, or gives up.
// Throws on failed/expired or timeout, with the broker's reason when we have it.
export async function waitForActive(
  env: BrokerEnv,
  id: string,
  opts: WaitForActiveOpts = {},
): Promise<Lease> {
  const timeoutMs = opts.timeoutMs ?? 3 * 60 * 1000;
  const pollMs = opts.pollMs ?? 3000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const lease = await getLease(env, id);
    opts.onPoll?.(lease);
    if (lease.state === "active" && lease.host) return lease;
    if (lease.state === "failed" || lease.state === "expired") {
      const hint =
        lease.provisioningAttempts !== undefined
          ? ` attempts=${lease.provisioningAttempts}`
          : "";
      throw new Error(
        `lease ${id} ${lease.state}${hint}: ${JSON.stringify(lease.capacityHints ?? {}).slice(0, 300)}`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(`lease ${id} not active after ${timeoutMs}ms (state=${lease.state})`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

// One quick tcp connect attempt. Resolves true if the port answers in time.
function tcpReachable(host: string, port: number, connectTimeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new Socket();
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(connectTimeoutMs);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
    sock.connect(port, host);
  });
}

export type WaitForSshOpts = {
  timeoutMs?: number;
  pollMs?: number;
};

// The broker calls a box "active" once the VM exists, but sshd needs another
// ~30-60s before it accepts connections. Poll the ssh port so callers only flip
// a session to "ready" once it can actually be attached. Best effort: on timeout
// we just return (the bridge still retries), we do not fail a good lease.
export async function waitForSshReachable(
  host: string,
  port: number,
  opts: WaitForSshOpts = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const pollMs = opts.pollMs ?? 3000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await tcpReachable(host, port, 5000)) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
