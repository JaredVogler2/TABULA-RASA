import "server-only";

/**
 * The budget ledger.
 *
 * Every paid request is reserved here, for the most it could cost, before it is sent — and
 * the reservation either becomes the provider's reported cost (settled), is given back
 * because the request provably did no billable work (released), or stays held because nobody
 * can prove what happened to it (unknown). Money that is held counts against every ceiling.
 *
 * The algorithm is the same single transaction in every environment:
 *
 *   1. insert the reservation under its deterministic id (a duplicate id changes nothing and
 *      dispatches nothing: this is what makes retries and re-ordered requests harmless)
 *   2. conditional UPDATE of the global budget row   (kill switch off, room under the cap)
 *   3. conditional UPDATE of the run row             (run active, room under its cap)
 *   4. conditional UPDATE of today's row             (room under the daily cap)
 *
 * Each UPDATE takes a row lock and re-checks its condition against committed data, so two
 * instances cannot both pass on money only one of them can have; if any step finds no room
 * the whole transaction rolls back. The CHECK constraints in the schema are a second line of
 * defence: even a wrong statement cannot commit an overspend.
 *
 * What this cannot do is cap spending that does not go through it: other applications using
 * the same key, or a provider billing something it did not report. A provider-side workspace
 * spend limit is the cap for that (docs/COST.md).
 */
import type { Usage } from "@/providers/prices";
import { Rollback, num, type Db, type Queryer } from "./db";

export type ReserveRefusal = "kill_switch" | "global_cap" | "run_cap" | "run_not_active" | "daily_cap" | "duplicate" | "invalid";

export interface ReserveInput {
  /** Deterministic: `${run}:${epoch}:${agent}:${attempt}`. */
  id: string;
  runId: string;
  /** The most the request can cost, in microdollars. */
  amount: number;
  model: string;
  requestHash: string;
}

export type ReserveResult = { ok: true } | { ok: false; reason: ReserveRefusal; state?: ReservationState };

export type ReservationState = "reserved" | "settled" | "released" | "unknown";

export interface Reservation {
  id: string;
  runId: string;
  state: ReservationState;
  reservedMicroUsd: number;
  settledMicroUsd: number;
  overageMicroUsd: number;
  model: string;
  requestHash: string;
  note: string;
  createdAt: string;
}

export interface BudgetSummary {
  authorizedMicroUsd: number;
  dailyCapMicroUsd: number;
  /** Held for requests not yet settled, including those whose outcome is unknown. */
  reservedMicroUsd: number;
  /** The part of `reserved` held for requests whose outcome is unknown. */
  unknownMicroUsd: number;
  unknownCount: number;
  settledMicroUsd: number;
  overageMicroUsd: number;
  /** authorized − reserved − settled: what a new reservation could still claim. */
  remainingMicroUsd: number;
  today: { day: string; reservedMicroUsd: number; settledMicroUsd: number; remainingMicroUsd: number };
  killSwitch: boolean;
  killReason: string;
}

export interface SettleInput {
  /** Provider-reported cost in microdollars. */
  costMicroUsd: number;
  usage?: Usage | null;
  requestId?: string | null;
  note?: string;
}

const isMoney = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const utcDay = (d: Date): string => d.toISOString().slice(0, 10);

export class Ledger {
  constructor(
    private readonly db: Db,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async summary(q: Queryer = this.db): Promise<BudgetSummary> {
    const day = utcDay(this.clock());
    const [b] = await q.query("SELECT authorized_microusd, daily_cap_microusd, reserved_microusd, settled_microusd, overage_microusd, kill_switch, kill_reason FROM budget WHERE id = 1");
    if (!b) throw new Error("budget row is missing");
    const [u] = await q.query("SELECT COALESCE(SUM(reserved_microusd), 0) AS held, COUNT(*) AS n FROM reservations WHERE state = 'unknown'");
    const [d] = await q.query("SELECT reserved_microusd, settled_microusd FROM daily_spend WHERE day = $1::date", [day]);
    const authorized = num(b.authorized_microusd);
    const reserved = num(b.reserved_microusd);
    const settled = num(b.settled_microusd);
    const dayReserved = num(d?.reserved_microusd);
    const daySettled = num(d?.settled_microusd);
    const dailyCap = num(b.daily_cap_microusd);
    return {
      authorizedMicroUsd: authorized,
      dailyCapMicroUsd: dailyCap,
      reservedMicroUsd: reserved,
      unknownMicroUsd: num(u?.held),
      unknownCount: num(u?.n),
      settledMicroUsd: settled,
      overageMicroUsd: num(b.overage_microusd),
      remainingMicroUsd: Math.max(0, authorized - reserved - settled),
      today: { day, reservedMicroUsd: dayReserved, settledMicroUsd: daySettled, remainingMicroUsd: Math.max(0, dailyCap - dayReserved - daySettled) },
      killSwitch: b.kill_switch === true,
      killReason: String(b.kill_reason ?? ""),
    };
  }

  /**
   * Set what this application may spend in total and per day. This is the owner's explicit
   * authorization; it never happens implicitly. It cannot be set below what is already
   * committed (held or spent).
   */
  async authorize(authorizedMicroUsd: number, dailyCapMicroUsd: number, actor: string): Promise<{ ok: true } | { ok: false; reason: "invalid" | "below_committed" }> {
    if (!isMoney(authorizedMicroUsd) || !isMoney(dailyCapMicroUsd)) return { ok: false, reason: "invalid" };
    return this.db.tx(async (q) => {
      const rows = await q.query("UPDATE budget SET authorized_microusd = $1::bigint, daily_cap_microusd = $2::bigint, updated_at = now() WHERE id = 1 AND $1::bigint >= reserved_microusd + settled_microusd RETURNING id", [authorizedMicroUsd, dailyCapMicroUsd]);
      if (rows.length === 0) return { ok: false as const, reason: "below_committed" as const };
      await audit(q, actor, "budget.authorize", { authorizedMicroUsd, dailyCapMicroUsd });
      return { ok: true as const };
    });
  }

  async setKillSwitch(on: boolean, reason: string, actor: string): Promise<void> {
    await this.db.tx(async (q) => {
      await q.query("UPDATE budget SET kill_switch = $1, kill_reason = $2, updated_at = now() WHERE id = 1", [on, reason.slice(0, 200)]);
      await audit(q, actor, on ? "kill_switch.on" : "kill_switch.off", { reason: reason.slice(0, 200) });
    });
  }

  /** Hold `amount` for one request. Dispatch only if this returns ok. */
  async reserve(input: ReserveInput): Promise<ReserveResult> {
    if (!isMoney(input.amount) || input.amount === 0 || !input.id || input.id.length > 200 || !input.runId) return { ok: false, reason: "invalid" };
    const day = utcDay(this.clock());
    return this.db.tx<ReserveResult>(async (q) => {
      const inserted = await q.query(
        "INSERT INTO reservations (id, run_id, day, state, reserved_microusd, model, request_hash) SELECT $1, $2, $3::date, 'reserved', $4::bigint, $5, $6 WHERE EXISTS (SELECT 1 FROM runs WHERE id = $2) ON CONFLICT (id) DO NOTHING RETURNING id",
        [input.id, input.runId, day, input.amount, input.model, input.requestHash],
      );
      if (inserted.length === 0) {
        // either this request is already on the books, or there is no such run
        const [existing] = await q.query("SELECT state FROM reservations WHERE id = $1", [input.id]);
        if (!existing) return { ok: false, reason: "run_not_active" };
        return { ok: false, reason: "duplicate", state: existing.state as ReservationState };
      }
      const global = await q.query("UPDATE budget SET reserved_microusd = reserved_microusd + $1::bigint, updated_at = now() WHERE id = 1 AND kill_switch = false AND reserved_microusd + settled_microusd + $1::bigint <= authorized_microusd RETURNING id", [input.amount]);
      if (global.length === 0) {
        const [b] = await q.query("SELECT kill_switch FROM budget WHERE id = 1");
        throw new Rollback<ReserveResult>({ ok: false, reason: b?.kill_switch === true ? "kill_switch" : "global_cap" });
      }
      const run = await q.query("UPDATE runs SET reserved_microusd = reserved_microusd + $1::bigint, updated_at = now() WHERE id = $2 AND status = 'active' AND reserved_microusd + settled_microusd + $1::bigint <= cap_microusd RETURNING id", [input.amount, input.runId]);
      if (run.length === 0) {
        const [r] = await q.query("SELECT status FROM runs WHERE id = $1", [input.runId]);
        throw new Rollback<ReserveResult>({ ok: false, reason: r && r.status === "active" ? "run_cap" : "run_not_active" });
      }
      await q.query("INSERT INTO daily_spend (day) VALUES ($1::date) ON CONFLICT (day) DO NOTHING", [day]);
      const daily = await q.query("UPDATE daily_spend SET reserved_microusd = reserved_microusd + $1::bigint WHERE day = $2::date AND reserved_microusd + settled_microusd + $1::bigint <= (SELECT daily_cap_microusd FROM budget WHERE id = 1) RETURNING day", [input.amount, day]);
      if (daily.length === 0) throw new Rollback<ReserveResult>({ ok: false, reason: "daily_cap" });
      return { ok: true };
    });
  }

  /**
   * Replace a reservation by the provider's reported cost. Idempotent: settling twice, or
   * settling something already released, changes nothing. A cost above the reservation is
   * recorded as overage and turns the kill switch on.
   */
  async settle(id: string, input: SettleInput): Promise<"settled" | "already" | "missing" | "invalid"> {
    if (!isMoney(input.costMicroUsd)) return "invalid";
    return this.db.tx(async (q) => {
      const u = input.usage;
      const rows = await q.query(
        `UPDATE reservations SET state = 'settled', settled_microusd = LEAST($2::bigint, reserved_microusd), overage_microusd = GREATEST($2::bigint - reserved_microusd, 0),
           input_tokens = $3, output_tokens = $4, cache_write_tokens = $5, cache_read_tokens = $6, provider_request_id = $7, note = $8, settled_at = now()
         WHERE id = $1 AND state IN ('reserved', 'unknown')
         RETURNING run_id, day::text AS day, reserved_microusd, settled_microusd, overage_microusd`,
        [id, input.costMicroUsd, u ? u.input_tokens : null, u ? u.output_tokens : null, u ? u.cache_creation_input_tokens : null, u ? u.cache_read_input_tokens : null, input.requestId ?? null, (input.note ?? "").slice(0, 200)],
      );
      const row = rows[0];
      if (!row) {
        const [existing] = await q.query("SELECT state FROM reservations WHERE id = $1", [id]);
        return existing ? "already" : "missing";
      }
      const held = num(row.reserved_microusd);
      const charged = num(row.settled_microusd);
      const over = num(row.overage_microusd);
      await q.query(
        `UPDATE budget SET reserved_microusd = reserved_microusd - $1::bigint, settled_microusd = settled_microusd + $2::bigint, overage_microusd = overage_microusd + $3::bigint,
           kill_switch = kill_switch OR $3::bigint > 0,
           kill_reason = CASE WHEN $3::bigint > 0 THEN 'a request cost more than was reserved for it' ELSE kill_reason END, updated_at = now()
         WHERE id = 1`,
        [held, charged, over],
      );
      await q.query("UPDATE runs SET reserved_microusd = reserved_microusd - $1::bigint, settled_microusd = settled_microusd + $2::bigint, updated_at = now() WHERE id = $3", [held, charged, row.run_id]);
      await q.query("UPDATE daily_spend SET reserved_microusd = reserved_microusd - $1::bigint, settled_microusd = settled_microusd + $2::bigint WHERE day = $3::date", [held, charged, row.day]);
      if (over > 0) await audit(q, "ledger", "overage", { id, overMicroUsd: over });
      return "settled";
    });
  }

  /**
   * Give a reservation back. Only for a request that provably did no billable work (it was
   * never sent, or the provider answered with a definite error). Idempotent.
   */
  async release(id: string, note: string): Promise<"released" | "already" | "missing"> {
    return this.db.tx(async (q) => {
      const rows = await q.query("UPDATE reservations SET state = 'released', note = $2, settled_at = now() WHERE id = $1 AND state IN ('reserved', 'unknown') RETURNING run_id, day::text AS day, reserved_microusd", [id, note.slice(0, 200)]);
      const row = rows[0];
      if (!row) {
        const [existing] = await q.query("SELECT state FROM reservations WHERE id = $1", [id]);
        return existing ? "already" : "missing";
      }
      const held = num(row.reserved_microusd);
      await q.query("UPDATE budget SET reserved_microusd = reserved_microusd - $1::bigint, updated_at = now() WHERE id = 1", [held]);
      await q.query("UPDATE runs SET reserved_microusd = reserved_microusd - $1::bigint, updated_at = now() WHERE id = $2", [held, row.run_id]);
      await q.query("UPDATE daily_spend SET reserved_microusd = reserved_microusd - $1::bigint WHERE day = $2::date", [held, row.day]);
      return "released";
    });
  }

  /** Mark a dispatched request whose outcome cannot be proven. The money stays held. */
  async markUnknown(id: string, note: string): Promise<void> {
    await this.db.query("UPDATE reservations SET state = 'unknown', note = $2 WHERE id = $1 AND state = 'reserved'", [id, note.slice(0, 200)]);
  }

  /**
   * Reservations still "reserved" long after they were made belong to requests whose process
   * died before it could record an outcome. They become "unknown" (still held), so that the
   * owner sees them. Nothing is ever released automatically.
   */
  async sweep(olderThanMs: number): Promise<number> {
    // ages are measured on the database's clock, the one that stamped the rows
    const rows = await this.db.query("UPDATE reservations SET state = 'unknown', note = 'no outcome was recorded' WHERE state = 'reserved' AND created_at < now() - ($1::bigint * interval '1 millisecond') RETURNING id", [Math.max(0, Math.floor(olderThanMs))]);
    return rows.length;
  }

  async get(id: string): Promise<Reservation | null> {
    const [r] = await this.db.query("SELECT id, run_id, state, reserved_microusd, settled_microusd, overage_microusd, model, request_hash, note, created_at::text AS created_at FROM reservations WHERE id = $1", [id]);
    return r ? toReservation(r) : null;
  }

  async list(state: ReservationState, limit = 100): Promise<Reservation[]> {
    const rows = await this.db.query("SELECT id, run_id, state, reserved_microusd, settled_microusd, overage_microusd, model, request_hash, note, created_at::text AS created_at FROM reservations WHERE state = $1 ORDER BY created_at DESC LIMIT $2", [state, Math.max(1, Math.min(500, limit))]);
    return rows.map(toReservation);
  }

  /**
   * The owner's decision about a request whose outcome is unknown, after checking the
   * provider's own usage records: either it was not billed (release), or it is to be counted
   * as spent at a stated amount up to what was held (the whole of it, if they cannot tell).
   */
  async reconcile(id: string, decision: { release: true } | { settleMicroUsd: number }, actor: string): Promise<"done" | "not_unknown" | "invalid"> {
    const [r] = await this.db.query("SELECT state, reserved_microusd FROM reservations WHERE id = $1", [id]);
    if (!r || r.state !== "unknown") return "not_unknown";
    if ("release" in decision) {
      const out = await this.release(id, `reconciled by ${actor}: not billed`);
      if (out !== "released") return "not_unknown";
    } else {
      if (!isMoney(decision.settleMicroUsd) || decision.settleMicroUsd > num(r.reserved_microusd)) return "invalid";
      const out = await this.settle(id, { costMicroUsd: decision.settleMicroUsd, note: `reconciled by ${actor}` });
      if (out !== "settled") return "not_unknown";
    }
    await audit(this.db, actor, "reservation.reconcile", { id, decision });
    return "done";
  }
}

function toReservation(r: Record<string, unknown>): Reservation {
  return {
    id: String(r.id),
    runId: String(r.run_id),
    state: r.state as ReservationState,
    reservedMicroUsd: num(r.reserved_microusd),
    settledMicroUsd: num(r.settled_microusd),
    overageMicroUsd: num(r.overage_microusd),
    model: String(r.model),
    requestHash: String(r.request_hash),
    note: String(r.note ?? ""),
    createdAt: String(r.created_at),
  };
}

/** Append to the audit log. `detail` must never contain a secret; it is stored as given. */
export async function audit(q: Queryer, actor: string, action: string, detail: Record<string, unknown> = {}): Promise<void> {
  await q.query("INSERT INTO audit_log (actor, action, detail) VALUES ($1, $2, $3)", [actor.slice(0, 80), action.slice(0, 80), JSON.stringify(detail).slice(0, 4000)]);
}
