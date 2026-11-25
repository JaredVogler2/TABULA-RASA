import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorld, makeConfig } from "@/engine";
import { MockProvider } from "@/providers/mock";
import { DEFAULT_SPEC, verifyTape, type EpochResult } from "@/providers/run";
import type { CallResult, DecisionCall, Provider } from "@/providers/types";
import { memoryDb } from "../../tests/support/db";
import * as api from "./api";
import { hashPassphrase } from "./auth";
import type { Db } from "./db";
import { forgetMemoryLimits } from "./http";

const ORIGIN = "https://tabula.example";
const PASSPHRASE = "the owner's long passphrase";
const SECRETS = { ANTHROPIC_API_KEY: "sk-ant-api03-SENTINEL-KEY-0123456789", AUTH_SECRET: "auth-SENTINEL-0123456789abcdef0123456789abcdef", DATABASE_URL: "postgres://user:SENTINEL-PW@db.internal/prod" };

class FakePaid implements Provider {
  readonly id = "anthropic" as const;
  readonly model = "claude-fable-5-2";
  readonly paid = true;
  calls = 0;
  private readonly inner = new MockProvider();
  reserveFor(): number {
    return 90_000;
  }
  async decide(call: DecisionCall): Promise<CallResult> {
    this.calls++;
    return { ...(await this.inner.decide(call)), model: this.model, costMicroUsd: 21_000, requestId: "req_fake", usage: { input_tokens: 900, output_tokens: 250, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation_5m: 0, cache_creation_1h: 0, inference_geo: "global", speed: "standard", service_tier: "standard", thinking_tokens: 80 } };
  }
}

describe("the owner API", () => {
  let db: Db;
  let hash: string;
  let env: Record<string, string | undefined>;
  let now = Date.parse("2026-12-01T10:00:00Z");
  let providerRequests = 0;
  let dbRequests = 0;
  let paid: FakePaid;
  let deps: api.Deps;
  const bodies: string[] = [];
  // everything the server writes to its log during these tests
  const logged: string[] = [];

  const request = (path: string, init: { method?: string; body?: unknown; cookie?: string; csrf?: string; origin?: string | null; ip?: string; type?: string; raw?: string } = {}): Request => {
    const headers: Record<string, string> = { host: "tabula.example", "x-forwarded-proto": "https", "x-forwarded-for": init.ip ?? "203.0.113.5" };
    const method = init.method ?? (init.body !== undefined || init.raw !== undefined ? "POST" : "GET");
    if (method !== "GET" && init.origin !== null) headers.origin = init.origin ?? ORIGIN;
    if (init.cookie) headers.cookie = init.cookie;
    if (init.csrf) headers["x-csrf-token"] = init.csrf;
    if (init.body !== undefined || init.raw !== undefined) headers["content-type"] = init.type ?? "application/json";
    return new Request(`${ORIGIN}${path}`, { method, headers, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : init.raw !== undefined ? { body: init.raw } : {}) });
  };
  const read = async (r: Response): Promise<{ status: number; data: Record<string, unknown>; cookie: string | null; cookies: string[] }> => {
    const text = await r.text();
    bodies.push(text + JSON.stringify([...r.headers]));
    const cookies = r.headers.getSetCookie();
    return { status: r.status, data: JSON.parse(text) as Record<string, unknown>, cookie: cookies[0] ?? null, cookies };
  };
  const signIn = async (ip = "198.51.100.1"): Promise<{ cookie: string; csrf: string; device: string }> => {
    const r = await read(await api.login(request("/api/owner/login", { body: { passphrase: PASSPHRASE }, ip }), deps));
    expect(r.status).toBe(200);
    return { cookie: (r.cookie as string).split(";")[0] as string, csrf: r.data.csrf as string, device: (r.cookies[1] ?? "").split(";")[0] as string };
  };
  const counts = async (): Promise<string> => {
    const out: string[] = [];
    for (const t of ["runs", "calls", "epochs", "reservations"]) out.push(`${t}:${(await db.query(`SELECT COUNT(*) AS n FROM ${t}`))[0]!.n}`);
    const [b] = await db.query("SELECT authorized_microusd, kill_switch FROM budget WHERE id = 1");
    return `${out.join(",")},budget:${b!.authorized_microusd}:${b!.kill_switch}`;
  };

  beforeAll(async () => {
    db = await memoryDb();
    hash = await hashPassphrase(PASSPHRASE);
    for (const level of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await db.close();
  });
  beforeEach(async () => {
    for (const t of ["calls", "epochs", "reservations", "daily_spend", "runs", "audit_log", "rate_limits"]) await db.query(`DELETE FROM ${t}`);
    await db.query("UPDATE budget SET authorized_microusd = 0, daily_cap_microusd = 0, reserved_microusd = 0, settled_microusd = 0, overage_microusd = 0, kill_switch = true, kill_reason = 'never enabled', kill_code = '', session_epoch = 0 WHERE id = 1");
    forgetMemoryLimits();
    now = Date.parse("2026-12-01T10:00:00Z");
    // as deployed: on the platform that overwrites the forwarding header, with a ceiling of two hundred dollars
    env = { OWNER_PASSWORD_HASH: hash, AUTH_SECRET: SECRETS.AUTH_SECRET, NODE_ENV: "production", VERCEL: "1", BUDGET_CEILING_USD: "200" };
    providerRequests = 0;
    dbRequests = 0;
    paid = new FakePaid();
    process.env.AUTH_SECRET = SECRETS.AUTH_SECRET; // the gate reads the signing secret from the process environment
    deps = {
      db: async () => {
        dbRequests++;
        return db;
      },
      env,
      now: () => now,
      provider: (run) => {
        providerRequests++;
        return run.provider === "anthropic" ? { ok: true, provider: paid } : { ok: true, provider: new MockProvider() };
      },
    };
  });

  const WORLD = { scenario: "first_light", seed: 77, overrides: { population: 8, externalShare: 1000, illness: 0, institutions: "open" } };
  const SPEC = { ...DEFAULT_SPEC, epochs: 2, scheduler: { ...DEFAULT_SPEC.scheduler, kind: "round_robin", callsPerEpoch: 8, maxPerAgentPerDay: 8 } };

  it("signs the owner in with the passphrase, and slows down anyone guessing it", async () => {
    expect((await read(await api.login(request("/api/owner/login", { body: { passphrase: "wrong" } }), deps))).status).toBe(401);
    expect((await read(await api.login(request("/api/owner/login", { body: { passphrase: PASSPHRASE }, origin: "https://evil.example" }), deps))).status).toBe(403);
    expect((await read(await api.login(request("/api/owner/login", { body: {} }), deps))).status).toBe(401);
    const ok = await read(await api.login(request("/api/owner/login", { body: { passphrase: PASSPHRASE }, ip: "198.51.100.2" }), deps));
    expect(ok.status).toBe(200);
    expect(ok.cookies).toHaveLength(2);
    expect(ok.cookies[0]).toMatch(/^__Host-tr_owner=v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+; Path=\/; HttpOnly; SameSite=Strict; Secure; Max-Age=43200$/);
    // and this browser is remembered as one the owner has signed in on (the cookie signs nobody in)
    expect(ok.cookies[1]).toMatch(/^__Host-tr_device=d1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+; Path=\/; HttpOnly; SameSite=Strict; Secure; Max-Age=15552000$/);
    expect(typeof ok.data.csrf).toBe("string");
    // five tries per address per quarter hour — after that even the right passphrase is turned away
    for (let i = 0; i < 3; i++) await api.login(request("/api/owner/login", { body: { passphrase: `guess ${i}` } }), deps);
    const blocked = await api.login(request("/api/owner/login", { body: { passphrase: PASSPHRASE } }), deps);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    // another address is not locked out, and the window turns
    expect((await api.login(request("/api/owner/login", { body: { passphrase: PASSPHRASE }, ip: "198.51.100.3" }), deps)).status).toBe(200);
    now += 16 * 60_000;
    expect((await api.login(request("/api/owner/login", { body: { passphrase: PASSPHRASE } }), deps)).status).toBe(200);
    // failures and successes are on the audit log, without the passphrase
    const log = await db.query("SELECT action, detail FROM audit_log ORDER BY id");
    expect(log.some((l) => l.action === "login.failed")).toBe(true);
    expect(JSON.stringify(log)).not.toContain(PASSPHRASE);
    // signing out clears the cookie
    expect((await api.logout(request("/api/owner/logout", { body: {} }), deps)).headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("one address hammering sign-in cannot lock the owner out, and strangers together cannot keep the owner off a device they have used", async () => {
    // the owner has signed in on this browser before
    const known = await signIn("198.51.100.20");
    expect(known.device).toMatch(/^__Host-tr_device=d1\./);
    const allCount = async (): Promise<number> => Number((await db.query("SELECT COALESCE(SUM(count), 0) AS n FROM rate_limits WHERE key = 'login:all'"))[0]!.n);
    const before = await allCount();
    // one address sends a hundred attempts in a quarter of an hour (no valid body is needed to try)
    let turnedAway = 0;
    for (let i = 0; i < 100; i++) {
      const r = await api.login(request("/api/owner/login", { body: { passphrase: `guess ${i}` }, ip: "203.0.113.66" }), deps);
      if (r.status === 429) turnedAway++;
      now += 50; // (three minutes in all: inside one window of the database's count)
    }
    expect(turnedAway).toBe(95);
    // only the five its own allowance let through were counted against everyone
    expect((await allCount()) - before).toBe(5);
    // …so the owner, from somewhere new, signs in
    expect((await api.login(request("/api/owner/login", { body: { passphrase: PASSPHRASE }, ip: "198.51.100.21" }), deps)).status).toBe(200);

    // now many addresses use up the shared count between them
    let n = 0;
    for (let a = 1; n < 60 && a < 60; a++) {
      for (let k = 0; k < 5; k++, n++) await api.login(request("/api/owner/login", { body: { passphrase: "guess" }, ip: `192.0.2.${a}` }), deps);
    }
    // a browser nobody has signed in on is turned away, right passphrase or not…
    const stranger = await api.login(request("/api/owner/login", { body: { passphrase: PASSPHRASE }, ip: "198.51.100.22" }), deps);
    expect(stranger.status).toBe(429);
    // …and the owner's own browser is not: it is counted by itself
    const owner = await read(await api.login(request("/api/owner/login", { body: { passphrase: PASSPHRASE }, ip: "198.51.100.23", cookie: known.device }), deps));
    expect(owner.status).toBe(200);
    expect(owner.cookies).toHaveLength(1); // it already has its device cookie
    // a known device is no way round the limit either: ten tries a quarter hour, then it waits like anyone
    for (let i = 0; i < 9; i++) await api.login(request("/api/owner/login", { body: { passphrase: "guess" }, cookie: known.device, ip: "198.51.100.23" }), deps);
    expect((await api.login(request("/api/owner/login", { body: { passphrase: PASSPHRASE }, cookie: known.device, ip: "198.51.100.23" }), deps)).status).toBe(429);
    // and a forged device cookie is no device: it is counted with the strangers
    expect((await api.login(request("/api/owner/login", { body: { passphrase: PASSPHRASE }, cookie: "__Host-tr_device=d1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", ip: "198.51.100.24" }), deps)).status).toBe(429);
  });

  it("signing out ends every copy of the session, and nobody but the owner can do it", async () => {
    const a = await signIn("198.51.100.30");
    const b = await signIn("198.51.100.31"); // the same owner, signed in somewhere else
    const copy = a.cookie; // …and a copy of the first cookie, taken off a shared machine
    const signedIn = async (cookie: string): Promise<boolean> => (await read(await api.status(request("/api/owner/status", { cookie }), deps))).data.signedIn === true;
    expect(await signedIn(a.cookie)).toBe(true);
    expect(await signedIn(b.cookie)).toBe(true);
    // a stranger's sign-out request, and one from another site, end nothing
    expect((await read(await api.logout(request("/api/owner/logout", { body: {} }), deps))).data).toEqual({ ok: true, everywhere: false });
    expect((await api.logout(request("/api/owner/logout", { body: {}, cookie: a.cookie, csrf: a.csrf, origin: "https://evil.example" }), deps)).status).toBe(403);
    expect((await read(await api.logout(request("/api/owner/logout", { body: {}, cookie: a.cookie }), deps))).data).toEqual({ ok: true, everywhere: false }); // no token
    expect(await signedIn(a.cookie)).toBe(true);
    // the owner signs out: every session there is has ended, at once
    const out = await read(await api.logout(request("/api/owner/logout", { body: {}, cookie: a.cookie, csrf: a.csrf }), deps));
    expect(out.data).toEqual({ ok: true, everywhere: true });
    expect(out.cookie).toContain("Max-Age=0");
    for (const cookie of [a.cookie, b.cookie, copy]) {
      expect(await signedIn(cookie)).toBe(false);
      expect((await read(await api.setKill(request("/api/owner/kill", { body: { on: false }, cookie, csrf: cookie === b.cookie ? b.csrf : a.csrf }), deps))).status).toBe(401);
    }
    expect((await db.query("SELECT kill_switch FROM budget WHERE id = 1"))[0]!.kill_switch).toBe(true);
    // signing in again is a new session under the new epoch, and works
    const again = await signIn("198.51.100.30");
    expect(await signedIn(again.cookie)).toBe(true);
    expect((await db.query("SELECT action FROM audit_log WHERE action = 'logout'")).length).toBe(1);
  });

  it("is unavailable when owner sign-in is not configured", async () => {
    env.OWNER_PASSWORD_HASH = undefined;
    expect((await api.login(request("/api/owner/login", { body: { passphrase: PASSPHRASE } }), deps)).status).toBe(503);
    expect((await read(await api.status(request("/api/owner/status"), deps))).data).toEqual({ signedIn: false, signInPossible: false });
  });

  it("tells a stranger nothing, and does not touch the database to do it", async () => {
    const r = await read(await api.status(request("/api/owner/status"), deps));
    expect(r.data).toEqual({ signedIn: false, signInPossible: true });
    expect(dbRequests).toBe(0);
  });

  it("no request without the owner's session, origin and token changes anything or reaches a provider", async () => {
    const { cookie, csrf } = await signIn();
    // a run the attacker would like to step, cancel or publish
    await api.setBudget(request("/api/owner/budget", { body: { authorizedUsd: 5, dailyCapUsd: 5, confirm: "I authorize this spending" }, cookie, csrf }), deps);
    const made = await read(await api.create(request("/api/runs", { body: { title: "target", world: WORLD, spec: { ...SPEC, provider: "mock" } }, cookie, csrf }), deps));
    const id = (made.data.run as { id: string }).id;
    providerRequests = 0;
    const before = await counts();

    const endpoints: [string, (r: Request) => Promise<Response>, unknown][] = [
      ["budget", (r) => api.setBudget(r, deps), { authorizedUsd: 200, dailyCapUsd: 200, confirm: "I authorize this spending" }],
      ["kill", (r) => api.setKill(r, deps), { on: false }],
      ["reconcile", (r) => api.reconcile(r, deps), { id: "x", action: "release" }],
      ["preview", (r) => api.preview(r, deps), { world: WORLD, spec: { ...SPEC, provider: "mock" } }],
      ["create", (r) => api.create(r, deps), { world: WORLD, spec: { ...SPEC, provider: "mock" } }],
      ["step", (r) => api.step(r, id, deps), {}],
      ["control", (r) => api.control(r, id, deps), { action: "cancel" }],
      ["publish", (r) => api.control(r, id, deps), { action: "publish" }],
    ];
    const attacks: [string, Parameters<typeof request>[1], number][] = [
      ["no session", { csrf }, 401],
      ["a session but no token", { cookie }, 403],
      ["a session and a wrong token", { cookie, csrf: "AAAA" }, 403],
      ["another site's page with the victim's cookie", { cookie, csrf, origin: "https://evil.example" }, 403],
      ["no Origin header", { cookie, csrf, origin: null }, 403],
      ["a forged session", { cookie: "__Host-tr_owner=v1.eyJ2IjoxfQ.AAAA", csrf }, 401],
    ];
    for (const [name, call, payload] of endpoints) {
      for (const [attack, init, status] of attacks) {
        const r = await read(await call(request(`/api/${name}`, { ...init, body: payload })));
        expect(r.status, `${name} / ${attack}`).toBe(status);
        expect(r.data.ok, `${name} / ${attack}`).toBe(false);
      }
    }
    expect(providerRequests).toBe(0);
    expect(await counts()).toBe(before);
    // an expired session is no session
    now += 13 * 60 * 60 * 1000;
    expect((await api.step(request(`/api/runs/${id}/step`, { body: {}, cookie, csrf }), id, deps)).status).toBe(401);
    expect(providerRequests).toBe(0);
    // reads: a stranger cannot see an unpublished run, the owner's status, or which runs exist
    now -= 13 * 60 * 60 * 1000;
    expect((await api.runView(request(`/api/runs/${id}`), id, deps)).status).toBe(404);
    expect((await read(await api.recordings(request("/api/recordings"), deps))).data.recordings).toEqual([]);
    expect((await read(await api.status(request("/api/owner/status"), deps))).data).toEqual({ signedIn: false, signInPossible: true });
  });

  it("runs a mock society end to end through the API, and the published record can be verified by anyone", async () => {
    const { cookie, csrf } = await signIn();
    const post = (path: string, body: unknown) => request(path, { body, cookie, csrf });
    const pre = await read(await api.preview(post("/api/runs/preview", { world: WORLD, spec: { ...SPEC, provider: "mock" } }), deps));
    expect(pre.data.preview).toMatchObject({ paid: false, worstCaseMicroUsd: 0, externalAgents: 8, callsPlanned: 16 });
    const made = await read(await api.create(post("/api/runs", { title: "First mock society", world: WORLD, spec: { ...SPEC, provider: "mock" } }), deps));
    expect(made.status).toBe(200);
    const id = (made.data.run as { id: string }).id;
    const states: string[] = [];
    for (let i = 0; i < 5; i++) {
      const s = await read(await api.step(post(`/api/runs/${id}/step`, {}), id, deps));
      states.push(s.data.state as string);
      if (s.data.state === "done") break;
    }
    expect(states).toEqual(["committed", "done"]);
    const view = await read(await api.runView(request(`/api/runs/${id}`, { cookie }), id, deps));
    expect(view.data.run).toMatchObject({ status: "done", epoch: 2, provider: "mock", capMicroUsd: 0 });
    expect((view.data.calls as { calls: number }).calls).toBeGreaterThan(0);
    // unpublished: invisible to strangers. Published: readable, with what a replay needs
    expect((await api.runView(request(`/api/runs/${id}`), id, deps)).status).toBe(404);
    expect((await read(await api.control(post(`/api/runs/${id}/control`, { action: "publish" }), id, deps))).status).toBe(200);
    const pub = await read(await api.runView(request(`/api/runs/${id}`), id, deps));
    expect(pub.status).toBe(200);
    const run = pub.data.run as { config: Parameters<typeof createWorld>[0]; provider: string };
    const epochs = pub.data.epochs as EpochResult[];
    expect(run.provider).toBe("mock");
    expect(verifyTape(createWorld(run.config), epochs.flatMap((e) => e.tape), epochs)).toBe(-1);
    expect(JSON.stringify(pub.data)).not.toMatch(/trace|outcomes|reservation/);
    // what a stranger is shown says how the run was made and nothing about money: no cap, no worst case, no early-stop choice
    expect(JSON.stringify(pub.data)).not.toMatch(/capMicroUsd|cap_microusd|[wW]orst|microusd|MicroUsd|allowEarlyStop|settled|reserved/);
    expect(Object.keys((pub.data.run as { manifest: Record<string, unknown> }).manifest).sort()).toEqual(["affordances", "configHash", "context", "effort", "engine", "epochTicks", "epochsPlanned", "externalAgents", "maxTokens", "model", "promptVersion", "provider", "sampling", "scenario", "scheduler", "schema", "seed", "wireVersion"]);
    expect((view.data.run as { manifest: Record<string, unknown> }).manifest).toHaveProperty("worstCaseMicroUsd"); // the owner still sees it
    expect((await read(await api.recordings(request("/api/recordings"), deps))).data.recordings).toMatchObject([{ id, title: "First mock society", provider: "mock", population: 8 }]);
    // a stranger's reads are counted in memory: they write nothing to the ledger's database
    const rows = async (): Promise<number> => Number((await db.query("SELECT COUNT(*) AS n FROM rate_limits WHERE key LIKE 'public:%'"))[0]!.n);
    expect(await rows()).toBe(0);
    for (let i = 0; i < 240; i++) await api.recordings(request("/api/recordings", { ip: "192.0.2.77" }), deps);
    expect((await api.recordings(request("/api/recordings", { ip: "192.0.2.77" }), deps)).status).toBe(429);
    expect((await api.runView(request(`/api/runs/${id}`, { ip: "192.0.2.77" }), id, deps)).status).toBe(429);
    expect((await api.runView(request(`/api/runs/${id}`, { ip: "192.0.2.78" }), id, deps)).status).toBe(200);
    expect(await rows()).toBe(0);
    // paging by epoch
    const tail = await read(await api.runView(request(`/api/runs/${id}?from=1`), id, deps));
    expect((tail.data.epochs as { epoch: number }[]).map((e) => e.epoch)).toEqual([1]);
    // …by a whole number, or the request is refused as a bad request: never passed to the database to fail there
    const errorsBefore = logged.length;
    for (const from of ["1.5", "1e999", "-1", "abc", "0x10", "1 OR 1=1", "99999999999999999999"]) {
      const bad = await read(await api.runView(request(`/api/runs/${id}?from=${encodeURIComponent(from)}`), id, deps));
      expect([bad.status, bad.data.error], from).toEqual([400, "invalid"]);
    }
    expect(logged.length).toBe(errorsBefore);
    expect((await api.runView(request(`/api/runs/${id}?from=`), id, deps)).status).toBe(200);
    // a finished run cannot be resumed or cancelled
    expect((await api.control(post(`/api/runs/${id}/control`, { action: "resume" }), id, deps)).status).toBe(409);
    expect((await api.control(post(`/api/runs/${id}/control`, { action: "explode" }), id, deps)).status).toBe(400);
    expect((await api.step(post("/api/runs/run_doesnotexist/step", {}), "run_doesnotexist", deps)).status).toBe(404);
    expect((await api.step(post("/api/runs/../etc/step", {}), "../etc", deps)).status).toBe(404);
  });

  it("spends nothing until the owner authorizes an amount, releases the switch and approves a run in words", async () => {
    const { cookie, csrf } = await signIn();
    const post = (path: string, body: unknown) => request(path, { body, cookie, csrf });
    const liveSpec = { ...SPEC, provider: "anthropic" };
    // live mode is not configured: there is nothing to approve
    expect((await read(await api.create(post("/api/runs", { world: WORLD, spec: liveSpec, capUsd: 1, confirm: "I approve this run and its cap", allowEarlyStop: true }), deps))).data).toMatchObject({ ok: false, error: "live_unavailable" });
    expect((await read(await api.preview(post("/api/runs/preview", { world: WORLD, spec: liveSpec }), deps))).data).toMatchObject({ ok: false, error: "live_unavailable" });
    Object.assign(env, { LIVE_ENABLED: "true", ANTHROPIC_API_KEY: SECRETS.ANTHROPIC_API_KEY, ANTHROPIC_MODEL: "claude-fable-5-2", DATABASE_URL: SECRETS.DATABASE_URL });
    // configured, but no money is authorized: zero is the default
    const pre = await read(await api.preview(post("/api/runs/preview", { world: WORLD, spec: liveSpec }), deps));
    expect(pre.data).toMatchObject({ ok: true, remainingMicroUsd: 0 });
    const worst = (pre.data.preview as { worstCaseMicroUsd: number }).worstCaseMicroUsd;
    expect(worst).toBeGreaterThan(0);
    expect((await read(await api.create(post("/api/runs", { world: WORLD, spec: liveSpec, capUsd: 1, confirm: "I approve this run and its cap", allowEarlyStop: true }), deps))).data).toMatchObject({ ok: false, error: "exceeds_budget" });
    // authorizing needs the words, not just the numbers
    expect((await read(await api.setBudget(post("/api/owner/budget", { authorizedUsd: 10, dailyCapUsd: 10 }), deps))).data).toMatchObject({ ok: false, error: "confirmation_required" });
    expect((await read(await api.setBudget(post("/api/owner/budget", { authorizedUsd: -1, dailyCapUsd: 1, confirm: "I authorize this spending" }), deps))).status).toBe(400);
    expect((await read(await api.setBudget(post("/api/owner/budget", { authorizedUsd: 1e9, dailyCapUsd: 1, confirm: "I authorize this spending" }), deps))).status).toBe(400);
    expect((await read(await api.setBudget(post("/api/owner/budget", { authorizedUsd: 10, dailyCapUsd: 10, confirm: "I authorize this spending" }), deps))).status).toBe(200);
    // so does approving the run
    expect((await read(await api.create(post("/api/runs", { world: WORLD, spec: liveSpec, capUsd: 6 }), deps))).data).toMatchObject({ ok: false, error: "confirmation_required" });
    const made = await read(await api.create(post("/api/runs", { title: "fake-paid", world: WORLD, spec: liveSpec, capUsd: 6, confirm: "I approve this run and its cap", allowEarlyStop: true }), deps));
    expect(made.status).toBe(200);
    const id = (made.data.run as { id: string }).id;
    // the switch is still on from the factory default: the run pauses without a single call
    const blocked = await read(await api.step(post(`/api/runs/${id}/step`, {}), id, deps));
    expect(blocked.data).toMatchObject({ state: "paused", reason: "kill_switch", calls: 0 });
    expect(paid.calls).toBe(0);
    expect((await read(await api.setKill(post("/api/owner/kill", { on: false, reason: "pilot approved" }), deps))).status).toBe(200);
    expect((await read(await api.control(post(`/api/runs/${id}/control`, { action: "resume" }), id, deps))).status).toBe(200);
    let last = "";
    for (let i = 0; i < 6 && last !== "done"; i++) last = (await read(await api.step(post(`/api/runs/${id}/step`, {}), id, deps))).data.state as string;
    expect(last).toBe("done");
    expect(paid.calls).toBeGreaterThan(0);
    const st = await read(await api.status(request("/api/owner/status", { cookie }), deps));
    expect(st.data.budget).toMatchObject({ authorizedMicroUsd: 10_000_000, settledMicroUsd: paid.calls * 21_000, reservedMicroUsd: 0, killSwitch: false });
    expect((st.data.live as { available: boolean; keyConfigured: boolean }).available).toBe(true);
    // the owner can stop everything at once
    expect((await read(await api.setKill(post("/api/owner/kill", { on: true }), deps))).status).toBe(200);
    expect(((await read(await api.status(request("/api/owner/status", { cookie }), deps))).data.budget as { killSwitch: boolean; killReason: string })).toMatchObject({ killSwitch: true, killReason: "stopped by the owner" });
    // the provider for a run must be the model it was approved for
    env.ANTHROPIC_MODEL = "claude-opus-5-5";
    const other = await read(await api.create(post("/api/runs", { world: WORLD, spec: liveSpec, capUsd: 1, confirm: "I approve this run and its cap", allowEarlyStop: true }), deps));
    expect(other.status).toBe(200);
    env.ANTHROPIC_MODEL = "claude-fable-5-2";
    const mismatch = api.realDeps.provider({ ...(other.data.run as Parameters<typeof api.realDeps.provider>[0]) }, env, now);
    expect(mismatch).toMatchObject({ ok: false, reason: "the configured model is not the model this run was approved for" });
  });

  it("the credential that spends cannot raise its own limit: the ceiling belongs to the deployment", async () => {
    const { cookie, csrf } = await signIn();
    const post = (path: string, body: unknown) => request(path, { body, cookie, csrf });
    const authorize = async (usd: number) => read(await api.setBudget(post("/api/owner/budget", { authorizedUsd: usd, dailyCapUsd: usd, confirm: "I authorize this spending" }), deps));
    const authorized = async (): Promise<number> => Number((await db.query("SELECT authorized_microusd FROM budget WHERE id = 1"))[0]!.authorized_microusd);
    // exactly what someone with a stolen session would send: the phrase is in the page's own script, the amount is theirs to choose
    const theft = await authorize(10_000);
    expect([theft.status, theft.data.error]).toEqual([409, "above_ceiling"]);
    expect(theft.data.message).toContain("BUDGET_CEILING_USD");
    expect(await authorized()).toBe(0);
    expect((await authorize(200.01)).data.error).toBe("above_ceiling");
    expect((await authorize(200)).status).toBe(200);
    expect(await authorized()).toBe(200_000_000);
    const st = await read(await api.status(request("/api/owner/status", { cookie }), deps));
    expect(st.data.budget).toMatchObject({ ceilingMicroUsd: 200_000_000, authorizedMicroUsd: 200_000_000 });
    // the deployment lowers its ceiling: what was authorized before no longer counts for more than it
    env.BUDGET_CEILING_USD = "50";
    expect(((await read(await api.status(request("/api/owner/status", { cookie }), deps))).data.budget as { remainingMicroUsd: number }).remainingMicroUsd).toBe(50_000_000);
    // …and with no ceiling at all nothing can be authorized, however the request is worded
    env.BUDGET_CEILING_USD = undefined;
    expect((await authorize(0.01)).data.error).toBe("above_ceiling");
    expect(((await read(await api.status(request("/api/owner/status", { cookie }), deps))).data.budget as { remainingMicroUsd: number }).remainingMicroUsd).toBe(0);
    // every refusal is on the record
    expect((await db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'budget.authorize_refused'"))[0]!.n).toBe(3);
  });

  it("a switch that money tripped is not released by a click, and what was overcharged counts from then on", async () => {
    const { cookie, csrf } = await signIn();
    const post = (path: string, body: unknown) => request(path, { body, cookie, csrf });
    Object.assign(env, { LIVE_ENABLED: "true", ANTHROPIC_API_KEY: SECRETS.ANTHROPIC_API_KEY, ANTHROPIC_MODEL: "claude-fable-5-2", DATABASE_URL: SECRETS.DATABASE_URL });
    await api.setBudget(post("/api/owner/budget", { authorizedUsd: 10, dailyCapUsd: 10, confirm: "I authorize this spending" }), deps);
    await api.setKill(post("/api/owner/kill", { on: false }), deps);
    const made = await read(await api.create(post("/api/runs", { world: WORLD, spec: { ...SPEC, provider: "anthropic", epochs: 1, concurrency: 1 }, capUsd: 6, confirm: "I approve this run and its cap", allowEarlyStop: true }), deps));
    const id = (made.data.run as { id: string }).id;
    // the provider reports a cost above what was held for the request (it never should)
    const inner = paid;
    let first = true;
    paid = Object.assign(Object.create(FakePaid.prototype) as FakePaid, inner, {
      decide: async (call: DecisionCall): Promise<CallResult> => {
        const r = await inner.decide(call);
        if (!first) return r;
        first = false;
        return { ...r, costMicroUsd: 250_000 };
      },
    });
    const stepped = await read(await api.step(post(`/api/runs/${id}/step`, {}), id, deps));
    expect(stepped.data).toMatchObject({ state: "paused", reason: "kill_switch" });
    const st = await read(await api.status(request("/api/owner/status", { cookie }), deps));
    expect(st.data.budget).toMatchObject({ killSwitch: true, killCode: "overage", overageMicroUsd: 160_000, settledMicroUsd: 90_000, remainingMicroUsd: 10_000_000 - 250_000 });
    expect(st.data.releasePhrase).toBe(api.RELEASE_PHRASE);
    // a click does not release it
    const click = await read(await api.setKill(post("/api/owner/kill", { on: false }), deps));
    expect([click.status, click.data.error]).toEqual([400, "confirmation_required"]);
    expect((await read(await api.setKill(post("/api/owner/kill", { on: false, confirm: "yes" }), deps))).status).toBe(400);
    expect(((await read(await api.status(request("/api/owner/status", { cookie }), deps))).data.budget as { killSwitch: boolean }).killSwitch).toBe(true);
    // the owner says they have looked at what the provider charged: then it is released
    expect((await read(await api.setKill(post("/api/owner/kill", { on: false, confirm: api.RELEASE_PHRASE }), deps))).status).toBe(200);
    const after = await read(await api.status(request("/api/owner/status", { cookie }), deps));
    expect(after.data.budget).toMatchObject({ killSwitch: false, killCode: "", remainingMicroUsd: 10_000_000 - 250_000 });
    expect(after.data.releasePhrase).toBeNull();
    // a switch the owner set themselves is released without the phrase, as before
    await api.setKill(post("/api/owner/kill", { on: true }), deps);
    expect((await read(await api.setKill(post("/api/owner/kill", { on: false }), deps))).status).toBe(200);
  });

  it("lets the owner settle the fate of a request whose outcome is unknown", async () => {
    const { cookie, csrf } = await signIn();
    const post = (path: string, body: unknown) => request(path, { body, cookie, csrf });
    Object.assign(env, { LIVE_ENABLED: "true", ANTHROPIC_API_KEY: SECRETS.ANTHROPIC_API_KEY, ANTHROPIC_MODEL: "claude-fable-5-2", DATABASE_URL: SECRETS.DATABASE_URL });
    await api.setBudget(post("/api/owner/budget", { authorizedUsd: 10, dailyCapUsd: 10, confirm: "I authorize this spending" }), deps);
    await api.setKill(post("/api/owner/kill", { on: false }), deps);
    const made = await read(await api.create(post("/api/runs", { world: WORLD, spec: { ...SPEC, provider: "anthropic", epochs: 1 }, capUsd: 6, confirm: "I approve this run and its cap", allowEarlyStop: true }), deps));
    const id = (made.data.run as { id: string }).id;
    let first = true;
    const inner = paid;
    paid = Object.assign(Object.create(FakePaid.prototype) as FakePaid, inner, {
      decide: async (call: DecisionCall): Promise<CallResult> => {
        if (first) {
          first = false;
          return { status: "unknown", decision: null, confidence: "", cites: [], text: null, usage: null, costMicroUsd: null, model: "claude-fable-5-2", requestId: null, stopReason: null, error: { code: "timeout", status: null, retryable: false, message: "" }, latencyMs: 60_000 };
        }
        return inner.decide(call);
      },
    });
    expect((await read(await api.step(post(`/api/runs/${id}/step`, {}), id, deps))).data.state).toBe("done");
    const st = await read(await api.status(request("/api/owner/status", { cookie }), deps));
    const unknown = st.data.unknown as { id: string; reservedMicroUsd: number }[];
    expect(unknown).toHaveLength(1);
    expect(st.data.budget).toMatchObject({ unknownCount: 1, unknownMicroUsd: 90_000 });
    expect((await read(await api.reconcile(post("/api/owner/reconcile", { id: unknown[0]!.id, action: "settle", amountUsd: 0.5 }), deps))).status).toBe(409); // more than was held
    expect((await read(await api.reconcile(post("/api/owner/reconcile", { id: unknown[0]!.id, action: "settle_full" }), deps))).status).toBe(200);
    expect((await read(await api.reconcile(post("/api/owner/reconcile", { id: unknown[0]!.id, action: "release" }), deps))).status).toBe(409); // already decided
    expect(((await read(await api.status(request("/api/owner/status", { cookie }), deps))).data.budget as { unknownCount: number }).unknownCount).toBe(0);
  });

  it("refuses bodies that are too large, not JSON, or not objects, and worlds outside the allowed knobs", async () => {
    const { cookie, csrf } = await signIn();
    expect((await api.create(request("/api/runs", { raw: JSON.stringify({ pad: "x".repeat(40_000) }), cookie, csrf }), deps)).status).toBe(413);
    expect((await api.create(request("/api/runs", { raw: "{}", type: "text/plain", cookie, csrf }), deps)).status).toBe(415);
    expect((await api.create(request("/api/runs", { raw: "[1,2,3]", cookie, csrf }), deps)).status).toBe(400);
    expect((await api.create(request("/api/runs", { raw: "{oops", cookie, csrf }), deps)).status).toBe(400);
    const bad = async (world: unknown, spec: unknown) => (await read(await api.create(request("/api/runs", { body: { world, spec }, cookie, csrf }), deps))).status;
    expect(await bad({ scenario: "no_such_place", seed: 1 }, { ...SPEC, provider: "mock" })).toBe(400);
    expect(await bad({ scenario: "first_light", seed: -4 }, { ...SPEC, provider: "mock" })).toBe(400);
    expect(await bad({ scenario: "first_light", seed: 1, overrides: { population: 100000, externalShare: 1000 } }, { ...SPEC, provider: "mock" })).toBe(400);
    expect(await bad(WORLD, { ...SPEC, provider: "openai" })).toBe(400);
    // knobs outside the allowed list are ignored rather than trusted
    const made = await read(await api.create(request("/api/runs", { body: { world: { ...WORLD, overrides: { ...WORLD.overrides, size: 128, shocks: "x", richness: 1 } }, spec: { ...SPEC, provider: "mock" } }, cookie, csrf }), deps));
    expect(made.status).toBe(200);
    expect((made.data.run as { config: { size: number; richness: number } }).config).toMatchObject({ size: makeConfig("first_light", 1).size, richness: makeConfig("first_light", 1).richness });
  });

  it("fails closed when the database cannot be reached", async () => {
    const { cookie, csrf } = await signIn();
    const down: api.Deps = { ...deps, db: async () => Promise.reject(Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2"), { code: "ECONNREFUSED" })) };
    for (const r of [await api.step(request("/api/runs/run_abcdef12/step", { body: {}, cookie, csrf }), "run_abcdef12", down), await api.setBudget(request("/api/owner/budget", { body: { authorizedUsd: 1, dailyCapUsd: 1, confirm: "I authorize this spending" }, cookie, csrf }), down), await api.login(request("/api/owner/login", { body: { passphrase: PASSPHRASE } }), down), await api.status(request("/api/owner/status", { cookie }), down)]) {
      const out = await read(r);
      expect(out.status).toBe(503);
      expect(out.data).toEqual({ ok: false, error: "database_unavailable" });
      expect(JSON.stringify(out.data)).not.toContain("hunter2");
    }
    expect(providerRequests).toBe(0);
    // the public list simply has nothing to show
    expect((await read(await api.recordings(request("/api/recordings"), down))).data).toEqual({ ok: true, recordings: [] });
  });

  it("never puts a secret in a response, in the audit log or in the server's own log", async () => {
    expect(bodies.length).toBeGreaterThan(40);
    const audit = JSON.stringify(await db.query("SELECT actor, action, detail FROM audit_log"));
    // the log is not empty: failures were logged, by code only
    expect(logged.some((l) => l.includes("database failed"))).toBe(true);
    for (const [where, text] of [["responses", bodies.join("\n")], ["audit log", audit], ["server log", logged.join("\n")]] as const) {
      for (const secret of [...Object.values(SECRETS), PASSPHRASE, hash, hash.split(":")[5] as string, "hunter2"]) expect(text, where).not.toContain(secret);
      expect(text, where).not.toMatch(/sk-ant-|postgres:\/\/|scrypt:/);
    }
  });
});
