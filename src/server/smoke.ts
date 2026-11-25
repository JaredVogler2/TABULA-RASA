import "server-only";

/**
 * THE LIVE SMOKE TEST: the first, smallest contact with the real API — three minds asked
 * once each — and the only code outside the owner console that can make a paid request.
 *
 * It is not a unit test and no test run can reach it. It runs only from its own script
 * (`pnpm live:smoke -- --run`), and only when all of this holds:
 *
 *   • everything live mode needs is configured (LIVE_ENABLED, a key, a priced model,
 *     PostgreSQL, a deployment ceiling), exactly as for the application;
 *   • the owner has said, in words, that this numbered run may spend up to this amount:
 *       LIVE_SMOKE_CONFIRM="I authorize live smoke test 1 for at most $2"
 *       LIVE_SMOKE_MAX_USD=2
 *     The words name the run's number, and a number is used once. The same words left in a
 *     shell profile or a CI setting cannot run it a second time: the next run is number 2,
 *     and nobody has authorized that.
 *   • the amount is at most two dollars, and what this ledger has already spent or still
 *     holds, plus that amount, fits under the deployment's ceiling.
 *
 * Its ledger lives in a schema of its own (`live_smoke`) in the configured database and is
 * never dropped: what a run reserved, what the provider reported, and anything whose outcome
 * is unknown stay on record for the next run to count against the ceiling and for the owner
 * to reconcile. The kill switch is on before it starts and on again when it ends, however
 * it ends.
 *
 * Status in this repository: NEVER RUN. No key has been present and no authorization given.
 */
import { makeConfig } from "@/engine";
import { formatUsd, usdToMicro } from "@/providers/prices";
import { DEFAULT_SPEC, type RunSpec } from "@/providers/run";
import type { Provider } from "@/providers/types";
import { num, type Db } from "./db";
import { budgetCeilingMicro, liveStatus } from "./env";
import { Ledger } from "./ledger";
import { callSummary, createRun, epochsOf, getRun, stepRun } from "./runs";

/** The most one smoke run may be authorized for (the ceiling the prompt program suggests for a first contact). */
export const SMOKE_MAX_USD = 2;
/** How many people are asked: each once. */
export const SMOKE_MINDS = 3;
/** The schema that holds the smoke test's own ledger. It is created if absent and never dropped. */
export const SMOKE_SCHEMA = "live_smoke";

type Env = Record<string, string | undefined>;

/** The words that authorize smoke run `n` for at most `usd` dollars. */
export const smokePhrase = (n: number, usd: number): string => `I authorize live smoke test ${n} for at most $${usd}`;

export interface SmokeGate {
  /** True only if this run may be made now. */
  ok: boolean;
  /** Why not, one plain reason per failed condition. Never a secret, never a value from the environment. */
  reasons: string[];
  /** The number the next run will have. */
  number: number;
  maxMicroUsd: number;
  /** The exact words that would authorize it. */
  phrase: string;
  ceilingMicroUsd: number;
  /** What this ledger has spent (settled and overcharged) and still holds, over all runs so far. */
  spentMicroUsd: number;
  heldMicroUsd: number;
  model: string | null;
  runsSoFar: number;
}

/** The amount asked for: a plain number of dollars with at most two decimals, above zero and at most the smoke limit. */
function askedUsd(env: Env): number {
  const raw = (env.LIVE_SMOKE_MAX_USD ?? "").trim();
  if (!/^\d(\.\d{1,2})?$/.test(raw)) return 0;
  const usd = Number(raw);
  return usd > 0 && usd <= SMOKE_MAX_USD ? usd : 0;
}

/**
 * Whether the next smoke run may be made, and if not, why not. Reads the smoke ledger; writes
 * nothing; makes no request. (Owner sign-in is not part of this test, so the two owner values
 * are filled in: only the conditions on spending decide.)
 */
export async function smokeGate(db: Db, env: Env, nowMs: number): Promise<SmokeGate> {
  const reasons: string[] = [];
  const live = liveStatus({ ...env, OWNER_PASSWORD_HASH: env.OWNER_PASSWORD_HASH ?? "scrypt:the-smoke-test-has-no-owner-endpoint", AUTH_SECRET: env.AUTH_SECRET ?? "x".repeat(32) }, nowMs);
  for (const r of live.reasons) reasons.push(r);
  const ceiling = budgetCeilingMicro(env);
  const [last] = await db.query("SELECT COALESCE(MAX(n), 0) AS n, COUNT(*) AS runs FROM smoke_runs");
  const number = num(last?.n) + 1;
  const [b] = await db.query("SELECT reserved_microusd, settled_microusd, overage_microusd FROM budget WHERE id = 1");
  const spent = num(b?.settled_microusd) + num(b?.overage_microusd);
  const held = num(b?.reserved_microusd);
  const usd = askedUsd(env);
  const max = usdToMicro(usd);
  if (usd === 0) reasons.push(`LIVE_SMOKE_MAX_USD is not an amount of dollars above 0 and at most ${SMOKE_MAX_USD}`);
  const phrase = smokePhrase(number, usd || SMOKE_MAX_USD);
  const said = (env.LIVE_SMOKE_CONFIRM ?? "").trim();
  if (usd > 0 && said !== phrase) {
    const earlier = /^I authorize live smoke test (\d+) for at most \$/.exec(said);
    reasons.push(
      earlier && Number(earlier[1]) < number
        ? `LIVE_SMOKE_CONFIRM authorizes smoke test ${earlier[1]}, which has already been run: the next is number ${number}, and it needs its own words`
        : "LIVE_SMOKE_CONFIRM does not say, word for word, that this numbered run is authorized for this amount",
    );
  }
  if (ceiling > 0 && max > 0 && spent + held + max > ceiling) reasons.push("what the smoke ledger has spent or still holds, plus this run, would pass the deployment's ceiling (BUDGET_CEILING_USD)");
  if (held > 0) reasons.push("money from an earlier smoke run is still held with its outcome unknown: check the provider's usage record and reconcile it before running another");
  return { ok: reasons.length === 0, reasons, number, maxMicroUsd: max, phrase, ceilingMicroUsd: ceiling, spentMicroUsd: spent, heldMicroUsd: held, model: live.model, runsSoFar: num(last?.runs) };
}

export interface SmokeReport {
  number: number;
  runId: string;
  model: string;
  /** How the one epoch ended: done, or paused / failed with a reason. */
  state: string;
  reason: string;
  calls: Awaited<ReturnType<typeof callSummary>>;
  reservations: { id: string; state: string; reservedMicroUsd: number; settledMicroUsd: number; overageMicroUsd: number; inputTokens: number | null; outputTokens: number | null }[];
  authorizedMicroUsd: number;
  settledMicroUsd: number;
  heldMicroUsd: number;
  overageMicroUsd: number;
  epochsCommitted: number;
  lines: string[];
}

/**
 * Make smoke run number `gate.number`: three minds, one epoch, one attempt each, capped at the
 * authorized amount. Call only with a gate that said ok — it is checked again here, inside the
 * transaction that uses up the run's number.
 */
export async function runSmoke(db: Db, env: Env, provider: Provider, nowMs: number): Promise<SmokeReport> {
  const gate = await smokeGate(db, env, nowMs);
  if (!gate.ok) throw new Error(`the live smoke test is not authorized: ${gate.reasons.join("; ")}`);
  const live = liveStatus({ ...env, OWNER_PASSWORD_HASH: env.OWNER_PASSWORD_HASH ?? "scrypt:the-smoke-test-has-no-owner-endpoint", AUTH_SECRET: env.AUTH_SECRET ?? "x".repeat(32) }, nowMs);
  if (provider.model !== live.model) throw new Error("the provider given is not the configured model");
  const ledger = new Ledger(db, { ceilingMicroUsd: gate.ceilingMicroUsd, clock: () => new Date(nowMs) });
  const actor = `live-smoke-${gate.number}`;

  // The number is used up before anything can be spent: a second process holding the same
  // words finds it taken (the primary key refuses), and the same words never work twice.
  const placeholder = `pending-${gate.number}`;
  const claimed = await db.query("INSERT INTO smoke_runs (n, run_id, max_microusd) VALUES ($1, $2, $3::bigint) ON CONFLICT (n) DO NOTHING RETURNING n", [gate.number, placeholder, gate.maxMicroUsd]);
  if (claimed.length === 0) throw new Error(`smoke test ${gate.number} has already been started`);

  let runId = placeholder;
  let state = "not_started";
  let reason = "";
  try {
    // exactly this run's amount on top of what is already committed; and never past the ceiling
    const before = await ledger.summary();
    const committed = before.reservedMicroUsd + before.settledMicroUsd + before.overageMicroUsd;
    const today = before.today.reservedMicroUsd + before.today.settledMicroUsd + before.today.overageMicroUsd;
    const authorized = await ledger.authorize(committed + gate.maxMicroUsd, today + gate.maxMicroUsd, actor);
    if (!authorized.ok) throw new Error(`the amount could not be authorized (${authorized.reason})`);
    // Twelve people, all of whom a model may decide for — and a plan that asks three of them,
    // once, in one epoch of six island hours. (Which people are driven from outside is drawn
    // per person: with a quarter of twelve it came to one, not three. So all are, and the
    // plan does the limiting.) The nine who are not asked act by reflex, labelled as such.
    const cfg = makeConfig("first_light", 1, { population: 12, externalShare: 1000, institutions: "open" });
    const spec: RunSpec = { ...DEFAULT_SPEC, provider: "anthropic", epochs: 1, epochTicks: 24, concurrency: 1, maxAttempts: 1, timeoutMs: 120_000, scheduler: { kind: "round_robin", callsPerEpoch: SMOKE_MINDS, maxPerAgentPerDay: 1, starveAfterEpochs: 0 } };
    const made = await createRun(db, ledger, { title: `live smoke ${gate.number}`, config: cfg, spec, capMicroUsd: gate.maxMicroUsd, allowEarlyStop: true }, live, actor);
    if (!made.ok) throw new Error(`the run could not be created (${made.error}: ${made.message})`);
    runId = made.run.id;
    await db.query("UPDATE smoke_runs SET run_id = $2 WHERE n = $1", [gate.number, runId]);
    await ledger.setKillSwitch(false, `live smoke test ${gate.number} authorized by the owner`, actor);
    // one epoch, advanced by repeatable steps exactly as the application does it
    for (let i = 0; i < 6; i++) {
      const out = await stepRun(db, ledger, runId, provider, { owner: actor, budgetMs: 200_000, leaseSeconds: 280 });
      state = out.state;
      reason = out.reason ?? "";
      if (state === "done" || state === "paused" || state === "failed" || state === "not_active" || state === "missing") break;
    }
  } finally {
    // whatever happened: nothing is left able to spend
    const budget = await ledger.summary().catch(() => null);
    if (!budget || !budget.killSwitch) await ledger.setKillSwitch(true, `live smoke test ${gate.number} finished`, actor).catch(() => undefined);
    await db.query("UPDATE smoke_runs SET outcome = $2 WHERE n = $1", [gate.number, state.slice(0, 40)]).catch(() => undefined);
  }

  const run = await getRun(db, runId);
  const calls = await callSummary(db, runId);
  const budget = await ledger.summary();
  const rows = await db.query("SELECT id, state, reserved_microusd, settled_microusd, overage_microusd, input_tokens, output_tokens FROM reservations WHERE run_id = $1 ORDER BY id", [runId]);
  const reservations = rows.map((r) => ({ id: String(r.id), state: String(r.state), reservedMicroUsd: num(r.reserved_microusd), settledMicroUsd: num(r.settled_microusd), overageMicroUsd: num(r.overage_microusd), inputTokens: r.input_tokens === null ? null : num(r.input_tokens), outputTokens: r.output_tokens === null ? null : num(r.output_tokens) }));
  const epochsCommitted = (await epochsOf(db, runId)).length;
  const lines = [
    `live smoke ${gate.number}: model ${run?.model ?? provider.model}, state ${state}${reason ? ` (${reason})` : ""}, calls ${JSON.stringify(calls.byStatus)}`,
    `  tokens: input ${calls.inputTokens}, cache write ${calls.cacheWriteTokens}, cache read ${calls.cacheReadTokens}, output ${calls.outputTokens} (of which thinking ${calls.thinkingTokens}); mean latency ${calls.meanLatencyMs} ms`,
    `  this ledger, over all smoke runs: settled ${formatUsd(budget.settledMicroUsd, 4)}, held ${formatUsd(budget.reservedMicroUsd, 4)} (unknown ${formatUsd(budget.unknownMicroUsd, 4)}), overage ${formatUsd(budget.overageMicroUsd, 4)}; ceiling ${formatUsd(budget.ceilingMicroUsd)}`,
    ...reservations.map((r) => `  ${r.id.split(":").slice(1).join(":")} ${r.state}: reserved ${formatUsd(r.reservedMicroUsd, 4)}, settled ${formatUsd(r.settledMicroUsd, 4)}${r.overageMicroUsd ? `, OVERAGE ${formatUsd(r.overageMicroUsd, 4)}` : ""}, tokens in ${String(r.inputTokens)} out ${String(r.outputTokens)}`),
    `  the kill switch is ${budget.killSwitch ? "on" : "OFF"}; the next smoke run is number ${gate.number + 1} and needs its own words`,
  ];
  return { number: gate.number, runId, model: run?.model ?? provider.model, state, reason, calls, reservations, authorizedMicroUsd: budget.authorizedMicroUsd, settledMicroUsd: budget.settledMicroUsd, heldMicroUsd: budget.reservedMicroUsd, overageMicroUsd: budget.overageMicroUsd, epochsCommitted, lines };
}
