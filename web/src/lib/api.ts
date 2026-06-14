// Typed fetch client for the lobsterfleet API plus the response shapes.
// Types are derived from the real handlers in server/src/core/index.ts.

export type Role = "viewer" | "maintainer" | "owner";

export type User = {
  subject: string;
  login: string | null;
  email: string | null;
  name: string | null;
  role: Role;
  allowed: boolean;
  teams: string[];
};

export type AuthMethods = {
  github: boolean;
  token: boolean;
  devIdentity: boolean;
};

export type AllowEntry = {
  value: string;
  role: Role;
};

export type Repo = string;

// Card diff bits.
export type DiffFileStatus = "added" | "deleted" | "modified" | "renamed";

export type ChangedFile = {
  path: string;
  oldPath?: string;
  status: DiffFileStatus;
  additions: number;
  deletions: number;
};

export type CardChanges = {
  files: ChangedFile[];
  patch: string;
  totals: { additions: number; deletions: number; files: number };
};

export type RunStatus =
  | "queued"
  | "leasing"
  | "running"
  | "review"
  | "completed"
  | "failed"
  | "stalled"
  | "canceled";

export type RuntimeCapabilities = {
  terminal: boolean;
  takeover: boolean;
  vnc: boolean;
  desktop: boolean;
  logs: boolean;
  artifacts: boolean;
};

export type RuntimePreflightStatus = "ok" | "warning" | "missing" | "error";

export type RuntimePreflightItem = {
  id: string;
  label: string;
  status: RuntimePreflightStatus;
  detail: string;
};

export type RuntimePreflight = {
  status: RuntimePreflightStatus;
  generatedAt: number;
  items: RuntimePreflightItem[];
};

export type RunAttempt = {
  id: string;
  cardId: string;
  attempt: number;
  runtime: string;
  status: RunStatus;
  controlIntent: string | null;
  leaseId: string | null;
  attachUrl: string | null;
  vncUrl: string | null;
  selectionReason: string | null;
  capabilities: RuntimeCapabilities;
  operator: string | null;
  lastHeartbeatAt: number;
  startedAt: number | null;
  endedAt: number | null;
  createdAt: number;
  updatedAt: number;
  error: string | null;
};

// Board lane names. Order matters for advancing.
export type Lane = "Todo" | "Running" | "Human Review" | "Done";

export type Card = {
  id: string;
  title: string;
  prompt: string;
  repo: string;
  source: string;
  runtime: string;
  policy: string;
  lane: string;
  owner: string;
  startedAt: number | null;
  createdAt: number;
  logs: string[];
  changes: CardChanges;
  run: RunAttempt | null;
};

export type InteractiveSessionStatus =
  | "provisioning"
  | "pending_adapter"
  | "ready"
  | "attached"
  | "detached"
  | "stopped"
  | "expired"
  | "failed";

export type InteractiveSession = {
  id: string;
  parentSessionId: string | null;
  rootSessionId: string | null;
  repo: string;
  branch: string;
  runtime: "crabbox" | "crabbox-gui";
  command: string;
  prompt: string;
  purpose: string;
  summary: string;
  owner: string;
  createdBy: string;
  status: InteractiveSessionStatus;
  leaseId: string | null;
  attachUrl: string | null;
  vncUrl: string | null;
  lastEvent: string;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
  stoppedAt: number | null;
  shareMode: "private" | "link_read";
  shareTokenPreview: string | null;
  controlRequestedBy: string | null;
  controlRequestedAt: number | null;
  controller: string | null;
  controlGrantedAt: number | null;
  controlExpiresAt: number | null;
  multiplayerMode: boolean;
  canControl?: boolean;
  canManage?: boolean;
  canChangeMultiplayer?: boolean;
  canRequestControl?: boolean;
  sharedReadOnly?: boolean;
  logs: string[];
  logArchive: { eventCount: number } | null;
};

export type FleetRuntime = "crabbox" | "crabbox-gui";

export type FleetState = {
  canonicalUrl: string;
  productUrl: string;
  generatedAt: number;
  registryAvailable: boolean;
  egress: { defaultHostCount: number; policyCount: number; sessionsWithPolicy: number };
  totals: {
    active: number;
    archived: number;
    attachable: number;
    byRuntime: Record<FleetRuntime, number>;
    byStatus: Record<InteractiveSessionStatus, number>;
    failed: number;
    provisioning: number;
    ready: number;
    sessions: number;
    stopped: number;
    vnc: number;
  };
  sessions: unknown[];
};

// A box size the operator can pick. The server owns the list (env-overridable),
// so the UI just renders whatever it gets. id is the broker class (standard,
// beast, and so on. label is for display.
export type SizeOption = {
  id: string;
  label: string;
};

// A machine the broker can lease in a region. Specs come from the provider
// cpuType is "shared" or "dedicated" for Hetzner. The local Docker catalog
// leaves most fields empty.
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

export type RepoWorkflow = {
  repo: string;
  status: "ok" | "missing" | "invalid" | "error";
  prompt: string;
  error: string | null;
};

// The big payload from GET /api/state.
export type ServerState = {
  user: User;
  auth: AuthMethods;
  org: string;
  cap: number;
  retention: string;
  merge: string;
  allow: AllowEntry[];
  repos: Repo[];
  workflows: RepoWorkflow[];
  cards: Card[];
  interactiveSessions: InteractiveSession[];
  fleet: FleetState;
  sizes: SizeOption[];
  defaultSize: string;
  preflight?: RuntimePreflight | null;
};

export type GitHubReference = {
  repo: string;
  number: number;
  title: string;
  source: "Issue" | "PR";
  state: string;
  url: string;
  author: string | null;
  updatedAt: string;
  body: string;
};

// Thrown when a request comes back not-ok. Carries status so callers can
// special-case 401 (unauthenticated).
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // body was not json, keep statusText
    }
    throw new ApiError(res.status, message);
  }
  // some endpoints return 204 with no body
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body === undefined ? undefined : JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

// Convenience wrappers for the endpoints this UI uses.
export const endpoints = {
  auth: () => api.get<{ auth: AuthMethods }>("/api/auth"),
  state: () => api.get<ServerState>("/api/state"),
  tokenLogin: (token: string) => api.post<{ user: User; auth: AuthMethods }>("/api/login/token", { token }),
  devLogin: (id: string, name: string, role: Role = "owner") =>
    api.post<{ user: User }>("/api/login/dev", { id, name, role }),
  logout: () => api.post<{ ok: boolean }>("/api/logout"),
  githubRefs: (number: number) =>
    api.get<{ matches: GitHubReference[] }>(`/api/github/refs?number=${number}`),
  // Repos the server's GitHub token can reach, most recently pushed first.
  githubRepos: () => api.get<{ repos: string[] }>("/api/github/repos"),
  // Remote branches for an allowlisted repo, freshest commits first with the
  // default branch on top. 403 when the repo isn't allowlisted.
  githubBranches: (repo: string) =>
    api.get<{ branches: string[]; defaultBranch: string }>(
      `/api/github/branches?repo=${encodeURIComponent(repo)}`,
    ),
  // Live region+machine catalog from the broker, for the New Box sheet.
  boxCatalog: () => api.get<{ regions: CatalogRegion[] }>("/api/box-catalog"),
  codexDefaults: () =>
    api.get<{
      agentsMd: string;
      configToml: string;
      paths: { agentsMd: string; configToml: string };
    }>("/api/codex-defaults"),
  createSession: (body: {
    repo: string;
    branch?: string;
    runtime?: string;
    size?: string;
    region?: string;
    machine?: string;
    aptUpgrade?: boolean;
    command?: string;
    prompt?: string;
    configToml?: string;
    agentsMd?: string;
  }) => api.post<{ session: InteractiveSession }>("/api/interactive-sessions", body),
  sessionAction: (id: string, action: string) =>
    api.post<{ session: InteractiveSession }>(
      `/api/interactive-sessions/${encodeURIComponent(id)}/actions`,
      { action },
    ),
  // Purge finished (stopped/expired/failed) sessions. No ids = clear all the
  // caller can manage. Returns the fresh state plus which ids were removed.
  cleanupSessions: (ids?: string[]) =>
    api.post<{ state: unknown; removedIds: string[] }>(
      "/api/interactive-sessions/cleanup",
      ids && ids.length ? { ids } : {},
    ),
  sharedSession: (id: string, token: string) =>
    api.get<{ session: InteractiveSession }>(
      `/api/shared-sessions/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`,
    ),
  createCard: (body: {
    repo: string;
    prompt: string;
    title?: string;
    source?: string;
    runtime?: string;
    policy?: string;
  }) => api.post<{ card: Card }>("/api/cards", body),
  deleteCard: (id: string) =>
    api.del<{ ok: boolean; removedId: string }>(`/api/cards/${encodeURIComponent(id)}`),
  cardAction: (id: string, action: string) =>
    api.post<{ card: Card }>(`/api/cards/${encodeURIComponent(id)}/actions`, { action }),
  // Admin endpoints. They all return the fresh ServerState so callers can just
  // refresh() afterwards.
  addAllow: (value: string, role: Role) => api.post<ServerState>("/api/admin/allow", { value, role }),
  removeAllow: (value: string) => api.del<ServerState>(`/api/admin/allow/${encodeURIComponent(value)}`),
  addRepo: (repo: string) => api.post<ServerState>("/api/admin/repos", { repo }),
  removeRepo: (repo: string) => api.del<ServerState>(`/api/admin/repos/${encodeURIComponent(repo)}`),
  updatePolicy: (body: { cap: number; retention: string; merge: string }) =>
    api.put<ServerState>("/api/admin/policy", body),
  evaluateWorkflow: (repo: string) => api.post<ServerState>("/api/admin/workflows/evaluate", { repo }),
};
