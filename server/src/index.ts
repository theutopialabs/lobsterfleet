import { createReadStream, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import {
  authorizeTerminalBridge,
  handleRequest,
  isAllowedBrowserOrigin,
  reconcileStalledRuns,
  type RuntimeEnv,
  type TerminalBridgeAuthorization,
} from "./core/index.js";
import { openDatabaseWithHandle } from "./db.js";
import { buildEnv } from "./env.js";
import { runMigrations } from "./migrate.js";
import {
  decodeTerminalFrame,
  decodeSubscribePayload,
  encodeJsonPayload,
  encodeTerminalFrame,
  TerminalMessageType,
} from "./core/terminal-protocol.js";
import { attachSshBridge } from "./crabbox/sshBridge.js";
import { attachVncBridge } from "./crabbox/vncBridge.js";
import { parseSshAttachUrl } from "./crabbox/provision.js";
import {
  coordinatorLeaseIdFromSessionLease,
  heartbeatLease,
  type BrokerEnv,
} from "./crabbox/broker.js";
import { createKnownHosts } from "./crabbox/knownHosts.js";
import { responseSecurityHeaders } from "./securityHeaders.js";
import { staticFileForPath } from "./staticFiles.js";
import { resolveRuntimePath } from "./runtimePaths.js";
import { isLoopbackAddress, trustForwardedHeaders } from "./proxyTrust.js";

// Node entry for the ported lobsterfleet backend. Boots sqlite, applies migrations,
// serves the SPA + the real /api/* handler, and bridges terminal websockets.

// Load .env in dev (tsx) so broker creds are present. Real env vars passed on
// the CLI win, so we snapshot them and re-apply after the file load.
const cliEnv = { ...process.env };
try {
  const rootEnv = new URL("../../.env", import.meta.url);
  const serverEnv = new URL("../.env", import.meta.url);
  process.loadEnvFile(existsSync(rootEnv) ? rootEnv : serverEnv);
  for (const [key, value] of Object.entries(cliEnv)) {
    if (value !== undefined) process.env[key] = value;
  }
} catch {
  // no .env, that's fine
}

const PORT = Number(process.env.PORT ?? 8088);
const DB_PATH = resolveRuntimePath(process.env.DATABASE_PATH ?? "./data/lobsterfleet.db");
const here = fileURLToPath(new URL(".", import.meta.url));
// In dev (tsx) we serve ../../web/dist. In prod the Dockerfile copies it next to us.
const WEB_DIST = process.env.WEB_DIST
  ? resolveRuntimePath(process.env.WEB_DIST)
  : join(here, "../../web/dist");
const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;

// Open the db once and reuse it for the whole process (env.__db).
const { db, raw } = openDatabaseWithHandle(DB_PATH);

// db is Kysely<unknown>, so give the few columns the ws bridge reads a type.
type SessionsDb = import("kysely").Kysely<{
  interactive_sessions: {
    id: string;
    attach_url: string | null;
    lease_id: string | null;
    status: string;
  };
}>;
const sessionsDb = db as unknown as SessionsDb;
const appliedCount = runMigrations(raw);
console.log(`[lobsterfleet] migrations: applied ${appliedCount} new`);

// buildEnv hands back a loose Record (the db is Kysely<unknown>). The handler's
// RuntimeEnv wants Kysely<Database>, which is the same runtime object, so cast.
const env = buildEnv(db) as unknown as RuntimeEnv;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

// Routes the handler owns. Everything else falls through to the SPA/static.
function isHandlerRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/docs") ||
    pathname === "/healthz" ||
    pathname === "/login/github" ||
    pathname === "/auth/github/callback" ||
    pathname.startsWith("/ssh/link/") ||
    pathname === "/crabbox-logo.png" ||
    pathname === "/lobsterfleet-og.png"
  );
}

// Build a web Request from the Node request (method, url, headers, body).
async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const url = requestUrl(req);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else headers.set(key, value);
  }
  headers.set("x-lobsterfleet-local-request", isLoopbackAddress(req.socket.remoteAddress) ? "1" : "0");
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  let body: BodyInit | undefined;
  if (hasBody) {
    const contentLength = Number(firstHeader(req.headers["content-length"]) ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
      throw requestTooLarge();
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.byteLength;
      if (total > MAX_REQUEST_BODY_BYTES) throw requestTooLarge();
      chunks.push(buffer);
    }
    if (chunks.length > 0) body = Buffer.concat(chunks);
  }
  return new Request(url.toString(), {
    method,
    headers,
    body,
    // duplex is required by Node when a body is present.
    ...(body ? { duplex: "half" } : {}),
  } as RequestInit);
}

function requestUrl(req: IncomingMessage): URL {
  const host = req.headers.host ?? `localhost:${PORT}`;
  return new URL(req.url ?? "/", `${requestProtocol(req)}://${host}`);
}

function requestProtocol(req: IncomingMessage): "http" | "https" {
  // Forwarded headers decide the Secure cookie flag downstream, so only trust
  // them when the TCP peer is a proxy we trust. Anyone who can reach the
  // server directly could otherwise flip the flag and break logins.
  if (!trustForwardedHeaders(req.socket.remoteAddress)) return "http";

  const forwardedProto = firstHeader(req.headers["x-forwarded-proto"])?.toLowerCase();
  if (forwardedProto === "https") return "https";
  if (forwardedProto === "http") return "http";

  const forwarded = firstHeader(req.headers.forwarded);
  const match = forwarded?.match(/(?:^|[;,]\s*)proto=(https?)/i);
  return match?.[1]?.toLowerCase() === "https" ? "https" : "http";
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Write a web Response back to the Node response. Handles multiple Set-Cookie.
async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  // getSetCookie() returns each Set-Cookie separately so we don't fold them.
  const setCookies =
    typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    headers[key] = value;
  });
  if (setCookies.length > 0) headers["set-cookie"] = setCookies;

  res.writeHead(response.status, headers);
  if (!response.body) {
    res.end();
    return;
  }
  Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
}

const server = createServer((req, res) => {
  void (async () => {
    try {
      const url = requestUrl(req);
      if (isHandlerRoute(url.pathname)) {
        const request = await toWebRequest(req);
        const response = await handleRequest(request, env);
        await writeWebResponse(res, response);
        return;
      }
      serveStatic(url.pathname, res);
    } catch (error) {
      console.error("[lobsterfleet] request error", error);
      const status = errorStatus(error);
      const body = JSON.stringify({
        error: status === 413 ? "request body too large" : "internal error",
      });
      if (!res.headersSent) {
        res.writeHead(
          status,
          responseSecurityHeaders("application/json; charset=utf-8", "no-store"),
        );
      }
      res.end(body);
    }
  })();
});

function requestTooLarge(): Error {
  return Object.assign(new Error("request body too large"), { status: 413 });
}

function errorStatus(error: unknown): number {
  if (typeof error !== "object" || !error || !("status" in error)) return 500;
  const status = Number(error.status);
  return Number.isFinite(status) && status >= 400 && status < 600 ? status : 500;
}

function serveStatic(pathname: string, res: ServerResponse): void {
  if (!existsSync(WEB_DIST)) {
    res
      .writeHead(503, responseSecurityHeaders("text/html; charset=utf-8", "no-store"))
      .end("<h1>lobsterfleet</h1><p>web build not found. run <code>pnpm dev:web</code>.</p>");
    return;
  }
  const resolved = staticFileForPath(WEB_DIST, pathname);
  if (!resolved) {
    res
      .writeHead(404, responseSecurityHeaders("text/plain; charset=utf-8", "no-store"))
      .end("not found\n");
    return;
  }
  res.writeHead(
    200,
    staticHeaders(MIME[extname(resolved.file)] ?? "application/octet-stream", resolved.file),
  );
  createReadStream(resolved.file).pipe(res);
}

function staticHeaders(contentType: string, file: string): Record<string, string> {
  const isHtml = extname(file) === ".html";
  return responseSecurityHeaders(
    contentType,
    isHtml ? "no-store" : "public, max-age=31536000, immutable",
  );
}

// Terminal websocket. We accept the upgrade, send the welcome frame, then bridge
// the ws to a live ssh PTY on the session's leased crabbox. Two entry shapes:
//   /api/interactive-sessions/{id}/pty (or /terminal): id is in the path.
//   /api/terminal/ws: client sends a Subscribe frame naming the sessionId first.
// noServer:true lets us route the upgrade ourselves.
const wss = new WebSocketServer({ noServer: true });

// The crabbox ssh key path. Bridge reads it per connection.
const SSH_KEY_PATH = resolveRuntimePath(
  process.env.CRABBOX_SSH_PRIVATE_KEY_PATH ?? "./data/crabbox_key",
);

// Pinned host keys for leased boxes (trust on first use, keyed by lease id).
const knownHosts = createKnownHosts(raw);

function sendWelcome(socket: WebSocket): void {
  socket.send(
    encodeTerminalFrame({
      type: TerminalMessageType.Welcome,
      sessionId: "",
      payload: encodeJsonPayload({ ok: true, version: 1, multiplex: true }),
    }),
  );
}

function sendNotice(socket: WebSocket, sessionId: string, message: string): void {
  socket.send(
    encodeTerminalFrame({
      type: TerminalMessageType.Event,
      sessionId,
      payload: encodeJsonPayload({ type: "notice", message }),
    }),
  );
}

function sendSubscribed(socket: WebSocket, sessionId: string, canInput: boolean): void {
  socket.send(
    encodeTerminalFrame({
      type: TerminalMessageType.Event,
      sessionId,
      payload: encodeJsonPayload({ type: "subscribed", canInput }),
    }),
  );
}

function sendTerminalError(socket: WebSocket, sessionId: string, message: string): void {
  socket.send(
    encodeTerminalFrame({
      type: TerminalMessageType.Error,
      sessionId,
      payload: encodeJsonPayload({ error: message }),
    }),
  );
}

// Pull just the ssh target + lease for a session out of the db.
async function lookupSessionTarget(
  sessionId: string,
): Promise<{ attachUrl: string | null; leaseId: string | null; status: string } | null> {
  try {
    const row = await sessionsDb
      .selectFrom("interactive_sessions")
      .select(["attach_url", "lease_id", "status"])
      .where("id", "=", sessionId)
      .executeTakeFirst();
    if (!row) return null;
    return { attachUrl: row.attach_url, leaseId: row.lease_id, status: row.status };
  } catch (error) {
    console.error("[lobsterfleet] session lookup failed", error);
    return null;
  }
}

// Bridges a ws to the box behind sessionId. Sends a clear notice if there is no
// ssh target yet (still provisioning, container runtime, etc).
async function bridgeSession(ws: WebSocket, sessionId: string, canInput: boolean): Promise<void> {
  const target = await lookupSessionTarget(sessionId);
  if (!target) {
    sendNotice(ws, sessionId, "session not found");
    return;
  }
  const parsed = parseSshAttachUrl(target.attachUrl);
  if (!parsed) {
    sendNotice(
      ws,
      sessionId,
      target.status === "provisioning"
        ? "workspace still provisioning"
        : "no ssh terminal for this session",
    );
    return;
  }
  // Pin the box host key to the lease id so reconnects within a lease are
  // verified, while a brand new lease (even on a recycled ip) starts fresh.
  const leaseId = target.leaseId;
  attachSshBridge(
    ws,
    sessionId,
    { host: parsed.host, port: parsed.port, user: parsed.user, privateKeyPath: SSH_KEY_PATH },
    {
      allowInput: canInput,
      knownHostKey: leaseId ? knownHosts.get(leaseId) : null,
      onLearnHostKey: leaseId ? (hash) => knownHosts.set(leaseId, hash) : undefined,
      onReady: () => console.log(`[lobsterfleet] ssh bridge up for ${sessionId} -> ${parsed.host}`),
      onClose: () => console.log(`[lobsterfleet] ssh bridge closed for ${sessionId}`),
    },
  );
}

function isTerminalUpgrade(pathname: string): boolean {
  return (
    pathname === "/api/terminal/ws" ||
    /^\/api\/interactive-sessions\/[^/]+\/pty$/.test(pathname) ||
    /^\/api\/interactive-sessions\/[^/]+\/terminal$/.test(pathname)
  );
}

// The VNC viewer ws: /api/interactive-sessions/{id}/vnc. Raw RFB, no framing.
function vncSessionIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/api\/interactive-sessions\/([^/]+)\/vnc$/);
  return m ? decodeURIComponent(m[1] as string) : null;
}

// Bridges a raw ws to the box desktop behind sessionId. Unlike the terminal
// bridge this speaks RFB straight away, so no welcome/subscribe frames.
async function bridgeVncSession(ws: WebSocket, sessionId: string): Promise<void> {
  const target = await lookupSessionTarget(sessionId);
  const parsed = target ? parseSshAttachUrl(target.attachUrl) : null;
  if (!parsed) {
    // Nothing to speak RFB to, so just close. The viewer surfaces the failure.
    try {
      ws.close(1011, "no desktop for this session");
    } catch {
      // already closing
    }
    return;
  }
  const leaseId = target!.leaseId;
  attachVncBridge(
    ws,
    { host: parsed.host, port: parsed.port, user: parsed.user, privateKeyPath: SSH_KEY_PATH },
    {
      knownHostKey: leaseId ? knownHosts.get(leaseId) : null,
      onLearnHostKey: leaseId ? (hash) => knownHosts.set(leaseId, hash) : undefined,
      onReady: () => console.log(`[lobsterfleet] vnc bridge up for ${sessionId} -> ${parsed.host}`),
      onClose: () => console.log(`[lobsterfleet] vnc bridge closed for ${sessionId}`),
      onError: (msg) => console.warn(`[lobsterfleet] vnc bridge ${sessionId}: ${msg}`),
    },
  );
}

// Pulls the session id out of /api/interactive-sessions/{id}/pty style paths.
function sessionIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/api\/interactive-sessions\/([^/]+)\/(?:pty|terminal)$/);
  return m ? decodeURIComponent(m[1] as string) : null;
}

async function authorizeBridgeRequest(
  request: Request,
  sessionId: string,
  mode: "view" | "control",
): Promise<TerminalBridgeAuthorization> {
  try {
    return await authorizeTerminalBridge(request, env, sessionId, mode);
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 500;
    const reason = error instanceof Error ? error.message : "terminal authorization failed";
    return {
      ok: false,
      status: Number.isFinite(status) ? status : 500,
      reason,
    };
  }
}

// Refuse a ws upgrade with a real HTTP response instead of completing the
// handshake and erroring inside the socket.
function rejectUpgrade(socket: import("node:stream").Duplex, status: number, reason: string): void {
  const text = status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "Bad Request";
  const body = `${reason.slice(0, 200)}\n`;
  socket.write(
    `HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
  socket.destroy();
}

server.on("upgrade", (req, socket, head) => {
  void (async () => {
    const pathname = requestUrl(req).pathname;
    const vncSessionId = vncSessionIdFromPath(pathname);
    if (!isTerminalUpgrade(pathname) && !vncSessionId) {
      socket.destroy();
      return;
    }

    const request = await toWebRequest(req);
    if (!isAllowedBrowserOrigin(request)) {
      socket.write(
        "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: 29\r\n\r\ncross-origin request blocked\n",
      );
      socket.destroy();
      return;
    }

    // VNC viewer: authorize like a terminal takeover, then hand the raw ws to the
    // desktop bridge. No welcome/subscribe frames, the bridge speaks RFB.
    if (vncSessionId) {
      const auth = await authorizeBridgeRequest(request, vncSessionId, "control");
      if (!auth.ok) {
        rejectUpgrade(socket, auth.status, auth.reason);
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        void bridgeVncSession(ws, vncSessionId);
      });
      return;
    }
    // Path-addressed terminals name the session up front, so authorize BEFORE
    // completing the handshake. Rejected clients get a plain HTTP status, not
    // a 101 followed by an error frame.
    const pathSessionId = sessionIdFromPath(pathname);
    if (pathSessionId) {
      const auth = await authorizeBridgeRequest(request, pathSessionId, "control");
      if (!auth.ok) {
        rejectUpgrade(socket, auth.status, auth.reason);
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        sendWelcome(ws);
        sendSubscribed(ws, pathSessionId, auth.canInput);
        void bridgeSession(ws, pathSessionId, auth.canInput);
      });
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      sendWelcome(ws);
      // /api/terminal/ws multiplex: wait for the first Subscribe frame to learn
      // which session to attach to, then hand the ws to the bridge.
      const onFirstMessage = (data: Buffer | ArrayBuffer | Buffer[]): void => {
        void (async () => {
          const bytes = Buffer.isBuffer(data)
            ? new Uint8Array(data)
            : data instanceof ArrayBuffer
              ? new Uint8Array(data)
              : new Uint8Array(Buffer.concat(data as Buffer[]));
          const frame = decodeTerminalFrame(bytes);
          if (!frame) return;
          if (frame.type === TerminalMessageType.Subscribe && frame.sessionId) {
            // hand off: the bridge installs its own message listener
            ws.off("message", onFirstMessage);
            const auth = await authorizeBridgeRequest(request, frame.sessionId, "view");
            if (!auth.ok) {
              sendTerminalError(ws, frame.sessionId, auth.reason);
              ws.close(1008, auth.reason.slice(0, 120));
              return;
            }
            // make sure we still honor any size hint in the subscribe payload
            const sub = decodeSubscribePayload(frame.payload);
            sendSubscribed(ws, frame.sessionId, auth.canInput);
            void bridgeSessionWithSize(
              ws,
              frame.sessionId,
              sub?.cols ?? null,
              sub?.rows ?? null,
              auth.canInput,
            );
          }
        })();
      };
      ws.on("message", onFirstMessage);
    });
  })().catch((error) => {
    console.error("[lobsterfleet] terminal upgrade error", error);
    socket.destroy();
  });
});

// Same as bridgeSession but passes an initial pty size from the Subscribe frame.
async function bridgeSessionWithSize(
  ws: WebSocket,
  sessionId: string,
  cols: number | null,
  rows: number | null,
  canInput: boolean,
): Promise<void> {
  const target = await lookupSessionTarget(sessionId);
  if (!target) {
    sendNotice(ws, sessionId, "session not found");
    return;
  }
  const parsed = parseSshAttachUrl(target.attachUrl);
  if (!parsed) {
    sendNotice(
      ws,
      sessionId,
      target.status === "provisioning"
        ? "workspace still provisioning"
        : "no ssh terminal for this session",
    );
    return;
  }
  const leaseId = target.leaseId;
  attachSshBridge(
    ws,
    sessionId,
    { host: parsed.host, port: parsed.port, user: parsed.user, privateKeyPath: SSH_KEY_PATH },
    {
      ...(cols ? { cols } : {}),
      ...(rows ? { rows } : {}),
      allowInput: canInput,
      knownHostKey: leaseId ? knownHosts.get(leaseId) : null,
      onLearnHostKey: leaseId ? (hash) => knownHosts.set(leaseId, hash) : undefined,
      onReady: () => console.log(`[lobsterfleet] ssh bridge up for ${sessionId} -> ${parsed.host}`),
      onClose: () => console.log(`[lobsterfleet] ssh bridge closed for ${sessionId}`),
    },
  );
}

// Heartbeat timer: keep active crabbox leases alive while their sessions live.
// We pull live sessions that carry a coordinator lease and ping the broker.
const HEARTBEAT_MS = 60 * 1000;
const brokerEnv = process.env as unknown as BrokerEnv;
async function heartbeatActiveLeases(): Promise<void> {
  if (!brokerEnv.CRABBOX_COORDINATOR_URL || !brokerEnv.CRABBOX_COORDINATOR_TOKEN) return;
  let rows: Array<{ lease_id: string | null }>;
  try {
    rows = await sessionsDb
      .selectFrom("interactive_sessions")
      .select(["lease_id"])
      .where("status", "in", ["ready", "attached", "detached", "provisioning"])
      .execute();
  } catch {
    return;
  }
  for (const row of rows) {
    const id = coordinatorLeaseIdFromSessionLease(row.lease_id);
    if (!id) continue;
    await heartbeatLease(brokerEnv, id).catch(() => undefined);
  }
}
setInterval(() => {
  heartbeatActiveLeases().catch((error) => {
    console.error("[lobsterfleet] heartbeat error", error);
  });
}, HEARTBEAT_MS).unref();

// Background reconcile: the handler runs it on /api/state too, but a timer keeps
// stalled runs moving even when nobody is polling. Guard errors so it never
// crashes the process.
const RECONCILE_MS = 5 * 60 * 1000;
setInterval(() => {
  reconcileStalledRuns(env, Date.now()).catch((error) => {
    console.error("[lobsterfleet] reconcile error", error);
  });
}, RECONCILE_MS).unref();

server.listen(PORT, () => {
  console.log(`[lobsterfleet] listening on http://localhost:${PORT}`);
});
