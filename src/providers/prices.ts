/**
 * Dated price record and cost arithmetic, in integer microdollars.
 *
 * Everything here is public information and pure arithmetic, so the same numbers drive the
 * owner's cost preview in the browser and the ledger on the server. The server is the only
 * place they are enforced.
 *
 * 1 USD = 1,000,000 microdollars. Prices are stored as microdollars per million tokens, which
 * is numerically "dollars per million tokens × 1,000,000", so that every published price —
 * including a $0.01 cache read — is an exact integer.
 */

export interface RateCard {
  /** Microdollars per million tokens. */
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

export interface ModelPrice extends RateCard {
  /** A second rate card that applies to the whole request when its prompt is longer than `over` tokens. */
  longPrompt?: RateCard & { over: number };
  /**
   * Permille multiplier on the whole card if a request ran in fast mode. We never ask for
   * fast mode; this is here so that an anomaly is priced rather than ignored.
   */
  fastPermille?: number;
}

export interface PriceTable {
  /** The day these prices were read from the provider's published pricing page. */
  verifiedOn: string;
  source: string;
  /** After this many days without re-verification, live mode refuses to start. */
  staleAfterDays: number;
  models: Record<string, ModelPrice>;
}

const usd = (dollarsPerMTok: number): number => Math.round(dollarsPerMTok * 1_000_000);

/**
 * Verified 2026-11-25 against the provider's pricing page (docs/research/anthropic-api.md §B
 * records the sources and the retrieval time). A model that is not in this table cannot be
 * used for live calls: an unknown price is a reason to refuse, not to guess.
 */
export const PRICE_TABLE: PriceTable = {
  verifiedOn: "2026-11-25",
  source: "https://platform.claude.com/docs/en/about-claude/pricing",
  staleAfterDays: 45,
  models: {
    "claude-fable-5-2": { input: usd(8), cacheWrite5m: usd(10), cacheWrite1h: usd(16), cacheRead: usd(0.2), output: usd(40), fastPermille: 2000 },
    "claude-opus-5-5": { input: usd(4), cacheWrite5m: usd(5), cacheWrite1h: usd(8), cacheRead: usd(0.2), output: usd(20), fastPermille: 2000 },
    "claude-sonnet-5-5": { input: usd(2), cacheWrite5m: usd(2.5), cacheWrite1h: usd(4), cacheRead: usd(0.1), output: usd(10) },
    "claude-haiku-5-5": {
      input: usd(0.1),
      cacheWrite5m: usd(0.125),
      cacheWrite1h: usd(0.2),
      cacheRead: usd(0.01),
      output: usd(0.5),
      longPrompt: { over: 100_000, input: usd(0.5), cacheWrite5m: usd(0.625), cacheWrite1h: usd(1), cacheRead: usd(0.05), output: usd(2.5) },
    },
  },
};

/**
 * Margins applied on top of list prices when money is reserved. Each is a documented way a
 * request can cost more than list price without the application asking for it.
 */
export const MARGINS = {
  /**
   * Permille. A workspace whose default inference geography is "us" pays 1.1× on every token
   * category, and the application cannot see that setting before the first response.
   */
  geography: 1100,
  /**
   * Tokens added to every request's input bound for what the provider inserts and bills but
   * does not document the size of (the structured-output and thinking system prompts, and
   * message framing).
   */
  hiddenInputTokens: 2000,
} as const;

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  /** Split of cache writes by lifetime, when the provider reports it. */
  cache_creation_5m: number;
  cache_creation_1h: number;
  inference_geo: string | null;
  speed: string | null;
  service_tier: string | null;
  thinking_tokens: number | null;
}

const ceilDiv = (a: number, b: number): number => Math.ceil(a / b);

/** Microdollars for `tokens` at `perMTok`, rounded up. */
export function tokenCost(tokens: number, perMTok: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return ceilDiv(Math.ceil(tokens) * perMTok, 1_000_000);
}

export function priceOf(model: string, table: PriceTable = PRICE_TABLE): ModelPrice | null {
  return Object.prototype.hasOwnProperty.call(table.models, model) ? (table.models[model] as ModelPrice) : null;
}

const dayNumber = (isoDate: string): number => Date.UTC(Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)) - 1, Number(isoDate.slice(8, 10)));

/**
 * Whole days from the table's verification date to `nowMs`. `attestedOn` is a later date on
 * which the owner says they re-checked the published prices against this table; it can only
 * move the date forward, never into the future.
 */
export function priceAgeDays(nowMs: number, table: PriceTable = PRICE_TABLE, attestedOn?: string | null): number {
  let from = dayNumber(table.verifiedOn);
  if (attestedOn && /^\d{4}-\d{2}-\d{2}$/.test(attestedOn)) {
    const a = dayNumber(attestedOn);
    if (Number.isFinite(a) && a > from && a <= nowMs) from = a;
  }
  return Math.floor((nowMs - from) / 86_400_000);
}

export function pricesAreStale(nowMs: number, table: PriceTable = PRICE_TABLE, attestedOn?: string | null): boolean {
  const age = priceAgeDays(nowMs, table, attestedOn);
  return !(age >= 0 && age <= table.staleAfterDays);
}

/**
 * The most one request can cost: every input token written to the dearest cache it could be
 * written to, every permitted output token used, and the geography margin on top.
 * `inputTokenBound` must be an upper bound on the visible prompt's tokens; `cache` says
 * which cache writes the request can cause ("none" if it sets no cache breakpoint).
 */
export function worstCaseCost(price: ModelPrice, inputTokenBound: number, maxOutputTokens: number, cache: "none" | "5m" | "1h" = "5m"): number {
  const tokensIn = inputTokenBound + MARGINS.hiddenInputTokens;
  const card: RateCard = price.longPrompt && tokensIn > price.longPrompt.over ? price.longPrompt : price;
  const inRate = cache === "1h" ? Math.max(card.input, card.cacheWrite1h) : cache === "5m" ? Math.max(card.input, card.cacheWrite5m) : card.input;
  const base = tokenCost(tokensIn, inRate) + tokenCost(maxOutputTokens, card.output);
  return ceilDiv(base * MARGINS.geography, 1000);
}

/**
 * What a completed request cost, from the provider's own usage report. Returns null when the
 * report cannot be priced with confidence (a count is missing or is not a count, or the
 * request ran in a mode this table has no price for): the caller must then keep the
 * reservation rather than guess.
 */
export function costFromUsage(price: ModelPrice, usage: Usage, unsplitAs: "5m" | "1h" = "1h"): number | null {
  const counts = [usage.input_tokens, usage.output_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens, usage.cache_creation_5m, usage.cache_creation_1h];
  if (counts.some((n) => typeof n !== "number" || !Number.isFinite(n) || n < 0)) return null;
  const prompt = usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens;
  const card: RateCard = price.longPrompt && prompt > price.longPrompt.over ? price.longPrompt : price;
  // If the provider did not split cache writes by lifetime they are priced at the dearer rate,
  // unless the caller knows its requests can only ever have written the 5-minute cache.
  const split = usage.cache_creation_5m + usage.cache_creation_1h === usage.cache_creation_input_tokens;
  const w5m = split ? usage.cache_creation_5m : unsplitAs === "5m" ? usage.cache_creation_input_tokens : 0;
  const w1h = split ? usage.cache_creation_1h : unsplitAs === "5m" ? 0 : usage.cache_creation_input_tokens;
  let cost =
    tokenCost(usage.input_tokens, card.input) +
    tokenCost(w5m, card.cacheWrite5m) +
    tokenCost(w1h, card.cacheWrite1h) +
    tokenCost(usage.cache_read_input_tokens, card.cacheRead) +
    tokenCost(usage.output_tokens, card.output);
  if (usage.speed !== null && usage.speed !== "standard" && usage.speed !== "") {
    if (usage.speed !== "fast" || !price.fastPermille) return null;
    cost = ceilDiv(cost * price.fastPermille, 1000);
  }
  // any geography other than the default is priced at the documented regional multiplier
  if (usage.inference_geo !== null && usage.inference_geo !== "global" && usage.inference_geo !== "") cost = ceilDiv(cost * MARGINS.geography, 1000);
  // Batch requests are half price. We never send them, and under-pricing is the unsafe
  // direction, so no discount is ever applied here.
  return cost;
}

export const formatUsd = (microusd: number, digits = 2): string => {
  const sign = microusd < 0 ? "-" : "";
  const abs = Math.abs(microusd) / 1_000_000;
  return `${sign}$${abs.toFixed(abs > 0 && abs < 0.01 ? 4 : digits)}`;
};

export const usdToMicro = (dollars: number): number => Math.round(dollars * 1_000_000);
