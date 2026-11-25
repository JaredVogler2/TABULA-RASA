import "server-only";

/**
 * The owner API, as plain functions from a Request to a Response.
 *
 * Route files under src/app/api only forward to these. Every function that can change
 * anything, read anything private or cause a provider call starts with the same gate
 * (`requireOwner`), and nothing behind the gate runs if it refuses. Dependencies are passed
 * in so that the tests can stand in a database and a provider and prove that.
 */
import { makeConfig, type WorldConfig } from "@/engine";
import { MockProvider } from "@/providers/mock";
import { PRICE_TABLE, usdToMicro } from "@/providers/prices";
import { BaselineProvider } from "@/providers/replay";
import { validateSpec } from "@/providers/run";
import type { Provider } from "@/providers/types";
import { liveProvider } from "./anthropic";
import { SESSION_TTL_MS, csrfToken, issueSession, sessionCookie, verifyPassphrase } from "./auth";
import { getDb, type Db } from "./db";
import { anthropicKey, authSecret, liveStatus, ownerAuthConfigured, ownerPasswordHash } from "./env";
import { BodyError, clientKey, isSecure, json, logFailure, ownerSession, rateLimit, readJson, refuse, requireOwner, sameOrigin } from "./http";
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

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

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

/** Guard + rate limit + database for an owner endpoint. */
async function ownerGate(request: Request, deps: Deps, write: boolean): Promise<{ db: Db; actor: string; csrf: string } | Response> {
  const guard = requireOwner(request, write, deps.now());
  if (!guard.ok) return guard.response;
  const db = await database(deps);
  if (db instanceof Response) return db;
  const limit = await rateLimit(db, `owner:${guard.session.sid}`, 600, 60, deps.now());
  if (!limit.ok) return refuse(429, "slow_down", undefined, { "retry-after": String(limit.retryAfterSec) });
  return { db, actor: `owner:${guard.session.sid.slice(0, 8)}`, csrf: csrfToken(guard.secret, guard.session) };
}

// ───────────────────────── sign-in

export async function login(request: Request, deps: Deps = realDeps): Promise<Response> {
  if (!sameOrigin(request)) return refuse(403, "cross_origin");
  if (!ownerAuthConfigured(deps.env)) return refuse(503, "owner_not_configured");
  const db = await database(deps);
  if (db instanceof Response) return db;
  // counted before the passphrase is looked at: guessing is slow for one address and for all of them together
  const perClient = await rateLimit(db, `login:${clientKey(request)}`, 5, 900, deps.now());
  const overall = await rateLimit(db, "login:all", 40, 900, deps.now());
  if (!perClient.ok || !overall.ok) return refuse(429, "too_many_attempts", undefined, { "retry-after": String(Math.max(perClient.retryAfterSec, overall.retryAfterSec)) });
  const b = await body(request, 2048);
  if (b instanceof Response) return b;
  const ok = await verifyPassphrase(b.passphrase, ownerPasswordHash(deps.env));
  if (!ok) {
    await audit(db, "anonymous", "login.failed", { client: clientKey(request) }).catch(() => undefined);
    return refuse(401, "wrong_passphrase");
  }
  const secret = authSecret(deps.env) as string;
  const { session, cookie } = issueSession(secret, deps.now());
  await audit(db, `owner:${session.sid.slice(0, 8)}`, "login", { client: clientKey(request) }).catch(() => undefined);
  return json({ ok: true, csrf: csrfToken(secret, session), expiresAt: session.expiresAt }, 200, { "set-cookie": sessionCookie(cookie, isSecure(request), SESSION_TTL_MS / 1000) });
}

export async function logout(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return refuse(403, "cross_origin");
  const secure = isSecure(request);
  return json({ ok: true }, 200, { "set-cookie": sessionCookie("", secure, 0) });
}

/**
 * What the owner console shows. Signed out, it says only whether sign-in is possible —
 * nothing about models, budgets or runs, and it touches no database.
 */
export async function status(request: Request, deps: Deps = realDeps): Promise<Response> {
  const owner = ownerSession(request, deps.now());
  if (!owner) return json({ signedIn: false, signInPossible: ownerAuthConfigured(deps.env) });
  const gate = await ownerGate(request, deps, false);
  if (gate instanceof Response) return gate;
  const ledger = new Ledger(gate.db, () => new Date(deps.now()));
  await ledger.sweep(15 * 60_000).catch(() => 0);
  const [budget, runs, unknown, recent] = await Promise.all([ledger.summary(), listRuns(gate.db, 30), ledger.list("unknown", 50), gate.db.query("SELECT at::text AS at, actor, action, detail FROM audit_log ORDER BY id DESC LIMIT 30")]);
  return json({
    signedIn: true,
    csrf: gate.csrf,
    live: liveStatus(deps.env, deps.now()),
    budget,
    prices: { verifiedOn: PRICE_TABLE.verifiedOn, source: PRICE_TABLE.source, staleAfterDays: PRICE_TABLE.staleAfterDays, models: PRICE_TABLE.models },
    runs: runs.map(publicRun),
    unknown,
    audit: recent,
  });
}

// ───────────────────────── money

export async function setBudget(request: Request, deps: Deps = realDeps): Promise<Response> {
  const gate = await ownerGate(request, deps, true);
  if (gate instanceof Response) return gate;
  const b = await body(request);
  if (b instanceof Response) return b;
  // authorizing spend is never a side effect: the request has to say so in words
  if (b.confirm !== "I authorize this spending") return refuse(400, "confirmation_required", 'send confirm: "I authorize this spending"');
  const total = b.authorizedUsd;
  const daily = b.dailyCapUsd;
  if (typeof total !== "number" || typeof daily !== "number" || !Number.isFinite(total) || !Number.isFinite(daily) || total < 0 || daily < 0 || total > 10_000 || daily > 10_000) return refuse(400, "invalid_amount");
  const out = await new Ledger(gate.db, () => new Date(deps.now())).authorize(usdToMicro(total), usdToMicro(daily), gate.actor);
  if (!out.ok) return refuse(409, out.reason, out.reason === "below_committed" ? "that is less than what is already held or spent; use the kill switch to stop spending" : undefined);
  return json({ ok: true });
}

export async function setKill(request: Request, deps: Deps = realDeps): Promise<Response> {
  const gate = await ownerGate(request, deps, true);
  if (gate instanceof Response) return gate;
  const b = await body(request);
  if (b instanceof Response) return b;
  if (typeof b.on !== "boolean") return refuse(400, "invalid");
  await new Ledger(gate.db).setKillSwitch(b.on, typeof b.reason === "string" && b.reason.trim() ? b.reason : b.on ? "stopped by the owner" : "released by the owner", gate.actor);
  return json({ ok: true });
}

export async function reconcile(request: Request, deps: Deps = realDeps): Promise<Response> {
  const gate = await ownerGate(request, deps, true);
  if (gate instanceof Response) return gate;
  const b = await body(request);
  if (b instanceof Response) return b;
  if (typeof b.id !== "string" || b.id.length > 200) return refuse(400, "invalid");
  const ledger = new Ledger(gate.db);
  let decision: { release: true } | { settleMicroUsd: number };
  if (b.action === "release") decision = { release: true };
  else if (b.action === "settle" && typeof b.amountUsd === "number" && Number.isFinite(b.amountUsd) && b.amountUsd >= 0) decision = { settleMicroUsd: usdToMicro(b.amountUsd) };
  else if (b.action === "settle_full") {
    const r = await ledger.get(b.id);
    if (!r) return refuse(404, "not_found");
    decision = { settleMicroUsd: r.reservedMicroUsd };
  } else return refuse(400, "invalid");
  const out = await ledger.reconcile(b.id, decision, gate.actor);
  return out === "done" ? json({ ok: true }) : refuse(409, out);
}

// ───────────────────────── runs

/** A run as it is shown: everything but the stored world. */
function publicRun(run: Run): Record<string, unknown> {
  return { ...run };
}

function configFrom(raw: unknown): WorldConfig {
  if (!isObj(raw)) throw new Error("a run needs a world");
  const scenario = typeof raw.scenario === "string" ? raw.scenario : "first_light";
  const seed = typeof raw.seed === "number" && Number.isInteger(raw.seed) && raw.seed >= 0 ? raw.seed : Number.NaN;
  if (Number.isNaN(seed)) throw new Error("the world needs a whole-number seed");
  const overrides = isObj(raw.overrides) ? raw.overrides : {};
  // only knobs a run may set; everything else keeps the scenario's value
  const allowed = ["population", "externalShare", "institutions", "cadence", "policy", "plannerShare", "spawn", "illness"] as const;
  const picked: Record<string, unknown> = {};
  for (const k of allowed) if (k in overrides) picked[k] = overrides[k];
  return makeConfig(scenario, seed, picked as Partial<WorldConfig>);
}

export async function preview(request: Request, deps: Deps = realDeps): Promise<Response> {
  const gate = await ownerGate(request, deps, true);
  if (gate instanceof Response) return gate;
  const b = await body(request);
  if (b instanceof Response) return b;
  try {
    const cfg = configFrom(b.world);
    const spec = validateSpec(b.spec);
    const live = liveStatus(deps.env, deps.now());
    if (spec.provider === "anthropic" && !live.available) return refuse(409, "live_unavailable", live.reasons.join("; "));
    const p = await previewRun(gate.db, cfg, spec, live.model);
    const budget = await new Ledger(gate.db, () => new Date(deps.now())).summary();
    return json({ ok: true, preview: p, remainingMicroUsd: budget.remainingMicroUsd, config: cfg });
  } catch (err) {
    return refuse(400, "invalid", err instanceof Error ? err.message.slice(0, 200) : undefined);
  }
}

export async function create(request: Request, deps: Deps = realDeps): Promise<Response> {
  const gate = await ownerGate(request, deps, true);
  if (gate instanceof Response) return gate;
  const b = await body(request);
  if (b instanceof Response) return b;
  let cfg: WorldConfig;
  try {
    cfg = configFrom(b.world);
  } catch (err) {
    return refuse(400, "invalid", err instanceof Error ? err.message.slice(0, 200) : undefined);
  }
  const live = liveStatus(deps.env, deps.now());
  const capUsd = typeof b.capUsd === "number" && Number.isFinite(b.capUsd) && b.capUsd >= 0 && b.capUsd <= 10_000 ? b.capUsd : 0;
  const paid = isObj(b.spec) && b.spec.provider === "anthropic";
  // a paid run is approved in words, with the cap stated in the same request
  if (paid && b.confirm !== "I approve this run and its cap") return refuse(400, "confirmation_required", 'send confirm: "I approve this run and its cap"');
  const made = await createRun(gate.db, new Ledger(gate.db, () => new Date(deps.now())), { title: typeof b.title === "string" ? b.title : "", config: cfg, spec: b.spec, capMicroUsd: usdToMicro(capUsd), allowEarlyStop: b.allowEarlyStop === true }, live, gate.actor);
  if (!made.ok) return refuse(made.error === "invalid" ? 400 : 409, made.error, made.message);
  return json({ ok: true, run: publicRun(made.run), preview: made.preview });
}

const RUN_ID = /^run_[a-z0-9_]{6,40}$/;

export async function runView(request: Request, id: string, deps: Deps = realDeps): Promise<Response> {
  if (!RUN_ID.test(id)) return refuse(404, "not_found");
  const owner = ownerSession(request, deps.now());
  const db = await database(deps);
  if (db instanceof Response) return db;
  if (!owner) {
    // a stranger may read a published run and nothing else; unpublished runs do not exist for them
    const limit = await rateLimit(db, `public:${clientKey(request)}`, 240, 60, deps.now());
    if (!limit.ok) return refuse(429, "slow_down", undefined, { "retry-after": String(limit.retryAfterSec) });
  }
  const run = await getRun(db, id);
  if (!run || (!owner && !run.published)) return refuse(404, "not_found");
  const from = Math.max(0, Number(new URL(request.url).searchParams.get("from") ?? "0") || 0);
  const epochs = await epochsOf(db, id, from, 40);
  if (!owner) {
    return json({ ok: true, run: { id: run.id, title: run.title, status: run.status, provider: run.provider, model: run.model, promptVersion: run.promptVersion, config: run.config, spec: run.spec, manifest: run.manifest, epoch: run.epoch, tick: run.tick, digest: run.digest, published: true }, epochs: epochs.map((e) => ({ epoch: e.epoch, fromTick: e.fromTick, toTick: e.toTick, digest: e.digest, alive: e.alive, tape: e.tape })) });
  }
  return json({ ok: true, run: publicRun(run), epochs, calls: await callSummary(db, id) });
}

/** Published runs, for the public list of recordings. */
export async function recordings(request: Request, deps: Deps = realDeps): Promise<Response> {
  let db: Db;
  try {
    db = await deps.db();
  } catch {
    // no database: there are simply no server-side recordings to list
    return json({ ok: true, recordings: [] });
  }
  const limit = await rateLimit(db, `public:${clientKey(request)}`, 240, 60, deps.now());
  if (!limit.ok) return refuse(429, "slow_down", undefined, { "retry-after": String(limit.retryAfterSec) });
  const runs = (await listRuns(db, 200)).filter((r) => r.published);
  return json({ ok: true, recordings: runs.map((r) => ({ id: r.id, title: r.title, provider: r.provider, model: r.model, scenario: r.config.scenario, seed: r.config.seed, population: r.config.population, epochs: r.epoch, status: r.status })) });
}

export async function step(request: Request, id: string, deps: Deps = realDeps): Promise<Response> {
  const gate = await ownerGate(request, deps, true);
  if (gate instanceof Response) return gate;
  if (!RUN_ID.test(id)) return refuse(404, "not_found");
  const run = await getRun(gate.db, id);
  if (!run) return refuse(404, "not_found");
  // only now, with the owner established, is a provider even constructed
  const made = deps.provider(run, deps.env, deps.now());
  if (!made.ok) return refuse(409, "provider_unavailable", made.reason);
  try {
    const out = await stepRun(gate.db, new Ledger(gate.db, () => new Date(deps.now())), id, made.provider, { owner: `${gate.actor}:${deps.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`, budgetMs: 150_000 });
    return json({ ok: true, state: out.state, epoch: out.epoch ?? null, calls: out.calls ?? 0, reason: out.reason ?? "", run: out.run ? publicRun(out.run) : null });
  } catch (err) {
    logFailure("step", err);
    return refuse(500, "step_failed");
  }
}

export async function control(request: Request, id: string, deps: Deps = realDeps): Promise<Response> {
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
}
