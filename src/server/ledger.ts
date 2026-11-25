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
 * Two ceilings stand above the one the owner sets. The authorized amount is set from the
 * owner console; the deployment's ceiling (`BUDGET_CEILING_USD`) is not — it comes from the
 * deployment's own configuration, and the console can neither see past it nor raise it. A
 * stolen console session can therefore spend at most what the deployment allows, however
 * often it re-authorizes. Every reservation is checked against the lower of the two.
 *
 * Money a request cost beyond what was held for it ("overage": it should never happen, and it
 * turns the kill switch on) is real money. It counts against the total, the run and the day
 * in every later reservation, exactly as settled money does.
 *
 * What this cannot do is cap spending that does not go through it: other applications using
 * the same key, or a provider billing something it did not report. A provider-side workspace
 * spend limit is the cap for that (docs/COST.md).
 */
import type { Usage } from "@/providers/prices";
import { Rollback, num, type Db, type Queryer } from "./db";

export type ReserveRefusal = "kill_switch" | "ceiling" | "global_cap" | "run_cap" | "run_not_active" | "daily_cap" | "duplicate" | "invalid";

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
  /** The most this deployment may ever be authorized to spend: set where it is deployed, not here. */
  ceilingMicroUsd: number;
  authorizedMicroUsd: number;
  dailyCapMicroUsd: number;
  /** Held for requests not yet settled, including those whose outcome is unknown. */
  reservedMicroUsd: number;
  /** The part of `reserved` held for requests whose outcome is unknown. */
  unknownMicroUsd: number;
  unknownCount: number;
  settledMicroUsd: number;
  overageMicroUsd: number;
  /** The lower of the authorized amount and the ceiling, less what is held, settled or was charged beyond a hold: what a new reservation could still claim. */
  remainingMicroUsd: number;
  today: { day: string; reservedMicroUsd: number; settledMicroUsd: number; overageMicroUsd: number; remainingMicroUsd: number };
  killSwitch: boolean;
  killReason: string;
  /** "overage" when money tripped the switch (releasing it then takes a typed phrase); "" otherwise. */
  killCode: string;
}

export interface LedgerOptions {
  /**
   * The most this deployment may ever be authorized to spend, in microdollars, from its own
   * configuration (`budgetCeilingMicro` in env.ts). There is no default: a ledger that is not
   * told its ceiling could not refuse anything on its account.
   */
  ceilingMicroUsd: number;
  clock?: () => Date;
}

/** What became of a paid request, as the ledger is to record it. */
export type Outcome = { kind: "settle"; input: SettleInput } | { kind: "release"; note: string } | { kind: "unknown"; note: string };

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
  private readonly ceiling: number;
  private readonly clock: () => Date;

  constructor(
    private readonly db: Db,
    options: LedgerOptions,
  ) {
    // a ceiling that is not a sum of money is no ceiling: nothing can be authorized or reserved under it
    this.ceiling = isMoney(options.ceilingMicroUsd) ? options.ceilingMicroUsd : 0;
    this.clock = options.clock ?? (() => new Date());
  }

  async summary(q: Queryer = this.db): Promise<BudgetSummary> {
    const day = utcDay(this.clock());
    const [b] = await q.query("SELECT authorized_microusd, daily_cap_microusd, reserved_microusd, settled_microusd, overage_microusd, kill_switch, kill_reason, kill_code FROM budget WHERE id = 1");
    if (!b) throw new Error("budget row is missing");
    const [u] = await q.query("SELECT COALESCE(SUM(reserved_microusd), 0) AS held, COUNT(*) AS n FROM reservations WHERE state = 'unknown'");
    const [d] = await q.query("SELECT reserved_microusd, settled_microusd, overage_microusd FROM daily_spend WHERE day = $1::date", [day]);
    const authorized = num(b.authorized_microusd);
    const reserved = num(b.reserved_microusd);
    const settled = num(b.settled_microusd);
    const overage = num(b.overage_microusd);
    const dayReserved = num(d?.reserved_microusd);
    const daySettled = num(d?.settled_microusd);
    const dayOverage = num(d?.overage_microusd);
    const dailyCap = num(b.daily_cap_microusd);
    return {
      ceilingMicroUsd: this.ceiling,
      authorizedMicroUsd: authorized,
      dailyCapMicroUsd: dailyCap,
      reservedMicroUsd: reserved,
      unknownMicroUsd: num(u?.held),
      unknownCount: num(u?.n),
      settledMicroUsd: settled,
      overageMicroUsd: overage,
      remainingMicroUsd: Math.max(0, Math.min(authorized, this.ceiling) - reserved - settled - overage),
      today: { day, reservedMicroUsd: dayReserved, settledMicroUsd: daySettled, overageMicroUsd: dayOverage, remainingMicroUsd: Math.max(0, dailyCap - dayReserved - daySettled - dayOverage) },
      killSwitch: b.kill_switch === true,
      killReason: String(b.kill_reason ?? ""),
      killCode: String(b.kill_code ?? ""),
    };
  }

  /**
   * Set what this application may spend in total and per day. This is the owner's explicit
   * authorization; it never happens implicitly. It cannot be set below what is already
   * committed (held or spent), nor above the deployment's ceiling: that is a limit the
   * credential that spends cannot move.
   */
  async authorize(authorizedMicroUsd: number, dailyCapMicroUsd: number, actor: string): Promise<{ ok: true } | { ok: false; reason: "invalid" | "below_committed" | "above_ceiling" }> {
    if (!isMoney(authorizedMicroUsd) || !isMoney(dailyCapMicroUsd)) return { ok: false, reason: "invalid" };
    if (authorizedMicroUsd > this.ceiling) {
      await audit(this.db, actor, "budget.authorize_refused", { authorizedMicroUsd, ceilingMicroUsd: this.ceiling }).catch(() => undefined);
      return { ok: false, reason: "above_ceiling" };
    }
    return this.db.tx(async (q) => {
      const rows = await q.query("UPDATE budget SET authorized_microusd = $1::bigint, daily_cap_microusd = $2::bigint, updated_at = now() WHERE id = 1 AND $1::bigint >= reserved_microusd + settled_microusd AND $1::bigint <= $3::bigint RETURNING id", [authorizedMicroUsd, dailyCapMicroUsd, this.ceiling]);
      if (rows.length === 0) return { ok: false as const, reason: "below_committed" as const };
      await audit(q, actor, "budget.authorize", { authorizedMicroUsd, dailyCapMicroUsd, ceilingMicroUsd: this.ceiling });
      return { ok: true as const };
    });
  }

  /** Turn the switch on or off. `code` says what tripped it ("overage" when money did); releasing it clears the code. */
  async setKillSwitch(on: boolean, reason: string, actor: string, code = ""): Promise<void> {
    await this.db.tx(async (q) => {
      await q.query("UPDATE budget SET kill_switch = $1, kill_reason = $2, kill_code = $3, updated_at = now() WHERE id = 1", [on, reason.slice(0, 200), on ? code.slice(0, 40) : ""]);
      await audit(q, actor, on ? "kill_switch.on" : "kill_switch.off", { reason: reason.slice(0, 200), ...(on && code ? { code } : {}) });
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
      const global = await q.query(
        "UPDATE budget SET reserved_microusd = reserved_microusd + $1::bigint, updated_at = now() WHERE id = 1 AND kill_switch = false AND reserved_microusd + settled_microusd + overage_microusd + $1::bigint <= LEAST(authorized_microusd, $2::bigint) RETURNING id",
        [input.amount, this.ceiling],
      );
      if (global.length === 0) {
        const [b] = await q.query("SELECT kill_switch, authorized_microusd, reserved_microusd + settled_microusd + overage_microusd AS committed FROM budget WHERE id = 1");
        const reason: ReserveRefusal = b?.kill_switch === true ? "kill_switch" : num(b?.committed) + input.amount <= num(b?.authorized_microusd) ? "ceiling" : "global_cap";
        throw new Rollback<ReserveResult>({ ok: false, reason });
      }
      const run = await q.query("UPDATE runs SET reserved_microusd = reserved_microusd + $1::bigint, updated_at = now() WHERE id = $2 AND status = 'active' AND reserved_microusd + settled_microusd + overage_microusd + $1::bigint <= cap_microusd RETURNING id", [input.amount, input.runId]);
      if (run.length === 0) {
        const [r] = await q.query("SELECT status FROM runs WHERE id = $1", [input.runId]);
        throw new Rollback<ReserveResult>({ ok: false, reason: r && r.status === "active" ? "run_cap" : "run_not_active" });
      }
      await q.query("INSERT INTO daily_spend (day) VALUES ($1::date) ON CONFLICT (day) DO NOTHING", [day]);
      const daily = await q.query("UPDATE daily_spend SET reserved_microusd = reserved_microusd + $1::bigint WHERE day = $2::date AND reserved_microusd + settled_microusd + overage_microusd + $1::bigint <= (SELECT daily_cap_microusd FROM budget WHERE id = 1) RETURNING day", [input.amount, day]);
      if (daily.length === 0) throw new Rollback<ReserveResult>({ ok: false, reason: "daily_cap" });
      return { ok: true };
    });
  }

  /**
   * Replace a reservation by the provider's reported cost. Idempotent: settling twice changes
   * nothing. A cost above the reservation is recorded as overage and turns the kill switch on.
   * So does a cost that arrives for a reservation whose hold was already given back (released
   * by the owner while its request was still in flight): the hold is gone, so the whole cost
   * is overage ("late"), and it is never dropped.
   */
  async settle(id: string, input: SettleInput): Promise<"settled" | "late" | "already" | "missing" | "invalid"> {
    if (!isMoney(input.costMicroUsd)) return "invalid";
    return this.db.tx((q) => this.settleIn(q, id, input));
  }

  private async settleIn(q: Queryer, id: string, input: SettleInput): Promise<"settled" | "late" | "already" | "missing" | "invalid"> {
    if (!isMoney(input.costMicroUsd)) return "invalid";
    const u = input.usage;
    const usage = [u ? u.input_tokens : null, u ? u.output_tokens : null, u ? u.cache_creation_input_tokens : null, u ? u.cache_read_input_tokens : null, input.requestId ?? null];
    const rows = await q.query(
      `UPDATE reservations SET state = 'settled', settled_microusd = LEAST($2::bigint, reserved_microusd), overage_microusd = GREATEST($2::bigint - reserved_microusd, 0),
         input_tokens = $3, output_tokens = $4, cache_write_tokens = $5, cache_read_tokens = $6, provider_request_id = $7, note = $8, settled_at = now()
       WHERE id = $1 AND state IN ('reserved', 'unknown')
       RETURNING run_id, day::text AS day, reserved_microusd, settled_microusd, overage_microusd`,
      [id, input.costMicroUsd, ...usage, (input.note ?? "").slice(0, 200)],
    );
    let row = rows[0];
    let late = false;
    if (!row) {
      const [existing] = await q.query("SELECT state FROM reservations WHERE id = $1", [id]);
      if (!existing) return "missing";
      if (existing.state !== "released" || input.costMicroUsd === 0) return "already";
      // charged after its hold was given back: nothing is held for it any more, so all of it is overage
      const again = await q.query(
        `UPDATE reservations SET state = 'settled', settled_microusd = 0, overage_microusd = $2::bigint,
           input_tokens = $3, output_tokens = $4, cache_write_tokens = $5, cache_read_tokens = $6, provider_request_id = $7, note = 'charged after its hold was released', settled_at = now()
         WHERE id = $1 AND state = 'released'
         RETURNING run_id, day::text AS day, 0 AS reserved_microusd, settled_microusd, overage_microusd`,
        [id, input.costMicroUsd, ...usage],
      );
      row = again[0];
      if (!row) return "already";
      late = true;
    }
    const held = num(row.reserved_microusd);
    const charged = num(row.settled_microusd);
    const over = num(row.overage_microusd);
    await q.query(
      `UPDATE budget SET reserved_microusd = reserved_microusd - $1::bigint, settled_microusd = settled_microusd + $2::bigint, overage_microusd = overage_microusd + $3::bigint,
         kill_switch = kill_switch OR $3::bigint > 0,
         kill_reason = CASE WHEN $3::bigint > 0 THEN $4 ELSE kill_reason END,
         kill_code = CASE WHEN $3::bigint > 0 THEN 'overage' ELSE kill_code END, updated_at = now()
       WHERE id = 1`,
      [held, charged, over, late ? "a request was charged after its hold had been released" : "a request cost more than was reserved for it"],
    );
    await q.query("UPDATE runs SET reserved_microusd = reserved_microusd - $1::bigint, settled_microusd = settled_microusd + $2::bigint, overage_microusd = overage_microusd + $3::bigint, updated_at = now() WHERE id = $4", [held, charged, over, row.run_id]);
    await q.query("INSERT INTO daily_spend (day) VALUES ($1::date) ON CONFLICT (day) DO NOTHING", [row.day]);
    await q.query("UPDATE daily_spend SET reserved_microusd = reserved_microusd - $1::bigint, settled_microusd = settled_microusd + $2::bigint, overage_microusd = overage_microusd + $3::bigint WHERE day = $4::date", [held, charged, over, row.day]);
    if (over > 0) await audit(q, "ledger", late ? "late_settlement" : "overage", { id, overMicroUsd: over });
    return late ? "late" : "settled";
  }

  /**
   * Give a reservation back. Only for a request that provably did no billable work (it was
   * never sent, or the provider itself answered with an error). Idempotent.
   */
  async release(id: string, note: string): Promise<"released" | "already" | "missing"> {
    return this.db.tx((q) => this.releaseIn(q, id, note));
  }

  private async releaseIn(q: Queryer, id: string, note: string): Promise<"released" | "already" | "missing"> {
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
  }

  /** Mark a dispatched request whose outcome cannot be proven. The money stays held. */
  async markUnknown(id: string, note: string): Promise<void> {
    await this.markUnknownIn(this.db, id, note);
  }

  private async markUnknownIn(q: Queryer, id: string, note: string): Promise<void> {
    await q.query("UPDATE reservations SET state = 'unknown', note = $2 WHERE id = $1 AND state = 'reserved'", [id, note.slice(0, 200)]);
  }

  /**
   * Record what became of a paid request and, in the same transaction, whatever the caller
   * keeps about it (`also`: the record of the call itself). Either both are written or neither
   * is: a process that dies between them can no longer leave money accounted for with no
   * record of the answer, or an answer with its money still held.
   */
  async conclude(id: string, outcome: Outcome, also: (q: Queryer) => Promise<void>): Promise<"settled" | "late" | "released" | "unknown" | "already" | "missing" | "invalid"> {
    return this.db.tx(async (q) => {
      let done: "settled" | "late" | "released" | "unknown" | "already" | "missing" | "invalid";
      if (outcome.kind === "settle") done = await this.settleIn(q, id, outcome.input);
      else if (outcome.kind === "release") done = await this.releaseIn(q, id, outcome.note);
      else {
        await this.markUnknownIn(q, id, outcome.note);
        done = "unknown";
      }
      await also(q);
      return done;
    });
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
   * The decision, its effect on the books and its audit entry are one transaction.
   */
  async reconcile(id: string, decision: { release: true } | { settleMicroUsd: number }, actor: string): Promise<"done" | "not_unknown" | "invalid"> {
    return this.db.tx<"done" | "not_unknown" | "invalid">(async (q) => {
      const [r] = await q.query("SELECT state, reserved_microusd FROM reservations WHERE id = $1 FOR UPDATE", [id]);
      if (!r || r.state !== "unknown") return "not_unknown";
      if ("release" in decision) {
        const out = await this.releaseIn(q, id, `reconciled by ${actor}: not billed`);
        if (out !== "released") throw new Rollback<"not_unknown">("not_unknown");
      } else {
        if (!isMoney(decision.settleMicroUsd) || decision.settleMicroUsd > num(r.reserved_microusd)) return "invalid";
        const out = await this.settleIn(q, id, { costMicroUsd: decision.settleMicroUsd, note: `reconciled by ${actor}` });
        if (out !== "settled") throw new Rollback<"not_unknown">("not_unknown");
      }
      await audit(q, actor, "reservation.reconcile", { id, decision });
      return "done";
    });
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
