/**
 * Test databases.
 *
 * `memoryDb` is PGlite in memory: real PostgreSQL semantics on one connection, enough for
 * everything except concurrency. `serverDb` is a schema of its own on a real PostgreSQL
 * server (TEST_DATABASE_URL), with a real connection pool: the only place concurrency claims
 * can honestly be tested. Suites that need it are skipped, by name, when no server is given.
 */
import { migrate, openPglite, openPostgres, type Db } from "@/server/db";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";

export async function memoryDb(): Promise<Db> {
  const db = await openPglite();
  await migrate(db);
  return db;
}

let counter = 0;

/** A migrated, empty schema on the test server, and a function that drops it. */
export async function serverDb(max = 24): Promise<{ db: Db; second: () => Promise<Db>; drop: () => Promise<void> }> {
  if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set");
  const schema = `t_${process.pid}_${Date.now().toString(36)}_${counter++}`;
  const admin = await openPostgres(TEST_DATABASE_URL, 1);
  await admin.query(`CREATE SCHEMA ${schema}`);
  const db = await openPostgres(TEST_DATABASE_URL, max, schema);
  await migrate(db);
  const others: Db[] = [];
  return {
    db,
    // a second pool on the same schema: another server instance, as far as the database can tell
    second: async () => {
      const d = await openPostgres(TEST_DATABASE_URL, max, schema);
      others.push(d);
      return d;
    },
    drop: async () => {
      await db.close();
      for (const d of others) await d.close();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.close();
    },
  };
}

/** A run row with the least a reservation needs. */
export async function insertRun(db: Db, id: string, capMicroUsd: number, status = "active"): Promise<void> {
  await db.query("INSERT INTO runs (id, status, provider, model, prompt_version, cap_microusd, config, spec, sched, snapshot, digest) VALUES ($1, $2, 'anthropic', 'claude-fable-5-2', 'p1', $3::bigint, '{}', '{}', '{}', '', '')", [id, status, capMicroUsd]);
}
