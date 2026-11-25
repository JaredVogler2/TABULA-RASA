import "server-only";

/**
 * The live provider: one Messages API request per decision, through the official SDK, with
 * the owner's key. Written against docs/research/anthropic-api.md (verified 2026-11-25) and
 * the types of the installed @anthropic-ai/sdk 1.14.0.
 *
 * What a request contains, and why:
 *   model            exactly the configured id; there is no default and no fallback model
 *   max_tokens       the hard bound on billed output (thinking included)
 *   system           the rules text, as one block with a 5-minute cache breakpoint
 *   messages         one user message: the page
 *   output_config    effort, and the decision schema as a json_schema format
 *   inference_geo    "global": standard prices whatever the workspace's default is
 * What it never contains: tools, thinking or sampling parameters (the model rejects them),
 * a fallback list, fast mode, a second turn, or anything from the environment.
 *
 * Where it goes, and what else leaves with it: one place and nothing. The SDK would take its
 * destination, extra headers, its log level and its tracing from environment variables; the
 * client built here pins the destination, turns logging and tracing off, and sends every
 * request through `guardedFetch`, which lets through only a POST to the Messages endpoint of
 * the provider's own host carrying only the headers such a request needs.
 *
 * What happens to the answer:
 *   - only `text` blocks are read; thinking blocks are neither stored nor logged
 *   - `usage` is priced first; an answer whose usage cannot be priced has an unknown cost
 *   - the SDK's own retries are off: every attempt is separately reserved by the caller
 *
 * This module makes no calls by being imported. Nothing here has been exercised against the
 * real API: that needs the owner's explicit authorization (docs/COST.md).
 */
import Anthropic from "@anthropic-ai/sdk";
import { costFromUsage, priceOf, worstCaseCost, type ModelPrice, type Usage } from "@/providers/prices";
import { inputTokenBound } from "@/providers/prompt";
import type { CallError, CallResult, DecisionCall, Provider } from "@/providers/types";
import { parseWire } from "@/providers/wire";

/** The one SDK method this provider uses, narrowed so that tests can stand in for it. */
export interface MessagesClient {
  create(body: Record<string, unknown>, options: { timeout: number; maxRetries: 0; signal?: AbortSignal }): Promise<unknown>;
}

/** The only host the owner's key is ever sent to, and the only path on it. */
export const PROVIDER_ORIGIN = "https://api.anthropic.com";
export const PROVIDER_PATH = "/v1/messages";

/** The headers a Messages request needs: content, credential, API version, and the SDK's own description of itself. */
const SENT_HEADERS = /^(accept|content-type|content-length|user-agent|authorization|x-api-key|anthropic-version|x-stainless-[a-z0-9-]+)$/;

/**
 * The network, narrowed to the one request this application makes. Anything else — another
 * host, another path, another method — is refused before it is sent, and any header that is
 * not on the short list is left behind. This is what makes "the key goes to the provider and
 * nowhere else, with nothing added" true whatever the SDK is told by its environment
 * (`ANTHROPIC_CUSTOM_HEADERS` would otherwise add headers, a beta flag among them).
 */
export function guardedFetch(inner: typeof fetch): typeof fetch {
  return async (input, init) => {
    const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(target);
    const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
    if (url.origin !== PROVIDER_ORIGIN || url.pathname !== PROVIDER_PATH || url.search !== "" || method !== "POST") {
      throw new Error("refused: not a request this application makes");
    }
    const headers = new Headers();
    new Headers(init?.headers).forEach((value, name) => {
      if (SENT_HEADERS.test(name.toLowerCase())) headers.set(name, value);
    });
    return inner(url.href, { ...init, headers, redirect: "error" });
  };
}

/**
 * A real client for the owner's key. The key goes nowhere else — by construction, not by
 * default: the base URL is pinned (the SDK would otherwise take `ANTHROPIC_BASE_URL`), a
 * credential passed in code is the client's only one (the SDK then reads none from the
 * environment), logging is off (`ANTHROPIC_LOG=debug` would otherwise print request and
 * response bodies), tracing is off (the SDK otherwise opens OpenTelemetry spans and adds trace
 * headers when a tracer is registered), its own retries are off, and every request passes
 * `guardedFetch`. `fetchImpl` replaces the network (tests drive the real SDK against canned
 * HTTP responses with it); it too sits behind the guard.
 */
export function sdkClient(apiKey: string, fetchImpl?: typeof fetch): MessagesClient {
  const client = new Anthropic({ apiKey, baseURL: PROVIDER_ORIGIN, maxRetries: 0, logLevel: "off", openTelemetry: false, fetch: guardedFetch(fetchImpl ?? fetch) });
  return {
    create: (body, options) => client.messages.create(body as unknown as Anthropic.Messages.MessageCreateParamsNonStreaming, options),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : v === null || v === undefined ? 0 : Number.NaN);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** The provider's usage report in our own terms. A missing or non-numeric count becomes NaN, which nothing will price. */
export function readUsage(raw: unknown): Usage | null {
  if (!isObj(raw)) return null;
  const creation = isObj(raw.cache_creation) ? raw.cache_creation : null;
  const details = isObj(raw.output_tokens_details) ? raw.output_tokens_details : null;
  return {
    input_tokens: typeof raw.input_tokens === "number" ? count(raw.input_tokens) : Number.NaN,
    output_tokens: typeof raw.output_tokens === "number" ? count(raw.output_tokens) : Number.NaN,
    cache_creation_input_tokens: count(raw.cache_creation_input_tokens),
    cache_read_input_tokens: count(raw.cache_read_input_tokens),
    cache_creation_5m: creation ? count(creation.ephemeral_5m_input_tokens) : 0,
    cache_creation_1h: creation ? count(creation.ephemeral_1h_input_tokens) : 0,
    inference_geo: str(raw.inference_geo),
    speed: str(raw.speed),
    service_tier: str(raw.service_tier),
    thinking_tokens: details && typeof details.thinking_tokens === "number" ? details.thinking_tokens : null,
  };
}

/**
 * What an error from the SDK means for the request's fate.
 *
 *   the provider itself refused it → the request failed and is not billed ("rejected").
 *     "The provider itself" means two things were both present: the provider's own error
 *     envelope in the body ({ type: "error", error: { type, … } }) and the request id it gave
 *     the request. A status alone proves nothing: a 502 or 503 written by something between
 *     here and the provider can arrive after the provider has done the work and charged for it.
 *   408 / 499 / 504, whoever sent them → the work may have been done and nobody told us ("unknown")
 *   any other response that is not the provider's own → "unknown"
 *   no response at all (timeout, connection lost, abort, anything else) → "unknown"
 *
 * An unknown outcome keeps its money held and is never retried; only a person, having looked
 * at the provider's own usage record, can release it.
 */
export function classifyError(err: unknown): { status: "rejected" | "unknown"; error: CallError; requestId: string | null } {
  const e = isObj(err) ? err : {};
  const http = typeof e.status === "number" ? e.status : null;
  const requestId = str(e.requestID) ?? null;
  const apiMessage = str(e.apiMessage) ?? "";
  const errorCode = str(e.errorCode) ?? "";
  const name = err instanceof Error ? err.name : "";
  const body = isObj(e.error) ? e.error : null;
  const inner = body && isObj(body.error) ? body.error : null;
  const fromProvider = body !== null && body.type === "error" && inner !== null && typeof inner.type === "string" && requestId !== null && requestId.length > 0;
  const make = (status: "rejected" | "unknown", code: string, retryable: boolean): { status: "rejected" | "unknown"; error: CallError; requestId: string | null } => ({
    status,
    // the provider's message is not kept: only a code of our own, the HTTP status and the provider's error code
    error: { code, status: http, retryable: status === "rejected" && retryable, message: errorCode },
    requestId,
  });
  if (http === null) {
    if (/Timeout/i.test(name)) return make("unknown", "timeout", false);
    if (/Abort/i.test(name)) return make("unknown", "aborted", false);
    if (/Connection/i.test(name)) return make("unknown", "connection", false);
    return make("unknown", "no_response", false);
  }
  if (http === 408 || http === 499 || http === 504) return make("unknown", "gateway_timeout", false);
  if (!fromProvider) return make("unknown", "unrecognized_response", false);
  if (http === 429) {
    if (/spend_limit/.test(errorCode)) return make("rejected", "spend_limit", false);
    if (errorCode === "ramp_limit_exceeded") return make("rejected", "ramp_limit", false);
    return make("rejected", "rate_limited", true);
  }
  if (http === 529) return make("rejected", "overloaded", true);
  if (http >= 500) return make("rejected", "server_error", true);
  if (http === 401 || http === 403) return make("rejected", "auth", false);
  if (http === 402) return make("rejected", "billing", false);
  if (http === 404) return make("rejected", "model_unavailable", false);
  if (http === 413) return make("rejected", "too_large", false);
  if (http === 400) {
    if (/^You have reached your specified/i.test(apiMessage)) return make("rejected", "spend_limit", false);
    if (/data retention/i.test(apiMessage) || /\bmodel\b/i.test(apiMessage)) return make("rejected", "model_unavailable", false);
    return make("rejected", "bad_request", false);
  }
  return make("rejected", "client_error", false);
}

/**
 * Error codes after which no further call in the run can succeed until a person changes
 * something. `wrong_model` is among them: an answer from a model that was not asked for is
 * paid for and unusable, and the next one would be too.
 */
export const FATAL_CODES: readonly string[] = ["auth", "billing", "spend_limit", "model_unavailable", "bad_request", "too_large", "wrong_model"];

export interface LiveOptions {
  /** Put a 5-minute cache breakpoint on the rules text. */
  cacheSystem: boolean;
  now?: () => number;
}

export class LiveAnthropicProvider implements Provider {
  readonly id = "anthropic" as const;
  readonly paid = true;
  private readonly price: ModelPrice;
  private readonly now: () => number;

  constructor(
    private readonly client: MessagesClient,
    readonly model: string,
    private readonly options: LiveOptions = { cacheSystem: true },
  ) {
    const price = priceOf(model);
    // a model without a price cannot be reserved for, so it cannot be called
    if (!price) throw new Error("no price is known for the configured model");
    this.price = price;
    this.now = options.now ?? (() => Date.now());
  }

  reserveFor(call: DecisionCall): number {
    return worstCaseCost(this.price, inputTokenBound(call.request), call.maxTokens, this.options.cacheSystem ? "5m" : "none");
  }

  /** The request body, exactly as sent. Exposed so that tests can pin it. */
  body(call: DecisionCall): Record<string, unknown> {
    return {
      model: this.model,
      max_tokens: call.maxTokens,
      system: [{ type: "text", text: call.request.system, ...(this.options.cacheSystem ? { cache_control: { type: "ephemeral" } } : {}) }],
      messages: [{ role: "user", content: call.request.user }],
      output_config: { effort: call.effort, format: { type: "json_schema", schema: call.request.schema } },
      inference_geo: "global",
    };
  }

  async decide(call: DecisionCall, signal?: AbortSignal): Promise<CallResult> {
    const started = this.now();
    const base: Pick<CallResult, "decision" | "confidence" | "cites" | "text" | "usage" | "model" | "requestId" | "stopReason"> = { decision: null, confidence: "", cites: [], text: null, usage: null, model: this.model, requestId: null, stopReason: null };
    let raw: unknown;
    try {
      raw = await this.client.create(this.body(call), { timeout: call.timeoutMs, maxRetries: 0, ...(signal ? { signal } : {}) });
    } catch (err) {
      const c = classifyError(err);
      return { ...base, status: c.status, costMicroUsd: c.status === "rejected" ? 0 : null, error: c.error, requestId: c.requestId, latencyMs: this.now() - started };
    }
    const latencyMs = this.now() - started;
    if (!isObj(raw)) return { ...base, status: "unknown", costMicroUsd: null, error: { code: "no_message", status: 200, retryable: false, message: "" }, latencyMs };
    const requestId = str(raw._request_id);
    const stopReason = str(raw.stop_reason);
    const usage = readUsage(raw.usage);
    // money first: an answer we cannot price is an answer whose cost we do not know
    const cost = usage ? costFromUsage(this.price, usage, this.options.cacheSystem ? "5m" : "1h") : null;
    if (cost === null) return { ...base, status: "unknown", costMicroUsd: null, usage, requestId, stopReason, error: { code: "usage_unreadable", status: 200, retryable: false, message: "" }, latencyMs };
    const done = { ...base, usage, costMicroUsd: cost, requestId, stopReason, latencyMs };
    if (str(raw.model) !== null && raw.model !== this.model) {
      // the provider answered with a model we did not ask for: paid for, and not to be used
      return { ...done, status: "malformed", error: { code: "wrong_model", status: 200, retryable: false, message: "" } };
    }
    if (stopReason === "refusal") return { ...done, status: "refused", error: { code: "refusal", status: 200, retryable: false, message: "" } };
    if (stopReason === "max_tokens") return { ...done, status: "truncated", error: { code: "max_tokens", status: 200, retryable: false, message: "" } };
    if (stopReason !== "end_turn") return { ...done, status: "malformed", error: { code: `stop_${stopReason ?? "missing"}`.slice(0, 40), status: 200, retryable: false, message: "" } };
    // the answer is the text blocks only; thinking blocks are never read
    const blocks = Array.isArray(raw.content) ? (raw.content as unknown[]) : [];
    const text = blocks
      .filter((b): b is { type: "text"; text: string } => isObj(b) && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("");
    const read = parseWire(text, call.observation);
    if (!read.ok) return { ...done, status: "malformed", text: text.slice(0, 4000), error: { code: read.error ?? "malformed", status: 200, retryable: false, message: "" } };
    return { ...done, status: "ok", decision: read.decision, confidence: read.confidence, cites: read.cites, text, error: null };
  }
}

/**
 * The live provider for this deployment, or the reason there is none. Constructing it makes
 * no request.
 */
export function liveProvider(model: string | null, apiKey: string | null): { ok: true; provider: LiveAnthropicProvider } | { ok: false; reason: string } {
  if (!apiKey) return { ok: false, reason: "no API key is configured" };
  if (!model) return { ok: false, reason: "no model is configured" };
  if (!priceOf(model)) return { ok: false, reason: "the configured model has no entry in the price table" };
  return { ok: true, provider: new LiveAnthropicProvider(sdkClient(apiKey), model) };
}
