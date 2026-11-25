import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorld, makeConfig } from "@/engine";
import { MockProvider } from "@/providers/mock";
import { DEFAULT_SPEC, verifyTape, type EpochResult } from "@/providers/run";
import type { CallResult, DecisionCall, Provider } from "@/providers/types";
import { memoryDb } from "../../tests/support/db";
import * as api from "./api";
import { hashPassphrase } from "./auth";
import type { Db } from "./db";

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
  const read = async (r: Response): Promise<{ status: number; data: Record<string, unknown>; cookie: string | null }> => {
    const text = await r.text();
    bodies.push(text + JSON.stringify([...r.headers]));
    return { status: r.status, data: JSON.parse(text) as Record<string, unknown>, cookie: r.headers.get("set-cookie") };
  };
  const signIn = async (ip = "198.51.100.1"): Promise<{ cookie: string; csrf: string }> => {
    const r = await read(await api.login(request("/api/owner/login", { body: { passphrase: PASSPHRASE }, ip }), deps));
    expect(r.status).toBe(200);
    return { cookie: (r.cookie as string).split(";")[0] as string, csrf: r.data.csrf as string };
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
    await db.query("UPDATE budget SET authorized_microusd = 0, daily_cap_microusd = 0, reserved_microusd = 0, settled_microusd = 0, overage_microusd = 0, kill_switch = true, kill_reason = 'never enabled' WHERE id = 1");
    now = Date.parse("2026-12-01T10:00:00Z");
    env = { OWNER_PASSWORD_HASH: hash, AUTH_SECRET: SECRETS.AUTH_SECRET, NODE_ENV: "production" };
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
    expect(ok.cookie).toMatch(/^__Host-tr_owner=v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+; Path=\/; HttpOnly; SameSite=Strict; Secure; Max-Age=43200$/);
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
    expect((await api.logout(request("/api/owner/logout", { body: {} }))).headers.get("set-cookie")).toContain("Max-Age=0");
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
    expect((await read(await api.recordings(request("/api/recordings"), deps))).data.recordings).toMatchObject([{ id, title: "First mock society", provider: "mock", population: 8 }]);
    // paging by epoch
    const tail = await read(await api.runView(request(`/api/runs/${id}?from=1`), id, deps));
    expect((tail.data.epochs as { epoch: number }[]).map((e) => e.epoch)).toEqual([1]);
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
