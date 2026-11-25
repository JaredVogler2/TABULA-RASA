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
import { MIGRATIONS, type Migration } from "./migrations.generated";

export type Row = Record<string, unknown>;

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

export async function openPostgres(url: string, max = 10, schema?: string): Promise<Db> {
  const { Pool } = await import("pg");
  if (schema !== undefined && !/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error("invalid schema name");
  // `schema` puts every connection of this pool in one schema (used to isolate test suites)
  const pool = new Pool({ connectionString: url, max, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 8_000, ...(schema ? { options: `-c search_path=${schema}` } : {}) });
  // never let an idle-client error take the process down; a failed query surfaces to its caller
  pool.on("error", () => undefined);
  return {
    kind: "postgres",
    async query<T extends Row>(sql: string, params: unknown[] = []) {
      return (await pool.query(sql, params)).rows as T[];
    },
    async tx<T>(fn: (q: Queryer) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const q: Queryer = { query: async <R extends Row>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as R[] };
        const out = await fn(q);
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (err instanceof Rollback) return err.value as T;
        throw err;
      } finally {
        client.release();
      }
    },
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
      let db: Db;
      if (url) db = await openPostgres(url);
      else if (process.env.NODE_ENV === "production") throw new Error("DATABASE_URL is not configured");
      else db = await openPglite(".data/pglite");
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
