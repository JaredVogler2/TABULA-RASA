import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeConfig } from "@/engine";
import { formatUsd, usdToMicro } from "@/providers/prices";
import { DEFAULT_SPEC, type RunSpec } from "@/providers/run";
import { TEST_DATABASE_URL, serverDb } from "../../tests/support/db";
import { liveProvider } from "./anthropic";
import { anthropicKey, liveStatus } from "./env";
import { Ledger } from "./ledger";
import { callSummary, createRun, epochsOf, getRun, stepRun } from "./runs";

/**
 * THE LIVE SMOKE TEST. It makes real, paid requests, and is skipped unless the owner has
 * authorized it in words, for an amount, with everything live mode needs:
 *
 *   LIVE_ENABLED=true
 *   ANTHROPIC_API_KEY=…            (the owner's key; never printed)
 *   ANTHROPIC_MODEL=…              (a model in the price table)
 *   TEST_DATABASE_URL=…            (the ledger for this test lives in a schema of its own)
 *   LIVE_SMOKE_MAX_USD=2           (at most 2: the smoke ceiling the prompt program suggests)
 *   LIVE_SMOKE_CONFIRM="I authorize a live smoke test of at most $2"
 *
 * Nothing else in the repository can make a paid call from a test run. It goes through the
 * same ledger, run store and provider as the application: the amount is authorized, the run
 * is capped at it, every request is reserved first, and the test ends by showing what was
 * reserved, what the provider reported, and that the books balance.
 *
 * Status in this repository: NEVER RUN. No key has been present and no authorization given.
 */
const maxUsd = Number(process.env.LIVE_SMOKE_MAX_USD ?? "0");
const confirmed = process.env.LIVE_SMOKE_CONFIRM === `I authorize a live smoke test of at most $${maxUsd}`;
// (owner sign-in is not part of this test; the two owner values are filled in so that only the live conditions decide)
const live = liveStatus({ ...process.env, OWNER_PASSWORD_HASH: process.env.OWNER_PASSWORD_HASH ?? "scrypt:smoke-test-has-no-owner-endpoint", AUTH_SECRET: process.env.AUTH_SECRET ?? "x".repeat(32), DATABASE_URL: TEST_DATABASE_URL || undefined });
const AUTHORIZED = confirmed && maxUsd > 0 && maxUsd <= 2 && live.available && Boolean(TEST_DATABASE_URL);

describe.skipIf(!AUTHORIZED)("LIVE smoke test — real, paid requests (skipped unless the owner has authorized an amount in words)", () => {
  let handle: Awaited<ReturnType<typeof serverDb>>;
  beforeAll(async () => {
    handle = await serverDb(4);
  });
  afterAll(async () => {
    await handle.drop();
  });

  it("asks three minds once each, inside the authorized amount, and the books balance", async () => {
    const db = handle.db;
    const ledger = new Ledger(db);
    const cap = usdToMicro(maxUsd);
    expect(await ledger.authorize(cap, cap, "live-smoke")).toEqual({ ok: true });
    await ledger.setKillSwitch(false, "live smoke test authorized by the owner", "live-smoke");
    const cfg = makeConfig("first_light", 1, { population: 12, externalShare: 250, institutions: "open" });
    const spec: RunSpec = { ...DEFAULT_SPEC, provider: "anthropic", epochs: 1, epochTicks: 24, concurrency: 1, maxAttempts: 1, scheduler: { kind: "round_robin", callsPerEpoch: 3, maxPerAgentPerDay: 1, starveAfterEpochs: 0 } };
    const made = await createRun(db, ledger, { title: "live smoke", config: cfg, spec, capMicroUsd: cap, allowEarlyStop: true }, live, "live-smoke");
    if (!made.ok) throw new Error(`${made.error}: ${made.message}`);
    const provider = liveProvider(live.model, anthropicKey());
    if (!provider.ok) throw new Error(provider.reason);

    // one epoch, advanced by repeatable steps exactly as the application does it
    let state = "";
    for (let i = 0; i < 6 && state !== "done" && state !== "paused" && state !== "failed"; i++) state = (await stepRun(db, ledger, made.run.id, provider.provider, { owner: "live-smoke", budgetMs: 200_000 })).state;

    const run = (await getRun(db, made.run.id))!;
    const calls = await callSummary(db, run.id);
    const budget = await ledger.summary();
    const reservations = await db.query("SELECT id, state, reserved_microusd, settled_microusd, input_tokens, output_tokens FROM reservations ORDER BY id");
    // the report: this is the first measurement of real cost this project will have
    console.log(`live smoke: model ${run.model}, state ${state}${run.statusReason ? ` (${run.statusReason})` : ""}, calls ${JSON.stringify(calls.byStatus)}`);
    console.log(`  tokens: input ${calls.inputTokens}, cache write ${calls.cacheWriteTokens}, cache read ${calls.cacheReadTokens}, output ${calls.outputTokens} (of which thinking ${calls.thinkingTokens}); mean latency ${calls.meanLatencyMs} ms`);
    console.log(`  money: settled ${formatUsd(budget.settledMicroUsd, 4)}, held ${formatUsd(budget.reservedMicroUsd, 4)} (unknown ${formatUsd(budget.unknownMicroUsd, 4)}), overage ${formatUsd(budget.overageMicroUsd, 4)}, authorized ${formatUsd(budget.authorizedMicroUsd)}`);
    for (const r of reservations) console.log(`  ${String(r.id).split(":").slice(1).join(":")} ${String(r.state)}: reserved ${formatUsd(Number(r.reserved_microusd), 4)}, settled ${formatUsd(Number(r.settled_microusd), 4)}, tokens in ${String(r.input_tokens)} out ${String(r.output_tokens)}`);

    // whatever the model did, the money is right
    expect(budget.settledMicroUsd + budget.reservedMicroUsd).toBeLessThanOrEqual(cap);
    expect(budget.overageMicroUsd).toBe(0);
    expect(reservations.length).toBeLessThanOrEqual(3);
    for (const r of reservations) expect(Number(r.settled_microusd)).toBeLessThanOrEqual(Number(r.reserved_microusd));
    // and if the epoch committed, its record replays
    if (state === "done") expect((await epochsOf(db, run.id)).length).toBe(1);
    // put the switch back on: the smoke test leaves nothing able to spend
    await ledger.setKillSwitch(true, "live smoke test finished", "live-smoke");
  }, 300_000);
});

describe("live smoke test — authorization state", () => {
  it(AUTHORIZED ? "is AUTHORIZED for this run" : "is NOT authorized: no paid request is made by this test run", () => {
    // This test exists so that the skip is visible in every test report, with its reason.
    if (AUTHORIZED) expect(maxUsd).toBeLessThanOrEqual(2);
    else expect(AUTHORIZED).toBe(false);
  });
});
