import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import {
  type CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  Kysely,
  type QueryResult,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
} from "kysely";

// Kysely dialect over Node's built-in SQLite (node:sqlite). No native build, so
// the LXC image needs nothing but a Node binary. Same shape as lobsterfleet's old
// D1 dialect, just pointed at a local file instead of Cloudflare D1.

type Param = null | number | bigint | string | Uint8Array;

function toParam(value: unknown): Param {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Uint8Array) return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "string") return value;
  return String(value);
}

const READ_FALLBACK = /^\s*(select|pragma)\b/i;
const CTE_MAIN_STATEMENT = /^\s*with\b[\s\S]*\)\s*(select|values|insert|update|delete|replace)\b/i;

type ColumnAwareStatement = StatementSync & {
  columns?: () => unknown[];
};

function statementReturnsRows(stmt: StatementSync, sql: string): boolean {
  try {
    const columns = (stmt as ColumnAwareStatement).columns?.();
    if (Array.isArray(columns)) return columns.length > 0;
  } catch {
    // Fall back to a conservative check below.
  }
  return fallbackStatementReturnsRows(sql);
}

function fallbackStatementReturnsRows(sql: string): boolean {
  if (READ_FALLBACK.test(sql)) return true;
  const cte = CTE_MAIN_STATEMENT.exec(sql);
  const statement = cte?.[1]?.toLowerCase();
  if (statement === "select" || statement === "values") return true;
  if (statement === "insert" || statement === "update" || statement === "delete" || statement === "replace") {
    return /\breturning\b/i.test(sql.slice(cte![0].length));
  }
  return false;
}

class NodeSqliteConnection implements DatabaseConnection {
  constructor(private readonly db: DatabaseSync) {}

  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    const stmt: StatementSync = this.db.prepare(query.sql);
    const params = query.parameters.map(toParam);
    if (statementReturnsRows(stmt, query.sql)) {
      return { rows: stmt.all(...params) as R[] };
    }
    const result = stmt.run(...params);
    return {
      rows: [],
      numAffectedRows: BigInt(result.changes),
      insertId: typeof result.lastInsertRowid === "bigint" ? result.lastInsertRowid : BigInt(result.lastInsertRowid),
    };
  }

  // node:sqlite is synchronous, so streaming just yields the full result once.
  async *streamQuery<R>(query: CompiledQuery): AsyncIterableIterator<QueryResult<R>> {
    yield await this.executeQuery<R>(query);
  }
}

class NodeSqliteDriver implements Driver {
  private connection: NodeSqliteConnection;

  constructor(private readonly db: DatabaseSync) {
    this.connection = new NodeSqliteConnection(db);
  }

  async init(): Promise<void> {}
  async acquireConnection(): Promise<DatabaseConnection> {
    return this.connection;
  }
  async beginTransaction(conn: DatabaseConnection): Promise<void> {
    await conn.executeQuery(CompiledNoResult("begin"));
  }
  async commitTransaction(conn: DatabaseConnection): Promise<void> {
    await conn.executeQuery(CompiledNoResult("commit"));
  }
  async rollbackTransaction(conn: DatabaseConnection): Promise<void> {
    await conn.executeQuery(CompiledNoResult("rollback"));
  }
  async releaseConnection(): Promise<void> {}
  async destroy(): Promise<void> {
    this.db.close();
  }
}

function CompiledNoResult(sql: string): CompiledQuery {
  return {
    sql,
    parameters: [],
    query: { kind: "RawNode", sqlFragments: [sql], parameters: [] } as never,
    queryId: { queryId: sql } as never,
  };
}

class NodeSqliteDialect implements Dialect {
  constructor(private readonly db: DatabaseSync) {}
  createAdapter() {
    return new SqliteAdapter();
  }
  createDriver(): Driver {
    return new NodeSqliteDriver(this.db);
  }
  createQueryCompiler() {
    return new SqliteQueryCompiler();
  }
  createIntrospector(db: Kysely<unknown>) {
    return new SqliteIntrospector(db);
  }
}

export function openDatabase(path: string): Kysely<unknown> {
  return openDatabaseWithHandle(path).db;
}

// Same as openDatabase but also hands back the raw node:sqlite handle. The
// migration runner needs it because multi-statement .sql files can't go through
// Kysely's single-statement prepare/run path. exec() runs the whole script.
export function openDatabaseWithHandle(path: string): { db: Kysely<unknown>; raw: DatabaseSync } {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new DatabaseSync(path);
  sqlite.exec("pragma journal_mode = WAL");
  sqlite.exec("pragma foreign_keys = ON");
  return { db: new Kysely<unknown>({ dialect: new NodeSqliteDialect(sqlite) }), raw: sqlite };
}
