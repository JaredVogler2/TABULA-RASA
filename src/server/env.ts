import "server-only";

/**
 * Server configuration, read from the environment and nowhere else.
 *
 * Live mode is off unless every one of its conditions holds, and each failed condition is
 * reported by name (never by value). Nothing here returns a secret: callers get booleans and
 * the model id, and the key is handed only to the code that constructs the provider client.
 */
import { PRICE_TABLE, priceAgeDays, priceOf, pricesAreStale } from "@/providers/prices";

export interface LiveStatus {
  /** True only if a paid call could be made right now, as far as configuration goes. */
  available: boolean;
  /** The most this deployment may ever be authorized to spend, in microdollars (0: nothing). */
  ceilingMicroUsd: number;
  /** Why not, one plain reason per failed condition. Empty when available. */
  reasons: string[];
  model: string | null;
  keyConfigured: boolean;
  database: "postgres" | "local" | "none";
  deployment: "production" | "preview" | "development" | "local";
  prices: { verifiedOn: string; attestedOn: string | null; ageDays: number; staleAfterDays: number; stale: boolean; modelKnown: boolean };
}

type Env = Record<string, string | undefined>;

const clean = (v: string | undefined): string => (typeof v === "string" ? v.trim() : "");

export function deploymentOf(env: Env = process.env): LiveStatus["deployment"] {
  const v = clean(env.VERCEL_ENV);
  if (v === "production" || v === "preview" || v === "development") return v;
  return "local";
}

export function databaseKind(env: Env = process.env): LiveStatus["database"] {
  if (clean(env.DATABASE_URL)) return "postgres";
  return clean(env.NODE_ENV) === "production" ? "none" : "local";
}

/** Whether owner sign-in is possible at all (it needs a password hash and a signing secret). */
export function ownerAuthConfigured(env: Env = process.env): boolean {
  return clean(env.OWNER_PASSWORD_HASH).startsWith("scrypt:") && clean(env.AUTH_SECRET).length >= 32;
}

/** No deployment can set its ceiling above this, whatever its configuration says. */
export const CEILING_LIMIT_USD = 10_000;

/**
 * The most this deployment may ever be authorized to spend, in microdollars: `BUDGET_CEILING_USD`,
 * a plain amount of dollars such as `25` or `7.50`. It is read from the deployment's
 * configuration and nowhere else — the owner console can show it but not change it, so the
 * credential that authorizes spending cannot raise its own limit. Unset, malformed, zero or
 * beyond the limit above, it is zero: nothing can be authorized and live mode is unavailable.
 */
export function budgetCeilingMicro(env: Env = process.env): number {
  const raw = clean(env.BUDGET_CEILING_USD);
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(raw)) return 0;
  const usd = Number(raw);
  return usd > 0 && usd <= CEILING_LIMIT_USD ? Math.round(usd * 1_000_000) : 0;
}

/**
 * Settings the provider's SDK would take from the environment. The client this application
 * builds ignores every one of them (see anthropic.ts) — and a deployment that has one set was
 * configured for something this application does not do, so live mode says so and stays off.
 */
export const FOREIGN_SDK_SETTINGS = ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_CUSTOM_HEADERS", "ANTHROPIC_LOG", "ANTHROPIC_OPEN_TELEMETRY_TRACES_CONTENT_MODE"] as const;

export function liveStatus(env: Env = process.env, nowMs: number = Date.now()): LiveStatus {
  const reasons: string[] = [];
  const model = clean(env.ANTHROPIC_MODEL) || null;
  const keyConfigured = clean(env.ANTHROPIC_API_KEY).length > 0;
  const database = databaseKind(env);
  const deployment = deploymentOf(env);
  const attestedOn = clean(env.PRICES_ATTESTED_ON) || null;
  const stale = pricesAreStale(nowMs, PRICE_TABLE, attestedOn);
  const modelKnown = model !== null && priceOf(model) !== null;

  if (clean(env.LIVE_ENABLED) !== "true") reasons.push("LIVE_ENABLED is not set to true");
  if (deployment === "preview") reasons.push("preview deployments run mock minds only");
  if (!keyConfigured) reasons.push("ANTHROPIC_API_KEY is not set");
  if (!model) reasons.push("ANTHROPIC_MODEL is not set (there is no default model)");
  else if (!modelKnown) reasons.push("ANTHROPIC_MODEL names a model with no entry in the price table");
  // the ledger is only as good as its database: PostgreSQL everywhere, never the single-connection local store
  if (database !== "postgres") reasons.push("DATABASE_URL is not set (the budget ledger needs PostgreSQL)");
  if (!ownerAuthConfigured(env)) reasons.push("owner sign-in is not configured (OWNER_PASSWORD_HASH and AUTH_SECRET)");
  const ceilingMicroUsd = budgetCeilingMicro(env);
  if (ceilingMicroUsd === 0) reasons.push(`BUDGET_CEILING_USD is not set to an amount of dollars between 0.01 and ${CEILING_LIMIT_USD} (the most this deployment may ever be authorized to spend)`);
  for (const name of FOREIGN_SDK_SETTINGS) if (clean(env[name])) reasons.push(`${name} is set, and this application never uses it: remove it`);
  if (stale) reasons.push(`the price table was last verified on ${PRICE_TABLE.verifiedOn} and is past its ${PRICE_TABLE.staleAfterDays}-day limit`);

  return {
    available: reasons.length === 0,
    ceilingMicroUsd,
    reasons,
    model,
    keyConfigured,
    database,
    deployment,
    prices: { verifiedOn: PRICE_TABLE.verifiedOn, attestedOn, ageDays: priceAgeDays(nowMs, PRICE_TABLE, attestedOn), staleAfterDays: PRICE_TABLE.staleAfterDays, stale, modelKnown },
  };
}

/** The API key, for constructing the provider client. Never log, return or store the result. */
export function anthropicKey(env: Env = process.env): string | null {
  return clean(env.ANTHROPIC_API_KEY) || null;
}

export function authSecret(env: Env = process.env): string | null {
  const s = clean(env.AUTH_SECRET);
  return s.length >= 32 ? s : null;
}

export function ownerPasswordHash(env: Env = process.env): string | null {
  const s = clean(env.OWNER_PASSWORD_HASH);
  return s.startsWith("scrypt:") ? s : null;
}
