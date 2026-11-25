/**
 * Load test of the budget ledger: many workers reserving, settling, releasing, timing out and
 * retrying at once against a real PostgreSQL server, then an audit of the books.
 *
 *   TEST_DATABASE_URL=postgres://… pnpm load [-- --requests 20000 --workers 32 --runs 8 --json out.json]
 *
 * No provider is involved and nothing is spent: the "requests" are ledger operations with
 * made-up costs, in a schema of their own that is dropped at the end. What it answers:
 *   - how many reservations a second the ledger sustains, and how long one takes (p50/p95/p99);
 *   - that under contention nothing is over-reserved: the global, daily and per-run ceilings
 *     hold at every moment, not just at the end (sampled while the load is running);
 *   - that a duplicate id is refused however many workers race on it, a settlement is applied
 *     once however many times it arrives, and an unknown outcome keeps its money held;
 *   - that no transaction is lost to a deadlock or a serialization failure.
 * The books are audited the way `src/server/ledger.test.ts` audits them.
 */
import { writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { num, type Db } from "../src/server/db";
import { Ledger, type ReserveRefusal } from "../src/server/ledger";
import { TEST_DATABASE_URL, insertRun, serverDb } from "../tests/support/db";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
}

/** A small deterministic generator, so that a run of this script can be repeated. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const quantile = (sorted: number[], q: number): number => (sorted.length ? (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] as number) : 0);

/** The books must agree with themselves and stay under every ceiling. Returns what is wrong, if anything. */
async function auditBooks(db: Db): Promise<string[]> {
  const wrong: string[] = [];
  const [b] = await db.query("SELECT * FROM budget WHERE id = 1");
  const [held] = await db.query("SELECT COALESCE(SUM(reserved_microusd),0) AS s FROM reservations WHERE state IN ('reserved','unknown')");
  const [spent] = await db.query("SELECT COALESCE(SUM(settled_microusd),0) AS s, COALESCE(SUM(overage_microusd),0) AS o FROM reservations WHERE state = 'settled'");
  if (!b) return ["no budget row"];
  if (num(b.reserved_microusd) !== num(held?.s)) wrong.push(`budget.reserved ${num(b.reserved_microusd)} ≠ sum of held reservations ${num(held?.s)}`);
  if (num(b.settled_microusd) !== num(spent?.s)) wrong.push(`budget.settled ${num(b.settled_microusd)} ≠ sum of settled reservations ${num(spent?.s)}`);
  if (num(b.reserved_microusd) + num(b.settled_microusd) > num(b.authorized_microusd)) wrong.push(`held + settled ${num(b.reserved_microusd) + num(b.settled_microusd)} exceeds the authorized ${num(b.authorized_microusd)}`);
  for (const r of await db.query("SELECT id, cap_microusd, reserved_microusd, settled_microusd FROM runs")) {
    const [h] = await db.query("SELECT COALESCE(SUM(reserved_microusd),0) AS s FROM reservations WHERE run_id = $1 AND state IN ('reserved','unknown')", [r.id]);
    const [s] = await db.query("SELECT COALESCE(SUM(settled_microusd),0) AS s FROM reservations WHERE run_id = $1 AND state = 'settled'", [r.id]);
    if (num(r.reserved_microusd) !== num(h?.s)) wrong.push(`run ${String(r.id)}: reserved ${num(r.reserved_microusd)} ≠ ${num(h?.s)}`);
    if (num(r.settled_microusd) !== num(s?.s)) wrong.push(`run ${String(r.id)}: settled ${num(r.settled_microusd)} ≠ ${num(s?.s)}`);
    if (num(r.reserved_microusd) + num(r.settled_microusd) > num(r.cap_microusd)) wrong.push(`run ${String(r.id)}: held + settled exceeds its cap`);
  }
  for (const d of await db.query("SELECT day::text AS day, reserved_microusd, settled_microusd FROM daily_spend")) {
    const [h] = await db.query("SELECT COALESCE(SUM(reserved_microusd),0) AS s FROM reservations WHERE day = $1::date AND state IN ('reserved','unknown')", [d.day]);
    const [s] = await db.query("SELECT COALESCE(SUM(settled_microusd),0) AS s FROM reservations WHERE day = $1::date AND state = 'settled'", [d.day]);
    if (num(d.reserved_microusd) !== num(h?.s)) wrong.push(`day ${String(d.day)}: reserved ${num(d.reserved_microusd)} ≠ ${num(h?.s)}`);
    if (num(d.settled_microusd) !== num(s?.s)) wrong.push(`day ${String(d.day)}: settled ${num(d.settled_microusd)} ≠ ${num(s?.s)}`);
    if (num(d.reserved_microusd) + num(d.settled_microusd) > num(b.daily_cap_microusd)) wrong.push(`day ${String(d.day)}: held + settled exceeds the daily cap`);
  }
  return wrong;
}

async function main(): Promise<void> {
  if (!TEST_DATABASE_URL) throw new Error("set TEST_DATABASE_URL to a PostgreSQL server: concurrency cannot be tested on one connection");
  const requests = Number(arg("requests", "20000"));
  const workers = Number(arg("workers", "32"));
  const runs = Number(arg("runs", "8"));
  const USD = 1_000_000;
  // the deployment's ceiling stands above what is authorized here: it is not what this test pushes against
  const CEILING = 1_000 * USD;
  // ceilings chosen so that all three are reached during the test: the point is to push against them
  const authorized = 40 * USD;
  const daily = 30 * USD;
  const runCap = 6 * USD;

  const { db, second, drop } = await serverDb(Math.max(8, Math.ceil(workers / 2)));
  // two pools on one schema: two server instances, as far as the database can tell
  const other = await second();
  const ledgers = [new Ledger(db, { ceilingMicroUsd: CEILING }), new Ledger(other, { ceilingMicroUsd: CEILING })];
  try {
    await ledgers[0]!.authorize(authorized, daily, "load-test");
    await ledgers[0]!.setKillSwitch(false, "load test", "load-test");
    for (let r = 0; r < runs; r++) await insertRun(db, `run-${r}`, runCap);

    const reserveMs: number[] = [];
    const settleMs: number[] = [];
    const outcomes = { reserved: 0, settled: 0, released: 0, unknown: 0, duplicateRefused: 0, settledTwice: 0 };
    const refusals: Partial<Record<ReserveRefusal, number>> = {};
    const errors: string[] = [];
    const midAudits: string[] = [];
    let next = 0;
    let stop = false;

    const worker = async (w: number): Promise<void> => {
      const random = rng(1000 + w);
      const ledger = ledgers[w % 2] as Ledger;
      while (!stop) {
        const i = next++;
        if (i >= requests) return;
        const id = `r:${i}`;
        const runId = `run-${Math.floor(random() * runs)}`;
        const amount = 1000 + Math.floor(random() * 80_000);
        try {
          const t0 = performance.now();
          const res = await ledger.reserve({ id, runId, amount, model: "load-model", requestHash: `h${i}` });
          reserveMs.push(performance.now() - t0);
          if (!res.ok) {
            refusals[res.reason] = (refusals[res.reason] ?? 0) + 1;
            continue;
          }
          outcomes.reserved++;
          // a retry storm: the same request arrives again from the other instance and must be refused
          if (random() < 0.05) {
            const again = await (ledgers[(w + 1) % 2] as Ledger).reserve({ id, runId, amount, model: "load-model", requestHash: `h${i}` });
            if (!again.ok && again.reason === "duplicate") outcomes.duplicateRefused++;
            else errors.push(`duplicate reservation ${id} was not refused: ${JSON.stringify(again)}`);
          }
          const fate = random();
          if (fate < 0.8) {
            const cost = Math.floor(amount * random());
            const t1 = performance.now();
            const first = await ledger.settle(id, { costMicroUsd: cost });
            settleMs.push(performance.now() - t1);
            if (first !== "settled") errors.push(`settle ${id}: ${first}`);
            else outcomes.settled++;
            // the answer is delivered twice (a re-ordered or repeated settlement): it must change nothing
            if (random() < 0.1) {
              const twice = await (ledgers[(w + 1) % 2] as Ledger).settle(id, { costMicroUsd: cost + 1 });
              if (twice === "already") outcomes.settledTwice++;
              else errors.push(`second settlement of ${id} was applied: ${twice}`);
            }
          } else if (fate < 0.92) {
            const rel = await ledger.release(id, "definite failure");
            if (rel !== "released") errors.push(`release ${id}: ${rel}`);
            else outcomes.released++;
          } else {
            await ledger.markUnknown(id, "timed out");
            outcomes.unknown++;
          }
        } catch (err) {
          errors.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    };

    // while the load runs, the books are audited from outside: the ceilings must hold at every moment
    const watcher = (async () => {
      while (!stop) {
        await new Promise((r) => setTimeout(r, 400));
        const [b] = await db.query("SELECT authorized_microusd, daily_cap_microusd, reserved_microusd, settled_microusd FROM budget WHERE id = 1");
        if (b && num(b.reserved_microusd) + num(b.settled_microusd) > num(b.authorized_microusd)) midAudits.push(`over the authorized amount mid-run: ${num(b.reserved_microusd) + num(b.settled_microusd)}`);
        for (const r of await db.query("SELECT id, cap_microusd, reserved_microusd, settled_microusd FROM runs")) if (num(r.reserved_microusd) + num(r.settled_microusd) > num(r.cap_microusd)) midAudits.push(`run ${String(r.id)} over its cap mid-run`);
      }
    })();

    const started = performance.now();
    await Promise.all(Array.from({ length: workers }, (_, w) => worker(w)));
    const elapsedMs = performance.now() - started;
    stop = true;
    await watcher;

    const wrong = await auditBooks(db);
    const summary = await ledgers[0]!.summary();
    reserveMs.sort((a, b) => a - b);
    settleMs.sort((a, b) => a - b);
    const round = (v: number): number => Math.round(v * 100) / 100;
    const report = {
      env: { date: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model ?? "unknown", cores: cpus().length, database: "PostgreSQL (TEST_DATABASE_URL), two pools on one schema" },
      load: { requests, workers, runs, authorizedUsd: authorized / USD, dailyCapUsd: daily / USD, runCapUsd: runCap / USD },
      elapsedSeconds: round(elapsedMs / 1000),
      reservationsPerSecond: Math.round((reserveMs.length / elapsedMs) * 1000),
      reserveMs: { p50: round(quantile(reserveMs, 0.5)), p95: round(quantile(reserveMs, 0.95)), p99: round(quantile(reserveMs, 0.99)), max: round(reserveMs[reserveMs.length - 1] ?? 0) },
      settleMs: { p50: round(quantile(settleMs, 0.5)), p95: round(quantile(settleMs, 0.95)), p99: round(quantile(settleMs, 0.99)), max: round(settleMs[settleMs.length - 1] ?? 0) },
      outcomes,
      refusals,
      books: { heldUsd: round(summary.reservedMicroUsd / USD), ofWhichUnknownUsd: round(summary.unknownMicroUsd / USD), settledUsd: round(summary.settledMicroUsd / USD), overageUsd: round(summary.overageMicroUsd / USD), remainingUsd: round(summary.remainingMicroUsd / USD), killSwitch: summary.killSwitch },
      errors: errors.slice(0, 20),
      errorCount: errors.length,
      ceilingBreachesSeenWhileRunning: midAudits.length,
      auditFailures: wrong,
    };
    console.log(JSON.stringify(report, null, 1));
    const out = arg("json", "");
    if (out) writeFileSync(out, `${JSON.stringify(report, null, 1)}\n`);
    const ok = errors.length === 0 && midAudits.length === 0 && wrong.length === 0;
    console.log(ok ? `OK: ${reserveMs.length} reservations attempted by ${workers} workers through two pools; books balanced; no ceiling exceeded at any sampled moment; no errors.` : "FAILED: see errors, ceilingBreachesSeenWhileRunning and auditFailures above.");
    process.exitCode = ok ? 0 : 1;
  } finally {
    await drop();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
