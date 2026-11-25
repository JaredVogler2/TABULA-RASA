import fc from "fast-check";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL, insertRun, memoryDb, serverDb } from "../../tests/support/db";
import { num, type Db } from "./db";
import { Ledger } from "./ledger";

const USD = 1_000_000;

/** The ledger's books must agree with themselves, whatever has happened. */
async function audit(db: Db): Promise<void> {
  const [b] = await db.query("SELECT * FROM budget WHERE id = 1");
  const [held] = await db.query("SELECT COALESCE(SUM(reserved_microusd),0) AS s FROM reservations WHERE state IN ('reserved','unknown')");
  const [spent] = await db.query("SELECT COALESCE(SUM(settled_microusd),0) AS s, COALESCE(SUM(overage_microusd),0) AS o FROM reservations WHERE state = 'settled'");
  expect(num(b!.reserved_microusd)).toBe(num(held!.s));
  expect(num(b!.settled_microusd)).toBe(num(spent!.s));
  expect(num(b!.overage_microusd)).toBe(num(spent!.o));
  expect(num(b!.reserved_microusd) + num(b!.settled_microusd)).toBeLessThanOrEqual(num(b!.authorized_microusd));
  for (const r of await db.query("SELECT id, cap_microusd, reserved_microusd, settled_microusd FROM runs")) {
    const [h] = await db.query("SELECT COALESCE(SUM(reserved_microusd),0) AS s FROM reservations WHERE run_id = $1 AND state IN ('reserved','unknown')", [r.id]);
    const [s] = await db.query("SELECT COALESCE(SUM(settled_microusd),0) AS s FROM reservations WHERE run_id = $1 AND state = 'settled'", [r.id]);
    expect(num(r.reserved_microusd)).toBe(num(h!.s));
    expect(num(r.settled_microusd)).toBe(num(s!.s));
    expect(num(r.reserved_microusd) + num(r.settled_microusd)).toBeLessThanOrEqual(num(r.cap_microusd));
  }
  for (const d of await db.query("SELECT day::text AS day, reserved_microusd, settled_microusd FROM daily_spend")) {
    const [h] = await db.query("SELECT COALESCE(SUM(reserved_microusd),0) AS s FROM reservations WHERE day = $1::date AND state IN ('reserved','unknown')", [d.day]);
    const [s] = await db.query("SELECT COALESCE(SUM(settled_microusd),0) AS s FROM reservations WHERE day = $1::date AND state = 'settled'", [d.day]);
    expect(num(d.reserved_microusd)).toBe(num(h!.s));
    expect(num(d.settled_microusd)).toBe(num(s!.s));
  }
}

describe("the budget ledger (PostgreSQL semantics, in memory)", () => {
  let db: Db;
  let now = new Date("2026-12-01T10:00:00Z");
  let ledger: Ledger;
  const open = async (authorized = 2 * USD, daily = 2 * USD) => {
    expect(await ledger.authorize(authorized, daily, "test")).toEqual({ ok: true });
    await ledger.setKillSwitch(false, "test", "test");
  };
  const reserve = (id: string, amount: number, runId = "run") => ledger.reserve({ id, runId, amount, model: "claude-fable-5-2", requestHash: "h" });

  const reset = async () => {
    for (const t of ["reservations", "daily_spend", "runs", "audit_log"]) await db.query(`DELETE FROM ${t}`);
    await db.query("UPDATE budget SET authorized_microusd = 0, daily_cap_microusd = 0, reserved_microusd = 0, settled_microusd = 0, overage_microusd = 0, kill_switch = true, kill_reason = 'never enabled' WHERE id = 1");
  };
  beforeAll(async () => {
    db = await memoryDb();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await reset();
    now = new Date("2026-12-01T10:00:00Z");
    ledger = new Ledger(db, () => now);
    await insertRun(db, "run", 1 * USD);
  });

  it("starts closed: nothing is authorized and the kill switch is on", async () => {
    const s = await ledger.summary();
    expect(s).toMatchObject({ authorizedMicroUsd: 0, dailyCapMicroUsd: 0, reservedMicroUsd: 0, settledMicroUsd: 0, remainingMicroUsd: 0, killSwitch: true, killReason: "never enabled" });
    expect(await reserve("a", 1000)).toEqual({ ok: false, reason: "kill_switch" });
    // turning the switch off authorizes nothing by itself
    await ledger.setKillSwitch(false, "test", "test");
    expect(await reserve("a", 1000)).toEqual({ ok: false, reason: "global_cap" });
    // and a budget without a daily allowance is still closed
    expect(await ledger.authorize(2 * USD, 0, "test")).toEqual({ ok: true });
    expect(await reserve("a", 1000)).toEqual({ ok: false, reason: "daily_cap" });
    expect(await db.query("SELECT id FROM reservations")).toEqual([]);
    await audit(db);
  });

  it("holds money before a request and replaces the hold by what the provider reports", async () => {
    await open();
    expect(await reserve("run:0:1:1", 300_000)).toEqual({ ok: true });
    expect(await ledger.summary()).toMatchObject({ reservedMicroUsd: 300_000, settledMicroUsd: 0, remainingMicroUsd: 1_700_000, today: { day: "2026-12-01", reservedMicroUsd: 300_000 } });
    expect(await ledger.settle("run:0:1:1", { costMicroUsd: 41_250, requestId: "req_1", usage: { input_tokens: 1000, output_tokens: 800, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation_5m: 0, cache_creation_1h: 0, inference_geo: "global", speed: "standard", service_tier: "standard", thinking_tokens: 200 } })).toBe("settled");
    expect(await ledger.summary()).toMatchObject({ reservedMicroUsd: 0, settledMicroUsd: 41_250, remainingMicroUsd: 2 * USD - 41_250, overageMicroUsd: 0, killSwitch: false });
    const [row] = await db.query("SELECT state, input_tokens, output_tokens, provider_request_id FROM reservations WHERE id = 'run:0:1:1'");
    expect(row).toMatchObject({ state: "settled", input_tokens: 1000, output_tokens: 800, provider_request_id: "req_1" });
    await audit(db);
  });

  it("a repeated or re-ordered request cannot hold or charge twice", async () => {
    await open();
    expect(await reserve("k", 200_000)).toEqual({ ok: true });
    // the same request again (a retry, a second instance, a replayed HTTP call): nothing happens, and the caller is told not to dispatch
    expect(await reserve("k", 200_000)).toEqual({ ok: false, reason: "duplicate", state: "reserved" });
    expect((await ledger.summary()).reservedMicroUsd).toBe(200_000);
    expect(await ledger.settle("k", { costMicroUsd: 50_000 })).toBe("settled");
    expect(await ledger.settle("k", { costMicroUsd: 50_000 })).toBe("already");
    expect(await ledger.settle("k", { costMicroUsd: 190_000 })).toBe("already");
    expect(await ledger.release("k", "late release")).toBe("already");
    expect(await reserve("k", 200_000)).toEqual({ ok: false, reason: "duplicate", state: "settled" });
    expect(await ledger.summary()).toMatchObject({ reservedMicroUsd: 0, settledMicroUsd: 50_000 });
    // settle for something never reserved, and settle arriving after a release
    expect(await ledger.settle("never", { costMicroUsd: 1 })).toBe("missing");
    expect(await reserve("r", 100_000)).toEqual({ ok: true });
    expect(await ledger.release("r", "definite error")).toBe("released");
    expect(await ledger.settle("r", { costMicroUsd: 99_000 })).toBe("already");
    expect(await ledger.release("r", "again")).toBe("already");
    expect(await ledger.summary()).toMatchObject({ reservedMicroUsd: 0, settledMicroUsd: 50_000 });
    await audit(db);
  });

  it("an unknown outcome keeps its money held until the owner decides", async () => {
    await open(1 * USD, 1 * USD);
    expect(await reserve("lost", 600_000)).toEqual({ ok: true });
    await ledger.markUnknown("lost", "timeout");
    expect(await ledger.summary()).toMatchObject({ reservedMicroUsd: 600_000, unknownMicroUsd: 600_000, unknownCount: 1, remainingMicroUsd: 400_000 });
    // the held money cannot be spent by anything else
    expect(await reserve("next", 500_000)).toEqual({ ok: false, reason: "global_cap" });
    expect(await reserve("fits", 400_000)).toEqual({ ok: true });
    // only an unknown reservation can be reconciled, and never for more than was held
    expect(await ledger.reconcile("fits", { release: true }, "owner")).toBe("not_unknown");
    expect(await ledger.reconcile("lost", { settleMicroUsd: 600_001 }, "owner")).toBe("invalid");
    expect(await ledger.reconcile("lost", { settleMicroUsd: 120_000 }, "owner")).toBe("done");
    expect(await ledger.summary()).toMatchObject({ reservedMicroUsd: 400_000, unknownMicroUsd: 0, settledMicroUsd: 120_000 });
    expect(await ledger.reconcile("lost", { release: true }, "owner")).toBe("not_unknown");
    await ledger.markUnknown("fits", "lost connection");
    expect(await ledger.reconcile("fits", { release: true }, "owner")).toBe("done");
    expect(await ledger.summary()).toMatchObject({ reservedMicroUsd: 0, settledMicroUsd: 120_000, remainingMicroUsd: 880_000 });
    const log = await db.query("SELECT action FROM audit_log ORDER BY id");
    expect(log.map((l) => l.action)).toEqual(["budget.authorize", "kill_switch.off", "reservation.reconcile", "reservation.reconcile"]);
    await audit(db);
  });

  it("a reservation whose process died is shown as unknown, never given back by itself", async () => {
    await open();
    expect(await reserve("orphan", 100_000)).toEqual({ ok: true });
    expect(await ledger.sweep(10 * 60_000)).toBe(0); // too recent to judge
    // created_at is the database's clock; move it back instead of waiting
    await db.query("UPDATE reservations SET created_at = created_at - interval '1 hour' WHERE id = 'orphan'");
    expect(await ledger.sweep(10 * 60_000)).toBe(1);
    expect(await ledger.summary()).toMatchObject({ reservedMicroUsd: 100_000, unknownMicroUsd: 100_000, unknownCount: 1 });
    expect((await ledger.list("unknown"))[0]).toMatchObject({ id: "orphan", state: "unknown", note: "no outcome was recorded" });
    await audit(db);
  });

  it("enforces the run's cap, the day's cap and the total, and a refusal leaves nothing behind", async () => {
    await open(4 * USD, 1_500_000);
    await insertRun(db, "small", 250_000);
    expect(await reserve("s1", 200_000, "small")).toEqual({ ok: true });
    expect(await reserve("s2", 60_000, "small")).toEqual({ ok: false, reason: "run_cap" });
    expect(await reserve("s3", 50_000, "small")).toEqual({ ok: true });
    await insertRun(db, "big", 3 * USD);
    expect(await reserve("b1", 1_200_000, "big")).toEqual({ ok: true });
    // 1.45 of today's 1.50 is held
    expect(await reserve("b2", 60_000, "big")).toEqual({ ok: false, reason: "daily_cap" });
    expect(await reserve("b3", 50_000, "big")).toEqual({ ok: true });
    // a new day has its own allowance; the total does not reset
    now = new Date("2026-12-02T00:00:01Z");
    expect(await reserve("b4", 1_400_000, "big")).toEqual({ ok: true });
    expect(await reserve("b5", 200_000, "big")).toEqual({ ok: false, reason: "daily_cap" });
    expect(await reserve("b6", 100_000, "big")).toEqual({ ok: true });
    now = new Date("2026-12-03T00:00:01Z");
    expect(await reserve("b7", 1_000_001, "big")).toEqual({ ok: false, reason: "global_cap" }); // 3.0 held of 4.0 authorized
    // refused requests left no row and moved no total
    const ids = (await db.query("SELECT id FROM reservations ORDER BY id")).map((r) => r.id);
    expect(ids).toEqual(["b1", "b3", "b4", "b6", "s1", "s3"]);
    expect((await ledger.summary()).reservedMicroUsd).toBe(3 * USD);
    await audit(db);
  });

  it("refuses a run that is not active, an unknown run, and malformed amounts", async () => {
    await open();
    await insertRun(db, "paused", USD, "paused");
    await insertRun(db, "cancelled", USD, "cancelled");
    expect(await reserve("p", 1000, "paused")).toEqual({ ok: false, reason: "run_not_active" });
    expect(await reserve("c", 1000, "cancelled")).toEqual({ ok: false, reason: "run_not_active" });
    expect(await reserve("x", 1000, "no-such-run")).toEqual({ ok: false, reason: "run_not_active" });
    for (const bad of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60]) expect(await reserve(`bad${bad}`, bad)).toEqual({ ok: false, reason: "invalid" });
    expect(await ledger.settle("x", { costMicroUsd: -1 })).toBe("invalid");
    expect(await ledger.authorize(-1, 0, "test")).toEqual({ ok: false, reason: "invalid" });
    expect(await ledger.authorize(1.5, 0, "test")).toEqual({ ok: false, reason: "invalid" });
    expect(await db.query("SELECT id FROM reservations")).toEqual([]);
  });

  it("a request that costs more than was held is recorded as overage and stops everything", async () => {
    await open();
    expect(await reserve("o", 100_000)).toEqual({ ok: true });
    expect(await ledger.settle("o", { costMicroUsd: 130_000 })).toBe("settled");
    const s = await ledger.summary();
    // the ledger's own invariant holds (never more settled than held); the excess is kept apart, in plain sight
    expect(s).toMatchObject({ settledMicroUsd: 100_000, overageMicroUsd: 30_000, reservedMicroUsd: 0, killSwitch: true });
    expect(s.killReason).toContain("cost more than was reserved");
    expect(await reserve("after", 1000)).toEqual({ ok: false, reason: "kill_switch" });
    await audit(db);
  });

  it("the kill switch stops new holds at once and does not disturb settlement", async () => {
    await open();
    expect(await reserve("inflight", 100_000)).toEqual({ ok: true });
    await ledger.setKillSwitch(true, "owner pressed stop", "owner");
    expect(await reserve("blocked", 1000)).toEqual({ ok: false, reason: "kill_switch" });
    expect(await ledger.settle("inflight", { costMicroUsd: 20_000 })).toBe("settled");
    expect(await ledger.summary()).toMatchObject({ killSwitch: true, killReason: "owner pressed stop", settledMicroUsd: 20_000, reservedMicroUsd: 0 });
  });

  it("the authorization cannot be lowered below what is already committed", async () => {
    await open(2 * USD, 2 * USD);
    expect(await reserve("a", 500_000)).toEqual({ ok: true });
    expect(await ledger.settle("a", { costMicroUsd: 300_000 })).toBe("settled");
    expect(await reserve("b", 400_000)).toEqual({ ok: true });
    expect(await ledger.authorize(699_999, 2 * USD, "owner")).toEqual({ ok: false, reason: "below_committed" });
    expect(await ledger.authorize(700_000, 2 * USD, "owner")).toEqual({ ok: true });
    expect(await reserve("c", 1)).toEqual({ ok: false, reason: "global_cap" });
    await audit(db);
  });

  it("the database itself refuses an overspend that application code tries to write", async () => {
    await open(1 * USD, 1 * USD);
    await expect(db.query("UPDATE budget SET reserved_microusd = 2000000 WHERE id = 1")).rejects.toThrow(/budget_never_exceeded/);
    await expect(db.query("UPDATE budget SET settled_microusd = -1 WHERE id = 1")).rejects.toThrow();
    await expect(db.query("UPDATE runs SET reserved_microusd = cap_microusd + 1 WHERE id = 'run'")).rejects.toThrow(/run_never_exceeded/);
    await expect(db.query("INSERT INTO budget (id) VALUES (2)")).rejects.toThrow();
    await expect(db.query("INSERT INTO reservations (id, run_id, day, state, reserved_microusd, model, request_hash) VALUES ('z', 'run', '2026-12-01', 'refunded', 1, 'm', 'h')")).rejects.toThrow();
  });

  it("property: after any sequence of operations the books balance and no ceiling is exceeded", async () => {
    const op = fc.oneof(
      fc.record({ t: fc.constant("reserve" as const), id: fc.integer({ min: 0, max: 14 }), run: fc.constantFrom("run", "r2"), amount: fc.integer({ min: 1, max: 400_000 }) }),
      fc.record({ t: fc.constant("settle" as const), id: fc.integer({ min: 0, max: 14 }), cost: fc.integer({ min: 0, max: 500_000 }) }),
      fc.record({ t: fc.constant("release" as const), id: fc.integer({ min: 0, max: 14 }) }),
      fc.record({ t: fc.constant("unknown" as const), id: fc.integer({ min: 0, max: 14 }) }),
      fc.record({ t: fc.constant("reconcile" as const), id: fc.integer({ min: 0, max: 14 }), amount: fc.option(fc.integer({ min: 0, max: 400_000 }), { nil: undefined }) }),
      fc.record({ t: fc.constant("kill" as const), on: fc.boolean() }),
      fc.record({ t: fc.constant("day" as const) }),
      fc.record({ t: fc.constant("authorize" as const), total: fc.integer({ min: 0, max: 3 * USD }), daily: fc.integer({ min: 0, max: 2 * USD }) }),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 5, maxLength: 40 }), async (ops) => {
        await reset();
        now = new Date("2026-12-01T10:00:00Z");
        ledger = new Ledger(db, () => now);
        await insertRun(db, "run", 900_000);
        await insertRun(db, "r2", 600_000);
        await ledger.authorize(1_500_000, 1_000_000, "t");
        await ledger.setKillSwitch(false, "t", "t");
        for (const o of ops) {
          if (o.t === "reserve") {
            const granted = await ledger.reserve({ id: `k${o.id}`, runId: o.run, amount: o.amount, model: "m", requestHash: "h" });
            if (granted.ok) {
              // a hold is only ever granted inside every ceiling in force at that moment
              // (the owner may lower the day's allowance afterwards; that stops new holds, it does not undo old ones)
              const s = await ledger.summary();
              expect(s.killSwitch).toBe(false);
              expect(s.today.reservedMicroUsd + s.today.settledMicroUsd).toBeLessThanOrEqual(s.dailyCapMicroUsd);
              expect(s.reservedMicroUsd + s.settledMicroUsd).toBeLessThanOrEqual(s.authorizedMicroUsd);
            }
          }
          else if (o.t === "settle") await ledger.settle(`k${o.id}`, { costMicroUsd: o.cost });
          else if (o.t === "release") await ledger.release(`k${o.id}`, "x");
          else if (o.t === "unknown") await ledger.markUnknown(`k${o.id}`, "x");
          else if (o.t === "reconcile") await ledger.reconcile(`k${o.id}`, o.amount === undefined ? { release: true } : { settleMicroUsd: o.amount }, "t");
          else if (o.t === "kill") await ledger.setKillSwitch(o.on, "t", "t");
          else if (o.t === "day") now = new Date(now.getTime() + 86_400_000);
          else await ledger.authorize(o.total, o.daily, "t");
        }
        await audit(db);
      }),
      { numRuns: 60 },
    );
  }, 120_000);
});

/**
 * Concurrency cannot be shown on a single connection. These run on a real PostgreSQL server,
 * through real pools, as two "instances" at once.
 */
describe.skipIf(!TEST_DATABASE_URL)("the budget ledger under real concurrency (PostgreSQL server)", () => {
  let handle: Awaited<ReturnType<typeof serverDb>>;
  let a: Ledger;
  let b: Ledger;
  let db: Db;

  beforeAll(async () => {
    handle = await serverDb(24);
    db = handle.db;
    a = new Ledger(db);
    b = new Ledger(await handle.second());
  });
  afterAll(async () => {
    await handle.drop();
  });
  beforeEach(async () => {
    await db.query("DELETE FROM reservations");
    await db.query("DELETE FROM daily_spend");
    await db.query("DELETE FROM runs");
    await db.query("UPDATE budget SET authorized_microusd = 0, daily_cap_microusd = 0, reserved_microusd = 0, settled_microusd = 0, overage_microusd = 0, kill_switch = true, kill_reason = 'never enabled' WHERE id = 1");
  });

  it("100 concurrent requests from two instances cannot hold more than was authorized", async () => {
    await insertRun(db, "run", 100 * USD);
    await a.authorize(1 * USD, 100 * USD, "t");
    await a.setKillSwitch(false, "t", "t");
    // each asks for 5 cents; one dollar is authorized; exactly twenty can be granted
    const results = await Promise.all(Array.from({ length: 100 }, (_, i) => (i % 2 ? a : b).reserve({ id: `c${i}`, runId: "run", amount: 50_000, model: "m", requestHash: "h" })));
    const granted = results.filter((r) => r.ok).length;
    expect(granted).toBe(20);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === "global_cap")).toBe(true);
    const s = await a.summary();
    expect(s.reservedMicroUsd).toBe(1 * USD);
    expect(s.remainingMicroUsd).toBe(0);
    expect((await db.query("SELECT id FROM reservations")).length).toBe(20);
    await audit(db);
  });

  it("the same holds for a run's cap and for the day's cap", async () => {
    await insertRun(db, "tight", 330_000);
    await insertRun(db, "wide", 100 * USD);
    await a.authorize(100 * USD, 700_000, "t");
    await a.setKillSwitch(false, "t", "t");
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) => {
        const run = i % 2 ? "tight" : "wide";
        return (i % 3 ? a : b).reserve({ id: `c${i}`, runId: run, amount: 30_000, model: "m", requestHash: "h" }).then((r) => ({ run, r }));
      }),
    );
    const tight = results.filter((x) => x.run === "tight" && x.r.ok).length;
    const wide = results.filter((x) => x.run === "wide" && x.r.ok).length;
    expect(tight).toBeLessThanOrEqual(11); // 330,000 / 30,000
    expect(tight + wide).toBe(23); // floor(700,000 / 30,000): the day's cap binds overall
    const [run] = await db.query("SELECT reserved_microusd FROM runs WHERE id = 'tight'");
    expect(num(run!.reserved_microusd)).toBe(tight * 30_000);
    expect((await a.summary()).today.reservedMicroUsd).toBe(23 * 30_000);
    await audit(db);
  });

  it("100 concurrent copies of one request are granted exactly once", async () => {
    await insertRun(db, "run", 100 * USD);
    await a.authorize(100 * USD, 100 * USD, "t");
    await a.setKillSwitch(false, "t", "t");
    const results = await Promise.all(Array.from({ length: 100 }, (_, i) => (i % 2 ? a : b).reserve({ id: "run:3:7:1", runId: "run", amount: 250_000, model: "m", requestHash: "h" })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "duplicate")).toHaveLength(99);
    expect((await a.summary()).reservedMicroUsd).toBe(250_000);
    // and 50 concurrent settlements of it charge once
    const settled = await Promise.all(Array.from({ length: 50 }, (_, i) => (i % 2 ? a : b).settle("run:3:7:1", { costMicroUsd: 40_000 + i })));
    expect(settled.filter((x) => x === "settled")).toHaveLength(1);
    expect(settled.filter((x) => x === "already")).toHaveLength(49);
    const s = await a.summary();
    expect(s.reservedMicroUsd).toBe(0);
    expect(s.settledMicroUsd).toBeGreaterThanOrEqual(40_000);
    expect(s.settledMicroUsd).toBeLessThan(40_050);
    await audit(db);
  });

  it("holds, settlements, releases and refusals interleaved from two instances leave the books exact", async () => {
    await insertRun(db, "r1", 2 * USD);
    await insertRun(db, "r2", 2 * USD);
    await a.authorize(3 * USD, 3 * USD, "t");
    await a.setKillSwitch(false, "t", "t");
    const work = Array.from({ length: 120 }, async (_, i) => {
      const ledger = i % 2 ? a : b;
      const id = `w${i}`;
      const r = await ledger.reserve({ id, runId: i % 3 ? "r1" : "r2", amount: 20_000 + (i % 7) * 5_000, model: "m", requestHash: "h" });
      if (!r.ok) return "refused";
      if (i % 5 === 0) {
        await ledger.release(id, "definite error");
        return "released";
      }
      if (i % 11 === 0) {
        await ledger.markUnknown(id, "timeout");
        return "unknown";
      }
      await ledger.settle(id, { costMicroUsd: 3_000 + (i % 13) * 1_000 });
      return "settled";
    });
    const outcomes = await Promise.all(work);
    expect(outcomes.filter((o) => o === "settled").length).toBeGreaterThan(50);
    await audit(db);
    const s = await a.summary();
    expect(s.reservedMicroUsd).toBe(s.unknownMicroUsd); // everything else was settled or released
    expect(s.overageMicroUsd).toBe(0);
  });

  it("the kill switch, thrown mid-burst, lets nothing further through", async () => {
    await insertRun(db, "run", 100 * USD);
    await a.authorize(100 * USD, 100 * USD, "t");
    await a.setKillSwitch(false, "t", "t");
    const first = await Promise.all(Array.from({ length: 30 }, (_, i) => a.reserve({ id: `pre${i}`, runId: "run", amount: 10_000, model: "m", requestHash: "h" })));
    expect(first.every((r) => r.ok)).toBe(true);
    await b.setKillSwitch(true, "stop", "owner");
    const after = await Promise.all(Array.from({ length: 60 }, (_, i) => (i % 2 ? a : b).reserve({ id: `post${i}`, runId: "run", amount: 10_000, model: "m", requestHash: "h" })));
    expect(after.every((r) => !r.ok && r.reason === "kill_switch")).toBe(true);
    expect((await a.summary()).reservedMicroUsd).toBe(300_000);
  });
});

describe("database plumbing", () => {
  it("migrations are applied once, in order, and are recorded", async () => {
    const db = await memoryDb();
    const { migrate } = await import("./db");
    expect(await migrate(db)).toEqual([]); // nothing left to apply
    const versions = (await db.query("SELECT version FROM schema_migrations ORDER BY version")).map((r) => r.version);
    expect(versions).toEqual(["0001_ledger.sql"]);
    for (const table of ["budget", "runs", "daily_spend", "reservations", "calls", "epochs", "audit_log", "rate_limits"]) {
      expect(await db.query(`SELECT COUNT(*) AS n FROM ${table}`)).toHaveLength(1);
    }
    await db.close();
  });

  it("a transaction that throws leaves nothing behind", async () => {
    const db = await memoryDb();
    await expect(
      db.tx(async (q) => {
        await q.query("UPDATE budget SET kill_reason = 'half done' WHERE id = 1");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const [b] = await db.query("SELECT kill_reason FROM budget WHERE id = 1");
    expect(b!.kill_reason).toBe("never enabled");
    await db.close();
  });
});
