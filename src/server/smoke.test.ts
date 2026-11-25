import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { memoryDb } from "../../tests/support/db";
import { LiveAnthropicProvider, sdkClient } from "./anthropic";
import { num, type Db } from "./db";
import { Ledger } from "./ledger";
import { SMOKE_MAX_USD, runSmoke, smokeGate, smokePhrase } from "./smoke";

/**
 * The live smoke test, driven with the real adapter and the real SDK against canned HTTP
 * responses: no request leaves the machine and nothing is spent. What is tested is everything
 * around the request — when the script may run at all, that the same words never run it twice,
 * what it leaves in its ledger, and that nothing is left able to spend.
 */

const MODEL = "claude-fable-5-2";
const KEY = "sk-ant-api03-TEST-ONLY-not-a-real-key-0123456789";
const NOW = Date.parse("2026-12-01T10:00:00Z");
const ANSWER = JSON.stringify({ goal: "rest", why: "Nothing presses.", confidence: "low", note: "", cites: [], actions: [{ do: "wait", ticks: 4 }] });

const usage = { input_tokens: 5200, output_tokens: 640, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }, output_tokens_details: { thinking_tokens: 300 }, inference_geo: "global", service_tier: "standard", speed: "standard" };
const answered = (): Response =>
  new Response(JSON.stringify({ id: "msg_01", type: "message", role: "assistant", model: MODEL, content: [{ type: "text", text: ANSWER }], stop_reason: "end_turn", usage }), { status: 200, headers: { "content-type": "application/json", "request-id": "req_smoke" } });

function provider(respond: (n: number) => Response | Promise<Response> = answered): { provider: LiveAnthropicProvider; sent: () => number } {
  let sent = 0;
  const fakeFetch = (async () => respond(++sent)) as typeof fetch;
  return { provider: new LiveAnthropicProvider(sdkClient(KEY, fakeFetch), MODEL), sent: () => sent };
}

describe("the live smoke test (canned responses: nothing is sent, nothing is spent)", () => {
  let db: Db;
  const ready = (over: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
    LIVE_ENABLED: "true",
    ANTHROPIC_API_KEY: KEY,
    ANTHROPIC_MODEL: MODEL,
    DATABASE_URL: "postgres://configured",
    BUDGET_CEILING_USD: "5",
    NODE_ENV: "production",
    LIVE_SMOKE_MAX_USD: "2",
    LIVE_SMOKE_CONFIRM: smokePhrase(1, 2),
    ...over,
  });

  beforeAll(async () => {
    db = await memoryDb();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    for (const t of ["calls", "epochs", "reservations", "daily_spend", "runs", "audit_log", "smoke_runs"]) await db.query(`DELETE FROM ${t}`);
    await db.query("UPDATE budget SET authorized_microusd = 0, daily_cap_microusd = 0, reserved_microusd = 0, settled_microusd = 0, overage_microusd = 0, kill_switch = true, kill_reason = 'never enabled', kill_code = '' WHERE id = 1");
  });

  it("says exactly what is missing, and the words that would authorize the next run, without a request and without a secret", async () => {
    const bare = await smokeGate(db, {}, NOW);
    expect(bare.ok).toBe(false);
    expect(bare.number).toBe(1);
    expect(bare.phrase).toBe("I authorize live smoke test 1 for at most $2");
    expect(bare.reasons.join(" | ")).toMatch(/LIVE_ENABLED.*ANTHROPIC_API_KEY.*ANTHROPIC_MODEL.*DATABASE_URL.*BUDGET_CEILING_USD.*LIVE_SMOKE_MAX_USD/);
    expect((await smokeGate(db, ready(), NOW)).ok).toBe(true);
    const not = async (over: Record<string, string | undefined>, why: RegExp): Promise<void> => {
      const g = await smokeGate(db, ready(over), NOW);
      expect(g.ok, JSON.stringify(over)).toBe(false);
      expect(g.reasons.join(" | "), JSON.stringify(over)).toMatch(why);
      // a reason names a setting, never its value
      expect(JSON.stringify(g)).not.toContain(KEY);
    };
    await not({ LIVE_ENABLED: undefined }, /LIVE_ENABLED/);
    await not({ ANTHROPIC_API_KEY: undefined }, /ANTHROPIC_API_KEY/);
    await not({ ANTHROPIC_MODEL: "claude-made-up-9" }, /price table/);
    await not({ DATABASE_URL: undefined }, /PostgreSQL/);
    await not({ BUDGET_CEILING_USD: undefined }, /BUDGET_CEILING_USD/);
    await not({ ANTHROPIC_BASE_URL: "https://elsewhere.example" }, /ANTHROPIC_BASE_URL is set/);
    // the amount: above zero, at most two dollars, and a plain number
    for (const amount of [undefined, "", "0", "2.01", "3", "200", "-1", "2e0", "$2", "1.999"]) await not({ LIVE_SMOKE_MAX_USD: amount, LIVE_SMOKE_CONFIRM: smokePhrase(1, Number(amount)) }, /LIVE_SMOKE_MAX_USD/);
    expect(SMOKE_MAX_USD).toBe(2);
    // the words: these, word for word, for this number and this amount
    await not({ LIVE_SMOKE_CONFIRM: undefined }, /word for word/);
    await not({ LIVE_SMOKE_CONFIRM: "yes" }, /word for word/);
    await not({ LIVE_SMOKE_CONFIRM: smokePhrase(1, 1) }, /word for word/);
    await not({ LIVE_SMOKE_CONFIRM: smokePhrase(2, 2) }, /word for word/);
    await not({ LIVE_SMOKE_CONFIRM: "I authorize a live smoke test of at most $2" }, /word for word/); // the words an earlier version took
    expect((await smokeGate(db, ready({ LIVE_SMOKE_MAX_USD: "0.5", LIVE_SMOKE_CONFIRM: smokePhrase(1, 0.5) }), NOW)).ok).toBe(true);
    // a look changes nothing
    expect(await db.query("SELECT 1 FROM smoke_runs")).toEqual([]);
    expect((await db.query("SELECT kill_switch, authorized_microusd FROM budget WHERE id = 1"))[0]).toMatchObject({ kill_switch: true });
  });

  it("an authorized run asks three minds once each inside its amount, the books balance, and the switch is on again afterwards", async () => {
    const p = provider();
    const report = await runSmoke(db, ready(), p.provider, NOW);
    expect(p.sent()).toBe(3);
    expect(report).toMatchObject({ number: 1, state: "done", model: MODEL, heldMicroUsd: 0, overageMicroUsd: 0, epochsCommitted: 1 });
    expect(report.calls.byStatus).toEqual({ ok: 3 });
    expect(report.reservations).toHaveLength(3);
    for (const r of report.reservations) {
      expect(r.state).toBe("settled");
      expect(r.settledMicroUsd).toBeGreaterThan(0);
      expect(r.settledMicroUsd).toBeLessThanOrEqual(r.reservedMicroUsd);
    }
    expect(report.settledMicroUsd).toBe(report.reservations.reduce((sum, r) => sum + r.settledMicroUsd, 0));
    expect(report.settledMicroUsd).toBeLessThanOrEqual(2_000_000);
    // exactly this run's amount was authorized, and nothing is left able to spend
    const [b] = await db.query("SELECT authorized_microusd, kill_switch, kill_reason FROM budget WHERE id = 1");
    expect(num(b!.authorized_microusd)).toBe(2_000_000);
    expect(b).toMatchObject({ kill_switch: true, kill_reason: "live smoke test 1 finished" });
    expect((await db.query("SELECT n, outcome, max_microusd FROM smoke_runs"))[0]).toMatchObject({ n: 1, outcome: "done" });
    // the report is what a person reads, and it holds no secret and no model reasoning
    const text = report.lines.join("\n");
    expect(text).toContain("live smoke 1: model claude-fable-5-2, state done");
    expect(text).toContain("the kill switch is on; the next smoke run is number 2 and needs its own words");
    expect(text).not.toContain(KEY);
  });

  it("the same words do nothing a second time: every run has its own number, and its own words", async () => {
    const first = provider();
    await runSmoke(db, ready(), first.provider, NOW);
    // the variables are still set, as they would be in a shell profile or a CI setting
    const again = provider();
    const gate = await smokeGate(db, ready(), NOW);
    expect(gate).toMatchObject({ ok: false, number: 2, runsSoFar: 1, phrase: "I authorize live smoke test 2 for at most $2" });
    expect(gate.reasons.join(" ")).toContain("authorizes smoke test 1, which has already been run: the next is number 2");
    await expect(runSmoke(db, ready(), again.provider, NOW)).rejects.toThrow(/not authorized/);
    expect(again.sent()).toBe(0);
    // with the words for run 2 it runs — and what run 1 spent still counts
    const second = provider();
    const report = await runSmoke(db, ready({ LIVE_SMOKE_CONFIRM: smokePhrase(2, 2) }), second.provider, NOW);
    expect(report).toMatchObject({ number: 2, state: "done" });
    expect((await db.query("SELECT COUNT(*) AS n FROM reservations"))[0]!.n).toBe(6);
    expect(report.settledMicroUsd).toBeGreaterThan(report.reservations.reduce((sum, r) => sum + r.settledMicroUsd, 0));
    // two processes with the same words: the number is taken by whichever is first, and the other makes no request
    const [x, y] = [provider(), provider()];
    const both = await Promise.allSettled([runSmoke(db, ready({ LIVE_SMOKE_CONFIRM: smokePhrase(3, 2) }), x.provider, NOW), runSmoke(db, ready({ LIVE_SMOKE_CONFIRM: smokePhrase(3, 2) }), y.provider, NOW)]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(x.sent() + y.sent()).toBe(3);
  });

  it("all the smoke runs together stay under the deployment's ceiling", async () => {
    // a ceiling of three dollars: one run of two fits, and a second would not if the first had spent more than one
    const env = (n: number) => ready({ BUDGET_CEILING_USD: "3", LIVE_SMOKE_CONFIRM: smokePhrase(n, 2) });
    await runSmoke(db, env(1), provider().provider, NOW);
    const [b] = await db.query("SELECT settled_microusd FROM budget WHERE id = 1");
    const spent = num(b!.settled_microusd);
    expect((await smokeGate(db, env(2), NOW)).ok).toBe(spent + 2_000_000 <= 3_000_000);
    // as if earlier runs had cost $1.20 in all: the next two-dollar run would pass the ceiling, and is refused
    await db.query("UPDATE budget SET settled_microusd = 1200000, authorized_microusd = GREATEST(authorized_microusd, 1200000) WHERE id = 1");
    const gate = await smokeGate(db, env(2), NOW);
    expect(gate.ok).toBe(false);
    expect(gate.reasons.join(" ")).toContain("would pass the deployment's ceiling");
    const p = provider();
    await expect(runSmoke(db, env(2), p.provider, NOW)).rejects.toThrow(/not authorized/);
    expect(p.sent()).toBe(0);
    // a smaller run still fits
    expect((await smokeGate(db, ready({ BUDGET_CEILING_USD: "3", LIVE_SMOKE_MAX_USD: "1.5", LIVE_SMOKE_CONFIRM: smokePhrase(2, 1.5) }), NOW)).ok).toBe(true);
  });

  it("a request whose outcome is unknown stays held in the ledger, blocks the next run until it is decided, and is never thrown away", async () => {
    // the second request gets an error page from something in between: nothing shows whether it was charged
    const p = provider((n) => (n === 2 ? new Response("<html>502 Bad Gateway</html>", { status: 502, headers: { "content-type": "text/html" } }) : answered()));
    const report = await runSmoke(db, ready(), p.provider, NOW);
    expect(p.sent()).toBe(3);
    expect(report.state).toBe("done");
    expect(report.calls.byStatus).toEqual({ ok: 2, unknown: 1 });
    expect(report.heldMicroUsd).toBeGreaterThan(0);
    const unknown = report.reservations.filter((r) => r.state === "unknown");
    expect(unknown).toHaveLength(1);
    expect(report.lines.join("\n")).toMatch(/unknown: reserved \$/);
    // it is still there afterwards — this ledger is never dropped — and the next run waits for the owner's decision
    expect((await db.query("SELECT state FROM reservations WHERE id = $1", [unknown[0]!.id]))[0]!.state).toBe("unknown");
    const gate = await smokeGate(db, ready({ LIVE_SMOKE_CONFIRM: smokePhrase(2, 2) }), NOW);
    expect(gate.ok).toBe(false);
    expect(gate.reasons.join(" ")).toContain("still held with its outcome unknown");
    expect(gate.heldMicroUsd).toBe(unknown[0]!.reservedMicroUsd);
    // decided (here: counted as spent in full), the next run may be made
    expect(await new Ledger(db, { ceilingMicroUsd: 5_000_000 }).reconcile(unknown[0]!.id, { settleMicroUsd: unknown[0]!.reservedMicroUsd }, "owner")).toBe("done");
    expect((await smokeGate(db, ready({ LIVE_SMOKE_CONFIRM: smokePhrase(2, 2) }), NOW)).ok).toBe(true);
  });

  it("however a run ends, nothing is left able to spend", async () => {
    // the provider refuses the key: the run fails at its first request
    const refused = provider(() => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), { status: 401, headers: { "content-type": "application/json", "request-id": "req_401" } }));
    const report = await runSmoke(db, ready(), refused.provider, NOW);
    expect(refused.sent()).toBe(1);
    expect(report).toMatchObject({ state: "failed", reason: "auth", settledMicroUsd: 0, heldMicroUsd: 0 });
    expect((await db.query("SELECT kill_switch FROM budget WHERE id = 1"))[0]!.kill_switch).toBe(true);
    // the network itself throws in the middle of a later run: its request is held as unknown, and the switch is on
    const broken = provider((n) => {
      if (n === 2) throw new TypeError("fetch failed");
      return answered();
    });
    const second = await runSmoke(db, ready({ LIVE_SMOKE_CONFIRM: smokePhrase(2, 2) }), broken.provider, NOW);
    expect(second.calls.byStatus).toEqual({ ok: 2, unknown: 1 });
    expect((await db.query("SELECT kill_switch FROM budget WHERE id = 1"))[0]!.kill_switch).toBe(true);
    expect((await db.query("SELECT n, outcome FROM smoke_runs ORDER BY n")).map((r) => [num(r.n), r.outcome])).toEqual([
      [1, "failed"],
      [2, "done"],
    ]);
  });
});
