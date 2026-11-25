/**
 * Apply the SQL migrations in db/migrations to the database named by DATABASE_URL
 * (or, with --test, TEST_DATABASE_URL). Idempotent: applied migrations are recorded and
 * skipped. Prints which files were applied — never the connection string.
 *
 *   pnpm db:migrate
 *   pnpm db:migrate --test
 */
import { migrate, openPostgres } from "../src/server/db";

async function main(): Promise<void> {
  const test = process.argv.includes("--test");
  const name = test ? "TEST_DATABASE_URL" : "DATABASE_URL";
  const url = process.env[name];
  if (!url) {
    console.error(`${name} is not set. Nothing was done.`);
    process.exit(1);
  }
  const db = await openPostgres(url, 1);
  try {
    const applied = await migrate(db);
    const [budget] = await db.query("SELECT authorized_microusd, kill_switch FROM budget WHERE id = 1");
    console.log(applied.length ? `applied: ${applied.join(", ")}` : "nothing to apply: the schema is current");
    console.log(`budget row present: authorized ${String(budget?.authorized_microusd)} microdollars, kill switch ${budget?.kill_switch === true ? "ON" : "off"}`);
  } finally {
    await db.close();
  }
}

main().catch((err: unknown) => {
  // the message of a connection error can contain the host; the code is enough to act on
  const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
  console.error(`migration failed: ${err instanceof Error ? err.name : "error"}${code ? ` (${code})` : ""}`);
  process.exit(1);
});
