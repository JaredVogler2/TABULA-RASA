import "server-only";

/**
 * The owner API, as plain functions from a Request to a Response.
 *
 * Route files under src/app/api only forward to these. Every function that can change
 * anything, read anything private or cause a provider call starts with the same gate
 * (`ownerGate`), and nothing behind the gate runs if it refuses. Dependencies are passed
 * in so that the tests can stand in a database and a provider and prove that.
 *
 * Every function is wrapped (`safely`): whatever goes wrong inside one is logged by name and
 * code, never by message, and answered with a plain 500. Nothing a database or a library said
 * reaches a response.
 */
import { makeConfig, type WorldConfig } from "@/engine";
import { MockProvider } from "@/providers/mock";
import { PRICE_TABLE, usdToMicro } from "@/providers/prices";
import { BaselineProvider } from "@/providers/replay";
import { validateSpec, type RunSpec } from "@/providers/run";
import type { Provider } from "@/providers/types";
import { liveProvider } from "./anthropic";
import { DEVICE_TTL_MS, SESSION_TTL_MS, csrfToken, deviceCookie, deviceCookieName, issueDevice, issueSession, readCookie, readDevice, sessionCookie, verifyPassphrase } from "./auth";
import { getDb, num, type Db } from "./db";
import { CEILING_LIMIT_USD, anthropicKey, authSecret, budgetCeilingMicro, liveStatus, ownerAuthConfigured, ownerPasswordHash } from "./env";
import { BodyError, clientKey, isSecure, json, logFailure, memoryLimit, ownerSession, rateLimit, readJson, refuse, requireOwner, sameOrigin } from "./http";
import { Ledger, audit } from "./ledger";
import { callSummary, createRun, epochsOf, getRun, listRuns, previewRun, publishRun, setRunStatus, stepRun, type Run } from "./runs";

export interface Deps {
  db: () => Promise<Db>;
  env: Record<string, string | undefined>;
  now: () => number;
  /** The provider for a run, or the reason there is none. Called only after the gate has passed. */
  provider: (run: Run, env: Record<string, string | undefined>, now: number) => { ok: true; provider: Provider } | { ok: false; reason: string };
}

export const realDeps: Deps = {
  db: getDb,
  env: process.env,
  now: () => Date.now(),
  provider: (run, env, now) => {
    if (run.provider === "mock") return { ok: true, provider: new MockProvider() };
    if (run.provider === "baseline") return { ok: true, provider: new BaselineProvider() };
    if (run.provider !== "anthropic") return { ok: false, reason: "unknown provider" };
    const live = liveStatus(env, now);
    if (!live.available) return { ok: false, reason: live.reasons.join("; ") };
    if (live.model !== run.model) return { ok: false, reason: "the configured model is not the model this run was approved for" };
    return liveProvider(live.model, anthropicKey(env));
  },
};

/** What has to be typed to release a kill switch that money tripped. */
export const RELEASE_PHRASE = "I have checked what the provider charged";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The ledger for this deployment: it knows the ceiling the deployment was given, and the clock. */
const ledgerOf = (db: Db, deps: Deps): Ledger => new Ledger(db, { ceilingMicroUsd: budgetCeilingMicro(deps.env), clock: () => new Date(deps.now()) });

/** Run a handler; whatever it throws is logged by name and answered without detail. */
async function safely(where: string, handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (err) {
    logFailure(where, err);
    return refuse(500, "internal");
  }
}

async function database(deps: Deps): Promise<Db | Response> {
  try {
    return await deps.db();
  } catch (err) {
    logFailure("database", err);
    return refuse(503, "database_unavailable");
  }
}

async function body(request: Request, maxBytes?: number): Promise<Record<string, unknown> | Response> {
  try {
    const raw = await readJson(request, maxBytes);
    return isObj(raw) ? raw : refuse(400, "bad_json");
  } catch (err) {
    if (err instanceof BodyError) return refuse(err.status, err.code);
    throw err;
  }
}

const tooMany = (code: string, retryAfterSec: number): Response => refuse(429, code, undefined, { "retry-after": String(retryAfterSec) });

/** The session epoch: a session issued under an earlier one has been signed out. */
async function sessionEpoch(db: Db): Promise<number> {
  const [row] = await db.query("SELECT session_epoch FROM budget WHERE id = 1");
  if (!row) throw new Error("budget row is missing");
  return num(row.session_epoch);
}

/** Guard + rate limit + database for an owner endpoint. */
async function ownerGate(request: Request, deps: Deps, write: boolean): Promise<{ db: Db; actor: string; csrf: string; epoch: number } | Response> {
  const guard = requireOwner(request, write, deps.now(), deps.env);
  if (!guard.ok) return guard.response;
  const db = await database(deps);
  if (db instanceof Response) return db;
  // signing out ends every session: one issued before the last sign-out is no longer one
  const epoch = await sessionEpoch(db);
  if (guard.session.epoch !== epoch) return refuse(401, "not_signed_in");
  const limit = await rateLimit(db, `owner:${guard.session.sid}`, 600, 60, deps.now());
  if (!limit.ok) return tooMany("slow_down", limit.retryAfterSec);
  return { db, actor: `owner:${guard.session.sid.slice(0, 8)}`, csrf: csrfToken(guard.secret, guard.session), epoch };
}

// ───────────────────────── sign-in

export function login(request: Request, deps: Deps = realDeps): Promise<Response> {
  return safely("login", async () => {
    if (!sameOrigin(request)) return refuse(403, "cross_origin");
    if (!ownerAuthConfigured(deps.env)) return refuse(503, "owner_not_configured");
    const now = deps.now();
    const client = clientKey(request, deps.env);
    // the first brake costs nothing and reaches no database: a flood from one network stops here
    const flood = memoryLimit(`login:${client}`, 30, 60, now);
    if (!flood.ok) return tooMany("too_many_attempts", flood.retryAfterSec);
    const db = await database(deps);
    if (db instanceof Response) return db;
    const secret = authSecret(deps.env) as string;
    const secure = isSecure(request);
    // Guessing is slow for one network and for all of them together — and it is counted before
    // the passphrase is looked at. A device the owner has signed in on before is counted on its
    // own, so that strangers who use up the shared count cannot keep the owner out of it; and
    // the shared count takes only attempts their own network still had room for, so that one
    // network cannot use it up for everyone.
    const device = readDevice(secret, readCookie(request.headers.get("cookie"), deviceCookieName(secure)));
    if (device) {
      const own = await rateLimit(db, `login:device:${device}`, 10, 900, now);
      if (!own.ok) return tooMany("too_many_attempts", own.retryAfterSec);
    } else {
      const perClient = await rateLimit(db, `login:${client}`, 5, 900, now);
      if (!perClient.ok) return tooMany("too_many_attempts", perClient.retryAfterSec);
      const overall = await rateLimit(db, "login:all", 40, 900, now);
      if (!overall.ok) return tooMany("too_many_attempts", overall.retryAfterSec);
    }
    const b = await body(request, 2048);
    if (b instanceof Response) return b;
    const ok = await verifyPassphrase(b.passphrase, ownerPasswordHash(deps.env));
    if (!ok) {
      await audit(db, "anonymous", "login.failed", { client, knownDevice: device !== null }).catch((err: unknown) => logFailure("audit", err));
      return refuse(401, "wrong_passphrase");
    }
    const { session, cookie } = issueSession(secret, now, SESSION_TTL_MS, await sessionEpoch(db));
    await audit(db, `owner:${session.sid.slice(0, 8)}`, "login", { client, knownDevice: device !== null }).catch((err: unknown) => logFailure("audit", err));
    const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    headers.append("set-cookie", sessionCookie(cookie, secure, SESSION_TTL_MS / 1000));
    // this browser is now one the owner has signed in on (the cookie signs nobody in; see auth.ts)
    if (!device) headers.append("set-cookie", deviceCookie(issueDevice(secret).cookie, secure));
    return new Response(JSON.stringify({ ok: true, csrf: csrfToken(secret, session), expiresAt: session.expiresAt, deviceRememberedForDays: Math.round(DEVICE_TTL_MS / 86_400_000) }), { status: 200, headers });
  });
}

/**
 * Sign out. With a valid session and its token this ends every session there is (the epoch
 * moves on, and a copy of the cookie kept elsewhere stops working at once); without, it only
 * clears this browser's cookie, so that nobody else can sign the owner out.
 */
export function logout(request: Request, deps: Deps = realDeps): Promise<Response> {
  return safely("logout", async () => {
    if (!sameOrigin(request)) return refuse(403, "cross_origin");
    const secure = isSecure(request);
    let everywhere = false;
    const guard = requireOwner(request, true, deps.now(), deps.env);
    if (guard.ok) {
      const db = await database(deps);
      if (!(db instanceof Response)) {
        const moved = await db.query("UPDATE budget SET session_epoch = session_epoch + 1, updated_at = now() WHERE id = 1 AND session_epoch = $1 RETURNING session_epoch", [guard.session.epoch]);
        everywhere = moved.length > 0;
        if (everywhere) await audit(db, `owner:${guard.session.sid.slice(0, 8)}`, "logout", {}).catch((err: unknown) => logFailure("audit", err));
      }
    }
    return json({ ok: true, everywhere }, 200, { "set-cookie": sessionCookie("", secure, 0) });
  });
}

/**
 * What the owner console shows. Signed out, it says only whether sign-in is possible —
 * nothing about models, budgets or runs, and it touches no database.
 */
export function status(request: Request, deps: Deps = realDeps): Promise<Response> {
  return safely("status", async () => {
    const signedOut = (): Response => json({ signedIn: false, signInPossible: ownerAuthConfigured(deps.env) });
    const owner = ownerSession(request, deps.now(), deps.env);
    if (!owner) return signedOut();
    const gate = await ownerGate(request, deps, false);
    // a session that was signed out elsewhere is no session: the console shows the sign-in form
    if (gate instanceof Response) return gate.status === 401 ? signedOut() : gate;
    const ledger = ledgerOf(gate.db, deps);
    await ledger.sweep(15 * 60_000).catch((err: unknown) => logFailure("sweep", err));
    const [budget, runs, unknown, recent] = await Promise.all([ledger.summary(), listRuns(gate.db, 30), ledger.list("unknown", 50), gate.db.query("SELECT at::text AS at, actor, action, detail FROM audit_log ORDER BY id DESC LIMIT 30")]);
    return json({
      signedIn: true,
      csrf: gate.csrf,
      live: liveStatus(deps.env, deps.now()),
      budget,
      releasePhrase: budget.killCode === "overage" ? RELEASE_PHRASE : null,
      prices: { verifiedOn: PRICE_TABLE.verifiedOn, source: PRICE_TABLE.source, staleAfterDays: PRICE_TABLE.staleAfterDays, models: PRICE_TABLE.models },
      runs: runs.map(publicRun),
      unknown,
      audit: recent,
    });
  });
}

// ───────────────────────── money

export function setBudget(request: Request, deps: Deps = realDeps): Promise<Response> {
  return safely("budget", async () => {
    const gate = await ownerGate(request, deps, true);
    if (gate instanceof Response) return gate;
    const b = await body(request);
    if (b instanceof Response) return b;
    // authorizing spend is never a side effect: the request has to say so in words
    if (b.confirm !== "I authorize this spending") return refuse(400, "confirmation_required", 'send confirm: "I authorize this spending"');
    const total = b.authorizedUsd;
    const daily = b.dailyCapUsd;
    if (typeof total !== "number" || typeof daily !== "number" || !Number.isFinite(total) || !Number.isFinite(daily) || total < 0 || daily < 0 || total > CEILING_LIMIT_USD || daily > CEILING_LIMIT_USD) return refuse(400, "invalid_amount");
    const out = await ledgerOf(gate.db, deps).authorize(usdToMicro(total), usdToMicro(daily), gate.actor);
    if (out.ok) return json({ ok: true });
    const why: Record<string, string> = {
      below_committed: "that is less than what is already held or spent; use the kill switch to stop spending",
      // the ceiling belongs to the deployment: the credential that spends cannot raise its own limit
      above_ceiling: "that is more than this deployment may ever be authorized to spend. The ceiling (BUDGET_CEILING_USD) is set where the application is deployed, not here",
    };
    return refuse(409, out.reason, why[out.reason]);
  });
}

export function setKill(request: Request, deps: Deps = realDeps): Promise<Response> {
  return safely("kill", async () => {
    const gate = await ownerGate(request, deps, true);
    if (gate instanceof Response) return gate;
    const b = await body(request);
    if (b instanceof Response) return b;
    if (typeof b.on !== "boolean") return refuse(400, "invalid");
    const ledger = ledgerOf(gate.db, deps);
    if (!b.on) {
      // a switch that money tripped is not released by a click: the owner says they have looked
      const budget = await ledger.summary();
      if (budget.killCode === "overage" && b.confirm !== RELEASE_PHRASE) return refuse(400, "confirmation_required", `a request cost more than was held for it. Check what the provider charged, then send confirm: "${RELEASE_PHRASE}"`);
    }
    await ledger.setKillSwitch(b.on, typeof b.reason === "string" && b.reason.trim() ? b.reason : b.on ? "stopped by the owner" : "released by the owner", gate.actor);
    return json({ ok: true });
  });
}

export function reconcile(request: Request, deps: Deps = realDeps): Promise<Response> {
  return safely("reconcile", async () => {
    const gate = await ownerGate(request, deps, true);
    if (gate instanceof Response) return gate;
    const b = await body(request);
    if (b instanceof Response) return b;
    if (typeof b.id !== "string" || b.id.length > 200) return refuse(400, "invalid");
    const ledger = ledgerOf(gate.db, deps);
    let decision: { release: true } | { settleMicroUsd: number };
    if (b.action === "release") decision = { release: true };
    else if (b.action === "settle" && typeof b.amountUsd === "number" && Number.isFinite(b.amountUsd) && b.amountUsd >= 0 && b.amountUsd <= CEILING_LIMIT_USD) decision = { settleMicroUsd: usdToMicro(b.amountUsd) };
    else if (b.action === "settle_full") {
      const r = await ledger.get(b.id);
      if (!r) return refuse(404, "not_found");
      decision = { settleMicroUsd: r.reservedMicroUsd };
    } else return refuse(400, "invalid");
    const out = await ledger.reconcile(b.id, decision, gate.actor);
    return out === "done" ? json({ ok: true }) : refuse(409, out);
  });
}

// ───────────────────────── runs

/** A run as the owner is shown it: everything but the stored world. */
function publicRun(run: Run): Record<string, unknown> {
  return { ...run };
}

/** What of a run's manifest anyone may read: how it was made, and nothing about what it cost or could have cost. */
const OPEN_MANIFEST = ["engine", "schema", "affordances", "promptVersion", "wireVersion", "provider", "model", "seed", "scenario", "configHash", "scheduler", "context", "effort", "maxTokens", "epochTicks", "epochsPlanned", "externalAgents", "sampling"] as const;

function openManifest(manifest: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of OPEN_MANIFEST) if (key in manifest) out[key] = manifest[key];
  return out;
}

class Invalid extends Error {}

function configFrom(raw: unknown): WorldConfig {
  if (!isObj(raw)) throw new Invalid("a run needs a world");
  const scenario = typeof raw.scenario === "string" ? raw.scenario : "first_light";
  const seed = typeof raw.seed === "number" && Number.isInteger(raw.seed) && raw.seed >= 0 ? raw.seed : Number.NaN;
  if (Number.isNaN(seed)) throw new Invalid("the world needs a whole-number seed");
  const overrides = isObj(raw.overrides) ? raw.overrides : {};
  // only knobs a run may set; everything else keeps the scenario's value
  const allowed = ["population", "externalShare", "institutions", "cadence", "policy", "plannerShare", "spawn", "illness"] as const;
  const picked: Record<string, unknown> = {};
  for (const k of allowed) if (k in overrides) picked[k] = overrides[k];
  try {
    return makeConfig(scenario, seed, picked as Partial<WorldConfig>);
  } catch (err) {
    // the engine's own message about a configuration (it names a field and its range)
    throw new Invalid(err instanceof Error ? err.message.slice(0, 200) : "invalid world");
  }
}

function specFrom(raw: unknown): RunSpec {
  try {
    return validateSpec(raw);
  } catch (err) {
    throw new Invalid(err instanceof Error ? err.message.slice(0, 200) : "invalid run");
  }
}

export function preview(request: Request, deps: Deps = realDeps): Promise<Response> {
  return safely("preview", async () => {
    const gate = await ownerGate(request, deps, true);
    if (gate instanceof Response) return gate;
    const b = await body(request);
    if (b instanceof Response) return b;
    let cfg: WorldConfig;
    let spec: RunSpec;
    try {
      cfg = configFrom(b.world);
      spec = specFrom(b.spec);
    } catch (err) {
      // only what this application's own checks said is passed on; anything else is not a bad request
      if (err instanceof Invalid) return refuse(400, "invalid", err.message);
      throw err;
    }
    const live = liveStatus(deps.env, deps.now());
    if (spec.provider === "anthropic" && !live.available) return refuse(409, "live_unavailable", live.reasons.join("; "));
    const p = await previewRun(gate.db, cfg, spec, live.model);
    const budget = await ledgerOf(gate.db, deps).summary();
    return json({ ok: true, preview: p, remainingMicroUsd: budget.remainingMicroUsd, config: cfg });
  });
}

export function create(request: Request, deps: Deps = realDeps): Promise<Response> {
  return safely("create", async () => {
    const gate = await ownerGate(request, deps, true);
    if (gate instanceof Response) return gate;
    const b = await body(request);
    if (b instanceof Response) return b;
    let cfg: WorldConfig;
    try {
      cfg = configFrom(b.world);
    } catch (err) {
      if (err instanceof Invalid) return refuse(400, "invalid", err.message);
      throw err;
    }
    const live = liveStatus(deps.env, deps.now());
    const capUsd = typeof b.capUsd === "number" && Number.isFinite(b.capUsd) && b.capUsd >= 0 && b.capUsd <= CEILING_LIMIT_USD ? b.capUsd : 0;
    const paid = isObj(b.spec) && b.spec.provider === "anthropic";
    // a paid run is approved in words, with the cap stated in the same request
    if (paid && b.confirm !== "I approve this run and its cap") return refuse(400, "confirmation_required", 'send confirm: "I approve this run and its cap"');
    const made = await createRun(gate.db, ledgerOf(gate.db, deps), { title: typeof b.title === "string" ? b.title : "", config: cfg, spec: b.spec, capMicroUsd: usdToMicro(capUsd), allowEarlyStop: b.allowEarlyStop === true }, live, gate.actor);
    if (!made.ok) return refuse(made.error === "invalid" ? 400 : 409, made.error, made.message);
    return json({ ok: true, run: publicRun(made.run), preview: made.preview });
  });
}

const RUN_ID = /^run_[a-z0-9_]{6,40}$/;

export function runView(request: Request, id: string, deps: Deps = realDeps): Promise<Response> {
  return safely("run", async () => {
    if (!RUN_ID.test(id)) return refuse(404, "not_found");
    // from which epoch on: a whole number, or nothing
    const asked = new URL(request.url).searchParams.get("from");
    const from = asked === null || asked === "" ? 0 : Number(asked);
    if (!/^\d{0,9}$/.test(asked ?? "") || !Number.isSafeInteger(from)) return refuse(400, "invalid");
    let owner = ownerSession(request, deps.now(), deps.env) !== null;
    if (!owner) {
      // a stranger may read a published run and nothing else; unpublished runs do not exist for them.
      // Their reads are counted in memory: a stranger's request never writes to the ledger's database.
      const limit = memoryLimit(`public:${clientKey(request, deps.env)}`, 240, 60, deps.now());
      if (!limit.ok) return tooMany("slow_down", limit.retryAfterSec);
    }
    const db = await database(deps);
    if (db instanceof Response) return db;
    if (owner) {
      const gate = await ownerGate(request, deps, false);
      // a session signed out elsewhere reads as a stranger does
      if (gate instanceof Response) {
        if (gate.status !== 401) return gate;
        owner = false;
      }
    }
    const run = await getRun(db, id);
    if (!run || (!owner && !run.published)) return refuse(404, "not_found");
    const epochs = await epochsOf(db, id, from, 40);
    if (!owner) {
      return json({
        ok: true,
        run: { id: run.id, title: run.title, status: run.status, provider: run.provider, model: run.model, promptVersion: run.promptVersion, config: run.config, spec: run.spec, manifest: openManifest(run.manifest), epoch: run.epoch, tick: run.tick, digest: run.digest, published: true },
        epochs: epochs.map((e) => ({ epoch: e.epoch, fromTick: e.fromTick, toTick: e.toTick, digest: e.digest, alive: e.alive, tape: e.tape })),
      });
    }
    return json({ ok: true, run: publicRun(run), epochs, calls: await callSummary(db, id) });
  });
}

/** Published runs, for the public list of recordings. */
export function recordings(request: Request, deps: Deps = realDeps): Promise<Response> {
  return safely("recordings", async () => {
    const limit = memoryLimit(`public:${clientKey(request, deps.env)}`, 240, 60, deps.now());
    if (!limit.ok) return tooMany("slow_down", limit.retryAfterSec);
    let db: Db;
    try {
      db = await deps.db();
    } catch {
      // no database: there are simply no server-side recordings to list
      return json({ ok: true, recordings: [] });
    }
    const runs = (await listRuns(db, 200)).filter((r) => r.published);
    return json({ ok: true, recordings: runs.map((r) => ({ id: r.id, title: r.title, provider: r.provider, model: r.model, scenario: r.config.scenario, seed: r.config.seed, population: r.config.population, epochs: r.epoch, status: r.status })) });
  });
}

/** How long one step may work, and how long its lease holds: the route's own limit (300 s) is above both. */
export const STEP_BUDGET_MS = 150_000;
export const STEP_LEASE_SECONDS = 280;

export function step(request: Request, id: string, deps: Deps = realDeps): Promise<Response> {
  return safely("step", async () => {
    const gate = await ownerGate(request, deps, true);
    if (gate instanceof Response) return gate;
    if (!RUN_ID.test(id)) return refuse(404, "not_found");
    const run = await getRun(gate.db, id);
    if (!run) return refuse(404, "not_found");
    // only now, with the owner established, is a provider even constructed
    const made = deps.provider(run, deps.env, deps.now());
    if (!made.ok) return refuse(409, "provider_unavailable", made.reason);
    try {
      const out = await stepRun(gate.db, ledgerOf(gate.db, deps), id, made.provider, { owner: `${gate.actor}:${deps.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`, budgetMs: STEP_BUDGET_MS, leaseSeconds: STEP_LEASE_SECONDS });
      return json({ ok: true, state: out.state, epoch: out.epoch ?? null, calls: out.calls ?? 0, reason: out.reason ?? "", run: out.run ? publicRun(out.run) : null });
    } catch (err) {
      logFailure("step", err);
      return refuse(500, "step_failed");
    }
  });
}

export function control(request: Request, id: string, deps: Deps = realDeps): Promise<Response> {
  return safely("control", async () => {
    const gate = await ownerGate(request, deps, true);
    if (gate instanceof Response) return gate;
    if (!RUN_ID.test(id)) return refuse(404, "not_found");
    const b = await body(request);
    if (b instanceof Response) return b;
    const reason = typeof b.reason === "string" ? b.reason : "";
    let ok: boolean;
    switch (b.action) {
      case "pause":
        ok = await setRunStatus(gate.db, id, "paused", gate.actor, reason || "paused by the owner");
        break;
      case "resume":
        ok = await setRunStatus(gate.db, id, "active", gate.actor);
        break;
      case "cancel":
        ok = await setRunStatus(gate.db, id, "cancelled", gate.actor, reason || "cancelled by the owner");
        break;
      case "publish":
        ok = await publishRun(gate.db, id, true, gate.actor);
        break;
      case "unpublish":
        ok = await publishRun(gate.db, id, false, gate.actor);
        break;
      default:
        return refuse(400, "invalid");
    }
    return ok ? json({ ok: true, run: publicRun((await getRun(gate.db, id)) as Run) }) : refuse(409, "not_possible");
  });
}
