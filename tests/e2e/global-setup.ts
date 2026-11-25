/**
 * Start every end-to-end run from an empty owner ledger.
 *
 * The test server keeps its ledger in a schema of its own (`e2e`) on the test database. It
 * creates that schema and applies the migrations the first time an API route needs the
 * database, so dropping the schema here — after the server has started, before any test has
 * called it — gives each run a clean ledger, an empty run list and fresh rate-limit windows.
 */
import pg from "pg";

export default async function globalSetup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || process.env.E2E_BASE_URL) return; // nothing to reset: no database, or someone else's server
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS e2e CASCADE");
  } finally {
    await client.end();
  }
}
