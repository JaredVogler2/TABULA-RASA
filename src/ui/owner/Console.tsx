"use client";

/**
 * The owner console: the one place from which money can be authorized and a society with
 * model-driven minds can be run. Everything it shows comes from the server after sign-in;
 * nothing here knows a key, a price or a budget by itself, and a signed-out visitor is told
 * only whether sign-in is possible.
 *
 * In-world text (run titles, audit details) is rendered as text. Nothing is ever injected
 * as markup.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SCENARIOS } from "@/engine";
import { formatUsd } from "@/providers/prices";
import styles from "./owner.module.css";

// ───────────────────────── what the server sends

interface Budget {
  authorizedMicroUsd: number;
  dailyCapMicroUsd: number;
  reservedMicroUsd: number;
  unknownMicroUsd: number;
  unknownCount: number;
  settledMicroUsd: number;
  overageMicroUsd: number;
  remainingMicroUsd: number;
  today: { day: string; reservedMicroUsd: number; settledMicroUsd: number; remainingMicroUsd: number };
  killSwitch: boolean;
  killReason: string;
  /** "overage" when money tripped the switch: releasing it then takes a typed phrase. */
  killCode: string;
  /** The most this deployment may ever be authorized to spend: set where it is deployed, never from this page. */
  ceilingMicroUsd: number;
}
interface Live {
  available: boolean;
  reasons: string[];
  model: string | null;
  keyConfigured: boolean;
  database: string;
  deployment: string;
  prices: { verifiedOn: string; attestedOn: string | null; ageDays: number; staleAfterDays: number; stale: boolean; modelKnown: boolean };
}
interface RunView {
  id: string;
  title: string;
  status: "active" | "paused" | "done" | "cancelled" | "failed";
  statusReason: string;
  provider: string;
  model: string;
  capMicroUsd: number;
  reservedMicroUsd: number;
  settledMicroUsd: number;
  epoch: number;
  tick: number;
  published: boolean;
  createdAt: string;
  spec: { epochs: number; epochTicks: number; scheduler: { kind: string; callsPerEpoch: number } };
  config: { scenario: string; seed: number; population: number };
}
interface Unknown {
  id: string;
  runId: string;
  reservedMicroUsd: number;
  note: string;
  createdAt: string;
}
interface Status {
  signedIn: boolean;
  signInPossible?: boolean;
  csrf?: string;
  live?: Live;
  budget?: Budget;
  /** Present when money tripped the kill switch: the words that release it. */
  releasePhrase?: string | null;
  runs?: RunView[];
  unknown?: Unknown[];
  audit?: { at: string; actor: string; action: string; detail: string }[];
}
interface Preview {
  provider: string;
  model: string;
  paid: boolean;
  externalAgents: number;
  callsPlanned: number;
  inputTokenBound: number;
  maxTokens: number;
  perCallMicroUsd: number;
  worstCaseMicroUsd: number;
  measured: { calls: number; meanMicroUsd: number; maxMicroUsd: number } | null;
}

type Reply = { status: number; data: Record<string, unknown> };

const REASONS: Record<string, string> = {
  kill_switch: "the kill switch is on",
  run_cap: "the run reached its spending cap",
  global_cap: "the authorized budget is used up",
  daily_cap: "today's allowance is used up",
  auth: "the provider rejected the API key",
  billing: "the provider reported a billing problem",
  spend_limit: "a provider-side spend limit was reached",
  model_unavailable: "the provider does not offer the configured model to this account",
  bad_request: "the provider rejected the request as malformed",
  too_large: "the request was too large for the provider",
  snapshot_mismatch: "the stored world did not match its digest",
  ceiling: "the deployment's ceiling is reached (BUDGET_CEILING_USD)",
  unusable_answers: "three answers in a row were paid for and could not be used",
  wrong_model: "the provider answered with a model other than the one approved",
  charged_after_release: "a request was charged after its hold had been released",
};

const usd = (micro: number): string => formatUsd(micro);

// ───────────────────────── the console

export function Console() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const csrf = useRef("");

  const call = useCallback(async (path: string, body?: unknown): Promise<Reply> => {
    const res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: body === undefined ? {} : { "content-type": "application/json", "x-csrf-token": csrf.current },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      // a response without a JSON body is reported by its status alone
    }
    return { status: res.status, data };
  }, []);

  /** Ask the server what there is to show. Sets nothing: the caller applies the answer. */
  const load = useCallback(async (): Promise<{ status: Status | null; error: string }> => {
    try {
      const r = await call("/api/owner/status");
      if (r.status === 200) return { status: r.data as unknown as Status, error: "" };
      if (r.status === 503) return { status: null, error: "The server's database cannot be reached. Nothing can be read or changed until it can." };
      return { status: null, error: `The server answered ${r.status}.` };
    } catch {
      return { status: null, error: "The server cannot be reached." };
    }
  }, [call]);

  const apply = useCallback((next: { status: Status | null; error: string }): void => {
    if (next.status) {
      if (next.status.csrf) csrf.current = next.status.csrf;
      setStatus(next.status);
    }
    setError(next.error);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    apply(await load());
  }, [apply, load]);

  useEffect(() => {
    let cancelled = false;
    void load().then((next) => {
      if (!cancelled) apply(next);
    });
    return () => {
      cancelled = true;
    };
  }, [apply, load]);

  if (!status) {
    return (
      <main className={styles.page}>
        <Header />
        <p className={styles.muted} role="status">
          {error || "Asking the server…"}
        </p>
      </main>
    );
  }
  if (!status.signedIn) {
    return (
      <main className={styles.page}>
        <Header />
        <SignIn possible={status.signInPossible === true} call={call} onDone={refresh} setCsrf={(t) => (csrf.current = t)} />
      </main>
    );
  }
  const budget = status.budget as Budget;
  const live = status.live as Live;
  return (
    <main className={styles.page}>
      <Header
        right={
          <button
            type="button"
            className={styles.quiet}
            data-testid="signout"
            title="Ends every session there is, on every device"
            onClick={async () => {
              await call("/api/owner/logout", {});
              csrf.current = "";
              await refresh();
            }}
          >
            Sign out everywhere
          </button>
        }
      />
      {error ? (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.columns}>
        <LivePanel live={live} />
        <BudgetPanel budget={budget} releasePhrase={typeof status.releasePhrase === "string" ? status.releasePhrase : null} call={call} refresh={refresh} />
      </div>
      {status.unknown && status.unknown.length > 0 ? <UnknownPanel items={status.unknown} call={call} refresh={refresh} /> : null}
      <NewRun live={live} budget={budget} call={call} refresh={refresh} />
      <Runs runs={status.runs ?? []} call={call} refresh={refresh} />
      <AuditPanel entries={status.audit ?? []} />
    </main>
  );
}

function Header({ right }: { right?: React.ReactNode }) {
  return (
    <header className={styles.header}>
      <div>
        <p className={styles.kicker}>TABULA RASA</p>
        <h1>Owner console</h1>
        <p className={styles.lede}>Authorize spending, run a society whose minds are consulted through a provider, and decide what is published. Nothing here spends anything until you say so, in words, twice.</p>
      </div>
      {right}
    </header>
  );
}

function SignIn({ possible, call, onDone, setCsrf }: { possible: boolean; call: (p: string, b?: unknown) => Promise<Reply>; onDone: () => Promise<void>; setCsrf: (t: string) => void }) {
  const [passphrase, setPassphrase] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  if (!possible) {
    return (
      <section className={styles.panel} data-testid="signin-unavailable">
        <h2>Sign-in is not set up</h2>
        <p>This deployment has no owner passphrase configured, so there is no owner and nothing here can be used. The public game does not need one.</p>
        <p className={styles.small}>
          To set it up, run <code>pnpm owner:hash</code> on your own machine and put the two lines it prints in the server&apos;s environment. It also needs a database: <code>docs/DEPLOYMENT.md</code> has the steps.
        </p>
      </section>
    );
  }
  return (
    <section className={styles.panel}>
      <h2>Sign in</h2>
      <form
        className={styles.form}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage("");
          const r = await call("/api/owner/login", { passphrase });
          setBusy(false);
          setPassphrase("");
          if (r.status === 200) {
            setCsrf(String(r.data.csrf ?? ""));
            await onDone();
          } else if (r.status === 429) setMessage("Too many attempts. Wait a quarter of an hour.");
          else if (r.status === 401) setMessage("That is not the passphrase.");
          else if (r.status === 503) setMessage("The server's database cannot be reached, so sign-in is closed.");
          else setMessage(`Sign-in failed (${r.status}).`);
        }}
      >
        <label className={styles.field}>
          <span>Owner passphrase</span>
          <input data-testid="passphrase" type="password" autoComplete="current-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} required minLength={1} />
        </label>
        <button data-testid="signin" type="submit" className={styles.primary} disabled={busy || passphrase.length === 0}>
          {busy ? "Checking…" : "Sign in"}
        </button>
        {message ? (
          <p className={styles.alert} role="alert">
            {message}
          </p>
        ) : null}
      </form>
    </section>
  );
}

function LivePanel({ live }: { live: Live }) {
  return (
    <section className={styles.panel} data-testid="live-panel">
      <h2>Live calls</h2>
      <p className={styles.state} data-state={live.available ? "on" : "off"} data-testid="live-state">
        <span aria-hidden="true">{live.available ? "●" : "○"}</span> {live.available ? "Available" : "Unavailable"}
      </p>
      {live.available ? (
        <p>
          Calls would go to <strong>{live.model}</strong> with this deployment&apos;s key, and only for runs you approve.
        </p>
      ) : (
        <>
          <p>No paid call can be made from this deployment, because:</p>
          <ul className={styles.reasons} data-testid="live-reasons">
            {live.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p className={styles.small}>Mock and baseline runs need none of this and cost nothing.</p>
        </>
      )}
      <dl className={styles.facts}>
        <div>
          <dt>Model</dt>
          <dd>{live.model ?? "not set"}</dd>
        </div>
        <div>
          <dt>API key</dt>
          <dd>{live.keyConfigured ? "configured (never shown)" : "not configured"}</dd>
        </div>
        <div>
          <dt>Ledger database</dt>
          <dd>{live.database === "postgres" ? "PostgreSQL" : live.database === "local" ? "local file (development only)" : "none"}</dd>
        </div>
        <div>
          <dt>Deployment</dt>
          <dd>{live.deployment}</dd>
        </div>
        <div>
          <dt>Price table</dt>
          <dd>
            verified {live.prices.verifiedOn}
            {live.prices.attestedOn ? `, re-checked ${live.prices.attestedOn}` : ""} · {live.prices.ageDays} days old{live.prices.stale ? ` · STALE (limit ${live.prices.staleAfterDays})` : ` (limit ${live.prices.staleAfterDays})`}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function Meter({ budget }: { budget: Budget }) {
  const total = Math.max(1, budget.authorizedMicroUsd);
  const knownHeld = Math.max(0, budget.reservedMicroUsd - budget.unknownMicroUsd);
  const parts = [
    { key: "spent", label: "Spent", value: budget.settledMicroUsd },
    { key: "held", label: "Held for calls in flight", value: knownHeld },
    { key: "unknown", label: "Held, outcome unknown", value: budget.unknownMicroUsd },
  ];
  return (
    <div className={styles.meterWrap}>
      <div className={styles.meter} role="img" aria-label={`Of ${usd(budget.authorizedMicroUsd)} authorized: ${usd(budget.settledMicroUsd)} spent, ${usd(knownHeld)} held for calls in flight, ${usd(budget.unknownMicroUsd)} held with outcome unknown, ${usd(budget.remainingMicroUsd)} remaining.`}>
        {budget.authorizedMicroUsd > 0
          ? parts.filter((p) => p.value > 0).map((p) => <span key={p.key} className={styles.segment} data-part={p.key} style={{ width: `${Math.max(1.2, (p.value / total) * 100)}%` }} title={`${p.label}: ${usd(p.value)}`} />)
          : null}
      </div>
      <ul className={styles.legend}>
        {parts.map((p) => (
          <li key={p.key}>
            <span className={styles.swatch} data-part={p.key} aria-hidden="true" />
            {p.label} <strong className="tnum">{usd(p.value)}</strong>
          </li>
        ))}
        <li>
          <span className={styles.swatch} data-part="remaining" aria-hidden="true" />
          Remaining <strong className="tnum">{usd(budget.remainingMicroUsd)}</strong>
        </li>
      </ul>
    </div>
  );
}

function BudgetPanel({ budget, releasePhrase, call, refresh }: { budget: Budget; releasePhrase: string | null; call: (p: string, b?: unknown) => Promise<Reply>; refresh: () => Promise<void> }) {
  const [total, setTotal] = useState("");
  const [daily, setDaily] = useState("");
  const [phrase, setPhrase] = useState("");
  const [message, setMessage] = useState("");
  const [released, setReleased] = useState("");
  const PHRASE = "I authorize this spending";
  // a switch that money tripped is released only by saying, in words, that the charge was looked at
  const needsWords = budget.killSwitch && releasePhrase !== null;
  return (
    <section className={styles.panel} data-testid="budget-panel">
      <h2>Budget</h2>
      <p className={styles.hero}>
        <span className="tnum" data-testid="authorized">
          {usd(budget.authorizedMicroUsd)}
        </span>{" "}
        <small>authorized in total · {usd(budget.dailyCapMicroUsd)} a day</small>
      </p>
      <p className={styles.small} data-testid="ceiling">
        {budget.ceilingMicroUsd > 0
          ? `This deployment's ceiling is ${usd(budget.ceilingMicroUsd)}: no more than that can ever be authorized from this page. It is set where the application is deployed (BUDGET_CEILING_USD), not here.`
          : "This deployment has no ceiling set (BUDGET_CEILING_USD), so nothing can be authorized from this page."}
      </p>
      <Meter budget={budget} />
      <p className={styles.small}>
        Today ({budget.today.day}, UTC): {usd(budget.today.settledMicroUsd)} spent, {usd(budget.today.reservedMicroUsd)} held, {usd(budget.today.remainingMicroUsd)} left of the day&apos;s allowance.
        {budget.overageMicroUsd > 0 ? ` Overage beyond reservations: ${usd(budget.overageMicroUsd)}.` : ""}
      </p>

      <div className={styles.kill} data-on={budget.killSwitch} data-testid="kill-state">
        <div>
          <strong>{budget.killSwitch ? "Kill switch is ON" : "Kill switch is off"}</strong>
          <span>{budget.killSwitch ? `No paid call can be reserved. (${budget.killReason})` : "Approved runs may reserve and spend, inside their caps."}</span>
        </div>
        <button
          type="button"
          data-testid="kill-toggle"
          className={budget.killSwitch ? styles.quiet : styles.danger}
          disabled={needsWords && released !== releasePhrase}
          onClick={async () => {
            await call("/api/owner/kill", { on: !budget.killSwitch, ...(needsWords ? { confirm: released } : {}) });
            setReleased("");
            await refresh();
          }}
        >
          {budget.killSwitch ? "Release the switch" : "Stop all spending"}
        </button>
      </div>
      {needsWords ? (
        <label className={styles.field} data-testid="release-words">
          <span>
            A request cost more than was held for it, and that turned the switch on. Look at what the provider charged; then type <em>{releasePhrase}</em> to release it.
          </span>
          <input data-testid="release-phrase" value={released} onChange={(e) => setReleased(e.target.value)} autoComplete="off" />
        </label>
      ) : null}

      <details className={styles.details}>
        <summary>Change the authorization</summary>
        <form
          className={styles.form}
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await call("/api/owner/budget", { authorizedUsd: Number(total), dailyCapUsd: Number(daily), confirm: phrase });
            if (r.status === 200) {
              setMessage("Recorded.");
              setPhrase("");
              await refresh();
            } else setMessage(String(r.data.message ?? r.data.error ?? `refused (${r.status})`));
          }}
        >
          <p className={styles.small}>This is the most the application may ever spend through this ledger, and the most in one UTC day. It cannot cap what other programs do with the same key: set a workspace spend limit at the provider as well.</p>
          <div className={styles.row}>
            <label className={styles.field}>
              <span>Total, in dollars</span>
              <input data-testid="budget-total" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="2" required />
            </label>
            <label className={styles.field}>
              <span>Per day, in dollars</span>
              <input data-testid="budget-daily" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} placeholder="2" required />
            </label>
          </div>
          <label className={styles.field}>
            <span>
              Type <em>{PHRASE}</em> to confirm
            </span>
            <input data-testid="budget-phrase" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" />
          </label>
          <button data-testid="budget-submit" type="submit" className={styles.primary} disabled={phrase !== PHRASE || total === "" || daily === ""}>
            Authorize
          </button>
          {message ? <p role="status">{message}</p> : null}
        </form>
      </details>
    </section>
  );
}

function UnknownPanel({ items, call, refresh }: { items: Unknown[]; call: (p: string, b?: unknown) => Promise<Reply>; refresh: () => Promise<void> }) {
  return (
    <section className={styles.panel} data-testid="unknown-panel">
      <h2>Calls whose outcome is unknown</h2>
      <p>These requests were sent and never answered (a timeout, a lost connection). They may have been billed. Their money stays held until you check the provider&apos;s own usage page and decide.</p>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Request</th>
              <th scope="col">Held</th>
              <th scope="col">What happened</th>
              <th scope="col">Your decision</th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id}>
                <td className={styles.mono}>{u.id}</td>
                <td className="tnum">{usd(u.reservedMicroUsd)}</td>
                <td>{u.note || "no outcome recorded"}</td>
                <td className={styles.actions}>
                  <button
                    type="button"
                    className={styles.quiet}
                    onClick={async () => {
                      await call("/api/owner/reconcile", { id: u.id, action: "settle_full" });
                      await refresh();
                    }}
                  >
                    Count it as spent
                  </button>
                  <button
                    type="button"
                    className={styles.quiet}
                    onClick={async () => {
                      await call("/api/owner/reconcile", { id: u.id, action: "release" });
                      await refresh();
                    }}
                  >
                    It was not billed
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const APPROVE = "I approve this run and its cap";

function NewRun({ live, budget, call, refresh }: { live: Live; budget: Budget; call: (p: string, b?: unknown) => Promise<Reply>; refresh: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [scenario, setScenario] = useState("first_light");
  const [seed, setSeed] = useState("1");
  const [population, setPopulation] = useState("24");
  const [share, setShare] = useState("100");
  const [institutions, setInstitutions] = useState("open");
  const [provider, setProvider] = useState("mock");
  const [scheduler, setScheduler] = useState("voi");
  const [callsPerEpoch, setCallsPerEpoch] = useState("8");
  const [perDay, setPerDay] = useState("3");
  const [epochs, setEpochs] = useState("16");
  const [epochTicks, setEpochTicks] = useState("24");
  const [context, setContext] = useState("rich");
  const [effort, setEffort] = useState("low");
  const [maxTokens, setMaxTokens] = useState("2000");
  const [cap, setCap] = useState("");
  const [early, setEarly] = useState(false);
  const [phrase, setPhrase] = useState("");
  // a preview and a message belong to the exact plan they were made for; change the plan and they are gone
  const [shown, setShown] = useState<{ key: string; preview: Preview | null; message: string }>({ key: "", preview: null, message: "" });

  const payload = useMemo(
    () => ({
      title,
      world: { scenario, seed: Number(seed), overrides: { population: Number(population), externalShare: provider === "baseline" ? 0 : Math.round(Number(share) * 10), institutions, cadence: Number(epochTicks) } },
      spec: { provider, scheduler: { kind: scheduler, callsPerEpoch: Number(callsPerEpoch), maxPerAgentPerDay: Number(perDay), starveAfterEpochs: 12 }, epochTicks: Number(epochTicks), epochs: Number(epochs), context, effort, maxTokens: Number(maxTokens), timeoutMs: 120_000, concurrency: 4, maxAttempts: 2 },
    }),
    [title, scenario, seed, population, share, institutions, provider, scheduler, callsPerEpoch, perDay, epochs, epochTicks, context, effort, maxTokens],
  );
  const key = JSON.stringify(payload);
  const preview = shown.key === key ? shown.preview : null;
  const message = shown.key === key ? shown.message : "";
  const setPreview = (p: Preview | null): void => setShown((cur) => ({ key, preview: p, message: cur.key === key ? cur.message : "" }));
  const setMessage = (m: string): void => setShown((cur) => ({ key, preview: cur.key === key ? cur.preview : null, message: m }));

  const paid = provider === "anthropic";
  const capMicro = Math.round(Number(cap || "0") * 1_000_000);
  const fits = preview ? preview.worstCaseMicroUsd <= capMicro : false;

  return (
    <section className={styles.panel} data-testid="newrun-panel">
      <h2>New run</h2>
      <form
        className={styles.form}
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await call("/api/runs", { ...payload, capUsd: paid ? Number(cap) : 0, allowEarlyStop: early, ...(paid ? { confirm: phrase } : {}) });
          if (r.status === 200) {
            setMessage("Created. It will not advance until you press Advance below.");
            setPhrase("");
            await refresh();
          } else setMessage(String(r.data.message ?? r.data.error ?? `refused (${r.status})`));
        }}
      >
        <fieldset className={styles.group}>
          <legend>The world</legend>
          <label className={styles.field}>
            <span>Title</span>
            <input data-testid="run-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="for your own reference" />
          </label>
          <div className={styles.row}>
            <label className={styles.field}>
              <span>Scenario</span>
              <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
                {SCENARIOS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Seed</span>
              <input data-testid="run-seed" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value)} />
            </label>
            <label className={styles.field}>
              <span>People</span>
              <input data-testid="run-population" inputMode="numeric" value={population} onChange={(e) => setPopulation(e.target.value)} />
            </label>
          </div>
          <div className={styles.row}>
            <label className={styles.field}>
              <span>Share of people decided for by the provider, %</span>
              <input inputMode="numeric" value={share} onChange={(e) => setShare(e.target.value)} disabled={provider === "baseline"} />
            </label>
            <label className={styles.field}>
              <span>Agreements</span>
              <select value={institutions} onChange={(e) => setInstitutions(e.target.value)}>
                <option value="open">may be written by anyone</option>
                <option value="grammar_search">also searched for by planner minds</option>
                <option value="off">do not exist</option>
              </select>
            </label>
          </div>
        </fieldset>

        <fieldset className={styles.group}>
          <legend>The minds</legend>
          <div className={styles.row}>
            <label className={styles.field}>
              <span>Provider</span>
              <select data-testid="run-provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
                <option value="mock">Mock minds — a test double, free</option>
                <option value="baseline">Baseline — the engine&apos;s own policies, free</option>
                <option value="anthropic" disabled={!live.available}>
                  {live.available ? `Live — ${live.model}, paid` : "Live — unavailable on this deployment"}
                </option>
              </select>
            </label>
            <label className={styles.field}>
              <span>Who is asked to think</span>
              <select value={scheduler} onChange={(e) => setScheduler(e.target.value)}>
                <option value="voi">those for whom it matters most</option>
                <option value="event">those something has happened to</option>
                <option value="round_robin">everyone in turn</option>
              </select>
            </label>
          </div>
          <div className={styles.row}>
            <label className={styles.field}>
              <span>Most minds asked per epoch</span>
              <input inputMode="numeric" value={callsPerEpoch} onChange={(e) => setCallsPerEpoch(e.target.value)} />
            </label>
            <label className={styles.field}>
              <span>Most times one mind is asked per day</span>
              <input inputMode="numeric" value={perDay} onChange={(e) => setPerDay(e.target.value)} />
            </label>
            <label className={styles.field}>
              <span>Epochs</span>
              <input data-testid="run-epochs" inputMode="numeric" value={epochs} onChange={(e) => setEpochs(e.target.value)} />
            </label>
            <label className={styles.field}>
              <span>Ticks per epoch (96 = a day)</span>
              <input inputMode="numeric" value={epochTicks} onChange={(e) => setEpochTicks(e.target.value)} />
            </label>
          </div>
          <div className={styles.row}>
            <label className={styles.field}>
              <span>What a mind is shown</span>
              <select value={context} onChange={(e) => setContext(e.target.value)}>
                <option value="rich">rich: with temperament, memories and its record of others</option>
                <option value="minimal">minimal: body, surroundings, speech, actions</option>
              </select>
            </label>
            <label className={styles.field}>
              <span>Effort</span>
              <select value={effort} onChange={(e) => setEffort(e.target.value)} disabled={!paid}>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </label>
            <label className={styles.field}>
              <span>Output limit per call, tokens</span>
              <input inputMode="numeric" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} disabled={!paid} />
            </label>
          </div>
        </fieldset>

        <div className={styles.actions}>
          <button
            type="button"
            data-testid="run-preview"
            className={styles.quiet}
            onClick={async () => {
              const r = await call("/api/runs/preview", payload);
              if (r.status === 200) {
                setPreview(r.data.preview as Preview);
                setMessage("");
              } else {
                setPreview(null);
                setMessage(String(r.data.message ?? r.data.error ?? `refused (${r.status})`));
              }
            }}
          >
            Preview the cost
          </button>
        </div>

        {preview ? (
          <div className={styles.preview} data-testid="preview">
            <h3>Upper bound for this plan</h3>
            <p className={styles.hero}>
              <span className="tnum" data-testid="preview-worst">
                {usd(preview.worstCaseMicroUsd)}
              </span>{" "}
              <small>
                at most {preview.callsPlanned} calls for {preview.externalAgents} minds
              </small>
            </p>
            {preview.paid ? (
              <>
                <p className={styles.small}>
                  Each call is reserved at {usd(preview.perCallMicroUsd)}: every one of up to {preview.inputTokenBound.toLocaleString("en-US")} input tokens at the cache-write price, all {preview.maxTokens.toLocaleString("en-US")} output tokens (thinking is billed as output), plus a 10% regional margin. No cache hit is assumed. Unused reservation is returned as each call settles.
                </p>
                <p className={styles.small}>
                  {preview.measured ? `Measured so far on ${preview.model}: ${preview.measured.calls} settled calls, ${usd(preview.measured.meanMicroUsd)} on average, ${usd(preview.measured.maxMicroUsd)} at most.` : `No call to ${preview.model} has been settled through this ledger yet, so there is no measured cost to show — only the bound.`}
                </p>
              </>
            ) : (
              <p className={styles.small}>This provider makes no paid calls.</p>
            )}
          </div>
        ) : null}

        {paid ? (
          <fieldset className={styles.group}>
            <legend>Approval</legend>
            <p className={styles.small}>
              Remaining of the authorized budget: {usd(budget.remainingMicroUsd)}. The run can never spend more than its cap; calls stop the moment a reservation would exceed it.
            </p>
            <div className={styles.row}>
              <label className={styles.field}>
                <span>Cap for this run, in dollars</span>
                <input data-testid="run-cap" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="2" />
              </label>
              <label className={styles.check}>
                <input type="checkbox" checked={early} onChange={(e) => setEarly(e.target.checked)} />
                <span>Let the run pause when the cap is reached, even if the plan&apos;s upper bound is higher</span>
              </label>
            </div>
            {preview && !fits && !early ? <p className={styles.alert}>The plan&apos;s upper bound is above this cap. Lower the plan, raise the cap, or tick the box.</p> : null}
            <label className={styles.field}>
              <span>
                Type <em>{APPROVE}</em> to approve
              </span>
              <input data-testid="run-phrase" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" />
            </label>
          </fieldset>
        ) : null}

        <div className={styles.actions}>
          <button data-testid="run-create" type="submit" className={styles.primary} disabled={paid && (!preview || phrase !== APPROVE || !(Number(cap) > 0))}>
            {paid ? "Approve and create" : "Create"}
          </button>
          {message ? (
            <p role="status" data-testid="run-message">
              {message}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function Runs({ runs, call, refresh }: { runs: RunView[]; call: (p: string, b?: unknown) => Promise<Reply>; refresh: () => Promise<void> }) {
  const [stepping, setStepping] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const stop = useRef(false);

  const advance = async (run: RunView): Promise<void> => {
    stop.current = false;
    setStepping(run.id);
    for (let i = 0; i < 100_000 && !stop.current; i++) {
      const r = await call(`/api/runs/${run.id}/step`, {});
      const state = String(r.data.state ?? r.data.error ?? r.status);
      const reason = String(r.data.reason ?? r.data.message ?? "");
      setNote((n) => ({ ...n, [run.id]: state === "committed" || state === "partial" ? `epoch ${Number(r.data.epoch ?? 0) + (state === "committed" ? 1 : 0)} of ${run.spec.epochs}` : `${state}${reason ? ` — ${REASONS[reason] ?? reason}` : ""}` }));
      await refresh();
      if (state === "busy") await new Promise((res) => setTimeout(res, 1500));
      else if (state !== "committed" && state !== "partial") break;
    }
    setStepping(null);
  };
  const control = async (id: string, action: string): Promise<void> => {
    const r = await call(`/api/runs/${id}/control`, { action });
    if (r.status !== 200) setNote((n) => ({ ...n, [id]: String(r.data.error ?? r.status) }));
    await refresh();
  };

  return (
    <section className={styles.panel} data-testid="runs-panel">
      <h2>Runs</h2>
      {runs.length === 0 ? <p className={styles.muted}>None yet.</p> : null}
      <ul className={styles.runs}>
        {runs.map((run) => (
          <li key={run.id} className={styles.run} data-testid="run" data-status={run.status}>
            <div className={styles.runHead}>
              <div>
                <h3>{run.title || "Untitled run"}</h3>
                <p className={styles.small}>
                  <span className={styles.mono}>{run.id}</span> · {run.config.scenario.replace(/_/g, " ")}, seed {run.config.seed}, {run.config.population} people · {run.provider === "anthropic" ? `LIVE · ${run.model}` : run.provider === "mock" ? "MOCK minds" : "BASELINE"}
                </p>
              </div>
              <p className={styles.badge} data-status={run.status} data-testid="run-status">
                {run.status}
                {run.published ? " · published" : ""}
              </p>
            </div>
            <div className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={run.spec.epochs} aria-valuenow={run.epoch} aria-label="Epochs completed">
              <span style={{ width: `${(run.epoch / Math.max(1, run.spec.epochs)) * 100}%` }} />
            </div>
            <p className={styles.small}>
              <span data-testid="run-progress">
                Epoch {run.epoch} of {run.spec.epochs}
              </span>{" "}
              · day {(run.tick / 96).toFixed(1)}
              {run.capMicroUsd > 0 ? ` · spent ${usd(run.settledMicroUsd)}, held ${usd(run.reservedMicroUsd)}, cap ${usd(run.capMicroUsd)}` : " · no cost"}
              {run.statusReason ? ` · ${REASONS[run.statusReason] ?? run.statusReason}` : ""}
              {note[run.id] ? ` · ${note[run.id]}` : ""}
            </p>
            <div className={styles.actions}>
              {run.status === "active" && stepping !== run.id ? (
                <button type="button" data-testid="run-advance" className={styles.primary} onClick={() => void advance(run)} disabled={stepping !== null}>
                  Advance
                </button>
              ) : null}
              {stepping === run.id ? (
                <button type="button" className={styles.quiet} onClick={() => (stop.current = true)}>
                  Stop after this step
                </button>
              ) : null}
              {run.status === "active" ? (
                <button type="button" className={styles.quiet} onClick={() => void control(run.id, "pause")}>
                  Pause
                </button>
              ) : null}
              {run.status === "paused" ? (
                <button type="button" className={styles.quiet} onClick={() => void control(run.id, "resume")}>
                  Resume
                </button>
              ) : null}
              {run.status === "active" || run.status === "paused" ? (
                <button type="button" className={styles.quiet} onClick={() => void control(run.id, "cancel")}>
                  Cancel
                </button>
              ) : null}
              {run.epoch > 0 ? (
                <a className={styles.link} data-testid="run-watch" href={`/?recording=${encodeURIComponent(run.id)}`}>
                  Watch
                </a>
              ) : null}
              {run.epoch > 0 ? (
                <button type="button" data-testid="run-publish" className={styles.quiet} onClick={() => void control(run.id, run.published ? "unpublish" : "publish")}>
                  {run.published ? "Unpublish" : "Publish the recording"}
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AuditPanel({ entries }: { entries: { at: string; actor: string; action: string; detail: string }[] }) {
  return (
    <section className={styles.panel}>
      <details className={styles.details}>
        <summary>Audit log (last {entries.length})</summary>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">When (UTC)</th>
                <th scope="col">Who</th>
                <th scope="col">What</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={`${e.at}-${i}`}>
                  <td className="tnum">{e.at.slice(0, 19).replace("T", " ")}</td>
                  <td>{e.actor}</td>
                  <td>{e.action}</td>
                  <td className={styles.mono}>{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
