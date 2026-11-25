import { describe, expect, it, vi } from "vitest";
import { createWorld, makeConfig, observe, step, type SimEvent } from "@/engine";
import { MockProvider } from "@/providers/mock";
import { costFromUsage, priceOf } from "@/providers/prices";
import { buildRequest, promptFeatures } from "@/providers/prompt";
import type { DecisionCall } from "@/providers/types";
import { classifyError, guardedFetch, LiveAnthropicProvider, liveProvider, type MessagesClient, PROVIDER_ORIGIN, PROVIDER_PATH, readUsage, sdkClient } from "./anthropic";

/**
 * No test here makes a network request. The adapter is exercised two ways: against a stand-in
 * for the one SDK method it uses, and through the real SDK with the network replaced by
 * canned HTTP responses. Whether the real API accepts the request body is NOT tested here —
 * that needs a paid call the owner has not authorized (docs/EVIDENCE.md).
 */

const MODEL = "claude-fable-5-2";
const KEY = "sk-ant-api03-TEST-ONLY-not-a-real-key-0123456789";

async function sampleCall(): Promise<{ call: DecisionCall; answer: string }> {
  const cfg = makeConfig("first_light", 12, { population: 12, illness: 0, institutions: "open", externalShare: 1000 });
  const world = createWorld(cfg);
  const out: SimEvent[] = [];
  for (let i = 0; i < 130; i++) step(world, out);
  const agent = world.agents.find((a) => a.alive && !a.asleep)!;
  const observation = observe(world, agent.id)!;
  const call: DecisionCall = { runId: "run_x", epoch: 3, agent: agent.id, attempt: 1, seed: cfg.seed, observation, request: buildRequest(observation, promptFeatures(cfg), "rich"), maxTokens: 2000, effort: "low", timeoutMs: 30_000 };
  // a well-formed answer: what the mock mind would say, in wire form
  const answer = (await new MockProvider().decide(call)).text as string;
  return { call, answer };
}

const usage = (over: Record<string, unknown> = {}) => ({ input_tokens: 900, output_tokens: 420, cache_creation_input_tokens: 2300, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 2300, ephemeral_1h_input_tokens: 0 }, output_tokens_details: { thinking_tokens: 180 }, inference_geo: "global", service_tier: "standard", speed: "standard", server_tool_use: null, ...over });

const message = (text: string, over: Record<string, unknown> = {}) => ({
  id: "msg_01",
  type: "message",
  role: "assistant",
  model: MODEL,
  content: [
    { type: "thinking", thinking: "PRIVATE REASONING THAT MUST NEVER BE KEPT", signature: "sig" },
    { type: "text", text },
  ],
  stop_reason: "end_turn",
  stop_details: null,
  usage: usage(),
  _request_id: "req_018EeWyXxfu5pfWkrYcMdjWG",
  ...over,
});

const standIn = (respond: (body: Record<string, unknown>, options: { timeout: number; maxRetries: 0 }) => unknown): { client: MessagesClient; seen: { body: Record<string, unknown>; options: { timeout: number; maxRetries: 0 } }[] } => {
  const seen: { body: Record<string, unknown>; options: { timeout: number; maxRetries: 0 } }[] = [];
  return {
    seen,
    client: {
      create: async (body, options) => {
        seen.push({ body, options });
        const r = respond(body, options);
        if (r instanceof Error || (r && typeof r === "object" && "throw" in r)) throw (r as { throw?: unknown }).throw ?? r;
        return r;
      },
    },
  };
};

describe("the live adapter (no network)", () => {
  it("sends exactly the request the verified API notes describe, and nothing else", async () => {
    const { call, answer } = await sampleCall();
    const { client, seen } = standIn(() => message(answer));
    const provider = new LiveAnthropicProvider(client, MODEL);
    await provider.decide(call);
    expect(seen).toHaveLength(1);
    const { body, options } = seen[0]!;
    expect(Object.keys(body).sort()).toEqual(["inference_geo", "max_tokens", "messages", "model", "output_config", "system"]);
    expect(body.model).toBe(MODEL);
    expect(body.max_tokens).toBe(2000);
    expect(body.inference_geo).toBe("global");
    expect(body.system).toEqual([{ type: "text", text: call.request.system, cache_control: { type: "ephemeral" } }]);
    expect(body.messages).toEqual([{ role: "user", content: call.request.user }]);
    expect(body.output_config).toEqual({ effort: "low", format: { type: "json_schema", schema: call.request.schema } });
    // the model rejects these, or they would change what is charged or which model answers
    for (const forbidden of ["thinking", "temperature", "top_p", "top_k", "tools", "tool_choice", "fallbacks", "speed", "stream", "service_tier", "metadata", "stop_sequences"]) expect(body).not.toHaveProperty(forbidden);
    // every attempt is one request: the SDK's own retries are off, and the timeout is ours
    expect(options).toMatchObject({ maxRetries: 0, timeout: 30_000 });
    // nothing from the environment or the key is in the body
    expect(JSON.stringify(body)).not.toMatch(/sk-ant-|process\.env|ANTHROPIC_API_KEY/);
    // caching can be turned off, and then no breakpoint is sent
    const plain = standIn(() => message(answer));
    await new LiveAnthropicProvider(plain.client, MODEL, { cacheSystem: false }).decide(call);
    expect(plain.seen[0]!.body.system).toEqual([{ type: "text", text: call.request.system }]);
  });

  it("reads the answer from the text blocks only, prices it from the usage report, and keeps no reasoning", async () => {
    const { call, answer } = await sampleCall();
    const { client } = standIn(() => message(answer));
    const provider = new LiveAnthropicProvider(client, MODEL);
    const r = await provider.decide(call);
    expect(r.status).toBe("ok");
    expect(r.decision!.intents.length).toBeGreaterThan(0);
    expect(r.requestId).toBe("req_018EeWyXxfu5pfWkrYcMdjWG");
    expect(r.stopReason).toBe("end_turn");
    // 900 × $8 + 2300 × $10 + 420 × $40 per million
    expect(r.costMicroUsd).toBe(900 * 8 + 2300 * 10 + 420 * 40);
    expect(r.usage).toMatchObject({ input_tokens: 900, output_tokens: 420, cache_creation_5m: 2300, thinking_tokens: 180 });
    expect(JSON.stringify(r)).not.toContain("PRIVATE REASONING");
    // and the reservation made for this call would have covered it
    expect(r.costMicroUsd!).toBeLessThanOrEqual(provider.reserveFor(call));
  });

  it("an answer that was paid for but cannot be used is reported as what it was", async () => {
    const { call, answer } = await sampleCall();
    const run = async (m: unknown) => new LiveAnthropicProvider(standIn(() => m).client, MODEL).decide(call);
    const cost = 900 * 8 + 2300 * 10 + 420 * 40;

    expect(await run(message(answer.slice(0, 40), { stop_reason: "max_tokens" }))).toMatchObject({ status: "truncated", costMicroUsd: cost, decision: null, error: { code: "max_tokens" } });
    expect(await run(message("", { stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: "…" }, content: [] }))).toMatchObject({ status: "refused", costMicroUsd: cost, decision: null });
    expect(await run(message("Sure! Here is my plan: go east."))).toMatchObject({ status: "malformed", costMicroUsd: cost, error: { code: "not_json" } });
    expect(await run(message('{"goal":"x"}'))).toMatchObject({ status: "malformed", error: { code: "wrong_shape" } });
    expect(await run(message(answer, { stop_reason: "tool_use" }))).toMatchObject({ status: "malformed", error: { code: "stop_tool_use" } });
    expect(await run(message(answer, { stop_reason: "model_context_window_exceeded" }))).toMatchObject({ status: "malformed" });
    // a different model answered: paid for, never used
    expect(await run(message(answer, { model: "claude-opus-5" }))).toMatchObject({ status: "malformed", decision: null, error: { code: "wrong_model" } });
    // only thinking came back
    expect(await run(message(answer, { content: [{ type: "thinking", thinking: "…", signature: "s" }] }))).toMatchObject({ status: "malformed", error: { code: "not_json" } });
  });

  it("an answer whose cost cannot be established has an unknown cost, never a guessed one", async () => {
    const { call, answer } = await sampleCall();
    const run = async (m: unknown) => new LiveAnthropicProvider(standIn(() => m).client, MODEL).decide(call);
    expect(await run(message(answer, { usage: undefined }))).toMatchObject({ status: "unknown", costMicroUsd: null, decision: null, error: { code: "usage_unreadable" } });
    expect(await run(message(answer, { usage: usage({ output_tokens: undefined }) }))).toMatchObject({ status: "unknown", costMicroUsd: null });
    expect(await run(message(answer, { usage: usage({ input_tokens: "many" }) }))).toMatchObject({ status: "unknown", costMicroUsd: null });
    expect(await run(message(answer, { usage: usage({ speed: "ludicrous" }) }))).toMatchObject({ status: "unknown", costMicroUsd: null });
    expect(await run(null)).toMatchObject({ status: "unknown", costMicroUsd: null, error: { code: "no_message" } });
    expect(await run("ok")).toMatchObject({ status: "unknown", costMicroUsd: null });
    // modes we never ask for are priced as what they are when the report names them
    const fast = await run(message(answer, { usage: usage({ speed: "fast" }) }));
    expect(fast).toMatchObject({ status: "ok" });
    expect(fast.costMicroUsd).toBe((900 * 8 + 2300 * 10 + 420 * 40) * 2);
    const us = await run(message(answer, { usage: usage({ inference_geo: "us" }) }));
    expect(us.costMicroUsd).toBe(Math.ceil(((900 * 8 + 2300 * 10 + 420 * 40) * 1100) / 1000));
  });

  it("reads the usage report defensively", () => {
    expect(readUsage(null)).toBeNull();
    expect(readUsage("usage")).toBeNull();
    const u = readUsage({ input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: null, cache_read_input_tokens: null, cache_creation: null, output_tokens_details: null })!;
    expect(u).toMatchObject({ input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, thinking_tokens: null });
    expect(costFromUsage(priceOf(MODEL)!, u)).toBe(10 * 8 + 5 * 40);
    expect(Number.isNaN(readUsage({ output_tokens: 5 })!.input_tokens)).toBe(true);
    expect(Number.isNaN(readUsage({ input_tokens: 5, output_tokens: 5, cache_read_input_tokens: -3 })!.cache_read_input_tokens)).toBe(true);
  });

  it("classifies failures by what they mean for the money", () => {
    // an error as the SDK builds it from the provider's own refusal: its error envelope in the body, and the request id it gave
    const http = (status: number, extra: Record<string, unknown> = {}) =>
      Object.assign(new Error("provider said something we do not keep"), { status, requestID: "req_x", apiMessage: "", errorCode: null, error: { type: "error", error: { type: "some_error", message: "provider said something we do not keep" } }, ...extra });
    // the same status from something that is not the provider: no envelope, or no request id
    const foreign = (status: number, extra: Record<string, unknown> = {}) => Object.assign(new Error("<html>502 Bad Gateway</html>"), { status, requestID: null, apiMessage: null, errorCode: null, error: undefined, ...extra });
    const named = (name: string) => Object.assign(new Error("…"), { name, status: undefined });
    const table: [unknown, "rejected" | "unknown", string, boolean][] = [
      [http(429), "rejected", "rate_limited", true],
      [http(429, { errorCode: "enforced_spend_limit_reached" }), "rejected", "spend_limit", false],
      [http(429, { errorCode: "contract_spend_limit_reached" }), "rejected", "spend_limit", false],
      [http(429, { errorCode: "ramp_limit_exceeded" }), "rejected", "ramp_limit", false],
      [http(529), "rejected", "overloaded", true],
      [http(500), "rejected", "server_error", true],
      [http(503), "rejected", "server_error", true],
      [http(401), "rejected", "auth", false],
      [http(403), "rejected", "auth", false],
      [http(402), "rejected", "billing", false],
      [http(404), "rejected", "model_unavailable", false],
      [http(413), "rejected", "too_large", false],
      [http(400), "rejected", "bad_request", false],
      [http(400, { apiMessage: "You have reached your specified workspace API usage limits." }), "rejected", "spend_limit", false],
      [http(400, { apiMessage: "In order to access this model, your organization or workspace must have data retention enabled." }), "rejected", "model_unavailable", false],
      [http(422), "rejected", "client_error", false],
      // A status is not proof. The same numbers from something between here and the provider —
      // a gateway's own page, a body that is not the provider's envelope, no request id — say
      // nothing about whether the work was done and charged for: the money stays held.
      [foreign(500), "unknown", "unrecognized_response", false],
      [foreign(502), "unknown", "unrecognized_response", false],
      [foreign(503), "unknown", "unrecognized_response", false],
      [foreign(529), "unknown", "unrecognized_response", false],
      [foreign(429), "unknown", "unrecognized_response", false],
      [foreign(401), "unknown", "unrecognized_response", false],
      [foreign(403), "unknown", "unrecognized_response", false],
      [foreign(400), "unknown", "unrecognized_response", false],
      [foreign(404), "unknown", "unrecognized_response", false],
      [foreign(413), "unknown", "unrecognized_response", false],
      [foreign(503, { error: "Service Unavailable", requestID: "req_x" }), "unknown", "unrecognized_response", false],
      [foreign(503, { error: { message: "upstream connect error" }, requestID: "req_x" }), "unknown", "unrecognized_response", false],
      [foreign(500, { error: { type: "error", error: { type: "api_error" } } }), "unknown", "unrecognized_response", false], // the envelope, but no request id
      [foreign(500, { error: { type: "error", error: { type: "api_error" } }, requestID: "" }), "unknown", "unrecognized_response", false],
      [http(500, { error: { type: "error" } }), "unknown", "unrecognized_response", false], // a request id, but not the envelope
      // the request may have run: nothing is given back and nothing is sent again
      [http(408), "unknown", "gateway_timeout", false],
      [http(499), "unknown", "gateway_timeout", false],
      [http(504), "unknown", "gateway_timeout", false],
      [named("APIConnectionTimeoutError"), "unknown", "timeout", false],
      [named("APIConnectionError"), "unknown", "connection", false],
      [named("APIUserAbortError"), "unknown", "aborted", false],
      [new TypeError("fetch failed"), "unknown", "no_response", false],
      ["a string", "unknown", "no_response", false],
      [undefined, "unknown", "no_response", false],
    ];
    for (const [err, status, code, retryable] of table) {
      const c = classifyError(err);
      expect([c.status, c.error.code, c.error.retryable], `${code}`).toEqual([status, code, retryable]);
      // the provider's free text is never carried along
      expect(JSON.stringify(c)).not.toContain("provider said something");
      expect(JSON.stringify(c)).not.toContain("Bad Gateway");
      // and nothing that leaves the money unaccounted for is ever tried again
      if (c.status === "unknown") expect(c.error.retryable).toBe(false);
    }
  });

  it("refuses to exist for a model it cannot price, and reports why live calls are unavailable", () => {
    expect(() => new LiveAnthropicProvider(standIn(() => null).client, "claude-fable-9")).toThrow(/no price/);
    expect(liveProvider(null, KEY)).toEqual({ ok: false, reason: "no model is configured" });
    expect(liveProvider(MODEL, null)).toEqual({ ok: false, reason: "no API key is configured" });
    expect(liveProvider("gpt-9", KEY)).toMatchObject({ ok: false });
    const made = liveProvider(MODEL, KEY);
    expect(made.ok).toBe(true);
    // the key is not readable off the provider object
    if (made.ok) expect(JSON.stringify(made.provider)).not.toContain(KEY);
  });
});

/**
 * The same adapter through the real SDK, with `fetch` replaced. This checks what the SDK
 * itself does with our request: where it goes, which headers carry the key and the API
 * version, that it is sent once, and which error classes come back.
 */
describe("the live adapter through the real SDK (network replaced by canned responses)", () => {
  const respond = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "request-id": "req_from_header", ...headers } });
  /** A response from something that is not the provider: no request id, and whatever body it likes. */
  const gateway = (status: number, body: string, type = "text/html") => new Response(body, { status, headers: { "content-type": type } });
  const wire = (m: Record<string, unknown>) => {
    const { _request_id: _ignored, ...rest } = m;
    return rest;
  };

  it("sends the key to the provider's own host whatever the environment says about a base URL or another credential", async () => {
    const { call, answer } = await sampleCall();
    const seen: { url: string; authorization: string | null; apiKeyHeader: string | null }[] = [];
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({ url: String(input instanceof Request ? input.url : input), authorization: headers.get("authorization"), apiKeyHeader: headers.get("x-api-key") });
      return respond(200, wire(message(answer)));
    }) as typeof fetch;
    const before = { base: process.env.ANTHROPIC_BASE_URL, token: process.env.ANTHROPIC_AUTH_TOKEN, key: process.env.ANTHROPIC_API_KEY };
    process.env.ANTHROPIC_BASE_URL = "https://elsewhere.example/steal";
    process.env.ANTHROPIC_AUTH_TOKEN = "token-from-the-environment";
    process.env.ANTHROPIC_API_KEY = "key-from-the-environment";
    try {
      const r = await new LiveAnthropicProvider(sdkClient(KEY, fakeFetch), MODEL).decide(call);
      expect(r.status).toBe("ok");
    } finally {
      for (const [name, value] of [["ANTHROPIC_BASE_URL", before.base], ["ANTHROPIC_AUTH_TOKEN", before.token], ["ANTHROPIC_API_KEY", before.key]] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(`${PROVIDER_ORIGIN}/v1/messages`);
    expect(new URL(seen[0]?.url ?? "").origin).toBe("https://api.anthropic.com");
    // the credential is the one passed in code, and only that one
    expect(`${seen[0]?.authorization ?? ""} ${seen[0]?.apiKeyHeader ?? ""}`).toContain(KEY);
    expect(`${seen[0]?.authorization ?? ""} ${seen[0]?.apiKeyHeader ?? ""}`).not.toContain("from-the-environment");
  });

  it("posts one request to the Messages API with the key in the Authorization header and the current API version", async () => {
    const { call, answer } = await sampleCall();
    const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input instanceof Request ? input.url : input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return respond(200, wire(message(answer)));
    }) as typeof fetch;
    const provider = new LiveAnthropicProvider(sdkClient(KEY, fakeFetch), MODEL);
    const r = await provider.decide(call);
    expect(r.status).toBe("ok");
    expect(r.requestId).toBe("req_from_header");
    expect(r.costMicroUsd).toBe(900 * 8 + 2300 * 10 + 420 * 40);
    expect(requests).toHaveLength(1);
    const q = requests[0]!;
    expect(q.url).toBe("https://api.anthropic.com/v1/messages");
    expect(q.headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(q.headers.get("anthropic-version")).toBe("2026-10-21");
    expect(q.headers.get("anthropic-beta")).toBeNull();
    expect(q.headers.get("anthropic-dangerous-direct-browser-access")).toBeNull();
    expect(Object.keys(q.body).sort()).toEqual(["inference_geo", "max_tokens", "messages", "model", "output_config", "system"]);
    expect(q.body.model).toBe(MODEL);
    // the key appears in that one header and nowhere else: not in the body, not in the result
    expect(JSON.stringify(q.body)).not.toContain(KEY);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it("error responses arrive as the SDK's typed errors, are sent exactly once, and are classified", async () => {
    const { call } = await sampleCall();
    const cases: [number, Record<string, unknown>, Record<string, string>, string, string, boolean][] = [
      [429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } }, { "retry-after": "1" }, "rejected", "rate_limited", true],
      [529, { type: "error", error: { type: "overloaded_error", message: "overloaded" } }, {}, "rejected", "overloaded", true],
      [500, { type: "error", error: { type: "api_error", message: "oops" } }, {}, "rejected", "server_error", true],
      [401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, {}, "rejected", "auth", false],
      [404, { type: "error", error: { type: "not_found_error", message: "model: claude-nope" } }, {}, "rejected", "model_unavailable", false],
      [400, { type: "error", error: { type: "invalid_request_error", message: "You have reached your specified API usage limits. You will regain access on 2027-01-01." } }, {}, "rejected", "spend_limit", false],
      [400, { type: "error", error: { type: "invalid_request_error", message: "output_config.format.schema: Schema is too complex for compilation." } }, {}, "rejected", "bad_request", false],
      [504, { type: "error", error: { type: "timeout_error", message: "gateway timeout" } }, {}, "unknown", "gateway_timeout", false],
    ];
    for (const [status, body, headers, expected, code, retryable] of cases) {
      let sent = 0;
      const fakeFetch = (async () => {
        sent++;
        return respond(status, body, headers);
      }) as typeof fetch;
      const r = await new LiveAnthropicProvider(sdkClient(KEY, fakeFetch), MODEL).decide(call);
      expect(sent, `${status} must not be retried by the SDK`).toBe(1);
      expect([r.status, r.error?.code, r.error?.retryable, r.error?.status], `${status}`).toEqual([expected, code, retryable, status]);
      expect(r.costMicroUsd).toBe(expected === "rejected" ? 0 : null);
      expect(r.requestId).toBe("req_from_header");
      // nothing of the provider's message text is kept (it can quote the request back)
      expect(JSON.stringify(r)).not.toMatch(/slow down|invalid x-api-key|regain access|too complex/);
    }
  });

  it("an error page from something between here and the provider proves nothing: the outcome is unknown, the money stays held, nothing is sent again", async () => {
    const { call } = await sampleCall();
    const pages: [number, Response][] = [
      [502, gateway(502, "<html><body>502 Bad Gateway</body></html>")],
      [503, gateway(503, "upstream connect error or disconnect/reset before headers", "text/plain")],
      [500, gateway(500, JSON.stringify({ message: "Internal Server Error" }), "application/json")],
      [520, gateway(520, "")],
      [403, gateway(403, "<html>Access denied by the corporate proxy</html>")],
      // the provider's envelope, relayed by something that dropped the request id: still not proof
      [503, gateway(503, JSON.stringify({ type: "error", error: { type: "api_error", message: "relayed" } }), "application/json")],
    ];
    for (const [status, page] of pages) {
      let sent = 0;
      const fakeFetch = (async () => {
        sent++;
        return page;
      }) as typeof fetch;
      const r = await new LiveAnthropicProvider(sdkClient(KEY, fakeFetch), MODEL).decide(call);
      expect(sent, `${status} must not be retried`).toBe(1);
      expect([r.status, r.error?.code, r.error?.retryable, r.costMicroUsd], `${status}`).toEqual(["unknown", "unrecognized_response", false, null]);
      expect(JSON.stringify(r)).not.toMatch(/Bad Gateway|upstream|corporate|relayed/);
    }
  });

  it("nothing in the environment adds a header, turns on a log or a trace, or moves the request: the guard lets one request through, to one place", async () => {
    const { call, answer } = await sampleCall();
    const sent: { url: string; headers: Headers; redirect: unknown }[] = [];
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(input instanceof Request ? input.url : input), headers: new Headers(init?.headers), redirect: init?.redirect });
      return respond(200, wire(message(answer)));
    }) as typeof fetch;
    const names = ["ANTHROPIC_CUSTOM_HEADERS", "ANTHROPIC_LOG", "ANTHROPIC_OPEN_TELEMETRY", "ANTHROPIC_OPEN_TELEMETRY_TRACES_CONTENT_MODE", "ANTHROPIC_BASE_URL"] as const;
    const before = names.map((n) => process.env[n]);
    process.env.ANTHROPIC_CUSTOM_HEADERS = "anthropic-beta: something-2026-01-01\nx-smuggled: yes\ncookie: a=b";
    process.env.ANTHROPIC_LOG = "debug";
    process.env.ANTHROPIC_OPEN_TELEMETRY = "true";
    process.env.ANTHROPIC_OPEN_TELEMETRY_TRACES_CONTENT_MODE = "content";
    process.env.ANTHROPIC_BASE_URL = "https://elsewhere.example";
    const printed: string[] = [];
    const spies = (["log", "info", "debug", "warn", "error"] as const).map((k) => vi.spyOn(console, k).mockImplementation((...args: unknown[]) => void printed.push(args.map(String).join(" "))));
    try {
      const r = await new LiveAnthropicProvider(sdkClient(KEY, fakeFetch), MODEL).decide(call);
      expect(r.status).toBe("ok");
    } finally {
      for (const spy of spies) spy.mockRestore();
      names.forEach((n, i) => {
        if (before[i] === undefined) delete process.env[n];
        else process.env[n] = before[i];
      });
    }
    expect(sent).toHaveLength(1);
    const q = sent[0]!;
    expect(q.url).toBe("https://api.anthropic.com/v1/messages");
    expect(q.redirect).toBe("error");
    // only what a Messages request needs was sent: nothing the environment asked for, no trace context
    const headerNames = [...q.headers.keys()].sort();
    for (const name of headerNames) expect(name, name).toMatch(/^(accept|content-type|content-length|user-agent|authorization|x-api-key|anthropic-version|x-stainless-[a-z0-9-]+)$/);
    for (const absent of ["anthropic-beta", "x-smuggled", "cookie", "traceparent", "tracestate", "baggage"]) expect(q.headers.get(absent), absent).toBeNull();
    // and the SDK said nothing: no request or response body, no key, on any console stream
    expect(printed.join("\n")).toBe("");
  });

  it("the guard refuses anything that is not that one request, before it is sent", async () => {
    let reached = 0;
    const inner = (async () => {
      reached++;
      return new Response("{}");
    }) as typeof fetch;
    const guarded = guardedFetch(inner);
    const post = { method: "POST", headers: { "x-api-key": KEY, "content-type": "application/json" }, body: "{}" };
    for (const [url, init] of [
      ["https://elsewhere.example/v1/messages", post],
      ["http://api.anthropic.com/v1/messages", post], // not over TLS
      ["https://api.anthropic.com.evil.example/v1/messages", post],
      ["https://api.anthropic.com/v1/messages/batches", post],
      ["https://api.anthropic.com/v1/files", post],
      ["https://api.anthropic.com/v1/messages?beta=true", post],
      ["https://api.anthropic.com/v1/messages", { ...post, method: "GET", body: undefined }],
      ["https://api.anthropic.com/v1/messages", { headers: post.headers }], // no method: a GET
    ] as [string, RequestInit][]) {
      await expect(guarded(url, init), url).rejects.toThrow(/refused/);
    }
    expect(reached).toBe(0);
    await guarded(`${PROVIDER_ORIGIN}${PROVIDER_PATH}`, post);
    expect(reached).toBe(1);
  });

  it("a request that gets no answer in time, or loses its connection, has an unknown outcome and is not sent again", async () => {
    const { call } = await sampleCall();
    let sent = 0;
    const hang = ((_input: RequestInfo | URL, init?: RequestInit) => {
      sent++;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    }) as typeof fetch;
    const slow = await new LiveAnthropicProvider(sdkClient(KEY, hang), MODEL).decide({ ...call, timeoutMs: 60 });
    expect(slow).toMatchObject({ status: "unknown", costMicroUsd: null, error: { code: "timeout", retryable: false } });
    expect(sent).toBe(1);

    sent = 0;
    const broken = (async () => {
      sent++;
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const lost = await new LiveAnthropicProvider(sdkClient(KEY, broken), MODEL).decide(call);
    expect(lost).toMatchObject({ status: "unknown", costMicroUsd: null, error: { code: "connection", retryable: false } });
    expect(sent).toBe(1);
  });
});
