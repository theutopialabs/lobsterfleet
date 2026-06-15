// Minimal ambient shims for the Cloudflare types the ported handler still
// references. We dropped the Cloudflare runtime, so these only need to keep the
// file typechecking on Node.
//
// Behavior note: in the Node port env.SANDBOX / env.DB-as-D1 / R2 buckets are
// never set to real CF objects, so the branches guarded by them are dead. These
// types just satisfy tsc for that code.

// Base env bag. The real shape is RuntimeEnv in index.ts which intersects this.
interface Env {
  [key: string]: unknown;
}

// We open the DB through node:sqlite (db.ts), so D1Database here is only a type
// placeholder for the old D1 dialect signatures that survive as dead code.
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  run(): Promise<{ meta: { changes?: number; last_row_id?: number } }>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

// R2 is replaced by a local disk bucket in the Node entry.
interface R2Object {
  body?: ReadableStream | null;
  [key: string]: unknown;
}
interface R2Bucket {
  get(key: string): Promise<R2Object | null>;
  put(key: string, value: unknown, options?: unknown): Promise<unknown>;
  delete(key: string): Promise<void>;
}

// Durable Object stubs. SessionControlDO is now a plain singleton (see index.ts)
// so the only method the call sites use is fetch().
interface DurableObjectId {
  toString(): string;
}
interface DurableObjectStub<_T = unknown> {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
}
interface DurableObjectNamespace<T = unknown> {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub<T>;
}

// Old Worker entry shape. handleRequest replaces it, but the type is referenced
// in a `satisfies` we removed. Keep it so any stragglers compile.
interface ExportedHandler<_Env = unknown> {
  fetch(request: Request, env: _Env): Promise<Response>;
}

// Terminal websocket upgrade lived on these CF-only globals. The Node entry
// handles real upgrades via the `ws` library, so these are just type stubs for
// the dead WebSocketPair branches.
declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}

interface WebSocket {
  accept(): void;
}

interface ResponseInit {
  webSocket?: WebSocket | null;
}

interface Response {
  readonly webSocket?: WebSocket | null;
  // CF Response had a generic json(). Standard lib does not. Keep the overload
  // so the handler's response.json<T>() calls typecheck.
  json<T = unknown>(): Promise<T>;
}
