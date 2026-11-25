/**
 * The live smoke test, from the command line. See src/server/smoke.ts for what it is and what
 * it takes; nothing in the test suite or in CI can reach it.
 *
 *   pnpm live:smoke
 *       Says what is configured and what is missing, what the smoke ledger has spent and
 *       holds, and the exact words that would authorize the next run. Makes no request and
 *       changes nothing.
 *
 *   LIVE_SMOKE_MAX_USD=2 LIVE_SMOKE_CONFIRM="I authorize live smoke test 1 for at most $2" pnpm live:smoke -- --run
 *       Makes the run those words name: three paid requests at most, capped at that amount.
 *       The same words do nothing a second time — the next run has the next number.
 *
 *   pnpm live:smoke -- --reconcile <reservation id> release
 *   pnpm live:smoke -- --reconcile <reservation id> settle-full
 *       After checking the provider's own usage record: decide a request whose outcome was
 *       unknown as not billed, or as billed for all that was held.
 *
 * It needs the same settings as live mode in the application (LIVE_ENABLED=true,
 * ANTHROPIC_API_KEY, ANTHROPIC_MODEL, DATABASE_URL, BUDGET_CEILING_USD), and keeps its ledger
 * in the schema `live_smoke` of that database. That schema is never dropped.
 *
 * The key is never printed. Run it with the variables on the command line, not exported:
 * what is exported stays in the shell.
 */
import { liveProvider } from "../src/server/anthropic";
import { openConfigured } from "../src/server/db";
import { anthropicKey, budgetCeilingMicro } from "../src/server/env";
import { Ledger } from "../src/server/ledger";
import { SMOKE_MAX_USD, SMOKE_SCHEMA, runSmoke, smokeGate } from "../src/server/smoke";
import { formatUsd } from "../src/providers/prices";

async function main(): Promise<number> {
  const env = process.env;
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const url = (env.DATABASE_URL ?? "").trim();
  if (!url) {
    console.log("DATABASE_URL is not set: the smoke test keeps its ledger in PostgreSQL, and without one there is nothing to look at. Nothing was done.");
    return 1;
  }
  const db = await openConfigured(url, SMOKE_SCHEMA, 4);
  try {
    const now = Date.now();
    const reconcile = args.indexOf("--reconcile");
    if (reconcile >= 0) {
      const id = args[reconcile + 1] ?? "";
      const how = args[reconcile + 2] ?? "";
      if (!id || (how !== "release" && how !== "settle-full")) {
        console.log("usage: pnpm live:smoke -- --reconcile <reservation id> release|settle-full");
        return 1;
      }
      const ledger = new Ledger(db, { ceilingMicroUsd: budgetCeilingMicro(env) });
      const r = await ledger.get(id);
      if (!r) {
        console.log("there is no such reservation in the smoke ledger");
        return 1;
      }
      const out = await ledger.reconcile(id, how === "release" ? { release: true } : { settleMicroUsd: r.reservedMicroUsd }, "live-smoke-cli");
      console.log(out === "done" ? `reconciled ${id}: ${how === "release" ? "released as not billed" : `settled for all that was held (${formatUsd(r.reservedMicroUsd, 4)})`}` : `nothing was changed (${out}): only a reservation whose outcome is unknown can be decided`);
      return out === "done" ? 0 : 1;
    }

    const gate = await smokeGate(db, env, now);
    console.log(`live smoke test — ledger in schema "${SMOKE_SCHEMA}" (kept, never dropped)`);
    console.log(`  runs so far: ${gate.runsSoFar}; spent ${formatUsd(gate.spentMicroUsd, 4)}; held with outcome unknown ${formatUsd(gate.heldMicroUsd, 4)}; deployment ceiling ${formatUsd(gate.ceilingMicroUsd)}`);
    console.log(`  model: ${gate.model ?? "(none configured)"}; one run asks three minds once each, for at most $${SMOKE_MAX_USD}`);
    if (!args.includes("--run")) {
      if (gate.reasons.length) {
        console.log("  not ready:");
        for (const r of gate.reasons) console.log(`    · ${r}`);
      }
      console.log(`  the words that authorize the next run (number ${gate.number}), with LIVE_SMOKE_MAX_USD set to the same amount:`);
      console.log(`    LIVE_SMOKE_CONFIRM="${gate.phrase}"`);
      console.log("  then: pnpm live:smoke -- --run        (nothing was sent or changed by this look)");
      const unknown = await new Ledger(db, { ceilingMicroUsd: gate.ceilingMicroUsd }).list("unknown", 20);
      for (const u of unknown) console.log(`  outcome unknown: ${u.id} holds ${formatUsd(u.reservedMicroUsd, 4)} — check the provider's usage record, then --reconcile it`);
      return 0;
    }
    if (!gate.ok) {
      console.log("  NOT AUTHORIZED — no request was made:");
      for (const r of gate.reasons) console.log(`    · ${r}`);
      return 1;
    }
    const provider = liveProvider(gate.model, anthropicKey(env));
    if (!provider.ok) {
      console.log(`  no provider: ${provider.reason}. No request was made.`);
      return 1;
    }
    console.log(`  AUTHORIZED: smoke test ${gate.number}, at most ${formatUsd(gate.maxMicroUsd)}. Making real, paid requests now.`);
    const report = await runSmoke(db, env, provider.provider, now);
    for (const line of report.lines) console.log(line);
    return report.state === "done" && report.overageMicroUsd === 0 && report.heldMicroUsd === 0 ? 0 : 2;
  } finally {
    await db.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    // a message can quote a connection string or a provider's words: the kind of error is enough to act on
    const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
    console.error(`live smoke test failed: ${err instanceof Error ? err.name : "error"}${code ? ` (${code})` : ""}${err instanceof Error && /not authorized|already been started|could not be/.test(err.message) ? ` — ${err.message}` : ""}`);
    process.exit(1);
  });
