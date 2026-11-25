import "server-only";

/**
 * One small database interface with two implementations: PostgreSQL through `pg` wherever a
 * DATABASE_URL is configured (production, CI), and PGlite — PostgreSQL compiled to WebAssembly
 * — on disk for local development and in memory for unit tests. Both speak the same SQL, so
 * the ledger's statements are exercised unchanged in every environment (D-008).
 *
 * PGlite is a single connection: it cannot show that concurrent reservations are safe. That
 * property is tested against a real server (`TEST_DATABASE_URL`).
 */
import type { PoolClient } from "pg";
import { MIGRATIONS, type Migration } from "./migrations.generated";

export type Row = Record<string, unknown>;

/** The longest one statement may run, one lock may be waited for, and a transaction may sit idle (ms). */
export const STATEMENT_TIMEOUT_MS = 15_000;
export const LOCK_TIMEOUT_MS = 5_000;
export const IDLE_IN_TX_TIMEOUT_MS = 30_000;

export interface Queryer {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryer {
  /** Run `fn` in one transaction; a throw rolls it back. */
  tx<T>(fn: (q: Queryer) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly kind: "postgres" | "pglite";
}

/** Thrown inside a transaction to roll it back and hand a value to the caller. */
export class Rollback<T> extends Error {
  constructor(public readonly value: T) {
    super("rollback");
  }
}

/** The limits every transaction on a server connection runs under. Tests shorten them; nothing else should. */
export interface Limits {
  statementMs: number;
  lockMs: number;
  idleInTxMs: number;
}

export const LIMITS: Limits = { statementMs: STATEMENT_TIMEOUT_MS, lockMs: LOCK_TIMEOUT_MS, idleInTxMs: IDLE_IN_TX_TIMEOUT_MS };

/**
 * The statement that opens every transaction: BEGIN, the three limits, and the schema if there
 * is one. `SET LOCAL` lasts exactly as long as the transaction, so nothing is ever left on the
 * connection itself.
 *
 * That matters because of where this runs. The limits used to be sent once, when a connection
 * was made (the `options` startup parameter). A hosted PostgreSQL is usually reached through a
 * transaction pooler (PgBouncer; it is what the connection string a Vercel Marketplace
 * database injects points at), and a pooler refuses startup parameters it cannot keep track of
 * and gives a different server connection to every transaction — so session settings are
 * either refused or silently lost. Set inside each transaction, they work the same through a
 * pooler and straight to a server (D-047).
 */
export function opening(limits: Limits, schema?: string): string {
  const n = (v: number): number => Math.max(1, Math.floor(v));
  return [
    "BEGIN",
    `SET LOCAL statement_timeout = ${n(limits.statementMs)}`,
    `SET LOCAL lock_timeout = ${n(limits.lockMs)}`,
    `SET LOCAL idle_in_transaction_session_timeout = ${n(limits.idleInTxMs)}`,
    ...(schema ? [`SET LOCAL search_path = ${schema}`] : []),
  ].join("; ");
}

export async function openPostgres(url: string, max = 10, schema?: string, limits: Limits = LIMITS): Promise<Db> {
  const { Pool } = await import("pg");
  if (schema !== undefined && !/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error("invalid schema name");
  // `schema` puts every transaction of this pool in one schema (used to isolate test suites).
  // No statement may run, and no lock may be waited for, without limit: a stuck query fails
  // (and its transaction rolls back) instead of holding a connection, a row lock and a
  // serverless function until the platform kills all three.
  const open = opening(limits, schema);
  const pool = new Pool({ connectionString: url, max, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 8_000 });
  // never let an idle-client error take the process down; a failed query surfaces to its caller
  pool.on("error", () => undefined);

  type Held = { client: PoolClient; done: (destroy?: boolean) => void };

  /**
   * A connection with a transaction begun on it, and the way to give it back.
   *
   * A connection lost while this code holds it — the server ended an idle transaction, the
   * database restarted, the network dropped — is announced by the driver as an `error` event on
   * the connection, and the pool listens for that only while a connection is idle. An event
   * nobody listens for ends the whole process. So every held connection has a listener: the loss
   * also fails whatever is asked of the connection next, and that is where it is dealt with.
   *
   * A pooled connection can also have died while nobody was looking (the function was suspended;
   * the database went to sleep and came back): if the opening statement fails, that connection is
   * destroyed and one more is tried. Nothing has been asked of the database at that point, so
   * trying again repeats nothing.
   */
  const begun = async (): Promise<Held> => {
    for (let attempt = 0; ; attempt++) {
      const client = await pool.connect();
      const heard = (): void => undefined;
      client.on("error", heard);
      const done = (destroy = false): void => {
        client.removeListener("error", heard);
        client.release(destroy);
      };
      try {
        await client.query(open);
        return { client, done };
      } catch (err) {
        done(true);
        if (attempt >= 1) throw err;
      }
    }
  };

  async function tx<T>(fn: (q: Queryer) => Promise<T>): Promise<T> {
    const { client, done } = await begun();
    let broken = false;
    try {
      const q: Queryer = { query: async <R extends Row>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as R[] };
      const out = await fn(q);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {
        // a connection that cannot even roll back is not put back in the pool
        broken = true;
      });
      if (err instanceof Rollback) return err.value as T;
      throw err;
    } finally {
      done(broken);
    }
  }

  return {
    kind: "postgres",
    // a statement on its own is a transaction of one: it runs under the same limits, in the same schema
    query<T extends Row>(sql: string, params: unknown[] = []) {
      return tx((q) => q.query<T>(sql, params));
    },
    tx,
    async close() {
      await pool.end();
    },
  };
}

export async function openPglite(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await pg.waitReady;
  return {
    kind: "pglite",
    async query<T extends Row>(sql: string, params: unknown[] = []) {
      return (await pg.query(sql, params)).rows as T[];
    },
    async tx<T>(fn: (q: Queryer) => Promise<T>): Promise<T> {
      try {
        return (await pg.transaction(async (tx) => {
          const q: Queryer = { query: async <R extends Row>(sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows as R[] };
          return fn(q);
        })) as T;
      } catch (err) {
        if (err instanceof Rollback) return err.value as T;
        throw err;
      }
    },
    async close() {
      await pg.close();
    },
  };
}

/**
 * Apply every migration that has not been applied yet, in order. The SQL is embedded at build
 * time from db/migrations (scripts/gen-migrations.ts), so nothing is read from disk here.
 */
export async function migrate(db: Db, migrations: readonly Migration[] = MIGRATIONS): Promise<string[]> {
  await db.query("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await db.query<{ version: string }>("SELECT version FROM schema_migrations")).map((r) => r.version));
  const applied: string[] = [];
  for (const m of [...migrations].sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0))) {
    if (done.has(m.version)) continue;
    await db.tx(async (q) => {
      // statements are separated by semicolons at line ends; the files contain no procedural bodies
      for (const statement of m.sql.split(/;\s*\n/)) {
        const text = statement.replace(/^\s*--.*$/gm, "").trim();
        if (text) await q.query(text);
      }
      await q.query("INSERT INTO schema_migrations (version) VALUES ($1)", [m.version]);
    });
    applied.push(m.version);
  }
  return applied;
}

/**
 * Open the PostgreSQL database a deployment's configuration names — in a schema of its own if
 * the configuration names one (created if it is not there) — and bring it up to date. The
 * application, the migration script and the live smoke test all open their database through
 * this, so that all three mean the same tables.
 */
export async function openConfigured(url: string, schemaName: string | undefined, max = 10): Promise<Db> {
  const schema = (schemaName ?? "").trim() || undefined;
  if (schema) {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error("DATABASE_SCHEMA is not a valid schema name");
    const admin = await openPostgres(url, 1);
    try {
      await admin.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    } finally {
      await admin.close();
    }
  }
  const db = await openPostgres(url, max, schema);
  try {
    await migrate(db);
  } catch (err) {
    await db.close().catch(() => undefined);
    throw err;
  }
  return db;
}

let shared: Promise<Db> | null = null;

/**
 * The process-wide database. With DATABASE_URL: PostgreSQL. Without it, and only outside
 * production: an on-disk PGlite in .data/ (so the owner console can be tried locally).
 * In production without a database this throws, and every live endpoint fails closed.
 */
export function getDb(): Promise<Db> {
  if (!shared) {
    shared = (async () => {
      const url = process.env.DATABASE_URL;
      // optional: keep this application's tables in a schema of their own inside a shared database
      if (url) return openConfigured(url, process.env.DATABASE_SCHEMA);
      if (process.env.NODE_ENV === "production") throw new Error("DATABASE_URL is not configured");
      const db = await openPglite(".data/pglite");
      await migrate(db);
      return db;
    })();
    // a failed open must not be cached forever
    shared.catch(() => {
      shared = null;
    });
  }
  return shared;
}

/** Numbers come back from bigint columns as strings (pg) or bigints (PGlite). Microdollar totals fit a double exactly. */
export function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && v !== "") return Number(v);
  return 0;
}
