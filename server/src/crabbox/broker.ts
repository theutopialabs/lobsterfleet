import { randomBytes } from "node:crypto";
import { Socket } from "node:net";

// Typed client for the lobsterbox broker (our self-hosted lease control plane).
// Leases a runner (a local Docker box, or a Hetzner VM), installs our ssh key on
// it, hands back the host/port to attach, keeps it alive, and tears it down.
// Contract: lobsterbox /api/leases (see ../../../lobsterbox).
//
// We ssh into the runner with the private key at CRABBOX_SSH_PRIVATE_KEY_PATH.
// lobsterbox installs the matching public key below.

export type BrokerEnv = {
  LOBSTERBOX_URL?: string;
  LOBSTERBOX_TOKEN?: string;
  LOBSTERBOX_OWNER?: string;
  // Default catalog selection used when a lease doesn't pick its own. region is
  // a lobsterbox region id like "local" or "fsn1".
  // machine is a machine id like "docker" or "cpx22".
  LOBSTERBOX_REGION?: string;
  LOBSTERBOX_MACHINE?: string;
  LOBSTERBOX_TTL_SECONDS?: string;
  LOBSTERBOX_IDLE_SECONDS?: string;
  LOBSTERBOX_WORK_ROOT?: string;
  LOBSTERBOX_SSH_PUBLIC_KEY?: string;
  // Legacy fallbacks so an existing install's key/owner keep working.
  CRABBOX_COORDINATOR_SSH_PUBLIC_KEY?: string;
  CRABBOX_OWNER?: string;
};

// What lobsterbox hands back. We only type the bits we use, rest is loose.
export type Lease = {
  id: string;
  state: "provisioning" | "active" | "failed" | "expired" | "released" | string;
  host?: string;
  sshUser?: string;
  // lobsterbox returns a numeric `port`. We mirror it to sshPort for the bridge.
  sshPort?: string | number;
  port?: number;
  slug?: string;
  provider?: string;
  regionId?: string;
  machineId?: string;
  desktop?: boolean;
  error?: string;
  [key: string]: unknown;
};

export type CreateLeaseOpts = {
  // Optional friendly slug, ends up in the runner name.
  requestedSlug?: string;
  ttlSeconds?: number;
  idleTimeoutSeconds?: number;
  sshPublicKey?: string;
  workRoot?: string;
  owner?: string;
  // Catalog selection. region = a lobsterbox region id, machine = a machine id.
  // location/serverType are accepted as aliases so the existing provision
  // plumbing keeps working without renames.
  region?: string;
  machine?: string;
  location?: string;
  serverType?: string;
  // Run a full `apt upgrade` on the box at startup (slower boot). Off by default.
  aptUpgrade?: boolean;
  // Accepted but ignored: the lobsterbox baseline has no desktop/VNC runner.
  desktop?: boolean;
  desktopEnv?: string;
  class?: string;
};

const DEFAULT_TTL_SECONDS = 3600;
const DEFAULT_IDLE_SECONDS = 900;

// Makes a new lease id like cbx_<24 hex chars>. We pass it to lobsterbox so the
// id is predictable and our release/heartbeat logic can recognize it later.
export function newLeaseID(): string {
  return "cbx_" + randomBytes(12).toString("hex");
}

function baseUrl(env: BrokerEnv): string {
  const url = env.LOBSTERBOX_URL;
  if (!url) throw new Error("LOBSTERBOX_URL is not set");
  return url.replace(/\/+$/, "");
}

function authHeaders(env: BrokerEnv, ownerOverride?: string): Record<string, string> {
  const token = env.LOBSTERBOX_TOKEN;
  if (!token) throw new Error("LOBSTERBOX_TOKEN is not set");
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const owner = (env.LOBSTERBOX_OWNER ?? env.CRABBOX_OWNER ?? ownerOverride ?? "").trim();
  if (owner) headers["x-lobsterbox-owner"] = owner;
  return headers;
}

function toInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// Default time-box for quick calls (get/list/release/heartbeat). Creating a lease
// is different: the broker boots a real cloud VM and waits for it to be ssh-ready,
// which takes well over 30s on Hetzner. Those calls pass a longer timeout.
const BROKER_TIMEOUT_MS = 30_000;
const BROKER_LEASE_TIMEOUT_MS = 240_000;

// Throws a clear error on non-2xx, including the response body so we can see why.
async function request(
  env: BrokerEnv,
  method: string,
  path: string,
  body?: unknown,
  ownerOverride?: string,
  timeoutMs: number = BROKER_TIMEOUT_MS,
): Promise<unknown> {
  // Time-box every broker call. Without this a hung broker stalls the heartbeat
  // and provision paths for the full TCP timeout (minutes), backing up the queue.
  let res: Response;
  try {
    res = await fetch(`${baseUrl(env)}${path}`, {
      method,
      headers: authHeaders(env, ownerOverride),
      signal: AbortSignal.timeout(timeoutMs),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(`lobsterbox ${method} ${path} -> timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(describeBrokerError(method, path, res.status, text));
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// lobsterbox returns clean JSON errors like {"error":"unknown machine ..."}.
// Pull the message out, fall back to the raw body.
function describeBrokerError(method: string, path: string, status: number, text: string): string {
  let detail = text.slice(0, 500);
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string") detail = parsed.error;
  } catch {
    // not json, keep the raw slice
  }
  return `lobsterbox ${method} ${path} -> HTTP ${status}: ${detail}`;
}

// Normalize a raw lobsterbox lease into our Lease shape. lobsterbox uses a
// numeric `port`. The ssh bridge reads `sshPort`, so mirror it.
function toLease(raw: unknown): Lease {
  if (!raw || typeof raw !== "object") {
    throw new Error("lobsterbox: empty lease in response");
  }
  const lease = raw as Lease;
  return {
    ...lease,
    sshPort: lease.sshPort ?? lease.port,
    desktop: lease.desktop ?? false,
  };
}

// lobsterbox has no /whoami. /health is the cheapest reachability check.
export async function whoami(env: BrokerEnv): Promise<unknown> {
  const res = await fetch(`${baseUrl(env)}/health`);
  return res.json().catch(() => ({}));
}

// A machine the catalog offers in a region. Specs come straight from Hetzner
// cpuType is "shared" or "dedicated". The local Docker catalog leaves most of
// these empty.
export type CatalogMachine = {
  id: string;
  regionId: string;
  name: string;
  description?: string;
  provider?: string;
  available?: boolean;
  cpuCores?: number;
  memoryGb?: number;
  diskGb?: number;
  cpuType?: string;
  category?: string;
  architecture?: string;
  deprecated?: boolean;
  priceHourly?: { net?: string; gross?: string } | null;
};

export type CatalogRegion = {
  id: string;
  name: string;
  description?: string;
  machines: CatalogMachine[];
};

export type Catalog = { regions: CatalogRegion[] };

// Pulls lobsterbox's live region+machine catalog (GET /api/catalog). For Hetzner
// this is real locations and server types with specs and price. For the local
// Docker backend it is one region with one machine.
export async function getCatalog(env: BrokerEnv): Promise<Catalog> {
  const out = (await request(env, "GET", "/api/catalog")) as {
    catalog?: { regions?: CatalogRegion[] };
  };
  const regions = Array.isArray(out.catalog?.regions) ? out.catalog.regions : [];
  return { regions };
}

export async function createLease(env: BrokerEnv, opts: CreateLeaseOpts = {}): Promise<Lease> {
  const publicKey = (
    opts.sshPublicKey ??
    env.LOBSTERBOX_SSH_PUBLIC_KEY ??
    env.CRABBOX_COORDINATOR_SSH_PUBLIC_KEY ??
    ""
  ).trim();
  if (!publicKey) throw new Error("LOBSTERBOX_SSH_PUBLIC_KEY is not set");
  const region = (opts.region ?? opts.location ?? env.LOBSTERBOX_REGION ?? "local").trim();
  const machine = (opts.machine ?? opts.serverType ?? env.LOBSTERBOX_MACHINE ?? "docker").trim();
  const workRoot = opts.workRoot ?? env.LOBSTERBOX_WORK_ROOT;
  const body = {
    id: newLeaseID(),
    ...(opts.requestedSlug ? { slug: opts.requestedSlug } : {}),
    publicKey,
    region,
    machine,
    ttlSeconds: opts.ttlSeconds ?? toInt(env.LOBSTERBOX_TTL_SECONDS, DEFAULT_TTL_SECONDS),
    idleSeconds: opts.idleTimeoutSeconds ?? toInt(env.LOBSTERBOX_IDLE_SECONDS, DEFAULT_IDLE_SECONDS),
    ...(workRoot ? { workRoot } : {}),
    ...(opts.class ? { class: opts.class } : {}),
    ...(opts.aptUpgrade ? { aptUpgrade: true } : {}),
  };
  const out = (await request(env, "POST", "/api/leases", body, opts.owner, BROKER_LEASE_TIMEOUT_MS)) as {
    lease?: unknown;
  };
  if (!(out.lease as Lease | undefined)?.id) {
    throw new Error("lobsterbox create lease: missing lease in response");
  }
  return toLease(out.lease);
}

export async function getLease(env: BrokerEnv, id: string): Promise<Lease> {
  const out = (await request(env, "GET", `/api/leases/${encodeURIComponent(id)}`)) as {
    lease?: unknown;
  };
  if (!(out.lease as Lease | undefined)?.id) {
    throw new Error(`lobsterbox get lease ${id}: missing lease in response`);
  }
  return toLease(out.lease);
}

export async function listLeases(env: BrokerEnv, limit = 20): Promise<Lease[]> {
  const out = (await request(env, "GET", "/api/leases")) as { leases?: unknown[] };
  const leases = Array.isArray(out.leases) ? out.leases.map(toLease) : [];
  return leases.slice(0, limit);
}

export async function heartbeatLease(env: BrokerEnv, id: string): Promise<void> {
  await request(env, "POST", `/api/leases/${encodeURIComponent(id)}/heartbeat`, {});
}

// lobsterbox always releases (and deletes the runner). `del` is kept for the
// old call sites but lobsterbox ignores it.
export async function releaseLease(env: BrokerEnv, id: string, _del = true): Promise<void> {
  await request(env, "POST", `/api/leases/${encodeURIComponent(id)}/release`, {});
}

export function coordinatorLeaseIdFromSessionLease(
  leaseId: string | null | undefined,
): string | null {
  if (!leaseId) return null;
  if (leaseId.startsWith("crabbox:")) return leaseId.slice("crabbox:".length) || null;
  if (leaseId.startsWith("cbx_") || leaseId.startsWith("lbx_")) return leaseId;
  return null;
}

export type WaitForActiveOpts = {
  timeoutMs?: number;
  pollMs?: number;
  // Called on each poll so callers can log progress.
  onPoll?: (lease: Lease) => void;
};

// Polls a lease until it is active with a host, or gives up. lobsterbox
// provisions synchronously so the first poll is usually already active, but we
// keep the loop so a slow Hetzner runner still works. Throws on failed/expired
// or timeout, with lobsterbox's error when we have it.
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
      throw new Error(`lease ${id} ${lease.state}: ${lease.error ?? ""}`.trim());
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

// A runner is "active" once the box exists, but sshd may need a moment before it
// accepts connections (especially Hetzner). Poll the ssh port so callers only
// flip a session to "ready" once it can actually be attached. Best effort: on
// timeout we just return (the bridge still retries), we do not fail a good lease.
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
